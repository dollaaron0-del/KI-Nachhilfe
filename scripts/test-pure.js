#!/usr/bin/env node
// Test-Harness für die reinen Funktionen aus docs/app.js (KONZEPT-Abschnitt "Tests").
// Deckt die zwei im KONZEPT genannten Bausteine ab:
//   1. Teil A — die normTopic-Matching-Leiter (Erhalt von Fortschritt über Umbenennungen).
//   2. Teil B — den Ausdrucks-Evaluator (Arithmetik, deutsche Zahlen, Toleranz).
//
// Die Funktionen werden ZUR LAUFZEIT aus docs/app.js extrahiert (kein Copy-Paste),
// damit der Test nicht von der Quelle driften kann. app.js bleibt einzige Wahrheit.
// Läuft ohne Abhängigkeiten:  node scripts/test-pure.js   (oder: npm test)

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'docs', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

// ── Extraktion ──────────────────────────────────────────────────────────────
// Top-Level-Funktionsdeklaration `function NAME(...) { ... }` per Klammer-Matching.
function extractFn(name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error(`Funktion ${name} nicht in app.js gefunden`);
  let i = src.indexOf('{', m.index);
  if (i < 0) throw new Error(`Kein Body für ${name}`);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error(`Body für ${name} nicht geschlossen`);
}
// Einzeilige `const NAME = ...;`-Deklaration (z. B. isTopicUid).
function extractConst(name) {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=[^\\n]*;'));
  if (!m) throw new Error(`const ${name} nicht in app.js gefunden`);
  return m[0];
}

const FN_DECLS = [
  'normTopic', 'jaccardTokens', 'parseNum', 'evalExpr', 'numEqual', 'numericCheck', 'applyNumericVerdict',
  'newTopicUid', 'topicId', 'topicKey', 'resolveKey',
  'dedupeTopicUids', 'reconcileTopicUids', 'ensureTopicUids', 'scanDiff',
  'md', 'renderTable',
];
const CONST_DECLS = ['isTopicUid', 'formatScanDiff'];

const assembled = [
  ...CONST_DECLS.map(extractConst),
  ...FN_DECLS.map(extractFn),
].join('\n\n');

// In einen Scope hängen, der die Modul-globalen Bindings (topicUids, self/crypto,
// pathTopics) bereitstellt — genau die, auf die die extrahierten Funktionen zugreifen.
const factory = new Function('self', 'katex', `
  let topicUids = {};
  let __path = [];
  function pathTopics() { return __path; }
  ${assembled}
  return {
    normTopic, jaccardTokens, parseNum, evalExpr, numEqual, numericCheck, applyNumericVerdict, isTopicUid,
    newTopicUid, topicId, topicKey, resolveKey,
    dedupeTopicUids, reconcileTopicUids, ensureTopicUids, scanDiff, formatScanDiff,
    md, renderTable,
    _setUids: m => { topicUids = m; },
    _getUids: () => topicUids,
    _setPath: p => { __path = p; },
  };
`);
// katex-Stub: markiert, dass eine Formel an KaTeX ging (display-Flag im Marker).
const katexStub = { renderToString: (latex, opts) => `⟦KTX d=${opts.displayMode ? 1 : 0}:${latex}⟧` };
const M = factory({ crypto: require('crypto').webcrypto }, katexStub);

// ── Mini-Test-Runner ─────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(Object.is(a, b) || a === b, `${msg}  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`); }
function approx(a, b, msg) { ok(Math.abs(a - b) < 1e-6, `${msg}  (erwartet ≈${b}, war ${a})`); }
function group(name, fn) { console.log('• ' + name); fn(); }

// ── Teil A: normTopic-Matching-Leiter ─────────────────────────────────────────
group('normTopic — Normalisierung', () => {
  eq(M.normTopic('Die Lichtreaktion'), 'lichtreaktion', 'führender Artikel entfernt');
  eq(M.normTopic('LICHTREAKTION!'), 'lichtreaktion', 'lowercase + Satzzeichen weg');
  eq(M.normTopic('  Lichtreaktion  '), 'lichtreaktion', 'getrimmt');
  eq(M.normTopic('Energieübertragung'), 'energieubertragung', 'Umlaut → ASCII');
  eq(M.normTopic('Lineare   Algebra'), 'lineare algebra', 'Mehrfach-Whitespace kollabiert');
  // Re-Scan-Stabilität: Schreibvarianten kollabieren auf denselben Schlüssel.
  eq(M.normTopic('Die Photosynthese'), M.normTopic('photosynthese'), 'Artikel-Variante == Basis');
});

