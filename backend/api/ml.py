import os
"""
Jetson Dashboard - ML API
REST endpoints for ML job management, model browser, dataset browser.
Streaming logs via SSE (Server-Sent Events).
"""

import asyncio
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ml_runner import get_ml_runner, ML_WORKSPACE

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Built-in example scripts ──────────────────────────────────────────────────
EXAMPLE_SCRIPTS = {
    "system_check": {
        "name": "System Check",
        "description": "Verify ML environment — Python, OpenCV, NumPy, sklearn",
        "script": """\
import sys, platform
print(f"Python: {sys.version.split()[0]}")
print(f"Platform: {platform.machine()}")

libs = {"numpy":"numpy","opencv":"cv2","sklearn":"sklearn",
        "pandas":"pandas","matplotlib":"matplotlib"}
for name, mod in libs.items():
    try:
        m = __import__(mod)
        print(f"✅ {name}: {m.__version__}")
    except Exception as e:
        print(f"❌ {name}: {e}")

# GPU devices
import os
gpu_devs = [d for d in ["/dev/nvhost-ctrl","/dev/nvhost-gpu","/dev/nvmap"] if os.path.exists(d)]
print(f"GPU devices: {len(gpu_devs)} found")

# Workspace
ws = "/workspace"
for d in ["models","datasets","projects"]:
    p = os.path.join(ws, d)
    n = len(os.listdir(p)) if os.path.isdir(p) else 0
    print(f"  {d}/: {n} items")

print("System check complete ✅")
""",
    },
    "train_classifier": {
        "name": "Train Image Classifier (sklearn)",
        "description": "Train a simple classifier on sample data using scikit-learn",
        "script": """\
import numpy as np
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import pickle, os, time

print("Loading digits dataset...")
data = load_digits()
X, y = data.data, data.target
print(f"Dataset: {X.shape[0]} samples, {X.shape[1]} features, {len(data.target_names)} classes")

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
print(f"Train: {len(X_train)} | Test: {len(X_test)}")

print("\\nTraining Random Forest classifier...")
t0 = time.time()
clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
clf.fit(X_train, y_train)
train_time = time.time() - t0
print(f"Training time: {train_time:.2f}s")

y_pred = clf.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"\\nAccuracy: {acc*100:.2f}%")
print(classification_report(y_test, y_pred, target_names=[str(i) for i in data.target_names]))

# Save model
model_path = "/workspace/models/digits_classifier.pkl"
with open(model_path, "wb") as f:
    pickle.dump(clf, f)
print(f"\\nModel saved to: {model_path}")
print(f"Model size: {os.path.getsize(model_path)/1024:.1f} KB")
print("\\nTraining complete ✅")
""",
    },
    "opencv_detection": {
        "name": "Object Detection (OpenCV DNN + MobileNet)",
        "description": "Run MobileNetSSD inference on a test image (models must be in workspace/models/)",
        "script": """import cv2, numpy as np, os, time

print("OpenCV DNN Object Detection")
print(f"OpenCV version: {cv2.__version__}")

MODEL_DIR = "/workspace/models"
PROTO   = os.path.join(MODEL_DIR, "MobileNetSSD_deploy.prototxt")
WEIGHTS = os.path.join(MODEL_DIR, "MobileNetSSD_deploy.caffemodel")

CLASSES = ["background","aeroplane","bicycle","bird","boat","bottle",
           "bus","car","cat","chair","cow","diningtable","dog","horse",
           "motorbike","person","pottedplant","sheep","sofa","train","tvmonitor"]

# Check models present
if not os.path.exists(PROTO) or not os.path.exists(WEIGHTS):
    print("ERROR: MobileNetSSD model files not found in /workspace/models/")
    print("Download them first from the Jetson terminal:")
    print("  wget -O ~/jetson-workspace/models/MobileNetSSD_deploy.prototxt \\")
    print("    https://raw.githubusercontent.com/PINTO0309/MobileNet-SSD-RealSense/master/caffemodel/MobileNetSSD/MobileNetSSD_deploy.prototxt")
    print("  wget -O ~/jetson-workspace/models/MobileNetSSD_deploy.caffemodel \\")
    print("    https://github.com/PINTO0309/MobileNet-SSD-RealSense/raw/master/caffemodel/MobileNetSSD/MobileNetSSD_deploy.caffemodel")
    raise SystemExit(1)

print(f"prototxt:   {os.path.getsize(PROTO):,} bytes")
print(f"caffemodel: {os.path.getsize(WEIGHTS)/1024/1024:.1f} MB")

print("\nLoading network...")
net = cv2.dnn.readNetFromCaffe(PROTO, WEIGHTS)
print("Network loaded ✅")

# Synthetic test image
img = np.zeros((300, 300, 3), dtype=np.uint8)
img[:150, :] = [100, 150, 200]
img[150:, :] = [60, 90, 120]
cv2.rectangle(img, (50, 80), (200, 220), (0, 200, 0), -1)
cv2.circle(img, (230, 60), 40, (200, 80, 0), -1)

blob = cv2.dnn.blobFromImage(
    cv2.resize(img, (300, 300)), 0.007843, (300, 300), 127.5
)
net.setInput(blob)

t0 = time.time()
detections = net.forward()
inf_ms = (time.time() - t0) * 1000

print(f"\nInference time: {inf_ms:.1f} ms")
print(f"Detections tensor: {detections.shape}")

found = 0
for i in range(detections.shape[2]):
    conf = float(detections[0, 0, i, 2])
    if conf > 0.2:
        cid   = int(detections[0, 0, i, 1])
        label = CLASSES[cid] if cid < len(CLASSES) else "unknown"
        print(f"  [{i}] {label:15s} confidence={conf*100:.1f}%")
        found += 1

print(f"\nDetections above 20% confidence: {found}")
print(f"CPU inference @ {1000/inf_ms:.1f} FPS theoretical")
print("OpenCV DNN inference complete ✅")
""",
    },
        "data_analysis": {
        "name": "Data Analysis (pandas + matplotlib)",
        "description": "Analyze and visualize a sample dataset",
        "script": """\
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # No display needed
import matplotlib.pyplot as plt
import os, time

print("Data Analysis with pandas + matplotlib")

# Generate sample robot sensor data
np.random.seed(42)
n = 1000
t = np.linspace(0, 10, n)
df = pd.DataFrame({
    "time":        t,
    "left_motor":  np.clip(np.sin(t) * 0.8 + np.random.normal(0, 0.05, n), -1, 1),
    "right_motor": np.clip(np.cos(t) * 0.8 + np.random.normal(0, 0.05, n), -1, 1),
    "battery_v":   12.4 - t * 0.1 + np.random.normal(0, 0.02, n),
    "cpu_temp":    45 + t * 0.5 + np.random.normal(0, 0.5, n),
})

print(f"\\nDataset shape: {df.shape}")
print("\\nBasic statistics:")
print(df.describe().round(3))

print("\\nCorrelation matrix:")
print(df.corr().round(3))

# Plot
fig, axes = plt.subplots(2, 2, figsize=(10, 8))
fig.suptitle("JetBot Sensor Analysis", fontsize=14, fontweight="bold")

axes[0,0].plot(df["time"], df["left_motor"], label="Left", alpha=0.7)
axes[0,0].plot(df["time"], df["right_motor"], label="Right", alpha=0.7)
axes[0,0].set_title("Motor Throttle"); axes[0,0].legend(); axes[0,0].set_xlabel("Time (s)")

axes[0,1].hist(df["battery_v"], bins=30, color="orange", alpha=0.7)
axes[0,1].set_title("Battery Voltage Distribution"); axes[0,1].set_xlabel("Voltage (V)")

axes[1,0].plot(df["time"], df["cpu_temp"], color="red", alpha=0.8)
axes[1,0].set_title("CPU Temperature"); axes[1,0].set_xlabel("Time (s)"); axes[1,0].set_ylabel("°C")

axes[1,1].scatter(df["left_motor"], df["right_motor"], alpha=0.1, s=5)
axes[1,1].set_title("Motor Correlation"); axes[1,1].set_xlabel("Left"); axes[1,1].set_ylabel("Right")

plt.tight_layout()
out_path = "/workspace/projects/sensor_analysis.png"
os.makedirs(os.path.dirname(out_path), exist_ok=True)
plt.savefig(out_path, dpi=100, bbox_inches="tight")
plt.close()
print(f"\\nChart saved to: {out_path}")
print("Data analysis complete ✅")
""",
    },
    "camera_detection": {
        "name": "Live Camera Detection (IMX219 + MobileNetSSD)",
        "description": "Capture a frame from the CSI camera and run MobileNetSSD object detection",
        "script": open(
            "/app/ml_templates/camera_detection.py"
        ).read() if os.path.exists("/app/ml_templates/camera_detection.py") else
        "print('Template not found — copy camera_detection.py to /app/data/ml_templates/')",
    }
}

