/**
 * PROFICIENCY-ON-TO-HIT DESIGN SIM — 2026-07-30
 *
 * Damage already carries the proficiency ladder (shipped 77710bc); to-hit was
 * never wired. This sims FIVE candidate shapes for the accuracy half against
 * the LIVE dodge contest, using roster numbers pulled from the game
 * 2026-07-30 (see __profPull in the session log — every constant below is a
 * live read, nothing invented).
 *
 * THE CONTEST (mirrored exactly from item.mjs dodge resolution):
 *   hitTotal = H x hitMult x (1 + (a + shift)/100)        a = d20
 *   droll    = (lane / 1.1) x (1 - 0.15 x stacks) x (1 + d/100)   d = d20
 *   droll >= hitTotal x (1 + reach)  -> clean dodge
 *   droll >= hitTotal x (1 - band')  -> graze, HALF damage pre-wall
 *   else                             -> full hit
 * Baseline: hitMult 1, shift 0, reach 0, band' = 0.10.
 *
 * OPTIONS (profRel = ladder mult / anchor mult, e.g. uncommon = 1.167):
 *   O0 baseline    hit untouched (today)
 *   OA full        hitMult = profRel                (naive completion)
 *   OB sqrt        hitMult = profRel^0.5
 *   OC quarter     hitMult = profRel^0.25
 *   OD window      shift = 2 faces per tier from common (bounded, dice-space)
 *   OE grazefront  hit frontier untouched; graze frontier moves:
 *                    reach = (profRel-1) x 0.30 above the hit total (masters
 *                    clip even successful dodges for half damage);
 *                    negative for untrained (their full hits degrade).
 *
 * POLICIES (results are policy-relative):
 *   - Defender dodges every swing while effective basis >= 0.55 x attacker
 *     hit blend, else stands and eats it (bulk).
 *   - One-sided TTK (defender does not attack back) - same metric as the
 *     crush sweep; mirrors resolve on who wins the race, shown separately.
 *   - Scramble: +1 stack per dodge, continuous decay 1 stack per quarter of
 *     the DEFENDER's reference round. Dodge celerity cost not modeled (the
 *     defender is not acting). Perceive gate not modeled (all matchups are
 *     same-band, ratios < 2.5 checked by hand).
 *   - Graze = 0.5 x raw damage, walls subtract AFTER (current live shape).
 *   - Defender guard (blockDR) already carries THEIR proficiency (shipped);
 *     the `hard` numbers below are live reads and include it.
 */

'use strict';

// ── LIVE PULL 2026-07-30 ────────────────────────────────────────────────
const C = {
  dodgeBasisDiv: 1.1, grazeBandPct: 0.10, scrambleStackPct: 0.15,
  anchor: 0.6,
  ladder: { rusty: 0.4, common: 0.6, uncommon: 0.7, rare: 0.8, epic: 0.9, legendary: 1.0, divine: 1.2 },
};

const ATK = [
  { name: 'Gabriel', skill: 'Strike', hit: 918, dmg: 300, wait: 695, rrl: 4066, prof: 'uncommon' },
  { name: 'Phil', skill: 'Strike', hit: 870, dmg: 1023, wait: 2725, rrl: 4338, prof: 'uncommon' },
  { name: 'George', skill: 'Royal Axe', hit: 973, dmg: 1354, wait: 2503, rrl: 4157, prof: 'uncommon' },
  { name: 'Khalid', skill: 'Spear Thrust', hit: 907, dmg: 989, wait: 2163, rrl: 4520, prof: 'uncommon' },
  { name: 'Frieda', skill: 'Snipe', hit: 1135, dmg: 1429, wait: 1656, rrl: 4293, prof: 'uncommon', lane: 'ranged' },
];

