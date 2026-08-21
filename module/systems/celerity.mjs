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
import { weaponStatBlend, perceiveGateDecision, spellCastWeight, defenseTimeBudgetMax, dualWieldFloor } from '../helpers/formulas.mjs';
import { dualWieldEligible, dualWieldPassiveRarity, handOf, equippedImplementItems } from './weapon-styles.mjs';
import { effectiveClockTick, interpolateMovementPosition } from '../helpers/movement-path.mjs';
import { heldImplementWeight } from './weapon-styles.mjs';
import { tickDotsFor } from './dot.mjs';
import { declarePlannedMove, stopDeclaredMove, priceMovementPath } from './movement.mjs';

// Re-export for the existing consumers (overlay, tracker, aura-ticks,
// engagement-halts) — the implementation moved to helpers/movement-path.mjs
// so the movement execution layer can import it without a module cycle.
export { interpolateMovementPosition };

const HYBRID_60_40_WIS_DEX = (a) => 0.6 * (a.wisdom?.mod ?? 0) + 0.4 * (a.dexterity?.mod ?? 0);
const _MAGIC_TYPES_FOR_SPEED = new Set(['magic', 'magic_melee', 'magic_projectile']);

/**
 * Speed source by skill roll.type, per design-celerity.md table.
 * For magic skills, the Wis/Int hybrid weighting scales by spell tier — big
 * spells lean more toward Wis ("mastery shows on bigger workings"). See
 * CONFIG.ASPECTSOFPOWER.castingSpeedWeights.
 *
 * For phys_ranged, speed mirrors the damage stat blend (Dex/Per by weapon
 * weight) so heavy ranged users investing in Per get speed credit too —
 * matches melee's "speed = your primary damage stat" pattern. Falls back
 * to Dex.mod when no weapon is wielded (legacy path / unarmed).
 */
function _actorSpeedFor(actor, skill) {
  const a = actor.system.abilities ?? {};
  const type = skill?.system?.roll?.type ?? '';
  const ability = skill?.system?.roll?.abilities ?? '';

  if (_MAGIC_TYPES_FOR_SPEED.has(type)) {
    const tier = skill?.system?.roll?.tier ?? '';
    const weights = CONFIG.ASPECTSOFPOWER.castingSpeedWeights ?? {};
    const w = weights[tier] ?? weights[''] ?? { wis: 0.6, int: 0.4 };
    return Math.round(w.wis * (a.wisdom?.mod ?? 0) + w.int * (a.intelligence?.mod ?? 0));
  }

  switch (type) {
    case 'str_weapon':       return a.strength?.mod  ?? 0;
    case 'dex_weapon':       return a.dexterity?.mod ?? 0;
    case 'phys_ranged': {
      const weapon = skill?._resolveWeaponForSkill?.();
      const weight = weapon ? AspectsofPowerItem.resolveWeaponWeight(weapon) : 0;
      if (weight <= 0) return a.dexterity?.mod ?? 0;
      // Speed mirrors the damage stat blend — SAME implementation
      // (helpers/formulas.mjs) so speed can never drift from damage.
      return weaponStatBlend(weight, {
        dex: a.dexterity?.mod ?? 0, per: a.perception?.mod ?? 0,
      }, true).blend;
    }
    case 'wisdom_dexterity': return Math.round(HYBRID_60_40_WIS_DEX(a));
    default:                 return a[ability]?.mod ?? a.dexterity?.mod ?? 1;
  }
}

const _MAGIC_TYPES = new Set(['magic', 'magic_melee', 'magic_projectile']);

/**
 * Resolve the celerity weight for a skill:
 *   Magic skills    → spellTierWeights[tier], else BASELINE_WEIGHT
 *   Weapon skills   → resolveWeaponWeight on the equipped/required weapon,
 *                     else BASELINE_WEIGHT (e.g. unarmed without a tag)
 *
 * Implements (staves, wands) do NOT contribute their own weight to spell wait
 * under the default model — spell weight is intrinsic to the spell tier. That
 * changes only when `config.spellWeight.model` is 'implement', where the focus
 * IS the weapon and the spell adds to it; see spellCastWeight.
 */
function _resolveCelerityWeight(skill, weapon = null) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const type = skill?.system?.roll?.type ?? '';
  // GUARD STANCE (design-guard-stances, RULED 2026-08-21): raising the
  // guard is priced by the GUARD's weight — the item the skill requires
  // (requiresWeaponTag, family-aware, shields included), which the normal
  // weapon resolver deliberately excludes. _proficiencyWeapon already does
  // that lookup for the proficiency rule; reuse it so the two can't drift.
  if ((skill?.system?.tags ?? []).includes('stance')) {
    const guard = skill._proficiencyWeapon?.() ?? null;
    const gw = AspectsofPowerItem.resolveWeaponWeight(guard);
    return gw > 0 ? gw : sc.BASELINE_WEIGHT;
  }
  if (_MAGIC_TYPES.has(type)) {
    const tier = skill?.system?.roll?.tier ?? '';
    // MAGIC/MELEE UNIFICATION: under the 'implement' model the focus is the
    // weapon and the spell adds to it, so the cast carries implement + tier.
    // The DAMAGE side (spellWindupMultiplier) reads the same weight — that
    // pairing is what keeps DPR weight-invariant, exactly as it is for a swing.
    // Returns 0 when the model is off, so shipped behaviour is untouched.
    //
    // DUAL IMPLEMENTS (design-dual-wield-tempo): with two implement ITEMS in
    // hand, casts alternate implements and only the IMPLEMENT share of the
    // weight compresses — the tier weight is the working itself; the mind
    // casts the spell, not the second wand. Deliberately the flat rule (no
    // per-item rotation state): identical wands are the common case and the
    // tag-based implement model cannot tell them apart anyway.
    let implW = heldImplementWeight(skill?.actor);
    if (implW > 0 && equippedImplementItems(skill?.actor) >= 2) {
      implW *= dualWieldFloor(dualWieldPassiveRarity(skill?.actor), true);
    }
    const castW = spellCastWeight(tier, implW);
    if (castW > 0) return castW;
    return CONFIG.ASPECTSOFPOWER.spellTierWeights?.[tier] ?? sc.BASELINE_WEIGHT;
  }
  // ⚠ EMPTY HANDS ARE FISTS, NOT A SWORD. This used to fall through to
  // BASELINE_WEIGHT (100, the sword reference) whenever no weapon resolved,
  // so every unarmed combatant in the world — 184 of 222 actors — paid sword
  // tempo for punching. resolveEffectiveWeaponWeight answers 40 for melee
  // roll types and 0 for everything else, so the baseline still catches the
  // genuinely weightless cases.
  const eff = AspectsofPowerItem.resolveEffectiveWeaponWeight(skill, weapon);
  return eff > 0 ? eff : sc.BASELINE_WEIGHT;
}

/**
 * Wait time in ticks for `actor` performing `skill`.
 *
 *   For weapons:  wait = base_wait
 *   For spells:   wait = MAX(base_wait, channel_wait)
 *     base_wait    = weight × multiplier × SCALE / actor_speed
 *     channel_wait = investAmount × CHANNEL_FACTOR / Wis_mod
 *
 * Spells fire at whichever takes longer — the inherent cast time, or the
 * time to channel the invested mana. Small/moderate invests hit base time
 * (free); only heavy invests slow the cast further.
 *
 * @param {Actor}  actor
 * @param {Item}   skill
 * @param {Item|null} weapon         Optional weapon override
 * @param {number|null} investAmount Optional pre-captured invest (mana for spells)
 */
