/**
 * Extended TokenRuler for Aspects of Power.
 *
 * Waypoint label shows the current movement mode + cumulative stamina
 * cost during drag-preview. Post-2026-05-12: no more 3-action gate, no
 * walk/sprint zone split — single rate per mode, ruler updates live as
 * Shift state toggles.
 *
 * @extends {foundry.canvas.placeables.tokens.TokenRuler}
 */
function _isShiftHeld() {
  const dk = game.keyboard?.downKeys;
  if (!dk) return false;
  return dk.has('ShiftLeft') || dk.has('ShiftRight') || dk.has('Shift');
}

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

    const cost = waypoint.measurement?.cost ?? 0;
    const mode = _isShiftHeld() ? 'sprint' : 'walk';

    context.stamina = {
      display: true,
      cost: isFinite(cost) ? Math.round(cost) : '---',
      mode,
    };

    return context;
  }
}
