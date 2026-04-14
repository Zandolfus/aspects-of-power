import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { EquipmentSystem } from '../systems/equipment.mjs';
import { LevelUpDialog } from '../apps/level-up-dialog.mjs';

/**
 * Extend ActorSheetV2 with Aspects of Power-specific behaviour.
 * @extends {foundry.applications.sheets.ActorSheetV2}
 */
export class AspectsofPowerActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {

  static DEFAULT_OPTIONS = {
    classes: ['aspects-of-power', 'sheet', 'actor'],
    position: { width: 800, height: 800 },
    window: { resizable: true },
    form: { submitOnChange: true },
    tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'features' }],
  };

  // Each actor type maps to its own template file.
  static PARTS = {
    character: { template: 'systems/aspects-of-power/templates/actor/actor-character-sheet.hbs', scrollable: ['.sheet-body'] },
    npc:       { template: 'systems/aspects-of-power/templates/actor/actor-npc-sheet.hbs', scrollable: ['.sheet-body'] },
  };

  /** Render only the part that matches this actor's type. */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    options.parts = [this.actor.type];
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actorData = this.document.toObject(false);

    context.actor    = this.actor;
    context.system   = this.actor.system; // live instance preserves derived fields (e.g. ability.mod)
    context.flags    = actorData.flags;
    context.editable = this.isEditable;
    context.cssClass = this.isEditable ? 'editable' : 'locked';
    context.config = CONFIG.ASPECTSOFPOWER;
    context.items  = this.actor.items.map(i => i.toObject(false));

    if (actorData.type === 'character') {
      this._prepareItems(context);
      await this._prepareCharacterData(context);
    }
    if (actorData.type === 'npc') {
      this._prepareItems(context);
    }

    context.enrichedBiography = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.actor.system.biography,
      {
        secrets:    this.document.isOwner,
        rollData:   this.actor.getRollData(),
        relativeTo: this.actor,
      }
    );
    context.rollData = this.actor.getRollData();
    context.effects  = prepareActiveEffectCategories(
      this.actor.allApplicableEffects()
    );

    // Prepare debuff data for dedicated display.
    context.debuffs = this._prepareDebuffs();

    return context;
  }

  /**
   * Character-specific context modifications.
   * @param {object} context The context object to mutate
   */
  async _prepareCharacterData(context) {
    context.statsSummary = context.system.statsSummary;

    // Levelling: template references (resolved from stored UUID).
    const types = ['race', 'class', 'profession'];
    context.templateRefs = {};
    for (const type of types) {
      const attr = context.system.attributes?.[type];
      let templateItem = null;
      if (attr?.templateId) {
        try { templateItem = await fromUuid(attr.templateId); }
        catch (e) { console.warn(`AoP | Failed to resolve ${type} template UUID:`, attr.templateId, e); }
      }
      context.templateRefs[type] = {
        templateId: attr?.templateId ?? '',
        templateName: templateItem?.name ?? '',
        hasTemplate: !!templateItem,
      };
    }
    context.freePoints = context.system.freePoints ?? 0;
    context.isGM = game.user.isGM;
  }

  /**
   * Organise and classify Items for the Actor sheet.
   * @param {object} context The context object to mutate
   */
  _prepareItems(context) {
    const gear           = [];
    const consumables    = [];
    const features       = [];
    const skills         = { Active: [], Reaction: [], Passive: [] };

    for (const i of context.items) {
      i.img = i.img || Item.DEFAULT_ICON;
      if (i.type === 'item') {
        // Add rarity color and durability percent for templates.
        const rarityDef = CONFIG.ASPECTSOFPOWER.rarities[i.system.rarity];
        i.rarityColor = rarityDef?.color ?? '#ffffff';
        const dur = i.system.durability;
        i.durabilityPercent = dur?.max > 0 ? Math.round((dur.value / dur.max) * 100) : 100;
        gear.push(i);
      } else if (i.type === 'consumable') {
        const rarityDef = CONFIG.ASPECTSOFPOWER.rarities[i.system.rarity];
        i.rarityColor = rarityDef?.color ?? '#ffffff';
        i.consumableLabel = game.i18n.localize(
          CONFIG.ASPECTSOFPOWER.consumableTypes[i.system.consumableType] ?? 'ASPECTSOFPOWER.Consumable.other'
        );
        i.effectSummary = this._buildConsumableEffectSummary(i);
        // Total uses: charges × quantity for multi-charge, just quantity for single-use.
        const ch = i.system.charges;
        i.usesDisplay = ch.max > 1
          ? `${ch.value}/${ch.max} (×${i.system.quantity})`
          : `${i.system.quantity}`;
        consumables.push(i);
      } else if (i.type === 'feature') {
        features.push(i);
      } else if (i.type === 'skill') {
        const skillRarityDef = CONFIG.ASPECTSOFPOWER.rarities[i.system.rarity];
        i.rarityColor = skillRarityDef?.color ?? '#ffffff';
        if (i.system.skillType !== undefined) {
          skills[i.system.skillType].push(i);
        }
      }
    }

    context.gear           = gear;
    context.consumables    = consumables;
    context.features       = features;
    context.skills         = skills;

    // Equipment slot summary for the Equipment tab.
    context.equipmentSlots = {};
    for (const [slotKey, slotDef] of Object.entries(CONFIG.ASPECTSOFPOWER.equipmentSlots)) {
      context.equipmentSlots[slotKey] = {
        label: game.i18n.localize(slotDef.label),
        max: slotDef.max,
        items: [],
      };
    }
    context.unequippedGear = [];

    for (const i of gear) {
      if (i.system.equipped && i.system.slot && context.equipmentSlots[i.system.slot]) {
        context.equipmentSlots[i.system.slot].items.push(i);
      } else {
        context.unequippedGear.push(i);
      }
    }

    // Carry bar percentage (clamped to 100 for display).
    const cap = context.system.carryCapacity || 1;
    context.carryPercent = Math.min(100, Math.round((context.system.carryWeight / cap) * 100));
  }

  /**
   * Build a human-readable effect summary for a consumable item.
   * @param {object} i  The plain item data object.
   * @returns {string}  e.g. "Restoration (Health +50)" or "Buff (STR +10, 3 rds)"
   */
  _buildConsumableEffectSummary(i) {
    const sys = i.system;
    const effectLabel = game.i18n.localize(
      CONFIG.ASPECTSOFPOWER.consumableEffectTypes[sys.effectType] ?? 'ASPECTSOFPOWER.ConsumableEffect.none'
    );

    switch (sys.effectType) {
      case 'restoration': {
        const resLabel = game.i18n.localize(
          CONFIG.ASPECTSOFPOWER.restorationResources[sys.restoration.resource] ?? 'Health'
        );
        return `${effectLabel} (${resLabel} +${sys.restoration.amount})`;
      }
      case 'buff': {
        const parts = (sys.buff.entries ?? []).map(e => {
          const attrKey = e.attribute?.split('.').pop() ?? '?';
          const abbr = game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilityAbbreviations[attrKey] ?? attrKey).toUpperCase();
          const sign = e.value >= 0 ? '+' : '';
          return `${abbr} ${sign}${e.value}`;
        });
        const dur = sys.buff.duration ? `, ${sys.buff.duration} rds` : '';
        return `${effectLabel} (${parts.join(', ')}${dur})`;
      }
      case 'poison': {
        return `${effectLabel} (${sys.poison.damage} ${sys.poison.damageType}, ${sys.poison.duration} atks)`;
      }
      case 'bomb': {
        return `${effectLabel} (${sys.bomb.damage} ${sys.bomb.damageType}, ${sys.bomb.diameter}ft)`;
      }
      case 'repairKit': {
        return `${effectLabel} (+${sys.repairAmount} durability)`;
      }
      default:
        return effectLabel;
    }
  }

  /* -------------------------------------------- */

  /**
   * Intercept form changes so that numeric fields are rounded and saved
   * immediately via a targeted document.update() call, bypassing the
   * full-form submit that can drop changes on fast re-renders.
   * @override
   */
  async _onChangeForm(formConfig, event) {
    const input = event.target;
    if (!input?.name) return super._onChangeForm(formConfig, event);

    if (input.name === 'name') {
      await this.document.update({ name: input.value.trim() || this.document.name });
      return;
    }

    if (input.type === 'number') {
      const raw = Number(input.value);
      if (!isNaN(raw) && isFinite(raw)) {
        await this.document.update({ [input.name]: Math.round(raw) });
        return;
      }
    }

    return super._onChangeForm(formConfig, event);
  }

  /* -------------------------------------------- */

  /** @override – save scroll position before DOM replacement. */
  _preRender(context, options) {
    this._savedScrollTop = this.element?.querySelector('.sheet-body')?.scrollTop ?? 0;
    return super._preRender(context, options);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // AppV2 stores DEFAULT_OPTIONS.tabs config but never instantiates the Tabs
    // widget — bind it manually on every render (PART HTML is replaced each time).
    // Restore the last active tab from tabGroups so submitOnChange re-renders
    // don't reset the user back to the default tab.
    const defaultTab = this.actor.type === 'npc' ? 'description' : 'features';
    const initial = this.tabGroups.primary ?? defaultTab;
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

    // Item sheet open — available regardless of edit state.
    this.element.querySelectorAll('.item-edit').forEach(el => {
      el.addEventListener('click', ev => {
        const li   = ev.currentTarget.closest('.item');
        const item = this.actor.items.get(li.dataset.itemId);
        item.sheet.render(true);
      });
    });

    // Everything below requires the sheet to be editable.
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

    // Add Inventory Item
    this.element.querySelectorAll('.item-create').forEach(el => {
      el.addEventListener('click', this._onItemCreate.bind(this));
    });

    // Delete Inventory Item
    this.element.querySelectorAll('.item-delete').forEach(el => {
      el.addEventListener('click', ev => {
        const li   = ev.currentTarget.closest('.item');
        const item = this.actor.items.get(li.dataset.itemId);
        item.delete();
        li.remove();
      });
    });

    // Active Effect management
    this.element.querySelectorAll('.effect-control').forEach(el => {
      el.addEventListener('click', ev => {
        const row = ev.currentTarget.closest('li') ?? ev.currentTarget.closest('.debuff-card');
        if (!row) return;
        const document = row.dataset.parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(row.dataset.parentId);
        onManageActiveEffect(ev, document);
      });
    });

    // Wounded token image picker.
    this.element.querySelector('.wounded-img')?.addEventListener('click', async () => {
      const current = this.actor.system.tokenImageWounded || '';
      const FP = foundry.applications.apps.FilePicker.implementation;
      const fp = new FP({ type: 'image', current, callback: async (path) => {
        await this.actor.update({ 'system.tokenImageWounded': path });
      }});
      fp.browse();
    });

    // Clear overhealth button.
    this.element.querySelector('.clear-overhealth')?.addEventListener('click', async () => {
      await this.actor.update({ 'system.overhealth.value': 0 });
    });

    // Clear barrier button.
    this.element.querySelector('.clear-barrier')?.addEventListener('click', async () => {
      await this.actor.update({ 'system.barrier.value': 0, 'system.barrier.max': 0 });
      // Also delete the barrier ActiveEffect.
      const barrierEffect = this.actor.effects.find(e =>
        !e.disabled && e.system?.effectType === 'barrier'
      );
      if (barrierEffect) await barrierEffect.delete();
    });

    // Progress roll button.
    this.element.querySelector('.progress-roll-btn')?.addEventListener('click', async () => {
      await this._onProgressRoll();
    });

    // Break Free buttons on debuff cards.
    this.element.querySelectorAll('.break-free-btn').forEach(el => {
      el.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const effectId = el.dataset.effectId;
        const effect = this.actor.effects.get(effectId);
        if (!effect) return;
        await this._onBreakFree(effect);
      });
    });

    // Rollable abilities
    this.element.querySelectorAll('.rollable').forEach(el => {
      el.addEventListener('click', this._onRoll.bind(this));
    });

    // Use consumable
    this.element.querySelectorAll('.consumable-use').forEach(el => {
      el.addEventListener('click', async ev => {
        const itemId = ev.currentTarget.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== 'consumable') return;
        await item.useConsumable();
      });
    });

    // Equip / Unequip toggle
    this.element.querySelectorAll('.equip-toggle').forEach(el => {
      el.addEventListener('click', async ev => {
        const itemId = ev.currentTarget.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        if (item.system.equipped) {
          await EquipmentSystem.unequip(item);
        } else {
          await EquipmentSystem.equip(item);
        }
      });
    });

    // Repair item
    this.element.querySelectorAll('.repair-item').forEach(el => {
      el.addEventListener('click', async ev => {
        const itemId = ev.currentTarget.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        const kit = this.actor.items.find(i => i.type === 'consumable' && i.system.effectType === 'repairKit' && i.system.quantity > 0);
        if (!kit) {
          ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.Equip.noRepairKits'));
          return;
        }
        await EquipmentSystem.repair(item, kit);
      });
    });

    // Level Up button — opens the level-up dialog (all players).
    this.element.querySelector('.level-up-btn')?.addEventListener('click', () => {
      new LevelUpDialog(this.actor).render(true);
    });

    // Template link — click to open the source template item sheet.
    this.element.querySelectorAll('.template-link').forEach(el => {
      el.addEventListener('click', async () => {
        const uuid = el.dataset.templateId;
        let item;
        try { item = await fromUuid(uuid); } catch (e) { /* invalid UUID */ }
        if (!item) return;
        try {
          item.sheet.render(true);
        } catch (e) {
          ui.notifications.warn('You do not have permission to view this item.');
        }
      });
    });

    // Clear template assignment (GM only).
    this.element.querySelectorAll('.template-clear').forEach(el => {
      el.addEventListener('click', async () => {
        const type = el.dataset.type;
        await this.actor.update({
          [`system.attributes.${type}.templateId`]: '',
          [`system.attributes.${type}.name`]: '',
          [`system.attributes.${type}.cachedTags`]: [],
        });
      });
    });

    // Drag events for macros
    if (this.actor.isOwner) {
      this.element.querySelectorAll('li.item').forEach(li => {
        if (li.classList.contains('inventory-header')) return;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', ev => {
          const itemId = li.dataset.itemId;
          const item   = this.actor.items.get(itemId);
          if (!item) return;
          ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'Item', uuid: item.uuid }));
        }, false);
      });
    }
  }


  /**
   * Handle creating a new Owned Item for the actor.
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    const type   = header.dataset.type;
    const data   = { ...header.dataset };
    const name   = `New ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    const itemData = {
      name,
      type,
      system: data,
    };
    delete itemData.system['type'];
    return Item.create(itemData, { parent: this.actor });
  }

  /**
   * Intercept item drops to handle race/class/profession template assignment.
   * Dropping one of these item types assigns it as the actor's template
   * instead of adding it to the inventory. GM-only.
   * @override
   */
  async _onDropItem(event, data) {
    const item = await Item.implementation.fromDropData(data);
    if (!item) return;

    if (['race', 'class', 'profession'].includes(item.type)) {
      if (!game.user.isGM) {
        ui.notifications.warn('Only the GM can assign templates.');
        return;
      }
      const type = item.type;
      const updateData = {
        [`system.attributes.${type}.templateId`]: item.uuid,
        [`system.attributes.${type}.name`]: item.name,
        [`system.attributes.${type}.cachedTags`]: item.system.systemTags ?? [],
      };
      // For unlinked tokens, update the world actor so data persists.
      const targetActor = this.actor.isToken
        ? game.actors.get(this.actor.id) ?? this.actor
        : this.actor;
      await targetActor.update(updateData);
      const typeLabel = game.i18n.localize(CONFIG.ASPECTSOFPOWER.levelTypes[type]);
      ui.notifications.info(`${this.actor.name}: ${typeLabel} ${game.i18n.localize('ASPECTSOFPOWER.Level.templateAssigned')} ${item.name}`);
      return;
    }

    return super._onDropItem(event, data);
  }

  /**
   * Open a dialog to select an ability, then roll a progress check.
   * Formula: ability check ((d20/100) * mod + mod) modified by a d100 percentage.
   * Natural 100 on d100 = critical success. Natural 1 = critical failure.
   */
  async _onProgressRoll() {
    const actor = this.actor;
    const abilities = CONFIG.ASPECTSOFPOWER.abilities;

    // Build ability options.
    const abilityOptions = Object.entries(abilities)
      .map(([key, label]) => `<option value="${key}">${game.i18n.localize(label)}</option>`)
      .join('');

    const content = `<form>
      <div class="form-group">
        <label>Ability</label>
        <select name="ability">${abilityOptions}</select>
      </div>
    </form>`;

    await foundry.applications.api.DialogV2.wait({
      window: { title: `Progress Roll — ${actor.name}` },
      content,
      buttons: [{
        action: 'roll', label: 'Roll', icon: 'fas fa-dice-d20', default: true,
        callback: async (event, button) => {
          const form = button.closest('.dialog-v2')?.querySelector('form') ?? button.form;
          const abilityKey = form.querySelector('[name="ability"]').value;
          const abilityLabel = game.i18n.localize(abilities[abilityKey] ?? abilityKey);
          const mod = actor.system.abilities?.[abilityKey]?.mod ?? 0;

          // Roll the ability check.
          const abilityRoll = new Roll('(1d20 / 100) * @mod + @mod', { mod });
          await abilityRoll.evaluate();
          const abilityResult = Math.round(abilityRoll.total);

          // Roll the d100 variance.
          const d100Roll = new Roll('1d100');
          await d100Roll.evaluate();
          const d100 = d100Roll.total;

          // Apply d100 as a percentage modifier.
          const finalResult = Math.round(abilityResult * (d100 / 100));

          // Determine special outcomes.
          const isNatSuccess = d100 === 100;
          const isNatFailure = d100 === 1;

          let flavor, cssClass;
          if (isNatSuccess) {
            flavor = `<strong>${actor.name}</strong> attempts progress with <strong>${abilityLabel}</strong>... `
                   + `<span style="color:#ffca28;font-size:1.2em;">&#9733; Natural Success! &#9733;</span>`;
            cssClass = 'progress-nat-success';
          } else if (isNatFailure) {
            flavor = `<strong>${actor.name}</strong> attempts progress with <strong>${abilityLabel}</strong>... `
                   + `<span style="color:#ef5350;font-size:1.2em;">&#10008; Natural Failure! &#10008;</span>`;
            cssClass = 'progress-nat-failure';
          } else {
            flavor = `<strong>${actor.name}</strong> attempts progress with <strong>${abilityLabel}</strong>.`;
            cssClass = '';
          }

          const speaker = ChatMessage.getSpeaker({ actor });
          ChatMessage.create({
            speaker,
            content: `<div class="progress-roll-result ${cssClass}">
              ${flavor}
              <div class="progress-roll-details">
                <span>${abilityLabel} Check: <strong>${abilityResult}</strong></span>
                <span>Variance (d100): <strong>${d100}%</strong></span>
                <span class="progress-final">Final Result: <strong>${finalResult}</strong></span>
              </div>
            </div>`,
          });
        },
      }, { action: 'cancel', label: 'Cancel' }],
      close: () => null,
    });
  }

  /**
   * Attempt to break free from a debuff by spending a combat action.
   * Uses the same ability check formula as turn-start break rolls.
   * @param {ActiveEffect} effect  The debuff effect to break from.
   */
  async _onBreakFree(effect) {
    const actor = this.actor;
    const sys = effect.system;
    const debuffType = sys.debuffType;
    const rollTotal = sys.debuffDamage ?? 0;
    const typeName = game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffType] ?? debuffType);

    // Must be in combat to spend an action.
    const combat = game.combat;
    if (!combat?.started) {
      ui.notifications.warn('Must be in active combat to attempt breaking free.');
      return;
    }

    // Consume an action.
    const actionResult = game.aspectsofpower?.consumeAction?.(actor);
    if (actionResult === null) {
      ui.notifications.warn('No combatant found for this actor.');
      return;
    }
    if (actionResult > 3) {
      ui.notifications.warn('No actions remaining this turn!');
      return;
    }

    // Determine break stat.
    const BREAK_STATS = {
      root: 'strength', paralysis: 'vitality', fear: 'willpower',
      taunt: 'intelligence', charm: 'willpower', enraged: 'wisdom',
    };
    const breakStat = BREAK_STATS[debuffType];
    if (!breakStat) {
      ui.notifications.warn(`${typeName} cannot be broken through force of will.`);
      return;
    }

    const statMod = actor.system.abilities?.[breakStat]?.mod ?? 0;
    const breakLabel = game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[breakStat] ?? breakStat);
    const breakThreshold = rollTotal;

    // Roll the break check.
    const breakRoll = new Roll('(1d20 / 100) * @mod + @mod', { mod: statMod });
    await breakRoll.evaluate();

    const previousProgress = sys.breakProgress ?? 0;
    const newProgress = previousProgress + breakRoll.total;
    const speaker = ChatMessage.getSpeaker({ actor });

    if (newProgress >= breakThreshold) {
      // Broke free!
      await effect.delete();
      await breakRoll.toMessage({
        speaker,
        flavor: `<strong>${actor.name}</strong> strains against the ${typeName}... <em>and breaks free!</em> `
              + `(${breakLabel}: ${Math.round(newProgress)} / ${breakThreshold})`,
      });
      ChatMessage.create({
        speaker,
        content: `<p><strong>${actor.name}</strong> shatters the hold of <strong>${typeName}</strong>! `
               + `<em>Action ${actionResult}/3 spent.</em></p>`,
      });
    } else {
      // Failed — save progress.
      await effect.update({ 'system.breakProgress': newProgress });
      await breakRoll.toMessage({
        speaker,
        flavor: `<strong>${actor.name}</strong> struggles against the ${typeName}... <em>but it holds firm.</em> `
              + `(${breakLabel}: ${Math.round(newProgress)} / ${breakThreshold})`,
      });
      ChatMessage.create({
        speaker,
        content: `<p><strong>${actor.name}</strong> fails to break free of <strong>${typeName}</strong>. `
               + `Progress: ${Math.round(newProgress)} / ${breakThreshold}. `
               + `<em>Action ${actionResult}/3 spent.</em></p>`,
      });
    }
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    if (dataset.rollType === 'item') {
      const itemId = element.closest('.item').dataset.itemId;
      const item   = this.actor.items.get(itemId);
      if (item) return item.roll();
    }

    if (dataset.roll) {
      const label = dataset.label ? `[ability] ${dataset.label}` : '';
      const roll  = new Roll(dataset.roll, this.actor.getRollData());
      roll.toMessage({
        speaker:  ChatMessage.getSpeaker({ actor: this.actor }),
        flavor:   label,
        rollMode: game.settings.get('core', 'messageMode'),
      });
      return roll;
    }
  }

  /**
   * Prepare debuff effect data for the dedicated debuffs display.
   * Extracts combat-relevant info from ActiveEffects with debuff flags.
   * @returns {object[]}
   */
  _prepareDebuffs() {
    const breakStats = {
      root: 'strength', paralysis: 'vitality', fear: 'willpower',
      taunt: 'intelligence', charm: 'willpower', enraged: 'wisdom',
    };

    const debuffs = [];
    for (const effect of this.actor.effects) {
      if (effect.disabled) continue;
      const sys = effect.system;
      if (!sys?.debuffType || sys.debuffType === 'none') continue;

      const debuffType = sys.debuffType;
      const rollTotal = sys.debuffDamage ?? 0;
      const breakStat = breakStats[debuffType] ?? null;
      let breakThreshold = rollTotal;
      let breakStatLabel = breakStat
        ? game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[breakStat] ?? breakStat)
        : null;

      // Slip: show both break paths.
      if (debuffType === 'slip') {
        breakStatLabel = `Dex or Str×1.5`;
      }

      // Stat changes summary.
      const changes = effect.changes ?? [];
      const statChanges = changes.filter(c => c.key.startsWith('system.abilities.'));
      const statSummary = statChanges.map(c => {
        const attr = c.key.replace('system.abilities.', '').replace('.value', '');
        const label = game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[attr] ?? attr);
        return `${label} ${c.value > 0 ? '+' : ''}${c.value}`;
      }).join(', ');

      // Duration label.
      const dur = effect.duration;
      let duration = '';
      if (dur?.rounds > 0) {
        const remaining = Math.max(0, (dur.startRound ?? 0) + dur.rounds - (game.combat?.round ?? 0));
        duration = `${remaining} rnd${remaining !== 1 ? 's' : ''} left`;
      }

      debuffs.push({
        id: effect.id,
        parent: effect.parent,
        name: effect.name,
        img: effect.img,
        typeLabel: game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffType] ?? debuffType),
        rollTotal,
        breakStat,
        breakStatLabel,
        breakProgress: sys.breakProgress ?? 0,
        breakThreshold,
        dot: sys.dot ?? false,
        dotDamage: sys.dotDamage ?? 0,
        dotType: sys.dotDamageType ?? 'physical',
        duration,
        statChanges,
        statSummary,
      });
    }
    return debuffs;
  }
}
