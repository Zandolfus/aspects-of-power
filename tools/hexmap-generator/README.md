# Aspects of Power — hex map generator

Generates one Foundry-ready UVTT battlemap per overworld hex. **This source is the
only artifact that cannot be re-derived from anything else — keep it in the repo.**

## Files

| file | role |
|---|---|
| `world.py` | hex lattice geometry, elevation, drainage, edge crossings |
| `hexmap.py` | the renderer: one hex, one 8192x7168 map |
| `gen.py` | resumable batch runner |
| `verify.py` | regenerates a known hex and compares to the original |

Data lives one level up: `hexes.json` (10,000 classified hexes), `world_field.json`
(elevation/rivers), `overrides.json` (fungal infestation).

## Geometry

600 ft hex side, 1200 x 1039 ft across, 40 ft bleed, 8192 x 7168 px at 32 px per
5 ft, gridless. One hex = one map = 21.5 acres.

## The invariant everything rests on

Nothing that crosses a hex edge may be decided by a per-map seed. Ground noise,
tree and undergrowth placement, and river reaches all derive from **absolute world
coordinates**, so two maps covering the same ground generate identical content there.

Two bugs this has already produced, both fixed and commented in place:
- `edge_midpoint_ft` must derive the perpendicular axis from the **sorted** hex
  pair, not from self->neighbour. Hashing the sorted pair alone is not enough.
- A river reach is centre -> crossing -> neighbour centre, drawn in full by **both**
  hexes. Drawing only own-centre -> crossing kinks the channel at the seam.

## Verifying a change

The generator is deterministic, so any existing map is a test:

    python3 verify.py 14,1 34,8 39,8 17,9

Regenerates each hex and compares image hash, wall geometry, assignments, area
block and environment against what is on disk. `ALL MATCH` means byte-identical.

Run this after **any** edit to `hexmap.py`. A change that alters output without a
generator version bump silently desynchronises new maps from old ones.

## Adding a terrain profile

`PROFILES` in `hexmap.py` is keyed by `hexes.json` terrain. **A terrain with no
entry silently falls back to open forest** — it does not fail. Check coverage
before generating a new region:

    python3 -c "import hexmap,json;from collections import Counter; \
      T={(h['col'],h['row']):h for h in json.load(open('../hexes.json'))['hexes']}; \
      print({t:(t in hexmap.PROFILES) for t in Counter(h['terrain'] for h in T.values())})"

## Batch generation

    python3 gen.py 34 8 34 7                       # explicit
    python3 gen.py --region "The Ancient Forest" --limit 6
    python3 gen.py --stale                         # regenerate where infestation
                                                   # or generator version drifted

Idempotent: completed hexes are skipped, so a dropped batch is fixed by re-running.
~25-45 s per map on one core.

## Gotchas paid for in blood

- `Image.alpha_composite` returns a **new** image. Rebind `ImageDraw` after it or
  you paint into a discarded canvas — this produced 22 invisible walls per map.
- Filenames carry `blake2b` of the embedded image. Any post-processing that
  touches image bytes must update hash, filename, preview and index together.
- Never build a delete pattern from a value read out of a file: `"?"` is a glob
  wildcard, and `hex_16_10_?*` matched the file that had just been written.
