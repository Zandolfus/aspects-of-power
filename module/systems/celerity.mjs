/**
 * Celerity timing math (per design-celerity.md).
 *
 *   wait         = weight × multiplier × SCALE / actor_speed
 *   round_length = ROUND_K / ref_mod(RL)
 *
 * Round length is build-neutral (RL-tied); per-action wait is build-driven
 * (actor_speed varies by stat/spec). All times are in tick units; SCALE
 * provides granularity for stack ordering.
 *
 * Console usage:
 *   const C = game.aspectsofpower.celerity;
 *   C.computeActionWait(actor, skill);                  // ticks for next action
 *   C.actorRoundLength(actor);                          // ticks per personal round
 *   C.referenceRoundLength(actor.system.attributes.race.level);
 *   C.simulate([{actor, skill}, ...]);                  // predicted ordering
 */

import { AspectsofPowerItem } from '../documents/item.mjs';

const HYBRID_60_40_WIS_INT = (a) => 0.6 * (a.wisdom?.mod ?? 0) + 0.4 * (a.intelligence?.mod ?? 0);
const HYBRID_60_40_WIS_DEX = (a) => 0.6 * (a.wisdom?.mod ?? 0) + 0.4 * (a.dexterity?.mod ?? 0);

/**
 * Speed source by skill roll.type, per design-celerity.md table.
 * Returns the actor stat mod that drives the speed for this skill.
 */
function _actorSpeedFor(actor, skill) {
  const a = actor.system.abilities ?? {};
  const type = skill?.system?.roll?.type ?? '';
  const ability = skill?.system?.roll?.abilities ?? '';
  switch (type) {
    case 'str_weapon':       return a.strength?.mod  ?? 0;
    case 'dex_weapon':       return a.dexterity?.mod ?? 0;
    case 'phys_ranged':      return a.dexterity?.mod ?? 0;
    case 'wisdom_dexterity': return Math.round(HYBRID_60_40_WIS_DEX(a));
    case 'magic':
    case 'magic_melee':
    case 'magic_projectile': return Math.round(HYBRID_60_40_WIS_INT(a));
    default:                 return a[ability]?.mod ?? a.dexterity?.mod ?? 1;
  }
}

/**
 * Wait time in ticks for `actor` performing `skill`. Optionally pass `weapon`
 * to override resolution; otherwise resolves via the same path as item.roll().
 */
export function computeActionWait(actor, skill, weapon = null) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const speed = Math.max(1, _actorSpeedFor(actor, skill));
  const w = weapon ?? skill._resolveWeaponForSkill?.() ?? null;
  const weaponWeight = w
    ? AspectsofPowerItem.resolveWeaponWeight(w)
    : sc.BASELINE_WEIGHT; // fall back to sword baseline for weaponless skills (spells)
  const multiplier = skill?.system?.roll?.actionWeightMultiplier ?? 1.0;
  return Math.max(1, Math.round((weaponWeight * multiplier * sc.SCALE) / speed));
}

/**
 * Personal round length in ticks for an actor based on their own mod.
 * Build-driven — high-mod actors live faster regardless of RL.
 *
 * Note: per design, the "official" round length is the RL-based reference
 * (build-neutral). This per-actor variant is useful for "how long is one
 * source's round" when applying source's-rounds duration mechanics.
 */
export function actorRoundLength(actor) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const a = actor.system.abilities ?? {};
  // Actor mod — use the highest combat-relevant mod as a build proxy.
  // Falls through to perception as a generic reference if combat stats are 0.
  const mods = [a.strength?.mod, a.dexterity?.mod, a.intelligence?.mod, a.wisdom?.mod, a.perception?.mod]
    .filter(Boolean);
  const ref = mods.length ? Math.max(...mods) : 1;
  return Math.max(1, Math.round(sc.ROUND_K / ref));
}

/**
 * Build-neutral reference round length at a given race level.
 * This is the ROUND clock for round-anchored mechanics — every actor at the
 * same RL ticks at the same cadence regardless of their stat distribution.
 *
 * Linear-interp between adjacent table entries when RL falls in a gap.
 */
export function referenceRoundLength(rl) {
  const table = CONFIG.ASPECTSOFPOWER.referenceRoundLength ?? {};
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return 1;
  if (rl <= keys[0]) return table[keys[0]];
  if (rl >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  // Find bracketing keys and lerp.
  for (let i = 0; i < keys.length - 1; i++) {
    if (rl >= keys[i] && rl <= keys[i + 1]) {
      const lo = keys[i], hi = keys[i + 1];
      const frac = (rl - lo) / (hi - lo);
      return Math.round(table[lo] + frac * (table[hi] - table[lo]));
    }
  }
  return table[keys[keys.length - 1]];
}

/**
 * Predict the resolution order of declared (actor, skill) pairs from a
 * shared starting tick. Returns one row per pair: { actor, skill, wait,
 * scheduledTick, swingsPerRound }, sorted ascending by scheduledTick.
 *
 * Useful for sanity-checking the system without committing combat state.
 */
export function simulate(declarations, startTick = 0) {
  const rows = declarations.map(({ actor, skill }) => {
    const wait = computeActionWait(actor, skill);
    const rl = actor.system.attributes?.race?.level ?? 1;
    const roundLen = referenceRoundLength(rl);
    return {
      actor: actor.name,
      skill: skill.name,
      wait,
      scheduledTick: startTick + wait,
      raceLevel: rl,
      referenceRound: roundLen,
      actionsPerRound: Math.round(roundLen / wait * 10) / 10,
    };
  });
  return rows.sort((a, b) => a.scheduledTick - b.scheduledTick);
}
