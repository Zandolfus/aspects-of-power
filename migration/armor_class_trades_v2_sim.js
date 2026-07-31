/**
 * ARMOUR CLASS TRADES v2 — the user's model, 2026-07-30.
 *
 *   heavy  (metal)   ADDS WEIGHT TO ATTACKS, FOR FREE
 *   medium (leather) STAMINA cost reduction
 *   light  (cloth)   MANA cost reduction
 *
 * All three are BENEFITS, all continuous, none touch the dice band - which is
 * what killed v1 (armor_class_trades_sim.js: the heavy dodge penalty was inert
 * at every magnitude AND every proficiency tier, and the medium dodge bonus
 * was a 21->100% cliff).
 *
 * "FOR FREE" is the whole trick. Weight already drives TWO things:
 *     windup = weight x skillMult / 100          -> damage
 *     wait   = weight x mult x SCALE / speed     -> tempo
 * Heavy armour adds its mass to the FIRST only. You put the armour behind the
 * blow without swinging any slower. The armour's real cost stays where it
 * already is - metal is the least dodgeable, least mobile class, and that is
 * priced in the existing wall/mobility trade rather than a new penalty.
 *
 * PROFICIENCY scales each benefit x p (the shipped 16.7%/tier ladder), so
 * mastery of plate means MORE of the armour's mass reaches the target.
 * Class is a weighted SHARE, so Phil (73% metal) gets 73% of the effect.
 *
 * LIVE PULL 2026-07-30. Damage figures normalised to common tier (live/1.167).
 */

'use strict';

const LADDER = { rusty: 0.4, common: 0.6, uncommon: 0.7, rare: 0.8, legendary: 1.0, divine: 1.2 };
const p = (t) => LADDER[t] / LADDER.common;
const TIERS = ['rusty', 'common', 'uncommon', 'rare', 'legendary', 'divine'];

const A = {
  Phil:    { w: 200, dmgC: 877,  stam: 184, mana: 98,  metal: 0.73, leather: 0.03, cloth: 0,    wait: 2725, rrl: 4338 },
  George:  { w: 220, dmgC: 1160, stam: 225, mana: 285, metal: 0.69, leather: 0,    cloth: 0,    wait: 2503, rrl: 4157 },
  Khalid:  { w: 180, dmgC: 847,  stam: 344, mana: 185, metal: 0,    leather: 1.00, cloth: 0,    wait: 2163, rrl: 4520 },
  Frieda:  { w: 130, dmgC: 1225, stam: 268, mana: 173, metal: 0,    leather: 1.00, cloth: 0,    wait: 1656, rrl: 4293 },
  Gabriel: { w: 60,  dmgC: 257,  stam: 400, mana: 396, metal: 0,    leather: 0,    cloth: 0,    wait: 695,  rrl: 4066 },
  Aiden:   { w: 100, dmgC: 400,  stam: 200, mana: 407, metal: 0,    leather: 1.00, cloth: 0,    wait: 1400, rrl: 4400 },
  Olivia:  { w: 0,   dmgC: 0,    stam: 120, mana: 570, metal: 0,    leather: 0,    cloth: 1.00, wait: 2000, rrl: 4500 },
  Willy:   { w: 0,   dmgC: 0,    stam: 150, mana: 722, metal: 0,    leather: 0,    cloth: 1.00, wait: 2000, rrl: 4500 },
  Harvey:  { w: 140, dmgC: 300,  stam: 180, mana: 678, metal: 0,    leather: 0.32, cloth: 0.68, wait: 2200, rrl: 4451 },
};
const D = {
  Phil:   { wall: 912, dr: 256, hp: 1388 },
  George: { wall: 697, dr: 142, hp: 1258 },
  Khalid: { wall: 508, dr: 87,  hp: 818 },
  Frieda: { wall: 357, dr: 119, hp: 641 },
  Gabriel:{ wall: 187, dr: 138, hp: 748 },
};

// heavy: +W weight into the windup only
const dmgWith = (a, W, t) => a.w > 0
  ? Math.round(a.dmgC * ((a.w + W * a.metal * p(t)) / a.w))
  : 0;
// medium/light: cost reduction -> effective pool
const effPool = (pool, rate, share, t) => Math.round(pool / (1 - Math.min(0.75, rate * share * p(t))));

const pad = (s, n) => String(s).padStart(n);

