/**
 * Movement-mode token HUD toggle (movement UX overhaul, RULED 2026-07-14).
 *
 * One control icon on the token HUD showing the actor's persisted movement
 * mode (walk = boot, sprint = wind). Click toggles walk ⇄ sprint, persisted
 * on `flags.aspectsofpower.movementMode` — read by getActiveMovementMode()
 * everywhere a move is priced or declared. Shift stays a momentary sprint
 * override on top.
 *
 * The always-visible mode chip on owned tokens lives in movement-overlay.mjs;
 * this file is just the HUD control.
 */

import { getActiveMovementMode } from '../systems/celerity.mjs';
import { refreshOverlay } from './movement-overlay.mjs';

const MODE_ICONS = { walk: 'fa-person-walking', sprint: 'fa-person-running' };

export function registerMovementHud() {
  Hooks.on('renderTokenHUD', (hud, html) => {
    const actor = hud.object?.document?.actor;
    if (!actor?.isOwner) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    const col = root?.querySelector('.col.left') ?? root?.querySelector('.col.right');
    if (!col) return;

    const current = actor.flags?.aspectsofpower?.movementMode ?? 'walk';
    const div = document.createElement('div');
    div.className = 'control-icon' + (current === 'sprint' ? ' active' : '');
    div.dataset.tooltip = `Movement: ${current} (click to toggle)`;
    div.innerHTML = `<i class="fas ${MODE_ICONS[current] ?? MODE_ICONS.walk}"></i>`;
    div.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const next = (actor.flags?.aspectsofpower?.movementMode ?? 'walk') === 'sprint' ? 'walk' : 'sprint';
      await actor.update({ 'flags.aspectsofpower.movementMode': next });
      ui.notifications.info(`${actor.name}: movement mode → ${next}.`);
      refreshOverlay();
      hud.render();
    });
    col.appendChild(div);
  });

  // Chip refresh when the persisted mode changes on any owned actor.
  Hooks.on('updateActor', (actor, changes) => {
    if (changes?.flags?.aspectsofpower?.movementMode !== undefined) refreshOverlay();
  });
}
