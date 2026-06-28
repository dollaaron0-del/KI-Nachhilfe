#!/usr/bin/env node
// Eval-Harness für die QUALITÄT & DARSTELLUNG der LERN-ERKLÄRUNGEN.
// ────────────────────────────────────────────────────────────────────────────
// Schwesterskript zu eval-rechnen.js. Beantwortet nicht "rechnet das Modell
// richtig?", sondern die schwerer fassbare Frage: "Sind die Erklärungen im
// Lern-Tab gut – inhaltlich UND in der Darstellung von Text und Grafik?"
//
// Was hier getestet wird, spiegelt den echten Pfad in docs/app.js (loadTopicContent):
//   • derselbe System-Prompt-Kern (Quellenregel + Anschaulichkeits-/SVG-Block + JSON-Format)
//   • dieselbe tolerante Parse-Kette (repairJson / parseJsonResponse / salvage)
//   • dieselben Render-Regeln (DOMPurify-Whitelist für SVG, Mermaid-Extraktion)
// So misst die Eval nicht ein Idealbild, sondern das, was im Browser wirklich ankommt.
//
// Drei Prüfebenen pro Erklärung:
//   1. HARTE Automatik-Checks  – JSON valide & vollständig, nicht abgeschnitten,
//      Pflicht-Grafik vorhanden, SVG überlebt die Sanitization & zeichnet etwas,
//      Mermaid wohlgeformt, Rechen-Endergebnis korrekt. Ein Fail = Erklärung "kaputt".
//   2. WEICHE Darstellungs-Checks – LaTeX statt roher Formeln, Text bezieht sich
//      aufs Diagramm, Grafik früh platziert, keine doppelten Quotes in Mermaid.
//   3. LLM-JUDGE – ein stärkeres Modell benotet Korrektheit (ggü. den gelieferten
//      Unterlagen), Didaktik/Klarheit, Anschaulichkeit und Grafik-Qualität (0–5).
//
// Nutzung:
//   node scripts/eval-erklaerungen.js                    # Haiku (Prod-Modell), Judge=sonnet
//   node scripts/eval-erklaerungen.js --model sonnet     # Erklärungen mit Sonnet erzeugen
//   node scripts/eval-erklaerungen.js --judge opus       # strenger Judge
//   node scripts/eval-erklaerungen.js --only islm,parabel
//   node scripts/eval-erklaerungen.js --no-judge         # nur Automatik (kostet weniger)
//   node scripts/eval-erklaerungen.js --dump out.json    # volle Rohdaten + Erklärungen sichern
//
// Braucht ANTHROPIC_API_KEY (server/.env). Kostet echte Tokens – mit Judge grob
// ein paar Cent für den ganzen Lauf.

const fs = require('fs');
const path = require('path');
const SERVER = path.join(__dirname, '..', 'server');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const Anthropic = require(path.join(SERVER, 'node_modules', '@anthropic-ai', 'sdk'));

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY fehlt (server/.env).'); process.exit(1); }
const anthropic = new Anthropic({ apiKey: KEY });

const MODELS = {
  haiku:  'claude-haiku-4-5-20251001',   // Prod: Lern-Erklärungen laufen über /api/local = Haiku
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-8',
};

// ── Prompt-Bausteine: möglichst nah am echten docs/app.js ────────────────────
// Quellenregel-Kopf (gekürzt auf das, was die Erklärung steuert) – die Unterlagen
// werden pro Testfall eingesetzt, damit das Modell wie in Prod GEERDET ist und wir
// "Korrektheit ggü. Unterlagen" überhaupt prüfen können.
function systemPrompt(unterlagen) {
  return `Du bist ein erfahrener Nachhilfelehrer. Du verwendest gezielt moderne lernpsychologische Methoden.

WICHTIG – QUELLENREGEL:
Beantworte AUSSCHLIESSLICH auf Basis der bereitgestellten Unterlagen. Nutze KEIN Allgemeinwissen, das den Unterlagen widerspricht.
Halte dich bei Erklärungen an die Formulierungen und Definitionen aus den Unterlagen.

RECHNERISCHE WAHRHEIT (bei Aufgaben mit konkretem Ergebnis):
• Eine Rechnung hat genau EIN richtiges Endergebnis. Behaupte NIEMALS, zwei verschiedene Ergebnisse seien beide richtig.

MATHEMATIK: Für Formeln/Gleichungen LaTeX-Notation. Inline NUR mit $…$, Block mit $$…$$. Niemals \\( \\) oder \\[ \\].

--- UNTERLAGEN (einzige erlaubte Wissensquelle) ---
${unterlagen}
--- ENDE DER UNTERLAGEN ---

Antworte immer auf Deutsch.`;
}

