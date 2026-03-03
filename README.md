# Spotify Splitter & DJ Mix Engine 🎧

AI-powered Spotify playlist splitter + DJ-quality mix optimizer. Split any playlist into vibe-based sub-playlists, or reorder tracks for seamless DJ transitions — all from a sleek dark-mode UI.

> **Built by Leeon Israel** · Powered by Groq AI & Spotify

---

## What It Does

### ✂️ Split Mode
Paste a Spotify playlist → AI classifies every track by vibe → new playlists appear in your library.

- Handles playlists of **any size** (tested with 732+ tracks)
- Fully customizable: choose playlist count, write your own vibe descriptions, set a "mindset" for how the AI thinks about your music
- Tracks can optionally appear in multiple playlists (`allow_duplicates`)
- Optional mix-optimization within each split playlist

### 🎧 Mix Mode
Analyze a playlist for DJ-quality transitions and reorder it for seamless flow.

- **Camelot harmonic key matching** — full 24-key Camelot wheel
- **BPM compatibility** with half-time/double-time awareness
- **Energy arc optimization** — starts low, builds naturally
- **6 transition styles**: Beatmatch Blend, Fade, Rise, Echo Out, Cut, Filter Cut
- **Per-transition DJ data**: crossfade duration, mix-in/out bars, EQ strategy, energy direction, harmonic compatibility, DJ tips
- **One-click reorder** — applies the optimized order directly to your Spotify playlist

---

## Architecture

```
├── app.py                 ← Flask API server (port 8080)
├── run.py                 ← CLI entry point (no UI needed)
├── backend/
│   ├── auth.py            ← Spotify OAuth (spotipy)
│   ├── extractor.py       ← Track extraction with pagination
│   ├── classifier.py      ← Groq AI vibe classification
│   ├── mixer.py           ← DJ mix engine (Camelot, transitions, AI features)
│   └── playlists.py       ← Playlist creation & population
├── frontend/
│   └── src/
│       ├── App.jsx        ← React dual-mode UI (Split + Mix)
│       ├── App.css        ← Dark theme styles (~1500 lines)
│       ├── main.jsx       ← Entry point
│       └── index.css      ← Global styles
├── requirements.txt       ← Python dependencies
├── .env                   ← API keys (never committed)
└── .feature_cache.json    ← Disk cache for AI-estimated features (gitignored)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.13, Flask 3.1, flask-cors |
| **Frontend** | React 19, Vite 7 |
| **AI** | Groq API (llama-3.3-70b-versatile → llama-3.1-8b-instant → mixtral-8x7b-32768) |
| **Spotify** | spotipy 2.24, Spotify Web API |
| **Auth** | OAuth 2.0 (Authorization Code flow) |

---

## Setup

### 1. Clone & Install

```bash
# Python backend
pip install -r requirements.txt

# React frontend
cd frontend && npm install
```

### 2. Environment Variables

Create a `.env` file in the project root:

```env
SPOTIPY_CLIENT_ID=your_spotify_client_id
SPOTIPY_CLIENT_SECRET=your_spotify_client_secret
SPOTIPY_REDIRECT_URI=http://127.0.0.1:8080/callback
GROQ_API_KEY=your_groq_api_key
OPENAI_API_KEY=your_openai_api_key    # optional fallback
```

### 3. Spotify Developer Setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create an app (or use an existing one)
3. Add `http://127.0.0.1:8080/callback` as a **Redirect URI**
4. Copy the Client ID and Client Secret into `.env`

### 4. Groq API Key

