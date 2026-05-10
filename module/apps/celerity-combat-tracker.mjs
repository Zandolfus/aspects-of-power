/**
 * Celerity Combat Tracker — subclass of Foundry's native sidebar tracker
 * that replaces the initiative-ordered combatant list with a
 * celerity-ordered timeline. Standard combat controls (start/end, add
 * combatant, settings, etc.) are preserved via the inherited header and
 * footer parts.
 *
 * Wired by setting `CONFIG.ui.combat = CelerityCombatTracker` at init.
 */

import { getClockTick, referenceRoundLength, runRoundEnd, MOVEMENT_ITEM_ID, interpolateMovementPosition } from '../systems/celerity.mjs';

const MAX_ROUND_BOUNDARIES_PER_ADVANCE = 5; // safety cap on multi-round catches

const FLAG_NS = 'aspectsofpower';
const ParentTracker = foundry.applications.sidebar.tabs.CombatTracker;

/* ------------------------------------------------------------------ */
/*  Action handlers (module-level so they can be referenced before     */
/*  the class is fully defined — Foundry binds `this` to the app)      */
/* ------------------------------------------------------------------ */

async function _onCelAdvance(event, target) {
  const combat = this.viewed;
  if (!combat?.started) return;
  const clockTick = getClockTick(combat);
  // Find the soonest declared action with a scheduled tick still in the future.
  const queued = [...combat.combatants]
    .map(c => ({ c, declared: c.flags?.[FLAG_NS]?.declaredAction ?? null }))
    .filter(e => e.declared && typeof e.declared.scheduledTick === 'number' && e.declared.scheduledTick > clockTick)
    .sort((a, b) => a.declared.scheduledTick - b.declared.scheduledTick);
  if (queued.length === 0) {
    ui.notifications.info('No queued actions to advance to.');
    return;
  }
  const { c, declared } = queued[0];
  const newClock = declared.scheduledTick;

  // Round-end mechanics: fire onStartTurn + DoTs for any actor whose personal
  // round boundary was crossed by this clock advance. Per design-celerity.md
  // round length is RL-tied (build-neutral), one boundary every roundLen ticks.
  for (const member of combat.combatants) {
    const actor = member.actor;
    if (!actor) continue;
    const rl = actor.system.attributes?.race?.level ?? 1;
    const roundLen = referenceRoundLength(rl);
    if (roundLen <= 0) continue;
    const lastEnd = member.flags?.[FLAG_NS]?.lastRoundEndAt ?? 0;
    let crossings = Math.floor((newClock - lastEnd) / roundLen);
    if (crossings <= 0) continue;
    crossings = Math.min(crossings, MAX_ROUND_BOUNDARIES_PER_ADVANCE);
    for (let i = 0; i < crossings; i++) {
      await runRoundEnd(combat, member);
    }
    await member.update({
      [`flags.${FLAG_NS}.lastRoundEndAt`]: lastEnd + crossings * roundLen,
    });
  }

  // Animate every in-flight movement to its interpolated position at the
  // new clock tick BEFORE the action resolves. Per design discussion
  // 2026-05-10: at every pause, all moving tokens slide in parallel to
  // wherever the lerp says they should be — each token only progresses up
  // to its own scheduled-tick (ratio = (newClock - declaredAt) / wait).
  // Tokens whose scheduled tick is reached commit to endPos and clear their
  // declaredAction flag. `Promise.all` runs the slides concurrently so the
  // visual rhythm is "tick beats" rather than serial per-token.
  const movementUpdates = [];
  const completedMovementCombatantIds = [];
  for (const member of combat.combatants) {
    const mv = member.flags?.[FLAG_NS]?.declaredAction;
    if (!mv || mv.itemId !== MOVEMENT_ITEM_ID) continue;
    const token = member.token;
    if (!token) continue;
    const target = interpolateMovementPosition(mv, newClock);
    // Token.update with x/y triggers Foundry's animation by default.
    // `_celerityCommit` flag tells our _preUpdateMovement override to
    // bypass declare-and-cancel for this update (avoids infinite recursion).
    movementUpdates.push(token.update(
      { x: target.x, y: target.y },
      { animation: { duration: 400 }, _celerityCommit: true }
    ).catch(err => console.error(`movement animate failed for ${member.name}:`, err)));
    if (newClock >= mv.scheduledTick) {
      completedMovementCombatantIds.push({ id: member.id, mv });
    }
  }
  await Promise.all(movementUpdates);

  // Commit completion: clear flags + debit stamina for any movement that
  // just landed. This includes the "fired" combatant if it was a movement.
  for (const { id, mv } of completedMovementCombatantIds) {
    const member = combat.combatants.get(id);
    const updates = {
      [`flags.${FLAG_NS}.declaredAction`]: null,
      [`flags.${FLAG_NS}.nextActionTick`]: null,
      [`flags.${FLAG_NS}.lastActionName`]: mv.label,
      [`flags.${FLAG_NS}.lastActionWait`]: mv.wait,
      [`flags.${FLAG_NS}.lastActionAt`]: newClock,
    };
    await member.update(updates);
    if (mv.staminaCost && member.actor) {
      const cur = member.actor.system.stamina?.value ?? 0;
      await member.actor.update({
        'system.stamina.value': Math.max(0, cur - mv.staminaCost),
      });
    }
  }

  // Advance clock. (Movement-completion combatants are already cleared
  // above; for skill-action firings we still need to clear the firer's
  // flags before dispatching so a follow-up can re-queue.)
  await combat.update({ [`flags.${FLAG_NS}.clockTick`]: newClock });

  // Movement-completion branch: the action that drove this advance was a
  // movement, so there's no skill roll to dispatch. The position update +
  // flag clear above is the entire "fire" step.
  if (declared.itemId === MOVEMENT_ITEM_ID) {
    ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} arrives (${declared.label}).`);
    return;
  }

  // Skill-action branch (existing flow): clear the firer's flags + dispatch
  // the queued item to its canonical player (or run locally on GM).
  await c.update({
    [`flags.${FLAG_NS}.declaredAction`]: null,
    [`flags.${FLAG_NS}.nextActionTick`]: null,
  });
  const item = c.actor?.items?.get(declared.itemId);
  if (!item) {
    ui.notifications.warn(`${c.name}: queued item not found (id=${declared.itemId}); action skipped.`);
    return;
  }
  ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} fires "${declared.label}".`);

  // Dispatch the deferred roll to the actor's CANONICAL player — the user
  // whose `character` field IS this actor. Each PC has exactly one such
  // user. If that player isn't online (or this is an NPC with no linked
  // user), fall back to running locally on the GM's client. Never picks
  // a co-owner (e.g., another PC who happens to have OWNER permission).
  const investAmount = declared.investAmount ?? null;
  const manaInvestAmount = declared.manaInvestAmount ?? null;
  const aoeRegionId = declared.aoeRegionId ?? null;
  const orbDischarging = declared.orbDischarging ?? false;
  const linkedPlayer = game.users.find(u => !u.isGM && u.active && u.character?.id === c.actor?.id);
  if (linkedPlayer) {
    game.socket.emit('system.aspects-of-power', {
      action: 'executeQueuedAction',
      actorId: c.actor.id,
      itemId: item.id,
      targetUserId: linkedPlayer.id,
      preInvestAmount: investAmount,
      preManaInvestAmount: manaInvestAmount,
      preAoeRegionId: aoeRegionId,
      preOrbDischarging: orbDischarging,
    });
  } else {
    // No linked player online — GM (or whoever clicked Advance) runs it.
    await item.roll({ executeDeferred: true, preInvestAmount: investAmount, preManaInvestAmount: manaInvestAmount, preAoeRegionId: aoeRegionId, preOrbDischarging: orbDischarging });
  }

  // Sync Foundry's combat.turn pointer to the new celerity-next-up combatant
  // so pan-to-active and other built-in turn-pointer machinery stays aligned.
  // If no one is queued, leave combat.turn alone.
  const remainingClock = getClockTick(combat);
  const upcoming = [...combat.combatants]
    .map(cm => ({ cm, next: cm.flags?.[FLAG_NS]?.declaredAction?.scheduledTick ?? null }))
    .filter(e => e.next !== null && e.next > remainingClock)
    .sort((a, b) => a.next - b.next);
  if (upcoming.length > 0) {
    const allCombatants = [...combat.combatants];
    const nextIdx = allCombatants.indexOf(upcoming[0].cm);
    if (nextIdx >= 0 && nextIdx !== combat.turn) {
      // Avoid the legacy combatTurnChange round-mechanics handler firing again
      // — celerity already drove round-end via runRoundEnd above.
      await combat.update({ turn: nextIdx }, { _celerityTurnSync: true });
    }
  }
}