export function computeActionWait(actor, skill, weapon = null, investAmount = null, manaInvestAmount = null, distanceFt = null) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;

  // Granted skills (race/item/system-given) bypass the stat-driven cast-time
  // formula. Time is the design dial; build doesn't affect it. Channel time,
  // implement discounts, and rarity weight-mods all skip — the source is
  // providing the ability, not the caster's training.
  const tags = skill?.system?.tags ?? [];
  if (tags.includes('granted')) {
    const cfg = skill?.system?.tagConfig ?? {};
    const maxFrac = cfg.grantedActivationFraction ?? (sc.GRANTED_DEFAULT_FRACTION ?? (1 / 3));
    const minFrac = cfg.grantedMinActivationFraction ?? maxFrac;
    // Teleport / Leap: lerp min→max by distance/maxDistance. Other granted
    // skills (or teleport/leap without a picked distance) use maxFrac flat.
    let fraction = maxFrac;
    let maxDist = 0;
    if (tags.includes('teleport')) {
      const explicit = cfg.teleportMaxDistance ?? 0;
      maxDist = explicit > 0 ? explicit : Math.max(5, Math.round(actor?.system?.castingRange ?? 30));
    } else if (tags.includes('leap')) {
      maxDist = cfg.leapMaxDistance ?? 0;
    }
    if (distanceFt != null && maxDist > 0) {
      const norm = Math.max(0, Math.min(1, distanceFt / maxDist));
      fraction = minFrac + (maxFrac - minFrac) * norm;
    }
    const rl = actor.system?.attributes?.race?.level ?? 1;
    const roundLen = referenceRoundLength(rl);
    return Math.max(1, Math.round(roundLen * fraction));
  }

  const speed = Math.max(1, _actorSpeedFor(actor, skill));
  const weight = _resolveCelerityWeight(skill, weapon);
  // Total weight multiplier = manual designer override (legacy) ×
  // alteration-derived weight multiplier (rarity + tags). Vanilla
  // skill = 1 × 1 = 1 (unchanged); a Cleave-altered skill picks up
  // the cleave tag's weightMod automatically.
  const heft = computeActionHeft(actor, skill, weapon, weight);
  const baseWait = Math.max(1, Math.round((heft * sc.SCALE) / speed));
  // Orb discharge below reprices at BASELINE_WEIGHT but keeps the skill's
  // own weight multipliers — the same components heft folds in.
  const multiplier = (skill?.system?.roll?.actionWeightMultiplier ?? 1.0)
    * (skill?._resolveCostWeightMods?.()?.effectiveWeightMultiplier ?? 1.0);

  const isMagic = _MAGIC_TYPES.has(skill?.system?.roll?.type ?? '');
  const tier = skill?.system?.roll?.tier ?? '';
  const equippedImplements = actor?.getEquippedImplements?.() ?? new Set();

  // Wand implement: −23% wait on Basic-tier spells. Tier-only check (no weight
  // gate) per design discussion 2026-05-06 — heavily-altered Basic spells
  // self-balance because their higher base weight already slows them; Wand's
  // proportional reduction lets vanilla Basic hit ~3 casts/round while complex
  // Basic spells benefit moderately. Applied to baseWait BEFORE the channel-
  // wait MAX so a Wand-equipped caster paying low mana sees the speed-up.
  let adjustedBaseWait = baseWait;
  if (isMagic && tier === 'basic' && equippedImplements.has('wand')) {
    adjustedBaseWait = Math.max(1, Math.round(baseWait * (sc.WAND_BASIC_WAIT_MULT ?? 0.77)));
  }

  // Orb implement: when the orb has banked ≥ ORB_DISCHARGE_THRESHOLD weight
  // from prior spell casts, the next spell cast becomes a discharge — wait
  // recomputed with BASELINE_WEIGHT instead of the spell's tier weight (a
  // "1 AP" minimum cast), and mana cost is zeroed in the spell-branch
  // consumer. Universal across tiers (per design 2026-05-06): Basic banks
  // and discharges too, but Wand stays strictly faster on Basic — Orb's
  // identity on Basic is mana economy (1 free per cycle) vs Wand's flat
  // speed bonus.
  const orbCharge = actor?.flags?.aspectsofpower?.spellCharge ?? 0;
  const isOrbQualifying = isMagic && !!tier;
  const orbDischarging = isOrbQualifying
    && equippedImplements.has('orb')
    && orbCharge >= (sc.ORB_DISCHARGE_THRESHOLD ?? 400);
  if (orbDischarging) {
    adjustedBaseWait = Math.max(1, Math.round((sc.BASELINE_WEIGHT * multiplier * sc.SCALE) / speed));
  }

  // Channel wait sources: (a) magic spell with mana invest (investAmount IS
  // mana), or (b) a CHANNELLED co-invest — mana spent on top of some other
  // primary pool. Wisdom controls the rate the same way for both.
  //
  // Only mana is channelled (config.coInvest), because channelling is a magic
  // act: an `effort` or `life-drain` co-invest buys its damage without costing
  // any tempo. Read from the registry rather than hardcoding `infused`, so a
  // fourth pool inherits the right answer by declaring it.
  const _coCfg = CONFIG.ASPECTSOFPOWER?.coInvest ?? {};
  const hasChannelledCoInvest = (skill?.system?.tags ?? [])
    .some(t => _coCfg[t]?.channelled === true);
  const channelMana = isMagic
    ? (investAmount ?? 0)
    : (hasChannelledCoInvest ? (manaInvestAmount ?? 0) : 0);
  if (channelMana > 0) {
    const wisMod = Math.max(1, actor.system.abilities?.wisdom?.mod ?? 0);
    // Fallback matches config.mjs (was 1000 — a stale fallback that would
    // silently TRIPLE channel speed if the config key ever went missing).
    const factor = sc.CHANNEL_FACTOR ?? 3000;
    const channelWait = Math.round(channelMana * factor / wisMod);
    return Math.max(adjustedBaseWait, channelWait);
  }
  return adjustedBaseWait;
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

/* -------------------------------------------------- */
/*  Real-time display (design-celerity-realtime.md)   */
/* -------------------------------------------------- */

/**
 * World-time milliseconds represented by a tick count. Display-only —
 * the anchor TICK_MS (1 tick ≡ 0.072 ms; G1 human = 2.0s sword swing)
 * never feeds back into wait/round math.
 */
export function ticksToMs(ticks) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  return ticks * (sc.TICK_MS ?? 0.072);
}

/**
 * Human-readable world time for a tick count: "83ms", "2.35s", "1m 23s",
 * "2h 05m". Sub-alpha-grade combat lives in the ms/s bands; crafting and
 * downtime activities will use the m/h bands.
 */
export function formatTicksAsTime(ticks) {
  if (!Number.isFinite(ticks) || ticks < 0) return '—';
  const ms = ticksToMs(ticks);
  if (ms < 100) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  // Round to whole seconds FIRST, then decompose. Flooring the minutes and
  // separately rounding the remainder printed "59m 60s" for a clock-bound
  // hour (float drift puts it a hair under 3600) — the carry has to happen
  // before the split, not after.
  const total = Math.round(s);
  const pad = (n) => String(n).padStart(2, '0');
  if (total < 3600) return `${Math.floor(total / 60)}m ${pad(total % 60)}s`;
  return `${Math.floor(total / 3600)}h ${pad(Math.floor((total % 3600) / 60))}m`;
}

/**
 * Published Celerity rating for a mod: action-points per second. A sword
 * swing costs BASELINE_WEIGHT (100) points, so rating/100 = swings per
 * second. Grows with RL — the "hard number" players watch (G1 ≈ 50,
 * E-top ≈ 1,683, S-top ≈ 47,807).
 */
export function celerityRating(mod) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  return mod * 1000 / (sc.SCALE * (sc.TICK_MS ?? 0.072));
}

/**
 * Build-neutral reference mod for an actor's race level — the inverse of
 * referenceRoundLength. This is the curve the perceive-gate sim validated
 * against (design-celerity-realtime.md), NOT the actor's build mods: the
 * ±25-level ruling is about LEVELS, so a fast build never makes a peer
 * un-reactable and a slow build is never blinded by its own peers.
 */
export function referenceMod(actor) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const rl = actor?.system?.attributes?.race?.level ?? 1;
  return sc.ROUND_K / Math.max(1, referenceRoundLength(rl));
}

/**
 * Perceive-to-react gate (design-celerity-realtime.md step 3, RULED
 * 2026-07-02). A defender may ATTEMPT active defense (dodge, parry,
 * reactions) only while the attacker is inside their reaction envelope:
 *
 *   attacker_Celerity <= R x defender_Celerity        (R = 2.5, sim-locked)
 *
 * Beyond R the blow is a blur and routes through the existing eat-the-hit
 * path — same outcome as blind, different reason. Mortal-band exemption:
 * when BOTH parties are G/F the gate is waived outright (G's interior
 * spread is 4.5x over nine levels — no flat R survives it). Cross-band
 * (G/F attacker vs E+ defender or the reverse) still uses the ratio.
 *
 * Attempt is not success — inside the band the normal opposed roll decides,
 * so stat gaps stay absolute.
 *
 * @returns {{canReact: boolean, ratio: number, waived: boolean, R: number,
 *            attackerRating: number, defenderRating: number}}
 */
export function perceiveGate(attackerActor, defenderActor) {
  // Missing actors never gate.
  if (!attackerActor || !defenderActor) {
    return { canReact: true, ratio: 1, waived: false, R: 0, attackerRating: 0, defenderRating: 0 };
  }
  const aMod = referenceMod(attackerActor);
  const dMod = referenceMod(defenderActor);
  const decision = perceiveGateDecision(
    aMod, dMod,
    attackerActor.system?.attributes?.race?.rank ?? 'E',
    defenderActor.system?.attributes?.race?.rank ?? 'E',
  );
  // Ratings are display sugar for the prompt/chat lines — the decision above
  // is made on mods so the display anchor can never move a balance outcome.
  return { ...decision, attackerRating: celerityRating(aMod), defenderRating: celerityRating(dMod) };
}

/* -------------------------------------------------- */
/*  Active Defense (design-active-defense.md v2)      */
/* -------------------------------------------------- */

/**
 * Windup damage multiplier — the weight→damage coupling. UNCLAMPED linear
 * per the 2026-06-11 ruling: clamp(weight × skillMult / 100, min, max).
 * Dagger 0.6×, sword 1.0×, greatsword 2.0×. Corrective, not double-dipping:
 * weight never multiplied damage before (only blend composition + stamina
 * pricing), making light weapons strictly DPS-superior. Spells return 1.0
 * (mana investment is their burst dial).
 */
export function computeWindupMultiplier(skill, weapon = null) {
  const dt = CONFIG.ASPECTSOFPOWER.defenseTuning ?? {};
  const type = skill?.system?.roll?.type ?? '';
  if (_MAGIC_TYPES.has(type)) return 1.0;
  const weight = _resolveCelerityWeight(skill, weapon);
  const manualMult = skill?.system?.roll?.actionWeightMultiplier ?? 1.0;
  const altMult = skill?._resolveCostWeightMods?.()?.effectiveWeightMultiplier ?? 1.0;
  const raw = (weight * manualMult * altMult) / 100;
  return Math.min(dt.windupMax ?? 3.0, Math.max(dt.windupMin ?? 0.5, raw));
}

