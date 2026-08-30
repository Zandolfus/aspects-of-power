"""
World field — hex lattice geometry, elevation, and drainage.

The rule that makes adjacent maps agree: nothing crossing a hex edge may be
decided by a per-map seed. Every such feature derives from absolute world
position or from the edge itself, so both hexes sharing an edge compute an
identical answer without consulting each other.

⚠ edge_midpoint_ft derives BOTH the hash and the perpendicular axis from the
SORTED hex pair. Hashing the sorted pair alone is not sufficient: the
perpendicular flips sign depending on which hex you ask, so an identical offset
slides the crossing opposite ways and every river tears at its seam.
"""
import json, math, heapq, hashlib
from collections import Counter

HEX_SIDE_FT = 600.0
ACROSS_CORNERS = 2 * HEX_SIDE_FT              # 1200 ft, horizontal
ACROSS_FLATS = HEX_SIDE_FT * math.sqrt(3)     # 1039.23 ft, vertical
COL_PITCH = 1.5 * HEX_SIDE_FT                 # 900 ft
ROW_PITCH = ACROSS_FLATS

WATER = {"water_shallow", "water_deep", "water_coastal", "ice"}

BASE_ELEV = {
    "water_deep": -120, "water_shallow": -25, "water_coastal": -15, "ice": 5,
    "marsh": 8, "swamp": 10, "grassland": 60, "plains": 55, "scrub": 70,
    "desert": 80, "dunes": 110, "woodland": 90, "forest": 110,
    "forest_dense": 130, "forest_hills": 320, "hills": 300, "hills_wooded": 330,
    "mountains": 1400,
}

EDGES = ("N", "NE", "SE", "S", "SW", "NW")
OPPOSITE = {"N": "S", "S": "N", "NE": "SW", "SW": "NE", "NW": "SE", "SE": "NW"}


def neighbours(col, row):
    """Flat-top hex, odd columns offset DOWN half a row."""
    dd = -1 if col % 2 == 0 else 0
    return {"N": (col, row - 1), "S": (col, row + 1),
            "NW": (col - 1, row + dd), "SW": (col - 1, row + dd + 1),
            "NE": (col + 1, row + dd), "SE": (col + 1, row + dd + 1)}


def hex_centre_ft(col, row):
    x = ACROSS_CORNERS / 2 + COL_PITCH * col
    y = ROW_PITCH / 2 + (ROW_PITCH / 2 if col % 2 else 0) + ROW_PITCH * row
    return x, y


def edge_key(a, b):
    return tuple(sorted([tuple(a), tuple(b)]))


def _h(*parts):
    s = "|".join(str(p) for p in parts).encode()
    return int(hashlib.blake2b(s, digest_size=8).hexdigest(), 16)


def edge_random(a, b, salt="", lo=0.0, hi=1.0):
    k = edge_key(a, b)
    return lo + (hi - lo) * ((_h(k, salt) % 10_000_007) / 10_000_007)


def edge_midpoint_ft(col, row, edge):
    nb = neighbours(col, row)[edge]
    ka, kb = edge_key((col, row), nb)
    ax, ay = hex_centre_ft(*ka)
    bx, by = hex_centre_ft(*kb)
    mx, my = (ax + bx) / 2, (ay + by) / 2
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1.0
    px, py = -dy / L, dx / L
    t = edge_random((col, row), nb, "cross", -0.30, 0.30) * HEX_SIDE_FT
    return mx + px * t, my + py * t


def build(hexes_path=None):
    import os
    if hexes_path is None:
        hexes_path = os.path.join(os.environ.get("AOP_MAPS", "/mnt/user-data/outputs"), "hexes.json")
    d = json.load(open(hexes_path))
    T = {(h["col"], h["row"]): h for h in d["hexes"]}

    elev = {}
    for k, h in T.items():
        e = BASE_ELEV.get(h["terrain"], 60)
        e += (h.get("mountain_glyph", 0) or 0) * 900
        e += ((_h(k, "jit") % 2000) / 2000 - 0.5) * (abs(e) * 0.28 + 25)
        elev[k] = e
    for _ in range(3):
        nxt = {}
        for k in elev:
            ns = [elev[n] for n in neighbours(*k).values() if n in elev]
            nxt[k] = (elev[k] * 2 + sum(ns)) / (2 + len(ns)) if ns else elev[k]
        elev = nxt
    for k, h in T.items():
        if h["terrain"] in WATER:
            elev[k] = min(elev[k], BASE_ELEV.get(h["terrain"], -20))

    land = {k for k, h in T.items() if h["terrain"] not in WATER}
    filled = dict(elev)
    pq, seen = [], set()
    for k, h in T.items():
        if h["terrain"] in WATER:
            heapq.heappush(pq, (filled[k], k)); seen.add(k)
    EPS = 0.10
    while pq:
        e, k = heapq.heappop(pq)
        for n in neighbours(*k).values():
            if n in filled and n not in seen:
                seen.add(n)
                filled[n] = max(filled[n], e + EPS)
                heapq.heappush(pq, (filled[n], n))

    receiver = {}
    for k in land:
        best, bestn = filled[k], None
        for n in neighbours(*k).values():
            if n in filled and filled[n] < best:
                best, bestn = filled[n], n
        receiver[k] = bestn
    accum = {k: 1 for k in filled}
    for k in sorted(land, key=lambda k: -filled[k]):
        r = receiver.get(k)
        if r is not None:
            accum[r] = accum.get(r, 1) + accum[k]

    RIVER_MIN = 6
    rivers = {}
    for k in land:
        r = receiver.get(k)
        if r is None or accum[k] < RIVER_MIN:
            continue
        edge = next(e for e, n in neighbours(*k).items() if n == r)
        rivers.setdefault(k, []).append(
            {"edge": edge, "dir": "out", "flow": accum[k],
             "cross_ft": list(edge_midpoint_ft(*k, edge))})
        if r in T:
            rivers.setdefault(r, []).append(
                {"edge": OPPOSITE[edge], "dir": "in", "flow": accum[k],
                 "cross_ft": list(edge_midpoint_ft(*k, edge))})

    return {
        "geometry": {"hex_side_ft": HEX_SIDE_FT, "across_corners_ft": ACROSS_CORNERS,
                     "across_flats_ft": round(ACROSS_FLATS, 2),
                     "col_pitch_ft": COL_PITCH, "row_pitch_ft": round(ROW_PITCH, 2),
                     "miles_per_hex": round(ACROSS_FLATS / 5280, 4),
                     "acres_per_hex": round((3 * math.sqrt(3) / 2) * HEX_SIDE_FT ** 2 / 43560, 2)},
        "hexes": {f"{c},{r}": {"elev_ft": round(elev[(c, r)], 1),
                               "filled_ft": round(filled[(c, r)], 1),
                               "flow": accum.get((c, r), 1),
                               "receiver": list(receiver[(c, r)]) if receiver.get((c, r)) else None,
                               "rivers": rivers.get((c, r), [])}
                  for (c, r) in T},
    }


if __name__ == "__main__":
    out = build()
    print("geometry:", out["geometry"])
