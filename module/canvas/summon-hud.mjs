/**
 * Summoner command surface — token-HUD buttons for AI units the user owns
 * (summons, and any AI NPC for the GM). Buttons are generated from the
 * AICommands registry (module/systems/ai-commands.mjs), so adding a command
 * there makes a button appear here with no change to this file — and every
 * command works for ANY AI subtype, since the engine reads profile-agnostic
 * flags (ai.mjs aiOrderTargets / aiHoldsPosition + the manual dispatch gate).
 *
 * Each command applies to ALL currently controlled tokens the user owns that
 * are AI units (like the core combat toggle), so a master can select a horde
 * and command them at once. See [[design-ai-behavior-tags]].
 */

import { AICommands } from '../systems/ai-commands.mjs';

const NS = 'aspectsofpower';
const isAiUnit = (actor) => !!actor?.flags?.[NS]?.aiProfile;

/** Controlled tokens the current user owns that are AI units (command targets). */
function _commandTargets() {
  return (canvas.tokens?.controlled ?? [])
    .map(t => t.document)
    .filter(d => d?.actor?.isOwner && isAiUnit(d.actor));
}

export function registerSummonHud() {
  Hooks.on('renderTokenHUD', (hud, html) => {
    const actor = hud.object?.document?.actor;
    if (!actor || !actor.isOwner || !isAiUnit(actor)) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    const col = root?.querySelector('.col.right') ?? root?.querySelector('.col.left');
    if (!col) return;

    for (const cmd of AICommands.all()) {
      const div = document.createElement('div');
      div.className = 'control-icon' + (cmd.active?.(actor) ? ' active' : '');
      div.dataset.tooltip = cmd.label;
      div.innerHTML = `<i class="fas ${cmd.icon}"></i>`;
      div.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const targets = _commandTargets();
        if (!targets.length) return;
        try { await cmd.execute(targets, { origin: hud.object, hud }); }
        catch (e) { console.error(`[summon-hud] command ${cmd.key} failed`, e); }
        hud.render();
      });
      col.appendChild(div);
    }
  });
}
