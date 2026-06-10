require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse  = require('pdf-parse');

const app    = express();
const PORT   = process.env.PORT || 3000;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Persistent storage ─────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const metaPath    = id => path.join(DATA_DIR, `${id}.json`);
const contentPath = id => path.join(DATA_DIR, `${id}-content.txt`);

function loadMeta(id) {
  const p = metaPath(id);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function saveMeta(subject) {
  const { content, ...meta } = subject;
  fs.writeFileSync(metaPath(subject.id), JSON.stringify(meta, null, 2));
}

function saveContent(id, text) {
  fs.writeFileSync(contentPath(id), text);
}

function loadContent(id) {
  const p = contentPath(id);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function deleteSubject(id) {
  [metaPath(id), contentPath(id)].forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
}

function listSubjectSummaries() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .map(s => {
      const q = s.quizStats?.questions || [];
      const score = q.reduce((a, x) => a + x.score, 0);
      return {
        id: s.id, name: s.name, icon: s.icon, color: s.color,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
        fileCount: s.files?.length || 0,
        quizCount: q.length,
        lastScore: q.length ? Math.round((score / (q.length * 3)) * 100) : null,
      };
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

// ── In-memory session cache ────────────────────────────────────────────────
// subjectId is the sessionId – one session per subject
const cache = new Map();

function getSession(id) {
  if (cache.has(id)) return cache.get(id);
  const meta = loadMeta(id);
  if (!meta) return null;
  const session = { ...meta, content: loadContent(id) };
  cache.set(id, session);
  return session;
}

function persist(session) {
  saveMeta(session);
  saveContent(session.id, session.content || '');
}

// ── Helpers ────────────────────────────────────────────────────────────────
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Nur PDFs')),
});

app.use(express.json());
app.use(express.static('docs'));

function slidesBlock(session) {
  return {
    type: 'text',
    text: `Du bist ein strenger Nachhilfelehrer. Fach: "${session.name}"\n\n` +
          `--- UNTERLAGEN ---\n${session.content || '(noch keine Dokumente hochgeladen)'}\n--- ENDE ---\n\n` +
          `Antworte immer auf Deutsch.`,
    cache_control: { type: 'ephemeral' },
  };
}

async function ask(systemBlocks, messages, maxTokens = 1500) {
  const r = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: maxTokens,
    system: systemBlocks, messages,
  });
  return r.content[0].text;
}

// ── Subject CRUD ───────────────────────────────────────────────────────────

app.get('/api/subjects', (req, res) => {
  ensureDataDir();
  res.json(listSubjectSummaries());
});

app.post('/api/subjects', (req, res) => {
  const { name, icon = '📚', color = '#5856d6' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  ensureDataDir();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const subject = {
    id, name: name.trim(), icon, color,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    files: [], chatHistory: [], currentQuestion: null,
    quizStats: { questions: [] },
  };
  persist({ ...subject, content: '' });
  cache.set(id, { ...subject, content: '' });
  res.json(subject);
});

app.put('/api/subjects/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Fach nicht gefunden' });
  const { name, icon, color } = req.body;
  if (name)  s.name  = name.trim();
  if (icon)  s.icon  = icon;
  if (color) s.color = color;
  s.updatedAt = new Date().toISOString();
  persist(s);
  res.json({ ok: true });
});

app.delete('/api/subjects/:id', (req, res) => {
  deleteSubject(req.params.id);
  cache.delete(req.params.id);
  res.json({ ok: true });
});

// ── Upload PDFs to a subject ───────────────────────────────────────────────

app.post('/api/subjects/:id/upload', upload.array('pdfs', 10), async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    req.files?.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    return res.status(404).json({ error: 'Fach nicht gefunden' });
  }
  if (!req.files?.length) return res.status(400).json({ error: 'Keine Dateien' });

  try {
    let added = '', totalPages = 0;
    const newFiles = [];
    for (const f of req.files) {
      const buf  = fs.readFileSync(f.path);
      const data = await pdfParse(buf);
      fs.unlinkSync(f.path);
      added += `\n\n=== ${f.originalname} ===\n${data.text.trim()}`;
      newFiles.push({ name: f.originalname, pages: data.numpages, uploadedAt: new Date().toISOString() });
      totalPages += data.numpages;
    }
    session.content  = (session.content || '') + added;
    session.files    = [...(session.files || []), ...newFiles];
    session.updatedAt = new Date().toISOString();
    persist(session);
    res.json({ newFiles, totalFiles: session.files.length, totalPages });
  } catch (err) {
    req.files?.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(500).json({ error: 'PDF-Fehler: ' + err.message });
  }
});

