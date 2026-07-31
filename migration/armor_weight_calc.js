/**
 * ARMOUR WEIGHTS — volume x density, where DENSITY RISES WITH MANA DENSITY.
 * 2026-07-30.
 *
 * RULED 2026-07-30 (user):
 *   - "AOP armor is super thick and heavy" — the volume baselines stand, and
 *     the ~7x-historical result is INTENDED, not a miscalibration.
 *   - "Materials in general are heavier and get heavier as their mana density
 *     increases." Denser = more magical. The inverse of the usual mithril
 *     trope, and a real worldbuilding commitment.
 *
 * Volume of material per piece (user baseline):
 *   chest 6 L · legs 6 L · shield 6 L · everything else 2 L
 *
 * MANA DENSITY IS ALREADY IN THE DATA. Material items carry `rarity`,
 * `isRefined` and `materialElement`. Live world:
 *   Lightning Metal (Uncommon)  metal   uncommon  raw      lightning
 *   Fulgurite                   metal   uncommon  REFINED  lightning
 *   Outer Leather               leather rare      raw      -
 *   Lunar/Solar/Water Crystal   crystal epic      raw      elemental
 *   Aetherwood / Sacred Wood    wood    rare      raw      elemental
 * So Fulgurite IS refined Lightning Metal - the refining step is what makes it.
 *
 * THE FIT: reuse the shipped skillRarities ladder as the mana-density ladder,
 * anchored at common, with REFINING WORTH ONE TIER. Fulgurite is uncommon +
 * refined = rare-equivalent = 1.333x, and 7.85 x 1.333 = 10.47 kg/L.
 * Silver is 10.49. The user remembered fulgurite as "silver or gold" — the
 * existing ladder lands it on silver to two decimal places, with no new
 * constant invented.
 */

'use strict';

/* ⚠ UNITS: carryCapacity is in POUNDS (user, 2026-07-30). Densities below are
 * kg/L, so every comparison against capacity MUST convert. Getting this wrong
 * understated every armour load by 2.2x and produced a false conclusion that
 * "weights alone change nothing" — in pounds the loads are already meaningful
 * at the SHIPPED str x 2.5 and capacity needs no rework at all. */
const KG_PER_LB = 0.45359237;
const LB = (kg) => kg / KG_PER_LB;

// Shipped ladder (CONFIG.ASPECTSOFPOWER.skillRarities), anchored at common.
const RARITY = { not_proficient: 0.2, neglected: 0.3, rusty: 0.4, inferior: 0.5,
  common: 0.6, uncommon: 0.7, rare: 0.8, epic: 0.9, legendary: 1.0, mythic: 1.1, divine: 1.2 };
const ORDER = Object.keys(RARITY);
const ANCHOR = 'common';

/** mana-density multiplier: rarity, plus one tier for refining */
function manaDensity(rarity, refined) {
  const i = Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(rarity) + (refined ? 1 : 0)));
  return RARITY[ORDER[i]] / RARITY[ANCHOR];
}

// Mundane baseline densities, kg/L. These are the MATERIAL's own density -
// gold is heavy because gold is heavy, not because it is magical. Mana density
// multiplies on top of whichever species you started from.
const BASE = { metal: 7.85, leather: 0.95, cloth: 0.30, wood: 0.70, bone: 1.80, crystal: 2.60, gem: 3.50,
               gold: 19.3, silver: 10.49 };
const VOL  = { chest: 6, legs: 6, shield: 6, head: 2, boots: 2, bracers: 2, gloves: 2, back: 2 };
const REF  = { silver: 10.49, steel: 7.85, lead: 11.34 };

