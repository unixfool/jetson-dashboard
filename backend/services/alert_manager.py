"""
Alert Manager - Sistema de alertas profesional para Jetson Dashboard

Características:
- Umbrales configurables por métrica (CPU, GPU, RAM, temperatura, disco)
- Motor de evaluación asíncrono integrado en el broadcast loop
- Historial de eventos persistente en JSON
- Notificaciones por email (SMTP) y Telegram
- Cooldown para evitar spam de alertas
- Severidades: info, warning, critical
"""

import asyncio
import json
import logging
import os
import smtplib
import time
from dataclasses import dataclass, field, asdict
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
ALERTS_CONFIG_FILE = DATA_DIR / "alerts_config.json"
ALERTS_HISTORY_FILE = DATA_DIR / "alerts_history.json"
MAX_HISTORY = 200  # Máximo de eventos guardados


# ─── Default Config ───────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    "enabled": True,
    "rules": {
        "cpu_high": {
            "enabled": True,
            "metric": "cpu_percent",
            "threshold": 90,
            "severity": "warning",
            "cooldown_seconds": 300,
            "message": "CPU usage above {value:.0f}%",
        },
        "cpu_critical": {
            "enabled": True,
            "metric": "cpu_percent",
            "threshold": 98,
            "severity": "critical",
            "cooldown_seconds": 120,
            "message": "CPU critically high: {value:.0f}%",
        },
        "ram_high": {
            "enabled": True,
            "metric": "ram_percent",
            "threshold": 85,
            "severity": "warning",
            "cooldown_seconds": 300,
            "message": "RAM usage above {value:.0f}%",
        },
        "ram_critical": {
            "enabled": True,
            "metric": "ram_percent",
            "threshold": 95,
            "severity": "critical",
            "cooldown_seconds": 120,
            "message": "RAM critically high: {value:.0f}%",
        },
        "temp_high": {
            "enabled": True,
            "metric": "cpu_temp",
            "threshold": 70,
            "severity": "warning",
            "cooldown_seconds": 300,
            "message": "CPU temperature {value:.1f}°C",
        },
        "temp_critical": {
            "enabled": True,
            "metric": "cpu_temp",
            "threshold": 85,
            "severity": "critical",
            "cooldown_seconds": 120,
            "message": "CPU temperature critical: {value:.1f}°C",
        },
        "disk_high": {
            "enabled": True,
            "metric": "disk_percent",
            "threshold": 85,
            "severity": "warning",
            "cooldown_seconds": 600,
            "message": "Disk usage {value:.0f}%",
        },
        "disk_critical": {
            "enabled": True,
            "metric": "disk_percent",
            "threshold": 95,
            "severity": "critical",
            "cooldown_seconds": 300,
            "message": "Disk critically full: {value:.0f}%",
        },
        "gpu_high": {
            "enabled": True,
            "metric": "gpu_percent",
            "threshold": 95,
            "severity": "warning",
            "cooldown_seconds": 300,
            "message": "GPU usage {value:.0f}%",
        },
        "gpu_temp_high": {
            "enabled": True,
            "metric": "gpu_temp",
            "threshold": 75,
            "severity": "warning",
            "cooldown_seconds": 300,
            "message": "GPU temperature {value:.1f}°C",
        },
    },
    "notifications": {
        "email": {
            "enabled": False,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "smtp_user": "",
            "smtp_password": "",
            "from_addr": "",
            "to_addr": "",
            "min_severity": "warning",  # info | warning | critical
        },
        "telegram": {
            "enabled": False,
            "bot_token": "",
            "chat_id": "",
            "min_severity": "warning",
        },
    },
}


# ─── Alert Event ─────────────────────────────────────────────────────────────

@dataclass
class AlertEvent:
    id: str
    rule_id: str
    severity: str        # info | warning | critical
    message: str
    metric: str
    value: float
    threshold: float
    timestamp: float
    acknowledged: bool = False
    notified: bool = False

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict) -> "AlertEvent":
        return cls(**d)


