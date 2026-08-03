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
  spellCastWeight, spellWindupMultiplier, investCurve, healStatBlend,
  effectiveDodgeValue, splitEvenlyWithRemainder, perceiveGateDecision, activityTicks, nextCompletionDelta,
  proficiencyMultiplier, proficiencyHitMultiplier, parryMassMultiplier, lunarPhaseMultiplier, dotTickDamage, procStaminaCost, riderDamageBase,
  crushFlatAmount, riderMaxInvest, itemWeightLb, KG_TO_LB, carriedWeightLb,
  bracedParryWeight, bracedMaxUsefulInvest, defenceMarginMultiplier,
} from '../module/helpers/formulas.mjs';
import { moonState, moonNodeAngle, nextSyzygy, eclipseAtSyzygy, planetStates,
         meteorShowersOn, cometStates, julianDay, civilDate, worldTimeForDate } from '../module/systems/calendar.mjs';
import { resolveDamage, durabilityDamage, applyMarkBonus } from '../module/systems/damage.mjs';
import { stackDamageMultiplier, spendableRange, clampSpread, maxSingleTargetFields } from '../module/systems/stacks.mjs';

// ⚠ GOLDEN DAMAGE VALUES BELOW WERE MEASURED AT INVEST CURVE 0.2, from live
// chat cards. They are pinned to that curve EXPLICITLY (CURVE_02) so they stay
// true statements about the formula after the shipped config moves. Without the
// pin they would keep passing via the 0.2 fallback while no longer describing
// the live game - a green suite asserting history.
const CURVE_02 = { invest: { curveExponent: 0.2 } };

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
eq('infusion Aiden 32', infusionDamage(759, 0.7, 32, 20, CURVE_02), 584);
// Pre-fix reproduction: coef 1, 120 mana vs own-base 20 â†’ 1086 (the original live fire).
eq('infusion legacy repro', infusionDamage(759, 1.0, 120, 20, CURVE_02), 1086);

// Strike invest â€” live-verified Cross Wind strike: blend321 Ã—0.9 mult Ã—1.0 windup, 9 stam / 1 base â†’ 448.
eq('strike Aiden CW', strikeInvestDamage(321, 0.9, 1.0, 9, 1, CURVE_02), 448);

// Spell invest â€” live-verified spell-tier fix ladder (int759, mult 0.5 inferiorâ€¦ use exact ladder):
// From 65f8a42 verify: basic 584 at safe invest. basic: tierBase 20, wisCap 20+238Ã—0.05â‰ˆ32 â†’ int759Ã—multÃ—(32/20)^0.2.
// With mult chosen so result 584: 584 = 759Ã—mÃ—1.0985 â†’ mâ‰ˆ0.7005 â†’ uncommon 0.7. Check:
eq('spell basic uncommon', spellInvestDamage(759, 0.7, 32, 20, CURVE_02), 584);

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

// -- THE MARGIN RULE (RULED 2026-07-31). A failed defence scales with HOW
// BADLY it lost, replacing avoid / graze-0.5 / full.
const dmm = (d, h) => +defenceMarginMultiplier(d, h).toFixed(4);
// Winning still yields zero - full avoidance survives as the top of the curve.
eq('margin win is total avoidance', dmm(1200, 1070), 0);
eq('margin exact tie is avoidance', dmm(1070, 1070), 0);
// Beaten by a hair -> almost nothing lands. THE case the rule exists for:
// under the old band this was a full hit or a half-damage graze.
eq('margin near miss barely lands', dmm(1050, 1070), 0.0187);
// Beaten badly -> nearly everything lands.
eq('margin badly beaten', dmm(236, 1070), 0.7794);
// No defence at all is a full hit.
eq('margin zero defence is full', dmm(0, 1070), 1);
// Clamped both ends; a nonsense hit total cannot produce negative damage.
eq('margin clamps at 1', dmm(-500, 1070), 1);
eq('margin zero hit total', dmm(500, 0), 0);
// CONTINUITY is the whole point: two pips of a d20 must not be a cliff.
// Gabriel's live case - dodge 1013 basis, rolls of 8 vs 6 against a 1070 hit.
eq('margin is continuous across one pip',
  Math.abs(dmm(Math.round(1013 * 1.08), 1198) - dmm(Math.round(1013 * 1.06), 1198)) < 0.02, true);

