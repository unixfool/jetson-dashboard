"""
Hardware Detector - Universal para todos los modelos Jetson y versiones JetPack.
Compatible con:
  - JetPack oficial (Ubuntu 18/20)
  - Instalaciones personalizadas (Ubuntu 24 + L4T manual)
  - Cualquier configuracion intermedia
"""

import os
import re
import subprocess
import logging
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

JETSON_MODELS = {
    "jetson-nano":       {"name": "Jetson Nano",      "gpu_cores": 128,  "cuda_cores": 128,  "max_power_modes": 2, "chip": "t210"},
    "jetson-tx2":        {"name": "Jetson TX2",        "gpu_cores": 256,  "cuda_cores": 256,  "max_power_modes": 5, "chip": "t186"},
    "jetson-xavier-nx":  {"name": "Jetson Xavier NX",  "gpu_cores": 384,  "cuda_cores": 384,  "max_power_modes": 6, "chip": "t194"},
    "jetson-agx-xavier": {"name": "Jetson AGX Xavier", "gpu_cores": 512,  "cuda_cores": 512,  "max_power_modes": 4, "chip": "t194"},
    "jetson-orin-nano":  {"name": "Jetson Orin Nano",  "gpu_cores": 1024, "cuda_cores": 1024, "max_power_modes": 4, "chip": "t234"},
    "jetson-orin-nx":    {"name": "Jetson Orin NX",    "gpu_cores": 1024, "cuda_cores": 1024, "max_power_modes": 5, "chip": "t234"},
    "jetson-agx-orin":   {"name": "Jetson AGX Orin",   "gpu_cores": 2048, "cuda_cores": 2048, "max_power_modes": 7, "chip": "t234"},
}

L4T_TO_JETPACK = {
    "32.1": "4.2", "32.2": "4.2.1", "32.3": "4.3", "32.4": "4.4",
    "32.5": "4.5", "32.6": "4.6", "32.7": "4.6.1",
    "32.7.1": "4.6.1", "32.7.2": "4.6.2", "32.7.3": "4.6.3", "32.7.4": "4.6.4",
    "35.1": "5.0.2", "35.2": "5.1", "35.3": "5.1.1", "35.4": "5.1.2", "35.5": "5.1.3",
    "36.2": "6.0", "36.3": "6.0 DP", "36.4": "6.1",
}


