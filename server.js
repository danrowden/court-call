import express from 'express'
import pg from 'pg'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const HOST = 'tennisapi1.p.rapidapi.com'
const FETCH_INTERVAL = 30 * 60 * 1000 // 30 minutes

// ─── Database ────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } })

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

  console.log('Database tables ready')
}

// ─── Calendar Fetch ──────────────────────────────────────────────────────────

async function fetchCalendar() {
  if (!RAPIDAPI_KEY) return
  console.log('Fetching calendar from TennisAPI...')

  try {
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()

    const fetchMonth = async (m, y) => {
      const res = await fetch(`https://${HOST}/api/tennis/calendar/${m}/${y}`, {
        headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': RAPIDAPI_KEY }
      })
      return res.json()
    }

    const thisMonth = await fetchMonth(month, year)
    if (thisMonth.message || (!thisMonth.events && !Array.isArray(thisMonth))) {
      throw new Error(thisMonth.message || 'Unexpected response')
    }

    let all = thisMonth.events || thisMonth || []

    // If last 7 days of month, also fetch next month
    const daysInMonth = new Date(year, month, 0).getDate()
    if (now.getDate() >= daysInMonth - 6) {
      const nm = month === 12 ? 1 : month + 1
      const ny = month === 12 ? year + 1 : year
      const next = await fetchMonth(nm, ny)
      all = [...all, ...(next.events || next || [])]
    }

    // Upsert events
    let eventCount = 0
    for (const e of all) {
      if (!e.id) continue
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
        e.startTimestamp,
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
    }

    // Cleanup old events (older than 7 days)
    const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400
    const { rowCount } = await pool.query('DELETE FROM events WHERE start_timestamp < $1', [cutoff])

    console.log(`Fetched ${eventCount} events, cleaned ${rowCount} old events`)
  } catch (err) {
    console.error('Calendar fetch failed:', err.message)
  }
}

// ─── API Endpoints ───────────────────────────────────────────────────────────

// Return all cached events (client filters by favourites)
app.get('/api/events', async (req, res) => {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 7200 // include matches from last 2 hours
    const { rows } = await pool.query(
      'SELECT raw_json FROM events WHERE start_timestamp > $1 ORDER BY start_timestamp ASC',
      [cutoff]
    )
    res.json({
      events: rows.map(r => r.raw_json),
      cachedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('GET /api/events error:', err.message)
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
    console.error('GET /api/players error:', err.message)
    res.status(500).json({ error: 'Failed to load players' })
  }
})

// Proxy player search to RapidAPI (fallback when not in local cache)
app.get('/api/players/search', async (req, res) => {
  const q = req.query.q
  if (!q || q.length < 2) return res.json({ results: [] })
  if (!RAPIDAPI_KEY) return res.status(503).json({ error: 'API key not configured' })

  try {
    const apiRes = await fetch(
      `https://${HOST}/api/tennis/search/${encodeURIComponent(q)}`,
      { headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': RAPIDAPI_KEY } }
    )
    const data = await apiRes.json()
    const players = (data.results || [])
      .filter(r => r.type === 'player' || r.entity?.type === 'player')
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

    res.json({ results: players })
  } catch (err) {
    console.error('Player search error:', err.message)
    res.status(500).json({ error: 'Search failed' })
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

  app.listen(PORT, () => {
    console.log(`Baseline running on port ${PORT}`)
  })
}

start().catch(err => {
  console.error('Failed to start:', err)
  process.exit(1)
})
