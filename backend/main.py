"""
Jetson Dashboard - Backend Main Entry Point v1.2
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from api.routes   import router as api_router
from api.websocket import router as ws_router
from api.auth     import router as auth_router, require_auth
from api.alerts   import router as alerts_router, set_alert_manager
from api.history  import router as history_router, set_metrics_db
from api.systemd   import router as systemd_router
from api.camera    import router as camera_router
from api.ros2      import router as ros2_router
from api.backup    import router as backup_router
from api.scheduler import router as scheduler_router, get_scheduler
from api.battery   import router as battery_router, get_battery_monitor
from services.metrics_broadcaster import MetricsBroadcaster
from services.alert_manager import AlertManager
from services.metrics_db    import MetricsDB
from collectors.hardware_detector import HardwareDetector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

broadcaster = MetricsBroadcaster()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting Jetson Dashboard Backend v1.2")

    auth_enabled = os.environ.get("AUTH_ENABLED", "false").lower() == "true"
    logger.info(f"{'🔒' if auth_enabled else '🔓'} Auth {'ENABLED' if auth_enabled else 'DISABLED'}")

    # Hardware detection
    detector = HardwareDetector()
    hw_info  = detector.detect()
    logger.info(f"🔧 Device: {hw_info.get('model', 'Unknown Jetson')}")

    # SQLite metrics DB
    metrics_db = MetricsDB()
    set_metrics_db(metrics_db)
    broadcaster.set_metrics_db(metrics_db)
    logger.info(f"🗄️  MetricsDB ready at {metrics_db._get_conn().execute('PRAGMA database_list').fetchone()[2]}")

    # Alert manager
    alert_manager = AlertManager()
    set_alert_manager(alert_manager)
    broadcaster.set_alert_manager(alert_manager)
    logger.info("🔔 Alert manager ready")

    # Task scheduler
    scheduler = get_scheduler()
    scheduler.start()
    app.state.scheduler = scheduler

    # Battery monitor
    battery = get_battery_monitor()
    battery.start()
    app.state.battery = battery

    app.state.hardware_info  = hw_info
    app.state.broadcaster    = broadcaster
    app.state.alert_manager  = alert_manager
    app.state.metrics_db     = metrics_db

    # Background tasks
    broadcast_task = asyncio.create_task(broadcaster.start())
    cleanup_task   = asyncio.create_task(metrics_db.cleanup_loop())

    yield

    logger.info("🛑 Shutting down")
    get_scheduler().stop()
    get_battery_monitor().stop()
    broadcast_task.cancel()
    cleanup_task.cancel()
    try:
        await asyncio.gather(broadcast_task, cleanup_task, return_exceptions=True)
    except Exception:
        pass


app = FastAPI(
    title="Jetson Dashboard API",
    description="Real-time monitoring and management for NVIDIA Jetson devices",
    version="1.2.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Routers
app.include_router(auth_router,    prefix="/api/auth")
app.include_router(api_router,     prefix="/api",          dependencies=[Depends(require_auth)])
app.include_router(alerts_router,  prefix="/api/alerts",   dependencies=[Depends(require_auth)])
app.include_router(history_router, prefix="/api/history",  dependencies=[Depends(require_auth)])
app.include_router(systemd_router,  prefix="/api",          dependencies=[Depends(require_auth)])
app.include_router(camera_router,   prefix="/api",          dependencies=[Depends(require_auth)])
app.include_router(ros2_router,     prefix="/api",          dependencies=[Depends(require_auth)])
app.include_router(backup_router,   prefix="/api",          dependencies=[Depends(require_auth)])
app.include_router(scheduler_router, prefix="/api",         dependencies=[Depends(require_auth)])
app.include_router(battery_router,   prefix="/api",         dependencies=[Depends(require_auth)])
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.2.0"}

@app.get("/")
async def root():
    return {"message": "Jetson Dashboard API", "version": "1.2.0"}
