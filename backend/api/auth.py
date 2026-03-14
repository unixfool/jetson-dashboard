"""
Authentication - JWT-based auth para Jetson Dashboard
Configurado via .env: AUTH_ENABLED, AUTH_USERNAME, AUTH_PASSWORD
"""

import os
import hmac
import hashlib
import time
import base64
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer(auto_error=False)

# ─── Config desde .env ───────────────────────────────────────────────────────

def _get_config():
    return {
        "enabled": os.environ.get("AUTH_ENABLED", "false").lower() == "true",
        "username": os.environ.get("AUTH_USERNAME", "admin"),
        "password": os.environ.get("AUTH_PASSWORD", "changeme"),
        "secret": os.environ.get("AUTH_SECRET", "jetson-dashboard-secret-key-change-me"),
        "token_ttl": int(os.environ.get("AUTH_TOKEN_TTL", "86400")),  # 24h por defecto
    }


# ─── JWT minimalista (sin dependencias externas) ─────────────────────────────

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)

def _create_token(username: str, secret: str, ttl: int) -> str:
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url_encode(json.dumps({
        "sub": username,
        "iat": int(time.time()),
        "exp": int(time.time()) + ttl,
    }).encode())
    msg = f"{header}.{payload}"
    sig = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()
    return f"{msg}.{_b64url_encode(sig)}"

def _verify_token(token: str, secret: str) -> Optional[str]:
    """Verifica el token y devuelve el username si es válido, None si no."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, payload, sig = parts
        # Verificar firma
        msg = f"{header}.{payload}"
        expected_sig = _b64url_encode(
            hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(sig, expected_sig):
            return None
        # Verificar expiración
        data = json.loads(_b64url_decode(payload))
        if data.get("exp", 0) < time.time():
            return None
        return data.get("sub")
    except Exception:
        return None


# ─── Models ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    username: str
    expires_in: int


# ─── Dependency: verificar autenticación ─────────────────────────────────────

async def require_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """
    Dependency que protege endpoints.
    Si AUTH_ENABLED=false, deja pasar todo.
    Si AUTH_ENABLED=true, requiere Bearer token válido.
    """
    cfg = _get_config()
    if not cfg["enabled"]:
        return None  # Auth desactivada, acceso libre

    token = None

    # Intentar obtener token del header Authorization: Bearer <token>
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials

    # Fallback: query param ?token=xxx (útil para WebSocket)
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


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    cfg = _get_config()

    # Si auth está desactivada, devolver token vacío
    if not cfg["enabled"]:
        return LoginResponse(token="auth-disabled", username=req.username, expires_in=0)

    # Verificar credenciales con comparación segura (evita timing attacks)
    valid_user = hmac.compare_digest(req.username.strip(), cfg["username"])
    valid_pass = hmac.compare_digest(req.password, cfg["password"])

    if not (valid_user and valid_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = _create_token(req.username, cfg["secret"], cfg["token_ttl"])
    logger.info(f"Login successful: {req.username}")

    return LoginResponse(
        token=token,
        username=req.username,
        expires_in=cfg["token_ttl"],
    )


@router.get("/me")
async def get_me(username: str = Depends(require_auth)):
    cfg = _get_config()
    return {
        "username": username or "anonymous",
        "auth_enabled": cfg["enabled"],
    }


@router.post("/logout")
async def logout():
    # JWT es stateless — el logout lo maneja el frontend borrando el token
    return {"success": True, "message": "Logged out"}


@router.get("/status")
async def auth_status():
    """Endpoint público — dice si auth está activada (sin revelar credenciales)"""
    cfg = _get_config()
    return {"auth_enabled": cfg["enabled"]}
