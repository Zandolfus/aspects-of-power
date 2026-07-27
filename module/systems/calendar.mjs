/**
 * Calendar + celestial state (design-calendar-celestial.md).
 *
 * The DATE is core's job — Foundry v13+ ships a real CalendarData model and the
 * world runs its Simplified Gregorian because the setting is our planet. This
 * module adds the part core does not model: the SKY.
 *
 * ATTACHED TO REALITY (2026-07-26). World time 0 IS a real instant — J2000.0,
 * JD 2451545.0 — and every quantity below is computed from real ephemeris
 * measured from it. The moon phase on a world date is the TRUE phase for the
 * corresponding real date; Mars is retrograde when Mars is really retrograde.
 * Re-anchoring the campaign in real time is one config number
 * (`julianDayAtWorldZero`); no coefficient changes.
 *
 * Sources for every constant are named in config.mjs. The mean-element rates
 * cross-check against the month lengths they imply (445267.1114034 deg/century
 * -> 29.5306 d synodic; 483202.0175233 -> 27.2122 d draconic), which is the
 * cheapest possible guard against a mistyped digit.
 *
 * DEPENDENCY-FREE ON PURPOSE: no Foundry documents are imported, so all of this
 * golden-tests in plain node. Foundry only appears in the display helpers at
 * the bottom, which take the date from core.
 *
 * Console usage:
 *   const C = game.aspectsofpower.calendar;
 *   C.celestialState();            // sky right now, everything
 *   C.upcomingEvents(365);         // a year of real events
 *   C.postCelestialReport();       // chat card
 */

const DAY_SECONDS = 86400;
const DEG = Math.PI / 180;

function cfg() {
  return globalThis.CONFIG?.ASPECTSOFPOWER?.celestial ?? {};
}

/** Positive modulo — JS `%` keeps the sign of the dividend, which breaks every
 *  "how far through the cycle are we" question for negative times. */
function mod(n, m) {
  return ((n % m) + m) % m;
}

/** Signed angle folded into -180..180, for "how far from this direction". */
function foldAngle(deg) {
  return mod(deg + 180, 360) - 180;
}

/** Signed distance to the NEAREST multiple of 180, in -90..90. Syzygies and
 *  nodes both recur every half turn, so both refine against this. */
function foldHalf(deg) {
  const r = mod(deg, 180);
  return r > 90 ? r - 180 : r;
}

/** Julian Day for a world time, via the real-instant anchor. */
export function julianDay(worldTime, c = null) {
  const k = c ?? cfg();
  return (k.julianDayAtWorldZero ?? 2451545.0) + worldTime / DAY_SECONDS;
}

/** Julian centuries from J2000 — the argument every mean element takes. */
export function julianCenturies(worldTime, c = null) {
  return (julianDay(worldTime, c) - 2451545.0) / 36525;
}

/* -------------------------------------------------- */
/*  The Moon                                          */
/* -------------------------------------------------- */

/**
 * Moon state for a world time.
 *
 * Phase comes from the mean ELONGATION D (angle from the sun): 0 is new, 180
 * is full. The phase INDEX rounds to the nearest eighth so each named phase is
 * CENTRED on its exact moment — what a person looking up would say.
 */
export function moonState(worldTime, c = null) {
  const k = c ?? cfg();
  const T = julianCenturies(worldTime, k);
  const el = k.moonElongation ?? { atEpoch: 297.8501921, degPerCentury: 445267.1114034 };
  const phases = k.phases ?? ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];

  const D = mod(el.atEpoch + el.degPerCentury * T, 360);
  const fraction = D / 360;
  const index = Math.round(fraction * phases.length) % phases.length;
  const illumination = (1 - Math.cos(D * DEG)) / 2;
  const cycle = k.lunarCycleDays ?? 29.530588853;
  const step = cycle / phases.length;
  const age = fraction * cycle;
  return {
    elongation: D, age, fraction, index, name: phases[index], illumination,
    waxing: D < 180,
    daysToNext: step - mod(age + step / 2, step),
  };
}

