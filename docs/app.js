'use strict';

// ── PDF.js worker ──────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Mermaid ────────────────────────────────────────────────────────────────
mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });

// ── Constants ──────────────────────────────────────────────────────────────
const ICONS  = ['📐','📊','🧪','🔬','🧬','📚','🖥️','⚖️','💰','🌍','🎨','🎵','🏥','🏛️','✈️','🔧','📡','🧮','⚗️','🔭','🤖','🧠','💡','🎯','🌱','🏋️'];
const COLORS = ['#5856d6','#007aff','#34c759','#ff9500','#ff3b30','#ff2d55','#30b0c7','#a2845e'];

// ── State ──────────────────────────────────────────────────────────────────
let sessionId    = null;
let sessionMeta  = null;
let sessionTxt   = '';
let selIcon      = ICONS[0];
let selColor     = COLORS[0];
let selDiff      = 'mittel';
let examAnsVis   = false;
let blitzIdx       = 0;
let blitzResults   = [];
let scannedTopics  = [];
let selTopic       = null;
let selAufgabenType = 'uebung';
let aufgabenAnsVis  = false;

// ── DB (localforage) ───────────────────────────────────────────────────────
const DB = {
  apiKey:      () => localforage.getItem('api_key'),
  setApiKey:   k  => localforage.setItem('api_key', k),
  subjects:    () => localforage.getItem('subjects').then(v => v || []),
  setSubjects: v  => localforage.setItem('subjects', v),
  meta:        id => localforage.getItem(`meta_${id}`),
  setMeta:     (id, v) => localforage.setItem(`meta_${id}`, v),
  content:     id => localforage.getItem(`cnt_${id}`).then(v => v || ''),
  setContent:  (id, v) => localforage.setItem(`cnt_${id}`, v),
  darkMode:    () => localforage.getItem('dark_mode'),
  setDarkMode: v  => localforage.setItem('dark_mode', v),
  async del(id) {
    await Promise.all([localforage.removeItem(`meta_${id}`), localforage.removeItem(`cnt_${id}`)]);
    const list = await this.subjects();
    await this.setSubjects(list.filter(s => s.id !== id));
  },
};

