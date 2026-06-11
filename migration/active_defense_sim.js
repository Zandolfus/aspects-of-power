#!/usr/bin/env node
/**
 * Active Defense v2 — TTK Monte Carlo (2026-06-04)
 * Models design-active-defense.md v2 with the reference E-rank archetypes
 * from design-archetype-defense-gap.md.
 *
 * MODELED:
 *  - Celerity event loop: wait = weight × SCALE / speed; interleaved actions.
 *  - Attack: hitTotal = hitBlend × (1 + d20/100); damage = dmgBlend × MULT × windup.
 *  - Windup = clamp((weight/100)^EXP, 1, WINDUP_MAX) — exponent swept.
 *  - Dodge: opposed house-grammar roll off defense.melee.value; −15%/scramble
 *    stack (decays 1 stack/¼ round); cost = 25% of own wait; 10% graze band → half dmg.
 *  - Parry (Basic): 1 manual reaction/round, opposed roll, negate-or-full. No cost.
 *  - Mana Shield (caster): 1 reaction/round, smart absorb (just enough to zero
 *    the hit), capped by remaining mana. No in-combat mana regen.
 *  - Passive: armor + block DR (weapon celerity-weight keyed) + toughness DR, flat per hit.
 *  - Mind attacks vs physical defenders: mind pool (resets each ref round) →
 *    partial-multiplier bleed → veil + toughness DR. Spells get no windup.
 *
 * NOT MODELED (note when reading results):
 *  - Skills/content: Feint, marks, buffs, control, barriers-precast, Mana Shell.
 *  - Movement/positioning/escape; stamina caps (non-binding at these scales);
 *  - invest sliders (base invest → stamina factor 1.0); CC.
 *
 * POLICIES (simple, documented):
 *  - Dodge if netEaten ≥ 8% maxHP and winProb ≥ 35%.
 *  - Else Parry if reaction free and netEaten ≥ 12% maxHP.
 *  - Else desperate dodge if netEaten ≥ 25% maxHP and winProb ≥ 15%.
 *  - Else Mana Shield (casters) if reaction free and netEaten ≥ 10% maxHP.
 *  - Else eat. Casters never dodge melee (winProb ≈ 0 vs same-rank).
 */

const CFG = {
  SCALE: 10000,
  REF_ROUND: 4200,            // ticks ≈ 3 sword swings at speed 721
  DODGE_COST_FRAC: 0.25,
  SCRAMBLE_PCT: 0.15,
  SCRAMBLE_DECAY_TICKS: 1050, // 1 stack / quarter round
  GRAZE_BAND: 0.10,
  WINDUP_MAX: 3.0,
  WINDUP_MIN: 0.5,
  BLOCK_COEF: 60,             // blockDR = COEF × (weight/100) × (1 + str/1085)
  MULT: 1.0,
  TRIALS: 3000,
  MAX_ROUNDS: 60,
  DODGE_DMG_FRAC: 0.08,
  DODGE_MIN_WINPROB: 0.35,
  DESPERATE_WINPROB: 0.15,
  DESPERATE_DMG_FRAC: 0.25,
  PARRY_DMG_FRAC: 0.12,
  SHIELD_DMG_FRAC: 0.10,
  // tuning dials (v2.1 candidates)
  HP_SCALE: 1.0,   // global HP multiplier (gap-analysis Family D)
  DODGE_DIV: 1.0,  // divide defense.value for dodge/parry rolls (1.1 = strip the ×1.1)
};

const d20 = () => 1 + Math.floor(Math.random() * 20);
const windup = (weight, exp) =>
  Math.min(CFG.WINDUP_MAX, Math.max(CFG.WINDUP_MIN ?? 1, Math.pow(weight / 100, exp)));

