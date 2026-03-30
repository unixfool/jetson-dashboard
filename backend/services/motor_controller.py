"""
Jetson Dashboard - Motor Controller Service
WaveShare JetBot: PCA9685 (0x60) + TB6612FNG via adafruit-circuitpython-motorkit

Confirmed working on:
  - WaveShare JetBot, Jetson Nano, Ubuntu 24.04, kernel 4.9-tegra
  - motor1 = LEFT wheel, motor2 = RIGHT wheel
  - Blinka detects JETSON_NANO automatically via adafruit_platformdetect
"""

import logging
import threading
import warnings
from typing import Optional

logger = logging.getLogger(__name__)

_MOTORKIT_ADDR = 0x60   # WaveShare JetBot Motor Driver HAT I2C address


class MotorController:
    """
    High-level motor controller for WaveShare JetBot.
    Uses adafruit-circuitpython-motorkit — confirmed working.
    Thread-safe. Degrades gracefully when hardware is not present.

    Motor mapping (confirmed physical test):
      motor1 = LEFT  wheel
      motor2 = RIGHT wheel
    """

    def __init__(self):
        self._kit         = None
        self._lock        = threading.Lock()
        self._available   = False
        self._error_msg   = ""
        self._left_speed  = 0.0   # -1.0 ... 1.0
        self._right_speed = 0.0
        self._init()

    def _init(self):
        try:
            warnings.filterwarnings("ignore", message=".*carrier board.*")
            warnings.filterwarnings("ignore", message=".*Jetson.GPIO.*")
            from adafruit_motorkit import MotorKit
            self._kit       = MotorKit(address=_MOTORKIT_ADDR)
            self._kit.motor1.throttle = None
            self._kit.motor2.throttle = None
            self._available = True
            logger.info(f"[INFO] MotorController ready — MotorKit at I2C 0x{_MOTORKIT_ADDR:02X} "
                        f"(motor1=LEFT, motor2=RIGHT)")
        except Exception as exc:
            self._available = False
            self._error_msg = str(exc)
            logger.warning(f"[WARNING] MotorController unavailable: {exc}")

    def is_available(self) -> bool:
        return self._available

    def get_status(self) -> dict:
        return {
            "available":   self._available,
            "error":       self._error_msg if not self._available else None,
            "left_speed":  round(self._left_speed, 3),
            "right_speed": round(self._right_speed, 3),
            "i2c_address": f"0x{_MOTORKIT_ADDR:02X}",
        }

    def set_motors(self, left: float, right: float) -> dict:
        if not self._available:
            return {"ok": False, "error": self._error_msg}
        left  = max(-1.0, min(1.0, float(left)))
        right = max(-1.0, min(1.0, float(right)))
        with self._lock:
            try:
                self._kit.motor1.throttle = left  if left  != 0.0 else None
                self._kit.motor2.throttle = right if right != 0.0 else None
                self._left_speed  = left
                self._right_speed = right
                return {"ok": True, "left": left, "right": right}
            except Exception as exc:
                logger.error(f"[ERROR] set_motors failed: {exc}")
                self._available = False
                self._error_msg = str(exc)
                return {"ok": False, "error": str(exc)}

    def stop(self) -> dict:
        if not self._available:
            return {"ok": False, "error": self._error_msg}
        with self._lock:
            try:
                self._kit.motor1.throttle = None
                self._kit.motor2.throttle = None
                self._left_speed  = 0.0
                self._right_speed = 0.0
                return {"ok": True, "left": 0.0, "right": 0.0}
            except Exception as exc:
                logger.error(f"[ERROR] stop failed: {exc}")
                return {"ok": False, "error": str(exc)}

    def forward(self, speed: float = 0.6) -> dict:
        return self.set_motors(speed, speed)

    def backward(self, speed: float = 0.6) -> dict:
        return self.set_motors(-speed, -speed)

    def turn_left(self, speed: float = 0.5) -> dict:
        return self.set_motors(-speed, speed)

    def turn_right(self, speed: float = 0.5) -> dict:
        return self.set_motors(speed, -speed)

    def cleanup(self):
        if self._kit:
            try:
                self._kit.motor1.throttle = None
                self._kit.motor2.throttle = None
            except Exception:
                pass
        logger.info("[INFO] MotorController cleanup done")


_motor_controller: Optional[MotorController] = None


def get_motor_controller() -> MotorController:
    global _motor_controller
    if _motor_controller is None:
        _motor_controller = MotorController()
    return _motor_controller
