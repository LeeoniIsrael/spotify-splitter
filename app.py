"""
Flask API – Spotify Splitter Backend
Exposes endpoints for the React frontend.
"""

import os
import re
from flask import Flask, jsonify, request, redirect
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from backend.auth import get_auth_manager, get_spotify_client, get_current_user
from backend.extractor import get_playlist_tracks, get_playlist_info
from backend.classifier import classify_tracks, suggest_categories
from backend.playlists import create_playlists, populate_playlists
from backend.mixer import (
    get_audio_features,
    order_tracks_for_mix,
    get_transition_details,
    enrich_tracks_for_display,
    reorder_playlist_on_spotify,
)

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173"])

# Shared auth manager (single instance so the token cache is consistent)
_auth_manager = get_auth_manager()


def _get_sp():
    """Return an authenticated Spotify client, or None if not yet authed."""
    token_info = _auth_manager.get_cached_token()
    if not token_info:
        return None
    return get_spotify_client(_auth_manager)


def _parse_playlist_id(input_str: str) -> str:
    """Extract a playlist ID from a URL, URI, or raw ID."""
    url_match = re.search(r"playlist[/:]([a-zA-Z0-9]+)", input_str)
    if url_match:
        return url_match.group(1)
    return input_str.strip()


# ── API Routes ────────────────────────────────────────────────────────────────


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/logout", methods=["POST"])
def logout():
    """Clear the cached token so the user can re-authenticate."""
    cache_file = ".spotify_cache"
    if os.path.exists(cache_file):
        os.remove(cache_file)
    return jsonify({"logged_out": True})


@app.route("/api/auth", methods=["GET"])
def auth():
    """Check auth status. If not authenticated, return the Spotify auth URL."""
    token_info = _auth_manager.get_cached_token()
    if not token_info:
        auth_url = _auth_manager.get_authorize_url()
        return jsonify({"authenticated": False, "auth_url": auth_url})

    try:
        sp = get_spotify_client(_auth_manager)
        user = get_current_user(sp)
        return jsonify({
            "authenticated": True,
            "user": {
                "id": user["id"],
                "name": user.get("display_name", user["id"]),
                "image": user["images"][0]["url"] if user.get("images") else None,
                "product": user.get("product", "unknown"),
            },
        })
    except Exception as e:
        auth_url = _auth_manager.get_authorize_url()
        return jsonify({"authenticated": False, "auth_url": auth_url, "error": str(e)})


@app.route("/callback")
def callback():
    """Handle the Spotify OAuth redirect. Exchange code for token."""
    code = request.args.get("code")
    error = request.args.get("error")

    if error:
        return redirect("http://localhost:5173?auth_error=" + error)

    if code:
        _auth_manager.get_access_token(code, as_dict=False)

    return redirect("http://localhost:5173?auth=success")


# ── Playlist info & extraction (require auth now for full track list) ────────


@app.route("/api/playlist/info", methods=["POST"])
def playlist_info():
    """Fetch metadata for a playlist."""
    data = request.get_json()
    raw_id = data.get("playlist_id", "")
    playlist_id = _parse_playlist_id(raw_id)

    sp = _get_sp()
    if sp is None:
        return jsonify({"error": "Not authenticated"}), 401

    try:
        info = get_playlist_info(sp, playlist_id)
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/playlist/extract", methods=["POST"])
def playlist_extract():
    """Extract ALL tracks from a playlist (paginated, no 100-track cap)."""
    data = request.get_json()
    raw_id = data.get("playlist_id", "")
    playlist_id = _parse_playlist_id(raw_id)

    sp = _get_sp()
    if sp is None:
        return jsonify({"error": "Not authenticated"}), 401

    try:
        tracks = get_playlist_tracks(sp, playlist_id)
        return jsonify({"tracks": tracks, "count": len(tracks)})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ── AI category suggestion ──────────────────────────────────────────────────


@app.route("/api/suggest-categories", methods=["POST"])
def suggest_categories_endpoint():
    """
    Ask the AI to propose category names based on the track list.
    Body: { tracks, num_playlists, vibe_hint? }
    """
    data = request.get_json()
    tracks = data.get("tracks", [])
    num_playlists = data.get("num_playlists", 5)
    vibe_hint = data.get("vibe_hint")

    if not tracks:
        return jsonify({"error": "No tracks provided"}), 400

    try:
        categories = suggest_categories(tracks, num_playlists, vibe_hint)
        return jsonify({"categories": categories})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Classification ───────────────────────────────────────────────────────────


