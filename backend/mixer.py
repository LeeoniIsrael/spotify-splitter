"""
Track ordering engine for seamless DJ-style transitions.

Uses Spotify Audio Features (BPM, key, energy, danceability, valence) with
the Camelot Harmonic Mixing Wheel for key compatibility. Falls back to
AI-estimated features via Groq when Spotify's endpoint is unavailable.

For every transition, generates full DJ-grade recommendations:
  - Transition style (Fade / Cut / Rise / Echo Out / Beatmatch Blend)
  - Crossfade duration (seconds)
  - EQ strategy (bass swap, filter sweep, etc.)
  - Mix-in / mix-out points (bars from end / start)
  - Energy direction notes

Algorithm: energy-arc aware nearest-neighbor TSP that produces transitions
a professional DJ would approve of.
"""

import os
import json
import math
import time
import hashlib
import requests
from openai import OpenAI

# ── Feature cache ──────────────────────────────────────────────────────────
CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", ".feature_cache.json")


def _load_cache():
    """Load cached features from disk."""
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_cache(cache):
    """Persist feature cache to disk."""
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump(cache, f)
    except Exception:
        pass

# ── Camelot Wheel ──────────────────────────────────────────────────────────
# Maps Spotify (key, mode) → (camelot_number, camelot_letter)
# key: 0=C … 11=B  |  mode: 1=major, 0=minor
CAMELOT = {
    (0, 1): (8, "B"),   (1, 1): (3, "B"),   (2, 1): (10, "B"),
    (3, 1): (5, "B"),   (4, 1): (12, "B"),  (5, 1): (7, "B"),
    (6, 1): (2, "B"),   (7, 1): (9, "B"),   (8, 1): (4, "B"),
    (9, 1): (11, "B"),  (10, 1): (6, "B"),  (11, 1): (1, "B"),
    (0, 0): (5, "A"),   (1, 0): (12, "A"),  (2, 0): (7, "A"),
    (3, 0): (2, "A"),   (4, 0): (9, "A"),   (5, 0): (4, "A"),
    (6, 0): (11, "A"),  (7, 0): (6, "A"),   (8, 0): (1, "A"),
    (9, 0): (8, "A"),   (10, 0): (3, "A"),  (11, 0): (10, "A"),
}

KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _camelot_label(key, mode):
    cam = CAMELOT.get((key, mode))
    if cam:
        return f"{cam[0]}{cam[1]}"
    return None


def _key_label(key, mode):
    """Human-readable key like 'C Major' or 'A Minor'."""
    if 0 <= key <= 11:
        return f"{KEY_NAMES[key]} {'Major' if mode == 1 else 'Minor'}"
    return "Unknown"


def _camelot_distance(cam_a, cam_b):
    """
    0 = perfect harmonic match (same key)
    1 = compatible (±1 same letter, or relative major/minor)
    2+ = increasing clash
    """
    if cam_a is None or cam_b is None:
        return 3  # unknown key — moderate penalty
    num_a, let_a = cam_a
    num_b, let_b = cam_b
    if num_a == num_b and let_a == let_b:
        return 0
    if let_a == let_b:
        return min(abs(num_a - num_b), 12 - abs(num_a - num_b))
    # different letter
    if num_a == num_b:
        return 1  # relative major/minor
    return min(abs(num_a - num_b), 12 - abs(num_a - num_b)) + 1


def _harmonic_label(cam_dist):
    """Human label for a camelot distance."""
    if cam_dist == 0:
        return "Perfect"
    elif cam_dist == 1:
        return "Harmonic"
    elif cam_dist == 2:
        return "Compatible"
    elif cam_dist <= 3:
        return "Tension"
    return "Clash"


# ── Transition cost ────────────────────────────────────────────────────────

