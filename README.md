# Spotify Splitter 🎧

Split any Spotify playlist into subgenre playlists using AI.

Paste a playlist link → OpenAI classifies every track by vibe → new playlists appear in your Spotify library.

## Architecture

```
├── app.py              ← Flask API (backend server)
├── run.py              ← CLI entry point (no UI needed)
├── backend/
│   ├── auth.py         ← Spotify OAuth
│   ├── extractor.py    ← Track extraction with pagination
│   ├── classifier.py   ← OpenAI vibe classification
│   └── playlists.py    ← Playlist creation & population
├── frontend/           ← React (Vite) UI
└── .env                ← Your API keys (never committed)
```

## Setup

### 1. Environment Variables

Fill in your `.env` file:

```
SPOTIPY_CLIENT_ID=your_spotify_client_id
SPOTIPY_CLIENT_SECRET=your_spotify_client_secret
SPOTIPY_REDIRECT_URI=http://127.0.0.1:8080/callback
OPENAI_API_KEY=your_openai_api_key
```

> **Important**: In your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), set the Redirect URI to exactly `http://127.0.0.1:8080/callback`.

### 2. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 3. Install Frontend Dependencies

```bash
cd frontend && npm install
```

## Running

### Option A: Web UI (recommended)

Start both the backend and frontend:

```bash
# Terminal 1 – Backend
python app.py

# Terminal 2 – Frontend
cd frontend && npm run dev
```

Then open **http://localhost:5173** in your browser.

### Option B: CLI

```bash
python run.py
```

## Vibe Categories

The classifier uses these fixed categories (edit them in `backend/classifier.py`):

- Workout / High-Energy House
- Chill / Lo-fi House
- Deep House
- Tech House
- Melodic / Progressive House
- Afro House / Amapiano
- Vocal / Pop House
- Funky / Disco House
- Dark / Underground
- Other

## Notes

- Tracks are sent to OpenAI in batches of 50 for classification
- Tracks are added to Spotify playlists in batches of 100
- The OAuth token is cached in `.spotify_cache` for reuse
- All API keys are loaded from `.env` — never hardcoded
