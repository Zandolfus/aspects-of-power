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
 */

/**
 * Prompt the player to click a token on canvas. Resolves with the
 * TokenDocument that was clicked, or null if Escape was pressed.
 *
 * Side effects:
 *  - Cursor changes to crosshair while active
 *  - On-screen notification with cancel hint
 *  - Sets game.user.targets to the resulting token (or clears if cancelled)
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

    const notif = ui.notifications.info(message, { permanent: true });
    // CSS class with !important rule wins over PIXI's per-token inline
    // cursor (which would otherwise revert to 'pointer' when hovering a
    // token). Style is in css/aspects-of-power.css under
    // `body.aop-targeting`.
    document.body.classList.add('aop-targeting');

    // Pre-clear any existing selection so the next click registers a
    // fresh `controlToken` event. Without this, if the user already had
    // a token selected, clicking the same one wouldn't re-fire.
    canvas.tokens.releaseAll();

    let resolved = false;
    let hoveredToken = null;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const cleanup = () => {
      Hooks.off('hoverToken', onHover);
      canvas.stage?.off?.('pointerdown', onPointerDown);
      canvas.stage?.off?.('rightdown', onRightDown);
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('aop-targeting');
      try { ui.notifications.remove(notif); } catch { /* noop */ }
    };

    // Listening to controlToken doesn't work for players targeting hostile
    // tokens (they don't own them, so the token never enters the controlled
    // state). hoverToken fires for any visible token regardless of
    // ownership, so we track the hovered token then capture the next
    // canvas-stage pointerdown (PIXI federated, fires on bubble from
    // whatever was clicked — token, ground, anything).
    const onHover = (token, hovered) => {
      if (hovered) hoveredToken = token;
      else if (hoveredToken === token) hoveredToken = null;
    };

    const onPointerDown = (event) => {
      if (!hoveredToken) return; // click on empty canvas — ignore
      const tokenDoc = hoveredToken.document;
      if (!validate(tokenDoc)) {
        ui.notifications.warn(`${tokenDoc.name} is not a valid target.`);
        return;
      }
      // Stop the click from also selecting/deselecting the token underneath.
      if (event.stopPropagation) event.stopPropagation();
      if (event.preventDefault) event.preventDefault();
      // Clear any prior targets and mark this one. Use v14 setTarget API.
      for (const t of game.user.targets) t.setTarget(false, { releaseOthers: false, groupSelection: false });
      hoveredToken.setTarget(true, { releaseOthers: false, groupSelection: false });
      finish(tokenDoc);
    };

    const onRightDown = () => {
      // Right-click cancels the prompt without targeting.
      finish(null);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        for (const t of game.user.targets) t.setTarget(false, { releaseOthers: false, groupSelection: false });
        finish(null);
      }
    };

    Hooks.on('hoverToken', onHover);
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
  // AOE has its own placement; skip the single-target prompt.
  if ((item.system.aoe?.enabled === true) || tags.includes('aoe') || (item.system.alterations ?? []).some(a => (a.id ?? a) === 'aoe')) return false;
  // Sustain toggles on self — no target.
  if (tags.includes('sustain')) return false;
  return true;
}