# ── Request models ────────────────────────────────────────────────────────────

class JobSubmit(BaseModel):
    name:   str
    script: str

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/ml/status")
async def ml_status():
    """ML runner status — available, current job, GPU devices."""
    return get_ml_runner().get_status()


@router.get("/ml/jobs")
async def ml_list_jobs(limit: int = 50):
    """List recent ML jobs."""
    return get_ml_runner().list_jobs(limit=limit)


@router.get("/ml/jobs/{job_id}")
async def ml_get_job(job_id: str):
    """Get a single job with log."""
    job = get_ml_runner().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/ml/jobs/{job_id}/log")
async def ml_job_log(job_id: str):
    """Get full log for a job."""
    return {"log": get_ml_runner().get_job_log(job_id)}


@router.get("/ml/jobs/{job_id}/stream")
async def ml_stream_log(job_id: str):
    """
    Stream live log for a running job via SSE.
    Frontend polls this while job is running.
    """
    runner = get_ml_runner()

    async def generate():
        last_len = 0
        for _ in range(1200):   # max 120s polling
            log = runner.get_job_log(job_id)
            lines = log.splitlines()
            if len(lines) > last_len:
                for line in lines[last_len:]:
                    yield f"data: {line}\n\n"
                last_len = len(lines)
            job = runner.get_job(job_id)
            if job and job["status"] not in ("running", "pending"):
                yield f"data: __DONE__\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/ml/jobs")
