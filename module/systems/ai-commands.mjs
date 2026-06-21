/**
 * Summoner COMMAND registry — modular, extensible commands a master issues to
 * owned AI units via the token HUD (module/canvas/summon-hud.mjs). Mirrors the
 * AIProfiles pattern: register a command once and the HUD renders a button for
 * it automatically; future AI subtypes / content can add their own commands
 * with `AICommands.register(...)` and need touch nothing else.
 *
 * Command shape:
 *   {
 *     label:  string,                       // HUD tooltip
 *     icon:   string,                       // FontAwesome class, e.g. 'fa-hand'
 *     order?: number,                       // HUD sort (asc); default 100
 *     active?: (actor) => boolean,          // highlight the button when "on"
 *     execute: async (targets, ctx) => {}   // targets = controlled owned AI token DOCS;
 *                                           // ctx = { origin: hud.object, hud }
 *   }
 *
 * Commands set per-unit flags on `flags.aspectsofpower.*` that the profile-
 * agnostic helpers in ai.mjs read (aiOrderTargets / aiHoldsPosition) + the
 * dispatch gate (aiCommand 'manual'). So a command works for EVERY profile.
 */

import { aiCommandMove } from './ai.mjs';

const NS = 'aspectsofpower';

class AICommandRegistry {
  static #cmds = new Map();
  static register(key, def) { if (key && def?.execute) this.#cmds.set(key, { key, order: 100, ...def }); }
  static get(key) { return this.#cmds.get(key) ?? null; }
  static all() { return [...this.#cmds.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
}
export const AICommands = AICommandRegistry;

/* ── Built-in commands ────────────────────────────────────────────────────── */

AICommands.register('hold', {
  label: 'Hold position', icon: 'fa-hand', order: 10,
  active: (a) => !!a.flags?.[NS]?.aiHold,
  execute: async (targets) => {
    const on = !(targets[0]?.actor?.flags?.[NS]?.aiHold);
    for (const d of targets) await d.actor.update({ [`flags.${NS}.aiHold`]: on });
    ui.notifications.info(`${targets.length} unit(s) ${on ? 'holding position' : 'free to move'}.`);
  },
});

AICommands.register('manual', {
  label: 'Manual control (AI off)', icon: 'fa-gamepad', order: 20,
  active: (a) => a.flags?.[NS]?.aiCommand === 'manual',
  execute: async (targets) => {
    const manual = targets[0]?.actor?.flags?.[NS]?.aiCommand !== 'manual';
    for (const d of targets) await d.actor.update({ [`flags.${NS}.aiCommand`]: manual ? 'manual' : 'auto' });
    ui.notifications.info(`${targets.length} unit(s) ${manual ? 'under manual control' : 'back on AI'}.`);
  },
});

AICommands.register('focus', {
  label: 'Focus my target', icon: 'fa-crosshairs', order: 30,
  active: (a) => !!a.flags?.[NS]?.aiFocusTarget,
  execute: async (targets) => {
    const tgt = [...(game.user.targets ?? [])][0];
    const val = tgt ? tgt.id : '';
    for (const d of targets) await d.actor.update({ [`flags.${NS}.aiFocusTarget`]: val });
    ui.notifications.info(tgt ? `${targets.length} unit(s) focusing ${tgt.name}.`
                              : `${targets.length} unit(s) focus cleared.`);
  },
});

AICommands.register('move', {
  label: 'Move here', icon: 'fa-location-arrow', order: 40,
  active: () => false,
  execute: async (targets, ctx) => {
    const { selectDestinationOnCanvas } = await import('../canvas/destination-prompt.mjs');
    const dest = await selectDestinationOnCanvas(ctx.origin, {
      maxDistanceFt: 9999, requireSight: false, snapToGrid: true,
      label: 'Move', message: 'Click where your selected units should move (Esc cancels).',
    });
    if (!dest) return;
    let n = 0;
    for (const d of targets) { if (await aiCommandMove(d.actor, { x: dest.x, y: dest.y })) n++; }
    ui.notifications.info(`${n} unit(s) moving.`);
  },
});
