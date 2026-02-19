// module/systems/leveling.mjs

/**
 * Comprehensive leveling system for Aspects of Power
 */
export class LevelingSystem {
  
  /**
   * Class definitions with stat progressions
   */
  static CLASS_DEFINITIONS = {
    // Tier 1 Classes (Levels 1-24)
    warrior: {
      name: "Warrior",
      tier: 1,
      primaryStats: ['strength', 'vitality', 'toughness'],
      statDistribution: { strength: 3, vitality: 2, toughness: 1 }, // out of 6 fixed points
      description: "Masters of combat and physical prowess"
    },
    rogue: {
      name: "Rogue",
      tier: 1,
      primaryStats: ['dexterity', 'perception', 'intelligence'],
      statDistribution: { dexterity: 3, perception: 2, intelligence: 1 },
      description: "Agile specialists in stealth and precision"
    },
    mage: {
      name: "Mage",
      tier: 1,
      primaryStats: ['intelligence', 'willpower', 'wisdom'],
      statDistribution: { intelligence: 3, willpower: 2, wisdom: 1 },
      description: "Wielders of arcane knowledge and magical power"
    },
    cleric: {
      name: "Cleric",
      tier: 1,
      primaryStats: ['wisdom', 'willpower', 'vitality'],
      statDistribution: { wisdom: 3, willpower: 2, vitality: 1 },
      description: "Divine channelers of healing and protection"
    },
    ranger: {
      name: "Ranger",
      tier: 1,
      primaryStats: ['dexterity', 'perception', 'endurance'],
      statDistribution: { dexterity: 2, perception: 2, endurance: 2 },
      description: "Nature-attuned hunters and trackers"
    },
    bard: {
      name: "Bard",
      tier: 1,
      primaryStats: ['intelligence', 'wisdom', 'perception'],
      statDistribution: { intelligence: 2, wisdom: 2, perception: 2 },
      description: "Versatile performers with magical abilities"
    },
    
    // Tier 2 Classes (Levels 25-99)
    paladin: {
      name: "Paladin",
      tier: 2,
      prerequisites: { warrior: 24 },
      primaryStats: ['strength', 'vitality', 'wisdom'],
      statDistribution: { strength: 5, vitality: 4, wisdom: 3, willpower: 2 }, // out of 14 fixed points
      description: "Holy warriors combining divine magic with martial prowess"
    },
    assassin: {
      name: "Assassin",
      tier: 2,
      prerequisites: { rogue: 24 },
      primaryStats: ['dexterity', 'intelligence', 'perception'],
      statDistribution: { dexterity: 5, intelligence: 4, perception: 3, strength: 2 },
      description: "Elite killers with supernatural stealth abilities"
    },
    archmage: {
      name: "Archmage",
      tier: 2,
      prerequisites: { mage: 24 },
      primaryStats: ['intelligence', 'willpower', 'wisdom'],
      statDistribution: { intelligence: 6, willpower: 4, wisdom: 4 },
      description: "Masters of multiple schools of magic"
    },
    // Add more tier 2 classes as needed
  };

  /**
   * Profession definitions
   */
  static PROFESSION_DEFINITIONS = {
    blacksmith: {
      name: "Blacksmith",
      statBonus: { strength: 2, endurance: 1 },
      description: "Craft weapons and armor"
    },
    merchant: {
      name: "Merchant",
      statBonus: { intelligence: 2, perception: 1 },
      description: "Trade goods and manage resources"
    },
    scholar: {
      name: "Scholar",
      statBonus: { intelligence: 3 },
      description: "Research and study arcane knowledge"
    },
    athlete: {
      name: "Athlete",
      statBonus: { strength: 1, dexterity: 1, endurance: 1 },
      description: "Physical training and competition"
    },
    healer: {
      name: "Healer",
      statBonus: { wisdom: 2, intelligence: 1 },
      description: "Medical practice and herbal remedies"
    },
    scout: {
      name: "Scout",
      statBonus: { perception: 2, dexterity: 1 },
      description: "Exploration and reconnaissance"
    }
  };

