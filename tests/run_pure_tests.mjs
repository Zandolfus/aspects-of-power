/**
 * Pure-function regression tests â€” run in plain node (no Foundry):
 *   node tests/run_pure_tests.mjs
 *
 * Expected values are GOLDEN NUMBERS pulled from the live world
 * (migration/local/golden_baseline.json + live-fired chat cards), not
 * hand-derived â€” per the house get-the-math-from-the-game rule. If a test
 * fails after an intentional formula change, re-pull the golden numbers and
 * update BOTH together in one commit.
 */
import {
  houseHitFormula, hybridAbilityMod, weaponStatBlend, spellDamageRef,
  spellInvestDamage, strikeInvestDamage, infusionDamage, investSelfDamage,
  effectiveDodgeValue, splitEvenlyWithRemainder, perceiveGateDecision, activityTicks, nextCompletionDelta,
} from '../module/helpers/formulas.mjs';
import { moonState, moonNodeAngle, nextSyzygy, eclipseAtSyzygy, planetStates,
         meteorShowersOn, cometStates, julianDay } from '../module/systems/calendar.mjs';

const CFG = {
  meleeBlend: { strFloor: 0.30, slope: 0.70, weightOffset: 40, weightSpan: 180 },
  rangedBlend: { perFloor: 0.05, slope: 0.55, weightOffset: 50, weightSpan: 200 },
  spellTierFactors: { basic: 2, high: 4, greater: 8, major: 25, grand: 50 },
  defenseTuning: {
    dodgeBasisDiv: 1.1, scrambleStackPct: 0.15,
    perceiveGateRatio: 2.5, perceiveGateMortalBand: true,
  },
};

