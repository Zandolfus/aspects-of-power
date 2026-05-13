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

    // Skip core's default mergeObject-based application — we process all
    // effect changes manually in prepareDerivedData using our own contribution
    // breakdown (equipment caps, blessing multipliers, titles, etc.).
    // Core's default would crash on our leaf-value change keys (e.g.
    // system.abilities.strength.value) because v14 deserializes values as
    // primitives and mergeObject expects objects.
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
    const calcMod = (value) => {
      return Math.round(Math.pow(value / sc.NORM, sc.P) * sc.NORM * _gradeMult);
    };

    // --- Stat breakdown: classify effect contributions by source ---
    // Titles are additive to base; blessings MULTIPLY (base + titles).
    const abilityKeys = Object.keys(systemData.abilities);
    const contributions = {};
    for (const key of abilityKeys) {
      contributions[key] = { equipment: 0, blessingAdd: 0, blessingMultiplier: 1, title: 0, other: 0 };
    }
    // Active loadout determines which equipment effects apply.
    // 'combat' loadout: only items in combat slots contribute.
    // 'profession' loadout: only items in profession slots contribute.
    const activeLoadout = systemData.activeLoadout || 'combat';
    const slotConfig = CONFIG.ASPECTSOFPOWER.equipmentSlots ?? {};

    // Helper: does an item belong to the active loadout?
    // Checks primary slot AND any additional slots — if any matches the loadout, it applies.
    const _itemMatchesLoadout = (item) => {
      if (!item) return true; // no source item: always apply (legacy effects)
      const allSlots = [item.system.slot, ...(item.system.additionalSlots ?? [])].filter(Boolean);
      return allSlots.some(slotKey => {
        const slotSet = slotConfig[slotKey]?.set ?? 'combat';
        // 'both' (e.g. jewelry) is always active regardless of loadout.
        return slotSet === 'both' || slotSet === activeLoadout;
      });
    };

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
        else if (e.system?.effectCategory === 'title')    contributions[k].title += val;
        else                                               contributions[k].other += val;
      }
    }

    // Per-ability breakdown: base → +titles → ×blessings → +equipment → +other.
    for (const [key, ability] of Object.entries(systemData.abilities)) {
      const base = Math.round(this._source.system.abilities[key].value ?? 0);
      const c = contributions[key];
      const afterTitles = base + c.title;
      const calculated = Math.round(afterTitles * c.blessingMultiplier) + Math.round(c.blessingAdd);
      const effectBonus = Math.round(c.other);
      ability.breakdown = {
        base,
        titleBonus: Math.round(c.title),
        blessingMultiplier: c.blessingMultiplier,
        blessingAdd: Math.round(c.blessingAdd),
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

    // --- Resource maxima ---
    systemData.health.max = Math.round(systemData.abilities.vitality.mod * 1.25 * sizeMultipliers.hp);
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
    let allDefensePctReduction = 0; // Slow: % reduction to all defenses
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
        // Slow: NYI — will reduce all defenses by a calculated amount.
        // case 'slow':
        //   allDefensePctReduction += Math.max(0, roll - (systemData.abilities.endurance.mod ?? 0));
        //   break;
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

    // Base defense calculations.
    let meleeVal  = Math.round((effectiveDex + strMod * 0.3) * 1.1) + effectBonus('system.defense.melee.value');
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
    systemData.carryWeight = 0;
    for (const item of this.items) {
      systemData.carryWeight += (item.system.weight ?? 0) * (item.system.quantity ?? 1);
    }
    systemData.carryWeight = Math.round(systemData.carryWeight * 10) / 10;
    systemData.encumbered = systemData.carryWeight > systemData.carryCapacity;
    // Continuous encumbrance ratio (0 = empty, 1 = at cap, >1 = over-cap).
    // No cliff: every pound matters. Drives the per-ft stamina multiplier
    // applied in token._preUpdateMovement.
    systemData.carryRatio = systemData.carryWeight / systemData.carryCapacity;

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
      // Dedupe by augment id — multi-slot augments occupy multiple entries
      // with the same id, but bonuses should apply once per augment.
      const profAugIds = [...new Set(
        (item.system.profAugments ?? []).map(a => a.augmentId).filter(Boolean)
      )];
      for (const augId of profAugIds) {
        const augment = this.items.get(augId);
        if (!augment || augment.type !== 'augment') continue;
        for (const bonus of augment.system.craftBonuses ?? []) {
          // Affinity filter: bonus only applies if no affinity set OR matches element.
          if (bonus.affinity && bonus.affinity !== element) continue;
          totals[bonus.type] = (totals[bonus.type] || 0) + (bonus.value || 0);
        }
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

    // ── 0. Effect Expiry — delete effects whose duration has elapsed ──
    const currentRound = combat.round;
    const toExpire = [];
    for (const effect of this.effects) {
      const dur = effect.duration;
      if (!dur?.rounds || dur.rounds <= 0) continue;
      const startRound = dur.startRound ?? 0;
      if (startRound > 0 && currentRound - startRound >= dur.rounds) {
        toExpire.push(effect);
      }
    }
    if (toExpire.length > 0) {
      const names = toExpire.map(e => e.name).filter(Boolean);
      await this.deleteEmbeddedDocuments('ActiveEffect', toExpire.map(e => e.id));
      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p>Expired effects on <strong>${this.name}</strong>: ${names.join(', ')}</p>`,
      });
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
    const sleepEffects = this.effects.filter(e =>
      !e.disabled && e.system?.debuffType === 'sleep'
    );
    const sleepDrain = sleepEffects.reduce((sum, e) =>
      sum + (e.system?.debuffDamage ?? 0), 0);

    for (const defKey of ['melee', 'ranged', 'mind', 'soul']) {
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

    // Reset reactions.
    const reactions = systemData.reactions;
    if (reactions && reactions.value !== reactions.max) {
      updateData['system.reactions.value'] = reactions.max;
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