  /**
   * Race progression definitions
   */
  static RACE_DEFINITIONS = {
    human: {
      name: "Human",
      statBonus: {}, // Even distribution
      description: "Versatile and adaptable"
    },
    elf: {
      name: "Elf",
      statBonus: { dexterity: 1, intelligence: 1, perception: 1 },
      description: "Grace and magical affinity"
    },
    dwarf: {
      name: "Dwarf",
      statBonus: { strength: 1, toughness: 1, endurance: 1 },
      description: "Sturdy and resilient"
    },
    halfling: {
      name: "Halfling",
      statBonus: { dexterity: 2, perception: 1 },
      description: "Small but quick and observant"
    }
  };

  /**
   * Level up a character with comprehensive validation
   */
  static async levelUpCharacter(actor, progressionType, levels = 1, options = {}) {
    if (actor.type !== 'character') {
      throw new Error("Only characters can use class/profession progression");
    }

    const validation = this.validateLevelUp(actor, progressionType, levels);
    if (!validation.valid) {
      ui.notifications.error(validation.error);
      return false;
    }

    switch (progressionType) {
      case 'race':
        return await this._levelUpRace(actor, levels, options);
      case 'class':
        return await this._levelUpClass(actor, levels, options);
      case 'profession':
        return await this._levelUpProfession(actor, levels, options);
      default:
        throw new Error(`Unknown progression type: ${progressionType}`);
    }
  }

  /**
   * Validate level up attempt
   */
  static validateLevelUp(actor, progressionType, levels) {
    const system = actor.system;
    
    switch (progressionType) {
      case 'race':
        // Race can always level up
        return { valid: true };
        
      case 'class':
        const className = system.attributes.class.name;
        if (!className) {
          return { valid: false, error: "No class selected" };
        }
        
        const classDef = this.CLASS_DEFINITIONS[className.toLowerCase()];
        if (!classDef) {
          return { valid: false, error: `Unknown class: ${className}` };
        }
        
        // Check tier progression requirements
        const currentLevel = system.attributes.class.level;
        const newLevel = currentLevel + levels;
        
        if (classDef.tier === 1 && newLevel > 24) {
          return { valid: false, error: "Tier 1 classes cannot exceed level 24" };
        }
        
        if (classDef.tier === 2) {
          // Check prerequisites
          if (classDef.prerequisites) {
            for (let [reqClass, reqLevel] of Object.entries(classDef.prerequisites)) {
              // This would need to check character's class history
              // For now, simplified check
              if (currentLevel === 0) {
                return { valid: false, error: `Requires ${reqClass} level ${reqLevel}` };
              }
            }
          }
          
          if (newLevel > 99) {
            return { valid: false, error: "Tier 2 classes cannot exceed level 99" };
          }
        }
        
        return { valid: true };
        
      case 'profession':
        const professionName = system.attributes.profession.name;
        if (!professionName) {
          return { valid: false, error: "No profession selected" };
        }
        
        if (!this.PROFESSION_DEFINITIONS[professionName.toLowerCase()]) {
          return { valid: false, error: `Unknown profession: ${professionName}` };
        }
        
        return { valid: true };
        
      default:
        return { valid: false, error: "Invalid progression type" };
    }
  }

  /**
   * Level up race progression
   */
  static async _levelUpRace(actor, levels, options) {
    const system = actor.system;
    const raceName = system.attributes.race.name.toLowerCase();
    const raceBonus = this.RACE_DEFINITIONS[raceName]?.statBonus || {};
    
    const updates = {
      'system.attributes.race.level': system.attributes.race.level + levels
    };
    
    // Apply race stat bonuses (1 point to all stats plus racial bonuses)
    for (let [ability, abilityData] of Object.entries(system.abilities)) {
      const baseIncrease = levels; // 1 per level for all stats
      const racialBonus = (raceBonus[ability] || 0) * levels;
      updates[`system.abilities.${ability}.value`] = abilityData.value + baseIncrease + racialBonus;
    }
    
    await actor.update(updates);
    
    ui.notifications.info(`${actor.name} gained ${levels} race level(s)!`);
    return true;
  }