// -- BRACED PARRY (`braced` tag + invest, RULED 2026-07-31). Stamina buys
// EFFECTIVE weight for the mass ratio only. Price of +1x weight is a fraction
// of the INCOMING HIT TOTAL, so it stays proportional across grades.
const BRC = { bracedCostHitFrac: 0.05, bracedMaxWeightMult: 3.0, parryMassExponent: 0.3, unarmedWeight: 40 };
const bw = (w, inv, hit, sc = 1) => +bracedParryWeight(w, inv, hit, sc, BRC).toFixed(1);
// Zero invest is an ordinary free parry - the tag must never be a passive buff.
eq('braced 0 stamina is unchanged', bw(60, 0, 1070), 60);
// At a 1070 hit one unit costs 53.5 stamina and buys +1x weight.
eq('braced one unit doubles', bw(60, 53.5, 1070), 120);
eq('braced two units triples', bw(60, 107, 1070), 180);
// Hard ceiling: bracedMaxWeightMult stops a dagger pretending to be a ram.
eq('braced capped at 3x', bw(60, 100000, 1070), 180);
// Efficiency scale is per-skill authoring, not a global constant.
eq('braced scale 2 buys double', bw(60, 53.5, 1070, 2), 180);
eq('braced scale 0 is inert', bw(60, 53.5, 1070, 0), 60);
// PRICE SCALES WITH THE BLOW: the same stamina buys less against a bigger hit,
// which is what keeps the tag honest at high grades.
eq('braced costs more vs a bigger hit', bw(60, 53.5, 2140) < bw(60, 53.5, 1070), true);

// The slider ceiling is the exact point that reaches PARITY - past it the
// min(1, ...) cap makes further stamina worthless.
const bmi = (w, aw, hit, pool, sc = 1) => bracedMaxUsefulInvest(w, aw, hit, pool, sc, BRC);
// Gabriel: dagger 60 vs greataxe 220 needs x3.67, capped to x3 -> 2 units.
eq('braced ceiling dagger vs greataxe', bmi(60, 220, 1070, 400), 107);
// Reaching that ceiling leaves him short of parity, by design.
eq('braced dagger never reaches parity vs greataxe',
  +parryMassMultiplier(bracedParryWeight(60, 107, 1070, 1, BRC), 220, BRC).toFixed(2), 0.94);
// A mid-weight weapon CAN reach parity - the gradient is emergent, not authored.
eq('braced sword reaches parity vs greataxe',
  +parryMassMultiplier(bracedParryWeight(100, bmi(100, 220, 1070, 400), 1070, 1, BRC), 220, BRC).toFixed(2), 1);
// Already out-massing -> no prompt at all.
eq('braced no prompt when heavier', bmi(220, 100, 1070, 400), 0);
eq('braced no prompt at parity', bmi(200, 200, 1070, 400), 0);
// The pool clamps the ceiling - you cannot brace with stamina you do not have.
eq('braced clamped by pool', bmi(60, 220, 1070, 30), 30);

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