// THE LADDER (RULED 2026-07-30, verbatim):
//   inferior, common, uncommon, rare, epic, legendary, mythic, (...), divine
//
// Note the GAP. Divine is NOT mythic+1 - there are unnamed tiers between them,
// which is what makes divine godlike rather than merely the next rung. The
// three sub-inferior entries in config (not_proficient, neglected, rusty) are
// a DEGRADED band below the ladder proper, not rungs on it; they exist so
// "untrained counts as rusty" has somewhere to point.
//
// Everything above MYTHIC is out of play. Mythic = super genius, legendary =
// exceptional, uncommon = the average person's ceiling and where the entire
// live roster sits.
const LADDER_PROPER = ['inferior', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const BAND = { uncommon: 'the average person', legendary: 'exceptional people', mythic: 'a super genius' };

const pad = (s, n) => String(s).padStart(n);
const f1 = (x) => Math.round(x * 10) / 10;
const f2 = (x) => Math.round(x * 100) / 100;

console.log('=== 1. THE MANA-DENSITY LADDER (steel-species metal, base 7.85) ===');
console.log('Ladder: inferior, common, uncommon, rare, epic, legendary, mythic, (...), divine');
console.log('Stops at MYTHIC. The (...) and divine are out of play entirely.\n');
console.log('rarity        raw       refined    who reaches it');
for (const r of LADDER_PROPER) {
  const raw = BASE.metal * manaDensity(r, false);
  const ref = BASE.metal * manaDensity(r, true);
  console.log(`${r.padEnd(13)} ${pad(f2(raw), 6)}    ${pad(f2(ref), 7)}    ${BAND[r] ?? ''}`);
}
console.log('   (...)         --         --     unnamed tiers, unreachable');
console.log('   divine        --         --     godlike, lore only');
console.log('\nFULGURITE = refined Lightning Metal (Uncommon) = ' + f2(BASE.metal * manaDensity('uncommon', true)) + ' kg/L');
console.log('Silver is 10.49. The existing ladder puts it there with nothing invented.');
console.log('\nGOLD is not a mana tier - it is a dense SPECIES (19.3 kg/L mundane). A gold');
console.log('item is heavy because gold is heavy. Species sets the base, mana density');
console.log('multiplies on top, and the two are independent.');

console.log('\n=== 2. WEIGHT PER PIECE, by material and mana tier ===\n');
const show = (cls, rarity, refined, label) => {
  const d = BASE[cls] * manaDensity(rarity, refined);
  const set = (VOL.chest + VOL.legs + VOL.head + VOL.boots + VOL.bracers + VOL.gloves + VOL.back) * d;
  console.log(`${label.padEnd(30)} ${pad(f2(d), 6)} kg/L   chest ${pad(f1(VOL.chest * d), 6)}   small ${pad(f1(VOL.head * d), 5)}   SET ${pad(f1(set), 6)} kg`);
};
console.log('material                        density     chest        piece        full set');
show('metal', 'common', false,   'mundane steel');
show('metal', 'uncommon', false, 'Lightning Metal (raw)');
show('metal', 'uncommon', true,  'FULGURITE (refined)');
show('metal', 'legendary', false, 'legendary metal (exceptional)');
show('metal', 'mythic', true,    'mythic refined (super genius)');
show('gold', 'common', false,    'mundane GOLD (species, not tier)');
console.log('');
show('leather', 'common', false, 'mundane leather');
show('leather', 'rare', false,   'Outer Leather (rare)');
console.log('');
show('cloth', 'common', false,   'mundane cloth');
show('cloth', 'rare', false,     'Tent Cloth (rare)');

console.log('\n=== 3. THE LIVE SETS ===\n');
const SETS = [
  { n: 'Phil', cls: 'metal', rarity: 'uncommon', refined: true, str: 734, note: 'fulgurite/lightning plate' },
  { n: 'George', cls: 'metal', rarity: 'uncommon', refined: false, str: 888, note: 'lightning plate' },
  { n: 'Khalid', cls: 'leather', rarity: 'uncommon', refined: false, str: 700, note: 'leather + some metal' },
  { n: 'Frieda', cls: 'leather', rarity: 'rare', refined: false, str: 173, note: 'waywatcher leather' },
  { n: 'Olivia', cls: 'cloth', rarity: 'common', refined: false, str: 136, note: 'lunar weave' },
  { n: 'Willy', cls: 'cloth', rarity: 'common', refined: false, str: 91, note: 'cloth' },
];
console.log('actor      set                        kg     capacity(x2.5)  ratio   at x1.0  at x0.67');
for (const s of SETS) {
  const d = BASE[s.cls] * manaDensity(s.rarity, s.refined);
  const kg = (VOL.chest + VOL.legs + VOL.head + VOL.boots + VOL.bracers + VOL.gloves + VOL.back) * d;
  const cap = s.str * 2.5;
  console.log(`${s.n.padEnd(10)} ${s.note.padEnd(26)} ${pad(f1(kg), 6)} ${pad(Math.round(cap), 10)}`
    + `      ${pad((kg / cap).toFixed(2), 6)}  ${pad((kg / s.str).toFixed(2), 7)}  ${pad((kg / (s.str * 0.67)).toFixed(2), 8)}`);
}

console.log('\n=== 4. CAPACITY IS IN POUNDS — AND IT ALREADY WORKS ===');
console.log('Live metal wearers, armour load vs their lb capacity (str x 2.5):\n');
console.log('actor      str   cap(lb)  metal L   steel      SILVER      gold');
for (const p of [
  { n: 'John', str: 311, cap: 778, L: 22, other: 4.2 },
  { n: 'Phil', str: 734, cap: 1835, L: 26, other: 4.2 },
  { n: 'George', str: 879, cap: 2198, L: 18, other: 0 },
]) {
  const at = (d) => LB(p.L * d) + p.other;
  const cell = (d) => `${Math.round(at(d))}lb ${Math.round(100 * at(d) / p.cap)}%`;
  console.log(`${p.n.padEnd(10)} ${pad(p.str, 4)}  ${pad(p.cap, 6)}  ${pad(p.L, 6)}   ${pad(cell(BASE.metal), 10)} ${pad(cell(REF.silver), 11)} ${pad(cell(BASE.gold), 10)}`);
}
console.log('\nJOHN IS THE ANCHOR. He was AT capacity when he first crafted this gear and');
console.log('had to take leather boots instead of metal to stay under (user, 2026-07-30).');
console.log('Solving backwards from that anecdote:\n');
for (const [lbl, d] of [['steel', BASE.metal], ['SILVER', REF.silver], ['gold', BASE.gold]]) {
  const load = LB(22 * d) + 4.2;
  const strThen = (load / 2.5);
  const withMetalBoots = LB(24 * d);
  console.log(`  ${lbl.padEnd(7)} load ${Math.round(load)} lb -> he was at capacity at str ${Math.round(strThen)}`
    + `  (metal boots would have been ${Math.round(withMetalBoots)} lb)`
    + (strThen > 311 ? '   <-- IMPOSSIBLE, exceeds his CURRENT str' : ''));
}
console.log('\nStrength only grows, so any density implying a crafting-time strength ABOVE');
console.log('his current 311 is ruled out by the story itself.');
console.log('\n=== 5. HOW FAR THE LADDER ACTUALLY TRAVELS IN PLAY ===');
console.log('The live roster is UNCOMMON, which is also the average person\'s ceiling. So');
console.log('the realistic span for almost all content is common -> uncommon: ONE tier.');
console.log('The exceptional span reaches legendary, the super-genius span mythic.\n');
console.log('material        inferior   common   uncommon   legendary   mythic    full span');
for (const cls of ['metal', 'leather', 'cloth']) {
  const setV = VOL.chest + VOL.legs + VOL.head + VOL.boots + VOL.bracers + VOL.gloves + VOL.back;
  const at = (r) => f1(setV * BASE[cls] * manaDensity(r, false));
  console.log(`${cls.padEnd(15)} ${pad(at('inferior'), 7)}  ${pad(at('common'), 7)}  ${pad(at('uncommon'), 8)}  ${pad(at('legendary'), 10)} ${pad(at('mythic'), 8)}`
    + `    ${pad('x' + f2(manaDensity('mythic', false) / manaDensity('inferior', false)), 6)}`);
}
console.log('\nInferior to mythic is x2.2 across the whole playable ladder. The tier that');
console.log('matters most - common to uncommon, where nearly everyone lives - is x1.17.');
console.log('\nAnd because casters climb the same ladder, robes gain weight too: cloth goes '
  + f1(22 * BASE.cloth) + ' -> ' + f1(22 * BASE.cloth * manaDensity('mythic', false)) + ' kg.');
console.log('Low-strength casters feel that before anyone else, since Olivia\'s capacity is');
console.log('340 against Phil\'s 1835.');
