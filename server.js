import express from 'express'
import pg from 'pg'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')
const HOST = 'tennisapi1.p.rapidapi.com'
const FETCH_INTERVAL = 15 * 60 * 1000 // 15 minutes

// ─── Config & Database ───────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const rawRetentionDays = parseInt(process.env.EVENT_RETENTION_DAYS || '7', 10)
const EVENT_RETENTION_DAYS = Number.isFinite(rawRetentionDays) && rawRetentionDays > 0
  ? Math.min(rawRetentionDays, 90)
  : 7

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
})

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id              INTEGER PRIMARY KEY,
      start_timestamp INTEGER NOT NULL,
      status_code     INTEGER,
      status_type     TEXT,
      status_desc     TEXT,
      home_team_id    INTEGER,
      home_team_name  TEXT,
      home_team_short TEXT,
      home_country    TEXT,
      away_team_id    INTEGER,
      away_team_name  TEXT,
      away_team_short TEXT,
      away_country    TEXT,
      tournament_name TEXT,
      category_name   TEXT,
      tennis_points   INTEGER,
      season_name     TEXT,
      round_number    INTEGER,
      round_name      TEXT,
      winner_code     INTEGER,
      ground_type     TEXT,
      home_score      JSONB,
      away_score      JSONB,
      raw_json        JSONB,
      updated_at      INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_timestamp)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_home ON events(home_team_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_away ON events(away_team_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      short_name TEXT,
      country    TEXT,
      seen_at    INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_name ON players(LOWER(name))`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      favourites  JSONB DEFAULT '[]',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS magic_links (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      token       TEXT UNIQUE NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token)`)

  console.log('Database tables ready')
}

// ─── Calendar Fetch ──────────────────────────────────────────────────────────