// -- ITEM WEIGHT: volume x density, in POUNDS (RULED 2026-07-30).
// Volumes are the volume of MATERIAL and run ~7x historical on purpose ("AOP
// armor is super thick and heavy"). Density is per-MATERIAL and deliberately
// NOT derived from rarity.
const WCFG = {
  slotVolume: { chest: 6, legs: 6, head: 2, boots: 2, bracers: 2, gloves: 2, back: 2, shield: 6 },
  materialDensity: { metal: 10.49, leather: 0.95, cloth: 0.30, wood: 0.70, bone: 1.80, crystal: 2.60, gem: 4.00, jewelry: 10.49 },
  materialSpeciesDensity: { fulgurite: 10.49, steel: 7.85, gold: 19.30 },
  volumelessMaterials: ['jewelry'],
  weaponWeights: { dagger: 60, sword: 100, greatsword: 200, greataxe: 220, shield: 100 },
  weaponVolumeDivisor: 100,
};
const iw = (o) => itemWeightLb({ ...o, cfg: WCFG });
eq('weight: fulgurite chest', iw({ slot: 'chest', material: 'metal' }), 138.8);
eq('weight: fulgurite helm', iw({ slot: 'head', material: 'metal' }), 46.3);
eq('weight: leather boots', iw({ slot: 'boots', material: 'leather' }), 4.2);
eq('weight: cloth robe', iw({ slot: 'chest', material: 'cloth' }), 4);
// A shield is resolved by TAG - they live in the weaponry slot, so a slot
// lookup alone would price one as a weapon.
eq('weight: shield by tag not slot',
   iw({ slot: 'weaponry', material: 'metal', tags: ['weapon', '1H', 'shield'] }), 138.8);
// Weapons take volume from weaponWeights so mass cannot drift from celerity.
eq('weight: dagger', iw({ slot: 'weaponry', material: 'metal', tags: ['dagger'] }), 13.9);
eq('weight: greataxe', iw({ slot: 'weaponry', material: 'metal', tags: ['greataxe'] }), 50.9);
eq('weight: heaviest weapon tag wins',
   iw({ slot: 'weaponry', material: 'metal', tags: ['dagger', 'greatsword'] }),
   iw({ slot: 'weaponry', material: 'metal', tags: ['greatsword'] }));
// Species overrides the class default.
eq('weight: steel species is lighter than fulgurite',
   iw({ slot: 'chest', material: 'metal', species: 'steel' }) < iw({ slot: 'chest', material: 'metal' }), true);
// No resolvable volume -> 0, so callers leave jewelry and tools alone rather
// than zeroing an authored value.
eq('weight: unknown slot is zero', iw({ slot: 'ring', material: 'leather' }), 0);
// Jewellery has no volume model - a circlet is ornament, not a helmet's
// worth of metal. It keeps its authored weight instead.
eq('weight: jewellery in an armour slot is volumeless',
   iw({ slot: 'head', material: 'jewelry' }), 0);
eq('weight: no material still resolves via metal default', iw({ slot: 'chest' }) > 0, true);
// RARITY MUST NOT MATTER. A crude and a masterwork fulgurite helm weigh the
// same - craftsmanship shows up in armour value, not mass.
eq('weight: identical regardless of quality',
   iw({ slot: 'head', material: 'metal' }), iw({ slot: 'head', material: 'metal' }));

// THE CALIBRATION ANCHOR: John's harness. 22 L of fulgurite + leather boots.
// He was AT capacity when he crafted it and took leather boots rather than
// metal to stay under.
const johnMetal = iw({ slot: 'chest', material: 'metal' }) + iw({ slot: 'legs', material: 'metal' })
  + iw({ slot: 'weaponry', material: 'metal', tags: ['shield'] })
  + iw({ slot: 'bracers', material: 'metal' }) + iw({ slot: 'head', material: 'metal' });
const johnTotal = johnMetal + iw({ slot: 'boots', material: 'leather' });
eq('John harness is 22 L of fulgurite', Math.round(johnTotal), 513);
eq('John at str 311 (cap 778 lb) is under capacity', johnTotal < 778, true);
eq('John at str 205 (cap 513 lb) is exactly at capacity', Math.round(johnTotal) <= 513, true);
// Metal boots would have tipped him over - the choice he actually made.
const johnMetalBoots = johnMetal + iw({ slot: 'boots', material: 'metal' });
eq('metal boots would have put John over', johnMetalBoots > 513, true);
// Gold would have required str 376 at crafting time, above his CURRENT 311,
// so the story rules it out.
const johnGold = 22 * 19.30 * KG_TO_LB + iw({ slot: 'boots', material: 'leather' });
eq('gold density is impossible for John', johnGold / 2.5 > 311, true);

