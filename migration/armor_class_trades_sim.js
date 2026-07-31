/**
 * ARMOUR CLASS TRADES + ARMOUR PROFICIENCY — magnitude sim, 2026-07-30.
 *
 * RULED 2026-07-30: armour proficiency REDUCES ARMOUR'S DOWNSIDES rather than
 * raising the wall (the wall-scaling option was simmed in
 * armor_proficiency_sim.js and rejected - it doubled Phil's survivability and
 * reached literal immunity one tier later).
 *
 * So the trades have to exist first. From design-defense-rework-2026-07 (RULED
 * 2026-07-29, never built):
 *   heavy  (metal)   highest armour, DODGE PENALTY
 *   medium (leather) DODGE BONUS
 *   light  (cloth)   MANA EFFICIENCY   <- not dodge: cloth is worn by the
 *                                         worst dodgers in the game
 *
 * CLASS IS A WEIGHTED SHARE, not a bucket. Phil is 73% metal / 3% leather /
 * 25% untagged, so he takes 73% of the heavy penalty. Four of the ten armoured
 * PCs wear mixed sets, and a dominant-material bucket would round Harvey
 * (68% cloth / 32% leather) into a class he is only two-thirds in.
 *
 * PROFICIENCY applies as one rule in both directions:
 *   penalty / p     (skill removes the cost)
 *   bonus   x p     (skill deepens the benefit)
 * p is the shipped 16.7%/tier ladder. At divine (p=2) heavy's penalty halves
 * and medium's bonus doubles. Nothing can zero out or invert.
 *
 * LIVE PULL 2026-07-30 (shares read off the equipment effect pipeline).
 */

'use strict';

const LADDER = { rusty: 0.4, common: 0.6, uncommon: 0.7, rare: 0.8, legendary: 1.0, divine: 1.2 };
const p = (t) => LADDER[t] / LADDER.common;
const TIERS = ['rusty', 'common', 'uncommon', 'rare', 'legendary', 'divine'];
const DIV = 1.1;               // dodgeBasisDiv
const GRAZE = 0.10;

// actor: melee defence, class shares, mana
const R = [
  { n: 'Gabriel', melee: 1114, metal: 0,    leather: 0,    cloth: 0,    un: 1.00, mana: 396 },
  { n: 'Frieda',  melee: 1104, metal: 0,    leather: 1.00, cloth: 0,    un: 0,    mana: 173 },
  { n: 'George',  melee: 957,  metal: 0.69, leather: 0,    cloth: 0,    un: 0.31, mana: 285 },
  { n: 'Woody',   melee: 925,  metal: 0,    leather: 1.00, cloth: 0,    un: 0,    mana: 302 },
  { n: 'Rosalie', melee: 881,  metal: 0,    leather: 0,    cloth: 1.00, un: 0,    mana: 288 },
  { n: 'Khalid',  melee: 854,  metal: 0,    leather: 1.00, cloth: 0,    un: 0,    mana: 185 },
  { n: 'Phil',    melee: 808,  metal: 0.73, leather: 0.03, cloth: 0,    un: 0.25, mana: 98 },
  { n: 'Aiden',   melee: 622,  metal: 0,    leather: 1.00, cloth: 0,    un: 0,    mana: 407 },
  { n: 'Willy',   melee: 511,  metal: 0,    leather: 0,    cloth: 1.00, un: 0,    mana: 722 },
  { n: 'Harry',   melee: 401,  metal: 0,    leather: 0,    cloth: 1.00, un: 0,    mana: 580 },
  { n: 'Harvey',  melee: 340,  metal: 0,    leather: 0.32, cloth: 0.68, un: 0,    mana: 678 },
  { n: 'Olivia',  melee: 269,  metal: 0,    leather: 0,    cloth: 1.00, un: 0,    mana: 570 },
];

// Representative live hit rolls (blend x the shipped 1.1 to-hit proficiency).
const HIT = { Phil: 957, George: 1070 };

