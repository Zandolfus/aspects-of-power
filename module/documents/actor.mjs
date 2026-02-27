/**
 * Extend the base Actor document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class AspectsofPowerActor extends Actor {
  /** @override */
  prepareData() {
    // Prepare data for the actor. Calling the super version of this executes
    // the following, in order: data reset (to clear active effects),
    // prepareBaseData(), prepareEmbeddedDocuments() (including active effects),
    // prepareDerivedData().
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    // Data modifications in this step occur before processing embedded
    // documents or derived data.
  }

  /**
   * @override
   * Augment the actor source data with additional dynamic data. Typically,
   * you'll want to handle most of your calculated/derived data in this step.
   * Data calculated in this step should generally not exist in template.json
   * (such as ability modifiers rather than ability scores) and should be
   * available both inside and outside of character sheets (such as if an actor
   * is queried and has a roll executed directly from it).
   */
  prepareDerivedData() {
    const actorData = this;
    const systemData = actorData.system;

    // --- Rank derivation for all attribute types ---
    for (const type of ['race', 'class', 'profession']) {
      if (systemData.attributes[type]) {
        systemData.attributes[type].rank = CONFIG.ASPECTSOFPOWER.getRankForLevel(systemData.attributes[type].level);
      }
    }

    // Sigmoid modifier formula.
    const sigmoidMod = (value, key) => {
      if (key === "toughness")
        return Math.round(((6000 / (1 + Math.exp(-0.001 * (value - 500)))) - 2265) * 0.5);
      else if (systemData.attributes.race.rank === "E" && key === "vitality")
        return Math.round(((6000 / (1 + Math.exp(-0.001 * (value - 500)))) - 2265) * 1.25);
      else
        return Math.round((6000 / (1 + Math.exp(-0.001 * (value - 500)))) - 2265);
    };

    // --- Stat breakdown: classify effect contributions by source ---
    // Titles are additive to base; blessings MULTIPLY (base + titles).
    const abilityKeys = Object.keys(systemData.abilities);
    const contributions = {};
    for (const key of abilityKeys) {
      contributions[key] = { equipment: 0, blessingAdd: 0, blessingMultiplier: 1, title: 0, other: 0 };
    }
    for (const e of this.allApplicableEffects()) {
      if (e.disabled) continue;
      for (const c of e.changes) {
        const match = c.key.match(/^system\.abilities\.(\w+)\.value$/);
        if (!match || !contributions[match[1]]) continue;
        const val = Number(c.value) || 0;
        const k = match[1];
        if (e.flags?.aspectsofpower?.effectType === 'equipment')        contributions[k].equipment += val;
        else if (e.flags?.aspectsofpower?.effectCategory === 'blessing') {
          if (c.mode === 1) contributions[k].blessingMultiplier *= val; // MULTIPLY
          else              contributions[k].blessingAdd += val;        // ADD
        }
        else if (e.flags?.aspectsofpower?.effectCategory === 'title')    contributions[k].title += val;
        else                                                              contributions[k].other += val;
      }
    }

    // Per-ability breakdown: base → +titles → ×blessings → +equipment → +other.
    for (const [key, ability] of Object.entries(systemData.abilities)) {
      const base = Math.round(this._source.system.abilities[key].value ?? 0);
      const c = contributions[key];
      const afterTitles = base + c.title;
      const calculated = Math.round(afterTitles * c.blessingMultiplier) + Math.round(c.blessingAdd);
      const effectBonus = Math.round(c.other);
      ability.breakdown = {
        base,
        titleBonus: Math.round(c.title),
        blessingMultiplier: c.blessingMultiplier,
        blessingAdd: Math.round(c.blessingAdd),
        calculated,
        effectBonus,
        equipmentBonusRaw: Math.round(c.equipment),
      };
    }

    // Equipment caps: 30% per stat, 20% of total calculated.
    const totalCalculated = Math.round(abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.calculated, 0));
    const globalCap = Math.floor(totalCalculated * 0.20);

    for (const ability of Object.values(systemData.abilities)) {
      const b = ability.breakdown;
      b.perStatCap = Math.floor(b.calculated * 0.30);
      b.equipmentCapped = Math.min(b.equipmentBonusRaw, b.perStatCap);
    }

    let totalEquip = abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.equipmentCapped, 0);
    if (totalEquip > globalCap && totalEquip > 0) {
      const ratio = globalCap / totalEquip;
      for (const ability of Object.values(systemData.abilities)) {
        ability.breakdown.equipmentCapped = Math.floor(ability.breakdown.equipmentCapped * ratio);
      }
      totalEquip = abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.equipmentCapped, 0);
    }

    // Final values and modifiers (overrides AE-modified value with capped total).
    for (const [key, ability] of Object.entries(systemData.abilities)) {
      const b = ability.breakdown;
      b.final = Math.round(b.calculated + b.equipmentCapped + b.effectBonus);
      ability.value = b.final;
      ability.mod = sigmoidMod(b.final, key);
      b.finalMod = ability.mod;
    }

    // Summary for the stats tab.
    systemData.statsSummary = {
      totalCalculated,
      globalCap,
      totalEquipRaw: abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.equipmentBonusRaw, 0),
      totalEquipCapped: totalEquip,
    };

    // --- Resource maxima ---
    systemData.health.max = systemData.abilities.vitality.mod;
    systemData.mana.max = systemData.abilities.willpower.mod;
    systemData.stamina.max = systemData.abilities.endurance.mod;

    // Defense values: compute base from ability mods, then add any
    // ActiveEffect contributions by explicitly summing effect changes.
    const effectBonus = (key) => {
      let sum = 0;
      for (const e of this.allApplicableEffects()) {
        if (e.disabled) continue;
        for (const c of e.changes) {
          if (c.key === key) sum += Number(c.value) || 0;
        }
      }
      return sum;
    };

    systemData.defense.melee.value  = Math.round((systemData.abilities.dexterity.mod + systemData.abilities.strength.mod*.3)*1.1) + effectBonus('system.defense.melee.value');
    systemData.defense.ranged.value = Math.round((systemData.abilities.dexterity.mod*.3 + systemData.abilities.perception.mod)*1.1) + effectBonus('system.defense.ranged.value');
    systemData.defense.mind.value   = Math.round((systemData.abilities.intelligence.mod + systemData.abilities.wisdom.mod*.3)*1.1) + effectBonus('system.defense.mind.value');
    systemData.defense.soul.value   = Math.round((systemData.abilities.wisdom.mod + systemData.abilities.willpower.mod*.3)*1.1) + effectBonus('system.defense.soul.value');

    // Casting range (feet) and movement ranges (feet).
    systemData.castingRange = Math.round(40 + (systemData.abilities.perception.mod / 10));
    systemData.walkRange    = Math.round(35 + (systemData.abilities.endurance.mod / 10));
    systemData.sprintRange  = 2 * systemData.walkRange;

    // --- Carrying capacity ---
    systemData.carryCapacity = Math.round(50 + systemData.abilities.strength.mod + systemData.abilities.endurance.mod * 0.5);
    systemData.carryWeight = 0;
    for (const item of this.items) {
      systemData.carryWeight += (item.system.weight ?? 0) * (item.system.quantity ?? 1);
    }
    systemData.carryWeight = Math.round(systemData.carryWeight * 10) / 10;
    systemData.encumbered = systemData.carryWeight > systemData.carryCapacity;

    // Make separate methods for each Actor type (character, npc, etc.) to keep
    // things organized.
    this._prepareCharacterData(actorData);
    this._prepareNpcData(actorData);

  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== 'character') return;

    // Make modifications to data here. For example:
    const systemData = actorData.system; 


    // Loop through ability scores, and add their modifiers to our sheet output.


  }

  /**
   * Prepare NPC type specific data.
   */
  _prepareNpcData(actorData) {
    if (actorData.type !== 'npc') return;

    // Make modifications to data here. For example:
    const systemData = actorData.system;
    systemData.xp = systemData.cr * systemData.cr * 100;
  }

  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    // Starts off by populating the roll data with the full source data.
    const data = this.system.toObject();

    // Prepare character roll data.
    this._getCharacterRollData(data);
    this._getNpcRollData(data);

    return data;
  }

  /**
   * Prepare character roll data.
   */
  _getCharacterRollData(data) {
    if (this.type !== 'character') return;

    // Copy the ability scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (data.abilities) {
      for (let [k, v] of Object.entries(data.abilities)) {
        // ability.mod is derived in prepareDerivedData() and lives only on the
        // live system instance — toObject() strips it. Restore it here.
        v.mod = this.system.abilities[k]?.mod ?? 0;
        data[k] = foundry.utils.deepClone(v);
      }
    }

    // Add level for easier access, or fall back to 0.
    if (data.attributes?.level) {
      data.lvl = data.attributes.level.value ?? 0;
    }
  }

  /**
   * Prepare NPC roll data.
   */
  _getNpcRollData(data) {
    if (this.type !== 'npc') return;

    // Restore derived ability mods (same as characters — toObject() strips them).
    if (data.abilities) {
      for (let [k, v] of Object.entries(data.abilities)) {
        v.mod = this.system.abilities[k]?.mod ?? 0;
        data[k] = foundry.utils.deepClone(v);
      }
    }
  }
}