def _transition_cost(a, b):
    """
    Lower = smoother transition. Considers BPM, key, energy, danceability, mood.
    Half-time and double-time BPM matching supported (DJ standard).
    """
    W_TEMPO = 3.0
    W_KEY = 2.5
    W_ENERGY = 2.0
    W_DANCE = 1.0
    W_VALENCE = 1.0

    cost = 0.0

    # ── BPM: allow same, half, or double time
    ta = a.get("tempo", 120)
    tb = b.get("tempo", 120)
    if ta > 0 and tb > 0:
        ratio = tb / ta
        bpm_err = min(abs(1 - ratio), abs(1 - ratio * 2), abs(1 - ratio / 2))
        cost += W_TEMPO * min(bpm_err, 1.0)

    # ── Harmonic key (Camelot)
    cam_a = CAMELOT.get((a.get("key", -1), a.get("mode", -1)))
    cam_b = CAMELOT.get((b.get("key", -1), b.get("mode", -1)))
    cost += W_KEY * (_camelot_distance(cam_a, cam_b) / 6)

    # ── Energy flow
    cost += W_ENERGY * abs(a.get("energy", 0.5) - b.get("energy", 0.5))

    # ── Danceability continuity
    cost += W_DANCE * abs(a.get("danceability", 0.5) - b.get("danceability", 0.5))

    # ── Mood (valence) continuity
    cost += W_VALENCE * abs(a.get("valence", 0.5) - b.get("valence", 0.5))

    return cost


# ── DJ Transition Recommendations ──────────────────────────────────────────

def _recommend_transition(a_feat, b_feat):
    """
    Given two tracks' features, generate a full DJ-grade transition recommendation.
    Returns dict with:
      style, crossfade_sec, eq_strategy, mix_out_bars, mix_in_bars,
      energy_direction, tip
    """
    bpm_a = a_feat.get("tempo", 120)
    bpm_b = b_feat.get("tempo", 120)
    energy_a = a_feat.get("energy", 0.5)
    energy_b = b_feat.get("energy", 0.5)
    dance_a = a_feat.get("danceability", 0.5)
    dance_b = b_feat.get("danceability", 0.5)
    loud_a = a_feat.get("loudness", -10)
    loud_b = b_feat.get("loudness", -10)
    acoustic_a = a_feat.get("acousticness", 0.5)
    acoustic_b = a_feat.get("acousticness", 0.5)

    cam_a = CAMELOT.get((a_feat.get("key", -1), a_feat.get("mode", -1)))
    cam_b = CAMELOT.get((b_feat.get("key", -1), b_feat.get("mode", -1)))
    cam_dist = _camelot_distance(cam_a, cam_b)

    bpm_diff = abs(bpm_a - bpm_b) if bpm_a > 0 and bpm_b > 0 else 0
    energy_diff = energy_b - energy_a  # positive = ramping up

    # ── Determine transition style
    if bpm_diff <= 3 and cam_dist <= 1 and abs(energy_diff) < 0.15:
        # Very close match — long beatmatch blend
        style = "Beatmatch Blend"
        crossfade = 8
        mix_out_bars = 16
        mix_in_bars = 16
        eq_strategy = "Bass Swap"
        tip = "Perfect match — bring in the new track's highs first, then swap bass at the drop"
    elif bpm_diff <= 6 and cam_dist <= 2:
        # Good match — standard DJ blend
        style = "Fade"
        crossfade = 6
        mix_out_bars = 8
        mix_in_bars = 8
        eq_strategy = "Low-Cut Sweep"
        tip = "Solid transition — use a low-pass filter out on track A while fading in track B"
    elif energy_diff > 0.2:
        # Building energy — rise transition
        style = "Rise"
        crossfade = 4
        mix_out_bars = 4
        mix_in_bars = 8
        eq_strategy = "High-Pass Build"
        tip = "Energy climbing — use a rising filter on track B to build tension before the drop"
    elif energy_diff < -0.2:
        # Dropping energy — echo out
        style = "Echo Out"
        crossfade = 5
        mix_out_bars = 8
        mix_in_bars = 4
        eq_strategy = "Reverb Tail"
        tip = "Energy winding down — let track A echo/reverb out while gently introducing track B"
    elif bpm_diff > 15:
        # Big BPM jump — hard cut
        style = "Cut"
        crossfade = 0.5
        mix_out_bars = 1
        mix_in_bars = 1
        eq_strategy = "None"
        tip = "Big tempo shift — use a hard cut at a breakdown or silence for a clean switch"
    elif cam_dist >= 4:
        # Key clash — use effects to mask
        style = "Filter Cut"
        crossfade = 3
        mix_out_bars = 4
        mix_in_bars = 4
        eq_strategy = "Full Filter Sweep"
        tip = "Keys clash — sweep a filter down on track A, brief silence, then drop track B in"
    else:
        # Default smooth fade
        style = "Fade"
        crossfade = 5
        mix_out_bars = 8
        mix_in_bars = 8
        eq_strategy = "Bass Swap"
        tip = "Smooth transition — gradually swap the bass between tracks over 8 bars"

    # Adjust crossfade based on BPM (faster = shorter crossfade feels better)
    if bpm_a > 140 and style != "Cut":
        crossfade = max(2, crossfade - 2)

    # Acoustic/chill tracks need longer, gentler fades
    if acoustic_a > 0.6 or acoustic_b > 0.6:
        if style in ("Cut", "Filter Cut"):
            style = "Fade"
        crossfade = max(crossfade, 6)
        tip = "Acoustic/chill tracks — use a long gentle fade for a smooth, natural transition"

    # Energy direction
    if abs(energy_diff) < 0.08:
        energy_direction = "Steady"
    elif energy_diff > 0:
        energy_direction = "Building"
    else:
        energy_direction = "Cooling"

    return {
        "style": style,
        "crossfade_sec": round(crossfade, 1),
        "eq_strategy": eq_strategy,
        "mix_out_bars": mix_out_bars,
        "mix_in_bars": mix_in_bars,
        "energy_direction": energy_direction,
        "tip": tip,
    }


