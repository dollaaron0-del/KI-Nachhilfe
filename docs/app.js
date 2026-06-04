'use strict';

// ── Global error safety net ───────────────────────────────────────────────
window.addEventListener('error', e => {
  console.error('App error:', e.message, e.filename, e.lineno);
  // Only show auth if no screen is visible (blank screen), not on every JS error
  try {
    if (!document.querySelector('.screen.active')) showScreen('auth-screen');
  } catch (_) {}
});
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise:', e.reason);
  try {
    if (!document.querySelector('.screen.active')) showScreen('auth-screen');
  } catch (_) {}
});

// ── AI Progress simulation ────────────────────────────────────────────────
function startProgress(barId, pctId, durationMs = 20000) {
  const bar = document.getElementById(barId);
  const pct = document.getElementById(pctId);
  if (!bar || !pct) return () => {};
  let current = 0;
  // Disable CSS transition during increments so each tick shows immediately
  bar.style.transition = 'none';
  bar.style.width = '0%'; pct.textContent = '0%';
  // Decay factor: reaches ~80% at durationMs, ~60% at half of durationMs
  const TICK = 200;
  const ticks = Math.max(durationMs / TICK, 1);
  const f = 1 - Math.pow(1 / 9, 1 / ticks);
  const timer = setInterval(() => {
    current += (90 - current) * f;
    if (current > 89) current = 89;
    bar.style.width = current.toFixed(1) + '%';
    pct.textContent = Math.round(current) + '%';
  }, TICK);
  return () => {
    clearInterval(timer);
    // Smooth slide to 100% instead of hard jump
    bar.style.transition = 'width 0.5s ease-out';
    bar.style.width = '100%'; pct.textContent = '100%';
    setTimeout(() => { bar.style.transition = 'none'; }, 600);
  };
}

function setUploadProgress(barEl, pctEl, value) {
  if (!barEl || !pctEl) return;
  barEl.style.width = value + '%';
  pctEl.textContent = value + '%';
}

// ── Toast notifications ────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { error: '⚠️', success: '✅', info: 'ℹ️', warn: '⚠️' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(el);
  const remove = () => {
    el.classList.add('hiding');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ── PDF.js worker ──────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Mermaid ────────────────────────────────────────────────────────────────
mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });

// ── Constants ──────────────────────────────────────────────────────────────
const ICONS  = ['📐','📊','🧪','🔬','🧬','📚','🖥️','⚖️','💰','🌍','🎨','🎵','🏥','🏛️','✈️','🔧','📡','🧮','⚗️','🔭','🤖','🧠','💡','🎯','🌱','🏋️'];
const COLORS = ['#5856d6','#007aff','#34c759','#ff9500','#ff3b30','#ff2d55','#30b0c7','#a2845e'];

// ── Auth ───────────────────────────────────────────────────────────────────
let authToken    = localStorage.getItem('auth_token')    || '';
let authUsername = localStorage.getItem('auth_username') || '';
let authIsAdmin  = localStorage.getItem('auth_is_admin') === '1';
let authMode = 'login';

function authHeaders() {
  return authToken ? { 'content-type': 'application/json', 'authorization': `Bearer ${authToken}` }
                   : { 'content-type': 'application/json' };
}

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('auth-tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('auth-tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('auth-submit-btn').textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen';
  document.getElementById('auth-error').classList.add('hidden');
}

let approvalPollInterval = null;

function stopApprovalPolling() {
  if (approvalPollInterval) { clearInterval(approvalPollInterval); approvalPollInterval = null; }
}

function startApprovalPolling(username, password) {
  stopApprovalPolling();
  approvalPollInterval = setInterval(async () => {
    try {
      const r = await fetch(`/api/auth/approval-status?username=${encodeURIComponent(username)}`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data.approved) return;
      stopApprovalPolling();
      // Auto-login with stored credentials
      const lr = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!lr.ok) return;
      const ld = await lr.json();
      authToken    = ld.token;
      authUsername = ld.username;
      authIsAdmin  = ld.is_admin || false;
      localStorage.setItem('auth_token',    authToken);
      localStorage.setItem('auth_username', authUsername);
      localStorage.setItem('auth_is_admin', authIsAdmin ? '1' : '0');
      toast('✅ Dein Konto wurde freigeschaltet!', 'success', 4000);
      onAuthSuccess();
    } catch (_) {}
  }, 10000);
}

document.getElementById('auth-submit-btn')?.addEventListener('click', async () => {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');
  if (!username || !password) { errEl.textContent = 'Bitte alle Felder ausfüllen.'; errEl.classList.remove('hidden'); return; }
  try {
    stopApprovalPolling();
    document.getElementById('auth-submit-btn').textContent = '…';
    const r = await fetch(`/api/auth/${authMode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (r.status === 202 && data.pending) {
      errEl.style.color = '#34c759';
      errEl.textContent = '⏳ ' + data.message;
      errEl.classList.remove('hidden');
      switchAuthTab(authMode);
      startApprovalPolling(username, password);
      return;
    }
    errEl.style.color = '';
    if (!r.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); switchAuthTab(authMode); return; }
    authToken    = data.token;
    authUsername = data.username;
    authIsAdmin  = data.is_admin || false;
    localStorage.setItem('auth_token',    authToken);
    localStorage.setItem('auth_username', authUsername);
    localStorage.setItem('auth_is_admin', authIsAdmin ? '1' : '0');
    onAuthSuccess();
  } catch (e) { errEl.textContent = 'Verbindungsfehler.'; errEl.classList.remove('hidden'); switchAuthTab(authMode); }
});

['auth-username','auth-password'].forEach(id =>
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-submit-btn')?.click();
  })
);

document.getElementById('btn-logout')?.addEventListener('click', () => {
  authToken = ''; authUsername = '';
  localStorage.removeItem('auth_token'); localStorage.removeItem('auth_username');
  showScreen('auth-screen');
});

function onAuthSuccess() {
  document.getElementById('auth-username-badge').textContent = '👤 ' + authUsername;
  const adminPanel = document.getElementById('admin-panel');
  if (adminPanel) adminPanel.classList.toggle('hidden', !authIsAdmin);
  showScreen('setup-screen');
  if (authIsAdmin) loadUsage();
  loadSubjects();
}

async function checkAuth() {
  if (!authToken) { showScreen('auth-screen'); return; }
  try {
    const r = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${authToken}` } });
    if (!r.ok) { authToken = ''; localStorage.removeItem('auth_token'); showScreen('auth-screen'); return; }
    const data = await r.json();
    authUsername = data.username;
    authIsAdmin  = data.is_admin || false;
    localStorage.setItem('auth_username', authUsername);
    localStorage.setItem('auth_is_admin', authIsAdmin ? '1' : '0');
    onAuthSuccess();
  } catch { showScreen('auth-screen'); }
}

// ── State ──────────────────────────────────────────────────────────────────
let sessionId      = null;
let sessionMeta    = null;
let sessionTxt     = '';
let customPrompt   = '';
let selIcon      = ICONS[0];
let selColor     = COLORS[0];
let selDiff      = 'mittel';
let selAufgabenDiff = 'mittel';
let examAnsVis   = false;
let blitzIdx       = 0;
let blitzResults   = [];
let scannedTopics  = [];
let selTopic       = null;
let selAufgabenType = 'uebung';
let aufgabenAnsVis  = false;
let currentAufgabe  = '';
let currentCheatText     = '';
let currentAufgabenResult = '';
let currentExamText      = '';
let learnedTopics        = [];
let currentExplainerTopic = null;
let rechnenDiff     = 'mittel';
let mathCtx         = null;
let isDrawingCanvas = false;
let isErasing       = false;
let canvasLastX     = 0, canvasLastY = 0;
let undoStack       = [];
let redoStack       = [];
let savedCanvasData = null;
let penColor        = '#1c1c1e';
let penSize         = 'medium';   // 'fine' | 'medium' | 'thick'
let activeTool      = 'pen';      // 'pen' | 'eraser' | 'highlighter' | 'line'
let linePreviewData = null;

// ── DB (server-backed) ────────────────────────────────────────────────────
const api = (url, opts = {}) =>
  fetch(url, {
    headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
    ...opts,
  }).then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }));

const DB = {
  // ── Server ──────────────────────────────────────────────────────────────
  subjects:     () => api('/api/subjects').catch(() => []),
  addSubject:   s  => api('/api/subjects', { method: 'POST', body: JSON.stringify({ id: s.id, name: s.name, emoji: s.icon || s.emoji || '📚', color: s.color || '#5856d6' }) }),
  delSubject:   id => fetch(`/api/subjects/${id}`, { method: 'DELETE', headers: authHeaders() }),

  messages:     id => api(`/api/subjects/${id}/messages`).catch(() => []),
  addMessage:   (id, role, content) => fetch(`/api/subjects/${id}/messages`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ role, content }),
  }).catch(() => {}),
  clearMessages: id => fetch(`/api/subjects/${id}/messages`, { method: 'DELETE', headers: authHeaders() }),

  cards:    id    => api(`/api/subjects/${id}/cards`).catch(() => []),
  setCards: (id, cards) => api(`/api/subjects/${id}/cards`, {
    method: 'POST', body: JSON.stringify({ cards }),
  }),

  addQuizResult: (id, score, total) => fetch(`/api/subjects/${id}/quiz`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ score, total }),
  }).catch(() => {}),
  quizResults: id => api(`/api/subjects/${id}/quiz`).catch(() => []),

  streak: async () => {
    try { const s = await api('/api/streak'); return { count: s.count, lastDate: s.last_date }; }
    catch { return { count: 0, lastDate: null }; }
  },
  setStreak: v => fetch('/api/streak', {
    method: 'POST', headers: authHeaders(),
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

  savedAufgaben: id => api(`/api/subjects/${id}/aufgaben`).catch(() => []),
  saveAufgabe: (id, entry) => fetch(`/api/subjects/${id}/aufgaben`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify(entry),
  }).catch(() => {}),
  delAufgabe: (id, entryId) => fetch(`/api/subjects/${id}/aufgaben/${entryId}`, {
    method: 'DELETE', headers: authHeaders(),
  }).catch(() => {}),

  async del(id) {
    await Promise.all([
      this.delSubject(id),
      localforage.removeItem(`meta_${id}`),
      localforage.removeItem(`cnt_${id}`),
      fetch(`/api/subjects/${id}/cheat`,  { method: 'DELETE', headers: authHeaders() }).catch(() => {}),
      fetch(`/api/subjects/${id}/topics`, { method: 'DELETE', headers: authHeaders() }).catch(() => {}),
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
function friendlyApiError(errStr, status) {
  if (status === 529 || (errStr && errStr.includes('overloaded')))
    return 'Claude ist gerade überlastet – bitte kurz warten und erneut versuchen.';
  if (status === 429 || (errStr && errStr.includes('Tageslimit')))
    return errStr || 'Tageslimit erreicht.';
  return errStr || `Serverfehler ${status}`;
}

async function claude(messages, systemBlocks, maxTokens = 1500) {
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens, subject_id: sessionId }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(friendlyApiError(e.error, r.status));
  }
  return (await r.json()).content[0].text;
}

// ── Haiku for simple generation tasks (12x cheaper than Sonnet) ──────────
async function claudeHaiku(messages, systemBlocks, maxTokens = 600) {
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      messages, system: systemBlocks, max_tokens: maxTokens,
      model: 'claude-haiku-4-5-20251001', subject_id: sessionId,
    }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(friendlyApiError(e.error, r.status)); }
  return (await r.json()).content[0].text;
}