async def ml_submit_job(req: JobSubmit):
    """Submit a new ML job."""
    runner = get_ml_runner()
    if not runner.is_available():
        raise HTTPException(status_code=503, detail=runner.get_status()["error"])
    try:
        job_id = runner.submit_job(name=req.name, script=req.script)
        return {"job_id": job_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ml/jobs/{job_id}/cancel")
async def ml_cancel_job(job_id: str):
    """Cancel a running job."""
    return get_ml_runner().cancel_job(job_id)


@router.delete("/ml/jobs/{job_id}")
async def ml_delete_job(job_id: str):
    """Delete a job record from history."""
    import sqlite3
    from services.ml_runner import _get_db
    conn = _get_db()
    conn.execute("DELETE FROM ml_jobs WHERE id=?", (job_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.get("/ml/models")
async def ml_list_models():
    """List model files in workspace/models."""
    return get_ml_runner().list_models()


@router.delete("/ml/models/{name}")
async def ml_delete_model(name: str):
    """Delete a model file."""
    import re
    if ".." in name or "/" in name:
        raise HTTPException(status_code=400, detail="Invalid name")
    path = os.path.join(ML_WORKSPACE, "models", name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Model not found")
    os.remove(path)
    return {"ok": True}


@router.get("/ml/datasets")
async def ml_list_datasets():
    """List datasets in workspace/datasets."""
    return get_ml_runner().list_datasets()


@router.get("/ml/examples")
async def ml_list_examples():
    """List built-in example scripts."""
    return [
        {"id": k, "name": v["name"], "description": v["description"]}
        for k, v in EXAMPLE_SCRIPTS.items()
    ]


@router.get("/ml/examples/{example_id}")
async def ml_get_example(example_id: str):
    """Get a built-in example script."""
    if example_id not in EXAMPLE_SCRIPTS:
        raise HTTPException(status_code=404, detail="Example not found")
    return EXAMPLE_SCRIPTS[example_id]
