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
 *
 * ⚠ TIME IS DISCRETE. `declareAction` schedules a fire for `clockTick + wait`,
 * so nothing lands at tick 0 and the Nth swing lands at N × wait. This sim used
 * to divide HP by a continuous DPR, which was the fifth wrong answer of that
 * same session: it credits a slow attacker with damage they are never alive to
 * deal. See `killTicks` below. Every summary still carries the continuous
 * figure alongside the discrete one — a correction you cannot see is a
 * correction you cannot check.
 *
 * ⚠ THE PICKER IS GREEDY AND HAS NO SURVIVAL INSTINCT. Each attacker chooses
 * the skill with the lowest time-to-kill against each defender, with no regard
 * for whether they live that long. A caster will happily commit to a 5190-tick
 * nuke in a fight that ends at 2094. That is not corrected — it is REPORTED, as
 * `overcommits` and a "their best answer never lands" note on the duel. Read it
 * as "this build's best answer is unusable here", not as the sim's own pick.
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
    // Roster resolution, in order:
    //   1. window.__simActors  — an explicit array of names
    //   2. any actors prefixed '[SIM] ' — the purpose-built testbed, if present
    //   3. every player-owned character — works in any world with no setup
    // Deliberately NOT a hardcoded list of this world's actor names: the
    // harness is a durable tool, so it must not depend on one world's content
    // (migration commit policy — "would another world's GM ever run this?").
    // In both cases an actor must OWN AT LEAST ONE ATTACK SKILL to be included:
    // a combat sim populated with crafters and pets reports nothing but mutual
    // immunity. (The [SIM] testbed deliberately contains four crafters, which
    // is exactly how this was found.)
    actors: window.__simActors ?? (() => {
      const canFight = (a) => a.items.some(i => i.type === 'skill'
        && (i.system.tags ?? []).includes('attack'));
      const sim = game.actors.filter(a => a.name.startsWith('[SIM] ') && canFight(a));
      if (sim.length >= 2) return sim.map(a => a.name);
      return game.actors.filter(a => a.type === 'character'
        && Object.entries(a.ownership ?? {}).some(([k, v]) =>
             k !== 'default' && v === 3 && game.users.get(k) && !game.users.get(k).isGM)
        && (a.system.health?.max ?? 0) > 0
        && canFight(a)).map(a => a.name);
    })(),
    label: (n) => n.replace('[SIM] ', ''),
    // Crush is a debuff that ramps; model it at its steady-state stack count.
    crushStacks: AA.armorCrushMaxStacks ?? 3,
    // Scramble degrades a defender's dodge as they keep dodging. 0 = fresh.
    scrambleStacks: 0,
    // Band thresholds for the report, from the house target matrix
    // (mirror 6-8 rounds, cross-lane favoured 3-4, never below 2).
    lethal: 3, grindy: 8,
    // A combat sim must use combat loadouts — `effectBonus` filters equipment
    // by activeLoadout, so a caster parked on `profession` reads with zero
    // armour and inflated crafting stats. Switched here and restored in a
    // finally. This is the one place the sim MUTATES anything.
    forceCombatLoadout: true,
    // ── SCENARIOS (magic/melee unification) ──────────────────────────────
    // Weapons use weight TWICE: windup (damage) and wait (tempo), which is what
    // makes them DPR-neutral across weapon weights. Spells use spellTierWeights
    // for wait ONLY, so tier costs time without paying damage.
    //   spellWeight  'none'   windup 1 — shipped behaviour
    //                'tier'   windup from the tier weight
    //                'impl'   IMPLEMENT + tier: the focus is the weapon and the
    //                         spell adds to it. DPR is invariant to weight, so
    //                         this trades per-hit size against tempo.
    //   windupMax    3.0 is the shipped clamp; it starts taxing combined weight
    //                above 300 (staff+greater), where wait keeps scaling but
    //                damage stops.
    //   tierGated    wands own BASIC (their wait discount), staves own
    //                everything ABOVE basic (their free +baseMana scaling),
    //                instead of the current wait-threshold gate.
    scenarios: window.__simScenarios ?? [
      { name: 'A shipped',              spellWeight: 'none', windupMax: 3.0, tierGated: false },
      { name: 'B tier weight',          spellWeight: 'tier', windupMax: 3.0, tierGated: false },
      { name: 'C impl+tier, clamped',   spellWeight: 'impl', windupMax: 3.0, tierGated: false },
      { name: 'D impl+tier, unlocked',  spellWeight: 'impl', windupMax: 99,  tierGated: false },
      { name: 'E D + tier-gated impls', spellWeight: 'impl', windupMax: 99,  tierGated: true  },
    ],
  };

  /* ------------- helpers ------------- */
  // Damage formulas: substitute dice MEANS. Handles bare `d8` as well as `2d8`.
  const meanDice = (s) => String(s).replace(/(\d*)d(\d+)/g,
    (_m, n, f) => String((n ? Number(n) : 1) * (Number(f) + 1) / 2));
  const evalDamage = (f) => { try { const v = Function('return ' + meanDice(f))(); return Number.isFinite(v) ? v : null; } catch { return null; } };
  // Hit formulas: PASS d20, never substitute.
  const hitAt = (f, d20) => { try { const v = Function('d20', 'return ' + f)(d20); return Number.isFinite(v) ? v : null; } catch { return null; } };

  /* ------------- attacker profiles ------------- */
  /** Heaviest equipped implement, as a weight. 0 when casting bare-handed. */
  function implementWeight(actor) {
    let best = 0;
    for (const t of (actor.getEquippedImplements?.() ?? [])) {
      const w = sc.weaponWeights?.[t] ?? 0;
      if (w > best) best = w;
    }
    return best;
  }

  function profileSkill(actor, sk, SC) {
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

    let branch = 'legacy', dmg = null, wait = null, cost = null, windup = 1, castWeight = 0;

    if (['mana', 'health'].includes(res) && tier && grade
        && sc.spellTierFactors[tier] && sc.spellGradeFactors[grade]) {
      branch = 'spell';
      const gf = sc.spellGradeFactors[grade];
      const baseCost = Math.round(sc.spellTierFactors[tier] * gf);
      // windup 1 makes strikeInvestDamage identical to spellInvestDamage, so
      // 'none' reproduces shipped behaviour exactly rather than merely closely
      // — same function, neutral argument.
      const tierW = sc.spellTierWeights?.[tier] ?? sc.celerity.BASELINE_WEIGHT;
      const imps  = [...(actor.getEquippedImplements?.() ?? [])];
      const implW = imps.reduce((m, t) => Math.max(m, sc.weaponWeights?.[t] ?? 0), 0);
      const castW = SC.spellWeight === 'impl' ? implW + tierW
                  : SC.spellWeight === 'tier' ? tierW
                  : 0;
      const spellWindup = castW > 0
        ? Math.min(SC.windupMax, Math.max(dt.windupMin ?? 0.5, castW / 100))
        : 1;
      // Staff owns the tiers ABOVE basic: its +baseMana of free damage scaling.
      const staffOn = SC.tierGated && imps.includes('staff') && tier !== 'basic';
      const effInvest = staffOn ? baseCost * 2 : baseCost;
      dmg = F.strikeInvestDamage(actor.system.abilities.intelligence.mod, eff,
                                 spellWindup, effInvest, F.spellDamageRef(gf));
      // Wait scales with the SAME weight the damage used — that pairing is what
      // makes DPR weight-invariant. Shipped celerity only knows the tier weight.
      wait = CEL.computeActionWait(actor, sk, null, baseCost);
      if (SC.spellWeight === 'impl' && tierW > 0) wait = Math.max(1, Math.round(wait * (castW / tierW)));
      // Wand owns BASIC: its wait discount. computeActionWait already applies it
      // when a wand is equipped, so only add it when the gate says otherwise.
      if (SC.tierGated && imps.includes('wand') && tier !== 'basic') {
        wait = Math.max(1, Math.round(wait / (sc.celerity.WAND_BASIC_WAIT_MULT ?? 0.77)));
      }
      cost = baseCost;
      windup = spellWindup;
      castWeight = castW;
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
        windup = CEL.computeWindupMultiplier(sk, wpn);
        dmg  = F.strikeInvestDamage(blend, eff, windup, baseStam, baseStam);
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
      actor: actor.name, name: sk.name, branch, dmg, cost, wait, windup, castWeight,
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

    let total = 0, n = 0, zero = 0, oneShot = 0;
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
        total += res.hpLoss; n++;
        if (res.hpLoss <= 0) zero++;
        if (res.hpLoss >= def.hp) oneShot++;
      }
    }
    return { mean: total / n, whiffPct: zero / n, oneShotPct: oneShot / n };
  }

  /**
   * DISCRETE kill time, in ticks.
   *
   * An action is declared and FIRES `wait` ticks later (celerity.js
   * `declareAction`: `scheduledTick = clockTick + wait`), so the Nth swing lands
   * at N × wait and nothing at all lands before the first wait elapses.
   * `HP ÷ DPR` instead spreads damage continuously, which hands a slow attacker
   * damage they are never alive to deal — the Dreams of Light case, where a
   * 5191-tick cast needing two casts to kill "won in 1.2 rounds" on paper while
   * dying at tick 2865 without ever acting.
   *
   * ⚠ Swings are counted off the MEAN per swing, so the chance of killing a
   * swing early or late is not modelled. That approximation is worst exactly
   * where it matters most — a 1-2 swing kill — so `oneShotPct` is carried
   * through to the report rather than being averaged away.
   */
  function killTicks(wait, hp, mean) {
    if (!(mean > 0)) return Infinity;
    return Math.ceil(hp / mean) * wait;
  }

  /* ------------- run ------------- */
  const actors = CFG.actors.map(n => game.actors.getName(n)).filter(Boolean);
  if (actors.length < 2) return 'Need at least two of CFG.actors present in the world.';

  // A combat sim must read combat loadouts. Switched here, restored in the
  // finally at the bottom - the only mutation this file performs.
  const loadoutRestore = {};
  if (CFG.forceCombatLoadout) {
    for (const a of actors) {
      const cur = a.system.activeLoadout || 'combat';
      if (cur !== 'combat') { loadoutRestore[a.name] = cur; await a.update({ 'system.activeLoadout': 'combat' }); }
    }
  }

  const defenders = actors.map(profileDefender);
  const roundLen = CEL.referenceRoundLength(actors[0].system.attributes?.race?.level ?? 1);

  function runOnce(SC) {
    const skills = [];
    for (const a of actors) {
      for (const sk of a.items) {
        if (sk.type !== 'skill') continue;
        const p = profileSkill(a, sk, SC);
        if (p) skills.push(p);
      }
    }
    const grid = {}, choices = {}, ttks = [], contTtks = [];
    const killTick = {};                 // 'ATTACKER>DEFENDER' -> tick of the killing blow
    // 'ATTACKER>DEFENDER' -> { chosen, fastest }. Two different questions:
    // `fastest` answers "did they ever get to act", `chosen` answers "did the
    // skill they committed to ever land".
    const waitOf = {};
    let immune = 0, pairs = 0;

    for (const def of defenders) {
      grid[CFG.label(def.name)] = {};
      for (const atk of actors) {
        if (atk.name === def.name) continue;
        pairs++;
        // Chosen on TIME TO KILL, not DPR. The two disagree exactly where this
        // sim used to be wrong: a big slow swing can out-DPR a quick one and
        // still land its killing blow later, because the last partial swing of
        // a continuous model does not exist — you either get the whole swing
        // off or you get nothing.
        let best = { ticks: Infinity, dpr: 0, skill: null };
        let bestDpr = 0;                 // the OLD model's pick, kept for the delta
        let fastest = Infinity;          // cadence they swing at even when it does nothing
        for (const sk of skills.filter(s => s.actor === atk.name)) {
          fastest = Math.min(fastest, sk.wait);
          const { mean, oneShotPct } = meanPerSwing(sk, def);
          if (!(mean > 0.01)) continue;
          const ticks = killTicks(sk.wait, def.hp, mean);
          const dpr = mean * (roundLen / sk.wait);
          if (dpr > bestDpr) bestDpr = dpr;
          if (ticks < best.ticks || (ticks === best.ticks && dpr > best.dpr)) {
            best = { ticks, dpr, skill: sk.name, perSwing: mean, wait: sk.wait,
                     swings: Math.ceil(def.hp / mean), oneShotPct };
          }
        }
        const key = CFG.label(atk.name);
        // Cadence is recorded even for an IMMUNE attacker: they still swing,
        // they just never finish. Conflating "could not kill" with "never
        // acted" would have reported 7 shutouts out of 9 duels on the shipped
        // baseline, which is an artefact of the missing entry, not a finding.
        waitOf[`${key}>${CFG.label(def.name)}`] = { chosen: best.skill ? best.wait : fastest, fastest };
        if (!best.skill) { immune++; grid[CFG.label(def.name)][key] = 'IMMUNE'; }
        else {
          const rounds = best.ticks / roundLen;
          ttks.push(rounds);
          contTtks.push(def.hp / bestDpr);
          killTick[`${key}>${CFG.label(def.name)}`] = best.ticks;
          grid[CFG.label(def.name)][key] = Math.round(rounds * 10) / 10;
          choices[`${key} -> ${CFG.label(def.name)}`] =
            `${best.skill} (${Math.round(best.perSwing)}/swing × ${best.swings} @ ${best.wait}t`
            + ` = tick ${best.ticks}, ${Math.round(best.dpr)} dpr`
            + (best.oneShotPct > 0 ? `, ${Math.round(best.oneShotPct * 100)}% one-shot` : '')
            + (Math.round(rounds * 10) !== Math.round(def.hp / bestDpr * 10)
                ? `; continuous said ${Math.round(def.hp / bestDpr * 10) / 10}` : '') + ')';
        }
      }
    }

    // ── DUELS ────────────────────────────────────────────────────────────────
    // The grid is one-directional: "how long would A need". A duel asks who
    // actually lands their killing blow first, which is the whole point of
    // discrete timing. A shutout — the loser landing ZERO swings — is invisible
    // to a continuous model and is what a slow artillery build risks.
    const duels = {};
    let shutouts = 0, decided = 0, overcommits = 0;
    for (let i = 0; i < defenders.length; i++) {
      for (let j = i + 1; j < defenders.length; j++) {
        const A = CFG.label(defenders[i].name), B = CFG.label(defenders[j].name);
        const tAB = killTick[`${A}>${B}`] ?? Infinity;
        const tBA = killTick[`${B}>${A}`] ?? Infinity;
        if (!Number.isFinite(tAB) && !Number.isFinite(tBA)) { duels[`${A} vs ${B}`] = 'stalemate'; continue; }
        decided++;
        const aWins = tAB <= tBA;
        const [w, l, tw, tl] = aWins ? [A, B, tAB, tBA] : [B, A, tBA, tAB];
        // A SHUTOUT is measured on the loser's FASTEST attack — "did they ever
        // get to act at all". Measuring it on the skill the picker CHOSE would
        // let a greedy min-time-to-kill choice manufacture shutouts: it happily
        // commits to a 4878-tick nuke in a fight that ends at 4172 and then
        // reports zero swings, when a 2541-tick bolt was available.
        const lw = waitOf[`${l}>${w}`] ?? {};
        const landed = lw.fastest > 0 && Number.isFinite(lw.fastest) ? Math.floor(tw / lw.fastest) : 0;
        if (landed === 0) shutouts++;
        // Separately worth seeing: they had time to act, but not with the skill
        // that was their best answer to this defender.
        const overcommitted = landed > 0 && Number.isFinite(lw.chosen) && lw.chosen > tw;
        if (overcommitted) overcommits++;
        duels[`${A} vs ${B}`] = `${w} at tick ${tw} (${Math.round(tw / roundLen * 10) / 10}r)`
          + `; ${l} landed ${landed} swing${landed === 1 ? '' : 's'}`
          + (Number.isFinite(tl) ? `, needed ${tl}` : ', could not kill')
          + (landed === 0 ? ' — SHUTOUT' : '')
          + (overcommitted ? ` — their best answer (${lw.chosen}t) never lands` : '');
      }
    }

    ttks.sort((a, b) => a - b);
    contTtks.sort((a, b) => a - b);
    const med = (arr) => arr.length ? Math.round(arr[Math.floor(arr.length / 2)] * 10) / 10 : null;
    return {
      mode: SC.name,
      summary: {
        pairs, immune,
        immunePct: Math.round(immune / pairs * 100),
        medianRounds: med(ttks),
        // What the old continuous model would have reported, side by side.
        // Keep this: the fix is only trustworthy if the delta is visible.
        medianRoundsContinuous: med(contTtks),
        belowFloor: ttks.filter(t => t < 2).length,
        belowFloorContinuous: contTtks.filter(t => t < 2).length,
        lethal: ttks.filter(t => t <= CFG.lethal).length,
        grindy: ttks.filter(t => t > CFG.grindy).length,
        duelsDecided: decided, shutouts, overcommits,
      },
      grid, choices, duels,
      // `wait` is on this line deliberately: a spell slower than roundLen is
      // the shape continuous DPR reports most confidently and most wrongly.
      spellSkills: skills.filter(s => s.branch === 'spell').map(s =>
        `${CFG.label(s.actor)}/${s.name}: w${s.castWeight} wu${Math.round(s.windup*100)/100} ${Math.round(s.dmg)}dmg`
        + ` ${s.wait}t (${Math.round(s.wait / roundLen * 100) / 100}r) ${Math.round(s.dmg*roundLen/s.wait)}dpr`
        + (s.wait > roundLen ? ' SLOWER-THAN-A-ROUND' : '')),
    };
  }

  let runs;
  try {
    runs = CFG.scenarios.map(runOnce);
  } finally {
    for (const [n, v] of Object.entries(loadoutRestore)) {
      await game.actors.getName(n).update({ 'system.activeLoadout': v });
    }
  }
  window.__archetypeSim = { runs, defenders, roundLen, cfg: CFG, loadoutRestore };
  for (const r of runs) { console.log(`mode=${r.mode}`); console.table(r.grid); console.table(r.duels); }
  return JSON.stringify({ roundLengthTicks: roundLen, loadoutsSwitchedAndRestored: loadoutRestore,
    runs: runs.map(r => ({ mode: r.mode, summary: r.summary, grid: r.grid,
      duels: r.duels, spellSkills: r.spellSkills })) }, null, 1);
})()
