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
let currentAufgabe  = '';
let rechnenDiff     = 'mittel';
let mathCtx         = null;
let isDrawingCanvas = false;
let canvasLastX     = 0, canvasLastY = 0;
let undoStack       = [];
let savedCanvasData = null;

// ── DB (server-backed) ────────────────────────────────────────────────────
const api = (url, opts = {}) =>
  fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
    .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }));

const DB = {
  // ── Server ──────────────────────────────────────────────────────────────
  subjects:     () => api('/api/subjects').catch(() => []),
  addSubject:   s  => api('/api/subjects', { method: 'POST', body: JSON.stringify({ id: s.id, name: s.name, emoji: s.icon || s.emoji || '📚' }) }),
  delSubject:   id => fetch(`/api/subjects/${id}`, { method: 'DELETE' }),

  messages:     id => api(`/api/subjects/${id}/messages`).catch(() => []),
  addMessage:   (id, role, content) => fetch(`/api/subjects/${id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, content }),
  }).catch(() => {}),
  clearMessages: id => fetch(`/api/subjects/${id}/messages`, { method: 'DELETE' }),

  cards:    id    => api(`/api/subjects/${id}/cards`).catch(() => []),
  setCards: (id, cards) => api(`/api/subjects/${id}/cards`, {
    method: 'POST', body: JSON.stringify({ cards }),
  }),

  addQuizResult: (id, score, total) => fetch(`/api/subjects/${id}/quiz`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ score, total }),
  }).catch(() => {}),
  quizResults: id => api(`/api/subjects/${id}/quiz`).catch(() => []),

  streak: async () => {
    try { const s = await api('/api/streak'); return { count: s.count, lastDate: s.last_date }; }
    catch { return { count: 0, lastDate: null }; }
  },
  setStreak: v => fetch('/api/streak', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ count: v.count, last_date: v.lastDate }),
  }).catch(() => {}),

  setGlossar: (id, terms) => api(`/api/subjects/${id}/glossar`, {
    method: 'POST', body: JSON.stringify({ terms }),
  }),

  stats: id => api(`/api/subjects/${id}/stats`).catch(() => null),

  // ── Local-only (ephemeral / preferences) ────────────────────────────────
  darkMode:    () => localforage.getItem('dark_mode'),
  setDarkMode: v  => localforage.setItem('dark_mode', v),
  meta:        id => localforage.getItem(`meta_${id}`),
  setMeta:     (id, v) => localforage.setItem(`meta_${id}`, v),
  content:     id => localforage.getItem(`cnt_${id}`).then(v => v || ''),
  setContent:  (id, v) => localforage.setItem(`cnt_${id}`, v),

  async del(id) {
    await Promise.all([
      this.delSubject(id),
      localforage.removeItem(`meta_${id}`),
      localforage.removeItem(`cnt_${id}`),
    ]);
  },
};

// ── Streak ─────────────────────────────────────────────────────────────────
async function touchStreak() {
  const s = await DB.streak();
  const today = new Date().toDateString();
  const yest  = new Date(Date.now() - 86400000).toDateString();
  if (s.lastDate === today) return s.count;
  s.count = (s.lastDate === yest) ? s.count + 1 : 1;
  s.lastDate = today;
  await DB.setStreak(s);
  renderStreak(s.count);
  return s.count;
}

async function renderStreak(count) {
  if (count === undefined) {
    const s = await DB.streak();
    const today = new Date().toDateString();
    const yest  = new Date(Date.now() - 86400000).toDateString();
    count = (s.lastDate === today || s.lastDate === yest) ? s.count : 0;
  }
  const el = document.getElementById('streak-badge');
  if (!el) return;
  el.textContent = count > 0 ? `🔥 ${count}` : '';
  el.classList.toggle('hidden', count === 0);
}

// ── Anthropic API (via server proxy) ──────────────────────────────────────
async function claude(messages, systemBlocks, maxTokens = 1500) {
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens, subject_id: sessionId }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

// ── Haiku for simple generation tasks (12x cheaper than Sonnet) ──────────
async function claudeHaiku(messages, systemBlocks, maxTokens = 600) {
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages, system: systemBlocks, max_tokens: maxTokens,
      model: 'claude-haiku-4-5-20251001', subject_id: sessionId,
    }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Serverfehler ${r.status}`); }
  return (await r.json()).content[0].text;
}

// ── Local model via Ollama (free, for batch tasks) ────────────────────────
async function claudeLocal(messages, systemBlocks, maxTokens = 2000) {
  const r = await fetch('/api/local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

// ── Anthropic Vision API (via server proxy) ────────────────────────────────
async function claudeVision(base64, textPrompt, systemBlocks, maxTokens = 1500) {
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
      { type: 'text', text: textPrompt },
    ],
  }];
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
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

