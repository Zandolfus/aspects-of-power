/**
 * Downtime declare/resolve barrier (design-calendar-celestial.md, RULED
 * 2026-07-26).
 *
 * Out of combat, players DECLARE actions that take time. Nothing resolves
 * until every participant has declared, or the GM forces it. The clock then
 * advances to the SHORTEST outstanding action — whoever finishes first
 * resolves and immediately declares again, while longer work keeps running.
 *
 * That is the same discrete-event shape the celerity tracker uses in combat:
 * advance to the next completion, not to the last. It means a six-hour craft
 * never blocks a five-minute lockpick — the lockpicker simply acts many times
 * while the smith works, and the party stays on one canonical date.
 *
 * Declarations live on the actor (`flags.aspectsofpower.downtime`), so a
 * player writes their own without any socket; only the CLOCK is GM-gated.
 *
 * Console usage:
 *   const D = game.aspectsofpower.downtime;
 *   D.declare(actor, 'pickLock');
 *   D.roster();                    // who is busy until when
 *   D.advance();                   // to the next completion (GM)
 *   D.advance({ force: true });    // even if someone hasn't declared
 */

import { ActivityHelpers } from './activities.mjs';
import { nextCompletionDelta } from '../helpers/formulas.mjs';

// Engine namespace per the flag-namespace law: `flags.aspectsofpower` (no
// hyphen) for engine/combat state. NOTE it is NOT a registered package id, so
// setFlag/unsetFlag REJECT it ("Flag scope is not valid or not currently
// active") — the whole codebase writes this namespace with update() and dot
// paths, and `-=` to delete. Do not reach for setFlag here.
const FLAG_SCOPE = 'aspectsofpower';
const FLAG_KEY = 'downtime';
const FLAG_PATH = `flags.${FLAG_SCOPE}.${FLAG_KEY}`;
const FLAG_UNSET = `flags.${FLAG_SCOPE}.-=${FLAG_KEY}`;

export { nextCompletionDelta };

/** Actors expected to declare: every active non-GM user's assigned character. */
export function participants() {
  const actors = new Map();
  for (const user of game.users) {
    if (user.isGM || !user.active || !user.character) continue;
    actors.set(user.character.id, user.character);
  }
  // Anyone already mid-action counts too, even an NPC the GM declared for.
  for (const actor of game.actors) {
    if (actor.flags?.[FLAG_SCOPE]?.[FLAG_KEY]) actors.set(actor.id, actor);
  }
  return [...actors.values()];
}

/** Live declarations with their remaining time. */
export function roster() {
  const now = game.time.worldTime;
  return participants().map(actor => {
    const d = actor.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? null;
    return {
      actor,
      declaration: d,
      remaining: d ? Math.max(0, d.endTime - now) : null,
      display: d ? ActivityHelpers.formatSeconds(Math.max(0, d.endTime - now)) : null,
    };
  });
}

/** True when nobody is still being waited on. */
export function allDeclared() {
  const r = roster();
  return r.length > 0 && r.every(e => e.declaration);
}

/**
 * Declare a timed action. Computes the duration from the activity framework
 * (so a fast character genuinely finishes sooner) and stores the window; it
 * does NOT move the clock — that is the barrier's job.
 */
