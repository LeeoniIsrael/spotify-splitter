"""
Track Extraction Module
Fetches ALL tracks from a Spotify playlist via the /items API endpoint
(which bypasses Dev-Mode restrictions on the deprecated /tracks endpoint).
Falls back to the embed page for unauthenticated metadata previews.
"""

import json
import requests
from typing import Dict, List

import spotipy


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_token(sp: spotipy.Spotify) -> str:
    return sp.auth_manager.get_cached_token()["access_token"]


def _headers(sp: spotipy.Spotify) -> dict:
    return {"Authorization": f"Bearer {_get_token(sp)}"}


# ── Authenticated endpoints (full data, all tracks) ────────────────────────

def get_playlist_tracks(sp: spotipy.Spotify, playlist_id: str) -> List[Dict]:
    """
    Fetch **every** track from a playlist using GET /v1/playlists/{id}/items.

    Returns list of dicts: {name, artist, uri}
    """
    headers = _headers(sp)
    all_tracks: List[Dict] = []
    offset = 0
    limit = 100

    while True:
        resp = requests.get(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/items",
            headers=headers,
            params={"offset": offset, "limit": limit},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        for item in data.get("items", []):
            track = item.get("track") or item.get("item")
            if not track:
                continue
            uri = track.get("uri", "")
            if not uri or "local" in uri:
                continue
            artists = ", ".join(a.get("name", "") for a in track.get("artists", []))
            all_tracks.append({
                "name": track.get("name", "Unknown"),
                "artist": artists or "Unknown",
                "uri": uri,
            })

        total = data.get("total", 0)
        offset += limit
        if offset >= total:
            break

    return all_tracks


def get_playlist_info(sp: spotipy.Spotify, playlist_id: str) -> Dict:
    """Return playlist metadata via the API."""
    headers = _headers(sp)

    # Get metadata
    resp = requests.get(
        f"https://api.spotify.com/v1/playlists/{playlist_id}",
        headers=headers,
        params={"fields": "name,description,owner(display_name),images"},
        timeout=15,
    )
    resp.raise_for_status()
    d = resp.json()

    # Get total track count from items endpoint (limit=0 is fine)
    items_resp = requests.get(
        f"https://api.spotify.com/v1/playlists/{playlist_id}/items",
        headers=headers,
        params={"offset": 0, "limit": 1},
        timeout=15,
    )
    total = 0
    if items_resp.status_code == 200:
        total = items_resp.json().get("total", 0)

    image_url = ""
    images = d.get("images", [])
    if images:
        image_url = images[0].get("url", "")

    return {
        "name": d.get("name", "Unknown Playlist"),
        "description": d.get("description", ""),
        "image_url": image_url,
        "owner": d.get("owner", {}).get("display_name", ""),
        "total_tracks": total,
    }
