"""
Scheduler API - Task scheduling for Jetson Dashboard
Stores tasks in data/scheduler.json
Executes commands on the host via nsenter
"""
import asyncio
import json
import logging
import subprocess
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

DATA_DIR       = Path("/app/data")
SCHEDULER_FILE = DATA_DIR / "scheduler.json"

# ── Cron-like schedule types ──────────────────────────────────────────────────
# Instead of raw cron expressions we use a simple structured format
# that's easier to understand and display in the UI

SCHEDULE_TYPES = {
    "every_minute":  {"label": "Every minute",        "seconds": 60},
    "every_5min":    {"label": "Every 5 minutes",     "seconds": 300},
    "every_15min":   {"label": "Every 15 minutes",    "seconds": 900},
    "every_30min":   {"label": "Every 30 minutes",    "seconds": 1800},
    "every_hour":    {"label": "Every hour",          "seconds": 3600},
    "every_6h":      {"label": "Every 6 hours",       "seconds": 21600},
    "every_12h":     {"label": "Every 12 hours",      "seconds": 43200},
    "daily":         {"label": "Daily",               "seconds": 86400},
    "weekly":        {"label": "Weekly",              "seconds": 604800},
}

# ── Preset tasks useful for Jetson ────────────────────────────────────────────
PRESET_TASKS = [
    {
        "name":        "System cleanup",
        "command":     "sudo systemctl reset-failed",
        "schedule":    "weekly",
        "description": "Clean failed systemd transient units",
    },
    {
        "name":        "Docker cleanup",
        "command":     "docker system prune -f",
        "schedule":    "weekly",
        "description": "Remove unused Docker images and containers",
    },
    {
        "name":        "Check disk space",
        "command":     "df -h / | tail -1",
        "schedule":    "daily",
        "description": "Log current disk usage",
    },
    {
        "name":        "Sync system clock",
        "command":     "sudo chronyc makestep",
        "schedule":    "daily",
        "description": "Force NTP time sync",
    },
]


# ── Storage ───────────────────────────────────────────────────────────────────

def _load_tasks() -> list:
    try:
        if SCHEDULER_FILE.exists():
            return json.loads(SCHEDULER_FILE.read_text())
    except Exception:
        pass
    return []

def _save_tasks(tasks: list):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCHEDULER_FILE.write_text(json.dumps(tasks, indent=2))


# ── Task execution ────────────────────────────────────────────────────────────

def _run_task(task: dict) -> dict:
    """Execute a task command on the host via nsenter and return result."""
    cmd     = task["command"]
    task_id = task["id"]
    started = datetime.utcnow().isoformat() + "Z"

    logger.info(f"Scheduler: running task '{task['name']}' — {cmd}")

    try:
        # Run on host via nsenter (same pattern as rest of the dashboard)
        full_cmd = f"nsenter --target 1 --mount -- bash -c {json.dumps(cmd)}"
        result = subprocess.run(
            ["/bin/bash", "-c", full_cmd],
            capture_output=True,
            timeout=int(task.get("timeout", 60)),
        )
        output   = result.stdout.decode(errors="replace").strip()
        stderr   = result.stderr.decode(errors="replace").strip()
        success  = result.returncode == 0
        combined = output + ("\n" + stderr if stderr else "")

    except subprocess.TimeoutExpired:
        success  = False
        combined = f"Task timed out after {task.get('timeout', 60)}s"
    except Exception as e:
        success  = False
        combined = str(e)

    finished = datetime.utcnow().isoformat() + "Z"

    run_record = {
        "started":  started,
        "finished": finished,
        "success":  success,
        "output":   combined[:2000],  # cap output at 2KB
        "exit_code": result.returncode if success else -1,
    }

    logger.info(f"Scheduler: task '{task['name']}' {'OK' if success else 'FAILED'}")
    return run_record


def _next_run_ts(task: dict) -> Optional[float]:
    """Calculate next run timestamp based on schedule and last run."""
    schedule = task.get("schedule")
    if schedule not in SCHEDULE_TYPES:
        return None

    interval = SCHEDULE_TYPES[schedule]["seconds"]
    last_run = task.get("last_run_ts")

    if not last_run:
        # Never run — schedule from now
        return time.time() + interval

    return float(last_run) + interval


# ── Scheduler loop ────────────────────────────────────────────────────────────

class TaskScheduler:
    def __init__(self):
        self._running  = False
        self._thread   = None
        self._lock     = threading.Lock()

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread  = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("Task scheduler started")

    def stop(self):
        self._running = False
        logger.info("Task scheduler stopped")

    def run_now(self, task_id: str) -> Optional[dict]:
        """Execute a task immediately regardless of schedule."""
        with self._lock:
            tasks = _load_tasks()
            task  = next((t for t in tasks if t["id"] == task_id), None)
            if not task:
                return None

        result = _run_task(task)
        self._record_run(task_id, result)
        return result

    def _record_run(self, task_id: str, run_record: dict):
        with self._lock:
            tasks = _load_tasks()
            for task in tasks:
                if task["id"] == task_id:
                    task["last_run"]    = run_record["started"]
                    task["last_run_ts"] = time.time()
                    task["last_result"] = "success" if run_record["success"] else "failed"
                    task["last_output"] = run_record["output"]
                    # Keep last 10 runs in history
                    history = task.get("history", [])
                    history.insert(0, run_record)
                    task["history"] = history[:10]
                    break
            _save_tasks(tasks)

    def _loop(self):
        while self._running:
            try:
                now   = time.time()
                tasks = _load_tasks()
                for task in tasks:
                    if not task.get("enabled", True):
                        continue
                    next_run = _next_run_ts(task)
                    if next_run and now >= next_run:
                        # Run in separate thread to not block the loop
                        t = threading.Thread(
                            target=self._execute_and_record,
                            args=(task["id"],),
                            daemon=True,
                        )
                        t.start()
            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")

            time.sleep(10)  # Check every 10 seconds

    def _execute_and_record(self, task_id: str):
        with self._lock:
            tasks = _load_tasks()
            task  = next((t for t in tasks if t["id"] == task_id), None)
            if not task:
                return

        result = _run_task(task)
        self._record_run(task_id, result)


