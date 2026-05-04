async () => {
  const sc = CONFIG.ASPECTSOFPOWER;

  const PICKS = {
    Willy:   "Defiance Above, Obedience Below",
    Gabriel: "Skysteel Dagger",
    John:    "Blazing Greatsword",
  };

  function gradeIndex(rank) { return sc.statCurve.gradeIndex[rank] ?? 0; }

  // Parse dice notation: "3d6" -> avg 10.5, "1d20" -> 10.5, etc.
  // Returns 0 for empty/null/non-string.
  function avgDice(diceStr) {
    if (typeof diceStr !== "string" || !diceStr) return 0;
    const m = diceStr.match(/^(\d+)\s*d\s*(\d+)$/i);
    if (!m) {
      const n = Number(diceStr);
      return Number.isFinite(n) ? n : 0;
    }
    const n = parseInt(m[1], 10);
    const f = parseInt(m[2], 10);
    return n * (f + 1) / 2;
  }

  function buildPCContext(actor) {
    const ab = actor.system.abilities;
    return {
      actor,
      name: actor.name,
      grade: actor.system.attributes.race?.rank ?? "E",
      gradeIdx: gradeIndex(actor.system.attributes.race?.rank ?? "E"),
      hp: actor.system.health.value, hpMax: actor.system.health.max,
      mana: actor.system.mana.value, manaMax: actor.system.mana.max,
      stamina: actor.system.stamina.value, stamMax: actor.system.stamina.max,
      armor: actor.system.defense.armor.value,
      veil: actor.system.defense.veil.value,
      dr: actor.system.defense.dr.value,
      pools: {
        melee: actor.system.defense.melee.pool,
        ranged: actor.system.defense.ranged.pool,
        mind: actor.system.defense.mind.pool,
        soul: actor.system.defense.soul.pool,
      },
      mods: Object.fromEntries(Object.entries(ab).map(([k, v]) => [k, v.mod])),
    };
  }

  function findSkill(actor, name) {
    return actor.items.find(i => i.type === "skill" && i.name === name);
  }

  function computeAttack(ctx, skill) {
    if (!skill) return null;
    const s = skill.system;
    const r = s.roll || {};
    const tier = r.tier || "";
    const grade = ctx.grade;
    const tierMul = sc.spellTierMultipliers?.[tier];
    const dbVal = r.diceBonus ?? 1;
    const eff = (s.rarity && s.rarity !== "common" && sc.skillRarities?.[s.rarity]?.mult) ?? null;
    const multiplier = (dbVal && dbVal !== 1) ? dbVal : (eff ?? tierMul ?? 0.6);

    let damage = 0, cost = 0, resourceKey = "mana", defenseKey = "mind", damageType = "magical";

    if (tier && r.resource === "mana" && (r.type === "magic" || r.type === "magic_projectile" || r.type === "magic_melee")) {
      const tierFactor  = sc.spellTierFactors[tier] ?? 1;
      const gradeFactor = sc.spellGradeFactors[grade] ?? 1;
      const baseMana = Math.round(tierFactor * gradeFactor);
      cost = baseMana;
      const intMod = ctx.mods.intelligence;
      damage = Math.round(intMod * multiplier);
      resourceKey = "mana";
      defenseKey = (r.type === "magic_melee") ? "melee" : (r.type === "magic_projectile") ? "ranged" : "mind";
      damageType = "magical";
    } else if (r.type === "dex_weapon" || r.type === "str_weapon") {
      const A = ctx.mods;
      const blend = (r.type === "dex_weapon")
        ? Math.round(A.dexterity * 0.9 + A.strength * 0.3)
        : Math.round(A.strength * 0.9 + A.dexterity * 0.3);
      const dice = avgDice(r.dice) || 10;
      // Per item.mjs static formula (live):
      //   dex_weapon dmg = (dic/50 * (dex*0.9 + str*0.3) + str + dex*0.3) * db
      //   str_weapon dmg = (dic/50 * str + str + str*0.3) * db
      damage = Math.round((dice / 50 * blend + A.strength + A.dexterity * 0.3) * dbVal);
      cost = r.cost ?? 2;
      resourceKey = r.resource || "stamina";
      defenseKey = "melee";
      damageType = "physical";
    } else if (r.type === "phys_ranged") {
      const A = ctx.mods;
      const blend = Math.round(A.perception * 0.9 + A.dexterity * 0.3);
      const dice = avgDice(r.dice) || 10;
      damage = Math.round((dice / 50 * blend + A.perception * 0.9 + A.dexterity * 0.3) * dbVal);
      cost = r.cost ?? 2;
      resourceKey = r.resource || "stamina";
      defenseKey = "ranged";
      damageType = "physical";
    } else {
      const A = ctx.mods;
      const ab = A[r.abilities] ?? A.intelligence ?? 0;
      const dice = avgDice(r.dice) || 0;
      damage = Math.round((dice / 100 * ab + ab) * dbVal);
      cost = r.cost ?? 5;
      resourceKey = r.resource || "mana";
      defenseKey = "mind";
      damageType = "magical";
    }

    return { damage, cost, resourceKey, defenseKey, damageType, multiplier, name: skill.name, tier, rollType: r.type };
  }

  const pcs = ["Willy", "Gabriel", "John"].map(n => buildPCContext(game.actors.find(a => a.name === n)));
  const avgHP = Math.round(pcs.reduce((s, p) => s + p.hpMax, 0) / pcs.length);
  const avgArmor = Math.round(pcs.reduce((s, p) => s + p.armor, 0) / pcs.length);
  const avgVeil = Math.round(pcs.reduce((s, p) => s + p.veil, 0) / pcs.length);
  const avgDR = Math.round(pcs.reduce((s, p) => s + p.dr, 0) / pcs.length);
  const avgPools = {
    melee:  Math.round(pcs.reduce((s, p) => s + p.pools.melee,  0) / pcs.length),
    ranged: Math.round(pcs.reduce((s, p) => s + p.pools.ranged, 0) / pcs.length),
    mind:   Math.round(pcs.reduce((s, p) => s + p.pools.mind,   0) / pcs.length),
    soul:   Math.round(pcs.reduce((s, p) => s + p.pools.soul,   0) / pcs.length),
  };
  const avgIntMod = Math.round(pcs.reduce((s, p) => s + p.mods.intelligence, 0) / pcs.length);
  const avgStrMod = Math.round(pcs.reduce((s, p) => s + p.mods.strength, 0) / pcs.length);
  const avgDexMod = Math.round(pcs.reduce((s, p) => s + p.mods.dexterity, 0) / pcs.length);

  const enemies = [
    { name: "Caster",    hp: avgHP, hpMax: avgHP, armor: avgArmor, veil: avgVeil, dr: avgDR, pools: {...avgPools},
      attack: { damage: Math.round(avgIntMod * 0.6), cost: 50, resourceKey: "mana",    defenseKey: "mind",   damageType: "magical"  } },
    { name: "Warrior",   hp: avgHP, hpMax: avgHP, armor: avgArmor, veil: avgVeil, dr: avgDR, pools: {...avgPools},
      attack: { damage: Math.round(avgStrMod * 0.6), cost: 5,  resourceKey: "stamina", defenseKey: "melee",  damageType: "physical" } },
    { name: "Skirmisher",hp: avgHP, hpMax: avgHP, armor: avgArmor, veil: avgVeil, dr: avgDR, pools: {...avgPools},
      attack: { damage: Math.round(avgDexMod * 0.6), cost: 5,  resourceKey: "stamina", defenseKey: "ranged", damageType: "physical" } },
  ];

  const pcAttacks = pcs.map(p => ({ pc: p, atk: computeAttack(p, findSkill(p.actor, PICKS[p.name])) }));

  function applyHit(target, atk) {
    let dmg = atk.damage;
    const pool = target.pools[atk.defenseKey] ?? 0;
    if (pool >= dmg) { target.pools[atk.defenseKey] = pool - dmg; return { dealt: 0, dodged: dmg }; }
    let dodged = pool;
    target.pools[atk.defenseKey] = 0;
    dmg -= dodged;
    const mitigation = (atk.damageType === "physical") ? target.armor : target.veil;
    dmg = Math.max(0, dmg - mitigation);
    dmg = Math.max(0, dmg - target.dr);
    target.hp = Math.max(0, target.hp - dmg);
    return { dealt: dmg, dodged };
  }

  const roundsData = [];
  const stats = {};
  for (const p of pcs)     stats[p.name] = { dealt: 0, taken: 0, casts: 0 };
  for (const e of enemies) stats[e.name] = { dealt: 0, taken: 0, casts: 0 };

  let pcAlive = pcs.length;
  let enemyAlive = enemies.length;
  for (let round = 1; round <= 20 && pcAlive > 0 && enemyAlive > 0; round++) {
    const log = { round, events: [] };
    for (let i = 0; i < pcs.length; i++) {
      const pc = pcs[i]; const enemy = enemies[i];
      if (pc.hp <= 0 || enemy.hp <= 0) continue;
      const atk = pcAttacks[i].atk; if (!atk) continue;
      const resourceVal = pc[atk.resourceKey] ?? 0;
      if (resourceVal < atk.cost) { log.events.push(`${pc.name} OOR (${atk.resourceKey}: ${resourceVal})`); continue; }
      pc[atk.resourceKey] -= atk.cost;
      const result = applyHit(enemy, atk);
      stats[pc.name].dealt   += result.dealt;
      stats[pc.name].casts   += 1;
      stats[enemy.name].taken+= result.dealt;
      log.events.push(`${pc.name} -> ${enemy.name}: ${result.dealt} dmg (${result.dodged} dodged) [HP ${enemy.hp}]`);
      if (enemy.hp === 0) enemyAlive--;
    }
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i]; const pc = pcs[i];
      if (enemy.hp <= 0 || pc.hp <= 0) continue;
      const atk = enemy.attack;
      const result = applyHit(pc, atk);
      stats[enemy.name].dealt += result.dealt;
      stats[enemy.name].casts += 1;
      stats[pc.name].taken    += result.dealt;
      log.events.push(`${enemy.name} -> ${pc.name}: ${result.dealt} dmg (${result.dodged} dodged) [HP ${pc.hp}]`);
      if (pc.hp === 0) pcAlive--;
    }
    roundsData.push(log);
  }

  const ROUND_SECONDS = 6;
  const totalRounds = roundsData.length;

  return {
    setup: { avgHP, avgArmor, avgVeil, avgDR, avgPools, avgIntMod, avgStrMod, avgDexMod },
    pcAttacks: pcAttacks.map(({ pc, atk }) => ({ pc: pc.name, ...atk })),
    enemies: enemies.map(e => ({ name: e.name, hp: e.hp, atk: e.attack })),
    rounds: roundsData,
    stats,
    totalRounds,
    pcAlive,
    enemyAlive,
    dps: Object.fromEntries(Object.entries(stats).map(([n, s]) => [n, totalRounds ? Math.round(s.dealt / (totalRounds * ROUND_SECONDS)) : 0])),
  };
}