// -- SPATIAL STORAGE (RULED 2026-07-30). Folded space: contents weigh nothing
// to the carrier. Capacity is AUGMENT-GRANTED (a two-slot augment writes
// spatialCapacity onto the host via deriveItemStats), so there is no pure
// capacity formula to test here - only what lands on your back.
// -- carriedWeightLb: what actually lands on your back.
const RING = 'ring1', BAG = 'bag1';
const inv = [
  { id: 'armour', weight: 139, quantity: 1, storedIn: '' },
  { id: 'spare',  weight: 139, quantity: 1, storedIn: RING },
  { id: 'ore',    weight: 10,  quantity: 5, storedIn: RING },
  { id: RING,     weight: 0.1, quantity: 1, storedIn: '' },
];
eq('carried: stored items weigh nothing while the ring is equipped',
   carriedWeightLb(inv, [RING]), 139.1);
// THE LOAD-BEARING RULE: unequip the ring and the contents come back.
eq('carried: unequipped storage drops its contents on your back',
   carriedWeightLb(inv, []), 328.1);
eq('carried: quantity is respected',
   carriedWeightLb([{ id: 'x', weight: 10, quantity: 5, storedIn: '' }], []), 50);
// NO LAUNDERING BY NESTING. A bag inside the ring is not itself equipped, so
// whatever is in the BAG still weighs - only the bag's own mass is hidden.
const nested = [
  { id: BAG,    weight: 2,  quantity: 1, storedIn: RING },
  { id: 'loot', weight: 80, quantity: 1, storedIn: BAG },
  { id: RING,   weight: 0.1, quantity: 1, storedIn: '' },
];
eq('carried: nesting cannot launder weight away', carriedWeightLb(nested, [RING]), 80.1);
// Both equipped is a legitimate two-storage setup, not an exploit.
eq('carried: two equipped storages both work', carriedWeightLb(nested, [RING, BAG]), 0.1);
// A storage not on the actor at all cannot hide anything.
eq('carried: storedIn pointing at nothing still weighs',
   carriedWeightLb([{ id: 'a', weight: 50, quantity: 1, storedIn: 'ghost' }], [RING]), 50);
eq('carried: empty inventory', carriedWeightLb([], [RING]), 0);

/* ---------------------------------------------------------------- */
/*  systems/damage.mjs - the resolution pipeline                     */
/* ---------------------------------------------------------------- */
// GOLDEN: the five live margin-rule verifications of 2026-07-31, hand-checked
// against the chat cards at the time (design-defense-rework-2026-07). These are
// the numbers the table actually produced, so any drift in the chain breaks
// them - which is the whole point of extracting it out of the chat hook.

// Test 1 - THE ORDERING PROOF. Gabriel -> Khalid: raw 886, armour 604, DR 87,
// margin 1 - 825/1202. Post-wall the margin scales 195 down to 61 and Khalid
// drops 731 -> 670. PRE-wall the same swing was 886 x 0.3136 = 278 - 604 = ZERO,
// i.e. Khalid would have been immune. That reversal is why the order is fixed.
const t1 = resolveDamage({
  incoming: 886, mitigation: 604, drValue: 87,
  margin: 0.3136439267886856, health: 731,
});
eq('damage: post-wall margin lands 61 (live card)', t1.hpLoss, 61);
eq('damage: post-wall margin leaves 670 hp (live card)', t1.newHealth, 670);
eq('damage: armour reduction reported', t1.mitigated, 604);
eq('damage: DR reduction reported', t1.drReduced, 87);