const DEF = {
  Gabriel: { melee: 1114, ranged: 834, hard: 187, dr: 138, hp: 748, rrl: 4066 },
  Phil:    { melee: 808,  ranged: 637, hard: 912, dr: 256, hp: 1388, rrl: 4338 },
  George:  { melee: 957,  ranged: 440, hard: 697, dr: 142, hp: 1258, rrl: 4157 },
  Khalid:  { melee: 854,  ranged: 540, hard: 508, dr: 87,  hp: 818,  rrl: 4520 },
  Frieda:  { melee: 1104, ranged: 1361, hard: 357, dr: 119, hp: 641, rrl: 4293 },
  Harvey:  { melee: 340,  ranged: 391, hard: 352, dr: 101, hp: 833,  rrl: 4451 },
};

// Tier index distance from common, for the window option.
const TIER_STEPS = { rusty: -2, common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, divine: 6 };

const profRel = (tier) => (C.ladder[tier] ?? C.anchor) / C.anchor;

// ── OPTIONS ─────────────────────────────────────────────────────────────
const OPTIONS = {
  O0_baseline:   (t) => ({ hitMult: 1, shift: 0, reach: 0 }),
  OA_full:       (t) => ({ hitMult: profRel(t), shift: 0, reach: 0 }),
  OB_sqrt:       (t) => ({ hitMult: Math.pow(profRel(t), 0.5), shift: 0, reach: 0 }),
  OC_quarter:    (t) => ({ hitMult: Math.pow(profRel(t), 0.25), shift: 0, reach: 0 }),
  OD_window:     (t) => ({ hitMult: 1, shift: 2 * (TIER_STEPS[t] ?? 0), reach: 0 }),
  OE_grazefront: (t) => ({ hitMult: 1, shift: 0, reach: (profRel(t) - 1) * 0.30 }),
  // RULED 2026-07-30: multiplicative, compressed to 10% per rank from common.
  OF_ruled10pct: (t) => ({ hitMult: 1 + 0.10 * (TIER_STEPS[t] ?? 0), shift: 0, reach: 0 }),
};

// ── EXACT CONTEST ENUMERATION (400 cells) ───────────────────────────────
// Returns {dodge, graze, full, ev} where ev = expected fraction of a full
// hit's damage that lands PRE-WALL (graze counts 0.5).
function contest(H, opt, dodgeBasis, stacks = 0) {
  const dv = dodgeBasis * Math.max(0, 1 - C.scrambleStackPct * stacks);
  let dodge = 0, graze = 0, full = 0;
  const band = C.grazeBandPct;
  for (let a = 1; a <= 20; a++) {
    const hit = H * opt.hitMult * (1 + (a + opt.shift) / 100);
    const grazeTop = hit * (1 + Math.max(0, opt.reach));
    const grazeBot = hit * (1 - band + Math.min(0, opt.reach));
    for (let d = 1; d <= 20; d++) {
      const droll = dv * (1 + d / 100);
      if (droll >= grazeTop) dodge++;
      else if (droll >= grazeBot) graze++;
      else full++;
    }
  }
  const n = 400;
  return { dodge: dodge / n, graze: graze / n, full: full / n,
           ev: (full + 0.5 * graze) / n };
}