class HardwareDetector:
    def detect(self) -> Dict[str, Any]:
        model_key = self._detect_model()
        model_info = JETSON_MODELS.get(model_key, JETSON_MODELS["jetson-nano"])
        l4t = self._get_l4t_version()
        jetpack = self._l4t_to_jetpack(l4t)
        cuda = self._get_cuda_version()
        cudnn = self._get_cudnn_version()
        tensorrt = self._get_tensorrt_version()
        opencv = self._get_opencv_version()

        logger.info(f"Device: {model_info['name']} | L4T={l4t} | JetPack={jetpack} | CUDA={cuda} | cuDNN={cudnn} | TRT={tensorrt} | OpenCV={opencv}")

        return {
            "model_key": model_key,
            "model": model_info["name"],
            "gpu_cores": model_info["gpu_cores"],
            "cuda_cores": model_info["cuda_cores"],
            "max_power_modes": model_info["max_power_modes"],
            "chip": model_info["chip"],
            "l4t_version": l4t,
            "jetpack_version": jetpack,
            "cuda_version": cuda,
            "cudnn_version": cudnn,
            "tensorrt_version": tensorrt,
            "opencv_version": opencv,
            "ai_frameworks": self._detect_ai_frameworks(),
            "features": self._detect_features(),
        }

    def _detect_model(self) -> str:
        # 1. Device tree (mas fiable)
        model_path = Path("/proc/device-tree/model")
        if model_path.exists():
            try:
                s = model_path.read_bytes().decode("utf-8", errors="ignore").lower().strip("\x00").strip()
                logger.info(f"Device tree: '{s}'")
                if "orin" in s:
                    if "agx" in s: return "jetson-agx-orin"
                    if "nx" in s: return "jetson-orin-nx"
                    return "jetson-orin-nano"
                if "xavier" in s:
                    if "agx" in s or "industrial" in s: return "jetson-agx-xavier"
                    return "jetson-xavier-nx"
                if "tx2" in s: return "jetson-tx2"
                if "nano" in s: return "jetson-nano"
            except Exception as e:
                logger.warning(f"Device tree read error: {e}")

        # 2. nv_tegra_release BOARD field
        release = self._read_nv_tegra_release()
        if release:
            board = release.get("board", "").lower()
            if "t210" in board or "nano" in board or "p3448" in board: return "jetson-nano"
            if "t186" in board or "tx2" in board: return "jetson-tx2"
            if "t194" in board or "xavier" in board: return "jetson-agx-xavier"
            if "t234" in board or "orin" in board: return "jetson-agx-orin"

        # 3. nv_boot_control.conf
        boot_conf = Path("/etc/nv_boot_control.conf")
        if boot_conf.exists():
            try:
                content = boot_conf.read_text().lower()
                if "nano" in content or "3448" in content: return "jetson-nano"
                if "tx2" in content: return "jetson-tx2"
                if "xavier" in content: return "jetson-agx-xavier"
                if "orin" in content: return "jetson-agx-orin"
            except Exception:
                pass

        # 4. Env var override
        env_model = os.environ.get("JETSON_MODEL", "").strip()
        if env_model in JETSON_MODELS:
            return env_model

        # 5. JETSON_TESTING_MODEL_NAME (usado en Docker)
        test_model = os.environ.get("JETSON_TESTING_MODEL_NAME", "").lower()
        if "nano" in test_model: return "jetson-nano"
        if "tx2" in test_model: return "jetson-tx2"
        if "xavier" in test_model: return "jetson-agx-xavier"
        if "orin" in test_model: return "jetson-agx-orin"

        return "jetson-nano"

    def _read_nv_tegra_release(self) -> Optional[Dict]:
        p = Path("/etc/nv_tegra_release")
        if not p.exists():
            return None
        try:
            content = p.read_text()
            result = {}
            m = re.search(r"R(\d+)\s+\(release\)", content)
            if m: result["major"] = m.group(1)
            m = re.search(r"REVISION:\s*([\d.]+)", content)
            if m: result["revision"] = m.group(1)
            m = re.search(r"BOARD:\s*(\w+)", content)
            if m: result["board"] = m.group(1)
            return result
        except Exception:
            return None

    def _get_l4t_version(self) -> Optional[str]:
        r = self._read_nv_tegra_release()
        if r and "major" in r and "revision" in r:
            return f"R{r['major']}.{r['revision']}"
        return None

    def _l4t_to_jetpack(self, l4t: Optional[str]) -> Optional[str]:
        if not l4t:
            return None
        v = l4t.lstrip("R")
        if v in L4T_TO_JETPACK:
            return L4T_TO_JETPACK[v]
        parts = v.split(".")
        if len(parts) >= 2:
            short = f"{parts[0]}.{parts[1]}"
            if short in L4T_TO_JETPACK:
                return L4T_TO_JETPACK[short]
        return f"L4T {l4t}"

    def _get_cuda_version(self) -> Optional[str]:
        # Buscar en todas las rutas posibles
        version_files = [
            "/usr/local/cuda/version.txt",
            "/usr/local/cuda/version.json",
            "/usr/local/cuda-10.2/version.txt",
            "/usr/local/cuda-11.4/version.txt",
            "/usr/local/cuda-11.8/version.txt",
            "/usr/local/cuda-12.0/version.txt",
            "/usr/local/cuda-12.2/version.txt",
        ]
        for path in version_files:
            p = Path(path)
            if not p.exists():
                continue
            try:
                content = p.read_text()
                if path.endswith(".json"):
                    import json
                    data = json.loads(content)
                    v = data.get("cuda", {}).get("version") or data.get("version")
                    if v: return str(v)
                else:
                    m = re.search(r"CUDA Version ([\d.]+)", content)
                    if m: return m.group(1)
            except Exception:
                pass

        # nvcc en rutas conocidas
        for nvcc in ["/usr/local/cuda/bin/nvcc", "/usr/local/cuda-10.2/bin/nvcc",
                     "/usr/local/cuda-11.4/bin/nvcc", "/usr/bin/nvcc"]:
            if Path(nvcc).exists():
                try:
                    r = subprocess.run([nvcc, "--version"], capture_output=True, text=True, timeout=5)
                    m = re.search(r"release ([\d.]+)", r.stdout)
                    if m: return m.group(1)
                except Exception:
                    pass

        # dpkg
        try:
            r = subprocess.run(["dpkg", "-l", "cuda-cudart*"], capture_output=True, text=True, timeout=5)
            for line in r.stdout.splitlines():
                if line.startswith("ii"):
                    m = re.search(r"cuda-cudart-(\d+)-(\d+)\s+(\S+)", line)
                    if m: return f"{m.group(1)}.{m.group(2)}.{m.group(3).split('-')[0]}"
        except Exception:
            pass

        return os.environ.get("CUDA_VERSION") or None

    def _get_cudnn_version(self) -> Optional[str]:
        # Headers
        headers = [
            "/usr/include/cudnn_version.h",
            "/usr/include/cudnn.h",
            "/usr/local/cuda/include/cudnn_version.h",
            "/usr/local/cuda-10.2/include/cudnn_version.h",
            "/usr/local/cuda-11.4/include/cudnn_version.h",
        ]
        for header in headers:
            p = Path(header)
            if not p.exists(): continue
            try:
                content = p.read_text()
                major = re.search(r"#define CUDNN_MAJOR\s+(\d+)", content)
                minor = re.search(r"#define CUDNN_MINOR\s+(\d+)", content)
                patch = re.search(r"#define CUDNN_PATCHLEVEL\s+(\d+)", content)
                if major and minor:
                    pv = patch.group(1) if patch else "0"
                    return f"{major.group(1)}.{minor.group(1)}.{pv}"
            except Exception:
                pass

        # dpkg — libcudnn8 8.2.1.32-1+cuda10.2
        try:
            r = subprocess.run(["dpkg", "-l", "libcudnn*"], capture_output=True, text=True, timeout=5)
            for line in r.stdout.splitlines():
                if line.startswith("ii") and "libcudnn" in line and "dev" not in line:
                    parts = line.split()
                    if len(parts) >= 3:
                        m = re.search(r"^([\d.]+)", parts[2])
                        if m: return m.group(1)
        except Exception:
            pass

        return os.environ.get("CUDNN_VERSION") or None

    def _get_tensorrt_version(self) -> Optional[str]:
        # dpkg — libnvinfer8 o tensorrt
        try:
            r = subprocess.run(["dpkg", "-l", "tensorrt"], capture_output=True, text=True, timeout=5)
            for line in r.stdout.splitlines():
                if line.startswith("ii") and "tensorrt" in line:
                    parts = line.split()
                    if len(parts) >= 3:
                        m = re.search(r"^([\d.]+)", parts[2])
                        if m: return m.group(1)
        except Exception:
            pass

        try:
            r = subprocess.run(["dpkg", "-l", "libnvinfer*"], capture_output=True, text=True, timeout=5)
            for line in r.stdout.splitlines():
                if line.startswith("ii") and "libnvinfer" in line and "doc" not in line:
                    parts = line.split()
                    if len(parts) >= 3:
                        m = re.search(r"^([\d.]+)", parts[2])
                        if m: return m.group(1)
        except Exception:
            pass

        return os.environ.get("TENSORRT_VERSION") or None

    def _get_opencv_version(self) -> Optional[str]:
        # Script wrapper (instalacion personalizada como la tuya)
        opencv_script = Path("/usr/local/bin/opencv_version")
        if opencv_script.exists():
            try:
                r = subprocess.run([str(opencv_script)], capture_output=True, text=True, timeout=5)
                if r.returncode == 0 and r.stdout.strip():
                    return r.stdout.strip()
            except Exception:
                pass

        # python3
        try:
            r = subprocess.run(
                ["python3", "-c", "import cv2; print(cv2.__version__)"],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except Exception:
            pass

        # dpkg
        try:
            r = subprocess.run(["dpkg", "-l", "libopencv*"], capture_output=True, text=True, timeout=5)
            for line in r.stdout.splitlines():
                if line.startswith("ii"):
                    parts = line.split()
                    if len(parts) >= 3:
                        m = re.search(r"^([\d.]+)", parts[2])
                        if m: return m.group(1)
        except Exception:
            pass

        return None

    def _detect_ai_frameworks(self) -> Dict[str, Optional[str]]:
        """
        Detecta frameworks en el sistema actual.
        Si no están instalados devuelve None (se muestra como 'Not installed').
        No falla si no están — es informativo.
        """
        frameworks = {"pytorch": None, "tensorflow": None, "onnxruntime": None}
        for name, cmd in [
            ("pytorch", "import torch; print(torch.__version__)"),
            ("tensorflow", "import tensorflow as tf; print(tf.__version__)"),
            ("onnxruntime", "import onnxruntime; print(onnxruntime.__version__)"),
        ]:
            try:
                r = subprocess.run(
                    ["python3", "-c", cmd],
                    capture_output=True, text=True, timeout=10
                )
                if r.returncode == 0 and r.stdout.strip():
                    frameworks[name] = r.stdout.strip()
            except Exception:
                pass
        return frameworks

    def _detect_features(self) -> Dict[str, bool]:
        """
        Detecta features disponibles.
        GPIO y camera se comprueban tanto en /dev como en paths alternativos.
        """
        # GPIO: /dev/gpiochip0 o /dev/gpiochip1
        gpio = any(Path(f"/dev/gpiochip{i}").exists() for i in range(4))

        # Camera: /dev/video0..9
        camera = any(Path(f"/dev/video{i}").exists() for i in range(10))

        return {
            "tegrastats": any(Path(p).exists() for p in [
                "/usr/bin/tegrastats", "/usr/local/bin/tegrastats"
            ]),
            "jetson_clocks": Path("/usr/bin/jetson_clocks").exists(),
            "nvpmodel": Path("/usr/sbin/nvpmodel").exists(),
            "docker": self._check_docker(),
            "fan_control": Path("/sys/devices/pwm-fan/target_pwm").exists(),
            "gpio": gpio,
            "camera": camera,
        }

    def _check_docker(self) -> bool:
        try:
            return subprocess.run(
                ["docker", "info"], capture_output=True, timeout=5
            ).returncode == 0
        except Exception:
            return False
