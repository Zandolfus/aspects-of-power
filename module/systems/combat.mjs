// module/systems/combat.mjs

/**
 * Combat system implementing Aspects of Power formulas
 */
export class CombatSystem {
  
  /**
   * Initialize combat system
   */
  static initialize() {
    // Override initiative formula
    CONFIG.Combat.initiative = {
      formula: '1d20 * (@perception.mod / 100) + @perception.mod',
      decimals: 2
    };
    
    // Register combat hooks
    Hooks.on("preCreateChatMessage", this._onPreCreateChatMessage.bind(this));
    Hooks.on("renderChatMessage", this._onRenderChatMessage.bind(this));
  }

  /**
   * Roll initiative using game formula
   */
  static async rollInitiative(actor, options = {}) {
    const per = actor.system.abilities.perception;
    
    // Game formula: 1d20 × (Per_mod ÷ 100) + Per_mod
    const formula = `1d20 * (@per_mod / 100) + @per_mod`;
    const rollData = { 
      per_mod: per.mod,
      perception: per // For compatibility
    };
    
    const roll = new Roll(formula, rollData);
    await roll.evaluate();
    
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<h3>Initiative Roll</h3>`,
      content: `
        <div class="dice-roll">
          <div class="dice-result">
            <div class="dice-formula">${roll.formula}</div>
            <div class="dice-tooltip" style="display: none;">
              <div class="dice">
                <ol class="dice-rolls">
                  ${roll.terms.map(term => {
                    if (term.results) {
                      return `<li class="roll die d${term.faces}">${term.results[0].result}</li>`;
                    }
                    return '';
                  }).join('')}
                </ol>
              </div>
            </div>
            <h4 class="dice-total">${roll.total}</h4>
          </div>
        </div>
      `,
      sound: CONFIG.sounds.dice,
      rolls: [roll]
    };
    
    await ChatMessage.create(messageData);
    return roll;
  }

  /**
   * Roll attack using game formula
   */
  static async rollAttack(actor, weapon = null, options = {}) {
    const str = actor.system.abilities.strength;
    const dex = actor.system.abilities.dexterity;
    const combat = actor.system.combat || {};
    
    // Determine weapon type and bonuses
    let weaponType = 'standard';
    let weaponBonus = 0;
    let weaponName = 'Unarmed';
    
    if (weapon) {
      weaponType = weapon.system.weaponType || 'standard';
      weaponBonus = weapon.system.attack?.bonus || 0;
      weaponName = weapon.name;
    }
    
    // Game formula: round(((1d20 ÷ 100) × (dex + str×0.6) + dex + str×0.6) × 0.911)
    const baseValue = dex.value + str.value * 0.6;
    const formula = `round(((1d20 / 100) * ${baseValue} + ${baseValue}) * 0.911) + @combat_bonus + @weapon_bonus`;
    
    const rollData = { 
      combat_bonus: combat.toHitBonus || 0,
      weapon_bonus: weaponBonus,
      str_value: str.value,
      dex_value: dex.value,
      base_value: baseValue
    };
    
    const roll = new Roll(formula, rollData);
    await roll.evaluate();
    
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<h3>${weaponName} Attack</h3>`,
      content: await this._createAttackMessage(roll, actor, weapon, options),
      sound: CONFIG.sounds.dice,
      rolls: [roll],
      flags: {
        aspectsofpower: {
          type: 'attack',
          weapon: weapon?.id,
          actor: actor.id,
          weaponType: weaponType
        }
      }
    };
    
    const message = await ChatMessage.create(messageData);
    
    // Add damage button if attack succeeds
    if (options.showDamageButton !== false) {
      this._addDamageButton(message, actor, weapon);
    }
    