// Der Anschaulichkeits-/Grafik-/JSON-Block – wortgleich aus loadTopicContent (v240).
// (Die \\n sind im Prod-Prompt ebenfalls literale Backslash-n; bewusst beibehalten.)
const TASK_BLOCK = (subjectClause) => `Behandle ${subjectClause} AUSSCHLIESSLICH auf Basis der bereitgestellten Unterlagen.

WICHTIG:
- Das Niveau beeinflusst ALLE Felder – Tiefe, Sprache, Komplexität.
- Für konzeptuelle/theoretische Themen (ohne viel Mathematik): schreibe ausführliche, lehrreiche Texte. Kein künstliches Kürzen – so lang wie nötig für echtes Verständnis.
- "vertiefung": Hintergründe, Zusammenhänge mit anderen Konzepten, häufige Missverständnisse. Leer lassen wenn kein Mehrwert.
- "rechnung": Nur befüllen wenn das Thema tatsächlich Rechenoperationen beinhaltet. Sonst leer lassen.
- "werte": Nur bei Rechenaufgaben – Array mit den wichtigsten Zahlenwerten aus der Aufgabe. Sonst [].
- "aufgabe": Übungsaufgabe passend zum Niveau. NIEMALS Lösungen im Aufgabentext!
- ANSCHAULICHKEIT: Gestalte die Erklärung lebendig und einprägsam statt trocken. Nutze – aber NUR wo es das Verständnis wirklich fördert – passendes Anschauungsmaterial direkt in den Feldern "was", "vertiefung", "beispiel" oder "rechnung". Werkzeugkasten:\\n  • Bildhafte Analogien, Vergleiche und Eselsbrücken im Text (kurz und treffend).\\n  • Markdown-Vergleichstabellen (| Spalte | Spalte |) für Gegenüberstellungen, Vor-/Nachteile, Klassifikationen.\\n  • Mermaid-Diagramme in \`\`\`mermaid … \`\`\`-Blöcken für Abläufe, Strukturen und Zusammenhänge: flowchart TD, mindmap, sequenceDiagram. Max. 8 Knoten, Labels KURZ und OHNE doppelte Anführungszeichen.\\n  • Inline-SVG für quantitative Skizzen/Koordinatengraphen (z.B. IS-LM, Angebot/Nachfrage, Funktionsgraphen, Phasen-/Kräftediagramme) – mit beschrifteten Achsen, benannten Kurven und (falls relevant) Verschiebungspfeilen samt neuem Gleichgewicht; kompakt (viewBox ~300×260, dünne Striche, lesbare Schrift).\\n  ABSOLUT WICHTIG für SVG UND Mermaid: ausschließlich EINFACHE Anführungszeichen verwenden (z.B. <svg viewBox='0 0 300 260'>), NIEMALS doppelte – doppelte zerstören das JSON. Lieber EIN treffendes Anschauungselement als mehrere überladene.\\n  PFLICHT-Grafik: Wenn das Thema ein klassisches grafisches Modell oder einen Koordinatengraphen besitzt (z.B. IS-LM, Angebot/Nachfrage, Marktgleichgewicht, Funktionsgraphen, Phasen-/Kräftediagramme, Indifferenzkurven), MUSST du das passende Inline-SVG einbauen und es NICHT weglassen. Platziere es möglichst FRÜH – direkt im Feld "was". Wenn ein Diagramm vorhanden ist, NUTZE es: der Begleittext soll sich darauf BEZIEHEN ("wie das Diagramm zeigt, …", "der Schnittpunkt A markiert …") statt in Worten nachzuerzählen. Nur rein begriffliche/textuelle Themen (ohne Standard-Diagramm) dürfen ganz ohne Grafik auskommen.

Antworte NUR als JSON-Objekt (kein Text davor/danach, keine Zeilenumbrüche im JSON außer \\n in Texten):
{"was":"Vollständige Erklärung des Konzepts","warum":"Bedeutung und Relevanz","vertiefung":"Vertiefung (leer wenn nicht hilfreich)","beispiel":"Konkretes Praxisbeispiel","rechnung":"Schritt-für-Schritt Rechenbeispiel (\\n zwischen Schritten). Leer wenn kein Rechnen nötig.","aufgabe":"Aufgabentext ohne Lösungen","werte":[]}`;

