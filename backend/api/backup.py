"""
Backup / Restore API - Jetson Dashboard
Genera y restaura backups de toda la configuración en un ZIP.
Incluye: settings.json, alerts_config.json, alerts_history.json,
         metrics.db, certificados SSL.
"""
import io
import json
import logging
import os
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)
router = APIRouter()

DATA_DIR = Path("/app/data")

# Archivos incluidos en el backup
BACKUP_FILES = [
    "settings.json",
    "alerts_config.json",
    "alerts_history.json",
    "metrics.db",
]
BACKUP_DIRS = [
    "ssl",  # certificados HTTPS
]

BACKUP_VERSION = "1.0"


def _make_manifest(files_included: list) -> dict:
    return {
        "version":    BACKUP_VERSION,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "app":        "jetson-dashboard",
        "files":      files_included,
    }


@router.get("/backup/download")
async def backup_download():
    """Generar y descargar un ZIP con toda la configuración."""
    buf = io.BytesIO()
    files_included = []

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Archivos individuales
        for fname in BACKUP_FILES:
            fpath = DATA_DIR / fname
            if fpath.exists():
                zf.write(fpath, arcname=fname)
                files_included.append(fname)
                logger.debug(f"Backup: added {fname}")

        # Directorios (SSL)
        for dname in BACKUP_DIRS:
            dpath = DATA_DIR / dname
            if dpath.is_dir():
                for item in dpath.rglob("*"):
                    if item.is_file():
                        arcname = str(item.relative_to(DATA_DIR))
                        zf.write(item, arcname=arcname)
                        files_included.append(arcname)

        # Manifest
        manifest = _make_manifest(files_included)
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    buf.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"jetson-dashboard-backup-{ts}.zip"

    return StreamingResponse(
        io.BytesIO(buf.read()),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/backup/info")
async def backup_info():
    """Info sobre los datos actuales — qué se incluiría en un backup."""
    files = []
    total_bytes = 0

    for fname in BACKUP_FILES:
        fpath = DATA_DIR / fname
        if fpath.exists():
            size = fpath.stat().st_size
            total_bytes += size
            files.append({
                "name":     fname,
                "size":     size,
                "modified": datetime.fromtimestamp(fpath.stat().st_mtime).isoformat(),
                "exists":   True,
            })
        else:
            files.append({"name": fname, "exists": False, "size": 0})

    for dname in BACKUP_DIRS:
        dpath = DATA_DIR / dname
        if dpath.is_dir():
            dir_size = sum(f.stat().st_size for f in dpath.rglob("*") if f.is_file())
            total_bytes += dir_size
            files.append({
                "name":   dname + "/",
                "size":   dir_size,
                "exists": True,
            })

    return {
        "files":       files,
        "total_bytes": total_bytes,
        "data_dir":    str(DATA_DIR),
    }


@router.post("/backup/restore")
async def backup_restore(
    file: UploadFile = File(...),
    restore_settings: bool = True,
    restore_alerts: bool = True,
    restore_history: bool = True,
    restore_metrics: bool = False,   # false por defecto — el DB puede ser grande
    restore_ssl: bool = False,       # false por defecto — cuidado con los certs
):
    """
    Restaurar desde un ZIP de backup.
    Por defecto restaura configuración pero NO métricas ni SSL
    para evitar pérdida accidental de datos.
    """
    content = await file.read()

    # Validar que es un ZIP válido
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    # Leer manifest
    try:
        manifest = json.loads(zf.read("manifest.json"))
    except Exception:
        raise HTTPException(status_code=400, detail="Missing or invalid manifest.json — not a valid backup")

    if manifest.get("app") != "jetson-dashboard":
        raise HTTPException(status_code=400, detail="Backup is not from jetson-dashboard")

    # Hacer backup de seguridad antes de restaurar
    safety_backup = DATA_DIR / f"pre_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    try:
        with zipfile.ZipFile(safety_backup, "w", zipfile.ZIP_DEFLATED) as sbf:
            for fname in BACKUP_FILES:
                fp = DATA_DIR / fname
                if fp.exists():
                    sbf.write(fp, arcname=fname)
        logger.info(f"Safety backup created: {safety_backup}")
    except Exception as e:
        logger.warning(f"Could not create safety backup: {e}")

    restored = []
    skipped  = []

    # Mapa de archivo → flag de restauración
    restore_map = {
        "settings.json":       restore_settings,
        "alerts_config.json":  restore_alerts,
        "alerts_history.json": restore_history,
        "metrics.db":          restore_metrics,
    }

    for arcname in zf.namelist():
        if arcname == "manifest.json":
            continue

        # Decidir si restaurar este archivo
        should_restore = False
        if arcname in restore_map:
            should_restore = restore_map[arcname]
        elif arcname.startswith("ssl/"):
            should_restore = restore_ssl
        else:
            should_restore = True  # otros archivos: restaurar siempre

        if not should_restore:
            skipped.append(arcname)
            continue

        # Restaurar
        dest = DATA_DIR / arcname
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(zf.read(arcname))
        restored.append(arcname)
        logger.info(f"Restored: {arcname}")

    return {
        "success":        True,
        "restored":       restored,
        "skipped":        skipped,
        "backup_version": manifest.get("version"),
        "backup_date":    manifest.get("created_at"),
        "safety_backup":  str(safety_backup.name),
        "note":           "Restart the backend to apply restored settings.",
    }


@router.get("/backup/safety-backups")
async def list_safety_backups():
    """Listar backups de seguridad pre-restauración."""
    backups = []
    for f in DATA_DIR.glob("pre_restore_*.zip"):
        backups.append({
            "name":     f.name,
            "size":     f.stat().st_size,
            "created":  datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
        })
    return {"backups": sorted(backups, key=lambda x: x["created"], reverse=True)}


@router.delete("/backup/safety-backups/{name}")
async def delete_safety_backup(name: str):
    """Eliminar un backup de seguridad."""
    # Seguridad: solo permitir nombres con patrón válido
    if not name.startswith("pre_restore_") or not name.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid backup name")
    path = DATA_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    path.unlink()
    return {"deleted": name}
