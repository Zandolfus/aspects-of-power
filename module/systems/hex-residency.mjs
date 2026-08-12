/**
 * Hex scene residency — keeping 150 MB of overworld out of every client.
 *
 * The 307 hex maps live canonically in the `world.hexes` compendium; the
 * world database holds only the hexes the party has visited, and clients are
 * only ever shipped what is in the world. This module is the machinery that
 * crosses the boundary:
 *
 *  - `ensureHexResident()` imports a hex from the pack with ids preserved,
 *    so the 1,262 core `teleportToken` destination UUIDs resolve the moment
 *    the scene lands (live-verified 2026-08-12: keepId keeps EMBEDDED Region
 *    ids, in both directions — see migration/local/phase0_*.js);
 *  - neighbour prefetch imports the ring around wherever the party is, so an
 *    ordinary edge-crossing never waits on an import;
 *  - the travel backstop catches the case prefetch missed: the move is
 *    cancelled, the destination imported (via the acting GM — players cannot
 *    create scenes), and the move re-issued, the same cancel-then-reissue
 *    shape the combat exit gate uses.
 *
 * ⚠⚠ IMPORTING OVER AN ALREADY-RESIDENT SCENE SILENTLY REPLACES IT. v14's
 * `importDocument` defaults to "replace" with no dialog when the id already
 * exists in the world — one careless re-import reverts a hex to its pristine
 * pack copy and destroys GM prep with no prompt and no trace. Every import
 * path in this file checks residency FIRST, and the in-flight map keeps two
 * concurrent requests for the same hex from racing past that check.
 *
 * GROW-ONLY BY DESIGN: nothing here evicts. A visited hex stays in the world
 * precisely so prep done on it cannot vanish.
 */

import { isActingGM } from '../helpers/gm.mjs';
import { EDGES, neighbour, sceneIdFromRegionUuid } from '../helpers/hexgrid.mjs';
import {
  HEX_PACK, areaStampFor, availableHexes, exitRegionAt, hexKey,
} from './overworld.mjs';

const SYS = 'aspects-of-power';

/** Is this scene in the world right now? (Pack copies do not count.) */
export function isHexResident(sceneId) {
  return !!game.scenes.get(sceneId);
}

/* One import per scene at a time. Two rapid calls both passing the residency
   check would make the second a silent REPLACE of the first — the exact
   hazard this module exists to avoid. */
const inFlight = new Map();

/**
 * Make a hex scene resident, GM-side. Returns one of:
 * 'resident' | 'imported' | 'not-gm' | 'no-pack' | 'unknown' | 'failed'.
 * Any GM client may run this (click-driven paths act locally); the SOCKET
 * route is what gets funnelled to the acting GM, by the dispatcher.
 */
export function ensureHexResident(sceneId) {
  const running = inFlight.get(sceneId);
  if (running) return running;
  const p = _ensureHexResident(sceneId).finally(() => inFlight.delete(sceneId));
  inFlight.set(sceneId, p);
  return p;
}

async function _ensureHexResident(sceneId) {
  if (!game.user.isGM) return 'not-gm';
  /* Residency check BEFORE the import, always — see the header. */
  if (game.scenes.get(sceneId)) return 'resident';
  const pack = game.packs.get(HEX_PACK);
  if (!pack) return 'no-pack';
  const index = pack.index?.size ? pack.index : await pack.getIndex();
  if (!index.get(sceneId)) return 'unknown';
  await game.scenes.importFromCompendium(pack, sceneId, {}, { keepId: true });
  return game.scenes.get(sceneId) ? 'imported' : 'failed';
}

/**
 * Player-side: ask the acting GM to import a hex, and resolve true once the
 * scene-create broadcast lands (that broadcast IS the reply — the scene
 * appearing in `game.scenes` is the thing being waited for). Resolves false
 * on timeout, which is also the no-GM-connected case: without a GM online
 * nothing can import, and travel into unvisited ground has to wait.
 */
export function requestHexResident(sceneId, { timeoutMs } = {}) {
  if (game.scenes.get(sceneId)) return Promise.resolve(true);
  const cfg = CONFIG.ASPECTSOFPOWER?.overworld?.residency ?? {};
  const wait = timeoutMs ?? cfg.requestTimeoutMs ?? 15000;
  return new Promise((resolve) => {
    let timer;
    const hookId = Hooks.on('createScene', (scene) => {
      if (scene.id !== sceneId) return;
      Hooks.off('createScene', hookId);
      clearTimeout(timer);
      resolve(true);
    });
    timer = setTimeout(() => {
      Hooks.off('createScene', hookId);
      resolve(!!game.scenes.get(sceneId));
    }, wait);
    game.socket.emit(`system.${SYS}`, { type: 'gmEnsureHexResident', sceneId });
  });
}

