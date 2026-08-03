/**
 * HEALER THROUGHPUT SIM — does a healer keep anyone alive, and which invest
 * curve makes that a decision rather than a formality?
 *
 * THE QUESTION (2026-08-03). design-healer-system.md specifies
 *   heal = blend x mult x sqrt(invested)
 * but it was written 93 days before celerity and before the magic/melee
 * unification, so it assumed mana was the ONLY dial. Today healing would also
 * inherit windup from tier. The shipped economy uses ^0.2 everywhere else,
 * precisely to stop anyone dumping a pool into one enormous result.
 *
 * So this sims BOTH curves against real incoming damage and asks:
 *   - can a healer offset one attacker? (HPR vs DPR)
 *   - how long can they sustain it before the pool is dry?
 *   - does the choice of curve change WHICH lever matters (tier vs mana)?
 *
 * Calls the SHIPPED pipeline for everything it can — resolveDamage for
 * incoming, computeActionWait for cadence, the real stat mods for blends.
 * See playbook-damage-measurement: hand-rolling this chain produced five wrong
 * answers to one balance question in a single session.
 *
 * THREE HEALING MODES (design-healer-system.md). The casting RESOURCE is the
 * mode — no extra tag needed, because each mode already spends a different
 * pool:
 *   mana     -> 0.6 Wis + 0.4 Int   (cleric)
 *   health   -> 0.6 Vit + 0.4 Wis   (vitality / blood magic)
 *   stamina  -> 0.6 Wis + 0.4 Str   (chanter aura)
 *
 * Results land on window.__healerSim.
 */
