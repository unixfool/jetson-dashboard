#!/bin/bash
# =============================================================================
#  Jetson Dashboard — Installation Script
#  Created by: y2k — https://github.com/unixfool
#
#  Usage:
#    ./install.sh                   # Interactive install
#    ./install.sh install           # Same as above
#    ./install.sh update            # Update existing installation
#    ./install.sh uninstall         # Remove completely
#    ./install.sh status            # Show service status
#    ./install.sh logs [service]    # Show service logs
#    ./install.sh --port 8081       # Custom port
#    ./install.sh --dir ~/jetson    # Custom install directory
#    ./install.sh --help            # Show help
#
#  One-liner install:
#    curl -fsSL https://raw.githubusercontent.com/unixfool/jetson-dashboard/main/install.sh | bash
# =============================================================================

set -euo pipefail

DASHBOARD_PORT=${DASHBOARD_PORT:-8080}
REPO_DIR=${REPO_DIR:-/opt/jetson-dashboard}
REPO_URL=${REPO_URL:-https://github.com/unixfool/jetson-dashboard.git}
REQUIRED_SPACE_MB=${REQUIRED_SPACE_MB:-2048}
MIN_DOCKER_VERSION="20.10.0"
HTTPS_PORT=8443

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log_info()    { echo -e "${CYAN}[INFO]${NC}    $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}      $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}    $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC}   $1" >&2; }
log_step()    { echo -e "\n${BOLD}${BLUE}──────────────────────────────────────────${NC}"; \
                echo -e "${BOLD}${BLUE}  $1${NC}"; \
                echo -e "${BOLD}${BLUE}──────────────────────────────────────────${NC}"; }
on_error() {
    local line=$1
    echo ""
    log_error "Installation failed at line $line"
    echo ""
    echo "  Common fixes:"
    echo "    Docker not running:   sudo systemctl start docker"
    echo "    No disk space:        df -h"
    echo "    Port in use:          sudo lsof -i :$DASHBOARD_PORT"
    echo "    Permission denied:    sudo usermod -aG docker \$USER"
    echo ""
    exit 1
}
trap 'on_error $LINENO' ERR

has_cmd()   { command -v "$1" &>/dev/null; }
ver_gte()   { printf '%s\n%s\n' "$2" "$1" | sort -V -C; }
gen_secret(){ openssl rand -hex 32 2>/dev/null || \
              cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1; }
gen_pass()  { openssl rand -base64 18 2>/dev/null | tr -d '+/=' | head -c 20 || \
              cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 20 | head -n 1; }

check_arch() {
    log_step "Checking system architecture"
    local arch; arch=$(uname -m)
    if [[ "$arch" == "aarch64" || "$arch" == "arm64" ]]; then
        log_success "ARM64 architecture — Jetson compatible"
    else
        log_warn "Architecture is $arch (not ARM64). Jetson Dashboard is designed for Jetson devices."
        read -rp "  Continue anyway? [y/N] " ans
        [[ "$ans" =~ ^[Yy]$ ]] || exit 1
    fi
}

check_jetson() {
    log_step "Detecting Jetson device"
    if [[ -f /proc/device-tree/model ]]; then
        local model; model=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo "Unknown")
        if [[ "$model" == *"Jetson"* ]]; then
            log_success "Device: $model"
        else
            log_warn "Device: $model — may not be a Jetson"
        fi
    else
        log_warn "Could not detect device model"
    fi
    if [[ -f /etc/nv_tegra_release ]]; then
        log_info "L4T: $(head -1 /etc/nv_tegra_release)"
    fi
}

check_disk() {
    log_step "Checking disk space"
    local dir; dir=$(dirname "$REPO_DIR")
    [[ -d "$REPO_DIR" ]] && dir="$REPO_DIR"
    local avail_mb; avail_mb=$(df -k "$dir" 2>/dev/null | awk 'NR==2{printf "%d", $4/1024}')
    if [[ "$avail_mb" -lt "$REQUIRED_SPACE_MB" ]]; then
        log_error "Not enough disk space: ${avail_mb}MB available, ${REQUIRED_SPACE_MB}MB required"
        exit 1
    fi
    log_success "Disk space: ${avail_mb}MB available"
}

