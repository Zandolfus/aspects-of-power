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
  proficiencyMultiplier, proficiencyHitMultiplier, parryMassMultiplier, lunarPhaseMultiplier, dotTickDamage, procStaminaCost, riderDamageBase,
  crushFlatAmount, riderMaxInvest,
} from '../module/helpers/formulas.mjs';
import { moonState, moonNodeAngle, nextSyzygy, eclipseAtSyzygy, planetStates,
         meteorShowersOn, cometStates, julianDay, civilDate, worldTimeForDate } from '../module/systems/calendar.mjs';

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
  julianDayAtWorldZero: 2451544.5,
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
    { name: 'Geminids', start: { month: 12, day: 4 }, peak: { month: 12, day: 13 }, end: { month: 12, day: 17 }, zhr: 150 },
    { name: 'Orionids', start: { month: 10, day: 2 }, peak: { month: 10, day: 21 }, end: { month: 11, day: 7 }, zhr: 20 },
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

// The Julian Day anchor itself. World zero is 2000-01-01 00:00 UTC (JD
// 2451544.5) — MIDNIGHT, not J2000 noon, so core's calendar (which starts its
// own year zero at world time 0) agrees with real months and days.
eq('JD at world zero', julianDay(0, CEL), 2451544.5);
eq('JD one day on', julianDay(86400, CEL), 2451545.5);

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

// Civil date round-trip, and the 1-BASED guard. Foundry's own components are
// ZERO-based (December is month 11, the 4th is dayOfMonth 3) while its
// formatter adds one back; feeding those into the fixed-date lookups put every
// shower and quarter day a month and a day early on the live world. These
// helpers are the unambiguous source the lookups now read from.
eq('canonical date round-trips', civilDate(worldTimeForDate(2024, 12, 4, 22, 0, 0, CEL), CEL).iso,
   '2024-12-04 22:00:00');
eq('civilDate months are 1-based', civilDate(worldTimeForDate(2024, 12, 4, 0, 0, 0, CEL), CEL).month, 12);
eq('civilDate days are 1-based', civilDate(worldTimeForDate(2024, 12, 4, 0, 0, 0, CEL), CEL).day, 4);
eq('world zero is 2000-01-01', civilDate(0, CEL).iso, '2000-01-01 00:00:00');
eq('leap day survives round-trip', civilDate(worldTimeForDate(2024, 2, 29, 0, 0, 0, CEL), CEL).iso,
   '2024-02-29 00:00:00');
// The canonical campaign instant, asserted as a number so it cannot drift.
eq('canonical worldTime', worldTimeForDate(2024, 12, 4, 22, 0, 0, CEL), 786664800);
// On that date the Geminids are running and the Orionids are long over — the
// exact pair that exposed the zero-based bug live.
eq('Geminids running on the canonical date',
   meteorShowersOn(12, 4, CEL).some(s => s.name === 'Geminids'), true);
eq('Orionids NOT running on the canonical date',
   meteorShowersOn(12, 4, CEL).some(s => s.name === 'Orionids'), false);

// Meteor showers are calendar-fixed; the Perseids peak on Aug 12.
eq('Perseids peak Aug 12', meteorShowersOn(8, 12, CEL)[0].peaking, true);
eq('Perseids active Aug 1', meteorShowersOn(8, 1, CEL)[0].name, 'Perseids');
eq('no showers in June', meteorShowersOn(6, 15, CEL).length, 0);
// Quadrantids wrap the New Year — the window must survive the rollover.
eq('Quadrantids active Dec 30', meteorShowersOn(12, 30, CEL).length, 1);
eq('Quadrantids active Jan 3', meteorShowersOn(1, 3, CEL)[0].peaking, true);

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

