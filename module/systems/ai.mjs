/**
 * Primitive AI (per plan pure-gathering-ullman.md, 2026-05-29).
 *
 * Pluggable per-actor "decide on your turn" registry. Each profile is a small
 * function bundle; content authors register more profiles without engine
 * changes. First profile is `'primitive'` — closest-hostile-in-range-with-LOS
 * targeting, used by tower-class summons.
 *
 * Actor opts in via `flags.aspectsofpower.aiProfile = '<name>'`. The dispatch
 * hook listens for `updateCombatant` and fires the profile's `onActionReady`
 * when the actor's declared action clears (action just resolved).
 *
 * NOTE: `combatTurnChange` is skipped under celerity (per the celerity
 * findings in this build's planning phase). Action firing is the natural
 * "your turn just resolved, decide what's next" event.
 *
 * Public API:
 *   AIProfiles.register(name, profile)
 *   AIProfiles.get(name)
 *
 * Profile shape:
 *   { onActionReady?: async (actor, ctx) => {} }
 */

import { declareAction, findCombatantForActor } from './celerity.mjs';

class AIProfilesRegistry {
  static #profiles = new Map();

  static register(name, profile) {
    if (!name || !profile) return;
    this.#profiles.set(name, profile);
  }

  static get(name) {
    return this.#profiles.get(name) ?? null;
  }

  static has(name) {
    return this.#profiles.has(name);
  }