check_docker() {
    log_step "Checking Docker"
    if ! has_cmd docker; then
        log_error "Docker is not installed."
        echo ""
        echo "  Install Docker:"
        echo "    curl -fsSL https://get.docker.com | sudo sh"
        echo "    sudo usermod -aG docker \$USER"
        exit 1
    fi
    if ! docker info &>/dev/null; then
        log_error "Docker daemon is not running or you lack permissions."
        echo ""
        echo "  Fix:"
        echo "    sudo systemctl start docker"
        echo "    sudo usermod -aG docker \$USER  (then log out and back in)"
        exit 1
    fi
    local ver; ver=$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d'-' -f1)
    if ver_gte "$ver" "$MIN_DOCKER_VERSION"; then
        log_success "Docker $ver"
    else
        log_warn "Docker $ver is older than recommended $MIN_DOCKER_VERSION"
    fi
    if docker compose version &>/dev/null; then
        local cv; cv=$(docker compose version --short 2>/dev/null | tr -d 'v' || echo "2.x")
        log_success "Docker Compose $cv"
    else
        log_error "Docker Compose v2 not available. Install: sudo apt-get install docker-compose-plugin"
        exit 1
    fi
}

check_port() {
    log_step "Checking port availability"
    if timeout 1 bash -c "cat < /dev/null > /dev/tcp/localhost/$DASHBOARD_PORT" 2>/dev/null; then
        log_error "Port $DASHBOARD_PORT is already in use."
        echo ""
        echo "  Options:"
        echo "    1. Stop the service using port $DASHBOARD_PORT"
        echo "    2. Use a different port: DASHBOARD_PORT=8081 ./install.sh"
        exit 1
    fi
    log_success "Port $DASHBOARD_PORT is available"
}

check_deps() {
    log_step "Checking dependencies"
    local missing=()
    has_cmd curl   || missing+=("curl")
    has_cmd git    || missing+=("git")
    has_cmd openssl || missing+=("openssl")
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing[*]}"
        echo "  Install: sudo apt-get install ${missing[*]}"
        exit 1
    fi
    has_cmd jq || log_warn "jq not found (optional) — install with: sudo apt-get install jq"
    log_success "All required dependencies found"
}

check_internet() {
    log_step "Checking internet connectivity"
    if curl -s --max-time 8 https://github.com &>/dev/null; then
        log_success "Internet connectivity OK"
    else
        log_warn "Cannot reach GitHub. Installation may fail if cloning from remote."
        read -rp "  Continue anyway? [y/N] " ans
        [[ "$ans" =~ ^[Yy]$ ]] || exit 1
    fi
}

setup_repo() {
    log_step "Setting up repository"
    if [[ -d "$REPO_DIR/.git" ]]; then
        log_info "Existing installation found at $REPO_DIR"
        cd "$REPO_DIR"
        log_info "Checking for updates..."
        git fetch origin --quiet
        local local_h; local_h=$(git rev-parse HEAD)
        local remote_h; remote_h=$(git rev-parse "origin/$(git branch --show-current)" 2>/dev/null || echo "$local_h")
        if [[ "$local_h" != "$remote_h" ]]; then
            git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
            log_success "Repository updated"
        else
            log_success "Already at latest version"
        fi
    else
        log_info "Cloning from $REPO_URL..."
        sudo mkdir -p "$REPO_DIR"
        sudo git clone --depth 1 "$REPO_URL" "$REPO_DIR"
        sudo chown -R "$(whoami):$(whoami)" "$REPO_DIR"
        cd "$REPO_DIR"
        log_success "Repository cloned to $REPO_DIR"
    fi
}