// ── Local model via Ollama (free, for batch tasks) ────────────────────────
async function claudeLocal(messages, systemBlocks, maxTokens = 2000) {
  const r = await fetch('/api/local', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

async function claudeLocalStream(messages, systemBlocks, maxTokens = 3000, onToken) {
  const r = await fetch('/api/local/stream', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error(`Serverfehler ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (d === '[DONE]') return full;
      try {
        const parsed = JSON.parse(d);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.token) { full += parsed.token; onToken(full); }
      } catch (e) { if (e.message) throw e; }
    }
  }
  return full;
}

// ── Local vision via Ollama (falls back to cloud if model not available) ──
async function claudeLocalVision(base64, textPrompt, systemBlocks, maxTokens = 1500) {
  try {
    const r = await fetch('/api/local/vision', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ base64, media_type: 'image/png', text: textPrompt,
                             system: systemBlocks, max_tokens: maxTokens }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`);
    return (await r.json()).content[0].text;
  } catch {
    return claudeVision(base64, textPrompt, systemBlocks, maxTokens);
  }
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
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

// ── PDF Extraction ─────────────────────────────────────────────────────────
async function extractPDF(file, onProgress) {
  const ab  = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text  = `\n\n=== ${file.name} ===\n`;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
    if (onProgress) onProgress(i, pdf.numPages);
  }
  return { text: text.trim(), pages: pdf.numPages, name: file.name };
}

// ── System prompt builder ──────────────────────────────────────────────────
function sysBlocks(extra = '') {
  return [
    {
      type: 'text',
      text: `Du bist ein erfahrener Nachhilfelehrer für das Fach "${sessionMeta?.name || ''}". Du verwendest gezielt moderne lernpsychologische Methoden.

WICHTIG – QUELLENREGEL:
Beantworte Fragen AUSSCHLIESSLICH auf Basis der bereitgestellten Unterlagen und der persönlichen Anweisungen des Studenten.
Nutze KEIN Allgemeinwissen, keine Lehrbücher und keine Informationen aus dem Internet.
Wenn eine Frage mit den vorhandenen Unterlagen nicht beantwortet werden kann, sage klar: "Das steht so nicht in deinen Unterlagen – lade bitte das entsprechende Dokument hoch."
Halte dich bei Erklärungen an die Formulierungen und Definitionen aus den Unterlagen, da der Dozent diese Art der Darstellung in Prüfungen erwartet.

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

--- UNTERLAGEN (einzige erlaubte Wissensquelle) ---
${sessionTxt ? sessionTxt.slice(0, 6000) + (sessionTxt.length > 6000 ? '\n[…gekürzt]' : '') : '(noch keine Dokumente hochgeladen – weise den Studenten darauf hin, Unterlagen hochzuladen)'}
--- ENDE DER UNTERLAGEN ---

DIAGRAMME: Wenn es das Verständnis fördert, erstelle Mermaid-Diagramme in \`\`\`mermaid ... \`\`\` Blöcken.
Verfügbare Typen: flowchart TD (Abläufe/Strukturen), mindmap (Konzepte), sequenceDiagram (Prozesse/Interaktionen).
Halte Diagramme einfach – max. 8 Knoten. Nur einsetzen wenn es wirklich hilft.

MATHEMATIK: Für mathematische Formeln und Gleichungen verwende LaTeX-Notation.
Inline-Formeln: $E = mc^2$  |  Block-Formeln (zentriert, groß): $$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$
Verwende LaTeX immer wenn Formeln, Gleichungen, Summen, Integrale, Matrizen oder griechische Buchstaben vorkommen.

Antworte immer auf Deutsch.${customPrompt ? '\n\n--- PERSÖNLICHE ANWEISUNGEN DES STUDENTEN ---\n' + customPrompt + '\n--- ENDE ---' : ''}${extra ? '\n\n' + extra : ''}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

// ── Dark Mode ──────────────────────────────────────────────────────────────
async function initDarkMode() {
  try {
    const dark = await DB.darkMode();
    applyDarkMode(dark === true);
  } catch (_) {
    applyDarkMode(false);
  }
}

function applyDarkMode(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('btn-dark-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

document.getElementById('btn-dark-toggle')?.addEventListener('click', async () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyDarkMode(!isDark);
  await DB.setDarkMode(!isDark);
});

// ── Screens ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sheet-overlay').forEach(o => o.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  else document.querySelector('.screen')?.classList.add('active');
}

// ══ SETUP SCREEN ══════════════════════════════════════════════════════════

document.getElementById('save-key-btn')?.addEventListener('click', saveApiKey);

async function saveApiKey() {
  // Legacy: kept for compatibility, but no API key needed when using server
  showScreen('subjects-screen');
  loadSubjects();
}


async function loadUsage() {
  try {
    const u = await api('/api/usage');
    if (!u.is_admin) return;
    const pct = Math.min(100, (u.today.cost_eur / u.limit_eur) * 100);
    const color = pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--yellow)' : 'var(--green)';
    document.getElementById('usage-cost').textContent = `${u.today.cost_eur.toFixed(3)}€`;
    document.getElementById('usage-cost').style.color = color;
    document.getElementById('usage-limit').textContent = `${u.limit_eur.toFixed(2)}€ / Tag`;
    document.getElementById('usage-bar').style.width = pct + '%';
    document.getElementById('usage-bar').style.background = color;
    const inp = document.getElementById('admin-limit-input');
    if (inp && !inp.value) inp.value = u.limit_eur.toFixed(2);
  } catch { /* ignore */ }
}

document.getElementById('admin-set-limit-btn')?.addEventListener('click', async () => {
  const val = parseFloat(document.getElementById('admin-limit-input')?.value);
  if (isNaN(val) || val <= 0) { toast('Ungültiger Betrag', 'error'); return; }
  try {
    await api('/api/admin/set-limit', { method: 'POST', body: JSON.stringify({ limit: val }) });
    toast(`Tageslimit auf ${val.toFixed(2)}€ gesetzt`, 'success');
    loadUsage();
  } catch (e) { toast(e.message, 'error'); }
});

// ── Admin user management ──────────────────────────────────────────────────
document.getElementById('admin-users-btn')?.addEventListener('click', () => {
  document.getElementById('admin-users-sheet').classList.remove('hidden');
  loadAdminUsers();
});
document.getElementById('admin-users-bg')?.addEventListener('click', () => {
  document.getElementById('admin-users-sheet').classList.add('hidden');
});

async function loadAdminUsers() {
  const list = document.getElementById('admin-users-list');
  list.innerHTML = '<p style="color:var(--label-secondary);text-align:center;">Lädt…</p>';
  try {
    const users = await api('/api/admin/users');
    list.innerHTML = '';
    users.forEach(u => list.appendChild(buildUserRow(u)));
  } catch (e) {
    list.innerHTML = `<p style="color:var(--red);">${e.message}</p>`;
  }
}

function buildUserRow(u) {
  const isSelf = u.username === authUsername;
  const div = document.createElement('div');
  div.id = `user-row-${u.id}`;
  div.style.cssText = 'background:var(--surface);border-radius:12px;padding:12px 14px;';

  const statusColor = u.approved ? 'var(--green)' : 'var(--yellow)';
  const statusText  = u.approved ? '✅ Aktiv' : '⏳ Ausstehend';
  const adminBadge  = u.is_admin ? '<span style="font-size:11px;background:var(--purple);color:#fff;border-radius:6px;padding:2px 7px;margin-left:6px;">Admin</span>' : '';
  const selfBadge   = isSelf    ? '<span style="font-size:11px;background:var(--blue);color:#fff;border-radius:6px;padding:2px 7px;margin-left:6px;">Du</span>' : '';

  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <span style="font-weight:700;font-size:15px;">👤 ${u.username}</span>${adminBadge}${selfBadge}
      </div>
      <span style="font-size:12px;color:${statusColor};font-weight:600;">${statusText}</span>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
      ${!u.approved ? `<button class="btn-secondary" style="font-size:13px;padding:5px 12px;" onclick="adminApprove(${u.id})">✅ Freischalten</button>` : ''}
      ${!isSelf ? `<button class="btn-secondary" style="font-size:13px;padding:5px 12px;" onclick="adminToggleAdmin(${u.id},${!u.is_admin})">${u.is_admin ? '⬇️ Admin entfernen' : '⬆️ Admin machen'}</button>` : ''}
      ${!isSelf ? `<button class="btn-secondary" style="font-size:13px;padding:5px 12px;color:var(--red);" onclick="adminDeleteUser(${u.id},'${u.username}')">🗑 Löschen</button>` : ''}
    </div>`;
  return div;
}

async function adminApprove(id) {
  try {
    const r = await api(`/api/admin/users/${id}/approve`, { method: 'POST' });
    toast(`${r.username} wurde freigeschaltet`, 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function adminToggleAdmin(id, makeAdmin) {
  try {
    const r = await api(`/api/admin/users/${id}/admin`, {
      method: 'PATCH', body: JSON.stringify({ is_admin: makeAdmin }),
    });
    toast(`${r.username} ist jetzt ${r.is_admin ? 'Admin' : 'kein Admin mehr'}`, 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function adminDeleteUser(id, username) {
  if (!confirm(`Benutzer "${username}" wirklich löschen? Alle Daten werden entfernt.`)) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    toast(`${username} gelöscht`, 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

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
  // Use server-side counts (doc_count/quiz_count) with fallback to local fields
  const docCount  = s.doc_count  ?? s.fileCount  ?? 0;
  const quizCount = s.quiz_count ?? s.quizCount  ?? 0;
  const avgScore  = s.avg_score  ?? s.lastScore  ?? null;
  const meta = docCount
    ? `${docCount} Dok. · ${quizCount ? quizCount + ' Fragen' : 'kein Quiz'}`
    : 'Noch keine Dokumente';
  const scoreHtml = avgScore !== null
    ? `<span class="card-score" style="background:${scoreColor(avgScore)}">${avgScore}%</span>` : '';
  div.innerHTML = `
    <button class="card-del" data-id="${s.id}">×</button>
    <div class="card-icon">${s.emoji || s.icon || '📚'}</div>
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

document.getElementById('btn-new-subject')?.addEventListener('click', showSubjModal);
document.getElementById('btn-first-subject')?.addEventListener('click', showSubjModal);

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
  const btn = document.getElementById('subj-create-btn');
  btn.disabled = false;
  btn.textContent = 'Fach erstellen';
  document.getElementById('subj-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('subj-name').focus(), 350);
}

document.getElementById('subj-modal-bg')?.addEventListener('click', () =>
  document.getElementById('subj-modal').classList.add('hidden'));

document.getElementById('subj-create-btn')?.addEventListener('click', createSubject);
document.getElementById('subj-name')?.addEventListener('keydown', e => {
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

    btn.disabled = false;
    btn.textContent = 'Fach erstellen';
    document.getElementById('subj-modal').classList.add('hidden');
    await openSubject(subj);
  } catch (e) {
    toast('Fehler beim Erstellen: ' + e.message, 'error');
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
  customPrompt = subj.custom_prompt || '';
  scannedTopics = await api(`/api/subjects/${subj.id}/topics`).catch(() => []);
  learnedTopics = await api(`/api/subjects/${subj.id}/learned-topics`).catch(() => []);
  selTopic = null;
  currentAufgabe = ''; savedCanvasData = null; mathCtx = null; undoStack = [];

  document.getElementById('header-label').textContent = `${subj.emoji || subj.icon || '📚'}  ${subj.name}`;
  const appHeader = document.querySelector('.app-header');
  if (appHeader && subj.color) appHeader.style.borderTopColor = subj.color;
  updateHeaderPages();

  const q = sessionMeta.quizStats.questions;
  const sc = q.reduce((a, x) => a + x.score, 0);
  if (q.length) { Object.assign(window, { quizTotal: q.length, quizScore: sc }); }
  else { Object.assign(window, { quizTotal: 0, quizScore: 0 }); }
  updateScoreChip();

  document.getElementById('chat-messages').innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">${subj.emoji || subj.icon || '📚'}</div>
      <p>Stelle mir Fragen zu <strong>${esc(subj.name)}</strong>.<br>Ich erkläre alles geduldig!</p>
    </div>`;

  const noFiles = !sessionMeta.files.length;
  document.getElementById('no-docs-banner').classList.toggle('hidden', !noFiles);
  updatePruefungsnahBtns();

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
  updateSettingsBadge();

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

// ══ SETTINGS SHEET ═════════════════════════════════════════════════════════

document.getElementById('btn-settings')?.addEventListener('click', () => {
  document.getElementById('custom-prompt-ta').value = customPrompt;
  document.getElementById('settings-sheet').classList.remove('hidden');
});
document.getElementById('settings-bg')?.addEventListener('click', () =>
  document.getElementById('settings-sheet').classList.add('hidden'));
document.getElementById('settings-close-btn')?.addEventListener('click', () =>
  document.getElementById('settings-sheet').classList.add('hidden'));
document.getElementById('settings-save-btn')?.addEventListener('click', async () => {
  const val = document.getElementById('custom-prompt-ta').value.trim();
  try {
    await fetch(`/api/subjects/${sessionId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ custom_prompt: val }),
    });
    customPrompt = val;
    document.getElementById('settings-sheet').classList.add('hidden');
    toast('Anweisungen gespeichert.', 'success');
    updateSettingsBadge();
  } catch (e) {
    toast('Fehler beim Speichern: ' + e.message, 'error');
  }
});

function updateSettingsBadge() {
  const btn = document.getElementById('btn-settings');
  let badge = btn.querySelector('.settings-active-badge');
  if (customPrompt && !badge) {
    badge = document.createElement('span');
    badge.className = 'settings-active-badge';
    btn.appendChild(badge);
  } else if (!customPrompt && badge) {
    badge.remove();
  }
}

// ══ UPLOAD SHEET ═══════════════════════════════════════════════════════════

document.getElementById('back-btn')?.addEventListener('click', () => {
  sessionId = null; sessionMeta = null; sessionTxt = ''; customPrompt = '';
  showScreen('subjects-screen'); loadSubjects();
});
document.getElementById('btn-add-docs')?.addEventListener('click', showUploadSheet);
document.getElementById('no-docs-btn')?.addEventListener('click', showUploadSheet);
document.getElementById('upload-bg')?.addEventListener('click', hideUploadSheet);

function showUploadSheet() {
  document.getElementById('upload-status').classList.add('hidden');
  document.getElementById('upload-progress').classList.add('hidden');
  document.getElementById('upload-title').textContent =
    sessionMeta ? `Dokumente für "${sessionMeta.name}"` : 'Dokumente hochladen';
  document.getElementById('upload-sheet').classList.remove('hidden');
  renderDocList();
}

function hideUploadSheet() {
  document.getElementById('upload-sheet').classList.add('hidden');
}

async function renderDocList() {
  const wrap = document.getElementById('doc-list-wrap');
  const list = document.getElementById('doc-list');
  if (!sessionId) return;

  const docs = await api(`/api/subjects/${sessionId}/documents`).catch(() => []);
  if (!docs.length) { wrap.classList.add('hidden'); return; }

  wrap.classList.remove('hidden');
  list.innerHTML = '';
  docs.forEach(doc => {
    const date = new Date(doc.uploaded_at).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
    const row = document.createElement('div');
    row.className = 'doc-row';
    row.innerHTML = `
      <div class="doc-row-info">
        <span class="doc-row-icon">📄</span>
        <div>
          <div class="doc-row-name">${esc(doc.filename)}</div>
          <div class="doc-row-date">${date}</div>
        </div>
      </div>
      <button class="doc-del-btn" title="Löschen">🗑</button>`;
    row.querySelector('.doc-del-btn').addEventListener('click', async () => {
      if (!confirm(`"${doc.filename}" löschen?`)) return;
      await fetch(`/api/subjects/${sessionId}/documents/${doc.id}`, { method: 'DELETE', headers: authHeaders() });
      renderDocList();
    });
    list.appendChild(row);
  });
}

document.getElementById('upload-input')?.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if (files.length) handleUpload(files);
  e.target.value = '';
});

const dropZone = document.getElementById('drop-zone');
dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone?.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const pdfs = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  if (pdfs.length) handleUpload(pdfs);
});

async function handleUpload(files) {
  const prog    = document.getElementById('upload-progress');
  const status  = document.getElementById('upload-status');
  const label   = document.getElementById('upload-prog-label');
  const bar     = document.getElementById('upload-prog-bar');
  const pct     = document.getElementById('upload-prog-pct');
  prog.classList.remove('hidden'); status.classList.add('hidden');

  try {
    let added = ''; const newFiles = [];
    for (let i = 0; i < files.length; i++) {
      const fileLabel = files.length > 1 ? `${files[i].name} (${i + 1}/${files.length})` : files[i].name;
      label.textContent = `Verarbeite ${fileLabel}…`;
      bar.style.width = '0%'; pct.textContent = '0%';
      const { text, pages, name } = await extractPDF(files[i], (done, total) => {
        const p = Math.round((done / total) * 100);
        bar.style.width = p + '%'; pct.textContent = p + '%';
      });
      added += '\n\n' + text;
      newFiles.push({ name, pages, uploadedAt: new Date().toISOString() });
      // Save to server for RAG + auto-card generation
      fetch(`/api/subjects/${sessionId}/documents/text`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ filename: name, content: text }),
      }).catch(() => {});
    }
    sessionTxt = (sessionTxt || '') + added;
    sessionMeta.files = [...(sessionMeta.files || []), ...newFiles];
    sessionMeta.updatedAt = new Date().toISOString();
    updatePruefungsnahBtns();
    renderRechnenDocs();

    if (scannedTopics.length) {
      scannedTopics = [];
      fetch(`/api/subjects/${sessionId}/topics`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
    }

    await Promise.all([DB.setContent(sessionId, sessionTxt), DB.setMeta(sessionId, sessionMeta)]);

    prog.classList.add('hidden');
    status.textContent = `✓ ${newFiles.map(f => f.name).join(', ')} hochgeladen · Karteikarten werden generiert…`;
    status.className = 'sheet-status success';
    status.classList.remove('hidden');
    updateHeaderPages();
    document.getElementById('no-docs-banner').classList.add('hidden');
    renderDocList();
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
  // Save canvas if it's been initialized
  if (mathCtx) {
    const canvas = document.getElementById('math-canvas');
    if (canvas) {
      savedCanvasData = canvas.toDataURL('image/png');
      localforage.setItem(`canvas_${sessionId}`, savedCanvasData).catch(() => {});
    }
  }
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${mode}`));
  if (mode === 'ueben')    { activateSubpanel('panel-ueben', 'aufgaben-content'); initAufgaben(); }
  if (mode === 'karten')   initKarten();
  if (mode === 'exam')     { loadSavedKlausuren(); updateExamRecBanner(); }
  if (mode === 'material') { activateSubpanel('panel-material', 'cheat'); loadSavedCheat(); }
  if (mode === 'lernen')   initLernen();
  if (mode === 'analyse')  refreshAnalysisState();
}

function switchToAnalysis() {
  switchMode('analyse');
}

function switchToLoesen() {
  switchMode('ueben');
  activateSubpanel('panel-ueben', 'loesen-content');
  initRechnen();
}

function activateSubpanel(panelId, subId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.querySelectorAll('.subpanel-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === subId));
  panel.querySelectorAll('.subpanel').forEach(p => p.classList.toggle('hidden', p.dataset.subid !== subId));
}

// Sub-panel tab switching
document.querySelectorAll('.subpanel-nav').forEach(nav => {
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.subpanel-btn');
    if (!btn) return;
    const panelId = btn.closest('.panel').id;
    const sub = btn.dataset.sub;
    activateSubpanel(panelId, sub);
    if (sub === 'dashboard')       initDashboard();
    if (sub === 'fehler')          renderFehlerkatalog();
    if (sub === 'cheat')           loadSavedCheat();
    if (sub === 'glossar')         loadSavedGlossar();
    if (sub === 'aufgaben-content') initAufgaben();
    if (sub === 'loesen-content')   initRechnen();
  });
});

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

document.getElementById('chat-send')?.addEventListener('click', sendChat);
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
    const rephrase = await claudeLocal(rephrasePrompt, sysBlocks(), 1000);
    typ.remove();
    addMsg(chatMessages, 'assistant', rephrase, () => rephraseReply(rephrase));
  } catch (e) {
    typ.remove();
    addMsg(chatMessages, 'assistant', '⚠️ ' + e.message);
  }
}

document.getElementById('btn-diagram')?.addEventListener('click', () => {
  chatInput.value = 'Erkläre den aktuellen Sachverhalt als Mermaid-Diagramm (flowchart TD). Zeige Zusammenhänge, Abläufe oder Strukturen visuell.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('btn-mindmap')?.addEventListener('click', () => {
  chatInput.value = 'Erstelle eine Mermaid-Mind-Map (mindmap) zu dem Thema, das wir gerade besprochen haben. Zeige Hauptkonzept und alle wichtigen Unterthemen.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('btn-formula')?.addEventListener('click', () => {
  chatInput.value = 'Liste die wichtigsten Formeln zu dem Thema, das wir gerade besprochen haben. Schreibe jede Formel in LaTeX-Notation ($$...$$) und erkläre kurz was jede Variable bedeutet.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('chat-reset')?.addEventListener('click', async () => {
  sessionMeta.chatHistory = [];
  await DB.setMeta(sessionId, sessionMeta);
  chatMessages.innerHTML = `<div class="welcome"><div class="welcome-icon">🔄</div><p>Chat gelöscht.</p></div>`;
});

// ══ QUIZ ══════════════════════════════════════════════════════════════════

document.getElementById('quiz-start-btn')?.addEventListener('click', fetchQuestion);
document.getElementById('quiz-submit')?.addEventListener('click',    submitAnswer);
document.getElementById('quiz-next')?.addEventListener('click',      fetchQuestion);
document.getElementById('quiz-stop')?.addEventListener('click',      () => switchToAnalysis());
document.getElementById('quiz-answer')?.addEventListener('keydown',  e => { if (e.key === 'Enter' && e.ctrlKey) submitAnswer(); });
document.getElementById('quiz-reset-btn')?.addEventListener('click', async () => {
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
document.getElementById('quiz-blitz-btn')?.addEventListener('click', startBlitz);

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
    const q = await claudeLocal([{ role: 'user', content: 'Nächste Frage.' }], sysBlocks(prompt), 300);
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
    const raw = await claudeLocal(
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
    const raw = await claudeLocal([{ role: 'user', content: 'MC-Frage.' }], sysBlocks(blitzPrompt), 400);
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

document.getElementById('blitz-again-btn')?.addEventListener('click', startBlitz);
document.getElementById('blitz-stop-btn')?.addEventListener('click', () => switchToAnalysis());
document.getElementById('blitz-stop-btn2')?.addEventListener('click', () => switchToAnalysis());

// ══ EXAM ══════════════════════════════════════════════════════════════════

function hasExamDocs() {
  if (!sessionMeta?.files?.length) return false;
  const kw = ['klausur', 'altklausur', 'probeklausur', 'prüfung', 'exam'];
  return sessionMeta.files.some(f => kw.some(k => f.name.toLowerCase().includes(k)));
}

function updatePruefungsnahBtns() {
  const has = hasExamDocs();
  ['diff-pruefungsnah', 'adiff-pruefungsnah'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !has;
    btn.title = has ? '' : 'Lade zuerst Probe- oder Altklausuren hoch';
  });
}

document.querySelectorAll('.diff-btn').forEach(b => b.addEventListener('click', () => {
  selDiff = b.dataset.diff;
  document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

document.querySelectorAll('.diff-btn-a').forEach(b => b.addEventListener('click', () => {
  selAufgabenDiff = b.dataset.adiff;
  document.querySelectorAll('.diff-btn-a').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));
document.getElementById('exam-gen-btn')?.addEventListener('click', generateExam);
document.getElementById('exam-new-btn')?.addEventListener('click', () => {
  document.getElementById('exam-idle').classList.remove('hidden');
  document.getElementById('exam-result').classList.add('hidden');
  loadSavedKlausuren();
});
document.getElementById('exam-ans-btn')?.addEventListener('click', toggleExamAns);

async function loadSavedKlausuren() {
  const wrap = document.getElementById('exam-saved-wrap');
  const list = document.getElementById('exam-saved-list');
  if (!wrap || !list || !sessionId) return;
  try {
    const items = await api(`/api/subjects/${sessionId}/klausuren`);
    if (!items.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    list.innerHTML = '';
    const diffLabels = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer', pruefungsnah: '📋 Prüfungsnah', experte: '💪 Experte' };
    items.forEach(k => {
      const date = new Date(k.created_at).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
      const row = document.createElement('div');
      row.className = 'saved-aufg-row';
      row.innerHTML = `
        <div class="saved-aufg-info">
          <span class="saved-aufg-type">📋 Klausur</span>
          <span class="saved-aufg-topic">${esc(diffLabels[k.diff] || k.diff || '')}</span>
          <span class="saved-aufg-date">${date}</span>
        </div>
        <div class="saved-aufg-btns">
          <button class="btn-secondary btn-sm">Öffnen</button>
          <button class="btn-icon-sm saved-del-btn">🗑</button>
        </div>`;
      row.querySelector('.btn-secondary').addEventListener('click', () => restoreKlausur(k));
      row.querySelector('.saved-del-btn').addEventListener('click', async () => {
        await fetch(`/api/subjects/${sessionId}/klausuren/${k.id}`, { method: 'DELETE', headers: authHeaders() });
        loadSavedKlausuren();
      });
      list.appendChild(row);
    });
  } catch (_) {}
}

function restoreKlausur(k) {
  currentExamText = k.content;
  const body = document.getElementById('exam-body');
  const sepIdx = k.content.search(/---\s*\n+##\s*Lösungsschlüssel/i);
  if (sepIdx > -1) {
    body.innerHTML = safeHtml(md(k.content.slice(0, sepIdx)) +
      `<div class="ans-section">${md(k.content.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
  } else {
    body.innerHTML = safeHtml(md(k.content));
  }
  examAnsVis = false;
  body.closest('.exam-content').classList.add('answers-hidden');
  document.getElementById('exam-ans-btn').textContent = 'Lösungen anzeigen';
  document.getElementById('exam-idle').classList.add('hidden');
  document.getElementById('exam-result').classList.remove('hidden');
}

async function generateExam() {
  ['exam-idle','exam-result'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('exam-loading').classList.remove('hidden');
  const examDone = startProgress('exam-progress-bar', 'exam-progress-pct', 25000);
  examAnsVis = false;

  const diffInstructions = {
    leicht:       'Schwierigkeit: Leicht – Grundbegriffe, einfache Definitionen, direkte Fragen.',
    mittel:       'Schwierigkeit: Mittel – Verständnisfragen, einfache Anwendungen.',
    schwer:       'Schwierigkeit: Schwer – komplexe Anwendungen, Zusammenhänge erklären.',
    pruefungsnah: `Schwierigkeit: Prüfungsnah – orientiere dich STRIKT an den hochgeladenen Probe-/Altklausuren.
Analysiere deren Format, Aufgabentypen, Punkteverteilung und Formulierungsstil und bilde das so genau wie möglich nach.`,
    experte:      `Schwierigkeit: EXPERTE – bewusst schwerer als die echte Prüfung, um maximale Sicherheit aufzubauen.
Kombiniere mehrere Konzepte pro Aufgabe, teste Grenzfälle und Ausnahmen, verlange Transferdenken in ungewohnten Kontexten.
Zeitdruck: kompakter und dichter als normal.`,
  };

  const examPrompt = `Erstelle eine Probeklausur für "${sessionMeta.name}".
${diffInstructions[selDiff] || diffInstructions.mittel}

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
    const exam = await claudeLocal([{ role: 'user', content: 'Klausur erstellen.' }], sysBlocks(examPrompt), 3000);
    currentExamText = exam;
    fetch(`/api/subjects/${sessionId}/klausuren`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ id: Date.now().toString(), diff: selDiff, content: exam }),
    }).catch(() => {});
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
    examDone();
    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-result').classList.remove('hidden');
  } catch (e) {
    examDone();
    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
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

document.getElementById('analysis-btn')?.addEventListener('click', runAnalysis);
document.getElementById('analysis-refresh')?.addEventListener('click', runAnalysis);

document.getElementById('lernziel-slider')?.addEventListener('input', async e => {
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
  const analysisDone = startProgress('analysis-progress-bar', 'analysis-progress-pct', 20000);

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
    const analysis = await claudeLocal(
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
    analysisDone();
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-result').classList.remove('hidden');
  } catch (e) {
    analysisDone();
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
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
    const summary = await claudeLocal(
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
  document.querySelectorAll('#panel-ueben .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function initAufgaben() {
  if (scannedTopics.length) {
    renderTopicChips();
    showAufgabenState(document.getElementById('aufgaben-topics'));
  } else {
    showAufgabenState(document.getElementById('aufgaben-idle'));
  }
  renderSavedAufgaben();
}

async function renderSavedAufgaben() {
  const wrap = document.getElementById('saved-aufgaben-list');
  if (!wrap) return;
  const list = await DB.savedAufgaben(sessionId);
  if (!list.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<div class="saved-aufg-title">📂 Gespeicherte Aufgaben</div>';
  list.forEach(entry => {
    const typeLabel = entry.type === 'klausur' ? '📋 Klausur' : '📝 Übung';
    const date = new Date(entry.createdAt).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const row = document.createElement('div');
    row.className = 'saved-aufg-row';
    row.innerHTML = `
      <div class="saved-aufg-info">
        <span class="saved-aufg-type">${typeLabel}</span>
        <span class="saved-aufg-topic">${esc(entry.topic)}</span>
        <span class="saved-aufg-date">${date}</span>
      </div>
      <div class="saved-aufg-btns">
        <button class="btn-secondary btn-sm">Öffnen</button>
        <button class="btn-icon-sm saved-del-btn">🗑</button>
      </div>`;
    row.querySelector('.btn-secondary').addEventListener('click', () => restoreAufgabe(entry));
    row.querySelector('.saved-del-btn').addEventListener('click', async () => {
      await DB.delAufgabe(sessionId, entry.id);
      renderSavedAufgaben();
    });
    wrap.appendChild(row);
  });
}

function restoreAufgabe(entry) {
  aufgabenAnsVis = false;
  selTopic = entry.topic;
  selAufgabenType = entry.type;
  const body = document.getElementById('aufgaben-body');
  const sepIdx = entry.fullResult.search(/---\s*\n+##\s*(Lösungsschlüssel|Musterlösungen)/i);
  if (sepIdx > -1) {
    body.innerHTML = safeHtml(md(entry.tasksPart) +
      `<div class="ans-section">${md(entry.fullResult.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
  } else {
    body.innerHTML = safeHtml(md(entry.fullResult));
  }
  injectSolveButtons(entry.tasksPart);
  document.getElementById('aufgaben-rechnen-btn').onclick = () => sendToRechnen(entry.tasksPart.trim());
  body.closest('.aufgaben-content').classList.add('answers-hidden');
  document.getElementById('aufgaben-ans-btn').textContent = 'Lösungen anzeigen';
  showAufgabenState(document.getElementById('aufgaben-result'));
}

document.getElementById('aufgaben-scan-btn')?.addEventListener('click', scanTopics);
document.getElementById('aufgaben-rescan-btn')?.addEventListener('click', scanTopics);

async function scanTopics() {
  if (!sessionTxt) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  document.getElementById('aufgaben-loading-txt').textContent = 'Themen werden erkannt…';
  showAufgabenState(document.getElementById('aufgaben-loading'));
  const aufgabenScanDone = startProgress('aufgaben-progress-bar', 'aufgaben-progress-pct', 15000);
  selTopic = null;
  document.getElementById('aufgaben-gen-btn').disabled = true;

  const prompt = `Analysiere den folgenden Lernstoff und erstelle eine Liste der wichtigsten Themen und Unterthemen.
Antworte NUR als JSON-Array mit maximal 12 kurzen Thema-Strings (max. 4 Wörter je Thema):
["Thema 1", "Thema 2", "Thema 3", ...]`;

  try {
    const raw = await claudeLocal(
      [{ role: 'user', content: 'Welche Hauptthemen gibt es in den Unterlagen?' }],
      sysBlocks(prompt), 400,
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Themen erkannt');
    scannedTopics = JSON.parse(m[0]).filter(t => typeof t === 'string').slice(0, 12);
    if (!scannedTopics.length) throw new Error('Keine Themen gefunden');
    fetch(`/api/subjects/${sessionId}/topics`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ topics: scannedTopics }),
    }).catch(() => {});
    aufgabenScanDone();
    renderTopicChips();
    showAufgabenState(document.getElementById('aufgaben-topics'));
  } catch (e) {
    aufgabenScanDone();
    showAufgabenState(document.getElementById('aufgaben-idle'));
    toast('Fehler beim Erkennen: ' + e.message, 'error');
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

document.getElementById('aufgaben-gen-btn')?.addEventListener('click', generateAufgaben);
document.getElementById('aufgaben-back-btn')?.addEventListener('click', () => {
  showAufgabenState(document.getElementById('aufgaben-topics'));
  renderSavedAufgaben();
});
document.getElementById('aufgaben-ans-btn')?.addEventListener('click', () => {
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
  const aufgabenGenDone = startProgress('aufgaben-progress-bar', 'aufgaben-progress-pct', 20000);

  const isKlausur = selAufgabenType === 'klausur';

  const aufgDiffText = {
    leicht:       'Niveau: Leicht – einfache Definitionen und direkte Fragen.',
    mittel:       'Niveau: Mittel – Verständnis und einfache Anwendung.',
    schwer:       'Niveau: Schwer – komplexe Zusammenhänge und Anwendungen.',
    pruefungsnah: `Niveau: Prüfungsnah – orientiere dich an den hochgeladenen Probe-/Altklausuren.
Übernimm Fragetypen, Formulierungsstil und Punktegewichtung daraus.`,
    experte:      `Niveau: EXPERTE – schwerer als die echte Prüfung.
Kombiniere Konzepte, teste Grenzfälle, verlange Transferdenken. Baut Konfidenz auf.`,
  }[selAufgabenDiff] || '';

  const prompt = isKlausur
    ? `Erstelle eine kompakte Mini-Klausur NUR zum Thema "${selTopic}" aus dem Fach "${sessionMeta.name}".
${aufgDiffText}

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
${aufgDiffText}

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
    const result = await claudeLocal(
      [{ role: 'user', content: 'Aufgaben erstellen.' }],
      sysBlocks(prompt), 2500,
    );
    currentAufgabenResult = result;
    const body = document.getElementById('aufgaben-body');
    const sepIdx = result.search(/---\s*\n+##\s*(Lösungsschlüssel|Musterlösungen)/i);
    const tasksPart = sepIdx > -1 ? result.slice(0, sepIdx) : result;

    if (sepIdx > -1) {
      body.innerHTML = safeHtml(md(tasksPart) +
        `<div class="ans-section">${md(result.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
    } else {
      body.innerHTML = safeHtml(md(result));
    }

    // Inject per-task "✏️ Lösen" buttons
    injectSolveButtons(tasksPart);

    // Wire "Im Rechnen lösen" toolbar button to send all tasks
    document.getElementById('aufgaben-rechnen-btn').onclick = () => sendToRechnen(tasksPart.trim());

    // Auto-save
    DB.saveAufgabe(sessionId, {
      id: Date.now(),
      topic: selTopic,
      type: selAufgabenType,
      tasksPart,
      fullResult: result,
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    aufgabenGenDone();
    document.getElementById('aufgaben-body').closest('.aufgaben-content').classList.add('answers-hidden');
    document.getElementById('aufgaben-ans-btn').textContent = 'Lösungen anzeigen';
    showAufgabenState(document.getElementById('aufgaben-result'));
  } catch (e) {
    aufgabenGenDone();
    showAufgabenState(document.getElementById('aufgaben-topics'));
    toast('Fehler: ' + e.message, 'error');
  }
}

function injectSolveButtons(tasksPart) {
  const body = document.getElementById('aufgaben-body');
  // Find individual tasks by splitting on "**Aufgabe N" pattern
  const taskMatches = [...tasksPart.matchAll(/\*\*Aufgabe\s+\d+[^*]*\*\*:?([^\n]*(?:\n(?!\n\*\*Aufgabe)[^\n]*)*)/gi)];

  if (!taskMatches.length) return; // Klausur format — no per-task buttons needed

  // Find all <p> containing bold "Aufgabe N" text in rendered HTML
  body.querySelectorAll('p').forEach((p, i) => {
    const strong = p.querySelector('strong');
    if (!strong || !/^Aufgabe\s+\d+/i.test(strong.textContent.trim())) return;

    // Get this task's raw text from the parsed matches
    const taskText = taskMatches[i] ? taskMatches[i][0] : p.textContent;

    const btn = document.createElement('button');
    btn.className = 'solve-inline-btn';
    btn.innerHTML = '✏️ Lösen';
    btn.addEventListener('click', () => sendToRechnen(taskText.trim()));
    p.appendChild(btn);
  });
}

function sendToRechnen(text) {
  currentAufgabe = text;
  savedCanvasData = null;
  const input = document.getElementById('rechnen-task-input');
  if (input) input.value = text;
  switchToLoesen();
}

// ══ RECHNEN (Freies Lösen mit Pencil) ═════════════════════════════════════

let activeRechnenDoc = null;

function renderRechnenDocs() {
  const chips = document.getElementById('rechnen-doc-chips');
  if (!chips) return;
  chips.innerHTML = '';
  const files = sessionMeta?.files || [];
  files.forEach(f => {
    const chip = document.createElement('button');
    chip.className = 'rechnen-doc-chip' + (activeRechnenDoc === f.name ? ' active' : '');
    chip.title = f.name;
    chip.innerHTML = `<span>📄 ${f.name}</span>`;
    chip.addEventListener('click', () => {
      activeRechnenDoc = activeRechnenDoc === f.name ? null : f.name;
      renderRechnenDocs();
    });
    chips.appendChild(chip);
  });
}

document.getElementById('rechnen-doc-add-btn')?.addEventListener('click', () => showUploadSheet());

async function initRechnen() {
  renderRechnenDocs();
  const input = document.getElementById('rechnen-task-input');
  if (input && currentAufgabe && !input.value) input.value = currentAufgabe;
  initResizeHandle();
  if (!savedCanvasData && sessionId) {
    savedCanvasData = await localforage.getItem(`canvas_${sessionId}`).catch(() => null);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => initCanvas()));
}

function initResizeHandle() {
  const handle = document.getElementById('rechnen-resize-handle');
  const area   = document.getElementById('rechnen-task-area');
  if (!handle || !area || handle._initDone) return;
  handle._initDone = true;
  let startY = 0, startH = 0;
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startH = area.getBoundingClientRect().height;
  }, { passive: false });
  handle.addEventListener('pointermove', e => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const newH = Math.max(50, Math.min(380, startH + (e.clientY - startY)));
    area.style.height = newH + 'px';
  });
}

const CANVAS_HEIGHT = 2000;

function initCanvas() {
  const canvas = document.getElementById('math-canvas');
  const wrap   = document.getElementById('canvas-scroll-wrap');
  const w      = wrap ? wrap.clientWidth : canvas.getBoundingClientRect().width;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = CANVAS_HEIGHT + 'px';
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(CANVAS_HEIGHT * dpr);
  mathCtx = canvas.getContext('2d');
  mathCtx.scale(dpr, dpr);
  mathCtx.fillStyle = '#ffffff';
  mathCtx.fillRect(0, 0, w, CANVAS_HEIGHT);
  if (savedCanvasData) {
    const img = new Image();
    img.onload = () => { mathCtx.drawImage(img, 0, 0, w, CANVAS_HEIGHT); applyCtxStyle(); };
    img.src = savedCanvasData;
    savedCanvasData = null;
  } else {
    applyCtxStyle();
  }
  undoStack = []; redoStack = [];
}

const PEN_BASE = { fine: 1.0, medium: 2.0, thick: 4.5 };

function applyCtxStyle() {
  if (!mathCtx) return;
  mathCtx.lineCap  = 'round';
  mathCtx.lineJoin = 'round';
  if (activeTool === 'highlighter') {
    mathCtx.globalAlpha  = 0.35;
    mathCtx.strokeStyle  = '#FFD60A';
    mathCtx.lineWidth    = PEN_BASE[penSize] * 10;
  } else {
    mathCtx.globalAlpha  = 1;
    mathCtx.strokeStyle  = penColor;
    mathCtx.lineWidth    = PEN_BASE[penSize] * 2;
  }
}

function setupCanvasEvents() {
  const canvas = document.getElementById('math-canvas');
  let fingerStartY = 0, wrapScrollStart = 0;

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      fingerStartY   = e.clientY;
      wrapScrollStart = document.getElementById('canvas-scroll-wrap').scrollTop;
      return;
    }
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawingCanvas = true;
    redoStack = [];
    const snap = mathCtx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(snap);
    if (undoStack.length > 8) undoStack.shift();
    const p = canvasPos(e, canvas);
    canvasLastX = p.x; canvasLastY = p.y;

    if (activeTool === 'line') {
      linePreviewData = snap;
      return;
    }
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      applyCtxStyle();
      mathCtx.beginPath();
      const r = Math.max(0.5, (e.pressure || 0.5) * PEN_BASE[penSize]);
      mathCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
      mathCtx.fillStyle = activeTool === 'highlighter' ? 'rgba(255,214,10,0.35)' : penColor;
      mathCtx.fill();
    }
  }, { passive: false });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') {
      const wrap = document.getElementById('canvas-scroll-wrap');
      wrap.scrollTop = wrapScrollStart + (fingerStartY - e.clientY);
      return;
    }
    if (!isDrawingCanvas || !mathCtx) return;
    e.preventDefault();
    const p        = canvasPos(e, canvas);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    if (activeTool === 'eraser') {
      mathCtx.globalAlpha  = 1;
      mathCtx.lineWidth    = PEN_BASE[penSize] * 12;
      mathCtx.strokeStyle  = '#ffffff';
    } else if (activeTool === 'highlighter') {
      mathCtx.globalAlpha  = 0.35;
      mathCtx.strokeStyle  = '#FFD60A';
      mathCtx.lineWidth    = PEN_BASE[penSize] * 10;
    } else if (activeTool === 'line') {
      // Restore snapshot and draw fresh preview line
      mathCtx.putImageData(linePreviewData, 0, 0);
      mathCtx.globalAlpha  = 1;
      mathCtx.strokeStyle  = penColor;
      mathCtx.lineWidth    = PEN_BASE[penSize] * 2;
      mathCtx.beginPath();
      mathCtx.moveTo(canvasLastX, canvasLastY);
      mathCtx.lineTo(p.x, p.y);
      mathCtx.stroke();
      return;
    } else {
      mathCtx.globalAlpha  = 1;
      mathCtx.strokeStyle  = penColor;
      mathCtx.lineWidth    = Math.max(0.5, pressure * PEN_BASE[penSize] * 1.8);
    }

    mathCtx.beginPath();
    mathCtx.moveTo(canvasLastX, canvasLastY);
    mathCtx.lineTo(p.x, p.y);
    mathCtx.stroke();
    canvasLastX = p.x; canvasLastY = p.y;
  }, { passive: false });

  const endDraw = (e) => {
    if (!isDrawingCanvas) return;
    isDrawingCanvas = false;
    if (activeTool === 'line' && linePreviewData) {
      // Finalize the line at the last position
      const p = canvasPos(e, canvas);
      mathCtx.putImageData(linePreviewData, 0, 0);
      mathCtx.globalAlpha  = 1;
      mathCtx.strokeStyle  = penColor;
      mathCtx.lineWidth    = PEN_BASE[penSize] * 2;
      mathCtx.beginPath();
      mathCtx.moveTo(canvasLastX, canvasLastY);
      mathCtx.lineTo(p.x, p.y);
      mathCtx.stroke();
      linePreviewData = null;
    }
    mathCtx.globalAlpha = 1;
  };
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
  if (sessionId) localforage.removeItem(`canvas_${sessionId}`).catch(() => {});
  const canvas = document.getElementById('math-canvas');
  const r      = canvas.getBoundingClientRect();
  undoStack = []; redoStack = [];
  mathCtx.globalAlpha = 1;
  mathCtx.fillStyle = '#ffffff';
  mathCtx.fillRect(0, 0, r.width, r.height);
  setActiveTool('pen');
}

function setActiveTool(tool) {
  activeTool = tool;
  isErasing  = tool === 'eraser';
  const cvs = document.getElementById('math-canvas');
  if (cvs) cvs.style.cursor = tool === 'eraser' ? 'cell' : tool === 'line' ? 'crosshair' : 'default';
  ['canvas-pen-btn','canvas-highlight-btn','canvas-line-btn','canvas-eraser-btn'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  const map = { pen: 'canvas-pen-btn', highlighter: 'canvas-highlight-btn', line: 'canvas-line-btn', eraser: 'canvas-eraser-btn' };
  document.getElementById(map[tool])?.classList.add('active');
}

function undoCanvas() {
  if (!mathCtx || !undoStack.length) return;
  const canvas = document.getElementById('math-canvas');
  redoStack.push(mathCtx.getImageData(0, 0, canvas.width, canvas.height));
  mathCtx.putImageData(undoStack.pop(), 0, 0);
}

function redoCanvas() {
  if (!mathCtx || !redoStack.length) return;
  const canvas = document.getElementById('math-canvas');
  undoStack.push(mathCtx.getImageData(0, 0, canvas.width, canvas.height));
  mathCtx.putImageData(redoStack.pop(), 0, 0);
}

// ── Rechnen difficulty select ──────────────────────────────────────────────
document.getElementById('rechnen-diff-sel')?.addEventListener('change', e => {
  rechnenDiff = e.target.value;
});

// ── Rechnen generate ───────────────────────────────────────────────────────
document.getElementById('rechnen-gen-btn')?.addEventListener('click', generateMathAufgabe);
// Color picker
document.querySelectorAll('.canvas-color').forEach(btn => btn.addEventListener('click', () => {
  penColor = btn.dataset.color;
  document.querySelectorAll('.canvas-color').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  if (activeTool === 'eraser' || activeTool === 'highlighter') setActiveTool('pen');
}));

// Size picker
document.querySelectorAll('.canvas-size').forEach(btn => btn.addEventListener('click', () => {
  penSize = btn.dataset.size;
  document.querySelectorAll('.canvas-size').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
}));

document.getElementById('canvas-pen-btn')?.addEventListener('click',       () => setActiveTool('pen'));
document.getElementById('canvas-highlight-btn')?.addEventListener('click', () => setActiveTool('highlighter'));
document.getElementById('canvas-line-btn')?.addEventListener('click',      () => setActiveTool('line'));
document.getElementById('canvas-eraser-btn')?.addEventListener('click',    () => setActiveTool(activeTool === 'eraser' ? 'pen' : 'eraser'));
document.getElementById('canvas-undo-btn')?.addEventListener('click',  undoCanvas);
document.getElementById('canvas-redo-btn')?.addEventListener('click',  redoCanvas);
document.getElementById('canvas-clear-btn')?.addEventListener('click', clearCanvas);
document.getElementById('canvas-check-btn')?.addEventListener('click', checkHandwriting);

// Feedback sheet buttons
document.getElementById('rechnen-sheet-close-btn')?.addEventListener('click', () => {
  document.getElementById('rechnen-feedback-overlay').classList.add('hidden');
});
document.getElementById('rechnen-sheet-retry-btn')?.addEventListener('click', () => {
  document.getElementById('rechnen-feedback-overlay').classList.add('hidden');
  clearCanvas();
});
document.getElementById('rechnen-feedback-bg')?.addEventListener('click', () => {
  document.getElementById('rechnen-feedback-overlay').classList.add('hidden');
});

// Ask sheet buttons
document.getElementById('rechnen-ask-btn')?.addEventListener('click', openAskSheet);
document.getElementById('rechnen-ask-close-btn')?.addEventListener('click', () => {
  document.getElementById('rechnen-ask-overlay').classList.add('hidden');
});
document.getElementById('rechnen-ask-bg')?.addEventListener('click', () => {
  document.getElementById('rechnen-ask-overlay').classList.add('hidden');
});
document.getElementById('rechnen-ask-send-btn')?.addEventListener('click', sendAskQuestion);
document.getElementById('rechnen-ask-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendAskQuestion();
});

setupCanvasEvents();

function openAskSheet() {
  document.getElementById('rechnen-ask-overlay').classList.remove('hidden');
  document.getElementById('rechnen-ask-input').focus();
}

async function sendAskQuestion() {
  const input = document.getElementById('rechnen-ask-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  const msgs = document.getElementById('rechnen-ask-msgs');
  const userBubble = document.createElement('div');
  userBubble.className = 'ask-msg-user';
  userBubble.textContent = question;
  msgs.appendChild(userBubble);

  const aiBubble = document.createElement('div');
  aiBubble.className = 'ask-msg-ai';
  aiBubble.textContent = '…';
  msgs.appendChild(aiBubble);
  msgs.scrollTop = msgs.scrollHeight;

  const taskText = document.getElementById('rechnen-task-input')?.value.trim() || '';
  const taskContext = taskText ? `\nAktuelle Aufgabe:\n${taskText}` : '';
  const docContext = activeRechnenDoc ? `\nAktives Dokument: ${activeRechnenDoc}` : '';
  const extra = `Der Student arbeitet gerade handschriftlich an einer Aufgabe und hat eine Frage.${docContext}${taskContext}

Beantworte kurz und präzise. Gib einen hilfreichen Hinweis – keine vollständige Lösung.`;

  try {
    const answer = await claudeLocal([{ role: 'user', content: question }], sysBlocks(extra), 400);
    aiBubble.innerHTML = safeHtml(md(answer));
  } catch (e) {
    aiBubble.textContent = '⚠️ ' + e.message;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

async function generateMathAufgabe() {
  if (!sessionMeta) { toast('Bitte zuerst ein Fach öffnen.', 'warn'); return; }
  const spinner = document.getElementById('rechnen-gen-spinner');
  const btn = document.getElementById('rechnen-gen-btn');
  spinner.classList.remove('hidden');
  btn.disabled = true;

  const prompt = `Erstelle EINE einzelne Aufgabe (Schwierigkeit: ${rechnenDiff}) aus dem Lernstoff von "${sessionMeta.name}".

Regeln:
- Genau eine Aufgabe, klar und präzise formuliert
- Leicht = direkte Berechnung (1–2 Schritte) | Mittel = mehrere Schritte | Schwer = komplexe Aufgabe
- Verwende LaTeX für alle Formeln und Gleichungen ($$...$$)
- Schließe mit einer klaren Handlungsaufforderung: "Berechne:", "Bestimme:", "Löse:" etc.
- Keine Lösung – NUR die Aufgabenstellung

Antworte NUR mit der Aufgabenstellung, kein zusätzlicher Text.`;

  try {
    const aufgabe = await claudeLocal(
      [{ role: 'user', content: 'Aufgabe erstellen.' }],
      sysBlocks(prompt), 500,
    );
    const taskInput = document.getElementById('rechnen-task-input');
    taskInput.value = aufgabe.trim();
    currentAufgabe  = aufgabe.trim();
    savedCanvasData = null;
    undoStack       = [];
    clearCanvas();
  } catch (e) {
    toast('Fehler: ' + e.message, 'error');
  } finally {
    spinner.classList.add('hidden');
    btn.disabled = false;
  }
}

async function checkHandwriting() {
  if (!mathCtx) return;
  const canvas = document.getElementById('math-canvas');

  const px = mathCtx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasInk = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) { hasInk = true; break; }
  }
  if (!hasInk) { toast('Bitte zuerst eine Lösung auf die Zeichenfläche schreiben.', 'warn'); return; }

  // Show feedback sheet in loading state
  const overlay = document.getElementById('rechnen-feedback-overlay');
  document.getElementById('rechnen-sheet-loading').classList.remove('hidden');
  document.getElementById('rechnen-sheet-result').classList.add('hidden');
  overlay.classList.remove('hidden');
  const checkDone = startProgress('rechnen-check-bar', 'rechnen-check-pct', 15000);

  const taskText  = document.getElementById('rechnen-task-input')?.value.trim() || currentAufgabe;
  const docNote   = activeRechnenDoc ? `\n(Aktives Dokument: ${activeRechnenDoc})` : '';
  const dataURL   = canvas.toDataURL('image/png');
  const base64   = dataURL.split(',')[1];

  const checkPrompt = `Ein Schüler hat die folgende Aufgabe handschriftlich auf dem beigefügten Bild gelöst.

**Aufgabe:** ${taskText || '(keine Aufgabe angegeben – analysiere was du siehst)'}${docNote}

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
    const feedback = await claudeLocalVision(base64, checkPrompt, sysBlocks(), 1800);
    checkDone();
    document.getElementById('rechnen-feedback-content').innerHTML = safeHtml(md(feedback));
    document.getElementById('rechnen-sheet-loading').classList.add('hidden');
    document.getElementById('rechnen-sheet-result').classList.remove('hidden');
  } catch (e) {
    checkDone();
    overlay.classList.add('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => initCanvas()));
    toast('Fehler beim Prüfen: ' + e.message, 'error');
  }
}

// ══ DOWNLOADS ═════════════════════════════════════════════════════════════

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeName(s) {
  return (s || 'datei').replace(/[^a-z0-9äöüÄÖÜß]/gi, '_').toLowerCase().slice(0, 40);
}

document.getElementById('cheat-download-btn')?.addEventListener('click', () => {
  if (currentCheatText) downloadText(`zusammenfassung_${safeName(sessionMeta?.name)}.md`, currentCheatText);
});

document.getElementById('aufgaben-download-btn')?.addEventListener('click', () => {
  if (currentAufgabenResult) downloadText(`aufgaben_${safeName(selTopic)}.md`, currentAufgabenResult);
});

document.getElementById('exam-download-btn')?.addEventListener('click', () => {
  if (currentExamText) downloadText(`klausur_${safeName(sessionMeta?.name)}.md`, currentExamText);
});

// ══ BACKUP / RESTORE ══════════════════════════════════════════════════════
async function exportBackup() {
  const r = await fetch('/api/backup', { headers: authHeaders() });
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
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify(data),
  });
  await loadSubjects();
  toast(`${data.subjects.length} Fach/Fächer erfolgreich importiert.`, 'success');
}

document.getElementById('btn-export')?.addEventListener('click', exportBackup);
document.getElementById('btn-import')?.addEventListener('click', () => document.getElementById('import-input').click());
document.getElementById('import-input')?.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { await importBackup(f); } catch(err) { toast('Import-Fehler: ' + err.message, 'error'); }
  e.target.value = '';
});

// ══ CHEAT SHEET ═══════════════════════════════════════════════════════════
document.getElementById('cheat-gen-btn')?.addEventListener('click', generateCheatSheet);
document.getElementById('cheat-new-btn')?.addEventListener('click', () => {
  currentCheatText = '';
  fetch(`/api/subjects/${sessionId}/cheat`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  document.getElementById('cheat-result').classList.add('hidden');
  document.getElementById('cheat-idle').classList.remove('hidden');
});

async function generateCheatSheet() {
  document.getElementById('cheat-idle').classList.add('hidden');
  document.getElementById('cheat-loading').classList.remove('hidden');
  const cheatDone = startProgress('cheat-progress-bar', 'cheat-progress-pct', 22000);

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
    document.getElementById('cheat-loading').classList.add('hidden');
    document.getElementById('cheat-result').classList.remove('hidden');
    const body = document.getElementById('cheat-body');
    body.innerHTML = '';
    const result = await claudeLocalStream(
      [{ role: 'user', content: 'Zusammenfassung erstellen.' }],
      sysBlocks(prompt), 3000,
      (text) => { body.innerHTML = safeHtml(md(text)); },
    );
    cheatDone();
    currentCheatText = result;
    fetch(`/api/subjects/${sessionId}/cheat`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ content: result }),
    }).catch(() => {});
  } catch (e) {
    cheatDone();
    document.getElementById('cheat-result').classList.add('hidden');
    document.getElementById('cheat-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
  }
}

// ══ GLOSSAR ════════════════════════════════════════════════════════════════
let glossarTerms = [];

document.getElementById('glossar-gen-btn')?.addEventListener('click', generateGlossar);
document.getElementById('glossar-new-btn')?.addEventListener('click', () => {
  glossarTerms = [];
  document.getElementById('glossar-result').classList.add('hidden');
  document.getElementById('glossar-idle').classList.remove('hidden');
});
document.getElementById('glossar-search')?.addEventListener('input', e => {
  renderGlossarList(e.target.value.toLowerCase());
});

async function generateGlossar() {
  document.getElementById('glossar-idle').classList.add('hidden');
  document.getElementById('glossar-loading').classList.remove('hidden');
  const glossarDone = startProgress('glossar-progress-bar', 'glossar-progress-pct', 18000);

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
    glossarDone();
    renderGlossarList('');
    document.getElementById('glossar-loading').classList.add('hidden');
    document.getElementById('glossar-result').classList.remove('hidden');
  } catch (e) {
    glossarDone();
    document.getElementById('glossar-loading').classList.add('hidden');
    document.getElementById('glossar-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
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

async function loadSavedCheat() {
  try {
    const data = await api(`/api/subjects/${sessionId}/cheat`);
    if (!data?.content) return;
    currentCheatText = data.content;
    document.getElementById('cheat-body').innerHTML = safeHtml(md(data.content));
    document.getElementById('cheat-idle').classList.add('hidden');
    document.getElementById('cheat-loading').classList.add('hidden');
    document.getElementById('cheat-result').classList.remove('hidden');
  } catch (_) {}
}

async function loadSavedGlossar() {
  if (glossarTerms.length) { renderGlossarList(''); document.getElementById('glossar-idle').classList.add('hidden'); document.getElementById('glossar-result').classList.remove('hidden'); return; }
  try {
    const terms = await api(`/api/subjects/${sessionId}/glossar`);
    if (!terms || !terms.length) return;
    glossarTerms = terms.map(t => ({ term: t.term, def: t.definition }));
    renderGlossarList('');
    document.getElementById('glossar-idle').classList.add('hidden');
    document.getElementById('glossar-result').classList.remove('hidden');
  } catch (e) {}
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
  if (!sessionTxt) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  showKartenState(document.getElementById('karten-loading'));
  const kartenDone = startProgress('karten-progress-bar', 'karten-progress-pct', 18000);

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
    kartenDone();
    await initKarten();
  } catch (e) {
    kartenDone();
    showKartenState(document.getElementById('karten-idle'));
    toast('Fehler: ' + e.message, 'error');
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

document.getElementById('card-flip-btn')?.addEventListener('click', () => {
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

document.getElementById('karten-gen-btn')?.addEventListener('click', generateKarten);
document.getElementById('karten-review-btn')?.addEventListener('click', startReview);
document.getElementById('karten-done-btn')?.addEventListener('click', initKarten);

// ── Milestone levels (shared between calculateMilestone + renderMilestone) ──
const MILESTONE_LEVELS = [
  { min: 0,  emoji: '🌱', name: 'Einsteiger',     rec: null,          diff: null },
  { min: 20, emoji: '📖', name: 'Grundlagen',      rec: 'Leicht',      diff: 'leicht' },
  { min: 40, emoji: '🎓', name: 'Lernender',       rec: 'Mittel',      diff: 'mittel' },
  { min: 60, emoji: '💪', name: 'Fortgeschritten', rec: 'Schwer',      diff: 'schwer' },
  { min: 80, emoji: '🏆', name: 'Experte',         rec: 'Prüfungsnah', diff: 'pruefungsnah' },
];

// ══ LERNEN (Lernpfad + Meilensteine) ═════════════════════════════════════

function calculateMilestone() {
  const total    = scannedTopics.length;
  const topicPct = total > 0 ? learnedTopics.length / total : 0;
  const q        = sessionMeta?.quizStats?.questions || [];
  const quizAvg  = q.length > 0 ? q.reduce((a, x) => a + x.score, 0) / (q.length * 3) : 0;
  const pct      = Math.round((topicPct * 0.7 + quizAvg * 0.3) * 100);
  let level = MILESTONE_LEVELS[0], levelIdx = 0;
  for (let i = 0; i < MILESTONE_LEVELS.length; i++) {
    if (pct >= MILESTONE_LEVELS[i].min) { level = MILESTONE_LEVELS[i]; levelIdx = i; }
  }
  return { ...level, pct, levelNum: levelIdx + 1, totalLevels: MILESTONE_LEVELS.length };
}

function renderMilestone() {
  const banner = document.getElementById('milestone-banner');
  const title  = document.getElementById('lernpfad-title');
  if (!banner) return;
  if (!scannedTopics.length) {
    banner.classList.add('hidden');
    if (title) title.style.display = 'none';
    updateExamRecBanner();
    return;
  }
  const m = calculateMilestone();
  banner.classList.remove('hidden');
  if (title) title.style.display = '';

  const autoIdx  = m.levelNum - 1;
  const selIdx   = selectedDiffIdx;

  const stepsHtml = MILESTONE_LEVELS.map((l, i) => {
    const isManual = selIdx !== null;
    const isActive = isManual ? i === selIdx : i === autoIdx;
    const isPast   = i < autoIdx; // always based on real progress
    const cls = ['ms-step', isActive ? (isManual ? 'ms-manual' : 'ms-active') : '', isPast ? 'ms-past' : '']
                  .filter(Boolean).join(' ');
    const lineClass = isPast ? 'ms-line ms-line-done' : 'ms-line';
    return `<div class="${cls}" data-diffidx="${i}">
      <div class="ms-dot">${isPast ? '✓' : l.emoji}</div>
      <div class="ms-label">${l.name}</div>
    </div>${i < MILESTONE_LEVELS.length - 1 ? `<div class="${lineClass}"></div>` : ''}`;
  }).join('');

  const infoTxt = selIdx !== null
    ? `Modus: <strong>${MILESTONE_LEVELS[selIdx].name}</strong> · <span class="ms-reset-btn">Zurücksetzen</span>`
    : `${m.pct}% · ${learnedTopics.length}/${scannedTopics.length} Themen${m.rec ? ` · Empfehlung: <strong>${m.rec}</strong>` : ''}`;

  banner.innerHTML = `
    <div class="ms-steps">${stepsHtml}</div>
    <div class="ms-bar-wrap"><div class="ms-bar-fill" style="width:${m.pct}%"></div></div>
    <div class="ms-info">${infoTxt}</div>`;

  banner.querySelectorAll('.ms-step').forEach(el => {
    el.addEventListener('click', () => {
      selectedDiffIdx = +el.dataset.diffidx === selectedDiffIdx ? null : +el.dataset.diffidx;
      renderMilestone();
      loadLernpfad();
    });
  });
  banner.querySelector('.ms-reset-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    selectedDiffIdx = null;
    renderMilestone();
    loadLernpfad();
  });
  updateExamRecBanner(m);
}

function updateExamRecBanner(m) {
  const banner = document.getElementById('exam-rec-banner');
  if (!banner) return;
  if (!m) { m = scannedTopics.length ? calculateMilestone() : null; }
  if (!m || !m.rec) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  banner.innerHTML = `${m.emoji} Empfehlung für dein Level: <strong>${m.rec}</strong>`;
  document.querySelectorAll('.diff-btn').forEach(btn =>
    btn.classList.toggle('recommended', btn.dataset.diff === m.diff));
}

function initLernen() {
  // If the topic view is open from a previous visit, close it back to the list
  if (document.getElementById('lernen-topic-view').style.display !== 'none') {
    closeLernenTopic();
  }
  renderMilestone();
  loadLernpfad();
  if (sessionId) {
    api(`/api/subjects/${sessionId}/learned-topics`)
      .then(t => { learnedTopics = Array.isArray(t) ? t : []; renderMilestone(); loadLernpfad(); })
      .catch(() => {});
  }
}

function loadLernpfad() {
  const empty = document.getElementById('lernpfad-empty');
  const list  = document.getElementById('lernpfad-list');
  if (!empty || !list) return;
  if (!scannedTopics.length) {
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = '';
  const learnedSet = new Set(learnedTopics);
  let foundCurrent = false;
  scannedTopics.forEach(topic => {
    const isDone    = learnedSet.has(topic);
    const isCurrent = !isDone && !foundCurrent;
    if (isCurrent) foundCurrent = true;
    const item = document.createElement('div');
    item.className = `lernpfad-item${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`;
    const diffLvl = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : null;
    const diffTag = diffLvl && !isDone ? ` <span class="lernpfad-diff-tag">${diffLvl.emoji} ${diffLvl.name}</span>` : '';
    const btnLabel = isDone ? 'Wiederholen' : 'Lernen →';
    const btnClass = isDone ? 'lernpfad-btn lernpfad-btn-repeat' : 'lernpfad-btn';
    item.innerHTML = `
      <span class="lernpfad-status">${isDone ? '✅' : isCurrent ? '▶' : '○'}</span>
      <span class="lernpfad-name">${esc(topic)}${diffTag}</span>
      <button class="${btnClass}">${btnLabel}</button>`;
    item.querySelector('.lernpfad-btn').addEventListener('click', () => openTopicView(topic));
    list.appendChild(item);
  });
}

// ── Lernen canvas state ────────────────────────────────────────────────────
let lernenCtx       = null;
let isDrawingLernen = false;
let lernenLastX     = 0, lernenLastY = 0;
let lernenPenColor  = '#1c1c1e';
let lernenTool      = 'pen';
let lernenActivePtr = null; // palm rejection: track active pointer ID
let lernenTopicData = null;
let lernenQaMsgs    = [];
let lernenAnswerMode = 'canvas'; // 'canvas' | 'text'
let selectedDiffIdx = null; // null = auto from progress, 0-4 = manual override

function openTopicView(topic) {
  currentExplainerTopic = topic;
  lernenTopicData = null;
  lernenQaMsgs    = [];
  lernenCtx       = null;
  lernenActivePtr = null;
  isDrawingLernen = false;
  // Switch views
  document.getElementById('lernen-pfad-view').classList.add('hidden');
  document.getElementById('lernen-topic-view').style.display = 'flex';
  document.getElementById('lernen-topic-name').textContent = topic;
  document.getElementById('lernen-qa-title').textContent = 'Fragen zu: ' + topic;
  const badge = document.getElementById('lernen-diff-badge');
  if (badge) {
    const l = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
    badge.textContent = `${l.emoji} ${l.name}`;
    badge.className = `lernen-diff-badge lernen-diff-badge--${l.diff || 'einsteiger'}`;
  }
  document.getElementById('lernen-qa-msgs').innerHTML = '';
  const valuesEl = document.getElementById('lernen-task-values');
  if (valuesEl) { valuesEl.innerHTML = ''; valuesEl.classList.add('hidden'); }
  const resultBar = document.getElementById('lernen-result-bar');
  if (resultBar) { resultBar.innerHTML = ''; resultBar.className = 'lernen-result-bar hidden'; }
  lernenAnswerMode = 'canvas';
  document.getElementById('lernen-draw-tools').style.display = 'contents';
  document.getElementById('lernen-canvas-wrap').classList.remove('hidden');
  document.getElementById('lernen-text-wrap').classList.add('hidden');
  document.getElementById('lernen-mode-canvas').classList.add('active');
  document.getElementById('lernen-mode-text').classList.remove('active');
  document.getElementById('lernen-regen-btn').classList.add('hidden');
  // Reset step 1
  document.getElementById('lernen-erkl-loading').style.display = '';
  document.getElementById('lernen-erkl-body').classList.add('hidden');
  document.getElementById('lernen-step1-footer').classList.add('hidden');
  document.getElementById('lernen-tab-aufgabe').disabled = true;
  document.getElementById('lernen-done-btn').classList.add('hidden');
  lernenSwitchStep(1);
  loadTopicContent(topic);
}

function closeLernenTopic() {
  document.getElementById('lernen-pfad-view').classList.remove('hidden');
  document.getElementById('lernen-topic-view').style.display = 'none';
  lernenCtx = null;
}

function lernenSwitchStep(step) {
  document.querySelectorAll('.lernen-step-tab').forEach(t =>
    t.classList.toggle('active', +t.dataset.lstep === step));
  document.getElementById('lernen-step-1').classList.toggle('lernen-step-hidden', step !== 1);
  document.getElementById('lernen-step-2').classList.toggle('lernen-step-hidden', step !== 2);
  if (step === 2) requestAnimationFrame(initLernenCanvas);
}

// ── Lernen content cache (localforage / IndexedDB) ───────────────────────
function lernenCacheKey(topic) {
  const diff = selectedDiffIdx !== null ? (MILESTONE_LEVELS[selectedDiffIdx].diff || 'einsteiger') : 'auto';
  return `lc2_${sessionId}_${topic}_${diff}`;
}

function getDiffInstr(effLevel) {
  switch (effLevel.diff) {
    case 'leicht':
      return `Niveau: GRUNDLAGEN (Stufe 2 von 5).
ERKLÄRUNG: Erkläre das Konzept von Grund auf. Kein Fachwissen voraussetzen. Nutze alltagsnahe Analogien und sehr einfache Zahlen. "Was ist das?" = intuitive Definition mit Alltagsbeispiel. "Warum wichtig?" = praktischer Nutzen in einfachen Worten. "Beispiel" = konkretes Beispiel mit kleinen, runden Zahlen. Rechenbeispiel: falls vorhanden, nur ein einziger Schritt.
AUFGABE: Eine sehr einfache Aufgabe, ein Rechenschritt, kleine Zahlen.`;
    case 'mittel':
      return `Niveau: LERNENDER (Stufe 3 von 5).
ERKLÄRUNG: Erkläre das Konzept klar mit korrekten Fachbegriffen. "Was ist das?" = präzise Definition + Fachbegriff erläutern. "Warum wichtig?" = Relevanz im Fachkontext, nicht nur Alltag. "Beispiel" = realistisches Szenario mit mehreren Variablen. Rechenbeispiel: 2-3 Rechenschritte mit Zwischenergebnissen.
AUFGABE: Mittelschwere Aufgabe mit 2-3 Rechenschritten, realistisches Szenario.`;
    case 'schwer':
      return `Niveau: FORTGESCHRITTEN (Stufe 4 von 5).
ERKLÄRUNG: Gehe in die Tiefe. "Was ist das?" = vollständige fachliche Definition inkl. Randfälle und Einschränkungen. "Warum wichtig?" = Verbindung zu anderen Konzepten, theoretischer Hintergrund. "Beispiel" = komplexes Praxisbeispiel mit mehreren Einflussgrößen. Rechenbeispiel: mehrstufig, zeige alle Zwischenschritte und erkläre WARUM jeder Schritt nötig ist.
AUFGABE: Komplexe Aufgabe mit mehreren Teilschritten, die mehrere Konzepte verknüpft.`;
    case 'pruefungsnah':
      return `Niveau: EXPERTE (Stufe 5 von 5).
ERKLÄRUNG: Prüfungsqualität. "Was ist das?" = exakte wissenschaftliche Definition wie in einem Lehrbuch. "Warum wichtig?" = theoretische Fundierung, Herleitung, Abgrenzung zu ähnlichen Konzepten. "Beispiel" = Fallstudie oder Prüfungsbeispiel mit vollständigem Lösungsweg. Rechenbeispiel: vollständig ausformuliert mit Formelangaben, Einheiten, Interpretation des Ergebnisses.
AUFGABE: Klausuraufgabe mit vollständigem erwarteten Lösungsweg, Prüfungssprache.`;
    default:
      return `Niveau: EINSTEIGER (Stufe 1 von 5).
ERKLÄRUNG: Erkläre als ob der Student das Thema noch nie gehört hat. Kein Vorwissen annehmen. Kurz, klar, mit einfachsten Worten. Rechenbeispiel nur wenn unbedingt nötig, dann maximal ein Schritt.
AUFGABE: Sehr einfache Aufgabe, intuitiv lösbar.`;
  }
}

function renderTopicContent(topic, data) {
  document.getElementById('lernen-erkl-loading').style.display = 'none';
  const fmtText = s => esc(s || '').replace(/\n/g, '<br>');
  let html = `<h2 class="lernen-erkl-title">📖 ${esc(topic)}</h2>
    <div class="explainer-section"><div class="explainer-label">Was ist das?</div><div class="explainer-body">${fmtText(data.was)}</div></div>
    <div class="explainer-section"><div class="explainer-label">Warum wichtig?</div><div class="explainer-body">${fmtText(data.warum)}</div></div>`;
  if (data.vertiefung && data.vertiefung.trim()) {
    html += `<div class="explainer-section explainer-section--deep"><div class="explainer-label">🔍 Vertiefung</div><div class="explainer-body">${fmtText(data.vertiefung)}</div></div>`;
  }
  html += `<div class="explainer-section"><div class="explainer-label">Konkretes Beispiel</div><div class="explainer-body">${fmtText(data.beispiel)}</div></div>`;
  if (data.rechnung && data.rechnung.trim()) {
    html += `<div class="explainer-section"><div class="explainer-label">📐 Rechenbeispiel</div><div class="explainer-rechnung">${fmtText(data.rechnung)}</div></div>`;
  }
  const body = document.getElementById('lernen-erkl-body');
  body.innerHTML = html;
  body.classList.remove('hidden');
  document.getElementById('lernen-step1-footer').classList.remove('hidden');
  if (data.aufgabe && data.aufgabe.trim()) {
    document.getElementById('lernen-task-bar').innerHTML = safeHtml(md(data.aufgabe));
    document.getElementById('lernen-tab-aufgabe').disabled = false;
    document.getElementById('lernen-regen-btn').classList.remove('hidden');
  } else {
    document.getElementById('lernen-done-btn').classList.remove('hidden');
  }
  const valuesEl = document.getElementById('lernen-task-values');
  if (valuesEl) {
    if (Array.isArray(data.werte) && data.werte.length > 0) {
      valuesEl.innerHTML = data.werte.map(v => `<span class="task-value-chip">${esc(v)}</span>`).join('');
      valuesEl.classList.remove('hidden');
    } else {
      valuesEl.innerHTML = '';
      valuesEl.classList.add('hidden');
    }
  }
}

async function loadTopicContent(topic) {
  // Serve from cache if available
  const cached = await localforage.getItem(lernenCacheKey(topic)).catch(() => null);
  // Stale guard: user may have navigated to a different topic while awaiting cache/AI
  if (currentExplainerTopic !== topic) return;
  if (cached) {
    lernenTopicData = cached;
    renderTopicContent(topic, cached);
    return;
  }
  const stopProg = startProgress('lernen-prog-bar', 'lernen-prog-pct', 18000);
  const effLevel = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
  const diffInstr = getDiffInstr(effLevel);
  try {
    const ctx = sessionTxt ? sessionTxt.slice(0, 3500) : '';
    const raw = await claudeLocal(
      [{ role: 'user', content: `Erkläre das Thema "${topic}" auf dem vorgegebenen Niveau.` }],
      [{
        type: 'text',
        text: `Du erklärst das Thema "${topic}" aus folgenden Unterlagen:\n${ctx || '(keine Unterlagen)'}\n\n${diffInstr}\n\nWICHTIG:\n- Das Niveau beeinflusst ALLE Felder – Tiefe, Sprache, Komplexität.\n- Für konzeptuelle/theoretische Themen (ohne viel Mathematik): schreibe ausführliche, lehrreiche Texte. Kein künstliches Kürzen – so lang wie nötig für echtes Verständnis.\n- "vertiefung": Nutze dieses Feld für Hintergründe, Zusammenhänge mit anderen Konzepten, häufige Missverständnisse, historische Einordnung – alles was hilft das Thema wirklich zu durchdringen. Leer lassen wenn kein Mehrwert.\n- "rechnung": Nur befüllen wenn das Thema tatsächlich Rechenoperationen beinhaltet. Sonst leer lassen.\n- "werte": Nur bei Rechenaufgaben – Array mit den wichtigsten Zahlenwerten aus der Aufgabe (z.B. ["500 € Startkapital","8 % Zinssatz p.a."]). Bei konzeptuellen Aufgaben ohne Zahlenwerte: leeres Array [].\n- "aufgabe": Übungsaufgabe passend zum Niveau. Bei mehreren Teilfragen jede Frage auf einer neuen Zeile (trenne mit \\n\\n). NIEMALS Lösungen, Musterlösungen, Hinweise auf die Antworten oder Lösungswege im Aufgabentext!\n\nAntworte NUR als JSON-Objekt (kein Text davor/danach, keine Zeilenumbrüche im JSON außer \\n in Texten):\n{"was":"Vollständige Erklärung des Konzepts – so ausführlich wie nötig","warum":"Bedeutung und Relevanz – ausführlich begründet","vertiefung":"Vertiefung: Hintergründe, Zusammenhänge, Besonderheiten (leer lassen wenn nicht hilfreich)","beispiel":"Konkretes Praxisbeispiel passend zum Niveau","rechnung":"Schritt-für-Schritt Rechenbeispiel (nutze \\n zwischen Schritten). Leer lassen wenn kein Rechnen nötig.","aufgabe":"Aufgabentext ohne Lösungen. Jede Teilfrage auf eigener Zeile.","werte":[]}`,
      }],
      2500
    );
    // Stale guard: discard if user opened a different topic while AI was running
    if (currentExplainerTopic !== topic) { stopProg(); return; }
    let data = null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { data = JSON.parse(m[0]); } catch { data = null; } }
    if (!data) throw new Error('Keine Erklärung erhalten');
    lernenTopicData = data;
    localforage.setItem(lernenCacheKey(topic), data).catch(() => {});
    stopProg();
    renderTopicContent(topic, data);
  } catch (e) {
    // Stale guard: don't show error for a topic the user already navigated away from
    if (currentExplainerTopic !== topic) { stopProg(); return; }
    stopProg();
    document.getElementById('lernen-erkl-loading').style.display = 'none';
    const body = document.getElementById('lernen-erkl-body');
    body.innerHTML = `<p style="color:var(--red);padding:16px;margin:0">⚠️ ${esc(e.message)}</p>
      <div style="padding:8px 16px 16px">
        <button class="btn-secondary" onclick="retryLernenTopic()">🔄 Erneut versuchen</button>
      </div>`;
    body.classList.remove('hidden');
  }
}

function retryLernenTopic() {
  const topic = currentExplainerTopic;
  if (!topic) return;
  document.getElementById('lernen-erkl-loading').style.display = '';
  document.getElementById('lernen-erkl-body').classList.add('hidden');
  document.getElementById('lernen-step1-footer').classList.add('hidden');
  document.getElementById('lernen-done-btn').classList.add('hidden');
  loadTopicContent(topic);
}

async function regenLernenTask() {
  const topic = currentExplainerTopic;
  if (!topic || !lernenTopicData) return;
  const btn = document.getElementById('lernen-regen-btn');
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const effLevel = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
    const diffInstr = getDiffInstr(effLevel);
    const ctx = sessionTxt ? sessionTxt.slice(0, 2000) : '';
    const raw = await claudeLocal(
      [{ role: 'user', content: `Generiere eine neue Übungsaufgabe zum Thema "${topic}".` }],
      [{
        type: 'text',
        text: `Generiere eine NEUE, andere Übungsaufgabe zum Thema "${topic}".\n${ctx ? `Kontext: ${ctx}\n` : ''}${diffInstr}\n\nDie Aufgabe muss dem Niveau entsprechen (Komplexität, Sprache, Tiefe).\nBei mehreren Teilfragen jede Frage auf einer neuen Zeile (\\n\\n).\nNIEMALS Lösungen, Musterlösungen oder Hinweise auf die richtigen Antworten im Aufgabentext!\n\nAntworte NUR als JSON:\n{"aufgabe":"Aufgabentext ohne Lösungen. Jede Teilfrage auf eigener Zeile."}`,
      }],
      600
    );
    const m = raw.match(/\{[\s\S]*\}/);
    let newAufgabe = null;
    if (m) { try { newAufgabe = JSON.parse(m[0]).aufgabe; } catch {} }
    if (newAufgabe && newAufgabe.trim()) {
      lernenTopicData.aufgabe = newAufgabe;
      document.getElementById('lernen-task-bar').innerHTML = safeHtml(md(newAufgabe));
      localforage.setItem(lernenCacheKey(topic), lernenTopicData).catch(() => {});
      // Clear canvas for fresh start
      if (lernenCtx) {
        const wrap = document.getElementById('lernen-canvas-wrap');
        lernenCtx.fillStyle = '#ffffff';
        lernenCtx.fillRect(0, 0, wrap.clientWidth, wrap.clientHeight);
      }
      document.getElementById('lernen-done-btn').classList.add('hidden');
      const rb = document.getElementById('lernen-result-bar');
      if (rb) { rb.innerHTML = ''; rb.className = 'lernen-result-bar hidden'; }
      toast('Neue Aufgabe generiert', 'success', 2000);
    } else {
      toast('Keine neue Aufgabe erhalten', 'warn');
    }
  } catch (e) { toast('Fehler: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '🔄 Neue Aufgabe';
}

function initLernenCanvas() {
  const canvas = document.getElementById('lernen-canvas');
  const wrap   = document.getElementById('lernen-canvas-wrap');
  if (!canvas || !wrap || lernenCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const w   = wrap.clientWidth  || 800;
  const h   = wrap.clientHeight || 600;
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  lernenCtx = canvas.getContext('2d');
  lernenCtx.scale(dpr, dpr);
  lernenCtx.fillStyle = '#ffffff';
  lernenCtx.fillRect(0, 0, w, h);
  lernenCtx.lineCap  = 'round';
  lernenCtx.lineJoin = 'round';
  // Remove any old listeners first (prevent accumulation across topic switches)
  canvas.removeEventListener('pointerdown',   onLernenDown);
  canvas.removeEventListener('pointermove',   onLernenMove);
  canvas.removeEventListener('pointerup',     onLernenUp);
  canvas.removeEventListener('pointercancel', onLernenUp);
  canvas.addEventListener('pointerdown',   onLernenDown,   { passive: false });
  canvas.addEventListener('pointermove',   onLernenMove,   { passive: false });
  canvas.addEventListener('pointerup',     onLernenUp);
  canvas.addEventListener('pointercancel', onLernenUp);
}

function onLernenDown(e) {
  e.preventDefault();
  // Palm rejection: ignore secondary pointers once a stroke is active
  if (lernenActivePtr !== null) return;
  lernenActivePtr = e.pointerId;
  e.target.setPointerCapture(e.pointerId); // keep events even if pointer leaves canvas
  const r = e.target.getBoundingClientRect();
  lernenLastX = e.clientX - r.left;
  lernenLastY = e.clientY - r.top;
  isDrawingLernen = true;
}

function onLernenMove(e) {
  if (!isDrawingLernen || !lernenCtx) return;
  if (e.pointerId !== lernenActivePtr) return; // palm rejection
  e.preventDefault();
  const r    = e.target.getBoundingClientRect();
  // getCoalescedEvents captures all intermediate points during fast strokes
  const pts  = (e.getCoalescedEvents ? e.getCoalescedEvents() : null) || [e];
  for (const pt of pts) {
    const x = pt.clientX - r.left;
    const y = pt.clientY - r.top;
    lernenCtx.beginPath();
    lernenCtx.moveTo(lernenLastX, lernenLastY);
    lernenCtx.lineTo(x, y);
    if (lernenTool === 'eraser') {
      lernenCtx.globalCompositeOperation = 'destination-out';
      lernenCtx.lineWidth = 22;
    } else {
      lernenCtx.globalCompositeOperation = 'source-over';
      lernenCtx.strokeStyle = lernenPenColor;
      lernenCtx.lineWidth   = 2.5;
    }
    lernenCtx.stroke();
    lernenLastX = x; lernenLastY = y;
  }
}

function onLernenUp(e) {
  if (e.type === 'pointercancel' || e.pointerId === lernenActivePtr) {
    lernenActivePtr = null;
    isDrawingLernen = false;
  }
}

async function checkLernenSolution() {
  if (!lernenTopicData) return;
  const checkBtn = document.getElementById('lernen-check-btn');
  checkBtn.disabled = true; checkBtn.textContent = '…';
  try {
    let ev;
    if (lernenAnswerMode === 'text') {
      const answerText = document.getElementById('lernen-text-answer').value.trim();
      if (!answerText) {
        toast('Bitte zuerst eine Antwort eingeben.', 'warn', 3000);
        checkBtn.disabled = false; checkBtn.textContent = '✅ Prüfen';
        return;
      }
      const raw = await claudeLocal(
        [{ role: 'user', content: `Aufgabe: ${lernenTopicData.aufgabe}\n\nAntwort des Studenten: ${answerText}` }],
        [{ type: 'text', text: `Bewerte die Antwort des Studenten SEHR STRENG und GENAU. Bei Rechenaufgaben: Berechne das korrekte Ergebnis selbst und vergleiche exakt.\nAntworte NUR als JSON:\n{"score":0,"feedback":"Kurzes Feedback was richtig/falsch war","loesung":"Vollständiger Rechenweg mit Ergebnis"}\nscore: 2=Ergebnis korrekt (Rundungsfehler OK), 1=Ansatz richtig aber Rechenfehler/unvollständig, 0=falsch oder zu wenig` }],
        600
      );
      const mv = raw.match(/\{[\s\S]*\}/);
      if (!mv) throw new Error('Keine Auswertung');
      ev = JSON.parse(mv[0]);
    } else {
      if (!lernenCtx) return;
      const canvas = document.getElementById('lernen-canvas');
      const flat = document.createElement('canvas');
      flat.width = canvas.width; flat.height = canvas.height;
      const fc = flat.getContext('2d');
      fc.fillStyle = '#fff'; fc.fillRect(0, 0, flat.width, flat.height);
      fc.drawImage(canvas, 0, 0);
      const base64 = flat.toDataURL('image/png').split(',')[1];
      const result = await claudeLocalVision(
        base64,
        `Aufgabe: ${lernenTopicData.aufgabe}\n\nBewerte die handschriftliche Lösung des Studenten SEHR STRENG und GENAU:\n- Bei Rechenaufgaben: Berechne die korrekte Antwort selbst und vergleiche exakt mit dem Endergebnis im Bild.\n- score:2 NUR wenn das finale Ergebnis korrekt oder mit akzeptablem Rundungsfehler (<1%) übereinstimmt.\n- score:1 wenn der Ansatz/Rechenweg richtig ist, aber das Ergebnis falsch oder unvollständig.\n- score:0 wenn Ansatz falsch oder kein verwertbares Ergebnis.\nAntworte NUR als JSON:\n{"score":0,"feedback":"Kurzes Feedback was richtig/falsch war","loesung":"Vollständiger Rechenweg mit Ergebnis"}`,
        sysBlocks()
      );
      const mv = result.match(/\{[\s\S]*\}/);
      if (!mv) throw new Error('Keine Auswertung');
      ev = JSON.parse(mv[0]);
    }
    const ok = ev.score >= 1;
    // Show permanent result bar
    const resultBar = document.getElementById('lernen-result-bar');
    if (resultBar) {
      resultBar.className = `lernen-result-bar lernen-result-bar--${ok ? 'ok' : 'fail'}`;
      resultBar.innerHTML =
        `<span class="lernen-result-verdict lernen-result-verdict--${ok ? 'ok' : 'fail'}">${ok ? '✅' : '❌'} ${esc(ev.feedback || '')}</span>` +
        (ev.loesung ? `<span class="lernen-result-solution">📌 <strong>Musterlösung:</strong> ${esc(ev.loesung)}</span>` : '');
    }
    if (ok) document.getElementById('lernen-done-btn').classList.remove('hidden');
  } catch (e) { toast('Fehler beim Prüfen: ' + e.message, 'error'); }
  checkBtn.disabled = false; checkBtn.textContent = '✅ Prüfen';
}

async function lernenQaSend() {
  const input = document.getElementById('lernen-qa-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  const msgs = document.getElementById('lernen-qa-msgs');
  const uEl = document.createElement('div');
  uEl.className = 'rechnen-ask-msg rechnen-ask-user';
  uEl.textContent = text;
  msgs.appendChild(uEl);

  lernenQaMsgs.push({ role: 'user', content: text });

  const aEl = document.createElement('div');
  aEl.className = 'rechnen-ask-msg rechnen-ask-ai';
  aEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  msgs.appendChild(aEl);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const aufgCtx = lernenTopicData?.aufgabe
      ? `\n\nAKTUELLE ÜBUNGSAUFGABE DES STUDENTEN:\n"${lernenTopicData.aufgabe}"\nDer Student arbeitet gerade an dieser Aufgabe. Beantworte Fragen dazu direkt und konkret. Korrigiere Rechenfehler präzise, erkläre den richtigen Lösungsweg Schritt für Schritt.`
      : '';
    const reply = await claudeLocal(
      lernenQaMsgs,
      sysBlocks(`Beantworte Fragen zum Thema "${currentExplainerTopic}" kurz und verständlich.${aufgCtx}`),
      600
    );
    lernenQaMsgs.push({ role: 'assistant', content: reply });
    aEl.innerHTML = safeHtml(md(reply));
    if (window.mermaid) mermaid.run({ nodes: aEl.querySelectorAll('.mermaid') }).catch(() => {});
  } catch (e) { aEl.textContent = '⚠️ ' + e.message; }
  msgs.scrollTop = msgs.scrollHeight;
}

async function markTopicDone() {
  const topic = currentExplainerTopic;
  if (!topic || !sessionId) return;
  closeLernenTopic();
  if (!learnedTopics.includes(topic)) {
    learnedTopics.push(topic);
    fetch(`/api/subjects/${sessionId}/learned-topics`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ topic }),
    }).catch(() => {});
  }
  renderMilestone();
  loadLernpfad();
  toast(`✅ "${topic}" als gelernt markiert`, 'success', 2500);
}

document.getElementById('lernpfad-scan-btn')?.addEventListener('click', async () => {
  if (!sessionTxt) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  const btn = document.getElementById('lernpfad-scan-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const raw = await claudeLocal(
      [{ role: 'user', content: 'Welche Hauptthemen gibt es in den Unterlagen?' }],
      sysBlocks(`Analysiere den Lernstoff und erstelle eine Liste der wichtigsten Themen.
Antworte NUR als JSON-Array mit maximal 12 kurzen Thema-Strings (max. 4 Wörter je Thema):
["Thema 1", "Thema 2", ...]`),
      400
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Themen erkannt');
    const topics = JSON.parse(m[0]).filter(t => typeof t === 'string').slice(0, 12);
    if (!topics.length) throw new Error('Keine Themen gefunden');
    scannedTopics = topics;
    fetch(`/api/subjects/${sessionId}/topics`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ topics: scannedTopics }),
    }).catch(() => {});
    renderMilestone();
    loadLernpfad();
    toast('Lernpfad wurde erstellt!', 'success');
  } catch (e) {
    toast('Fehler beim Erkennen: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Themen erkennen';
  }
});

// Answer mode toggle (canvas ↔ text)
document.getElementById('lernen-mode-canvas')?.addEventListener('click', () => {
  lernenAnswerMode = 'canvas';
  document.getElementById('lernen-mode-canvas').classList.add('active');
  document.getElementById('lernen-mode-text').classList.remove('active');
  document.getElementById('lernen-draw-tools').style.display = 'contents';
  document.getElementById('lernen-canvas-wrap').classList.remove('hidden');
  document.getElementById('lernen-text-wrap').classList.add('hidden');
  requestAnimationFrame(initLernenCanvas);
});
document.getElementById('lernen-mode-text')?.addEventListener('click', () => {
  lernenAnswerMode = 'text';
  document.getElementById('lernen-mode-text').classList.add('active');
  document.getElementById('lernen-mode-canvas').classList.remove('active');
  document.getElementById('lernen-draw-tools').style.display = 'none';
  document.getElementById('lernen-canvas-wrap').classList.add('hidden');
  const wrap = document.getElementById('lernen-text-wrap');
  wrap.classList.remove('hidden');
  // CSS flex handles height; JS fallback only if flex hasn't settled (iOS)
  setTimeout(() => {
    const ta = document.getElementById('lernen-text-answer');
    if (!ta) return;
    if (!ta.style.height && wrap.clientHeight > 60) {
      ta.style.height = (wrap.clientHeight - 28) + 'px';
    }
    ta.focus();
  }, 80);
});

// Lernen topic view controls
document.getElementById('lernen-back-btn')?.addEventListener('click', closeLernenTopic);
document.getElementById('lernen-to-task-btn')?.addEventListener('click', () => lernenSwitchStep(2));
document.getElementById('lernen-check-btn')?.addEventListener('click', checkLernenSolution);
document.getElementById('lernen-done-btn')?.addEventListener('click', markTopicDone);
document.getElementById('lernen-regen-btn')?.addEventListener('click', regenLernenTask);
document.getElementById('lernen-clear-btn')?.addEventListener('click', () => {
  if (!lernenCtx) return;
  const wrap = document.getElementById('lernen-canvas-wrap');
  lernenCtx.fillStyle = '#fff';
  lernenCtx.fillRect(0, 0, wrap.clientWidth, wrap.clientHeight);
});
document.querySelectorAll('.lernen-step-tab').forEach(t => t.addEventListener('click', () => {
  if (!t.disabled) lernenSwitchStep(+t.dataset.lstep);
}));
document.querySelectorAll('[data-ltool]').forEach(b => b.addEventListener('click', () => {
  lernenTool = b.dataset.ltool;
  document.querySelectorAll('[data-ltool]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));
document.querySelectorAll('[data-lcolor]').forEach(b => b.addEventListener('click', () => {
  lernenPenColor = b.dataset.lcolor;
  lernenTool = 'pen';
  document.querySelectorAll('[data-lcolor]').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('[data-ltool]').forEach(x => x.classList.toggle('active', x.dataset.ltool === 'pen'));
  b.classList.add('active');
}));
document.getElementById('lernen-qa-btn')?.addEventListener('click', () => {
  document.getElementById('lernen-qa-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('lernen-qa-input')?.focus(), 300);
});
document.getElementById('lernen-qa-close-btn')?.addEventListener('click', () =>
  document.getElementById('lernen-qa-overlay').classList.add('hidden'));
document.getElementById('lernen-qa-bg')?.addEventListener('click', () =>
  document.getElementById('lernen-qa-overlay').classList.add('hidden'));
document.getElementById('lernen-qa-send-btn')?.addEventListener('click', lernenQaSend);
document.getElementById('lernen-qa-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') lernenQaSend();
});

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
  try { await initDarkMode(); } catch (_) { applyDarkMode(false); }
  try { renderStreak(); } catch (_) {}
  try {
    await checkAuth();
  } catch (_) {
    showScreen('auth-screen');
  }
})();

// ── Service Worker ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
