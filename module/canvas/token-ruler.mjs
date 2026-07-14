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
import { getActiveMovementMode } from '../systems/celerity.mjs';

export class AspectsofPowerTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {

  static WAYPOINT_LABEL_TEMPLATE = 'systems/aspects-of-power/templates/hud/token-ruler-waypoint-label.hbs';

  /** @override */
  _getWaypointLabelContext(waypoint, state) {
    const context = super._getWaypointLabelContext(waypoint, state);
    if (!context) return context;

    const actor = this.token.actor;
    if (!actor?.system) {
      context.stamina = { display: false };
      return context;
    }

    // Mode shows ALWAYS (movement UX 2026-07-14 — players must be able to see
    // how they're moving); stamina cost only in combat, where it's charged.
    const combat = game.combat;
    const mode = getActiveMovementMode(actor);
    const cost = waypoint.measurement?.cost ?? 0;

    context.stamina = {
      display: true,
      cost: combat?.started ? (isFinite(cost) ? Math.round(cost) : '---') : '',
      mode,
    };

    return context;
  }
}