# ── Fetch audio features from Spotify ──────────────────────────────────────

def fetch_audio_features(sp, track_uris):
    """
    Batch-fetch audio features from Spotify.
    Returns {uri: {tempo, key, mode, energy, danceability, valence, …}}
    """
    token = sp.auth_manager.get_access_token(as_dict=False)
    headers = {"Authorization": f"Bearer {token}"}

    # uri → id
    ids = []
    uri_for_id = {}
    for uri in track_uris:
        tid = uri.split(":")[-1] if ":" in uri else uri
        ids.append(tid)
        uri_for_id[tid] = uri

    features = {}
    for i in range(0, len(ids), 100):
        batch = ids[i : i + 100]
        url = f"https://api.spotify.com/v1/audio-features?ids={','.join(batch)}"
        resp = requests.get(url, headers=headers)

        if resp.status_code == 403:
            raise PermissionError("Audio features endpoint blocked (Dev Mode)")
        if resp.status_code != 200:
            raise Exception(f"Audio features API error {resp.status_code}")

        for feat in resp.json().get("audio_features") or []:
            if feat and feat.get("uri"):
                features[feat["uri"]] = {
                    "tempo": feat.get("tempo", 120),
                    "key": feat.get("key", -1),
                    "mode": feat.get("mode", -1),
                    "energy": feat.get("energy", 0.5),
                    "danceability": feat.get("danceability", 0.5),
                    "valence": feat.get("valence", 0.5),
                    "loudness": feat.get("loudness", -10),
                    "acousticness": feat.get("acousticness", 0.5),
                    "instrumentalness": feat.get("instrumentalness", 0),
                }

    return features


# ── AI fallback: estimate features via Groq ────────────────────────────────

# Model cascade — each has its own daily token quota on Groq
_MODELS = [
    "llama-3.3-70b-versatile",   # best accuracy, 100K TPD
    "llama-3.1-8b-instant",      # fast, high limit, lower accuracy
    "mixtral-8x7b-32768",        # backup, good reasoning
]


def _call_groq(client, model, prompt, max_tokens=3000):
    """Try a single Groq API call. Returns parsed JSON list or None."""
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=max_tokens,
    )
    text = resp.choices[0].message.content.strip()
    start = text.find("[")
    end = text.rfind("]") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    return None


