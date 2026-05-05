(async () => {
  const sc = CONFIG.ASPECTSOFPOWER;
  const PICKS = {
    Willy:   "Defiance Above, Obedience Below",
    Gabriel: "Skysteel Dagger",
    John:    "Pyroblast",
    Phil:    "Flamberge of Cleansing",
  };
  const ItemCls = CONFIG.Item.documentClass;

  const pillarFor = (skill, actor) => {
    const r = skill.system.roll;
    const tags = skill.system.tags || [];
    const isAttack = tags.includes('attack');
    const grade = actor.system.attributes.race?.rank ?? '';
    if (r.resource === 'mana' && r.tier && grade && isAttack) return 'spell';
    if (r.resource === 'stamina' && isAttack &&
        ['str_weapon','dex_weapon','phys_ranged'].includes(r.type)) return 'weapon';
    return 'legacy';
  };

  // Hypothetical implement: -23% wait on any spell with weight ≤ 150 (per
  // design-magic-system.md "Implements" section — wand brings Basic-tier
  // to 'magic's sword' 3 casts/round).
  const WAND_REDUCTION = 0.77;
  const WAND_WEIGHT_GATE = 150;

  const spellMath = (skill, actor, opts = {}) => {
    const r = skill.system.roll;
    const A = actor.system.abilities;
    const grade = actor.system.attributes.race?.rank ?? '';
    const tier = r.tier;
    const tierFactor  = sc.spellTierFactors[tier]  ?? 1;
    const gradeFactor = sc.spellGradeFactors[grade] ?? 1;
    const mods = skill._resolveRarityMods?.() ?? {};
    const effMult  = mods.effectiveMult           ?? 0.6;
    const costMult = mods.costMultiplier          ?? 1;
    const altMult  = mods.effectiveWeightMultiplier ?? 1;
    const manualMult = r.actionWeightMultiplier ?? 1;
    const baseCost = Math.round(tierFactor * gradeFactor * costMult);
    const intMod = A.intelligence?.mod ?? 0;
    const wisMod = A.wisdom?.mod       ?? 0;
    const safeInvest = sc.spellMaxInvestAboveBase?.[tier] ?? 0;
    const safeCost = baseCost + safeInvest;
    const dmgBase = Math.round(intMod * effMult * Math.pow(baseCost / Math.max(baseCost, 1), 0.2));
    const dmgSafe = Math.round(intMod * effMult * Math.pow(safeCost / Math.max(baseCost, 1), 0.2));
    const weight = sc.spellTierWeights?.[tier] ?? sc.celerity.BASELINE_WEIGHT;
    const w = (sc.castingSpeedWeights ?? {})[tier] ?? { wis: 0.6, int: 0.4 };
    const speed = Math.max(1, Math.round(w.wis * wisMod + w.int * intMod));
    const SCALE = sc.celerity.SCALE ?? 1000;
    let baseWait = Math.max(1, Math.round((weight * altMult * manualMult * SCALE) / speed));
    const wandActive = opts.wand && weight <= WAND_WEIGHT_GATE;
    if (wandActive) baseWait = Math.max(1, Math.round(baseWait * WAND_REDUCTION));
    const channelFactor = sc.celerity.CHANNEL_FACTOR ?? 1000;
    const chanWaitBase = wisMod > 0 ? Math.round(baseCost * channelFactor / wisMod) : 0;
    const chanWaitSafe = wisMod > 0 ? Math.round(safeCost * channelFactor / wisMod) : 0;
    return {
      pillar: 'spell', weight, speed, statBlend: intMod, effMult,
      baseCost, safeInvest, safeCost, dmgBase, dmgSafe,
      wandActive,
      waitBase: Math.max(baseWait, chanWaitBase),
      waitSafe: Math.max(baseWait, chanWaitSafe),
    };
  };

  // EXPERIMENTAL: weight-based damage multiplier. Heavier weapons hit
  // harder per cast. Exponent 1.0 = linear → per-round damage neutral
  // across weights (since wait also scales linearly with weight).
  const WEIGHT_DMG_REF = 100;     // baseline weight (~mace / one-hander)
  const WEIGHT_DMG_EXPONENT = 1.0; // 0.5 = sub-linear (daggers favored), 1.0 = parity, 1.5 = heavy favored

  const weaponMath = (skill, actor) => {
    const r = skill.system.roll;
    const A = actor.system.abilities;
    const weapon = skill._resolveWeaponForSkill?.();
    const weight = weapon ? ItemCls.resolveWeaponWeight(weapon) : 0;
    if (weight <= 0) return { pillar: 'weapon', error: 'no wielded weapon weight (would fall to legacy)' };
    const isRanged = r.type === 'phys_ranged';
    const cfg = isRanged ? sc.rangedBlend : sc.meleeBlend;
    const norm = Math.max(0, Math.min(1, (weight - cfg.weightOffset) / cfg.weightSpan));
    let statBlend, speed;
    if (isRanged) {
      const perW = cfg.perFloor + cfg.slope * norm;
      statBlend = Math.round((A.dexterity?.mod ?? 0) * (1 - perW) + (A.perception?.mod ?? 0) * perW);
      // PROPOSED: ranged speed mirrors the damage blend (heavy ranged Per
      // investment grants speed too). Currently the live game uses
      // speed = Dex.mod always — see celerity.mjs:46.
      speed = Math.round((A.dexterity?.mod ?? 0) * (1 - perW) + (A.perception?.mod ?? 0) * perW);
    } else {
      const strW = cfg.strFloor + cfg.slope * norm;
      statBlend = Math.round((A.strength?.mod ?? 0) * strW + (A.dexterity?.mod ?? 0) * (1 - strW));
      speed = (r.type === 'str_weapon') ? (A.strength?.mod ?? 0) : (A.dexterity?.mod ?? 0);
    }
    const baseCost = Math.max(1, Math.round((weight / sc.invest.staminaBaseDivisor) * (statBlend / sc.invest.staminaNormalizer)));
    const safeInvest = Math.max(0, Math.round((A.toughness?.mod ?? 0) * sc.invest.toughCapFactor));
    const safeCost = baseCost + safeInvest;
    const mods = skill._resolveRarityMods?.() ?? {};
    const effMult = mods.effectiveMult ?? 0.6;
    const altMult = mods.effectiveWeightMultiplier ?? 1;
    const manualMult = r.actionWeightMultiplier ?? 1;
    const wpnWeightMult = Math.pow(weight / WEIGHT_DMG_REF, WEIGHT_DMG_EXPONENT);
    const dmgBase = Math.round(statBlend * effMult * wpnWeightMult * Math.pow(baseCost / Math.max(baseCost, 1), 0.2));
    const dmgSafe = Math.round(statBlend * effMult * wpnWeightMult * Math.pow(safeCost / Math.max(baseCost, 1), 0.2));
    const SCALE = sc.celerity.SCALE ?? 1000;
    const wait = Math.max(1, Math.round((weight * altMult * manualMult * SCALE) / Math.max(speed, 1)));
    return {
      pillar: 'weapon', weight, speed, statBlend, effMult, wpnWeightMult: Math.round(wpnWeightMult * 100) / 100,
      baseCost, safeInvest, safeCost, dmgBase, dmgSafe,
      waitBase: wait, waitSafe: wait,
    };
  };

  const actorRoundLength = (actor) => {
    const ROUND_K = sc.celerity.ROUND_K ?? 1000000;
    const A = actor.system.abilities ?? {};
    const refMods = [A.strength?.mod, A.dexterity?.mod, A.intelligence?.mod, A.wisdom?.mod, A.perception?.mod].filter(Boolean);
    const refMod = refMods.length ? Math.max(...refMods) : 1;
    return Math.max(1, Math.round(ROUND_K / refMod));
  };

  // Hypothetical wand-equipped variants for casters — append a second row
  // with `+wand` suffix showing the −23% wait reduction effect.
  const WAND_USERS = new Set(['Willy', 'John']);

  const buildRows = () => {
    const rows = [];
    for (const [name, skName] of Object.entries(PICKS)) {
      rows.push({ name, skName, wand: false });
      if (WAND_USERS.has(name)) rows.push({ name, skName, wand: true });
    }
    return rows;
  };

  // ── Synthetic PC: pure-damage greatswordsman ──
  // Same total base value budget as Phil (2169) but stats reallocated for
  // max weapon damage potency. E rank, common rarity weapon for fair compare.
  // Each spec totals 2169 base value (matching Phil's level budget).
  // Stat distribution targets that weapon's optimal blend per
  // sc.meleeBlend / sc.rangedBlend.
  const SYNTHETIC_PCS = [
    // ── MELEE: light → heavy (60 → 250 weight) ──
    {
      name: 'Dagger Spec', raceRank: 'E', weaponWeight: 60,
      rollType: 'dex_weapon', resource: 'stamina', rarity: 'common', skillName: 'Dagger Stab',
      // blend at w60: 0.378×Str + 0.622×Dex; speed = Dex.mod
      values: { vitality: 200, endurance: 300, strength: 400, dexterity: 700,
                toughness: 350, intelligence: 50, willpower: 19, wisdom: 50, perception: 100 },
    },
    {
      name: 'Longsword Spec', raceRank: 'E', weaponWeight: 100,
      rollType: 'dex_weapon', resource: 'stamina', rarity: 'common', skillName: 'Longsword Cut',
      // blend at w100: 0.533×Str + 0.467×Dex; speed = Dex.mod
      values: { vitality: 200, endurance: 300, strength: 550, dexterity: 550,
                toughness: 350, intelligence: 50, willpower: 19, wisdom: 50, perception: 100 },
    },
    {
      name: 'Greatsword Spec', raceRank: 'E', weaponWeight: 200,
      rollType: 'str_weapon', resource: 'stamina', rarity: 'common', skillName: 'Greatsword Cleave',
      // blend at w200: 0.922×Str + 0.078×Dex; speed = Str.mod
      values: { vitality: 200, endurance: 300, strength: 850, dexterity: 200,
                toughness: 400, intelligence: 50, willpower: 19, wisdom: 50, perception: 100 },
    },
    {
      name: 'Maul Spec', raceRank: 'E', weaponWeight: 250,
      rollType: 'str_weapon', resource: 'stamina', rarity: 'common', skillName: 'Maul Smash',
      // blend at w250: pure Str (norm caps at 1.0); speed = Str.mod
      values: { vitality: 200, endurance: 300, strength: 950, dexterity: 100,
                toughness: 400, intelligence: 50, willpower: 19, wisdom: 50, perception: 100 },
    },
    // ── RANGED: light → heavy (100 → 250 weight) ──
    {
      name: 'Shortbow Spec', raceRank: 'E', weaponWeight: 100,
      rollType: 'phys_ranged', resource: 'stamina', rarity: 'common', skillName: 'Shortbow Shot',
      // blend at w100: 0.812×Dex + 0.188×Per; speed = Dex.mod
      values: { vitality: 250, endurance: 300, strength: 50, dexterity: 750,
                toughness: 350, intelligence: 50, willpower: 19, wisdom: 50, perception: 350 },
    },
    {
      name: 'Longbow Spec', raceRank: 'E', weaponWeight: 180,
      rollType: 'phys_ranged', resource: 'stamina', rarity: 'common', skillName: 'Longbow Loose',
      // blend at w180: 0.592×Dex + 0.408×Per; speed = Dex.mod
      values: { vitality: 250, endurance: 300, strength: 50, dexterity: 600,
                toughness: 400, intelligence: 50, willpower: 19, wisdom: 50, perception: 500 },
    },
    {
      name: 'Crossbow Spec', raceRank: 'E', weaponWeight: 250,
      rollType: 'phys_ranged', resource: 'stamina', rarity: 'common', skillName: 'Crossbow Bolt',
      // blend at w250: 0.40×Dex + 0.60×Per; speed = Dex.mod (still!)
      values: { vitality: 200, endurance: 300, strength: 50, dexterity: 500,
                toughness: 350, intelligence: 50, willpower: 19, wisdom: 50, perception: 650 },
    },
  ];

  // Compute mod from raw value per design-stat-curves: mod = round((v/1085)^0.8 × 1085 × 1.25^gradeIdx).
  const valueToMod = (v, raceRank) => {
    const idx = sc.statCurve?.gradeIndex?.[raceRank] ?? 0;
    return Math.round(Math.pow(v / 1085, 0.8) * 1085 * Math.pow(1.25, idx));
  };

  const synthWeaponMath = (spec) => {
    const A = Object.fromEntries(Object.entries(spec.values).map(([k, v]) => [k, { mod: valueToMod(v, spec.raceRank) }]));
    const isRanged = spec.rollType === 'phys_ranged';
    const cfg = isRanged ? sc.rangedBlend : sc.meleeBlend;
    const norm = Math.max(0, Math.min(1, (spec.weaponWeight - cfg.weightOffset) / cfg.weightSpan));
    let statBlend, speed;
    if (isRanged) {
      const perW = cfg.perFloor + cfg.slope * norm;
      statBlend = Math.round(A.dexterity.mod * (1 - perW) + A.perception.mod * perW);
      // Same-blend speed (option 1 — proposed change vs live celerity.mjs).
      speed = Math.round(A.dexterity.mod * (1 - perW) + A.perception.mod * perW);
    } else {
      const strW = cfg.strFloor + cfg.slope * norm;
      statBlend = Math.round(A.strength.mod * strW + A.dexterity.mod * (1 - strW));
      speed = (spec.rollType === 'str_weapon') ? A.strength.mod : A.dexterity.mod;
    }
    const baseCost = Math.max(1, Math.round((spec.weaponWeight / sc.invest.staminaBaseDivisor) * (statBlend / sc.invest.staminaNormalizer)));
    const safeInvest = Math.max(0, Math.round(A.toughness.mod * sc.invest.toughCapFactor));
    const safeCost = baseCost + safeInvest;
    const rarityDef = sc.skillRarities?.[spec.rarity];
    const effMult = rarityDef?.mult ?? 0.6;
    const wpnWeightMult = Math.pow(spec.weaponWeight / WEIGHT_DMG_REF, WEIGHT_DMG_EXPONENT);
    const dmgBase = Math.round(statBlend * effMult * wpnWeightMult * Math.pow(baseCost / Math.max(baseCost, 1), 0.2));
    const dmgSafe = Math.round(statBlend * effMult * wpnWeightMult * Math.pow(safeCost / Math.max(baseCost, 1), 0.2));
    const SCALE = sc.celerity.SCALE ?? 1000;
    const wait = Math.max(1, Math.round((spec.weaponWeight * SCALE) / Math.max(speed, 1)));
    return {
      A, statBlend, speed, effMult, wpnWeightMult: Math.round(wpnWeightMult * 100) / 100,
      baseCost, safeInvest, safeCost, dmgBase, dmgSafe,
      waitBase: wait, waitSafe: wait, weight: spec.weaponWeight,
    };
  };

  const out = [];
  for (const { name, skName, wand } of buildRows()) {
    const a = game.actors.find(x => x.name === name);
    if (!a) { out.push({ pc: name, error: 'actor missing' }); continue; }
    const s = a.items.find(i => i.type === 'skill' && i.name === skName);
    if (!s) { out.push({ pc: name, error: 'skill missing' }); continue; }
    const pillar = pillarFor(s, a);
    let m;
    if (pillar === 'spell')       m = spellMath(s, a, { wand });
    else if (pillar === 'weapon') m = weaponMath(s, a);
    else                          m = { pillar, error: 'legacy not modeled' };
    if (m.error) { out.push({ pc: name, skill: skName, ...m }); continue; }

    const roundLen = actorRoundLength(a);
    const resKey   = s.system.roll.resource;
    const resMax   = a.system[resKey]?.max ?? 0;
    const isStam   = resKey === 'stamina';
    const regenPct = isStam ? 5 : 0;
    const regenAmt = Math.floor(resMax * (regenPct / 100));

    const ROUNDS = 3;
    // Continuous-time sim: rounds are bookkeeping markers for regen + DoT
    // ticks, not action gates. A cast can start in round 1 and complete in
    // round 2 without penalty. This matches celerity's actual semantics.
    const sim = (cost, dmg, wait) => {
      const totalTime = ROUNDS * roundLen;
      const castsByCelerity = Math.floor(totalTime / wait);
      let pool = resMax;
      let tick = 0;
      let nextRegenAt = roundLen;
      let oorAt = null;
      let totDmg = 0, totCasts = 0;
      const rounds = Array.from({ length: ROUNDS }, (_, i) => ({ r: i + 1, casts: 0, dmg: 0, poolEnd: null }));

      const applyRegensUpTo = (atTick) => {
        while (nextRegenAt <= atTick && nextRegenAt <= totalTime) {
          pool = Math.min(resMax, pool + regenAmt);
          const rIdx = Math.floor(nextRegenAt / roundLen) - 1;
          if (rIdx >= 0 && rIdx < ROUNDS) rounds[rIdx].poolEnd = Math.round(pool * 100) / 100;
          nextRegenAt += roundLen;
        }
      };

      while (tick + wait <= totalTime) {
        applyRegensUpTo(tick);
        if (pool < cost) {
          if (oorAt === null) oorAt = Math.floor(tick / roundLen) + 1;
          if (regenAmt > 0 && nextRegenAt <= totalTime) { tick = nextRegenAt; continue; }
          break;
        }
        tick += wait;
        pool -= cost;
        applyRegensUpTo(tick);
        totCasts++; totDmg += dmg;
        const rIdx = Math.min(ROUNDS - 1, Math.floor((tick - 1) / roundLen));
        rounds[rIdx].casts++;
        rounds[rIdx].dmg += dmg;
      }
      applyRegensUpTo(totalTime);
      for (const rt of rounds) if (rt.poolEnd === null) rt.poolEnd = Math.round(pool * 100) / 100;

      return { castsByCelerity, oorAt, totalDmg: totDmg, totalCasts: totCasts, rounds };
    };

    out.push({
      pc: name + (wand ? ' (+wand)' : ''),
      skill: skName, rarity: s.system.rarity,
      pillar: m.pillar, type: s.system.roll.type,
      resource: resKey, poolMax: resMax, regenPerRound: regenAmt,
      effMult: Math.round(m.effMult * 100) / 100,
      statBlend: m.statBlend, weight: m.weight, speed: m.speed,
      wandActive: !!m.wandActive, roundLen,
      base: { cost: m.baseCost, dmg: m.dmgBase, wait: m.waitBase, ...sim(m.baseCost, m.dmgBase, m.waitBase) },
      safe: { cost: m.safeCost, invest: m.safeInvest, dmg: m.dmgSafe, wait: m.waitSafe, ...sim(m.safeCost, m.dmgSafe, m.waitSafe) },
    });
  }

  // ── Run synthetic PCs through the same continuous-time sim ──
  for (const spec of SYNTHETIC_PCS) {
    const m = synthWeaponMath(spec);
    const ROUND_K = sc.celerity.ROUND_K ?? 1000000;
    const refMod = Math.max(...Object.values(m.A).map(a => a.mod));
    const roundLen = Math.max(1, Math.round(ROUND_K / refMod));
    const resMax = (spec.resource === 'stamina') ? m.A.endurance.mod : m.A.willpower.mod;
    const regenPct = (spec.resource === 'stamina') ? 5 : 0;
    const regenAmt = Math.floor(resMax * (regenPct / 100));
    const ROUNDS = 3;
    const sim = (cost, dmg, wait) => {
      const totalTime = ROUNDS * roundLen;
      const castsByCelerity = Math.floor(totalTime / wait);
      let pool = resMax, tick = 0, nextRegenAt = roundLen, oorAt = null, totDmg = 0, totCasts = 0;
      const rounds = Array.from({ length: ROUNDS }, (_, i) => ({ r: i + 1, casts: 0, dmg: 0, poolEnd: null }));
      const applyRegensUpTo = (atTick) => {
        while (nextRegenAt <= atTick && nextRegenAt <= totalTime) {
          pool = Math.min(resMax, pool + regenAmt);
          const rIdx = Math.floor(nextRegenAt / roundLen) - 1;
          if (rIdx >= 0 && rIdx < ROUNDS) rounds[rIdx].poolEnd = Math.round(pool * 100) / 100;
          nextRegenAt += roundLen;
        }
      };
      while (tick + wait <= totalTime) {
        applyRegensUpTo(tick);
        if (pool < cost) {
          if (oorAt === null) oorAt = Math.floor(tick / roundLen) + 1;
          if (regenAmt > 0 && nextRegenAt <= totalTime) { tick = nextRegenAt; continue; }
          break;
        }
        tick += wait; pool -= cost;
        applyRegensUpTo(tick);
        totCasts++; totDmg += dmg;
        const rIdx = Math.min(ROUNDS - 1, Math.floor((tick - 1) / roundLen));
        rounds[rIdx].casts++; rounds[rIdx].dmg += dmg;
      }
      applyRegensUpTo(totalTime);
      for (const rt of rounds) if (rt.poolEnd === null) rt.poolEnd = Math.round(pool * 100) / 100;
      return { castsByCelerity, oorAt, totalDmg: totDmg, totalCasts: totCasts, rounds };
    };
    out.push({
      pc: spec.name, skill: spec.skillName, rarity: spec.rarity, pillar: 'weapon (synthetic)',
      type: spec.rollType, resource: spec.resource, poolMax: resMax, regenPerRound: regenAmt,
      effMult: m.effMult, statBlend: m.statBlend, weight: m.weight, speed: m.speed,
      modsForReference: Object.fromEntries(Object.entries(m.A).map(([k, v]) => [k, v.mod])),
      roundLen,
      base: { cost: m.baseCost, dmg: m.dmgBase, wait: m.waitBase, ...sim(m.baseCost, m.dmgBase, m.waitBase) },
      safe: { cost: m.safeCost, invest: m.safeInvest, dmg: m.dmgSafe, wait: m.waitSafe, ...sim(m.safeCost, m.dmgSafe, m.waitSafe) },
    });
  }
  return { results: out };
})()
