async () => {
  const sc = CONFIG.ASPECTSOFPOWER;

  const PICKS = {
    Willy:   "Defiance Above, Obedience Below",
    Gabriel: "Skysteel Dagger",
    John:    "Blazing Greatsword",
  };

  function avgDice(diceStr) {
    if (typeof diceStr !== "string" || !diceStr) return 0;
    const m = diceStr.match(/^(\d+)\s*d\s*(\d+)$/i);
    if (!m) {
      const n = Number(diceStr);
      return Number.isFinite(n) ? n : 0;
    }
    return parseInt(m[1], 10) * (parseInt(m[2], 10) + 1) / 2;
  }

  function ctx(actor) {
    const ab = actor.system.abilities;
    return {
      actor, name: actor.name,
      grade: actor.system.attributes.race?.rank ?? "E",
      hp: actor.system.health.value, hpMax: actor.system.health.max,
      mana: actor.system.mana.value, manaMax: actor.system.mana.max,
      stamina: actor.system.stamina.value, stamMax: actor.system.stamina.max,
      armor: actor.system.defense.armor.value,
      veil: actor.system.defense.veil.value,
      dr: actor.system.defense.dr.value,
      poolMax: {
        melee: actor.system.defense.melee.value * 2,
        ranged: actor.system.defense.ranged.value * 2,
        mind: actor.system.defense.mind.value * 2,
        soul: actor.system.defense.soul.value * 2,
      },
      pools: {
        melee: actor.system.defense.melee.value * 2,
        ranged: actor.system.defense.ranged.value * 2,
        mind: actor.system.defense.mind.value * 2,
        soul: actor.system.defense.soul.value * 2,
      },
      mods: Object.fromEntries(Object.entries(ab).map(([k, v]) => [k, v.mod])),
    };
  }

  function findSkill(actor, name) {
    return actor.items.find(i => i.type === "skill" && i.name === name);
  }

  // Compute attack profile: damage AND hit roll (avg).
  function attackProfile(c, skill) {
    if (!skill) return null;
    const s = skill.system;
    const r = s.roll || {};
    const tier = r.tier || "";
    const grade = c.grade;
    const tierMul = sc.spellTierMultipliers?.[tier];
    const dbVal = r.diceBonus ?? 1;
    const eff = (s.rarity && s.rarity !== "common" && sc.skillRarities?.[s.rarity]?.mult) ?? null;
    const multiplier = (dbVal && dbVal !== 1) ? dbVal : (eff ?? tierMul ?? 0.6);
    const A = c.mods;
    let damage = 0, hitAvg = 0, cost = 0;
    let resourceKey = "mana", defenseKey = "mind", damageType = "magical";

    if (tier && r.resource === "mana" && (r.type === "magic" || r.type === "magic_projectile" || r.type === "magic_melee")) {
      const tierFactor  = sc.spellTierFactors[tier] ?? 1;
      const gradeFactor = sc.spellGradeFactors[grade] ?? 1;
      cost = Math.round(tierFactor * gradeFactor);
      damage = Math.round(A.intelligence * multiplier);
      let m;
      if (r.type === "magic")            m = A.intelligence;
      else if (r.type === "magic_melee") m = A.intelligence * 0.9 + A.strength * 0.3;
      else                                m = A.intelligence * 0.9 + A.perception * 0.3;
      hitAvg = Math.round(m * 1.105);
      resourceKey = "mana";
      defenseKey = (r.type === "magic_melee") ? "melee" : (r.type === "magic_projectile") ? "ranged" : "mind";
      damageType = "magical";
    } else if (r.type === "dex_weapon" || r.type === "str_weapon") {
      const blend = (r.type === "dex_weapon")
        ? Math.round(A.dexterity * 0.9 + A.strength * 0.3)
        : Math.round(A.strength * 0.9 + A.dexterity * 0.3);
      const dice = avgDice(r.dice) || 10;
      damage = Math.round((dice / 50 * blend + A.strength + A.dexterity * 0.3) * dbVal);
      hitAvg = Math.round(blend * 1.105);
      cost = r.cost ?? 2;
      resourceKey = r.resource || "stamina";
      defenseKey = "melee"; damageType = "physical";
    } else if (r.type === "phys_ranged") {
      const blend = Math.round(A.perception * 0.9 + A.dexterity * 0.3);
      const dice = avgDice(r.dice) || 10;
      damage = Math.round((dice / 50 * blend + A.perception * 0.9 + A.dexterity * 0.3) * dbVal);
      hitAvg = Math.round(blend * 1.105);
      cost = r.cost ?? 2;
      resourceKey = r.resource || "stamina";
      defenseKey = "ranged"; damageType = "physical";
    } else {
      const ab = A[r.abilities] ?? A.intelligence ?? 0;
      const dice = avgDice(r.dice) || 0;
      damage = Math.round((dice / 100 * ab + ab) * dbVal);
      hitAvg = Math.round(ab * 1.105);
      cost = r.cost ?? 5;
      resourceKey = r.resource || "mana";
      defenseKey = "mind"; damageType = "magical";
    }
    return { damage, hitAvg, cost, resourceKey, defenseKey, damageType, multiplier, name: skill.name, tier, rollType: r.type };
  }

  function applyAttack(target, atk) {
    const pool = target.pools[atk.defenseKey] ?? 0;
    let mult = 1;
    let dodgedAmt = 0;
    if (pool >= atk.hitAvg) {
      target.pools[atk.defenseKey] = pool - atk.hitAvg;
      return { dealt: 0, mult: 0, dodged: atk.hitAvg, poolBefore: pool, poolAfter: target.pools[atk.defenseKey] };
    }
    if (pool > 0) {
      mult = 1 - (pool / atk.hitAvg);
      dodgedAmt = pool;
      target.pools[atk.defenseKey] = 0;
    }
    let dmg = Math.round(atk.damage * mult);
    const mitigation = (atk.damageType === "physical") ? target.armor : target.veil;
    dmg = Math.max(0, dmg - mitigation - target.dr);
    target.hp = Math.max(0, target.hp - dmg);
    return { dealt: dmg, mult, dodged: dodgedAmt, poolBefore: pool, poolAfter: target.pools[atk.defenseKey] };
  }

  function resetPools(c) {
    for (const k of Object.keys(c.poolMax)) c.pools[k] = c.poolMax[k];
  }

  function runScenario(scenarioName, attackers, defenders, attackerToDefender) {
    // Reset pools and HP
    for (const a of [...attackers, ...defenders]) {
      resetPools(a);
      a.hp = a.hpMax;
      if (a.manaMax) a.mana = a.manaMax;
      if (a.stamMax) a.stamina = a.stamMax;
    }
    const stats = {};
    for (const a of [...attackers, ...defenders]) stats[a.name] = { dealt: 0, taken: 0, casts: 0 };
    const rounds = [];
    let aliveA = attackers.length, aliveD = defenders.length;

    for (let round = 1; round <= 20 && aliveA > 0 && aliveD > 0; round++) {
      const log = { round, events: [] };
      // Pools reset for everyone at start of round (sim of onStartTurn for each)
      for (const a of [...attackers, ...defenders]) resetPools(a);

      // Attackers act
      for (let i = 0; i < attackers.length; i++) {
        const A = attackers[i]; if (A.hp <= 0) continue;
        const targets = attackerToDefender[i];
        for (const ti of targets) {
          const D = defenders[ti]; if (!D || D.hp <= 0) continue;
          const atk = A.attack ?? A.atk;
          if (!atk) continue;
          if (A[atk.resourceKey] !== undefined && A[atk.resourceKey] < atk.cost) {
            log.events.push(`${A.name} OOR (${atk.resourceKey})`);
            continue;
          }
          if (A[atk.resourceKey] !== undefined) A[atk.resourceKey] -= atk.cost;
          const r = applyAttack(D, atk);
          stats[A.name].dealt += r.dealt;
          stats[A.name].casts += 1;
          stats[D.name].taken += r.dealt;
          log.events.push(`${A.name}->${D.name}: hit=${atk.hitAvg} dmg=${atk.damage} dodged=${r.dodged} pool ${atk.defenseKey}:${r.poolBefore}->${r.poolAfter} mult=${r.mult.toFixed(2)} dealt=${r.dealt} HP=${D.hp}`);
          if (D.hp === 0) aliveD--;
        }
      }
      // Defenders counter-attack
      for (let i = 0; i < defenders.length; i++) {
        const D = defenders[i]; if (D.hp <= 0) continue;
        const target = attackers[i % attackers.length]; if (!target || target.hp <= 0) continue;
        const atk = D.attack ?? D.atk;
        if (D[atk.resourceKey] !== undefined && D[atk.resourceKey] < atk.cost) {
          log.events.push(`${D.name} OOR`);
          continue;
        }
        if (D[atk.resourceKey] !== undefined) D[atk.resourceKey] -= atk.cost;
        const r = applyAttack(target, atk);
        stats[D.name].dealt += r.dealt;
        stats[D.name].casts += 1;
        stats[target.name].taken += r.dealt;
        log.events.push(`${D.name}->${target.name}: hit=${atk.hitAvg} dmg=${atk.damage} dodged=${r.dodged} pool ${atk.defenseKey}:${r.poolBefore}->${r.poolAfter} mult=${r.mult.toFixed(2)} dealt=${r.dealt} HP=${target.hp}`);
        if (target.hp === 0) aliveA--;
      }
      rounds.push(log);
    }
    return { scenarioName, stats, rounds, aliveA, aliveD, totalRounds: rounds.length };
  }

  const pcs = ["Willy", "Gabriel", "John"].map(n => ctx(game.actors.find(a => a.name === n)));
  // Attach attack profiles
  for (const p of pcs) p.attack = attackProfile(p, findSkill(p.actor, PICKS[p.name]));

  const avgHP = Math.round(pcs.reduce((s, p) => s + p.hpMax, 0) / pcs.length);
  const avgArmor = Math.round(pcs.reduce((s, p) => s + p.armor, 0) / pcs.length);
  const avgVeil = Math.round(pcs.reduce((s, p) => s + p.veil, 0) / pcs.length);
  const avgDR = Math.round(pcs.reduce((s, p) => s + p.dr, 0) / pcs.length);
  const avgPoolMax = {
    melee:  Math.round(pcs.reduce((s, p) => s + p.poolMax.melee, 0) / pcs.length),
    ranged: Math.round(pcs.reduce((s, p) => s + p.poolMax.ranged, 0) / pcs.length),
    mind:   Math.round(pcs.reduce((s, p) => s + p.poolMax.mind, 0) / pcs.length),
    soul:   Math.round(pcs.reduce((s, p) => s + p.poolMax.soul, 0) / pcs.length),
  };
  const avgInt = Math.round(pcs.reduce((s, p) => s + p.mods.intelligence, 0) / pcs.length);
  const avgStr = Math.round(pcs.reduce((s, p) => s + p.mods.strength, 0) / pcs.length);
  const avgDex = Math.round(pcs.reduce((s, p) => s + p.mods.dexterity, 0) / pcs.length);
  const avgPer = Math.round(pcs.reduce((s, p) => s + p.mods.perception, 0) / pcs.length);

  function makeEnemy(name, kind) {
    const base = {
      name, hp: avgHP, hpMax: avgHP,
      armor: avgArmor, veil: avgVeil, dr: avgDR,
      poolMax: { ...avgPoolMax }, pools: { ...avgPoolMax },
    };
    if (kind === "caster") {
      const m = avgInt;
      base.attack = { damage: Math.round(avgInt * 0.6), hitAvg: Math.round(m * 1.105), cost: 50, resourceKey: "mana", defenseKey: "mind", damageType: "magical" };
    } else if (kind === "warrior") {
      const m = avgStr * 0.9 + avgDex * 0.3;
      base.attack = { damage: Math.round(avgStr * 0.6), hitAvg: Math.round(m * 1.105), cost: 5, resourceKey: "stamina", defenseKey: "melee", damageType: "physical" };
    } else {
      const m = avgPer * 0.9 + avgDex * 0.3;
      base.attack = { damage: Math.round(avgDex * 0.6), hitAvg: Math.round(m * 1.105), cost: 5, resourceKey: "stamina", defenseKey: "ranged", damageType: "physical" };
    }
    base.manaMax = 1000; base.stamMax = 500;
    base.mana = 1000; base.stamina = 500;
    return base;
  }

  const enemies1v1 = [makeEnemy("Caster", "caster"), makeEnemy("Warrior", "warrior"), makeEnemy("Skirmisher", "skirmisher")];

  // Scenario 1: 1v1 split (PC1->E1, PC2->E2, PC3->E3)
  const scenario1 = runScenario("1v1 Split", pcs, enemies1v1, [[0],[1],[2]]);

  // Scenario 2: party focus-fires single enemy each round, enemies focus single PC
  const enemiesFocus = [makeEnemy("Caster", "caster"), makeEnemy("Warrior", "warrior"), makeEnemy("Skirmisher", "skirmisher")];
  // All PCs target enemy[0] first, then [1], then [2]
  const scenario2 = runScenario("Focus Fire", pcs, enemiesFocus, [[0],[0],[0]]);

  return {
    setup: { avgHP, avgArmor, avgVeil, avgDR, avgPoolMax, avgInt, avgStr, avgDex, avgPer },
    pcAttacks: pcs.map(p => ({ pc: p.name, hp: p.hpMax, mana: p.manaMax, stamina: p.stamMax, ...p.attack })),
    enemies: enemies1v1.map(e => ({ name: e.name, hp: e.hpMax, ...e.attack })),
    scenario1,
    scenario2,
  };
}
