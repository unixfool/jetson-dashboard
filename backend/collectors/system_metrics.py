"""
System Metrics - Universal Jetson
Fan: /sys/devices/pwm-fan/target_pwm (0-255) + cooling_device7 (pwm-fan, max=10)
Thermals: /sys/class/thermal/thermal_zone* en miligradog → dividir entre 1000
"""

import asyncio
import os
import time
import psutil
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


class SystemMetricsCollector:
    def __init__(self):
        self._prev_net_io = None
        self._prev_net_time = None
        self._prev_disk_io = None
        self._prev_disk_time = None
        psutil.cpu_percent(interval=None, percpu=True)
        self._fan_path = self._find_fan_path()
        logger.info(f"Fan path: {self._fan_path}")

    def _find_fan_path(self) -> Optional[Path]:
        """
        Jetson Nano: /sys/devices/pwm-fan/target_pwm (0-255)
        Otros Jetson: cooling_device con type=pwm-fan
        """
        # Path directo (Jetson Nano)
        direct = Path("/sys/devices/pwm-fan/target_pwm")
        if direct.exists():
            return direct

        # Buscar cooling_device con type pwm-fan
        try:
            for cd in sorted(Path("/sys/class/thermal").glob("cooling_device*")):
                type_f = cd / "type"
                if type_f.exists() and "fan" in type_f.read_text().strip().lower():
                    cur_f = cd / "cur_state"
                    if cur_f.exists():
                        return cur_f
        except Exception:
            pass

        # hwmon pwm
        try:
            for pwm_f in Path("/sys/class/hwmon").glob("*/pwm1"):
                return pwm_f
        except Exception:
            pass

        return None

    async def collect_all(self) -> Dict[str, Any]:
        loop = asyncio.get_event_loop()
        results = await asyncio.gather(
            loop.run_in_executor(None, self.get_cpu_metrics),
            loop.run_in_executor(None, self.get_memory_metrics),
            loop.run_in_executor(None, self.get_storage_metrics),
            loop.run_in_executor(None, self.get_network_metrics),
            loop.run_in_executor(None, self.get_thermal_metrics),
            loop.run_in_executor(None, self.get_system_info),
            return_exceptions=True,
        )
        keys = ["cpu", "memory", "storage", "network", "thermals", "system"]
        return {k: (v if not isinstance(v, Exception) else {"error": str(v)})
                for k, v in zip(keys, results)}

    def get_cpu_metrics(self) -> Dict[str, Any]:
        try:
            per_core = psutil.cpu_percent(interval=None, percpu=True)
            overall = round(sum(per_core) / len(per_core), 1) if per_core else 0.0
            load_avg = list(os.getloadavg())
            return {
                "usage_percent": overall,
                "per_core_usage": [round(u, 1) for u in per_core],
                "per_core_freq": self._read_cpu_frequencies(),
                "load_avg": {
                    "1min": round(load_avg[0], 2),
                    "5min": round(load_avg[1], 2),
                    "15min": round(load_avg[2], 2),
                },
                "logical_cores": psutil.cpu_count(logical=True),
                "physical_cores": psutil.cpu_count(logical=False),
                "architecture": "ARM64",
            }
        except Exception as e:
            return {"error": str(e)}

    def _read_cpu_frequencies(self) -> List[Dict]:
        freqs = []
        try:
            for cpu_dir in sorted(Path("/sys/devices/system/cpu").glob("cpu[0-9]*")):
                cur_f = cpu_dir / "cpufreq/scaling_cur_freq"
                max_f = cpu_dir / "cpufreq/scaling_max_freq"
                min_f = cpu_dir / "cpufreq/scaling_min_freq"
                if cur_f.exists():
                    try:
                        freqs.append({
                            "current": int(cur_f.read_text().strip()) // 1000,
                            "min": int(min_f.read_text().strip()) // 1000 if min_f.exists() else 0,
                            "max": int(max_f.read_text().strip()) // 1000 if max_f.exists() else 0,
                        })
                    except Exception:
                        pass
        except Exception:
            pass
        return freqs

    def get_memory_metrics(self) -> Dict[str, Any]:
        try:
            vm = psutil.virtual_memory()
            sw = psutil.swap_memory()
            return {
                "total": vm.total,
                "available": vm.available,
                "used": vm.used,
                "free": vm.free,
                "percent": round(vm.percent, 1),
                "buffers": getattr(vm, "buffers", 0),
                "cached": getattr(vm, "cached", 0),
                "swap": {
                    "total": sw.total,
                    "used": sw.used,
                    "free": sw.free,
                    "percent": round(sw.percent, 1),
                },
            }
        except Exception as e:
            return {"error": str(e)}

    # Tipos de filesystem a ignorar completamente
    _EXCLUDE_FSTYPES = {
        "", "tmpfs", "devtmpfs", "squashfs", "overlay", "proc",
        "sysfs", "cgroup", "cgroup2", "pstore", "debugfs", "securityfs",
        "configfs", "fusectl", "mqueue", "hugetlbfs", "nsfs", "ramfs",
        "devpts", "autofs", "binfmt_misc",
    }

    # Prefijos de device a ignorar (zram=swap RAM, loop=snaps/squashfs)
    _EXCLUDE_DEVICE_PREFIXES = (
        "/dev/zram",
        "/dev/loop",
        "tmpfs", "overlay", "shm", "none",
    )

    def get_storage_metrics(self) -> Dict[str, Any]:
        try:
            partitions = []

            # Estrategia robusta para contenedor Docker con bind-mounts:
            # 1. Leer /proc/mounts para encontrar el device real de "/"
            # 2. Si "/" no aparece (overlay), buscar el device de cualquier
            #    bind-mount conocido del host (/etc, /app/data, etc.)
            # 3. Calcular disk_usage desde cualquier mountpoint del mismo device
            # 4. Mostrar siempre como mountpoint "/" con el device real

            # Leer /proc/mounts completo
            proc_mounts = []
            try:
                with open("/proc/mounts") as f:
                    for line in f:
                        parts_m = line.split()
                        if len(parts_m) >= 3:
                            proc_mounts.append({
                                "device": parts_m[0],
                                "mp":     parts_m[1],
                                "fstype": parts_m[2],
                            })
            except Exception:
                pass

            # Buscar discos físicos reales: device que empiece por /dev/
            # y no sea loop, zram, tmpfs, overlay
            real_devices = {}  # device → {mp, fstype}
            for m in proc_mounts:
                dev = m["device"]
                mp  = m["mp"]
                fst = m["fstype"]
                if not dev.startswith("/dev/"):
                    continue
                if any(dev.startswith(pfx) for pfx in self._EXCLUDE_DEVICE_PREFIXES):
                    continue
                if fst in self._EXCLUDE_FSTYPES:
                    continue
                # Para cada device físico, preferir el mountpoint más corto
                if dev not in real_devices or len(mp) < len(real_devices[dev]["mp"]):
                    real_devices[dev] = {"mp": mp, "fstype": fst}

            if real_devices:
                for dev, info in sorted(real_devices.items()):
                    try:
                        u = psutil.disk_usage(info["mp"])
                        if u.total == 0:
                            continue
                        partitions.append({
                            "device":     dev,
                            "mountpoint": "/",  # siempre mostrar como raíz
                            "fstype":     info["fstype"],
                            "total":      u.total,
                            "used":       u.used,
                            "free":       u.free,
                            "percent":    round(u.percent, 1),
                        })
                    except (PermissionError, OSError):
                        continue
            else:
                # Fallback absoluto: disk_usage("/") directamente
                try:
                    u = psutil.disk_usage("/")
                    partitions.append({
                        "device": "disk", "mountpoint": "/",
                        "fstype": "ext4", "total": u.total,
                        "used": u.used, "free": u.free,
                        "percent": round(u.percent, 1),
                    })
                except Exception:
                    pass

            io_counters = {}
            try:
                disk_io = psutil.disk_io_counters(perdisk=True)
                now = time.time()
                if self._prev_disk_io and self._prev_disk_time:
                    elapsed = now - self._prev_disk_time
                    for disk, c in disk_io.items():
                        prev = self._prev_disk_io.get(disk)
                        if prev and elapsed > 0:
                            io_counters[disk] = {
                                "read_bytes_sec": round((c.read_bytes - prev.read_bytes) / elapsed, 1),
                                "write_bytes_sec": round((c.write_bytes - prev.write_bytes) / elapsed, 1),
                            }
                self._prev_disk_io = disk_io
                self._prev_disk_time = now
            except Exception:
                pass

            return {"partitions": partitions, "io": io_counters}
        except Exception as e:
            return {"error": str(e)}

    def get_network_metrics(self) -> Dict[str, Any]:
        try:
            net_io = psutil.net_io_counters(pernic=True)
            net_addrs = psutil.net_if_addrs()
            net_stats = psutil.net_if_stats()
            now = time.time()
            interfaces = {}

            for iface, c in net_io.items():
                if iface == "lo":
                    continue
                ipv4 = next(
                    (a.address for a in net_addrs.get(iface, []) if a.family.name == "AF_INET"),
                    None
                )
                stats = net_stats.get(iface)
                rx_rate = tx_rate = 0.0
                if self._prev_net_io and self._prev_net_time:
                    elapsed = now - self._prev_net_time
                    prev = self._prev_net_io.get(iface)
                    if prev and elapsed > 0:
                        rx_rate = max(0.0, (c.bytes_recv - prev.bytes_recv) / elapsed)
                        tx_rate = max(0.0, (c.bytes_sent - prev.bytes_sent) / elapsed)

                interfaces[iface] = {
                    "ip": ipv4,
                    "bytes_sent": c.bytes_sent,
                    "bytes_recv": c.bytes_recv,
                    "packets_sent": c.packets_sent,
                    "packets_recv": c.packets_recv,
                    "rx_bytes_sec": round(rx_rate, 1),
                    "tx_bytes_sec": round(tx_rate, 1),
                    "is_up": stats.isup if stats else False,
                    "speed": stats.speed if stats else 0,
                }

            self._prev_net_io = net_io
            self._prev_net_time = now
            # Identificar la interfaz primaria (UP con IP y mayor tráfico)
            primary = None
            best_score = -1
            for iface_name, iface_data in interfaces.items():
                if not iface_data.get("is_up"):
                    continue
                if not iface_data.get("ip"):
                    continue
                # Score: preferir wlan/eth con tráfico real
                score = iface_data["bytes_recv"] + iface_data["bytes_sent"]
                if iface_name.startswith(("lo", "docker", "br-", "dummy", "veth")):
                    score = score // 100  # penalizar interfaces virtuales
                if score > best_score:
                    best_score = score
                    primary = iface_name

            return {"interfaces": interfaces, "primary_interface": primary}
        except Exception as e:
            return {"error": str(e)}

    def get_thermal_metrics(self) -> Dict[str, Any]:
        """
        Jetson Nano tiene 7 zonas termicas (thermal_zone0..6).
        Temperaturas en miligrados → dividir entre 1000.
        """
        sensors = {}
        try:
            for zone in sorted(Path("/sys/class/thermal").glob("thermal_zone*")):
                temp_f = zone / "temp"
                type_f = zone / "type"
                if not temp_f.exists():
                    continue
                try:
                    raw = int(temp_f.read_text().strip())
                    temp_c = round(raw / 1000.0, 1)
                    zone_type = type_f.read_text().strip() if type_f.exists() else zone.name
                    # Limpiar nombres para display
                    display = (zone_type
                               .replace("-therm", "")
                               .replace("-Die", "")
                               .replace("-therm", ""))
                    sensors[display] = {
                        "zone": zone.name,
                        "type": display,
                        "temp_c": temp_c,
                    }
                except Exception:
                    continue
        except Exception:
            pass

        fan = self._read_fan()
        return {
            "sensors": sensors,
            "fan": fan,
            # Compatibilidad hacia atras
            "fan_speed": fan.get("percent"),
            "fan_state": fan.get("state"),
            "fan_max": fan.get("max"),
        }

    def _read_fan(self) -> Dict[str, Any]:
        """
        Jetson Nano fan:
        - /sys/devices/pwm-fan/target_pwm  → escritura (0-255)
        - /sys/devices/pwm-fan/cur_pwm     → lectura del PWM actual
        - /sys/devices/pwm-fan/rpm_measured → RPM medidos (puede ser 0 en idle)
        - cooling_device7 type=pwm-fan, max=10 → estado termico
        """
        result = {
            "available": False,
            "pwm_path": None,
            "cur_pwm": None,
            "target_pwm": None,
            "rpm": None,
            "state": None,
            "max": None,
            "percent": None,
            "passive_cooling": False,
        }

        # Path directo pwm-fan (Jetson Nano)
        pwm_dir = Path("/sys/devices/pwm-fan")
        if pwm_dir.exists():
            result["available"] = True
            result["pwm_path"] = str(pwm_dir / "target_pwm")

            try:
                cur_pwm_f = pwm_dir / "cur_pwm"
                if cur_pwm_f.exists():
                    result["cur_pwm"] = int(cur_pwm_f.read_text().strip())
                    result["percent"] = round(result["cur_pwm"] / 255 * 100)
            except Exception:
                pass

            try:
                target_f = pwm_dir / "target_pwm"
                if target_f.exists():
                    result["target_pwm"] = int(target_f.read_text().strip())
                    if result["percent"] is None:
                        result["percent"] = round(result["target_pwm"] / 255 * 100)
            except Exception:
                pass

            try:
                rpm_f = pwm_dir / "rpm_measured"
                if rpm_f.exists():
                    result["rpm"] = int(rpm_f.read_text().strip())
            except Exception:
                pass

        # cooling_device con type=pwm-fan para estado termico
        try:
            for cd in sorted(Path("/sys/class/thermal").glob("cooling_device*")):
                type_f = cd / "type"
                if not type_f.exists():
                    continue
                if type_f.read_text().strip().lower() == "pwm-fan":
                    cur_f = cd / "cur_state"
                    max_f = cd / "max_state"
                    if cur_f.exists():
                        result["state"] = int(cur_f.read_text().strip())
                        result["max"] = int(max_f.read_text().strip()) if max_f.exists() else 10
                        result["available"] = True
                        break
        except Exception:
            pass

        # Si PWM=0 y RPM=0 → enfriamiento pasivo (normal en idle)
        if result["cur_pwm"] == 0 and (result["rpm"] == 0 or result["rpm"] is None):
            result["passive_cooling"] = True

        return result

    def get_system_info(self) -> Dict[str, Any]:
        try:
            uname = os.uname()
            uptime = int(time.time() - psutil.boot_time())
            os_name = "Linux"

            # Detectar OS del HOST, no del contenedor Docker.
            # El contenedor usa imagen Debian, pero el host es Ubuntu.
            # Estrategia en orden de prioridad:
            #
            # 1. /var/lib/dpkg/info/base-files.list — bind-montado desde el host,
            #    contiene la lista de archivos del paquete base-files del HOST.
            #    Buscamos ubuntu-advantage, ubuntu-minimal u otras señales Ubuntu.
            #
            # 2. /proc/version_signature — presente en Ubuntu (no en Debian)
            #
            # 3. Leer /etc/os-release del host via un bind-mount conocido:
            #    El directorio /var/lib/dpkg está bind-montado desde el host.
            #    Podemos leer /var/lib/dpkg/../../../etc/os-release → no funciona por chroot.
            #    En su lugar, buscamos archivos Ubuntu en /var/lib/dpkg/info/
            #
            # 4. /proc/version siempre es del kernel host → extraer info de ahí

            # El contenedor usa imagen Debian pero el host es Ubuntu.
            # /etc/os-release dentro del contenedor siempre muestra Debian
            # porque Docker NO sobrescribe archivos individuales con bind-mounts.
            #
            # Detección fiable:
            # 1. /var/lib/dpkg/info/ está bind-montado desde el host Ubuntu.
            #    Si hay archivos ubuntu-*.list → host es Ubuntu.
            #    Leer ubuntu-minimal.list para obtener la versión exacta.
            # 2. Fallback: "Ubuntu 24.04 LTS" si confirmamos Ubuntu sin versión.
            # 3. /proc/version para info del kernel (siempre del host).

            # Paso 1: buscar paquetes Ubuntu en dpkg del host
            host_distro = None
            try:
                dpkg_info = Path("/var/lib/dpkg/info")
                # ubuntu-minimal.list existe en todo Ubuntu
                minimal = dpkg_info / "ubuntu-minimal.list"
                if minimal.exists():
                    # Tenemos Ubuntu — ahora buscar la versión en lsb-release
                    lsb = Path("/var/lib/dpkg/info/lsb-release.list")
                    # Intentar leer /etc/lsb-release (Ubuntu específico, no existe en Debian)
                    # No está bind-montado, pero podemos buscar en dpkg
                    # Buscar ubuntu-release-upgrader para confirmar versión
                    for candidate in [
                        "/var/lib/dpkg/info/base-files.conffiles",
                        "/var/lib/dpkg/info/base-files.list",
                    ]:
                        try:
                            txt = Path(candidate).read_text(errors='ignore').lower()
                            if "24.04" in txt or "noble" in txt:
                                host_distro = "Ubuntu 24.04 LTS"
                                break
                            elif "22.04" in txt or "jammy" in txt:
                                host_distro = "Ubuntu 22.04 LTS"
                                break
                            elif "20.04" in txt or "focal" in txt:
                                host_distro = "Ubuntu 20.04 LTS"
                                break
                        except Exception:
                            pass
                    if not host_distro:
                        host_distro = "Ubuntu Linux"  # Ubuntu confirmado, versión desconocida
            except Exception:
                pass

            # Paso 2: leer os-release del contenedor como base
            try:
                content = Path("/etc/os-release").read_text()
                for line in content.splitlines():
                    if line.startswith("PRETTY_NAME="):
                        os_name = line.split("=", 1)[1].strip().strip('"')
                        break
            except Exception:
                pass

            # Paso 3: si detectamos Ubuntu via dpkg, usar ese valor
            if host_distro:
                os_name = host_distro

            return {
                "hostname": uname.nodename,
                "kernel": uname.release,
                "os": os_name,
                "arch": uname.machine,
                "uptime_seconds": uptime,
                "uptime_str": self._fmt_uptime(uptime),
                "boot_time": psutil.boot_time(),
            }
        except Exception as e:
            return {"error": str(e)}

    def _fmt_uptime(self, s: int) -> str:
        d, r = divmod(s, 86400)
        h, r = divmod(r, 3600)
        m = r // 60
        if d > 0: return f"{d}d {h}h {m}m"
        if h > 0: return f"{h}h {m}m"
        return f"{m}m"
