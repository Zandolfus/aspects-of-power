"""
AoP Stat Validator -- Production FastAPI backend.
Serves both the API and the built frontend static files.
"""

import csv
import io
import json
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from game_data import (
    DEFAULT_TIER_THRESHOLDS,
    class_gains,
    profession_gains,
    races,
)
from tier_utils import get_class_gains, get_profession_gains, get_tier_for_level

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="AoP Stat Validator")

# ---------------------------------------------------------------------------
# Constants (mirrored from Character_Creator.py)
# ---------------------------------------------------------------------------

STATS = [
    "vitality", "endurance", "strength", "dexterity", "toughness",
    "intelligence", "willpower", "wisdom", "perception",
]

STAT_MODIFIER_FORMULA = {
    "base_value": 6000,
    "exp_factor": -0.001,
    "offset": 500,
    "adjustment": -2265,
}

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ClassHistoryEntry(BaseModel):
    class_name: str = ""
    from_level: int = 1
    to_level: Optional[int] = None

    class Config:
        populate_by_name = True

    def __init__(self, **data):
        if "class" in data and "class_name" not in data:
            data["class_name"] = data.pop("class")
        super().__init__(**data)


class ProfHistoryEntry(BaseModel):
    profession: str = ""
    from_level: int = 1
    to_level: Optional[int] = None


class RaceHistoryEntry(BaseModel):
    race: str = ""
    from_level: int = 1
    to_level: Optional[int] = None


class CharacterProfile(BaseModel):
    name: str = "Unknown"
    charType: str = "character"
    race: str = "human"
    classHistory: List[ClassHistoryEntry] = []
    classLevel: int = 0
    profHistory: List[ProfHistoryEntry] = []
    profLevel: int = 0
    raceHistory: List[RaceHistoryEntry] = []
    tierThresholds: List[int] = DEFAULT_TIER_THRESHOLDS
    baseStats: Dict[str, int] = {}
    actualStats: Dict[str, int] = {}
    itemStats: Dict[str, int] = {}
    blessingStats: Dict[str, int] = {}
    fp: int = 0
    isCustomManual: bool = False


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def calc_modifier(value: int) -> int:
    cfg = STAT_MODIFIER_FORMULA
    return int(round(
        (cfg["base_value"]
         / (1 + math.exp(cfg["exp_factor"] * (value - cfg["offset"]))))
        + cfg["adjustment"],
        0,
    ))


def _mk_stats(v: int = 0) -> Dict[str, int]:
    return {s: v for s in STATS}


def _class_at_level(level: int, history: List[ClassHistoryEntry]) -> Optional[str]:
    for e in history:
        if e.from_level <= level and (e.to_level is None or level <= e.to_level):
            return e.class_name
    return None


def _prof_at_level(level: int, history: List[ProfHistoryEntry]) -> Optional[str]:
    for e in history:
        if e.from_level <= level and (e.to_level is None or level <= e.to_level):
            return e.profession
    return None


def _race_at_level(
    level: int,
    race_history: List[RaceHistoryEntry],
    fallback_race: str,
) -> str:
    if race_history:
        for e in race_history:
            if e.from_level <= level and (e.to_level is None or level <= e.to_level):
                return e.race
    return fallback_race


def _race_stats_at_level(race_name: str, level: int) -> Dict[str, int]:
    data = races.get(race_name.lower())
    if not data:
        return {}
    for r in sorted(data["rank_ranges"], key=lambda x: x["min_level"]):
        if r["min_level"] <= level <= r["max_level"]:
            return r["stats"]
    return {}


# ---------------------------------------------------------------------------
# Core validation
# ---------------------------------------------------------------------------

def calc_bonuses(
    char_type: str,
    class_history: List[ClassHistoryEntry],
    cl: int,
    prof_history: List[ProfHistoryEntry],
    pl: int,
    race: str,
    race_history: List[RaceHistoryEntry],
    thresholds: List[int],
) -> Dict[str, Any]:
    is_rl = char_type in ("familiar", "monster")

    res: Dict[str, Any] = {
        "class": _mk_stats(),
        "profession": _mk_stats(),
        "race": _mk_stats(),
        "class_fp": 0,
        "profession_fp": 0,
        "race_fp": 0,
    }

    def _apply(gains: Dict[str, int], dest: str, fp_key: str) -> None:
        for k, v in gains.items():
            if k == "free_points":
                res[fp_key] += v
            elif k in STATS:
                res[dest][k] += v

    if is_rl:
        for lv in range(1, cl + 1):
            r = _race_at_level(lv, race_history, race)
            _apply(_race_stats_at_level(r, lv), "race", "race_fp")
        return res

    for lv in range(1, cl + 1):
        cn = _class_at_level(lv, class_history)
        if cn:
            tier = get_tier_for_level(lv, thresholds)
            _apply(get_class_gains(cn, tier), "class", "class_fp")

    for lv in range(1, pl + 1):
        pn = _prof_at_level(lv, prof_history)
        if pn:
            tier = get_tier_for_level(lv, thresholds)
            _apply(get_profession_gains(pn, tier), "profession", "profession_fp")

    rl = (cl + pl) // 2
    for lv in range(1, rl + 1):
        r = _race_at_level(lv, race_history, race)
        _apply(_race_stats_at_level(r, lv), "race", "race_fp")

    return res