console.log('=== 1. HEAVY: how much weight, and what does it do to damage? ===');
console.log('At COMMON proficiency. Only Phil (73% metal) and George (69%) wear any.\n');
console.log('bonus W   Phil windup/dmg          George windup/dmg');
for (const W of [0, 20, 40, 60, 80]) {
  let row = String(W).padEnd(10);
  for (const n of ['Phil', 'George']) {
    const a = A[n];
    const wu = (a.w + W * a.metal) / 100;
    const d = dmgWith(a, W, 'common');
    row += pad(wu.toFixed(2) + ' / ' + d + ' (+' + Math.round(100 * (d / a.dmgC - 1)) + '%)', 24);
  }
  console.log(row);
}

console.log('\n=== 2. DOES IT CRACK THE TANK STALEMATE? net damage per hit, W=40 ===');
console.log('The live matchups where the wall currently wins:\n');
console.log('matchup             now      W=40    W=40 mastered(divine)');
for (const [an, dn] of [['George', 'Phil'], ['Phil', 'George'], ['Khalid', 'Phil'], ['Phil', 'Phil'], ['George', 'George']]) {
  const a = A[an], d = D[dn];
  const base = Math.max(0, Math.round(a.dmgC * 1.167) - d.wall - d.dr);
  const w40  = Math.max(0, Math.round(dmgWith(a, 40, 'uncommon') * 1.167) - d.wall - d.dr);
  const wDiv = Math.max(0, Math.round(dmgWith(a, 40, 'divine') * 1.167) - d.wall - d.dr);
  console.log(`${(an + ' -> ' + dn).padEnd(19)} ${pad(base, 5)}   ${pad(w40, 6)}    ${pad(wDiv, 6)}`);
}

console.log('\n=== 3. PROFICIENCY LADDER on the heavy benefit (W=40) ===\n');
console.log('tier         Phil dmg      George dmg    George -> Phil net');
for (const t of TIERS) {
  const pd = dmgWith(A.Phil, 40, t), gd = dmgWith(A.George, 40, t);
  const net = Math.max(0, Math.round(gd * 1.167) - D.Phil.wall - D.Phil.dr);
  console.log(`${t.padEnd(12)} ${pad(pd, 9)} ${pad(gd, 13)} ${pad(net, 18)}`);
}

console.log('\n=== 4. MEDIUM: stamina reduction. Effective pool, and what it buys ===');
console.log('The leather wearers are exactly the stamina archetypes.\n');
console.log('rate      Khalid(344)    Frieda(268)   Aiden(200)   Harvey(180,32% lth)');
for (const r of [0.10, 0.15, 0.20, 0.30]) {
  let row = String(r).padEnd(9);
  for (const n of ['Khalid', 'Frieda', 'Aiden', 'Harvey']) {
    const a = A[n];
    const e = effPool(a.stam, r, a.leather, 'common');
    row += pad(e + ' (+' + Math.round(100 * (e / a.stam - 1)) + '%)', 14);
  }
  console.log(row);
}
console.log('\nSame at DIVINE leather proficiency:');
for (const r of [0.10, 0.15, 0.20]) {
  let row = String(r).padEnd(9);
  for (const n of ['Khalid', 'Frieda', 'Aiden', 'Harvey']) {
    const a = A[n];
    const e = effPool(a.stam, r, a.leather, 'divine');
    row += pad(e + ' (+' + Math.round(100 * (e / a.stam - 1)) + '%)', 14);
  }
  console.log(row);
}

console.log('\n=== 5. STAMINA REDUCTION IN PRACTICE: rider procs, the real stamina sink ===');
console.log('Gabriel Hemorrhage costs 0.20 x parent damage = 60. Khalid/Frieda pay the same shape.\n');
console.log('rate      Frieda procs affordable (268 pool, 60/proc)   Khalid (344 pool)');
for (const r of [0, 0.15, 0.30]) {
  const f = effPool(A.Frieda.stam, r, 1, 'common'), k = effPool(A.Khalid.stam, r, 1, 'common');
  console.log(`${String(r).padEnd(9)} ${pad(Math.floor(f / 60) + ' procs (pool ' + f + ')', 42)}  ${Math.floor(k / 60)} procs (pool ${k})`);
}

console.log('\n=== 6. LIGHT: mana reduction (unchanged from v1 - it was the one that worked) ===\n');
console.log('rate      Olivia(570)   Willy(722)   Harvey(678, 68% cloth)');
for (const r of [0.10, 0.15, 0.20, 0.30]) {
  let row = String(r).padEnd(9);
  for (const n of ['Olivia', 'Willy', 'Harvey']) {
    const a = A[n];
    const e = effPool(a.mana, r, a.cloth, 'common');
    row += pad(e + ' (+' + Math.round(100 * (e / a.mana - 1)) + '%)', 13);
  }
  console.log(row);
}

