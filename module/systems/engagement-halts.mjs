/**
 * Engagement halts — at every celerity-advance pause, check if any in-flight
 * movement should be truncated due to:
 *
 *   1. MELEE engagement: a moving actor's path will come within
 *      max(reachA, reachB) of an opposing actor. Solved ANALYTICALLY by
 *      finding the first tick `t*` where the two actors' positions are at
 *      engagement distance, then halting BOTH at `t*`. Per-side independent
 *      lerp-based halts (the prior approach) gave wrong distances when both
 *      parties were moving — each halt was computed against a stale
 *      snapshot of the other's pre-halt lerp position.
 *
 *   2. FIRST-CONTACT LOS: mover (or hostile target) gains line-of-sight on
 *      a previously-unseen enemy at their lerp position at the current
 *      pause. Halt at lerp(newClock). Both establish "seen" so future LOS
 *      doesn't re-halt during the same combat.
 *
 * Same-disposition and neutral (0) tokens never trigger halts.
 *
 * Engagement distance = max(reach_A, reach_B) per design 2026-05-10.
 * Long-reach weapons control the engagement: Phil's greatsword (10ft) halts
 * a Skink at 10ft, even though the Skink's claws reach only 5ft. The Skink
 * would need to close another 5ft to retaliate.
 *
 * Stealth is OUT of scope — see pending-stealth-mechanics.md.
 */

import { MOVEMENT_ITEM_ID, interpolateMovementPosition } from './celerity.mjs';

const FLAG_NS = 'aspectsofpower';

/**
 * Run engagement-halt checks at the given clock tick. Mutates combatant
 * flags in-place to truncate halted movements and posts chat notifications.
 *
 * Call this in `_onCelAdvance` BEFORE the parallel-animation step so the
 * tokens animate to their (possibly truncated) positions.
 *
 * @param {Combat} combat
 * @param {number} newClock
 */
