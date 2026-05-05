/**
 * Quick Actions dialog — pops after a player's action resolves in celerity
 * combat, showing their favorited skills with one-click cast/declare
 * buttons. Goal: a "spam basic attack" turn takes 1 click instead of 5.
 *
 * Trigger lives in item.mjs after `executeDeferred` completes (per the
 * pending-list spec). The dialog only fires when:
 *   - actor is player-owned
 *   - actor has at least one skill marked `system.favorite: true`
 *
 * Click → `item.roll()` which goes through the normal `declareAction`
 * path, queueing the next action on the celerity tracker.
 */
export class QuickActionsDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    id: 'quick-actions-{id}',
    classes: ['aspects-of-power', 'quick-actions-dialog'],
    position: { width: 360, height: 'auto' },
    window: { title: 'Quick Actions', resizable: false },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/quick-actions-dialog.hbs' },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sc = CONFIG.ASPECTSOFPOWER;
    const favorites = this.actor.items.filter(i => i.type === 'skill' && i.system.favorite);
    context.actor = this.actor;
    context.favorites = favorites.map(s => {
      const rarityDef = sc.skillRarities?.[s.system.rarity];
      return {
        id: s.id,
        name: s.name,
        img: s.img,
        rarity: s.system.rarity,
        rarityColor: rarityDef?.color ?? '#ffffff',
        rarityLabel: rarityDef?.label ? game.i18n.localize(rarityDef.label) : s.system.rarity,
        skillType: s.system.skillType,
        cost: s.system.roll?.cost,
        resource: s.system.roll?.resource,
      };
    });
    context.hasFavorites = context.favorites.length > 0;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Click on a favorite → roll the skill (which will declare the action
    // via item.mjs's declareAction path) and close the dialog.
    this.element.querySelectorAll('.quick-action').forEach(el => {
      el.addEventListener('click', async ev => {
        ev.preventDefault();
        const skillId = el.dataset.skillId;
        const skill = this.actor.items.get(skillId);
        if (!skill) return;
        this.close();
        await skill.roll();
      });
    });

    // Skip / dismiss button.
    this.element.querySelector('.quick-action-skip')?.addEventListener('click', () => {
      this.close();
    });
  }

  /**
   * Convenience helper: pop the dialog if the actor has favorites and
   * the current user owns it. Works for PCs and NPCs both — the goal is
   * keeping combat speed up, so any actor with favorites set gets the
   * one-click UX. Safe to call from post-action hooks regardless of
   * context. The runtime trigger in item.mjs uses an explicit socket
   * dispatch path that mirrors the defense-dialog pattern; this helper
   * remains for ad-hoc invocation.
   */
  static maybePopFor(actor) {
    if (!actor) return;
    if (!actor.isOwner) return;
    const hasFavorites = actor.items.some(i => i.type === 'skill' && i.system.favorite);
    if (!hasFavorites) return;
    new QuickActionsDialog(actor).render(true);
  }
}
