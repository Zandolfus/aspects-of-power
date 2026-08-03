/**
 * STACKS — a self-held charge pool (design-stacks-subsystem.md, RULED 2026-08-02).
 *
 * "Conjure N now, spend 1..N later." One skill PRODUCES stacks into a named
 * pool; other skills SPEND them for a scaled payload. Driving case is Willy's
 * Dreams of Light: a two-action conjure that creates five floating fields of
 * light, each hurled later as a free action.
 *
 * WHY NOT MARKS
 * -------------
 * The mark subsystem is the closest existing shape — apply, hold, spend — but
 * **marks live on the TARGET by construction** (`markedByActorUuid` on the
 * target's effect). Stacks live on the CASTER. The orb's raw
 * `flags.aspectsofpower.spellCharge` counter is the only prior art for a
 * self-held pool, and it is untyped and single-purpose.
 *
 * WHY AN ACTIVE EFFECT, NOT A FLAG
 * --------------------------------
 * Same call the mark and barrier subsystems made: an AE with typed system
 * fields gives sheet visibility (the player can SEE five fields floating),
 * duration handling for free, and keeps the schema-first discipline. A raw flag
 * gives none of that.
 *
 * ⚠ NOT the `granted` tag (user ruled 2026-08-02). `granted` bypasses the
 * stat-driven cast-time formula, which would delete exactly the wisdom scaling
 * the producer's tier was chosen to get. These are cast abilities; TIER is the
 * timing mechanism.
 */

/** Effect name shown on the caster's sheet. */
const STACK_EFFECT_PREFIX = 'Stacks';

/**
 * Damage/effect multiplier for spending `spent` stacks.
 *
 * PURE — golden-tested in tests/run_pure_tests.mjs.
 *
 * `spent ** scaling`, so that:
 *   - scaling 1.0 (the RULED default) is LINEAR: five stacks hit five times as
 *     hard as one. Spreading is a CHOICE — it converts a nuke into a broad
 *     multi-target attack — so dump and spread do not compete on damage and no
 *     concavity is wanted.
 *   - spending ONE stack is always exactly 1x, at every scaling value. A
 *     `spent * scaling` form would silently halve a single-stack spend at
 *     scaling 0.5, which is not what "diminishing returns" should mean.
 *   - scaling < 1 gives concave returns if a future skill wants them.
 *
 * @param {number} spent    Stacks committed to this activation.
 * @param {number} scaling  Exponent; 1 = linear.
 * @returns {number} Multiplier, never below 0.
 */
export function stackDamageMultiplier(spent, scaling = 1) {
  const n = Math.max(0, Math.floor(Number(spent) || 0));
  if (n <= 0) return 0;
  const s = Number.isFinite(Number(scaling)) ? Number(scaling) : 1;
  return Math.pow(n, s);
}

/**
 * How many stacks an activation may spend, given the pool and the skill's caps.
 * PURE. Returns 0 when the activation cannot be afforded.
 *
 * @param {number} available   Stacks currently held.
 * @param {number} cost        Minimum this skill spends per activation.
 * @param {number} maxSpend    Ceiling on a single activation (0 = no extra cap).
 * @returns {{min: number, max: number}} Spendable range; max 0 = cannot fire.
 */
export function spendableRange(available, cost, maxSpend = 0) {
  const have = Math.max(0, Math.floor(Number(available) || 0));
  const min  = Math.max(1, Math.floor(Number(cost) || 1));
  if (have < min) return { min, max: 0 };
  const capped = maxSpend > 0 ? Math.min(have, Math.floor(maxSpend)) : have;
  return { min, max: Math.max(min, capped) };
}

/** The live stack effect for a pool, or null. */
export function findStackEffect(actor, pool) {
  if (!actor || !pool) return null;
  return actor.effects.find(e => !e.disabled && e.system?.stackPool === pool) ?? null;
}

/** Stacks currently held in a pool. */
export function getStackCount(actor, pool) {
  return Math.max(0, Number(findStackEffect(actor, pool)?.system?.stackCount) || 0);
}

/**
 * Damage already paid for, per stack. 0 when the pool banked no payload.
 *
 * THE POINT OF THIS: it lets the spender be genuinely free to fire — no mana,
 * no invest — while still hitting for what the producer's cast bought. The
 * alternative (the spender rolling its own damage) cannot express "firing is
 * free except for time", because a zero-invest spell computes zero damage:
 * `(invested/20) ** 0.2` is 0 at 0.
 */
export function getStackPayload(actor, pool) {
  return Math.max(0, Number(findStackEffect(actor, pool)?.system?.stackPayload) || 0);
}

/**
 * Add stacks to a pool, creating the carrying effect if absent.
 *
 * ⚠ Returns the new count computed from the PRE-update value rather than
 * re-reading `effect.system.stackCount`. `update()` writes `_source` and the DB
 * but does NOT re-initialise the live DataModel, so an immediate re-read
 * returns the stale number (see playbook-live-data-reliability).
 *
 * @returns {Promise<number>} Stacks held after the add.
 */
export async function addStacks(actor, pool, amount, opts = {}) {
  const { cap = 0, sourceSkill = '', label = '', img = null, durationRounds = 0, payload = 0 } = opts;
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  if (!actor || !pool || add <= 0) return getStackCount(actor, pool);

  const existing = findStackEffect(actor, pool);
  const before   = Math.max(0, Number(existing?.system?.stackCount) || 0);
  const ceiling  = cap > 0 ? Math.floor(cap) : Infinity;
  const after    = Math.min(ceiling, before + add);
  if (after === before) return before;

  const pay = Math.max(0, Number(payload) || 0);
  if (existing) {
    // Re-conjuring into a partly-spent pool re-prices the WHOLE pool at the
    // new cast's payload. Averaging the old and new rates would be more
    // "accurate" and much harder to reason about at the table; a top-up
    // simply refreshes what the fields are worth.
    await existing.update({
      'system.stackCount': after,
      ...(pay > 0 ? { 'system.stackPayload': pay } : {}),
    });
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name: label || `${STACK_EFFECT_PREFIX}: ${pool}`,
      img: img || 'icons/magic/light/orb-lightbulb-gray.webp',
      origin: actor.uuid,
      // 0 = until spent. Producers that want a shelf life pass durationRounds.
      ...(durationRounds > 0 ? { duration: { rounds: durationRounds } } : {}),
      system: {
        stackPool: pool, stackCount: after, stackSourceSkill: sourceSkill,
        ...(pay > 0 ? { stackPayload: pay } : {}),
      },
    }]);
  }
  return after;
}

/**
 * Spend stacks from a pool. Deletes the carrying effect when it empties, so an
 * exhausted pool leaves no zero-count effect cluttering the sheet.
 *
 * @returns {Promise<number>} Stacks actually spent (0 if the pool could not pay).
 */
export async function spendStacks(actor, pool, amount) {
  const want = Math.max(0, Math.floor(Number(amount) || 0));
  const eff  = findStackEffect(actor, pool);
  if (!eff || want <= 0) return 0;
  const before = Math.max(0, Number(eff.system?.stackCount) || 0);
  if (before < want) return 0;
  const after = before - want;
  if (after <= 0) await eff.delete();
  else await eff.update({ 'system.stackCount': after });
  return want;
}