# Singleton
_scheduler = TaskScheduler()

def get_scheduler() -> TaskScheduler:
    return _scheduler


# ── Models ────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    name:        str
    command:     str
    schedule:    str
    description: Optional[str] = ""
    enabled:     bool = True
    timeout:     int  = 60   # seconds

class TaskUpdate(BaseModel):
    name:        Optional[str]  = None
    command:     Optional[str]  = None
    schedule:    Optional[str]  = None
    description: Optional[str] = None
    enabled:     Optional[bool] = None
    timeout:     Optional[int]  = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/scheduler/tasks")
async def list_tasks():
    """List all scheduled tasks with next run time."""
    tasks = _load_tasks()
    now   = time.time()
    result = []
    for task in tasks:
        next_ts  = _next_run_ts(task)
        next_run = None
        if next_ts:
            delta = next_ts - now
            if delta > 0:
                next_run = datetime.utcfromtimestamp(next_ts).isoformat() + "Z"
            else:
                next_run = "overdue"
        result.append({
            **task,
            "next_run":      next_run,
            "schedule_label": SCHEDULE_TYPES.get(task.get("schedule", ""), {}).get("label", task.get("schedule")),
        })
    return {"tasks": result}


@router.post("/scheduler/tasks")
async def create_task(req: TaskCreate):
    """Create a new scheduled task."""
    if req.schedule not in SCHEDULE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid schedule. Valid: {list(SCHEDULE_TYPES.keys())}")
    if not req.command.strip():
        raise HTTPException(status_code=400, detail="Command cannot be empty")
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    task = {
        "id":          str(uuid4()),
        "name":        req.name.strip(),
        "command":     req.command.strip(),
        "schedule":    req.schedule,
        "description": req.description or "",
        "enabled":     req.enabled,
        "timeout":     req.timeout,
        "created_at":  datetime.utcnow().isoformat() + "Z",
        "last_run":    None,
        "last_run_ts": None,
        "last_result": None,
        "last_output": None,
        "history":     [],
    }

    tasks = _load_tasks()
    tasks.append(task)
    _save_tasks(tasks)

    logger.info(f"Task created: {task['name']} ({task['schedule']})")
    return task


@router.patch("/scheduler/tasks/{task_id}")
async def update_task(task_id: str, req: TaskUpdate):
    """Update an existing task."""
    tasks = _load_tasks()
    task  = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if req.name        is not None: task["name"]        = req.name.strip()
    if req.command     is not None: task["command"]     = req.command.strip()
    if req.description is not None: task["description"] = req.description
    if req.enabled     is not None: task["enabled"]     = req.enabled
    if req.timeout     is not None: task["timeout"]     = req.timeout
    if req.schedule    is not None:
        if req.schedule not in SCHEDULE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid schedule")
        task["schedule"] = req.schedule

    _save_tasks(tasks)
    return task


@router.delete("/scheduler/tasks/{task_id}")
async def delete_task(task_id: str):
    """Delete a task."""
    tasks = _load_tasks()
    original_len = len(tasks)
    tasks = [t for t in tasks if t["id"] != task_id]
    if len(tasks) == original_len:
        raise HTTPException(status_code=404, detail="Task not found")
    _save_tasks(tasks)
    return {"deleted": task_id}


@router.post("/scheduler/tasks/{task_id}/run")
async def run_task_now(task_id: str):
    """Execute a task immediately."""
    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _scheduler.run_now, task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.get("/scheduler/tasks/{task_id}/history")
async def get_task_history(task_id: str):
    """Get execution history for a task."""
    tasks = _load_tasks()
    task  = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"history": task.get("history", [])}


@router.get("/scheduler/schedules")
async def list_schedules():
    """List available schedule options."""
    return {
        "schedules": [
            {"value": k, "label": v["label"], "seconds": v["seconds"]}
            for k, v in SCHEDULE_TYPES.items()
        ]
    }


@router.get("/scheduler/presets")
async def list_presets():
    """List preset tasks ready to use."""
    return {"presets": PRESET_TASKS}


@router.post("/scheduler/presets/{preset_index}")
async def create_from_preset(preset_index: int):
    """Create a task from a preset."""
    if preset_index < 0 or preset_index >= len(PRESET_TASKS):
        raise HTTPException(status_code=404, detail="Preset not found")

    preset = PRESET_TASKS[preset_index]
    req    = TaskCreate(**preset)
    return await create_task(req)
