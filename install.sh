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
    echo -e "${GREEN}║${NC}    Network:  https://$ip:$HTTPS_PORT   ${GREEN}║${NC}"
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
