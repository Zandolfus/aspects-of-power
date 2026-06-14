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
  const ritualActivation = declared.ritualActivation ?? false;
  const aiAutoInvest = declared.aiAutoInvest ?? false;
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
      preRitualActivation: ritualActivation,
      preAiAutoInvest: aiAutoInvest,
    });
  } else {
    // No linked player online — GM (or whoever clicked Advance) runs it.
    await item.roll({ executeDeferred: true, preInvestAmount: investAmount, preManaInvestAmount: manaInvestAmount, preAoeRegionId: aoeRegionId, preOrbDischarging: orbDischarging, preTargetIds: targetIds, preTeleportDestination: teleportDestination, preLeapDestination: leapDestination, preLeapApexFt: leapApexFt, ritualActivation, aiAutoInvest });
    // Ritual temp-skill cleanup: a Medium-fired skill cloned onto the
    // activator (compendium-sourced activation) survives the declare→fire
    // wait by design; once the roll above resolves it's spent — remove it.
    if (item.flags?.aspectsofpower?.isRitualActivation && c.actor?.items?.get(item.id)) {
      try { await c.actor.deleteEmbeddedDocuments('Item', [item.id]); } catch (_) { /* best-effort */ }
    }
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

  // Paint canvas turn-marker rings on every combatant that's waiting for the
  // player to declare an action, plus the singular next-soonest queued one
  // (which is already combat.combatant after the sync above, so core's marker
  // for it stays — we just add the extras). Runs after the combat.turn write
  // completes so core's _updateTurnMarkers has finished and our additions
  // aren't clobbered.
  _aopSyncTurnMarkers(combat);
}

/**
 * Sync canvas turn-marker rings to AOP's predicate (every combatant token
 * gets a refresh flag; the patched _refreshTurnMarker decides what paints).
 *
 * Used at fire-time as a backup for the case where combat.turn doesn't
 * change (no one queued → no combatTurnChange → no built-in
 * _updateTurnMarkers cascade). When combat.turn DOES change, the patched
 * _updateTurnMarkers below handles the refresh.
 */
function _aopSyncTurnMarkers(combat) {
  if (!combat) return;
  for (const cm of combat.combatants) {
    const tok = cm.token?.object;
    if (tok) tok.renderFlags.set({ refreshTurnMarker: true });
  }
}

/**
 * Predicate: should this token currently display a turn-marker ring?
 *
 * True iff the token's combatant has no scheduled action OR is the soonest-
 * scheduled combatant (after the clock). Mirrors the target set computed
 * in _onCelAdvance + the sidebar indicator.
 */
function _aopIsInTurnMarkerSet(token, combat) {
  const cm = combat.combatants.find(c => c.tokenId === token.id);
  if (!cm) return false;
  const declared = cm.flags?.[FLAG_NS]?.declaredAction;
  const nextTick = declared?.scheduledTick ?? null;
  if (nextTick == null) return true;
  const clockTick = getClockTick(combat);
  let soonestTokenId = null;
  let soonestTick = Infinity;
  for (const c2 of combat.combatants) {
    const t = c2.flags?.[FLAG_NS]?.declaredAction?.scheduledTick ?? null;
    if (t === null || t <= clockTick) continue;
    if (t < soonestTick) { soonestTick = t; soonestTokenId = c2.tokenId; }
  }
  return soonestTokenId === token.id;
}

function _aopCelerityActive() {
  return CONFIG.ui.combat?.name === 'CelerityCombatTracker';
}

/**
 * Patch Foundry's turn-marker machinery so it can paint markers on multiple
 * tokens (every unqueued combatant + soonest-queued) instead of just the
 * one combat.combatant. Two overrides:
 *
 * 1. Combat#_updateTurnMarkers — fires on combatTurnChange/combatRound/etc.
 *    Core only sets the refresh flag on combat.combatant's token. We set it
 *    on every combatant token so the per-token refresh evaluation reaches
 *    all of them, plus on any orphan turn-marker tokens (cleanup).
 *
 * 2. Token#_refreshTurnMarker — fires from the refresh flag. Core's check
 *    is strictly `isTurn = combat.combatant.tokenId === this.id`, which
 *    destroys any marker we'd manually add to a non-active token. We
 *    replace that with our set-membership predicate.
 *
 * Both overrides defer to the originals when celerity isn't the active
 * combat tracker (so the system can ship alongside a vanilla combat mode
 * if ever toggled).
 *
 * Called once from system init. Idempotent via a flag on the prototype.
 */
