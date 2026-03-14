"""
ROS2 Monitor API - Jetson Dashboard
Detecta y monitorea nodos, topics y parámetros de ROS2.
Compatible con:
  - ROS2 en contenedor Docker (jetson-ai:latest u otro)
  - ROS2 instalado nativamente en el host
  - Múltiples distribuciones: humble, foxy, galactic, iron
Cuando ROS2 no está activo devuelve estado claro en lugar de error.
"""
import logging
import subprocess
import json
import re
from typing import Optional

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()

# Distribuciones ROS2 soportadas, en orden de preferencia
ROS2_DISTROS = ["humble", "iron", "foxy", "galactic", "jazzy"]

# Imagen Docker preferida (la del usuario)
ROS2_IMAGE = "jetson-ai:latest"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(cmd: str, timeout: int = 10) -> tuple:
    """Ejecutar comando shell. Retorna (returncode, stdout, stderr)."""
    try:
        r = subprocess.run(
            ["/bin/bash", "-c", cmd],
            capture_output=True,
            timeout=timeout,
        )
        return r.returncode, r.stdout.decode(errors="replace"), r.stderr.decode(errors="replace")
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except Exception as e:
        return -1, "", str(e)


def _find_ros2_method() -> Optional[dict]:
    """
    Detectar cómo ejecutar ros2 commands.
    Retorna dict con 'type' y 'prefix', o None si ROS2 no está disponible.

    IMPORTANTE: La detección usa SOLO 'docker exec' o 'nsenter --mount' directo,
    NUNCA 'systemd-run', para evitar crear servicios transitorios fallidos
    que contaminen la lista de systemd.
    """
    # 1. Buscar contenedor Docker corriendo con ROS2
    #    (método preferido — no toca systemd en absoluto)
    code, out, _ = _run("docker ps --format '{{.Names}} {{.Image}}'")
    if code == 0:
        for line in out.splitlines():
            parts = line.strip().split(None, 1)
            if len(parts) < 2:
                continue
            name, image = parts[0], parts[1]
            # Verificar si tiene /opt/ros disponible (sin ejecutar ros2)
            check_cmd = f"docker exec {name} bash -c 'ls /opt/ros/ 2>/dev/null'"
            tc, distro_out, _ = _run(check_cmd, timeout=4)
            if tc != 0:
                continue
            distro = "humble"
            for d in ROS2_DISTROS:
                if d in distro_out:
                    distro = d
                    break
            # Verificar que ros2 binary existe en el contenedor
            verify_cmd = f"docker exec {name} bash -c 'test -f /opt/ros/{distro}/bin/ros2 || ls /opt/ros/{distro}/lib/python*/site-packages/ros2cli 2>/dev/null' 2>/dev/null"
            tv, _, _ = _run(verify_cmd, timeout=4)
            if tv == 0:
                return {
                    "type":      "docker",
                    "container": name,
                    "image":     image,
                    "distro":    distro,
                    "prefix":    f"docker exec {{container}} bash -c 'source /opt/ros/{distro}/setup.bash 2>/dev/null; source /ros2_ws/install/setup.bash 2>/dev/null; {{{{cmd}}}}'",
                    "_container": name,
                }

    # 2. ROS2 instalado en el host — comprobar solo con nsenter --mount directo
    #    SIN systemd-run para no crear servicios transitorios fallidos
    for distro in ROS2_DISTROS:
        setup = f"/opt/ros/{distro}/setup.bash"
        # Solo verificar que el archivo existe en el host filesystem
        test = f"nsenter --target 1 --mount -- bash -c 'test -f {setup}' 2>/dev/null"
        tc, _, _ = _run(test, timeout=5)
        if tc == 0:
            return {
                "type":   "host",
                "distro": distro,
                "prefix": f"nsenter --target 1 --mount -- bash -c 'source /opt/ros/{distro}/setup.bash 2>/dev/null; source /ros2_ws/install/setup.bash 2>/dev/null; {{cmd}}'",
            }

    return None


def _ros2_cmd(method: dict, cmd: str, timeout: int = 10) -> tuple:
    """Ejecutar comando ros2 usando el método detectado."""
    if method["type"] == "docker":
        container = method.get("_container", method.get("container", ""))
        full = method["prefix"].format(container=container, cmd=cmd)
    else:
        full = method["prefix"].format(cmd=cmd)
    return _run(full, timeout=timeout)


