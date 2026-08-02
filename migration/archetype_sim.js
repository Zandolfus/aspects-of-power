/**
 * ARCHETYPE BALANCE SIM — runs against the LIVE world, through the REAL pipeline.
 *
 * Paste into the Foundry console as a GM, or eval it. Results land on
 * `window.__archetypeSim` and a summary is returned.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Balance sims in this project used to re-implement the damage chain by hand,
 * because the chain lived inside a chat-render hook and nothing else could call
 * it. On 2026-08-01 that produced four separate wrong answers in one session —
 * a dice regex that ate the house d20 (every attacker 10% too accurate), a
 * rarity flag the real path does not pass, unmodelled caster implements, and a
 * missing staff bonus. All four numbers looked reasonable, which is what made
 * them expensive: they were used to argue for balance changes.
 *
 * So this sim calls the SHIPPED code for everything it possibly can:
 *   - damage           → helpers/formulas.mjs   (spellInvest / strikeInvest)
 *   - windup + wait    → systems/celerity.mjs   (computeWindupMultiplier, computeActionWait)
 *   - proficiency      → systems/weapon-styles.mjs
 *   - MITIGATION CHAIN → systems/damage.mjs     (resolveDamage)
 *
 * ⚠ THE ONE REMAINING SEAM: the ARMOUR LAYER value (armor + blockDR, reduced by
 * pierce/crush/melt) is still computed inside `item.mjs#_resolveDefenseCheck`,
 * which is not extracted. This file recomputes it from the same CONFIG knobs.
 * If that ever drifts, this sim drifts with it — extracting it is the next seam
 * worth cutting.
 *
 * ⚠ HIT FORMULAS CONTAIN THE HOUSE `d20` AND NOTHING ELSE. Evaluate them by
 * PASSING d20, never by substituting dice means — that was one of the four bugs.
 * Damage formulas DO contain real dice and must have their means substituted.
 */