  /**
   * Level up class progression
   */
  static async _levelUpClass(actor, levels, options) {
    const system = actor.system;
    const className = system.attributes.class.name.toLowerCase();
    const classDef = this.CLASS_DEFINITIONS[className];
    
    const currentLevel = system.attributes.class.level;
    const newLevel = currentLevel + levels;
    const tier = this._getClassTier(newLevel);
    
    // Calculate stat points
    const statPointsPerLevel = tier === 1 ? 8 : 18; // 6+2 for tier 1, 14+4 for tier 2
    const freePointsPerLevel = tier === 1 ? 2 : 4;
    const fixedPointsPerLevel = statPointsPerLevel - freePointsPerLevel;
    
    const totalFixedPoints = fixedPointsPerLevel * levels;
    const totalFreePoints = freePointsPerLevel * levels;
    
    const updates = {
      'system.attributes.class.level': newLevel,
      'system.attributes.class.tier': tier,
      'system.attributes.freePoints': system.attributes.freePoints + totalFreePoints
    };
    
    // Apply fixed stat distribution based on class
    for (let [stat, pointsPerLevel] of Object.entries(classDef.statDistribution)) {
      const totalIncrease = pointsPerLevel * levels;
      updates[`system.abilities.${stat}.value`] = system.abilities[stat].value + totalIncrease;
    }
    
    await actor.update(updates);
    
    // Handle free point allocation
    await this._handleFreePointAllocation(actor, totalFreePoints, options.allocation || 'manual');
    
    // Grant class abilities
    await this._grantClassAbilities(actor, className, currentLevel + 1, newLevel);
    
    ui.notifications.info(`${actor.name} gained ${levels} ${classDef.name} level(s)!`);
    return true;
  }

  /**
   * Level up profession progression  
   */
  static async _levelUpProfession(actor, levels, options) {
    const system = actor.system;
    const professionName = system.attributes.profession.name.toLowerCase();
    const professionDef = this.PROFESSION_DEFINITIONS[professionName];
    
    const updates = {
      'system.attributes.profession.level': system.attributes.profession.level + levels
    };
    
    // Apply profession stat bonuses
    for (let [stat, bonus] of Object.entries(professionDef.statBonus)) {
      const totalIncrease = bonus * levels;
      updates[`system.abilities.${stat}.value`] = system.abilities[stat].value + totalIncrease;
    }
    
    await actor.update(updates);
    
    ui.notifications.info(`${actor.name} gained ${levels} ${professionDef.name} level(s)!`);
    return true;
  }

  /**
   * Handle free point allocation based on method
   */
  static async _handleFreePointAllocation(actor, points, method) {
    switch (method) {
      case 'manual':
        this._showLevelUpDialog(actor, points);
        break;
      case 'random':
        await this._allocatePointsRandomly(actor, points);
        break;
      case 'save':
        // Points already added to freePoints, do nothing
        break;
    }
  }

  /**
   * Allocate points randomly across all stats
   */
  static async _allocatePointsRandomly(actor, points) {
    const abilities = Object.keys(actor.system.abilities);
    const updates = {};
    let remainingPoints = points;
    
    while (remainingPoints > 0) {
      const randomStat = abilities[Math.floor(Math.random() * abilities.length)];
      const currentValue = actor.system.abilities[randomStat].value;
      updates[`system.abilities.${randomStat}.value`] = (updates[`system.abilities.${randomStat}.value`] || currentValue) + 1;
      remainingPoints--;
    }
    
    updates['system.attributes.freePoints'] = actor.system.attributes.freePoints - points;
    await actor.update(updates);
    
    ui.notifications.info(`Randomly allocated ${points} stat points.`);
  }

