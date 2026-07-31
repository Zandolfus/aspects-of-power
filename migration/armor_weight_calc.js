/**
 * ARMOUR WEIGHTS from volume x density — calibration calc, 2026-07-30.
 *
 * User baseline (2026-07-30), volume of METAL per piece:
 *   chest 6 L · head 2 L · legs 6 L · boots 2 L · bracers 2 L
 *   gloves 2 L · back 2 L · shield 6 L
 * Fulgurite is "silver or gold" density (unresolved).
 *
 * WHAT THE WORLD ACTUALLY RECORDS: `item.system.material` holds the CLASS
 * (metal / leather / cloth / wood / bone / jewelry), never the species. It
 * covers 36 pieces whose TAGS miss the material, so it is the better key.
 * Species (fulgurite vs steel) is not stored anywhere - only 14 items name it.
 *
 * Live slot counts across 177 armour pieces:
 *   chest 37 · legs 25 · head 25 · boots 23 · bracers 22 · gloves 21 · back 22
 */

'use strict';

const VOL = { chest: 6, legs: 6, head: 2, boots: 2, bracers: 2, gloves: 2, back: 2, shield: 6 };
// kg per litre, real-world
const DENSITY = {
  steel: 7.85, iron: 7.87, bronze: 8.8, silver: 10.49, gold: 19.3,
  leather: 0.95, cloth: 0.30, wood: 0.70, bone: 1.80,
};
const SLOTS = Object.keys(VOL);

const pad = (s, n) => String(s).padStart(n);
const f1 = (x) => (Math.round(x * 10) / 10);

console.log('=== 1. YOUR VOLUMES, AS GIVEN (metal pieces) ===\n');
console.log('slot        litres   steel      silver     gold');
for (const s of SLOTS) {
  console.log(`${s.padEnd(11)} ${pad(VOL[s], 5)}   ${pad(f1(VOL[s] * DENSITY.steel) + ' kg', 9)}`
    + `  ${pad(f1(VOL[s] * DENSITY.silver) + ' kg', 9)}  ${pad(f1(VOL[s] * DENSITY.gold) + ' kg', 9)}`);
}
const setVol = VOL.chest + VOL.legs + VOL.head + VOL.boots + VOL.bracers + VOL.gloves + VOL.back;
console.log(`\nFULL SET (7 pieces, ${setVol} L):`);
for (const m of ['steel', 'silver', 'gold']) {
  console.log(`  ${m.padEnd(8)} ${f1(setVol * DENSITY[m])} kg`);
}

console.log('\n=== 2. REALITY CHECK ===');
console.log('A historical steel breastplate is 5-9 kg, i.e. roughly 0.9 L of steel.');
console.log(`Your 6 L chestpiece = ${f1(6 * DENSITY.steel)} kg, about 7x that.`);
console.log('A full historical harness is 20-30 kg; yours is ' + f1(setVol * DENSITY.steel) + ' kg.');
console.log('\nNot necessarily wrong - these characters have strength mods of 700-900 and');
console.log('carry capacities near 2000. But it is a deliberate 7x, so worth confirming.\n');
console.log('scale       chest      full steel set');
for (const [lbl, k] of [['as given', 1], ['half', 0.5], ['realistic', 1 / 7]]) {
  console.log(`${lbl.padEnd(11)} ${pad(f1(6 * DENSITY.steel * k) + ' kg', 9)}  ${pad(f1(setVol * DENSITY.steel * k) + ' kg', 9)}`);
}

console.log('\n=== 3. THE OTHER CLASSES — same garment volumes, density does the work ===\n');
console.log('slot        steel      leather    cloth');
for (const s of SLOTS) {
  console.log(`${s.padEnd(11)} ${pad(f1(VOL[s] * DENSITY.steel) + ' kg', 9)}  ${pad(f1(VOL[s] * DENSITY.leather) + ' kg', 9)}`
    + `  ${pad(f1(VOL[s] * DENSITY.cloth) + ' kg', 9)}`);
}
console.log(`\nFull sets:  steel ${f1(setVol * DENSITY.steel)} kg   leather ${f1(setVol * DENSITY.leather)} kg   cloth ${f1(setVol * DENSITY.cloth)} kg`);
console.log(`Ratio       ${f1(DENSITY.steel / DENSITY.cloth)} : ${f1(DENSITY.leather / DENSITY.cloth)} : 1`);
console.log('\nCompare the ARMOUR ratio the system already has: 2 : 1.33 : 1 (metal:leather:cloth');
console.log('per crafting progress). So plate would give 2x the protection for 26x the weight.');
console.log('That IS the trade - but note leather comes out nearly as light as cloth, which');
console.log('may want leather volumes raised (leather armour is bulkier than a robe).');

console.log('\n=== 4. DOES ANY OF IT MATTER? live carry capacities ===');
console.log('capacity = strength.mod x 2.5, and the live pull shows nobody near it.\n');
const PC = [
  { n: 'Phil', str: 734, carrying: 33, cls: 'steel' },
  { n: 'George', str: 888, carrying: 13, cls: 'steel' },
  { n: 'Khalid', str: 700, carrying: 154, cls: 'leather' },
  { n: 'Frieda', str: 173, carrying: 8, cls: 'leather' },
  { n: 'Olivia', str: 136, carrying: 18, cls: 'cloth' },
  { n: 'Willy', str: 91, carrying: 32, cls: 'cloth' },
];
console.log('actor      str    cap     set kg   ratio now   ratio with real weights');
for (const p of PC) {
  const cap = Math.round(p.str * 2.5);
  const setKg = f1(setVol * DENSITY[p.cls]);
  console.log(`${p.n.padEnd(10)} ${pad(p.str, 4)}  ${pad(cap, 5)}   ${pad(setKg, 7)}  ${pad((p.carrying / cap).toFixed(2), 9)}   ${pad(((p.carrying + setKg) / cap).toFixed(2), 12)}`);
}

console.log('\n=== 5. WHAT CAPACITY WOULD MAKE PLATE FEEL HEAVY? ===');
console.log('For a full steel set to be a MEANINGFUL fraction of a strong character:\n');
console.log('target ratio   required capacity coef (Phil, str 734, set ' + f1(setVol * DENSITY.steel) + ' kg)');
for (const t of [0.20, 0.35, 0.50]) {
  const cap = f1(setVol * DENSITY.steel) / t;
  console.log(`   ${(t * 100).toFixed(0)}%           str x ${(cap / 734).toFixed(2)}   (vs current x2.5)`);
}
console.log('\nCurrent coef 2.5 puts a full steel harness at ' + ((setVol * DENSITY.steel) / (734 * 2.5) * 100).toFixed(0) + '% of Phil\'s capacity.');
console.log('Weights alone change nothing unless this moves - encumbrance is the consumer.');