async function fetchCalendar() {
  if (!RAPIDAPI_KEY) return
  console.log('Fetching events from TennisAPI...')

  try {
    const normalizeEventsResponse = (data) => {
      if (!data) return []
      if (Array.isArray(data)) return data
      if (Array.isArray(data.events)) return data.events
      if (data.data && Array.isArray(data.data.events)) return data.data.events
      return []
    }

    const fetchEventsForDate = async (d) => {
      const day = d.getDate()
      const month = d.getMonth() + 1
      const year = d.getFullYear()

      const res = await fetch(`https://${HOST}/api/tennis/events/${day}/${month}/${year}`, {
        headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': RAPIDAPI_KEY },
      })

      let data = null
      try {
        data = await res.json()
      } catch {
        // non-JSON response; leave data as null
      }

      if (!res.ok) {
        const msg = data?.message || data?.error || `HTTP ${res.status}`
        console.log(msg);
        return {
          ok: false,
          status: res.status,
          message: `Events endpoint failed for ${day}/${month}/${year}: ${msg}`,
          events: [],
        }
      }

      if (data?.message) {
        console.log(data.message);
        return {
          ok: false,
          status: 502,
          message: `Events endpoint error for ${day}/${month}/${year}: ${data.message}`,
          events: [],
        }
      }
      console.log(`${data.length} matches found`);
      return {
        ok: true,
        status: res.status,
        message: null,
        events: normalizeEventsResponse(data),
      }
    }

    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Today + next 3 days (4 days total)
    let all = []
    for (let i = 0; i <= 3; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const result = await fetchEventsForDate(d)
      if (!result.ok) {
        // Keep this quiet: a single-line warning with no stack trace.
        console.warn(`Calendar fetch skipped: ${result.message}`)

        // If rate-limited, stop trying further days.
        if (result.status === 429) break
        continue
      }
      all = all.concat(result.events)
    }

    // Upsert events
    let eventCount = 0
    for (const e of all) {
      if (!e?.id) continue

      const startTs = Number.isFinite(e.startTimestamp) ? Math.floor(e.startTimestamp) : null
      if (!startTs) continue

      try {
        await pool.query(`
        INSERT INTO events (id, start_timestamp, status_code, status_type, status_desc,
          home_team_id, home_team_name, home_team_short, home_country,
          away_team_id, away_team_name, away_team_short, away_country,
          tournament_name, category_name, tennis_points, season_name,
          round_number, round_name, winner_code, ground_type,
          home_score, away_score, raw_json, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
          EXTRACT(EPOCH FROM NOW())::INTEGER)
        ON CONFLICT (id) DO UPDATE SET
          start_timestamp=$2, status_code=$3, status_type=$4, status_desc=$5,
          home_team_id=$6, home_team_name=$7, home_team_short=$8, home_country=$9,
          away_team_id=$10, away_team_name=$11, away_team_short=$12, away_country=$13,
          tournament_name=$14, category_name=$15, tennis_points=$16, season_name=$17,
          round_number=$18, round_name=$19, winner_code=$20, ground_type=$21,
          home_score=$22, away_score=$23, raw_json=$24,
          updated_at=EXTRACT(EPOCH FROM NOW())::INTEGER
      `, [
          e.id,
          startTs,
          e.status?.code ?? null,
          e.status?.type ?? null,
          e.status?.description ?? null,
          e.homeTeam?.id ?? null,
          e.homeTeam?.name ?? null,
          e.homeTeam?.shortName ?? null,
          e.homeTeam?.country?.name ?? null,
          e.awayTeam?.id ?? null,
          e.awayTeam?.name ?? null,
          e.awayTeam?.shortName ?? null,
          e.awayTeam?.country?.name ?? null,
          e.tournament?.name ?? null,
          e.tournament?.category?.name ?? null,
          e.tournament?.uniqueTournament?.tennisPoints ?? null,
          e.season?.name ?? null,
          e.roundInfo?.round ?? null,
          e.roundInfo?.name ?? null,
          e.winnerCode ?? null,
          e.groundType ?? e.tournament?.uniqueTournament?.groundType ?? null,
          JSON.stringify(e.homeScore || {}),
          JSON.stringify(e.awayScore || {}),
          JSON.stringify(e),
        ])
        eventCount++

        // Upsert players from home/away teams
        for (const team of [e.homeTeam, e.awayTeam]) {
          if (!team?.id) continue
          await pool.query(`
          INSERT INTO players (id, name, short_name, country, seen_at)
          VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::INTEGER)
          ON CONFLICT (id) DO UPDATE SET
            name=$2, short_name=$3, country=$4, seen_at=EXTRACT(EPOCH FROM NOW())::INTEGER
        `, [team.id, team.name || '', team.shortName || null, team.country?.name || null])
        }
      } catch (err) {
        console.error('Failed to upsert event or players for id', e.id, err)
      }
    }

    // Cleanup old events (based on configurable retention)
    const nowTs = Math.floor(Date.now() / 1000)
    const cutoff = nowTs - EVENT_RETENTION_DAYS * 86400
    const { rowCount } = await pool.query(
      'DELETE FROM events WHERE start_timestamp < $1 AND start_timestamp > 0',
      [cutoff]
    )

    console.log(
      `Fetched ${eventCount} events, cleaned ${rowCount} old events (retention ${EVENT_RETENTION_DAYS} days)`
    )
  } catch (err) {
    console.warn('Calendar fetch skipped:', err?.message || String(err))
  }
}

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

const AUTH_ENABLED = !!JWT_SECRET

// NOTE: Gmail-based magic-link auth is temporarily disabled in favour of
// a simple hard-coded email/password check for local development.
const COOKIE_NAME = 'baseline_token'
const JWT_EXPIRY = '30d'
const MAGIC_LINK_EXPIRY_MINUTES = 15

function parseCookies(req) {
  const header = req.headers.cookie || ''
  const cookies = {}
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=')
    if (k) cookies[k] = decodeURIComponent(v.join('='))
  }
  return cookies
}

function authMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return res.status(501).json({ error: 'Auth not configured' })
  const token = parseCookies(req)[COOKIE_NAME]
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' })
  }
}

