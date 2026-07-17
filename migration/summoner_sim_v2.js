#!/usr/bin/env node
/**
 * SUMMONER SIM v2 (2026-07-16) — the FINAL model (design-summoner-archetype.md).
 * Supersedes summoner_sim.js (dead budget model). New model:
 *   - A bond is a magic skill; casting it rolls a single value V ≈ summoner_int ×
 *     rarityMult (LIVE: Large Mana Bolt = intMod×(1+d4/100)×mult).
 *   - The bond's per-stat VECTOR (creature shape) distributes V into a normal
 *     stat block: stat = V × vec[stat]. The summon then computes HP/def/dmg/
 *     celerity with the SAME live formulas.
 *   - COMMANDED-ONLY, shared clock. No independent mode. Commanding the summon
 *     spends the summoner's action; the summon is also the front soak body.
 *
 * GROUNDING — LIVE 2026-07-16 (server up):
 *   Summoner = Willy (L59): int672 wil722 wis648 per494 vit354 dex316 tough103,
 *     mana722 hp664, dodge511 armor175 blockDR121 dr52.
 *   Fighter  = George (L62): str888 dex616 vit690 tough288, hp1294,
 *     dodge971 armor455 blockDR320 dr144.
 *
 * QUESTIONS:
 *  Q1 (exploit): for a bond vector + rarity, is commanded summon DPS > the
 *     summoner's self-cast DPS? If yes, commanding is a DPS win → forbidden
 *     ("never best of both worlds"). Self-cast must stay the DPS upper bound.
 *  Q2 (identity): for non-exploit vectors, does the soak body keep the team
 *     competitive-not-dominant (parity ~45-55% vs a specialist; strong vs the
 *     caster/attrition matchup, hard-countered by the fighter/alpha)?
 */

const CFG = {
  SCALE: 10000, DODGE_COST_FRAC: 0.25, SCRAMBLE_PCT: 0.15, GRAZE_BAND: 0.10,
  DODGE_DIV: 1.1, BLOCK_COEF: 80, WINDUP_MIN: 0.5, WINDUP_MAX: 3.0,
  RARITY_MULT: Number(process.env.RM ?? 0.7), TRIALS: 4000, MAX_ROUNDS: 60,
  DODGE_DMG_FRAC: 0.08, DODGE_MIN_WINPROB: 0.35, DESPERATE_WINPROB: 0.15,
  DESPERATE_DMG_FRAC: 0.25, PARRY_DMG_FRAC: 0.12,
};
const meleeBlend = { strFloor: 0.30, slope: 0.70, weightOffset: 40, weightSpan: 180 };

const d20 = () => 1 + Math.floor(Math.random() * 20);
const windup = (w) => Math.min(CFG.WINDUP_MAX, Math.max(CFG.WINDUP_MIN, w / 100));
function wBlend(weight, str, dex) {
  const norm = Math.max(0, Math.min(1, (weight - meleeBlend.weightOffset) / meleeBlend.weightSpan));
  const w = meleeBlend.strFloor + meleeBlend.slope * norm;
  return Math.round(str * w + dex * (1 - w));
}
function winProb(defVal, atkBlend) {
  let w = 0;
  for (let i = 1; i <= 20; i++) for (let j = 1; j <= 20; j++)
    if (defVal * (1 + i / 100) >= atkBlend * (1 + j / 100)) w++;
  return w / 400;
}
function investFactor(weight, blend, tough) {
  const base = Math.max(1, Math.round((weight / 20) * (blend / 1085)));
  const safe = Math.max(0, Math.round(0.02 * tough));
  return Math.pow((base + safe) / base, 0.2);
}
const hpOf = (vitMod) => Math.round(vitMod * 1.25 * 1.5);

// ── Real live anchors (mods) ──
const WILLY = { int: 672, wil: 722, wis: 648, per: 494, vit: 354, dex: 316, tough: 103, str: 91, end: 98,
                mana: 722, hp: 664, dodgeMelee: 511, dodgeMind: 953, armor: 175, blockDR: 121, dr: 52 };
const GEORGE = { str: 888, dex: 616, vit: 690, tough: 288, int: 202, hp: 1294,
                 dodgeMelee: 971, armor: 455, blockDR: 320, dr: 144 };

