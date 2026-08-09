/**
 * Celerity movement execution on Foundry v14's native movement API.
 *
 * The old model cancelled every in-combat move (`_preUpdateMovement` →
 * `return false`) and re-implemented motion as flag data animated by raw
 * document-position writes — the direct cause of the rubberband (drag
 * preview vanishes, token snaps home), the snapshot lurches (flat 400ms
 * slides at each advance), and the 5Hz write loop in realtime mode.
 *
 * The new model (spike-verified live on 14.365, 2026-08-09):
 *   declare → a PLANNED core movement: the path is stored and drawn,
 *             nothing commits, the token does not move.
 *   run     → startMovement / resumeMovement: core animates the glide at
 *             a celerity-matched speed, committing checkpoint by
 *             checkpoint. v14 animates the document position continuously,
 *             so rules and screen agree throughout.
 *   pause   → pauseMovement: the token freezes at the next checkpoint
 *             (checkpointSpacingSquares apart) and its position is real.
 *
 * Ownership note: whichever client STARTS a movement becomes its
 * movement.user, and all checkpoint continuations run there. The tracker's
 * realtime loop (one GM client) starts every declared movement, so pause /
 * resume / re-clamp all stay local to that client — no new sockets.
 *
 * The celerity flags (declaredMovement on the combatant) remain the source
 * of truth for waits, costs, and scheduling; this module only executes.
 */

import { buildCheckpointPath, interpolateMovementPosition } from '../helpers/movement-path.mjs';
import { isActingGM } from '../helpers/gm.mjs';

const FLAG_NS = 'aspectsofpower';

/** The pauseMovement continuation key this module registers. */
const AOP_PAUSE_KEY = 'aop-celerity-clock';

/**
 * Token ids whose movement THIS CLIENT is deliberately driving (start /
 * resume / checkpoint continuations). `_preUpdateMovement` consults this to
 * tell "our own execution committing a segment" apart from "a new move that
 * must be declared" — checkpoint continuations re-enter the hook on the
 * driving client and carry no operation flag we could stamp (core rebuilds
 * the update options per segment).
 */
const _executing = new Set();

export function isExecutingMove(tokenId) {
  return _executing.has(tokenId);
}

/** Spacing between checkpoints in grid squares (pause/commit granularity). */
function _checkpointSpacingPx(scene) {
  const squares = CONFIG.ASPECTSOFPOWER?.movement?.checkpointSpacingSquares ?? 2;
  return Math.max(1, squares) * (scene?.grid?.size ?? 100);
}

/**
 * Create the planned core movement for a declared celerity move. Fire-and-
 * forget from the declaring client (player drag → player client; AI → GM).
 * The move() promise intentionally goes unawaited — it resolves only when
 * the movement finishes, which may be a whole combat later.
 *
 * Any live movement on the token is stopped first: a re-declare replaces
 * the old plan wholesale, matching the flag overwrite in declareMovement.
 *
 * @param {TokenDocument} tokenDoc
 * @param {{x: number, y: number}} startPos
 * @param {{x: number, y: number}} endPos
 * @returns {Promise<boolean>} true when the plan reached the 'planned' state
 */
export async function declarePlannedMove(tokenDoc, startPos, endPos) {
  if (!tokenDoc) return false;
  try {
    if (['planned', 'pending', 'paused'].includes(tokenDoc.movement?.state)) {
      await tokenDoc.stopMovement();
    }
    const path = buildCheckpointPath(startPos, endPos, _checkpointSpacingPx(tokenDoc.parent));
    // Opaque enemies: only PC paths render the core ruler for players. The
    // GM sees every declared path via the movement overlay regardless.
    const showRuler = tokenDoc.actor?.hasPlayerOwner === true;
    tokenDoc.move(path, { planned: true, showRuler, autoRotate: true, _aopPlannedDeclare: true })
      .catch(err => console.warn('[movement] planned move rejected:', err));
    // The plan materialises within the update workflow — poll briefly rather
    // than trusting a fixed delay. A probe that cannot see the state it just
    // created must fail loudly, not return a plausible success.
    for (let i = 0; i < 20; i++) {
      if (tokenDoc.movement?.state === 'planned') return true;
      await new Promise(r => setTimeout(r, 50));
    }
    console.warn(`[movement] plan for ${tokenDoc.name} never reached 'planned' (state=${tokenDoc.movement?.state})`);
    return false;
  } catch (err) {
    console.error('[movement] declarePlannedMove failed:', err);
    return false;
  }
}

/**
 * Start or resume the declared movement of one combatant. Called by the
 * clock owner (the GM client running the realtime loop). Starting a
 * player-planned movement from here is deliberate — it makes this client
 * the movement.user so every later pause/resume is local.
 *
 * @param {Combatant} combatant
 * @returns {boolean} true if a movement is now running
 */