// ── Weapon proficiency -> damage (design-weapon-proficiencies.md,
// RULED 2026-07-27). Anchored at `common` so trained is neutral. GOLDEN
// values are the live CONFIG.skillRarities mults divided by common's 0.6.
const RAR = {
  not_proficient: { mult: 0.2 }, neglected: { mult: 0.3 }, rusty: { mult: 0.4 },
  inferior: { mult: 0.5 }, common: { mult: 0.6 }, uncommon: { mult: 0.7 },
  rare: { mult: 0.8 }, epic: { mult: 0.9 }, legendary: { mult: 1.0 },
  mythic: { mult: 1.1 }, divine: { mult: 1.2 },
};
const pm = (r) => +proficiencyMultiplier(r, RAR, 'common').toFixed(4);
eq('prof common is neutral', pm('common'), 1);
eq('prof not_proficient', pm('not_proficient'), 0.3333);
eq('prof rusty', pm('rusty'), 0.6667);
eq('prof legendary', pm('legendary'), 1.6667);
eq('prof divine doubles', pm('divine'), 2);
// ABSENCE IS NEUTRAL - the rule that keeps ~110 natural-weapon NPCs and every
// currently-unproficient PC from being silently nerfed the day this ships.
eq('no proficiency owned is neutral', pm(null), 1);
eq('unknown rarity is neutral', pm('bogus_tier'), 1);
// It compounds with the skill's own rarity rather than replacing it: a divine
// skill wielded with divine proficiency reaches 2.4x, double today's ceiling.
eq('compounds with skill rarity', +(RAR.divine.mult * pm('divine')).toFixed(3), 2.4);
eq('unproficient divine skill', +(RAR.divine.mult * pm('not_proficient')).toFixed(3), 0.4);

// -- Parry mass ratio (RULED 2026-07-27, k=0.3 "gentle"). Weights are the
// live weaponWeights table; the rule is min(1, (defW/atkW)^k).
const PMC = { parryMassExponent: 0.3, unarmedWeight: 40 };
const pmm = (d, a) => +parryMassMultiplier(d, a, PMC).toFixed(2);
eq('parry dagger vs greatsword', pmm(60, 200), 0.7);
eq('parry sword vs greatsword', pmm(100, 200), 0.81);
eq('parry spear vs greataxe', pmm(70, 220), 0.71);
// CAPPED AT 1 - out-massing your attacker is never a bonus, because a light
// weapon is agile. Asymmetry is the point.
eq('parry sword vs dagger capped', pmm(100, 60), 1);
eq('parry like vs like', pmm(200, 200), 1);
// Emergent and deliberately kept: a greatshield is the natural answer to a
// greatsword, with nothing special-casing shields.
eq('parry greatshield vs greatsword', pmm(190, 200), 0.98);
// Defender weight FLOORS at unarmed - two live actors carry Basic Parry with
// nothing equipped, and an unfloored ratio would zero their parry outright.
eq('parry empty-handed floors', pmm(0, 200), pmm(40, 200));
eq('parry empty vs empty', pmm(0, 0), 1);
// k <= 0 disables the rule entirely.
eq('parry rule disabled', parryMassMultiplier(60, 220, { parryMassExponent: 0 }), 1);
// THE LIVE CASE THAT MOTIVATED IT: Gabriel's dagger parry rolled 993 against
// Phil's greatsword hit of 956 and won. Under the rule it no longer does.
eq('Gabriel dagger no longer parries Phil claymore', Math.round(993 * pmm(60, 200)) >= 956, false);

// -- Lunar phase multiplier (RULED 2026-07-29, amp 0.40). Phase centres are
// real elongations: new 0deg, first quarter 90, full 180, last quarter 270.
const lpm = (idx, elong) => +lunarPhaseMultiplier(idx, elong, 0.40).toFixed(3);
// Your own moon, exactly overhead: full boost.
eq('lunar new moon at 0deg', lpm(0, 0), 1.4);
eq('lunar full moon at 180deg', lpm(4, 180), 1.4);
// The opposite phase: full penalty.
eq('lunar new moon at full sky', lpm(0, 180), 0.6);
eq('lunar full moon at new sky', lpm(4, 0), 0.6);
// Ninety degrees off is exactly neutral - cos(90) is zero.
eq('lunar quarter off is neutral', lpm(0, 90), 1);
eq('lunar quarter off other way', lpm(4, 90), 1);
// GOLDEN, from the live sky on 2024-12-04 22:00 (Waxing Crescent, 47.5deg).
eq('lunar waxing crescent on its night', lpm(1, 47.5), 1.4);
eq('lunar waning gibbous opposite it', lpm(5, 47.5), 0.6);
// Wrap-around must take the SHORT way round: index 7 sits at 315deg, which is
// 45deg from 0deg, not 315.
eq('lunar wraps the short way', lpm(7, 0), lpm(1, 0));
// Amplitude 0 disables it entirely.
eq('lunar disabled at amp 0', lunarPhaseMultiplier(4, 0, 0), 1);
// Nonsense input is neutral rather than NaN.
eq('lunar bad index neutral', lunarPhaseMultiplier(NaN, 90, 0.4), 1);

