#!/usr/bin/env bash
# =============================================================================
#  Jetson Dashboard — Release Manager
#  Created by: y2k — https://github.com/unixfool
#
#  Semver release with 10 validation steps:
#  pre-flight · docker build · backend · frontend · infra · security ·
#  version bump · changelog · summary · apply
#
#  Usage:
#    bash scripts/release.sh                   Interactive mode
#    bash scripts/release.sh --patch           Auto bump 1.0.0 → 1.0.1
#    bash scripts/release.sh --minor           Auto bump 1.0.0 → 1.1.0
#    bash scripts/release.sh --major           Auto bump 1.0.0 → 2.0.0
#    bash scripts/release.sh --dry-run         Simulate without any changes
#    bash scripts/release.sh --patch --dry-run
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✘${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}"; }
dryrun()  { echo -e "${DIM}[dry-run]${RESET} $*"; }
die()     { error "$*"; exit 1; }

BUMP_TYPE=""
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --patch)   BUMP_TYPE="patch" ;;
    --minor)   BUMP_TYPE="minor" ;;
    --major)   BUMP_TYPE="major" ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h) echo "Usage: bash scripts/release.sh [--patch|--minor|--major] [--dry-run]"; exit 0 ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PACKAGE_JSON="frontend/package.json"
CHANGELOG="CHANGELOG.md"
VERSION_FILE="VERSION"

echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   JETSON DASHBOARD — RELEASE MANAGER     ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n"
$DRY_RUN && warn "DRY RUN MODE — no changes will be committed or pushed\n"

header "STEP 1 — Pre-flight checks"

command -v git >/dev/null 2>&1 || die "git is not installed"
success "git found: $(git --version)"

git rev-parse --git-dir >/dev/null 2>&1 || die "Not inside a git repository"
success "Git repository detected"

git remote get-url origin >/dev/null 2>&1 || die "No git remote 'origin' configured"
REMOTE_URL=$(git remote get-url origin)
success "Remote origin: $REMOTE_URL"

CURRENT_BRANCH=$(git branch --show-current)
info "Current branch: ${BOLD}$CURRENT_BRANCH${RESET}"
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  warn "Not on main/master (current: $CURRENT_BRANCH)"
  read -rp "  Continue anyway? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted"
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "You have uncommitted changes:"
  git status --short
  echo ""
  read -rp "  Commit all changes before releasing? [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    read -rp "  Commit message: " msg
    [[ -n "$msg" ]] || die "Commit message cannot be empty"
    if ! $DRY_RUN; then
      git add -A
      git commit -m "$msg"
      success "Changes committed"
    else
      dryrun "git add -A && git commit -m \"$msg\""
    fi
  else
    die "Commit or stash your changes before releasing"
  fi
else
  success "Working tree is clean"
fi

info "Fetching remote..."
if ! $DRY_RUN; then
  git fetch origin "$CURRENT_BRANCH" --quiet 2>/dev/null || warn "Could not fetch (offline?)"
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "")
  if [[ -n "$REMOTE" && "$LOCAL" != "$REMOTE" ]]; then
    BEHIND=$(git rev-list HEAD..origin/"$CURRENT_BRANCH" --count 2>/dev/null || echo 0)
    if [[ "$BEHIND" -gt 0 ]]; then
      warn "Branch is $BEHIND commit(s) behind origin/$CURRENT_BRANCH"
      read -rp "  Pull before releasing? [Y/n] " ans
      if [[ ! "$ans" =~ ^[Nn]$ ]]; then
        git pull origin "$CURRENT_BRANCH" --rebase || die "Pull failed — resolve conflicts first"
        success "Pulled latest changes"
      fi
    fi
  fi
else
  dryrun "git fetch origin $CURRENT_BRANCH"
fi
success "Remote check done"

header "STEP 2 — Docker build validation"

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker info >/dev/null 2>&1       || die "Docker daemon is not running"
success "Docker daemon is running"

info "Building Docker images (no-cache)..."
if ! $DRY_RUN; then
  docker compose build --no-cache 2>&1 | tail -5
  success "Docker build passed"
else
  dryrun "docker compose build --no-cache"
fi

header "STEP 3 — Backend validation"

PYTHON_ERRORS=0
while IFS= read -r -d '' pyfile; do
  python3 -m py_compile "$pyfile" 2>/dev/null || {
    error "Syntax error: $pyfile"
    PYTHON_ERRORS=$((PYTHON_ERRORS + 1))
  }
done < <(find backend/ -name "*.py" -print0)
[[ $PYTHON_ERRORS -eq 0 ]] || die "$PYTHON_ERRORS Python file(s) with syntax errors"
success "Python syntax OK ($(find backend/ -name '*.py' | wc -l) files)"

