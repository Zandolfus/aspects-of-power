/**
 * Extended TokenDocument for Aspects of Power.
 * Handles movement enforcement via v14's movement API instead of preUpdateToken hooks.
 * @extends {foundry.documents.TokenDocument}
 */
export class AspectsofPowerToken extends foundry.documents.TokenDocument {

  /* -------------------------------------------- */
  /*  Movement Enforcement                        */
  /* -------------------------------------------- */

  /**
   * Segment movement tracker — cumulative distance within the current action segment.
   * Resets when a skill consumes an action via game.aspectsofpower.consumeAction().
   * @type {Map<string, number>}
   */
  static _segmentMovement = new Map();

  /**
   * Action tracker — how many skill-actions the combatant has used this turn.
   * @type {Map<string, number>}
   */
  static _moveActionTracker = new Map();

  /**
   * Clear all movement trackers (called on turn change).
   */
  static clearTrackers() {
    this._segmentMovement.clear();
    this._moveActionTracker.clear();
  }

  /**
   * Consume an action for a combatant and reset their movement segment.
   * @param {string} combatantId
   * @returns {number} New action count.
   */
  static consumeAction(combatantId) {
    const used = (this._moveActionTracker.get(combatantId) ?? 0) + 1;
    this._moveActionTracker.set(combatantId, used);
    this._segmentMovement.set(combatantId, 0);
    return used;
  }

  /* -------------------------------------------- */

  /**
   * v14 movement hook: called before a movement is committed.
   * Return false to cancel the movement.
   */
  _preUpdateMovement(movement, operation) {
    // Exempt: no active combat.
    const combat = game.combat;
    if (!combat?.started) return;

    const actor = this.actor;
    if (!actor?.system) return;

    // Identify combatant.
    const combatant = combat.combatants.find(
      c => c.tokenId === this.id && c.sceneId === this.parent?.id
    );
    if (!combatant) return;

    // Block movement for debuffs.
    const moveBlocker = this._getMovementBlocker(actor);
    if (moveBlocker) {
      const typeName = game.i18n.localize(
        CONFIG.ASPECTSOFPOWER.debuffTypes[moveBlocker.flags['aspects-of-power'].debuffType] ?? 'Debuff'
      );
      ui.notifications.warn(`${actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotMove')} (${typeName})`);
      return false;
    }

    // Calculate movement ranges (with chilled reduction).
    let { walkRange, sprintRange } = this._getMovementRanges(actor);
    if (walkRange <= 0 && sprintRange <= 0) {
      ui.notifications.warn(`${actor.name} is frozen solid! (Chilled overcame Endurance)`);
      return false;
    }

    // Check action limit.
    const actionsUsed = AspectsofPowerToken._moveActionTracker.get(combatant.id) ?? 0;
    if (actionsUsed >= 3) {
      ui.notifications.warn('No movement remaining this turn! (3/3 actions used)');
      return false;
    }

    // Only process on the first split (which carries the full movement cost).
    // Subsequent splits are sub-segments that we don't need to re-check.
    if (movement.chain?.length > 0) return;

    // Distance from the movement cost (passed = already computed, pending = remaining).
    // v14 movement cost is already in distance units (feet).
    const totalCost = (movement.passed?.cost ?? 0) + (movement.pending?.cost ?? 0);
    const moveSnapped = Math.round(totalCost / 5) * 5;
    if (moveSnapped <= 0) return;

    // Cumulative segment check.
    const segmentSoFar = AspectsofPowerToken._segmentMovement.get(combatant.id) ?? 0;
    const newSegmentTotal = segmentSoFar + moveSnapped;
    if (newSegmentTotal > sprintRange) {
      const remaining = Math.max(0, sprintRange - segmentSoFar);
      ui.notifications.warn(`Movement cap reached! (${remaining} ft remaining this segment, ${Math.round(sprintRange)} ft max)`);
      return false;
    }

    // Check stamina.
    const stamina = actor.system.stamina;
    let staminaCost = 0;
    for (let ft = segmentSoFar + 5; ft <= newSegmentTotal; ft += 5) {
      staminaCost += (ft <= walkRange) ? 1 : 3;
    }
    if (staminaCost > stamina.value) {
      ui.notifications.warn('Insufficient stamina to move!');
      return false;
    }

    // Store data for _onUpdateMovement to use.
    this._pendingMovement = { combatantId: combatant.id, moveSnapped, newSegmentTotal, staminaCost, sprintRange };
  }

  /**
   * v14 movement hook: called after a movement commits.
   * Deduct stamina and update segment tracker.
   */
  async _onUpdateMovement(movement, operation, user) {
    if (!this._pendingMovement) return;
    // Only the user who initiated the move should deduct costs.
    if (game.user.id !== user.id) return;

    const { combatantId, moveSnapped, newSegmentTotal, staminaCost, sprintRange } = this._pendingMovement;
    delete this._pendingMovement;

    const actor = this.actor;
    if (!actor) return;

    // Update tracker.
    AspectsofPowerToken._segmentMovement.set(combatantId, newSegmentTotal);

    // Deduct stamina.
    const newStamina = actor.system.stamina.value - staminaCost;
    await actor.update({ 'system.stamina.value': newStamina });

    // Chat message.
    const _isPC = game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
    const moveWhisper = _isPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      ...moveWhisper,
      content: `<p><em>${actor.name} moves ${moveSnapped} ft (${newSegmentTotal}/${Math.round(sprintRange)} ft this segment). `
             + `Stamina: −${staminaCost} (${newStamina}/${actor.system.stamina.max})</em></p>`,
    });
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /**
   * Check if the actor has a debuff that blocks movement.
   * @returns {ActiveEffect|undefined}
   */
  _getMovementBlocker(actor) {
    const blockTypes = ['root', 'immobilized', 'frozen', 'sleep', 'stun', 'paralysis'];
    return actor.effects.find(e =>
      !e.disabled && blockTypes.includes(e.flags?.['aspects-of-power']?.debuffType)
    );
  }

  /**
   * Get walk/sprint ranges, accounting for chilled debuff.
   * @returns {{ walkRange: number, sprintRange: number }}
   */
  _getMovementRanges(actor) {
    let walkRange = actor.system.walkRange ?? 0;
    let sprintRange = actor.system.sprintRange ?? 0;

    // Chilled: reduce ranges.
    const chilledEffect = actor.effects.find(e =>
      !e.disabled && e.flags?.['aspects-of-power']?.debuffType === 'chilled'
    );
    if (chilledEffect) {
      const debuffRoll   = chilledEffect.flags?.['aspects-of-power']?.debuffDamage ?? 0;
      const enduranceMod = actor.system.abilities?.endurance?.mod ?? 0;
      const reduction    = Math.max(0, debuffRoll - enduranceMod);
      walkRange   = Math.max(0, walkRange - reduction);
      sprintRange = Math.max(0, sprintRange - reduction);
    }

    return { walkRange, sprintRange };
  }
}