let failures = 0;
function eq(name, got, want) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) { failures++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

// House hit grammar â€” string must match the golden fixture formulas verbatim.
eq('houseHitFormula(321)', houseHitFormula(321), '((((d20/100)*(321))+(321)))');

// Weapon blends â€” live-verified spellstrike hit blends (2026-07-03 fires):
// Aiden longsword wt100 str149 dex518 â†’ 321; John wt100 str288 dex218 â†’ 255.
eq('blend Aiden sword', weaponStatBlend(100, { str: 149, dex: 518 }, false, CFG).blend, 321);
eq('blend John sword', weaponStatBlend(100, { str: 288, dex: 218 }, false, CFG).blend, 255);
eq('blend label melee', weaponStatBlend(100, { str: 1, dex: 1 }, false, CFG).label, 'Str/Dex');
// Ranged: wt130 bow, dex518 per236 â†’ perW=0.05+0.55Ã—(80/200)=0.27 â†’ 518Ã—0.73+236Ã—0.27=441.9â†’442.
eq('blend ranged bow', weaponStatBlend(130, { dex: 518, per: 236 }, true, CFG).blend, 442);
// Weight clamping: below offset â†’ floor weights.
eq('blend clamp low', weaponStatBlend(10, { str: 100, dex: 200 }, false, CFG).blend, Math.round(100 * 0.30 + 200 * 0.70));

// Hybrid ability mod (item.mjs _buildRollFormulas 710-717 semantics).
const abilities = { intelligence: { mod: 759 }, dexterity: { mod: 518 } };
eq('hybrid pure', hybridAbilityMod(abilities, { abilities: 'intelligence', statType: 'pure' }), 759);
eq('hybrid 70/30', hybridAbilityMod(abilities, { abilities: 'intelligence', statType: 'hybrid', secondaryAbility: 'dexterity', primaryWeight: 0.7, secondaryWeight: 0.3 }), Math.round(759 * 0.7 + 518 * 0.3));

// Spell damage ref â€” the 65f8a42 fix constant. E grade factor 10 â†’ 20.
eq('spellDamageRef E', spellDamageRef(10, CFG), 20);

// Infusion â€” live-verified dac55a5 re-fire: Aiden int759 coef0.7 32 mana ref20 â†’ 584.
eq('infusion Aiden 32', infusionDamage(759, 0.7, 32, 20), 584);
// Pre-fix reproduction: coef 1, 120 mana vs own-base 20 â†’ 1086 (the original live fire).
eq('infusion legacy repro', infusionDamage(759, 1.0, 120, 20), 1086);

// Strike invest â€” live-verified Cross Wind strike: blend321 Ã—0.9 mult Ã—1.0 windup, 9 stam / 1 base â†’ 448.
eq('strike Aiden CW', strikeInvestDamage(321, 0.9, 1.0, 9, 1), 448);

// Spell invest â€” live-verified spell-tier fix ladder (int759, mult 0.5 inferiorâ€¦ use exact ladder):
// From 65f8a42 verify: basic 584 at safe invest. basic: tierBase 20, wisCap 20+238Ã—0.05â‰ˆ32 â†’ int759Ã—multÃ—(32/20)^0.2.
// With mult chosen so result 584: 584 = 759Ã—mÃ—1.0985 â†’ mâ‰ˆ0.7005 â†’ uncommon 0.7. Check:
eq('spell basic uncommon', spellInvestDamage(759, 0.7, 32, 20), 584);

// Self-damage: linear past safe ceiling. Aiden CW test fire: blend321, 9 invested, base 1, safe 4 â†’ excess 4 â†’ 321Ã—(4/4)=321 (live: 321 self-damage).
eq('selfDamage Aiden CW', investSelfDamage(321, 9, 1, 4), 321);
eq('selfDamage none', investSelfDamage(321, 5, 1, 4), 0);

// Effective dodge value: def 400, div 1.1, 2 stacks â†’ (400/1.1)Ã—0.7 = 254.54â€¦
eq('dodge value', Math.round(effectiveDodgeValue({ system: { defense: { melee: { value: 400 } } } }, 'melee', 2, CFG.defenseTuning)), 255);

// Perceive-to-react gate. Mods are the LOCKED reference curve
// (ROUND_K 3,000,000 / CONFIG.referenceRoundLength[rl]): G1 36, G10 147,
// F24 284, E25 305, E50 638, E99 1212.
const PG = (aMod, dMod, aRank, dRank, dt = CFG.defenseTuning) =>
  perceiveGateDecision(aMod, dMod, aRank, dRank, dt);
// The binding modern case from the 2026-07-02 sim: E50 attacking E25 is
// 2.09x â€” inside R=2.5, so the +/-25-level ruling holds.
eq('perceive E50 vs E25 reacts', PG(638, 305, 'E', 'E').canReact, true);
eq('perceive E50 vs E25 ratio', Math.round(PG(638, 305, 'E', 'E').ratio * 100) / 100, 2.09);
// E99 vs E25 is 3.97x â€” a blur.
eq('perceive E99 vs E25 blurs', PG(1212, 305, 'E', 'E').canReact, false);
// Mortal band: G10 vs G1 is 4.08x and would blur, but G/F is waived in-band.
eq('perceive G10 vs G1 waived', PG(147, 36, 'G', 'G'), { canReact: true, ratio: 147 / 36, waived: true, R: 2.5 });
// Cross-band is NOT waived â€” an E25 attacking a G1 is 8.47x.
eq('perceive E25 vs G1 blurs', PG(305, 36, 'E', 'G').canReact, false);
// Grade boundary stays smooth: F24 -> E25 is 1.07x, no cliff.
eq('perceive F24 vs E25 reacts', PG(284, 305, 'F', 'E').canReact, true);
// Slower attacker always reacts; R <= 0 disables the gate entirely.
eq('perceive slower attacker', PG(305, 638, 'E', 'E').canReact, true);
eq('perceive disabled', PG(99999, 1, 'S', 'G', { perceiveGateRatio: 0 }).canReact, true);
eq('perceive mortal off', PG(147, 36, 'G', 'G', { perceiveGateRatio: 2.5, perceiveGateMortalBand: false }).canReact, false);

// Activity timing. Golden values are the ruled exemplar table in
// design-celerity-realtime.md, which was itself derived from the shipped
// celerity constants (SCALE 10,000, TICK_MS 0.072) â€” G1 ref mod 36, E25 305.
const secs = (ticks) => ticks * 0.072 / 1000;
const round1 = (n) => Math.round(n * 10) / 10;
// G1 mundane: force a stuck door in 10s, search a room in 10min, forge a
// standard sword in 2.0h (the realism anchor the whole system is calibrated on).
eq('activity G1 forceDoor 10s', round1(secs(activityTicks(500, 36, { scale: 10000 }))), 10);
eq('activity G1 searchRoom 10min', round1(secs(activityTicks(30000, 36, { scale: 10000 })) / 60), 10);
eq('activity G1 forgeSword 2.0h', round1(secs(activityTicks(360000, 36, { scale: 10000 })) / 3600), 2);
// E25 does the same work in a blink â€” the point of the re-denomination.
eq('activity E25 forceDoor 1.2s', round1(secs(activityTicks(500, 305, { scale: 10000 }))), 1.2);
eq('activity E25 pickLock 4.7s', round1(secs(activityTicks(2000, 305, { scale: 10000 }))), 4.7);
eq('activity E25 searchRoom 71s', Math.round(secs(activityTicks(30000, 305, { scale: 10000 }))), 71);
// Quality multiplier scales the celerity part linearly.
eq('activity quality rough', activityTicks(1000, 100, { qualityMult: 0.25, scale: 10000 }),
   activityTicks(250, 100, { scale: 10000 }));
// Clock-bound ignores the performer entirely; celerity-bound ignores the clock.
eq('activity clock ignores mod', activityTicks(999999, 5000, { taskClass: 'clock', clockTicks: 5000, scale: 10000 }), 5000);
// Hybrid and the quality floor both resolve as "whichever is longest".
eq('activity hybrid takes clock', activityTicks(10, 1000, { taskClass: 'hybrid', clockTicks: 90000, scale: 10000 }), 90000);
eq('activity hybrid takes stat', activityTicks(1000, 10, { taskClass: 'hybrid', clockTicks: 90000, scale: 10000 }), 1000000);
eq('activity quality floor binds', activityTicks(1, 5000, { qualityMult: 25, clockFloorTicks: 42000, scale: 10000 }), 42000);
eq('activity never zero', activityTicks(0, 5000, { scale: 10000 }), 1);

// Celestial math — ATTACHED TO REALITY. World time 0 is J2000.0 (JD
// 2451545.0), so these assert against ACTUAL RECORDED EVENTS: real eclipses,
// real retrogrades, real moon phases. Constants and their sources are named in
// config.mjs; the mean-element rates cross-check against the month lengths they
// imply (445267.1114034 deg/cy -> 29.5306d synodic, 483202.0175233 -> 27.2122d
// draconic), which catches a mistyped digit.
const CEL = {
  julianDayAtWorldZero: 2451545.0,
  moonElongation: { atEpoch: 297.8501921, degPerCentury: 445267.1114034 },
  moonArgLatitude: { atEpoch: 93.2720950, degPerCentury: 483202.0175233 },
  lunarCycleDays: 29.530588853, draconicMonthDays: 27.212220817,
  eclipseLimits: { solarPartial: 18.4, solarTotal: 11.8, lunarPartial: 12.2, lunarTotal: 5.9 },
  phases: ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'],
  quarterDays: {
    'Spring Equinox': { month: 3, day: 20 }, 'Summer Solstice': { month: 6, day: 21 },
    'Autumn Equinox': { month: 9, day: 22 }, 'Winter Solstice': { month: 12, day: 21 },
  },
  meteorShowers: [
    { name: 'Perseids', start: { month: 7, day: 17 }, peak: { month: 8, day: 12 }, end: { month: 8, day: 24 }, zhr: 100 },
    { name: 'Quadrantids', start: { month: 12, day: 28 }, peak: { month: 1, day: 3 }, end: { month: 1, day: 12 }, zhr: 120 },
  ],
  planets: {
    Mercury: { a: 0.38709893, e: 0.20563069, L: 252.25084, peri: 77.45645, node: 48.33167, inc: 7.00487 },
    Venus:   { a: 0.72333199, e: 0.00677323, L: 181.97973, peri: 131.53298, node: 76.68069, inc: 3.39471 },
    Earth:   { a: 1.00000011, e: 0.01671022, L: 100.46435, peri: 102.94719, node: -11.26064, inc: 0.00005 },
    Mars:    { a: 1.52366231, e: 0.09341233, L: 355.45332, peri: 336.04084, node: 49.57854, inc: 1.85061 },
    Jupiter: { a: 5.20336301, e: 0.04839266, L: 34.40438, peri: 14.75385, node: 100.55615, inc: 1.30530 },
    Saturn:  { a: 9.53707032, e: 0.05415060, L: 49.94432, peri: 92.43194, node: 113.71504, inc: 2.48446 },
  },
  zodiac: ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'],
  comets: [{ name: '1P/Halley', periodYears: 74.7, perihelionJD: 2473682.5, note: '' }],
};
// Real UTC instant -> world time, through the J2000 anchor.
const at = (iso) => (Date.parse(iso) - Date.parse('2000-01-01T12:00:00Z')) / 1000;

// The Julian Day anchor itself.
eq('JD at world zero is J2000', julianDay(0, CEL), 2451545.0);
eq('JD one day on', julianDay(86400, CEL), 2451546.0);

// REAL new moon: 2000-01-06 18:14 UTC.
eq('real new moon 2000-01-06', moonState(at('2000-01-06T18:14:00Z'), CEL).name, 'New Moon');
// REAL full moon + total lunar eclipse: 2000-01-21 04:44 UTC.
eq('real full moon 2000-01-21', moonState(at('2000-01-21T04:44:00Z'), CEL).name, 'Full Moon');
// Illumination tracks the phase it reports.
eq('new moon is dark', Math.round(moonState(at('2000-01-06T18:14:00Z'), CEL).illumination * 100) < 5, true);
eq('full moon is lit', Math.round(moonState(at('2000-01-21T04:44:00Z'), CEL).illumination * 100) > 95, true);
// Negative world times (dates before J2000) must not break the cycle.
eq('phase valid before J2000', CEL.phases.includes(moonState(at('1999-08-11T11:03:00Z'), CEL).name), true);

// REAL ECLIPSES. Syzygies are enumerated, so each is found once and tested
// against the true ecliptic limits rather than a fudged day-window.
const eclipseNear = (iso) => {
  const syz = nextSyzygy(at(iso) - 3 * 86400, CEL);
  return { ...eclipseAtSyzygy(syz.time, syz.kind, CEL), kind: syz.kind,
           offDays: (syz.time - at(iso)) / 86400 };
};
// The total solar eclipse of 1999-08-11 (the one that crossed Europe).
const e1999 = eclipseNear('1999-08-11T11:03:00Z');
eq('1999-08-11 is a solar eclipse', e1999.type, 'solar');
eq('1999-08-11 is total', e1999.magnitude, 'total');
eq('1999-08-11 syzygy within a day', Math.abs(e1999.offDays) < 1, true);
// The total lunar eclipse of 2000-01-21.
const l2000 = eclipseNear('2000-01-21T04:44:00Z');
eq('2000-01-21 is a lunar eclipse', l2000.type, 'lunar');
eq('2000-01-21 is total', l2000.magnitude, 'total');
// A syzygy far from a node is NOT an eclipse — the whole point of the limits.
const quiet = nextSyzygy(at('2000-04-01T00:00:00Z'), CEL);
eq('syzygy away from node is no eclipse', eclipseAtSyzygy(quiet.time, quiet.kind, CEL).type, null);
// Eclipses stay rare and clustered. Syzygies alternate new/full every ~14.77d,
// so 26 of them is ~1.05 years — the real world sees 4-7 eclipses in that span.
// This is the assertion that would catch limits fudged to "feel right".
let eclipseCount = 0, cur = at('2000-01-01T00:00:00Z');
for (let i = 0; i < 26; i++) {
  const s2 = nextSyzygy(cur, CEL);
  if (eclipseAtSyzygy(s2.time, s2.kind, CEL).type) eclipseCount++;
  cur = s2.time + 86400;
}
eq('eclipses per year in 4..7', eclipseCount >= 4 && eclipseCount <= 7, true);

// REAL RETROGRADES, detected as apparent geocentric longitude decreasing.
// Mars was retrograde 2020-09-09 to 2020-11-13.
eq('Mars retrograde 2020-10-01', planetStates(at('2020-10-01T00:00:00Z'), CEL).Mars.retrograde, true);
eq('Mars direct 2021-01-01', planetStates(at('2021-01-01T00:00:00Z'), CEL).Mars.retrograde, false);
// Every planet lands in a real zodiac sign.
const ps = planetStates(at('2020-10-01T00:00:00Z'), CEL);
eq('planets carry zodiac signs', Object.values(ps).every(p => CEL.zodiac.includes(p.sign)), true);
eq('degree within sign 0..30', Object.values(ps).every(p => p.degreeInSign >= 0 && p.degreeInSign < 30), true);

// Meteor showers are calendar-fixed; the Perseids peak on Aug 12.
eq('Perseids peak Aug 12', meteorShowersOn({ month: 8, dayOfMonth: 12 }, CEL)[0].peaking, true);
eq('Perseids active Aug 1', meteorShowersOn({ month: 8, dayOfMonth: 1 }, CEL)[0].name, 'Perseids');
eq('no showers in June', meteorShowersOn({ month: 6, dayOfMonth: 15 }, CEL).length, 0);
// Quadrantids wrap the New Year — the window must survive the rollover.
eq('Quadrantids active Dec 30', meteorShowersOn({ month: 12, dayOfMonth: 30 }, CEL).length, 1);
eq('Quadrantids active Jan 3', meteorShowersOn({ month: 1, dayOfMonth: 3 }, CEL)[0].peaking, true);

// Halley returns in 2061: from J2000 that is ~61 years out.
const halley = cometStates(0, CEL)[0];
eq('Halley returns in about 61 years', Math.round(halley.yearsToPerihelion), 61);

// Downtime barrier: the clock advances to the SHORTEST outstanding action
// (ruled 2026-07-26) so whoever finishes first can declare again â€” a six-hour
// craft must never block a five-minute lockpick.
const decl = (endTime) => ({ endTime });
eq('barrier picks shortest', nextCompletionDelta([decl(1000), decl(60), decl(20000)], 0), 60);
eq('barrier from a later now', nextCompletionDelta([decl(1000), decl(600)], 500), 100);
eq('barrier nothing declared', nextCompletionDelta([], 0), null);
// An overdue action (GM advanced past it by hand) resolves now, never drags
// the clock backwards.
eq('barrier never negative', nextCompletionDelta([decl(50)], 900), 0);
eq('barrier single action', nextCompletionDelta([decl(7200)], 0), 7200);

// Even split with remainder.
eq('split 10/3', splitEvenlyWithRemainder(10, ['a', 'b', 'c']), { a: 3, b: 3, c: 4 });
eq('split exact', splitEvenlyWithRemainder(9, ['a', 'b', 'c']), { a: 3, b: 3, c: 3 });
eq('split single', splitEvenlyWithRemainder(7, ['x']), { x: 7 });
eq('split empty', splitEvenlyWithRemainder(7, []), {});

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll pure-function tests pass.');

