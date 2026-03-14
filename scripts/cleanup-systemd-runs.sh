#!/bin/bash
# =============================================================================
#  Jetson Dashboard — Systemd Transient Units Cleanup
#  Created by: y2k — https://github.com/unixfool
#
#  Cleans up failed run-uXXXX transient units that may accumulate in systemd.
#  These are generated when the dashboard uses systemd-run to execute host
#  commands (service start/stop, hardware control, etc.).
#
#  This script only needs to be run once to clear existing units.
#  New units are cleaned automatically after each command.
#
#  Usage:
#    bash scripts/cleanup-systemd-runs.sh         # Clean failed run-u* units
#    bash scripts/cleanup-systemd-runs.sh --all   # Clean ALL failed units
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

CLEAN_ALL=false
[[ "${1:-}" == "--all" ]] && CLEAN_ALL=true

if ! command -v systemctl &>/dev/null; then
  echo -e "${RED}✘  systemctl not found — is this a systemd system?${NC}"
  exit 1
fi

echo ""
echo -e "${BOLD}Jetson Dashboard — Systemd Cleanup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TOTAL_FAILED=$(systemctl list-units --state=failed --no-legend 2>/dev/null | wc -l || echo 0)
RUN_FAILED=$(systemctl list-units --state=failed --no-legend 2>/dev/null | grep -c 'run-u' || echo 0)

echo -e "  Total failed units:     ${YELLOW}$TOTAL_FAILED${NC}"
echo -e "  Transient (run-u*):     ${YELLOW}$RUN_FAILED${NC}"
echo ""

if [[ "$TOTAL_FAILED" -eq 0 ]]; then
  echo -e "${GREEN}✔  No failed units — nothing to clean${NC}"
  echo ""
  exit 0
fi

COUNT=0
if [[ "$RUN_FAILED" -gt 0 ]]; then
  echo -e "  Cleaning transient run-u* units..."
  while IFS= read -r unit; do
    [[ -z "$unit" ]] && continue
    if systemctl reset-failed "$unit" 2>/dev/null; then
      COUNT=$((COUNT + 1))
    fi
  done < <(systemctl list-units --state=failed --no-legend 2>/dev/null | grep 'run-u' | awk '{print $1}')
  echo -e "  ${GREEN}✔  Cleaned $COUNT transient unit(s)${NC}"
fi

if $CLEAN_ALL; then
  echo ""
  echo -e "  ${YELLOW}--all flag set — resetting all failed units...${NC}"
  systemctl reset-failed 2>/dev/null && \
    echo -e "  ${GREEN}✔  All failed units reset${NC}" || \
    echo -e "  ${YELLOW}⚠  Could not reset all units (try with sudo)${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
REMAINING=$(systemctl list-units --state=failed --no-legend 2>/dev/null | wc -l || echo 0)
echo -e "  Failed units remaining: ${REMAINING}"
echo ""

if [[ "$REMAINING" -gt 0 && ! "$CLEAN_ALL" == true ]]; then
  echo -e "  ${CYAN}Tip:${NC} To reset all failed units at once, run:"
  echo "    sudo systemctl reset-failed"
  echo "  Or rerun with: bash scripts/cleanup-systemd-runs.sh --all"
  echo ""
fi
