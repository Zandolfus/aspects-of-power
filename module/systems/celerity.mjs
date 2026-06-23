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
      const cfg = CONFIG.ASPECTSOFPOWER.rangedBlend;
      const norm = Math.max(0, Math.min(1, (weight - cfg.weightOffset) / cfg.weightSpan));
      const perW = cfg.perFloor + cfg.slope * norm;
      return Math.round((a.dexterity?.mod ?? 0) * (1 - perW) + (a.perception?.mod ?? 0) * perW);
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
 * Implements (staves, wands) equipped while casting must NOT contribute their
 * own weight to spell wait — spell weight is intrinsic to the spell tier.
 */
function _resolveCelerityWeight(skill, weapon = null) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const type = skill?.system?.roll?.type ?? '';
  if (_MAGIC_TYPES.has(type)) {
    const tier = skill?.system?.roll?.tier ?? '';
    return CONFIG.ASPECTSOFPOWER.spellTierWeights?.[tier] ?? sc.BASELINE_WEIGHT;
  }
  const w = weapon ?? skill._resolveWeaponForSkill?.() ?? null;
  return w ? AspectsofPowerItem.resolveWeaponWeight(w) : sc.BASELINE_WEIGHT;
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
  const manualMult = skill?.system?.roll?.actionWeightMultiplier ?? 1.0;
  const altMult    = skill?._resolveRarityMods?.()?.effectiveWeightMultiplier ?? 1.0;
  const multiplier = manualMult * altMult;
  const baseWait = Math.max(1, Math.round((weight * multiplier * sc.SCALE) / speed));

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
    adjustedBaseWait = Math.max(1, Math.round(baseWait * 0.77));
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
  // mana), or (b) infused melee with a separate manaInvestAmount on top of
  // the stamina invest. Wisdom controls channel rate the same way for both.
  const isInfused = (skill?.system?.tags ?? []).includes('infused');
  const channelMana = isMagic
    ? (investAmount ?? 0)
    : (isInfused ? (manaInvestAmount ?? 0) : 0);
  if (channelMana > 0) {
    const wisMod = Math.max(1, actor.system.abilities?.wisdom?.mod ?? 0);
    const factor = sc.CHANNEL_FACTOR ?? 1000;
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
  const altMult = skill?._resolveRarityMods?.()?.effectiveWeightMultiplier ?? 1.0;
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
 * Find the actor's combatant in the active combat (if any).
 * Returns null when the actor isn't in combat or no combat is started.
 */
export function findCombatantForActor(actor) {
  const combat = game.combat;
  if (!combat?.started || !actor) return null;
  const token = actor.getActiveTokens?.()[0];
  if (!token) {
    // Fallback — match by actorId on linked tokens.
    return combat.combatants.find(c => c.actorId === actor.id) ?? null;
  }
  return combat.combatants.find(c => c.tokenId === token.id) ?? null;
}

/**
 * Read or initialize the clock tick on the combat document.
 * Combats start at tick 0; the tracker UI advances it as actions resolve.
 */
export function getClockTick(combat = game.combat) {
  return combat?.flags?.aspectsofpower?.clockTick ?? 0;
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
  // Infused-melee dual invest: secondary mana cost captured at declare time
  // so the deferred fire can re-spend it without re-prompting the player.
  const manaInvestAmount = options.manaInvestAmount ?? null;
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

  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.declaredAction': {
      itemId: skill.id,
      label: skill.name,
      wait,
      scheduledTick,
      declaredAtTick: clockTick,
      investAmount,
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
    'flags.aspectsofpower.nextActionTick': scheduledTick,
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': skill.name + ' (queued)',
    'flags.aspectsofpower.dodgeDebt': 0,
  });

  const investNote = investAmount ? ` — invest ${investAmount}` : '';
  const infusedNote = manaInvestAmount ? ` (+${manaInvestAmount} mana infusion)` : '';
  const aoeNote = aoeRegionId ? ' [AOE placed]' : '';
  const orbNote = orbDischarging ? ' [orb discharge]' : '';
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> declares <strong>${skill.name}</strong>${investNote}${infusedNote}${aoeNote}${orbNote} — scheduled for tick <strong>${scheduledTick}</strong> (wait ${wait}).</p>`,
  });

  return { wait, scheduledTick, investAmount, manaInvestAmount, aoeRegionId, orbDischarging, targetIds };
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
  const applierUuid = actor.uuid;
  for (const c of combat.combatants) {
    if (!c.actor) continue;
    for (const effect of c.actor.effects) {
      const sys = effect.system ?? {};
      if (!sys.dot || sys.applierActorUuid !== applierUuid || effect.disabled) continue;
      const rawDamage = sys.dotDamage ?? 0;
      if (rawDamage <= 0) continue;
      const drValue = c.actor.system.defense?.dr?.value ?? 0;
      const damage  = Math.max(0, rawDamage - drValue);
      const health  = c.actor.system.health;
      const newHealth = Math.max(0, health.value - damage);
      await c.actor.update({ 'system.health.value': newHealth });
      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${c.actor.name}</strong> takes <strong>${damage}</strong> damage from ${effect.name} (DR: −${drValue}). `
               + `Health: ${newHealth} / ${health.max}`
               + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
      });
    }
  }

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