group('jaccardTokens — Rename-Ähnlichkeit', () => {
  approx(M.jaccardTokens('lineare algebra grundlagen', 'lineare algebra'), 2 / 3, '2/3 Überlappung');
  eq(M.jaccardTokens('foo', 'bar'), 0, 'keine Überlappung → 0');
  eq(M.jaccardTokens('', 'x'), 0, 'leer → 0');
  eq(M.jaccardTokens('a b', 'a b'), 1, 'identisch → 1');
});

group('topicId / topicKey / resolveKey — Fallback & Auflösung', () => {
  M._setUids({});
  eq(M.topicId('Die Lichtreaktion'), 'lichtreaktion', 'ohne UID: Fallback auf normName (v155)');
  eq(M.topicKey('Die Lichtreaktion', 'mittel'), 'lichtreaktion::mittel', 'Key = normName::diff');

  M._setUids({ lichtreaktion: 't_abc123' });
  eq(M.topicId('Lichtreaktion!'), 't_abc123', 'mit UID: stabile ID');
  eq(M.topicKey('Lichtreaktion', 'schwer'), 't_abc123::schwer', 'Key = uid::diff');
  // Alt-Eintrag (Name::diff) UND ID-Eintrag lösen auf dieselbe ID auf → #2/#6:
  eq(M.resolveKey('Lichtreaktion::mittel'), 't_abc123::mittel', 'Legacy-Key → uid');
  eq(M.resolveKey('t_abc123::mittel'), 't_abc123::mittel', 'ID-Key bleibt');
  eq(M.resolveKey('Lichtreaktion'), 't_abc123::einsteiger', 'Key ohne diff → einsteiger');
});

group('reconcileTopicUids — Erhalt über Re-Scan (#7)', () => {
  // 1) exakt/normalisiert: gleicher (umbenannter mit Artikel) Name behält UID.
  M._setUids({ photosynthese: 't_p1' });
  M.reconcileTopicUids(['Photosynthese'], ['Die Photosynthese']);
  eq(M.topicId('Die Photosynthese'), 't_p1', 'Artikel-Rename behält UID (normalisiert-Treffer)');

  // 2) Ähnlichkeit ≥ 0.6: Teil-Rename matcht das alte Thema.
  M._setUids({ 'lineare algebra grundlagen': 't_la' });
  M.reconcileTopicUids(['Lineare Algebra Grundlagen'], ['Lineare Algebra']);
  eq(M.topicId('Lineare Algebra'), 't_la', 'ähnlicher Name (≥0.6) erbt UID');

  // 3) kein Match: echtes neues Thema bekommt frische, eigene UID.
  M._setUids({ photosynthese: 't_p1' });
  M.reconcileTopicUids(['Photosynthese'], ['Quantenmechanik']);
  const fresh = M.topicId('Quantenmechanik');
  ok(M.isTopicUid(fresh) && fresh !== 't_p1', 'fremdes Thema → neue, eigene UID');

  // 4) Mehrere neue Themen konkurrieren nicht um dieselbe alte UID (used-Set).
  M._setUids({ 'lineare algebra grundlagen': 't_la' });
  M.reconcileTopicUids(['Lineare Algebra Grundlagen'], ['Lineare Algebra', 'Lineare Algebra Vertiefung']);
  ok(M.topicId('Lineare Algebra') !== M.topicId('Lineare Algebra Vertiefung'), 'zwei neue Themen → verschiedene UIDs');

  // 5) Gesenkte Schwelle (0.4): Überlappung zwischen 0.4 und 0.6 erbt jetzt die UID.
  M._setUids({ 'alpha delta': 't_ad' });
  M.reconcileTopicUids(['Alpha Delta'], ['Alpha Beta Gamma Delta']);  // Jaccard 0.5, kein Teilstring
  eq(M.topicId('Alpha Beta Gamma Delta'), 't_ad', 'Jaccard 0.5 (≥0.4) erbt UID');

  // 6) Containment-Bonus: umformuliertes Thema mit wenig Token-Overlap, aber Teilstring.
  M._setUids({ regression: 't_reg' });
  M.reconcileTopicUids(['Regression'], ['Lineare Regression Analyse']);  // Jaccard 1/3 <0.4, aber enthält "regression"
  eq(M.topicId('Lineare Regression Analyse'), 't_reg', 'Containment erbt UID trotz Jaccard <0.4');
});

