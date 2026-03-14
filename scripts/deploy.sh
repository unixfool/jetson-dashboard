#!/usr/bin/env bash
# =============================================================================
#  Jetson Dashboard — Deploy Script (run on Jetson)
#  Created by: y2k — https://github.com/unixfool
#
#  Pulls the latest release from GitHub, builds the ARM64 Docker images
#  and restarts the dashboard. Run this on the Jetson after every release.
#
#  Usage:
#    bash scripts/deploy.sh              Deploy latest version from main
#    bash scripts/deploy.sh --version    Show current deployed version
#    bash scripts/deploy.sh --rollback   Rollback to previous version
# =============================================================================

set -euo pipefail


RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✘${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}"; }
die()     { error "$*"; exit 1; }

on_error() {
    echo ""
    error "Deploy failed at line $1"
    echo ""
    echo "  The previous version is still running."
    echo "  Check logs: docker compose logs --tail=50"
    echo ""
    exit 1
}
trap 'on_error $LINENO' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

VERSION_FILE="VERSION"

case "${1:-deploy}" in
  --version)
    if [[ -f "$VERSION_FILE" ]]; then
      echo -e "  Deployed version: ${BOLD}v$(cat $VERSION_FILE)${RESET}"
    else
      echo "  No VERSION file found"
    fi
    docker compose ps 2>/dev/null || true
    exit 0
    ;;
  --rollback)
    header "Rollback"
    PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
    [[ -z "$PREV_TAG" ]] && die "No previous tag found to rollback to"
    warn "Rolling back to $PREV_TAG..."
    read -rp "  Confirm rollback to $PREV_TAG? [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { info "Rollback cancelled"; exit 0; }
    git checkout "$PREV_TAG"
    docker compose down
    docker compose build --no-cache
    docker compose up -d
    success "Rolled back to $PREV_TAG"
    exit 0
    ;;
  deploy|"")
    ;;
  *)
    echo "Usage: bash scripts/deploy.sh [--version|--rollback]"
    exit 1
    ;;
esac

echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   JETSON DASHBOARD — DEPLOY              ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n"

header "Pre-flight"

# Verify we are on a Jetson
ARCH=$(uname -m)
[[ "$ARCH" == "aarch64" ]] || warn "Architecture is $ARCH — expected aarch64 (Jetson)"
success "Architecture: $ARCH"

# Verify git repo
git rev-parse --git-dir >/dev/null 2>&1 || die "Not a git repository"
success "Git repository detected"

# Verify Docker
command -v docker >/dev/null 2>&1 || die "Docker not installed"
docker info >/dev/null 2>&1       || die "Docker daemon is not running"
success "Docker daemon is running"

# Verify docker-compose.yml has privileged: true (required for Jetson hardware)
grep -q "privileged: true" docker-compose.yml || die "docker-compose.yml missing 'privileged: true'"
success "docker-compose.yml OK"

header "Current state"

CURRENT_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "unknown")
CURRENT_BRANCH=$(git branch --show-current)
info "Deployed version : v$CURRENT_VERSION"
info "Branch           : $CURRENT_BRANCH"
info "Last commit      : $(git log --oneline -1)"

header "Pulling latest release"

info "Fetching from origin..."
git fetch origin --tags --quiet

REMOTE_VERSION=$(git describe --tags origin/main 2>/dev/null || echo "unknown")
info "Latest version on GitHub: $REMOTE_VERSION"

if [[ "v$CURRENT_VERSION" == "$REMOTE_VERSION" ]]; then
    warn "Already at latest version ($REMOTE_VERSION)"
    read -rp "  Force redeploy anyway? [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { info "Nothing to deploy"; exit 0; }
fi

git pull origin main --rebase || die "Git pull failed — resolve conflicts first"
NEW_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "unknown")
success "Updated: v$CURRENT_VERSION → v$NEW_VERSION"

header "Building ARM64 Docker images"

info "This may take a few minutes on first build..."
echo ""

export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain

docker compose build --no-cache 2>&1 | grep -E "^(Step|#[0-9]|DONE|ERROR|---)" || true
success "Docker images built (ARM64)"

header "Restarting services"

info "Stopping current containers..."
docker compose down

info "Starting new containers..."
docker compose up -d
success "Services started"

header "Health check"

info "Waiting for services to be ready..."
ATTEMPTS=0
MAX=20
while [[ $ATTEMPTS -lt $MAX ]]; do
    if docker compose ps 2>/dev/null | grep -q "healthy\|Up"; then
        # Check backend API responds
        if curl -sk --max-time 3 "https://localhost:8443/api/auth/status" >/dev/null 2>&1; then
            success "Backend API is responding"
            break
        fi
    fi
    printf "\r  Waiting... (%d/%d)" $((ATTEMPTS+1)) $MAX
    sleep 3
    ATTEMPTS=$((ATTEMPTS+1))
done
echo ""

if [[ $ATTEMPTS -eq $MAX ]]; then
    warn "Health check timed out — check logs: docker compose logs --tail=30"
else
    success "Dashboard is healthy"
fi

JETSON_IP=$(grep "^JETSON_IP=" .env 2>/dev/null | cut -d'=' -f2 || hostname -I | awk '{print $1}')

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║   DEPLOY v$NEW_VERSION COMPLETE!             ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Version:${RESET}  v$CURRENT_VERSION  →  v$NEW_VERSION"
echo -e "  ${BOLD}Access:${RESET}   https://$JETSON_IP:8443"
echo ""
echo -e "  ${CYAN}Useful commands:${RESET}"
echo    "    docker compose ps          (status)"
echo    "    docker compose logs -f     (live logs)"
echo    "    bash scripts/deploy.sh --version   (check version)"
echo    "    bash scripts/deploy.sh --rollback  (rollback)"
echo ""