1. Sign up at [console.groq.com](https://console.groq.com)
2. Create an API key
3. Add it to `.env` as `GROQ_API_KEY`

---

## Running

### Option A: Web UI (Recommended)

```bash
# Terminal 1 — Backend
python app.py
# Runs on http://localhost:8080

# Terminal 2 — Frontend
cd frontend && npm run dev
# Runs on http://localhost:5173
```

Open **http://localhost:5173** in your browser.

### Option B: CLI

```bash
python run.py
```

---

## API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/auth` | GET | Auth status / Spotify login URL |
| `/api/logout` | POST | Clear cached token |
| `/callback` | GET | Spotify OAuth redirect handler |
| `/api/playlist/info` | POST | Fetch playlist metadata |
| `/api/playlist/extract` | POST | Extract all tracks (paginated) |
| `/api/suggest-categories` | POST | AI-generated category names |
| `/api/classify` | POST | Classify tracks into categories |
| `/api/split` | POST | Create & populate playlists |
| `/api/mix/analyze` | POST | Full mix analysis (features + order + transitions) |
| `/api/mix/reorder` | POST | Reorder playlist on Spotify |

---

## How It Works

### Split Mode — AI Classification

1. **Track extraction** — Fetches every track via Spotify's paginated API (100 per request, no cap)
2. **Category suggestion** — Sends a representative sample (up to 80 tracks) to Groq AI, which proposes descriptive category names based on the music
3. **Classification** — Every track is classified in batches of 50 via Groq AI
4. **Playlist creation** — Creates private playlists on your Spotify account and populates them in batches of 100

**Customization options:**
- **Playlist count** — 3 to 10 playlists
- **Vibe description** — Free-form text to guide the AI (e.g., "split by energy level" or "separate vocals from instrumentals")
- **Mindset** — Tell the AI how *you* think about your music (e.g., "heavy driving basslines = lifting, melodic = cooldown")
- **Allow duplicates** — Tracks can appear in multiple playlists
- **Mix-optimize** — Reorder tracks within each split playlist for DJ transitions

### Mix Mode — DJ Mix Engine

1. **Audio feature detection** — Tries Spotify's audio features API first; falls back to AI estimation on 403 (Dev Mode)
2. **Feature estimation** — Groq AI estimates BPM, key, mode, energy, danceability, valence, loudness, acousticness per track
3. **Optimal ordering** — Nearest-neighbor TSP starting from the lowest-energy track, using a weighted transition cost:
   - BPM difference (weight: 3.0) — with half-time/double-time matching
   - Camelot key distance (weight: 2.5) — full harmonic wheel
   - Energy delta (weight: 2.0)
   - Danceability delta (weight: 1.0)
   - Valence delta (weight: 1.0)
4. **Transition recommendations** — Each transition gets a style, crossfade, EQ, and DJ tip

### Camelot Harmonic Mixing

The mixer uses the full **Camelot Wheel** (24 keys) for harmonic compatibility:

| Distance | Label | Meaning |
|----------|-------|---------|
| 0 | Perfect | Same key |
| 1 | Harmonic | Adjacent key or relative major/minor |
| 2 | Compatible | Two steps away |
| 3+ | Tension / Clash | Increasing dissonance |

### Transition Styles

| Style | When | Crossfade | EQ Strategy |
|-------|------|-----------|-------------|
| 🔄 Beatmatch Blend | BPM ±3, Camelot ≤1, low energy delta | 8s, 16 bars | Bass Swap |
| 🌊 Fade | BPM ±6, Camelot ≤2 | 6s, 8 bars | Low-Cut Sweep |
| 📈 Rise | Energy increasing >0.2 | 4s | High-Pass Build |
| 🌀 Echo Out | Energy decreasing >0.2 | 5s | Reverb Tail |
| ⚡ Cut | BPM diff >15 | 0.5s | Hard cut |
| 🎛️ Filter Cut | Camelot distance ≥4 | 3s | Full Filter Sweep |

---

## AI Model Cascade

The app uses **Groq's API** with a fallback cascade to handle rate limits:

```
llama-3.3-70b-versatile  →  llama-3.1-8b-instant  →  mixtral-8x7b-32768
   (best accuracy)           (fast, high limit)       (backup)
```

- On **429 rate limit** → retry with exponential backoff (up to 3 retries) → cascade to next model
- On **400/404** (decommissioned model) → mark as dead, skip for all remaining batches
- **Disk caching** (`.feature_cache.json`) — each track's features are persisted, so AI estimation only happens once per track

---

## Feature Highlights

- 🎵 **No track limit** — handles playlists of 700+ tracks
- 🧠 **AI-powered** — Groq LLM for classification and feature estimation
- 🔑 **Camelot key matching** — real harmonic mixing logic
- 🎛️ **6 DJ transition styles** — with custom crossfade, EQ, and timing per transition
- 💾 **Disk caching** — AI results persist across sessions
- 🔄 **Model cascade** — automatic failover across 3 Groq models
- 🌙 **Dark theme UI** — Spotify-green accents on dark background
- ⏱️ **Live progress** — animated pipeline with elapsed timer
- 📱 **Dual mode** — Split and Mix in one app
- 🔗 **One-click reorder** — apply mix order directly on Spotify

---

## Spotify Dev Mode Notes

If your Spotify app is in **Development Mode** (not extended quota):

- Audio features endpoint returns **403** — the app automatically falls back to AI estimation via Groq
- Use `/items` endpoint instead of `/tracks` for playlist operations (already handled)
- Up to 25 users can be added in the Spotify Dashboard for testing

---

## Project Structure Details

### Backend Modules

| Module | Lines | Purpose |
|--------|-------|---------|
| `mixer.py` | ~665 | DJ engine: Camelot wheel, transition cost, AI estimation, reorder |
| `classifier.py` | ~200 | AI classification with batching, duplicates, mindset |
| `extractor.py` | ~80 | Paginated track extraction via Spotify REST API |
| `playlists.py` | ~70 | Playlist creation and population |
| `auth.py` | ~40 | OAuth setup (spotipy SpotifyOAuth) |

### Frontend

| File | Lines | Purpose |
|------|-------|---------|
| `App.jsx` | ~855 | Dual-mode React UI (Split + Mix), pipeline animations |
| `App.css` | ~1580 | Full dark theme, mix styles, transition cards, animations |

### OAuth Scopes

```
user-read-private
playlist-read-private
playlist-modify-private
playlist-modify-public
```

---

## Dependencies

### Python (`requirements.txt`)
```
flask==3.1.0
flask-cors==5.0.1
spotipy==2.24.0
openai==1.68.0
python-dotenv==1.1.0
```

### Frontend (`package.json`)
```
react: ^19.2.0
react-dom: ^19.2.0
vite: 7.x
@vitejs/plugin-react: ^5.1.1
```

---

## License

Personal project by **Leeon Israel**.
