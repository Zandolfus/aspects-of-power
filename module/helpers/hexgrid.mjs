/**
 * Overworld hex lattice — PURE geometry, no Foundry, no world state.
 *
 * The lattice was not invented here; it was measured off the generator's own
 * output and confirmed to 0.005 ft against `hex_16_10_1525d9.uvtt` and
 * `hex_17_9_680475.uvtt`:
 *
 *   flat-top hexes, odd-q offset coordinates, 600 ft centre-to-vertex
 *   hex spans 1200 x 1039.23 ft, drawn on a 1280 x 1120 ft canvas
 *
 * "odd-q" means ODD COLUMNS SIT HALF A ROW LOWER. That parity is the whole
 * game: get it backwards and every prediction is out by exactly half a row
 * pitch (519.62 ft), which is large enough to be obvious in a test and small
 * enough to look plausible in a coordinate dump.
 *
 * ⚠ THE CANVAS IS NOT SYMMETRICALLY PADDED. Bleed is 40.00 ft horizontally but
 * 40.385 ft vertically, because the generator rounds the canvas up to whole
 * grid squares (1039.23 -> 1120, not 1119.23). Deriving the hex centre by
 * assuming equal margins puts it 0.38 ft out on the y axis. Use the canvas
 * CENTRE, which is what the current generator anchors to.
 */

/* Centre to vertex. Everything else is derived from this. */
export const HEX_SIZE_FT = 600;

const SQ3 = Math.sqrt(3);

/** Flat side to flat side, i.e. the distance between adjacent hex centres. */
export const hexApothemFt = (size = HEX_SIZE_FT) => (SQ3 / 2) * size;
/** Bounding box of a single hex. */
export const hexWidthFt = (size = HEX_SIZE_FT) => 2 * size;
export const hexHeightFt = (size = HEX_SIZE_FT) => SQ3 * size;

export const EDGES = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

export const OPPOSITE_EDGE = {
  N: 'S', S: 'N', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW'
};

/**
 * ⚠ The column-changing neighbours DIFFER BY PARITY — that is what odd-q means.
 * From hex (16,10) the NE neighbour is (17,9); from the odd column (17,9) the
 * NE neighbour is (18,9). Both are live generator output, not derivation.
 */
const NEIGHBOUR_DELTA = {
  0: { N: [0, -1], NE: [1, -1], SE: [1, 0], S: [0, 1], SW: [-1, 0], NW: [-1, -1] },
  1: { N: [0, -1], NE: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], NW: [-1, 0] }
};

/* `col & 1` rather than `col % 2`: the remainder operator is signed in JS, so
   -3 % 2 is -1 and would miss the lookup entirely. */
const parity = (col) => col & 1;

/**
 * Unit normals from the hex centre toward each edge's midpoint. The edge line
 * itself sits one apothem away along the normal.
 */
const EDGE_NORMAL = {
  N: [0, -1],
  NE: [SQ3 / 2, -0.5],
  SE: [SQ3 / 2, 0.5],
  S: [0, 1],
  SW: [-SQ3 / 2, 0.5],
  NW: [-SQ3 / 2, -0.5]
};

/* ------------------------------------------------------------------ */
/* Lattice                                                             */
/* ------------------------------------------------------------------ */

/**
 * World-feet centre of hex (col,row).
 *
 * The lattice is anchored so that hex (0,0)'s bounding box has its top-left
 * corner at world (0,0) — hence the `+ size` and `+ 0.5` terms. That is not a
 * convention I chose; it is what makes the generator's stored origins come out
 * exact.
 */
export function hexCentreWorld(col, row, size = HEX_SIZE_FT) {
  return [
    size * 1.5 * col + size,
    SQ3 * size * (row + 0.5 + 0.5 * parity(col))
  ];
}

/** Top-left corner of a hex's bounding box, in world feet. */
export function hexBoundsOriginWorld(col, row, size = HEX_SIZE_FT) {
  const [cx, cy] = hexCentreWorld(col, row, size);
  return [cx - size, cy - hexHeightFt(size) / 2];
}

/**
 * Which hex contains a world point.
 *
 * ⚠ THIS IS THE FUNCTION THAT GOES WRONG QUIETLY. Rounding fractional axial
 * coordinates independently picks the wrong hex in a band along every edge —
 * it never throws, it just names a neighbour. Cube rounding (round all three,
 * then repair whichever moved furthest) is the only version that is correct
 * everywhere, so the round-trip test over the lattice is not optional.
 */
export function hexFromWorldFt(x, y, size = HEX_SIZE_FT) {
  /* back to a lattice whose hex (0,0) is centred on the origin */
  const px = x - size;
  const py = y - (SQ3 * size) / 2;

  const qf = ((2 / 3) * px) / size;
  const rf = ((-1 / 3) * px + (SQ3 / 3) * py) / size;
  const sf = -qf - rf;

  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;

  /* axial -> odd-q offset */
  return [q, r + (q - parity(q)) / 2];
}

export function neighbour(col, row, edge) {
  const d = NEIGHBOUR_DELTA[parity(col)][edge];
  return d ? [col + d[0], row + d[1]] : null;
}

