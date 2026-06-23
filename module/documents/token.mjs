import { declareMovement, resolveMovementMode, clampMoveNoOverlap } from '../systems/celerity.mjs';

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
    // Bypass for movement-skill primitives (Teleport / Leap) — these are
    // discrete relocations driven by their own skill handler at fire time;
    // they must not re-enter the regular movement-declare pipeline (which
    // would queue a NEW Move on the celerity stack and skip the actual
    // relocation, leaving the token where it was).
    if (operation?._aopTeleport || operation?._aopLeap) return;
    // Bypass the no-stacking re-issue below (avoids recursing on our own
    // clamped update).
    if (operation?._aopNoStackClamp) return;

    const combat = game.combat;
    if (!combat?.started) {
      // Out of combat there's no celerity declare, but the no-stacking rule
      // still applies: a token may pass THROUGH others but must not END
      // overlapping one. Clamp the landing (stop short) and re-issue the
      // shortened move; passthrough during the drag animation is unaffected.
      if (movement.chain?.length > 0) return; // only the first segment
      const from = { x: this.x, y: this.y };
      const dest = {
        x: movement.destination?.x ?? movement.pending?.x ?? this.x,
        y: movement.destination?.y ?? movement.pending?.y ?? this.y,
      };
      const clamped = clampMoveNoOverlap(this, from, dest);
      if (clamped.x !== dest.x || clamped.y !== dest.y) {
        this.update(
          { x: clamped.x, y: clamped.y },
          { _aopNoStackClamp: true, animation: { duration: 200 } }
        ).catch(err => console.error('[no-stack] out-of-combat clamp failed:', err));
        return false; // cancel the original; the clamped re-issue lands instead
      }
      return; // destination already clear — let Foundry commit normally
    }

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
    // EXCEPT: leap-in-flight is committed motion (Newton's first law —
    // the actor is conceptually mid-air during the celerity wait between
    // declare and fire). Refuse the new movement until the leap resolves.
    // preUpdateCombatant orphan-cleanup will dispose of any AOE region
    // that was placed by the prior action when declaredAction flips.
    const existing = combatant.flags?.aspectsofpower?.declaredAction;
    if (existing && existing.itemId && existing.uncancellable) {
      ui.notifications.warn(`${actor.name} is mid-${existing.label} — cannot redirect until it resolves.`);
      return false;
    }
    // A cancellable existing declaration is overwritten wholesale by the
    // declareMovement call below (a single atomic combatant.update). The old
    // code ALSO fired an un-awaited null-clear here; that raced the (also
    // un-awaited) declareMovement write on the same flag, and the clear won —
    // so re-declares cancelled the move without ever writing the replacement.
    // declareMovement overwrites declaredAction + nextActionTick outright, so
    // the separate clear was redundant; removing it eliminates the race.

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