// -- DoT tick damage (RULED 2026-07-30: a chained rider sizes off the strike
// that spawned it). GOLDEN numbers measured live 2026-07-30 from Gabriel's kit
// against Phil: Hemorrhage's own roll 461, Infused Strike 821, and the same
// strike Feint-marked (+25%) 1026. dotScale 0.1 on Hemorrhage.
const dtd = (o) => dotTickDamage(o);
// A DIRECT cast has no parent and still uses its own roll - the old behaviour,
// which must not regress.
eq('dot direct cast uses own roll', dtd({ ownDamage: 461, dotScale: 0.1 }), 46);
// Chained off a plain Infused Strike: the bleed now rides the strike.
eq('dot chained off plain strike', dtd({ ownDamage: 461, parentDamage: 821, dotScale: 0.1 }), 82);
// Chained off the FEINTED strike - the number the ruling was stated with.
eq('dot chained off feinted strike', dtd({ ownDamage: 461, parentDamage: 1026, dotScale: 0.1 }), 103);
// THE POINT OF THE RULING: setup must change the payoff. Feinting the parent
// strike has to move the bleed; under the old own-roll behaviour it did not.
eq('dot setup changes payoff',
   dtd({ ownDamage: 461, parentDamage: 1026, dotScale: 0.1 })
     > dtd({ ownDamage: 461, parentDamage: 821, dotScale: 0.1 }), true);
// And it must clear a real wall where the old value never could: 3 stacks pool
// before DR is charged once, against Phil's DR 256.
eq('dot 3 stacks beat Phil DR when parent-sized',
   3 * dtd({ ownDamage: 461, parentDamage: 1026, dotScale: 0.1 }) > 256, true);
eq('dot 3 stacks were dead when self-sized',
   3 * dtd({ ownDamage: 461, dotScale: 0.1 }) > 256, false);
// The `invest` tag still overrides both damage numbers entirely.
eq('dot invest tag ignores damage', dtd({ ownDamage: 461, parentDamage: 1026,
   hasInvestTag: true, investAmount: 50, investScale: 1 }), 50);
eq('dot invest tag scales', dtd({ hasInvestTag: true, investAmount: 50, investScale: 2 }), 100);
// Partial defense scales the tick, and nothing ever goes negative.
eq('dot halved by partial defense',
   dtd({ ownDamage: 461, parentDamage: 1026, dotScale: 0.1, defenseMultiplier: 0.5 }), 51);
eq('dot never negative', dtd({ ownDamage: -999, dotScale: 0.1 }), 0);
eq('dot no input is zero', dtd({}), 0);

// -- Rider proc stamina cost (RULED 2026-07-30: cost = 0.20 x parent DAMAGE).
// GOLDEN from Gabriel's live kit measured 2026-07-30 on the REAL damage path
// (strikeInvestDamage, windup 0.6 dagger): Strike 300, Infused Strike 400,
// Sneak Attack 601, Hemorrhage 225.
const psc = (d, f) => procStaminaCost(d, f);
eq('proc cost Strike (B&B)', psc(300, 0.20), 60);
eq('proc cost Infused Strike (B&B)', psc(400, 0.20), 80);
eq('proc cost Sneak Attack', psc(601, 0.20), 121);
eq('proc cost Hemorrhage', psc(225, 0.20), 45);
// THE POINT OF DAMAGE-BASING: stamina per bleed point is UNIFORM across the
// kit. A hit-based cost was a flat ~50 for every skill (hit is near-constant
// because rarity multiplies damage, not accuracy), which made the
// bread-and-butter the worst rider vehicle and the divine burst the best.
const perBleed = (d) => psc(d, 0.20) / (d * 0.1);
eq('uniform cost per bleed point: Strike vs Sneak',
   Math.abs(perBleed(300) - perBleed(601)) < 0.02, true);
eq('uniform cost per bleed point: Strike vs Hemorrhage',
   Math.abs(perBleed(300) - perBleed(225)) < 0.02, true);
// Never free, never zero, never negative.
eq('proc cost rounds UP', psc(101, 0.20), 21);
eq('proc cost minimum 1', psc(1, 0.20), 1);
eq('proc cost of a zero-damage parent still costs', psc(0, 0.20), 1);
eq('proc cost never negative', psc(-500, 0.20), 1);
eq('proc disabled at frac 0', psc(300, 0), 0);