// ── Anthropic API ──────────────────────────────────────────────────────────
async function claude(messages, systemBlocks, maxTokens = 1500) {
  const key = await DB.apiKey();
  if (!key) throw new Error('Kein API-Key gespeichert');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system: systemBlocks, messages }),
  });

  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Ungültiger API-Key – bitte prüfen');
    throw new Error(e.error?.message || `Fehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

// ── PDF Extraction ─────────────────────────────────────────────────────────
async function extractPDF(file) {
  const ab  = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text  = `\n\n=== ${file.name} ===\n`;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return { text: text.trim(), pages: pdf.numPages, name: file.name };
}

// ── System prompt builder ──────────────────────────────────────────────────
function sysBlocks(extra = '') {
  return [
    {
      type: 'text',
      text: `Du bist ein erfahrener Nachhilfelehrer für das Fach "${sessionMeta?.name || ''}". Du verwendest gezielt moderne lernpsychologische Methoden.

DEINE LEHRPHILOSOPHIE:
• Verständnis vor Auswendiglernen: Erkläre immer das WARUM und den Hintergrund eines Konzepts
• Konkrete Beispiele: Verankere abstrakte Theorie immer in realen, greifbaren Alltagssituationen
• Analogien & Metaphern: Nutze bildhafte Vergleiche um schwierige Konzepte intuitiv verständlich zu machen
• Vorwissen aktivieren: Baue neue Konzepte bewusst auf bereits bekannten Ideen auf ("Das kennst du bereits von X – hier ist es ähnlich, nur…")
• Socratic Method: Führe Lernende durch gezielte Fragen zur Erkenntnis, statt Antworten nur zu servieren
• Fehler als Lernchance: Erkläre präzise wo das Denken schiefgelaufen ist – wertschätzend und konstruktiv
• Chunking: Zerlege komplexe Themen in kleine, verdauliche Einheiten mit klarer Struktur
• Elaboration: Verknüpfe neues Wissen mit anderen Konzepten aus dem Fach ("Das hängt zusammen mit…")
• Retrieval fördern: Rege aktives Erinnern an statt passives Lesen ("Was weißt du noch über…?")
• Lernpsychologie: Kennst du Erkenntnisse aus der Kognitionspsychologie (Arbeitsgedächtnis, Cognitive Load, Spaced Repetition) und wendest sie praktisch an

ANTWORTFORMAT IM CHAT:
1. Kurze Kernaussage (1–2 Sätze)
2. Erklärung mit konkretem Beispiel aus der Praxis
3. Den Hintergrund / das "Warum funktioniert das so?"
4. Optional: eine einprägsame Eselsbrücke oder Verknüpfung zu anderen Konzepten

--- UNTERLAGEN ---
${sessionTxt || '(noch keine Dokumente hochgeladen)'}
--- ENDE ---

DIAGRAMME: Wenn es das Verständnis fördert, erstelle Mermaid-Diagramme in \`\`\`mermaid ... \`\`\` Blöcken.
Verfügbare Typen: flowchart TD (Abläufe/Strukturen), mindmap (Konzepte), sequenceDiagram (Prozesse/Interaktionen).
Halte Diagramme einfach – max. 8 Knoten. Nur einsetzen wenn es wirklich hilft.

MATHEMATIK: Für mathematische Formeln und Gleichungen verwende LaTeX-Notation.
Inline-Formeln: $E = mc^2$  |  Block-Formeln (zentriert, groß): $$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$
Verwende LaTeX immer wenn Formeln, Gleichungen, Summen, Integrale, Matrizen oder griechische Buchstaben vorkommen.

Antworte immer auf Deutsch.${extra ? '\n\n' + extra : ''}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

// ── Dark Mode ──────────────────────────────────────────────────────────────
async function initDarkMode() {
  const dark = await DB.darkMode();
  applyDarkMode(dark === true);
}

function applyDarkMode(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('btn-dark-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

document.getElementById('btn-dark-toggle').addEventListener('click', async () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyDarkMode(!isDark);
  await DB.setDarkMode(!isDark);
});

// ── Screens ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ══ SETUP SCREEN ══════════════════════════════════════════════════════════

document.getElementById('save-key-btn').addEventListener('click', saveApiKey);
document.getElementById('api-key-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveApiKey();
});

async function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  const err = document.getElementById('setup-error');
  err.classList.add('hidden');

  if (!key.startsWith('sk-ant-')) {
    err.textContent = 'API-Key muss mit "sk-ant-" beginnen.';
    err.classList.remove('hidden');
    return;
  }

  document.getElementById('save-key-btn').textContent = 'Wird geprüft…';
  document.getElementById('save-key-btn').disabled = true;

  try {
    await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
    });
    await DB.setApiKey(key);
    showScreen('subjects-screen');
    loadSubjects();
  } catch {
    err.textContent = 'Verbindung fehlgeschlagen. Bitte Internetverbindung prüfen.';
    err.classList.remove('hidden');
  }
  document.getElementById('save-key-btn').textContent = 'Speichern & Starten';
  document.getElementById('save-key-btn').disabled = false;
}

document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('api-key-input').value = '';
  showScreen('setup-screen');
});

// ══ SUBJECTS SCREEN ════════════════════════════════════════════════════════

async function loadSubjects() {
  const list  = await DB.subjects();
  const grid  = document.getElementById('subj-grid');
  const empty = document.getElementById('subj-empty');
  grid.innerHTML = '';
  if (!list.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.forEach(s => grid.appendChild(makeCard(s)));
}

function makeCard(s) {
  const div = document.createElement('div');
  div.className = 'subj-card';
  div.style.borderTopColor = s.color || '#5856d6';
  const meta = s.fileCount
    ? `${s.fileCount} Dok. · ${s.quizCount ? s.quizCount + ' Fragen' : 'kein Quiz'}`
    : 'Noch keine Dokumente';
  const scoreHtml = s.lastScore !== null && s.lastScore !== undefined
    ? `<span class="card-score" style="background:${scoreColor(s.lastScore)}">${s.lastScore}%</span>` : '';
  div.innerHTML = `
    <button class="card-del" data-id="${s.id}">×</button>
    <div class="card-icon">${s.icon}</div>
    <div class="card-name">${esc(s.name)}</div>
    <div class="card-meta">${meta}</div>
    ${scoreHtml}`;
  div.addEventListener('click', e => { if (!e.target.closest('.card-del')) openSubject(s); });
  div.querySelector('.card-del').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`"${s.name}" löschen? Alle Daten gehen verloren.`)) return;
    await DB.del(s.id);
    loadSubjects();
  });
  return div;
}

document.getElementById('btn-new-subject').addEventListener('click', showSubjModal);
document.getElementById('btn-first-subject').addEventListener('click', showSubjModal);

function scoreColor(p) {
  return p >= 70 ? 'var(--green)' : p >= 40 ? 'var(--yellow)' : 'var(--red)';
}

// ══ SUBJECT MODAL ══════════════════════════════════════════════════════════

function buildIconGrid() {
  const g = document.getElementById('icon-grid');
  g.innerHTML = '';
  ICONS.forEach(ic => {
    const b = document.createElement('button');
    b.className = 'icon-btn' + (ic === selIcon ? ' selected' : '');
    b.textContent = ic;
    b.addEventListener('click', () => {
      selIcon = ic;
      g.querySelectorAll('.icon-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    });
    g.appendChild(b);
  });
}

function buildColorRow() {
  const r = document.getElementById('color-row');
  r.innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'color-swatch' + (c === selColor ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      selColor = c;
      r.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      sw.classList.add('selected');
    });
    r.appendChild(sw);
  });
}

function showSubjModal() {
  selIcon = ICONS[0]; selColor = COLORS[0];
  buildIconGrid(); buildColorRow();
  document.getElementById('subj-name').value = '';
  document.getElementById('subj-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('subj-name').focus(), 350);
}

document.getElementById('subj-modal-bg').addEventListener('click', () =>
  document.getElementById('subj-modal').classList.add('hidden'));

document.getElementById('subj-create-btn').addEventListener('click', createSubject);
document.getElementById('subj-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') createSubject();
});

async function createSubject() {
  const name = document.getElementById('subj-name').value.trim();
  if (!name) { document.getElementById('subj-name').focus(); return; }

  const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const subj = { id, name, icon: selIcon, color: selColor,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    fileCount: 0, quizCount: 0, lastScore: null };

  const meta = { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
  const list = await DB.subjects();
  await Promise.all([DB.setSubjects([subj, ...list]), DB.setMeta(id, meta), DB.setContent(id, '')]);

  document.getElementById('subj-modal').classList.add('hidden');
  openSubject(subj);
}

// ══ OPEN SUBJECT ═══════════════════════════════════════════════════════════

async function openSubject(subj) {
  sessionId   = subj.id;
  sessionMeta = await DB.meta(subj.id) || { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
  sessionTxt  = await DB.content(subj.id);

  document.getElementById('header-label').textContent = `${subj.icon}  ${subj.name}`;
  updateHeaderPages();

  const q = sessionMeta.quizStats.questions;
  const sc = q.reduce((a, x) => a + x.score, 0);
  if (q.length) { Object.assign(window, { quizTotal: q.length, quizScore: sc }); }
  else { Object.assign(window, { quizTotal: 0, quizScore: 0 }); }
  updateScoreChip();

  document.getElementById('chat-messages').innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">${subj.icon}</div>
      <p>Stelle mir Fragen zu <strong>${esc(subj.name)}</strong>.<br>Ich erkläre alles geduldig!</p>
    </div>`;

  const noFiles = !sessionMeta.files.length;
  document.getElementById('no-docs-banner').classList.toggle('hidden', !noFiles);

  showQuizState(document.getElementById('quiz-idle'));
  if (q.length) {
    document.getElementById('quiz-summary').textContent =
      `${q.length} Fragen · ${sc}/${q.length * 3} Pkt.`;
    document.getElementById('quiz-summary').classList.remove('hidden');
  } else {
    document.getElementById('quiz-summary').classList.add('hidden');
  }

  const target = sessionMeta.targetScore || 75;
  const slider = document.getElementById('lernziel-slider');
  if (slider) { slider.value = target; document.getElementById('lernziel-val').textContent = target + '%'; }

  refreshAnalysisState();
  switchMode('chat');
  showScreen('main-screen');

  if (noFiles) {
    showUploadSheet();
  } else {
    showWeakTopicsNote();
  }
}

function updateHeaderPages() {
  const fc = sessionMeta?.files?.length || 0;
  document.getElementById('header-pages').textContent =
    fc ? `${fc} Dokument${fc !== 1 ? 'e' : ''}` : 'Keine Dokumente';
}

