/**
 * Strain recovery on the world clock.
 *
 * Strain is max-HP burned to buy a resource conversion past what the body
 * can absorb (helpers/formulas.mjs `convertResources`). It was charged
 * correctly from the day it shipped but NEVER decayed: `recoveryPerHour`
 * sat in config at 0.05 with nothing reading it, because the system had no
 * world-time listener at all. Strain was therefore permanent, which is why
 * no resource-conversion content was allowed to ship.
 *
 * The rate is anchored to meditation (user ruling 2026-08-10, matching the
 * design note already in config): meditation restores 10% of max mana per
 * hour, strain recovers 5% of true max HP per hour — HALF meditation. That
 * is what makes a conversion time-NEUTRAL rather than free: gaining an
 * hour's worth of mana costs an hour's worth of strain. You skip the hour,
 * you owe the hour.
 *
 * Recovery is PROPORTIONAL to elapsed time, not per-whole-hour: a 30-minute
 * downtime block returns 2.5%. Whole-hour gating would create a "wait 59
 * minutes for nothing" trap, and every other downtime cost here is already
 * continuous.
 */

import { isActingGM } from '../helpers/gm.mjs';

const SECONDS_PER_HOUR = 3600;

/**
 * Decay strain on every actor that carries any, for `dtSeconds` of world
 * time. Exported for the downtime/rest paths and for console verification.
 *
 * ⚠ Rewinds (negative dt) do NOT re-apply strain. Time travel is a GM
 * correction tool, not a mechanic, and re-burning max HP on a rewind would
 * turn a mistake into damage.
 *
 * @param {number} dtSeconds  Elapsed world time in seconds.
 * @returns {Promise<Array<{name: string, from: number, to: number}>>} recovered actors
 */
export async function recoverStrainOverTime(dtSeconds) {
  if (!(dtSeconds > 0)) return [];
  const cfg = CONFIG.ASPECTSOFPOWER.strain ?? {};
  const perHour = cfg.recoveryPerHour ?? 0.05;
  if (!(perHour > 0)) return [];
  const recovered = perHour * (dtSeconds / SECONDS_PER_HOUR);
  const touched = [];

  for (const actor of game.actors) {
    const current = actor.system?.strain ?? 0;
    if (!(current > 0)) continue;
    const next = Math.max(0, current - recovered);
    // Max HP GROWS as strain decays. That direction is always safe — the
    // shrinking case is what needs clamping, and _preUpdate already guards
    // it — so current HP is deliberately left alone: recovering strain
    // raises the ceiling, it does not heal.
    await actor.update({ 'system.strain': next });
    touched.push({ name: actor.name, from: current, to: next });
  }
  return touched;
}

/**
 * Wire strain decay to the world clock. Registered at ready.
 *
 * GM-gated via isActingGM: world time advances once, but every connected
 * client observes the hook, so two GM logins would decay twice.
 */
export function registerStrainHooks() {
  Hooks.on('updateWorldTime', async (_worldTime, dt) => {
    try {
      if (!isActingGM()) return;
      if (!Number.isFinite(dt) || dt <= 0) return;
      const touched = await recoverStrainOverTime(dt);
      if (!touched.length) return;
      const hours = dt / SECONDS_PER_HOUR;
      const lines = touched.map(t =>
        `<li>${t.name}: strain ${Math.round(t.from * 100)}% &rarr; ${Math.round(t.to * 100)}%`
        + `${t.to === 0 ? ' <strong>(fully recovered)</strong>' : ''}</li>`);
      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><em>Strain recovery over ${hours < 1 ? `${Math.round(hours * 60)} minutes` : `${Math.round(hours * 10) / 10} hours`}:</em></p><ul>${lines.join('')}</ul>`,
      });
    } catch (err) {
      // Never let strain bookkeeping break time advancement — downtime
      // resolution and the celestial report ride the same clock.
      console.error('Aspects of Power | strain recovery failed', err);
    }
  });
}
