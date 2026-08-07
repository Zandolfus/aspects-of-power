/**
 * Calendar & Downtime Tracker — the visible face of the clock.
 *
 * The celestial engine has been correct and INVISIBLE since `4f4e420`: the
 * date, the moon and the eclipse tables were all computable and nothing ever
 * showed them. The downtime barrier has been reachable only through an
 * unlabelled hourglass on the Token HUD, which the user had never once seen.
 * This is the door.
 *
 * WHAT IT SHOWS
 *   - civil date + time, moon phase and illumination, the next few sky events
 *   - ONE TIMELINE PER PARTICIPANT, blocks positioned and sized by REAL TIME
 *     against a shared axis, so a 1h smithing block is visibly twice a 30m
 *     jewelcrafting block and both start where they were declared
 *   - GM: advance to the next completion, advance by a custom amount, and
 *     cancel every outstanding declaration (the ambush button)
 *
 * COLOUR comes from `User#color` — already player-chosen, already stored
 * server-side, and already what Foundry tints the player list and token
 * borders with. Inventing a second colour store would give a player two
 * different colours and no idea which one this was.
 *
 * ⚠ Everything is precomputed in `_prepareContext`; the template does no
 * arithmetic. Percentages are the only geometry the CSS needs.
 */

import { DowntimeHelpers } from '../systems/downtime.mjs';
import { celestialState, upcomingEvents, civilDate } from '../systems/calendar.mjs';
import { ActivityHelpers } from '../systems/activities.mjs';

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Minimum axis span so a single short action is not a full-width bar. */
const MIN_SPAN_SECONDS = 600;