async function syncSubjectSummary() {
  const q  = sessionMeta.quizStats.questions;
  const sc = q.reduce((a, x) => a + x.score, 0);
  const list = await DB.subjects();
  const idx  = list.findIndex(s => s.id === sessionId);
  if (idx >= 0) {
    list[idx] = { ...list[idx],
      fileCount: sessionMeta.files.length, quizCount: q.length,
      lastScore: q.length ? Math.round(sc / (q.length * 3) * 100) : null,
      updatedAt: new Date().toISOString() };
    await DB.setSubjects(list);
  }
}

// ── Schwächen-Awareness ───────────────────────────────────────────────────

function getWeakTopics(questions) {
  const byTopic = {};
  questions.filter(q => !q.blitz).forEach(q => {
    if (!q.topic) return;
    if (!byTopic[q.topic]) byTopic[q.topic] = [];
    byTopic[q.topic].push(q.score);
  });
  return Object.entries(byTopic)
    .filter(([, scores]) => scores.length >= 2 && scores.reduce((a, b) => a + b, 0) / scores.length < 1.5)
    .map(([topic]) => topic);
}

function showWeakTopicsNote() {
  const q = sessionMeta?.quizStats?.questions || [];
  if (!q.length) return;
  const weak = getWeakTopics(q);
  if (!weak.length) return;
  const msgs = document.getElementById('chat-messages');
  const note = document.createElement('div');
  note.className = 'message assistant';
  note.innerHTML = `<div class="bubble weak-note">⚠️ <strong>Schwächen erkannt:</strong> Bei ${esc(weak.join(', '))} hast du tiefe Lücken. Frag mich gerne dazu!</div>`;
  msgs.appendChild(note);
  msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
}

// ══ UPLOAD SHEET ═══════════════════════════════════════════════════════════

document.getElementById('back-btn').addEventListener('click', () => {
  sessionId = null; sessionMeta = null; sessionTxt = '';
  showScreen('subjects-screen'); loadSubjects();
});
document.getElementById('btn-add-docs').addEventListener('click', showUploadSheet);
document.getElementById('no-docs-btn').addEventListener('click', showUploadSheet);
document.getElementById('upload-bg').addEventListener('click', hideUploadSheet);

function showUploadSheet() {
  document.getElementById('upload-status').classList.add('hidden');
  document.getElementById('upload-progress').classList.add('hidden');
  document.getElementById('upload-title').textContent =
    sessionMeta ? `Dokumente für "${sessionMeta.name}"` : 'Dokumente hochladen';
  document.getElementById('upload-sheet').classList.remove('hidden');
}

function hideUploadSheet() {
  document.getElementById('upload-sheet').classList.add('hidden');
}

document.getElementById('upload-input').addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if (files.length) handleUpload(files);
  e.target.value = '';
});

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const pdfs = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  if (pdfs.length) handleUpload(pdfs);
});

async function handleUpload(files) {
  const prog   = document.getElementById('upload-progress');
  const status = document.getElementById('upload-status');
  prog.classList.remove('hidden'); status.classList.add('hidden');

  try {
    let added = ''; const newFiles = [];
    for (let i = 0; i < files.length; i++) {
      prog.textContent = `Verarbeite ${files[i].name} (${i + 1}/${files.length})…`;
      const { text, pages, name } = await extractPDF(files[i]);
      added += '\n\n' + text;
      newFiles.push({ name, pages, uploadedAt: new Date().toISOString() });
    }
    sessionTxt = (sessionTxt || '') + added;
    sessionMeta.files = [...(sessionMeta.files || []), ...newFiles];
    sessionMeta.updatedAt = new Date().toISOString();

    await Promise.all([DB.setContent(sessionId, sessionTxt), DB.setMeta(sessionId, sessionMeta)]);
    await syncSubjectSummary();

    prog.classList.add('hidden');
    status.textContent = `✓ ${newFiles.map(f => f.name).join(', ')} hochgeladen`;
    status.className = 'sheet-status success';
    status.classList.remove('hidden');
    updateHeaderPages();
    document.getElementById('no-docs-banner').classList.add('hidden');
    setTimeout(hideUploadSheet, 1500);
  } catch (err) {
    prog.classList.add('hidden');
    status.textContent = 'Fehler: ' + err.message;
    status.className = 'sheet-status error';
    status.classList.remove('hidden');
  }
}

// ══ MODE TABS ══════════════════════════════════════════════════════════════

document.querySelectorAll('.tab').forEach(b =>
  b.addEventListener('click', () => switchMode(b.dataset.mode)));

