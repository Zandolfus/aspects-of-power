/**
 * Pure movement-path and realtime-clock math for the celerity movement layer.
 * No Foundry imports — node-testable (tests/run_pure_tests.mjs).
 *
 * The v14 movement rework (2026-08-09) replaces the old declare-cancel +
 * document-write-animation model with core planned movements:
 *   declare  → TokenDocument#move(path, {planned: true})   (nothing commits)
 *   run      → startMovement / resumeMovement              (core animates)
 *   pause    → pauseMovement                               (freezes at the
 *                                                            next checkpoint)
 * Checkpoints are the pause windows AND the commit granularity — core issues
 * one update operation per checkpoint, so the token's document position is
 * never more than one checkpoint behind the sprite (and v14 animates the
 * document position continuously anyway).
 */

/**
 * Build a straight-line waypoint path from startPos to endPos with a
 * checkpoint every `spacingPx` pixels. Every waypoint is a checkpoint —
 * that is the entire point: each one is a place the world can pause.
 *
 * The final waypoint is always exactly endPos (core auto-checkpoints the
 * last waypoint, we mark it anyway for uniformity). Intermediate points are
 * evenly spaced so no segment exceeds spacingPx — even spacing beats
 * fixed-stride-plus-remainder because it never produces a sliver segment.
 *
 * @param {{x: number, y: number}} startPos  Current token top-left (excluded)
 * @param {{x: number, y: number}} endPos    Destination top-left (included)
 * @param {number} spacingPx                 Max segment length in pixels
 * @returns {{x: number, y: number, checkpoint: boolean}[]}
 */
export function buildCheckpointPath(startPos, endPos, spacingPx) {
  const dx = endPos.x - startPos.x;
  const dy = endPos.y - startPos.y;
  const dist = Math.hypot(dx, dy);
  if (!(dist > 0)) return [{ x: endPos.x, y: endPos.y, checkpoint: true }];
  const segments = Math.max(1, Math.ceil(dist / Math.max(1, spacingPx)));
  const path = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    path.push({
      x: Math.round(startPos.x + dx * t),
      y: Math.round(startPos.y + dy * t),
      checkpoint: true,
    });
  }
  // Rounding must never displace the destination itself.
  path[path.length - 1] = { x: endPos.x, y: endPos.y, checkpoint: true };
  return path;
}

/**
 * Animation speed (in grid spaces per second — the unit Foundry's
 * Token#_getAnimationMovementSpeed returns) that makes a movement of
 * `distancePx` take exactly `waitTicks` of celerity time at the given
 * realtime rate. This is what couples the glide to the clock: a walk
 * declared for 800 ticks physically takes 800 ticks' worth of wall time.
 *
 * @param {number} distancePx  Total path length in pixels
 * @param {number} waitTicks   Celerity wait of the movement
 * @param {number} ticksPerMs  Realtime mapping (celerity ticks per wall ms)
 * @param {number} gridSize    Scene grid size in pixels
 * @returns {number} grid spaces per second (>= 0.05 so a glide never stalls)
 */
export function celerityAnimationSpeed(distancePx, waitTicks, ticksPerMs, gridSize) {
  if (!(distancePx > 0) || !(waitTicks > 0) || !(ticksPerMs > 0) || !(gridSize > 0)) return 0;
  const durationMs = waitTicks / ticksPerMs;
  const pxPerSec = distancePx / (durationMs / 1000);
  return Math.max(0.05, pxPerSec / gridSize);
}

/**
 * Linear-interpolate position at the given clockTick along a declared
 * movement. If currentTick >= scheduledTick, returns endPos; at or before
 * declaredAtTick, startPos. (Moved verbatim from systems/celerity.mjs in the
 * v14 rework so the execution layer can import it without a cycle —
 * celerity.mjs re-exports it for its existing consumers.)
 *
 * @param {{startPos:{x,y}, endPos:{x,y}, declaredAtTick:number, scheduledTick:number}} mv
 * @param {number} currentTick
 * @returns {{x:number, y:number}}
 */
export function interpolateMovementPosition(mv, currentTick) {
  const t0 = mv.declaredAtTick ?? 0;
  const t1 = mv.scheduledTick ?? t0;
  if (currentTick >= t1) return { x: mv.endPos.x, y: mv.endPos.y };
  if (currentTick <= t0 || t1 === t0) return { x: mv.startPos.x, y: mv.startPos.y };
  const frac = (currentTick - t0) / (t1 - t0);
  return {
    x: Math.round(mv.startPos.x + frac * (mv.endPos.x - mv.startPos.x)),
    y: Math.round(mv.startPos.y + frac * (mv.endPos.y - mv.startPos.y)),
  };
}

/**
 * The effective celerity clock tick. While the realtime loop runs, the clock
 * flows continuously between the committed flag writes:
 *
 *   effective = clockAtStart + (now - startedAtMs) × ticksPerMs
 *
 * The stored flag remains the authority at rest — the loop commits the
 * effective value back to the flag at every pause/fire boundary, so the two
 * never diverge across a state change. Declares made mid-run anchor at the
 * effective clock, which is what keeps their scheduledTick consistent with
 * the physical glide already in progress.
 *
 * @param {{running?: boolean, startedAtMs?: number, clockAtStart?: number,
 *          ticksPerMs?: number}|null|undefined} rt  The combat realtime flag
 * @param {number} nowMs      Current wall time (Date.now())
 * @param {number} storedTick The committed clockTick flag value
 * @returns {number} whole ticks (floored — the clock never runs backwards)
 */
export function effectiveClockTick(rt, nowMs, storedTick) {
  if (!rt?.running) return storedTick;
  const { startedAtMs, clockAtStart, ticksPerMs } = rt;
  if (!(ticksPerMs > 0) || !(nowMs >= startedAtMs)) return storedTick;
  const base = typeof clockAtStart === 'number' ? clockAtStart : storedTick;
  return Math.max(storedTick, Math.floor(base + (nowMs - startedAtMs) * ticksPerMs));
}
