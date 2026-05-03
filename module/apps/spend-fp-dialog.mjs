/**
 * Spend Free Points dialog — standalone allocation UI for the actor's
 * accumulated `system.freePoints` pool. Unlike the level-up dialog (which
 * requires all FP to be spent in one shot at level-up time), this dialog
 * supports partial spending so players can allocate over time.
 *
 * Owner-only. Writes residual back to `system.freePoints`.
 */

const ABILITY_KEYS = [
  'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception',
];

export class SpendFreePointsDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.allocation = Object.fromEntries(ABILITY_KEYS.map(k => [k, 0]));
  }

  static DEFAULT_OPTIONS = {
    id: 'spend-fp-dialog-{id}',
    classes: ['aspects-of-power', 'spend-fp-dialog'],
    position: { width: 460, height: 'auto' },
    window: { title: 'Spend Free Points', resizable: true },
    actions: {
      apply:  SpendFreePointsDialog._onApply,
      cancel: SpendFreePointsDialog._onCancel,
    },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/spend-fp-dialog.hbs' },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;
    const pool = sys.freePoints ?? 0;
    const allocated = Object.values(this.allocation).reduce((s, v) => s + Math.max(0, v), 0);
    context.actor    = this.actor;
    context.pool     = pool;
    context.allocated = allocated;
    context.remaining = pool - allocated;
    context.overspent = allocated > pool;
    context.canApply  = allocated > 0 && allocated <= pool;
    context.abilities = ABILITY_KEYS.map(k => ({
      key:     k,
      current: sys.abilities?.[k]?.value ?? 0,
      alloc:   this.allocation[k] ?? 0,
      after:   (sys.abilities?.[k]?.value ?? 0) + (this.allocation[k] ?? 0),
    }));
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll('input[name^="alloc."]').forEach(el => {
      el.addEventListener('input', async () => {
        const key = el.name.slice('alloc.'.length);
        const v = parseInt(el.value, 10);
        this.allocation[key] = Number.isFinite(v) && v >= 0 ? v : 0;
        await this.render();
      });
    });
  }

  static async _onApply(_event, _target) {
    const sys = this.actor.system;
    const pool = sys.freePoints ?? 0;
    const allocated = Object.values(this.allocation).reduce((s, v) => s + Math.max(0, v), 0);
    if (allocated <= 0) { this.close(); return; }
    if (allocated > pool) {
      ui.notifications.warn(`Tried to spend ${allocated} but only ${pool} available.`);
      return;
    }
    const updates = { 'system.freePoints': pool - allocated };
    for (const k of ABILITY_KEYS) {
      const v = this.allocation[k] ?? 0;
      if (v > 0) {
        const cur = this.actor._source.system.abilities[k].value;
        updates[`system.abilities.${k}.value`] = cur + v;
      }
    }
    await this.actor.update(updates);
    ui.notifications.info(`Spent ${allocated} free point${allocated === 1 ? '' : 's'} on ${this.actor.name}.`);
    this.close();
  }

  static async _onCancel(_event, _target) {
    this.close();
  }
}