def _parse_topic_info(raw: str) -> dict:
    """Parsear output de ros2 topic info."""
    info = {"publishers": 0, "subscribers": 0, "type": ""}
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("Type:"):
            info["type"] = line.split(":", 1)[1].strip()
        elif "Publisher count:" in line:
            try:
                info["publishers"] = int(re.search(r'\d+', line).group())
            except Exception:
                pass
        elif "Subscription count:" in line:
            try:
                info["subscribers"] = int(re.search(r'\d+', line).group())
            except Exception:
                pass
    return info


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/ros2/status")
async def ros2_status():
    """Estado general de ROS2 — siempre responde, nunca lanza error."""
    method = _find_ros2_method()
    if not method:
        return {
            "available": False,
            "reason":    "No ROS2 runtime detected. Start a ROS2 container or install ROS2 on host.",
            "distro":    None,
            "type":      None,
        }

    # ROS2 disponible — contar nodos
    code, out, _ = _ros2_cmd(method, "ros2 node list 2>/dev/null", timeout=8)
    nodes = [n.strip() for n in out.splitlines() if n.strip().startswith("/")]

    code2, out2, _ = _ros2_cmd(method, "ros2 topic list 2>/dev/null", timeout=8)
    topics = [t.strip() for t in out2.splitlines() if t.strip().startswith("/")]

    return {
        "available":  True,
        "distro":     method["distro"],
        "type":       method["type"],
        "container":  method.get("container"),
        "image":      method.get("image"),
        "node_count": len(nodes),
        "topic_count": len(topics),
    }


@router.get("/ros2/nodes")
async def ros2_nodes():
    """Lista de nodos activos con info básica."""
    method = _find_ros2_method()
    if not method:
        return {"available": False, "nodes": []}

    code, out, err = _ros2_cmd(method, "ros2 node list 2>/dev/null", timeout=10)
    node_names = [n.strip() for n in out.splitlines() if n.strip().startswith("/")]

    nodes = []
    for name in node_names:
        # Info básica de cada nodo
        _, info_out, _ = _ros2_cmd(
            method,
            f"ros2 node info {name} 2>/dev/null",
            timeout=6
        )
        publishers  = []
        subscribers = []
        services    = []
        section     = None
        for line in info_out.splitlines():
            stripped = line.strip()
            if "Publishers:" in line:
                section = "pub"
            elif "Subscribers:" in line:
                section = "sub"
            elif "Service Servers:" in line:
                section = "svc"
            elif "Service Clients:" in line:
                section = None
            elif stripped.startswith("/") and section:
                parts = stripped.split(":", 1)
                entry = {"topic": parts[0].strip(), "type": parts[1].strip() if len(parts) > 1 else ""}
                if section == "pub":
                    publishers.append(entry)
                elif section == "sub":
                    subscribers.append(entry)
                elif section == "svc":
                    services.append(entry)

        nodes.append({
            "name":        name,
            "publishers":  publishers,
            "subscribers": subscribers,
            "services":    services,
        })

    return {"available": True, "nodes": nodes}


@router.get("/ros2/topics")
async def ros2_topics():
    """Lista de topics con tipo, publishers y subscribers."""
    method = _find_ros2_method()
    if not method:
        return {"available": False, "topics": []}

    code, out, _ = _ros2_cmd(method, "ros2 topic list -t 2>/dev/null", timeout=10)
    topic_lines = [l.strip() for l in out.splitlines() if l.strip().startswith("/")]

    topics = []
    for line in topic_lines:
        # Formato: /topic/name [msg/Type]
        match = re.match(r'^(/\S+)\s+\[([^\]]+)\]', line)
        if match:
            topic_name = match.group(1)
            topic_type = match.group(2)
        else:
            topic_name = line.split()[0] if line.split() else line
            topic_type = ""

        # Hz (frecuencia) — rápido, 2 segundos máximo
        _, hz_out, _ = _ros2_cmd(
            method,
            f"timeout 2 ros2 topic hz {topic_name} 2>/dev/null | head -3",
            timeout=5
        )
        hz = None
        for hz_line in hz_out.splitlines():
            m = re.search(r'average rate:\s*([\d.]+)', hz_line)
            if m:
                try:
                    hz = round(float(m.group(1)), 2)
                except Exception:
                    pass
                break

        # Info (pub/sub count)
        _, info_out, _ = _ros2_cmd(
            method,
            f"ros2 topic info {topic_name} 2>/dev/null",
            timeout=5
        )
        info = _parse_topic_info(info_out)

        topics.append({
            "name":        topic_name,
            "type":        topic_type or info.get("type", ""),
            "hz":          hz,
            "publishers":  info.get("publishers", 0),
            "subscribers": info.get("subscribers", 0),
        })

    return {"available": True, "topics": topics}


@router.get("/ros2/topics/{topic_path:path}/echo")
async def ros2_topic_echo(topic_path: str):
    """Obtener un mensaje de un topic (1 mensaje, timeout 3s)."""
    topic = "/" + topic_path.lstrip("/")
    # Validar nombre de topic
    if not re.match(r'^/[a-zA-Z0-9_/]+$', topic):
        raise HTTPException(status_code=400, detail="Invalid topic name")

    method = _find_ros2_method()
    if not method:
        raise HTTPException(status_code=503, detail="ROS2 not available")

    _, out, err = _ros2_cmd(
        method,
        f"timeout 3 ros2 topic echo --once {topic} 2>/dev/null",
        timeout=6
    )

    if not out.strip():
        raise HTTPException(status_code=404, detail=f"No messages on {topic}")

    return {"topic": topic, "message": out.strip()}