function switchMode(mode) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${mode}`));
  if (mode === 'analysis') refreshAnalysisState();
  if (mode === 'fehler') renderFehlerkatalog();
  if (mode === 'aufgaben') initAufgaben();
}

// ══ SCORE CHIP ════════════════════════════════════════════════════════════

function updateScoreChip() {
  const q   = sessionMeta?.quizStats?.questions || [];
  const tot = q.length;
  const sc  = q.reduce((a, x) => a + x.score, 0);
  const chip = document.getElementById('score-chip');
  if (!tot) { chip.classList.add('hidden'); return; }
  const pct = Math.round(sc / (tot * 3) * 100);
  chip.textContent = pct + '%';
  chip.style.background = scoreColor(pct);
  chip.classList.remove('hidden');
}

// ══ CHAT ══════════════════════════════════════════════════════════════════

const chatMessages = document.getElementById('chat-messages');
const chatInput    = document.getElementById('chat-input');

document.getElementById('chat-send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
chatInput.addEventListener('input', () => autoResize(chatInput));

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !sessionMeta) return;
  chatInput.value = ''; autoResize(chatInput);
  document.getElementById('chat-send').disabled = true;
  addMsg(chatMessages, 'user', text);
  const typ = addTyping(chatMessages);
  sessionMeta.chatHistory.push({ role: 'user', content: text });
  try {
    const reply = await claude(sessionMeta.chatHistory, sysBlocks(
      'Erkläre mit echtem Verständnis – nicht nur Definitionen. Nutze Beispiele aus dem echten Leben, Analogien und erkläre den Hintergrund. ' +
      'Wenn etwas unklar wirkt, gehe tiefer. Wenn sinnvoll, stelle am Ende eine Denkfrage um das Verständnis zu festigen.'
    ));
    sessionMeta.chatHistory.push({ role: 'assistant', content: reply });
    if (sessionMeta.chatHistory.length > 20) {
      sessionMeta.chatHistory = await compressHistory(sessionMeta.chatHistory);
    }
    await DB.setMeta(sessionId, sessionMeta);
    typ.remove();
    addMsg(chatMessages, 'assistant', reply, () => rephraseReply(reply));
  } catch (e) {
    sessionMeta.chatHistory.pop();
    typ.remove(); addMsg(chatMessages, 'assistant', '⚠️ ' + e.message);
  }
  document.getElementById('chat-send').disabled = false;
  chatInput.focus();
}

async function rephraseReply(originalReply) {
  const rephrasePrompt = [
    ...sessionMeta.chatHistory,
    { role: 'user', content: 'Erkläre dasselbe Thema nochmal komplett anders – andere Analogie, anderes Beispiel, anderen Einstieg. Ziel: mir einen neuen Zugang ermöglichen.' },
  ];
  const typ = addTyping(chatMessages);
  try {
    const rephrase = await claude(rephrasePrompt, sysBlocks(), 1000);
    typ.remove();
    addMsg(chatMessages, 'assistant', rephrase, () => rephraseReply(rephrase));
  } catch (e) {
    typ.remove();
    addMsg(chatMessages, 'assistant', '⚠️ ' + e.message);
  }
}

document.getElementById('btn-diagram').addEventListener('click', () => {
  chatInput.value = 'Erkläre den aktuellen Sachverhalt als Mermaid-Diagramm (flowchart TD). Zeige Zusammenhänge, Abläufe oder Strukturen visuell.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('btn-mindmap').addEventListener('click', () => {
  chatInput.value = 'Erstelle eine Mermaid-Mind-Map (mindmap) zu dem Thema, das wir gerade besprochen haben. Zeige Hauptkonzept und alle wichtigen Unterthemen.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('btn-formula').addEventListener('click', () => {
  chatInput.value = 'Liste die wichtigsten Formeln zu dem Thema, das wir gerade besprochen haben. Schreibe jede Formel in LaTeX-Notation ($$...$$) und erkläre kurz was jede Variable bedeutet.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('chat-reset').addEventListener('click', async () => {
  sessionMeta.chatHistory = [];
  await DB.setMeta(sessionId, sessionMeta);
  chatMessages.innerHTML = `<div class="welcome"><div class="welcome-icon">🔄</div><p>Chat gelöscht.</p></div>`;
});

// ══ QUIZ ══════════════════════════════════════════════════════════════════

document.getElementById('quiz-start-btn').addEventListener('click', fetchQuestion);
document.getElementById('quiz-submit').addEventListener('click',    submitAnswer);
document.getElementById('quiz-next').addEventListener('click',      fetchQuestion);
document.getElementById('quiz-stop').addEventListener('click',      () => switchMode('analysis'));
document.getElementById('quiz-answer').addEventListener('keydown',  e => { if (e.key === 'Enter' && e.ctrlKey) submitAnswer(); });
document.getElementById('quiz-reset-btn').addEventListener('click', async () => {
  if (!confirm('Quiz-Fortschritt zurücksetzen?')) return;
  sessionMeta.quizStats = { questions: [] };
  sessionMeta.currentQuestion = null;
  await DB.setMeta(sessionId, sessionMeta);
  await syncSubjectSummary();
  updateScoreChip();
  document.getElementById('quiz-summary').classList.add('hidden');
  showQuizState(document.getElementById('quiz-idle'));
  refreshAnalysisState();
});
document.getElementById('quiz-blitz-btn').addEventListener('click', startBlitz);

function showQuizState(el) {
  document.querySelectorAll('#panel-quiz .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

async function fetchQuestion() {
  if (!sessionMeta) return;
  document.getElementById('q-box').innerHTML =
    '<div class="typing-dots"><span></span><span></span><span></span></div>';
  document.getElementById('quiz-answer').value = '';
  document.getElementById('quiz-submit').disabled = true;
  showQuizState(document.getElementById('quiz-q'));

  const done   = sessionMeta.quizStats.questions.length;
  const avoid  = sessionMeta.quizStats.questions.slice(-8).map(q => q.question).join('\n- ');
  const prompt = `Stelle EINE Prüfungsfrage für "${sessionMeta.name}" (Frage ${done + 1}).

Bevorzuge Fragen die echtes Verständnis testen:
- "Erkläre warum…" / "Was passiert wenn…"
- Transferfragen: Konzept auf neue Situation anwenden
- Zusammenhänge: "Wie hängt X mit Y zusammen?"
- Kein reines Faktenwissen oder Definitionen auswendig lernen

Abwechslung: Mix aus Verständnis, Anwendung und Zusammenhängen.
${avoid ? `Bereits gestellte Fragen vermeiden:\n- ${avoid}` : ''}
Antworte NUR mit der Frage, ohne Kommentar.`;

  try {
    const q = await claude([{ role: 'user', content: 'Nächste Frage.' }], sysBlocks(prompt), 300);
    sessionMeta.currentQuestion = q.trim();
    await DB.setMeta(sessionId, sessionMeta);
    document.getElementById('q-box').textContent = q.trim();
    const qsc = sessionMeta.quizStats.questions;
    const sc  = qsc.reduce((a, x) => a + x.score, 0);
    document.getElementById('q-num').textContent   = `Frage ${done + 1}`;
    document.getElementById('q-score').textContent = qsc.length ? `${sc}/${qsc.length * 3} Pkt.` : '';
    document.getElementById('quiz-submit').disabled = false;
    document.getElementById('quiz-answer').focus();
  } catch (e) {
    document.getElementById('q-box').textContent = '⚠️ ' + e.message;
  }
}

async function submitAnswer() {
  const answer = document.getElementById('quiz-answer').value.trim();
  if (!answer || !sessionMeta?.currentQuestion) return;
  document.getElementById('quiz-submit').disabled = true;

  const evalPrompt = `Bewerte die Antwort STRENG UND PESSIMISTISCH – Prüfungen verzeihen nichts.

Skala (im Zweifel den NIEDRIGEREN Wert wählen):
• 3 = vollständig korrekt, präzise, ALLE wesentlichen Punkte, keine Fehler
• 2 = Kernaussage stimmt, aber wichtige Details fehlen ODER kleinere Fehler
• 1 = Grundidee erkennbar, aber erhebliche Lücken oder mehrere Fehler
• 0 = falsch, am Thema vorbei, oder so lückenhaft dass es nicht zählt

Im "feedback"-Feld:
- Erkläre konkret was gefehlt hat oder warum es falsch war
- Erkläre den Hintergrund / das Warum der richtigen Antwort (nicht nur was richtig ist, sondern warum)
- Wertschätzend aber ehrlich – Fehler sind Lernchancen