export function installAopTurnMarkerPatch() {
  const CombatCls = CONFIG.Combat?.documentClass;
  const TokenCls = CONFIG.Token?.objectClass;
  if (!CombatCls || !TokenCls) return;
  if (CombatCls.prototype._aopTurnMarkerPatched) return;

  const origUpdate = CombatCls.prototype._updateTurnMarkers;
  CombatCls.prototype._updateTurnMarkers = function() {
    if (!_aopCelerityActive()) return origUpdate.call(this);
    if (!canvas?.ready) return;
    for (const cm of this.combatants) {
      const tok = cm.token?._object;
      if (tok) tok.renderFlags.set({ refreshTurnMarker: true });
    }
    const combatantTokenIds = new Set([...this.combatants].map(c => c.tokenId));
    for (const tok of canvas.tokens.turnMarkers) {
      if (!combatantTokenIds.has(tok.id)) tok.renderFlags.set({ refreshTurnMarker: true });
    }
  };

  const origRefresh = TokenCls.prototype._refreshTurnMarker;
  const TokenTurnMarker = foundry?.canvas?.placeables?.tokens?.TokenTurnMarker;
  TokenCls.prototype._refreshTurnMarker = function() {
    const c = game.combat;
    if (!_aopCelerityActive() || !c?.started) return origRefresh.call(this);
    if (!TokenTurnMarker) return origRefresh.call(this);

    const tmConfig = this.document.turnMarker;
    const enabled = CONFIG.Combat.settings.turnMarker.enabled
      && (tmConfig?.mode !== CONST.TOKEN_TURN_MARKER_MODES?.DISABLED);
    const want = enabled && _aopIsInTurnMarkerSet(this, c);

    if (want) {
      if (!this.turnMarker) this.turnMarker = this.addChildAt(new TokenTurnMarker(this), 0);
      canvas.tokens.turnMarkers.add(this);
      this.turnMarker.draw();
    } else if (this.turnMarker) {
      canvas.tokens.turnMarkers.delete(this);
      this.turnMarker.destroy();
      this.turnMarker = null;
    }
  };

  CombatCls.prototype._aopTurnMarkerPatched = true;
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

// TRIAL-REALTIME: action handler bound via DEFAULT_OPTIONS. The actual
// auto-advance loop only runs on the GM client (combat.update + dispatch
// authority must be centralized). Players route their click through the
// system socket; GM receives, toggles on its own tracker instance, and
// writes the realtimeRunning flag to the combat doc — which broadcasts
// to all clients via the normal document-update hooks and updates the
// button icon everywhere.
//
// Source-of-truth check is the combat flag (not this._realtimeRunning),
// so if the GM refreshes mid-loop the new tracker instance still reflects
// the running state and the next click correctly stops it.
async function _onCelRealtimeToggle(event, target) {
  const combat = this.viewed;
  const flagOn = !!combat?.flags?.[FLAG_NS]?.realtimeRunning;
  if (game.user.isGM) {
    if (flagOn || this._realtimeRunning) await this._realtimeStop();
    else await this._realtimeStart();
  } else {
    game.socket.emit('system.aspects-of-power', {
      type: 'gmCelerityRealtimeToggle',
    });
  }
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

  async _realtimeStart() {
    if (!game.user.isGM) return;
    if (this._realtimeRunning) return;
    this._realtimeRunning = true;
    // Hook into combatant updates so a new earlier-scheduled declare
    // pre-empts the in-flight timeout.
    if (!this._realtimeHookId) {
      this._realtimeHookId = Hooks.on('updateCombatant', (cm, changes) => {
        if (!this._realtimeRunning) return;
        const declaredPath = `flags.${FLAG_NS}.declaredAction`;
        if (!foundry.utils.hasProperty(changes, declaredPath)) return;
        // Only re-schedule on actual NEW declares (non-null itemId). When
        // _onCelAdvance clears the firing combatant's declaredAction to null,
        // this hook would otherwise fire mid-await and queue another
        // setTimeout — which could fire a second action before our auto-pause
        // reaches _realtimeStop. Skipping null-changes keeps fires single-shot.
        const newDeclared = foundry.utils.getProperty(changes, declaredPath);
        if (!newDeclared || !newDeclared.itemId) return;
        this._scheduleNextFire();
      });
    }
    this._scheduleNextFire();
    // Broadcast running state via combat flag so player tracker buttons
    // update too. Document update auto-renders all clients' trackers.
    if (this.viewed) {
      try { await this.viewed.update({ [`flags.${FLAG_NS}.realtimeRunning`]: true }); }
      catch (e) { console.warn('[TRIAL-REALTIME] flag write failed:', e); }
    }
  }

  async _realtimeStop() {
    const wasRunning = this._realtimeRunning;
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
    // Clear the broadcast flag so all clients' buttons flip to ▶. Only
    // GM writes the flag (combat.update auth); player-stop is a no-op for
    // them since they never had a local loop.
    if (game.user.isGM && this.viewed) {
      const flagOn = !!this.viewed.flags?.[FLAG_NS]?.realtimeRunning;
      if (wasRunning || flagOn) {
        try { await this.viewed.update({ [`flags.${FLAG_NS}.realtimeRunning`]: false }); }
        catch (e) { console.warn('[TRIAL-REALTIME] flag clear failed:', e); }
      }
    }
  }

  // Lerp ALL in-flight movement tokens concurrently during the realtime wait.
  // Each token goes from its CURRENT doc position to where it should be at
  // nextTick (per interpolateMovementPosition — which extrapolates linearly
  // along the declared startPos→endPos by clock). Phil's full move and
  // Stalker's partial step both progress visually during the same real-time
  // window. Auto-stops on pause or if any actor re-declares.
  _startConcurrentLerps(combat, nextTick, realtimeMs) {
    if (this._realtimeLerpIntervalId) {
      clearInterval(this._realtimeLerpIntervalId);
      this._realtimeLerpIntervalId = null;
    }
    if (!combat) return;

    // Snapshot each in-flight movement: combatantId, token, current pos,
    // target pos at nextTick, scheduledTick fingerprint for re-declare detection.
    const targets = [];
    for (const cm of combat.combatants) {
      const mv = cm.flags?.['aspectsofpower']?.declaredAction;
      if (!mv || mv.itemId !== MOVEMENT_ITEM_ID) continue;
      if (!mv.startPos || !mv.endPos) continue;
      const tok = cm.token;
      if (!tok) continue;
      const targetPos = interpolateMovementPosition(mv, nextTick);
      targets.push({
        combatantId: cm.id,
        tok,
        startX: tok.x,
        startY: tok.y,
        targetX: targetPos.x,
        targetY: targetPos.y,
        scheduledTickFingerprint: mv.scheduledTick,
      });
    }
    if (targets.length === 0) return;

    const STEP_MS = this.constructor.REALTIME_MOVEMENT_LERP_STEP_MS;
    const totalSteps = Math.max(1, Math.floor(realtimeMs / STEP_MS));
    const stepDuration = Math.round(realtimeMs / totalSteps);
    let stepIdx = 0;

    this._realtimeLerpIntervalId = setInterval(async () => {
      if (!this._realtimeRunning) {
        clearInterval(this._realtimeLerpIntervalId);
        this._realtimeLerpIntervalId = null;
        return;
      }
      stepIdx++;
      if (stepIdx >= totalSteps) {
        clearInterval(this._realtimeLerpIntervalId);
        this._realtimeLerpIntervalId = null;
        return;
      }
      const frac = stepIdx / totalSteps;

      const updates = [];
      for (const t of targets) {
        // Skip if this combatant re-declared mid-flight (new movement
        // started; old lerp is stale). The new declare will trigger its
        // own _scheduleNextFire which will start a fresh concurrent-lerps
        // cycle.
        const cm = this.viewed?.combatants?.get(t.combatantId);
        const live = cm?.flags?.['aspectsofpower']?.declaredAction;
        if (!live
            || live.itemId !== MOVEMENT_ITEM_ID
            || live.scheduledTick !== t.scheduledTickFingerprint) {
          continue;
        }
        const lerpX = Math.round(t.startX + frac * (t.targetX - t.startX));
        const lerpY = Math.round(t.startY + frac * (t.targetY - t.startY));
        updates.push(
          t.tok.update(
            { x: lerpX, y: lerpY },
            { animation: { duration: stepDuration }, _celerityCommit: true }
          ).catch(e => console.warn('[TRIAL-REALTIME] lerp step failed:', e))
        );
      }
      await Promise.all(updates);
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

    // Animate ALL in-flight movements concurrently during the wait. Phil's
    // 1-second wait coincides with Stalker's 1 second of a 7-second walk
    // (Stalker advances ~15%). Each token lerps from its CURRENT doc
    // position to where it should be at nextTick (per the existing
    // interpolateMovementPosition helper, which extrapolates by clock).
    // When the earliest fire triggers, every token is mid-flight at the
    // visually-correct fraction — no Phil-runs-while-others-frozen issue.
    if (realtimeMs > 50) {
      this._startConcurrentLerps(combat, nextTick, realtimeMs);
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
    // swap between fa-play and fa-pause icons. Read from the combat flag
    // (shared across clients) so player trackers reflect the GM's loop
    // state without needing their own local _realtimeRunning instance.
    context.celerityRealtimeRunning = !!combat?.flags?.[FLAG_NS]?.realtimeRunning;
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
      // Indicator highlights combatants who have NO queued action — i.e.,
      // the ones waiting on the player's next declaration. Inverts the
      // older "next-up = soonest queued" semantic, which is less useful in
      // real-time mode (queued actors are mid-progress; ready actors are
      // the ones needing input). Multiple actors can be highlighted at once.
      for (const t of context.turns) {
        if (t.celerity?.nextActionTick == null) {
          t.celerity.nextUp = true;
          t.css = (t.css + ' active').trim();
        }
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
