# Konzept: Stabile Themen-IDs + Verifikationsschicht (Lern-Tab)

Status: **umgesetzt** (v22.06.2026) · betrifft `docs/app.js` (Client) und `server/server.js` (+ `schema.sql`)

> **Umsetzungs-Notiz:** Teil A wurde mit einer leichten Architektur-Abweichung gebaut –
> statt `{id,name}`-Objekte in die Struktur einzubetten und eine riskante Migration zu
> fahren, hält der Client eine separate, fach-global geteilte Map `topicUids` (`normName → uid`)
> und löst Fortschritts-Schlüssel **beim Lesen** über `resolveKey()` auf. Alt-Zeilen
> (`name::diff`) werden dadurch nie destruktiv umgeschrieben → kein Migrations-Teilabbruch
> möglich (#6 entfällt strukturell). Teil B ist vollständig (`evalExpr` Shunting-Yard ohne
> `eval`). Die im Abschnitt „Tests" geforderte Harness existiert jetzt: `scripts/test-pure.js`
> (`npm test`).

Dieses Dokument beschreibt zwei zusammenhängende Umbauten am Lern-Tab:

1. **Stabile Themen-IDs** – Fortschritt hängt nicht mehr am Themen-**Namen**,
   sondern an einer einmal vergebenen ID. Behebt: Drift nach Re-Scan/Umbenennen,
   kaputte Wiederholungs-Termine, Cache-Misses, fehlendes Merge.
2. **Verifikationsschicht für Rechenaufgaben** – die Korrektheit der *Zahl* wird
   deterministisch geprüft, nicht vom selben LLM, das Aufgabe und Lösung erfand.

---

## Teil A — Stabile Themen-IDs

### A.1 Ist-Zustand (verifiziert)

**Server**
- `scanned_topics(subject_id PK, topics JSONB, structure JSONB, updated_at)`
  – **eine Zeile pro Fach, kein `user_id`** → Themen sind fach-global geteilt.
  – `topics` = flaches String-Array. `structure` = `{kapitel:[{titel, themen:[string]}]}`.
- `learned_topics(subject_id, user_id, topic TEXT, learned_at, PK(subject_id,user_id,topic))`
  – `topic` ist der String `"Name::diff"`. **Pro User.**

**Client (localforage)**
- `st_<id>` scannedTopics · `ms_<id>` moduleStructure
- `lt_<id>` learnedTopics (`["Name::diff", …]`)
- `ltmeta_<id>` topicMeta (`{"Name::diff": {ts, attempts}}`)
- `lernenCacheKey(name)` Erklärung/Aufgabe je Themen-**Name**

→ Themen-Identität = der Anzeige-String, an *jeder* Stelle. Das ist die Wurzel
aller in der Analyse genannten Schwächen #1, #2, #6 (teilw.), #7-ReScan.

### A.2 Zielmodell

Ein Thema bekommt eine **`tid`** (stable topic id), einmalig vergeben und in der
**geteilten `structure`** persistiert. Der Name wird zu reiner Anzeige.

Themen-Eintrag wird vom String zum Objekt:

```jsonc
// vorher:  "Lichtreaktion"
// nachher: { "id": "t_9f3a1c2b", "name": "Lichtreaktion" }
```

`structure.kapitel[].themen[]` und die flache `topics[]` enthalten künftig Objekte.

Fortschritt wird über `tid::diff` verschlüsselt statt `name::diff`:
- `learned_topics.topic` = `"t_9f3a1c2b::einsteiger"`
- `topicMeta` Key = `"t_9f3a1c2b::einsteiger"`  ← **behebt #2** (Review-Termine)
- `lernenCacheKey(tid)` statt `(name)`

### A.3 Wer vergibt die ID? (kritische Entscheidung)

Weil `structure` **fach-global** ist, ist sie die natürliche Single Source of
Truth für IDs: **Wer scannt, schreibt die IDs in die geteilte Struktur; alle
anderen Clients lesen dieselben IDs.**

- ID-Form: `"t_" + randomHex(8)` (per `crypto.randomUUID()` gekürzt). **Nicht** aus
  dem Namen ableiten – sonst wäre man wieder namensgebunden.
- Erstvergabe passiert genau einmal (Upgrade-Pass, s. A.4) und wird **sofort in die
  Struktur zurückgeschrieben** (Server + lokal). Ab dann sind IDs stabil.