function setAuthCookie(res, userId, email) {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY })
  const maxAge = 30 * 24 * 60 * 60 // 30 days in seconds
  const secure = APP_URL.startsWith('https')
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`
  )
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  )
}

// ─── Auth Endpoints ───────────────────────────────────────────────────────────

app.use(express.json())

// Simple email-only login (temporary dev auth)
app.post('/api/auth/login', async (req, res) => {
  if (!AUTH_ENABLED) return res.status(501).json({ error: 'Auth not configured' })

  const email = (req.body.email || '').trim().toLowerCase()

  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  // Temporary hard-coded email for local login
  const DEV_EMAIL = 'rowden.dan@gmail.com'

  if (email !== DEV_EMAIL) {
    return res.status(401).json({ error: 'Invalid email' })
  }

  try {
    // Ensure user exists
    const { rows } = await pool.query(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email]
    )
    const userId = rows[0].id

    // Issue JWT session cookie directly on successful password auth
    setAuthCookie(res, userId, email)

    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/auth/login error:', err)
    res.status(500).json({ error: 'Something went wrong' })
  }
})

// Verify magic link token
app.get('/api/auth/verify', async (req, res) => {
  if (!AUTH_ENABLED) return res.status(501).send('Auth not configured')

  const token = (req.query.token || '').trim()
  if (!token) return res.status(400).send('Missing token')

  try {
    const { rows } = await pool.query(
      `SELECT ml.id, ml.user_id, u.email
       FROM magic_links ml JOIN users u ON u.id = ml.user_id
       WHERE ml.token = $1 AND ml.used_at IS NULL AND ml.expires_at > NOW()`,
      [token]
    )

    if (rows.length === 0) return res.status(400).send('Invalid or expired link')

    const { id: linkId, user_id: userId, email } = rows[0]

    // Mark as used
    await pool.query(`UPDATE magic_links SET used_at = NOW() WHERE id = $1`, [linkId])

    // Set session cookie
    setAuthCookie(res, userId, email)

    // Redirect to app
    res.redirect('/')
  } catch (err) {
    console.error('GET /api/auth/verify error:', err)
    res.status(500).send('Something went wrong')
  }
})

// Get current user
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT email, favourites FROM users WHERE id = $1',
      [req.user.userId]
    )
    if (rows.length === 0) return res.status(401).json({ error: 'User not found' })
    res.json({ email: rows[0].email, favourites: rows[0].favourites || [] })
  } catch (err) {
    console.error('GET /api/auth/me error:', err)
    res.status(500).json({ error: 'Failed to load user' })
  }
})

// Logout
app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

// Save favourites
app.put('/api/favourites', authMiddleware, async (req, res) => {
  const favourites = req.body.favourites
  if (!Array.isArray(favourites)) return res.status(400).json({ error: 'favourites must be an array' })

  try {
    await pool.query(
      'UPDATE users SET favourites = $1 WHERE id = $2',
      [JSON.stringify(favourites), req.user.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/favourites error:', err)
    res.status(500).json({ error: 'Failed to save favourites' })
  }
})

// ─── API Endpoints ───────────────────────────────────────────────────────────

// Return cached events, filtered by player IDs if provided
app.get('/api/events', async (req, res) => {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 7200 // include matches from last 2 hours

    // Parse ?players=123,456,789 — required, returns empty without it
    const playerIds = (req.query.players || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n))

    if (playerIds.length === 0) {
      return res.json({ events: [], cachedAt: new Date().toISOString() })
    }

    const { rows } = await pool.query(
      `SELECT raw_json FROM events
       WHERE start_timestamp > $1
         AND (home_team_id = ANY($2) OR away_team_id = ANY($2))
       ORDER BY start_timestamp ASC`,
      [cutoff, playerIds]
    )

    res.json({
      events: rows.map(r => r.raw_json),
      cachedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('GET /api/events error:', err)
    res.status(500).json({ error: 'Failed to load events' })
  }
})

// Return all known players for client-side autocomplete
app.get('/api/players', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, short_name AS "shortName", country FROM players ORDER BY name ASC'
    )
    res.json({ players: rows })
  } catch (err) {
    console.error('GET /api/players error:', err)
    res.status(500).json({ error: 'Failed to load players' })
  }
})

// Proxy player search to RapidAPI (fallback when not in local cache)
app.get('/api/players/search', async (req, res) => {
  const rawQ = req.query.q
  const q = Array.isArray(rawQ)
    ? (rawQ[0] || '').trim()
    : typeof rawQ === 'string'
      ? rawQ.trim()
      : ''

  if (!q || q.length < 2 || q.length > 100) return res.json({ results: [] })
  const lowerQ = q.toLowerCase()

  try {
    // Always search local cache first
    const { rows: localRows } = await pool.query(
      `
        SELECT id, name, short_name AS "shortName", country
        FROM players
        WHERE LOWER(name) LIKE $1 OR LOWER(COALESCE(short_name, '')) LIKE $1
        ORDER BY seen_at DESC, name ASC
        LIMIT 6
      `,
      [`%${lowerQ}%`]
    )

    // If we already have enough local matches (or RapidAPI not configured), return them.
    if (localRows.length >= 6 || !RAPIDAPI_KEY) {
      return res.json({ results: localRows })
    }

    console.log(`Searching for ${q} on RapidAPI`);

    const apiRes = await fetch(
      `https://${HOST}/api/tennis/search/${encodeURIComponent(q)}`,
      { headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': RAPIDAPI_KEY } }
    )
    let data = null
    try {
      data = await apiRes.json()
    } catch {
      data = null
    }

    if (!apiRes.ok) {
      const message = data?.message || data?.error || `HTTP ${apiRes.status}`
      // If upstream is rate-limited (or otherwise failing), fall back to local matches.
      if (apiRes.status === 429) {
        return res.json({ results: localRows, warning: message })
      }
      // For other upstream failures, still prefer returning local data if we have any.
      if (localRows.length > 0) {
        return res.json({ results: localRows, warning: message })
      }
      return res.status(apiRes.status).json({ error: message })
    }

    if (data?.message) {
      if (localRows.length > 0) {
        return res.json({ results: localRows, warning: data.message })
      }
      return res.status(502).json({ error: data.message })
    }

    const players = (data.results || [])
      // .filter(r => r.type === 'player' || r.entity?.type === 'player')
      .slice(0, 6)
      .map(r => {
        const entity = r.entity || r
        return {
          id: entity.id,
          name: entity.name || entity.shortName,
          shortName: entity.shortName || entity.name,
          country: entity.country?.name || '',
        }
      })

    // Upsert newly discovered players
    for (const p of players) {
      if (!p.id) continue
      await pool.query(`
        INSERT INTO players (id, name, short_name, country, seen_at)
        VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::INTEGER)
        ON CONFLICT (id) DO UPDATE SET
          name=$2, short_name=$3, country=$4, seen_at=EXTRACT(EPOCH FROM NOW())::INTEGER
      `, [p.id, p.name, p.shortName || null, p.country || null])
    }

    // Merge local + remote (prefer local ordering first, then remote uniques)
    const seen = new Set(localRows.map(p => p.id))
    const merged = [...localRows]
    for (const p of players) {
      if (!p?.id || seen.has(p.id)) continue
      merged.push(p)
      if (merged.length >= 6) break
    }

    res.json({ results: merged.slice(0, 6) })
  } catch (err) {
    console.error('Player search error:', err)
    // If something unexpected happens, still try to return local matches if possible.
    try {
      const { rows } = await pool.query(
        `
          SELECT id, name, short_name AS "shortName", country
          FROM players
          WHERE LOWER(name) LIKE $1 OR LOWER(COALESCE(short_name, '')) LIKE $1
          ORDER BY seen_at DESC, name ASC
          LIMIT 6
        `,
        [`%${lowerQ}%`]
      )
      return res.json({ results: rows, warning: 'Search failed upstream; returned local matches' })
    } catch {
      res.status(500).json({ error: 'Search failed' })
    }
  }
})

// ─── Static Files & SPA Fallback ─────────────────────────────────────────────

app.use(express.static(join(__dirname, 'dist')))

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

// ─── Start ───────────────────────────────────────────────────────────────────

async function start() {
  await initDb()

  if (RAPIDAPI_KEY) {
    fetchCalendar()
    setInterval(fetchCalendar, FETCH_INTERVAL)
  } else {
    console.warn('WARNING: RAPIDAPI_KEY not set. Calendar fetch disabled.')
  }

  const server = app.listen(PORT, () => {
    console.log(`Baseline running on port ${PORT}`)
    if (!AUTH_ENABLED) console.warn('Auth disabled: set JWT_SECRET, GMAIL_USER, and GMAIL_APP_PASSWORD to enable')
  })

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other server or change PORT and retry.`)
      process.exit(1)
    }
    console.error('Server error:', err)
    process.exit(1)
  })
}

start().catch(err => {
  console.error('Failed to start:', err)
  process.exit(1)
})
