"""
GPU Metrics - Universal Jetson
GPU path: /sys/devices/gpu.0/ → symlink a /sys/devices/57000000.gpu/ en Jetson Nano
Fan: /sys/devices/pwm-fan/target_pwm (0-255)
tegrastats: formato Jetson Nano L4T R32.x
"""

import re
import subprocess
import threading
import logging
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class GPUMetricsCollector:
    def __init__(self):
        self._last_tegrastats: Dict[str, Any] = {}
        self._lock = threading.Lock()
        self._tegrastats_path = self._find_tegrastats()
        self._gpu_sys_path = self._find_gpu_sys_path()
        logger.info(f"GPU sys path: {self._gpu_sys_path}")
        logger.info(f"tegrastats: {self._tegrastats_path}")
        if self._tegrastats_path:
            self._start_tegrastats_reader()

    def _find_tegrastats(self) -> Optional[str]:
        for p in ["/usr/bin/tegrastats", "/usr/local/bin/tegrastats"]:
            if Path(p).exists():
                return p
        return None

    def _find_gpu_sys_path(self) -> Optional[Path]:
        """
        Busca el path correcto del GPU en /sys.
        Jetson Nano: /sys/devices/gpu.0 es symlink a /sys/devices/57000000.gpu
        Otros Jetson pueden tener paths distintos.
        """
        candidates = [
            Path("/sys/devices/gpu.0"),
            Path("/sys/devices/57000000.gpu"),
            Path("/sys/devices/platform/57000000.gpu"),
        ]
        # Buscar dinamicamente por patron
        for pattern in [
            "/sys/devices/*.gpu",
            "/sys/devices/platform/*.gpu",
        ]:
            for p in Path("/").glob(pattern.lstrip("/")):
                if p.is_dir() and (p / "load").exists():
                    return p

        for c in candidates:
            if c.exists():
                return c
        return None

    def _start_tegrastats_reader(self):
        t = threading.Thread(target=self._tegrastats_loop, daemon=True)
        t.start()

    def _tegrastats_loop(self):
        try:
            proc = subprocess.Popen(
                [self._tegrastats_path, "--interval", "1000"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in proc.stdout:
                line = line.strip()
                if line:
                    parsed = self._parse_tegrastats(line)
                    with self._lock:
                        self._last_tegrastats = parsed
        except Exception as e:
            logger.error(f"tegrastats loop error: {e}")

    def _parse_tegrastats(self, line: str) -> Dict[str, Any]:
        """
        Formato Jetson Nano (L4T R32.x):
        RAM 733/3964MB (lfb 348x4MB) SWAP 0/2048MB (cached 0MB)
        CPU [1%@1479,0%@1479,0%@1479,0%@1479]
        EMC_FREQ 0% GR3D_FREQ 0%
        PLL@20.5C CPU@22.5C iwlwifi@33C PMIC@50C GPU@20.5C AO@30C thermal@21.75C

        Formato Jetson Orin (L4T R35.x):
        RAM 2000/8192MB ... CPU [5%@1190,2%@1190,...] GR3D_FREQ 10%@318 ...
        """
        result = {}

        # RAM
        m = re.search(r"RAM (\d+)/(\d+)MB", line)
        if m:
            result["ram_used_mb"] = int(m.group(1))
            result["ram_total_mb"] = int(m.group(2))

        # SWAP
        m = re.search(r"SWAP (\d+)/(\d+)MB", line)
        if m:
            result["swap_used_mb"] = int(m.group(1))
            result["swap_total_mb"] = int(m.group(2))

        # CPU cores [1%@1479,0%@1479,...]
        m = re.search(r"CPU \[([^\]]+)\]", line)
        if m:
            cores = []
            for core_str in m.group(1).split(","):
                cm = re.match(r"(\d+)%@(\d+)", core_str.strip())
                if cm:
                    cores.append({"usage": int(cm.group(1)), "freq_mhz": int(cm.group(2))})
            result["cpu_cores"] = cores
            if cores:
                result["cpu_overall"] = round(sum(c["usage"] for c in cores) / len(cores), 1)

        # GR3D (GPU utilization) — puede ser "GR3D_FREQ 0%" o "GR3D_FREQ 10%@318"
        m = re.search(r"GR3D_FREQ\s+(\d+)%(?:@(\d+))?", line)
        if m:
            result["gr3d_percent"] = int(m.group(1))
            if m.group(2):
                result["gr3d_freq_mhz"] = int(m.group(2))

        # EMC
        m = re.search(r"EMC_FREQ\s+(\d+)%", line)
        if m:
            result["emc_percent"] = int(m.group(1))

        # Temperaturas: PLL@20.5C CPU@22.5C GPU@20.5C AO@30C thermal@21.75C
        temps = {}
        for sensor, temp in re.findall(r"(\w+)@([\d.]+)C", line):
            temps[sensor] = float(temp)
        if temps:
            result["temperatures"] = temps

        return result

    async def collect(self) -> Dict[str, Any]:
        with self._lock:
            tdata = dict(self._last_tegrastats)

        # GPU utilization: preferir /sys/devices/gpu.0/load (mas preciso)
        gpu_load = self._read_sysfs_load()
        gpu_freq_mhz = self._read_gpu_freq()
        gpu_temp = tdata.get("temperatures", {}).get("GPU")

        return {
            "utilization_percent": gpu_load if gpu_load is not None else tdata.get("gr3d_percent", 0),
            "freq_mhz": gpu_freq_mhz or tdata.get("gr3d_freq_mhz"),
            "temperature_c": gpu_temp,
            "emc_percent": tdata.get("emc_percent", 0),
            "tegrastats_raw": tdata,
            "power": self._read_power(),
        }

    def _read_sysfs_load(self) -> Optional[int]:
        """GPU load desde /sys/devices/gpu.0/load (0-1000 → 0-100)"""
        if not self._gpu_sys_path:
            return None
        load_file = self._gpu_sys_path / "load"
        if load_file.exists():
            try:
                val = int(load_file.read_text().strip())
                return min(100, val // 10)
            except Exception:
                pass
        return None

    def _read_gpu_freq(self) -> Optional[int]:
        """Frecuencia actual del GPU en MHz"""
        if self._gpu_sys_path:
            # Jetson Nano: /sys/devices/gpu.0/devfreq/57000000.gpu/cur_freq
            for devfreq in (self._gpu_sys_path / "devfreq").glob("*/cur_freq") if (self._gpu_sys_path / "devfreq").exists() else []:
                try:
                    hz = int(devfreq.read_text().strip())
                    return hz // 1_000_000
                except Exception:
                    pass

        # Busqueda generica
        for pattern in [
            "sys/devices/gpu.0/devfreq/*/cur_freq",
            "sys/class/devfreq/*/cur_freq",
        ]:
            for p in Path("/").glob(pattern):
                if "gpu" in str(p).lower() or "57000000" in str(p):
                    try:
                        hz = int(p.read_text().strip())
                        return hz // 1_000_000
                    except Exception:
                        pass
        return None

    def _read_power(self) -> Dict[str, Any]:
        """Leer sensores de potencia INA3221 si existen"""
        power = {}
        try:
            for hwmon in Path("/sys/class/hwmon").iterdir():
                name_f = hwmon / "name"
                if not name_f.exists():
                    continue
                name = name_f.read_text().strip()
                if "ina" not in name.lower():
                    continue
                for pf in sorted(hwmon.glob("power*_input")):
                    try:
                        uw = int(pf.read_text().strip())
                        lf = hwmon / pf.name.replace("_input", "_label")
                        label = lf.read_text().strip() if lf.exists() else pf.stem
                        power[label] = {"microwatts": uw, "watts": round(uw / 1_000_000, 2)}
                    except Exception:
                        pass
        except Exception:
            pass
        return power

    def get_nvpmodel_info(self) -> Dict[str, Any]:
        nvpm = "/usr/sbin/nvpmodel"
        if not Path(nvpm).exists():
            return {"mode": "N/A", "id": -1, "available": False}
        try:
            r = subprocess.run([nvpm, "-q"], capture_output=True, text=True, timeout=5)
            output = r.stdout + r.stderr
            # Buscar linea "NV Power Mode: MAXN"
            mode_match = re.search(r"NV Power Mode:\s*(\S+)", output)
            # Buscar el numero de modo (ultima linea numerica)
            lines = [l.strip() for l in output.strip().splitlines() if l.strip().isdigit()]
            mode_id = int(lines[-1]) if lines else 0
            return {
                "mode": mode_match.group(1) if mode_match else "UNKNOWN",
                "id": mode_id,
                "available": True,
            }
        except Exception as e:
            return {"mode": "N/A", "id": -1, "available": False, "error": str(e)}

    def get_jetson_clocks_status(self) -> Dict[str, Any]:
        jc = "/usr/bin/jetson_clocks"
        if not Path(jc).exists():
            return {"available": False, "enabled": False}
        try:
            r = subprocess.run([jc, "--show"], capture_output=True, text=True, timeout=5)
            output = r.stdout
            # Si todas las frecuencias estan al maximo, clocks esta habilitado
            enabled = "jetson_clocks" in output.lower() or r.returncode == 0
            return {"available": True, "enabled": enabled, "output": output[:500]}
        except Exception as e:
            return {"available": False, "enabled": False, "error": str(e)}
