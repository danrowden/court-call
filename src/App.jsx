import { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  LogOut,
  Mail,
  RefreshCw,
  Settings,
  Star,
  X,
  Globe
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const USER_TZ_SHORT = USER_TZ.split("/").pop().replace(/_/g, " ");

const SURFACE_COLOR = {
  hardcourt: "text-surface-hard",
  clay: "text-surface-clay",
  grass: "text-surface-grass",
  carpet: "text-surface-carpet",
  default: "text-surface-default",
};

function SurfaceIcon({ groundType, size = 14 }) {
  const t = (groundType || "").toLowerCase();
  const key =
    t.includes("hard") ? "hardcourt" :
    t.includes("clay") ? "clay" :
    t.includes("grass") ? "grass" :
    t.includes("carpet") ? "carpet" :
    "default";
  const colorClass = SURFACE_COLOR[key] || SURFACE_COLOR.default;
  return (
    <Circle
      size={size}
      className={colorClass}
      fill="currentColor"
      stroke="#0c0c0c"
      strokeWidth={2}
      aria-label={groundType || "surface"}
    />
  );
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
    <span className="bg-live text-white text-xs font-bold px-2.5 py-0.5 rounded tracking-wide animate-livepulse">● LIVE</span>
  );
  const cat = event.tournament?.category?.name || event.season?.name || "";
  const pts = event.tournament?.uniqueTournament?.tennisPoints;
  const label = pts ? `${cat} ${pts}` : cat.split(" ")[0];
  const isWTA = /wta/i.test(cat);
  const isITF = /itf/i.test(cat);
  const bgClass = isWTA ? "bg-wta-bg text-wta-fg" : isITF ? "bg-itf-bg text-itf-fg" : "bg-atp-bg text-atp-fg";
  return <span className={`${bgClass} text-xs font-bold px-2.5 py-0.5 rounded tracking-wide uppercase`}>{label || "ATP"}</span>;
}

