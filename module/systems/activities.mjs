/**
 * Non-combat activity framework (design-celerity-realtime.md step 4).
 *
 * Combat already prices every action in celerity ticks. This does the same
 * for everything else: forcing a door, picking a lock, searching a room,
 * forging a sword. Same grammar, same constants, same clock —
 *
 *   time = cost x qualityMult / Celerity(named stat)
 *
 * so a leveled character is visibly superhuman out of combat too, and
 * downtime finally has a number attached to it.
 *
 * Console usage:
 *   const A = game.aspectsofpower.activities;
 *   A.computeActivityTime(actor, 'pickLock');           // no side effects
 *   A.performActivity(actor, 'searchRoom');             // card + clock
 *   A.activityDialog(actor);                            // pick one
 */

import { activityTicks, auraRadiusFor } from '../helpers/formulas.mjs';
import { ticksToMs, formatTicksAsTime } from './celerity.mjs';

/**
 * Seconds -> ticks, the inverse of ticksToMs. Clock-bound components are
 * authored in world seconds because that is how a GM thinks about them; the
 * engine still reasons in ticks so everything composes.
 */
function secondsToTicks(seconds) {
  const sc = CONFIG.ASPECTSOFPOWER.celerity;
  return (Number(seconds) || 0) * 1000 / (sc.TICK_MS ?? 0.072);
}

/** World seconds as human time, using the same bands as tick durations. */
export function formatSeconds(seconds) {
  return formatTicksAsTime(secondsToTicks(seconds));
}

/**
 * Which ability drives this activity. Order: explicit override, then the
 * activity's named stat, then the performing skill's own roll ability
 * (crafting rides its profession's stat), then dexterity as the generic
 * "hands and reflexes" fallback.
 */
function resolveStatKey(activity, { statKey = null, skill = null } = {}) {
  if (statKey) return statKey;
  if (activity?.stat) return activity.stat;
  const skillAbility = skill?.system?.roll?.abilities;
  if (skillAbility) return skillAbility;
  return 'dexterity';
}

/**
 * Price an activity for an actor WITHOUT touching any state — the number a
 * dialog previews and a chat card reports.
 *
 * @param {Actor}  actor
 * @param {string} key                Registry key in CONFIG.ASPECTSOFPOWER.activities.
 * @param {object} [opts]
 * @param {string} [opts.quality]     Key in CONFIG.ASPECTSOFPOWER.activityQuality.
 * @param {number} [opts.costOverride] Use this cost instead of the registry's.
 * @param {number} [opts.multiplier]  Extra multiplier (e.g. group division).
 * @param {string} [opts.statKey]     Force the driving ability.
 * @param {Item}   [opts.skill]       Skill being performed (supplies its ability).
 * @returns {object|null}             null when the key is unknown.
 */
export function computeActivityTime(actor, key, opts = {}) {
  const registry = CONFIG.ASPECTSOFPOWER.activities ?? {};
  const activity = registry[key];
  if (!activity || !actor) return null;

  // Quality is about the quality of an OUTPUT. A sword can be forged roughly
  // or masterfully; a lock is picked or it isn't. Activities that don't opt in
  // ignore quality entirely — otherwise "masterwork" made drawing a weapon
  // take two hours, because the fine/masterwork clock floor applied to it.
  const scaled = activity.qualityScaled === true;
  const qualityKey = scaled ? (opts.quality ?? 'standard') : null;
  const quality = scaled
    ? ((CONFIG.ASPECTSOFPOWER.activityQuality ?? {})[qualityKey] ?? { mult: 1, clockFloorSeconds: 0 })
    : { mult: 1, clockFloorSeconds: 0 };

  const statKey = resolveStatKey(activity, opts);
  const mod = Math.max(1, actor.system?.abilities?.[statKey]?.mod ?? 0);
  const cost = opts.costOverride ?? activity.cost ?? 0;
  const qualityMult = (quality.mult ?? 1) * (opts.multiplier ?? 1);

  const ticks = activityTicks(cost, mod, {
    qualityMult,
    taskClass: activity.class ?? 'celerity',
    clockTicks: secondsToTicks(activity.clockSeconds ?? 0),
    clockFloorTicks: secondsToTicks(quality.clockFloorSeconds ?? 0),
  });

  const ms = ticksToMs(ticks);
  return {
    key,
    label: activity.label ?? key,
    taskClass: activity.class ?? 'celerity',
    statKey: (activity.class === 'clock') ? null : statKey,
    mod,
    cost,
    qualityKey,
    qualityScaled: scaled,
    qualityMult,
    ticks,
    ms,
    seconds: ms / 1000,
    display: formatTicksAsTime(ticks),
  };
}

