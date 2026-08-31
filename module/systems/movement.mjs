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

import { buildCheckpointPath, interpolateMovementPosition, effectiveClockTick } from '../helpers/movement-path.mjs';
import { isActingGM } from '../helpers/gm.mjs';
import { getThreatRadiusFt } from './engagement-halts.mjs';

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
      // Route through stopDeclaredMove — a direct stopMovement() throws for
      // any client but the movement's driver (live 2026-08-22: the GM's
      // realtime glide on Gabriel's token made HIS OWN move declares fail
      // with "Only the User that initiated the movement can stop it").
      await stopDeclaredMove(tokenDoc);
      // Foreign-driven stops land via socket on the driver's client — give
      // the round-trip a beat before planning over the old glide.
      for (let i = 0; i < 6 && ['planned', 'pending', 'paused'].includes(tokenDoc.movement?.state); i++) {
        await new Promise(r => setTimeout(r, 50));
      }
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
      // Core's stop broadcast is IGNORED by the driving client (the
      // _stopMovement handler skips when movement.user.isSelf there), so a
      // stop issued from any other client leaves the glide running at the
      // driver — an orphan walk with no declaration behind it. Route the
      // stop to the driver as well.
      if (!tokenDoc.movement.user?.isSelf) {
        // v14 hard-errors a stop from any client but the driver ("Only the
        // User that initiated the movement can stop it") — the socket IS
        // the stop for foreign-driven movement; don't also call it locally.
        game.socket.emit('system.aspects-of-power', { action: 'aopStopMove', tokenUuid: tokenDoc.uuid });
      } else {
        await tokenDoc.stopMovement();
      }
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
  if (!finished?.then) return;
  finished.then((completed) => {
    _executing.delete(tokenDoc.id);
    if (completed) return;
    // CONSTRAINED stop: core halted the glide against something physical —
    // spike-verified 2026-08-09 that a wall conjured mid-flight stops the
    // movement with movement.constrained === true. Our own cancels and
    // re-plans are never `constrained`, so this discriminates cleanly.
    // Settle the declaration at the wall (pro-rated, per the halt rules).
    if (!tokenDoc.movement?.constrained) return;
    const combat = game.combat;
    if (!combat?.started) return;
    const cm = combat.combatants.find(
      c => c.tokenId === tokenDoc.id && c.sceneId === tokenDoc.parent?.id
    );
    const mv = cm?.flags?.[FLAG_NS]?.declaredMovement;
    if (!mv?.endPos) return;
    if (Math.hypot(mv.endPos.x - tokenDoc.x, mv.endPos.y - tokenDoc.y) < 2) return;
    const cf = combat.flags?.[FLAG_NS] ?? {};
    const nowTick = effectiveClockTick(cf.realtime, Date.now(), cf.clockTick ?? 0);
    haltDeclaredMove(tokenDoc, cm, nowTick, 'the way is blocked')
      .catch(err => console.error('[movement] constrained settlement failed:', err));
  });
}

/**
 * Price a movement path against the world as it stands RIGHT NOW.
 *
 * Two things make ground expensive (ruled 2026-08-09):
 *  - THREATENED ground: within a living hostile's melee threat radius
 *    (their reach, edge-to-edge — getThreatRadiusFt), each foot costs
 *    `movement.threatenedMoveMult` × celerity time. You can cross a guard's
 *    reach; you cross it carefully. Incapacitated bodies threaten nothing.
 *  - SLOWING TERRAIN: regions with an enabled `modifyMovementCost` behavior
 *    multiply time by their difficulty. This is the first time terrain has
 *    cost celerity TIME at all — it always cost stamina, never seconds — so
 *    a conjured flood now actually impedes the charge through it.
 *
 * Sampled at 24 points along the straight path; returns the effective
 * distance for the wait formula plus the aggregate multiplier for display.
 * Called at declare AND per checkpoint on the remainder (repriceRemainder),
 * so the price tracks a changing battlefield instead of a declare snapshot.
 *
 * @param {TokenDocument} tokenDoc
 * @param {{x,y}} fromPos  top-left
 * @param {{x,y}} toPos    top-left
 * @param {number} distanceFt  the real distance being priced
 * @returns {{effectiveFt: number, mult: number}}
 */
