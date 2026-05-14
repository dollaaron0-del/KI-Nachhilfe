'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const ICONS  = ['📐','📊','🧪','🔬','🧬','📚','🖥️','⚖️','💰','🌍','🎨','🎵','🏥','🏛️','✈️','🔧','📡','🧮','⚗️','🔭','🤖','🧠','💡','🎯','🌱','🏋️'];
const COLORS = ['#5856d6','#007aff','#34c759','#ff9500','#ff3b30','#ff2d55','#30b0c7','#a2845e'];

// ── State ──────────────────────────────────────────────────────────────────
let sessionId  = null;
let subjMeta   = null;   // { id, name, icon, color, ... }
let selIcon    = ICONS[0];
let selColor   = COLORS[0];
let selDiff    = 'mittel';
let quizTotal  = 0;
let quizScore  = 0;
let examAnsVisible = false;

// ── Screens ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ══ SUBJECTS SCREEN ════════════════════════════════════════════════════════

async function loadSubjects() {
  try {
    const list = await api('GET', '/api/subjects');
    const grid  = document.getElementById('subj-grid');
    const empty = document.getElementById('subj-empty');
    grid.innerHTML = '';
    if (!list.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    list.forEach(s => grid.appendChild(makeCard(s)));
  } catch (e) { console.error(e); }
}

function makeCard(s) {
  const card = document.createElement('div');
  card.className = 'subj-card';
  card.style.borderTopColor = s.color || '#5856d6';

  const scoreHtml = s.lastScore !== null
    ? `<span class="card-score" style="background:${scoreColor(s.lastScore)}">${s.lastScore}%</span>`
    : '';
  const meta = s.fileCount
    ? `${s.fileCount} Dok. · ${s.quizCount ? s.quizCount + ' Fragen' : 'kein Quiz'}`
    : 'Noch keine Dokumente';

  card.innerHTML = `
    <button class="card-del" data-id="${s.id}" title="Löschen">×</button>
    <div class="card-icon">${s.icon}</div>
    <div class="card-name">${esc(s.name)}</div>
    <div class="card-meta">${meta}</div>
    ${scoreHtml}`;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-del')) return;
    openSubject(s);
  });

  card.querySelector('.card-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`"${s.name}" wirklich löschen? Alle Daten gehen verloren.`)) return;
    await api('DELETE', `/api/subjects/${s.id}`);
    loadSubjects();
  });

  return card;
}

function scoreColor(pct) {
  return pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
}

// New subject button
document.getElementById('btn-new-subject').addEventListener('click', showSubjModal);
document.getElementById('btn-first-subject').addEventListener('click', showSubjModal);

// ══ SUBJECT MODAL ══════════════════════════════════════════════════════════

function buildIconGrid() {
  const grid = document.getElementById('icon-grid');
  grid.innerHTML = '';
  ICONS.forEach(ic => {
    const btn = document.createElement('button');
    btn.className = 'icon-btn' + (ic === selIcon ? ' selected' : '');
    btn.textContent = ic;
    btn.addEventListener('click', () => {
      selIcon = ic;
      grid.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    grid.appendChild(btn);
  });
}

function buildColorRow() {
  const row = document.getElementById('color-row');
  row.innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'color-swatch' + (c === selColor ? ' selected' : '');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => {
      selColor = c;
      row.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('selected'));
      sw.classList.add('selected');
    });
    row.appendChild(sw);
  });
}

function showSubjModal() {
  selIcon  = ICONS[0]; selColor = COLORS[0];
  buildIconGrid(); buildColorRow();
  document.getElementById('subj-name').value = '';
  document.getElementById('subj-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('subj-name').focus(), 350);
}

function hideSubjModal() {
  document.getElementById('subj-modal').classList.add('hidden');
}

document.getElementById('subj-modal-bg').addEventListener('click', hideSubjModal);

document.getElementById('subj-create-btn').addEventListener('click', async () => {
  const name = document.getElementById('subj-name').value.trim();
  if (!name) { document.getElementById('subj-name').focus(); return; }
  try {
    const subj = await api('POST', '/api/subjects', { name, icon: selIcon, color: selColor });
    hideSubjModal();
    openSubject(subj);
  } catch (e) { alert('Fehler: ' + e.message); }
});

document.getElementById('subj-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('subj-create-btn').click();
});

