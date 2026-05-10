/**
 * Engagement halts — at every celerity-advance pause, check if any in-flight
 * movement should be truncated due to:
 *
 *   1. MELEE engagement: mover enters a hostile token's melee reach radius
 *      with line-of-sight. Halt at the reach boundary along the path.
 *
 *   2. FIRST-CONTACT LOS: mover (or hostile target) gains line-of-sight on
 *      a previously-unseen enemy at their new lerp position. Halt at the
 *      lerp position. Both establish "seen" so future LOS doesn't re-halt.
 *
 * Same-disposition and neutral (0) tokens never trigger halts. Only
 * opposite-disposition pairs (-1 hostile vs +1 friendly) engage.
 *
 * Friendly-on-friendly halts are pointless per design 2026-05-10 — allies
 * pass through formation, no auto-stop.
 *
 * Stealth is OUT of scope here — see pending-stealth-mechanics.md for the
 * future LOS-override that lets stealthed movers bypass first-contact.
 */

import { MOVEMENT_ITEM_ID, interpolateMovementPosition } from './celerity.mjs';

const FLAG_NS = 'aspectsofpower';

/**
 * Run engagement-halt checks for every in-flight movement at the given
 * clock tick. Mutates combatant flags in-place to truncate halted movements
 * and posts chat notifications.
 *
 * Call this in `_onCelAdvance` BEFORE the parallel-animation step so the
 * tokens animate to their (possibly truncated) positions.
 *
 * @param {Combat} combat
 * @param {number} newClock
 */
export async function checkEngagementHalts(combat, newClock) {
  if (!combat?.started) return;

  const halts = [];
  for (const mover of combat.combatants) {
    const mv = mover.flags?.[FLAG_NS]?.declaredAction;
    if (!mv || mv.itemId !== MOVEMENT_ITEM_ID) continue;
    const moverTok = mover.token;
    if (!moverTok) continue;

    const halt = _evaluateHaltsForMover(combat, mover, moverTok, mv, newClock);
    if (halt) halts.push(halt);
  }

  // Apply updates after evaluation pass — keeps the read state consistent
  // for all movers (neither sees the other's mid-pass mutation).
  for (const halt of halts) {
    await _applyHalt(combat, halt);
  }
}

/**
 * Evaluate both halt triggers for one mover. Returns the EARLIEST halt
 * (smallest scheduledTick) found, or null if no halt fires.
 */
function _evaluateHaltsForMover(combat, mover, moverTok, mv, newClock) {
  const newPos = interpolateMovementPosition(mv, newClock);
  const moverDisp = moverTok.disposition;
  const moverSeen = new Set(mover.flags?.[FLAG_NS]?.firstContactSeen ?? []);

  let best = null;
  for (const enemy of combat.combatants) {
    if (enemy === mover) continue;
    const enemyTok = enemy.token;
    if (!enemyTok) continue;
    if (!_isOppositeDisposition(moverDisp, enemyTok.disposition)) continue;

    // Enemy's current position — lerp if also moving, else doc x/y.
    const enemyMv = enemy.flags?.[FLAG_NS]?.declaredAction;
    const enemyPos = (enemyMv?.itemId === MOVEMENT_ITEM_ID)
      ? interpolateMovementPosition(enemyMv, newClock)
      : { x: enemyTok.x, y: enemyTok.y };

    // Center coordinates for distance and LOS math.
    const moverCenter = _addCenter(newPos, moverTok);
    const enemyCenter = _addCenter(enemyPos, enemyTok);

    // ── Melee engagement halt ────────────────────────────────────────────
    const reachPx = _computeThreatRadiusPx(enemyTok);
    const distPx = Math.hypot(enemyCenter.x - moverCenter.x, enemyCenter.y - moverCenter.y);
    if (distPx <= reachPx && _hasLOS(enemyCenter, moverCenter)) {
      const haltPos = _findReachBoundary(mv.startPos, newPos, enemyPos, reachPx, moverTok, enemyTok);
      if (haltPos) {
        const trunc = _truncateMovement(mv, haltPos);
        if (!best || trunc.scheduledTick < best.scheduledTick) {
          best = {
            type: 'melee',
            mover, enemy,
            haltPos: trunc.haltPos,
            wait: trunc.wait,
            scheduledTick: trunc.scheduledTick,
            distFt: trunc.distFt,
          };
        }
      }
    }

    // ── First-contact LOS halt ───────────────────────────────────────────
    const enemySeenSet = new Set(enemy.flags?.[FLAG_NS]?.firstContactSeen ?? []);
    const alreadySeen = moverSeen.has(enemy.id) || enemySeenSet.has(mover.id);
    if (!alreadySeen && _hasLOS(moverCenter, enemyCenter)) {
      const trunc = _truncateMovement(mv, newPos);
      if (!best || trunc.scheduledTick < best.scheduledTick) {
        best = {
          type: 'sight',
          mover, enemy,
          haltPos: trunc.haltPos,
          wait: trunc.wait,
          scheduledTick: trunc.scheduledTick,
          distFt: trunc.distFt,
        };
      }
    }
  }
  return best;
}

