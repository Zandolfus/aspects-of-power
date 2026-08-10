/**
 * CO-INVEST: the second slider on an invest dialog.
 *
 * Generalised 2026-08-10. `infused` (mana) shipped welded into the weapon
 * branch of Item#roll — one boolean, five hardcoded locals, and a dialog whose
 * parameters were literally named `stamina` and `mana`. That meant the
 * one-tag-per-resource ruling could be RECORDED but not USED: `effort` and
 * `life-drain` were registered tags that nothing read.
 *
 * This resolves whichever co-invest tag a skill carries into a descriptor the
 * invest paths consume uniformly, so a fourth pool would be a config entry.
 *
 * The rules, all of them:
 *   - A tag naming the skill's OWN primary resource is IGNORED. You cannot
 *     double-dip one pool.
 *   - The base cost is spell-shaped (tier x grade) whatever the pool, so the
 *     three tags stay comparable in magnitude at equal grade.
 *   - An untiered skill co-invests at BASIC tier (the 2026-08-10 ruling for
 *     `infused`: it is a resource injection, not an authored spell).
 *   - The pool is read LIVE at resolve time, and `health` holds back
 *     invest.healthFloor so no one can commit a lethal amount at the slider.
 *
 * ⚠ Nothing here is the `rider` subsystem (riderDamageBase / riderMaxInvest),
 * which is a proc on a pierced target. Same English word, different mechanic.
 */

import { coInvestCap, spellDamageRef } from '../helpers/formulas.mjs';

/**
 * Resolve the co-invest a skill declares, if any.
 *
 * @param {Actor}  actor
 * @param {Item}   skill
 * @param {object} opts
 * @param {string} opts.primaryResource  the resource the skill already invests
 * @param {string} [opts.tier]           skill's spell tier ('' -> basic)
 * @param {string} opts.grade            the caster's race rank
 * @param {number} [opts.hostPotency]    the ATTACK's own potency term — the
 *   weapon's str/dex blend on a strike, int on a spell. Used by any pool whose
 *   `potencyStat` is HOST_POTENCY (see the config block for why effort does
 *   and infused does not).
 * @returns {null|{
 *   tag:string, resource:string, label:string, potencyLabel:string,
 *   potency:number, coef:number, channelled:boolean,
 *   baseCost:number, maxPool:number, pool:number, dmgRef:number,
 *   affordable:boolean
 * }}
 */
export function resolveCoInvest(actor, skill, { primaryResource, tier = '', grade = '', hostPotency = 0 } = {}) {
  const sc = CONFIG.ASPECTSOFPOWER;
  const registry = sc.coInvest ?? {};
  const tags = skill?.system?.tags ?? [];
  if (!actor || !tags.length) return null;

  // Registry order decides, not authoring order — otherwise a skill carrying
  // two co-invest tags would open a different dialog depending on which one
  // the designer happened to type first.
  const tag = Object.keys(registry).find(t =>
    tags.includes(t) && registry[t].resource !== primaryResource);
  if (!tag) return null;

  const def = registry[tag];
  // A resource the actor has no pool for (no `ki`-style tag, no schema field)
  // is a refusal, not a free pass — same rule as the flat secondary cost.
  if (!actor.system?.[def.resource]) return null;

  const effTier = tier || 'basic';
  const tierFactor = sc.spellTierFactors?.[effTier];
  const gradeFactor = sc.spellGradeFactors?.[grade];
  if (!tierFactor || !gradeFactor) return null;

  const baseCost = Math.round(tierFactor * gradeFactor);
  // Health holds back a floor: `_commitCastCost` clamps the deduction at 0,
  // not 1, so the guard against a lethal commit has to live at the slider.
  const floor = (def.resource === 'health')
    ? Math.max(1, sc.invest?.healthFloor ?? 1)
    : 0;
  const pool = Math.max(0,
    Math.round(actor.system[def.resource]?.value ?? 0) - floor);

  const aboveBaseFactor = sc.spellMaxInvestAboveBase?.[effTier]
    ?? sc.spellMaxInvestAboveBase?.['']
    ?? 0.1;
  const capStatMod = actor.system.abilities?.[def.capStat]?.mod ?? 0;

  return {
    tag,
    resource: def.resource,
    label: def.label ?? tag,
    potencyLabel: def.potencyLabel ?? '',
    // HOST_POTENCY pools amplify the attack rather than adding a second kind
    // of output, so they scale by whatever the attack already scales by.
    potency: (def.potencyStat === sc.HOST_POTENCY)
      ? (Number(hostPotency) || 0)
      : (actor.system.abilities?.[def.potencyStat]?.mod ?? 0),
    coef: def.coef ?? 1,
    channelled: def.channelled === true,
    baseCost,
    maxPool: coInvestCap(baseCost, capStatMod, aboveBaseFactor, pool),
    pool,
    dmgRef: spellDamageRef(gradeFactor),
    affordable: baseCost > 0 && pool >= baseCost,
  };
}
