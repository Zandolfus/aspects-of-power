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
 * Prompt the player to click SEVERAL tokens on canvas. Resolves with an array
 * of TokenDocuments, or null if Escape was pressed.
 *
 * Sibling of selectTargetOnCanvas, which cannot be reused for this: it clears
 * every prior target and resolves on the FIRST pick, so a multi-target skill
 * routed through it would silently collapse to one target no matter what the
 * player clicked.
 *
 * Clicking a token toggles it, so a misclick is undone by clicking again.
 * Enter confirms; reaching `max` confirms automatically, since at that point
 * there is nothing left to decide.
 *
 * @param {object} [opts]
 * @param {number} [opts.max]      Most tokens selectable. Default 1.
 * @param {number} [opts.min]      Fewest before Enter will confirm. Default 1.
 * @param {string} [opts.message]  Override the notification text.
 * @param {Function} [opts.validate] (tokenDoc) → boolean.
 * @returns {Promise<TokenDocument[]|null>}
 */
export function selectTargetsOnCanvas(opts = {}) {
  const max = Math.max(1, opts.max ?? 1);
  const min = Math.max(1, Math.min(opts.min ?? 1, max));
  return new Promise((resolve) => {
    const validate = opts.validate ?? (() => true);
    const prevControl = ui.controls?.control?.name ?? 'tokens';
    const prevTool    = ui.controls?.tool?.name    ?? 'select';
    ui.controls?.activate?.({ control: 'tokens', tool: 'target' });

    for (const t of game.user.targets) {
      try { t.setTarget(false, { releaseOthers: false, groupSelection: false }); } catch { /* noop */ }
    }

    const picked = new Map();   // id → TokenDocument, insertion-ordered
    const base = opts.message ?? `Click up to ${max} targets, Enter to confirm (Esc to cancel)`;
    let notif = ui.notifications.info(base, { permanent: true });
    const reshow = () => {
      try { ui.notifications.remove(notif); } catch { /* noop */ }
      const names = [...picked.values()].map(d => d.name).join(', ');
      notif = ui.notifications.info(
        `${base}${picked.size ? ` — ${picked.size}/${max}: ${names}` : ''}`, { permanent: true });
    };

    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const onTarget = (user, token, targeted) => {
      if (user?.id !== game.user.id) return;
      const doc = token?.document ?? token;
      if (!targeted) { picked.delete(doc.id); reshow(); return; }
      if (!validate(doc)) {
        ui.notifications.warn(`${doc.name} is not a valid target.`);
        try { token.setTarget(false, { releaseOthers: false, groupSelection: false }); } catch { /* noop */ }
        return;
      }
      if (picked.size >= max && !picked.has(doc.id)) {
        ui.notifications.warn(`At most ${max} targets — deselect one first.`);
        try { token.setTarget(false, { releaseOthers: false, groupSelection: false }); } catch { /* noop */ }
        return;
      }
      picked.set(doc.id, doc);
      reshow();
      // Nothing left to choose once the cap is reached.
      if (picked.size >= max) finish([...picked.values()]);
    };

    const onKey = (event) => {
      if (event.key === 'Enter' && picked.size >= min) {
        event.stopPropagation(); event.preventDefault();
        finish([...picked.values()]);
      } else if (event.key === 'Escape') {
        event.stopPropagation(); event.preventDefault();
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
  // Summons are the same case: creature summons pick their own DESTINATION
  // inside _handleSummonTag, and equipment summons (summonItemName) conjure
  // into the caster's hand — neither wants a target token. Without this a
  // plain-clicked summon silently waits on a canvas click no one knows to
  // make (found live 2026-08-16: Summon Threadcutter "not spawning").
  // Attack+summon hybrids keep the prompt for their attack half.
  if (tags.includes('summon') && !tags.includes('attack')) return false;
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