/**
 * Apply a halt: truncate the mover's declaredAction, mark first-contact
 * (if sight halt), post chat message.
 */
async function _applyHalt(combat, halt) {
  const { mover, enemy, type, haltPos, wait, scheduledTick, distFt } = halt;
  const mv = mover.flags[FLAG_NS].declaredAction;
  const labelSuffix = type === 'melee' ? ` (engaged ${enemy.name})` : ` (spotted ${enemy.name})`;
  const newDeclared = {
    ...mv,
    endPos: haltPos,
    wait,
    scheduledTick,
    distanceFt: Math.round(distFt),
    label: mv.label.replace(/ \(engaged .+\)| \(spotted .+\)/, '') + labelSuffix,
  };
  const update = {
    [`flags.${FLAG_NS}.declaredAction`]: newDeclared,
    [`flags.${FLAG_NS}.nextActionTick`]: scheduledTick,
  };

  if (type === 'sight') {
    const moverSeen = new Set(mover.flags?.[FLAG_NS]?.firstContactSeen ?? []);
    moverSeen.add(enemy.id);
    update[`flags.${FLAG_NS}.firstContactSeen`] = [...moverSeen];
    // Also mark the enemy as having seen the mover (mutual establishment).
    const enemySeen = new Set(enemy.flags?.[FLAG_NS]?.firstContactSeen ?? []);
    enemySeen.add(mover.id);
    await enemy.update({ [`flags.${FLAG_NS}.firstContactSeen`]: [...enemySeen] });
  }

  await mover.update(update);

  const causeText = type === 'melee'
    ? `entered melee reach of <strong>${enemy.name}</strong>`
    : `spotted <strong>${enemy.name}</strong> for the first time`;
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: mover.actor }),
    content: `<p><em>${mover.name} ${causeText} — movement halted at ${Math.round(distFt)}ft, arriving tick ${scheduledTick}.</em></p>`,
  });
}

/**
 * Reset firstContactSeen flags on all combatants for a fresh combat.
 * Call from `combatStart` hook so each new encounter starts with no
 * "already seen" memory carrying over.
 */