// ─── Match Card ───────────────────────────────────────────────────────────────
function MatchCard({ event, favouriteIds }) {
  const isLive = event.status?.type === "inprogress";
  const isDone = event.status?.type === "finished";
  const p1 = event.homeTeam?.name || "TBD";
  const p2 = event.awayTeam?.name || "TBD";
  const p1Rank = event.homeTeam?.ranking;
  const p2Rank = event.awayTeam?.ranking;
  const p1Fav = favouriteIds.includes(event.homeTeam?.id);
  const p2Fav = favouriteIds.includes(event.awayTeam?.id);
  const isFav = p1Fav || p2Fav;

  const localTime = tsToLocalTime(event.startTimestamp, USER_TZ);
  const venueTz = getVenueTz(event.tournament?.name);
  const venueTime = venueTz ? tsToLocalTime(event.startTimestamp, venueTz) : null;
  const showVenue = venueTime && venueTime !== localTime;

  const score = formatScore(event);
  const ground = event.groundType || event.tournament?.uniqueTournament?.groundType;
  const winnerHome = event.winnerCode === 1;
  const winnerAway = event.winnerCode === 2;

  const cardBg = isFav
    ? "bg-gradient-to-br from-card-fav to-card-fav-hover"
    : "bg-gradient-to-br from-card to-card-hover";
  const borderColor = isLive ? "border-live" : isFav ? "border-border-fav" : "border-border";

  return (
    <div className={`${cardBg} ${borderColor} border rounded-[10px] p-3 sm:p-4 mb-2 relative overflow-hidden transition-transform duration-150 ${isDone ? "opacity-55" : "opacity-100"}`}>
      {isLive && <div className="absolute top-0 left-0 right-0 h-0.5 bg-live animate-livepulse" />}

      <div className="flex justify-between items-center gap-4">
        {/* Players */}
        <div className="flex-1 min-w-0">
          {[[p1, p1Fav, winnerHome, p1Rank], [p2, p2Fav, winnerAway, p2Rank]].map(([name, fav, winner, rank], i) => (
            <div key={i} className={`flex items-baseline gap-1.5 ${i === 0 ? "mb-[5px]" : ""}`}>
              {fav ? <Star aria-label="tracked" className="w-3.5 h-3.5 text-accent fill-accent shrink-0 translate-y-px" /> : null}
              <span className={`text-sm font-mono whitespace-nowrap overflow-hidden text-ellipsis ${
                fav ? "font-bold text-accent" :
                winner ? "font-semibold text-text" :
                isDone ? "font-normal text-text-dim" :
                "font-normal text-[#ccc]"
              }`}>
                {name}
                {rank != null && (
                  <span className="text-[11px] text-text-muted ml-1.5 font-mono font-normal">{rank}</span>
                )}
                {winner && isDone && (
                  <span className="ml-1.5 inline-flex items-center">
                    <Check aria-label="winner" size={14} className="text-win" />
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Right side: time or score */}
        <div className="text-right shrink-0">
          {isDone && score ? (
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-0.5">Final</div>
              <div className="text-sm font-semibold text-text-dim font-mono whitespace-nowrap">{score}</div>
            </div>
          ) : isLive ? (
            <div className="text-right">
              {score && <div className="text-base font-extrabold text-live font-mono mb-1">{score}</div>}
              <Badge event={event} live />
            </div>
          ) : (
            <div>
              <div className="text-[22px] font-extrabold font-mono tracking-tight leading-none">{localTime}</div>
              {showVenue && <div className="text-[13px] text-text-muted font-mono mt-0.5">{venueTime} local</div>}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 mt-3">
        <span className="inline-flex items-center"><SurfaceIcon groundType={ground} size={14} /></span>
        <span className="text-[13px] text-text-muted flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {event.tournament?.name}{event.roundInfo?.name ? ` · ${event.roundInfo.name}` : ""}
        </span>
        <Badge event={event} />
      </div>
    </div>
  );
}

// ─── Player Search ────────────────────────────────────────────────────────────
function PlayerSearch({ onAdd, existingIds }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [knownPlayers, setKnownPlayers] = useState([]);
  const debounceRef = useRef(null);

  // Load known players from server cache on mount
  useEffect(() => {
    fetch("/api/players")
      .then(r => r.json())
      .then(data => setKnownPlayers(data.players || []))
      .catch(() => {});
  }, []);

  const search = useCallback(async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setSearching(true); setSearchErr("");

    // First: check local cache
    const lower = q.toLowerCase();
    const localMatches = knownPlayers.filter(p =>
      p.name && p.name.toLowerCase().includes(lower)
    ).slice(0, 6);

    if (localMatches.length > 0) {
      setResults(localMatches);
      setSearching(false);
      return;
    }

    // Fallback: server proxy to RapidAPI search
    try {
      const res = await fetch(`/api/players/search?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResults([]);
        setSearchErr(data.error || "Search failed");
        return;
      }
      const players = (data.results || []).slice(0, 6);
      setResults(players);
      if (!players.length) setSearchErr("No players found");
    } catch { setSearchErr("Search failed"); }
    setSearching(false);
  }, [knownPlayers]);

  const handleChange = (val) => {
    setQuery(val);
    setResults([]); setSearchErr("");
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 400);
  };

  return (
    <div>
      <div className="relative">
        <input
          value={query}
          onChange={e => handleChange(e.target.value)}
          placeholder="Search player name..."
          className="w-full bg-input-bg border border-input-border rounded-[7px] px-3 py-2.5 text-text text-base"
        />
        {searching && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <div className="w-3.5 h-3.5 border-2 border-input-border border-t-accent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {searchErr && <div className="text-[13px] text-text-dim mt-1.5">{searchErr}</div>}

      {results.length > 0 && (
        <div className="bg-results-bg border border-input-border rounded-[7px] mt-1 overflow-hidden">
          {results.map((p, i) => {
            const already = existingIds.includes(p.id);
            return (
              <div key={p.id || i}
                className={`flex items-center justify-between px-3 py-2.5 ${i < results.length - 1 ? "border-b border-border-dark" : ""}`}>
                <div>
                  <div className="text-[13px] text-[#ccc]">{p.name}</div>
                  {p.country && <div className="text-[13px] text-text-muted">{p.country}</div>}
                </div>
                <button
                  disabled={already}
                  onClick={() => { onAdd({ id: p.id, name: p.name }); setQuery(""); setResults([]); }}
                  className={`border-none rounded-[5px] px-3 py-1 text-[13px] font-bold ${
                    already ? "bg-[#1a1a1a] text-text-dimmer cursor-default" : "bg-accent text-black cursor-pointer"
                  }`}>
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
const LS_FAV_VERSION = 1;

const DEFAULT_FAVOURITES = [
  { id: 258749, name: "Jack Draper" },
];

function loadFavourites() {
  try {
    const raw = localStorage.getItem(LS_KEY_FAV);
    if (!raw) return DEFAULT_FAVOURITES;

    const parsed = JSON.parse(raw);

    // Legacy format: plain array
    if (Array.isArray(parsed)) {
      return parsed.length > 0 ? parsed : DEFAULT_FAVOURITES;
    }

    // Versioned format
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.v === LS_FAV_VERSION &&
      Array.isArray(parsed.favourites)
    ) {
      return parsed.favourites.length > 0 ? parsed.favourites : DEFAULT_FAVOURITES;
    }
  } catch {}

  return DEFAULT_FAVOURITES;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function mergeFavourites(local, remote) {
  const seen = new Set();
  const merged = [];
  for (const f of [...remote, ...local]) {
    if (!seen.has(f.id)) { seen.add(f.id); merged.push(f); }
  }
  return merged;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function CourtCall() {
  const [favourites, setFavourites] = useState(() => loadFavourites());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [lastFetched, setLastFetched] = useState(null);

  // View toggle: "matches" or "rankings"
  const [view, setView] = useState("matches");

  // Rankings state
  const [rankingsCategory, setRankingsCategory] = useState("atp");
  const [rankings, setRankings] = useState([]);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsHasMore, setRankingsHasMore] = useState(false);
  const [rankingsTotal, setRankingsTotal] = useState(0);

  // Auth state
  const [user, setUser] = useState(null);         // { email, favourites } or null
  const [authLoading, setAuthLoading] = useState(false);
  const [authMsg, setAuthMsg] = useState("");       // "Check your email" etc.
  const [authEmail, setAuthEmail] = useState("");
  const authChecked = useRef(false);

  // Check auth on mount (non-blocking)
  useEffect(() => {
    if (authChecked.current) return;
    authChecked.current = true;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setUser(data);
        // Merge server favourites with localStorage
        const local = loadFavourites();
        const merged = mergeFavourites(local, data.favourites || []);
        setFavourites(merged);
        // Push merged set back to server
        fetch("/api/favourites", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ favourites: merged }),
        }).catch(() => {});
      })
      .catch(() => {});
  }, []);

  // Persist favourites whenever they change
  useEffect(() => {
    try {
      const payload = { v: LS_FAV_VERSION, favourites };
      localStorage.setItem(LS_KEY_FAV, JSON.stringify(payload));
    } catch {}
    // Sync to server if logged in
    if (user) {
      fetch("/api/favourites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ favourites }),
      }).catch(() => {});
    }
  }, [favourites]);

  const favouriteIds = favourites.map(f => f.id);

  const fetchEvents = useCallback(async (playerIds = favouriteIds) => {
    if (playerIds.length === 0) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/events?players=${playerIds.join(",")}`);
      const data = await res.json();
      setEvents(data.events || []);
      setLastFetched(data.cachedAt ? new Date(data.cachedAt) : new Date());
    } catch {
      setError("Could not load events from server.");
    }
    setLoading(false);
  }, [favouriteIds]);

  // Fetch on mount and re-fetch when favourites change
  useEffect(() => { fetchEvents(); }, [favouriteIds.join(",")]);

  const fetchRankingsData = useCallback(async (category, loadMore = false) => {
    setRankingsLoading(true);
    try {
      const offset = loadMore ? rankings.length : 0;
      const res = await fetch(`/api/rankings?category=${category}&limit=50&offset=${offset}`);
      const data = await res.json();
      const rows = data.rankings || [];
      setRankings(prev => loadMore ? [...prev, ...rows] : rows);
      setRankingsHasMore(data.hasMore ?? false);
      setRankingsTotal(data.total ?? 0);
    } catch { /* silently fail */ }
    setRankingsLoading(false);
  }, [rankings.length]);

  // Fetch rankings when switching to rankings view or changing category
  const prevView = useRef(view);
  const prevCategory = useRef(rankingsCategory);
  useEffect(() => {
    const viewChanged = view === "rankings" && prevView.current !== "rankings";
    const catChanged = view === "rankings" && rankingsCategory !== prevCategory.current;
    if (viewChanged || catChanged) fetchRankingsData(rankingsCategory);
    prevView.current = view;
    prevCategory.current = rankingsCategory;
  }, [view, rankingsCategory]);

  const filteredEvents = events;

  const grouped = filteredEvents.reduce((acc, e) => {
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
    <div className="min-h-screen bg-bg text-text font-sans p-4">
      <div className="max-w-[580px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">
              <span className="inline-flex items-center gap-1">
                <Circle size={24} fill="#e1ea18" stroke="#0c0c0c" strokeWidth={2} aria-hidden="true" />
                <span>Baseline</span>
              </span>
            </h1>
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            <span className="text-[13px] text-text-muted">
              {lastFetched ? `Updated ${lastFetched.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            <button
              onClick={() => view === "rankings" ? fetchRankingsData(rankingsCategory) : fetchEvents()}
              disabled={loading || rankingsLoading}
              title="Refresh"
              className="border border-border rounded-[7px] text-text-muted p-2 text-sm">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button onClick={() => setShowSettings(s => !s)}
              className={`border rounded-[7px] p-2 text-[13px] ${
                showSettings
                  ? "bg-settings-active-bg border-border-fav text-accent"
                  : "bg-transparent border-border text-text-muted"
              }`}>
                <Settings size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* View toggle + meta */}
        <div className="flex items-center justify-between mt-1 mb-4">
          <div className="flex bg-card border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setView("matches")}
              className={`px-3 py-1 text-[13px] font-semibold ${
                view === "matches" ? "bg-settings-active-bg text-accent" : "text-text-muted"
              }`}>
              Matches
            </button>
            <button
              onClick={() => setView("rankings")}
              className={`px-3 py-1 text-[13px] font-semibold ${
                view === "rankings" ? "bg-settings-active-bg text-accent" : "text-text-muted"
              }`}>
              Rankings
            </button>
          </div>
          <p className="text-sm text-text-muted flex items-center gap-1">
            {/* {USER_TZ_SHORT} · {favourites.length} <Star aria-label="tracked" className="inline w-3.5 h-3.5 text-accent fill-accent shrink-0 translate-y-px" /> */}
          </p>
        </div>

        {/* Settings */}
        {showSettings && (
          <div className="bg-settings-bg border border-border rounded-[10px] p-[18px] mb-4">

            {/* Tracked Players */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Tracked Players
              </div>
              {favourites.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {favourites.map(f => (
                    <span key={f.id} className="bg-fav-chip-bg border border-fav-chip-border text-accent pl-2 pr-2.5 py-1 rounded-[5px] text-[13px] flex items-center gap-1.5">
                      <Star aria-hidden="true" size={14} className="text-accent fill-accent" />
                      <span>{f.name}</span>
                      <button onClick={() => setFavourites(fvs => fvs.filter(x => x.id !== f.id))}
                        aria-label={`Remove ${f.name}`}
                        className="text-text-muted p-0 leading-none inline-flex items-center">
                        <X size={14} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-text-dark mb-2.5">No players tracked yet</div>
              )}
            </div>

            {/* Player Search */}
            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-[7px]">Add Player</div>
              <PlayerSearch
                existingIds={favouriteIds}
                onAdd={player => setFavourites(fvs => [...fvs, player])}
              />
            </div>

            {/* Sync */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Sync across devices
              </div>
              {user ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[13px]">
                    <Check size={14} className="text-win" />
                    <span className="text-text-muted">{user.email}</span>
                  </div>
                  <button
                    onClick={async () => {
                      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
                      setUser(null);
                      setAuthMsg("");
                    }}
                    className="flex items-center gap-1.5 text-[13px] text-text-muted border border-border rounded-[5px] px-2.5 py-1">
                    <LogOut size={13} aria-hidden="true" />
                    <span>Log out</span>
                  </button>
                </div>
              ) : authMsg ? (
                <div className="flex items-center gap-2 text-[13px] text-text-muted">
                  <Mail size={14} />
                  <span>{authMsg}</span>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const email = authEmail.trim().toLowerCase();
                    if (!email) return;
                    setAuthLoading(true);
                    setAuthMsg("");
                    try {
                      const res = await fetch("/api/auth/login", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "same-origin",
                        body: JSON.stringify({ email }),
                      });
                      const data = await res.json();
                      if (res.ok) {
                        setAuthMsg("Check your email for a login link");
                      } else {
                        setAuthMsg(data.error || "Something went wrong");
                      }
                    } catch {
                      setAuthMsg("Could not reach server");
                    }
                    setAuthLoading(false);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="email"
                    placeholder="Email address"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    required
                    className="flex-1 bg-input-bg border border-input-border rounded-[6px] px-2.5 py-1.5 text-[13px] text-text"
                  />
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="bg-accent text-black font-bold rounded-[6px] px-3 py-1.5 text-[13px] shrink-0"
                  >
                    {authLoading ? "Sending..." : "Send link"}
                  </button>
                </form>
              )}
              {!user && !authMsg && (
                <p className="text-[11px] text-text-dark mt-1.5">Sign in to sync tracked players across devices</p>
              )}
            </div>
          </div>
        )}

        {/* Rankings view */}
        {view === "rankings" && (
          <div className="mb-4">
            <div className="flex gap-1 mb-3">
              {["atp", "wta"].map(cat => (
                <button
                  key={cat}
                  onClick={() => setRankingsCategory(cat)}
                  className={`px-3 py-1 rounded-md text-[13px] font-semibold uppercase ${
                    rankingsCategory === cat
                      ? "bg-settings-active-bg text-accent"
                      : "text-text-muted"
                  }`}>
                  {cat}
                </button>
              ))}
            </div>
            {rankingsLoading && rankings.length === 0 ? (
              <div className="text-center py-15">
                <div className="w-[26px] h-[26px] border-3 border-border-dark border-t-accent rounded-full animate-spin mx-auto mb-2.5" />
                <div className="text-[13px] text-text-muted">Loading rankings...</div>
              </div>
            ) : rankings.length === 0 ? (
              <div className="text-center py-15">
                <div className="text-text-dimmer text-sm">No ranking data available</div>
                <div className="text-text-darkest text-[13px] mt-1.5">Rankings are fetched hourly</div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  {rankings.map(r => {
                    const isFav = favouriteIds.includes(r.player_id);
                    const movement = r.previous_ranking ? r.previous_ranking - r.ranking : 0;
                    return (
                      <div key={r.player_id} className={`flex items-center gap-3 py-2 px-3 rounded-lg border ${
                        isFav
                          ? "bg-gradient-to-br from-card-fav to-card-fav-hover border-border-fav"
                          : "bg-card border-border-dark"
                      }`}>
                        <div className={`self-start text-lg font-extrabold font-mono w-8 text-right shrink-0 ${isFav ? "text-accent" : "text-text-muted"}`}>
                          {r.ranking}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                if (isFav) {
                                  setFavourites(fvs => fvs.filter(x => x.id !== r.player_id));
                                } else {
                                  setFavourites(fvs => [...fvs, { id: r.player_id, name: r.player_name }]);
                                }
                              }}
                              aria-label={isFav ? `Untrack ${r.player_name}` : `Track ${r.player_name}`}
                              className="shrink-0 p-0 leading-none">
                              <Star size={13} className={isFav ? "text-accent fill-accent" : "text-text-darkest"} />
                            </button>
                            <span className={`text-sm truncate font-mono ${isFav ? "font-bold text-accent" : "font-medium text-text"}`}>{r.player_name}</span>
                          </div>
                          <div className="text-sm text-text-muted truncate">
                            {r.country && <span>{r.country}</span>}
                            {r.national_rank != null && (
                              <span className="text-[11px] text-text-muted ml-1 font-mono font-normal">{r.national_rank}</span>
                            )}
                            {r.country && r.next_win_points != null && <span> · </span>}
                            {r.next_win_points != null && <span className="text-text">Next win <b>{r.next_win_points.toLocaleString()}</b></span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col">
                          <div>{r.points?.toLocaleString() ?? "—"}</div>
                          <div>
                          {movement !== 0 && (
                            <div className={`flex justify-end items-center gap-0.5 text-[13px] font-bold ${movement > 0 ? "text-win" : "text-live"}`}>
                              {movement > 0 ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              <span>{Math.abs(movement)}</span>
                            </div>
                          )}
                          {movement === 0 && r.previous_ranking && (
                            <div className="text-[13px] text-text-dim font-bold">—</div>
                          )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {rankingsHasMore && (
                  <button
                    onClick={() => fetchRankingsData(rankingsCategory, true)}
                    disabled={rankingsLoading}
                    className="w-full p-2.5 border border-border rounded-lg text-text-muted text-[13px] mt-3">
                    {rankingsLoading ? "Loading..." : `Load more (showing ${rankings.length} of ${rankingsTotal})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Match list */}
        {view === "matches" && (<>
          {/* Error */}
          {error && (
            <div className="px-[13px] py-2.5 bg-error-bg border border-error-border rounded-lg text-error-text text-[13px] mb-3">
              <span className="inline-flex items-center gap-2">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{error}</span>
              </span>
            </div>
          )}

          {/* Loading */}
          {loading ? (
            <div className="text-center py-15">
              <div className="w-[26px] h-[26px] border-3 border-border-dark border-t-accent rounded-full animate-spin mx-auto mb-2.5" />
              <div className="text-[13px] text-text-muted">Loading matches...</div>
            </div>
          ) : visibleDates.length === 0 && !error ? (
            <div className="text-center py-15">
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-fav-chip-bg border border-fav-chip-border mb-2.5">
                <Circle size={22} fill="#f5c842" stroke="#0c0c0c" strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="text-text-dimmer text-sm">{favouriteIds.length === 0 ? "No players tracked" : "No upcoming matches found"}</div>
              <div className="text-text-darkest text-[13px] mt-1.5">{favouriteIds.length === 0 ? "Add players in Settings to see their matches" : "Check back later for new fixtures"}</div>
            </div>
          ) : (
            <>
              {visibleDates.map(date => (
                <div key={date} className="mb-[22px]">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span className={`font-bold ${date === todayKey() ? "text-base" : "text-text-muted"}`}>
                      {fmtDayLabel(date)}
                    </span>
                    <div className="flex-1 h-px bg-divider" />
                    <span className="text-sm text-text-dim">
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
                  className="w-full p-2.5 border border-border rounded-lg text-text-muted text-[13px] mt-1">
                  Show {hiddenCount} more day{hiddenCount !== 1 ? "s" : ""} this month →
                </button>
              )}
            </>
          )}
        </>)}

        <div className="text-center mt-9 text-text-muted text-[13px]">
           <span className="inline-flex items-center gap-1">
             <Globe size={15} stroke="#555" aria-hidden="true" />
             {USER_TZ}
           </span>
        </div>
        <div className="text-center mt-2 text-text-muted text-[13px]">
          Tennis player tracker · By <a href="https://x.com/dr" target="_blank" rel="noopener noreferrer">@dr</a>
        </div>
      </div>
    </div>
  );
}
