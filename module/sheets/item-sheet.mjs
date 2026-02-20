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

    context.item     = this.item;
    context.editable = this.isEditable;
    context.cssClass = this.isEditable ? 'editable' : 'locked';
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
   * For skill items, when a roll-configuration field changes, collect all roll
   * fields from the DOM and write them as a single system.roll object.
   * This bypasses any null-parent issue: if _source.system.roll is null,
   * the full-object update replaces it cleanly rather than trying to merge
   * into null through nested dot-notation paths.
   * @override
   */
  async _onChangeForm(formConfig, event) {
    if (this.item.type === 'skill' && event.target?.name?.startsWith('system.roll.')) {
      const form = this.element.querySelector('form');
      const rollData = {
        dice:          form.querySelector('[name="system.roll.dice"]')?.value ?? '',
        abilities:     form.querySelector('[name="system.roll.abilities"]')?.value ?? '',
        resource:      form.querySelector('[name="system.roll.resource"]')?.value ?? '',
        cost:          Number(form.querySelector('[name="system.roll.cost"]')?.value) || 0,
        type:          form.querySelector('[name="system.roll.type"]')?.value ?? '',
        diceBonus:     Number(form.querySelector('[name="system.roll.diceBonus"]')?.value) || 1,
        targetDefense: form.querySelector('[name="system.roll.targetDefense"]')?.value ?? '',
        damageType:    form.querySelector('[name="system.roll.damageType"]')?.value ?? 'physical',
      };
      await this.document.update({ 'system.roll': rollData });
      return;
    }
    return super._onChangeForm(formConfig, event);
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

    // AppV2 doesn't inherit AppV1's activateEditor() — wire up ProseMirror manually.
    this.element.querySelectorAll('.editor-edit').forEach(btn => {
      btn.addEventListener('click', async ev => {
        ev.preventDefault();
        const wrapper   = btn.closest('.editor');
        const contentEl = wrapper?.querySelector('.editor-content');
        if (!contentEl || wrapper.classList.contains('active')) return;
        wrapper.classList.add('active');
        btn.style.display = 'none';
        const fieldName  = contentEl.dataset.target ?? contentEl.dataset.fieldName ?? 'system.description';
        const rawContent = foundry.utils.getProperty(this.document.toObject(), fieldName) ?? '';
        await foundry.applications.ux.ProseMirrorEditor.create(contentEl, rawContent, {
          document:  this.document,
          fieldName: fieldName,
        });
      });
    });

    this.element.querySelectorAll('.effect-control').forEach(el => {
      el.addEventListener('click', ev => onManageActiveEffect(ev, this.item));
    });
  }
}
