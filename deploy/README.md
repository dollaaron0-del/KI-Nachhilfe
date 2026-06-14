# Deploy-Artefakte

Referenzkopien der Server-Konfiguration, die **außerhalb** des Repos auf dem Host liegt.
Diese Dateien sind Doku/Backup – die laufende Konfig ist die auf dem Host, nicht diese hier.

## `nginx-nachhilfe.conf`

Gespiegelt von `/etc/nginx/sites-available/nachhilfe` (verlinkt in `sites-enabled/`).
nginx lauscht auf `:8080` und proxied alles an den Node-Server auf `127.0.0.1:3000`.

Enthält:
- **gzip** für die proxied Assets (`gzip_proxied any` + `gzip_types` inkl. `text/javascript`,
  sonst bleibt das große `app.js` unkomprimiert).
- **`X-Forwarded-For`/`X-Forwarded-Proto`**, damit Express' `trust proxy` die echte
  Client-IP fürs Per-Nutzer-Rate-Limit sieht.

Einspielen auf dem Host:

```sh
sudo cp deploy/nginx-nachhilfe.conf /etc/nginx/sites-available/nachhilfe
sudo nginx -t && sudo systemctl reload nginx
```

## Deploy-Erinnerung

- App läuft unter **pm2** als `nachhilfe`. Ein git commit deployt NICHT –
  nach Änderungen an `server/server.js`: `pm2 restart nachhilfe`.
- Bei Änderungen an `docs/app.js` oder `docs/style.css` die `?v=`-Nummer in
  `docs/index.html` hochzählen (Assets werden 30 Tage gecacht).
- DB-Indizes für die postgres-eigenen Tabellen: `scripts/perf-indexes.sql`
  (als Tabellen-Eigentümer einspielen, nicht als App-User).
