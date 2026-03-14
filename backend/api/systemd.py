"""
Systemd API - Gestión de servicios del sistema host
Método probado: subprocess via /bin/bash -c "nsenter --target 1 --mount -- systemd-run --pipe --quiet -- <cmd>"
"""
import logging
import re
import subprocess
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

PROTECTED_SERVICES = {
    "docker", "docker.service",
    "ssh", "ssh.service", "sshd", "sshd.service",
    "networking", "networking.service",
    "NetworkManager", "NetworkManager.service",
    "systemd-journald", "systemd-journald.service",
    "systemd-udevd", "systemd-udevd.service",
    "dbus", "dbus.service",
}


def _run(cmd: list, timeout: int = 20) -> tuple:
    """
    Ejecutar comando en el host usando exactamente el método que funciona:
    /bin/bash -c "nsenter --target 1 --mount -- systemd-run --pipe --quiet -- <cmd>"
    """
    import shlex
    inner = " ".join(shlex.quote(c) for c in cmd)
    shell_cmd = f"nsenter --target 1 --mount -- systemd-run --pipe --quiet -- {inner}"

    try:
        result = subprocess.run(
            ["/bin/bash", "-c", shell_cmd],
            capture_output=True,
            timeout=timeout,
        )
        return (
            result.returncode,
            result.stdout.decode(errors="replace"),
            result.stderr.decode(errors="replace"),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Command timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _parse_unit_line(line: str) -> Optional[dict]:
    line = line.strip()
    if not line:
        return None
    line = re.sub(r'^[\s\u25cf\u2022●✗○]+', '', line).strip()
    if not line:
        return None
    parts = line.split(None, 4)
    if len(parts) < 4:
        return None
    unit = parts[0]
    if not unit.endswith(".service"):
        return None
    return {
        "name":        unit,
        "short_name":  unit.replace(".service", ""),
        "load":        parts[1],
        "active":      parts[2],
        "sub":         parts[3],
        "description": parts[4].strip() if len(parts) > 4 else "",
        "enabled":     "unknown",
        "protected":   unit in PROTECTED_SERVICES or
                       unit.replace(".service", "") in PROTECTED_SERVICES,
    }


@router.get("/systemd/services")
async def list_services(filter: Optional[str] = None):
    code, out, err = _run([
        "systemctl", "list-units",
        "--type=service", "--all",
        "--no-pager", "--no-legend", "--plain",
    ])

    logger.info(f"systemctl list-units: exit={code} lines={len(out.splitlines())} err={err[:120]}")

    if not out.strip() and err.strip():
        raise HTTPException(status_code=503, detail=f"systemctl failed: {err.strip()}")

    services = []
    for line in out.splitlines():
        parsed = _parse_unit_line(line)
        if not parsed:
            continue
        if filter:
            f = filter.lower()
            if f not in parsed["name"].lower() and f not in parsed["description"].lower():
                continue
        services.append(parsed)

    logger.info(f"Parsed {len(services)} services")

    services.sort(key=lambda s: (
        0 if s["active"] == "active"   else
        1 if s["active"] == "failed"   else
        2 if s["active"] == "inactive" else 3,
        s["name"]
    ))

    return {"services": services, "total": len(services)}


@router.get("/systemd/services/{name}")
async def get_service(name: str):
    safe = re.sub(r'[^a-zA-Z0-9._@-]', '', name)
    if not safe.endswith(".service"):
        safe += ".service"

    _, props_out, _ = _run([
        "systemctl", "show", safe, "--no-pager",
        "--property=ActiveState,SubState,LoadState,UnitFileState,"
                    "MainPID,ExecMainStartTimestamp,Description,Restart,Type",
    ])

    props = {}
    for line in props_out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            props[k] = v

    _, status_out, _ = _run(
        ["systemctl", "status", safe, "--no-pager", "-l", "-n", "20"]
    )

    return {
        "name":        safe,
        "short_name":  safe.replace(".service", ""),
        "description": props.get("Description", ""),
        "active":      props.get("ActiveState", "unknown"),
        "sub":         props.get("SubState", "unknown"),
        "load":        props.get("LoadState", "unknown"),
        "enabled":     props.get("UnitFileState", "unknown"),
        "pid":         props.get("MainPID", "0"),
        "type":        props.get("Type", ""),
        "restart":     props.get("Restart", ""),
        "started":     props.get("ExecMainStartTimestamp", ""),
        "status_text": status_out,
        "protected":   safe in PROTECTED_SERVICES or
                       safe.replace(".service", "") in PROTECTED_SERVICES,
    }


@router.get("/systemd/services/{name}/logs")
async def get_service_logs(name: str, lines: int = 100):
    safe = re.sub(r'[^a-zA-Z0-9._@-]', '', name)
    if not safe.endswith(".service"):
        safe += ".service"
    lines = min(max(lines, 10), 500)

    _, out, _ = _run([
        "journalctl", "-u", safe,
        "-n", str(lines),
        "--no-pager", "--output=short-iso",
    ])

    log_lines = []
    for line in out.splitlines():
        if not line.strip():
            continue
        level = "info"
        ll = line.lower()
        if any(w in ll for w in ["error", "failed", "failure", "critical"]):
            level = "error"
        elif any(w in ll for w in ["warn", "warning"]):
            level = "warn"
        elif any(w in ll for w in ["start", "stop", "activat", "deactivat"]):
            level = "notice"
        log_lines.append({"text": line, "level": level})

    return {"name": safe, "lines": log_lines}


class ServiceAction(BaseModel):
    action: str


@router.post("/systemd/services/{name}/action")
async def service_action(name: str, body: ServiceAction):
    safe = re.sub(r'[^a-zA-Z0-9._@-]', '', name)
    if not safe.endswith(".service"):
        safe += ".service"

    action = body.action.lower()
    if action not in {"start", "stop", "restart", "enable", "disable", "reload"}:
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")

    base = safe.replace(".service", "")
    if action in {"stop", "disable"} and (
        safe in PROTECTED_SERVICES or base in PROTECTED_SERVICES
    ):
        raise HTTPException(status_code=403, detail=f"Service '{safe}' is protected")

    code, out, err = _run(
        ["systemctl", action, safe, "--no-pager"], timeout=20
    )

    if code != 0 and action not in {"enable", "disable"}:
        raise HTTPException(
            status_code=500,
            detail=err.strip() or f"systemctl {action} failed (code {code})"
        )

    _, props_out, _ = _run([
        "systemctl", "show", safe,
        "--property=ActiveState,SubState,UnitFileState", "--no-pager",
    ])
    props = {}
    for line in props_out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            props[k] = v

    return {
        "success": True,
        "action":  action,
        "name":    safe,
        "active":  props.get("ActiveState", "unknown"),
        "sub":     props.get("SubState", "unknown"),
        "enabled": props.get("UnitFileState", "unknown"),
    }
