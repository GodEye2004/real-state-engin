"""
Search Engine — Heart of the Property Finder
=============================================
Flow:
  1. User query (Persian/English text)
       ↓
  2. word_hunter LoRA model extracts structured properties:
       { area, rooms, elevator, budget, year_built }
       ↓
  3. Weighted matching against divar_backup.json DB
       ↓
  4. Ranked results returned

Properties extracted & matched:
  - area        (متراژ)     → hard filter: must be >= requested
  - rooms       (اتاق)      → hard filter: must be >= requested
  - elevator    (آسانسور)   → hard filter if requested
  - budget      (بودجه)     → hard filter: price must be <= budget
  - year_built  (سال ساخت)  → soft score: newer = better
"""

import re
import logging
from dataclasses import dataclass
from typing import Optional
from datetime import datetime
from core.config import load_from_db
from core.config import load_from_db

logger = logging.getLogger("search_engine")
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

# ─────────────────────────────────────────────
# 1.  MODEL LOADER  (lazy, loaded once)
# ─────────────────────────────────────────────

_model_loaded = True  # Prevents retry logic elsewhere if any


data = load_from_db()
# ─────────────────────────────────────────────
# 2.  PROPERTY SCHEMA
# ─────────────────────────────────────────────


@dataclass
class SearchProperties:
    """The 5 properties the search engine cares about."""

    area: Optional[int] = None  # minimum area in m²
    rooms: Optional[int] = None  # minimum number of rooms
    elevator: Optional[bool] = None  # must have elevator?
    budget: Optional[int] = None  # maximum price in Toman
    year_built: Optional[int] = None  # minimum year built (Shamsi or Miladi)


# ─────────────────────────────────────────────
# 3.  EXTRACTION  — model + regex fallback
# ─────────────────────────────────────────────

# Persian ↔ English digit map
_FA = "۰۱۲۳۴۵۶۷۸۹"
_EN = "0123456789"
_FA_TABLE = str.maketrans(_FA, _EN)


def _fa2en(text: str) -> str:
    return text.translate(_FA_TABLE)


MODEL_API_URL = "http://localhost:8001/extract"


def _extract_with_model(query: str) -> Optional[SearchProperties]:
    """
    Call the Word Hunter Model API to parse the query.
    Maps Persian fields (متراژ، قیمت و ...) to SearchProperties.
    """
    import requests

    try:
        logger.info(f"Calling Model API at {MODEL_API_URL}...")
        response = requests.post(MODEL_API_URL, json={"query": query}, timeout=10)
        response.raise_for_status()

        data = response.json()
        extraction = data.get("extraction", {})

        logger.info(f"🤖 API response: {extraction}")

        props = SearchProperties(
            area=_parse_area_string(extraction.get("متراژ")),
            rooms=_to_int(extraction.get("چند خواب")),
            elevator=_to_bool(extraction.get("امکانات")),
            budget=_parse_budget_string(extraction.get("قیمت")),
            year_built=_to_int(extraction.get("سال ساخت")),
        )

        # Special check for elevator in امکانات list
        imkanat = extraction.get("امکانات", [])
        if isinstance(imkanat, list):
            if any(
                "آسانسور" in str(item) or "elevator" in str(item).lower()
                for item in imkanat
            ):
                props.elevator = True

        return props

    except Exception as e:
        logger.warning(f"⚠️ Model API call failed: {e}")
        return None


def _parse_area_string(val) -> Optional[int]:
    """
    Extract digits from strings like '۸۰ متر'.
    Rejects if it looks like a budget (contains billion/million keywords).
    """
    if not val:
        return None
    s = str(val).lower()

    # Sanity check: reject if model accidentally put budget info in area
    if any(unit in s for unit in ["میلیارد", "billion", "میلیون", "million"]):
        return None

    s = _fa2en(s)
    match = re.search(r"(\d+)", s)
    return int(match.group(1)) if match else None


def _parse_budget_string(val) -> Optional[int]:
    """
    Extract Toman value from strings like '۵ میلیارد', '۴.۵ تومن', '500 میلیون'.
    """
    if not val:
        return None
    s = _fa2en(str(val)).lower()

    # Handle میلیارد (Billion)
    m = re.search(r"([\d.]+)\s*(میلیارد|billion\b)", s)
    if m:
        return int(float(m.group(1)) * 1_000_000_000)

    # Handle bare number followed by تومن/تومان — treat as billion if < 1000
    m = re.search(r"([\d.]+)\s*(تومن|تومان)", s)
    if m:
        num = float(m.group(1))
        if num < 1_000:
            return int(num * 1_000_000_000)
        return int(num)

    # Handle میلیون (Million)
    m = re.search(r"([\d.]+)\s*(میلیون|million\b)", s)
    if m:
        return int(float(m.group(1)) * 1_000_000)

    # Bare large number (≥ 7 digits)
    digits = re.search(r"\b(\d{7,})\b", s)
    return int(digits.group(1)) if digits else None


# ─────────────────────────────────────────────
# 4.  DB MATCHING ENGINE
# ─────────────────────────────────────────────


CURRENT_YEAR = datetime.now().year  # Miladi ~2026
CURRENT_SHAMSI = 1405  # Persian calendar