/**
 * Advance the world clock. GM-only at the server level, so non-GM clients
 * route to the active GM the same way combatant writes do.
 */
export async function advanceWorldTime(seconds) {
  const whole = Math.round(seconds);
  if (whole <= 0) return;
  if (game.user.isGM) return game.time.advance(whole);
  game.socket.emit('system.aspects-of-power', { action: 'gmAdvanceTime', seconds: whole });
}

/**
 * Meditation aura bonus reaching `actor` right now (Mana Attraction).
 *
 * RULED 2026-08-03: a REAL RADIUS on the canvas. Resolved at activity time
 * rather than ticked — meditation is an hour of world time, not a combat loop,
 * so there is no tick to hang an aura off. Whoever is standing in the field
 * when the party sits down gets the benefit.
 *
 * ⚠ Takes the STRONGEST field, not the sum. "Mana attraction" is a gradient;
 * standing in two of them does not double the pull, and summing would make
 * stacking aura-carriers the obvious play. Change here if that is ever wanted.
 *
 * ⚠ Requires a placed token. Downtime often happens with nobody on the canvas,
 * in which case this returns 0 and the meditator gets only their own rate —
 * reported on the card so the absence is visible rather than silent.
 *
 * @returns {{bonus: number, sources: string[]}}
 */
export function meditationAuraBonusFor(actor) {
  const none = { bonus: 0, sources: [] };
  const selfTok = actor?.getActiveTokens?.()?.[0];
  const selfDoc = selfTok?.document;
  if (!selfDoc || !canvas?.grid) return none;
  const gridSize = canvas.grid.size;
  const pxPerFt = gridSize / canvas.grid.distance;

  // ⚠ CENTRE FROM THE DOCUMENT, NOT THE PLACEABLE. `token.object.center` lags
  // during move animation, so a token read right after being repositioned
  // reports where it USED to be — which made a token 60 ft away test as
  // in-range. The document's x/y are authoritative the moment the update
  // resolves, and this also works for tokens that are not rendered at all.
  const centreOf = (doc) => ({
    x: doc.x + (doc.width * gridSize) / 2,
    y: doc.y + (doc.height * gridSize) / 2,
  });
  const me = centreOf(selfDoc);

  let best = 0;
  let from = '';
  for (const tokenDoc of (selfDoc.parent ?? canvas.scene)?.tokens ?? []) {
    const src = tokenDoc.actor;
    if (!src?.items) continue;
    for (const sk of src.items) {
      if (sk.type !== 'skill') continue;
      const c = sk.system?.tagConfig ?? {};
      const bonus = Number(c.meditationAuraBonus) || 0;
      // Perception stretches the authored radius — the SOURCE's perception,
      // not the meditator's. Whose field it is decides how far it reaches.
      const radiusFt = auraRadiusFor(c.auraRadius,
        src.system?.abilities?.perception?.mod ?? 0);
      if (bonus <= 0 || radiusFt <= 0) continue;
      const them = centreOf(tokenDoc);
      const dist = Math.hypot(me.x - them.x, me.y - them.y);
      // ⚠ Guard NaN explicitly. `NaN > radiusPx` is FALSE, so a malformed
      // position would PASS the range check rather than fail it — the aura
      // would silently apply at any distance.
      if (!Number.isFinite(dist) || dist > radiusFt * pxPerFt) continue;
      // The owner stands in their own field (distance 0).
      if (bonus > best) { best = bonus; from = `${sk.name} (${src.name})`; }
    }
  }
  return best > 0 ? { bonus: best, sources: [from] } : none;
}

