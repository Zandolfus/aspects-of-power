/**
 * House roll-math helpers — the SINGLE home for formula fragments that were
 * copy-pasted across item.mjs / celerity.mjs and between dialog previews and
 * their real damage paths. Everything here is a PURE function of its inputs
 * (CONFIG is read only for defaults and can be injected for tests), so this
 * module is unit-testable in plain node (tests/run_pure_tests.mjs).
 *
 * RULE (playbook-code-standards): never inline any of these shapes again —
 * a preview and its real path MUST call the same function (the pre-8de305b
 * invest-preview drift bug is the canonical failure this prevents).
 */

/**
 * The house hit-total grammar: `blend × (1 + d20/100)` — multiplicative ±10%,
 * NOT additive dice. Returns the Foundry roll formula string.
 * @param {number|string} m  The stat blend (number or formula fragment).
 * @returns {string}
 */
export function houseHitFormula(m) {
  return `((((d20/100)*(${m}))+(${m})))`;
}

/**
 * Hybrid ability mod for skills authored with statType 'hybrid':
 * primary×pw + secondary×sw, rounded. Falls back to the primary mod alone.
 * @param {object} abilities  actor.system.abilities
 * @param {object} rollCfg    {abilities, statType, secondaryAbility, primaryWeight, secondaryWeight}
 * @returns {number}
 */
export function hybridAbilityMod(abilities, rollCfg) {
  const primaryMod = abilities[rollCfg.abilities]?.mod ?? 0;
  if (rollCfg.statType !== 'hybrid') return primaryMod;
  const secondaryMod = abilities[rollCfg.secondaryAbility]?.mod ?? 0;
  const pw = rollCfg.primaryWeight ?? 1.0;
  const sw = rollCfg.secondaryWeight ?? 0;
  return Math.round(primaryMod * pw + secondaryMod * sw);
}

/**
 * Weight-normalized weapon stat blend — THE one implementation of the
 * meleeBlend/rangedBlend curves (design-melee/ranged-system.md).
 *   melee : strWeight = strFloor + slope×norm  → blend = str×w + dex×(1−w)
 *   ranged: perWeight = perFloor + slope×norm  → blend = dex×(1−w) + per×w
 * Used by: weapon damage path, spellstrike hit override, celerity speed.
 * If these ever diverge again, speed silently drifts from damage.
 *
 * @param {number} weight       Canonical weapon weight.
 * @param {object} mods         {str, dex, per} ability mods.
 * @param {boolean} isRanged    Ranged (dex/per) vs melee (str/dex) family.
 * @param {object} [cfg]        Override blend config (defaults to CONFIG).
 * @returns {{blend: number, label: string}}
 */
export function weaponStatBlend(weight, mods, isRanged, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  if (isRanged) {
    const b = sc.rangedBlend ?? { perFloor: 0.05, slope: 0.55, weightOffset: 50, weightSpan: 200 };
    const norm = Math.max(0, Math.min(1, (weight - b.weightOffset) / b.weightSpan));
    const perWeight = b.perFloor + b.slope * norm;
    return {
      blend: Math.round((mods.dex ?? 0) * (1 - perWeight) + (mods.per ?? 0) * perWeight),
      label: 'Dex/Per',
    };
  }
  const b = sc.meleeBlend ?? { strFloor: 0.30, slope: 0.70, weightOffset: 40, weightSpan: 180 };
  const norm = Math.max(0, Math.min(1, (weight - b.weightOffset) / b.weightSpan));
  const strWeight = b.strFloor + b.slope * norm;
  return {
    blend: Math.round((mods.str ?? 0) * strWeight + (mods.dex ?? 0) * (1 - strWeight)),
    label: 'Str/Dex',
  };
}

/**
 * The weight a CAST carries, under the magic/melee unification.
 *
 * A weapon's weight does double duty — windup (damage) and wait (tempo) — and
 * that pairing is what makes DPR weight-invariant. Spells only ever used their
 * tier weight for wait, so tier bought time and no damage. This returns the
 * weight a spell should carry so both sides can read the same number.
 *
 * `model` comes from CONFIG.ASPECTSOFPOWER.spellWeight.model:
 *   'none'      → 0 (caller uses windup 1; shipped behaviour)
 *   'tier'      → the tier weight alone
 *   'implement' → implement weight + tier weight
 *
 * @param {string} tier            'basic' | 'high' | 'greater' | 'major' | 'grand'
 * @param {number} implementWeight Heaviest equipped implement's weight, 0 if none.
 * @param {object} [cfg]           CONFIG.ASPECTSOFPOWER override (tests).
 * @returns {number}               Cast weight; 0 means "no spell weight model".
 */
export function spellCastWeight(tier, implementWeight = 0, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const model = sc.spellWeight?.model ?? 'implement';
  if (model === 'none') return 0;
  const tierW = sc.spellTierWeights?.[tier];
  if (!tierW) return 0;
  return model === 'implement'
    ? tierW + Math.max(0, Number(implementWeight) || 0)
    : tierW;
}

/**
 * Windup multiplier for a spell — the damage half of the same weight the wait
 * uses. Mirrors computeWindupMultiplier's shape (weight/100, clamped) so a
 * spell and a swing are scaled by the same grammar.
 *
 * Returns 1 when the model is off, which makes `strikeInvestDamage` identical
 * to `spellInvestDamage` — the two differ only by this factor.
 *
 * @param {string} tier
 * @param {number} implementWeight
 * @param {object} [cfg]
 * @returns {number}
 */
export function spellWindupMultiplier(tier, implementWeight = 0, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const w = spellCastWeight(tier, implementWeight, sc);
  if (w <= 0) return 1;
  const dt = sc.defenseTuning ?? {};
  const max = sc.spellWeight?.windupMaxSpell ?? dt.windupMax ?? 3.0;
  return Math.min(max, Math.max(dt.windupMin ?? 0.5, w / 100));
}

/**
 * Grade-relative fixed spell-damage reference — the 65f8a42 tier-ladder fix
 * constant (basic-tier baseMana at this grade). Normalizing invest by the
 * spell's OWN baseMana cancelled tier out of damage; every invest-scaled
 * damage path (spells, infusions) must normalize by THIS.
 * @param {number} gradeFactor  spellGradeFactors[grade]
 * @param {object} [cfg]
 * @returns {number}
 */
export function spellDamageRef(gradeFactor, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  return Math.max(1, Math.round((sc.spellTierFactors?.basic ?? 2) * gradeFactor));
}

/**
 * Invest-scaled spell damage: int × mult × (invested/ref)^0.2.
 * SHARED by the invest-dialog preview and the real cast path — they must
 * never drift (8de305b).
 */
export function spellInvestDamage(intMod, multiplier, invested, ref, cfg = null) {
  return Math.round(intMod * multiplier
    * Math.pow(Math.max(invested, 1) / Math.max(ref, 1), investCurve(cfg)));
}

/**
 * Resource conversion: how much destination `sourceSpent` buys, and what it
 * costs in STRAIN. PURE — golden-tested.
 *
 * `rate` is SOURCE units per 1 DESTINATION unit, so rate 5 means five stamina
 * buys one mana, and rate 0.2 means one health buys five mana.
 *
 * Strain is charged on the DESTINATION gained, not the source spent, because
 * what you are paying for is the mana — and divided by toughness, because
 * toughness is how much self-inflicted strain a body absorbs. Dividing rather
 * than granting a free allowance matters: an allowance is trivially split
 * across many small casts, and cast time does not stop that (channel wait is
 * linear in amount, so ten small conversions cost the same time as one big
 * one).
 *
 * ⚠ Vitality-SOURCED conversions charge no strain — the health is the price
 * already, and charging max HP on top would tax the same act twice.
 *
 * @returns {{gained: number, strain: number}}
 */
export function convertResources(sourceSpent, rate, toughMod, fromResource = '', cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const spend = Math.max(0, Math.floor(Number(sourceSpent) || 0));
  const r = Number(rate) || 1;
  if (spend <= 0 || r <= 0) return { gained: 0, strain: 0 };
  const gained = Math.floor(spend / r);
  if (gained <= 0) return { gained: 0, strain: 0 };
  if (fromResource === 'health') return { gained, strain: 0 };
  const divisor = sc.strain?.conversionDivisor ?? 7;
  const tough = Math.max(1, Number(toughMod) || 0);
  return { gained, strain: gained / (tough * divisor) };
}

/**
 * Healing potency blend for a mode (design-healer-system.md).
 *
 * THE CASTING RESOURCE IS THE MODE — mana is a cleric, health is blood magic,
 * stamina is a chanter's aura. All three are wisdom-led and differ in their
 * second stat, so a healer has one primary and three expressions of it.
 *
 * This is the term that replaces INT in the invest formula, which is what
 * makes healing share the damage economy rather than sit beside it.
 *
 * @param {object} abilities  actor.system.abilities
 * @param {string} resource   'mana' | 'health' | 'stamina'
 * @param {object} [cfg]      CONFIG override (tests)
 * @returns {number} Blended mod, 0 when the mode is unknown.
 */
export function healStatBlend(abilities, resource, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const b = sc.healing?.blends?.[resource];
  if (!b) return 0;
  const p = Number(abilities?.[b.primary]?.mod) || 0;
  const s = Number(abilities?.[b.secondary]?.mod) || 0;
  return Math.round(p * (b.pw ?? 0) + s * (b.sw ?? 0));
}