// ── Chat ───────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  const s = getSession(sessionId);
  if (!s) return res.status(404).json({ error: 'Sitzung nicht gefunden' });
  s.chatHistory.push({ role: 'user', content: message });
  try {
    const reply = await ask(
      [slidesBlock(s), { type: 'text', text: 'Beantworte Fragen zu den Unterlagen. Erkläre präzise und Schritt für Schritt.' }],
      s.chatHistory,
    );
    s.chatHistory.push({ role: 'assistant', content: reply });
    if (s.chatHistory.length > 40) s.chatHistory = s.chatHistory.slice(-40);
    persist(s);
    res.json({ reply });
  } catch (err) {
    s.chatHistory.pop();
    res.status(500).json({ error: err.message });
  }
});

// ── Quiz ───────────────────────────────────────────────────────────────────

app.post('/api/quiz/question', async (req, res) => {
  const { sessionId } = req.body;
  const s = getSession(sessionId);
  if (!s) return res.status(404).json({ error: 'Sitzung nicht gefunden' });
  const done = s.quizStats.questions.length;
  const avoid = s.quizStats.questions.slice(-8).map(q => q.question).join('\n- ');
  try {
    const q = await ask(
      [slidesBlock(s), {
        type: 'text',
        text: `Stelle EINE Prüfungsfrage für "${s.name}" (Frage ${done + 1}).
Mix: Verständnis, Anwendung, Details. Keine Ja/Nein-Fragen.
${avoid ? `Bereits gestellte Fragen vermeiden:\n- ${avoid}` : ''}
Antworte NUR mit der Frage, ohne Kommentar.`,
      }],
      [{ role: 'user', content: 'Nächste Frage.' }],
      300,
    );
    s.currentQuestion = q.trim();
    persist(s);
    res.json({ question: s.currentQuestion, count: done + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quiz/answer', async (req, res) => {
  const { sessionId, answer } = req.body;
  const s = getSession(sessionId);
  if (!s?.currentQuestion) return res.status(400).json({ error: 'Keine aktive Frage' });
  try {
    const raw = await ask(
      [slidesBlock(s), {
        type: 'text',
        text: `Bewerte die Antwort STRENG UND PESSIMISTISCH – Prüfungen verzeihen nichts.

Skala (im Zweifel den NIEDRIGEREN Wert wählen):
• 3 = vollständig korrekt, präzise, ALLE wesentlichen Punkte, keine Fehler
• 2 = Kernaussage stimmt, aber wichtige Details fehlen ODER kleinere Fehler
• 1 = Grundidee erkennbar, aber erhebliche Lücken oder mehrere Fehler
• 0 = falsch, am Thema vorbei, oder so lückenhaft dass es nicht zählt

Strenge Prüfungsstandards anlegen. Teilwissen reicht nicht für volle Punkte.

Antworte NUR als JSON:
{
  "score": <0-3>,
  "correct": <true|false>,
  "topic": "<Thema max 4 Wörter>",
  "feedback": "<2 Sätze: was fehlte / was war gut>",
  "correct_answer": "<vollständige Musterantwort>"
}`,
      }],
      [{ role: 'user', content: `Frage: ${s.currentQuestion}\n\nAntwort: ${answer}` }],
      700,
    );
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Ungültige Modellantwort');
    const ev = JSON.parse(match[0]);
    s.quizStats.questions.push({
      question: s.currentQuestion, userAnswer: answer,
      correct: ev.correct, score: ev.score, topic: ev.topic,
    });
    s.currentQuestion = null;
    s.updatedAt = new Date().toISOString();
    persist(s);
    const total = s.quizStats.questions.length;
    const totalScore = s.quizStats.questions.reduce((a, q) => a + q.score, 0);
    res.json({ ...ev, stats: { total, totalScore, maxScore: total * 3, percent: Math.round(totalScore / (total * 3) * 100) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Exam ───────────────────────────────────────────────────────────────────

app.post('/api/exam/generate', async (req, res) => {
  const { sessionId, difficulty = 'mittel' } = req.body;
  const s = getSession(sessionId);
  if (!s) return res.status(404).json({ error: 'Sitzung nicht gefunden' });
  try {
    const exam = await ask(
      [slidesBlock(s), {
        type: 'text',
        text: `Erstelle eine anspruchsvolle Probeklausur für "${s.name}" (Schwierigkeit: ${difficulty}).

# Probeklausur – ${s.name}
**Bearbeitungszeit:** XX Min | **Punkte:** XX

## Teil A – Multiple Choice (je 1 Punkt)
[Min. 5 Fragen mit Optionen a–d]

## Teil B – Kurzantworten (je 3 Punkte)
[Min. 3 Fragen]

## Teil C – Ausführliche Antworten (je 6-8 Punkte)
[Min. 2 Fragen]

---
## Lösungsschlüssel
[Vollständige Lösungen]`,
      }],
      [{ role: 'user', content: 'Klausur erstellen.' }],
      3000,
    );
    res.json({ exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analysis ───────────────────────────────────────────────────────────────

app.post('/api/analysis', async (req, res) => {
  const { sessionId } = req.body;
  const s = getSession(sessionId);
  if (!s) return res.status(404).json({ error: 'Sitzung nicht gefunden' });
  const questions = s.quizStats.questions;
  if (questions.length < 3) return res.status(400).json({ error: 'Min. 3 Quiz-Fragen erforderlich' });

  const statsText = questions.map((q, i) =>
    `${i+1}. [${q.topic}] ${q.score}/3 ${q.correct ? '✓' : '✗'}\n   F: ${q.question}\n   A: ${q.userAnswer}`
  ).join('\n\n');

  const raw = Math.round(questions.reduce((a, q) => a + q.score, 0) / (questions.length * 3) * 100);
  // Pessimistic correction: subtract 12 points minimum, floor at 0
  const percent = Math.max(0, raw - 12);

  try {
    const analysis = await ask(
      [slidesBlock(s), {
        type: 'text',
        text: `Erstelle eine KRITISCHE, PESSIMISTISCHE Lernstandsanalyse für "${s.name}".

PFLICHT: Sei bewusst streng. Prüfungen verlaufen unter Druck schlechter als Übungen.
Klausurbereitschaft: ${percent}% (pessimistisch korrigiert von ${raw}%).
Vermeide falsche Sicherheit. Sage klar was noch fehlt.

Format:
## Gesamteinschätzung
[Kritische, ehrliche Einschätzung – kein falscher Optimismus]

## Stärken ✓
- [nur was wirklich sicher sitzt]

## Kritische Lücken ⚠
- **[Thema]:** [was genau fehlt und warum das prüfungsrelevant ist]
(mindestens 3 konkrete Punkte)

## Priorisierter Lernplan
1. [Dringendstes zuerst – direkt aus den Unterlagen]
2. ...

## Prognose
[Realistisch: wie viel Lernaufwand noch nötig, wie vorbereitet wirklich]`,
      }],
      [{ role: 'user', content: `Quiz-Ergebnisse:\n${statsText}\nRoh: ${raw}%, Korrigiert: ${percent}%` }],
      2000,
    );
    res.json({ analysis, percent, raw, total: questions.length,
      score: questions.reduce((a, q) => a + q.score, 0), max: questions.length * 3 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reset & Stats ──────────────────────────────────────────────────────────

app.post('/api/reset', (req, res) => {
  const { sessionId, what = 'chat' } = req.body;
  const s = getSession(sessionId);
  if (!s) return res.status(404).json({ error: 'Nicht gefunden' });
  if (what === 'chat' || what === 'all') s.chatHistory = [];
  if (what === 'quiz' || what === 'all') { s.quizStats = { questions: [] }; s.currentQuestion = null; }
  persist(s);
  res.json({ ok: true });
});

app.get('/api/stats/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Nicht gefunden' });
  const q = s.quizStats.questions;
  const score = q.reduce((a, x) => a + x.score, 0);
  res.json({ total: q.length, score, max: q.length * 3,
    percent: q.length ? Math.round(score / (q.length * 3) * 100) : 0 });
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

ensureDataDir();
app.listen(PORT, () => console.log(`Nachhilfelehrer: http://localhost:${PORT}`));
