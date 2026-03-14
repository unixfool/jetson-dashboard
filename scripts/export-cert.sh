#!/bin/bash
# =============================================================================
#  Jetson Dashboard — SSL Certificate Export
#  Created by: y2k — https://github.com/unixfool
#
#  Exports the self-signed SSL certificate so it can be installed
#  in a browser to remove the security warning on HTTPS access.
#
#  Usage: bash scripts/export-cert.sh
# =============================================================================

set -euo pipefail

CERT_SRC="./data/ssl/jetson-dashboard.crt"
CERT_DST="./jetson-dashboard.crt"
JETSON_IP=$(grep "^JETSON_IP=" .env 2>/dev/null | cut -d'=' -f2 || echo "192.168.1.138")
HTTPS_PORT=8443

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

line() { echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

if [[ ! -f "$CERT_SRC" ]]; then
  echo -e "${YELLOW}⚠  Certificate not found at $CERT_SRC${NC}"
  echo ""
  echo "  Start the dashboard first so the certificate is generated:"
  echo "    docker compose up -d"
  echo ""
  exit 1
fi

echo ""
echo -e "${GREEN}✔  Certificate found${NC}"
echo ""

if command -v openssl &>/dev/null; then
  EXPIRY=$(openssl x509 -in "$CERT_SRC" -noout -enddate 2>/dev/null | cut -d'=' -f2 || echo "unknown")
  echo -e "  ${BOLD}Expires:${NC} $EXPIRY"
  echo ""
fi

line
echo -e "  ${BOLD}CHROME / EDGE${NC}  (Windows)"
line
echo "  1. Copy jetson-dashboard.crt to your Windows PC"
echo "  2. Double-click the .crt file"
echo "  3. Install Certificate → Local Machine → Trusted Root Certification Authorities"
echo "  4. Restart Chrome/Edge"
echo ""

line
echo -e "  ${BOLD}CHROME / EDGE${NC}  (Linux)"
line
echo "  1. Chrome → Settings → Privacy and security → Security"
echo "  2. Manage certificates → Authorities → Import"
echo "  3. Select jetson-dashboard.crt"
echo "  4. Trust for identifying websites"
echo ""

line
echo -e "  ${BOLD}CHROME / EDGE${NC}  (macOS)"
line
echo "  1. Double-click jetson-dashboard.crt to open Keychain Access"
echo "  2. Find 'Jetson Dashboard' in System keychain"
echo "  3. Double-click → Trust → Always Trust"
echo ""

line
echo -e "  ${BOLD}FIREFOX${NC}  (all platforms)"
line
echo "  1. Firefox → about:preferences#privacy"
echo "  2. Certificates → View Certificates → Authorities → Import"
echo "  3. Select jetson-dashboard.crt"
echo "  4. Check: Trust this CA to identify websites"
echo ""

line
echo -e "  ${BOLD}SKIP CERTIFICATE${NC}  (quick access without installing)"
line
echo "  In the browser warning page:"
echo "    Chrome/Edge → Advanced → Proceed to $JETSON_IP (unsafe)"
echo "    Firefox     → Advanced → Accept the Risk and Continue"
echo ""

line
echo -e "  ${BOLD}ACCESS URLS${NC}"
line
echo "  Local network:  https://$JETSON_IP:$HTTPS_PORT"
echo "  Internet:       https://<YOUR_PUBLIC_IP>:$HTTPS_PORT"
echo "  (Forward TCP port $HTTPS_PORT on your router → $JETSON_IP:$HTTPS_PORT)"
echo ""

if cp "$CERT_SRC" "$CERT_DST" 2>/dev/null; then
  echo -e "${GREEN}✔  Certificate exported to:${NC} $(pwd)/$CERT_DST"
  echo -e "   ${CYAN}Copy this file to your PC to install it.${NC}"
else
  echo -e "${YELLOW}⚠  Could not copy certificate to current directory${NC}"
  echo "   Use the original at: $CERT_SRC"
fi
echo ""
