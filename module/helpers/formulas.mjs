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
