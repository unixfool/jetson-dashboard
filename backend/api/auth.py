"""
Authentication - JWT + TOTP 2FA for Jetson Dashboard
Configured via .env: AUTH_ENABLED, AUTH_USERNAME, AUTH_PASSWORD
2FA secret stored in data/settings.json
"""

import os
import hmac
import hashlib
import time
import base64
import json
import logging
from pathlib import Path
from typing import Optional

import pyotp

from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer(auto_error=False)

DATA_DIR     = Path("/app/data")
SETTINGS_FILE = DATA_DIR / "settings.json"


# ── Config from .env ──────────────────────────────────────────────────────────

def _get_config():
    return {
        "enabled":   os.environ.get("AUTH_ENABLED", "false").lower() == "true",
        "username":  os.environ.get("AUTH_USERNAME", "admin"),
        "password":  os.environ.get("AUTH_PASSWORD", "changeme"),
        "secret":    os.environ.get("AUTH_SECRET", "jetson-dashboard-secret-key-change-me"),
        "token_ttl": int(os.environ.get("AUTH_TOKEN_TTL", "86400")),
    }


# ── Settings helpers ──────────────────────────────────────────────────────────

def _load_settings() -> dict:
    try:
        if SETTINGS_FILE.exists():
            return json.loads(SETTINGS_FILE.read_text())
    except Exception:
        pass
    return {}

def _save_settings(data: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    existing = _load_settings()
    existing.update(data)
    SETTINGS_FILE.write_text(json.dumps(existing, indent=2))


# ── 2FA helpers ───────────────────────────────────────────────────────────────

def _get_totp_secret() -> Optional[str]:
    """Return the stored TOTP secret, or None if 2FA is not set up."""
    return _load_settings().get("totp_secret")

def _is_2fa_enabled() -> bool:
    s = _load_settings()
    return bool(s.get("totp_secret") and s.get("totp_enabled"))

def _verify_totp(code: str, secret: str) -> bool:
    """Verify a 6-digit TOTP code. Allows ±1 time step for clock drift."""
    try:
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=1)
    except Exception:
        return False


# ── JWT (minimal, no external deps) ──────────────────────────────────────────

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)

def _create_token(username: str, secret: str, ttl: int) -> str:
    header  = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url_encode(json.dumps({
        "sub": username,
        "iat": int(time.time()),
        "exp": int(time.time()) + ttl,
    }).encode())
    msg = f"{header}.{payload}"
    sig = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()
    return f"{msg}.{_b64url_encode(sig)}"

def _verify_token(token: str, secret: str) -> Optional[str]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, payload, sig = parts
        msg = f"{header}.{payload}"
        expected = _b64url_encode(
            hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_b64url_decode(payload))
        if data.get("exp", 0) < time.time():
            return None
        return data.get("sub")
    except Exception:
        return None


# ── Models ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token:        str
    username:     str
    expires_in:   int
    requires_totp: bool = False   # True = 2FA step needed before token is valid

class TotpLoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str

class TotpVerifyRequest(BaseModel):
    code: str   # 6-digit code to confirm setup

class TotpDisableRequest(BaseModel):
    code: str   # Must confirm with current valid code to disable


# ── Auth dependency ───────────────────────────────────────────────────────────

