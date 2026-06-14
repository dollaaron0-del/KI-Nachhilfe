#!/usr/bin/env node
'use strict';
/*
 * Leitplanke gegen den wiederkehrenden 401-Bug (#3):
 * Im Client darf der Server NUR über den zentralen api()-Wrapper angesprochen
 * werden – der setzt Auth-Header und behandelt 401 (abgelaufene Sitzung) zentral.
 * Ein roher fetch('/api...') umgeht das und verschluckt Fehler still.
 *
 * Dieses Skript schlägt fehl (exit 1), sobald ein direkter fetch('/api...') auftaucht,
 * der NICHT bewusst mit einem "// raw-fetch-ok"-Kommentar (gleiche oder Vorzeile)
 * freigegeben wurde. Legitime Ausnahmen: der api()-Wrapper selbst, Auth-Aufrufe vor
 * dem Login, SSE-Streaming und Multipart-Uploads.
 *
 * Lauf: npm run lint
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'docs', 'app.js');
const ALLOW = 'raw-fetch-ok';

const lines = fs.readFileSync(FILE, 'utf8').split('\n');
const offenders = [];

lines.forEach((line, i) => {
  // Sucht: fetch( ... /api   (URL steht immer auf der fetch(-Zeile)
  if (!/\bfetch\s*\(/.test(line)) return;
  if (!/\/api/.test(line)) return;
  const prev = lines[i - 1] || '';
  if (line.includes(ALLOW) || prev.includes(ALLOW)) return;
  offenders.push({ n: i + 1, text: line.trim() });
});

if (offenders.length) {
  console.error(`\n✗ ${offenders.length} direkte fetch('/api…')-Aufruf(e) gefunden (statt api()):\n`);
  for (const o of offenders) console.error(`  docs/app.js:${o.n}  ${o.text}`);
  console.error(`\nBitte über api(url, opts) leiten (zentrale 401-Behandlung).`);
  console.error(`Echte Ausnahme? Zeile mit  // ${ALLOW}  markieren.\n`);
  process.exit(1);
}

console.log("✓ Keine ungeschützten fetch('/api…')-Aufrufe im Client.");