// ── Testfälle: Thema + knappe "Unterlagen" + Erwartung ───────────────────────
// category: 'graphic' (Pflicht-Grafik), 'concept' (Grafik optional), 'calc' (Rechnung mit bekanntem Ergebnis)
const CASES = [
  {
    id: 'islm', category: 'graphic', topic: 'das IS-LM-Modell',
    docs: `IS-LM-Modell: Stellt das gleichzeitige Gleichgewicht auf Güter- und Geldmarkt dar.
Achsen: Zinssatz i (vertikal) gegen Volkseinkommen Y (horizontal).
IS-Kurve: fällt (negativ geneigt) – höherer Zins senkt Investitionen und damit Y.
LM-Kurve: steigt (positiv geneigt) – höheres Y erhöht Geldnachfrage, treibt den Zins.
Gleichgewicht: Schnittpunkt von IS und LM bestimmt simultanes i* und Y*.
Expansive Fiskalpolitik verschiebt IS nach rechts → höheres Y und höherer Zins.`,
  },
  {
    id: 'markt', category: 'graphic', topic: 'das Marktgleichgewicht von Angebot und Nachfrage',
    docs: `Marktgleichgewicht: Achsen Preis P (vertikal) und Menge Q (horizontal).
Nachfragekurve fällt (negativ geneigt), Angebotskurve steigt (positiv geneigt).
Im Schnittpunkt herrscht das Gleichgewicht mit Gleichgewichtspreis P* und -menge Q*.
Über P* entsteht ein Angebotsüberschuss, unter P* ein Nachfrageüberschuss.
Eine Nachfragesteigerung verschiebt die Nachfragekurve nach rechts → höherer P* und Q*.`,
  },
  {
    id: 'parabel', category: 'graphic', topic: 'die quadratische Funktion f(x) = x² − 4x + 3',
    docs: `Quadratische Funktion f(x)=x²-4x+3. Graph ist eine nach oben geöffnete Parabel.
Nullstellen: x=1 und x=3 (aus (x-1)(x-3)). Scheitelpunkt bei x=2, f(2)=-1, also S(2|-1).
Schnittpunkt mit der y-Achse bei f(0)=3.`,
    expectMentions: ['(2', '-1', 'x=1', 'x=3'],
  },
  {
    id: 'opportunitaet', category: 'concept', topic: 'Opportunitätskosten',
    docs: `Opportunitätskosten sind der entgangene Nutzen der besten nicht gewählten Alternative.
Sie entstehen, weil Ressourcen knapp sind und jede Entscheidung Alternativen ausschließt.
Beispielprinzip: Wer Zeit für A nutzt, "bezahlt" mit dem, was er in dieser Zeit sonst (B) erreicht hätte.
Sie sind oft nicht-monetär und tauchen in keiner Rechnung explizit auf.`,
  },
  {
    id: 'gewaltenteilung', category: 'concept', topic: 'die Gewaltenteilung',
    docs: `Gewaltenteilung: Aufteilung staatlicher Macht auf drei Gewalten zur gegenseitigen Kontrolle.
Legislative (Gesetzgebung, Parlament), Exekutive (ausführende Gewalt, Regierung/Verwaltung),
Judikative (Rechtsprechung, Gerichte). Ziel: Machtkonzentration verhindern (checks and balances).`,
  },
  {
    id: 'zinseszins', category: 'calc', topic: 'Zinseszinsrechnung',
    docs: `Zinseszins: Endkapital K_n = K_0 · (1 + p)^n, mit K_0 Startkapital, p Zinssatz als Dezimalzahl, n Jahre.
Im Gegensatz zum einfachen Zins werden die Zinsen mitverzinst.
Aufgabenwerte für das Rechenbeispiel: K_0 = 1000 €, p = 5 % p.a., n = 3 Jahre.`,
    expectResult: 1157.625, tol: 1e-3,
  },
];