export async function checkEngagementHalts(combat, newClock) {
  if (!combat?.started) return;

  // Build the set of all in-flight movements. Skip movements that have
  // already been halted (`halted: true` flag set by _applyHalt) — without
  // this skip, the next advance re-evaluates the same path against the
  // same opponent and the truncated endPos still sits inside the reach
  // circle, firing duplicate halts at the same tick. The combat log
  // showed Gabriel halting at the same Stalker / Brute 2-3 times.
  const inFlight = combat.combatants.contents
    .map(c => ({ cm: c, mv: c.flags?.[FLAG_NS]?.declaredAction }))
    .filter(e => e.mv?.itemId === MOVEMENT_ITEM_ID && e.cm.token && !e.mv.halted);

  // Per-combatant earliest halt across all engagements they're part of.
  // combatantId → { type, cause, haltPos, scheduledTick, wait }
  const haltsByCombatantId = new Map();

  // Iterate every (mover, opponent) pair (opposing disposition only).
  // Opponent might or might not be in flight themselves.
  for (const moverEntry of inFlight) {
    const moverDisp = moverEntry.cm.token.disposition;
    for (const opponent of combat.combatants) {
      if (opponent.id === moverEntry.cm.id) continue;
      if (!opponent.token) continue;
      if (!_isOppositeDisposition(moverDisp, opponent.token.disposition)) continue;

      const evalResult = _evaluatePair(moverEntry, opponent, newClock);
      if (!evalResult) continue;

      // Update each side's earliest halt.
      if (evalResult.moverHalt) {
        _setEarliestHalt(haltsByCombatantId, moverEntry.cm.id, evalResult.moverHalt);
      }
      if (evalResult.opponentHalt) {
        _setEarliestHalt(haltsByCombatantId, opponent.id, evalResult.opponentHalt);
      }
    }
  }

  // Apply halts. Each combatant gets its single earliest halt.
  for (const [cmId, haltInfo] of haltsByCombatantId) {
    await _applyHalt(combat, cmId, haltInfo);
  }
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
/*  Pair evaluation (analytical first-touch + LOS first-contact)       */
/* ------------------------------------------------------------------ */

/**
 * Evaluate one (mover, opponent) pair. Returns the halt info for each side
 * (moverHalt, opponentHalt). opponentHalt is null when the opponent is
 * stationary.
 *
 * Considers BOTH triggers:
 *   - Melee: analytical first-touch at distance max(reachA, reachB)
 *   - First-contact LOS: snap check at newClock (mover lerp vs opp lerp)
 * Returns the earlier of the two for each side.
 */
function _evaluatePair(moverEntry, opponentCm, newClock) {
  const mover = moverEntry.cm;
  const moverMv = moverEntry.mv;
  const moverTok = mover.token;
  const oppTok = opponentCm.token;

  const moverReachPx = _computeThreatRadiusPx(moverTok);
  const oppReachPx = _computeThreatRadiusPx(oppTok);
  const engageDistPx = Math.max(moverReachPx, oppReachPx);

  const moverStartC = _addCenter(moverMv.startPos, moverTok);
  const moverEndC = _addCenter(moverMv.endPos, moverTok);

  const oppMv = (opponentCm.flags?.[FLAG_NS]?.declaredAction?.itemId === MOVEMENT_ITEM_ID)
    ? opponentCm.flags[FLAG_NS].declaredAction
    : null;
  const oppStartC = oppMv ? _addCenter(oppMv.startPos, oppTok) : { x: oppTok.x + (oppTok.width ?? 1) * canvas.grid.size / 2, y: oppTok.y + (oppTok.height ?? 1) * canvas.grid.size / 2 };
  const oppEndC = oppMv ? _addCenter(oppMv.endPos, oppTok) : oppStartC;

  // ── Melee engagement: analytical first-touch ─────────────────────────
  const meleeTouch = _solveFirstTouch(
    moverStartC, moverEndC, moverMv.declaredAtTick, moverMv.scheduledTick,
    oppStartC, oppEndC,
    oppMv ? oppMv.declaredAtTick : 0,
    oppMv ? oppMv.scheduledTick : Infinity,
    engageDistPx
  );

  let moverHalt = null;
  let opponentHalt = null;

  if (meleeTouch && _hasLOS(meleeTouch.aPos, meleeTouch.bPos)) {
    moverHalt = {
      type: 'melee',
      cause: opponentCm,
      haltPos: _topLeftFromCenter(meleeTouch.aPos, moverTok),
      scheduledTick: meleeTouch.tickT,
      wait: Math.max(1, meleeTouch.tickT - moverMv.declaredAtTick),
    };
    if (oppMv) {
      opponentHalt = {
        type: 'melee',
        cause: mover,
        haltPos: _topLeftFromCenter(meleeTouch.bPos, oppTok),
        scheduledTick: meleeTouch.tickT,
        wait: Math.max(1, meleeTouch.tickT - oppMv.declaredAtTick),
      };
    }
  }

  // ── First-contact LOS halt: snap check at newClock ───────────────────
  // (Less precise than analytical first-touch — fires when at newClock the
  // mover is now seeing or being seen by an unseen enemy. Halt at lerp pos.)
  // ONLY friendly-disposition movers halt on first sight — hostiles
  // shouldn't pause every time their pathing peeks around a corner. Per
  // user feedback 2026-05-11: combats were drowning in LOS halts at
  // start of combat from hostile-vs-hostile patrols. Players still get
  // the first-sight reaction window when they move into LOS of a
  // previously-unseen enemy.
  const moverIsFriendly = moverTok.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  const moverSeen = new Set(mover.flags?.[FLAG_NS]?.firstContactSeen ?? []);
  const oppSeen = new Set(opponentCm.flags?.[FLAG_NS]?.firstContactSeen ?? []);
  const alreadySeen = moverSeen.has(opponentCm.id) || oppSeen.has(mover.id);

  if (!alreadySeen && moverIsFriendly) {
    const moverLerpC = _addCenter(interpolateMovementPosition(moverMv, newClock), moverTok);
    const oppLerpC = oppMv
      ? _addCenter(interpolateMovementPosition(oppMv, newClock), oppTok)
      : oppStartC;
    if (_hasLOS(moverLerpC, oppLerpC)) {
      const sightTick = newClock;
      const moverSightHalt = {
        type: 'sight',
        cause: opponentCm,
        haltPos: _topLeftFromCenter(moverLerpC, moverTok),
        scheduledTick: sightTick,
        wait: Math.max(1, sightTick - moverMv.declaredAtTick),
      };
      // If sight halt is earlier than melee halt for the mover, prefer it.
      if (!moverHalt || moverSightHalt.scheduledTick < moverHalt.scheduledTick) {
        moverHalt = moverSightHalt;
      }
      // Sight halts don't truncate the opponent (sight is one-sided
      // mechanically — the mover halts to assess; the opponent's intent is
      // unchanged). Mutual `seen` tracking happens in _applyHalt.
    }
  }

  if (!moverHalt && !opponentHalt) return null;
  return { moverHalt, opponentHalt };
}

/**
 * Solve the analytical first-touch problem for two actors with linear
 * motion. Returns the earliest tick `t` in the valid overlap window
 * where the actors are at `distPx` apart, plus their positions at that t.
 *
 * Math: |P_A(t) - P_B(t)|² = distPx²
 *   P_A(t) = aStart + v_a · (t - aDecl)
 *   v_a = (aEnd - aStart) / (aArrive - aDecl)
 * Reduces to a quadratic in t; pick smallest valid root in
 *   [max(aDecl, bDecl), min(aArrive, bArrive)].
 *
 * Stationary actor: aDecl = 0, aArrive = Infinity, v_a = 0. Reduces to
 * line-circle intersection on the moving actor's path.
 */
function _solveFirstTouch(aStart, aEnd, aDecl, aArrive, bStart, bEnd, bDecl, bArrive, distPx) {
  const aWait = aArrive - aDecl;
  const bWait = bArrive - bDecl;
  const va = (aWait > 0 && Number.isFinite(aWait))
    ? { x: (aEnd.x - aStart.x) / aWait, y: (aEnd.y - aStart.y) / aWait }
    : { x: 0, y: 0 };
  const vb = (bWait > 0 && Number.isFinite(bWait))
    ? { x: (bEnd.x - bStart.x) / bWait, y: (bEnd.y - bStart.y) / bWait }
    : { x: 0, y: 0 };

  // R0 = (A_start - v_a·aDecl) - (B_start - v_b·bDecl)
  const R0 = {
    x: (aStart.x - va.x * aDecl) - (bStart.x - vb.x * bDecl),
    y: (aStart.y - va.y * aDecl) - (bStart.y - vb.y * bDecl),
  };
  const V = { x: va.x - vb.x, y: va.y - vb.y };
  const V2 = V.x * V.x + V.y * V.y;
  const R0V = R0.x * V.x + R0.y * V.y;
  const R02 = R0.x * R0.x + R0.y * R0.y;
  const d2 = distPx * distPx;

  const tMin = Math.max(aDecl, bDecl);
  const tMax = Math.min(aArrive, bArrive);
  if (tMin >= tMax) return null;

  // ── Already-engaged geometric pre-check ─────────────────────────────
  // If the two actors are at or inside engagement distance at the
  // movement's start, treat them as already engaged — no halt fires for
  // this pair regardless of where they're heading. Without this check,
  // touching-the-boundary (center distance == distPx, edge distance 0)
  // produced a quadratic root at exactly t = tMin, which the entry-only
  // gate below counted as a fresh entry → halt-at-zero-distance →
  // "queue happens, sprite never moves" reported by user 2026-05-12.
  // The epsilon (0.5 px ≈ 0.125 ft) absorbs floating-point error.
  const aAtMin = { x: aStart.x + va.x * (tMin - aDecl), y: aStart.y + va.y * (tMin - aDecl) };
  const bAtMin = { x: bStart.x + vb.x * (tMin - bDecl), y: bStart.y + vb.y * (tMin - bDecl) };
  const distAtMin = Math.hypot(aAtMin.x - bAtMin.x, aAtMin.y - bAtMin.y);
  if (distAtMin <= distPx + 0.5) return null;

  let t = null;
  if (V2 < 1e-9) {
    // No relative motion — distance is constant. Combined with the
    // pre-check above (which catches distAtMin <= distPx), the only
    // way we reach here is "constant distance > distPx" → never engages.
    return null;
  }
  const disc = R0V * R0V - V2 * (R02 - d2);
  if (disc < 0) return null;
  const sqd = Math.sqrt(disc);
  const t1 = (-R0V - sqd) / V2; // entry into circle
  const t2 = (-R0V + sqd) / V2; // exit from circle
  // Halt only on ENTRY into reach. The pre-check above already filtered
  // out the "already inside at start" case, so any t1 in the window
  // here is a genuine fresh entry.
  if (t1 >= tMin && t1 <= tMax) {
    t = t1;
  }
  if (t === null) return null;

  const aPos = { x: aStart.x + va.x * (t - aDecl), y: aStart.y + va.y * (t - aDecl) };
  const bPos = { x: bStart.x + vb.x * (t - bDecl), y: bStart.y + vb.y * (t - bDecl) };
  return { tickT: Math.round(t), aPos, bPos };
}

/* ------------------------------------------------------------------ */
/*  Halt application                                                   */
/* ------------------------------------------------------------------ */

function _setEarliestHalt(map, cmId, haltInfo) {
  const existing = map.get(cmId);
  if (!existing || haltInfo.scheduledTick < existing.scheduledTick) {
    map.set(cmId, haltInfo);
  }
}

async function _applyHalt(combat, cmId, haltInfo) {
  const cm = combat.combatants.get(cmId);
  if (!cm) return;
  const mv = cm.flags?.[FLAG_NS]?.declaredAction;
  if (!mv || mv.itemId !== MOVEMENT_ITEM_ID) return;

  const labelSuffix = haltInfo.type === 'melee'
    ? ` (engaged ${haltInfo.cause.name})`
    : ` (spotted ${haltInfo.cause.name})`;
  const totalDist = Math.hypot(mv.endPos.x - mv.startPos.x, mv.endPos.y - mv.startPos.y);
  const haltDist = Math.hypot(haltInfo.haltPos.x - mv.startPos.x, haltInfo.haltPos.y - mv.startPos.y);
  const ratio = totalDist > 0 ? Math.min(1, haltDist / totalDist) : 0;
  const distFt = Math.round((mv.distanceFt ?? 0) * ratio);

  // Stamina must scale by the same ratio as distance — otherwise the
  // truncated movement debits the FULL original staminaCost for a partial
  // trip. John's last-night session paid 28 stamina × 4 chained halts on
  // a single 73ft plan because of this.
  const newStamina = Math.round((mv.staminaCost ?? 0) * ratio);

  const newDeclared = {
    ...mv,
    endPos: haltInfo.haltPos,
    wait: Math.max(1, haltInfo.wait),
    scheduledTick: haltInfo.scheduledTick,
    distanceFt: distFt,
    staminaCost: newStamina,
    label: mv.label.replace(/ \(engaged .+\)| \(spotted .+\)/, '') + labelSuffix,
    // Preserve the pre-truncation destination so the tracker can offer a
    // resume after the halt fires and the engagement clears. Don't
    // overwrite if it was already set (chained halts on the same path).
    originalEndPos: mv.originalEndPos ?? mv.endPos,
    haltCauseCombatantId: haltInfo.cause?.id ?? null,
    halted: true, // skip future halt-checks until this movement completes
  };
  const update = {
    [`flags.${FLAG_NS}.declaredAction`]: newDeclared,
    [`flags.${FLAG_NS}.nextActionTick`]: haltInfo.scheduledTick,
  };

  if (haltInfo.type === 'sight') {
    const moverSeen = new Set(cm.flags?.[FLAG_NS]?.firstContactSeen ?? []);
    moverSeen.add(haltInfo.cause.id);
    update[`flags.${FLAG_NS}.firstContactSeen`] = [...moverSeen];
    const cause = combat.combatants.get(haltInfo.cause.id);
    if (cause) {
      const causeSeen = new Set(cause.flags?.[FLAG_NS]?.firstContactSeen ?? []);
      causeSeen.add(cm.id);
      await cause.update({ [`flags.${FLAG_NS}.firstContactSeen`]: [...causeSeen] });
    }
  }

  await cm.update(update);

  const causeText = haltInfo.type === 'melee'
    ? `entered melee range of <strong>${haltInfo.cause.name}</strong>`
    : `spotted <strong>${haltInfo.cause.name}</strong> for the first time`;
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: cm.actor }),
    content: `<p><em>${cm.name} ${causeText} — movement halted at ${distFt}ft, arriving tick ${haltInfo.scheduledTick}.</em></p>`,
  });
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function _isOppositeDisposition(a, b) {
  return (a === 1 && b === -1) || (a === -1 && b === 1);
}