[[ -s backend/requirements.txt ]] || die "backend/requirements.txt is empty"
success "requirements.txt OK ($(grep -c '==' backend/requirements.txt || echo 0) pinned deps)"

REQUIRED_BACKEND=(
  backend/main.py backend/api/routes.py backend/api/auth.py
  backend/api/websocket.py backend/api/alerts.py backend/api/history.py
  backend/api/systemd.py backend/api/camera.py backend/api/ros2.py backend/api/backup.py
)
MISSING=0
for f in "${REQUIRED_BACKEND[@]}"; do
  [[ -f "$f" ]] || { error "Missing: $f"; MISSING=$((MISSING+1)); }
done
[[ $MISSING -eq 0 ]] || die "$MISSING required backend file(s) missing"
success "All required backend files present"

header "STEP 4 — Frontend validation"

python3 -c "import json; json.load(open('$PACKAGE_JSON'))" 2>/dev/null || die "package.json is not valid JSON"
success "package.json is valid JSON"

REQUIRED_FRONTEND=(
  frontend/src/App.jsx frontend/src/main.jsx
  frontend/src/pages/Dashboard.jsx frontend/src/pages/CameraPage.jsx
  frontend/src/pages/SystemdPage.jsx frontend/src/pages/Ros2Page.jsx
  frontend/src/pages/BackupPage.jsx frontend/src/store/themeStore.js
  frontend/src/components/layout/Layout.jsx
)
MISSING_FE=0
for f in "${REQUIRED_FRONTEND[@]}"; do
  [[ -f "$f" ]] || { error "Missing: $f"; MISSING_FE=$((MISSING_FE+1)); }
done
[[ $MISSING_FE -eq 0 ]] || die "$MISSING_FE required frontend file(s) missing"
success "All required frontend files present"

grep -q 'data-theme="light"' frontend/src/index.css || warn "Light mode CSS not found in index.css"
success "CSS theme variables present"

header "STEP 5 — Infrastructure validation"

docker compose config --quiet 2>/dev/null || die "docker-compose.yml is invalid"
success "docker-compose.yml is valid"

grep -q "privileged: true" docker-compose.yml || die "docker-compose.yml missing 'privileged: true'"
success "privileged: true present"

[[ -f docker/nginx.conf ]] || die "docker/nginx.conf not found"
grep -q "ssl_certificate" docker/nginx.conf || die "nginx.conf missing SSL configuration"
success "nginx.conf SSL configuration OK"

[[ -f docker/entrypoint.sh ]] || die "docker/entrypoint.sh not found"
[[ -x docker/entrypoint.sh ]] || { warn "Fixing entrypoint.sh permissions"; chmod +x docker/entrypoint.sh; }
success "docker/entrypoint.sh OK"

[[ -f env.example ]] || die "env.example not found"
for var in AUTH_ENABLED AUTH_USERNAME AUTH_PASSWORD JETSON_IP METRICS_INTERVAL; do
  grep -q "^$var=" env.example || warn "env.example missing: $var"
done
success "env.example OK"

for entry in ".env" "data/" "node_modules/"; do
  grep -qF "$entry" .gitignore || warn ".gitignore missing entry: $entry"
done
success ".gitignore OK"

header "STEP 6 — Security checks"

git ls-files --error-unmatch .env >/dev/null 2>&1 && die ".env is tracked by git — run: git rm --cached .env"
success ".env is not tracked by git"

git ls-files --error-unmatch data/ >/dev/null 2>&1 && die "data/ is tracked by git — run: git rm -r --cached data/"
success "data/ is not tracked by git"

info "Scanning for hardcoded secrets..."
SECRET_FOUND=0
for pattern in "password\s*=\s*['\"][^'\"]{4,}" "secret\s*=\s*['\"][^'\"]{4,}" "api_key\s*=\s*['\"][^'\"]{4,}"; do
  hits=$(grep -rniE "$pattern" backend/ frontend/src/ --include="*.py" --include="*.js" --include="*.jsx" \
    2>/dev/null | grep -v "os\.getenv\|os\.environ\|import\|#\|//\|changeme\|example" || true)
  if [[ -n "$hits" ]]; then
    warn "Possible hardcoded secret:"; echo "$hits" | head -3
    SECRET_FOUND=$((SECRET_FOUND+1))
  fi
done
if [[ $SECRET_FOUND -eq 0 ]]; then
  success "No hardcoded secrets detected"
else
  warn "$SECRET_FOUND potential secret(s) found — review before publishing"
  read -rp "  Continue anyway? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || die "Fix secrets before releasing"
fi

header "STEP 7 — Version management"

CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('$PACKAGE_JSON'))['version'])")
info "Current version: ${BOLD}v$CURRENT_VERSION${RESET}"

IFS='.' read -r VER_MAJOR VER_MINOR VER_PATCH <<< "$CURRENT_VERSION"
NEXT_PATCH="$VER_MAJOR.$VER_MINOR.$((VER_PATCH + 1))"
NEXT_MINOR="$VER_MAJOR.$((VER_MINOR + 1)).0"
NEXT_MAJOR="$((VER_MAJOR + 1)).0.0"

if [[ -n "$BUMP_TYPE" ]]; then
  case $BUMP_TYPE in
    patch) NEW_VERSION="$NEXT_PATCH" ;;
    minor) NEW_VERSION="$NEXT_MINOR" ;;
    major) NEW_VERSION="$NEXT_MAJOR" ;;
  esac
  info "Auto bump ($BUMP_TYPE): v$CURRENT_VERSION → ${BOLD}v$NEW_VERSION${RESET}"
else
  echo ""
  echo "  Select version bump:"
  echo "    1) patch  $CURRENT_VERSION → $NEXT_PATCH  (bug fixes)"
  echo "    2) minor  $CURRENT_VERSION → $NEXT_MINOR  (new features)"
  echo "    3) major  $CURRENT_VERSION → $NEXT_MAJOR  (breaking changes)"
  echo "    4) custom"
  echo ""
  read -rp "  Choice [1/2/3/4]: " choice
  case $choice in
    1) NEW_VERSION="$NEXT_PATCH" ;;
    2) NEW_VERSION="$NEXT_MINOR" ;;
    3) NEW_VERSION="$NEXT_MAJOR" ;;
    4)
      read -rp "  Enter version (without 'v'): " NEW_VERSION
      [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Invalid semver: $NEW_VERSION"
      ;;
    *) die "Invalid choice" ;;
  esac
fi

git rev-parse "v$NEW_VERSION" >/dev/null 2>&1 && die "Tag v$NEW_VERSION already exists"
success "New version: ${BOLD}v$NEW_VERSION${RESET}"

header "STEP 8 — Changelog generation"

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  info "Commits since $LAST_TAG:"
  COMMITS=$(git log "$LAST_TAG"..HEAD --oneline --no-merges 2>/dev/null || echo "")
else
  info "No previous tag — collecting recent commits"
  COMMITS=$(git log --oneline --no-merges --max-count=30 2>/dev/null || echo "")
fi

declare -a FEAT_LIST=() FIX_LIST=() REFACTOR_LIST=() DOCS_LIST=() CHORE_LIST=() OTHER_LIST=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  msg="${line#* }"
  if   [[ "$msg" =~ ^feat ]];     then FEAT_LIST+=("$msg")
  elif [[ "$msg" =~ ^fix ]];      then FIX_LIST+=("$msg")
  elif [[ "$msg" =~ ^refactor ]]; then REFACTOR_LIST+=("$msg")
  elif [[ "$msg" =~ ^docs ]];     then DOCS_LIST+=("$msg")
  elif [[ "$msg" =~ ^chore ]];    then CHORE_LIST+=("$msg")
  else OTHER_LIST+=("$msg")
  fi
done <<< "$COMMITS"

RELEASE_DATE=$(date +"%Y-%m-%d")
CHANGELOG_ENTRY="## [v$NEW_VERSION] — $RELEASE_DATE\n\n"

