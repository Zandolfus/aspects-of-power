#!/usr/bin/env node
/**
 * TRI-TIER BALANCE REVIEW — low (F, L15) / mid-E (L50) / high-E (L95+)
 * (2026-07-03 overnight math review; extends active_defense_sim.js's
 * validated event loop with tier-parameterized archetypes.)
 *
 * GROUNDING (get-the-math-from-the-game):
 *  - Stat anchors from the live 211-actor census (migration/local/census.json):
 *      L15 F: primary mod ~210, defMelee ~270-300, hp 180-340
 *      L50 E: primary ~720, defMelee ~880-960 (players), hp ~600 geared
 *      L99 E: primary ~1016 (Vampire/Zombie), defMelee ~1300-1450, hp 1348-1905
 *  - Shipped constants (constants_live.json): dodgeBasisDiv 1.1, scramble 15%,
 *    graze 10%, dodgeCost 25%, blockDRCoef 80, hpScale 1.5 (already inside the
 *    census hp anchors), windup = weight×mult/100 clamp [0.5, 3].
 *  - Weapon strike: dmg = weaponStatBlend(weight) × rarityMult × windup
 *    (validated: George Royal Axe 888 × 0.6 × 2.2 = 1172 == live card).
 *  - Spell: dmg = int.mod × rarityMult × (safeInvest/ref)^0.2, ref = 2×gradeFactor;
 *    safeInvest = tierBase + wis×aboveBase[tier] (65f8a42 model, live-verified
 *    584/660/755/919 ladder). Elemental spells are RANGED-lane dodgeable and
 *    mitigated by armor+DR (2026-07-02 ruling: never veil).
 *  - Armor anchor: geared fighter ≈ 0.5 × primary mod (George 455/888,
 *    Aiden 302/759 ≈ 0.40-0.51); casters ≈ 0.35×. toughDR = 0.25 × tough.mod.
 *
 * POLICIES: as shipped sim (dodge ≥8% HP @ 35% win, desperate ≥25% @ 15%,
 * parry ≥12%, eat otherwise). Casters don't dodge melee.
 * NOT MODELED: skills/content (Hemorrhage/Feint/buffs/marks/CC), movement,
 * invest above base for strikes, barriers, healing, multi-target AOE.
 *
 * TARGET MATRIX (playbook): mirrors 6-8r · cross-lane favored 3-4r · never <2r.
 */

const CFG = {
  SCALE: 10000,
  DODGE_COST_FRAC: 0.25,
  SCRAMBLE_PCT: 0.15,
  GRAZE_BAND: 0.10,
  DODGE_DIV: 1.1,
  BLOCK_COEF: 80,
  WINDUP_MIN: 0.5, WINDUP_MAX: 3.0,
  RARITY_MULT: Number(process.env.RM ?? 0.7),       // uncommon-standard kit; sweep 0.6/0.9 if needed
  TRIALS: 3000,
  MAX_ROUNDS: 60,
  DODGE_DMG_FRAC: 0.08, DODGE_MIN_WINPROB: 0.35,
  DESPERATE_WINPROB: 0.15, DESPERATE_DMG_FRAC: 0.25,
  PARRY_DMG_FRAC: 0.12,
};

// Live blend/config tables (constants_live.json).
const meleeBlend = { strFloor: 0.30, slope: 0.70, weightOffset: 40, weightSpan: 180 };
const spellTierFactors = { basic: 2, high: 4, greater: 8, major: 25, grand: 50 };
const spellAbove = { basic: 0.05, high: 0.08, greater: 0.15, major: 0.25, grand: 0.4 };
const spellTierWeights = { basic: 130, high: 150, greater: 200, major: 400, grand: 700 };
const castingSpeedW = { basic: { wis: 0.6, int: 0.4 }, high: { wis: 0.6, int: 0.4 }, greater: { wis: 0.65, int: 0.35 } };
const GRADE_FACTOR = { F: 5, E: 10 }; // spellGradeFactors