  /**
   * Show level up dialog for manual allocation
   */
  static _showLevelUpDialog(actor, points) {
    const content = `
      <div class="level-up-dialog">
        <h3>Level Up: ${actor.name}</h3>
        <p>You have <strong>${points}</strong> free points to allocate.</p>
        <p>Use the character sheet to manually distribute these points, or choose an allocation method below.</p>
      </div>
    `;

    new foundry.applications.api.DialogV2({
      window: { title: "Level Up" },
      content: content,
      buttons: [
        {
          action: "random",
          label: "Allocate Randomly",
          callback: async () => {
            await this._allocatePointsRandomly(actor, points);
          }
        },
        {
          action: "save",
          label: "Save for Later",
          callback: () => {
            ui.notifications.info(`${points} points saved for later allocation.`);
          }
        },
        {
          action: "close",
          label: "Close"
        }
      ]
    }).render(true);
  }

  /**
   * Grant class abilities based on level progression
   */
  static async _grantClassAbilities(actor, className, fromLevel, toLevel) {
    const abilities = this._getClassAbilitiesForLevels(className, fromLevel, toLevel);
    
    if (abilities.length > 0) {
      await actor.createEmbeddedDocuments("Item", abilities);
      
      const abilityNames = abilities.map(a => a.name).join(', ');
      ui.notifications.info(`${actor.name} learned new abilities: ${abilityNames}`);
    }
  }

  /**
   * Get class abilities for level range
   */
  static _getClassAbilitiesForLevels(className, fromLevel, toLevel) {
    // This would be a comprehensive database of class abilities
    // For now, a simple example structure
    const classAbilities = {
      warrior: {
        2: [{
          name: "Second Wind",
          type: "ability",
          system: {
            description: "Regain health once per short rest",
            activation: { type: "bonus", cost: 1 },
            uses: { max: 1, per: "sr" }
          }
        }],
        5: [{
          name: "Extra Attack",
          type: "ability",
          system: {
            description: "Make an additional attack",
            activation: { type: "passive" }
          }
        }]
      },
      mage: {
        1: [{
          name: "Cantrips",
          type: "ability",
          system: {
            description: "Cast simple spells at will",
            activation: { type: "action", cost: 1 }
          }
        }],
        3: [{
          name: "Fireball",
          type: "spell",
          system: {
            description: "Launch a fiery projectile",
            activation: { type: "action", cost: 1 },
            uses: { max: 3, per: "day" }
          }
        }]
      }
    };
    
    const abilities = [];
    const classAbilityMap = classAbilities[className] || {};
    
    for (let level = fromLevel; level <= toLevel; level++) {
      if (classAbilityMap[level]) {
        abilities.push(...classAbilityMap[level]);
      }
    }
    
    return abilities;
  }

  /**
   * Get class tier based on level
   */
  static _getClassTier(level) {
    if (level <= 24) return 1;
    if (level <= 99) return 2;
    if (level <= 199) return 3;
    return 4;
  }

  /**
   * Bulk level up multiple characters
   */
  static async bulkLevelUp(actors, progressionType, levels, allocation = 'manual') {
    const results = {
      success: [],
      failed: []
    };
    
    for (let actor of actors) {
      try {
        const success = await this.levelUpCharacter(actor, progressionType, levels, { allocation });
        if (success) {
          results.success.push(actor.name);
        } else {
          results.failed.push({ name: actor.name, error: "Level up failed" });
        }
      } catch (error) {
        results.failed.push({ name: actor.name, error: error.message });
      }
    }
    
    // Show results summary
    let message = `Bulk Level Up Results:\n`;
    message += `✓ Success: ${results.success.length} characters\n`;
    message += `✗ Failed: ${results.failed.length} characters`;
    
    if (results.failed.length > 0) {
      message += `\n\nFailures:\n`;
      results.failed.forEach(f => {
        message += `- ${f.name}: ${f.error}\n`;
      });
    }
    
    ui.notifications.info(message);
    return results;
  }
}