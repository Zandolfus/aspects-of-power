/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class AspectsofPowerItem extends Item {
  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    // As with the actor class, items are documents that can have their data
    // preparation methods overridden (such as prepareBaseData()).
    super.prepareData();
  }
  prepareDerivedData() {
    const itemData = this;
    const actorData = this.actor;
    //console.log(actorData);

    //console.log(itemData.system.formula);
    super.prepareDerivedData();
  }
  /**
   * Prepare a data object which defines the data schema used by dice roll commands against this Item
   * @override
   */
  getRollData() {
    // Starts off by populating the roll data with the full source data (includes
    // non-schema fields like `roll` stored in the database).
    const rollData = this.system.toObject();

    // Quit early if there's no parent actor
    if (!this.actor) return rollData;

    // If present, add the actor's roll data
    rollData.actor = this.actor.getRollData();

    return rollData;
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async roll() {
    const item = this;
    const rollData = this.getRollData();

    // Initialize chat data.
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const label = `[${item.type}] ${item.name}`;

    // If there's no roll data, send a chat message.
    if (!this.system.formula) {
      ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: item.system.description ?? '',
      });
    }
    // No roll config stored (schema field missing or stripped by migration).
    else if (!rollData.roll) {
      ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: item.system.description ?? '',
      });
    }
    else if(!rollData.roll.dice) {
      ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: item.system.description ?? '',
      });
      rollData.roll.abilitymod=this.actor.system.abilities[rollData.roll.abilities].mod;
      rollData.roll.resourcevalue=this.actor.system[rollData.roll.resource].value;
      if (rollData.roll.resourcevalue >= rollData.roll.cost) {
        if (rollData.roll.type == "dex_weapon"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.dexterity.mod+"*(9/10)"+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))+"+this.actor.system.abilities.dexterity.mod+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.strength.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10))"+")+"+this.actor.system.abilities.strength.mod+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "str_weapon"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.strength.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))+"+this.actor.system.abilities.strength.mod+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="(("+rollData.roll.dice+"/50*("+this.actor.system.abilities.strength.mod+")+"+this.actor.system.abilities.strength.mod+"+"+this.actor.system.abilities.strength.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "phys_ranged"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.perception.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))+"+this.actor.system.abilities.perception.mod+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.perception.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10))"+")+"+this.actor.system.abilities.perception.mod+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "magic_projectile"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.intelligence.mod+"*(9/10)"+"+"+this.actor.system.abilities.perception.mod+"*(3/10)))+"+this.actor.system.abilities.intelligence.mod+"+"+this.actor.system.abilities.perception.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/100*"+rollData.roll.abilitymod+")+"+rollData.roll.abilitymod+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "magic_melee"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.intelligence.mod+"*(9/10)"+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))+"+this.actor.system.abilities.intelligence.mod+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.intelligence.mod+"*(9/10)+"+"+"+this.actor.system.abilities.strength.mod+"*(3/10))"+")+"+this.actor.system.abilities.intelligence.mod+"+"+this.actor.system.abilities.strength.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "wisdom_dexterity"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.wisdom.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))+"+this.actor.system.abilities.wisdom.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.wisdom.mod+"*(9/10)+"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10))"+")+"+this.actor.system.abilities.wisdom.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else {
          rollData.formula="(((1d20/100*"+rollData.roll.abilitymod+")+"+rollData.roll.abilitymod+")*"+rollData.roll.diceBonus+")";
        }
        this.actor.system[rollData.roll.resource].value = this.actor.system[rollData.roll.resource].value - rollData.roll.cost;
        this.update();
        this.actor.sheet.render();
        // Invoke the roll and submit it to chat.
        const roll = new Roll(rollData.formula, rollData);
        // If you need to store the value first, uncomment the next line.
        const result = await roll.evaluate();
        roll.toMessage({
          speaker: speaker,
          rollMode: rollMode,
          flavor: label,
        });
        return roll;

       }
      }
    // Otherwise, create a roll and send a chat message from it.
    else {
      // Retrieve roll data.
      const rollData = this.getRollData();

      // console.log("Dice Value =", rollData.roll.dice);
      // console.log("Ability Mod Value:", rollData.roll.abilities);
      // console.log("Dice Bonus Value:", rollData.roll.diceBonus);
      // console.log("Testing:", this.actor);
      console.log("rollData value", rollData);
      rollData.roll.abilitymod=this.actor.system.abilities[rollData.roll.abilities].mod;
      rollData.roll.resourcevalue=this.actor.system[rollData.roll.resource].value;

      console.log("ability:", rollData.roll.abilitymod);
      console.log("resource type:", rollData.roll.resource);
      console.log("test resource type:", rollData.roll.resourcevalue);

      if (rollData.roll.resourcevalue >= rollData.roll.cost) {        
        if (rollData.roll.type == "dex_weapon"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.dexterity.mod+"*(9/10)"+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))+"+this.actor.system.abilities.dexterity.mod+"*(9/10)"+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.strength.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10))"+")+"+this.actor.system.abilities.strength.mod+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "str_weapon"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.strength.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))+"+this.actor.system.abilities.strength.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="(("+rollData.roll.dice+"/50*("+this.actor.system.abilities.strength.mod+")+"+this.actor.system.abilities.strength.mod+"+"+this.actor.system.abilities.strength.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "phys_ranged"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.perception.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))+"+this.actor.system.abilities.perception.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.perception.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10))"+")+"+this.actor.system.abilities.perception.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "magic_projectile"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.intelligence.mod+"*(9/10)"+"+"+this.actor.system.abilities.perception.mod+"*(3/10)))+"+this.actor.system.abilities.intelligence.mod+"*(9/10)"+"+"+this.actor.system.abilities.perception.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/100*"+rollData.roll.abilitymod+")+"+rollData.roll.abilitymod+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "magic_melee"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.intelligence.mod+"*(9/10)"+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))+"+this.actor.system.abilities.intelligence.mod+"*(9/10)"+"+"+this.actor.system.abilities.strength.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.intelligence.mod+"*(9/10)+"+"+"+this.actor.system.abilities.strength.mod+"*(3/10))"+")+"+this.actor.system.abilities.intelligence.mod+"*(9/10)"+"+"+this.actor.system.abilities.strength.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else if (rollData.roll.type == "wisdom_dexterity"){
          rollData.formula="((((d20/100)*("+this.actor.system.abilities.wisdom.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))+"+this.actor.system.abilities.wisdom.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)))";
          const roll = new Roll(rollData.formula, rollData);
          roll.toMessage({
            speaker: speaker,
            rollMode: rollMode,
            flavor: "To Hit",
          });
          rollData.formula="((("+rollData.roll.dice+"/50*("+this.actor.system.abilities.wisdom.mod+"*(9/10)+"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10))"+")+"+this.actor.system.abilities.wisdom.mod+"*(9/10)"+"+"+this.actor.system.abilities.dexterity.mod+"*(3/10)"+")*"+rollData.roll.diceBonus+")";
        }
        else 
          rollData.formula="((("+rollData.roll.dice+"/100*"+rollData.roll.abilitymod+")+"+rollData.roll.abilitymod+")*"+rollData.roll.diceBonus+")";

        this.actor.system[rollData.roll.resource].value = this.actor.system[rollData.roll.resource].value - rollData.roll.cost;
        this.update();
        this.actor.sheet.render();
        // Invoke the roll and submit it to chat.
        const roll = new Roll(rollData.formula, rollData);
        // If you need to store the value first, uncomment the next line.
        const result = await roll.evaluate();
        roll.toMessage({
          speaker: speaker,
          rollMode: rollMode,
          flavor: label,
        });
        return roll;
      }
      else
      ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: "Not enough "+rollData.roll.resource,
      })
    }
  }
}