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

    // If not equipped, nothing more to do.
    if (!item.system.equipped) return;

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
  /*  Hook Handlers                                     */
  /* -------------------------------------------------- */

  /**
   * React to item updates — sync equipment effects when relevant fields change.
   */
  static _onItemUpdate(item, updateData, _options, _userId) {
    if (!item.parent || item.type !== 'item') return;

    const sys = updateData.system;
    if (!sys) return;

    // Equipped state changed — sync effects.
    if (sys.equipped !== undefined) {
      this._syncEffects(item);
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
}
