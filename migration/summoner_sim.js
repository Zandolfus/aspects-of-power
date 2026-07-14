#!/usr/bin/env node
/**
 * SUMMONER SIM — the DEFERRED half (2026-07-04).
 * The action-economy DPS sim (2026-07-02, design-summoner-archetype.md) landed
 * ship candidates but explicitly deferred "board presence + soak + multi-target"
 * — a single-target DPS model can't see the summon's BODY. This sim adds it, by
 * running summoner+summon TEAMS through the live-validated tri_tier event loop
 * (which already handles multi-body sides: targets first-alive, so a front summon
 * soaks for the caster behind it).
 *
 * QUESTION: with the summon's body modelled, do the ship candidates
 *   (budget b 25-30%, commanded drain 25-35%, independent drain 50%, 75% cap)
 * keep the summoner COMPETITIVE-NOT-DOMINANT vs solo specialists?
 *
 * TARGET MATRIX (summoner-specific, playbook style):
 *   - Team vs solo specialist: ~45-55% win (PARITY — trades DPS for a body;
 *     NOT a "best of both worlds" win). Dominant if >~65%.
 *   - The board-presence value shows as: team win% > SOLO-caster win% vs the same
 *     specialist (the body earns its keep), but the delta is modest, not a landslide.
 *   - Team vs TWO enemies: team should STRUGGLE (a budget-fraction body is not a
 *     second real actor) — a summoner is not a substitute for a 2-actor party.
 *
 * MODEL (faithful to the 2026-07-02 rulings + the DPS-sim findings):
 *   - COMMANDED mode: the summoner has ONE action economy. Commanding replaces a
 *     self-cast at <=1x efficiency (DPS-sim: commanded per-point 0.6-0.9x < self),
 *     so self-cast is the summoner's DPS UPPER BOUND. We therefore model commanded
 *     team damage AS the summoner self-casting (its own clock, SLOWED by maintain
 *     drain 1/(1-d_cmd)); the summon adds NO autonomous damage — its entire value
 *     is SOAK. => commanded summon is a TANK (budget -> vit/tough/armor), front body.
 *   - INDEPENDENT mode (AI-tag unlock): summon acts on its OWN clock and adds DPS;
 *     summoner pays a HIGHER standing drain. => summon is a STRIKER (budget ->
 *     dex/str), both deal damage.
 *   - BUDGET: summon stat pool = b x summonerTotalMods, distributed across the
 *     role's spread; HP/armor/DR/dmg then computed via the SAME live formulas.
 *
 * GROUNDING (captured-real; server down 2026-07-04 -> RE-CONFIRM LIVE before ship):
 *   - Event loop, archetypes, constants: verbatim from tri_tier_balance_sim.js
 *     (live-validated rarity 0.7, census anchors).
 *   - summonerTotalMods: mid-E ~2625 (2026-07-02 DPS sim); high-E ~3705 (scaled
 *     by prim ratio 1016/720). FLAG: derived, confirm from a real summoner actor.
 *
 * NOT MODELLED: focus-fire/positioning nuance (front body = simple threat order),
 *   summon skills/CC, re-summon on death, healing, invest sliders, the swarm case
 *   beyond a 2-small-summon check. As the playbook says: the sim bounds the math.
 */

const CFG = {
  SCALE: 10000, DODGE_COST_FRAC: 0.25, SCRAMBLE_PCT: 0.15, GRAZE_BAND: 0.10,
  DODGE_DIV: 1.1, BLOCK_COEF: 80, WINDUP_MIN: 0.5, WINDUP_MAX: 3.0,
  RARITY_MULT: Number(process.env.RM ?? 0.7), TRIALS: 3000, MAX_ROUNDS: 60,
  DODGE_DMG_FRAC: 0.08, DODGE_MIN_WINPROB: 0.35, DESPERATE_WINPROB: 0.15,
  DESPERATE_DMG_FRAC: 0.25, PARRY_DMG_FRAC: 0.12,
};
const meleeBlend = { strFloor: 0.30, slope: 0.70, weightOffset: 40, weightSpan: 180 };
const spellTierFactors = { basic: 2, high: 4, greater: 8 };
const spellAbove = { basic: 0.05, high: 0.08, greater: 0.15 };
const spellTierWeights = { basic: 130, high: 150, greater: 200 };
const GRADE_FACTOR = { F: 5, E: 10 };

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
function spellDamage(intMod, wisMod, tier, grade) {
  const gf = GRADE_FACTOR[grade];
  const base = Math.round(spellTierFactors[tier] * gf);
  const ref = Math.max(1, Math.round(2 * gf));
  const invest = Math.round(base + wisMod * spellAbove[tier]);
  return { dmg: Math.round(intMod * CFG.RARITY_MULT * Math.pow(Math.max(invest, 1) / ref, 0.2)), invest };
}
function investFactor(weight, blend, tough) {
  const base = Math.max(1, Math.round((weight / 20) * (blend / 1085)));
  const safe = Math.max(0, Math.round(0.02 * tough));
  return Math.pow((base + safe) / base, 0.2);
}
const hpOf = (vitMod) => Math.round(vitMod * 1.25 * 1.5);

