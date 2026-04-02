"""
Jetson Dashboard - ML Runner Service
Executes ML jobs inside the jetson-ai Docker container.
Uses Docker SDK — no nsenter needed.

Container: jetson-ai:latest
Workspace: /home/jetbot/jetson-workspace mounted at /workspace
GPU devices: /dev/nvhost-* mounted for CUDA access
"""

import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from typing import Optional, Callable

import docker
from docker.errors import DockerException, ImageNotFound

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
ML_IMAGE      = "jetson-ai:latest"
ML_WORKSPACE  = "/home/jetbot/jetson-workspace"
ML_DB         = "/app/data/ml_jobs.db"
ML_SCRIPTS    = "/home/jetbot/jetson-workspace/scripts"  # Inside workspace — accessible by jetson-ai

GPU_DEVICES = [
    "/dev/nvhost-ctrl",
    "/dev/nvhost-ctrl-gpu",
    "/dev/nvhost-gpu",
    "/dev/nvhost-as-gpu",
    "/dev/nvmap",
]

# Camera device — mounted if available
CAMERA_DEVICE = "/dev/video0"

# ── Database ──────────────────────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(ML_DB)
    conn.row_factory = sqlite3.Row
    return conn

def _init_db():
    os.makedirs(os.path.dirname(ML_DB), exist_ok=True)
    os.makedirs(ML_SCRIPTS, exist_ok=True)
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ml_jobs (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            script      TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  TEXT NOT NULL,
            started_at  TEXT,
            finished_at TEXT,
            duration_s  REAL,
            exit_code   INTEGER,
            error       TEXT,
            log         TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS ml_models (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            path        TEXT NOT NULL,
            type        TEXT,
            size_bytes  INTEGER,
            created_at  TEXT NOT NULL,
            notes       TEXT
        );
    """)
    conn.commit()
    conn.close()
    logger.info("[INFO] ML database initialized")

# ── ML Runner ─────────────────────────────────────────────────────────────────

class MLRunner:
    """
    Runs ML jobs inside jetson-ai container.
    Thread-safe. One job at a time (Jetson Nano has limited resources).
    """

    def __init__(self):
        self._client      = None
        self._available   = False
        self._error       = ""
        self._lock        = threading.Lock()
        self._current_job = None   # job id currently running
        self._log_buffer  = {}     # job_id → list of log lines (ring buffer)
        self._log_max     = 500    # max lines per job in memory
        _init_db()
        self._init_docker()

    def _init_docker(self):
        try:
            self._client = docker.from_env()
            self._client.ping()
            # Check jetson-ai image exists
            self._client.images.get(ML_IMAGE)
            self._available = True
            logger.info(f"[INFO] MLRunner ready — image {ML_IMAGE} found")
        except ImageNotFound:
            self._available = False
            self._error = f"Docker image '{ML_IMAGE}' not found. Build it first."
            logger.warning(f"[WARNING] MLRunner: {self._error}")
        except Exception as e:
            self._available = False
            self._error = str(e)
            logger.warning(f"[WARNING] MLRunner unavailable: {e}")

    def is_available(self) -> bool:
        return self._available

    def get_status(self) -> dict:
        return {
            "available":    self._available,
            "error":        self._error if not self._available else None,
            "image":        ML_IMAGE,
            "current_job":  self._current_job,
            "workspace":    ML_WORKSPACE,
            "gpu_devices":  [d for d in GPU_DEVICES if os.path.exists(d)],
        }

    # ── Job management ────────────────────────────────────────────────────────

    def list_jobs(self, limit: int = 50) -> list:
        conn = _get_db()
        rows = conn.execute(
            "SELECT * FROM ml_jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_job(self, job_id: str) -> Optional[dict]:
        conn = _get_db()
        row = conn.execute("SELECT * FROM ml_jobs WHERE id=?", (job_id,)).fetchone()
        conn.close()
        if not row:
            return None
        d = dict(row)
        # Attach live log buffer if job is running
        if job_id in self._log_buffer:
            d["log"] = "\n".join(self._log_buffer[job_id])
        return d

    def get_job_log(self, job_id: str) -> str:
        if job_id in self._log_buffer:
            return "\n".join(self._log_buffer[job_id])
        conn = _get_db()
        row = conn.execute("SELECT log FROM ml_jobs WHERE id=?", (job_id,)).fetchone()
        conn.close()
        return row["log"] if row else ""

    def cancel_job(self, job_id: str) -> dict:
        """Stop a running job by killing its container."""
        try:
            containers = self._client.containers.list(
                filters={"name": f"jd-ml-{job_id[:8]}"}
            )
            for c in containers:
                c.kill()
                c.remove(force=True)
            self._update_job(job_id, status="cancelled", exit_code=-1)
            if job_id == self._current_job:
                self._current_job = None
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def submit_job(self, name: str, script: str,
                   on_log: Optional[Callable] = None) -> str:
        """
        Submit a new ML job. Runs in a background thread.
        Returns job_id immediately.
        """
        if not self._available:
            raise RuntimeError(self._error)

        job_id = str(uuid.uuid4())
        now    = datetime.utcnow().isoformat()

        conn = _get_db()
        conn.execute(
            "INSERT INTO ml_jobs (id,name,script,status,created_at) VALUES (?,?,?,?,?)",
            (job_id, name, script, "pending", now)
        )
        conn.commit()
        conn.close()

        self._log_buffer[job_id] = []

        thread = threading.Thread(
            target=self._run_job,
            args=(job_id, script, on_log),
            daemon=True,
            name=f"ml-job-{job_id[:8]}"
        )
        thread.start()
        return job_id

    def _run_job(self, job_id: str, script: str,
                 on_log: Optional[Callable] = None):
        """Background thread: runs script in jetson-ai container."""
        with self._lock:
            self._current_job = job_id

        started = datetime.utcnow().isoformat()
        self._update_job(job_id, status="running", started_at=started)
        self._append_log(job_id, f"[{started}] Job started", on_log)

        container_name = f"jd-ml-{job_id[:8]}"
        t0 = time.time()
        exit_code = -1
        error_msg = None

        # Build device list — GPU + camera if available
        all_devices = GPU_DEVICES + [CAMERA_DEVICE]
        devices = [f"{d}:{d}" for d in all_devices if os.path.exists(d)]

        try:
            # Write script to workspace/scripts/ — accessible inside container at /workspace/scripts/
            scripts_dir = os.path.join(ML_WORKSPACE, "scripts")
            os.makedirs(scripts_dir, exist_ok=True)
            script_path = os.path.join(scripts_dir, f"{job_id}.py")
            with open(script_path, "w") as f:
                f.write(script)

            container = self._client.containers.run(
                ML_IMAGE,
                command=f"python3 /workspace/scripts/{job_id}.py",
                name=container_name,
                detach=True,
                remove=False,
                volumes={
                    ML_WORKSPACE: {"bind": "/workspace", "mode": "rw"},
                },
                devices=devices,
                environment={
                    "PYTHONPATH": "/usr/local/lib/python3.12/site-packages",
                    "LD_LIBRARY_PATH": (
                        "/usr/lib/aarch64-linux-gnu/tegra-egl:"
                        "/usr/lib/aarch64-linux-gnu/tegra:"
                        "/usr/lib/aarch64-linux-gnu"
                    ),
                    "JETSON_TESTING_MODEL_NAME": "JETSON_NANO",
                },
                network_mode="host",
                user="root",
            )

            self._append_log(job_id, f"Container {container_name} started", on_log)

            # Stream logs
            for chunk in container.logs(stream=True, follow=True):
                line = chunk.decode("utf-8", errors="replace").rstrip()
                if line:
                    self._append_log(job_id, line, on_log)

            # Wait for exit
            result   = container.wait(timeout=3600)
            exit_code = result.get("StatusCode", -1)
            container.remove(force=True)

            # Clean up script file
            try:
                os.remove(script_path)
            except Exception:
                pass
            # Also clean from workspace/scripts
            try:
                ws_script = os.path.join(ML_WORKSPACE, "scripts", f"{job_id}.py")
                if os.path.exists(ws_script):
                    os.remove(ws_script)
            except Exception:
                pass

        except Exception as e:
            error_msg = str(e)
            self._append_log(job_id, f"ERROR: {e}", on_log)
            logger.error(f"[ERROR] ML job {job_id} failed: {e}")
            # Try cleanup
            try:
                c = self._client.containers.get(container_name)
                c.remove(force=True)
            except Exception:
                pass

        duration = round(time.time() - t0, 2)
        finished = datetime.utcnow().isoformat()
        status   = "completed" if exit_code == 0 else ("failed" if exit_code != -1 else "error")

        # Save final log to DB
        full_log = "\n".join(self._log_buffer.get(job_id, []))
        self._update_job(
            job_id,
            status=status,
            finished_at=finished,
            duration_s=duration,
            exit_code=exit_code,
            error=error_msg,
            log=full_log,
        )

        self._append_log(
            job_id,
            f"[{finished}] Job {status} — exit_code={exit_code} duration={duration}s",
            on_log
        )

        with self._lock:
            if self._current_job == job_id:
                self._current_job = None

        # Keep log buffer for a while then clean up
        def _cleanup():
            time.sleep(300)
            self._log_buffer.pop(job_id, None)
        threading.Thread(target=_cleanup, daemon=True).start()

    def _append_log(self, job_id: str, line: str,
                    on_log: Optional[Callable] = None):
        buf = self._log_buffer.setdefault(job_id, [])
        buf.append(line)
        if len(buf) > self._log_max:
            buf.pop(0)
        if on_log:
            try:
                on_log(job_id, line)
            except Exception:
                pass

    def _update_job(self, job_id: str, **kwargs):
        if not kwargs:
            return
        cols = ", ".join(f"{k}=?" for k in kwargs)
        vals = list(kwargs.values()) + [job_id]
        conn = _get_db()
        conn.execute(f"UPDATE ml_jobs SET {cols} WHERE id=?", vals)
        conn.commit()
        conn.close()

    # ── Model management ──────────────────────────────────────────────────────

    def list_models(self) -> list:
        """List models from workspace/models directory + DB metadata."""
        models_dir = os.path.join(ML_WORKSPACE, "models")
        result = []
        if not os.path.isdir(models_dir):
            return result
        for fname in sorted(os.listdir(models_dir)):
            fpath = os.path.join(models_dir, fname)
            if os.path.isfile(fpath):
                ext = os.path.splitext(fname)[1].lower()
                mtype = {
                    ".onnx": "ONNX",
                    ".pt":   "PyTorch",
                    ".pth":  "PyTorch",
                    ".pkl":  "scikit-learn",
                    ".h5":   "Keras/TF",
                    ".trt":  "TensorRT",
                    ".pb":   "TensorFlow",
                }.get(ext, "Unknown")
                result.append({
                    "name":       fname,
                    "path":       fpath,
                    "type":       mtype,
                    "size_bytes": os.path.getsize(fpath),
                    "modified":   datetime.fromtimestamp(
                        os.path.getmtime(fpath)).isoformat(),
                })
        return result

    def list_datasets(self) -> list:
        """List items in workspace/datasets."""
        datasets_dir = os.path.join(ML_WORKSPACE, "datasets")
        result = []
        if not os.path.isdir(datasets_dir):
            return result
        for name in sorted(os.listdir(datasets_dir)):
            fpath = os.path.join(datasets_dir, name)
            size  = 0
            if os.path.isfile(fpath):
                size = os.path.getsize(fpath)
                kind = "file"
            elif os.path.isdir(fpath):
                kind = "directory"
                for root, _, files in os.walk(fpath):
                    for f in files:
                        try:
                            size += os.path.getsize(os.path.join(root, f))
                        except Exception:
                            pass
            else:
                continue
            result.append({
                "name":       name,
                "type":       kind,
                "size_bytes": size,
                "modified":   datetime.fromtimestamp(
                    os.path.getmtime(fpath)).isoformat(),
            })
        return result


# ── Singleton ─────────────────────────────────────────────────────────────────
_runner: Optional[MLRunner] = None

def get_ml_runner() -> MLRunner:
    global _runner
    if _runner is None:
        _runner = MLRunner()
    return _runner
