"""
Alerts API - Endpoints para gestión de alertas
"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)
router = APIRouter()

# Importar instancia global del alert manager (se inyecta desde main.py)
_alert_manager = None

def set_alert_manager(manager):
    global _alert_manager
    _alert_manager = manager

def get_manager():
    if _alert_manager is None:
        raise HTTPException(status_code=503, detail="Alert manager not initialized")
    return _alert_manager


class AlertConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    rules: Optional[Dict[str, Any]] = None
    notifications: Optional[Dict[str, Any]] = None


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/config")
async def get_alert_config():
    """Obtener configuración completa de alertas"""
    return get_manager().get_config()

@router.put("/config")
async def update_alert_config(update: AlertConfigUpdate):
    """Actualizar configuración de alertas"""
    data = {k: v for k, v in update.dict().items() if v is not None}
    return get_manager().update_config(data)

@router.get("/history")
async def get_alert_history(limit: int = 50):
    """Historial de alertas disparadas"""
    return {"alerts": get_manager().get_history(limit)}

@router.get("/active")
async def get_active_alerts():
    """Alertas activas en este momento"""
    return {"alerts": get_manager().get_active()}

@router.post("/acknowledge/{alert_id}")
async def acknowledge_alert(alert_id: str):
    """Marcar alerta como vista"""
    ok = get_manager().acknowledge(alert_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"success": True}

@router.post("/acknowledge-all")
async def acknowledge_all():
    """Marcar todas las alertas activas como vistas"""
    get_manager().acknowledge_all()
    return {"success": True}

@router.post("/test/email")
async def test_email():
    """Enviar email de prueba"""
    return get_manager().test_email()

@router.post("/test/telegram")
async def test_telegram():
    """Enviar mensaje Telegram de prueba"""
    return await get_manager().test_telegram()
