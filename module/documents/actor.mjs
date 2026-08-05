// Weapon proficiency scales the guard as well as the strike. Safe to import
// here: systems/weapon-styles.mjs pulls only from helpers/formulas.mjs, so it
// cannot create the actor->item cycle the code standards forbid.
import { proficiencyDamageMult } from '../systems/weapon-styles.mjs';
import { carriedWeightLb, buffCapacity, abilityMod, abilityModTotal,
         abilityPostCurveFactors, abilityValues,
         buffLoadByAbility, buffDefenceCost } from '../helpers/formulas.mjs';

/**
 * Change keys that `prepareDerivedData` consumes BY HAND — every ability, plus
 * each key with an explicit `effectBonus(...)` call site below.
 *
 * ⚠ THIS SET IS THE CONTRACT. Anything listed here is applied by the manual
 * contribution breakdown; anything NOT listed falls through to generic
 * application in `applyActiveEffects`. Adding an `effectBonus()` call without
 * adding its key here DOUBLE-APPLIES that change. Removing one without
 * deleting the call site drops it entirely.
 *
 * Abilities are excluded wholesale because their composition cannot be
 * expressed as per-key application at all: equipment is capped at 30% of a
 * stat's own calculated value AND 20% of the SUM across all nine, and titles,
 * blessings and passives compose in a fixed order. A flat per-key merge has no
 * way to see the other eight stats.
 */
const MANUALLY_APPLIED_KEYS = new Set([
  'system.defense.dr.value',
  'system.defense.armor.value',
  'system.defense.veil.value',
  'system.defense.melee.value',
  'system.defense.ranged.value',
  'system.defense.mind.value',
  'system.defense.soul.value',
  'system.meditation.fraction',
]);

/** True when the manual breakdown owns this change key. */
function _isManuallyApplied(key) {
  return typeof key === 'string'
    && (key.startsWith('system.abilities.') || MANUALLY_APPLIED_KEYS.has(key));
}

/**
 * Does an item belong to the ACTIVE loadout? Module scope because both
 * `applyActiveEffects` and the `effectBonus` closure need it, and the two must
 * agree — a profession-set item buffing a combat stat in one path but not the
 * other would be worse than either behaviour alone.
 * No source item = always apply (legacy effects with no itemSource).
 */
function _itemMatchesLoadoutFor(actor, item) {
  if (!item) return true;
  const slotConfig = CONFIG.ASPECTSOFPOWER.equipmentSlots ?? {};
  const activeLoadout = actor.system?.activeLoadout || 'combat';
  const allSlots = [item.system.slot, ...(item.system.additionalSlots ?? [])].filter(Boolean);
  return allSlots.some((slotKey) => {
    const slotSet = slotConfig[slotKey]?.set ?? 'combat';
    // 'both' (e.g. jewelry) is always active regardless of loadout.
    return slotSet === 'both' || slotSet === activeLoadout;
  });
}

/**
 * Disposition-targeting filter for auras. Returns true if `otherDisp` is a
 * valid target given the source's `myDisp` and the aura's `targeting` mode.
 * Exported for use by the movement-hook entry trigger (canvas/aura-entry-trigger).
 */
