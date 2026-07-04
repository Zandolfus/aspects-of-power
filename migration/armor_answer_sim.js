#!/usr/bin/env node
/**
 * ARMOR-ANSWER SIM (2026-07-03) — magnitudes for the two-layer wall.
 * Follows the hard-wall ruling: armor+blockDR is uncounterable by DR-strip;
 * the keys are PIERCE (static %ignore of the armor layer) and ARMOR CRUSH
 * (a stacking debuff that reduces armor+blockDR), while DR-strip opens the
 * small toughDR layer.
 *
 * Damage flow (design-armor-answer-system.md):
 *   armorEff = max(0, (armor + blockDR − armorCrush) × (1 − pierce))
 *   net      = max(0, max(0, raw − armorEff) − max(0, toughDR − drStrip))
 *
 * Rotation model: a KITTED attacker applies 1 crush stack + 1 strip stack per
 * hit (debuffs persist for the fight — a few-round duration covers it), so the
 * wall opens progressively; damage lands as it opens. crush/strip magnitude
 * scales with the attacker's own hit (× scale), matching the DoT-tick model.
 * BARE attacker = no tools (must out-raw the wall).
 *
 * Anchors: MID-E / HIGH-E fighter from the census (armor≈0.5×prim, blockDR by
 * weapon weight, toughDR 0.25×tough). Attacker raws are the tri-tier sim's
 * live-validated values (rarity 0.7). Target = fighter HP; TTK = hits×wait/refRound.
 * Playbook target: KITTED cracks fighter in ~6-8r; BARE bounces (>>8r / never).
 */

const SCALE = 10000;
const TIERS = {
  mid:  { label: 'MID-E (~L50)', prim: 720, tough: 350, refRound: 3_000_000 / 720,
          fighter: { armor: 360, blockDR: 266, toughDR: 88, hp: 900, wait: Math.round(200 * SCALE / 720) },
          // attacker raws (rarity 0.7, from tri_tier sim): [dmg, wait]
          sword: [549, Math.round(100 * SCALE / 720)], gs: [1149, Math.round(200 * SCALE / 720)],
          rogue: [303, Math.round(60 * SCALE / 720)], caster: [593, Math.round(130 * SCALE / (0.6*500+0.4*720))] },
  high: { label: 'HIGH-E (~L95)', prim: 1016, tough: 500, refRound: 3_000_000 / 1016,
          fighter: { armor: 508, blockDR: 310, toughDR: 125, hp: 1688, wait: Math.round(200 * SCALE / 1016) },
          sword: [794, Math.round(100 * SCALE / 1016)], gs: [1616, Math.round(200 * SCALE / 1016)],
          rogue: [455, Math.round(60 * SCALE / 1016)], caster: [877, Math.round(130 * SCALE / (0.6*730+0.4*1016))] },
};

// One kitted-rotation TTK. crushFrac = %-of-armor removed PER stack (capped
// at crushCap stacks) — a modest rotation opener, not a raw-scaling delete.
// pierce = static %ignore. dotScale opens toughDR (raw×scale/stack).
function ttk(raw, wait, F, { pierce = 0, crushFrac = 0, crushCap = 3, dotScale = 0, dotCap = 3 }, refRound) {
  let hp = F.hp, crushStacks = 0, strip = 0, hits = 0, t = 0, openHit = null;
  const armorBase = F.armor + F.blockDR;
  while (hp > 0 && hits < 400) {
    if (crushFrac && crushStacks < crushCap) crushStacks++;
    if (dotScale && hits < dotCap)           strip += raw * dotScale;
    const armorEff = Math.max(0, armorBase * (1 - Math.min(1, crushFrac * crushStacks)) * (1 - pierce));
    const toughEff = Math.max(0, F.toughDR - strip);
    const net = Math.max(0, Math.max(0, raw - armorEff) - toughEff);
    if (net > 0 && openHit === null) openHit = hits + 1;
    hp -= net;
    hits++; t += wait;
    if (net <= 0 && hits > Math.max(crushCap, dotCap) + 3) return { rounds: Infinity, net0: true };
  }
  return { rounds: t / refRound, hits, openHit };
}

console.log('ARMOR-ANSWER SIM — TTK (rounds) of attacker vs same-tier armored FIGHTER');
console.log('Target: KITTED ~6-8r · BARE bounces. Wall = armor+blockDR (opener needed) + toughDR (DR-strip).\n');

for (const [key, T] of Object.entries(TIERS)) {
  console.log(`═══ ${T.label} — fighter wall: armor ${T.fighter.armor}+block ${T.fighter.blockDR}=${T.fighter.armor+T.fighter.blockDR} armor-layer, ${T.fighter.toughDR} toughDR, ${T.fighter.hp} hp ═══`);
  const atks = [['sword', T.sword], ['rogue', T.rogue], ['caster', T.caster], ['GS(ref)', T.gs]];
  // BARE baseline
  console.log('  BARE (no tools):');
  for (const [name, [raw, wait]] of atks) {
    const r = ttk(raw, wait, T.fighter, {}, T.refRound);
    console.log(`    ${name.padEnd(9)} raw ${String(raw).padStart(4)} → ${r.net0 ? 'BOUNCES (net 0)' : r.rounds.toFixed(1)+'r'}`);
  }
  // KITTED sweeps — modest values. crush = %-armor/stack (cap 3); pierce static.
  const kits = [
    { label: 'pierce .25 only',                pierce: .25 },
    { label: 'pierce .35 only',                pierce: .35 },
    { label: 'crush .15/stk (→45%) + strip .1', crushFrac: .15, dotScale: .1 },
    { label: 'crush .20/stk (→60%) + strip .1', crushFrac: .20, dotScale: .1 },
    { label: 'pierce .25 + crush .15 + strip .1', pierce: .25, crushFrac: .15, dotScale: .1 },
    { label: 'pierce .3 + crush .1(→30%) + str .1', pierce: .3, crushFrac: .1, dotScale: .1 },
  ];
  for (const kit of kits) {
    const line = atks.map(([name, [raw, wait]]) => {
      const r = ttk(raw, wait, T.fighter, kit, T.refRound);
      return `${name} ${r.net0 ? 'bounce' : r.rounds.toFixed(1)+'r'}${r.openHit>1?`(open h${r.openHit})`:''}`;
    }).join(' | ');
    console.log(`  ${kit.label.padEnd(34)} ${line}`);
  }
  console.log('');
}
console.log('(crush = %-of-armor removed per stack, cap 3 stacks; strip opens toughDR raw×scale/stack cap 3; open hN = hit the wall first cracked.)');
