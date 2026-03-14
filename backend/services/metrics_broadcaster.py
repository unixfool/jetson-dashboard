"""
Metrics Broadcaster - WebSocket broadcast loop con alertas e histórico SQLite
"""
import asyncio
import json
import logging
import time
from typing import Set, Dict, Any

from fastapi import WebSocket
from collectors.system_metrics import SystemMetricsCollector
from collectors.gpu_metrics import GPUMetricsCollector

logger = logging.getLogger(__name__)
BROADCAST_INTERVAL = 1.5


class MetricsBroadcaster:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._system_collector = SystemMetricsCollector()
        self._gpu_collector    = GPUMetricsCollector()
        self._latest_metrics: Dict[str, Any] = {}
        self._running      = False
        self._alert_manager = None
        self._metrics_db    = None

    def set_alert_manager(self, manager):
        self._alert_manager = manager

    def set_metrics_db(self, db):
        self._metrics_db = db

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.add(websocket)
        logger.info(f"WS connected. Total: {len(self._connections)}")
        if self._latest_metrics:
            try:
                await websocket.send_text(json.dumps(self._latest_metrics))
            except Exception:
                pass

    def disconnect(self, websocket: WebSocket):
        self._connections.discard(websocket)
        logger.info(f"WS disconnected. Total: {len(self._connections)}")

    async def broadcast(self, data: Dict[str, Any]):
        if not self._connections:
            return
        message = json.dumps(data, default=str)
        dead = set()
        for ws in self._connections.copy():
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections.discard(ws)

    async def start(self):
        self._running = True
        logger.info("Metrics broadcaster started")
        import psutil
        psutil.cpu_percent(interval=None, percpu=True)

        while self._running:
            try:
                start_t = time.monotonic()
                ts      = time.time()

                system_metrics, gpu_metrics = await asyncio.gather(
                    self._system_collector.collect_all(),
                    self._gpu_collector.collect(),
                    return_exceptions=True,
                )

                sys_data = system_metrics if not isinstance(system_metrics, Exception) else {}
                gpu_data = gpu_metrics    if not isinstance(gpu_metrics,    Exception) else {}

                # Guardar en SQLite (no bloqueante)
                if self._metrics_db and sys_data:
                    try:
                        await self._metrics_db.insert_async(ts, sys_data, gpu_data)
                    except Exception as e:
                        logger.debug(f"DB insert error: {e}")

                # Evaluar alertas
                new_alerts = []
                if self._alert_manager:
                    try:
                        await self._alert_manager.evaluate(sys_data, gpu_data)
                        new_alerts = self._alert_manager.get_new_alerts()
                    except Exception as e:
                        logger.error(f"Alert evaluation error: {e}")

                metrics = {
                    "timestamp":          ts,
                    "system":             sys_data,
                    "gpu":                gpu_data,
                    "new_alerts":         new_alerts,
                    "active_alert_count": len(self._alert_manager.get_active()) if self._alert_manager else 0,
                }

                self._latest_metrics = metrics

                if self._connections:
                    await self.broadcast(metrics)

                elapsed = time.monotonic() - start_t
                await asyncio.sleep(max(0.1, BROADCAST_INTERVAL - elapsed))

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Broadcast error: {e}")
                await asyncio.sleep(2)

        logger.info("Metrics broadcaster stopped")

    def stop(self):
        self._running = False

    def get_latest(self) -> Dict[str, Any]:
        return self._latest_metrics
