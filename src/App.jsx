import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const USER_TZ = "Europe/Helsinki";
const HOST = "tennisapi1.p.rapidapi.com";

const DEMO_EVENTS = [
  {
    id: 15624970,
    startTimestamp: Date.now() / 1000 + 3600 * 4,
    homeTeam: { id: 299999, name: "Carlos Alcaraz", shortName: "C. Alcaraz", country: { name: "Spain" } },
    awayTeam: { id: 57163, name: "Alexander Zverev", shortName: "A. Zverev", country: { name: "Germany" } },
    tournament: { name: "Indian Wells, USA", category: { name: "ATP" }, uniqueTournament: { tennisPoints: 1000 } },
    season: { name: "ATP Indian Wells, USA Men Singles 2026" },
    roundInfo: { round: 7, name: "Quarterfinals" },
    status: { code: 0, type: "notstarted", description: "Not started" },
    groundType: "Hardcourt outdoor",
    homeScore: {}, awayScore: {},
  },
  {
    id: 15624971,
    startTimestamp: Date.now() / 1000 + 3600 * 28,
    homeTeam: { id: 399999, name: "Jannik Sinner", shortName: "J. Sinner", country: { name: "Italy" } },
    awayTeam: { id: 100002, name: "Novak Djokovic", shortName: "N. Djokovic", country: { name: "Serbia" } },
    tournament: { name: "Indian Wells, USA", category: { name: "ATP" }, uniqueTournament: { tennisPoints: 1000 } },
    season: { name: "ATP Indian Wells, USA Men Singles 2026" },
    roundInfo: { round: 7, name: "Semifinals" },
    status: { code: 0, type: "notstarted", description: "Not started" },
    groundType: "Hardcourt outdoor",
    homeScore: {}, awayScore: {},
  },
  {
    id: 15624966,
    startTimestamp: Date.now() / 1000 - 3600 * 3,
    homeTeam: { id: 235576, name: "Brandon Nakashima", shortName: "B. Nakashima", country: { name: "USA" } },
    awayTeam: { id: 57163, name: "Alexander Zverev", shortName: "A. Zverev", country: { name: "Germany" } },
    tournament: { name: "Indian Wells, USA", category: { name: "ATP" }, uniqueTournament: { tennisPoints: 1000 } },
    season: { name: "ATP Indian Wells, USA Men Singles 2026" },
    roundInfo: { round: 6, name: "Round of 32" },
    status: { code: 100, type: "finished", description: "Ended" },
    winnerCode: 2,
    groundType: "Hardcourt outdoor",
    homeScore: { period1: 6, period2: 7, period3: 4, period1TieBreak: 2 },
    awayScore: { period1: 7, period2: 5, period3: 6, period1TieBreak: 7 },
  },
  {
    id: 15624972,
    startTimestamp: Date.now() / 1000 + 3600 * 6,
    homeTeam: { id: 499999, name: "Iga Swiatek", shortName: "I. Swiatek", country: { name: "Poland" } },
    awayTeam: { id: 599999, name: "Aryna Sabalenka", shortName: "A. Sabalenka", country: { name: "Belarus" } },
    tournament: { name: "Indian Wells, USA", category: { name: "WTA" }, uniqueTournament: { tennisPoints: 1000 } },
    season: { name: "WTA Indian Wells, USA Women Singles 2026" },
    roundInfo: { round: 7, name: "Semifinals" },
    status: { code: 0, type: "notstarted", description: "Not started" },
    groundType: "Hardcourt outdoor",
    homeScore: {}, awayScore: {},
  },
];

const SURFACE_EMOJI = {
  "hardcourt outdoor": "🔵", "hardcourt indoor": "🔵",
  "clay": "🟤", "clay outdoor": "🟤", "clay indoor": "🟤",
  "grass": "🟢", "grass outdoor": "🟢",
  "carpet": "⬜",
};

function surfaceIcon(groundType) {
  return SURFACE_EMOJI[(groundType || "").toLowerCase()] || "🎾";
}

// ─── Time helpers (startTimestamp is UTC unix seconds) ────────────────────────
function tsToLocalTime(ts, tz) {
  return new Date(ts * 1000).toLocaleTimeString("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function tsToDateKey(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: USER_TZ });
}
function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: USER_TZ });
}
function tomorrowKey() {
  return new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: USER_TZ });
}
function fmtDayLabel(dateStr) {
  if (dateStr === todayKey()) return "Today";
  if (dateStr === tomorrowKey()) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "short",
  });
}

