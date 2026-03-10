import { EquipmentSystem } from '../systems/equipment.mjs';
import { getPositionalTags } from '../helpers/positioning.mjs';

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
  /**
   * Prompt the user for how much mana to spend on a barrier skill.
   * @param {number} maxMana  Current mana available.
   * @returns {Promise<number|null>}  Chosen mana amount, or null if cancelled.
   */
  async _promptBarrierManaCost(maxMana) {
    const multiplier = this.system.tagConfig?.barrierMultiplier ?? 1;
    return new Promise(resolve => {
      let resolved = false;
      new foundry.applications.api.DialogV2({
        window: { title: 'Barrier — Mana Cost' },
        content: `<div class="form-group">
            <label>Mana to spend (max ${maxMana}):</label>
            <input type="number" name="manaCost" value="${maxMana}" min="1" max="${maxMana}" autofocus />
          </div>
          <p class="hint">Barrier HP = Mana &times; ${multiplier}</p>`,
        buttons: [
          {
            action: 'confirm',
            label: 'Create Barrier',
            default: true,
            callback: (event, button) => {
              resolved = true;
              const val = parseInt(button.form.elements.manaCost?.value, 10);
              resolve(Math.min(Math.max(1, val || 0), maxMana));
            },
          },
          {
            action: 'cancel',
            label: 'Cancel',
            callback: () => { resolved = true; resolve(null); },
          },
        ],
        close: () => { if (!resolved) resolve(null); },
      }).render(true);
    });
  }

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
  async _handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const targetToken  = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor  = targetToken?.actor ?? null;
    if (!targetActor) return;

    const targetDefKey = rollData.roll.targetDefense;
    const defenseValue = targetDefKey ? (targetActor.system.defense[targetDefKey]?.value ?? 0) : 0;
    const isHit        = hitRoll ? hitRoll.total >= defenseValue : true;
    const isPhysical   = rollData.roll.damageType === 'physical';
    const mitigation   = isPhysical
      ? (targetActor.system.defense.armor?.value ?? 0)
      : (targetActor.system.defense.veil?.value  ?? 0);
    const attackerToken     = this.actor.getActiveTokens()[0] ?? null;
    const toughnessMod      = targetActor.system.abilities?.toughness?.mod ?? 0;
    const affinityDR        = this._getAffinityDRReduction(targetActor, attackerToken, targetToken);
    const effectiveToughness = Math.max(0, toughnessMod - affinityDR);
    const finalDamage        = isHit ? Math.max(0, Math.round(dmgRoll.total - mitigation - effectiveToughness)) : 0;
    const mitigLabel         = isPhysical ? 'Armor' : 'Veil';

    const resultBadge = isHit
      ? `<strong style="color:green;">HIT</strong>`
      : `<strong style="color:red;">MISS</strong>`;

    const hitLine = hitRoll && targetDefKey
      ? `<p>Attack: ${Math.round(hitRoll.total)} vs ${targetActor.name}'s ${targetDefKey} defense (${defenseValue})</p>`
      : '';

    const gmContent = isHit
      ? `<div class="combat-result">
           <h3>${item.name} — ${resultBadge}</h3>
           ${hitLine}
           <hr>
           <p>Raw damage: ${Math.round(dmgRoll.total)}</p>
           <p>${mitigLabel}: −${mitigation} &nbsp;&nbsp; Toughness: −${effectiveToughness}${affinityDR > 0 ? ` <em>(−${affinityDR} affinity)</em>` : ''}</p>
           <p><strong>Final damage: ${finalDamage}</strong></p>
           <button class="apply-damage"
             data-actor-uuid="${targetActor.uuid}"
             data-damage="${finalDamage}"
             data-damage-type="${isPhysical ? 'physical' : 'magical'}"
             style="margin-top:6px;width:100%;">
             Apply ${finalDamage} to ${targetActor.name}
           </button>
         </div>`
      : `<div class="combat-result">
           <h3>${item.name} — ${resultBadge}</h3>
           ${hitLine}
         </div>`;

    if (game.user.isGM) {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: gmContent,
      });
    } else {
      game.socket.emit('system.aspects-of-power', { type: 'gmCombatResult', content: gmContent });
    }

    // Barrier fully absorbs → flag so debuff/DoT can be skipped.
    const barrierValue = targetActor.system.barrier?.value ?? 0;
    const fullyBlocked = isHit && finalDamage > 0 && barrierValue >= finalDamage;
    return { isHit, fullyBlocked };
  }

  /**
   * Compute total toughness DR reduction from debuffs on the target that
   * share an affinity or magic type with this skill.
   *
   * Directional debuffs (directions.length > 0) only apply when the attacker
   * is currently in one of those positions relative to the target.
   * Non-directional debuffs (directions: []) always apply when affinity matches.
   *
   * @param {Actor} targetActor
   * @param {Token|null} attackerToken  The attacker's canvas token.
   * @param {Token|null} targetToken    The target's canvas token.
   * @returns {number}
   */
  _getAffinityDRReduction(targetActor, attackerToken = null, targetToken = null) {
    const skillAffinities = this.system.affinities ?? [];
    const skillMagicType  = this.system.magicType ?? '';
    if (!skillAffinities.length && !skillMagicType) return 0;

    const currentPositions = (attackerToken && targetToken)
      ? getPositionalTags(attackerToken, targetToken)
      : [];

    let total = 0;
    for (const effect of targetActor.allApplicableEffects()) {
      const flags = effect.flags?.['aspects-of-power'] ?? {};
      if (!flags.debuffDamage) continue;

      const effectAffinities = flags.affinities ?? [];
      const effectMagicType  = flags.magicType ?? '';
      const effectDirections = flags.directions ?? [];  // [] = non-directional

      const sharesAffinity  = skillAffinities.some(a => effectAffinities.includes(a));
      const sharesMagicType = skillMagicType && skillMagicType === effectMagicType;
      if (!(sharesAffinity || sharesMagicType)) continue;

      // Directional constraint: if the debuff recorded specific directions, the
      // attacker must currently be in one of those positions.
      if (effectDirections.length > 0 && !currentPositions.some(p => effectDirections.includes(p))) continue;

      total += flags.debuffDamage;
    }
    return total;
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
        const resLabel    = resource.charAt(0).toUpperCase() + resource.slice(1);

        // Health restoration overflows into overhealth.
        if (resource === 'health') {
          const newHealth   = Math.min(pool.max, pool.value + payload.amount);
          const healthGain  = newHealth - pool.value;
          const excess      = payload.amount - healthGain;
          const updateData  = { 'system.health.value': newHealth };
          let ohGain = 0;

          if (excess > 0) {
            const oh       = target.system.overhealth;
            const ohCap    = oh.cap ?? (pool.max * 2);
            const newOh    = Math.min(ohCap, oh.value + excess);
            ohGain         = newOh - oh.value;
            updateData['system.overhealth.value'] = newOh;
          }

          await target.update(updateData);
          const ohNote = ohGain > 0 ? ` (+${ohGain} overhealth)` : '';
          ChatMessage.create({
            speaker: payload.speaker, rollMode: payload.rollMode,
            content: `<p><strong>${target.name}</strong> restores <strong>${healthGain}</strong> ${resLabel}${ohNote}. `
                   + `${resLabel}: ${newHealth} / ${pool.max}</p>`,
          });
        } else if (resource === 'barrier') {
          // Barrier creation: roll total sets both value and max (the mana pool).
          const barrierValue = payload.amount;
          const affinities   = payload.barrierAffinities ?? [];
          const source       = payload.barrierSource ?? '';
          const existing     = target.system.barrier;

          await target.update({
            'system.barrier.value':      barrierValue,
            'system.barrier.max':        barrierValue,
            'system.barrier.affinities': affinities,
            'system.barrier.source':     source,
          });

          const affText = affinities.length > 0 ? ` (${affinities.join(', ')})` : '';
          const replaced = existing.max > 0 ? ' (replaced existing barrier)' : '';
          ChatMessage.create({
            speaker: payload.speaker, rollMode: payload.rollMode,
            content: `<p><strong>${target.name}</strong> gains a <strong>${barrierValue}</strong> point barrier${affText}${replaced}.</p>`,
          });
        } else {
          const newValue    = Math.min(pool.max, pool.value + payload.amount);
          const actualGain  = newValue - pool.value;
          await target.update({ [`system.${resource}.value`]: newValue });
          ChatMessage.create({
            speaker: payload.speaker, rollMode: payload.rollMode,
            content: `<p><strong>${target.name}</strong> restores <strong>${actualGain}</strong> ${resLabel}. `
                   + `${resLabel}: ${newValue} / ${pool.max}</p>`,
          });
        }
        break;
      }

      case 'gmApplyBuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const combat = game.combat;
        const startRound = combat?.round ?? 0;
        const startTurn  = combat?.turn ?? 0;

        const existing = target.effects.find(
          e => e.origin === payload.originUuid && e.name === payload.effectName
        );

        if (existing && !existing.disabled) {
          if (payload.stackable) {
            // Stackable: merge new values into the existing effect's changes.
            const merged = [...(existing.changes ?? [])].map(c => ({ ...c }));
            for (const incoming of payload.changes) {
              const match = merged.find(m => m.key === incoming.key && m.mode === incoming.mode);
              if (match) {
                match.value = Number(match.value) + Number(incoming.value);
              } else {
                merged.push({ ...incoming });
              }
            }
            // Duration becomes the maximum of what's remaining vs. the new application.
            const existingRemaining = ((existing.duration?.startRound ?? 0) + (existing.duration?.rounds ?? 0)) - startRound;
            const newDuration = Math.max(existingRemaining, payload.duration);
            await existing.update({
              changes: merged,
              'duration.rounds': newDuration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            });
            const mergedTotal = merged.reduce((sum, c) => sum + Number(c.value), 0);
            ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
              content: `<p>Buff on <strong>${target.name}</strong> stacked (total +${mergedTotal}) for ${newDuration} rounds.</p>`,
            });
          } else {
            // Non-stackable: keep higher total.
            const newTotal = payload.changes.reduce((sum, c) => sum + Number(c.value), 0);
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
          }
        } else {
          // No existing active effect (or disabled) — create new.
          if (existing?.disabled) {
            await existing.update({
              disabled: false,
              changes: payload.changes,
              'duration.rounds': payload.duration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            });
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
          const summary = payload.changes.map(c => {
            const attr = c.key.replace('system.', '').replace('.value', '');
            return `${attr} +${c.value}`;
          }).join(', ');
          ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
            content: `<p><strong>${target.name}</strong> buffed: ${summary} for ${payload.duration} rounds.</p>`,
          });
        }
        break;
      }

      case 'gmApplyRepair': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const materials = payload.materials ?? [];
        const restored = await EquipmentSystem.repairAllEquipped(target, payload.amount, materials);
        const matLabel = materials.length > 0
          ? materials.map(m => game.i18n.localize(CONFIG.ASPECTSOFPOWER.materialTypes[m] ?? m)).join(', ')
          : 'all';
        ChatMessage.create({
          speaker: payload.speaker, rollMode: payload.rollMode,
          content: `<p><strong>${payload.skillName}</strong> repairs <strong>${target.name}</strong>'s ${matLabel} equipment `
                 + `(+${restored} durability distributed across matching gear).</p>`,
        });
        break;
      }

      case 'gmApplyDebuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const combat = game.combat;
        const startRound = combat?.round ?? 0;
        const startTurn  = combat?.turn ?? 0;

        // Stackable debuffs: merge into existing effect with same origin + name.
        if (payload.effectData) {
          const existing = payload.stackable
            ? target.effects.find(e => e.origin === payload.originUuid && e.name === payload.effectName && !e.disabled)
            : null;

          if (existing) {
            // Merge stat changes: add incoming values to matching keys.
            const merged = [...(existing.changes ?? [])].map(c => ({ ...c }));
            for (const incoming of (payload.effectData.changes ?? [])) {
              const match = merged.find(m => m.key === incoming.key && m.mode === incoming.mode);
              if (match) {
                match.value = Number(match.value) + Number(incoming.value);
              } else {
                merged.push({ ...incoming });
              }
            }

            // Duration becomes the maximum of what's remaining vs. the new application.
            const existingRemaining = ((existing.duration?.startRound ?? 0) + (existing.duration?.rounds ?? 0)) - startRound;
            const newDuration = Math.max(existingRemaining, payload.duration);

            // Merge DoT flags: add incoming damage to existing.
            const updateData = {
              changes: merged,
              'duration.rounds': newDuration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            };
            if (payload.effectData.flags?.['aspects-of-power']?.dot) {
              const existingAopFlags = existing.flags?.['aspects-of-power'] ?? {};
              const existingDot = existingAopFlags.dotDamage ?? 0;
              const incomingDot = payload.effectData.flags['aspects-of-power'].dotDamage ?? 0;
              const newTotalDot = existingDot + incomingDot;
              const dotType     = payload.effectData.flags['aspects-of-power'].dotDamageType;
              // Use a full nested flags object to avoid dot-notation issues with
              // hyphenated namespace keys (aspects-of-power) in Foundry's expandObject.
              updateData.flags = {
                'aspects-of-power': {
                  ...existingAopFlags,
                  dot:              true,
                  dotDamage:        newTotalDot,
                  debuffDamage:     newTotalDot,
                  dotDamageType:    dotType,
                  applierActorUuid: payload.effectData.flags['aspects-of-power'].applierActorUuid,
                },
              };
              updateData.description = `Deals <strong>${newTotalDot}</strong> ${dotType} damage per round (bypasses armor &amp; veil; reduced by Toughness).`;
            }

            await existing.update(updateData);
            const mergedTotal = merged.reduce((sum, c) => sum + Math.abs(Number(c.value)), 0);
            ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
              content: `<p>Debuff on <strong>${target.name}</strong> stacked (total -${mergedTotal}) for ${newDuration} rounds.</p>`,
            });
          } else {
            // No existing — create new effect.
            payload.effectData['duration.startRound'] = startRound;
            payload.effectData['duration.startTurn'] = startTurn;
            await target.createEmbeddedDocuments('ActiveEffect', [payload.effectData]);

            if (payload.statSummary) {
              ChatMessage.create({ speaker: payload.speaker, rollMode: payload.rollMode,
                content: `<p><strong>${target.name}</strong> debuffed: ${payload.statSummary} for ${payload.duration} rounds.</p>`,
              });
            }
          }
        }

        // Immediate DoT damage (bypasses armor/veil AND barrier, but not toughness).
        // Pre-existing wounds bypass barriers — routes through: Overhealth → HP.
        if (payload.dotDamage > 0) {
          const toughnessMod = target.system.abilities?.toughness?.mod ?? 0;
          let remaining = Math.max(0, payload.dotDamage - toughnessMod);
          const updateData = {};
          const parts = [];

          // Overhealth absorbs first (DoTs bypass barrier).
          const overhealth = target.system.overhealth;
          if (remaining > 0 && overhealth.value > 0) {
            const absorbed = Math.min(overhealth.value, remaining);
            remaining -= absorbed;
            updateData['system.overhealth.value'] = overhealth.value - absorbed;
            parts.push(`Overhealth: −${absorbed}`);
          }

          // Remaining hits HP.
          const health = target.system.health;
          const newHealth = Math.max(0, health.value - remaining);
          updateData['system.health.value'] = newHealth;
          if (remaining > 0) parts.push(`Health: −${remaining}`);

          await target.update(updateData);

          const mitigated = Math.max(0, payload.dotDamage - toughnessMod);
          const breakdown = parts.length ? ` (${parts.join(', ')})` : '';
          ChatMessage.create({
            whisper: ChatMessage.getWhisperRecipients('GM'),
            content: `<p><strong>${target.name}</strong> takes <strong>${mitigated}</strong> `
                   + `${payload.dotDamageType} damage from ${payload.effectName} (Toughness: −${toughnessMod})${breakdown}. `
                   + `Health: ${newHealth} / ${health.max}`
                   + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
          });
        }
        break;
      }
    }
  }

  /**
   * Restoration tag: restore health, mana, or stamina and route through GM.
   */
  async _handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    let amount     = Math.round(dmgRoll.total);
    const target   = this.system.tagConfig?.restorationTarget ?? 'selected';
    const resource = this.system.tagConfig?.restorationResource ?? 'health';

    // Barrier: value comes from variable mana cost × multiplier, not roll total.
    if (resource === 'barrier') {
      const multiplier = this.system.tagConfig?.barrierMultiplier ?? 1;
      amount = Math.round((rollData.roll.variableManaCost ?? amount) * multiplier);
    }

    let targetActor;
    if (target === 'self' && !targetTokenOverride) {
      targetActor = this.actor;
    } else {
      const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
      targetActor = targetToken?.actor ?? null;
    }

    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No valid restoration target.</em></p>` });
      return;
    }

    const actionPayload = {
      type: 'gmApplyRestoration',
      targetActorUuid: targetActor.uuid,
      amount,
      resource,
      speaker, rollMode,
    };

    // Barrier creation passes affinities and source name.
    if (resource === 'barrier') {
      actionPayload.barrierAffinities = this.system.affinities ?? [];
      actionPayload.barrierSource = this.name;
    }

    await this._gmAction(actionPayload);
  }

  /**
   * Buff tag: build payload and route through GM.
   * Values are roll-based: rollTotal * entry.value (multiplier, default 1).
   */
  async _handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
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
  async _handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
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
    const effectName = `${item.name} (Debuff)`;
    const effectData = {
      name:        effectName,
      img:         item.img ?? 'icons/svg/downgrade.svg',
      origin:      this.uuid,
      'duration.rounds': duration,
      disabled:    false,
      changes,
      description: dealsDmg
        ? `Deals <strong>${rollTotal}</strong> ${dmgType} damage per round (bypasses armor &amp; veil; reduced by Toughness).`
        : '',
    };

    // Capture positional tags for all debuffs so DR is direction-gated by default.
    // 'debuffDirectional' now acts as an "Omnidirectional DR" opt-out:
    // when set, directions is empty and the DR applies regardless of angle.
    const isOmnidirectional = this.system.tagConfig?.debuffDirectional ?? false;
    const casterToken       = isOmnidirectional ? null : (this.actor.getActiveTokens()[0] ?? null);
    const directions        = (!isOmnidirectional && casterToken && targetToken)
      ? getPositionalTags(casterToken, targetToken)
      : [];

    // Always store affinity metadata so attack skills can match against this debuff.
    effectData.flags = {
      'aspects-of-power': {
        debuffDamage: rollTotal,
        affinities: this.system.affinities ?? [],
        magicType: this.system.magicType ?? 'non-magical',
        directions,
        ...(dealsDmg ? { dot: true, dotDamage: rollTotal, dotDamageType: dmgType, applierActorUuid: this.actor.uuid } : {}),
      },
    };

    const statSummary = entries.length > 0
      ? entries.map(e => `${e.attribute} -${Math.round(rollTotal * (e.value || 1))}`).join(', ')
      : null;

    await this._gmAction({
      type: 'gmApplyDebuff',
      targetActorUuid: targetActor.uuid,
      effectName,
      originUuid: this.uuid,
      stackable: this.system.tagConfig?.debuffStackable ?? false,
      effectData: (changes.length > 0 || dealsDmg) ? effectData : null,
      dotDamage: dealsDmg ? rollTotal : 0,
      dotDamageType: dmgType,
      duration,
      statSummary,
      speaker, rollMode,
    });
  }

  /**
   * Repair tag: distribute repair amount across a target's equipped gear.
   * Targets the selected token (or self if no target). Routes through GM.
   */
  async _handleRepairTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const amount = Math.round(dmgRoll.total);

    let targetActor;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    targetActor = targetToken?.actor ?? null;

    // Fall back to self if no target selected.
    if (!targetActor && !targetTokenOverride) {
      targetActor = this.actor;
    }

    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>No valid repair target.</em></p>` });
      return;
    }

    await this._gmAction({
      type: 'gmApplyRepair',
      targetActorUuid: targetActor.uuid,
      amount,
      materials: this.system.tagConfig?.repairMaterials ?? [],
      skillName: item.name,
      speaker, rollMode,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  AOE helpers                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Determine the template fill color based on the skill's tags.
   * Attack/debuff → red, restoration/buff → green, fallback → blue.
   */
  _getAoeColor() {
    const tags = this.system.tags ?? [];
    if (tags.includes('attack') || tags.includes('debuff')) return '#ff4444';
    if (tags.includes('restoration') || tags.includes('buff') || tags.includes('repair')) return '#44ff44';
    return '#4488ff';
  }

  /**
   * Interactively place a MeasuredTemplate for an AOE skill.
   * Supports circle, cone, ray, and rectangle shapes.
   *
   * Circle/Rect: preview follows cursor, click to place center.
   * Cone/Ray: origin locked to caster, mouse aims direction, click to confirm.
   *
   * Rect uses Foundry's native rect type: distance = diagonal of the square
   * (Math.hypot(size, size)), direction = 45° for grid alignment. Origin is
   * the top-left corner, offset so the click is the center.
   *
   * @param {Token} casterToken  The caster's canvas token.
   * @returns {Promise<MeasuredTemplateDocument|null>}
   */
  async _placeAoeTemplate(casterToken) {
    const aoe = this.system.aoe;
    const shape = aoe.shape ?? 'circle';
    const castingRange = this.actor.system.castingRange ?? 0;
    const pixelsPerFoot = canvas.grid.size / canvas.grid.distance;
    const castingRangePx = castingRange * pixelsPerFoot;
    const fillColor = this._getAoeColor();
    const cc = casterToken.center;

    // Cone/Ray originate from the caster — validate reach vs casting range up front.
    const isDirected = (shape === 'cone' || shape === 'ray');
    if (isDirected && aoe.diameter > castingRange) {
      ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.AOE.outOfRange'));
      return null;
    }

    // Rect centering: origin is a corner, so offset by half the side length.
    const rectSidePx = aoe.diameter * pixelsPerFoot;
    const rectHalfPx = rectSidePx / 2;

    // Build shape-specific preview template data.
    let previewData;
    if (shape === 'circle') {
      previewData = { t: 'circle', distance: aoe.diameter / 2, x: 0, y: 0, fillColor };
    } else if (shape === 'cone') {
      previewData = { t: 'cone', distance: aoe.diameter, angle: aoe.angle, direction: 0, x: cc.x, y: cc.y, fillColor };
    } else if (shape === 'ray') {
      previewData = { t: 'ray', distance: aoe.diameter, width: aoe.width, direction: 0, x: cc.x, y: cc.y, fillColor };
    } else {
      // rect: Foundry rect = square. distance = diagonal, direction = 45° for grid alignment.
      previewData = { t: 'rect', distance: Math.hypot(aoe.diameter, aoe.diameter), direction: 45, x: 0, y: 0, fillColor };
    }

    const templateDoc = new MeasuredTemplateDocument(previewData, { parent: canvas.scene });
    const template = new CONFIG.MeasuredTemplate.objectClass(templateDoc);
    template.draw();
    template.layer.activate();
    template.layer.preview.addChild(template);

    let resolved = false;

    return new Promise((resolve) => {
      const onPointerMove = (event) => {
        const pos = event.data?.getLocalPosition(canvas.app.stage)
                    ?? canvas.mousePosition ?? { x: 0, y: 0 };

        if (isDirected) {
          // Cone/Ray: origin stays at caster, direction follows cursor.
          const dx = pos.x - cc.x;
          const dy = pos.y - cc.y;
          const direction = Math.toDegrees(Math.atan2(dy, dx));
          template.document.updateSource({ direction });
        } else if (shape === 'rect') {
          // Rectangle: center the square on cursor (offset origin by half side).
          template.document.updateSource({ x: pos.x - rectHalfPx, y: pos.y - rectHalfPx });
        } else {
          // Circle: center on cursor.
          template.document.updateSource({ x: pos.x, y: pos.y });
        }
        template.refresh();
      };

      const onPointerDown = async (event) => {
        if (resolved) return;
        const pos = event.data?.getLocalPosition(canvas.app.stage)
                    ?? canvas.mousePosition ?? { x: 0, y: 0 };

        // Range validation for placed shapes (circle/rect: distance from caster to click).
        if (!isDirected) {
          const dist = Math.sqrt((pos.x - cc.x) ** 2 + (pos.y - cc.y) ** 2);
          if (dist > castingRangePx) {
            ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.AOE.outOfRange'));
            return;
          }
        }

        resolved = true;
        cleanup();

        // Finalize position on the preview document, then export via toObject().
        if (isDirected) {
          const dx = pos.x - cc.x;
          const dy = pos.y - cc.y;
          template.document.updateSource({ direction: Math.toDegrees(Math.atan2(dy, dx)) });
        } else if (shape === 'rect') {
          template.document.updateSource({ x: pos.x - rectHalfPx, y: pos.y - rectHalfPx });
        } else {
          template.document.updateSource({ x: pos.x, y: pos.y });
        }

        // Export the fully-configured preview as a plain object for persistence.
        const finalData = template.document.toObject();
        finalData.flags = {
          'aspects-of-power': {
            aoe: true,
            casterActorUuid: this.actor.uuid,
            skillItemUuid: this.uuid,
            templateDuration: aoe.templateDuration,
            placedRound: game.combat?.round ?? 0,
          },
        };

        const [created] = await canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [finalData]);
        // Brief delay so the template object renders and testPoint() is available.
        await new Promise(r => setTimeout(r, 50));
        resolve(created);
      };

      const onCancel = (event) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        ui.notifications.info(game.i18n.localize('ASPECTSOFPOWER.AOE.placementCancelled'));
        resolve(null);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') onCancel(event);
      };

      const cleanup = () => {
        template.layer.preview.removeChild(template);
        template.destroy();
        canvas.stage.off('pointermove', onPointerMove);
        canvas.stage.off('pointerdown', onPointerDown);
        canvas.stage.off('rightdown', onCancel);
        document.removeEventListener('keydown', onKeyDown);
        canvas.tokens.activate();
      };

      canvas.stage.on('pointermove', onPointerMove);
      canvas.stage.on('pointerdown', onPointerDown);
      canvas.stage.on('rightdown', onCancel);
      document.addEventListener('keydown', onKeyDown);
    });
  }

  /**
   * Find all tokens within a placed MeasuredTemplate, filtered by the
   * skill's AOE targeting mode (all / enemies / allies).
   * Uses Foundry v13's testPoint() for containment testing across all shapes.
   *
   * @param {MeasuredTemplateDocument} templateDoc
   * @returns {Token[]}
   */
  _getAoeTargets(templateDoc) {
    const targetingMode = this.system.aoe.targetingMode ?? 'all';
    const casterToken = this.actor.getActiveTokens()?.[0] ?? null;
    const casterDisp = casterToken?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;

    // Get the rendered template object for containment testing.
    const templateObject = canvas.templates.get(templateDoc.id)
                         ?? templateDoc.object;
    const qualifying = [];

    for (const token of canvas.tokens.placeables) {
      if (token.document.hidden) continue;

      const center = token.center;

      // Use Foundry v13's testPoint (canvas-space coords) for all template types.
      if (templateObject?.testPoint) {
        if (!templateObject.testPoint(center)) continue;
      } else {
        // Fallback: manual check using shape.contains (template-local coords).
        const shape = templateObject?.shape;
        const localX = center.x - templateDoc.x;
        const localY = center.y - templateDoc.y;
        if (shape) {
          if (!shape.contains(localX, localY)) continue;
        } else {
          const pixelsPerFoot = canvas.grid.size / canvas.grid.distance;
          const radiusPx = templateDoc.distance * pixelsPerFoot;
          if (localX * localX + localY * localY > radiusPx * radiusPx) continue;
        }
      }

      // Disposition filter.
      if (targetingMode === 'enemies') {
        if (casterDisp === CONST.TOKEN_DISPOSITIONS.FRIENDLY
            && token.document.disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE) continue;
        if (casterDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE
            && token.document.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;
        if (casterDisp === CONST.TOKEN_DISPOSITIONS.NEUTRAL) continue;
      } else if (targetingMode === 'allies') {
        if (token.document.disposition !== casterDisp) continue;
      }

      qualifying.push(token);
    }

    return qualifying;
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

    // Passive skills → post description only (no roll).
    if (this.system.skillType === 'Passive') {
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

    // Variable mana cost for barrier skills — prompt user for amount.
    const isBarrier = tags.includes('restoration') && this.system.tagConfig?.restorationResource === 'barrier';
    if (isBarrier) {
      const maxMana = rollData.roll.resourcevalue;
      if (maxMana <= 0) {
        ChatMessage.create({ speaker, rollMode, flavor: label, content: `Not enough ${rollData.roll.resource}` });
        return;
      }
      const chosenMana = await this._promptBarrierManaCost(maxMana);
      if (chosenMana === null) return; // cancelled
      rollData.roll.cost = chosenMana;
      rollData.roll.variableManaCost = chosenMana;
    }

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

    const resource  = rollData.roll.resource;
    const newResVal = Math.max(0, Math.round(rollData.roll.resourcevalue - rollData.roll.cost));

    // ── Weapon durability: degrade if raw damage exceeds the weapon's limit ──
    if (tags.includes('attack') && this.system.requiredEquipment) {
      const weapon = this.actor.items.get(this.system.requiredEquipment);
      if (weapon) {
        await EquipmentSystem.degradeWeaponOnAttack(weapon, dmgRoll.total);
      }
    }

    // ── AOE branch: place template, detect targets, then deduct cost ──
    const isAoe = this.system.aoe?.enabled && tags.length > 0;
    if (isAoe) {
      const casterToken = this.actor.getActiveTokens()?.[0];
      if (!casterToken) {
        ChatMessage.create({ speaker, rollMode, content: '<p><em>No token found on canvas for AOE placement.</em></p>' });
        return dmgRoll;
      }

      // Interactive placement — cancelled means no cost.
      const templateDoc = await this._placeAoeTemplate(casterToken);
      if (!templateDoc) return dmgRoll;

      // Detect qualifying tokens.
      const targets = this._getAoeTargets(templateDoc);
      if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.AOE.noTokensInArea'));
      }

      // Post roll results to chat.
      if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, flavor: `${label} — To Hit` });
      await dmgRoll.toMessage({ speaker, rollMode, flavor: `${label} — Roll` });

      // Announce targets.
      if (targets.length > 0) {
        const targetNames = targets.map(t => t.document.name).join(', ');
        ChatMessage.create({
          speaker, rollMode,
          content: `<div class="aoe-result"><p><strong>AOE:</strong> ${targets.length} target(s) — ${targetNames}</p></div>`,
        });
      }

      // Dispatch each tag to each qualifying token.
      const hitResults = new Map();
      for (const tag of tags) {
        for (const targetToken of targets) {
          switch (tag) {
            case 'attack': {
              const result = await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetToken);
              if (result) hitResults.set(targetToken, result);
              break;
            }
            case 'restoration':
              await this._handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'buff':
              await this._handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'debuff': {
              // Barrier fully absorbed the attack → skip debuff/DoT for this target.
              const attackResult = hitResults.get(targetToken);
              if (attackResult?.fullyBlocked) break;
              await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            }
            case 'repair':
              await this._handleRepairTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
          }
        }
      }

      // Execute chained skills after all parent tags have resolved.
      await this._executeChainedSkills(hitResults, targets, speaker, rollMode);

      // Deduct resource cost AFTER effects are applied.
      await this.actor.update({ [`system.${resource}.value`]: newResVal });

      // Remove instantaneous templates (duration = 0).
      if ((this.system.aoe.templateDuration ?? 0) === 0) {
        await canvas.scene.deleteEmbeddedDocuments('MeasuredTemplate', [templateDoc.id]);
      }

      return dmgRoll;
    }

    // ── Deduct resource cost (non-AOE) ──────────────────────────────────
    await this.actor.update({ [`system.${resource}.value`]: newResVal });

    // ── Legacy behavior for tagless skills ──────────────────────────────
    if (tags.length === 0) {
      const targetToken  = game.user.targets.first() ?? null;
      const targetActor  = targetToken?.actor ?? null;
      const targetDefKey = rollData.roll.targetDefense;

      if (targetActor && targetDefKey && hitRoll) {
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

    // ── Dispatch to each tag handler (single-target) ─────────────────────
    const hitResults = new Map();
    for (const tag of tags) {
      switch (tag) {
        case 'attack': {
          const result = await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label);
          if (result) hitResults.set(null, result);
          break;
        }
        case 'restoration':
          await this._handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'buff':
          await this._handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'debuff': {
          // Barrier fully absorbed the attack → skip debuff/DoT.
          const attackResult = hitResults.get(null);
          if (attackResult?.fullyBlocked) break;
          await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        }
        case 'repair':
          await this._handleRepairTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
      }
    }

    // Execute chained skills after all parent tags have resolved.
    await this._executeChainedSkills(hitResults, null, speaker, rollMode);

    return dmgRoll;
  }

  /**
   * Execute chained skills after the parent skill's tags have resolved.
   * Each chained skill runs its own rolls and tag handlers, but:
   *   - Resource cost is skipped (chain is "free").
   *   - The chained skill does NOT trigger its own chains (no recursion).
   *   - The chained skill targets the same token(s) as the parent.
   *
   * @param {Map<Token|null, {isHit: boolean, fullyBlocked: boolean}>} hitResults  Per-target hit results from parent.
   * @param {Token[]|null} aoeTargets              AOE targets array, or null for single-target.
   * @param {object} speaker                       Chat speaker data.
   * @param {string} rollMode                      Roll mode setting.
   * @private
   */
  async _executeChainedSkills(hitResults, aoeTargets, speaker, rollMode) {
    const chains = this.system.chainedSkills ?? [];
    if (chains.length === 0) return;

    for (const chain of chains) {
      if (!chain.skillId) continue;

      const chainedItem = this.actor.items.get(chain.skillId);
      if (!chainedItem || chainedItem.type !== 'skill') continue;
      if (chainedItem.system.skillType === 'Passive') continue;

      // Determine target list: AOE targets or [null] (single-target uses game.user.targets).
      const targets = aoeTargets ?? [null];

      for (const targetToken of targets) {
        // Evaluate trigger condition per-target.
        const hitResult = hitResults.get(targetToken) ?? hitResults.get(null);
        const wasHit = hitResult?.isHit;
        if (chain.trigger === 'on-hit' && wasHit !== true) continue;
        if (chain.trigger === 'on-miss' && wasHit !== false) continue;

        // Build the chained skill's own rolls.
        const chainRollData = chainedItem.getRollData();
        const chainLabel = `[chain] ${chainedItem.name}`;
        const { hitFormula: cHitF, dmgFormula: cDmgF } = chainedItem._buildRollFormulas(chainRollData);

        const cHitRoll = cHitF ? new Roll(cHitF, chainRollData) : null;
        if (cHitRoll) await cHitRoll.evaluate();

        const cDmgRoll = new Roll(cDmgF, chainRollData);
        await cDmgRoll.evaluate();

        // Post chained skill rolls to chat.
        if (cHitRoll) await cHitRoll.toMessage({ speaker, rollMode, flavor: `${chainLabel} — To Hit` });
        await cDmgRoll.toMessage({ speaker, rollMode, flavor: `${chainLabel} — Roll` });

        // Dispatch each of the chained skill's own tags.
        const chainTags = chainedItem.system.tags ?? [];
        for (const tag of chainTags) {
          switch (tag) {
            case 'attack':
              await chainedItem._handleAttackTag(chainedItem, chainRollData, cHitRoll, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'restoration':
              await chainedItem._handleRestorationTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'buff':
              await chainedItem._handleBuffTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'debuff':
              await chainedItem._handleDebuffTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'repair':
              await chainedItem._handleRepairTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
          }
        }
      }
    }
  }
}
