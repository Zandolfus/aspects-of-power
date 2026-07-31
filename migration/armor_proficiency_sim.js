/**
 * ARMOUR PROFICIENCY — design sim, 2026-07-30.
 *
 * Motivated by proficiency_bothways_sim.js: worn armour sits on the 0%/tier
 * ladder while damage runs at 16.7%/tier, so the MORE armour you wear the LESS
 * mastery does for you (Phil's fortress grows +31% while damage grows +100%).
 * An armour proficiency is the obvious fix. This checks what it actually costs.
 *
 * LIVE PULL 2026-07-30 — per-material armour contributions read straight off
 * the equipment EFFECT pipeline (each effect carries system.itemSource, so the
 * source item's material tag classifies its share). Reconciled exactly against
 * defense.armor.value for all 14 armoured PCs, so these splits are the real
 * numbers, not a reconstruction.
 *
 * `untagged` = armour whose source item has no metal/leather/cloth tag
 * (Gabriel's whole set, plus part of Phil's and George's). It stays NEUTRAL
 * under every option — no material, no class, no proficiency.
 *
 * OPTIONS
 *   AP0  none                      baseline
 *   APA  anchor common, 16.7%/tier mirrors the weapon damage ladder exactly
 *   APB  anchor common, 10%/tier   mirrors the weapon TO-HIT ladder
 *   APC  anchor uncommon, 16.7%    re-anchored to where the roster actually is,
 *                                  so shipping it changes nothing on day one
 */

'use strict';

const LADDER = { rusty: 0.4, inferior: 0.5, common: 0.6, uncommon: 0.7, rare: 0.8,
                 epic: 0.9, legendary: 1.0, mythic: 1.1, divine: 1.2 };
const TIERS = ['common', 'uncommon', 'rare', 'legendary', 'divine'];
const steps = (t, anchor) => Math.round((LADDER[t] - LADDER[anchor]) / 0.1);

const OPT = {
  AP0: { label: 'none',              f: () => 1 },
  APA: { label: 'common / 16.7%',    f: (t) => LADDER[t] / LADDER.common },
  APB: { label: 'common / 10%',      f: (t) => 1 + 0.10 * steps(t, 'common') },
  APC: { label: 'uncommon / 16.7%',  f: (t) => LADDER[t] / LADDER.uncommon },
};
// damage / guard / parry ladder (shipped): 16.7% per tier off common
const dmgL = (t) => LADDER[t] / LADDER.common;

// ── LIVE ROSTER ─────────────────────────────────────────────────────────
const R = {
  Phil:    { metal: 436, leather: 15,  cloth: 0,   untagged: 148, guard: 313, dr: 256, hp: 1388, melee: 808 },
  George:  { metal: 225, leather: 0,   cloth: 0,   untagged: 100, guard: 372, dr: 142, hp: 1258, melee: 957 },
  Khalid:  { metal: 0,   leather: 211, cloth: 0,   untagged: 0,   guard: 297, dr: 87,  hp: 818,  melee: 854 },
  Frieda:  { metal: 0,   leather: 216, cloth: 0,   untagged: 0,   guard: 141, dr: 119, hp: 641,  melee: 1104 },
  Aiden:   { metal: 0,   leather: 248, cloth: 0,   untagged: 0,   guard: 91,  dr: 112, hp: 390,  melee: 500 },
  Gabriel: { metal: 0,   leather: 0,   cloth: 0,   untagged: 107, guard: 80,  dr: 138, hp: 748,  melee: 1114 },
  Harvey:  { metal: 0,   leather: 71,  cloth: 152, untagged: 0,   guard: 129, dr: 101, hp: 833,  melee: 340 },
  Olivia:  { metal: 0,   leather: 0,   cloth: 198, untagged: 0,   guard: 126, dr: 82,  hp: 384,  melee: 245 },
  Willy:   { metal: 0,   leather: 0,   cloth: 175, untagged: 0,   guard: 121, dr: 52,  hp: 664,  melee: 465 },
  Rosalie: { metal: 0,   leather: 0,   cloth: 68,  untagged: 0,   guard: 36,  dr: 64,  hp: 240,  melee: 300 },
};
// Attackers at common-tier damage (live/1.167, roster is all uncommon)
const ATK = {
  George: { dmgC: 1160, hit: 973, wait: 2503, rrl: 4157 },
  Phil:   { dmgC: 877,  hit: 870, wait: 2725, rrl: 4338 },
  Khalid: { dmgC: 847,  hit: 907, wait: 2163, rrl: 4520 },
  Gabriel:{ dmgC: 257,  hit: 918, wait: 695,  rrl: 4066 },
};

const armorAt = (d, opt, tier) => Math.round(
  (d.metal + d.leather + d.cloth) * OPT[opt].f(tier) + d.untagged);