// ── ONE-SIDED TTK, celerity loop with scramble decay ────────────────────
function ttk(atk, def, opt, tier, trials = 3000) {
  const lane = atk.lane ?? 'melee';
  const basis = def[lane] / C.dodgeBasisDiv;
  const dmg = atk.dmg * profRel(tier);          // damage ladder is SHIPPED
  const o = opt(tier);
  const willDodge = basis >= 0.55 * atk.hit * o.hitMult;
  const decayTicks = def.rrl / 4;               // 1 stack per quarter round
  let totalRounds = 0, never = 0;
  for (let t = 0; t < trials; t++) {
    let hp = def.hp, time = 0, stacks = 0, lastDodge = -1e9, swings = 0;
    while (hp > 0 && swings < 400) {
      swings++;
      if (willDodge) {
        stacks = Math.max(0, stacks - (time - lastDodge) / decayTicks);
        lastDodge = time;
        const dv = basis * Math.max(0, 1 - C.scrambleStackPct * stacks);
        const a = 1 + Math.floor(Math.random() * 20);
        const d = 1 + Math.floor(Math.random() * 20);
        const hit = atk.hit * o.hitMult * (1 + (a + o.shift) / 100);
        const droll = dv * (1 + d / 100);
        const grazeTop = hit * (1 + Math.max(0, o.reach));
        const grazeBot = hit * (1 - C.grazeBandPct + Math.min(0, o.reach));
        stacks += 1;
        if (droll >= grazeTop) { time += atk.wait; continue; }
        const mult = droll >= grazeBot ? 0.5 : 1;
        hp -= Math.max(0, mult * dmg - def.hard - def.dr);
      } else {
        hp -= Math.max(0, dmg - def.hard - def.dr);
      }
      time += atk.wait;
    }
    if (hp > 0) { never++; continue; }
    totalRounds += time / atk.rrl;
  }
  const ok = trials - never;
  return { rounds: ok ? +(totalRounds / ok).toFixed(1) : Infinity,
           neverPct: +(100 * never / trials).toFixed(0) };
}

// ── REPORT ──────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padStart(n);
const TIERS = ['rusty', 'common', 'uncommon', 'rare', 'legendary', 'divine'];

console.log('=== 1. THE CONTEST: Phil (claymore) swings at Gabriel (best dodger, basis '
  + Math.round(DEF.Gabriel.melee / C.dodgeBasisDiv) + ' vs hit 870) ===');
console.log('p(clean dodge) / p(graze) / p(full hit), fresh defender, by ATTACKER tier\n');
let hdr = 'option'.padEnd(15);
for (const t of TIERS) hdr += pad(t, 17);
console.log(hdr);
for (const [name, opt] of Object.entries(OPTIONS)) {
  let row = name.padEnd(15);
  for (const t of TIERS) {
    const r = contest(870, opt(t), DEF.Gabriel.melee / C.dodgeBasisDiv);
    row += pad(`${Math.round(r.dodge * 100)}/${Math.round(r.graze * 100)}/${Math.round(r.full * 100)}`, 17);
  }
  console.log(row);
}

console.log('\n=== 2. EV THROUGH THE DODGE LAYER: % of a full hit landing per swing (pre-wall), same matchup ===');
console.log('The dodge layer only - multiply by the shipped damage ladder for the whole per-swing effect.\n');
hdr = 'option'.padEnd(15);
for (const t of TIERS) hdr += pad(t, 11);
console.log(hdr);
for (const [name, opt] of Object.entries(OPTIONS)) {
  let row = name.padEnd(15);
  for (const t of TIERS) {
    const r = contest(870, opt(t), DEF.Gabriel.melee / C.dodgeBasisDiv);
    row += pad((r.ev * 100).toFixed(1) + '%', 11);
  }
  console.log(row);
}

console.log('\n=== 3. THE CLIFF DIAGNOSTIC: biggest single-tier jump, in percentage points of EV ===');
for (const [name, opt] of Object.entries(OPTIONS)) {
  let worst = 0, at = '';
  for (let i = 0; i < TIERS.length - 1; i++) {
    const r1 = contest(870, opt(TIERS[i]), DEF.Gabriel.melee / C.dodgeBasisDiv);
    const r2 = contest(870, opt(TIERS[i + 1]), DEF.Gabriel.melee / C.dodgeBasisDiv);
    const jump = (r2.ev - r1.ev) * 100;
    if (jump > worst) { worst = jump; at = `${TIERS[i]}->${TIERS[i + 1]}`; }
  }
  console.log(`  ${name.padEnd(15)} worst step +${worst.toFixed(0)}pp of EV  (${at})`);
}

