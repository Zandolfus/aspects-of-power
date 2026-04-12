/**
 * Extended TokenRuler for Aspects of Power.
 * Shows stamina cost on waypoint labels during movement.
 * @extends {foundry.canvas.placeables.tokens.TokenRuler}
 */
export class AspectsofPowerTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {

  static WAYPOINT_LABEL_TEMPLATE = 'systems/aspects-of-power/templates/hud/token-ruler-waypoint-label.hbs';

  /** @override */
  _getWaypointLabelContext(waypoint, state) {
    const context = super._getWaypointLabelContext(waypoint, state);
    if (!context) return context;

    const actor = this.token.actor;
    const combat = game.combat;

    // Only show stamina cost during active combat.
    if (!actor?.system || !combat?.started) {
      context.stamina = { display: false };
      return context;
    }

    // The cost is already in stamina (from our _getMovementCostFunction).
    const cost = waypoint.measurement?.cost ?? 0;
    context.stamina = {
      display: true,
      cost: isFinite(cost) ? Math.round(cost) : '---',
    };

    return context;
  }
}
