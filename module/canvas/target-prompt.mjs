/**
 * Canvas-driven target selection.
 *
 * Replaces Foundry's pre-click-T-then-cast workflow with click-skill-
 * then-pick-target. Per design 2026-05-10: skill activation enters a
 * targeting mode; player clicks a token on canvas; that token becomes
 * game.user.targets.first() for the cast.
 *
 * AOE skills bypass this — their _placeAoeTemplate handles canvas
 * placement directly.
 *
 * Implementation: switch to Foundry's built-in `target` tool (the
 * bullseye in the token controls). While that tool is active,
 * Token._onClickLeft routes the click to setTarget — works for any
 * visible token regardless of ownership. Listen for the targetToken
 * hook to know when a target is picked, then restore the previous
 * tool.
 */

/**
 * Prompt the player to click a token on canvas. Resolves with the
 * TokenDocument that was clicked, or null if Escape was pressed.
 *
 * @param {object} [opts]
 * @param {string} [opts.message] Override the notification text
 * @param {Function} [opts.validate] (tokenDoc) → boolean. If false, click ignored.
 * @returns {Promise<TokenDocument|null>}
 */
export function selectTargetOnCanvas(opts = {}) {
  return new Promise((resolve) => {
    const message = opts.message ?? 'Click a target on the canvas (Esc to cancel)';
    const validate = opts.validate ?? (() => true);

    // Stash and switch tool. Foundry's `target` tool routes any token
    // click into setTarget — what we want. v14 deprecated activeControl /
    // activeTool in favor of control.name / tool.name; use the new API.
    const prevControl = ui.controls?.control?.name ?? 'tokens';
    const prevTool    = ui.controls?.tool?.name    ?? 'select';
    ui.controls?.activate?.({ control: 'tokens', tool: 'target' });

    // Clear any prior targets so the next pick is unambiguous.
    for (const t of game.user.targets) {
      try { t.setTarget(false, { releaseOthers: false, groupSelection: false }); } catch { /* noop */ }
    }

    const notif = ui.notifications.info(message, { permanent: true });

    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const onTarget = (user, token, targeted) => {
      if (!targeted) return;
      if (user?.id !== game.user.id) return;
      const tokenDoc = token?.document ?? token;
      if (!validate(tokenDoc)) {
        ui.notifications.warn(`${tokenDoc.name} is not a valid target.`);
        // Undo the bad target so the player can pick again.
        try { token.setTarget(false, { releaseOthers: false, groupSelection: false }); } catch { /* noop */ }
        return;
      }
      finish(tokenDoc);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        for (const t of game.user.targets) {
          try { t.setTarget(false, { releaseOthers: false, groupSelection: false }); } catch { /* noop */ }
        }
        finish(null);
      }
    };

    const cleanup = () => {
      Hooks.off('targetToken', onTarget);
      document.removeEventListener('keydown', onKey, true);
      try { ui.notifications.remove(notif); } catch { /* noop */ }
      // Restore the previous tool. Wrapped in try so a layer change
      // since prompt-open doesn't crash cleanup.
      try { ui.controls?.activate?.({ control: prevControl, tool: prevTool }); } catch { /* noop */ }
    };

    Hooks.on('targetToken', onTarget);
    document.addEventListener('keydown', onKey, true);
  });
}

/**
 * Prompt the player to click one of their mines on canvas. Resolves
 * with the picked RegionDocument or null if cancelled.
 *
 * Used by the generic Detonate skill: the explosion's AOE center is
 * the picked mine's position; the mine is deleted on cast resolution.
 *
 * If only one mine matches, resolves immediately. If none, resolves
 * null and posts a warn toast.
 *
 * @param {string|null} markerKey    Optional family identifier. When
 *                                   null, matches any mine of the caster.
 *                                   Reserved for future per-family
 *                                   filtering — Detonate today passes null.
 * @param {string} casterActorUuid   The casting actor's UUID
 * @param {object} [opts]
 * @param {string} [opts.message]    Override the notification text
 * @param {string} [opts.noneMessage] Override the no-matches text
 */