export async function declare(actor, activityKey, opts = {}) {
  const timing = ActivityHelpers.computeActivityTime(actor, activityKey, opts);
  if (!timing) {
    ui.notifications?.warn(`Unknown activity: ${activityKey}`);
    return null;
  }
  const now = game.time.worldTime;
  const declaration = {
    activityKey,
    label: timing.label,
    quality: timing.qualityScaled ? timing.qualityKey : null,
    seconds: Math.round(timing.seconds),
    startTime: now,
    endTime: now + Math.round(timing.seconds),
    display: timing.display,
    // WHO DECLARED THIS, so completion can fire the skill rather than only the
    // activity. Without it a crafting skill spends its hours and produces
    // nothing, because `performActivity` only posts a card and applies the
    // activity's `restore` block — which is the entire payload for meditation
    // and none of it for a craft.
    sourceSkillUuid: opts.sourceSkillUuid ?? null,
    // The inline activity shape, if this was not a registry key — resolution
    // happens later and has to be able to price the same block again.
    inline: opts.inline ?? null,
  };
  await actor.update({ [FLAG_PATH]: declaration });
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name} begins: <strong>${timing.label}</strong> (${timing.display}).</em></p>`,
  });
  return declaration;
}

/** Abandon an outstanding declaration. Partial progress is not credited. */
export async function cancel(actor) {
  if (!actor.flags?.[FLAG_SCOPE]?.[FLAG_KEY]) return false;
  await actor.update({ [FLAG_UNSET]: null });
  return true;
}

/**
 * Advance the clock to the next completion and resolve whatever finishes.
 *
 * @param {object} [options]
 * @param {boolean} [options.force]   Advance even if someone hasn't declared.
 * @param {number}  [options.seconds] Advance by an explicit amount instead.
 * @returns {{advanced:number, resolved:string[], waitingOn:string[]}|null}
 */
export async function advance({ force = false, seconds = null } = {}) {
  const entries = roster();
  const waiting = entries.filter(e => !e.declaration).map(e => e.actor.name);
  if (waiting.length && !force && seconds == null) {
    ui.notifications?.warn(`Still waiting on: ${waiting.join(', ')}`);
    return { advanced: 0, resolved: [], waitingOn: waiting };
  }

  const now = game.time.worldTime;
  const declared = entries.filter(e => e.declaration).map(e => e.declaration);
  const delta = seconds != null ? Math.round(seconds) : nextCompletionDelta(declared, now);
  if (delta == null) {
    ui.notifications?.warn('No declared actions to advance to.');
    return { advanced: 0, resolved: [], waitingOn: waiting };
  }

  if (delta > 0) await ActivityHelpers.advanceWorldTime(delta);
  const then = now + delta;

  // Resolve everything due at the new time. Ties all resolve together, which
  // is correct — they genuinely finished at the same moment.
  const resolved = [];
  for (const entry of entries) {
    const d = entry.declaration;
    if (!d || d.endTime > then) continue;
    await ActivityHelpers.performActivity(entry.actor, d.activityKey, {
      quality: d.quality ?? undefined,
      advanceTime: false,          // the barrier already spent the time
      note: `<em>Declared downtime, completed on the clock.</em>`,
      inline: d.inline ?? undefined,
    });

    // ── THE SKILL'S OWN PAYLOAD ──────────────────────────────────────────
    // The activity above only posts a card and applies its `restore` block.
    // For meditation that IS the payload; for a craft it is none of it. Fire
    // the declaring skill so its remaining tags actually run.
    //
    // ⚠⚠ `fromActivityCompletion` IS LOAD-BEARING, NOT DECORATION. The skill
    // carries the `activity` tag — that is how it got here — so rolling it
    // normally would declare the same downtime again, forever. The flag is
    // what tells roll() to skip the declaration branch and resolve the rest.
    //
    // ⚠ Cleared BEFORE the skill fires, so a skill that legitimately declares
    // follow-on work can do so without this loop deleting it a line later.
    await entry.actor.update({ [FLAG_UNSET]: null });

    if (d.sourceSkillUuid) {
      try {
        const skill = await fromUuid(d.sourceSkillUuid);
        if (skill) await skill.roll({ executeDeferred: true, fromActivityCompletion: true });
      } catch (err) {
        console.error('Aspects of Power | downtime: source skill failed to resolve', err);
      }
    }
    resolved.push(entry.actor.name);
  }
  return { advanced: delta, resolved, waitingOn: waiting };
}

/** Roster as chat, so the table can see who is busy and for how long. */
export async function postRoster() {
  const entries = roster();
  const { celestialState } = await import('./calendar.mjs');
  const sky = celestialState();
  const rows = entries.map(e => `<tr><td>${e.actor.name}</td>`
    + `<td>${e.declaration ? e.declaration.label : '<em>not declared</em>'}</td>`
    + `<td style="text-align:right">${e.display ?? '—'}</td></tr>`).join('');
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients('GM'),
    content: `<div class="craft-result"><h3>Downtime — ${sky.date}</h3>`
      + `<p class="hint">${sky.moon.name}, ${Math.round(sky.moon.illumination * 100)}% lit</p><hr>`
      + (rows ? `<table style="width:100%">${rows}</table>` : '<p><em>Nobody is doing anything.</em></p>')
      + `<p class="hint">${allDeclared() ? 'All declared — ready to advance.' : 'Waiting on declarations.'}</p>`
      + `</div>`,
  });
}

export const DowntimeHelpers = {
  declare, cancel, advance, roster, participants, allDeclared, postRoster, nextCompletionDelta,
};
