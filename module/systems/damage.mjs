/**
 * Damage resolution — the combat pipeline as a callable function.
 *
 * WHY THIS EXISTS: the mitigation chain used to live entirely inside the
 * apply-damage click handler in `aspects-of-power.mjs`, i.e. inside a
 * chat-render hook. Nothing that isn't a GM clicking a button could reach it —
 * not the AI, not a balance sim, not a test. Every sim therefore RE-IMPLEMENTED
 * the chain, and re-implementations drift: a 2026-08-01 balance session
 * produced four separate wrong answers that way (a dice regex that ate the
 * house `d20`, a rarity flag the real path doesn't pass, unmodelled caster
 * implements). The numbers were always plausible, which is exactly what made
 * them expensive.
 *
 * `resolveDamage` is PURE — plain numbers in, plain numbers out, no Foundry
 * documents, no async, no I/O. That is the point: the live path and any sim
 * call the same arithmetic, so they cannot disagree. Document side effects
 * (barrier reform, mark deletion, durability, lifesteal, chat) stay with the
 * caller, because they are not part of the arithmetic.
 *
 * ORDER IS LOAD-BEARING and matches the shipped pipeline exactly:
 *   mark → affinity resist → barrier → armour/veil → toughness DR →
 *   augment resist → DEFENCE MARGIN → overhealth → HP
 *
 * The margin lands second-to-last on purpose (RULED 2026-07-31): applying it
 * before the flat wall lets a decent defence plus any armour reach zero —
 * measured at 25 of 40 live matchups immune. See design-defense-rework-2026-07.
 */

/**
 * @typedef {object} DamageInput
 * @property {number}  incoming          Raw damage arriving at the target.
 * @property {number} [markBonus=0]      Summed markedDamageBonus (0.2 = +20%).
 * @property {number} [affinityResist=0] Flat pre-step cut from per-affinity DR.
 * @property {number} [barrier=0]        Barrier pool available (0 if no live barrier effect).
 * @property {number} [mitigation=0]     Armour+block (already pierce/crush/melt-reduced) or veil.
 * @property {number} [mitigationLabel]  'Armor' | 'Veil' — display only.
 * @property {number} [drValue=0]        Toughness DR before affinity strip.
 * @property {number} [affinityDR=0]     DR-strip amount.
 * @property {number} [augDR=0]          Augment flat resist for this damage type.
 * @property {string} [augLabel='Phys']  'Phys' | 'Mag' — display only.
 * @property {number} [margin=1]         Defence margin multiplier; 1 = no defence declared.
 * @property {number} [overhealth=0]     Overhealth pool.
 * @property {number} [health=0]         Current HP.
 */

/**
 * @typedef {object} DamageResult
 * @property {number}   incoming            Post-mark, post-affinity-resist damage entering the chain.
 * @property {number}   markAdded           Extra damage the mark contributed.
 * @property {number}   affinityResisted    Damage removed by per-affinity DR.
 * @property {number}   barrierAbsorbed     Damage the barrier ate.
 * @property {boolean}  barrierBroke        Barrier hit exactly zero on this hit.
 * @property {number}   barrierRemaining    Barrier left afterwards.
 * @property {number}   mitigated           Armour/veil reduction actually applied.
 * @property {number}   drReduced           Toughness DR reduction actually applied.
 * @property {number}   augReduced          Augment resist actually applied.
 * @property {number}   marginTurned        Damage the defence turned aside.
 * @property {number}   overhealthAbsorbed  Overhealth consumed.
 * @property {number}   overhealthRemaining Overhealth left afterwards.
 * @property {number}   hpLoss              Damage that reached HP.
 * @property {number}   newHealth           Resulting HP.
 * @property {number}   postBarrier         Damage past the barrier (durability input).
 * @property {number}   effectiveDR         drValue − affinityDR, floored at 0.
 * @property {string[]} parts               Display fragments, in pipeline order.
 */

const n = (v) => Number(v) || 0;

/**
 * Mark amplification: a marked target takes the RAW blow scaled up before any
 * mitigation. Exported because the live apply-damage path has to do this step
 * itself — it must read the mark effects off the document to know the bonus,
 * and delete the expires-on-hit ones afterwards — so it would otherwise carry
 * a second copy of the multiply. One implementation, two callers.
 *
 * @param {number} incoming
 * @param {number} bonus  Summed markedDamageBonus (0.2 = +20%).
 * @returns {number}
 */
export function applyMarkBonus(incoming, bonus) {
  const b = Math.max(0, n(bonus));
  const dmg = Math.max(0, n(incoming));
  return b > 0 ? Math.round(dmg * (1 + b)) : dmg;
}

/**
 * Run the full mitigation chain. Pure.
 *
 * @param {DamageInput} input
 * @returns {DamageResult}
 */
