/**
 * Equipment management — equip/unequip logic, ActiveEffect synchronization,
 * slot validation, and repair mechanics.
 */
export class EquipmentSystem {

  /**
   * Register Foundry hooks for equipment lifecycle events.
   * Called once from the system init hook.
   */
  static initialize() {
    Hooks.on('updateItem', this._onItemUpdate.bind(this));
    Hooks.on('deleteItem', this._onItemDelete.bind(this));
    Hooks.on('createItem', this._onItemCreate.bind(this));
  }

  /* -------------------------------------------------- */
  /*  Equip / Unequip                                   */
  /* -------------------------------------------------- */

  /**
   * Equip an item into its designated slot on the owning actor.
   * Validates slot capacity and two-handed constraints.
   * @param {Item} item  The item document to equip.
   * @returns {Promise<boolean>} Whether the equip succeeded.
   */
  static async equip(item) {
    const actor = item.parent;
    if (!actor) return false;

    const slot = item.system.slot;
    if (!slot) {
      ui.notifications.warn('This item has no equipment slot assigned.');
      return false;
    }

    const slotDef = CONFIG.ASPECTSOFPOWER.equipmentSlots[slot];
    if (!slotDef) {
      ui.notifications.warn(`Unknown equipment slot: ${slot}`);
      return false;
    }

    // Count items currently equipped in this slot.
    const equippedInSlot = actor.items.filter(
      i => i.type === 'item' && i.system.equipped && i.system.slot === slot && i.id !== item.id
    );

    // Two-handed items require 2 free hand slots.
    if (slot === 'hands' && item.system.twoHanded) {
      if (equippedInSlot.length > 0) {
        ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.Equip.needsTwoHands'));
        return false;
      }
    } else if (slot === 'hands') {
      // One-handed: check if a two-handed item is already equipped.
      const twoHanderEquipped = equippedInSlot.some(i => i.system.twoHanded);
      if (twoHanderEquipped || equippedInSlot.length >= slotDef.max) {
        ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.Equip.slotFull'));
        return false;
      }
    } else {
      if (equippedInSlot.length >= slotDef.max) {
        ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.Equip.slotFull'));
        return false;
      }
    }

    // Mark as equipped — the updateItem hook will sync effects.
    await item.update({ 'system.equipped': true });
    return true;
  }

  /**
   * Unequip an item, removing its equipment ActiveEffects.
   * @param {Item} item  The item document to unequip.
   */
  static async unequip(item) {
    await this._removeItemEffects(item);
    await item.update({ 'system.equipped': false });
  }

  /* -------------------------------------------------- */
  /*  ActiveEffect Synchronization                      */
  /* -------------------------------------------------- */