async function _onCelCancel(event, target) {
  const combatantId = target.closest('[data-combatant-id]')?.dataset?.combatantId;
  if (!combatantId) return;
  const combat = this.viewed;
  const c = combat?.combatants.get(combatantId);
  if (!c) return;
  const declared = c.flags?.[FLAG_NS]?.declaredAction;
  // For a cancelled movement: token stays at its current position (which is
  // the lerp position from the most recent pause). No stamina debit — sunk
  // cost is the celerity-time spent, not the resource. Per design.
  await c.update({
    [`flags.${FLAG_NS}.nextActionTick`]: null,
    [`flags.${FLAG_NS}.declaredAction`]: null,
  });
  const noun = declared?.itemId === MOVEMENT_ITEM_ID ? 'movement' : 'action';
  ui.notifications.info(`${c.name} — ${noun} cancelled.`);
}

async function _onCelReset(event, target) {
  const combat = this.viewed;
  if (!combat?.started) return;
  await combat.update({ [`flags.${FLAG_NS}.clockTick`]: 0 });
  for (const c of combat.combatants) {
    await c.update({
      [`flags.${FLAG_NS}.nextActionTick`]: null,
      [`flags.${FLAG_NS}.declaredAction`]: null,
      [`flags.${FLAG_NS}.lastActionName`]: null,
      [`flags.${FLAG_NS}.lastActionWait`]: null,
      [`flags.${FLAG_NS}.lastActionAt`]: null,
      [`flags.${FLAG_NS}.lastRoundEndAt`]: 0,
    });
  }
  ui.notifications.info('Celerity clock reset.');
}

