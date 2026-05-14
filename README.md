# KI-Nachhilfelehrer

Eine iPad-optimierte Web-App, die als persönlicher Nachhilfelehrer fungiert. Du lädst deine Vorlesungsfolien als PDF hoch und kannst Claude dann Fragen dazu stellen.

## Setup

### 1. Dependencies installieren

```bash
npm install
```

### 2. API-Key konfigurieren

```bash
cp .env.example .env
# Trage deinen Anthropic API Key in .env ein
```

API-Key bekommt man unter: [console.anthropic.com](https://console.anthropic.com)

### 3. Server starten

```bash
npm start
```

Die App läuft dann auf `http://localhost:3000`

## iPad-Nutzung

### Im lokalen WLAN

Starte den Server auf deinem Computer und öffne auf dem iPad:

```
http://<IP-deines-Computers>:3000
```

Die IP-Adresse findest du mit `ifconfig` (Mac/Linux) oder `ipconfig` (Windows).

### Als Home-Screen-App speichern

1. Öffne die App in Safari auf dem iPad
2. Tippe auf das Teilen-Symbol (Rechteck mit Pfeil)
3. Wähle "Zum Home-Bildschirm"

Jetzt verhält sich die App wie eine native App (Vollbild, kein Browser-UI).

## Funktionen

- PDF-Upload (bis 20 MB)
- Chat auf Deutsch mit Claude als Tutor
- Prompt Caching für die Folien (spart API-Kosten bei langen PDFs)
- Gesprächsverlauf pro Session
- Chat zurücksetzen
- Neue Folien laden

## Technischer Aufbau

- **Backend:** Node.js + Express
- **KI:** Claude claude-sonnet-4-6 via Anthropic SDK (mit Prompt Caching)
- **PDF:** pdf-parse für Textextraktion
- **Frontend:** Vanilla HTML/CSS/JS, iPad-optimiert
