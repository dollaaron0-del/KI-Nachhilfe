require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory store: sessionId -> { slides: string, history: Message[] }
const sessions = new Map();

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Nur PDF-Dateien erlaubt'));
    }
  },
});

app.use(express.json());
app.use(express.static('public'));

// Upload PDF and extract text
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  }

  try {
    const buffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(buffer);
    fs.unlinkSync(req.file.path);

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const slidesText = data.text.trim();

    sessions.set(sessionId, {
      filename: req.file.originalname,
      slides: slidesText,
      history: [],
    });

    res.json({
      sessionId,
      filename: req.file.originalname,
      pages: data.numpages,
      preview: slidesText.slice(0, 300),
    });
  } catch (err) {
    if (req.file?.path) fs.unlinkSync(req.file.path).catch?.(() => {});
    res.status(500).json({ error: 'PDF konnte nicht gelesen werden: ' + err.message });
  }
});

// Chat with the tutor
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId und message erforderlich' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session nicht gefunden – bitte Folien erneut hochladen' });
  }

  session.history.push({ role: 'user', content: message });

  const systemPrompt = `Du bist ein geduldiger, motivierender Nachhilfelehrer. Der Student hat folgende Vorlesungsfolien hochgeladen:

--- BEGINN FOLIEN: ${session.filename} ---
${session.slides}
--- ENDE FOLIEN ---

Deine Aufgaben:
- Beantworte Fragen zu diesen Folien klar und verständlich auf Deutsch
- Erkläre komplexe Konzepte Schritt für Schritt
- Stelle Verständnisfragen zurück, wenn der Student etwas nicht verstanden hat
- Gib Beispiele aus dem echten Leben, wenn das hilft
- Wenn du eine Frage nicht aus den Folien beantworten kannst, sag es ehrlich und gib trotzdem allgemeines Wissen dazu
- Antworte immer auf Deutsch, es sei denn der Student schreibt auf Englisch`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: session.history,
    });

    const reply = response.content[0].text;
    session.history.push({ role: 'assistant', content: reply });

    // Keep history bounded to last 20 exchanges (40 messages)
    if (session.history.length > 40) {
      session.history = session.history.slice(-40);
    }

    res.json({ reply });
  } catch (err) {
    session.history.pop(); // remove failed user message
    res.status(500).json({ error: 'Claude API Fehler: ' + err.message });
  }
});

// Clear chat history for a session
app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);
  if (session) {
    session.history = [];
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Session nicht gefunden' });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Nachhilfelehrer läuft auf http://localhost:${PORT}`);
});
