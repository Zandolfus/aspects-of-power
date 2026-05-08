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

    // Dismembered: check if the target slot is disabled by a dismembered debuff.
    const dismembered = actor.effects.find(e =>
      !e.disabled
      && e.system?.debuffType === 'dismembered'
      && e.system?.dismemberedSlot === slot
    );
    if (dismembered) {
      ui.notifications.warn(`Cannot equip to ${slot} — dismembered!`);
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
    if (slot === 'weaponry' && item.system.twoHanded) {
      if (equippedInSlot.length > 0) {
        ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.Equip.needsTwoHands'));
        return false;
      }
    } else if (slot === 'weaponry') {
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
    await this._removeGrantedSkills(item);
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
        type: 'add',
        value: String(bonus.value),
        priority: 20,
      });
    }

    // Slotted augment stat bonuses + collect item bonuses.
    let augArmorFlat = 0, augArmorPct = 0;
    let augVeilFlat = 0, augVeilPct = 0;

    // Dedupe by augment id — multi-slot augments occupy multiple entries
    // with the same id, but bonuses should apply once per augment.
    const seenAugIds = new Set();
    for (const augEntry of (item.system.augments ?? [])) {
      if (!augEntry.augmentId) continue;
      if (seenAugIds.has(augEntry.augmentId)) continue;
      seenAugIds.add(augEntry.augmentId);
      const augItem = actor.items.get(augEntry.augmentId);
      if (!augItem || augItem.type !== 'augment') continue;

      // Actor stat bonuses from augment.
      for (const bonus of (augItem.system.statBonuses ?? [])) {
        if (!bonus.ability || !bonus.value) continue;
        changes.push({
          key: `system.abilities.${bonus.ability}.value`,
          mode: 2,
          value: String(bonus.value),
          priority: 20,
        });
      }

      // Item-specific bonuses — modify the host item's armor/veil.
      for (const ib of (augItem.system.itemBonuses ?? [])) {
        if (!ib.field || !ib.value) continue;
        if (ib.field === 'armorBonus') {
          if (ib.mode === 'percentage') augArmorPct += ib.value;
          else augArmorFlat += ib.value;
        } else if (ib.field === 'veilBonus') {
          if (ib.mode === 'percentage') augVeilPct += ib.value;
          else augVeilFlat += ib.value;
        }
      }
    }

    // Calculate effective armor/veil with augment item bonuses applied.
    const baseArmor = item.system.armorBonus ?? 0;
    const effectiveArmor = Math.round(baseArmor * (1 + augArmorPct / 100) + augArmorFlat);
    if (effectiveArmor > 0) {
      changes.push({
        key: 'system.defense.armor.value',
        mode: 2,
        value: String(effectiveArmor),
        priority: 20,
      });
    }

    const baseVeil = item.system.veilBonus ?? 0;
    const effectiveVeil = Math.round(baseVeil * (1 + augVeilPct / 100) + augVeilFlat);
    if (effectiveVeil > 0) {
      changes.push({
        key: 'system.defense.veil.value',
        mode: 2,
        value: String(effectiveVeil),
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
      type: 'base',
      system: {
        itemSource: item.id,
        effectType: 'equipment',
      },
    }]);
  }

  /* -------------------------------------------------- */
  /*  Granted Skills (weapon → embedded skills)         */
  /* -------------------------------------------------- */

  /**
   * Embed copies of the item's `grantedSkills` (array of source skill UUIDs)
   * onto the owning actor. Each cloned skill is tagged via flags so the
   * companion `_removeGrantedSkills` can find and delete them on unequip.
   * The clone's `requiredEquipment` is auto-set to the granting item's id
   * so the variable-invest path resolves correctly.
   *
   * Idempotent — skills already granted by this item are not re-cloned.
   * @param {Item} item  The equipment item granting the skills.
   */
  static async _grantSkills(item) {
    const actor = item.parent;
    if (!actor) return;
    const uuids = item.system.grantedSkills ?? [];
    if (uuids.length === 0) return;

    const alreadyGrantedFrom = new Set(
      actor.items
        .filter(i => i.flags?.aspectsofpower?.grantedBy === item.id)
        .map(i => i.flags?.aspectsofpower?.grantedFrom)
    );

    const toCreate = [];
    for (const uuid of uuids) {
      if (!uuid || alreadyGrantedFrom.has(uuid)) continue;
      let src;
      try { src = await fromUuid(uuid); } catch (e) { continue; }
      if (!src || src.type !== 'skill') continue;
      const data = src.toObject();
      delete data._id; // let Foundry assign a new id on the actor
      data.system = data.system ?? {};
      data.system.requiredEquipment = item.id;
      foundry.utils.setProperty(data, 'flags.aspectsofpower.grantedBy', item.id);
      foundry.utils.setProperty(data, 'flags.aspectsofpower.grantedFrom', uuid);
      toCreate.push(data);
    }
    if (toCreate.length > 0) {
      await actor.createEmbeddedDocuments('Item', toCreate);
    }
  }

  /**
   * Remove all skill items on the actor that were granted by this item.
   * @param {Item} item  The equipment item that originally granted them.
   */
  static async _removeGrantedSkills(item) {
    const actor = item.parent;
    if (!actor) return;
    const toDelete = actor.items
      .filter(i => i.flags?.aspectsofpower?.grantedBy === item.id)
      .map(i => i.id);
    if (toDelete.length > 0) {
      await actor.deleteEmbeddedDocuments('Item', toDelete);
    }
  }

  /**
   * Remove all ActiveEffects on the actor that originated from a specific item.
   * @param {Item} item  The source item.
   */
  static async _removeItemEffects(item) {
    const actor = item.parent;
    if (!actor) return;

    const toDelete = actor.effects
      .filter(e => e.system?.itemSource === item.id)
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
    if (repairKit.type !== 'consumable' || repairKit.system.effectType !== 'repairKit') return;
    if (repairKit.system.quantity <= 0) return;

    const dur = item.system.durability;
    const newValue = Math.min(dur.max, dur.value + repairKit.system.repairAmount);
    const actualRepair = newValue - dur.value;

    await item.update({ 'system.durability.value': newValue });

    // Consume one charge / quantity from the repair kit.
    const charges = repairKit.system.charges;
    if (charges.max > 1) {
      // Multi-charge: decrement charge, reset & consume quantity when depleted.
      const newCharge = charges.value - 1;
      if (newCharge <= 0) {
        const newQty = repairKit.system.quantity - 1;
        if (newQty <= 0) {
          await repairKit.delete();
        } else {
          await repairKit.update({ 'system.quantity': newQty, 'system.charges.value': charges.max });
        }
      } else {
        await repairKit.update({ 'system.charges.value': newCharge });
      }
    } else {
      // Single-use: consume quantity.
      const newQty = repairKit.system.quantity - 1;
      if (newQty <= 0) {
        await repairKit.delete();
      } else {
        await repairKit.update({ 'system.quantity': newQty });
      }
    }

    ui.notifications.info(`Repaired ${item.name} (+${actualRepair} durability).`);
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
      if (i.system.slot === 'weaponry') return false;
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
   * @param {Item} weapon      The weapon item (must be in the 'weaponry' slot).
   * @param {number} rawDamage The unmitigated damage dealt by the attack.
   */
  static async degradeWeaponOnAttack(weapon, rawDamage) {
    if (!weapon || weapon.type !== 'item') return;
    if (weapon.system.slot !== 'weaponry') return;
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

    // Each branch below decides whether it needs a re-sync of equipment AEs.
    // We DON'T early-return between branches — multi-field updates (e.g. the
    // item-rederive migration writes progress + statBonuses + armorBonus +
    // veilBonus + durability.max in one call) need every relevant branch to
    // run. Earlier code returned after the first match and lost downstream
    // sync work, leaving stale armor/veil values on the actor.
    let needsSync = false;

    // Progress changed — derive durability.max from progress (only when the
    // caller didn't supply one explicitly, e.g. the migration sets durability.max
    // directly). Triggering a follow-up update here would re-fire this hook
    // and risk loops on bulk updates, so we just leave that to the caller.
    if (sys.progress !== undefined && sys.durability?.max === undefined) {
      const newMax = item.system.progress * 2;
      const updates = { 'system.durability.max': newMax };
      if (item.system.durability.value > newMax) {
        updates['system.durability.value'] = newMax;
      }
      item.update(updates);
      // No needsSync flip — the follow-up update will re-enter the hook.
    }

    // Equipped state changed — sync effects + grant/remove skills.
    if (sys.equipped !== undefined) {
      this._syncEffects(item);
      if (item.system.equipped) this._grantSkills(item);
      else this._removeGrantedSkills(item);
      return;
    }

    // grantedSkills array edited on an equipped item — re-grant from scratch.
    if (sys.grantedSkills !== undefined && item.system.equipped) {
      this._removeGrantedSkills(item).then(() => this._grantSkills(item));
    }

    // Durability changed — only act on threshold crossings (broke or repaired from broken).
    if (sys.durability?.value !== undefined && item.system.equipped) {
      const hasEffects = item.parent.effects.some(e => e.system?.itemSource === item.id);
      if (item.system.durability.value <= 0 && hasEffects) {
        this._removeItemEffects(item);
        return; // gone — no sync needed
      } else if (item.system.durability.value > 0 && !hasEffects) {
        needsSync = true;
      }
    }

    // Augment slots / stat / defense changes on an equipped item → sync.
    if (item.system.equipped && (sys.augments
                              || sys.statBonuses
                              || sys.armorBonus !== undefined
                              || sys.veilBonus !== undefined)) {
      needsSync = true;
    }

    if (needsSync) this._syncEffects(item);

    // An augment item's bonuses changed — re-sync any equipped gear referencing it.
    if (item.type === 'augment' && (sys.statBonuses || sys.itemBonuses) && item.parent) {
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

    // Resolve the actor — parent may be null after deletion in v13,
    // so fall back to looking up the actor from the item's UUID.
    const actor = item.parent ?? game.actors.get(item._source?.parent ?? '');
    if (!actor) return;

    // Equipped equipment deleted — remove its effects by ID.
    if (item.type === 'item' && item.system.equipped) {
      const toDelete = actor.effects
        .filter(e => e.system?.itemSource === item.id)
        .map(e => e.id);
      if (toDelete.length > 0) {
        actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
      }
    }

    // Equipment deleted — also remove any skills it granted.
    if (item.type === 'item') {
      const grantedSkillIds = actor.items
        .filter(i => i.flags?.aspectsofpower?.grantedBy === item.id)
        .map(i => i.id);
      if (grantedSkillIds.length > 0) {
        actor.deleteEmbeddedDocuments('Item', grantedSkillIds);
      }
    }

    // Augment deleted — clear it from any equipment that references it.
    if (item.type === 'augment') {
      for (const equip of actor.items) {
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
    const durMax = progress * 2;
    if (item.system.durability.max !== durMax) {
      updates['system.durability.max'] = durMax;
      updates['system.durability.value'] = durMax;
    }
    const rarityAugments = CONFIG.ASPECTSOFPOWER.rarities[item.system.rarity]?.augments ?? 0;
    const isProfGear = (item.system.slot ?? '').startsWith('prof');

    // Profession gear: 0 regular slots, profession slots = rarity + 1 extra.
    // Combat gear: rarity slots, 0 profession slots.
    const augSlots = isProfGear ? 0 : rarityAugments;
    const profAugSlots = isProfGear ? rarityAugments + 1 : 0;

    if (item.system.augmentSlots !== augSlots) {
      updates['system.augmentSlots'] = augSlots;
    }
    if (item.system.profAugmentSlots !== profAugSlots) {
      updates['system.profAugmentSlots'] = profAugSlots;
    }
    if (Object.keys(updates).length > 0) item.update(updates);
  }
}