/**
 * Per-round tick of a heal-over-time, and what the whole thing is worth.
 *
 * A HoT trades certainty for total: it can be wasted if the target dies first
 * or overheals if they are already topped up, so running the full duration
 * should beat casting the same skill instantly. At the default 0.5 scale a
 * 3-round HoT totals 1.5x the burst, which is the premium for waiting.
 *
 * ⚠ The tick is frozen at apply time (see effect-base `hotAmount`) — the heal
 * is as strong as the caster who placed it, not as they are three rounds later.
 *
 * @param {number} rollTotal  The skill's rolled heal.
 * @param {number} [scale]    Per-tick fraction of that roll.
 * @param {number} [rounds]   Duration, for the `total` figure only.
 * @returns {{tick: number, total: number}}
 */
export function hotTickAmount(rollTotal, scale = 0.5, rounds = 0) {
  const r = Math.max(0, Number(rollTotal) || 0);
  const s = Math.max(0, Number(scale) || 0);
  const tick = Math.round(r * s);
  return { tick, total: tick * Math.max(0, Math.floor(Number(rounds) || 0)) };
}

/**
 * Barrier potency: an even blend of intelligence and wisdom.
 *
 * A barrier IS a cast (user ruled 2026-08-03), so it takes the caster's stats
 * rather than a healing blend — but pure INT inverts the fiction. Measured
 * across the live roster, pure INT made the two characters whose identity is
 * warding (Gabriel, Harvey) 2.48x WORSE at it than the artillery casters. The
 * even blend lands them at 1.03x — dead parity — with no content re-authoring,
 * because a ward is something you conjure (int) and then hold together (wis).
 *
 * ⚠ Wisdom already sets the invest CAP, so it pays twice for barriers. 50/50
 * halves that double-dip rather than removing it; going further (0.6 wis) tips
 * warders past casters and compounds it.
 *
 * @param {object} abilities  actor.system.abilities
 * @param {object} [cfg]      CONFIG override (tests)
 */
export function barrierStatBlend(abilities, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const b = sc.barrier?.blend ?? {};
  const p = Number(abilities?.[b.primary ?? 'intelligence']?.mod) || 0;
  const s = Number(abilities?.[b.secondary ?? 'wisdom']?.mod) || 0;
  return Math.round(p * (b.pw ?? 0.5) + s * (b.sw ?? 0.5));
}

/**
 * The invest curve exponent (config `invest.curveExponent`, default 0.2).
 *
 * ONE exponent governs every commit-more-for-more in the game — spell damage,
 * weapon strikes, spellstrike infusion, and healing once unified. Read from
 * config rather than inlined so the whole economy can be simmed as a unit;
 * the fallback MUST match the config value (a stale fallback silently changes
 * behaviour when the key is renamed — CHANNEL_FACTOR was 1000 vs config 3000).
 */
export function investCurve(cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const v = Number(sc.invest?.curveExponent);
  return Number.isFinite(v) && v > 0 ? v : 0.5;
}

/**
 * Invest-scaled weapon strike damage: blend × mult × windup × (stam/base)^0.2.
 * Preview passes windup 1 (the dialog shows pre-windup numbers today).
 */
export function strikeInvestDamage(statBlend, multiplier, windup, invested, baseStamina, cfg = null) {
  return Math.round(statBlend * multiplier * windup
    * Math.pow(Math.max(invested, 1) / Math.max(baseStamina, 1), investCurve(cfg)));
}

/**
 * Spellstrike fusion infusion: int × coef × (mana/ref)^0.2 (dac55a5 —
 * wis-capped upstream; ref = spellDamageRef, NOT the skill's own baseMana).
 */
export function infusionDamage(intMod, coef, manaInvested, ref, cfg = null) {
  return Math.round(intMod * coef
    * Math.pow(Math.max(manaInvested, 1) / Math.max(ref, 1), investCurve(cfg)));
}

/**
 * Linear over-invest self-damage: potency × (excess/safeInvest), 0 when no
 * excess or no safe band. Shared by both invest dialogs and both real paths.
 */
export function investSelfDamage(potency, invested, baseCost, safeInvest) {
  const excess = Math.max(0, invested - (baseCost + safeInvest));
  if (excess <= 0 || safeInvest <= 0) return 0;
  return Math.round(potency * (excess / safeInvest));
}

/**
 * Effective dodge value: defense.value ÷ dodgeBasisDiv, scramble-penalized.
 * THE number the dodge roll, the defense prompt preview, and the AI
 * auto-policy must all agree on (it was computed inline in all three).
 * @param {Actor} targetActor
 * @param {string} defKey     'melee' | 'ranged'
 * @param {number} stacks     Scramble stacks (caller supplies — it needs
 *                            combat context this pure helper shouldn't).
 * @param {object} [dt]       defenseTuning override.
 * @returns {number}          Unrounded — callers round at display/compare.
 */
export function effectiveDodgeValue(targetActor, defKey, stacks, dt = null) {
  const t = dt ?? (globalThis.CONFIG?.ASPECTSOFPOWER?.defenseTuning ?? {});
  const defVal = (targetActor.system.defense[defKey]?.value ?? 0) / (t.dodgeBasisDiv ?? 1.1);
  return defVal * Math.max(0, 1 - (t.scrambleStackPct ?? 0.15) * stacks);
}

/**
 * Activity duration in ticks (design-celerity-realtime.md step 4).
 *
 *   celerity part = cost x qualityMult x SCALE / mod
 *
 * Identical grammar to `wait = weight x multiplier x SCALE / speed`, because
 * an activity IS an action — just a long one. Clock parts (fixed world time
 * and the high-quality floor) never shrink with stats; the answer is whichever
 * of the three is longest, which makes 'hybrid' fall out for free rather than
 * needing its own branch.
 *
 * @param {number} cost            Activity cost in action points.
 * @param {number} mod             The named stat's mod (the actor's rate).
 * @param {object} [opts]
 * @param {number} [opts.qualityMult]     Quality multiplier (1 = standard).
 * @param {string} [opts.taskClass]       'celerity' | 'clock' | 'hybrid'.
 * @param {number} [opts.clockTicks]      Fixed world-time component, in ticks.
 * @param {number} [opts.clockFloorTicks] Quality floor, in ticks.
 * @param {number} [opts.scale]           SCALE override (tests).
 * @returns {number} Ticks, minimum 1.
 */
export function activityTicks(cost, mod, opts = {}) {
  const SCALE = opts.scale ?? (globalThis.CONFIG?.ASPECTSOFPOWER?.celerity?.SCALE ?? 10000);
  const qualityMult = opts.qualityMult ?? 1;
  const taskClass = opts.taskClass ?? 'celerity';
  const safeMod = Math.max(1, mod);
  // A clock-bound task ignores the performer entirely — glue does not cure
  // faster for a fast smith.
  const celerityPart = taskClass === 'clock' ? 0 : (cost * qualityMult * SCALE) / safeMod;
  return Math.max(1, Math.round(Math.max(
    celerityPart, opts.clockTicks ?? 0, opts.clockFloorTicks ?? 0,
  )));
}

/**
 * Downtime barrier: seconds until the next declared action completes
 * (design-calendar-celestial.md, RULED 2026-07-26 — the clock advances to the
 * SHORTEST outstanding action so whoever finishes first can declare again; a
 * six-hour craft must never block a five-minute lockpick).
 *
 * Lives here rather than in downtime.mjs so it stays importable in plain node
 * for the golden tests — that module reaches Foundry through the activity
 * framework.
 *
 * @param {Array<{endTime:number}>} declarations
 * @param {number} now
 * @returns {number|null} null when nothing is outstanding
 */
export function nextCompletionDelta(declarations, now) {
  const remaining = (declarations ?? [])
    .map(d => d.endTime - now)
    .filter(r => Number.isFinite(r));
  if (!remaining.length) return null;
  // An overdue action (the GM advanced past it by hand) resolves immediately
  // rather than dragging the clock backwards.
  return Math.max(0, Math.min(...remaining));
}

/**
 * Perceive-to-react decision (design-celerity-realtime.md, RULED 2026-07-02).
 * Pure half of celerity.perceiveGate — the caller resolves actors to their
 * build-neutral reference mods and ranks, this decides.
 *
 * Ratings are mod × k for a shared k, so the rating ratio IS the mod ratio;
 * comparing mods avoids dragging the display anchor into a balance decision.
 *
 * @param {number} attackerMod  Attacker's reference mod.
 * @param {number} defenderMod  Defender's reference mod.
 * @param {string} attackerRank Race rank letter (G..S).
 * @param {string} defenderRank Race rank letter (G..S).
 * @param {object} [dt]         defenseTuning override.
 * @returns {{canReact: boolean, ratio: number, waived: boolean, R: number}}
 */
const MORTAL_RANKS = new Set(['G', 'F']);
export function perceiveGateDecision(attackerMod, defenderMod, attackerRank, defenderRank, dt = null) {
  const t = dt ?? (globalThis.CONFIG?.ASPECTSOFPOWER?.defenseTuning ?? {});
  const R = t.perceiveGateRatio ?? 0;
  // R <= 0 disables the gate outright.
  if (!(R > 0)) return { canReact: true, ratio: 1, waived: false, R };
  const waived = (t.perceiveGateMortalBand ?? true)
    && MORTAL_RANKS.has(attackerRank) && MORTAL_RANKS.has(defenderRank);
  const ratio = defenderMod > 0 ? attackerMod / defenderMod : 1;
  return { canReact: waived || ratio <= R, ratio, waived, R };
}