# ─── Alert Manager ────────────────────────────────────────────────────────────

class AlertManager:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._config = self._load_config()
        self._history: List[AlertEvent] = self._load_history()
        self._last_triggered: Dict[str, float] = {}  # rule_id → timestamp
        self._active_alerts: Dict[str, AlertEvent] = {}  # rule_id → latest event
        self._new_alerts: List[AlertEvent] = []  # pending to send via WS
        self._lock = asyncio.Lock()

    # ─── Config ──────────────────────────────────────────────────────────────

    def _load_config(self) -> Dict:
        if ALERTS_CONFIG_FILE.exists():
            try:
                saved = json.loads(ALERTS_CONFIG_FILE.read_text())
                # Merge con defaults para añadir reglas nuevas
                merged = DEFAULT_CONFIG.copy()
                merged["rules"].update(saved.get("rules", {}))
                merged["notifications"].update(saved.get("notifications", {}))
                merged["enabled"] = saved.get("enabled", True)
                return merged
            except Exception as e:
                logger.warning(f"Could not load alerts config: {e}")
        return DEFAULT_CONFIG.copy()

    def _save_config(self):
        try:
            ALERTS_CONFIG_FILE.write_text(
                json.dumps(self._config, indent=2)
            )
        except Exception as e:
            logger.error(f"Could not save alerts config: {e}")

    def get_config(self) -> Dict:
        return self._config

    def update_config(self, new_config: Dict) -> Dict:
        # Merge cuidadoso
        if "enabled" in new_config:
            self._config["enabled"] = new_config["enabled"]
        if "rules" in new_config:
            for rule_id, rule_data in new_config["rules"].items():
                if rule_id in self._config["rules"]:
                    self._config["rules"][rule_id].update(rule_data)
                else:
                    self._config["rules"][rule_id] = rule_data
        if "notifications" in new_config:
            for channel, ch_data in new_config["notifications"].items():
                if channel in self._config["notifications"]:
                    self._config["notifications"][channel].update(ch_data)
        self._save_config()
        return self._config

    # ─── History ─────────────────────────────────────────────────────────────

    def _load_history(self) -> List[AlertEvent]:
        if ALERTS_HISTORY_FILE.exists():
            try:
                data = json.loads(ALERTS_HISTORY_FILE.read_text())
                return [AlertEvent.from_dict(e) for e in data[-MAX_HISTORY:]]
            except Exception:
                pass
        return []

    def _save_history(self):
        try:
            data = [e.to_dict() for e in self._history[-MAX_HISTORY:]]
            ALERTS_HISTORY_FILE.write_text(json.dumps(data, indent=2))
        except Exception as e:
            logger.error(f"Could not save alert history: {e}")

    def get_history(self, limit: int = 50) -> List[Dict]:
        return [e.to_dict() for e in reversed(self._history[-limit:])]

    def get_active(self) -> List[Dict]:
        return [e.to_dict() for e in self._active_alerts.values()]

    def acknowledge(self, alert_id: str) -> bool:
        for event in self._history:
            if event.id == alert_id:
                event.acknowledged = True
                self._save_history()
                return True
        return False

    def acknowledge_all(self):
        for event in self._active_alerts.values():
            event.acknowledged = True
        self._active_alerts.clear()
        self._save_history()

    def get_new_alerts(self) -> List[Dict]:
        """Drain new alerts para enviar por WebSocket"""
        alerts = [e.to_dict() for e in self._new_alerts]
        self._new_alerts.clear()
        return alerts

    # ─── Evaluation ──────────────────────────────────────────────────────────

    def _extract_metrics(self, system: Dict, gpu: Dict) -> Dict[str, Optional[float]]:
        """Extrae los valores actuales de todas las métricas monitorizadas"""
        cpu = system.get("cpu", {})
        mem = system.get("memory", {})
        thermals = system.get("thermals", {})
        sensors = thermals.get("sensors", {})

        # CPU temp — desde sensors o tegrastats
        cpu_temp = None
        if "CPU" in sensors:
            cpu_temp = sensors["CPU"].get("temp_c")
        if cpu_temp is None:
            cpu_temp = gpu.get("tegrastats_raw", {}).get("temperatures", {}).get("CPU")

        # Disk — usar el más alto entre todas las particiones
        disk_percent = None
        storage = system.get("storage", {})
        partitions = storage.get("partitions", [])
        if partitions:
            disk_percent = max(p.get("percent", 0) for p in partitions)

        return {
            "cpu_percent": cpu.get("usage_percent") or cpu.get("percent"),
            "ram_percent": mem.get("percent"),
            "cpu_temp": cpu_temp,
            "gpu_percent": gpu.get("utilization_percent"),
            "gpu_temp": gpu.get("temperature_c"),
            "disk_percent": disk_percent,
        }

    async def evaluate(self, system: Dict, gpu: Dict):
        """Evaluar métricas contra reglas — llamar en cada broadcast tick"""
        if not self._config.get("enabled"):
            return

        metrics = self._extract_metrics(system, gpu)
        now = time.time()
        triggered = []

        async with self._lock:
            for rule_id, rule in self._config["rules"].items():
                if not rule.get("enabled"):
                    continue

                metric_key = rule["metric"]
                value = metrics.get(metric_key)
                if value is None:
                    continue

                threshold = rule["threshold"]
                if value < threshold:
                    # Si estaba activa, ya no lo está
                    self._active_alerts.pop(rule_id, None)
                    continue

                # Cooldown check
                last = self._last_triggered.get(rule_id, 0)
                cooldown = rule.get("cooldown_seconds", 300)
                if now - last < cooldown:
                    continue

                # Disparar alerta
                self._last_triggered[rule_id] = now
                event = AlertEvent(
                    id=f"{rule_id}_{int(now)}",
                    rule_id=rule_id,
                    severity=rule["severity"],
                    message=rule["message"].format(value=value, threshold=threshold),
                    metric=metric_key,
                    value=round(value, 2),
                    threshold=threshold,
                    timestamp=now,
                )
                self._history.append(event)
                self._active_alerts[rule_id] = event
                self._new_alerts.append(event)
                triggered.append(event)
                logger.warning(f"Alert [{rule['severity'].upper()}] {event.message}")

            if triggered:
                self._save_history()

        # Notificaciones fuera del lock
        for event in triggered:
            await self._send_notifications(event)

    # ─── Notifications ───────────────────────────────────────────────────────

    async def _send_notifications(self, event: AlertEvent):
        notif = self._config.get("notifications", {})

        # Email
        email_cfg = notif.get("email", {})
        if email_cfg.get("enabled") and self._severity_meets(
            event.severity, email_cfg.get("min_severity", "warning")
        ):
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, self._send_email, event, email_cfg
                )
                event.notified = True
            except Exception as e:
                logger.error(f"Email notification failed: {e}")

        # Telegram
        tg_cfg = notif.get("telegram", {})
        if tg_cfg.get("enabled") and self._severity_meets(
            event.severity, tg_cfg.get("min_severity", "warning")
        ):
            try:
                await self._send_telegram(event, tg_cfg)
                event.notified = True
            except Exception as e:
                logger.error(f"Telegram notification failed: {e}")

    def _severity_meets(self, severity: str, min_severity: str) -> bool:
        order = {"info": 0, "warning": 1, "critical": 2}
        return order.get(severity, 0) >= order.get(min_severity, 0)

    def _send_email(self, event: AlertEvent, cfg: Dict):
        severity_emoji = {"info": "ℹ️", "warning": "⚠️", "critical": "🔴"}
        emoji = severity_emoji.get(event.severity, "⚠️")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"{emoji} Jetson Dashboard: {event.message}"
        msg["From"] = cfg["from_addr"]
        msg["To"] = cfg["to_addr"]

        import datetime
        ts = datetime.datetime.fromtimestamp(event.timestamp).strftime("%Y-%m-%d %H:%M:%S")

        text = f"""
Jetson Dashboard Alert
======================
Severity: {event.severity.upper()}
Message:  {event.message}
Metric:   {event.metric}
Value:    {event.value}
Threshold: {event.threshold}
Time:     {ts}
"""
        html = f"""
<html><body style="font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px">
<h2 style="color:{'#f85149' if event.severity=='critical' else '#d29922'}">
  {emoji} Jetson Dashboard Alert
</h2>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:6px;color:#7d8590">Severity</td>
      <td style="padding:6px;color:{'#f85149' if event.severity=='critical' else '#d29922'}">
        <b>{event.severity.upper()}</b></td></tr>
  <tr><td style="padding:6px;color:#7d8590">Message</td>
      <td style="padding:6px"><b>{event.message}</b></td></tr>
  <tr><td style="padding:6px;color:#7d8590">Metric</td>
      <td style="padding:6px">{event.metric}</td></tr>
  <tr><td style="padding:6px;color:#7d8590">Value</td>
      <td style="padding:6px">{event.value}</td></tr>
  <tr><td style="padding:6px;color:#7d8590">Threshold</td>
      <td style="padding:6px">{event.threshold}</td></tr>
  <tr><td style="padding:6px;color:#7d8590">Time</td>
      <td style="padding:6px">{ts}</td></tr>
</table>
</body></html>
"""
        msg.attach(MIMEText(text, "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"]) as server:
            server.starttls()
            server.login(cfg["smtp_user"], cfg["smtp_password"])
            server.send_message(msg)

        logger.info(f"Email alert sent to {cfg['to_addr']}")

    async def _send_telegram(self, event: AlertEvent, cfg: Dict):
        import urllib.request
        import urllib.parse

        severity_emoji = {"info": "ℹ️", "warning": "⚠️", "critical": "🔴"}
        emoji = severity_emoji.get(event.severity, "⚠️")

        import datetime
        ts = datetime.datetime.fromtimestamp(event.timestamp).strftime("%H:%M:%S")

        text = (
            f"{emoji} *Jetson Dashboard Alert*\n"
            f"*{event.severity.upper()}* — {event.message}\n"
            f"`{event.metric}`: {event.value} (threshold: {event.threshold})\n"
            f"🕐 {ts}"
        )

        url = f"https://api.telegram.org/bot{cfg['bot_token']}/sendMessage"
        data = urllib.parse.urlencode({
            "chat_id": cfg["chat_id"],
            "text": text,
            "parse_mode": "Markdown",
        }).encode()

        req = urllib.request.Request(url, data=data, method="POST")
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: urllib.request.urlopen(req, timeout=10)
        )
        logger.info(f"Telegram alert sent to chat {cfg['chat_id']}")

    def test_email(self) -> Dict:
        """Enviar email de prueba"""
        cfg = self._config.get("notifications", {}).get("email", {})
        if not cfg.get("smtp_user"):
            return {"success": False, "error": "Email not configured"}
        try:
            test_event = AlertEvent(
                id="test",
                rule_id="test",
                severity="info",
                message="Test notification from Jetson Dashboard",
                metric="test",
                value=0,
                threshold=0,
                timestamp=time.time(),
            )
            self._send_email(test_event, cfg)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def test_telegram(self) -> Dict:
        """Enviar mensaje de prueba a Telegram"""
        cfg = self._config.get("notifications", {}).get("telegram", {})
        if not cfg.get("bot_token"):
            return {"success": False, "error": "Telegram not configured"}
        try:
            test_event = AlertEvent(
                id="test",
                rule_id="test",
                severity="info",
                message="Test notification from Jetson Dashboard",
                metric="test",
                value=0,
                threshold=0,
                timestamp=time.time(),
            )
            await self._send_telegram(test_event, cfg)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