export function priceMovementPath(tokenDoc, fromPos, toPos, distanceFt) {
  const scene = tokenDoc?.parent;
  if (!scene || !(distanceFt > 0)) return { effectiveFt: distanceFt, mult: 1 };
  const gs = scene.grid?.size ?? 100;
  const ftPerPx = (scene.grid?.distance ?? 5) / gs;
  const threatMult = Math.max(1, CONFIG.ASPECTSOFPOWER?.movement?.threatenedMoveMult ?? 3);
  const selfW = (tokenDoc.width ?? 1) * gs, selfH = (tokenDoc.height ?? 1) * gs;

  // Living hostiles and their threat radii, in px from their box edge.
  const threats = [];
  for (const t of scene.tokens) {
    if (t.id === tokenDoc.id || t.hidden) continue;
    if (t.disposition === tokenDoc.disposition) continue;
    if ((t.actor?.system?.health?.value ?? 1) <= 0) continue; // a corpse guards nothing
    threats.push({
      x: t.x, y: t.y, w: (t.width ?? 1) * gs, h: (t.height ?? 1) * gs,
      reachPx: Math.max(0, getThreatRadiusFt(t)) / ftPerPx,
    });
  }

  // Slowing-terrain regions (enabled modifyMovementCost behaviors).
  const terrains = [];
  for (const region of scene.regions ?? []) {
    for (const b of region.behaviors ?? []) {
      if (b.disabled || b.type !== 'modifyMovementCost') continue;
      const diffs = b.system?.difficulties;
      let d = 1;
      if (diffs && typeof diffs === 'object') {
        const vals = Object.values(diffs).filter(v => Number.isFinite(v) && v > 0);
        if (vals.length) d = Math.max(...vals);
      } else if (Number.isFinite(diffs)) d = diffs;
      if (d > 1) terrains.push({ region, difficulty: Math.min(d, 10) });
      break;
    }
  }

  if (!threats.length && !terrains.length) return { effectiveFt: distanceFt, mult: 1 };

  const SAMPLES = 24;
  let total = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = (i - 0.5) / SAMPLES;
    const px = fromPos.x + (toPos.x - fromPos.x) * t;
    const py = fromPos.y + (toPos.y - fromPos.y) * t;
    let m = 1;
    for (const th of threats) {
      // Edge-to-edge: the mover's box at this sample vs the threat's box.
      const dx = Math.max(th.x - (px + selfW), px - (th.x + th.w), 0);
      const dy = Math.max(th.y - (py + selfH), py - (th.y + th.h), 0);
      if (Math.hypot(dx, dy) <= th.reachPx) { m = threatMult; break; }
    }
    const cx = px + selfW / 2, cy = py + selfH / 2;
    const elevation = tokenDoc.elevation ?? 0;
    for (const tr of terrains) {
      try {
        if (tr.region.testPoint({ x: cx, y: cy, elevation })) m *= tr.difficulty;
      } catch { /* region on another level etc. — skip */ }
    }
    total += m;
  }
  const mult = total / SAMPLES;
  return { effectiveFt: distanceFt * mult, mult };
}

/**
 * Re-price the REMAINDER of an executing movement at a checkpoint. The
 * declare stored ticksPerEffFt (its own wait ÷ its own priced distance), so
 * the remainder reprices with EXACTLY the declare formula and no import
 * cycle. Only material changes commit (>2% and >25 ticks) — the schedule
 * breathes when the battlefield changed, not from rounding noise.
 *
 * Runs on the driving client (a GM), so the combatant update is direct.
 * The glide speed self-corrects: the canvas speed override reads remaining
 * distance over remaining ticks each segment.
 */
