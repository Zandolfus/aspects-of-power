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
  spellCastWeight, spellWindupMultiplier, investCurve, healStatBlend, convertResources,
  effectiveDodgeValue, splitEvenlyWithRemainder, perceiveGateDecision, activityTicks, nextCompletionDelta,
  proficiencyMultiplier, proficiencyHitMultiplier, parryMassMultiplier, lunarPhaseMultiplier, dotTickDamage, procStaminaCost, riderDamageBase,
  crushFlatAmount, riderMaxInvest, itemWeightLb, KG_TO_LB, carriedWeightLb,
  bracedParryWeight, bracedMaxUsefulInvest, defenceMarginMultiplier,
  buffCapacity, buffCost, buffLoadByAbility, buffDefenceCost, buffModCost,
  abilityMod, abilityModTotal, abilityPostCurveFactors, abilityValues,
  gradeMultiplierFor, solveBuffScale,
  resolveBuffLoad, auraRadiusFor, barrierStatBlend, hotTickAmount,
} from '../module/helpers/formulas.mjs';
import * as F2 from '../module/helpers/formulas.mjs';
import { summonEquipmentBudget, parseStatSplit, distributeStatBudget } from '../module/helpers/formulas.mjs';
import {
  HEX_SIZE_FT, EDGES, OPPOSITE_EDGE, hexApothemFt, hexWidthFt, hexHeightFt,
  hexCentreWorld, hexFromWorldFt, neighbour, edgeBetween, hexDistance,
  hexesWithin, worldFtFromPixels, offsetFromCentre, nearestEdge, verifyStampOrigin,
  sceneIdFromRegionUuid,
} from '../module/helpers/hexgrid.mjs';
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

// ── RANGED BLEND: perception must be an OFFENCE stat (slope 0.95, 2026-08-10) ──
// It used to top out at 0.57 attacking against 0.77 defending, so an archer got
// more from perception by dodging than by shooting. Melee never had that: str
// runs to 1.00 attacking against 0.23 defending.
{
  const CFGLIVE = (await import('../module/helpers/config.mjs')).ASPECTSOFPOWER;
  const rb = CFGLIVE.rangedBlend;
  // Positive control: read the real object, not a regex over source, and prove
  // it actually arrived before asserting anything about its contents.
  eq('ranged blend: config loads', Number.isFinite(rb?.perFloor) && Number.isFinite(rb?.slope), true);
  const floor = rb.perFloor, slope = rb.slope;
  eq('ranged blend: floor stays low for the dex skirmisher', floor, 0.05);
  eq('ranged blend: reaches melee\'s ceiling', +(floor + slope).toFixed(2), 1.00);
  const R = { rangedBlend: { perFloor: floor, slope, weightOffset: 50, weightSpan: 200 } };
  const M = { str: 0, dex: 1000, per: 0 };   // pure dex reads back the dex share
  // Light thrown/pistol weight stays DEX-led - this is what keeps the Treewalker
  // and the Harrier buildable rather than taxed 7-11%.
  eq('ranged: throwing weight is 95% dex', weaponStatBlend(50, M, true, R).blend, 950);
  eq('ranged: shortbow is still dex-led', weaponStatBlend(70, M, true, R).blend, 855);
  // Heavy precision weapons finally lean on aim, which the old spec claimed
  // and the old numbers did not deliver (longbow was 46% per).
  // 238 and 47, not the 240/50 the rounded display table suggests — the
  // 0.05 + 0.95 sum lands a hair under 1 in floating point.
  eq('ranged: longbow is per-led', weaponStatBlend(200, M, true, R).blend, 238);
  eq('ranged: rifle is nearly all aim', weaponStatBlend(240, M, true, R).blend, 47);
  // ⚠ A weapon type is only real if it is in BOTH registries — weaponWeights
  // for the maths and craftItemTypes for the tag autocomplete. `orb` was in
  // neither-enough and its whole mechanic never ran.
  eq('throwing: has a weight', CFGLIVE.weaponWeights.throwing, 50);
  eq('throwing: is authorable', typeof CFGLIVE.craftItemTypes.throwing, 'object');
  eq('throwing: carries its own tag', CFGLIVE.craftItemTypes.throwing.tags.includes('throwing'), true);
  eq('throwing: sits in the weaponry slot', CFGLIVE.craftItemTypes.throwing.slot, 'weaponry');
}

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
// CO-INVEST is the general form of that same term, so the generalisation is
// only honest if the mana case is BYTE-IDENTICAL to the golden infusion above.
eq('co-invest == infusion (mana, Aiden)', F2.coInvestDamage(759, 0.7, 32, 20, CURVE_02), 584);
eq('co-invest alias is the same function', F2.infusionDamage === F2.coInvestDamage, true);
// The other two pools, same live actor set (golden_baseline): the coefficient
// is the ONLY difference, which is what makes it the balance dial.
//   effort  = George str888 x 0.5, 39 stamina, ref 25 (grade D basic)
//   drain   = Willy  int672 x 1.0, 57 health,  ref 25
eq('co-invest effort George', F2.coInvestDamage(888, 0.5, 39, 25), 555);
eq('co-invest life-drain Willy', F2.coInvestDamage(672, 1.0, 57, 25), 1015);
// A pool that cannot pay the base still floors at 1 rather than dividing by 0.
eq('co-invest zero invest floors', F2.coInvestDamage(500, 1.0, 0, 25), 100);

// Co-invest cap: baseCost + capStat x aboveBaseFactor, clamped by the pool.
// Aiden, basic tier: base 25 + wis238 x 0.05 = 36.9 -> 37, pool 418 doesn't bite.
eq('coInvestCap Aiden basic', F2.coInvestCap(25, 238, 0.05, 418), 37);
// â šThe POOL is the binding constraint far more often than the wis cap â€” a
// nearly-dry actor must never be offered a slider they cannot pay.
eq('coInvestCap pool binds', F2.coInvestCap(25, 238, 0.05, 12), 12);
eq('coInvestCap empty pool', F2.coInvestCap(25, 238, 0.05, 0), 0);
// Negative pool (health already below the floor) must clamp to 0, not go
// negative and hand the slider a backwards range.
eq('coInvestCap negative pool', F2.coInvestCap(25, 238, 0.05, -5), 0);

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
// ⚠⚠ THE GOLDEN CARDS BELOW ARE FLAT-ARMOUR MEASUREMENTS. Armour became
// PROPORTIONAL on 2026-08-10 (defenseTuning.armourModel = 'ratio'), so these
// are pinned EXPLICITLY to the legacy model rather than left to ride whatever
// the default happens to be. They remain true statements about the flat chain,
// which still ships and is still revertable - and pinning them is the lesson
// from the invest exponent, where a green suite quietly asserted a superseded
// value for weeks. Ratio-model goldens follow in their own block.
globalThis.CONFIG = globalThis.CONFIG ?? {};
globalThis.CONFIG.ASPECTSOFPOWER = globalThis.CONFIG.ASPECTSOFPOWER ?? {};
globalThis.CONFIG.ASPECTSOFPOWER.defenseTuning = { armourModel: 'flat' };
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

// ── AFFINITY RESIST SITS BEHIND THE BARRIER (moved 2026-08-10) ──
// A ward stands in front of you and eats the strike, so your own resistance is
// never tested on the portion it absorbed. This is the ONE thing the move
// changes — among the flat reductions the order is arithmetically irrelevant,
// so a barrier is the only way to observe it. Nothing covered this before the
// move, which is why the suite stayed green through a real behaviour change.
const tar = resolveDamage({ incoming: 500, barrier: 300, affinityResist: 100, mitigation: 50, health: 400 });
eq('damage: barrier eats the UN-resisted blow', tar.barrierAbsorbed, 300);
eq('damage: resist applies to what got past the ward', tar.affinityResisted, 100);
eq('damage: post-barrier resist then wall', tar.hpLoss, 50);   // 500-300=200, -100 resist, -50 armour
// ⚠ NEGATIVE CONTROL for the old order. Pre-barrier resist would have left
// 400 for a 300 barrier to eat, so only 100 would reach the wall and hpLoss
// would be 50 with the barrier SURVIVING. Pin that the ward is spent instead.
eq('damage: the ward is spent, not spared by resistance', tar.barrierBroke, true);
eq('damage: resistance does not protect the ward', tar.barrierRemaining, 0);
// With no barrier in play the move is a no-op: all four reductions are flat
// and clamp at zero, so only their SUM matters.
const tan = resolveDamage({ incoming: 500, affinityResist: 100, mitigation: 50, drValue: 25, augDR: 25, health: 400 });
eq('damage: order-free without a barrier', tan.hpLoss, 300);

// ── DEFENCE WEIGHTS MUST SUM TO ONE, LIKE THE ATTACK BLEND'S ──
// The property, not the arithmetic: a character with perfectly FLAT stats must
// have a dodge basis equal to their own attack blend, so a mirror match sits at
// 1.0x. Before normalising it sat at 1.30x against a roll that bridges 1.307x
// — flat stats were one thousandth from self-immunity.
{
  const DT = { secondaryWeight: 0.3, defenceInflation: 1.1 };
  const FLAT = 1000;
  const dodgeBasis = F2.defenceValue(FLAT, FLAT, DT) / 1.1;   // dodgeBasisDiv
  const attackBlend = weaponStatBlend(100, { str: FLAT, dex: FLAT, per: FLAT }, false, CFG).blend;
  eq('defence: flat stats give a 1.0 mirror', Math.round(dodgeBasis), attackBlend);
  // ⚠ NEGATIVE CONTROL — the un-normalised form is what we are moving away
  // from. Pin the old number so nobody "restores" it without seeing the ratio.
  const oldWay = Math.round((FLAT + FLAT * 0.3) * 1.1) / 1.1;
  eq('defence: the OLD weights summed to 1.30', +(oldWay / attackBlend).toFixed(2), 1.30);
  // A pure specialist still beats a balanced attacker - normalising bounds the
  // edge, it does not remove it.
  eq('defence: specialists still gain', F2.defenceValue(1200, 400, DT) > F2.defenceValue(1000, 1000, DT), true);
  // The normaliser is DERIVED from secondaryWeight, so changing one knob keeps
  // the sum at 1. A hardcoded 1.3 would silently break here.
  const DT2 = { secondaryWeight: 0.5, defenceInflation: 1.1 };
  eq('defence: normaliser tracks secondaryWeight',
    Math.round(F2.defenceValue(FLAT, FLAT, DT2) / 1.1), FLAT);
  eq('defence: zero secondary is the primary alone',
    Math.round(F2.defenceValue(FLAT, 0, { secondaryWeight: 0, defenceInflation: 1 })), FLAT);
}