// ── Tolerantes JSON-Parsing – portiert aus docs/app.js (1:1-Verhalten) ───────
function repairJson(s) {
  s = s.replace(/(?<!\\)"\s*\+\s*"/g, '');
  let inStr = false, esc = false, out = '';
  for (const c of s) {
    if (esc)        { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true;  continue; }
    if (c === '"')  { out += c; inStr = !inStr; continue; }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out;
}
function salvageTruncatedJson(raw) {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const s = raw.slice(start);
  for (let end = s.length; end > 1; end--) {
    const frag = s.slice(0, end);
    let inStr = false, esc = false; const stack = [];
    for (const c of frag) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') stack.pop();
    }
    let cand = frag;
    if (inStr) cand += '"';
    cand = cand.replace(/[,:]\s*$/, '');
    for (let i = stack.length - 1; i >= 0; i--) cand += stack[i];
    try { return JSON.parse(cand); } catch {}
    try { return JSON.parse(repairJson(cand)); } catch {}
  }
  return null;
}
function parseJsonResponse(raw) {
  const tryParse = s => { try { return JSON.parse(s); } catch {} try { return JSON.parse(repairJson(s)); } catch {} return null; };
  const cb = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (cb) { const r = tryParse(cb[1]); if (r) return r; }
  const ob = raw.match(/\{[\s\S]*\}/);
  if (ob) { const r = tryParse(ob[0]); if (r) return r; }
  return salvageTruncatedJson(raw) || null;
}
function jsonWasTruncated(raw) {
  const ob = String(raw || '').match(/\{[\s\S]*\}/);
  if (!ob) return true;
  try { JSON.parse(ob[0]); return false; } catch {}
  try { JSON.parse(repairJson(ob[0])); return false; } catch {}
  return true;
}

// ── Render-/Sanitize-Wissen aus docs/app.js (PURIFY_CFG) ─────────────────────
const SVG_TAGS = new Set(['svg','path','g','use','defs','clipPath','line','circle','rect','polygon',
  'polyline','ellipse','text','tspan','marker','title','linearGradient','stop']);
const SVG_ATTRS = new Set(['viewBox','xmlns','xmlns:xlink','xlink:href','href','d','points','transform',
  'x','y','x1','y1','x2','y2','r','cx','cy','rx','ry','width','height',
  'clip-path','marker-end','marker-start','stroke','stroke-width','stroke-dasharray',
  'stroke-linecap','stroke-linejoin','fill','fill-rule','fill-opacity','stroke-opacity',
  'opacity','font-size','font-family','font-weight','text-anchor','dominant-baseline',
  'dx','dy','preserveAspectRatio','markerWidth','markerHeight','refX','refY','orient',
  'offset','stop-color','stop-opacity','gradientUnits']);
const GEOMETRY_TAGS = ['path','line','polyline','polygon','rect','circle','ellipse'];

function allText(d) {
  return ['was','warum','vertiefung','beispiel','rechnung'].map(k => d[k] || '').join('\n\n');
}
function extractSvgs(text) { return text.match(/<svg[\s\S]*?<\/svg>/gi) || []; }
function extractMermaid(text) { return [...text.matchAll(/```mermaid\s*([\s\S]*?)```/g)].map(m => m[1].trim()); }