/** basis after the class trades, at armour-proficiency tier t. */
function basis(a, P, B, t) {
  const raw = a.melee / DIV;
  const pen = 1 - (P / p(t)) * a.metal;
  const bon = 1 + (B * p(t)) * a.leather;
  return raw * pen * bon;
}

/** exact avoid / graze over the 400-cell grid */
function avoid(bs, hit) {
  let d = 0, g = 0;
  for (let x = 1; x <= 20; x++) for (let y = 1; y <= 20; y++) {
    const h = hit * (1 + x / 100), r = bs * (1 + y / 100);
    if (r >= h) d++; else if (r >= h * (1 - GRAZE)) g++;
  }
  return { d: d / 4, g: g / 4 };   // percent
}

const pad = (s, n) => String(s).padStart(n);

console.log('=== 0. BASELINE: avoid% today, no trades, vs the two real hit rolls ===\n');
console.log('actor        basis   vs Phil 957      vs George 1070');
for (const a of R) {
  const bs = a.melee / DIV;
  const x = avoid(bs, HIT.Phil), y = avoid(bs, HIT.George);
  console.log(`${a.n.padEnd(12)} ${pad(Math.round(bs), 5)}   ${pad(x.d.toFixed(0) + '% (+' + x.g.toFixed(0) + '% graze)', 16)} ${pad(y.d.toFixed(0) + '% (+' + y.g.toFixed(0) + '% graze)', 16)}`);
}

console.log('\n=== 1. HEAVY DODGE PENALTY SWEEP — is it inert like the light-dodge idea was? ===');
console.log('The only two metal wearers, at COMMON proficiency, vs George 1070:\n');
console.log('penalty   Phil basis/avoid        George basis/avoid');
for (const P of [0, 0.10, 0.20, 0.30, 0.50]) {
  const ph = R.find(x => x.n === 'Phil'), ge = R.find(x => x.n === 'George');
  const bp = basis(ph, P, 0, 'common'), bg = basis(ge, P, 0, 'common');
  const ap = avoid(bp, HIT.George), ag = avoid(bg, HIT.George);
  console.log(`${String(P).padEnd(9)} ${pad(Math.round(bp) + ' / ' + ap.d.toFixed(0) + '%', 20)}   ${pad(Math.round(bg) + ' / ' + ag.d.toFixed(0) + '%', 20)}`);
}

console.log('\n=== 2. MEDIUM DODGE BONUS SWEEP — the real dodgers, vs George 1070 ===\n');
console.log('bonus     Frieda        Woody         Khalid        Aiden');
for (const B of [0, 0.10, 0.15, 0.20, 0.30]) {
  let row = String(B).padEnd(9);
  for (const n of ['Frieda', 'Woody', 'Khalid', 'Aiden']) {
    const a = R.find(x => x.n === n);
    const bs = basis(a, 0, B, 'common');
    row += pad(Math.round(bs) + ' / ' + avoid(bs, HIT.George).d.toFixed(0) + '%', 14);
  }
  console.log(row);
}

console.log('\n=== 3. PROFICIENCY MOVING THE TRADES (heavy P=0.20, medium B=0.15) ===');
console.log('vs George 1070. Heavy: penalty/p. Medium: bonus x p.\n');
console.log('tier         Phil          George        Frieda        Khalid');
for (const t of TIERS) {
  let row = t.padEnd(12);
  for (const n of ['Phil', 'George', 'Frieda', 'Khalid']) {
    const a = R.find(x => x.n === n);
    const bs = basis(a, 0.20, 0.15, t);
    row += pad(Math.round(bs) + ' / ' + avoid(bs, HIT.George).d.toFixed(0) + '%', 14);
  }
  console.log(row);
}

console.log('\n=== 4. WHAT THE HEAVY PENALTY COSTS IN ABSOLUTE AVOID (P=0.20) ===');
console.log('Difference between untrained-in-plate and mastering it:\n');
for (const n of ['Phil', 'George']) {
  const a = R.find(x => x.n === n);
  const bad = avoid(basis(a, 0.20, 0, 'rusty'), HIT.George).d;
  const mid = avoid(basis(a, 0.20, 0, 'common'), HIT.George).d;
  const top = avoid(basis(a, 0.20, 0, 'divine'), HIT.George).d;
  const none = avoid(a.melee / DIV, HIT.George).d;
  console.log(`  ${n.padEnd(8)} no-trade ${none.toFixed(0)}%  |  rusty ${bad.toFixed(0)}%  common ${mid.toFixed(0)}%  divine ${top.toFixed(0)}%`);
}

