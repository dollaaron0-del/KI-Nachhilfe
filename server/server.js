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
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET    = process.env.JWT_SECRET    || 'nachhilfe-secret-change-in-production';
const TG_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID    = process.env.TELEGRAM_ADMIN_CHAT_ID;
const ADMIN_USER    = (process.env.ADMIN_USERNAME || '').toLowerCase();

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) {}
}

async function sendTelegramButtons(text, buttons) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID, text, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      }),
    });
  } catch (_) {}
}

// Dynamic daily limit (stored in settings table, fallback to env var)
async function getDailyLimit() {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='daily_limit_eur'");
    if (rows.length) return parseFloat(rows[0].value) || 1.0;
  } catch (_) {}
  return parseFloat(process.env.DAILY_LIMIT_EUR || '1.0');
}

// ── Telegram polling (handle bot commands & inline button presses) ─────────
let tgOffset = 0;

async function answerCallback(id, text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text }),
  }).catch(() => {});
}

async function pollTelegram() {
  if (!TG_TOKEN) return;
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${tgOffset}&timeout=0&limit=10`
    );
    if (!r.ok) return;
    const data = await r.json();
    for (const upd of data.result || []) {
      tgOffset = upd.update_id + 1;

      // ── Inline button press ─────────────────────────────────────────────
      if (upd.callback_query) {
        const cb = upd.callback_query;
        const chatId = cb.message?.chat?.id?.toString();
        if (chatId !== TG_CHAT_ID) continue;
        const cbData = cb.data || '';

        if (cbData.startsWith('addlimit:')) {
          const add = parseFloat(cbData.split(':')[1]);
          if (!isNaN(add) && add > 0) {
            const current = await getDailyLimit();
            const newLimit = +(current + add).toFixed(2);
            await pool.query(
              "INSERT INTO settings (key,value) VALUES ('daily_limit_eur',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
              [newLimit.toString()]
            );
            await answerCallback(cb.id, `✅ Limit → ${newLimit.toFixed(2)}€`);
            await sendTelegram(`✅ Tageslimit auf <b>${newLimit.toFixed(2)}€</b> erhöht (war ${current.toFixed(2)}€)`);
          }

        } else if (cbData.startsWith('approve:')) {
          const userId = parseInt(cbData.split(':')[1]);
          const { rows } = await pool.query(
            'UPDATE users SET approved=true, approval_token=NULL WHERE id=$1 AND approved=false RETURNING username',
            [userId]
          );
          if (rows.length) {
            await answerCallback(cb.id, `✅ ${rows[0].username} freigeschaltet`);
            await sendTelegram(`✅ <b>${rows[0].username}</b> wurde freigeschaltet.`);
          } else {
            await answerCallback(cb.id, 'Bereits verarbeitet');
          }

        } else if (cbData.startsWith('reject:')) {
          const userId = parseInt(cbData.split(':')[1]);
          const { rows } = await pool.query(
            'DELETE FROM users WHERE id=$1 AND approved=false RETURNING username',
            [userId]
          );
          if (rows.length) {
            await answerCallback(cb.id, `🗑 ${rows[0].username} abgelehnt`);
            await sendTelegram(`🗑 <b>${rows[0].username}</b> wurde abgelehnt und gelöscht.`);
          } else {
            await answerCallback(cb.id, 'Bereits verarbeitet');
          }
        }
        continue;
      }

      // ── Text commands ───────────────────────────────────────────────────
      const msg = upd.message;
      if (!msg || msg.chat?.id?.toString() !== TG_CHAT_ID) continue;
      const text = msg.text?.trim() || '';

      if (text.startsWith('/setlimit ')) {
        const val = parseFloat(text.split(' ')[1]);
        if (!isNaN(val) && val > 0) {
          await pool.query(
            "INSERT INTO settings (key,value) VALUES ('daily_limit_eur',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
            [val.toString()]
          );
          await sendTelegram(`✅ Tageslimit auf <b>${val.toFixed(2)}€</b> gesetzt`);
        } else {
          await sendTelegram('❌ Ungültiger Betrag. Beispiel: <code>/setlimit 2.00</code>');
        }

      } else if (text === '/status') {
        const { cost, calls } = await checkDailyLimit();
        const limit = await getDailyLimit();
        const pct = limit > 0 ? Math.round(cost / limit * 100) : 0;
        await sendTelegram(
          `📊 <b>Tagesstatus</b>\n\nVerbraucht: ${cost.toFixed(3)}€\nLimit: ${limit.toFixed(2)}€\nAuslastung: ${pct}%\nAPI-Calls: ${calls}`
        );

      } else if (text === '/users') {
        const { rows } = await pool.query(
          "SELECT id, username, approved, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT 20"
        );
        if (!rows.length) {
          await sendTelegram('Keine Benutzer vorhanden.');
        } else {
          const lines = rows.map(u => {
            const status = !u.approved ? '⏳ ausstehend' : u.is_admin ? '👑 Admin' : '✅ aktiv';
            return `${status} — <b>${u.username}</b>`;
          });
          await sendTelegram(`👥 <b>Benutzer (${rows.length})</b>\n\n${lines.join('\n')}`);
        }

      } else if (text.startsWith('/approve ')) {
        const uname = text.split(' ')[1]?.toLowerCase();
        if (!uname) { await sendTelegram('Beispiel: <code>/approve benutzername</code>'); continue; }
        const { rows } = await pool.query(
          'UPDATE users SET approved=true, approval_token=NULL WHERE LOWER(username)=$1 AND approved=false RETURNING username',
          [uname]
        );
        if (rows.length) await sendTelegram(`✅ <b>${rows[0].username}</b> wurde freigeschaltet.`);
        else await sendTelegram(`❌ Kein ausstehender Benutzer mit dem Namen <b>${uname}</b> gefunden.`);

      } else if (text.startsWith('/reject ')) {
        const uname = text.split(' ')[1]?.toLowerCase();
        if (!uname) { await sendTelegram('Beispiel: <code>/reject benutzername</code>'); continue; }
        const { rows } = await pool.query(
          'DELETE FROM users WHERE LOWER(username)=$1 AND approved=false RETURNING username',
          [uname]
        );
        if (rows.length) await sendTelegram(`🗑 <b>${rows[0].username}</b> wurde abgelehnt und gelöscht.`);
        else await sendTelegram(`❌ Kein ausstehender Benutzer mit dem Namen <b>${uname}</b> gefunden.`);

      } else if (text === '/help') {
        await sendTelegram(
          `🤖 <b>Admin-Befehle</b>\n\n` +
          `👥 <b>Benutzer</b>\n` +
          `/users — alle Benutzer auflisten\n` +
          `/approve &lt;name&gt; — Benutzer freischalten\n` +
          `/reject &lt;name&gt; — Benutzer ablehnen\n\n` +
          `💰 <b>Limit</b>\n` +
          `/setlimit 2.00 — Tageslimit setzen\n` +
          `/status — API-Verbrauch heute\n\n` +
          `Registrierungsanfragen erscheinen automatisch mit ✅/❌-Buttons.`
        );
      }
    }
  } catch (_) {}
}

async function checkAndNotify90pct(today, newCost) {
  const limit = await getDailyLimit();
  if (limit <= 0 || newCost / limit < 0.9) return;
  try {
    const { rows } = await pool.query(
      'SELECT notified_90pct FROM daily_usage WHERE date=$1', [today]
    );
    if (rows[0]?.notified_90pct) return;
    await pool.query('UPDATE daily_usage SET notified_90pct=true WHERE date=$1', [today]);
    await sendTelegramButtons(
      `⚠️ <b>90% des Tageslimits erreicht!</b>\n\nVerbraucht: ${newCost.toFixed(3)}€ / ${limit.toFixed(2)}€\n\nLimit für heute erhöhen:`,
      [[
        { text: '+0,50€', callback_data: 'addlimit:0.50' },
        { text: '+1,00€', callback_data: 'addlimit:1.00' },
        { text: '+2,00€', callback_data: 'addlimit:2.00' },
        { text: '+5,00€', callback_data: 'addlimit:5.00' },
      ]]
    );
  } catch (_) {}
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── DB ─────────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Anthropic ──────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callClaude(params, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (e) {
      const retryable = e.status === 529 ||
        (e.message && (e.message.includes('overloaded') || e.message.includes('529')));
      if (retryable && attempt < maxRetries) {
        // backoff: 3s, 6s, 12s, 24s, 48s
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 3000));
        continue;
      }
      throw e;
    }
  }
}

// Cost per token in EUR (approximate, based on USD/EUR 0.92)
const TOKEN_COST = {
  'claude-sonnet-4-6':        { in: 0.00000276, out: 0.0000138  },
  'claude-haiku-4-5-20251001':{ in: 0.00000023, out: 0.00000115 },
};
async function checkDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query('SELECT cost_eur, calls FROM daily_usage WHERE date=$1', [today]);
  return { today, cost: rows[0]?.cost_eur || 0, calls: rows[0]?.calls || 0 };
}

async function recordUsage(today, model, inputTokens, outputTokens) {
  const mc = TOKEN_COST[model] || TOKEN_COST['claude-sonnet-4-6'];
  const cost = inputTokens * mc.in + outputTokens * mc.out;
  const { rows } = await pool.query(`
    INSERT INTO daily_usage (date, cost_eur, calls, tokens_in, tokens_out)
    VALUES ($1, $2, 1, $3, $4)
    ON CONFLICT (date) DO UPDATE SET
      cost_eur   = daily_usage.cost_eur + $2,
      calls      = daily_usage.calls + 1,
      tokens_in  = daily_usage.tokens_in + $3,
      tokens_out = daily_usage.tokens_out + $4
    RETURNING cost_eur
  `, [today, cost, inputTokens, outputTokens]);
  return rows[0]?.cost_eur || 0;
}

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
app.use(express.static(path.join(__dirname, '../docs')));

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Sitzung abgelaufen – bitte neu anmelden' }); }
}

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  if (username.length < 3)  return res.status(400).json({ error: 'Benutzername mindestens 3 Zeichen' });
  if (password.length < 6)  return res.status(400).json({ error: 'Passwort mindestens 6 Zeichen' });
  const uname = username.trim().toLowerCase();
  try {
    // First user or ADMIN_USERNAME → auto-approved
    const { rows: existing } = await pool.query('SELECT COUNT(*) FROM users');
    const isFirst   = parseInt(existing[0].count) === 0;
    const isAdmin   = ADMIN_USER && uname === ADMIN_USER;
    const approved  = isFirst || isAdmin || !TG_TOKEN;
    const approvalToken = approved ? null : require('crypto').randomBytes(24).toString('hex');

    const isAdminUser = isFirst || isAdmin;
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, approved, approval_token, is_admin) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, approved, is_admin',
      [uname, hash, approved, approvalToken, isAdminUser]
    );

    if (!approved) {
      const userId = rows[0].id;
      await sendTelegramButtons(
        `🆕 <b>Neuer Registrierungsantrag</b>\n\n👤 Benutzername: <code>${uname}</code>\n📅 ${new Date().toLocaleString('de-DE')}`,
        [[
          { text: '✅ Freischalten', callback_data: `approve:${userId}` },
          { text: '❌ Ablehnen',    callback_data: `reject:${userId}` },
        ]]
      );
      return res.status(202).json({ pending: true, message: 'Dein Konto wartet auf Freischaltung durch den Admin.' });
    }

    const token = jwt.sign({ id: rows[0].id, username: rows[0].username, is_admin: rows[0].is_admin || false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: rows[0].username, is_admin: rows[0].is_admin || false });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/approval-status', async (req, res) => {
  const username = (req.query.username || '').toLowerCase().trim();
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const { rows } = await pool.query(
      'SELECT approved FROM users WHERE LOWER(username)=$1', [username]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ approved: rows[0].approved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/approve', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Ungültiger Link.');
  try {
    const { rows } = await pool.query(
      'UPDATE users SET approved=true, approval_token=NULL WHERE approval_token=$1 RETURNING username',
      [token]
    );
    if (!rows.length) return res.status(404).send('Link ungültig oder bereits verwendet.');
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h1>✅ Konto freigeschaltet</h1>
      <p>Der Benutzer <strong>${rows[0].username}</strong> kann sich jetzt anmelden.</p>
    </body></html>`);
  } catch (e) { res.status(500).send('Fehler: ' + e.message); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username.trim().toLowerCase()]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    if (!rows[0].approved)
      return res.status(403).json({ error: 'Dein Konto wurde noch nicht freigeschaltet. Bitte warte auf die Bestätigung.' });
    const token = jwt.sign({ id: rows[0].id, username: rows[0].username, is_admin: rows[0].is_admin || false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: rows[0].username, is_admin: rows[0].is_admin || false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
    res.json({ username: req.user.username, is_admin: rows[0]?.is_admin || false });
  } catch { res.json({ username: req.user.username, is_admin: req.user.is_admin || false }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUBJECTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.emoji, s.color, s.custom_prompt, s.created_at,
        COUNT(DISTINCT d.id)::int        AS doc_count,
        COUNT(DISTINCT qr.id)::int       AS quiz_count,
        ROUND(AVG(qr.score::float / NULLIF(qr.total,0) * 100))::int AS avg_score
      FROM subjects s
      LEFT JOIN documents   d  ON d.subject_id  = s.id
      LEFT JOIN quiz_results qr ON qr.subject_id = s.id
      WHERE s.user_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects', authMiddleware, async (req, res) => {
  const { id, name, emoji, color } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id und name erforderlich' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO subjects (id,name,emoji,color,user_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3,color=$4 RETURNING *`,
      [id, name, emoji || '📚', color || '#5856d6', req.user.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/subjects/:id', authMiddleware, async (req, res) => {
  const { custom_prompt } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE subjects SET custom_prompt=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [custom_prompt || '', req.params.id, req.user.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM subjects WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGES (chat history)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT role,content FROM messages WHERE subject_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/messages', authMiddleware, async (req, res) => {
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

app.delete('/api/subjects/:id/messages', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE subject_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/documents', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,filename,uploaded_at FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Accept pre-extracted text (from client-side PDF.js)
app.post('/api/subjects/:id/documents/text', authMiddleware, async (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'filename und content erforderlich' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO documents (subject_id,filename,content) VALUES ($1,$2,$3) RETURNING id,filename,uploaded_at',
      [req.params.id, filename, content]
    );
    // Auto-generate cards in background
    autoGenerateCards(req.params.id, filename, content).catch(e => console.error('Auto-cards:', e.message));
    res.json(rows[0]);
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

app.delete('/api/subjects/:id/documents/:docId', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM documents WHERE id=$1 AND subject_id=$2', [req.params.docId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE PROXY (hides API key)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/claude', claudeLimit, authMiddleware, async (req, res) => {
  const { messages, system, max_tokens, model } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  try {
    // Build system blocks array (preserves cache_control for prompt caching)
    let systemBlocks = Array.isArray(system)
      ? system
      : system ? [{ type: 'text', text: system }] : [];

    // RAG: inject relevant document context if subject_id provided
    if (req.body.subject_id) {
      const lastMsg = messages[messages.length - 1];
      const query = typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 300) : '';
      let docContext = '';

      if (query) {
        try {
          const { rows } = await pool.query(`
            SELECT filename,
                   ts_headline('german', content, plainto_tsquery('german', $1),
                     'MaxWords=80, MinWords=30, StartSel=, StopSel=') AS snippet
            FROM documents
            WHERE subject_id=$2 AND length(content) > 10
              AND to_tsvector('german', content) @@ plainto_tsquery('german', $1)
            ORDER BY ts_rank(to_tsvector('german', content), plainto_tsquery('german', $1)) DESC
            LIMIT 4
          `, [query, req.body.subject_id]);
          if (rows.length) docContext = rows.map(r => `[${r.filename}]\n${r.snippet}`).join('\n\n---\n\n');
        } catch {}
      }

      if (!docContext) {
        const { rows } = await pool.query(
          'SELECT filename, content FROM documents WHERE subject_id=$1', [req.body.subject_id]
        );
        if (rows.length) docContext = rows.map(r => `[${r.filename}]\n${r.content.slice(0, 4000)}`).join('\n\n---\n\n');
      }

      if (docContext) {
        systemBlocks = [...systemBlocks, { type: 'text', text: `Dokumenten-Kontext:\n${docContext}` }];
      }
    }

    // Limit messages to last 12 to control costs
    const trimmedMessages = messages.slice(-12);

    const params = {
      model: model || 'claude-sonnet-4-6',
      max_tokens: Math.min(max_tokens || 2000, 4096),
      messages: trimmedMessages,
    };
    if (systemBlocks.length) params.system = systemBlocks;

    // Daily limit check
    const { today, cost } = await checkDailyLimit();
    const dailyLimit = await getDailyLimit();
    if (cost >= dailyLimit) {
      return res.status(429).json({
        error: `Tageslimit erreicht (${cost.toFixed(2)}€ / ${dailyLimit.toFixed(2)}€). Morgen wieder verfügbar.`,
      });
    }

    const response = await callClaude(params);

    // Record usage then check 90% threshold (non-blocking)
    recordUsage(today, params.model,
      response.usage?.input_tokens || 0,
      response.usage?.output_tokens || 0,
    ).then(newCost => checkAndNotify90pct(today, newCost))
     .catch(e => console.error('Usage tracking error:', e.message));

    res.json(response);
  } catch (e) {
    console.error('Claude error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// OLLAMA PROXY (local model — free, for batch tasks)
// ═══════════════════════════════════════════════════════════════════════════
const OLLAMA_MODEL = 'llama3.1:8b';
const OLLAMA_URL   = 'http://localhost:11434/v1/chat/completions';

async function callOllama(messages, maxTokens = 2000) {
  const r = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, max_tokens: maxTokens, stream: false }),
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}`);
  const data = await r.json();
  return data.choices[0].message.content;
}

app.post('/api/local', authMiddleware, async (req, res) => {
  const { messages, system, max_tokens } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  try {
    const msgs = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages;
    const text = await callOllama(msgs, max_tokens || 2000);
    // Return same shape as Claude so frontend code is identical
    res.json({ content: [{ text }] });
  } catch (e) {
    console.error('Ollama error:', e.message);
    // Fallback to Claude if Ollama is down
    try {
      const params = { model: 'claude-haiku-4-5-20251001', max_tokens: max_tokens || 2000, messages };
      if (system) params.system = system;
      const response = await callClaude(params);
      res.json(response);
    } catch (e2) {
      res.status(500).json({ error: e.message });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLASHCARDS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/cards', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM flashcards WHERE subject_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/cards', authMiddleware, async (req, res) => {
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
app.get('/api/subjects/:id/quiz', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT score,total,taken_at FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/quiz', authMiddleware, async (req, res) => {
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
app.get('/api/streak', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT count,last_date FROM streak WHERE id=1');
    res.json(rows[0] || { count: 0, last_date: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/streak', authMiddleware, async (req, res) => {
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
app.get('/api/subjects/:id/glossar', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,term,definition FROM glossar WHERE subject_id=$1 ORDER BY term ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/glossar', authMiddleware, async (req, res) => {
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
app.get('/api/backup', authMiddleware, async (req, res) => {
  try {
    const subjects = (await pool.query('SELECT * FROM subjects WHERE user_id=$1 ORDER BY created_at', [req.user.id])).rows;
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

app.post('/api/restore', authMiddleware, async (req, res) => {
  const { subjects } = req.body;
  if (!Array.isArray(subjects)) return res.status(400).json({ error: 'Ungültiges Backup-Format' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of subjects) {
      await client.query(
        'INSERT INTO subjects (id,name,emoji,user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3,user_id=$4',
        [s.id, s.name, s.emoji || '📚', req.user.id]
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

// ── Auto-card generation (uses Ollama) ────────────────────────────────────
async function autoGenerateCards(subjectId, filename, content) {
  const truncated = content.slice(0, 8000);
  const text = await callOllama([{
    role: 'user',
    content: `Erstelle 12 Lernkarten (Frage/Antwort) aus diesem Text. Antworte NUR als JSON-Array ohne Erklärung:\n[{"front":"Frage?","back":"Antwort."},...]\n\nText:\n${truncated}`,
  }], 2000);
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return;
  const cards = JSON.parse(m[0]).filter(c => c.front && c.back);
  for (const c of cards) {
    await pool.query(
      'INSERT INTO flashcards (subject_id,front,back,ef,interval,repetitions,due) VALUES ($1,$2,$3,2.5,1,0,0)',
      [subjectId, c.front, c.back]
    );
  }
  console.log(`Auto-generated ${cards.length} cards from "${filename}" using Ollama`);
}

// ── Stats endpoint ─────────────────────────────────────────────────────────
app.get('/api/subjects/:id/stats', authMiddleware, async (req, res) => {
  const id = req.params.id;
  try {
    const [quizRes, cardsRes, docsRes, msgsRes] = await Promise.all([
      pool.query('SELECT score, total, taken_at FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at ASC', [id]),
      pool.query('SELECT COUNT(*) AS total, COUNT(CASE WHEN due < $2 THEN 1 END) AS due FROM flashcards WHERE subject_id=$1', [id, Date.now()]),
      pool.query('SELECT COUNT(*) AS count FROM documents WHERE subject_id=$1', [id]),
      pool.query('SELECT COUNT(*) AS count FROM messages WHERE subject_id=$1', [id]),
    ]);
    const questions = quizRes.rows;
    const avgScore = questions.length > 0
      ? Math.round(questions.reduce((a, q) => a + q.score / q.total, 0) / questions.length * 100)
      : 0;
    res.json({
      quizCount: questions.length,
      avgScore,
      quizHistory: questions.slice(-20).map(q => ({
        pct: Math.round(q.score / q.total * 100),
        date: q.taken_at,
      })),
      cardsTotal: parseInt(cardsRes.rows[0].total),
      cardsDue: parseInt(cardsRes.rows[0].due),
      docCount: parseInt(docsRes.rows[0].count),
      messageCount: parseInt(msgsRes.rows[0].count),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

app.get('/api/usage', authMiddleware, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      // Re-check from DB in case token is old
      const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
      if (!rows[0]?.is_admin) return res.json({ is_admin: false });
    }
    const limit = await getDailyLimit();
    const { cost, calls } = await checkDailyLimit();
    const last7 = (await pool.query(
      'SELECT date, cost_eur, calls FROM daily_usage ORDER BY date DESC LIMIT 7'
    )).rows;
    res.json({ today: { cost_eur: cost, calls }, limit_eur: limit, last7, is_admin: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: user management ─────────────────────────────────────────────────
async function requireAdmin(req, res) {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]?.is_admin) { res.status(403).json({ error: 'Nur für Admins' }); return false; }
  return true;
}

app.get('/api/admin/users', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows } = await pool.query(
      'SELECT id, username, approved, is_admin, approval_token IS NOT NULL AS pending, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/approve', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows } = await pool.query(
      'UPDATE users SET approved=true, approval_token=NULL WHERE id=$1 RETURNING username',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json({ ok: true, username: rows[0].username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:id/admin', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Eigenen Admin-Status nicht änderbar' });
  try {
    const { rows } = await pool.query(
      'UPDATE users SET is_admin=$1 WHERE id=$2 RETURNING username, is_admin',
      [req.body.is_admin, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json({ ok: true, username: rows[0].username, is_admin: rows[0].is_admin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
  try {
    const { rows } = await pool.query('DELETE FROM users WHERE id=$1 RETURNING username', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/set-limit', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Nur für Admins' });
  const val = parseFloat(req.body.limit);
  if (isNaN(val) || val <= 0) return res.status(400).json({ error: 'Ungültiger Wert' });
  try {
    await pool.query(
      "INSERT INTO settings (key,value) VALUES ('daily_limit_eur',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
      [val.toString()]
    );
    res.json({ ok: true, limit_eur: val });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallback ───────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../docs/index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Nachhilfe-Server läuft auf Port ${PORT}`);
  console.log(`Datenbank: ${process.env.DATABASE_URL ? 'konfiguriert' : 'FEHLT'}`);
  console.log(`API-Key: ${process.env.ANTHROPIC_API_KEY ? 'gesetzt' : 'FEHLT'}`);
  console.log(`Telegram: ${TG_TOKEN ? 'aktiv' : 'nicht konfiguriert'}`);

  // Start Telegram polling
  if (TG_TOKEN) {
    setTimeout(() => pollTelegram().catch(() => {}), 3000);
    setInterval(() => pollTelegram().catch(() => {}), 30000);
  }
});
