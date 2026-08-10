/**
 * Debuff build-up: a stacking debuff that becomes a worse one at a threshold.
 *
 * Generalised 2026-08-10. Chilled → Frozen shipped as a hand-wired block
 * inside the gmApplyDebuff switch, which meant the pattern the design calls
 * for everywhere — "most caps are GATEWAYS, not ceilings" — existed exactly
 * once. This drives the same behaviour from
 * `CONFIG.ASPECTSOFPOWER.debuffBuildup`, so a second pair is a config entry
 * rather than another branch in a 900-line switch.
 *
 * The rule (unchanged from the shipped chilled case): after a stack lands,
 * sum `debuffDamage` across every live stack of that type. If the total
 * reaches the threshold, DELETE all of them and spawn the successor —
 * replace, don't layer. Already suffering the successor refreshes its
 * duration rather than adding a second copy.
 */

import { debuffBuildupTriggered } from '../helpers/formulas.mjs';

/**
 * Apply build-up for a debuff type that has just landed on `target`.
 *
 * Caller supplies the round/turn stamps and chat plumbing so this stays
 * usable from any apply path, not just the GM socket handler.
 *
 * @param {Actor} target
 * @param {string} debuffType        the type that was just applied
 * @param {object} [ctx]
 * @param {number} [ctx.startRound]
 * @param {number} [ctx.startTurn]
 * @param {string} [ctx.origin]      effect origin uuid to carry over
 * @param {string} [ctx.casterActorUuid]
 * @param {object} [ctx.speaker]     ChatMessage speaker
 * @param {object} [ctx.whisper]     spread onto the ChatMessage (e.g. {whisper:[...]})
 * @returns {Promise<boolean>} true when a transformation happened
 */
export async function applyDebuffBuildup(target, debuffType, ctx = {}) {
  const entry = CONFIG.ASPECTSOFPOWER.debuffBuildup?.[debuffType];
  if (!target || !entry) return false;

  const stacks = target.effects.filter(e =>
    !e.disabled && e.system?.debuffType === debuffType);
  if (!stacks.length) return false;

  const total = stacks.reduce((s, e) => s + (Number(e.system?.debuffDamage) || 0), 0);
  const statMod = entry.thresholdStat
    ? (target.system.abilities?.[entry.thresholdStat]?.mod ?? 0)
    : 0;
  if (!debuffBuildupTriggered(total, statMod, entry.thresholdFlat)) return false;

  // Replace, don't layer.
  await target.deleteEmbeddedDocuments('ActiveEffect', stacks.map(e => e.id));

  const existing = target.effects.find(e =>
    !e.disabled && e.system?.debuffType === entry.into);
  const duration = entry.duration ?? 2;
  if (existing) {
    await existing.update({
      'system.roundsRemaining': duration,
      'duration.startRound': ctx.startRound,
      'duration.startTurn': ctx.startTurn,
    });
  } else {
    await target.createEmbeddedDocuments('ActiveEffect', [{
      name: entry.name ?? entry.into,
      img: entry.img ?? 'icons/svg/downgrade.svg',
      origin: ctx.origin ?? '',
      duration: { rounds: duration, startRound: ctx.startRound, startTurn: ctx.startTurn },
      system: {
        debuffType: entry.into,
        debuffDamage: 0,
        casterActorUuid: ctx.casterActorUuid ?? '',
        tags: entry.tags ?? [],
      },
    }]);
  }

  const threshold = Math.max(statMod, Number(entry.thresholdFlat) || 0);
  const per = Math.round(total / stacks.length);
  ChatMessage.create({
    speaker: ctx.speaker,
    ...(ctx.whisper ?? {}),
    content: `<p><strong>${target.name}</strong> is <strong>${entry.name ?? entry.into}</strong>! `
           + `(${stacks.length} ${debuffType} stack${stacks.length === 1 ? '' : 's'} `
           + `&times; ${per} &ge; ${threshold}${entry.thresholdStat ? ` ${entry.thresholdStat} mod` : ''})</p>`,
  });
  return true;
}
