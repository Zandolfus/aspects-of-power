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
   * Route a payload to the GM for execution. If the current user IS the GM,
   * execute directly; otherwise send via socket.
   */
  async _gmAction(payload) {
    if (game.user.isGM) {
      await AspectsofPowerItem.executeGmAction(payload);
    } else {
      game.socket.emit('system.aspects-of-power', payload);
    }
  }

  /**
   * Execute a GM-routed action. Called directly by the GM or via socket handler.
   * @param {object} payload
   */
  static async executeGmAction(payload) {
    switch (payload.type) {

      case 'gmApplyRestoration': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const resource    = payload.resource ?? 'health';
        const pool        = target.system[resource];
        const newValue    = Math.min(pool.max, pool.value + payload.amount);
        const actualGain  = newValue - pool.value;
        await target.update({ [`system.${resource}.value`]: newValue });
        const resLabel = resource.charAt(0).toUpperCase() + resource.slice(1);
        ChatMessage.create({
          speaker: payload.speaker, rollMode: payload.rollMode,
          content: `<p><strong>${target.name}</strong> restores <strong>${actualGain}</strong> ${resLabel}. `
                 + `${resLabel}: ${newValue} / ${pool.max}</p>`,
        });
        break;
      }

      case 'gmApplyBuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const combat = game.combat;
        const startRound = combat?.round ?? 0;
        const startTurn  = combat?.turn ?? 0;
        const newTotal = payload.changes.reduce((sum, c) => sum + Number(c.value), 0);

        if (payload.stackable) {
          // Stackable: always create a new effect (like debuffs).
          await target.createEmbeddedDocuments('ActiveEffect', [{
            name:   payload.effectName,
            img:    payload.img,
            origin: payload.originUuid,
            'duration.rounds': payload.duration,
            'duration.startRound': startRound,
            'duration.startTurn': startTurn,
            disabled: false,
            changes: payload.changes,
          }]);
        } else {
          // Non-stackable: keep higher total.
          const existing = target.effects.find(
            e => e.origin === payload.originUuid && e.name === payload.effectName
          );

          if (existing) {
            if (existing.disabled) {
              await existing.update({
                disabled: false,
                changes: payload.changes,
                'duration.rounds': payload.duration,
                'duration.startRound': startRound,
                'duration.startTurn': startTurn,
              });
            } else {
              const currentTotal = (existing.changes ?? []).reduce((sum, c) => sum + Number(c.value), 0);
              if (newTotal > currentTotal) {
                await existing.update({
                  changes: payload.changes,
                  'duration.rounds': payload.duration,
                  'duration.startRound': startRound,
                  'duration.startTurn': startTurn,
                });
                ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
                  content: `<p>Buff on <strong>${target.name}</strong> upgraded (total +${newTotal}, was +${currentTotal}).</p>`,
                });
              } else {
                ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
                  content: `<p>Existing buff on <strong>${target.name}</strong> is stronger (+${currentTotal}). No change.</p>`,
                });
              }
              return;
            }
          } else {
            await target.createEmbeddedDocuments('ActiveEffect', [{
              name:   payload.effectName,
              img:    payload.img,
              origin: payload.originUuid,
              'duration.rounds': payload.duration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
              disabled: false,
              changes: payload.changes,
            }]);
          }
        }

        const summary = payload.changes.map(c => {
          const attr = c.key.replace('system.', '').replace('.value', '');
          return `${attr} +${c.value}`;
        }).join(', ');
        ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
          content: `<p><strong>${target.name}</strong> buffed: ${summary} for ${payload.duration} rounds.</p>`,
        });
        break;
      }

      case 'gmApplyDebuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;

        // Create the stacking ActiveEffect (set startRound for expiry tracking).
        if (payload.effectData) {
          const combat = game.combat;
          if (combat) {
            payload.effectData['duration.startRound'] = combat.round;
            payload.effectData['duration.startTurn'] = combat.turn;
          }
          await target.createEmbeddedDocuments('ActiveEffect', [payload.effectData]);
        }

        // Immediate DoT damage (bypasses armor/veil).
        if (payload.dotDamage > 0) {
          const health    = target.system.health;
          const newHealth = Math.max(0, health.value - payload.dotDamage);
          await target.update({ 'system.health.value': newHealth });
          ChatMessage.create({
            whisper: ChatMessage.getWhisperRecipients('GM'),
            content: `<p><strong>${target.name}</strong> takes <strong>${payload.dotDamage}</strong> `
                   + `${payload.dotDamageType} damage from ${payload.effectName} (ignores mitigation). `
                   + `Health: ${newHealth} / ${health.max}`
                   + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
          });
        }

        // Chat summary for stat changes.
        if (payload.statSummary) {
          ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
            content: `<p><strong>${target.name}</strong> debuffed: ${payload.statSummary} for ${payload.duration} rounds.</p>`,
          });
        }
        break;
      }
    }
  }

  /**
   * Restoration tag: restore health, mana, or stamina and route through GM.
   */
  async _handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const amount   = Math.round(dmgRoll.total);
    const target   = this.system.tagConfig?.restorationTarget ?? 'selected';
    const resource = this.system.tagConfig?.restorationResource ?? 'health';

    let targetActor;
    if (target === 'self') {
      targetActor = this.actor;
    } else {
      const targetToken = game.user.targets.first() ?? null;
      targetActor = targetToken?.actor ?? null;
    }

    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No valid restoration target.</em></p>` });
      return;
    }

    await this._gmAction({
      type: 'gmApplyRestoration',
      targetActorUuid: targetActor.uuid,
      amount,
      resource,
      speaker, rollMode,
    });
  }

  /**
   * Buff tag: build payload and route through GM.
   * Values are roll-based: rollTotal * entry.value (multiplier, default 1).
   */
  async _handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const targetToken = game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No target for buff.</em></p>` });
      return;
    }

    const entries  = this.system.tagConfig?.buffEntries ?? [];
    const duration = this.system.tagConfig?.buffDuration ?? 1;
    const rollTotal = Math.round(dmgRoll.total);

    if (entries.length === 0) return;

    const changes = entries.map(e => ({
      key:   `system.${e.attribute}.value`,
      mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
      value: Math.round(rollTotal * (e.value || 1)),
    }));

    await this._gmAction({
      type: 'gmApplyBuff',
      targetActorUuid: targetActor.uuid,
      effectName: `${item.name} (Buff)`,
      originUuid: this.uuid,
      changes,
      duration,
      stackable: this.system.tagConfig?.buffStackable ?? false,
      img: item.img ?? 'icons/svg/aura.svg',
      speaker, rollMode,
    });
  }

  /**
   * Debuff tag: build payload and route through GM.
   * Stat values are roll-based: rollTotal * entry.value (multiplier, default 1).
   * DoT damage = raw roll total, bypasses mitigation.
   */
  async _handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const targetToken = game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No target for debuff.</em></p>` });
      return;
    }

    const entries   = this.system.tagConfig?.debuffEntries ?? [];
    const duration  = this.system.tagConfig?.debuffDuration ?? 1;
    const dealsDmg  = this.system.tagConfig?.debuffDealsDamage ?? false;
    const dmgType   = this.system.tagConfig?.debuffDamageType ?? 'physical';
    const rollTotal = Math.round(dmgRoll.total);

    // Build stat-reduction changes (roll-based).
    const changes = entries.map(e => ({
      key:   `system.${e.attribute}.value`,
      mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
      value: -Math.round(rollTotal * (e.value || 1)),
    }));

    // Build effect data with optional DoT flags.
    const effectData = {
      name:   `${item.name} (Debuff)`,
      img:    item.img ?? 'icons/svg/downgrade.svg',
      origin: this.uuid,
      'duration.rounds': duration,
      disabled: false,
      changes,
    };

    if (dealsDmg) {
      effectData.flags = {
        'aspects-of-power': {
          dot: true,
          dotDamage: rollTotal,
          dotDamageType: dmgType,
          applierActorUuid: this.actor.uuid,
        },
      };
    }

    const statSummary = entries.length > 0
      ? entries.map(e => `${e.attribute} -${Math.round(rollTotal * (e.value || 1))}`).join(', ')
      : null;

    await this._gmAction({
      type: 'gmApplyDebuff',
      targetActorUuid: targetActor.uuid,
      effectName: `${item.name} (Debuff)`,
      effectData: (changes.length > 0 || dealsDmg) ? effectData : null,
      dotDamage: dealsDmg ? rollTotal : 0,
      dotDamageType: dmgType,
      duration,
      statSummary,
      speaker, rollMode,
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
        case 'restoration':
          await this._handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label);
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
