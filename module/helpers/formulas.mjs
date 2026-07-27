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
 * `rarity` null/unknown means the actor owns NO proficiency for the weapon in
 * hand, which returns 1 — absence is neutral, never a penalty. That rule is
 * load-bearing: ~110 NPCs swing untyped natural weapons and no PC owned a
 * proficiency when this shipped, so penalising absence would have silently
 * nerfed the whole world in one commit.
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
