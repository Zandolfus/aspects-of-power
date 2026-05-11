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
    const stage = canvas.app.stage;
    document.body.style.cursor = 'crosshair';

    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const cleanup = () => {
      stage.off('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
      try { ui.notifications.remove(notif); } catch { /* noop */ }
    };

    const onPointerDown = (event) => {
      // event.data.global gives canvas-coords pointer position.
      const global = event.data?.global ?? event.global;
      if (!global) return;
      // canvas.app.stage's children include the layers. We resolve the
      // top-most token whose bounds contain the click point.
      const local = canvas.tokens.toLocal(global);
      const hit = canvas.tokens.placeables.find(t => {
        if (!t.visible) return false;
        const b = t.bounds;
        return local.x >= b.x && local.x <= b.x + b.width
            && local.y >= b.y && local.y <= b.y + b.height;
      });
      if (!hit) return; // Click on empty canvas — ignore, keep listening
      const tokenDoc = hit.document;
      if (!validate(tokenDoc)) {
        ui.notifications.warn(`${tokenDoc.name} is not a valid target.`);
        return;
      }
      // Set as the player's target.
      game.user.updateTokenTargets([hit.id]);
      finish(tokenDoc);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        game.user.updateTokenTargets([]);
        finish(null);
      }
    };

    stage.on('pointerdown', onPointerDown);
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
