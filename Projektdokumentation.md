# KI-Nachhilfelehrer – Projektdokumentation

*Ein detaillierter Überblick über Aufbau, Funktionen und die Gedanken dahinter.*

---

## Die Grundidee

Das Problem mit bestehenden KI-Tools ist, dass sie zu viel wissen. ChatGPT erklärt Themen auf Basis von allem, was im Internet steht – und das klingt erstmal gut, bis man merkt, dass der eigene Professor eine bestimmte Definition, einen bestimmten Lösungsweg oder eine bestimmte Notation verwendet, die von der „offiziellen" Variante abweicht. In der Klausur wird dann genau das bewertet, was der Professor in der Vorlesung gesagt hat – nicht das, was Wikipedia schreibt.

Die Idee war also: eine KI, die **ausschließlich** mit den eigenen Vorlesungsunterlagen arbeitet. Kein Allgemeinwissen, kein Internet – nur das, was ich selbst hochgeladen habe. Wenn etwas nicht in den Unterlagen steht, sagt die App das klar und fordert auf, das fehlende Dokument nachzureichen.

Das ist auch technisch nicht trivial: Es reicht nicht, der KI einfach ein paar Dokumente mitzuschicken. Es braucht eine Infrastruktur, die die richtigen Passagen findet, aufbereitet, und die KI dann mit dem richtigen Kontext versorgt – damit die Antworten sowohl inhaltlich korrekt als auch im Stil des Dozenten sind.

---

## Wie die App aufgebaut ist

Die App besteht aus drei Teilen, die zusammenarbeiten:

### 1. Frontend (Was man sieht)

Das Frontend ist eine klassische Webanwendung – HTML, CSS und JavaScript. Kein React, kein Vue, kein Framework. Der Grund: Frameworks bringen viel Komplexität mit, die für dieses Projekt nicht nötig ist. Mit Vanilla JavaScript hat man die volle Kontrolle, versteht genau was passiert, und die App bleibt schnell und schlank.

Das Interface ist für den Einsatz auf dem iPad optimiert: große Touch-Targets, wischbare Ansichten, keine Hover-Effekte, die auf Touchscreens nicht funktionieren. Die App ist außerdem als **Progressive Web App (PWA)** installierbar – das heißt, man kann sie zum Homescreen hinzufügen und sie sieht dann aus und verhält sich wie eine native App, ohne dass etwas aus dem App Store heruntergeladen werden muss.

Ein **Service Worker** sorgt dafür, dass die App auch offline funktioniert: einmal geladene Seiten sind gecacht und stehen auch ohne Internetverbindung zur Verfügung. Beim nächsten Online-Gang werden Änderungen automatisch synchronisiert.

### 2. Backend (Was im Hintergrund passiert)

Das Backend läuft auf einem eigenen Server (VPS bei Contabo, Ubuntu 24.04). Es ist in **Node.js** geschrieben und verwendet **Express** als Web-Framework.

Die Aufgaben des Backends:
- Anfragen von der App entgegennehmen und an die Claude-API weiterleiten
- Dokumente speichern und durchsuchbar machen
- Benutzer verwalten (Registrierung, Anmeldung, Rollen)
- API-Kosten tracken und bei Überschreitung des Tageslimits blockieren
- Den Telegram-Bot betreiben

Der Server läuft dauerhaft im Hintergrund über **PM2** – ein Prozessmanager, der den Server automatisch neustartet, falls er abstürzt, und Logs aufzeichnet. Davor sitzt **nginx** als Reverse Proxy: er nimmt alle Anfragen auf Port 8080 entgegen und leitet sie intern an den Node.js-Server auf Port 3000 weiter. Das hat Vorteile bei Sicherheit und Flexibilität (z. B. könnte man später mehrere Dienste hinter demselben nginx betreiben).

### 3. Datenbank (Wo alles gespeichert wird)

Alle Daten werden in einer **PostgreSQL 16**-Datenbank gespeichert:

- **Benutzer** – Benutzername, gehashtes Passwort, Freischaltungsstatus, Admin-Rolle
- **Fächer** – Name, Emoji, Farbe, individueller Prompt des Nutzers
- **Dokumente** – Inhalt der hochgeladenen PDFs und Textdateien pro Fach
- **Chatverlauf** – alle Nachrichten pro Fach
- **Quiz-Ergebnisse** – Punktestand, Thema, Datum
- **Tageskostentracking** – Verbrauch in Euro, API-Calls, 90%-Benachrichtigungs-Flag
- **Einstellungen** – dynamisches Tageslimit (veränderbar per App oder Telegram)

Passwörter werden nie im Klartext gespeichert, sondern mit **bcrypt** gehasht – einem speziell für Passwörter entwickelten Algorithmus, der absichtlich langsam ist, um Brute-Force-Angriffe zu erschweren.