/**
 * Scramble stacks with continuous decay. One float counter per combatant
 * (defender-paced: only dodges add stacks; chip eaten through bulk costs
 * nothing). Decays at 1 stack per ¼ personal round × decayQuarterRounds.
 * Out of combat there is no clock — scramble reads 0 and adds are no-ops.
 */
export function getScrambleStacks(actor) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return 0;
  const s = combatant.flags?.aspectsofpower?.scramble;
  if (!s?.stacks) return 0;
  const now = getClockTick(combatant.combat);
  const quarter = Math.max(1, Math.round(actorRoundLength(actor) / 4));
  const dt = CONFIG.ASPECTSOFPOWER.defenseTuning ?? {};
  const ticksPerStack = quarter * (dt.scrambleDecayQuarterRounds ?? 1);
  return Math.max(0, s.stacks - (now - (s.atTick ?? 0)) / ticksPerStack);
}

/**
 * Update a combatant's flags, routing through the active GM when the current
 * user can't modify it directly. Defender-side writes (scramble, dodge cost)
 * run on the ATTACKER's client during defense resolution — when a player
 * attacks an NPC that dodges, the player can't update the NPC's combatant
 * (live bug 2026-06-14: "Gabriel lacks permission to update Combatant").
 */
async function _safeCombatantUpdate(combatant, data, options = {}) {
  // Combatant updates are GM-only at the SERVER level — even a combatant whose
  // actor the player owns is rejected ("User X lacks permission to update
  // Combatant"). `canUserModify` lies here: it returns true for an owned
  // combatant, so guarding on it took the direct branch and still threw (live
  // 2026-06-22, player driving an owned summon's Move). Guard on isGM instead:
  // the GM applies directly; every other client routes to the active GM.
  if (game.user.isGM) return combatant.update(data, options);
  game.socket.emit('system.aspects-of-power', {
    action: 'gmCombatantUpdate',
    combatId: combatant.combat?.id,
    combatantId: combatant.id,
    data,
    options,
  });
}

/**
 * DEFENCE-TIME BUDGET (design-defense-time-budget, ruled 2026-08-16).
 *
 * One pool of defence time per personal round. LAZY REFILL: spent time is
 * anchored to the combatant's `lastRoundEndAt` — when the round bookkeeping
 * advances that anchor, the recorded spend no longer matches and the budget
 * reads full again. No extra writes, no refill hook; the refill emerges from
 * the round machinery that already exists (same pattern as scramble decay
 * reading the clock instead of ticking).
 *
 * Out of combat there is no clock: budget reads full and spends no-op —
 * matching how scramble behaves out of combat.
 *
 * @param {Actor} actor
 * @returns {{max:number, remaining:number, anchor:number, outOfCombat:boolean}}
 */
export function getDefenseBudget(actor) {
  const dt = CONFIG.ASPECTSOFPOWER.defenseTuning ?? {};
  const roundLen = actorRoundLength(actor);
  const max = Math.round(defenseTimeBudgetMax(roundLen, dt));
  const combatant = findCombatantForActor(actor);
  if (!combatant) return { max, remaining: max, outOfCombat: true };
  // CONTINUOUS REFILL (user ruling 2026-08-16: "per round should be the
  // exception, not the norm"). Spent time decays at the full cap per
  // personal round — under 100%-rate trickle, regen between two swings and
  // the cost of dodging one BOTH scale with the attacker's interval, so the
  // sustained dodge share is B/k at EVERY tempo. The small cap is pure
  // burst depth: one heavy dodge banked, then you live on what flows back.
  // Same lazy no-write pattern as scramble decay.
  const now = getClockTick(combatant.combat);
  const b = combatant.flags?.aspectsofpower?.defenseBudget ?? {};
  const decayPerTick = roundLen > 0 ? max / roundLen : 0;
  const spent = Math.max(0, (b.spent ?? 0) - Math.max(0, now - (b.atTick ?? 0)) * decayPerTick);
  return { max, remaining: Math.max(0, Math.round(max - spent)), outOfCombat: false };
}

/** Spend defence time. No-op out of combat (no clock to refill against). */
export async function spendDefenseBudget(actor, cost) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return 0;
  const b = getDefenseBudget(actor);
  const spend = Math.max(0, Math.round(cost));
  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.defenseBudget': {
      spent: (b.max - b.remaining) + spend,
      atTick: getClockTick(combatant.combat),
    },
  });
  return spend;
}

/**
 * THE ACTION'S HEFT — its committed mass: celerity weight (weapon weight,
 * or tier+implement for casts) x action multipliers x the dual-wield
 * alternation floor. ONE definition on both sides of an exchange:
 *
 *   wait       = heft x SCALE / attacker speed        (this file)
 *   dodge cost = kw x heft/100 x defender round       (formulas.defenseTimeCost)
 *
 * A charged smash (awm > 1) commits more mass — slower to deliver AND
 * costlier to answer; past the defender's cap it joins the meteor class
 * (full-reserve dive + stamina surcharge). A rhythm flick commits less on
 * both sides. Spells carry tier+implement, so a grand working prices as
 * the mountain it is.
 *
 * @param {Actor} actor
 * @param {Item} skill
 * @param {Item|null} [weapon]      Optional pre-resolved weapon.
 * @param {number|null} [baseWeight] Pre-resolved celerity weight (perf).
 * @returns {number}
 */
export function computeActionHeft(actor, skill, weapon = null, baseWeight = null, { forDefense = false } = {}) {
  // FOR THE DEFENDER, a spell's heft is the WORKING itself — tier weight
  // only. The implement's mass is in the caster's hands, not in the bolt
  // (user 2026-08-16: "mana bolts probably shouldn't be dives" — a staff
  // basic priced 270 and prompted as a dive while the same bolt off a wand
  // priced 170; the defender dodges the projectile, not the focus). The
  // CASTER's tempo keeps implement+tier: a staff still casts slower.
  // Result: basic/high/greater workings are dodges; major/grand are dives.
  let weight;
  if (forDefense && _MAGIC_TYPES.has(skill?.system?.roll?.type ?? '')) {
    const tier = skill?.system?.roll?.tier ?? '';
    weight = CONFIG.ASPECTSOFPOWER.spellTierWeights?.[tier]
      ?? CONFIG.ASPECTSOFPOWER.celerity.BASELINE_WEIGHT;
  } else {
    weight = baseWeight ?? _resolveCelerityWeight(skill, weapon);
  }
  const manualMult = skill?.system?.roll?.actionWeightMultiplier ?? 1.0;
  const altMult    = skill?._resolveCostWeightMods?.()?.effectiveWeightMultiplier ?? 1.0;
  // DUAL-WIELD BODY FLOOR (design-dual-wield-tempo): an alternating swing
  // was preparing while the other hand struck. Rotation in
  // _resolveWeaponForSkill picks the opposite hand from the same state.
  let dualAlt = 1;
  const _rt = skill?.system?.roll?.type ?? '';
  if (['str_weapon', 'dex_weapon', 'phys_ranged'].includes(_rt)
      && (skill?.system?.tags ?? []).includes('attack')
      && !skill?.system?.tagConfig?.requiresWeaponTag
      && !(skill?.system?.tagConfig?.requiresStyle ?? '').startsWith('dual')
      && dualWieldEligible(actor)) {
    const resolved = weapon ?? skill?._resolveWeaponForSkill?.();
    const last = findCombatantForActor(actor)?.flags?.aspectsofpower?.lastSwungHand ?? 'off';
    const alternates = !!resolved && handOf(actor, resolved) !== last;
    dualAlt = dualWieldFloor(dualWieldPassiveRarity(actor), alternates);
  }
  return weight * manualMult * altMult * dualAlt;
}

/**
 * Release a HELD CAST (config.castHolding): clear the flag, charge the
 * release tick, announce, and re-roll the stored fire payload verbatim.
 * ONE implementation for the chat button and the trigger scan below.
 *
 * @param {Combatant} combatant  the holder's combatant
 * @param {string} [via]         '' | 'an ally acting' | 'an enemy acting'
 * @returns {Promise<boolean>}
 */
export async function releaseHeldCast(combatant, via = '') {
  const held = combatant?.flags?.aspectsofpower?.heldCast;
  const actor = combatant?.actor;
  if (!held || !actor) return false;
  const item = actor.items.get(held.itemId);
  await _safeCombatantUpdate(combatant, { 'flags.aspectsofpower.heldCast': null });
  if (!item) return false;
  await chargeActionCost(actor, CONFIG.ASPECTSOFPOWER.castHolding?.releaseCostFraction ?? 0.15);
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> RELEASES <strong>${item.name}</strong>`
      + (via ? ` — loosed by ${via}!` : '!') + `</p>` });
  await item.roll(held.options ?? { executeDeferred: true, skipHoldPrompt: true });
  return true;
}

/**
 * Collapse a GUARD STANCE (design-guard-stances, RULED 2026-08-21:
 * "moving or attacking drops it"; dodging drops it too — in guard you
 * answer with the parry, not footwork). ONE implementation for the
 * declare gates, the dodge branch, and any future drop site.
 *
 * @param {Combatant} combatant  the guarding combatant
 * @param {string} [via]         what lowered the guard, for the chat line
 * @returns {Promise<boolean>}   true if a stance was actually dropped
 */
export async function collapseGuardStance(combatant, via = '') {
  const stance = combatant?.flags?.aspectsofpower?.guardStance;
  const actor = combatant?.actor;
  if (!stance || !actor) return false;
  await _safeCombatantUpdate(combatant, { 'flags.aspectsofpower.guardStance': null });
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name}'s guard drops${via ? ` — ${via}` : ''}.</em></p>` });
  return true;
}

