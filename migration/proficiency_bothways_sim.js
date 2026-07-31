/**
 * PROFICIENCY BOTH WAYS — what fights look like now that mastery scales the
 * attacker AND the defender. 2026-07-30, after 31f9c4b shipped the to-hit half.
 *
 * Proficiency now touches FOUR things, on THREE different ladders:
 *
 *   to-hit      x (1 + 0.10 x tiers)     attacker    10.0% / tier
 *   damage      x (mult / 0.6)           attacker    16.7% / tier
 *   guard/blockDR x (mult / 0.6)         defender    16.7% / tier
 *   parry       x (mult / 0.6)           defender    16.7% / tier
 *
 * And it does NOT touch:
 *   dodge (defence.value - pure stat)                 0% / tier
 *   worn armour (gear armorBonus)                     0% / tier
 *   toughness DR                                      0% / tier
 *
 * Those zeroes are the whole story. This sim asks what the mismatch does.
 *
 * LIVE PULL 2026-07-30 (armour and guard SPLIT, because only guard scales).
 * Damage figures are divided back to their common-tier value so the ladder can
 * be applied cleanly (live roster is all uncommon = x1.167).
 *
 * Policies: defender parries once per reference round when they own a parry,
 * dodges otherwise while basis >= 0.55 x incoming hit, else eats it. Graze
 * band 10%, half damage pre-wall. One-sided TTK. Same shape as
 * proficiency_tohit_sim.js - read that one first for the to-hit ruling.
 */

'use strict';

const C = { dodgeBasisDiv: 1.1, grazeBandPct: 0.10, scrambleStackPct: 0.15,
            parryMassExponent: 0.3, unarmedWeight: 40, anchorMult: 0.6 };

// tiers-from-common -> the two ladders
const STEPS = { rusty: -2, inferior: -1, common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5, divine: 6 };
const hitMult = (t) => 1 + 0.10 * STEPS[t];
const dmgMult = (t) => (C.anchorMult + 0.1 * STEPS[t]) / C.anchorMult;

// ── LIVE ROSTER (common-tier normalised) ────────────────────────────────
const A = {
  Gabriel: { hit: 918, dmgC: Math.round(300 / 1.167), wait: 695, rrl: 4066, w: 60 },
  Phil:    { hit: 870, dmgC: Math.round(1023 / 1.167), wait: 2725, rrl: 4338, w: 200 },
  George:  { hit: 973, dmgC: Math.round(1354 / 1.167), wait: 2503, rrl: 4157, w: 220 },
  Khalid:  { hit: 907, dmgC: Math.round(989 / 1.167), wait: 2163, rrl: 4520, w: 180 },
};
const D = {
  Gabriel: { melee: 1114, armor: 107, guardC: 69,  dr: 138, hp: 748,  rrl: 4066, w: 60,
             parry: { blend: 918, name: 'Lightning Parry' } },
  Phil:    { melee: 808,  armor: 599, guardC: 268, dr: 256, hp: 1388, rrl: 4338, w: 200,
             parry: { blend: 870, name: 'Shield Block' } },
  George:  { melee: 957,  armor: 325, guardC: 319, dr: 142, hp: 1258, rrl: 4157, w: 220, parry: null },
  Khalid:  { melee: 854,  armor: 211, guardC: 255, dr: 87,  hp: 818,  rrl: 4520, w: 180, parry: null },
  // Lincoln: craftsman. No armour, no guard, no weapon, owns Basic Parry.
  Lincoln: { melee: 764,  armor: 0,   guardC: 0,   dr: 61,  hp: 317,  rrl: 4800, w: 0,
             parry: { blend: 738, name: 'Basic Parry' }, tier: 'inferior' },
};

const massMult = (dw, aw) => Math.min(1, Math.pow(Math.max(dw, C.unarmedWeight) / Math.max(aw, C.unarmedWeight), C.parryMassExponent));

// ── ONE EXCHANGE, exact over the 400-cell dice grid where possible ──────
function rates(atk, def, ta, td) {
  const H = atk.hit * hitMult(ta);
  const basis = def.melee / C.dodgeBasisDiv;
  let dodge = 0, graze = 0, full = 0;
  for (let a = 1; a <= 20; a++) {
    const hit = H * (1 + a / 100);
    for (let d = 1; d <= 20; d++) {
      const droll = basis * (1 + d / 100);
      if (droll >= hit) dodge++;
      else if (droll >= hit * (1 - C.grazeBandPct)) graze++;
      else full++;
    }
  }
  // Parry is a separate contest (1/round), same grid.
  let parry = null;
  if (def.parry) {
    const pm = massMult(def.w, atk.w) * dmgMult(td);
    let win = 0;
    for (let a = 1; a <= 20; a++) {
      const hit = H * (1 + a / 100);
      for (let p = 1; p <= 20; p++) {
        if (def.parry.blend * (1 + p / 100) * pm >= hit) win++;
      }
    }
    parry = win / 400;
  }
  return { dodge: dodge / 400, graze: graze / 400, full: full / 400, parry };
}