  static all() {
    return Array.from(this.#profiles.keys());
  }
}

export const AIProfiles = AIProfilesRegistry;

/* ---------------------------------------------------------------------------- */
/*  Built-in 'primitive' profile                                                */
/* ---------------------------------------------------------------------------- */

/**
 * Closest-hostile-with-LOS targeting. On ties, prefer the actor's current
 * channel target (sticky), else coinflip.
 *
 * Reads actor flag `aiSkillUuid` for the skill to fire (typically a channel).
 */
const primitiveProfile = {
  onActionReady: async (actor, _ctx) => {
    const skillUuid = actor.flags?.aspectsofpower?.aiSkillUuid;
    if (!skillUuid) return;
    const skill = await fromUuid(skillUuid);
    if (!skill) return;

    const selfToken = actor.getActiveTokens?.()?.[0];
    if (!selfToken) return;
    const selfTokenDoc = selfToken.document;
    const scene = selfTokenDoc.parent;
    if (!scene) return;

    // Range: skill.castingRange override or channel-range override or actor.castingRange
    const channelRange = skill.system?.tagConfig?.channelRange ?? 0;
    const rangeFt = channelRange > 0 ? channelRange : (actor.system?.castingRange ?? 60);
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const rangePx = rangeFt * pxPerFt;

    // Resolve self center
    const selfCenter = {
      x: selfTokenDoc.x + (selfTokenDoc.width  * canvas.grid.size) / 2,
      y: selfTokenDoc.y + (selfTokenDoc.height * canvas.grid.size) / 2,
    };

    // Candidate targets: hostile relative to self. Disposition: self FRIENDLY
    // (1) sees disposition HOSTILE (-1) as enemy. self HOSTILE sees FRIENDLY
    // as enemy. NEUTRAL on either side is treated as enemy iff hostility
    // mismatches.
    const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
    const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    const selfDisp = selfTokenDoc.disposition;
    const isHostileToSelf = (otherDisp) => {
      if (selfDisp === FRIENDLY) return otherDisp === HOSTILE;
      if (selfDisp === HOSTILE) return otherDisp === FRIENDLY;
      return false;
    };

    const candidates = [];
    for (const t of scene.tokens.contents) {
      if (t.id === selfTokenDoc.id) continue;
      if (!t.actor) continue;
      if ((t.actor.system?.health?.value ?? 0) <= 0) continue;
      if (!isHostileToSelf(t.disposition)) continue;

      const tCenter = {
        x: t.x + (t.width  * canvas.grid.size) / 2,
        y: t.y + (t.height * canvas.grid.size) / 2,
      };
      const dx = tCenter.x - selfCenter.x;
      const dy = tCenter.y - selfCenter.y;
      const distPx = Math.hypot(dx, dy);
      if (distPx > rangePx) continue;

      // LOS check
      const visible = canvas.visibility?.testVisibility?.(tCenter, {
        tolerance: 2,
        object: t.object ?? null,
      });
      if (visible === false) continue;

      candidates.push({ tokenDoc: t, distPx, tCenter });
    }

    if (candidates.length === 0) {
      // No targets — skip this turn. Declare a no-op declaration with a fixed
      // wait so the AI gets another turn to re-evaluate.
      await declareAction(actor, skill, { targetIds: [], skipNoTarget: true });
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${actor.name} scans for targets — none in range.</em></p>`,
      });
      return;
    }

    // Sort closest first
    candidates.sort((a, b) => a.distPx - b.distPx);
    const minDist = candidates[0].distPx;
    const ties = candidates.filter(c => Math.abs(c.distPx - minDist) < 0.5); // within half a pixel

    // Sticky tiebreak: prefer current channel target if in the tied set
    let chosen = ties[0];
    if (ties.length > 1) {
      const { ChannelHelpers } = await import('./channel.mjs');
      const currentChannel = ChannelHelpers.findChannelOf(actor.uuid);
      if (currentChannel) {
        const sticky = ties.find(c => c.tokenDoc.id === currentChannel.targetTokenId);
        if (sticky) chosen = sticky;
      }
      if (chosen === ties[0] && ties.length > 1) {
        // Coinflip among ties
        chosen = ties[Math.floor(((selfTokenDoc.id.charCodeAt(0) + Date.now() % 1000) % ties.length))];
        // Date.now() is not allowed in workflow agents but is fine here; just need
        // a non-deterministic pick. Fall back: ties[0].
      }
    }

    // Fire the skill — the channel-tag handler routes to startOrContinueChannel.
    // `executeDeferred: true` + `preTargetIds` causes item.roll() to set
    // game.user.targets to the chosen token (see item.mjs:6085) before
    // dispatching to the tag handlers, so they see the right target.
    await skill.roll({ executeDeferred: true, preTargetIds: [chosen.tokenDoc.id] });

    // Schedule the next AI tick via declareAction
    await declareAction(actor, skill, { targetIds: [chosen.tokenDoc.id] });
  },
};

AIProfiles.register('primitive', primitiveProfile);

/* ---------------------------------------------------------------------------- */
/*  Dispatch hook                                                                */
/* ---------------------------------------------------------------------------- */

/**
 * Hook on `updateCombatant`: when a combatant's declaredAction clears
 * (action fired), look up the actor's aiProfile flag and dispatch.
 * GM-only so we don't double-fire in multiplayer.
 */
export function registerAIHooks() {
  Hooks.on('updateCombatant', async (combatantDoc, changes, _options, _userId) => {
    if (!game.user.isGM) return;

    // We care about declaredAction transitions from set → null (action fired)
    const declaredChange = changes?.flags?.['aspectsofpower']?.declaredAction;
    if (declaredChange !== null && declaredChange !== undefined) return;
    // After the update, the combatant's declaredAction should be null
    if (combatantDoc.flags?.aspectsofpower?.declaredAction) return;

    const actor = combatantDoc.actor;
    if (!actor) return;
    const profileName = actor.flags?.aspectsofpower?.aiProfile;
    if (!profileName) return;
    const profile = AIProfiles.get(profileName);
    if (!profile?.onActionReady) return;

    // Fire AI decision asynchronously so the current update cycle settles
    setTimeout(() => {
      profile.onActionReady(actor, { combatant: combatantDoc }).catch(err =>
        console.warn(`[ai] ${profileName} onActionReady failed for ${actor.name}:`, err)
      );
    }, 100);
  });
}
