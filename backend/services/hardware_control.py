"""
Hardware Control - Universal Jetson
Persistencia en /app/data/settings.json
Fan: /sys/devices/pwm-fan/target_pwm (0-255)
nvpmodel: /usr/sbin/nvpmodel
jetson_clocks: /usr/bin/jetson_clocks
Todos los comandos se ejecutan como root (el contenedor ya es root)
"""

import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Archivo de persistencia de settings
SETTINGS_FILE = Path("/app/data/settings.json")

# Modos de poder del Jetson Nano (nvpmodel_t210_jetson-nano.conf)
NANO_POWER_MODES = [
    {"id": 0, "name": "MAXN", "description": "Max performance (10W)"},
    {"id": 1, "name": "5W",   "description": "5W power saving"},
]


class HardwareControlService:
    def __init__(self):
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        self._settings = self._load_settings()
        self._fan_path = Path("/sys/devices/pwm-fan/target_pwm")
        self._nvpmodel_path = Path("/usr/sbin/nvpmodel")
        self._jetson_clocks_path = Path("/usr/bin/jetson_clocks")
        # Aplicar settings guardados al arrancar
        self._apply_persistent_settings()

    # ─── Persistencia ────────────────────────────────────────────────────────

    def _load_settings(self) -> Dict[str, Any]:
        defaults = {
            "fan_speed": None,          # None = control automatico
            "jetson_clocks": False,
            "power_mode_id": 0,
        }
        if SETTINGS_FILE.exists():
            try:
                data = json.loads(SETTINGS_FILE.read_text())
                defaults.update(data)
                logger.info(f"Settings loaded: {defaults}")
            except Exception as e:
                logger.warning(f"Could not load settings: {e}")
        return defaults

    def _save_settings(self):
        try:
            SETTINGS_FILE.write_text(json.dumps(self._settings, indent=2))
            logger.info(f"Settings saved: {self._settings}")
        except Exception as e:
            logger.error(f"Could not save settings: {e}")

    def _apply_persistent_settings(self):
        """Aplicar configuracion guardada al arrancar el backend"""
        # Fan
        if self._settings.get("fan_speed") is not None:
            try:
                self.set_fan_speed(self._settings["fan_speed"], persist=False)
                logger.info(f"Fan restored to {self._settings['fan_speed']}%")
            except Exception as e:
                logger.warning(f"Could not restore fan speed: {e}")

        # jetson_clocks
        if self._settings.get("jetson_clocks"):
            try:
                self.enable_jetson_clocks(persist=False)
                logger.info("jetson_clocks restored")
            except Exception as e:
                logger.warning(f"Could not restore jetson_clocks: {e}")

    def get_settings(self) -> Dict[str, Any]:
        return dict(self._settings)

    # ─── Fan ─────────────────────────────────────────────────────────────────

    def set_fan_speed(self, percent: int, persist: bool = True) -> Dict[str, Any]:
        """
        Establece velocidad del fan.
        percent: 0-100
        Convierte a PWM 0-255 para /sys/devices/pwm-fan/target_pwm
        """
        percent = max(0, min(100, int(percent)))
        pwm_value = round(percent / 100 * 255)

        result = {"success": False, "percent": percent, "pwm": pwm_value}

        # Metodo 1: target_pwm directo (Jetson Nano)
        if self._fan_path.exists():
            try:
                self._fan_path.write_text(str(pwm_value))
                result["success"] = True
                result["method"] = "target_pwm"
                logger.info(f"Fan set to {percent}% (PWM={pwm_value}) via target_pwm")
            except PermissionError:
                # Intentar con sudo si no tenemos permisos
                try:
                    subprocess.run(
                        ["bash", "-c", f"echo {pwm_value} > {self._fan_path}"],
                        check=True, timeout=5
                    )
                    result["success"] = True
                    result["method"] = "target_pwm_sudo"
                except Exception as e:
                    result["error"] = str(e)
            except Exception as e:
                result["error"] = str(e)

        # Metodo 2: cooling_device cur_state
        if not result["success"]:
            try:
                for cd in sorted(Path("/sys/class/thermal").glob("cooling_device*")):
                    type_f = cd / "type"
                    if not type_f.exists():
                        continue
                    if type_f.read_text().strip().lower() == "pwm-fan":
                        max_f = cd / "max_state"
                        cur_f = cd / "cur_state"
                        max_val = int(max_f.read_text().strip()) if max_f.exists() else 10
                        state = round(percent / 100 * max_val)
                        cur_f.write_text(str(state))
                        result["success"] = True
                        result["method"] = "cooling_device"
                        break
            except Exception as e:
                result["error"] = str(e)

        if result["success"] and persist:
            self._settings["fan_speed"] = percent
            self._save_settings()

        return result

    def get_fan_info(self) -> Dict[str, Any]:
        info = {
            "available": self._fan_path.exists(),
            "cur_pwm": None,
            "target_pwm": None,
            "rpm": None,
            "percent": None,
            "passive_cooling": False,
        }
        pwm_dir = Path("/sys/devices/pwm-fan")
        if pwm_dir.exists():
            try:
                cur = pwm_dir / "cur_pwm"
                target = pwm_dir / "target_pwm"
                rpm = pwm_dir / "rpm_measured"
                if cur.exists():
                    info["cur_pwm"] = int(cur.read_text().strip())
                    info["percent"] = round(info["cur_pwm"] / 255 * 100)
                if target.exists():
                    info["target_pwm"] = int(target.read_text().strip())
                if rpm.exists():
                    info["rpm"] = int(rpm.read_text().strip())
                if info["cur_pwm"] == 0:
                    info["passive_cooling"] = True
            except Exception:
                pass
        return info

    # ─── nvpmodel ────────────────────────────────────────────────────────────

    def get_power_modes(self) -> List[Dict]:
        """Obtener modos disponibles desde /etc/nvpmodel.conf o lista hardcoded"""
        modes = []
        conf = Path("/etc/nvpmodel.conf")
        if conf.exists():
            try:
                content = conf.read_text()
                for m in re.finditer(r"<POWER_MODEL[^>]*ID=(\d+)[^>]*NAME=(\w+)", content):
                    modes.append({"id": int(m.group(1)), "name": m.group(2), "description": ""})
            except Exception:
                pass

        if not modes:
            modes = NANO_POWER_MODES

        return modes

    def get_current_power_mode(self) -> Dict[str, Any]:
        if not self._nvpmodel_path.exists():
            return {"available": False, "mode": "N/A", "id": -1}
        try:
            r = subprocess.run(
                [str(self._nvpmodel_path), "-q"],
                capture_output=True, text=True, timeout=5
            )
            output = r.stdout + r.stderr

            # Buscar "NV Power Mode: MAXN"
            mode_m = re.search(r"NV Power Mode:\s*(\S+)", output)

            # Buscar ID numerico (linea que solo tiene un digito)
            lines = [l.strip() for l in output.strip().splitlines() if l.strip().isdigit()]
            mode_id = int(lines[-1]) if lines else None

            # Si nvpmodel dice "power mode is not set", leer del settings guardado
            if not mode_m and "not set" in output:
                saved_id = self._settings.get("power_mode_id", 0)
                modes = self.get_power_modes()
                saved_name = next((m["name"] for m in modes if m["id"] == saved_id), "MAXN")
                return {
                    "available": True,
                    "mode": saved_name,
                    "id": saved_id,
                    "note": "read from saved settings",
                }

            return {
                "available": True,
                "mode": mode_m.group(1) if mode_m else "MAXN",
                "id": mode_id if mode_id is not None else self._settings.get("power_mode_id", 0),
            }
        except Exception as e:
            return {"available": False, "error": str(e)}

    def set_power_mode(self, mode_id: int) -> Dict[str, Any]:
        if not self._nvpmodel_path.exists():
            return {"success": False, "error": "nvpmodel not found"}
        try:
            r = subprocess.run(
                [str(self._nvpmodel_path), "-m", str(mode_id)],
                capture_output=True, text=True, timeout=10
            )
            success = r.returncode == 0
            if success:
                self._settings["power_mode_id"] = mode_id
                self._save_settings()
            return {
                "success": success,
                "mode_id": mode_id,
                "output": (r.stdout + r.stderr)[:300],
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ─── jetson_clocks ────────────────────────────────────────────────────────

    def enable_jetson_clocks(self, persist: bool = True) -> Dict[str, Any]:
        if not self._jetson_clocks_path.exists():
            return {"success": False, "error": "jetson_clocks not found"}
        try:
            r = subprocess.run(
                [str(self._jetson_clocks_path)],
                capture_output=True, text=True, timeout=15
            )
            output = r.stdout + r.stderr
            # En Ubuntu 24 puede dar "Unknown GPU" pero los CPU clocks si funcionan
            success = r.returncode == 0 or "cpu" in output.lower()
            if success and persist:
                self._settings["jetson_clocks"] = True
                self._save_settings()
            return {"success": success, "output": output[:300]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def disable_jetson_clocks(self, persist: bool = True) -> Dict[str, Any]:
        if not self._jetson_clocks_path.exists():
            return {"success": False, "error": "jetson_clocks not found"}
        try:
            r = subprocess.run(
                [str(self._jetson_clocks_path), "--restore"],
                capture_output=True, text=True, timeout=15
            )
            output = r.stdout + r.stderr
            success = r.returncode == 0 or "restore" in output.lower()
            if success and persist:
                self._settings["jetson_clocks"] = False
                self._save_settings()
            return {"success": success, "output": output[:300]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_jetson_clocks_status(self) -> Dict[str, Any]:
        if not self._jetson_clocks_path.exists():
            return {"available": False, "enabled": False}
        try:
            r = subprocess.run(
                [str(self._jetson_clocks_path), "--show"],
                capture_output=True, text=True, timeout=10
            )
            output = r.stdout + r.stderr
            # "Unknown GPU" es normal en Ubuntu 24 sin device tree completo
            # El comando igual funciona para CPU — no es un error bloqueante
            gpu_warning = "Unknown GPU" in output or "No such file" in output
            return {
                "available": True,
                "enabled": self._settings.get("jetson_clocks", False),
                "output": output[:1000],
                "gpu_warning": gpu_warning,
                "note": "GPU clock control limited on Ubuntu 24 (device tree incomplete)" if gpu_warning else None,
            }
        except Exception as e:
            return {"available": False, "enabled": False, "error": str(e)}

    # ─── System ───────────────────────────────────────────────────────────────

    def reboot(self) -> Dict[str, Any]:
        try:
            # Ejecutar en el host via nsenter (igual que systemd)
            subprocess.Popen(
                ["/bin/bash", "-c", "nsenter --target 1 --mount -- systemd-run --pipe --quiet -- reboot"]
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def shutdown(self) -> Dict[str, Any]:
        try:
            subprocess.Popen(
                ["/bin/bash", "-c", "nsenter --target 1 --mount -- systemd-run --pipe --quiet -- poweroff"]
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