/**
 * Split `total` across `keys` as evenly as possible, last key absorbing the
 * rounding remainder so the parts always sum exactly to total.
 * @param {number} total
 * @param {string[]} keys
 * @returns {Record<string, number>}
 */
export function splitEvenlyWithRemainder(total, keys) {
  const out = {};
  if (!keys.length) return out;
  let assigned = 0;
  for (let i = 0; i < keys.length; i++) {
    const part = (i === keys.length - 1) ? (total - assigned) : Math.round(total / keys.length);
    assigned += part;
    out[keys[i]] = (out[keys[i]] ?? 0) + part;
  }
  return out;
}

/**
 * Weapon-proficiency damage multiplier (design-weapon-proficiencies.md,
 * RULED 2026-07-27: "attach damage of attacks using weapons to weapon
 * proficiency").
 *
 * The proficiency passive's own RARITY is the mastery ladder — the rarity
 * table already opens with not_proficient / neglected / rusty, which is
 * precisely this progression. Anchoring at `common` makes "trained" neutral,
 * so the ladder reads the way its names promise:
 *
 *   not_proficient 0.33x · rusty 0.67x · common 1.00x · legendary 1.67x · divine 2.00x
 *
 * `rarity` null/unknown returns 1. This helper only maps a rarity to a
 * multiplier — the POLICY for what an untrained hand counts as lives in
 * systems/weapon-styles.proficiencyDamageMult, which (since 2026-07-29) treats
 * it as `rusty` for proficiency-tracked actors and neutral for everyone else.
 *
 * @param {string|null} rarity  The proficiency passive's rarity, or null if none.
 * @param {object} [rarities]   skillRarities override (defaults to CONFIG).
 * @param {string} [anchor]     Rarity treated as neutral.
 * @returns {number}
 */
export function proficiencyMultiplier(rarity, rarities = null, anchor = null) {
  const C = globalThis.CONFIG?.ASPECTSOFPOWER ?? {};
  const table = rarities ?? C.skillRarities ?? {};
  const key = anchor ?? C.weaponProficiency?.anchor ?? 'common';
  const anchorMult = table[key]?.mult;
  const ownMult = rarity ? table[rarity]?.mult : null;
  if (!anchorMult || !ownMult) return 1;
  return ownMult / anchorMult;
}

/**
 * Proficiency multiplier for TO-HIT (RULED 2026-07-30: "multiply makes the
 * most sense. reduce it down to a 10% difference between each rank").
 *
 * DELIBERATELY a different, compressed ladder from the damage one. The damage
 * ratio is ~16.7% per tier, and the whole d20 band is only a 1.188x span —
 * simmed (migration/proficiency_tohit_sim.js), the full ratio on to-hit flips
 * the marquee dodge fight from 99% dodged to a coin flip in ONE tier and to
 * near-automatic in two (163r -> 3r -> 0.9r TTK). At 10% per tier the same
 * fight walks 99% -> 77% -> 34% -> saturating only at a legendary-vs-common
 * gap, which is the ruled intent: mastery dominance, without one rank being a
 * light switch.
 *
 * Tier distance is derived from the ladder's fixed 0.1 mult spacing, so
 * rusty = -2 steps (0.8x), uncommon = +1 (1.1x), divine = +6 (1.6x).
 *
 * @param {string|null} rarity   The proficiency passive's rarity, or null.
 * @param {object} [rarities]    skillRarities override (defaults to CONFIG).
 * @param {string} [anchor]      Rarity treated as neutral.
 * @param {number} [perTier]     Hit bonus per tier (config hitPerTier, 0.10).
 * @returns {number}
 */
export function proficiencyHitMultiplier(rarity, rarities = null, anchor = null, perTier = null) {
  const C = globalThis.CONFIG?.ASPECTSOFPOWER ?? {};
  const table = rarities ?? C.skillRarities ?? {};
  const key = anchor ?? C.weaponProficiency?.anchor ?? 'common';
  const per = perTier ?? C.weaponProficiency?.hitPerTier ?? 0.10;
  const anchorMult = table[key]?.mult;
  const ownMult = rarity ? table[rarity]?.mult : null;
  if (!anchorMult || !ownMult || !(per > 0)) return 1;
  const steps = Math.round((ownMult - anchorMult) / 0.1);
  return Math.max(0.1, 1 + per * steps);
}

/**
 * Parry mass ratio (design-weapon-proficiencies.md, RULED 2026-07-27:
 * "it's hard to parry a huge sword").
 *
 * Parry is binary — the defender's roll negates the attack outright when it
 * meets the hit total — and the DEFENDER's weapon weight already feeds their
 * blend. The attacker's weight did nothing, so a dagger turned aside a
 * claymore exactly as well as another claymore did. Live proof before this
 * shipped: Gabriel's dagger parry rolled 993 against Phil's greatsword hit of
 * 956 and simply won.
 *
 * The parry is scaled by the mass ratio of the two weapons:
 *
 *   mult = min(1, (defenderWeight / attackerWeight) ^ k)      k = 0.3
 *
 * CAPPED AT 1: being outmassed is a penalty, but out-massing someone is not a
 * bonus. A claymore is not better at parrying a dagger than a dagger is —
 * light weapons are agile, which is the whole reason the ratio is not
 * symmetric.
 *
 * The defender weight FLOORS at unarmed. Two live actors carry Basic Parry
 * with nothing equipped, and an unfloored ratio would zero their parry
 * outright rather than merely disadvantage it.
 *
 * Emergent and deliberately kept: a greatshield (190) parrying a greatsword
 * (200) lands at x0.98, so shields are the natural answer to heavy weapons
 * without anything special-casing them.
 *
 * @param {number} defenderWeight Weight of the parrying implement.
 * @param {number} attackerWeight Weight of the incoming weapon.
 * @param {object} [cfg]          {parryMassExponent, unarmedWeight} override.
 * @returns {number} Multiplier on the parry total, in (0, 1].
 */
export function parryMassMultiplier(defenderWeight, attackerWeight, cfg = null) {
  const C = globalThis.CONFIG?.ASPECTSOFPOWER ?? {};
  const t = cfg ?? C.defenseTuning ?? {};
  const k = t.parryMassExponent ?? 0.3;
  if (!(k > 0)) return 1;
  const floor = t.unarmedWeight ?? C.weaponWeights?.unarmed ?? 40;
  const dw = Math.max(defenderWeight || 0, floor);
  const aw = Math.max(attackerWeight || 0, floor);
  return Math.min(1, Math.pow(dw / aw, k));
}

/**
 * THE MARGIN RULE (RULED 2026-07-31, design-defense-rework-2026-07).
 *
 * A failed defence is not pass/fail — HOW BADLY you lost decides what fraction
 * gets through. Beaten by a hair, almost nothing lands; beaten badly, nearly
 * everything does. Winning still yields 0, so full avoidance survives as the
 * top of the curve.
 *
 * Replaces the old avoid / graze-0.5 / full three-step, in which two pips of a
 * d20 was the difference between 465 damage and death. It is the SAME shape
 * the mind/soul pool has always used (1 - pool/hit), now applied to every lane.
 *
 * ⚠ The caller MUST apply this AFTER flat armour/DR, not before. Dodge margins
 * are often tiny (9%), and 9% of a blow lands under the armour value, so
 * multiplying first zeroed 25 of 40 live matchups.
 *
 * @param {number} defenceRoll  Dodge/parry roll, or the pool for mental lanes.
 * @param {number} hitTotal     The incoming attack's hit total.
 * @returns {number} 0..1 fraction of damage that survives the defence.
 */
export function defenceMarginMultiplier(defenceRoll, hitTotal) {
  const h = Number(hitTotal) || 0;
  if (h <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - (Math.max(0, Number(defenceRoll) || 0) / h)));
}

/**
 * BRACED PARRY (RULED 2026-07-31, `braced` tag + invest): stamina buys
 * EFFECTIVE weapon weight for the mass ratio only — you set your feet and take
 * the blow on the strong of the blade. It never touches damage, reach or
 * celerity, and `parryMassMultiplier`'s min(1, …) cap still applies, so no
 * amount of bracing lets a dagger out-mass a greataxe; it can only close the
 * gap TO parity.
 *
 * Price of +1x weight is a fraction of the INCOMING HIT TOTAL, not a flat
 * number — the same grammar riders use (cost scales with the blow you are
 * answering), so it stays honest across grades. Bracing against a bigger
 * attack costs more.
 *
 *   effectiveWeight = weight x (1 + scale x invested / (hitFrac x hitTotal))
 *
 * @param {number} weight     Defender's held weapon weight.
 * @param {number} invested   Stamina committed (0 = an ordinary free parry).
 * @param {number} hitTotal   The incoming attack's hit total.
 * @param {number} [scale]    Per-skill efficiency, tagConfig.bracedInvestScale.
 * @param {object} [cfg]      defenseTuning override, for tests.
 * @returns {number} Effective weight, capped at bracedMaxWeightMult x weight.
 */
