'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let sessionId = null;
let currentMode = 'chat';
let quizRunning = false;
let examAnswersVisible = false;
let selectedDifficulty = 'mittel';
let quizTotal = 0;
let quizScore = 0;

// ── Screens ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Upload ─────────────────────────────────────────────────────────────────
const fileInput    = document.getElementById('file-input');
const dropZone     = document.getElementById('drop-zone');
const fileListEl   = document.getElementById('file-list');
const uploadStatus = document.getElementById('upload-status');
let pendingFiles = [];

function renderFileList() {
  if (!pendingFiles.length) { fileListEl.classList.add('hidden'); return; }
  fileListEl.classList.remove('hidden');
  fileListEl.innerHTML = pendingFiles.map((f, i) => `
    <div class="file-item">
      <span class="file-icon">📄</span>
      <span class="file-name">${f.name}</span>
      <button class="file-remove" data-i="${i}">×</button>
    </div>`).join('');
  fileListEl.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingFiles.splice(+btn.dataset.i, 1);
      renderFileList();
    });
  });
}

fileInput.addEventListener('change', () => {
  pendingFiles = [...pendingFiles, ...Array.from(fileInput.files)];
  fileInput.value = '';
  renderFileList();
  if (pendingFiles.length) uploadFiles();
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const pdfs = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  if (!pdfs.length) { setStatus('Nur PDF-Dateien werden unterstützt.', 'error'); return; }
  pendingFiles = [...pendingFiles, ...pdfs];
  renderFileList();
  uploadFiles();
});

function setStatus(msg, type) {
  uploadStatus.textContent = msg;
  uploadStatus.className = `status-bar ${type}`;
  uploadStatus.classList.remove('hidden');
}

async function uploadFiles() {
  if (!pendingFiles.length) return;
  setStatus('PDFs werden verarbeitet…', 'info');

  const form = new FormData();
  pendingFiles.forEach(f => form.append('pdfs', f));

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    sessionId = data.sessionId;
    quizTotal = 0; quizScore = 0;

    document.getElementById('header-label').textContent = data.label;
    document.getElementById('header-pages').textContent = `${data.pages} Seiten · ${data.files.length} Datei(en)`;
    updateScoreChip();
    switchMode('chat');
    showScreen('main-screen');
    pendingFiles = [];
    renderFileList();
  } catch (err) {
    setStatus('Fehler: ' + err.message, 'error');
  }
}

// ── Mode Tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${mode}`));
  if (mode === 'analysis') refreshAnalysisState();
}

// ── Back ───────────────────────────────────────────────────────────────────
document.getElementById('back-btn').addEventListener('click', () => {
  sessionId = null; quizRunning = false; quizTotal = 0; quizScore = 0;
  uploadStatus.classList.add('hidden');
  showScreen('upload-screen');
});

// ── Score Chip ─────────────────────────────────────────────────────────────
function updateScoreChip() {
  const chip = document.getElementById('score-chip');
  const header = document.getElementById('header-score');
  if (quizTotal === 0) { header.style.display = 'none'; return; }
  const pct = Math.round((quizScore / (quizTotal * 3)) * 100);
  chip.textContent = pct + '%';
  chip.style.background = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
  header.style.display = 'block';
}

// ── CHAT ───────────────────────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');
const chatInput    = document.getElementById('chat-input');
const chatSend     = document.getElementById('chat-send');

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

function showTyping(container) {
  const el = document.createElement('div');
  el.className = 'message assistant'; el.id = 'typing-' + container.id;
  el.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  container.appendChild(el);
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}
function removeTyping(container) {
  document.getElementById('typing-' + container.id)?.remove();
}

chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
chatInput.addEventListener('input', () => autoResize(chatInput));

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !sessionId) return;

  chatInput.value = ''; autoResize(chatInput);
  chatSend.disabled = true;
  addMsg(chatMessages, 'user', text);
  showTyping(chatMessages);

  try {
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const data = await res.json();
    removeTyping(chatMessages);
    if (!res.ok) throw new Error(data.error);
    addMsg(chatMessages, 'assistant', data.reply);
  } catch (err) {
    removeTyping(chatMessages);
    addMsg(chatMessages, 'assistant', '⚠️ ' + err.message);
  }
  chatSend.disabled = false;
  chatInput.focus();
}

