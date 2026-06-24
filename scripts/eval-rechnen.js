#!/usr/bin/env node
// Eval-Harness für RECHEN-KORREKTHEIT.
// ────────────────────────────────────────────────────────────────────────────
// Beantwortet die Frage "woher weiß ich, dass das Programm nicht halluziniert?"
// nicht mit Bauchgefühl, sondern mit einer Zahl: ein fester Satz Rechenaufgaben
// mit BEKANNTEM korrektem Endergebnis wird durch die echte Claude-API gejagt;
// das ausgegebene Endergebnis wird automatisch geprüft. Ergebnis: Trefferquote
// pro Modell. So lässt sich (a) belegen, dass das Haiku-Downgrade Rechnungen
// verschlechtert, und (b) jede künftige Version messen, BEVOR die Qualität im
// Alltag auffällt.
//
// Nutzung:
//   node scripts/eval-rechnen.js                 # Haiku vs. Sonnet, je 1 Lauf
//   node scripts/eval-rechnen.js --models haiku  # nur ein Modell
//   node scripts/eval-rechnen.js --runs 3        # Selbst-Konsistenz: 3 Läufe/Aufgabe
//
// Braucht ANTHROPIC_API_KEY (wird aus server/.env geladen). Kostet echte Tokens –
// bei 14 Aufgaben × 2 Modellen ein Bruchteil eines Cents.

const path = require('path');
// Dependencies (dotenv, SDK) liegen in server/node_modules, nicht im Repo-Root.
const SERVER = path.join(__dirname, '..', 'server');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const Anthropic = require(path.join(SERVER, 'node_modules', '@anthropic-ai', 'sdk'));

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY fehlt (server/.env).'); process.exit(1); }
const anthropic = new Anthropic({ apiKey: KEY });

const MODELS = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-8',
};

// ── Aufgaben mit bekanntem Endergebnis ──────────────────────────────────────
// Bewusst mehrschrittig (dort schwächelt das kleine Modell). `answer` ist der
// numerische Sollwert; `tol` die zulässige relative Abweichung.
const TASKS = [
  { id: 'linear',     q: 'Löse die Gleichung 3x + 7 = 1 nach x auf.', answer: -2 },
  { id: 'quadrat',    q: 'Löse x² − 5x + 6 = 0 und gib die GRÖSSERE Lösung an.', answer: 3 },
  { id: 'prozent',    q: 'Wie viel sind 18 % von 250?', answer: 45 },
  { id: 'netto',      q: 'Ein Bruttopreis beträgt 119 €. Der Mehrwertsteuersatz ist 19 %. Wie hoch ist der Nettopreis in Euro?', answer: 100 },
  { id: 'zinseszins', q: 'Ein Kapital von 1000 € wird mit 5 % p.a. über 3 Jahre verzinst (Zinseszins). Wie hoch ist das Endkapital in Euro?', answer: 1157.625, tol: 1e-4 },
  { id: 'ableitung',  q: 'Gegeben f(x) = x³. Berechne f′(2).', answer: 12 },
  { id: 'integral',   q: 'Berechne das bestimmte Integral von 3x² von 0 bis 2.', answer: 8 },
  { id: 'lgs',        q: 'Löse das Gleichungssystem x + y = 10 und x − y = 4. Gib den Wert von x an.', answer: 7 },
  { id: 'mittelwert', q: 'Berechne den arithmetischen Mittelwert der Zahlen 4, 8, 15, 16, 23, 42.', answer: 18 },
  { id: 'muenze',     q: 'Zwei faire Münzen werden geworfen. Wie groß ist die Wahrscheinlichkeit für genau einen Kopf? Gib einen Dezimalwert an.', answer: 0.5 },
  { id: 'pythagoras', q: 'Ein rechtwinkliges Dreieck hat Katheten der Länge 3 und 4. Wie lang ist die Hypotenuse?', answer: 5 },
  { id: 'dreisatz',   q: '3 gleiche Maschinen erledigen einen Auftrag in 12 Stunden. Wie lange brauchen 4 solche Maschinen (umgekehrt proportional)?', answer: 9 },
  { id: 'log',        q: 'Berechne log zur Basis 2 von 32.', answer: 5 },
  { id: 'bruch',      q: 'Berechne 2/3 + 1/6 als Dezimalzahl (auf 4 Nachkommastellen).', answer: 0.8333, tol: 5e-4 },
];

