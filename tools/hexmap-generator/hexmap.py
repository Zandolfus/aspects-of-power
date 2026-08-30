"""
Hex area map renderer — one hex, one map.

Everything positional is a function of ABSOLUTE WORLD COORDINATES, never of a
per-map seed, so the bleed outside the hex footprint shows the neighbour's real
terrain and seams match by construction.

Usage:  python3 hexmap.py COL ROW
"""
import sys, math, json, io, base64, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import os
OUT = os.environ.get("AOP_MAPS", "/mnt/user-data/outputs")
sys.path.insert(0, os.path.join(OUT, "generator"))
from world import (HEX_SIDE_FT, ACROSS_CORNERS, ACROSS_FLATS, hex_centre_ft,
                   neighbours, OPPOSITE, edge_midpoint_ft, edge_random)

WALL_CLASSES = {
    "boundary":     {"move": "NORMAL", "sight": "NORMAL",  "light": "NORMAL",  "sound": "NORMAL"},
    "solid":        {"move": "NORMAL", "sight": "NORMAL",  "light": "NORMAL",  "sound": "NORMAL"},
    "tree_trunk":   {"move": "NORMAL", "sight": "NORMAL",  "light": "NORMAL",  "sound": "NORMAL"},
    "boulder":      {"move": "NORMAL", "sight": "NORMAL",  "light": "NORMAL",  "sound": "NORMAL"},
    "cliff":        {"move": "NORMAL", "sight": "NORMAL",  "light": "NORMAL",  "sound": "NORMAL"},
    "fungal_cap":   {"move": "NORMAL", "sight": "NORMAL",  "light": "NORMAL",  "sound": "NORMAL"},
    "fallen_log":   {"move": "NORMAL", "sight": "LIMITED", "light": "LIMITED", "sound": "NONE"},
    "undergrowth":  {"move": "NONE",   "sight": "LIMITED", "light": "LIMITED", "sound": "NONE"},
    "reed_thicket": {"move": "NONE",   "sight": "LIMITED", "light": "LIMITED", "sound": "NONE"},
    "deep_water":   {"move": "NORMAL", "sight": "NONE",    "light": "NONE",    "sound": "NONE"},
}

# ---------------------------------------------------------------------------
# Terrain profiles. Anything biome-specific lives here; the machinery below is
# shared. A terrain with no entry falls back to _default, which is open forest —
# so a missing profile renders silently WRONG rather than failing loudly.
# ---------------------------------------------------------------------------
PROFILES = {
    # Light reaches the floor, so the story is UNDERGROWTH: small boles, thick brush.
    "forest": dict(
        ground=((78, 64, 44), (116, 92, 56), (96, 122, 58), (66, 96, 50)),
        tree_cell=47, trunk_ft=(2.0, 5.2), canopy_ft=(14, 44), tree_reject=0.68,
        canopy=(46, 84, 40), canopy_lit=(88, 130, 56), trunk=(84, 64, 44),
        ug_cell=118, ug_reject=0.62, ug_r=(22, 48), ug_tint=(0, 0, 0), ug_wall=True,
        logs=0, log_ft=(0, 0), rocks=0, ambient="ffffffff"),
    # Closed canopy shades the floor out: monumental boles, open going, deadfall.
    "forest_dense": dict(
        ground=((66, 54, 38), (98, 78, 50), (76, 92, 50), (58, 82, 48)),
        tree_cell=72, trunk_ft=(11.0, 24.0), canopy_ft=(34, 62), tree_reject=0.80,
        canopy=(30, 58, 30), canopy_lit=(58, 96, 44), trunk=(96, 58, 38),
        ug_cell=190, ug_reject=0.55, ug_r=(14, 26), ug_tint=(-16, -22, -8), ug_wall=False,
        logs=22, log_ft=(45, 120), rocks=4, ambient="ff9a9a9a"),
    # Wooded slope: thinner canopy, more open floor, exposed stone.
    "forest_hills": dict(
        ground=((86, 74, 54), (118, 102, 70), (96, 112, 58), (74, 92, 52)),
        tree_cell=58, trunk_ft=(1.8, 4.4), canopy_ft=(12, 32), tree_reject=0.55,
        canopy=(52, 88, 44), canopy_lit=(96, 132, 60), trunk=(80, 62, 44),
        ug_cell=150, ug_reject=0.45, ug_r=(16, 34), ug_tint=(-6, -10, -4), ug_wall=True,
        logs=6, log_ft=(25, 55), rocks=22, ambient="ffffffff"),
    # --- open / dry -------------------------------------------------------
    # ⚠ LIMITED-sight undergrowth needs SHORT sightlines to read. In open
    # country a sightline crosses two scattered patches hundreds of feet away
    # and vision cuts out for no visible reason, so open profiles set
    # ug_wall=False and take their cover from rock instead.
    "grassland": dict(
        ground=((96, 110, 54), (130, 152, 74), (168, 190, 104), (84, 124, 58)),
        tree_cell=210, trunk_ft=(1.6, 4.0), canopy_ft=(12, 26), tree_reject=0.16,
        canopy=(58, 96, 46), canopy_lit=(104, 140, 64), trunk=(84, 66, 44),
        ug_cell=64, ug_reject=0.72, ug_r=(10, 24), ug_tint=(6, 10, 2), ug_wall=False,
        ug_style="grass", logs=0, log_ft=(0, 0), rocks=3, ambient="ffffffff"),
    "plains": dict(
        ground=((128, 124, 66), (168, 164, 92), (206, 202, 128), (126, 140, 72)),
        tree_cell=320, trunk_ft=(1.4, 3.4), canopy_ft=(10, 22), tree_reject=0.10,
        canopy=(74, 96, 46), canopy_lit=(118, 142, 68), trunk=(90, 72, 48),
        ug_cell=72, ug_reject=0.60, ug_r=(10, 22), ug_tint=(22, 18, 6), ug_wall=False,
        ug_style="grass", logs=0, log_ft=(0, 0), rocks=4, ambient="ffffffff"),
    "scrub": dict(
        ground=((140, 124, 74), (178, 162, 102), (208, 194, 134), (122, 128, 76)),
        tree_cell=380, trunk_ft=(1.2, 3.0), canopy_ft=(8, 18), tree_reject=0.08,
        canopy=(84, 96, 52), canopy_lit=(126, 138, 74), trunk=(96, 78, 52),
        ug_cell=88, ug_reject=0.52, ug_r=(8, 20), ug_tint=(18, 6, -6), ug_wall=False,
        ug_style="scrub", logs=0, log_ft=(0, 0), rocks=12, ambient="ffffffff"),
    "desert": dict(
        ground=((178, 158, 110), (210, 192, 144), (232, 218, 174), (168, 158, 120)),
        tree_cell=900, trunk_ft=(1.0, 2.4), canopy_ft=(6, 14), tree_reject=0.03,
        canopy=(96, 104, 60), canopy_lit=(134, 142, 84), trunk=(104, 86, 58),
        ug_cell=150, ug_reject=0.24, ug_r=(6, 14), ug_tint=(26, 10, -10), ug_wall=False,
        ug_style="scrub", logs=0, log_ft=(0, 0), rocks=14, rock_moss=False, ambient="ffffffff"),
    "dunes": dict(
        ground=((196, 178, 130), (224, 208, 162), (240, 230, 192), (190, 176, 140)),
        tree_cell=1400, trunk_ft=(1.0, 2.0), canopy_ft=(5, 11), tree_reject=0.01,
        canopy=(104, 110, 64), canopy_lit=(140, 146, 88), trunk=(110, 92, 62),
        ug_cell=260, ug_reject=0.12, ug_r=(5, 12), ug_tint=(30, 14, -8), ug_wall=False,
        ug_style="scrub", logs=0, log_ft=(0, 0), rocks=4, rock_moss=False, ambient="ffffffff"),
    # --- relief ------------------------------------------------------------
    "hills": dict(
        ground=((120, 106, 64), (158, 146, 88), (190, 180, 116), (120, 140, 72)),
        tree_cell=260, trunk_ft=(1.6, 3.8), canopy_ft=(11, 24), tree_reject=0.14,
        canopy=(66, 94, 46), canopy_lit=(110, 138, 66), trunk=(86, 68, 46),
        ug_cell=70, ug_reject=0.66, ug_r=(9, 22), ug_tint=(12, 12, 0), ug_wall=False,
        ug_style="grass", logs=0, log_ft=(0, 0), rocks=20, ambient="ffffffff"),
    "hills_wooded": dict(
        ground=((96, 88, 56), (126, 120, 74), (146, 146, 86), (88, 110, 58)),
        tree_cell=88, trunk_ft=(1.6, 4.0), canopy_ft=(10, 26), tree_reject=0.42,
        canopy=(62, 92, 48), canopy_lit=(104, 134, 64), trunk=(82, 64, 44),
        ug_cell=110, ug_reject=0.50, ug_r=(12, 28), ug_tint=(4, -2, -6), ug_wall=True,
        ug_style="scrub", logs=4, log_ft=(20, 45), rocks=26, ambient="ffffffff"),
    "mountains": dict(
        ground=((92, 86, 78), (124, 116, 104), (148, 142, 130), (96, 104, 88)),
        tree_cell=520, trunk_ft=(1.2, 3.0), canopy_ft=(8, 18), tree_reject=0.07,
        canopy=(52, 74, 46), canopy_lit=(92, 112, 62), trunk=(74, 60, 44),
        ug_cell=190, ug_reject=0.22, ug_r=(8, 18), ug_tint=(-8, -12, -6), ug_wall=False,
        ug_style="scrub", logs=0, log_ft=(0, 0), rocks=110, rock_cell=64, rock_ft=(9, 34),
        scree=2600, massif=9, massif_ft=(55, 130), rock_moss=False, ambient="ffffffff"),
    # --- wet ---------------------------------------------------------------
    "marsh": dict(
        ground=((70, 84, 56), (96, 116, 70), (124, 146, 86), (72, 102, 72)),
        tree_cell=430, trunk_ft=(1.4, 3.6), canopy_ft=(10, 22), tree_reject=0.10,
        canopy=(54, 84, 44), canopy_lit=(96, 126, 60), trunk=(78, 64, 46),
        ug_cell=92, ug_reject=0.74, ug_r=(16, 38), ug_tint=(-4, 2, -6), ug_wall=True,
        ug_class="reed_thicket", ug_style="reed", logs=0, log_ft=(0, 0), rocks=0,
        ambient="ffffffff"),
    "swamp": dict(
        ground=((58, 70, 50), (84, 98, 62), (106, 126, 76), (64, 92, 66)),
        tree_cell=150, trunk_ft=(2.2, 6.0), canopy_ft=(16, 34), tree_reject=0.46,
        canopy=(38, 66, 38), canopy_lit=(76, 104, 52), trunk=(72, 58, 42),
        ug_cell=104, ug_reject=0.66, ug_r=(14, 34), ug_tint=(-8, -2, -4), ug_wall=True,
        ug_class="reed_thicket", ug_style="reed", logs=10, log_ft=(20, 50), rocks=0,
        ambient="ff8f9a8f"),
    "ice": dict(
        ground=((196, 208, 216), (220, 230, 238), (238, 244, 250), (180, 200, 214)),
        tree_cell=2000, trunk_ft=(1.0, 2.0), canopy_ft=(5, 10), tree_reject=0.0,
        canopy=(60, 80, 70), canopy_lit=(100, 120, 110), trunk=(80, 74, 66),
        ug_cell=400, ug_reject=0.0, ug_r=(4, 10), ug_tint=(0, 0, 0), ug_wall=False,
        ug_style="none", logs=0, log_ft=(0, 0), rocks=18, rock_ft=(6, 18),
        rock_moss=False, ambient="ffd8e4f0"),
}
PROFILES["woodland"] = PROFILES["forest"]
# hexmap 0.7: WATER HEXES ARE WATER. They aliased to marsh, which rendered the
# macro river as reedy land — the banks never met in fiction and never parted
# in movement. This profile covers only the DRY FRINGE of a water hex; the
# channel itself (water, deep walls, fords) is drawn by the water block in
# main(), with every cross-edge quantity derived from the SORTED hex pair so
# both sides agree at the seam by construction.
PROFILES["water_shallow"] = dict(
    ground=((104, 108, 78), (134, 138, 96), (156, 162, 112), (96, 118, 84)),
    tree_cell=340, trunk_ft=(1.4, 3.4), canopy_ft=(10, 22), tree_reject=0.08,
    canopy=(56, 88, 46), canopy_lit=(100, 130, 62), trunk=(80, 64, 44),
    ug_cell=84, ug_reject=0.62, ug_r=(12, 28), ug_tint=(-4, 2, -6), ug_wall=True,
    ug_class="reed_thicket", ug_style="reed", logs=0, log_ft=(0, 0), rocks=6,
    ambient="ffffffff")
