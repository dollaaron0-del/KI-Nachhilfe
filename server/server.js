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

const DEFAULT_JWT_SECRET = 'nachhilfe-secret-change-in-production';
const JWT_SECRET    = process.env.JWT_SECRET    || DEFAULT_JWT_SECRET;
// Fail-fast: NIE mit dem öffentlichen Default-Secret laufen. Damit könnte jeder
// beliebige (auch Admin-)Tokens fälschen → kompletter Auth-Bypass. Lieber gar
// nicht starten, damit die Lücke nicht still durch eine fehlende .env zurückkommt.
if (JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.error('FATAL: JWT_SECRET ist nicht gesetzt – Fallback auf das öffentliche Default-Secret.');
  console.error('Erzeuge eines mit `openssl rand -hex 48` und trage es als JWT_SECRET in server/.env ein.');
  process.exit(1);
}
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

// Hinter dem nginx-Reverse-Proxy steht die echte Client-IP in X-Forwarded-For.
// Ohne 'trust proxy' würde express-rate-limit alle Nutzer unter der Proxy-IP
// zusammenfassen → 30/min würde zum gemeinsamen Limit für alle. Erster Hop wird vertraut.
app.set('trust proxy', 1);

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

// Gibt eine Fehlermeldung zurück, wenn das globale ODER das persönliche
// Tagesbudget erschöpft ist – sonst null. Zentral, damit ALLE bezahlten
// Routen (auch /api/local* via Haiku) dieselbe Obergrenze durchsetzen.
const USER_DAILY_LIMIT = 1.0;
async function usageLimitError(userId) {
  const { today, cost } = await checkDailyLimit();
  const dailyLimit = await getDailyLimit();
  if (cost >= dailyLimit) {
    return `Tageslimit erreicht (${cost.toFixed(2)}€ / ${dailyLimit.toFixed(2)}€). Morgen wieder verfügbar.`;
  }
  try {
    const { rows } = await pool.query(
      'SELECT cost_eur FROM user_usage WHERE user_id=$1 AND date=$2', [userId, today]
    );
    if (parseFloat(rows[0]?.cost_eur || 0) >= USER_DAILY_LIMIT) {
      return `Dein persönliches Tageslimit (${USER_DAILY_LIMIT.toFixed(2)}€) ist aufgebraucht. Morgen wieder verfügbar.`;
    }
  } catch (_) {}
  return null;
}

