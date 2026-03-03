"""
Playlist Creation & Population Module
Creates new playlists and populates them with categorized tracks.
Uses direct HTTP calls to /v1/me/playlists to work around Dev Mode restrictions.
"""

import requests
from typing import Dict, List
import spotipy


def _get_token(sp: spotipy.Spotify) -> str:
    """Extract the access token from a spotipy client."""
    return sp.auth_manager.get_cached_token()["access_token"]


def _headers(sp: spotipy.Spotify) -> dict:
    return {"Authorization": f"Bearer {_get_token(sp)}", "Content-Type": "application/json"}


def create_playlists(
    sp: spotipy.Spotify,
    categorized: Dict[str, List[Dict]],
    source_name: str = "Playlist",
) -> Dict[str, str]:
    """
    Create a new private playlist for each category via /v1/me/playlists.
    """
    playlist_ids: Dict[str, str] = {}
    headers = _headers(sp)

    for category, tracks in categorized.items():
        name = f"{source_name} — {category}"
        description = f"Auto-split from '{source_name}' • {len(tracks)} tracks • {category}"
        resp = requests.post(
            "https://api.spotify.com/v1/me/playlists",
            headers=headers,
            json={
                "name": name,
                "public": False,
                "description": description,
            },
            timeout=15,
        )
        resp.raise_for_status()
        playlist_ids[category] = resp.json()["id"]

    return playlist_ids


def populate_playlists(
    sp: spotipy.Spotify,
    categorized: Dict[str, List[Dict]],
    playlist_ids: Dict[str, str],
) -> Dict[str, int]:
    """
    Add tracks to their respective playlists in batches of 100.
    Uses the current /items endpoint (the /tracks endpoint is deprecated & blocked).
    """
    results: Dict[str, int] = {}
    headers = _headers(sp)

    for category, tracks in categorized.items():
        playlist_id = playlist_ids.get(category)
        if not playlist_id:
            continue

        uris = [t["uri"] for t in tracks]
        added = 0

        for i in range(0, len(uris), 100):
            batch = uris[i : i + 100]

            # Use the current /items endpoint (not the deprecated /tracks)
            resp = requests.post(
                f"https://api.spotify.com/v1/playlists/{playlist_id}/items",
                headers=headers,
                json={"uris": batch},
                timeout=15,
            )
            resp.raise_for_status()
            added += len(batch)

        results[category] = added

    return results