const d20 = () => 1 + Math.floor(Math.random() * 20);
const windup = (weight) => Math.min(CFG.WINDUP_MAX, Math.max(CFG.WINDUP_MIN, weight * 1.0 / 100));
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
function spellDamage(intMod, wisMod, tier, grade) {
  const gf = GRADE_FACTOR[grade];
  const base = Math.round(spellTierFactors[tier] * gf);
  const ref = Math.max(1, Math.round(2 * gf));
  const invest = Math.round(base + wisMod * spellAbove[tier]);
  return { dmg: Math.round(intMod * CFG.RARITY_MULT * Math.pow(Math.max(invest, 1) / ref, 0.2)), invest };
}

/**
 * TIER ANCHORS — mods per archetype role, from the census.
 * refRound = ROUND_K / refMod(RL) — live table gave RL49:4907 RL60:4248 RL62:4157;
 * approximate per tier via ROUND_K 3_000_000 / primary-mod-of-median-fighter.
 */
const TIERS = {
  low:  { label: 'LOW (F, ~L15)',    grade: 'F', prim: 210, sec: 155, ter: 120, dump: 80,
          vitF: 180, vitR: 140, vitC: 110, defF: 290, defR: 320, defC: 150,
          armorMult: 0.5, refRound: 3_000_000 / 210 },
  mid:  { label: 'MID-E (~L50)',     grade: 'E', prim: 720, sec: 500, ter: 350, dump: 200,
          vitF: 480, vitR: 380, vitC: 220, defF: 930, defR: 954, defC: 385,
          armorMult: 0.5, refRound: 3_000_000 / 720 },
  high: { label: 'HIGH-E (~L95)',    grade: 'E', prim: 1016, sec: 730, ter: 500, dump: 300,
          vitF: 900, vitR: 720, vitC: 420, defF: 1400, defR: 1450, defC: 560,
          armorMult: 0.5, refRound: 3_000_000 / 1016 },
};
const hpOf = (vitMod) => Math.round(vitMod * 1.25 * 1.5);

function investFactor(weight, blend, tough) {
  // Real strike invest math: players invest to the safe ceiling.
  const base = Math.max(1, Math.round((weight / 20) * (blend / 1085)));
  const safe = Math.max(0, Math.round(0.02 * tough));
  return Math.pow((base + safe) / base, 0.2);
}
function makeFighter(T, weight = 200, name = 'GS-Fighter') {
  const str = T.prim, dex = T.sec, tough = T.ter;
  const blend = wBlend(weight, str, dex);
  return {
    name, kind: 'phys', tier: T,
    hitBlend: Math.round(str * 0.9 + dex * 0.3),
    dmgBlend: blend, weight,
    dmg: Math.round(blend * CFG.RARITY_MULT * windup(weight) * investFactor(weight, blend, tough)),
    defMelee: T.defF, maxHp: hpOf(T.vitF),
    armor: Math.round(T.armorMult * str), toughDR: Math.round(0.25 * tough),
    blockDR: Math.round(CFG.BLOCK_COEF * (weight / 100) * (1 + str / 1085)),
    wait: Math.round(weight * CFG.SCALE / str),
    hasParry: true, refRound: T.refRound,
  };
}
function makeRogue(T) {
  const w = 60, dex = T.prim, str = T.ter, tough = T.dump;
  const blend = wBlend(w, str, dex);
  return {
    name: 'Rogue', kind: 'phys', tier: T,
    hitBlend: Math.round(dex * 0.9 + str * 0.3),
    dmgBlend: blend, weight: w,
    dmg: Math.round(blend * CFG.RARITY_MULT * windup(w) * investFactor(w, blend, tough)),
    defMelee: T.defR, maxHp: hpOf(T.vitR),
    armor: Math.round(0.35 * dex), toughDR: Math.round(0.25 * tough),
    blockDR: Math.round(CFG.BLOCK_COEF * (w / 100) * (1 + str / 1085)),
    wait: Math.round(w * CFG.SCALE / dex),
    hasParry: true, refRound: T.refRound,
  };
}
function makeCaster(T, tier = 'basic') {
  const int = T.prim, wis = T.sec, tough = T.dump;
  const { dmg, invest } = spellDamage(int, wis, tier, T.grade);
  const speed = Math.round(0.6 * wis + 0.4 * int);
  const w = spellTierWeights[tier];
  return {
    name: `Caster(${tier})`, kind: 'spell', tier: T,
    hitBlend: Math.round(int * 0.9 + T.ter * 0.3), // magic_projectile hit
    dmg, invest, weight: w,
    defMelee: T.defC, maxHp: hpOf(T.vitC),
    armor: Math.round(0.35 * int), toughDR: Math.round(0.25 * tough),
    blockDR: 0,
    wait: Math.round(w * CFG.SCALE / speed),
    hasParry: false, refRound: T.refRound,
  };
}