// Venue timezone from tournament name (best-effort, for showing venue local time)
const VENUE_TZ_MAP = [
  [/indian wells/i, "America/Los_Angeles"],
  [/miami/i, "America/New_York"],
  [/monte.carlo/i, "Europe/Monaco"],
  [/madrid/i, "Europe/Madrid"],
  [/rome|roma/i, "Europe/Rome"],
  [/paris|roland.garros|french open/i, "Europe/Paris"],
  [/wimbledon|london|queen/i, "Europe/London"],
  [/eastbourne|birmingham/i, "Europe/London"],
  [/us open|new york|cincinnati|washington/i, "America/New_York"],
  [/toronto|montreal/i, "America/Toronto"],
  [/australian open|melbourne|sydney/i, "Australia/Melbourne"],
  [/dubai/i, "Asia/Dubai"], [/doha/i, "Asia/Qatar"],
  [/beijing/i, "Asia/Shanghai"], [/shanghai/i, "Asia/Shanghai"],
  [/tokyo/i, "Asia/Tokyo"], [/singapore/i, "Asia/Singapore"],
  [/buenos aires/i, "America/Argentina/Buenos_Aires"],
  [/rio/i, "America/Sao_Paulo"], [/acapulco/i, "America/Mexico_City"],
  [/rotterdam|amsterdam/i, "Europe/Amsterdam"],
  [/marseille|lyon|metz|bordeaux/i, "Europe/Paris"],
  [/hamburg|munich|berlin|halle/i, "Europe/Berlin"],
  [/vienna/i, "Europe/Vienna"], [/basel/i, "Europe/Zurich"],
  [/stockholm/i, "Europe/Stockholm"], [/moscow/i, "Europe/Moscow"],
];
function getVenueTz(tournamentName) {
  for (const [re, tz] of VENUE_TZ_MAP) if (re.test(tournamentName || "")) return tz;
  return null;
}