// P(def×(1+i/100) ≥ atk×(1+j/100)) over independent d20s.
function winProb(defVal, atkBlend) {
  let w = 0;
  for (let i = 1; i <= 20; i++)
    for (let j = 1; j <= 20; j++)
      if (defVal * (1 + i / 100) >= atkBlend * (1 + j / 100)) w++;
  return w / 400;
}

// ── Archetypes (E-rank reference, mods from gap analysis) ──
function makeGSFighter(veil = 50) {
  const w = 200;
  return {
    name: 'GS-Fighter', kind: 'phys',
    hitBlend: 838, dmgBlend: 707, defMelee: 930,
    maxHp: 611, armor: 364, toughDR: 112,
    blockDR: Math.round(CFG.BLOCK_COEF * (w / 100) * (1 + 721 / 1085)), // ≈199
    weight: w, wait: Math.round(w * CFG.SCALE / 721),                   // 2774
    mindPoolMax: 460, veil, hasParry: true, hasShield: false, maxMana: 0,
  };
}
function makeSwordFighter(veil = 50) {
  const w = 100;
  return {
    name: 'Sword-Fighter', kind: 'phys',
    hitBlend: 838, dmgBlend: 693, defMelee: 930,
    maxHp: 611, armor: 364, toughDR: 112,
    blockDR: Math.round(CFG.BLOCK_COEF * (w / 100) * (1 + 721 / 1085)), // ≈100
    weight: w, wait: Math.round(w * CFG.SCALE / 721),                   // 1387
    mindPoolMax: 460, veil, hasParry: true, hasShield: false, maxMana: 0,
  };
}
function makeRogue() {
  const w = 60;
  return {
    name: 'Rogue', kind: 'phys',
    hitBlend: 796, dmgBlend: 686, defMelee: 954,
    maxHp: 485, armor: 242, toughDR: 81,
    blockDR: Math.round(CFG.BLOCK_COEF * (w / 100) * (1 + 489 / 1085)), // ≈49
    weight: w, wait: Math.round(w * CFG.SCALE / 721),                   // 832
    mindPoolMax: 460, veil: 50, hasParry: true, hasShield: false, maxMana: 0,
  };
}
function makeCaster() {
  const speed = Math.round(0.6 * 489 + 0.4 * 721); // 582
  const w = 130; // basic spell tier weight
  return {
    name: 'Caster', kind: 'magic',
    // defMelee 385 = (dex 161 + max(str 161, per 629)×0.3) × 1.1 — the
    // shipped max(str,per) perception ruling.
    hitBlend: 721, dmgBlend: 721, defMelee: 385,
    maxHp: 279, armor: 180, toughDR: 81,
    blockDR: Math.round(CFG.BLOCK_COEF * (140 / 100) * (1 + 161 / 1085)), // staff ≈96
    weight: w, wait: Math.round(w * CFG.SCALE / speed),                    // 2234
    mindPoolMax: 1910, veil: 300, hasParry: false, hasShield: true, maxMana: 388,
  };
}

// ── Combat state ──
function spawn(proto) {
  const hp = Math.round(proto.maxHp * CFG.HP_SCALE);
  return {
    ...proto,
    maxHp: hp, hp, mana: proto.maxMana,
    mindPool: proto.mindPoolMax,
    next: Math.floor(Math.random() * 200), // slight stagger
    stacks: 0, lastDecay: 0,
    reactionRound: -1, poolRound: 0,
    diag: { dodges: 0, dodgeWins: 0, grazes: 0, parries: 0, shields: 0, eats: 0 },
  };
}
const round = (t) => Math.floor(t / CFG.REF_ROUND);

function decayStacks(a, t) {
  const dec = (t - a.lastDecay) / CFG.SCRAMBLE_DECAY_TICKS;
  a.stacks = Math.max(0, a.stacks - dec);
  a.lastDecay = t;
}
function refreshPool(a, t) {
  const r = round(t);
  if (r > a.poolRound) { a.mindPool = a.mindPoolMax; a.poolRound = r; }
}
const reactionFree = (a, t) => round(t) > a.reactionRound;