    return roll;
  }

  /**
   * Roll damage using game formulas
   */
  static async rollDamage(actor, weapon = null, options = {}) {
    const str = actor.system.abilities.strength;
    const dex = actor.system.abilities.dexterity;
    const combat = actor.system.combat || {};
    
    let damageType = 'standard';
    let weaponBonus = 0;
    let weaponName = 'Unarmed';
    let baseDamage = '2d6';
    
    if (weapon) {
      damageType = weapon.system.damage?.type || weapon.system.weaponType || 'standard';
      weaponBonus = weapon.system.damage?.bonus || 0;
      weaponName = weapon.name;
      baseDamage = weapon.system.damage?.formula || '2d6';
    }
    
    let formula;
    let rollData = { 
      combat_bonus: combat.damageBonus || 0,
      weapon_bonus: weaponBonus,
      str_mod: str.mod,
      dex_mod: dex.mod
    };
    
    if (damageType === 'finesse') {
      // Finesse: round(((2d6 ÷ 50) × (str_mod + dex_mod×0.25) + str_mod + dex_mod×0.25) × 0.6)
      const modTotal = str.mod + dex.mod * 0.25;
      formula = `round(((${baseDamage} / 50) * ${modTotal} + ${modTotal}) * 0.6) + @combat_bonus + @weapon_bonus`;
      rollData.mod_total = modTotal;
    } else {
      // Standard: round(((2d6 ÷ 50) × str_mod + str_mod) × 0.5)
      formula = `round(((${baseDamage} / 50) * @str_mod + @str_mod) * 0.5) + @combat_bonus + @weapon_bonus`;
    }
    
    // Handle critical hits
    if (options.critical) {
      formula = formula.replace(baseDamage, `${baseDamage} + ${baseDamage}`);
    }
    
    const roll = new Roll(formula, rollData);
    await roll.evaluate();
    
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<h3>${weaponName} Damage${options.critical ? ' (Critical!)' : ''}</h3>`,
      content: await this._createDamageMessage(roll, actor, weapon, damageType, options),
      sound: CONFIG.sounds.dice,
      rolls: [roll],
      flags: {
        aspectsofpower: {
          type: 'damage',
          weapon: weapon?.id,
          actor: actor.id,
          damageType: damageType,
          critical: options.critical || false
        }
      }
    };
    
    const message = await ChatMessage.create(messageData);
    
    // Add apply damage button
    this._addApplyDamageButton(message, roll.total);
    
    return roll;
  }

  /**
   * Apply damage to target with toughness reduction
   */
  static async applyDamage(target, damage, options = {}) {
    if (!target || target.type !== 'character') {
      ui.notifications.warn("Invalid target for damage application");
      return;
    }
    
    const drValue = target.system.defense?.dr?.value ?? 0;
    const reduction = options.ignoreToughness ? 0 : drValue;
    const finalDamage = Math.max(0, damage - reduction);
    
    const currentHealth = target.system.derived.health.value;
    const newHealth = Math.max(0, currentHealth - finalDamage);
    
    await target.update({
      'system.derived.health.value': newHealth
    });
    
    // Create damage application message
    const messageData = {
      speaker: ChatMessage.getSpeaker(),
      content: `
        <div class="damage-application">
          <h3>Damage Applied</h3>
          <p><strong>${target.name}</strong> takes <span class="damage-amount">${finalDamage}</span> damage!</p>
          ${reduction > 0 ? `<p><em>Reduced from ${damage} by ${reduction} toughness</em></p>` : ''}
          <p>Health: <span class="health-current">${newHealth}</span>/<span class="health-max">${target.system.derived.health.max}</span></p>
          ${newHealth === 0 ? '<p class="unconscious"><strong>Target is unconscious!</strong></p>' : ''}
        </div>
      `
    };
    
    await ChatMessage.create(messageData);
    
    return finalDamage;
  }

  /**
   * Roll defense against an attack
   */
  static async rollDefense(actor, options = {}) {
    const defense = actor.system.derived.defense;
    const dex = actor.system.abilities.dexterity;
    const str = actor.system.abilities.strength;
    
    // Defense is calculated as: round(dex_mod + str_mod × 0.3)
    const baseDefense = Math.round(dex.mod + str.mod * 0.3);
    
    // Add equipment bonuses (already calculated in derived.defense)
    const totalDefense = defense;
    
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<h3>Defense Roll</h3>`,
      content: `
        <div class="defense-roll">
          <h4>Defense Value: ${totalDefense}</h4>
          <p>Base Defense: ${baseDefense}</p>
          <p>Equipment Bonus: ${totalDefense - baseDefense}</p>
          <div class="defense-breakdown">
            <small>
              Dex Mod (${dex.mod}) + Str Mod × 0.3 (${Math.round(str.mod * 0.3)}) + Equipment
            </small>
          </div>
        </div>
      `
    };
    
    await ChatMessage.create(messageData);
    
    return totalDefense;
  }

  /**
   * Create attack message content
   */
  static async _createAttackMessage(roll, actor, weapon, options) {
    const str = actor.system.abilities.strength;
    const dex = actor.system.abilities.dexterity;
    const combat = actor.system.combat || {};
    
    return `
      <div class="dice-roll attack-roll">
        <div class="dice-result">
          <div class="dice-formula">${roll.formula}</div>
          <h4 class="dice-total">${roll.total}</h4>
        </div>
        <div class="attack-details">
          <p><strong>Attack Total:</strong> ${roll.total}</p>
          <div class="attack-breakdown">
            <p><em>Base: ${dex.value} + ${str.value} × 0.6 = ${dex.value + str.value * 0.6}</em></p>
            ${combat.toHitBonus ? `<p><em>Combat Bonus: +${combat.toHitBonus}</em></p>` : ''}
            ${weapon?.system.attack?.bonus ? `<p><em>Weapon Bonus: +${weapon.system.attack.bonus}</em></p>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create damage message content
   */
  static async _createDamageMessage(roll, actor, weapon, damageType, options) {
    const str = actor.system.abilities.strength;
    const dex = actor.system.abilities.dexterity;
    const combat = actor.system.combat || {};
    
    return `
      <div class="dice-roll damage-roll">
        <div class="dice-result">
          <div class="dice-formula">${roll.formula}</div>
          <h4 class="dice-total">${roll.total}</h4>
        </div>
        <div class="damage-details">
          <p><strong>Damage:</strong> ${roll.total} (${damageType})</p>
          <div class="damage-breakdown">
            ${damageType === 'finesse' ? 
              `<p><em>Finesse Formula: Str Mod (${str.mod}) + Dex Mod × 0.25 (${Math.round(dex.mod * 0.25)})</em></p>` :
              `<p><em>Standard Formula: Str Mod (${str.mod})</em></p>`
            }
            ${combat.damageBonus ? `<p><em>Combat Bonus: +${combat.damageBonus}</em></p>` : ''}
            ${weapon?.system.damage?.bonus ? `<p><em>Weapon Bonus: +${weapon.system.damage.bonus}</em></p>` : ''}
            ${options.critical ? `<p><em class="critical">Critical Hit!</em></p>` : ''}
          </div>
          <p><em>Remember: Final damage = Total - Target's Toughness Modifier</em></p>
        </div>
      </div>
    `;
  }

  /**
   * Add damage button to attack messages
   */
  static _addDamageButton(message, actor, weapon) {
    // This would be implemented with a hook to modify the chat message HTML
    // and add interactive buttons for rolling damage
  }

  /**
   * Add apply damage button to damage messages
   */
  static _addApplyDamageButton(message, damage) {
    // This would be implemented with a hook to modify the chat message HTML
    // and add interactive buttons for applying damage to targets
  }

  /**
   * Handle chat message creation for combat automation
   */
  static _onPreCreateChatMessage(message, data, options, userId) {
    // Add custom styling or processing for combat messages
  }

  /**
   * Handle chat message rendering for interactive buttons
   */
  static _onRenderChatMessage(message, html, data) {
    // Add click handlers for damage and apply damage buttons
    html.find('.roll-damage').click(async (event) => {
      const actorId = message.flags?.aspectsofpower?.actor;
      const weaponId = message.flags?.aspectsofpower?.weapon;
      
      if (actorId) {
        const actor = game.actors.get(actorId);
        const weapon = weaponId ? actor.items.get(weaponId) : null;
        await this.rollDamage(actor, weapon);
      }
    });
    
    html.find('.apply-damage').click(async (event) => {
      const damage = parseInt(event.currentTarget.dataset.damage);
      const targets = Array.from(game.user.targets);
      
      for (let token of targets) {
        await this.applyDamage(token.actor, damage);
      }
    });
  }

  /**
   * Quick combat actions for GMs
   */
  static async quickCombatRound(combatants, options = {}) {
    const results = [];
    
    for (let combatant of combatants) {
      const actor = combatant.actor;
      if (!actor) continue;
      
      // Roll initiative if not set
      if (!combatant.initiative) {
        const initRoll = await this.rollInitiative(actor);
        await combatant.update({ initiative: initRoll.total });
      }
      
      // Auto-attack if aggressive
      if (options.autoAttack && actor.type === 'npc') {
        const weapon = actor.items.find(i => i.type === 'weapon' && i.system.equipped?.value);
        await this.rollAttack(actor, weapon);