"""
Camera API - Jetson Dashboard
CSI IMX219: jetson-cam-start.sh → jetson-capture.py (3264x2464, scale=0.2) → JPEG
USB: MJPEG/YUYV via v4l2-ctl
Kill: jetson-cam-stop.sh → vi-output muere solo al cerrarse fd

Los scripts jetson-cam-start.sh y jetson-cam-stop.sh son creados
automáticamente por install.sh en /usr/local/bin/.
"""
import asyncio
import io
import logging
import subprocess
import threading
import time
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from PIL import Image

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Config ─────────────────────────────────────────────────────────────────────
CAMERA_DEVICE  = "/dev/video0"
OUT_WIDTH      = 1280
OUT_HEIGHT     = 720
JPEG_QUALITY   = 75
AUTO_STOP_SECS = 15

# CSI: jetson-capture.py a 3264x2464 con scale=0.2 → salida ~652x492
# Tiempo confirmado: ~2.3s por frame
CSI_INTERVAL   = 1.5  # jetson-stream-capture.py tarda ~1.1s
CSI_SCALE      = "0.2"
CSI_EXPOSURE   = "50000"   # interior. Exterior/auto: 2495
CSI_OUT        = "/tmp/jetson_dashboard_frame.jpg"

# Scripts instalados por install.sh
CAM_START = "/usr/local/bin/jetson-cam-start.sh"
CAM_STOP  = "/usr/local/bin/jetson-cam-stop.sh"

CSI_WIDTH  = 3264
CSI_HEIGHT = 2464
USB_WIDTH  = 1280
USB_HEIGHT = 720

CAM_UNKNOWN = "unknown"
CAM_CSI     = "csi"
CAM_USB_MJP = "usb_mjpeg"
CAM_USB_YUV = "usb_yuyv"


# ── Host helpers ───────────────────────────────────────────────────────────────