/** Argument of latitude F: the moon's angular distance from its ascending node. */
export function moonNodeAngle(worldTime, c = null) {
  const k = c ?? cfg();
  const f = k.moonArgLatitude ?? { atEpoch: 93.2720950, degPerCentury: 483202.0175233 };
  return mod(f.atEpoch + f.degPerCentury * julianCenturies(worldTime, k), 360);
}

/**
 * Refine to the exact time of the next syzygy (new or full moon) at or after
 * `worldTime`, by bisecting on the elongation. Enumerating syzygies — instead
 * of sampling days and asking "is today an eclipse" — is what stops one eclipse
 * being reported on several consecutive days.
 *
 * @returns {{time:number, kind:'new'|'full'}}
 */
export function nextSyzygy(worldTime, c = null) {
  const k = c ?? cfg();
  const cycle = (k.lunarCycleDays ?? 29.530588853) * DAY_SECONDS;
  const D0 = moonState(worldTime, k).elongation;
  // Distance in degrees to the next multiple of 180.
  const toNext = 180 - mod(D0, 180);
  let t = worldTime + (toNext / 360) * cycle;
  // Refine against the SIGNED residual to the nearest multiple of 180. Using an
  // unsigned residual here could only ever push the estimate one way and landed
  // on the wrong syzygy entirely (caught by the real-eclipse tests).
  for (let i = 0; i < 3; i++) {
    t -= (foldHalf(moonState(t, k).elongation) / 360) * cycle;
  }
  const D = mod(moonState(t, k).elongation, 360);
  return { time: t, kind: (D < 90 || D > 270) ? 'new' : 'full' };
}

/**
 * Eclipse at a given syzygy. Real ecliptic limits in DEGREES from the node —
 * a syzygy alone is never enough, which is why eclipses cluster into seasons
 * (~4-7 a year) instead of arriving every fortnight.
 *
 * @returns {{type:'solar'|'lunar'|null, magnitude:'total'|'partial'|null,
 *            nodeDistanceDeg:number}}
 */
export function eclipseAtSyzygy(worldTime, kind, c = null) {
  const k = c ?? cfg();
  const lim = k.eclipseLimits ?? { solarPartial: 18.4, solarTotal: 11.8, lunarPartial: 12.2, lunarTotal: 5.9 };
  // Distance to the nearer node. Both nodes sit half a turn apart, so this is
  // the same fold the syzygy search uses — an earlier hand-rolled version got
  // F in 180..360 wrong (350 read as 170 from a node instead of 10).
  const nodeDistanceDeg = Math.abs(foldHalf(moonNodeAngle(worldTime, k)));
  const partial = kind === 'new' ? lim.solarPartial : lim.lunarPartial;
  const total = kind === 'new' ? lim.solarTotal : lim.lunarTotal;
  if (nodeDistanceDeg > partial) return { type: null, magnitude: null, nodeDistanceDeg };
  return {
    type: kind === 'new' ? 'solar' : 'lunar',
    magnitude: nodeDistanceDeg <= total ? 'total' : 'partial',
    nodeDistanceDeg,
  };
}

/* -------------------------------------------------- */
/*  The Planets                                       */
/* -------------------------------------------------- */

/** Heliocentric ecliptic position (AU) from mean elements + equation of centre. */
function heliocentric(el, T) {
  // Kepler's third law keeps period in agreement with the semi-major axis.
  const periodYears = Math.pow(el.a, 1.5);
  const L = el.L + (360 / periodYears) * (T * 100);      // T is centuries
  const M = mod(L - el.peri, 360);
  // First-order equation of centre: good to well under a degree at these
  // eccentricities, which is far finer than a 30-degree zodiac sign needs.
  const trueAnomaly = M + (2 * el.e * Math.sin(M * DEG)) / DEG;
  const trueLon = mod(trueAnomaly + el.peri, 360);
  const r = el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(trueAnomaly * DEG));
  return { x: r * Math.cos(trueLon * DEG), y: r * Math.sin(trueLon * DEG), trueLon, r };
}

/** Geocentric ecliptic longitude of a planet, in degrees. */
function geocentricLongitude(name, T, k) {
  const planets = k.planets ?? {};
  const el = planets[name];
  const earth = planets.Earth;
  if (!el || !earth) return null;
  if (name === 'Earth') return null;
  const p = heliocentric(el, T);
  const e = heliocentric(earth, T);
  return mod(Math.atan2(p.y - e.y, p.x - e.x) / DEG, 360);
}

