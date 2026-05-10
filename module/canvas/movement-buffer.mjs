/**
 * Movement buffer — accumulates WASD keypress-driven token moves into a
 * single staged movement that the player commits with Enter (or cancels
 * with Escape). Drag-to-move is unaffected; only keypress moves go through
 * the buffer.
 *
 * Per design 2026-05-10: arrow keys (WASD) shouldn't fire one celerity
 * declaration per keystroke. Player walks 8 squares with WASD → one Move
 * 40ft declaration, not eight Move 5ft declarations.
 *
 * Wired by aspects-of-power.mjs:
 *   - Higher-precedence keybindings on WASD (and diagonals) intercept the
 *     core keypress, route to extendBuffer, consume the event so Foundry
 *     doesn't move the token directly.
 *   - Enter binding → commitBuffer for all controlled combatants.
 *   - Escape binding → cancelBuffer.
 *   - Out of combat OR controlled token isn't a combatant → handler
 *     returns false, default movement fires unchanged.
 */

import { declareMovement, MOVEMENT_ITEM_ID } from '../systems/celerity.mjs';

const FLAG_NS = 'aspectsofpower';

/**
 * Buffer state per combatant.
 * combatantId → { tokenId, startPos:{x,y}, destPos:{x,y}, totalDistFt, staminaCost }
 *
 * Transient (not persisted to disk). Lives in-memory on the GM's client
 * (or whoever's pressing the keys). Buffer state is per-client; when the
 * buffer commits, it goes through declareMovement which writes the
 * combatant flag — synchronized to all clients from there.
 */
const _buffers = new Map();

/**
 * Public accessor — used by the overlay to render buffered destinations
 * with a distinct style.
 */
export function getBuffer(combatantId) {
  return _buffers.get(combatantId) ?? null;
}

export function getAllBuffers() {
  return [..._buffers.entries()].map(([id, buf]) => ({ combatantId: id, ...buf }));
}

/**
 * Extend (or initialize) the buffer for a combatant by one grid step in
 * (dxSteps, dySteps). Steps are integer grid squares (typically -1, 0, +1).
 *
 * Snapshots startPos from the token's current position on first extend.
 *
 * Returns true if the buffer was extended (handler should consume the key
 * event). Returns false if no buffering occurred (no combat, not a
 * combatant, etc.) — handler should NOT consume so the default fires.
 */
export function extendBuffer(combatant, dxSteps, dySteps) {
  if (!combatant) return false;
  const tok = combatant.token;
  if (!tok) return false;

  const gridSize = canvas.grid.size;
  const ftPerSquare = canvas.grid.distance;

  let buf = _buffers.get(combatant.id);
  if (!buf) {
    buf = {
      tokenId: tok.id,
      startPos: { x: tok.x, y: tok.y },
      destPos: { x: tok.x, y: tok.y },
      totalDistFt: 0,
      staminaCost: 0,
    };
    _buffers.set(combatant.id, buf);
  }

  // Step the destination by one grid square in the indicated direction.
  buf.destPos = {
    x: buf.destPos.x + dxSteps * gridSize,
    y: buf.destPos.y + dySteps * gridSize,
  };
  // Recompute distance + cost from start to current dest.
  const dxPx = buf.destPos.x - buf.startPos.x;
  const dyPx = buf.destPos.y - buf.startPos.y;
  const distPx = Math.hypot(dxPx, dyPx);
  buf.totalDistFt = Math.round(distPx / gridSize * ftPerSquare);
  // 1 stamina per 5ft (Foundry default; refine when encumbrance ships).
  buf.staminaCost = Math.round(buf.totalDistFt / 5);

  Hooks.callAll('aopMovementBufferChanged', combatant.id);
  return true;
}

/**
 * Commit the buffer for a combatant — calls declareMovement with the
 * accumulated destination. Clears the buffer. No-op if buffer is empty
 * or stamina insufficient.
 */
export async function commitBuffer(combatant) {
  if (!combatant) return false;
  const buf = _buffers.get(combatant.id);
  if (!buf || buf.totalDistFt <= 0) return false;

  const actor = combatant.actor;
  if (!actor) return false;

  // Refuse if actor already has a non-buffered declared action queued.
  const existing = combatant.flags?.[FLAG_NS]?.declaredAction;
  if (existing && existing.itemId && existing.itemId !== MOVEMENT_ITEM_ID) {
    ui.notifications.warn(`${actor.name} already has "${existing.label}" queued. Cancel it first.`);
    cancelBuffer(combatant);
    return false;
  }

  // Stamina check.
  if (buf.staminaCost > actor.system.stamina.value) {
    ui.notifications.warn(`${actor.name}: insufficient stamina (${actor.system.stamina.value}/${buf.staminaCost} needed).`);
    return false;
  }

  await declareMovement(actor, buf.startPos, buf.destPos, buf.totalDistFt, buf.staminaCost);
  _buffers.delete(combatant.id);
  Hooks.callAll('aopMovementBufferChanged', combatant.id);
  return true;
}

/**
 * Cancel the buffer for a combatant — discards the buffered destination.
 * Token sprite stays where it is.
 */
export function cancelBuffer(combatant) {
  if (!combatant) return false;
  const id = combatant.id;
  if (!_buffers.has(id)) return false;
  _buffers.delete(id);
  Hooks.callAll('aopMovementBufferChanged', id);
  return true;
}

/** Clear all buffers (e.g., on combat end, scene change). */
export function clearAllBuffers() {
  if (_buffers.size === 0) return;
  const ids = [..._buffers.keys()];
  _buffers.clear();
  for (const id of ids) Hooks.callAll('aopMovementBufferChanged', id);
}

/* ------------------------------------------------------------------ */
/*  Keybinding handlers                                                */
/* ------------------------------------------------------------------ */

/**
 * Pick up controlled tokens that are combatants in the active combat.
 * Returns array of combatants. Empty array → no buffering applies; caller
 * should NOT consume the event.
 */
function _getActiveCombatants() {
  const combat = game.combat;
  if (!combat?.started) return [];
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length === 0) return [];
  const out = [];
  for (const tok of controlled) {
    const cm = combat.combatants.find(c => c.tokenId === tok.id && c.sceneId === tok.document.parent?.id);
    if (cm) out.push(cm);
  }
  return out;
}

/**
 * Generic move-key handler. Called from keybinding `onDown`.
 * Returns true to consume (event won't propagate to core movement).
 */
export function onMoveKey(dxSteps, dySteps) {
  const combatants = _getActiveCombatants();
  if (combatants.length === 0) return false;
  let consumed = false;
  for (const cm of combatants) {
    if (extendBuffer(cm, dxSteps, dySteps)) consumed = true;
  }
  return consumed;
}

export async function onCommitKey() {
  const combatants = _getActiveCombatants();
  if (combatants.length === 0) return false;
  let any = false;
  for (const cm of combatants) {
    if (await commitBuffer(cm)) any = true;
  }
  return any;
}

export function onCancelKey() {
  const combatants = _getActiveCombatants();
  if (combatants.length === 0) return false;
  let any = false;
  for (const cm of combatants) {
    if (cancelBuffer(cm)) any = true;
  }
  return any;
}