group('dedupeTopicUids — Selbstheilung kollabierter IDs', () => {
  M._setUids({ a: 't_x', b: 't_x' });          // zwei Namen, eine UID (Bug-Zustand)
  const changed = M.dedupeTopicUids();
  ok(changed, 'erkennt Kollision');
  ok(M._getUids().a !== M._getUids().b, 'Dubletten bekommen verschiedene UIDs');

  M._setUids({ a: 't_x', b: 't_y' });
  ok(!M.dedupeTopicUids(), 'saubere Map: keine Änderung');
});

group('newTopicUid — eindeutig & wohlgeformt', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) { const u = M.newTopicUid(); ok(M.isTopicUid(u), 'gültiges Format'); ids.add(u); }
  eq(ids.size, 1000, '1000 IDs alle eindeutig (kein Millisekunden-Kollaps)');
});

group('scanDiff — Re-Scan-Diff (#7)', () => {
  M._setUids({});
  // Erstscan: alles neu.
  eq(JSON.stringify(M.scanDiff([], ['A', 'B', 'C'])), JSON.stringify({ added: 3, removed: 0, unchanged: 0 }), 'Erstscan → alles neu');
  // Keine Änderung.
  eq(JSON.stringify(M.scanDiff(['A', 'B'], ['A', 'B'])), JSON.stringify({ added: 0, removed: 0, unchanged: 2 }), 'identisch → alles unverändert');
  // Eins dazu, eins weg (über normalisierte Namen, ohne UIDs).
  eq(JSON.stringify(M.scanDiff(['A', 'B'], ['A', 'C'])), JSON.stringify({ added: 1, removed: 1, unchanged: 1 }), 'A bleibt, B weg, C neu');
  // Normalisierung: Artikel-Variante zählt als unverändert.
  eq(JSON.stringify(M.scanDiff(['Photosynthese'], ['Die Photosynthese'])), JSON.stringify({ added: 0, removed: 0, unchanged: 1 }), 'Artikel-Rename → unverändert');

  // Rename mit erhaltener UID (Zustand nach reconcileTopicUids) → unverändert, nicht neu+weg.
  M._setUids({ 'lineare algebra grundlagen': 't_la', 'lineare algebra': 't_la' });
  eq(JSON.stringify(M.scanDiff(['Lineare Algebra Grundlagen'], ['Lineare Algebra'])), JSON.stringify({ added: 0, removed: 0, unchanged: 1 }), 'Rename mit gleicher UID → unverändert');
  M._setUids({});

  eq(M.formatScanDiff({ added: 3, removed: 2, unchanged: 18 }), '3 neu · 2 entfernt · 18 unverändert', 'Format-String');
});

// ── Teil B: Ausdrucks-Evaluator ───────────────────────────────────────────────
group('parseNum — deutsche Zahlen & Einheiten', () => {
  eq(M.parseNum(42), 42, 'Zahl bleibt Zahl');
  approx(M.parseNum('3,14'), 3.14, 'Dezimal-Komma');
  approx(M.parseNum('1.234,56'), 1234.56, 'Tausenderpunkt + Komma');
  approx(M.parseNum('540 €'), 540, 'Einheiten-Suffix abgetrennt');
  approx(M.parseNum('1.000.000'), 1000000, 'mehrere Tausenderpunkte');
  ok(Number.isNaN(M.parseNum('keine zahl')), 'kein Treffer → NaN');
  ok(Number.isNaN(M.parseNum(null)), 'null → NaN');
});

