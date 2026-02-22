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

    // Build grouped attribute data for buff/debuff multi-select UI.
    if (this.item.type === 'skill') {
      const buildGroups = (entries) => CONFIG.ASPECTSOFPOWER.attributeGroups.map(group => ({
        key: group.key,
        label: game.i18n.localize(group.label),
        attributes: group.attributes.map(attrKey => {
          const entry = (entries ?? []).find(e => e.attribute === attrKey);
          return {
            key: attrKey,
            label: game.i18n.localize(CONFIG.ASPECTSOFPOWER.buffableAttributes[attrKey]),
            checked: !!entry,
            value: entry?.value ?? 0,
          };
        }),
      }));
      context.buffAttributeGroups  = buildGroups(this.item.system.tagConfig?.buffEntries);
      context.debuffAttributeGroups = buildGroups(this.item.system.tagConfig?.debuffEntries);
    }

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
    // Top-level document fields (e.g. name): update directly so the full-form
    // processor doesn't choke on complex skill fields.
    if (event.target?.name && !event.target.name.startsWith('system.') && !event.target.classList?.contains('attr-value')) {
      await this.document.update({ [event.target.name]: event.target.value });
      return;
    }

    // Simple system fields (e.g. skillType, description): update directly
    // so the full-form processor doesn't choke on complex skill fields.
    if (this.item.type === 'skill' && event.target?.name === 'system.skillType') {
      await this.document.update({ [event.target.name]: event.target.value });
      return;
    }

    // Tag checkboxes: collect all checked values into an array.
    if (this.item.type === 'skill' && event.target?.name === 'system.tags') {
      const form = this.element.querySelector('form');
      const checked = [...form.querySelectorAll('input[name="system.tags"]:checked')]
        .map(el => el.value);
      await this.document.update({ 'system.tags': checked });
      return;
    }

    // AOE config: collect all aoe fields atomically.
    if (this.item.type === 'skill' && event.target?.name?.startsWith('system.aoe.')) {
      const form = this.element.querySelector('form');
      const aoeData = {
        enabled:          form.querySelector('[name="system.aoe.enabled"]')?.checked ?? false,
        shape:            form.querySelector('[name="system.aoe.shape"]')?.value ?? 'circle',
        diameter:         Number(form.querySelector('[name="system.aoe.diameter"]')?.value) || 10,
        width:            Number(form.querySelector('[name="system.aoe.width"]')?.value) || 5,
        angle:            Number(form.querySelector('[name="system.aoe.angle"]')?.value) || 53,
        targetingMode:    form.querySelector('[name="system.aoe.targetingMode"]')?.value ?? 'all',
        templateDuration: Number(form.querySelector('[name="system.aoe.templateDuration"]')?.value) || 0,
      };
      await this.document.update({ 'system.aoe': aoeData });
      return;
    }

    // Tag-specific config: collect all tagConfig fields atomically.
    // Also catch .attr-value inputs (multiplier fields) which have no name= attribute
    // but still need to trigger a tagConfig save.
    if (this.item.type === 'skill' && (event.target?.name?.startsWith('system.tagConfig.') || event.target?.classList?.contains('attr-value'))) {
      const form = this.element.querySelector('form');

      // Buff entries: collect checked attributes + their multiplier inputs.
      const buffEntries = [];
      form.querySelectorAll('input[name="system.tagConfig.buffEntries"]:checked').forEach(cb => {
        const valInput = form.querySelector(`.attr-value[data-attr="${cb.value}"][data-target="buff"]`);
        buffEntries.push({ attribute: cb.value, value: Number(valInput?.value) || 1 });
      });

      // Debuff entries: same pattern.
      const debuffEntries = [];
      form.querySelectorAll('input[name="system.tagConfig.debuffEntries"]:checked').forEach(cb => {
        const valInput = form.querySelector(`.attr-value[data-attr="${cb.value}"][data-target="debuff"]`);
        debuffEntries.push({ attribute: cb.value, value: Number(valInput?.value) || 1 });
      });

      const tagConfigData = {
        restorationTarget:   form.querySelector('[name="system.tagConfig.restorationTarget"]')?.value ?? 'selected',
        restorationResource: form.querySelector('[name="system.tagConfig.restorationResource"]')?.value ?? 'health',
        buffEntries,
        buffDuration:      Number(form.querySelector('[name="system.tagConfig.buffDuration"]')?.value) || 1,
        buffStackable:     form.querySelector('[name="system.tagConfig.buffStackable"]')?.checked ?? false,
        debuffEntries,
        debuffDuration:    Number(form.querySelector('[name="system.tagConfig.debuffDuration"]')?.value) || 1,
        debuffDealsDamage: form.querySelector('[name="system.tagConfig.debuffDealsDamage"]')?.checked ?? false,
        debuffDamageType:  form.querySelector('[name="system.tagConfig.debuffDamageType"]')?.value ?? 'physical',
      };
      await this.document.update({ 'system.tagConfig': tagConfigData });
      return;
    }

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

        // Foundry has no CSS to hide .pm-dropdown > ul and its #onActivate does not touch
        // display, so we manage dropdown visibility entirely. CSS positions the <ul>
        // absolutely; JS hides it initially and toggles on click.
        wrapper.querySelectorAll('.editor-menu .pm-dropdown').forEach(btn => {
          const ul = btn.querySelector(':scope > ul');
          if (!ul) return;
          ul.style.display = 'none';
          btn.addEventListener('click', ev => {
            if (ul.contains(ev.target)) return; // let item-action clicks through
            ev.stopPropagation();
            const isOpen = ul.style.display === 'block';
            wrapper.querySelectorAll('.editor-menu .pm-dropdown > ul').forEach(u => {
              u.style.display = 'none';
            });
            if (!isOpen) ul.style.display = 'block';
          });
        });
        document.addEventListener('click', () => {
          wrapper.querySelectorAll('.editor-menu .pm-dropdown > ul').forEach(ul => {
            ul.style.display = 'none';
          });
        });

        // ProseMirrorEditor wraps the editable div in a new .editor-container sibling to
        // .editor-menu. Neither element has a definite CSS height from the flex chain, so
        // measure and set the container height explicitly.
        const menuEl      = wrapper.querySelector('.editor-menu');
        const containerEl = wrapper.querySelector('.editor-container');
        if (menuEl && containerEl) {
          const tabEl    = wrapper.closest('[data-tab]') ?? wrapper;
          const tabRect  = tabEl.getBoundingClientRect();
          const menuRect = menuEl.getBoundingClientRect();
          // Set width on the wrapper so both .editor-menu and .editor-container inherit it.
          wrapper.style.width        = `${tabRect.width}px`;
          containerEl.style.height   = `${Math.max(200, tabRect.height - menuRect.height)}px`;
          containerEl.style.overflowY = 'auto';
        }
      });
    });

    this.element.querySelectorAll('.effect-control').forEach(el => {
      el.addEventListener('click', ev => onManageActiveEffect(ev, this.item));
    });
  }
}
