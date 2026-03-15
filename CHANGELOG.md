# Changelog

All notable changes to Jetson Dashboard are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com).


## [v1.0.5] — 2026-03-15

### 📚 Documentation
- docs: add one-line install, nginx_map.conf and docs/ to README


## [v1.0.4] — 2026-03-15
### 🐛 Bug Fixes
- fix: frontend unhealthy and WebSocket 403
## [v1.0.3] — 2026-03-14
### 📚 Documentation
- docs: update web with dynamic version, USB camera and deploy script
## [v1.0.2] — 2026-03-14
### 📚 Documentation
- docs: update README with camera USB, deploy script and release workflow
## [v1.0.1] — 2026-03-14
### 📚 Documentation
- docs: update README with disclaimer
- docs: update README
### 🔧 Chores
- chore: add deploy script for Jetson
- chore: fix entrypoint.sh executable permissions
- chore: add JETSON_IP to env.example
- chore: add --skip-build flag to release script
## [v1.0.0] — 2026-03-13
### ✨ New Features
- Real-time hardware monitoring via WebSocket (CPU, GPU, Memory, Storage, Network, Thermals)
- Auto-detection of Jetson model, JetPack, CUDA, cuDNN, TensorRT, OpenCV
- Fan PWM control (0–255), persisted across reboots
- nvpmodel power mode switching (MaxN, 5W, 10W, etc.)
- jetson_clocks enable/disable support
- Process manager with host PID kill via nsenter
- Docker container manager (list, start, stop, restart)
- Systemd service manager (browse, start, stop, restart, enable/disable)
- IMX219 CSI camera live MJPEG stream and snapshot (RAW10 Bayer debayer pipeline)
- ROS2 monitor — auto-detects Docker/host, lists nodes and topics with Hz
- Alert system with 10 configurable rules, email (Gmail SMTP) and Telegram notifications
- SQLite metrics history with 7 charts, range selector 1H–30D
- HTTPS with auto-generated self-signed certificate (SAN support)
- Backup and restore — ZIP export of all config and data, selective restore
- Dark and Light mode with instant toggle, persisted in browser
- JWT authentication (optional), Bearer tokens, 24h TTL