// Net damage past the wall for a landing blow.
function net(atk, def, ta, td, mult = 1) {
  const dmg = atk.dmgC * dmgMult(ta) * mult;
  const wall = def.armor + def.guardC * dmgMult(td);
  return Math.max(0, Math.round(dmg - wall - def.dr));
}

// ── TTK with parry (1/round) + dodge + scramble ─────────────────────────
function ttk(atk, def, ta, td, trials = 4000) {
  const H = atk.hit * hitMult(ta);
  const basis = def.melee / C.dodgeBasisDiv;
  const willDodge = basis >= 0.55 * H;
  const pm = def.parry ? massMult(def.w, atk.w) * dmgMult(td) : 0;
  const decay = def.rrl / 4;
  let sum = 0, never = 0;
  for (let t = 0; t < trials; t++) {
    let hp = def.hp, time = 0, stacks = 0, last = -1e9, parryReadyAt = 0, n = 0;
    while (hp > 0 && n < 600) {
      n++;
      const hit = H * (1 + (1 + Math.floor(Math.random() * 20)) / 100);
      // Parry first: a reaction, once per reference round.
      if (def.parry && time >= parryReadyAt) {
        parryReadyAt = time + def.rrl;
        if (def.parry.blend * (1 + (1 + Math.floor(Math.random() * 20)) / 100) * pm >= hit) {
          time += atk.wait; continue;
        }
      }
      let mult = 1;
      if (willDodge) {
        stacks = Math.max(0, stacks - (time - last) / decay); last = time;
        const dv = basis * Math.max(0, 1 - C.scrambleStackPct * stacks);
        const droll = dv * (1 + (1 + Math.floor(Math.random() * 20)) / 100);
        stacks += 1;
        if (droll >= hit) { time += atk.wait; continue; }
        if (droll >= hit * (1 - C.grazeBandPct)) mult = 0.5;
      }
      hp -= net(atk, def, ta, td, mult);
      time += atk.wait;
    }
    if (hp > 0) { never++; continue; }
    sum += time / atk.rrl;
  }
  const ok = trials - never;
  return ok ? +(sum / ok).toFixed(1) : Infinity;
}

const pad = (s, n) => String(s).padStart(n);
const LADDER = ['common', 'uncommon', 'rare', 'legendary', 'divine'];

console.log('=== 0. THE THREE LADDERS (this is the whole finding) ===\n');
console.log('tier         to-hit   damage   guard   parry   DODGE   ARMOUR   toughDR');
for (const t of LADDER) {
  console.log(`${t.padEnd(12)} ${pad(hitMult(t).toFixed(2) + 'x', 6)} ${pad(dmgMult(t).toFixed(2) + 'x', 8)}`
    + ` ${pad(dmgMult(t).toFixed(2) + 'x', 7)} ${pad(dmgMult(t).toFixed(2) + 'x', 7)}`
    + ` ${pad('1.00x', 7)} ${pad('1.00x', 8)} ${pad('1.00x', 9)}`);
}

console.log('\n=== 1. SYMMETRIC CLIMB: both fighters advance together ===');
console.log('Phil (claymore) vs Gabriel (rogue, best dodger, owns Lightning Parry)\n');
console.log('tier         P.hit   dodge%  graze%  parry%(G)  net/hit   TTK');
for (const t of LADDER) {
  const r = rates(A.Phil, D.Gabriel, t, t);
  console.log(`${t.padEnd(12)} ${pad(Math.round(A.Phil.hit * hitMult(t)), 6)}`
    + ` ${pad(Math.round(r.dodge * 100) + '%', 7)} ${pad(Math.round(r.graze * 100) + '%', 7)}`
    + ` ${pad(Math.round(r.parry * 100) + '%', 10)} ${pad(net(A.Phil, D.Gabriel, t, t), 9)}`
    + ` ${pad(ttk(A.Phil, D.Gabriel, t, t) + 'r', 7)}`);
}

console.log('\nGeorge (greataxe) vs Phil (the fortress: armour 599 + guard, owns Shield Block)\n');
console.log('tier         G.hit   dodge%  parry%(P)  wall     net/hit   TTK');
for (const t of LADDER) {
  const r = rates(A.George, D.Phil, t, t);
  const wall = Math.round(D.Phil.armor + D.Phil.guardC * dmgMult(t));
  console.log(`${t.padEnd(12)} ${pad(Math.round(A.George.hit * hitMult(t)), 6)}`
    + ` ${pad(Math.round(r.dodge * 100) + '%', 7)} ${pad(Math.round(r.parry * 100) + '%', 10)}`
    + ` ${pad(wall, 7)} ${pad(net(A.George, D.Phil, t, t), 9)} ${pad(ttk(A.George, D.Phil, t, t) + 'r', 7)}`);
}