def _build_prompt(listing):
    """Build the feature-estimation prompt."""
    return (
        "You are a music expert. For each track, estimate its ACTUAL audio features. "
        "Every song has a DIFFERENT key — do NOT default to C major.\n"
        "Return ONLY a JSON array. No explanation.\n"
        "Keys per object: index (1-based), tempo (BPM int 60-200), "
        "key (pitch class: 0=C, 1=C#/Db, 2=D, 3=D#/Eb, 4=E, 5=F, 6=F#/Gb, 7=G, 8=G#/Ab, 9=A, 10=A#/Bb, 11=B), "
        "mode (1=major, 0=minor), energy (0.0-1.0), danceability (0.0-1.0), "
        "valence (0.0-1.0), loudness (dB, typically -3 to -20), acousticness (0.0-1.0).\n\n"
        f"{listing}"
    )


def _estimate_features_ai(tracks):
    """
    When Spotify's audio features are blocked, estimate via Groq LLM.

    Features:
      - Disk caching: each track estimated only once
      - Model cascade: tries 70b (accurate) → 8b (fast) on rate limit
      - Retry with backoff on 429
      - Smaller batches (20) to reduce per-request tokens
    """
    cache = _load_cache()

    # Separate cached from uncached
    all_features = {}
    uncached_tracks = []
    for t in tracks:
        uri = t.get("uri", "")
        if uri in cache:
            all_features[uri] = cache[uri]
        else:
            uncached_tracks.append(t)

    if not uncached_tracks:
        print(f"[mixer] All {len(tracks)} tracks found in cache")
        return all_features

    print(f"[mixer] {len(all_features)} cached, {len(uncached_tracks)} need AI estimation")

    client = OpenAI(
        api_key=os.getenv("GROQ_API_KEY"),
        base_url="https://api.groq.com/openai/v1",
    )

    BATCH = 20
    MAX_RETRIES = 3
    new_features = {}
    failed_batches = 0
    current_model_idx = 0  # start with most accurate model
    dead_models = set()    # models that returned permanent errors (400, 404)

    for i in range(0, len(uncached_tracks), BATCH):
        batch = uncached_tracks[i : i + BATCH]
        listing = "\n".join(
            f'{j+1}. "{t["name"]}" - {t["artist"]}'
            for j, t in enumerate(batch)
        )
        prompt = _build_prompt(listing)
        batch_num = i // BATCH + 1
        total_batches = math.ceil(len(uncached_tracks) / BATCH)
        success = False

        # Try models in cascade order starting from current_model_idx
        for model_idx in range(current_model_idx, len(_MODELS)):
            model = _MODELS[model_idx]
            if model in dead_models:
                continue

            for attempt in range(MAX_RETRIES):
                try:
                    parsed = _call_groq(client, model, prompt)
                    if parsed:
                        for item in parsed:
                            idx = item.get("index", 0) - 1
                            if 0 <= idx < len(batch):
                                uri = batch[idx]["uri"]
                                new_features[uri] = {
                                    "tempo": item.get("tempo", 120),
                                    "key": item.get("key", -1),
                                    "mode": item.get("mode", -1),
                                    "energy": item.get("energy", 0.5),
                                    "danceability": item.get("danceability", 0.5),
                                    "valence": item.get("valence", 0.5),
                                    "loudness": item.get("loudness", -10),
                                    "acousticness": item.get("acousticness", 0.5),
                                    "instrumentalness": 0,
                                }
                        print(f"[mixer] Batch {batch_num}/{total_batches}: {len(parsed)} tracks ({model.split('-')[1]}b)")
                    else:
                        print(f"[mixer] Batch {batch_num}/{total_batches}: no JSON in response ({model})")
                    success = True
                    break  # got response, stop retrying
                except Exception as e:
                    err_str = str(e)
                    if "429" in err_str or "rate_limit" in err_str.lower():
                        if attempt < MAX_RETRIES - 1:
                            wait = (2 ** attempt) * 1.5
                            print(f"[mixer] Rate limited on {model}, retry in {wait:.0f}s...")
                            time.sleep(wait)
                        else:
                            # Exhausted retries on this model, cascade to next
                            print(f"[mixer] {model} rate limited, trying next model...")
                            break
                    else:
                        # API error (400 decommissioned, 404, 503, etc.)
                        # —> cascade to next model
                        print(f"[mixer] {model} error: {err_str[:100]}, trying next model...")
                        if "400" in err_str or "404" in err_str or "decommissioned" in err_str.lower():
                            dead_models.add(model)
                        break

            if success:
                # Remember which model worked for efficiency
                current_model_idx = model_idx
                break

        if not success:
            print(f"[mixer] Batch {batch_num}: all models exhausted")
            failed_batches += 1

        # Delay between batches to stay under rate limits
        if i + BATCH < len(uncached_tracks):
            time.sleep(0.3)

    # Merge and persist
    all_features.update(new_features)
    cache.update(new_features)
    _save_cache(cache)

    total = len(tracks)
    got = len(all_features)
    print(f"[mixer] Feature estimation complete: {got}/{total} tracks have data")
    if failed_batches > 0:
        print(f"[mixer] Warning: {failed_batches} batches had issues")

    return all_features