def _host(cmd: str, timeout: int = 10) -> tuple:
    r = subprocess.run(["/bin/bash", "-c", cmd],
                       capture_output=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr.decode(errors="replace")


def _detect_camera_type() -> str:
    try:
        code, out, _ = _host(
            f"nsenter --target 1 --mount -- "
            f"v4l2-ctl --device={CAMERA_DEVICE} --list-formats 2>/dev/null",
            timeout=5
        )
        if code != 0:
            return CAM_CSI
        f = out.decode(errors="replace").upper()
        logger.info(f"Camera formats: {f.strip()}")
        if "RG10" in f or "BG10" in f or "BA10" in f:
            return CAM_CSI
        if "MJPG" in f or "MJPEG" in f:
            return CAM_USB_MJP
        if "YUYV" in f or "YUY2" in f:
            return CAM_USB_YUV
        return CAM_USB_MJP
    except Exception as e:
        logger.error(f"Camera detect error: {e}")
        return CAM_CSI


def _kill_camera():
    """Ejecuta jetson-cam-stop.sh en el host. vi-output muere solo."""
    try:
        _host(
            f"nsenter --target 1 --mount -- {CAM_STOP} 2>/dev/null; true",
            timeout=8
        )
        logger.info("Camera cleanup done")
    except Exception as e:
        logger.debug(f"Camera cleanup error: {e}")


def _wait_device_free(max_secs: int = 5) -> bool:
    for i in range(max_secs):
        code, out, _ = _host(
            "nsenter --target 1 --mount -- "
            "fuser /dev/video0 2>/dev/null && echo BUSY || echo FREE",
            timeout=5
        )
        if b"FREE" in out:
            return True
        time.sleep(1.0)
    logger.warning("Device not free after timeout")
    return False


# ── CSI capture ────────────────────────────────────────────────────────────────

def _capture_csi_frame() -> Optional[bytes]:
    """
    Ejecuta jetson-cam-start.sh en el host via nsenter.
    El script tiene PYTHONPATH correcto y usa jetson-capture.py.
    Imagen confirmada correcta a 3264x2464 scale=0.2 (~652x492).
    """
    proc = None
    try:
        proc = subprocess.Popen(
            ["/bin/bash", "-c",
             f"nsenter --target 1 --mount -- "
             f"{CAM_START} {CSI_OUT} {CSI_EXPOSURE}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            stdout, stderr = proc.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            logger.warning("CSI capture timeout — killing")
            proc.kill()
            proc.communicate()
            _kill_camera()
            return None

        rc = proc.returncode
        proc = None

        if rc != 0:
            err = stderr.decode(errors="replace").strip()
            logger.warning(f"CSI capture failed code={rc}: {err}")
            _kill_camera()
            return None

        # Leer JPEG del host
        code, data, _ = _host(
            f"nsenter --target 1 --mount -- cat {CSI_OUT} 2>/dev/null",
            timeout=5
        )
        _host(
            f"nsenter --target 1 --mount -- rm -f {CSI_OUT} 2>/dev/null",
            timeout=3
        )

        if len(data) > 100 and data[:2] == b'\xff\xd8':
            logger.debug(f"CSI frame OK: {len(data)} bytes")
            return data

        logger.warning(f"Invalid JPEG: {len(data)} bytes")
        return None

    except Exception as e:
        logger.error(f"CSI capture error: {e}")
        return None
    finally:
        if proc and proc.poll() is None:
            proc.kill()
            proc.communicate()
            _kill_camera()


# ── USB capture ────────────────────────────────────────────────────────────────

def _capture_usb_mjpeg() -> Optional[bytes]:
    proc = None
    try:
        proc = subprocess.Popen(
            ["/bin/bash", "-c",
             f"nsenter --target 1 --mount -- "
             f"v4l2-ctl --device={CAMERA_DEVICE} "
             f"--set-fmt-video=width={USB_WIDTH},height={USB_HEIGHT},pixelformat=MJPG "
             f"--stream-mmap --stream-count=1 --stream-to=- 2>/dev/null"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            data, _ = proc.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.communicate(); return None
        if proc.returncode == 0 and len(data) > 100 and data[:2] == b'\xff\xd8':
            return data
        return None
    except Exception as e:
        logger.error(f"USB MJPEG error: {e}"); return None
    finally:
        if proc and proc.poll() is None:
            try: proc.kill(); proc.communicate()
            except Exception: pass


def _capture_usb_yuyv() -> Optional[bytes]:
    proc = None
    try:
        proc = subprocess.Popen(
            ["/bin/bash", "-c",
             f"nsenter --target 1 --mount -- "
             f"v4l2-ctl --device={CAMERA_DEVICE} "
             f"--set-fmt-video=width={USB_WIDTH},height={USB_HEIGHT},pixelformat=YUYV "
             f"--stream-mmap --stream-count=1 --stream-to=- 2>/dev/null"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        expected = USB_WIDTH * USB_HEIGHT * 2
        try:
            data, _ = proc.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.communicate(); return None
        if proc.returncode != 0 or len(data) < expected:
            return None
        yuv = np.frombuffer(data[:expected], dtype=np.uint8).reshape(USB_HEIGHT, USB_WIDTH, 2)
        y   = yuv[:, :, 0]
        u   = np.repeat(yuv[:, 0::2, 1], 2, axis=1)
        v   = np.repeat(yuv[:, 1::2, 1], 2, axis=1)
        img = Image.fromarray(np.stack([y, u, v], axis=2).astype(np.uint8), "YCbCr").convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY)
        return buf.getvalue()
    except Exception as e:
        logger.error(f"USB YUYV error: {e}"); return None
    finally:
        if proc and proc.poll() is None:
            try: proc.kill(); proc.communicate()
            except Exception: pass


# ── Frame Cache ────────────────────────────────────────────────────────────────

class FrameCache:
    def __init__(self):
        self._lock        = threading.Lock()
        self._frame       = None
        self._ts          = 0.0
        self._running     = False
        self._thread      = None
        self._error       = None
        self._last_client = 0.0
        self._cam_type    = CAM_UNKNOWN

    def start(self):
        self._last_client = time.time()
        if self._running:
            return
        if self._cam_type == CAM_UNKNOWN:
            self._cam_type = _detect_camera_type()
        if self._cam_type == CAM_CSI:
            _kill_camera()
            _wait_device_free(max_secs=5)
        self._running = True
        self._thread  = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info(f"Camera thread started (type={self._cam_type})")

    def stop(self):
        self._running = False
        with self._lock:
            self._frame = None
            self._error = None
        logger.info("Camera stop — killing host processes")
        if self._cam_type == CAM_CSI:
            _kill_camera()
            _wait_device_free(max_secs=5)

    def ping(self):
        self._last_client = time.time()

    def get_frame(self):
        self.ping()
        with self._lock:
            return self._frame, self._ts, self._error

    @property
    def cam_type(self):
        return self._cam_type

    def _capture_one(self) -> Optional[bytes]:
        if self._cam_type == CAM_CSI:
            return _capture_csi_frame()
        elif self._cam_type == CAM_USB_MJP:
            return _capture_usb_mjpeg()
        elif self._cam_type == CAM_USB_YUV:
            return _capture_usb_yuyv()
        return None

    def _loop(self):
        min_interval = CSI_INTERVAL if self._cam_type == CAM_CSI else 1.0 / 3.0

        while self._running:
            if time.time() - self._last_client > AUTO_STOP_SECS:
                logger.info("No clients — auto-stopping camera")
                self._running = False
                if self._cam_type == CAM_CSI:
                    _kill_camera()
                break

            t0   = time.time()
            jpeg = self._capture_one()

            with self._lock:
                if jpeg:
                    self._frame = jpeg
                    self._ts    = time.time()
                    self._error = None
                else:
                    self._error = f"Capture failed — check {CAMERA_DEVICE}"

            elapsed = time.time() - t0
            if self._running:
                time.sleep(max(0, min_interval - elapsed))

        with self._lock:
            self._frame = None
        logger.info("Camera thread stopped")


_cache = FrameCache()


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/camera/status")
async def camera_status():
    frame, ts, error = _cache.get_frame() if _cache._running else (None, 0, None)
    cam = _cache.cam_type
    if cam == CAM_CSI:
        sensor   = f"{CSI_WIDTH}×{CSI_HEIGHT} RAW10 Bayer BG"
        pipeline = "jetson-stream-capture.py → 640×480 JPEG"
        output   = "640×480"
    elif cam == CAM_USB_MJP:
        sensor = pipeline = output = f"{USB_WIDTH}×{USB_HEIGHT} MJPEG"
    elif cam == CAM_USB_YUV:
        sensor = pipeline = output = f"{USB_WIDTH}×{USB_HEIGHT} YUYV→RGB"
    else:
        sensor = pipeline = output = "detecting..."
    return {
        "device":         CAMERA_DEVICE,
        "camera_type":    cam,
        "sensor":         sensor,
        "output":         output,
        "fps":            round(1.0 / CSI_INTERVAL, 2) if cam == CAM_CSI else 3,
        "streaming":      _cache._running,
        "has_frame":      frame is not None,
        "last_frame_age": round(time.time() - ts, 2) if ts else None,
        "error":          error,
        "pipeline":       pipeline,
    }


@router.post("/camera/start")
async def camera_start():
    _cache.start()
    return {"streaming": True, "camera_type": _cache.cam_type}


@router.post("/camera/stop")
async def camera_stop():
    _cache.stop()
    return {"streaming": False}


@router.get("/camera/frame")
async def camera_frame():
    """Último frame del cache. NUNCA captura directamente."""
    if not _cache._running:
        raise HTTPException(status_code=503, detail="Stream not active — press Start Stream")
    _cache.ping()
    frame, ts, error = _cache.get_frame()
    if frame is None:
        raise HTTPException(status_code=503, detail=error or "No frame yet — stream starting (~3s)")
    return Response(content=frame, media_type="image/jpeg")


@router.get("/camera/snapshot")
async def camera_snapshot():
    """Snapshot bajo demanda. Usa cache si stream activo."""
    if _cache._running:
        frame, ts, error = _cache.get_frame()
        if frame:
            return Response(content=frame, media_type="image/jpeg")
    if _cache.cam_type == CAM_UNKNOWN:
        _cache._cam_type = _detect_camera_type()
    if _cache.cam_type == CAM_CSI:
        _kill_camera()
        _wait_device_free(max_secs=5)
    jpeg = _cache._capture_one()
    if _cache.cam_type == CAM_CSI:
        _kill_camera()
    if not jpeg:
        raise HTTPException(status_code=503, detail=f"Snapshot failed — check {CAMERA_DEVICE}")
    return Response(content=jpeg, media_type="image/jpeg")


@router.get("/camera/stream")
async def camera_stream():
    """MJPEG stream continuo."""
    _cache.start()

    async def generate():
        boundary = b"--jpegboundary\r\n"
        try:
            while True:
                _cache.ping()
                frame, ts, error = _cache.get_frame() if _cache._running else (None, 0, None)
                if frame and _cache._running:
                    yield boundary
                    yield b"Content-Type: image/jpeg\r\n"
                    yield f"Content-Length: {len(frame)}\r\n\r\n".encode()
                    yield frame
                    yield b"\r\n"
                await asyncio.sleep(1.0)
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            _cache._last_client = 0.0

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=jpegboundary",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