---

## Authentifizierung & Nutzerverwaltung

### Wie Anmeldung funktioniert

Die Anmeldung läuft über **JWT (JSON Web Tokens)**. Nach dem Login bekommt der Browser einen signierten Token, der 30 Tage gültig ist. Bei jeder Anfrage an den Server wird dieser Token mitgeschickt und serverseitig geprüft – ohne dass der Server eine Session-Tabelle führen muss. Das ist zustandslos und gut skalierbar.

### Registrierung und Freischaltung

Neue Nutzer können sich nicht einfach selbst freischalten. Nach der Registrierung landen sie in einem „ausstehend"-Status und bekommen die Meldung, dass ihr Konto auf Bestätigung wartet. Der erste registrierte Account bekommt automatisch Admin-Rechte.

Der Admin (ich) bekommt sofort eine **Telegram-Nachricht** mit zwei Buttons: „✅ Freischalten" oder „❌ Ablehnen". Nach einem Tipp auf den Button wird das Konto aktiviert – und die App des Nutzers erkennt das innerhalb von maximal 10 Sekunden automatisch (die App prüft alle 10 Sekunden im Hintergrund, ob das Konto freigeschaltet wurde) und loggt ihn direkt ein, ohne dass er nochmal etwas tun muss.

### Admin-Dashboard

Der Admin sieht in der App ein zusätzliches Panel mit:
- Aktuellem API-Kostenverbrauch des Tages
- Tageslimit (einstellbar)
- Einer Fortschrittsleiste
- Benutzerverwaltung (alle Nutzer sehen, freischalten, Admin-Rechte vergeben, löschen)

---

## Das Herzstück: KI-Integration und Quellenregel

### Wie Anfragen an die KI funktionieren

Das Frontend schickt Nachrichten nicht direkt an die Claude-API – das würde den API-Schlüssel im Browser exponieren. Stattdessen geht jede Anfrage an den eigenen Server, der sie mit dem gespeicherten API-Schlüssel an Claude weiterleitet. Der Schlüssel ist nur auf dem Server in einer `.env`-Datei gespeichert – nie im Code, nie im Git-Repository.

### RAG – Retrieval-Augmented Generation

Das ist das technisch interessanteste Stück. Wenn der Nutzer eine Frage stellt, passiert im Hintergrund folgendes:

1. Der Text der Frage wird als Suchbegriff verwendet
2. PostgreSQL durchsucht alle Dokumente des Fachs mit einem Volltext-Index (`ts_vector` mit deutschen Sprachregeln)
3. Die relevantesten Passagen werden nach Relevanz gerankt und als Kontext zur Anfrage hinzugefügt
4. Claude beantwortet die Frage auf Basis genau dieser Passagen – nicht auf Basis von Allgemeinwissen

Falls die Volltextsuche keine Treffer findet (z. B. bei sehr kurzen oder fremdsprachigen Dokumenten), wird als Fallback der gesamte Dokumentinhalt mitgeschickt.

Der entscheidende Punkt: Im System-Prompt steht explizit, dass die KI **ausschließlich** die bereitgestellten Unterlagen als Quelle nutzen darf. Wenn eine Frage damit nicht beantwortet werden kann, muss die App das klar kommunizieren. Das war die härteste Prompt-Engineering-Aufgabe: Claude neigt dazu, hilfreich zu sein und aus dem Gedächtnis zu ergänzen – das aktiv zu verhindern erfordert eine sehr klare, explizite Anweisung.

### Prompt Caching

Claude bietet eine Funktion namens **Prompt Caching**: Wenn man denselben System-Prompt mehrfach schickt, kann der erste Teil gecacht werden und kostet bei Folge-Anfragen nur 10% des normalen Preises. Da der System-Prompt (mit Unterlagen, Lehrphilosophie, Formatierungsregeln) der mit Abstand längste Teil jeder Anfrage ist, reduziert das die API-Kosten erheblich – typischerweise um 50–70%.

### Ollama – kostenlose KI für Batch-Aufgaben

Nicht alles läuft über die kostenpflichtige Claude-API. Für bestimmte Aufgaben läuft auf demselben Server **Ollama** mit dem Modell **llama3.2:3b** – ein Open-Source-Sprachmodell, das lokal auf der Server-CPU ausgeführt wird und komplett kostenlos ist.

Ollama übernimmt die „schweren" Batch-Aufgaben, bei denen viel Text verarbeitet wird, aber keine hochwertige Erklärung nötig ist:

| Aufgabe | Modell |
|---|---|
| Zusammenfassung aus Unterlagen generieren | Ollama (llama3.2:3b) |
| Glossar – alle Fachbegriffe extrahieren | Ollama (llama3.2:3b) |
| Karteikarten aus Dokumenten generieren | Ollama (llama3.2:3b) |
| Automatische Karteikarten beim Dokumenten-Upload | Ollama (llama3.2:3b) |
| Chat-Erklärungen, Quiz, Klausuren | Claude Sonnet / Haiku |

Fällt Ollama mal aus (z. B. Neustart des Servers), greift das Backend automatisch auf Claude Haiku als Fallback zurück – der Nutzer merkt davon nichts.

Das Besondere daran: Wenn ein Dokument hochgeladen wird, generiert der Server im Hintergrund sofort automatisch 12 Karteikarten daraus – komplett kostenlos über Ollama, ohne dass der Nutzer etwas tun muss.

### Kostenmanagement

Die Claude-API kostet Geld pro Anfrage. Um den Verbrauch zu kontrollieren:
- Es gibt ein konfigurierbares **Tageslimit** (Standard: 1,00 €)
- Jede Anfrage wird mit einem geschätzten Preis getrackt
- Wenn das Limit erreicht ist, werden weitere Anfragen blockiert
- Bei 90% des Limits bekomme ich eine Telegram-Warnung mit Buttons zum sofortigen Erhöhen
- Einfachere Aufgaben (schnelle Quiz-Fragen) nutzen **Claude Haiku** statt **Claude Sonnet** – das ist etwa 10x günstiger bei kaum merklichem Qualitätsunterschied für einfache Aufgaben
- Batch-Aufgaben (Glossar, Zusammenfassung, Karteikarten) laufen komplett kostenlos über Ollama

---

## Die Lernfunktionen im Detail

### Chat-Tutor

Der Chat ist lernpsychologisch durchdacht. Die KI antwortet nicht einfach mit der Antwort, sondern strukturiert nach einem festen Schema:
1. Kernaussage in 1–2 Sätzen
2. Erklärung mit konkretem Beispiel
3. Den Hintergrund – warum funktioniert das so?
4. Optional: Eselsbrücke oder Verknüpfung zu anderen Themen

Das basiert auf Erkenntnissen aus der Kognitionspsychologie: Elaboration (neues Wissen mit bekanntem verknüpfen), Chunking (komplexe Themen aufteilen), und der Sokrates-Methode (durch Fragen zur Erkenntnis führen statt Antworten hinzuwerfen).

Der Chat-Verlauf wird pro Fach dauerhaft gespeichert und ist auf jedem Gerät verfügbar.

### Quiz-Modi

Es gibt drei verschiedene Quizmodi:

**Standard-Quiz:** Die KI generiert Fragen aus den Unterlagen mit je drei Antwortmöglichkeiten und einer Punkteskala (0–3 Punkte je nach Qualität der Antwort). Der Fehlerkatalog merkt sich, bei welchen Themen man öfter falsch liegt – und der Tutor kann gezielt dort ansetzen.

**Blitz-Quiz:** Schnelle Multiple-Choice-Fragen für zwischendurch. Hier kommt Claude Haiku zum Einsatz, weil Geschwindigkeit wichtiger ist als maximale Erklärtiefe.

**Klausur-Simulation:** Die KI erstellt eine vollständige Prüfung im Stil der Vorlesung – mit Aufgabenstellungen, Punkteverteilung und Musterlösung. Das ist bewusst auf die hochgeladenen Unterlagen beschränkt, damit der Stil und die Erwartungen des Dozenten widergespiegelt werden.

### Karteikarten

Karteikarten werden automatisch aus den Unterlagen generiert – Vorderseite: Begriff oder Frage, Rückseite: Definition oder Antwort aus dem Skript. Man kann sie manuell ergänzen, und der Lernfortschritt wird gespeichert.

### Rechnen mit Apple Pencil

Für mathematische oder schematische Aufgaben gibt es ein Zeichenfeld. Man löst die Aufgabe handschriftlich – entweder mit dem Apple Pencil oder dem Finger – und schickt ein Foto davon zur KI-Bewertung. Claude analysiert die Lösung Schritt für Schritt und gibt Feedback, wo der Denkfehler lag oder ob alles korrekt ist.

Dafür wird **Claude Vision** verwendet – ein multimodales Modell, das Bilder versteht.

### Schwächen-Analyse

Die App verfolgt alle Quiz-Ergebnisse und berechnet daraus, in welchen Themengebieten die Erfolgsquote unterdurchschnittlich ist. Diese Themen werden aktiv im Chat angezeigt, damit man nicht aus Gewohnheit immer das Gleiche übt und die Schwachstellen übersieht.

### Lernstreak

Jeden Tag, an dem die App genutzt wird, wächst der Streak. Das ist simpel, aber wirkungsvoll: ein kleiner Gamification-Mechanismus, der Kontinuität belohnt.