/**
 * Trigger scan (VARIABLE HOLD, user 2026-08-16: "hold until allied/enemy
 * action"): after any combatant's action fires, release every held cast
 * whose trigger matches the firer's disposition relative to the holder.
 * The release follows the triggering action — a readied working flies as
 * the trigger completes, it does not interrupt it.
 */
export async function checkHeldCastTriggers(combat, firedCombatant) {
  if (!combat || !firedCombatant) return;
  const firerDisp = firedCombatant.token?.disposition;
  if (firerDisp === undefined || firerDisp === null) return;
  for (const c of combat.combatants) {
    if (c.id === firedCombatant.id) continue;
    const held = c.flags?.aspectsofpower?.heldCast;
    if (!held || held.trigger === 'manual' || !held.trigger) continue;
    const holderDisp = c.token?.disposition;
    const isAlly = holderDisp === firerDisp;
    if ((held.trigger === 'ally' && isAlly) || (held.trigger === 'enemy' && !isAlly)) {
      await releaseHeldCast(c, isAlly ? 'an ally acting' : 'an enemy acting');
    }
  }
}

/** Record which hand just fired a weapon attack (dual-wield rotation state).
 *  No-op out of combat — there is no rotation to track without a clock. */
export async function setLastSwungHand(actor, hand) {
  if (hand !== 'main' && hand !== 'off') return;
  const combatant = findCombatantForActor(actor);
  if (!combatant) return;
  if ((combatant.flags?.aspectsofpower?.lastSwungHand ?? null) === hand) return;
  await _safeCombatantUpdate(combatant, { 'flags.aspectsofpower.lastSwungHand': hand });
}

export async function addScrambleStack(actor) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return 0;
  const current = getScrambleStacks(actor);
  const now = getClockTick(combatant.combat);
  await _safeCombatantUpdate(combatant, { 'flags.aspectsofpower.scramble': { stacks: current + 1, atTick: now } });
  return current + 1;
}

/**
 * Dodge time cost — defense steals tempo from offense. Basis is the
 * defender's OWN action wait (self-relative across grades/archetypes):
 * the queued action's wait when one is declared (its scheduled fire is
 * pushed back), else the last action's wait, else a baseline-weight dex
 * step. With no queued action the cost accrues as dodgeDebt, consumed by
 * the next declareAction. Returns the tick cost (0 out of combat).
 */
export async function applyDodgeCost(actor) {
  const dt = CONFIG.ASPECTSOFPOWER.defenseTuning ?? {};
  const frac = dt.dodgeCostFraction ?? 0.25;
  const combatant = findCombatantForActor(actor);
  if (!combatant) return 0;
  const fl = combatant.flags?.aspectsofpower ?? {};
  const da = fl.declaredAction;

  let basis;
  if (da?.wait) basis = da.wait;
  else if (fl.lastActionWait) basis = fl.lastActionWait;
  else {
    const sc = CONFIG.ASPECTSOFPOWER.celerity;
    const dex = Math.max(1, actor.system.abilities?.dexterity?.mod ?? 1);
    basis = Math.round(sc.BASELINE_WEIGHT * sc.SCALE / dex);
  }
  const cost = Math.max(1, Math.round(frac * basis));

  if (da?.scheduledTick != null) {
    await _safeCombatantUpdate(combatant, {
      'flags.aspectsofpower.declaredAction.scheduledTick': da.scheduledTick + cost,
      'flags.aspectsofpower.nextActionTick': (fl.nextActionTick ?? da.scheduledTick) + cost,
    });
  } else {
    await _safeCombatantUpdate(combatant, { 'flags.aspectsofpower.dodgeDebt': (fl.dodgeDebt ?? 0) + cost });
  }
  return cost;
}

/**
 * Charge the actor a fraction of their own action wait, outside the normal
 * declare/fire path — the same debt mechanism a dodge uses, generalised.
 *
 * Reaching into folded space is the first consumer (design-spatial-storage):
 * retrieving costs an action, and expressing it as a FRACTION OF OWN TEMPO
 * rather than flat ticks means a fast character loses less clock than a slow
 * one, exactly like every other timing in the system.
 *
 * Returns 0 out of combat — there is no clock to charge against.
 *
 * @param {Actor} actor
 * @param {number} fraction  Multiple of the actor's baseline action wait.
 * @returns {Promise<number>} ticks charged.
 */
export async function chargeActionCost(actor, fraction = 1.0) {
  const combatant = findCombatantForActor(actor);
  if (!combatant || !(fraction > 0)) return 0;
  const fl = combatant.flags?.aspectsofpower ?? {};
  const da = fl.declaredAction;

  let basis;
  if (da?.wait) basis = da.wait;
  else if (fl.lastActionWait) basis = fl.lastActionWait;
  else {
    const sc = CONFIG.ASPECTSOFPOWER.celerity;
    const dex = Math.max(1, actor.system.abilities?.dexterity?.mod ?? 1);
    basis = Math.round(sc.BASELINE_WEIGHT * sc.SCALE / dex);
  }
  const cost = Math.max(1, Math.round(fraction * basis));

  if (da?.scheduledTick != null) {
    await _safeCombatantUpdate(combatant, {
      'flags.aspectsofpower.declaredAction.scheduledTick': da.scheduledTick + cost,
      'flags.aspectsofpower.nextActionTick': (fl.nextActionTick ?? da.scheduledTick) + cost,
    });
  } else {
    await _safeCombatantUpdate(combatant, { 'flags.aspectsofpower.dodgeDebt': (fl.dodgeDebt ?? 0) + cost });
  }
  return cost;
}

/**
 * Find the actor's combatant in the active combat (if any).
 * Returns null when the actor isn't in combat or no combat is started.
 */
export function findCombatantForActor(actor) {
  const combat = game.combat;
  if (!combat?.started || !actor) return null;
  const token = actor.getActiveTokens?.()[0];
  // Token match first — it is the only way to tell two tokens of the same
  // actor apart. But FALL BACK TO actorId whenever that misses, not only when
  // there is no token at all: getActiveTokens returns tokens on the VIEWED
  // scene, so an actor standing on a different scene from the combat matched
  // nothing and silently read as 'not in combat'. Anything that charges a
  // cost through this then charged zero without complaining — found when a
  // spatial retrieve cost 0 ticks against a combat left on another map.
  if (token) {
    const byToken = combat.combatants.find(c => c.tokenId === token.id);
    if (byToken) return byToken;
  }
  return combat.combatants.find(c => c.actorId === actor.id) ?? null;
}

/**
 * Read the clock tick on the combat document. Combats start at tick 0.
 *
 * While the realtime loop runs, the clock flows CONTINUOUSLY: the stored
 * flag is only committed at pause/fire boundaries, and between them the
 * effective tick is clockAtStart + elapsed wall time × the realtime rate.
 * Everything that reads the clock (declares, scramble decay, the overlay's
 * progress dot) therefore sees time passing during play instead of a value
 * frozen since the last fire. At rest the stored flag is the authority.
 */
export function getClockTick(combat = game.combat) {
  const f = combat?.flags?.aspectsofpower;
  return effectiveClockTick(f?.realtime, Date.now(), f?.clockTick ?? 0);
}

/**
 * The shortest reference round among the combatants — the realtime anchor:
 * this round plays out over REALTIME_FASTEST_ROUND_SECONDS of wall time.
 */
export function fastestReferenceRound(combat) {
  let min = Infinity;
  for (const cm of combat?.combatants ?? []) {
    const rl = cm.actor?.system?.attributes?.race?.level ?? 1;
    const len = referenceRoundLength(rl);
    if (Number.isFinite(len) && len > 0 && len < min) min = len;
  }
  return Number.isFinite(min) ? min : 1000;
}

/**
 * Celerity ticks per wall-clock millisecond for this combat. Reads the rate
 * pinned on the running realtime flag when present (so every client computes
 * with the same number the loop started with); otherwise derives it fresh.
 * This single rate couples the continuous clock, the fire delays, and every
 * glide speed — one mapping, no drift between them.
 */
export function realtimeTicksPerMs(combat) {
  const pinned = combat?.flags?.aspectsofpower?.realtime?.ticksPerMs;
  if (pinned > 0) return pinned;
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const secs = sc.REALTIME_FASTEST_ROUND_SECONDS ?? 5;
  return fastestReferenceRound(combat) / (secs * 1000);
}

/**
 * Record that `actor` just fired `skill` — schedule their next action tick
 * relative to the combat clock. Stores on the combatant's flags so the
 * tracker UI and any future state restore can read it. No-op if the actor
 * isn't in active combat.
 *
 * Used by the LEGACY observer path (now superseded by declareAction +
 * deferred firing) and by paths that fire actions outside the queue model.
 *
 * @returns {object|null} { wait, scheduledTick, lastActionName } or null
 */
export async function recordActionFired(actor, skill) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return null;
  const wait = computeActionWait(actor, skill);
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;
  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.nextActionTick': scheduledTick,
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': skill.name,
    'flags.aspectsofpower.lastActionAt':   clockTick,
  });
  return { wait, scheduledTick, lastActionName: skill.name };
}