  /**
   * Synchronize equipment ActiveEffects for an item.
   * Removes any existing effects from this item, then creates new ones
   * reflecting its current stat/defense bonuses.
   * @param {Item} item  The equipped item.
   */
  static async _syncEffects(item) {
    const actor = item.parent;
    if (!actor) return;

    // Remove old effects from this item.
    await this._removeItemEffects(item);

    // If not equipped or broken (0 durability), nothing more to do.
    if (!item.system.equipped) return;
    if (item.system.durability.value <= 0 && item.system.durability.max > 0) return;

    // Build the changes array from stat bonuses + armor/veil.
    const changes = [];

    for (const bonus of (item.system.statBonuses ?? [])) {
      if (!bonus.ability || !bonus.value) continue;
      changes.push({
        key: `system.abilities.${bonus.ability}.value`,
        mode: 2, // CONST.ACTIVE_EFFECT_MODES.ADD
        value: String(bonus.value),
        priority: 20,
      });
    }

    if (item.system.armorBonus > 0) {
      changes.push({
        key: 'system.defense.armor.value',
        mode: 2,
        value: String(item.system.armorBonus),
        priority: 20,
      });
    }

    if (item.system.veilBonus > 0) {
      changes.push({
        key: 'system.defense.veil.value',
        mode: 2,
        value: String(item.system.veilBonus),
        priority: 20,
      });
    }

    if (changes.length === 0) return;

    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name: `${item.name} (Equipment)`,
      img: item.img,
      origin: item.uuid,
      disabled: false,
      changes,
      flags: {
        aspectsofpower: {
          itemSource: item.id,
          effectType: 'equipment',
        },
      },
    }]);
  }

  /**
   * Remove all ActiveEffects on the actor that originated from a specific item.
   * @param {Item} item  The source item.
   */
  static async _removeItemEffects(item) {
    const actor = item.parent;
    if (!actor) return;

    const toDelete = actor.effects
      .filter(e => e.flags?.aspectsofpower?.itemSource === item.id)
      .map(e => e.id);

    if (toDelete.length > 0) {
      await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
    }
  }

  /* -------------------------------------------------- */
  /*  Slot Summary (for templates)                      */
  /* -------------------------------------------------- */

  /**
   * Build a slot summary for the equipment tab template.
   * @param {Actor} actor
   * @returns {Object} Map of slotKey → { label, max, items[] }
   */
  static getSlotSummary(actor) {
    const summary = {};
    for (const [key, def] of Object.entries(CONFIG.ASPECTSOFPOWER.equipmentSlots)) {
      summary[key] = {
        label: game.i18n.localize(def.label),
        max: def.max,
        items: [],
      };
    }

    for (const item of actor.items) {
      if (item.type !== 'item' || !item.system.equipped || !item.system.slot) continue;
      summary[item.system.slot]?.items.push(item);
    }

    return summary;
  }

  /* -------------------------------------------------- */
  /*  Repair                                            */
  /* -------------------------------------------------- */

  /**
   * Repair an item using a repair kit.
   * @param {Item} item       The item to repair.
   * @param {Item} repairKit  The repair kit item to consume.
   */
  static async repair(item, repairKit) {
    if (!repairKit.system.isRepairKit || repairKit.system.quantity <= 0) return;

    const dur = item.system.durability;
    const newValue = Math.min(dur.max, dur.value + repairKit.system.repairAmount);

    await item.update({ 'system.durability.value': newValue });

    // Consume one repair kit.
    const newQty = repairKit.system.quantity - 1;
    if (newQty <= 0) {
      await repairKit.delete();
    } else {
      await repairKit.update({ 'system.quantity': newQty });
    }

    ui.notifications.info(`Repaired ${item.name} (+${newValue - dur.value} durability).`);
  }

  /* -------------------------------------------------- */
  /*  Durability Degradation                            */
  /* -------------------------------------------------- */

  /**
   * Distribute durability damage equally across all equipped armor pieces
   * on an actor. Each piece loses the same amount; if a piece breaks (hits 0),
   * its equipment effects are removed.
   * @param {Actor} actor          The actor taking durability damage.
   * @param {number} totalDamage   The total durability damage to distribute.
   */
  static async degradeDurability(actor, totalDamage) {
    if (!actor || totalDamage <= 0) return;

    // Gather all equipped items that have durability remaining.
    const equippedArmor = actor.items.filter(
      i => i.type === 'item' && i.system.equipped && i.system.slot && i.system.durability.max > 0 && i.system.durability.value > 0
    );

    if (equippedArmor.length === 0) return;

    // Equal split across all pieces.
    const perPiece = totalDamage / equippedArmor.length;

    for (const item of equippedArmor) {
      const newValue = Math.max(0, Math.round(item.system.durability.value - perPiece));
      await item.update({ 'system.durability.value': newValue });

      // If the item just broke, remove its effects.
      if (newValue <= 0) {
        await this._removeItemEffects(item);
        ui.notifications.warn(`${item.name} has broken!`);
      }
    }
  }

  /* -------------------------------------------------- */
  /*  Hook Handlers                                     */
  /* -------------------------------------------------- */

  /**
   * React to item updates — sync equipment effects when relevant fields change.
   */
  static _onItemUpdate(item, updateData, _options, _userId) {
    if (!item.parent || item.type !== 'item') return;

    const sys = updateData.system;
    if (!sys) return;

    // Progress changed — derive durability.max from progress.
    if (sys.progress !== undefined) {
      const newMax = item.system.progress;
      const updates = { 'system.durability.max': newMax };
      // If current durability exceeds new max, clamp it.
      if (item.system.durability.value > newMax) {
        updates['system.durability.value'] = newMax;
      }
      item.update(updates);
      return;
    }

    // Equipped state changed — sync effects.
    if (sys.equipped !== undefined) {
      this._syncEffects(item);
      return;
    }

    // Durability changed — if it hit 0, remove effects; if restored from 0, re-sync.
    if (sys.durability?.value !== undefined && item.system.equipped) {
      if (item.system.durability.value <= 0) {
        this._removeItemEffects(item);
      } else {
        this._syncEffects(item);
      }
      return;
    }

    // Stat/defense bonuses changed on an equipped item — re-sync.
    if (item.system.equipped && (sys.statBonuses || sys.armorBonus !== undefined || sys.veilBonus !== undefined)) {
      this._syncEffects(item);
    }
  }

  /**
   * Clean up equipment ActiveEffects when an item is deleted.
   */
  static _onItemDelete(item, _options, _userId) {
    if (!item.parent || item.type !== 'item') return;
    if (!item.system.equipped) return;
    this._removeItemEffects(item);
  }

  /**
   * When a new item is created, derive durability.max from progress
   * and auto-set augmentSlots from rarity.
   */
  static _onItemCreate(item, _options, _userId) {
    if (item.type !== 'item') return;
    const updates = {};
    const progress = item.system.progress ?? 0;
    if (item.system.durability.max !== progress) {
      updates['system.durability.max'] = progress;
      updates['system.durability.value'] = progress;
    }
    const augSlots = CONFIG.ASPECTSOFPOWER.rarities[item.system.rarity]?.augments ?? 0;
    if (item.system.augmentSlots !== augSlots) {
      updates['system.augmentSlots'] = augSlots;
    }
    if (Object.keys(updates).length > 0) item.update(updates);
  }
}
