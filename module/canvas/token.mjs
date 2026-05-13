/**
 * Extended canvas Token for Aspects of Power.
 *
 * Overrides Foundry's movement-cost function so the ruler-preview shows
 * the same stamina cost the celerity declare path will actually charge.
 *
 * Cost model (post-2026-05-12 modes ship):
 *   stamina_per_ft = 0.2 × mode.staminaMult × (1 + carryRatio)
 *
 * Where 0.2 stamina/ft = 1 stamina per 5ft is the baseline sprint anchor.
 * Walk halves this; encumbrance scales proportionally. No hard distance
 * cap — movement is one action no matter how long, paid in celerity ticks
 * at declare time. Gridless: continuous feet, no zone split.
 *
 * @extends {foundry.canvas.placeables.Token}
 */
import { resolveMovementMode } from '../systems/celerity.mjs';

function _isShiftHeld() {
  const dk = game.keyboard?.downKeys;
  if (!dk) return false;
  return dk.has('ShiftLeft') || dk.has('ShiftRight') || dk.has('Shift');
}

export class AspectsofPowerTokenObject extends foundry.canvas.placeables.Token {

  /**
   * Override the movement cost function so Foundry's ruler-preview shows
   * the same stamina the celerity declare-path will actually charge on
   * commit. Mode picked from current Shift state — drag-preview updates
   * live as the player presses/releases Shift.
   *
   * @param {object} options
   * @returns {Function} Cost function: (from, to, distance, segment) => cost
   */
  _getMovementCostFunction(options) {
    const actor = this.document.actor;
    if (!actor?.system) return super._getMovementCostFunction(options);

    // Out of combat — fall back to Foundry's default cost (distance).
    const combat = game.combat;
    if (!combat?.started) return super._getMovementCostFunction(options);

    // Stack any difficult-terrain modifier on top of our per-ft rate.
    const terrainCostFn = CONFIG.Token.movement.TerrainData.getMovementCostFunction(this.document, options);

    return (from, to, distance, segment) => {
      // Terrain modifies the effective distance (difficult terrain = ×2).
      const effectiveDist = terrainCostFn(from, to, distance, segment);
      // Pick mode + encumbrance live from current state. The ruler refreshes
      // continuously during drag, so Shift toggles and item-weight changes
      // are reflected immediately.
      const mode = resolveMovementMode(_isShiftHeld() ? 'sprint' : 'walk');
      const carryRatio = Math.max(0, actor.system.carryRatio ?? 0);
      const encumbranceMult = 1 + carryRatio;
      // Sprint baseline: 1 stamina per 5ft = 0.2 stamina/ft.
      return effectiveDist * 0.2 * mode.staminaMult * encumbranceMult;
    };
  }
}