def get_audio_features(sp, tracks):
    """
    Primary entry point. Tries Spotify first, falls back to AI estimation.
    Returns {uri: features_dict}, source ("spotify" | "ai").
    """
    uris = [t["uri"] for t in tracks if t.get("uri")]
    try:
        features = fetch_audio_features(sp, uris)
        if features:
            print(f"[mixer] Got Spotify audio features for {len(features)}/{len(uris)} tracks")
            return features, "spotify"
    except PermissionError:
        print("[mixer] Spotify audio features blocked (Dev Mode) — falling back to AI")
    except Exception as e:
        print(f"[mixer] Spotify audio features error: {e} — falling back to AI")

    # Fallback: AI estimation
    features = _estimate_features_ai(tracks)
    return features, "ai"


# ── Ordering algorithm ─────────────────────────────────────────────────────

def order_tracks_for_mix(tracks, features):
    """
    Orders tracks for seamless transitions.

    Strategy: energy-arc aware nearest-neighbor TSP starting from the
    lowest-energy track, producing a natural energy arc that builds up
    over the playlist.

    Returns (ordered_tracks, transition_scores, stats)
      - ordered_tracks: list of track dicts in mix order
      - transition_scores: list of 0-100 quality scores between consecutive tracks
      - stats: summary dict
    """
    if len(tracks) <= 2:
        return tracks, [], {"avg_score": 100, "min_score": 100}

    # Enrich with features (use defaults for missing)
    enriched = []
    for t in tracks:
        feat = features.get(t.get("uri", ""), {})
        enriched.append({**t, **feat})

    # Start from lowest-energy track → natural build-up
    remaining = list(range(len(enriched)))
    remaining.sort(key=lambda i: enriched[i].get("energy", 0.5))

    ordered = [remaining.pop(0)]
    raw_costs = []

    while remaining:
        cur = enriched[ordered[-1]]
        best_i = None
        best_cost = float("inf")
        for idx in remaining:
            c = _transition_cost(cur, enriched[idx])
            if c < best_cost:
                best_cost = c
                best_i = idx
        ordered.append(best_i)
        remaining.remove(best_i)
        raw_costs.append(best_cost)

    # Convert costs → 0-100 quality scores (lower cost = higher score)
    max_possible = 9.5  # theoretical max from all weights
    scores = [round(max(0, (1 - c / max_possible)) * 100) for c in raw_costs]

    ordered_tracks = [tracks[i] for i in ordered]
    avg = sum(scores) / len(scores) if scores else 100
    mn = min(scores) if scores else 100

    stats = {
        "avg_score": round(avg),
        "min_score": mn,
        "total_tracks": len(ordered_tracks),
    }

    return ordered_tracks, scores, stats