const TIERS = {
  mid:  { label: 'MID-E (~L50)',  grade: 'E', prim: 720,  sec: 500, ter: 350, dump: 200,
          vitF: 480, vitR: 380, vitC: 220, defF: 930,  defR: 954,  defC: 385,
          armorMult: 0.5, refRound: 3_000_000 / 720,  totalMods: 2625 },
  high: { label: 'HIGH-E (~L95)', grade: 'E', prim: 1016, sec: 730, ter: 500, dump: 300,
          vitF: 900, vitR: 720, vitC: 420, defF: 1400, defR: 1450, defC: 560,
          armorMult: 0.5, refRound: 3_000_000 / 1016, totalMods: 3705 },
};

function makeFighter(T, weight = 200, name = 'GS-Fighter') {
  const str = T.prim, dex = T.sec, tough = T.ter, blend = wBlend(weight, str, dex);
  return { name, kind: 'phys', tier: T, hitBlend: Math.round(str * 0.9 + dex * 0.3), dmgBlend: blend, weight,
    dmg: Math.round(blend * CFG.RARITY_MULT * windup(weight) * investFactor(weight, blend, tough)),
    defMelee: T.defF, maxHp: hpOf(T.vitF), armor: Math.round(T.armorMult * str), toughDR: Math.round(0.25 * tough),
    blockDR: Math.round(CFG.BLOCK_COEF * (weight / 100) * (1 + str / 1085)), wait: Math.round(weight * CFG.SCALE / str),
    hasParry: true, refRound: T.refRound };
}
function makeRogue(T) {
  const w = 60, dex = T.prim, str = T.ter, tough = T.dump, blend = wBlend(w, str, dex);
  return { name: 'Rogue', kind: 'phys', tier: T, hitBlend: Math.round(dex * 0.9 + str * 0.3), dmgBlend: blend, weight: w,
    dmg: Math.round(blend * CFG.RARITY_MULT * windup(w) * investFactor(w, blend, tough)),
    defMelee: T.defR, maxHp: hpOf(T.vitR), armor: Math.round(0.35 * dex), toughDR: Math.round(0.25 * tough),
    blockDR: Math.round(CFG.BLOCK_COEF * (w / 100) * (1 + str / 1085)), wait: Math.round(w * CFG.SCALE / dex),
    hasParry: true, refRound: T.refRound };
}
function makeCaster(T, tier = 'basic', name) {
  const int = T.prim, wis = T.sec, tough = T.dump;
  const { dmg, invest } = spellDamage(int, wis, tier, T.grade);
  const speed = Math.round(0.6 * wis + 0.4 * int), w = spellTierWeights[tier];
  return { name: name ?? `Caster(${tier})`, kind: 'spell', tier: T, hitBlend: Math.round(int * 0.9 + T.ter * 0.3),
    dmg, invest, weight: w, defMelee: T.defC, maxHp: hpOf(T.vitC), armor: Math.round(0.35 * int),
    toughDR: Math.round(0.25 * tough), blockDR: 0, wait: Math.round(w * CFG.SCALE / speed),
    hasParry: false, refRound: T.refRound,
    // Mana Shield (RULED design-archetype-defense-gap): once/round, absorb one
    // hit 1:1 up to remaining mana. The caster's real melee-survival floor —
    // without it the sim degenerately one-shots every caster. manaMax ~0.8×sec
    // (caster wil-mod ≈ 388 mid-E in the census). FLAG: confirm live.
    manaMax: Math.round(T.sec * 0.8), hasShield: true };
}