const SYS =
  'Du bist ein präziser Mathe-Korrektor. Löse die Aufgabe Schritt für Schritt und sorgfältig. ' +
  'Beende deine Antwort ZWINGEND mit einer eigenen letzten Zeile im Format:\n' +
  'ERGEBNIS: <reine Zahl>\n' +
  'Die Zahl ohne Einheit, ohne Tausenderpunkt, mit Punkt als Dezimaltrennzeichen.';

// Letzte "ERGEBNIS: <zahl>"-Zeile herausziehen; Fallback: letzte Zahl im Text.
function extractNumber(text) {
  const m = [...text.matchAll(/ERGEBNIS:\s*(-?\d[\d.,]*)/gi)].pop();
  let raw = m ? m[1] : null;
  if (!raw) {
    const nums = text.match(/-?\d[\d.,]*/g);
    raw = nums ? nums[nums.length - 1] : null;
  }
  if (raw == null) return NaN;
  raw = raw.trim();
  // Deutsches Format normalisieren: "1.157,625" → "1157.625"
  if (/,\d+$/.test(raw) && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(',', '.');
  return parseFloat(raw);
}

function isCorrect(got, task) {
  if (Number.isNaN(got)) return false;
  const tol = task.tol ?? 1e-3;
  const denom = Math.abs(task.answer) || 1;
  return Math.abs(got - task.answer) / denom <= tol;
}

async function solve(modelId, task) {
  const r = await anthropic.messages.create({
    model: modelId,
    max_tokens: 1200,
    system: SYS,
    messages: [{ role: 'user', content: task.q }],
  });
  const text = r.content?.[0]?.text || '';
  return extractNumber(text);
}

async function run() {
  const args = process.argv.slice(2);
  // Wert eines Flags lesen – nur wenn das Flag wirklich vorkommt UND ein Wert folgt.
  // (indexOf-Naiv: bei fehlendem --models lieferte +1 sonst args[0]="--runs" als Modell.)
  const flagVal = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
  };
  const modelArg = flagVal('--models', 'haiku,sonnet').split(',').map(s => s.trim());
  const runs = Math.max(1, parseInt(flagVal('--runs', '1'), 10) || 1);
  const chosen = modelArg.filter(m => MODELS[m]);
  if (!chosen.length) { console.error('Unbekanntes Modell. Erlaubt: ' + Object.keys(MODELS).join(', ')); process.exit(1); }

  console.log(`\n  Rechen-Eval · ${TASKS.length} Aufgaben · ${runs} Lauf/Aufgabe · Modelle: ${chosen.join(', ')}\n`);
  const score = Object.fromEntries(chosen.map(m => [m, 0]));
  const total = TASKS.length * runs;

  for (const task of TASKS) {
    const cells = [];
    for (const m of chosen) {
      let ok = 0; let lastGot = NaN;
      for (let i = 0; i < runs; i++) {
        try { lastGot = await solve(MODELS[m], task); } catch (e) { lastGot = NaN; }
        if (isCorrect(lastGot, task)) { ok++; score[m]++; }
      }
      const mark = ok === runs ? '✓' : ok === 0 ? '✗' : `${ok}/${runs}`;
      cells.push(`${m}: ${mark.padEnd(4)} (${Number.isNaN(lastGot) ? '—' : lastGot})`);
    }
    console.log(`  ${task.id.padEnd(11)} soll=${String(task.answer).padEnd(9)} | ${cells.join('   ')}`);
  }

  console.log('\n  ── Trefferquote ───────────────────────────');
  for (const m of chosen) {
    const pct = ((score[m] / total) * 100).toFixed(0);
    console.log(`  ${m.padEnd(8)} ${score[m]}/${total}  (${pct} %)`);
  }
  console.log('');
}

run().catch(e => { console.error(e); process.exit(1); });
