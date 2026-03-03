import { useState, useEffect, useRef } from "react";
import "./App.css";

const API = "http://127.0.0.1:8080/api";

const VIBE_EXAMPLES = [
  "Lifting / Running, Chill & Lofi, Festival & Pregame, Old School",
  "Deep House, Tech House, Progressive, Melodic, Vocal",
  "Dark & Moody, Uplifting & Euphoric, Chill Vibes, Peak Energy",
  "Morning Coffee, Afternoon Focus, Night Out, Late Night Drive",
  "90s Classics, 2000s Throwbacks, 2010s Hits, New School",
  "Workout Bangers, Study & Focus, Party Starters, Wind Down",
];

const PLAYLIST_COUNT_OPTIONS = [3, 4, 5, 6, 7, 8, 10];

const PIPELINE_STEPS = [
  { key: "extract", icon: "📡", title: "Reading your playlist", desc: "Pulling every track from Spotify's API — no 100-song cap", detail: "Paginating through the entire playlist to grab all tracks, artists, and URIs" },
  { key: "suggest", icon: "🧠", title: "AI analyzing your music", desc: "Sampling tracks and creating categories that match your vibe", detail: "Sending a representative sample to Llama 3.3 to generate smart category names" },
  { key: "classify", icon: "🏷️", title: "Classifying every track", desc: "AI is sorting each song into the right playlist(s)", detail: "Processing tracks in batches of 50 — each one gets placed where it fits best" },
  { key: "create", icon: "🎧", title: "Building your playlists", desc: "Creating new playlists and adding tracks to your Spotify", detail: "Creating each playlist on your account and populating them via the Spotify API" },
  { key: "done", icon: "✅", title: "All done!", desc: "Your new playlists are ready to play", detail: "" },
];

const MIX_PIPELINE_STEPS = [
  { key: "extract", icon: "📡", title: "Reading your playlist", desc: "Pulling every track from Spotify", detail: "Grabbing all tracks, artists, and URIs" },
  { key: "features", icon: "🎛️", title: "Analyzing audio features", desc: "BPM, key, energy, danceability for every track", detail: "Fetching from Spotify Audio Features API (with AI fallback)" },
  { key: "order", icon: "🔀", title: "Computing optimal order", desc: "Camelot wheel + BPM matching + energy arc", detail: "Nearest-neighbor TSP through multi-dimensional transition space" },
  { key: "transitions", icon: "🎚️", title: "Building DJ transitions", desc: "Crossfade timing, EQ strategy, transition style for each pair", detail: "Analyzing energy deltas, key compatibility, BPM distance for each transition" },
  { key: "done", icon: "✅", title: "Mix ready!", desc: "Your DJ-optimized playlist is ready", detail: "" },
];

const STYLE_ICONS = {
  "Beatmatch Blend": "🔄",
  "Fade": "🌊",
  "Rise": "📈",
  "Echo Out": "🌀",
  "Cut": "⚡",
  "Filter Cut": "🎛️",
};

const STYLE_COLORS = {
  "Beatmatch Blend": "#1db954",
  "Fade": "#3b82f6",
  "Rise": "#f59e0b",
  "Echo Out": "#8b5cf6",
  "Cut": "#ef4444",
  "Filter Cut": "#ec4899",
};