// ── Summoner: a caster whose action clock is SLOWED by maintain drain. ──
function makeSummoner(T, tier, drain) {
  const c = makeCaster(T, tier, `Summoner(${tier})`);
  c.wait = Math.round(c.wait / (1 - drain));   // maintain drain = % Celerity-rate loss
  c.drain = drain;
  return c;
}
// ── Summon: budget b x summonerTotal distributed across a role's stat spread. ──
// TANK: vit/tough heavy, weak attack, high soak (commanded — pure body).
// STRIKER: dex heavy, own clock, real damage, squishy (independent).
function makeSummon(T, b, role, commanded) {
  const budget = b * T.totalMods;
  if (role === 'tank') {
    const vit = 0.55 * budget, tough = 0.30 * budget, str = 0.15 * budget, w = 120;
    const blend = wBlend(w, str, str * 0.6);
    return { name: 'Summon(tank)', kind: 'phys', tier: T, hitBlend: Math.round(str * 0.9),
      dmgBlend: blend, weight: w, dmg: Math.round(blend * CFG.RARITY_MULT * windup(w)),
      defMelee: Math.round(0.8 * str * 1.1), maxHp: hpOf(vit), armor: Math.round(0.5 * str),
      toughDR: Math.round(0.25 * tough), blockDR: Math.round(CFG.BLOCK_COEF * (w / 100)),
      wait: commanded ? Infinity : Math.round(w * CFG.SCALE / Math.max(1, str)),
      hasParry: false, refRound: T.refRound, isSummon: true };
  }
  // striker
  const dex = 0.55 * budget, vit = 0.25 * budget, str = 0.20 * budget, w = 80;
  const blend = wBlend(w, str, dex);
  return { name: 'Summon(striker)', kind: 'phys', tier: T, hitBlend: Math.round(dex * 0.9 + str * 0.3),
    dmgBlend: blend, weight: w, dmg: Math.round(blend * CFG.RARITY_MULT * windup(w) * investFactor(w, blend, T.dump)),
    defMelee: Math.round(dex * 1.1), maxHp: hpOf(vit), armor: Math.round(0.35 * dex),
    toughDR: Math.round(0.25 * str), blockDR: Math.round(CFG.BLOCK_COEF * (w / 100)),
    wait: commanded ? Infinity : Math.round(w * CFG.SCALE / Math.max(1, dex)),
    hasParry: false, refRound: T.refRound, isSummon: true };
}