/**
 * Declare an action in combat — queues the skill on the combatant's
 * declaredAction flag without firing it. The tracker's "Advance to next"
 * fires it later via `item.roll({ executeDeferred: true })` when the clock
 * reaches the scheduled tick.
 *
 * @returns {object|null} { wait, scheduledTick } or null if not in combat
 *                        / actor already has a queued action
 */
export async function declareAction(actor, skill, options = {}) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return null;
  // A corpse can't act — mirror of the declareMovement guard.
  if ((actor.system?.health?.value ?? 1) <= 0) {
    ui.notifications.warn(`${actor.name} is incapacitated.`);
    return null;
  }

  // GUARD STANCE: attacking (any non-Reaction action that isn't itself a
  // stance) drops the guard — RULED 2026-08-21 "moving or attacking drops
  // it". The action proceeds; the guard falls with it. Reactions live.
  if (combatant.flags?.aspectsofpower?.guardStance
      && skill?.system?.skillType !== 'Reaction'
      && !(skill?.system?.tags ?? []).includes('stance')) {
    await collapseGuardStance(combatant, `readying ${skill?.name ?? 'an action'}`);
  }

  // ── Concurrency gate (design-concurrent-actions, RULED 2026-07-14) ──
  // A movement in flight (declaredMovement track) COEXISTS with the declare
  // only when it's a WALK and the skill is `mobile`-tagged (potion, pistol
  // shot, wand bolt — no count limit; each paces by its own wait). Any other
  // combination CANCELS the movement and declares — the change-your-mind
  // rule extended to cross-track (2026-08-09; the old hard refusal plus
  // `mobile` on zero content froze every walking actor out of acting). The
  // token holds wherever its glide had reached; the celerity spent is sunk,
  // no stamina charged, per design.
  let qm = combatant.flags?.aspectsofpower?.declaredMovement;
  if (qm && qm.itemId) {
    const skillMobile = (skill?.system?.tags ?? []).includes('mobile');
    const coexists = qm.movementMode === 'walk' && skillMobile;
    if (!coexists) {
      if (combatant.token) await stopDeclaredMove(combatant.token);
      await _safeCombatantUpdate(combatant, {
        'flags.aspectsofpower.declaredMovement': null,
        'flags.aspectsofpower.nextActionTick': null,
      }, { _aopCancelRedeclare: true });
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${actor.name} halts mid-move to ready <strong>${skill.name}</strong>.</em></p>`,
      });
      qm = null;
    }
  }

  // Any existing declaration is auto-overridden by the new one. Per user
  // 2026-05-11: players can change their mind at will. EXCEPT: leap-in-
  // flight is committed motion (the actor is conceptually mid-air during
  // the celerity wait between declare and fire — Newton's first law: an
  // object in motion stays in motion until acted on by an external force).
  // Override is refused with a toast. The prior action's placed AOE region
  // (if any) is cleaned up automatically by the preUpdateCombatant orphan-
  // cleanup hook when declaredAction changes.
  const existing = combatant.flags?.aspectsofpower?.declaredAction;
  if (existing && existing.itemId) {
    if (existing.uncancellable) {
      ui.notifications.warn(`${actor.name} is mid-${existing.label} — cannot redirect until it resolves.`);
      return null;
    }
    // _aopCancelRedeclare marks this null transition as a CANCEL-to-replace,
    // NOT an action firing. The AI dispatch hook (ai.mjs) must ignore it —
    // otherwise re-declaring (cancel → set) reads as "action fired" and
    // re-triggers onActionReady, an infinite machine-speed attack loop
    // (live bug 2026-06-14: Felicia/skirmisher → 21k messages).
    await _safeCombatantUpdate(combatant, {
      'flags.aspectsofpower.declaredAction': null,
      'flags.aspectsofpower.nextActionTick': null,
    }, { _aopCancelRedeclare: true });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><em>${actor.name} cancels <strong>${existing.label}</strong> to declare <strong>${skill.name}</strong>.</em></p>`,
    });
  }

  const investAmount = options.investAmount ?? null;
  // CO-INVEST (systems/co-invest.mjs): the second pool's commitment, captured
  // at declare time so the deferred fire re-spends it without re-prompting.
  // The RESOURCE travels with the amount — `infused` mana, `effort` stamina
  // and `life-drain` health all land in this one field, and the fire path has
  // no other way to know which pool the number refers to.
  const coInvestAmount = options.coInvestAmount ?? options.manaInvestAmount ?? null;
  const coInvestResource = options.coInvestResource ?? (options.manaInvestAmount != null ? 'mana' : '');
  // Kept MANA-ONLY beside it: computeActionWait charges channel time from this
  // and the power-sense overlay reads it as magical output. Exertion and blood
  // are neither channelled nor magical, so they must not appear here.
  const manaInvestAmount = (coInvestResource === 'mana') ? coInvestAmount : null;
  // Static AOE: the region the player placed at declare time persists on the
  // scene during the wait. Stored here so the fire-time path can look it up
  // and skip re-prompting for placement (per design — AOE is a strategic
  // commit at declare time, not a re-decision at fire time).
  const aoeRegionId = options.aoeRegionId ?? null;
  // Orb discharge: when the cast was declared as a discharge (banked charge ≥
  // threshold), persist the decision so the deferred fire honors it even if
  // the actor's spellCharge changes between declare and fire (another spell
  // banked or discharged in the meantime).
  const orbDischarging = options.orbDischarging ?? false;
  // Targets picked at declare time, snapshotted so the deferred fire can
  // restore game.user.targets (which may have been cleared by then).
  const targetIds = options.targetIds ?? [];
  // Teleport / Leap destinations captured at declare time. selectDestinationOnCanvas
  // validates range + (for teleport) sight at the moment of pick; the destination
  // is committed even if vision changes during the wait.
  const teleportDestination = options.teleportDestination ?? null;
  const leapDestination     = options.leapDestination ?? null;
  const leapApexFt          = options.leapApexFt ?? null;
  const ritualActivation    = options.ritualActivation ?? false;
  // AI-declared attacks carry this so the deferred fire (tracker / socket)
  // auto-invests base cost instead of opening a resource dialog nobody can
  // answer for an NPC. Must survive declare→fire like ritualActivation.
  const aiAutoInvest        = options.aiAutoInvest ?? false;

  // Distance from caster to picked destination, in feet — feeds distance-
  // scaled granted-tag activation fraction (shorter teleport = faster cast).
  let distanceFt = null;
  const _dest = teleportDestination ?? leapDestination;
  if (_dest) {
    const tok = actor.getActiveTokens?.()?.[0];
    if (tok && canvas?.grid) {
      const dx = _dest.x - tok.center.x;
      const dy = _dest.y - tok.center.y;
      const px = Math.hypot(dx, dy);
      distanceFt = px * canvas.grid.distance / canvas.grid.size;
    }
  }
  let wait = computeActionWait(actor, skill, null, investAmount, manaInvestAmount, distanceFt);
  // Consume accumulated dodge debt — dodges made while nothing was queued
  // delay the next declaration (active defense steals tempo from offense;
  // see applyDodgeCost).
  const dodgeDebt = combatant.flags?.aspectsofpower?.dodgeDebt ?? 0;
  if (dodgeDebt > 0) wait += dodgeDebt;
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;

  // Leap is committed motion from declare to fire (Newton's first law:
  // the actor is conceptually mid-air during the wait). Refuse override
  // attempts. Teleport stays cancellable — it's a spell channel, not
  // physical motion; the spell hasn't completed until fire.
  const skillTags = skill?.system?.tags ?? [];
  const uncancellable = skillTags.includes('leap');

  // Stamp the weapon this action was PRICED with (design-dual-wield-tempo,
  // adversarial finding): wait is computed at declare, the weapon used to
  // resolve at fire — so equipping a heavier weapon mid-windup fired heavy
  // damage at light tempo. The fire path pins resolution to this id (while
  // it is still equipped), closing the swap and keeping rotation pricing
  // and payload on the same blade.
  const declaredWeaponId = skill?._resolveWeaponForSkill?.()?.id ?? null;
  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.declaredAction': {
      itemId: skill.id,
      label: skill.name,
      weaponId: declaredWeaponId,
      wait,
      scheduledTick,
      declaredAtTick: clockTick,
      investAmount,
      coInvestAmount,
      coInvestResource,
      manaInvestAmount,
      aoeRegionId,
      orbDischarging,
      targetIds,
      teleportDestination,
      leapDestination,
      leapApexFt,
      uncancellable,
      // Ritual-via-Medium activation: the prep mana was the only payment.
      // Must survive the declare→fire round-trip or the activator gets
      // charged the invest as mana at fire time (live bug 2026-06-12).
      ritualActivation,
      aiAutoInvest,
    },
    // Two parallel tracks: "next up" is the sooner of skill + movement.
    'flags.aspectsofpower.nextActionTick': Math.min(
      scheduledTick,
      (typeof qm?.scheduledTick === 'number') ? qm.scheduledTick : Infinity,
    ),
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': skill.name + ' (queued)',
    'flags.aspectsofpower.dodgeDebt': 0,
  });

  const investNote = investAmount ? ` — invest ${investAmount}` : '';
  const infusedNote = coInvestAmount ? ` (+${coInvestAmount} ${coInvestResource || 'mana'})` : '';
  const aoeNote = aoeRegionId ? ' [AOE placed]' : '';
  const orbNote = orbDischarging ? ' [orb discharge]' : '';
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> declares <strong>${skill.name}</strong>${investNote}${infusedNote}${aoeNote}${orbNote} — scheduled for tick <strong>${scheduledTick}</strong> (wait ${wait}).</p>`,
  });

  return { wait, scheduledTick, investAmount, coInvestAmount, coInvestResource, manaInvestAmount, aoeRegionId, orbDischarging, targetIds };
}

/**
 * True when `actor` is in an active combat as a combatant. Helper for the
 * defer check in item.roll().
 */
export function isInActiveCombat(actor) {
  const c = findCombatantForActor(actor);
  return !!(c?.combat?.started);
}

/**
 * Fire round-START mechanics for a combatant whose personal reference round
 * has just begun. Per design-celerity.md "Round-Anchored Mechanics", this
 * delegates to (in order):
 *   1. DoT damage from any effect this actor placed — DoTs tick at the
 *      START of the caster's reference round per user 2026-05-11. The
 *      pattern is: tick once on application (immediate, in
 *      _handleDebuffTag) then again at the start of each subsequent
 *      caster round.
 *   2. actor.onStartTurn (effect expiry, sustain upkeep, regen,
 *      reactions reset, debuff break rolls).
 *
 * Called by the celerity tracker's advance handler once per round
 * boundary crossed, per actor. The boundary tick is simultaneously the
 * end of round N and the start of round N+1; we now phrase it as
 * "round starts" since that better reflects the design intent.
 */
export async function runRoundStart(combat, combatant) {
  const actor = combatant.actor;
  if (!actor) return;

  // Player-visible round-start announcement. PCs see it broadcast; NPCs
  // whisper-to-GM only so player chat doesn't fill with enemy round ticks.
  const isPC = !!actor.hasPlayerOwner;
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name}'s reference round begins.</em></p>`,
    ...(isPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') }),
  });

  // 1. DoTs: any effect placed by this actor on any combatant ticks now.
  //    Fired BEFORE the caster's own onStartTurn so debuff DoTs land at
  //    the canonical "start of caster round" moment.
  // Stacks are parallel effects but their damage POOLS before DR is charged
  // once — shared with the legacy turn tick via systems/dot.mjs so the two
  // paths cannot drift apart again.
  await tickDotsFor(combat, actor.uuid);

  // 2. The actor's own round-start mechanics: regen, sustain upkeep,
  //    debuff break rolls, effect expiry. Despite the legacy name, this
  //    is now firing at round START (boundary == end of N == start of N+1
  //    — same tick).
  if (typeof actor.onStartTurn === 'function') {
    try {
      await actor.onStartTurn(combat, { combatantId: combatant.id });
    } catch (e) {
      console.error('Celerity round-start onStartTurn failed for', actor.name, e);
    }
  }

  // 3. Round-start re-evaluation beat. Fires AFTER onStartTurn (so regen has
  //    landed). AI listens for this to recover INERT combatants — ones whose
  //    last decision produced no declaredAction (no affordable skill, no
  //    reachable target, or a move that left declaredAction null). The
  //    dispatch hook only fires on a declaredAction set→null TRANSITION, so an
  //    already-null AI never re-evaluates on its own; this is its safety net.
  Hooks.callAll('aopRoundStart', combat, combatant);
}


