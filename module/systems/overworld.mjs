/**
 * Overworld state: where the party is, and what they know of the map.
 *
 * The geometry lives in helpers/hexgrid.mjs and is pure. This file is the part
 * that touches Foundry — reading the scene stamp, deciding when a hex counts as
 * explored, and answering "where am I" for the panel.
 *
 * ⚠ THREE FACTS, THREE OWNERS. They are not one tri-state:
 *
 *   AVAILABILITY  module-side. Derived, never stored: which hexes have an
 *                 imported scene. GM-only.
 *   EXPLORATION   party-side. Stored. The party has stood there.
 *   KNOWN OF      party-side. Stored. They know where it is without having
 *                 been. Nashkel is on your map before you walk to it.
 *
 * Merging availability into exploration is tempting and wrong. Roughly a
 * hundred hexes are built out of 8145 land hexes, so "not built" is the default
 * condition of the world. Rendered as unexplored it would tell players that
 * 98.8% of the continent is undiscovered country, when it is merely unwritten —
 * and the illusion would break visibly the moment a map got generated.
 *
 * ⚠ THE FLAG COMES FROM A MODULE. UVTT+ writes `flags['uvtt-plus'].area` at
 * import. Read it defensively: the data lives in the world database, so scenes
 * keep working on clients without the module, but a scene imported by anything
 * else has no stamp at all and must degrade to "unknown location", never to a
 * plausible-looking default.
 */

import { isActingGM } from '../helpers/gm.mjs';
import {
  hexCentreWorld, hexFromWorldFt, neighbour, nearestEdge, offsetFromCentre,
  worldFtFromPixels, verifyStampOrigin, hexesWithin, hexDistance, EDGES,
} from '../helpers/hexgrid.mjs';

const UVTT_SCOPE = 'uvtt-plus';
const SYS = 'aspects-of-power';

export const SETTING_EXPLORED = 'overworldExplored';
export const SETTING_KNOWN = 'overworldKnown';