export function bracedParryWeight(weight, invested, hitTotal, scale = 1, cfg = null) {
  const t = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER?.defenseTuning ?? {});
  const frac = t.bracedCostHitFrac ?? 0.05;
  const maxMult = t.bracedMaxWeightMult ?? 3.0;
  const w = Math.max(0, weight || 0);
  const unit = Math.max(1, frac * Math.max(0, hitTotal || 0));
  const mult = 1 + Math.max(0, scale) * Math.max(0, invested || 0) / unit;
  return w * Math.min(maxMult, mult);
}

/**
 * The stamina that fully brings a parry to PARITY with the attacker's weapon —
 * i.e. the point past which more stamina buys nothing, because the mass ratio
 * is already capped at 1. Used as the invest slider's ceiling so the dialog
 * never offers a wasted point of stamina.
 *
 * Returns 0 when the defender already out-masses the attacker (no prompt).
 *
 * @returns {number} Stamina, clamped to the pool and to bracedMaxWeightMult.
 */
export function bracedMaxUsefulInvest(weight, attackerWeight, hitTotal, pool, scale = 1, cfg = null) {
  const t = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER?.defenseTuning ?? {});
  const frac = t.bracedCostHitFrac ?? 0.05;
  const maxMult = t.bracedMaxWeightMult ?? 3.0;
  const w = Math.max(1, weight || 0);
  const aw = Math.max(0, attackerWeight || 0);
  if (aw <= w || !(scale > 0)) return 0;
  const neededMult = Math.min(maxMult, aw / w);
  const unit = Math.max(1, frac * Math.max(0, hitTotal || 0));
  const need = Math.ceil(((neededMult - 1) / scale) * unit);
  return Math.max(0, Math.min(need, Math.floor(Math.max(0, pool || 0))));
}

/**
 * Lunar phase multiplier (design-calendar-celestial.md, RULED 2026-07-29:
 * lunar rituals are EMPOWERED in their own phase and WEAKENED out of it).
 *
 * Each of the eight named phases sits at a known elongation — new moon at 0
 * degrees, full moon at 180, stepping 45 — so "how far is the sky from this
 * ritual's moon" is a real angle rather than an invented step table:
 *
 *   mult = 1 + amp x cos(delta)
 *
 * Peak at your own phase, trough at the phase opposite it, and a smooth blend
 * between. Three properties that fall out for free rather than being designed:
 * the neighbouring phases are MILDLY empowered, the multiplier moves
 * continuously as the moon does (no cliff when a phase name ticks over), and
 * the trough always lands on the true opposite phase.
 *
 * @param {number} ritualPhaseIndex  0..7, New Moon through Waning Crescent.
 * @param {number} currentElongation Moon-sun elongation in degrees, 0..360.
 * @param {number} [amp]             Swing amplitude; 0.40 = x1.40 down to x0.60.
 * @returns {number}
 */
export function lunarPhaseMultiplier(ritualPhaseIndex, currentElongation, amp = null) {
  // Amplitude lives with the phase list in CONFIG.celestial, so there is one
  // source of truth for the moon rather than two.
  const C = globalThis.CONFIG?.ASPECTSOFPOWER?.celestial ?? {};
  const a = amp ?? C.lunarAmplitude ?? 0.40;
  if (!(a > 0)) return 1;
  if (!Number.isFinite(ritualPhaseIndex) || !Number.isFinite(currentElongation)) return 1;
  const centre = ((ritualPhaseIndex % 8) + 8) % 8 * 45;
  let d = Math.abs(((centre - currentElongation) % 360 + 360) % 360);
  if (d > 180) d = 360 - d;
  return 1 + a * Math.cos(d * Math.PI / 180);
}

/**
 * DoT per-tick damage.
 *
 * RULED 2026-07-30: a rider spawned by a chain sizes off the STRIKE THAT
 * SPAWNED IT, not off its own deliberately-small damage roll. Hemorrhage is
 * the canonical case — it is chained to the strike that caused the bleeding,
 * so a bigger strike bleeds harder.
 *
 * Before this, `_handleDebuffTag` computed the tick from the rider's own roll,
 * which severed the payoff from the setup: a Feint-boosted 1026 strike left
 * exactly the same bleed as an unbuffed one, a flat ~46. Against a DR-256
 * target that is dead at every stack count (3 x 46 = 138 < 256), whereas
 * sizing off the parent gives 3 x 102 = 306 and finally breaks through. The
 * bleed COEFFICIENT was never the problem; the missing parent link was.
 *
 * The `invest` tag still overrides both: those DoTs ride the resource
 * committed to the parent, not any damage number (design-hemorrhage-bleed,
 * design-chained-skills).
 *
 * @param {object} o
 * @param {number} [o.ownDamage]          The rider's own damage roll total.
 * @param {number} [o.parentDamage]       Damage total of the strike that spawned
 *                                        it; 0/absent for a direct cast.
 * @param {number} [o.dotScale]           Fraction of the base that ticks.
 * @param {boolean} [o.hasInvestTag]      Skill carries the `invest` tag.
 * @param {number} [o.investAmount]       Resource committed (parent's, for a rider).
 * @param {number} [o.investScale]        Multiplier on the invested amount.
 * @param {number} [o.defenseMultiplier]  Partial-defense scaling from the parent hit.
 * @returns {number} Rounded per-tick damage, never negative.
 */
/**
 * Stamina charged when a RIDER fires off your own attack (config.riders).
 *
 * Keyed to the parent's DAMAGE, not its hit total — see the riders config
 * block for why. Rounded up so a rider is never free, and floored at 1 so a
 * zero-damage parent still costs something rather than becoming an infinite
 * proc engine.
 *
 * @param {number} parentDamage  Damage total of the attack that triggered it.
 * @param {number} [frac]        Fraction of that damage to charge.
 * @returns {number} Stamina cost, minimum 1.
 */
export function procStaminaCost(parentDamage, frac = null) {
  const C = globalThis.CONFIG?.ASPECTSOFPOWER?.riders ?? {};
  const f = frac ?? C.procCostDamageFrac ?? 0.20;
  if (!(f > 0)) return 0;
  return Math.max(1, Math.ceil(Math.max(0, parentDamage) * f));
}

/**
 * THE base a rider's magnitude sizes off.
 *
 * A rider is caused by the blow that spawned it, so a bigger strike bleeds
 * harder and crushes more armour (RULED 2026-07-30). A DIRECT cast has no
 * parent and falls back to its own roll.
 *
 * Shared by every rider magnitude — bleed ticks and armour crush both call it —
 * so the two can never drift apart the way they had before this existed:
 * dotTickDamage preferred the parent while crush silently used its own roll.
 *
 * @param {number} parentDamage  Damage of the attack that spawned the rider; 0 if direct.
 * @param {number} ownDamage     The rider's own damage roll.
 * @returns {number}
 */
export function riderDamageBase(parentDamage = 0, ownDamage = 0) {
  return parentDamage > 0 ? parentDamage : Math.max(0, ownDamage);
}

export function dotTickDamage({
  ownDamage = 0, parentDamage = 0, dotScale = 0.1, hasInvestTag = false,
  investAmount = 0, investScale = 1, defenseMultiplier = 1,
} = {}) {
  if (hasInvestTag) {
    return Math.max(0, Math.round(investScale * Math.max(0, investAmount) * defenseMultiplier));
  }
  const base = riderDamageBase(parentDamage, ownDamage);
  return Math.max(0, Math.round(base * dotScale * defenseMultiplier));
}

/**
 * FLAT armour reduction a crush debuff stores at apply time.
 *
 * Exact structural twin of dotTickDamage — same `invest`-tag override, same
 * riderDamageBase fallback — because crush and bleed are the same subsystem
 * wearing different hats, and the one time they were written separately they
 * drifted (crush used its own roll while the bleed used the parent's).
 *
 * With the `invest` tag the amount rides the stamina COMMITTED to the crush
 * rather than a fixed slice of the parent blow. At crushInvestScale 1.0 and the
 * shipped procCostFrac 0.05 the base-invest result equals crushDamageFrac 0.05
 * × parent exactly, so tagging an existing crush changes nothing until the
 * player chooses to lean on it.
 *
 * @param {object} o
 * @param {boolean} [o.enabled]        armorCrushVal > 0 — the ON gate.
 * @param {boolean} [o.hasInvestTag]   Skill carries the `invest` tag.
 * @param {number}  [o.investAmount]   Stamina committed to this proc.
 * @param {number}  [o.investScale]    Armour removed per point invested.
 * @param {number}  [o.crushFrac]      Fallback fraction of the base damage.
 * @param {number}  [o.parentDamage]   Damage of the strike that spawned it.
 * @param {number}  [o.ownDamage]      The crush skill's own roll.
 * @returns {number} Absolute armour reduction, never negative.
 */
export function crushFlatAmount({
  enabled = true, hasInvestTag = false, investAmount = 0, investScale = 1,
  crushFrac = 0.05, parentDamage = 0, ownDamage = 0,
} = {}) {
  if (!enabled) return 0;
  // An invest of 0 means no commitment was RECORDED (a direct cast of a rider
  // passive, a zero-cost parent), not "crush nothing". Falling through to the
  // damage-anchored branch keeps a crush that reaches a target from silently
  // applying an effect worth zero armour — the no-op failure class this
  // codebase keeps rediscovering. The DoT tick deliberately does NOT do this:
  // a bleed with nothing invested legitimately ticks for nothing.
  if (hasInvestTag && investAmount > 0) {
    return Math.max(0, Math.round(investScale * investAmount));
  }
  return Math.max(0, Math.round(crushFrac * riderDamageBase(parentDamage, ownDamage)));
}