export function _passesAuraTargetingFilter(myDisp, otherDisp, targeting) {
  if (targeting === 'all') return true;
  if (targeting === 'enemies') {
    if (myDisp === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return otherDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE;
    if (myDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE)  return otherDisp === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    return false; // neutral source — no auto-enemies
  }
  if (targeting === 'allies') return otherDisp === myDisp;
  return false;
}

/**
 * Extend the base Actor document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class AspectsofPowerActor extends Actor {
  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override */
  applyActiveEffects(phase) {
    // v14: initialize tokenActiveEffectChanges if core hasn't yet (synthetic actors).
    const phases = CONFIG.ActiveEffect.phases ?? { initial: {}, final: {} };
    this.tokenActiveEffectChanges ??= Object.fromEntries(
      Object.keys(phases).map(p => [p, []])
    );

    // ── Why this is overridden at all ────────────────────────────────────
    // ABILITIES cannot be applied per-key. Equipment is capped at 30% of a
    // stat's own calculated value AND 20% of the SUM across all nine, and
    // titles/blessings/passives compose in a fixed order. A flat per-key merge
    // cannot see the other eight stats, so `prepareDerivedData` builds the
    // whole contribution breakdown by hand. That is the real reason, and it
    // covers ~2,050 of the ~2,055 change entries in a live world.
    //
    // ⚠ The comment that used to sit here ALSO claimed core's application
    // would crash on our leaf-value keys. Tested against v14.365 on 2026-08-03:
    // it does not. It runs cleanly and resolves them correctly. That claim was
    // what turned a targeted need into a blanket override.
    //
    // ── Why anything is applied here now ─────────────────────────────────
    // A blanket skip means every non-ability field must be hand-wired through
    // `effectBonus`, and forgetting fails SILENTLY — the effect reports as
    // enabled, applicable and un-suppressed while doing nothing. That bit
    // twice: `system.meditation.fraction`, and Gabriel's Geppetto's Eye
    // (`system.reactions.max`), which someone worked around by hardcoding the
    // value into his source data.
    //
    // So: keys the manual breakdown owns are skipped, everything else is
    // applied through core's own per-change logic. New fields now work by
    // default instead of failing quietly.
    // ⚠ APPLY ONLY THIS PHASE'S CHANGES. This method is invoked ONCE PER PHASE
    // ('initial', then 'final'), so a loop that ignores the argument applies
    // every change TWICE. Caught by diffing derived values across all 219
    // actors: Gabriel's reactions.max came out at 4 instead of 3, and that one
    // number was the only tell — nothing else in the world stacks additively
    // on a non-ability key yet, so the bug was one content change away from
    // being invisible.
    const activePhase = typeof phase === 'string' ? phase : 'initial';

    for (const effect of this.allApplicableEffects()) {
      if (effect.disabled) continue;
      // Equipment effects are loadout-scoped, exactly as `effectBonus` treats
      // them — a profession-set item must not buff a combat stat.
      if (effect.system?.effectType === 'equipment'
          && !_itemMatchesLoadoutFor(this, this.items.get(effect.system?.itemSource))) continue;
      for (const change of effect.changes) {
        if (!change?.key || _isManuallyApplied(change.key)) continue;
        if ((change.phase ?? 'initial') !== activePhase) continue;
        try {
          effect.apply(this, change);
        } catch (err) {
          console.error(`[AoP] effect "${effect.name}" change "${change.key}" failed to apply:`, err);
        }
      }
    }
  }

  /**
   * @override
   * Clamp pool values to their maxima on EVERY update.
   *
   * Nothing did this before: `value` could sit above `max` indefinitely, and
   * every consumer had to remember to clamp. It becomes load-bearing the
   * moment max HP is mutable (strain), because a strained character whose
   * current HP was above the new max would otherwise keep the excess.
   *
   * Only clamps the pools actually present in the update, so a write that
   * never touches health cannot silently rewrite it.
   */
  async _preUpdate(changed, options, user) {
    const res = await super._preUpdate(changed, options, user);
    if (res === false) return false;
    for (const pool of ['health', 'stamina', 'mana']) {
      const incoming = changed.system?.[pool];
      if (!incoming || incoming.value === undefined) continue;
      // The max this update will land on: an explicit new max wins, else the
      // derived one. Reading the derived value keeps strain in the picture.
      const max = incoming.max ?? this.system?.[pool]?.max;
      if (!(max >= 0)) continue;
      incoming.value = Math.min(Math.max(0, incoming.value), max);
    }
    return res;
  }

  /** @override */
  prepareBaseData() {
    // Data modifications in this step occur before processing embedded
    // documents or derived data.
  }

  /**
   * @override
   * Augment the actor source data with additional dynamic data. Typically,
   * you'll want to handle most of your calculated/derived data in this step.
   * Data calculated in this step should generally not exist in template.json
   * (such as ability modifiers rather than ability scores) and should be
   * available both inside and outside of character sheets (such as if an actor
   * is queried and has a roll executed directly from it).
   */
  prepareDerivedData() {
    const actorData = this;
    const systemData = actorData.system;

    // --- Rank derivation for all attribute types ---
    for (const type of ['race', 'class', 'profession']) {
      if (systemData.attributes[type]) {
        systemData.attributes[type].rank = CONFIG.ASPECTSOFPOWER.getRankForLevel(systemData.attributes[type].level);
      }
    }

    // ── Tag Collection (early — needed for size scaling) ──
    this._collectTags(systemData);

    // Power-curve modifier formula (per design-stat-curves.md):
    //   mod = round((value/NORM)^P × NORM × MULT_BASE^gradeIndex)
    // Race rank determines the grade multiplier (G/F/E = 0, D = 1, ..., S = 5).
    const sc = CONFIG.ASPECTSOFPOWER.statCurve;
    const _raceRank = systemData.attributes?.race?.rank ?? 'E';
    const _gradeMult = Math.pow(sc.MULT_BASE, sc.gradeIndex[_raceRank] ?? 0);
    // Delegates to helpers/formulas.mjs so the buff cap — which has to price a
    // hypothetical value without re-deriving the actor — cannot drift from the
    // curve the actor actually uses.
    const calcMod = (value) => abilityMod(value, _gradeMult);

    // --- Stat breakdown: classify effect contributions by source ---
    // Titles are additive to base; blessings MULTIPLY (base + titles).
    // Passives (effectCategory === 'passive') behave like blessings: their
    // additive changes go to passiveAdd, multiplier changes compose into
    // passiveMultiplier. Used by racial passives like Scaled Hide (toughness
    // ×1.15) and Eagle Eye (perception ×1.15).
    const abilityKeys = Object.keys(systemData.abilities);
    const contributions = {};
    for (const key of abilityKeys) {
      contributions[key] = {
        equipment: 0,
        blessingAdd: 0, blessingMultiplier: 1,
        passiveAdd: 0,  passiveMultiplier: 1,
        title: 0,
        other: 0,
      };
    }
    // Active loadout determines which equipment effects apply: 'combat' uses
    // combat slots, 'profession' uses profession slots, jewelry ('both') is
    // always on. Resolved inside _itemMatchesLoadoutFor.

    // Helper: does an item belong to the active loadout?
    // Checks primary slot AND any additional slots — if any matches the loadout, it applies.
    // Delegates to the module-scope implementation so this path and
    // applyActiveEffects can never disagree about what is equipped.
    const _itemMatchesLoadout = (item) => _itemMatchesLoadoutFor(this, item);

    for (const e of this.allApplicableEffects()) {
      if (e.disabled) continue;

      // Filter equipment effects by loadout match.
      if (e.system?.effectType === 'equipment') {
        const sourceItem = this.items.get(e.system?.itemSource);
        if (!_itemMatchesLoadout(sourceItem)) continue;
      }

      for (const c of e.changes) {
        const match = c.key.match(/^system\.abilities\.(\w+)\.value$/);
        if (!match || !contributions[match[1]]) continue;
        const val = Number(c.value) || 0;
        const k = match[1];
        if (e.system?.effectType === 'equipment')        contributions[k].equipment += val;
        else if (e.system?.effectCategory === 'blessing') {
          if (c.type === 'multiply') contributions[k].blessingMultiplier *= val;
          else                       contributions[k].blessingAdd += val;
        }
        else if (e.system?.effectCategory === 'passive') {
          if (c.type === 'multiply') contributions[k].passiveMultiplier *= val;
          else                       contributions[k].passiveAdd += val;
        }
        else if (e.system?.effectCategory === 'title')    contributions[k].title += val;
        else                                               contributions[k].other += val;
      }
    }

    // Per-ability breakdown:
    //   base → +titles → ×blessings → ×passives → +blessingAdd + passiveAdd → calculated
    //   calculated + equipmentCapped + effectBonus (other) → final
    for (const [key, ability] of Object.entries(systemData.abilities)) {
      const base = Math.round(this._source.system.abilities[key].value ?? 0);
      const c = contributions[key];
      const afterTitles = base + c.title;
      const calculated = Math.round(afterTitles * c.blessingMultiplier * c.passiveMultiplier)
        + Math.round(c.blessingAdd)
        + Math.round(c.passiveAdd);
      const effectBonus = Math.round(c.other);
      ability.breakdown = {
        base,
        titleBonus: Math.round(c.title),
        blessingMultiplier: c.blessingMultiplier,
        blessingAdd: Math.round(c.blessingAdd),
        passiveMultiplier: c.passiveMultiplier,
        passiveAdd: Math.round(c.passiveAdd),
        calculated,
        effectBonus,
        equipmentBonusRaw: Math.round(c.equipment),
      };
    }

    // Equipment caps: 30% per stat, 20% of total calculated.
    const totalCalculated = Math.round(abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.calculated, 0));
    const globalCap = Math.floor(totalCalculated * 0.20);

    for (const ability of Object.values(systemData.abilities)) {
      const b = ability.breakdown;
      b.perStatCap = Math.floor(b.calculated * 0.30);
      b.equipmentCapped = Math.min(b.equipmentBonusRaw, b.perStatCap);
    }

    let totalEquip = abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.equipmentCapped, 0);
    if (totalEquip > globalCap && totalEquip > 0) {
      const ratio = globalCap / totalEquip;
      for (const ability of Object.values(systemData.abilities)) {
        ability.breakdown.equipmentCapped = Math.floor(ability.breakdown.equipmentCapped * ratio);
      }
      totalEquip = abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.equipmentCapped, 0);
    }

    // Final values and modifiers (overrides AE-modified value with capped total).
    for (const [key, ability] of Object.entries(systemData.abilities)) {
      const b = ability.breakdown;
      b.final = Math.round(b.calculated + b.equipmentCapped + b.effectBonus);
      ability.value = b.final;
      ability.mod = calcMod(b.final);
      b.finalMod = ability.mod;
    }

    // Summary for the stats tab.
    systemData.statsSummary = {
      totalCalculated,
      globalCap,
      totalEquipRaw: abilityKeys.reduce((sum, k) => sum + systemData.abilities[k].breakdown.equipmentBonusRaw, 0),
      totalEquipCapped: totalEquip,
    };

    // ── Size Scaling (str/vit mods) ──
    // Detect size tag from collectedTags; default to medium (1.0x).
    const sizeScaling = CONFIG.ASPECTSOFPOWER.sizeScaling ?? {};
    let actorSizeTag = 'medium';
    for (const sizeKey of Object.keys(sizeScaling)) {
      if (systemData.collectedTags?.has(sizeKey)) { actorSizeTag = sizeKey; break; }
    }
    const sizeMultipliers = sizeScaling[actorSizeTag] ?? { str: 1.0, hp: 1.0, meleeRangedDef: 1.0 };
    systemData.sizeTag = actorSizeTag;

    if (sizeMultipliers.str !== 1.0) {
      systemData.abilities.strength.mod = Math.round(systemData.abilities.strength.mod * sizeMultipliers.str);
      systemData.abilities.strength.breakdown.finalMod = systemData.abilities.strength.mod;
    }

    // ── Buff capacity (design-healer-system.md phase 6) ──
    // Derived, never stored: capacity moves with the abilities and usage moves
    // with the live effect list, so neither can go stale the way a cached
    // number would. Safe here — ability `value` is final as of the loop above
    // (the size pass below only touches `mod`).
    //
    // ⚠ Usage counts ONLY effects stamped `effectType: 'buff'` by gmApplyBuff.
    // Titles, blessings and gear all write the same additive stat changes and
    // are indistinguishable from a buff by shape alone; charging for them would
    // put every geared PC permanently overcap before any healer acted.
    if (systemData.buffs) {
      // Per-ability points currently on loan from buffs, NEGATED, so subtracting
      // them from the live values reconstructs the unbuffed body. Per-ability
      // rather than a single total because the curve is applied per stat —
      // where the points sit changes what they are worth.
      const loan = {};
      let defenceLoad = 0;
      for (const e of this.allApplicableEffects()) {
        if (e.disabled) continue;
        if (e.system?.effectType !== 'buff') continue;
        for (const [k, v] of Object.entries(buffLoadByAbility(e.changes))) {
          loan[k] = (loan[k] ?? 0) - v;
        }
        defenceLoad += buffDefenceCost(e.changes);
      }
      // Factors come from the LIVE actor, where value and mod agree, and are
      // then reused for the hypothetical unbuffed body.
      const _f = abilityPostCurveFactors(systemData.abilities, _gradeMult);
      const currentTotal  = abilityModTotal(
        abilityValues(systemData.abilities), _gradeMult, _f);
      const unbuffedTotal = abilityModTotal(
        abilityValues(systemData.abilities, loan), _gradeMult, _f);
      systemData.buffs.capacity = buffCapacity(unbuffedTotal);
      // Used is the mod actually on loan, not the raw points written — the
      // same currency the capacity is denominated in.
      systemData.buffs.used = Math.max(0, currentTotal - unbuffedTotal) + defenceLoad;
      systemData.buffs.remaining =
        Math.max(0, systemData.buffs.capacity - systemData.buffs.used);
    }

    // ⚠ AFTER the size pass on purpose: size scaling multiplies a large
    // creature's strength mod, and capacity is denominated in mods. Running
    // this earlier read Phil (large) at 731 against a true 755.
    // --- Resource maxima ---
    // hpScale (defenseTuning, default 1.5): global TTK-floor raise shipped
    // with active defense — windup-amplified bursts must not one-shot
    // same-rank actors now that pools no longer absorb them (gap-analysis
    // Family D, sim-validated 2026-06-11). Revert = set hpScale to 1.
    const hpScale = CONFIG.ASPECTSOFPOWER.defenseTuning?.hpScale ?? 1;
    systemData.health.trueMax = Math.round(systemData.abilities.vitality.mod * 1.25 * hpScale * sizeMultipliers.hp);
    // STRAIN eats into max HP. Floored so a character can never strain below
    // half their true maximum — the mechanic is meant to make you fragile,
    // not to offer a way to kill yourself by accounting.
    const _strainFloor = CONFIG.ASPECTSOFPOWER.strain?.maxFrac ?? 0.5;
    const _strain = Math.min(Math.max(0, systemData.strain ?? 0), _strainFloor);
    systemData.health.max = Math.max(1, Math.round(systemData.health.trueMax * (1 - _strain)));
    systemData.mana.max = systemData.abilities.willpower.mod;
    systemData.stamina.max = systemData.abilities.endurance.mod;

    // Overhealth cap: 200% of max HP (characters only).
    if (systemData.overhealth) {
      systemData.overhealth.cap = systemData.health.max * 2;
      if (systemData.overhealth.value > systemData.overhealth.cap) {
        systemData.overhealth.value = systemData.overhealth.cap;
      }
    }

    // Defense values: compute base from ability mods, then add any
    // ActiveEffect contributions by explicitly summing effect changes.
    const effectBonus = (key) => {
      let sum = 0;
      for (const e of this.allApplicableEffects()) {
        if (e.disabled) continue;

        // Equipment effects: filter by active loadout.
        if (e.system?.effectType === 'equipment') {
          const sourceItem = this.items.get(e.system?.itemSource);
          if (!_itemMatchesLoadout(sourceItem)) continue;
        }

        for (const c of e.changes) {
          if (c.key === key) sum += Number(c.value) || 0;
        }
      }
      return sum;
    };

    // ── Debuff impacts on defenses ──
    // Collect all active debuffs and their defense modifications.
    let zeroMelee = false, zeroRanged = false, zeroMind = false;
    let dexReduction = 0;       // Root: flat reduction to dex contribution
    let perceptionReduction = 0; // Blind: flat reduction to perception contribution
    let meleeRangedPctReduction = 0; // Enraged: % reduction to melee/ranged

    for (const effect of this.effects) {
      if (effect.disabled) continue;
      const sys = effect.system;
      if (!sys?.debuffType || sys.debuffType === 'none') continue;
      const roll = sys.debuffDamage ?? 0;

      switch (sys.debuffType) {
        case 'stun':
          zeroMelee = zeroRanged = zeroMind = true;
          break;
        case 'paralysis':
        case 'immobilized':
        case 'frozen':
          zeroMelee = zeroRanged = true;
          break;
        case 'sleep':
          zeroMelee = zeroRanged = zeroMind = true;
          break;
        case 'root':
          dexReduction += roll;
          break;
        case 'chilled':
          // Each chilled stack contributes its debuffDamage (per-stack dex
          // drop) to the actor's dex reduction. Multiple stacks are parallel
          // AEs — Foundry-style; we just sum each one's contribution here.
          // When the total drives effectiveDex to 0, the post-apply
          // threshold check in gmApplyDebuff spawns Frozen and clears
          // all chilled stacks.
          dexReduction += roll;
          break;
        case 'blind':
          perceptionReduction += roll;
          break;
        case 'deafened':
          // 50% of debuff roll reduces perception contribution.
          perceptionReduction += Math.round(roll * 0.5);
          break;
        case 'enraged':
          // 20% of defense or debuff roll, whichever is lower (applied as % later).
          meleeRangedPctReduction += Math.min(20, roll);
          break;
        // Slow: NYI — design in design-debuff-buildup.md; no accumulator kept
        // here until it ships.
      }
    }

    const dexMod = systemData.abilities.dexterity.mod;
    const perMod = systemData.abilities.perception.mod;
    const strMod = systemData.abilities.strength.mod;
    const intMod = systemData.abilities.intelligence.mod;
    const wisMod = systemData.abilities.wisdom.mod;
    const wilMod = systemData.abilities.willpower.mod;

    const effectiveDex = Math.max(0, dexMod - dexReduction);
    const effectivePer = Math.max(0, perMod - perceptionReduction);

    // DR: base 50% of toughness mod + effect bonuses.
    const toughMod = systemData.abilities.toughness.mod;
    if (!systemData.defense.dr) systemData.defense.dr = { value: 0 };
    systemData.defense.dr.value = Math.round(toughMod * 0.5) + effectBonus('system.defense.dr.value');

    // Armor and veil: entirely from equipment/effects (no base stat contribution).
    systemData.defense.armor.value = effectBonus('system.defense.armor.value');
    systemData.defense.veil.value  = effectBonus('system.defense.veil.value');

    // Meditation fraction: base from config, plus anything a passive grants.
    // ⚠ This line is REQUIRED for the effect to do anything. `applyActiveEffects`
    // is a deliberate no-op in this system — core's merge-based application is
    // skipped entirely and every change is summed by hand here. An AE targeting
    // a field nobody reads through `effectBonus` applies to NOTHING, silently,
    // while looking perfectly well-formed on the sheet.
    systemData.meditation.fraction = Math.max(0,
      (CONFIG.ASPECTSOFPOWER.meditation?.baseFraction ?? 0.10)
      + effectBonus('system.meditation.fraction'));

    // Block DR — the held weapon contributes passive flat mitigation
    // (active defense, design-active-defense.md): the str archetype's
    // constant-on layer. blockDR = coef × (celerityWeight/100) × (1 + str/1085).
    // Highest-weight equipped non-shield weapon counts (shields already
    // grant armorBonus via craftShieldArmorValues — no double-dip). Broken
    // weapons (0 durability) grant nothing. Weight via the weaponWeights
    // tag table (inlined — no lbs fallback; untagged weapons guard nothing).
    {
      const dt = CONFIG.ASPECTSOFPOWER.defenseTuning ?? {};
      const coef = dt.blockDRCoef ?? 0;
      let bestWeight = 0;
      let bestItem = null;
      if (coef > 0) {
        const table = CONFIG.ASPECTSOFPOWER.weaponWeights ?? {};
        for (const i of this.items) {
          if (i.type !== 'item' || !i.system.equipped || i.system.slot !== 'weaponry') continue;
          if ((i.system.tags ?? []).includes('shield')) continue;
          if (i.system.durability?.value <= 0 && i.system.durability?.max > 0) continue;
          for (const tag of (i.system.tags ?? [])) {
            if (table[tag] != null) {
              if (table[tag] > bestWeight) { bestWeight = table[tag]; bestItem = i; }
              break;
            }
          }
        }
      }
      const strM = systemData.abilities.strength.mod;
      // PROFICIENCY SCALES THE GUARD (ruled 2026-07-29: proficiency should
      // alter everything to do with the weapon, not just damage). Scaled by the
      // proficiency of the weapon actually providing the guard, so a master
      // blocks with a claymore far better than someone holding one for the
      // first time. Untracked actors and untrained-but-neutral cases return 1,
      // so this is inert for most of the world — see weapon-styles.
      //
      // Simmed before shipping: proportionate and never saturates, but the
      // benefit CONCENTRATES on heavy weapons because blockDR is weight-derived
      // (a dagger's guard barely moves across the whole ladder). At `rare` a
      // greatsword wielder's wall can fully stop the heaviest attack in the
      // game — an accepted threshold, not an accident.
      const profMult = bestItem ? proficiencyDamageMult(this, bestItem) : 1;
      systemData.defense.blockDR = bestWeight > 0
        ? Math.round(coef * (bestWeight / 100) * (1 + strM / 1085) * profMult)
        : 0;
    }

    // Base defense calculations.
    // Melee secondary = max(str, per) per design-active-defense.md perception
    // ruling (2026-06-11): you avoid a blow by muscling the pivot (str) OR
    // reading it early (per) — whichever you're better at. Substitutes,
    // never stacks; melee specialists unchanged, per-primaries (rangers,
    // magic marksmen) get melee-defense return on their main stat.
    let meleeVal  = Math.round((effectiveDex + Math.max(strMod, effectivePer) * 0.3) * 1.1) + effectBonus('system.defense.melee.value');
    let rangedVal = Math.round((effectiveDex * 0.3 + effectivePer) * 1.1) + effectBonus('system.defense.ranged.value');
    let mindVal   = Math.round((intMod + wisMod * 0.3) * 1.1) + effectBonus('system.defense.mind.value');
    let soulVal   = Math.round((wisMod + wilMod * 0.3) * 1.1) + effectBonus('system.defense.soul.value');

    // Enraged: reduce melee/ranged by percentage.
    if (meleeRangedPctReduction > 0) {
      meleeVal  = Math.round(meleeVal * (1 - meleeRangedPctReduction / 100));
      rangedVal = Math.round(rangedVal * (1 - meleeRangedPctReduction / 100));
    }

    // Zero-out overrides (stun/paralysis/sleep/immobilized/frozen).
    if (zeroMelee)  meleeVal = 0;
    if (zeroRanged) rangedVal = 0;
    if (zeroMind)   mindVal = 0;

    // ── Size Scaling (melee/ranged defense) ──
    if (sizeMultipliers.meleeRangedDef !== 1.0) {
      meleeVal  = Math.round(meleeVal * sizeMultipliers.meleeRangedDef);
      rangedVal = Math.round(rangedVal * sizeMultipliers.meleeRangedDef);
    }

    systemData.defense.melee.value  = meleeVal;
    systemData.defense.ranged.value = rangedVal;
    systemData.defense.mind.value   = mindVal;
    systemData.defense.soul.value   = soulVal;

    // Store enraged damage bonus for use in roll formulas.
    systemData.enragedDamageBonus = meleeRangedPctReduction > 0
      ? Math.min(20, meleeRangedPctReduction) / 100
      : 0;

    // Defense pools: max = 2× calculated value. Clamp current pool to max.
    for (const defKey of ['melee', 'ranged', 'mind', 'soul']) {
      systemData.defense[defKey].poolMax = systemData.defense[defKey].value * 2;
      if (systemData.defense[defKey].pool > systemData.defense[defKey].poolMax) {
        systemData.defense[defKey].pool = systemData.defense[defKey].poolMax;
      }
    }

    // Casting range (feet) and movement ranges (feet).
    systemData.castingRange = Math.round(40 + (systemData.abilities.perception.mod / 10));
    systemData.walkRange    = Math.round(35 + (systemData.abilities.endurance.mod / 10));
    systemData.sprintRange  = 2 * systemData.walkRange;

    // --- Carrying capacity ---
    // Per design-movement-modes.md (decision locked 2026-05-08): Str is the
    // carry stat. The flat +50 baseline and End's half-credit are gone;
    // proportional stamina-cost-by-encumbrance (token._preUpdateMovement)
    // handles the low-level "instantly overloaded" feel that +50 papered over.
    systemData.carryCapacity = Math.max(1, Math.round(systemData.abilities.strength.mod * 2.5));
    // SPATIAL STORAGE: contents of an EQUIPPED storage weigh nothing to the
    // carrier (design-spatial-storage.md). Equipped is load-bearing — an
    // unequipped ring is a ring, not a portal, and its contents come back onto
    // your back. It is also what stops nesting from laundering weight away.
    const equippedStorages = new Set();
    for (const item of this.items) {
      if ((item.system?.spatialCapacity ?? 0) > 0 && item.system?.equipped) equippedStorages.add(item.id);
    }
    systemData.spatialStorages = [];
    for (const item of this.items) {
      if ((item.system?.spatialCapacity ?? 0) <= 0) continue;
      let used = 0;
      for (const inner of this.items) {
        if (inner.system?.storedIn === item.id) {
          used += (inner.system.weight ?? 0) * (inner.system.quantity ?? 1);
        }
      }
      systemData.spatialStorages.push({
        id: item.id, name: item.name, equipped: !!item.system.equipped,
        capacity: item.system.spatialCapacity,
        used: Math.round(used * 10) / 10,
        free: Math.round((item.system.spatialCapacity - used) * 10) / 10,
        over: used > item.system.spatialCapacity,
      });
    }
    systemData.carryWeight = carriedWeightLb(
      this.items.map(i => ({
        id: i.id, weight: i.system?.weight ?? 0,
        quantity: i.system?.quantity ?? 1, storedIn: i.system?.storedIn ?? '',
      })), equippedStorages);
    systemData.encumbered = systemData.carryWeight > systemData.carryCapacity;

    // --- Augment-sourced flat bonuses from equipped items ---
    // damageBonus: sum across equipped weapons (typically just one wielded).
    //   Added to outgoing damage in item.mjs roll path. Also broken out per
    //   affinity (equippedDamageBonusByAffinity) by walking each item's
    //   augment snapshots so the damage handler can route augment damage
    //   through the target's per-affinity DR independently of base damage.
    // damageReduction.{physical,magical}: sum across all equipped items.
    //   Subtracted from incoming damage in the apply-damage handler.
    // damageReduction.affinities: per-affinity DR map { fire: 5, ... },
    //   summed across equipped items. Applied per-segment to incoming
    //   affinity-tagged damage.
    // Loadout filter mirrors equipment-AE logic so profession-loadout gear
    // doesn't double-bleed into combat math.
    let equippedDamageBonus = 0;
    let drPhysical = 0;
    let drMagical  = 0;
    const equippedDamageBonusByAffinity = {}; // { fire: 41, metal: 42, untyped: <rest> }
    const drAffinities = {};
    const addAffinityDmg = (name, v) => {
      const k = name || 'untyped';
      equippedDamageBonusByAffinity[k] = (equippedDamageBonusByAffinity[k] || 0) + v;
    };
    for (const item of this.items) {
      if (item.type !== 'item') continue;
      if (!item.system.equipped) continue;
      if (!_itemMatchesLoadout(item)) continue;
      const itemDmgBonus = Number(item.system.damageBonus ?? 0) || 0;
      equippedDamageBonus += itemDmgBonus;
      drPhysical += Number(item.system.damageReduction?.physical ?? 0) || 0;
      drMagical  += Number(item.system.damageReduction?.magical  ?? 0) || 0;

      // Per-affinity DR map from this item.
      const itemAffDR = item.system.damageReduction?.affinities ?? {};
      for (const [name, val] of Object.entries(itemAffDR)) {
        const n = Number(val) || 0;
        if (n === 0) continue;
        drAffinities[name] = (drAffinities[name] || 0) + n;
      }

      // Walk this item's augment snapshots and bucket each damageBonus
      // contribution by its affinity distribution. Snapshots store
      // `affinities: {name: weight}` — weights are RELATIVE; we normalize
      // here so `{fire:1, metal:1}` and `{fire:0.5, metal:0.5}` both yield
      // 50/50. Bonuses with empty affinities go to the 'untyped' bucket.
      const allSlots = [
        ...(item.system.augments     ?? []),
        ...(item.system.profAugments ?? []),
      ];
      for (const slot of allSlots) {
        if (!slot?.augmentId) continue;
        for (const ib of (slot.itemBonuses ?? [])) {
          if (ib.field !== 'damageBonus') continue;
          // Percentage-mode damageBonus augments are folded into item.damageBonus
          // by derive (multiplicative). Per-affinity routing only meaningful
          // for the flat slice — skip percent here.
          if (ib.mode === 'percentage') continue;
          const v = Number(ib.value) || 0;
          if (v === 0) continue;
          const aff = (ib.affinities && typeof ib.affinities === 'object') ? ib.affinities : {};
          const keys = Object.keys(aff);
          if (keys.length === 0) {
            // Legacy single-string fallback, then untyped.
            if (ib.affinity) addAffinityDmg(ib.affinity, v);
            else             addAffinityDmg('untyped', v);
            continue;
          }
          const total = keys.reduce((s, k) => s + (Number(aff[k]) || 0), 0);
          if (total <= 0) { addAffinityDmg('untyped', v); continue; }
          let assigned = 0;
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const w = Number(aff[k]) || 0;
            // Last key absorbs the rounding remainder so the parts sum to v.
            const part = (i === keys.length - 1)
              ? (v - assigned)
              : Math.round(v * (w / total));
            assigned += part;
            addAffinityDmg(k, part);
          }
        }
      }
    }
    systemData.equippedDamageBonus = equippedDamageBonus;
    systemData.equippedDamageBonusByAffinity = equippedDamageBonusByAffinity;
    systemData.damageReduction = { physical: drPhysical, magical: drMagical, affinities: drAffinities };

    // Continuous encumbrance ratio (0 = empty, 1 = at cap, >1 = over-cap).
    // No cliff: every pound matters. Drives the per-ft stamina multiplier
    // applied in token._preUpdateMovement.
    systemData.carryRatio = systemData.carryWeight / systemData.carryCapacity;

    // --- Movement multipliers from active effects ---
    // Aggregate every non-disabled effect's movement multipliers
    // (multiplicative composition). Stormstride / Haste boost speedMult
    // above 1 (faster); Slow / Chilled drop it below 1. Stamina mult > 1
    // means movement burns MORE stamina (debuff); < 1 = efficient (buff).
    // Read by celerity.computeMovementWait and the cost function in
    // canvas/token._getMovementCostFunction.
    let _moveSpeed = 1;
    let _moveStamina = 1;
    for (const effect of this.effects) {
      if (effect.disabled) continue;
      const sys = effect.system;
      const s = sys?.movementSpeedMultiplier ?? 1;
      const t = sys?.movementStaminaMultiplier ?? 1;
      if (s !== 1) _moveSpeed *= s;
      if (t !== 1) _moveStamina *= t;
    }
    systemData.movementSpeedMultiplier = _moveSpeed;
    systemData.movementStaminaMultiplier = _moveStamina;

    // --- Weapon buff aggregation (Flameblade etc. — design-spellstriker.md) ---
    // Active (non-disabled) effects carrying weaponBuffDamage add a flat,
    // affinity-typed bonus to the actor's WEAPON strikes (applied in the item
    // strike path — NOT to spells, unlike equippedDamageBonus). Summed across
    // stacked buffs; affinities unioned so the bonus routes through each
    // affinity's DR in the per-affinity damage breakdown.
    let _weaponBuffDamage = 0;
    const _weaponBuffAffinities = new Set();
    for (const effect of this.effects) {
      if (effect.disabled) continue;
      const wb = Number(effect.system?.weaponBuffDamage ?? 0) || 0;
      if (wb <= 0) continue;
      _weaponBuffDamage += wb;
      for (const a of (effect.system?.weaponBuffAffinities ?? [])) _weaponBuffAffinities.add(a);
    }
    systemData.weaponStrikeBuff = { damage: _weaponBuffDamage, affinities: [..._weaponBuffAffinities] };

    // --- Barrier: aggregate from ActiveEffects ---
    // Find the active barrier effect and populate system.barrier for the sheet.
    if (systemData.barrier) {
      const barrierEffect = this.effects.find(e =>
        !e.disabled && e.system?.effectType === 'barrier'
      );
      if (barrierEffect) {
        const bd = barrierEffect.system?.barrierData ?? {};
        systemData.barrier.value = bd.value ?? 0;
        systemData.barrier.max = bd.max ?? 0;
        systemData.barrier.affinities = bd.affinities ?? [];
        systemData.barrier.source = bd.source ?? '';
      } else {
        systemData.barrier.value = 0;
        systemData.barrier.max = 0;
        systemData.barrier.affinities = [];
        systemData.barrier.source = '';
      }
    }

    // ── Passive Tag Bonuses ──
    // 'armored' tag adds flat armor. 'ethereal' tag adds flat veil.
    const armoredValue = systemData.collectedTags?.get('armored')?.value ?? 0;
    if (armoredValue > 0) systemData.defense.armor.value += armoredValue;
    const etherealValue = systemData.collectedTags?.get('ethereal')?.value ?? 0;
    if (etherealValue > 0) systemData.defense.veil.value += etherealValue;

    // Make separate methods for each Actor type (character, npc, etc.) to keep
    // things organized.
    this._prepareCharacterData(actorData);
    this._prepareNpcData(actorData);

  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== 'character') return;

    // Make modifications to data here. For example:
    const systemData = actorData.system; 


    // Loop through ability scores, and add their modifiers to our sheet output.


  }

  /**
   * Prepare NPC type specific data.
   */
  _prepareNpcData(actorData) {
    if (actorData.type !== 'npc') return;

    // Make modifications to data here. For example:
    const systemData = actorData.system;
    systemData.xp = systemData.cr * systemData.cr * 100;
  }

  /* -------------------------------------------- */
  /*  Tag System                                  */
  /* -------------------------------------------- */

  /**
   * Collect system tags from all sources into a unified map.
   * Sources: cached tags from race/class/profession templates + equipped items.
   * Expands composite tags via `implies`.
   * Result stored as systemData.collectedTags = Map<tagId, { sources: string[], value: number, category: string }>
   */
  _collectTags(systemData) {
    const registry = CONFIG.ASPECTSOFPOWER?.tagRegistry ?? {};
    const collected = new Map();

    const addTag = (tagId, value, source) => {
      const def = registry[tagId];
      if (!def) return;

      if (collected.has(tagId)) {
        const existing = collected.get(tagId);
        // Resistances: values are additive.
        if (def.category === 'resistance') existing.value += value;
        existing.sources.push(source);
      } else {
        collected.set(tagId, {
          category: def.category,
          value: value || 0,
          sources: [source],
        });
      }

      // Expand implied tags recursively.
      for (const implied of (def.implies ?? [])) {
        addTag(implied, 0, `${source} (${tagId})`);
      }
    };

    // Collect from race/class/profession cached tags.
    // cachedTags entries are objects {id, value} for backward compat with the
    // pre-merge schema; iterate by id and ignore value (no current tag uses it).
    if (systemData.attributes) {
      for (const type of ['race', 'class', 'profession']) {
        const attr = systemData.attributes[type];
        if (!attr?.cachedTags) continue;
        for (const tag of attr.cachedTags) {
          const id = typeof tag === 'string' ? tag : tag?.id;
          if (id) addTag(id, 0, `${type}: ${attr.name}`);
        }
      }
    }

    // Collect from actor-level tags — direct grants (senses, boons, creature
    // traits) authored on the actor itself (design-power-sense, 2026-07-14).
    // The only direct source NPCs have (no cachedTags/class/profession).
    for (const tagId of (systemData.tags ?? [])) {
      if (tagId) addTag(tagId, 0, 'actor');
    }

    // Collect from equipped items — read the unified `tags` array.
    for (const item of this.items) {
      if (item.type !== 'item' || !item.system.equipped) continue;
      for (const tagId of (item.system.tags ?? [])) {
        if (tagId) addTag(tagId, 0, `equip: ${item.name}`);
      }
    }

    systemData.collectedTags = collected;
  }

  /**
   * Check if this actor has a specific tag.
   * @param {string} tagId
   * @returns {boolean}
   */
  hasTag(tagId) {
    return this.system.collectedTags?.has(tagId) ?? false;
  }

  /**
   * Get the numeric value for a tag (resistances are additive).
   * @param {string} tagId
   * @returns {number}
   */
  getTagValue(tagId) {
    return this.system.collectedTags?.get(tagId)?.value ?? 0;
  }

  /**
   * Get all tags of a specific category.
   * @param {string} category  'affinity' | 'immunity' | 'resistance' | 'gate' | 'passive'
   * @returns {Map<string, object>}
   */
  getTagsByCategory(category) {
    const result = new Map();
    for (const [id, data] of (this.system.collectedTags ?? new Map())) {
      if (data.category === category) result.set(id, data);
    }
    return result;
  }

  /**
   * Check if the actor is immune to a specific debuff type.
   * @param {string} debuffType  e.g., 'stun', 'poison', 'charm'
   * @returns {boolean}
   */
  isImmuneTo(debuffType) {
    return this.hasTag(`${debuffType}-immune`);
  }

  /**
   * Set of magic-implement tags carried by any currently-equipped weaponry-slot
   * item. Used by the spell pillar (Staff +baseMana free invest on big casts)
   * and celerity (Wand −23% wait on Basic, Orb spell-charge). Empty set if no
   * implement equipped.
   *
   * Restricted to the weaponry slot — a ring or other gear tagged with an
   * implement tag (e.g. via an Augment that grants 'wand') would NOT light up
   * the implement bonus unless equipped on weaponry. This matches the design
   * intent that implements are wielded weapons, not arbitrary worn items.
   *
   * @returns {Set<string>}  Implement tags found ('wand', 'staff', 'orb', etc.)
   */
  getEquippedImplements() {
    const known = new Set(['wand', 'staff', 'orb', 'tome', 'weave', 'doll']);
    const found = new Set();
    for (const item of this.items) {
      if (item.type !== 'item') continue;
      if (!item.system?.equipped) continue;
      if ((item.system?.slot ?? '') !== 'weaponry') continue;
      const tags = item.system?.tags ?? [];
      for (const t of tags) if (known.has(t)) found.add(t);
    }
    return found;
  }

  /**
   * Sum craft bonuses from augments slotted in equipped profession gear.
   * @param {string} [element]  Material/output element. Bonuses with a matching
   *                            affinity (or no affinity) are included.
   * @returns {Object} Map of bonus type → total value (e.g., { craftProgress: 50, d100Bonus: 10 })
   */
  getProfessionAugmentBonuses(element = '') {
    const totals = {};
    // Profession augments only apply when actor is in profession loadout.
    if ((this.system.activeLoadout || 'combat') !== 'profession') return totals;
    for (const item of this.items) {
      if (item.type !== 'item') continue;
      if (!item.system.equipped) continue;
      // Item must be slottable in a profession slot (primary or additional).
      const allSlots = [item.system.slot, ...(item.system.additionalSlots ?? [])].filter(Boolean);
      if (!allSlots.some(s => s.startsWith('prof'))) continue;
      // Read SNAPSHOT data directly from each slot entry — no compendium
      // lookup needed (race-free). Both combat slots (augments[]) and prof
      // slots (profAugments[]) can carry craftBonuses on hybrid augs.
      // Dedupe by augmentId — multi-slot augments occupy multiple entries
      // with the same id, but bonuses should apply once per augment.
      const allEntries = [...(item.system.augments ?? []), ...(item.system.profAugments ?? [])]
        .filter(e => e?.augmentId);
      const seenIds = new Set();
      for (const entry of allEntries) {
        if (seenIds.has(entry.augmentId)) continue;
        seenIds.add(entry.augmentId);
        for (const bonus of entry.craftBonuses ?? []) {
          // Affinity filter: bonus only applies if no affinity set OR matches element.
          if (bonus.affinity && bonus.affinity !== element) continue;
          totals[bonus.type] = (totals[bonus.type] || 0) + (bonus.value || 0);
        }
      }
    }
    // Skill-sourced craft modifiers (passive). Any skill the actor possesses
    // that carries `system.craftBonuses` contributes the same way an augment
    // would. Used for "specialization" passives like Jewelcutting
    // Specialization (+10 d100 on craft). No equip / loadout-slot check;
    // already gated on the actor being in profession loadout above.
    for (const skill of this.items) {
      if (skill.type !== 'skill') continue;
      for (const bonus of skill.system?.craftBonuses ?? []) {
        if (bonus.affinity && bonus.affinity !== element) continue;
        totals[bonus.type] = (totals[bonus.type] || 0) + (bonus.value || 0);
      }
    }
    return totals;
  }

  /**
   * Get flat resistance value for a type.
   * @param {string} type  e.g., 'fire', 'stun'
   * @returns {number}
   */
  getResistance(type) {
    return this.getTagValue(`${type}-resist`);
  }

  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    // Starts off by populating the roll data with the full source data.
    const data = this.system.toObject();

    // Prepare character roll data.
    this._getCharacterRollData(data);
    this._getNpcRollData(data);

    return data;
  }

  /**
   * Prepare character roll data.
   */
  _getCharacterRollData(data) {
    if (this.type !== 'character') return;

    // Copy the ability scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (data.abilities) {
      for (let [k, v] of Object.entries(data.abilities)) {
        // ability.mod is derived in prepareDerivedData() and lives only on the
        // live system instance — toObject() strips it. Restore it here.
        v.mod = this.system.abilities[k]?.mod ?? 0;
        data[k] = foundry.utils.deepClone(v);
      }
    }

    // Add level for easier access, or fall back to 0.
    if (data.attributes?.level) {
      data.lvl = data.attributes.level.value ?? 0;
    }
  }

  /**
   * Prepare NPC roll data.
   */
  _getNpcRollData(data) {
    if (this.type !== 'npc') return;

    // Restore derived ability mods (same as characters — toObject() strips them).
    if (data.abilities) {
      for (let [k, v] of Object.entries(data.abilities)) {
        v.mod = this.system.abilities[k]?.mod ?? 0;
        data[k] = foundry.utils.deepClone(v);
      }
    }
  }

  /* -------------------------------------------- */
  /*  Turn Lifecycle                              */
  /* -------------------------------------------- */

  /**
   * Called at the start of this actor's combat turn.
   * Consolidates stamina regen, overhealth decay, defense pool reset,
   * debuff break rolls, and turn-skip announcements.
   * @param {Combat} combat
   * @param {object} context  { combatantId }
   */
  async onStartTurn(combat, context) {
    const systemData = this.system;
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const _isPC = game.users.some(u => !u.isGM && u.active && u.character?.id === this.id);
    const gmWhisper = _isPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
    const updateData = {};

    // ── Aura tick (per design-movement-skills.md Phase B) ──
    // Fires BEFORE expiry so a duration-N buff ticks exactly N times.
    // Iterates non-disabled effects with auraRadius > 0; for each, finds
    // tokens within radius on the same scene, filters by disposition, and
    // posts an apply-damage chat button per target.
    await this._tickActorAuras(speaker, gmWhisper);

    // ── 0. Duration countdown — WORK OUT what expires, but do not delete yet.
    // The actual deletion happens after the per-round ticks below, so a
    // duration-N effect ticks exactly N times (the same reason the aura tick
    // above runs first). Deleting here would rob the last tick.
    const toExpire = [];
    const toDecrement = [];
    for (const effect of this.effects) {
      // Only round-based durations are ours to count. Seconds-based ones
      // belong to world time, and untimed effects run until dispelled.
      const units = effect.duration?.units ?? effect._source?.duration?.units ?? '';
      if (units && units !== 'rounds') continue;
      const stored = effect.system?.roundsRemaining;
      const authored = Number(effect.duration?.value
        ?? effect._source?.duration?.value ?? 0);
      const remaining = (stored === null || stored === undefined) ? authored : stored;
      if (!(remaining > 0)) continue;
      if (remaining - 1 <= 0) toExpire.push(effect);
      else toDecrement.push({ effect, next: remaining - 1 });
    }

    // ── 0.5. Sustain Upkeep ──
    // Deduct upkeep cost from each active sustain; end sustain if resource insufficient.
    const sustainEffects = this.effects.filter(e =>
      !e.disabled && e.system?.effectType === 'sustain'
    );
    for (const sustainFx of sustainEffects) {
      // Defensive: another branch (effect expiry, multiple round-end calls
      // in one advance, etc.) may have deleted this effect already.
      if (!this.effects.has(sustainFx.id)) continue;
      const costAmt = sustainFx.system?.sustainCost ?? 0;
      const resKey  = sustainFx.system?.sustainResource ?? 'mana';
      const current = systemData[resKey]?.value ?? 0;
      if (current < costAmt) {
        // Insufficient resource — end the sustain.
        await sustainFx.delete();
        ChatMessage.create({
          speaker, ...gmWhisper,
          content: `<p><strong>${this.name}</strong>'s <strong>${sustainFx.name}</strong> ends — insufficient ${resKey}.</p>`,
        });
      } else if (costAmt > 0) {
        const newVal = current - costAmt;
        updateData[`system.${resKey}.value`] = newVal;
        ChatMessage.create({
          speaker, ...gmWhisper,
          content: `<p><em>${this.name} sustains ${sustainFx.name} (−${costAmt} ${resKey}).</em></p>`,
        });
      }
    }

    // ── 0.6. Heal over time ──
    // Ticks at the RECIPIENT's turn start, unlike DoTs which are applied from
    // a chat card: a heal has no mitigation, affinity or defence check to
    // resolve, so there is nothing for a human to arbitrate.
    // ⚠ Reads any pending value from `updateData` rather than the live pool —
    // sustain upkeep above may already have spent from the same resource this
    // tick, and two writes to one key would silently drop the first.
    for (const fx of this.effects) {
      if (fx.disabled || !fx.system?.hot) continue;
      const amt = Math.round(fx.system.hotAmount ?? 0);
      if (amt <= 0) continue;
      const resKey = fx.system.hotResource || 'health';
      const pool = systemData[resKey];
      if (!pool) continue;
      const cur = updateData[`system.${resKey}.value`] ?? pool.value;
      const next = Math.min(pool.max, cur + amt);
      const gained = next - cur;
      if (gained <= 0) continue;
      updateData[`system.${resKey}.value`] = next;
      ChatMessage.create({
        speaker, ...gmWhisper,
        content: `<p><em>${this.name} — <strong>${fx.name}</strong> restores `
               + `<strong>${gained}</strong> ${resKey}. (${next} / ${pool.max})</em></p>`,
      });
    }

    // ── 0.7. Commit the duration countdown ──
    // AFTER the aura and HoT ticks, so an effect delivers its full N rounds.
    for (const { effect, next } of toDecrement) {
      try { await effect.update({ 'system.roundsRemaining': next }); } catch { /* deleted */ }
    }
    if (toExpire.length > 0) {
      const names = toExpire.map(e => e.name).filter(Boolean);
      // Filter to effects that still exist - a sustain drop or a barrier break
      // earlier in this same handler may already have removed one.
      const ids = toExpire.map(e => e.id).filter(id => this.effects.has(id));
      if (ids.length > 0) {
        await this.deleteEmbeddedDocuments('ActiveEffect', ids);
        ChatMessage.create({
          whisper: ChatMessage.getWhisperRecipients('GM'),
          content: `<p>Expired effects on <strong>${this.name}</strong>: ${names.join(', ')}</p>`,
        });
      }
    }

    // ── 1. Stamina Regeneration ──
    const stamina = systemData.stamina;
    const regenPct = systemData.staminaRegen ?? 5;
    const regenAmt = Math.floor(stamina.max * (regenPct / 100));
    // Respect any pending stamina change from sustain upkeep above.
    const staminaBase = updateData['system.stamina.value'] ?? stamina.value;
    if (staminaBase < stamina.max) {
      const newStamina = Math.min(stamina.max, staminaBase + regenAmt);
      const gained = newStamina - staminaBase;
      updateData['system.stamina.value'] = newStamina;
      if (gained > 0) {
        ChatMessage.create({
          speaker, ...gmWhisper,
          content: `<p><em>${this.name} regenerates ${gained} stamina (${regenPct}% of ${stamina.max}).</em></p>`,
        });
      }
    }

    // ── 2. Overhealth Decay ──
    const oh = systemData.overhealth;
    if (oh?.value > 0) {
      const decayPct = oh.decayRate ?? 10;
      if (decayPct > 0) {
        let decayAmt = Math.ceil(oh.value * (decayPct / 100));
        for (const effect of this.effects) {
          if (effect.disabled) continue;
          const reduction = effect.system?.overhealthDecayReduction ?? 0;
          if (reduction > 0) decayAmt = Math.max(0, decayAmt - reduction);
        }
        if (decayAmt > 0) {
          const newOh = Math.max(0, oh.value - decayAmt);
          updateData['system.overhealth.value'] = newOh;
          const owner = game.users.find(u => !u.isGM && u.active && u.character?.id === this.id);
          const ohWhisper = owner
            ? [owner.id, ...ChatMessage.getWhisperRecipients('GM').map(u => u.id)]
            : ChatMessage.getWhisperRecipients('GM');
          ChatMessage.create({
            speaker, whisper: ohWhisper,
            content: `<p><em>${this.name}'s overhealth decays by ${decayAmt} (${decayPct}%). `
                   + `Overhealth: ${newOh} / ${oh.cap ?? '?'}</em></p>`,
          });
        }
      }
    }

    // ── 3. Defense Pool Reset + Sleep Mechanics ──
    // Active defense (2026-06-12): physical pools (melee/ranged) are GONE —
    // physical defense is dodge/parry/bulk, resolved per-attack with no
    // per-round resource. Only the mental lanes (mind/soul) keep ablative
    // pools, reset each personal round, with sleep drain on mind.
    const sleepEffects = this.effects.filter(e =>
      !e.disabled && e.system?.debuffType === 'sleep'
    );
    const sleepDrain = sleepEffects.reduce((sum, e) =>
      sum + (e.system?.debuffDamage ?? 0), 0);

    for (const defKey of ['mind', 'soul']) {
      const poolMax = systemData.defense[defKey]?.poolMax ?? 0;
      let targetPool = poolMax;

      if (defKey === 'mind' && sleepDrain > 0) {
        const currentPool = systemData.defense.mind?.pool ?? 0;
        const normalRestoration = poolMax - currentPool;
        const reducedRestoration = Math.max(0, normalRestoration - sleepDrain);
        targetPool = currentPool + reducedRestoration;

        if (targetPool <= 0) {
          targetPool = 0;
          for (const se of sleepEffects) {
            if (!this.effects.has(se.id)) continue;
            if (!se.system?.sleepActive) {
              await se.update({ 'system.sleepActive': true });
              ChatMessage.create({
                speaker, ...gmWhisper,
                content: `<p><strong>${this.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.fellAsleep')}</p>`,
              });
            }
          }
        } else {
          for (const se of sleepEffects) {
            if (!this.effects.has(se.id)) continue;
            if (se.system?.sleepActive && targetPool >= (se.system?.debuffDamage ?? 0)) {
              await se.delete();
              ChatMessage.create({
                speaker, ...gmWhisper,
                content: `<p><strong>${this.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.wokeUp')}</p>`,
              });
            }
          }
        }
      }

      if ((systemData.defense[defKey]?.pool ?? 0) !== targetPool) {
        updateData[`system.defense.${defKey}.pool`] = targetPool;
      }
    }

    // Reset reactions + tick down per-skill reaction cooldowns.
    // Same per-actor-round signal that already refreshes the budget.
    const reactions = systemData.reactions;
    if (reactions && reactions.value !== reactions.max) {
      updateData['system.reactions.value'] = reactions.max;
    }

    // Reaction cooldowns. Entries map skillId → roundsRemaining (set at
    // fire time to skill.reactionCooldown). At each onStartTurn we
    // decrement; entries that hit 0 (or below) get pruned via
    // ForcedDeletion (Foundry merges nested flag updates by default).
    const cooldowns = this.flags?.aspectsofpower?.reactionCooldowns ?? {};
    const FD = foundry.data?.operators?.ForcedDeletion;
    for (const [skillId, remaining] of Object.entries(cooldowns)) {
      const next = (remaining ?? 0) - 1;
      // ForcedDeletion needs an INSTANCE (`new FD()`), not the class —
      // verified empirically 2026-05-16; see reference_foundry_quirks #11.
      if (next <= 0) {
        updateData[`flags.aspectsofpower.reactionCooldowns.${skillId}`] = FD ? new FD() : null;
      } else {
        updateData[`flags.aspectsofpower.reactionCooldowns.${skillId}`] = next;
      }
    }

    // ── 4. Debuff Break Rolls ──
    // Per-debuff break-stat table now lives at CONFIG.ASPECTSOFPOWER.debuffBreakStats
    // (shared with the manual break-free flow). Auto-attempt each round.
    // roundsAfflicted increments here (before the roll), so the round-0 attempt
    // happens at 1× yield and subsequent rounds escalate. Caster must re-apply
    // to reset the counter and keep the target on the slow grind.
    const TURN_SKIP_DEBUFFS = ['stun', 'paralysis', 'sleep', 'immobilized'];

    const typedDebuffs = this.effects.filter(e =>
      !e.disabled && e.system?.debuffType && e.system.debuffType !== 'none'
    );

    for (const effect of typedDebuffs) {
      // Defensive: snapshot may include effects deleted by the sleep
      // wake branch above (sleep is also a debuff type). Skip if gone.
      if (!this.effects.has(effect.id)) continue;
      const debuffType = effect.system?.debuffType;
      const typeName = game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffType] ?? debuffType);

      // Increment counter BEFORE the auto-break attempt. The auto-roll at
      // round N benefits from N rounds of accumulated struggle.
      const prevRounds = effect.system?.roundsAfflicted ?? 0;
      await effect.update({ 'system.roundsAfflicted': prevRounds + 1 });

      await this._attemptBreakRoll(effect, { whisper: !_isPC });

      if (TURN_SKIP_DEBUFFS.includes(debuffType) && this.effects.has(effect.id)) {
        ChatMessage.create({
          speaker, ...gmWhisper,
          content: `<p><strong>${this.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotAct')} (${typeName})</p>`,
        });
      }
    }

    // ── 5. Apply batched updates ──
    if (Object.keys(updateData).length > 0) {
      await this.update(updateData);
    }
  }

  /**
   * Roll a single break attempt against one debuff effect. Shared between
   * the per-round auto-break loop (`onStartTurn`) and the manual break-free
   * flow (player declares on the celerity stack; tracker fires this on
   * schedule). Mutates the effect on progress; deletes it on success.
   *
   * @param {ActiveEffect} effect  The debuff to roll against.
   * @param {object}  [opts]
   * @param {boolean} [opts.whisper=false]  Whisper chat output to GM only.
   * @returns {Promise<{broken:boolean, statMod:number, newProgress:number, breakThreshold:number}|null>}
   *   null if the debuff type isn't breakable; otherwise the result of the attempt.
   */
  async _attemptBreakRoll(effect, { whisper = false } = {}) {
    if (!effect) return null;
    const sys = effect.system ?? {};
    const debuffType = sys.debuffType;
    const breakStat = CONFIG.ASPECTSOFPOWER.debuffBreakStats?.[debuffType];
    if (!breakStat) return null;

    const statMod = this.system.abilities?.[breakStat]?.mod ?? 0;
    const breakLabel = game.i18n.localize(`ASPECTSOFPOWER.Ability.${breakStat}.long`);
    const breakThreshold = sys.debuffDamage ?? 0;
    const typeName = game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffType] ?? debuffType);

    const breakRoll = new Roll('(1d20 / 100) * @mod + @mod', { mod: statMod });
    await breakRoll.evaluate();
    // Yield scales with rounds afflicted (linear growth). Re-applying a
    // non-stackable debuff resets roundsAfflicted to 0, putting the target
    // back on the slow grind. Per design 2026-05-12.
    const rounds = sys.roundsAfflicted ?? 0;
    const yieldPerRound = CONFIG.ASPECTSOFPOWER.celerity?.BREAK_FREE_YIELD_PER_ROUND ?? 0.25;
    const yieldMult = 1 + (rounds * yieldPerRound);
    const yieldedProgress = breakRoll.total * yieldMult;
    const previousProgress = sys.breakProgress ?? 0;
    const newProgress = previousProgress + yieldedProgress;

    const speaker = ChatMessage.getSpeaker({ actor: this });
    const msgOpts = whisper ? { whisper: ChatMessage.getWhisperRecipients('GM') } : {};
    const broken = newProgress >= breakThreshold;

    if (broken) {
      await effect.delete();
    } else {
      await effect.update({ 'system.breakProgress': newProgress });
    }
    const momentumNote = yieldMult > 1
      ? ` ×${yieldMult.toFixed(2)} momentum (round ${rounds})`
      : '';
    await breakRoll.toMessage({
      speaker, ...msgOpts,
      flavor: `${typeName} — ${game.i18n.localize('ASPECTSOFPOWER.Debuff.breakRoll')} (${breakLabel}) [${Math.round(newProgress)} / ${breakThreshold}]${momentumNote}`,
    });
    ChatMessage.create({
      speaker, ...msgOpts,
      content: broken
        ? `<p><strong>${this.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.broke')} <strong>${typeName}</strong>!</p>`
        : `<p><strong>${this.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.failedBreak')} <strong>${typeName}</strong>.</p>`,
    });

    return { broken, statMod, newProgress, breakThreshold };
  }

  /**
   * Aura-tick loop. Iterates non-disabled effects with auraRadius > 0,
   * finds tokens within radius, filters by disposition per auraTargeting,
   * and dispatches by auraEffectType. Per design-movement-skills.md Phase B.
   *
   * Cadence: called from onStartTurn each round (after-cadence tick) AND
   * from the movement-hook entry trigger (per-token entry tick). The entry
   * trigger calls _applyAuraToTarget directly for one target rather than
   * iterating the whole scene.
   */
  async _tickActorAuras(speaker, gmWhisper) {
    const auraEffects = this.effects.filter(e =>
      !e.disabled && (e.system?.auraRadius ?? 0) > 0
    );
    if (auraEffects.length === 0) return;
    const token = this.getActiveTokens()[0];
    if (!token) return;
    const scene = token.document?.parent;
    if (!scene || !canvas.scene || scene.id !== canvas.scene.id) return;

    const gridDist = canvas.grid.distance;
    const gridSize = canvas.grid.size;
    const pxPerFt = gridSize / gridDist;
    const myDisp = token.document.disposition;

    // ⚠ CENTRE FROM THE DOCUMENT, NOT THE PLACEABLE. `token.center` is the
    // ANIMATED position and lags during movement, so a token read right after
    // being repositioned reports where it USED to be — which made a token 60 ft
    // away test as in-range, twice. Same fix already applied to
    // `meditationAuraBonusFor`; this path still had the old form.
    // It also fixes a second bug: the target loop read `otherDoc.object`, which
    // is null for any token not currently drawn, so unrendered tokens silently
    // received no aura at all.
    const centreOf = (doc) => ({
      x: doc.x + (doc.width * gridSize) / 2,
      y: doc.y + (doc.height * gridSize) / 2,
    });
    const myCenter = centreOf(token.document);

    for (const effect of auraEffects) {
      const sys = effect.system;
      const amount = sys.auraAmount ?? sys.auraDamage ?? 0;
      if (amount <= 0) continue;
      const radiusPx = (sys.auraRadius ?? 0) * pxPerFt;
      const targeting = sys.auraTargeting ?? 'enemies';
      // A SUPPORTIVE aura includes the person carrying it (user ruled
      // 2026-08-03) — a chanter standing in their own regen hymn should be
      // sustained by it, not be a battery for everyone else. A DAMAGE aura
      // still skips self for the obvious reason.
      const effectType = sys.auraEffectType ?? 'damage';
      const includeSelf = effectType === 'heal' || effectType === 'stam';

      for (const otherDoc of scene.tokens) {
        const isSelf = otherDoc.id === token.document.id;
        if (isSelf && !includeSelf) continue;
        const otherCentre = centreOf(otherDoc);
        const dist = Math.hypot(otherCentre.x - myCenter.x, otherCentre.y - myCenter.y);
        // ⚠ Guard NaN explicitly. `NaN > radiusPx` is FALSE, so a malformed
        // position would PASS the range check rather than fail it — the aura
        // would silently apply at any distance.
        if (!Number.isFinite(dist) || dist > radiusPx) continue;

        // Self is always a valid recipient of one's own supportive aura, even
        // when the targeting mode is written for other people.
        if (!isSelf && !_passesAuraTargetingFilter(myDisp, otherDoc.disposition, targeting)) continue;
        const targetActor = otherDoc.actor;
        if (!targetActor) continue;

        await this._applyAuraToTarget(effect, targetActor, speaker, gmWhisper);
      }
    }
  }

  /**
   * Apply one aura's effect to one target. Dispatches by auraEffectType:
   *   'damage' → apply-damage chat button (GM-confirmed)
   *   'heal'   → gmApplyRestoration (auto-applied)
   *   'stam'   → gmApplyRestoration with stamina (auto-applied)
   *
   * Called by both the round-start tick (_tickActorAuras) and the
   * movement-hook entry trigger.
   */
  async _applyAuraToTarget(effect, targetActor, speaker, gmWhisper = {}) {
    const sys = effect.system;
    const amount = sys.auraAmount ?? sys.auraDamage ?? 0;
    if (amount <= 0) return;
    const effectType = sys.auraEffectType ?? 'damage';

    if (effectType === 'damage') {
      const dmgType = sys.auraDamageType ?? 'physical';
      // Armor-answer routing (2026-07-16): veil only for mind/soul auras;
      // physical AND elemental aura damage face armor.
      const auraMitLane = (dmgType === 'mind' || dmgType === 'soul') ? 'veil' : 'armor';
      ChatMessage.create({
        speaker, ...gmWhisper,
        content: `<p><strong>${targetActor.name}</strong> caught in <em>${effect.name}</em> aura — `
               + `<strong>${amount}</strong> ${dmgType} damage.</p>`
               + `<button class="apply-damage" data-actor-uuid="${targetActor.uuid}" `
               + `data-damage="${amount}" data-toughness="${targetActor.system.defense?.dr?.value ?? 0}" `
               + `data-damage-type="${dmgType}" data-affinity-dr="0" data-mitigation="${auraMitLane}" `
               + `data-bypass-pool="true">Apply Damage</button>`,
      });
      return;
    }

    if (effectType === 'heal' || effectType === 'stam') {
      const resource = effectType === 'stam'
        ? 'stamina'
        : (sys.auraHealResource ?? 'health');
      const overhealth = (effectType === 'heal') ? (sys.auraHealOverhealth ?? false) : false;
      // Route through the same gmAction the restoration tag uses so
      // affinity / resource caps / overhealth overflow all apply correctly.
      await CONFIG.Item.documentClass.executeGmAction({
        type: 'gmApplyRestoration',
        targetActorUuid: targetActor.uuid,
        amount,
        resource,
        overhealth,
        speaker,
      });
      return;
    }
  }

  /**
   * Called at the end of this actor's combat turn.
   * Handles AOE region expiry.
   * @param {Combat} combat
   * @param {object} context  { combatantId }
   */
  async onEndTurn(combat, context) {
    // AOE region expiry is handled by a separate hook since it's scene-level, not actor-level.
  }

  /**
   * Demote each stored skill on this actor by N rarity tiers (floor at the
   * bottom of `skillRarityOrder`, currently `not_proficient`). Per
   * design-skill-rarity-system.md: fires on character grade-up E→D and
   * beyond. Each stored skill version demotes independently.
   *
   * @param {number} tiers  Number of tiers to demote (typically 1, but
   *   level jumps can cross multiple grade boundaries).
   * @returns {Promise<number>}  Count of skill items actually updated.
   */
  async demoteSkillsByTiers(tiers) {
    if (!Number.isInteger(tiers) || tiers <= 0) return 0;
    const order = CONFIG.ASPECTSOFPOWER.skillRarityOrder || [];
    if (order.length === 0) return 0;
    const updates = [];
    for (const item of this.items) {
      if (item.type !== 'skill') continue;
      const currentRarity = item.system.rarity || 'common';
      const currentIdx = order.indexOf(currentRarity);
      if (currentIdx <= 0) continue; // already at floor or rarity not in registry
      const newIdx = Math.max(0, currentIdx - tiers);
      if (newIdx === currentIdx) continue;
      updates.push({ _id: item.id, 'system.rarity': order[newIdx] });
    }
    if (updates.length > 0) {
      await this.updateEmbeddedDocuments('Item', updates);
    }
    return updates.length;
  }
}
