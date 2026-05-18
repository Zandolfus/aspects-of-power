/**
 * Celerity Combat Tracker — subclass of Foundry's native sidebar tracker
 * that replaces the initiative-ordered combatant list with a
 * celerity-ordered timeline. Standard combat controls (start/end, add
 * combatant, settings, etc.) are preserved via the inherited header and
 * footer parts.
 *
 * Wired by setting `CONFIG.ui.combat = CelerityCombatTracker` at init.
 */

import { getClockTick, referenceRoundLength, runRoundStart, MOVEMENT_ITEM_ID, BREAK_FREE_ITEM_ID, interpolateMovementPosition, declareMovement } from '../systems/celerity.mjs';
// TRIAL-REALTIME: engagement-halts disabled for the real-time-advance trial.
// If trial reverts, restore this import + the checkEngagementHalts call in
// _onCelAdvance (search "TRIAL-REALTIME" for both sites). If trial succeeds,
// delete the commented call + this import + the engagement-halts module +
// its first-contact / dashing utilities (audit refs first).
// import { checkEngagementHalts } from '../systems/engagement-halts.mjs';

const MAX_ROUND_BOUNDARIES_PER_ADVANCE = 5; // safety cap on multi-round catches

const FLAG_NS = 'aspectsofpower';
const ParentTracker = foundry.applications.sidebar.tabs.CombatTracker;

/* ------------------------------------------------------------------ */
/*  Action handlers (module-level so they can be referenced before     */
/*  the class is fully defined — Foundry binds `this` to the app)      */
/* ------------------------------------------------------------------ */

