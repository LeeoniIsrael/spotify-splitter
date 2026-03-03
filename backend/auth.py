"""
Spotify Authentication Module
Provides a shared SpotifyOAuth manager for use in the Flask web flow.
"""

import os
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv

load_dotenv()

SCOPES = "user-read-private playlist-read-private playlist-modify-private playlist-modify-public"


def get_auth_manager() -> SpotifyOAuth:
    """Return a SpotifyOAuth manager (reusable across requests)."""
    return SpotifyOAuth(
        client_id=os.getenv("SPOTIPY_CLIENT_ID"),
        client_secret=os.getenv("SPOTIPY_CLIENT_SECRET"),
        redirect_uri=os.getenv("SPOTIPY_REDIRECT_URI"),
        scope=SCOPES,
        cache_path=".spotify_cache",
        open_browser=False,  # we handle the redirect ourselves
    )


def get_spotify_client(auth_manager: SpotifyOAuth = None) -> spotipy.Spotify:
    """Create and return an authenticated Spotify client."""
    if auth_manager is None:
        auth_manager = get_auth_manager()
    return spotipy.Spotify(auth_manager=auth_manager)


def get_current_user(sp: spotipy.Spotify) -> dict:
    """Return the current authenticated user's profile."""
    return sp.current_user()
