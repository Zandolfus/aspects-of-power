/**
 * Damage-over-time ticking (design-hemorrhage-bleed.md).
 *
 * ONE implementation, two callers: the celerity round-start tick
 * (systems/celerity.mjs — the live path) and the legacy combat-turn tick
 * (aspects-of-power.mjs). They had drifted into duplicate copies of the same
 * loop, so a fix to one silently missed the other.
 *
 * ── Parallel effects, POOLED damage (the intended model) ──
 * Stacks stay separate ActiveEffects: each keeps its own duration and the
 * oldest expires first. That independence is what BOUNDS the total, and it is
 * why the legacy "merge + refresh duration" model was retired — it summed
 * damage while resetting the clock, so a stacked DoT grew forever.
 *
 * But their DAMAGE is summed before DR is charged ONCE. Charging DR per effect
 * made stacking meaningless against real armour: three stacks of 39 against
 * DR 50 resolved as 3 x max(0, 39-50) = 0 instead of 117 - 50 = 67. The
 * infinite-damage bug came from refreshing DURATION, not from summing damage —
 * the two are separable, and pooling at tick time touches neither duration nor
 * expiry.
 *
 * Pooling is per damage TYPE, so future per-type resistance stays meaningful,
 * and per APPLIER, since each applier ticks on their own round.
 *
 * DoTs bypass armor and veil; only toughness DR reduces them (RULED
 * 2026-07-18: toughness SHOULD counter DoTs — the tank's investment paying
 * off). Do not "fix" that here.
 */

/**
 * Group one applier's live DoTs on a target by damage type.
 * @returns {Map<string, {total:number, stacks:number, names:string[]}>}
 */
export function poolDots(targetActor, applierUuid) {
  const pools = new Map();
  for (const effect of targetActor.effects) {
    const sys = effect.system ?? {};
    if (!sys.dot || sys.applierActorUuid !== applierUuid || effect.disabled) continue;
    const raw = sys.dotDamage ?? 0;
    if (raw <= 0) continue;
    const type = sys.dotDamageType ?? 'physical';
    const pool = pools.get(type) ?? { total: 0, stacks: 0, names: [] };
    pool.total += raw;
    pool.stacks += 1;
    if (!pool.names.includes(effect.name)) pool.names.push(effect.name);
    pools.set(type, pool);
  }
  return pools;
}

/**
 * Tick every DoT this applier has placed, across the whole combat.
 *
 * @param {Combat} combat
 * @param {string} applierUuid
 * @returns {Promise<Array<{name:string, damage:number, newHealth:number}>>}
 */
export async function tickDotsFor(combat, applierUuid) {
  const results = [];
  for (const c of combat.combatants) {
    if (!c.actor) continue;
    const pools = poolDots(c.actor, applierUuid);
    if (!pools.size) continue;

    const drValue = c.actor.system.defense?.dr?.value ?? 0;
    const health  = c.actor.system.health;
    const lines = [];
    let totalDamage = 0;
    for (const [type, pool] of pools) {
      const damage = Math.max(0, pool.total - drValue);
      totalDamage += damage;
      lines.push(`<strong>${damage}</strong> ${type} from ${pool.names.join(', ')}`
        + (pool.stacks > 1
          ? ` (${pool.stacks} stacks pooled: ${pool.total} &minus; DR ${drValue})`
          : ` (DR: &minus;${drValue})`));
    }

    // ONE health write for all pools — re-reading system.health between updates
    // returns a stale DataModel (see playbook-live-data-reliability).
    const newHealth = Math.max(0, health.value - totalDamage);
    await c.actor.update({ 'system.health.value': newHealth });

    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: `<p><strong>${c.actor.name}</strong> takes ${lines.join('; ')}. `
             + `Health: ${newHealth} / ${health.max}`
             + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
    });
    results.push({ name: c.actor.name, damage: totalDamage, newHealth });
  }
  return results;
}

export const DotHelpers = { poolDots, tickDotsFor };