// ══ OPEN SUBJECT ═══════════════════════════════════════════════════════════

async function openSubject(s) {
  sessionId = s.id;
  subjMeta  = s;

  // Load current stats
  try {
    const stats = await api('GET', `/api/stats/${s.id}`);
    quizTotal = stats.total;
    quizScore = stats.score;
  } catch { quizTotal = 0; quizScore = 0; }

  // Update header
  document.getElementById('header-label').textContent = `${s.icon}  ${s.name}`;
  updateHeaderPages();
  updateScoreChip();

  // Refresh chat welcome
  document.getElementById('chat-messages').innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">${s.icon}</div>
      <p>Stelle mir Fragen zu <strong>${esc(s.name)}</strong>.<br>Ich erkläre alles geduldig!</p>
    </div>`;

  // Show/hide no-docs banner
  const noFiles = !(s.fileCount > 0);
  document.getElementById('no-docs-banner').classList.toggle('hidden', !noFiles);

  // Reset quiz UI to idle
  showQuizState(document.getElementById('quiz-idle'));
  if (quizTotal > 0) {
    document.getElementById('quiz-summary').textContent =
      `${quizTotal} Fragen beantwortet · ${quizScore}/${quizTotal * 3} Pkt.`;
    document.getElementById('quiz-summary').classList.remove('hidden');
  }
  refreshAnalysisState();

  switchMode('chat');
  showScreen('main-screen');

  // If no documents yet, auto-show upload sheet
  if (noFiles) showUploadSheet();
}

function updateHeaderPages() {
  if (!subjMeta) return;
  const fc = subjMeta.fileCount || 0;
  document.getElementById('header-pages').textContent = fc
    ? `${fc} Dokument${fc !== 1 ? 'e' : ''}`
    : 'Keine Dokumente';
}

// ══ UPLOAD SHEET ═══════════════════════════════════════════════════════════

const uploadSheet  = document.getElementById('upload-sheet');
const dropZone     = document.getElementById('drop-zone');
const uploadInput  = document.getElementById('upload-input');
const uploadStatus = document.getElementById('upload-status');

document.getElementById('back-btn').addEventListener('click', () => {
  sessionId = null; subjMeta = null;
  showScreen('subjects-screen');
  loadSubjects();
});

document.getElementById('btn-add-docs').addEventListener('click', showUploadSheet);
document.getElementById('no-docs-btn').addEventListener('click', showUploadSheet);
document.getElementById('upload-bg').addEventListener('click', hideUploadSheet);

function showUploadSheet() {
  setUploadStatus('', '');
  document.getElementById('upload-title').textContent = subjMeta
    ? `Dokumente zu "${subjMeta.name}" hinzufügen`
    : 'Dokumente hochladen';
  uploadSheet.classList.remove('hidden');
}

function hideUploadSheet() {
  uploadSheet.classList.add('hidden');
}

uploadInput.addEventListener('change', () => {
  if (uploadInput.files.length) handleUpload(Array.from(uploadInput.files));
  uploadInput.value = '';
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const pdfs = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  if (pdfs.length) handleUpload(pdfs);
  else setUploadStatus('Nur PDF-Dateien werden unterstützt.', 'error');
});

async function handleUpload(files) {
  if (!sessionId) return;
  setUploadStatus('PDFs werden verarbeitet…', 'info');

  const form = new FormData();
  files.forEach(f => form.append('pdfs', f));

  try {
    const data = await fetch(`/api/subjects/${sessionId}/upload`, { method: 'POST', body: form })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error); return d; }));

    setUploadStatus(`✓ ${data.newFiles.map(f => f.name).join(', ')} hochgeladen.`, 'success');
    // Update cached meta
    if (subjMeta) {
      subjMeta.fileCount = data.totalFiles;
      updateHeaderPages();
      document.getElementById('no-docs-banner').classList.add('hidden');
    }
    setTimeout(hideUploadSheet, 1400);
  } catch (err) {
    setUploadStatus('Fehler: ' + err.message, 'error');
  }
}

function setUploadStatus(msg, type) {
  uploadStatus.textContent = msg;
  uploadStatus.className = `sheet-status ${type}`;
  uploadStatus.classList.toggle('hidden', !msg);
}

// ══ MODE TABS ══════════════════════════════════════════════════════════════

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

function switchMode(mode) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${mode}`));
  if (mode === 'analysis') refreshAnalysisState();
}

