require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// sessionId -> Session
const sessions = new Map();

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Nur PDFs erlaubt'));
  },
});

app.use(express.json());
app.use(express.static('public'));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSession(filename, slides) {
  return {
    filename,
    slides,
    chatHistory: [],
    currentQuestion: null,
    quizStats: { questions: [] },
  };
}

// Shared system prompt preamble with the slides (cached)
function slidesBlock(session) {
  return {
    type: 'text',
    text: `Du bist ein exzellenter Nachhilfelehrer. Der Student hat folgende Unterlagen hochgeladen:\n\n--- DATEI: ${session.filename} ---\n${session.slides}\n--- ENDE ---\n\nAntworte immer auf Deutsch, präzise und lehrreich.`,
    cache_control: { type: 'ephemeral' },
  };
}

async function claudeCall(systemBlocks, messages, maxTokens = 1500) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemBlocks,
    messages,
  });
  return response.content[0].text;
}

// ── Upload (supports multiple PDFs) ───────────────────────────────────────

app.post('/api/upload', upload.array('pdfs', 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Keine Dateien hochgeladen' });

  try {
    const parts = [];
    let totalPages = 0;

    for (const file of req.files) {
      const buffer = fs.readFileSync(file.path);
      const data = await pdfParse(buffer);
      fs.unlinkSync(file.path);
      parts.push(`\n\n=== DOKUMENT: ${file.originalname} ===\n${data.text.trim()}`);
      totalPages += data.numpages;
    }

    const combined = parts.join('\n');
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const label = req.files.length === 1
      ? req.files[0].originalname
      : `${req.files.length} Dokumente`;

    sessions.set(sessionId, makeSession(label, combined));

    res.json({ sessionId, label, pages: totalPages, files: req.files.map(f => f.originalname) });
  } catch (err) {
    req.files?.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(500).json({ error: 'PDF-Fehler: ' + err.message });
  }
});

// ── Chat – freie Fragen ────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  session.chatHistory.push({ role: 'user', content: message });

  try {
    const reply = await claudeCall(
      [slidesBlock(session), {
        type: 'text',
        text: 'Beantworte die Fragen des Studenten zu den Unterlagen. Erkläre Schritt für Schritt, gib Beispiele, und stelle Verständnisfragen wenn sinnvoll.',
      }],
      session.chatHistory,
    );

    session.chatHistory.push({ role: 'assistant', content: reply });
    if (session.chatHistory.length > 40) session.chatHistory = session.chatHistory.slice(-40);

    res.json({ reply });
  } catch (err) {
    session.chatHistory.pop();
    res.status(500).json({ error: err.message });
  }
});

// ── Quiz – nächste Frage holen ─────────────────────────────────────────────