PROFILES["water_coastal"] = PROFILES["water_shallow"]
PROFILES["water_deep"] = PROFILES["water_shallow"]
PROFILES["_default"] = PROFILES["forest"]

WATER_TERRAINS = {"water_shallow", "water_coastal", "water_deep"}

# hexmap 0.7: AUTHORED STRUCTURES — deterministic setpieces the generator
# builds whole (ruled 2026-08-31: the Lizardfolk's conjured water castle is
# "fully generated"). face_hex aims the gate and causeway.
STRUCTURES = {
    (23, 25): {"kind": "water_castle", "face_hex": (17, 22)},
}


def _band_ft(pts, half_w):
    """Offset an open polyline into a closed band polygon (world ft). The
    band's boundary is the wall: crossing it anywhere is blocked, and a GAP
    is made by simply not covering that stretch with a band."""
    left, right = [], []
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        x0_, y0_ = pts[max(i - 1, 0)]
        x1_, y1_ = pts[min(i + 1, n - 1)]
        dx, dy = x1_ - x0_, y1_ - y0_
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * half_w, dx / L * half_w
        left.append((x + nx, y + ny))
        right.append((x - nx, y - ny))
    return left + right[::-1]


def _ngon_ft(cx, cy, r, n, a0=0.0):
    return [(cx + r * math.cos(a0 + 2 * math.pi * i / n),
             cy + r * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def _arc_ft(cx, cy, r, a0, a1, n=48):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n),
             cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]

PPG, FT_PER_SQ, BLEED_FT = 32, 5.0, 40.0
PXF = PPG / FT_PER_SQ


def _round_up(ft):
    px = math.ceil(ft * PXF / PPG) * PPG
    return px, px / PXF


W, IMG_W_FT = _round_up(ACROSS_CORNERS + 2 * BLEED_FT)
H, IMG_H_FT = _round_up(ACROSS_FLATS + 2 * BLEED_FT)

VERTS = [(HEX_SIDE_FT * math.cos(math.radians(a)),
          HEX_SIDE_FT * math.sin(math.radians(a))) for a in (0, 60, 120, 180, 240, 300)]
EDGE_OF_SEGMENT = ["SE", "S", "SW", "NW", "N", "NE"]


def _hash2(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263
         + np.int64(seed) * 1274126177)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFFFF).astype(np.float32) / 0xFFFFFF


def _seed(ix, iy, salt):
    h = (ix * 374761393 + iy * 668265263 + salt * 1274126177) & 0xFFFFFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFFFFFF
    return h ^ (h >> 16)


def orng(ix, iy, salt):
    return random.Random(_seed(ix, iy, salt))


def wnoise(X, Y, cell_ft, seed):
    """Value noise in world feet. Identical coords give identical output in any
    map, which is what makes ground texture continuous across a seam."""
    u, v = X / cell_ft, Y / cell_ft
    ix, iy = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
    fx, fy = (u - ix).astype(np.float32), (v - iy).astype(np.float32)
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = _hash2(ix, iy, seed);       b = _hash2(ix + 1, iy, seed)
    c = _hash2(ix, iy + 1, seed);   d = _hash2(ix + 1, iy + 1, seed)
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def fbm(X, Y, cell_ft, seed, octaves=4):
    out, amp, tot, cf = 0, 1.0, 0.0, cell_ft
    for o in range(octaves):
        out = out + amp * wnoise(X, Y, cf, seed + o * 101)
        tot += amp; amp *= 0.5; cf *= 0.5
    return out / tot