async function _onCelAdvance(event, target) {
  const combat = this.viewed;
  if (!combat?.started) return;
  const clockTick = getClockTick(combat);
  // Find the soonest declared action with a scheduled tick still in the future.
  const queued = [...combat.combatants]
    .map(c => ({ c, declared: c.flags?.[FLAG_NS]?.declaredAction ?? null }))
    .filter(e => e.declared && typeof e.declared.scheduledTick === 'number' && e.declared.scheduledTick > clockTick)
    .sort((a, b) => a.declared.scheduledTick - b.declared.scheduledTick);
  if (queued.length === 0) {
    ui.notifications.info('No queued actions to advance to.');
    return;
  }
  let { c, declared } = queued[0];
  let newClock = declared.scheduledTick;

  // Round-start mechanics: fire DoTs + onStartTurn for any actor whose
  // personal reference-round boundary was crossed by this clock advance.
  // The boundary tick simultaneously ends round N and starts round N+1;
  // we now phrase it as round-start. Per design-celerity.md round length
  // is RL-tied (build-neutral), one boundary every roundLen ticks.
  for (const member of combat.combatants) {
    const actor = member.actor;
    if (!actor) continue;
    const rl = actor.system.attributes?.race?.level ?? 1;
    const roundLen = referenceRoundLength(rl);
    if (roundLen <= 0) continue;
    const lastBoundary = member.flags?.[FLAG_NS]?.lastRoundEndAt ?? 0;
    let crossings = Math.floor((newClock - lastBoundary) / roundLen);
    if (crossings <= 0) continue;
    crossings = Math.min(crossings, MAX_ROUND_BOUNDARIES_PER_ADVANCE);
    for (let i = 0; i < crossings; i++) {
      await runRoundStart(combat, member);
    }
    // Flag name kept (lastRoundEndAt) for backward compat with existing
    // saved combats; semantically this is "tick of the most recent
    // boundary crossed for this actor."
    await member.update({
      [`flags.${FLAG_NS}.lastRoundEndAt`]: lastBoundary + crossings * roundLen,
    });
  }

  // TRIAL-REALTIME: engagement-halts + first-contact-LOS halts disabled for
  // the real-time-advance trial. The whole point of real-time is "game flows
  // naturally; movement passes through threat zones without interrupting."
  // The celerity reaction budget covers opportunity-cost on its own.
  //
  // If trial reverts, restore this call + the engagement-halts import above.
  // If trial succeeds, delete the comment + audit the engagement-halts
  // module for any remaining utility refs (actorIsDashing, getThreatRadiusFt
  // are used elsewhere in item.mjs — keep those).
  //
  // await checkEngagementHalts(combat, newClock);

  // Persistent AOE re-tick scan. Tokens standing inside a persistent AOE
  // get re-ticked when (newClock - lastTickedAt) >= the AOE's caster
  // reticPeriod (caster reference round / 4 per design). Foundry's region
  // events handle entry / path-crossing fires; this scan handles the
  // "still standing in" case which has no movement event to drive it.
  await _scanPersistentAoeReticks(combat, newClock);

  // Re-pick the firer in case halt-check truncated something to an earlier
  // tick than originally targeted. Re-read declaredAction from the latest
  // combatant flag so wait/scheduledTick reflect post-truncation values.
  const requeued = [...combat.combatants]
    .map(cm => ({ cm, declared: cm.flags?.[FLAG_NS]?.declaredAction ?? null }))
    .filter(e => e.declared && typeof e.declared.scheduledTick === 'number')
    .sort((a, b) => a.declared.scheduledTick - b.declared.scheduledTick);
  if (requeued.length > 0 && requeued[0].declared.scheduledTick <= newClock) {
    c = requeued[0].cm;
    declared = requeued[0].declared;
    newClock = declared.scheduledTick;
  }

  // Animate every in-flight movement to its interpolated position at the
  // new clock tick BEFORE the action resolves. Per design discussion
  // 2026-05-10: at every pause, all moving tokens slide in parallel to
  // wherever the lerp says they should be — each token only progresses up
  // to its own scheduled-tick (ratio = (newClock - declaredAt) / wait).
  // Tokens whose scheduled tick is reached commit to endPos and clear their
  // declaredAction flag. `Promise.all` runs the slides concurrently so the
  // visual rhythm is "tick beats" rather than serial per-token.
  const movementUpdates = [];
  const completedMovementCombatantIds = [];
  for (const member of combat.combatants) {
    const mv = member.flags?.[FLAG_NS]?.declaredAction;
    if (!mv || mv.itemId !== MOVEMENT_ITEM_ID) continue;
    const token = member.token;
    if (!token) continue;
    const target = interpolateMovementPosition(mv, newClock);
    // Token.update with x/y triggers Foundry's animation by default.
    // `_celerityCommit` flag tells our _preUpdateMovement override to
    // bypass declare-and-cancel for this update (avoids infinite recursion).
    movementUpdates.push(token.update(
      { x: target.x, y: target.y },
      { animation: { duration: 400 }, _celerityCommit: true }
    ).catch(err => console.error(`movement animate failed for ${member.name}:`, err)));
    if (newClock >= mv.scheduledTick) {
      completedMovementCombatantIds.push({ id: member.id, mv });
    }
  }
  await Promise.all(movementUpdates);

  // Commit completion: clear flags + debit stamina for any movement that
  // just landed. This includes the "fired" combatant if it was a movement.
  // After clearing, if the movement was a halt (truncated short of its
  // original destination) AND the actor moved at all, auto-queue a fresh
  // movement to the original destination so the player doesn't have to
  // manually re-issue. The new move re-runs the halt check on the next
  // advance — if the engagement is still active, it'll get re-truncated
  // (potentially at 0 ft) and the player can cancel.
  const autoResumes = [];
  for (const { id, mv } of completedMovementCombatantIds) {
    const member = combat.combatants.get(id);
    const updates = {
      [`flags.${FLAG_NS}.declaredAction`]: null,
      [`flags.${FLAG_NS}.nextActionTick`]: null,
      [`flags.${FLAG_NS}.lastActionName`]: mv.label,
      [`flags.${FLAG_NS}.lastActionWait`]: mv.wait,
      [`flags.${FLAG_NS}.lastActionAt`]: newClock,
    };
    await member.update(updates);
    if (mv.staminaCost && member.actor) {
      const cur = member.actor.system.stamina?.value ?? 0;
      await member.actor.update({
        'system.stamina.value': Math.max(0, cur - mv.staminaCost),
      });
    }
    // Resume planning: only if there's an originalEndPos AND we actually
    // covered ground (anti-loop: a 0-progress halt means we got pinned at
    // the start, no point re-queueing).
    if (mv.originalEndPos && mv.endPos) {
      const dx = mv.endPos.x - mv.startPos.x;
      const dy = mv.endPos.y - mv.startPos.y;
      const moved = Math.hypot(dx, dy);
      const remDx = mv.originalEndPos.x - mv.endPos.x;
      const remDy = mv.originalEndPos.y - mv.endPos.y;
      const remainingPx = Math.hypot(remDx, remDy);
      if (moved > 1 && remainingPx > 1) {
        const pxPerFt = canvas.grid.size / canvas.grid.distance;
        const remainingFt = Math.round(remainingPx / pxPerFt);
        // Per-ft stamina rate stays constant across truncation (engagement-
        // halts.mjs scales both distanceFt and staminaCost by the same
        // ratio). So perFt of the truncated mv equals perFt of the
        // original — multiply by the remaining feet to get the resumed
        // segment's correct cost. Prior bug: read total distance after
        // truncation and capped ratio at 1, charging full original stamina
        // per segment.
        const truncDistFt = mv.distanceFt ?? 0;
        const truncStamina = mv.staminaCost ?? 0;
        const perFt = truncDistFt > 0 ? truncStamina / truncDistFt : 0;
        const remStamina = Math.max(0, Math.round(perFt * remainingFt));
        autoResumes.push({
          memberId: id,
          fromPos: mv.endPos,
          toPos: mv.originalEndPos,
          distFt: remainingFt,
          staminaCost: remStamina,
          mode: mv.movementMode,
        });
      }
    }
  }

  // Re-queue resumed movements after the clock advance so they're
  // measured against newClock.
  for (const { memberId, fromPos, toPos, distFt, staminaCost, mode } of autoResumes) {
    const member = combat.combatants.get(memberId);
    if (!member?.actor) continue;
    try {
      await declareMovement(member.actor, fromPos, toPos, distFt, staminaCost, mode);
    } catch (e) {
      console.warn(`[celerity] auto-resume failed for ${member.name}:`, e);
    }
  }

  // Advance clock. (Movement-completion combatants are already cleared
  // above; for skill-action firings we still need to clear the firer's
  // flags before dispatching so a follow-up can re-queue.)
  await combat.update({ [`flags.${FLAG_NS}.clockTick`]: newClock });

  // Movement-completion branch: the action that drove this advance was a
  // movement, so there's no skill roll to dispatch. The position update +
  // flag clear above is the entire "fire" step.
  if (declared.itemId === MOVEMENT_ITEM_ID) {
    ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} arrives (${declared.label}).`);
    return;
  }

  // Break-free branch: actor declared a manual break-free against a debuff.
  // Look up the effect (it may have been broken by another means since
  // declaration — auto-break, dispel, expiry); if gone, skip with a notice.
  // Otherwise roll the break check via the shared actor helper.
  if (declared.itemId === BREAK_FREE_ITEM_ID) {
    await c.update({
      [`flags.${FLAG_NS}.declaredAction`]: null,
      [`flags.${FLAG_NS}.nextActionTick`]: null,
    });
    const actor = c.actor;
    const effect = declared.effectId ? actor?.effects?.get(declared.effectId) : null;
    if (!actor || !effect) {
      ui.notifications.info(`${c.name}: break-free attempt skipped (debuff already gone).`);
      return;
    }
    ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} fires "${declared.label}".`);
    const isPC = !!actor.hasPlayerOwner;
    try {
      await actor._attemptBreakRoll(effect, { whisper: !isPC });
    } catch (e) {
      console.error('[celerity] break-free dispatch failed:', e);
    }
    return;
  }

  // Skill-action branch (existing flow): clear the firer's flags + dispatch
  // the queued item to its canonical player (or run locally on GM).
  // _aopFireDispatch flag signals the preUpdateCombatant orphan-cleanup
  // hook to skip region deletion — the roll about to run still needs to
  // resolve against this region. The AOE flow inside item.roll() deletes
  // the region itself once damage has applied (for instantaneous AOEs).
  await c.update({
    [`flags.${FLAG_NS}.declaredAction`]: null,
    [`flags.${FLAG_NS}.nextActionTick`]: null,
  }, { _aopFireDispatch: true });
  const item = c.actor?.items?.get(declared.itemId);
  if (!item) {
    ui.notifications.warn(`${c.name}: queued item not found (id=${declared.itemId}); action skipped.`);
    return;
  }
  ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} fires "${declared.label}".`);

  // Dispatch the deferred roll to the actor's CANONICAL player — the user
  // whose `character` field IS this actor. Each PC has exactly one such
  // user. If that player isn't online (or this is an NPC with no linked
  // user), fall back to running locally on the GM's client. Never picks
  // a co-owner (e.g., another PC who happens to have OWNER permission).
  const investAmount = declared.investAmount ?? null;
  const manaInvestAmount = declared.manaInvestAmount ?? null;
  const aoeRegionId = declared.aoeRegionId ?? null;
  const orbDischarging = declared.orbDischarging ?? false;
  const targetIds = declared.targetIds ?? [];
  const teleportDestination = declared.teleportDestination ?? null;
  const leapDestination = declared.leapDestination ?? null;
  const leapApexFt = declared.leapApexFt ?? null;
  const linkedPlayer = game.users.find(u => !u.isGM && u.active && u.character?.id === c.actor?.id);
  if (linkedPlayer) {
    game.socket.emit('system.aspects-of-power', {
      action: 'executeQueuedAction',
      actorId: c.actor.id,
      itemId: item.id,
      targetUserId: linkedPlayer.id,
      preInvestAmount: investAmount,
      preManaInvestAmount: manaInvestAmount,
      preAoeRegionId: aoeRegionId,
      preOrbDischarging: orbDischarging,
      preTargetIds: targetIds,
      preTeleportDestination: teleportDestination,
      preLeapDestination: leapDestination,
      preLeapApexFt: leapApexFt,
    });
  } else {
    // No linked player online — GM (or whoever clicked Advance) runs it.
    await item.roll({ executeDeferred: true, preInvestAmount: investAmount, preManaInvestAmount: manaInvestAmount, preAoeRegionId: aoeRegionId, preOrbDischarging: orbDischarging, preTargetIds: targetIds, preTeleportDestination: teleportDestination, preLeapDestination: leapDestination, preLeapApexFt: leapApexFt });
  }

  // Sync Foundry's combat.turn pointer to the new celerity-next-up combatant
  // so pan-to-active and other built-in turn-pointer machinery stays aligned.
  // If no one is queued, leave combat.turn alone.
  const remainingClock = getClockTick(combat);
  const upcoming = [...combat.combatants]
    .map(cm => ({ cm, next: cm.flags?.[FLAG_NS]?.declaredAction?.scheduledTick ?? null }))
    .filter(e => e.next !== null && e.next > remainingClock)
    .sort((a, b) => a.next - b.next);
  if (upcoming.length > 0) {
    const allCombatants = [...combat.combatants];
    const nextIdx = allCombatants.indexOf(upcoming[0].cm);
    if (nextIdx >= 0 && nextIdx !== combat.turn) {
      // Avoid the legacy combatTurnChange round-mechanics handler firing again
      // — celerity already drove round-end via runRoundEnd above.
      await combat.update({ turn: nextIdx }, { _celerityTurnSync: true });
    }
  }
}

async function _onCelCancel(event, target) {
  const combatantId = target.closest('[data-combatant-id]')?.dataset?.combatantId;
  if (!combatantId) return;
  const combat = this.viewed;
  const c = combat?.combatants.get(combatantId);
  if (!c) return;
  const declared = c.flags?.[FLAG_NS]?.declaredAction;
  // For a cancelled movement: token stays at its current position (which is
  // the lerp position from the most recent pause). No stamina debit — sunk
  // cost is the celerity-time spent, not the resource. Per design.
  await c.update({
    [`flags.${FLAG_NS}.nextActionTick`]: null,
    [`flags.${FLAG_NS}.declaredAction`]: null,
  });
  const noun = declared?.itemId === MOVEMENT_ITEM_ID ? 'movement' : (declared?.label ?? 'action');
  ui.notifications.info(`${c.name} — ${noun} cancelled.`);
  if (declared) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: c.actor }),
      content: `<p><em>${c.name} cancels <strong>${declared.label}</strong>.</em></p>`,
    });
  }
}

/**
 * For each persistent AOE region on the active scene, find tokens still
 * inside (last-known position) and re-tick those whose (newClock - lastTickedAt)
 * has crossed the region's casterReticPeriod. Region behaviors handle
 * entry + path-crossing; this handles the "standing-in" cadence.
 */
async function _scanPersistentAoeReticks(combat, newClock) {
  if (!game.user.isGM) return;
  const scene = combat.scene ?? canvas.scene;
  if (!scene) return;
  const regions = scene.regions ?? [];
  for (const region of regions) {
    const flags = region.flags?.['aspects-of-power'];
    if (!flags?.persistent || !flags.persistentData) continue;
    const pd = flags.persistentData;
    const period = pd.casterReticPeriod ?? 1175;
    const affectedMap = pd.affectedTokens ?? {};
    // Iterate combatants on this scene whose token is currently inside.
    for (const member of combat.combatants) {
      const tokenDoc = member.token;
      if (!tokenDoc || tokenDoc.parent?.id !== scene.id) continue;
      // Compute token center from its current document position.
      const w = (tokenDoc.width ?? 1) * canvas.grid.size;
      const h = (tokenDoc.height ?? 1) * canvas.grid.size;
      const center = { x: tokenDoc.x + w / 2, y: tokenDoc.y + h / 2, elevation: tokenDoc.elevation ?? 0 };
      if (!region.testPoint(center)) continue;
      const lastTick = affectedMap[tokenDoc.id];
      // Never-ticked here → entry-tick will be handled by the behavior's
      // tokenEnter. Skip in this scan.
      if (lastTick == null) continue;
      if ((newClock - lastTick) < period) continue;
      // Eligible for re-tick. Trigger via the system API; affectedTokens
      // map will be updated to newClock by _triggerPersistentAoe.
      const trigger = game.aspectsofpower?._triggerPersistentAoe;
      if (typeof trigger === 'function') {
        await trigger(tokenDoc, false);
      }
    }
  }
}

// TRIAL-REALTIME: action handler bound via DEFAULT_OPTIONS. Toggles the
// auto-advance loop on the tracker app instance. If the trial reverts,
// delete this function + its actions binding + the class methods +
// the button in the template.
async function _onCelRealtimeToggle(event, target) {
  if (this._realtimeRunning) this._realtimeStop();
  else this._realtimeStart();
}

async function _onCelReset(event, target) {
  const combat = this.viewed;
  if (!combat?.started) return;
  await combat.update({ [`flags.${FLAG_NS}.clockTick`]: 0 });
  for (const c of combat.combatants) {
    await c.update({
      [`flags.${FLAG_NS}.nextActionTick`]: null,
      [`flags.${FLAG_NS}.declaredAction`]: null,
      [`flags.${FLAG_NS}.lastActionName`]: null,
      [`flags.${FLAG_NS}.lastActionWait`]: null,
      [`flags.${FLAG_NS}.lastActionAt`]: null,
      [`flags.${FLAG_NS}.lastRoundEndAt`]: 0,
    });
  }
  ui.notifications.info('Celerity clock reset.');
}

/* ------------------------------------------------------------------ */
/*  The subclass                                                       */
/* ------------------------------------------------------------------ */

export class CelerityCombatTracker extends ParentTracker {

  static DEFAULT_OPTIONS = {
    actions: {
      celAdvance:         _onCelAdvance,
      celReset:           _onCelReset,
      celCancel:          _onCelCancel,
      // TRIAL-REALTIME (remove on trial success/revert)
      celRealtimeToggle:  _onCelRealtimeToggle,
    },
  };

  // ── TRIAL-REALTIME: auto-advance loop ──────────────────────────────
  // Calibration: the FASTEST combatant's reference round = N real seconds
  // (default 5). Real-time delay between cast declare and fire scales with
  // the celerity tick distance using this ratio. Auto-pauses on action fire
  // so the player can re-queue. Re-schedules if any declaredAction changes
  // mid-wait (a fresh earlier-tick declare takes priority).
  static REALTIME_FASTEST_ROUND_SECONDS = 5;
  // Lerp step granularity for in-flight movement during realtime wait.
  // 200ms = 5fps writes; Foundry animates between writes so the sprite stays
  // smooth. Smaller = smoother but more network traffic in multiplayer.
  static REALTIME_MOVEMENT_LERP_STEP_MS = 200;
  _realtimeRunning = false;
  _realtimeTimeoutId = null;
  _realtimeHookId = null;
  _realtimeLerpIntervalId = null;

  _fastestRoundLen(combat) {
    let min = Infinity;
    for (const cm of combat?.combatants ?? []) {
      const rl = cm.actor?.system?.attributes?.race?.level ?? 1;
      const len = referenceRoundLength(rl);
      if (Number.isFinite(len) && len > 0 && len < min) min = len;
    }
    return Number.isFinite(min) ? min : 1000;
  }

  _realtimeStart() {
    if (this._realtimeRunning) return;
    this._realtimeRunning = true;
    // Hook into combatant updates so a new earlier-scheduled declare
    // pre-empts the in-flight timeout.
    if (!this._realtimeHookId) {
      this._realtimeHookId = Hooks.on('updateCombatant', (cm, changes) => {
        if (!this._realtimeRunning) return;
        const declaredPath = `flags.${FLAG_NS}.declaredAction`;
        const declaredChanged = foundry.utils.hasProperty(changes, declaredPath);
        if (declaredChanged) this._scheduleNextFire();
      });
    }
    this._scheduleNextFire();
    this.render();
  }

  _realtimeStop() {
    this._realtimeRunning = false;
    if (this._realtimeTimeoutId) {
      clearTimeout(this._realtimeTimeoutId);
      this._realtimeTimeoutId = null;
    }
    if (this._realtimeLerpIntervalId) {
      clearInterval(this._realtimeLerpIntervalId);
      this._realtimeLerpIntervalId = null;
    }
    if (this._realtimeHookId) {
      Hooks.off('updateCombatant', this._realtimeHookId);
      this._realtimeHookId = null;
    }
    this.render();
  }

  // Progressively lerp a token's document.x/y across the realtime wait.
  // Each interval writes the next lerped position with animation: STEP_MS
  // so Foundry smooths between writes. Document.x tracks the visual sprite,
  // so a drag-cancel snap-back goes to where the player saw the sprite —
  // not to a premature endPos. Auto-stops if the declared movement changes
  // (player re-declared mid-flight) or if realtime is paused.
  _startMovementLerp(tok, mv, realtimeMs) {
    if (this._realtimeLerpIntervalId) {
      clearInterval(this._realtimeLerpIntervalId);
      this._realtimeLerpIntervalId = null;
    }
    if (!tok || !mv?.startPos || !mv?.endPos) return;
    const STEP_MS = this.constructor.REALTIME_MOVEMENT_LERP_STEP_MS;
    const steps = Math.max(1, Math.floor(realtimeMs / STEP_MS));
    const stepDuration = Math.round(realtimeMs / steps);
    const movementSentinelId = mv.itemId; // MOVEMENT_ITEM_ID — re-checked each tick
    const scheduledTickAtStart = mv.scheduledTick;
    const combatantId = this.viewed?.combatants?.find(c => c.token?.id === tok.id)?.id;
    let stepIdx = 0;

    this._realtimeLerpIntervalId = setInterval(async () => {
      if (!this._realtimeRunning) {
        clearInterval(this._realtimeLerpIntervalId);
        this._realtimeLerpIntervalId = null;
        return;
      }
      // Bail if the declared movement was replaced mid-flight (player
      // re-declared). The new movement's lerp will start on the next
      // _scheduleNextFire pass.
      const c = combatantId ? this.viewed?.combatants?.get(combatantId) : null;
      const liveDeclared = c?.flags?.aspectsofpower?.declaredAction;
      if (!liveDeclared
          || liveDeclared.itemId !== movementSentinelId
          || liveDeclared.scheduledTick !== scheduledTickAtStart) {
        clearInterval(this._realtimeLerpIntervalId);
        this._realtimeLerpIntervalId = null;
        return;
      }
      stepIdx++;
      if (stepIdx >= steps) {
        // Final step — let the setTimeout's _onCelAdvance run the post-fire
        // write. Just halt the lerp here.
        clearInterval(this._realtimeLerpIntervalId);
        this._realtimeLerpIntervalId = null;
        return;
      }
      const frac = stepIdx / steps;
      const lerpX = Math.round(mv.startPos.x + frac * (mv.endPos.x - mv.startPos.x));
      const lerpY = Math.round(mv.startPos.y + frac * (mv.endPos.y - mv.startPos.y));
      try {
        await tok.update(
          { x: lerpX, y: lerpY },
          { animation: { duration: stepDuration }, _celerityCommit: true }
        );
      } catch (e) { console.warn('[TRIAL-REALTIME] lerp step failed:', e); }
    }, STEP_MS);
  }

  _scheduleNextFire() {
    if (this._realtimeTimeoutId) {
      clearTimeout(this._realtimeTimeoutId);
      this._realtimeTimeoutId = null;
    }
    if (!this._realtimeRunning) return;
    const combat = this.viewed;
    if (!combat?.started) { this._realtimeStop(); return; }

    const clock = getClockTick(combat);
    const queued = [...combat.combatants]
      .map(c => ({ c, declared: c.flags?.[FLAG_NS]?.declaredAction ?? null }))
      .filter(e => e.declared && typeof e.declared.scheduledTick === 'number' && e.declared.scheduledTick > clock)
      .sort((a, b) => a.declared.scheduledTick - b.declared.scheduledTick);
    if (queued.length === 0) {
      // No queued actions — wait for one to be declared. The updateCombatant
      // hook will reschedule when one appears.
      return;
    }

    const next = queued[0];
    const nextTick = next.declared.scheduledTick;
    const deltaTicks = Math.max(0, nextTick - clock);
    const fastest = this._fastestRoundLen(combat);
    const secsPerRound = this.constructor.REALTIME_FASTEST_ROUND_SECONDS;
    const realtimeMs = Math.max(0, deltaTicks * (secsPerRound * 1000) / fastest);

    // For MOVEMENT actions, progressively lerp document.x/y over the wait so
    // (a) the sprite slides smoothly across the canvas and (b) document.x
    // tracks the visual position. Without (b), `_preUpdateMovement`'s
    // startPos snapshot at drag-time reads the premature endPos and the
    // sprite snap-backs to wherever Foundry last committed the document.
    // Frequent writes with `animation: { duration: STEP_MS }` lets Foundry
    // interpolate between writes — visual stays smooth without flooding
    // the network with frame-rate updates.
    if (next.declared.itemId === MOVEMENT_ITEM_ID && next.declared.endPos && realtimeMs > 50) {
      this._startMovementLerp(next.c.token, next.declared, realtimeMs);
    }

    this._realtimeTimeoutId = setTimeout(async () => {
      this._realtimeTimeoutId = null;
      if (!this._realtimeRunning) return;
      try {
        await _onCelAdvance.call(this);
      } catch (e) { console.error('[TRIAL-REALTIME] advance failed:', e); }
      // Auto-pause on fire per user spec — player can re-queue then resume.
      this._realtimeStop();
    }, realtimeMs);
  }
  // ── /TRIAL-REALTIME ────────────────────────────────────────────────

  // Inherit header/footer; replace tracker part with our celerity template.
  static PARTS = {
    header:  { ...ParentTracker.PARTS.header },
    tracker: {
      template: 'systems/aspects-of-power/templates/sidebar/celerity-combat-tracker.hbs',
    },
    footer:  { ...ParentTracker.PARTS.footer },
  };

  /** @override - enrich each turn with celerity flags. */
  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    const f = combatant.flags?.[FLAG_NS] ?? {};
    const clockTick = getClockTick(combat);
    const next = f.nextActionTick ?? null;

    // Next reference round = lastRoundEndAt + roundLen. Players need to
    // see this so they can plan around debuff break rolls, regen, sustain
    // upkeep, and the celerity duration semantics ("3 of source's rounds").
    const rl = combatant.actor?.system?.attributes?.race?.level ?? 1;
    const roundLen = referenceRoundLength(rl);
    const lastEnd = f.lastRoundEndAt ?? 0;
    const nextRoundTick = lastEnd + roundLen;
    const ticksUntilRound = Math.max(0, nextRoundTick - clockTick);

    turn.celerity = {
      nextActionTick: next,
      lastActionName: f.lastActionName ?? null,
      lastActionWait: f.lastActionWait ?? null,
      ticksUntil:     next === null ? null : Math.max(0, next - clockTick),
      ready:          next === null || next <= clockTick,
      nextRoundTick,
      ticksUntilRound,
      roundLen,
    };
    return turn;
  }

  /** @override - sort combatants by celerity scheduled tick + add clock readout. */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = context.combat ?? this.viewed;
    context.celerityClockTick = getClockTick(combat);
    // TRIAL-REALTIME: surface play/pause state so the template button can
    // swap between fa-play and fa-pause icons.
    context.celerityRealtimeRunning = this._realtimeRunning;
    if (Array.isArray(context.turns)) {
      // Player visibility: per design-celerity.md "Public allies, opaque
      // enemies", non-GM users only see PC-owned combatants in the tracker.
      // (Hidden enemies stay invisible — even on canvas, they don't show.)
      if (!game.user.isGM) {
        context.turns = context.turns.filter(t => {
          const cm = combat.combatants.get(t.id);
          return cm?.actor?.hasPlayerOwner === true;
        });
      }
      // Strip Foundry's initiative-based 'active' so we can re-apply it to
      // the celerity-next-up combatant.
      for (const t of context.turns) {
        t.css = (t.css ?? '').replace(/\bactive\b/g, '').trim();
      }
      // Sort by celerity scheduled tick (null sorts to bottom).
      context.turns.sort((a, b) => {
        const ta = a.celerity?.nextActionTick ?? Infinity;
        const tb = b.celerity?.nextActionTick ?? Infinity;
        return ta - tb;
      });
      // Mark next-up ONLY when an action is actually queued. When the queue
      // is empty (everyone "ready"), nobody is highlighted — prevents the
      // green indicator from sticking on the previously-acted combatant.
      const firstScheduled = context.turns.find(t => t.celerity?.nextActionTick !== null);
      if (firstScheduled) {
        firstScheduled.celerity.nextUp = true;
        firstScheduled.css = (firstScheduled.css + ' active').trim();
      }
    }
    return context;
  }

  // TRIAL-REALTIME: stop the loop + remove the hook when the tracker closes
  // so we don't leak timers or stale listeners.
  async _onClose(options) {
    this._realtimeStop();
    return super._onClose?.(options);
  }
}
