# Jetson Dashboard

A full-stack web monitoring and management system for NVIDIA Jetson devices. Built with FastAPI + React, deployed via Docker Compose.

![NVIDIA Jetson](https://img.shields.io/badge/NVIDIA-Jetson-76b900?style=flat&logo=nvidia)
![JetPack](https://img.shields.io/badge/JetPack-4.x%20%7C%205.x%20%7C%206.x-blue?style=flat)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat&logo=docker)
![License](https://img.shields.io/badge/license-MIT-green?style=flat)

---

## Features

| Feature | Description |
|---|---|
| **Real-time metrics** | CPU, GPU, Memory, Storage, Network, Thermals via WebSocket (1.5s) |
| **Hardware detection** | Auto-detects Jetson model, JetPack, CUDA, cuDNN, TensorRT, OpenCV |
| **Fan control** | PWM fan speed 0–255, persisted across reboots |
| **Power modes** | nvpmodel switching (MaxN, 5W, 10W, etc.) |
| **jetson_clocks** | Enable/disable CPU/GPU max clock lock |
| **Process manager** | List, sort, kill processes including host PIDs |
| **Docker manager** | List, start, stop, restart containers |
| **Systemd services** | Browse, start, stop, restart, enable/disable all host services |
| **Camera** | IMX219 CSI + USB cameras — auto-detected, live MJPEG stream + snapshot |
| **ROS2 monitor** | Auto-detect Docker/host ROS2, list nodes and topics with Hz |
| **Alert system** | 10 configurable rules, email (Gmail SMTP) and Telegram notifications |
| **History** | SQLite metrics database with 7 charts, range 1H–30D |
| **HTTPS** | Self-signed SSL certificate, auto-generated on first boot |
| **Backup/Restore** | ZIP backup of all config and data, selective restore |
| **Task Scheduler** | Schedule commands on the Jetson host — presets, history, run now |
| **Dark / Light mode** | Theme toggle, persisted in browser |
| **JWT authentication** | Optional login, Bearer tokens, 24h TTL |
| **Two-Factor Authentication** | TOTP 2FA via Google Authenticator or any TOTP app |

---

## Requirements

| Requirement | Notes |
|---|---|
| NVIDIA Jetson device | Nano, NX, AGX, Orin — any model |
| JetPack 4.x / 5.x / 6.x | Or Ubuntu 22/24 with L4T kernel |
| Docker + Docker Compose | `docker compose` v2 required |
| Camera (optional) | IMX219 CSI or any USB UVC camera on `/dev/video0` |

---

## Quick Start

### One-line install (recommended)

Run this command on your Jetson — it handles everything automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/unixfool/jetson-dashboard/main/install.sh | bash
```

The installer checks dependencies, clones the repo, generates secure credentials, builds the Docker images and starts the dashboard.

---

### Manual install

```bash
# 1. Clone the repo
git clone https://github.com/unixfool/jetson-dashboard.git
cd jetson-dashboard

# 2. Configure environment
cp env.example .env
# Edit .env — set JETSON_IP to your Jetson's IP address

# 3. Build and start
docker compose up -d --build

# 4. Open in browser
# HTTP  → http://<JETSON_IP>:8080   (redirects to HTTPS)
# HTTPS → https://<JETSON_IP>:8443
```

On first boot, an SSL certificate is automatically generated for `JETSON_IP`.
The browser will show a security warning for the self-signed certificate — click "Advanced → Continue" to proceed.

---

## Configuration

All configuration is done via the `.env` file in the project root.

```env
# ─── Security ────
AUTH_ENABLED=false          # Set to true to require login
AUTH_USERNAME=admin
AUTH_PASSWORD=changeme      # Change this
AUTH_SECRET=change-this-secret-key
AUTH_TOKEN_TTL=86400        # 24 hours

# ─── Dashboard ────
DASHBOARD_PORT=8080

# ─── Hardware Override (leave empty for auto-detection) ────
JETSON_MODEL=
JETPACK_VERSION=
CUDA_VERSION=
CUDNN_VERSION=
TENSORRT_VERSION=

# ─── Backend ────
METRICS_INTERVAL=1.5        # WebSocket push interval in seconds

# ─── Docker ────
DOCKER_SOCKET=/var/run/docker.sock

# ─── SSL ────
JETSON_IP=192.168.1.138     # Your Jetson's IP for the SSL certificate SAN
```

---

## Architecture

```
jetson-dashboard/
├── backend/                        FastAPI application
│   ├── main.py                     App entry point, router registration
│   ├── requirements.txt
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py               System, hardware, fan, power endpoints
│   │   ├── auth.py                 JWT + TOTP 2FA authentication
│   │   ├── websocket.py            Real-time metrics WebSocket
│   │   ├── alerts.py               Alert rules CRUD and notifications
│   │   ├── history.py              SQLite metrics query endpoints
│   │   ├── systemd.py              Systemd service management
│   │   ├── camera.py               CSI/USB camera auto-detection + MJPEG stream
│   │   ├── ros2.py                 ROS2 node/topic monitor
│   │   ├── backup.py               Backup and restore
│   │   └── scheduler.py            Task scheduler — cron-like job management
│   ├── collectors/
│   │   ├── __init__.py
│   │   ├── hardware_detector.py    Jetson model, JetPack, CUDA detection
│   │   ├── system_metrics.py       CPU, memory, storage, network
│   │   └── gpu_metrics.py          GPU load, memory, temperature
│   ├── models/
│   │   └── __init__.py
│   └── services/
│       ├── __init__.py
│       ├── metrics_broadcaster.py  WebSocket broadcast loop
│       ├── alert_manager.py        Alert evaluation and notifications
│       ├── metrics_db.py           SQLite 1s/1m/1h aggregation
│       ├── docker_manager.py       Docker SDK wrapper
│       ├── process_manager.py      psutil + nsenter host kill
│       └── hardware_control.py     Fan, nvpmodel, jetson_clocks
│
├── frontend/                       React + Vite + Tailwind
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css               CSS variables — Dark & Light mode + mesh gradient
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── CPUPage.jsx
│       │   ├── GPUPage.jsx
│       │   ├── MemoryPage.jsx
│       │   ├── StoragePage.jsx
│       │   ├── NetworkPage.jsx
│       │   ├── ThermalPage.jsx
│       │   ├── ProcessesPage.jsx
│       │   ├── DockerPage.jsx
│       │   ├── LogsPage.jsx
│       │   ├── HistoryPage.jsx
│       │   ├── AlertsPage.jsx
│       │   ├── SystemdPage.jsx
│       │   ├── CameraPage.jsx
│       │   ├── Ros2Page.jsx
│       │   ├── BackupPage.jsx
│       │   ├── SchedulerPage.jsx
│       │   ├── SettingsPage.jsx
│       │   └── LoginPage.jsx
│       ├── components/
│       │   ├── alerts/
│       │   │   └── AlertToast.jsx
│       │   ├── charts/
│       │   │   └── Charts.jsx
│       │   └── layout/
│       │       └── Layout.jsx
│       ├── store/
│       │   ├── metricsStore.js     WebSocket, live metrics, alert badges
│       │   ├── authStore.js        JWT token, login/logout
│       │   └── themeStore.js       Dark/Light theme, localStorage
│       └── utils/
│           └── format.js           apiFetch helper, formatters
│
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend         Multi-stage: Node build → nginx serve
│   ├── nginx.conf                  HTTP→HTTPS redirect, API proxy, WebSocket
│   ├── nginx_map.conf              WebSocket upgrade map (http-level directive)
│   └── entrypoint.sh               SSL cert auto-generation on first boot
│
├── data/                           Persisted data (mounted as volume, gitignored)
│   ├── settings.json               Dashboard settings + TOTP 2FA secret
│   ├── alerts_config.json
│   ├── alerts_history.json
│   ├── metrics.db
│   ├── scheduler.json              Scheduled tasks configuration
│   └── ssl/
│       └── jetson-dashboard.crt    Auto-generated SSL certificate
│
├── scripts/
│   ├── release.sh                  Semver release manager — run on PC
│   ├── deploy.sh                   Deploy script — run on Jetson
│   ├── export-cert.sh              Export SSL cert for browser installation
│   └── cleanup-systemd-runs.sh     Clean leftover systemd transient units
│
├── docs/
│   └── index.html                  GitHub Pages landing page
│
├── CHANGELOG.md
├── CONTRIBUTING.md
├── README.md
├── VERSION
├── docker-compose.yml
├── env.example
└── install.sh
```

---

## Camera Setup

The dashboard auto-detects the connected camera type on first stream start by querying `v4l2-ctl --list-formats`. No manual configuration is needed.

| Camera type | Format | Pipeline |
|---|---|---|
| IMX219 CSI | RAW10 Bayer (RG10) | RAW capture → debayering → JPEG |
| USB — with hardware encoder | MJPEG native | Direct JPEG from camera |
| USB — basic webcam | YUYV 4:2:2 | YUV → RGB conversion → JPEG |

**IMX219 notes:** `nvargus-daemon` is not required. The pipeline uses `v4l2-ctl` for RAW10 Bayer capture and debayers in software with numpy + Pillow.

**USB notes:** If your USB camera is on `/dev/video1` instead of `/dev/video0`, update `CAMERA_DEVICE` in `backend/api/camera.py`.

The camera stream auto-starts when the Camera page is opened and auto-stops 10 seconds after the last client disconnects to free CPU resources.

---

## ROS2 Monitor

The ROS2 monitor auto-detects ROS2 in two ways:

1. **Docker container** — scans running containers for `/opt/ros/*`
2. **Host native** — checks for `/opt/ros/<distro>/setup.bash` via nsenter

Supported distributions: `humble`, `iron`, `foxy`, `galactic`, `jazzy`.

To start your ROS2 environment on Jetson:

```bash
jros           # Interactive ROS2 shell
jcam_node      # IMX219 camera node
```

---

## HTTPS and Remote Access

### Local network
Access at `https://<JETSON_IP>:8443`. The browser will warn about the self-signed certificate.

To install the certificate and remove the warning permanently:

```bash
cd ~/jetson-dashboard && bash scripts/export-cert.sh
```

### Remote access (internet)
Forward port **8443 TCP** on your router to `<JETSON_IP>:8443`. Then access at `https://<YOUR_PUBLIC_IP>:8443`.

---

## Alerts

Alerts support two notification channels:

**Email (Gmail)**
1. Enable 2FA on your Google account
2. Generate an App Password at myaccount.google.com/apppasswords
3. Configure in Dashboard → Alerts → Notifications tab

**Telegram**
1. Create a bot via @BotFather, copy the token
2. Get your chat ID by messaging the bot and visiting `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Configure in Dashboard → Alerts → Notifications tab

---

## Task Scheduler

The scheduler lets you run commands on the Jetson host automatically on a recurring schedule.

### Available schedules

Every minute, 5m, 15m, 30m, 1h, 6h, 12h, daily, weekly.

### Preset tasks

| Preset | Schedule | Command |
|---|---|---|
| System cleanup | Weekly | `sudo systemctl reset-failed` |
| Docker cleanup | Weekly | `docker system prune -f` |
| Check disk space | Daily | `df -h / \| tail -1` |
| Sync system clock | Daily | `sudo chronyc makestep` |

### Features

- Enable/disable tasks without deleting them
- Run any task immediately with **Run Now**
- Last 10 execution results stored per task with full output
- Visual indicators for overdue and failed tasks
- Tasks stored in `data/scheduler.json`

---

## Backup and Restore

Create a full backup from Dashboard → Backup → Download Backup ZIP.

The backup contains: `settings.json`, `alerts_config.json`, `alerts_history.json`, `metrics.db`, `scheduler.json` and SSL certificates.

To restore, upload the ZIP in Dashboard → Backup → Restore. Before restoring, a safety backup is automatically created in `data/pre_restore_*.zip`.

After restoring settings or SSL certificates, restart the backend:

```bash
docker compose restart backend
```

---

## Release and Deploy Workflow

This project uses two separate scripts for release management:

| Script | Where to run | Purpose |
|---|---|---|
| `scripts/release.sh` | PC / developer machine | Bump version, generate changelog, create git tag, push to GitHub |
| `scripts/deploy.sh` | Jetson (production) | Pull latest release, build ARM64 images, restart services |

**On your PC — create a new release:**
```bash
bash scripts/release.sh --patch          # 1.0.0 → 1.0.1
bash scripts/release.sh --minor          # 1.0.0 → 1.1.0
bash scripts/release.sh --major          # 1.0.0 → 2.0.0
bash scripts/release.sh --patch --dry-run        # Simulate without changes
bash scripts/release.sh --patch --skip-build     # Skip Docker build validation
```

**On the Jetson — apply the release:**
```bash
bash scripts/deploy.sh                   # Pull + build + restart
bash scripts/deploy.sh --version         # Show current deployed version
bash scripts/deploy.sh --rollback        # Rollback to previous version
```

---

## Useful Commands

```bash
# Start
docker compose up -d

# Rebuild after code changes
docker compose down && docker compose up -d --build

# View logs
docker logs jetson-dashboard-backend -f
docker logs jetson-dashboard-frontend -f

# Check running containers
docker compose ps

# Export SSL certificate for browser installation
bash scripts/export-cert.sh

# Clean leftover systemd transient units (run once if needed)
sudo systemctl reset-failed
bash scripts/cleanup-systemd-runs.sh

# Shell inside backend container
docker exec -it jetson-dashboard-backend bash
```

---

## Compatibility

| JetPack | L4T | Status |
|---|---|---|
| 4.6.x | R32.7.x | ✅ Tested (Ubuntu 24 + kernel 4.9-tegra) |
| 5.x   | R35.x   | ✅ Compatible |
| 6.x   | R36.x   | ✅ Compatible |

The dashboard uses `privileged: true` and mounts `/proc`, `/sys`, and `/etc` read-only to access hardware metrics. Systemd commands use `nsenter --target 1 --mount` to reach the host PID 1 namespace from inside the container.

---

## Two-Factor Authentication

2FA adds an extra layer of security to your dashboard login. It uses TOTP (Time-based One-Time Password), compatible with Google Authenticator, Authy and any standard TOTP app.

### Enable 2FA

1. Make sure `AUTH_ENABLED=true` in your `.env`
2. Log in to the dashboard
3. Go to **Settings → Two-Factor Authentication**
4. Click **Enable 2FA**
5. Scan the QR code with Google Authenticator
6. Enter the 6-digit code to confirm — 2FA is now active

### Login with 2FA active

1. Enter your username and password
2. Open Google Authenticator and enter the 6-digit code
3. Access granted — token valid for 24h

### Disable 2FA

Go to **Settings → Two-Factor Authentication → Disable 2FA** and confirm with a valid code from your authenticator app.

> The TOTP secret is stored in `data/settings.json` and is included in the Backup/Restore system.

---

## License

MIT License — see [LICENSE](LICENSE) for full text.

---

## Disclaimer

This project is an independent community project and is not affiliated with, endorsed by, or sponsored by NVIDIA or Waveshare.

The NVIDIA Jetson Nano Developer Kit and Waveshare names are mentioned solely to indicate hardware compatibility with this project.

All trademarks, product names, and company names or logos mentioned in this repository are the property of their respective owners.

This repository was created as a personal project to experiment with and manage a self-hosted server environment using Jetson Nano hardware.

The maintainers of this repository are not associated with NVIDIA or Waveshare in any official capacity.
