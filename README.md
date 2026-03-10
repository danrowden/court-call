## Data flow & storage (how this app works)

This app shows upcoming tennis matches for a set of tracked players. It **does not call RapidAPI from the browser**. Instead, the server periodically pulls data from RapidAPI, stores it in Postgres as a cache, and the React UI reads from the server’s `/api/*` endpoints.

### High-level pipeline

- **RapidAPI (TennisAPI)** → `server.js` background fetch job
- **Server cache** → Postgres tables (`events`, `players`)
- **App API** → `GET /api/events`, `GET /api/players`, `GET /api/players/search`
- **Client storage** → `localStorage` for tracked players (favourites)
- **Offline caching** → Service worker caches `/api/*` responses and app shell assets

---

## Backend: fetching + storing data

### External API (upstream)

The server uses RapidAPI’s TennisAPI host `tennisapi1.p.rapidapi.com` and the env var `RAPIDAPI_KEY`.

- **Calendar endpoint** (server-side only): `GET https://tennisapi1.p.rapidapi.com/api/tennis/events/{day}/{month}/{year}`
- **Search endpoint**: not used (player search is local DB-only)

### Periodic refresh (server-side cache warmer)

On startup (and then every 15 minutes), `server.js` fetches **today + next 3 days** of events and **upserts** them into Postgres.

- **Schedule**: every 15 minutes (`FETCH_INTERVAL`)
- **Range**: today through +3 days (4 days total)
- **Retention cleanup**: deletes events older than `EVENT_RETENTION_DAYS` (default 7, capped at 90)

### Postgres storage

The backend requires `DATABASE_URL` and uses `pg.Pool`.

It creates two tables:

- **`events`**: one row per match/event (primary key `id`)
  - Stores commonly-used fields (start time, players, tournament, scores, status)
  - Stores the full upstream payload in **`raw_json` (JSONB)** (this is what the client reads back)
  - Keeps an `updated_at` unix timestamp for “last seen”
- **`players`**: a lightweight cache of players seen in events and search
  - `seen_at` is updated when the player is observed again
  - Indexed by `LOWER(name)` for local search

### App API (what the client calls)

- **`GET /api/events`**
  - Reads cached events from Postgres (ordered by start time)
  - Only returns events newer than “now minus 2 hours”
  - Response shape:
    - `events`: array of `raw_json` objects (upstream event payloads)
    - `cachedAt`: ISO timestamp

- **`GET /api/players`**
  - Returns all cached players for client-side autocomplete

- **`GET /api/players/search?q=...`**
  - Searches Postgres first (fast, no upstream quota)
  - Does not call RapidAPI (local DB-only)

---

## Frontend: API calls + local persistence

### API calls

The React app calls the backend via relative URLs:

- `fetch("/api/events")`
- `fetch("/api/players")`
- `fetch("/api/players/search?q=...")`

In dev, Vite proxies `/api/*` to your backend:

- `vite.config.js`: `/api` → `http://localhost:${PORT}` (defaults to `3000`)

That means your backend should run on whatever port you set in `PORT` (default **3000**) during development.

### `localStorage` (tracked players)

Tracked players (“favourites”) are stored in the browser so they persist across reloads:

- **Key**: `courtcall_favourites`
- **Format**: versioned payload `{ v: 1, favourites: [...] }` (legacy plain-array format is also accepted)
- **When written**: whenever favourites change

Important: favourites are **client-only**. The server returns a broad set of cached events; the client filters them down to “matches involving my tracked players”.

### Service worker cache (offline-ish)

`public/sw.js` registers a service worker that uses the Cache API:

- **App shell**: cache-first (e.g. `/`, `/index.html`, `/manifest.json`, `/app-icon.png`)
- **API requests** (`/api/*`): network-first, falling back to cache if offline; successful API responses are cached

---

## Running locally

### 1) Install

```bash
npm install
```

### 2) Configure env

The backend requires:

- **`DATABASE_URL`**: Postgres connection string
- **`RAPIDAPI_KEY`**: RapidAPI key (if unset, the periodic calendar fetch is disabled)

Optional:

- **`PORT`**: backend port (default `3000`)
- **`EVENT_RETENTION_DAYS`**: how long to keep old events (default 7, max 90)

### 3) Start backend + frontend

Terminal A (backend):

```bash
PORT=3000 node --env-file=.env server.js
```

Terminal B (frontend):

```bash
npm run dev
```