export function resolveDamage(input = {}) {
  // `parts` covers only the steps this function fully owns — armour onward.
  // Mark, affinity-resist, cleanse and barrier all need document reads to
  // describe (which effect broke, which stacks were stripped), so the caller
  // emits those and prepends them. Splitting it this way keeps the display
  // order stable without this module needing to know about Foundry.
  const parts = [];

  const markBonus = Math.max(0, n(input.markBonus));
  const rawIncoming = Math.max(0, n(input.incoming));

  // ── Mark: amplifies the RAW blow before any mitigation. ──
  let incoming = applyMarkBonus(rawIncoming, markBonus);
  const markAdded = incoming - rawIncoming;

  // ── Per-affinity DR pre-step (caller sums the per-slice reductions). ──
  const affinityResist = Math.max(0, n(input.affinityResist));
  let affinityResisted = 0;
  if (affinityResist > 0) {
    affinityResisted = Math.min(affinityResist, incoming);
    incoming = Math.max(0, incoming - affinityResist);
  }

  let remaining = incoming;

  // ── 1. Barrier absorbs first. No toughness/DR on this portion. ──
  const barrier = Math.max(0, n(input.barrier));
  let barrierAbsorbed = 0;
  if (barrier > 0) {
    barrierAbsorbed = Math.min(barrier, remaining);
    remaining -= barrierAbsorbed;
  }
  const barrierRemaining = barrier - barrierAbsorbed;
  const barrierBroke = barrier > 0 && barrierRemaining === 0;
  const postBarrier = barrier > 0 ? Math.max(0, incoming - barrier) : incoming;

  // ── 2. Armour / veil. ──
  const mitigation = Math.max(0, n(input.mitigation));
  let mitigated = 0;
  if (remaining > 0 && mitigation > 0) {
    mitigated = Math.min(mitigation, remaining);
    remaining = Math.max(0, remaining - mitigation);
    parts.push(`${input.mitigationLabel === 'Veil' ? 'Veil' : 'Armor'}: −${mitigated}`);
  }

  // ── 3. Toughness DR, less any affinity strip. ──
  const effectiveDR = Math.max(0, n(input.drValue) - n(input.affinityDR));
  let drReduced = 0;
  if (remaining > 0) {
    drReduced = Math.min(effectiveDR, remaining);
    remaining = Math.max(0, remaining - effectiveDR);
    if (drReduced > 0) parts.push(`DR: −${drReduced}`);
  }

  // ── 3b. Augment-sourced flat resist. ──
  const augDR = Math.max(0, n(input.augDR));
  let augReduced = 0;
  if (remaining > 0 && augDR > 0) {
    augReduced = Math.min(augDR, remaining);
    remaining = Math.max(0, remaining - augDR);
    parts.push(`${input.augLabel ?? 'Phys'} Resist: −${augReduced}`);
  }

  // ── 3c. THE MARGIN RULE — how badly the defender lost scales what survives
  //        the wall. Absent margin (1) leaves every other source untouched.
  const margin = input.margin === undefined || input.margin === null
    ? 1
    : Math.max(0, Math.min(1, Number(input.margin)));
  let marginTurned = 0;
  if (remaining > 0 && margin < 1) {
    const kept = Math.round(remaining * margin);
    marginTurned = remaining - kept;
    remaining = kept;
    if (marginTurned > 0) parts.push(`Defence: −${marginTurned} (${Math.round((1 - margin) * 100)}% turned aside)`);
  }

  // ── 4. Overhealth. ──
  const overhealth = Math.max(0, n(input.overhealth));
  let overhealthAbsorbed = 0;
  if (remaining > 0 && overhealth > 0) {
    overhealthAbsorbed = Math.min(overhealth, remaining);
    remaining -= overhealthAbsorbed;
    parts.push(`Overhealth: −${overhealthAbsorbed}`);
  }

  // ── 5. Whatever is left hits HP. ──
  const health = n(input.health);
  const newHealth = Math.max(0, health - remaining);
  if (remaining > 0) parts.push(`Health: −${remaining}`);

  return {
    incoming, markAdded, affinityResisted,
    barrierAbsorbed, barrierBroke, barrierRemaining,
    mitigated, drReduced, augReduced, effectiveDR,
    marginTurned,
    overhealthAbsorbed, overhealthRemaining: overhealth - overhealthAbsorbed,
    hpLoss: remaining, newHealth, postBarrier,
    parts,
  };
}

/**
 * Durability damage from one resolved hit.
 *
 * Split out because it reads the SAME numbers the chain produced but is not
 * part of the chain — and because the axe-wear rule (2026-07-28) anchors on
 * what the armour STOPPED rather than what leaked through, which is only
 * derivable here.
 *
 * @param {DamageResult} res
 * @param {object} [opts]
 * @param {number} [opts.mitigation=0]  Armour/veil that faced the blow.
 * @param {number} [opts.wearRate=0]    Axe wear rate; 0 disables wear entirely.
 * @returns {{leaked: number, wear: number, total: number}}
 */
export function durabilityDamage(res, opts = {}) {
  const mitigation = Math.max(0, n(opts.mitigation));
  const leaked = Math.max(0, res.postBarrier - mitigation - res.effectiveDR);
  const wearRate = Math.max(0, n(opts.wearRate));
  const wear = wearRate > 0
    ? Math.max(0, Math.round(Math.min(res.postBarrier, mitigation + res.effectiveDR) * wearRate))
    : 0;
  return { leaked, wear, total: leaked + wear };
}