/** Kilograms to pounds. carryCapacity is in POUNDS; densities are kg/L. */
export const KG_TO_LB = 1 / 0.45359237;

/**
 * Physical weight of an item, in POUNDS: volume x density.
 *
 *   armour  -> volume from the slot (shields resolve by TAG, not slot)
 *   weapons -> volume from weaponWeights / weaponVolumeDivisor, so mass can
 *              never drift from the weight already driving celerity/windup
 *
 * Density is a per-MATERIAL authored value and is deliberately NOT derived
 * from rarity — a crude fulgurite helm and a masterwork one weigh the same
 * (design-item-weight.md, RULED 2026-07-30).
 *
 * Returns 0 for anything with no resolvable volume (jewelry, consumables,
 * profession tools), so callers can leave those alone rather than zeroing an
 * authored value.
 *
 * @param {object} o
 * @param {string} [o.slot]      item.system.slot
 * @param {string} [o.material]  item.system.material (the CLASS)
 * @param {string} [o.species]   item.system.materialSpecies, if known
 * @param {string[]} [o.tags]    item.system.tags (shield + weapon-type detection)
 * @param {object} [o.cfg]       CONFIG.ASPECTSOFPOWER override, for tests
 * @returns {number} pounds, rounded to 1dp; 0 when no volume applies.
 */
export function itemWeightLb({ slot = '', material = '', species = '', tags = [], cfg = null } = {}) {
  const C = cfg ?? globalThis.CONFIG?.ASPECTSOFPOWER ?? {};
  const vols = C.slotVolume ?? {};
  const wWeights = C.weaponWeights ?? {};
  const div = C.weaponVolumeDivisor ?? 100;

  // A shield is a shield wherever it is slotted — they live in `weaponry`.
  // JEWELLERY HAS NO VOLUME MODEL. A circlet occupies the head slot but is
  // ornament, not a helmet's worth of material — pricing it by slot volume put
  // Willy's mana diadem at 46 lb. Anything on this list keeps whatever weight
  // was authored for it instead.
  if ((C.volumelessMaterials ?? ['jewelry']).includes(material)) return 0;

  const isShield = tags.includes('shield') || tags.includes('greatshield') || tags.includes('buckler');
  let litres = 0;
  if (isShield) litres = vols.shield ?? 0;
  else if (vols[slot] != null) litres = vols[slot];
  else if (slot === 'weaponry') {
    // Heaviest matching weapon type wins, mirroring how blockDR and celerity
    // pick a type off the same table.
    let best = 0;
    for (const t of tags) if (wWeights[t] != null && wWeights[t] > best) best = wWeights[t];
    litres = best > 0 ? best / Math.max(1, div) : 0;
  }
  if (!(litres > 0)) return 0;

  // `species ? ... : undefined` deliberately, NOT `species && ...` — an empty
  // species would evaluate to '' , and `??` does not fall through on '' (only
  // on null/undefined), so every lookup silently returned 0.
  const density = (species ? (C.materialSpeciesDensity ?? {})[species] : undefined)
    ?? (C.materialDensity ?? {})[material]
    ?? (C.materialDensity ?? {}).metal
    ?? 0;
  if (!(density > 0)) return 0;
  return Math.round(litres * density * KG_TO_LB * 10) / 10;
}

/**
 * Total pounds an actor is actually carrying, given spatial storage.
 *
 * An item is weightless only while the storage holding it is BOTH present and
 * EQUIPPED — an unequipped ring is a ring, not a portal, so its contents come
 * crashing back onto your back. That is also what stops "store the storage"
 * from laundering weight away: a nested storage that is not itself equipped
 * carries its contents normally.
 *
 * @param {Array<{id:string, weight:number, quantity:number, storedIn:string}>} items
 * @param {Set<string>|Array<string>} equippedStorageIds  ids of EQUIPPED storages
 * @returns {number} pounds carried, 1dp
 */
export function carriedWeightLb(items = [], equippedStorageIds = []) {
  const live = equippedStorageIds instanceof Set ? equippedStorageIds : new Set(equippedStorageIds);
  let total = 0;
  for (const it of items) {
    if (it.storedIn && live.has(it.storedIn)) continue;
    total += (Number(it.weight) || 0) * (it.quantity ?? 1);
  }
  return Math.round(total * 10) / 10;
}

/**
 * Ceiling on an `invest`-tagged rider's commitment: `mult` × its base cost,
 * clamped to the pool, never below the base. On the heaviest hitters the POOL
 * binds first, which is the decision worth having (config.riders.maxInvestMult).
 *
 * @param {number} baseCost  procStaminaCost for this proc.
 * @param {number} pool      Current stamina.
 * @param {number} [mult]    Multiple of base allowed; defaults to config.
 * @returns {number}
 */
export function riderMaxInvest(baseCost, pool, mult = null) {
  const C = globalThis.CONFIG?.ASPECTSOFPOWER?.riders ?? {};
  const m = mult ?? C.maxInvestMult ?? 3.0;
  return Math.max(baseCost, Math.min(Math.max(0, pool), Math.floor(baseCost * m)));
}

/**
 * Aura radius in feet: the skill's authored radius STRETCHED by perception.
 *
 * ⚠ MULTIPLICATIVE ON THE AUTHORED BASE, not the memo's `Per_mod x factor`.
 * A pure product has no base term, so it would pass perception's full 68x
 * roster spread (per.mod 15 to 1029) straight through and hand low-level
 * characters a one-foot aura. Every other range in this game has a floor —
 * `castingRange` is `40 + per.mod/10` for exactly this reason.
 *
 * ⚠ AND NOT ADDITIVE EITHER, which is the tempting move because it mirrors
 * castingRange. Measured against real party clustering (median ally spacing
 * 9-35 ft on the combat maps, 50-95 ft on the sprawling ones), an additive
 * `base + per.mod/10` reaches 69 ft at the CURRENT main cast's perception
 * (John 463, Willy 494, Gabriel 497, Phil 514) — a 138 ft bubble that covers a
 * whole 200x150 map, so the aura stops being a positioning decision at the
 * level the party is already at. Worse, the flat term swamps the authored
 * number: Storm Stride's deliberately tight 10 ft and Mana Attraction's 20 ft
 * converge to 60 and 66, collapsing a 2:1 identity to 1.1:1.
 *
 * Multiplicative keeps that ratio at 2:1 at every perception, makes the
 * authored radius a FLOOR rather than a rounding error, and spans a modest ~2x
 * across the whole roster (20 ft to 41 ft on a 20 ft aura).
 *
 * @param {number} authoredRadius  tagConfig.auraRadius, in feet. 0 = no aura.
 * @param {number} perMod          Caster's perception mod.
 * @param {object} [cfg]           CONFIG override (tests)
 * @returns {number} Radius in feet, rounded. 0 stays 0.
 */
export function auraRadiusFor(authoredRadius, perMod, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const base = Math.max(0, Number(authoredRadius) || 0);
  if (base <= 0) return 0;
  const d = Number(sc.auras?.perceptionDivisor);
  const div = Number.isFinite(d) && d > 0 ? d : 1000;
  const per = Math.max(0, Number(perMod) || 0);
  return Math.round(base * (1 + per / div));
}

/**
 * Aura tick period in clock ticks: one Nth of the caster's reference round.
 *
 * @param {number} refRoundLen  referenceRoundLength(casterRL)
 * @param {object|null} cfg
 * @returns {number}  0 when the cadence is disabled or nonsensical
 */
export function auraTickPeriod(refRoundLen, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const n = Number(sc.auras?.ticksPerReferenceRound);
  const per = Number(refRoundLen);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (!Number.isFinite(per) || per <= 0) return 0;
  return per / n;
}

/**
 * WHICH MOMENTS does an aura owe between its last payout and the new clock?
 *
 * Returns the actual tick MOMENTS, not just a count, because each one is a
 * separate position sample — the whole point of the cadence. A caller that
 * only wanted `owed x perTick` would pay an ally who left early in full and
 * pay nothing to one who arrived late.
 *
 * `lastTick` null/undefined means "never paid": we seed to `newClock` and owe
 * nothing, so an aura cast mid-round does not immediately dump a backlog.
 *
 * @param {number|null} lastTick
 * @param {number} newClock
 * @param {number} period      from auraTickPeriod
 * @param {object|null} cfg
 * @returns {{moments:number[], newLastTick:number, capped:boolean}}
 */