setup_env() {
    log_step "Configuring environment"
    if [[ -f .env ]]; then
        log_info ".env already exists"
        read -rp "  Regenerate with new secure credentials? [y/N] " ans
        if [[ "$ans" =~ ^[Yy]$ ]]; then
            cp .env ".env.backup.$(date +%Y%m%d_%H%M%S)"
            log_info "Backed up existing .env"
            _write_env
        else
            log_info "Keeping existing .env"
        fi
    else
        _write_env
    fi
}

_write_env() {
    local secret; secret=$(gen_secret)
    local pass;   pass=$(gen_pass)
    local ip;     ip=$(hostname -I | awk '{print $1}' || echo "192.168.1.100")

    cat > .env << EOF
# Jetson Dashboard — Environment Configuration
# Generated: $(date)

# ── Security ──────────────────────────────────
AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD=$pass
AUTH_SECRET=$secret
AUTH_TOKEN_TTL=86400

# ── Dashboard ─────────────────────────────────
DASHBOARD_PORT=$DASHBOARD_PORT

# ── SSL ───────────────────────────────────────
JETSON_IP=$ip

# ── Hardware (leave empty for auto-detection) ─
JETSON_MODEL=
JETPACK_VERSION=
CUDA_VERSION=
CUDNN_VERSION=
TENSORRT_VERSION=

# ── Backend ───────────────────────────────────
METRICS_INTERVAL=1.5

# ── Docker ────────────────────────────────────
DOCKER_SOCKET=/var/run/docker.sock
EOF

    log_success "Environment configured"
    echo ""
    echo -e "  ${BOLD}Login credentials:${NC}"
    echo    "    Username : admin"
    echo    "    Password : $pass"
    echo    "    Jetson IP: $ip"
    echo ""
    log_warn "Save these credentials — they will not be shown again."
}

fix_perms() {
    log_step "Checking Docker permissions"
    if ! docker ps &>/dev/null; then
        sudo usermod -aG docker "$(whoami)" 2>/dev/null || true
        log_warn "Added to docker group — you may need to log out and back in."
    else
        log_success "Docker permissions OK"
    fi
}



