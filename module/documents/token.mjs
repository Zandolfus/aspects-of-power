/**
 * Extended TokenDocument for Aspects of Power.
 * Handles movement enforcement via v14's movement API.
 * @extends {foundry.documents.TokenDocument}
 */
export class AspectsofPowerToken extends foundry.documents.TokenDocument {

  /* -------------------------------------------- */
  /*  Movement Enforcement                        */
  /* -------------------------------------------- */

  /** Cumulative distance within the current action segment. @type {Map<string, number>} */
  static _segmentMovement = new Map();

  /** Skill-actions used this turn. @type {Map<string, number>} */
  static _moveActionTracker = new Map();

  /** Accumulated stamina cost not yet committed to the database. @type {Map<string, number>} */
  static _pendingStaminaCost = new Map();

  /** Clear all movement trackers (called on turn change). Flushes pending stamina first. */
  static clearTrackers() {
    this.flushStamina();
    this._segmentMovement.clear();
    this._moveActionTracker.clear();
  }

  /**
   * Consume an action for a combatant and reset their movement segment.
   * Flushes pending stamina before resetting.
   * @param {string} combatantId
   * @returns {number} New action count.
   */
  static consumeAction(combatantId) {
    this.flushStamina();
    const used = (this._moveActionTracker.get(combatantId) ?? 0) + 1;
    this._moveActionTracker.set(combatantId, used);
    this._segmentMovement.set(combatantId, 0);
    return used;
  }

  /**
   * Commit all pending stamina costs to the database and post chat messages.
   * Called on turn change, skill use, or any other boundary event.
   */
  static async flushStamina() {
    if (!this._pendingStaminaCost.size) return;

    for (const [actorId, cost] of this._pendingStaminaCost) {
      if (cost <= 0) continue;
      const actor = game.actors.get(actorId);
      if (!actor) continue;

      const newStamina = Math.max(0, actor.system.stamina.value - cost);
      await actor.update({ 'system.stamina.value': newStamina });

      const _isPC = game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
      const whisper = _isPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        ...whisper,
        content: `<p><em>${actor.name} spent ${cost} stamina on movement (${newStamina}/${actor.system.stamina.max})</em></p>`,
      });
    }
    this._pendingStaminaCost.clear();
  }

  /* -------------------------------------------- */

  /**
   * v14 movement hook: called before a movement is committed.
   * Return false to cancel the movement.
   */
  _preUpdateMovement(movement, operation) {
    // Only enforce during active combat.
    const combat = game.combat;
    if (!combat?.started) return;

    // Only validate once per movement (first segment).
    // Sub-segments (chain > 0) are part of the same move — let them through.
    if (movement.chain?.length > 0) return;

    const actor = this.actor;
    if (!actor?.system) return;

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
    const { walkRange, sprintRange } = this._getMovementRanges(actor);
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

    // Calculate distance from movement cost (v14 cost is in distance units).
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

    // Check stamina (account for pending costs not yet committed).
    const stamina = actor.system.stamina;
    const pendingCost = AspectsofPowerToken._pendingStaminaCost.get(actor.id) ?? 0;
    const availableStamina = stamina.value - pendingCost;
    let staminaCost = 0;
    for (let ft = segmentSoFar + 5; ft <= newSegmentTotal; ft += 5) {
      staminaCost += (ft <= walkRange) ? 1 : 3;
    }
    if (staminaCost > availableStamina) {
      ui.notifications.warn('Insufficient stamina to move!');
      return false;
    }

    // Store for _onUpdateMovement.
    this._pendingMovement = { combatantId: combatant.id, moveSnapped, newSegmentTotal, staminaCost, sprintRange };
  }

  /**
   * v14 movement hook: called after a movement commits.
   * Deduct stamina and update segment tracker.
   */
  _onUpdateMovement(movement, operation, user) {
    if (!this._pendingMovement) return;
    if (game.user.id !== user.id) return;

    const { combatantId, moveSnapped, newSegmentTotal, staminaCost, sprintRange } = this._pendingMovement;
    delete this._pendingMovement;

    const actor = this.actor;
    if (!actor) return;

    // Update tracker synchronously.
    AspectsofPowerToken._segmentMovement.set(combatantId, newSegmentTotal);

    // Track stamina cost locally — no database write during movement.
    // Accumulates in _pendingStaminaCost and commits on turn change or skill use.
    const actorId = actor.id;
    const existing = AspectsofPowerToken._pendingStaminaCost.get(actorId) ?? 0;
    AspectsofPowerToken._pendingStaminaCost.set(actorId, existing + staminaCost);
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  _getMovementBlocker(actor) {
    const blockTypes = ['root', 'immobilized', 'frozen', 'sleep', 'stun', 'paralysis'];
    return actor.effects.find(e =>
      !e.disabled && blockTypes.includes(e.flags?.['aspects-of-power']?.debuffType)
    );
  }

  _getMovementRanges(actor) {
    let walkRange = actor.system.walkRange ?? 0;
    let sprintRange = actor.system.sprintRange ?? 0;

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