// ══ SCORE CHIP ════════════════════════════════════════════════════════════

function updateScoreChip() {
  const chip = document.getElementById('score-chip');
  if (quizTotal === 0) { chip.classList.add('hidden'); return; }
  const pct = Math.round(quizScore / (quizTotal * 3) * 100);
  chip.textContent = pct + '%';
  chip.style.background = scoreColor(pct);
  chip.classList.remove('hidden');
}

// ══ CHAT ══════════════════════════════════════════════════════════════════

const chatMessages = document.getElementById('chat-messages');
const chatInput    = document.getElementById('chat-input');
const chatSend     = document.getElementById('chat-send');

document.getElementById('chat-send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
chatInput.addEventListener('input', () => autoResize(chatInput));

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !sessionId) return;
  chatInput.value = ''; autoResize(chatInput); chatSend.disabled = true;
  addMsg(chatMessages, 'user', text);
  const typEl = addTyping(chatMessages);
  try {
    const { reply } = await api('POST', '/api/chat', { sessionId, message: text });
    typEl.remove(); addMsg(chatMessages, 'assistant', reply);
  } catch (e) { typEl.remove(); addMsg(chatMessages, 'assistant', '⚠️ ' + e.message); }
  chatSend.disabled = false; chatInput.focus();
}

document.getElementById('chat-reset').addEventListener('click', async () => {
  await api('POST', '/api/reset', { sessionId, what: 'chat' });
  chatMessages.innerHTML = `<div class="welcome"><div class="welcome-icon">🔄</div><p>Chat gelöscht.</p></div>`;
});

// ══ QUIZ ══════════════════════════════════════════════════════════════════

document.getElementById('quiz-start-btn').addEventListener('click', fetchQuestion);
document.getElementById('quiz-submit').addEventListener('click', submitAnswer);
document.getElementById('quiz-next').addEventListener('click', fetchQuestion);
document.getElementById('quiz-stop').addEventListener('click', () => switchMode('analysis'));
document.getElementById('quiz-reset-btn').addEventListener('click', async () => {
  if (!confirm('Quiz-Fortschritt zurücksetzen?')) return;
  await api('POST', '/api/reset', { sessionId, what: 'quiz' });
  quizTotal = 0; quizScore = 0; updateScoreChip();
  document.getElementById('quiz-summary').classList.add('hidden');
  showQuizState(document.getElementById('quiz-idle'));
  refreshAnalysisState();
});
document.getElementById('quiz-answer').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) submitAnswer();
});