export function auraTickMoments(lastTick, newClock, period, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const clock = Number(newClock);
  if (!Number.isFinite(clock)) return { moments: [], newLastTick: 0, capped: false };
  if (!Number.isFinite(period) || period <= 0) {
    return { moments: [], newLastTick: Number(lastTick) || clock, capped: false };
  }
  // ⚠ TEST null/undefined BEFORE Number(). `Number(null)` is 0 and
  // `Number.isFinite(0)` is TRUE, so a finite-check alone treats an unseeded
  // aura as "last paid at tick 0" and owes it the entire history of the
  // combat. The same trap already cost this codebase a silently-dead buff-cap
  // fallback; caught here by the golden test rather than in play.
  const unseeded = lastTick === null || lastTick === undefined || lastTick === '';
  const last = Number(lastTick);
  // Unseeded, or a clock that moved BACKWARD (reset / manual rewind): resync
  // silently rather than paying a negative or enormous backlog.
  if (unseeded || !Number.isFinite(last) || last > clock) {
    return { moments: [], newLastTick: clock, capped: false };
  }
  const maxN = Math.max(0, Math.round(Number(sc.auras?.maxCatchUpTicks) || 0)) || Infinity;
  const owedRaw = Math.floor((clock - last) / period);
  if (owedRaw <= 0) return { moments: [], newLastTick: last, capped: false };
  const owed = Math.min(owedRaw, maxN);
  const moments = [];
  for (let i = 1; i <= owed; i++) moments.push(last + i * period);
  // When capped we RESYNC to the clock rather than leaving the remainder
  // owed — otherwise every later advance keeps paying a stale backlog.
  const newLastTick = (owed < owedRaw) ? clock : last + owed * period;
  return { moments, newLastTick, capped: owed < owedRaw };
}

/**
 * KI POOL MAXIMUM from endurance (ruled 2026-08-05).
 *
 * Ki is a RESOURCE, not stacks — it carries no per-cast payload, is spent at
 * varying costs by many abilities, and wants the existing cost / affordability
 * / bar machinery that pools already have. The bar is deliberately SMALL: ki
 * funds big abilities, it is not a second mana pool.
 *
 * ⚠ The `ki` TAG decides whether anyone has this at all — the caller passes 0
 * for an untagged actor, and a 0 max is what keeps the resource invisible.
 *
 * @param {number} enduranceMod
 * @param {object|null} cfg
 * @returns {number}
 */
export function kiMaxFor(enduranceMod, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const div = Number(sc.ki?.capDivisor) > 0 ? Number(sc.ki.capDivisor) : 60;
  const hardMax = Math.max(0, Math.round(Number(sc.ki?.capMax ?? 10)));
  const mod = Number(enduranceMod);
  if (!Number.isFinite(mod) || mod <= 0) return 0;
  return Math.max(0, Math.min(hardMax, Math.round(mod / div)));
}

/**
 * STAT-DERIVED STACK CAP (ki monk, user ruled 2026-08-05: "it just needs a cap
 * likely tied to endurance").
 *
 * `tagConfig.stackCap` is a hand-authored constant, which cannot express "your
 * ki ceiling grows with your endurance". This turns an ability MOD into a stack
 * ceiling via a divisor, so a stat in the hundreds becomes a pool in the
 * single digits — stacks are counted objects, not a resource bar.
 *
 * Returns 0 when no stat is named, which the caller reads as "use the authored
 * `stackCap`" — so this is purely additive and every existing producer is
 * unchanged.
 *
 * @param {number} statMod    e.g. endurance.mod
 * @param {number} authored   tagConfig.stackCap, the fallback / floor
 * @param {object|null} cfg
 * @returns {number}
 */
export function statStackCap(statMod, authored = 0, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const divisor = Number(sc.stacks?.statCapDivisor);
  const div = Number.isFinite(divisor) && divisor > 0 ? divisor : 150;
  const floor = Math.max(0, Math.round(Number(authored) || 0));
  const mod = Number(statMod);
  if (!Number.isFinite(mod) || mod <= 0) return floor;
  const hardMax = Math.max(1, Math.round(Number(sc.stacks?.statCapMax) || 10));
  // Never BELOW the authored value: an author who wrote 3 meant at least 3.
  return Math.max(floor, Math.min(hardMax, Math.round(mod / div)));
}

/* ------------------------------------------------------------------ */
/*  Buff capacity (design-healer-system.md, healer pillar phase 6)      */
/* ------------------------------------------------------------------ */

/**
 * How much external augmentation a body can carry: a fraction of the sum of
 * its nine ability VALUES.
 *
 * ⚠ VALUE SPACE, NOT MOD SPACE — the design memo says "sum of all 9 calculated
 * mods", but every buff in the game is written as `system.<stat>.value` with an
 * additive change, so cost is only commensurable with capacity in value space.
 * Measuring in mod space would also make the same buff cost a different amount
 * on every recipient (mod is concave in value), so a healer could not know what
 * a spell costs before casting it. Cost is a property of the BUFF; that only
 * holds here.
 *
 * The concavity then works in the game's favour for free: because
 * `mod ~ value^0.8`, a buff worth +20% of your values is only about +15.7% of
 * your power, so the cap is slightly tighter in practice than it reads.
 *
 * ⚠⚠ MOD SPACE, NOT VALUE SPACE (user ruled 2026-08-03: "otherwise this won't
 * scale"). Buffs are WRITTEN as raw stat values, but nothing in combat reads a
 * raw value — HP, mana, damage and every defence are computed from mods. A
 * budget denominated in values is denominated in a unit with no gameplay
 * meaning, and because `mod` carries a `1.25^gradeIndex` term, the same
 * value-delta buys wildly different power at grade G than at grade S. A
 * value-space cap would silently change what it is worth as the game extends
 * past grade E.
 *
 * It also fixes a unit mismatch rather than creating one: defence stats are
 * DERIVED from mods, so a defence point and a mod point are the same scale,
 * where a defence point and a raw ability point are not.
 *
 * ⚠⚠ AND MEASURED FROM THE UNBUFFED BODY. Buffs are written into ability
 * values, so sizing the cap off current values makes it self-referential:
 * live-measured, a 326-point buff raised Faye's ability sum from 1631 to 1957
 * and her capacity from 326 to 391. It converges rather than running away (to
 * `frac/(1-frac)`), but a cap that moves when you push on it is not a cap.
 *
 * ⚠ The consequence to accept: because the curve is concave, the SAME buff
 * costs less on a target who already has that stat high. Cost is a property of
 * the pairing, not of the buff alone — a healer cannot know the price without
 * knowing the target. That is the honest price of measuring real power.
 *
 * @param {number} unbuffedModTotal  Sum of the nine mods with buffs removed.
 * @param {object} [cfg]             CONFIG override (tests)
 * @returns {number} Capacity in mod points.
 */
export function buffCapacity(unbuffedModTotal, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const f = Number(sc.buffCap?.fraction);
  const frac = Number.isFinite(f) && f > 0 ? f : 0.20;
  return Math.round(Math.max(0, Number(unbuffedModTotal) || 0) * frac);
}

/**
 * The stat-curve modifier for one ability value (design-stat-curves.md):
 *   mod = round((value/NORM)^P x NORM x gradeMult)
 *
 * Extracted from the `calcMod` closure in actor.prepareDerivedData so the buff
 * cap can price a hypothetical value without re-deriving an actor. The actor
 * uses this same function, so the two cannot drift.
 */
export function abilityMod(value, gradeMult = 1, cfg = null) {
  const sc = (cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {})).statCurve ?? {};
  const NORM = Number(sc.NORM) || 1085;
  const P = Number.isFinite(Number(sc.P)) ? Number(sc.P) : 0.8;
  const v = Math.max(0, Number(value) || 0);
  return Math.round(Math.pow(v / NORM, P) * NORM * (Number(gradeMult) || 1));
}

/** Grade multiplier for a race rank: MULT_BASE ^ gradeIndex[rank]. */
export function gradeMultiplierFor(rank, cfg = null) {
  const sc = (cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {})).statCurve ?? {};
  const base = Number(sc.MULT_BASE) || 1.25;
  const idx = Number(sc.gradeIndex?.[rank]) || 0;
  return Math.pow(base, idx);
}

/**
 * Sum of the nine ability mods, with optional per-ability value deltas applied
 * before the curve. Deltas may be negative — that is how the unbuffed basis is
 * computed, by subtracting the points currently on loan from buffs.
 *
 * ⚠ The curve is applied PER ABILITY, then summed. Summing values first and
 * curving once would be a different (and wrong) number, because `x^0.8` is not
 * additive.
 *
 * @param {object} abilities   actor.system.abilities
 * @param {object} [deltaByKey] e.g. { strength: 200, wisdom: -115 }
 * @param {number} [gradeMult]
 * @param {object} [cfg]
 */
export function abilityModTotal(valuesByKey, gradeMult = 1, factorByKey = null, cfg = null) {
  let sum = 0;
  for (const [k, v] of Object.entries(valuesByKey ?? {})) {
    const f = Number(factorByKey?.[k]);
    sum += Math.round(abilityMod(v, gradeMult, cfg) * (Number.isFinite(f) ? f : 1));
  }
  return sum;
}

/**
 * Per-ability post-curve factor: how far the actor's LIVE mod sits from what
 * the curve alone would give. Size scaling multiplies a large creature's
 * strength after the curve, so rebuilding a total from values alone silently
 * disagrees with the actor — measured on Phil (large), capacity read 731
 * against a true 755.
 *
 * ⚠ COMPUTE THIS ONCE, FROM THE REAL ACTOR, AND PASS IT AROUND. Deriving the
 * factor inside the total function looks equivalent and is not: any caller that
 * asks about a HYPOTHETICAL value (a re-cast priced without its own previous
 * application) hands over a lowered value beside an unlowered mod, and the
 * ratio then swallows the buff instead of the size scaling. That mis-priced a
 * +100 strength buff at 704 mod against a true 145.
 *
 * @returns {object} e.g. { strength: 1.2, wisdom: 1 }
 */