export function selectMarkerOnCanvas(markerKey, casterActorUuid, opts = {}) {
  const allMarkers = (canvas.scene?.regions?.contents ?? []).filter(r => {
    const f = r.flags?.['aspects-of-power'];
    if (!f?.mine && !f?.marker) return false;
    if (f?.casterActorUuid !== casterActorUuid) return false;
    if (markerKey != null && f?.markerKey !== markerKey) return false;
    return true;
  });
  if (allMarkers.length === 0) {
    ui.notifications.warn(opts.noneMessage ?? `No ${markerKey} markers to detonate.`);
    return Promise.resolve(null);
  }
  // Always prompt for a click, even when only one mine is on the field.
  // The auto-resolve shortcut was confusing — players want to confirm the
  // target explicitly, and the cast queueing silently looked like a no-op.

  return new Promise((resolve) => {
    const message = opts.message ?? `Click one of your ${markerKey} markers to detonate (Esc to cancel)`;
    const notif = ui.notifications.info(message, { permanent: true });
    document.body.classList.add('aop-targeting');

    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const tryHit = (pos) => {
      const hit = allMarkers.find(r =>
        r.testPoint({ x: pos.x, y: pos.y, elevation: 0 })
      );
      if (hit) finish(hit);
      return !!hit;
    };

    const onPointerDown = (event) => {
      // Click hit empty canvas (no token absorbed it). Hit-test against
      // marker shapes here.
      const pos = event.data?.getLocalPosition?.(canvas.stage) ?? canvas.mousePosition ?? { x: 0, y: 0 };
      if (tryHit(pos)) {
        if (event.stopPropagation) event.stopPropagation();
        if (event.preventDefault)  event.preventDefault();
      }
    };

    // Token-overlap case: when a marker is beneath an actor's token, PIXI
    // routes the click to the token's _onClickLeft and the event never
    // bubbles to the stage handler above. Monkey-patch the Token class
    // for the prompt's lifetime so clicks on tokens also hit-test the
    // marker at the click position. If a marker is found there, target
    // it; otherwise no-op (the token's normal select/target behavior is
    // suppressed during the prompt).
    const TokenCls = CONFIG.Token.objectClass;
    const origOnClickLeft = TokenCls.prototype._onClickLeft;
    TokenCls.prototype._onClickLeft = function (event) {
      const pos = event?.data?.getLocalPosition?.(canvas.stage)
               ?? canvas.mousePosition
               ?? { x: this.center?.x ?? 0, y: this.center?.y ?? 0 };
      if (tryHit(pos)) {
        if (event?.stopPropagation) event.stopPropagation();
        if (event?.preventDefault)  event.preventDefault();
        return;
      }
      // No marker under this click — swallow it (don't select/target).
    };

    const onRightDown = () => finish(null);

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        finish(null);
      }
    };

    const cleanup = () => {
      TokenCls.prototype._onClickLeft = origOnClickLeft;
      canvas.stage?.off?.('pointerdown', onPointerDown);
      canvas.stage?.off?.('rightdown', onRightDown);
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('aop-targeting');
      try { ui.notifications.remove(notif); } catch { /* noop */ }
    };

    canvas.stage.on('pointerdown', onPointerDown);
    canvas.stage.on('rightdown', onRightDown);
    document.addEventListener('keydown', onKey, true);
  });
}

/**
 * Decide whether a skill needs the target prompt. Returns false for:
 *  - AOE skills (handled by _placeAoeTemplate)
 *  - Passive skills (no roll, no target)
 *  - Sustain skills (toggle on self)
 *
 * All other skills prompt — attacks, buffs, heals, debuffs, utilities.
 * Player can click themselves on canvas for self-cast skills (buffs,
 * self-heals, etc.).
 */
export function skillNeedsTargetPrompt(item) {
  if (!item || item.type !== 'skill') return false;
  if (item.system.skillType === 'Passive') return false;
  const tags = item.system.tags ?? [];
  // Profession skills (craft, gather, refine, prep) operate on materials /
  // workstations, never on canvas tokens. Skip the prompt — EXCEPT repair,
  // which DOES need a target (the equipment / object being repaired).
  if (item.system.skillCategory === 'profession' && !tags.includes('repair')) return false;
  // AOE has its own placement; skip the single-target prompt.
  if ((item.system.aoe?.enabled === true) || tags.includes('aoe') || (item.system.alterations ?? []).some(a => (a.id ?? a) === 'aoe')) return false;
  // Sustain toggles on self — no target.
  if (tags.includes('sustain')) return false;
  // Teleport / Leap prompt for a destination (selectDestinationOnCanvas),
  // not a target token. Their declare-time flow runs alongside this gate.
  if (tags.includes('teleport') || tags.includes('leap')) return false;
  return true;
}

/**
 * For ranged skills, the target should be picked at FIRE time, not at
 * declare time — the situation may have changed during the celerity wait
 * (target moved out of LOS, died, new better target appeared). Melee
 * skills still pick at declare since the target needs to be in reach
 * NOW for the engagement halt math to work.
 *
 * Returns true if the prompt should be deferred to executeDeferred.
 */
export function skillTargetsAtFire(item) {
  if (!skillNeedsTargetPrompt(item)) return false;
  const tags = item.system.tags ?? [];
  if (tags.includes('ranged')) return true;
  // Magic projectiles / direct magic skills behave as ranged (cast and
  // resolve over distance). Channel them through fire-time targeting too.
  const rt = item.system.roll?.type ?? '';
  if (rt === 'phys_ranged' || rt === 'magic_projectile') return true;
  return false;
}