/** Backward-compat alias for the renamed function — anything importing the
 *  old name still works. New code should use runRoundStart. */
export const runRoundEnd = runRoundStart;

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
export function computeMovementWait(actor, distanceFt, mode) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const moveBaseWeight = sc.MOVEMENT_BASE_WEIGHT_PER_5FT ?? 10;
  const dexMod = Math.max(1, actor.system.abilities?.dexterity?.mod ?? 0);
  const m = resolveMovementMode(mode);
  const speedMult = Math.max(0.01, actor.system.movementSpeedMultiplier ?? 1);
  return Math.max(1, Math.round((distanceFt / 5) * moveBaseWeight * m.celerityMult * sc.SCALE / (dexMod * speedMult)));
}

/**
 * Linear-interpolate position at the given clockTick along an active
 * movement. If currentTick >= t_arrival, returns endPos. If <= t_decl,
 * returns startPos.
 *
 * @param {{startPos:{x,y}, endPos:{x,y}, declaredAtTick:number, scheduledTick:number}} mv
 * @param {number} currentTick
 * @returns {{x:number, y:number}}
 */
export function interpolateMovementPosition(mv, currentTick) {
  const t0 = mv.declaredAtTick ?? 0;
  const t1 = mv.scheduledTick ?? t0;
  if (currentTick >= t1) return { x: mv.endPos.x, y: mv.endPos.y };
  if (currentTick <= t0 || t1 === t0) return { x: mv.startPos.x, y: mv.startPos.y };
  const frac = (currentTick - t0) / (t1 - t0);
  return {
    x: Math.round(mv.startPos.x + frac * (mv.endPos.x - mv.startPos.x)),
    y: Math.round(mv.startPos.y + frac * (mv.endPos.y - mv.startPos.y)),
  };
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
      const da = cm.flags?.aspectsofpower?.declaredAction;
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
  const combatant = findCombatantForActor(actor);
  if (!combatant) return null;
  if (distanceFt <= 0) return null;

  // No-stacking: a move may pass through others but must not END overlapping
  // one. Stop short at the last clear point; rescale distance + stamina to the
  // shortened path. A move fully blocked by overlap (no clear ground gained)
  // is dropped.
  if (combatant.token) {
    const clamped = clampMoveNoOverlap(combatant.token, startPos, endPos);
    if (clamped.x !== endPos.x || clamped.y !== endPos.y) {
      const pxPerFt = canvas.grid.size / canvas.grid.distance;
      const newFt = Math.round(Math.hypot(clamped.x - startPos.x, clamped.y - startPos.y) / pxPerFt);
      if (newFt <= 0) return null;
      staminaCost = Math.max(0, Math.round(staminaCost * (newFt / distanceFt)));
      distanceFt = newFt;
      endPos = clamped;
    }
  }

  const m = resolveMovementMode(mode);
  const wait = computeMovementWait(actor, distanceFt, m.key);
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;
  const label = `Move ${distanceFt}ft (${m.label})`;

  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.declaredAction': {
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
    },
    'flags.aspectsofpower.nextActionTick': scheduledTick,
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': `${label} (queued)`,
  });

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name} declares <strong>${label}</strong> — wait ${wait} ticks, arrives at tick ${scheduledTick}${staminaCost ? `, stamina cost ${staminaCost}` : ''}.</em></p>`,
  });

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
 * LEGACY — immediate-charge movement path. Kept for any caller that still
 * uses the pre-declare-and-execute flow. New code should use declareMovement.
 *
 * Cost formula (placeholder, design open item #4):
 *   wait = (distanceFt / 5) × MOVEMENT_BASE_WEIGHT_PER_5FT × SCALE / dex.mod
 *
 * @param {Actor}  actor
 * @param {number} distanceFt  Distance moved in feet (post-snap to grid)
 * @returns {Promise<{wait, scheduledTick}|null>}
 */
export async function chargeMovementCelerity(actor, distanceFt) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return null;
  if (distanceFt <= 0) return null;

  const wait = computeMovementWait(actor, distanceFt);
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;

  await _safeCombatantUpdate(combatant, {
    'flags.aspectsofpower.declaredAction': null,
    'flags.aspectsofpower.nextActionTick': scheduledTick,
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': `Movement (${distanceFt}ft)`,
    'flags.aspectsofpower.lastActionAt':   clockTick,
  });

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name} moves ${distanceFt}ft — celerity cost ${wait} ticks → next action at tick ${scheduledTick}.</em></p>`,
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