export function runDeclaredMove(combatant) {
  const tokenDoc = combatant?.token;
  const mv = combatant?.flags?.[FLAG_NS]?.declaredMovement;
  if (!tokenDoc || !mv) return false;
  const state = tokenDoc.movement?.state;
  try {
    if (state === 'planned') {
      _executing.add(tokenDoc.id);
      _watchMovementEnd(tokenDoc);
      tokenDoc.startMovement().catch(err => console.warn('[movement] start failed:', err));
      return true;
    }
    if (state === 'paused') {
      if (!tokenDoc.movement.user?.isSelf) {
        // Should not happen in the loop-owns-everything model; surface it
        // instead of silently doing nothing so the defect is visible.
        console.warn(`[movement] cannot resume ${tokenDoc.name}: paused by ${tokenDoc.movement.user?.name}`);
        return false;
      }
      _executing.add(tokenDoc.id);
      _watchMovementEnd(tokenDoc);
      tokenDoc.resumeMovement(tokenDoc.movement.id, AOP_PAUSE_KEY);
      return true;
    }
  } catch (err) {
    console.error('[movement] runDeclaredMove failed:', err);
  }
  return state === 'pending';
}

/**
 * Pause one running movement. Local-only by design: the clock owner started
 * every movement, so it can pause every movement. Returns true if the token
 * is now (or already was) holding still.
 */
export function pauseDeclaredMove(tokenDoc) {
  if (!tokenDoc) return true;
  const state = tokenDoc.movement?.state;
  if (state !== 'pending') return true; // planned/paused/finished already hold still
  if (!tokenDoc.movement.user?.isSelf) {
    console.warn(`[movement] cannot pause ${tokenDoc.name}: movement owned by ${tokenDoc.movement.user?.name}`);
    return false;
  }
  try {
    tokenDoc.pauseMovement(AOP_PAUSE_KEY);
    return true;
  } catch (err) {
    console.error('[movement] pause failed:', err);
    return false;
  }
}

/** Stop and discard a token's live movement (cancel / re-declare path). */
export async function stopDeclaredMove(tokenDoc) {
  if (!tokenDoc) return;
  _executing.delete(tokenDoc.id);
  try {
    if (['planned', 'pending', 'paused'].includes(tokenDoc.movement?.state)) {
      await tokenDoc.stopMovement();
    }
  } catch (err) {
    console.warn('[movement] stop failed:', err);
  }
}

/** Run every declared movement in the combat (world un-paused). */
export function runAllDeclaredMoves(combat) {
  for (const cm of combat?.combatants ?? []) {
    if (cm.flags?.[FLAG_NS]?.declaredMovement) runDeclaredMove(cm);
  }
}

/** Freeze every declared movement in the combat (world paused). */
export function pauseAllDeclaredMoves(combat) {
  for (const cm of combat?.combatants ?? []) {
    if (cm.flags?.[FLAG_NS]?.declaredMovement) pauseDeclaredMove(cm.token);
  }
}

/**
 * Drop the executing mark once a movement leaves our hands — paused (the
 * next segment will be a fresh resume), stopped, or fully finished. Without
 * this, a stale mark would let a LATER unrelated drag of the same token
 * bypass the declare pipeline entirely.
 */
function _watchMovementEnd(tokenDoc) {
  const finished = tokenDoc.movement?.finished;
  if (finished?.then) finished.then(() => _executing.delete(tokenDoc.id));
}

/**
 * Halt an executing movement because reality changed mid-flight (an enemy
 * now blocks the next segment) and settle it IMMEDIATELY: pro-rated stamina
 * debited, movement track cleared, AI freed to re-decide. Live-verify
 * 2026-08-09 caught the earlier truncate-for-the-sweep version leaving the
 * flag lingering — a halt's scheduled tick is already in the past when the
 * scheduler looks, so no future fire ever settled it.
 *
 * Runs on the driving client, which in the loop-owns-everything model is a
 * GM client, so both updates are direct.
 */