// Test 3 - defence DECLINED (margin absent = 1). Raw 601 fully stopped by 604
// armour: the old pre-margin behaviour, reproduced exactly.
const t3 = resolveDamage({ incoming: 601, mitigation: 604, drValue: 0, health: 500 });
eq('damage: no margin, wall eats it', t3.hpLoss, 0);
eq('damage: absent margin turns nothing aside', t3.marginTurned, 0);

// Test 2 - full avoidance clamps the margin to 0, so nothing lands even though
// the blow would otherwise have cleared the wall.
const t2 = resolveDamage({ incoming: 2000, mitigation: 100, margin: 0, health: 900 });
eq('damage: margin 0 is a clean miss', t2.hpLoss, 0);
eq('damage: margin 0 still leaves hp untouched', t2.newHealth, 900);

// Barrier eats first and takes NO toughness/DR on its portion.
// A barrier smaller than the blow is spent entirely and the remainder goes on
// to face armour and DR normally.
const tb = resolveDamage({ incoming: 500, barrier: 200, mitigation: 100, drValue: 50, health: 400 });
eq('damage: barrier absorbs first', tb.barrierAbsorbed, 200);
eq('damage: barrier remainder faces the wall', tb.hpLoss, 150);
eq('damage: spent barrier is flagged broken', tb.barrierBroke, true);
// A barrier bigger than the blow survives with the difference intact.
const tbs = resolveDamage({ incoming: 500, barrier: 800, mitigation: 100, health: 400 });
eq('damage: oversized barrier survives', tbs.barrierBroke, false);
eq('damage: oversized barrier keeps the remainder', tbs.barrierRemaining, 300);
eq('damage: nothing reaches hp through a big barrier', tbs.hpLoss, 0);

// Overhealth sits AFTER the margin, so it soaks only what actually landed.
const to = resolveDamage({ incoming: 1000, mitigation: 200, margin: 0.5, overhealth: 300, health: 600 });
eq('damage: margin applies before overhealth', to.overhealthAbsorbed, 300);
eq('damage: overhealth then hp', to.hpLoss, 100);

// Mark amplifies the RAW blow, before any mitigation.
eq('damage: mark scales the raw blow', applyMarkBonus(500, 0.2), 600);
eq('damage: no mark is identity', applyMarkBonus(500, 0), 500);
const tm = resolveDamage({ incoming: 500, markBonus: 0.2, mitigation: 100, health: 900 });
eq('damage: marked damage clears more wall', tm.hpLoss, 500);

// Axe wear is anchored to what the armour STOPPED, never to the target's kit.
const tw = resolveDamage({ incoming: 1000, mitigation: 400, drValue: 100, health: 900 });
eq('damage: durability leak is what got through', durabilityDamage(tw, { mitigation: 400 }).leaked, 500);
eq('damage: axe wear is 10% of what was stopped',
   durabilityDamage(tw, { mitigation: 400, wearRate: 0.1 }).wear, 50);
eq('damage: no wear rate, no wear', durabilityDamage(tw, { mitigation: 400 }).wear, 0);

/* ---------------------------------------------------------------- */
/*  Magic/melee unification - spell cast weight + windup             */
/* ---------------------------------------------------------------- */
// THE LOAD-BEARING PROPERTY: windup 1 makes strikeInvestDamage identical to
// spellInvestDamage. If that ever stops being true, switching the model off
// silently changes every spell in the game.
const SW_INT = 651, SW_MULT = 0.7, SW_INVEST = 40, SW_REF = 20;
eq('spellweight: windup 1 makes strike == spell (the off-switch)',
   strikeInvestDamage(SW_INT, SW_MULT, 1, SW_INVEST, SW_REF),
   spellInvestDamage(SW_INT, SW_MULT, SW_INVEST, SW_REF));