console.log('\n=== 7. SYMMETRY CHECK: is any class runaway-better at the SAME rate? ===');
console.log('W=40 heavy, 0.15 medium, 0.15 light, all at uncommon (live tier):\n');
console.log('  Phil    (73% heavy)  damage ' + A.Phil.dmgC + ' -> ' + dmgWith(A.Phil, 40, 'uncommon')
  + '  (+' + Math.round(100 * (dmgWith(A.Phil, 40, 'uncommon') / A.Phil.dmgC - 1)) + '%)');
console.log('  George  (69% heavy)  damage ' + A.George.dmgC + ' -> ' + dmgWith(A.George, 40, 'uncommon')
  + '  (+' + Math.round(100 * (dmgWith(A.George, 40, 'uncommon') / A.George.dmgC - 1)) + '%)');
console.log('  Khalid  (100% med)   stamina ' + A.Khalid.stam + ' -> ' + effPool(A.Khalid.stam, 0.15, 1, 'uncommon')
  + '  (+' + Math.round(100 * (effPool(A.Khalid.stam, 0.15, 1, 'uncommon') / A.Khalid.stam - 1)) + '%)');
console.log('  Olivia  (100% light) mana ' + A.Olivia.mana + ' -> ' + effPool(A.Olivia.mana, 0.15, 1, 'uncommon')
  + '  (+' + Math.round(100 * (effPool(A.Olivia.mana, 0.15, 1, 'uncommon') / A.Olivia.mana - 1)) + '%)');
console.log('\n  Light weapons in plate? A dagger user in full metal:');
const gabInPlate = { ...A.Gabriel, metal: 1.0 };
console.log('    Gabriel w60 dmg 257 -> ' + dmgWith(gabInPlate, 40, 'uncommon')
  + ' (+' + Math.round(100 * (dmgWith(gabInPlate, 40, 'uncommon') / 257 - 1)) + '%)  <-- % gain is LARGEST on light weapons');

console.log('\n=== 8. FLAT vs PROPORTIONAL weight bonus ===');
console.log('FLAT (+W weight) is physically honest - your body has the mass it has - but the');
console.log('windup is a RATIO, so a flat add is worth far more to a light weapon. That inverts');
console.log('the whole point of weapon weight and hands a dagger greatsword damage at dagger');
console.log('speed - the "best of both worlds" the fusion coef exists to prevent.');
console.log('PROPORTIONAL (+F x weaponWeight) gives every weapon the same % for the same share.\n');
const dmgProp = (a, F, t) => a.w > 0 ? Math.round(a.dmgC * (1 + F * a.metal * p(t))) : 0;
console.log('wielder (in FULL metal)   weapon   FLAT W=40        PROPORTIONAL F=0.20');
for (const n of ['Gabriel', 'Frieda', 'Khalid', 'Phil', 'George']) {
  const a = { ...A[n], metal: 1.0 };
  const f = dmgWith(a, 40, 'uncommon'), pr = dmgProp(a, 0.20, 'uncommon');
  console.log(`${n.padEnd(25)} ${pad(a.w, 6)}   ${pad('+' + Math.round(100 * (f / a.dmgC - 1)) + '%', 8)}         ${pad('+' + Math.round(100 * (pr / a.dmgC - 1)) + '%', 8)}`);
}
console.log('\nProportional at each PC\'s REAL metal share, F=0.20, uncommon:');
for (const n of ['Phil', 'George', 'Khalid', 'Olivia']) {
  const a = A[n];
  const pr = dmgProp(a, 0.20, 'uncommon');
  console.log(`  ${n.padEnd(9)} metal ${(a.metal * 100).toFixed(0).padStart(3)}%  damage ${a.dmgC} -> ${pr}`
    + `  (+${Math.round(100 * ((pr || a.dmgC) / (a.dmgC || 1) - 1))}%)`);
}
console.log('\nDoes proportional still crack the stalemate? George -> Phil, F=0.20:');
for (const t of TIERS) {
  const gd = dmgProp(A.George, 0.20, t);
  const net = Math.max(0, Math.round(gd * 1.167) - D.Phil.wall - D.Phil.dr);
  console.log(`  ${t.padEnd(11)} George damage ${pad(gd, 5)}   net through Phil ${pad(net, 4)}   (was 186)`);
}
