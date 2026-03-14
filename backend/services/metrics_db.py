"""
Metrics Database - Histórico persistente en SQLite
Guarda métricas del sistema cada ciclo y permite consultas por rango de tiempo.

Tablas:
  metrics_1s   — datos crudos, retención 24h
  metrics_1m   — agregado por minuto, retención 30 días
  metrics_1h   — agregado por hora, retención 1 año
"""

import asyncio
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
DB_PATH  = DATA_DIR / "metrics.db"

# Retención por resolución
RETENTION = {
    "1s": 86400,       # 24h  de datos crudos
    "1m": 86400 * 30,  # 30d  de datos por minuto
    "1h": 86400 * 365, # 1año de datos por hora
}


class MetricsDB:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._conn: Optional[sqlite3.Connection] = None
        self._last_minute_ts: int = 0
        self._last_hour_ts:   int = 0
        self._minute_buffer:  List[Dict] = []
        self._hour_buffer:    List[Dict] = []
        self._init_db()

    # ─── Init ─────────────────────────────────────────────────────────────────

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(
                str(DB_PATH),
                check_same_thread=False,
                timeout=10,
            )
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA cache_size=10000")
        return self._conn

    def _init_db(self):
        conn = self._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS metrics_1s (
                ts           INTEGER NOT NULL,
                cpu_percent  REAL,
                cpu_temp     REAL,
                ram_percent  REAL,
                ram_used_mb  REAL,
                swap_percent REAL,
                gpu_percent  REAL,
                gpu_temp     REAL,
                gpu_freq_mhz REAL,
                disk_percent REAL,
                net_rx_kbps  REAL,
                net_tx_kbps  REAL,
                fan_pwm      INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_1s_ts ON metrics_1s(ts);

            CREATE TABLE IF NOT EXISTS metrics_1m (
                ts           INTEGER NOT NULL PRIMARY KEY,
                cpu_percent  REAL,
                cpu_temp     REAL,
                ram_percent  REAL,
                ram_used_mb  REAL,
                swap_percent REAL,
                gpu_percent  REAL,
                gpu_temp     REAL,
                gpu_freq_mhz REAL,
                disk_percent REAL,
                net_rx_kbps  REAL,
                net_tx_kbps  REAL,
                fan_pwm      INTEGER
            );

            CREATE TABLE IF NOT EXISTS metrics_1h (
                ts           INTEGER NOT NULL PRIMARY KEY,
                cpu_percent  REAL,
                cpu_temp     REAL,
                ram_percent  REAL,
                ram_used_mb  REAL,
                swap_percent REAL,
                gpu_percent  REAL,
                gpu_temp     REAL,
                gpu_freq_mhz REAL,
                disk_percent REAL,
                net_rx_kbps  REAL,
                net_tx_kbps  REAL,
                fan_pwm      INTEGER
            );

            CREATE TABLE IF NOT EXISTS db_info (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
            INSERT OR IGNORE INTO db_info VALUES ('created_at', strftime('%s','now'));
            INSERT OR IGNORE INTO db_info VALUES ('version', '1');
        """)
        conn.commit()
        logger.info(f"MetricsDB initialized at {DB_PATH}")

    # ─── Extract values ───────────────────────────────────────────────────────

    def _extract(self, system: Dict, gpu: Dict) -> Dict[str, Any]:
        cpu    = system.get("cpu", {})
        mem    = system.get("memory", {})
        stor   = system.get("storage", {})
        net    = system.get("network", {})
        therm  = system.get("thermals", {})
        sensors = therm.get("sensors", {})

        # CPU temp — prioridad: sensors["CPU"] > tegrastats
        cpu_temp = None
        if "CPU" in sensors:
            cpu_temp = sensors["CPU"].get("temp_c")
        if cpu_temp is None:
            cpu_temp = gpu.get("tegrastats_raw", {}).get("temperatures", {}).get("CPU")

        # Disk — mayor porcentaje entre particiones
        disk_percent = None
        parts = stor.get("partitions", [])
        if parts:
            disk_percent = max(p.get("percent", 0) for p in parts)

        # Network — usar solo la interfaz primaria (wlan0/eth0 activa)
        # para evitar sumar tráfico de docker0, br-*, dummy, etc.
        net_rx = net_tx = 0.0
        ifaces = net.get("interfaces", {})
        primary = net.get("primary_interface")

        # Seleccionar interfaz: primero primary, luego buscar la mejor
        target_iface = None
        if primary and primary in ifaces:
            target_iface = primary
        else:
            # Buscar interfaz UP con IP real, no virtual
            best_score = -1
            for name, data in ifaces.items():
                if name.startswith(("lo", "docker", "br-", "dummy", "veth")):
                    continue
                if not data.get("is_up") and not data.get("ip"):
                    continue
                score = data.get("bytes_recv", 0) + data.get("bytes_sent", 0)
                if score > best_score:
                    best_score = score
                    target_iface = name

        if target_iface and target_iface in ifaces:
            iface_data = ifaces[target_iface]
            net_rx = iface_data.get("rx_bytes_sec", 0) / 1024
            net_tx = iface_data.get("tx_bytes_sec", 0) / 1024

        # Fan
        fan_pwm = therm.get("fan_pwm") or therm.get("fan_speed")

        # RAM
        ram_used_mb = None
        if mem.get("used"):
            ram_used_mb = round(mem["used"] / 1024 / 1024, 1)

        return {
            "cpu_percent":  cpu.get("usage_percent") or cpu.get("percent"),
            "cpu_temp":     cpu_temp,
            "ram_percent":  mem.get("percent"),
            "ram_used_mb":  ram_used_mb,
            "swap_percent": mem.get("swap_percent"),
            "gpu_percent":  gpu.get("utilization_percent"),
            "gpu_temp":     gpu.get("temperature_c"),
            "gpu_freq_mhz": gpu.get("freq_mhz"),
            "disk_percent": disk_percent,
            "net_rx_kbps":  round(net_rx, 2),
            "net_tx_kbps":  round(net_tx, 2),
            "fan_pwm":      fan_pwm,
        }

    # ─── Insert ───────────────────────────────────────────────────────────────

    def insert(self, ts: float, system: Dict, gpu: Dict):
        """Insertar punto de datos y agregar si corresponde"""
        values = self._extract(system, gpu)
        ts_int = int(ts)

        conn = self._get_conn()

        # 1s — siempre
        conn.execute(
            "INSERT INTO metrics_1s VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ts_int,
             values["cpu_percent"], values["cpu_temp"],
             values["ram_percent"], values["ram_used_mb"],
             values["swap_percent"],
             values["gpu_percent"], values["gpu_temp"], values["gpu_freq_mhz"],
             values["disk_percent"],
             values["net_rx_kbps"], values["net_tx_kbps"],
             values["fan_pwm"])
        )

        # Buffer para agregados de 1m
        self._minute_buffer.append({"ts": ts_int, **values})
        ts_minute = (ts_int // 60) * 60

        if ts_minute != self._last_minute_ts and self._last_minute_ts > 0:
            self._flush_minute(conn)
        self._last_minute_ts = ts_minute

        # Buffer para agregados de 1h
        self._hour_buffer.append({"ts": ts_int, **values})
        ts_hour = (ts_int // 3600) * 3600

        if ts_hour != self._last_hour_ts and self._last_hour_ts > 0:
            self._flush_hour(conn)
        self._last_hour_ts = ts_hour

        conn.commit()

    def _avg(self, rows: List[Dict], key: str) -> Optional[float]:
        vals = [r[key] for r in rows if r.get(key) is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 2)

    def _flush_minute(self, conn: sqlite3.Connection):
        if not self._minute_buffer:
            return
        rows = self._minute_buffer
        ts = (rows[0]["ts"] // 60) * 60
        conn.execute(
            "INSERT OR REPLACE INTO metrics_1m VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ts,
             self._avg(rows,"cpu_percent"), self._avg(rows,"cpu_temp"),
             self._avg(rows,"ram_percent"), self._avg(rows,"ram_used_mb"),
             self._avg(rows,"swap_percent"),
             self._avg(rows,"gpu_percent"), self._avg(rows,"gpu_temp"),
             self._avg(rows,"gpu_freq_mhz"),
             self._avg(rows,"disk_percent"),
             self._avg(rows,"net_rx_kbps"), self._avg(rows,"net_tx_kbps"),
             self._avg(rows,"fan_pwm"))
        )
        self._minute_buffer = []

    def _flush_hour(self, conn: sqlite3.Connection):
        if not self._hour_buffer:
            return
        rows = self._hour_buffer
        ts = (rows[0]["ts"] // 3600) * 3600
        conn.execute(
            "INSERT OR REPLACE INTO metrics_1h VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ts,
             self._avg(rows,"cpu_percent"), self._avg(rows,"cpu_temp"),
             self._avg(rows,"ram_percent"), self._avg(rows,"ram_used_mb"),
             self._avg(rows,"swap_percent"),
             self._avg(rows,"gpu_percent"), self._avg(rows,"gpu_temp"),
             self._avg(rows,"gpu_freq_mhz"),
             self._avg(rows,"disk_percent"),
             self._avg(rows,"net_rx_kbps"), self._avg(rows,"net_tx_kbps"),
             self._avg(rows,"fan_pwm"))
        )
        self._hour_buffer = []

    # ─── Query ────────────────────────────────────────────────────────────────

    def query(
        self,
        metric: str,
        start: int,
        end: int,
        resolution: str = "auto",
        limit: int = 1000,
    ) -> List[Dict]:
        """
        Consultar una métrica en un rango de tiempo.
        resolution: auto | 1s | 1m | 1h
        """
        span = end - start

        if resolution == "auto":
            if span <= 7200:       # ≤ 2h  → datos crudos
                resolution = "1s"
            elif span <= 86400 * 3: # ≤ 3d  → por minuto
                resolution = "1m"
            else:                   # > 3d  → por hora
                resolution = "1h"

        table = f"metrics_{resolution}"
        safe_metric = metric.replace("-", "_")

        # Validar que la columna existe
        valid_cols = {
            "cpu_percent","cpu_temp","ram_percent","ram_used_mb","swap_percent",
            "gpu_percent","gpu_temp","gpu_freq_mhz","disk_percent",
            "net_rx_kbps","net_tx_kbps","fan_pwm"
        }
        if safe_metric not in valid_cols:
            return []

        conn = self._get_conn()
        rows = conn.execute(
            f"SELECT ts, {safe_metric} as value FROM {table} "
            f"WHERE ts >= ? AND ts <= ? AND {safe_metric} IS NOT NULL "
            f"ORDER BY ts ASC LIMIT ?",
            (start, end, limit)
        ).fetchall()

        return [{"ts": r["ts"], "value": r["value"]} for r in rows]

    def query_multi(
        self,
        metrics: List[str],
        start: int,
        end: int,
        resolution: str = "auto",
        limit: int = 600,
    ) -> Dict[str, List[Dict]]:
        """Consultar varias métricas a la vez"""
        return {m: self.query(m, start, end, resolution, limit) for m in metrics}

    def get_stats(self) -> Dict:
        """Estadísticas de la base de datos"""
        conn = self._get_conn()
        stats = {}
        for table in ("metrics_1s", "metrics_1m", "metrics_1h"):
            row = conn.execute(
                f"SELECT COUNT(*) as cnt, MIN(ts) as oldest, MAX(ts) as newest FROM {table}"
            ).fetchone()
            stats[table] = {
                "count":  row["cnt"],
                "oldest": row["oldest"],
                "newest": row["newest"],
            }

        size_bytes = DB_PATH.stat().st_size if DB_PATH.exists() else 0
        stats["db_size_mb"] = round(size_bytes / 1024 / 1024, 2)
        return stats

    # ─── Cleanup ──────────────────────────────────────────────────────────────

    def cleanup_old(self):
        """Eliminar datos más antiguos que la retención configurada"""
        now = int(time.time())
        conn = self._get_conn()
        for resolution, max_age in RETENTION.items():
            table = f"metrics_{resolution}"
            cutoff = now - max_age
            result = conn.execute(
                f"DELETE FROM {table} WHERE ts < ?", (cutoff,)
            )
            if result.rowcount > 0:
                logger.info(f"Cleanup {table}: deleted {result.rowcount} rows")
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        conn.commit()

    async def cleanup_loop(self):
        """Ejecutar limpieza cada hora en background"""
        while True:
            await asyncio.sleep(3600)
            try:
                await asyncio.get_event_loop().run_in_executor(None, self.cleanup_old)
            except Exception as e:
                logger.error(f"Cleanup error: {e}")

    async def insert_async(self, ts: float, system: Dict, gpu: Dict):
        """Insert no bloqueante para usar desde asyncio"""
        await asyncio.get_event_loop().run_in_executor(
            None, self.insert, ts, system, gpu
        )

    async def query_async(self, metric, start, end, resolution="auto", limit=600):
        return await asyncio.get_event_loop().run_in_executor(
            None, self.query, metric, start, end, resolution, limit
        )

    async def query_multi_async(self, metrics, start, end, resolution="auto", limit=600):
        return await asyncio.get_event_loop().run_in_executor(
            None, self.query_multi, metrics, start, end, resolution, limit
        )