- Mehrgeräte-Race: Last-Writer-Wins auf der Struktur-Zeile (heutiges
  `ON CONFLICT DO UPDATE`). Lädt Gerät B die Struktur erst nach dem Schreiben von
  Gerät A, sieht es A's IDs. Schreiben beide gleichzeitig, gewinnt einer; die
  Reconcile-Logik (A.5) heilt die Differenz beim nächsten Laden. Akzeptabel.

### A.4 Upgrade- & Migrations-Pass (einmalig, idempotent)

Läuft in `openSubject()` direkt nach dem Laden von Struktur + learnedTopics,
gated durch Flag `idmigr_v1_<subject>` (localforage).

1. **IDs vergeben:** Jedes Themen-Objekt ohne `id` bekommt eine. String-Einträge
   werden zu `{id, name}` aufgewertet. Struktur **und** flache Liste.
2. **Struktur zurückschreiben** (Server `POST /structure`, lokal `ms_`).
3. **Namens-Map bauen:** `normTopic(name) → tid` aus der aufgewerteten Struktur.
   (Eindeutig, weil `dedupeStructure` Beinah-Dupletten schon entfernt → pro
   normalisiertem Namen genau eine tid.)
4. **learnedTopics migrieren:** für jeden Alt-Eintrag `name::diff`:
   `normTopic(name)` → tid nachschlagen.
   - Treffer → neuer Key `tid::diff`.
   - Kein Treffer → **Orphan-Bucket** `lt_orphan_<id>` (nach `normName::diff`),
     nicht wegwerfen – kann später wieder andocken oder angezeigt werden.
5. **topicMeta** analog migrieren.
6. **Server aufräumen:** neue `tid::diff`-Zeilen `POST`en, **dann** alte
   `name::diff`-Zeilen `DELETE`n – aber erst nachdem der POST bestätigt ist
   (await, nicht fire-and-forget). Schlägt etwas fehl → Flag NICHT setzen, beim
   nächsten Laden erneut versuchen (idempotent dank `ON CONFLICT DO NOTHING`).
7. **Flag setzen.**

**Übergangs-Kompatibilität:** Die Lese-Helfer (`learnedKeySet`) suchen zuerst
tid-Keys, fallen sonst auf die normName-Map zurück. So funktioniert ein noch nicht
migriertes Gerät weiter, und nichts geht verloren, falls die Migration mittendrin
abbricht.

### A.5 Re-Scan wird nicht-destruktiv (der eigentliche Gewinn)

Heute überschreibt `scanModuleStructure`/`scanTopics` die Struktur komplett → neue
Namen → Fortschritt driftet weg. Neu: **Reconcile gegen bestehende tids.**

Beim Re-Scan für jeden neuen Themen-Namen eine tid bestimmen (Matching-Leiter):

1. exakter Name → bestehende tid
2. `normTopic(name)`-Gleichheit → bestehende tid
3. *(später)* Ähnlichkeit (Token-Jaccard / Levenshtein über `normTopic` ≥ Schwelle)
   → Match vorschlagen
4. kein Match → **neue** tid (echtes neues Thema)

Themen, die vorher existierten und im neuen Scan **keinen** Match haben:
als `archived:true` in der Struktur behalten (aus dem aktiven Pfad raus, aber
learned-Rows bleiben erhalten). So kann ein vom Matcher verpasstes Umbenennen
nichts löschen.