async function recordUsage(today, model, inputTokens, outputTokens, userId = null, feature = null) {
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
  if (userId) {
    await pool.query(`
      INSERT INTO user_usage (user_id, date, cost_eur, calls)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (user_id, date) DO UPDATE SET
        cost_eur = user_usage.cost_eur + $3,
        calls    = user_usage.calls + 1
    `, [userId, today, cost]).catch(() => {});
  }
  if (feature) {
    await pool.query(`
      INSERT INTO feature_usage (feature, date, calls)
      VALUES ($1, $2, 1)
      ON CONFLICT (feature, date) DO UPDATE SET calls = feature_usage.calls + 1
    `, [feature, today]).catch(() => {});
  }
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
// Assets (app.js/style.css) sind per ?v=-Query versioniert → bei jeder Version
// neue URL, daher 30 Tage cachebar (Wiederbesuche/PWA-Reloads ohne Re-Download).
// index.html & sw.js dürfen NIE lange gecacht werden, sonst sieht der Nutzer
// neue ?v=-Bumps nicht und der Service Worker aktualisiert nicht.
app.use(express.static(path.join(__dirname, '../docs'), {
  maxAge: '30d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

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

// Verify the logged-in user owns the subject referenced by :id.
// Mounted on /api/subjects/:id so every sub-resource (messages, documents,
// cards, quiz, glossar, cheat, topics, aufgaben, klausuren, …) is isolated
// per user and one account can never read or modify another account's data.
async function assertOwnsSubject(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM subjects WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Fach nicht gefunden' });
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  if (username.length < 3)  return res.status(400).json({ error: 'Benutzername mindestens 3 Zeichen' });
  if (password.length < 6)  return res.status(400).json({ error: 'Passwort mindestens 6 Zeichen' });
  const uname = username.trim().toLowerCase();
  try {
    // First user or ADMIN_USERNAME → auto-approved; everyone else needs manual approval
    const { rows: existing } = await pool.query('SELECT COUNT(*) FROM users');
    const isFirst   = parseInt(existing[0].count) === 0;
    const isAdmin   = ADMIN_USER && uname === ADMIN_USER;
    const approved  = isFirst || isAdmin;
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

// Fester Demo-Account: legt bei Bedarf einen vorab freigeschalteten Demo-Benutzer
// an (ohne Telegram-Freischaltung) und gibt ein Token zurück. Alle Demo-Besucher
// teilen sich dasselbe Konto und damit dasselbe Demo-Fach. ON CONFLICT macht den
// Aufruf race-sicher, falls mehrere Besucher gleichzeitig zum ersten Mal klicken.
const DEMO_USERNAME = 'demo';
app.post('/api/auth/demo', async (req, res) => {
  try {
    const hash = await bcrypt.hash(require('crypto').randomBytes(18).toString('hex'), 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, approved, is_admin)
       VALUES ($1,$2,true,false) ON CONFLICT (username) DO NOTHING`,
      [DEMO_USERNAME, hash]
    );
    const { rows } = await pool.query('SELECT id, username FROM users WHERE username=$1', [DEMO_USERNAME]);
    const token = jwt.sign({ id: rows[0].id, username: rows[0].username, is_admin: false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: rows[0].username, is_admin: false });
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
    // Scope the upsert to the owner: ON CONFLICT only updates a row that already
    // belongs to this user. A subject id that exists for *another* user must not
    // be silently overwritten (cross-user data integrity).
    const { rows } = await pool.query(
      `INSERT INTO subjects (id,name,emoji,color,user_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3,color=$4
       WHERE subjects.user_id=$5 RETURNING *`,
      [id, name, emoji || '📚', color || '#5856d6', req.user.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'Fach-ID bereits vergeben' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// All /api/subjects/:id/* routes below require ownership of the subject.
app.use('/api/subjects/:id', authMiddleware, assertOwnsSubject);

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
    await Promise.all([
      pool.query('DELETE FROM cheat_sheets     WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM scanned_topics   WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM saved_aufgaben   WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM saved_klausuren  WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM learned_topics   WHERE subject_id=$1', [req.params.id]),
    ]);
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
    let rows;
    try {
      ({ rows } = await pool.query(
        'SELECT id,filename,doc_type,uploaded_at FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC',
        [req.params.id]
      ));
    } catch (e) {
      // Schema drift on an old prod DB (doc_type column missing): degrade
      // gracefully to the list without the tag instead of 500-ing.
      console.error('documents list without doc_type:', e.message);
      ({ rows } = await pool.query(
        'SELECT id,filename,NULL AS doc_type,uploaded_at FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC',
        [req.params.id]
      ));
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/subjects/:id/documents/:docId', authMiddleware, async (req, res) => {
  const { doc_type } = req.body;
  try {
    await pool.query(
      'UPDATE documents SET doc_type=$1 WHERE id=$2 AND subject_id=$3',
      [doc_type || null, req.params.docId, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Return short snippets of ALL documents for breadth-first topic scanning
app.get('/api/subjects/:id/documents/snippets', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT filename, LEFT(content, 600) AS snippet FROM documents WHERE subject_id=$1 ORDER BY uploaded_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Return content of documents filtered by doc_type (for exam-style context)
app.get('/api/subjects/:id/documents/typed', authMiddleware, async (req, res) => {
  const types = (req.query.types || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!types.length) return res.json([]);
  try {
    const placeholders = types.map((_, i) => `$${i + 2}`).join(',');
    const { rows } = await pool.query(
      `SELECT filename, doc_type, LEFT(content, 8000) AS content FROM documents WHERE subject_id=$1 AND doc_type IN (${placeholders}) ORDER BY uploaded_at DESC`,
      [req.params.id, ...types]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Accept pre-extracted text (from client-side PDF.js)
app.post('/api/subjects/:id/documents/text', authMiddleware, async (req, res) => {
  const { filename, content, skipCards } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'filename und content erforderlich' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO documents (subject_id,filename,content) VALUES ($1,$2,$3) RETURNING id,filename,uploaded_at',
      [req.params.id, filename, content]
    );
    // Auto-generate cards in background (skipCards: z. B. beim vorab geseedeten
    // Demo-Fach, das bereits fertige Karten mitbringt).
    if (!skipCards) {
      autoGenerateCards(req.params.id, filename, content).catch(e => console.error('Auto-cards:', e.message));
    }
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/documents', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  try {
    let content = '';
    if (req.file.mimetype === 'application/pdf') {
      // pdftotext asynchron (blockiert den Event-Loop nicht) und ohne Shell
      // (execFile mit Argument-Array → keine Shell-Injection über den Pfad).
      try {
        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const { stdout } = await promisify(execFile)('pdftotext', [req.file.path, '-'],
          { maxBuffer: 25 * 1024 * 1024, timeout: 30000 });
        content = stdout;
      } catch (err) {
        // pdftotext fehlt/scheitert → KEINE Base64-Rohdaten speichern; die würden
        // RAG-Kontext und Auto-Karten vergiften. Stattdessen ehrlich fehlschlagen.
        console.error('pdftotext failed:', err.message);
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(422).json({
          error: 'PDF konnte serverseitig nicht gelesen werden. Bitte lade die Datei erneut hoch – der Text wird dann direkt im Browser extrahiert.',
        });
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

    // RAG: inject relevant document context if subject_id provided.
    // Only for subjects the requesting user actually owns — otherwise the RAG
    // path could leak another user's documents into the response.
    let ownsSubject = false;
    if (req.body.subject_id) {
      const { rows } = await pool.query(
        'SELECT 1 FROM subjects WHERE id=$1 AND user_id=$2',
        [req.body.subject_id, req.user.id]
      );
      ownsSubject = rows.length > 0;
    }
    if (req.body.subject_id && ownsSubject) {
      const lastMsg = messages[messages.length - 1];
      const query = typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 300) : '';
      let docContext = '';

      const docLabel = r => {
        const types = { skript:'Vorlesungsskript', formelsammlung:'Formelsammlung', klausur:'Klausur', altklausur:'Altklausur', uebungsblatt:'Übungsblatt', zusammenfassung:'Zusammenfassung', lehrbuch:'Lehrbuch' };
        return r.doc_type && types[r.doc_type] ? `[${types[r.doc_type]}: ${r.filename}]` : `[${r.filename}]`;
      };

      if (query) {
        try {
          const { rows } = await pool.query(`
            SELECT filename, doc_type,
                   ts_headline('german', content, plainto_tsquery('german', $1),
                     'MaxWords=80, MinWords=30, StartSel=, StopSel=') AS snippet
            FROM documents
            WHERE subject_id=$2 AND length(content) > 10
              AND to_tsvector('german', content) @@ plainto_tsquery('german', $1)
            ORDER BY ts_rank(to_tsvector('german', content), plainto_tsquery('german', $1)) DESC
            LIMIT 4
          `, [query, req.body.subject_id]);
          if (rows.length) docContext = rows.map(r => `${docLabel(r)}\n${r.snippet}`).join('\n\n---\n\n');
        } catch {}
      }

      if (!docContext) {
        // Bounded fallback when full-text search finds nothing: cap at the 4 most
        // recent documents so subjects with many uploads can't blow up token cost.
        // Wrapped in try/catch so a DB without the doc_type column (schema drift on
        // an old prod DB) degrades to "no context" instead of 500-ing the chat.
        try {
          const { rows } = await pool.query(
            'SELECT filename, doc_type, content FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC LIMIT 4', [req.body.subject_id]
          );
          if (rows.length) docContext = rows.map(r => `${docLabel(r)}\n${r.content.slice(0, 4000)}`).join('\n\n---\n\n');
        } catch (e) { console.error('RAG fallback skipped:', e.message); }
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

    // Daily + per-user limit check (shared helper)
    const limitMsg = await usageLimitError(req.user.id);
    if (limitMsg) return res.status(429).json({ error: limitMsg });
    const today = new Date().toISOString().slice(0, 10);

    const response = await callClaude(params);
    const feature = req.body.feature || null;

    // Record usage then check 90% threshold (non-blocking)
    recordUsage(today, params.model,
      response.usage?.input_tokens || 0,
      response.usage?.output_tokens || 0,
      req.user.id, feature,
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
const OLLAMA_MODEL        = process.env.OLLAMA_MODEL        || 'phi4:14b';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava:7b';
const OLLAMA_URL          = 'http://localhost:11434/v1/chat/completions';

// Local-model toggle. Default OFF: the local model (phi4:14b) exceeded its 60s
// budget on CPU hardware and only wasted time before falling back to Haiku, so
// /api/local + /api/local/stream go straight to Claude Haiku — fast & reliable
// for live use. Set USE_OLLAMA=true to re-enable the free local model (e.g. on
// GPU hardware). Vision (/api/local/vision) is unaffected and still uses Ollama.
const USE_OLLAMA = process.env.USE_OLLAMA === 'true';

function ollamaMsgs(system, messages) {
  const sysText = Array.isArray(system)
    ? system.map(b => b.text || '').join('\n')
    : (system || '');
  return sysText ? [{ role: 'system', content: sysText }, ...messages] : messages;
}

async function callOllama(messages, maxTokens = 2000, jsonMode = false) {
  const body = {
    model: OLLAMA_MODEL, messages, max_tokens: maxTokens,
    stream: false, options: { num_ctx: 16384 },
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const r = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`Ollama error ${r.status}`);
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Ollama returned unexpected response shape');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Routes a batch completion to the local model or straight to Claude Haiku,
// honoring USE_OLLAMA. Use this for background/server-side tasks (not the
// request handlers, which record per-user usage themselves).
async function localComplete(messages, maxTokens = 2000, jsonMode = false) {
  if (USE_OLLAMA) return callOllama(messages, maxTokens, jsonMode);
  const r = await callClaude({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages });
  const text = r.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Haiku returned unexpected response shape');
  return text;
}

app.post('/api/local', claudeLimit, authMiddleware, async (req, res) => {
  const { messages, system, max_tokens, json_mode, feature } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  const callHaiku = async () => {
    const params = { model: 'claude-haiku-4-5-20251001', max_tokens: max_tokens || 2000, messages };
    if (system) params.system = system;
    const r = await callClaude(params);
    const haikuText = r.content?.[0]?.text;
    if (typeof haikuText !== 'string') throw new Error('Haiku returned unexpected response shape');
    return { text: haikuText, usage: r.usage || {} };
  };
  try {
    // Local model disabled → answer directly with Haiku (fast, reliable).
    if (!USE_OLLAMA) {
      // Haiku ist kostenpflichtig → gleiche Budget-Obergrenze wie /api/claude.
      const limitMsg = await usageLimitError(req.user.id);
      if (limitMsg) return res.status(429).json({ error: limitMsg });
      const { text: haikuText, usage } = await callHaiku();
      const todayH = new Date().toISOString().slice(0, 10);
      recordUsage(todayH, 'claude-haiku-4-5-20251001', usage.input_tokens || 0, usage.output_tokens || 0, req.user.id, feature).catch(() => {});
      return res.json({ content: [{ text: haikuText }] });
    }
    const text = await callOllama(ollamaMsgs(system, messages), max_tokens || 2000, !!json_mode);
    // When json_mode was requested, verify Ollama returned *valid* parseable JSON.
    // Regex alone is not enough — models often produce { } with literal newlines
    // inside strings that break JSON.parse.  Fall back to Haiku for any failure.
    if (json_mode) {
      const repair = s => {
        let inStr = false, esc = false, out = '';
        for (const c of s) {
          if (esc)        { out += c; esc = false; continue; }
          if (c === '\\') { out += c; esc = true;  continue; }
          if (c === '"')  { out += c; inStr = !inStr; continue; }
          if (inStr && c === '\n') { out += '\\n'; continue; }
          if (inStr && c === '\r') { out += '\\r'; continue; }
          out += c;
        }
        return out;
      };
      const m = text.match(/\{[\s\S]*\}/);
      let jsonOk = false;
      if (m) { try { JSON.parse(m[0]); jsonOk = true; } catch { try { JSON.parse(repair(m[0])); jsonOk = true; } catch {} } }
      if (!jsonOk) {
        console.warn('Ollama returned invalid/no JSON in json_mode – falling back to Haiku');
        const { text: haikuText, usage } = await callHaiku();
        const today2 = new Date().toISOString().slice(0, 10);
        recordUsage(today2, 'claude-haiku-4-5-20251001', usage.input_tokens || 0, usage.output_tokens || 0, req.user.id, feature).catch(() => {});
        return res.json({ content: [{ text: haikuText }] });
      }
    }
    res.json({ content: [{ text }] });
  } catch (e) {
    console.error('Ollama error:', e.message);
    try {
      const { text: haikuText, usage } = await callHaiku();
      const today3 = new Date().toISOString().slice(0, 10);
      recordUsage(today3, 'claude-haiku-4-5-20251001', usage.input_tokens || 0, usage.output_tokens || 0, req.user.id, feature).catch(() => {});
      res.json({ content: [{ text: haikuText }] });
    } catch (e2) {
      console.error('Haiku fallback also failed:', e2.message);
      res.status(500).json({ error: `Ollama: ${e.message} | Haiku: ${e2.message}` });
    }
  }
});

app.post('/api/local/stream', claudeLimit, authMiddleware, async (req, res) => {
  const { messages, system, max_tokens } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  // Budget-Check VOR den SSE-Headern, damit ein 429 als normaler JSON-Fehler ankommt.
  if (!USE_OLLAMA) {
    const limitMsg = await usageLimitError(req.user.id);
    if (limitMsg) return res.status(429).json({ error: limitMsg });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    // Local model disabled → stream tokens directly from Claude Haiku.
    if (!USE_OLLAMA) {
      const params = { model: 'claude-haiku-4-5-20251001', max_tokens: max_tokens || 3000, messages };
      if (system) params.system = system;
      const stream = anthropic.messages.stream(params);
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          res.write(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`);
        }
      }
      const finalMsg = await stream.finalMessage();
      const u = finalMsg.usage || {};
      recordUsage(new Date().toISOString().slice(0, 10), 'claude-haiku-4-5-20251001', u.input_tokens || 0, u.output_tokens || 0, req.user.id, null).catch(() => {});
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    const r = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL, messages: ollamaMsgs(system, messages),
        max_tokens: max_tokens || 3000, stream: true, options: { num_ctx: 16384 },
      }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Keep the trailing (possibly incomplete) line in the buffer for the next chunk.
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (d === '[DONE]') continue;
        try {
          const token = JSON.parse(d).choices?.[0]?.delta?.content || '';
          if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
        } catch {}
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

app.post('/api/local/vision', authMiddleware, async (req, res) => {
  const { base64, text, system, max_tokens = 1500 } = req.body;
  if (!base64 || !text) return res.status(400).json({ error: 'base64 und text erforderlich' });
  const sysText = Array.isArray(system) ? system.map(b => b.text || '').join('\n') : (system || '');
  // Use Ollama native /api/chat format — more reliable for vision models than /v1/
  const messages = [
    ...(sysText ? [{ role: 'system', content: sysText }] : []),
    { role: 'user', content: text, images: [base64] },
  ];
  try {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_VISION_MODEL, messages, stream: false }),
    });
    if (!r.ok) throw new Error(`Ollama vision ${r.status}: ${await r.text()}`);
    const data = await r.json();
    res.json({ content: [{ text: data.message.content }] });
  } catch (e) {
    console.error('Ollama vision error:', e.message);
    res.status(503).json({ error: e.message });
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
    const { rows } = await pool.query('SELECT count,last_date FROM user_streaks WHERE user_id=$1', [req.user.id]);
    res.json(rows[0] || { count: 0, last_date: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/streak', authMiddleware, async (req, res) => {
  const { count, last_date } = req.body;
  try {
    await pool.query(
      `INSERT INTO user_streaks (user_id, count, last_date) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET count=$2, last_date=$3`,
      [req.user.id, count, last_date]
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
      const messages  = (await pool.query('SELECT role,content FROM messages WHERE subject_id=$1 ORDER BY created_at', [s.id])).rows;
      const cards     = (await pool.query('SELECT front,back,ef,interval,repetitions,due FROM flashcards WHERE subject_id=$1', [s.id])).rows;
      const quiz      = (await pool.query('SELECT score,total FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at', [s.id])).rows;
      const glossar   = (await pool.query('SELECT term,definition FROM glossar WHERE subject_id=$1', [s.id])).rows;
      const cheat     = (await pool.query('SELECT content FROM cheat_sheets WHERE subject_id=$1', [s.id])).rows[0]?.content || null;
      const topics    = (await pool.query('SELECT topics FROM scanned_topics WHERE subject_id=$1', [s.id])).rows[0]?.topics || [];
      const aufgaben  = (await pool.query('SELECT id,topic,type,tasks_part,full_result,created_at FROM saved_aufgaben WHERE subject_id=$1 ORDER BY created_at', [s.id])).rows;
      const klausuren = (await pool.query('SELECT id,diff,content,created_at FROM saved_klausuren WHERE subject_id=$1 ORDER BY created_at', [s.id])).rows;
      backup.subjects.push({ ...s, messages, cards, quiz, glossar, cheat, topics, aufgaben, klausuren });
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
      // Only insert a new subject or update one already owned by this user.
      // Never seize a subject id that belongs to another account (the old
      // ON CONFLICT … SET user_id=$4 let a crafted backup steal ownership).
      const { rows: own } = await client.query(
        `INSERT INTO subjects (id,name,emoji,user_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3
         WHERE subjects.user_id=$4 RETURNING id`,
        [s.id, s.name, s.emoji || '📚', req.user.id]
      );
      if (!own.length) continue;  // id belongs to someone else → skip its data
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
      if (s.cheat) {
        await client.query(
          `INSERT INTO cheat_sheets (subject_id, content, updated_at) VALUES ($1,$2,now())
           ON CONFLICT (subject_id) DO UPDATE SET content=$2, updated_at=now()`,
          [s.id, s.cheat]
        );
      }
      if (s.topics?.length) {
        await client.query(
          `INSERT INTO scanned_topics (subject_id, topics, updated_at) VALUES ($1,$2,now())
           ON CONFLICT (subject_id) DO UPDATE SET topics=$2, updated_at=now()`,
          [s.id, JSON.stringify(s.topics)]
        );
      }
      if (s.aufgaben?.length) {
        await client.query('DELETE FROM saved_aufgaben WHERE subject_id=$1', [s.id]);
        for (const a of s.aufgaben) {
          await client.query(
            'INSERT INTO saved_aufgaben (id,subject_id,topic,type,tasks_part,full_result,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [a.id, s.id, a.topic||'', a.type||'uebung', a.tasks_part||'', a.full_result||'', a.created_at||new Date()]
          );
        }
      }
      if (s.klausuren?.length) {
        await client.query('DELETE FROM saved_klausuren WHERE subject_id=$1', [s.id]);
        for (const k of s.klausuren) {
          await client.query(
            'INSERT INTO saved_klausuren (id,subject_id,diff,content,created_at) VALUES ($1,$2,$3,$4,$5)',
            [k.id, s.id, k.diff||'mittel', k.content||'', k.created_at||new Date()]
          );
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

// ── Auto-card generation (local model or Haiku, per USE_OLLAMA) ───────────
async function autoGenerateCards(subjectId, filename, content) {
  const truncated = content.slice(0, 8000);
  const text = await localComplete([{
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
  console.log(`Auto-generated ${cards.length} cards from "${filename}" using ${USE_OLLAMA ? 'Ollama' : 'Haiku'}`);
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

// ── User: own daily usage ──────────────────────────────────────────────────
app.get('/api/my-usage', authMiddleware, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(
      'SELECT cost_eur, calls FROM user_usage WHERE user_id=$1 AND date=$2',
      [req.user.id, today]
    );
    res.json({ cost_eur: parseFloat(rows[0]?.cost_eur || 0), calls: rows[0]?.calls || 0, limit: 1.0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: pending user count ──────────────────────────────────────────────
app.get('/api/admin/pending-count', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE approved=false');
    res.json({ count: rows[0].count });
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

// ═══════════════════════════════════════════════════════════════════════════
// CHEAT SHEETS (Zusammenfassungen)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/cheat', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT content FROM cheat_sheets WHERE subject_id=$1', [req.params.id]);
    res.json({ content: rows[0]?.content || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/cheat', authMiddleware, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content erforderlich' });
  try {
    await pool.query(
      `INSERT INTO cheat_sheets (subject_id, content, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (subject_id) DO UPDATE SET content=$2, updated_at=now()`,
      [req.params.id, content]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/cheat', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM cheat_sheets WHERE subject_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SCANNED TOPICS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/topics', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT topics FROM scanned_topics WHERE subject_id=$1', [req.params.id]);
    res.json(rows[0]?.topics || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/topics', authMiddleware, async (req, res) => {
  const { topics } = req.body;
  if (!Array.isArray(topics)) return res.status(400).json({ error: 'topics array erforderlich' });
  try {
    await pool.query(
      `INSERT INTO scanned_topics (subject_id, topics, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (subject_id) DO UPDATE SET topics=$2, updated_at=now()`,
      [req.params.id, JSON.stringify(topics)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/topics', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM scanned_topics WHERE subject_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Module structure (Kapitel + Lernziele), stored alongside flat topics
app.get('/api/subjects/:id/structure', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT structure FROM scanned_topics WHERE subject_id=$1', [req.params.id]);
    res.json(rows[0]?.structure || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/structure', authMiddleware, async (req, res) => {
  const { structure, topics } = req.body;
  if (!structure || !Array.isArray(topics)) return res.status(400).json({ error: 'structure und topics erforderlich' });
  try {
    await pool.query(
      `INSERT INTO scanned_topics (subject_id, topics, structure, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (subject_id) DO UPDATE SET topics=$2, structure=$3, updated_at=now()`,
      [req.params.id, JSON.stringify(topics), JSON.stringify(structure)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SAVED AUFGABEN
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/aufgaben', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, topic, type, tasks_part, full_result, created_at FROM saved_aufgaben WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    );
    res.json(rows.map(r => ({
      id: r.id, topic: r.topic, type: r.type,
      tasksPart: r.tasks_part, fullResult: r.full_result, createdAt: r.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/aufgaben', authMiddleware, async (req, res) => {
  const { id, topic, type, tasksPart, fullResult, createdAt } = req.body;
  if (!id || !fullResult) return res.status(400).json({ error: 'id und fullResult erforderlich' });
  try {
    await pool.query(
      `INSERT INTO saved_aufgaben (id, subject_id, topic, type, tasks_part, full_result, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id.toString(), req.params.id, topic || '', type || 'uebung', tasksPart || '', fullResult, createdAt || new Date().toISOString()]
    );
    await pool.query(
      `DELETE FROM saved_aufgaben WHERE subject_id=$1 AND id NOT IN (
        SELECT id FROM saved_aufgaben WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 20
      )`, [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/aufgaben/:aufgId', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM saved_aufgaben WHERE id=$1 AND subject_id=$2', [req.params.aufgId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SAVED KLAUSUREN (Probeklausuren aus dem Klausur-Tab)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/klausuren', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, diff, content, created_at FROM saved_klausuren WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 10',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/klausuren', authMiddleware, async (req, res) => {
  const { id, diff, content } = req.body;
  if (!id || !content) return res.status(400).json({ error: 'id und content erforderlich' });
  try {
    await pool.query(
      `INSERT INTO saved_klausuren (id, subject_id, diff, content) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [id.toString(), req.params.id, diff || 'mittel', content]
    );
    await pool.query(
      `DELETE FROM saved_klausuren WHERE subject_id=$1 AND id NOT IN (
        SELECT id FROM saved_klausuren WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 10
      )`, [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/klausuren/:klId', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM saved_klausuren WHERE id=$1 AND subject_id=$2', [req.params.klId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEARNED TOPICS (Lernpfad progress per user)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/learned-topics', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT topic FROM learned_topics WHERE subject_id=$1 AND user_id=$2 ORDER BY learned_at ASC',
      [req.params.id, req.user.id]
    );
    res.json(rows.map(r => r.topic));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/learned-topics', authMiddleware, async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic erforderlich' });
  try {
    await pool.query(
      'INSERT INTO learned_topics(subject_id,user_id,topic) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, req.user.id, topic]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/learned-topics/:topic', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM learned_topics WHERE subject_id=$1 AND user_id=$2 AND topic=$3',
      [req.params.id, req.user.id, decodeURIComponent(req.params.topic)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: per-user stats ──────────────────────────────────────────────────
app.get('/api/admin/user-stats', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.approved,
        COALESCE(ud.cost_eur, 0)::float   AS today_cost,
        COALESCE(ud.calls, 0)::int         AS today_calls,
        COALESCE(ut.total_cost, 0)::float  AS total_cost,
        COALESCE(ut.total_calls, 0)::int   AS total_calls
      FROM users u
      LEFT JOIN user_usage ud ON ud.user_id = u.id AND ud.date = $1
      LEFT JOIN (
        SELECT user_id, SUM(cost_eur)::float AS total_cost, SUM(calls)::int AS total_calls
        FROM user_usage GROUP BY user_id
      ) ut ON ut.user_id = u.id
      ORDER BY today_cost DESC, u.username ASC
    `, [today]);
    res.json({ users: rows, limit: 1.0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: anonymous analytics ─────────────────────────────────────────────
app.get('/api/admin/analytics', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows: features } = await pool.query(`
      SELECT feature,
        SUM(calls)::int AS total,
        SUM(CASE WHEN date = CURRENT_DATE THEN calls ELSE 0 END)::int AS today,
        SUM(CASE WHEN date >= CURRENT_DATE - 6 THEN calls ELSE 0 END)::int AS week
      FROM feature_usage
      GROUP BY feature ORDER BY total DESC
    `);
    const { rows: dau } = await pool.query(`
      SELECT date::text, COUNT(DISTINCT user_id)::int AS users
      FROM user_usage WHERE calls > 0
      GROUP BY date ORDER BY date DESC LIMIT 14
    `);
    const { rows: costs } = await pool.query(`
      SELECT date::text, cost_eur::float, calls::int
      FROM daily_usage ORDER BY date DESC LIMIT 14
    `);
    res.json({ features, dau, costs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallback (must stay AFTER all /api routes) ──────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../docs/index.html'));
});

// ── DB Table Init ──────────────────────────────────────────────────────────
async function initTables() {
  // Self-healing column migrations for tables created before these columns
  // existed (CREATE TABLE IF NOT EXISTS never adds columns to an existing table).
  // Each runs in its own statement + try/catch so a missing-ownership error
  // (app user is not the table owner) only logs and never aborts the inits below.
  const columnMigrations = [
    'ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type TEXT;',
    'ALTER TABLE scanned_topics ADD COLUMN IF NOT EXISTS structure JSONB;',
  ];
  for (const sql of columnMigrations) {
    try {
      await pool.query(sql);
    } catch (e) {
      console.error('Column migration skipped:', sql, '-', e.message);
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cheat_sheets (
      subject_id TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS scanned_topics (
      subject_id TEXT PRIMARY KEY,
      topics     JSONB NOT NULL,
      structure  JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS saved_aufgaben (
      id          TEXT PRIMARY KEY,
      subject_id  TEXT NOT NULL,
      topic       TEXT,
      type        TEXT,
      tasks_part  TEXT,
      full_result TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_saved_aufgaben_subject ON saved_aufgaben(subject_id);
    CREATE TABLE IF NOT EXISTS saved_klausuren (
      id          TEXT PRIMARY KEY,
      subject_id  TEXT NOT NULL,
      diff        TEXT,
      content     TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_saved_klausuren_subject ON saved_klausuren(subject_id);
    CREATE TABLE IF NOT EXISTS user_streaks (
      user_id   INTEGER PRIMARY KEY,
      count     INTEGER DEFAULT 0,
      last_date TEXT
    );
    CREATE TABLE IF NOT EXISTS learned_topics (
      subject_id TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      topic      TEXT NOT NULL,
      learned_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (subject_id, user_id, topic)
    );
    CREATE TABLE IF NOT EXISTS user_usage (
      user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date     DATE NOT NULL,
      cost_eur DECIMAL(10,6) DEFAULT 0,
      calls    INTEGER DEFAULT 0,
      PRIMARY KEY(user_id, date)
    );
    CREATE TABLE IF NOT EXISTS feature_usage (
      feature  VARCHAR(50) NOT NULL,
      date     DATE NOT NULL,
      calls    INTEGER DEFAULT 0,
      PRIMARY KEY(feature, date)
    );
  `);
}
initTables().catch(e => console.error('Table init error:', e.message));

// Prevent unhandled promise rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ── Start ──────────────────────────────────────────────────────────────────
// Nur auf Loopback lauschen: nginx proxied ohnehin an 127.0.0.1:3000. So ist das
// Backend nicht direkt aus dem Netz erreichbar (kein Vorbeischleichen an nginx,
// Rate-Limit & Security-Headern).
app.listen(PORT, '127.0.0.1', () => {
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
