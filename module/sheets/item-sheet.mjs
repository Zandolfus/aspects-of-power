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
    item:          { template: 'systems/aspects-of-power/templates/item/item-item-sheet.hbs', scrollable: ['.sheet-body'] },
    feature:       { template: 'systems/aspects-of-power/templates/item/item-feature-sheet.hbs', scrollable: ['.sheet-body'] },
    skill:         { template: 'systems/aspects-of-power/templates/item/item-skill-sheet.hbs', scrollable: ['.sheet-body'] },
    race:          { template: 'systems/aspects-of-power/templates/item/item-race-sheet.hbs', scrollable: ['.sheet-body'] },
    class:         { template: 'systems/aspects-of-power/templates/item/item-class-sheet.hbs', scrollable: ['.sheet-body'] },
    profession:    { template: 'systems/aspects-of-power/templates/item/item-profession-sheet.hbs', scrollable: ['.sheet-body'] },
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

    // Prepare augment rows for item-type items (pad to augmentSlots count).
    if (this.item.type === 'item') {
      const slots = this.item.system.augmentSlots ?? 0;
      const existing = this.item.system.augments ?? [];
      context.augmentRows = [];
      for (let i = 0; i < slots; i++) {
        context.augmentRows.push(existing[i] ?? { name: '', bonus: '' });
      }
    }

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

      // Chained skills: list of other Active skills on the parent actor for the dropdown.
      if (this.item.actor) {
        context.availableChainSkills = this.item.actor.items
          .filter(i => i.type === 'skill' && i.id !== this.item.id && i.system.skillType === 'Active')
          .map(i => ({ id: i.id, name: i.name }));
      } else {
        context.availableChainSkills = [];
      }
      context.chainedSkills = (this.item.system.chainedSkills ?? []).map((entry, index) => ({
        index,
        skillId: entry.skillId,
        skillName: this.item.actor?.items.get(entry.skillId)?.name ?? '(unknown)',
        trigger: entry.trigger,
      }));
    }

    // Race template items: build rank gains rows (multi-rank).
    if (this.item.type === 'race') {
      const tiers = CONFIG.ASPECTSOFPOWER.rankTiers;
      const abilityKeys = Object.keys(CONFIG.ASPECTSOFPOWER.abilities);
      context.rankGainsRows = Object.entries(tiers).map(([tierKey, tierDef]) => ({
        tierKey,
        tierLabel: tierKey,
        tierRange: `${tierDef.min}–${tierDef.max === Infinity ? '+' : tierDef.max}`,
        freePoints: this.item.system.freePointsPerLevel?.[tierKey] ?? 0,
        freePointsFieldName: `system.freePointsPerLevel.${tierKey}`,
        abilities: abilityKeys.map(aKey => ({
          key: aKey,
          label: game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[aKey]),
          value: this.item.system.rankGains?.[tierKey]?.[aKey] ?? 0,
          fieldName: `system.rankGains.${tierKey}.${aKey}`,
        })),
      }));
    }

    // Class template items: single rank with one set of gains.
    if (this.item.type === 'class') {
      const abilityKeys = Object.keys(CONFIG.ASPECTSOFPOWER.abilities);
      context.classGainFields = abilityKeys.map(aKey => ({
        key: aKey,
        label: game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[aKey]),
        value: this.item.system.gains?.[aKey] ?? 0,
        fieldName: `system.gains.${aKey}`,
      }));
    }

    // Profession template items: single rank with one set of gains.
    if (this.item.type === 'profession') {
      const abilityKeys = Object.keys(CONFIG.ASPECTSOFPOWER.abilities);
      context.professionGainFields = abilityKeys.map(aKey => ({
        key: aKey,
        label: game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[aKey]),
        value: this.item.system.gains?.[aKey] ?? 0,
        fieldName: `system.gains.${aKey}`,
      }));
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

    // Skill category change: update category and clear tags (available tags differ per category).
    if (this.item.type === 'skill' && event.target?.name === 'system.skillCategory') {
      await this.document.update({
        'system.skillCategory': event.target.value,
        'system.tags': [],
      });
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

    // AOE config: update individual fields via dot-notation so conditional
    // DOM elements (width/angle that only appear for certain shapes) don't
    // clobber each other.
    if (this.item.type === 'skill' && event.target?.name?.startsWith('system.aoe.')) {
      let value;
      if (event.target.type === 'checkbox') {
        value = event.target.checked;
      } else if (event.target.type === 'number') {
        value = Number(event.target.value);
      } else {
        value = event.target.value;
      }
      await this.document.update({ [event.target.name]: value });
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
        debuffStackable:   form.querySelector('[name="system.tagConfig.debuffStackable"]')?.checked ?? false,
        debuffDealsDamage: form.querySelector('[name="system.tagConfig.debuffDealsDamage"]')?.checked ?? false,
        debuffDamageType:  form.querySelector('[name="system.tagConfig.debuffDamageType"]')?.value ?? 'physical',

        // Repair: collect checked material types.
        repairMaterials: [...form.querySelectorAll('input[name="system.tagConfig.repairMaterials"]:checked')]
          .map(el => el.value),
      };
      await this.document.update({ 'system.tagConfig': tagConfigData });
      return;
    }

    // --- Equipment item fields ---
    if (this.item.type === 'item') {
      const name = event.target?.name;

      // Simple equipment fields: direct update.
      if (name === 'system.slot' || name === 'system.twoHanded' || name === 'system.isRepairKit'
          || name === 'system.repairAmount' || name === 'system.material'
          || name === 'system.armorBonus' || name === 'system.veilBonus'
          || name === 'system.durability.value'
          || name === 'system.progress'
          || name === 'system.quantity' || name === 'system.weight') {
        let value;
        if (event.target.type === 'checkbox') value = event.target.checked;
        else if (event.target.type === 'number') value = Number(event.target.value);
        else value = event.target.value;
        await this.document.update({ [name]: value });
        return;
      }

      // Rarity change: update rarity + auto-set augmentSlots from config.
      if (name === 'system.rarity') {
        const rarity = event.target.value;
        const augSlots = CONFIG.ASPECTSOFPOWER.rarities[rarity]?.augments ?? 0;
        await this.document.update({ 'system.rarity': rarity, 'system.augmentSlots': augSlots });
        return;
      }

      // Stat bonus or augment fields: collect from DOM.
      if (event.target?.classList?.contains('stat-bonus-ability')
          || event.target?.classList?.contains('stat-bonus-value')
          || event.target?.classList?.contains('augment-name')
          || event.target?.classList?.contains('augment-bonus')) {
        this._saveEquipmentArrays();
        return;
      }
    }

    // Chain config: collect chain entries when any chain select changes.
    if (this.item.type === 'skill' && (
      event.target?.classList?.contains('chain-skill-select') ||
      event.target?.classList?.contains('chain-trigger-select')
    )) {
      const form = this.element.querySelector('form');
      const chainEntries = [];
      form.querySelectorAll('.chain-entry').forEach(row => {
        const skillId = row.querySelector('.chain-skill-select')?.value ?? '';
        const trigger = row.querySelector('.chain-trigger-select')?.value ?? 'always';
        if (skillId) chainEntries.push({ skillId, trigger });
      });
      await this.document.update({ 'system.chainedSkills': chainEntries });
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

  /**
   * Collect stat bonus and augment arrays from the DOM and save them.
   */
  async _saveEquipmentArrays() {
    const form = this.element.querySelector('form');

    // Stat bonuses.
    const statBonuses = [];
    form.querySelectorAll('.stat-bonus-row').forEach(row => {
      const ability = row.querySelector('.stat-bonus-ability')?.value ?? 'strength';
      const value = Number(row.querySelector('.stat-bonus-value')?.value) || 0;
      statBonuses.push({ ability, value });
    });

    // Augments.
    const augments = [];
    form.querySelectorAll('.augment-row').forEach(row => {
      const name = row.querySelector('.augment-name')?.value ?? '';
      const bonus = row.querySelector('.augment-bonus')?.value ?? '';
      augments.push({ name, bonus });
    });

    await this.document.update({ 'system.statBonuses': statBonuses, 'system.augments': augments });
  }

  /** @override – save scroll position before DOM replacement. */
  _preRender(context, options) {
    this._savedScrollTop = this.element?.querySelector('.sheet-body')?.scrollTop ?? 0;
    return super._preRender(context, options);
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

    // Restore scroll AFTER Tabs.bind() — Tabs changes layout (shows/hides tabs)
    // which can reset scroll position.
    const body = this.element?.querySelector('.sheet-body');
    if (body && this._savedScrollTop) body.scrollTop = this._savedScrollTop;

    // Keep tabGroups in sync when the user clicks a tab.
    this.element.querySelectorAll('.sheet-tabs .item').forEach(el => {
      el.addEventListener('click', () => { this.tabGroups.primary = el.dataset.tab; });
    });

    if (!this.isEditable) return;

    // Profile image — open FilePicker on click (AppV2 doesn't auto-wire data-edit).
    this.element.querySelectorAll('[data-edit="img"]').forEach(el => {
      el.addEventListener('click', () => {
        new FilePicker({
          type: 'image',
          current: this.document.img,
          callback: path => this.document.update({ img: path }),
        }).browse();
      });
    });

    // <prose-mirror> fires a custom "save" event; update the document directly.
    this.element.querySelectorAll('prose-mirror').forEach(el => {
      el.addEventListener('save', () => this.document.update({ [el.name]: el.value }));
    });

    this.element.querySelectorAll('.effect-control').forEach(el => {
      el.addEventListener('click', ev => onManageActiveEffect(ev, this.item));
    });

    // --- Equipment: Add / Delete stat bonus rows ---
    this.element.querySelector('.stat-bonus-add')?.addEventListener('click', async () => {
      const bonuses = [...(this.item.system.statBonuses ?? []), { ability: 'strength', value: 0 }];
      await this.document.update({ 'system.statBonuses': bonuses });
    });

    this.element.querySelectorAll('.stat-bonus-delete').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = Number(el.dataset.index);
        const bonuses = [...(this.item.system.statBonuses ?? [])];
        bonuses.splice(idx, 1);
        await this.document.update({ 'system.statBonuses': bonuses });
      });
    });

    // --- Skill Chaining: Add / Delete chain entries ---
    this.element.querySelector('.chain-add')?.addEventListener('click', async () => {
      const chains = [...(this.item.system.chainedSkills ?? []), { skillId: '', trigger: 'always' }];
      await this.document.update({ 'system.chainedSkills': chains });
    });

    this.element.querySelectorAll('.chain-delete').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = Number(el.dataset.chainIndex);
        const chains = [...(this.item.system.chainedSkills ?? [])];
        chains.splice(idx, 1);
        await this.document.update({ 'system.chainedSkills': chains });
      });
    });
  }
}