/**
 * Where every planet sits and which way it is moving.
 *
 * Retrograde is detected the way it is actually defined — apparent geocentric
 * longitude DECREASING — by sampling a day either side, rather than by
 * hardcoding "Mercury is retrograde three times a year".
 */
export function planetStates(worldTime, c = null) {
  const k = c ?? cfg();
  const zodiac = k.zodiac ?? [];
  const T = julianCenturies(worldTime, k);
  const dT = 1 / 36525;                       // one day, in centuries
  const out = {};
  for (const name of Object.keys(k.planets ?? {})) {
    if (name === 'Earth') continue;
    const lon = geocentricLongitude(name, T, k);
    if (lon == null) continue;
    const before = geocentricLongitude(name, T - dT, k);
    const after = geocentricLongitude(name, T + dT, k);
    const drift = foldAngle(after - before);
    const signIndex = Math.floor(lon / 30) % 12;
    out[name] = {
      longitude: lon,
      sign: zodiac[signIndex] ?? null,
      degreeInSign: lon - signIndex * 30,
      retrograde: drift < 0,
      dailyMotion: drift / 2,
    };
  }
  return out;
}

/* -------------------------------------------------- */
/*  Fixed-calendar events                             */
/* -------------------------------------------------- */

/** The astronomical quarter day (solstice/equinox) a date falls on, if any. */
export function quarterDayFor(components, c = null) {
  const k = c ?? cfg();
  for (const [name, d] of Object.entries(k.quarterDays ?? {})) {
    if (components.month === d.month && components.dayOfMonth === d.day) return name;
  }
  return null;
}

/** Day-of-year comparison that tolerates windows wrapping past New Year. */
function inWindow(month, day, start, end) {
  const v = month * 100 + day;
  const s = start.month * 100 + start.day;
  const e = end.month * 100 + end.day;
  return s <= e ? (v >= s && v <= e) : (v >= s || v <= e);
}

/** Meteor showers active on a date, flagging the one at its peak. */
export function meteorShowersOn(components, c = null) {
  const k = c ?? cfg();
  return (k.meteorShowers ?? [])
    .filter(s => inWindow(components.month, components.dayOfMonth, s.start, s.end))
    .map(s => ({
      name: s.name, zhr: s.zhr, parent: s.parent,
      peaking: components.month === s.peak.month && components.dayOfMonth === s.peak.day,
    }));
}

/** Years until each known comet's next perihelion (negative = just passed). */
export function cometStates(worldTime, c = null) {
  const k = c ?? cfg();
  const jd = julianDay(worldTime, k);
  return (k.comets ?? []).map(cm => {
    const periodDays = cm.periodYears * 365.25;
    const sincePeri = jd - cm.perihelionJD;
    // Fold onto the cycle so the answer stays right many returns away.
    const intoCycle = mod(sincePeri, periodDays);
    const daysToNext = periodDays - intoCycle;
    return {
      name: cm.name, periodYears: cm.periodYears, note: cm.note,
      yearsToPerihelion: daysToNext / 365.25,
      // Naked-eye interest window: roughly a year either side of perihelion.
      visible: daysToNext < 365.25 || intoCycle < 365.25,
    };
  });
}

/* -------------------------------------------------- */
/*  Aggregate + display (Foundry from here down)      */
/* -------------------------------------------------- */

/** Everything about the sky at a moment, ready for display or a rules check. */
export function celestialState(worldTime = null) {
  const t = worldTime ?? game.time.worldTime;
  const cal = game.time.calendar;
  const components = cal.timeToComponents(t);
  const moon = moonState(t);
  const syz = nextSyzygy(t);
  return {
    worldTime: t,
    julianDay: julianDay(t),
    date: cal.format(components, 'timestamp'),
    components,
    season: components.season,
    quarterDay: quarterDayFor(components),
    moon,
    nodeAngle: moonNodeAngle(t),
    nextSyzygy: { ...syz, eclipse: eclipseAtSyzygy(syz.time, syz.kind) },
    planets: planetStates(t),
    meteorShowers: meteorShowersOn(components),
    comets: cometStates(t),
  };
}