export async function resetFirstContactSeen(combat) {
  if (!combat) return;
  for (const member of combat.combatants) {
    if ((member.flags?.[FLAG_NS]?.firstContactSeen ?? []).length === 0) continue;
    await member.update({ [`flags.${FLAG_NS}.firstContactSeen`]: [] });
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Same disposition or one of them is neutral → no halt. Only -1↔+1 triggers. */
function _isOppositeDisposition(a, b) {
  return (a === 1 && b === -1) || (a === -1 && b === 1);
}

/** Add token-center offset to a top-left position. */
function _addCenter(pos, tokenDoc) {
  const w = (tokenDoc.width ?? 1) * canvas.grid.size;
  const h = (tokenDoc.height ?? 1) * canvas.grid.size;
  return { x: pos.x + w / 2, y: pos.y + h / 2 };
}

/**
 * Threat radius for a token: their equipped weapon's reach in pixels,
 * defaulting to 5ft (one grid square at standard scale) for unarmed.
 */
function _computeThreatRadiusPx(tokenDoc) {
  const actor = tokenDoc.actor;
  let reachFt = 5;
  if (actor?.items) {
    const equipped = actor.items.find(i =>
      i.type === 'item' && i.system?.equipped && i.system?.slot === 'weaponry'
    );
    if (equipped?.system?.reach) reachFt = Math.max(5, equipped.system.reach);
  }
  const pxPerFt = canvas.grid.size / canvas.grid.distance;
  return reachFt * pxPerFt;
}

/**
 * LOS via wall-collision raycast. Returns true if NO sight-blocking wall
 * lies between the two canvas-coordinate points.
 */
function _hasLOS(p1, p2) {
  try {
    const collides = foundry.canvas.geometry.ClockwiseSweepPolygon.testCollision(
      p1, p2, { type: 'sight', mode: 'any' }
    );
    return !collides;
  } catch (e) {
    // If the raycast API fails (no scene walls, weird scene), default to LOS=true.
    return true;
  }
}

/**
 * Find the first point along path (start → end) where the path enters
 * a circle of `radiusPx` around `enemyPos` (centers added). Returns the
 * top-left position for the mover at that point, or null if no intersection.
 *
 * Math: parametric line from mover-center to mover-center-at-end, solve
 * quadratic for t where |P(t) - enemyCenter| = radiusPx.
 */
function _findReachBoundary(startPos, endPos, enemyPos, radiusPx, moverTok, enemyTok) {
  const moverCx = (moverTok.width ?? 1) * canvas.grid.size / 2;
  const moverCy = (moverTok.height ?? 1) * canvas.grid.size / 2;
  const enemyCx = (enemyTok.width ?? 1) * canvas.grid.size / 2;
  const enemyCy = (enemyTok.height ?? 1) * canvas.grid.size / 2;

  const sx = startPos.x + moverCx, sy = startPos.y + moverCy;
  const ex = endPos.x   + moverCx, ey = endPos.y   + moverCy;
  const enx = enemyPos.x + enemyCx, eny = enemyPos.y + enemyCy;

  const dx = ex - sx, dy = ey - sy;
  const fx = sx - enx, fy = sy - eny;
  const a = dx*dx + dy*dy;
  if (a < 0.001) return null; // zero-length path
  const b = 2 * (fx*dx + fy*dy);
  const c = fx*fx + fy*fy - radiusPx*radiusPx;
  const disc = b*b - 4*a*c;
  if (disc < 0) return null;

  const sqd = Math.sqrt(disc);
  const t1 = (-b - sqd) / (2*a);
  const t2 = (-b + sqd) / (2*a);
  let t = null;
  if (t1 >= 0 && t1 <= 1) t = t1;
  else if (t2 >= 0 && t2 <= 1) t = t2;
  if (t === null) return null;

  return {
    x: Math.round(startPos.x + t * (endPos.x - startPos.x)),
    y: Math.round(startPos.y + t * (endPos.y - startPos.y)),
  };
}

/**
 * Recompute wait/scheduledTick for a movement truncated to `haltPos`.
 * Wait is prorated by (haltDist / totalDist); minimum 1 tick.
 */
function _truncateMovement(mv, haltPos) {
  const totalDx = mv.endPos.x - mv.startPos.x;
  const totalDy = mv.endPos.y - mv.startPos.y;
  const totalDist = Math.hypot(totalDx, totalDy);
  const haltDx = haltPos.x - mv.startPos.x;
  const haltDy = haltPos.y - mv.startPos.y;
  const haltDist = Math.hypot(haltDx, haltDy);
  const ratio = totalDist > 0 ? Math.min(1, haltDist / totalDist) : 0;
  const wait = Math.max(1, Math.round(mv.wait * ratio));
  const scheduledTick = (mv.declaredAtTick ?? 0) + wait;
  // Distance in feet (for chat / label) — scale by per-foot ratio derived
  // from the original declared distance.
  const fullDistFt = mv.distanceFt ?? 0;
  const distFt = fullDistFt * ratio;
  return { haltPos, wait, scheduledTick, distFt };
}
