/**
 * Extended canvas Token for Aspects of Power.
 * Overrides the movement cost function to integrate stamina costs
 * with Foundry's native ruler and movement system.
 * @extends {foundry.canvas.placeables.Token}
 */
export class AspectsofPowerTokenObject extends foundry.canvas.placeables.Token {

  /**
   * Override the movement cost function to use the system's stamina model.
   * Walk zone: 1 stamina per grid unit of distance.
   * Sprint zone: 3 stamina per grid unit of distance.
   * Beyond sprint range: Infinity (blocked).
   *
   * The function is called per grid cell along the path, so we use a closure
   * to track cumulative distance and switch from walk to sprint costs.
   *
   * @param {object} options
   * @returns {Function} Cost function: (from, to, distance, segment) => cost
   */
  _getMovementCostFunction(options) {
    const actor = this.document.actor;
    if (!actor?.system) return super._getMovementCostFunction(options);

    // No combat or GM using unconstrained movement — use default cost.
    const combat = game.combat;
    if (!combat?.started) return super._getMovementCostFunction(options);

    const TokenClass = CONFIG.Token.documentClass;

    // Get combatant for this token.
    const combatant = combat.combatants.find(
      c => c.tokenId === this.document.id && c.sceneId === this.document.parent?.id
    );
    if (!combatant) return super._getMovementCostFunction(options);

    // Get movement ranges (with chilled reduction from TokenDocument).
    let walkRange = actor.system.walkRange ?? 35;
    let sprintRange = actor.system.sprintRange ?? 70;

    // Apply chilled reduction.
    const chilledEffect = actor.effects.find(e =>
      !e.disabled && e.system?.debuffType === 'chilled'
    );
    if (chilledEffect) {
      const debuffRoll = chilledEffect.system?.debuffDamage ?? 0;
      const enduranceMod = actor.system.abilities?.endurance?.mod ?? 0;
      const reduction = Math.max(0, debuffRoll - enduranceMod);
      walkRange = Math.max(0, walkRange - reduction);
      sprintRange = Math.max(0, sprintRange - reduction);
    }

    // Get the cumulative distance already moved this segment.
    const segmentSoFar = TokenClass._segmentMovement?.get(combatant.id) ?? 0;

    // Get terrain cost function for stacking with difficult terrain.
    const terrainCostFn = CONFIG.Token.movement.TerrainData.getMovementCostFunction(this.document, options);

    // Accumulated distance within this cost function evaluation.
    let accumulated = segmentSoFar;

    return (from, to, distance, segment) => {
      // Apply terrain modifiers first (e.g., difficult terrain doubles distance).
      const terrainCost = terrainCostFn(from, to, distance, segment);

      // Check if we've exceeded sprint range.
      if (accumulated + terrainCost > sprintRange) return Infinity;

      // Determine stamina cost based on walk/sprint zone.
      let staminaCost = 0;
      const startDist = accumulated;
      accumulated += terrainCost;

      // Calculate per-unit cost stepping through walk → sprint threshold.
      for (let ft = startDist + 5; ft <= accumulated; ft += 5) {
        staminaCost += (ft <= walkRange) ? 1 : 3;
      }

      // Handle partial steps (if terrainCost isn't a multiple of 5).
      if (staminaCost === 0 && terrainCost > 0) {
        staminaCost = (accumulated <= walkRange) ? 1 : 3;
      }

      return staminaCost;
    };
  }
}