// ── PROPORTIONAL ARMOUR (ruled 2026-08-10) ──
// Runs on the LIVE default, not the pinned flat block above.
{
  const prevDT = globalThis.CONFIG.ASPECTSOFPOWER.defenseTuning;
  globalThis.CONFIG.ASPECTSOFPOWER.defenseTuning = { armourModel: 'ratio', armourRatioCoef: 3.96 };
  const RT = { armourModel: 'ratio', armourRatioCoef: 3.96 };

  // THE ANCHOR: George 1498 into Phil's wall of 1120 must land where FLAT
  // armour already puts it, or the matchup used to judge the game by feel
  // moves under everyone's feet.
  // 378 - IDENTICAL to what flat armour gives on this matchup, which is what
  // solving the coefficient against it was for.
  eq('armour ratio: the live anchor is preserved', F2.armourRatioApplied(1498, 1120, RT), 378);
  eq('armour ratio: anchor equals the FLAT result exactly', F2.armourRatioApplied(1498, 1120, RT), Math.max(0, 1498 - 1120));
  // ⚠⚠ SCALE INVARIANCE - the entire reason for this shape. Double both sides
  // and the result doubles, so an E-vs-E fight and an S-vs-S fight are the
  // same fight. A fixed-K absorption model CANNOT do this.
  eq('armour ratio: doubling both doubles the result',
    F2.armourRatioApplied(2996, 2240, RT), 2 * F2.armourRatioApplied(1498, 1120, RT));
  eq('armour ratio: x3.05 (E->S grade jump) holds',
    F2.armourRatioApplied(Math.round(1498 * 3.05), Math.round(1120 * 3.05), RT),
    Math.round(3.05 * F2.armourRatioApplied(1498, 1120, RT)) + 1);   // +1 = rounding
  // NO ZEROES. This is the defect it exists to remove: under flat armour a 487
  // hit on a 1120 wall was exactly nothing, forever.
  eq('armour ratio: a weak hit still chips', F2.armourRatioApplied(487, 1120, RT) > 0, true);
  eq('armour ratio: flat control - the same hit was ZERO', Math.max(0, 487 - 1120), 0);
  // Degenerate ends must not blow up.
  eq('armour ratio: no armour means full damage', F2.armourRatioApplied(900, 0, RT), 900);
  eq('armour ratio: no damage stays none', F2.armourRatioApplied(0, 1120, RT), 0);
  // Absorbed share falls as the blow grows - plate turns a knife, not an axe.
  const share = (r) => 1 - F2.armourRatioApplied(r, 1120, RT) / r;
  eq('armour ratio: a knife is mostly stopped', share(400) > 0.9, true);
  eq('armour ratio: a heavy blow overwhelms it', share(8000) < 0.4, true);
  eq('armour ratio: absorption is monotonic in blow size', share(400) > share(8000), true);

  // And through the real pipeline: the wall is the SUM of the flat layers.
  const rr = resolveDamage({ incoming: 1498, mitigation: 912, drValue: 208, health: 2000 });
  eq('damage: ratio model sums the layers into one wall', rr.hpLoss, 378);
  eq('damage: absorbed is reported as one figure', rr.mitigated, 1498 - 378);
  // ⚠ THE CARD MUST NOT READ AS A FLAT SUBTRACTION. On the anchor hit the
  // absorbed amount coincidentally equals the wall (1498 -> 378 absorbs exactly
  // 1120), so a bare "-1120" looked identical to the model we replaced. The
  // line has to name the blow it came out of.
  const line = rr.parts.find(x => x.startsWith('Armor'));
  eq('damage: card shows the blow, not just the cut', /of 1498/.test(line), true);
  eq('damage: card shows the absorbed share', /75% absorbed/.test(line), true);
  eq('damage: card names the wall', /wall 1120/.test(line), true);

  // The barrier still goes FIRST - proportional armour did not disturb that.
  const rb = resolveDamage({ incoming: 1000, barrier: 400, mitigation: 500, drValue: 0, health: 900 });
  eq('damage: barrier still absorbs before the wall', rb.barrierAbsorbed, 400);
  eq('damage: the wall only sees what the ward left', rb.hpLoss, F2.armourRatioApplied(600, 500, RT));

  globalThis.CONFIG.ASPECTSOFPOWER.defenseTuning = prevDT;
}

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
// One exponent behind every commit-more-for-more in the game. SHIPPED AT 0.5
// (sqrt), ruled 2026-08-03. These pin BOTH that the fallback tracks config and
// that the knob works, so a whole-economy sim can be run without forking the
// formula.
//
// ⚠⚠ THESE ASSERTED 0.2 UNTIL 2026-08-10 — the pre-ruling value. The config
// moved to 0.5 and neither the inline fallback in formulas.mjs nor this block
// followed, so the suite was GREEN WHILE ASSERTING HISTORY: it certified a
// default the game had stopped using. Found by the orphaned-reader sweep,
// which flagged the fallback/config mismatch; realigning the fallback is what
// made these fail. If the exponent is ever re-ruled, THREE things move
// together — config.mjs, the formulas.mjs fallback, and this block.
const C05 = { invest: { curveExponent: 0.5 } };
const C02 = { invest: { curveExponent: 0.2 } };
eq('curve: default is 0.5 (sqrt), matching config', investCurve({}), 0.5);
eq('curve: config drives it', investCurve(C05), 0.5);
eq('curve: an explicit 0.2 still works as a knob', investCurve(C02), 0.2);
eq('curve: a broken value falls back rather than zeroing damage', investCurve({ invest: { curveExponent: 0 } }), 0.5);
// Explicit 0.5 must equal the shipped default exactly — this is the off-switch.
eq('curve: explicit 0.5 == shipped default (strike)',
   strikeInvestDamage(500, 1, 2, 160, 20, C05), strikeInvestDamage(500, 1, 2, 160, 20));
eq('curve: explicit 0.5 == shipped default (spell)',
   spellInvestDamage(500, 1, 160, 20, C05), spellInvestDamage(500, 1, 160, 20));
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

/* ── RESOURCE CONVERSION (design-healer-system.md) ─────────────────────── */
const CONVCFG = { strain: { conversionDivisor: 7 } };
// rate = SOURCE per 1 DESTINATION. Stamina is the cheap resource: 5 buys 1.
eq('convert: 5 stamina buys 1 mana', convertResources(100, 5, 201, 'stamina', CONVCFG).gained, 20);
// Vitality is COMPRESSIBLE — 1 health buys 5 mana (rate 0.2).
eq('convert: 1 health buys 5 mana', convertResources(100, 0.2, 201, 'health', CONVCFG).gained, 500);
// ⚠ Health-sourced conversions charge NO strain — the health IS the price.
eq('convert: blood magic charges no strain', convertResources(100, 0.2, 201, 'health', CONVCFG).strain, 0);
// ANCHOR: Harvey (tough 201, mana 678) gaining 10% of his mana should cost
// ~5% strain — one hour of meditation traded for one hour of recovery.
const _harvey = convertResources(339, 5, 201, 'stamina', CONVCFG);
eq('convert: anchor — 10% mana costs ~5% strain', _harvey.gained, 67);
eq('convert: anchor strain rounds to 5%', Math.round(_harvey.strain * 100), 5);
// Toughness makes you better at it, rather than buying a free window.
eq('convert: double toughness halves the strain',
   Math.round(convertResources(339, 5, 402, 'stamina', CONVCFG).strain * 1000),
   Math.round(_harvey.strain * 500));
// Splitting a conversion cannot dodge the cost — this is why toughness
// divides rather than granting a per-cast allowance.
const _split = [1,2,3,4,5].reduce((s) => s + convertResources(100, 5, 201, 'stamina', CONVCFG).strain, 0);
eq('convert: five small casts cost the same as one big one',
   Math.round(_split * 10000), Math.round(convertResources(500, 5, 201, 'stamina', CONVCFG).strain * 10000));
eq('convert: nothing spent is nothing gained', convertResources(0, 5, 201, 'stamina', CONVCFG).gained, 0);
eq('convert: too little to buy one unit yields nothing',
   convertResources(4, 5, 201, 'stamina', CONVCFG).gained, 0);

// ── Heal over time ───────────────────────────────────────────
// A HoT trades certainty for total - it can be wasted if the target dies or
// overheals if they are topped up - so a full duration must beat the burst.
eq('hot: tick is roll x scale', hotTickAmount(240, 0.5).tick, 120);
eq('hot: 3 rounds at 0.5 totals 1.5x the burst', hotTickAmount(240, 0.5, 3).total, 360);
eq('hot: and that is more than casting it directly',
   hotTickAmount(240, 0.5, 3).total > 240, true);
// Faye's Rejuvenation as a HoT: 124 at basic, 0.5 over 3 rounds.
eq('hot: Rejuvenation tick', hotTickAmount(124, 0.5).tick, 62);
eq('hot: Rejuvenation total', hotTickAmount(124, 0.5, 3).total, 186);
// A one-round HoT is strictly worse than the burst, which is the honest
// trade - it should never be authored that way.
eq('hot: one round is worse than instant', hotTickAmount(240, 0.5, 1).total < 240, true);
eq('hot: no rounds is no total', hotTickAmount(240, 0.5, 0).total, 0);
eq('hot: nothing rolled is nothing healed', hotTickAmount(0, 0.5, 3).tick, 0);

// ── Barrier potency (barriers are casts, tier is the dial) ────────────────
// GOLDEN: live mods read 2026-08-03. Willy int 672 / wis 648 -> 660;
// Harvey int 243 / wis 811 -> 527; Gabriel int 262 / wis 379 -> 321.
const BCFG = { barrier: { blend: { primary: 'intelligence', secondary: 'wisdom',
                                   pw: 0.5, sw: 0.5 } } };
const mkIW = (i, w) => ({ intelligence: { mod: i }, wisdom: { mod: w } });
eq('barrier blend: Willy', barrierStatBlend(mkIW(672, 648), BCFG), 660);
eq('barrier blend: Harvey', barrierStatBlend(mkIW(243, 811), BCFG), 527);
eq('barrier blend: Gabriel', barrierStatBlend(mkIW(262, 379), BCFG), 321);
eq('barrier blend: missing abilities are zero', barrierStatBlend(null, BCFG), 0);
// ⚠ THE POINT OF THE BLEND: pure INT made the WARDERS (low int, high wis) far
// worse at warding than the artillery casters. Measured 2.48x; the blend puts
// them at parity. Harvey (int 243) out-blends Aiden (int 741, wis 214) only
// because his wisdom is the highest in the game.
const _bHarvey = barrierStatBlend(mkIW(243, 811), BCFG);
const _bAiden  = barrierStatBlend(mkIW(741, 214), BCFG);
eq('barrier blend: wisdom rescues the warder', _bHarvey > _bAiden, true);
eq('barrier blend: pure int would have inverted it', 243 < 741, true);
// The weights are a knob, and 0/100 collapses to a single stat.
eq('barrier blend honours config weights',
   barrierStatBlend(mkIW(100, 900),
     { barrier: { blend: { primary: 'intelligence', secondary: 'wisdom', pw: 1, sw: 0 } } }),
   100);

// ── Aura radius (the chanter's range envelope) ────────────────────────────
// GOLDEN: the two live auras and the real perception spread, read 2026-08-03.
// Mana Attraction is authored 20 ft on John (per.mod 463); Storm Stride 10 ft
// on Gabriel (per.mod 497). Roster perception runs 15 (Kevin) to 1029 (Frieda).
eq('aura: Mana Attraction on John', auraRadiusFor(20, 463), 29);
eq('aura: Storm Stride on Gabriel', auraRadiusFor(10, 497), 15);
eq('aura: a novice gets the authored radius', auraRadiusFor(20, 15), 20);
eq('aura: the highest perception in the world', auraRadiusFor(20, 1029), 41);
// ⚠ THE AUTHORED RADIUS IS A FLOOR — this is what a pure `per x factor` form
// gets wrong, handing low-perception characters a useless one-foot aura.
eq('aura: zero perception still gets the authored radius', auraRadiusFor(20, 0), 20);
// ⚠ SKILL IDENTITY SURVIVES AT EVERY LEVEL. Storm Stride's deliberately tight
// field stays exactly half Mana Attraction's, which the additive form
// (base + per/10) collapses to 60 vs 66 ft at these same perceptions.
eq('aura: the 2:1 design ratio holds at low perception',
   auraRadiusFor(20, 100) / auraRadiusFor(10, 100), 2);
// At the top end it is 2:1 up to WHOLE-FOOT ROUNDING (40.58 -> 41, 20.29 -> 20),
// which reads as 2.05. The ratio is exact before rounding; the additive form
// drifts to 1.1:1 for real, not by a rounding step.
eq('aura: and at the highest perception in the world',
   Math.abs(auraRadiusFor(20, 1029) / auraRadiusFor(10, 1029) - 2) < 0.1, true);
// Measured party clustering: median ally spacing is 9-35 ft on the combat maps
// and 50-95 ft on the sprawling ones. A 20 ft aura must cover the huddle at
// every level without ever covering a spread formation.
eq('aura: covers the tight huddle even for a novice', auraRadiusFor(20, 15) >= 15, true);
eq('aura: never reaches a spread formation, even at 1029',
   auraRadiusFor(20, 1029) < 88, true);
// No aura stays no aura — the radius is also the on/off switch.
eq('aura: no authored radius is no aura', auraRadiusFor(0, 1029), 0);
eq('aura: the divisor is a knob',
   auraRadiusFor(20, 1000, { auras: { perceptionDivisor: 100 } }), 220);

// ── Buff capacity (healer pillar phase 6) ─────────────────────────────────
// GOLDEN: ability values and buff amounts read off the live world 2026-08-03.
// Gabriel sums 3204 across his nine; Faye 1631. Buff amounts are the measured
// roll totals x each entry's authored multiplier.
// The stat curve, extracted from actor.prepareDerivedData so the buff cap can
// price a hypothetical value. GOLDEN: Faye's live wisdom 285 -> mod 380 at
// grade E (gradeMult 1), read from the world 2026-08-03.
const CURVECFG = { statCurve: { NORM: 1085, P: 0.8, MULT_BASE: 1.25,
                                gradeIndex: { G: 0, F: 0, E: 0, D: 1, S: 5 } } };
eq('abilityMod: the curve at NORM is NORM', abilityMod(1085, 1, CURVECFG), 1085);
eq('abilityMod: zero is zero', abilityMod(0, 1, CURVECFG), 0);
// ⚠ CONCAVE — this is why buff cost must be marginal and the scale solved.
// The same +100 buys less mod the higher the stat already is.
const _lowGain  = abilityMod(300, 1, CURVECFG) - abilityMod(200, 1, CURVECFG);
const _highGain = abilityMod(1100, 1, CURVECFG) - abilityMod(1000, 1, CURVECFG);
eq('abilityMod: +100 is worth more on a low stat', _lowGain > _highGain, true);
// ⚠ THE SCALING ARGUMENT: grade multiplies mod, so the same value-delta is
// worth 3x more at grade S than at grade E. A value-space cap could not see it.
eq('gradeMultiplierFor E', gradeMultiplierFor('E', CURVECFG), 1);
eq('gradeMultiplierFor S', Math.round(gradeMultiplierFor('S', CURVECFG) * 100), 305);
eq('abilityMod: grade S is worth 1.25^5 of grade E',
   abilityMod(500, gradeMultiplierFor('S', CURVECFG), CURVECFG),
   Math.round(abilityMod(500, 1, CURVECFG) * gradeMultiplierFor('S', CURVECFG)));

// Capacity is a flat fraction of the UNBUFFED mod total.
eq('buffCapacity is 20% of the unbuffed mod total', buffCapacity(3940), 788);
eq('buffCapacity: nothing is nothing', buffCapacity(0), 0);
eq('buffCapacity honours config fraction',
   buffCapacity(1000, { buffCap: { fraction: 0.5 } }), 500);

// ⚠ THE CURVE IS APPLIED PER ABILITY, THEN SUMMED. Summing values first and
// curving once is a different number, because x^0.8 is not additive.
const _nine = Object.fromEntries('abcdefghi'.split('').map(k => [k, 400]));
eq('abilityModTotal curves each stat separately',
   abilityModTotal(_nine, 1, null, CURVECFG), 9 * abilityMod(400, 1, CURVECFG));
