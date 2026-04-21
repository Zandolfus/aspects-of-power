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
    augment:       { template: 'systems/aspects-of-power/templates/item/item-augment-sheet.hbs', scrollable: ['.sheet-body'] },
    consumable:    { template: 'systems/aspects-of-power/templates/item/item-consumable-sheet.hbs', scrollable: ['.sheet-body'] },
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

    // Tag editor context for items that support systemTags.
    if (['race', 'class', 'profession', 'item'].includes(this.item.type)) {
      context.tagRegistry = CONFIG.ASPECTSOFPOWER.tagRegistry ?? {};
      context.tagCategories = CONFIG.ASPECTSOFPOWER.tagCategories ?? {};
      context.systemTags = this.item.system.systemTags ?? [];
      // Build a color lookup by category for chip borders.
      context.tagCategoryColors = {};
      for (const [key, cat] of Object.entries(context.tagCategories)) {
        context.tagCategoryColors[key] = cat.color;
      }
    }

    // Skill sheet: build filtered roll type and resource lists based on actor gate tags.
    if (this.item.type === 'skill') {
      const allRollTypes = CONFIG.ASPECTSOFPOWER.rollTypes ?? {};
      const allResources = CONFIG.ASPECTSOFPOWER.skillResources ?? {};
      const gateRules = CONFIG.ASPECTSOFPOWER.gateRules ?? {};
      const actor = this.item.actor;

      // Collect blocked types/resources from actor's gate tags.
      const blockedTypes = new Set();
      const blockedResources = new Set();
      if (actor?.system?.collectedTags) {
        for (const [tagId] of actor.system.collectedTags) {
          const rule = gateRules[tagId];
          if (!rule) continue;
          for (const t of rule.blockedTypes) blockedTypes.add(t);
          for (const r of rule.blockedResources) blockedResources.add(r);
        }
      }

      // Filter available options.
      context.availableRollTypes = {};
      for (const [key, label] of Object.entries(allRollTypes)) {
        if (!blockedTypes.has(key)) context.availableRollTypes[key] = label;
      }
      context.availableResources = {};
      for (const [key, label] of Object.entries(allResources)) {
        if (!blockedResources.has(key)) context.availableResources[key] = label;
      }
      context.hasGateRestrictions = blockedTypes.size > 0 || blockedResources.size > 0;

      // Check if a debuff subtype tag is present (hides manual debuff type dropdown).
      const debuffSubtypes = CONFIG.ASPECTSOFPOWER.debuffSubtypeTags ?? {};
      const skillTags = this.item.system.tags ?? [];
      context.hasDebuffSubtype = skillTags.some(t => debuffSubtypes[t]);
    }

    // Item bonus field labels for augment sheets.
    if (this.item.type === 'augment') {
      context.itemBonusFields = {
        armorBonus: game.i18n.localize('ASPECTSOFPOWER.Augment.fieldArmor'),
        veilBonus:  game.i18n.localize('ASPECTSOFPOWER.Augment.fieldVeil'),
      };
    }

    // Prepare augment slot display data for item-type items.
    if (this.item.type === 'item') {
      const slots = this.item.system.augmentSlots ?? 0;
      const existing = this.item.system.augments ?? [];
      context.augmentSlots = [];
      for (let i = 0; i < slots; i++) {
        const entry = existing[i];
        const augmentId = entry?.augmentId ?? '';
        let slotData = { filled: false, augmentId: '', name: '', img: '', bonusSummary: '' };
        if (augmentId && this.item.actor) {
          const augItem = this.item.actor.items.get(augmentId);
          if (augItem && augItem.type === 'augment') {
            const statParts = (augItem.system.statBonuses ?? [])
              .filter(b => b.ability && b.value)
              .map(b => `${game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[b.ability])} +${b.value}`);
            const itemParts = (augItem.system.itemBonuses ?? [])
              .filter(b => b.field && b.value)
              .map(b => {
                const label = b.field === 'armorBonus' ? game.i18n.localize('ASPECTSOFPOWER.Augment.fieldArmor')
                            : game.i18n.localize('ASPECTSOFPOWER.Augment.fieldVeil');
                const suffix = b.mode === 'percentage' ? '%' : '';
                return `${label} +${b.value}${suffix}`;
              });
            const bonuses = [...statParts, ...itemParts].join(', ');
            slotData = {
              filled: true,
              augmentId: augItem.id,
              name: augItem.name,
              img: augItem.img,
              bonusSummary: bonuses || '—',
            };
          }
        }
        context.augmentSlots.push(slotData);
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
    if (this.item.type === 'skill' && (
      event.target?.name === 'system.skillType' ||
      event.target?.name === 'system.magicType'
    )) {
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

    // Tag autocomplete is handled by _bindSkillTagAutocomplete — skip form submission for it.
    if (this.item.type === 'skill' && event.target?.classList?.contains('skill-tag-input')) return;

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
        restorationOverhealth: form.querySelector('[name="system.tagConfig.restorationOverhealth"]')?.checked ?? false,
        buffEntries,
        buffDuration:      Number(form.querySelector('[name="system.tagConfig.buffDuration"]')?.value) || 1,
        buffStackable:     form.querySelector('[name="system.tagConfig.buffStackable"]')?.checked ?? false,
        debuffEntries,
        debuffType:        form.querySelector('[name="system.tagConfig.debuffType"]')?.value ?? 'none',
        debuffDuration:    Number(form.querySelector('[name="system.tagConfig.debuffDuration"]')?.value) || 1,
        debuffStackable:   form.querySelector('[name="system.tagConfig.debuffStackable"]')?.checked ?? false,
        debuffScaleWithAttack: Number(form.querySelector('[name="system.tagConfig.debuffScaleWithAttack"]')?.value) || 0,
        debuffDealsDamage: form.querySelector('[name="system.tagConfig.debuffDealsDamage"]')?.checked ?? false,
        debuffDamageType:  form.querySelector('[name="system.tagConfig.debuffDamageType"]')?.value ?? 'physical',
        debuffDirectional: form.querySelector('[name="system.tagConfig.debuffDirectional"]')?.checked ?? false,

        // Forced movement.
        forcedMovement:     form.querySelector('[name="system.tagConfig.forcedMovement"]')?.checked ?? false,
        forcedMovementDir:  form.querySelector('[name="system.tagConfig.forcedMovementDir"]')?.value ?? 'push',
        forcedMovementDist: Number(form.querySelector('[name="system.tagConfig.forcedMovementDist"]')?.value) || 5,

        // Barrier multiplier (mana-to-HP ratio).
        barrierMultiplier: Number(form.querySelector('[name="system.tagConfig.barrierMultiplier"]')?.value) || 1,

        // Repair: collect checked material types.
        repairMaterials: [...form.querySelectorAll('input[name="system.tagConfig.repairMaterials"]:checked')]
          .map(el => el.value),

        // Sustain.
        sustainCost:     Number(form.querySelector('[name="system.tagConfig.sustainCost"]')?.value) || 0,
        sustainResource: form.querySelector('[name="system.tagConfig.sustainResource"]')?.value ?? 'mana',

        // Shrapnel.
        shrapnelMultiplier: Number(form.querySelector('[name="system.tagConfig.shrapnelMultiplier"]')?.value) || 1.5,

        // Craft.
        craftOutputSlot:     form.querySelector('[name="system.tagConfig.craftOutputSlot"]')?.value ?? '',
        craftOutputMaterial: form.querySelector('[name="system.tagConfig.craftOutputMaterial"]')?.value ?? '',

        // Gather.
        gatherMaterial: form.querySelector('[name="system.tagConfig.gatherMaterial"]')?.value ?? '',
        gatherElement:  form.querySelector('[name="system.tagConfig.gatherElement"]')?.value ?? '',
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
          || name === 'system.quantity' || name === 'system.weight'
          || name === 'system.isMaterial' || name === 'system.materialElement') {
        let value;
        if (event.target.type === 'checkbox') value = event.target.checked;
        else if (event.target.type === 'number') value = Number(event.target.value);
        else value = event.target.value;
        await this.document.update({ [name]: value });
        return;
      }

      // Rarity change: for equipment, also auto-set augmentSlots.
      if (name === 'system.rarity') {
        const rarity = event.target.value;
        if (this.document.type === 'item') {
          const augSlots = CONFIG.ASPECTSOFPOWER.rarities[rarity]?.augments ?? 0;
          await this.document.update({ 'system.rarity': rarity, 'system.augmentSlots': augSlots });
        } else {
          await this.document.update({ 'system.rarity': rarity });
        }
        return;
      }

      // Stat bonus fields: collect from DOM.
      if (event.target?.classList?.contains('stat-bonus-ability')
          || event.target?.classList?.contains('stat-bonus-value')) {
        this._saveEquipmentArrays();
        return;
      }
    }

    // --- Augment item fields: stat bonus and item bonus changes ---
    if (this.item.type === 'augment') {
      if (event.target?.classList?.contains('stat-bonus-ability')
          || event.target?.classList?.contains('stat-bonus-value')) {
        this._saveEquipmentArrays();
        return;
      }
      if (event.target?.classList?.contains('item-bonus-field')
          || event.target?.classList?.contains('item-bonus-value')
          || event.target?.classList?.contains('item-bonus-mode')) {
        this._saveItemBonuses();
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

    if (this.item.type === 'skill' && event.target?.name === 'system.rarity') {
      await this.document.update({ 'system.rarity': event.target.value });
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
    // --- Consumable fields: direct update for simple fields ---
    if (this.item.type === 'consumable' && event.target?.name?.startsWith('system.')) {
      const name = event.target.name;
      let value;
      if (event.target.type === 'checkbox') value = event.target.checked;
      else if (event.target.type === 'number') value = Number(event.target.value);
      else value = event.target.value;
      await this.document.update({ [name]: value });
      return;
    }

    return super._onChangeForm(formConfig, event);
  }

  /**
   * Collect stat bonus arrays from the DOM and save them.
   * Works for both equipment items and augment items (both have statBonuses).
   */
  async _saveEquipmentArrays() {
    const form = this.element.querySelector('form');
    const statBonuses = [];
    form.querySelectorAll('.stat-bonus-row').forEach(row => {
      const ability = row.querySelector('.stat-bonus-ability')?.value ?? 'strength';
      const value = Number(row.querySelector('.stat-bonus-value')?.value) || 0;
      statBonuses.push({ ability, value });
    });
    await this.document.update({ 'system.statBonuses': statBonuses });
  }

  /**
   * Collect item bonus arrays from the DOM and save them (augment items only).
   */
  async _saveItemBonuses() {
    const form = this.element.querySelector('form');
    const itemBonuses = [];
    form.querySelectorAll('.item-bonus-row').forEach(row => {
      const field = row.querySelector('.item-bonus-field')?.value ?? 'armorBonus';
      const value = Number(row.querySelector('.item-bonus-value')?.value) || 0;
      const mode  = row.querySelector('.item-bonus-mode')?.value ?? 'percentage';
      itemBonuses.push({ field, value, mode });
    });
    await this.document.update({ 'system.itemBonuses': itemBonuses });
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

    // ── Tag Editor (system tags on race/class/prof/equipment) ──
    this._bindTagEditor();

    // ── Skill Tag Autocomplete ──
    if (this.item.type === 'skill') this._bindSkillTagAutocomplete();

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

    // --- Augment item: Add / Delete item bonus rows ---
    this.element.querySelector('.item-bonus-add')?.addEventListener('click', async () => {
      const bonuses = [...(this.item.system.itemBonuses ?? []), { field: 'armorBonus', value: 0, mode: 'percentage' }];
      await this.document.update({ 'system.itemBonuses': bonuses });
    });

    this.element.querySelectorAll('.item-bonus-delete').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = Number(el.dataset.index);
        const bonuses = [...(this.item.system.itemBonuses ?? [])];
        bonuses.splice(idx, 1);
        await this.document.update({ 'system.itemBonuses': bonuses });
      });
    });

    // --- Augment drop zone + remove buttons (equipment items) ---
    if (this.item.type === 'item') {
      const augSection = this.element.querySelector('.augment-section');
      if (augSection) {
        augSection.addEventListener('dragover', ev => {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'copy';
        });
        augSection.addEventListener('drop', this._onDrop.bind(this));
      }
      this.element.querySelectorAll('.augment-remove').forEach(el => {
        el.addEventListener('click', async (ev) => {
          const idx = Number(ev.currentTarget.dataset.index);
          const augments = [...(this.item.system.augments ?? [])];
          if (idx >= 0 && idx < augments.length) {
            augments[idx] = { augmentId: '' };
            await this.item.update({ 'system.augments': augments });
          }
        });
      });
    }

    // --- Consumable: Add / Delete buff entries ---
    this.element.querySelector('.consumable-buff-add')?.addEventListener('click', async () => {
      const entries = [...(this.item.system.buff?.entries ?? []), { attribute: 'abilities.strength', value: 0 }];
      await this.document.update({ 'system.buff.entries': entries });
    });

    this.element.querySelectorAll('.consumable-buff-delete').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = Number(el.dataset.index);
        const entries = [...(this.item.system.buff?.entries ?? [])];
        entries.splice(idx, 1);
        await this.document.update({ 'system.buff.entries': entries });
      });
    });

    this.element.querySelectorAll('.consumable-buff-attr, .consumable-buff-value').forEach(el => {
      el.addEventListener('change', async () => {
        const form = this.element.querySelector('form');
        const entries = [];
        form.querySelectorAll('.consumable-buff-list .stat-bonus-row').forEach(row => {
          const attr = row.querySelector('.consumable-buff-attr')?.value ?? 'abilities.strength';
          const val = Number(row.querySelector('.consumable-buff-value')?.value) || 0;
          entries.push({ attribute: attr, value: val });
        });
        await this.document.update({ 'system.buff.entries': entries });
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

  /* -------------------------------------------- */

  /**
   * Handle drop events on the item sheet.
   * Intercepts augment item drops onto equipment item sheets.
   * @param {DragEvent} event
   */
  async _onDrop(event) {
    if (this.item.type !== 'item') return;

    let data;
    try {
      data = JSON.parse(event.dataTransfer?.getData('text/plain') ?? '{}');
    } catch { return; }
    if (data?.type !== 'Item') return;

    const droppedItem = await Item.implementation.fromDropData(data);
    if (!droppedItem || droppedItem.type !== 'augment') return;

    await this._slotAugment(droppedItem, event);
  }

  /**
   * Slot an augment item into this equipment item.
   * If the augment is from a compendium or another source, creates a copy on
   * the owning actor first.
   * @param {Item} augmentItem  The augment item to slot.
   * @param {DragEvent} event   The drop event (used to determine target slot).
   */
  async _slotAugment(augmentItem, event) {
    const actor = this.item.actor;
    if (!actor) {
      ui.notifications.warn('Equipment must be owned by an actor to slot augments.');
      return;
    }

    const slots = this.item.system.augmentSlots ?? 0;
    const existing = this.item.system.augments ?? [];

    // Determine target slot index from drop target element.
    const slotEl = event.target.closest('.augment-slot');
    let targetIdx = slotEl ? Number(slotEl.dataset.index) : -1;

    // If no specific slot targeted, find the first empty slot.
    if (targetIdx < 0 || targetIdx >= slots) {
      targetIdx = -1;
      for (let i = 0; i < slots; i++) {
        if (!existing[i]?.augmentId) { targetIdx = i; break; }
      }
    } else if (existing[targetIdx]?.augmentId) {
      ui.notifications.warn('This augment slot is already filled. Remove the existing augment first.');
      return;
    }

    if (targetIdx < 0) {
      ui.notifications.warn('No empty augment slots available.');
      return;
    }

    // If the augment is not already owned by this actor, create a copy.
    let ownedAugment;
    if (augmentItem.parent?.id === actor.id) {
      ownedAugment = augmentItem;
    } else {
      const created = await actor.createEmbeddedDocuments('Item', [augmentItem.toObject()]);
      ownedAugment = created[0];
    }

    // Check if this augment is already slotted in any equipment on this actor.
    for (const otherItem of actor.items) {
      if (otherItem.type !== 'item') continue;
      const otherAugs = otherItem.system.augments ?? [];
      if (otherAugs.some(a => a.augmentId === ownedAugment.id)) {
        ui.notifications.warn(`${ownedAugment.name} is already slotted in ${otherItem.name}.`);
        return;
      }
    }

    // Build updated augments array.
    const newAugments = [];
    for (let i = 0; i < slots; i++) {
      if (i === targetIdx) {
        newAugments.push({ augmentId: ownedAugment.id });
      } else {
        newAugments.push(existing[i] ?? { augmentId: '' });
      }
    }

    await this.item.update({ 'system.augments': newAugments });
    ui.notifications.info(`Slotted ${ownedAugment.name} into ${this.item.name}.`);
  }

  /**
   * Bind the skill tag autocomplete input.
   */
  _bindSkillTagAutocomplete() {
    const container = this.element.querySelector('.skill-tag-autocomplete');
    if (!container) return;

    const input = container.querySelector('.skill-tag-input');
    const suggestions = container.querySelector('.skill-tag-suggestions');
    if (!input || !suggestions) return;

    // Build available tags based on skill category.
    const category = this.item.system.skillCategory;
    const tagSource = category === 'profession'
      ? CONFIG.ASPECTSOFPOWER.professionTags
      : CONFIG.ASPECTSOFPOWER.combatTags;
    const allTags = Object.entries(tagSource).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
    }));

    const currentTags = () => this.item.system.tags ?? [];

    // Filter and render suggestions.
    const updateSuggestions = () => {
      const query = input.value.trim().toLowerCase();
      suggestions.innerHTML = '';
      if (!query) { suggestions.classList.remove('open'); return; }

      const existing = new Set(currentTags());
      const matches = allTags.filter(t =>
        !existing.has(t.key) && t.label.toLowerCase().includes(query)
      );

      if (!matches.length) { suggestions.classList.remove('open'); return; }

      for (const tag of matches) {
        const li = document.createElement('li');
        li.textContent = tag.label;
        li.dataset.tag = tag.key;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault(); // prevent blur
          this._addSkillTag(tag.key);
          input.value = '';
          suggestions.classList.remove('open');
        });
        suggestions.appendChild(li);
      }
      suggestions.classList.add('open');
    };

    input.addEventListener('input', updateSuggestions);
    input.addEventListener('focus', updateSuggestions);
    input.addEventListener('blur', () => {
      // Small delay so mousedown on suggestion fires first.
      setTimeout(() => suggestions.classList.remove('open'), 150);
    });

    // Keyboard navigation.
    input.addEventListener('keydown', (e) => {
      const items = suggestions.querySelectorAll('li');
      const active = suggestions.querySelector('li.active');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = active ? active.nextElementSibling : items[0];
        if (active) active.classList.remove('active');
        if (next) next.classList.add('active');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = active?.previousElementSibling;
        if (active) active.classList.remove('active');
        if (prev) prev.classList.add('active');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active) {
          this._addSkillTag(active.dataset.tag);
          input.value = '';
          suggestions.classList.remove('open');
        }
      } else if (e.key === 'Escape') {
        suggestions.classList.remove('open');
      }
    });

    // Remove tag chips.
    this.element.querySelectorAll('.skill-tag-remove').forEach(el => {
      el.addEventListener('click', () => this._removeSkillTag(el.dataset.tag));
    });
  }

  async _addSkillTag(tagKey) {
    const existing = [...(this.item.system.tags ?? [])];
    if (existing.includes(tagKey)) return;
    existing.push(tagKey);

    const updateData = { 'system.tags': existing };

    // Debuff subtype auto-adds the 'debuff' parent tag and sets debuff type.
    const debuffSubtypes = CONFIG.ASPECTSOFPOWER.debuffSubtypeTags ?? {};
    if (debuffSubtypes[tagKey]) {
      if (!existing.includes('debuff')) existing.push('debuff');
      updateData['system.tagConfig.debuffType'] = debuffSubtypes[tagKey];
    }

    // AOE tag auto-enables the AOE section.
    if (tagKey === 'aoe') {
      updateData['system.aoe.enabled'] = true;
    }

    // Affinity tag auto-adds to the affinities array.
    const affinityTags = CONFIG.ASPECTSOFPOWER.affinityTags ?? new Set();
    if (affinityTags.has(tagKey)) {
      const affinities = [...(this.item.system.affinities ?? [])];
      if (!affinities.includes(tagKey)) {
        affinities.push(tagKey);
        updateData['system.affinities'] = affinities;
      }
    }

    await this.document.update(updateData);
  }

  async _removeSkillTag(tagKey) {
    let filtered = (this.item.system.tags ?? []).filter(t => t !== tagKey);
    const updateData = { 'system.tags': filtered };

    // If removing aoe tag, disable AOE.
    if (tagKey === 'aoe') {
      updateData['system.aoe.enabled'] = false;
    }

    // If removing a debuff subtype, clear debuff type. If no subtypes remain, remove 'debuff' parent.
    const debuffSubtypes = CONFIG.ASPECTSOFPOWER.debuffSubtypeTags ?? {};
    if (debuffSubtypes[tagKey]) {
      updateData['system.tagConfig.debuffType'] = 'none';
      const hasOtherSubtype = filtered.some(t => debuffSubtypes[t]);
      if (!hasOtherSubtype) {
        filtered = filtered.filter(t => t !== 'debuff');
        updateData['system.tags'] = filtered;
      }
    }

    // If removing 'debuff' directly, also remove all subtype tags.
    if (tagKey === 'debuff') {
      filtered = filtered.filter(t => !debuffSubtypes[t]);
      updateData['system.tags'] = filtered;
      updateData['system.tagConfig.debuffType'] = 'none';
    }

    // Affinity tag removal — remove from affinities array.
    const affinityTags = CONFIG.ASPECTSOFPOWER.affinityTags ?? new Set();
    if (affinityTags.has(tagKey)) {
      const affinities = (this.item.system.affinities ?? []).filter(a => a !== tagKey);
      updateData['system.affinities'] = affinities;
    }

    await this.document.update(updateData);
  }

  /**
   * Bind event listeners for the tag editor partial.
   */
  _bindTagEditor() {
    const editor = this.element.querySelector('.tag-editor');
    if (!editor) return;

    const categoryFilter = editor.querySelector('.tag-category-filter');
    const tagSelect = editor.querySelector('.tag-select');
    const valueInput = editor.querySelector('.tag-value-input');

    // Filter tag dropdown by category.
    categoryFilter?.addEventListener('change', () => {
      const cat = categoryFilter.value;
      for (const opt of tagSelect.options) {
        if (!opt.value) continue; // skip placeholder
        opt.hidden = cat && opt.dataset.category !== cat;
      }
      tagSelect.value = '';
    });

    // Show/hide value input based on selected tag's category.
    tagSelect?.addEventListener('change', () => {
      const tagId = tagSelect.value;
      const def = CONFIG.ASPECTSOFPOWER.tagRegistry?.[tagId];
      valueInput.style.display = def?.category === 'resistance' ? '' : 'none';
    });
    // Initialize visibility.
    valueInput.style.display = 'none';

    // Add tag.
    editor.querySelector('.tag-add-btn')?.addEventListener('click', async () => {
      const tagId = tagSelect.value;
      if (!tagId) return;
      const value = Number(valueInput.value) || 0;
      const existing = foundry.utils.deepClone(this.item._source.system.systemTags ?? []);
      // Don't add duplicates.
      if (existing.some(t => t.id === tagId)) {
        ui.notifications.warn('Tag already assigned.');
        return;
      }
      // Enforce one-per-category for exclusive categories (e.g. size).
      const tagDef = CONFIG.ASPECTSOFPOWER.tagRegistry?.[tagId];
      const exclusiveCategories = new Set(['size']);
      if (tagDef && exclusiveCategories.has(tagDef.category)) {
        const filtered = existing.filter(t => {
          const def = CONFIG.ASPECTSOFPOWER.tagRegistry?.[t.id];
          return !def || def.category !== tagDef.category;
        });
        await this.item.update({ 'system.systemTags': [...filtered, { id: tagId, value }] });
        return;
      }
      await this.item.update({ 'system.systemTags': [...existing, { id: tagId, value }] });
    });

    // Remove tag.
    editor.querySelectorAll('.tag-remove').forEach(el => {
      el.addEventListener('click', async () => {
        const tagId = el.closest('.tag-chip')?.dataset.tagId;
        if (!tagId) return;
        const existing = foundry.utils.deepClone(this.item._source.system.systemTags ?? []);
        await this.item.update({ 'system.systemTags': existing.filter(t => t.id !== tagId) });
      });
    });
  }
}