Im "correct_answer"-Feld: Gib eine vollständige Musterantwort mit Hintergrunderklärung.

Antworte NUR als JSON:
{"score":<0-3>,"correct":<true|false>,"topic":"<Thema max 4 Wörter>","feedback":"<2-3 Sätze mit Hintergrund>","correct_answer":"<Musterantwort mit Erklärung>"}`;

  try {
    const raw = await claude(
      [{ role: 'user', content: `Frage: ${sessionMeta.currentQuestion}\n\nAntwort: ${answer}` }],
      sysBlocks(evalPrompt), 700,
    );
    const m  = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Ungültige Modellantwort');
    const ev = JSON.parse(m[0]);

    sessionMeta.quizStats.questions.push({
      question: sessionMeta.currentQuestion, userAnswer: answer,
      correct: ev.correct, score: ev.score, topic: ev.topic,
      correctAnswer: ev.correct_answer, feedback: ev.feedback,
      ts: Date.now(), blitz: false,
    });
    sessionMeta.currentQuestion = null;
    await DB.setMeta(sessionId, sessionMeta);
    await syncSubjectSummary();
    updateScoreChip();

    const labels  = ['❌ Falsch (0/3)', '⚠️ Ansatz (1/3)', '🔶 Teilweise (2/3)', '✅ Korrekt (3/3)'];
    const classes = ['c0', 'c1', 'c2', 'c3'];
    document.getElementById('fb-score').textContent = labels[ev.score];
    document.getElementById('fb-score').className   = `fb-score ${classes[ev.score]}`;
    document.getElementById('fb-text').textContent  = ev.feedback;
    document.getElementById('fb-correct').innerHTML = `<strong>Musterantwort:</strong> ${esc(ev.correct_answer)}`;

    showQuizState(document.getElementById('quiz-fb'));
    refreshAnalysisState();
  } catch (e) {
    document.getElementById('quiz-submit').disabled = false;
    document.getElementById('q-box').textContent = '⚠️ ' + e.message;
    showQuizState(document.getElementById('quiz-q'));
  }
}

// ── Blitz-Quiz ─────────────────────────────────────────────────────────────

function startBlitz() {
  blitzIdx = 0;
  blitzResults = [];
  fetchBlitzQuestion();
}

async function fetchBlitzQuestion() {
  showQuizState(document.getElementById('quiz-blitz-q'));
  document.getElementById('blitz-q-num').textContent = `Frage ${blitzIdx + 1}/5`;
  document.getElementById('blitz-q-score').textContent = blitzResults.length
    ? `${blitzResults.filter(r => r.correct).length}/${blitzResults.length} richtig` : '';
  document.getElementById('blitz-q-box').innerHTML =
    '<div class="typing-dots"><span></span><span></span><span></span></div>';
  document.getElementById('mc-grid').innerHTML = '';

  const blitzPrompt = `Erstelle EINE Multiple-Choice-Frage für "${sessionMeta.name}".
Teste echtes Verständnis, nicht reines Faktenwissen.
Antworte NUR als JSON (kein Text davor oder danach):
{"question":"<Frage>","options":["A: <Text>","B: <Text>","C: <Text>","D: <Text>"],"correct":0,"explanation":"<Kurze Erklärung warum richtig>"}
"correct" ist der 0-basierte Index der richtigen Option (0=A, 1=B, 2=C, 3=D).`;

  try {
    const raw = await claude([{ role: 'user', content: 'MC-Frage.' }], sysBlocks(blitzPrompt), 400);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Ungültige Antwort');
    const data = JSON.parse(m[0]);
    document.getElementById('blitz-q-box').textContent = data.question;
    const grid = document.getElementById('mc-grid');
    data.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'mc-btn';
      const label = opt.replace(/^[A-D]:\s*/, '');
      btn.innerHTML = `<span class="mc-letter">${['A','B','C','D'][i]}</span>${esc(label)}`;
      btn.addEventListener('click', () =>
        selectBlitzAnswer(i, data.correct, data.question, data.explanation, grid, data.options));
      grid.appendChild(btn);
    });
  } catch (e) {
    document.getElementById('blitz-q-box').textContent = '⚠️ ' + e.message;
  }
}

function selectBlitzAnswer(chosen, correct, question, explanation, grid, options) {
  grid.querySelectorAll('.mc-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct) btn.classList.add('mc-correct');
    if (i === chosen && chosen !== correct) btn.classList.add('mc-wrong');
  });

  const isCorrect = chosen === correct;
  blitzResults.push({ correct: isCorrect });

  sessionMeta.quizStats.questions.push({
    question,
    userAnswer: (options[chosen] || '').replace(/^[A-D]:\s*/, ''),
    correct: isCorrect, score: isCorrect ? 3 : 0, topic: 'Blitz',
    correctAnswer: (options[correct] || '').replace(/^[A-D]:\s*/, '') + (explanation ? ' – ' + explanation : ''),
    feedback: explanation || '', ts: Date.now(), blitz: true,
  });

  blitzIdx++;
  if (blitzIdx < 5) {
    setTimeout(fetchBlitzQuestion, 1200);
  } else {
    DB.setMeta(sessionId, sessionMeta);
    syncSubjectSummary();
    updateScoreChip();
    refreshAnalysisState();
    setTimeout(endBlitz, 1200);
  }
}

function endBlitz() {
  const correct = blitzResults.filter(r => r.correct).length;
  const pct = Math.round(correct / 5 * 100);
  const color = pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('blitz-result-card').innerHTML = `
    <div class="blitz-score" style="color:${color}">${correct}/5</div>
    <div class="blitz-label">Richtige Antworten</div>
    <div class="blitz-rows">${blitzResults.map((r, i) =>
      `<div class="blitz-row ${r.correct ? 'ok' : 'fail'}">${r.correct ? '✅' : '❌'} Frage ${i + 1}</div>`
    ).join('')}</div>`;
  showQuizState(document.getElementById('quiz-blitz-done'));
}

document.getElementById('blitz-again-btn').addEventListener('click', startBlitz);
document.getElementById('blitz-stop-btn').addEventListener('click', () => switchMode('analysis'));
document.getElementById('blitz-stop-btn2').addEventListener('click', () => switchMode('analysis'));

// ══ EXAM ══════════════════════════════════════════════════════════════════

document.querySelectorAll('.diff-btn').forEach(b => b.addEventListener('click', () => {
  selDiff = b.dataset.diff;
  document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));
document.getElementById('exam-gen-btn').addEventListener('click', generateExam);
document.getElementById('exam-new-btn').addEventListener('click', () => {
  document.getElementById('exam-idle').classList.remove('hidden');
  document.getElementById('exam-result').classList.add('hidden');
});
document.getElementById('exam-ans-btn').addEventListener('click', toggleExamAns);

async function generateExam() {
  ['exam-idle','exam-result'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('exam-loading').classList.remove('hidden');
  examAnsVis = false;

  const examPrompt = `Erstelle eine anspruchsvolle Probeklausur für "${sessionMeta.name}" (Schwierigkeit: ${selDiff}).

