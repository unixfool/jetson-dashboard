"""
Battery Monitor API — INA219 power sensor for JetBot WaveShare
Reads voltage, current and power from INA219 at I2C address 0x41 on bus 1

WaveShare JetBot battery pack: 3x 18650 cells ~12.6V fully charged
INA219 is connected to the expansion board on I2C bus 1, address 0x41
"""
import logging
import time
import threading
from typing import Optional

from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()

# ── INA219 Configuration ──────────────────────────────────────────────────────
INA219_ADDRESS = 0x41
I2C_BUS        = 1       # Bus 1 confirmed via scan
POLL_INTERVAL  = 2.0     # seconds between readings
HISTORY_SIZE   = 60      # readings kept in memory (~2 minutes at 2s interval)

# Battery state thresholds (3x 18650 pack)
BATTERY_FULL     = 12.4   # V
BATTERY_GOOD     = 11.5   # V
BATTERY_LOW      = 10.5   # V
BATTERY_CRITICAL = 9.5    # V


# ── Battery state helpers ─────────────────────────────────────────────────────

def _battery_percent(voltage: float) -> int:
    """Estimate battery percentage from voltage (linear approximation)."""
    if voltage >= BATTERY_FULL:
        return 100
    if voltage <= BATTERY_CRITICAL:
        return 0
    pct = (voltage - BATTERY_CRITICAL) / (BATTERY_FULL - BATTERY_CRITICAL) * 100
    return max(0, min(100, int(pct)))

def _battery_state(voltage: float) -> str:
    if voltage >= BATTERY_FULL:     return "full"
    if voltage >= BATTERY_GOOD:     return "good"
    if voltage >= BATTERY_LOW:      return "low"
    if voltage >= BATTERY_CRITICAL: return "critical"
    return "depleted"

def _battery_color(state: str) -> str:
    return {
        "full":     "#3fb950",
        "good":     "#3fb950",
        "low":      "#d29922",
        "critical": "#f85149",
        "depleted": "#f85149",
    }.get(state, "#7d8590")


# ── INA219 Reader ─────────────────────────────────────────────────────────────

class BatteryMonitor:
    """
    Polls the INA219 sensor in a background thread.
    Handles gracefully the case where INA219 is not present
    (returns available=False without crashing the backend).
    """
    def __init__(self):
        self._lock      = threading.Lock()
        self._running   = False
        self._thread    = None
        self._available = False
        self._error     = None
        self._last      = {}
        self._history   = []   # list of {ts, voltage, current, power}
        self._ina       = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread  = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("Battery monitor started")

    def stop(self):
        self._running = False

    def _init_ina(self) -> bool:
        """Try to initialise the INA219. Returns True on success."""
        try:
            import board
            import busio
            import adafruit_ina219

            i2c = busio.I2C(board.SCL, board.SDA)
            self._ina = adafruit_ina219.INA219(i2c, addr=INA219_ADDRESS)
            # Test read
            _ = self._ina.bus_voltage
            logger.info(f"INA219 initialised at I2C bus {I2C_BUS} addr {hex(INA219_ADDRESS)}")
            return True
        except Exception as e:
            self._error = str(e)
            logger.warning(f"INA219 not available: {e}")
            return False

    def _read(self) -> Optional[dict]:
        """Read one sample from the INA219."""
        try:
            voltage     = round(self._ina.bus_voltage,  3)
            shunt       = round(self._ina.shunt_voltage, 4)  # mV
            current_raw = self._ina.current

            # WaveShare JetBot INA219 detection logic (confirmed via testing):
            # - Charger connected: shunt > 0.01mV AND current > 50mA (positive)
            # - Battery only:      shunt ≈ 0.000mV, current ≈ 0 (unreliable)
            charging         = abs(shunt) > 0.01 and current_raw > 50
            current_reliable = charging  # current only reliable when charger connected
            current  = round(current_raw, 1) if current_reliable else None
            power    = round(voltage * (current / 1000), 2) if current else None  # W

            return {
                "voltage":          voltage,
                "current":          current,    # mA charging current, None on battery
                "power":            power,      # W, None on battery
                "shunt":            shunt,
                "charging":         charging,
                "current_reliable": current_reliable,
                "percent":  _battery_percent(voltage),
                "state":    _battery_state(voltage),
                "color":    _battery_color(_battery_state(voltage)),
                "ts":       time.time(),
            }
        except Exception as e:
            logger.debug(f"INA219 read error: {e}")
            return None

    def _loop(self):
        # Try to init — retry every 10s if not available
        while self._running and not self._available:
            if self._init_ina():
                self._available = True
            else:
                time.sleep(10)

        while self._running:
            if not self._available:
                time.sleep(10)
                self._available = self._init_ina()
                continue

            sample = self._read()
            if sample:
                with self._lock:
                    self._last = sample
                    self._error = None
                    self._history.append({
                        "ts":      sample["ts"],
                        "voltage": sample["voltage"],
                        "current": sample["current"],
                        "power":   sample["power"],
                    })
                    if len(self._history) > HISTORY_SIZE:
                        self._history.pop(0)
            else:
                with self._lock:
                    self._error = "Read failed"

            time.sleep(POLL_INTERVAL)

        logger.info("Battery monitor stopped")

    def get_status(self) -> dict:
        with self._lock:
            if not self._available:
                return {
                    "available": False,
                    "error":     self._error or "INA219 not detected",
                }
            if not self._last:
                return {
                    "available": True,
                    "error":     "Waiting for first reading...",
                }
            return {
                "available": True,
                "error":     self._error,
                **self._last,
            }

    def get_history(self) -> list:
        with self._lock:
            return list(self._history)


# ── Singleton ─────────────────────────────────────────────────────────────────
_monitor = BatteryMonitor()

def get_battery_monitor() -> BatteryMonitor:
    return _monitor


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/battery/status")
async def battery_status():
    """Current battery readings from INA219."""
    return _monitor.get_status()

@router.get("/battery/history")
async def battery_history():
    """Last 2 minutes of voltage/current/power readings."""
    return {"history": _monitor.get_history()}
