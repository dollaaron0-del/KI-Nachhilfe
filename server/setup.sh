#!/bin/bash
# Setup-Skript für den Nachhilfe-Server
# Auf dem Contabo-VPS ausführen: bash setup.sh

set -e

echo "=== Nachhilfe-Server Setup ==="

# 1. Abhängigkeiten installieren
echo "[1/5] npm install..."
npm install

# 2. .env erstellen falls nicht vorhanden
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  WICHTIG: Trage deinen Anthropic API-Key in .env ein:"
  echo "   nano .env"
  echo ""
fi

# 3. PostgreSQL-Datenbank anlegen
echo "[2/5] Datenbank einrichten..."
sudo -u postgres psql -c "CREATE USER nachhilfe_user WITH PASSWORD 'nachhilfe_pass_2024';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE nachhilfe_db OWNER nachhilfe_user;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE nachhilfe_db TO nachhilfe_user;" 2>/dev/null || true
sudo -u postgres psql nachhilfe_db -f schema.sql 2>/dev/null || true
echo "    Datenbank OK"

# 4. nginx konfigurieren
echo "[3/5] nginx konfigurieren..."
sudo tee /etc/nginx/sites-available/nachhilfe > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 25M;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/nachhilfe /etc/nginx/sites-enabled/nachhilfe
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo nginx -s reload 2>/dev/null || sudo nginx
echo "    nginx OK"

# 5. pm2 starten
echo "[4/5] pm2 starten..."
pm2 delete nachhilfe 2>/dev/null || true
pm2 start server.js --name nachhilfe
pm2 save
echo "    pm2 OK"

echo ""
echo "=== Setup abgeschlossen ==="
echo "Server läuft auf Port 3000, nginx leitet Port 80 weiter."
echo ""
echo "Nächster Schritt – API-Key eintragen:"
echo "  nano .env"
echo "  pm2 restart nachhilfe"
echo ""
echo "Status prüfen: curl http://localhost/api/health"