export const hexKey = (col, row) => `${col},${row}`;
export const parseHexKey = (k) => {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(k ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/* ------------------------------------------------------------------ */
/* Scene reading                                                       */
/* ------------------------------------------------------------------ */

/**
 * The area stamp on a scene, or null.
 *
 * ⚠ Read the flag off the object, do not use `getFlag`. The house rule exists
 * because the system scope is `aspects-of-power` while the namespace on the
 * document is `aspectsofpower`; here the scope is a third string again, and a
 * wrong one THROWS rather than returning undefined.
 */
export function areaStampFor(scene) {
  const a = scene?.flags?.[UVTT_SCOPE]?.area;
  return a?.id ? a : null;
}

export function buildStampFor(scene) {
  return scene?.flags?.[UVTT_SCOPE]?.build ?? null;
}

/** Scene canvas size in world feet, from its own grid settings. */
export function sceneCanvasFt(scene) {
  const size = scene?.grid?.size, dist = scene?.grid?.distance;
  if (!size || !dist) return null;
  return [(scene.width / size) * dist, (scene.height / size) * dist];
}

/**
 * Everything worldFtFromPixels needs, assembled from a live scene.
 * Returns null when the scene is not on the lattice, which is a real and
 * expected state — off-lattice maps import fine and simply have no location.
 */
export function anchorFor(scene) {
  const stamp = areaStampFor(scene);
  if (!stamp?.worldOriginFt) return null;
  const d = scene.dimensions ?? {};
  return {
    worldOriginFt: stamp.worldOriginFt,
    sceneX: d.sceneX ?? 0,
    sceneY: d.sceneY ?? 0,
    gridSize: scene.grid?.size,
    gridDistance: scene.grid?.distance,
  };
}

/**
 * Where a point on a scene sits in the world.
 *
 * `nearest` is the edge you are closest to crossing and how far that crossing
 * is, which is the figure that actually matters at this scale: a hex is 1200 ft
 * across, so position inside it decides which of six neighbours you reach.
 */
export function locate(scene, px, py) {
  const stamp = areaStampFor(scene);
  if (!stamp) return null;
  const anchor = anchorFor(scene);
  if (!anchor) return { stamp, offLattice: true };

  const worldFt = worldFtFromPixels(anchor, px, py);
  if (!worldFt) return { stamp, offLattice: true };

  /* Trust the stamp's own hex over the derived one: a token dragged into the
     bleed margin is geometrically in the neighbour but is still on this map. */
  const [col, row] = stamp.hex ?? hexFromWorldFt(worldFt[0], worldFt[1]);
  const derived = hexFromWorldFt(worldFt[0], worldFt[1]);
  const off = offsetFromCentre(worldFt, col, row);
  const near = nearestEdge(off[0], off[1]);
  const toward = neighbour(col, row, near.edge);

  return {
    stamp,
    offLattice: false,
    hex: [col, row],
    region: stamp.region,
    worldFt,
    offset: off,
    nearest: near,
    toward,
    /* True in the 40 ft bleed, where the map continues past the hex border. */
    outsideOwnHex: derived[0] !== col || derived[1] !== row,
    /* The area id the exit list says that edge leads to, which is authoritative
       over the derived neighbour if the generator ever disagrees. */
    towardId: (stamp.exits ?? []).find(e => e.edge === near.edge)?.to ?? null,
  };
}

/** Locate a token by its centre rather than its top-left corner. */
export function locateToken(token) {
  const doc = token?.document ?? token;
  const scene = doc?.parent;
  if (!scene) return null;
  const gs = scene.grid?.size ?? 0;
  return locate(scene, doc.x + (doc.width ?? 1) * gs / 2, doc.y + (doc.height ?? 1) * gs / 2);
}

/* ------------------------------------------------------------------ */
/* Availability — derived, never stored                                */
/* ------------------------------------------------------------------ */

/**
 * Every hex that has an imported scene, keyed "col,row".
 *
 * Also reports build drift, because a scene imported from a pre-fix map sits
 * 0.38 ft off its neighbours and nothing else will ever tell you. That is too
 * small to see and too small to break anything visibly — which is exactly why
 * it needs a place to surface.
 */
export function availableHexes() {
  const out = new Map();
  for (const scene of game.scenes ?? []) {
    const stamp = areaStampFor(scene);
    if (!stamp?.hex) continue;
    const canvasFt = sceneCanvasFt(scene);
    const check = canvasFt ? verifyStampOrigin(stamp, canvasFt) : null;
    out.set(hexKey(stamp.hex[0], stamp.hex[1]), {
      sceneId: scene.id,
      sceneName: scene.name,
      areaId: stamp.id,
      region: stamp.region,
      build: buildStampFor(scene),
      offLattice: !stamp.worldOriginFt,
      driftFt: check?.driftFt ?? null,
      stale: check ? !check.ok : null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Exploration + knowledge — party-side, stored                        */
/* ------------------------------------------------------------------ */

function readSet(key) {
  try { return new Set(game.settings.get(SYS, key) ?? []); }
  catch (e) { return new Set(); }
}

export const exploredHexes = () => readSet(SETTING_EXPLORED);
export const knownHexes = () => readSet(SETTING_KNOWN);

/**
 * Record hexes as explored or known. GM-only, and gated on `isActingGM()`
 * because this MUTATES world state — plain `isGM` would have every connected
 * GM client write the same setting.
 */
export async function markHexes(keys, { known = false } = {}) {
  if (!isActingGM()) return false;
  const setting = known ? SETTING_KNOWN : SETTING_EXPLORED;
  const set = readSet(setting);
  let added = 0;
  for (const k of keys) if (k && !set.has(k)) { set.add(k); added++; }
  if (!added) return false;
  await game.settings.set(SYS, setting, [...set].sort());
  return true;
}

/**
 * Walking into a hex reveals that it exists and where its neighbours are —
 * you can see the next valley from the ridge. Explored is the strong claim;
 * the six neighbours become merely KNOWN.
 *
 * ⚠ A HEX PROMOTED TO EXPLORED MUST LEAVE THE KNOWN SET. The first version
 * only ever added, so a hex you had heard of and then walked into stayed in
 * both. Nothing looked wrong — `rosette()` treats explored as implying known,
 * so the map rendered correctly — but it quietly redefined `known` as "known
 * OR visited", and the next reader asking "where have they heard of but not
 * been?" would get every visited hex back. Caught by asserting the two sets
 * are disjoint, not by looking at the map.
 *
 * Both sets are resolved in one pass so a visit is a single transaction
 * rather than two writes that can disagree in between.
 */
export async function markVisited(col, row) {
  if (!isActingGM()) return false;
  const key = hexKey(col, row);
  const explored = exploredHexes();
  const known = knownHexes();
  const snapshot = (s) => [...s].sort().join('|');
  const before = [snapshot(explored), snapshot(known)];

  explored.add(key);
  known.delete(key);
  for (const edge of EDGES) {
    const n = neighbour(col, row, edge);
    if (!n) continue;
    const k = hexKey(n[0], n[1]);
    if (!explored.has(k)) known.add(k);
  }

  let changed = false;
  if (snapshot(explored) !== before[0]) {
    await game.settings.set(SYS, SETTING_EXPLORED, [...explored].sort());
    changed = true;
  }
  if (snapshot(known) !== before[1]) {
    await game.settings.set(SYS, SETTING_KNOWN, [...known].sort());
    changed = true;
  }
  return changed;
}

/**
 * DECISION: a hex is explored when a player-owned token is present on its
 * scene. That fires on scene activation and on a token being dropped in, so a
 * GM who scouts a map alone does not reveal it, and a party teleported in
 * without walking an edge still registers.
 */
export async function syncExploration(scene) {
  if (!isActingGM()) return false;
  const stamp = areaStampFor(scene);
  if (!stamp?.hex) return false;
  const hasParty = (scene.tokens ?? []).some(t => t.actor?.hasPlayerOwner);
  if (!hasParty) return false;
  return markVisited(stamp.hex[0], stamp.hex[1]);
}

/* ------------------------------------------------------------------ */
/* The rosette                                                         */
/* ------------------------------------------------------------------ */

/**
 * The local neighbourhood, with all three facts kept separate.
 *
 * `radius` stays small on purpose. The overworld is thousands of hexes; the
 * panel shows the ring or two you could walk to, and a whole-continent render
 * is a different artifact with different needs.
 */
export function rosette(col, row, radius = 1, { gm = false } = {}) {
  const avail = availableHexes();
  const explored = exploredHexes();
  const known = knownHexes();

  return hexesWithin(col, row, radius).map(({ col: c, row: r, distance }) => {
    const key = hexKey(c, r);
    const a = avail.get(key) ?? null;
    const isExplored = explored.has(key);
    const isKnown = isExplored || known.has(key);
    const [wx, wy] = hexCentreWorld(c, r);
    return {
      col: c, row: r, key, distance,
      isCurrent: c === col && r === row,
      explored: isExplored,
      known: isKnown,
      /* Availability is GM-only. Handing it to players would leak which parts
         of the world have been authored. */
      available: gm ? !!a : null,
      stale: gm ? (a?.stale ?? null) : null,
      driftFt: gm ? (a?.driftFt ?? null) : null,
      sceneId: gm || isExplored ? (a?.sceneId ?? null) : null,
      /* A player sees a region name only where they have been or been told. */
      label: isKnown ? (a?.region ?? null) : null,
      areaId: gm ? (a?.areaId ?? null) : null,
      centreWorldFt: [wx, wy],
    };
  });
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function registerOverworldSettings() {
  const reg = (key, name) => game.settings.register(SYS, key, {
    name, scope: 'world', config: false, type: Array, default: [],
  });
  reg(SETTING_EXPLORED, 'Overworld hexes the party has explored');
  reg(SETTING_KNOWN, 'Overworld hexes the party knows of');
}

export function registerOverworldHooks() {
  Hooks.on('canvasReady', () => { syncExploration(canvas?.scene); });
  Hooks.on('createToken', (doc) => { syncExploration(doc?.parent); });
}