const SWCFG = (model, extra = {}) => ({
  spellWeight: { model, tierGatedImplements: false, windupMaxSpell: null, ...extra },
  spellTierWeights: { basic: 130, high: 150, greater: 200, major: 400, grand: 700 },
  defenseTuning: { windupMin: 0.5, windupMax: 3.0 },
});
eq('spellweight: model off returns 0 weight', spellCastWeight('greater', 140, SWCFG('none')), 0);
eq('spellweight: model off returns windup 1', spellWindupMultiplier('greater', 140, SWCFG('none')), 1);
eq('spellweight: tier model ignores the implement', spellCastWeight('greater', 140, SWCFG('tier')), 200);
eq('spellweight: implement model adds the focus', spellCastWeight('greater', 140, SWCFG('implement')), 340);
eq('spellweight: bare-handed implement model is tier only', spellCastWeight('greater', 0, SWCFG('implement')), 200);
eq('spellweight: unknown tier yields no weight', spellCastWeight('', 140, SWCFG('implement')), 0);
// wand(40)+basic(130) = 170 -> 1.7; staff(140)+high(150) = 290 -> 2.9
eq('spellweight: wand basic windup', spellWindupMultiplier('basic', 40, SWCFG('implement')), 1.7);
eq('spellweight: staff high windup', spellWindupMultiplier('high', 140, SWCFG('implement')), 2.9);
// THE CLAMP. staff(140)+greater(200) = 340 wants 3.4 but the shipped ceiling is
// 3.0 - wait keeps scaling while damage stops, so heavy casting LOSES dpr.
eq('spellweight: shipped clamp caps staff+greater at 3.0',
   spellWindupMultiplier('greater', 140, SWCFG('implement')), 3.0);
eq('spellweight: windupMaxSpell unlocks it',
   spellWindupMultiplier('greater', 140, SWCFG('implement', { windupMaxSpell: 99 })), 3.4);
eq('spellweight: staff+grand unlocked is 8.4',
   spellWindupMultiplier('grand', 140, SWCFG('implement', { windupMaxSpell: 99 })), 8.4);
// Floor still applies to anything absurdly light.
eq('spellweight: windupMin floors the result',
   spellWindupMultiplier('basic', 0, { ...SWCFG('implement'), spellTierWeights: { basic: 10 } }), 0.5);

/* ── STACKS (systems/stacks.mjs) ───────────────────────────────────────── */
// Linear is the RULED default: spreading five fields across five targets and
// dumping all five into one must deal the SAME total, so the choice is breadth
// vs burst rather than an efficiency trap.
eq('stacks: linear scaling, one stack', stackDamageMultiplier(1, 1), 1);
eq('stacks: linear scaling, five stacks', stackDamageMultiplier(5, 1), 5);
// Dreams of Light: payload is the conjure's damage split five ways, so a full
// dump must reconstitute the whole cast. 2493 live / 5 = 498.6 per field.
eq('stacks: a full dump reconstitutes the cast', Math.round(498.6 * stackDamageMultiplier(5, 1)), 2493);
// ⚠ Spending ONE stack is 1x at EVERY scaling. `spent * scaling` would have
// silently halved a single-stack spend at 0.5 — the reason the form is an
// exponent, not a factor.
eq('stacks: one stack is 1x under concavity too', stackDamageMultiplier(1, 0.5), 1);
eq('stacks: concave scaling, four stacks', stackDamageMultiplier(4, 0.5), 2);
eq('stacks: zero spend is zero effect', stackDamageMultiplier(0, 1), 0);
eq('stacks: negative spend cannot pay out', stackDamageMultiplier(-3, 1), 0);
// Range gating.
eq('stacks: empty pool cannot fire', spendableRange(0, 1, 0).max, 0);
eq('stacks: pool below cost cannot fire', spendableRange(2, 3, 0).max, 0);
eq('stacks: no maxSpend means spend everything', spendableRange(5, 1, 0).max, 5);
eq('stacks: maxSpend caps the activation', spendableRange(5, 1, 3).max, 3);
eq('stacks: maxSpend below cost still allows the cost', spendableRange(5, 2, 1).max, 2);
eq('stacks: exactly enough is spendable', spendableRange(3, 3, 0).max, 3);

