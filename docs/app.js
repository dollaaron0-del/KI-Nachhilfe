'use strict';

// Einzige Quelle der Wahrheit für die laufende Version. Wird unten ins
// #app-version-Label geschrieben → zeigt, welcher app.js wirklich geladen ist
// (statt eines fest verdrahteten, veraltenden Texts in index.html). Bei jedem
// Asset-Bump hier UND in index.html (?v=) UND in sw.js erhöhen.
const APP_VERSION = '182';
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('app-version');
  if (!el) return;
  el.textContent = 'v' + APP_VERSION;
});

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

// App-eigener Bestätigungs-Dialog (ersetzt native confirm()): styling-bar,
// blockiert nicht den JS-Thread und passt in die PWA. Gibt ein Promise<boolean>.
function confirmDialog(message, {
  title = 'Bestätigen', okText = 'OK', cancelText = 'Abbrechen', danger = false,
} = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" role="alertdialog" aria-modal="true">
        <div class="confirm-title"></div>
        <div class="confirm-msg"></div>
        <div class="confirm-actions">
          <button class="confirm-cancel" type="button"></button>
          <button class="confirm-ok${danger ? ' danger' : ''}" type="button"></button>
        </div>
      </div>`;
    // Texte via textContent setzen → kein HTML-Injection-Risiko bei Dateinamen etc.
    overlay.querySelector('.confirm-title').textContent  = title;
    overlay.querySelector('.confirm-msg').textContent    = message;
    overlay.querySelector('.confirm-cancel').textContent = cancelText;
    overlay.querySelector('.confirm-ok').textContent     = okText;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    let done = false;
    const close = val => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('show');
      const drop = () => overlay.remove();
      overlay.addEventListener('transitionend', drop, { once: true });
      setTimeout(drop, 300); // Fallback, falls transitionend ausbleibt
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter')  { e.preventDefault(); close(true);  }
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => { haptic(20); close(true); });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.querySelector('.confirm-ok').focus();
  });
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
      const r = await fetch(`/api/auth/approval-status?username=${encodeURIComponent(username)}`); // raw-fetch-ok: Polling vor Login, noch kein Token
      if (!r.ok) return;
      const data = await r.json();
      if (!data.approved) return;
      stopApprovalPolling();
      // Auto-login with stored credentials
      const lr = await fetch('/api/auth/login', { // raw-fetch-ok: Login erzeugt erst das Token
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
    const r = await fetch(`/api/auth/${authMode}`, { // raw-fetch-ok: Login/Register vor Token, eigenes 202-Pending-Handling
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

// Demo ansehen: meldet sich am festen, vorab freigeschalteten Demo-Account an
// (ohne Registrierung/Telegram-Freischaltung). Existiert noch kein Demo-Fach,
// wird es einmalig automatisch geseedet, damit die Demo sofort gefüllt ist.
document.getElementById('auth-demo-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('auth-demo-btn');
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden'); errEl.style.color = '';
  btn.disabled = true; const label = btn.textContent; btn.textContent = '…';
  try {
    stopApprovalPolling();
    const r = await fetch('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' } }); // raw-fetch-ok: erzeugt erst das Token
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Demo nicht verfügbar.'; errEl.classList.remove('hidden'); return; }
    authToken    = data.token;
    authUsername = data.username;
    authIsAdmin  = false;
    localStorage.setItem('auth_token',    authToken);
    localStorage.setItem('auth_username', authUsername);
    localStorage.setItem('auth_is_admin', '0');
    onAuthSuccess();
    // Demo-Fach nur beim allerersten Mal anlegen – danach ist es im Account vorhanden.
    const subs = await DB.subjects();
    if (!subs.length) await loadDemoSubject();
  } catch (e) {
    errEl.textContent = 'Verbindungsfehler.'; errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
  authToken = ''; authUsername = '';
  localStorage.removeItem('auth_token'); localStorage.removeItem('auth_username');
  localforage.removeItem('subjects_cache').catch(() => {}); // kein Fremd-Fächer-Flash beim nächsten Login
  showScreen('auth-screen');
});

function onAuthSuccess() {
  sessionExpiredHandled = false;  // a fresh session can expire again later
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
    const r = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${authToken}` } }); // raw-fetch-ok: Token-Validierung, eigene 401-Logik
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
let examDocContext  = '';
let customPrompt    = '';
let prefCalculator  = '';
let currentFeature  = 'chat';
let selIcon      = ICONS[0];
let selColor     = COLORS[0];
let selDiff      = 'mittel';
let selAufgabenDiff = 'mittel';
let examAnsVis   = false;
let blitzIdx       = 0;
let blitzResults   = [];
let blitzNext      = null;      // Prefetch: { promise, forIdx } – nächste Blitz-Frage vorab geladen
let scannedTopics  = [];
let moduleStructure = null; // { kapitel: [{titel, lernziel, themen:[...]}], ids:{normName:tid} }
let topicUids      = {};    // { normName: "t_xxxxxxxx" } – stabile IDs, an denen Fortschritt hängt
let selTopic       = null;
let selAufgabenType = 'uebung';
let aufgabenAnsVis  = false;
let currentAufgabe  = '';
let currentCheatText     = '';
let currentAufgabenResult = '';
let currentExamText      = '';
let learnedTopics        = [];
let currentExplainerTopic = null;
let currentUnit          = null;   // aktuelle Lerneinheit (1 Thema ODER zusammengesetzt, s. pathUnits)
let rechnenDiff     = 'mittel';
let rechnenLastFeedback = '';   // letztes Prüf-Feedback derselben Aufgabe (konsistente Re-Prüfung)
let rechnenNextTask = null;     // Prefetch: { promise, diff, forSession } – nächste Aufgabe vorab geladen
let rechnenLoesung  = null;     // Prefetch: { aufgabe, promise, text } – Musterlösung vorab generiert
let mathCtx         = null;
let isDrawingCanvas = false;
let isErasing       = false;
let canvasLastX     = 0, canvasLastY = 0;
let canvasLastMidX  = 0, canvasLastMidY = 0; // letzter Kurven-Mittelpunkt (Glättung)
let canvasPtBuf     = [];             // gepufferte Punkte, einmal pro Frame gezeichnet (rAF)
let canvasRaf       = 0;              // laufende requestAnimationFrame-ID (0 = keine)
// Striche als Vektoren (Punkt-Listen) statt Bitmap-Snapshots. Damit kostet das
// Strich-Ende KEIN getImageData mehr (auf dem iPad ~24 MB GPU-Readback, der beim
// schnellen Schreiben zwischen jedem kurzen Strich stockte). Undo/Redo = neu zeichnen.
let strokes         = [];             // committete Striche: { tool, color, size, pts:[{x,y,p}] }
let redoStrokes     = [];             // für Redo zurückgelegte Striche
let currentStroke   = null;           // gerade in Arbeit
let baseImage       = null;           // geladenes PNG (Vorsession) als Hintergrund-Ebene
let penActive       = false;          // Stift liegt gerade auf → Touch komplett ignorieren (Palm-Rejection)
let canvasPenId     = null;           // PointerId des aktuell zeichnenden Stifts (nur dieser malt)
let canvasDownTime  = 0;              // timeStamp des laufenden Strich-Beginns – verwirft veraltete up/cancel-Events (Apple Pencil recycelt pointerId)
let fingerScrollId  = null;           // PointerId des Fingers, der gerade scrollt
let fingerStartY    = 0;
let wrapScrollStart = 0;
let savedCanvasData = null;
let penColor        = '#1c1c1e';
let penSize         = 'medium';   // 'fine' | 'medium' | 'thick'
let activeTool      = 'pen';      // 'pen' | 'eraser' | 'highlighter' | 'line'

// ── DB (server-backed) ────────────────────────────────────────────────────
// Session-expiry handling. A 401 from any api() call means the token is gone or
// expired; without this the many `.catch(() => [])` call sites would just show
// empty data with no hint to re-login. Idempotent so parallel 401s (e.g. the
// burst of loads on a page open) only redirect once.
let sessionExpiredHandled = false;
function handleAuthExpired() {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  authToken = ''; authUsername = '';
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_username');
  localStorage.removeItem('auth_is_admin');
  localforage.removeItem('subjects_cache').catch(() => {}); // kein Fremd-Fächer-Flash beim nächsten Login
  stopApprovalPolling();
  showScreen('auth-screen');
  toast('Deine Sitzung ist abgelaufen – bitte melde dich neu an.', 'warn', 5000);
}

const api = (url, opts = {}) =>
  fetch(url, {
    headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
    ...opts,
  }).then(r => {
    if (r.status === 401) { handleAuthExpired(); throw new Error('Sitzung abgelaufen'); }
    return r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); });
  });