/** Which edge of `from` you cross to reach `to`, or null if not adjacent. */
export function edgeBetween(fromCol, fromRow, toCol, toRow) {
  for (const edge of EDGES) {
    const n = neighbour(fromCol, fromRow, edge);
    if (n[0] === toCol && n[1] === toRow) return edge;
  }
  return null;
}

/* offset -> cube, needed for distance and rings */
function toCube(col, row) {
  const q = col;
  const r = row - (col - parity(col)) / 2;
  return [q, r, -q - r];
}

/** Steps between two hexes, walking edge to edge. */
export function hexDistance(aCol, aRow, bCol, bRow) {
  const a = toCube(aCol, aRow), b = toCube(bCol, bRow);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/**
 * Every hex within `radius` steps, centre first, then ring by ring.
 * Used to draw the local rosette — the overworld has thousands of hexes and
 * the panel only ever shows a handful.
 */
export function hexesWithin(col, row, radius) {
  const out = [];
  for (let dc = -radius * 2; dc <= radius * 2; dc++) {
    for (let dr = -radius * 2; dr <= radius * 2; dr++) {
      const c = col + dc, r = row + dr;
      const d = hexDistance(col, row, c, r);
      if (d <= radius) out.push({ col: c, row: r, distance: d });
    }
  }
  out.sort((a, b) => a.distance - b.distance || a.col - b.col || a.row - b.row);
  return out;
}

/* ------------------------------------------------------------------ */
/* Scene-local <-> world                                               */
/* ------------------------------------------------------------------ */

/**
 * Canvas pixels to world feet.
 *
 * `sceneX`/`sceneY` are the padding origin (`scene.dimensions.sceneX`), which
 * is where the map image actually starts — with padding on, pixel 0 is off the
 * map. `gridSize` is pixels per grid unit and `gridDistance` is feet per grid
 * unit; they are separate numbers and multiplying by the wrong one is a silent
 * scale error.
 */
export function worldFtFromPixels(anchor, px, py) {
  const { worldOriginFt, sceneX = 0, sceneY = 0, gridSize, gridDistance } = anchor;
  if (!Array.isArray(worldOriginFt) || !gridSize || !gridDistance) return null;
  const ftPerPixel = gridDistance / gridSize;
  return [
    worldOriginFt[0] + (px - sceneX) * ftPerPixel,
    worldOriginFt[1] + (py - sceneY) * ftPerPixel
  ];
}

/** Displacement from the containing hex's centre, in world feet. */
export function offsetFromCentre(worldFt, col, row, size = HEX_SIZE_FT) {
  const [cx, cy] = hexCentreWorld(col, row, size);
  return [worldFt[0] - cx, worldFt[1] - cy];
}

/**
 * Which edge you are closest to crossing, and how far the crossing is.
 *
 * Distance is to the edge LINE, measured along the normal — that is the honest
 * "how far to the border" figure. At the exact centre every edge is one
 * apothem away and N wins the tie, which is arbitrary but stable.
 */
export function nearestEdge(dx, dy, size = HEX_SIZE_FT) {
  const apothem = hexApothemFt(size);
  let best = null;
  for (const edge of EDGES) {
    const [nx, ny] = EDGE_NORMAL[edge];
    const along = dx * nx + dy * ny;
    if (!best || along > best.along) best = { edge, along };
  }
  return { edge: best.edge, distanceFt: apothem - best.along };
}

/** Distance from a point to each of the six edge lines, keyed by edge. */
export function edgeDistances(dx, dy, size = HEX_SIZE_FT) {
  const apothem = hexApothemFt(size);
  const out = {};
  for (const edge of EDGES) {
    const [nx, ny] = EDGE_NORMAL[edge];
    out[edge] = apothem - (dx * nx + dy * ny);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Provenance check                                                    */
/* ------------------------------------------------------------------ */

/**
 * Does a scene's stored origin agree with the lattice?
 *
 * ⚠ THIS EXISTS BECAUSE OF A 0.38 ft BUG. The generator once centred the hex
 * on an unrounded canvas; the fixed version centres it on the rounded one. The
 * difference is invisible on the map, produces no error, and quietly puts one
 * hex's world anchor out of step with its neighbours. Maps built before the
 * fix carry no `x_build` block, so absence of provenance is itself the signal.
 *
 * Returns drift in feet. Anything above a few thousandths is a stale build.
 */
export function verifyStampOrigin(stamp, canvasFt, size = HEX_SIZE_FT) {
  if (!stamp?.hex || !stamp?.worldOriginFt || !canvasFt) return null;
  const [col, row] = stamp.hex;
  const [cx, cy] = hexCentreWorld(col, row, size);
  const predicted = [cx - canvasFt[0] / 2, cy - canvasFt[1] / 2];
  const drift = [
    Math.abs(predicted[0] - stamp.worldOriginFt[0]),
    Math.abs(predicted[1] - stamp.worldOriginFt[1])
  ];
  return {
    predicted,
    stored: [...stamp.worldOriginFt],
    drift,
    driftFt: Math.hypot(drift[0], drift[1]),
    ok: Math.hypot(drift[0], drift[1]) < 0.01
  };
}
