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
    const item     = this;
    const rollData = this.getRollData();
    const speaker  = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const label    = `[${item.type}] ${item.name}`;

    // No formula set → post description only (passive / display skill).
    if (!this.system.formula) {
      ChatMessage.create({
        speaker,
        rollMode,
        flavor: label,
        content: item.system.description ?? '',
      });
      return;
    }

    const A  = this.actor.system.abilities;
    const ab = A[rollData.roll.abilities]?.mod ?? 0;
    const db = rollData.roll.diceBonus;
    const dic = rollData.roll.dice || '0';
    const typ = rollData.roll.type;

    rollData.roll.abilitymod    = ab;
    rollData.roll.resourcevalue = this.actor.system[rollData.roll.resource]?.value ?? 0;

    // Not enough resource → warn and abort.
    if (rollData.roll.resourcevalue < rollData.roll.cost) {
      ChatMessage.create({
        speaker,
        rollMode,
        flavor: label,
        content: `Not enough ${rollData.roll.resource}`,
      });
      return;
    }

    // ── Build to-hit and damage formula strings for the skill type ──────────
    // Each named type uses the system's ability-weighted formulas.
    // hitFormula = null for the generic fallback (no to-hit roll).
    let hitFormula, dmgFormula;

    if (typ === 'dex_weapon') {
      const m = `${A.dexterity.mod}*(9/10)+${A.strength.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${A.strength.mod}*(9/10)+${A.dexterity.mod}*(3/10)))+${A.strength.mod}+${A.dexterity.mod}*(3/10))*${db})`;

    } else if (typ === 'str_weapon') {
      const m = `${A.strength.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `((${dic}/50*(${A.strength.mod})+${A.strength.mod}+${A.strength.mod}*(3/10))*${db})`;

    } else if (typ === 'phys_ranged') {
      const m = `${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10)))+${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10))*${db})`;

    } else if (typ === 'magic_projectile') {
      const m = `${A.intelligence.mod}*(9/10)+${A.perception.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;

    } else if (typ === 'magic_melee') {
      const m = `${A.intelligence.mod}*(9/10)+${A.strength.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${m}))+(${m}))*${db})`;

    } else if (typ === 'wisdom_dexterity') {
      const m = `${A.wisdom.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${m}))+(${m}))*${db})`;

    } else {
      // Generic fallback: no separate to-hit roll, just the damage formula.
      hitFormula = null;
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;
    }

    // ── Evaluate both rolls before sending any messages ──────────────────────
    const hitRoll = hitFormula ? new Roll(hitFormula, rollData) : null;
    if (hitRoll) await hitRoll.evaluate();

    const dmgRoll = new Roll(dmgFormula, rollData);
    await dmgRoll.evaluate();

    // ── Deduct resource cost ──────────────────────────────────────────────────
    const resource   = rollData.roll.resource;
    const newResVal  = Math.max(0, Math.round(rollData.roll.resourcevalue - rollData.roll.cost));
    await this.actor.update({ [`system.${resource}.value`]: newResVal });

    // ── Resolve against a target if one is selected ──────────────────────────
    const targetToken  = game.user.targets.first() ?? null;
    const targetActor  = targetToken?.actor ?? null;
    const targetDefKey = rollData.roll.targetDefense; // 'melee'|'ranged'|'mind'|'soul'|''

    if (targetActor && targetDefKey && hitRoll) {
      // Lookup the target's defense and compute final damage.
      const defenseValue = targetActor.system.defense[targetDefKey]?.value ?? 0;
      const isHit        = hitRoll.total >= defenseValue;
      const isPhysical   = rollData.roll.damageType === 'physical';
      const mitigation   = isPhysical
        ? (targetActor.system.defense.armor?.value ?? 0)
        : (targetActor.system.defense.veil?.value  ?? 0);
      const toughnessMod = targetActor.system.abilities?.toughness?.mod ?? 0;
      const finalDamage  = isHit ? Math.max(0, Math.round(dmgRoll.total - mitigation - toughnessMod)) : 0;
      const mitigLabel   = isPhysical ? 'Armor' : 'Veil';

      // Public message: damage roll only (players see damage, not the to-hit verdict).
      await dmgRoll.toMessage({ speaker, rollMode, flavor: `${label} — Damage` });

      // GM-only whisper — full combat resolution with apply-damage button.
      // No speaker so it does not appear to originate from the player.
      const resultBadge = isHit
        ? `<strong style="color:green;">HIT</strong>`
        : `<strong style="color:red;">MISS</strong>`;

      const gmContent = isHit
        ? `<div class="combat-result">
             <h3>${item.name} — ${resultBadge}</h3>
             <p>Attack: ${Math.round(hitRoll.total)} vs ${targetActor.name}'s ${targetDefKey} defense (${defenseValue})</p>
             <hr>
             <p>Raw damage: ${Math.round(dmgRoll.total)}</p>
             <p>${mitigLabel}: −${mitigation} &nbsp;&nbsp; Toughness: −${toughnessMod}</p>
             <p><strong>Final damage: ${finalDamage}</strong></p>
             <button class="apply-damage"
               data-actor-uuid="${targetActor.uuid}"
               data-damage="${finalDamage}"
               style="margin-top:6px;width:100%;">
               Apply ${finalDamage} to ${targetActor.name}
             </button>
           </div>`
        : `<div class="combat-result">
             <h3>${item.name} — ${resultBadge}</h3>
             <p>Attack: ${Math.round(hitRoll.total)} vs ${targetActor.name}'s ${targetDefKey} defense (${defenseValue})</p>
           </div>`;

      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: gmContent,
      });

    } else {
      // No target or no targetDefense configured — legacy two-message behavior.
      if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, flavor: 'To Hit' });
      await dmgRoll.toMessage({ speaker, rollMode, flavor: label });
    }

    return dmgRoll;
  }
}