/* ------------------------------------------------------------------ */
/*  The subclass                                                       */
/* ------------------------------------------------------------------ */

export class CelerityCombatTracker extends ParentTracker {

  static DEFAULT_OPTIONS = {
    actions: {
      celAdvance: _onCelAdvance,
      celReset:   _onCelReset,
      celCancel:  _onCelCancel,
    },
  };

  // Inherit header/footer; replace tracker part with our celerity template.
  static PARTS = {
    header:  { ...ParentTracker.PARTS.header },
    tracker: {
      template: 'systems/aspects-of-power/templates/sidebar/celerity-combat-tracker.hbs',
    },
    footer:  { ...ParentTracker.PARTS.footer },
  };

  /** @override - enrich each turn with celerity flags. */
  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    const f = combatant.flags?.[FLAG_NS] ?? {};
    const clockTick = getClockTick(combat);
    const next = f.nextActionTick ?? null;
    turn.celerity = {
      nextActionTick: next,
      lastActionName: f.lastActionName ?? null,
      lastActionWait: f.lastActionWait ?? null,
      ticksUntil:     next === null ? null : Math.max(0, next - clockTick),
      ready:          next === null || next <= clockTick,
    };
    return turn;
  }

  /** @override - sort combatants by celerity scheduled tick + add clock readout. */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = context.combat ?? this.viewed;
    context.celerityClockTick = getClockTick(combat);
    if (Array.isArray(context.turns)) {
      // Player visibility: per design-celerity.md "Public allies, opaque
      // enemies", non-GM users only see PC-owned combatants in the tracker.
      // (Hidden enemies stay invisible — even on canvas, they don't show.)
      if (!game.user.isGM) {
        context.turns = context.turns.filter(t => {
          const cm = combat.combatants.get(t.id);
          return cm?.actor?.hasPlayerOwner === true;
        });
      }
      // Strip Foundry's initiative-based 'active' so we can re-apply it to
      // the celerity-next-up combatant.
      for (const t of context.turns) {
        t.css = (t.css ?? '').replace(/\bactive\b/g, '').trim();
      }
      // Sort by celerity scheduled tick (null sorts to bottom).
      context.turns.sort((a, b) => {
        const ta = a.celerity?.nextActionTick ?? Infinity;
        const tb = b.celerity?.nextActionTick ?? Infinity;
        return ta - tb;
      });
      // Mark next-up ONLY when an action is actually queued. When the queue
      // is empty (everyone "ready"), nobody is highlighted — prevents the
      // green indicator from sticking on the previously-acted combatant.
      const firstScheduled = context.turns.find(t => t.celerity?.nextActionTick !== null);
      if (firstScheduled) {
        firstScheduled.celerity.nextUp = true;
        firstScheduled.css = (firstScheduled.css + ' active').trim();
      }
    }
    return context;
  }
}
