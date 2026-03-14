"""
Camera API - Jetson Dashboard
Soporta dos tipos de cámara de forma automática:

  CSI IMX219  → /dev/video0 → RAW10 Bayer (RG10)
                → debayering manual numpy + Pillow
                → limpieza de vi-output al parar

  USB (UVC)   → /dev/video0 o /dev/video1, etc.
                → MJPEG nativo  (preferido, sin CPU extra)
                → YUYV fallback (convierte YUV→RGB via Pillow)

La detección es automática al primer start(): se consulta
v4l2-ctl --list-formats y se elige el pipeline correcto.
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

# ── Configuración ──────────────────────────────────────────────────────────────
CAMERA_DEVICE  = "/dev/video0"
OUT_WIDTH      = 1280
OUT_HEIGHT     = 720
CAPTURE_FPS    = 3        # fps — suficiente para monitoreo
JPEG_QUALITY   = 75
AUTO_STOP_SECS = 10       # segundos sin clientes → parar captura

# IMX219 CSI — resolución nativa del sensor
CSI_SENSOR_WIDTH  = 3264
CSI_SENSOR_HEIGHT = 2464

# Tipos de cámara detectados
CAM_UNKNOWN = "unknown"
CAM_CSI     = "csi"    # IMX219 RAW10 Bayer
CAM_USB_MJP = "usb_mjpeg"  # USB con MJPEG nativo
CAM_USB_YUV = "usb_yuyv"   # USB con YUYV


# ── Utilidades ─────────────────────────────────────────────────────────────────

def _run_host(cmd: str, timeout: int = 10) -> tuple:
    """Ejecutar comando en el host via nsenter."""
    result = subprocess.run(
        ["/bin/bash", "-c", cmd],
        capture_output=True,
        timeout=timeout,
    )
    return result.returncode, result.stdout, result.stderr.decode(errors="replace")


def _detect_camera_type() -> str:
    """
    Detectar el tipo de cámara consultando los formatos que soporta el dispositivo.
    Devuelve CAM_CSI, CAM_USB_MJP o CAM_USB_YUV.
    """
    try:
        cmd = f"nsenter --target 1 --mount -- v4l2-ctl --device={CAMERA_DEVICE} --list-formats 2>/dev/null"
        code, out, _ = _run_host(cmd, timeout=5)
        if code != 0:
            logger.warning("Could not query camera formats — assuming CSI")
            return CAM_CSI

        formats = out.decode(errors="replace").upper()
        logger.info(f"Camera formats: {formats.strip()}")

        # RG10 = RAW10 Bayer → IMX219 CSI
        if "RG10" in formats or "BG10" in formats or "BA10" in formats:
            logger.info("Camera detected: IMX219 CSI (RAW10 Bayer)")
            return CAM_CSI

        # MJPG = MJPEG nativo → USB cámara con compresión hardware
        if "MJPG" in formats or "MJPEG" in formats:
            logger.info("Camera detected: USB (MJPEG)")
            return CAM_USB_MJP

        # YUYV = YUV 4:2:2 sin comprimir → USB cámara básica
        if "YUYV" in formats or "YUY2" in formats:
            logger.info("Camera detected: USB (YUYV)")
            return CAM_USB_YUV

        # Fallback — intentar MJPEG
        logger.warning("Unknown camera format — trying USB MJPEG fallback")
        return CAM_USB_MJP

    except Exception as e:
        logger.error(f"Camera detection error: {e}")
        return CAM_CSI


# ── Captura CSI (IMX219 RAW10 Bayer) ──────────────────────────────────────────

def _capture_csi_frame() -> Optional[bytes]:
    """
    Captura un frame RAW10 del IMX219 via v4l2-ctl.
    Usa Popen para control total del proceso — garantiza que
    el fd se cierra y vi-output (proceso kernel Tegra) termina solo.
    """
    cmd = (
        f"nsenter --target 1 --mount -- "
        f"v4l2-ctl --device={CAMERA_DEVICE} "
        f"--set-fmt-video=width={CSI_SENSOR_WIDTH},height={CSI_SENSOR_HEIGHT},pixelformat=RG10 "
        f"--stream-mmap --stream-count=1 --stream-to=- 2>/dev/null"
    )
    proc = None
    try:
        proc = subprocess.Popen(
            ["/bin/bash", "-c", cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        expected = CSI_SENSOR_WIDTH * CSI_SENSOR_HEIGHT * 2  # uint16 LE
        try:
            data, _ = proc.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            logger.warning("CSI capture timeout — killing v4l2-ctl")
            proc.kill()
            proc.communicate()
            return None

        if proc.returncode == 0 and len(data) >= expected:
            return data[:expected]
        logger.warning(f"CSI capture failed: code={proc.returncode} bytes={len(data)}")
        return None

    except Exception as e:
        logger.error(f"CSI capture error: {e}")
        return None
    finally:
        if proc and proc.poll() is None:
            try:
                proc.kill()
                proc.communicate()
            except Exception:
                pass


def _csi_raw_to_jpeg(raw_bytes: bytes) -> Optional[bytes]:
    """RAW10 Bayer (RG10) → JPEG. Pipeline optimizado para Jetson Nano."""
    try:
        # 1. Parsear uint16
        raw16 = np.frombuffer(raw_bytes, dtype=np.uint16).reshape(
            CSI_SENSOR_HEIGHT, CSI_SENSOR_WIDTH
        )
        # 2. Downsample 2x para ahorrar memoria
        raw_small = raw16[::2, ::2]

        # 3. Stretch de contraste por percentiles p2/p98
        p2  = np.percentile(raw_small, 2)
        p98 = np.percentile(raw_small, 98)
        if p98 <= p2:
            p2, p98 = float(raw_small.min()), float(raw_small.max())
        frame = np.clip(
            (raw_small.astype(np.float32) - p2) / (p98 - p2 + 1e-6) * 255.0,
            0, 255
        ).astype(np.uint8)

        # 4. Debayer BGGR
        b  = frame[0::2, 0::2].astype(np.float32)
        g1 = frame[0::2, 1::2].astype(np.float32)
        g2 = frame[1::2, 0::2].astype(np.float32)
        r  = frame[1::2, 1::2].astype(np.float32)
        g  = (g1 + g2) / 2.0

        # 5. White balance gray world
        rm = r.mean() + 1e-6
        gm = g.mean() + 1e-6
        bm = b.mean() + 1e-6
        r = np.clip(r * (gm / rm), 0, 255).astype(np.uint8)
        g = np.clip(g,             0, 255).astype(np.uint8)
        b = np.clip(b * (gm / bm), 0, 255).astype(np.uint8)

        # 6. Reconstruir RGB y resize
        h_b, w_b = r.shape
        rgb = np.zeros((h_b * 2, w_b * 2, 3), dtype=np.uint8)
        rgb[0::2, 0::2] = rgb[0::2, 1::2] = \
        rgb[1::2, 0::2] = rgb[1::2, 1::2] = np.stack([r, g, b], axis=2)

        img = Image.fromarray(rgb).resize((OUT_WIDTH, OUT_HEIGHT), Image.BILINEAR)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY)
        return buf.getvalue()

    except Exception as e:
        logger.error(f"CSI debayer error: {e}", exc_info=True)
        return None


def _kill_vi_output():
    """
    Limpiar v4l2-ctl residual en el host.
    vi-output es proceso kernel Tegra — desaparece solo al cerrar el fd.
    Matando v4l2-ctl (proceso usuario) se cierra el fd y vi-output termina.
    Solo aplica a CSI; para USB no hay vi-output.
    """
    try:
        subprocess.run(
            ["/bin/bash", "-c",
             "nsenter --target 1 --mount -- pkill -TERM -f 'v4l2-ctl' 2>/dev/null; "
             "sleep 0.3; "
             "nsenter --target 1 --mount -- pkill -KILL -f 'v4l2-ctl' 2>/dev/null; "
             "true"],
            capture_output=True, timeout=6
        )
        logger.info("CSI cleanup done")
    except Exception as e:
        logger.debug(f"CSI cleanup error: {e}")


# ── Captura USB MJPEG ──────────────────────────────────────────────────────────

def _capture_usb_mjpeg_frame() -> Optional[bytes]:
    """
    Captura un frame MJPEG de una cámara USB.
    v4l2-ctl lee el frame comprimido y lo devuelve directamente.
    No necesita debayering — es JPEG nativo del hardware de la cámara.
    """
    cmd = (
        f"nsenter --target 1 --mount -- "
        f"v4l2-ctl --device={CAMERA_DEVICE} "
        f"--set-fmt-video=width={OUT_WIDTH},height={OUT_HEIGHT},pixelformat=MJPG "
        f"--stream-mmap --stream-count=1 --stream-to=- 2>/dev/null"
    )
    proc = None
    try:
        proc = subprocess.Popen(
            ["/bin/bash", "-c", cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        try:
            data, _ = proc.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            logger.warning("USB MJPEG capture timeout")
            proc.kill()
            proc.communicate()
            return None

        # Validar que es un JPEG válido (empieza con FF D8 FF)
        if proc.returncode == 0 and len(data) > 100 and data[:2] == b'\xff\xd8':
            return data
        logger.warning(f"USB MJPEG capture failed: code={proc.returncode} bytes={len(data)}")
        return None

    except Exception as e:
        logger.error(f"USB MJPEG capture error: {e}")
        return None
    finally:
        if proc and proc.poll() is None:
            try:
                proc.kill()
                proc.communicate()
            except Exception:
                pass


# ── Captura USB YUYV ───────────────────────────────────────────────────────────

def _capture_usb_yuyv_frame() -> Optional[bytes]:
    """
    Captura un frame YUYV de una cámara USB básica y lo convierte a JPEG.
    YUYV = YUV 4:2:2 sin comprimir. Pillow lo convierte a RGB directamente.
    """
    cmd = (
        f"nsenter --target 1 --mount -- "
        f"v4l2-ctl --device={CAMERA_DEVICE} "
        f"--set-fmt-video=width={OUT_WIDTH},height={OUT_HEIGHT},pixelformat=YUYV "
        f"--stream-mmap --stream-count=1 --stream-to=- 2>/dev/null"
    )
    proc = None
    try:
        proc = subprocess.Popen(
            ["/bin/bash", "-c", cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        expected = OUT_WIDTH * OUT_HEIGHT * 2  # YUYV = 2 bytes por pixel
        try:
            data, _ = proc.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            logger.warning("USB YUYV capture timeout")
            proc.kill()
            proc.communicate()
            return None

        if proc.returncode != 0 or len(data) < expected:
            logger.warning(f"USB YUYV capture failed: code={proc.returncode} bytes={len(data)}")
            return None

        # Convertir YUYV → RGB → JPEG via Pillow
        # Pillow soporta "YCbCr" que equivale a YUYV con el mismo layout
        yuv = np.frombuffer(data[:expected], dtype=np.uint8).reshape(OUT_HEIGHT, OUT_WIDTH, 2)
        # Separar canales Y, U, V desde YUYV (Y0 U Y1 V por cada par de pixels)
        y = yuv[:, :, 0]
        u = yuv[:, 0::2, 1]  # U cada 2 pixels
        v = yuv[:, 1::2, 1]  # V cada 2 pixels
        # Upscale U y V a resolución completa
        u_full = np.repeat(u, 2, axis=1)
        v_full = np.repeat(v, 2, axis=1)
        # Stack YUV y convertir a imagen Pillow
        yuv_img = np.stack([y, u_full, v_full], axis=2).astype(np.uint8)
        img = Image.fromarray(yuv_img, mode="YCbCr").convert("RGB")

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY)
        return buf.getvalue()

    except Exception as e:
        logger.error(f"USB YUYV conversion error: {e}", exc_info=True)
        return None
    finally:
        if proc and proc.poll() is None:
            try:
                proc.kill()
                proc.communicate()
            except Exception:
                pass


# ── Frame Cache con auto-detección y auto-stop ────────────────────────────────

class FrameCache:
    def __init__(self):
        self._lock        = threading.Lock()
        self._frame       = None
        self._ts          = 0.0
        self._running     = False
        self._thread      = None
        self._error       = None
        self._last_client = 0.0
        self._cam_type    = CAM_UNKNOWN  # detectado en start()

    def start(self):
        self._last_client = time.time()
        if self._running:
            return
        # Detectar tipo de cámara antes de arrancar el thread
        if self._cam_type == CAM_UNKNOWN:
            self._cam_type = _detect_camera_type()
        self._running = True
        self._thread  = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info(f"Camera thread started (type={self._cam_type})")

    def stop(self):
        self._running = False
        logger.info("Camera thread stop requested")
        if self._cam_type == CAM_CSI:
            _kill_vi_output()

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
        """Capturar un frame según el tipo de cámara detectado."""
        if self._cam_type == CAM_CSI:
            raw = _capture_csi_frame()
            return _csi_raw_to_jpeg(raw) if raw else None
        elif self._cam_type == CAM_USB_MJP:
            return _capture_usb_mjpeg_frame()
        elif self._cam_type == CAM_USB_YUV:
            return _capture_usb_yuyv_frame()
        return None

    def _loop(self):
        interval = 1.0 / CAPTURE_FPS
        while self._running:
            # Auto-stop si no hay clientes
            if time.time() - self._last_client > AUTO_STOP_SECS:
                logger.info("No clients — auto-stopping camera")
                with self._lock:
                    self._frame = None
                    self._error = None
                self._running = False
                if self._cam_type == CAM_CSI:
                    _kill_vi_output()
                break

            t0   = time.time()
            jpeg = self._capture_one()
            with self._lock:
                if jpeg:
                    self._frame = jpeg
                    self._ts    = time.time()
                    self._error = None
                else:
                    self._error = f"Capture failed ({self._cam_type}) — check {CAMERA_DEVICE}"

            elapsed = time.time() - t0
            time.sleep(max(0, interval - elapsed))

        logger.info("Camera thread stopped")


_cache = FrameCache()


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/camera/status")
async def camera_status():
    frame, ts, error = _cache.get_frame() if _cache._running else (None, 0, None)
    cam_type = _cache.cam_type
    # Info del sensor según tipo
    if cam_type == CAM_CSI:
        sensor = f"{CSI_SENSOR_WIDTH}×{CSI_SENSOR_HEIGHT} RAW10 Bayer"
    elif cam_type == CAM_USB_MJP:
        sensor = f"{OUT_WIDTH}×{OUT_HEIGHT} MJPEG"
    elif cam_type == CAM_USB_YUV:
        sensor = f"{OUT_WIDTH}×{OUT_HEIGHT} YUYV"
    else:
        sensor = "detecting..."
    return {
        "device":         CAMERA_DEVICE,
        "camera_type":    cam_type,
        "sensor":         sensor,
        "output":         f"{OUT_WIDTH}×{OUT_HEIGHT}",
        "fps":            CAPTURE_FPS,
        "streaming":      _cache._running,
        "has_frame":      frame is not None,
        "last_frame_age": round(time.time() - ts, 2) if ts else None,
        "error":          error,
    }


@router.post("/camera/start")
async def camera_start():
    _cache.start()
    return {"streaming": True, "camera_type": _cache.cam_type}


@router.post("/camera/stop")
async def camera_stop():
    _cache.stop()
    return {"streaming": False}


@router.get("/camera/snapshot")
async def camera_snapshot():
    """
    Snapshot: usa el cache si el stream está activo,
    o captura un frame directamente si está parado.
    Evita conflicto de acceso a /dev/video0.
    """
    if _cache._running:
        frame, ts, error = _cache.get_frame()
        if frame:
            return Response(content=frame, media_type="image/jpeg")

    # Stream parado — captura directa con detección si hace falta
    if _cache.cam_type == CAM_UNKNOWN:
        _cache._cam_type = _detect_camera_type()

    jpeg = _cache._capture_one()
    if not jpeg:
        raise HTTPException(status_code=503, detail=f"Camera capture failed — check {CAMERA_DEVICE}")
    return Response(content=jpeg, media_type="image/jpeg")


@router.get("/camera/frame")
async def camera_frame():
    """Último frame del cache."""
    _cache.ping()
    frame, ts, error = _cache.get_frame() if _cache._running else (None, 0, None)
    if frame is None:
        if _cache.cam_type == CAM_UNKNOWN:
            _cache._cam_type = _detect_camera_type()
        frame = _cache._capture_one()
    if frame is None:
        raise HTTPException(status_code=503, detail=error or "No frame available")
    return Response(content=frame, media_type="image/jpeg")


@router.get("/camera/stream")
async def camera_stream():
    """
    MJPEG stream continuo.
    Se detiene automáticamente cuando el cliente desconecta.
    """
    _cache.start()

    async def generate():
        boundary = b"--jpegboundary\r\n"
        try:
            while True:
                _cache.ping()
                frame, ts, error = _cache.get_frame() if _cache._running else (None, 0, None)
                if frame:
                    yield boundary
                    yield b"Content-Type: image/jpeg\r\n"
                    yield f"Content-Length: {len(frame)}\r\n\r\n".encode()
                    yield frame
                    yield b"\r\n"
                await asyncio.sleep(1.0 / CAPTURE_FPS)
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            # Forzar auto-stop inmediato al desconectar el cliente
            _cache._last_client = 0.0

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=jpegboundary",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
