import { declareMovement, resolveMovementMode } from '../systems/celerity.mjs';

/**
 * Read the current Shift-key state from Foundry's keyboard manager. Used
 * to pick movement mode at drag-release / WASD-press time. Returns false
 * if the keyboard manager is not yet available (system init order).
 */
function _isShiftHeld() {
  const dk = game.keyboard?.downKeys;
  if (!dk) return false;
  return dk.has('ShiftLeft') || dk.has('ShiftRight') || dk.has('Shift');
}

/**
 * Extended TokenDocument for Aspects of Power.
 * Handles movement enforcement via v14's movement API.
 * @extends {foundry.documents.TokenDocument}
 */
export class AspectsofPowerToken extends foundry.documents.TokenDocument {

  /* -------------------------------------------- */
  /*  Movement Enforcement                        */
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

    // Any existing declaration is auto-overridden by this new movement
    // (per user 2026-05-11: players can change their mind at will).
    // preUpdateCombatant orphan-cleanup will dispose of any AOE region
    // that was placed by the prior action when declaredAction flips.
    const existing = combatant.flags?.aspectsofpower?.declaredAction;
    if (existing && existing.itemId) {
      combatant.update({
        'flags.aspectsofpower.declaredAction': null,
        'flags.aspectsofpower.nextActionTick': null,
      }).catch(err => console.warn('[celerity] override-clear failed:', err));
    }

    // Stamina cost from Foundry's movement-cost calculator. Our cost fn
    // (canvas/token._getMovementCostFunction) already applies mode and
    // encumbrance multipliers along the path — read the summed result here
    // and use it directly. Re-applying would double-charge.
    const mode = resolveMovementMode(_isShiftHeld() ? 'sprint' : 'walk');
    const staminaCost = Math.round((movement.passed?.cost ?? 0) + (movement.pending?.cost ?? 0));
    if (staminaCost > actor.system.stamina.value) {
      ui.notifications.warn(`${actor.name}: insufficient stamina (${actor.system.stamina.value}/${staminaCost} needed).`);
      return false;
    }

    // Distance traveled drives celerity wait. Gridless scene → continuous
    // feet; round to whole feet for cost-math + display, no 5-ft snap.
    const moveDist = (movement.passed?.distance ?? 0) + (movement.pending?.distance ?? 0);
    const moveFt = Math.round(moveDist);
    if (moveFt <= 0) return; // zero-distance update (e.g., elevation only) — let through

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
    declareMovement(actor, startPos, endPos, moveFt, staminaCost, mode.key).catch(err => {
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
}
