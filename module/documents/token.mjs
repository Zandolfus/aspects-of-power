import { declareMovement } from '../systems/celerity.mjs';

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
   * Persist pending stamina costs to the database and post chat messages.
   * In-memory values are already correct — this syncs the database + other clients.
   * Called on turn change, skill use, or any other boundary event.
   */
  static async flushStamina() {
    if (!this._pendingStaminaCost.size) return;

    for (const [actorId, cost] of this._pendingStaminaCost) {
      if (cost <= 0) continue;
      const actor = game.actors.get(actorId);
      if (!actor) continue;

      // In-memory value already subtracted — just persist it.
      await actor.update({ 'system.stamina.value': actor.system.stamina.value });

      const _isPC = game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
      const whisper = _isPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        ...whisper,
        content: `<p><em>${actor.name} spent ${cost} stamina on movement (${actor.system.stamina.value}/${actor.system.stamina.max})</em></p>`,
      });
    }
    this._pendingStaminaCost.clear();
  }

  /* -------------------------------------------- */

  /**
   * v14 movement hook: called before a movement is committed.
   *
   * In active combat this hook DECLARES the movement onto the celerity stack
   * and CANCELS the immediate position update — the sprite stays put until
   * the celerity advance handler reaches the move's scheduled tick (with
   * intermediate animate-on-pause for parallel motion across actors).
   *
   * Outside combat, returns undefined → Foundry commits the move normally.
   *
   * Return false → cancel the move. Return undefined → let Foundry commit.
   */
  _preUpdateMovement(movement, operation) {
    // Bypass for celerity-driven commits (the advance handler animating
    // tokens to interpolated positions). Without this flag, our own
    // token.update({x, y}) would recurse back through this hook and try to
    // re-declare the same movement.
    if (operation?._celerityCommit) return;

    // Only intercept during active combat.
    const combat = game.combat;
    if (!combat?.started) return;

    // Only intervene on the first segment. Sub-segments are part of the same
    // physical drag; cancelling the first prevents any sub-segment from
    // committing.
    if (movement.chain?.length > 0) return;

    const actor = this.actor;
    if (!actor?.system) return;

    const combatant = combat.combatants.find(
      c => c.tokenId === this.id && c.sceneId === this.parent?.id
    );
    if (!combatant) return;

    // Block movement for debuffs (root, immobilized, frozen, sleep, stun, paralysis).
    const moveBlocker = this._getMovementBlocker(actor);
    if (moveBlocker) {
      const typeName = game.i18n.localize(
        CONFIG.ASPECTSOFPOWER.debuffTypes[moveBlocker.system?.debuffType] ?? 'Debuff'
      );
      ui.notifications.warn(`${actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotMove')} (${typeName})`);
      return false;
    }

    // Refuse if the actor already has any declared action queued (movement or
    // skill). Player must cancel the existing one first — celerity allows
    // exactly one declaration at a time per actor.
    const existing = combatant.flags?.aspectsofpower?.declaredAction;
    if (existing && existing.itemId) {
      ui.notifications.warn(`${actor.name} already has "${existing.label}" queued. Cancel it first before declaring movement.`);
      return false;
    }

    // Stamina cost from Foundry's movement-cost calculator.
    const staminaCost = Math.round((movement.passed?.cost ?? 0) + (movement.pending?.cost ?? 0));
    if (staminaCost > actor.system.stamina.value) {
      ui.notifications.warn(`${actor.name}: insufficient stamina (${actor.system.stamina.value}/${staminaCost} needed).`);
      return false;
    }

    // Distance traveled (snapped to grid) drives celerity wait.
    const moveDist = (movement.passed?.distance ?? 0) + (movement.pending?.distance ?? 0);
    const moveSnapped = Math.round(moveDist / 5) * 5;
    if (moveSnapped <= 0) return; // zero-distance update (e.g., elevation only) — let through

    // Resolve start + end canvas coordinates. Start = current document
    // position (token hasn't moved yet); end = movement.destination if
    // present, else inferred from the pending segment.
    const startPos = { x: this.x, y: this.y };
    const endPos = {
      x: movement.destination?.x ?? movement.pending?.x ?? this.x,
      y: movement.destination?.y ?? movement.pending?.y ?? this.y,
    };

    // Wall-collision cancel. Per user 2026-05-11: a movement that would
    // pass through a movement-blocking wall should be refused outright,
    // not silently truncated. Foundry's drag tool pre-clips against
    // walls, but keyboard-buffer moves and programmatic declares can
    // still propose wall-crossing paths. Center-to-center collision test
    // covers both cases.
    const w = (this.width ?? 1) * canvas.grid.size;
    const h = (this.height ?? 1) * canvas.grid.size;
    const startCenter = { x: startPos.x + w / 2, y: startPos.y + h / 2 };
    const endCenter = { x: endPos.x + w / 2, y: endPos.y + h / 2 };
    let blocked = false;
    try {
      blocked = foundry.canvas.geometry.ClockwiseSweepPolygon.testCollision(
        startCenter, endCenter, { type: 'move', mode: 'any' }
      );
    } catch { /* if the test errors (no walls layer / etc.), permit the move */ }
    if (blocked) {
      ui.notifications.warn(`${actor.name}: movement path blocked by wall — declare cancelled.`);
      return false;
    }

    // Declare on the celerity stack. The `await` runs async after we return
    // false; that's fine — the cancellation is synchronous, the declaration
    // can settle on its own.
    declareMovement(actor, startPos, endPos, moveSnapped, staminaCost).catch(err => {
      console.error('declareMovement failed:', err);
    });

    // Cancel the immediate position commit. The celerity advance handler
    // will animate + persist the position when the scheduled tick fires.
    return false;
  }

  /**
   * v14 movement hook: called after a movement commits.
   *
   * In combat we cancel commits via `_preUpdateMovement` so this only fires
   * for out-of-combat moves and for the celerity-driven commits we issue
   * ourselves at execute time. Both cases need no special handling here —
   * the position is already the canonical state.
   */
  _onUpdateMovement(_movement, _operation, _user) {
    // No-op in the new movement-as-action model. Stamina debit and tracker
    // updates happen in the celerity advance handler at execute time.
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  _getMovementBlocker(actor) {
    const blockTypes = ['root', 'immobilized', 'frozen', 'sleep', 'stun', 'paralysis'];
    return actor.effects.find(e =>
      !e.disabled && blockTypes.includes(e.system?.debuffType)
    );
  }

  _getMovementRanges(actor) {
    let walkRange = actor.system.walkRange ?? 0;
    let sprintRange = actor.system.sprintRange ?? 0;

    const chilledEffect = actor.effects.find(e =>
      !e.disabled && e.system?.debuffType === 'chilled'
    );
    if (chilledEffect) {
      const debuffRoll   = chilledEffect.system?.debuffDamage ?? 0;
      const enduranceMod = actor.system.abilities?.endurance?.mod ?? 0;
      const reduction    = Math.max(0, debuffRoll - enduranceMod);
      walkRange   = Math.max(0, walkRange - reduction);
      sprintRange = Math.max(0, sprintRange - reduction);
    }

    return { walkRange, sprintRange };
  }
}
