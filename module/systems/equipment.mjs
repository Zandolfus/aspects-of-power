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

    // Build the changes array from stat bonuses + augment bonuses + armor/veil.
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

    // Slotted augment bonuses.
    for (const augEntry of (item.system.augments ?? [])) {
      if (!augEntry.augmentId) continue;
      const augItem = actor.items.get(augEntry.augmentId);
      if (!augItem || augItem.type !== 'augment') continue;
      for (const bonus of (augItem.system.statBonuses ?? [])) {
        if (!bonus.ability || !bonus.value) continue;
        changes.push({
          key: `system.abilities.${bonus.ability}.value`,
          mode: 2,
          value: String(bonus.value),
          priority: 20,
        });
      }
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

  /**
   * Distribute a repair amount equally across all equipped gear on an actor
   * that matches the given material types.
   * Items already at max durability are skipped; only damaged items receive repair.
   * If an item was broken (0 durability) and gets repaired, its effects are re-synced.
   * @param {Actor} actor              The actor whose gear to repair.
   * @param {number} amount            The total repair amount to distribute.
   * @param {string[]} [materials=[]]  Material types the repair skill can handle. Empty = all.
   * @returns {Promise<number>} The total durability actually restored.
   */
  static async repairAllEquipped(actor, amount, materials = []) {
    if (!actor || amount <= 0) return 0;

    const damaged = actor.items.filter(i => {
      if (i.type !== 'item' || !i.system.equipped || !i.system.slot) return false;
      if (i.system.durability.max <= 0 || i.system.durability.value >= i.system.durability.max) return false;
      // If the skill specifies materials, only repair matching items.
      if (materials.length > 0 && !materials.includes(i.system.material)) return false;
      return true;
    });

    if (damaged.length === 0) return 0;

    const perPiece = amount / damaged.length;
    let totalRestored = 0;

    for (const item of damaged) {
      const dur = item.system.durability;
      const wasBroken = dur.value <= 0;
      const newValue = Math.min(dur.max, Math.round(dur.value + perPiece));
      const restored = newValue - dur.value;
      totalRestored += restored;

      await item.update({ 'system.durability.value': newValue });

      // If the item was broken and is now functional, re-sync its equipment effects.
      if (wasBroken && newValue > 0) {
        await this._syncEffects(item);
      }
    }

    return totalRestored;
  }

  /* -------------------------------------------------- */
  /*  Durability Degradation                            */
  /* -------------------------------------------------- */

  /**
   * Distribute durability damage across equipped items that provide the
   * relevant defense type. Physical attacks degrade items with armorBonus > 0;
   * magical attacks degrade items with veilBonus > 0.
   * @param {Actor} actor          The actor taking durability damage.
   * @param {number} totalDamage   The total durability damage to distribute.
   * @param {string} damageType    'physical' or 'magical' — determines which items are affected.
   */
  static async degradeDurability(actor, totalDamage, damageType = 'physical') {
    if (!actor || totalDamage <= 0) return;

    // Filter to equipped non-weapon items that provide the relevant defense and have durability remaining.
    // Weapons (hands slot) are excluded — they degrade via their own damage-limit mechanic.
    const eligible = actor.items.filter(i => {
      if (i.type !== 'item' || !i.system.equipped || !i.system.slot) return false;
      if (i.system.slot === 'hands') return false;
      if (i.system.durability.max <= 0 || i.system.durability.value <= 0) return false;
      if (damageType === 'magical') return (i.system.veilBonus ?? 0) > 0;
      return (i.system.armorBonus ?? 0) > 0; // physical (default)
    });

    if (eligible.length === 0) return;

    // Equal split across qualifying pieces.
    const perPiece = totalDamage / eligible.length;

    for (const item of eligible) {
      const newValue = Math.max(0, Math.round(item.system.durability.value - perPiece));
      await item.update({ 'system.durability.value': newValue });

      // If the item just broke, remove its effects.
      if (newValue <= 0) {
        await this._removeItemEffects(item);
        ui.notifications.warn(`${item.name} has broken!`);
      }
    }
  }

  /**
   * Degrade a weapon's durability when raw damage exceeds its damage limit.
   * Damage limit = 3 × weapon progress. Durability loss = rawDamage − limit.
   * @param {Item} weapon      The weapon item (must be in the 'hands' slot).
   * @param {number} rawDamage The unmitigated damage dealt by the attack.
   */
  static async degradeWeaponOnAttack(weapon, rawDamage) {
    if (!weapon || weapon.type !== 'item') return;
    if (weapon.system.slot !== 'hands') return;
    if (weapon.system.durability.max <= 0 || weapon.system.durability.value <= 0) return;

    const damageLimit = 3 * (weapon.system.progress ?? 0);
    if (rawDamage <= damageLimit) return;

    const excess = Math.round(rawDamage - damageLimit);
    const newValue = Math.max(0, weapon.system.durability.value - excess);
    await weapon.update({ 'system.durability.value': newValue });

    if (newValue <= 0) {
      await this._removeItemEffects(weapon);
      ui.notifications.warn(`${weapon.name} has broken from overuse!`);
    } else {
      ui.notifications.warn(`${weapon.name} lost ${excess} durability (exceeded damage limit of ${damageLimit}).`);
    }
  }

  /* -------------------------------------------------- */
  /*  Hook Handlers                                     */
  /* -------------------------------------------------- */

  /**
   * React to item updates — sync equipment effects when relevant fields change.
   */
  static _onItemUpdate(item, updateData, _options, _userId) {
    // Only process on the client that initiated the update to prevent
    // multiple clients each creating duplicate ActiveEffects.
    if (game.userId !== _userId) return;
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

    // Augment slots changed on an equipped item — re-sync.
    if (item.system.equipped && sys.augments) {
      this._syncEffects(item);
      return;
    }

    // Stat/defense bonuses changed on an equipped item — re-sync.
    if (item.system.equipped && (sys.statBonuses || sys.armorBonus !== undefined || sys.veilBonus !== undefined)) {
      this._syncEffects(item);
      return;
    }

    // An augment item's stat bonuses changed — re-sync any equipped gear referencing it.
    if (item.type === 'augment' && sys.statBonuses && item.parent) {
      for (const equip of item.parent.items) {
        if (equip.type !== 'item' || !equip.system.equipped) continue;
        if ((equip.system.augments ?? []).some(a => a.augmentId === item.id)) {
          this._syncEffects(equip);
        }
      }
    }
  }

  /**
   * Clean up equipment ActiveEffects when an item is deleted.
   */
  static _onItemDelete(item, _options, _userId) {
    if (game.userId !== _userId) return;
    if (!item.parent) return;

    // Equipped equipment deleted — remove its effects.
    if (item.type === 'item' && item.system.equipped) {
      this._removeItemEffects(item);
    }

    // Augment deleted — clear it from any equipment that references it.
    if (item.type === 'augment') {
      for (const equip of item.parent.items) {
        if (equip.type !== 'item') continue;
        const augments = equip.system.augments ?? [];
        const idx = augments.findIndex(a => a.augmentId === item.id);
        if (idx >= 0) {
          const newAugments = [...augments];
          newAugments[idx] = { augmentId: '' };
          equip.update({ 'system.augments': newAugments });
          if (equip.system.equipped) {
            this._syncEffects(equip);
          }
        }
      }
    }
  }

  /**
   * When a new item is created, derive durability.max from progress
   * and auto-set augmentSlots from rarity.
   */
  static _onItemCreate(item, _options, _userId) {
    if (game.userId !== _userId) return;
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