def scatter(x0, y0, x1, y1, cell_ft, seed):
    """Jittered world grid. Cells are absolute, so two maps covering the same
    ground produce identical objects there — no duplicates, no gaps."""
    i0, i1 = int(math.floor(x0 / cell_ft)), int(math.ceil(x1 / cell_ft))
    j0, j1 = int(math.floor(y0 / cell_ft)), int(math.ceil(y1 / cell_ft))
    ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
    ii, jj = ii.ravel(), jj.ravel()
    jx, jy = _hash2(ii, jj, seed), _hash2(ii, jj, seed + 7717)
    px = (ii + jx) * cell_ft
    py = (jj + jy) * cell_ft
    keep = (px >= x0) & (px <= x1) & (py >= y0) & (py <= y1)
    return (px[keep], py[keep],
            _hash2(ii[keep], jj[keep], seed + 991),
            _hash2(ii[keep], jj[keep], seed + 3313))


def main(col, row):
    wf = json.load(open(f"{OUT}/world_field.json"))
    hexes = json.load(open(f"{OUT}/hexes.json"))
    T = {(h["col"], h["row"]): h for h in hexes["hexes"]}
    me, wme = T[(col, row)], wf["hexes"][f"{col},{row}"]
    try:
        infest = json.load(open(f"{OUT}/overrides.json"))["infestation"].get(f"{col},{row}", 0.0)
    except Exception:
        infest = 0.0

    cx_w, cy_w = hex_centre_ft(col, row)
    ox, oy = cx_w - IMG_W_FT / 2, cy_w - IMG_H_FT / 2
    w2px = lambda wx, wy: ((wx - ox) * PXF, (wy - oy) * PXF)

    near = [(c, r) for c in range(col - 2, col + 3) for r in range(row - 2, row + 3)
            if (c, r) in T]
    pts = np.array([hex_centre_ft(c, r) for c, r in near], np.float32)
    els = np.array([wf["hexes"][f"{c},{r}"]["elev_ft"] for c, r in near], np.float32)

    hw, hh = W // 3, H // 3
    gx = (np.arange(hw, dtype=np.float32) + 0.5) * (IMG_W_FT / hw) + ox
    gy = (np.arange(hh, dtype=np.float32) + 0.5) * (IMG_H_FT / hh) + oy
    GX, GY = np.meshgrid(gx, gy)

    wsum = np.zeros_like(GX); esum = np.zeros_like(GX)
    for (px_, py_), e in zip(pts, els):
        d2 = (GX - px_) ** 2 + (GY - py_) ** 2 + 1.0
        wgt = 1.0 / (d2 ** 1.6)
        wsum += wgt; esum += wgt * e
    elev = esum / wsum
    elev = elev + (fbm(GX, GY, 900, 4242, 5) - 0.5) * 120

    prof = PROFILES.get(me["terrain"], PROFILES["_default"])
    n_mid = fbm(GX, GY, 320, 11, 4)
    n_fine = wnoise(GX, GY, 34, 23)
    b = np.clip(0.55 * n_mid + 0.45 * n_fine, 0, 1)[..., None]
    LOAM, LEAF, GRASS, MOSS = (np.array(c, np.float32) for c in prof["ground"])
    g = LOAM * (1 - b) ** 2 + LEAF * 2 * b * (1 - b) + GRASS * b ** 2
    g = g * (1 - 0.3 * n_mid[..., None]) + MOSS * 0.3 * n_mid[..., None]

    gyv, gxv = np.gradient(elev)
    shade = np.clip(1.0 + (gxv + gyv) * 0.28, 0.86, 1.16)
    g *= shade[..., None]

    if infest > 0:
        myc = fbm(GX, GY, 210, 6161, 3)
        m = np.clip((myc - (1.0 - infest) * 0.55) * 2.4, 0, 1) * infest
        g = g * (1 - m[..., None] * 0.62) + np.array([158, 152, 138], np.float32) * m[..., None] * 0.62
        v = np.clip((fbm(GX, GY, 70, 6262, 2) - 0.62) * 5, 0, 1) * infest
        g = g * (1 - v[..., None] * 0.45) + np.array([126, 112, 140], np.float32) * v[..., None] * 0.45

    ground = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
    base = ground.convert("RGBA")
    d_ = ImageDraw.Draw(base, "RGBA")
    del g, ground, GX, GY, elev, n_mid, n_fine

    def wob(x, y, amp, seed):
        n = wnoise(np.array([[x]], np.float32), np.array([[y]], np.float32), 200, seed)[0, 0]
        return (float(n) - 0.5) * amp

    rmask = Image.new("L", (W, H), 0); rd = ImageDraw.Draw(rmask)
    # A reach is defined GLOBALLY as centre -> crossing -> neighbour centre, and
    # BOTH hexes draw the whole thing. Drawing only own-centre -> crossing looks
    # right in isolation but gives each side a different curve through the
    # overlap, so the channel kinks at the seam even though the crossing matches.
    reaches = []
    for riv in wme["rivers"]:
        nb = neighbours(col, row)[riv["edge"]]
        cross = tuple(riv["cross_ft"])
        na, nb_c = hex_centre_ft(col, row), hex_centre_ft(*nb)
        wdt = 7.0 + 3.4 * math.sqrt(max(riv["flow"], 1))
        pts_w = []
        for (p, q) in ((na, cross), (cross, nb_c)):
            N = 20
            for k in range(N + 1):
                t = k / N
                x, y = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
                amp = 130 * math.sin(math.pi * t) ** 0.8   # zero at both ends
                pts_w.append((x + wob(x, y, amp, 501), y + wob(x, y, amp, 907)))
        reaches.append(([w2px(*p) for p in pts_w], wdt))

    # Build each layer as a MASK, then blend once. Stroking semi-transparent
    # gravel per reach composites the alpha twice wherever reaches overlap, and
    # PIL butt-caps thick lines, so a reach ending mid-bend cuts a straight
    # notch out of the outer bank. Caps on every vertex, blend once, no seams.
    gmask = Image.new("L", (W, H), 0); gd = ImageDraw.Draw(gmask)
    wmask = Image.new("L", (W, H), 0); wd_ = ImageDraw.Draw(wmask)
    smask = Image.new("L", (W, H), 0); sd_ = ImageDraw.Draw(smask)

    def stroke(drw, pts, width):
        drw.line(pts, fill=255, width=max(1, int(width)), joint="curve")
        r = max(1, int(width)) / 2
        for p in pts:
            drw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)

    for px_pts, wdt in reaches:
        stroke(gd, px_pts, wdt * 2.1 * PXF)
    for px_pts, wdt in reaches:
        stroke(wd_, px_pts, wdt * PXF)
        stroke(rd, px_pts, wdt * 2.1 * PXF)
    for px_pts, wdt in reaches:
        stroke(sd_, px_pts, max(2, wdt * 0.35 * PXF))

    def blend(mask, rgb, alpha):
        base.paste(Image.new("RGBA", (W, H), rgb + (255,)), (0, 0),
                   mask.point(lambda v: v * alpha // 255))
    blend(gmask, (126, 122, 100), 190)
    blend(wmask, (74, 104, 110), 255)
    blend(smask, (104, 132, 136), 120)
    del gmask, wmask, smask

    # ── WATER-HEX CHANNEL (hexmap 0.7) ──────────────────────────────────
    # The macro river is whole HEXES of water_shallow. The channel spans the
    # hex, connecting every edge whose neighbour is also water; width and
    # crossing derive from the SORTED pair + hydrology (edge_random /
    # edge_midpoint_ft), so adjacent water hexes agree at the seam the same
    # way river reaches do. The deep channel emits deep_water WALLS (move
    # blocked, sight clear); FORDS are gaps in those walls — every water hex
    # guarantees one on its calmest channel, so the river is always
    # crossable somewhere, and only somewhere.
    water_wall_polys = []
    struct = STRUCTURES.get((col, row))
    if me["terrain"] in WATER_TERRAINS:
        chans = []
        for edge in EDGE_OF_SEGMENT:
            nb = neighbours(col, row)[edge]
            nbh = T.get(tuple(nb))
            if not nbh or nbh["terrain"] not in WATER_TERRAINS:
                continue
            f2 = wf["hexes"].get(f"{nb[0]},{nb[1]}", {}).get("flow", 1)
            flow = (max(wme.get("flow", 1), 1) + max(f2, 1)) / 2
            wdt = min(540.0, 240.0 + 26.0 * math.sqrt(flow)
                      + 110.0 * edge_random((col, row), nb, "chanw"))
            chans.append((edge, nb, edge_midpoint_ft(col, row, edge), wdt, flow))

        def chan_pts(cross):
            N = 24
            out = []
            for k in range(N + 1):
                t = k / N
                x = cx_w + (cross[0] - cx_w) * t
                y = cy_w + (cross[1] - cy_w) * t
                amp = 90 * math.sin(math.pi * t) ** 0.8   # zero at both ends
                out.append((x + wob(x, y, amp, 7141), y + wob(x, y, amp, 7331), t))
            return out

        bank = Image.new("L", (W, H), 0); bkd = ImageDraw.Draw(bank)
        wat = Image.new("L", (W, H), 0); wtd = ImageDraw.Draw(wat)
        deep = Image.new("L", (W, H), 0); dpd = ImageDraw.Draw(deep)
        frd = Image.new("L", (W, H), 0); frdd = ImageDraw.Draw(frd)

        if not chans:
            # closed water with no through-channel: a lake, ringed by a
            # wadeable shore (no deep wall gap needed — the shore IS the way)
            R = 420.0
            cpx = w2px(cx_w, cy_w)
            for m_, rr in ((bkd, R * 1.18), (wtd, R), (dpd, R * 0.62)):
                m_.ellipse([cpx[0] - rr * PXF, cpx[1] - rr * PXF,
                            cpx[0] + rr * PXF, cpx[1] + rr * PXF], fill=255)
            water_wall_polys.append(("deep_water", _ngon_ft(cx_w, cy_w, R * 0.62, 18)))
        else:
            calmest = min(range(len(chans)), key=lambda i: chans[i][4])
            for ci, (edge, nb, cross, wdt, flow) in enumerate(chans):
                pts = chan_pts(cross)
                pp = [w2px(x, y) for x, y, _ in pts]
                stroke(bkd, pp, wdt * 1.30 * PXF)
                stroke(wtd, pp, wdt * PXF)
                has_ford = ci == calmest or edge_random((col, row), nb, "ford") < 0.35
                ft_ = 0.45 + 0.33 * edge_random((col, row), nb, "fordt")
                half = 30.0 / max(wdt, 1.0)
                segs = [(0.0, ft_ - half), (ft_ + half, 1.0)] if has_ford else [(0.0, 1.0)]
                dw = wdt * 0.60
                for (t0, t1) in segs:
                    seg = [(x, y) for x, y, t in pts if t0 - 1e-9 <= t <= t1 + 1e-9]
                    if len(seg) < 2:
                        continue
                    stroke(dpd, [w2px(x, y) for x, y in seg], dw * PXF)
                    water_wall_polys.append(("deep_water", _band_ft(seg, dw / 2)))
                if has_ford:
                    fi = min(range(len(pts)), key=lambda i: abs(pts[i][2] - ft_))
                    fx_, fy_ = pts[fi][0], pts[fi][1]
                    # direction across the channel at the ford
                    gx0, gy0, _ = pts[max(fi - 1, 0)]
                    gx1, gy1, _ = pts[min(fi + 1, len(pts) - 1)]
                    dl = math.hypot(gx1 - gx0, gy1 - gy0) or 1.0
                    pxn, pyn = -(gy1 - gy0) / dl, (gx1 - gx0) / dl
                    barw = wdt * 0.62
                    fpts = [w2px(fx_ + pxn * barw * t2 + (gx1 - gx0) / dl * 26 * math.sin(t2 * 3.1),
                                 fy_ + pyn * barw * t2 + (gy1 - gy0) / dl * 26 * math.sin(t2 * 3.1))
                            for t2 in [x / 10 - 1 for x in range(21)]]
                    frdd.line(fpts, fill=255, width=int(44 * PXF))
                    for fp in fpts:
                        frdd.ellipse([fp[0] - 20 * PXF, fp[1] - 20 * PXF,
                                      fp[0] + 20 * PXF, fp[1] + 20 * PXF], fill=255)
            if len(chans) >= 2:
                R = max(c[3] for c in chans) * 0.62
                cpx = w2px(cx_w, cy_w)
                for m_, rr in ((bkd, R * 1.25), (wtd, R * 1.05), (dpd, R * 0.7)):
                    m_.ellipse([cpx[0] - rr * PXF, cpx[1] - rr * PXF,
                                cpx[0] + rr * PXF, cpx[1] + rr * PXF], fill=255)
                water_wall_polys.append(("deep_water", _ngon_ft(cx_w, cy_w, R * 0.7, 18)))

        def blend2(mask, rgb, alpha):
            base.paste(Image.new("RGBA", (W, H), rgb + (255,)), (0, 0),
                       mask.point(lambda v: v * alpha // 255))
        blend2(bank, (150, 142, 112), 210)
        blend2(wat, (88, 118, 124), 255)
        blend2(deep, (52, 84, 96), 235)
        sh_mask = Image.composite(frd, Image.new("L", (W, H), 0), wat)
        blend2(sh_mask, (172, 164, 126), 200)
        # stepping stones on the bar, world-anchored
        stx, sty, sta, stb = scatter(ox, oy, ox + IMG_W_FT, oy + IMG_H_FT, 22, 5511)
        sh_px = sh_mask.load()
        for k in range(len(stx)):
            if stb[k] > 0.5:
                continue
            sx_, sy_ = w2px(stx[k], sty[k])
            if not (0 <= sx_ < W and 0 <= sy_ < H) or sh_px[int(sx_), int(sy_)] < 128:
                continue
            rr = (2.4 + sta[k] * 3.6) * PXF
            gg = int(126 + stb[k] * 60)
            d_.ellipse([sx_ - rr, sy_ - rr * 0.8, sx_ + rr, sy_ + rr * 0.8],
                       fill=(gg, gg - 6, gg - 18, 235))
        # current glints on open water, world-anchored like everything else
        glx, gly, gla, glb = scatter(ox, oy, ox + IMG_W_FT, oy + IMG_H_FT, 55, 9911)
        wat_px = wat.load()
        for k in range(len(glx)):
            if glb[k] > 0.30:
                continue
            gx_, gy_ = w2px(glx[k], gly[k])
            if not (0 <= gx_ < W and 0 <= gy_ < H) or wat_px[int(gx_), int(gy_)] < 128:
                continue
            L2 = (6 + gla[k] * 14) * PXF
            d_.line([gx_ - L2, gy_, gx_ + L2, gy_ + L2 * 0.12],
                    fill=(190, 210, 214, 90), width=max(1, int(PXF * 0.3)))
        # the whole waterworks suppresses vegetation
        rmask.paste(255, (0, 0), bank)
        del bank, wat, deep, frd, sh_mask

    if struct:
        # structure footprint suppresses vegetation before anything scatters
        cpx = w2px(cx_w, cy_w)
        RS = 430 * PXF
        rd.ellipse([cpx[0] - RS, cpx[1] - RS, cpx[0] + RS, cpx[1] + RS], fill=255)

    rm_full = np.asarray(rmask, np.float32) / 255
    del rmask

    def in_river(wx, wy):
        px_, py_ = w2px(wx, wy)
        ix, iy = int(np.clip(px_, 0, W - 1)), int(np.clip(py_, 0, H - 1))
        return rm_full[iy, ix] > 0.08

    polys = []
    def add(cls, pts_px):
        if any(not (0 <= x <= W and 0 <= y <= H) for x, y in pts_px):
            return False
        polys.append((cls, pts_px)); return True

    x0w, y0w, x1w, y1w = ox, oy, ox + IMG_W_FT, oy + IMG_H_FT
    for cls, wpts in water_wall_polys:
        # Clamp to canvas: add() DROPS any poly with a point outside, and a
        # dropped deep_water band is an invisible hole in the river.
        add(cls, [(min(max(px_, 0.0), float(W)), min(max(py_, 0.0), float(H)))
                  for px_, py_ in (w2px(x, y) for x, y in wpts)])
    _rock_shadows = []

    # ---------------- undergrowth ---------------------------------------------
    ux, uy, ua, ub = scatter(x0w, y0w, x1w, y1w, prof["ug_cell"], 5150)
    for k in range(len(ux)):
        if ub[k] > prof["ug_reject"] or in_river(ux[k], uy[k]):
            continue
        r_ft = prof["ug_r"][0] + ua[k] * (prof["ug_r"][1] - prof["ug_r"][0])
        cx_, cy_ = w2px(ux[k], uy[k])
        rr = r_ft * PXF
        n = 9
        a0 = ua[k] * 6.28
        g = orng(int(ux[k]), int(uy[k]), 31)
        pts = [(cx_ + rr * (0.78 + 0.42 * g.random()) * math.cos(a0 + 2 * math.pi * i / n),
                cy_ + rr * (0.78 + 0.42 * g.random()) * math.sin(a0 + 2 * math.pi * i / n) * 0.85)
               for i in range(n)]
        if prof["ug_wall"]:
            if not add(prof.get("ug_class", "undergrowth"), pts):
                continue
        elif any(not (0 <= x <= W and 0 <= y <= H) for x, y in pts):
            continue
        ut = prof["ug_tint"]
        style = prof.get("ug_style", "fern")
        if style == "none":
            continue
        patch_a = {"fern": 205, "reed": 170, "scrub": 84, "grass": 0}[style]
        if patch_a:
            d_.polygon(pts, fill=(52 + ut[0], 80 + ut[1], 38 + ut[2], patch_a))
        fx, fy, fa, fb = scatter(ux[k] - r_ft, uy[k] - r_ft, ux[k] + r_ft, uy[k] + r_ft, 9, 9001)
        for m in range(len(fx)):
            if (fx[m] - ux[k]) ** 2 + (fy[m] - uy[k]) ** 2 > r_ft * r_ft:
                continue
            sx, sy = w2px(fx[m], fy[m]); fr = (7 + fa[m] * 9) * PXF
            kk = int(fb[m] * 34 - 17)
            c_lo = (62 + kk + ut[0], 100 + kk + ut[1], 42 + kk + ut[2], 230)
            c_hi = (78 + kk + ut[0], 118 + kk + ut[1], 50 + kk + ut[2], 215)
            if style == "fern":
                # rosette of leaf lobes. Radial strokes read as spiderwebs at
                # this scale — long, 2px wide, radiating from a point.
                for f in range(6):
                    fa_ = fb[m] * 6.28 + f * 1.047
                    lx = sx + math.cos(fa_) * fr * 0.52
                    ly = sy + math.sin(fa_) * fr * 0.44
                    lr = fr * 0.46
                    d_.ellipse([lx - lr, ly - lr * 0.66, lx + lr, ly + lr * 0.66], fill=c_lo)
                d_.ellipse([sx - fr * 0.38, sy - fr * 0.30, sx + fr * 0.38, sy + fr * 0.30],
                           fill=c_hi)
            elif style == "grass":
                # a splayed tuft: blades from a common root, leaning outward
                for f in range(7):
                    a2 = -math.pi / 2 + (f / 6 - 0.5) * 1.7 + (fb[m] - 0.5) * 0.6
                    L2 = fr * (0.7 + 0.5 * ((f * 37 + m) % 7) / 7)
                    d_.line([sx, sy + fr * 0.2, sx + math.cos(a2) * L2, sy + math.sin(a2) * L2],
                            fill=c_lo, width=max(1, int(PXF * 0.28)))
                d_.line([sx, sy + fr * 0.2, sx + (fb[m] - 0.5) * fr * 0.5, sy - fr * 1.05],
                        fill=c_hi, width=max(1, int(PXF * 0.3)))
            elif style == "reed":
                # tall near-vertical stems with a seed head
                for f in range(5):
                    off = (f / 4 - 0.5) * fr * 1.1
                    lean = (fb[m] - 0.5) * 0.5
                    tipx, tipy = sx + off + lean * fr, sy - fr * (1.5 + 0.5 * ((f * 13 + m) % 5) / 5)
                    d_.line([sx + off, sy + fr * 0.3, tipx, tipy],
                            fill=c_lo, width=max(1, int(PXF * 0.26)))
                    d_.ellipse([tipx - fr * 0.11, tipy - fr * 0.3, tipx + fr * 0.11, tipy + fr * 0.06],
                               fill=c_hi)
            else:                                    # scrub: low woody clumps
                for f in range(5):
                    a2 = fb[m] * 6.28 + f * 1.256
                    bx2 = sx + math.cos(a2) * fr * 0.42
                    by2 = sy + math.sin(a2) * fr * 0.34
                    br = fr * (0.34 + 0.2 * ((f * 29 + m) % 5) / 5)
                    d_.ellipse([bx2 - br, by2 - br * 0.72, bx2 + br, by2 + br * 0.72], fill=c_lo)
                d_.ellipse([sx - fr * 0.3, sy - fr * 0.34, sx + fr * 0.24, sy + fr * 0.1], fill=c_hi)

    # ---------------- fungal blooms ---------------------------------------------
    if infest > 0.12:
        fx, fy, fa, fb = scatter(x0w, y0w, x1w, y1w, 74, 7373)
        big = 0
        for k in range(len(fx)):
            if fb[k] > infest * 0.85 or in_river(fx[k], fy[k]):
                continue
            g2 = orng(int(fx[k]), int(fy[k]), 5959)
            px_, py_ = w2px(fx[k], fy[k])
            if infest > 0.55 and g2.random() < 0.22 and big < 14:
                R = (4 + g2.random() * 5) / 5.0 * PPG
                n = 7; a0 = g2.random() * 6.28
                pts = [(px_ + R * (0.82 + 0.34 * g2.random()) * math.cos(a0 + 2 * math.pi * i / n),
                        py_ + R * (0.82 + 0.34 * g2.random()) * math.sin(a0 + 2 * math.pi * i / n) * 0.9)
                       for i in range(n)]
                if add("fungal_cap", pts):
                    big += 1
                    d_.polygon([(x + 10, y + 14) for x, y in pts], fill=(0, 0, 0, 70))
                    d_.polygon(pts, fill=(196, 184, 156, 255))
                    d_.polygon([(px_ + (x - px_) * 0.6 - R * .14, py_ + (y - py_) * 0.6 - R * .2)
                                for x, y in pts], fill=(224, 214, 188, 190))
                continue
            for _ in range(g2.randint(3, 8)):
                a_ = g2.random() * 6.28; rr = g2.random() * 26 * PXF
                sx, sy = px_ + math.cos(a_) * rr, py_ + math.sin(a_) * rr
                cr_ = (1.2 + g2.random() * 2.6) * PXF
                d_.ellipse([sx - cr_ * 0.35, sy, sx + cr_ * 0.35, sy + cr_ * 1.1], fill=(206, 198, 176, 230))
                d_.ellipse([sx - cr_, sy - cr_ * 0.62, sx + cr_, sy + cr_ * 0.5], fill=(228, 220, 196, 255))
                d_.ellipse([sx - cr_ * 0.7, sy - cr_ * 0.5, sx + cr_ * 0.5, sy], fill=(246, 240, 222, 190))

    # ---------------- rock outcrops ---------------------------------------------
    if prof.get("rocks"):
        rx, ry, ra, rb = scatter(x0w, y0w, x1w, y1w, prof.get("rock_cell", 165), 3131)
        placed_r = 0
        for k in range(len(rx)):
            if placed_r >= prof["rocks"] or rb[k] > 0.5 or in_river(rx[k], ry[k]):
                continue
            _r0, _r1 = prof.get("rock_ft", (5, 18))
            r_ft = _r0 + ra[k] * (_r1 - _r0)
            px_, py_ = w2px(rx[k], ry[k]); R = r_ft * PXF
            g = orng(int(rx[k]), int(ry[k]), 41)
            n = 7
            a0 = g.random() * 6.28
            pts = [(px_ + R * (0.76 + 0.42 * g.random()) * math.cos(a0 + 2 * math.pi * i / n),
                    py_ + R * (0.76 + 0.42 * g.random()) * math.sin(a0 + 2 * math.pi * i / n) * 0.86)
                   for i in range(n)]
            if not add("boulder", pts):
                continue
            placed_r += 1
            _rock_shadows.append([(px_ + (x - px_) * 1.06 + 9, py_ + (y - py_) * 1.06 + 13)
                                  for x, y in pts])
            gc = int(92 + g.random() * 34)
            d_.polygon(pts, fill=(gc, gc - 4, gc - 12, 255))
            d_.polygon([(px_ + (x - px_) * 0.62 - R * .16, py_ + (y - py_) * 0.62 - R * .2)
                        for x, y in pts], fill=(gc + 22, gc + 18, gc + 6, 115))
            if prof.get("rock_moss", True):
                d_.ellipse([px_ - R * .5, py_ + R * .04, px_ + R * .86, py_ + R * .7],
                           fill=(58, 88, 46, 105))

    if prof.get("massif"):
        mx_, my_, ma, mb = scatter(x0w, y0w, x1w, y1w, 300, 2929)
        placed_m = 0
        for k in range(len(mx_)):
            if placed_m >= prof["massif"] or mb[k] > 0.62:
                continue
            m0, m1 = prof["massif_ft"]
            R = (m0 + ma[k] * (m1 - m0)) * PXF
            px_, py_ = w2px(mx_[k], my_[k])
            g = orng(int(mx_[k]), int(my_[k]), 77)
            n = 9
            a0 = g.random() * 6.28
            pts = [(px_ + R * (0.68 + 0.5 * g.random()) * math.cos(a0 + 2 * math.pi * i / n),
                    py_ + R * (0.68 + 0.5 * g.random()) * math.sin(a0 + 2 * math.pi * i / n) * 0.88)
                   for i in range(n)]
            if not add("cliff", pts):
                continue
            placed_m += 1
            _rock_shadows.append([(px_ + (x - px_) * 1.05 + 16, py_ + (y - py_) * 1.05 + 24)
                                  for x, y in pts])
            gc = int(112 + g.random() * 30)
            d_.polygon(pts, fill=(gc, gc - 4, gc - 12, 255))
            # lit face plus a couple of fracture lines so it reads as rock mass
            d_.polygon([(px_ + (x - px_) * 0.66 - R * .18, py_ + (y - py_) * 0.66 - R * .22)
                        for x, y in pts], fill=(gc + 26, gc + 22, gc + 10, 150))
            for f in range(3):
                a1 = g.random() * 6.28
                d_.line([px_ + math.cos(a1) * R * 0.2, py_ + math.sin(a1) * R * 0.2,
                         px_ + math.cos(a1) * R * 0.9, py_ + math.sin(a1) * R * 0.8],
                        fill=(gc - 34, gc - 36, gc - 40, 190), width=max(2, int(PXF * 0.5)))

    if prof.get("scree"):
        sx_, sy_, sa, sb = scatter(x0w, y0w, x1w, y1w, 26, 1717)
        for k in range(min(len(sx_), prof["scree"])):
            if sb[k] > 0.62 or in_river(sx_[k], sy_[k]):
                continue
            px_, py_ = w2px(sx_[k], sy_[k])
            rr = (1.6 + sa[k] * 5.4) * PXF
            gg = int(96 + sb[k] * 54)
            d_.polygon([(px_ - rr, py_ + rr * 0.5), (px_ - rr * 0.4, py_ - rr * 0.8),
                        (px_ + rr * 0.8, py_ - rr * 0.3), (px_ + rr * 0.5, py_ + rr * 0.7)],
                       fill=(gg, gg - 5, gg - 13, 235))

    if _rock_shadows:
        rs = Image.new("RGBA", (W // 4, H // 4), (0, 0, 0, 0)); rsd = ImageDraw.Draw(rs, "RGBA")
        for poly in _rock_shadows:
            rsd.polygon([(x / 4, y / 4) for x, y in poly], fill=(0, 0, 0, 90))
        base = Image.alpha_composite(base, rs.filter(ImageFilter.GaussianBlur(5)).resize((W, H), Image.BILINEAR))
        d_ = ImageDraw.Draw(base, "RGBA"); del rs

    # ---------------- trees -----------------------------------------------------
    tx, ty, ta, tb = scatter(x0w, y0w, x1w, y1w, prof["tree_cell"], 8080)
    trees = []
    for k in range(len(tx)):
        if tb[k] > prof["tree_reject"] or in_river(tx[k], ty[k]):
            continue
        trunk_ft = prof["trunk_ft"][0] + ta[k] * (prof["trunk_ft"][1] - prof["trunk_ft"][0])
        can_ft = prof["canopy_ft"][0] + tb[k] * (prof["canopy_ft"][1] - prof["canopy_ft"][0])
        trees.append((tx[k], ty[k], trunk_ft, can_ft, ta[k]))

    sh = Image.new("RGBA", (W // 4, H // 4), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh, "RGBA")
    for wx, wy, tr, cr, _ in trees:
        px_, py_ = w2px(wx, wy); r = cr * PXF
        sd.ellipse([(px_ - r * .85 + 150) / 4, (py_ - r * .72 + 200) / 4,
                    (px_ + r * .85 + 150) / 4, (py_ + r * .72 + 200) / 4], fill=(0, 0, 0, 66))
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(8)).resize((W, H), Image.BILINEAR))
    d_ = ImageDraw.Draw(base, "RGBA"); del sh

    can = Image.new("RGBA", (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(can, "RGBA")
    for wx, wy, tr_ft, cr_ft, seed in sorted(trees, key=lambda t: t[1]):
        px_, py_ = w2px(wx, wy)
        R, TR = cr_ft * PXF, tr_ft / 2 * PXF
        dk = int(seed * 28 - 14)
        g = orng(int(wx), int(wy), 61)
        # Past a threshold the fungus does not decorate the tree, it kills it.
        # Consumed trees lose their crown: some stand as bare snags, some are
        # replaced by the fruiting body that ate them.
        consumed = infest > 0.35 and g.random() < (infest - 0.35) / 0.65 * 0.92
        tower = consumed and g.random() < 0.38
        if consumed:
            if tower:
                CR = R * (0.42 + g.random() * 0.34)
                cd.ellipse([px_ - CR * 1.05, py_ - CR * 0.9 + CR * 0.18,
                            px_ + CR * 1.05, py_ + CR * 0.9 + CR * 0.18], fill=(0, 0, 0, 70))
                for lobe in range(5):
                    a_ = g.random() * 6.28; rad = g.random() * CR * 0.3
                    rr = CR * (0.68 + g.random() * 0.3)
                    ox_, oy_ = px_ + math.cos(a_) * rad, py_ + math.sin(a_) * rad
                    cd.ellipse([ox_ - rr, oy_ - rr * 0.92, ox_ + rr, oy_ + rr * 0.92],
                               fill=(178 + dk, 168 + dk, 142 + dk, 255))
                for lobe in range(4):
                    a_ = g.random() * 6.28; rad = g.random() * CR * 0.34
                    rr = CR * (0.3 + g.random() * 0.26)
                    ox_, oy_ = px_ + math.cos(a_) * rad - CR * 0.14, py_ + math.sin(a_) * rad - CR * 0.18
                    cd.ellipse([ox_ - rr, oy_ - rr, ox_ + rr, oy_ + rr],
                               fill=(216 + dk, 208 + dk, 182 + dk, 210))
                cd.ellipse([px_ - TR * 0.8, py_ - TR * 0.8, px_ + TR * 0.8, py_ + TR * 0.8],
                           fill=(146, 138, 116, 255))
            else:
                cd.ellipse([px_ - TR * 1.7, py_ - TR * 1.7, px_ + TR * 1.7, py_ + TR * 1.7],
                           fill=(38, 32, 24, 190))
                cd.ellipse([px_ - TR, py_ - TR, px_ + TR, py_ + TR], fill=(72, 62, 48, 255))
                cd.ellipse([px_ - TR * 0.45, py_ - TR * 0.45, px_ + TR * 0.45, py_ + TR * 0.45],
                           fill=(44, 38, 30, 255))
        for i in range(9):
            if consumed: break
            hx = g.random(); hy = g.random()
            a_ = hx * 6.28; rad = hy * R * 0.42
            rr = R * (0.54 + hx * 0.28)
            cd.ellipse([px_ + math.cos(a_) * rad - rr, py_ + math.sin(a_) * rad - rr,
                        px_ + math.cos(a_) * rad + rr, py_ + math.sin(a_) * rad + rr],
                       fill=tuple(c + dk for c in prof["canopy"]) + (245,))
        for i in range(8):
            if consumed: break
            hx = g.random(); hy = g.random()
            a_ = hx * 6.28; rad = hy * R * 0.46
            rr = R * (0.20 + hx * 0.22)
            cd.ellipse([px_ + math.cos(a_) * rad - rr - R * .15, py_ + math.sin(a_) * rad - rr - R * .18,
                        px_ + math.cos(a_) * rad + rr - R * .15, py_ + math.sin(a_) * rad + rr - R * .18],
                       fill=tuple(c + dk for c in prof["canopy_lit"]) + (175,))
        if not consumed:
            cd.ellipse([px_ - TR * 1.9, py_ - TR * 1.9, px_ + TR * 1.9, py_ + TR * 1.9], fill=(44, 34, 24, 200))
            cd.ellipse([px_ - TR, py_ - TR, px_ + TR, py_ + TR], fill=prof["trunk"] + (255,))
        if tr_ft >= 8 and not consumed:
            for rr_ in (0.84, 0.64, 0.44):
                cd.ellipse([px_ - TR * rr_, py_ - TR * rr_, px_ + TR * rr_, py_ + TR * rr_],
                           outline=(72, 44, 30, 130), width=max(2, int(TR * 0.05)))
        if infest > 0:
            fg = orng(int(wx), int(wy), 8811)
            if consumed or fg.random() < 0.28 + 0.62 * infest:
                for _ in range(fg.randint(2, 3 + int(4 * infest)) + (3 if consumed else 0)):
                    a_ = fg.random() * 6.28
                    rad = TR * fg.uniform(0.85, 1.5)
                    sx, sy = px_ + math.cos(a_) * rad, py_ + math.sin(a_) * rad
                    sw = TR * fg.uniform(0.55, 1.25) + 3
                    tint = int(fg.uniform(-16, 16))
                    cd.chord([sx - sw, sy - sw * 0.52, sx + sw, sy + sw * 0.52],
                             int(math.degrees(a_)) + 168, int(math.degrees(a_)) + 372,
                             fill=(86 + tint, 78 + tint, 60 + tint, 255))
                    cd.chord([sx - sw * 0.9, sy - sw * 0.46, sx + sw * 0.9, sy + sw * 0.4],
                             int(math.degrees(a_)) + 172, int(math.degrees(a_)) + 368,
                             fill=(206 + tint, 196 + tint, 168 + tint, 255))
        if tr_ft >= 3.0:
            n = 6
            add("tree_trunk", [(px_ + TR * 1.16 * math.cos(2 * math.pi * i / n + math.pi / n),
                                py_ + TR * 1.16 * math.sin(2 * math.pi * i / n + math.pi / n))
                               for i in range(n)])
    base = Image.alpha_composite(base, can).convert("RGB"); del can
    # ⚠ alpha_composite returns a NEW image. Anything still holding the old
    # ImageDraw paints into a canvas already thrown away — the deadfall
    # registered walls but drew nothing, giving invisible barriers.
    d_ = ImageDraw.Draw(base, "RGBA")

    # ---------------- deadfall -------------------------------------------------
    if prof["logs"]:
        lx, ly, la, lb = scatter(x0w, y0w, x1w, y1w, 210, 4242)
        placed = 0
        for k in range(len(lx)):
            if placed >= prof["logs"] or lb[k] > 0.55 or in_river(lx[k], ly[k]):
                continue
            L = (prof["log_ft"][0] + la[k] * (prof["log_ft"][1] - prof["log_ft"][0])) * PXF
            wd = (7 + lb[k] * 9) * PXF
            ang = la[k] * math.pi
            px_, py_ = w2px(lx[k], ly[k])
            hx, hy = math.cos(ang) * L / 2, math.sin(ang) * L / 2
            nx_, ny_ = -math.sin(ang) * wd / 2, math.cos(ang) * wd / 2
            pts = [(px_ - hx + nx_, py_ - hy + ny_), (px_ + hx + nx_, py_ + hy + ny_),
                   (px_ + hx * 1.06, py_ + hy * 1.06),
                   (px_ + hx - nx_, py_ + hy - ny_), (px_ - hx - nx_, py_ - hy - ny_),
                   (px_ - hx * 1.06, py_ - hy * 1.06)]
            if not add("fallen_log", pts):
                continue
            placed += 1
            d_.line([px_ - hx + 14, py_ - hy + 18, px_ + hx + 14, py_ + hy + 18],
                    fill=(0, 0, 0, 80), width=int(wd))
            d_.polygon(pts, fill=(62, 45, 32, 255))
            for f in range(6):
                o = (f / 5 - 0.5) * 1.3
                d_.line([px_ - hx + nx_ * o, py_ - hy + ny_ * o,
                         px_ + hx + nx_ * o, py_ + hy + ny_ * o],
                        fill=(84, 62, 42, 150), width=max(2, int(wd * 0.09)))
            for e in (-1, 1):
                ex, ey = px_ + hx * e, py_ + hy * e
                d_.ellipse([ex - wd / 2, ey - wd / 2, ex + wd / 2, ey + wd / 2], fill=(104, 68, 44, 255))

    # ---------------- authored structure: the conjured water castle -------------
    # Everything is polar around the hex centre, gate aimed at face_hex, all
    # radii in world feet — deterministic by construction, no per-map seed.
    # Walls are of WATER: solid-class (they block like stone; they are held,
    # not built) with the moat as deep_water bands. The causeway is the only
    # way across the moat and the gate the only break in the curtain.
    if struct and struct.get("kind") == "water_castle":
        fcx, fcy = hex_centre_ft(*struct["face_hex"])
        aF = math.atan2(fcy - cy_w, fcx - cx_w)
        ccx, ccy = w2px(cx_w, cy_w)

        def disc(r):
            return [ccx - r * PXF, ccy - r * PXF, ccx + r * PXF, ccy + r * PXF]

        # moat ring 290..370 ft, causeway cut toward the face hex
        moat = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(moat)
        md.ellipse(disc(370), fill=255)
        md.ellipse(disc(290), fill=0)
        cwx, cwy = w2px(cx_w + math.cos(aF) * 460, cy_w + math.sin(aF) * 460)
        md.line([ccx, ccy, cwx, cwy], fill=0, width=int(80 * PXF))
        base.paste(Image.new("RGBA", (W, H), (44, 78, 94, 255)), (0, 0),
                   moat.point(lambda v: v * 245 // 255))
        d_.ellipse(disc(370), outline=(150, 190, 200, 150), width=max(2, int(PXF * 1.1)))
        d_.ellipse(disc(290), outline=(150, 190, 200, 150), width=max(2, int(PXF * 1.1)))
        del moat
        # causeway paving: gate lip to beyond the outer bank, kerbed
        _cw0 = w2px(cx_w + math.cos(aF) * 205, cy_w + math.sin(aF) * 205)
        _cw1 = w2px(cx_w + math.cos(aF) * 445, cy_w + math.sin(aF) * 445)
        d_.line([_cw0, _cw1], fill=(148, 144, 124, 255), width=int(68 * PXF))
        d_.line([_cw0, _cw1], fill=(170, 166, 146, 255), width=int(52 * PXF))
        _kx, _ky = -math.sin(aF) * 30, math.cos(aF) * 30
        for sgn in (1, -1):
            d_.line([w2px(cx_w + math.cos(aF) * 210 + sgn * _kx, cy_w + math.sin(aF) * 210 + sgn * _ky),
                     w2px(cx_w + math.cos(aF) * 440 + sgn * _kx, cy_w + math.sin(aF) * 440 + sgn * _ky)],
                    fill=(112, 108, 92, 255), width=max(2, int(2.5 * PXF)))
        # courtyard: wet glass-slick ground inside the curtain
        d_.ellipse(disc(202), fill=(96, 120, 126, 235))
        d_.ellipse(disc(192), fill=(118, 142, 146, 255))
        # curtain wall of standing water: dark base arc, bright crest, with
        # the gate gap toward the causeway
        deg = math.degrees(aF)
        gate_half = 10.0                     # degrees
        d_.arc(disc(214), deg + gate_half, deg + 360 - gate_half,
               fill=(48, 92, 108, 255), width=int(26 * PXF))
        d_.arc(disc(212), deg + gate_half, deg + 360 - gate_half,
               fill=(84, 150, 168, 255), width=int(16 * PXF))
        d_.arc(disc(208), deg + gate_half, deg + 360 - gate_half,
               fill=(170, 216, 228, 210), width=max(2, int(3.5 * PXF)))
        # towers: four quarters + two gatehouse drums, drawn then walled
        tower_angles = [aF + off for off in
                        (0.42, -0.42, math.pi / 2 + 0.35, -math.pi / 2 - 0.35,
                         math.pi - 0.6, -math.pi + 0.6)]
        tower_pts = []
        for i, ta in enumerate(tower_angles):
            tr = 34 if i < 2 else 30          # gatehouse drums slightly heavier
            twx, twy = cx_w + math.cos(ta) * 212, cy_w + math.sin(ta) * 212
            tpx, tpy = w2px(twx, twy)
            R = tr * PXF
            d_.ellipse([tpx - R * 1.25, tpy - R * 1.05, tpx + R * 1.25, tpy + R * 1.45],
                       fill=(0, 0, 0, 70))
            d_.ellipse([tpx - R, tpy - R, tpx + R, tpy + R], fill=(64, 118, 136, 255))
            d_.ellipse([tpx - R * 0.62, tpy - R * 0.66, tpx + R * 0.5, tpy + R * 0.3],
                       fill=(128, 184, 200, 220))
            d_.ellipse([tpx - R * 0.3, tpy - R * 0.34, tpx + R * 0.12, tpy - R * 0.02],
                       fill=(196, 230, 238, 200))
            tower_pts.append(_ngon_ft(twx, twy, tr, 8, a0=ta))
        # the keep: a tiered spire of held water at the centre
        for kr, kc in ((96, (52, 100, 118, 255)), (74, (76, 138, 156, 255)),
                       (52, (108, 172, 190, 255)), (30, (156, 210, 224, 235)),
                       (14, (208, 238, 244, 235))):
            d_.ellipse(disc(kr), fill=kc)
        d_.ellipse(disc(96), outline=(180, 222, 232, 180), width=max(2, int(2.5 * PXF)))
        # walls: moat deep_water band (gap at causeway), curtain solid band
        # (gap at gate), gatehouse + towers, keep
        gap = 0.24                            # radians, causeway gap half-angle
        add("deep_water", [w2px(x, y) for x, y in
                           _band_ft(_arc_ft(cx_w, cy_w, 330, aF + gap, aF + 2 * math.pi - gap, 72), 42)])
        ghalf = math.radians(gate_half)
        add("solid", [w2px(x, y) for x, y in
                      _band_ft(_arc_ft(cx_w, cy_w, 210, aF + ghalf, aF + 2 * math.pi - ghalf, 72), 9)])
        for tp in tower_pts:
            add("solid", [w2px(x, y) for x, y in tp])
        add("solid", [w2px(x, y) for x, y in _ngon_ft(cx_w, cy_w, 96, 12)])

    # ---------------- hex boundary, exits, arrivals -----------------------------
    hex_px = [w2px(cx_w + vx, cy_w + vy) for vx, vy in VERTS]
    polys.insert(0, ("boundary", hex_px))

    exits, arrivals = [], []
    for i, edge in enumerate(EDGE_OF_SEGMENT):
        nb = neighbours(col, row)[edge]
        if not (0 <= nb[0] < 100 and 0 <= nb[1] < 100):
            continue
        (ax, ay), (bx, by) = VERTS[i], VERTS[(i + 1) % 6]
        inw = lambda p, f: (p[0] * (1 - f), p[1] * (1 - f))
        def band(f0, f1):
            p = [inw((ax, ay), f0), inw((bx, by), f0), inw((bx, by), f1), inw((ax, ay), f1)]
            return [{"x": round(w2px(cx_w + q[0], cy_w + q[1])[0] / PPG, 4),
                     "y": round(w2px(cx_w + q[0], cy_w + q[1])[1] / PPG, 4)} for q in p]
        exits.append({"edge": edge, "to": f"hex_{nb[0]}_{nb[1]}", "shape": band(0.0, 0.075)})
        arrivals.append({"edge": edge, "shape": band(0.10, 0.175)})

    # ---------------- emit -------------------------------------------------------
    GW, GH = W // PPG, H // PPG
    assert GW * PPG == W and GH * PPG == H, "canvas must be whole grid squares"
    los, assign = [], []
    for cls, pts in polys:
        ring = [{"x": round(x / PPG, 4), "y": round(y / PPG, 4)} for x, y in pts]
        ring.append(dict(ring[0]))
        los.append(ring); assign.append(cls)
    used = sorted(set(assign))
    q = base.quantize(colors=256, method=Image.MAXCOVERAGE)
    buf = io.BytesIO(); q.save(buf, "PNG", optimize=True)

    import hashlib, datetime
    build = hashlib.blake2b(buf.getvalue(), digest_size=3).hexdigest()
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    area = f"hex_{col}_{row}"
    uvtt = {
        "format": 0.3,
        "resolution": {"map_origin": {"x": 0, "y": 0},
                       "map_size": {"x": GW, "y": GH}, "pixels_per_grid": PPG},
        "line_of_sight": los, "objects_line_of_sight": [], "portals": [],
        "environment": {"baked_lighting": True, "ambient_light": prof["ambient"]}, "lights": [],
        "image": base64.b64encode(buf.getvalue()).decode(),
        "x_scene": {"grid_type": "gridless", "grid_distance": 5, "grid_units": "ft"},
        "x_wall_meta": {"version": 1, "generator": f"aop hexmap 0.7 {me['terrain']} {area}",
                        "classes": {k: WALL_CLASSES[k] for k in used},
                        "assignments": {"line_of_sight": assign,
                                        "objects_line_of_sight": [], "portals": []}},
        "x_build": {"generator": "hexmap 0.7", "terrain": me["terrain"], "infest": infest,
                    "profile": (me["terrain"] if me["terrain"] in PROFILES else "_default")
                               + (f"+{struct['kind']}" if struct else ""),
                    "built": stamp, "image_id": build},
        "x_area": {"id": area, "hex": [col, row], "region": me["region"],
                   "world_origin_ft": [round(ox, 2), round(oy, 2)],
                   "exits": exits, "arrivals": arrivals},
    }
    p = f"{OUT}/{area}_{build}.uvtt"
    json.dump(uvtt, open(p, "w"))
    base.resize((W // 7, H // 7), Image.BILINEAR).save(f"{OUT}/{area}_{build}_preview.png")
    from collections import Counter
    print(f"{area}  {W}x{H}px  {GW}x{GH} sq  {me['terrain']}/{me['region']}")
    print(f"  polygons {len(los)}  segments {sum(len(x)-1 for x in los)}  {dict(Counter(assign))}")
    print(f"  exits {len(exits)}  rivers {len(wme['rivers'])}  png {len(buf.getvalue())//1024} KB")
    print(f"  build {build} @ {stamp}")
    return build


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