group('evalExpr — Arithmetik ohne eval', () => {
  approx(M.evalExpr('500 * 0.08'), 40, 'Multiplikation');
  approx(M.evalExpr('500 + 40'), 540, 'Addition');
  approx(M.evalExpr('2 + 3 * 4'), 14, 'Punkt vor Strich');
  approx(M.evalExpr('(2 + 3) * 4'), 20, 'Klammern');
  approx(M.evalExpr('2^10'), 1024, 'Potenz (^)');
  approx(M.evalExpr('2 hoch 8'), 256, '"hoch" → ^');
  approx(M.evalExpr('sqrt(144)'), 12, 'sqrt');
  approx(M.evalExpr('wurzel(16)'), 4, '"wurzel" → sqrt');
  approx(M.evalExpr('10 % 3'), 1, 'Modulo');
  approx(M.evalExpr('100 - 30 - 20'), 50, 'Links-Assoziativität Minus');
  approx(M.evalExpr('2 ^ 3 ^ 2'), 512, 'Potenz rechts-assoziativ');
  approx(M.evalExpr('6 · 7'), 42, 'Mal-Punkt ·');
  approx(M.evalExpr('84 ÷ 2'), 42, 'Geteilt ÷');
  // Deutsche Zahlen direkt im Ausdruck:
  approx(M.evalExpr('1.000,5 + 0,5'), 1001, 'Tausenderpunkt + Dezimal-Komma im Term');
  ok(Number.isNaN(M.evalExpr(null)), 'null → NaN');
  ok(Number.isNaN(M.evalExpr('+')), 'Müll → NaN');
});

group('numEqual — Toleranz', () => {
  ok(M.numEqual(540, 540.1, 0.01), '0,1 von 540 innerhalb 1%');
  ok(!M.numEqual(40, 44, 0.01), '44 ≠ 40 (10% > 1%)');
  ok(M.numEqual(0, 0.004), 'absoluter Boden (~0,005) fängt Null-Nähe');
  ok(!M.numEqual(100, 102, 0.01), '2 von 100 außerhalb 1%');
  ok(M.numEqual(100, 100.5, 0.01), '0,5 von 100 innerhalb 1%');
  ok(!M.numEqual(NaN, 5), 'NaN → false');
});

// ── Teil B (Integration): applyNumericVerdict — Score-Zusammensetzung (KONZEPT B.6) ──
// Die Verhaltensgarantie: das deterministische Zahl-Verdikt überstimmt das LLM-Urteil.
// ev wird mutiert (score/understood/feedback). diff steuert die Toleranz.
group('applyNumericVerdict — Zahl überstimmt LLM (#4)', () => {
  // Falsche Zahl trotz LLM-score=2 → Deckelung auf 1, understood=false, Notiz.
  let ev = { score: 2, understood: true, feedback: 'Sauberer Weg', endergebnis: 540, schueler_endergebnis: 500 };
  const note = M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'falsches Endergebnis deckelt score 2→1');
  eq(ev.understood, false, 'understood wird false');
  ok(/weicht ab/.test(note) && /weicht ab/.test(ev.feedback), 'Abweichungs-Notiz angehängt');
  ok(/Sauberer Weg/.test(ev.feedback), 'bestehendes Feedback bleibt erhalten');

  // Richtige Zahl → score unverändert, ✓-Notiz, understood bleibt.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, schueler_endergebnis: 540 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, 'korrektes Endergebnis lässt score=2');
  eq(ev.understood, true, 'understood bleibt true');
  ok(/✓/.test(ev.feedback), '✓-Notiz gesetzt');

  // endergebnis_rechnung (Ausdruck) ist alleinige Referenz, wenn keine endergebnis-Zahl da ist.
  ev = { score: 0, understood: false, feedback: '', endergebnis_rechnung: '500 * 1.08', schueler_endergebnis: 540 };
  M.applyNumericVerdict(ev, true, 'mittel');
  ok(/✓/.test(ev.feedback), 'Referenz aus nachgerechnetem Ausdruck (540) bei fehlender endergebnis-Zahl');

  // B.5 In-Band-Doppelcheck: Ausdruck (540) und endergebnis (999) widersprechen sich →
  // Ground Truth unsicher → KEIN Override, LLM-Urteil bleibt stehen.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 999, endergebnis_rechnung: '500 * 1.08', schueler_endergebnis: 540 };
  eq(M.applyNumericVerdict(ev, true, 'mittel'), '', 'widersprüchliche Referenz → keine Notiz/kein Verdikt');
  eq(ev.score, 2, 'widersprüchliche Referenz → score bleibt (LLM-Urteil)');
  // Stimmen Ausdruck und endergebnis überein, greift das Verdikt normal.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, endergebnis_rechnung: '500 * 1.08', schueler_endergebnis: 500 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'konsistente Referenz (540==540) + falsche Schülerzahl → Deckelung');

  // Falsche Zahl bei bereits niedrigem score → bleibt (kein Hochstufen), understood=false.
  ev = { score: 0, understood: false, feedback: '', endergebnis: 540, schueler_endergebnis: 1 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 0, 'score=0 wird nicht angehoben');
  eq(ev.understood, false, 'understood bleibt false');

  // Keine Rechenaufgabe → keine Mutation, leere Notiz (Konzept-Themen bleiben LLM-bewertet).
  ev = { score: 2, understood: true, feedback: 'gut', endergebnis: 540, schueler_endergebnis: 500 };
  eq(M.applyNumericVerdict(ev, false, 'mittel'), '', 'Nicht-Rechenaufgabe → keine Notiz');
  eq(ev.score, 2, 'Nicht-Rechenaufgabe: score unangetastet');

  // Schüler nennt keine Zahl → LLM-Urteil bleibt stehen (kein deterministisches Verdikt).
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, schueler_endergebnis: null };
  eq(M.applyNumericVerdict(ev, true, 'mittel'), '', 'kein Schüler-Endergebnis → keine Übersteuerung');
  eq(ev.score, 2, 'ohne Schülerzahl: score unangetastet');

  // Niveau-abhängige Toleranz: 1%-Abweichung besteht bei "mittel" (2%), scheitert bei "pruefungsnah" (0,5%).
  ev = { score: 2, understood: true, feedback: '', endergebnis: 100, schueler_endergebnis: 101 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, '1%-Abweichung bei "mittel" toleriert');
  ev = { score: 2, understood: true, feedback: '', endergebnis: 100, schueler_endergebnis: 101 };
  M.applyNumericVerdict(ev, true, 'pruefungsnah');
  eq(ev.score, 1, '1%-Abweichung bei "pruefungsnah" gedeckelt');

  // Re-Check-Stabilität: dasselbe falsche ev erneut geprüft bleibt ≤1 (deterministisch).
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, schueler_endergebnis: 500 };
  M.applyNumericVerdict(ev, true, 'mittel');
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'Re-Check zementiert kein Fehlurteil – bleibt 1');

  // Deutsche Schülerzahl mit Einheit wird korrekt geparst.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 1234.56, schueler_endergebnis: '1.234,56 €' };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, 'deutsche Zahl "1.234,56 €" == 1234.56');
});

