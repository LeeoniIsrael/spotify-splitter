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
  {
    key: "extract",
    icon: "📡",
    title: "Reading your playlist",
    desc: "Pulling every track from Spotify's API — no 100-song cap",
    detail: "Paginating through the entire playlist to grab all tracks, artists, and URIs",
  },
  {
    key: "suggest",
    icon: "🧠",
    title: "AI analyzing your music",
    desc: "Sampling tracks and creating categories that match your vibe",
    detail: "Sending a representative sample to Llama 3.3 to generate smart category names",
  },
  {
    key: "classify",
    icon: "🏷️",
    title: "Classifying every track",
    desc: "AI is sorting each song into the right playlist(s)",
    detail: "Processing tracks in batches of 50 — each one gets placed where it fits best",
  },
  {
    key: "create",
    icon: "🎧",
    title: "Building your playlists",
    desc: "Creating new playlists and adding tracks to your Spotify",
    detail: "Creating each playlist on your account and populating them via the Spotify API",
  },
  {
    key: "done",
    icon: "✅",
    title: "All done!",
    desc: "Your new playlists are ready to play",
    detail: "",
  },
];

function App() {
  const [user, setUser] = useState(null);
  const [authUrl, setAuthUrl] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Phase 1: load playlist
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [playlistInfo, setPlaylistInfo] = useState(null);
  const [tracks, setTracks] = useState(null);

  // Phase 2: customization
  const [numPlaylists, setNumPlaylists] = useState(5);
  const [vibeText, setVibeText] = useState("");
  const [mindset, setMindset] = useState("");
  const [allowDupes, setAllowDupes] = useState(true);
  const [suggestedCategories, setSuggestedCategories] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [editableCats, setEditableCats] = useState([]);

  // Phase 3: splitting
  const [splitting, setSplitting] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(-1);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);

  // Elapsed timer
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (splitting || loadingInfo) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [splitting, loadingInfo]);

  // ── Auth ────────────────────────────────────────────
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
        if (data.authenticated) {
          setUser(data.user);
        } else if (data.auth_url) {
          setAuthUrl(data.auth_url);
        }
      })
      .catch(() => {})
      .finally(() => setCheckingAuth(false));
  }, []);

  // ── Reset ───────────────────────────────────────────
  const resetAll = () => {
    setPlaylistUrl("");
    setPlaylistInfo(null);
    setTracks(null);
    setSuggestedCategories(null);
    setEditingCategories(false);
    setEditableCats([]);
    setResults(null);
    setError("");
    setPipelineStep(-1);
    setNumPlaylists(5);
    setVibeText("");
    setMindset("");
    setAllowDupes(true);
  };

  // ── Phase 1: Load playlist ──────────────────────────
  const handleLoadPlaylist = async () => {
    if (!playlistUrl.trim()) return;
    setError("");
    setResults(null);
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

  // ── Phase 2: Get AI category suggestions ────────────
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
        body: JSON.stringify({
          tracks,
          num_playlists: numPlaylists,
          vibe_hint: combinedHint,
        }),
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

  // ── Phase 3: Split ─────────────────────────────────
  const handleSplit = async () => {
    if (!tracks || !suggestedCategories) return;
    setError("");
    setResults(null);
    setSplitting(true);

    const categories = editingCategories ? editableCats.filter((c) => c.trim()) : suggestedCategories;

    try {
      // Step: classify
      setPipelineStep(2);
      const classifyRes = await fetch(`${API}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks, categories, allow_duplicates: allowDupes, mindset }),
      });
      const classifyData = await classifyRes.json();
      if (classifyData.error) throw new Error(classifyData.error);

      // Step: create & populate
      setPipelineStep(3);
      const splitRes = await fetch(`${API}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categorized: classifyData.categorized,
          source_name: playlistInfo?.name || "Playlist",
        }),
      });
      const splitData = await splitRes.json();
      if (splitData.error) throw new Error(splitData.error);

      // Done
      setPipelineStep(4);
      setResults({
        summary: classifyData.summary,
        playlist_ids: splitData.playlist_ids,
        message: splitData.message,
      });
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSplitting(false);
    }
  };

  const activeIdx = pipelineStep >= 0 ? pipelineStep : -1;
  const progress = pipelineStep >= 0 ? Math.min(((pipelineStep + 1) / PIPELINE_STEPS.length) * 100, 100) : 0;
  const showCustomization = tracks && !results && !splitting;

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="app">
      {/* ── Header ────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <svg className="logo" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          <h1>
            Spotify <span>Splitter</span>
          </h1>
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
            <p className="hero-sub">AI-powered playlist splitter that actually gets your taste.</p>
            {authUrl ? (
              <a className="btn-spotify" href={authUrl}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                Login with Spotify
              </a>
            ) : (
              <div className="error-banner">
                Could not reach the backend. Make sure the server is running on port 8080.
              </div>
            )}
            <div className="hero-features">
              <div className="feature-pill"><span>🎯</span> Custom categories</div>
              <div className="feature-pill"><span>🧠</span> AI-powered</div>
              <div className="feature-pill"><span>♾️</span> No track limit</div>
            </div>
          </section>
        ) : (
          <>
            {/* ── URL Input ──────────────────────── */}
            <section className="input-section">
              <h2>Split your playlist by vibe</h2>
              <p>Paste a Spotify playlist link to get started.</p>
              <div className="input-row">
                <input
                  type="text"
                  placeholder="https://open.spotify.com/playlist/..."
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLoadPlaylist()}
                  disabled={loadingInfo || splitting}
                />
                <button
                  className="btn-primary"
                  onClick={tracks ? resetAll : handleLoadPlaylist}
                  disabled={loadingInfo || splitting || (!tracks && !playlistUrl.trim())}
                >
                  {loadingInfo ? "Loading…" : tracks ? "New Playlist" : "Load Playlist"}
                </button>
              </div>
            </section>

            {/* ── Error ────────────────────────── */}
            {error && <div className="error-banner">{error}</div>}

            {/* ── Loading playlist ──────────────── */}
            {loadingInfo && (
              <section className="pipeline-section">
                <div className="pipeline-card">
                  <div className="pipeline-visual">
                    <div className="vinyl-spin" />
                  </div>
                  <h3>Reading your playlist…</h3>
                  <p className="pipeline-desc">Fetching every single track from Spotify</p>
                  <div className="pipeline-timer">{formatTime(elapsed)}</div>
                  <div className="pipeline-bar-wrap">
                    <div className="pipeline-bar pipeline-bar-indeterminate" />
                  </div>
                </div>
              </section>
            )}

            {/* ── Playlist preview ─────────────── */}
            {playlistInfo && !loadingInfo && (
              <div className="playlist-preview">
                {playlistInfo.image_url && <img src={playlistInfo.image_url} alt="" />}
                <div className="playlist-preview-info">
                  <h3>{playlistInfo.name}</h3>
                  <p>
                    {playlistInfo.owner} &middot; {tracks ? tracks.length : playlistInfo.total_tracks} tracks
                  </p>
                </div>
                {tracks && <div className="preview-badge">{tracks.length} tracks loaded</div>}
              </div>
            )}

            {/* ── Customization ────────────────── */}
            {showCustomization && !suggestedCategories && (
              <section className="customize-section">
                <h2>How should we split it?</h2>

                <div className="option-group">
                  <label className="option-label">How many playlists?</label>
                  <div className="chip-row">
                    {PLAYLIST_COUNT_OPTIONS.map((n) => (
                      <button
                        key={n}
                        className={`chip ${numPlaylists === n ? "chip-active" : ""}`}
                        onClick={() => setNumPlaylists(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="option-group">
                  <label className="option-label">Describe how you want it split</label>
                  <p className="option-hint">Type your own categories or leave blank to let AI decide</p>
                  <textarea
                    className="vibe-textarea"
                    placeholder='e.g. "Lifting / Running, Chill & Lofi, Festival & Pregame, Old School"'
                    value={vibeText}
                    onChange={(e) => setVibeText(e.target.value)}
                    rows={2}
                  />
                  <div className="example-chips">
                    {VIBE_EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        className="example-chip"
                        onClick={() => {
                          setVibeText(ex);
                          setNumPlaylists(ex.split(",").length);
                        }}
                      >
                        {ex.split(",").slice(0, 2).map((s) => s.trim()).join(", ")}…
                      </button>
                    ))}
                  </div>
                </div>

                <div className="option-group">
                  <label className="option-label">Your mindset <span className="optional-tag">(optional)</span></label>
                  <p className="option-hint">Tell the AI how YOU think about your music so it classifies the way you would</p>
                  <textarea
                    className="vibe-textarea"
                    placeholder='e.g. "heavy driving basslines = lifting, groovy melodic = chill, high energy builds with drops = festival/pregame"'
                    value={mindset}
                    onChange={(e) => setMindset(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="option-group">
                  <label className="toggle-row" onClick={() => setAllowDupes(!allowDupes)}>
                    <span className={`toggle-switch ${allowDupes ? "toggle-on" : ""}`}>
                      <span className="toggle-knob" />
                    </span>
                    <span className="toggle-text">
                      Allow songs in multiple playlists
                      <span className="toggle-desc">A chill track that also works for pregame can go in both</span>
                    </span>
                  </label>
                </div>

                <button
                  className="btn-primary btn-wide"
                  onClick={handleSuggestCategories}
                  disabled={loadingSuggestions}
                >
                  {loadingSuggestions ? (
                    <><span className="spinner-inline" /> Generating categories…</>
                  ) : (
                    "Generate Categories with AI"
                  )}
                </button>
              </section>
            )}

            {/* ── Category review ──────────────── */}
            {suggestedCategories && !results && !splitting && (
              <section className="categories-section">
                <h2>Your playlist categories</h2>
                <p className="section-subtitle">
                  AI suggested these based on your {tracks.length} tracks. Edit or approve them.
                </p>

                <div className="category-list">
                  {(editingCategories ? editableCats : suggestedCategories).map((cat, i) => (
                    <div key={i} className="category-item" style={{ animationDelay: `${i * 0.06}s` }}>
                      <span className="category-number">{i + 1}</span>
                      {editingCategories ? (
                        <input
                          className="category-edit-input"
                          value={editableCats[i]}
                          onChange={(e) => {
                            const copy = [...editableCats];
                            copy[i] = e.target.value;
                            setEditableCats(copy);
                          }}
                        />
                      ) : (
                        <span className="category-name">{cat}</span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="category-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      if (editingCategories) {
                        setEditingCategories(false);
                      } else {
                        setEditableCats([...suggestedCategories]);
                        setEditingCategories(true);
                      }
                    }}
                  >
                    {editingCategories ? "Done Editing" : "Edit Categories"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setSuggestedCategories(null);
                      setEditingCategories(false);
                    }}
                  >
                    Change Options
                  </button>
                  <button className="btn-primary" onClick={handleSplit}>
                    Split {tracks.length} Tracks
                  </button>
                </div>
              </section>
            )}

            {/* ── Pipeline Progress ────────────── */}
            {splitting && (
              <section className="pipeline-section">
                <div className="pipeline-card pipeline-card-lg">
                  <div className="pipeline-header">
                    <h3>Splitting your playlist</h3>
                    <span className="pipeline-timer">{formatTime(elapsed)}</span>
                  </div>

                  <div className="pipeline-bar-wrap">
                    <div className="pipeline-bar" style={{ width: `${progress}%` }} />
                  </div>

                  <div className="pipeline-steps">
                    {PIPELINE_STEPS.map((s, i) => {
                      const status = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
                      return (
                        <div key={s.key} className={`pipeline-step pipeline-step-${status}`}>
                          <div className="step-indicator">
                            {status === "done" ? (
                              <svg viewBox="0 0 20 20" fill="currentColor" className="check-icon"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                            ) : status === "active" ? (
                              <div className="step-pulse" />
                            ) : (
                              <span className="step-dot" />
                            )}
                          </div>
                          <div className="step-content">
                            <div className="step-title">
                              <span className="step-icon">{s.icon}</span>
                              {s.title}
                            </div>
                            {status === "active" && (
                              <div className="step-detail-wrap">
                                <p className="step-desc">{s.desc}</p>
                                <p className="step-detail">{s.detail}</p>
                              </div>
                            )}
                            {status === "done" && <p className="step-desc">{s.desc}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* ── Results ──────────────────────── */}
            {results && (
              <section className="results-wrapper">
                <div className="success-banner">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="success-icon"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  {results.message}
                </div>

                <h2 className="results-title">Your new playlists</h2>
                {allowDupes && (
                  <p className="section-subtitle">Some tracks appear in multiple playlists — totals may exceed {tracks?.length}</p>
                )}

                <div className="results-grid">
                  {Object.entries(results.summary)
                    .sort(([, a], [, b]) => b - a)
                    .map(([category, count], i) => (
                      <div className="result-card" key={category} style={{ animationDelay: `${i * 0.08}s` }}>
                        <div className="result-card-inner">
                          <h4>{category}</h4>
                          <div className="track-count">{count}</div>
                          <div className="track-label">tracks</div>
                        </div>
                        {results.playlist_ids[category] && (
                          <a
                            className="open-link"
                            href={`https://open.spotify.com/playlist/${results.playlist_ids[category]}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open in Spotify
                            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                          </a>
                        )}
                      </div>
                    ))}
                </div>

                <button className="btn-primary btn-wide" style={{ marginTop: 32 }} onClick={resetAll}>
                  Split Another Playlist
                </button>
              </section>
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