export function repriceRemainder(tokenDoc, combatant) {
  const mv = combatant?.flags?.[FLAG_NS]?.declaredMovement;
  if (!mv?.endPos || !(mv.ticksPerEffFt > 0) || typeof mv.scheduledTick !== 'number') return;
  const scene = tokenDoc.parent;
  const gs = scene?.grid?.size ?? 100;
  const ftPerPx = (scene?.grid?.distance ?? 5) / gs;
  const from = { x: tokenDoc.x, y: tokenDoc.y };
  const remFt = Math.hypot(mv.endPos.x - from.x, mv.endPos.y - from.y) * ftPerPx;
  if (!(remFt > 0)) return;
  const pricing = priceMovementPath(tokenDoc, from, mv.endPos, remFt);
  const combat = combatant.combat;
  const cf = combat?.flags?.[FLAG_NS] ?? {};
  const nowTick = effectiveClockTick(cf.realtime, Date.now(), cf.clockTick ?? 0);
  const newSched = Math.round(nowTick + pricing.effectiveFt * mv.ticksPerEffFt);
  const delta = newSched - mv.scheduledTick;
  if (Math.abs(delta) <= Math.max(25, 0.02 * Math.max(0, mv.scheduledTick - nowTick))) return;
  const qa = combatant.flags?.[FLAG_NS]?.declaredAction;
  combatant.update({
    [`flags.${FLAG_NS}.declaredMovement.scheduledTick`]: newSched,
    [`flags.${FLAG_NS}.declaredMovement.wait`]: newSched - (mv.declaredAtTick ?? 0),
    [`flags.${FLAG_NS}.declaredMovement.priceMult`]: pricing.mult,
    [`flags.${FLAG_NS}.nextActionTick`]: Math.min(
      newSched, (typeof qa?.scheduledTick === 'number') ? qa.scheduledTick : Infinity),
  }).catch(err => console.warn('[movement] reprice failed:', err));
  if (Math.abs(delta) > 100) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
      content: `<p><em>${combatant.name}'s path ${delta > 0 ? 'grows harder' : 'clears'} — arrival now tick ${newSched}.</em></p>`,
      flags: { aspectsofpower: { logOnly: true } }, // chat diet 2026-08-31
      whisper: combatant.actor?.hasPlayerOwner ? [] : ChatMessage.getWhisperRecipients('GM'),
    });
  }
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
export async function haltDeclaredMove(tokenDoc, combatant, nowTick, reason = 'an enemy blocks the path') {
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
    content: `<p><em>${combatant.name} pulls up short at ${doneFt}ft — ${reason}.</em></p>`,
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

  // Cross-client stop routing (see stopDeclaredMove): only the client whose
  // user drives the movement can truly kill it.
  game.socket.on('system.aspects-of-power', (data) => {
    if (data?.action !== 'aopStopMove') return;
    const doc = fromUuidSync(data.tokenUuid);
    if (!doc?.movement?.user?.isSelf) return;
    _executing.delete(doc.id);
    if (['planned', 'pending', 'paused'].includes(doc.movement.state)) {
      // stopMovement is not reliably thenable across states — never chain
      // .catch on its raw return (threw live 2026-08-22).
      try { Promise.resolve(doc.stopMovement()).catch(err => console.warn('[movement] routed stop failed:', err)); }
      catch (err) { console.warn('[movement] routed stop failed:', err); }
    }
  });

  // Re-plan after a reload: core movement state is in-memory only, so a
  // declared-but-unfinished movement loses its plan when the page reloads
  // while the celerity flag survives. The acting GM rebuilds plans from the
  // flags — from the token's CURRENT position to the declared endPos, so a
  // mid-flight reload resumes from wherever the last checkpoint committed.
  Hooks.on('canvasReady', _rehydratePlans);
  // The initial canvasReady fires BEFORE the ready hook that registers us —
  // run the rehydrate once directly or the reload case (its whole reason to
  // exist) is the one case it would miss.
  if (canvas?.ready) _rehydratePlans();
}

function _rehydratePlans() {
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
}