// ── Event loop (verbatim from tri_tier; multi-body already supported) ──
function spawn(p) {
  return { ...p, hp: p.maxHp, next: isFinite(p.wait) ? Math.floor(Math.random() * 200) : Infinity,
           stacks: 0, lastDecay: 0, reactionRound: -1, mana: p.manaMax ?? 0, shieldRound: -1,
           diag: { dodges: 0, dodgeWins: 0, grazes: 0, parries: 0, eats: 0 } };
}
function attack(atk, def, t, oneShot) {
  const aroll = atk.hitBlend * (1 + d20() / 100), dmg = atk.dmg;
  const mitig = def.armor + def.blockDR + def.toughDR, netEaten = Math.max(0, dmg - mitig);
  const dec = (t - def.lastDecay) / (def.refRound / 4);
  def.stacks = Math.max(0, def.stacks - dec); def.lastDecay = t;
  const dv = (def.defMelee / CFG.DODGE_DIV) * Math.max(0, 1 - CFG.SCRAMBLE_PCT * def.stacks);
  const wp = winProb(dv, atk.hitBlend), rnd = Math.floor(t / def.refRound);
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
  // Mana Shield: once per round, absorb one hit 1:1 up to remaining mana.
  if (def.hasShield && def.mana > 0 && rnd > def.shieldRound && net > 0) {
    const absorb = Math.min(net, def.mana);
    net -= absorb; def.mana -= absorb; def.shieldRound = rnd;
  }
  if (net >= def.maxHp) oneShot.count++;
  def.hp -= net;
  return net;
}
function fight(A0, B0) {
  const A = A0.map(spawn), B = B0.map(spawn), oneShot = { count: 0 }, refR = A[0].refRound;
  let t = 0; const maxT = CFG.MAX_ROUNDS * refR;
  while (t < maxT) {
    const aliveA = A.filter(x => x.hp > 0), aliveB = B.filter(x => x.hp > 0);
    if (!aliveA.length || !aliveB.length) break;
    const all = [...aliveA, ...aliveB].filter(x => isFinite(x.next));
    if (!all.length) break;
    const actor = all.reduce((m, x) => (x.next < m.next ? x : m));
    t = actor.next; if (t >= maxT) break;
    const target = (A.includes(actor) ? aliveB : aliveA)[0];   // front body = index 0
    attack(actor, target, t, oneShot);
    actor.next += actor.wait;
  }
  return { winner: A.some(x => x.hp > 0) && !B.some(x => x.hp > 0) ? 'A'
                 : B.some(x => x.hp > 0) && !A.some(x => x.hp > 0) ? 'B' : 'draw', rounds: t / refR };
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function run(label, mkA, mkB) {
  const dur = [], w = { A: 0, B: 0, draw: 0 };
  for (let i = 0; i < CFG.TRIALS; i++) {
    const r = fight(mkA(), mkB()); w[r.winner]++; if (r.winner !== 'draw') dur.push(r.rounds);
  }
  const med = dur.length ? pct(dur, 0.5) : NaN;
  const aw = Math.round(100 * w.A / CFG.TRIALS);
  console.log(`  ${label.padEnd(40)} team(A):${String(aw).padStart(3)}%  enemy(B):${String(Math.round(100 * w.B / CFG.TRIALS)).padStart(3)}%  draw:${String(Math.round(100 * w.draw / CFG.TRIALS)).padStart(3)}% | med ${isNaN(med) ? ' —' : med.toFixed(1).padStart(4)}r`);
  return aw;
}

console.log('SUMMONER SIM — team (summoner+summon) vs solo specialists. RARITY_MULT=' + CFG.RARITY_MULT);
console.log('Target: team ~45-55% (parity, NOT dominant >65%); board-value = team% > solo-caster% baseline; team vs 2 enemies should struggle.\n');

for (const [key, T] of Object.entries(TIERS)) {
  console.log(`\n═══ ${T.label} — summonerTotalMods ${T.totalMods} (DERIVED — re-confirm live) ═══`);
  const enemies = { GS: () => [makeFighter(T)], Sword: () => [makeFighter(T, 100, 'Sword')], Rogue: () => [makeRogue(T)], Caster: () => [makeCaster(T, 'high')] };
  const casterTier = 'high';

  // Baseline: SOLO caster (the summoner without summoning) vs each specialist.
  console.log('  ── baseline: SOLO caster vs specialist (no summon) ──');
  const base = {};
  for (const [en, mk] of Object.entries(enemies)) base[en] = run(`solo Caster vs ${en}`, () => [makeCaster(T, casterTier)], mk);

  // COMMANDED (tank summon, pure soak). Sweep b x d_cmd.
  for (const b of [0.25, 0.30]) for (const d of [0.25, 0.35]) {
    console.log(`  ── COMMANDED  b=${b}  drain=${d}  (tank summon, soak-only; summoner self-casts slowed) ──`);
    for (const [en, mk] of Object.entries(enemies)) {
      const team = () => [makeSummon(T, b, 'tank', true), makeSummoner(T, casterTier, d)]; // tank front
      const aw = run(`team vs ${en}`, team, mk);
      console.log(`      Δ vs solo-caster baseline: ${aw - base[en] >= 0 ? '+' : ''}${aw - base[en]} pts`);
    }
  }

  // INDEPENDENT (summon on own clock + damage; summoner heavily drained).
  // Sweep BOTH body roles — mode is action-economy, not body-type. A durable
  // autonomous body (tank) vs a glass striker are very different survival bets.
  for (const role of ['striker', 'tank']) for (const d of [0.50]) {
    const b = 0.30;
    console.log(`  ── INDEPENDENT  b=${b}  drain=${d}  role=${role}  (own clock+dmg; summoner heavily slowed) ──`);
    for (const [en, mk] of Object.entries(enemies)) {
      const team = () => [makeSummon(T, b, role, false), makeSummoner(T, casterTier, d)];
      const aw = run(`team vs ${en}`, team, mk);
      console.log(`      Δ vs solo-caster baseline: ${aw - base[en] >= 0 ? '+' : ''}${aw - base[en]} pts`);
    }
  }

  // Failure-mode probes at the ship candidate (b .30):
  console.log('  ── probes @ b=0.30 ──');
  // (a) team vs TWO enemies (should struggle — not a 2-actor substitute)
  run('commanded team vs 2x Rogue', () => [makeSummon(T, .30, 'tank', true), makeSummoner(T, casterTier, .35)], () => [makeRogue(T), makeRogue(T)]);
  // (b) 2-small-summon swarm (concurrency under the 75% cap: 2 tanks @ d .35 each = .70)
  run('2-tank swarm (b .15 ea) vs GS', () => [makeSummon(T, .15, 'tank', true), makeSummon(T, .15, 'tank', true), makeSummoner(T, casterTier, .35)], () => [makeFighter(T)]);
  // (c) OVERTUNE check: b .50 independent striker (the DPS-sim's forbidden zone)
  run('OVERTUNE b .50 indep vs GS', () => [makeSummon(T, .50, 'striker', false), makeSummoner(T, casterTier, .50)], () => [makeFighter(T)]);
}
console.log('\n(team=A. Board-value = commanded Δ positive but modest. Dominant if team >65% or overtune spikes. Re-confirm summonerTotalMods + archetypes live before ship.)');
