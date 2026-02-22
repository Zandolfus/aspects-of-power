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
    const itemData = this.item;
    const systemData = actorData.system;
    const flags = actorData.flags.aspectsofpower || {};

    if (systemData.attributes.race.level <= 9)
      systemData.attributes.race.rank = "G";
    else if (systemData.attributes.race.level <= 24)
      systemData.attributes.race.rank = "F";
    else if (systemData.attributes.race.level <= 99) 
      systemData.attributes.race.rank = "E";
    else if (systemData.attributes.race.level <= 199)
      systemData.attributes.race.rank = "D";

    for (let [key, ability] of Object.entries(systemData.abilities)) {
      // Ensure the stored value is always an integer before deriving the mod.
      ability.value = Math.round(ability.value ?? 0);

      // Calculate the modifier using aspects rules.
      if (key === "toughness")
        ability.mod = Math.round(((6000 / (1 + Math.exp(-0.001 * (ability.value - 500)))) - 2265)*.5);
      else if (systemData.attributes.race.rank == "E" && key === "vitality")
        ability.mod = Math.round(((6000 / (1 + Math.exp(-0.001 * (ability.value - 500)))) - 2265)*1.25);

      else
        ability.mod = Math.round((6000 / (1 + Math.exp(-0.001 * (ability.value - 500)))) - 2265);
    }
    systemData.health.max = systemData.abilities.vitality.mod;
    systemData.mana.max = systemData.abilities.willpower.mod;
    systemData.stamina.max = systemData.abilities.endurance.mod;

    // Defense values: compute base from ability mods, then add any
    // ActiveEffect contributions by explicitly summing effect changes.
    // (We can't use the current .value because submitOnChange may have
    // saved computed values back to the database.)
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
    //consider if perception should have greater impact at greater ranges
    systemData.defense.ranged.value = Math.round((systemData.abilities.dexterity.mod*.3 + systemData.abilities.perception.mod)*1.1) + effectBonus('system.defense.ranged.value');
    systemData.defense.mind.value   = Math.round((systemData.abilities.intelligence.mod + systemData.abilities.wisdom.mod*.3)*1.1) + effectBonus('system.defense.mind.value');
    systemData.defense.soul.value   = Math.round((systemData.abilities.wisdom.mod + systemData.abilities.willpower.mod*.3)*1.1) + effectBonus('system.defense.soul.value');

    // Casting range (feet) and movement ranges (feet).
    systemData.castingRange = 40 + (systemData.abilities.perception.mod / 10);
    systemData.walkRange    = 35 + (systemData.abilities.endurance.mod / 10);
    systemData.sprintRange  = 2 * systemData.walkRange;

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