append_section() {
  local title="$1"; shift
  local items=("$@")
  if [[ ${#items[@]} -gt 0 ]]; then
    CHANGELOG_ENTRY+="### $title\n"
    for item in "${items[@]}"; do CHANGELOG_ENTRY+="- $item\n"; done
    CHANGELOG_ENTRY+="\n"
  fi
}

append_section "✨ New Features"   "${FEAT_LIST[@]+"${FEAT_LIST[@]}"}"
append_section "🐛 Bug Fixes"      "${FIX_LIST[@]+"${FIX_LIST[@]}"}"
append_section "♻️  Refactoring"    "${REFACTOR_LIST[@]+"${REFACTOR_LIST[@]}"}"
append_section "📚 Documentation"  "${DOCS_LIST[@]+"${DOCS_LIST[@]}"}"
append_section "🔧 Chores"         "${CHORE_LIST[@]+"${CHORE_LIST[@]}"}"
append_section "📝 Other Changes"  "${OTHER_LIST[@]+"${OTHER_LIST[@]}"}"
[[ -z "$COMMITS" ]] && CHANGELOG_ENTRY+="- Release v$NEW_VERSION\n\n"

echo ""
echo -e "${DIM}── Changelog Preview ──────────────────────────────────${RESET}"
echo -e "$CHANGELOG_ENTRY"
echo -e "${DIM}───────────────────────────────────────────────────────${RESET}"

if ! [[ -n "$BUMP_TYPE" ]]; then
  read -rp "  Edit changelog manually? [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    TMPFILE=$(mktemp /tmp/changelog_XXXXXX.md)
    echo -e "$CHANGELOG_ENTRY" > "$TMPFILE"
    ${EDITOR:-nano} "$TMPFILE"
    CHANGELOG_ENTRY=$(cat "$TMPFILE")
    rm -f "$TMPFILE"
    success "Changelog updated"
  fi
fi

header "STEP 9 — Release summary"

echo ""
echo -e "  ${BOLD}Version:${RESET}   v$CURRENT_VERSION  →  ${GREEN}v$NEW_VERSION${RESET}"
echo -e "  ${BOLD}Branch:${RESET}    $CURRENT_BRANCH"
echo -e "  ${BOLD}Remote:${RESET}    $REMOTE_URL"
echo -e "  ${BOLD}Tag:${RESET}       v$NEW_VERSION"
echo -e "  ${BOLD}Date:${RESET}      $RELEASE_DATE"
echo -e "  ${BOLD}Dry run:${RESET}   $DRY_RUN"
echo ""

if ! $DRY_RUN; then
  read -rp "  Proceed with release? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || die "Release aborted"
fi

header "STEP 10 — Applying release"

info "Bumping version in package.json..."
if ! $DRY_RUN; then
  python3 -c "
import json
with open('$PACKAGE_JSON') as f: pkg = json.load(f)
pkg['version'] = '$NEW_VERSION'
with open('$PACKAGE_JSON', 'w') as f: json.dump(pkg, f, indent=2); f.write('\n')
"
  success "package.json → v$NEW_VERSION"
else
  dryrun "Bump package.json to $NEW_VERSION"
fi

info "Writing VERSION file..."
if ! $DRY_RUN; then
  echo "$NEW_VERSION" > "$VERSION_FILE"
  success "VERSION → $NEW_VERSION"
else
  dryrun "Write VERSION = $NEW_VERSION"
fi

info "Updating CHANGELOG.md..."
if ! $DRY_RUN; then
  HEADER="# Changelog\n\nAll notable changes to Jetson Dashboard are documented here.\nFormat based on [Keep a Changelog](https://keepachangelog.com).\n\n"
  if [[ -f "$CHANGELOG" ]]; then
    BODY=$(grep -v "^# Changelog\|^All notable\|^Format based" "$CHANGELOG" | sed '/^$/d' || true)
    printf "%b\n%b\n%s\n" "$HEADER" "$CHANGELOG_ENTRY" "$BODY" > "$CHANGELOG"
  else
    printf "%b\n%b" "$HEADER" "$CHANGELOG_ENTRY" > "$CHANGELOG"
  fi
  success "CHANGELOG.md updated"
else
  dryrun "Update CHANGELOG.md with v$NEW_VERSION entry"
fi

info "Creating release commit..."
if ! $DRY_RUN; then
  git add "$PACKAGE_JSON" "$VERSION_FILE" "$CHANGELOG"
  git commit -m "chore(release): v$NEW_VERSION"
  success "Release commit created"
else
  dryrun "git commit -m 'chore(release): v$NEW_VERSION'"
fi

info "Creating annotated tag v$NEW_VERSION..."
if ! $DRY_RUN; then
  git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
  success "Tag v$NEW_VERSION created"
else
  dryrun "git tag -a v$NEW_VERSION"
fi

info "Pushing to origin/$CURRENT_BRANCH..."
if ! $DRY_RUN; then
  git push origin "$CURRENT_BRANCH"
  git push origin "v$NEW_VERSION"
  success "Pushed commits and tag"
else
  dryrun "git push origin $CURRENT_BRANCH && git push origin v$NEW_VERSION"
fi

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║   RELEASE v$NEW_VERSION COMPLETE!           ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${RESET}"
echo ""

if ! $DRY_RUN; then
  if [[ "$REMOTE_URL" == *"github.com"* ]]; then
    REPO_PATH=$(echo "$REMOTE_URL" | sed 's|.*github\.com[:/]||;s|\.git$||')
    echo -e "  ${CYAN}Create GitHub release:${RESET}"
    echo -e "  → https://github.com/$REPO_PATH/releases/new?tag=v$NEW_VERSION"
  fi
  echo ""
  echo -e "  ${CYAN}Deploy to Jetson:${RESET}"
  echo -e "  → cd ~/jetson-dashboard && git pull && docker compose down && docker compose up -d --build"
fi

$DRY_RUN && echo -e "\n  ${YELLOW}DRY RUN — no changes were made${RESET}\n"
exit 0