async function saveApiKey() {
  // Legacy: kept for compatibility, but no API key needed when using server
  showScreen('subjects-screen');
  loadSubjects();
}

document.getElementById('settings-btn').addEventListener('click', () => {
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

  const btn = document.getElementById('subj-create-btn');
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const subj = { id, name, icon: selIcon, color: selColor,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      fileCount: 0, quizCount: 0, lastScore: null };

    const meta = { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
    await Promise.all([DB.addSubject(subj), DB.setMeta(id, meta)]);

    document.getElementById('subj-modal').classList.add('hidden');
    openSubject(subj);
  } catch (e) {
    alert('Fehler beim Erstellen: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Fach erstellen';
  }
}

// ══ OPEN SUBJECT ═══════════════════════════════════════════════════════════

async function openSubject(subj) {
  sessionId = subj.id;
  const [savedMeta, serverMsgs, quizRows, serverDocs] = await Promise.all([
    DB.meta(subj.id),
    DB.messages(subj.id),
    DB.quizResults(subj.id),
    api(`/api/subjects/${subj.id}/documents`).catch(() => []),
  ]);
  sessionMeta = savedMeta || { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
  if (serverMsgs.length) sessionMeta.chatHistory = serverMsgs;
  if (quizRows.length) {
    sessionMeta.quizStats.questions = quizRows.map(r => ({
      score: r.score, topic: '', blitz: false,
    }));
  }
  if (serverDocs.length) {
    sessionMeta.files = serverDocs.map(d => ({ name: d.filename, uploadedAt: d.uploaded_at }));
  }
  sessionTxt = await DB.content(subj.id);
  scannedTopics = (await localforage.getItem(`topics_${subj.id}`)) || [];
  selTopic = null;
  currentAufgabe = ''; savedCanvasData = null; mathCtx = null; undoStack = [];

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
  // Stats are now live from server — nothing to sync locally
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
      // Save to server for RAG + auto-card generation
      fetch(`/api/subjects/${sessionId}/documents/text`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: name, content: text }),
      }).catch(() => {});
    }
    sessionTxt = (sessionTxt || '') + added;
    sessionMeta.files = [...(sessionMeta.files || []), ...newFiles];
    sessionMeta.updatedAt = new Date().toISOString();

    await Promise.all([DB.setContent(sessionId, sessionTxt), DB.setMeta(sessionId, sessionMeta)]);

    prog.classList.add('hidden');
    status.textContent = `✓ ${newFiles.map(f => f.name).join(', ')} hochgeladen · Karteikarten werden generiert…`;
    status.className = 'sheet-status success';
    status.classList.remove('hidden');
    updateHeaderPages();
    document.getElementById('no-docs-banner').classList.add('hidden');
    setTimeout(hideUploadSheet, 2000);
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
  // Save canvas drawing before leaving rechnen
  const rechnenSolve = document.getElementById('rechnen-solve');
  if (mathCtx && rechnenSolve && !rechnenSolve.classList.contains('hidden')) {
    savedCanvasData = document.getElementById('math-canvas').toDataURL('image/png');
  }
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${mode}`));
  if (mode === 'analysis') refreshAnalysisState();
  if (mode === 'fehler') renderFehlerkatalog();
  if (mode === 'aufgaben') initAufgaben();
  if (mode === 'rechnen') initRechnen();
  if (mode === 'karten') initKarten();
  if (mode === 'dashboard') initDashboard();
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
  DB.addMessage(sessionId, 'user', text);
  try {
    const reply = await claude(sessionMeta.chatHistory, sysBlocks(
      'Erkläre mit echtem Verständnis – nicht nur Definitionen. Nutze Beispiele aus dem echten Leben, Analogien und erkläre den Hintergrund. ' +
      'Wenn etwas unklar wirkt, gehe tiefer. Wenn sinnvoll, stelle am Ende eine Denkfrage um das Verständnis zu festigen.'
    ));
    sessionMeta.chatHistory.push({ role: 'assistant', content: reply });
    DB.addMessage(sessionId, 'assistant', reply);
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
    const q = await claudeHaiku([{ role: 'user', content: 'Nächste Frage.' }], sysBlocks(prompt), 300);
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
    haptic(ev.score >= 2 ? 40 : [80,40,80]);

    sessionMeta.quizStats.questions.push({
      question: sessionMeta.currentQuestion, userAnswer: answer,
      correct: ev.correct, score: ev.score, topic: ev.topic,
      correctAnswer: ev.correct_answer, feedback: ev.feedback,
      ts: Date.now(), blitz: false,
    });
    sessionMeta.currentQuestion = null;
    DB.addQuizResult(sessionId, ev.score, 3);
    await DB.setMeta(sessionId, sessionMeta);
    await syncSubjectSummary();
    updateScoreChip();
    touchStreak();

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
    const raw = await claudeHaiku([{ role: 'user', content: 'MC-Frage.' }], sysBlocks(blitzPrompt), 400);
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
  haptic(isCorrect ? 40 : [80,40,80]);
  blitzResults.push({ correct: isCorrect });

  sessionMeta.quizStats.questions.push({
    question,
    userAnswer: (options[chosen] || '').replace(/^[A-D]:\s*/, ''),
    correct: isCorrect, score: isCorrect ? 3 : 0, topic: 'Blitz',
    correctAnswer: (options[correct] || '').replace(/^[A-D]:\s*/, '') + (explanation ? ' – ' + explanation : ''),
    feedback: explanation || '', ts: Date.now(), blitz: true,
  });
  touchStreak();

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
      body.innerHTML = safeHtml(md(exam.slice(0, sepIdx)) +
        `<div class="ans-section">${md(exam.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
    } else {
      body.innerHTML = safeHtml(md(exam));
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
    document.getElementById('analysis-body').innerHTML = safeHtml(md(analysis));
    renderSparkline();
    renderProgressChart();
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
    const summary = await claudeHaiku(
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

function haptic(pattern = 10) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function addMsg(container, role, text, rephraseCallback) {
  const w = document.createElement('div');
  w.className = `message ${role}`;
  const b = document.createElement('div');
  b.className = 'bubble'; b.innerHTML = safeHtml(md(text));
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

// KaTeX emits SVG + inline styles; allow those while blocking actual XSS
const PURIFY_CFG = {
  ADD_TAGS: ['svg','path','g','use','defs','clipPath','line','circle','rect','polygon','text','tspan','marker'],
  ADD_ATTR: ['viewBox','xmlns','xmlns:xlink','xlink:href','href','d','points','transform',
             'x','y','x1','y1','x2','y2','r','cx','cy','clip-path','marker-end',
             'stroke','stroke-width','fill','fill-rule'],
  ALLOW_DATA_ATTR: false,
};
const safeHtml = html => DOMPurify.sanitize(html, PURIFY_CFG);

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
    await localforage.setItem(`topics_${sessionId}`, scannedTopics);
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
      body.innerHTML = safeHtml(md(result.slice(0, sepIdx)) +
        `<div class="ans-section">${md(result.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
    } else {
      body.innerHTML = safeHtml(md(result));
    }
    document.getElementById('aufgaben-body').closest('.aufgaben-content').classList.add('answers-hidden');
    document.getElementById('aufgaben-ans-btn').textContent = 'Lösungen anzeigen';
    showAufgabenState(document.getElementById('aufgaben-result'));
  } catch (e) {
    showAufgabenState(document.getElementById('aufgaben-topics'));
    alert('Fehler: ' + e.message);
  }
}

// ══ RECHNEN (Apple Pencil) ════════════════════════════════════════════════

function showRechnenState(el) {
  document.querySelectorAll('#panel-rechnen .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
  if (el.id === 'rechnen-solve') {
    // Two rAF frames ensure layout is complete before sizing canvas
    requestAnimationFrame(() => requestAnimationFrame(() => initCanvas()));
  }
}

function initRechnen() {
  if (currentAufgabe) {
    const display = document.getElementById('aufgabe-display');
    display.innerHTML = safeHtml(md(currentAufgabe));
    showRechnenState(document.getElementById('rechnen-solve'));
  } else {
    showRechnenState(document.getElementById('rechnen-idle'));
  }
}

function initCanvas() {
  const canvas = document.getElementById('math-canvas');
  const rect   = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr    = window.devicePixelRatio || 1;
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  mathCtx = canvas.getContext('2d');
  mathCtx.scale(dpr, dpr);
  // Fill white background (needed for vision API)
  mathCtx.fillStyle = '#ffffff';
  mathCtx.fillRect(0, 0, rect.width, rect.height);
  // Restore saved drawing when returning from another tab
  if (savedCanvasData) {
    const img = new Image();
    img.onload = () => { mathCtx.drawImage(img, 0, 0, rect.width, rect.height); applyCtxStyle(); };
    img.src = savedCanvasData;
    savedCanvasData = null;
  } else {
    applyCtxStyle();
  }
  undoStack = [];
}

function applyCtxStyle() {
  if (!mathCtx) return;
  mathCtx.strokeStyle = '#1c1c1e';
  mathCtx.lineCap     = 'round';
  mathCtx.lineJoin    = 'round';
  mathCtx.lineWidth   = 2;
}

function setupCanvasEvents() {
  const canvas = document.getElementById('math-canvas');

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawingCanvas = true;
    // Snapshot before stroke → enables undo
    if (mathCtx) {
      undoStack.push(mathCtx.getImageData(0, 0, canvas.width, canvas.height));
      if (undoStack.length > 20) undoStack.shift();
    }
    const p = canvasPos(e, canvas);
    canvasLastX = p.x; canvasLastY = p.y;
    // Dot for tap/click
    if (mathCtx) {
      mathCtx.beginPath();
      mathCtx.arc(p.x, p.y, Math.max(0.5, (e.pressure || 0.5) * 1.5), 0, Math.PI * 2);
      mathCtx.fillStyle = '#1c1c1e';
      mathCtx.fill();
    }
  }, { passive: false });

  canvas.addEventListener('pointermove', e => {
    if (!isDrawingCanvas || !mathCtx) return;
    e.preventDefault();
    const p        = canvasPos(e, canvas);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    mathCtx.lineWidth = Math.max(1, pressure * 3.5);
    mathCtx.strokeStyle = '#1c1c1e';
    mathCtx.beginPath();
    mathCtx.moveTo(canvasLastX, canvasLastY);
    mathCtx.lineTo(p.x, p.y);
    mathCtx.stroke();
    canvasLastX = p.x; canvasLastY = p.y;
  }, { passive: false });

  const endDraw = () => { isDrawingCanvas = false; };
  canvas.addEventListener('pointerup',     endDraw);
  canvas.addEventListener('pointercancel', endDraw);
  canvas.addEventListener('pointerleave',  endDraw);
  canvas.addEventListener('contextmenu',   e => e.preventDefault());
}

function canvasPos(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clearCanvas() {
  if (!mathCtx) return;
  const canvas = document.getElementById('math-canvas');
  const r      = canvas.getBoundingClientRect();
  undoStack = [];
  mathCtx.fillStyle = '#ffffff';
  mathCtx.fillRect(0, 0, r.width, r.height);
}

function undoCanvas() {
  if (!mathCtx || !undoStack.length) return;
  mathCtx.putImageData(undoStack.pop(), 0, 0);
}

// Difficulty buttons
document.querySelectorAll('.diff-btn-r').forEach(b => b.addEventListener('click', () => {
  rechnenDiff = b.dataset.rdiff;
  document.querySelectorAll('.diff-btn-r').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

document.getElementById('rechnen-gen-btn').addEventListener('click', generateMathAufgabe);
document.getElementById('canvas-undo-btn').addEventListener('click', undoCanvas);
document.getElementById('canvas-clear-btn').addEventListener('click', clearCanvas);
document.getElementById('canvas-check-btn').addEventListener('click', checkHandwriting);
document.getElementById('rechnen-new-btn').addEventListener('click', () => {
  currentAufgabe = ''; savedCanvasData = null;
  showRechnenState(document.getElementById('rechnen-idle'));
});
document.getElementById('rechnen-retry-btn').addEventListener('click', () => {
  savedCanvasData = null;
  showRechnenState(document.getElementById('rechnen-solve'));
});
document.getElementById('rechnen-next-btn').addEventListener('click', generateMathAufgabe);

setupCanvasEvents();

async function generateMathAufgabe() {
  if (!sessionMeta) { alert('Bitte zuerst ein Fach öffnen.'); return; }
  document.getElementById('rechnen-loading-txt').textContent = 'Aufgabe wird erstellt…';
  showRechnenState(document.getElementById('rechnen-loading'));

  const prompt = `Erstelle EINE einzelne Rechenaufgabe (Schwierigkeit: ${rechnenDiff}) aus dem Lernstoff von "${sessionMeta.name}".

Regeln:
- Genau eine Aufgabe, klar und präzise formuliert
- Leicht = direkte Berechnung (1–2 Schritte) | Mittel = mehrere Schritte | Schwer = komplexe Aufgabe
- Verwende LaTeX für alle Formeln und Gleichungen ($$...$$)
- Schließe mit einer klaren Handlungsaufforderung: "Berechne:", "Bestimme:", "Löse:" etc.
- Keine Lösung – NUR die Aufgabenstellung

Antworte NUR mit der Aufgabenstellung, kein zusätzlicher Text.`;

  try {
    const aufgabe = await claudeHaiku(
      [{ role: 'user', content: 'Rechenaufgabe erstellen.' }],
      sysBlocks(prompt), 500,
    );
    currentAufgabe  = aufgabe.trim();
    savedCanvasData = null;
    undoStack       = [];
    document.getElementById('aufgabe-display').innerHTML = safeHtml(md(currentAufgabe));
    showRechnenState(document.getElementById('rechnen-solve'));
  } catch (e) {
    showRechnenState(document.getElementById('rechnen-idle'));
    alert('Fehler: ' + e.message);
  }
}

async function checkHandwriting() {
  if (!mathCtx) return;
  const canvas = document.getElementById('math-canvas');

  // Detect whether anything was drawn (any non-white pixel)
  const px = mathCtx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasInk = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) { hasInk = true; break; }
  }
  if (!hasInk) { alert('Bitte schreibe zuerst deine Lösung auf die Zeichenfläche.'); return; }

  document.getElementById('rechnen-loading-txt').textContent = 'Lösung wird geprüft…';
  showRechnenState(document.getElementById('rechnen-loading'));

  const dataURL = canvas.toDataURL('image/png');
  const base64  = dataURL.split(',')[1];

  const checkPrompt = `Ein Schüler hat die folgende Aufgabe handschriftlich auf dem beigefügten Bild gelöst.

**Aufgabe:** ${currentAufgabe}

Analysiere die handgeschriebene Lösung im Bild und antworte auf Deutsch:

## ✅ Richtig / ❌ Falsch
Ist die finale Antwort korrekt? Eindeutige Aussage zuerst.

## Lösungsweg des Schülers
Was erkennst du auf dem Bild? Wie ist der Schüler vorgegangen?

## Fehleranalyse (nur wenn falsch)
Wo genau liegt der Fehler? Erkläre präzise warum er falsch ist.

## Musterlösung
Vollständiger korrekter Lösungsweg mit LaTeX-Notation ($$...$$).

Falls die Schrift schwer lesbar ist: gib trotzdem dein Bestes und erkläre was du erkennst.`;

  try {
    const feedback = await claudeVision(base64, checkPrompt, sysBlocks(), 1800);
    document.getElementById('result-aufgabe-txt').innerHTML = safeHtml(md(currentAufgabe));
    document.getElementById('result-preview').src = dataURL;
    document.getElementById('rechnen-feedback').innerHTML = safeHtml(md(feedback));
    showRechnenState(document.getElementById('rechnen-result'));
  } catch (e) {
    showRechnenState(document.getElementById('rechnen-solve'));
    requestAnimationFrame(() => requestAnimationFrame(() => initCanvas()));
    alert('Fehler beim Prüfen: ' + e.message);
  }
}

// ══ BACKUP / RESTORE ══════════════════════════════════════════════════════
async function exportBackup() {
  const r = await fetch('/api/backup');
  const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), {
    href: url, download: `ki-backup-${new Date().toISOString().slice(0,10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data.subjects) throw new Error('Ungültiges Backup-Format');
  await fetch('/api/restore', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  await loadSubjects();
  alert(`✅ ${data.subjects.length} Fach/Fächer importiert.`);
}

document.getElementById('btn-export').addEventListener('click', exportBackup);
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-input').click());
document.getElementById('import-input').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { await importBackup(f); } catch(err) { alert('Import-Fehler: ' + err.message); }
  e.target.value = '';
});

// ══ CHEAT SHEET ═══════════════════════════════════════════════════════════
document.getElementById('cheat-gen-btn').addEventListener('click', generateCheatSheet);
document.getElementById('cheat-new-btn').addEventListener('click', () => {
  document.getElementById('cheat-result').classList.add('hidden');
  document.getElementById('cheat-idle').classList.remove('hidden');
});

async function generateCheatSheet() {
  document.getElementById('cheat-idle').classList.add('hidden');
  document.getElementById('cheat-loading').classList.remove('hidden');

  const prompt = `Erstelle eine präzise, kompakte Zusammenfassung für "${sessionMeta.name}" als Cheat Sheet / Spickzettel.

Struktur:
# ${sessionMeta.name} – Zusammenfassung

## Kernkonzepte
- [Konzept]: [1-Satz-Erklärung]
(alle wichtigen Konzepte)

## Wichtige Formeln
$$[Formel 1]$$
*[Was die Formel bedeutet und wann sie gilt]*

(alle relevanten Formeln mit LaTeX)

## Definitionen
**[Begriff]:** [präzise Definition]
(alle Schlüsselbegriffe)

## Merksätze & Faustregeln
- [Wichtige Regeln, Ausnahmen, Tricks]

## Typische Fehler ⚠️
- [Was Schüler häufig falsch machen]

Sei präzise und vollständig. Alle Formeln in LaTeX-Notation.`;

  try {
    const result = await claudeLocal(
      [{ role: 'user', content: 'Zusammenfassung erstellen.' }],
      sysBlocks(prompt), 3000,
    );
    document.getElementById('cheat-body').innerHTML = safeHtml(md(result));
    document.getElementById('cheat-loading').classList.add('hidden');
    document.getElementById('cheat-result').classList.remove('hidden');
  } catch (e) {
    document.getElementById('cheat-loading').classList.add('hidden');
    document.getElementById('cheat-idle').classList.remove('hidden');
    alert('Fehler: ' + e.message);
  }
}

// ══ GLOSSAR ════════════════════════════════════════════════════════════════
let glossarTerms = [];

document.getElementById('glossar-gen-btn').addEventListener('click', generateGlossar);
document.getElementById('glossar-new-btn').addEventListener('click', () => {
  glossarTerms = [];
  document.getElementById('glossar-result').classList.add('hidden');
  document.getElementById('glossar-idle').classList.remove('hidden');
});
document.getElementById('glossar-search').addEventListener('input', e => {
  renderGlossarList(e.target.value.toLowerCase());
});

async function generateGlossar() {
  document.getElementById('glossar-idle').classList.add('hidden');
  document.getElementById('glossar-loading').classList.remove('hidden');

  const prompt = `Extrahiere alle wichtigen Fachbegriffe aus dem Lernstoff für "${sessionMeta.name}".
Antworte NUR als JSON-Array (maximal 40 Begriffe, alphabetisch sortiert):
[{"term":"Begriff","def":"Präzise 1-2 Satz Erklärung"},...]`;

  try {
    const raw  = await claudeLocal(
      [{ role: 'user', content: 'Alle Fachbegriffe extrahieren.' }],
      sysBlocks(prompt), 2500,
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Begriffe gefunden');
    glossarTerms = JSON.parse(m[0]).filter(t => t.term && t.def);
    glossarTerms.sort((a, b) => a.term.localeCompare(b.term, 'de'));
    DB.setGlossar(sessionId, glossarTerms.map(t => ({ term: t.term, definition: t.def }))).catch(() => {});
    renderGlossarList('');
    document.getElementById('glossar-loading').classList.add('hidden');
    document.getElementById('glossar-result').classList.remove('hidden');
  } catch (e) {
    document.getElementById('glossar-loading').classList.add('hidden');
    document.getElementById('glossar-idle').classList.remove('hidden');
    alert('Fehler: ' + e.message);
  }
}

function renderGlossarList(filter) {
  const list    = document.getElementById('glossar-list');
  const visible = filter ? glossarTerms.filter(t =>
    t.term.toLowerCase().includes(filter) || t.def.toLowerCase().includes(filter)
  ) : glossarTerms;
  list.innerHTML = visible.map(t => `
    <div class="glossar-item">
      <div class="glossar-term">${esc(t.term)}</div>
      <div class="glossar-def">${esc(t.def)}</div>
    </div>`).join('');
}

// ══ CHART.JS FORTSCHRITTSDIAGRAMM ═════════════════════════════════════════
let _progressChart = null;

function renderProgressChart() {
  const wrap = document.getElementById('chart-wrap');
  const questions = (sessionMeta?.quizStats?.questions || []);
  if (questions.length < 5) { if (wrap) wrap.classList.add('hidden'); return; }
  if (wrap) wrap.classList.remove('hidden');

  // Rolling 5-question average
  const pcts = questions.map(q => Math.round(q.score / 3 * 100));
  const rolling = pcts.map((_, i) => {
    const w = pcts.slice(Math.max(0, i - 4), i + 1);
    return Math.round(w.reduce((a, b) => a + b, 0) / w.length);
  });

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
  const textColor = isDark ? '#ebebf5' : '#1c1c1e';

  if (_progressChart) _progressChart.destroy();
  _progressChart = new Chart(document.getElementById('progress-chart'), {
    type: 'line',
    data: {
      labels: questions.map((_, i) => i + 1),
      datasets: [
        {
          label: 'Einzelantwort',
          data: pcts,
          borderColor: 'rgba(88,86,214,0.3)',
          backgroundColor: 'transparent',
          pointRadius: 3, pointBackgroundColor: 'rgba(88,86,214,0.5)',
          tension: 0, borderWidth: 1,
        },
        {
          label: 'Ø 5-Fragen',
          data: rolling,
          borderColor: '#5856d6',
          backgroundColor: 'rgba(88,86,214,0.08)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
        y: { min: 0, max: 100, ticks: { callback: v => v + '%', color: textColor }, grid: { color: gridColor } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } },
      },
    },
  });
}

// ══ KARTEIKARTEN ══════════════════════════════════════════════════════════
let reviewQueue = [];
let reviewIdx   = 0;
let reviewStats = { again: 0, hard: 0, good: 0, easy: 0 };

function srsUpdate(card, grade) {
  if (grade < 2) {
    card.interval    = 1;
    card.repetitions = 0;
  } else {
    if      (card.repetitions === 0) card.interval = 1;
    else if (card.repetitions === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.ef);
    card.repetitions++;
  }
  card.ef  = Math.max(1.3, card.ef + 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));
  card.due = Date.now() + card.interval * 86400000;
  return card;
}

function showKartenState(el) {
  document.querySelectorAll('#panel-karten .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

async function initKarten() {
  const cards = await DB.cards(sessionId);
  const now   = Date.now();
  const due   = cards.filter(c => c.due <= now);
  const stats = document.getElementById('karten-stats');
  const revBtn = document.getElementById('karten-review-btn');

  if (!cards.length) {
    stats.innerHTML = '<p style="color:var(--text2)">Noch keine Karten. Generiere sie aus deinen Dokumenten.</p>';
    revBtn.style.display = 'none';
  } else {
    stats.innerHTML = `
      <div class="karten-stat-row">
        <span class="kstat">📦 ${cards.length} Karten gesamt</span>
        <span class="kstat kstat-due">⏰ ${due.length} heute fällig</span>
      </div>`;
    revBtn.style.display = due.length ? '' : 'none';
    if (!due.length) {
      const next = Math.min(...cards.map(c => c.due));
      const hrs  = Math.ceil((next - now) / 3600000);
      stats.innerHTML += `<p style="color:var(--text2);font-size:14px;margin-top:8px">✅ Alle Karten erledigt! Nächste Wiederholung in ${hrs < 24 ? hrs + ' Std.' : Math.ceil(hrs/24) + ' Tagen'}</p>`;
    }
  }
  showKartenState(document.getElementById('karten-idle'));
}

async function generateKarten() {
  if (!sessionTxt) { alert('Bitte zuerst Dokumente hochladen.'); return; }
  showKartenState(document.getElementById('karten-loading'));

  const prompt = `Erstelle 15 hochwertige Karteikarten aus dem Lernstoff für "${sessionMeta.name}".

Regeln:
- Vorderseite: präzise Frage oder Begriff (max 2 Zeilen)
- Rückseite: vollständige Antwort/Erklärung mit dem Kerninhalt (2–4 Sätze)
- Mix aus: Begriffsdefinitionen, Konzeptfragen, Formelanwendungen, Zusammenhängen
- Keine trivialen Fragen; echtes Verständnis prüfen
- Formeln in LaTeX ($$...$$)

Antworte NUR als JSON-Array:
[{"front":"Frage oder Begriff","back":"Vollständige Antwort/Erklärung"},...]`;

  try {
    const raw  = await claudeLocal(
      [{ role: 'user', content: 'Karteikarten erstellen.' }],
      sysBlocks(prompt), 2500,
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Karten erkannt');
    const parsed = JSON.parse(m[0]).filter(c => c.front && c.back);
    const existing = await DB.cards(sessionId);
    const newCards = parsed.map(c => ({
      front: c.front, back: c.back,
      interval: 1, ef: 2.5, repetitions: 0, due: Date.now(),
    }));
    await DB.setCards(sessionId, [...existing, ...newCards]);
    await initKarten();
  } catch (e) {
    showKartenState(document.getElementById('karten-idle'));
    alert('Fehler: ' + e.message);
  }
}

async function startReview() {
  const cards = await DB.cards(sessionId);
  reviewQueue = cards.filter(c => c.due <= Date.now());
  if (!reviewQueue.length) { await initKarten(); return; }
  reviewIdx   = 0;
  reviewStats = { again: 0, hard: 0, good: 0, easy: 0 };
  showKartenState(document.getElementById('karten-review'));
  showCard();
}

function showCard() {
  const card   = reviewQueue[reviewIdx];
  const total  = reviewQueue.length;
  const pct    = Math.round(reviewIdx / total * 100);

  document.getElementById('karten-counter').textContent = `${reviewIdx + 1} / ${total}`;
  document.getElementById('karten-progress-fill').style.width = pct + '%';
  document.getElementById('card-front-text').innerHTML = safeHtml(md(card.front));
  document.getElementById('card-back-text').innerHTML  = safeHtml(md(card.back));

  const flip = document.getElementById('card-flip');
  flip.classList.remove('flipped');
  document.getElementById('card-flip-btn').classList.remove('hidden');
  document.getElementById('card-grade-row').classList.add('hidden');
}

document.getElementById('card-flip-btn').addEventListener('click', () => {
  document.getElementById('card-flip').classList.add('flipped');
  document.getElementById('card-flip-btn').classList.add('hidden');
  document.getElementById('card-grade-row').classList.remove('hidden');
  haptic(10);
});

document.querySelectorAll('.grade-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const grade = parseInt(btn.dataset.grade, 10);
    haptic(grade >= 2 ? 40 : [60, 30, 60]);
    const keys = ['again','hard','good','easy'];
    reviewStats[keys[grade]]++;

    const cards   = await DB.cards(sessionId);
    const cardIdx = cards.findIndex(c => c.id === reviewQueue[reviewIdx].id);
    if (cardIdx >= 0) {
      srsUpdate(cards[cardIdx], grade);
      await DB.setCards(sessionId, cards);
      touchStreak();
    }

    reviewIdx++;
    if (reviewIdx >= reviewQueue.length) {
      endReview();
    } else {
      showCard();
    }
  });
});

function endReview() {
  const total = reviewQueue.length;
  const good  = reviewStats.good + reviewStats.easy;
  const pct   = Math.round(good / total * 100);

  document.getElementById('karten-done-title').textContent =
    pct >= 80 ? '🌟 Ausgezeichnet!' : pct >= 60 ? '👍 Gut gemacht!' : '💪 Weiter üben!';
  document.getElementById('karten-done-stats').innerHTML = `
    <div class="done-stat-row">
      <span class="done-stat">😄 Einfach: ${reviewStats.easy}</span>
      <span class="done-stat">🙂 Gut: ${reviewStats.good}</span>
      <span class="done-stat">😕 Schwer: ${reviewStats.hard}</span>
      <span class="done-stat">😵 Nochmal: ${reviewStats.again}</span>
    </div>
    <div class="done-pct" style="color:${pct>=70?'var(--green)':pct>=50?'var(--yellow)':'var(--red)'}">${pct}% gewusst</div>`;
  showKartenState(document.getElementById('karten-done'));
}

document.getElementById('karten-gen-btn').addEventListener('click', generateKarten);
document.getElementById('karten-review-btn').addEventListener('click', startReview);
document.getElementById('karten-done-btn').addEventListener('click', initKarten);

// ══ DASHBOARD ════════════════════════════════════════════════════════════

async function initDashboard() {
  const el = document.getElementById('panel-dashboard');
  if (!el) return;
  el.innerHTML = '<div class="dash-loading">Lädt…</div>';

  const stats = await DB.stats(sessionId);
  if (!stats) { el.innerHTML = '<div class="dash-loading">Keine Daten verfügbar.</div>'; return; }

  const { quizCount, avgScore, quizHistory, cardsTotal, cardsDue, docCount, messageCount } = stats;

  const scoreColor = p => p >= 70 ? 'var(--green)' : p >= 50 ? 'var(--yellow)' : 'var(--red)';

  // Chart data
  const labels = quizHistory.map((_, i) => `#${i + 1}`);
  const scores = quizHistory.map(q => q.pct);

  el.innerHTML = `
    <div class="dash-content">
      <div class="dash-kpi-row">
        <div class="dash-kpi">
          <div class="dash-kpi-val" style="color:${scoreColor(avgScore)}">${avgScore}%</div>
          <div class="dash-kpi-lbl">Ø Quiz-Score</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val">${quizCount}</div>
          <div class="dash-kpi-lbl">Quizfragen</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val" style="color:${cardsDue > 0 ? 'var(--red)' : 'var(--green)'}">${cardsDue}</div>
          <div class="dash-kpi-lbl">Karten fällig</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val">${cardsTotal}</div>
          <div class="dash-kpi-lbl">Karten gesamt</div>
        </div>
      </div>
      <div class="dash-kpi-row">
        <div class="dash-kpi">
          <div class="dash-kpi-val">${docCount}</div>
          <div class="dash-kpi-lbl">Dokumente</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val">${messageCount}</div>
          <div class="dash-kpi-lbl">Chat-Nachrichten</div>
        </div>
      </div>
      ${scores.length >= 2 ? `
      <div class="dash-chart-wrap">
        <div class="dash-chart-title">Quiz-Verlauf</div>
        <canvas id="dash-chart" height="130"></canvas>
      </div>` : '<div class="dash-empty">Noch zu wenige Quizdaten für einen Verlauf.</div>'}
    </div>`;

  if (scores.length >= 2) {
    const ctx = document.getElementById('dash-chart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Score %',
          data: scores,
          borderColor: '#5856d6',
          backgroundColor: 'rgba(88,86,214,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
        }],
      },
      options: {
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v + '%' } },
          x: { grid: { display: false } },
        },
        plugins: { legend: { display: false } },
        animation: false,
      },
    });
  }
}

// ══ INIT ══════════════════════════════════════════════════════════════════
(async () => {
  await initDarkMode();
  renderStreak();
  // API key now stored on server — go straight to subjects
  showScreen('subjects-screen');
  loadSubjects();
})();

// ── Service Worker ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