export function abilityPostCurveFactors(abilities, gradeMult = 1, cfg = null) {
  const out = {};
  for (const [k, a] of Object.entries(abilities ?? {})) {
    const curved = abilityMod(Number(a?.value) || 0, gradeMult, cfg);
    const actual = Number(a?.mod);
    out[k] = (Number.isFinite(actual) && curved > 0) ? actual / curved : 1;
  }
  return out;
}

/** Plain {key: value} map of ability values, the input abilityModTotal wants. */
export function abilityValues(abilities, deltaByKey = null) {
  const out = {};
  for (const [k, a] of Object.entries(abilities ?? {})) {
    out[k] = (Number(a?.value) || 0) + (Number(deltaByKey?.[k]) || 0);
  }
  return out;
}

/**
 * Split a change list into per-ability value points, keyed by ability name.
 * Positives only — a buff that lowers a stat does not earn budget back.
 *
 * @returns {object} e.g. { intelligence: 243, willpower: 229 }
 */
export function buffLoadByAbility(changes) {
  const out = {};
  for (const c of changes ?? []) {
    const key = String(c?.key ?? '');
    if (!key.startsWith('system.abilities.') || !key.endsWith('.value')) continue;
    const name = key.slice('system.abilities.'.length, -'.value'.length);
    const v = Math.max(0, Number(c?.value) || 0);
    if (v > 0) out[name] = (out[name] ?? 0) + v;
  }
  return out;
}

/** Flat defence-stat points in a change list (already mod-scale). */
export function buffDefenceCost(changes) {
  return buffCost(changes, { buffCap: { countedKeyPrefixes: ['system.defense.'] } });
}

/**
 * What an incoming buff costs, in mod points, ON THIS TARGET AS THEY STAND.
 *
 * Marginal by construction: the ability half is the mod the target GAINS on top
 * of what they already have, so piling buff after buff onto one stat gets
 * steadily more expensive as the curve flattens. That falls out of the maths
 * rather than needing a rule.
 *
 * @param {object} valuesByKey  Target's ability VALUES as the buff would land on.
 * @param {object} factorByKey  abilityPostCurveFactors from the real actor.
 * @param {Array}  changes      The incoming buff's changes.
 * @param {number} gradeMult
 * @param {object} [cfg]
 * @returns {number} Cost in mod points.
 */
export function buffModCost(valuesByKey, factorByKey, changes, gradeMult = 1, cfg = null) {
  const deltas = buffLoadByAbility(changes);
  const after = {};
  for (const [k, v] of Object.entries(valuesByKey ?? {})) {
    after[k] = v + (Number(deltas[k]) || 0);
  }
  const gain = abilityModTotal(after, gradeMult, factorByKey, cfg)
             - abilityModTotal(valuesByKey, gradeMult, factorByKey, cfg);
  return Math.max(0, gain) + buffDefenceCost(changes);
}

/**
 * Largest scale in [0,1] whose scaled buff still fits `room` mod points.
 *
 * ⚠ SOLVED, NOT DIVIDED. `room / cost` is the right answer only when cost is
 * linear in the change values, and it is not — the ability half runs through a
 * concave curve, so halving the values removes LESS than half the mod. Dividing
 * would consistently overshoot the cap. Twenty bisection steps land within
 * ~1e-6, which is far finer than the whole-point rounding downstream.
 */