group('numericCheck — Einzelvergleich + In-Band-Doppelcheck (B.5)', () => {
  eq(M.numericCheck('500*1.08', 540, 540, 0.02).verdict, 'ok', 'konsistent + richtig → ok');
  eq(M.numericCheck('500*1.08', 540, 500, 0.02).verdict, 'abweichung', 'konsistent + falsch → abweichung');
  eq(M.numericCheck('500*1.08', 999, 540, 0.02).verdict, null, 'Ausdruck≠endergebnis → null (unsicher)');
  eq(M.numericCheck('', 540, 540, 0.02).verdict, 'ok', 'nur endergebnis-Zahl als Referenz');
  eq(M.numericCheck('500*1.08', null, 540, 0.02).verdict, 'ok', 'nur Ausdruck als Referenz');
  eq(M.numericCheck('500*1.08', 540, null, 0.02).verdict, null, 'keine Schülerzahl → null');
  eq(M.numericCheck('', '', '', 0.02).verdict, null, 'gar keine Referenz → null');
});

group('applyNumericVerdict — Teilaufgaben (B.5, Verdikt pro Teil)', () => {
  // Ein falscher Teil deckelt den Gesamt-Score; Notiz nennt genau diesen Teil.
  let ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis_rechnung: '2+2', endergebnis: 4, schueler_endergebnis: 4 },
    { label: 'b', endergebnis_rechnung: '10*3', endergebnis: 30, schueler_endergebnis: 25 },
  ]};
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'ein falscher Teil → Gesamt-score gedeckelt');
  eq(ev.understood, false, 'understood=false bei falschem Teil');
  ok(/b\)/.test(ev.feedback) && !/a\)/.test(ev.feedback), 'Notiz nennt nur den falschen Teil b)');

  // Alle Teile korrekt → score bleibt, Sammel-✓.
  ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis: 4, schueler_endergebnis: 4 },
    { label: 'b', endergebnis: 30, schueler_endergebnis: 30 },
  ]};
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, 'alle Teile korrekt → score bleibt 2');
  ok(/✓/.test(ev.feedback), 'Sammel-✓ gesetzt');

  // Mehrere falsche Teile werden alle aufgeführt.
  ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis: 4, schueler_endergebnis: 9 },
    { label: 'b', endergebnis: 30, schueler_endergebnis: 25 },
  ]};
  M.applyNumericVerdict(ev, true, 'mittel');
  ok(/a\)/.test(ev.feedback) && /b\)/.test(ev.feedback), 'beide falschen Teile genannt');

  // Teile ohne belastbares Verdikt (keine Schülerzahl) → keine Übersteuerung.
  ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis: 4, schueler_endergebnis: null },
  ]};
  eq(M.applyNumericVerdict(ev, true, 'mittel'), '', 'kein belastbares Teil-Verdikt → keine Notiz');
  eq(ev.score, 2, 'kein belastbares Teil-Verdikt → score bleibt');

  // teilergebnisse hat Vorrang vor den Einzelfeldern.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 100, schueler_endergebnis: 100,
         teilergebnisse: [{ label: 'a', endergebnis: 4, schueler_endergebnis: 5 }] };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'teilergebnisse überschreibt die Einzelfeld-Auswertung');
});

