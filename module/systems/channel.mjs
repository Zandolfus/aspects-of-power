/**
 * Channel primitive (per plan pure-gathering-ullman.md / design-channel-and-tower.md).
 *
 * Sub-turn ticking damage skill that ramps per consecutive tick on the same
 * target. Drives both AI-fired tower channels (Lightstream Beam) and future
 * player-cast channels. State is in-memory only — page refresh drops active
 * channels (acceptable for v1).
 *
 * Public API:
 *   ChannelHelpers.startOrContinueChannel(caster, skill, target)
 *   ChannelHelpers.cancelChannel(casterUuid)
 *   ChannelHelpers.findChannelOf(casterUuid)
 *
 * Lifecycle:
 *   Cast (or AI fire) → startOrContinueChannel → state registered in #channels.
 *   updateCombat (clockTick advance) → scheduler iterates state map → fireTick
 *   for any due ticks → validates target/range/LOS/mana → applies damage →
 *   advances ramp + schedules next tick. Cancels on validation failure or
 *   when channelMaxTicks reached.
 *
 * Damage application is minimal v1: defense pool → armor/veil → DR → overhealth
 * → HP. Mark + per-affinity DR routing skipped at the per-tick layer (the
 * initial cast's hit/damage roll would carry them through the regular pipeline,
 * but each subsequent tick bypasses for simplicity). Acceptable since channels
 * are sustained damage; marks/affinity matter most for burst.
 */

import { getClockTick, referenceRoundLength } from './celerity.mjs';

const COMBAT_FLAG_TICK = 'aspectsofpower.clockTick';

/** @type {Map<string, ChannelState>} key = caster actor UUID */
const channels = new Map();

/**
 * @typedef {object} ChannelState
 * @property {string} casterActorUuid
 * @property {string} skillUuid
 * @property {string} targetTokenId
 * @property {string} targetActorUuid
 * @property {number} nextTickAt           celerity clock tick of next due fire
 * @property {number} ticksFired
 * @property {number} consecutiveOnTarget  resets on retarget (ramp index)
 * @property {number} tickIntervalTicks    celerity ticks between fires (= roundLen × tickInterval fraction)
 * @property {number} rampMax              max per-tick multiplier
 * @property {number} rampTicks            ticks to reach rampMax (linear)
 * @property {number} tickCost             mana per tick
 * @property {number} channelMaxTicks      hard cap (0 = unlimited)
 * @property {number} channelRange         range cap in ft (0 = use skill.castingRange)
 * @property {string} damageType           'physical' or 'magical' — drives armor vs veil
 */

