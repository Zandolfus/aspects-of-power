import { EquipmentSystem } from '../systems/equipment.mjs';
import { getPositionalTags } from '../helpers/positioning.mjs';

/**
 * Check if an actor is an assigned player character (not just owned).
 * @param {Actor} actor
 * @returns {boolean}
 */
function _isPlayerCharacter(actor) {
  return game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
}

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
   * Attack tag: resolve hit vs target defense pool, calculate mitigated damage,
   * and post a GM-whispered combat result with an Apply Damage button.
   *
   * Defense pool flow:
   *   pool >= toHit  → full dodge, pool -= toHit
   *   0 < pool < toHit → partial, damage *= (1 - pool/toHit), pool = 0
   *   pool == 0       → full hit
   */
  async _handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken  = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor  = targetToken?.actor ?? null;
    if (!targetActor) return;

    const targetDefKey = rollData.roll.targetDefense;
    const hitTotal     = hitRoll ? Math.round(hitRoll.total) : 0;
    const isPhysical   = rollData.roll.damageType === 'physical';
    const mitigation   = isPhysical
      ? (targetActor.system.defense.armor?.value ?? 0)
      : (targetActor.system.defense.veil?.value  ?? 0);
    const attackerToken      = this.actor.getActiveTokens()[0] ?? null;
    const toughnessMod       = targetActor.system.abilities?.toughness?.mod ?? 0;
    const affinityDR         = this._getAffinityDRReduction(targetActor, attackerToken, targetToken);
    const effectiveToughness = Math.max(0, toughnessMod - affinityDR);
    const mitigLabel         = isPhysical ? 'Armor' : 'Veil';

    // ── Defense pool + reaction resolution ─────────────────────────────
    let isHit = true;
    let damageMultiplier = 1;
    let defenseLine = '';
    let reactionLine = '';

    if (hitRoll && targetDefKey) {
      const pool    = targetActor.system.defense[targetDefKey]?.pool ?? 0;
      const poolMax = targetActor.system.defense[targetDefKey]?.poolMax ?? 0;
      const defLabel = targetDefKey.charAt(0).toUpperCase() + targetDefKey.slice(1);

      // Prompt the defender (shows defense pool and/or available reactions).
      const defenseResult = await this._promptDefensePool(
        targetActor, targetDefKey, hitTotal, item.name
      );

      // Handle defense pool usage.
      if (defenseResult.defend && pool > 0) {
        if (pool >= hitTotal) {
          isHit = false;
          const newPool = pool - hitTotal;
          await this._gmAction({
            type: 'gmUpdateDefensePool',
            targetActorUuid: targetActor.uuid,
            defKey: targetDefKey,
            newPool,
          });
          defenseLine = `<p>${defLabel} defense: full dodge (pool ${pool} → ${newPool} / ${poolMax})</p>`;
        } else {
          damageMultiplier = 1 - (pool / hitTotal);
          await this._gmAction({
            type: 'gmUpdateDefensePool',
            targetActorUuid: targetActor.uuid,
            defKey: targetDefKey,
            newPool: 0,
          });
          defenseLine = `<p>${defLabel} defense: partial (${Math.round((1 - damageMultiplier) * 100)}% reduced, pool ${pool} → 0 / ${poolMax})</p>`;
        }
      } else if (pool > 0) {
        defenseLine = `<p>${defLabel} defense: declined (pool ${pool} / ${poolMax})</p>`;
      } else {
        defenseLine = `<p>${defLabel} defense: no pool remaining (0 / ${poolMax})</p>`;
      }

      // Handle reaction skill usage.
      if (defenseResult.reactionSkillId) {
        const reactionSkill = targetActor.items.get(defenseResult.reactionSkillId);
        if (reactionSkill) {
          const rType = reactionSkill.system.reactionType ?? 'dodge';

          // Consume a reaction via GM action.
          await this._gmAction({
            type: 'gmConsumeReaction',
            targetActorUuid: targetActor.uuid,
          });

          if (rType === 'dodge') {
            // Dodge: completely avoids the attack, no defense pool cost.
            isHit = false;
            reactionLine = `<p><em>${targetActor.name} dodges with <strong>${reactionSkill.name}</strong>!</em></p>`;
          } else if (rType === 'parry') {
            // Parry: roll the reaction skill's hit formula and compare to-hits.
            const parryRoll = await reactionSkill.roll({ parryOnly: true });
            const parryTotal = parryRoll ? Math.round(parryRoll.total) : 0;
            if (parryTotal >= hitTotal) {
              isHit = false;
              reactionLine = `<p><em>${targetActor.name} parries with <strong>${reactionSkill.name}</strong>! `
                           + `(${parryTotal} vs ${hitTotal})</em></p>`;
            } else {
              reactionLine = `<p><em>${targetActor.name} fails to parry with <strong>${reactionSkill.name}</strong> `
                           + `(${parryTotal} vs ${hitTotal})</em></p>`;
            }
          } else if (rType === 'barrier') {
            // Barrier: execute the skill normally (creates barrier via restoration tag).
            await reactionSkill.roll();
            reactionLine = `<p><em>${targetActor.name} reacts with <strong>${reactionSkill.name}</strong> (Barrier)!</em></p>`;
          }
        }
      }
    }

    // Damage pipeline: raw → defense pool % → armor/veil → toughness.
    const rawDmg          = Math.round(dmgRoll.total);
    const afterDefense    = isHit ? Math.max(0, Math.round(rawDmg * damageMultiplier)) : 0;
    const preToughnessDmg = Math.max(0, afterDefense - mitigation);
    const finalDamage     = isHit ? Math.max(0, preToughnessDmg - effectiveToughness) : 0;

    const resultBadge = isHit
      ? `<strong style="color:green;">HIT</strong>`
      : `<strong style="color:red;">MISS</strong>`;

    const hitLine = hitRoll && targetDefKey
      ? `<p>Attack: ${hitTotal} vs ${targetActor.name}</p>`
      : '';

    // Barrier preview.
    const barrierValue = targetActor.system.barrier?.value ?? 0;
    let barrierLine = '';
    let damageAfterBarrier = preToughnessDmg;
    let displayDamage = finalDamage;
    if (isHit && barrierValue > 0) {
      const barrierAbsorbs = Math.min(barrierValue, preToughnessDmg);
      damageAfterBarrier = preToughnessDmg - barrierAbsorbs;
      displayDamage = Math.max(0, damageAfterBarrier - effectiveToughness);
      barrierLine = `<p>Barrier absorbs: ${barrierAbsorbs} / ${barrierValue}${barrierAbsorbs >= barrierValue ? ' <em>(breaks)</em>' : ''}</p>`;
    }

    const toughnessLine = damageAfterBarrier > 0
      ? `<p>Toughness: −${Math.min(effectiveToughness, damageAfterBarrier)}${affinityDR > 0 ? ` <em>(−${affinityDR} affinity)</em>` : ''}</p>`
      : '';

    // Forced movement info for the button data attributes.
    const fm = item.system.tagConfig ?? {};
    const hasForcedMovement = fm.forcedMovement && isHit;
    const fmDir  = fm.forcedMovementDir ?? 'push';
    const fmDist = fm.forcedMovementDist ?? 5;
    const fmLine = hasForcedMovement
      ? `<p><strong>${game.i18n.localize('ASPECTSOFPOWER.ForcedMovement.label')}:</strong> ${game.i18n.localize(`ASPECTSOFPOWER.ForcedMovement.${fmDir}`)} ${fmDist} ft</p>`
      : '';
    const fmAttrs = hasForcedMovement
      ? ` data-forced-dir="${fmDir}" data-forced-dist="${fmDist}" data-attacker-token-id="${attackerToken?.id ?? ''}" data-hit-total="${hitTotal}"`
      : '';

    const gmContent = isHit
      ? `<div class="combat-result">
           <h3>${item.name} — ${resultBadge}</h3>
           ${hitLine}
           ${defenseLine}
           ${reactionLine}
           <hr>
           <p>Raw damage: ${rawDmg}</p>
           <p>${mitigLabel}: −${mitigation}</p>
           ${damageMultiplier < 1 ? `<p>Defense reduction: −${Math.round((1 - damageMultiplier) * 100)}%</p>` : ''}
           ${barrierLine}
           ${toughnessLine}
           <p><strong>Final damage: ${displayDamage}</strong></p>
           ${fmLine}
           <button class="apply-damage"
             data-actor-uuid="${targetActor.uuid}"
             data-damage="${preToughnessDmg}"
             data-toughness="${toughnessMod}"
             data-affinity-dr="${affinityDR}"
             data-damage-type="${isPhysical ? 'physical' : 'magical'}"${fmAttrs}
             style="margin-top:6px;width:100%;">
             Apply to ${targetActor.name}
           </button>
         </div>`
      : `<div class="combat-result">
           <h3>${item.name} — ${resultBadge}</h3>
           ${hitLine}
           ${defenseLine}
           ${reactionLine}
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
    const fullyBlocked = isHit && preToughnessDmg > 0 && barrierValue >= preToughnessDmg;
    return { isHit, fullyBlocked };
  }

  /**
   * Prompt the target's owner to choose whether to defend with their pool.
   * Player-owned targets are prompted via socket; GM-owned via direct dialog.
   */
  async _promptDefensePool(targetActor, defKey, hitTotal, attackName) {
    const pool    = targetActor.system.defense[defKey]?.pool ?? 0;
    const poolMax = targetActor.system.defense[defKey]?.poolMax ?? 0;
    const defLabel = defKey.charAt(0).toUpperCase() + defKey.slice(1);

    // Gather available reaction skills if actor has reactions remaining.
    const reactions = targetActor.system.reactions ?? { value: 0, max: 1 };
    const reactionSkills = reactions.value > 0
      ? targetActor.items.filter(i => i.type === 'skill' && i.system.skillType === 'Reaction')
      : [];
    const reactionList = reactionSkills.map(s => ({
      id: s.id, name: s.name, img: s.img,
      reactionType: s.system.reactionType ?? 'dodge',
    }));

    // If pool is empty and no reactions, skip prompt entirely.
    if (pool <= 0 && reactionList.length === 0) return { defend: false, reactionSkillId: null };

    const fullDodge = pool > 0 && pool >= hitTotal;
    let defenseText = '';
    if (pool > 0) {
      const outcomeText = fullDodge
        ? `<strong>Full dodge.</strong> Pool: ${pool} → ${pool - hitTotal}`
        : `<strong>Partial defense (${Math.round((pool / hitTotal) * 100)}% reduction).</strong> Pool: ${pool} → 0`;
      defenseText = `<p>${defLabel} defense pool: ${pool} / ${poolMax}</p><p>If you defend: ${outcomeText}</p>`;
    }

    const reactionText = reactionList.length > 0
      ? `<p>Reactions: ${reactions.value} / ${reactions.max}</p>`
      : '';

    const promptContent = `<p><strong>${attackName}</strong> incoming (to-hit: ${hitTotal})</p>${defenseText}${reactionText}`;

    // Find the owning player — only prompt the user whose assigned character
    // IS this actor. Ownership permissions alone are not enough (players may
    // have OWNER on NPCs/mobs without being the defender).
    const characterOwner = game.users.find(u =>
      u.active && !u.isGM && u.character?.id === targetActor.id
    );
    const playerOwner = characterOwner?.id ?? null;

    let result = { defend: false, reactionSkillId: null };
    if (playerOwner) {
      const requestId = foundry.utils.randomID();
      result = await new Promise((resolve) => {
        const timeout = setTimeout(() => { cleanup(); resolve({ defend: false, reactionSkillId: null }); }, 30000);
        const handler = (response) => {
          if (response.type !== 'defensePromptResponse' || response.requestId !== requestId) return;
          cleanup();
          resolve({ defend: response.defend, reactionSkillId: response.reactionSkillId ?? null });
        };
        const cleanup = () => {
          clearTimeout(timeout);
          game.socket.off('system.aspects-of-power', handler);
        };
        game.socket.on('system.aspects-of-power', handler);
        game.socket.emit('system.aspects-of-power', {
          type: 'defensePrompt',
          targetUserId: playerOwner,
          targetName: targetActor.name,
          promptContent,
          requestId,
          hasPool: pool > 0,
          reactionSkills: reactionList,
        });
      });
    } else if (game.user.isGM) {
      // GM-owned target and we ARE the GM — show dialog locally.
      result = await this._showDefenseDialog(targetActor.name, promptContent, pool > 0, reactionList);
    } else {
      // GM-owned target but a player is attacking — route to GM via socket.
      const requestId = foundry.utils.randomID();
      const gmUser = game.users.find(u => u.isGM && u.active);
      if (gmUser) {
        result = await new Promise((resolve) => {
          const timeout = setTimeout(() => { cleanup(); resolve({ defend: false, reactionSkillId: null }); }, 30000);
          const handler = (response) => {
            if (response.type !== 'defensePromptResponse' || response.requestId !== requestId) return;
            cleanup();
            resolve({ defend: response.defend, reactionSkillId: response.reactionSkillId ?? null });
          };
          const cleanup = () => {
            clearTimeout(timeout);
            game.socket.off('system.aspects-of-power', handler);
          };
          game.socket.on('system.aspects-of-power', handler);
          game.socket.emit('system.aspects-of-power', {
            type: 'defensePrompt',
            targetUserId: gmUser.id,
            targetName: targetActor.name,
            promptContent,
            requestId,
            hasPool: pool > 0,
            reactionSkills: reactionList,
          });
        });
      }
    }

    return result;
  }

  /**
   * Show the defense/reaction dialog locally (for GM-owned targets).
   * Returns { defend: boolean, reactionSkillId: string|null }.
   */
  async _showDefenseDialog(targetName, promptContent, hasPool, reactionSkills) {
    const buttons = [];
    if (hasPool) {
      buttons.push({ action: 'defend', label: 'Defend', icon: 'fas fa-shield-alt', default: true });
    }
    for (const rs of reactionSkills) {
      buttons.push({ action: `reaction:${rs.id}`, label: rs.name, icon: 'fas fa-bolt' });
    }
    buttons.push({ action: 'takeHit', label: 'Take Hit' });

    const action = await foundry.applications.api.DialogV2.wait({
      window: { title: `Defend — ${targetName}` },
      content: promptContent,
      buttons,
      close: () => 'takeHit',
    });

    if (action === 'defend') return { defend: true, reactionSkillId: null };
    if (typeof action === 'string' && action.startsWith('reaction:')) {
      return { defend: false, reactionSkillId: action.slice('reaction:'.length) };
    }
    return { defend: false, reactionSkillId: null };
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
      if (!flags.debuffDamage || !flags.dot) continue;

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
    // Automatically whisper GM-only for non-player actors.
    if (!_isPlayerCharacter(this.actor)) {
      payload.whisperGM = ChatMessage.getWhisperRecipients('GM');
    }
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
    const msgWhisper = payload.whisperGM ? { whisper: payload.whisperGM } : {};
    switch (payload.type) {

      case 'gmApplyRestoration': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const resource    = payload.resource ?? 'health';
        const pool        = target.system[resource];
        const resLabel    = resource.charAt(0).toUpperCase() + resource.slice(1);

        // Health restoration; overflows into overhealth only if skill opts in.
        if (resource === 'health') {
          const newHealth   = Math.min(pool.max, pool.value + payload.amount);
          const healthGain  = newHealth - pool.value;
          const excess      = payload.amount - healthGain;
          const updateData  = { 'system.health.value': newHealth };
          let ohGain = 0;

          if (excess > 0 && payload.overhealth && target.system.overhealth) {
            const oh       = target.system.overhealth;
            const ohCap    = oh.cap ?? (pool.max * 2);
            const newOh    = Math.min(ohCap, oh.value + excess);
            ohGain         = newOh - oh.value;
            updateData['system.overhealth.value'] = newOh;
          }

          await target.update(updateData);
          const ohNote = ohGain > 0 ? ` (+${ohGain} overhealth)` : '';
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> restores <strong>${healthGain}</strong> ${resLabel}${ohNote}. `
                   + `${resLabel}: ${newHealth} / ${pool.max}</p>`,
          });
        } else if (resource === 'barrier') {
          // Barrier creation via ActiveEffect.
          const barrierValue = payload.amount;
          const affinities   = payload.barrierAffinities ?? [];
          const source       = payload.barrierSource ?? '';
          const affText = affinities.length > 0 ? ` (${affinities.join(', ')})` : '';

          // Check for existing barrier effect.
          const existingEffect = target.effects.find(e =>
            !e.disabled && e.flags?.aspectsofpower?.effectType === 'barrier'
          );

          // Prompt the target's owner to accept. If the target is an NPC, GM decides.
          const owners = Object.entries(target.ownership ?? {})
            .filter(([uid, level]) => level >= 3 && uid !== 'default')
            .map(([uid]) => uid);
          const playerOwner = owners.find(uid => {
            const u = game.users.get(uid);
            return u?.active && !u.isGM;
          });

          // Build confirmation prompt content.
          const existingNote = existingEffect
            ? `<p class="hint">This will replace the current barrier (${existingEffect.flags.aspectsofpower.barrierData?.value ?? 0} / ${existingEffect.flags.aspectsofpower.barrierData?.max ?? 0}).</p>`
            : '';
          const promptContent = `<p>Apply a <strong>${barrierValue}</strong> HP barrier${affText} from <strong>${source}</strong>?</p>${existingNote}`;

          let accepted = false;
          if (playerOwner) {
            // Send prompt to the player via socket and wait for response.
            const requestId = foundry.utils.randomID();
            accepted = await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                cleanup();
                resolve(true); // Default accept on timeout (30s).
              }, 30000);

              const handler = (response) => {
                if (response.type !== 'barrierPromptResponse' || response.requestId !== requestId) return;
                cleanup();
                resolve(response.accepted);
              };

              const cleanup = () => {
                clearTimeout(timeout);
                game.socket.off('system.aspects-of-power', handler);
              };

              game.socket.on('system.aspects-of-power', handler);
              game.socket.emit('system.aspects-of-power', {
                type: 'barrierPrompt',
                targetUserId: playerOwner,
                targetName: target.name,
                promptContent,
                requestId,
              });
            });
          } else {
            // GM-owned target (NPC) — prompt the GM directly.
            accepted = await foundry.applications.api.DialogV2.confirm({
              window: { title: `Barrier — ${target.name}` },
              content: promptContent,
              yes: { label: 'Accept', icon: 'fas fa-shield-alt' },
              no: { label: 'Decline' },
            });
          }

          if (!accepted) {
            ChatMessage.create({
              speaker: payload.speaker, ...msgWhisper,
              content: `<p><strong>${target.name}</strong> declined the barrier.</p>`,
            });
            return;
          }

          // Deduct caster's resource cost now that barrier was accepted.
          if (payload.casterActorUuid && payload.casterCost) {
            const caster = await fromUuid(payload.casterActorUuid);
            if (caster) {
              const res = payload.casterResource ?? 'mana';
              const curVal = caster.system[res]?.value ?? 0;
              await caster.update({ [`system.${res}.value`]: Math.max(0, curVal - payload.casterCost) });
            }
          }

          // Remove existing barrier effect if present.
          if (existingEffect) {
            await existingEffect.delete();
          }

          // Create barrier ActiveEffect.
          await target.createEmbeddedDocuments('ActiveEffect', [{
            name: `Barrier: ${source}`,
            img: 'icons/magic/defensive/shield-barrier-glowing-blue.webp',
            disabled: false,
            flags: {
              aspectsofpower: {
                effectType: 'barrier',
                effectCategory: 'temporary',
                barrierData: {
                  value: barrierValue,
                  max: barrierValue,
                  affinities,
                  source,
                },
              },
            },
          }]);

          const replaced = existingEffect ? ' (replaced existing barrier)' : '';
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> gains a <strong>${barrierValue}</strong> point barrier${affText}${replaced}.</p>`,
          });
        } else {
          const newValue    = Math.min(pool.max, pool.value + payload.amount);
          const actualGain  = newValue - pool.value;
          await target.update({ [`system.${resource}.value`]: newValue });
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
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
              const match = merged.find(m => m.key === incoming.key && m.type === incoming.type);
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
            ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
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
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p>Buff on <strong>${target.name}</strong> upgraded (total +${newTotal}, was +${currentTotal}).</p>`,
              });
            } else {
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
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
          ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
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
          speaker: payload.speaker, ...msgWhisper,
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
              const match = merged.find(m => m.key === incoming.key && m.type === incoming.type);
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
            ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
              content: `<p>Debuff on <strong>${target.name}</strong> stacked (total -${mergedTotal}) for ${newDuration} rounds.</p>`,
            });
          } else {
            // No existing — create new effect.
            payload.effectData['duration.startRound'] = startRound;
            payload.effectData['duration.startTurn'] = startTurn;
            await target.createEmbeddedDocuments('ActiveEffect', [payload.effectData]);

            if (payload.statSummary) {
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> debuffed: ${payload.statSummary} for ${payload.duration} rounds.</p>`,
              });
            }

            // Blind: apply Foundry blind status to disable token vision.
            const dType = payload.effectData.flags?.['aspects-of-power']?.debuffType;
            if (dType === 'blind') {
              const tokens = target.getActiveTokens();
              for (const t of tokens) {
                if (!t.document.hasStatusEffect('blind')) {
                  await t.document.toggleActiveEffect({ id: 'blind', name: 'Blind', img: 'icons/svg/blind.svg' }, { active: true });
                }
              }
            }

            // Dismembered: force-unequip items in the disabled slot.
            const dSlot = payload.effectData.flags?.['aspects-of-power']?.dismemberedSlot;
            if (dType === 'dismembered' && dSlot) {
              const equippedInSlot = target.items.filter(
                i => i.type === 'item' && i.system.equipped && i.system.slot === dSlot
              );
              for (const equippedItem of equippedInSlot) {
                await EquipmentSystem.unequip(equippedItem);
              }
              const slotLabel = game.i18n.localize(`ASPECTSOFPOWER.Equip.Slot.${dSlot}`) || dSlot;
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> loses use of <strong>${slotLabel}</strong> slot!</p>`,
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

      case 'gmApplyCleanse': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;

        // Find all magical debuffs on the target, sorted strongest (highest debuffDamage) first.
        const magicalDebuffs = target.effects
          .filter(e => {
            if (e.disabled) return false;
            const flags = e.flags?.['aspects-of-power'];
            if (!flags?.debuffType || flags.debuffType === 'none') return false;
            return flags.magicType === 'magical';
          })
          .sort((a, b) =>
            (b.flags['aspects-of-power'].debuffDamage ?? 0) - (a.flags['aspects-of-power'].debuffDamage ?? 0)
          );

        if (magicalDebuffs.length === 0) {
          ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
            content: `<p><em>${game.i18n.localize('ASPECTSOFPOWER.Cleanse.noDebuffs')}</em></p>`,
          });
          break;
        }

        // Distribute cleanse roll total across debuffs as breakProgress.
        let budget = payload.rollTotal;
        const results = [];
        for (const effect of magicalDebuffs) {
          if (budget <= 0) break;
          const flags = effect.flags['aspects-of-power'];
          const threshold = flags.debuffDamage ?? 0;
          const previousProgress = flags.breakProgress ?? 0;
          const typeName = game.i18n.localize(
            CONFIG.ASPECTSOFPOWER.debuffTypes[flags.debuffType] ?? flags.debuffType
          );

          // Add full budget to this effect's progress.
          const newProgress = previousProgress + budget;

          if (newProgress >= threshold && threshold > 0) {
            // Cleansed! Remove the effect, carry over excess.
            const excess = newProgress - threshold;
            budget = excess;
            await effect.delete();
            results.push(`<strong>${typeName}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Cleanse.cleansed')} <strong>${target.name}</strong>! [${newProgress} / ${threshold}]`);
          } else {
            // Partial progress — consume entire budget.
            await effect.setFlag('aspects-of-power', 'breakProgress', newProgress);
            budget = 0;
            results.push(`${game.i18n.localize('ASPECTSOFPOWER.Cleanse.progress')} <strong>${typeName}</strong>: [${newProgress} / ${threshold}]`);
          }
        }

        ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
          content: `<p><strong>${payload.skillName}</strong> cleanses <strong>${target.name}</strong> (roll: ${payload.rollTotal}):</p>`
                 + `<ul>${results.map(r => `<li>${r}</li>`).join('')}</ul>`,
        });
        break;
      }

      case 'gmUpdateDefensePool': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const defKey = payload.defKey;
        if (!['melee', 'ranged', 'mind', 'soul'].includes(defKey)) return;
        await target.update({ [`system.defense.${defKey}.pool`]: payload.newPool });
        break;
      }

      case 'gmConsumeReaction': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const reactions = target.system.reactions;
        if (reactions && reactions.value > 0) {
          await target.update({ 'system.reactions.value': reactions.value - 1 });
        }
        break;
      }
    }
  }

  /**
   * Restoration tag: restore health, mana, or stamina and route through GM.
   */
  async _handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
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
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No valid restoration target.</em></p>` });
      return;
    }

    const actionPayload = {
      type: 'gmApplyRestoration',
      targetActorUuid: targetActor.uuid,
      amount,
      resource,
      overhealth: this.system.tagConfig?.restorationOverhealth ?? false,
      speaker, rollMode,
    };

    // Barrier creation passes affinities, source name, and caster cost info
    // so the GM can deduct cost only after the target accepts.
    if (resource === 'barrier') {
      actionPayload.barrierAffinities = this.system.affinities ?? [];
      actionPayload.barrierSource = this.name;
      const casterRes = rollData.roll.resource ?? 'mana';
      const casterCost = rollData.roll.cost ?? 0;
      actionPayload.casterActorUuid = this.actor.uuid;
      actionPayload.casterResource = casterRes;
      actionPayload.casterCost = casterCost;
    }

    await this._gmAction(actionPayload);
  }

  /**
   * Buff tag: build payload and route through GM.
   * Values are roll-based: rollTotal * entry.value (multiplier, default 1).
   */
  async _handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No target for buff.</em></p>` });
      return;
    }

    const entries  = this.system.tagConfig?.buffEntries ?? [];
    const duration = this.system.tagConfig?.buffDuration ?? 1;
    const rollTotal = Math.round(dmgRoll.total);

    if (entries.length === 0) return;

    const changes = entries.map(e => ({
      key:   `system.${e.attribute}.value`,
      type:  'add',
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
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No target for debuff.</em></p>` });
      return;
    }

    const entries    = this.system.tagConfig?.debuffEntries ?? [];
    const duration   = this.system.tagConfig?.debuffDuration ?? 1;
    const dealsDmg   = this.system.tagConfig?.debuffDealsDamage ?? false;
    const dmgType    = this.system.tagConfig?.debuffDamageType ?? 'physical';
    const debuffType = this.system.tagConfig?.debuffType ?? 'none';
    const rollTotal  = Math.round(dmgRoll.total);

    // Build stat-reduction changes (roll-based).
    const changes = entries.map(e => ({
      key:   `system.${e.attribute}.value`,
      type:  'add',
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

    // Dismembered: GM chooses which equipment slot to disable.
    let dismemberedSlot = null;
    if (debuffType === 'dismembered') {
      const slots = CONFIG.ASPECTSOFPOWER.equipmentSlots ?? {};
      const slotOptions = Object.entries(slots)
        .map(([key, def]) => `<option value="${key}">${game.i18n.localize(def.label ?? `ASPECTSOFPOWER.Equip.Slot.${key}`)}</option>`)
        .join('');
      dismemberedSlot = await new Promise(resolve => {
        new foundry.applications.api.DialogV2({
          window: { title: 'Dismember — Choose Slot' },
          content: `<div class="form-group"><label>Slot to disable:</label><select name="slot">${slotOptions}</select></div>`,
          buttons: [{
            action: 'confirm', label: 'Confirm', default: true,
            callback: (event, button) => resolve(button.form.elements.slot?.value || null),
          }, {
            action: 'cancel', label: 'Cancel',
            callback: () => resolve(null),
          }],
          close: () => resolve(null),
        }).render({ force: true });
      });
      if (!dismemberedSlot) return; // cancelled
    }

    // Always store affinity metadata so attack skills can match against this debuff.
    effectData.flags = {
      'aspects-of-power': {
        debuffDamage: rollTotal,
        debuffType,
        casterActorUuid: this.actor.uuid,
        affinities: this.system.affinities ?? [],
        magicType: this.system.magicType ?? 'non-magical',
        directions,
        ...(dismemberedSlot ? { dismemberedSlot } : {}),
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
      effectData: (changes.length > 0 || dealsDmg || debuffType !== 'none') ? effectData : null,
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
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const amount = Math.round(dmgRoll.total);

    let targetActor;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    targetActor = targetToken?.actor ?? null;

    // Fall back to self if no target selected.
    if (!targetActor && !targetTokenOverride) {
      targetActor = this.actor;
    }

    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No valid repair target.</em></p>` });
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

  /**
   * Cleanse tag: add the roll total to breakProgress on magical debuffs on the target.
   * Only magical skills can cleanse. Distributes roll total across debuffs (strongest first)
   * until the budget is exhausted or all debuffs are processed.
   */
  async _handleCleanseTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>${game.i18n.localize('ASPECTSOFPOWER.Cleanse.noTarget')}</em></p>` });
      return;
    }

    // Only magical skills can cleanse.
    if ((this.system.magicType ?? 'non-magical') !== 'magical') {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>${game.i18n.localize('ASPECTSOFPOWER.Cleanse.nonMagical')}</em></p>` });
      return;
    }

    const rollTotal = Math.round(dmgRoll.total);

    await this._gmAction({
      type: 'gmApplyCleanse',
      targetActorUuid: targetActor.uuid,
      rollTotal,
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
    if (tags.includes('restoration') || tags.includes('buff') || tags.includes('repair') || tags.includes('cleanse')) return '#44ff44';
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
  /*  Consumable usage                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Use a consumable item. Applies its effect, consumes a charge (or quantity),
   * and posts a chat message.
   */
  async useConsumable() {
    if (this.type !== 'consumable') return;
    const sys = this.system;

    // Check charges / quantity.
    if (sys.charges.value <= 0 && sys.quantity <= 0) {
      ui.notifications.warn(`${this.name} has no charges or uses remaining.`);
      return;
    }

    const effectType = sys.effectType;

    // Repair kits are used via the equipment repair button, not directly.
    if (effectType === 'repairKit') {
      ui.notifications.info('Use the repair button on equipment to use this repair kit.');
      return;
    }

    // Build a summary for the confirmation dialog.
    const effectSummary = this._getConsumableEffectSummary();

    // Confirmation dialog.
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: `Use ${this.name}?` },
      content: `<p>Use <strong>${this.name}</strong>?</p>`
        + `<p class="hint">${effectSummary}</p>`,
      yes: { label: 'Use', icon: 'fas fa-flask' },
      no: { label: 'Cancel' },
    });
    if (!confirmed) return;

    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const gmOnly = !_isPlayerCharacter(this.actor);
    const whisperGM = gmOnly ? ChatMessage.getWhisperRecipients('GM') : undefined;

    // Determine target (self for restoration/buff, selected for poison).
    let targetActor = this.actor;
    if (effectType === 'buff') {
      const targetToken = game.user.targets.first();
      targetActor = targetToken?.actor ?? this.actor;
    }

    let chatContent = `<p><strong>${this.actor.name}</strong> uses <strong>${this.name}</strong>.</p>`;

    switch (effectType) {
      case 'restoration': {
        const resource = sys.restoration.resource;
        const amount = sys.restoration.amount;
        if (amount > 0 && targetActor) {
          await this._gmAction({
            type: 'gmApplyRestoration',
            targetActorUuid: targetActor.uuid,
            amount,
            resource,
            overhealth: sys.restoration.overhealth ?? false,
            speaker, rollMode,
          });
        }
        break;
      }

      case 'buff': {
        if (sys.buff.entries.length > 0 && targetActor) {
          const changes = sys.buff.entries.map(e => ({
            key: `system.${e.attribute}.value`,
            type: 'add',
            value: e.value,
          }));
          const effectName = `${this.name} (Consumable)`;
          await this._gmAction({
            type: 'gmApplyBuff',
            targetActorUuid: targetActor.uuid,
            effectName,
            originUuid: this.uuid,
            stackable: false,
            changes,
            duration: sys.buff.duration,
            speaker, rollMode,
          });
        }
        break;
      }

      case 'barrier': {
        const barrierHP = sys.barrier.value;
        if (barrierHP > 0 && targetActor) {
          await this._gmAction({
            type: 'gmApplyRestoration',
            targetActorUuid: targetActor.uuid,
            amount: barrierHP,
            resource: 'barrier',
            barrierAffinities: [],
            barrierSource: this.name,
            speaker, rollMode,
          });
        }
        break;
      }

      case 'poison': {
        // Apply poison flag to the actor's next N attacks.
        const poisonData = {
          damage: sys.poison.damage,
          damageType: sys.poison.damageType,
          remaining: sys.poison.duration,
          source: this.name,
        };
        await this.actor.setFlag('aspects-of-power', 'appliedPoison', poisonData);
        chatContent = `<p><strong>${this.actor.name}</strong> applies <strong>${this.name}</strong> `
          + `(${sys.poison.damage} ${sys.poison.damageType} damage, ${sys.poison.duration} attacks).</p>`;
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: chatContent });
        break;
      }

      case 'bomb': {
        chatContent = `<p><strong>${this.actor.name}</strong> throws <strong>${this.name}</strong> `
          + `(${sys.bomb.damage} ${sys.bomb.damageType} damage, ${sys.bomb.diameter}ft ${sys.bomb.shape}).</p>`;
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: chatContent });
        break;
      }

      case 'none': {
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: chatContent });
        break;
      }
    }

    // Consume a charge. If charges hit 0, consume a quantity and reset charges.
    const updateData = {};
    let newCharges = sys.charges.value - 1;
    if (newCharges <= 0 && sys.charges.max > 0) {
      // Multi-charge item: consume quantity, reset charges.
      const newQty = sys.quantity - 1;
      if (newQty <= 0) {
        await this.delete();
        return;
      }
      updateData['system.quantity'] = newQty;
      updateData['system.charges.value'] = sys.charges.max;
    } else if (sys.charges.max <= 1) {
      // Single-use: consume quantity directly.
      const newQty = sys.quantity - 1;
      if (newQty <= 0) {
        await this.delete();
        return;
      }
      updateData['system.quantity'] = newQty;
    } else {
      updateData['system.charges.value'] = newCharges;
    }
    await this.update(updateData);
  }

  /**
   * Build a human-readable summary of this consumable's effect.
   * @returns {string}
   */
  _getConsumableEffectSummary() {
    const sys = this.system;
    const effectLabel = game.i18n.localize(
      CONFIG.ASPECTSOFPOWER.consumableEffectTypes[sys.effectType] ?? 'ASPECTSOFPOWER.ConsumableEffect.none'
    );
    switch (sys.effectType) {
      case 'restoration': {
        const resLabel = game.i18n.localize(
          CONFIG.ASPECTSOFPOWER.restorationResources[sys.restoration.resource] ?? 'Health'
        );
        return `${effectLabel}: ${resLabel} +${sys.restoration.amount}`;
      }
      case 'buff': {
        const parts = (sys.buff.entries ?? []).map(e => {
          const attrKey = e.attribute?.split('.').pop() ?? '?';
          const sign = e.value >= 0 ? '+' : '';
          return `${attrKey} ${sign}${e.value}`;
        });
        return `${effectLabel}: ${parts.join(', ')} (${sys.buff.duration} rounds)`;
      }
      case 'barrier':
        return `${effectLabel}: ${sys.barrier.value} HP barrier`;
      case 'poison':
        return `${effectLabel}: ${sys.poison.damage} ${sys.poison.damageType} damage for ${sys.poison.duration} attacks`;
      case 'bomb':
        return `${effectLabel}: ${sys.bomb.damage} ${sys.bomb.damageType} damage, ${sys.bomb.diameter}ft ${sys.bomb.shape}`;
      case 'repairKit':
        return `${effectLabel}: +${sys.repairAmount} durability`;
      default:
        return effectLabel;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Main roll dispatcher                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Handle clickable rolls. Evaluates the shared formula once, then dispatches
   * to per-tag handlers based on the skill's tags array.
   * @private
   */
  async roll(options = {}) {
    const item     = this;
    const rollData = this.getRollData();
    const speaker  = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const label    = `[${item.type}] ${item.name}`;
    const gmOnly = !_isPlayerCharacter(this.actor);
    const whisperGM = gmOnly ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const tags     = this.system.tags ?? [];

    // ── Parry-only mode: evaluate just the hit roll for comparison ─────
    if (options.parryOnly) {
      const { hitFormula } = this._buildRollFormulas(rollData);
      if (!hitFormula) return null;
      const hitRoll = new Roll(hitFormula, rollData);
      await hitRoll.evaluate();
      await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Parry` });
      return hitRoll;
    }

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

    // ── Debuff enforcement: check if the actor is blocked from using this skill ──
    if (this.actor) {
      const _hasDebuff = (types) => {
        const arr = Array.isArray(types) ? types : [types];
        return this.actor.effects.find(e =>
          !e.disabled && arr.includes(e.flags?.['aspects-of-power']?.debuffType)
        );
      };

      // Turn-skipping debuffs block all active skill use.
      const skipDebuff = _hasDebuff(['stun', 'sleep', 'paralysis']);
      if (skipDebuff) {
        const typeName = game.i18n.localize(
          CONFIG.ASPECTSOFPOWER.debuffTypes[skipDebuff.flags['aspects-of-power'].debuffType] ?? 'Debuff'
        );
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotAct')} (${typeName})`);
        return;
      }

      // Immobilized blocks physical (non-mana) skills.
      if (_hasDebuff('immobilized') && rollData.roll.resource !== 'mana') {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotAct')} (${game.i18n.localize('ASPECTSOFPOWER.Debuff.immobilized')})`);
        return;
      }

      // Silence blocks skills with vocal components.
      if (_hasDebuff('silence') && this.system.vocalComponent) {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.silenced')} — cannot use ${this.name}!`);
        return;
      }

      // Blind blocks skills that require sight.
      if (_hasDebuff('blind') && this.system.requiresSight) {
        // Blind doesn't fully block — it reduces to-hit. Mark for later.
        rollData._blindDebuff = _hasDebuff('blind');
      }

      // Deafened blocks skills that require hearing.
      if (_hasDebuff('deafened') && this.system.requiresHearing) {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.deafened')} — cannot use ${this.name}!`);
        return;
      }

      // Weaken: mark for damage reduction later.
      const weakenEffect = _hasDebuff('weaken');
      if (weakenEffect) {
        rollData._weakenDebuff = weakenEffect;
      }
    }

    // Build formulas (also populates rollData.roll.abilitymod and resourcevalue).
    const { hitFormula, dmgFormula } = this._buildRollFormulas(rollData);

    // Variable mana cost for barrier skills — prompt user for amount.
    const isBarrier = tags.includes('restoration') && this.system.tagConfig?.restorationResource === 'barrier';
    if (isBarrier) {
      const maxMana = rollData.roll.resourcevalue;
      if (maxMana <= 0) {
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: label, content: `Not enough ${rollData.roll.resource}` });
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

    // ── Apply debuff modifiers to roll totals ─────────────────────────
    // Blind: reduce to-hit by amount perception was overcome.
    if (rollData._blindDebuff && hitRoll) {
      const debuffRoll    = rollData._blindDebuff.flags?.['aspects-of-power']?.debuffDamage ?? 0;
      const perceptionMod = this.actor.system.abilities?.perception?.mod ?? 0;
      const hitReduction  = Math.max(0, debuffRoll - perceptionMod);
      if (hitReduction > 0) {
        hitRoll._total = Math.max(0, hitRoll.total - hitReduction);
      }
    }

    // Weaken: reduce damage by the debuff's strength modifier reduction.
    if (rollData._weakenDebuff && dmgRoll) {
      const debuffRoll   = rollData._weakenDebuff.flags?.['aspects-of-power']?.debuffDamage ?? 0;
      const strengthMod  = this.actor.system.abilities?.strength?.mod ?? 0;
      const dmgReduction = Math.max(0, debuffRoll - strengthMod);
      if (dmgReduction > 0) {
        dmgRoll._total = Math.max(0, dmgRoll.total - dmgReduction);
      }
    }

    const resource  = rollData.roll.resource;
    const newResVal = Math.max(0, Math.round(rollData.roll.resourcevalue - rollData.roll.cost));

    // ── Weapon durability: degrade if raw damage exceeds the weapon's limit ──
    if (tags.includes('attack') && this.system.requiredEquipment) {
      const weapon = this.actor.items.get(this.system.requiredEquipment);
      if (weapon) {
        await EquipmentSystem.degradeWeaponOnAttack(weapon, dmgRoll.total);
      }
    }

    // ── Consume a combat action (for movement segmentation) ──
    game.aspectsofpower?.consumeAction?.(this.actor);

    // ── AOE branch: place template, detect targets, then deduct cost ──
    const isAoe = this.system.aoe?.enabled && tags.length > 0;
    if (isAoe) {
      const casterToken = this.actor.getActiveTokens()?.[0];
      if (!casterToken) {
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: '<p><em>No token found on canvas for AOE placement.</em></p>' });
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
      if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — To Hit` });
      await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Roll` });

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
            case 'cleanse':
              await this._handleCleanseTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
          }
        }
      }

      // Execute chained skills after all parent tags have resolved.
      await this._executeChainedSkills(hitResults, targets, speaker, rollMode);

      // Deduct resource cost AFTER effects are applied.
      // Barrier skills defer cost deduction to executeGmAction (after target accepts).
      if (!isBarrier) {
        await this.actor.update({ [`system.${resource}.value`]: newResVal });
      }

      // Remove instantaneous templates (duration = 0).
      if ((this.system.aoe.templateDuration ?? 0) === 0) {
        await canvas.scene.deleteEmbeddedDocuments('MeasuredTemplate', [templateDoc.id]);
      }

      return dmgRoll;
    }

    // ── Deduct resource cost (non-AOE) ──────────────────────────────────
    // Barrier skills defer cost until after the target accepts.
    if (!isBarrier) {
      await this.actor.update({ [`system.${resource}.value`]: newResVal });
    }

    // ── Legacy behavior for tagless skills ──────────────────────────────
    if (tags.length === 0) {
      const targetToken  = game.user.targets.first() ?? null;
      const targetActor  = targetToken?.actor ?? null;
      const targetDefKey = rollData.roll.targetDefense;

      if (targetActor && targetDefKey && hitRoll) {
        await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label);
        await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Attack` });
        await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Damage` });
      } else {
        if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: 'To Hit' });
        await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: label });
      }
      return dmgRoll;
    }

    // ── Post roll results to chat once (shared) ─────────────────────────
    if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — To Hit` });
    await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Roll` });

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
        case 'cleanse':
          await this._handleCleanseTag(item, rollData, dmgRoll, speaker, rollMode, label);
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
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
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
        if (cHitRoll) await cHitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${chainLabel} — To Hit` });
        await cDmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${chainLabel} — Roll` });

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
            case 'cleanse':
              await chainedItem._handleCleanseTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
          }
        }
      }
    }
  }
}