/** Sentinel itemId stored on `declaredAction` to mark a movement entry. */
export const MOVEMENT_ITEM_ID = '__movement__';

/** Sentinel itemId stored on `declaredAction` to mark a manual break-free attempt. */
export const BREAK_FREE_ITEM_ID = '__breakFree__';

/**
 * Resolve a movement mode key (or unknown input) to a valid mode config
 * from CONFIG.ASPECTSOFPOWER.celerity.MOVEMENT_MODES. Falls back to the
 * configured default ('walk').
 *
 * @param {string} [modeKey]
 * @returns {{key:string, celerityMult:number, staminaMult:number, label:string}}
 */
export function resolveMovementMode(modeKey) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const modes = sc.MOVEMENT_MODES ?? {};
  const defaultKey = sc.DEFAULT_MOVEMENT_MODE ?? 'walk';
  const key = modes[modeKey] ? modeKey : defaultKey;
  return { key, ...modes[key] };
}

/** Shared Shift-state read — the momentary sprint override. Single source of
 *  truth for what used to be four separate copies (movement UX 2026-07-14). */
export function isShiftHeld() {
  const dk = game.keyboard?.downKeys;
  if (!dk) return false;
  return dk.has('ShiftLeft') || dk.has('ShiftRight') || dk.has('Shift');
}

/**
 * The actor's ACTIVE movement mode key (movement UX overhaul 2026-07-14):
 *   1. Shift held → sprint (momentary override, preserved legacy gesture)
 *   2. actor's persisted preference (flags.aspectsofpower.movementMode,
 *      set by the token-HUD walk/sprint toggle)
 *   3. config default ('walk')
 */
export function getActiveMovementMode(actor) {
  if (isShiftHeld()) return 'sprint';
  const pref = actor?.flags?.aspectsofpower?.movementMode;
  const modes = CONFIG.ASPECTSOFPOWER.celerity?.MOVEMENT_MODES ?? {};
  if (pref && modes[pref]) return pref;
  return CONFIG.ASPECTSOFPOWER.celerity?.DEFAULT_MOVEMENT_MODE ?? 'walk';
}

/**
 * Movement stamina cost — ONE formula for every input path (drag preview,
 * WASD buffer, declare). Pre-2026-07-14 the buffer had its own copy that
 * omitted movementStaminaMultiplier, so the same move could cost different
 * stamina depending on input method.
 *   cost = distFt × 0.2 × mode.staminaMult × (1 + carryRatio) × movementStaminaMultiplier
 */
export function computeMovementStamina(actor, distanceFt, modeKey) {
  const m = resolveMovementMode(modeKey);
  const carryRatio = Math.max(0, actor?.system?.carryRatio ?? 0);
  const fxMult = Math.max(0, actor?.system?.movementStaminaMultiplier ?? 1);
  return Math.ceil(distanceFt * 0.2 * (m.staminaMult ?? 1) * (1 + carryRatio) * fxMult);
}

/**
 * Compute movement wait in ticks for `distanceFt` traveled by `actor`.
 *   wait = (distanceFt / 5) × MOVEMENT_BASE_WEIGHT_PER_5FT × mode.celerityMult × SCALE / (dex.mod × movementSpeedMultiplier)
 *
 * Active-effect-driven movementSpeedMultiplier (Stormstride, Haste, Slow) is
 * an additional divisor on the wait — > 1 = faster, < 1 = slower. Aggregated
 * multiplicatively across non-disabled effects in actor.prepareDerivedData.
 *
 * @param {Actor}  actor
 * @param {number} distanceFt
 * @param {string} [mode]  Movement mode key ('walk' | 'sprint'); defaults to walk.
 * @returns {number} wait in ticks (min 1)
 */
export function computeMovementWait(actor, distanceFt, mode, pricedFt = null) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const moveBaseWeight = sc.MOVEMENT_BASE_WEIGHT_PER_5FT ?? 10;
  const dexMod = Math.max(1, actor.system.abilities?.dexterity?.mod ?? 0);
  const m = resolveMovementMode(mode);
  const speedMult = Math.max(0.01, actor.system.movementSpeedMultiplier ?? 1);
  // TIME prices the EFFECTIVE distance (threatened ground + slowing terrain,
  // priceMovementPath); STAMINA stays on the real feet walked — moving
  // carefully through a guard's reach is slow, not tiring.
  const timeFt = pricedFt ?? distanceFt;
  return Math.max(1, Math.round((timeFt / 5) * moveBaseWeight * m.celerityMult * sc.SCALE / (dexMod * speedMult)));
}

/**
 * Declare a movement on the celerity stack — does NOT commit the position.
 * The token sprite stays where it is until the celerity advance handler
 * reaches the movement's scheduledTick (or partway, for animate-on-pause).
 *
 * The movement is stored on `combatant.flags.aspectsofpower.declaredAction`
 * with `itemId = MOVEMENT_ITEM_ID` (a sentinel — not a real Item id). The
 * tracker recognizes this sentinel and runs movement-execute logic instead
 * of dispatching a skill roll.
 *
 * Replaces the legacy `chargeMovementCelerity` immediate-charge path —
 * movement is now a queued action like any other.
 *
 * @param {Actor}  actor
 * @param {{x:number, y:number}} startPos   Token's current canvas position
 * @param {{x:number, y:number}} endPos     Intended destination
 * @param {number} distanceFt               Distance for cost / wait math
 * @param {number} staminaCost              Stamina to debit at execute time (mode-scaled by caller)
 * @param {string} [mode]                   Movement mode key ('walk' | 'sprint'); defaults to walk.
 * @returns {Promise<{wait, scheduledTick}|null>}
 */