def _to_int(val) -> Optional[int]:
    try:
        if val is None:
            return None
        return int(float(str(val).replace(",", "").replace("،", "")))
    except Exception:
        return None


def _to_bool(val) -> Optional[bool]:
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ("true", "yes", "1", "بله", "دارد")
    return bool(val)


def match_properties(props: SearchProperties, top_k: int = 20) -> list[dict]:
    """
    Phase 1 – Soft/Flexible Filtering (allow slight overages)
    Phase 2 – Weighted Scoring
    Returns top_k results sorted by score descending.
    """
    all_ads = load_from_db(limit=500)
    print(all_ads)
    if not all_ads:
        logger.warning("⚠️ No ads loaded from DB — returning empty results.")
        return []

    BUDGET_TOLERANCE = 1.3  # Allow ads up to 30% over budget
    AREA_TOLERANCE = 0.9  # Allow ads up to 10% under requested area

    candidates = []
    skipped = {"budget": 0, "area": 0, "rooms": 0, "elevator": 0}

    for ad in all_ads:
        # Filter: budget
        if props.budget and props.budget > 0:
            ad_price = ad.get("price", 0) or 0
            if ad_price > props.budget * BUDGET_TOLERANCE:
                skipped["budget"] += 1
                continue

        # Filter: area
        if props.area and props.area > 0:
            ad_area = ad.get("area", 0) or 0
            if ad_area > 0 and ad_area < props.area * AREA_TOLERANCE:
                skipped["area"] += 1
                continue

        # Filter: rooms
        if props.rooms and props.rooms > 0:
            ad_rooms = ad.get("bedrooms", 0) or 0
            if ad_rooms > 0 and ad_rooms < props.rooms:
                skipped["rooms"] += 1
                continue

        # Filter: elevator (hard filter only when explicitly requested)
        if props.elevator is True:
            if not ad.get("has_elevator"):
                skipped["elevator"] += 1
                continue

        candidates.append(ad)

    logger.info(
        f"🔽 Flexible filter: {len(all_ads)} → {len(candidates)} candidates "
        f"(skipped: {skipped})"
    )

    # ── Phase 2: Weighted Scoring ─────────────────────────────────────────────
    scored = []
    for ad in candidates:
        score = 100.0  # Base score

        # Closer budget gets higher score, up to budget
        if props.budget and props.budget > 0:
            ad_price = ad.get("price", 0) or 0
            if ad_price > 0:
                diff = abs(props.budget - ad_price)
                score -= (diff / props.budget) * 30  # Penalty for price difference

        # Higher area is better if we have a minimum area requested
        if props.area and props.area > 0:
            ad_area = ad.get("area", 0) or 0
            if ad_area > 0:
                area_diff = ad_area - props.area
                score += (
                    min(max(area_diff, 0), 50) * 0.5
                )  # Bonus for extra area, capped

        # More rooms are better
        if props.rooms and props.rooms > 0:
            ad_rooms = ad.get("bedrooms", 0) or 0
            if ad_rooms > props.rooms:
                score += (ad_rooms - props.rooms) * 5

        # Newer year_built is better
        if props.year_built and props.year_built > 0:
            ad_year = ad.get("year_built", 0) or 0
            if ad_year > 0:
                score -= abs(ad_year - props.year_built) * 2

        scored.append({**ad, "_score": round(score, 1)})

    scored.sort(key=lambda x: x["_score"], reverse=True)
    return scored[:top_k]


# ─────────────────────────────────────────────
# 5.  PUBLIC API
# ─────────────────────────────────────────────


def extract_properties(query: str) -> SearchProperties:
    """Wrapper around _extract_with_model for external use."""
    props = _extract_with_model(query)
    if not props:
        props = SearchProperties()
    return props


def search(query: str, top_k: int = 20) -> dict:
    """
    Main entry point for the search engine.

    Returns:
        {
          "query": str,
          "extracted_properties": { area, rooms, elevator, budget, year_built },
          "total_results": int,
          "results": [ { ...ad_fields..., "_score": float }, ... ]
        }
    """
    props = extract_properties(query)

    results = match_properties(props, top_k=top_k)

    return {
        "query": query,
        "extracted_properties": {
            "area": props.area,
            "rooms": props.rooms,
            "elevator": props.elevator,
            "budget": props.budget,
            "year_built": props.year_built,
        },
        "total_results": len(results),
        "results": results,
    }


# ─────────────────────────────────────────────
# 6.  QUICK TEST (run directly)
# ─────────────────────────────────────────────

if __name__ == "__main__":
    test_queries = [
        "خونه میخوام ۱۰۰ متری ۷ میلیارد",
        "آپارتمان ۲ خوابه با آسانسور زیر ۵ میلیارد",
        "خانه ۱۵۰ متر ۳ اتاق سال ساخت ۱۴۰۰",
    ]
    for q in test_queries:
        print("\n" + "═" * 60)
        result = search(q, top_k=5)
        print(f"Query   : {result['query']}")
        print(f"Parsed  : {result['extracted_properties']}")
        print(f"Results : {result['total_results']}")
        for i, ad in enumerate(result["results"], 1):
            price = f"{ad.get('price', 0):,}"
            print(
                f"  {i}. [{ad['_score']:5.1f}] {ad.get('title','?')[:50]}"
                f" | {ad.get('area')}m² | {price} T"
            )
