/**
 * Aura tick cadence — resource auras pay in thirds of a reference round.
 * design-aura-ticks.md, user ruled 2026-08-04:
 *   "Heals in fractions, unlike damage, is always fine. Maybe we split aura
 *    resource effects into three ticks per reference round."
 *
 * WHY THIS EXISTS AT ALL, since throughput is unchanged (each tick is
 * amount/N): the celerity clock is a CONTINUOUS time axis, not an event-only
 * one. `interpolateMovementPosition` gives any moving token a well-defined
 * position at ANY tick; events are merely where the system stops to resolve.
 * So a target walking through an aura can be credited for the thirds they were
 * actually inside it, instead of being judged by a single all-or-nothing
 * position sample once a round. The tick count is a real dial for spatial
 * fidelity, paid for in work per clock advance.
 *
 * ⚠ RESOURCE AURAS ONLY (heal / stam). Damage auras still tick once at round
 * start: flat armour and DR apply PER HIT, so three smaller hits each meet the
 * full wall and can round to nothing. The split is lossless for healing and
 * lossy for damage — that asymmetry is the whole ruling.
 *
 * ⚠ MUST RUN BEFORE THE MOVEMENT COMMIT. Called from the celerity advance
 * handler after `newClock` is final but BEFORE in-flight movements animate and
 * clear their flags — that is the only window where every mover's
 * `declaredMovement` is still readable and token documents still sit at their
 * OLD positions, which is what makes interpolating past moments possible.
 */

import { auraTickPeriod, auraTickMoments } from '../helpers/formulas.mjs';
import { referenceRoundLength, interpolateMovementPosition } from './celerity.mjs';

const FLAG_NS = 'aspectsofpower';

/** Centre of a token DOCUMENT (never the placeable — see below). */
function centreOfDoc(doc, gridSize) {
  return {
    x: doc.x + (doc.width * gridSize) / 2,
    y: doc.y + (doc.height * gridSize) / 2,
  };
}

/**
 * Where is this combatant's token at `tick`?
 *
 * ⚠ FROM THE DOCUMENT, NOT THE PLACEABLE. `token.center` is the ANIMATED
 * position and lags during movement — it reported a token 60 ft away as
 * in-range twice before. A declared movement is interpolated; anything else
 * is simply where the document says it is.
 */
function positionAtTick(tokenDoc, combatant, tick, gridSize) {
  const mv = combatant?.flags?.[FLAG_NS]?.declaredMovement;
  if (mv?.startPos && mv?.endPos) {
    const p = interpolateMovementPosition(mv, tick);
    return {
      x: p.x + (tokenDoc.width * gridSize) / 2,
      y: p.y + (tokenDoc.height * gridSize) / 2,
    };
  }
  return centreOfDoc(tokenDoc, gridSize);
}

/**
 * Pay every owed resource-aura tick between the last payout and `newClock`,
 * sampling positions at each tick moment.
 *
 * @param {Combat} combat
 * @param {number} newClock  the tick the clock is ABOUT to advance to
 * @returns {Promise<number>} number of individual payouts made
 */
export async function sweepAuraTicks(combat, newClock) {
  if (!combat || !canvas?.scene) return 0;
  const gridSize = canvas.grid.size;
  const pxPerFt = gridSize / canvas.grid.distance;
  let payouts = 0;

  for (const carrier of combat.combatants) {
    const casterActor = carrier.actor;
    const casterDoc = carrier.token;
    if (!casterActor || !casterDoc) continue;
    if (casterDoc.parent?.id !== canvas.scene.id) continue;

    const auras = casterActor.effects.filter((e) => {
      if (e.disabled) return false;
      if ((e.system?.auraRadius ?? 0) <= 0) return false;
      const t = e.system?.auraEffectType ?? 'damage';
      return t === 'heal' || t === 'stam';
    });
    if (!auras.length) continue;

    // Cadence is the CASTER's — a fast actor's aura pulses more often in
    // absolute time, exactly as their actions do.
    const rl = casterActor.system?.attributes?.race?.level ?? 0;
    const period = auraTickPeriod(referenceRoundLength(rl));
    if (period <= 0) continue;

    for (const effect of auras) {
      const sys = effect.system;
      const total = sys.auraAmount ?? sys.auraDamage ?? 0;
      if (total <= 0) continue;

      const { moments, newLastTick, capped } = auraTickMoments(
        sys.auraLastTick, newClock, period);
      if (capped) {
        console.warn(`[aura] ${casterActor.name} / ${effect.name}: catch-up capped at `
          + `${CONFIG.ASPECTSOFPOWER.auras?.maxCatchUpTicks} ticks; resynced to the clock.`);
      }
      // Always commit the cursor, even with nothing owed — that is what seeds
      // a freshly-applied aura so it does not later pay a backlog from 0.
      if (newLastTick !== sys.auraLastTick) {
        await effect.update({ 'system.auraLastTick': newLastTick });
      }
      if (!moments.length) continue;

      const n = Math.max(1, Math.round(
        Number(CONFIG.ASPECTSOFPOWER.auras?.ticksPerReferenceRound) || 1));
      // Split, then round. Rounding each third of a heal is a sub-1-point
      // difference; a floor would quietly shave throughput every tick.
      const perTick = Math.round(total / n);
      if (perTick <= 0) continue;

      const radiusPx = (sys.auraRadius ?? 0) * pxPerFt;
      const targeting = sys.auraTargeting ?? 'enemies';
      const speaker = ChatMessage.getSpeaker({ actor: casterActor });
      const whisper = ChatMessage.getWhisperRecipients('GM');
      const gmWhisper = casterActor.hasPlayerOwner ? {} : { whisper };

      for (const moment of moments) {
        const myCentre = positionAtTick(casterDoc, carrier, moment, gridSize);
        for (const otherCm of combat.combatants) {
          const otherDoc = otherCm.token;
          const targetActor = otherCm.actor;
          if (!otherDoc || !targetActor) continue;
          if (otherDoc.parent?.id !== canvas.scene.id) continue;
          const isSelf = otherDoc.id === casterDoc.id;
          // A supportive aura includes its carrier (user ruled 2026-08-03) —
          // a chanter in their own hymn is sustained by it, not a battery.
          if (isSelf && !(sys.auraEffectType === 'heal' || sys.auraEffectType === 'stam')) continue;

          const otherCentre = positionAtTick(otherDoc, otherCm, moment, gridSize);
          const dist = Math.hypot(otherCentre.x - myCentre.x, otherCentre.y - myCentre.y);
          // ⚠ NaN must FAIL the check. `NaN > radiusPx` is false, so an
          // unguarded compare would apply the aura at any distance.
          if (!Number.isFinite(dist) || dist > radiusPx) continue;
          if (!isSelf && !passesTargeting(casterDoc.disposition, otherDoc.disposition, targeting)) continue;

          await casterActor._applyAuraToTarget(effect, targetActor, speaker, gmWhisper, perTick);
          payouts++;
        }
      }
    }
  }
  return payouts;
}

/**
 * Disposition filter. Mirrors `_passesAuraTargetingFilter` in actor.mjs; kept
 * local so this module does not import a document class for one predicate.
 */
function passesTargeting(myDisp, otherDisp, targeting) {
  if (targeting === 'all') return true;
  if (targeting === 'allies') return otherDisp === myDisp;
  return otherDisp !== myDisp;   // 'enemies'
}

export const AuraTickHelpers = { sweepAuraTicks, positionAtTick };