// Physical attack: returns net damage applied to defender.
function physAttack(atk, def, t, exp, oneShotTrack) {
  const aroll = atk.hitBlend * (1 + d20() / 100);
  const dmg = atk.dmgBlend * CFG.MULT * windup(atk.weight, exp);
  const mitig = def.armor + def.blockDR + def.toughDR;
  const netEaten = Math.max(0, dmg - mitig);

  decayStacks(def, t);
  const dv = (def.defMelee / CFG.DODGE_DIV) * Math.max(0, 1 - CFG.SCRAMBLE_PCT * def.stacks);
  const wp = def.kind === 'magic' ? 0 : winProb(dv, atk.hitBlend);

  // decision
  let action = 'eat';
  if (netEaten >= CFG.DODGE_DMG_FRAC * def.maxHp && wp >= CFG.DODGE_MIN_WINPROB) action = 'dodge';
  else if (def.hasParry && reactionFree(def, t) && netEaten >= CFG.PARRY_DMG_FRAC * def.maxHp) action = 'parry';
  else if (netEaten >= CFG.DESPERATE_DMG_FRAC * def.maxHp && wp >= CFG.DESPERATE_WINPROB) action = 'dodge';
  else if (def.hasShield && reactionFree(def, t) && def.mana > 0 && netEaten >= CFG.SHIELD_DMG_FRAC * def.maxHp) action = 'shield';

  let net = netEaten;
  if (action === 'dodge') {
    def.diag.dodges++;
    def.stacks += 1;
    def.next += Math.round(CFG.DODGE_COST_FRAC * def.wait);
    const droll = dv * (1 + d20() / 100);
    if (droll >= aroll) { def.diag.dodgeWins++; net = 0; }
    else if (droll >= aroll * (1 - CFG.GRAZE_BAND)) { def.diag.grazes++; net = Math.max(0, dmg / 2 - mitig); }
  } else if (action === 'parry') {
    def.diag.parries++;
    def.reactionRound = round(t);
    const proll = (def.defMelee / CFG.DODGE_DIV) * (1 + d20() / 100); // no scramble on parry
    if (proll >= aroll) net = 0;
  } else if (action === 'shield') {
    def.diag.shields++;
    def.reactionRound = round(t);
    const absorb = Math.min(def.mana, Math.max(0, dmg - mitig));
    def.mana -= Math.round(absorb);
    net = Math.max(0, dmg - absorb - mitig);
  } else {
    def.diag.eats++;
  }

  if (net >= def.maxHp) oneShotTrack.count++;
  def.hp -= net;
  return net;
}

// Magic (mind) attack: pool → veil + toughDR. No windup, no dodge/parry.
function mindAttack(atk, def, t) {
  const aroll = atk.hitBlend * (1 + d20() / 100);
  let dmg = atk.dmgBlend * CFG.MULT;
  refreshPool(def, t);
  if (def.mindPool > 0) {
    if (def.mindPool >= aroll) { def.mindPool -= aroll; return 0; }
    dmg *= 1 - def.mindPool / aroll;
    def.mindPool = 0;
  }
  const net = Math.max(0, Math.round(dmg) - def.veil - def.toughDR);
  def.hp -= net;
  return net;
}