// ── md() — Rendering von Rechenzeichen & Tabellen ─────────────────────────────
group('md — Mathe-Delimiter ($, \\(\\), \\[\\])', () => {
  eq(M.md('$E=mc^2$'), '<span class="math-inline">⟦KTX d=0:E=mc^2⟧</span>',
     'Inline $…$ → KaTeX inline');
  eq(M.md('$$\\int x$$'), '<div class="math-block">⟦KTX d=1:\\int x⟧</div>',
     'Block $$…$$ → KaTeX display');
  // Claude nutzt trotz Prompt oft \(…\) und \[…\] — müssen ebenfalls rendern.
  ok(/math-inline">⟦KTX d=0:E = mc\^2⟧/.test(M.md('Text \\(E = mc^2\\) Ende')),
     '\\(…\\) → KaTeX inline');
  ok(/math-block">⟦KTX d=1:.*frac/.test(M.md('\\[ \\frac{1}{3} \\]')),
     '\\[…\\] → KaTeX display');
  // Roher LaTeX-Backslash darf NICHT als Klartext überleben:
  ok(!M.md('\\(a+b\\)').includes('\\('), 'kein roher \\(-Delimiter im Output');
});

group('md — Multiplikation vs. Kursiv', () => {
  eq(M.md('3 * 4 = 12'), '3 * 4 = 12', 'Stern mit Leerzeichen bleibt Multiplikation');
  eq(M.md('a * b * c'), 'a * b * c', 'mehrere Multiplikationen unangetastet');
  eq(M.md('*wichtig*'), '<em>wichtig</em>', 'echtes Kursiv funktioniert weiter');
  eq(M.md('**fett**'), '<strong>fett</strong>', 'Fett funktioniert weiter');
});

group('md — GFM-Tabellen', () => {
  const html = M.md('| A | B |\n|---|---|\n| 1 | 2 |');
  ok(/<table class="md-table">/.test(html), 'erzeugt <table class="md-table">');
  ok(/<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/.test(html), 'Kopfzeile als <th>');
  ok(/<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/.test(html), 'Datenzeile als <td>');
  ok(!html.includes('|'), 'keine rohen Pipe-Zeichen mehr im Output');

  // Ausrichtung aus der Trennzeile (:--:, --:, :--).
  const al = M.md('| L | C | R |\n|:--|:--:|--:|\n| a | b | c |');
  ok(/<th style="text-align:center">C<\/th>/.test(al), 'zentrierte Spalte');
  ok(/<th style="text-align:right">R<\/th>/.test(al), 'rechtsbündige Spalte');

  // Math-Platzhalter in Zellen überleben bis zur KaTeX-Ersetzung.
  const mt = M.md('| Formel |\n|---|\n| $x^2$ |');
  ok(/<td><span class="math-inline">⟦KTX d=0:x\^2⟧<\/span><\/td>/.test(mt),
     'Formel in Tabellenzelle wird gerendert');

  // Kein Fehlalarm: normaler Text mit Pipe bleibt unverändert (keine Trennzeile).
  ok(!/<table/.test(M.md('a | b ohne Trennzeile')), 'Pipe ohne Separator → keine Tabelle');
});

// ── Ergebnis ──────────────────────────────────────────────────────────────────
console.log(`\n${fail ? '✗' : '✓'} ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