def validate_profile(p: CharacterProfile) -> Dict[str, Any]:
    cl = p.classLevel
    pl = p.profLevel
    is_rl = p.charType in ("familiar", "monster")
    race_level = cl if is_rl else (cl + pl) // 2
    max_hp = calc_modifier(p.actualStats.get("vitality", 0))

    if p.isCustomManual:
        stat_results = {}
        for s in STATS:
            actual = p.actualStats.get(s, 0)
            stat_results[s] = {
                "actual": actual,
                "expected": actual,
                "base": p.baseStats.get(s, 5),
                "freeUsed": 0,
                "diff": 0,
                "ok": True,
                "underAllocated": False,
                "breakdown": {
                    "base": p.baseStats.get(s, 5),
                    "class": 0,
                    "profession": 0,
                    "race": 0,
                    "item": 0,
                    "blessing": 0,
                },
            }
        return {
            "valid": True,
            "isCustomManual": True,
            "statResults": stat_results,
            "bonuses": None,
            "raceLevel": race_level,
            "totalFreeEarned": 0,
            "totalFreeSpent": 0,
            "fpExpected": 0,
            "fpActual": p.fp,
            "fpMatch": True,
            "maxHP": max_hp,
        }

    bonuses = calc_bonuses(
        p.charType,
        p.classHistory,
        cl,
        p.profHistory,
        pl,
        p.race,
        p.raceHistory,
        p.tierThresholds or DEFAULT_TIER_THRESHOLDS,
    )

    total_free_earned = bonuses["class_fp"] + bonuses["profession_fp"] + bonuses["race_fp"]

    exp_base: Dict[str, int] = {}
    breakdown: Dict[str, Dict[str, int]] = {}

    for s in STATS:
        base = p.baseStats.get(s, 5)
        cls = bonuses["class"].get(s, 0)
        prof = bonuses["profession"].get(s, 0)
        rac = bonuses["race"].get(s, 0)
        item = p.itemStats.get(s, 0)
        bless = p.blessingStats.get(s, 0)
        exp_base[s] = base + cls + prof + rac + item + bless
        breakdown[s] = {
            "base": base,
            "class": cls,
            "profession": prof,
            "race": rac,
            "item": item,
            "blessing": bless,
        }

    total_free_spent = 0
    stat_results: Dict[str, Any] = {}
    is_valid = True

    for s in STATS:
        actual = p.actualStats.get(s, 0)
        base = exp_base[s]
        free_used = max(0, actual - base)
        total_free_spent += free_used
        expected = base + free_used
        diff = actual - expected
        under = actual < base
        ok = diff == 0 and not under
        if not ok:
            is_valid = False
        stat_results[s] = {
            "actual": actual,
            "expected": expected,
            "base": base,
            "freeUsed": free_used,
            "diff": diff,
            "ok": ok,
            "underAllocated": under,
            "breakdown": breakdown[s],
        }

    fp_expected = total_free_earned - total_free_spent
    fp_actual = p.fp
    fp_match = fp_expected == fp_actual
    if not fp_match:
        is_valid = False

    return {
        "valid": is_valid,
        "isCustomManual": False,
        "statResults": stat_results,
        "bonuses": {
            "class": bonuses["class"],
            "profession": bonuses["profession"],
            "race": bonuses["race"],
            "class_fp": bonuses["class_fp"],
            "profession_fp": bonuses["profession_fp"],
            "race_fp": bonuses["race_fp"],
        },
        "raceLevel": race_level,
        "totalFreeEarned": total_free_earned,
        "totalFreeSpent": total_free_spent,
        "fpExpected": fp_expected,
        "fpActual": fp_actual,
        "fpMatch": fp_match,
        "maxHP": max_hp,
    }


# ---------------------------------------------------------------------------
# CSV import / export helpers
# ---------------------------------------------------------------------------

def _try_json(s: str, fallback: Any) -> Any:
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return fallback


