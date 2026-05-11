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
export function computeActionWait(actor, skill, weapon = null, investAmount = null, manaInvestAmount = null) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
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
  await combatant.update({
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

  const existing = combatant.flags?.aspectsofpower?.declaredAction;
  if (existing && existing.itemId) {
    ui.notifications.warn(`${actor.name} already has "${existing.label}" queued. Cancel it first.`);
    return null;
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
  const wait = computeActionWait(actor, skill, null, investAmount, manaInvestAmount);
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;

  await combatant.update({
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
    },
    'flags.aspectsofpower.nextActionTick': scheduledTick,
    'flags.aspectsofpower.lastActionWait': wait,
    'flags.aspectsofpower.lastActionName': skill.name + ' (queued)',
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
}

/** Backward-compat alias for the renamed function — anything importing the
 *  old name still works. New code should use runRoundStart. */
export const runRoundEnd = runRoundStart;

/** Sentinel itemId stored on `declaredAction` to mark a movement entry. */
export const MOVEMENT_ITEM_ID = '__movement__';

/**
 * Compute movement wait in ticks for `distanceFt` traveled by `actor`.
 *   wait = (distanceFt / 5) × MOVEMENT_BASE_WEIGHT_PER_5FT × SCALE / dex.mod
 *
 * @param {Actor}  actor
 * @param {number} distanceFt
 * @returns {number} wait in ticks (min 1)
 */
export function computeMovementWait(actor, distanceFt) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  const moveBaseWeight = sc.MOVEMENT_BASE_WEIGHT_PER_5FT ?? 10;
  const dexMod = Math.max(1, actor.system.abilities?.dexterity?.mod ?? 0);
  return Math.max(1, Math.round((distanceFt / 5) * moveBaseWeight * sc.SCALE / dexMod));
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
 * @param {number} staminaCost              Stamina to debit at execute time
 * @returns {Promise<{wait, scheduledTick}|null>}
 */
export async function declareMovement(actor, startPos, endPos, distanceFt, staminaCost) {
  const combatant = findCombatantForActor(actor);
  if (!combatant) return null;
  if (distanceFt <= 0) return null;

  const wait = computeMovementWait(actor, distanceFt);
  const clockTick = getClockTick(combatant.combat);
  const scheduledTick = clockTick + wait;
  const label = `Move ${distanceFt}ft`;

  await combatant.update({
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

  await combatant.update({
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