// ─── Score display ────────────────────────────────────────────────────────────
// Formats e.g. "7(7)-6(2)  6-3" with tiebreak superscript notation
function formatScore(event) {
  const h = event.homeScore;
  const a = event.awayScore;
  if (!h || !a || h.period1 == null) return null;
  const sets = ["period1", "period2", "period3", "period4", "period5"];
  const played = sets.filter(s => h[s] != null);
  if (!played.length) return null;
  return played.map(s => {
    const hg = h[s], ag = a[s];
    const tbKey = `${s}TieBreak`;
    // Show tiebreak score for the loser of the set (the lower score)
    if (h[tbKey] != null || a[tbKey] != null) {
      const tb = h[tbKey] ?? a[tbKey];
      const loserIsHome = hg < ag;
      return loserIsHome ? `${hg}(${tb})-${ag}` : `${hg}-${ag}(${tb})`;
    }
    return `${hg}-${ag}`;
  }).join("  ");
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ event, live }) {
  if (live) return (
    <span style={{ background: "#ef4444", color: "#fff", fontSize: "10px", fontWeight: 700, padding: "2px 9px", borderRadius: "4px", letterSpacing: "0.06em", animation: "livepulse 1.5s ease-in-out infinite" }}>● LIVE</span>
  );
  const cat = event.tournament?.category?.name || event.season?.name || "";
  const pts = event.tournament?.uniqueTournament?.tennisPoints;
  const label = pts ? `${cat} ${pts}` : cat.split(" ")[0];
  const isWTA = /wta/i.test(cat);
  const isITF = /itf/i.test(cat);
  const [bg, fg] = isWTA ? ["#3a0a1e", "#f472b6"] : isITF ? ["#0a2e1a", "#4ade80"] : ["#0a1e3a", "#60a5fa"];
  return <span style={{ background: bg, color: fg, fontSize: "10px", fontWeight: 700, padding: "2px 9px", borderRadius: "4px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label || "ATP"}</span>;
}

// ─── Match Card ───────────────────────────────────────────────────────────────
function MatchCard({ event, favouriteIds }) {
  const isLive = event.status?.type === "inprogress";
  const isDone = event.status?.type === "finished";
  const p1 = event.homeTeam?.shortName || event.homeTeam?.name || "TBD";
  const p2 = event.awayTeam?.shortName || event.awayTeam?.name || "TBD";
  const p1Fav = favouriteIds.includes(event.homeTeam?.id);
  const p2Fav = favouriteIds.includes(event.awayTeam?.id);
  const isFav = p1Fav || p2Fav;

  const helsinkiTime = tsToLocalTime(event.startTimestamp, USER_TZ);
  const venueTz = getVenueTz(event.tournament?.name);
  const venueTime = venueTz ? tsToLocalTime(event.startTimestamp, venueTz) : null;
  const showVenue = venueTime && venueTime !== helsinkiTime;

  const score = formatScore(event);
  const ground = event.groundType || event.tournament?.uniqueTournament?.groundType;
  const winnerHome = event.winnerCode === 1;
  const winnerAway = event.winnerCode === 2;

  return (
    <div
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
      style={{
        background: isFav ? "linear-gradient(135deg,#161200,#1a1600)" : "linear-gradient(135deg,#121212,#171717)",
        border: `1px solid ${isLive ? "#ef4444" : isFav ? "#332800" : "#1c1c1c"}`,
        borderRadius: "10px", padding: "14px 18px", marginBottom: "8px",
        position: "relative", overflow: "hidden",
        transition: "transform 0.15s",
        opacity: isDone ? 0.55 : 1,
      }}>
      {isLive && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "#ef4444", animation: "livepulse 1.5s ease-in-out infinite" }} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
        {/* Players */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {[[p1, p1Fav, winnerHome], [p2, p2Fav, winnerAway]].map(([name, fav, winner], i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: i === 0 ? "5px" : 0 }}>
              <span style={{
                fontSize: "14px",
                fontWeight: fav ? 700 : winner ? 600 : 400,
                color: fav ? "#f5c842" : winner ? "#e0e0e0" : isDone ? "#555" : "#ccc",
                fontFamily: "'DM Mono', monospace",
              }}>
                {fav ? "★ " : ""}{name}
                {winner && isDone && <span style={{ color: "#4ade80", fontSize: "11px", marginLeft: "6px" }}>✓</span>}
              </span>
              {i === 0 && <span style={{ fontSize: "10px", color: "#2a2a2a", flexShrink: 0 }}>vs</span>}
            </div>
          ))}
        </div>

        {/* Right side: time or score */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {isDone && score ? (
            <div>
              <div style={{ fontSize: "10px", color: "#3a3a3a", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "2px" }}>Final</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#555", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{score}</div>
            </div>
          ) : isLive ? (
            <div style={{ textAlign: "right" }}>
              {score && <div style={{ fontSize: "16px", fontWeight: 800, color: "#ef4444", fontFamily: "'DM Mono', monospace", marginBottom: "4px" }}>{score}</div>}
              <Badge event={event} live />
            </div>
          ) : (
            <div>
              <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "2px" }}>Helsinki</div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#f5c842", fontFamily: "'DM Mono', monospace", letterSpacing: "-0.02em", lineHeight: 1 }}>{helsinkiTime}</div>
              {showVenue && <div style={{ fontSize: "11px", color: "#444", fontFamily: "'DM Mono', monospace", marginTop: "2px" }}>{venueTime} local</div>}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", paddingTop: "8px", borderTop: "1px solid #181818" }}>
        <span style={{ fontSize: "11px" }}>{surfaceIcon(ground)}</span>
        <span style={{ fontSize: "11px", color: "#3a3a3a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {event.tournament?.name}{event.roundInfo?.name ? ` · ${event.roundInfo.name}` : ""}
        </span>
        <Badge event={event} />
      </div>
    </div>
  );
}

// ─── Player Search ────────────────────────────────────────────────────────────
function PlayerSearch({ apiKey, onAdd, existingIds }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const debounceRef = useRef(null);

  const search = useCallback(async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    if (!apiKey) { setSearchErr("Save your API key first"); return; }
    setSearching(true); setSearchErr("");
    try {
      const res = await fetch(
        `https://tennisapi1.p.rapidapi.com/api/tennis/search/${encodeURIComponent(q)}`,
        { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": apiKey } }
      );
      const data = await res.json();
      // Filter to player results only (type === "player" or sport === "tennis")
      const players = (data.results || []).filter(r =>
        r.type === "player" || r.entity?.type === "player"
      ).slice(0, 6);
      setResults(players);
      if (!players.length) setSearchErr("No players found");
    } catch { setSearchErr("Search failed"); }
    setSearching(false);
  }, [apiKey]);

  const handleChange = (val) => {
    setQuery(val);
    setResults([]); setSearchErr("");
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 400);
  };

  const getPlayerInfo = (r) => {
    // Results can be wrapped differently
    const entity = r.entity || r;
    return {
      id: entity.id,
      name: entity.name || entity.shortName,
      shortName: entity.shortName || entity.name,
      country: entity.country?.name || "",
    };
  };

  return (
    <div>
      <div style={{ position: "relative" }}>
        <input
          value={query}
          onChange={e => handleChange(e.target.value)}
          placeholder="Search player name..."
          style={{ width: "100%", background: "#0a0a0a", border: "1px solid #222", borderRadius: "7px", padding: "9px 12px", color: "#e0e0e0", fontSize: "13px" }}
        />
        {searching && (
          <div style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)" }}>
            <div style={{ width: "14px", height: "14px", border: "2px solid #222", borderTopColor: "#f5c842", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          </div>
        )}
      </div>

      {searchErr && <div style={{ fontSize: "11px", color: "#555", marginTop: "5px" }}>{searchErr}</div>}

      {results.length > 0 && (
        <div style={{ background: "#0e0e0e", border: "1px solid #222", borderRadius: "7px", marginTop: "4px", overflow: "hidden" }}>
          {results.map((r, i) => {
            const p = getPlayerInfo(r);
            const already = existingIds.includes(p.id);
            return (
              <div key={p.id || i}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: i < results.length - 1 ? "1px solid #181818" : "none" }}>
                <div>
                  <div style={{ fontSize: "13px", color: "#ccc" }}>{p.name}</div>
                  {p.country && <div style={{ fontSize: "11px", color: "#3a3a3a" }}>{p.country}</div>}
                </div>
                <button
                  disabled={already}
                  onClick={() => { onAdd({ id: p.id, name: p.name, shortName: p.shortName }); setQuery(""); setResults([]); }}
                  style={{
                    background: already ? "#1a1a1a" : "#f5c842", color: already ? "#333" : "#000",
                    border: "none", borderRadius: "5px", padding: "4px 12px",
                    fontSize: "12px", fontWeight: 700, cursor: already ? "default" : "pointer",
                  }}>
                  {already ? "Added" : "+ Add"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── localStorage helpers ─────────────────────────────────────────────────────
const LS_KEY_FAV = "courtcall_favourites";
const LS_KEY_API = "courtcall_apikey";

const DEFAULT_FAVOURITES = [
  { id: 235576, name: "Brandon Nakashima", shortName: "B. Nakashima" },
];

function loadFavourites() {
  try {
    const raw = localStorage.getItem(LS_KEY_FAV);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_FAVOURITES;
}

function loadApiKey() {
  try { return localStorage.getItem(LS_KEY_API) || ""; } catch { return ""; }
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function CourtCall() {
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [savedKey, setSavedKey] = useState(() => loadApiKey());
  // favourites: array of { id, name, shortName }
  const [favourites, setFavourites] = useState(() => loadFavourites());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDemo, setIsDemo] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [lastFetched, setLastFetched] = useState(null);

  // Persist favourites whenever they change
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_FAV, JSON.stringify(favourites)); } catch {}
  }, [favourites]);

  const favouriteIds = favourites.map(f => f.id);

  const filterEvents = useCallback((all) => {
    const nowTs = Date.now() / 1000 - 7200; // include matches started in last 2h (might be live)
    return all.filter(e => {
      if (!e.startTimestamp || e.startTimestamp < nowTs) return false;
      if (!favouriteIds.length) return true;
      return favouriteIds.includes(e.homeTeam?.id) || favouriteIds.includes(e.awayTeam?.id);
    });
  }, [favouriteIds]);

  const fetchCalendar = useCallback(async (key) => {
    if (!key) { setEvents(filterEvents(DEMO_EVENTS)); setIsDemo(true); return; }
    setLoading(true); setError("");
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      const fetchMonth = (m, y) =>
        fetch(`https://tennisapi1.p.rapidapi.com/api/tennis/calendar/${m}/${y}`,
          { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": key } }
        ).then(r => r.json());

      const thisMonth = await fetchMonth(month, year);

      if (thisMonth.message || (!thisMonth.events && !Array.isArray(thisMonth))) {
        throw new Error(thisMonth.message || "Unexpected response");
      }

      let all = thisMonth.events || thisMonth || [];

      // If last 7 days of month, grab next month too
      const daysInMonth = new Date(year, month, 0).getDate();
      if (now.getDate() >= daysInMonth - 6) {
        const nm = month === 12 ? 1 : month + 1;
        const ny = month === 12 ? year + 1 : year;
        const next = await fetchMonth(nm, ny);
        all = [...all, ...(next.events || next || [])];
      }

      const filtered = filterEvents(all);
      setEvents(filtered);
      setIsDemo(false);
      setLastFetched(new Date());
      if (filtered.length === 0) setError("No upcoming matches found for your favourites this month.");
    } catch (e) {
      setError(e.message || "Fetch failed — check your RapidAPI key.");
      setEvents(filterEvents(DEMO_EVENTS));
      setIsDemo(true);
    }
    setLoading(false);
  }, [filterEvents]);

  useEffect(() => {
    if (savedKey) fetchCalendar(savedKey);
    else setEvents(filterEvents(DEMO_EVENTS));
  }, [savedKey, favouriteIds.join(",")]);

  // Group by Helsinki date
  const grouped = events.reduce((acc, e) => {
    const d = tsToDateKey(e.startTimestamp);
    if (!acc[d]) acc[d] = [];
    acc[d].push(e);
    return acc;
  }, {});
  const allDates = Object.keys(grouped).sort();
  const cutoffKey = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: USER_TZ });
  const visibleDates = showAll ? allDates : allDates.filter(d => d <= cutoffKey);
  const hiddenCount = allDates.length - visibleDates.length;

  return (
    <div style={{ minHeight: "100vh", background: "#0c0c0c", color: "#e0e0e0", fontFamily: "'Inter',-apple-system,sans-serif", padding: "24px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes livepulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        input::placeholder { color: #2e2e2e; }
        input:focus { outline: none !important; border-color: #f5c842 !important; }
        * { box-sizing: border-box; }
        button { cursor: pointer; transition: opacity 0.15s; }
        button:not(:disabled):hover { opacity: 0.8; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #1e1e1e; border-radius: 2px; }
      `}</style>

      <div style={{ maxWidth: "580px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "18px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 800, letterSpacing: "-0.03em", background: "linear-gradient(90deg,#f5c842,#e07b00)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              🎾 Court Call
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#2e2e2e" }}>
              {isDemo ? "Demo · " : lastFetched ? `Updated ${lastFetched.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · ` : ""}
              Helsinki time · {favourites.length} player{favourites.length !== 1 ? "s" : ""} tracked
            </p>
          </div>
          <div style={{ display: "flex", gap: "7px" }}>
            {savedKey && (
              <button onClick={() => fetchCalendar(savedKey)} disabled={loading} title="Refresh"
                style={{ background: "none", border: "1px solid #1c1c1c", borderRadius: "7px", color: "#3a3a3a", padding: "6px 10px", fontSize: "14px" }}>
                🔄
              </button>
            )}
            <button onClick={() => setShowSettings(s => !s)}
              style={{ background: showSettings ? "#161600" : "none", border: `1px solid ${showSettings ? "#332800" : "#1c1c1c"}`, borderRadius: "7px", color: showSettings ? "#f5c842" : "#3a3a3a", padding: "6px 12px", fontSize: "13px" }}>
              ⚙️ Settings
            </button>
          </div>
        </div>

        {/* Demo banner */}
        {isDemo && (
          <div style={{ padding: "9px 13px", background: "#111000", border: "1px solid #252000", borderRadius: "8px", fontSize: "12px", color: "#7a5a00", marginBottom: "14px" }}>
            ⚡ Demo data — paste your RapidAPI key in Settings to go live
          </div>
        )}

        {/* Settings */}
        {showSettings && (
          <div style={{ background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: "10px", padding: "18px", marginBottom: "16px" }}>

            {/* API Key */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "5px" }}>RapidAPI Key</div>
              <div style={{ fontSize: "11px", color: "#2a2a2a", marginBottom: "8px" }}>
                Free: 50 req/day · $9/mo: 15k/day ·{" "}
                <a href="https://rapidapi.com/fluis.lacasse/api/tennisapi1" target="_blank" rel="noreferrer" style={{ color: "#f5c842" }}>tennisapi1 on RapidAPI</a>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setSavedKey(apiKey)}
                  placeholder="x-rapidapi-key..."
                  style={{ flex: 1, background: "#080808", border: "1px solid #1e1e1e", borderRadius: "7px", padding: "9px 12px", color: "#e0e0e0", fontSize: "13px" }} />
                <button onClick={() => { setSavedKey(apiKey); setShowSettings(false); try { localStorage.setItem(LS_KEY_API, apiKey); } catch {} }}
                  style={{ background: "#f5c842", color: "#000", border: "none", borderRadius: "7px", padding: "9px 16px", fontWeight: 700, fontSize: "13px" }}>
                  Save
                </button>
              </div>
            </div>

            {/* Tracked Players */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>
                Tracked Players
              </div>
              {favourites.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                  {favourites.map(f => (
                    <span key={f.id} style={{ background: "#151000", border: "1px solid #2a2000", color: "#f5c842", padding: "3px 10px 3px 8px", borderRadius: "5px", fontSize: "12px", display: "flex", alignItems: "center", gap: "5px" }}>
                      ★ {f.shortName || f.name}
                      <button onClick={() => setFavourites(fvs => fvs.filter(x => x.id !== f.id))}
                        style={{ background: "none", border: "none", color: "#444", padding: 0, fontSize: "15px", lineHeight: 1, cursor: "pointer" }}>×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "#2a2a2a", marginBottom: "10px" }}>No players tracked yet</div>
              )}
            </div>

            {/* Player Search */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "7px" }}>Add Player</div>
              <PlayerSearch
                apiKey={savedKey || apiKey}
                existingIds={favouriteIds}
                onAdd={player => setFavourites(fvs => [...fvs, player])}
              />
              {!savedKey && (
                <div style={{ fontSize: "11px", color: "#2a2a2a", marginTop: "6px" }}>Save your API key above to enable player search</div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "9px 13px", background: "#150800", border: "1px solid #2a1200", borderRadius: "8px", color: "#f97316", fontSize: "12px", marginBottom: "12px" }}>
            ⚠️ {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ width: "26px", height: "26px", border: "3px solid #181818", borderTopColor: "#f5c842", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 10px" }} />
            <div style={{ fontSize: "12px", color: "#2a2a2a" }}>Loading fixtures…</div>
          </div>
        ) : visibleDates.length === 0 && !error ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: "30px", marginBottom: "10px" }}>🎾</div>
            <div style={{ color: "#333", fontSize: "14px" }}>No upcoming matches found</div>
            <div style={{ color: "#252525", fontSize: "12px", marginTop: "4px" }}>Add players in Settings to track their fixtures</div>
          </div>
        ) : (
          <>
            {visibleDates.map(date => (
              <div key={date} style={{ marginBottom: "22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <span style={{ fontSize: date === todayKey() ? "16px" : "13px", fontWeight: 700, color: date === todayKey() ? "#f5c842" : "#2e2e2e" }}>
                    {fmtDayLabel(date)}
                  </span>
                  <div style={{ flex: 1, height: "1px", background: "#141414" }} />
                  <span style={{ fontSize: "11px", color: "#202020" }}>
                    {grouped[date].length} match{grouped[date].length !== 1 ? "es" : ""}
                  </span>
                </div>
                {grouped[date]
                  .sort((a, b) => a.startTimestamp - b.startTimestamp)
                  .map(e => <MatchCard key={e.id} event={e} favouriteIds={favouriteIds} />)
                }
              </div>
            ))}

            {hiddenCount > 0 && (
              <button onClick={() => setShowAll(true)}
                style={{ width: "100%", padding: "10px", background: "none", border: "1px solid #1c1c1c", borderRadius: "8px", color: "#3a3a3a", fontSize: "12px", marginTop: "4px" }}>
                Show {hiddenCount} more day{hiddenCount !== 1 ? "s" : ""} this month →
              </button>
            )}
          </>
        )}

        <div style={{ textAlign: "center", marginTop: "36px", color: "#181818", fontSize: "11px" }}>
          Times in Helsinki (EET/EEST) · Data via TennisApi on RapidAPI
        </div>
      </div>
    </div>
  );
}