export class ChannelHelpers {
  /**
   * Start a new channel OR continue an existing one if it matches (caster, target).
   * Different-target re-cast breaks the current and starts fresh (ramp resets).
   * Same-target re-cast keeps ramp continuing — caller doesn't need to know.
   *
   * @param {Actor} caster
   * @param {Item}  skill   the channel-tagged skill
   * @param {Token|TokenDocument} target
   * @returns {Promise<ChannelState|null>}
   */
  static async startOrContinueChannel(caster, skill, target) {
    if (!caster || !skill || !target) return null;
    const tc = skill.system?.tagConfig ?? {};
    if (!tc.channel) return null;

    const targetDoc   = target.document ?? target;
    const targetActor = targetDoc.actor ?? null;
    if (!targetActor) return null;

    const casterUuid = caster.uuid;
    const existing = channels.get(casterUuid);

    // Same caster + same target → continue (ramp persists)
    if (existing && existing.targetTokenId === targetDoc.id && existing.targetActorUuid === targetActor.uuid) {
      // Re-arm scheduling so the next tick fires from now+interval if it was
      // somehow lost (e.g., scheduler missed an advance). Safe no-op otherwise.
      const clockTick = getClockTick(game.combat);
      if (existing.nextTickAt <= clockTick) {
        existing.nextTickAt = clockTick + existing.tickIntervalTicks;
      }
      return existing;
    }

    // Build fresh state (different target or no prior channel)
    const roundLen = referenceRoundLength(caster.system?.attributes?.race?.level ?? 25);
    const tickInterval = tc.channelTickInterval ?? (1 / 3);
    const tickIntervalTicks = Math.max(1, Math.round(roundLen * tickInterval));
    const clockTick = getClockTick(game.combat);

    const state = {
      casterActorUuid:     casterUuid,
      skillUuid:           skill.uuid,
      targetTokenId:       targetDoc.id,
      targetActorUuid:     targetActor.uuid,
      nextTickAt:          clockTick + tickIntervalTicks,
      ticksFired:          0,
      consecutiveOnTarget: 1,
      tickIntervalTicks,
      rampMax:             tc.channelRampMax  ?? 2.5,
      rampTicks:           Math.max(1, tc.channelRampTicks ?? 3),
      tickCost:            tc.channelTickCost ?? 1,
      channelMaxTicks:     tc.channelMaxTicks ?? 0,
      channelRange:        tc.channelRange    ?? 0,
      damageType:          skill.system?.roll?.damageType ?? 'magical',
    };

    if (existing) {
      // Different target — implicit break + reset
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        content: `<p><em>${caster.name} retargets <strong>${skill.name}</strong> — channel ramp resets.</em></p>`,
      });
    }

    channels.set(casterUuid, state);
    return state;
  }

  /**
   * Drop an active channel without firing a final tick. Used by validation
   * failures (target died, OOR, OOL, OOM) and by external cleanup
   * (deleteToken hook on tower destruction).
   */
  static cancelChannel(casterUuid) {
    return channels.delete(casterUuid);
  }

  /**
   * Read the caster's active channel state. Used by AI retarget logic to
   * detect "is this a continue or a new acquire?" implicitly via target id.
   */
  static findChannelOf(casterUuid) {
    return channels.get(casterUuid) ?? null;
  }

  /**
   * Fire one tick of an active channel. Validates, computes ramp-scaled
   * damage, applies through minimal defense pipeline, advances state.
   * Cancels the channel on any validation failure.
   *
   * @returns {Promise<boolean>} true if tick fired, false if cancelled
   */
  static async fireTick(casterUuid) {
    const state = channels.get(casterUuid);
    if (!state) return false;

    const caster      = await fromUuid(state.casterActorUuid);
    const targetActor = await fromUuid(state.targetActorUuid);
    const skill       = await fromUuid(state.skillUuid);

    if (!caster || !targetActor || !skill) { this.cancelChannel(casterUuid); return false; }
    if ((caster.system?.health?.value ?? 0) <= 0) { this.cancelChannel(casterUuid); return false; }
    if ((targetActor.system?.health?.value ?? 0) <= 0) {
      this.#postChannelEndMessage(caster, skill, 'target defeated');
      this.cancelChannel(casterUuid);
      return false;
    }

    const casterToken = caster.getActiveTokens?.()?.[0]?.document ?? null;
    const targetToken = caster.parent?.tokens?.get?.(state.targetTokenId)
                     ?? canvas.scene?.tokens?.get?.(state.targetTokenId)
                     ?? null;
    if (!casterToken || !targetToken) { this.cancelChannel(casterUuid); return false; }

    // Range check
    const rangeFt = state.channelRange > 0
      ? state.channelRange
      : (caster.system?.castingRange ?? 60);
    const dx = (targetToken.x + (targetToken.width  * canvas.grid.size) / 2)
             - (casterToken.x + (casterToken.width  * canvas.grid.size) / 2);
    const dy = (targetToken.y + (targetToken.height * canvas.grid.size) / 2)
             - (casterToken.y + (casterToken.height * canvas.grid.size) / 2);
    const distFt = Math.hypot(dx, dy) * canvas.grid.distance / canvas.grid.size;
    if (distFt > rangeFt) {
      this.#postChannelEndMessage(caster, skill, `target out of range (${Math.round(distFt)} > ${rangeFt} ft)`);
      this.cancelChannel(casterUuid);
      return false;
    }

    // LOS check (vision polygon)
    const visible = canvas.visibility?.testVisibility?.(
      { x: targetToken.x + targetToken.width  * canvas.grid.size / 2,
        y: targetToken.y + targetToken.height * canvas.grid.size / 2 },
      { tolerance: 2, object: targetToken.object ?? null }
    );
    if (visible === false) {
      this.#postChannelEndMessage(caster, skill, 'line of sight broken');
      this.cancelChannel(casterUuid);
      return false;
    }

    // Mana check
    const manaNow = caster.system?.mana?.value ?? 0;
    if (manaNow < state.tickCost) {
      this.#postChannelEndMessage(caster, skill, 'caster out of mana');
      this.cancelChannel(casterUuid);
      return false;
    }

    // Compute ramped damage. Base = skill's rolled total (use the deterministic
    // average via a fresh roll() each tick; for v1 we use Roll with skill's dice
    // formula evaluated synchronously without DSN noise).
    const baseRoll = await this.#rollChannelDamage(skill, caster);
    const baseDmg  = Math.max(0, Math.round(baseRoll));
    const rampMult = this.#computeRampMultiplier(state.consecutiveOnTarget, state.rampMax, state.rampTicks);
    const tickDmg  = Math.round(baseDmg * rampMult);

    // Minimal damage application — defense pool → armor/veil → DR → overhealth → HP
    await this.#applyTickDamage(targetActor, tickDmg, state.damageType, caster, skill, rampMult);

    // Spend mana
    await caster.update({ 'system.mana.value': Math.max(0, manaNow - state.tickCost) });

    // Advance ramp + schedule
    state.consecutiveOnTarget += 1;
    state.ticksFired          += 1;
    state.nextTickAt          += state.tickIntervalTicks;
    if (state.channelMaxTicks > 0 && state.ticksFired >= state.channelMaxTicks) {
      this.#postChannelEndMessage(caster, skill, `${state.channelMaxTicks} ticks reached`);
      this.cancelChannel(casterUuid);
    }
    return true;
  }

  /** Linear ramp: tick 1 = 1.0, tick rampTicks = rampMax, plateau thereafter. */
  static #computeRampMultiplier(consecutive, rampMax, rampTicks) {
    if (rampTicks <= 1) return rampMax;
    const eff = Math.min(consecutive - 1, rampTicks - 1);
    return 1 + (rampMax - 1) * (eff / (rampTicks - 1));
  }

  static async #rollChannelDamage(skill, caster) {
    // Build a fresh damage roll using the skill's dmgFormula evaluation path.
    // The skill knows its own ability blend + dice. For v1 we keep it simple
    // and use a Roll on the skill's primary dice + caster's primary ability
    // mod (as a rough proxy for the standard damage formula).
    const diceFormula = skill.system?.roll?.dice || '1d4';
    const abilKey     = skill.system?.roll?.abilities ?? 'intelligence';
    const abilMod     = caster.system?.abilities?.[abilKey]?.mod ?? 0;
    try {
      const r = new Roll(`(${diceFormula}) + ${Math.round(abilMod / 4)}`); // soft scale; tune later
      await r.evaluate();
      return r.total;
    } catch (_) {
      return Math.round(abilMod / 4);
    }
  }

  static async #applyTickDamage(targetActor, tickDmg, damageType, caster, skill, rampMult) {
    // Defense pool (ranged for now — channels are conceptually ranged attacks)
    const defKey = damageType === 'physical' ? 'armor' : 'veil';
    const defPool = targetActor.system?.defense?.ranged ?? null;
    let postPoolDmg = tickDmg;
    if (defPool && defPool.pool > 0) {
      if (defPool.pool >= tickDmg) {
        postPoolDmg = 0;
        await targetActor.update({ 'system.defense.ranged.pool': defPool.pool - tickDmg });
      } else {
        const reductionRatio = defPool.pool / tickDmg;
        postPoolDmg = Math.round(tickDmg * (1 - reductionRatio));
        await targetActor.update({ 'system.defense.ranged.pool': 0 });
      }
    }

    // Armor/veil mitigation
    const mitigation = targetActor.system?.defense?.[defKey]?.value ?? 0;
    let postMitDmg = Math.max(0, postPoolDmg - mitigation);

    // DR
    const dr = targetActor.system?.defense?.dr?.value ?? 0;
    const finalDmg = Math.max(0, postMitDmg - dr);

    // Apply to overhealth then HP
    const oh = targetActor.system?.overhealth?.value ?? 0;
    let remaining = finalDmg;
    const updateData = {};
    if (oh > 0) {
      const absorbed = Math.min(oh, remaining);
      updateData['system.overhealth.value'] = oh - absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) {
      const hp = targetActor.system?.health?.value ?? 0;
      updateData['system.health.value'] = Math.max(0, hp - remaining);
    }
    if (Object.keys(updateData).length > 0) {
      await targetActor.update(updateData);
    }

    // Chat output (GM-whispered for tower-driven; visible for player channels)
    const breakdown = `${tickDmg} raw × ${rampMult.toFixed(2)}× → ${postPoolDmg} after pool → ${postMitDmg} after ${defKey} → ${finalDmg} after DR`;
    const whisper = !caster.hasPlayerOwner ? ChatMessage.getWhisperRecipients('GM') : undefined;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      ...(whisper ? { whisper } : {}),
      content: `<p><em>${caster.name}'s <strong>${skill.name}</strong> ticks on ${targetActor.name} — <strong>${finalDmg}</strong> dmg.</em> <span class="hint">${breakdown}</span></p>`,
    });
  }

  static #postChannelEndMessage(caster, skill, reason) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      content: `<p><em>${caster.name}'s <strong>${skill.name}</strong> ends — ${reason}.</em></p>`,
    });
  }
}

/**
 * Scheduler hook — fires on every combat update; if clockTick advanced,
 * walks active channels and fires due ticks. GM-only so we don't double-fire
 * in multiplayer.
 */
export function registerChannelHooks() {
  Hooks.on('updateCombat', async (combat, changes) => {
    if (!game.user.isGM) return;
    if (!changes?.flags?.['aspects-of-power']) return;
    const newTick = combat.flags?.['aspects-of-power']?.clockTick ?? 0;
    // Iterate a snapshot since fireTick may mutate the channels map (cancel)
    const casterUuids = Array.from(channels.keys());
    for (const casterUuid of casterUuids) {
      const state = channels.get(casterUuid);
      if (!state) continue;
      // Fire all overdue ticks (catch-up loop)
      let safety = 20;
      while (state && state.nextTickAt <= newTick && safety-- > 0) {
        const fired = await ChannelHelpers.fireTick(casterUuid);
        if (!fired) break;
      }
    }
  });
}
