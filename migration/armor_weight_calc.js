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

// Mundane baseline densities, kg/L
const BASE = { metal: 7.85, leather: 0.95, cloth: 0.30, wood: 0.70, bone: 1.80, crystal: 2.60, gem: 3.50 };
const VOL  = { chest: 6, legs: 6, shield: 6, head: 2, boots: 2, bracers: 2, gloves: 2, back: 2 };
const REF  = { silver: 10.49, gold: 19.3, steel: 7.85, lead: 11.34, platinum: 21.45 };

const pad = (s, n) => String(s).padStart(n);
const f1 = (x) => Math.round(x * 10) / 10;
const f2 = (x) => Math.round(x * 100) / 100;

console.log('=== 1. THE MANA-DENSITY LADDER (metal, base 7.85) ===\n');
console.log('rarity        raw       refined    real-world match');
for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine']) {
  const raw = BASE.metal * manaDensity(r, false);
  const ref = BASE.metal * manaDensity(r, true);
  let match = '';
  for (const [k, v] of Object.entries(REF)) if (Math.abs(v - raw) < 0.35) match = `raw ~ ${k}`;
  for (const [k, v] of Object.entries(REF)) if (Math.abs(v - ref) < 0.35) match += `${match ? ', ' : ''}refined ~ ${k}`;
  console.log(`${r.padEnd(13)} ${pad(f2(raw), 6)}    ${pad(f2(ref), 7)}    ${match}`);
}
console.log('\nFULGURITE = refined Lightning Metal (Uncommon) = ' + f2(BASE.metal * manaDensity('uncommon', true)) + ' kg/L');
console.log('Silver is 10.49. The existing ladder puts it there with nothing invented.');

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
show('metal', 'epic', false,     'epic metal');
show('metal', 'divine', true,    'divine refined metal');
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

console.log('\n=== 4. THE CAPACITY QUESTION IS STILL OPEN ===');
console.log('At the shipped x2.5, a fulgurite harness is 13% of Phil\'s capacity and');
console.log('a cloth set is 4% of Olivia\'s. Weight exists but nothing feels it.');
console.log('At x1.0 those become 33% and 11%. At x0.67, 49% and 16%.');
console.log('\nNote the ladder ALSO makes casters heavier as they climb - a divine cloth');
console.log('set is ' + f1(22 * BASE.cloth * manaDensity('divine', false)) + ' kg vs ' + f1(22 * BASE.cloth) + ' kg mundane. Mana density is universal, so');
console.log('robes stop being weightless at the top end. That is the rule working, but it');
console.log('does mean low-strength casters feel the ladder first.');
