"""
Docker Manager - Interface with Docker Engine API
Provides container lifecycle management and stats
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional, AsyncGenerator

import docker
from docker.errors import DockerException, NotFound, APIError

logger = logging.getLogger(__name__)


class DockerManager:
    def __init__(self):
        self._client = None
        self._async_client = None
        self._available = False
        self._init_client()

    def _init_client(self):
        try:
            self._client = docker.from_env()
            self._client.ping()
            self._available = True
            logger.info("Docker client initialized successfully")
        except Exception as e:
            logger.warning(f"Docker not available: {e}")
            self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def list_containers(self, all_containers: bool = True) -> List[Dict[str, Any]]:
        """List all containers with details"""
        if not self._available:
            return []
        try:
            containers = self._client.containers.list(all=all_containers)
            result = []
            for c in containers:
                ports = {}
                if c.ports:
                    for container_port, host_bindings in c.ports.items():
                        if host_bindings:
                            ports[container_port] = [
                                f"{b['HostIp']}:{b['HostPort']}"
                                for b in host_bindings
                            ]
                result.append({
                    "id": c.short_id,
                    "full_id": c.id,
                    "name": c.name,
                    "image": c.image.tags[0] if c.image.tags else c.image.short_id,
                    "status": c.status,
                    "state": c.attrs.get("State", {}).get("Status", "unknown"),
                    "created": c.attrs.get("Created", ""),
                    "ports": ports,
                    "labels": c.labels,
                })
            return result
        except Exception as e:
            logger.error(f"Error listing containers: {e}")
            return []

    def get_container_stats(self, container_id: str) -> Optional[Dict[str, Any]]:
        """Get resource usage stats for a container"""
        if not self._available:
            return None
        try:
            container = self._client.containers.get(container_id)
            if container.status != "running":
                return {"status": container.status, "cpu_percent": 0, "memory_percent": 0}

            stats = container.stats(stream=False)

            # CPU calculation
            cpu_delta = (
                stats["cpu_stats"]["cpu_usage"]["total_usage"]
                - stats["precpu_stats"]["cpu_usage"]["total_usage"]
            )
            system_delta = (
                stats["cpu_stats"]["system_cpu_usage"]
                - stats["precpu_stats"]["system_cpu_usage"]
            )
            num_cpus = stats["cpu_stats"].get("online_cpus", 1)
            cpu_percent = (cpu_delta / system_delta) * num_cpus * 100.0 if system_delta > 0 else 0

            # Memory
            mem_stats = stats.get("memory_stats", {})
            mem_usage = mem_stats.get("usage", 0)
            mem_limit = mem_stats.get("limit", 1)
            mem_percent = (mem_usage / mem_limit) * 100 if mem_limit > 0 else 0

            # Network
            net_io = stats.get("networks", {})
            total_rx = sum(v.get("rx_bytes", 0) for v in net_io.values())
            total_tx = sum(v.get("tx_bytes", 0) for v in net_io.values())

            return {
                "status": container.status,
                "cpu_percent": round(cpu_percent, 2),
                "memory_usage": mem_usage,
                "memory_limit": mem_limit,
                "memory_percent": round(mem_percent, 2),
                "net_rx_bytes": total_rx,
                "net_tx_bytes": total_tx,
            }
        except NotFound:
            return None
        except Exception as e:
            logger.error(f"Error getting container stats: {e}")
            return None

    def start_container(self, container_id: str) -> Dict[str, Any]:
        if not self._available:
            return {"success": False, "error": "Docker not available"}
        try:
            container = self._client.containers.get(container_id)
            container.start()
            return {"success": True, "status": "started", "id": container_id}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def stop_container(self, container_id: str, timeout: int = 10) -> Dict[str, Any]:
        if not self._available:
            return {"success": False, "error": "Docker not available"}
        try:
            container = self._client.containers.get(container_id)
            container.stop(timeout=timeout)
            return {"success": True, "status": "stopped", "id": container_id}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def restart_container(self, container_id: str) -> Dict[str, Any]:
        if not self._available:
            return {"success": False, "error": "Docker not available"}
        try:
            container = self._client.containers.get(container_id)
            container.restart()
            return {"success": True, "status": "restarted", "id": container_id}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_container_logs(
        self,
        container_id: str,
        tail: int = 100,
        since: Optional[int] = None,
    ) -> List[str]:
        if not self._available:
            return []
        try:
            container = self._client.containers.get(container_id)
            kwargs = {"tail": tail, "timestamps": True}
            if since:
                kwargs["since"] = since
            logs = container.logs(**kwargs)
            return logs.decode("utf-8", errors="replace").splitlines()
        except Exception as e:
            logger.error(f"Error getting logs: {e}")
            return []

    async def stream_container_logs(
        self, container_id: str, tail: int = 50
    ) -> AsyncGenerator[str, None]:
        """Stream container logs as async generator"""
        if not self._available:
            return
        loop = asyncio.get_event_loop()
        try:
            container = await loop.run_in_executor(
                None, self._client.containers.get, container_id
            )
            logs = await loop.run_in_executor(
                None,
                lambda: container.logs(stream=True, follow=True, tail=tail, timestamps=True),
            )
            for chunk in logs:
                if chunk:
                    yield chunk.decode("utf-8", errors="replace").rstrip()
                    await asyncio.sleep(0)  # Yield control
        except Exception as e:
            logger.error(f"Log stream error: {e}")
            yield f"Error: {str(e)}"

    def get_system_info(self) -> Dict[str, Any]:
        """Get Docker system information"""
        if not self._available:
            return {"available": False}
        try:
            info = self._client.info()
            return {
                "available": True,
                "version": self._client.version().get("Version", "unknown"),
                "containers": info.get("Containers", 0),
                "containers_running": info.get("ContainersRunning", 0),
                "containers_paused": info.get("ContainersPaused", 0),
                "containers_stopped": info.get("ContainersStopped", 0),
                "images": info.get("Images", 0),
                "memory_total": info.get("MemTotal", 0),
                "ncpu": info.get("NCPU", 0),
                "storage_driver": info.get("Driver", "unknown"),
            }
        except Exception as e:
            return {"available": False, "error": str(e)}