async def require_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    cfg = _get_config()
    if not cfg["enabled"]:
        return None

    token = None
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = _verify_token(token, cfg["secret"])
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return username


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    cfg = _get_config()

    if not cfg["enabled"]:
        return LoginResponse(
            token="auth-disabled", username=req.username,
            expires_in=0, requires_totp=False
        )

    valid_user = hmac.compare_digest(req.username.strip(), cfg["username"])
    valid_pass = hmac.compare_digest(req.password, cfg["password"])

    if not (valid_user and valid_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # If 2FA is enabled, don't issue a token yet — require TOTP step
    if _is_2fa_enabled():
        logger.info(f"Login step 1 OK for {req.username} — 2FA required")
        return LoginResponse(
            token="",
            username=req.username,
            expires_in=0,
            requires_totp=True,
        )

    token = _create_token(req.username, cfg["secret"], cfg["token_ttl"])
    logger.info(f"Login successful: {req.username}")
    return LoginResponse(
        token=token, username=req.username,
        expires_in=cfg["token_ttl"], requires_totp=False
    )


@router.post("/2fa/login", response_model=LoginResponse)
async def login_totp(req: TotpLoginRequest):
    """Step 2 of login when 2FA is enabled — verify TOTP code and issue JWT."""
    cfg = _get_config()

    if not cfg["enabled"]:
        raise HTTPException(status_code=400, detail="Auth is not enabled")

    # Re-verify credentials (prevent bypassing step 1)
    valid_user = hmac.compare_digest(req.username.strip(), cfg["username"])
    valid_pass = hmac.compare_digest(req.password, cfg["password"])
    if not (valid_user and valid_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    secret = _get_totp_secret()
    if not secret or not _is_2fa_enabled():
        raise HTTPException(status_code=400, detail="2FA is not configured")

    if not _verify_totp(req.totp_code.strip(), secret):
        logger.warning(f"Invalid TOTP code for {req.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authenticator code",
        )

    token = _create_token(req.username, cfg["secret"], cfg["token_ttl"])
    logger.info(f"Login with 2FA successful: {req.username}")
    return LoginResponse(
        token=token, username=req.username,
        expires_in=cfg["token_ttl"], requires_totp=False
    )


@router.get("/2fa/setup")
async def setup_2fa(username: str = Depends(require_auth)):
    """
    Generate a new TOTP secret and return the provisioning URI for QR code.
    Does NOT activate 2FA yet — user must confirm with a valid code first.
    """
    cfg = _get_config()
    secret = pyotp.random_base32()

    # Store secret as pending (not yet enabled)
    _save_settings({"totp_secret": secret, "totp_enabled": False})

    totp     = pyotp.TOTP(secret)
    issuer   = "Jetson Dashboard"
    account  = cfg["username"]
    uri      = totp.provisioning_uri(name=account, issuer_name=issuer)

    logger.info(f"2FA setup initiated for {username}")
    return {
        "secret":           secret,
        "provisioning_uri": uri,
        "issuer":           issuer,
        "account":          account,
    }


@router.post("/2fa/confirm")
async def confirm_2fa(req: TotpVerifyRequest, username: str = Depends(require_auth)):
    """
    Confirm 2FA setup by verifying a valid TOTP code from the authenticator app.
    Only after this call is 2FA actually enabled.
    """
    secret = _get_totp_secret()
    if not secret:
        raise HTTPException(status_code=400, detail="Run /2fa/setup first")

    if not _verify_totp(req.code.strip(), secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid code — make sure your authenticator app is synced",
        )

    _save_settings({"totp_enabled": True})
    logger.info(f"2FA enabled for {username}")
    return {"success": True, "message": "2FA is now active"}


@router.post("/2fa/disable")
async def disable_2fa(req: TotpDisableRequest, username: str = Depends(require_auth)):
    """
    Disable 2FA. Requires a valid TOTP code to confirm it's the account owner.
    """
    secret = _get_totp_secret()
    if not secret or not _is_2fa_enabled():
        raise HTTPException(status_code=400, detail="2FA is not enabled")

    if not _verify_totp(req.code.strip(), secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authenticator code",
        )

    _save_settings({"totp_secret": None, "totp_enabled": False})
    logger.info(f"2FA disabled for {username}")
    return {"success": True, "message": "2FA has been disabled"}


@router.get("/2fa/status")
async def get_2fa_status(username: str = Depends(require_auth)):
    """Return current 2FA status for the authenticated user."""
    return {"enabled": _is_2fa_enabled()}


@router.get("/me")
async def get_me(username: str = Depends(require_auth)):
    cfg = _get_config()
    return {
        "username":    username or "anonymous",
        "auth_enabled": cfg["enabled"],
        "totp_enabled": _is_2fa_enabled(),
    }


@router.post("/logout")
async def logout():
    return {"success": True, "message": "Logged out"}


@router.get("/status")
async def auth_status():
    cfg = _get_config()
    return {
        "auth_enabled": cfg["enabled"],
        "totp_enabled": _is_2fa_enabled(),
    }