@app.route("/api/classify", methods=["POST"])
def classify():
    """
    Classify tracks into categories.
    Body: { tracks, categories?, allow_duplicates?, mindset? }
    """
    data = request.get_json()
    tracks = data.get("tracks", [])
    categories = data.get("categories")  # None → use defaults
    allow_duplicates = data.get("allow_duplicates", False)
    mindset = data.get("mindset", "")

    if not tracks:
        return jsonify({"error": "No tracks provided"}), 400

    try:
        categorized = classify_tracks(tracks, categories, allow_duplicates, mindset)
        summary = {cat: len(trks) for cat, trks in categorized.items()}
        return jsonify({"categorized": categorized, "summary": summary})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Split (create + populate) ───────────────────────────────────────────────


# ── Mix / Reorder ────────────────────────────────────────────────────────────


@app.route("/api/mix/analyze", methods=["POST"])
def mix_analyze():
    """
    Analyze tracks and return audio features + optimal mix order.
    Body: { tracks: [{name, artist, uri}] }
    """
    data = request.get_json()
    tracks = data.get("tracks", [])

    if not tracks:
        return jsonify({"error": "No tracks provided"}), 400

    sp = _get_sp()
    if sp is None:
        return jsonify({"error": "Not authenticated"}), 401

    try:
        features, source = get_audio_features(sp, tracks)
        # Count how many tracks actually got real features
        tracks_with_data = sum(1 for t in tracks if t.get("uri", "") in features)
        ordered, scores, stats = order_tracks_for_mix(tracks, features)
        transitions = get_transition_details(ordered, features)
        enriched = enrich_tracks_for_display(ordered, features)

        stats["tracks_with_data"] = tracks_with_data

        return jsonify({
            "ordered_tracks": enriched,
            "transition_scores": scores,
            "transitions": transitions,
            "stats": stats,
            "feature_source": source,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/mix/reorder", methods=["POST"])
def mix_reorder():
    """
    Reorder an existing playlist on Spotify for optimal mix transitions.
    Body: { playlist_id: str, ordered_uris: [str] }
    """
    data = request.get_json()
    raw_id = data.get("playlist_id", "")
    playlist_id = _parse_playlist_id(raw_id)
    ordered_uris = data.get("ordered_uris", [])

    if not playlist_id or not ordered_uris:
        return jsonify({"error": "Missing playlist_id or ordered_uris"}), 400

    sp = _get_sp()
    if sp is None:
        return jsonify({"error": "Not authenticated"}), 401

    try:
        reorder_playlist_on_spotify(sp, playlist_id, ordered_uris)
        return jsonify({"success": True, "message": f"Reordered {len(ordered_uris)} tracks for seamless mixing!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/split", methods=["POST"])
def split_with_mix():
    """Create playlists and populate them — optionally with mix-optimized order."""
    data = request.get_json()
    categorized = data.get("categorized", {})
    source_name = data.get("source_name", "Playlist")
    enable_mix = data.get("enable_mix", False)

    if not categorized:
        return jsonify({"error": "No categorized tracks provided"}), 400

    sp = _get_sp()
    if sp is None:
        return jsonify({"error": "Not authenticated. Complete Spotify login first."}), 401

    try:
        # If mix enabled, reorder each category's tracks for optimal transitions
        mix_stats = {}
        if enable_mix:
            for category, cat_tracks in categorized.items():
                if len(cat_tracks) > 2:
                    features, source = get_audio_features(sp, cat_tracks)
                    ordered, scores, stats = order_tracks_for_mix(cat_tracks, features)
                    categorized[category] = ordered
                    mix_stats[category] = stats

        playlist_ids = create_playlists(sp, categorized, source_name)
        results = populate_playlists(sp, categorized, playlist_ids)

        total_added = sum(results.values())
        total_expected = sum(len(t) for t in categorized.values())

        msg = f"Created {len(playlist_ids)} playlists with {total_added} tracks!"
        if enable_mix:
            msg += " Mix-optimized for seamless transitions."
        if total_added < total_expected:
            msg = f"Created {len(playlist_ids)} playlists — added {total_added}/{total_expected} tracks."

        return jsonify({
            "playlist_ids": playlist_ids,
            "results": results,
            "message": msg,
            "mix_stats": mix_stats if enable_mix else None,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # use_reloader=True but reloader_type='stat' avoids the leaked semaphore
    # warning from Python 3.13's multiprocessing resource_tracker
    app.run(debug=True, port=8080, use_reloader=True, reloader_type="stat")
