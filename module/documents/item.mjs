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

  /* ------------------------------------------------------------------ */
  /*  Formula helpers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Build to-hit and damage formula strings from the skill's roll config.
   * @param {object} rollData  The roll data object from getRollData().
   * @returns {{ hitFormula: string|null, dmgFormula: string }}
   */
  _buildRollFormulas(rollData) {
    const A   = this.actor.system.abilities;
    const ab  = A[rollData.roll.abilities]?.mod ?? 0;
    const db  = rollData.roll.diceBonus;
    const dic = rollData.roll.dice || '0';
    const typ = rollData.roll.type;

    rollData.roll.abilitymod    = ab;
    rollData.roll.resourcevalue = this.actor.system[rollData.roll.resource]?.value ?? 0;

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

    return { hitFormula, dmgFormula };
  }

  /* ------------------------------------------------------------------ */
  /*  Tag handlers                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Attack tag: resolve hit vs target defense, calculate mitigated damage,
   * and post a GM-whispered combat result with an Apply Damage button.
   */
  async _handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label) {
    const targetToken  = game.user.targets.first() ?? null;
    const targetActor  = targetToken?.actor ?? null;
    const targetDefKey = rollData.roll.targetDefense;

    if (!targetActor || !targetDefKey || !hitRoll) return;

    const defenseValue = targetActor.system.defense[targetDefKey]?.value ?? 0;
    const isHit        = hitRoll.total >= defenseValue;
    const isPhysical   = rollData.roll.damageType === 'physical';
    const mitigation   = isPhysical
      ? (targetActor.system.defense.armor?.value ?? 0)
      : (targetActor.system.defense.veil?.value  ?? 0);
    const toughnessMod = targetActor.system.abilities?.toughness?.mod ?? 0;
    const finalDamage  = isHit ? Math.max(0, Math.round(dmgRoll.total - mitigation - toughnessMod)) : 0;
    const mitigLabel   = isPhysical ? 'Armor' : 'Veil';

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

    if (game.user.isGM) {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: gmContent,
      });
    } else {
      game.socket.emit('system.aspects-of-power', { type: 'gmCombatResult', content: gmContent });
    }
  }

  /**
   * Heal tag: apply the roll total as healing to the target.
   */
  async _handleHealTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const healAmount  = Math.round(dmgRoll.total);
    const healTarget  = this.system.tagConfig?.healTarget ?? 'selected';

    let targetActor;
    if (healTarget === 'self') {
      targetActor = this.actor;
    } else {
      const targetToken = game.user.targets.first() ?? null;
      targetActor = targetToken?.actor ?? null;
    }

    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No valid heal target.</em></p>` });
      return;
    }

    const health     = targetActor.system.health;
    const newHealth  = Math.min(health.max, health.value + healAmount);
    const actualHeal = newHealth - health.value;
    await targetActor.update({ 'system.health.value': newHealth });

    ChatMessage.create({
      speaker, rollMode,
      content: `<p><strong>${targetActor.name}</strong> heals for <strong>${actualHeal}</strong>. `
             + `Health: ${newHealth} / ${health.max}</p>`,
    });
  }

  /**
   * Buff tag: create or update an ActiveEffect on the target.
   * If the effect already exists and is active, keep the higher value (no stacking).
   */
  async _handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const targetToken = game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No target for buff.</em></p>` });
      return;
    }

    const buffValue  = Math.round(dmgRoll.total);
    const attribute  = this.system.tagConfig?.buffAttribute ?? 'abilities.strength';
    const duration   = this.system.tagConfig?.buffDuration ?? 1;
    const effectName = `${item.name} (Buff)`;
    const originUuid = this.uuid;

    const existing = targetActor.effects.find(e => e.origin === originUuid && e.name === effectName);

    if (existing) {
      if (existing.disabled) {
        // Re-enable and update the value.
        const changes = [{
          key:   `system.${attribute}.value`,
          mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
          value: buffValue,
        }];
        await existing.update({ disabled: false, changes, 'duration.rounds': duration });
      } else {
        // Already active — keep the higher value.
        const currentValue = Number(existing.changes?.[0]?.value) || 0;
        if (buffValue > currentValue) {
          const changes = [{
            key:   `system.${attribute}.value`,
            mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
            value: buffValue,
          }];
          await existing.update({ changes, 'duration.rounds': duration });
          ChatMessage.create({ speaker, rollMode,
            content: `<p>Buff on <strong>${targetActor.name}</strong> upgraded: ${attribute} +${buffValue} (was +${currentValue})</p>`,
          });
        } else {
          ChatMessage.create({ speaker, rollMode,
            content: `<p>Existing buff on <strong>${targetActor.name}</strong> is stronger (+${currentValue}). No change.</p>`,
          });
        }
        return;
      }
    } else {
      // Create new effect.
      await targetActor.createEmbeddedDocuments('ActiveEffect', [{
        name:   effectName,
        img:    item.img ?? 'icons/svg/aura.svg',
        origin: originUuid,
        'duration.rounds': duration,
        disabled: false,
        changes: [{
          key:   `system.${attribute}.value`,
          mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
          value: buffValue,
        }],
      }]);
    }

    ChatMessage.create({ speaker, rollMode,
      content: `<p><strong>${targetActor.name}</strong> buffed: ${attribute} +${buffValue} for ${duration} rounds.</p>`,
    });
  }

  /**
   * Debuff tag: always creates a new stacking ActiveEffect on the target.
   */
  async _handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const targetToken = game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No target for debuff.</em></p>` });
      return;
    }

    const debuffValue = Math.round(dmgRoll.total);
    const attribute   = this.system.tagConfig?.debuffAttribute ?? 'abilities.strength';
    const duration    = this.system.tagConfig?.debuffDuration ?? 1;
    const effectName  = `${item.name} (Debuff)`;

    await targetActor.createEmbeddedDocuments('ActiveEffect', [{
      name:   effectName,
      img:    item.img ?? 'icons/svg/downgrade.svg',
      origin: this.uuid,
      'duration.rounds': duration,
      disabled: false,
      changes: [{
        key:   `system.${attribute}.value`,
        mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
        value: -debuffValue,
      }],
    }]);

    ChatMessage.create({ speaker, rollMode,
      content: `<p><strong>${targetActor.name}</strong> debuffed: ${attribute} -${debuffValue} for ${duration} rounds.</p>`,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Main roll dispatcher                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Handle clickable rolls. Evaluates the shared formula once, then dispatches
   * to per-tag handlers based on the skill's tags array.
   * @private
   */
  async roll() {
    const item     = this;
    const rollData = this.getRollData();
    const speaker  = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const label    = `[${item.type}] ${item.name}`;
    const tags     = this.system.tags ?? [];

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

    // Build formulas (also populates rollData.roll.abilitymod and resourcevalue).
    const { hitFormula, dmgFormula } = this._buildRollFormulas(rollData);

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

    // ── Evaluate both rolls (shared across all tags) ────────────────────
    const hitRoll = hitFormula ? new Roll(hitFormula, rollData) : null;
    if (hitRoll) await hitRoll.evaluate();

    const dmgRoll = new Roll(dmgFormula, rollData);
    await dmgRoll.evaluate();

    // ── Deduct resource cost ────────────────────────────────────────────
    const resource  = rollData.roll.resource;
    const newResVal = Math.max(0, Math.round(rollData.roll.resourcevalue - rollData.roll.cost));
    await this.actor.update({ [`system.${resource}.value`]: newResVal });

    // ── Legacy behavior for tagless skills ──────────────────────────────
    if (tags.length === 0) {
      // Backwards-compatible: same two-message output as before tags existed.
      const targetToken  = game.user.targets.first() ?? null;
      const targetActor  = targetToken?.actor ?? null;
      const targetDefKey = rollData.roll.targetDefense;

      if (targetActor && targetDefKey && hitRoll) {
        // Full attack resolution (identical to old code).
        await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label);
        await hitRoll.toMessage({ speaker, rollMode, flavor: `${label} — Attack` });
        await dmgRoll.toMessage({ speaker, rollMode, flavor: `${label} — Damage` });
      } else {
        if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, flavor: 'To Hit' });
        await dmgRoll.toMessage({ speaker, rollMode, flavor: label });
      }
      return dmgRoll;
    }

    // ── Post roll results to chat once (shared) ─────────────────────────
    if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, flavor: `${label} — To Hit` });
    await dmgRoll.toMessage({ speaker, rollMode, flavor: `${label} — Roll` });

    // ── Dispatch to each tag handler ────────────────────────────────────
    for (const tag of tags) {
      switch (tag) {
        case 'attack':
          await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label);
          break;
        case 'heal':
          await this._handleHealTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'buff':
          await this._handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'debuff':
          await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
      }
    }

    return dmgRoll;
  }
}