// ── Specialists (real-anchored) ──
// Fighter (George, greatsword w=200): the ALPHA counter.
function makeFighter(weight = 200, name = 'GS-Fighter(George)') {
  const g = GEORGE, blend = wBlend(weight, g.str, g.dex);
  const refRound = 3_000_000 / g.str;   // reference round ∝ primary-mod (celerity)
  return { name, kind: 'phys', hitBlend: Math.round(g.str * 0.9 + g.dex * 0.3), dmgBlend: blend, weight,
    dmg: Math.round(blend * CFG.RARITY_MULT * windup(weight) * investFactor(weight, blend, g.tough)),
    defMelee: g.dodgeMelee, maxHp: g.hp, armor: g.armor, toughDR: Math.round(0.25 * g.tough),
    blockDR: g.blockDR, wait: Math.round(weight * CFG.SCALE / g.str), hasParry: true, refRound };
}
// Rogue: dex-primary variant of the fighter anchor (dagger w=60), fast striker.
function makeRogue() {
  const g = GEORGE, w = 60, dex = g.str, str = g.dex, blend = wBlend(w, str, dex); // swap: dex primary
  const refRound = 3_000_000 / dex;
  return { name: 'Rogue', kind: 'phys', hitBlend: Math.round(dex * 0.9 + str * 0.3), dmgBlend: blend, weight: w,
    dmg: Math.round(blend * CFG.RARITY_MULT * windup(w) * investFactor(w, blend, g.tough)),
    defMelee: Math.round(dex * 1.1), maxHp: hpOf(Math.round(g.vit * 0.85)), armor: Math.round(0.35 * dex),
    toughDR: Math.round(0.25 * g.tough), blockDR: Math.round(CFG.BLOCK_COEF * (w / 100)),
    wait: Math.round(w * CFG.SCALE / dex), hasParry: true, refRound };
}
// Caster (Willy profile): the ATTRITION matchup + the summoner's own baseline.
function makeCaster(name = 'Caster(Willy)') {
  const c = WILLY, w = 150, speed = Math.round(0.6 * c.wis + 0.4 * c.int);
  const refRound = 3_000_000 / c.int;
  return { name, kind: 'spell', hitBlend: Math.round(c.int * 0.9 + c.per * 0.3),
    dmg: Math.round(c.int * CFG.RARITY_MULT), weight: w,
    defMelee: c.dodgeMelee, maxHp: c.hp, armor: c.armor, toughDR: Math.round(0.25 * c.tough),
    blockDR: c.blockDR, wait: Math.round(w * CFG.SCALE / speed), hasParry: false, refRound,
    manaMax: c.mana, hasShield: true };
}
// Summoner = the caster, action clock SLOWED by maintain drain.
function makeSummoner(drain) {
  const c = makeCaster('Summoner(Willy)');
  c.wait = Math.round(c.wait / (1 - drain)); c.drain = drain; return c;
}

// ── The SUMMON: stats = V × vector, computed with the live formulas. ──
// V = summoner int × rarityMult (the bond skill's roll value). `vec` is the
// creature shape (per-stat multiplier). Returns the soak body + a COMMANDED
// attack profile (dmg + wait) for the exploit check.
function makeSummon(vec, rarityMult, weapon = 100) {
  const V = WILLY.int * rarityMult;
  const s = {};
  for (const k of ['vit', 'str', 'dex', 'tough', 'int', 'wil', 'wis', 'per']) s[k] = (vec[k] ?? 0) * V;
  const refRound = 3_000_000 / WILLY.int;
  // Offense: a spell if int-shaped, else a weapon. (A bond swings a real weapon,
  // so weight↔damage coupling self-balances DPS; casters cast.)
  let dmg, wait, hitBlend;
  if ((vec.int ?? 0) >= Math.max(vec.str ?? 0, vec.dex ?? 0)) {
    const speed = Math.round(0.6 * s.wis + 0.4 * s.int);
    dmg = Math.round(s.int * CFG.RARITY_MULT); wait = Math.round(150 * CFG.SCALE / Math.max(1, speed));
    hitBlend = Math.round(s.int * 0.9 + s.per * 0.3);
  } else {
    const blend = wBlend(weapon, s.str, s.dex), speed = Math.max(1, Math.round(s.str * 0.5 + s.dex * 0.5));
    dmg = Math.round(blend * CFG.RARITY_MULT * windup(weapon) * investFactor(weapon, blend, s.tough));
    wait = Math.round(weapon * CFG.SCALE / speed);
    hitBlend = Math.round(s.dex * 0.9 + s.str * 0.3);
  }
  return {
    name: 'Summon', kind: 'summon', isSummon: true, refRound,
    maxHp: hpOf(s.vit), armor: Math.round(0.4 * Math.max(s.str, s.int)), toughDR: Math.round(0.25 * s.tough),
    blockDR: Math.round(CFG.BLOCK_COEF * (weapon / 100)), defMelee: Math.round(Math.max(s.dex, s.str) * 1.1),
    hasParry: false, wait: Infinity,          // soak body: no autonomous action (commanded only)
    cmdDmg: dmg, cmdWait: wait, cmdHitBlend: hitBlend,   // commanded attack profile (exploit check)
  };
}