app.post('/api/quiz/question', async (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  const done = session.quizStats.questions.length;
  const alreadyAsked = session.quizStats.questions.map(q => q.question).join('\n- ');
  const avoidSection = alreadyAsked
    ? `\nVermeide diese bereits gestellten Fragen:\n- ${alreadyAsked}`
    : '';

  try {
    const question = await claudeCall(
      [slidesBlock(session), {
        type: 'text',
        text: `Du fragst den Studenten ab. Stelle EINE präzise Prüfungsfrage zu den Unterlagen.
Abwechslung ist wichtig: Mix aus Verständnis-, Anwendungs- und Detailfragen.
Frage Nummer ${done + 1}.${avoidSection}

Antworte NUR mit der Frage, kein Kommentar davor oder danach.`,
      }],
      [{ role: 'user', content: 'Stelle mir die nächste Frage.' }],
      300,
    );

    session.currentQuestion = question.trim();
    res.json({ question: session.currentQuestion, count: done + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Quiz – Antwort bewerten ────────────────────────────────────────────────

app.post('/api/quiz/answer', async (req, res) => {
  const { sessionId, answer } = req.body;
  const session = sessions.get(sessionId);
  if (!session || !session.currentQuestion) return res.status(400).json({ error: 'Keine aktive Frage' });

  try {
    const raw = await claudeCall(
      [slidesBlock(session), {
        type: 'text',
        text: `Du bewertest die Antwort des Studenten auf eine Prüfungsfrage.

Antworte EXAKT in diesem JSON-Format (kein Markdown drum herum):
{
  "score": <0-3>,
  "correct": <true|false>,
  "topic": "<Thema in 3-5 Wörtern>",
  "feedback": "<1-2 Sätze Feedback auf Deutsch>",
  "correct_answer": "<Die vollständige korrekte Antwort>"
}

Bewertungsschema: 3=vollständig korrekt, 2=teilweise korrekt, 1=Ansatz richtig aber lückenhaft, 0=falsch`,
      }],
      [{
        role: 'user',
        content: `Frage: ${session.currentQuestion}\n\nAntwort des Studenten: ${answer}`,
      }],
      600,
    );

    // Extract JSON even if wrapped in backticks
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Ungültige Antwort vom Modell');
    const evaluation = JSON.parse(jsonMatch[0]);

    session.quizStats.questions.push({
      question: session.currentQuestion,
      userAnswer: answer,
      correct: evaluation.correct,
      score: evaluation.score,
      topic: evaluation.topic,
    });
    session.currentQuestion = null;

    const total = session.quizStats.questions.length;
    const totalScore = session.quizStats.questions.reduce((s, q) => s + q.score, 0);
    const maxScore = total * 3;

    res.json({
      ...evaluation,
      stats: { total, totalScore, maxScore, percent: Math.round((totalScore / maxScore) * 100) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Probeklausur generieren ────────────────────────────────────────────────

app.post('/api/exam/generate', async (req, res) => {
  const { sessionId, difficulty = 'mittel' } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  try {
    const exam = await claudeCall(
      [slidesBlock(session), {
        type: 'text',
        text: `Erstelle eine realistische Probeklausur auf Basis der Unterlagen.
Schwierigkeitsgrad: ${difficulty}

Format:
# Probeklausur – [Thema]
**Bearbeitungszeit:** XX Minuten | **Gesamtpunkte:** XX

## Teil A – Multiple Choice (je 1 Punkt)
1. [Frage]
   a) ... b) ... c) ... d) ...

## Teil B – Kurzantworten (je 3 Punkte)
1. [Frage] (3 Punkte)

## Teil C – Ausführliche Antworten (je 5-8 Punkte)
1. [Frage] (X Punkte)

---
## Lösungsschlüssel
[Vollständige Lösungen für alle Teile]

Erstelle mindestens 5 MC-Fragen, 3 Kurzantworten, 2 ausführliche Fragen.`,
      }],
      [{ role: 'user', content: 'Erstelle die Probeklausur.' }],
      3000,
    );

    res.json({ exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analyse der Vorbereitung ───────────────────────────────────────────────

app.post('/api/analysis', async (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  const questions = session.quizStats.questions;
  if (questions.length < 3) {
    return res.status(400).json({ error: 'Beantworte mindestens 3 Quiz-Fragen für eine Analyse.' });
  }

  const statsText = questions.map((q, i) =>
    `${i + 1}. Thema: ${q.topic} | Punkte: ${q.score}/3 | Korrekt: ${q.correct ? 'Ja' : 'Nein'}\n   Frage: ${q.question}\n   Antwort: ${q.userAnswer}`
  ).join('\n\n');

  const totalScore = questions.reduce((s, q) => s + q.score, 0);
  const maxScore = questions.length * 3;
  const percent = Math.round((totalScore / maxScore) * 100);

  try {
    const analysis = await claudeCall(
      [slidesBlock(session), {
        type: 'text',
        text: `Erstelle eine detaillierte Lernstandsanalyse für den Studenten.

Die Unterlagen umfassen den Prüfungsstoff. Der Student hat ${questions.length} Quiz-Fragen beantwortet und ${percent}% der Punkte erreicht.

Antworte in diesem Format:

## Gesamtbewertung
[2-3 Sätze Gesamteinschätzung]

## Stärken
- [Thema]: [Was der Student gut kann]
(mindestens 2 Punkte)

## Verbesserungsbedarf
- [Thema]: [Was verbessert werden muss und wie]
(mindestens 2 Punkte)

## Lernplan
[Konkrete, priorisierte Empfehlungen was als nächstes gelernt werden soll – direkt bezogen auf die Unterlagen]

## Prognose
[Einschätzung der Klausurbereitschaft in %, mit Begründung]`,
      }],
      [{
        role: 'user',
        content: `Quiz-Ergebnisse des Studenten:\n\n${statsText}\n\nGesamtpunktzahl: ${totalScore}/${maxScore} (${percent}%)`,
      }],
      2000,
    );

    res.json({ analysis, percent, total: questions.length, score: totalScore, max: maxScore });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────

app.get('/api/stats/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  const q = session.quizStats.questions;
  const total = q.length;
  const totalScore = q.reduce((s, x) => s + x.score, 0);

  // Topic breakdown
  const topicMap = {};
  q.forEach(x => {
    if (!topicMap[x.topic]) topicMap[x.topic] = { score: 0, max: 0 };
    topicMap[x.topic].score += x.score;
    topicMap[x.topic].max += 3;
  });

  res.json({
    total,
    totalScore,
    maxScore: total * 3,
    percent: total ? Math.round((totalScore / (total * 3)) * 100) : 0,
    topics: topicMap,
  });
});

// ── Reset ─────────────────────────────────────────────────────────────────

app.post('/api/reset', (req, res) => {
  const { sessionId, what = 'chat' } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  if (what === 'chat') session.chatHistory = [];
  if (what === 'quiz') { session.quizStats = { questions: [] }; session.currentQuestion = null; }
  if (what === 'all') { session.chatHistory = []; session.quizStats = { questions: [] }; session.currentQuestion = null; }

  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Nachhilfelehrer läuft auf http://localhost:${PORT}`));
