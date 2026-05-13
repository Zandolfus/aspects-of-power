/**
 * Aura entry trigger — fires aura effects when tokens cross into an aura
 * between round-start ticks. Per design-movement-skills.md Phase B.
 *
 * Cadence model:
 *   - actor.onStartTurn runs the periodic tick (one tick per source's round)
 *   - This module catches "walked into the field mid-round" via preUpdateToken
 *
 * Two checks per token move:
 *   1. Did this moving token enter any OTHER actor's aura?
 *      (transitioned from outside → inside)
 *   2. Did this moving aura-source's aura now cover any new tokens?
 *      (aura center moved closer; previously-outside tokens are now inside)
 *
 * In-memory geometry only — no region documents, no document writes for the
 * check itself. Scales O(moving × auras_on_scene × tokens) per movement.
 * For a party with 4 active auras and 10 tokens, ~40 ops per move-segment.
 *
 * Wired in aspects-of-power.mjs init.
 */

import { _passesAuraTargetingFilter } from '../documents/actor.mjs';

/**
 * Collect all aura sources on the scene — actors with at least one
 * non-disabled effect carrying auraRadius > 0. Returns an array of
 * { actor, token, effects[] } for fast iteration.
 */
function _collectAuraSources(scene) {
  const out = [];
  for (const tokenDoc of scene.tokens) {
    const actor = tokenDoc.actor;
    if (!actor) continue;
    const auraEffects = actor.effects.filter(e =>
      !e.disabled && (e.system?.auraRadius ?? 0) > 0
    );
    if (auraEffects.length === 0) continue;
    out.push({ actor, tokenDoc, effects: auraEffects });
  }
  return out;
}

/**
 * Test whether `pos` (canvas coords) is within `radiusFt` ft of `center`.
 */
function _withinRadius(pos, center, radiusFt) {
  const gridSize = canvas.grid.size;
  const gridDist = canvas.grid.distance;
  const pxPerFt = gridSize / gridDist;
  const radiusPx = radiusFt * pxPerFt;
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  return Math.hypot(dx, dy) <= radiusPx;
}

/**
 * preUpdateToken hook. Detects entry events for the moving token vs all
 * scene auras, plus aura-source-moves vs all other tokens. Fires
 * `_applyAuraToTarget` on each newly-entered (source, target) pair.
 *
 * @param {TokenDocument} tokenDoc  The token being updated.
 * @param {object} changes          The pending update changes (may include x/y).
 * @param {object} _options
 * @param {string} _userId
 */
export async function onPreUpdateTokenForAuras(tokenDoc, changes, _options, _userId) {
  // Only fire for the GM (or whoever has authority) — avoid double-fires
  // in multiplayer.
  if (!game.users.activeGM || game.user.id !== game.users.activeGM.id) return;
  // Only relevant during active combat (auras are a combat mechanic).
  if (!game.combat?.started) return;
  // Position must actually change.
  const hasNewX = changes.x !== undefined && changes.x !== tokenDoc.x;
  const hasNewY = changes.y !== undefined && changes.y !== tokenDoc.y;
  if (!hasNewX && !hasNewY) return;

  const scene = tokenDoc.parent;
  if (!scene || scene.id !== canvas.scene?.id) return;
  const movingActor = tokenDoc.actor;
  if (!movingActor) return;

  // Compute old + new token centers.
  const w = (tokenDoc.width ?? 1) * canvas.grid.size;
  const h = (tokenDoc.height ?? 1) * canvas.grid.size;
  const oldCenter = { x: tokenDoc.x + w / 2,             y: tokenDoc.y + h / 2 };
  const newCenter = { x: (changes.x ?? tokenDoc.x) + w / 2, y: (changes.y ?? tokenDoc.y) + h / 2 };

  const allSources = _collectAuraSources(scene);
  if (allSources.length === 0) return;

  const movingDisp = tokenDoc.disposition;
  const speaker = ChatMessage.getSpeaker({ actor: movingActor });
  const movingIsPC = !!movingActor.hasPlayerOwner;
  const movingWhisper = movingIsPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };

  // ── Pass 1: the moving token enters another actor's aura ──
  for (const src of allSources) {
    if (src.tokenDoc.id === tokenDoc.id) continue; // skip self-aura check
    const srcToken = src.tokenDoc.object;
    if (!srcToken) continue;
    const srcCenter = srcToken.center;
    const srcDisp = src.tokenDoc.disposition;

    for (const effect of src.effects) {
      const targeting = effect.system?.auraTargeting ?? 'enemies';
      if (!_passesAuraTargetingFilter(srcDisp, movingDisp, targeting)) continue;
      const radius = effect.system?.auraRadius ?? 0;
      if (radius <= 0) continue;

      const wasInside = _withinRadius(oldCenter, srcCenter, radius);
      const isInside  = _withinRadius(newCenter, srcCenter, radius);
      if (!wasInside && isInside) {
        // Entry transition. Fire one tick of this aura on the moving actor.
        const srcSpeaker = ChatMessage.getSpeaker({ actor: src.actor });
        const srcIsPC = !!src.actor.hasPlayerOwner;
        const srcWhisper = srcIsPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
        await src.actor._applyAuraToTarget(effect, movingActor, srcSpeaker, srcWhisper);
      }
    }
  }

  // ── Pass 2: an aura-source moves; previously-distant tokens now in range ──
  // Only run if the moving token IS an aura-source.
  const movingAuras = movingActor.effects.filter(e =>
    !e.disabled && (e.system?.auraRadius ?? 0) > 0
  );
  if (movingAuras.length === 0) return;

  for (const otherDoc of scene.tokens) {
    if (otherDoc.id === tokenDoc.id) continue;
    const otherToken = otherDoc.object;
    if (!otherToken) continue;
    const otherCenter = otherToken.center;
    const otherDisp = otherDoc.disposition;
    const otherActor = otherDoc.actor;
    if (!otherActor) continue;

    for (const effect of movingAuras) {
      const targeting = effect.system?.auraTargeting ?? 'enemies';
      if (!_passesAuraTargetingFilter(movingDisp, otherDisp, targeting)) continue;
      const radius = effect.system?.auraRadius ?? 0;
      if (radius <= 0) continue;

      // From the OTHER token's perspective, the aura center moved from
      // oldCenter to newCenter. Did the other token transition from
      // outside-the-aura to inside-the-aura as a result?
      const wasInside = _withinRadius(otherCenter, oldCenter, radius);
      const isInside  = _withinRadius(otherCenter, newCenter, radius);
      if (!wasInside && isInside) {
        await movingActor._applyAuraToTarget(effect, otherActor, speaker, movingWhisper);
      }
    }
  }
}
