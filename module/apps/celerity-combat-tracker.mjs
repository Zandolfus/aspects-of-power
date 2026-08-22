/**
 * Celerity Combat Tracker — subclass of Foundry's native sidebar tracker
 * that replaces the initiative-ordered combatant list with a
 * celerity-ordered timeline. Standard combat controls (start/end, add
 * combatant, settings, etc.) are preserved via the inherited header and
 * footer parts.
 *
 * Wired by setting `CONFIG.ui.combat = CelerityCombatTracker` at init.
 */

import { getClockTick, referenceRoundLength, runRoundStart, MOVEMENT_ITEM_ID, BREAK_FREE_ITEM_ID, separateOverlappingTokens, formatTicksAsTime, fastestReferenceRound, realtimeTicksPerMs } from '../systems/celerity.mjs';
import { jumpMovementsTo, stopDeclaredMove, runAllDeclaredMoves, pauseAllDeclaredMoves, runDeclaredMove } from '../systems/movement.mjs';
import { isActingGM } from '../helpers/gm.mjs';
import { isAiDriven } from '../systems/ai.mjs';
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
  // The COMMITTED clock, not the continuous read: while the realtime loop
  // runs, the continuous clock has already reached the firing entry's tick
  // by the time this executes, and filtering on it would exclude the very
  // entry this advance exists to fire.
  const clockTick = combat.flags?.[FLAG_NS]?.clockTick ?? 0;
  // Find the soonest declared entry with a scheduled tick still in the future.
  // TWO parallel tracks per combatant (2026-07-14): declaredAction (skills)
  // + declaredMovement — each is an independent queue entry, so a walking
  // actor's queued pistol shot and the walk itself both advance the clock.
  const _entriesOf = (c) => {
    const out = [];
    const da = c.flags?.[FLAG_NS]?.declaredAction;
    if (da) out.push({ c, declared: da });
    const dm = c.flags?.[FLAG_NS]?.declaredMovement;
    if (dm) out.push({ c, declared: dm });
    return out;
  };
  // OVERDUE ENTRIES FIRE FIRST (RCA 2026-08-22, the stranded-combat bug):
  // this filter used to demand `scheduledTick > clockTick`, which made any
  // entry the clock had passed WITHOUT firing invisible forever. Under the
  // realtime loop, an advance that THREW committed the clock at exactly the
  // failed entry's tick (see the error path in _scheduleNextFire) — one
  // stranded action per play-press, "everyone ready, actions queued, rounds
  // zooming". Overdue entries are now simply the most-urgent queue members:
  // they fire immediately and the clock never moves backwards (max guard).
  const queued = [...combat.combatants]
    .flatMap(_entriesOf)
    .filter(e => typeof e.declared.scheduledTick === 'number')
    .sort((a, b) => a.declared.scheduledTick - b.declared.scheduledTick);
  if (queued.length === 0) {
    ui.notifications.info('No queued actions to advance to.');
    return 'none';
  }
  let { c, declared } = queued[0];
  let newClock = Math.max(clockTick, declared.scheduledTick);

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
    // One member's broken round-start must not take down the whole advance
    // (RCA 2026-08-22: an uncaught throw anywhere in this loop stranded the
    // firing entry under realtime). Contain it, name the member, move on.
    try {
      for (let i = 0; i < crossings; i++) {
        await runRoundStart(combat, member);
      }
    } catch (e) {
      console.error(`[celerity] round-start failed for ${member.name}:`, e);
      ui.notifications.warn(`Round-start failed for ${member.name} — see console.`);
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
  // tick than originally targeted. Re-read both tracks from the latest
  // combatant flags so wait/scheduledTick reflect post-truncation values.
  const requeued = [...combat.combatants]
    .flatMap(cm => _entriesOf(cm).map(e => ({ cm: e.c, declared: e.declared })))
    .filter(e => typeof e.declared.scheduledTick === 'number')
    .sort((a, b) => a.declared.scheduledTick - b.declared.scheduledTick);
  if (requeued.length > 0 && requeued[0].declared.scheduledTick <= newClock) {
    c = requeued[0].cm;
    declared = requeued[0].declared;
    // Same overdue rule as the initial pick: the clock is monotonic.
    newClock = Math.max(clockTick, declared.scheduledTick);
  }

  // ── RESOURCE-AURA CADENCE (design-aura-ticks.md) ──────────────────────
  // ⚠ THE ORDER HERE IS THE WHOLE TRICK. This runs with `newClock` final but
  // BEFORE the movement block below animates tokens and clears their
  // `declaredMovement` flags. That is the only window in which every mover's
  // movement is still readable AND token documents still sit at their OLD
  // positions — which is what lets an aura sample a target's position at each
  // intermediate tick moment instead of judging the whole round by where
  // everyone happened to end up. Move this after the commit and the feature
  // silently degrades to one all-or-nothing sample.
  //
  // Isolated: an aura failure must not cancel the clock advance itself.
  try {
    const { sweepAuraTicks } = await import('../systems/aura-ticks.mjs');
    await sweepAuraTicks(combat, newClock);
  } catch (e) {
    console.error('[aura] tick sweep failed — clock still advances:', e);
  }

  // Bring every in-flight movement to where the clock now stands (v14
  // rework). During realtime play the glides already track the clock and
  // this is a no-op; after a manual advance it slides each token to its
  // interpolated point (duration scaled to the distance) and re-plans the
  // remainder. The old model instead wrote lerp positions with a flat
  // 400ms animation here — the "snapshot lurch".
  await jumpMovementsTo(combat, newClock);

  // Commit completion: clear flags + debit stamina for any movement whose
  // scheduled tick the clock has now reached (including the firing entry
  // itself when it is a movement). The engagement-halt auto-resume that
  // used to live here is gone — nothing sets originalEndPos since the
  // TRIAL-REALTIME disable, and mid-flight halts are now handled at
  // checkpoint time by haltDeclaredMove.
  for (const member of combat.combatants) {
    const mv = member.flags?.[FLAG_NS]?.declaredMovement;
    if (!mv || mv.itemId !== MOVEMENT_ITEM_ID) continue;
    if (newClock < mv.scheduledTick) continue;
    if (member.token) await stopDeclaredMove(member.token);
    // Movement track clears; a still-queued skill (parallel track) keeps
    // owning nextActionTick.
    const _qa = member.flags?.[FLAG_NS]?.declaredAction;
    await member.update({
      [`flags.${FLAG_NS}.declaredMovement`]: null,
      [`flags.${FLAG_NS}.nextActionTick`]: (typeof _qa?.scheduledTick === 'number') ? _qa.scheduledTick : null,
      [`flags.${FLAG_NS}.lastActionName`]: mv.label,
      [`flags.${FLAG_NS}.lastActionWait`]: mv.wait,
      [`flags.${FLAG_NS}.lastActionAt`]: newClock,
    });
    if (mv.staminaCost && member.actor) {
      const cur = member.actor.system.stamina?.value ?? 0;
      await member.actor.update({
        'system.stamina.value': Math.max(0, cur - mv.staminaCost),
      });
    }
  }

  // Advance clock. (Movement-completion combatants are already cleared
  // above; for skill-action firings we still need to clear the firer's
  // flags before dispatching so a follow-up can re-queue.)
  await combat.update({ [`flags.${FLAG_NS}.clockTick`]: newClock });

  // Equidistant bump: AFTER the clock advances + completions clear, symmetrically
  // separate any RESTING/arrived tokens that ended overlapping (two units that
  // converged on the same point push apart equally). Tokens still in transit are
  // excluded inside the helper — they pass THROUGH others mid-flight; only their
  // final landing separates. Runs here (post-completion) so just-arrived tokens
  // have their movement flag cleared and count as resting.
  try { await separateOverlappingTokens(canvas.scene); }
  catch (e) { console.warn('[celerity] separateOverlappingTokens failed:', e); }

  // Movement-completion branch: the action that drove this advance was a
  // movement, so there's no skill roll to dispatch. The position update +
  // flag clear above is the entire "fire" step. A PLAYER's arrival is a
  // decision point — pause so they can declare what comes next without the
  // clock eating their thinking time (user 2026-08-09, the kiting session).
  // NPC arrivals keep the world running: the AI re-decides instantly.
  if (declared.itemId === MOVEMENT_ITEM_ID) {
    ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} arrives (${declared.label}).`);
    return isAiDriven(c.actor) ? 'continue' : 'pause';
  }

  // Break-free branch: actor declared a manual break-free against a debuff.
  // Look up the effect (it may have been broken by another means since
  // declaration — auto-break, dispel, expiry); if gone, skip with a notice.
  // Otherwise roll the break check via the shared actor helper.
  if (declared.itemId === BREAK_FREE_ITEM_ID) {
    await c.update({
      [`flags.${FLAG_NS}.declaredAction`]: null,
      [`flags.${FLAG_NS}.nextActionTick`]:
        (typeof c.flags?.[FLAG_NS]?.declaredMovement?.scheduledTick === 'number')
          ? c.flags[FLAG_NS].declaredMovement.scheduledTick : null,
    });
    const actor = c.actor;
    const effect = declared.effectId ? actor?.effects?.get(declared.effectId) : null;
    if (!actor || !effect) {
      ui.notifications.info(`${c.name}: break-free attempt skipped (debuff already gone).`);
      return 'pause';
    }
    ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} fires "${declared.label}".`);
    const isPC = !!actor.hasPlayerOwner;
    try {
      await actor._attemptBreakRoll(effect, { whisper: !isPC });
    } catch (e) {
      console.error('[celerity] break-free dispatch failed:', e);
    }
    return 'pause';
  }

  // Skill-action branch (existing flow): clear the firer's flags + dispatch
  // the queued item to its canonical player (or run locally on GM).
  // _aopFireDispatch flag signals the preUpdateCombatant orphan-cleanup
  // hook to skip region deletion — the roll about to run still needs to
  // resolve against this region. The AOE flow inside item.roll() deletes
  // the region itself once damage has applied (for instantaneous AOEs).
  await c.update({
    [`flags.${FLAG_NS}.declaredAction`]: null,
    // A movement still in flight (parallel track) keeps owning "next up".
    [`flags.${FLAG_NS}.nextActionTick`]:
      (typeof c.flags?.[FLAG_NS]?.declaredMovement?.scheduledTick === 'number')
        ? c.flags[FLAG_NS].declaredMovement.scheduledTick : null,
  }, { _aopFireDispatch: true });
  const item = c.actor?.items?.get(declared.itemId);
  if (!item) {
    // Orphaned action: the queued item no longer exists (deleted, ritual
    // clone cleaned up, etc.). The declaredAction flag was already cleared
    // above — post a chat notice so the OWNER sees why the turn fizzled,
    // not just a GM-side toast (pending-combat-ai-backlog).
    ui.notifications.warn(`${c.name}: queued item not found (id=${declared.itemId}); action cancelled.`);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: c.actor }),
      content: `<p><em>${c.name}'s queued <strong>${declared.label ?? 'action'}</strong> is cancelled — the skill or item no longer exists.</em></p>`,
    });
    return 'pause';
  }
  // Reality wins at FIRE time for melee (user 2026-08-09: "John was very
  // far away from the Boughbreakers but they still hit him"): a swing
  // declared while the target stood in reach re-measures the moment it
  // lands. Every declared target out of reach → the swing whiffs — celerity
  // sunk, no roll, exactly like swinging at where someone used to be.
  // Ranged/AOE/untargeted skills pass through unchanged (their fire paths
  // carry their own targeting semantics).
  // A corpse can't fire. Incapacitation unqueues both tracks when damage
  // lands, but a fire already in this advance's hands (or a race with the
  // unqueue write) still needs the gate.
  if ((c.actor?.system?.health?.value ?? 1) <= 0) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: c.actor }),
      content: `<p><em>${c.name}'s <strong>${declared.label}</strong> dies with them.</em></p>`,
    });
    return 'continue';
  }

  {
    const meleeTypes = ['str_weapon', 'dex_weapon', 'magic_melee'];
    const rangedTypes = ['phys_ranged', 'magic_projectile'];
    const rollType = item.system?.roll?.type ?? '';
    const targetIdsAtFire = declared.targetIds ?? [];
    const isMelee = meleeTypes.includes(rollType);
    const isRanged = rangedTypes.includes(rollType);
    if ((isMelee || isRanged) && targetIdsAtFire.length && c.token) {
      const scene = c.token.parent;
      const gs = scene?.grid?.size ?? 100;
      const ftPerPx = (scene?.grid?.distance ?? 5) / gs;
      const edgeFt = (a, b) => {
        const dx = Math.max(b.x - (a.x + (a.width ?? 1) * gs), a.x - (b.x + (b.width ?? 1) * gs), 0);
        const dy = Math.max(b.y - (a.y + (a.height ?? 1) * gs), a.y - (b.y + (b.height ?? 1) * gs), 0);
        return Math.hypot(dx, dy) * ftPerPx;
      };
      // Melee: skill reach + a hair of slack. Ranged: the caster's throw
      // range (castingRange, same source the destination prompts use) + a
      // 5 ft grace so boundary jitter doesn't eat honest shots.
      const limitFt = isMelee
        ? (item._resolveSkillReach?.() ?? 5) + 0.5
        : Math.max(5, Math.round(c.actor?.system?.castingRange ?? 30)) + 5;
      const anyInRange = targetIdsAtFire.some(tid => {
        const t = scene?.tokens.get(tid);
        return t && edgeFt(c.token, t) <= limitFt;
      });
      if (!anyInRange) {
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: c.actor }),
          content: isMelee
            ? `<p><em>${c.name}'s <strong>${declared.label}</strong> cuts empty air — the target is out of reach.</em></p>`
            : `<p><em>${c.name}'s <strong>${declared.label}</strong> falls short — the target is beyond range.</em></p>`,
        });
        return isAiDriven(c.actor) ? 'continue' : 'pause';
      }
    }
  }

  ui.notifications.info(`Clock → ${declared.scheduledTick}. ${c.name} fires "${declared.label}".`);

  // Dispatch the deferred roll to the actor's CANONICAL player — the user
  // whose `character` field IS this actor. Each PC has exactly one such
  // user. If that player isn't online (or this is an NPC with no linked
  // user), fall back to running locally on the GM's client. Never picks
  // a co-owner (e.g., another PC who happens to have OWNER permission).
  const investAmount = declared.investAmount ?? null;
  // Co-invest: fall back to the old mana-only field so an action declared
  // before this shipped still re-spends what the player committed to, rather
  // than firing free.
  const coInvestAmount = declared.coInvestAmount ?? declared.manaInvestAmount ?? null;
  const aoeRegionId = declared.aoeRegionId ?? null;
  const orbDischarging = declared.orbDischarging ?? false;
  const targetIds = declared.targetIds ?? [];
  const teleportDestination = declared.teleportDestination ?? null;
  const leapDestination = declared.leapDestination ?? null;
  const leapApexFt = declared.leapApexFt ?? null;
  const ritualActivation = declared.ritualActivation ?? false;
  const aiAutoInvest = declared.aiAutoInvest ?? false;
  const weaponId = declared.weaponId ?? null;
  const linkedPlayer = game.users.find(u => !u.isGM && u.active && u.character?.id === c.actor?.id);
  if (linkedPlayer) {
    game.socket.emit('system.aspects-of-power', {
      action: 'executeQueuedAction',
      actorId: c.actor.id,
      itemId: item.id,
      targetUserId: linkedPlayer.id,
      preInvestAmount: investAmount,
      preCoInvestAmount: coInvestAmount,
      preAoeRegionId: aoeRegionId,
      preOrbDischarging: orbDischarging,
      preTargetIds: targetIds,
      preTeleportDestination: teleportDestination,
      preLeapDestination: leapDestination,
      preLeapApexFt: leapApexFt,
      preRitualActivation: ritualActivation,
      preAiAutoInvest: aiAutoInvest,
      preWeaponId: weaponId,
    });
  } else {
    // No linked player online — GM (or whoever clicked Advance) runs it.
    try {
      await item.roll({ executeDeferred: true, preInvestAmount: investAmount, preCoInvestAmount: coInvestAmount, preAoeRegionId: aoeRegionId, preOrbDischarging: orbDischarging, preTargetIds: targetIds, preTeleportDestination: teleportDestination, preLeapDestination: leapDestination, preLeapApexFt: leapApexFt, ritualActivation, aiAutoInvest, preWeaponId: weaponId });
    } finally {
      // Ritual temp-skill cleanup: a Medium-fired skill cloned onto the
      // activator (compendium-sourced activation) survives the declare→fire
      // wait by design; the queued action is consumed either way once the
      // roll returns — remove the clone even when the AOE branch aborts
      // early (placement cancelled, declared region gone) or roll() throws.
      if (item.flags?.aspectsofpower?.isRitualActivation && c.actor?.items?.get(item.id)) {
        try { await c.actor.deleteEmbeddedDocuments('Item', [item.id]); } catch (_) { /* best-effort */ }
      }
    }
  }

  // Variable holds: a fired action may be the trigger a held working waits
  // on (release follows the trigger, it does not interrupt).
  try {
    const { checkHeldCastTriggers } = await import('../systems/celerity.mjs');
    await checkHeldCastTriggers(combat, c);
  } catch (e) { console.warn('[held-cast] trigger scan failed:', e); }

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
  return 'pause';
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
  // READY MEANS BOTH TRACKS ARE EMPTY (user 2026-08-10). This used to read
  // only declaredAction, so a token doing nothing BUT walking wore a "your
  // move" ring for the whole walk; and it separately ringed the soonest
  // queued actor, which made the marker mean two different things at once.
  // The ring now has exactly one meaning: this combatant needs a decision.
  const f = cm.flags?.[FLAG_NS] ?? {};
  return !f.declaredAction && !f.declaredMovement;
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
      const tok = cm.token?.object;
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

  // Repaint triggers. The patched _updateTurnMarkers above only fires on
  // combat.turn / round changes (core's cascade); declaring or cancelling an
  // action doesn't move combat.turn, so without these hooks a token's ring
  // never updates outside a clock advance — which is why the rings vanished.
  // Each is client-local (render flags are per-canvas) — no GM gate. Covers
  // _onCelCancel automatically (its declaredAction→null write fires updateCombatant).
  Hooks.on('updateCombatant', (combatant, changes) => {
    if (!_aopCelerityActive()) return;
    const combat = combatant.parent;
    if (!combat?.started) return;
    // BOTH tracks drive the ring now (it means "needs a decision"), so a
    // movement declare or arrival has to repaint it too.
    if (foundry.utils.hasProperty(changes, `flags.${FLAG_NS}.declaredAction`)
      || foundry.utils.hasProperty(changes, `flags.${FLAG_NS}.declaredMovement`)) {
      _aopSyncTurnMarkers(combat);
    }
  });
  Hooks.on('createCombatant', (combatant) => {
    if (_aopCelerityActive() && combatant.parent?.started) _aopSyncTurnMarkers(combatant.parent);
  });
  Hooks.on('deleteCombatant', (combatant) => {
    if (_aopCelerityActive() && combatant.parent?.started) _aopSyncTurnMarkers(combatant.parent);
  });

  CombatCls.prototype._aopTurnMarkerPatched = true;
}