def _row_to_profile(row: Dict[str, str]) -> Dict[str, Any]:
    base: Dict[str, int] = {}
    actual: Dict[str, int] = {}
    item: Dict[str, int] = {}
    bless: Dict[str, int] = {}

    for s in STATS:
        bv = row.get(f"{s}_base", "")
        base[s] = int(bv) if bv not in ("", None) else 5
        av = row.get(s, "")
        actual[s] = int(av) if av not in ("", None) else base[s]
        iv = row.get(f"{s}_item", "")
        item[s] = int(iv) if iv not in ("", None) else 0
        blv = row.get(f"{s}_blessing", "")
        bless[s] = int(blv) if blv not in ("", None) else 0

    raw_class = (row.get("Class", "") or "mage").lower()
    raw_prof = (row.get("Profession", "") or "gatherer").lower()

    raw_ch: list = _try_json(row.get("class_history", "[]"), [])
    raw_ph: list = _try_json(row.get("profession_history", "[]"), [])
    raw_rh: list = _try_json(row.get("race_history", "[]"), [])

    class_history = (
        [{"class": (e.get("class", "")).lower(), "from_level": e.get("from_level", 1), "to_level": e.get("to_level")} for e in raw_ch]
        if raw_ch
        else [{"class": raw_class, "from_level": 1, "to_level": None}]
    )
    prof_history = (
        [{"profession": (e.get("profession", "")).lower(), "from_level": e.get("from_level", 1), "to_level": e.get("to_level")} for e in raw_ph]
        if raw_ph
        else [{"profession": raw_prof, "from_level": 1, "to_level": None}]
    )
    race_history = (
        [{"race": (e.get("race", "")).lower(), "from_level": e.get("from_level", 1), "to_level": e.get("to_level")} for e in raw_rh]
        if raw_rh
        else []
    )

    tier_thresholds = _try_json(row.get("tier_thresholds", ""), DEFAULT_TIER_THRESHOLDS)

    is_manual = row.get("is_manual_character", "").lower() in ("true", "1", "yes")
    has_manual_base = _try_json(row.get("manual_base_stats", "null"), None) is not None
    is_custom_manual = is_manual and not has_manual_base

    cl_raw = row.get("Class level", "0")
    pl_raw = row.get("Profession level", "0")

    return {
        "name": row.get("Name", "Unknown"),
        "charType": (row.get("Character Type", "") or "character").lower(),
        "race": (row.get("Race", "") or "human").lower(),
        "classHistory": class_history,
        "classLevel": int(cl_raw) if cl_raw else 0,
        "profHistory": prof_history,
        "profLevel": int(pl_raw) if pl_raw else 0,
        "raceHistory": race_history,
        "tierThresholds": tier_thresholds,
        "freePointsRemaining": int(row.get("free_points", "0") or "0"),
        "isCustomManual": is_custom_manual,
        "baseStats": base,
        "actualStats": actual,
        "itemStats": item,
        "blessingStats": bless,
    }


def _parse_csv_text(text: str) -> List[Dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    return [row for row in reader if row.get("Name", "").strip()]


def _profiles_to_csv(profiles: List[Dict[str, Any]]) -> str:
    headers = [
        "Name", "Character Type", "Race", "Class", "Class level",
        "Profession", "Profession level", "free_points",
        "class_history", "profession_history", "race_history", "tier_thresholds",
    ]
    headers += [f"{s}_base" for s in STATS]
    headers += list(STATS)
    headers += [f"{s}_item" for s in STATS]
    headers += [f"{s}_blessing" for s in STATS]

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers)
    writer.writeheader()

    for p in profiles:
        current_class = ""
        for e in (p.get("classHistory") or []):
            if e.get("to_level") is None:
                current_class = e.get("class", "")
        current_prof = ""
        for e in (p.get("profHistory") or []):
            if e.get("to_level") is None:
                current_prof = e.get("profession", "")

        row: Dict[str, Any] = {
            "Name": p.get("name", ""),
            "Character Type": p.get("charType", "character"),
            "Race": p.get("race", "human"),
            "Class": current_class,
            "Class level": p.get("classLevel", 0),
            "Profession": current_prof,
            "Profession level": p.get("profLevel", 0),
            "free_points": p.get("freePointsRemaining", 0),
            "class_history": json.dumps(p.get("classHistory", [])),
            "profession_history": json.dumps(p.get("profHistory", [])),
            "race_history": json.dumps(p.get("raceHistory", [])),
            "tier_thresholds": json.dumps(
                p.get("tierThresholds", DEFAULT_TIER_THRESHOLDS)
            ),
        }
        base = p.get("baseStats", {})
        actual = p.get("actualStats", {})
        items = p.get("itemStats", {})
        blessings = p.get("blessingStats", {})
        for s in STATS:
            row[f"{s}_base"] = base.get(s, 5)
            row[s] = actual.get(s, 5)
            row[f"{s}_item"] = items.get(s, 0)
            row[f"{s}_blessing"] = blessings.get(s, 0)

        writer.writerow(row)

    return buf.getvalue()


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.get("/api/classes")
def get_classes():
    return class_gains


@app.get("/api/professions")
def get_professions():
    return profession_gains


@app.get("/api/races")
def get_races():
    return races


@app.post("/api/validate")
def validate(profile: CharacterProfile):
    return validate_profile(profile)


@app.post("/api/validate/batch")
def validate_batch(profiles: List[CharacterProfile]):
    return [validate_profile(p) for p in profiles]


@app.post("/api/repo/import")
async def repo_import(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8-sig")
    rows = _parse_csv_text(text)
    return [_row_to_profile(row) for row in rows]


@app.post("/api/repo/export")
def repo_export(profiles: List[Dict[str, Any]]):
    csv_text = _profiles_to_csv(profiles)
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=characters_repo.csv"},
    )


# ---------------------------------------------------------------------------
# Static file serving (frontend)
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve the frontend SPA -- any non-API route returns index.html."""
        file_path = STATIC_DIR / full_path
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