export class CalendarTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'aop-calendar-tracker',
    classes: ['aspects-of-power', 'aop-calendar'],
    position: { width: 520, height: 'auto' },
    window: { title: 'Calendar & Downtime', icon: 'fas fa-calendar-days', resizable: true },
    actions: {
      advanceNext:   CalendarTracker._onAdvanceNext,
      advanceCustom: CalendarTracker._onAdvanceCustom,
      cancelAll:     CalendarTracker._onCancelAll,
      postRoster:    CalendarTracker._onPostRoster,
    },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/calendar-tracker.hbs' },
  };

  /** Single shared instance — a second tracker would just drift from the first. */
  static _instance = null;

  static toggle() {
    if (CalendarTracker._instance?.rendered) {
      CalendarTracker._instance.close();
      return;
    }
    CalendarTracker._instance ??= new CalendarTracker();
    CalendarTracker._instance.render(true);
  }

  /** Re-render the open tracker, if there is one. Safe to call from hooks. */
  static refresh() {
    if (CalendarTracker._instance?.rendered) CalendarTracker._instance.render(false);
  }

  /**
   * The colour for an actor's lane: the assigned user's, else the first
   * non-GM owner's, else a neutral. Returned as a CSS string.
   */
  static _colourFor(actor) {
    const assigned = game.users.find(u => !u.isGM && u.character?.id === actor.id);
    const owner = assigned ?? game.users.find(u => !u.isGM
      && actor.testUserPermission?.(u, 'OWNER'));
    const c = owner?.color;
    // User#color is a Color instance in v13+; `css` is its hex string.
    return c?.css ?? (typeof c === 'string' ? c : '#7a7971');
  }

  /**
   * Black or white, whichever is legible ON `css`.
   *
   * The lane colour is PLAYER-CHOSEN and can be anything, so no fixed text
   * colour is safe: white on one player's pale cyan was very nearly invisible
   * in the first render. Relative luminance per WCAG, threshold tuned against
   * the three colours actually in this world (pale cyan 0.85 and bright green
   * 0.44 both want dark text; mid blue 0.36 wants light).
   */
  static _textOn(css) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(css ?? '').trim());
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return L > 0.4 ? '#111111' : '#ffffff';
  }

  /**
   * "11d" / "6h" for an event horizon. `upcomingEvents` returns `inDays` as a
   * raw float because it is derived from a real syzygy time — printing it
   * straight put `10.868109118985357d` in the panel.
   */
  static _inLabel(inDays) {
    if (!Number.isFinite(inDays)) return '—';
    if (inDays < 1) return `${Math.max(1, Math.round(inDays * 24))}h`;
    return `${Math.round(inDays)}d`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const now = game.time.worldTime;
    // ⚠ PLAIN `isGM`, not `isActingGM()`. This gates whether the controls are
    // VISIBLE, not whether a mutation runs — and `activeGM` is exactly one of
    // the connected GMs, so the acting-GM test hid the whole footer from every
    // other GM at the table. A button is pressed once by a person; it is not a
    // hook firing on every client, which is what that helper exists to tame.
    const gm = game.user.isGM;

    /* ---------- sky ---------- */
    let sky = null;
    try {
      const s = celestialState();
      sky = {
        date: s.date,
        moon: s.moon?.name ?? '—',
        illum: Math.round((s.moon?.illumination ?? 0) * 100),
        waxing: s.moon?.waxing ?? null,
        eclipse: s.eclipse?.type ?? null,
        quarterDay: s.quarterDay ?? null,
      };
    } catch (err) {
      console.error('Aspects of Power | calendar tracker: sky failed', err);
    }
    let next = [];
    try {
      next = (upcomingEvents(45) ?? []).slice(0, 3)
        .map(e => ({ ...e, inLabel: CalendarTracker._inLabel(e.inDays) }));
    } catch (err) { console.error('Aspects of Power | calendar tracker: events failed', err); }

    /* ---------- timelines ---------- */
    const entries = DowntimeHelpers.roster();
    const declared = entries.filter(e => e.declaration);

    // Shared axis: earliest start (or now) to latest end. A minimum span stops
    // one short action from rendering as a full-width bar and reading as long.
    const starts = declared.map(e => e.declaration.startTime);
    const ends = declared.map(e => e.declaration.endTime);
    const axisStart = Math.min(now, ...(starts.length ? starts : [now]));
    const rawEnd = Math.max(now, ...(ends.length ? ends : [now]));
    const axisEnd = Math.max(rawEnd, axisStart + MIN_SPAN_SECONDS);
    const span = Math.max(1, axisEnd - axisStart);
    const pct = (t) => Math.max(0, Math.min(100, ((t - axisStart) / span) * 100));

    const rows = entries.map(e => {
      const d = e.declaration;
      const colour = CalendarTracker._colourFor(e.actor);
      const row = {
        name: e.actor.name,
        img: e.actor.img,
        colour,
        ink: CalendarTracker._textOn(colour),
        isOwn: e.actor.isOwner,
        declared: !!d,
        label: d?.label ?? null,
        display: d?.display ?? null,
        remaining: e.display ?? null,
        // Done blocks would sit entirely left of `now`; they resolve on the
        // next advance, so showing them as still-running would be a lie.
        overdue: !!d && d.endTime <= now,
      };
      if (d) {
        row.leftPct = pct(d.startTime);
        row.widthPct = Math.max(1.5, pct(d.endTime) - pct(d.startTime));
      }
      return row;
    });

    // Axis gridlines — 5 evenly spaced labels across the window.
    //
    // WALL-CLOCK, not elapsed. Elapsed labelled the left edge `0.0ms`, and a
    // player asking "when am I free" wants a time of day, not an offset from
    // whenever the earliest of someone else's actions happened to start. Long
    // spans fall back to the date, where the hour has stopped being the point.
    const p2 = (n) => String(n).padStart(2, '0');
    const byDate = span > 2 * 86400;
    const tickLabel = (t) => {
      const d = civilDate(Math.round(t));
      return byDate ? `${p2(d.month)}-${p2(d.day)}` : `${p2(d.hour)}:${p2(d.minute)}`;
    };
    const ticks = [];
    for (let i = 0; i <= 4; i++) {
      const t = axisStart + (span * i) / 4;
      // The last label would hang off the right edge and get clipped, so it
      // is anchored from the right instead. Flagged here rather than in CSS
      // because :last-child would also have to know the tick count.
      ticks.push({ pct: (i / 4) * 100, label: tickLabel(t), isLast: i === 4 });
    }

    Object.assign(context, {
      isGM: gm,
      sky,
      next,
      rows,
      ticks,
      nowPct: pct(now),
      hasRows: rows.length > 0,
      anyDeclared: declared.length > 0,
      allDeclared: DowntimeHelpers.allDeclared(),
      waitingOn: entries.filter(e => !e.declaration).map(e => e.actor.name),
      spanLabel: ActivityHelpers.formatSeconds(span),
    });
    return context;
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  /** Advance to the SHORTEST outstanding completion — the ruled barrier step. */
  static async _onAdvanceNext() {
    const res = await DowntimeHelpers.advance({});
    if (res?.advanced > 0) {
      ui.notifications?.info(`Advanced ${ActivityHelpers.formatSeconds(res.advanced)}`
        + (res.resolved.length ? ` — resolved: ${res.resolved.join(', ')}` : ''));
    }
    CalendarTracker.refresh();
  }

  /**
   * Advance by an explicit amount. Uses `seconds`, which bypasses the
   * "still waiting on declarations" guard by design — a GM skipping ahead is
   * deliberately overriding the barrier, which is what an interrupted
   * downtime looks like.
   */
  static async _onAdvanceCustom() {
    const content = `
      <div class="form-group">
        <label>Amount</label>
        <input type="number" name="amount" value="1" min="0" step="any" autofocus />
      </div>
      <div class="form-group">
        <label>Unit</label>
        <select name="unit">
          <option value="60">Minutes</option>
          <option value="3600" selected>Hours</option>
          <option value="86400">Days</option>
        </select>
      </div>`;
    const result = await DialogV2.wait({
      window: { title: 'Advance clock by' },
      content,
      buttons: [
        { action: 'ok', label: 'Advance', default: true,
          callback: (_ev, btn) => ({
            amount: Number(btn.form.elements.amount.value),
            unit: Number(btn.form.elements.unit.value),
          }) },
        { action: 'cancel', label: 'Cancel' },
      ],
    }).catch(() => null);
    if (!result || result === 'cancel' || !Number.isFinite(result.amount)) return;
    const seconds = Math.round(result.amount * result.unit);
    if (seconds <= 0) return;
    const res = await DowntimeHelpers.advance({ seconds, force: true });
    ui.notifications?.info(`Advanced ${ActivityHelpers.formatSeconds(res?.advanced ?? seconds)}`
      + (res?.resolved?.length ? ` — resolved: ${res.resolved.join(', ')}` : ''));
    CalendarTracker.refresh();
  }

  /**
   * THE AMBUSH BUTTON. Clears every outstanding declaration WITHOUT resolving
   * it, so nothing is performed and no resource is spent — downtime is simply
   * interrupted. Partial progress is not credited (the standing rule).
   */
  static async _onCancelAll() {
    const entries = DowntimeHelpers.roster().filter(e => e.declaration);
    if (!entries.length) {
      ui.notifications?.info('Nothing is in progress.');
      return;
    }
    const names = entries.map(e => e.actor.name).join(', ');
    const ok = await DialogV2.confirm({
      window: { title: 'Interrupt downtime' },
      content: `<p>Cancel all outstanding actions for <strong>${names}</strong>?</p>`
        + `<p class="hint">Nothing resolves and no resources are spent. Partial progress is lost.</p>`,
    }).catch(() => false);
    if (!ok) return;
    // ⚠ One at a time — these are separate documents and this environment has
    // dropped later writes in a batch (playbook-live-data-reliability).
    for (const e of entries) await DowntimeHelpers.cancel(e.actor);
    ChatMessage.create({
      content: `<p><em>Downtime interrupted — ${names} stop what they were doing.</em></p>`,
    });
    CalendarTracker.refresh();
  }

  static async _onPostRoster() {
    await DowntimeHelpers.postRoster();
  }
}