/**
 * No-stacking + shared-faction passthrough clamp (gridless footprint check).
 *
 * Two faction rules, both on token footprints (circles of radius max(w,h)/2,
 * "overlap" = centre distance < sum of radii):
 *  - SHARED-FACTION (same disposition) tokens are PASSABLE: a move may pass
 *    THROUGH them mid-transit; only the final resting footprint must be clear.
 *  - CROSS-FACTION (different disposition) tokens are SOLID: they block transit
 *    like a wall — the move stops just before its footprint would touch one.
 *  - The END position must not overlap ANYONE (no stacking, either faction).
 *
 * Returns the furthest reachable point along start→end satisfying all three.
 * Pre-stacked start → returns the furthest point (let it move to separate).
 * @param {TokenDocument} tokenDoc  the moving token
 * @param {{x,y}} fromPos  top-left start
 * @param {{x,y}} toPos    top-left intended destination
 * @returns {{x,y}} clamped top-left destination
 */
/** Per-side token spacing gap in px beyond edge-touching — tunable breathing
 *  room. 0 (default) = tokens may stand edge-adjacent. */
function _tokenGapPx() { return CONFIG.ASPECTSOFPOWER?.movement?.tokenGapPx ?? 0; }

/** Axis-aligned footprint overlap of two boxes (top-left x/y + size w/h),
 *  inflated by a per-side gap g. Returns the centre-overlap on each axis;
 *  the boxes intersect (within the gap) iff BOTH ox AND oy are > 0. Uses width
 *  AND height — NOT a single radius — so rectangular + large tokens space
 *  correctly. The same predicate drives the no-overlap clamp AND the bump, and
 *  the per-axis overlaps feed the bump's minimum-translation separation. */
function _boxOverlap(ax, ay, aw, ah, bx, by, bw, bh, g) {
  const ox = (aw + bw) / 2 + g - Math.abs((ax + aw / 2) - (bx + bw / 2));
  const oy = (ah + bh) / 2 + g - Math.abs((ay + ah / 2) - (by + bh / 2));
  return { ox, oy };
}

export function clampMoveNoOverlap(tokenDoc, fromPos, toPos) {
  const scene = tokenDoc?.parent;
  if (!scene) return toPos;
  const gs = scene.grid?.size ?? 100;
  const selfW = (tokenDoc.width ?? 1) * gs, selfH = (tokenDoc.height ?? 1) * gs;
  const selfDisp = tokenDoc.disposition;
  const g = _tokenGapPx();
  const obstacles = [];
  for (const t of scene.tokens) {
    if (t.id === tokenDoc.id || t.hidden) continue;
    obstacles.push({ x: t.x, y: t.y, w: (t.width ?? 1) * gs, h: (t.height ?? 1) * gs, enemy: t.disposition !== selfDisp });
  }
  if (!obstacles.length) return toPos;
  const lerp = (t) => ({ x: fromPos.x + (toPos.x - fromPos.x) * t, y: fromPos.y + (toPos.y - fromPos.y) * t });
  const hits = (p, set) => {
    for (const o of set) {
      const { ox, oy } = _boxOverlap(p.x, p.y, selfW, selfH, o.x, o.y, o.w, o.h, g);
      if (ox > 0.5 && oy > 0.5) return true;
    }
    return false;
  };
  const enemies = obstacles.filter(o => o.enemy);
  const STEPS = 48;

  // 1. Cross-faction bodies block transit. Find the last step before the
  //    footprint first contacts an enemy along the path (full path if none).
  let tMax = 1;
  if (enemies.length) {
    for (let i = 1; i <= STEPS; i++) {
      if (hits(lerp(i / STEPS), enemies)) { tMax = (i - 1) / STEPS; break; }
    }
  }
  // 2. Within reach [0, tMax], stop at the furthest point whose resting
  //    footprint overlaps NOBODY (passed-through allies must not be the final
  //    resting square either). Pre-stacked start → just go as far as allowed.
  if (hits(fromPos, obstacles)) return lerp(tMax);
  const top = Math.round(tMax * STEPS);
  for (let i = top; i >= 0; i--) {
    const p = lerp(i / STEPS);
    if (!hits(p, obstacles)) return p;
  }
  return { x: fromPos.x, y: fromPos.y };
}

/**
 * Transit-only enemy contact test for ONE checkpoint segment of an
 * executing movement (v14 rework, "reality wins" ruling 2026-08-09).
 *
 * Deliberately NOT clampMoveNoOverlap: intermediate checkpoints may land
 * mid-passthrough of an ALLY (legal — allies never block transit), so the
 * full clamp's end-must-be-clear rule would false-halt a walk that is
 * simply ghosting past a friend. Only a cross-faction body along the
 * segment halts it. End-overlap hygiene stays with the declare-time clamp
 * and the post-arrival bump.
 *
 * @param {TokenDocument} tokenDoc
 * @param {{x,y}} fromPos  segment start (top-left)
 * @param {{x,y}} toPos    segment end (top-left)
 * @returns {boolean} true if an enemy footprint blocks the segment
 */
export function enemyBlocksSegment(tokenDoc, fromPos, toPos) {
  const scene = tokenDoc?.parent;
  if (!scene) return false;
  const gs = scene.grid?.size ?? 100;
  const selfW = (tokenDoc.width ?? 1) * gs, selfH = (tokenDoc.height ?? 1) * gs;
  const g = _tokenGapPx();
  const enemies = [];
  for (const t of scene.tokens) {
    if (t.id === tokenDoc.id || t.hidden) continue;
    if (t.disposition === tokenDoc.disposition) continue;
    enemies.push({ x: t.x, y: t.y, w: (t.width ?? 1) * gs, h: (t.height ?? 1) * gs });
  }
  if (!enemies.length) return false;
  const STEPS = 16; // one segment is at most a couple of squares — 16 is dense
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const px = fromPos.x + (toPos.x - fromPos.x) * t;
    const py = fromPos.y + (toPos.y - fromPos.y) * t;
    for (const o of enemies) {
      const { ox, oy } = _boxOverlap(px, py, selfW, selfH, o.x, o.y, o.w, o.h, g);
      if (ox > 0.5 && oy > 0.5) return true;
    }
  }
  return false;
}

/**
 * Equidistant bump: after movements land, symmetrically separate any tokens
 * whose footprints ended overlapping. Two units converging on the SAME point
 * (the stop-short clamp checks bodies at declare time, not each other's
 * simultaneous arrival, so a small residual overlap can survive) push apart
 * EQUALLY — neither claims the spot. Separation is the axis-aligned minimum
 * translation (push along the axis of least overlap, half each), using each
 * token's width × height, so large + rectangular tokens carve out the right
 * room. A few relaxation passes resolve small cascades. Tokens are moved with
 * the `_celerityCommit` flag so the move pipeline doesn't re-declare them.
 * @param {Scene} scene
 */
export async function separateOverlappingTokens(scene) {
  if (!scene) return;
  const gs = scene.grid?.size ?? 100;
  // Tokens still IN TRANSIT (a pending movement that hasn't reached its tick yet)
  // are exempt — they pass THROUGH others during flight; only their final landing
  // separates. Without this the bump fights the per-tick interpolation (push out,
  // slide back toward the unchanged endPos), so mid-flight overlaps reappear.
  const combat = game.combat;
  const inFlight = new Set();
  if (combat?.started) {
    const clock = getClockTick(combat);
    for (const cm of combat.combatants) {
      const da = cm.flags?.aspectsofpower?.declaredMovement;
      if (da?.itemId === MOVEMENT_ITEM_ID && typeof da.scheduledTick === 'number' && da.scheduledTick > clock) {
        inFlight.add(cm.tokenId);
      }
    }
  }
  const g = _tokenGapPx();
  const info = scene.tokens.filter(t => !t.hidden && !inFlight.has(t.id)).map(t => ({
    doc: t, x: t.x, y: t.y, w: (t.width ?? 1) * gs, h: (t.height ?? 1) * gs, moved: false,
  }));
  if (info.length < 2) return;
  let any = false;
  for (let iter = 0; iter < 4; iter++) {
    let movedThisIter = false;
    for (let a = 0; a < info.length; a++) {
      for (let b = a + 1; b < info.length; b++) {
        const A = info[a], B = info[b];
        const { ox, oy } = _boxOverlap(A.x, A.y, A.w, A.h, B.x, B.y, B.w, B.h, g);
        if (ox <= 0.5 || oy <= 0.5) continue; // separated on an axis → no overlap
        // Minimum-translation separation: push along the axis of LEAST overlap
        // (smallest move that frees them), half each (equidistant). +0.5 clears
        // the threshold. Uses footprint w/h, so big/rectangular tokens carve out
        // the right amount of room on each axis.
        if (ox < oy) {
          const dir = (A.x + A.w / 2) <= (B.x + B.w / 2) ? -1 : 1;
          const s = ox / 2 + 0.5; A.x += dir * s; B.x -= dir * s;
        } else {
          const dir = (A.y + A.h / 2) <= (B.y + B.h / 2) ? -1 : 1;
          const s = oy / 2 + 0.5; A.y += dir * s; B.y -= dir * s;
        }
        A.moved = B.moved = true; movedThisIter = true; any = true;
      }
    }
    if (!movedThisIter) break;
  }
  if (!any) return;
  // Per-token update (not bulk) so the `_celerityCommit` operation flag reaches
  // each TokenDocument#_preUpdateMovement and bypasses the move-declare pipeline
  // — mirrors the animate-on-pause path. A bulk updateEmbeddedDocuments does NOT
  // propagate the flag, so the pipeline cancels the separation (the bump silently
  // no-ops and units stay overlapping).
  await Promise.all(info.filter(i => i.moved).map(i =>
    i.doc.update({ x: Math.round(i.x), y: Math.round(i.y) }, { animation: { duration: 150 }, _celerityCommit: true })
      .catch(e => console.warn('[celerity] bump move failed:', e))
  ));
}

