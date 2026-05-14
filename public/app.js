let sessionId = null;

// ── Screen navigation ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Upload ─────────────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const uploadStatus = document.getElementById('upload-status');

function setStatus(msg, type) {
  uploadStatus.textContent = msg;
  uploadStatus.className = `upload-status ${type}`;
  uploadStatus.classList.remove('hidden');
}

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
});

// Drag & drop
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file?.type === 'application/pdf') uploadFile(file);
  else setStatus('Bitte nur PDF-Dateien hochladen.', 'error');
});

async function uploadFile(file) {
  setStatus('PDF wird verarbeitet…', 'info');

  const formData = new FormData();
  formData.append('pdf', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');

    sessionId = data.sessionId;
    document.getElementById('header-filename').textContent = data.filename;
    document.getElementById('welcome-text').textContent =
      `Ich habe deine Folien "${data.filename}" geladen (${data.pages} Seiten). Was möchtest du wissen?`;

    // Clear previous chat
    const msgs = document.getElementById('chat-messages');
    msgs.innerHTML = `
      <div class="welcome-msg">
        <span class="welcome-icon">📚</span>
        <p>${document.getElementById('welcome-text')?.textContent ?? ''}</p>
      </div>`;

    showScreen('chat-screen');
  } catch (err) {
    setStatus('Fehler: ' + err.message, 'error');
  }

  fileInput.value = '';
}

// ── Chat ───────────────────────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

function addMessage(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = formatMarkdown(text);

  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function showTyping() {
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  wrapper.id = 'typing';
  wrapper.innerHTML = `
    <div class="typing-indicator">
      <span></span><span></span><span></span>
    </div>`;
  chatMessages.appendChild(wrapper);
  scrollToBottom();
}

function removeTyping() {
  document.getElementById('typing')?.remove();
}

function scrollToBottom() {
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

// Minimal markdown: bold, italic, inline code, headings, lists
function formatMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, (m, c) => c ? `<p>${c}</p>` : '')
    .trim();
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !sessionId) return;

  userInput.value = '';
  autoResize();
  sendBtn.disabled = true;

  addMessage('user', text);
  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const data = await res.json();

    removeTyping();

    if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler');

    addMessage('assistant', data.reply);
  } catch (err) {
    removeTyping();
    addMessage('assistant', '⚠️ Fehler: ' + err.message);
  }

  sendBtn.disabled = false;
  userInput.focus();
}

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', e => {
  // On iPad, Enter alone sends; Shift+Enter = newline
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
}
userInput.addEventListener('input', autoResize);

// ── Navigation ─────────────────────────────────────────────────────────────
document.getElementById('back-btn').addEventListener('click', () => {
  showScreen('upload-screen');
  sessionId = null;
  uploadStatus.classList.add('hidden');
});

document.getElementById('reset-btn').addEventListener('click', async () => {
  if (!sessionId) return;
  await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  chatMessages.innerHTML = `
    <div class="welcome-msg">
      <span class="welcome-icon">🔄</span>
      <p>Chat zurückgesetzt. Stell mir neue Fragen zu deinen Folien!</p>
    </div>`;
});

// Restore welcome text after upload redirect
document.getElementById('welcome-text') ?.remove?.();
