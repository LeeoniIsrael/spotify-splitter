"""
AI Classification Module
Categorises tracks by vibe/subgenre using Groq (free Llama models).
Supports dynamic categories — the AI can either suggest them or the user picks them.
"""

import os
import json
from typing import List, Dict, Optional
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

BATCH_SIZE = 50  # tracks per API call


def _get_client() -> OpenAI:
    """Return an OpenAI-compatible client pointing at Groq."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set in .env")
    return OpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1",
    )


# ── Category suggestion ─────────────────────────────────────────────────────

def suggest_categories(
    tracks: List[Dict],
    num_playlists: int = 5,
    vibe_hint: Optional[str] = None,
) -> List[str]:
    """
    Ask the AI to analyse a sample of tracks and propose category names.

    Args:
        tracks:        Full track list (we send a representative sample).
        num_playlists: Target number of playlists / categories.
        vibe_hint:     Optional user description ("chill vibes", "workout", …).

    Returns:
        A list of category name strings (length == num_playlists).
    """
    client = _get_client()

    # Take a representative sample (evenly spaced through the list)
    sample_size = min(80, len(tracks))
    step = max(1, len(tracks) // sample_size)
    sample = [tracks[i] for i in range(0, len(tracks), step)][:sample_size]

    tracks_str = "\n".join(
        f'{i+1}. "{t["name"]}" by {t["artist"]}'
        for i, t in enumerate(sample)
    )

    vibe_line = ""
    if vibe_hint:
        vibe_line = f"""
The user described how they want the playlist split: \"{vibe_hint}\"
Use these descriptions as the basis for your category names. If the user listed specific category names (e.g. comma-separated), use them closely — refine wording if needed but keep the intent.
"""

    prompt = f"""You are a music expert. Analyze these tracks and suggest exactly {num_playlists} playlist category names that would best split this collection.
{vibe_line}
RULES:
- Create exactly {num_playlists} categories.
- Categories should be distinct, descriptive, and fun (e.g. "Late Night Drive", "Sunday Morning", "Peak Energy Banger").
- Categories should cover ALL the music — every track must fit somewhere.
- Always include an "Other / Mixed" category as the last one for anything that doesn't clearly fit.
- Respond with ONLY a JSON array of strings. No other text.

Sample tracks ({len(sample)} of {len(tracks)} total):
{tracks_str}

Respond with ONLY the JSON array of {num_playlists} category names."""

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": "You are a precise music expert. Always respond with valid JSON only."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        max_tokens=1024,
    )

    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()

    try:
        categories = json.loads(raw)
        if isinstance(categories, list) and all(isinstance(c, str) for c in categories):
            return categories[:num_playlists]
    except json.JSONDecodeError:
        pass

    # Fallback: generic names
    return [f"Playlist {i+1}" for i in range(num_playlists)]


# ── Classification ───────────────────────────────────────────────────────────

def _build_prompt(track_batch: List[Dict], categories: List[str], allow_duplicates: bool = False, mindset: str = "") -> str:
    """Build the classification prompt for a batch of tracks."""
    categories_str = "\n".join(f"  - {c}" for c in categories)
    tracks_str = "\n".join(
        f'{i+1}. "{t["name"]}" by {t["artist"]}'
        for i, t in enumerate(track_batch)
    )

    mindset_line = ""
    if mindset:
        mindset_line = f"""
IMPORTANT CONTEXT from the user about how they think about this music:
\"{mindset}\"
Use this mindset to guide your classification. The user knows their music — trust their perspective on what belongs where.
"""

    if allow_duplicates:
        return f"""You are a music classification expert. Categorize each track into ONE OR MORE of the following categories:

{categories_str}
{mindset_line}
RULES:
- You MUST use ONLY the categories listed above. Do NOT invent new categories.
- A track CAN belong to multiple categories if it genuinely fits (e.g. a chill track that also works for pregaming).
- Respond with ONLY a valid JSON array where each element is an object with "index" (1-based) and "categories" (array of exact category names from the list above).
- If unsure, use the last category in the list.
- EVERY track must be assigned to at least one category. Do not skip any.
- Only assign multiple categories when a track truly fits both. Don't force it — most tracks will have 1-2.

Tracks to classify:
{tracks_str}

Respond with ONLY the JSON array, no other text."""

    return f"""You are a music classification expert. Categorize each track into EXACTLY ONE of the following categories:

{categories_str}
{mindset_line}
RULES:
- You MUST use ONLY the categories listed above. Do NOT invent new categories.
- Respond with ONLY a valid JSON array where each element is an object with "index" (1-based) and "category" (exact category name from the list above).
- If unsure, use the last category in the list.
- EVERY track must be assigned. Do not skip any.

Tracks to classify:
{tracks_str}

Respond with ONLY the JSON array, no other text."""


def classify_tracks(
    tracks: List[Dict],
    categories: Optional[List[str]] = None,
    allow_duplicates: bool = False,
    mindset: str = "",
) -> Dict[str, List[Dict]]:
    """
    Classify tracks into vibe categories.

    Args:
        tracks:           List of track dicts (name, artist, uri).
        categories:       Category names to use. If None, uses a default set.
        allow_duplicates: If True, a track can appear in multiple categories.
        mindset:          User notes describing how they think about this music.

    Returns:
        Dict mapping category name → list of track dicts.
    """
    if categories is None:
        categories = [
            "High Energy",
            "Chill / Mellow",
            "Dark / Moody",
            "Uplifting / Feel-Good",
            "Other / Mixed",
        ]

    client = _get_client()
    categorized: Dict[str, List[Dict]] = {cat: [] for cat in categories}

    # Process in batches
    for start in range(0, len(tracks), BATCH_SIZE):
        batch = tracks[start : start + BATCH_SIZE]
        prompt = _build_prompt(batch, categories, allow_duplicates, mindset)

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a precise music classification assistant. Always respond with valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=4096,
        )

        raw = response.choices[0].message.content.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3].strip()

        try:
            classifications = json.loads(raw)
        except json.JSONDecodeError:
            # Fallback: put entire batch into last category
            fallback = categories[-1]
            for track in batch:
                categorized[fallback].append(track)
            continue

        assigned_indices = set()
        for item in classifications:
            idx = item.get("index", 0) - 1

            if allow_duplicates:
                # Multi-category: "categories" is a list
                cats = item.get("categories", [])
                if isinstance(cats, str):
                    cats = [cats]
                # Fallback: also check "category" key
                if not cats:
                    cat = item.get("category", categories[-1])
                    cats = [cat]
                for cat in cats:
                    if cat not in categorized:
                        cat = categories[-1]
                    if 0 <= idx < len(batch):
                        categorized[cat].append(batch[idx])
                if 0 <= idx < len(batch):
                    assigned_indices.add(idx)
            else:
                category = item.get("category", categories[-1])
                if category not in categorized:
                    category = categories[-1]
                if 0 <= idx < len(batch):
                    categorized[category].append(batch[idx])
                    assigned_indices.add(idx)

        # Catch any tracks the AI skipped
        for idx, track in enumerate(batch):
            if idx not in assigned_indices:
                categorized[categories[-1]].append(track)

    # Remove empty categories
    categorized = {k: v for k, v in categorized.items() if v}

    return categorized

    # Remove empty categories
    return {k: v for k, v in categorized.items() if v}
