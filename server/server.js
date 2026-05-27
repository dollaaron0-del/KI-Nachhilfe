require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ── DB ─────────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Anthropic ──────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // CSP handled by nginx
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting for Claude API calls
const claudeLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Zu viele Anfragen. Bitte warte eine Minute.' },
});

// ── File upload (PDFs) ─────────────────────────────────────────────────────
const upload = multer({
  dest: '/tmp/nachhilfe-uploads/',
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('text/')) cb(null, true);
    else cb(new Error('Nur PDF und Text-Dateien erlaubt'));
  },
});

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../Aktien/docs')));

// ═══════════════════════════════════════════════════════════════════════════
// SUBJECTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM subjects ORDER BY created_at ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects', async (req, res) => {
  const { id, name, emoji } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id und name erforderlich' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO subjects (id,name,emoji) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3 RETURNING *',
      [id, name, emoji || '📚']
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM subjects WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGES (chat history)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/messages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT role,content FROM messages WHERE subject_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/messages', async (req, res) => {
  const { role, content } = req.body;
  if (!role || !content) return res.status(400).json({ error: 'role und content erforderlich' });
  try {
    await pool.query(
      'INSERT INTO messages (subject_id,role,content) VALUES ($1,$2,$3)',
      [req.params.id, role, content]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/messages', async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE subject_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/documents', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,filename,uploaded_at FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  try {
    let content = '';
    if (req.file.mimetype === 'application/pdf') {
      // Basic PDF text extraction using pdftotext if available, else store raw
      try {
        const { execSync } = require('child_process');
        content = execSync(`pdftotext "${req.file.path}" -`).toString();
      } catch {
        content = fs.readFileSync(req.file.path).toString('base64');
      }
    } else {
      content = fs.readFileSync(req.file.path, 'utf8');
    }
    fs.unlinkSync(req.file.path);

    const { rows } = await pool.query(
      'INSERT INTO documents (subject_id,filename,content) VALUES ($1,$2,$3) RETURNING id,filename,uploaded_at',
      [req.params.id, req.file.originalname, content]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/subjects/:id/documents/:docId', async (req, res) => {
  try {
    await pool.query('DELETE FROM documents WHERE id=$1 AND subject_id=$2', [req.params.docId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE PROXY (hides API key)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/claude', claudeLimit, async (req, res) => {
  const { messages, system, max_tokens, model } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  try {
    // Fetch subject documents as context if subject_id provided
    let systemContent = system || '';
    if (req.body.subject_id) {
      const { rows } = await pool.query(
        'SELECT filename,content FROM documents WHERE subject_id=$1',
        [req.body.subject_id]
      );
      if (rows.length > 0) {
        const docContext = rows.map(r => `[Dokument: ${r.filename}]\n${r.content.slice(0, 8000)}`).join('\n\n---\n\n');
        systemContent = systemContent
          ? `${systemContent}\n\n---\nHochgeladene Dokumente:\n${docContext}`
          : `Hochgeladene Dokumente:\n${docContext}`;
      }
    }

    const params = {
      model: model || 'claude-opus-4-5',
      max_tokens: Math.min(max_tokens || 2000, 4096),
      messages,
    };
    if (systemContent) params.system = systemContent;

    const response = await anthropic.messages.create(params);
    res.json(response);
  } catch (e) {
    console.error('Claude error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLASHCARDS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/cards', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM flashcards WHERE subject_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/cards', async (req, res) => {
  const { cards } = req.body; // array of {front,back,ef,interval,repetitions,due}
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'cards array erforderlich' });
  try {
    await pool.query('DELETE FROM flashcards WHERE subject_id=$1', [req.params.id]);
    for (const c of cards) {
      await pool.query(
        'INSERT INTO flashcards (subject_id,front,back,ef,interval,repetitions,due) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.params.id, c.front, c.back, c.ef||2.5, c.interval||1, c.repetitions||0, c.due||0]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// QUIZ RESULTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/quiz', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT score,total,taken_at FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/quiz', async (req, res) => {
  const { score, total } = req.body;
  if (score == null || total == null) return res.status(400).json({ error: 'score und total erforderlich' });
  try {
    await pool.query(
      'INSERT INTO quiz_results (subject_id,score,total) VALUES ($1,$2,$3)',
      [req.params.id, score, total]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// STREAK
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/streak', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT count,last_date FROM streak WHERE id=1');
    res.json(rows[0] || { count: 0, last_date: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/streak', async (req, res) => {
  const { count, last_date } = req.body;
  try {
    await pool.query(
      'UPDATE streak SET count=$1,last_date=$2 WHERE id=1',
      [count, last_date]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOSSAR
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/glossar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,term,definition FROM glossar WHERE subject_id=$1 ORDER BY term ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/glossar', async (req, res) => {
  const { terms } = req.body; // array of {term, definition}
  if (!Array.isArray(terms)) return res.status(400).json({ error: 'terms array erforderlich' });
  try {
    await pool.query('DELETE FROM glossar WHERE subject_id=$1', [req.params.id]);
    for (const t of terms) {
      await pool.query(
        'INSERT INTO glossar (subject_id,term,definition) VALUES ($1,$2,$3)',
        [req.params.id, t.term, t.definition]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// BACKUP / RESTORE
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/backup', async (req, res) => {
  try {
    const subjects = (await pool.query('SELECT * FROM subjects ORDER BY created_at')).rows;
    const backup = { version: 2, exportedAt: new Date().toISOString(), subjects: [] };

    for (const s of subjects) {
      const messages = (await pool.query('SELECT role,content FROM messages WHERE subject_id=$1 ORDER BY created_at', [s.id])).rows;
      const cards = (await pool.query('SELECT front,back,ef,interval,repetitions,due FROM flashcards WHERE subject_id=$1', [s.id])).rows;
      const quiz = (await pool.query('SELECT score,total FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at', [s.id])).rows;
      const glossar = (await pool.query('SELECT term,definition FROM glossar WHERE subject_id=$1', [s.id])).rows;
      backup.subjects.push({ ...s, messages, cards, quiz, glossar });
    }

    res.setHeader('Content-Disposition', `attachment; filename="nachhilfe-backup-${Date.now()}.json"`);
    res.json(backup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/restore', async (req, res) => {
  const { subjects } = req.body;
  if (!Array.isArray(subjects)) return res.status(400).json({ error: 'Ungültiges Backup-Format' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of subjects) {
      await client.query(
        'INSERT INTO subjects (id,name,emoji) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3',
        [s.id, s.name, s.emoji || '📚']
      );
      if (s.messages?.length) {
        await client.query('DELETE FROM messages WHERE subject_id=$1', [s.id]);
        for (const m of s.messages) {
          await client.query('INSERT INTO messages (subject_id,role,content) VALUES ($1,$2,$3)', [s.id, m.role, m.content]);
        }
      }
      if (s.cards?.length) {
        await client.query('DELETE FROM flashcards WHERE subject_id=$1', [s.id]);
        for (const c of s.cards) {
          await client.query(
            'INSERT INTO flashcards (subject_id,front,back,ef,interval,repetitions,due) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [s.id, c.front, c.back, c.ef||2.5, c.interval||1, c.repetitions||0, c.due||0]
          );
        }
      }
      if (s.glossar?.length) {
        await client.query('DELETE FROM glossar WHERE subject_id=$1', [s.id]);
        for (const g of s.glossar) {
          await client.query('INSERT INTO glossar (subject_id,term,definition) VALUES ($1,$2,$3)', [s.id, g.term, g.definition]);
        }
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected', uptime: process.uptime() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SPA fallback ───────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../Aktien/docs/index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Nachhilfe-Server läuft auf Port ${PORT}`);
  console.log(`Datenbank: ${process.env.DATABASE_URL ? 'konfiguriert' : 'FEHLT'}`);
  console.log(`API-Key: ${process.env.ANTHROPIC_API_KEY ? 'gesetzt' : 'FEHLT'}`);
});