/**
 * Import the ring around a hex the party is on, so edge-crossings find their
 * destination already resident. Acting-GM only: this mutates the world from
 * a hook every client runs. The party-presence rule mirrors syncExploration —
 * a GM scouting alone neither reveals hexes nor grows the world.
 */
export async function ensureNeighboursResident(scene) {
  const cfg = CONFIG.ASPECTSOFPOWER?.overworld?.residency ?? {};
  if (cfg.neighbourPrefetch === false) return 0;
  if (!isActingGM()) return 0;
  const stamp = areaStampFor(scene);
  if (!stamp?.hex) return 0;
  if (!(scene.tokens ?? []).some(t => t.actor?.hasPlayerOwner)) return 0;

  const avail = availableHexes();
  let imported = 0;
  for (const edge of EDGES) {
    const n = neighbour(stamp.hex[0], stamp.hex[1], edge);
    if (!n) continue;
    const entry = avail.get(hexKey(n[0], n[1]));
    if (!entry || entry.resident) continue;
    if ((await ensureHexResident(entry.sceneId)) === 'imported') imported++;
  }
  return imported;
}

/**
 * The travel backstop. Core's `teleportToken` behaviour does NOTHING when its
 * destination UUID fails to resolve — no error, the token just stops at the
 * edge — so a move into an exit region whose destination scene is not
 * resident must be caught HERE, before the update. Cancel, import, re-issue
 * with the bypass flag. Runs on the client issuing the move, like the combat
 * gate above it in the hook order; on re-issue the combat gate still gets its
 * say, because the flags are independent.
 */
export function onPreUpdateTokenForResidency(tokenDoc, changes, options) {
  if (!('x' in changes) && !('y' in changes)) return;
  if (options?.aopResidencyChecked) return;
  const scene = tokenDoc.parent;
  if (!areaStampFor(scene)) return;

  const gs = scene.grid?.size ?? 100;
  const x = (changes.x ?? tokenDoc.x) + ((tokenDoc.width ?? 1) * gs) / 2;
  const y = (changes.y ?? tokenDoc.y) + ((tokenDoc.height ?? 1) * gs) / 2;
  const region = exitRegionAt(scene, x, y, tokenDoc.elevation ?? 0);
  if (!region) return;

  /* v14 stores `destinations` (a set — hex exits carry exactly one, but the
     schema allows more). The singular `destination` is a deprecation shim
     that dies in v16 — do not read it. */
  const sys = [...region.behaviors]
    .find(b => b.type === 'teleportToken' && !b.disabled)?.system;
  const missing = [...(sys?.destinations ?? [])]
    .map(sceneIdFromRegionUuid)
    .filter(id => id && !game.scenes.get(id));
  /* No teleport on this exit, or every destination is already resident: core
     owns the rest of the journey. */
  if (!missing.length) return;

  repairAndReissue(tokenDoc, changes, missing);
  return false;
}

async function repairAndReissue(tokenDoc, changes, missingSceneIds) {
  ui.notifications.info('Preparing the next area…');
  let ok = true;
  for (const destSceneId of missingSceneIds) {
    ok = (game.user.isGM
      ? ['resident', 'imported'].includes(await ensureHexResident(destSceneId))
      : await requestHexResident(destSceneId)) && ok;
  }
  if (!ok) {
    ui.notifications.warn(game.users.activeGM
      ? 'The next area could not be loaded.'
      : 'No GM is connected — the next area cannot be loaded.');
    return;
  }
  await tokenDoc.update(
    { x: changes.x ?? tokenDoc.x, y: changes.y ?? tokenDoc.y },
    { aopResidencyChecked: true },
  );
}

export function registerHexResidencyHooks() {
  Hooks.on('preUpdateToken', onPreUpdateTokenForResidency);
  /* Same triggers as exploration sync: arriving on a hex — by activation or
     by a token landing there — pulls the ring around it. */
  Hooks.on('canvasReady', () => { ensureNeighboursResident(canvas?.scene); });
  Hooks.on('createToken', (doc) => { ensureNeighboursResident(doc?.parent); });
}