const DB = {
  // ── Server ──────────────────────────────────────────────────────────────
  subjects:     () => api('/api/subjects').catch(() => []),
  addSubject:   s  => api('/api/subjects', { method: 'POST', body: JSON.stringify({ id: s.id, name: s.name, emoji: s.icon || s.emoji || '📚', color: s.color || '#5856d6' }) }),
  delSubject:   id => api(`/api/subjects/${id}`, { method: 'DELETE' }),

  messages:     id => api(`/api/subjects/${id}/messages`).catch(() => []),
  addMessage:   (id, role, content) => api(`/api/subjects/${id}/messages`, {
    method: 'POST', body: JSON.stringify({ role, content }),
  }).catch(() => {}),
  clearMessages: id => api(`/api/subjects/${id}/messages`, { method: 'DELETE' }),

  cards:    id    => api(`/api/subjects/${id}/cards`).catch(() => []),
  setCards: (id, cards) => api(`/api/subjects/${id}/cards`, {
    method: 'POST', body: JSON.stringify({ cards }),
  }),

  addQuizResult: (id, score, total) => api(`/api/subjects/${id}/quiz`, {
    method: 'POST', body: JSON.stringify({ score, total }),
  }).catch(() => {}),
  quizResults: id => api(`/api/subjects/${id}/quiz`).catch(() => []),

  streak: async () => {
    try { const s = await api('/api/streak'); return { count: s.count, lastDate: s.last_date }; }
    catch { return { count: 0, lastDate: null }; }
  },
  setStreak: v => api('/api/streak', {
    method: 'POST', body: JSON.stringify({ count: v.count, last_date: v.lastDate }),
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
  saveAufgabe: (id, entry) => api(`/api/subjects/${id}/aufgaben`, {
    method: 'POST', body: JSON.stringify(entry),
  }).catch(() => {}),
  delAufgabe: (id, entryId) => api(`/api/subjects/${id}/aufgaben/${entryId}`, {
    method: 'DELETE',
  }).catch(() => {}),

  async del(id) {
    await Promise.all([
      this.delSubject(id),
      localforage.removeItem(`meta_${id}`),
      localforage.removeItem(`cnt_${id}`),
      api(`/api/subjects/${id}/cheat`,  { method: 'DELETE' }).catch(() => {}),
      api(`/api/subjects/${id}/topics`, { method: 'DELETE' }).catch(() => {}),
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
  const r = await fetch('/api/claude', { // raw-fetch-ok: eigene friendlyApiError-Behandlung + content[0].text
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens, subject_id: sessionId, feature: currentFeature }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(friendlyApiError(e.error, r.status));
  }
  return (await r.json()).content[0].text;
}

// ── Local model via Ollama (free, for batch tasks) ────────────────────────
async function claudeLocal(messages, systemBlocks, maxTokens = 2000, opts = {}) {
  const r = await fetch('/api/local', { // raw-fetch-ok: eigene Fehlerbehandlung + content[0].text
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens, feature: currentFeature, ...opts }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

// Escape the most common local-model JSON breakage: literal newline/CR/tab
// characters inside string values, which make JSON.parse throw.
function repairJson(s) {
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

// Tolerant JSON.parse for an already-extracted object/array string: retries
// once with the repair pass. Throws (like JSON.parse) if still unparseable, so
// callers' existing try/catch keep working — but the common newline case now
// recovers instead of failing the whole feature.
function parseJsonLoose(str) {
  try { return JSON.parse(str); } catch {}
  return JSON.parse(repairJson(str));
}

// Extract and parse the first JSON object from a model response.
// Handles plain JSON, code-fenced ```json...``` blocks, and the most common
// local-model failure mode: literal newline/CR characters inside string values.
function parseJsonResponse(raw) {
  function tryParse(s) {
    try { return JSON.parse(s); } catch {}
    try { return JSON.parse(repairJson(s)); } catch {}
    return null;
  }
  const cb = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (cb) { const r = tryParse(cb[1]); if (r) return r; }
  const ob = raw.match(/\{[\s\S]*\}/);
  if (ob) { const r = tryParse(ob[0]); if (r) return r; }
  // Last resort: max_tokens hat das JSON mitten im String gekappt (keine
  // schließende "}") – längsten gültigen Präfix retten, offene Strings/Klammern
  // schließen. Rettet z.B. eine Blitz-Frage, deren "explanation" abgeschnitten ist.
  return salvageTruncatedJson(raw) || null;
}

// Versucht, ein abgeschnittenes JSON-Objekt zu reparieren: kürzt vom Ende her,
// schließt einen offenen String und die offenen {} / [] und parst den längsten
// Teil, der noch valide ist. Gibt null zurück, wenn nichts zu retten ist.
function salvageTruncatedJson(raw) {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const s = raw.slice(start);
  for (let end = s.length; end > 1; end--) {
    const frag = s.slice(0, end);
    let inStr = false, esc = false;
    const stack = [];
    for (const c of frag) {
      if (esc)        { esc = false; continue; }
      if (c === '\\') { esc = true;  continue; }
      if (c === '"')  { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') stack.pop();
    }
    let cand = frag;
    if (inStr) cand += '"';
    cand = cand.replace(/[,:]\s*$/, '');       // hängendes Komma/Doppelpunkt kappen
    for (let i = stack.length - 1; i >= 0; i--) cand += stack[i];
    try { return JSON.parse(cand); } catch {}
    try { return JSON.parse(repairJson(cand)); } catch {}
  }
  return null;
}

async function claudeLocalStream(messages, systemBlocks, maxTokens = 3000, onToken) {
  const r = await fetch('/api/local/stream', { // raw-fetch-ok: SSE-Streaming, liest body als Stream
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error(`Serverfehler ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = '', buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // Keep the trailing (possibly incomplete) line for the next chunk.
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (d === '[DONE]') return full;
      let parsed;
      try { parsed = JSON.parse(d); }
      catch { continue; }   // ignore malformed/partial lines, never abort the stream
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.token) { full += parsed.token; onToken(full); }
    }
  }
  return full;
}

// ── Local vision via Ollama (falls back to cloud if model not available) ──
async function claudeLocalVision(base64, textPrompt, systemBlocks, maxTokens = 1500) {
  try {
    const r = await fetch('/api/local/vision', { // raw-fetch-ok: eigener Cloud-Fallback bei Fehler
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
  const r = await fetch('/api/claude', { // raw-fetch-ok: Vision-Aufruf, eigene friendlyApiError-Behandlung
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
// Liefert den Lernstoff für Prompts. Bei sehr großem Material (viele Dokumente)
// wird gleichmäßig über Anfang, Mitte und Ende gesampelt, damit ALLE Themen
// abgedeckt sind – nicht nur die ersten Seiten des ersten Dokuments.
function docsForPrompt(limit = 40000) {
  if (!sessionTxt) {
    return '(noch keine Dokumente hochgeladen – weise den Studenten darauf hin, Unterlagen hochzuladen)';
  }
  if (sessionTxt.length <= limit) return sessionTxt;
  const headLen = Math.floor(limit * 0.45);
  const midLen  = Math.floor(limit * 0.30);
  const tailLen = limit - headLen - midLen;
  const midStart = Math.floor(sessionTxt.length / 2 - midLen / 2);
  const head = sessionTxt.slice(0, headLen);
  const mid  = sessionTxt.slice(midStart, midStart + midLen);
  const tail = sessionTxt.slice(sessionTxt.length - tailLen);
  return `${head}\n\n[…Auszug aus der Mitte der Unterlagen…]\n\n${mid}\n\n[…Auszug vom Ende der Unterlagen…]\n\n${tail}`;
}

// Fetches a short snippet from EVERY document individually → breadth-first coverage.
// Fixes the bias where docsForPrompt() would return only the first documents' content.
async function buildDocOverview() {
  if (!sessionId) return null;
  try {
    const docs = await api(`/api/subjects/${sessionId}/documents/snippets`);
    if (!Array.isArray(docs) || !docs.length) return null;
    return docs.map(d => `[Dokument: ${d.filename}]\n${d.snippet}`).join('\n\n---\n\n');
  } catch { return null; }
}

function sysBlocks(extra = '') {
  const blocks = [
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
${docsForPrompt()}
--- ENDE DER UNTERLAGEN ---

DIAGRAMME: Wenn es das Verständnis fördert, erstelle Mermaid-Diagramme in \`\`\`mermaid ... \`\`\` Blöcken.
Verfügbare Typen: flowchart TD (Abläufe/Strukturen), mindmap (Konzepte), sequenceDiagram (Prozesse/Interaktionen).
Halte Diagramme einfach – max. 8 Knoten. Nur einsetzen wenn es wirklich hilft.

MATHEMATIK: Für mathematische Formeln und Gleichungen verwende LaTeX-Notation.
Inline-Formeln: $E = mc^2$  |  Block-Formeln (zentriert, groß): $$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$
Verwende LaTeX immer wenn Formeln, Gleichungen, Summen, Integrale, Matrizen oder griechische Buchstaben vorkommen.

Antworte immer auf Deutsch.${prefCalculator ? `\n\nTASCHENRECHNER: Der Student nutzt einen ${prefCalculator}. Gib bei Rechenaufgaben gezielte Tipps wie man die Berechnung auf diesem Modell effizient eingibt — Tasten, Menüpfade, Modi, nützliche eingebaute Funktionen. Erwähne konkrete Schritte (z.B. "Drücke MENU → 4 → 2" beim Casio).` : ''}${customPrompt ? '\n\n--- PERSÖNLICHE ANWEISUNGEN DES STUDENTEN ---\n' + customPrompt + '\n--- ENDE ---' : ''}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  // Aufruf-spezifische Instruktionen (z.B. Quiz-Prompt mit der Liste bereits
  // gestellter Fragen) wechseln pro Anfrage. Sie kommen in einen EIGENEN, nicht
  // gecachten Block NACH dem Cache-Breakpoint – so bleibt der teure Unterlagen-
  // Block byte-identisch und der Prompt-Cache greift über alle Fragen hinweg.
  if (extra) blocks.push({ type: 'text', text: extra });
  return blocks;
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
    loadAdminUserStats();
    // Show pending user count badge
    api('/api/admin/pending-count').then(r => {
      const btn = document.getElementById('admin-users-btn');
      if (btn && r.count > 0) btn.textContent = `👥 Benutzer verwalten · ${r.count} ausstehend ⚠️`;
      else if (btn) btn.textContent = '👥 Benutzer verwalten';
    }).catch(() => {});
  } catch { /* ignore */ }
}


async function loadAdminUserStats() {
  const el = document.getElementById('admin-user-stats');
  if (!el) return;
  try {
    const { users, limit } = await api('/api/admin/user-stats');
    if (!users.length) { el.innerHTML = '<span style="font-size:13px;color:var(--text2);">Keine Nutzer</span>'; return; }
    el.innerHTML = users.map(u => {
      const pct = Math.min(100, (u.today_cost / limit) * 100);
      const col  = pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--yellow)' : 'var(--accent)';
      const status = !u.approved ? '⏳' : '✅';
      return `<div style="background:var(--bg);border-radius:10px;padding:8px 10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-weight:600;font-size:13px;">${status} ${esc(u.username)}</span>
          <span style="font-size:12px;color:var(--text2);">${u.today_cost.toFixed(3)}€ heute · ${u.total_cost.toFixed(2)}€ gesamt</span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${pct.toFixed(1)}%;background:${col};border-radius:2px;transition:width .4s;"></div>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px;">${u.today_calls} Aufrufe heute · ${u.total_calls} gesamt</div>
      </div>`;
    }).join('');
  } catch (e) { if (el) el.innerHTML = `<span style="color:var(--red);font-size:13px;">${e.message}</span>`; }
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
document.getElementById('admin-users-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('admin-users-sheet').classList.add('hidden');
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
  if (!await confirmDialog(`Benutzer "${username}" wirklich löschen? Alle Daten werden entfernt.`,
      { title: 'Benutzer löschen', okText: 'Löschen', danger: true })) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    toast(`${username} gelöscht`, 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

// ══ SUBJECTS SCREEN ════════════════════════════════════════════════════════

function renderSubjects(list) {
  const grid  = document.getElementById('subj-grid');
  const empty = document.getElementById('subj-empty');
  grid.innerHTML = '';
  if (!list.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.forEach(s => grid.appendChild(makeCard(s)));
}

async function loadSubjects() {
  // 1) Sofort aus lokalem Cache zeichnen – kein leerer Screen während des
  //    Server-Roundtrips (stale-while-revalidate).
  let shownCache = false;
  try {
    const cached = await localforage.getItem('subjects_cache');
    if (cached) { renderSubjects(cached); shownCache = true; }
  } catch {}
  // 2) Frische Liste vom Server holen und still aktualisieren. Bei Server-Fehler
  //    bleibt die gecachte Ansicht stehen, statt sie fälschlich zu leeren.
  let list;
  try { list = await api('/api/subjects'); }
  catch { if (!shownCache) renderSubjects([]); return; }
  renderSubjects(list);
  localforage.setItem('subjects_cache', list).catch(() => {});
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
    if (!await confirmDialog(`"${s.name}" löschen? Alle Daten gehen verloren.`,
        { title: 'Fach löschen', okText: 'Löschen', danger: true })) return;
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

document.getElementById('subj-modal')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('subj-modal').classList.add('hidden');
});

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

// ══ DEMO / PRÄSENTATION ════════════════════════════════════════════════════

const DEMO_DOC = `Die Photosynthese

1. Überblick
Die Photosynthese ist der Prozess, mit dem grüne Pflanzen, Algen und einige Bakterien aus Lichtenergie chemische Energie gewinnen. Dabei werden Kohlenstoffdioxid (CO2) und Wasser (H2O) mithilfe von Lichtenergie in Glucose (Traubenzucker, C6H12O6) und Sauerstoff (O2) umgewandelt. Die Photosynthese ist damit eine endergone Reaktion: Es wird Energie (Licht) aufgenommen und in den chemischen Bindungen der Glucose gespeichert.

Wortgleichung:
Kohlenstoffdioxid + Wasser  --Lichtenergie-->  Glucose + Sauerstoff
6 CO2 + 6 H2O  -->  C6H12O6 + 6 O2

2. Ort der Photosynthese
Die Photosynthese findet in den Chloroplasten statt. Diese enthalten den grünen Farbstoff Chlorophyll, der das Sonnenlicht absorbiert. Ein Chloroplast ist von einer Doppelmembran umgeben und besteht im Inneren aus den Thylakoiden (scheibenförmige Membranstapel, die zu Grana gestapelt sind) und dem umgebenden Stroma (Grundsubstanz). Chlorophyll absorbiert vor allem rotes und blaues Licht und reflektiert grünes Licht – deshalb erscheinen Blätter grün.

3. Die zwei Teilreaktionen
3.1 Lichtreaktion (an den Thylakoidmembranen)
Lichtenergie wird vom Chlorophyll absorbiert und spaltet Wasser (Fotolyse). Dabei entstehen Sauerstoff, ATP (Energieträger) und NADPH (Reduktionsmittel). Der Sauerstoff wird als Nebenprodukt an die Umgebung abgegeben. Die Lichtreaktion ist also der Schritt, der Lichtenergie in chemisch nutzbare Energie (ATP, NADPH) umwandelt.

3.2 Dunkelreaktion / Calvin-Zyklus (im Stroma)
Mit der Energie aus ATP und NADPH wird CO2 schrittweise zu Glucose aufgebaut (CO2-Fixierung). Diese Reaktion benötigt kein Licht direkt, läuft aber meist tagsüber ab, weil sie auf die Produkte der Lichtreaktion angewiesen ist. Das Schlüsselenzym ist die RuBisCO.

Vergleich der Teilreaktionen:
- Lichtreaktion: Ort Thylakoidmembran; braucht Licht + Wasser; liefert O2, ATP, NADPH.
- Calvin-Zyklus: Ort Stroma; braucht CO2, ATP, NADPH; liefert Glucose.

4. Bedeutung
Die Photosynthese ist die Grundlage fast aller Nahrungsketten (Produzenten bilden die erste Trophiestufe) und liefert den Sauerstoff unserer Atmosphäre. Sie bindet CO2 und ist damit zentral für den globalen Kohlenstoffkreislauf und das Klima. Die Photosynthese ist die Umkehrung der Zellatmung: Was bei der Photosynthese aufgebaut wird (Glucose, O2), wird bei der Zellatmung wieder abgebaut, um Energie freizusetzen.

5. Einflussfaktoren auf die Photosyntheserate
Die Photosyntheserate hängt von mehreren Faktoren ab:
- Lichtintensität: Bei wenig Licht steigt die Rate mit der Lichtmenge, ab einem Sättigungspunkt nicht mehr.
- CO2-Konzentration: Mehr CO2 erhöht die Rate bis zur Sättigung.
- Temperatur: Da Enzyme beteiligt sind, gibt es ein Optimum (meist 20–30 °C); zu hohe Temperaturen schädigen die Enzyme.
Es gilt das Gesetz des Minimums (Liebig): Der knappste Faktor begrenzt die Gesamtrate – die übrigen Faktoren können sie dann nicht weiter steigern (limitierende Faktoren).

6. Nachweis
Der gebildete Sauerstoff lässt sich z. B. an einer Wasserpflanze (Wasserpest) durch aufsteigende Gasbläschen nachweisen. Die Glucose bzw. die daraus gebildete Stärke kann man mit der Jod-Stärke-Probe (Blaufärbung) im Blatt nachweisen.`;

const DEMO_CARDS = [
  { front: 'Wo in der Pflanzenzelle findet die Photosynthese statt?',
    back: 'In den **Chloroplasten** – genauer an den Thylakoiden (Lichtreaktion) und im Stroma (Calvin-Zyklus). Sie enthalten den Farbstoff Chlorophyll.' },
  { front: 'Wie lautet die Wortgleichung der Photosynthese?',
    back: 'Kohlenstoffdioxid + Wasser → Glucose + Sauerstoff\n\n6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂ (mit Lichtenergie).' },
  { front: 'Was passiert in der Lichtreaktion?',
    back: 'An den Thylakoidmembranen wird Wasser durch Lichtenergie gespalten (Fotolyse). Es entstehen **Sauerstoff**, **ATP** und **NADPH**.' },
  { front: 'Was geschieht im Calvin-Zyklus (Dunkelreaktion)?',
    back: 'Im Stroma wird CO₂ mithilfe der Energie aus ATP und NADPH zu **Glucose** aufgebaut. Direktes Licht ist dafür nicht nötig.' },
  { front: 'Welche Faktoren begrenzen die Photosyntheserate?',
    back: 'Lichtintensität, CO₂-Konzentration und Temperatur (limitierende Faktoren nach dem Gesetz des Minimums).' },
];

const DEMO_GLOSSAR = [
  { term: 'Chlorophyll',  definition: 'Grüner Blattfarbstoff in den Chloroplasten, der das Sonnenlicht für die Photosynthese absorbiert.' },
  { term: 'Chloroplast',  definition: 'Zellorganell der Pflanzen, in dem die Photosynthese abläuft. Enthält Thylakoide und Stroma.' },
  { term: 'Thylakoid',    definition: 'Membransystem im Chloroplasten; Ort der Lichtreaktion. Zu Stapeln (Grana) angeordnet.' },
  { term: 'Stroma',       definition: 'Flüssigkeit im Inneren des Chloroplasten; Ort des Calvin-Zyklus (Dunkelreaktion).' },
  { term: 'Calvin-Zyklus', definition: 'Dunkelreaktion der Photosynthese: Aufbau von Glucose aus CO₂ mithilfe von ATP und NADPH.' },
  { term: 'Fotolyse',     definition: 'Spaltung von Wasser durch Lichtenergie in der Lichtreaktion; setzt Sauerstoff frei.' },
];

const DEMO_STRUCTURE = {
  kapitel: [
    { titel: 'Grundlagen der Photosynthese',
      lernziel: 'Du kannst erklären, was Photosynthese ist und warum sie für das Leben wichtig ist.',
      themen: ['Definition Photosynthese', 'Wortgleichung', 'Bedeutung für Ökosysteme'] },
    { titel: 'Ort & Aufbau',
      lernziel: 'Du kannst den Chloroplasten und seine Bestandteile beschreiben.',
      themen: ['Chloroplast', 'Chlorophyll', 'Thylakoide & Stroma'] },
    { titel: 'Die zwei Teilreaktionen',
      lernziel: 'Du kannst Licht- und Dunkelreaktion unterscheiden und zuordnen.',
      themen: ['Lichtreaktion', 'Fotolyse des Wassers', 'Calvin-Zyklus'] },
    { titel: 'Einflussfaktoren',
      lernziel: 'Du kannst die limitierenden Faktoren der Photosyntheserate nennen.',
      themen: ['Lichtintensität', 'CO₂-Konzentration', 'Temperatur'] },
  ],
};
const DEMO_TOPICS = DEMO_STRUCTURE.kapitel.flatMap(k => k.themen);

// Zweites Dokument: eine "Altklausur" → schaltet den prüfungsnahen Modus frei
// (hasExamDocs erkennt das Wort "Altklausur" im Dateinamen) und liefert dem
// Klausur-Generator echten Stil-/Aufgabenkontext (doc_type=altklausur).
const DEMO_ALTKLAUSUR = `Altklausur Biologie – Thema: Photosynthese
Bearbeitungszeit: 45 Minuten · Erreichbare Punkte: 30

Aufgabe 1 (6 P): Erkläre in eigenen Worten, was man unter Photosynthese versteht, und gib die Wortgleichung an.

Aufgabe 2 (8 P): Beschrifte einen Chloroplasten (Doppelmembran, Thylakoide/Grana, Stroma) und ordne den Bestandteilen die jeweilige Teilreaktion zu.

Aufgabe 3 (10 P): Vergleiche Lichtreaktion und Calvin-Zyklus tabellarisch (Ort, Ausgangsstoffe, Produkte, Lichtabhängigkeit).

Aufgabe 4 (6 P): In einem Versuch wird eine Wasserpest bei steigender Lichtintensität beobachtet. Erkläre den erwarteten Verlauf der Photosyntheserate und nenne das zugrunde liegende Prinzip (limitierende Faktoren).`;

// Vorab gespeicherte Übungs-Aufgaben (Reiter "Aufgaben" → Gespeicherte Aufgaben).
// fullResult enthält den Trenner "--- ## Musterlösungen", damit Lösungen separat
// ein-/ausblendbar sind (siehe restoreAufgabe).
const DEMO_AUFGABEN = [
  {
    id: 9000001,
    topic: 'Lichtreaktion & Calvin-Zyklus',
    type: 'uebung',
    tasksPart: `## Übungsaufgaben: Lichtreaktion & Calvin-Zyklus

1. Nenne den Ort, an dem die Lichtreaktion abläuft, und die drei Produkte, die dabei entstehen.
2. Erkläre, warum der Calvin-Zyklus auf die Lichtreaktion angewiesen ist, obwohl er selbst kein Licht benötigt.
3. Ordne zu: Welche Stoffe sind Ausgangsstoffe, welche Produkte des Calvin-Zyklus?
4. Begründe, warum bei der Photosynthese Sauerstoff entsteht und woher dieser stammt.`,
    fullResult: `## Übungsaufgaben: Lichtreaktion & Calvin-Zyklus

1. Nenne den Ort, an dem die Lichtreaktion abläuft, und die drei Produkte, die dabei entstehen.
2. Erkläre, warum der Calvin-Zyklus auf die Lichtreaktion angewiesen ist, obwohl er selbst kein Licht benötigt.
3. Ordne zu: Welche Stoffe sind Ausgangsstoffe, welche Produkte des Calvin-Zyklus?
4. Begründe, warum bei der Photosynthese Sauerstoff entsteht und woher dieser stammt.

---

## Musterlösungen

1. Die Lichtreaktion läuft an den **Thylakoidmembranen** ab. Produkte: **Sauerstoff (O₂)**, **ATP** und **NADPH**.
2. Der Calvin-Zyklus benötigt **ATP und NADPH** aus der Lichtreaktion als Energie- und Reduktionsmittel, um CO₂ zu Glucose aufzubauen. Ohne diese Produkte fehlt ihm die Energie – deshalb läuft er praktisch nur, wenn zuvor die Lichtreaktion stattgefunden hat.
3. **Ausgangsstoffe:** CO₂, ATP, NADPH. **Produkte:** Glucose (Zucker), ADP und NADP⁺ (werden zur Lichtreaktion zurückgeführt).
4. Der Sauerstoff entsteht bei der **Fotolyse**, also der Spaltung von **Wasser (H₂O)** in der Lichtreaktion. Der freigesetzte O₂ stammt damit aus dem Wasser, nicht aus dem CO₂.`,
    createdAt: '2026-06-10T09:15:00.000Z',
  },
  {
    id: 9000002,
    topic: 'Einflussfaktoren der Photosyntheserate',
    type: 'klausur',
    tasksPart: `## Mini-Klausur: Einflussfaktoren der Photosyntheserate

1. (4 P) Nenne die drei wichtigsten Faktoren, die die Photosyntheserate beeinflussen.
2. (3 P) Erkläre das "Gesetz des Minimums" am Beispiel einer Pflanze bei viel Licht, aber wenig CO₂.
3. (3 P) Skizziere (in Worten) den Verlauf der Photosyntheserate bei steigender Lichtintensität und erkläre den Sättigungsbereich.`,
    fullResult: `## Mini-Klausur: Einflussfaktoren der Photosyntheserate

1. (4 P) Nenne die drei wichtigsten Faktoren, die die Photosyntheserate beeinflussen.
2. (3 P) Erkläre das "Gesetz des Minimums" am Beispiel einer Pflanze bei viel Licht, aber wenig CO₂.
3. (3 P) Skizziere (in Worten) den Verlauf der Photosyntheserate bei steigender Lichtintensität und erkläre den Sättigungsbereich.

---

## Lösungsschlüssel

1. **Lichtintensität**, **CO₂-Konzentration** und **Temperatur**. (Je Faktor 1 P, + 1 P für Vollständigkeit.)
2. Der **knappste Faktor begrenzt** die Gesamtrate. Steht viel Licht, aber wenig CO₂ zur Verfügung, kann die Pflanze das viele Licht nicht nutzen – die Rate wird durch das fehlende CO₂ begrenzt. Mehr Licht steigert die Rate dann **nicht** weiter.
3. Bei **wenig Licht** steigt die Rate zunächst **annähernd linear** mit der Lichtintensität. Ab einem bestimmten Punkt (Sättigung) wird ein anderer Faktor (z. B. CO₂ oder Temperatur) limitierend, sodass die Kurve **abflacht** und trotz mehr Licht **konstant** bleibt.`,
    createdAt: '2026-06-12T16:40:00.000Z',
  },
];

// Vorab gespeicherte Probeklausur (Reiter "Klausur" → gespeicherte Klausuren).
const DEMO_KLAUSUR = {
  id: 9100001,
  diff: 'pruefungsnah',
  content: `# Probeklausur: Photosynthese
Bearbeitungszeit: 45 Minuten · Erreichbare Punkte: 30

**Aufgabe 1 (6 P)** – Definiere den Begriff Photosynthese und gib die vollständige Reaktionsgleichung (mit Summenformeln) an.

**Aufgabe 2 (8 P)** – Beschreibe den Aufbau eines Chloroplasten und ordne den Bestandteilen Thylakoid und Stroma die jeweils dort ablaufende Teilreaktion zu.

**Aufgabe 3 (10 P)** – Vergleiche Lichtreaktion und Calvin-Zyklus in einer Tabelle (Ort, Ausgangsstoffe, Produkte, Lichtabhängigkeit).

**Aufgabe 4 (6 P)** – Eine Wasserpest wird bei zunehmender Lichtintensität beobachtet. Beschreibe den erwarteten Verlauf der Photosyntheserate und erkläre ihn mit dem Prinzip der limitierenden Faktoren.

---

## Lösungsschlüssel

**Aufgabe 1 (6 P):** Photosynthese = Aufbau von Glucose aus CO₂ und H₂O mithilfe von Lichtenergie, wobei O₂ frei wird (3 P). Gleichung: 6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂ (3 P).

**Aufgabe 2 (8 P):** Chloroplast: Doppelmembran außen (1 P), innen Thylakoide (zu Grana gestapelt) (2 P) und Stroma (2 P). Zuordnung: Lichtreaktion an der **Thylakoidmembran** (1,5 P), Calvin-Zyklus im **Stroma** (1,5 P).

**Aufgabe 3 (10 P):** Lichtreaktion: Ort Thylakoidmembran, Ausgangsstoffe H₂O + Licht, Produkte O₂/ATP/NADPH, lichtabhängig. Calvin-Zyklus: Ort Stroma, Ausgangsstoffe CO₂/ATP/NADPH, Produkt Glucose, nicht direkt lichtabhängig. (Je korrekter Zelleintrag ca. 1 P.)

**Aufgabe 4 (6 P):** Bei wenig Licht steigt die Rate annähernd linear (2 P). Ab dem Sättigungspunkt flacht sie ab, weil ein anderer Faktor (CO₂/Temperatur) limitierend wird (2 P). Prinzip: der knappste Faktor begrenzt die Gesamtrate – Gesetz des Minimums (2 P).`,
};

function showDemoSheet() {
  const st = document.getElementById('demo-status');
  st.classList.add('hidden'); st.textContent = '';
  const btn = document.getElementById('demo-load-btn');
  btn.disabled = false; btn.textContent = '📚 Demo-Fach laden';
  document.getElementById('demo-sheet').classList.remove('hidden');
}

async function loadDemoSubject() {
  const btn = document.getElementById('demo-load-btn');
  const st  = document.getElementById('demo-status');
  btn.disabled = true; btn.textContent = 'Wird angelegt…';
  st.className = 'sheet-status info'; st.classList.remove('hidden');
  st.textContent = 'Lege Demo-Fach an…';

  try {
    const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const subj = { id, name: 'Biologie – Photosynthese', icon: '🌿', color: '#34c759',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      fileCount: 2, quizCount: 0, lastScore: null };
    const meta = { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
    await Promise.all([DB.addSubject(subj), DB.setMeta(id, meta)]);

    // Dokumente hochladen. skipCards:true verhindert die serverseitige
    // KI-Kartenerzeugung im Hintergrund – sonst würden die fertig geseedeten
    // 5 Demo-Karten nachträglich von ~12 KI-Karten überschrieben/ergänzt.
    st.textContent = 'Lade Dokumente (Skript + Altklausur)…';
    const now = Date.now();
    await api(`/api/subjects/${id}/documents/text`, {
      method: 'POST',
      body: JSON.stringify({ filename: 'Photosynthese – Skript (Demo).txt', content: DEMO_DOC, skipCards: true }),
    });
    const altklausurDoc = await api(`/api/subjects/${id}/documents/text`, {
      method: 'POST',
      body: JSON.stringify({ filename: 'Altklausur Photosynthese (Demo).txt', content: DEMO_ALTKLAUSUR, skipCards: true }),
    });
    // Altklausur als Klausur-Dokument taggen → liefert dem Klausur-Generator
    // Stilkontext und schaltet zusätzlich den prüfungsnahen Modus frei.
    if (altklausurDoc?.id != null) {
      await api(`/api/subjects/${id}/documents/${altklausurDoc.id}`, {
        method: 'PATCH', body: JSON.stringify({ doc_type: 'altklausur' }),
      }).catch(() => {});
    }

    st.textContent = 'Lade Karten, Glossar, Aufgaben & Klausur…';
    await Promise.all([
      // Lokalen Dokumenttext setzen → sessionTxt wird in openSubject daraus
      // gefüllt. Ohne das sieht der Prompt (docsForPrompt/sysBlocks) keine
      // Unterlagen, und Quiz/Chat/Klausur fordern fälschlich zum Upload auf.
      DB.setContent(id, `${DEMO_DOC}\n\n${DEMO_ALTKLAUSUR}`),
      DB.setCards(id, DEMO_CARDS.map(c => ({ front: c.front, back: c.back, ef: 2.5, interval: 1, repetitions: 0, due: now }))),
      DB.setGlossar(id, DEMO_GLOSSAR),
      DB.addQuizResult(id, 4, 5).catch(() => {}),
      // Themen + Lernpfad-Struktur vorab seeden → Aufgaben/Lernpfad zeigen sofort
      // Themen, ohne dass in der Präsentation ein KI-Scan abgewartet werden muss.
      api(`/api/subjects/${id}/structure`, {
        method: 'POST',
        body: JSON.stringify({ structure: DEMO_STRUCTURE, topics: DEMO_TOPICS }),
      }).catch(() => {}),
      // Fertige Übungsaufgaben vorab speichern (erscheinen unter "Gespeicherte Aufgaben").
      ...DEMO_AUFGABEN.map(a => DB.saveAufgabe(id, a)),
      // Fertige Probeklausur vorab speichern (erscheint unter "Gespeicherte Klausuren").
      api(`/api/subjects/${id}/klausuren`, {
        method: 'POST',
        body: JSON.stringify({ id: DEMO_KLAUSUR.id, diff: DEMO_KLAUSUR.diff, content: DEMO_KLAUSUR.content }),
      }).catch(() => {}),
    ]);

    st.className = 'sheet-status success';
    st.textContent = '✓ Demo-Fach „Biologie – Photosynthese" ist bereit!';
    document.getElementById('demo-sheet').classList.add('hidden');
    toast('Demo-Fach geladen 🌿', 'success');
    await openSubject(subj);
  } catch (e) {
    st.className = 'sheet-status error';
    st.textContent = 'Fehler: ' + e.message;
    btn.disabled = false; btn.textContent = '📚 Demo-Fach laden';
  }
}

document.getElementById('btn-demo')?.addEventListener('click', showDemoSheet);
document.getElementById('demo-load-btn')?.addEventListener('click', loadDemoSubject);
document.getElementById('demo-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('demo-sheet').classList.add('hidden');
});

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
  // Fallback: Der Prompt-Kontext (sessionTxt) liegt nur lokal (localforage).
  // Auf einem frischen Browser/Gerät – oder im geteilten Demo-Account – ist er
  // leer, obwohl der Server Dokumente hat (serverDocs). Dann Volltext vom
  // Server nachladen und lokal cachen, damit Quiz/Chat/Klausur Kontext sehen.
  if (!sessionTxt && serverDocs.length) {
    const rows = await api(`/api/subjects/${subj.id}/documents/content`).catch(() => null);
    if (Array.isArray(rows) && rows.length) {
      sessionTxt = rows.map(r => r.content).filter(Boolean).join('\n\n');
      if (sessionTxt) DB.setContent(subj.id, sessionTxt).catch(() => {});
    }
  }
  examDocContext = await loadExamDocContext(subj.id);
  customPrompt = subj.custom_prompt || '';
  const serverTopics = await api(`/api/subjects/${subj.id}/topics`).catch(() => null);
  scannedTopics = dedupeTopics((serverTopics && serverTopics.length)
    ? serverTopics
    : (await localforage.getItem(`st_${subj.id}`).catch(() => null)) || []);

  const serverStruct = await api(`/api/subjects/${subj.id}/structure`).catch(() => null);
  // Beinah-Duplikate (gleiches Thema, anderer Name) auch in bereits gespeicherten
  // Strukturen entfernen – sonst doppeln sie im Lernpfad bis zum nächsten Re-Scan.
  moduleStructure = dedupeStructure(serverStruct || (await localforage.getItem(`ms_${subj.id}`).catch(() => null)));

  // Stabile Themen-IDs laden (geteilte Struktur hat Vorrang vor lokalem Cache),
  // fehlende für aktuelle Pfad-Themen vergeben und einmalig zurückschreiben. Muss
  // VOR der Learned/Meta-Auflösung stehen – die hängt jetzt an diesen IDs.
  topicUids = {
    ...((await localforage.getItem(`tuid_${subj.id}`).catch(() => null)) || {}),
    ...((moduleStructure && moduleStructure.ids) || {}),
  };
  // Kollabierte IDs (HTTP-randomUUID-Bug) reparieren, fehlende vergeben, dann 1× zurückschreiben.
  let tuidChanged = dedupeTopicUids();
  if (ensureTopicUids()) tuidChanged = true;
  if (tuidChanged) persistTopicUids(subj.id);

  const serverLearned = await api(`/api/subjects/${subj.id}/learned-topics`).catch(() => null);
  const localLearned  = (await localforage.getItem(`lt_${subj.id}`).catch(() => null)) || [];
  // Server UND lokal VEREINEN statt "Server gewinnt": ein offline (oder bei
  // fehlgeschlagenem POST) gelerntes Thema ging sonst beim Neuladen verloren.
  // Alt-Format (nur Name) → name::einsteiger normalisieren.
  const normLT = t => (t.includes('::') ? t : t + '::einsteiger');
  learnedTopics = [...new Set([...(serverLearned || []).map(normLT), ...localLearned.map(normLT)])];
  localforage.setItem(`lt_${subj.id}`, learnedTopics).catch(() => {});
  // Server heilen: lokal vorhandene, server-seitig fehlende Einträge nachreichen
  // (nur wenn der Server erreichbar war – sonst spart man sich die Fehlversuche).
  if (serverLearned) {
    const serverSet = new Set(serverLearned.map(normLT));
    learnedTopics.filter(t => !serverSet.has(t)).forEach(t =>
      api(`/api/subjects/${subj.id}/learned-topics`, {
        method: 'POST', body: JSON.stringify({ topic: t }),
      }).catch(() => {}));
  }
  // topicMeta-Keys (Wiederholungs-Termine) beim Laden auf normalisierte Namen
  // heben, damit sie – wie der Done-Status – ein Umbenennen/Re-Scan überstehen.
  const rawMeta = (await localforage.getItem(`ltmeta_${subj.id}`).catch(() => null)) || {};
  topicMeta = {};
  for (const [k, v] of Object.entries(rawMeta)) topicMeta[normFullKey(k)] = v;
  selTopic = null;
  currentAufgabe = ''; savedCanvasData = null; mathCtx = null; strokes = []; redoStrokes = []; currentStroke = null; baseImage = null;
  rechnenNextTask = null; rechnenLoesung = null; blitzNext = null; // Prefetches des vorigen Fachs verwerfen

  document.getElementById('header-label').textContent = `${subj.emoji || subj.icon || '📚'}  ${subj.name}`;
  updateXpChip();
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

function updateCalcChip() {
  const chip = document.getElementById('calc-saved-chip');
  const name = document.getElementById('calc-saved-name');
  if (!chip || !name) return;
  if (prefCalculator) {
    name.textContent = prefCalculator;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

document.getElementById('btn-settings')?.addEventListener('click', async () => {
  document.getElementById('custom-prompt-ta').value = customPrompt;
  document.getElementById('calc-model-input').value = prefCalculator;
  updateCalcChip();
  document.getElementById('settings-sheet').classList.remove('hidden');
  // Load user's own daily usage
  try {
    const u = await api('/api/my-usage');
    const el = document.getElementById('settings-usage-bar-fill');
    const lbl = document.getElementById('settings-usage-label');
    const section = document.getElementById('settings-usage-section');
    if (el && lbl && section) {
      const pct = Math.min(100, (u.cost_eur / u.limit) * 100);
      el.style.width = pct.toFixed(1) + '%';
      el.style.background = pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--yellow)' : 'var(--accent)';
      lbl.textContent = `${u.cost_eur.toFixed(3)}€ / ${u.limit.toFixed(2)}€ heute`;
      section.style.display = '';
    }
  } catch (_) {}
});
document.getElementById('settings-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('settings-sheet').classList.add('hidden');
});
document.getElementById('settings-close-btn')?.addEventListener('click', () =>
  document.getElementById('settings-sheet').classList.add('hidden'));
function settingsSave() {
  const val  = document.getElementById('custom-prompt-ta').value.trim();
  const calc = document.getElementById('calc-model-input').value.trim();
  customPrompt   = val;
  prefCalculator = calc;
  document.getElementById('settings-sheet').classList.add('hidden');
  toast(calc ? `✅ ${calc} gespeichert.` : 'Einstellungen gespeichert.', 'success');
  updateSettingsBadge();
  Promise.all([
    api(`/api/subjects/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ custom_prompt: val }),
    }),
    localforage.setItem('pref_calculator', calc),
  ]).catch(e => toast('Speichern fehlgeschlagen: ' + e.message, 'error'));
}
document.getElementById('settings-save-btn')?.addEventListener('click', settingsSave);

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
  sessionId = null; sessionMeta = null; sessionTxt = ''; examDocContext = ''; customPrompt = '';
  showScreen('subjects-screen'); loadSubjects();
});
document.getElementById('btn-add-docs')?.addEventListener('click', showUploadSheet);
document.getElementById('no-docs-btn')?.addEventListener('click', showUploadSheet);
document.getElementById('upload-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) hideUploadSheet();
});

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

const DOC_TYPES = [
  { value: '',                label: '— Kein Typ' },
  { value: 'skript',          label: '📘 Vorlesungsskript' },
  { value: 'formelsammlung',  label: '🧮 Formelsammlung' },
  { value: 'klausur',         label: '📋 Klausur' },
  { value: 'altklausur',      label: '📋 Altklausur' },
  { value: 'uebungsblatt',    label: '✏️ Übungsblatt' },
  { value: 'zusammenfassung', label: '📄 Zusammenfassung' },
  { value: 'lehrbuch',        label: '📚 Lehrbuch' },
];

// ── Doc-meta localforage helpers ──────────────────────────────────────────
function docMetaKey() { return `docmeta_${sessionId}`; }
async function loadDocMeta() {
  return (await localforage.getItem(docMetaKey()).catch(() => null)) || [];
}
async function saveDocMeta(meta) {
  await localforage.setItem(docMetaKey(), meta).catch(() => {});
}

async function renderDocList() {
  const wrap = document.getElementById('doc-list-wrap');
  const list = document.getElementById('doc-list');
  if (!sessionId) return;

  // Try server first; fall back to localforage docmeta
  let docs = await api(`/api/subjects/${sessionId}/documents`).catch(() => []);
  let fromServer = docs.length > 0;
  if (!fromServer) {
    const meta = await loadDocMeta();
    docs = meta.map(m => ({ id: m.localId, filename: m.name, doc_type: m.docType, uploaded_at: m.uploadedAt }));
  }
  if (!docs.length) { wrap.classList.add('hidden'); return; }

  wrap.classList.remove('hidden');
  list.innerHTML = '';
  docs.forEach(doc => {
    const date = new Date(doc.uploaded_at).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
    const optionsHtml = DOC_TYPES.map(t =>
      `<option value="${t.value}"${doc.doc_type === t.value ? ' selected' : ''}>${t.label}</option>`
    ).join('');
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
      <select class="doc-type-sel" title="Dokumenttyp">${optionsHtml}</select>
      <button class="doc-del-btn" title="Löschen">🗑</button>`;
    row.querySelector('.doc-type-sel').addEventListener('change', async e => {
      const newType = e.target.value;
      // Update server if doc has a real server ID
      if (fromServer) {
        await api(`/api/subjects/${sessionId}/documents/${doc.id}`, {
          method: 'PATCH', body: JSON.stringify({ doc_type: newType }),
        }).catch(() => {});
      }
      // Always update localforage docmeta
      const meta = await loadDocMeta();
      const entry = meta.find(m => m.name === doc.filename);
      if (entry) { entry.docType = newType; await saveDocMeta(meta); }
      // Refresh exam context so new tag is used immediately in task generation
      examDocContext = await loadExamDocContext(sessionId);
    });
    row.querySelector('.doc-del-btn').addEventListener('click', async () => {
      if (!await confirmDialog(`"${doc.filename}" löschen?`,
          { title: 'Dokument löschen', okText: 'Löschen', danger: true })) return;
      if (fromServer) {
        await api(`/api/subjects/${sessionId}/documents/${doc.id}`, { method: 'DELETE' });
      }
      // Remove from localforage docmeta
      const meta = await loadDocMeta();
      const idx = meta.findIndex(m => m.name === doc.filename);
      if (idx !== -1) { meta.splice(idx, 1); await saveDocMeta(meta); }
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
    const failedExtract = [];  // PDFs that could not be read at all
    const failedServer  = [];  // stored locally but the server rejected the save
    for (let i = 0; i < files.length; i++) {
      const fileLabel = files.length > 1 ? `${files[i].name} (${i + 1}/${files.length})` : files[i].name;
      label.textContent = `Verarbeite ${fileLabel}…`;
      bar.style.width = '0%'; pct.textContent = '0%';
      let text, pages, name;
      try {
        ({ text, pages, name } = await extractPDF(files[i], (done, total) => {
          const p = Math.round((done / total) * 100);
          bar.style.width = p + '%'; pct.textContent = p + '%';
        }));
      } catch {
        // One unreadable PDF must not discard the others in the batch.
        failedExtract.push(files[i].name);
        continue;
      }
      added += '\n\n' + text;
      const uploadedAt = new Date().toISOString();
      newFiles.push({ name, pages, uploadedAt });
      // Save snippet to localforage docmeta for doc-type filtering
      const meta = await loadDocMeta();
      if (!meta.find(m => m.name === name)) {
        meta.push({ localId: `local_${Date.now()}_${name}`, name, uploadedAt, docType: '', snippet: text.slice(0, 2000) });
        await saveDocMeta(meta);
      }
      // Save to server for RAG + auto-card generation. Await it so a failed save
      // (401, payload too large, 5xx, offline) is surfaced instead of being
      // silently swallowed and reported as success.
      try {
        const r = await fetch(`/api/subjects/${sessionId}/documents/text`, { // raw-fetch-ok: prüft r.ok selbst, sammelt Fehlschläge
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ filename: name, content: text }),
        });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        failedServer.push(name);
      }
    }

    // Commit whatever was processed successfully — even on a partial failure,
    // so local state never diverges from what was already written to docmeta.
    if (newFiles.length) {
      sessionTxt = (sessionTxt || '') + added;
      sessionMeta.files = [...(sessionMeta.files || []), ...newFiles];
      sessionMeta.updatedAt = new Date().toISOString();
      updatePruefungsnahBtns();
      renderRechnenDocs();

      // Keep existing topics/structure – user can re-scan manually if needed
      if (scannedTopics.length || moduleStructure) {
        toast('Neues Dokument hinzugefügt. Themen neu erkennen? → Lernen-Tab → "Themen erkennen"', 'info', 5000);
      }

      await Promise.all([DB.setContent(sessionId, sessionTxt), DB.setMeta(sessionId, sessionMeta)]);
      updateHeaderPages();
      document.getElementById('no-docs-banner').classList.add('hidden');
      renderDocList();
    }

    prog.classList.add('hidden');

    if (!newFiles.length) {
      status.textContent = 'Fehler: ' + (failedExtract.length
        ? `${failedExtract.join(', ')} konnte nicht gelesen werden.`
        : 'Keine Datei verarbeitet.');
      status.className = 'sheet-status error';
      status.classList.remove('hidden');
      return;
    }

    const okNames = newFiles.map(f => f.name).join(', ');
    if (failedServer.length || failedExtract.length) {
      // Some files only made it into local storage (or not at all): say so
      // clearly instead of a misleading success message.
      const parts = [`✓ ${okNames} gespeichert`];
      if (failedServer.length)  parts.push(`⚠️ nicht auf Server gesichert: ${failedServer.join(', ')} (nur auf diesem Gerät, keine Karteikarten/RAG)`);
      if (failedExtract.length) parts.push(`⚠️ nicht lesbar: ${failedExtract.join(', ')}`);
      status.textContent = parts.join(' · ');
      status.className = 'sheet-status error';
      status.classList.remove('hidden');
    } else {
      status.textContent = `✓ ${okNames} hochgeladen · Karteikarten werden generiert…`;
      status.className = 'sheet-status success';
      status.classList.remove('hidden');
      setTimeout(hideUploadSheet, 2000);
    }
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
  currentFeature = mode;
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
    // Keep the user's message in history: it is already rendered in the DOM and
    // persisted server-side (DB.addMessage above, and server messages are the
    // source of truth on reload). Popping it here would desync the in-memory
    // context from what the user sees, so a retry/follow-up would omit it.
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
document.getElementById('quiz-retry-btn')?.addEventListener('click', fetchQuestion);
document.getElementById('quiz-back-btn')?.addEventListener('click',  () => showQuizState(document.getElementById('quiz-idle')));
document.getElementById('quiz-answer')?.addEventListener('keydown',  e => { if (e.key === 'Enter' && e.ctrlKey) submitAnswer(); });
// Konfidenz-Buttons: einblenden sobald der Nutzer schreibt, deaktivieren bei Löschen
document.getElementById('quiz-answer')?.addEventListener('input', e => {
  const hasText = e.target.value.trim().length > 5;
  const confEl = document.getElementById('quiz-confidence');
  if (confEl) confEl.classList.toggle('hidden', !hasText);
  if (!hasText) { quizConfidence = 0; document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active')); }
});
document.querySelectorAll('.conf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    quizConfidence = parseInt(btn.dataset.conf, 10);
    document.querySelectorAll('.conf-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.getElementById('quiz-reset-btn')?.addEventListener('click', async () => {
  if (!await confirmDialog('Dein bisheriger Quiz-Fortschritt wird gelöscht.',
      { title: 'Quiz zurücksetzen', okText: 'Zurücksetzen', danger: true })) return;
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
document.getElementById('fb-deepen-btn')?.addEventListener('click', () => deepenWeakTopic(lastFbTopicName));

function showQuizState(el) {
  document.querySelectorAll('#panel-quiz .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

// Baut den (zustandsabhängigen) Prompt für die nächste Quiz-Frage.
// `done` = Anzahl bereits beantworteter Fragen → bestimmt Nummer, Avoid-Liste
// und Schwerpunkt. Als eigene Funktion, damit Prefetch und fetchQuestion exakt
// denselben Prompt erzeugen.
function buildQuestionPrompt(done, extraAvoid) {
  const avoidList = sessionMeta.quizStats.questions.slice(-8).map(q => q.question);
  // Beim frühen Prefetch ist die aktuelle Frage noch nicht in der Historie –
  // sie wird zusätzlich übergeben, damit die nächste Frage sie nicht wiederholt.
  if (extraAvoid) avoidList.push(extraAvoid);
  const avoid = avoidList.join('\n- ');
  // Gezieltes Retrieval: gelernte Themen abfragen festigt sie (Testing-Effekt),
  // schwache Themen brauchen die meiste Übung.
  const learnedNames = [...new Set(learnedTopics.map(t => t.split('::')[0]))]
    .filter(t => scannedTopics.includes(t));
  const weak = getWeakTopics(sessionMeta.quizStats.questions).slice(0, 4);
  let focusInstr = '';
  if (weak.length && done % 2 === 0) {
    focusInstr = `\nSCHWERPUNKT: Stelle die Frage zu einem dieser Themen, bei denen der Student noch Schwächen zeigt: ${weak.join(', ')}.`;
  } else if (learnedNames.length) {
    const pick = learnedNames[Math.floor(Math.random() * learnedNames.length)];
    focusInstr = `\nSCHWERPUNKT: Stelle die Frage zum kürzlich gelernten Thema "${pick}" – aktives Erinnern festigt das Wissen.`;
  }

  return `Stelle EINE Prüfungsfrage für "${sessionMeta.name}" (Frage ${done + 1}).
${focusInstr}
Bevorzuge Fragen die echtes Verständnis testen:
- "Erkläre warum…" / "Was passiert wenn…"
- Transferfragen: Konzept auf neue Situation anwenden
- Zusammenhänge: "Wie hängt X mit Y zusammen?"
- Kein reines Faktenwissen oder Definitionen auswendig lernen

Abwechslung: Mix aus Verständnis, Anwendung und Zusammenhängen.
${avoid ? `Bereits gestellte Fragen vermeiden:\n- ${avoid}` : ''}
Antworte NUR mit der Frage, ohne Kommentar.`;
}

// Holt eine Frage vom Modell. Modell-/Netzfehler sind oft kurzlebig → einmal
// automatisch neu versuchen. Wirft erst, wenn beide Versuche scheitern.
async function generateQuestionText(prompt) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await claudeLocal([{ role: 'user', content: 'Nächste Frage.' }], sysBlocks(prompt), 300);
      if (!r || !r.trim()) throw new Error('Leere Antwort');
      return r.trim();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Frage konnte nicht geladen werden');
}

// Prefetch: lädt die nächste Frage schon während der Nutzer das Feedback liest.
// Best-effort – Fehler werden geschluckt, fetchQuestion lädt dann normal nach.
function prefetchNextQuestion() {
  if (!sessionMeta || !sessionId) return;
  const done = sessionMeta.quizStats.questions.length;
  if (nextQ && nextQ.forSession === sessionId && nextQ.forDone === done) return; // läuft schon
  const promise = generateQuestionText(buildQuestionPrompt(done));
  promise.catch(() => {}); // keine unhandled rejection bis fetchQuestion awaitet
  nextQ = { promise, forDone: done, forSession: sessionId };
}

// Früher Prefetch: lädt die nächste Frage schon, WÄHREND der Nutzer die aktuelle
// beantwortet (nicht erst beim Feedback). forDone = der Stand NACH dem Beantworten
// der aktuellen Frage – passt damit zum done, das fetchQuestion danach berechnet.
function prefetchUpcomingQuestion(currentQ) {
  if (!sessionMeta || !sessionId) return;
  const upcomingDone = sessionMeta.quizStats.questions.length + 1;
  if (nextQ && nextQ.forSession === sessionId && nextQ.forDone === upcomingDone) return; // läuft schon
  const promise = generateQuestionText(buildQuestionPrompt(upcomingDone, currentQ));
  promise.catch(() => {});
  nextQ = { promise, forDone: upcomingDone, forSession: sessionId };
}

async function fetchQuestion() {
  if (!sessionMeta) return;
  // Reset confidence for each new question
  quizConfidence = 0;
  document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('quiz-confidence')?.classList.add('hidden');
  document.getElementById('q-box').innerHTML =
    '<div class="typing-dots"><span></span><span></span><span></span></div>';
  document.getElementById('quiz-answer').value = '';
  document.getElementById('quiz-submit').disabled = true;
  // Frage-Eingabe zeigen, evtl. übrige Fehler-Buttons ausblenden
  document.getElementById('quiz-a-area')?.classList.remove('hidden');
  document.getElementById('quiz-q-error-btns')?.classList.add('hidden');
  showQuizState(document.getElementById('quiz-q'));

  const done = sessionMeta.quizStats.questions.length;

  // Vorab geladene Frage nutzen (oder den laufenden Prefetch abwarten statt einen
  // zweiten Request zu starten). Nur wenn sie zu genau diesem Fach+Stand passt.
  let promise;
  if (nextQ && nextQ.forSession === sessionId && nextQ.forDone === done) {
    promise = nextQ.promise;
  } else {
    promise = generateQuestionText(buildQuestionPrompt(done));
  }
  nextQ = null;

  let q;
  try { q = await promise; }
  catch (e) { showQuizError(e?.message || 'Frage konnte nicht geladen werden'); return; }

  sessionMeta.currentQuestion = q;
  await DB.setMeta(sessionId, sessionMeta);
  document.getElementById('q-box').textContent = q;
  const qsc = sessionMeta.quizStats.questions;
  const sc  = qsc.reduce((a, x) => a + x.score, 0);
  document.getElementById('q-num').textContent   = `Frage ${done + 1}`;
  document.getElementById('q-score').textContent = qsc.length ? `${sc}/${qsc.length * 3} Pkt.` : '';
  document.getElementById('quiz-submit').disabled = false;
  document.getElementById('quiz-answer').focus();

  // Nächste Frage schon laden, während der Nutzer DIESE beantwortet – so ist sie
  // beim "Weiter" praktisch immer fertig (der Feedback-Prefetch greift dann nur
  // noch als Fallback, falls dieser hier scheitern sollte).
  prefetchUpcomingQuestion(q);
}

// Frage konnte nicht geladen werden: Eingabe verstecken, Wiederholen/Zurück anbieten,
// damit der Nutzer nicht das ganze Fach verlassen muss.
function showQuizError(msg) {
  document.getElementById('q-box').textContent = '⚠️ ' + msg;
  document.getElementById('quiz-a-area')?.classList.add('hidden');
  document.getElementById('quiz-q-error-btns')?.classList.remove('hidden');
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
      sysBlocks(evalPrompt), 1200,  // 700 schnitt Feedback+Musterantwort ab → JSON unvollständig
    );
    // Robust parsen wie beim Blitz (v140): handhabt ```json-Fences und kaputte
    // Zeilenumbrüche in Strings – sonst scheitert die Bewertung unnötig oft.
    const ev = parseJsonResponse(raw);
    if (!ev) throw new Error('Ungültige Modellantwort');
    // Harden the model's score: clamp to a valid 0–3 integer so array lookups
    // (labels/classes), XP and the stored quiz result can't break on
    // out-of-range, string or null values.
    let score = Math.round(Number(ev.score));
    if (!Number.isFinite(score)) score = 0;
    ev.score = Math.max(0, Math.min(3, score));
    ev.correct = !!ev.correct;
    haptic(ev.score >= 2 ? 40 : [80,40,80]);

    const savedConf = quizConfidence;
    const isOverconfident = savedConf === 3 && ev.score <= 1;
    const isSureAndRight  = savedConf === 3 && ev.score >= 2;
    lastFbTopicName = ev.topic || '';

    sessionMeta.quizStats.questions.push({
      question: sessionMeta.currentQuestion, userAnswer: answer,
      correct: ev.correct, score: ev.score, topic: ev.topic,
      correctAnswer: ev.correct_answer, feedback: ev.feedback,
      confidence: savedConf,
      ts: Date.now(), blitz: false,
    });
    sessionMeta.currentQuestion = null;
    DB.addQuizResult(sessionId, ev.score, 3);
    await DB.setMeta(sessionId, sessionMeta);
    await syncSubjectSummary();
    updateScoreChip();
    touchStreak();

    // Konfidenz-adjustierte XP: überzeugtes Richtig → Bonus; überzeugtes Falsch → keine XP
    if (!isOverconfident && ev.score > 0) addXP(ev.score * 5);

    const labels  = ['❌ Falsch (0/3)', '⚠️ Ansatz (1/3)', '🔶 Teilweise (2/3)', '✅ Korrekt (3/3)'];
    const classes = ['c0', 'c1', 'c2', 'c3'];
    document.getElementById('fb-score').textContent = labels[ev.score];
    document.getElementById('fb-score').className   = `fb-score ${classes[ev.score]}`;
    document.getElementById('fb-text').textContent  = ev.feedback;
    document.getElementById('fb-correct').innerHTML = `<strong>Musterantwort:</strong> ${esc(ev.correct_answer)}`;

    // Konfidenz-Feedback
    const confEl = document.getElementById('fb-confidence');
    if (confEl && savedConf > 0) {
      const confLabels = ['', '🤔 Unsicher', '🙂 Eher sicher', '😎 Sehr sicher'];
      if (isOverconfident) {
        confEl.className = 'fb-confidence fb-confidence--alarm';
        confEl.innerHTML = `<strong>⚠️ Fehleinschätzung!</strong> Du warst sehr sicher, aber die Antwort war falsch. Das deutet auf eine echte Wissenslücke hin – dieses Thema solltest du unbedingt vertiefen.`;
      } else if (isSureAndRight) {
        confEl.className = 'fb-confidence fb-confidence--bonus';
        confEl.innerHTML = `<strong>🎯 Sicher &amp; Korrekt!</strong> Gute Kalibrierung – du weißt was du weißt. +Bonus XP.`;
      } else {
        confEl.className = 'fb-confidence fb-confidence--info';
        confEl.textContent = `Selbsteinschätzung: ${confLabels[savedConf]}`;
      }
      confEl.classList.remove('hidden');
    } else if (confEl) { confEl.classList.add('hidden'); }

    // "Thema vertiefen" anbieten – schon beim ersten Patzer, nicht erst beim
    // Wiederholungstäter (genau dann bringt Aufteilen am meisten).
    const deepEl = document.getElementById('fb-deepen');
    if (deepEl) {
      const weakNow = getWeakTopics(sessionMeta.quizStats.questions);
      const offer = !!lastFbTopicName &&
        (ev.score <= 1 || isOverconfident || weakNow.includes(lastFbTopicName));
      deepEl.classList.toggle('hidden', !offer);
      // Bei Fehleinschätzung (sicher + falsch) dringlicher hervorheben.
      deepEl.classList.toggle('fb-deepen--urgent', offer && isOverconfident);
      const hintEl = document.getElementById('fb-deepen-hint');
      if (hintEl) hintEl.textContent = isOverconfident
        ? 'Hier klafft eine Wissenslücke – soll ich das Thema in kleinere, leichtere Häppchen zerlegen?'
        : 'Dieses Thema hakt noch – soll ich es in kleinere, leichtere Häppchen zerlegen?';
    }

    showQuizState(document.getElementById('quiz-fb'));
    // Nächste Frage schon laden, während der Nutzer das Feedback liest – beim
    // Klick auf "Weiter" erscheint sie dann praktisch sofort.
    prefetchNextQuestion();
    refreshAnalysisState();
    sessionTick('quiz');
    if (!isOverconfident && ev.score >= 2) {
      const xpBonus = isSureAndRight ? (ev.score === 3 ? 20 : 13) : (ev.score === 3 ? 15 : 10);
      addXP(xpBonus); comboUp();
    } else {
      if (!isOverconfident && ev.score === 1) addXP(5);
      comboReset();
    }
  } catch (e) {
    document.getElementById('quiz-submit').disabled = false;
    document.getElementById('q-box').textContent = '⚠️ ' + e.message;
    showQuizState(document.getElementById('quiz-q'));
  }
}

// ── Schwaches Thema in Unterteile aufteilen ────────────────────────────────
async function deepenWeakTopic(topicName) {
  if (!topicName || !sessionId) return;
  const btn = document.getElementById('fb-deepen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const raw = await claudeLocal(
      [{ role: 'user', content: `Teile das Thema "${topicName}" in 3–4 Unterteile auf.` }],
      sysBlocks(`Du bist ein Lernassistent für das Fach "${sessionMeta?.name || ''}".
Teile das Thema "${topicName}" in 3–4 klar abgegrenzte Unterteile auf, die ein Student schrittweise lernen kann.
Die Unterteile sollen KURZE Thementitel sein (max. 5 Wörter je Titel), keine Aufgaben.
Antworte NUR als JSON: {"subtopics":["<Titel 1>","<Titel 2>","<Titel 3>"]}`),
      300
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Keine Subtopics erhalten');
    const data = parseJsonLoose(m[0]);
    if (!Array.isArray(data.subtopics) || !data.subtopics.length) throw new Error('Leere Subtopics');
    const subs = data.subtopics.map(s => `${topicName}: ${s}`);
    const idx  = scannedTopics.indexOf(topicName);
    if (idx >= 0) scannedTopics.splice(idx + 1, 0, ...subs);
    else          scannedTopics.push(...subs);
    await localforage.setItem(`topics_${sessionId}`, scannedTopics).catch(() => {});
    loadLernpfad();
    document.getElementById('fb-deepen')?.classList.add('hidden');
    toast(`${subs.length} Unterteile zu "${topicName}" im Lernpfad hinzugefügt`, 'success', 3500);
  } catch (e) {
    toast('Fehler: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ In Häppchen aufteilen'; }
  }
}

// ── Blitz-Quiz ─────────────────────────────────────────────────────────────

function startBlitz() {
  blitzIdx = 0;
  blitzResults = [];
  blitzNext = null;
  fetchBlitzQuestion();
}

// Holt EINE Blitz-Frage vom Modell. Lokale Modelle liefern gelegentlich kaputtes
// JSON – bis zu zweimal automatisch neu versuchen, bevor wir aufgeben (wirft dann).
async function genBlitzQuestion() {
  const blitzPrompt = `Erstelle EINE Multiple-Choice-Frage für "${sessionMeta.name}".
Teste echtes Verständnis, nicht reines Faktenwissen.
Antworte NUR als JSON (kein Text davor oder danach):
{"question":"<Frage>","options":["A: <Text>","B: <Text>","C: <Text>","D: <Text>"],"correct":0,"explanation":"<Kurze Erklärung warum richtig>"}
"correct" ist der 0-basierte Index der richtigen Option (0=A, 1=B, 2=C, 3=D).`;

  let data, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 400 schnitt Frage+Optionen+Erklärung gelegentlich ab → JSON ohne
      // schließende "}" → parseJsonResponse lieferte null → "Ungültige Antwort"
      // bei jedem Versuch (deterministisch). 800 gibt genug Luft.
      const raw = await claudeLocal([{ role: 'user', content: 'MC-Frage.' }], sysBlocks(blitzPrompt), 800);
      const parsed = parseJsonResponse(raw);
      if (!parsed) throw new Error('Ungültige Antwort');
      if (!Array.isArray(parsed.options) || parsed.options.length < 2) throw new Error('Ungültige Antwortoptionen');
      // Local models sometimes encode the index as a string ("2") or letter ("C")
      // instead of a number — normalise so the strict i===correct compare works.
      let correct = parsed.correct;
      if (typeof correct === 'string') {
        const t = correct.trim().toUpperCase();
        correct = /^[A-D]$/.test(t) ? t.charCodeAt(0) - 65 : parseInt(t, 10);
      }
      if (!Number.isInteger(correct) || correct < 0 || correct >= parsed.options.length)
        throw new Error('Ungültiger Lösungsindex');
      parsed.correct = correct;
      data = parsed; break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw (lastErr || new Error('Frage konnte nicht geladen werden'));
  return data;
}

// Prefetch: lädt die nächste Blitz-Frage schon, während der Nutzer die aktuelle
// beantwortet. Best-effort – Fehler werden geschluckt, fetchBlitzQuestion lädt
// dann normal nach.
function prefetchBlitzQuestion(forIdx) {
  if (!sessionMeta) return;
  if (blitzNext && blitzNext.forIdx === forIdx) return; // läuft schon
  const promise = genBlitzQuestion();
  promise.catch(() => {});
  blitzNext = { promise, forIdx };
}

async function fetchBlitzQuestion() {
  showQuizState(document.getElementById('quiz-blitz-q'));
  document.getElementById('blitz-q-num').textContent = `Frage ${blitzIdx + 1}/5`;
  document.getElementById('blitz-q-score').textContent = blitzResults.length
    ? `${blitzResults.filter(r => r.correct).length}/${blitzResults.length} richtig` : '';
  document.getElementById('blitz-q-box').innerHTML =
    '<div class="typing-dots"><span></span><span></span><span></span></div>';
  document.getElementById('mc-grid').innerHTML = '';
  document.getElementById('blitz-error-btns')?.classList.add('hidden');

  // Vorab geladene Frage nutzen, falls sie zu genau diesem Stand passt – sonst
  // (oder bei Prefetch-Fehler) frisch laden.
  let data;
  try {
    if (blitzNext && blitzNext.forIdx === blitzIdx) {
      const p = blitzNext.promise; blitzNext = null;
      data = await p;
    } else {
      blitzNext = null;
      data = await genBlitzQuestion();
    }
  } catch (e) { showBlitzError(e?.message || 'Frage konnte nicht geladen werden'); return; }

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

  // Nächste Frage schon vorab laden, während der Nutzer antwortet (außer der letzten).
  if (blitzIdx + 1 < 5) prefetchBlitzQuestion(blitzIdx + 1);
}

// Blitz-Frage fehlgeschlagen: Wiederholen/Zurück anbieten statt Sackgasse.
function showBlitzError(msg) {
  document.getElementById('blitz-q-box').textContent = '⚠️ ' + msg;
  document.getElementById('mc-grid').innerHTML = '';
  document.getElementById('blitz-error-btns')?.classList.remove('hidden');
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
  sessionTick('quiz-complete');
  if (correct > 0) addXP(correct * 8, `Blitz-Quiz: ${correct}/5`);
}

document.getElementById('blitz-again-btn')?.addEventListener('click', startBlitz);
document.getElementById('blitz-stop-btn')?.addEventListener('click', () => switchToAnalysis());
document.getElementById('blitz-stop-btn2')?.addEventListener('click', () => switchToAnalysis());
document.getElementById('blitz-retry-btn')?.addEventListener('click', fetchBlitzQuestion);
document.getElementById('blitz-back-btn')?.addEventListener('click', () => showQuizState(document.getElementById('quiz-idle')));

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
        await api(`/api/subjects/${sessionId}/klausuren/${k.id}`, { method: 'DELETE' });
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

  // Klausur an den Lernpfad koppeln: genau die Themen abfragen, die der/die
  // Studierende im Lern-Bereich durcharbeitet → die Lernaufgaben "zahlen" sichtbar
  // auf die Klausur ein, keine fremden/lückenhaften Fragen.
  const curriculum = moduleStructure?.kapitel?.length
    ? `\n\nDECKE GENAU DIESE THEMEN AB (das ist der Lernpfad des/der Studierenden – stelle KEINE Fragen zu Themen außerhalb dieser Liste, aber decke die Breite ab):\n${moduleStructure.kapitel.map(k => `- ${k.titel}: ${k.themen.join(', ')}`).join('\n')}`
    : '';

  const examPrompt = `Erstelle eine Probeklausur für "${sessionMeta.name}".
${diffInstructions[selDiff] || diffInstructions.mittel}${curriculum}

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
    api(`/api/subjects/${sessionId}/klausuren`, {
      method: 'POST',
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

// Lernbereich-Stand pro Pfad-Thema (für die Analyse + das Freischalten):
// höchstes Niveau, Versuche, letzte Bewertung, Wiederholung fällig → daraus
// Buckets (wackelig / nur niedrig / nie angefasst / sicher / fällig).
const DIFF_NAMES = ['Einsteiger', 'Grundlagen', 'Lernender', 'Fortgeschritten', 'Prüfungsnah'];
function collectLernStats() {
  const topics = pathTopics();
  const per = topics.map(name => {
    const id = topicId(name);
    let attempts = 0, due = false, score = null;
    for (const k of Object.keys(topicMeta)) {
      const r = resolveKey(k); const i = r.lastIndexOf('::');
      if (i < 0 || r.slice(0, i) !== id) continue;
      const m = topicMeta[k] || {};
      attempts = Math.max(attempts, m.attempts || 0);
      if (typeof m.score === 'number') score = score === null ? m.score : Math.min(score, m.score);
      if (topicReviewDue(k)) due = true;
    }
    return { name, maxLevel: topicMaxLevel(name), attempts, due, score };
  });
  const weak  = per.filter(t => t.maxLevel >= 0 && (t.attempts >= 2 || (t.score !== null && t.score <= 1)));
  const low   = per.filter(t => t.maxLevel >= 0 && t.maxLevel <= 1 && !weak.includes(t));
  const solid = per.filter(t => t.maxLevel >= 3);
  const untouched = per.filter(t => t.maxLevel < 0);
  const due   = per.filter(t => t.due);
  const active = per.filter(t => t.maxLevel >= 0).length;
  const lernReadiness = topics.length
    ? Math.round(per.reduce((a, t) => a + Math.max(0, t.maxLevel) / 4, 0) / topics.length * 100) : 0;
  return { per, total: topics.length, active, weak, low, solid, untouched, due, lernReadiness };
}

function refreshAnalysisState() {
  const q    = sessionMeta?.quizStats?.questions || [];
  const ls   = collectLernStats();
  const ready = q.length >= 3 || ls.active >= 3;
  const btn  = document.getElementById('analysis-btn');
  const hint = document.getElementById('analysis-hint');
  btn.disabled = !ready;
  hint.textContent = ready
    ? `${q.length} Quiz-Fragen · ${ls.active}/${ls.total} Lernpfad-Themen bearbeitet – Analyse verfügbar.`
    : `Beantworte 3 Quiz-Fragen ODER bearbeite 3 Themen im Lernpfad für eine Analyse.`;
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

  const questions = sessionMeta.quizStats.questions || [];
  const ls = collectLernStats();
  const statsText = questions.length
    ? questions.map((q, i) =>
        `${i+1}. [${q.topic}] ${q.score}/3 ${q.correct ? '✓' : '✗'}\n   F: ${q.question}\n   A: ${q.userAnswer}`
      ).join('\n\n')
    : '(keine Quiz-Daten – Einschätzung stützt sich auf den Lernbereich)';
  // Klausurbereitschaft aus BEIDEN Quellen: Quiz-Score und Lernbereich-Höchstlevel.
  const quizRaw = questions.length ? Math.round(questions.reduce((a, q) => a + q.score, 0) / (questions.length * 3) * 100) : null;
  const lernRaw = ls.active ? ls.lernReadiness : null;
  const raw = (quizRaw != null && lernRaw != null) ? Math.round((quizRaw + lernRaw) / 2)
            : (quizRaw != null ? quizRaw : (lernRaw != null ? lernRaw : 0));
  const percent    = Math.max(0, raw - 12);
  const targetScore = sessionMeta.targetScore || 75;
  const names = arr => arr.length ? arr.map(t => t.name).join(', ') : '–';
  const lernText = ls.total
    ? `LERNBEREICH-STAND (im Lernpfad gelöste Aufgaben, ${ls.active}/${ls.total} Themen bearbeitet):
- Wackelig (mehrere Versuche / schwache Bewertung): ${names(ls.weak)}
- Nur auf niedriger Stufe (max. Grundlagen): ${names(ls.low)}
- Noch nicht bearbeitet: ${names(ls.untouched)}
- Sicher (Fortgeschritten/Prüfungsnah erreicht): ${names(ls.solid)}
- Wiederholung fällig: ${names(ls.due)}`
    : '';

  const analysisPrmt = `Erstelle eine KRITISCHE, PESSIMISTISCHE Lernstandsanalyse für "${sessionMeta.name}".

PFLICHT: Sei bewusst streng. Prüfungen verlaufen unter Druck schlechter als Übungen.
Klausurbereitschaft: ${percent}% (pessimistisch korrigiert von ${raw}%; Quiz ${quizRaw ?? '–'}% / Lernbereich ${lernRaw ?? '–'}%).
Lernziel des Schülers: ${targetScore}%.
Vermeide falsche Sicherheit. Sage klar was noch fehlt.

Nutze SOWOHL die Quiz-Ergebnisse ALS AUCH den Lernbereich-Stand. Nenne in "Kritische Lücken" konkret die wackeligen, die nur niedrig bearbeiteten UND die noch nicht bearbeiteten Themen aus dem Lernbereich – nicht nur Quiz-Themen.

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
      [{ role: 'user', content: `Quiz-Ergebnisse:\n${statsText}\n\n${lernText}\n\nQuiz-Rohwert: ${quizRaw ?? '–'}% · Lernbereich: ${lernRaw ?? '–'}% · kombiniert: ${raw}%` }],
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
      <div class="gauge-meta">${questions.length} Quiz-Fragen · ${ls.active}/${ls.total} Lernpfad-Themen · Quiz ${quizRaw ?? '–'}% / Lern ${lernRaw ?? '–'}% → ${percent}% · Ziel: ${targetScore}%</div>`;
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

// Wechselnde Status-Zeile statt statischem "wird geprüft": zeigt nacheinander,
// woran die KI gerade arbeitet. Bleibt am letzten Schritt stehen. Liefert stop().
function cycleStatus(el, steps, intervalMs = 1500) {
  if (!el || !steps || !steps.length) return () => {};
  let i = 0;
  el.textContent = steps[0];
  const timer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    el.textContent = steps[i];
  }, intervalMs);
  return () => clearInterval(timer);
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
  if (!sessionTxt && !sessionId) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  document.getElementById('aufgaben-loading-txt').textContent = 'Themen werden erkannt…';
  showAufgabenState(document.getElementById('aufgaben-loading'));
  const aufgabenScanDone = startProgress('aufgaben-progress-bar', 'aufgaben-progress-pct', 15000);
  selTopic = null;
  document.getElementById('aufgaben-gen-btn').disabled = true;

  try {
    // Use breadth-first doc overview so all documents are represented
    const overview = await buildDocOverview();
    const overviewText = overview || docsForPrompt(25000);
    const raw = await claudeLocal(
      [{ role: 'user', content: `Hier sind Auszüge aus ALLEN Dokumenten dieser Lernsammlung:\n\n${overviewText}\n\nErstelle eine vollständige Themenliste, die die GESAMTE Breite aller Dokumente abdeckt – nicht nur die ersten.\nAntworte NUR als JSON-Array mit 15–20 kurzen Thema-Strings (max. 4 Wörter je Thema):\n["Thema 1","Thema 2",...]` }],
      [{ type: 'text', text: 'Du listest Lernthemen aus Unterlagen auf. Antworte NUR als JSON-Array.' }],
      700
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Themen erkannt');
    const prevTopics = scannedTopics.slice();
    scannedTopics = dedupeTopics(parseJsonLoose(m[0])).slice(0, 40);
    if (!scannedTopics.length) throw new Error('Keine Themen gefunden');
    // IDs gegen die vorherigen Themen abgleichen (Rename ⇒ ID bleibt ⇒ Fortschritt bleibt).
    reconcileTopicUids(prevTopics, scannedTopics);
    persistTopicUids(sessionId);
    localforage.setItem(`st_${sessionId}`, scannedTopics).catch(() => {});
    api(`/api/subjects/${sessionId}/topics`, {
      method: 'POST',
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
  rechnenLastFeedback = '';
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
  // Erste/nächste Aufgabe schon vorladen, sobald die Löse-Ansicht offen ist – so ist
  // der erste "Aufgabe erstellen"-Klick kein kalter LLM-Roundtrip mehr. Dedupt selbst
  // (Fach + Schwierigkeit), läuft also nicht doppelt, wenn schon eine vorgeladen ist.
  if (sessionMeta && sessionId) prefetchRechnenAufgabe(currentAufgabe);
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

// Das Karo-Raster wird NICHT mehr in die Bitmap gemalt, sondern liegt als
// CSS-Hintergrund (#math-canvas in style.css) hinter der transparenten Canvas.
// Dadurch kann der Radierer es nicht treffen – er löscht nur die Tinte.

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
  // Bitmap bleibt transparent (nur Tinte); Weiß + Raster kommen aus dem CSS-Hintergrund.
  strokes = []; redoStrokes = []; currentStroke = null; baseImage = null;
  if (savedCanvasData) {
    const img = new Image();
    img.onload = () => {
      baseImage = img;                       // Hintergrund-Ebene für späteres Neu-Zeichnen
      mathCtx.drawImage(img, 0, 0, w, CANVAS_HEIGHT);
      applyCtxStyle();
    };
    img.src = savedCanvasData;
    savedCanvasData = null;
  } else {
    applyCtxStyle();
  }
}

// Einen gespeicherten Strich originalgetreu nachzeichnen (für Undo/Redo & Line-Vorschau).
function drawStroke(ctx, s) {
  const pts = s.pts;
  if (!pts || !pts.length) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1; ctx.strokeStyle = '#000';
  } else if (s.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.35; ctx.strokeStyle = '#FFD60A';
  } else { // pen | line
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1; ctx.strokeStyle = s.color;
  }
  if (s.tool === 'line') {
    ctx.lineWidth = PEN_BASE[s.size] * 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  } else {
    if (s.tool === 'pen' || s.tool === 'highlighter') {
      const r = Math.max(0.5, (pts[0].p || 0.5) * PEN_BASE[s.size]);
      ctx.beginPath();
      ctx.fillStyle = s.tool === 'highlighter' ? 'rgba(255,214,10,0.35)' : s.color;
      ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Gleiche Kurven-Glättung wie beim Live-Zeichnen (quadratische Bézier durch die Mittelpunkte).
    let lx = pts[0].x, ly = pts[0].y, lmx = pts[0].x, lmy = pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      if (s.tool === 'pen')         ctx.lineWidth = Math.max(0.5, (pts[i].p || 0.5) * PEN_BASE[s.size] * 1.8);
      else if (s.tool === 'eraser') ctx.lineWidth = PEN_BASE[s.size] * 12;
      else                          ctx.lineWidth = PEN_BASE[s.size] * 10;
      const mx = (lx + pts[i].x) / 2, my = (ly + pts[i].y) / 2;
      ctx.beginPath();
      ctx.moveTo(lmx, lmy);
      ctx.quadraticCurveTo(lx, ly, mx, my);
      ctx.stroke();
      lmx = mx; lmy = my; lx = pts[i].x; ly = pts[i].y;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// Komplett neu zeichnen: Hintergrund-PNG + alle committeten Striche. Ersetzt die
// teuren Bitmap-Snapshots – Canvas-Zeichnen ist billig (hunderte Striche < 16 ms).
function redrawCanvas() {
  if (!mathCtx) return;
  const r = document.getElementById('math-canvas').getBoundingClientRect();
  mathCtx.globalCompositeOperation = 'source-over';
  mathCtx.globalAlpha = 1;
  mathCtx.clearRect(0, 0, r.width, r.height);
  if (baseImage) mathCtx.drawImage(baseImage, 0, 0, r.width, CANVAS_HEIGHT);
  for (const s of strokes) drawStroke(mathCtx, s);
  applyCtxStyle();
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

// Gepufferte Punkte einmal pro Frame zeichnen (rAF) – statt synchron pro pointermove.
// Glättung: quadratische Bézier durch die Mittelpunkte aufeinanderfolgender Punkte,
// Kontrollpunkt ist der jeweils echte Messpunkt → runde, "tintige" Linie statt Knicke.
function flushCanvasBuf() {
  canvasRaf = 0;
  if (!mathCtx || !canvasPtBuf.length) return;
  mathCtx.lineCap = 'round'; mathCtx.lineJoin = 'round';
  if (activeTool === 'eraser') {
    mathCtx.globalAlpha = 1; mathCtx.strokeStyle = '#000';
    mathCtx.lineWidth = PEN_BASE[penSize] * 12;
    mathCtx.globalCompositeOperation = 'destination-out';
  } else if (activeTool === 'highlighter') {
    mathCtx.globalCompositeOperation = 'source-over';
    mathCtx.globalAlpha = 0.35; mathCtx.strokeStyle = '#FFD60A';
    mathCtx.lineWidth = PEN_BASE[penSize] * 10;
  } else {
    mathCtx.globalCompositeOperation = 'source-over';
    mathCtx.globalAlpha = 1; mathCtx.strokeStyle = penColor;
  }
  const buf = canvasPtBuf; canvasPtBuf = [];
  for (const pt of buf) {
    if (activeTool === 'pen') mathCtx.lineWidth = Math.max(0.5, pt.p * PEN_BASE[penSize] * 1.8);
    const midX = (canvasLastX + pt.x) / 2, midY = (canvasLastY + pt.y) / 2;
    mathCtx.beginPath();
    mathCtx.moveTo(canvasLastMidX, canvasLastMidY);
    mathCtx.quadraticCurveTo(canvasLastX, canvasLastY, midX, midY);
    mathCtx.stroke();
    canvasLastMidX = midX; canvasLastMidY = midY;
    canvasLastX = pt.x; canvasLastY = pt.y;
    if (currentStroke) currentStroke.pts.push({ x: pt.x, y: pt.y, p: pt.p });
  }
  if (activeTool === 'eraser') mathCtx.globalCompositeOperation = 'source-over';
}

function setupCanvasEvents() {
  const canvas = document.getElementById('math-canvas');

  const wrap = document.getElementById('canvas-scroll-wrap');

  // Solange der Stift zeichnet (Rechnen ODER Lernen), darf ein gleichzeitiger
  // Finger-/Handflächenkontakt KEINE Textmarkierung in der Aufgabenstellung
  // auslösen. selectstart global (Capture) abfangen reicht – die Palm-Rejection
  // auf der Fläche selbst verhindert Markierungen außerhalb nicht.
  document.addEventListener('selectstart', e => {
    if (penActive || isDrawingCanvas || lernenPenActive) e.preventDefault();
  }, true);

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      // Palm-Rejection: während der Stift zeichnet, alle Touches ignorieren.
      // (Keine Größen-Heuristik – ein Fingerkontakt ist auf dem iPad oft >45px und würde sonst fälschlich geblockt.)
      if (penActive) return;
      // Finger → Fläche per JS scrollen (kein natives pan-y, sonst scrollt auch die Handfläche).
      fingerScrollId  = e.pointerId;
      fingerStartY    = e.clientY;
      wrapScrollStart = wrap.scrollTop;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    e.preventDefault();
    // Ein neuer Stift-/Maus-Kontakt startet IMMER einen neuen Strich. Es gibt nur EINEN
    // Pencil – das frühere "schon ein Stift aktiv"-ID-Match (canvasPenId !== e.pointerId
    // → return) schützte vor nichts, konnte aber Striche komplett verschlucken: kam das
    // pointerup des vorigen Strichs nicht an (Pointer-Capture-Verlust in iPad-Safari),
    // blieb canvasPenId gesetzt und JEDER Folgestrich mit neuer pointerId wurde verworfen
    // ("Strich wird nicht erkannt"). Stattdessen übernehmen wir den neuen Kontakt.
    if (currentStroke) { strokes.push(currentStroke); currentStroke = null; } // verwaisten Strich sichern
    // Ungefangen würde eine geworfene Capture (alter Pointer bei iPad-Safari noch nicht
    // freigegeben) den ganzen pointerdown abbrechen → Strich verschluckt. Capture ist nur
    // Komfort, das Zeichnen läuft auch ohne; deshalb try/catch.
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    canvasPenId = e.pointerId;
    canvasDownTime = e.timeStamp;   // ab jetzt zählt nur, was NACH diesem Aufsetzen erzeugt wurde
    penActive = (e.pointerType === 'pen');
    if (penActive) clearTextSelection(); // evtl. durch Handfläche entstandene Markierung wegnehmen
    if (penActive && fingerScrollId !== null) fingerScrollId = null; // Stift gewinnt: Finger-Scroll abbrechen
    isDrawingCanvas = true;
    redoStrokes = [];
    const p = canvasPos(e, canvas);
    canvasLastX = p.x; canvasLastY = p.y;
    canvasLastMidX = p.x; canvasLastMidY = p.y;     // Glättung: Startpunkt = erster Mittelpunkt
    canvasPtBuf = [];
    if (canvasRaf) { cancelAnimationFrame(canvasRaf); canvasRaf = 0; }
    // Neuen Strich als Vektor mitschreiben – kein getImageData mehr beim Aufsetzen.
    currentStroke = { tool: activeTool, color: penColor, size: penSize,
                      pts: [{ x: p.x, y: p.y, p: (e.pressure || 0.5) }] };

    if (activeTool === 'line') {
      return; // Vorschau läuft über redrawCanvas() im pointermove
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
      // Nur der als Finger erkannte Pointer scrollt; Handfläche/weitere Touches ignorieren.
      if (e.pointerId === fingerScrollId) {
        wrap.scrollTop = wrapScrollStart + (fingerStartY - e.clientY);
      }
      return;
    }
    // Selbstheilung gegen iPadOS-Palm-Rejection (analog zum Lernen-Notizblock): Liegt die
    // Handfläche auf, schickt Safari mitten im Strich – oder direkt nach dem Aufsetzen – ein
    // pointercancel für den STIFT → isDrawingCanvas wird false und die folgenden pointermove-
    // Events liefen ins Leere, bis man neu aufsetzte ("Aufsetzen wird nicht erkannt"). Kommt
    // aber ein Stift-/Maus-Move, während der Stift nachweislich aufliegt (pressure>0 bzw.
    // Maustaste gedrückt), nehmen wir den Strich an dieser Stelle wieder auf – ohne Hochheben.
    // Nicht beim Line-Tool: dessen Startpunkt ist fix, ein Wiederaufsetzen würde ihn verschieben.
    const pressing = e.pressure > 0 || (e.buttons & 1) === 1;
    if (mathCtx && pressing && activeTool !== 'line' &&
        (!isDrawingCanvas || e.pointerId !== canvasPenId)) {
      if (currentStroke) { strokes.push(currentStroke); currentStroke = null; } // verwaisten Strich sichern
      canvasPenId = e.pointerId;
      penActive = (e.pointerType === 'pen');
      isDrawingCanvas = true;
      const pr = canvasPos(e, canvas);
      canvasLastX = pr.x; canvasLastY = pr.y;
      canvasLastMidX = pr.x; canvasLastMidY = pr.y;   // Glättung an der Wiederaufnahmestelle
      canvasPtBuf = [];
      currentStroke = { tool: activeTool, color: penColor, size: penSize,
                        pts: [{ x: pr.x, y: pr.y, p: (e.pressure || 0.5) }] };
    }
    if (!isDrawingCanvas || !mathCtx) return;
    if (e.pointerId !== canvasPenId) return; // nur der zeichnende Stift malt (Palm-Rejection)
    e.preventDefault();

    if (activeTool === 'line') {
      // Bestehende Striche neu zeichnen, dann frische Vorschau-Linie obendrauf.
      const p = canvasPos(e, canvas);
      redrawCanvas();
      mathCtx.globalCompositeOperation = 'source-over';
      mathCtx.globalAlpha  = 1;
      mathCtx.strokeStyle  = penColor;
      mathCtx.lineWidth    = PEN_BASE[penSize] * 2;
      mathCtx.beginPath();
      mathCtx.moveTo(canvasLastX, canvasLastY);
      mathCtx.lineTo(p.x, p.y);
      mathCtx.stroke();
      return;
    }

    // getCoalescedEvents liefert ALLE Zwischenpunkte eines schnellen Strichs –
    // sonst gehen beim schnellen (Text-)Schreiben Punkte verloren und der Strich
    // bricht ab, sodass man ihn nachzieht ("doppelte" Striche). Punkte nur puffern;
    // gezeichnet wird gebündelt einmal pro Frame in flushCanvasBuf() (rAF).
    // getBoundingClientRect EINMAL pro Event statt pro Punkt (kein Layout-Read im Hot-Loop).
    const r = canvas.getBoundingClientRect();
    const pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : null) || [e];
    for (const pt of pts) {
      canvasPtBuf.push({ x: pt.clientX - r.left, y: pt.clientY - r.top,
                         p: (pt.pressure > 0 ? pt.pressure : 0.5) });
    }
    if (!canvasRaf) canvasRaf = requestAnimationFrame(flushCanvasBuf);
  }, { passive: false });

  const endDraw = (e) => {
    if (e.pointerId === fingerScrollId) fingerScrollId = null; // Finger-Scroll beendet
    // Ein verspätetes pointerup/pointercancel eines VORHERIGEN Stift-Kontakts (auf window /
    // lostpointercapture gefangen) darf den bereits gestarteten NÄCHSTEN Strich nicht
    // abwürgen. Beim schnellen Schreiben / zwei Strichen dicht hintereinander trifft das
    // up von Strich N u.U. erst NACH dem pointerdown von Strich N+1 ein.
    // WICHTIG: Apple Pencil recycelt die pointerId – der reine ID-Vergleich erkennt das
    // veraltete Event dann NICHT (gleiche ID) und beendete den frischen Strich sofort
    // ("Aufsetzen wird nicht erkannt"). Der Zeitstempel ist eindeutig: ein up/cancel, das
    // VOR dem aktuellen Aufsetzen erzeugt wurde, gehört zum alten Strich → ignorieren.
    if (isDrawingCanvas && e.timeStamp < canvasDownTime) return;
    if (isDrawingCanvas && canvasPenId !== null && e.pointerId !== canvasPenId) return;
    if (e.pointerType === 'pen' || e.pointerType === 'mouse') penActive = false;
    if (e.pointerId === canvasPenId) canvasPenId = null;       // Stift losgelassen
    if (!isDrawingCanvas) return;
    isDrawingCanvas = false;
    if (currentStroke) {
      if (activeTool === 'line') {
        const p = canvasPos(e, canvas);
        currentStroke.pts = [currentStroke.pts[0], { x: p.x, y: p.y }];
      } else {
        // Noch gepufferte Punkte sofort zeichnen, damit der Strich vollständig ist.
        if (canvasRaf) { cancelAnimationFrame(canvasRaf); canvasRaf = 0; }
        flushCanvasBuf();
      }
      strokes.push(currentStroke);
      currentStroke = null;
    }
    // Kein getImageData mehr – der Strich liegt schon live auf der Canvas und ist
    // zusätzlich als Vektor in `strokes` gesichert. Line-Tool einmal sauber
    // nachzeichnen (überschreibt die letzte Vorschau).
    if (activeTool === 'line') redrawCanvas();
    mathCtx.globalAlpha = 1;
    mathCtx.globalCompositeOperation = 'source-over';
    applyCtxStyle();
  };
  canvas.addEventListener('pointerup',     endDraw);
  canvas.addEventListener('pointercancel', endDraw);
  // Sicherheitsnetz: Verliert iPad-Safari den Pointer-Capture, kommt pointerup u.U.
  // NICHT auf der Canvas an → canvasPenId/penActive blieben hängen und der nächste
  // Strich würde nicht starten. Auf window fangen wir auch diese Fälle ab; endDraw ist
  // idempotent (isDrawingCanvas-Guard), die Canvas-Listener feuern ohnehin zuerst.
  window.addEventListener('pointerup',     endDraw);
  window.addEventListener('pointercancel', endDraw);
  canvas.addEventListener('lostpointercapture', e => { if (e.pointerId === canvasPenId) endDraw(e); });
  // KEIN pointerleave → endDraw: dank setPointerCapture feuert pointerup zuverlässig,
  // auch wenn der Stift den Canvas-Rand verlässt. pointerleave kann dagegen direkt
  // nach dem Aufsetzen (oder beim Pencil-Hover) spurious feuern und beendete den
  // gerade begonnenen Strich sofort → erster Kontakt ohne Strich.
  canvas.addEventListener('contextmenu',   e => e.preventDefault());
}

function canvasPos(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// Entfernt eine (durch gleichzeitigen Handflächen-/Finger-Kontakt) entstandene
// Textmarkierung – außer der Fokus liegt gerade in einem Eingabefeld.
function clearTextSelection() {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  sel.removeAllRanges();
}

function clearCanvas() {
  if (!mathCtx) return;
  if (sessionId) localforage.removeItem(`canvas_${sessionId}`).catch(() => {});
  const r = document.getElementById('math-canvas').getBoundingClientRect();
  strokes = []; redoStrokes = []; currentStroke = null; baseImage = null;
  mathCtx.globalAlpha = 1;
  mathCtx.globalCompositeOperation = 'source-over';
  mathCtx.clearRect(0, 0, r.width, r.height);
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
  if (!mathCtx || !strokes.length) return;
  redoStrokes.push(strokes.pop());
  redrawCanvas();
}

function redoCanvas() {
  if (!mathCtx || !redoStrokes.length) return;
  strokes.push(redoStrokes.pop());
  redrawCanvas();
}

// ── Rechnen difficulty select ──────────────────────────────────────────────
document.getElementById('rechnen-diff-sel')?.addEventListener('change', e => {
  rechnenDiff = e.target.value;
  // Die vorgeladene Aufgabe hat noch die alte Schwierigkeit → für die neue Stufe
  // neu vorladen, damit der nächste Klick wieder sofort die passende Aufgabe hat.
  if (sessionMeta && sessionId) prefetchRechnenAufgabe(currentAufgabe);
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
document.getElementById('rechnen-feedback-overlay')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('rechnen-feedback-overlay').classList.add('hidden');
});

// Ask sheet buttons
document.getElementById('rechnen-ask-btn')?.addEventListener('click', openAskSheet);
document.getElementById('rechnen-ask-close-btn')?.addEventListener('click', () => {
  document.getElementById('rechnen-ask-overlay').classList.add('hidden');
});
document.getElementById('rechnen-ask-overlay')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('rechnen-ask-overlay').classList.add('hidden');
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

// Prompt für eine einzelne Rechen-Aufgabe. `avoid` (optional) hält den Prefetch
// davon ab, dieselbe Aufgabe wie die gerade bearbeitete erneut zu erzeugen.
function buildRechnenAufgabePrompt(avoid) {
  const avoidNote = avoid
    ? `\n\nDie neue Aufgabe MUSS sich inhaltlich klar von dieser unterscheiden (andere Zahlen/Szenario):\n"""\n${avoid}\n"""`
    : '';
  return `Erstelle EINE einzelne Aufgabe (Schwierigkeit: ${rechnenDiff}) aus dem Lernstoff von "${sessionMeta.name}".

Regeln:
- Genau eine Aufgabe, klar und präzise formuliert
- Leicht = direkte Berechnung (1–2 Schritte) | Mittel = mehrere Schritte | Schwer = komplexe Aufgabe
- Verwende LaTeX für alle Formeln und Gleichungen ($$...$$)
- Schließe mit einer klaren Handlungsaufforderung: "Berechne:", "Bestimme:", "Löse:" etc.
- Keine Lösung – NUR die Aufgabenstellung${avoidNote}

Antworte NUR mit der Aufgabenstellung, kein zusätzlicher Text.`;
}

function genRechnenAufgabe(avoid) {
  return claudeLocal([{ role: 'user', content: 'Aufgabe erstellen.' }], sysBlocks(buildRechnenAufgabePrompt(avoid)), 500);
}

// System-Prompt für die Standalone-Musterlösung (hängt nur an der Aufgabe, nicht
// an der Schülerlösung) – wird vom Prefetch und vom Inline-Fallback geteilt.
function rechnenLoesungSys() {
  return `Löse die folgende Aufgabe vollständig und korrekt – AUSSCHLIESSLICH auf Basis des Lernstoffs von "${sessionMeta?.name || ''}".
Gib NUR den vollständigen Lösungsweg als Markdown mit LaTeX-Notation ($$...$$) zurück – keine Einleitung, keine Anrede, keine Bewertung.`;
}

// Musterlösung der aktuellen Aufgabe schon erzeugen, während der Nutzer rechnet.
// Beim "Prüfen" steht sie dann sofort bereit (Vision-Call muss sie nicht liefern).
function prefetchRechnenLoesung(aufgabe) {
  if (!sessionMeta || !aufgabe) return;
  if (rechnenLoesung && rechnenLoesung.aufgabe === aufgabe) return; // läuft schon / fertig
  const sys = rechnenLoesungSys();
  const entry = { aufgabe, promise: null, text: '' };
  entry.promise = (async () => {
    try {
      const r = await claudeLocal([{ role: 'user', content: `Aufgabe: ${aufgabe}` }], sysBlocks(sys), 1200);
      const txt = (r || '').trim();
      if (rechnenLoesung === entry) entry.text = txt; // nur cachen wenn noch aktuell
      return txt;
    } catch { return ''; }
  })();
  entry.promise.catch(() => {});
  rechnenLoesung = entry;
}

// Nächste Aufgabe vorab laden, während der Nutzer die aktuelle bearbeitet.
function prefetchRechnenAufgabe(avoid) {
  if (!sessionMeta || !sessionId) return;
  if (rechnenNextTask && rechnenNextTask.forSession === sessionId && rechnenNextTask.diff === rechnenDiff) return;
  const promise = genRechnenAufgabe(avoid);
  promise.catch(() => {});
  rechnenNextTask = { promise, diff: rechnenDiff, forSession: sessionId };
}

async function generateMathAufgabe() {
  if (!sessionMeta) { toast('Bitte zuerst ein Fach öffnen.', 'warn'); return; }
  const spinner = document.getElementById('rechnen-gen-spinner');
  const btn = document.getElementById('rechnen-gen-btn');
  spinner.classList.remove('hidden');
  btn.disabled = true;

  try {
    // Vorab geladene Aufgabe nutzen, falls sie zu Fach+Schwierigkeit passt – sonst frisch laden.
    let aufgabe;
    if (rechnenNextTask && rechnenNextTask.forSession === sessionId && rechnenNextTask.diff === rechnenDiff) {
      const p = rechnenNextTask.promise; rechnenNextTask = null;
      aufgabe = await p;
    } else {
      rechnenNextTask = null;
      aufgabe = await genRechnenAufgabe();
    }
    const taskInput = document.getElementById('rechnen-task-input');
    taskInput.value = aufgabe.trim();
    currentAufgabe  = aufgabe.trim();
    rechnenLastFeedback = '';
    savedCanvasData = null;
    clearCanvas();   // setzt strokes/redoStrokes/baseImage zurück
    rechnenLoesung = null;
    prefetchRechnenLoesung(currentAufgabe);   // Musterlösung im Hintergrund vorbereiten
    prefetchRechnenAufgabe(currentAufgabe);   // nächste Aufgabe im Hintergrund vorbereiten
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

  // Bitmap ist transparent (nur Tinte) – Tinte über den Alpha-Kanal erkennen.
  const px = mathCtx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasInk = false;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] > 10) { hasInk = true; break; }
  }
  const hasTypedAnswer = (document.getElementById('rechnen-task-input')?.value.trim() || '').length > 0;
  if (!hasInk && !hasTypedAnswer) { toast('Bitte zuerst eine Lösung in den Zeichen- oder Schreibbereich eingeben.', 'warn'); return; }

  // Show feedback sheet in loading state
  const overlay = document.getElementById('rechnen-feedback-overlay');
  document.getElementById('rechnen-sheet-loading').classList.remove('hidden');
  document.getElementById('rechnen-sheet-result').classList.add('hidden');
  overlay.classList.remove('hidden');
  const checkDone = startProgress('rechnen-check-bar', 'rechnen-check-pct', 15000);

  const writtenText = document.getElementById('rechnen-task-input')?.value.trim() || '';
  const taskText    = writtenText || currentAufgabe;

  // Wartezustand beleben: wechselnde Status-Zeile statt statischem "wird geprüft",
  // und die vorgeladene Musterlösung schon zum Lesen anzeigen, sobald sie fertig ist.
  const stopStatus = cycleStatus(document.getElementById('rechnen-check-status'),
    ['Lösung erfassen…', 'Rechenweg nachvollziehen…', 'Schritte nachrechnen…', 'Ergebnis bewerten…', 'Feedback formulieren…']);
  const prePreview = document.getElementById('rechnen-check-preloesung');
  if (prePreview) prePreview.innerHTML = '';
  if (prePreview && rechnenLoesung && rechnenLoesung.aufgabe === taskText) {
    rechnenLoesung.promise.then(txt => {
      txt = (txt || '').trim();
      // Nur zeigen, solange noch geprüft wird (Lade-Screen sichtbar).
      if (txt && !document.getElementById('rechnen-sheet-loading').classList.contains('hidden')) {
        prePreview.innerHTML =
          '<details class="lernen-result-details" open style="margin-top:14px;text-align:left">' +
            '<summary>📌 Musterlösung – schon mal zum Lesen</summary>' +
            `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(txt))}</div>` +
          '</details>';
      }
    }).catch(() => {});
  }

  const docNote     = activeRechnenDoc ? `\n(Aktives Dokument: ${activeRechnenDoc})` : '';
  // Eingetippter Text im Schreibbereich zählt mit zur Lösung
  const writtenNote = writtenText
    ? `\n\n**Im Schreibbereich getippter Text des Schülers (Teil der Lösung, gleichwertig zur Zeichnung berücksichtigen):**\n${writtenText}`
    : '';
  // Transparente Bitmap auf weißen Grund flachrechnen, damit die Vision-API
  // die Tinte auf Weiß sieht (statt auf transparentem/schwarzem Grund).
  const flat = document.createElement('canvas');
  flat.width = canvas.width; flat.height = canvas.height;
  const fc = flat.getContext('2d');
  fc.fillStyle = '#ffffff';
  fc.fillRect(0, 0, flat.width, flat.height);
  fc.drawImage(canvas, 0, 0);
  const dataURL   = flat.toDataURL('image/png');
  const base64   = dataURL.split(',')[1];

  // Bewertungsmaßstab an den gewählten Schwierigkeitsgrad koppeln: rechnerische
  // Fehler bleiben auf jedem Level Fehler, aber bei leichten Aufgaben wird das
  // Verständnis wohlwollend bewertet, bei Experte/Prüfungsnah streng.
  const RECHNEN_TOLERANZ = {
    leicht:       `BEWERTUNGSMASSSTAB – LEICHT (wohlwollend): Es zählt das richtige Endergebnis und der grobe Lösungsweg. Sei großzügig bei Notation, Zwischenschritten und Formulierung. Kleinere formale Ungenauigkeiten NICHT als Fehler werten. Wenn das Ergebnis stimmt, ist die Aufgabe richtig – auch wenn der Weg knapp ist.`,
    mittel:       `BEWERTUNGSMASSSTAB – MITTEL: Endergebnis und nachvollziehbarer Lösungsweg zählen. Wesentliche Rechenfehler benennen, aber kleinere Notations-Ungenauigkeiten tolerieren.`,
    schwer:       `BEWERTUNGSMASSSTAB – SCHWER: Lösungsweg und Ergebnis müssen korrekt und vollständig sein. Auch Zwischenschritte prüfen.`,
    pruefungsnah: `BEWERTUNGSMASSSTAB – PRÜFUNGSNAH (Klausurmaßstab): Bewerte wie ein strenger Korrektor. Saubere Notation, vollständige Begründung und exakte Ergebnisse erforderlich. Jeder Zwischenschritt wird geprüft.`,
    experte:      `BEWERTUNGSMASSSTAB – EXPERTE (sehr streng): Maximal anspruchsvoll. Jede Ungenauigkeit in Notation, Begründung oder Rechnung benennen. Nur eine vollständig saubere Lösung gilt als korrekt.`,
  };
  const toleranzNote = RECHNEN_TOLERANZ[rechnenDiff] || RECHNEN_TOLERANZ.mittel;

  // Re-Prüfung: vorheriges Feedback mitschicken, damit die KI konsistent bleibt
  // und nicht bei jeder Runde neue/widersprüchliche Fehler "entdeckt".
  const reCheckNote = rechnenLastFeedback
    ? `\n\n**WICHTIG – das ist eine erneute Prüfung derselben Aufgabe.** Du hast diese Lösung vorher schon einmal bewertet. Dein vorheriges Feedback war:\n"""\n${rechnenLastFeedback}\n"""\nBleibe konsistent: Beziehe dich auf genau diese Punkte. Was du vorher als richtig akzeptiert hast, bleibt richtig – führe KEINE neuen Kritikpunkte zu Aspekten ein, die du vorher nicht beanstandet hast, es sei denn, die Lösung wurde dort tatsächlich verändert und ist jetzt falsch. Bestätige ausdrücklich, welche der zuvor genannten Fehler nun korrigiert sind.`
    : '';

  const checkPrompt = `Ein Schüler hat eine Aufgabe gelöst. Die Lösung kann in ZWEI Bereichen stehen:
1. handschriftlich/gezeichnet auf dem beigefügten Bild (Zeichenbereich),
2. als getippter Text im Schreibbereich (siehe unten).
Berücksichtige BEIDE Bereiche gemeinsam als die vollständige Lösung des Schülers.

${toleranzNote}

**Aufgabe:** ${taskText || '(keine Aufgabe angegeben – analysiere was du siehst)'}${docNote}${writtenNote}${reCheckNote}

Analysiere die gesamte Lösung (Bild + getippter Text) und antworte auf Deutsch:

## ✅ Richtig / ❌ Falsch
Ist die finale Antwort korrekt? Eindeutige Aussage zuerst.

## Lösungsweg des Schülers
Was erkennst du im Zeichenbereich und im Schreibbereich? Wie ist der Schüler vorgegangen?

## Fehleranalyse (nur wenn falsch)
Wo genau liegt der Fehler? Erkläre präzise warum er falsch ist.

Falls die Schrift schwer lesbar ist: gib trotzdem dein Bestes und erkläre was du erkennst.
(Die Musterlösung wird separat angezeigt – schreibe sie NICHT selbst.)`;

  try {
    // Vision-Call bewertet nur die Schülerlösung – die Musterlösung kommt aus dem
    // Prefetch (sofort) bzw. wird, falls keiner vorliegt, jetzt einmalig nachgeladen.
    const feedbackP = claudeLocalVision(base64, checkPrompt, sysBlocks(), 1400);
    let loesungP;
    if (rechnenLoesung && rechnenLoesung.aufgabe === taskText) {
      loesungP = rechnenLoesung.promise;
    } else {
      loesungP = claudeLocal([{ role: 'user', content: `Aufgabe: ${taskText}` }], sysBlocks(rechnenLoesungSys()), 1200)
        .then(r => (r || '').trim()).catch(() => '');
    }
    const feedback = await feedbackP;
    let loesung = '';
    try { loesung = await loesungP || ''; } catch { loesung = ''; }
    const full = loesung ? `${feedback}\n\n## Musterlösung\n${loesung}` : feedback;
    checkDone(); stopStatus();
    rechnenLastFeedback = full;
    document.getElementById('rechnen-feedback-content').innerHTML = safeHtml(md(full));
    document.getElementById('rechnen-sheet-loading').classList.add('hidden');
    document.getElementById('rechnen-sheet-result').classList.remove('hidden');
  } catch (e) {
    checkDone(); stopStatus();
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
  const r = await fetch('/api/backup', { headers: authHeaders() }); // raw-fetch-ok: lädt JSON-Blob für Datei-Download
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
  await fetch('/api/restore', { // raw-fetch-ok: Bulk-Import, eigener Ablauf
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
  api(`/api/subjects/${sessionId}/cheat`, { method: 'DELETE' }).catch(() => {});
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
    api(`/api/subjects/${sessionId}/cheat`, {
      method: 'POST',
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
    glossarTerms = parseJsonLoose(m[0]).filter(t => t.term && t.def);
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
let reviewQueue   = [];
let reviewAllCards = [];   // full card set; reviewQueue holds references into this
let reviewIdx     = 0;
let reviewStats   = { again: 0, hard: 0, good: 0, easy: 0 };
let reviewHardCards = [];  // in dieser Runde mit "Nochmal"/"Schwer" bewertete Karten (Referenzen)

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
    const parsed = parseJsonLoose(m[0]).filter(c => c.front && c.back);
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
  reviewAllCards = cards;
  reviewQueue = cards.filter(c => c.due <= Date.now());
  if (!reviewQueue.length) { await initKarten(); return; }
  reviewIdx   = 0;
  reviewStats = { again: 0, hard: 0, good: 0, easy: 0 };
  reviewHardCards = [];
  showKartenState(document.getElementById('karten-review'));
  showCard();
}

// Fokus-Runde: nur die in der letzten Runde wackligen Karten direkt nochmal.
function startHardReview() {
  if (!reviewHardCards.length) return;
  reviewQueue = reviewHardCards;
  reviewIdx   = 0;
  reviewStats = { again: 0, hard: 0, good: 0, easy: 0 };
  reviewHardCards = [];   // diese Runde sammelt erneut die noch wackligen
  haptic(10);
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

    // Update the card in place. reviewQueue holds references into reviewAllCards,
    // so mutating the queued card also updates the full set we persist.
    // (We cannot re-fetch + match by id: setCards re-inserts all rows and the
    // SERIAL ids change on every save, so id matching would fail after card 1.)
    srsUpdate(reviewQueue[reviewIdx], grade);
    if (grade <= 1) reviewHardCards.push(reviewQueue[reviewIdx]); // "Nochmal"/"Schwer" → nochmal üben
    await DB.setCards(sessionId, reviewAllCards);
    touchStreak();

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

  const hardN = reviewHardCards.length;
  document.getElementById('karten-done-title').textContent =
    pct >= 80 ? '🌟 Ausgezeichnet!' : pct >= 60 ? '👍 Gut gemacht!' : '💪 Weiter üben!';
  document.getElementById('karten-done-stats').innerHTML = `
    <div class="done-stat-row">
      <span class="done-stat">😄 Einfach: ${reviewStats.easy}</span>
      <span class="done-stat">🙂 Gut: ${reviewStats.good}</span>
      <span class="done-stat">😕 Schwer: ${reviewStats.hard}</span>
      <span class="done-stat">😵 Nochmal: ${reviewStats.again}</span>
    </div>
    <div class="done-pct" style="color:${pct>=70?'var(--green)':pct>=50?'var(--yellow)':'var(--red)'}">${pct}% gewusst</div>
    ${hardN ? `<button class="btn-primary btn-sm karten-hard-again" id="karten-hard-btn">💪 ${hardN} schwere Karte${hardN === 1 ? '' : 'n'} nochmal</button>` : ''}`;
  document.getElementById('karten-hard-btn')?.addEventListener('click', startHardReview);
  showKartenState(document.getElementById('karten-done'));
  sessionTick('karten');
  addXP(20, 'Karten-Session');
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

// Normalisiert Themennamen für die Duplikat-Erkennung: Kleinschreibung, Umlaute
// und Sub-/Hochzeichen auf ASCII (CO₂ → co2), führende Artikel sowie alle Satz-
// und Sonderzeichen entfernt, Leerzeichen kollabiert. So gelten z. B.
// "Die Lichtreaktion" und "Lichtreaktion" oder "CO₂-Konzentration" und
// "CO2 Konzentration" als dasselbe Thema.
function normTopic(t) {
  return String(t)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // Diakritika/Sub-/Hochzeichen → ASCII
    .toLowerCase()
    .replace(/^(der|die|das|den|dem|des|the|ein|eine)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Entfernt Beinah-Duplikate aus einer flachen Themenliste (erster Treffer gewinnt).
function dedupeTopics(arr) {
  const seen = new Set();
  return (arr || []).reduce((out, t) => {
    if (typeof t !== 'string') return out;
    const key = normTopic(t);
    if (key && !seen.has(key)) { seen.add(key); out.push(t.trim()); }
    return out;
  }, []);
}

// Entfernt Beinah-Duplikate über ALLE Kapitel hinweg und wirft leere Kapitel raus.
function dedupeStructure(struct) {
  if (!struct?.kapitel?.length) return struct;
  const seen = new Set();
  const kapitel = struct.kapitel.map(k => ({
    ...k,
    themen: (k.themen || []).reduce((out, t) => {
      if (typeof t !== 'string') return out;
      const key = normTopic(t);
      if (key && !seen.has(key)) { seen.add(key); out.push(t.trim()); }
      return out;
    }, []),
  })).filter(k => k.themen && k.themen.length);
  return { ...struct, kapitel };
}

// ── Stabile Themen-IDs ─────────────────────────────────────────────────────
// Fortschritt (gelernt, Wiederholung, Cache) hängt an einer einmal vergebenen ID
// statt am Themen-Namen → überlebt Umbenennen/Re-Scan. topicUids (normName → ID)
// liegt in der fach-global geteilten Struktur, sodass alle Geräte dieselben IDs
// sehen. Fehlt eine ID, degradiert alles sauber auf den normalisierten Namen (v155).
function newTopicUid() {
  // ACHTUNG: crypto.randomUUID gibt es nur in Secure Contexts – auf HTTP (kein HTTPS
  // hier) ist es undefined. Der alte Fallback Date.now().toString(16)+Math.random()
  // war ~11 Hex-Zeichen Zeitstempel; .slice(0,10) schnitt den Zufallsteil weg, sodass
  // alle in derselben Millisekunde erzeugten IDs identisch wurden (Fortschritt
  // kollabierte auf 1 Thema). getRandomValues funktioniert auch über HTTP.
  const c = self.crypto;
  let hex;
  if (c?.randomUUID) {
    hex = c.randomUUID().replace(/[^a-f0-9]/gi, '');
  } else if (c?.getRandomValues) {
    const a = new Uint8Array(8); c.getRandomValues(a);
    hex = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Letzter Notnagel: Zufall ZUERST, damit slice() ihn nicht abschneidet.
    hex = (Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/[^a-f0-9]/gi, '');
  }
  return 't_' + hex.slice(0, 12);
}
const isTopicUid = s => /^t_[a-f0-9]+$/i.test(s);

// Selbstheilung für "kollabierte" IDs (mehrere Themen auf derselben UID, s. o.):
// jede UID darf nur EINEM normalisierten Namen gehören – Dubletten bekommen neue,
// eindeutige IDs. true, wenn etwas repariert wurde. Da Fortschritt über die NAMEN
// auflöst (resolveKey → topicId(name)), bleibt bestehender Fortschritt erhalten.
function dedupeTopicUids() {
  const owner = new Map();   // uid → erster normName, der sie behält
  let changed = false;
  for (const k of Object.keys(topicUids)) {
    const u = topicUids[k];
    if (owner.has(u)) { topicUids[k] = newTopicUid(); changed = true; }
    else owner.set(u, k);
  }
  return changed;
}

// Stabile ID eines Themas, sonst dessen normalisierter Name (v155-Fallback).
function topicId(name) {
  const k = normTopic(name);
  return topicUids[k] || k;
}

// Fortschritts-Schlüssel "<id|normName>::<niveau>".
function topicKey(name, diff) {
  return topicId(name) + '::' + diff;
}

// Löst den Kopf eines ganzen "X::Niveau"-Schlüssels auf eine ID auf – akzeptiert
// Alt-Einträge ("Name::diff") wie ID-Einträge ("t_abc::diff").
function resolveKey(key) {
  const i = String(key).lastIndexOf('::');
  const head = i < 0 ? key : key.slice(0, i);
  const diff = i < 0 ? 'einsteiger' : key.slice(i + 2);
  return (isTopicUid(head) ? head : topicId(head)) + '::' + diff;
}

function learnedKey(topic, diff) { return topicKey(topic, diff); }

// Niveau-Rangfolge (Einsteiger=0 … Prüfungsnah=4). Grundlage für "Beherrschung
// impliziert niedrigere Stufen": ein auf Stufe N gelerntes Thema gilt als auf
// allen Stufen ≤ N gelernt – so muss kein Thema 5× wiederholt werden.
const DIFF_IDX = { einsteiger: 0, leicht: 1, mittel: 2, schwer: 3, pruefungsnah: 4 };
const diffIdx  = d => DIFF_IDX[d] ?? 0;

// Höchstes je erreichtes Niveau eines Themas; -1 wenn noch nie gelernt.
function topicMaxLevel(topic) {
  const id = topicId(topic);
  let max = -1;
  for (const k of learnedTopics) {
    const r = resolveKey(k);                 // tid::diff
    const i = r.lastIndexOf('::');
    if (r.slice(0, i) === id) max = Math.max(max, diffIdx(r.slice(i + 2)));
  }
  return max;
}

// Set aller gelernten Themen als aufgelöste ID-Schlüssel.
function learnedKeySet() {
  return new Set(learnedTopics.map(resolveKey));
}

// topicMeta-Schlüssel (Wiederholungs-Termine) ebenfalls über die ID auflösen.
function normFullKey(key) { return resolveKey(key); }

// Vergibt fehlenden Pfad-Themen eine ID; true, wenn etwas neu war.
function ensureTopicUids() {
  let changed = false;
  for (const name of pathTopics()) {
    const k = normTopic(name);
    if (k && !topicUids[k]) { topicUids[k] = newTopicUid(); changed = true; }
  }
  return changed;
}

// Token-Jaccard zweier normalisierter Namen (Rename-Erkennung beim Re-Scan).
function jaccardTokens(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Re-Scan-Abgleich: für jeden neuen Namen die ID des passenden alten Themas
// nachtragen (exakt/normalisiert → Ähnlichkeit ≥ 0.6 → sonst neue ID). Alte
// Map-Einträge bleiben erhalten, damit bestehender Fortschritt referenzierbar bleibt.
function reconcileTopicUids(prevNames, newNames) {
  const prevNorm = prevNames.map(normTopic);
  const newNorm  = newNames.map(normTopic);
  const used = new Set();
  newNorm.forEach(k => { if (topicUids[k]) used.add(topicUids[k]); });
  const avail = prevNorm.filter(k => topicUids[k] && !newNorm.includes(k));
  newNorm.forEach(k => {
    if (!k || topicUids[k]) return;                       // exakt/normalisiert schon zugeordnet
    let best = null, score = 0;
    for (const o of avail) {
      if (used.has(topicUids[o])) continue;
      const s = jaccardTokens(k, o);
      if (s > score) { score = s; best = o; }
    }
    if (best && score >= 0.6) { topicUids[k] = topicUids[best]; used.add(topicUids[best]); }
    else topicUids[k] = newTopicUid();
  });
}

// IDs in die geteilte Struktur (Server + lokal) schreiben, plus lokaler Fallback.
function persistTopicUids(subjId) {
  if (!subjId) return;
  if (moduleStructure) {
    moduleStructure.ids = topicUids;
    localforage.setItem(`ms_${subjId}`, moduleStructure).catch(() => {});
    api(`/api/subjects/${subjId}/structure`, {
      method: 'POST',
      body: JSON.stringify({ structure: moduleStructure, topics: scannedTopics }),
    }).catch(() => {});
  }
  localforage.setItem(`tuid_${subjId}`, topicUids).catch(() => {});
}

// Einzige Wahrheitsquelle für die Themen des Lernpfads: exakt die Liste, die auch
// in loadLernpfad() gerendert wird. Wenn eine Kapitelstruktur existiert, zählen
// ALLE ihre Themen (ungekappt) – sonst die flache scannedTopics-Liste. So bleibt
// die Prozentzahl/„X/Y"-Anzeige immer deckungsgleich mit den sichtbaren Themen.
function pathTopics() {
  if (moduleStructure?.kapitel?.length)
    return moduleStructure.kapitel.flatMap(k => k.themen);
  return scannedTopics;
}

// Das Kapitel, zu dem ein Thema gehört (für integrierte Aufgaben auf hohem Niveau).
function chapterOf(topic) {
  return moduleStructure?.kapitel?.find(k => k.themen.includes(topic)) || null;
}

// Geschwister-Themen desselben Kapitels – auf hohem Niveau werden sie in EINE
// zusammengesetzte, klausurartige Aufgabe verwoben (statt 30 isolierter Krümel).
function chapterSiblings(topic) {
  const k = chapterOf(topic);
  return k ? k.themen.filter(t => t !== topic) : [];
}

// ── Hebel 2: Körnung pro Niveau ─────────────────────────────────────────────
// Auf hohen Stufen ist die Lerneinheit nicht mehr ein Mikro-Thema, sondern eine
// zusammengesetzte Einheit (Cluster bzw. ganzes Kapitel) → wenige, große Aufgaben
// statt 35 Krümel. Zusammen mit Hebel 1 (Beherrschung impliziert tiefer) kollabiert
// das die Stückzahl: eine Kapitel-Einheit auf Prüfungsnah erledigt alle ihre Themen.
const GRAIN_BY_DIFF = { einsteiger: 'topic', leicht: 'topic', mittel: 'topic', schwer: 'cluster', pruefungsnah: 'kapitel' };

// Liefert die Lerneinheiten für ein Niveau. 'topic' → je Thema eine Einheit;
// 'cluster' → 2–3 Themen eines Kapitels; 'kapitel' → ganzes Kapitel.
function pathUnits(diff) {
  const grain = GRAIN_BY_DIFF[diff] || 'topic';
  if (grain === 'topic' || !moduleStructure?.kapitel?.length)
    return pathTopics().map(t => ({ kind: 'topic', themen: [t], name: t }));
  const units = [];
  for (const k of moduleStructure.kapitel) {
    if (!k.themen?.length) continue;
    if (grain === 'kapitel') {
      units.push({ kind: 'kapitel', themen: k.themen, name: k.titel, lernziel: k.lernziel });
    } else { // cluster
      for (let i = 0; i < k.themen.length; i += 3) {
        const part = k.themen.slice(i, i + 3);
        units.push({ kind: 'cluster', themen: part,
          name: `${k.titel}: ${part.join(' · ')}`, lernziel: k.lernziel });
      }
    }
  }
  return units;
}

// Stabile ID einer Einheit – aus den (stabilen) Member-tids, damit Fortschritt/Cache
// einen Re-Scan überleben. Ein-Thema-Einheit = die Themen-ID selbst (kompatibel).
function unitId(unit) {
  const ts = (unit?.themen || []).filter(Boolean);
  if (ts.length <= 1) return topicId(ts[0] || unit?.name || '');
  return 'u_' + ts.map(topicId).sort().join('_');
}

// Die aktuelle Einheit robust (Fallback: Ein-Thema-Einheit aus currentExplainerTopic).
function curUnit() {
  return currentUnit || { kind: 'topic', themen: [currentExplainerTopic], name: currentExplainerTopic };
}

// Pfad-Themen, die auf diesem Niveau ODER HÖHER gelernt wurden ("Beherrschung
// impliziert niedrigere Stufen"). Wer ein Thema auf "Mittel" schafft, füllt damit
// Einsteiger+Grundlagen+Mittel in einer Aktion – kein erzwungenes 5×. Die Stufen-
// Kreise werden dadurch monoton (jeder höhere ≤ niedrigerer).
function topicsDoneAtDiff(diff) {
  const need = diffIdx(diff);
  return pathTopics().filter(t => topicMaxLevel(t) >= need).length;
}

function calculateMilestone() {
  const total = pathTopics().length;

  // Fortschritt PRO Stufe: Anteil der Themen, die auf genau diesem Niveau
  // durchgearbeitet wurden. So füllt sich jeder Stufen-Kreis nur durch Aufgaben
  // auf diesem Niveau – leichte Themen heben keine höheren Stufen.
  const fracs = MILESTONE_LEVELS.map(l => {
    const d = l.diff || 'einsteiger';
    return total > 0 ? Math.min(1, topicsDoneAtDiff(d) / total) : 0;
  });

  // Auto-Stufe = niedrigste noch nicht vollständig gelernte Stufe (= woran man
  // gerade arbeitet). Erst wenn eine Stufe ganz voll ist, rückt sie eine weiter.
  let levelIdx = 0;
  while (levelIdx < MILESTONE_LEVELS.length - 1 && fracs[levelIdx] >= 1) levelIdx++;
  const level = MILESTONE_LEVELS[levelIdx];

  // Anzeige-% = Fortschritt auf dem AKTIVEN Niveau (manuell gewählt oder Auto).
  const activeIdx  = selectedDiffIdx !== null ? selectedDiffIdx : levelIdx;
  const activeDiff = MILESTONE_LEVELS[activeIdx].diff || 'einsteiger';
  const diffDone   = topicsDoneAtDiff(activeDiff);
  const pct = total > 0 ? Math.round(Math.min(1, diffDone / total) * 100) : 0;

  // Gesamtfortschritt: distinkte Pfad-Themen, die auf IRGENDEINEM Niveau schon
  // gelernt wurden. Macht den Niveauwechsel sichtbar nicht-destruktiv (#5).
  const learnedIds = new Set(learnedTopics.map(t => { const r = resolveKey(t); return r.slice(0, r.lastIndexOf('::')); }));
  const overallDone = pathTopics().filter(n => learnedIds.has(topicId(n))).length;
  const overallPct  = total > 0 ? Math.round(overallDone / total * 100) : 0;

  return { ...level, pct, doneCount: diffDone, totalTopics: total, overallDone, overallPct,
           levelNum: levelIdx + 1, totalLevels: MILESTONE_LEVELS.length, fracs };
}

function renderMilestone() {
  const banner = document.getElementById('milestone-banner');
  const title  = document.getElementById('lernpfad-title');
  if (!banner) return;
  if (!scannedTopics.length) {
    banner.classList.add('hidden');
    if (title) title.style.display = 'none';
    updateExamRecBanner();
    renderKlausurBridge(null);
    renderLernTip();
    return;
  }
  const m = calculateMilestone();
  banner.classList.remove('hidden');
  if (title) title.style.display = '';

  const autoIdx  = m.levelNum - 1;
  const selIdx   = selectedDiffIdx;
  const fracs    = m.fracs || [];

  const stepsHtml = MILESTONE_LEVELS.map((l, i) => {
    const frac     = fracs[i] || 0;
    const complete = frac >= 1;                 // ganze Stufe durchgelernt → Kreis voll
    const deg      = Math.round(frac * 360);    // Füllung im Uhrzeigersinn
    const isManual = selIdx !== null;
    const isActive = isManual ? i === selIdx : i === autoIdx;
    const cls = ['ms-step', isActive ? (isManual ? 'ms-manual' : 'ms-active') : '', complete ? 'ms-complete' : '']
                  .filter(Boolean).join(' ');
    // Verbindungsstrich wird dick/aktiv, sobald die Stufe LINKS davon voll ist.
    const lineClass = complete ? 'ms-line ms-line-done' : 'ms-line';
    return `<div class="${cls}" data-diffidx="${i}" style="--ms-frac:${deg}deg">
      <div class="ms-dot"><span class="ms-dot-emoji">${complete ? '✓' : l.emoji}</span></div>
      <div class="ms-label">${l.name}</div>
    </div>${i < MILESTONE_LEVELS.length - 1 ? `<div class="${lineClass}"></div>` : ''}`;
  }).join('');

  const activeDiffName = selIdx !== null ? MILESTONE_LEVELS[selIdx].name : (m.diff ? m.name : 'Einsteiger');
  const infoTxt = selIdx !== null
    ? `Modus: <strong>${MILESTONE_LEVELS[selIdx].name}</strong> · ${m.doneCount}/${m.totalTopics} Themen auf diesem Level · <span class="ms-reset-btn">Zurücksetzen</span>`
    : `${m.pct}% · ${m.doneCount}/${m.totalTopics} Themen auf <strong>${activeDiffName}</strong>-Level${m.rec ? ` · Empfehlung: <strong>${m.rec}</strong>` : ''}`;

  // Gesamtfortschritt oben (alle Niveaus zusammen) – bleibt beim Stufenwechsel
  // stehen, damit die per-Niveau-% nicht wie ein Reset wirkt (#5).
  const overallHtml = `
    <div class="ms-info" style="margin:0 0 4px"><strong>🎯 Gesamt:</strong> ${m.overallDone}/${m.totalTopics} Themen gelernt · ${m.overallPct}%</div>
    <div style="height:8px;border-radius:6px;background:rgba(127,127,127,.18);overflow:hidden;margin-bottom:12px">
      <div style="height:100%;width:${m.overallPct}%;background:linear-gradient(90deg,#34d399,#10b981);border-radius:6px;transition:width .4s"></div>
    </div>`;

  banner.innerHTML = `
    ${overallHtml}
    <div class="ms-steps">${stepsHtml}</div>
    <div class="ms-bar-wrap"><div class="ms-bar-fill" style="width:${m.pct}%"></div></div>
    <div class="ms-info">${infoTxt}</div>
    <div id="ms-klausur-foot" class="ms-klausur-foot"></div>`;

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
  renderKlausurBridge(m);
  renderLernTip();
}

// Einmalige Hinweis-Karte: beste Vorbereitungs-Strategie (nicht bei Einsteiger
// anfangen, kalibrieren, bis Prüfungsnah hocharbeiten, dann Probeklausur). Per
// localStorage dauerhaft ausblendbar – nervt nach dem Wegklicken nicht mehr.
function renderLernTip() {
  const el = document.getElementById('lern-tip-card');
  if (!el) return;
  let off = false;
  try { off = localStorage.getItem('lerntip_v1') === 'off'; } catch (_) {}
  if (off || !scannedTopics.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (el.dataset.rendered) return;   // Inhalt nur einmal aufbauen
  el.dataset.rendered = '1';
  el.innerHTML = `
    <button class="lern-tip-close" title="Ausblenden" aria-label="Ausblenden">×</button>
    <div class="lern-tip-head">💡 So bereitest du dich am besten vor</div>
    <ol class="lern-tip-list">
      <li><b>Nicht bei Einsteiger anfangen.</b> Mit Vorwissen aus der Vorlesung startest du auf <b>Lernender</b> – ein auf höherer Stufe gemeistertes Thema zählt automatisch für die niedrigeren.</li>
      <li><b>Kurz kalibrieren:</b> Öffne ein Thema auf Lernender/Fortgeschritten. Zu leicht → Stufe hoch; verloren → eine Stufe runter (geht pro Thema).</li>
      <li><b>Hocharbeiten bis Prüfungsnah</b> – dort werden mehrere Themen zu einer Klausuraufgabe. Genau das prüft die Klausur.</li>
      <li><b>Zum Schluss:</b> Probeklausur schreiben und die <b>🔄 fällig</b> markierten Themen auffrischen.</li>
    </ol>`;
  el.querySelector('.lern-tip-close').addEventListener('click', () => {
    try { localStorage.setItem('lerntip_v1', 'off'); } catch (_) {}
    el.classList.add('hidden');
  });
}

// Klausur-Brücke: macht die Probeklausur dort sichtbar, wo gelernt wird, und rahmt
// den Lernpfad als Weg dorthin. Die Botschaft skaliert mit dem Fortschritt, damit
// klar ist: jede Lernaufgabe zahlt auf die Klausur ein (die genau diese Themen testet).
// Probeklausur-Anschluss: sitzt als Footer IM Milestone-Block (kein eigenes
// Banner mehr) – der Fortschritt steht schon darüber, hier nur noch die Brücke
// zur Probeklausur. Botschaft skaliert mit dem Fortschritt.
function renderKlausurBridge(m) {
  const el = document.getElementById('ms-klausur-foot');
  if (!el) return;
  if (!m || !scannedTopics.length) { el.innerHTML = ''; return; }
  const ready    = m.overallPct;
  // Manuell gewählte Stufe hat Vorrang vor dem Auto-Level: wer den Pfad auf "Schwer"
  // stellt, soll die Probeklausur auch auf Schwer bekommen – nicht auf der Auto-Stufe.
  const recDiff  = (selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx].diff : m.diff) || 'mittel';
  let head, sub, cta, auto;
  if (ready >= 60) {
    head = '🎯 Bereit für eine Probeklausur';
    sub  = `Teste dich jetzt unter Klausurbedingungen – das zeigt dir, wo du wirklich stehst.`;
    cta  = 'Probeklausur starten →'; auto = true;
  } else if (ready >= 25) {
    head = '📝 Auf dem Weg zur Probeklausur';
    sub  = `Eine Probeklausur testet genau diese Themen – mach jederzeit eine, um deine Lücken zu sehen.`;
    cta  = 'Probeklausur ansehen →'; auto = false;
  } else {
    head = '📝 Dein Ziel: die Probeklausur';
    sub  = `Jede Aufgabe hier zahlt auf die Probeklausur ein – sie zieht ihre Fragen aus genau diesen Themen.`;
    cta  = 'Probeklausur ansehen →'; auto = false;
  }
  el.innerHTML = `
    <div class="kb-head">${head}</div>
    <div class="kb-sub">${sub}</div>
    <button class="btn-primary btn-sm kb-cta">${cta}</button>`;
  el.querySelector('.kb-cta').addEventListener('click', () => startKlausurFromLernen(recDiff, auto));
}

// Wechselt zum Klausur-Tab, richtet die Schwierigkeit am Lern-Niveau aus und
// startet (bei genug Fortschritt) direkt eine an den Lernpfad gekoppelte Klausur.
function startKlausurFromLernen(diff, auto) {
  switchMode('exam');
  const target = ['leicht', 'mittel', 'schwer', 'pruefungsnah', 'experte'].includes(diff) ? diff : 'mittel';
  const btn = document.querySelector(`.diff-btn[data-diff="${target}"]`);
  if (btn && !btn.disabled) {
    selDiff = target;
    document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
  }
  if (auto) generateExam();
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
      .then(t => {
        const norm = e => e.includes('::') ? e : e + '::einsteiger';
        const server = Array.isArray(t) ? t.map(norm) : [];
        // Mit dem In-Memory-Stand VEREINEN statt überschreiben – sonst gehen in
        // dieser Session/offline gelernte Themen verloren (konsistent mit openSubject).
        learnedTopics = [...new Set([...server, ...learnedTopics.map(norm)])];
        localforage.setItem(`lt_${sessionId}`, learnedTopics).catch(() => {});
        renderMilestone(); loadLernpfad();
      })
      .catch(() => {});
    localforage.getItem(`lsession_${sessionId}`)
      .then(s => { currentSession = s || null; renderSessionBanner(); })
      .catch(() => renderSessionBanner());
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
  const activeLvl  = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
  const activeDiff = activeLvl.diff || 'einsteiger';
  // "Getan" zählt auf ODER ÜBER dem aktiven Niveau: ein auf einer höheren Stufe
  // gemeistertes Thema gilt hier als fertig (Beherrschung impliziert niedrigere
  // Stufen) – nie wieder zum Wiederholen auffordern, was man schon übertroffen hat.
  // Nur niedriger Gelerntes bekommt den "⬆ Vertiefen"-Hinweis.
  const need = diffIdx(activeDiff);
  const isTopicDone  = topic => topicMaxLevel(topic) >= need;
  const wasDoneLower = topic => { const m = topicMaxLevel(topic); return m >= 0 && m < need; };
  let foundCurrent = false;
  const makeItem = topic => {
    const isDone       = isTopicDone(topic);                 // auf aktivem Niveau
    const needsUpgrade = wasDoneLower(topic);                // nur niedrigeres Niveau
    const isDue        = isDone && topicReviewDue(topic + '::' + activeDiff);
    const isCurrent    = !isDone && !needsUpgrade && !foundCurrent;
    if (isCurrent) foundCurrent = true;
    const item = document.createElement('div');
    item.className = `lernpfad-item${isDone ? ' is-done' : ''}${needsUpgrade ? ' is-upgrade' : ''}${isDue ? ' is-due' : ''}${isCurrent ? ' is-current' : ''}`;
    const diffLvl = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : null;
    const diffTag = diffLvl && !isDone ? ` <span class="lernpfad-diff-tag">${diffLvl.emoji} ${diffLvl.name}</span>` : '';
    const dueTag  = isDue ? ' <span class="lernpfad-due-tag">🔄 Wiederholung fällig</span>' : '';
    const upgradeTag = needsUpgrade ? ` <span class="lernpfad-upgrade-tag">⬆ Jetzt auf ${activeLvl.name}</span>` : '';
    const btnLabel = isDue ? 'Auffrischen →' : isDone ? 'Wiederholen' : needsUpgrade ? 'Vertiefen →' : 'Lernen →';
    const btnClass = isDone && !isDue ? 'lernpfad-btn lernpfad-btn-repeat' : 'lernpfad-btn';
    item.innerHTML = `
      <span class="lernpfad-status">${isDue ? '🔄' : isDone ? '✅' : needsUpgrade ? '✓' : isCurrent ? '▶' : '○'}</span>
      <span class="lernpfad-name">${esc(topic)}${diffTag}${dueTag}${upgradeTag}</span>
      <button class="${btnClass}">${btnLabel}</button>`;
    item.querySelector('.lernpfad-btn').addEventListener('click', () => openTopicView(topic));
    return item;
  };

  // Hebel 2: ein Item pro zusammengesetzter Einheit (Cluster/Kapitel) statt pro Thema.
  const makeUnitItem = unit => {
    const isDone    = unit.themen.every(t => topicMaxLevel(t) >= need);
    const someLower = !isDone && unit.themen.some(t => topicMaxLevel(t) >= 0);
    const isDue     = isDone && unit.themen.some(t => topicReviewDue(t + '::' + activeDiff));
    const isCurrent = !isDone && !someLower && !foundCurrent;
    if (isCurrent) foundCurrent = true;
    const item = document.createElement('div');
    item.className = `lernpfad-item lernpfad-unit${isDone ? ' is-done' : ''}${someLower ? ' is-upgrade' : ''}${isDue ? ' is-due' : ''}${isCurrent ? ' is-current' : ''}`;
    const countTag = ` <span class="lernpfad-unit-count">${unit.themen.length} Themen</span>`;
    const dueTag   = isDue ? ' <span class="lernpfad-due-tag">🔄 Wiederholung fällig</span>' : '';
    const upTag    = someLower ? ` <span class="lernpfad-upgrade-tag">⬆ Auf ${activeLvl.name} vertiefen</span>` : '';
    const btnLabel = isDue ? 'Auffrischen →' : isDone ? 'Wiederholen' : someLower ? 'Vertiefen →' : 'Klausuraufgabe →';
    const btnClass = isDone && !isDue ? 'lernpfad-btn lernpfad-btn-repeat' : 'lernpfad-btn';
    item.innerHTML = `
      <span class="lernpfad-status">${isDue ? '🔄' : isDone ? '✅' : someLower ? '✓' : isCurrent ? '▶' : '○'}</span>
      <span class="lernpfad-name">${esc(unit.name)}${countTag}${dueTag}${upTag}</span>
      <button class="${btnClass}">${btnLabel}</button>`;
    item.querySelector('.lernpfad-btn').addEventListener('click', () => openUnit(unit));
    return item;
  };

  // Interleaving-Toggle: Themen aus verschiedenen Kapiteln abwechselnd üben
  const controlsBar = document.createElement('div');
  controlsBar.className = 'lernpfad-controls';
  const ilBtn = document.createElement('button');
  ilBtn.className = `btn-secondary btn-sm interleave-btn${interleavedMode ? ' active' : ''}`;
  ilBtn.textContent = interleavedMode ? '🔀 Gemischt (aktiv)' : '🔀 Gemischter Modus';
  ilBtn.title = 'Themen aus verschiedenen Kapiteln abwechselnd üben (Interleaving)';
  ilBtn.addEventListener('click', () => {
    interleavedMode = !interleavedMode;
    loadLernpfad();
  });
  controlsBar.appendChild(ilBtn);
  // Re-Scan: ohne diesen Button gäbe es nach dem ersten Scan keine Möglichkeit mehr,
  // die Themen neu zu erkennen (der Erst-Scan-Button lebt nur im Empty-State)
  const rescanBtn = document.createElement('button');
  rescanBtn.className = 'btn-secondary btn-sm';
  rescanBtn.textContent = '🔄 Themen neu erkennen';
  rescanBtn.title = 'Alle Dokumente neu analysieren und Hauptthemen + Lernthemen neu aufbauen';
  rescanBtn.addEventListener('click', () => scanModuleStructure(rescanBtn));
  controlsBar.appendChild(rescanBtn);
  list.appendChild(controlsBar);

  const grain = GRAIN_BY_DIFF[activeDiff] || 'topic';

  if (grain !== 'topic' && moduleStructure?.kapitel?.length) {
    // Hebel 2: wenige große Einheiten (Cluster/Kapitel) – je eine integrierte Klausuraufgabe.
    const units = pathUnits(activeDiff);
    const label = document.createElement('div');
    label.className = 'kap-restructure-hint';
    label.innerHTML = `<span>🎯 ${activeLvl.name}: zusammengesetzte Klausuraufgaben – ${units.length} Einheiten statt ${pathTopics().length} Einzelthemen. Eine erledigt alle ihre Themen.</span>`;
    list.appendChild(label);
    units.forEach(u => list.appendChild(makeUnitItem(u)));
  } else if (interleavedMode && moduleStructure?.kapitel?.length > 1) {
    // Round-robin über Kapitel: Thema 1 aus Kap1, Thema 1 aus Kap2, Thema 2 aus Kap1 …
    const maxLen = Math.max(...moduleStructure.kapitel.map(k => k.themen.length));
    const label = document.createElement('div');
    label.className = 'kap-restructure-hint';
    label.innerHTML = `<span>🔀 Gemischter Modus – Themen aus verschiedenen Kapiteln abwechselnd</span>`;
    list.appendChild(label);
    for (let i = 0; i < maxLen; i++) {
      for (const kap of moduleStructure.kapitel) {
        if (i < kap.themen.length) list.appendChild(makeItem(kap.themen[i]));
      }
    }
  } else if (moduleStructure?.kapitel?.length) {
    // Modul-Reise: chapters with Lernziel + progress
    moduleStructure.kapitel.forEach((k, ki) => {
      const doneCount = k.themen.filter(isTopicDone).length;
      const total     = k.themen.length;
      const kapDone   = total > 0 && doneCount === total;
      const head = document.createElement('div');
      head.className = `kap-head${kapDone ? ' kap-done' : ''}`;
      head.innerHTML = `
        <div class="kap-num">${kapDone ? '✓' : ki + 1}</div>
        <div class="kap-info">
          <div class="kap-title">${esc(k.titel)}</div>
          ${k.lernziel ? `<div class="kap-ziel">🎯 ${esc(k.lernziel)}</div>` : ''}
        </div>
        <span class="kap-progress${kapDone ? ' kap-progress-done' : ''}">${doneCount}/${total}</span>`;
      list.appendChild(head);
      k.themen.forEach(topic => list.appendChild(makeItem(topic)));
    });
  } else {
    // Old flat list + hint to upgrade to chapters
    const hint = document.createElement('div');
    hint.className = 'kap-restructure-hint';
    hint.innerHTML = `<span>🗺️ Neu: Strukturiere deinen Lernpfad in Kapitel mit Lernzielen.</span>
      <button class="btn-secondary btn-sm">Jetzt strukturieren</button>`;
    hint.querySelector('button').addEventListener('click', e => scanModuleStructure(e.target));
    list.appendChild(hint);
    scannedTopics.forEach(topic => list.appendChild(makeItem(topic)));
  }
}

// ══ BELOHNUNG: XP, Tagesziel, Combo, Konfetti ══════════════════════════════
const XP_DAILY_GOAL = 100;
const XP_BY_DIFF = { einsteiger: 40, leicht: 55, mittel: 70, schwer: 90, pruefungsnah: 120 };
let comboCount = 0;

function xpKey() { return `xp_${new Date().toISOString().slice(0, 10)}`; }

async function addXP(n, reason) {
  if (!n) return;
  const prev = (await localforage.getItem(xpKey()).catch(() => 0)) || 0;
  const now  = prev + n;
  localforage.setItem(xpKey(), now).catch(() => {});
  updateXpChip(now);
  if (reason) toast(`⚡ +${n} XP · ${reason}`, 'success', 2200);
  if (prev < XP_DAILY_GOAL && now >= XP_DAILY_GOAL) {
    confettiBurst();
    setTimeout(() => toast('🎯 Tagesziel erreicht! Stark.', 'success', 4000), 400);
  }
}

function updateXpChip(value) {
  const el = document.getElementById('xp-chip');
  if (!el) return;
  const render = xp => {
    const pct = Math.min(100, Math.round((xp / XP_DAILY_GOAL) * 100));
    el.classList.remove('hidden');
    el.classList.toggle('xp-goal-done', xp >= XP_DAILY_GOAL);
    el.style.setProperty('--xp-pct', pct + '%');
    el.textContent = `⚡ ${xp}`;
  };
  if (typeof value === 'number') render(value);
  else localforage.getItem(xpKey()).then(xp => render(xp || 0)).catch(() => render(0));
}

function comboUp() {
  comboCount++;
  if (comboCount >= 3) {
    const bonus = comboCount * 5;
    toast(`🔥 ${comboCount}er-Combo! +${bonus} Bonus-XP`, 'success', 2800);
    addXP(bonus);
  }
}
function comboReset() { comboCount = 0; }

function confettiBurst() {
  const colors = ['#5856d6', '#007aff', '#34c759', '#ff9500', '#ff2d55', '#ffd60a'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti-wrap';
  for (let i = 0; i < 44; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.5) + 's';
    p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3200);
}

// ══ LERN-SESSION (Zeitbudget-Planer) ═══════════════════════════════════════
let currentSession = null;

const SESSION_SPECS = {
  '30m':        { topics: 1, quiz: 0, pauses: 0, label: '⚡ 30-Minuten-Session' },
  '1h':         { topics: 2, quiz: 3, pauses: 0, label: '⏱️ 1-Stunden-Session' },
  'halbtag':    { topics: 4, quiz: 5, pauses: 2, label: '🌤️ Halbtags-Session' },
  'wochenende': { topics: 6, quiz: 8, pauses: 3, label: '🏕️ Wochenend-Etappe' },
};

function sessionStoreKey() { return `lsession_${sessionId}`; }

async function buildSessionPlan(budget) {
  const spec = SESSION_SPECS[budget];
  const ms         = calculateMilestone();
  const activeIdx  = selectedDiffIdx !== null ? selectedDiffIdx : (ms.levelNum - 1);
  const activeLvl  = MILESTONE_LEVELS[activeIdx];
  const activeDiff = activeLvl.diff || 'einsteiger';
  const need = diffIdx(activeDiff);
  const isDone = t => topicMaxLevel(t) >= need;   // auf/über Niveau (Beherrschung impliziert tiefer)
  const isDue  = t => isDone(t) && topicReviewDue(t + '::' + activeDiff);
  const due  = scannedTopics.filter(isDue);
  const open = scannedTopics.filter(t => !isDone(t));
  const done = scannedTopics.filter(t => isDone(t) && !isDue(t));

  const items = [];
  let pausesLeft = spec.pauses;
  let topicCount = 0;
  const pushTopic = (t, icon) => {
    items.push({ type: 'topic', label: `${icon} ${t}`, target: t, done: false });
    topicCount++;
    if (pausesLeft > 0 && topicCount % 2 === 0 && topicCount < spec.topics) {
      items.push({ type: 'pause', label: '☕ Kurze Pause (10 Min)', done: false });
      pausesLeft--;
    }
  };
  // Reihenfolge nach Lernwirkung: fällige Wiederholungen (Spacing!) → neue Themen → Rest
  due.slice(0, Math.max(1, Math.floor(spec.topics / 2))).forEach(t => pushTopic(t, '🔄'));
  open.slice(0, spec.topics - topicCount).forEach(t => pushTopic(t, '📖'));
  if (topicCount < spec.topics) {
    done.slice(0, spec.topics - topicCount).forEach(t => pushTopic(t, '🔁'));
  }

  try {
    const cards = await DB.cards(sessionId);
    const due = cards.filter(c => c.due <= Date.now()).length;
    if (due > 0) items.push({ type: 'karten', label: `🃏 ${due} Karten wiederholen`, done: false });
  } catch (_) {}

  if (spec.quiz > 0) {
    items.push({ type: 'quiz', label: `❓ ${spec.quiz} Quiz-Fragen beantworten`, need: spec.quiz, got: 0, done: false });
  }

  // Dünner Plan abfedern: Hinweis, wenn es nichts NEUES auf diesem Level mehr gibt.
  let note = '';
  if (!open.length && scannedTopics.length) {
    const hasHigher = activeIdx < MILESTONE_LEVELS.length - 1;
    note = hasHigher
      ? `🎉 Du hast alle Themen auf <strong>${esc(activeLvl.name)}</strong> gelernt! Diese Session frischt Gelerntes auf – für neue Aufgaben erhöhe die Stufe im Lernpfad.`
      : `🏆 Stark – du hast alles auf der höchsten Stufe gelernt! Diese Session hält dein Wissen frisch.`;
  } else if (items.length <= 1) {
    note = `Kurzer Plan – es gibt gerade wenig zu tun. Scanne mehr Themen oder lege Karteikarten an, um die Sessions voller zu machen.`;
  }

  return { budget, label: spec.label, startedAt: new Date().toISOString(), items, note };
}

function saveSession() {
  if (!sessionId) return;
  if (currentSession) localforage.setItem(sessionStoreKey(), currentSession).catch(() => {});
  else localforage.removeItem(sessionStoreKey()).catch(() => {});
}

function sessionTick(kind, target) {
  if (!currentSession) return;
  let item = null;
  if (kind === 'topic')  item = currentSession.items.find(i => !i.done && i.type === 'topic' && i.target === target);
  if (kind === 'karten') item = currentSession.items.find(i => !i.done && i.type === 'karten');
  if (kind === 'quiz' || kind === 'quiz-complete') {
    item = currentSession.items.find(i => !i.done && i.type === 'quiz');
    if (item && kind === 'quiz') {
      item.got = (item.got || 0) + 1;
      if (item.got < item.need) { saveSession(); renderSessionBanner(); return; }
    }
  }
  if (!item) return;
  item.done = true;
  saveSession();
  renderSessionBanner();
  const left = currentSession.items.filter(i => !i.done).length;
  if (left > 0) toast(`✓ Session: noch ${left} Schritt${left === 1 ? '' : 'e'}`, 'success', 2000);
}

function renderSessionBanner() {
  const el = document.getElementById('session-banner');
  if (!el) return;
  if (!scannedTopics.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');

  if (!currentSession) {
    el.innerHTML = `<button class="btn-primary btn-sm" id="session-start-btn">▶️ Lern-Session starten</button>
      <span class="session-hint">Sag mir wie viel Zeit du hast – ich plane den Rest.</span>`;
    el.querySelector('#session-start-btn').addEventListener('click', () =>
      document.getElementById('session-sheet').classList.remove('hidden'));
    return;
  }

  const items = currentSession.items;
  const doneN = items.filter(i => i.done).length;
  const allDone = doneN === items.length;

  if (allDone) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(currentSession.startedAt)) / 60000));
    const topics = items.filter(i => i.type === 'topic').length;
    // Ausblick: nächstes offenes Thema als Köder für morgen
    const activeLvl  = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
    const activeDiff = activeLvl.diff || 'einsteiger';
    const lSet = learnedKeySet();
    const next = pathTopics().find(t => !lSet.has(learnedKey(t, activeDiff)));
    el.innerHTML = `
      <div class="session-done-card">
        <div class="session-done-title">🎉 Session geschafft!</div>
        <div class="session-done-stats">${topics} Themen · ${items.length} Schritte · ${mins} Min</div>
        ${next ? `<div class="session-next-teaser">Als Nächstes wartet: <strong>${esc(next)}</strong></div>` : ''}
        <button class="btn-primary btn-sm" id="session-finish-btn">Abschließen</button>
      </div>`;
    el.querySelector('#session-finish-btn').addEventListener('click', () => {
      currentSession = null; saveSession(); renderSessionBanner();
      confettiBurst();
      addXP(100, 'Session abgeschlossen');
    });
    return;
  }

  const pct = Math.round((doneN / items.length) * 100);
  const rows = items.map((i, idx) => {
    const sub = i.type === 'quiz' && !i.done && i.got > 0 ? ` <span class="session-item-sub">${i.got}/${i.need}</span>` : '';
    return `<div class="session-item${i.done ? ' done' : ''}" data-idx="${idx}">
      <span class="session-item-check">${i.done ? '✅' : '○'}</span>
      <span class="session-item-label">${esc(i.label)}${sub}</span>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="session-head">
      <span class="session-title">${currentSession.label}</span>
      <span class="session-count">${doneN}/${items.length}</span>
      <button class="session-abort" title="Session beenden">✕</button>
    </div>
    <div class="session-bar"><div class="session-bar-fill" style="width:${pct}%"></div></div>
    ${currentSession.note ? `<div class="session-note">${currentSession.note}</div>` : ''}
    <div class="session-items">${rows}</div>`;
  el.querySelector('.session-abort').addEventListener('click', async () => {
    if (!await confirmDialog('Deine geplante Lern-Session wird verworfen.',
        { title: 'Session beenden', okText: 'Beenden', danger: true })) return;
    currentSession = null; saveSession(); renderSessionBanner();
  });
  el.querySelectorAll('.session-item').forEach(row => row.addEventListener('click', () => {
    const item = currentSession.items[+row.dataset.idx];
    if (!item || item.done) return;
    if (item.type === 'topic')  openTopicView(item.target);
    if (item.type === 'karten') switchMode('karten');
    if (item.type === 'quiz')   switchMode('quiz');
    if (item.type === 'pause')  { item.done = true; saveSession(); renderSessionBanner(); }
  }));
}

document.querySelectorAll('.session-budget-btn').forEach(b => b.addEventListener('click', async () => {
  document.getElementById('session-sheet').classList.add('hidden');
  try {
    currentSession = await buildSessionPlan(b.dataset.budget);
    saveSession();
    renderSessionBanner();
    toast('Session geplant – tippe den ersten Schritt an!', 'success', 3000);
  } catch (e) {
    console.error('Session build failed:', e);
    toast('Fehler beim Planen der Session: ' + e.message, 'error');
  }
}));
document.getElementById('session-sheet-close')?.addEventListener('click', () =>
  document.getElementById('session-sheet').classList.add('hidden'));
document.getElementById('session-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('session-sheet').classList.add('hidden');
});

// ── Lernen canvas state ────────────────────────────────────────────────────
let lernenCtx       = null;
let isDrawingLernen = false;
let lernenLastX     = 0, lernenLastY = 0;
let lernenLastMidX  = 0, lernenLastMidY = 0; // letzter Kurven-Mittelpunkt (Glättung)
let lernenPtBuf     = [];           // gepufferte Punkte, einmal pro Frame gezeichnet (rAF)
let lernenRaf       = 0;            // laufende requestAnimationFrame-ID (0 = keine)
let lernenPenColor  = '#1c1c1e';
let lernenTool      = 'pen';
let lernenActivePtr = null; // palm rejection: track active pointer ID
let lernenDownTime  = 0;    // timeStamp des Strich-Beginns – verwirft veraltete up/cancel (Apple Pencil recycelt pointerId)
let lernenPenActive = false;        // Stift liegt auf → Touch ignorieren (Palm-Rejection)
let lernenFingerId  = null;         // PointerId des scrollenden Fingers
let lernenFingerY0  = 0;            // Start-Y des Finger-Scrolls
let lernenScroll0   = 0;            // scrollTop bei Scroll-Beginn
const LERNEN_HEIGHT = 2400;         // langer Notizblock (scrollbar), nicht nur bildschirmhoch
let lernenTopicData = null;
let lernenQaMsgs    = [];
let lernenAnswerMode = 'canvas'; // 'canvas' | 'text' — gesteuert nur, welcher Eingabebereich sichtbar ist
let lernenHasInk    = false;     // true sobald auf die Zeichenfläche geschrieben wurde (für kombinierte Prüfung)
let selectedDiffIdx   = null; // null = auto from progress, 0-4 = manual override
let lernenCurrentDiff = 'einsteiger'; // diff key active when topic was opened
let lernenAttempts    = 0;            // reset per task, shown in success toast
let lernenLastEval    = null;         // letzte KI-Auswertung derselben Aufgabe (konsistente Re-Prüfung)

// Bewertungsmaßstab/Strenge an das Niveau gekoppelt (Modul-Ebene, damit sowohl die
// Prüfung als auch der Musterlösungs-Prefetch dasselbe Niveau verwenden).
const LERN_GRADE_STD = {
  einsteiger: `NIVEAU EINSTEIGER: Bewerte das konzeptuelle Verständnis. Eigene Worte und Alltagssprache sind völlig in Ordnung – Fachbegriffe sind NICHT erforderlich, solange die Kernidee inhaltlich stimmt. Die Musterlösung ("loesung") ebenfalls in einfacher, zugänglicher Sprache schreiben.`,
  leicht: `NIVEAU GRUNDLAGEN: Eigene Worte sind in Ordnung. Grobe Begriffsverwechslungen zählen als Fehler, aber exakte Fachterminologie ist nicht nötig. Musterlösung in einfacher Sprache mit den wichtigsten Grundbegriffen.`,
  mittel: `NIVEAU LERNENDER: Die zentralen Fachbegriffe des Themas sollten korrekt verwendet werden. Kleinere sprachliche Ungenauigkeiten sind ok, wenn das Verständnis klar erkennbar ist. Musterlösung mit korrekten Fachbegriffen.`,
  schwer: `NIVEAU FORTGESCHRITTEN: Präzise Fachsprache wird erwartet. Fehlende oder falsch verwendete zentrale Fachbegriffe senken die Bewertung. Musterlösung in vollständiger Fachsprache.`,
  pruefungsnah: `NIVEAU PRÜFUNGSNAH: Klausurmaßstab. Exakte Fachterminologie, vollständige Begründungen und saubere Notation wie in einer Prüfung erforderlich – bewerte wie ein strenger Korrektor. Musterlösung als vollständige Klausur-Musterlösung.`,
};
const LERN_STRICTNESS = {
  einsteiger:   `Bewerte WOHLWOLLEND und ermutigend. Es geht um das grundsätzliche Verständnis, nicht um Perfektion. Im Zweifel zugunsten des Studenten entscheiden.`,
  leicht:       `Bewerte fair und eher wohlwollend. Kleinere Ungenauigkeiten nicht überbewerten.`,
  mittel:       `Bewerte fair und ausgewogen.`,
  schwer:       `Bewerte streng. Vollständigkeit und Genauigkeit zählen.`,
  pruefungsnah: `Bewerte SEHR STRENG nach Klausurmaßstab.`,
};

// Musterlösung-Prefetch: Die Lösung einer Aufgabe hängt NICHT von der Antwort des
// Studenten ab – sie kann also schon generiert werden, während er die Aufgabe noch
// bearbeitet. Beim "Prüfen" steht sie dann sofort bereit und die Bewertung wird
// kürzer (sie muss die Lösung nicht mehr selbst ausformulieren).
let lernenLoesung = null; // { aufgabe, promise, text } – text gesetzt sobald fertig

function prefetchLernenLoesung() {
  if (!lernenTopicData || !lernenTopicData.aufgabe) return;
  const aufgabe = lernenTopicData.aufgabe;
  if (lernenLoesung && lernenLoesung.aufgabe === aufgabe) return; // läuft schon / fertig
  const gradeNote = LERN_GRADE_STD[lernenCurrentDiff] || LERN_GRADE_STD.einsteiger;
  const sys = `Löse die folgende Übungsaufgabe vollständig und korrekt – AUSSCHLIESSLICH auf Basis der bereitgestellten Unterlagen.
${gradeNote}
Gib NUR die Musterlösung zurück (Markdown-Fließtext, KEIN JSON, keine Einleitung, keine Anrede). Bei Teilaufgaben (a/b/c oder 1/2/3) bekommt JEDE Teilaufgabe einen eigenen Absatz, beginnend mit der Bezeichnung fett: **a)** ...
Bei Rechenaufgaben: rechne jeden Schritt sauber und nachvollziehbar vor.`;
  const entry = { aufgabe, promise: null, text: '' };
  entry.promise = (async () => {
    try {
      const r = await claudeLocal([{ role: 'user', content: `Aufgabe: ${aufgabe}` }], sysBlocks(sys), 1500);
      const txt = (r || '').trim();
      if (lernenLoesung === entry) entry.text = txt; // nur cachen wenn noch aktuell
      return txt;
    } catch { return ''; }
  })();
  entry.promise.catch(() => {});
  lernenLoesung = entry;
}

// ── Spaced Review: Vergessenskurve für Lernpfad-Themen ─────────────────────
// topicMeta["Thema::diff"] = { ts: <zuletzt gelernt>, attempts: <Versuche bis korrekt> }
// Sicher gekonnt (1 Versuch) → nach 7 Tagen fällig; wacklig (≥2 Versuche) → nach 3 Tagen.
let topicMeta = {};

const REVIEW_AFTER_STRONG_MS = 7 * 86400000;
const REVIEW_AFTER_WEAK_MS   = 3 * 86400000;

// ── v98: Lern-Psychologie Extras ──────────────────────────────────────────
let quizConfidence  = 0;      // 1=unsicher, 2=eher sicher, 3=sehr sicher (0=nicht gesetzt)
let lastFbTopicName = '';     // Thema der letzten Quiz-Frage (für "Vertiefen")
let nextQ = null;             // Prefetch: { promise, forDone, forSession } – nächste Quiz-Frage vorab geladen
let interleavedMode = false;  // Lernpfad-Reihenfolge über Kapitel mischen

function topicReviewDue(key) {
  const m = topicMeta[normFullKey(key)];
  if (!m || !m.ts) return false; // ohne Metadaten (Altbestand) nie als fällig markieren
  const interval = (m.attempts || 1) >= 2 ? REVIEW_AFTER_WEAK_MS : REVIEW_AFTER_STRONG_MS;
  return Date.now() - m.ts >= interval;
}

function saveTopicMeta() {
  if (sessionId) localforage.setItem(`ltmeta_${sessionId}`, topicMeta).catch(() => {});
}

function openTopicView(topic) {
  openUnit({ kind: 'topic', themen: [topic], name: topic });
}

function openUnit(unit) {
  currentUnit = unit;
  const topic = unit.name;
  currentExplainerTopic = topic;
  lernenTopicData = null;
  lernenLoesung   = null; // Musterlösung-Prefetch des vorherigen Themas verwerfen
  lernenQaMsgs    = [];
  lernenAttempts  = 0;
  lernenLastEval  = null;
  lernenHasInk    = false;
  lernenCtx       = null;
  lernenActivePtr = null;
  isDrawingLernen = false;
  // Switch views
  document.getElementById('lernen-pfad-view').classList.add('hidden');
  document.getElementById('lernen-topic-view').style.display = 'flex';
  document.getElementById('lernen-topic-name').textContent = topic;
  document.getElementById('lernen-qa-title').textContent = 'Fragen zu: ' + topic;
  const badge = document.getElementById('lernen-diff-badge');
  {
    const l = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
    lernenCurrentDiff = l.diff || 'einsteiger';
    if (badge) {
      badge.textContent = `${l.emoji} ${l.name}`;
      badge.className = `lernen-diff-badge lernen-diff-badge--${lernenCurrentDiff}`;
    }
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
  document.getElementById('lernen-erkl-loading').style.display = 'none';
  document.getElementById('lernen-erkl-body').classList.add('hidden');
  document.getElementById('lernen-elaborate')?.classList.add('hidden');
  document.getElementById('lernen-step1-footer').classList.add('hidden');
  document.getElementById('lernen-tab-aufgabe').disabled = true;
  document.getElementById('lernen-done-btn').classList.add('hidden');
  lernenSwitchStep(1);
  // Vorwissen-Abfrage entfernt – direkt zur Erklärung, egal ob neu, fällig oder Wiederholung.
  const isDue = unit.themen.some(t => topicReviewDue(t + '::' + lernenCurrentDiff));
  document.getElementById('lernen-erkl-loading').style.display = '';
  loadTopicContent(topic, isDue);
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
function lernenCacheKey() {
  const diff = selectedDiffIdx !== null ? (MILESTONE_LEVELS[selectedDiffIdx].diff || 'einsteiger') : 'auto';
  // An die stabile Einheits-ID gekoppelt → Cache überlebt Umbenennen/Re-Scan und
  // trennt zusammengesetzte Einheiten sauber von Einzel-Themen.
  return `lc2_${sessionId}_${unitId(curUnit())}_${diff}`;
}

async function loadExamDocContext(subjId) {
  const examTypes = new Set(['klausur', 'altklausur', 'uebungsblatt']);
  const docLabel = d => {
    const found = DOC_TYPES.find(t => t.value === (d.doc_type || d.docType));
    return found ? found.label : (d.doc_type || d.docType || '');
  };
  try {
    const docs = await api(`/api/subjects/${subjId}/documents/typed?types=klausur,altklausur,uebungsblatt`);
    if (docs && docs.length) {
      return docs.map(d => `[${docLabel(d)}: ${d.filename}]\n${d.content}`).join('\n\n---\n\n');
    }
  } catch {}
  // Fallback: use localforage docmeta snippets
  try {
    const meta = (await localforage.getItem(`docmeta_${subjId}`).catch(() => null)) || [];
    const examDocs = meta.filter(m => examTypes.has(m.docType));
    if (examDocs.length) {
      return examDocs.map(d => `[${docLabel(d)}: ${d.name}]\n${d.snippet || ''}`).join('\n\n---\n\n');
    }
  } catch {}
  return '';
}

function getDiffInstr(effLevel, examCtx, siblings = [], lernziel = '') {
  const examSnippet = examCtx && examCtx.trim()
    ? `\n\nKLAUSUR-REFERENZ: Orientiere dich an Aufgabentyp, Stil und Komplexität folgender Prüfungsunterlagen. Mimiere deren Formulierungen, Notation und Schwierigkeitsgrad:\n${examCtx.slice(0, 8000)}`
    : '';
  // Auf hohem Niveau soll die Aufgabe NICHT bloß "härter" sein, sondern größer:
  // mehrere Themen des Kapitels in EINER mehrteiligen Klausuraufgabe integrieren.
  // Das spiegelt das Probeklausur-Format und behebt das "zu kleinteilig"-Gefühl.
  const sibTxt = siblings.length
    ? ` Verknüpfe es dabei mit verwandten Themen desselben Kapitels: ${siblings.slice(0, 4).join(', ')}.`
    : '';
  const zielTxt = lernziel ? ` Messlatte ist das Kapitel-Lernziel: "${lernziel}".` : '';
  const integrate = `${sibTxt}${zielTxt} Baue eine MEHRTEILIGE Aufgabe (Teil a, b, c …), deren Teile aufeinander aufbauen. Der Studierende muss SELBST erkennen, welche Methode/welches Konzept je Teil greift – nenne das NICHT vorab.`;
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
AUFGABE: Eine zusammengesetzte, klausurnahe Aufgabe.${integrate}${examSnippet}`;
    case 'pruefungsnah':
      return `Niveau: EXPERTE (Stufe 5 von 5).
ERKLÄRUNG: Prüfungsqualität. "Was ist das?" = exakte wissenschaftliche Definition wie in einem Lehrbuch. "Warum wichtig?" = theoretische Fundierung, Herleitung, Abgrenzung zu ähnlichen Konzepten. "Beispiel" = Fallstudie oder Prüfungsbeispiel mit vollständigem Lösungsweg. Rechenbeispiel: vollständig ausformuliert mit Formelangaben, Einheiten, Interpretation des Ergebnisses.
AUFGABE: Eine vollständige Klausuraufgabe im Prüfungsformat mit Punkteangabe je Teil und Prüfungssprache.${integrate}${examSnippet}`;
    default:
      return `Niveau: EINSTEIGER (Stufe 1 von 5).
ERKLÄRUNG: Erkläre als ob der Student das Thema noch nie gehört hat. Kein Vorwissen annehmen. Kurz, klar, mit einfachsten Worten. Rechenbeispiel nur wenn unbedingt nötig, dann maximal ein Schritt.
AUFGABE: Sehr einfache Aufgabe, intuitiv lösbar.`;
  }
}

function renderTopicContent(topic, data) {
  document.getElementById('lernen-erkl-loading').style.display = 'none';
  const fmtMd   = s => safeHtml(md(s || ''));
  const fmtPre  = s => esc(s || '').replace(/\n/g, '<br>'); // keep for monospace rechnung
  const section = (icon, label, cls, inner) =>
    `<div class="explainer-section${cls ? ' ' + cls : ''}">` +
      `<div class="explainer-label"><span class="explainer-licon">${icon}</span>${label}</div>` +
      inner +
    `</div>`;
  let html = `<h2 class="lernen-erkl-title">📖 ${esc(topic)}</h2>`;
  if (data.was)    html += section('💡', 'Was ist das?',       '',                    `<div class="explainer-body">${fmtMd(data.was)}</div>`);
  if (data.warum)  html += section('🎯', 'Warum wichtig?',     '',                    `<div class="explainer-body">${fmtMd(data.warum)}</div>`);
  if (data.vertiefung && data.vertiefung.trim())
                   html += section('🔍', 'Vertiefung',         'explainer-section--deep', `<div class="explainer-body">${fmtMd(data.vertiefung)}</div>`);
  if (data.beispiel) html += section('📋', 'Konkretes Beispiel', '',                  `<div class="explainer-body">${fmtMd(data.beispiel)}</div>`);
  if (data.rechnung && data.rechnung.trim())
                   html += section('📐', 'Rechenbeispiel',     '',                    `<div class="explainer-rechnung">${fmtPre(data.rechnung)}</div>`);
  const body = document.getElementById('lernen-erkl-body');
  body.innerHTML = html;
  body.classList.remove('hidden');

  // Elaborative Interrogation: Reflexionsfrage nach der Erklärung.
  // Nur bei frisch gelernten Themen; bei Wiederholung (bereits gelernt) überspringen.
  const elabEl = document.getElementById('lernen-elaborate');
  const isFresh = !learnedKeySet().has(learnedKey(topic, lernenCurrentDiff));
  if (elabEl && isFresh) {
    const templates = [
      `Erkläre "${topic}" in deinen eigenen Worten – als würdest du es jemandem ohne Vorkenntnisse erklären.`,
      `Warum ist "${topic}" wichtig, und wo begegnet dir das Konzept in der Praxis?`,
      `Was ist das Kernprinzip hinter "${topic}"? Was wäre das Erste, was du jemandem darüber sagen würdest?`,
      `Wie hängt "${topic}" mit anderen Konzepten zusammen, die du kennst?`,
    ];
    const q = templates[Math.floor(Math.random() * templates.length)];
    const elabQ = document.getElementById('elaborate-q');
    const elabIn = document.getElementById('elaborate-input');
    if (elabQ) elabQ.textContent = '🤔 ' + q;
    if (elabIn) elabIn.value = '';
    elabEl.classList.remove('hidden');
    // Keep step1-footer hidden until elaboration is confirmed/skipped
    document.getElementById('lernen-step1-footer').classList.add('hidden');
  } else {
    if (elabEl) elabEl.classList.add('hidden');
    document.getElementById('lernen-step1-footer').classList.remove('hidden');
  }

  if (data.aufgabe && data.aufgabe.trim()) {
    document.getElementById('lernen-task-bar').innerHTML = safeHtml(md(data.aufgabe));
    document.getElementById('lernen-tab-aufgabe').disabled = false;
    document.getElementById('lernen-regen-btn').classList.remove('hidden');
  } else if (!isFresh) {
    // Thema ohne Übungsaufgabe: bei Wiederholung sofort abhakbar. Beim ERSTEN Mal
    // erst nach der Reflexionsfrage (finishElaboration) – "fertig" soll überall
    // mindestens aktives Erinnern bedeuten, nicht bloßes Lesen (#3).
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

async function loadTopicContent(topic, forceFresh = false) {
  // Serve from cache if available (außer bei fälliger Wiederholung → frische Aufgabe)
  const cached = forceFresh ? null : await localforage.getItem(lernenCacheKey()).catch(() => null);
  // Stale guard: user may have navigated to a different topic while awaiting cache/AI
  if (currentExplainerTopic !== topic) return;
  if (cached) {
    lernenTopicData = cached;
    renderTopicContent(topic, cached);
    prefetchLernenLoesung(); // Musterlösung im Hintergrund vorbereiten
    return;
  }
  const stopProg = startProgress('lernen-prog-bar', 'lernen-prog-pct', 18000);
  const effLevel = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
  const useExam = effLevel.diff === 'schwer' || effLevel.diff === 'pruefungsnah';
  // Einheit bestimmt den Behandlungsgegenstand: ein Thema ODER ein zusammengesetzter
  // Satz (Cluster/Kapitel). Composite → die Member sind der Integrations-Satz.
  const unit = curUnit();
  const isComposite = unit.kind !== 'topic';
  const sibs = isComposite ? unit.themen : (useExam ? chapterSiblings(topic) : []);
  const lernziel = unit.lernziel || chapterOf(unit.themen[0])?.lernziel || chapterOf(topic)?.lernziel || '';
  const subjectClause = isComposite
    ? `die folgenden zusammengehörenden Themen GEMEINSAM als EINE Lerneinheit: ${unit.themen.join(', ')}`
    : `das Thema "${topic}"`;
  const compositeNote = isComposite
    ? `\n- Dies ist EINE zusammengesetzte Einheit: gib eine kompakte gemeinsame Einordnung (nicht jedes Thema einzeln durchdeklinieren) und in "aufgabe" GENAU EINE integrierte, mehrteilige Aufgabe, die die Themen verbindet.`
    : '';
  const diffInstr = getDiffInstr(effLevel, useExam ? examDocContext : '', sibs, lernziel);
  try {
    const raw = await claudeLocal(
      [{ role: 'user', content: `Behandle ${subjectClause} auf dem vorgegebenen Niveau.` }],
      [{
        type: 'text',
        text: `Unterlagen des Fachs "${sessionMeta?.name || ''}" (einzige erlaubte Wissensquelle):\n${docsForPrompt()}`,
        cache_control: { type: 'ephemeral' },
      }, {
        type: 'text',
        text: `Behandle ${subjectClause} AUSSCHLIESSLICH auf Basis der obigen Unterlagen. Suche die passenden Stellen im gesamten Material.\n\n${diffInstr}\n\nWICHTIG:${compositeNote}\n- Das Niveau beeinflusst ALLE Felder – Tiefe, Sprache, Komplexität.\n- Für konzeptuelle/theoretische Themen (ohne viel Mathematik): schreibe ausführliche, lehrreiche Texte. Kein künstliches Kürzen – so lang wie nötig für echtes Verständnis.\n- "vertiefung": Nutze dieses Feld für Hintergründe, Zusammenhänge mit anderen Konzepten, häufige Missverständnisse, historische Einordnung – alles was hilft das Thema wirklich zu durchdringen. Leer lassen wenn kein Mehrwert.\n- "rechnung": Nur befüllen wenn das Thema tatsächlich Rechenoperationen beinhaltet. Sonst leer lassen.\n- "werte": Nur bei Rechenaufgaben – Array mit den wichtigsten Zahlenwerten aus der Aufgabe (z.B. ["500 € Startkapital","8 % Zinssatz p.a."]). Bei konzeptuellen Aufgaben ohne Zahlenwerte: leeres Array [].\n- "aufgabe": Übungsaufgabe passend zum Niveau. Bei mehreren Teilfragen jede Frage auf einer neuen Zeile (trenne mit \\n\\n). NIEMALS Lösungen, Musterlösungen, Hinweise auf die Antworten oder Lösungswege im Aufgabentext!\n\nAntworte NUR als JSON-Objekt (kein Text davor/danach, keine Zeilenumbrüche im JSON außer \\n in Texten):\n{"was":"Vollständige Erklärung des Konzepts – so ausführlich wie nötig","warum":"Bedeutung und Relevanz – ausführlich begründet","vertiefung":"Vertiefung: Hintergründe, Zusammenhänge, Besonderheiten (leer lassen wenn nicht hilfreich)","beispiel":"Konkretes Praxisbeispiel passend zum Niveau","rechnung":"Schritt-für-Schritt Rechenbeispiel (nutze \\n zwischen Schritten). Leer lassen wenn kein Rechnen nötig.","aufgabe":"Aufgabentext ohne Lösungen. Jede Teilfrage auf eigener Zeile.","werte":[]}`,
      }],
      2500
    );
    // Stale guard: discard if user opened a different topic while AI was running
    if (currentExplainerTopic !== topic) { stopProg(); return; }
    let data = null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { data = parseJsonLoose(m[0]); } catch { data = null; } }
    if (!data) throw new Error('Keine Erklärung erhalten');
    lernenTopicData = data;
    localforage.setItem(lernenCacheKey(), data).catch(() => {});
    stopProg();
    renderTopicContent(topic, data);
    prefetchLernenLoesung(); // Musterlösung im Hintergrund vorbereiten
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
    const useExam = effLevel.diff === 'schwer' || effLevel.diff === 'pruefungsnah';
    const unit = curUnit();
    const isComposite = unit.kind !== 'topic';
    const sibs = isComposite ? unit.themen : (useExam ? chapterSiblings(topic) : []);
    const lernziel = unit.lernziel || chapterOf(unit.themen[0])?.lernziel || chapterOf(topic)?.lernziel || '';
    const gegenstand = isComposite ? `zur Einheit "${topic}" (Themen: ${unit.themen.join(', ')})` : `zum Thema "${topic}"`;
    const diffInstr = getDiffInstr(effLevel, useExam ? examDocContext : '', sibs, lernziel);
    const raw = await claudeLocal(
      [{ role: 'user', content: `Generiere eine neue Übungsaufgabe ${gegenstand}.` }],
      [{
        type: 'text',
        text: `Unterlagen des Fachs "${sessionMeta?.name || ''}" (einzige erlaubte Wissensquelle):\n${docsForPrompt()}`,
        cache_control: { type: 'ephemeral' },
      }, {
        type: 'text',
        text: `Generiere eine NEUE, andere Übungsaufgabe ${gegenstand} – ausschließlich auf Basis der obigen Unterlagen.\n${diffInstr}\n\nDie Aufgabe muss dem Niveau entsprechen (Komplexität, Sprache, Tiefe).\nBei mehreren Teilfragen jede Frage auf einer neuen Zeile (\\n\\n).\nNIEMALS Lösungen, Musterlösungen oder Hinweise auf die richtigen Antworten im Aufgabentext!\n\nAntworte NUR als JSON:\n{"aufgabe":"Aufgabentext ohne Lösungen. Jede Teilfrage auf eigener Zeile."}`,
      }],
      600
    );
    const m = raw.match(/\{[\s\S]*\}/);
    let newAufgabe = null;
    if (m) { try { newAufgabe = parseJsonLoose(m[0]).aufgabe; } catch {} }
    if (newAufgabe && newAufgabe.trim()) {
      lernenTopicData.aufgabe = newAufgabe;
      document.getElementById('lernen-task-bar').innerHTML = safeHtml(md(newAufgabe));
      localforage.setItem(lernenCacheKey(), lernenTopicData).catch(() => {});
      // Clear canvas and textarea for fresh start
      if (lernenCtx) {
        lernenCtx.globalCompositeOperation = 'source-over';
        lernenCtx.clearRect(0, 0, document.getElementById('lernen-canvas-wrap').clientWidth, LERNEN_HEIGHT);
      }
      lernenHasInk = false;
      const ta = document.getElementById('lernen-text-answer');
      if (ta) ta.value = '';
      document.getElementById('lernen-done-btn').classList.add('hidden');
      const rb = document.getElementById('lernen-result-bar');
      if (rb) { rb.innerHTML = ''; rb.className = 'lernen-result-bar hidden'; }
      lernenAttempts = 0;
      lernenLastEval = null;
      lernenLoesung = null;        // alte Musterlösung verwerfen
      prefetchLernenLoesung();     // für die neue Aufgabe vorbereiten
      toast('Neue Aufgabe generiert', 'success', 2000);
    } else {
      toast('Keine neue Aufgabe erhalten', 'warn');
    }
  } catch (e) { toast('Fehler: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '🔄 Neue Aufgabe';
}

function retryLernenSameTask() {
  if (lernenCtx) {
    const wrap = document.getElementById('lernen-canvas-wrap');
    lernenCtx.globalCompositeOperation = 'source-over';
    lernenCtx.clearRect(0, 0, wrap.clientWidth, LERNEN_HEIGHT);
  }
  const ta = document.getElementById('lernen-text-answer');
  if (ta) ta.value = '';
  lernenHasInk = false;
  const rb = document.getElementById('lernen-result-bar');
  if (rb) { rb.innerHTML = ''; rb.className = 'lernen-result-bar hidden'; }
}

function initLernenCanvas() {
  const canvas = document.getElementById('lernen-canvas');
  const wrap   = document.getElementById('lernen-canvas-wrap');
  if (!canvas || !wrap || lernenCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const w   = wrap.clientWidth  || 800;
  const h   = LERNEN_HEIGHT;               // fester, langer Notizblock → scrollbar
  canvas.style.height = h + 'px';
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  lernenCtx = canvas.getContext('2d');
  lernenCtx.scale(dpr, dpr);
  // Bitmap bleibt transparent (nur Tinte); Weiß + Raster kommen aus dem CSS-Hintergrund.
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
  // Sicherheitsnetz wie beim Rechnen-Canvas: Verschluckt iPad-Safari das pointerup (Pointer-
  // Capture-Verlust), blieben sonst lernenPenActive/isDrawingLernen hängen → Palm-Rejection
  // sperrt den Finger-Scroll. Gleiche Fn-Referenz ⇒ addEventListener entdoppelt, kein
  // Mehrfach-Listener über Themenwechsel hinweg. onLernenUp endet nur beim passenden Pointer.
  window.addEventListener('pointerup',     onLernenUp);
  window.addEventListener('pointercancel', onLernenUp);
}

// Convert a pointer event to canvas context coordinates.
// Accounts for any mismatch between the canvas buffer size and its CSS display
// size (e.g. when the task-bar is resized after the canvas was initialised).
function lernenPos(e, canvas, r) {
  const dpr = window.devicePixelRatio || 1;
  const sx = canvas.width  / (r.width  * dpr);
  const sy = canvas.height / (r.height * dpr);
  return {
    x: (e.clientX - r.left) * sx,
    y: (e.clientY - r.top)  * sy,
  };
}

function onLernenDown(e) {
  const canvas = e.target;
  const wrap   = document.getElementById('lernen-canvas-wrap');
  const isDrawer = (e.pointerType === 'pen' || e.pointerType === 'mouse');

  if (!isDrawer) {
    // Finger ODER Handfläche – zeichnen ist hier unmöglich (nur Stift/Maus zeichnen).
    // Palm-Rejection: während der Stift schreibt, alle Touches ignorieren.
    // (Keine Größen-Heuristik – ein Fingerkontakt ist auf dem iPad oft >45px und würde sonst fälschlich geblockt.)
    if (lernenPenActive) return;
    // Finger (oder ruhende Handfläche bei nicht schreibendem Stift) → Notizblock per JS scrollen.
    lernenFingerId = e.pointerId;
    lernenFingerY0 = e.clientY;
    lernenScroll0  = wrap.scrollTop;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  // Stift / Maus → zeichnen
  e.preventDefault();
  // Ein neuer Stift-/Maus-Kontakt startet IMMER einen neuen Strich – nie auf einen alten
  // lernenActivePtr abblocken. Kam dessen pointerup nicht an (Pointer-Capture-Verlust in
  // iPad-Safari), blieb lernenActivePtr gesetzt und JEDER Folgestrich wurde verschluckt
  // ("Schreiben funktioniert nicht mehr"). Stattdessen den neuen Kontakt übernehmen.
  lernenPenActive = true;
  clearTextSelection();                 // evtl. durch Handfläche entstandene Markierung wegnehmen
  lernenFingerId  = null;               // Stift gewinnt: laufenden Finger-Scroll abbrechen
  lernenActivePtr = e.pointerId;
  lernenDownTime  = e.timeStamp;   // ab jetzt zählt nur, was NACH diesem Aufsetzen erzeugt wurde
  // Capture darf den Strich NICHT abwürgen: hält iPad-Safari bei zwei dicht aufeinander
  // folgenden Strichen die Capture des vorigen Pointers noch, wirft setPointerCapture für
  // den neuen Pointer – ungefangen bräche der ganze pointerdown ab und der Strich ginge
  // verloren ("manchmal schreibt er nicht"). Capture ist nur Komfort; Zeichnen läuft auch ohne.
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {} // keep events even if pointer leaves canvas
  const r = canvas.getBoundingClientRect();
  const p = lernenPos(e, canvas, r);
  lernenLastX = p.x;
  lernenLastY = p.y;
  lernenLastMidX = p.x; lernenLastMidY = p.y;     // Glättung: Startpunkt = erster Mittelpunkt
  lernenPtBuf = [];
  if (lernenRaf) { cancelAnimationFrame(lernenRaf); lernenRaf = 0; }
  isDrawingLernen = true;
}

// Gepufferte Punkte einmal pro Frame zeichnen (rAF) mit Kurven-Glättung – analog
// zum Rechnen-Canvas: quadratische Bézier durch die Mittelpunkte statt Geraden.
function flushLernenBuf() {
  lernenRaf = 0;
  if (!lernenCtx || !lernenPtBuf.length) return;
  lernenCtx.lineCap = 'round'; lernenCtx.lineJoin = 'round';
  if (lernenTool === 'eraser') {
    lernenCtx.globalCompositeOperation = 'destination-out';
    lernenCtx.lineWidth = 22;
  } else {
    lernenCtx.globalCompositeOperation = 'source-over';
    lernenCtx.strokeStyle = lernenPenColor;
    lernenCtx.lineWidth = 2.5;
    lernenHasInk = true;
  }
  const buf = lernenPtBuf; lernenPtBuf = [];
  for (const pt of buf) {
    const midX = (lernenLastX + pt.x) / 2, midY = (lernenLastY + pt.y) / 2;
    lernenCtx.beginPath();
    lernenCtx.moveTo(lernenLastMidX, lernenLastMidY);
    lernenCtx.quadraticCurveTo(lernenLastX, lernenLastY, midX, midY);
    lernenCtx.stroke();
    lernenLastMidX = midX; lernenLastMidY = midY;
    lernenLastX = pt.x; lernenLastY = pt.y;
  }
}

function onLernenMove(e) {
  if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') {
    // Finger-Scroll (nur der erkannte Finger; Handfläche/weitere Touches ignorieren)
    if (e.pointerId === lernenFingerId) {
      const wrap = document.getElementById('lernen-canvas-wrap');
      wrap.scrollTop = lernenScroll0 + (lernenFingerY0 - e.clientY);
    }
    return;
  }
  // Selbstheilung gegen iPad-Palm-Rejection: Liegt die Handfläche auf, schickt iПadOS-Safari
  // mitten im Strich ein pointercancel für den STIFT → isDrawingLernen wird false, die danach
  // weiter eintreffenden pointermove-Events wurden verworfen und es kam KEIN Strich mehr, bis
  // man neu aufsetzte. Kommt aber ein Stift-/Maus-Move, während der Stift nachweislich aufliegt
  // (pressure>0 bzw. Maustaste gedrückt), nehmen wir den Strich an dieser Stelle einfach wieder
  // auf – ohne Hochheben. lernenLastX/Y neu setzen, damit keine Linie aus dem Nichts gezogen wird.
  const pressing = e.pressure > 0 || (e.buttons & 1) === 1;
  if (lernenCtx && pressing && (!isDrawingLernen || e.pointerId !== lernenActivePtr)) {
    lernenActivePtr = e.pointerId;
    lernenPenActive = true;
    const cv = e.target;
    const rr = cv.getBoundingClientRect();
    const pp = lernenPos(e, cv, rr);
    lernenLastX = pp.x; lernenLastY = pp.y;
    lernenLastMidX = pp.x; lernenLastMidY = pp.y;   // Glättung an der Wiederaufnahmestelle
    lernenPtBuf = [];
    isDrawingLernen = true;
  }
  if (!isDrawingLernen || !lernenCtx) return;
  if (e.pointerId !== lernenActivePtr) return; // palm rejection
  e.preventDefault();
  const canvas = e.target;
  const r      = canvas.getBoundingClientRect();   // einmal pro Event, nicht pro Punkt
  // getCoalescedEvents captures all intermediate points during fast strokes – nur puffern,
  // gezeichnet wird gebündelt einmal pro Frame in flushLernenBuf() (rAF).
  const pts  = (e.getCoalescedEvents ? e.getCoalescedEvents() : null) || [e];
  for (const pt of pts) {
    const { x, y } = lernenPos(pt, canvas, r);
    lernenPtBuf.push({ x, y });
  }
  if (!lernenRaf) lernenRaf = requestAnimationFrame(flushLernenBuf);
}

function onLernenUp(e) {
  if (e.pointerId === lernenFingerId) lernenFingerId = null; // Finger-Scroll beendet
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') lernenPenActive = false;
  // Nur das Event des aktuell zeichnenden Pointers beendet den Strich – ein verspätetes
  // up/cancel eines vorherigen Kontakts (z.B. via window-Sicherheitsnetz) darf den bereits
  // gestarteten nächsten Strich nicht abwürgen. Apple Pencil recycelt die pointerId, daher
  // greift der ID-Vergleich allein nicht: ein vor dem aktuellen Aufsetzen erzeugtes Event
  // gehört zum alten Strich und wird per Zeitstempel verworfen.
  if (isDrawingLernen && e.timeStamp < lernenDownTime) return;
  if (e.pointerId === lernenActivePtr) {
    // Noch gepufferte Punkte sofort zeichnen, damit der Strich vollständig ist.
    if (lernenRaf) { cancelAnimationFrame(lernenRaf); lernenRaf = 0; }
    flushLernenBuf();
    lernenActivePtr = null;
    isDrawingLernen = false;
  }
}

// ── Sicherer Ausdrucks-Evaluator für die deterministische Rechen-Prüfung (#4) ──
// Kein eval(): Tokenizer → Shunting-Yard → RPN. Erlaubt Zahlen (auch deutsches
// Komma/Tausenderpunkt), + - * / ^ %, Klammern und Wurzel. NaN bei Unbekanntem.
function parseNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  const m = String(v).match(/-?\d[\d.\s]*(?:,\d+)?|-?\d+(?:\.\d+)?/);
  if (!m) return NaN;
  let t = m[0].replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  return parseFloat(t);
}
function evalExpr(expr) {
  if (expr == null) return NaN;
  let s = String(expr).toLowerCase()
    .replace(/wurzel|sqrt|√/g, ' sqrt ').replace(/hoch/g, '^')
    .replace(/·|×/g, '*').replace(/÷|:/g, '/');
  s = s.replace(/(\d)\.(?=\d{3}\b)/g, '$1').replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/[^0-9.+\-*/^()%\sa-z]/g, ' ').replace(/(^|\()\s*-/g, '$10-');
  const tokens = s.match(/\d+(?:\.\d+)?|sqrt|[+\-*/^()%]/g);
  if (!tokens) return NaN;
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 }, isOp = t => t in prec;
  const out = [], ops = [];
  for (const t of tokens) {
    if (/^\d/.test(t)) out.push(parseFloat(t));
    else if (t === 'sqrt') ops.push(t);
    else if (isOp(t)) {
      while (ops.length) { const top = ops[ops.length - 1];
        if (top === 'sqrt' || (isOp(top) && (prec[top] > prec[t] || (prec[top] === prec[t] && t !== '^')))) out.push(ops.pop());
        else break; }
      ops.push(t);
    } else if (t === '(') ops.push(t);
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); ops.pop();
      if (ops[ops.length - 1] === 'sqrt') out.push(ops.pop()); }
  }
  while (ops.length) out.push(ops.pop());
  const st = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else if (t === 'sqrt') { const a = st.pop(); if (a === undefined) return NaN; st.push(Math.sqrt(a)); }
    else { const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) return NaN;
      st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : t === '%' ? a % b : t === '^' ? Math.pow(a, b) : NaN); }
  }
  return st.length === 1 ? st[0] : NaN;
}
// Zahlenvergleich mit relativer + absoluter Toleranz.
function numEqual(a, b, rel = 0.01) {
  if (!isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-9, rel * Math.abs(b), 0.005);
}

async function checkLernenSolution() {
  if (!lernenTopicData) return;
  const checkBtn  = document.getElementById('lernen-check-btn');
  const resultBar = document.getElementById('lernen-result-bar');

  // Antwort zuerst validieren – sonst bauen wir Wartezustand/Musterlösung umsonst auf.
  const answerText = document.getElementById('lernen-text-answer')?.value.trim() || '';
  const hasInk     = lernenHasInk && !!lernenCtx;
  if (!answerText && !hasInk) {
    toast('Bitte zuerst eine Antwort zeichnen oder eingeben.', 'warn', 3000);
    return;
  }

  checkBtn.disabled = true;
  checkBtn.innerHTML = '<span class="lernen-check-spin">⏳</span> Prüfen…';

  // Vorab generierte Musterlösung nutzen, falls schon fertig: spart der Bewertung
  // das erneute Ausformulieren (kürzere Antwort = schneller) UND wird dem Nutzer
  // direkt im Wartezustand zum Lesen angezeigt.
  let preLoesung = '';
  if (lernenLoesung && lernenLoesung.aufgabe === lernenTopicData.aufgabe) {
    try { preLoesung = await lernenLoesung.promise || ''; } catch { preLoesung = ''; }
  }

  // Wartezustand: wechselnde Status-Zeile (woran die KI gerade arbeitet) statt
  // statischem "wird geprüft" – plus die vorgeladene Musterlösung schon zum Lesen.
  let stopStatus = () => {};
  if (resultBar) {
    const isCalc = Array.isArray(lernenTopicData.werte) && lernenTopicData.werte.length > 0;
    const steps = isCalc
      ? ['Aufgabe und Werte lesen…', 'Deinen Rechenweg durchgehen…', 'Zwischenschritte nachrechnen…', 'Endergebnis vergleichen…', 'Feedback formulieren…']
      : ['Aufgabe lesen…', 'Deine Antwort durchgehen…', 'Mit der Musterlösung abgleichen…', 'Stärken und Lücken sammeln…', 'Feedback formulieren…'];
    resultBar.className = 'lernen-result-bar lernen-result-bar--loading';
    resultBar.innerHTML =
      '<span class="lernen-checking-row">' +
        '<span class="lernen-check-dots"><span></span><span></span><span></span></span>' +
        '<span id="lernen-check-status"></span>' +
      '</span>' +
      (preLoesung
        ? '<details class="lernen-result-details" open style="margin-top:12px">' +
            '<summary>📌 Musterlösung – schon mal zum Lesen</summary>' +
            `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(preLoesung))}</div>` +
          '</details>'
        : '');
    stopStatus = cycleStatus(document.getElementById('lernen-check-status'), steps);
  }

  try {
    let ev;
    // Bewertungsmaßstab/Strenge sind an das Niveau gekoppelt (Konstanten auf Modul-Ebene).
    const strictNote = LERN_STRICTNESS[lernenCurrentDiff] || LERN_STRICTNESS.einsteiger;

    // Re-Prüfung: vorherige Auswertung mitgeben, damit die KI konsistent bleibt
    // und nicht bei jeder Runde neue/widersprüchliche Fehler "entdeckt".
    const reCheckNote = lernenLastEval
      ? `\n\nWICHTIG – ERNEUTE PRÜFUNG DERSELBEN AUFGABE. Deine vorherige Auswertung war:\nscore: ${lernenLastEval.score}\nfeedback: ${lernenLastEval.feedback || ''}\neinschaetzung: ${lernenLastEval.einschaetzung || ''}\nBleibe konsistent: Beziehe dich auf genau diese Punkte. Was du vorher als richtig akzeptiert hast, bleibt richtig – bringe KEINE neuen Kritikpunkte zu Aspekten ein, die du vorher nicht beanstandet hast, außer der Student hat sie verändert und sie sind jetzt falsch. Erkenne ausdrücklich an, welche zuvor genannten Fehler nun korrigiert sind. Der score darf bei einer korrigierten Antwort NICHT sinken.`
      : '';

    // Wenn die Musterlösung bereits vorliegt: dem Modell als verbindlichen Maßstab
    // mitgeben und das loesung-Feld leer lassen – wir setzen sie unten selbst ein.
    const loesungField = preLoesung
      ? `"loesung": "" (LEER LASSEN – die Musterlösung ist bereits bekannt und wird separat angezeigt)`
      : `"loesung": "Vollständige Musterlösung. Bei Teilaufgaben (a/b/c oder 1/2/3) bekommt JEDE Teilaufgabe einen eigenen Absatz, getrennt durch \\n\\n. Beginne jeden Absatz mit der Teilaufgaben-Bezeichnung fett: **a)** ..."`;
    const knownLoesungNote = preLoesung
      ? `\n\nDIE KORREKTE MUSTERLÖSUNG IST BEREITS BEKANNT (nutze sie als verbindlichen Maßstab für die Bewertung; schreibe sie NICHT erneut, lass das Feld "loesung" leer):\n"""\n${preLoesung}\n"""`
      : '';

    // Rechenaufgabe? → zusätzliche numerische Felder anfordern, die der Code danach
    // DETERMINISTISCH prüft (das LLM benotet nicht mehr seine eigene Arithmetik, #4).
    const isCalcTask = Array.isArray(lernenTopicData.werte) && lernenTopicData.werte.length > 0;
    const numFields = isCalcTask ? `,
  "endergebnis_rechnung": "reiner Rechenausdruck für DAS korrekte Endergebnis, nur Zahlen/Operatoren (z.B. \\"500*1.08\\"); leer wenn nicht sinnvoll",
  "endergebnis": <korrektes Endergebnis als reine Zahl, Punkt als Dezimaltrenner>,
  "schueler_endergebnis": <Endzahl, die der Student angibt, als reine Zahl – null wenn keine genannt>` : '';
    const numInstr = isCalcTask
      ? `\nNUMERISCH: Fülle "endergebnis"/"endergebnis_rechnung" mit DEINEM korrekten Resultat und "schueler_endergebnis" mit der Endzahl des Studenten (null wenn keine). Punkt als Dezimaltrenner. Die endgültige Richtig/Falsch-Wertung der Zahl übernimmt das System.`
      : '';

    const EVAL_SYS = `Du MUSST ausschließlich ein JSON-Objekt zurückgeben – kein Text davor oder danach.
${strictNote}
{
  "score": 0,
  "understood": false,
  "feedback": "Ein-Satz-Urteil über die Antwort",
  ${loesungField},
  "einschaetzung": "Fließtext: Was hat der Student richtig, was fehlt oder ist falsch, was sollte konkret besser sein. Bei Teilaufgaben ebenfalls je Absatz."${numFields}
}
score: 2=vollständig korrekt (ALLE Teilergebnisse UND das Endergebnis stimmen exakt), 1=Ansatz/Teile richtig aber mindestens ein Ergebnis falsch oder unvollständig, 0=falsch oder zu wenig.
KRITISCHE REGEL: Wenn bei einer Rechenaufgabe IRGENDEIN Zwischenergebnis oder Endergebnis numerisch falsch ist → score MAXIMAL 1, NIEMALS 2. Kein Ausnahme.
understood: true NUR wenn score=2 UND alle Ergebnisse korrekt.
Bei Rechenaufgaben: Berechne JEDEN Rechenschritt selbst nach und vergleiche exakt. Auch ein falscher Zwischenschritt der zufällig ein richtiges Endergebnis liefert → score=1.${numInstr}

${LERN_GRADE_STD[lernenCurrentDiff] || LERN_GRADE_STD.einsteiger}${reCheckNote}${knownLoesungNote}`;

    // Beide Eingabebereiche gemeinsam prüfen: Der Umschalter ✏️/⌨️ steuert nur,
    // was gerade sichtbar ist – die Antwort kann aus Zeichnung UND/ODER Text bestehen.
    // (answerText/hasInk wurden oben bereits ermittelt und validiert.)
    if (hasInk) {
      // Zeichnung vorhanden → Vision; getippten Text (falls vorhanden) zusätzlich mitschicken.
      const canvas = document.getElementById('lernen-canvas');
      const flat = document.createElement('canvas');
      flat.width = canvas.width; flat.height = canvas.height;
      const fc = flat.getContext('2d');
      fc.fillStyle = '#fff'; fc.fillRect(0, 0, flat.width, flat.height);
      fc.drawImage(canvas, 0, 0);
      const base64 = flat.toDataURL('image/png').split(',')[1];
      const textPart = answerText
        ? `\n\nZusätzlich getippte Antwort des Studenten: ${answerText}\nWerte Zeichnung UND getippten Text zusammen als eine einzige Antwort.`
        : '';
      const result = await claudeLocalVision(
        base64,
        `Aufgabe: ${lernenTopicData.aufgabe}${textPart}\n\n${EVAL_SYS}`,
        sysBlocks()
      );
      ev = parseJsonResponse(result);
      if (!ev) throw new Error('Keine Auswertung');
    } else {
      // Nur getippter Text.
      const raw = await claudeLocal(
        [{ role: 'user', content: `Aufgabe: ${lernenTopicData.aufgabe}\n\nAntwort des Studenten: ${answerText}` }],
        [{ type: 'text', text: EVAL_SYS }],
        2000, { json_mode: true }
      );
      ev = parseJsonResponse(raw);
      if (!ev) {
        console.error('parseJsonResponse failed, raw response:', raw?.slice(0, 300));
        throw new Error('Keine Auswertung');
      }
    }

    // Bereits vorab generierte Musterlösung einsetzen (das Modell hat das Feld leer
    // gelassen, damit die Bewertung schneller war).
    if (preLoesung) ev.loesung = preLoesung;

    // Deterministische Rechen-Prüfung (#4): der CODE vergleicht die Zahlen, nicht das
    // LLM. Referenz = nachgerechneter Ausdruck (härtet die LLM-Zahl), sonst dessen
    // "endergebnis". Nachweislich falsches Endergebnis ⇒ nie volle Punktzahl –
    // überstimmt eine LLM-Fehleinschätzung und bleibt über Re-Prüfungen stabil.
    let numNote = '';
    if (isCalcTask) {
      const refByExpr = evalExpr(ev.endergebnis_rechnung);
      const ref  = isFinite(refByExpr) ? refByExpr : parseNum(ev.endergebnis);
      const stud = parseNum(ev.schueler_endergebnis);
      if (isFinite(ref) && isFinite(stud)) {
        const tol = (lernenCurrentDiff === 'pruefungsnah' || lernenCurrentDiff === 'schwer') ? 0.005 : 0.02;
        const fmt = n => (Math.round(n * 1000) / 1000).toLocaleString('de-DE');
        if (numEqual(stud, ref, tol)) {
          numNote = `🔢 Endergebnis geprüft: ${fmt(stud)} ✓`;
        } else {
          numNote = `🔢 Endergebnis weicht ab – erwartet ${fmt(ref)}, deine Antwort ${fmt(stud)}.`;
          if (ev.score >= 2) ev.score = 1;
          ev.understood = false;
        }
      }
    }
    if (numNote) ev.feedback = ev.feedback ? `${ev.feedback} — ${numNote}` : numNote;

    lernenAttempts++;
    lernenLastEval = { score: ev.score, feedback: ev.feedback, einschaetzung: ev.einschaetzung };
    const understood = ev.understood === true && ev.score >= 2;
    if (ev.score >= 2) comboUp(); else comboReset();
    const scoreClass = ev.score >= 2 ? 'ok' : ev.score === 1 ? 'partial' : 'fail';
    const scoreIcon  = ev.score >= 2 ? '✅' : ev.score === 1 ? '💪' : '🔁';

    if (resultBar) {
      resultBar.className = `lernen-result-bar lernen-result-bar--${scoreClass}`;
      let html = `<div class="lernen-result-verdict lernen-result-verdict--${scoreClass}">${scoreIcon} ${esc(ev.feedback || '')}</div>`;

      if (ev.score < 2) {
        // Einschätzung zuerst – was konkret falsch war, kurz und direkt
        if (ev.einschaetzung) {
          html += `<div class="lernen-result-prose">` +
            `<div class="lernen-result-label">💬 Was war leicht daneben</div>` +
            `<div class="lernen-result-text">${safeHtml(md(ev.einschaetzung))}</div>` +
            `</div>`;
        }
        // Musterlösung eingeklappt – nur bei Bedarf aufklappen
        if (ev.loesung) {
          html += `<details class="lernen-result-details">` +
            `<summary>📌 Musterlösung anzeigen</summary>` +
            `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(ev.loesung))}</div>` +
            `</details>`;
        }
        html += `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">` +
          `<button class="btn-primary btn-sm" onclick="regenLernenTask()">→ Neue Aufgabe zum Thema</button>` +
          `<button class="btn-secondary btn-sm" onclick="retryLernenSameTask()">🔁 Gleiche Aufgabe</button>` +
          `</div>`;
      } else {
        if (ev.loesung) {
          html += `<div class="lernen-result-prose">` +
            `<div class="lernen-result-label">📌 Musterlösung</div>` +
            `<div class="lernen-result-text">${safeHtml(md(ev.loesung))}</div>` +
            `</div>`;
        }
        if (ev.einschaetzung) {
          html += `<div class="lernen-result-prose">` +
            `<div class="lernen-result-label">💬 Einschätzung deiner Antwort</div>` +
            `<div class="lernen-result-text">${safeHtml(md(ev.einschaetzung))}</div>` +
            `</div>`;
        }
      }
      resultBar.innerHTML = html;
    }
    if (understood) {
      document.getElementById('lernen-done-btn').classList.remove('hidden');
      if (lernenAttempts > 1) toast(`🎯 Beim ${lernenAttempts}. Versuch geschafft!`, 'success', 3500);
    }
  } catch (e) {
    toast('Fehler beim Prüfen: ' + e.message, 'error');
    if (resultBar) { resultBar.className = 'lernen-result-bar hidden'; resultBar.innerHTML = ''; }
  } finally {
    stopStatus();
  }
  checkBtn.disabled = false; checkBtn.innerHTML = '✅ Prüfen';
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
  const unit = curUnit();
  const members = (unit.themen || []).filter(Boolean);
  if (!members.length || !sessionId) return;
  closeLernenTopic();
  // Eine zusammengesetzte Einheit erledigt ALLE ihre Member-Themen auf diesem Niveau
  // (Hebel 2). Zusammen mit Hebel 1 sind damit auch alle tieferen Stufen abgedeckt.
  const set = learnedKeySet();
  let anyFirst = false, anyReviewDue = false;
  for (const t of members) {
    const key = topicKey(t, lernenCurrentDiff);            // tid::diff
    const first = !set.has(resolveKey(key));
    if (first) {
      anyFirst = true;
      learnedTopics.push(key);
      api(`/api/subjects/${sessionId}/learned-topics`, {
        method: 'POST', body: JSON.stringify({ topic: key }),
      }).catch(() => {});
    } else if (topicReviewDue(key)) {
      anyReviewDue = true;
    }
    // Stärke + Zeitpunkt je Member merken (bestimmt die Wiederholungs-Fälligkeit).
    topicMeta[normFullKey(key)] = { ts: Date.now(), attempts: Math.max(1, lernenAttempts),
      score: (lernenLastEval && typeof lernenLastEval.score === 'number') ? lernenLastEval.score : null };
  }
  if (anyFirst) localforage.setItem(`lt_${sessionId}`, learnedTopics).catch(() => {});
  saveTopicMeta();
  renderMilestone();
  loadLernpfad();
  sessionTick('topic', unit.name);
  // XP nur für echten Lernfortschritt: voll beim ersten Mal, halb für fällige
  // Wiederholung (Retrieval belohnen!), nichts für wiederholtes Abhaken.
  const fullXP = XP_BY_DIFF[lernenCurrentDiff] || 40;
  if (anyFirst)            addXP(fullXP, `"${unit.name}" gelernt`);
  else if (anyReviewDue)   addXP(Math.round(fullXP / 2), `"${unit.name}" aufgefrischt`);
  // Kapitel komplett? → Konfetti (auf/über Niveau, konsistent mit dem Lernpfad)
  if (moduleStructure?.kapitel) {
    const need = diffIdx(lernenCurrentDiff);
    const tDone = t => topicMaxLevel(t) >= need;
    const kap = moduleStructure.kapitel.find(k => k.themen.includes(members[0]));
    if (kap && kap.themen.every(tDone)) {
      confettiBurst();
      setTimeout(() => toast(`📗 Kapitel "${kap.titel}" abgeschlossen!`, 'success', 4000), 300);
    }
  }
}

async function scanModuleStructure(btn) {
  if (!sessionTxt && !sessionId) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  const orig = btn.textContent;
  btn.disabled = true;
  const prevNames = pathTopics();   // für den ID-Abgleich (Rename-Erkennung) festhalten
  try {
    // Phase 1: Fetch short snippet from EVERY document → identify Hauptthemen across ALL docs
    btn.textContent = 'Überblick lädt…';
    const overview = await buildDocOverview();
    const overviewText = overview || docsForPrompt(25000);

    const p1Raw = await claudeLocal(
      [{ role: 'user', content: `Hier sind kurze Auszüge aus ALLEN Dokumenten dieser Lernsammlung:\n\n${overviewText}\n\nIdentifiziere 6–8 übergeordnete Hauptthemen, die insgesamt in diesen Dokumenten behandelt werden. Decke die GESAMTE Breite aller Dokumente ab – nicht nur die ersten.` }],
      [{ type: 'text', text: 'Du bist ein Lernstruktur-Experte. Analysiere Dokumentübersichten und erkenne übergeordnete Themengebiete.\nAntworte NUR als JSON-Array mit 6–8 Strings:\n["Hauptthema 1","Hauptthema 2",...]' }],
      600
    );
    const m1 = p1Raw.match(/\[[\s\S]*?\]/);
    if (!m1) throw new Error('Hauptthemen nicht erkannt');
    const hauptthemen = parseJsonLoose(m1[0]).filter(t => typeof t === 'string' && t.trim()).slice(0, 8);
    if (!hauptthemen.length) throw new Error('Keine Hauptthemen gefunden');

    // Phase 2: For each Hauptthema generate 3–5 specific Lernthemen using full content
    btn.textContent = 'Lernthemen…';
    const p2Raw = await claudeLocal(
      [{ role: 'user', content: `Strukturiere den Lernstoff in diese Hauptthemen:\n${hauptthemen.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nErstelle für jedes Hauptthema 3–5 konkrete Lernthemen (max. 4 Wörter), die in den Unterlagen behandelt werden. Didaktische Reihenfolge: Grundlagen zuerst.` }],
      sysBlocks(`Antworte NUR als JSON:\n{"kapitel":[{"titel":"Hauptthema","lernziel":"Nach diesem Kapitel kannst du …(ein Satz)","themen":["Lernthema 1","Lernthema 2"]}]}\nRegeln: Themennamen max. 4 Wörter, jedes Thema nur einmal, insgesamt max. 30 Themen.`),
      1400
    );
    const m2 = p2Raw.match(/\{[\s\S]*\}/);
    if (!m2) throw new Error('Lernstruktur nicht erkannt');
    const data = parseJsonLoose(m2[0]);
    const kapitel = (data.kapitel || []).filter(k =>
      k && typeof k.titel === 'string' && Array.isArray(k.themen) && k.themen.length);
    if (!kapitel.length) throw new Error('Keine Kapitel gefunden');
    // Beinah-Duplikate über alle Kapitel hinweg entfernen (normalisierter Vergleich:
    // "Die Lichtreaktion" == "Lichtreaktion", "CO₂-Konzentration" == "CO2 Konzentration").
    moduleStructure = dedupeStructure({ kapitel });
    const newNames = moduleStructure.kapitel.flatMap(k => k.themen);
    // IDs gegen die alten Themen abgleichen: Rename ⇒ ID bleibt ⇒ Fortschritt bleibt.
    reconcileTopicUids(prevNames, newNames);
    moduleStructure.ids = topicUids;
    // Flache Liste = ALLE Strukturthemen (kein 30er-Cut): der Lernpfad zählt sie
    // ohnehin vollständig, Session-Planer/Aufgaben sollen deckungsgleich sein (#7b).
    scannedTopics = newNames;
    localforage.setItem(`ms_${sessionId}`, moduleStructure).catch(() => {});
    localforage.setItem(`st_${sessionId}`, scannedTopics).catch(() => {});
    localforage.setItem(`tuid_${sessionId}`, topicUids).catch(() => {});
    api(`/api/subjects/${sessionId}/structure`, {
      method: 'POST',
      body: JSON.stringify({ structure: moduleStructure, topics: scannedTopics }),
    }).catch(() => {});
    renderMilestone();
    loadLernpfad();
    toast(`🗺️ ${hauptthemen.length} Hauptthemen · ${scannedTopics.length} Lernthemen erkannt!`, 'success');
  } catch (e) {
    toast('Fehler beim Erkennen: ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = orig;
}

document.getElementById('lernpfad-scan-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('lernpfad-scan-btn');
  try {
    await scanModuleStructure(btn);
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
  setTimeout(() => {
    adjustLernenTextHeight(); // size before keyboard to avoid layout jump
    document.getElementById('lernen-text-answer')?.focus();
  }, 80);
});

// Size the textarea to fill exactly the visible area above the iOS keyboard.
// Called once on switch-to-text and again whenever the visual viewport resizes
// (i.e. when the software keyboard appears/disappears/resizes).
function adjustLernenTextHeight() {
  const ta   = document.getElementById('lernen-text-answer');
  const wrap = document.getElementById('lernen-text-wrap');
  if (!ta || !wrap || wrap.classList.contains('hidden')) return;
  const vv = window.visualViewport;
  if (vv) {
    // vv.height is the visible height excluding the keyboard
    const wrapTop = wrap.getBoundingClientRect().top;
    const available = vv.height - wrapTop - 8; // 8 px bottom gap
    ta.style.height = Math.max(80, available) + 'px';
  } else if (!ta.style.height && wrap.clientHeight > 60) {
    // Fallback for browsers without visualViewport
    ta.style.height = (wrap.clientHeight - 28) + 'px';
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', adjustLernenTextHeight);
}

// Task area resize handle
(function () {
  const handle = document.getElementById('lernen-task-resize');
  const wrap   = document.getElementById('lernen-task-bar-wrap');
  if (!handle || !wrap) return;
  let startY = 0, startH = 0, dragging = false;
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startH = wrap.offsetHeight;
    dragging = true;
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const h = Math.max(44, Math.min(320, startH + (e.clientY - startY)));
    wrap.style.height = h + 'px';
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    localforage.setItem('lernen_taskH', wrap.offsetHeight).catch(() => {});
  };
  handle.addEventListener('pointerup',     endDrag);
  handle.addEventListener('pointercancel', endDrag);
  // Restore last used height
  localforage.getItem('lernen_taskH').then(h => {
    if (h > 40) wrap.style.height = h + 'px';
  }).catch(() => {});
}());

// ── Elaboration controls ──────────────────────────────────────────────────
function finishElaboration() {
  document.getElementById('lernen-elaborate')?.classList.add('hidden');
  document.getElementById('lernen-step1-footer')?.classList.remove('hidden');
  // Themen ohne Übungsaufgabe: "fertig" erst jetzt – nach der Reflexion – freigeben (#3).
  if (!(lernenTopicData?.aufgabe && lernenTopicData.aufgabe.trim()))
    document.getElementById('lernen-done-btn')?.classList.remove('hidden');
}
document.getElementById('elaborate-skip')?.addEventListener('click', finishElaboration);
document.getElementById('elaborate-go')?.addEventListener('click', finishElaboration);

// Lernen topic view controls
document.getElementById('lernen-back-btn')?.addEventListener('click', closeLernenTopic);
document.getElementById('lernen-to-task-btn')?.addEventListener('click', () => lernenSwitchStep(2));
document.getElementById('lernen-check-btn')?.addEventListener('click', checkLernenSolution);
document.getElementById('lernen-done-btn')?.addEventListener('click', markTopicDone);
document.getElementById('lernen-regen-btn')?.addEventListener('click', regenLernenTask);
document.getElementById('lernen-clear-btn')?.addEventListener('click', () => {
  if (!lernenCtx) return;
  const wrap = document.getElementById('lernen-canvas-wrap');
  lernenCtx.globalCompositeOperation = 'source-over';
  lernenCtx.clearRect(0, 0, wrap.clientWidth, LERNEN_HEIGHT);
  lernenHasInk = false;
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
document.getElementById('lernen-qa-overlay')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('lernen-qa-overlay').classList.add('hidden');
});
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
  try { prefCalculator = (await localforage.getItem('pref_calculator')) || ''; } catch (_) {}
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