async function _onCelCancel(event, target) {
  const combatantId = target.closest('[data-combatant-id]')?.dataset?.combatantId;
  if (!combatantId) return;
  const combat = this.viewed;
  const c = combat?.combatants.get(combatantId);
  if (!c) return;
  // Two parallel tracks: cancel the SKILL first (most likely intent); a
  // second click cancels the walk. For a cancelled movement the token stays
  // at its current lerp position; no stamina debit — sunk cost is the
  // celerity-time spent, not the resource. Per design.
  const qa = c.flags?.[FLAG_NS]?.declaredAction;
  const qm = c.flags?.[FLAG_NS]?.declaredMovement;
  const declared = qa ?? qm;
  if (!declared) return;
  const clearingAction = !!qa;
  const other = clearingAction ? qm : null;
  // Cancelling the movement track also discards its core plan/glide — the
  // token holds wherever the last checkpoint left it (sunk celerity, no
  // stamina charge, per design).
  if (!clearingAction && c.token) await stopDeclaredMove(c.token);
  await c.update({
    [`flags.${FLAG_NS}.${clearingAction ? 'declaredAction' : 'declaredMovement'}`]: null,
    [`flags.${FLAG_NS}.nextActionTick`]:
      (typeof other?.scheduledTick === 'number') ? other.scheduledTick : null,
  });
  const noun = declared?.itemId === MOVEMENT_ITEM_ID ? 'movement' : (declared?.label ?? 'action');
  ui.notifications.info(`${c.name} — ${noun} cancelled.${other ? ' (Movement still in flight — cancel again to stop it.)' : ''}`);
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: c.actor }),
    content: `<p><em>${c.name} cancels <strong>${declared.label}</strong>.</em></p>`,
  });
}