/* ── STACK SPREAD: fields + targets <= budget (user 2026-08-03) ─────────── */
// The whole ladder Willy described, at budget 6. Every row is ONE action.
const spread = (pairs, budget = 6, pool = 5) =>
  clampSpread(pairs.map((f, i) => ({ id: `t${i}`, fields: f })), budget, pool)
    .map(a => a.fields);
eq('spread: 5 at one target', JSON.stringify(spread([5])), '[5]');
eq('spread: 4 across two', JSON.stringify(spread([2, 2])), '[2,2]');
eq('spread: 3 across three', JSON.stringify(spread([1, 1, 1])), '[1,1,1]');
eq('spread: uneven 3-and-1 across two is legal', JSON.stringify(spread([3, 1])), '[3,1]');
// "max use of 5 fields per action on single target" falls out of the rule
// rather than being a separate constant.
eq('spread: single-target max is budget-1', maxSingleTargetFields(6, 99), 5);
eq('spread: single-target max is capped by the pool', maxSingleTargetFields(6, 3), 3);
eq('spread: no budget means the pool is the only limit', maxSingleTargetFields(0, 4), 4);
// Over-budget trims from the LARGEST pile, so the loss is shared.
eq('spread: 5-and-1 is 7 over a 6 budget, trims to 3-and-1',
   JSON.stringify(spread([5, 1])), '[3,1]');
eq('spread: 4 across three is 7, trims to 1 each', JSON.stringify(spread([2, 1, 1])), '[1,1,1]');
eq('spread: 3-3 across two trims to 4 total', JSON.stringify(spread([3, 3])), '[2,2]');
// The pool is a harder limit than the budget.
eq('spread: cannot spend more than held', JSON.stringify(spread([5], 6, 2)), '[2]');
eq('spread: empty assignment stays empty', JSON.stringify(spread([0, 0])), '[]');
// ⚠ THE LADDER CAPS AT THREE TARGETS, and nobody had to decide that — every
// target needs at least one field, so F >= T, and F + T <= 6 then forces
// T <= 3. A fourth target would need F >= 4 with only 2 fields of budget left.
// That is exactly the three cases described: 5-at-one, 4-at-two, 3-at-three.
eq('spread: six targets at 1 each collapses to the 3-target cap',
   spread([1, 1, 1, 1, 1, 1], 6, 6).length, 3);
eq('spread: four targets cannot coexist at budget 6',
   spread([1, 1, 1, 1], 6, 5).length, 3);

/* ── THE INVEST CURVE (config invest.curveExponent) ────────────────────── */
// One exponent behind every commit-more-for-more in the game. Shipped at 0.2;
// these pin BOTH that the default is unchanged and that the knob works, so a
// whole-economy sim can be run without forking the formula.
const C05 = { invest: { curveExponent: 0.5 } };
const C02 = { invest: { curveExponent: 0.2 } };
eq('curve: default is 0.2', investCurve({}), 0.2);
eq('curve: config drives it', investCurve(C05), 0.5);
eq('curve: a broken value falls back rather than zeroing damage', investCurve({ invest: { curveExponent: 0 } }), 0.2);
// Explicit 0.2 must equal the shipped default exactly — this is the off-switch.
eq('curve: explicit 0.2 == shipped default (strike)',
   strikeInvestDamage(500, 1, 2, 160, 20, C02), strikeInvestDamage(500, 1, 2, 160, 20));
eq('curve: explicit 0.2 == shipped default (spell)',
   spellInvestDamage(500, 1, 160, 20, C02), spellInvestDamage(500, 1, 160, 20));