export function solveBuffScale(valuesByKey, factorByKey, changes, gradeMult, room, cfg = null) {
  const full = buffModCost(valuesByKey, factorByKey, changes, gradeMult, cfg);
  if (full <= 0) return 1;
  if (room >= full) return 1;
  if (room <= 0) return 0;
  const scaled = (s) => buffModCost(
    valuesByKey, factorByKey,
    (changes ?? []).map(c => ({ ...c, value: Math.round((Number(c.value) || 0) * s) })),
    gradeMult, cfg);
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (scaled(mid) <= room) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * What a buff costs against that capacity: the sum of every stat point it adds.
 *
 * Counts ability AND defence bonuses in ONE pool. A point of armour and a point
 * of strength are not the same kind of thing, but they are the same kind of
 * GIFT — this budget asks "how much borrowed power are you carrying", and the
 * alternative (abilities only) exempts six of the twelve live buffs including
 * the single most extreme one in the world (Splinter Guard, +582 armour onto a
 * base of 25).
 *
 * ⚠ Only POSITIVE contributions count. A buff that also lowers a stat does not
 * earn budget back, or a "+800 str / -800 dex" change would be free.
 *
 * @param {Array<{key: string, value: number}>} changes  ActiveEffect changes.
 * @param {object} [cfg]  CONFIG override (tests)
 * @returns {number} Cost in stat points.
 */
export function buffCost(changes, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const prefixes = sc.buffCap?.countedKeyPrefixes
    ?? ['system.abilities.', 'system.defense.'];
  let sum = 0;
  for (const c of changes ?? []) {
    const key = String(c?.key ?? '');
    // `.value` only: `system.defense.melee.pool` is a dice pool, not a stat.
    if (!key.endsWith('.value')) continue;
    if (!prefixes.some(p => key.startsWith(p))) continue;
    sum += Math.max(0, Number(c?.value) || 0);
  }
  return Math.round(sum);
}

/**
 * Decide what actually lands when a buff meets the recipient's capacity.
 *
 * Two outcomes, chosen by the RECIPIENT (not the caster):
 *  - `acceptOvercap` OFF (default): the buff TRUNCATES to whatever room is
 *    left. `scale` is the factor to multiply every change value by.
 *  - `acceptOvercap` ON: the buff lands in full and the overflow is paid for
 *    in flat HP, on apply, once.
 *
 * ⚠ `excess` is the part of THIS buff that did not fit (`cost − room`), not
 * `usage_after_apply − capacity` as the memo's formula reads. They agree on the
 * first buff (room = capacity when nothing is loaded), but the memo's version
 * re-charges previously-paid overflow on every subsequent application, so
 * stacking three small buffs past the cap would cost far more than one big one
 * of the same total. Per-application is what the memo's own trigger rule
 * ("one-time per buff application") describes.
 *
 * @param {object}  args
 * @param {number}  args.capacity       buffCapacity(recipient).
 * @param {number}  args.used           Cost of buffs already loaded.
 * @param {number}  args.cost           buffCost(incoming).
 * @param {boolean} args.acceptOvercap  Recipient's toggle.
 * @param {object} [cfg]  CONFIG override (tests)
 * @returns {{scale: number, applied: number, excess: number,
 *            strainDamage: number, truncated: boolean}}
 */
export function resolveBuffLoad({ capacity = 0, used = 0, cost = 0,
                                  acceptOvercap = false, scale = null } = {},
                                cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const rate = Number(sc.buffCap?.overcapDamageRate);
  const dmgRate = Number.isFinite(rate) && rate >= 0 ? rate : 0.20;

  const cap  = Math.max(0, Number(capacity) || 0);
  const load = Math.max(0, Number(used) || 0);
  const want = Math.max(0, Number(cost) || 0);
  const none = { scale: 1, applied: 0, excess: 0, strainDamage: 0, truncated: false };
  if (want <= 0) return none;

  const room = Math.max(0, cap - load);
  if (want <= room) {
    return { scale: 1, applied: want, excess: 0, strainDamage: 0, truncated: false };
  }

  const excess = want - room;
  if (acceptOvercap) {
    return { scale: 1, applied: want, excess,
             strainDamage: Math.round(excess * dmgRate), truncated: false };
  }
  // Truncate. The caller passes a SOLVED scale (solveBuffScale) because cost is
  // concave in the change values — `room / want` would overshoot. Falling back
  // to that ratio only when no scale is supplied keeps the pure function usable
  // on its own for the linear (defence-only) case.
  // ⚠ `scale == null` explicitly, NOT Number.isFinite(Number(scale)) —
  // `Number(null)` is 0, which is finite, so the fallback would never fire and
  // every un-scaled truncation would silently apply nothing.
  const s = (scale == null || !Number.isFinite(Number(scale)))
    ? room / want
    : Math.max(0, Math.min(1, Number(scale)));
  return { scale: s, applied: room, excess: 0, strainDamage: 0, truncated: true };
}

/**
 * Alteration damage factor — Π(1 + dmgMod), the multiplicative form ruled in
 * design-dmgmod-multiplicative.md and shipped `300ce09`.
 *
 * ⚠⚠ EXTRACTED 2026-08-06 BECAUSE THE PREVIEW HAD NEVER FOLLOWED THE SHIP.
 * `_resolveRarityMods` went multiplicative in `300ce09`; the skill-upgrade
 * dialog kept summing dmgMods ADDITIVELY and adding the sum to the rarity
 * multiplier. The two agree only when rarityMult is exactly 1.0 and one
 * alteration is present — which is why nobody caught it. At common (0.6) with
 * `aoe` (-0.20) the dialog previewed 0.40 against a real 0.48, understating by
 * 17%, and a POSITIVE dmgMod makes the gap far worse (0.6 + 0.5 = 1.10
 * previewed against a real 0.6 x 1.5 = 0.90).
 *
 * Both callers now go through here. See playbook-damage-measurement: a preview
 * that does not call the same function as the real path is a lie the player
 * commits resources against.
 *
 * @param {number[]} dmgMods  per-alteration dmgMod values (may be +/-)
 * @returns {number}
 */
export function alterationDamageFactor(dmgMods) {
  let factor = 1;
  for (const m of dmgMods ?? []) {
    const n = Number(m);
    if (!Number.isFinite(n)) continue;
    factor *= 1 + n;
  }
  return Math.max(0, factor);
}

/**
 * The full effect multiplier a skill applies to its roll.
 *
 *   effective = rarityMult x Π(1 + authored dmgMod) x Π(situational mult)
 *
 * ⚠ THE SITUATIONAL TERMS ARE A LIST, NOT NAMED PARAMETERS. They used to be
 * `profMult` and `lunarMult` positional args, which meant this function had to
 * know the name of every engine-evaluated modifier that would ever exist —
 * and every new one (stealth, terrain, elevation) was another signature change
 * plus another hardcoded term in `Item#_resolveRarityMods`. See
 * systems/situational-mods.mjs for the registry that produces this list.
 *
 * Never negative — a stack of penalties bottoms out at zero rather than
 * flipping the sign of the damage.
 *
 * @param {number} rarityMult
 * @param {number[]} dmgMods            authored alteration dmgMods (Π(1 + m))
 * @param {number[]} [situationalMults] engine-evaluated multipliers (Π m)
 * @returns {number}
 */
export function effectiveDamageMultiplier(rarityMult, dmgMods, situationalMults = []) {
  const r = Number(rarityMult);
  let sit = 1;
  for (const m of situationalMults ?? []) {
    // ⚠⚠ TEST null/undefined BEFORE Number(). `Number(null)` is 0 and
    // `Number.isFinite(0)` is TRUE, so the obvious finite-check lets a null
    // through as a ZERO and silently deletes ALL of the skill's damage.
    // The neutral value differs between the two halves of this formula and
    // that is exactly what makes this trap easy to walk into:
    //   authored dmgMods  -> neutral is 0 (they are 1 + m)
    //   situational mults -> neutral is 1 (they multiply directly)
    // So a missing entry must become 1 here, never 0. Caught by a golden test
    // the first time this function was written; the same trap previously ate
    // `auraTickMoments` (see design-aura-ticks).
    if (m === null || m === undefined || m === '') continue;
    const n = Number(m);
    if (!Number.isFinite(n)) continue;
    sit *= n;
  }
  return Math.max(0, (Number.isFinite(r) ? r : 0)
    * alterationDamageFactor(dmgMods)
    * Math.max(0, sit));
}

/**
 * CLASH: a damage-versus-damage counter. Both sides commit a blow, the larger
 * one wins, and only the DIFFERENCE lands — on the loser.
 *
 * Ruled 2026-08-07 for the Destroyer Monk's explosive counter ("whoever would
 * inflict more damage wins"). Every other reaction in this system reduces or
 * redirects a hit; this is the first that can turn one around.
 *
 * The shape matters and is deliberately symmetric:
 *
 *   defender wins  -> incoming fully negated, attacker eats (clash − incoming)
 *   attacker wins  -> defender eats (incoming − clash), attacker untouched
 *   dead heat      -> both blows cancel and nobody takes anything
 *
 * ⚠ IT RETURNS A MULTIPLIER, NOT A SUBTRACTION, for the defender's side. The
 * caller's whole mitigation chain (armour, DR, margin) is expressed as
 * `damageMultiplier`, so handing back a flat "reduce by N" would either
 * double-count the wall or bypass it depending on where it was applied. As a
 * fraction of the incoming hit it composes with everything already there.
 *
 * ⚠ `attackerTakes` is RAW and deliberately so. It is the excess force of a
 * blow that already beat the incoming attack outright; running it back through
 * the attacker's own armour would let a heavily-armoured attacker clash for
 * free, which is precisely the trade this reaction exists to refuse.
 *
 * @param {number} incomingDamage  the attack's damage before this reaction
 * @param {number} clashDamage     the defender's counter-blow damage
 * @returns {{winner:'defender'|'attacker'|'tie', defenderTakes:number,
 *            attackerTakes:number, damageMultiplier:number}}
 */
export function clashOutcome(incomingDamage, clashDamage) {
  const inc = Math.max(0, Number(incomingDamage) || 0);
  const cls = Math.max(0, Number(clashDamage) || 0);

  // Nothing incoming: there is no blow to meet, so the counter has nothing to
  // beat and lands nothing. Guards the 0/0 division below too.
  if (inc <= 0) {
    return { winner: 'tie', defenderTakes: 0, attackerTakes: 0, damageMultiplier: 0 };
  }
  if (cls > inc) {
    return { winner: 'defender', defenderTakes: 0,
             attackerTakes: cls - inc, damageMultiplier: 0 };
  }
  if (cls === inc) {
    return { winner: 'tie', defenderTakes: 0, attackerTakes: 0, damageMultiplier: 0 };
  }
  return { winner: 'attacker', defenderTakes: inc - cls, attackerTakes: 0,
           damageMultiplier: (inc - cls) / inc };
}

/**
 * The stat block an unarmed fighter's proficiency stands in for.
 *
 * Returns `{ability: points}` for the three abilities named in
 * `unarmedGrant.abilities`, splitting the rarity's total on the measured
 * weapon shape. See the config block for where the numbers come from.
 *
 * ⚠ THE REMAINDER GOES TO THE LAST ABILITY ON PURPOSE. Rounding each share
 * independently loses or gains a point against the authored total (27 * 0.36
 * = 9.72, and three such roundings do not reconcile), which would make the
 * ladder disagree with itself by a point in either direction at arbitrary
 * rungs. Distributing the remainder keeps `sum(result) === total` exactly, so
 * the table above is the contract rather than an approximation of one.
 *
 * @param {string} rarity  the Unarmed Proficiency passive's rarity
 * @param {object} [cfg]
 * @returns {Record<string, number>} empty when the grant is off or unknown
 */
export function unarmedStatGrant(rarity, cfg = null) {
  const c = (cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {})).unarmedGrant ?? {};
  if (c.enabled === false) return {};
  const abilities = c.abilities ?? [];
  const split = c.split ?? [];
  const total = Number(c.totalByRarity?.[rarity]);
  if (!abilities.length || !Number.isFinite(total) || total <= 0) return {};

  const out = {};
  let assigned = 0;
  for (let i = 0; i < abilities.length; i++) {
    if (i === abilities.length - 1) {
      out[abilities[i]] = total - assigned;      // remainder, so the sum is exact
    } else {
      const share = Math.round(total * (Number(split[i]) || 0));
      out[abilities[i]] = share;
      assigned += share;
    }
  }
  return out;
}

/**
 * DEBUFF BUILD-UP threshold test. PURE — golden-tested.
 *
 * A stacking debuff transforms into a worse one once the accumulated
 * `debuffDamage` across its live stacks reaches a threshold. The threshold is
 * an ABILITY MOD when the entry names one — chilled freezes you at exactly the
 * point it would have drained all your dexterity — with an optional flat floor
 * for debuffs that answer to no stat.
 *
 * ⚠ A zero total NEVER triggers, even against a zero threshold. Otherwise a
 * target whose stat had already been reduced to nothing would transform on a
 * stack that contributed literally no accumulation.
 *
 * @param {number} total          summed debuffDamage across live stacks
 * @param {number} statMod        the threshold ability's mod (0 when none)
 * @param {number} [flatFloor=0]  flat threshold, used as a floor under the stat
 * @returns {boolean}
 */
export function debuffBuildupTriggered(total, statMod, flatFloor = 0) {
  const t = Number(total) || 0;
  if (t <= 0) return false;
  const threshold = Math.max(Number(statMod) || 0, Number(flatFloor) || 0);
  if (threshold <= 0) return false;
  return t >= threshold;
}

/**
 * Spatial storage rows for a collection of items. PURE — golden-tested.
 *
 * ⚠ THE ONE COPY OF THIS MATH. It lived twice: once in
 * systems/spatial-storage `storagesOf` and once inlined in
 * actor.prepareDerivedData — and the copies had ALREADY DRIFTED, since only
 * the actor's produced the `over` flag. spatial-storage.mjs even carries a
 * header warning that a second copy "would be exactly the kind of drift this
 * codebase keeps paying for". It lives here rather than in the system module
 * because actor.mjs must not import systems/spatial-storage: that reaches
 * celerity, which imports item.mjs, and actor -> item is the cycle the code
 * standards forbid.
 *
 * Contents weigh `weight x quantity`. Capacity is in POUNDS.
 *
 * @param {Iterable<{id: string, name: string, system: object}>} items
 * @returns {Array<{id,name,equipped,capacity,used,free,over}>}
 */
export function spatialStorageRows(items) {
  const all = [...(items ?? [])];
  const round1 = (n) => Math.round(n * 10) / 10;
  const out = [];
  for (const item of all) {
    const capacity = item?.system?.spatialCapacity ?? 0;
    if (!(capacity > 0)) continue;
    let used = 0;
    for (const inner of all) {
      if (inner?.system?.storedIn !== item.id) continue;
      used += (inner.system.weight ?? 0) * (inner.system.quantity ?? 1);
    }
    out.push({
      id: item.id, name: item.name, equipped: !!item.system.equipped,
      capacity, used: round1(used), free: round1(capacity - used),
      over: used > capacity,
    });
  }
  return out;
}