export async function declareMovement(actor, startPos, endPos, distanceFt, staminaCost, mode) {
  // ROOTED WHILE HOLDING A CAST (ruled 2026-08-16: "no movement but you can
  // use reactions"). Release or collapse the working to move.
  {
    const _cbt = findCombatantForActor(actor);
    if (_cbt?.flags?.aspectsofpower?.heldCast) {
      ui.notifications.warn(`${actor.name} is holding a completed working and cannot move.`);
      return null;
    }
    // GUARD STANCE: moving drops the guard (RULED 2026-08-21). Unlike the
    // held cast above, the movement PROCEEDS — you may always walk away
    // from your own posture; it just stops protecting you.
    if (_cbt?.flags?.aspectsofpower?.guardStance) {
      await collapseGuardStance(_cbt, 'stepping out of the posture');
    }
  }
  const combatant = findCombatantForActor(actor);
  if (!combatant) return null;
  if (distanceFt <= 0) return null;
  // A corpse can't walk. Incapacitation already unqueues both tracks; this
  // stops NEW declares (a drag of a downed token, a stale AI decision).
  if ((actor.system?.health?.value ?? 1) <= 0) {
    ui.notifications.warn(`${actor.name} is incapacitated.`);
    return null;
  }

  // ── Concurrency gate (design-concurrent-actions, RULED 2026-07-14) ──
  // Movement runs on its OWN track (declaredMovement) parallel to the skill
  // track (declaredAction). A WALK alongside a `mobile`-tagged skill keeps
  // BOTH. Any other combination CANCELS the queued skill and moves — the
  // change-your-mind rule (user 2026-05-11: "players can change their mind
  // at will") extended to movement 2026-08-09: with `mobile` on zero
  // content, the old hard refusal made every queued skill read as a frozen,
  // rubberbanding token. Sunk celerity is the price, per design. Only an
  // uncancellable action (leap in flight) still refuses.
  const _modeKey = resolveMovementMode(mode).key;
  let qa = combatant.flags?.aspectsofpower?.declaredAction;
  if (qa && qa.itemId) {
    const qaItem = actor.items?.get(qa.itemId);
    const qaMobile = (qaItem?.system?.tags ?? []).includes('mobile');
    const coexists = _modeKey === 'walk' && qaMobile;
    if (!coexists) {
      if (qa.uncancellable) {
        ui.notifications.warn(`${actor.name} is mid-${qa.label} — cannot move until it resolves.`);
        return null;
      }
      await _safeCombatantUpdate(combatant, {
        'flags.aspectsofpower.declaredAction': null,
        'flags.aspectsofpower.nextActionTick': null,
      }, { _aopCancelRedeclare: true });
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${actor.name} abandons <strong>${qa.label}</strong> to move.</em></p>`,
      });
      qa = null;
    }
  }

  // No-stacking: a move may pass through others but must not END overlapping
  // one. Stop short at the last clear point; rescale distance + stamina to the
  // shortened path. A move fully blocked by overlap (no clear ground gained)
  // is dropped. `blocked` + `requestedEndPos` are stamped on the declaration so
  // the path overlay can draw a STOP indicator (you stopped short of where you
  // aimed — 2026-07-16, "we need an indicator for stopping").
  const requestedEndPos = { x: endPos.x, y: endPos.y };
  let blocked = false;
  if (combatant.token) {
    const clamped = clampMoveNoOverlap(combatant.token, startPos, endPos);
    if (clamped.x !== endPos.x || clamped.y !== endPos.y) {
      const pxPerFt = canvas.grid.size / canvas.grid.distance;
      const newFt = Math.round(Math.hypot(clamped.x - startPos.x, clamped.y - startPos.y) / pxPerFt);
      // Move to MAX (up until the enemy physically blocks) + a warning, per user
      // 2026-07-16. Fully blocked (no ground gained) → nowhere to go, just warn.
      // Toasts are gated to player-owned tokens so AI turns don't spam the GM;
      // the on-path STOP indicator carries the visual for everyone.
      if (newFt <= 0) {
        if (actor.hasPlayerOwner) ui.notifications.warn(`${actor.name}: can't move that way — an enemy is in the way.`);
        return null;
      }
      if (actor.hasPlayerOwner) {
        ui.notifications.warn(`${actor.name}: blocked by an enemy — moving ${newFt}ft of ${distanceFt}ft.`);
      }
      staminaCost = Math.max(0, Math.round(staminaCost * (newFt / distanceFt)));
      distanceFt = newFt;
      endPos = clamped;
      blocked = true;
    }
  }

  const m = resolveMovementMode(mode);
  // Price the path against the live battlefield: threatened ground and
  // slowing terrain cost extra TIME (stamina stays on real feet). The
  // checkpoint reprice recomputes the remainder with the same ticks-per-
  // effective-foot rate, so a flood conjured mid-walk changes the price too.
  const pricing = combatant.token
    ? priceMovementPath(combatant.token, startPos, endPos, distanceFt)
    : { effectiveFt: distanceFt, mult: 1 };
  const wait = computeMovementWait(actor, distanceFt, m.key, pricing.effectiveFt);
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;
  const impeded = pricing.mult > 1.05;
  const label = `Move ${distanceFt}ft (${m.label}${impeded ? `, impeded ×${pricing.mult.toFixed(1)}` : ''})`;

  // PARALLEL TRACK: movement lives on declaredMovement (2026-07-14), beside —
  // not instead of — any queued skill. nextActionTick = the SOONER of the two
  // tracks so the tracker's "next up" ordering stays correct.
  const _qaTick = (typeof qa?.scheduledTick === 'number') ? qa.scheduledTick : Infinity;
  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.declaredMovement': {
      itemId: MOVEMENT_ITEM_ID,
      label,
      wait,
      scheduledTick,
      declaredAtTick: clockTick,
      startPos,
      endPos,
      staminaCost,
      distanceFt,
      movementMode: m.key,
      blocked,
      requestedEndPos,
      priceMult: pricing.mult,
      // Declare-formula rate, stored so the checkpoint reprice can extend or
      // shrink the remainder with EXACTLY this declare's math (wait per
      // effective foot) without re-deriving stats mid-flight.
      ticksPerEffFt: pricing.effectiveFt > 0 ? wait / pricing.effectiveFt : 0,
    },
    'flags.aspectsofpower.nextActionTick': Math.min(scheduledTick, _qaTick),
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': `${label} (queued)`,
  });

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name} declares <strong>${label}</strong> — wait ${wait} ticks, arrives at tick ${scheduledTick}${staminaCost ? `, stamina cost ${staminaCost}` : ''}.</em></p>`,
  });

  // Create the PLANNED core movement (v14 rework): the path is stored and
  // drawn by Foundry, nothing commits, and the token holds still until the
  // clock owner starts the glide. Awaited so callers (AI, buffer) know the
  // plan exists before they proceed — but a failed plan does not fail the
  // declare: the flags above are the celerity truth, and the clock-jump
  // fallback (jumpMovementsTo) still lands the token without a plan.
  if (combatant.token) {
    await declarePlannedMove(combatant.token, startPos, endPos);
  }

  return { wait, scheduledTick };
}

/**
 * Declare a manual break-free attempt against a debuff effect on the
 * celerity stack. Wait is deterministic in time — a fixed fraction of
 * the actor's reference round, NOT stat-dependent:
 *   wait = referenceRoundLength(actorRL) × BREAK_FREE_ROUND_FRACTION
 *
 * Build-neutral by design: a charmed actor with weak willpower can still
 * fire break attempts at one-action cadence; their stat affects the
 * progress YIELDED per roll, not the time-per-attempt. The tracker
 * dispatches via the BREAK_FREE_ITEM_ID sentinel and calls
 * `actor._attemptBreakRoll(effect)` when the scheduled tick fires.
 *
 * @param {Actor} actor
 * @param {ActiveEffect} effect  The debuff to break against.
 * @returns {Promise<{wait, scheduledTick}|null>}
 */
export async function declareBreakFree(actor, effect) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return null;
  if (!effect) return null;
  const debuffType = effect.system?.debuffType;
  const breakStat = CONFIG.ASPECTSOFPOWER.debuffBreakStats?.[debuffType];
  if (!breakStat) {
    ui.notifications.warn(`${actor.name}: ${debuffType ?? 'unknown debuff'} cannot be broken through force of will.`);
    return null;
  }
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const fraction = sc.BREAK_FREE_ROUND_FRACTION ?? (1 / 3);
  const rl = actor.system.attributes?.race?.level ?? 1;
  const roundLen = referenceRoundLength(rl);
  const wait = Math.max(1, Math.round(roundLen * fraction));
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;
  const typeName = game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffType] ?? debuffType);
  const label = `Break Free (${typeName})`;

  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.declaredAction': {
      itemId: BREAK_FREE_ITEM_ID,
      label,
      wait,
      scheduledTick,
      declaredAtTick: clockTick,
      effectId: effect.id,
      debuffType,
      breakStat,
    },
    'flags.aspectsofpower.nextActionTick': scheduledTick,
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': `${label} (queued)`,
  });

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name} strains against <strong>${typeName}</strong> — break attempt scheduled in ${wait} ticks (tick ${scheduledTick}).</em></p>`,
  });

  return { wait, scheduledTick };
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