console.log('\n=== 2. THE PARRY ARMS RACE: parry climbs 16.7%/tier, to-hit only 10% ===');
console.log('Equal-tier parry success, Phil swinging at Gabriel:\n');
console.log('tier         parry mult  hit mult   parry%   net gain to DEFENDER');
let prev = null;
for (const t of LADDER) {
  const r = rates(A.Phil, D.Gabriel, t, t);
  const ratio = dmgMult(t) / hitMult(t);
  console.log(`${t.padEnd(12)} ${pad(dmgMult(t).toFixed(2) + 'x', 10)} ${pad(hitMult(t).toFixed(2) + 'x', 9)}`
    + ` ${pad(Math.round(r.parry * 100) + '%', 8)} ${pad('+' + Math.round((ratio - 1) * 100) + '%', 12)}`);
  prev = r;
}

console.log('\n=== 3. FIGHTER vs CRAFTSMAN (Lincoln: inferior prof, no armour, no guard) ===');
console.log('Trained fighters swinging at a craftsman who owns Basic Parry:\n');
console.log('attacker      hit    dodge%  parry%  net/hit   TTK');
for (const an of ['Gabriel', 'Phil', 'George']) {
  const r = rates(A[an], D.Lincoln, 'uncommon', 'inferior');
  console.log(`${an.padEnd(13)} ${pad(Math.round(A[an].hit * hitMult('uncommon')), 5)}`
    + ` ${pad(Math.round(r.dodge * 100) + '%', 7)} ${pad(Math.round(r.parry * 100) + '%', 7)}`
    + ` ${pad(net(A[an], D.Lincoln, 'uncommon', 'inferior'), 9)} ${pad(ttk(A[an], D.Lincoln, 'uncommon', 'inferior') + 'r', 6)}`);
}
console.log('\nAnd Lincoln swinging back (inferior prof) vs the same fighters as DEFENDERS:');
console.log('Lincoln hit ' + Math.round(738 * hitMult('inferior')) + ' (blend 738 x ' + hitMult('inferior') + ')');
for (const dn of ['Gabriel', 'Phil']) {
  const linc = { hit: 738, dmgC: 200, wait: 2000, rrl: 4800, w: 0 };
  const r = rates(linc, D[dn], 'inferior', 'uncommon');
  console.log(`  vs ${dn.padEnd(10)} dodge ${Math.round(r.dodge * 100)}%  parry ${r.parry != null ? Math.round(r.parry * 100) + '%' : '-'}`
    + `  net/hit ${net(linc, D[dn], 'inferior', 'uncommon')}`);
}

console.log('\n=== 4. MASTERY GAP: attacker climbs, defender stays uncommon (and vice versa) ===');
console.log('Phil -> Gabriel. Left: Phil advances alone. Right: Gabriel advances alone.\n');
console.log('tier         atk-climbs: dodge/parry/TTK      def-climbs: dodge/parry/TTK');
for (const t of LADDER) {
  const ra = rates(A.Phil, D.Gabriel, t, 'uncommon');
  const rd = rates(A.Phil, D.Gabriel, 'uncommon', t);
  console.log(`${t.padEnd(12)} ${pad(Math.round(ra.dodge * 100) + '%/' + Math.round(ra.parry * 100) + '%/' + ttk(A.Phil, D.Gabriel, t, 'uncommon') + 'r', 22)}`
    + `   ${pad(Math.round(rd.dodge * 100) + '%/' + Math.round(rd.parry * 100) + '%/' + ttk(A.Phil, D.Gabriel, 'uncommon', t) + 'r', 22)}`);
}

console.log('\n=== 5. WALL EROSION: how much of each fortress actually scales? ===');
console.log('Only the GUARD half of the wall carries proficiency; worn armour does not.\n');
console.log('defender     armour  guard(C)  guard%   wall@common  wall@divine  growth');
for (const dn of ['Phil', 'George', 'Khalid', 'Gabriel']) {
  const d = D[dn];
  const wc = d.armor + d.guardC, wd = Math.round(d.armor + d.guardC * dmgMult('divine'));
  console.log(`${dn.padEnd(12)} ${pad(d.armor, 6)} ${pad(d.guardC, 9)} ${pad(Math.round(100 * d.guardC / Math.max(1, wc)) + '%', 7)}`
    + ` ${pad(wc, 12)} ${pad(wd, 12)} ${pad('+' + Math.round(100 * (wd / wc - 1)) + '%', 7)}`);
}
console.log('\n(attacker damage over the same span: +100%)');