/**
 * For each persistent AOE region on the active scene, find tokens still
 * inside (last-known position) and re-tick those whose (newClock - lastTickedAt)
 * has crossed the region's casterReticPeriod. Region behaviors handle
 * entry + path-crossing; this handles the "standing-in" cadence.
 */
async function _scanPersistentAoeReticks(combat, newClock) {
  if (!isActingGM()) return;
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
      [`flags.${FLAG_NS}.declaredMovement`]: null,
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
  // (config celerity.REALTIME_FASTEST_ROUND_SECONDS; this static is the
  // fallback). While the loop runs, the clock flows continuously
  // (getClockTick reads the realtime anchor flag) and every declared
  // movement GLIDES via core planned movements at celerity-matched speed —
  // no interpolation writes. Auto-pauses on ACTION fire so players can
  // adjust; movement arrivals keep the world running.
  static REALTIME_FASTEST_ROUND_SECONDS = 5;
  _realtimeRunning = false;
  _realtimeTimeoutId = null;
  _realtimeHookId = null;

  _fastestRoundLen(combat) {
    return fastestReferenceRound(combat);
  }

  _realtimeSeconds() {
    return CONFIG.ASPECTSOFPOWER.celerity?.REALTIME_FASTEST_ROUND_SECONDS
      ?? this.constructor.REALTIME_FASTEST_ROUND_SECONDS;
  }

  async _realtimeStart() {
    if (!game.user.isGM) return;
    if (this._realtimeRunning) return;
    const combat = this.viewed;
    if (!combat?.started) return;
    this._realtimeRunning = true;
    // Hook into combatant updates so a new declare on EITHER track
    // pre-empts the in-flight timeout, and a freshly declared movement
    // starts gliding immediately while the world runs.
    if (!this._realtimeHookId) {
      this._realtimeHookId = Hooks.on('updateCombatant', (cm, changes) => {
        if (!this._realtimeRunning) return;
        const fchg = changes?.flags?.[FLAG_NS] ?? {};
        // Only react to actual NEW declares (non-null itemId). When
        // _onCelAdvance clears the firing combatant's flag to null, reacting
        // would queue another setTimeout and double-fire before auto-pause.
        const newAction = fchg.declaredAction;
        const newMove = fchg.declaredMovement;
        if (newMove?.itemId) {
          // The plan is created by the declaring client a beat after the
          // flag write lands — retry briefly until it is startable.
          const tryRun = (left) => {
            if (!this._realtimeRunning) return;
            if (runDeclaredMove(cm) || left <= 0) return;
            setTimeout(() => tryRun(left - 1), 250);
          };
          tryRun(8);
        }
        if (newAction?.itemId || newMove?.itemId) this._scheduleNextFire();
      });
    }
    // Anchor the continuous clock BEFORE starting glides so the speed
    // override and the fire delays read the same pinned rate.
    const rate = fastestReferenceRound(combat) / (this._realtimeSeconds() * 1000);
    try {
      await combat.update({
        [`flags.${FLAG_NS}.realtimeRunning`]: true,
        [`flags.${FLAG_NS}.realtime`]: {
          running: true,
          startedAtMs: Date.now(),
          clockAtStart: combat.flags?.[FLAG_NS]?.clockTick ?? 0,
          ticksPerMs: rate,
        },
      });
    } catch (e) { console.warn('[TRIAL-REALTIME] anchor write failed:', e); }
    runAllDeclaredMoves(combat);
    this._scheduleNextFire();
  }

  async _realtimeStop(commitTick = null) {
    const wasRunning = this._realtimeRunning;
    this._realtimeRunning = false;
    if (this._realtimeTimeoutId) {
      clearTimeout(this._realtimeTimeoutId);
      this._realtimeTimeoutId = null;
    }
    if (this._realtimeHookId) {
      Hooks.off('updateCombatant', this._realtimeHookId);
      this._realtimeHookId = null;
    }
    // Freeze the world: commit the continuous clock to the flag (read it
    // BEFORE clearing the anchor — after the clear it would fall back to
    // the stale stored value), then pause every glide at its next
    // checkpoint. Order matters: clock first so any pause-triggered reads
    // see the committed value.
    if (game.user.isGM && this.viewed) {
      const combat = this.viewed;
      const flagOn = !!combat.flags?.[FLAG_NS]?.realtimeRunning;
      if (wasRunning || flagOn) {
        // A fire-driven stop commits the FIRE tick, not the continuous
        // read — resolution work (dispatch, chat) takes real milliseconds
        // that must not leak into the combat clock as skipped ticks. The
        // max() guard keeps the clock monotonic if the advance already
        // committed past the requested tick.
        //
        // NULL-COMMIT CLAMP (RCA round 2, 2026-08-22): a stop with no
        // explicit tick used to commit the raw continuous read — wall-time
        // inflated if the loop had been idling — vaulting the clock over
        // every queued action. The committed clock must never pass the
        // earliest thing still scheduled to happen.
        const stored = combat.flags?.[FLAG_NS]?.clockTick ?? 0;
        let requested = commitTick;
        if (requested == null) {
          requested = getClockTick(combat);
          let earliest = Infinity;
          for (const cm of combat.combatants) {
            for (const d of [cm.flags?.[FLAG_NS]?.declaredAction, cm.flags?.[FLAG_NS]?.declaredMovement]) {
              if (d && typeof d.scheduledTick === 'number') earliest = Math.min(earliest, d.scheduledTick);
            }
          }
          if (earliest !== Infinity) requested = Math.min(requested, earliest);
        }
        const effective = Math.max(stored, requested);
        try {
          await combat.update({
            [`flags.${FLAG_NS}.clockTick`]: effective,
            [`flags.${FLAG_NS}.realtimeRunning`]: false,
            [`flags.${FLAG_NS}.realtime`]: { running: false },
          });
        } catch (e) { console.warn('[TRIAL-REALTIME] flag clear failed:', e); }
        pauseAllDeclaredMoves(combat);
      }
    }
  }

  _scheduleNextFire() {
    if (this._realtimeTimeoutId) {
      clearTimeout(this._realtimeTimeoutId);
      this._realtimeTimeoutId = null;
    }
    if (!this._realtimeRunning) return;
    const combat = this.viewed;
    if (!combat?.started) { this._realtimeStop(); return; }

    // BOTH tracks queue fires. The old loop read only declaredAction, so a
    // movement-only queue never fired and walks hung until some action
    // happened to advance the clock — one of the live "roughness" defects.
    const clock = getClockTick(combat); // continuous while running
    // OVERDUE ENTRIES FIRE IMMEDIATELY (RCA round 2, 2026-08-22): this used
    // to filter `scheduledTick > clock` against the CONTINUOUS clock, so an
    // entry whose tick slipped past while no timeout was pending (a declare-
    // hook reschedule racing a fire is enough) never got a timeout at all.
    // The loop then idled while the continuous clock climbed on WALL TIME,
    // and the eventual stop committed that inflated value — vaulting the
    // world past everything queued (58953 -> 77093 live). Same rule as the
    // advance: overdue = most urgent, fire it NOW.
    const queued = [];
    for (const c of combat.combatants) {
      for (const declared of [c.flags?.[FLAG_NS]?.declaredAction, c.flags?.[FLAG_NS]?.declaredMovement]) {
        if (declared && typeof declared.scheduledTick === 'number') {
          queued.push(declared.scheduledTick);
        }
      }
    }
    if (queued.length === 0) {
      // Nothing queued — wait; the updateCombatant hook reschedules when a
      // declare appears. Glides in progress keep gliding on their own.
      return;
    }

    const nextTick = Math.min(...queued);
    const rate = realtimeTicksPerMs(combat);
    const realtimeMs = Math.max(0, (nextTick - clock) / rate);

    // No lerp loop here anymore: in-flight tokens glide via core planned
    // movements at celerity-matched speed (canvas token
    // _getAnimationMovementSpeed), started when the loop started or when
    // the movement was declared. The timeout is ONLY the fire scheduler.
    this._realtimeTimeoutId = setTimeout(async () => {
      this._realtimeTimeoutId = null;
      if (!this._realtimeRunning) return;
      let fired = 'pause';
      let errored = false;
      try {
        fired = await _onCelAdvance.call(this);
      } catch (e) {
        errored = true;
        console.error('[TRIAL-REALTIME] advance failed:', e);
        ui.notifications.error('Advance failed — clock held. The firing action may have been consumed; redeclare if missing. See console (F12).');
      }
      // A THROW must never move the clock (RCA 2026-08-22): committing
      // nextTick here left the unfired entry at `scheduledTick <= clock`,
      // where the old advance filter could never see it again — the
      // stranded-combat bug. Stop at the STORED tick; the entry stays
      // queued and (now overdue-eligible) fires on the next advance.
      if (errored) {
        this._realtimeStop(this.viewed?.flags?.[FLAG_NS]?.clockTick ?? 0);
        return;
      }
      // 'pause' = a decision point (any real action fire, or a PLAYER's
      // arrival/whiff) — stop so players declare without the clock eating
      // their thinking time. 'continue' = NPC arrivals and NPC whiffs — the
      // AI re-decides instantly, so the world keeps flowing. On continue,
      // RESTART the other glides first: the advance's jumpMovementsTo may
      // have stopped-and-re-planned any it slid forward (a re-planned move
      // sits in 'planned' until started; the stranded mid-path Boughbreaker
      // of 2026-08-09 was exactly this).
      if (fired === 'continue' && this._realtimeRunning) {
        runAllDeclaredMoves(combat);
        this._scheduleNextFire();
      }
      else this._realtimeStop(nextTick);
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
      // Real-time display strings (design-celerity-realtime.md) — world
      // time alongside raw ticks so hard time references are visible.
      lastActionWaitTime: f.lastActionWait != null ? formatTicksAsTime(f.lastActionWait) : null,
      timeUntil:          next === null ? null : formatTicksAsTime(Math.max(0, next - clockTick)),
      timeUntilRound:     formatTicksAsTime(ticksUntilRound),
      roundLenTime:       formatTicksAsTime(roundLen),
    };
    return turn;
  }

  /** @override - sort combatants by celerity scheduled tick + add clock readout. */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = context.combat ?? this.viewed;
    context.celerityClockTick = getClockTick(combat);
    // World time elapsed since combat start (design-celerity-realtime.md).
    context.celerityClockTime = formatTicksAsTime(context.celerityClockTick);
    // TRIAL-REALTIME: surface play/pause state so the template button can
    // swap between fa-play and fa-pause icons. Read from the combat flag
    // (shared across clients) so player trackers reflect the GM's loop
    // state without needing their own local _realtimeRunning instance.
    context.celerityRealtimeRunning = !!combat?.flags?.[FLAG_NS]?.realtimeRunning;
    // Play/pause is EVERYONE's (players route it to the GM over the socket —
    // anyone at the table can stop the world to think). Advance and Reset are
    // GM-only: both write the combat document directly, so a player clicking
    // them only ever produced a permission error.
    context.isGM = game.user.isGM;
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

  /**
   * @override — guard a core Foundry bug. Core CombatTracker._onRender does
   * `data = renderData.find(d => d._id === this.viewed?.id)` (which can be
   * `undefined`) and then tests `"turn" in data` → TypeError. It fires on our
   * frequent flag-only `combat.update()` calls, where renderData has no entry
   * for the viewed combat, and spammed the console every render. The crashing
   * branch runs AFTER super's real render and only scrolls the active
   * combatant into view, so swallowing exactly that TypeError is safe. Remove
   * this override if/when Foundry guards the `.find()` result.
   */
  async _onRender(context, options) {
    try {
      await super._onRender(context, options);
    } catch (e) {
      if (e instanceof TypeError && e.message.includes("search for 'turn' in undefined")) return;
      throw e;
    }
  }

  // TRIAL-REALTIME: stop the loop + remove the hook when the tracker closes
  // so we don't leak timers or stale listeners.
  async _onClose(options) {
    this._realtimeStop();
    return super._onClose?.(options);
  }
}