function _addCenter(pos, tokenDoc) {
  const w = (tokenDoc.width ?? 1) * canvas.grid.size;
  const h = (tokenDoc.height ?? 1) * canvas.grid.size;
  return { x: pos.x + w / 2, y: pos.y + h / 2 };
}

function _topLeftFromCenter(centerPos, tokenDoc) {
  const w = (tokenDoc.width ?? 1) * canvas.grid.size;
  const h = (tokenDoc.height ?? 1) * canvas.grid.size;
  return { x: Math.round(centerPos.x - w / 2), y: Math.round(centerPos.y - h / 2) };
}

/**
 * Threat radius in feet for a token's equipped weapon (default 5 if no
 * weapon or no explicit reach). Public — also used by the threat-range
 * aura on the canvas layer.
 */
export function getThreatRadiusFt(tokenDoc) {
  const actor = tokenDoc.actor;
  let reachFt = 5;
  if (actor?.items) {
    const equipped = actor.items.find(i =>
      i.type === 'item' && i.system?.equipped && i.system?.slot === 'weaponry'
    );
    if (equipped?.system?.reach) reachFt = Math.max(5, equipped.system.reach);
  }
  return reachFt;
}

function _computeThreatRadiusPx(tokenDoc) {
  const pxPerFt = canvas.grid.size / canvas.grid.distance;
  return getThreatRadiusFt(tokenDoc) * pxPerFt;
}

function _hasLOS(p1, p2) {
  try {
    const collides = foundry.canvas.geometry.ClockwiseSweepPolygon.testCollision(
      p1, p2, { type: 'sight', mode: 'any' }
    );
    return !collides;
  } catch (e) {
    return true;
  }
}