eq('abilityModTotal is not the curve of the sum',
   abilityModTotal(_nine, 1, null, CURVECFG) !== abilityMod(3600, 1, CURVECFG), true);
// abilityValues flattens an abilities object, optionally with deltas applied -
// negative deltas are how the unbuffed body is reconstructed.
eq('abilityValues applies a negative delta',
   abilityValues({ a: { value: 500 } }, { a: -100 }), { a: 400 });

// ⚠ POST-CURVE ADJUSTMENTS SURVIVE, VIA AN EXPLICIT FACTOR. Size scaling
// multiplies a large creature's strength mod after the curve; rebuilding from
// values alone loses it, which read Phil (large) at 731 capacity against 755.
const _philAb = { strength: { value: 530, mod: 734 } };
const _philF = abilityPostCurveFactors(_philAb, 1, CURVECFG);
eq('post-curve factor recovers the live mod',
   abilityModTotal(abilityValues(_philAb), 1, _philF, CURVECFG), 734);
eq('a stat with no adjustment has factor 1',
   abilityPostCurveFactors({ a: { value: 400, mod: abilityMod(400, 1, CURVECFG) } },
                           1, CURVECFG).a, 1);
// ⚠⚠ THE FACTOR MUST BE COMPUTED ONCE FROM THE REAL ACTOR, NOT INFERRED PER
// CALL. Inferring it inside the total function looks equivalent, but a caller
// pricing a HYPOTHETICAL value hands over a lowered value beside an unlowered
// mod, and the ratio then swallows the buff instead of the size scaling -
// live-measured, that priced a +100 strength buff at 704 mod against 145.
const _liveAb = { strength: { value: 116, mod: abilityMod(116, 1, CURVECFG) } };
const _liveF = abilityPostCurveFactors(_liveAb, 1, CURVECFG);
const _reverted = abilityValues(_liveAb, { strength: -100 });   // undo the buff
eq('re-cast pricing uses the reverted value, not the live mod',
   buffModCost(_reverted, _liveF,
               [{ key: 'system.abilities.strength.value', value: 100 }], 1, CURVECFG),
   abilityMod(116, 1, CURVECFG) - abilityMod(16, 1, CURVECFG));

// Splitting a change list by where the points land.
const MIXED = [
  { key: 'system.abilities.strength.value', value: 200 },
  { key: 'system.abilities.wisdom.value',   value: 50 },
  { key: 'system.defense.armor.value',      value: 582 },
];
eq('buffLoadByAbility keys by ability',
   buffLoadByAbility(MIXED), { strength: 200, wisdom: 50 });
eq('buffDefenceCost takes the defence half', buffDefenceCost(MIXED), 582);
// ⚠ Defence points are ALREADY mod-scale (defences are derived from mods), so
// they pass through uncurved. That is the unit match value space never had.
eq('buffModCost passes defence through uncurved',
   buffModCost({ a: 400 }, null,
               [{ key: 'system.defense.armor.value', value: 582 }], 1, CURVECFG), 582);

// ⚠ COST IS MARGINAL AND TARGET-DEPENDENT. The same buff is cheaper on someone
// who already has the stat high — the honest price of measuring real power.
const _onLow  = buffModCost({ strength: 200 }, null,
  [{ key: 'system.abilities.strength.value', value: 100 }], 1, CURVECFG);
const _onHigh = buffModCost({ strength: 1000 }, null,
  [{ key: 'system.abilities.strength.value', value: 100 }], 1, CURVECFG);
eq('buffModCost: the same buff costs less on a high stat', _onHigh < _onLow, true);

// ⚠ SOLVED, NOT DIVIDED. room/cost overshoots because cost is concave in the
// change values — the scaled buff must actually fit.
const _tgt = { strength: 300 };
const _big = [{ key: 'system.abilities.strength.value', value: 800 }];
const _full = buffModCost(_tgt, null, _big, 1, CURVECFG);
const _room = Math.round(_full / 2);
const _s = solveBuffScale(_tgt, null, _big, 1, _room, CURVECFG);
const _fits = buffModCost(_tgt, null,
  _big.map(c => ({ ...c, value: Math.round(c.value * _s) })), 1, CURVECFG);
eq('solveBuffScale: the scaled buff fits the room', _fits <= _room, true);
eq('solveBuffScale: and is not needlessly small', _fits >= _room - 2, true);
eq('solveBuffScale: naive room/cost would have overshot',
   buffModCost(_tgt, null, _big.map(c => ({ ...c, value: Math.round(c.value * (_room / _full)) })),
               1, CURVECFG) > _room, true);
eq('solveBuffScale: a buff that fits is not scaled',
   solveBuffScale(_tgt, null, _big, 1, _full * 2, CURVECFG), 1);
eq('solveBuffScale: no room means nothing lands',
   solveBuffScale(_tgt, null, _big, 1, 0, CURVECFG), 0);

// Willy's Dreams of Light Lunar (Ally): int +243, wil +229, wis +215.
const DREAMS = [
  { key: 'system.abilities.intelligence.value', value: 243 },
  { key: 'system.abilities.willpower.value',    value: 229 },
  { key: 'system.abilities.wisdom.value',       value: 215 },
];
eq('buffCost Dreams of Light', buffCost(DREAMS), 687);
// Defence bonuses share the pool — this is the whole reason Splinter Guard
// (+582 armour onto a base of 25) is reachable by the cap at all.
eq('buffCost counts defence',
   buffCost([{ key: 'system.defense.armor.value', value: 582 }]), 582);
// A dice POOL is not a stat, and a non-stat key is not a buff.
eq('buffCost ignores pools and foreign keys',
   buffCost([{ key: 'system.defense.melee.pool', value: 500 },
             { key: 'system.meditation.fraction', value: 0.15 }]), 0);
// ⚠ Negatives do not refund, or "+800 str / -800 dex" would be free.
eq('buffCost: negatives do not earn budget back',
   buffCost([{ key: 'system.abilities.strength.value',  value: 800 },
             { key: 'system.abilities.dexterity.value', value: -800 }]), 800);

// Bloodrage (+99 str) is 17% of a cap — tuned content is untouched.
eq('resolveBuffLoad: a small buff fits whole',
   resolveBuffLoad({ capacity: 593, used: 0, cost: 99 }).scale, 1);
eq('resolveBuffLoad: fitting costs nothing',
   resolveBuffLoad({ capacity: 593, used: 0, cost: 99 }).strainDamage, 0);

// Dreams of Light (687) on Faye (cap 326), toggle OFF → truncates to fit.
const _faye = resolveBuffLoad({ capacity: 326, used: 0, cost: 687 });
eq('resolveBuffLoad: overcap truncates', _faye.truncated, true);
eq('resolveBuffLoad: truncated to the room left', _faye.applied, 326);
eq('resolveBuffLoad: truncation takes no damage', _faye.strainDamage, 0);
eq('resolveBuffLoad: scale is room/cost', Math.round(_faye.scale * 1000), 475);

// Same buff, toggle ON → lands whole and Faye pays 361 x 0.20 in HP.
const _fayeOn = resolveBuffLoad({ capacity: 326, used: 0, cost: 687, acceptOvercap: true });
eq('resolveBuffLoad: accepted overcap applies in full', _fayeOn.applied, 687);
eq('resolveBuffLoad: accepted overcap is not truncated', _fayeOn.truncated, false);
eq('resolveBuffLoad: excess is the part that did not fit', _fayeOn.excess, 361);
eq('resolveBuffLoad: overcap costs 20% of excess in HP', _fayeOn.strainDamage, 72);

// THE ARCHETYPE SPLIT: identical buff, identical overflow, different bodies.
// Faye 203 HP loses 35% of her life; Phil 1388 HP loses 5%.
eq('overcap costs Faye a third of her life', Math.round(72 / 203 * 100), 35);
eq('overcap barely scratches Phil', Math.round(72 / 1388 * 100), 5);

// ⚠ PER-APPLICATION, not cumulative: already-paid overflow is not re-charged.
// Loaded 300 of 326, adding 100 → only the 74 that miss the cap are charged.
const _second = resolveBuffLoad({ capacity: 326, used: 300, cost: 100, acceptOvercap: true });
eq('resolveBuffLoad: only this buff’s overflow is charged', _second.excess, 74);
eq('resolveBuffLoad: second buff strain', _second.strainDamage, 15);
// Three buffs of 100 past a full cap cost exactly what one buff of 300 does.
const _thrice = [1, 2, 3].reduce((s) => s
  + resolveBuffLoad({ capacity: 326, used: 326, cost: 100, acceptOvercap: true }).strainDamage, 0);
eq('resolveBuffLoad: splitting a buff cannot dodge the price', _thrice,
   resolveBuffLoad({ capacity: 326, used: 326, cost: 300, acceptOvercap: true }).strainDamage);
// A buff that costs nothing is never taxed.
eq('resolveBuffLoad: a free buff is free',
   resolveBuffLoad({ capacity: 326, used: 900, cost: 0 }).strainDamage, 0);

// ── GEAR-SOURCED BUFF MAGNITUDE + THE SHIELD FAMILY ────────────────────────
// weapon-styles reads globalThis.CONFIG and foundry.utils lazily, so a shim
// installed before the dynamic import is enough to exercise it in plain node.
// Worth testing outside Foundry: this gate decides whether Shield Barrier
// fires AT ALL, and its failure mode is a silent magnitude of zero.
globalThis.CONFIG = {
  ASPECTSOFPOWER: {
    weaponWeights: { shield: 120, greatshield: 190, buckler: 50, sword: 100, greataxe: 220, unarmed: 40, wand: 40 },
    weaponTypeFamilies: { shield: ['shield', 'greatshield', 'buckler'] },
  },
};
globalThis.foundry = {
  utils: {
    getProperty: (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj),
  },
};
const WS = await import('../module/systems/weapon-styles.mjs');

const gearItem = (name, tags, sys = {}) => ({
  name, type: 'item',
  system: { equipped: true, slot: 'weaponry', tags, ...sys },
});
const actorWith = (...items) => ({ items });

// John: Benjamin's Final Joy, armorBonus 47 (live value, 2026-08-05).
const john = actorWith(gearItem("Benjamin's Final Joy", ['shield'], { armorBonus: 47 }));
const johnSrc = WS.resolveGearSource(john, 'shield.armorBonus');
eq('gear source finds the shield', johnSrc?.item?.name, "Benjamin's Final Joy");
eq('gear source reads armorBonus', johnSrc?.value, 47);
// THE WHOLE POINT: 10% of 47 is 5, against the ~193 the roll-scaled version
// applied. Roughly 40x, which is why this had to stop coming off the roll.
eq('Shield Barrier magnitude is 10% of the shield', Math.round(47 * 0.1), 5);

// A greatshield is a shield. Before weaponTypeFamilies, Phil's did not count.
const phil = actorWith(gearItem('Bulwark', ['greatshield'], { armorBonus: 210 }));
eq('greatshield satisfies the shield family', WS.resolveGearSource(phil, 'shield.armorBonus')?.value, 210);
eq('weaponTypeFamily(shield)', WS.weaponTypeFamily('shield'), ['shield', 'greatshield', 'buckler']);
eq('weaponTypeFamily is identity for unlisted types', WS.weaponTypeFamily('greataxe'), ['greataxe']);

// No shield → null, which is what makes the gate a REFUSAL and not a zero.
const swordsman = actorWith(gearItem('Longsword', ['sword'], { armorBonus: 0 }));
eq('no shield resolves to nothing', WS.resolveGearSource(swordsman, 'shield.armorBonus'), null);
// A shield with no armour value is as good as no shield for this purpose.
eq('a valueless shield does not resolve',
   WS.resolveGearSource(actorWith(gearItem('Plank', ['shield'], { armorBonus: 0 })), 'shield.armorBonus'), null);
// The largest wins when two qualify.
eq('two shields: the better one sources it',
   WS.resolveGearSource(actorWith(
     gearItem('Small', ['buckler'], { armorBonus: 12 }),
     gearItem('Big', ['greatshield'], { armorBonus: 88 }),
   ), 'shield.armorBonus')?.value, 88);
// Unequipped gear is not in hand.
eq('an unequipped shield does not count',
   WS.resolveGearSource(actorWith(
     gearItem('Stowed', ['shield'], { armorBonus: 47, equipped: false }),
   ), 'shield.armorBonus'), null);
// `weapon` excludes shields — the source keys are not interchangeable.
eq('weapon source skips shields',
   WS.resolveGearSource(john, 'weapon.armorBonus'), null);
// Malformed selectors resolve to nothing rather than throwing.
eq('selector with no field', WS.resolveGearSource(john, 'shield'), null);
eq('unknown source key', WS.resolveGearSource(john, 'boots.armorBonus'), null);

// canUseSkill: the gate itself, both directions.
const barrier = { name: 'Shield Barrier', system: { tagConfig: { buffFromEquipment: 'shield.armorBonus' } } };
eq('Shield Barrier is allowed with a shield', WS.canUseSkill(john, barrier).allowed, true);
eq('Shield Barrier is refused without one', WS.canUseSkill(swordsman, barrier).allowed, false);
eq('and says why', WS.canUseSkill(swordsman, barrier).reason.includes('shield'), true);
// requiresWeaponTag is family-aware too, so a greatshield satisfies `shield`.
const bash = { name: 'Shield Bash', system: { tagConfig: { requiresWeaponTag: 'shield' } } };
eq('Shield Bash accepts a greatshield', WS.canUseSkill(phil, bash).allowed, true);
eq('Shield Bash still refuses a swordsman', WS.canUseSkill(swordsman, bash).allowed, false);