// -- Per-rider cost coefficient. The 0.20 default was calibrated on Gabriel's
// 300-damage Strike; a greataxe user lands 1354 with a SMALLER pool (225 vs
// 400), so cost scales with damage while pools do not scale with weapon
// weight. A heavy-weapon rider needs a lower fraction. GOLDEN from the live
// roster 2026-07-30.
eq('crush at 0.20 is unaffordable for George (1354 dmg, 225 pool)',
   procStaminaCost(1354, 0.20) > 225, true);
eq('crush at 0.05 is affordable for George', procStaminaCost(1354, 0.05), 68);
eq('crush at 0.05 affordable for Phil (1023 dmg, 184 pool)',
   procStaminaCost(1023, 0.05) <= 184, true);
// armorCrushMaxStacks is 3, so the cost only needs to permit ~3 procs.
eq('George affords 3 crush stacks', Math.floor(225 / procStaminaCost(1354, 0.05)) >= 3, true);
// Bleed keeps the default and stays where it was tuned.
eq('bleed default unchanged for Strike', procStaminaCost(300, 0.20), 60);

// -- riderDamageBase: the ONE rule both rider magnitudes size off (RULED
// 2026-07-30). Before it existed, dotTickDamage preferred the parent while
// armour crush silently used its own roll, so the two disagreed.
eq('rider prefers the parent', riderDamageBase(1354, 1015), 1354);
eq('direct cast falls back to its own roll', riderDamageBase(0, 1015), 1015);
eq('no parent and no roll is zero', riderDamageBase(0, 0), 0);
eq('negative own roll floors at zero', riderDamageBase(0, -99), 0);
// GOLDEN: George Royal Axe 1354 parent, Armor Crush own roll 1015, frac 0.10.
// Crush per stack was 101 off its own roll; off the parent it is 135.
eq('crush per stack off the parent', Math.round(0.10 * riderDamageBase(1354, 1015)), 135);
eq('3 stacks vs Phil armour+blockDR 912',
   912 - 3 * Math.round(0.10 * riderDamageBase(1354, 1015)), 507);
// Bleed and crush now agree on the base.
eq('bleed and crush share the base',
   dotTickDamage({ ownDamage: 1015, parentDamage: 1354, dotScale: 0.10 })
     === Math.round(0.10 * riderDamageBase(1354, 1015)), true);

// -- INVEST-DIALOG PREVIEW PARITY (2026-07-30). The dialog previewed damage
// with spellInvestDamage on BOTH paths, which has no weapon-weight term: a
// dagger swing previewed 501 and dealt 300. The preview now calls the same
// function the strike path does, so these two must stay welded together.
// GOLDEN live: Gabriel blend 715, mult 0.7, dagger windup 0.6, invest = base.
eq('preview matches the real dagger strike',
   strikeInvestDamage(715, 0.7, 0.6, 2, 2), 300);
// The OLD preview showed blend x mult with no windup - 500 here, 501 live off
// the unrounded blend. The invariant is the RATIO: the error is exactly 1/windup,
// so a dagger read 1.67x high and a greataxe 0.45x low.
eq('the OLD preview error was exactly 1/windup',
   Math.abs(spellInvestDamage(715, 0.7, 2, 2) / strikeInvestDamage(715, 0.7, 0.6, 2, 2) - 1 / 0.6) < 0.01, true);
// windup 1 makes the two functions identical, which is what keeps the SPELL
// dialog byte-for-byte unchanged by the switch.
for (const [p, m, v, r] of [[715, 0.7, 2, 2], [900, 1.4, 50, 12], [1085, 0.35, 7, 40]]) {
  eq(`spell preview unchanged at windup 1 (${p}/${m}/${v}/${r})`,
     strikeInvestDamage(p, m, 1, v, r) === spellInvestDamage(p, m, v, r), true);
}
// The error flips sign at weight 100 - light overstated, heavy understated.
eq('preview overstated a dagger', spellInvestDamage(715, 0.7, 2, 2) > strikeInvestDamage(715, 0.7, 0.6, 2, 2), true);
eq('preview understated a greataxe', spellInvestDamage(715, 0.7, 2, 2) < strikeInvestDamage(715, 0.7, 2.2, 2, 2), true);