---

## Telegram-Integration

Der Telegram-Bot ist kein Nice-to-have, sondern ein zentrales Verwaltungswerkzeug. Die wichtigsten Aktionen lassen sich direkt vom Handy aus erledigen, ohne sich in die App einzuloggen:

| Aktion | Wie |
|---|---|
| Registrierungsanfragen | Automatische Nachricht mit ✅/❌-Buttons |
| Nutzer freischalten | `/approve benutzername` |
| Nutzer ablehnen | `/reject benutzername` |
| Alle Nutzer auflisten | `/users` |
| API-Verbrauch abfragen | `/status` |
| Tageslimit setzen | `/setlimit 2.00` |
| Limit bei 90%-Warnung erhöhen | Buttons +0,50€ / +1€ / +2€ / +5€ |

Der Bot läuft als Long-Polling-Prozess auf dem Server: alle 30 Sekunden fragt er die Telegram-API nach neuen Nachrichten oder Button-Drücken. Das ist ressourcenschonender als ein permanenter WebSocket und für diesen Anwendungsfall völlig ausreichend.

---

## Technische Herausforderungen

**Service Worker Cache-Invalidierung**
Geänderte JavaScript- und CSS-Dateien wurden vom Browser nicht neu geladen, weil der Service Worker eine alte Version im Cache hatte. Lösung: versionierte Dateinamen (`app.js?v=9`). Der Service Worker prüft beim Start seinen Cache-Namen – hat sich der Name geändert, wird alles neu geladen und der alte Cache gelöscht.

**CSS-Spezifitätsbug**
Der Login-Bildschirm legte sich hartnäckig über den Chat, obwohl er gar nicht aktiv sein sollte. Ursache: Die CSS-Regel `.auth-screen { display: flex }` und `.screen { display: none }` hatten exakt dieselbe Spezifität (je eine CSS-Klasse = 10 Punkte). Bei Gleichstand gewinnt die spätere Regel im Stylesheet – und `.auth-screen` stand weiter unten. Dadurch war der Login-Screen immer als `display: flex` gesetzt, egal ob aktiv oder nicht. Behoben durch Verschieben von `display: flex` ausschließlich in die `.auth-screen.active`-Regel.

**Prompt-Engineering für Quellentreue**
Claude ist von Haus aus darauf trainiert, hilfreich zu sein – und ergänzt gerne aus dem eigenen Wissen, auch wenn Unterlagen vorhanden sind. Es hat mehrere Iterationen gebraucht, den System-Prompt so zu formulieren, dass die KI konsequent bei den Unterlagen bleibt und nicht aus Hilfsbereitschaft anfängt, allgemeines Wissen einzumischen.

---

## Datenschutz & Sicherheit

- Der Server steht in Deutschland (Contabo)
- Passwörter werden mit bcrypt gehasht – nie im Klartext gespeichert
- JWT-Tokens laufen nach 30 Tagen automatisch ab
- Der Anthropic API-Schlüssel und der Telegram-Token sind ausschließlich in einer `.env`-Datei auf dem Server gespeichert – nie im Code, nie im Git-Repository
- Alle Nutzer-Uploads bleiben auf dem eigenen Server und werden nicht an Dritte weitergegeben (außer dem Text, der zur KI-Anfrage an die Claude-API geschickt wird)
- Rate Limiting: zu viele Anfragen in kurzer Zeit werden automatisch blockiert

---

## Entwicklungsprozess

Das Projekt wurde von Grund auf mit Unterstützung von **Claude Code** entwickelt – einem KI-gestützten Programmierwerkzeug.

**Zeitraum:** 13. Mai – 2. Juni 2026 (ca. 3 Wochen)  
**Entwicklungsschritte (Git Commits):** 64  
**Codezeilen:** ~5.500 (2.700 Frontend, 1.000 Backend, 1.200 CSS, 600 HTML)

Die Entwicklung verlief vollständig iterativ: Idee beschreiben → implementieren → auf dem iPad testen → Fehler finden → verbessern. Keine lange Planungsphase, kein Pflichtenheft – direkt ausprobieren und anpassen.

Die Phasen grob zusammengefasst:
1. **Woche 1:** Grundgerüst – Chat, Fächersystem, Quiz, Klausur
2. **Woche 1–2:** Backend, Datenbankanbindung, Dokumenten-Upload, RAG
3. **Woche 2:** Lernfunktionen – Karteikarten, Schwächen-Analyse, Apple-Pencil, Streak, Glossar
4. **Woche 2–3:** Nutzerverwaltung, Admin-Dashboard, Telegram-Bot
5. **Woche 3:** Stabilisierung, CSS-Bug-Fixes, Quellenbeschränkung, Freischalt-Polling

---

*Fragen gerne direkt stellen.*
