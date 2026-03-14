"""
API Routes - REST API endpoints for the Jetson Dashboard
"""

import asyncio
import logging
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from collectors.system_metrics import SystemMetricsCollector
from collectors.gpu_metrics import GPUMetricsCollector
from collectors.hardware_detector import HardwareDetector
from services.docker_manager import DockerManager
from services.process_manager import ProcessManager
from services.hardware_control import HardwareControlService

logger = logging.getLogger(__name__)
router = APIRouter()

# Singleton instances
_system_collector = SystemMetricsCollector()
_gpu_collector = GPUMetricsCollector()
_docker_manager = DockerManager()
_process_manager = ProcessManager()
_detector = HardwareDetector()
_hw_info = _detector.detect()
_hw_controller = HardwareControlService()


# ─── Models ──────────────────────────────────────────────────────────────────

class PowerModeRequest(BaseModel):
    mode_id: int

class FanSpeedRequest(BaseModel):
    speed: int  # 0-100

class DockerActionRequest(BaseModel):
    container_id: str

class ProcessKillRequest(BaseModel):
    pid: int
    force: bool = False


# ─── System ──────────────────────────────────────────────────────────────────

@router.get("/system")
async def get_system():
    """Full system snapshot"""
    broadcaster = None
    try:
        from fastapi import Request
    except Exception:
        pass
    loop = asyncio.get_event_loop()
    metrics = await _system_collector.collect_all()
    return {"hardware": _hw_info, **metrics}


@router.get("/hardware")
async def get_hardware():
    """Hardware information"""
    return _hw_info


@router.get("/cpu")
async def get_cpu():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _system_collector.get_cpu_metrics)


@router.get("/memory")
async def get_memory():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _system_collector.get_memory_metrics)


@router.get("/storage")
async def get_storage():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _system_collector.get_storage_metrics)


@router.get("/network")
async def get_network():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _system_collector.get_network_metrics)


@router.get("/thermals")
async def get_thermals():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _system_collector.get_thermal_metrics)


@router.get("/gpu")
async def get_gpu():
    metrics = await _gpu_collector.collect()
    metrics["power"] = await asyncio.get_event_loop().run_in_executor(
        None, _gpu_collector.get_power_metrics
    )
    metrics["nvpmodel"] = await asyncio.get_event_loop().run_in_executor(
        None, _gpu_collector.get_nvpmodel_info
    )
    return metrics


@router.get("/metrics/latest")
async def get_latest_metrics(request: Request):
    """Get latest cached metrics snapshot"""
    broadcaster = request.app.state.broadcaster
    latest = broadcaster.get_latest()
    if not latest:
        return await get_system()
    return latest


# ─── Processes ────────────────────────────────────────────────────────────────

@router.get("/processes")
async def get_processes(
    sort_by: str = Query("cpu_percent", regex="^(cpu_percent|memory_percent|pid|name)$"),
    limit: int = Query(50, ge=1, le=200),
    filter: Optional[str] = Query(None),
):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _process_manager.get_processes, sort_by, limit, filter
    )


@router.post("/processes/kill")
async def kill_process(req: ProcessKillRequest):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _process_manager.kill_process, req.pid, req.force
    )
    # Devolver siempre 200 con {success, error} — el frontend maneja el error
    return result


@router.get("/processes/{pid}")
async def get_process_detail(pid: int):
    loop = asyncio.get_event_loop()
    detail = await loop.run_in_executor(
        None, _process_manager.get_process_detail, pid
    )
    if not detail:
        raise HTTPException(status_code=404, detail="Process not found")
    return detail


# ─── Docker ───────────────────────────────────────────────────────────────────

@router.get("/docker")
async def get_docker_info():
    loop = asyncio.get_event_loop()
    info = await loop.run_in_executor(None, _docker_manager.get_system_info)
    containers = await loop.run_in_executor(None, _docker_manager.list_containers)
    return {"info": info, "containers": containers}


@router.get("/docker/containers")
async def list_containers(all: bool = True):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _docker_manager.list_containers, all)


@router.get("/docker/containers/{container_id}/stats")
async def get_container_stats(container_id: str):
    loop = asyncio.get_event_loop()
    stats = await loop.run_in_executor(
        None, _docker_manager.get_container_stats, container_id
    )
    if not stats:
        raise HTTPException(status_code=404, detail="Container not found")
    return stats


@router.get("/docker/containers/{container_id}/logs")
async def get_container_logs(container_id: str, tail: int = 100):
    loop = asyncio.get_event_loop()
    logs = await loop.run_in_executor(
        None, _docker_manager.get_container_logs, container_id, tail
    )
    return {"logs": logs}


@router.post("/docker/containers/{container_id}/start")
async def start_container(container_id: str):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _docker_manager.start_container, container_id
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/docker/containers/{container_id}/stop")
async def stop_container(container_id: str):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _docker_manager.stop_container, container_id
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/docker/containers/{container_id}/restart")
async def restart_container(container_id: str):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _docker_manager.restart_container, container_id
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ─── Settings ────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings():
    """Obtener configuracion persistente actual"""
    return _hw_controller.get_settings()


@router.get("/hardware/fan")
async def get_fan():
    """Obtener estado actual del fan"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _hw_controller.get_fan_info)


# ─── Hardware Control ────────────────────────────────────────────────────────

@router.get("/hardware/power-modes")
async def get_power_modes():
    return _hw_controller.get_power_modes()


@router.get("/hardware/power-mode")
async def get_current_power_mode():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _hw_controller.get_current_power_mode)


@router.post("/hardware/power-mode")
async def set_power_mode(req: PowerModeRequest):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _hw_controller.set_power_mode, req.mode_id
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.get("/hardware/jetson-clocks")
async def get_jetson_clocks():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _hw_controller.get_jetson_clocks_status)


@router.post("/hardware/jetson-clocks/enable")
async def enable_jetson_clocks():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _hw_controller.enable_jetson_clocks)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/hardware/jetson-clocks/disable")
async def disable_jetson_clocks():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _hw_controller.disable_jetson_clocks)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/hardware/fan")
async def set_fan_speed(req: FanSpeedRequest):
    if not 0 <= req.speed <= 100:
        raise HTTPException(status_code=400, detail="Speed must be 0-100")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _hw_controller.set_fan_speed, req.speed
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ─── System Control ───────────────────────────────────────────────────────────

@router.post("/system/reboot")
async def reboot():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _hw_controller.reboot)


@router.post("/system/shutdown")
async def shutdown():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _hw_controller.shutdown)


# ─── Logs ─────────────────────────────────────────────────────────────────────

@router.get("/logs/system")
async def get_system_logs(lines: int = 100):
    """Get system journal logs"""
    try:
        result = subprocess.run(
            ["journalctl", "-n", str(lines), "--no-pager", "-o", "json-pretty"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return {"logs": result.stdout.splitlines(), "source": "journald"}
    except Exception:
        # Fallback to syslog
        try:
            with open("/var/log/syslog") as f:
                lines_data = f.readlines()[-lines:]
            return {"logs": [l.rstrip() for l in lines_data], "source": "syslog"}
        except Exception as e:
            return {"logs": [], "error": str(e)}