// Fight: teamA vs teamB until one side dead or MAX_ROUNDS.
function fight(protosA, protosB, exp, trace = false) {
  const A = protosA.map(spawn), B = protosB.map(spawn);
  const oneShot = { count: 0 };
  let t = 0;
  const maxT = CFG.MAX_ROUNDS * CFG.REF_ROUND;
  while (t < maxT) {
    const all = [...A, ...B].filter(x => x.hp > 0);
    const aliveA = A.filter(x => x.hp > 0), aliveB = B.filter(x => x.hp > 0);
    if (!aliveA.length || !aliveB.length) break;
    const actor = all.reduce((m, x) => (x.next < m.next ? x : m));
    t = actor.next;
    if (t >= maxT) break;
    const foes = A.includes(actor) ? aliveB : aliveA;
    const target = foes[0]; // focus fire
    let net;
    if (actor.kind === 'magic') net = mindAttack(actor, target, t);
    else net = physAttack(actor, target, t, exp, oneShot);
    if (trace) console.log(
      `t=${String(Math.round(t)).padStart(6)} r${round(t)} ${actor.name.padEnd(13)}→ ${target.name.padEnd(13)}` +
      ` net=${String(Math.round(net)).padStart(5)} | tgt hp=${String(Math.round(target.hp)).padStart(5)}` +
      ` mana=${Math.round(target.mana ?? 0)} pool=${Math.round(target.mindPool)} stacks=${target.stacks.toFixed(1)}` +
      ` | atk.next→${Math.round(actor.next + actor.wait)}`
    );
    actor.next += actor.wait;
  }
  const aAlive = A.some(x => x.hp > 0), bAlive = B.some(x => x.hp > 0);
  return {
    winner: aAlive && !bAlive ? 'A' : bAlive && !aAlive ? 'B' : 'draw',
    rounds: t / CFG.REF_ROUND,
    oneShots: oneShot.count,
    diagA: A.map(x => x.diag), diagB: B.map(x => x.diag),
  };
}

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function runMatchup(label, mkA, mkB, exp) {
  const durations = [], winners = { A: 0, B: 0, draw: 0 };
  let oneShotFights = 0, dodges = 0, dodgeWins = 0, grazes = 0, parries = 0, shields = 0, eats = 0;
  for (let i = 0; i < CFG.TRIALS; i++) {
    const r = fight(mkA(), mkB(), exp);
    winners[r.winner]++;
    if (r.winner !== 'draw') durations.push(r.rounds);
    if (r.oneShots > 0) oneShotFights++;
    for (const d of [...r.diagA, ...r.diagB]) {
      dodges += d.dodges; dodgeWins += d.dodgeWins; grazes += d.grazes;
      parries += d.parries; shields += d.shields; eats += d.eats;
    }
  }
  const med = durations.length ? pct(durations, 0.5) : NaN;
  const p10 = durations.length ? pct(durations, 0.1) : NaN;
  const p90 = durations.length ? pct(durations, 0.9) : NaN;
  const n = CFG.TRIALS;
  console.log(
    `${label.padEnd(34)} | A:${String(Math.round(100 * winners.A / n)).padStart(3)}%` +
    ` B:${String(Math.round(100 * winners.B / n)).padStart(3)}%` +
    ` draw:${String(Math.round(100 * winners.draw / n)).padStart(3)}%` +
    ` | TTK med ${isNaN(med) ? '  —' : med.toFixed(1).padStart(4)}r` +
    ` (p10 ${isNaN(p10) ? ' —' : p10.toFixed(1)} / p90 ${isNaN(p90) ? ' —' : p90.toFixed(1)})` +
    ` | 1shot ${String(Math.round(100 * oneShotFights / n)).padStart(3)}%` +
    ` | dodge ${dodges ? Math.round(100 * dodgeWins / dodges) : 0}% win (${(dodges / n).toFixed(1)}/fight)`
  );
}

// ── Trace mode: node active_defense_sim.js trace ──
if (process.argv[2] === 'trace') {
  console.log('— TRACE: GS-Fighter vs Caster(veil 50), exp 0.5, one trial —');
  const r = fight([makeGSFighter(50)], [makeCaster()], 0.5, true);
  console.log(`winner=${r.winner} rounds=${r.rounds.toFixed(2)}`);
  console.log('\n— TRACE: GS-Fighter mirror, exp 1.0, one trial (first 25 events) —');
  // crude cap: temporarily shrink MAX_ROUNDS
  const saved = CFG.MAX_ROUNDS; CFG.MAX_ROUNDS = 3;
  const r2 = fight([makeGSFighter()], [makeGSFighter()], 1.0, true);
  console.log(`winner=${r2.winner} rounds=${r2.rounds.toFixed(2)}`);
  CFG.MAX_ROUNDS = saved;
  process.exit(0);
}