// ── Event loop (from tri_tier / summoner_sim, multi-body) ──
function spawn(p) {
  return { ...p, hp: p.maxHp, next: isFinite(p.wait) ? Math.floor(Math.random() * 200) : Infinity,
           stacks: 0, lastDecay: 0, reactionRound: -1, mana: p.manaMax ?? 0, shieldRound: -1 };
}
function attack(atk, def, t, oneShot) {
  const aroll = atk.hitBlend * (1 + d20() / 100), dmg = atk.dmg;
  const mitig = def.armor + def.blockDR + def.toughDR, netEaten = Math.max(0, dmg - mitig);
  const dec = (t - def.lastDecay) / (def.refRound / 4);
  def.stacks = Math.max(0, def.stacks - dec); def.lastDecay = t;
  const dv = (def.defMelee / CFG.DODGE_DIV) * Math.max(0, 1 - CFG.SCRAMBLE_PCT * def.stacks);
  const wp = winProb(dv, atk.hitBlend), rnd = Math.floor(t / def.refRound);
  let action = 'eat';
  const casterMelee = def.kind === 'spell' && atk.kind !== 'spell';
  if (!casterMelee) {
    if (netEaten >= CFG.DODGE_DMG_FRAC * def.maxHp && wp >= CFG.DODGE_MIN_WINPROB) action = 'dodge';
    else if (def.hasParry && rnd > def.reactionRound && netEaten >= CFG.PARRY_DMG_FRAC * def.maxHp) action = 'parry';
    else if (netEaten >= CFG.DESPERATE_DMG_FRAC * def.maxHp && wp >= CFG.DESPERATE_WINPROB) action = 'dodge';
  }
  let net = netEaten;
  if (action === 'dodge') {
    def.stacks += 1; def.next += Math.round(CFG.DODGE_COST_FRAC * def.wait);
    const droll = dv * (1 + d20() / 100);
    if (droll >= aroll) net = 0;
    else if (droll >= aroll * (1 - CFG.GRAZE_BAND)) net = Math.max(0, dmg / 2 - mitig);
  } else if (action === 'parry') {
    def.reactionRound = rnd;
    const proll = (def.defMelee / CFG.DODGE_DIV) * (1 + d20() / 100);
    if (proll >= aroll) net = 0;
  }
  if (def.hasShield && def.mana > 0 && rnd > def.shieldRound && net > 0) {
    const absorb = Math.min(net, def.mana); net -= absorb; def.mana -= absorb; def.shieldRound = rnd;
  }
  if (net >= def.maxHp) oneShot.count++;
  def.hp -= net;
}
function fight(A0, B0) {
  const A = A0.map(spawn), B = B0.map(spawn), oneShot = { count: 0 }, refR = A.find(x => isFinite(x.wait))?.refRound ?? A[0].refRound;
  let t = 0; const maxT = CFG.MAX_ROUNDS * refR;
  while (t < maxT) {
    const aliveA = A.filter(x => x.hp > 0), aliveB = B.filter(x => x.hp > 0);
    if (!aliveA.length || !aliveB.length) break;
    const all = [...aliveA, ...aliveB].filter(x => isFinite(x.next));
    if (!all.length) break;
    const actor = all.reduce((m, x) => (x.next < m.next ? x : m));
    t = actor.next; if (t >= maxT) break;
    const foes = (A.includes(actor) ? aliveB : aliveA);
    attack(actor, foes[0], t, oneShot);   // front body = index 0 soaks
    actor.next += actor.wait;
  }
  return A.some(x => x.hp > 0) && !B.some(x => x.hp > 0) ? 'A'
       : B.some(x => x.hp > 0) && !A.some(x => x.hp > 0) ? 'B' : 'draw';
}
function run(label, mkA, mkB) {
  const w = { A: 0, B: 0, draw: 0 };
  for (let i = 0; i < CFG.TRIALS; i++) w[fight(mkA(), mkB())]++;
  const aw = Math.round(100 * w.A / CFG.TRIALS);
  console.log(`  ${label.padEnd(46)} team:${String(aw).padStart(3)}%  enemy:${String(Math.round(100 * w.B / CFG.TRIALS)).padStart(3)}%  draw:${String(Math.round(100 * w.draw / CFG.TRIALS)).padStart(3)}%`);
  return aw;
}
const dps = (p) => p.cmdDmg / p.cmdWait;
const selfDps = (c) => c.dmg / c.wait;