(async () => {
  const SID = game.system.id;
  const F   = await import(`/systems/${SID}/module/helpers/formulas.mjs`);
  const CEL = await import(`/systems/${SID}/module/systems/celerity.mjs`);
  const WS  = await import(`/systems/${SID}/module/systems/weapon-styles.mjs`);
  const DMG = await import(`/systems/${SID}/module/systems/damage.mjs`);
  const sc  = CONFIG.ASPECTSOFPOWER;
  const dt  = sc.defenseTuning;
  const AA  = sc.armorAnswer ?? {};

  /* ---------------- CONFIG ---------------- */
  const CFG = {
    actors: ['[SIM] Tank', '[SIM] Heavy Weapon', '[SIM] Light Weapon', '[SIM] Ranger', '[SIM] Caster'],
    label: (n) => n.replace('[SIM] ', ''),
    // Crush is a debuff that ramps; model it at its steady-state stack count.
    crushStacks: AA.armorCrushMaxStacks ?? 3,
    // Scramble degrades a defender's dodge as they keep dodging. 0 = fresh.
    scrambleStacks: 0,
    // Band thresholds for the report, from the house target matrix
    // (mirror 6-8 rounds, cross-lane favoured 3-4, never below 2).
    lethal: 3, grindy: 8,
  };

  /* ------------- helpers ------------- */
  // Damage formulas: substitute dice MEANS. Handles bare `d8` as well as `2d8`.
  const meanDice = (s) => String(s).replace(/(\d*)d(\d+)/g,
    (_m, n, f) => String((n ? Number(n) : 1) * (Number(f) + 1) / 2));
  const evalDamage = (f) => { try { const v = Function('return ' + meanDice(f))(); return Number.isFinite(v) ? v : null; } catch { return null; } };
  // Hit formulas: PASS d20, never substitute.
  const hitAt = (f, d20) => { try { const v = Function('d20', 'return ' + f)(d20); return Number.isFinite(v) ? v : null; } catch { return null; } };

  /* ------------- attacker profiles ------------- */
  function profileSkill(actor, sk) {
    const rd = sk.getRollData?.();
    if (!rd?.roll) return null;
    const tags = sk.system.tags ?? [];
    if (!tags.includes('attack')) return null;

    let built; try { built = sk._buildRollFormulas(rd); } catch { return null; }

    // Accuracy: base formula, then the proficiency ladder, then the per-skill
    // multiplier — the same order and gating item.mjs applies.
    let hitF = built.hitFormula;
    if (hitF && (sc.weaponProficiency?.rollTypes ?? []).includes(rd.roll.type)) {
      const hm = WS.proficiencyHitMult(actor, sk._proficiencyWeapon());
      if (hm !== 1) hitF = `(${hitF})*${hm}`;
    }
    const sm = sk.system?.tagConfig?.hitMult ?? 1;
    if (hitF && sm !== 1) hitF = `(${hitF})*${sm}`;
    const hitBasis = hitF ? hitAt(hitF, 0) : 0;

    const tier  = sk.system.roll?.tier;
    const grade = actor.system.attributes?.race?.rank || sk.system.roll?.grade || '';
    const res   = rd.roll.resource;
    const eff   = sk._resolveRarityMods().effectiveMult;

    let branch = 'legacy', dmg = null, wait = null, cost = null;

    if (['mana', 'health'].includes(res) && tier && grade
        && sc.spellTierFactors[tier] && sc.spellGradeFactors[grade]) {
      branch = 'spell';
      const gf = sc.spellGradeFactors[grade];
      const baseCost = Math.round(sc.spellTierFactors[tier] * gf);
      dmg  = F.spellInvestDamage(actor.system.abilities.intelligence.mod, eff, baseCost, F.spellDamageRef(gf));
      wait = CEL.computeActionWait(actor, sk, null, baseCost);
      cost = baseCost;
    } else if (res === 'stamina' && ['str_weapon', 'dex_weapon', 'phys_ranged'].includes(rd.roll.type)) {
      const wpn = sk._resolveWeaponForSkill();
      const wt  = sk.constructor.resolveWeaponWeight(wpn);
      if (wt > 0) {
        branch = 'weapon';
        const A = actor.system.abilities;
        const isRanged = rd.roll.type === 'phys_ranged';
        const { blend } = F.weaponStatBlend(wt,
          { str: A.strength.mod, dex: A.dexterity.mod, per: A.perception.mod }, isRanged);
        const baseStam = Math.max(1, Math.round(
          (wt / sc.invest.staminaBaseDivisor) * (blend / sc.invest.staminaNormalizer)));
        dmg  = F.strikeInvestDamage(blend, eff, CEL.computeWindupMultiplier(sk, wpn), baseStam, baseStam);
        wait = CEL.computeActionWait(actor, sk, wpn);
        cost = baseStam;
      }
    }
    // Anything matching neither invest gate falls to roll()'s legacy fallback,
    // which does NOT apply applyRarityMult — so no rarity scaling. Reproduced
    // faithfully rather than "corrected", because that is what the table runs.
    if (branch === 'legacy') {
      dmg  = evalDamage(built.dmgFormula);
      wait = CEL.computeActionWait(actor, sk, sk._resolveWeaponForSkill?.() ?? null);
    }
    if (!(dmg > 0) || !(wait > 0)) return null;

    const wpnTags = sk._resolveWeaponForSkill?.()?.system?.tags ?? [];
    return {
      actor: actor.name, name: sk.name, branch, dmg, cost, wait,
      hitBasis, lane: sk.system.roll?.targetDefense || '',
      pierce: tags.includes('pierce')
           || (AA.pierceWeaponTypes ?? []).some(t => wpnTags.includes(t)),
      crush: tags.includes('crush'),
      damageType: sk.system.roll?.damageType || 'physical',
    };
  }

  /* ------------- defender profiles ------------- */
  function profileDefender(actor) {
    const d = actor.system.defense ?? {};
    return {
      name: actor.name,
      hp: Math.round(actor.system.health?.max ?? 0),
      armorLayer: Math.round((d.armor?.value ?? 0) + (d.blockDR ?? 0)),
      dr: Math.round(d.dr?.value ?? 0),
      veil: Math.round(d.veil?.value ?? 0),
      overhealth: Math.round(actor.system.overhealth?.value ?? 0),
      augPhys: actor.system.damageReduction?.physical ?? 0,
      augMag: actor.system.damageReduction?.magical ?? 0,
      lanes: {
        melee: Math.round(d.melee?.value ?? 0), ranged: Math.round(d.ranged?.value ?? 0),
        mind: Math.round(d.mind?.value ?? 0),   soul: Math.round(d.soul?.value ?? 0),
      },
    };
  }

  /**
   * Mean damage per landed swing, enumerating the full 20x20 dice grid rather
   * than sampling. Every outcome goes through resolveDamage — the same function
   * the apply-damage button calls.
   */
  function meanPerSwing(atk, def) {
    const usesVeil = atk.lane === 'mind' || atk.lane === 'soul';
    // ⚠ SEAM: mirrors item.mjs#_resolveDefenseCheck. Keep in step with it.
    const pierceFlat = atk.pierce ? Math.round((AA.pierceHitFrac ?? 0.23) * atk.dmg) : 0;
    const crushFlat  = atk.crush
      ? Math.round((AA.crushDamageFrac ?? 0.05) * atk.dmg) * CFG.crushStacks : 0;
    const mitigation = usesVeil
      ? def.veil
      : Math.max(0, def.armorLayer - pierceFlat - crushFlat);

    const laneVal = def.lanes[atk.lane] ?? 0;
    const canDefend = !!atk.lane && laneVal > 0 && atk.hitBasis > 0;
    const defBasis = (laneVal / (dt.dodgeBasisDiv ?? 1.1))
                   * Math.max(0, 1 - (dt.scrambleStackPct ?? 0.15) * CFG.scrambleStacks);

    let total = 0, n = 0, zero = 0;
    for (let a = 1; a <= 20; a++) {
      const hitTotal = atk.hitBasis * (1 + a / 100);
      const defSides = canDefend ? 20 : 1;
      for (let b = 1; b <= defSides; b++) {
        const margin = canDefend
          ? F.defenceMarginMultiplier(defBasis * (1 + b / 100), hitTotal)
          : 1;
        const res = DMG.resolveDamage({
          incoming: atk.dmg,
          mitigation, mitigationLabel: usesVeil ? 'Veil' : 'Armor',
          drValue: def.dr,
          augDR: atk.damageType === 'physical' ? def.augPhys : def.augMag,
          margin,
          overhealth: def.overhealth,
          health: def.hp,
        });
        total += res.hpLoss; n++; if (res.hpLoss <= 0) zero++;
      }
    }
    return { mean: total / n, whiffPct: zero / n };
  }

  /* ------------- run ------------- */
  const actors = CFG.actors.map(n => game.actors.getName(n)).filter(Boolean);
  if (actors.length < 2) return 'Need at least two of CFG.actors present in the world.';

  const defenders = actors.map(profileDefender);
  const skills = [];
  for (const a of actors) {
    for (const sk of a.items) {
      if (sk.type !== 'skill') continue;
      const p = profileSkill(a, sk);
      if (p) skills.push(p);
    }
  }

  const roundLen = CEL.referenceRoundLength(actors[0].system.attributes?.race?.level ?? 1);
  const grid = {}, choices = {}, ttks = [];
  let immune = 0, pairs = 0;

  for (const def of defenders) {
    grid[CFG.label(def.name)] = {};
    for (const atk of actors) {
      if (atk.name === def.name) continue;
      pairs++;
      let best = { dpr: 0, skill: null };
      for (const sk of skills.filter(s => s.actor === atk.name)) {
        const { mean } = meanPerSwing(sk, def);
        const dpr = mean * (roundLen / sk.wait);
        if (dpr > best.dpr) best = { dpr, skill: sk.name, perSwing: mean };
      }
      const key = CFG.label(atk.name);
      if (best.dpr <= 0.01) { immune++; grid[CFG.label(def.name)][key] = 'IMMUNE'; }
      else {
        const ttk = def.hp / best.dpr;
        ttks.push(ttk);
        grid[CFG.label(def.name)][key] = Math.round(ttk * 10) / 10;
        choices[`${key} -> ${CFG.label(def.name)}`] =
          `${best.skill} (${Math.round(best.perSwing)}/swing, ${Math.round(best.dpr)} dpr)`;
      }
    }
  }

  ttks.sort((a, b) => a - b);
  const summary = {
    roundLengthTicks: roundLen,
    pairs, immune,
    immunePct: Math.round(immune / pairs * 100),
    medianRounds: ttks.length ? Math.round(ttks[Math.floor(ttks.length / 2)] * 10) / 10 : null,
    belowFloor: ttks.filter(t => t < 2).length,
    lethal: ttks.filter(t => t <= CFG.lethal).length,
    grindy: ttks.filter(t => t > CFG.grindy).length,
  };

  window.__archetypeSim = { summary, grid, choices, skills, defenders, cfg: CFG };
  console.table(grid);
  return JSON.stringify({ summary, grid }, null, 1);
})()
