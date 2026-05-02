/**
 * Celerity Combat Tracker — subclass of Foundry's native sidebar tracker
 * that replaces the initiative-ordered combatant list with a
 * celerity-ordered timeline. Standard combat controls (start/end, add
 * combatant, settings, etc.) are preserved via the inherited header and
 * footer parts.
 *
 * Wired by setting `CONFIG.ui.combat = CelerityCombatTracker` at init.
 */

import { getClockTick, referenceRoundLength, runRoundEnd } from '../systems/celerity.mjs';

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

  // Advance clock + clear that combatant's celerity flags BEFORE firing —
  // so the roll can re-queue if the actor declares a follow-up immediately.
  await combat.update({ [`flags.${FLAG_NS}.clockTick`]: newClock });
  await c.update({
    [`flags.${FLAG_NS}.declaredAction`]: null,
    [`flags.${FLAG_NS}.nextActionTick`]: null,
  });
  // Resolve the queued item and fire it via the deferred-execute path.
  const item = c.actor?.items?.get(declared.itemId);
  if (!item) {
    ui.notifications.warn(`${c.name}: queued item not found (id=${declared.itemId}); action skipped.`);
    return;
  }
  ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} fires "${declared.label}".`);
  await item.roll({ executeDeferred: true });
}

async function _onCelCancel(event, target) {
  const combatantId = target.closest('[data-combatant-id]')?.dataset?.combatantId;
  if (!combatantId) return;
  const combat = this.viewed;
  const c = combat?.combatants.get(combatantId);
  if (!c) return;
  await c.update({
    [`flags.${FLAG_NS}.nextActionTick`]: null,
    [`flags.${FLAG_NS}.declaredAction`]: null,
  });
  ui.notifications.info(`${c.name} — action cancelled.`);
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
      // Strip Foundry's initiative-based 'active' from every row first; we'll
      // re-apply it to whichever combatant is celerity-next-up so pan-to-active
      // and other Foundry behaviors point at the right token.
      for (const t of context.turns) {
        t.css = (t.css ?? '').replace(/\bactive\b/g, '').trim();
      }
      // Sort by celerity scheduled tick — null/Infinity (no action queued)
      // sorts last so anyone with a real schedule appears at the top.
      context.turns.sort((a, b) => {
        const ta = a.celerity?.nextActionTick ?? Infinity;
        const tb = b.celerity?.nextActionTick ?? Infinity;
        return ta - tb;
      });
      // Mark next-up: prefer the soonest scheduled action; fall back to first
      // ready combatant if nobody has queued anything yet.
      const firstScheduled = context.turns.find(t => t.celerity?.nextActionTick !== null);
      const nextUp = firstScheduled ?? context.turns[0];
      if (nextUp) {
        nextUp.celerity.nextUp = true;
        nextUp.css = (nextUp.css + ' active').trim();
      }
    }
    return context;
  }
}
