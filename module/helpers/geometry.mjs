/**
 * Geometric overlap between AOE region shapes and token footprints.
 *
 * Computes the fraction of a token's axis-aligned rectangular footprint
 * that lies inside an AOE region's shape, in [0, 1].
 *
 * Approach: convert the region's shape (circle / rectangle / cone / line)
 * to a convex polygon, clip the token's 4-vertex rectangle against it
 * with Sutherland-Hodgman, then shoelace the resulting polygon's area
 * and divide by the token's footprint area.
 *
 * Per design 2026-05-12: each AOE target takes `damage × fraction`, so
 * a token half-inside the explosion takes half damage. The fraction
 * also gates inclusion (floor 0.05) so a faint brush doesn't trigger
 * damage at all.
 *
 * Cost: ~100–200 ops per (token, region) pair. Sub-millisecond for
 * any realistic combat. Exact for rectangles & polygons; <0.5% error
 * for circles (32-vertex approximation) and wide cones (12-vertex arc).
 */

const CIRCLE_VERTICES = 32;
const CONE_ARC_VERTICES = 12;

/**
 * Fraction (0..1) of a token's footprint inside a region shape.
 *
 * @param {RegionDocument} regionDoc
 * @param {TokenDocument} tokenDoc
 * @returns {number}
 */
export function regionTokenOverlap(regionDoc, tokenDoc) {
  if (!regionDoc || !tokenDoc) return 0;
  const gridSize = canvas.grid.size;
  const w = (tokenDoc.width ?? 1) * gridSize;
  const h = (tokenDoc.height ?? 1) * gridSize;
  const tokenPoly = [
    { x: tokenDoc.x,     y: tokenDoc.y },
    { x: tokenDoc.x + w, y: tokenDoc.y },
    { x: tokenDoc.x + w, y: tokenDoc.y + h },
    { x: tokenDoc.x,     y: tokenDoc.y + h },
  ];
  const tokenArea = w * h;
  if (tokenArea <= 0) return 0;

  // A region may have multiple shapes (union); accumulate clipped area.
  let totalClipped = 0;
  for (const shape of regionDoc.shapes ?? []) {
    const clipperPoly = shapeToPolygon(shape);
    if (!clipperPoly || clipperPoly.length < 3) continue;
    const clipped = sutherlandHodgman(tokenPoly, clipperPoly);
    if (clipped.length < 3) continue;
    totalClipped += Math.abs(polygonArea(clipped));
  }
  return Math.max(0, Math.min(1, totalClipped / tokenArea));
}

/* -------------------------------------------- */
/*  Shape → polygon                              */
/* -------------------------------------------- */

function shapeToPolygon(shape) {
  switch (shape?.type) {
    case 'circle':    return circleToPolygon(shape.x, shape.y, shape.radius, CIRCLE_VERTICES);
    case 'rectangle':
    case 'rect':      return rectToPolygon(shape.x, shape.y, shape.width, shape.height, shape.rotation ?? 0);
    case 'cone':      return coneToPolygon(shape.x, shape.y, shape.radius, shape.angle, shape.rotation ?? 0, CONE_ARC_VERTICES);
    case 'line':
    case 'ray':       return lineToPolygon(shape.x, shape.y, shape.length, shape.width, shape.rotation ?? 0);
    default:          return null;
  }
}

function circleToPolygon(cx, cy, radius, n) {
  const poly = [];
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * 2 * Math.PI;
    poly.push({ x: cx + Math.cos(theta) * radius, y: cy + Math.sin(theta) * radius });
  }
  return poly;
}

function rectToPolygon(x, y, w, h, rotationDeg) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (!rotationDeg) {
    return [
      { x,         y },
      { x: x + w,  y },
      { x: x + w,  y: y + h },
      { x,         y: y + h },
    ];
  }
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localCorners = [
    { x: -w / 2, y: -h / 2 },
    { x:  w / 2, y: -h / 2 },
    { x:  w / 2, y:  h / 2 },
    { x: -w / 2, y:  h / 2 },
  ];
  return localCorners.map(p => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}

/**
 * Cone (circular sector): apex at (cx,cy), expanding `radius` outward
 * along `rotation` direction with half-angle `angle/2` on each side.
 * Polygon = apex + arc points sampled across the angle.
 */
function coneToPolygon(cx, cy, radius, angleDeg, rotationDeg, arcN) {
  const halfRad = (angleDeg / 2) * Math.PI / 180;
  const rotRad  = rotationDeg * Math.PI / 180;
  const poly = [{ x: cx, y: cy }];
  // Number of arc segments = arcN; sample arcN+1 endpoints inclusive.
  for (let i = 0; i <= arcN; i++) {
    const t = -halfRad + (i / arcN) * (2 * halfRad);
    const theta = rotRad + t;
    poly.push({ x: cx + Math.cos(theta) * radius, y: cy + Math.sin(theta) * radius });
  }
  return poly;
}

/**
 * Line / ray: a rotated rectangle of `length × width`, anchored at
 * (cx,cy) and extending forward along `rotation`. Anchor is the start
 * of the line (the apex of a ray), not the center.
 */
function lineToPolygon(cx, cy, length, width, rotationDeg) {
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = width / 2;
  const localCorners = [
    { x: 0,      y: -halfW },
    { x: length, y: -halfW },
    { x: length, y:  halfW },
    { x: 0,      y:  halfW },
  ];
  return localCorners.map(p => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}

/* -------------------------------------------- */
/*  Sutherland-Hodgman clip                      */
/* -------------------------------------------- */

/**
 * Clip `subject` polygon against the convex `clipper` polygon
 * (counter-clockwise winding assumed). Returns the intersection
 * polygon, possibly empty if no overlap.
 */
function sutherlandHodgman(subject, clipper) {
  let output = subject.slice();
  for (let i = 0; i < clipper.length; i++) {
    if (output.length === 0) break;
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pIn = isInside(a, b, p);
      const qIn = isInside(a, b, q);
      if (pIn) {
        output.push(p);
        if (!qIn) output.push(lineIntersect(a, b, p, q));
      } else if (qIn) {
        output.push(lineIntersect(a, b, p, q));
        output.push(q);
      }
    }
  }
  return output;
}

// "Left of" predicate for a directed line a→b. CCW winding means inside.
function isInside(a, b, p) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
}

function lineIntersect(a, b, p, q) {
  // Intersection of segment p-q with line a-b (extended). a-b is the
  // clip edge; the input edge p-q crosses it.
  const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
  const x3 = p.x, y3 = p.y, x4 = q.x, y4 = q.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return { x: p.x, y: p.y }; // parallel; pick a sensible fallback
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/* -------------------------------------------- */
/*  Shoelace area                                */
/* -------------------------------------------- */

function polygonArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}
