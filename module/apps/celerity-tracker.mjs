/**
 * Celerity Tracker — sidebar widget that visualizes the per-combatant
 * action timeline alongside Foundry's native CombatTracker.
 *
 * Lists every combatant in the active combat sorted by their
 * `nextActionTick` (lowest = next to act). Reads state written by
 * `recordActionFired` after each item.roll() call. Provides:
 *
 *   "Advance to next"  — set clockTick to the lowest nextActionTick,
 *                        clear that combatant's tick (they're ready to
 *                        declare a new action)
 *   "Reset clock"      — clockTick = 0, all combatant celerity flags
 *                        cleared
 *
 * Open via game.aspectsofpower.celerity.openTracker() from console, or
 * via the Combat Tracker sidebar button registered in registerHooks().
 */

import { getClockTick } from '../systems/celerity.mjs';

const FLAG_NS = 'aspectsofpower';

export class CelerityTracker extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'celerity-tracker',
    classes: ['aspects-of-power', 'celerity-tracker'],
    position: { width: 360, height: 'auto', top: 80, left: 80 },
    window: { title: 'Celerity Tracker', resizable: true },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/celerity-tracker.hbs' },
  };

  /** @override */
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const combat = game.combat;
    if (!combat?.started) {
      ctx.noCombat = true;
      ctx.clockTick = 0;
      ctx.rows = [];
      return ctx;
    }
    const clockTick = getClockTick(combat);
    const rows = [...combat.combatants].map(c => {
      const f = c.flags?.[FLAG_NS] ?? {};
      const next = f.nextActionTick ?? null;
      return {
        id: c.id,
        name: c.name,
        img: c.img,
        isPC: !!c.actor?.hasPlayerOwner,
        lastActionName: f.lastActionName ?? '—',
        lastActionWait: f.lastActionWait ?? null,
        nextActionTick: next,
        ticksUntil: next === null ? null : Math.max(0, next - clockTick),
        ready: next === null || next <= clockTick,
      };
    });
    // Sort: ready actors first (lowest tick wins), then waiting actors by ascending nextActionTick
    rows.sort((a, b) => {
      const ta = a.nextActionTick ?? Infinity;
      const tb = b.nextActionTick ?? Infinity;
      return ta - tb;
    });
    if (rows.length > 0) rows[0].nextUp = true;
    ctx.combat = combat;
    ctx.clockTick = clockTick;
    ctx.rows = rows;
    ctx.noCombat = false;
    return ctx;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('.cel-advance')?.addEventListener('click', () => this._advance());
    this.element.querySelector('.cel-reset')?.addEventListener('click', () => this._reset());
  }

  /**
   * Set the combat clock to the earliest `nextActionTick` and clear that
   * combatant's tick — they're now "ready" and can declare a new action.
   * If no combatant has a scheduled tick, this is a no-op.
   */
  async _advance() {
    const combat = game.combat;
    if (!combat?.started) return;
    const queued = [...combat.combatants]
      .map(c => ({ c, next: c.flags?.[FLAG_NS]?.nextActionTick ?? null }))
      .filter(e => e.next !== null && e.next > (combat.flags?.[FLAG_NS]?.clockTick ?? 0))
      .sort((a, b) => a.next - b.next);
    if (queued.length === 0) {
      ui.notifications.info('No queued actions to advance to.');
      return;
    }
    const { c, next } = queued[0];
    await combat.update({ [`flags.${FLAG_NS}.clockTick`]: next });
    await c.update({ [`flags.${FLAG_NS}.nextActionTick`]: null });
    ui.notifications.info(`Clock advanced to tick ${next} — ${c.name} is up.`);
  }

  /**
   * Zero the combat clock and clear every combatant's celerity flags.
   * Useful to reset between encounters or when the math gets confused.
   */
  async _reset() {
    const combat = game.combat;
    if (!combat?.started) return;
    await combat.update({ [`flags.${FLAG_NS}.clockTick`]: 0 });
    for (const c of combat.combatants) {
      await c.update({
        [`flags.${FLAG_NS}.nextActionTick`]: null,
        [`flags.${FLAG_NS}.lastActionName`]: null,
        [`flags.${FLAG_NS}.lastActionWait`]: null,
        [`flags.${FLAG_NS}.lastActionAt`]: null,
      });
    }
    ui.notifications.info('Celerity clock reset.');
  }
}

/**
 * Register hooks that auto-refresh the tracker when combat state changes.
 * Idempotent — safe to call multiple times.
 */
let _registered = false;
export function registerCelerityTrackerHooks() {
  if (_registered) return;
  _registered = true;
  const refresh = () => {
    const app = Object.values(ui.windows).find(a => a instanceof CelerityTracker);
    if (app) app.render();
  };
  Hooks.on('updateCombatant', refresh);
  Hooks.on('updateCombat',    refresh);
  Hooks.on('createCombatant', refresh);
  Hooks.on('deleteCombatant', refresh);
  Hooks.on('combatStart',     refresh);
}

/**
 * Open the tracker. Singleton — re-renders if already open.
 */
export function openTracker() {
  registerCelerityTrackerHooks();
  const existing = Object.values(ui.windows).find(a => a instanceof CelerityTracker);
  if (existing) {
    existing.render(true);
    return existing;
  }
  const app = new CelerityTracker();
  app.render(true);
  return app;
}
