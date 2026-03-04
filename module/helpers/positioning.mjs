/**
 * Positional Tagging Utility
 *
 * Computes body-relative directional tags describing where an attacker stands
 * relative to a target token. Tags are stored on applied effects so that
 * positional relationships survive token rotation.
 *
 * Horizontal tags (overlapping 180° hemispheres, body-relative):
 *   'front'  — attacker is within the forward 180° arc
 *   'back'   — attacker is within the rear 180° arc
 *   'right'  — attacker is within the right 180° arc
 *   'left'   — attacker is within the left 180° arc
 *
 *   Cardinals (exactly 0°/90°/180°/270°) receive only the single matching tag.
 *   Quadrant positions receive two tags (e.g. front-right → ['front','right']).
 *
 * Within-footprint rules (attacker is directly above/below the target body):
 *   - Exact overhead (< 0.5 px horizontal offset): all four horizontal tags.
 *   - Over the front/back half only: 'front' or 'back' + 'right' or 'left'.
 *   - On a midline (localForward=0 or localRight=0): both tags for that axis.
 *
 * Elevation tags (additive, do not replace horizontal tags):
 *   'above'  — attacker elevation exceeds target elevation + target height
 *   'below'  — attacker elevation is below target elevation − target height
 *
 * Token height is derived from token.document.height (grid squares) × scene
 * distance (feet per square), giving a physically scaled threshold.
 *
 * Non-square token footprints: Foundry never rotates the occupied area, so the
 * footprint is always a canvas-axis rectangle (width × height squares). The
 * local projections correctly account for rotation when determining which body
 * half the attacker is over.
 */

/**
 * Compute positional tags for an attacker relative to a target.
 *
 * @param {Token} attackerToken   - The attacking token (canvas placeable).
 * @param {Token} targetToken     - The target token (canvas placeable).
 * @returns {string[]}            - Array of positional tags (may be empty if
 *                                  tokens are not on the canvas).
 */
export function getPositionalTags(attackerToken, targetToken) {
  if (!attackerToken?.center || !targetToken?.center) return [];

  const tags       = [];
  const squareSize = canvas.dimensions.size;
  const rotRad     = (targetToken.document.rotation ?? 0) * Math.PI / 180;

  // ── Elevation ──────────────────────────────────────────────────────────────
  // Threshold = target's physical height: grid-square height × feet per square.
  const targetHeightUnits = targetToken.document.height * (canvas.dimensions.distance ?? 5);
  const elevDiff = (attackerToken.document.elevation ?? 0)
                 - (targetToken.document.elevation ?? 0);

  if (elevDiff >  targetHeightUnits) tags.push('above');
  if (elevDiff < -targetHeightUnits) tags.push('below');

  // ── Horizontal offset in canvas space ──────────────────────────────────────
  const dx = attackerToken.center.x - targetToken.center.x;
  const dy = attackerToken.center.y - targetToken.center.y;
  const horizDist = Math.sqrt(dx * dx + dy * dy);

  // Foundry does not rotate the token's occupied area, so the footprint is
  // always a canvas-axis rectangle regardless of token.document.rotation.
  const halfCanvasX = targetToken.document.width  * squareSize / 2;
  const halfCanvasY = targetToken.document.height * squareSize / 2;
  const withinFootprint = Math.abs(dx) <= halfCanvasX && Math.abs(dy) <= halfCanvasY;

  if (withinFootprint) {
    // ── Within footprint ─────────────────────────────────────────────────────
    if (horizDist < 0.5) {
      // Essentially directly overhead — no meaningful direction, all four tags.
      tags.push('front', 'back', 'right', 'left');
    } else {
      // Project offset into token-local space.
      // localForward > 0 = in front of body centre; localRight > 0 = to the right.
      //
      // Foundry rotation 0 = image as-is; default token art faces south (+y).
      // Rotating by θ CW in canvas space (PIXI convention):
      //   forward unit vector = (−sin θ,  cos θ)   [south at θ=0]
      //   right   unit vector = (−cos θ, −sin θ)   [west  at θ=0, character's own right]
      const localForward = -dx * Math.sin(rotRad) + dy * Math.cos(rotRad);
      const localRight   = -dx * Math.cos(rotRad) - dy * Math.sin(rotRad);

      // Forward / back axis
      if      (localForward > 0) tags.push('front');
      else if (localForward < 0) tags.push('back');
      else { tags.push('front'); tags.push('back'); }  // on the lateral midline

      // Right / left axis
      if      (localRight > 0) tags.push('right');
      else if (localRight < 0) tags.push('left');
      else { tags.push('right'); tags.push('left'); }  // on the longitudinal midline
    }
  } else {
    // ── Outside footprint: angle-based tagging ────────────────────────────────
    const ray = new foundry.canvas.geometry.Ray(targetToken.center, attackerToken.center);

    // ray.angle = Math.atan2(dy, dx) in canvas space (+y down).
    // Convert to compass bearing: 0° = north (canvas up), 90° = east, clockwise.
    //   compass = (ray.angle_deg + 90 + 360) % 360
    const compassDeg = (ray.angle * 180 / Math.PI + 90 + 360) % 360;

    // Body-relative angle: 0° = facing direction, 90° = right, 180° = back, 270° = left.
    // Offset by 180° because default token art faces south (compass 180°) at rotation 0.
    const bodyAngle = (compassDeg - (targetToken.document.rotation ?? 0) - 180 + 720) % 360;

    // Cardinals receive exactly one tag; all other angles receive two.
    if      (bodyAngle === 0)   tags.push('front');
    else if (bodyAngle === 90)  tags.push('right');
    else if (bodyAngle === 180) tags.push('back');
    else if (bodyAngle === 270) tags.push('left');
    else {
      if (bodyAngle < 90 || bodyAngle > 270)          tags.push('front');
      if (bodyAngle > 90  && bodyAngle < 270)          tags.push('back');
      if (bodyAngle > 0   && bodyAngle < 180)          tags.push('right');
      if (bodyAngle > 180 && bodyAngle < 360)          tags.push('left');
    }
  }

  return tags;
}
