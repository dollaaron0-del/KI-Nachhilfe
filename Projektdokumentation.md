# KI-Nachhilfelehrer – Projektdokumentation

**Erstellt:** Juni 2026  
**Autor:** Aaron  
**Projektart:** Eigenentwicklung – persönliche Lern-App mit KI-Integration

---

## 1. Was ist der KI-Nachhilfelehrer?

Der KI-Nachhilfelehrer ist eine selbst entwickelte Webanwendung, die als persönlicher digitaler Tutor dient. Die App kann auf dem Smartphone oder iPad wie eine native App installiert werden (Progressive Web App) und steht jederzeit offline zur Verfügung.

**Kernidee:** Statt allgemeines Wissen aus dem Internet zu nutzen, arbeitet der KI-Tutor *ausschließlich* mit den eigenen Vorlesungsunterlagen und Skripten. Das bedeutet: Erklärungen, Definitionen und Beispiele entsprechen genau der Sprache und dem Stil des Dozenten – so wie es in Prüfungen erwartet wird. Wenn eine Frage nicht aus den hochgeladenen Unterlagen beantwortet werden kann, weist die App explizit darauf hin, dass das entsprechende Dokument fehlt.

---

## 2. Funktionsumfang

### 2.1 Fächerverwaltung
- Beliebig viele Fächer anlegen, jeweils mit eigenem Emoji und Farbe
- Pro Fach: eigener Chat-Verlauf, Karteikarten, Quiz-Statistiken und Dokumente
- Persönlicher Prompt je Fach (z. B. „Erkläre alles auf Abiturniveau" oder „Fokus auf Klausuraufgaben")

### 2.2 Dokument-Upload & Wissensbasis
- PDFs und Textdateien hochladen
- Intelligente Suche (RAG – Retrieval-Augmented Generation): relevante Textpassagen werden automatisch zum richtigen Kontext zusammengestellt
- Die KI antwortet ausschließlich auf Basis dieser Unterlagen

### 2.3 KI-Chat-Tutor
- Gesprächsbasiertes Lernen mit dem Assistenten
- Lernpsychologisch aufgebaute Antwortstruktur:
  - Kernaussage → Erklärung mit Beispiel → Hintergrund/Warum → Eselsbrücke
- Sokrates-Methode: Der Tutor führt durch gezielte Fragen zur Erkenntnis
- Automatische Diagramme (Flussdiagramme, Mindmaps) bei komplexen Strukturen
- Mathematische Formeln in LaTeX-Notation (sauber gerendert)
- Handschriftliche Rechenaufgaben per Apple Pencil fotografieren → KI korrigiert

### 2.4 Quiz & Prüfungsvorbereitung
- Automatisch generierte Quizfragen aus den Unterlagen
- Blitz-Quiz: schnelle Multiple-Choice-Fragen
- Klausur-Simulation: vollständige Prüfungsblätter mit Musterlösungen
- Fehlerkatalog: häufig falsch beantwortete Themen werden gesondert aufgelistet
- Lernziel-Slider: Zielquote (z. B. 80 %) für adaptive Schwerpunktsetzung
- Schwächen-Analyse: automatische Erkennung schwacher Themenbereiche

### 2.5 Karteikarten
- Automatisch aus Unterlagen generierte Karteikarten
- Manuelle Ergänzung möglich
- Lernstatistik pro Karte

### 2.6 Rechnen-Tab (Apple Pencil)
- Handschriftliche Lösung auf Zeichenfeld
- Foto wird per KI-Vision analysiert und bewertet
- Schritt-für-Schritt-Feedback zur Lösung

### 2.7 Glossar & Cheat Sheet
- Automatisch erstelltes Glossar mit Fachbegriffen aus den Unterlagen
- Kompaktes Cheat Sheet: die wichtigsten Formeln und Definitionen auf einen Blick

### 2.8 Lernstreak & Statistiken
- Täglicher Lernstreak zur Motivationsförderung
- Quizpunktestand, Verlaufsgrafik (Sparkline)
- Themenbasierte Fortschrittsanzeige

### 2.9 Dark Mode & PWA
- Vollständig nutzbarer Dark Mode
- Installierbar als App auf iPad und iPhone (Add to Home Screen)
- Offline-Fähigkeit durch Service Worker

