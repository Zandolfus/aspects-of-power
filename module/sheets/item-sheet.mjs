import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';

/**
 * Extend ItemSheetV2 with Aspects of Power-specific behaviour.
 * @extends {foundry.applications.sheets.ItemSheetV2}
 */
export class AspectsofPowerItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ItemSheetV2
) {

  static DEFAULT_OPTIONS = {
    classes: ['aspects-of-power', 'sheet', 'item'],
    position: { width: 520, height: 480 },
    window: { resizable: true },
    form: { submitOnChange: true },
    tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'description' }],
  };

  // Each item type maps to its own template file.
  static PARTS = {
    item:    { template: 'systems/aspects-of-power/templates/item/item-item-sheet.hbs' },
    feature: { template: 'systems/aspects-of-power/templates/item/item-feature-sheet.hbs' },
    skill:   { template: 'systems/aspects-of-power/templates/item/item-skill-sheet.hbs' },
  };

  /** Render only the part that matches this item's type. */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    options.parts = [this.item.type];
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context  = await super._prepareContext(options);
    console.log('this is context', context);
    context.optionObj = CONFIG.ASPECTSOFPOWER.abilities;

    const itemData = this.document.toObject(false);

    context.item = this.item;
    context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.item.system.description,
      {
        secrets:    this.document.isOwner,
        rollData:   this.item.getRollData(),
        relativeTo: this.item,
      }
    );

    context.system  = this.item.system;
    context.flags   = itemData.flags;
    context.config  = CONFIG.ASPECTSOFPOWER;
    context.effects = prepareActiveEffectCategories(this.item.effects);

    return context;
  }

  /* -------------------------------------------- */

  /**
   * For skill items, consolidate individual system.roll.* keys into a single
   * system.roll object so the update replaces any null parent rather than
   * trying to write into null (which silently fails for items created before
   * the roll SchemaField was added).
   * @override
   */
  async _processSubmitData(event, form, submitData) {
    if (this.item.type === 'skill') {
      const rollData = {};
      const prefix = 'system.roll.';
      for (const key of Object.keys(submitData)) {
        if (key.startsWith(prefix)) {
          rollData[key.slice(prefix.length)] = submitData[key];
          delete submitData[key];
        }
      }
      if (Object.keys(rollData).length) submitData['system.roll'] = rollData;
    }
    return super._processSubmitData(event, form, submitData);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // AppV2 doesn't auto-instantiate Tabs — bind manually on every render.
    // Use tabGroups.primary to restore the active tab after re-renders caused
    // by submitOnChange, so the user isn't kicked back to 'description' after
    // every keystroke on the Damage tab.
    const initial = this.tabGroups.primary ?? 'description';
    new foundry.applications.ux.Tabs({ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial })
      .bind(this.element);

    // Keep tabGroups in sync when the user clicks a tab.
    this.element.querySelectorAll('.sheet-tabs .item').forEach(el => {
      el.addEventListener('click', () => { this.tabGroups.primary = el.dataset.tab; });
    });

    if (!this.isEditable) return;

    this.element.querySelectorAll('.effect-control').forEach(el => {
      el.addEventListener('click', ev => onManageActiveEffect(ev, this.item));
    });
  }
}
