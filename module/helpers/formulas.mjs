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
  const model = sc.spellWeight?.model ?? 'none';
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
export function spellInvestDamage(intMod, multiplier, invested, ref) {
  return Math.round(intMod * multiplier * Math.pow(Math.max(invested, 1) / Math.max(ref, 1), 0.2));
}

/**
 * Invest-scaled weapon strike damage: blend × mult × windup × (stam/base)^0.2.
 * Preview passes windup 1 (the dialog shows pre-windup numbers today).
 */
export function strikeInvestDamage(statBlend, multiplier, windup, invested, baseStamina) {
  return Math.round(statBlend * multiplier * windup * Math.pow(Math.max(invested, 1) / Math.max(baseStamina, 1), 0.2));
}

/**
 * Spellstrike fusion infusion: int × coef × (mana/ref)^0.2 (dac55a5 —
 * wis-capped upstream; ref = spellDamageRef, NOT the skill's own baseMana).
 */
export function infusionDamage(intMod, coef, manaInvested, ref) {
  return Math.round(intMod * coef * Math.pow(Math.max(manaInvested, 1) / Math.max(ref, 1), 0.2));
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
  const defVal = (targetActor.system.defense[defKey]?.value ?? 0) / (t.dodgeBasisDiv ?? 1);
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
  const a = amp ?? C.lunarAmplitude ?? 0;
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
