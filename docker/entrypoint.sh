#!/bin/sh
# Entrypoint nginx
# Created by: y2k — https://github.com/unixfool

SSL_DIR="/etc/nginx/ssl"
CERT="$SSL_DIR/jetson-dashboard.crt"
KEY="$SSL_DIR/jetson-dashboard.key"

mkdir -p "$SSL_DIR"

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "[SSL] Generating self-signed certificate..."
    HOST_IP="${JETSON_IP:-jetson-dashboard}"
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$KEY" \
        -out "$CERT" \
        -subj "/C=ES/ST=Andalusia/L=Sevilla/O=Jetson Dashboard/CN=$HOST_IP" \
        -addext "subjectAltName=IP:127.0.0.1,IP:${HOST_IP},DNS:localhost,DNS:jetson-dashboard" \
        2>/dev/null
    echo "[SSL] Certificate generated: $CERT"
    echo "[SSL] Valid for 10 years — SAN IP: $HOST_IP"
else
    echo "[SSL] Certificate already exists, skipping generation"
fi

echo "[SSL] Starting nginx with HTTPS on :8443 (HTTP redirect on :8080)"
exec nginx -g "daemon off;"