---

## 3. Technische Architektur

```
iPad / Browser
      │
      ▼
nginx (Port 8080, Reverse Proxy)
      │
      ▼
Node.js / Express (Port 3000)
      ├── PostgreSQL 16 (Nutzer, Fächer, Dokumente, Statistiken)
      └── Anthropic Claude API (claude-sonnet-4-6)
```

### 3.1 Frontend
| Komponente | Technologie |
|---|---|
| Sprache | Vanilla JavaScript (kein Framework) |
| Styling | CSS Custom Properties, responsive Layout |
| Formeln | KaTeX (LaTeX-Rendering) |
| Diagramme | Mermaid.js |
| Dokumente | PDF.js |
| Offline-Speicher | localforage |
| PWA | Service Worker + Web App Manifest |

### 3.2 Backend
| Komponente | Technologie |
|---|---|
| Server | Node.js 20 + Express |
| Datenbank | PostgreSQL 16 |
| Authentifizierung | JWT (30 Tage) + bcrypt |
| KI-Anbindung | Anthropic SDK (Claude Sonnet) |
| Prozessmanager | PM2 |
| Webserver | nginx |

### 3.3 Codeumfang
| Datei | Zeilen |
|---|---|
| app.js (Frontend-Logik) | 2.706 |
| server.js (Backend) | 1.000 |
| style.css | 1.171 |
| index.html | 644 |
| **Gesamt** | **5.521** |

---

## 4. Sicherheit & Nutzerverwaltung

### 4.1 Registrierung & Freischaltung
- Neue Nutzer müssen vom Admin freigeschaltet werden
- Der erste registrierte Account wird automatisch Admin
- Freischaltung per Telegram-Button direkt vom Smartphone aus
- Nutzer werden automatisch eingeloggt, sobald der Admin sie freigeschaltet hat (kein Reload nötig)

### 4.2 Admin-Dashboard
- Echtzeit-Anzeige der API-Kosten (heutiger Verbrauch vs. Tageslimit)
- Tageslimit dynamisch einstellbar (in der App oder per Telegram)
- Benutzerverwaltung: Freischalten, Admin-Rechte vergeben, Nutzer löschen

### 4.3 Telegram-Bot (Admin-Steuerung unterwegs)
Folgende Aktionen sind direkt per Telegram möglich:

| Befehl / Button | Funktion |
|---|---|
| `✅ Freischalten` / `❌ Ablehnen` | Registrierungsanfragen bestätigen |
| `/users` | Alle Nutzer mit Status auflisten |
| `/approve <name>` | Nutzer freischalten |
| `/reject <name>` | Nutzer ablehnen |
| `/status` | API-Verbrauch heute |
| `/setlimit 2.00` | Tageslimit setzen |
| `+0,50€ / +1€ / +2€ / +5€` | Limit bei 90%-Warnung erhöhen |

Bei 90 % des Tageslimits erscheint automatisch eine Warnung mit Buttons zum sofortigen Erhöhen.

### 4.4 Kostenkontrolle
- Tägliches API-Kostenlimit (Standard: 1,00 €/Tag)
- Anfragen werden blockiert, wenn das Limit erreicht ist
- Intelligentes Prompt-Caching reduziert die API-Kosten erheblich
- Günstigeres Modell (Haiku) für einfache Aufgaben, Sonnet für komplexe Erklärungen

---

## 5. Entstehung des Projekts

### 5.1 Motivation
Die Idee entstand aus einem konkreten Lernproblem: Verfügbare KI-Tools (ChatGPT, etc.) erklären Themen zwar gut, nutzen dabei aber allgemeines Wissen aus dem Internet. Das führt dazu, dass Definitionen und Erklärungsansätze von denen des Dozenten abweichen – was in Prüfungen zu Punktabzügen führen kann.

Die Lösung: ein eigener KI-Tutor, der **nur** mit den eigenen Vorlesungsunterlagen arbeitet und Antworten im Stil des Dozenten gibt.

### 5.2 Entwicklungsprozess
Das Projekt wurde vollständig mit Unterstützung von **Claude Code** (Anthropic) entwickelt – einem KI-gestützten Programmierwerkzeug, das direkt im Terminal läuft.

