"""
WebSocket Router - Real-time metrics streaming
Autenticación via query param: /ws/metrics?token=<jwt>
"""

import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import Optional

from api.auth import _verify_token, _get_config

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/metrics")
async def metrics_websocket(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
):
    """Main metrics streaming WebSocket endpoint"""

    cfg = _get_config()
    if cfg["enabled"]:
        # Verificar token
        username = _verify_token(token, cfg["secret"]) if token else None
        if not username:
            # Rechazar conexión antes de aceptarla
            await websocket.close(code=4001, reason="Unauthorized")
            return

    broadcaster = websocket.app.state.broadcaster
    await broadcaster.connect(websocket)
    try:
        while True:
            try:
                data = await websocket.receive_text()
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.disconnect(websocket)