function showQuizState(el) {
  document.querySelectorAll('#panel-quiz .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

async function fetchQuestion() {
  if (!sessionId) return;
  const qBox = document.getElementById('q-box');
  qBox.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  document.getElementById('quiz-answer').value = '';
  document.getElementById('quiz-submit').disabled = true;
  showQuizState(document.getElementById('quiz-q'));
  try {
    const { question, count } = await api('POST', '/api/quiz/question', { sessionId });
    qBox.textContent = question;
    document.getElementById('q-num').textContent = `Frage ${count}`;
    document.getElementById('q-score').textContent = quizTotal
      ? `${quizScore} / ${quizTotal * 3} Pkt.` : '';
    document.getElementById('quiz-submit').disabled = false;
    document.getElementById('quiz-answer').focus();
  } catch (e) {
    qBox.textContent = '⚠️ ' + e.message;
  }
}

async function submitAnswer() {
  const answer = document.getElementById('quiz-answer').value.trim();
  if (!answer || !sessionId) return;
  document.getElementById('quiz-submit').disabled = true;

  try {
    const ev = await api('POST', '/api/quiz/answer', { sessionId, answer });
    quizTotal++; quizScore += ev.score; updateScoreChip();

    // Feedback
    const scoreLabels = ['❌ Falsch (0/3)', '⚠️ Ansatz (1/3)', '🔶 Teilweise (2/3)', '✅ Korrekt (3/3)'];
    const scoreClasses = ['c0','c1','c2','c3'];
    document.getElementById('fb-score').textContent = scoreLabels[ev.score];
    document.getElementById('fb-score').className   = `fb-score ${scoreClasses[ev.score]}`;
    document.getElementById('fb-text').textContent  = ev.feedback;
    document.getElementById('fb-correct').innerHTML =
      `<strong>Musterantwort:</strong> ${esc(ev.correct_answer)}`;

    showQuizState(document.getElementById('quiz-fb'));
    refreshAnalysisState();
  } catch (e) {
    document.getElementById('quiz-submit').disabled = false;
    document.getElementById('q-box').textContent = '⚠️ ' + e.message;
  }
}

// ══ EXAM ══════════════════════════════════════════════════════════════════

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selDiff = btn.dataset.diff;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('exam-gen-btn').addEventListener('click', generateExam);
document.getElementById('exam-new-btn').addEventListener('click', () => {
  document.getElementById('exam-idle').classList.remove('hidden');
  document.getElementById('exam-result').classList.add('hidden');
});
document.getElementById('exam-ans-btn').addEventListener('click', toggleExamAnswers);

async function generateExam() {
  ['exam-idle','exam-result'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('exam-loading').classList.remove('hidden');
  examAnsVisible = false;
  try {
    const { exam } = await api('POST', '/api/exam/generate', { sessionId, difficulty: selDiff });
    const body = document.getElementById('exam-body');

    // Split off Lösungsschlüssel
    const sepIdx = exam.search(/---\s*\n+##\s*Lösungsschlüssel/i);
    if (sepIdx > -1) {
      const main = exam.slice(0, sepIdx);
      const sol  = exam.slice(sepIdx).replace(/^---\s*\n+/, '');
      body.innerHTML = md(main) + `<div class="ans-section">${md(sol)}</div>`;
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

function toggleExamAnswers() {
  examAnsVisible = !examAnsVisible;
  document.getElementById('exam-body').closest('.exam-content')
    .classList.toggle('answers-hidden', !examAnsVisible);
  document.getElementById('exam-ans-btn').textContent =
    examAnsVisible ? 'Lösungen verbergen' : 'Lösungen anzeigen';
}

// ══ ANALYSIS ══════════════════════════════════════════════════════════════

document.getElementById('analysis-btn').addEventListener('click', runAnalysis);
document.getElementById('analysis-refresh').addEventListener('click', runAnalysis);

function refreshAnalysisState() {
  const btn  = document.getElementById('analysis-btn');
  const hint = document.getElementById('analysis-hint');
  const need = Math.max(0, 3 - quizTotal);
  if (need === 0) {
    btn.disabled = false;
    hint.textContent = `${quizTotal} Fragen beantwortet – Analyse verfügbar.`;
  } else {
    btn.disabled = true;
    hint.textContent = `Noch ${need} Quiz-Frage${need > 1 ? 'n' : ''} für die Analyse.`;
  }
}

async function runAnalysis() {
  ['analysis-idle','analysis-result'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('analysis-loading').classList.remove('hidden');
  try {
    const d = await api('POST', '/api/analysis', { sessionId });
    const pct   = d.percent;
    const color = scoreColor(pct);

    document.getElementById('gauge').innerHTML = `
      <div class="gauge-pct" style="color:${color}">${pct}%</div>
      <div class="gauge-lbl">Geschätzte Klausurbereitschaft</div>
      <div class="gauge-bar"><div class="gauge-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="gauge-meta">${d.total} Fragen · ${d.score}/${d.max} Punkte · Rohwert: ${d.raw}%</div>`;

    document.getElementById('analysis-body').innerHTML = md(d.analysis);
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-result').classList.remove('hidden');
  } catch (e) {
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-idle').classList.remove('hidden');
    alert('Fehler: ' + e.message);
  }
}

// ══ HELPERS ═══════════════════════════════════════════════════════════════

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}

function addMsg(container, role, text) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  const bub = document.createElement('div');
  bub.className = 'bubble';
  bub.innerHTML = md(text);
  wrap.appendChild(bub);
  container.appendChild(wrap);
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  return wrap;
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
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Minimal Markdown renderer
function md(text) {
  if (!text) return '';
  const e = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return e(text)
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
}

// ── Init ───────────────────────────────────────────────────────────────────
loadSubjects();
