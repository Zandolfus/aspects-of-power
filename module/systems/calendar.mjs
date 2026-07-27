/**
 * Calendar + celestial state (design-calendar-celestial.md).
 *
 * The date itself is core's job — Foundry v13+ ships a real CalendarData model
 * (timeToComponents / componentsToTime / format / seasons / leap years) and the
 * world runs its default Simplified Gregorian because the setting is our
 * planet. This module adds the part core does not model: the SKY.
 *
 * That is not decoration. Eight lunar-phase rituals are already authored in
 * world.skills (New Moon ... Waning Crescent) and have been pure flavor
 * because nothing could answer "which phase is it". This answers it.
 *
 * DEPENDENCY-FREE ON PURPOSE: no Foundry documents are imported, so the pure
 * math can be imported and golden-tested in plain node. Everything reads CONFIG
 * lazily with fallbacks.
 *
 * Console usage:
 *   const C = game.aspectsofpower.calendar;
 *   C.celestialState();                    // sky right now
 *   C.upcomingEvents(90);                  // next 90 days of events
 *   C.postCelestialReport();               // chat card
 */

const DAY_SECONDS = 86400;

function cfg() {
  return globalThis.CONFIG?.ASPECTSOFPOWER?.celestial ?? {};
}

/** Positive modulo — JS `%` keeps the sign of the dividend, which breaks
 *  every "how far through the cycle are we" question for negative times. */
function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Moon state for a world time (seconds).
 *
 * `age` is days since the last new moon. The phase INDEX rounds to the nearest
 * eighth rather than flooring, so each named phase is CENTRED on its exact
 * moment — "Full Moon" spans the day and a half either side of true full,
 * which is what a person looking up would say.
 *
 * @param {number} worldTime  seconds
 * @param {object} [c]        celestial config override (tests)
 * @returns {{age:number, fraction:number, index:number, name:string,
 *            illumination:number, waxing:boolean, daysToNext:number}}
 */
export function moonState(worldTime, c = null) {
  const k = c ?? cfg();
  const cycle = k.lunarCycleDays ?? 29.530588853;
  const phases = k.phases ?? ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const days = worldTime / DAY_SECONDS - (k.lunarEpochDays ?? 0);
  const age = mod(days, cycle);
  const fraction = age / cycle;
  const index = Math.round(fraction * phases.length) % phases.length;
  // Illuminated fraction of the disc: 0 at new, 1 at full.
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  // Days until the next NAMED phase begins (the next eighth boundary).
  const step = cycle / phases.length;
  const daysToNext = step - mod(age + step / 2, step);
  return {
    age, fraction, index, name: phases[index], illumination,
    waxing: fraction < 0.5, daysToNext,
  };
}

/**
 * Is this world time an eclipse? A syzygy alone is not enough — the moon must
 * also be near an orbital node, which is why eclipses cluster into seasons
 * instead of happening every fortnight.
 *
 * @returns {{type:'solar'|'lunar'|null, nodeDistanceDays:number, total:boolean}}
 */
export function eclipseState(worldTime, c = null) {
  const k = c ?? cfg();
  const cycle = k.lunarCycleDays ?? 29.530588853;
  const draconic = k.draconicMonthDays ?? 27.212220817;
  const tol = k.eclipseNodeToleranceDays ?? 1.5;
  const days = worldTime / DAY_SECONDS;

  const age = mod(days - (k.lunarEpochDays ?? 0), cycle);
  // Distance in days from the nearest syzygy: new moon (solar) or full (lunar).
  const toNew = Math.min(age, cycle - age);
  const toFull = Math.abs(age - cycle / 2);
  const isSolar = toNew <= toFull;
  const syzygyDistance = isSolar ? toNew : toFull;

  // Nodes are crossed twice per draconic month.
  const half = draconic / 2;
  const nodePhase = mod(days - (k.nodeEpochDays ?? 0), half);
  const nodeDistanceDays = Math.min(nodePhase, half - nodePhase);

  // Both conditions must hold: at a syzygy AND at a node.
  const atSyzygy = syzygyDistance <= tol;
  const atNode = nodeDistanceDays <= tol;
  if (!atSyzygy || !atNode) return { type: null, nodeDistanceDays, total: false };
  return {
    type: isSolar ? 'solar' : 'lunar',
    nodeDistanceDays,
    // Dead-centre alignments read as total; the rest are partial.
    total: nodeDistanceDays <= tol / 3 && syzygyDistance <= tol / 3,
  };
}