console.log('\n=== 4. TODAY-PARITY CHECK: whole roster is UNCOMMON. What happens to dodge rates with NO gap? ===');
console.log('Phil->Gabriel clean-dodge % (baseline 61%): both sides trained, tier equal.\n');
for (const [name, opt] of Object.entries(OPTIONS)) {
  const r = contest(870, opt('uncommon'), DEF.Gabriel.melee / C.dodgeBasisDiv);
  console.log(`  ${name.padEnd(15)} dodge ${Math.round(r.dodge * 100)}%  graze ${Math.round(r.graze * 100)}%  full ${Math.round(r.full * 100)}%`);
}

console.log('\n=== 5. TTK MATRIX (one-sided rounds-to-kill, live rarities = all uncommon) ===');
const MATCH = [
  ['Phil', 'Gabriel'], ['George', 'Gabriel'], ['Khalid', 'Gabriel'],
  ['Gabriel', 'Phil'], ['George', 'Phil'], ['Frieda', 'Gabriel'], ['Frieda', 'Phil'],
];
hdr = 'matchup'.padEnd(20);
for (const o of Object.keys(OPTIONS)) hdr += pad(o.replace(/^O._?/, ''), 11);
console.log(hdr);
for (const [an, dn] of MATCH) {
  const atk = ATK.find(a => a.name === an);
  let row = `${an}->${dn}`.padEnd(20);
  for (const opt of Object.values(OPTIONS)) {
    const r = ttk(atk, DEF[dn], opt, 'uncommon');
    row += pad(r.neverPct > 50 ? 'never' : r.rounds + 'r', 11);
  }
  console.log(row);
}

// Wide-band what-if: same contest with the d20 worth 2.5% per face (a +-50%
// swing) instead of 1% - the leading candidate direction of the PENDING dice
// band ruling. Which option shapes survive a band change?
function contestBand(H, opt, dodgeBasis, s) {
  const dv = dodgeBasis;
  let dodge = 0, graze = 0, full = 0;
  for (let a = 1; a <= 20; a++) {
    const hit = H * opt.hitMult * (1 + ((a + opt.shift) * s) / 100);
    const grazeTop = hit * (1 + Math.max(0, opt.reach));
    const grazeBot = hit * (1 - C.grazeBandPct + Math.min(0, opt.reach));
    for (let d = 1; d <= 20; d++) {
      const droll = dv * (1 + (d * s) / 100);
      if (droll >= grazeTop) dodge++;
      else if (droll >= grazeBot) graze++;
      else full++;
    }
  }
  return { dodge: dodge / 400, graze: graze / 400, full: full / 400 };
}
console.log('\n=== 6b. WIDE-BAND WHAT-IF (d20 x 2.5%/face, the pending band ruling direction) ===');
console.log('Phil->Gabriel dodge/graze/full by tier - does the option stay a curve when the band changes?\n');
hdr = 'option'.padEnd(15);
for (const t of TIERS) hdr += pad(t, 17);
console.log(hdr);
for (const [name, opt] of Object.entries(OPTIONS)) {
  let row = name.padEnd(15);
  for (const t of TIERS) {
    const r = contestBand(870, opt(t), DEF.Gabriel.melee / C.dodgeBasisDiv, 2.5);
    row += pad(`${Math.round(r.dodge * 100)}/${Math.round(r.graze * 100)}/${Math.round(r.full * 100)}`, 17);
  }
  console.log(row);
}

console.log('\n=== 6. GAP SCENARIOS on the marquee dodge fight (Phil -> Gabriel), TTK by Phil tier ===');
hdr = 'Phil tier'.padEnd(15);
for (const o of Object.keys(OPTIONS)) hdr += pad(o.replace(/^O._?/, ''), 11);
console.log(hdr);
for (const t of TIERS) {
  let row = t.padEnd(15);
  for (const opt of Object.values(OPTIONS)) {
    const r = ttk(ATK.find(a => a.name === 'Phil'), DEF.Gabriel, opt, t);
    row += pad(r.neverPct > 50 ? 'never' : r.rounds + 'r', 11);
  }
  console.log(row);
}