/**
 * Notable sky events ahead. Syzygies are ENUMERATED (not sampled), so each
 * eclipse is reported exactly once; calendar-fixed events are scanned by day.
 */
export function upcomingEvents(days = 90, fromTime = null) {
  const start = fromTime ?? game.time.worldTime;
  const cal = game.time.calendar;
  const events = [];
  const label = (t) => cal.format(cal.timeToComponents(t), 'timestamp');
  const endTime = start + days * DAY_SECONDS;

  // Moons and eclipses, one entry per real syzygy.
  let cursor = start;
  for (let guard = 0; guard < 200; guard++) {
    const syz = nextSyzygy(cursor);
    if (syz.time > endTime) break;
    const inDays = (syz.time - start) / DAY_SECONDS;
    const ecl = eclipseAtSyzygy(syz.time, syz.kind);
    if (ecl.type) {
      events.push({ inDays, date: label(syz.time), kind: 'eclipse',
        label: `${ecl.magnitude === 'total' ? 'Total' : 'Partial'} ${ecl.type} eclipse` });
    } else {
      events.push({ inDays, date: label(syz.time), kind: 'moon',
        label: syz.kind === 'new' ? 'New Moon' : 'Full Moon' });
    }
    cursor = syz.time + DAY_SECONDS;      // step past it so we advance
  }

  // Calendar-fixed events: quarter days and shower peaks.
  for (let d = 0; d <= days; d++) {
    const t = start + d * DAY_SECONDS;
    const components = cal.timeToComponents(t);
    const q = quarterDayFor(components);
    if (q) events.push({ inDays: d, date: label(t), kind: 'quarter', label: q });
    for (const s of meteorShowersOn(components)) {
      if (s.peaking) {
        events.push({ inDays: d, date: label(t), kind: 'meteor',
          label: `${s.name} peak (ZHR ${s.zhr})` });
      }
    }
  }

  return events.sort((a, b) => a.inDays - b.inDays);
}

/** Which lunar ritual is in season right now — the join back to content. */
export function activeLunarRitualName(worldTime = null) {
  return moonState(worldTime ?? game.time.worldTime).name;
}

/** GM-facing sky report — what makes the invisible clock legible. */
export async function postCelestialReport(days = 90) {
  const s = celestialState();
  const events = upcomingEvents(days);
  const pct = Math.round(s.moon.illumination * 100);
  const retro = Object.entries(s.planets).filter(([, p]) => p.retrograde)
    .map(([n, p]) => `${n} in ${p.sign}`);
  const showers = s.meteorShowers.map(x => `${x.name}${x.peaking ? ' (PEAK)' : ''}`);
  const rows = events.slice(0, 14).map(e =>
    `<tr><td>${e.date.slice(0, 10)}</td><td>${e.label}</td>`
    + `<td style="text-align:right;opacity:0.7">${Math.round(e.inDays)}d</td></tr>`).join('');
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients('GM'),
    content: `<div class="craft-result"><h3>The Sky — ${s.date}</h3><hr>`
      + `<p><strong>${s.moon.name}</strong> — ${pct}% lit, ${s.moon.waxing ? 'waxing' : 'waning'},`
      + ` ${s.moon.daysToNext.toFixed(1)}d to the next phase.</p>`
      + (s.quarterDay ? `<p><strong>${s.quarterDay}</strong> today.</p>` : '')
      + (showers.length ? `<p>Meteors: ${showers.join(', ')}</p>` : '')
      + (retro.length ? `<p>Retrograde: ${retro.join(', ')}</p>` : '<p>No planet is retrograde.</p>')
      + (rows ? `<hr><p>Next ${days} days:</p><table style="width:100%">${rows}</table>` : '')
      + `</div>`,
  });
  return s;
}

export const CalendarHelpers = {
  julianDay, julianCenturies, moonState, moonNodeAngle, nextSyzygy, eclipseAtSyzygy,
  planetStates, quarterDayFor, meteorShowersOn, cometStates,
  celestialState, upcomingEvents, activeLunarRitualName, postCelestialReport,
};