// ── Event loop (physical + elemental-spell lanes; spells are ranged-dodgeable
//    and armor-mitigated per the 2026-07-02 ruling) ──
function spawn(p) {
  return { ...p, hp: p.maxHp, next: Math.floor(Math.random() * 200), stacks: 0, lastDecay: 0, reactionRound: -1,
           diag: { dodges: 0, dodgeWins: 0, grazes: 0, parries: 0, eats: 0 } };
}
function attack(atk, def, t, oneShot) {
  const aroll = atk.hitBlend * (1 + d20() / 100);
  const dmg = atk.dmg;
  const mitig = def.armor + def.blockDR + def.toughDR;
  const netEaten = Math.max(0, dmg - mitig);
  // scramble decay: 1 stack per quarter of DEFENDER's ref round
  const dec = (t - def.lastDecay) / (def.refRound / 4);
  def.stacks = Math.max(0, def.stacks - dec); def.lastDecay = t;
  const dv = (def.defMelee / CFG.DODGE_DIV) * Math.max(0, 1 - CFG.SCRAMBLE_PCT * def.stacks);
  const wp = winProb(dv, atk.hitBlend);
  const rnd = Math.floor(t / def.refRound);

  let action = 'eat';
  const casterMelee = def.kind === 'spell' && atk.kind === 'phys';
  if (!casterMelee) {
    if (netEaten >= CFG.DODGE_DMG_FRAC * def.maxHp && wp >= CFG.DODGE_MIN_WINPROB) action = 'dodge';
    else if (def.hasParry && rnd > def.reactionRound && netEaten >= CFG.PARRY_DMG_FRAC * def.maxHp) action = 'parry';
    else if (netEaten >= CFG.DESPERATE_DMG_FRAC * def.maxHp && wp >= CFG.DESPERATE_WINPROB) action = 'dodge';
  }
  let net = netEaten;
  if (action === 'dodge') {
    def.diag.dodges++; def.stacks += 1; def.next += Math.round(CFG.DODGE_COST_FRAC * def.wait);
    const droll = dv * (1 + d20() / 100);
    if (droll >= aroll) { def.diag.dodgeWins++; net = 0; }
    else if (droll >= aroll * (1 - CFG.GRAZE_BAND)) { def.diag.grazes++; net = Math.max(0, dmg / 2 - mitig); }
  } else if (action === 'parry') {
    def.diag.parries++; def.reactionRound = rnd;
    const proll = (def.defMelee / CFG.DODGE_DIV) * (1 + d20() / 100);
    if (proll >= aroll) net = 0;
  } else def.diag.eats++;
  if (net >= def.maxHp) oneShot.count++;
  def.hp -= net;
  return net;
}
function fight(A0, B0, trace = false) {
  const A = A0.map(spawn), B = B0.map(spawn);
  const oneShot = { count: 0 };
  const refR = A[0].refRound;
  let t = 0; const maxT = CFG.MAX_ROUNDS * refR;
  while (t < maxT) {
    const aliveA = A.filter(x => x.hp > 0), aliveB = B.filter(x => x.hp > 0);
    if (!aliveA.length || !aliveB.length) break;
    const actor = [...aliveA, ...aliveB].reduce((m, x) => (x.next < m.next ? x : m));
    t = actor.next; if (t >= maxT) break;
    const target = (A.includes(actor) ? aliveB : aliveA)[0];
    const net = attack(actor, target, t, oneShot);
    if (trace) console.log(`t=${Math.round(t)} ${actor.name}→${target.name} net=${Math.round(net)} hp=${Math.round(target.hp)} stacks=${target.stacks.toFixed(1)}`);
    actor.next += actor.wait;
  }
  return { winner: A.some(x => x.hp > 0) && !B.some(x => x.hp > 0) ? 'A' : B.some(x => x.hp > 0) && !A.some(x => x.hp > 0) ? 'B' : 'draw',
           rounds: t / refR, oneShots: oneShot.count, all: [...A, ...B] };
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function run(label, mkA, mkB) {
  const dur = [], w = { A: 0, B: 0, draw: 0 };
  let oneShotFights = 0, dodges = 0, wins = 0;
  for (let i = 0; i < CFG.TRIALS; i++) {
    const r = fight(mkA(), mkB());
    w[r.winner]++;
    if (r.winner !== 'draw') dur.push(r.rounds);
    if (r.oneShots) oneShotFights++;
    for (const x of r.all) { dodges += x.diag.dodges; wins += x.diag.dodgeWins; }
  }
  const med = dur.length ? pct(dur, 0.5) : NaN;
  console.log(`  ${label.padEnd(34)} A:${String(Math.round(100 * w.A / CFG.TRIALS)).padStart(3)}% B:${String(Math.round(100 * w.B / CFG.TRIALS)).padStart(3)}% draw:${String(Math.round(100 * w.draw / CFG.TRIALS)).padStart(3)}% | med ${isNaN(med) ? '  —' : med.toFixed(1).padStart(4)}r (p10 ${dur.length ? pct(dur, .1).toFixed(1) : '—'}/p90 ${dur.length ? pct(dur, .9).toFixed(1) : '—'}) | 1shot ${String(Math.round(100 * oneShotFights / CFG.TRIALS)).padStart(3)}% | dodgeWin ${dodges ? Math.round(100 * wins / dodges) : 0}%`);
}

// ── Per-tier matrix ──
for (const [key, T] of Object.entries(TIERS)) {
  const F = () => [makeFighter(T)], S = () => [makeFighter(T, 100, 'Sword-Fighter')], R = () => [makeRogue(T)];
  const Cb = () => [makeCaster(T, 'basic')], Ch = () => [makeCaster(T, 'high')];
  console.log(`\n═══ ${T.label} — grade ${T.grade}, refRound ${Math.round(T.refRound)} ticks ═══`);
  const f = makeFighter(T), s = makeFighter(T, 100, 'Sword'), r = makeRogue(T), cb = makeCaster(T, 'basic'), ch = makeCaster(T, 'high'), cg = makeCaster(T, 'greater');
  console.log(`  [stats] GS dmg ${f.dmg} wait ${f.wait} | sword dmg ${s.dmg} wait ${s.wait} | rogue dmg ${r.dmg} wait ${r.wait} | spell basic ${cb.dmg} (inv ${cb.invest}) wait ${cb.wait} / high ${ch.dmg} wait ${ch.wait} / greater ${cg.dmg}`);
  console.log(`  [mitig] fighter ${f.armor + f.blockDR + f.toughDR} (armor ${f.armor}+block ${f.blockDR}+DR ${f.toughDR}) | rogue ${r.armor + r.blockDR + r.toughDR} | caster ${cb.armor + cb.toughDR}`);
  console.log(`  [nets/hit] GS→F ${Math.max(0, f.dmg - (f.armor + f.blockDR + f.toughDR))} GS→R ${Math.max(0, f.dmg - (r.armor + r.blockDR + r.toughDR))} GS→C ${Math.max(0, f.dmg - (cb.armor + cb.toughDR))} | sword→F ${Math.max(0, s.dmg - (f.armor + f.blockDR + f.toughDR))} | rogue→F ${Math.max(0, r.dmg - (f.armor + f.blockDR + f.toughDR))} | spellB→F ${Math.max(0, cb.dmg - (f.armor + f.blockDR + f.toughDR))} spellH→F ${Math.max(0, ch.dmg - (f.armor + f.blockDR + f.toughDR))} spellB→R ${Math.max(0, cb.dmg - (r.armor + r.blockDR + r.toughDR))}`);
  console.log(`  [hp] fighter ${f.maxHp} rogue ${r.maxHp} caster ${cb.maxHp}`);
  run('GS mirror', F, F);
  run('Sword mirror', S, S);
  run('Rogue mirror', R, R);
  run('GS vs Rogue', F, R);
  run('Sword vs Rogue', S, R);
  run('GS vs Caster(basic)', F, Cb);
  run('Caster(high) vs Sword-Fighter', Ch, S);
  run('Rogue vs Caster(basic)', R, Cb);
}
console.log('\n(Targets: mirror 6-8r | favored cross 3-4r | never <2r. RARITY_MULT=' + CFG.RARITY_MULT + ')');