// 8x the commitment: 1.52x at 0.2, 2.83x at sqrt.
eq('curve: 0.2 gives 8x invest -> 1.52x', strikeInvestDamage(1000, 1, 1, 160, 20, C02), 1516);
eq('curve: sqrt gives 8x invest -> 2.83x', strikeInvestDamage(1000, 1, 1, 160, 20, C05), 2828);
eq('curve: one unit of invest is unchanged by the curve',
   strikeInvestDamage(1000, 1, 1, 20, 20, C05), strikeInvestDamage(1000, 1, 1, 20, 20, C02));

/* ── HEALING BLEND (design-healer-system.md) ───────────────────────────── */
// THE CASTING RESOURCE IS THE MODE. Golden stats are Harvey McKay's, live:
// vit 444, wis 811, int 243, str 161.
const HEALCFG = {
  healing: { blends: {
    mana:    { primary: 'wisdom',   pw: 0.6, secondary: 'intelligence', sw: 0.4 },
    health:  { primary: 'vitality', pw: 0.6, secondary: 'wisdom',       sw: 0.4 },
    stamina: { primary: 'wisdom',   pw: 0.6, secondary: 'strength',     sw: 0.4 },
  } },
};
const HARVEY = {
  vitality: { mod: 444 }, wisdom: { mod: 811 },
  intelligence: { mod: 243 }, strength: { mod: 161 },
};
eq('heal blend: cleric  = .6wis+.4int', healStatBlend(HARVEY, 'mana', HEALCFG), 584);
eq('heal blend: vitality= .6vit+.4wis', healStatBlend(HARVEY, 'health', HEALCFG), 591);
eq('heal blend: aura    = .6wis+.4str', healStatBlend(HARVEY, 'stamina', HEALCFG), 551);
// An unknown mode heals for NOTHING rather than silently falling back to a
// blend that flatters the caster — a wrong mode should be obvious at the table.
eq('heal blend: unknown mode is zero', healStatBlend(HARVEY, 'barrier', HEALCFG), 0);
eq('heal blend: missing abilities are zero', healStatBlend({}, 'mana', HEALCFG), 0);
// All three are wisdom-led, so a dedicated healer is strong in every mode and
// the modes differ in their SECOND stat, not their identity.
eq('heal blend: every mode is wisdom-led for a wis specialist',
   healStatBlend(HARVEY, 'mana', HEALCFG) > 500
   && healStatBlend(HARVEY, 'health', HEALCFG) > 500
   && healStatBlend(HARVEY, 'stamina', HEALCFG) > 500, true);
// The unified heal IS the damage function with the blend swapped in.
// Harvey, high tier (windup 1.5), rarity 1, invest 40 vs ref 20, sqrt curve.
eq('unified heal == strikeInvestDamage with a healing blend',
   strikeInvestDamage(healStatBlend(HARVEY, 'mana', HEALCFG), 1, 1.5, 40, 20,
     { invest: { curveExponent: 0.5 } }),
   Math.round(584 * 1.5 * Math.SQRT2));

// THE HEALING COEFFICIENT rides the RARITY multiplier, not the blend. RULED
// 2026-08-03: a basic heal should be about a THIRD of an average same-level
// health bar. Calibrated live against average PC health 670 -> target 223.
// Common rarity 0.6, staff basic windup 2.7, typical healer blend 524:
eq('heal coefficient: common basic with a staff is ~1/3 of a 670 bar',
   strikeInvestDamage(524, 0.6 * 0.25, 2.7, 20, 20, { invest: { curveExponent: 0.5 } }), 212);
// The ladder: high ~1.5x basic, greater ~2.5x. Greater is nearly a full bar,
// which is what an 80-mana long cast should buy.
eq('heal coefficient: greater is ~2.5x basic',
   Math.round(strikeInvestDamage(524, 0.6 * 0.25, 3.4, 80, 20, { invest: { curveExponent: 0.5 } })
            / strikeInvestDamage(524, 0.6 * 0.25, 2.7, 20, 20, { invest: { curveExponent: 0.5 } }) * 10) / 10,
   2.5);

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll pure-function tests pass.');