**Entwicklungszeitraum:** 13. Mai 2026 – 2. Juni 2026 (ca. 3 Wochen)  
**Commits (Entwicklungsschritte):** 64

Die Entwicklung verlief iterativ: Neue Funktionen wurden in Gesprächen mit dem KI-Assistenten beschrieben, direkt implementiert und sofort am echten Gerät getestet. Fehler wurden durch Beobachtung des Verhaltens auf dem iPad gefunden und behoben.

### 5.3 Entwicklungsphasen

**Phase 1 – Grundgerüst (Woche 1)**  
Erste Version als reine Browser-App ohne Backend. Chat-Tutor mit manuellem API-Schlüssel, einfaches Fächersystem, Quiz- und Klausurfunktion.

**Phase 2 – Backend & Server (Woche 1–2)**  
Umzug auf einen eigenen VPS (virtueller Server). Node.js-Backend mit PostgreSQL-Datenbank. Dokumente werden serverseitig gespeichert und sind geräteübergreifend verfügbar. RAG-Suche für relevante Dokumentpassagen. Kostenkontrolle durch tägliches API-Limit.

**Phase 3 – Lernfunktionen (Woche 2)**  
Erweiterung um Karteikarten, Glossar, Cheat Sheet, Lernstreak, Schwächen-Analyse, Apple-Pencil-Rechnen, Fehlerkatalog und Dark Mode.

**Phase 4 – Nutzerverwaltung & Telegram (Woche 2–3)**  
Registrierung mit Admin-Freischaltung, JWT-Authentifizierung, Admin-Dashboard mit Kostenübersicht, vollständige Telegram-Bot-Integration für Remote-Verwaltung.

**Phase 5 – Stabilisierung (Woche 3)**  
Behebung eines hartnäckigen CSS-Bugs (Auth-Screen war durch einen Spezifitätsfehler immer sichtbar), Verbesserung der Fehlerbehandlung, Quellen-Beschränkung der KI auf Unterlagen, automatisches Freischalten nach Telegram-Bestätigung.

### 5.4 Größte technische Herausforderungen

**Service Worker Cache-Invalidierung**  
Geänderte Dateien wurden vom Browser nicht neu geladen, weil der Service Worker alte Versionen im Cache hielt. Lösung: versionierte Dateinamen (`app.js?v=9`) und Cache-Namen, die bei Updates automatisch alle alten Caches löschen.

**CSS-Spezifitätsbug**  
Der Login-Bildschirm überlagerte den Chat-Bereich. Ursache: `.auth-screen { display: flex }` und `.screen { display: none }` hatten identische CSS-Spezifität (je eine Klasse), aber die spätere Regel gewann – der Login-Screen war dadurch dauerhaft als `display: flex` gesetzt. Behoben durch Verschieben von `display: flex` ausschließlich in `.auth-screen.active`.

**Prompt-Engineering für Quellentreue**  
Die KI nutzte zunächst allgemeines Wissen, obwohl Unterlagen vorhanden waren. Lösung: explizite Quellenregel im System-Prompt: „Beantworte Fragen ausschließlich auf Basis der bereitgestellten Unterlagen."

---

## 6. Datenschutz & Betrieb

- Der Server läuft auf einem eigenen VPS (Hetzner, Deutschland)
- Keine Datenübertragung an Dritte außer der Anthropic API für KI-Anfragen
- Passwörter werden mit bcrypt gehasht gespeichert (nie im Klartext)
- API-Schlüssel und Telegram-Token liegen ausschließlich in einer `.env`-Datei auf dem Server – nie im Code oder im Git-Repository
- JWT-Tokens laufen nach 30 Tagen automatisch ab

---

## 7. Fazit

Das Projekt zeigt, wie mit modernen KI-Werkzeugen in kurzer Zeit eine vollständige, produktiv nutzbare Anwendung entstehen kann. Besonders wertvoll ist dabei der Ansatz, die KI strikt auf eigene Lernmaterialien zu beschränken – das macht den Tutor zu einem echten Ergänzungswerkzeug für das Studium und nicht zu einem allgemeinen Wissens-Chatbot.

Die App wird aktiv für die eigene Prüfungsvorbereitung genutzt und laufend weiterentwickelt.

---

*Dieses Dokument wurde erstellt am 2. Juni 2026.*