// ── CONDITIONAL TAGS: `cap` qualifying `stacking` ──────────────────────────
// The cap is a TAG, not a field (user ruled 2026-08-05). Its whole failure
// mode is being silently inert, so the readers are tested for exactly that.
const T = await import('../module/helpers/tags.mjs');

const brandTags = ['combat', 'stacking'];
const brandConds = [{ id: 'cap', qualifies: 'stacking', value: 100, atCap: 'stop' }];

eq('cap resolves when stacking is present',
   T.conditionalFor(brandTags, brandConds, 'stacking'), { value: 100, atCap: 'stop' });
// THE INERT CASE: a cap on a carrier that never declared stacking bounds
// nothing. Returning null (not 100) is what lets the caller say so out loud.
eq('cap without the stacking tag is INERT',
   T.conditionalFor(['combat'], brandConds, 'stacking'), null);
eq('no conditional at all', T.conditionalFor(brandTags, [], 'stacking'), null);
eq('a cap with no number does not resolve',
   T.conditionalFor(brandTags, [{ id: 'cap', qualifies: 'stacking' }], 'stacking'), null);
// A conditional qualifying a DIFFERENT tag must not answer for stacking.
eq('cap on another tag does not answer here',
   T.conditionalFor(brandTags, [{ id: 'cap', qualifies: 'burning', value: 5 }], 'stacking'), null);
eq('atCap defaults to stop',
   T.conditionalFor(brandTags, [{ id: 'cap', qualifies: 'stacking', value: 7 }], 'stacking').atCap, 'stop');
// Zero is a real cap (feeds nothing), not a missing one.
eq('a cap of zero is a real bound',
   T.conditionalFor(brandTags, [{ id: 'cap', qualifies: 'stacking', value: 0 }], 'stacking'), { value: 0, atCap: 'stop' });

// hasSystemTag accepts both the flat and legacy {id,value} shapes.
eq('hasSystemTag flat', T.hasSystemTag(['a', 'stacking'], 'stacking'), true);
eq('hasSystemTag legacy objects', T.hasSystemTag([{ id: 'stacking', value: 0 }], 'stacking'), true);
eq('hasSystemTag absent', T.hasSystemTag(['a'], 'stacking'), false);

// The author-facing validator — the reason the inert case is survivable.
eq('clean config reports no problems',
   T.conditionalTagProblems(brandTags, brandConds).length, 0);
eq('inert cap is reported',
   T.conditionalTagProblems(['combat'], brandConds)[0].includes('currently does nothing'), true);
eq('unknown tag id is reported',
   T.conditionalTagProblems(brandTags, [{ id: 'nonsense', qualifies: 'stacking', value: 1 }])[0]
     .includes('not in the tag registry'), true);
eq('a non-conditional tag cannot qualify',
   T.conditionalTagProblems(brandTags, [{ id: 'healer', qualifies: 'stacking', value: 1 }])[0]
     .includes('cannot qualify'), true);
eq('missing value is reported',
   T.conditionalTagProblems(brandTags, [{ id: 'cap', qualifies: 'stacking' }])
     .some(p => p.includes('needs a number')), true);
// Declared-but-unimplemented at-cap behaviours must announce themselves rather
// than quietly acting like `stop` — the dump's caps often transform at the top.
eq('unimplemented atCap is announced',
   T.conditionalTagProblems(brandTags, [{ id: 'cap', qualifies: 'stacking', value: 5, atCap: 'transform' }])
     .some(p => p.includes('NOT YET IMPLEMENTED')), true);
eq('unknown atCap is reported',
   T.conditionalTagProblems(brandTags, [{ id: 'cap', qualifies: 'stacking', value: 5, atCap: 'wat' }])
     .some(p => p.includes('unknown at-cap')), true);
eq('cap and stacking are both registered',
   [T.TAG_REGISTRY.stacking?.category, T.TAG_REGISTRY.cap?.category], ['passive', 'conditional']);
eq('cap declares what it qualifies', T.TAG_REGISTRY.cap.qualifies, 'stacking');

// ── AURA TICK CADENCE (design-aura-ticks.md) ────────────────────────────────
// Resource auras pay in thirds of the caster's reference round, sampling
// position at each moment. The moments matter more than the count, so these
// assert the MOMENTS.
const AURA_CFG = { auras: { ticksPerReferenceRound: 3, maxCatchUpTicks: 12 } };
eq('period is a third of the reference round', F2.auraTickPeriod(4702, AURA_CFG), 4702 / 3);
eq('cadence disabled -> no period', F2.auraTickPeriod(4702, { auras: { ticksPerReferenceRound: 0 } }), 0);
eq('a zero-length round has no period', F2.auraTickPeriod(0, AURA_CFG), 0);

const P = 100;   // round numbers so the moments are readable
// Exactly one period elapsed -> one moment, at the period boundary.
eq('one period owed', F2.auraTickMoments(0, 100, P, AURA_CFG),
   { moments: [100], newLastTick: 100, capped: false });
// Two and a half periods -> TWO moments; the half stays owed for next time.
eq('partial periods do not pay early', F2.auraTickMoments(0, 250, P, AURA_CFG),
   { moments: [100, 200], newLastTick: 200, capped: false });
// Nothing owed yet — cursor must not move, or the remainder is lost.
eq('less than a period owes nothing', F2.auraTickMoments(0, 99, P, AURA_CFG),
   { moments: [], newLastTick: 0, capped: false });
// ⚠ UNSEEDED must RESYNC, not pay from zero. An aura cast at tick 9000 with a
// null cursor would otherwise owe 90 ticks of backlog on its first advance.
eq('an unseeded aura resyncs instead of paying a backlog',
   F2.auraTickMoments(null, 9000, P, AURA_CFG),
   { moments: [], newLastTick: 9000, capped: false });
// A clock that moved BACKWARD (reset / manual rewind) must not pay negatives.
eq('a rewound clock resyncs', F2.auraTickMoments(500, 200, P, AURA_CFG),
   { moments: [], newLastTick: 200, capped: false });
// Catch-up cap: 100 periods owed, capped to 12, and the cursor RESYNCS so the
// remainder is not re-paid on every later advance.
const capped = F2.auraTickMoments(0, 10000, P, AURA_CFG);
eq('catch-up is capped', capped.moments.length, 12);
eq('capped catch-up resyncs to the clock', capped.newLastTick, 10000);
eq('capping is reported', capped.capped, true);
// Throughput is UNCHANGED by the split — that is what makes this not a buff.
{
  const total = 90, n = 3;
  eq('three ticks sum to the whole amount', Math.round(total / n) * n, total);
}
// The moments are spaced, not bunched — each is a separate position sample.
eq('moments are one period apart',
   F2.auraTickMoments(1000, 1350, P, AURA_CFG).moments, [1100, 1200, 1300]);

// ── KI CAP: a stack ceiling from an ability mod ─────────────────────────────
// Stacks are COUNTED OBJECTS, so a mod in the hundreds must become a ceiling
// in the single digits. The additive-safety property is the one that matters:
// no stat named -> the authored value comes back untouched, so every existing
// producer in the world is unchanged by this feature existing.
const KI = { stacks: { statCapDivisor: 150, statCapMax: 10 } };
eq('no stat named returns the authored cap', F2.statStackCap(0, 3, KI), 3);
eq('no stat and no authored cap is 0', F2.statStackCap(0, 0, KI), 0);
eq('endurance 600 -> 4 ki', F2.statStackCap(600, 0, KI), 4);
eq('endurance 1085 -> 7 ki', F2.statStackCap(1085, 0, KI), 7);
// The authored value is a FLOOR, never a ceiling — an author who wrote 3 meant
// at least 3, even for a low-endurance carrier.
eq('authored value floors a small stat', F2.statStackCap(150, 3, KI), 3);
eq('a big stat beats the authored floor', F2.statStackCap(1500, 3, KI), 10);
// Hard max stops a colossal build carrying an absurd bar.
eq('cap is bounded by statCapMax', F2.statStackCap(99999, 0, KI), 10);
eq('divisor is a knob',
   F2.statStackCap(600, 0, { stacks: { statCapDivisor: 75, statCapMax: 10 } }), 8);
// Junk must not produce NaN stacks.
eq('non-finite stat falls back to authored', F2.statStackCap(NaN, 2, KI), 2);
eq('negative stat falls back to authored', F2.statStackCap(-50, 2, KI), 2);

// ── KI POOL MAX from endurance (ruled 2026-08-05) ───────────────────────────
// Ki is a RESOURCE, not stacks: no per-cast payload, varying spend costs, and
// it wants the pool machinery. The bar is deliberately SMALL.
const KICFG = { ki: { capDivisor: 150, capMax: 10 } };
eq('endurance 1085 -> 7 ki', F2.kiMaxFor(1085, KICFG), 7);
eq('endurance 600 -> 4 ki', F2.kiMaxFor(600, KICFG), 4);
eq('ki is bounded by capMax', F2.kiMaxFor(99999, KICFG), 10);
// ⚠ 0 IS THE UNTAGGED CASE and must stay 0 — a nonzero floor would give a bar
// to every actor in the world the moment the field exists.
eq('no endurance -> no ki', F2.kiMaxFor(0, KICFG), 0);
eq('negative endurance -> no ki', F2.kiMaxFor(-50, KICFG), 0);
eq('NaN endurance -> no ki', F2.kiMaxFor(NaN, KICFG), 0);
eq('divisor is a knob', F2.kiMaxFor(600, { ki: { capDivisor: 75, capMax: 10 } }), 8);

// ── ALTERATION DAMAGE FACTOR (multiplicative, shared by real path + preview) ─
// The bug these exist to prevent: the skill-upgrade dialog summed dmgMods
// ADDITIVELY and added the sum to rarityMult, while _resolveRarityMods
// multiplies. They coincide ONLY at rarityMult 1.0 with a single alteration,
// which is exactly why it survived from `300ce09` to 2026-08-06 unnoticed.
eq('no alterations -> factor 1', F2.alterationDamageFactor([]), 1);
eq('single penalty', F2.alterationDamageFactor([-0.20]), 0.8);
eq('penalties COMPOUND, they do not sum',
  Math.round(F2.alterationDamageFactor([-0.20, -0.10]) * 1e6) / 1e6, 0.72);  // NOT 0.70
eq('a positive mod multiplies up', F2.alterationDamageFactor([0.50]), 1.5);
eq('mixed signs compound',
  Math.round(F2.alterationDamageFactor([0.50, -0.20]) * 1e6) / 1e6, 1.2);    // NOT 1.30
eq('junk entries are skipped, not NaN',
  F2.alterationDamageFactor([0.5, null, undefined, NaN, 'x']), 1.5);
eq('factor never goes negative', F2.alterationDamageFactor([-2]) >= 0, true);

// ⚡ THE IDENTITY THE WHOLE AMBUSH DESIGN RESTS ON: `rare` carrying `ambush`
// reproduces `divine` EXACTLY, so the three sneak attacks keep their damage
// to the digit while rarity goes back to meaning proficiency. If this ever
// fails, either the rarity ladder or ambush.dmgMod moved and the content
// silently changed power.
eq('rare + ambush == divine, exactly',
  Math.round(F2.effectiveDamageMultiplier(0.8, [0.50]) * 1e6) / 1e6, 1.2);
eq('effective mult clamps at zero', F2.effectiveDamageMultiplier(-5, []), 0);

// SITUATIONAL TERMS ARE A LIST, NOT NAMED PARAMETERS (2026-08-06). They were
// `profMult, lunarMult` positional args, which meant this function had to know
// the name of every engine-evaluated modifier that would ever exist. See
// systems/situational-mods.mjs.
eq('no situational mods -> authored value only',
  Math.round(F2.effectiveDamageMultiplier(0.8, [0.50], []) * 1e6) / 1e6, 1.2);
eq('situational mods MULTIPLY in',
  Math.round(F2.effectiveDamageMultiplier(1.0, [-0.20], [1.167, 1.1]) * 1e6) / 1e6,
  Math.round(1.0 * 0.8 * 1.167 * 1.1 * 1e6) / 1e6);
eq('an omitted situational list is the same as an empty one',
  F2.effectiveDamageMultiplier(0.8, [0.50]),
  F2.effectiveDamageMultiplier(0.8, [0.50], []));
eq('a situational penalty below 1 is honoured (below-trained proficiency)',
  Math.round(F2.effectiveDamageMultiplier(0.8, [0.50], [0.833333]) * 1e6) / 1e6,
  Math.round(1.2 * 0.833333 * 1e6) / 1e6);
eq('junk situational entries are skipped, not NaN',
  Math.round(F2.effectiveDamageMultiplier(0.8, [0.50], [1.5, null, NaN, 'x']) * 1e6) / 1e6,
  1.8);