def get_transition_details(tracks, features):
    """
    Returns per-transition breakdown with full DJ recommendations for UI.
    """
    details = []
    for i in range(len(tracks) - 1):
        a_feat = features.get(tracks[i].get("uri", ""), {})
        b_feat = features.get(tracks[i + 1].get("uri", ""), {})

        a_cam = CAMELOT.get((a_feat.get("key", -1), a_feat.get("mode", -1)))
        b_cam = CAMELOT.get((b_feat.get("key", -1), b_feat.get("mode", -1)))
        cam_dist = _camelot_distance(a_cam, b_cam)

        cost = _transition_cost({**tracks[i], **a_feat}, {**tracks[i + 1], **b_feat})
        score = round(max(0, (1 - cost / 9.5)) * 100)

        bpm_a = round(a_feat.get("tempo", 0))
        bpm_b = round(b_feat.get("tempo", 0))

        # Full DJ recommendation
        rec = _recommend_transition(a_feat, b_feat)

        details.append({
            "from_name": tracks[i]["name"],
            "from_artist": tracks[i].get("artist", ""),
            "to_name": tracks[i + 1]["name"],
            "to_artist": tracks[i + 1].get("artist", ""),
            "score": score,
            "bpm_a": bpm_a,
            "bpm_b": bpm_b,
            "key_a": _camelot_label(a_feat.get("key", -1), a_feat.get("mode", -1)),
            "key_b": _camelot_label(b_feat.get("key", -1), b_feat.get("mode", -1)),
            "key_a_name": _key_label(a_feat.get("key", -1), a_feat.get("mode", -1)),
            "key_b_name": _key_label(b_feat.get("key", -1), b_feat.get("mode", -1)),
            "harmonic": _harmonic_label(cam_dist),
            "energy_a": round(a_feat.get("energy", 0.5), 2),
            "energy_b": round(b_feat.get("energy", 0.5), 2),
            # DJ recommendations
            "style": rec["style"],
            "crossfade_sec": rec["crossfade_sec"],
            "eq_strategy": rec["eq_strategy"],
            "mix_out_bars": rec["mix_out_bars"],
            "mix_in_bars": rec["mix_in_bars"],
            "energy_direction": rec["energy_direction"],
            "tip": rec["tip"],
        })

    return details


# ── Track enrichment for UI display ────────────────────────────────────────

def enrich_tracks_for_display(tracks, features):
    """Add BPM, key, energy info to each track for the UI."""
    enriched = []
    for t in tracks:
        feat = features.get(t.get("uri", ""), {})
        enriched.append({
            **t,
            "bpm": round(feat.get("tempo", 0)),
            "key": _camelot_label(feat.get("key", -1), feat.get("mode", -1)),
            "key_name": _key_label(feat.get("key", -1), feat.get("mode", -1)),
            "energy": round(feat.get("energy", 0.5), 2),
            "danceability": round(feat.get("danceability", 0.5), 2),
            "valence": round(feat.get("valence", 0.5), 2),
        })
    return enriched


# ── Reorder on Spotify ─────────────────────────────────────────────────────

def reorder_playlist_on_spotify(sp, playlist_id, ordered_uris):
    """
    Replaces a playlist's track order with the new optimal order.
    Uses PUT to replace all items at once.
    """
    token = sp.auth_manager.get_access_token(as_dict=False)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    # Use /items instead of /tracks — the /tracks endpoint returns 403 in Dev Mode
    url = f"https://api.spotify.com/v1/playlists/{playlist_id}/items"

    # PUT replaces entire tracklist (max 100 per call)
    # First call with PUT to replace, then POST to append remaining
    if len(ordered_uris) <= 100:
        resp = requests.put(url, headers=headers, json={"uris": ordered_uris})
        if resp.status_code not in (200, 201):
            raise Exception(f"Failed to reorder playlist: {resp.status_code} {resp.text[:200]}")
    else:
        # First 100 via PUT (replaces all)
        resp = requests.put(url, headers=headers, json={"uris": ordered_uris[:100]})
        if resp.status_code not in (200, 201):
            raise Exception(f"Failed to reorder playlist: {resp.status_code} {resp.text[:200]}")
        # Remaining via POST (append)
        for i in range(100, len(ordered_uris), 100):
            batch = ordered_uris[i : i + 100]
            resp = requests.post(url, headers=headers, json={"uris": batch})
            if resp.status_code not in (200, 201):
                raise Exception(f"Failed to add tracks: {resp.status_code} {resp.text[:200]}")