/**
 * The astronomical quarter day (solstice/equinox) a date falls on, if any.
 * Core's seasons are month-banded, which is right for a label and wrong for a
 * ritual that must fire ON the solstice — so those dates live in config.
 */
export function quarterDayFor(components, c = null) {
  const k = c ?? cfg();
  for (const [name, d] of Object.entries(k.quarterDays ?? {})) {
    if (components.month === d.month && components.dayOfMonth === d.day) return name;
  }
  return null;
}

/**
 * Everything about the sky at a moment, ready for display or a rules check.
 * Needs Foundry for the date half; the celestial half is pure.
 */
export function celestialState(worldTime = null) {
  const t = worldTime ?? game.time.worldTime;
  const cal = game.time.calendar;
  const components = cal.timeToComponents(t);
  const moon = moonState(t);
  const eclipse = eclipseState(t);
  return {
    worldTime: t,
    date: cal.format(components, 'timestamp'),
    components,
    season: components.season,
    quarterDay: quarterDayFor(components),
    moon,
    eclipse,
  };
}

/**
 * Scan forward a day at a time for notable sky events. Sampling daily is
 * deliberate: named phases last more than a day, and eclipse windows are
 * authored in days, so a finer step would report the same event repeatedly.
 *
 * @param {number} days       how far ahead to look
 * @param {number} [fromTime] defaults to now
 * @returns {Array<{inDays:number, date:string, kind:string, label:string}>}
 */
export function upcomingEvents(days = 60, fromTime = null) {
  const start = fromTime ?? game.time.worldTime;
  const cal = game.time.calendar;
  const events = [];
  let lastPhase = moonState(start).index;
  for (let d = 1; d <= days; d++) {
    const t = start + d * DAY_SECONDS;
    const components = cal.timeToComponents(t);
    const date = cal.format(components, 'timestamp');
    const moon = moonState(t);
    // Only the two syzygies are worth announcing; the rest are just the sky
    // turning. (The full eight still drive ritual availability.)
    if (moon.index !== lastPhase) {
      if (moon.name === 'New Moon' || moon.name === 'Full Moon') {
        events.push({ inDays: d, date, kind: 'moon', label: moon.name });
      }
      lastPhase = moon.index;
    }
    const ecl = eclipseState(t);
    if (ecl.type) {
      events.push({ inDays: d, date, kind: 'eclipse',
        label: `${ecl.total ? 'Total' : 'Partial'} ${ecl.type} eclipse` });
    }
    const q = quarterDayFor(components);
    if (q) events.push({ inDays: d, date, kind: 'quarter', label: q });
  }
  return events;
}

/** Which lunar ritual is in season right now — the join back to content. */
export function activeLunarRitualName(worldTime = null) {
  return moonState(worldTime ?? game.time.worldTime).name;
}

/**
 * GM-facing sky report. The clock has been advancing invisibly since the
 * activity framework landed; this is what makes it legible.
 */
export async function postCelestialReport(days = 60) {
  const s = celestialState();
  const events = upcomingEvents(days);
  const pct = Math.round(s.moon.illumination * 100);
  const eclipseLine = s.eclipse.type
    ? `<p><strong>${s.eclipse.total ? 'TOTAL' : 'Partial'} ${s.eclipse.type} eclipse tonight.</strong></p>`
    : '';
  const rows = events.slice(0, 12).map(e =>
    `<tr><td>${e.date.slice(0, 10)}</td><td>${e.label}</td>`
    + `<td style="text-align:right;opacity:0.7">${e.inDays}d</td></tr>`).join('');
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients('GM'),
    content: `<div class="craft-result"><h3>The Sky — ${s.date}</h3><hr>`
      + `<p><strong>${s.moon.name}</strong> — ${pct}% lit, ${s.moon.waxing ? 'waxing' : 'waning'},`
      + ` ${s.moon.daysToNext.toFixed(1)}d to the next phase.</p>`
      + (s.quarterDay ? `<p><strong>${s.quarterDay}</strong> today.</p>` : '')
      + eclipseLine
      + (rows ? `<hr><p>Next ${days} days:</p><table style="width:100%">${rows}</table>` : '')
      + `</div>`,
  });
  return s;
}

export const CalendarHelpers = {
  moonState, eclipseState, quarterDayFor, celestialState,
  upcomingEvents, activeLunarRitualName, postCelestialReport,
};