// Prüft, ob ein SVG die Sanitization überlebt UND tatsächlich etwas Sinnvolles zeichnet.
function checkSvg(svg) {
  const issues = [];
  if (!/viewBox\s*=/.test(svg)) issues.push('kein viewBox');
  // Tags gegen die Whitelist – nicht erlaubte werden im Browser entfernt → Loch im Bild.
  const tags = [...svg.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9:]*)/g)].map(m => m[1]);
  const droppedTags = [...new Set(tags.filter(t => !SVG_TAGS.has(t)))];
  if (droppedTags.length) issues.push('Tags werden entfernt: ' + droppedTags.join(','));
  // Attribute gegen die Whitelist.
  const attrs = [...svg.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*['"]/g)].map(m => m[1]);
  const droppedAttrs = [...new Set(attrs.filter(a => !SVG_ATTRS.has(a)))];
  if (droppedAttrs.length) issues.push('Attribute werden entfernt: ' + droppedAttrs.join(','));
  // Zeichnet überhaupt Geometrie?
  if (!GEOMETRY_TAGS.some(t => new RegExp(`<${t}[\\s>]`, 'i').test(svg))) issues.push('keine Geometrie (line/path/…)');
  // Achsen-/Kurvenbeschriftung vorhanden?
  if (!/<text[\s>]/i.test(svg)) issues.push('keine Beschriftung (<text>)');
  return { ok: issues.length === 0, issues };
}
function checkMermaid(code) {
  const issues = [];
  if (!/^(flowchart|graph|mindmap|sequenceDiagram|classDiagram|stateDiagram)/m.test(code.split('\n')[0] || ''))
    issues.push('unbekannter Diagrammtyp');
  if (/"/.test(code)) issues.push('doppelte Anführungszeichen (Prompt verbietet)');
  // grobe Knotenzahl
  const nodes = new Set([...code.matchAll(/\b([A-Za-z]\w*)\s*[\[(\{]/g)].map(m => m[1]));
  if (nodes.size > 8) issues.push(`> 8 Knoten (${nodes.size})`);
  return { ok: issues.length === 0, issues };
}

// Alle Zahl-Token aus dem Rechen-Feld in numerische Werte übersetzen. Deutsches
// (1.157,63) UND englisches (1,157.63) Format sind mehrdeutig, sobald nur EIN
// Trennzeichen vorkommt – daher gibt jeder Token BEIDE plausiblen Lesarten zurück.
// Ein Token wie "1157,625" liefert {1157.625}, "1.157,63" liefert {1157.63}.
function tokenValues(token) {
  const t = token.replace(/\s/g, '');
  const vals = new Set();
  const push = v => { if (!Number.isNaN(v)) vals.add(v); };
  // Lesart A – deutsch: '.' = Tausender, ',' = Dezimal.
  push(parseFloat(t.replace(/\./g, '').replace(',', '.')));
  // Lesart B – englisch: ',' = Tausender, '.' = Dezimal.
  push(parseFloat(t.replace(/,/g, '')));
  return [...vals];
}
function allNumbers(text) {
  const toks = (text || '').match(/-?\d[\d.,]*\d|-?\d/g) || [];
  return toks.flatMap(tokenValues);
}
// Steht das erwartete Ergebnis (in irgendeiner Schreibweise) im Text? Robuster als
// "letzte Zahl == X": der Begleittext (Kontroll-Rechnung, "✓") verschiebt sonst die
// letzte Zahl. Ein Zwischenwert trifft das Endergebnis bei sinnvoller Toleranz praktisch nie.
function containsResult(text, expected, tol) {
  return allNumbers(text).some(n =>
    Math.abs(n - expected) / (Math.abs(expected) || 1) <= tol);
}

// ── Automatik-Bewertung einer Erklärung ──────────────────────────────────────
function audit(c, raw, data) {
  const checks = []; // {label, ok, soft, detail}
  const add = (label, ok, soft = false, detail = '') => checks.push({ label, ok, soft, detail });

  add('JSON parsebar', !!data);
  if (!data) return { checks, hardFail: 1 };

  add('nicht abgeschnitten (Token-Limit)', !jsonWasTruncated(raw));
  add('"was" gefüllt (≥120 Z.)', (data.was || '').length >= 120, false, `${(data.was||'').length} Z.`);
  add('"warum" gefüllt (≥40 Z.)', (data.warum || '').length >= 40);
  add('"beispiel" gefüllt', (data.beispiel || '').trim().length >= 30);
  add('"aufgabe" gefüllt', (data.aufgabe || '').trim().length >= 15);

  const text = allText(data);
  const svgs = extractSvgs(text);
  const mers = extractMermaid(text);
  const hasGraphic = svgs.length > 0 || mers.length > 0;

  if (c.category === 'graphic') {
    add('Pflicht-Grafik vorhanden', hasGraphic);
    // Früh platziert? Diagramm soll im Feld "was" stecken.
    if (hasGraphic) add('Grafik früh (in "was")', extractSvgs(data.was||'').length + extractMermaid(data.was||'').length > 0, true);
  }
  // SVG-Darstellungs-Checks (hart: muss zeichnen & Sanitization überleben)
  svgs.forEach((svg, i) => {
    const r = checkSvg(svg);
    add(`SVG#${i+1} rendert sauber`, r.ok, false, r.issues.join('; '));
  });
  mers.forEach((m, i) => {
    const r = checkMermaid(m);
    add(`Mermaid#${i+1} wohlgeformt`, r.ok, false, r.issues.join('; '));
  });

  // Bezieht sich der Text aufs Diagramm? (weich)
  if (hasGraphic) {
    const deixis = /(diagramm|schaubild|grafik|abbildung|skizze|kurve|schnittpunkt|wie (man )?(im|in der|unten|oben|hier)|der punkt|die achse)/i.test(text);
    add('Text bezieht sich auf Grafik', deixis, true);
  }

  // Mathematik als LaTeX statt roh? (weich) – nur wenn gerechnet wird.
  if ((data.rechnung || '').trim()) {
    const hasMathOps = /[=+\-×·*/^]|\d\s*[%€]/.test(data.rechnung);
    if (hasMathOps) add('Formeln als LaTeX ($…$)', /\$[^$]+\$/.test(data.rechnung), true);
    add('keine rohen \\( \\)/\\[ \\]-Delimiter', !/\\\(|\\\[/.test(text), true);
  }

  // Rechen-Korrektheit (hart) für calc-Fälle.
  if (c.category === 'calc' && c.expectResult != null) {
    const tol = c.tol ?? 1e-3;
    const ok = containsResult(data.rechnung, c.expectResult, tol);
    const seen = allNumbers(data.rechnung);
    add(`Rechen-Ergebnis = ${c.expectResult}`, ok, false,
        ok ? '' : `nicht gefunden (gelesen u.a.: ${seen.slice(-4).join(', ') || '—'})`);
    add('"werte" befüllt', Array.isArray(data.werte) && data.werte.length > 0, true);
  }

  // Faktentreue-Anker (weich): erwartete Schlüsselzahlen/-fakten genannt?
  if (c.expectMentions) {
    const miss = c.expectMentions.filter(s => !text.includes(s));
    add('Schlüsselfakten genannt', miss.length === 0, true, miss.length ? 'fehlt: ' + miss.join(', ') : '');
  }

  const hardFail = checks.filter(x => !x.ok && !x.soft).length;
  const softFail = checks.filter(x => !x.ok && x.soft).length;
  return { checks, hardFail, softFail };
}

// ── LLM-Judge: didaktische Qualität + Grafik-Sinn ────────────────────────────
const JUDGE_SYS = `Du bist ein strenger, fairer Fachgutachter für Lehrmaterial. Du bewertest EINE Erklärung,
die ein KI-Nachhilfelehrer erzeugt hat, ausschließlich gegen die mitgelieferten UNTERLAGEN.
Bewerte vier Achsen von 0 (unbrauchbar) bis 5 (exzellent):
- korrektheit: fachlich richtig UND deckungsgleich mit den Unterlagen (keine Erfindungen/Widersprüche).
- didaktik: klarer Aufbau, verständlich, erklärt das WARUM, gutes Beispiel.
- anschaulichkeit: lebendige Sprache, treffende Analogien/Tabellen, nichts Überladenes.
- grafik: Falls eine Grafik (SVG/Mermaid) vorhanden ist – ist sie inhaltlich SINNVOLL, korrekt beschriftet
  und passend zum Thema? Wird sie im Text genutzt? Falls KEINE Grafik nötig/vorhanden ist, gib null.
Antworte NUR als JSON: {"korrektheit":0-5,"didaktik":0-5,"anschaulichkeit":0-5,"grafik":0-5|null,"problem":"<knappster Hauptkritikpunkt, leer wenn top>"}`;

async function judge(modelId, c, data) {
  const payload = `THEMA: ${c.topic}

--- UNTERLAGEN ---
${c.docs}
--- ENDE UNTERLAGEN ---

ERKLÄRUNG (JSON-Felder):
was: ${data.was || ''}
warum: ${data.warum || ''}
vertiefung: ${data.vertiefung || ''}
beispiel: ${data.beispiel || ''}
rechnung: ${data.rechnung || ''}
aufgabe: ${data.aufgabe || ''}`;
  const r = await anthropic.messages.create({
    model: modelId, max_tokens: 600, system: JUDGE_SYS,
    messages: [{ role: 'user', content: payload }],
  });
  return parseJsonResponse(r.content?.[0]?.text || '') || null;
}

// ── Treiber ──────────────────────────────────────────────────────────────────
async function generate(modelId, c) {
  const r = await anthropic.messages.create({
    model: modelId,
    max_tokens: 12000,                          // wie in Prod (Platz für Erklärung + SVG)
    system: systemPrompt(c.docs),
    messages: [{ role: 'user', content: TASK_BLOCK(`das Thema "${c.topic}"`) }],
  });
  return r.content?.[0]?.text || '';
}

function flagVal(args, name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}

async function run() {
  const args = process.argv.slice(2);
  const genModel = MODELS[flagVal(args, '--model', 'haiku')] || MODELS.haiku;
  const judgeModel = MODELS[flagVal(args, '--judge', 'sonnet')] || MODELS.sonnet;
  const noJudge = args.includes('--no-judge');
  const only = flagVal(args, '--only', '');
  const dumpPath = flagVal(args, '--dump', '');
  const cases = only ? CASES.filter(c => only.split(',').map(s => s.trim()).includes(c.id)) : CASES;
  if (!cases.length) { console.error('Keine passenden Fälle (--only).'); process.exit(1); }

  console.log(`\n  Erklärungs-Eval · ${cases.length} Themen · erzeugt mit ${flagVal(args,'--model','haiku')}` +
              `${noJudge ? '' : ` · Judge ${flagVal(args,'--judge','sonnet')}`}\n`);

  const dump = [];
  let totHard = 0, totSoft = 0;
  const jAgg = { korrektheit: [], didaktik: [], anschaulichkeit: [], grafik: [] };

  for (const c of cases) {
    process.stdout.write(`  ▸ ${c.id.padEnd(15)} (${c.category}) … `);
    let raw, data, a, j = null;
    try {
      raw = await generate(genModel, c);
      data = parseJsonResponse(raw);
      a = audit(c, raw, data);
      if (!noJudge && data) {
        try { j = await judge(judgeModel, c, data); } catch (e) { j = { error: e.message }; }
      }
    } catch (e) {
      console.log('FEHLER: ' + e.message);
      dump.push({ id: c.id, error: e.message });
      totHard++;
      continue;
    }

    totHard += a.hardFail; totSoft += a.softFail;
    const verdict = a.hardFail === 0 ? (a.softFail === 0 ? '✓ sauber' : `✓ (${a.softFail} Hinweis${a.softFail>1?'e':''})`) : `✗ ${a.hardFail} HART`;
    let jStr = '';
    if (j && !j.error) {
      ['korrektheit','didaktik','anschaulichkeit','grafik'].forEach(k => { if (typeof j[k] === 'number') jAgg[k].push(j[k]); });
      jStr = `  | Judge K${j.korrektheit ?? '–'} D${j.didaktik ?? '–'} A${j.anschaulichkeit ?? '–'} G${j.grafik ?? '–'}`;
    }
    console.log(verdict + jStr);
    // Detail-Zeilen für alles, was nicht passt.
    a.checks.filter(x => !x.ok).forEach(x =>
      console.log(`        ${x.soft ? '·' : '✗'} ${x.label}${x.detail ? ' — ' + x.detail : ''}`));
    if (j && j.problem) console.log(`        ⌥ Judge: ${j.problem}`);
    if (j && j.error) console.log(`        ⌥ Judge-Fehler: ${j.error}`);

    dump.push({ id: c.id, category: c.category, raw, data, audit: a, judge: j });
  }

  console.log('\n  ── Zusammenfassung ─────────────────────────');
  console.log(`  Harte Fehler:   ${totHard}   (0 = alle Erklärungen technisch intakt & korrekt)`);
  console.log(`  Weiche Hinweise: ${totSoft}  (Darstellungs-/Stil-Verbesserungen)`);
  if (!noJudge) {
    const avg = arr => arr.length ? (arr.reduce((s,x)=>s+x,0)/arr.length).toFixed(2) : '–';
    console.log(`  Judge ⌀ /5:  Korrektheit ${avg(jAgg.korrektheit)}  ·  Didaktik ${avg(jAgg.didaktik)}  ·  Anschaulichkeit ${avg(jAgg.anschaulichkeit)}  ·  Grafik ${avg(jAgg.grafik)}`);
  }
  console.log('');

  if (dumpPath) {
    fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
    console.log(`  Rohdaten gesichert: ${dumpPath}\n`);
  }
  // Exit-Code: rot bei hartem Fehler – CI-tauglich.
  process.exit(totHard > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