# Probeklausur – ${sessionMeta.name}
**Bearbeitungszeit:** XX Min | **Punkte:** XX

## Teil A – Multiple Choice (je 1 Punkt)
[Min. 5 Fragen mit Optionen a–d]

## Teil B – Kurzantworten (je 3 Punkte)
[Min. 3 Fragen]

## Teil C – Ausführliche Antworten (je 6-8 Punkte)
[Min. 2 Fragen]

---
## Lösungsschlüssel
[Vollständige Lösungen]`;

  try {
    const exam = await claude([{ role: 'user', content: 'Klausur erstellen.' }], sysBlocks(examPrompt), 3000);
    const body = document.getElementById('exam-body');
    const sepIdx = exam.search(/---\s*\n+##\s*Lösungsschlüssel/i);
    if (sepIdx > -1) {
      body.innerHTML = md(exam.slice(0, sepIdx)) +
        `<div class="ans-section">${md(exam.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`;
    } else {
      body.innerHTML = md(exam);
    }
    body.closest('.exam-content').classList.add('answers-hidden');
    document.getElementById('exam-ans-btn').textContent = 'Lösungen anzeigen';
    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-result').classList.remove('hidden');
  } catch (e) {
    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-idle').classList.remove('hidden');
    alert('Fehler: ' + e.message);
  }
}

function toggleExamAns() {
  examAnsVis = !examAnsVis;
  document.getElementById('exam-body').closest('.exam-content')
    .classList.toggle('answers-hidden', !examAnsVis);
  document.getElementById('exam-ans-btn').textContent =
    examAnsVis ? 'Lösungen verbergen' : 'Lösungen anzeigen';
}

// ══ ANALYSIS ══════════════════════════════════════════════════════════════

document.getElementById('analysis-btn').addEventListener('click', runAnalysis);
document.getElementById('analysis-refresh').addEventListener('click', runAnalysis);

document.getElementById('lernziel-slider').addEventListener('input', async e => {
  const val = parseInt(e.target.value, 10);
  document.getElementById('lernziel-val').textContent = val + '%';
  if (sessionMeta) {
    sessionMeta.targetScore = val;
    await DB.setMeta(sessionId, sessionMeta);
  }
});

function refreshAnalysisState() {
  const q    = sessionMeta?.quizStats?.questions || [];
  const need = Math.max(0, 3 - q.length);
  const btn  = document.getElementById('analysis-btn');
  const hint = document.getElementById('analysis-hint');
  btn.disabled = need > 0;
  hint.textContent = need > 0
    ? `Noch ${need} Quiz-Frage${need > 1 ? 'n' : ''} für die Analyse.`
    : `${q.length} Fragen beantwortet – Analyse verfügbar.`;
}

function renderSparkline() {
  const wrap = document.getElementById('spark-wrap');
  if (!wrap) return;
  const questions = (sessionMeta?.quizStats?.questions || []).slice(-20);
  if (!questions.length) { wrap.innerHTML = ''; return; }
  const dotColors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759'];
  const dots = questions.map(q => {
    const c = dotColors[Math.min(q.score, 3)];
    return `<span class="spark-dot" style="background:${c}" title="${esc(q.topic || '')}: ${q.score}/3"></span>`;
  }).join('');
  wrap.innerHTML = `<div class="spark-label">Letzte ${questions.length} Antworten</div><div class="spark-row">${dots}</div>`;
}

async function runAnalysis() {
  if (!sessionMeta) return;
  ['analysis-idle','analysis-result'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('analysis-loading').classList.remove('hidden');

  const questions = sessionMeta.quizStats.questions;
  const statsText = questions.map((q, i) =>
    `${i+1}. [${q.topic}] ${q.score}/3 ${q.correct ? '✓' : '✗'}\n   F: ${q.question}\n   A: ${q.userAnswer}`
  ).join('\n\n');
  const raw        = Math.round(questions.reduce((a, q) => a + q.score, 0) / (questions.length * 3) * 100);
  const percent    = Math.max(0, raw - 12);
  const targetScore = sessionMeta.targetScore || 75;

  const analysisPrmt = `Erstelle eine KRITISCHE, PESSIMISTISCHE Lernstandsanalyse für "${sessionMeta.name}".

PFLICHT: Sei bewusst streng. Prüfungen verlaufen unter Druck schlechter als Übungen.
Klausurbereitschaft: ${percent}% (pessimistisch korrigiert von ${raw}%).
Lernziel des Schülers: ${targetScore}%.
Vermeide falsche Sicherheit. Sage klar was noch fehlt.

Berücksichtige lernpsychologische Erkenntnisse in deinen Empfehlungen:
- Spaced Repetition: Welche Themen müssen wiederholt werden und wann?
- Elaboration: Wo fehlt tiefes Verständnis (nur Auswendiglernen statt echtes Verstehen)?
- Retrieval Practice: Empfehle aktives Abrufen statt passives Lesen
- Interleaving: Welche Themen sollten gemischt geübt werden?
- Concrete Examples: Wo sollte die Person nach realen Anwendungsfällen suchen?

Format:
## Gesamteinschätzung
[Kritische, ehrliche Einschätzung – kein falscher Optimismus]

## Stärken ✓
- [nur was wirklich sicher sitzt – mit echtem Verständnis]

## Kritische Lücken ⚠
- **[Thema]:** [was genau fehlt, warum prüfungsrelevant, und ob es Verständnis- oder Wissenslücke ist]
(mindestens 3 konkrete Punkte)

## Lernstrategie-Empfehlungen
- [Konkrete Methoden: z.B. "Thema X mit eigenen Beispielen erklären", "Y mit Karteikarten via Spaced Repetition üben"]
- [Auf Verständnis fokussieren, nicht auf Auswendiglernen]

## Priorisierter Lernplan
1. [Dringendstes zuerst – mit konkreter Lernmethode]
2. ...

## Prognose
[Realistisch: wie viel Lernaufwand noch nötig ist, und ob das Lernziel von ${targetScore}% erreichbar ist]`;

  try {
    const analysis = await claude(
      [{ role: 'user', content: `Quiz-Ergebnisse:\n${statsText}\nRoh: ${raw}%` }],
      sysBlocks(analysisPrmt), 2000,
    );
    const color = scoreColor(percent);
    const targetLeft = Math.min(Math.max(targetScore, 0), 100);
    document.getElementById('gauge').innerHTML = `
      <div class="gauge-pct" style="color:${color}">${percent}%</div>
      <div class="gauge-lbl">Geschätzte Klausurbereitschaft</div>
      <div class="gauge-bar">
        <div class="gauge-fill" style="width:${percent}%;background:${color}"></div>
        <div class="gauge-target" style="left:${targetLeft}%">🎯</div>
      </div>
      <div class="gauge-meta">${questions.length} Fragen · Rohwert: ${raw}% → korrigiert: ${percent}% · Ziel: ${targetScore}%</div>`;
    document.getElementById('analysis-body').innerHTML = md(analysis);
    renderSparkline();
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-result').classList.remove('hidden');
  } catch (e) {
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-idle').classList.remove('hidden');
    alert('Fehler: ' + e.message);
  }
}

// ── Fehlerkatalog ──────────────────────────────────────────────────────────

function renderFehlerkatalog() {
  const list  = document.getElementById('fehler-list');
  const empty = document.getElementById('fehler-empty');
  if (!sessionMeta) return;

  const fragen = (sessionMeta.quizStats.questions || [])
    .filter(q => q.score < 3)
    .slice()
    .reverse();

  if (!fragen.length) {
    empty.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  const scoreLabels  = ['❌ Falsch', '⚠️ Ansatz', '🔶 Teilweise'];
  const scoreClasses = ['c0', 'c1', 'c2'];

  list.innerHTML = fragen.map((q, i) => `
    <div class="fehler-item">
      <div class="fehler-meta">
        <span class="fehler-topic">${esc(q.topic || '–')}</span>
        <span class="fb-score ${scoreClasses[Math.min(q.score, 2)]}" style="font-size:14px">${scoreLabels[Math.min(q.score, 2)]}</span>
      </div>
      <div class="fehler-q">${esc(q.question)}</div>
      <div class="fehler-user"><strong>Deine Antwort:</strong> ${esc(q.userAnswer)}</div>
      ${q.feedback ? `<div class="fehler-feedback">${esc(q.feedback)}</div>` : ''}
      ${q.correctAnswer ? `<div class="fb-correct"><strong>Musterantwort:</strong> ${esc(q.correctAnswer)}</div>` : ''}
      <button class="btn-chat-this" data-question="${esc(q.question)}">💬 Im Chat besprechen</button>
    </div>
  `).join('');

  list.querySelectorAll('.btn-chat-this').forEach(btn => {
    btn.addEventListener('click', () => {
      const question = btn.getAttribute('data-question');
      switchMode('chat');
      chatInput.value = `Erkläre mir nochmal genau: ${question}`;
      autoResize(chatInput);
      chatInput.focus();
    });
  });
}

// ══ CHAT COMPRESSION ══════════════════════════════════════════════════════

async function compressHistory(history) {
  const keep   = 8;
  const old    = history.slice(0, history.length - keep);
  const recent = history.slice(history.length - keep);

  const convText = old.map(m =>
    `${m.role === 'user' ? 'Schüler' : 'Lehrer'}: ${m.content}`
  ).join('\n\n');

  try {
    const summary = await claude(
      [{ role: 'user', content: `Fasse dieses Gespräch in max. 150 Wörtern zusammen. Wichtige Fakten, Erklärungen und offene Fragen beibehalten:\n\n${convText}` }],
      [{ type: 'text', text: 'Du fasst Lernunterhaltungen prägnant zusammen.' }],
      400,
    );
    return [
      { role: 'user',      content: `[Zusammenfassung früherer Unterhaltung: ${summary}]` },
      { role: 'assistant', content: 'Alles klar, ich habe den bisherigen Kontext erfasst.' },
      ...recent,
    ];
  } catch {
    return history.slice(-20);
  }
}

// ══ UTILS ═════════════════════════════════════════════════════════════════

function addMsg(container, role, text, rephraseCallback) {
  const w = document.createElement('div');
  w.className = `message ${role}`;
  const b = document.createElement('div');
  b.className = 'bubble'; b.innerHTML = md(text);
  w.appendChild(b);
  if (role === 'assistant' && rephraseCallback) {
    const btn = document.createElement('button');
    btn.className = 'btn-rephrase';
    btn.textContent = '🔄 Anders erklären';
    btn.addEventListener('click', rephraseCallback);
    w.appendChild(btn);
  }
  container.appendChild(w);
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  const mermaidEls = w.querySelectorAll('.mermaid');
  if (mermaidEls.length) mermaid.run({ nodes: mermaidEls });
  return w;
}

function addTyping(container) {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  container.appendChild(el);
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  return el;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function md(text) {
  if (!text) return '';
  const e = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Extract mermaid blocks before HTML escaping
  const mermaidBlocks = [];
  text = text.replace(/```mermaid\n?([\s\S]*?)```/g, (_, code) => {
    mermaidBlocks.push(code.trim());
    return `\x00MBL${mermaidBlocks.length - 1}\x00`;
  });

  // Extract math before HTML escaping ($$...$$ then $...$)
  const mathParts = [];
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    mathParts.push({ latex: latex.trim(), display: true });
    return `\x00MTH${mathParts.length - 1}\x00`;
  });
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
    mathParts.push({ latex: latex.trim(), display: false });
    return `\x00MTH${mathParts.length - 1}\x00`;
  });

  let html = e(text)
    .replace(/^---$/gm, '<hr>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?=\s*(?!<li>))/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '<br><br>')
    .trim();

  mermaidBlocks.forEach((code, i) => {
    html = html.replace(`\x00MBL${i}\x00`,
      `<div class="mermaid-wrap"><div class="mermaid">${code}</div></div>`);
  });

  mathParts.forEach(({ latex, display }, i) => {
    try {
      const rendered = katex.renderToString(latex, { displayMode: display, throwOnError: false, output: 'html' });
      html = html.replace(`\x00MTH${i}\x00`,
        display ? `<div class="math-block">${rendered}</div>` : `<span class="math-inline">${rendered}</span>`);
    } catch {
      html = html.replace(`\x00MTH${i}\x00`, display ? `<div class="math-block">$$${e(latex)}$$</div>` : `$${e(latex)}$`);
    }
  });

  return html;
}

// ══ AUFGABEN ══════════════════════════════════════════════════════════════

function showAufgabenState(el) {
  document.querySelectorAll('#panel-aufgaben .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function initAufgaben() {
  if (scannedTopics.length) {
    showAufgabenState(document.getElementById('aufgaben-topics'));
  } else {
    showAufgabenState(document.getElementById('aufgaben-idle'));
  }
}

document.getElementById('aufgaben-scan-btn').addEventListener('click', scanTopics);
document.getElementById('aufgaben-rescan-btn').addEventListener('click', scanTopics);

async function scanTopics() {
  if (!sessionTxt) { alert('Bitte zuerst Dokumente hochladen.'); return; }
  document.getElementById('aufgaben-loading-txt').textContent = 'Themen werden erkannt…';
  showAufgabenState(document.getElementById('aufgaben-loading'));
  selTopic = null;
  document.getElementById('aufgaben-gen-btn').disabled = true;

  const prompt = `Analysiere den folgenden Lernstoff und erstelle eine Liste der wichtigsten Themen und Unterthemen.
Antworte NUR als JSON-Array mit maximal 12 kurzen Thema-Strings (max. 4 Wörter je Thema):
["Thema 1", "Thema 2", "Thema 3", ...]`;

  try {
    const raw = await claude(
      [{ role: 'user', content: 'Welche Hauptthemen gibt es in den Unterlagen?' }],
      sysBlocks(prompt), 400,
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Themen erkannt');
    scannedTopics = JSON.parse(m[0]).filter(t => typeof t === 'string').slice(0, 12);
    if (!scannedTopics.length) throw new Error('Keine Themen gefunden');
    renderTopicChips();
    showAufgabenState(document.getElementById('aufgaben-topics'));
  } catch (e) {
    showAufgabenState(document.getElementById('aufgaben-idle'));
    alert('Fehler beim Erkennen: ' + e.message);
  }
}

function renderTopicChips() {
  const wrap = document.getElementById('topic-chips');
  wrap.innerHTML = '';
  scannedTopics.forEach(topic => {
    const btn = document.createElement('button');
    btn.className = 'topic-chip';
    btn.textContent = topic;
    btn.addEventListener('click', () => {
      selTopic = topic;
      wrap.querySelectorAll('.topic-chip').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('aufgaben-gen-btn').disabled = false;
    });
    wrap.appendChild(btn);
  });
}

document.querySelectorAll('.aufg-type-btn').forEach(b => b.addEventListener('click', () => {
  selAufgabenType = b.dataset.type;
  document.querySelectorAll('.aufg-type-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

document.getElementById('aufgaben-gen-btn').addEventListener('click', generateAufgaben);
document.getElementById('aufgaben-back-btn').addEventListener('click', () => {
  showAufgabenState(document.getElementById('aufgaben-topics'));
});
document.getElementById('aufgaben-ans-btn').addEventListener('click', () => {
  aufgabenAnsVis = !aufgabenAnsVis;
  document.getElementById('aufgaben-body').closest('.aufgaben-content')
    .classList.toggle('answers-hidden', !aufgabenAnsVis);
  document.getElementById('aufgaben-ans-btn').textContent =
    aufgabenAnsVis ? 'Lösungen verbergen' : 'Lösungen anzeigen';
});

async function generateAufgaben() {
  if (!selTopic) return;
  aufgabenAnsVis = false;
  document.getElementById('aufgaben-loading-txt').textContent = 'Aufgaben werden erstellt…';
  showAufgabenState(document.getElementById('aufgaben-loading'));

  const isKlausur = selAufgabenType === 'klausur';

  const prompt = isKlausur
    ? `Erstelle eine kompakte Mini-Klausur NUR zum Thema "${selTopic}" aus dem Fach "${sessionMeta.name}".

# Mini-Klausur: ${selTopic}
**Punkte:** XX | **Zeit:** ca. XX Min

## Teil A – Multiple Choice (je 1 Punkt)
[3 MC-Fragen mit Optionen a–d, nur zu "${selTopic}"]

## Teil B – Kurzantworten (je 3 Punkte)
[2 Kurzantwort-Fragen zu "${selTopic}"]

## Teil C – Ausführliche Antwort (6 Punkte)
[1 tiefe Verständnisfrage zu "${selTopic}"]

---
## Lösungsschlüssel
[Vollständige Lösungen mit Erklärungen]`
    : `Erstelle 5 abwechslungsreiche Übungsaufgaben NUR zum Thema "${selTopic}" aus dem Fach "${sessionMeta.name}".

Aufgaben sollen echtes Verständnis testen – nicht reines Auswendiglernen:
- Mix aus: Erklären, Anwenden, Vergleichen, Beispiele nennen, Zusammenhänge erläutern
- Jede Aufgabe mit Punktzahl (1–4 Punkte je nach Schwierigkeit)
- Aufsteigende Schwierigkeit

Format:
## Übungsaufgaben: ${selTopic}

**Aufgabe 1 (X Pkt.):** [Aufgabe]

**Aufgabe 2 (X Pkt.):** [Aufgabe]

...

---
## Musterlösungen
[Vollständige Lösungen mit Hintergrundinformationen]`;

  try {
    const result = await claude(
      [{ role: 'user', content: 'Aufgaben erstellen.' }],
      sysBlocks(prompt), 2500,
    );
    const body = document.getElementById('aufgaben-body');
    const sepIdx = result.search(/---\s*\n+##\s*(Lösungsschlüssel|Musterlösungen)/i);
    if (sepIdx > -1) {
      body.innerHTML = md(result.slice(0, sepIdx)) +
        `<div class="ans-section">${md(result.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`;
    } else {
      body.innerHTML = md(result);
    }
    document.getElementById('aufgaben-body').closest('.aufgaben-content').classList.add('answers-hidden');
    document.getElementById('aufgaben-ans-btn').textContent = 'Lösungen anzeigen';
    showAufgabenState(document.getElementById('aufgaben-result'));
  } catch (e) {
    showAufgabenState(document.getElementById('aufgaben-topics'));
    alert('Fehler: ' + e.message);
  }
}

// ══ INIT ══════════════════════════════════════════════════════════════════
(async () => {
  await initDarkMode();
  const key = await DB.apiKey();
  if (key) { showScreen('subjects-screen'); loadSubjects(); }
})();