// -- crushFlatAmount: structural twin of dotTickDamage.
const cfa = (o) => crushFlatAmount(o);
// GOLDEN: George Royal Axe 1354 parent, own roll 1015, shipped frac 0.05.
eq('crush off the parent at 0.05', cfa({ parentDamage: 1354, ownDamage: 1015, crushFrac: 0.05 }), 68);
eq('crush direct falls back to its own roll', cfa({ ownDamage: 1015, crushFrac: 0.05 }), 51);
eq('crush disabled by the ON gate', cfa({ enabled: false, parentDamage: 1354, crushFrac: 0.05 }), 0);
eq('crush never negative', cfa({ parentDamage: -900, crushFrac: 0.05 }), 0);
// THE CONTINUITY GUARANTEE: at BASE invest, invest-tagging changes nothing.
// base cost = procStaminaCost(parent, 0.05) = 68; crushInvestScale 1.0 -> 68.
const _crushBaseCost = procStaminaCost(1354, 0.05);
eq('invest-tagged crush is identical at base invest',
   cfa({ hasInvestTag: true, investAmount: _crushBaseCost, investScale: 1.0 })
     === cfa({ parentDamage: 1354, ownDamage: 1015, crushFrac: 0.05 }), true);
// And leaning on it scales linearly - that is the whole point of the lever.
eq('crush doubles at double invest', cfa({ hasInvestTag: true, investAmount: 136, investScale: 1.0 }), 136);
// A recorded invest of ZERO falls back to the damage anchor rather than
// silently applying a crush effect worth no armour at all.
eq('invest-tagged crush with no invest falls back, never zero',
   cfa({ hasInvestTag: true, investAmount: 0, parentDamage: 1354, crushFrac: 0.05 }), 68);
// Same continuity for the bleed: dotInvestScale 0.5 x the 0.20 cost == dotScale 0.10.
const _bleedBaseCost = procStaminaCost(300, 0.20);
eq('invest-tagged bleed is identical at base invest',
   dotTickDamage({ hasInvestTag: true, investAmount: _bleedBaseCost, investScale: 0.5 })
     === dotTickDamage({ parentDamage: 300, dotScale: 0.10 }), true);

// -- riderMaxInvest: the ceiling on a rider's commitment.
eq('rider ceiling is 3x base when the pool allows', riderMaxInvest(60, 400, 3.0), 180);
eq('rider ceiling binds on the POOL for a heavy hitter', riderMaxInvest(68, 225, 3.0), 204);
eq('rider ceiling never below base', riderMaxInvest(68, 10, 3.0), 68);
eq('rider ceiling floors a negative pool at base', riderMaxInvest(68, -5, 3.0), 68);
// George's 3 crush stacks must still fit in his pool at the ceiling's floor.
eq('George still affords 3 base-invest crush stacks', 3 * 68 <= 225, true);

// -- PROFICIENCY ON TO-HIT (RULED 2026-07-30: multiplicative, 10% per tier -
// deliberately compressed vs the ~16.7% damage step; the sim showed the full
// ratio flips the marquee dodge fight in one tier). Ladder spacing is 0.1
// mult per tier, anchored at common. Reuses the damage tests' RAR table.
const phm = (r, per) => proficiencyHitMultiplier(r, RAR, 'common', per ?? 0.10);
eq('hit prof: common is neutral', phm('common'), 1);
eq('hit prof: uncommon +10%', phm('uncommon'), 1.1);
eq('hit prof: rare +20%', phm('rare'), 1.2);
eq('hit prof: legendary +40%', phm('legendary'), 1.4);
eq('hit prof: divine +60%', phm('divine'), 1.6);
eq('hit prof: rusty (untrained-tracked) -20%', phm('rusty'), 0.8);
eq('hit prof: not_proficient -40%', phm('not_proficient'), 0.6);
eq('hit prof: null rarity is neutral', phm(null), 1);
eq('hit prof: perTier 0 disables', phm('divine', 0), 1);
// THE COMPRESSION IS THE POINT: one hit tier must be well inside the 1.188x
// dice span, where one DAMAGE tier (1.167x) nearly fills it.
eq('one hit tier is inside the dice band', phm('uncommon') < 1.188, true);
eq('the damage tier nearly fills the band', proficiencyMultiplier('uncommon', RAR, 'common') > 1.15, true);
// GOLDEN from the live pull: Phil hit blend 870, uncommon -> 957.
eq('Phil uncommon hit blend', Math.round(870 * phm('uncommon')), 957);

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll pure-function tests pass.');