Bonus-UX: Diff anzeigen – „3 neu · 2 entfernt · 18 unverändert" statt stiller
Überschreibung (behebt #7-ReScan).

### A.6 Betroffene Stellen im Client (konkret)

| Stelle | Änderung |
|---|---|
| `pathTopics()` (`app.js:4320`) | liefert `{id,name}`-Objekte; Anzeige nutzt `.name`, State nutzt `.id` |
| `learnedKey`/`learnedKeySet` (`4304`/`4311`) | tid-basiert (mit normName-Fallback) |
| `topicsDoneAtDiff` (`4327`) | über tids zählen |
| `loadLernpfad` Render (`4455`) | `esc(topic.name)`, State/Buttons via `topic.id` |
| `markTopicDone` (`5512`) | schreibt `tid::diff` |
| `topicReviewDue`/`topicMeta` (`4879`/`4893`) | Keys `tid::diff` → **#2 behoben** |
| `lernenCacheKey` | Argument tid statt name |
| `dedupeStructure`/`dedupeTopics` (`4273`/`4284`) | IDs erhalten/vergeben |
| `openSubject` (`1342`) | Upgrade+Migration aufrufen |
| `scanModuleStructure`/`scanTopics` (`5550`/`2913`) | Reconcile statt Overwrite |

Server: keine Schemaänderung nötig (`topic TEXT` nimmt `tid::diff` direkt auf).
Optional später `learned_topics.topic` → eigenes `tid`-Feld + `diff`-Feld
normalisieren; für v1 nicht erforderlich.

### A.7 Was das löst

- **#1** Identität namensunabhängig → Re-Scan/Umbenennen verliert nichts.
- **#2** Review-Termine kleben an tid → bleiben nach Umbenennen gültig.
- **#6** Migration `await`-et POSTs → echter, idempotenter Sync statt stillem Drift.
- **#7-ReScan** Reconcile + Diff statt destruktivem Overwrite.

---

## Teil B — Verifikationsschicht für Rechenaufgaben

### B.1 Problem (verifiziert)

`checkLernenSolution` (`app.js:5330`) bewertet komplett LLM-self-graded gegen eine
LLM-Musterlösung aus denselben Docs (`app.js:5372` EVAL_SYS). „Berechne jeden
Schritt selbst nach" (`5384`) verlangt vom LLM zuverlässige Arithmetik – schwach.
Der Konsistenz-Hack „score darf bei Re-Prüfung nicht sinken" (`5360`) **zementiert**
ein früheres Fehlurteil.

### B.2 Leitidee: Zuständigkeiten trennen

> Das LLM **extrahiert und erklärt**, der Code **vergleicht Zahlen**.

Der Verdikt „Zahl richtig/falsch" wird **deterministisch berechnet**, nicht vom
Modell geurteilt. Das LLM liefert nur noch qualitatives Feedback zum *Vorgehen*.

### B.3 Ablauf

1. **Rechenaufgabe erkennen.** Signal existiert: `data.werte` nicht leer bzw.
   `data.rechnung` vorhanden → strenger Pfad. Konzept-Themen (keine Ground Truth)
   bleiben beim LLM-Grading.

2. **Maschinenlesbare Musterlösung.** Bei Rechenaufgaben die Lösung als Struktur
   statt Fließtext anfordern:

   ```jsonc
   {
     "schritte": [{ "label": "Zinsen Jahr 1", "ausdruck": "500 * 0.08", "wert": 40 }],
     "endergebnis": { "wert": 540, "einheit": "€", "toleranz_rel": 0.01 }
   }
   ```

3. **Selbst nachrechnen (Ground-Truth-Härtung).** Ein **kleiner, sicherer
   Ausdrucks-Evaluator** (kein `eval`!) wertet `ausdruck` jeder Stufe aus und
   vergleicht mit `wert`. Weicht die Musterlösung intern ab → Lösung verwerfen /
   neu generieren, bevor sie als Maßstab dient. Fängt Rechen-Slips des Modells
   in der *Musterlösung selbst* ab.

4. **Schüler-Endergebnis extrahieren.** Das (Vision-/Text-)Modell gibt das vom
   Schüler behauptete Endergebnis als eigenes Feld zurück:
   `"schueler_endergebnis": { "wert": …, "einheit": … }`. Extraktion kann das LLM
   gut – das Urteil nicht.

5. **Deterministischer Vergleich.** Code vergleicht `schueler_endergebnis.wert`
   gegen `endergebnis.wert` mit relativer Toleranz + absolutem Boden. Daraus folgt
   `numerisch_korrekt: true/false` – **ohne** LLM-Urteil.

6. **Score-Zusammensetzung.**
   - `score = 2` nur wenn `numerisch_korrekt` **und** das LLM den Weg als
     schlüssig bewertet.
   - `numerisch_korrekt = false` → hartes `score ≤ 1`, egal was das LLM „findet".
   - LLM liefert nur noch `feedback`/`einschaetzung` zum *Weg*.

7. **Re-Check-Regel reparieren.** Die „score darf nicht sinken"-Klausel nur noch
   auf die *qualitative* Bewertung anwenden; das numerische Verdikt wird ohnehin
   jedes Mal frisch und deterministisch berechnet, kann also gefahrlos
   korrigieren.

### B.4 Der Ausdrucks-Evaluator (Baustein)

- Reine Funktion, unit-testbar, **ohne** `eval`/`Function`.
- Unterstützt: Zahlen, `+ - * / ^ ( )`, `%`, `sqrt exp ln log`, Konstanten.
- Normalisiert deutsche Eingaben: Dezimal-Komma → Punkt, Tausenderpunkte,
  Einheiten-Suffixe abtrennen (`540 €`, `1,5 kg`).
- Toleranz: `|a−b| ≤ max(toleranz_abs, toleranz_rel·|b|)`; Default rel. 1 %,
  pro Niveau verschärfbar (pruefungsnah strenger).
- Vorsicht bei Rundungs-/Zwischenschritt-Aufgaben → Toleranz aus der Musterlösung
  (`toleranz_rel`) mitführen.

### B.5 Optionale Härtung

- **Doppelte Generierung:** Musterlösung zweimal (oder mit Verifier-Prompt)
  erzeugen, nur trauen wenn die Endzahlen übereinstimmen – billiger
  Zuverlässigkeits-Boost für die Ground Truth.
- **Mehrere Endergebnisse / Teilaufgaben:** `endergebnis` als Array je Teilaufgabe;
  Vergleich pro Teil, Gesamt-`score` aus den Teil-Verdikten.

### B.6 Was das löst

- **#4** Falsche ✅/🔁 bei Rechenaufgaben verschwinden für den numerischen Teil;
  das Modell urteilt nicht mehr über seine eigene Arithmetik.
- Re-Check zementiert keine Fehlurteile mehr.
- Konzept-Themen bleiben unverändert LLM-bewertet (dort gibt es keine Ground Truth).

---

## Phasen / Rollout

- **Phase 0 (erledigt):** normTopic-Matching im Lese-Vergleich (v155).
- **Phase 1 — Stabile IDs (erledigt):** `topicUids`-Map (`normName → uid`) in der
  geteilten Struktur, `resolveKey()`-Auflösung beim Lesen (Legacy-`name::diff`-Keys als
  Fallback → reversibel), `reconcileTopicUids()` beim Re-Scan, `dedupeTopicUids()`-
  Selbstheilung. Kein `idmigr_v1`-Flag nötig, da nicht destruktiv migriert wird.
- **Phase 2 — Verifikation (erledigt):** Ausdrucks-Evaluator `evalExpr` + getrennte,
  deterministische Bewertung (`numEqual`) für Rechenaufgaben in `checkLernenSolution`.

## Tests (erledigt — `scripts/test-pure.js`, `npm test`)

Beide Bausteine sind als **reine Funktionen** isoliert getestet. Der Harness extrahiert
die Funktionen zur Laufzeit aus `docs/app.js` (kein Copy-Paste → driftsicher):
- `normTopic`-Matching-Leiter inkl. `topicId`/`resolveKey`/`reconcileTopicUids`/
  `dedupeTopicUids` (Erhalt von Fortschritt über Umbenennungen, #2/#6/#7).
- Ausdrucks-Evaluator `evalExpr`/`parseNum`/`numEqual` (Arithmetik, deutsche Zahlen,
  Toleranz, Einheiten).

## Offen / bewusst nicht umgesetzt (optional)

- **Re-Scan-Diff-UX** („3 neu · 2 entfernt · 18 unverändert", A.5 Bonus) – nicht gebaut;
  Fortschritt bleibt auch ohne Anzeige erhalten.
- **`archived:true`-Markierung** unmatchter Alt-Themen (A.5) – überflüssig, da die
  `topicUids`-Map ohnehin erhalten bleibt und die learned-Rows referenzierbar lässt.
- **B.5 Härtung** (Doppel-Generierung der Musterlösung, `endergebnis`-Array je Teilaufgabe).

## Risiken

- **normTopic-Kollision** (zwei echte Themen normalisieren gleich): durch
  `dedupeStructure` vor der ID-Vergabe praktisch ausgeschlossen; tids sind danach
  garantiert eindeutig.
- **Mehrgeräte-ID-Race:** Last-Writer-Wins + Reconcile, self-healing (A.3).
- **Migrations-Teilabbruch:** idempotent, Flag erst nach bestätigtem Server-Write.
- **Evaluator-Sicherheit:** eigener Parser statt `eval`; nur Whitelist-Operatoren.