// ── Bond vectors (creature shapes). All ≤ 1 per stat. ──
const VECTORS = {
  Imp_caster:  { vit: .30, int: .90, wis: .80, per: .40, tough: .20 },
  Striker:     { vit: .35, str: .55, dex: .85, tough: .30, per: .30 },
  Tank:        { vit: .90, str: .55, tough: .80, dex: .30 },
  Bruiser:     { vit: .60, str: .90, dex: .50, tough: .60 },
};

console.log('SUMMONER SIM v2 — final model (stats = V×vector). LIVE anchors: Willy (summoner) / George (fighter). RARITY_MULT=' + CFG.RARITY_MULT);
console.log('V = summoner int × rarity =', WILLY.int, '× rarity.\n');

// Q1 — EXPLOIT CHECK: commanded summon DPS vs summoner self-cast DPS, per vector × rarity.
const summonerSelf = makeCaster('Summoner-selfcast');
const selfDPS = selfDps(summonerSelf);
console.log('Q1 EXPLOIT CHECK — self-cast DPS =', selfDPS.toFixed(4), '(commanding must stay ≤ this)');
for (const rm of [1.0, 1.5, 2.0]) {
  const row = [`  rarityV×${rm}: `];
  for (const [vn, vec] of Object.entries(VECTORS)) {
    const s = makeSummon(vec, rm);
    const r = dps(s) / selfDPS;
    row.push(`${vn} ${(r).toFixed(2)}x${r > 1.0 ? '!!' : ''}`);
  }
  console.log(row.join('  '));
}
console.log('  (>1.00 = commanding out-DPSes self-casting = FORBIDDEN. Melee shapes at high rarity are the risk.)\n');

// Q2 — IDENTITY: team (summon body + summoner) vs specialists, per vector × rarity × drain.
console.log('Q2 IDENTITY — team vs solo specialists (parity ~45-55%; dominant >65%).');
const enemies = { GS_alpha: makeFighter, Rogue: makeRogue, Caster_attrition: () => makeCaster('Caster-enemy') };

// baseline: solo summoner (no summon) vs each.
console.log('  ── baseline: SOLO caster (no summon) ──');
const base = {};
for (const [en, mk] of Object.entries(enemies)) base[en] = run(`solo caster vs ${en}`, () => [makeCaster('solo')], () => [mk()]);

for (const rm of [1.0, 1.5]) for (const drain of [0.25, 0.35]) {
  for (const [vn, vec] of Object.entries(VECTORS)) {
    console.log(`  ── bond=${vn}  rarityV×${rm}  drain=${drain} ──`);
    for (const [en, mk] of Object.entries(enemies)) {
      const team = () => [makeSummon(vec, rm), makeSummoner(drain)];   // summon front (soak), summoner behind
      const aw = run(`team vs ${en}`, team, () => [mk()]);
      const d = aw - base[en];
      console.log(`      Δ vs solo baseline: ${d >= 0 ? '+' : ''}${d} pts`);
    }
  }
}

// Probes: team vs TWO enemies (should struggle); concurrency (2 summons under 75% cap).
console.log('  ── probes ──');
run('Tank team vs 2× Rogue (not a party sub)', () => [makeSummon(VECTORS.Tank, 1.5), makeSummoner(0.35)], () => [makeRogue(), makeRogue()]);
run('2× Imp swarm vs GS (concurrency, 2×drain .35=.70)', () => [makeSummon(VECTORS.Imp_caster, 1.0), makeSummon(VECTORS.Imp_caster, 1.0), makeSummoner(0.35)], () => [makeFighter()]);
console.log('\n(team=A. Identity: strong vs Caster/attrition, hard-countered by GS/alpha; parity vs a specialist; no exploit in Q1.)');