/**
 * Perform an activity: price it, post the card, spend the world time.
 *
 * @param {Actor}  actor
 * @param {string} key
 * @param {object} [opts]  As computeActivityTime, plus:
 * @param {boolean} [opts.advanceTime]  Spend world time (default true).
 * @param {string}  [opts.note]         Extra line on the card.
 * @returns {object|null} The computed timing, or null on an unknown key.
 */
export async function performActivity(actor, key, opts = {}) {
  const result = computeActivityTime(actor, key, opts);
  if (!result) {
    ui.notifications?.warn(`Unknown activity: ${key}`);
    return null;
  }

  const qualityNote = result.qualityScaled && result.qualityKey !== 'standard'
    ? ` (${(CONFIG.ASPECTSOFPOWER.activityQuality ?? {})[result.qualityKey]?.label ?? result.qualityKey})`
    : '';
  const basis = result.taskClass === 'clock'
    ? 'Clock-bound — the same for everyone.'
    : `${result.cost} points at ${Math.round(result.mod)} ${result.statKey}`
      + (result.qualityMult !== 1 ? ` x${result.qualityMult} quality` : '')
      + (result.taskClass === 'hybrid' ? ', or the clock, whichever is longer.' : '.');

  // ── Resource restoration (meditation and friends) ────────────────────────
  // An activity may declare `restore: { resource, fraction | fractionPath }`.
  // `fractionPath` reads from the ACTOR so a passive can raise it via an
  // active effect — John meditates at 15% where everyone else gets 10%.
  const restoreCfg = (CONFIG.ASPECTSOFPOWER.activities ?? {})[key]?.restore;
  let restored = null;

  // ── STACK-POOL restore (ki monk, ruled 2026-08-05) ───────────────────────
  // Ki is the stacks subsystem, not an actor resource pool, so it has no
  // `.max`/`.value` to take a fraction of — its ceiling comes from the
  // producer's `stackCapStat`. Meditation refills it because ki is restored by
  // TIME, the one currency that cannot be farmed in place; that is what stops
  // a monk banking ki on a training dummy between fights.
  //
  // ⚠ Gated on the actor ACTUALLY HAVING the pool declared: resolveStackCap
  // returns 0 for anyone with no producer, and we skip rather than creating an
  // empty stack effect on every meditating mage in the world.
  if (restoreCfg?.stackPool) {
    const { resolveStackCap, getStackCount, addStacks } = await import('./stacks.mjs');
    const cap = resolveStackCap(actor, restoreCfg.stackPool);
    if (cap > 0) {
      const before = getStackCount(actor, restoreCfg.stackPool);
      // 0 / unset = fill to the ceiling. An hour of meditation is a full bar.
      const want = Math.max(0, Math.round(Number(restoreCfg.stackAmount) || 0)) || cap;
      if (before < cap) {
        const after = await addStacks(actor, restoreCfg.stackPool, want, {
          cap,
          sourceSkill: result.label,
          label: `Stacks: ${restoreCfg.stackPool}`,
        });
          restoredStacks = { stackPool: restoreCfg.stackPool, gain: after - before, from: before, max: cap };
      } else {
          restoredStacks = { stackPool: restoreCfg.stackPool, gain: 0, from: before, max: cap };
      }
    }
  }

  if (restoreCfg?.resource) {
    const pool = actor.system[restoreCfg.resource];
    const own = restoreCfg.fractionPath
      ? Number(foundry.utils.getProperty(actor.system, restoreCfg.fractionPath)) || 0
      : Number(restoreCfg.fraction) || 0;
    const aura = meditationAuraBonusFor(actor);
    const frac = own + aura.bonus;
    const max = Math.round(pool?.max ?? 0);
    const cur = Math.round(pool?.value ?? 0);
    if (max > 0 && frac > 0) {
      const gain = Math.min(Math.round(max * frac), max - cur);
      if (gain > 0) await actor.update({ [`system.${restoreCfg.resource}.value`]: cur + gain });
      restored = { resource: restoreCfg.resource, gain: Math.max(0, gain), frac, from: cur, max,
                   own, aura };
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong>: ${result.label}${qualityNote}</p>`
      + `<p>Time taken: <strong>${result.display}</strong></p>`
      + `<p><em>${basis}</em></p>`
      + (restored?.stackPool
          ? `<p>Recovers <strong>${restored.gain}</strong> ${restored.stackPool}`
            + ` — ${restored.from + restored.gain} / ${restored.max}.</p>`
          : '')
      + (restored?.resource
          ? `<p>Recovers <strong>${restored.gain}</strong> ${restored.resource}`
            + ` (${Math.round(restored.frac * 100)}% of ${restored.max})`
            + ` — ${restored.from + restored.gain} / ${restored.max}.</p>`
            + (restored.aura?.bonus > 0
                ? `<p><em>+${Math.round(restored.aura.bonus * 100)}% from `
                  + `${restored.aura.sources.join(', ')}.</em></p>` : '')
          : '')
      + (opts.note ? `<p>${opts.note}</p>` : ''),
  });

  if (opts.advanceTime !== false) await advanceWorldTime(result.seconds);
  return { ...result, restored, restoredStacks };
}

/**
 * Pick an activity for an actor, previewing every registry entry's time for
 * THIS actor before committing. Quality only matters to the entries that
 * scale with it, so it is offered as a second row rather than a gate.
 */
export async function activityDialog(actor) {
  if (!actor) {
    ui.notifications?.warn('Select a token or pass an actor.');
    return null;
  }
  const registry = CONFIG.ASPECTSOFPOWER.activities ?? {};
  const qualities = CONFIG.ASPECTSOFPOWER.activityQuality ?? {};

  const keys = Object.keys(registry);
  const rowsFor = (qualityKey) => keys.map((key, i) => {
    const t = computeActivityTime(actor, key, { quality: qualityKey });
    if (!t) return '';
    const driver = t.statKey ? `${t.statKey} ${Math.round(t.mod)}` : 'clock-bound';
    // Say which rows answer to the quality selector, so a row that doesn't
    // move when quality changes reads as intentional rather than broken.
    const qualityMark = t.qualityScaled ? ' &middot; quality' : '';
    return `<tr><td><label><input type="radio" name="activity" value="${key}"${i === 0 ? ' checked' : ''}> ${t.label}</label></td>`
      + `<td style="text-align:right"><strong>${t.display}</strong></td>`
      + `<td style="opacity:0.7;font-size:11px">${driver}${qualityMark}</td></tr>`;
  }).join('');

  const qualityOpts = Object.entries(qualities)
    .map(([k, q]) => `<option value="${k}"${k === 'standard' ? ' selected' : ''}>${q.label} (x${q.mult})</option>`)
    .join('');

  // Downtime context: who is already busy, and whether the clock can move.
  // Shown here rather than in a separate app so the one door players already
  // know also answers "what is everyone else doing".
  const { DowntimeHelpers } = await import('./downtime.mjs');
  const mine = actor.flags?.aspectsofpower?.downtime ?? null;
  const busyRows = DowntimeHelpers.roster()
    .filter(e => e.declaration)
    .map(e => `<li>${e.actor.name} — ${e.declaration.label} (${e.display} left)</li>`)
    .join('');
  const downtimeBlock = (mine || busyRows)
    ? `<hr><p style="font-size:11px;opacity:0.8">In progress:</p><ul style="font-size:11px;margin:0">${
        busyRows || '<li><em>nobody</em></li>'}</ul>`
      + (DowntimeHelpers.allDeclared()
        ? `<p style="font-size:11px;color:#4caf50">All declared — the clock can advance.</p>`
        : `<p style="font-size:11px;opacity:0.7">Waiting on declarations.</p>`)
    : '';

  const content = `<form><p>Times shown for <strong>${actor.name}</strong>.</p>`
    + `<table class="activity-rows" style="width:100%">${rowsFor('standard')}</table>`
    + `<p><label>Quality: <select class="activity-quality" name="quality">${qualityOpts}</select></label>`
    + ` <span style="font-size:11px;opacity:0.7">(applies to quality-scaled work only)</span></p>`
    + `<p style="font-size:11px;opacity:0.7"><strong>Perform</strong> resolves it now and spends the time.`
    + ` <strong>Declare</strong> starts it and waits for the table — the clock then advances to whoever`
    + ` finishes first.</p>${downtimeBlock}</form>`;

  return foundry.applications.api.DialogV2.wait({
    window: { title: 'Perform Activity' },
    content,
    // Quality changes every row's answer, so re-price the whole table live
    // rather than making the player commit blind and read it on the card.
    render: (event, dialog) => {
      const root = dialog?.element ?? dialog;
      const form = root?.querySelector('form');
      const table = form?.querySelector('.activity-rows');
      const qualitySel = form?.querySelector('.activity-quality');
      if (!table || !qualitySel) return;
      qualitySel.addEventListener('change', () => {
        const picked = form.querySelector('input[name="activity"]:checked')?.value;
        table.innerHTML = rowsFor(qualitySel.value);
        if (picked) {
          const again = table.querySelector(`input[name="activity"][value="${picked}"]`);
          if (again) again.checked = true;
        }
      });
    },
    buttons: [
      {
        action: 'perform', label: 'Perform', icon: 'fas fa-hourglass-half', default: true,
        callback: async (event, button, dialog) => {
          const form = dialog?.element?.querySelector('form') ?? button.form;
          const key = form?.querySelector('input[name="activity"]:checked')?.value;
          if (!key) return null;
          return performActivity(actor, key, { quality: form.querySelector('.activity-quality')?.value });
        },
      },
      {
        action: 'declare', label: 'Declare', icon: 'fas fa-hourglass-start',
        callback: async (event, button, dialog) => {
          const form = dialog?.element?.querySelector('form') ?? button.form;
          const key = form?.querySelector('input[name="activity"]:checked')?.value;
          if (!key) return null;
          return DowntimeHelpers.declare(actor, key,
            { quality: form.querySelector('.activity-quality')?.value });
        },
      },
      // The clock is GM-gated at the server level, so only they get the lever.
      ...(game.user.isGM ? [{
        action: 'advance', label: 'Advance clock', icon: 'fas fa-forward',
        callback: async () => DowntimeHelpers.advance(),
      }] : []),
      { action: 'cancel', label: 'Cancel' },
    ],
  });
}

/**
 * Token HUD entry point — select a token, click the hourglass, pick an
 * activity. A framework nothing can reach is a framework that does not exist,
 * so the registry ships with a door into it rather than console-only access.
 */
export function registerActivityHud() {
  Hooks.on('renderTokenHUD', (hud, html) => {
    const actor = hud.object?.document?.actor;
    if (!actor?.isOwner) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    const col = root?.querySelector('.col.left') ?? root?.querySelector('.col.right');
    if (!col) return;

    const div = document.createElement('div');
    div.className = 'control-icon';
    div.dataset.tooltip = 'Perform an activity (out of combat)';
    div.innerHTML = '<i class="fas fa-hourglass-half"></i>';
    div.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      await activityDialog(actor);
    });
    col.appendChild(div);
  });
}

export const ActivityHelpers = {
  computeActivityTime, performActivity, activityDialog, advanceWorldTime,
  secondsToTicks, formatSeconds,
};