(async () => {
  const SID = game.system.id;
  const F   = await import(`/systems/${SID}/module/helpers/formulas.mjs`);
  const CEL = await import(`/systems/${SID}/module/systems/celerity.mjs`);
  const DMG = await import(`/systems/${SID}/module/systems/damage.mjs`);
  const sc  = CONFIG.ASPECTSOFPOWER;
  const AA  = sc.armorAnswer ?? {};
  const dt  = sc.defenseTuning ?? {};

  // ⚠ REFUSE TO GUESS: without the cfg-aware strikeInvestDamage every curve
  // scenario silently returns shipped-0.2 numbers.
  if (typeof F.investCurve !== 'function') {
    return 'ABORT: this build has no F.investCurve - pull b0a6cef first.';
  }

  const CFG = {
    // Curves to compare. 0.2 = the shipped economy; 0.5 = the memo's sqrt.
    curves: window.__healCurves ?? [0.2, 0.5],
    // Invest multiples of the tier's base cost, to see how much the mana dial
    // actually buys under each curve.
    investMultiples: [1, 2, 4, 8],
    tiers: ['basic', 'high', 'greater'],
    // A heal is worth measuring against what it is trying to outpace.
    // Reference defender = the highest-HP player character present.
    modes: {
      mana:    { blend: (A) => 0.6 * (A.wisdom?.mod ?? 0) + 0.4 * (A.intelligence?.mod ?? 0), label: 'cleric' },
      health:  { blend: (A) => 0.6 * (A.vitality?.mod ?? 0) + 0.4 * (A.wisdom?.mod ?? 0),     label: 'vitality' },
      stamina: { blend: (A) => 0.6 * (A.wisdom?.mod ?? 0) + 0.4 * (A.strength?.mod ?? 0),     label: 'aura' },
    },
  };

  const meanDice = (s) => String(s ?? '0').replace(/(\d*)d(\d+)/g,
    (_m, n, f) => String((n ? Number(n) : 1) * (Number(f) + 1) / 2));
  const hitAt = (f, d20) => { try { const v = Function('d20', 'return ' + f)(d20); return Number.isFinite(v) ? v : null; } catch { return null; } };

  /**
   * Cast wait for a skill AS IF it were the given tier.
   *
   * computeActionWait reads `skill.system.roll.tier` internally, so the tier
   * has to be on the document for the measurement to be real. Sets it on the
   * in-memory source, measures with the SHIPPED function, and restores — no
   * database write, and the restore runs even if the call throws.
   * Re-deriving the wait formula by hand here instead would be exactly the
   * mistake playbook-damage-measurement exists to prevent.
   */
  function waitForTier(actor, skill, tier, invested) {
    if (!skill) return roundLen;
    const src = skill.system.roll;
    const prev = src.tier;
    try {
      src.tier = tier;
      return CEL.computeActionWait(actor, skill, null, invested);
    } finally {
      src.tier = prev;
    }
  }

  /**
   * Unified heal — literally the damage function, with a healing blend.
   *
   * THIS IS WHAT "UNIFY HEALERS" MEANS: healing stops being a hand-authored
   * dice string and goes through `strikeInvestDamage` like every strike and
   * spell, so tier (via windup), rarity and invest all apply. Calling the
   * shipped function rather than mirroring it is the whole point — a mirror
   * is how the last five wrong answers happened.
   */
  const healAmount = (blend, mult, windup, invested, ref, curve) =>
    F.strikeInvestDamage(blend, mult, windup, invested, ref,
      { invest: { curveExponent: curve } });

  /* ---------- who heals, who hits ---------- */
  const healers = game.actors.filter(a => a.items.some(i => i.type === 'skill'
    && (i.system.tags ?? []).includes('restoration')
    && (i.system.tagConfig?.restorationResource ?? 'health') === 'health'));

  // ⚠ SAME ROSTER + ROTATION CONVENTIONS AS migration/archetype_sim.js, on
  // purpose — one setup drives both sims.
  //   window.__simActors = ['Gabriel', ...]   explicit roster
  //   window.__simSkills = { John: ['Pyroblast'] }  real bread-and-butter
  // Both matter here. Ownership alone sweeps in monsters (a "Wingless Drake?"
  // became the reference defender on the first run), and without the rotation
  // filter the incoming damage is set by mis-configured legacy skills —
  // Hamstring, Winds of Time, Snipe — rather than by what anyone actually
  // casts. See reference-pc-real-rotations.
  const roster = window.__simActors ?? null;
  const pcs = roster
    ? roster.map(n => game.actors.getName(n)).filter(a => a && (a.system.health?.max ?? 0) > 0)
    : game.actors.filter(a => a.type === 'character'
        && (a.system.health?.max ?? 0) > 0
        && Object.entries(a.ownership ?? {}).some(([k, v]) =>
             k !== 'default' && v === 3 && game.users.get(k) && !game.users.get(k).isGM));
  if (!pcs.length) return 'No player characters found.';
  const allowFor = (actor) => window.__simSkills?.[actor.name] ?? null;

  // ⚠ TWO reference defenders, not one. A tank's wall eats most of the
  // incoming damage, so measuring only against them makes healing look
  // trivially sufficient; the squishy is the person actually at risk and the
  // one a healer is really racing for.
  const byHp = [...pcs].sort((a, b) => (b.system.health?.max ?? 0) - (a.system.health?.max ?? 0));
  const profileDef = (d) => ({
    name: d.name,
    hp: Math.round(d.system.health.max),
    armorLayer: Math.round((d.system.defense?.armor?.value ?? 0) + (d.system.defense?.blockDR ?? 0)),
    dr: Math.round(d.system.defense?.dr?.value ?? 0),
    veil: Math.round(d.system.defense?.veil?.value ?? 0),
    lanes: {
      melee: Math.round(d.system.defense?.melee?.value ?? 0),
      ranged: Math.round(d.system.defense?.ranged?.value ?? 0),
      mind: Math.round(d.system.defense?.mind?.value ?? 0),
      soul: Math.round(d.system.defense?.soul?.value ?? 0),
    },
  });
  const defTank = profileDef(byHp[0]);
  const defSquish = profileDef(byHp[Math.floor(byHp.length / 2)]);
  const def = defSquish;
  // ⚠ Do NOT anchor the whole comparison on one defender. The median-HP pick
  // landed on the roster's most evasive character (dodge 1361) and reported a
  // typical incoming of 25 dpr — an artefact of who happened to sort middle.
  // Incoming is measured across EVERY attacker-defender pair and the median
  // taken over all of them.
  const allDefs = pcs.map(profileDef);

  const roundLen = CEL.referenceRoundLength(byHp[0].system.attributes?.race?.level ?? 1);

  /* ---------- incoming: what a healer must outpace ---------- */
  // Post-mitigation DPR against the reference defender, through resolveDamage.
  const incoming = [];
  for (const tgt of allDefs) {
  for (const atk of pcs) {
    if (atk.name === tgt.name) continue;
    let best = 0, bestName = '';
    const allow = allowFor(atk);
    for (const sk of atk.items) {
      if (sk.type !== 'skill') continue;
      if (allow && !allow.includes(sk.name)) continue;
      const tags = sk.system.tags ?? [];
      if (!tags.includes('attack')) continue;
      const rd = sk.getRollData?.(); if (!rd?.roll) continue;
      let built; try { built = sk._buildRollFormulas(rd); } catch { continue; }

      // ⚠ _buildRollFormulas is the PREVIEW path — it has NO windup term, so
      // it overstates light weapons ~2x and understates heavy ones ~1.5x
      // (playbook-damage-measurement). Resolve the branch roll() would
      // actually take, exactly as migration/archetype_sim.js does.
      const A = atk.system.abilities ?? {};
      const grade = atk.system.attributes?.race?.rank || '';
      const res = rd.roll.resource;
      let eff = 1; try { eff = sk._resolveRarityMods().effectiveMult; } catch { /* noop */ }
      let raw = null;
      if (['mana', 'health'].includes(res) && rd.roll.tier && grade
          && sc.spellTierFactors[rd.roll.tier] && sc.spellGradeFactors[grade]) {
        const gf = sc.spellGradeFactors[grade];
        const baseCost = Math.round(sc.spellTierFactors[rd.roll.tier] * gf);
        const wu = F.spellWindupMultiplier(rd.roll.tier,
          (atk.getEquippedImplements?.() ? [...atk.getEquippedImplements()] : [])
            .reduce((m, t) => Math.max(m, sc.weaponWeights?.[t] ?? 0), 0));
        raw = F.strikeInvestDamage(A.intelligence?.mod ?? 0, eff, wu, baseCost, F.spellDamageRef(gf));
      } else if (res === 'stamina'
                 && ['str_weapon', 'dex_weapon', 'phys_ranged'].includes(rd.roll.type)) {
        const wpn = sk._resolveWeaponForSkill();
        const wt = sk.constructor.resolveWeaponWeight(wpn);
        if (wt > 0) {
          const { blend } = F.weaponStatBlend(wt,
            { str: A.strength?.mod ?? 0, dex: A.dexterity?.mod ?? 0, per: A.perception?.mod ?? 0 },
            rd.roll.type === 'phys_ranged');
          const baseStam = Math.max(1, Math.round(
            (wt / sc.invest.staminaBaseDivisor) * (blend / sc.invest.staminaNormalizer)));
          raw = F.strikeInvestDamage(blend, eff, CEL.computeWindupMultiplier(sk, wpn), baseStam, baseStam);
        }
      }
      // Legacy fallback applies NO rarity — reproduced faithfully, not fixed.
      if (raw == null) raw = Function('return ' + meanDice(built.dmgFormula))();
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const lane = rd.roll.targetDefense || 'melee';
      const usesVeil = lane === 'mind' || lane === 'soul';
      const mitigation = usesVeil ? tgt.veil : tgt.armorLayer;
      const hitBasis = built.hitFormula ? hitAt(built.hitFormula, 0) : 0;
      const laneVal = tgt.lanes[lane] ?? 0;
      const canDefend = laneVal > 0 && hitBasis > 0;
      // Mean over the full dice grid, same as the archetype sim.
      let tot = 0, n = 0;
      for (let a = 1; a <= 20; a++) {
        const hitTotal = hitBasis * (1 + a / 100);
        const sides = canDefend ? 20 : 1;
        for (let b = 1; b <= sides; b++) {
          const margin = canDefend
            ? F.defenceMarginMultiplier((laneVal / (dt.dodgeBasisDiv ?? 1.1)) * (1 + b / 100), hitTotal)
            : 1;
          tot += DMG.resolveDamage({
            incoming: raw, mitigation, drValue: tgt.dr, margin, health: tgt.hp,
          }).hpLoss;
          n++;
        }
      }
      const wait = CEL.computeActionWait(atk, sk, sk._resolveWeaponForSkill?.() ?? null);
      if (!(wait > 0)) continue;
      const dpr = (tot / n) * (roundLen / wait);
      if (dpr > best) { best = dpr; bestName = sk.name; }
    }
    if (best > 0) incoming.push({ who: atk.name, vs: tgt.name, dpr: Math.round(best), skill: bestName });
  }
  }
  incoming.sort((a, b) => b.dpr - a.dpr);
  const medianDpr = incoming.length
    ? incoming[Math.floor(incoming.length / 2)].dpr : 0;

  /* ---------- healer throughput under each curve ---------- */
  const rows = [];
  for (const h of healers) {
    const A = h.system.abilities ?? {};
    const grade = h.system.attributes?.race?.rank || 'E';
    const gradeFactor = sc.spellGradeFactors?.[grade] ?? 1;
    const ref = F.spellDamageRef(gradeFactor);
    // Representative restoration skill, for its rarity multiplier and to drive
    // a real computeActionWait.
    const skill = h.items.find(i => i.type === 'skill'
      && (i.system.tags ?? []).includes('restoration')
      && (i.system.tagConfig?.restorationResource ?? 'health') === 'health');
    let mult = 1;
    try { mult = skill?._resolveRarityMods()?.effectiveMult ?? 1; } catch { /* noop */ }

    for (const [res, mode] of Object.entries(CFG.modes)) {
      const blend = Math.round(mode.blend(A));
      if (blend <= 0) continue;
      const pool = Math.round(
        res === 'mana' ? (h.system.mana?.max ?? 0)
        : res === 'stamina' ? (h.system.stamina?.max ?? 0)
        : (h.system.health?.max ?? 0));
      for (const tier of CFG.tiers) {
        const tierFactor = sc.spellTierFactors?.[tier]; if (!tierFactor) continue;
        const baseCost = Math.round(tierFactor * gradeFactor);
        // Tier weight -> windup, exactly as the unification does for spells.
        const windup = F.spellWindupMultiplier
          ? F.spellWindupMultiplier(tier, 0) : 1;
        for (const curve of CFG.curves) {
          for (const im of CFG.investMultiples) {
            const invested = baseCost * im;
            if (invested > pool) continue;
            // ⚠ THE MEMO'S OWN INVEST CAP, which decides this question more
            // than the curve does. design-healer-system.md: mana mode caps at
            // Wis x 0.15 above base (parallel to the caster's cap); aura mode
            // at Tough x 0.15; vitality is bounded by the 25%-HP floor
            // instead. Without it the sim explores x8 invests no healer could
            // legally make, which is where sqrt looked most alarming.
            const capAbove = res === 'mana' ? 0.15 * (A.wisdom?.mod ?? 0)
              : res === 'stamina' ? 0.15 * (A.toughness?.mod ?? 0)
              : 0.75 * (h.system.health?.value ?? 0);   // vitality: 25% HP floor
            const legal = invested <= baseCost + capAbove;
            const heal = healAmount(blend, mult, windup, invested, ref, curve);
            // ⚠ computeActionWait reads the SKILL's own tier, so passing the
            // real skill priced every simulated tier at that one skill's cast
            // time — a greater heal came out as fast as a basic one, which
            // inflates high-tier throughput exactly where the curve question
            // is decided. Set the tier for the measurement and restore it.
            const wait = waitForTier(h, skill, tier, invested);
            const hpr = heal * (roundLen / Math.max(1, wait));
            rows.push({
              healer: h.name, mode: mode.label, res, tier, curve, investMult: im, legal,
              invested, heal, wait, actions: Math.round(wait / (roundLen / 3) * 100) / 100,
              hpr: Math.round(hpr),
              // Can this healer offset the median attacker on the roster?
              offsetPct: medianDpr ? Math.round(hpr / medianDpr * 100) : null,
              // How long the pool lasts at this spend rate.
              casts: Math.floor(pool / Math.max(1, invested)),
              sustainRounds: Math.round(Math.floor(pool / Math.max(1, invested)) * (wait / roundLen) * 10) / 10,
              pctOfBar: Math.round(heal / def.hp * 100),
            });
          }
        }
      }
    }
  }

  window.__healerSim = { rows, incoming, medianDpr, def, defTank, defSquish, roundLen, healers: healers.map(h => h.name) };
  return JSON.stringify({
    reference: { measuredAgainst: def.name, hp: def.hp, tankForContrast: defTank.name + ' ' + defTank.hp, roundLen, medianAttackerDpr: medianDpr },
    topIncoming: incoming.slice(0, 5),
    healers: healers.map(h => h.name),
    rowCount: rows.length,
  }, null, 1);
})()
