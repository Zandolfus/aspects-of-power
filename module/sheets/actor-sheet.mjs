import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { EquipmentSystem } from '../systems/equipment.mjs';
import { LevelUpDialog } from '../apps/level-up-dialog.mjs';
import { PlayerRelevelDialog } from '../apps/player-releveler-dialog.mjs';
import { SpendFreePointsDialog } from '../apps/spend-fp-dialog.mjs';

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

  /**
   * Sheet-local state for stat view preview.
   * 'combat' | 'profession' — defaults to the actor's active loadout (resolved in _prepareContext).
   */
  _statsViewMode = null;

  /**
   * Recompute ability breakdowns with equipment effects filtered by gear set.
   * Mirrors the logic in actor.mjs prepareDerivedData but only for the equipment cap step.
   * @param {string} mode  'combat' or 'profession' — which gear set to include.
   * @returns {Object} Map of ability key → breakdown with filtered equipment.
   */
  _computeFilteredAbilities(mode) {
    const actor = this.actor;
    const slotConfig = CONFIG.ASPECTSOFPOWER.equipmentSlots ?? {};

    // Determine which equipped items belong to the chosen set.
    // 'both'-set slots (jewelry) always count regardless of mode.
    const includedItemIds = new Set();
    for (const item of actor.items) {
      if (item.type !== 'item') continue;
      if (!item.system.equipped) continue;
      const allSlots = [item.system.slot, ...(item.system.additionalSlots ?? [])].filter(Boolean);
      const matches = allSlots.some(slotKey => {
        const slotSet = slotConfig[slotKey]?.set;
        return slotSet === 'both' || slotSet === mode;
      });
      if (matches) includedItemIds.add(item.id);
    }

    // Sum equipment stat bonuses from included items only.
    const abilityKeys = Object.keys(actor.system.abilities);
    const equipBonusByStat = {};
    for (const key of abilityKeys) equipBonusByStat[key] = 0;

    for (const item of actor.items) {
      if (!includedItemIds.has(item.id)) continue;
      for (const sb of item.system.statBonuses ?? []) {
        if (equipBonusByStat[sb.ability] !== undefined) {
          equipBonusByStat[sb.ability] += sb.value || 0;
        }
      }
    }

    // Build new breakdowns by replacing equipmentBonusRaw with the filtered total,
    // then re-applying the per-stat and global caps.
    // Mod formula must mirror actor.mjs prepareDerivedData (power curve per
    // design-stat-curves.md). The old sigmoid formula was a leftover from
    // before the 2026-05-01 stat squish and made the Stats tab disagree
    // with the Features tab.
    const sc = CONFIG.ASPECTSOFPOWER.statCurve;
    const _raceRank = actor.system.attributes?.race?.rank ?? 'E';
    const _gradeMult = Math.pow(sc.MULT_BASE, sc.gradeIndex[_raceRank] ?? 0);
    const calcMod = (value) =>
      Math.round(Math.pow(value / sc.NORM, sc.P) * sc.NORM * _gradeMult);

    const filtered = {};
    for (const key of abilityKeys) {
      const orig = actor.system.abilities[key].breakdown;
      filtered[key] = {
        ...orig,
        equipmentBonusRaw: equipBonusByStat[key],
        equipmentCapped: Math.min(equipBonusByStat[key], orig.perStatCap),
      };
    }

    // Apply global cap (20% of total calculated).
    const totalCalculated = abilityKeys.reduce(
      (s, k) => s + filtered[k].calculated, 0
    );
    const globalCap = Math.floor(totalCalculated * 0.20);
    let totalEquip = abilityKeys.reduce((s, k) => s + filtered[k].equipmentCapped, 0);
    if (totalEquip > globalCap && totalEquip > 0) {
      const ratio = globalCap / totalEquip;
      for (const key of abilityKeys) {
        filtered[key].equipmentCapped = Math.floor(filtered[key].equipmentCapped * ratio);
      }
    }

    // Final + finalMod recompute.
    for (const key of abilityKeys) {
      const b = filtered[key];
      b.final = Math.round(b.calculated + b.equipmentCapped + b.effectBonus);
      b.finalMod = calcMod(b.final);
    }

    return filtered;
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

    // Build tooltip strings for defense stats.
    context.tooltips = this._prepareTooltips(context.system);

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

    // Stats view preview — defaults to the actor's active loadout the first time the sheet renders.
    if (this._statsViewMode !== 'combat' && this._statsViewMode !== 'profession') {
      this._statsViewMode = this.actor.system.activeLoadout === 'profession' ? 'profession' : 'combat';
    }
    context.statsViewMode = this._statsViewMode;
    const filtered = this._computeFilteredAbilities(this._statsViewMode);
    const display = {};
    for (const [key, ability] of Object.entries(context.system.abilities)) {
      const fb = filtered[key];
      display[key] = {
        value: fb.final,
        mod: fb.finalMod,
        breakdown: fb,
      };
    }
    context.displayAbilities = display;

    // Defense tab: collect resistances from system tags.
    context.resistances = [];
    const collected = context.system.collectedTags;
    if (collected) {
      for (const [tagId, data] of collected) {
        if (data?.category === 'resistance') {
          const def = CONFIG.ASPECTSOFPOWER.tagRegistry?.[tagId];
          context.resistances.push({
            id: tagId,
            label: def ? game.i18n.localize(def.label) : tagId,
            value: data.value || 0,
          });
        }
      }
    }
    // Defense tab: immunities from tags.
    context.immunities = [];
    if (collected) {
      for (const [tagId, data] of collected) {
        if (data?.category === 'immunity') {
          const def = CONFIG.ASPECTSOFPOWER.tagRegistry?.[tagId];
          context.immunities.push({
            id: tagId,
            label: def ? game.i18n.localize(def.label) : tagId,
          });
        }
      }
    }
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
    const skillGroups    = {
      combat:     { label: 'Combat',     active: [], reactions: [] },
      profession: { label: 'Profession', active: [], reactions: [] },
      passive:    { label: 'Passive',    active: [], reactions: [] },
    };

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
        const skillRarityDef = CONFIG.ASPECTSOFPOWER.skillRarities[i.system.rarity];
        i.rarityColor = skillRarityDef?.color ?? '#ffffff';
        if (i.system.skillType !== undefined) {
          skills[i.system.skillType].push(i);
        }
        const isReaction = i.system.skillType === 'Reaction';
        if (i.system.skillType === 'Passive') {
          skillGroups.passive.active.push(i);
        } else if (i.system.skillCategory === 'profession') {
          (isReaction ? skillGroups.profession.reactions : skillGroups.profession.active).push(i);
        } else {
          (isReaction ? skillGroups.combat.reactions : skillGroups.combat.active).push(i);
        }
      }
    }

    context.gear           = gear;
    context.consumables    = consumables;
    context.features       = features;
    context.skills         = skills;
    context.skillGroups    = skillGroups;

    // Equipment slot summary for the Equipment tab — split combat vs profession vs shared (always-on).
    context.combatSlots = {};
    context.professionSlots = {};
    context.sharedSlots = {};
    for (const [slotKey, slotDef] of Object.entries(CONFIG.ASPECTSOFPOWER.equipmentSlots)) {
      let target;
      if (slotDef.set === 'profession') target = context.professionSlots;
      else if (slotDef.set === 'both')  target = context.sharedSlots;
      else                              target = context.combatSlots;
      target[slotKey] = {
        label: game.i18n.localize(slotDef.label),
        max: slotDef.max,
        items: [],
      };
    }
    // Keep combined for backward compat.
    context.equipmentSlots = { ...context.combatSlots, ...context.professionSlots, ...context.sharedSlots };
    context.unequippedGear = [];

    for (const i of gear) {
      if (i.system.equipped) {
        const allSlots = [i.system.slot, ...(i.system.additionalSlots ?? [])].filter(Boolean);
        const placed = [];
        for (const slotKey of allSlots) {
          if (context.equipmentSlots[slotKey]) {
            context.equipmentSlots[slotKey].items.push(i);
            placed.push(slotKey);
          }
        }
        if (placed.length === 0) context.unequippedGear.push(i);
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

    // Skill favorite toggle — flips system.favorite on the skill.
    this.element.querySelectorAll('.item-fav-toggle').forEach(el => {
      el.addEventListener('click', async ev => {
        ev.stopPropagation();
        const li = ev.currentTarget.closest('.item');
        const item = this.actor.items.get(li.dataset.itemId);
        if (!item || item.type !== 'skill') return;
        await item.update({ 'system.favorite': !item.system.favorite });
      });
    });

    // Trade / Give item button.
    this.element.querySelectorAll('.item-trade').forEach(el => {
      el.addEventListener('click', async ev => {
        const li = ev.currentTarget.closest('.item');
        const item = this.actor.items.get(li.dataset.itemId);
        if (!item) return;
        const { TradingSystem } = await import('../systems/trading.mjs');
        await TradingSystem.openGiveDialog(this.actor, item);
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

    // Gear set toggle (combat / profession).
    this.element.querySelectorAll('.gear-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const set = btn.dataset.set;
        this.element.querySelectorAll('.gear-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.element.querySelector('.gear-set-combat').style.display = set === 'combat' ? '' : 'none';
        this.element.querySelector('.gear-set-profession').style.display = set === 'profession' ? '' : 'none';
      });
    });

    // Stats view preview toggle (combat / profession gear breakdown).
    this.element.querySelectorAll('.stats-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view !== 'combat' && view !== 'profession') return;
        this._statsViewMode = view;
        this.render();
      });
    });

    // Active loadout toggle (mechanical — switches which gear set's stats apply).
    this.element.querySelectorAll('.loadout-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const loadout = btn.dataset.loadout || 'combat';
        if (this.actor.system.activeLoadout === loadout) return;
        // Reset the stats-tab preview so it follows the new active loadout instead of
        // sticking on whatever the user previously previewed.
        this._statsViewMode = null;
        await this.actor.update({ 'system.activeLoadout': loadout });
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

    // Re-Level button — opens the player re-leveler wizard. Owner-only.
    this.element.querySelector('.relevel-btn')?.addEventListener('click', () => {
      if (!this.actor.isOwner) {
        ui.notifications.warn('Only the actor owner can re-level.');
        return;
      }
      new PlayerRelevelDialog(this.actor).render(true);
    });

    // Free-points badge — clickable when there are points to spend. Owner-only.
    this.element.querySelector('.spend-fp-btn')?.addEventListener('click', () => {
      if (!this.actor.isOwner) {
        ui.notifications.warn('Only the actor owner can spend free points.');
        return;
      }
      new SpendFreePointsDialog(this.actor).render(true);
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

    // Edit track history (open dialog with editable history segments).
    this.element.querySelectorAll('.history-edit').forEach(el => {
      el.addEventListener('click', async () => {
        const track = el.dataset.track;
        if (!['class', 'race', 'profession'].includes(track)) return;
        const { HistoryEditDialog } = await import('../apps/history-edit-dialog.mjs');
        const dlg = new HistoryEditDialog(this.actor, track);
        dlg.render(true);
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

      // ActiveEffect drag — titles, blessings, passives etc. are draggable
      // off this actor onto another actor's sheet. Foundry's V2 base
      // _onDropActiveEffect handles the receive side; we just have to set
      // the right dataTransfer payload on dragstart.
      this.element.querySelectorAll('li.item.effect').forEach(li => {
        const effectId = li.dataset.effectId;
        if (!effectId) return;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', ev => {
          const effect = this.actor.effects.get(effectId);
          if (!effect) return;
          ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'ActiveEffect', uuid: effect.uuid }));
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
      // Update the actor. For unlinked tokens, update both the synthetic
      // actor (immediate display) and the world actor (persistence).
      await this.actor.update(updateData);
      if (this.actor.isToken) {
        const worldActor = game.actors.get(this.actor.id);
        if (worldActor) await worldActor.update(updateData);
      }
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

          foundry.audio.AudioHelper.play({ src: 'sounds/dice.wav', volume: 0.8, autoplay: true, loop: false }, true);

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
  _prepareTooltips(system) {
    const tips = {};
    const ab = system.abilities;
    const def = system.defense;

    // DR tooltip.
    const toughMod = ab.toughness?.mod ?? 0;
    const drBase = Math.round(toughMod * 0.5);
    const drTotal = def.dr?.value ?? 0;
    const drBonus = drTotal - drBase;
    tips.dr = `<strong>DR ${drTotal}</strong><hr>`
            + `Base: 50% of Toughness mod (${toughMod}) = ${drBase}`
            + (drBonus !== 0 ? `<br>Effect bonus: ${drBonus > 0 ? '+' : ''}${drBonus}` : '');

    // Armor tooltip.
    const armorVal = def.armor?.value ?? 0;
    tips.armor = `<strong>Armor ${armorVal}</strong><hr>From equipment and effects`;

    // Veil tooltip.
    const veilVal = def.veil?.value ?? 0;
    tips.veil = `<strong>Veil ${veilVal}</strong><hr>From equipment and effects`;

    // Defense pool tooltips.
    const dexMod = ab.dexterity?.mod ?? 0;
    const strMod = ab.strength?.mod ?? 0;
    const perMod = ab.perception?.mod ?? 0;
    const intMod = ab.intelligence?.mod ?? 0;
    const wisMod = ab.wisdom?.mod ?? 0;
    const wilMod = ab.willpower?.mod ?? 0;

    const meleeBase = Math.round((dexMod + strMod * 0.3) * 1.1);
    tips.melee = `<strong>Melee Defense ${def.melee?.value ?? 0}</strong><hr>`
               + `Base: (Dex ${dexMod} + Str ${strMod} × 0.3) × 1.1 = ${meleeBase}`
               + `<br>Pool: ${def.melee?.pool ?? 0} / ${def.melee?.poolMax ?? 0}`;

    const rangedBase = Math.round((dexMod * 0.3 + perMod) * 1.1);
    tips.ranged = `<strong>Ranged Defense ${def.ranged?.value ?? 0}</strong><hr>`
                + `Base: (Dex ${dexMod} × 0.3 + Per ${perMod}) × 1.1 = ${rangedBase}`
                + `<br>Pool: ${def.ranged?.pool ?? 0} / ${def.ranged?.poolMax ?? 0}`;

    const mindBase = Math.round((intMod + wisMod * 0.3) * 1.1);
    tips.mind = `<strong>Mind Defense ${def.mind?.value ?? 0}</strong><hr>`
              + `Base: (Int ${intMod} + Wis ${wisMod} × 0.3) × 1.1 = ${mindBase}`
              + `<br>Pool: ${def.mind?.pool ?? 0} / ${def.mind?.poolMax ?? 0}`;

    const soulBase = Math.round((wisMod + wilMod * 0.3) * 1.1);
    tips.soul = `<strong>Soul Defense ${def.soul?.value ?? 0}</strong><hr>`
              + `Base: (Wis ${wisMod} + Wil ${wilMod} × 0.3) × 1.1 = ${soulBase}`
              + `<br>Pool: ${def.soul?.pool ?? 0} / ${def.soul?.poolMax ?? 0}`;

    // Ability mod tooltips.
    tips.abilities = {};
    for (const [key, ability] of Object.entries(ab)) {
      const b = ability.breakdown;
      if (!b) continue;
      let tip = `<strong>${key.charAt(0).toUpperCase() + key.slice(1)} ${b.final}</strong> (mod ${ability.mod})<hr>`;
      tip += `Base: ${b.base}`;
      if (b.titleBonus) tip += `<br>Titles: +${b.titleBonus}`;
      if (b.blessingMultiplier !== 1) tip += `<br>Blessings: ×${b.blessingMultiplier}`;
      if (b.blessingAdd) tip += `<br>Blessings: +${b.blessingAdd}`;
      tip += `<br>Calculated: ${b.calculated}`;
      if (b.equipmentBonusRaw) tip += `<br>Equipment: +${b.equipmentCapped} (raw ${b.equipmentBonusRaw}, cap ${b.perStatCap})`;
      if (b.effectBonus) tip += `<br>Effects: +${b.effectBonus}`;
      tips.abilities[key] = tip;
    }

    // HP tooltip.
    const vitMod = ab.vitality?.mod ?? 0;
    tips.hp = `<strong>HP ${system.health?.max ?? 0}</strong><hr>`
            + `Vitality mod (${vitMod}) × 1.25 = ${Math.round(vitMod * 1.25)}`;

    // Stamina tooltip.
    const endMod = ab.endurance?.mod ?? 0;
    tips.stamina = `<strong>Stamina ${system.stamina?.max ?? 0}</strong><hr>`
                 + `Endurance mod: ${endMod}`;

    // Mana tooltip.
    tips.mana = `<strong>Mana ${system.mana?.max ?? 0}</strong><hr>`
              + `Willpower mod: ${ab.willpower?.mod ?? 0}`;

    return tips;
  }

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