setup_i2c_devices() {
    log_step "Detecting I2C buses"

    # Find all available I2C buses
    local i2c_devices=()
    for dev in /dev/i2c-*; do
        [[ -e "$dev" ]] && i2c_devices+=("$dev")
    done

    if [[ ${#i2c_devices[@]} -eq 0 ]]; then
        log_warn "No I2C buses found — Battery and Motor Control will not detect hardware"
        return 0
    fi

    log_success "Found ${#i2c_devices[@]} I2C bus(es): ${i2c_devices[*]}"

    # Scan each bus for known Jetson Dashboard devices
    local found_devices=()
    local device_names=()
    for dev in "${i2c_devices[@]}"; do
        local bus_num="${dev##*-}"
        # Quick scan using python3 (no i2c-tools needed)
        local found
        found=$(python3 -c "
import smbus2, sys
try:
    bus = smbus2.SMBus(${bus_num})
    hits = []
    addrs = {0x3C:'OLED SSD1306', 0x41:'INA219 Battery', 0x60:'PCA9685 Motor HAT', 0x70:'PCA9685 all-call'}
    for addr, name in addrs.items():
        try:
            bus.read_byte(addr)
            hits.append(f'{name} @ 0x{addr:02X}')
        except:
            pass
    bus.close()
    print(','.join(hits))
except:
    pass
" 2>/dev/null || true)
        if [[ -n "$found" ]]; then
            log_info "  $dev → $found"
        else
            log_info "  $dev → no known devices"
        fi
        found_devices+=("$dev")
    done

    # Patch docker-compose.yml with detected I2C devices
    local compose_file="$REPO_DIR/docker-compose.yml"
    if [[ ! -f "$compose_file" ]]; then
        log_warn "docker-compose.yml not found at $compose_file — skipping I2C patch"
        return 0
    fi

    # Build the devices block for docker-compose
    # Remove existing i2c entries first, then add detected ones
    local tmp_compose; tmp_compose=$(mktemp)

    python3 - "$compose_file" "${found_devices[@]}" << 'PYEOF'
import sys, re

compose_file = sys.argv[1]
i2c_devs = sys.argv[2:]

with open(compose_file, 'r') as f:
    content = f.read()

# Remove existing i2c device lines
content = re.sub(r'      - /dev/i2c-[0-9]+:/dev/i2c-[0-9]+\n', '', content)

# Build new i2c device lines
i2c_lines = ''.join(f'      - {d}:{d}\n' for d in sorted(set(i2c_devs)))

# Insert after /dev/video0 line
content = re.sub(
    r'(      - /dev/video0:/dev/video0\n)',
    r'\1' + i2c_lines,
    content
)

with open(compose_file, 'w') as f:
    f.write(content)

print(f"docker-compose.yml updated with {len(i2c_devs)} I2C device(s)")
PYEOF

    log_success "docker-compose.yml patched with I2C devices"
    log_info "  Devices mounted: ${found_devices[*]}"
}

setup_camera_scripts() {
    log_step "Setting up camera scripts"

    # Detect PYTHONPATH for numpy/cv2 — search user home directories
    PYPATH=""
    for user_home in /home/*/; do
        user=$(basename "$user_home")
        for pyver in python3.12 python3.11 python3.10; do
            candidate="${user_home}.local/lib/${pyver}/site-packages"
            if [[ -d "$candidate" ]] && /usr/bin/python3 -c "
import sys; sys.path.insert(0,'$candidate')
try:
    import numpy, cv2
    sys.exit(0)
except:
    sys.exit(1)
" 2>/dev/null; then
                PYPATH="$candidate"
                break 2
            fi
        done
    done

    # System fallback
    if [[ -z "$PYPATH" ]]; then
        for path in /usr/local/lib/python3.12/dist-packages /usr/lib/python3/dist-packages; do
            if [[ -d "$path" ]]; then
                PYPATH="$path"
                break
            fi
        done
    fi

    # Detect Python binary
    PYBIN="/usr/bin/python3.12"
    [[ -x "$PYBIN" ]] || PYBIN="/usr/bin/python3"

    # Detect jetson-capture.py location
    JCAPTURE="/usr/local/bin/jetson-capture.py"

    # Create jetson-cam-start.sh — uses fast stream script
    sudo tee /usr/local/bin/jetson-cam-start.sh > /dev/null << SCRIPT
#!/bin/bash
# Jetson Dashboard — Camera capture helper (created by install.sh)
OUTPUT="\${1:-/tmp/jetson_dashboard_frame.jpg}"
EXPOSURE="\${2:-50000}"
export PYTHONPATH="${PYPATH}"
exec ${PYBIN} /usr/local/bin/jetson-stream-capture.py "\$OUTPUT" "\$EXPOSURE"
SCRIPT
    sudo chmod +x /usr/local/bin/jetson-cam-start.sh

    # Create jetson-cam-stop.sh
    sudo tee /usr/local/bin/jetson-cam-stop.sh > /dev/null << SCRIPT
#!/bin/bash
# Jetson Dashboard — Camera stop helper (created by install.sh)
pkill -TERM -f 'jetson-capture' 2>/dev/null || true
pkill -TERM -f 'v4l2-ctl' 2>/dev/null || true
sleep 0.5
pkill -KILL -f 'jetson-capture' 2>/dev/null || true
pkill -KILL -f 'v4l2-ctl' 2>/dev/null || true
rm -f /tmp/jetson_dashboard_frame.jpg /tmp/jetson_raw.bin 2>/dev/null || true
exit 0
SCRIPT
    sudo chmod +x /usr/local/bin/jetson-cam-stop.sh

    # Create jetson-stream-capture.py — fast stream capture (640x480, ~1.1s/frame)
    sudo tee /usr/local/bin/jetson-stream-capture.py > /dev/null << SCRIPT
#!/usr/bin/env python3
"""Jetson IMX219 stream capture — optimizado para Jetson Dashboard"""
import sys, subprocess, numpy as np, cv2, os

OUTPUT   = sys.argv[1] if len(sys.argv) > 1 else "/tmp/jetson_dashboard_frame.jpg"
EXPOSURE = int(sys.argv[2]) if len(sys.argv) > 2 else 50000
RAW_TMP  = "/tmp/jetson_stream_raw.bin"
WIDTH, HEIGHT = 3264, 2464
OUT_W, OUT_H  = 640, 480

subprocess.run(
    ["v4l2-ctl", "--device=/dev/video0", f"--set-ctrl=exposure={EXPOSURE}"],
    capture_output=True
)

r = subprocess.run([
    "v4l2-ctl", "--device=/dev/video0",
    f"--set-fmt-video=width={WIDTH},height={HEIGHT},pixelformat=RG10",
    "--stream-mmap", "--stream-count=1", f"--stream-to={RAW_TMP}"
], capture_output=True)

if r.returncode != 0 or not os.path.exists(RAW_TMP) or os.path.getsize(RAW_TMP) == 0:
    sys.exit(1)

raw = np.fromfile(RAW_TMP, dtype=np.uint16)
os.remove(RAW_TMP)
if len(raw) < WIDTH * HEIGHT:
    sys.exit(1)

frame  = raw[:WIDTH * HEIGHT].reshape(HEIGHT, WIDTH)
frame8 = cv2.normalize(frame, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
bgr    = cv2.cvtColor(frame8, cv2.COLOR_BayerBG2BGR_EA)

h, w  = bgr.shape[:2]
zone  = bgr[h//4:h//2, w//3:2*w//3]
ref   = float(zone[:,:,1].mean())
b, g, r_ch = cv2.split(bgr.astype(np.float32))
b   = np.clip(b    * (ref / (float(zone[:,:,0].mean()) + 1e-6)), 0, 255)
r_ch = np.clip(r_ch * (ref / (float(zone[:,:,2].mean()) + 1e-6)), 0, 255)
result = cv2.merge([b, g, r_ch]).astype(np.uint8)

lab        = cv2.cvtColor(result, cv2.COLOR_BGR2LAB)
lab[:,:,0] = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8,8)).apply(lab[:,:,0])
result     = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
result     = cv2.resize(result, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA)

cv2.imwrite(OUTPUT, result, [cv2.IMWRITE_JPEG_QUALITY, 80])
SCRIPT
    sudo chmod +x /usr/local/bin/jetson-stream-capture.py

    if [[ -f "$JCAPTURE" ]]; then
        log_success "Camera scripts installed (python: $PYBIN, pythonpath: ${PYPATH:-system})"
    else
        log_warn "jetson-capture.py not found at $JCAPTURE — CSI camera will not work"
        log_warn "USB cameras will still be auto-detected and work"
    fi
}


setup_ml_workspace() {
    log_step "Setting up ML Workspace"

    local user_home; user_home=$(eval echo "~$(whoami)")
    local workspace="${user_home}/jetson-workspace"

    mkdir -p "${workspace}/models"
    mkdir -p "${workspace}/datasets"
    mkdir -p "${workspace}/projects"
    mkdir -p "${workspace}/scripts"
    log_success "Workspace created at ${workspace}"

    if docker image inspect jetson-ai:latest &>/dev/null; then
        log_success "jetson-ai:latest image found — ML Workspace ready"
    else
        log_warn "jetson-ai:latest image not found — ML Workspace will show UNAVAILABLE"
        log_warn "To enable ML Workspace, build the image:"
        log_warn "  cd ~/jetson-docker && docker build -t jetson-ai:latest ."
    fi

    local proto="${workspace}/models/MobileNetSSD_deploy.prototxt"
    local weights="${workspace}/models/MobileNetSSD_deploy.caffemodel"
    local base="https://raw.githubusercontent.com/PINTO0309/MobileNet-SSD-RealSense/master/caffemodel/MobileNetSSD"

    if [[ ! -f "$weights" ]]; then
        log_info "MobileNetSSD models not found — attempting download..."
        if curl -s --max-time 5 https://github.com &>/dev/null; then
            if curl -fsSL --max-time 30 "${base}/MobileNetSSD_deploy.prototxt" -o "$proto" 2>/dev/null &&                curl -fsSL --max-time 120 "https://github.com/PINTO0309/MobileNet-SSD-RealSense/raw/master/caffemodel/MobileNetSSD/MobileNetSSD_deploy.caffemodel" -o "$weights" 2>/dev/null; then
                log_success "MobileNetSSD models downloaded to ${workspace}/models/"
            else
                log_warn "MobileNetSSD download failed — download manually after install"
                rm -f "$proto" "$weights" 2>/dev/null || true
            fi
        else
            log_warn "No internet — skipping MobileNetSSD download"
        fi
    else
        log_success "MobileNetSSD models already present"
    fi
}

build_images() {
    log_step "Building Docker images"
    log_info "This may take 10–30 minutes on first build..."
    echo ""
    export DOCKER_BUILDKIT=1
    export BUILDKIT_PROGRESS=plain
    if ! docker compose build --no-cache; then
        log_error "Build failed. Check the output above."
        echo ""
        echo "  Common fixes:"
        echo "    docker system prune -f   (clear build cache)"
        echo "    df -h                    (check disk space)"
        exit 1
    fi
    log_success "Docker images built"
}

start_services() {
    log_step "Starting services"
    docker compose down &>/dev/null || true
    docker compose up -d
    log_success "Services started"
}

wait_ready() {
    log_step "Waiting for services to be ready"
    local attempts=0
    local max=30
    while [[ $attempts -lt $max ]]; do
        if docker compose ps 2>/dev/null | grep -q "healthy"; then
            log_success "Services are healthy"
            return 0
        fi
        if ! docker compose ps 2>/dev/null | grep -q "Up"; then
            log_error "Services stopped unexpectedly"
            docker compose logs --tail=20
            exit 1
        fi
        printf "\r  Starting... (%d/%d)" $((attempts+1)) $max
        sleep 2
        attempts=$((attempts + 1))
    done
    echo ""
    log_warn "Services may still be starting — check with: docker compose ps"
}

cmd_install() {
    clear
    echo -e "${CYAN}"
    cat << 'BANNER'
     ██╗███████╗████████╗███████╗ ██████╗ ███╗   ██╗
     ██║██╔════╝╚══██╔══╝██╔════╝██╔═══██╗████╗  ██║
     ██║█████╗     ██║   ███████╗██║   ██║██╔██╗ ██║
██   ██║██╔══╝     ██║   ╚════██║██║   ██║██║╚██╗██║
╚█████╔╝███████╗   ██║   ███████║╚██████╔╝██║ ╚████║
 ╚════╝ ╚══════╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
            D A S H B O A R D   I N S T A L L E R
                  --- Created by: y2k ---
BANNER
    echo -e "${NC}"

    check_deps
    check_arch
    check_jetson
    check_disk
    check_docker
    check_port
    check_internet
    setup_repo
    setup_env
    fix_perms
    setup_i2c_devices
    setup_camera_scripts
    setup_ml_workspace
    build_images
    start_services
    wait_ready
    show_success
}

cmd_update() {
    log_step "Updating Jetson Dashboard"
    [[ -d "$REPO_DIR/.git" ]] || { log_error "Not installed at $REPO_DIR"; exit 1; }
    cd "$REPO_DIR"
    log_info "Pulling latest changes..."
    git pull origin main 2>/dev/null || git pull origin master
    log_info "Rebuilding..."
    setup_i2c_devices
    setup_camera_scripts
    setup_ml_workspace
    docker compose down
    docker compose build
    docker compose up -d
    wait_ready
    show_success
}

cmd_uninstall() {
    log_step "Uninstalling Jetson Dashboard"
    [[ -d "$REPO_DIR" ]] || { log_warn "Not found at $REPO_DIR"; exit 0; }
    cd "$REPO_DIR"
    log_info "Stopping services..."
    docker compose down --volumes --remove-orphans 2>/dev/null || true
    docker rmi jetson-dashboard-frontend:latest jetson-dashboard-backend:latest 2>/dev/null || true
    sudo rm -f /usr/local/bin/jetson-cam-start.sh /usr/local/bin/jetson-cam-stop.sh 2>/dev/null || true
    read -rp "  Remove data directory ($REPO_DIR/data)? [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] && { sudo rm -rf "$REPO_DIR/data"; log_info "Data removed"; }
    read -rp "  Remove installation directory ($REPO_DIR)? [y/N] " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
        sudo rm -rf "$REPO_DIR"
        log_success "Uninstalled"
    else
        log_info "Config preserved at $REPO_DIR"
    fi
}

cmd_status() {
    [[ -d "$REPO_DIR" ]] || { log_error "Not installed"; exit 1; }
    cd "$REPO_DIR" && docker compose ps
}

cmd_logs() {
    [[ -d "$REPO_DIR" ]] || { log_error "Not installed"; exit 1; }
    cd "$REPO_DIR" && docker compose logs -f "${1:-}"
}

show_success() {
    local ip; ip=$(hostname -I | awk '{print $1}')
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     ✓  JETSON DASHBOARD IS RUNNING           ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Access (HTTPS):                             ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Local:    https://localhost:$HTTPS_PORT          ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Network:  https://$ip:$HTTPS_PORT      ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Accept the self-signed certificate warning  ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  in your browser on first access.            ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  Useful commands:                            ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    docker compose ps      (status)           ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    docker compose logs -f (live logs)        ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    docker compose down    (stop)             ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    ./install.sh update    (update)           ${GREEN}║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

show_help() {
    cat << EOF
Jetson Dashboard — Installer

Usage: ./install.sh [COMMAND] [OPTIONS]

Commands:
  install        Install or reinstall Jetson Dashboard (default)
  update         Update to the latest version
  uninstall      Remove Jetson Dashboard completely
  status         Show running container status
  logs [svc]     Stream logs (optionally filter by service name)

Options:
  -p, --port PORT    Dashboard HTTP port (default: 8080, HTTPS always 8443)
  -d, --dir  DIR     Installation directory (default: /opt/jetson-dashboard)
  -u, --url  URL     Git repository URL
  -h, --help         Show this help

Environment variables:
  DASHBOARD_PORT     Same as --port
  REPO_DIR           Same as --dir
  REPO_URL           Same as --url

Examples:
  ./install.sh                            Default install
  ./install.sh --port 8081                Install on custom port
  ./install.sh --dir ~/jetson-dashboard   Install to home directory
  ./install.sh update                     Update existing install
  ./install.sh logs backend               Stream backend logs
  ./install.sh uninstall                  Remove completely

Support: https://github.com/unixfool/jetson-dashboard/issues
EOF
}

main() {
    local cmd="install"
    while [[ $# -gt 0 ]]; do
        case $1 in
            install|update|uninstall|status|logs) cmd="$1"; shift ;;
            -p|--port)  DASHBOARD_PORT="$2"; shift 2 ;;
            -d|--dir)   REPO_DIR="$2";       shift 2 ;;
            -u|--url)   REPO_URL="$2";       shift 2 ;;
            -h|--help)  show_help; exit 0 ;;
            -*) log_error "Unknown option: $1"; show_help; exit 1 ;;
            *)  log_error "Unknown command: $1"; show_help; exit 1 ;;
        esac
    done

    case $cmd in
        install)   cmd_install ;;
        update)    cmd_update ;;
        uninstall) cmd_uninstall ;;
        status)    cmd_status ;;
        logs)      cmd_logs "${2:-}" ;;
    esac
}

main "$@"