/**
 * Scene-control button + the hooks that keep the panel honest.
 *
 * A tool on the `tokens` group rather than a control group of its own: a
 * control GROUP activates a canvas layer, and the calendar has no layer to
 * activate. `tokens` is the group every user already sits in.
 *
 * ⚠⚠ MUST BE CALLED AT `init`, NOT `ready`. v14 builds the control set in
 * `SceneControls##prepareControls`, and that is only reached from
 *
 *     _configureRenderOptions(options) {
 *       if ( options.reset || options.isFirstRender ) this.#controls = this.#prepareControls();
 *     }
 *
 * — so `getSceneControlButtons` fires ONLY on the first render or an explicit
 * `render({reset: true})`. Registered from `ready` the hook is correctly
 * attached, reports as attached, and never fires: the controls were built
 * before it existed. That is exactly how this shipped invisible the first
 * time, with `Hooks.events.getSceneControlButtons === 1` the whole while.
 * `initialize()` does NOT help — it is deprecated and forwards to `render()`
 * without `reset`.
 */
export function registerCalendarTracker() {
  Hooks.on('getSceneControlButtons', (controls) => {
    const group = controls?.tokens;
    if (!group?.tools) return;
    group.tools.aopCalendar = {
      name: 'aopCalendar',
      order: 90,
      title: 'Calendar & Downtime',
      icon: 'fas fa-calendar-days',
      visible: true,
      button: true,
      onChange: () => CalendarTracker.toggle(),
    };
  });

  // The clock moving is the whole point of the panel.
  Hooks.on('updateWorldTime', () => CalendarTracker.refresh());
  // A declaration is an actor flag write, so watch actor updates too.
  Hooks.on('updateActor', (actor, changes) => {
    if (foundry.utils.hasProperty(changes, 'flags.aspectsofpower.downtime')
      || foundry.utils.hasProperty(changes, 'flags.aspectsofpower.-=downtime')) {
      CalendarTracker.refresh();
    }
  });

  // Belt and braces: if anything ever moves this registration back after the
  // first render, one reset render still surfaces the button rather than
  // failing silently.
  Hooks.once('ready', () => {
    if (!ui.controls?.controls?.tokens?.tools?.aopCalendar) {
      ui.controls?.render({ reset: true });
    }
  });
}