function App() {
  const [user, setUser] = useState(null);
  const [authUrl, setAuthUrl] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Mode: "split" or "mix"
  const [mode, setMode] = useState("split");

  // ── Split state ─────────────────────────────
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [playlistInfo, setPlaylistInfo] = useState(null);
  const [tracks, setTracks] = useState(null);

  const [numPlaylists, setNumPlaylists] = useState(5);
  const [vibeText, setVibeText] = useState("");
  const [mindset, setMindset] = useState("");
  const [allowDupes, setAllowDupes] = useState(true);
  const [enableMix, setEnableMix] = useState(false);
  const [suggestedCategories, setSuggestedCategories] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [editableCats, setEditableCats] = useState([]);

  const [splitting, setSplitting] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(-1);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);

  // ── Mix state ───────────────────────────────
  const [mixLoading, setMixLoading] = useState(false);
  const [mixStep, setMixStep] = useState(-1);
  const [mixResults, setMixResults] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [reorderDone, setReorderDone] = useState(false);
  const [expandedTransition, setExpandedTransition] = useState(null);

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (splitting || loadingInfo || mixLoading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [splitting, loadingInfo, mixLoading]);

  // ── Auth ────────────────────────────────────
  const handleLogout = async () => {
    await fetch(`${API}/logout`, { method: "POST" });
    setUser(null);
    setAuthUrl("");
    resetAll();
    setCheckingAuth(true);
    try {
      const r = await fetch(`${API}/auth`);
      const data = await r.json();
      if (data.auth_url) setAuthUrl(data.auth_url);
    } catch {}
    setCheckingAuth(false);
  };

  useEffect(() => {
    fetch(`${API}/auth`)
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) setUser(data.user);
        else if (data.auth_url) setAuthUrl(data.auth_url);
      })
      .catch(() => {})
      .finally(() => setCheckingAuth(false));
  }, []);

  // ── Reset ───────────────────────────────────
  const resetAll = () => {
    setPlaylistUrl("");
    setPlaylistInfo(null);
    setTracks(null);
    setSuggestedCategories(null);
    setEditingCategories(false);
    setEditableCats([]);
    setResults(null);
    setMixResults(null);
    setReorderDone(false);
    setExpandedTransition(null);
    setError("");
    setPipelineStep(-1);
    setMixStep(-1);
    setNumPlaylists(5);
    setVibeText("");
    setMindset("");
    setAllowDupes(true);
    setEnableMix(false);
  };

  // ── Phase 1: Load playlist ──────────────────
  const handleLoadPlaylist = async () => {
    if (!playlistUrl.trim()) return;
    setError("");
    setResults(null);
    setMixResults(null);
    setReorderDone(false);
    setSuggestedCategories(null);
    setEditingCategories(false);
    setLoadingInfo(true);

    try {
      const [infoRes, extractRes] = await Promise.all([
        fetch(`${API}/playlist/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlist_id: playlistUrl }),
        }),
        fetch(`${API}/playlist/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlist_id: playlistUrl }),
        }),
      ]);

      const infoData = await infoRes.json();
      const extractData = await extractRes.json();

      if (infoData.error) throw new Error(infoData.error);
      if (extractData.error) throw new Error(extractData.error);

      setPlaylistInfo(infoData);
      setTracks(extractData.tracks);
    } catch (err) {
      setError(err.message || "Failed to load playlist.");
    } finally {
      setLoadingInfo(false);
    }
  };

  // ── Phase 2: Get AI category suggestions ────
  const handleSuggestCategories = async () => {
    if (!tracks) return;
    setLoadingSuggestions(true);
    setError("");

    const vibeHint = vibeText.trim() || null;
    const mindsetHint = mindset.trim() || null;
    const combinedHint = [vibeHint, mindsetHint ? `User mindset: ${mindsetHint}` : null].filter(Boolean).join(". ") || null;

    try {
      const res = await fetch(`${API}/suggest-categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks, num_playlists: numPlaylists, vibe_hint: combinedHint }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuggestedCategories(data.categories);
      setEditableCats(data.categories);
    } catch (err) {
      setError(err.message || "Failed to suggest categories.");
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // ── Phase 3: Split ─────────────────────────
  const handleSplit = async () => {
    if (!tracks || !suggestedCategories) return;
    setError("");
    setResults(null);
    setSplitting(true);

    const categories = editingCategories ? editableCats.filter((c) => c.trim()) : suggestedCategories;

    try {
      setPipelineStep(2);
      const classifyRes = await fetch(`${API}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks, categories, allow_duplicates: allowDupes, mindset }),
      });
      const classifyData = await classifyRes.json();
      if (classifyData.error) throw new Error(classifyData.error);

      setPipelineStep(3);
      const splitRes = await fetch(`${API}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categorized: classifyData.categorized,
          source_name: playlistInfo?.name || "Playlist",
          enable_mix: enableMix,
        }),
      });
      const splitData = await splitRes.json();
      if (splitData.error) throw new Error(splitData.error);

      setPipelineStep(4);
      setResults({
        summary: classifyData.summary,
        playlist_ids: splitData.playlist_ids,
        message: splitData.message,
        mix_stats: splitData.mix_stats,
      });
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSplitting(false);
    }
  };

  // ── Mix: Analyze ────────────────────────────
  const handleMixAnalyze = async () => {
    if (!tracks) return;
    setError("");
    setMixResults(null);
    setReorderDone(false);
    setMixLoading(true);
    setExpandedTransition(null);

    try {
      setMixStep(1); // features
      await new Promise((r) => setTimeout(r, 300));

      setMixStep(2); // ordering
      const res = await fetch(`${API}/mix/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMixStep(3); // transitions
      await new Promise((r) => setTimeout(r, 400));

      setMixStep(4); // done
      setMixResults(data);
    } catch (err) {
      setError(err.message || "Mix analysis failed.");
    } finally {
      setMixLoading(false);
    }
  };

  // ── Mix: Reorder on Spotify ─────────────────
  const handleReorder = async () => {
    if (!mixResults || !playlistUrl) return;
    setReordering(true);
    setError("");

    try {
      const res = await fetch(`${API}/mix/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlist_id: playlistUrl,
          ordered_uris: mixResults.ordered_tracks.map((t) => t.uri),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReorderDone(true);
    } catch (err) {
      setError(err.message || "Failed to reorder playlist.");
    } finally {
      setReordering(false);
    }
  };

  const activeIdx = pipelineStep >= 0 ? pipelineStep : -1;
  const progress = pipelineStep >= 0 ? Math.min(((pipelineStep + 1) / PIPELINE_STEPS.length) * 100, 100) : 0;
  const mixProgress = mixStep >= 0 ? Math.min(((mixStep + 1) / MIX_PIPELINE_STEPS.length) * 100, 100) : 0;
  const showCustomization = tracks && !results && !splitting && !mixResults && !mixLoading;

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const scoreColor = (score) => {
    if (score >= 85) return "#1db954";
    if (score >= 70) return "#3b82f6";
    if (score >= 50) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div className="app">
      {/* ── Header ──────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <svg className="logo" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          <h1>Spotify <span>Splitter</span></h1>
        </div>
        {user && (
          <div className="user-badge">
            {user.image && <img className="user-avatar" src={user.image} alt="" />}
            <span className="user-name">{user.name}</span>
            <button className="btn-logout" onClick={handleLogout}>Log out</button>
          </div>
        )}
      </header>

      {/* ── Main ──────────────────────────────── */}
      <main className="main">
        {checkingAuth ? (
          <section className="hero-section">
            <div className="pulse-ring" />
            <p className="fade-text">Connecting to Spotify…</p>
          </section>
        ) : !user ? (
          <section className="hero-section">
            <div className="hero-glow" />
            <h2 className="hero-title">Split your playlist<br /><span>by vibe</span></h2>
            <p className="hero-sub">AI-powered playlist splitter &amp; DJ mix engine.</p>
            {authUrl ? (
              <a className="btn-spotify" href={authUrl}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                Login with Spotify
              </a>
            ) : (
              <div className="error-banner">Could not reach the backend. Make sure the server is running on port 8080.</div>
            )}
            <div className="hero-features">
              <div className="feature-pill"><span>🎯</span> Custom categories</div>
              <div className="feature-pill"><span>🧠</span> AI-powered</div>
              <div className="feature-pill"><span>🎚️</span> DJ Mix engine</div>
              <div className="feature-pill"><span>♾️</span> No track limit</div>
            </div>
          </section>
        ) : (
          <>
            {/* ── Mode Selector ──────────────── */}
            <section className="mode-selector">
              <button
                className={`mode-btn ${mode === "split" ? "mode-active" : ""}`}
                onClick={() => { setMode("split"); resetAll(); }}
              >
                <span className="mode-icon">✂️</span>
                <span className="mode-label">Split</span>
                <span className="mode-desc">Split into vibe playlists</span>
              </button>
              <button
                className={`mode-btn ${mode === "mix" ? "mode-active" : ""}`}
                onClick={() => { setMode("mix"); resetAll(); }}
              >
                <span className="mode-icon">🎧</span>
                <span className="mode-label">Mix</span>
                <span className="mode-desc">DJ-optimize transitions</span>
              </button>
            </section>

            {/* ── URL Input ──────────────────── */}
            <section className="input-section">
              <h2>{mode === "split" ? "Split your playlist by vibe" : "Optimize your playlist for mixing"}</h2>
              <p>{mode === "split" ? "Paste a Spotify playlist link to get started." : "Paste a playlist and we'll analyze every transition like a DJ."}</p>
              <div className="input-row">
                <input
                  type="text"
                  placeholder="https://open.spotify.com/playlist/..."
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLoadPlaylist()}
                  disabled={loadingInfo || splitting || mixLoading}
                />
                <button
                  className="btn-primary"
                  onClick={tracks ? resetAll : handleLoadPlaylist}
                  disabled={loadingInfo || splitting || mixLoading || (!tracks && !playlistUrl.trim())}
                >
                  {loadingInfo ? "Loading…" : tracks ? "New Playlist" : "Load Playlist"}
                </button>
              </div>
            </section>

            {/* ── Error ────────────────────── */}
            {error && <div className="error-banner">{error}</div>}

            {/* ── Loading playlist ──────────── */}
            {loadingInfo && (
              <section className="pipeline-section">
                <div className="pipeline-card">
                  <div className="pipeline-visual"><div className="vinyl-spin" /></div>
                  <h3>Reading your playlist…</h3>
                  <p className="pipeline-desc">Fetching every single track from Spotify</p>
                  <div className="pipeline-timer">{formatTime(elapsed)}</div>
                  <div className="pipeline-bar-wrap"><div className="pipeline-bar pipeline-bar-indeterminate" /></div>
                </div>
              </section>
            )}

            {/* ── Playlist preview ─────────── */}
            {playlistInfo && !loadingInfo && (
              <div className="playlist-preview">
                {playlistInfo.image_url && <img src={playlistInfo.image_url} alt="" />}
                <div className="playlist-preview-info">
                  <h3>{playlistInfo.name}</h3>
                  <p>{playlistInfo.owner} &middot; {tracks ? tracks.length : playlistInfo.total_tracks} tracks</p>
                </div>
                {tracks && <div className="preview-badge">{tracks.length} tracks loaded</div>}
              </div>
            )}

            {/* ═══════════════════════════════════════════ */}
            {/* ── SPLIT MODE ──────────────────────────── */}
            {/* ═══════════════════════════════════════════ */}

            {mode === "split" && (
              <>
                {/* ── Customization ──────────── */}
                {showCustomization && !suggestedCategories && (
                  <section className="customize-section">
                    <h2>How should we split it?</h2>

                    <div className="option-group">
                      <label className="option-label">How many playlists?</label>
                      <div className="chip-row">
                        {PLAYLIST_COUNT_OPTIONS.map((n) => (
                          <button key={n} className={`chip ${numPlaylists === n ? "chip-active" : ""}`} onClick={() => setNumPlaylists(n)}>{n}</button>
                        ))}
                      </div>
                    </div>

                    <div className="option-group">
                      <label className="option-label">Describe how you want it split</label>
                      <p className="option-hint">Type your own categories or leave blank to let AI decide</p>
                      <textarea className="vibe-textarea" placeholder='e.g. "Lifting / Running, Chill & Lofi, Festival & Pregame, Old School"' value={vibeText} onChange={(e) => setVibeText(e.target.value)} rows={2} />
                      <div className="example-chips">
                        {VIBE_EXAMPLES.map((ex, i) => (
                          <button key={i} className="example-chip" onClick={() => { setVibeText(ex); setNumPlaylists(ex.split(",").length); }}>
                            {ex.split(",").slice(0, 2).map((s) => s.trim()).join(", ")}…
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="option-group">
                      <label className="option-label">Your mindset <span className="optional-tag">(optional)</span></label>
                      <p className="option-hint">Tell the AI how YOU think about your music so it classifies the way you would</p>
                      <textarea className="vibe-textarea" placeholder='e.g. "heavy driving basslines = lifting, groovy melodic = chill, high energy builds with drops = festival/pregame"' value={mindset} onChange={(e) => setMindset(e.target.value)} rows={2} />
                    </div>

                    <div className="option-group">
                      <label className="toggle-row" onClick={() => setAllowDupes(!allowDupes)}>
                        <span className={`toggle-switch ${allowDupes ? "toggle-on" : ""}`}><span className="toggle-knob" /></span>
                        <span className="toggle-text">
                          Allow songs in multiple playlists
                          <span className="toggle-desc">A chill track that also works for pregame can go in both</span>
                        </span>
                      </label>
                    </div>

                    <div className="option-group">
                      <label className="toggle-row" onClick={() => setEnableMix(!enableMix)}>
                        <span className={`toggle-switch ${enableMix ? "toggle-on" : ""}`}><span className="toggle-knob" /></span>
                        <span className="toggle-text">
                          Mix-optimize track order
                          <span className="toggle-desc">Reorder tracks in each playlist for seamless DJ-style transitions (BPM + key matching)</span>
                        </span>
                      </label>
                    </div>

                    <button className="btn-primary btn-wide" onClick={handleSuggestCategories} disabled={loadingSuggestions}>
                      {loadingSuggestions ? (<><span className="spinner-inline" /> Generating categories…</>) : ("Generate Categories with AI")}
                    </button>
                  </section>
                )}

                {/* ── Category review ──────────── */}
                {suggestedCategories && !results && !splitting && (
                  <section className="categories-section">
                    <h2>Your playlist categories</h2>
                    <p className="section-subtitle">AI suggested these based on your {tracks.length} tracks. Edit or approve them.</p>

                    <div className="category-list">
                      {(editingCategories ? editableCats : suggestedCategories).map((cat, i) => (
                        <div key={i} className="category-item" style={{ animationDelay: `${i * 0.06}s` }}>
                          <span className="category-number">{i + 1}</span>
                          {editingCategories ? (
                            <input className="category-edit-input" value={editableCats[i]} onChange={(e) => { const copy = [...editableCats]; copy[i] = e.target.value; setEditableCats(copy); }} />
                          ) : (
                            <span className="category-name">{cat}</span>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="category-actions">
                      <button className="btn-secondary" onClick={() => { if (editingCategories) setEditingCategories(false); else { setEditableCats([...suggestedCategories]); setEditingCategories(true); } }}>
                        {editingCategories ? "Done Editing" : "Edit Categories"}
                      </button>
                      <button className="btn-secondary" onClick={() => { setSuggestedCategories(null); setEditingCategories(false); }}>Change Options</button>
                      <button className="btn-primary" onClick={handleSplit}>Split {tracks.length} Tracks</button>
                    </div>
                  </section>
                )}

                {/* ── Pipeline Progress ────────── */}
                {splitting && (
                  <section className="pipeline-section">
                    <div className="pipeline-card pipeline-card-lg">
                      <div className="pipeline-header">
                        <h3>Splitting your playlist</h3>
                        <span className="pipeline-timer">{formatTime(elapsed)}</span>
                      </div>
                      <div className="pipeline-bar-wrap"><div className="pipeline-bar" style={{ width: `${progress}%` }} /></div>
                      <div className="pipeline-steps">
                        {PIPELINE_STEPS.map((s, i) => {
                          const status = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
                          return (
                            <div key={s.key} className={`pipeline-step pipeline-step-${status}`}>
                              <div className="step-indicator">
                                {status === "done" ? (
                                  <svg viewBox="0 0 20 20" fill="currentColor" className="check-icon"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                ) : status === "active" ? (<div className="step-pulse" />) : (<span className="step-dot" />)}
                              </div>
                              <div className="step-content">
                                <div className="step-title"><span className="step-icon">{s.icon}</span>{s.title}</div>
                                {status === "active" && (<div className="step-detail-wrap"><p className="step-desc">{s.desc}</p><p className="step-detail">{s.detail}</p></div>)}
                                {status === "done" && <p className="step-desc">{s.desc}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}

                {/* ── Results ──────────────────── */}
                {results && (
                  <section className="results-wrapper">
                    <div className="success-banner">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="success-icon"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      {results.message}
                    </div>

                    <h2 className="results-title">Your new playlists</h2>
                    {allowDupes && <p className="section-subtitle">Some tracks appear in multiple playlists — totals may exceed {tracks?.length}</p>}

                    <div className="results-grid">
                      {Object.entries(results.summary)
                        .sort(([, a], [, b]) => b - a)
                        .map(([category, count], i) => (
                          <div className="result-card" key={category} style={{ animationDelay: `${i * 0.08}s` }}>
                            <div className="result-card-inner">
                              <h4>{category}</h4>
                              <div className="track-count">{count}</div>
                              <div className="track-label">tracks</div>
                              {results.mix_stats && results.mix_stats[category] && (
                                <div className="mix-badge">
                                  <span className="mix-badge-icon">🎧</span>
                                  Mix score: {results.mix_stats[category].avg_score}%
                                </div>
                              )}
                            </div>
                            {results.playlist_ids[category] && (
                              <a className="open-link" href={`https://open.spotify.com/playlist/${results.playlist_ids[category]}`} target="_blank" rel="noopener noreferrer">
                                Open in Spotify
                                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                              </a>
                            )}
                          </div>
                        ))}
                    </div>

                    <button className="btn-primary btn-wide" style={{ marginTop: 32 }} onClick={resetAll}>Split Another Playlist</button>
                  </section>
                )}
              </>
            )}

            {/* ═══════════════════════════════════════════ */}
            {/* ── MIX MODE ────────────────────────────── */}
            {/* ═══════════════════════════════════════════ */}

            {mode === "mix" && (
              <>
                {/* ── Analyze button ─────────── */}
                {showCustomization && (
                  <section className="mix-start-section">
                    <div className="mix-info-card">
                      <h3>🎧 DJ Mix Engine</h3>
                      <p>We'll analyze every track's BPM, musical key, energy, and danceability — then compute the perfect track order with DJ-grade transition instructions for each pair.</p>
                      <div className="mix-features-row">
                        <div className="mix-feature"><span>🔑</span>Camelot Key Matching</div>
                        <div className="mix-feature"><span>🥁</span>BPM Compatibility</div>
                        <div className="mix-feature"><span>⚡</span>Energy Arc</div>
                        <div className="mix-feature"><span>🎚️</span>Custom Transitions</div>
                        <div className="mix-feature"><span>🎛️</span>EQ Strategy</div>
                        <div className="mix-feature"><span>⏱️</span>Crossfade Timing</div>
                      </div>
                    </div>
                    <button className="btn-primary btn-wide btn-mix" onClick={handleMixAnalyze}>
                      Analyze {tracks.length} Tracks for Mix
                    </button>
                  </section>
                )}

                {/* ── Mix Pipeline Progress ──── */}
                {mixLoading && (
                  <section className="pipeline-section">
                    <div className="pipeline-card pipeline-card-lg pipeline-card-mix">
                      <div className="pipeline-header">
                        <h3>🎧 Analyzing for mix</h3>
                        <span className="pipeline-timer">{formatTime(elapsed)}</span>
                      </div>
                      <div className="pipeline-bar-wrap"><div className="pipeline-bar pipeline-bar-mix" style={{ width: `${mixProgress}%` }} /></div>
                      <div className="pipeline-steps">
                        {MIX_PIPELINE_STEPS.map((s, i) => {
                          const status = i < mixStep ? "done" : i === mixStep ? "active" : "pending";
                          return (
                            <div key={s.key} className={`pipeline-step pipeline-step-${status}`}>
                              <div className="step-indicator">
                                {status === "done" ? (
                                  <svg viewBox="0 0 20 20" fill="currentColor" className="check-icon"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                ) : status === "active" ? (<div className="step-pulse" />) : (<span className="step-dot" />)}
                              </div>
                              <div className="step-content">
                                <div className="step-title"><span className="step-icon">{s.icon}</span>{s.title}</div>
                                {status === "active" && (<div className="step-detail-wrap"><p className="step-desc">{s.desc}</p><p className="step-detail">{s.detail}</p></div>)}
                                {status === "done" && <p className="step-desc">{s.desc}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}

                {/* ── Mix Results ─────────────── */}
                {mixResults && (
                  <section className="mix-results">
                    {/* Stats banner */}
                    <div className="mix-stats-banner">
                      <div className="mix-stat">
                        <div className="mix-stat-value" style={{ color: scoreColor(mixResults.stats.avg_score) }}>{mixResults.stats.avg_score}%</div>
                        <div className="mix-stat-label">Avg Score</div>
                      </div>
                      <div className="mix-stat">
                        <div className="mix-stat-value" style={{ color: scoreColor(mixResults.stats.min_score) }}>{mixResults.stats.min_score}%</div>
                        <div className="mix-stat-label">Min Score</div>
                      </div>
                      <div className="mix-stat">
                        <div className="mix-stat-value">{mixResults.stats.total_tracks}</div>
                        <div className="mix-stat-label">Tracks</div>
                      </div>
                      <div className="mix-stat">
                        <div className="mix-stat-value mix-stat-source">{mixResults.feature_source === "spotify" ? "Spotify" : "AI"}</div>
                        <div className="mix-stat-label">Data Source</div>
                      </div>
                    </div>

                    {/* Reorder action */}
                    <div className="mix-actions">
                      {!reorderDone ? (
                        <button className="btn-primary btn-mix btn-reorder" onClick={handleReorder} disabled={reordering}>
                          {reordering ? (<><span className="spinner-inline" /> Reordering on Spotify…</>) : "Apply This Order to Spotify"}
                        </button>
                      ) : (
                        <div className="success-banner">
                          <svg viewBox="0 0 20 20" fill="currentColor" className="success-icon"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                          Playlist reordered! Open it in Spotify and hit Mix for perfect transitions.
                        </div>
                      )}
                    </div>

                    {/* Transition list */}
                    <h2 className="mix-section-title">Transition Breakdown</h2>
                    <p className="section-subtitle">Click any transition for DJ-grade mixing instructions</p>

                    <div className="transition-list">
                      {mixResults.ordered_tracks.map((track, i) => (
                        <div key={track.uri || i}>
                          {/* Track row */}
                          <div className="track-row">
                            <div className="track-num">{i + 1}</div>
                            <div className="track-info-col">
                              <div className="track-title">{track.name}</div>
                              <div className="track-artist">{track.artist}</div>
                            </div>
                            <div className="track-meta">
                              {track.bpm > 0 && <span className="meta-pill meta-bpm">{track.bpm} BPM</span>}
                              {track.key && <span className="meta-pill meta-key">{track.key}</span>}
                              {track.energy > 0 && (
                                <span className="meta-pill meta-energy">
                                  <span className="energy-bar-mini" style={{ width: `${track.energy * 100}%` }} />
                                  {Math.round(track.energy * 100)}%
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Transition card (between tracks) */}
                          {i < mixResults.transitions.length && (() => {
                            const t = mixResults.transitions[i];
                            const isExpanded = expandedTransition === i;
                            return (
                              <div
                                className={`transition-card ${isExpanded ? "transition-expanded" : ""}`}
                                onClick={() => setExpandedTransition(isExpanded ? null : i)}
                              >
                                <div className="transition-summary">
                                  <div className="transition-score-ring" style={{ borderColor: scoreColor(t.score) }}>
                                    <span>{t.score}</span>
                                  </div>
                                  <div className="transition-style-badge" style={{ background: STYLE_COLORS[t.style] || "#666" }}>
                                    {STYLE_ICONS[t.style] || "🎵"} {t.style}
                                  </div>
                                  <div className="transition-quick-info">
                                    <span>{t.bpm_a} → {t.bpm_b} BPM</span>
                                    <span className="transition-dot">·</span>
                                    <span>{t.key_a || "?"} → {t.key_b || "?"}</span>
                                    <span className="transition-dot">·</span>
                                    <span className={`harmonic-tag harmonic-${t.harmonic?.toLowerCase()}`}>{t.harmonic}</span>
                                  </div>
                                  <div className="transition-expand-arrow">{isExpanded ? "▲" : "▼"}</div>
                                </div>

                                {isExpanded && (
                                  <div className="transition-details">
                                    <div className="transition-detail-grid">
                                      <div className="detail-card">
                                        <div className="detail-label">Crossfade</div>
                                        <div className="detail-value">{t.crossfade_sec}s</div>
                                      </div>
                                      <div className="detail-card">
                                        <div className="detail-label">Mix Out</div>
                                        <div className="detail-value">{t.mix_out_bars} bars</div>
                                      </div>
                                      <div className="detail-card">
                                        <div className="detail-label">Mix In</div>
                                        <div className="detail-value">{t.mix_in_bars} bars</div>
                                      </div>
                                      <div className="detail-card">
                                        <div className="detail-label">Energy</div>
                                        <div className="detail-value">{t.energy_direction}</div>
                                      </div>
                                    </div>

                                    <div className="detail-row-full">
                                      <div className="detail-label">EQ Strategy</div>
                                      <div className="detail-value-full">{t.eq_strategy}</div>
                                    </div>

                                    <div className="detail-row-full">
                                      <div className="detail-label">Keys</div>
                                      <div className="detail-value-full">{t.key_a_name} ({t.key_a}) → {t.key_b_name} ({t.key_b})</div>
                                    </div>

                                    <div className="dj-tip">
                                      <span className="tip-icon">💡</span>
                                      <span>{t.tip}</span>
                                    </div>

                                    {/* Energy visualization */}
                                    <div className="energy-viz">
                                      <div className="energy-track">
                                        <span className="energy-label">A</span>
                                        <div className="energy-bar-wrap">
                                          <div className="energy-bar-fill" style={{ width: `${t.energy_a * 100}%`, background: scoreColor(t.energy_a * 100) }} />
                                        </div>
                                        <span className="energy-pct">{Math.round(t.energy_a * 100)}%</span>
                                      </div>
                                      <div className="energy-track">
                                        <span className="energy-label">B</span>
                                        <div className="energy-bar-wrap">
                                          <div className="energy-bar-fill" style={{ width: `${t.energy_b * 100}%`, background: scoreColor(t.energy_b * 100) }} />
                                        </div>
                                        <span className="energy-pct">{Math.round(t.energy_b * 100)}%</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>

                    <button className="btn-primary btn-wide" style={{ marginTop: 32 }} onClick={resetAll}>Analyze Another Playlist</button>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* ── Footer ────────────────────────────── */}
      <footer className="footer">
        <div className="footer-main">Built by <strong>Leeon Israel</strong></div>
        <div className="footer-sub">Powered by Groq AI &amp; Spotify</div>
      </footer>
    </div>
  );
}

export default App;
