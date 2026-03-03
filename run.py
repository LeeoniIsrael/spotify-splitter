"""
Spotify Splitter – CLI Entry Point
Run this directly to split a playlist from the command line.
"""

from backend.auth import get_spotify_client, get_current_user
from backend.extractor import get_playlist_tracks, get_playlist_info
from backend.classifier import classify_tracks
from backend.playlists import create_playlists, populate_playlists


def main():
    print("\n🎧  Spotify Splitter\n")

    # 1. Authenticate
    print("→ Authenticating with Spotify...")
    sp = get_spotify_client()
    user = get_current_user(sp)
    print(f"  Logged in as: {user.get('display_name', user['id'])}\n")

    # 2. Get playlist
    playlist_input = input("Paste a Spotify playlist URL or ID: ").strip()
    if not playlist_input:
        print("No playlist provided. Exiting.")
        return

    # Extract ID from URL if needed
    import re
    match = re.search(r"playlist[/:]([a-zA-Z0-9]+)", playlist_input)
    playlist_id = match.group(1) if match else playlist_input

    info = get_playlist_info(sp, playlist_id)
    print(f"\n📀 {info['name']} — {info['total_tracks']} tracks")

    # 3. Extract tracks
    print("\n→ Extracting tracks...")
    tracks = get_playlist_tracks(sp, playlist_id)
    print(f"  Found {len(tracks)} tracks")

    if not tracks:
        print("Playlist is empty. Exiting.")
        return

    # 4. Classify
    print("\n→ Classifying tracks with OpenAI...")
    categorized = classify_tracks(tracks)

    print("\n📊 Classification results:")
    for cat, trks in categorized.items():
        print(f"  {cat}: {len(trks)} tracks")

    # 5. Confirm
    confirm = input("\nCreate playlists? (y/n): ").strip().lower()
    if confirm != "y":
        print("Cancelled.")
        return

    # 6. Create & populate
    print("\n→ Creating playlists...")
    playlist_ids = create_playlists(sp, categorized, info["name"])

    print("→ Adding tracks...")
    results = populate_playlists(sp, categorized, playlist_ids)

    print(f"\n✅ Done! Created {len(playlist_ids)} playlists:")
    for cat, pid in playlist_ids.items():
        count = results.get(cat, 0)
        url = f"https://open.spotify.com/playlist/{pid}"
        print(f"  {cat} ({count} tracks) → {url}")

    print()


if __name__ == "__main__":
    main()