const wallAt  = (d, opt, tier) => armorAt(d, opt, tier) + Math.round(d.guard * dmgL(tier));
const netAt   = (a, d, opt, tAtk, tDef) =>
  Math.max(0, Math.round(a.dmgC * dmgL(tAtk)) - wallAt(d, opt, tDef) - d.dr);

const pad = (s, n) => String(s).padStart(n);

console.log('=== 1. DAY-ONE IMPACT: the whole roster is UNCOMMON, so what changes on ship day? ===\n');
console.log('actor        armour   APA(+16.7%)   APB(+10%)   APC(re-anchored)');
for (const [n, d] of Object.entries(R)) {
  const base = armorAt(d, 'AP0', 'uncommon');
  console.log(`${n.padEnd(12)} ${pad(base, 6)}   ${pad(armorAt(d, 'APA', 'uncommon'), 11)}`
    + ` ${pad(armorAt(d, 'APB', 'uncommon'), 11)} ${pad(armorAt(d, 'APC', 'uncommon'), 16)}`);
}

console.log('\n=== 2. TANK IMMUNITY: does this make the already-immune MORE immune? ===');
console.log('Net damage per hit, all at uncommon (the live state):\n');
console.log('matchup              AP0     APA     APB     APC');
for (const [an, a] of Object.entries(ATK)) {
  for (const dn of ['Phil', 'George', 'Khalid', 'Frieda']) {
    if (an === dn) continue;
    const row = ['AP0', 'APA', 'APB', 'APC'].map(o => netAt(a, R[dn], o, 'uncommon', 'uncommon'));
    if (row[0] === 0 && row[3] === 0) continue;
    console.log(`${(an + ' -> ' + dn).padEnd(20)} ${row.map(v => pad(v, 6)).join('  ')}`);
  }
}

console.log('\n=== 3. THE FORTRESS INVERSION — is it actually fixed? ===');
console.log('Growth from common to divine, wall vs the +100% damage grows by:\n');
console.log('defender     AP0 wall    APA wall    APB wall    APC wall   (damage +100%)');
for (const dn of ['Phil', 'George', 'Khalid', 'Gabriel', 'Olivia']) {
  const d = R[dn];
  const g = (o) => '+' + Math.round(100 * (wallAt(d, o, 'divine') / wallAt(d, o, 'common') - 1)) + '%';
  console.log(`${dn.padEnd(12)} ${pad(g('AP0'), 9)}   ${pad(g('APA'), 9)}   ${pad(g('APB'), 9)}   ${pad(g('APC'), 9)}`);
}

console.log('\n=== 4. WHO DOES IT ACTUALLY HELP? absolute armour gained at uncommon (APA) ===\n');
const gains = Object.entries(R).map(([n, d]) => ({ n,
  gain: armorAt(d, 'APA', 'uncommon') - armorAt(d, 'AP0', 'uncommon'),
  hpPct: 0 })).sort((a, b) => b.gain - a.gain);
for (const g of gains) {
  const d = R[g.n];
  const before = netAt(ATK.George, d, 'AP0', 'uncommon', 'uncommon');
  const after  = netAt(ATK.George, d, 'APA', 'uncommon', 'uncommon');
  const swings = before > 0 ? (d.hp / before).toFixed(1) : 'inf';
  const swingsA = after > 0 ? (d.hp / after).toFixed(1) : 'inf';
  console.log(`${g.n.padEnd(12)} +${pad(g.gain, 4)} armour   George hits for ${pad(before, 5)} -> ${pad(after, 5)}`
    + `   swings to kill ${pad(swings, 5)} -> ${swingsA}`);
}

console.log('\n=== 5. THE MASTERY GAP THAT MATTERS: armoured defender climbs alone (attacker stays uncommon) ===');
console.log('George (uncommon) attacking. Defender advances their ARMOUR proficiency only:\n');
console.log('tier         Phil wall/net    Khalid wall/net   Olivia wall/net');
for (const t of TIERS) {
  const cell = (dn) => {
    const w = wallAt(R[dn], 'APA', 'uncommon');
    const armour = Math.round((R[dn].metal + R[dn].leather + R[dn].cloth) * OPT.APA.f(t) + R[dn].untagged);
    const wall = armour + Math.round(R[dn].guard * dmgL('uncommon'));
    const net = Math.max(0, Math.round(ATK.George.dmgC * dmgL('uncommon')) - wall - R[dn].dr);
    return `${wall}/${net}`;
  };
  console.log(`${t.padEnd(12)} ${pad(cell('Phil'), 14)}   ${pad(cell('Khalid'), 15)}   ${pad(cell('Olivia'), 14)}`);
}

console.log('\n=== 6. UNTAGGED ARMOUR stays neutral under every option ===');
for (const [n, d] of Object.entries(R)) {
  if (!d.untagged) continue;
  const tot = d.metal + d.leather + d.cloth + d.untagged;
  console.log(`  ${n.padEnd(10)} ${d.untagged} of ${tot} armour (${Math.round(100 * d.untagged / tot)}%) never scales`);
}
