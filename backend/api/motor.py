"""
Jetson Dashboard - Motor Control API
Endpoints for WaveShare JetBot motor control via PCA9685.
"""

import logging
from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.motor_controller import get_motor_controller

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Request models ──────────────────────────────────────────────────────────

class MotorCommand(BaseModel):
    left:  float = Field(..., ge=-1.0, le=1.0, description="Left wheel throttle -1.0 to 1.0")
    right: float = Field(..., ge=-1.0, le=1.0, description="Right wheel throttle -1.0 to 1.0")


class DirectionCommand(BaseModel):
    speed: float = Field(0.6, ge=0.0, le=1.0, description="Speed 0.0 to 1.0")


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/motor/status")
async def motor_status():
    """Get motor controller status and current speeds."""
    mc = get_motor_controller()
    return mc.get_status()


@router.post("/motor/set")
async def motor_set(cmd: MotorCommand):
    """Set both motors independently. Values -1.0 (reverse) to 1.0 (forward)."""
    mc = get_motor_controller()
    result = mc.set_motors(cmd.left, cmd.right)
    if not result["ok"]:
        logger.error(f"[ERROR] motor/set failed: {result.get('error')}")
    return result


@router.post("/motor/stop")
async def motor_stop():
    """Stop both motors immediately."""
    mc = get_motor_controller()
    return mc.stop()


@router.post("/motor/forward")
async def motor_forward(cmd: DirectionCommand):
    """Move forward at given speed."""
    mc = get_motor_controller()
    return mc.forward(cmd.speed)


@router.post("/motor/backward")
async def motor_backward(cmd: DirectionCommand):
    """Move backward at given speed."""
    mc = get_motor_controller()
    return mc.backward(cmd.speed)


@router.post("/motor/left")
async def motor_left(cmd: DirectionCommand):
    """Turn left (spin in place) at given speed."""
    mc = get_motor_controller()
    return mc.turn_left(cmd.speed)


@router.post("/motor/right")
async def motor_right(cmd: DirectionCommand):
    """Turn right (spin in place) at given speed."""
    mc = get_motor_controller()
    return mc.turn_right(cmd.speed)