// ── Run ──
console.log(`Active Defense v2 TTK sim — trials/matchup: ${CFG.TRIALS}, MULT=${CFG.MULT}, blockCoef=${CFG.BLOCK_COEF}`);
console.log(`Targets: mirror 6-8r | cross-lane favored 3-4r | never <2r\n`);

const RUNS = [
  { label: 'SHIPPED 2026-06-12 — full dodge basis', exp: 1.0,
    over: { BLOCK_COEF: 80, HP_SCALE: 1.5, DODGE_DIV: 1.0, WINDUP_MIN: 0.5 } },
  { label: 'SHIPPED + dodge basis ÷1.1 (candidate knob)', exp: 1.0,
    over: { BLOCK_COEF: 80, HP_SCALE: 1.5, DODGE_DIV: 1.1, WINDUP_MIN: 0.5 } },
];
const DEFAULTS = { ...CFG };

for (const run of RUNS) {
  Object.assign(CFG, DEFAULTS, run.over);
  console.log(`── ${run.label} (GS=${windup(200, run.exp).toFixed(2)}×, sword=${windup(100, run.exp).toFixed(2)}×) ──`);
  runMatchup('GS-Fighter vs GS-Fighter', () => [makeGSFighter()], () => [makeGSFighter()], run.exp);
  runMatchup('Sword-Fighter vs Sword-Fighter', () => [makeSwordFighter()], () => [makeSwordFighter()], run.exp);
  runMatchup('Rogue vs Rogue', () => [makeRogue()], () => [makeRogue()], run.exp);
  runMatchup('GS-Fighter vs Rogue', () => [makeGSFighter()], () => [makeRogue()], run.exp);
  runMatchup('Sword-Fighter vs Rogue', () => [makeSwordFighter()], () => [makeRogue()], run.exp);
  runMatchup('GS-Fighter vs Caster (veil 50)', () => [makeGSFighter(50)], () => [makeCaster()], run.exp);
  runMatchup('GS-Fighter(veil300) vs Caster', () => [makeGSFighter(300)], () => [makeCaster()], run.exp);
  runMatchup('GS-Fighter(veil600) vs Caster', () => [makeGSFighter(600)], () => [makeCaster()], run.exp);
  runMatchup('3x Sword-Fighter vs Rogue', () => [makeSwordFighter(), makeSwordFighter(), makeSwordFighter()], () => [makeRogue()], run.exp);
  console.log('');
}
Object.assign(CFG, DEFAULTS);

// Damage-scale sanity block: per-hit nets at exp 1.0
console.log('── Per-hit net damage reference (no defense response, MULT=1.0) ──');
const refs = [
  ['GS@2.0x → Fighter', 707 * 2, 364 + 199 + 112],
  ['GS@2.0x → Rogue', 707 * 2, 242 + 49 + 81],
  ['GS@2.0x → Caster', 707 * 2, 180 + 96 + 81],
  ['Sword@1.0x → Fighter', 693, 364 + 100 + 112],
  ['Dagger@1.0x → Fighter', 686, 364 + 100 + 112],
  ['Dagger@1.0x → Rogue', 686, 242 + 49 + 81],
  ['MindBlast → Fighter veil50 (post-pool)', 721, 50 + 112],
  ['MindBlast → Fighter veil600 (post-pool)', 721, 600 + 112],
];
for (const [l, d, m] of refs)
  console.log(`${l.padEnd(42)} dmg ${String(Math.round(d)).padStart(4)} − mitig ${String(m).padStart(3)} = net ${Math.max(0, Math.round(d - m))}`);
