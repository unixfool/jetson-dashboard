"""
History API - Endpoints para consultar métricas históricas
"""
import time
import logging
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional

logger = logging.getLogger(__name__)
router = APIRouter()

_metrics_db = None

def set_metrics_db(db):
    global _metrics_db
    _metrics_db = db

def get_db():
    if _metrics_db is None:
        raise HTTPException(status_code=503, detail="Metrics DB not initialized")
    return _metrics_db


PRESETS = {
    "1h":  3600,
    "6h":  21600,
    "24h": 86400,
    "3d":  86400 * 3,
    "7d":  86400 * 7,
    "30d": 86400 * 30,
}

VALID_METRICS = [
    "cpu_percent", "cpu_temp", "ram_percent", "ram_used_mb",
    "swap_percent", "gpu_percent", "gpu_temp", "gpu_freq_mhz",
    "disk_percent", "net_rx_kbps", "net_tx_kbps", "fan_pwm",
]


@router.get("/query")
async def query_metric(
    metric: str = Query(..., description="Metric name"),
    range: str  = Query("1h", description="Time range: 1h|6h|24h|3d|7d|30d"),
    resolution: str = Query("auto", description="Resolution: auto|1s|1m|1h"),
    limit: int  = Query(600, ge=10, le=5000),
):
    """Consultar una métrica histórica"""
    if metric not in VALID_METRICS:
        raise HTTPException(400, f"Invalid metric. Valid: {VALID_METRICS}")
    if range not in PRESETS:
        raise HTTPException(400, f"Invalid range. Valid: {list(PRESETS.keys())}")

    now   = int(time.time())
    start = now - PRESETS[range]

    data = await get_db().query_async(metric, start, now, resolution, limit)
    return {
        "metric":     metric,
        "range":      range,
        "resolution": resolution,
        "start":      start,
        "end":        now,
        "count":      len(data),
        "data":       data,
    }


@router.get("/query-multi")
async def query_multi(
    metrics: str = Query(..., description="Comma-separated metric names"),
    range: str   = Query("1h"),
    resolution: str = Query("auto"),
    limit: int   = Query(600, ge=10, le=5000),
):
    """Consultar varias métricas a la vez"""
    metric_list = [m.strip() for m in metrics.split(",")]
    invalid = [m for m in metric_list if m not in VALID_METRICS]
    if invalid:
        raise HTTPException(400, f"Invalid metrics: {invalid}")
    if range not in PRESETS:
        raise HTTPException(400, f"Invalid range")

    now   = int(time.time())
    start = now - PRESETS[range]

    result = await get_db().query_multi_async(metric_list, start, now, resolution, limit)
    return {
        "range":  range,
        "start":  start,
        "end":    now,
        "data":   result,
    }


@router.get("/stats")
async def db_stats():
    """Estadísticas de la base de datos (tamaño, registros, rango temporal)"""
    return get_db().get_stats()


@router.get("/available-metrics")
async def available_metrics():
    return {"metrics": VALID_METRICS}