document.getElementById('chat-reset').addEventListener('click', async () => {
  await fetch('/api/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, what: 'chat' }),
  });
  chatMessages.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">💬</div>
      <p>Chat wurde gelöscht. Stell mir neue Fragen!</p>
    </div>`;
});

// ── QUIZ ───────────────────────────────────────────────────────────────────
const quizIdle     = document.getElementById('quiz-idle');
const quizQState   = document.getElementById('quiz-question-state');
const quizFState   = document.getElementById('quiz-feedback-state');

document.getElementById('quiz-start-btn').addEventListener('click', fetchQuestion);
document.getElementById('quiz-submit-btn').addEventListener('click', submitAnswer);
document.getElementById('quiz-next-btn').addEventListener('click', fetchQuestion);
document.getElementById('quiz-stop-btn').addEventListener('click', stopQuiz);
document.getElementById('quiz-answer').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) submitAnswer();
});

function showQuizState(state) {
  [quizIdle, quizQState, quizFState].forEach(el => el.classList.add('hidden'));
  state.classList.remove('hidden');
}

async function fetchQuestion() {
  if (!sessionId) return;
  showQuizState(quizQState);
  document.getElementById('question-box').innerHTML = `<div class="typing-indicator" style="justify-content:center"><span></span><span></span><span></span></div>`;
  document.getElementById('quiz-submit-btn').disabled = true;
  document.getElementById('quiz-answer').value = '';

  try {
    const res  = await fetch('/api/quiz/question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('question-box').textContent = data.question;
    document.getElementById('q-number').textContent = `Frage ${data.count}`;
    document.getElementById('q-score-running').textContent =
      quizTotal ? `${quizScore}/${quizTotal * 3} Pkt.` : '';
    document.getElementById('quiz-submit-btn').disabled = false;
    document.getElementById('quiz-answer').focus();
  } catch (err) {
    document.getElementById('question-box').textContent = '⚠️ Fehler: ' + err.message;
  }
}

async function submitAnswer() {
  const answer = document.getElementById('quiz-answer').value.trim();
  if (!answer || !sessionId) return;

  document.getElementById('quiz-submit-btn').disabled = true;
  showTyping({ id: 'quiz-q', scrollTo: () => {} });

  try {
    const res  = await fetch('/api/quiz/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, answer }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    quizTotal++;
    quizScore += data.score;
    updateScoreChip();

    // Show feedback
    const scoreEl = document.getElementById('feedback-score');
    const labels = ['', '⚠️ Ansatz erkannt (1/3)', '🔶 Teilweise korrekt (2/3)', '✅ Vollständig korrekt (3/3)'];
    const classes = ['', 'wrong', 'partial', 'correct'];
    if (data.score === 0) {
      scoreEl.textContent = '❌ Leider falsch (0/3)';
      scoreEl.className = 'feedback-score wrong';
    } else {
      scoreEl.textContent = labels[data.score];
      scoreEl.className = `feedback-score ${classes[data.score]}`;
    }

    document.getElementById('feedback-text').textContent = data.feedback;
    document.getElementById('correct-answer').innerHTML =
      `<strong>Musterantwort:</strong> ${data.correct_answer}`;

    showQuizState(quizFState);
    refreshAnalysisState();
  } catch (err) {
    showQuizState(quizQState);
    document.getElementById('question-box').textContent = '⚠️ Fehler: ' + err.message;
    document.getElementById('quiz-submit-btn').disabled = false;
  }
}

function stopQuiz() {
  const pct = quizTotal ? Math.round((quizScore / (quizTotal * 3)) * 100) : 0;
  document.getElementById('quiz-progress-summary').textContent =
    `Bisherige Runde: ${quizTotal} Fragen · ${quizScore}/${quizTotal * 3} Punkte · ${pct}%`;
  document.getElementById('quiz-progress-summary').classList.remove('hidden');
  showQuizState(quizIdle);
  switchMode('analysis');
}

// ── EXAM ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDifficulty = btn.dataset.diff;
  });
});

document.getElementById('exam-generate-btn').addEventListener('click', generateExam);
document.getElementById('exam-new-btn').addEventListener('click', () => {
  document.getElementById('exam-idle').classList.remove('hidden');
  document.getElementById('exam-result').classList.add('hidden');
});
document.getElementById('exam-toggle-answers').addEventListener('click', toggleAnswers);
document.getElementById('exam-print-btn').addEventListener('click', () => window.print());

async function generateExam() {
  document.getElementById('exam-idle').classList.add('hidden');
  document.getElementById('exam-loading').classList.remove('hidden');
  document.getElementById('exam-result').classList.add('hidden');
  examAnswersVisible = false;

  try {
    const res  = await fetch('/api/exam/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, difficulty: selectedDifficulty }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const body = document.getElementById('exam-body');
    // Split at the Lösungsschlüssel separator to hide answers initially
    const parts = data.exam.split(/---[\s\S]*?##\s*Lösungsschlüssel/i);
    let html = md(data.exam);

    // Wrap answer section so we can hide it
    if (parts.length > 1) {
      const mainHtml = md(parts[0]);
      const answerHtml = md('## Lösungsschlüssel' + parts[1]);
      html = mainHtml + `<div class="answer-section">${answerHtml}</div>`;
    }

    body.innerHTML = html;
    body.closest('.exam-content').classList.add('answers-hidden');
    document.getElementById('exam-toggle-answers').textContent = 'Lösungen anzeigen';

    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-result').classList.remove('hidden');
  } catch (err) {
    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-idle').classList.remove('hidden');
    alert('Fehler: ' + err.message);
  }
}

function toggleAnswers() {
  examAnswersVisible = !examAnswersVisible;
  document.getElementById('exam-body').closest('.exam-content')
    .classList.toggle('answers-hidden', !examAnswersVisible);
  document.getElementById('exam-toggle-answers').textContent =
    examAnswersVisible ? 'Lösungen verbergen' : 'Lösungen anzeigen';
}

// ── ANALYSIS ───────────────────────────────────────────────────────────────
document.getElementById('analysis-run-btn').addEventListener('click', runAnalysis);
document.getElementById('analysis-refresh-btn').addEventListener('click', runAnalysis);

function refreshAnalysisState() {
  const btn  = document.getElementById('analysis-run-btn');
  const hint = document.getElementById('analysis-hint');
  if (quizTotal >= 3) {
    btn.disabled = false;
    hint.textContent = `Du hast ${quizTotal} Fragen beantwortet (${Math.round((quizScore / (quizTotal * 3)) * 100)}%). Lass uns deine Vorbereitung analysieren!`;
  } else {
    btn.disabled = true;
    hint.textContent = `Beantworte noch ${3 - quizTotal} weitere Quiz-Fragen für eine Analyse.`;
  }
}

async function runAnalysis() {
  if (!sessionId) return;
  document.getElementById('analysis-idle').classList.add('hidden');
  document.getElementById('analysis-loading').classList.remove('hidden');
  document.getElementById('analysis-result').classList.add('hidden');

  try {
    const res  = await fetch('/api/analysis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const pct = data.percent;
    const color = pct >= 70 ? '#34c759' : pct >= 40 ? '#ff9500' : '#ff3b30';

    document.getElementById('readiness-gauge').innerHTML = `
      <div class="gauge-percent" style="color:${color}">${pct}%</div>
      <div class="gauge-label">Klausurbereitschaft</div>
      <div class="gauge-bar">
        <div class="gauge-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div style="margin-top:8px;font-size:13px;color:var(--text2)">${data.total} Quiz-Fragen · ${data.score}/${data.max} Punkte</div>`;

    document.getElementById('analysis-body').innerHTML = md(data.analysis);

    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-result').classList.remove('hidden');
  } catch (err) {
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-idle').classList.remove('hidden');
    alert('Fehler: ' + err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Minimal Markdown renderer
function md(text) {
  return (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^---$/gm, '<hr>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n\n/g, '\n<br>\n')
    .trim();
}
