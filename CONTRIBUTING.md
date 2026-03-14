# Contributing to Jetson Dashboard

Thank you for your interest in contributing. This document explains how the project is structured, how to set up a development environment, and the conventions used throughout the codebase.

---

## Project Structure

```
jetson-dashboard/
├── backend/          Python FastAPI — metrics, hardware control, APIs
├── frontend/         React + Vite + Tailwind — web UI
├── docker/           Dockerfiles, nginx config, entrypoint script
├── data/             Runtime data (gitignored) — DB, config, SSL
└── scripts/          Utility shell scripts
```

The backend and frontend run as separate Docker containers, both using `network_mode: host` so they share the host network with the Jetson for metrics collection.

---

## Development Setup

### Prerequisites

- Docker + Docker Compose v2
- Node.js 20+ (for frontend development without Docker)
- Python 3.11+ (for backend development without Docker)

### Running with Docker (recommended)

```bash
cp env.example .env
# Edit .env — set JETSON_IP to your device's IP
docker compose up -d --build
```

### Running backend locally (for fast iteration)

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Running frontend locally

```bash
cd frontend
npm install
npm run dev     # Vite dev server on http://localhost:5173
```

The Vite dev server proxies `/api` and `/ws` to `http://localhost:8000` via `vite.config.js`.

---

## Backend Conventions

### API routes

Each feature has its own file in `backend/api/`. Register the router in `main.py`:

```python
from api.myfeature import router as myfeature_router
app.include_router(myfeature_router, prefix="/api", dependencies=[Depends(require_auth)])
```

All routes use the `/api` prefix. Authentication is applied globally via `Depends(require_auth)`.

### Host commands from inside the container

The backend runs inside Docker but needs to execute commands on the Jetson host. There are two patterns:

**For one-off commands (read-only, no systemd):**
```python
import subprocess
result = subprocess.run(
    ["/bin/bash", "-c", "nsenter --target 1 --mount -- <command>"],
    capture_output=True, timeout=10
)
```

**For commands that need systemd (start/stop services, reboot):**
```python
shell_cmd = "nsenter --target 1 --mount -- systemd-run --pipe --quiet -- <command>"
result = subprocess.run(["/bin/bash", "-c", shell_cmd], capture_output=True, timeout=10)
```

> **Important:** Never use `asyncio.create_subprocess_exec` for host commands — it does not inherit the bash environment needed for nsenter. Always use `subprocess.run` with `["/bin/bash", "-c", cmd]`.

> **Important:** For detection/probing (e.g. checking if ROS2 exists), do NOT use `systemd-run`. Use `nsenter --mount -- bash -c 'test -f ...'` to avoid creating failed transient systemd units.

### Services

Long-running background tasks live in `backend/services/`. They are instantiated once in `main.py` and shared via module-level singletons.

---

## Frontend Conventions

### Theming

The app supports Dark and Light mode. All colors are defined as CSS custom properties in `src/index.css`:

```css
:root           { /* dark mode values */ }
[data-theme="light"] { /* light mode values */ }
```

**Never hardcode colors in components.** Always use:
- CSS variables: `style={{ color: 'var(--color-cyan)' }}`
- Tailwind jet-* classes: `text-jet-cyan`, `bg-jet-card`, `border-jet-border`

The jet-* Tailwind colors are mapped to CSS variables in `tailwind.config.js`, so they automatically respond to theme changes.

### Component patterns

**Panels (cards with header)** — use the `.panel` and `.panel-header` classes:

```jsx
<div className="panel">
  <div className="panel-header">
    <Icon size={13} style={{ color: 'var(--color-cyan)' }}/>
    <span className="font-mono text-xs font-bold tracking-widest">TITLE</span>
  </div>
  <div className="panel-body">
    {/* content */}
  </div>
</div>
```

**Inputs and selects** — use the `.jet-input` class:

```jsx
<input className="jet-input text-sm" placeholder="..." />
<select className="jet-input text-xs">...</select>
```

**Buttons** — use the `.btn-*` utility classes:

```jsx
<button className="btn-primary">Action</button>
<button className="btn-ghost">Cancel</button>
<button className="btn-danger">Delete</button>
```

### State management

State is managed with Zustand. Each store is a single file in `src/store/`:

| Store | Purpose |
|---|---|
| `metricsStore.js` | WebSocket connection, live metrics, alert badges |
| `authStore.js` | JWT token, login/logout, auth state |
| `themeStore.js` | Dark/Light theme, persisted in localStorage |

### API calls

Use the `apiFetch` helper from `src/utils/format.js`. It automatically attaches the Bearer token:

```js
import { apiFetch } from '../utils/format'

const data = await apiFetch('/some/endpoint')
const result = await apiFetch('/some/endpoint', { method: 'POST', body: JSON.stringify(payload) })
```

---

## Adding a New Feature

### 1. Backend endpoint

Create `backend/api/myfeature.py`:

```python
from fastapi import APIRouter
router = APIRouter()

@router.get("/myfeature/status")
async def myfeature_status():
    return {"ok": True}
```

Register in `backend/main.py`:

```python
from api.myfeature import router as myfeature_router
app.include_router(myfeature_router, prefix="/api", dependencies=[Depends(require_auth)])
```

### 2. Frontend page

Create `frontend/src/pages/MyFeaturePage.jsx`. Follow the panel pattern for cards.

### 3. Register route and nav

In `frontend/src/App.jsx`:
```jsx
import MyFeaturePage from './pages/MyFeaturePage'
// Inside <Routes>:
<Route path="myfeature" element={<MyFeaturePage />} />
```

In `frontend/src/components/layout/Layout.jsx`, add to `NAV_ITEMS`:
```js
{ path: '/myfeature', icon: SomeIcon, label: 'My Feature' },
```

### 4. Rebuild

```bash
docker compose down && docker compose up -d --build
```

---

## Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Test on actual Jetson hardware if possible
- For UI changes, test both Dark and Light mode
- Do not commit `data/` directory contents (it is gitignored)
- Do not commit `.env` (use `env.example` for documentation)
- Update `README.md` if you add a new feature

---

## Known Constraints

| Constraint | Reason |
|---|---|
| `privileged: true` required | Needed for nsenter, jetson_clocks, nvpmodel, fan PWM |
| `subprocess.run` not `asyncio` | asyncio subprocess doesn't inherit bash env for nsenter |
| No `systemd-run` for detection | Creates failed transient units in systemd |
| No nvargus on Ubuntu 24 | EGL display required, incomplete device tree |
| psutil sees container PIDs | Host PIDs require nsenter kill fallback |
| Camera conflicts on concurrent access | `/dev/video0` is exclusive — snapshot uses cache when stream is active |

---

## Getting Help

Open an issue on GitHub with:
- Your Jetson model and JetPack version
- Output of `docker logs jetson-dashboard-backend --tail=50`
- Steps to reproduce the problem