// ── SOURCE GUARD: restorationScale must default to a no-op ─────────────────
// A heal scale that defaulted to anything but 1 would silently re-price EVERY
// restoration skill in the game the moment it shipped. Added for the Dreams of
// Light ally halves ("Heal for 1/2 of rolled value"), which spend a payload
// their producer priced as damage.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../module/data/item-skill.mjs', import.meta.url), 'utf8')
    .replace(/\r/g, '');
  eq('restorationScale exists and defaults to 1',
    /restorationScale:\s*new fields\.NumberField\(\{\s*initial:\s*1\b/.test(src), true);
  // And the handler must MULTIPLY by it rather than replace the amount.
  const item = readFileSync(new URL('../module/documents/item.mjs', import.meta.url), 'utf8')
    .replace(/\r/g, '');
  eq('the restoration handler multiplies the roll by the scale',
    /amount\s*=\s*Math\.round\(dmgRoll\.total\s*\*\s*_restScale\)/.test(item), true);
  // The HoT path must scale too, or authoring hotDuration would undo it.
  eq('the heal-over-time path scales as well',
    /hotTickAmount\(\s*Math\.round\(dmgRoll\.total\s*\*\s*_restScale\)/.test(item), true);
}

// ── SOURCE GUARD: the spell grade ladder must track the stat curve ──────────
// The 2026-08-06 bug was these two drifting apart: costs stepped x2.3 per rank
// while ability mods (driving BOTH damage and the mana pool) stepped x1.25, so
// every rank-up halved casts-per-pool. spellGradeFactors is now DERIVED from
// statCurve, and this guard fails if anyone re-tabulates it by hand.
{
  // ⚠ Imported locally — the other source guards pull this in further down,
  // inside their own block, so it is not in scope up here.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../module/helpers/config.mjs', import.meta.url), 'utf8')
    .replace(/\r/g, '');
  const derived = /ASPECTSOFPOWER\.spellGradeFactors\s*=\s*Object\.fromEntries\(/.test(src);
  eq('spellGradeFactors is DERIVED from statCurve, not hand-tabulated', derived, true);

  // And the derivation itself: cost must be flat where the stat multiplier is
  // flat (gradeIndex 0 for G/F/E) and step with it thereafter.
  const gradeIndex = { G: 0, F: 0, E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
  const MULT_BASE = 1.25;
  const ladder = Object.fromEntries(Object.entries(gradeIndex)
    .map(([r, gi]) => [r, 10 * Math.pow(MULT_BASE, gi)]));
  eq('G, F and E are flat (gradeIndex 0 throughout)',
    ladder.G === ladder.E && ladder.F === ladder.E, true);
  eq('E anchors at 10 so existing content never moves', ladder.E, 10);
  eq('D is one 1.25 step above E', Math.round(ladder.D * 1000) / 1000, 12.5);
  eq('S is five steps above E', Math.round(ladder.S * 1000) / 1000, 30.518);
  // The property that actually matters: casts-per-pool is rank-invariant,
  // because cost and pool now scale by the same factor.
  const castsRatio = (a, b) =>
    (Math.pow(MULT_BASE, gradeIndex[b]) / ladder[b])
    / (Math.pow(MULT_BASE, gradeIndex[a]) / ladder[a]);
  for (const [a, b] of [['E','D'], ['D','C'], ['C','B'], ['B','A'], ['A','S']])
    eq(`rank-up ${a}->${b} is cost-neutral per pool`,
      Math.round(castsRatio(a, b) * 1e6) / 1e6, 1);
}

// ── SOURCE GUARD: flag scopes ────────────────────────────────────────────────
// Not a formula test — a repo scan, because this bug class is invisible to
// every other kind of check we run.
//
// `getFlag`/`setFlag`/`unsetFlag` VALIDATE their scope against installed
// package ids and THROW on anything else. The flag namespace used throughout
// this system is `aspectsofpower`; the package id is `aspects-of-power`. So
// the ergonomic API and the 78 direct `flags.aspectsofpower.*` reads disagree
// by one hyphen, and reaching for the wrong one is a runtime crash, not a
// silent miss.
//
// It shipped once (2026-08-05) inside the actor-death handler and took the
// on_death fan-out, unqueue and auto-defeat down with it. Green pure tests and
// a clean dry run both passed — neither executes a hook. This scan is what
// would have caught it, so it runs with them.
{
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const SYSTEM_ID = JSON.parse(readFileSync('system.json', 'utf8')).id;
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.mjs') ? [p] : []);
  });
  const bad = [];
  for (const file of walk('module')) {
    // ⚠ NORMALISE CRLF FIRST. These files are checked out with CRLF endings,
    // and in JS `.` does not match `\r` — so a naive /\/\/.*$/ never matches a
    // comment on a CRLF line, and the comment survives stripping. Caught by
    // this very test flagging the warning comment that documents the trap.
    const src = readFileSync(file, 'utf8').replace(/\r/g, '');
    // Strip line comments so prose about this trap does not trip the check
    // that enforces it.
    const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    for (const m of code.matchAll(/\b(?:get|set|unset)Flag\(\s*['"]([^'"]+)['"]/g)) {
      if (m[1] !== SYSTEM_ID) {
        bad.push(`${file.replace(/\\/g, '/')}: scope "${m[1]}" (must be "${SYSTEM_ID}")`);
      }
    }
  }
  eq(`flag API scopes all match the package id "${SYSTEM_ID}"`, bad, []);

  // ── The SILENT half of the same problem ──────────────────────────────────
  // This system stores flags under TWO namespaces: `aspects-of-power` (the
  // package id, 19 live documents, reachable by the getFlag API) and
  // `aspectsofpower` (185 live documents, reached only by direct paths).
  //
  // The scope check above catches the CRASHING mistake. The dangerous one is
  // quieter: `getFlag('aspects-of-power', 'clockTick')` is a perfectly VALID
  // scope, so it never throws — it just reads the wrong store and returns
  // undefined. Same for a direct `flags.aspects-of-power.<compactKey>` path.
  //
  // A key belongs to exactly one namespace. Any key appearing under both is a
  // split store: written one place, read from another, no error either way.
  const nsOfKey = {};
  for (const file of walk('module')) {
    const code = readFileSync(file, 'utf8').replace(/\r/g, '')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const add = (key, ns) => ((nsOfKey[key] ??= new Set()).add(ns));
    for (const m of code.matchAll(/flags\.(aspects-of-power|aspectsofpower)\.([A-Za-z0-9_]+)/g)) add(m[2], m[1]);
    for (const m of code.matchAll(/Flag\(\s*['"](aspects-of-power|aspectsofpower)['"]\s*,\s*['"]([A-Za-z0-9_]+)['"]/g)) add(m[2], m[1]);
  }
  const split = Object.entries(nsOfKey)
    .filter(([, v]) => v.size > 1)
    .map(([k, v]) => `${k} -> ${[...v].join(' + ')}`);
  eq('no flag key is used under both namespaces', split, []);
}

// -- CLASH (damage-vs-damage counter, ruled 2026-08-07) ---------------------
// The first reaction that can turn an attack around rather than blunt it, so
// the boundary cases carry real weight: a clash that merely TIES must not
// reward either side, and a losing clash must still have blunted the hit by
// exactly what it was worth.
{
  const co = F2.clashOutcome;
  const r = (o) => [o.winner, o.defenderTakes, o.attackerTakes, +o.damageMultiplier.toFixed(4)];

  eq('clash: defender wins, attacker eats the excess', r(co(100, 150)), ['defender', 0, 50, 0]);
  eq('clash: attacker wins, defender eats the excess', r(co(150, 100)), ['attacker', 50, 0, 0.3333]);
  eq('clash: dead heat cancels both blows',            r(co(100, 100)), ['tie', 0, 0, 0]);

  // A losing clash is still worth exactly what it rolled: the surviving
  // fraction must equal (incoming - clash) / incoming, so the multiplier and
  // the flat amount can never disagree about how much was absorbed.
  const lose = co(200, 50);
  eq('clash: losing multiplier matches the flat absorption',
     +(lose.damageMultiplier * 200).toFixed(4), lose.defenderTakes);

  // Degenerate inputs must not produce a NaN multiplier and silently delete or
  // duplicate damage downstream - the 0/0 division is the trap here.
  eq('clash: no incoming attack lands nothing',  r(co(0, 500)),   ['tie', 0, 0, 0]);
  eq('clash: zero counter leaves the hit whole', r(co(100, 0)),   ['attacker', 100, 0, 1]);
  eq('clash: negative inputs clamp to zero',     r(co(-50, -50)), ['tie', 0, 0, 0]);
  eq('clash: non-numeric input does not produce NaN',
     Number.isFinite(co(undefined, 'x').damageMultiplier), true);
}

// -- UNARMED STAT GRANT (ruled 2026-08-07) ----------------------------------
// The ladder is measured off the 35 stat-carrying weapons in the live world:
// common 27 / uncommon 36 / rare 45, split 36-34-30 across three abilities.
// What these guard is that the TABLE IS THE CONTRACT - three independent
// roundings of a percentage split do not reconcile to the authored total, so
// the sum is asserted at every rung rather than trusted.
{
  const g = F2.unarmedStatGrant;
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const CFG = { unarmedGrant: { enabled: true,
    abilities: ['dexterity', 'strength', 'endurance'], split: [0.36, 0.34, 0.30],
    totalByRarity: { not_proficient: 0, rusty: 18, common: 27, uncommon: 36,
                     rare: 45, epic: 54, legendary: 63, divine: 81 } } };

  eq('unarmed grant: common matches the measured weapon median',
     g('common', CFG), { dexterity: 10, strength: 9, endurance: 8 });
  eq('unarmed grant: rare matches the measured weapon median',
     g('rare', CFG), { dexterity: 16, strength: 15, endurance: 14 });

  for (const [r, want] of [['rusty', 18], ['common', 27], ['uncommon', 36],
                           ['rare', 45], ['epic', 54], ['legendary', 63], ['divine', 81]]) {
    eq(`unarmed grant: ${r} sums to exactly its authored total`, sum(g(r, CFG)), want);
  }

  // An untrained fighter gets nothing, and an unknown rarity must not invent a
  // grant - both would be silent, since a wrong stat block looks like any other.
  eq('unarmed grant: not_proficient grants nothing', g('not_proficient', CFG), {});
  eq('unarmed grant: unknown rarity grants nothing', g('nonsense', CFG), {});
  eq('unarmed grant: disabled grants nothing',
     g('rare', { unarmedGrant: { ...CFG.unarmedGrant, enabled: false } }), {});

  // Dexterity must lead - unarmed sits at weight 40, where the melee blend is
  // 70% dex, so a str-leading grant would fight the damage formula.
  const r = g('rare', CFG);
  eq('unarmed grant: dexterity is the primary', r.dexterity >= r.strength, true);
}

// ---------------------------------------------------------------------------
// Overworld hex lattice
//
// GOLDEN NUMBERS ARE THE GENERATOR'S OWN OUTPUT: `world_origin_ft` as stored in
// hex_16_10_1525d9.uvtt and hex_17_9_680475.uvtt (hexmap 0.4, builds 1525d9 and
// 680475), and the neighbour tables read off those files' `x_area.exits`.
// Nothing here is hand-derived.
//
// ⚠ TOLERANCE IS 0.005 ft DELIBERATELY. An earlier check used 1 ft and passed a
// STALE BUILD whose origin was 0.38 ft out — wide enough to swallow the exact
// defect the test existed to catch. The stale value is now a negative control
// below, so loosening the tolerance breaks the suite.
{
  const near = (name, got, want, tol = 0.005) => {
    const pass = Number.isFinite(got) && Math.abs(got - want) <= tol;
    if (!pass) { failures++; console.error(`FAIL ${name}: got ${got}, want ${want} +/- ${tol}`); }
    else console.log(`ok   ${name}`);
  };

  const CANVAS = [1280, 1120];                       // ft, both current builds
  const STAMP_16_10 = { hex: [16, 10], worldOriginFt: [14360, 10351.92] };
  const STAMP_17_9  = { hex: [17, 9],  worldOriginFt: [15260, 9832.3] };

  eq('hex: size 600 ft centre to vertex', HEX_SIZE_FT, 600);
  near('hex: width 1200 ft', hexWidthFt(), 1200);
  near('hex: height 1039.23 ft', hexHeightFt(), 1039.2305, 0.001);
  near('hex: apothem 519.615 ft', hexApothemFt(), 519.6152, 0.001);

  // The two live builds must land on the lattice.
  near('lattice: hex_16_10 origin drift', verifyStampOrigin(STAMP_16_10, CANVAS).driftFt, 0);
  near('lattice: hex_17_9 origin drift',  verifyStampOrigin(STAMP_17_9,  CANVAS).driftFt, 0);
  eq('lattice: hex_16_10 verifies', verifyStampOrigin(STAMP_16_10, CANVAS).ok, true);
  eq('lattice: hex_17_9 verifies',  verifyStampOrigin(STAMP_17_9,  CANVAS).ok, true);

  // NEGATIVE CONTROL 1 — the pre-fix build. Its stored origin is 10352.3, which
  // is 0.38 ft high because the generator centred the hex on an unrounded
  // 1119.23 ft canvas. This MUST be rejected; if it ever passes, the tolerance
  // has been widened back to uselessness.
  const stale = verifyStampOrigin({ hex: [16, 10], worldOriginFt: [14360, 10352.3] }, CANVAS);
  eq('lattice: PRE-FIX build is rejected', stale.ok, false);
  near('lattice: pre-fix drift is the canvas rounding', stale.driftFt, 0.38, 0.005);

  // NEGATIVE CONTROL 2 — wrong parity. Half a row pitch, the classic odd-q/even-q
  // mix-up. Large enough to catch, small enough to look plausible in a dump.
  near('lattice: wrong row is a full row pitch out',
       verifyStampOrigin({ hex: [16, 11], worldOriginFt: [14360, 10351.92] }, CANVAS).driftFt,
       hexHeightFt(), 0.01);

  // Column pitch and the half-row stagger, straight off the two files.
  const c1610 = hexCentreWorld(16, 10), c179 = hexCentreWorld(17, 9);
  near('lattice: column pitch 900 ft', c179[0] - c1610[0], 900);
  near('lattice: odd column sits half a row higher here', c179[1] - c1610[1], -519.6152, 0.001);

  // Round-trip over the lattice, negatives included: centre -> hex -> same hex.
  let rtFail = 0;
  for (let col = -4; col <= 24; col++) {
    for (let row = -4; row <= 24; row++) {
      const [x, y] = hexCentreWorld(col, row);
      const [c, r] = hexFromWorldFt(x, y);
      if (c !== col || r !== row) rtFail++;
    }
  }
  eq('hexFromWorldFt: 841 centres round-trip', rtFail, 0);

  // Travel destination parsing. The two positives are REAL destination UUIDs:
  // the first read off a live hex-exit behaviour in the 2026-08-10 payload
  // audit, the second from the Phase 0 keepId round-trip fixture.
  eq('sceneIdFromRegionUuid: live hex exit',
     sceneIdFromRegionUuid('Scene.0FBnx8apvuA3Xx2W.Region.v9Q6L6bY3BqiLfRn'), '0FBnx8apvuA3Xx2W');
  eq('sceneIdFromRegionUuid: phase-0 fixture',
     sceneIdFromRegionUuid('Scene.xWiFdQMqoRVsXplI.Region.ddnuJfrCkff2ty0m'), 'xWiFdQMqoRVsXplI');
  // Anything that is not exactly Scene.<id>.Region.<id> is NOT a hex exit.
  eq('sceneIdFromRegionUuid: null in, null out', sceneIdFromRegionUuid(null), null);
  eq('sceneIdFromRegionUuid: empty string', sceneIdFromRegionUuid(''), null);
  eq('sceneIdFromRegionUuid: bare scene uuid',
     sceneIdFromRegionUuid('Scene.0FBnx8apvuA3Xx2W'), null);
  eq('sceneIdFromRegionUuid: compendium-scoped uuid rejected',
     sceneIdFromRegionUuid('Compendium.world.hexes.Scene.0FBnx8apvuA3Xx2W.Region.v9Q6L6bY3BqiLfRn'), null);
  eq('sceneIdFromRegionUuid: deeper embedded path rejected',
     sceneIdFromRegionUuid('Scene.0FBnx8apvuA3Xx2W.Region.v9Q6L6bY3BqiLfRn.RegionBehavior.aaaabbbbccccdddd'), null);
  eq('sceneIdFromRegionUuid: short id rejected',
     sceneIdFromRegionUuid('Scene.abc.Region.v9Q6L6bY3BqiLfRn'), null);

  // Off-centre round-trip. Rounding fractional axial coordinates independently
  // fails in a band along every edge, so sampling only centres proves nothing.
  let offFail = 0;
  for (let col = 0; col <= 12; col++) {
    for (let row = 0; row <= 12; row++) {
      const [cx, cy] = hexCentreWorld(col, row);
      for (const edge of EDGES) {
        const n = neighbour(col, row, edge);
        const [nx, ny] = hexCentreWorld(n[0], n[1]);
        // 45% of the way to the neighbour: still inside, well past the middle
        const [c, r] = hexFromWorldFt(cx + (nx - cx) * 0.45, cy + (ny - cy) * 0.45);
        if (c !== col || r !== row) offFail++;
      }
    }
  }
  eq('hexFromWorldFt: 1014 off-centre samples stay in their hex', offFail, 0);

  // Adjacency, read off x_area.exits in the two files.
  const EXITS_16_10 = { SE: [17, 10], S: [16, 11], SW: [15, 10], NW: [15, 9], N: [16, 9], NE: [17, 9] };
  const EXITS_17_9  = { SE: [18, 10], S: [17, 10], SW: [16, 10], NW: [16, 9], N: [17, 8], NE: [18, 9] };
  for (const [edge, want] of Object.entries(EXITS_16_10)) {
    eq(`neighbour: 16,10 ${edge}`, neighbour(16, 10, edge), want);
  }
  for (const [edge, want] of Object.entries(EXITS_17_9)) {
    eq(`neighbour: 17,9 ${edge}`, neighbour(17, 9, edge), want);
  }

  // Stepping out and back must return home on BOTH parities, which is the only
  // check that actually exercises the odd-q asymmetry in both directions.
  let backFail = 0;
  for (let col = -3; col <= 20; col++) {
    for (let row = -3; row <= 20; row++) {
      for (const edge of EDGES) {
        const n = neighbour(col, row, edge);
        const back = neighbour(n[0], n[1], OPPOSITE_EDGE[edge]);
        if (back[0] !== col || back[1] !== row) backFail++;
        if (edgeBetween(col, row, n[0], n[1]) !== edge) backFail++;
      }
    }
  }
  eq('neighbour: out-and-back is identity on both parities', backFail, 0);
  eq('edgeBetween: non-adjacent is null', edgeBetween(16, 10, 19, 10), null);

  eq('hexDistance: self is 0', hexDistance(16, 10, 16, 10), 0);
  eq('hexDistance: NE neighbour is 1', hexDistance(16, 10, 17, 9), 1);
  eq('hexDistance: two columns over', hexDistance(16, 10, 18, 10), 2);
  eq('hexesWithin: radius 1 is 7 hexes', hexesWithin(16, 10, 1).length, 7);
  eq('hexesWithin: radius 2 is 19 hexes', hexesWithin(16, 10, 2).length, 19);
  eq('hexesWithin: centre first', hexesWithin(16, 10, 2)[0], { col: 16, row: 10, distance: 0 });

  // Token position. Local grid (200,60) at 32 px per grid unit, 5 ft per unit,
  // padding 0 — the worked example against hex_16_10's stored origin.
  const anchor = { worldOriginFt: STAMP_16_10.worldOriginFt, sceneX: 0, sceneY: 0,
                   gridSize: 32, gridDistance: 5 };
  const wf = worldFtFromPixels(anchor, 200 * 32, 60 * 32);
  near('token: world x', wf[0], 15360);
  near('token: world y', wf[1], 10651.92);
  eq('token: resolves to its own hex', hexFromWorldFt(wf[0], wf[1]), [16, 10]);
  const off = offsetFromCentre(wf, 16, 10);
  near('token: 360 ft east of centre', off[0], 360);
  near('token: 260 ft north of centre', off[1], -260, 0.01);
  const ne = nearestEdge(off[0], off[1]);
  eq('token: heading for the NE crossing', ne.edge, 'NE');
  near('token: 77.8 ft from that crossing', ne.distanceFt, 77.85, 0.05);
  eq('token: NE crossing leads to hex_17_9',
     neighbour(16, 10, ne.edge), EXITS_16_10.NE);

  // At dead centre every edge is one apothem away.
  near('nearestEdge: centre is one apothem from the border',
       nearestEdge(0, 0).distanceFt, hexApothemFt(), 0.001);

  // A missing anchor must return null, not a plausible coordinate. An off-lattice
  // map (no world_origin_ft) is the live case, and a silent 0 would put every
  // such scene at the top-left corner of the continent.
  eq('worldFtFromPixels: no origin returns null',
     worldFtFromPixels({ ...anchor, worldOriginFt: null }, 0, 0), null);
  eq('verifyStampOrigin: no origin returns null',
     verifyStampOrigin({ hex: [16, 10], worldOriginFt: null }, CANVAS), null);
}

// ── Movement path + realtime clock (v14 planned-movement rework 2026-08-09) ──
{
  const { buildCheckpointPath, celerityAnimationSpeed, effectiveClockTick } =
    await import('../module/helpers/movement-path.mjs');

  // A 300px straight east move on a 64px spacing: ceil(300/64)=5 segments of
  // 60px each — every waypoint a checkpoint, last one exactly the destination.
  const p = buildCheckpointPath({ x: 1000, y: 500 }, { x: 1300, y: 500 }, 64);
  eq('checkpointPath: 300px/64 spacing -> 5 waypoints', p.length, 5);
  eq('checkpointPath: first at 1060', p[0], { x: 1060, y: 500, checkpoint: true });
  eq('checkpointPath: last is exactly the destination', p[4], { x: 1300, y: 500, checkpoint: true });
  // Even spacing: no segment exceeds the requested spacing.
  {
    let prev = { x: 1000, y: 500 }, maxSeg = 0;
    for (const w of p) { maxSeg = Math.max(maxSeg, Math.hypot(w.x - prev.x, w.y - prev.y)); prev = w; }
    eq('checkpointPath: no segment exceeds spacing', maxSeg <= 64, true);
  }
  // Zero-length declares still produce a single destination checkpoint.
  eq('checkpointPath: zero distance -> single dest waypoint',
     buildCheckpointPath({ x: 5, y: 5 }, { x: 5, y: 5 }, 64),
     [{ x: 5, y: 5, checkpoint: true }]);
  // Diagonal path lands exactly on the destination despite rounding.
  const d = buildCheckpointPath({ x: 0, y: 0 }, { x: 101, y: 67 }, 32);
  eq('checkpointPath: diagonal ends on destination', d[d.length - 1], { x: 101, y: 67, checkpoint: true });

  // Speed coupling: spike-verified live 2026-08-09 — a token overridden to
  // 1 space/s covered 31px in 1s on a 32px grid. Invariant: distance/wait at
  // the realtime rate. 320px over 1000 ticks at 0.5 ticks/ms = 2000ms travel
  // = 160 px/s = 5 spaces/s on a 32px grid.
  eq('animationSpeed: 320px over 1000 ticks @0.5t/ms on 32px grid',
     celerityAnimationSpeed(320, 1000, 0.5, 32), 5);
  eq('animationSpeed: degenerate inputs -> 0', celerityAnimationSpeed(0, 100, 0.5, 32), 0);
  eq('animationSpeed: floors at 0.05 so glides never stall',
     celerityAnimationSpeed(1, 1e9, 0.5, 32), 0.05);

  // Continuous clock: stored flag rules at rest; flows while running; commits
  // are monotonic (never backwards, even with a stale/absurd start time).
  eq('effectiveClock: not running -> stored', effectiveClockTick(null, 99999, 400), 400);
  eq('effectiveClock: running 2000ms @0.5t/ms from 400 -> 1400',
     effectiveClockTick({ running: true, startedAtMs: 10000, clockAtStart: 400, ticksPerMs: 0.5 }, 12000, 400), 1400);
  eq('effectiveClock: never below stored',
     effectiveClockTick({ running: true, startedAtMs: 10000, clockAtStart: 0, ticksPerMs: 0.5 }, 10100, 800), 800);
  eq('effectiveClock: clock skew (now < start) falls back to stored',
     effectiveClockTick({ running: true, startedAtMs: 20000, clockAtStart: 400, ticksPerMs: 0.5 }, 10000, 400), 400);
}

// ── Crafted spatial capacity: DIMINISHING, not linear (ruled 2026-08-10) ──
{
  const cap = F2.spatialCapacityFromCraft;
  const CFG = { spatialStorage: { capacityExponent: 0.5, capacityScale: 20 } };
  // Anchor: a divine craft (0.8) by the live jeweller Amina Wright — int mod
  // 314, so an average roll of ~345 — must land near the 300 lb the two
  // hand-authored rings carry. That is what capacityScale was solved for.
  eq('spatial cap: divine craft at the current jeweller ~297 lb',
     cap(345, 0.8, CFG), 297);
  eq('spatial cap: common craft at the same jeweller is a satchel',
     cap(345, 0.1, CFG), 37);
  // THE POINT OF THE RULING: a ~100x stat gap must NOT be a 100x capacity gap.
  // Amina 314 -> S-grade ~34,483 is 110x of mod; capacity grows ~10x.
  {
    const amina = cap(345, 0.8, CFG);
    const sGrade = cap(37900, 0.8, CFG);
    eq('spatial cap: 110x stat becomes ~10x capacity, not 110x',
       sGrade < amina * 12 && sGrade > amina * 8, true);
  }
  // Degenerate inputs must yield 0 so the caller falls back to the template
  // value rather than writing a zero-capacity "storage".
  eq('spatial cap: no roll yields 0', cap(0, 0.8, CFG), 0);
  eq('spatial cap: no magnifier yields 0', cap(345, 0, CFG), 0);
  eq('spatial cap: negative roll yields 0', cap(-50, 0.8, CFG), 0);
  // Monotonic in both arguments.
  eq('spatial cap: rarer craft always holds more',
     cap(345, 0.8, CFG) > cap(345, 0.4, CFG), true);
  eq('spatial cap: better roll always holds more',
     cap(700, 0.4, CFG) > cap(345, 0.4, CFG), true);
  // The shipped config must agree with the exponent this block reasons about.
  const { readFileSync } = await import('node:fs');
  const cfgSrc = readFileSync(new URL('../module/helpers/config.mjs', import.meta.url), 'utf8');
  const exp = Number(/capacityExponent:\s*([\d.]+)/.exec(cfgSrc)?.[1]);
  const scl = Number(/capacityScale:\s*([\d.]+)/.exec(cfgSrc)?.[1]);
  eq('spatial cap: shipped exponent parses', Number.isFinite(exp), true);
  eq('spatial cap: shipped exponent is the sqrt curve', exp, 0.5);
  eq('spatial cap: shipped scale is 20', scl, 20);
}

// ── Spatial storage rows (the de-duplicated capacity math) ──
{
  const { spatialStorageRows: rows } = F2;
  const mk = (id, name, cap, opts = {}) => ({ id, name, system: {
    spatialCapacity: cap, equipped: opts.equipped ?? false,
    storedIn: opts.storedIn ?? '', weight: opts.weight ?? 0,
    quantity: opts.quantity ?? 1 } });
  // Control: an ordinary item is not a storage, so it produces no row.
  eq('spatial: a non-storage yields no row', rows([mk('a', 'Sword', 0)]).length, 0);
  const ring = mk('r', 'Ring', 100, { equipped: true });
  const armour = mk('x', 'Plate', 0, { storedIn: 'r', weight: 30 });
  const arrows = mk('y', 'Arrows', 0, { storedIn: 'r', weight: 0.5, quantity: 20 });
  const loose  = mk('z', 'Rope', 0, { weight: 5 });
  const out = rows([ring, armour, arrows, loose]);
  eq('spatial: one storage row', out.length, 1);
  // 30 + (0.5 x 20) = 40 used. QUANTITY MUST COUNT - twenty arrows are not one.
  eq('spatial: used counts weight x quantity', out[0].used, 40);
  eq('spatial: free is capacity minus used', out[0].free, 60);
  eq('spatial: not over at 40 of 100', out[0].over, false);
  eq('spatial: equipped flag carried', out[0].equipped, true);
  // Loose items never count against a storage.
  eq('spatial: unstored items are ignored', rows([ring, loose])[0].used, 0);
  // Over-capacity must be detectable - a shrunk capacity strands contents.
  const small = mk('s', 'Thimble', 10, {});
  eq('spatial: over flag when contents exceed capacity',
     rows([small, mk('big', 'Anvil', 0, { storedIn: 's', weight: 50 })])[0].over, true);
  eq('spatial: free goes negative when over', 
     rows([small, mk('big', 'Anvil', 0, { storedIn: 's', weight: 50 })])[0].free, -40);
  // Contents of ANOTHER storage do not leak into this one.
  const r2 = mk('r2', 'Ring2', 100, {});
  eq('spatial: storages do not share contents',
     rows([ring, r2, armour])[1].used, 0);
}

// ── Debuff build-up threshold (generalised from Chilled -> Frozen) ──
{
  const { debuffBuildupTriggered: bt } = F2;
  eq('buildup control: parses as a function', typeof bt, 'function');
  // Chilled's shipped rule: total chill >= dexterity mod.
  eq('buildup: below the stat mod does not trigger', bt(400, 485, 0), false);
  eq('buildup: exactly the stat mod triggers',       bt(485, 485, 0), true);
  eq('buildup: above the stat mod triggers',         bt(600, 485, 0), true);
  // A zero total must NEVER trigger, even against a zero threshold - a target
  // already drained to 0 dex would otherwise transform on a no-op stack.
  eq('buildup: zero total never triggers',           bt(0, 0, 0), false);
  eq('buildup: zero threshold with real total is inert', bt(50, 0, 0), false);
  // Flat floor is a floor UNDER the stat, not an override.
  eq('buildup: flat floor used when higher than stat', bt(100, 20, 100), true);
  eq('buildup: stat wins when higher than flat floor', bt(100, 200, 50), false);
  // The live registry entry must stay coherent with the helper.
  const { readFileSync } = await import('node:fs');
  const cfgSrc = readFileSync(new URL('../module/helpers/config.mjs', import.meta.url), 'utf8');
  eq('buildup: chilled entry exists in config', /debuffBuildup\s*=\s*\{[\s\S]*?chilled:/.test(cfgSrc), true);
  eq('buildup: chilled transforms into frozen', /chilled:\s*\{[\s\S]*?into:\s*'frozen'/.test(cfgSrc), true);
  eq('buildup: chilled keys off dexterity', /chilled:\s*\{[\s\S]*?thresholdStat:\s*'dexterity'/.test(cfgSrc), true);
}

// ── Tag registration has a LABEL (the orphaned-reader guard) ──
// `pylon` sat unregistered for days while activities.mjs read it, so the
// radius branch could never fire. `mobile` is the same shape and is STILL
// unpopulated by design. A registered tag whose label key is missing from
// en.json renders as a raw i18n path in the picker, which is how these rot.
{
  const { readFileSync } = await import('node:fs');
  const en = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
  const A = en.ASPECTSOFPOWER ?? {};
  const dig = (path) => path.split('.').reduce((o, k) => (o ?? {})[k], A);
  // Positive control: a tag known to be registered and labelled for months.
  eq('lang control: ki system tag is labelled', typeof dig('SystemTag.ki.label'), 'string');
  eq('lang: pylon system tag is labelled', typeof dig('SystemTag.pylon.label'), 'string');
  eq('lang: pylon system tag has a description', typeof dig('SystemTag.pylon.desc'), 'string');
  eq('lang control: infused combat tag is labelled', typeof dig('Tag.infused'), 'string');
  eq('lang: effort combat tag is labelled', typeof dig('Tag.effort'), 'string');
  eq('lang: life-drain combat tag is labelled', typeof dig('Tag.lifeDrain'), 'string');
}

// ── CO-INVEST registry integrity (the orphaned-reader guard, applied to the
// thing that just STOPPED being one) ──
// `effort` and `life-drain` were registered tags with no reader for four days.
// The registry is now the reader, so every field it promises has to resolve:
// a typo'd potencyStat reads `undefined?.mod ?? 0` and silently prices the
// whole co-invest at ZERO damage, which looks exactly like "the tag does
// nothing" — the original defect wearing a new hat.
{
  const cfg = (await import('../module/helpers/config.mjs')).ASPECTSOFPOWER;
  const registry = cfg.coInvest ?? {};
  // Positive control: the registry has to be non-empty, or every eq() below
  // passes vacuously by iterating nothing.
  eq('co-invest: registry is populated', Object.keys(registry).length, 3);
  const RESOURCES = ['mana', 'stamina', 'health'];
  for (const [tag, def] of Object.entries(registry)) {
    eq(`co-invest ${tag}: tag is a registered combat tag`, typeof cfg.combatTags?.[tag], 'string');
    eq(`co-invest ${tag}: resource is a real pool`, RESOURCES.includes(def.resource), true);
    // Either a real ability, or the HOST_POTENCY sentinel meaning "scale by
    // whatever the attack already scales by". Anything else reads
    // `undefined?.mod ?? 0` and prices the whole co-invest at ZERO damage.
    eq(`co-invest ${tag}: potencyStat resolves`,
      def.potencyStat === cfg.HOST_POTENCY || typeof cfg.abilities?.[def.potencyStat] === 'string', true);
    eq(`co-invest ${tag}: capStat is a real ability`, typeof cfg.abilities?.[def.capStat], 'string');
    eq(`co-invest ${tag}: coef is a positive number`, def.coef > 0, true);
  }
  // One tag per pool — the whole ruling. Two tags naming the same resource
  // would make the resolver's "first registered match" arbitrary.
  eq('co-invest: one tag per resource',
    new Set(Object.values(registry).map(d => d.resource)).size, Object.keys(registry).length);
  // â šThe mana coefficient is NOT a copy of the spellstrike one, it IS it.
  // A copy would let the shipped fusion drift from this table on the next edit.
  eq('co-invest: infused coef is the spellstrike coef',
    registry.infused.coef, cfg.spellstrike.infusionCoef);
  // The measured renewability ladder (5 real actors, golden_baseline): stamina
  // regenerates in combat, mana does not, health is the death clock. Anything
  // that reorders these has changed the design, not tuned it.
  eq('co-invest: stamina is cheapest per point', registry.effort.coef < registry.infused.coef, true);
  eq('co-invest: health pays most per point', registry['life-drain'].coef > registry.infused.coef, true);
  // Channelling is a MAGIC act: only the mana pool buys damage at the cost of
  // celerity tempo. If a second tag ever claims it, computeActionWait will
  // charge channel time against a pool that never fed manaInvestAmount.
  eq('co-invest: only mana is channelled',
    Object.values(registry).filter(d => d.channelled).map(d => d.resource), ['mana']);
}

// ── resolveCoInvest: the dispatch, against the REAL config ──
// The rule that makes all three tags safe to author anywhere is "a tag naming
// the skill's own primary resource is IGNORED". Pin the negative controls, not
// just the positive one â€” a resolver that returned a descriptor for `effort`
// on a stamina strike would charge the pool twice and show a slider whose two
// ends fight each other.
{
  const cfg = (await import('../module/helpers/config.mjs')).ASPECTSOFPOWER;
  const prevConfig = globalThis.CONFIG;
  globalThis.CONFIG = { ASPECTSOFPOWER: cfg };
  const { resolveCoInvest } = await import('../module/systems/co-invest.mjs');
  // Aiden Fig, golden_baseline: int 759, wis 238, mana 418, hp 390, stam 161.
  const actor = {
    system: {
      mana: { value: 418 }, stamina: { value: 161 }, health: { value: 390 },
      abilities: {
        intelligence: { mod: 759 }, wisdom: { mod: 238 }, strength: { mod: 149 },
        toughness: { mod: 223 }, vitality: { mod: 208 }, endurance: { mod: 161 },
      },
    },
  };
  const skill = (tags) => ({ system: { tags } });
  const r = (tags, primaryResource) =>
    resolveCoInvest(actor, skill(tags), { primaryResource, tier: '', grade: 'D' });

  // Positive control: the shipped case, and it must reproduce the sim exactly
  // (grade D basic -> base 25, ref 25, cap 25 + 238x0.05 = 37).
  const infused = r(['infused'], 'stamina');
  eq('resolve: infused on a stamina strike resolves', infused?.resource, 'mana');
  eq('resolve: base cost is tier x grade', infused.baseCost, 25);
  eq('resolve: damage ref is grade-relative', infused.dmgRef, 25);
  eq('resolve: cap is wis-derived', infused.maxPool, 37);
  eq('resolve: potency is the int mod', infused.potency, 759);

  // â šNEGATIVE CONTROLS â€” no double-dipping one pool.
  eq('resolve: effort on a stamina strike is IGNORED', r(['effort'], 'stamina'), null);
  eq('resolve: infused on a mana cast is IGNORED', r(['infused'], 'mana'), null);
  eq('resolve: life-drain on a health cast is IGNORED', r(['life-drain'], 'health'), null);
  // ...but each is live the moment the primary is a different pool.
  eq('resolve: effort beside a mana cast', r(['effort'], 'mana')?.resource, 'stamina');
  // HOST_POTENCY: effort scales by the ATTACK's stat, not one of its own
  // (ruled 2026-08-10 — "that's where the effort is going"). Pass the swing's
  // blend and it must come straight back out; pass none and it must be 0
  // rather than silently falling back to some ability.
  eq('resolve: effort inherits the host potency',
    resolveCoInvest(actor, skill(['effort']),
      { primaryResource: 'mana', tier: '', grade: 'D', hostPotency: 761 }).potency, 761);
  eq('resolve: effort with no host potency is 0',
    r(['effort'], 'mana').potency, 0);
  // life-drain inherits too (ruled 2026-08-10) — life force has no dedicated
  // conversion stat, so a blood warrior converts through the weapon blend and
  // a blood mage through int.
  eq('resolve: life-drain inherits the host potency',
    resolveCoInvest(actor, skill(['life-drain']),
      { primaryResource: 'stamina', tier: '', grade: 'D', hostPotency: 761 }).potency, 761);
  // ...while infused does NOT, because intelligence IS mana's conversion stat
  // whatever the mana is poured into. Pass a host potency and it must be
  // ignored, or the spellstriker fusion quietly becomes a second effort.
  eq('resolve: infused ignores host potency',
    resolveCoInvest(actor, skill(['infused']),
      { primaryResource: 'stamina', tier: '', grade: 'D', hostPotency: 761 }).potency, 759);
  // Exactly one pool keeps a dedicated conversion stat. If a second ever
  // does, that is a design change and should have to announce itself here.
  eq('co-invest: only mana has its own conversion stat',
    Object.entries(cfg.coInvest).filter(([, d]) => d.potencyStat !== cfg.HOST_POTENCY)
      .map(([t]) => t), ['infused']);
  eq('resolve: life-drain beside a stamina strike', r(['life-drain'], 'stamina')?.resource, 'health');
  eq('resolve: no co-invest tag at all', r(['attack', 'melee'], 'stamina'), null);

  // Health holds back invest.healthFloor so the slider can never offer a
  // lethal commit â€” _commitCastCost clamps at 0, not 1.
  eq('resolve: health pool holds back the floor',
    r(['life-drain'], 'stamina').pool, 390 - cfg.invest.healthFloor);

  // An actor with no such pool is a refusal, not a free ride.
  const poorless = { system: { abilities: actor.system.abilities, stamina: { value: 10 } } };
  eq('resolve: missing pool refuses', resolveCoInvest(poorless, skill(['infused']),
    { primaryResource: 'stamina', tier: '', grade: 'D' }), null);
  // Too poor to meet the base is resolved-but-unaffordable, so the caller can
  // say so in chat rather than silently dropping the tag.
  const broke = { system: { ...actor.system, mana: { value: 3 } } };
  const b = resolveCoInvest(broke, skill(['infused']), { primaryResource: 'stamina', tier: '', grade: 'D' });
  eq('resolve: unaffordable still resolves', b?.resource, 'mana');
  eq('resolve: unaffordable is flagged', b.affordable, false);

  globalThis.CONFIG = prevConfig;
}

// ── Strain recovery rate (world clock, ruled 2026-08-10: HALF meditation) ──
{
  const { readFileSync } = await import('node:fs');
  const cfgSrc = readFileSync(new URL('../module/helpers/config.mjs', import.meta.url), 'utf8');
  const strainRate = Number(/recoveryPerHour:\s*([\d.]+)/.exec(cfgSrc)?.[1]);
  const medRate = Number(/ASPECTSOFPOWER\.meditation\s*=\s*\{[\s\S]*?baseFraction:\s*([\d.]+)/.exec(cfgSrc)?.[1]);
  // Positive control: both must actually parse, or the ratio below is a lie
  // told by two NaNs. (A probe that fails soft is a lie — house rule.)
  eq('strain: recoveryPerHour parses', Number.isFinite(strainRate), true);
  eq('strain: meditation baseFraction parses', Number.isFinite(medRate), true);
  eq('strain: recovery is 5% per hour', strainRate, 0.05);
  eq('strain: recovery is exactly HALF meditation', strainRate * 2, medRate);
  // The conversion divisor is solved so that one hour of meditation's worth of
  // mana costs one hour of strain — the time-neutrality anchor. Harvey, live:
  // mana 678, tough 201 -> 10% of mana = 68 gained; 68 / (201 * 7) = 0.0483.
  const divisor = Number(/conversionDivisor:\s*(\d+)/.exec(cfgSrc)?.[1]);
  eq('strain: conversionDivisor parses', Number.isFinite(divisor), true);
  const harveyStrain = 68 / (201 * divisor);
  eq('strain: Harvey conversion is time-neutral (~1 hour of strain)',
     Math.abs(harveyStrain - strainRate) < 0.005, true);
}

/* ── Weapon wear: weight-scaled damage limit ───────────────────────────── */
{
  // GOLDEN NUMBERS from the live party (wear_dump 2026-08-15) at the ruled
  // anchor 140. limit = 3 x progress x weight/140.
  const cfg = { limitPerProgress: 3, referenceWeight: 140 };
  const lim = (p, w) => F2.weaponDamageLimit(p, w, cfg);
  const near = (name, got, want, tol = 0.005) => {
    if (Math.abs(got - want) > tol) { console.error('FAIL ' + name + ': got ' + got + ' want ' + want); failures++; }
    else console.log('ok   ' + name);
  };
  near('weaponWear: Phil claymore 306/200 -> 1311.4', lim(306, 200), 1311.43, 0.01);
  near('weaponWear: Gabriel dagger 352/60 -> 452.6', lim(352, 60), 452.57, 0.01);
  near('weaponWear: George axe 400/220 -> 1885.7', lim(400, 220), 1885.71, 0.01);
  eq('weaponWear: Faye staff 330/140 unchanged from legacy', lim(330, 140), 3 * 330);
  // Revert dials: zero weight or zero reference -> the weight-blind limit.
  eq('weaponWear: zero weight falls back to legacy', lim(352, 0), 1056);
  eq('weaponWear: referenceWeight 0 reverts to legacy',
     F2.weaponDamageLimit(352, 200, { limitPerProgress: 3, referenceWeight: 0 }), 1056);
  // Direction pin: mass tolerates force — heavier tolerates strictly more.
  eq('weaponWear: heavier tolerates more', lim(352, 200) > lim(352, 60), true);
  // Shipped knobs must match the ruling.
  {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../module/helpers/config.mjs', import.meta.url), 'utf8');
    const ref = Number(/weaponWear[\s\S]*?referenceWeight:\s*(\d+)/.exec(src)?.[1]);
    const per = Number(/weaponWear[\s\S]*?limitPerProgress:\s*(\d+)/.exec(src)?.[1]);
    eq('weaponWear: shipped referenceWeight is the ruled 140', ref, 140);
    eq('weaponWear: shipped limitPerProgress keeps the legacy 3', per, 3);
  }
}

/* ── Equipment summons (Threadcutter exemplar) ─────────────────────────── */
{
  // GOLDEN ANCHOR from the 2026-08-15 ruling: Gabriel, class level 78,
  // rare summon skill, lands the epic-band 54 total. The whole ladder is
  // the unarmedGrant proportions (÷45 × 0.70), so spot-check the ends too.
  const cfg = { ratePerLevelByRarity: {
    not_proficient: 0, neglected: 0.14, rusty: 0.28, inferior: 0.34, common: 0.42,
    uncommon: 0.56, rare: 0.70, epic: 0.84, legendary: 0.98, mythic: 1.12, divine: 1.26,
  } };
  eq('summonEquip: Gabriel anchor 78 x rare = 54', summonEquipmentBudget(78, 'rare', cfg), 54);
  eq('summonEquip: 78 x epic = 65', summonEquipmentBudget(78, 'epic', cfg), 65);
  eq('summonEquip: 78 x inferior = 26', summonEquipmentBudget(78, 'inferior', cfg), 26);
  eq('summonEquip: unknown rarity earns nothing', summonEquipmentBudget(78, 'artifact', cfg), 0);
  eq('summonEquip: level 0 earns nothing', summonEquipmentBudget(0, 'rare', cfg), 0);
  // Ladder proportions match unarmedGrant's (both ÷ their rare value).
  eq('summonEquip: epic/rare ratio matches unarmedGrant (54/45)',
     Math.abs(cfg.ratePerLevelByRarity.epic / cfg.ratePerLevelByRarity.rare - 54 / 45) < 1e-9, true);

  // Threadcutter's split: dex-heavy, per for seeing the threads, str for
  // the driving cut. 54 -> 22/16/16, summing exactly.
  const split = parseStatSplit('dexterity:0.4,perception:0.3,strength:0.3');
  eq('summonEquip: split parses to 3 entries', split.length, 3);
  const parts = distributeStatBudget(54, split);
  eq('summonEquip: 54 splits 22/16/16',
     JSON.stringify(parts.map(p => p.value)), JSON.stringify([22, 16, 16]));
  eq('summonEquip: parts sum to budget', parts.reduce((s, p) => s + p.value, 0), 54);
  // Largest-remainder tie goes to the EARLIER-listed ability.
  const tie = distributeStatBudget(55, split);
  eq('summonEquip: 55 tie-break favours listing order (22/17/16)',
     JSON.stringify(tie.map(p => p.value)), JSON.stringify([22, 17, 16]));
  // Relative weights normalise: 2:1 is two-thirds / one-third.
  const rel = distributeStatBudget(30, parseStatSplit('dexterity:2,strength:1'));
  eq('summonEquip: relative weights 2:1 over 30 = 20/10',
     JSON.stringify(rel.map(p => p.value)), JSON.stringify([20, 10]));
  // Junk in, refusal out — never a statless blade.
  eq('summonEquip: junk split parses empty', parseStatSplit('sharpness:very').length, 0);
  eq('summonEquip: empty split parses empty', parseStatSplit('').length, 0);

  // The shipped config must carry the golden ladder — a drifted knob would
  // silently re-price the blade while these numbers kept passing.
  const { readFileSync } = await import('node:fs');
  const cfgSrc = readFileSync(new URL('../module/helpers/config.mjs', import.meta.url), 'utf8');
  const liveRare = Number(/summonEquipment[\s\S]*?rare:\s*([\d.]+)/.exec(cfgSrc)?.[1]);
  eq('summonEquip: shipped rare rate parses', Number.isFinite(liveRare), true);
  eq('summonEquip: shipped rare rate is the 0.70 anchor', liveRare, 0.70);
}

// ── Defence-time budget (design-defense-time-budget, ruled 2026-08-16) ──
// B=0.25 x k=0.25, swept on the live party 2026-08-16: heavy dodge rate
// binds at 63% (triage), chips rationally eaten, 3v1 in 1.2r.
{
  const F3 = await import('../module/helpers/formulas.mjs');
  const near = (label, got, want, tol = 0.01) => {
    if (Math.abs(got - want) <= tol) { console.log(`ok   ${label}`); }
    else { console.error(`FAIL ${label}: got ${got}, want ${want}`); failures++; }
  };
  const cfg = { defenseTimeBudgetFraction: 0.20, defenseTimeHeftFraction: 0.08,
    defenseDiveSurchargeRate: 0.2 };
  // HEFT BASIS (ruled 2026-08-16): cost = kw x heft/100 x DEFENDER round.
  // Anchors at a level-55 defender round of 4444 (the sim's rabbit):
  near('defBudget: round 4444 -> cap 888.8', F3.defenseTimeBudgetMax(4444, cfg), 888.8);
  eq('defBudget: dagger flick (60) costs 213', F3.defenseTimeCost(60, 4444, cfg), 213);
  eq('defBudget: greatsword arc (200) costs 711', F3.defenseTimeCost(200, 4444, cfg), 711);
  eq('defBudget: cap banks one greatsword arc',
     F3.defenseTimeBudgetMax(4444, cfg) > F3.defenseTimeCost(200, 4444, cfg), true);
  // Charged smash: heft = weight x awm — Guard Breaker (200 x 1.5 = 300)
  // crosses the cap and becomes a DIVE.
  eq('defBudget: Guard Breaker heft 300 is over-cap',
     F3.defenseTimeCost(300, 4444, cfg) > F3.defenseTimeBudgetMax(4444, cfg), true);
  // Surcharge (supersedes overdraw debt): SR x stamMax x excess/cap.
  const cap = F3.defenseTimeBudgetMax(4444, cfg);
  eq('defBudget: in-cap blow has zero surcharge',
     F3.defenseDiveSurcharge(F3.defenseTimeCost(200, 4444, cfg), cap, 200, cfg), 0);
  eq('defBudget: Willy-cast (290) surcharge ~3% of 200 stamina',
     F3.defenseDiveSurcharge(F3.defenseTimeCost(290, 4444, cfg), cap, 200, cfg), 6);
  eq('defBudget: grand+staff (840) surcharge ~47% of 200 stamina',
     F3.defenseDiveSurcharge(F3.defenseTimeCost(840, 4444, cfg), cap, 200, cfg), 94);
  // Never free, zero-safe.
  eq('defBudget: cost floors at 1', F3.defenseTimeCost(0.1, 4444, cfg), 1);
  eq('defBudget: zero round -> zero budget', F3.defenseTimeBudgetMax(0, cfg), 0);
  eq('defBudget: zero cap -> zero surcharge', F3.defenseDiveSurcharge(500, 0, 200, cfg), 0);
  // Spell-tier heft pins (defence side excludes the implement): bolts are
  // dodges, mountains are dives.
  eq('defBudget: basic working (130) is a dodge', F3.defenseTimeCost(130, 4444, cfg) < cap, true);
  eq('defBudget: greater working (200) is a dodge', F3.defenseTimeCost(200, 4444, cfg) < cap, true);
  eq('defBudget: major working (400) is a DIVE', F3.defenseTimeCost(400, 4444, cfg) > cap, true);
  eq('defBudget: grand working (700) is a DIVE', F3.defenseTimeCost(700, 4444, cfg) > cap, true);
  // Shipped knobs must carry the ruled values — B/kw is a RIDGE (2.5):
  // tune both together or not at all.
  const { readFileSync: rfs } = await import('node:fs');
  const src = rfs(new URL('../module/helpers/config.mjs', import.meta.url), 'utf8');
  eq('defBudget: shipped model is budget', /defenseEconModel:\s*'budget'/.test(src), true);
  eq('defBudget: shipped B is 0.20', Number(/defenseTimeBudgetFraction:\s*([\d.]+)/.exec(src)?.[1]), 0.20);
  eq('defBudget: shipped kw is 0.08', Number(/defenseTimeHeftFraction:\s*([\d.]+)/.exec(src)?.[1]), 0.08);
  eq('defBudget: shipped SR is 0.2', Number(/defenseDiveSurchargeRate:\s*([\d.]+)/.exec(src)?.[1]), 0.2);
  eq('defBudget: shipped ridge B/kw = 2.5',
     Number(/defenseTimeBudgetFraction:\s*([\d.]+)/.exec(src)?.[1]) / Number(/defenseTimeHeftFraction:\s*([\d.]+)/.exec(src)?.[1]), 2.5);

  // ── Dual-wield body floor (design-dual-wield-tempo, ladder ruled
  //    2026-08-15, re-validated under the budget economy 2026-08-16) ──
  const DW = { enabled: true, untrainedFloor: 0.95,
    floorByRarity: { common: 0.85, uncommon: 0.80, rare: 0.72, epic: 0.65, legendary: 0.55 } };
  eq('dualWield: untrained floor 0.95', F3.dualWieldFloor(null, true, DW), 0.95);
  eq('dualWield: rare floor 0.72', F3.dualWieldFloor('rare', true, DW), 0.72);
  eq('dualWield: legendary floor 0.55', F3.dualWieldFloor('legendary', true, DW), 0.55);
  eq('dualWield: non-alternating swing is 1', F3.dualWieldFloor('legendary', false, DW), 1);
  eq('dualWield: disabled reverts to 1', F3.dualWieldFloor('legendary', true, { ...DW, enabled: false }), 1);
  eq('dualWield: unknown rarity falls to untrained', F3.dualWieldFloor('sharpness', true, DW), 0.95);
  // Shipped ladder pins — a drifted knob re-prices every dual build silently.
  eq('dualWield: shipped untrained 0.95', Number(/untrainedFloor:\s*([\d.]+)/.exec(src)?.[1]), 0.95);
  eq('dualWield: shipped legendary 0.55', Number(/legendary:\s*([\d.]+)/.exec(src)?.[1]), 0.55);
}

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll pure-function tests pass.');