export async function haltDeclaredMove(tokenDoc, combatant, nowTick) {
  await stopDeclaredMove(tokenDoc);
  const mv = combatant?.flags?.[FLAG_NS]?.declaredMovement;
  if (!mv?.startPos || !mv?.endPos) return;
  const cur = { x: tokenDoc.x, y: tokenDoc.y };
  const total = Math.hypot(mv.endPos.x - mv.startPos.x, mv.endPos.y - mv.startPos.y) || 1;
  const done = Math.min(1, Math.hypot(cur.x - mv.startPos.x, cur.y - mv.startPos.y) / total);
  const doneFt = Math.round((mv.distanceFt ?? 0) * done);
  const doneStamina = Math.max(0, Math.round((mv.staminaCost ?? 0) * done));
  const qa = combatant.flags?.[FLAG_NS]?.declaredAction;
  await combatant.update({
    [`flags.${FLAG_NS}.declaredMovement`]: null,
    [`flags.${FLAG_NS}.nextActionTick`]: (typeof qa?.scheduledTick === 'number') ? qa.scheduledTick : null,
    [`flags.${FLAG_NS}.lastActionName`]: `${mv.label} — halted at ${doneFt}ft`,
    [`flags.${FLAG_NS}.lastActionWait`]: mv.wait,
    [`flags.${FLAG_NS}.lastActionAt`]: nowTick,
  }).catch(err => console.warn('[movement] halt settlement failed:', err));
  const actor = combatant.actor;
  if (doneStamina && actor) {
    const before = actor.system.stamina?.value ?? 0;
    await actor.update({ 'system.stamina.value': Math.max(0, before - doneStamina) })
      .catch(err => console.warn('[movement] halt stamina debit failed:', err));
  }
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${combatant.name} pulls up short at ${doneFt}ft — an enemy blocks the path.</em></p>`,
  });
}

/**
 * Bring every in-flight movement to where the clock says it should be —
 * the MANUAL advance path (clicking Advance while the world is paused).
 * During realtime play the glides track the clock by construction and this
 * is a near no-op (sub-pixel deltas are skipped).
 *
 * A token short of arrival gets one committed slide to the interpolated
 * point (duration scaled to the distance — the flat-400ms lurch is gone)
 * and a fresh plan for the remainder, so a later realtime resume continues
 * from exactly there.
 */
export async function jumpMovementsTo(combat, newClock) {
  for (const cm of combat?.combatants ?? []) {
    const mv = cm.flags?.[FLAG_NS]?.declaredMovement;
    const tokenDoc = cm.token;
    if (!mv?.startPos || !mv?.endPos || !tokenDoc) continue;
    const target = interpolateMovementPosition(mv, newClock);
    // NEVER slide a token BACKWARD along its own path. A pause freezes each
    // glide at its NEXT checkpoint — legitimately AHEAD of the clock's lerp
    // by up to a checkpoint spacing — and yanking it back to the lerp at
    // every subsequent fire was the "continuously rubberbanding" defect
    // (live 2026-08-09, second Boughbreaker fight). Ahead-of-clock is legal;
    // the clock catches up and later jumps only ever move the token onward.
    const dx = mv.endPos.x - mv.startPos.x;
    const dy = mv.endPos.y - mv.startPos.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) continue;
    const tCur = ((tokenDoc.x - mv.startPos.x) * dx + (tokenDoc.y - mv.startPos.y) * dy) / len2;
    const tTarget = ((target.x - mv.startPos.x) * dx + (target.y - mv.startPos.y) * dy) / len2;
    if (tTarget <= tCur + 0.001) continue;
    const px = Math.hypot(target.x - tokenDoc.x, target.y - tokenDoc.y);
    if (px < 1) continue;
    await stopDeclaredMove(tokenDoc);
    const duration = Math.min(1200, Math.max(150, Math.round(px * 2)));
    await tokenDoc.update(
      { x: target.x, y: target.y },
      { animation: { duration }, _celerityCommit: true }
    ).catch(err => console.warn(`[movement] clock-jump slide failed for ${cm.name}:`, err));
    if (newClock < mv.scheduledTick) {
      await declarePlannedMove(tokenDoc, target, mv.endPos);
    }
  }
}

export function registerMovementHooks() {
  Hooks.on('pauseToken', (tokenDoc) => _executing.delete(tokenDoc.id));
  Hooks.on('stopToken', (tokenDoc) => _executing.delete(tokenDoc.id));

  // Re-plan after a reload: core movement state is in-memory only, so a
  // declared-but-unfinished movement loses its plan when the page reloads
  // while the celerity flag survives. The acting GM rebuilds plans from the
  // flags — from the token's CURRENT position to the declared endPos, so a
  // mid-flight reload resumes from wherever the last checkpoint committed.
  Hooks.on('canvasReady', () => {
    if (!isActingGM()) return;
    const combat = game.combat;
    if (!combat?.started) return;
    for (const cm of combat.combatants) {
      const mv = cm.flags?.[FLAG_NS]?.declaredMovement;
      const tokenDoc = cm.token;
      if (!mv?.endPos || !tokenDoc || tokenDoc.parent !== canvas.scene) continue;
      const state = tokenDoc.movement?.state;
      if (['planned', 'pending', 'paused'].includes(state)) continue; // plan survived
      const from = { x: tokenDoc.x, y: tokenDoc.y };
      if (Math.hypot(mv.endPos.x - from.x, mv.endPos.y - from.y) < 1) continue; // already there
      declarePlannedMove(tokenDoc, from, mv.endPos);
    }
  });
}
