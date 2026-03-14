"""
Process Manager - System process monitoring and control
"""

import logging
import signal
import psutil
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


class ProcessManager:
    def get_processes(
        self,
        sort_by: str = "cpu_percent",
        limit: int = 50,
        filter_str: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get list of processes with resource usage"""
        processes = []

        # First pass - collect all, trigger cpu_percent measurement
        procs = list(psutil.process_iter([
            "pid", "name", "username", "status",
            "cpu_percent", "memory_percent", "memory_info",
            "cmdline", "create_time", "num_threads",
        ]))

        for proc in procs:
            try:
                info = proc.info
                if info["pid"] == 0:
                    continue

                name = info.get("name", "")
                if filter_str and filter_str.lower() not in name.lower():
                    continue

                mem_info = info.get("memory_info") or psutil._common.pmem(0, 0)
                processes.append({
                    "pid": info["pid"],
                    "name": name,
                    "username": info.get("username", ""),
                    "status": info.get("status", ""),
                    "cpu_percent": round(info.get("cpu_percent") or 0, 1),
                    "memory_percent": round(info.get("memory_percent") or 0, 2),
                    "memory_rss": getattr(mem_info, "rss", 0),
                    "memory_vms": getattr(mem_info, "vms", 0),
                    "num_threads": info.get("num_threads", 1),
                    "cmdline": " ".join(info.get("cmdline") or [])[:200],
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        # Sort
        sort_map = {
            "cpu_percent": lambda p: p["cpu_percent"],
            "memory_percent": lambda p: p["memory_percent"],
            "pid": lambda p: p["pid"],
            "name": lambda p: p["name"].lower(),
        }
        sort_func = sort_map.get(sort_by, sort_map["cpu_percent"])
        processes.sort(key=sort_func, reverse=(sort_by != "name"))

        return processes[:limit]

    def kill_process(self, pid: int, force: bool = False) -> Dict[str, Any]:
        """Kill a process by PID.
        Estrategia en orden:
        1. psutil directo (procesos del contenedor o con permisos)
        2. nsenter + kill directo al PID del host (sin systemd-run)
        3. nsenter + pkill -f por nombre (para procesos kernel como vi-output)
        """
        import subprocess as sp
        sig_name = "SIGKILL" if force else "SIGTERM"
        sig_flag = "-9" if force else "-15"

        # 1. Intentar con psutil
        proc_name = f"pid-{pid}"
        try:
            proc = psutil.Process(pid)
            proc_name = proc.name()
            if force:
                proc.kill()
            else:
                proc.terminate()
            logger.info(f"Killed {proc_name} ({pid}) via psutil signal={sig_name}")
            return {"success": True, "pid": pid, "name": proc_name, "signal": sig_name}
        except psutil.NoSuchProcess:
            pass
        except psutil.AccessDenied:
            pass
        except Exception as e:
            logger.debug(f"psutil kill failed: {e}")

        # Obtener nombre del proceso para fallback pkill
        try:
            name_result = sp.run(
                ["/bin/bash", "-c", f"nsenter --target 1 --mount -- cat /proc/{pid}/comm 2>/dev/null"],
                capture_output=True, timeout=3
            )
            if name_result.returncode == 0:
                proc_name = name_result.stdout.decode().strip() or proc_name
        except Exception:
            pass

        # 2. nsenter + kill directo al PID (sin systemd-run — más fiable en kernel 4.9)
        try:
            cmd = f"nsenter --target 1 --mount --pid -- kill {sig_flag} {pid} 2>/dev/null"
            result = sp.run(["/bin/bash", "-c", cmd], capture_output=True, timeout=5)
            if result.returncode == 0:
                logger.info(f"Killed {proc_name} ({pid}) via nsenter+kill signal={sig_name}")
                return {"success": True, "pid": pid, "name": proc_name, "signal": sig_name}
        except Exception as e:
            logger.debug(f"nsenter+kill failed: {e}")

        # 3. nsenter + pkill -f por nombre (para procesos kernel y vi-output)
        if proc_name and proc_name != f"pid-{pid}":
            try:
                pkill_sig = "-9" if force else "-15"
                cmd = f"nsenter --target 1 --mount -- pkill {pkill_sig} -x {proc_name} 2>/dev/null"
                result = sp.run(["/bin/bash", "-c", cmd], capture_output=True, timeout=5)
                if result.returncode == 0:
                    logger.info(f"Killed {proc_name} via nsenter+pkill signal={sig_name}")
                    return {"success": True, "pid": pid, "name": proc_name, "signal": sig_name}
            except Exception as e:
                logger.debug(f"nsenter+pkill failed: {e}")

        # Verificar si el proceso ya no existe (puede haber muerto entre intentos)
        try:
            check = sp.run(
                ["/bin/bash", "-c", f"nsenter --target 1 --mount -- test -d /proc/{pid}"],
                capture_output=True, timeout=3
            )
            if check.returncode != 0:
                logger.info(f"Process {pid} no longer exists — considering success")
                return {"success": True, "pid": pid, "name": proc_name, "signal": sig_name}
        except Exception:
            pass

        return {"success": False, "error": f"Could not kill {proc_name} (PID {pid}) — try SIGKILL or check permissions"}

    def get_process_detail(self, pid: int) -> Optional[Dict[str, Any]]:
        """Get detailed info about a specific process"""
        try:
            proc = psutil.Process(pid)
            with proc.oneshot():
                return {
                    "pid": pid,
                    "name": proc.name(),
                    "exe": proc.exe(),
                    "cmdline": proc.cmdline(),
                    "status": proc.status(),
                    "username": proc.username(),
                    "create_time": proc.create_time(),
                    "cpu_percent": proc.cpu_percent(interval=0.1),
                    "cpu_affinity": proc.cpu_affinity(),
                    "memory_percent": proc.memory_percent(),
                    "memory_info": proc.memory_info()._asdict(),
                    "num_threads": proc.num_threads(),
                    "num_fds": proc.num_fds(),
                    "connections": [c._asdict() for c in proc.connections()],
                    "open_files": [f.path for f in proc.open_files()[:20]],
                }
        except psutil.NoSuchProcess:
            return None
        except Exception as e:
            logger.error(f"Error getting process detail: {e}")
            return None