console.log('\n=== 5. LIGHT = MANA EFFICIENCY. Rate sweep on effective mana pool ===');
console.log('Efficiency e means costs x (1 - e x clothShare x p); shown as effective pool.\n');
console.log('rate      Olivia(570)   Harry(580)   Willy(722)   Harvey(678,68% cloth)');
for (const E of [0.10, 0.15, 0.20, 0.30]) {
  let row = String(E).padEnd(9);
  for (const n of ['Olivia', 'Harry', 'Willy', 'Harvey']) {
    const a = R.find(x => x.n === n);
    const eff = a.mana / (1 - E * a.cloth * p('common'));
    row += pad(Math.round(eff) + ' (+' + Math.round(100 * (eff / a.mana - 1)) + '%)', 13);
  }
  console.log(row);
}
console.log('\nSame at DIVINE cloth proficiency (p=2):');
for (const E of [0.10, 0.15, 0.20]) {
  let row = String(E).padEnd(9);
  for (const n of ['Olivia', 'Harry', 'Willy', 'Harvey']) {
    const a = R.find(x => x.n === n);
    const eff = a.mana / (1 - E * a.cloth * p('divine'));
    row += pad(Math.round(eff) + ' (+' + Math.round(100 * (eff / a.mana - 1)) + '%)', 13);
  }
  console.log(row);
}

console.log('\n=== 5b. THE ALTERNATIVE HEAVY DOWNSIDE: CELERITY, not dodge ===');
console.log('Dodge is binary (see 1 and 4). Celerity is continuous and has no dice band at all,');
console.log('so a tempo penalty lands on everyone who wears plate, every round.\n');
const WAIT = { Phil: 2725, George: 2503, Khalid: 2163, Gabriel: 695, Frieda: 1656 };
const RRL  = { Phil: 4338, George: 4157, Khalid: 4520, Gabriel: 4066, Frieda: 4293 };
console.log('penalty   Phil wait/actions-per-round     George wait/actions-per-round');
for (const Pc of [0, 0.10, 0.15, 0.20, 0.30]) {
  let row = String(Pc).padEnd(9);
  for (const n of ['Phil', 'George']) {
    const a = R.find(x => x.n === n);
    const w = WAIT[n] * (1 + Pc * a.metal);
    row += pad(Math.round(w) + ' / ' + (RRL[n] / w).toFixed(2) + ' (' + (Pc ? '-' + Math.round(100 * (1 - (RRL[n] / w) / (RRL[n] / WAIT[n]))) + '%' : 'base') + ')', 31);
  }
  console.log(row);
}
console.log('\nProficiency removing it (P=0.15, penalty / p):');
console.log('tier         Phil wait   actions/rd    George wait   actions/rd');
for (const t of TIERS) {
  let row = t.padEnd(12);
  for (const n of ['Phil', 'George']) {
    const a = R.find(x => x.n === n);
    const w = WAIT[n] * (1 + (0.15 / p(t)) * a.metal);
    row += pad(Math.round(w), 11) + pad((RRL[n] / w).toFixed(2), 13);
  }
  console.log(row);
}

console.log('\n=== 6. COVERAGE: who actually HAS a class? ===');
for (const a of R) {
  const cls = [a.metal ? `${Math.round(a.metal * 100)}% heavy` : '', a.leather ? `${Math.round(a.leather * 100)}% medium` : '',
               a.cloth ? `${Math.round(a.cloth * 100)}% light` : '', a.un ? `${Math.round(a.un * 100)}% UNTAGGED` : ''].filter(Boolean).join(' + ');
  console.log(`  ${a.n.padEnd(9)} ${cls}`);
}
