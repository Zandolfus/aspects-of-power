import { TAG_REGISTRY, TAG_CATEGORIES } from './tags.mjs';

export const ASPECTSOFPOWER = {};

// Tag system.
ASPECTSOFPOWER.tagRegistry   = TAG_REGISTRY;
ASPECTSOFPOWER.tagCategories = TAG_CATEGORIES;

/**
 * The set of Ability Scores used within the system.
 * @type {Object}
 */
ASPECTSOFPOWER.abilities = {
  vitality: 'ASPECTSOFPOWER.Ability.vitality.long',
  endurance: 'ASPECTSOFPOWER.Ability.endurance.long',
  strength: 'ASPECTSOFPOWER.Ability.strength.long',
  dexterity: 'ASPECTSOFPOWER.Ability.dexterity.long',
  toughness: 'ASPECTSOFPOWER.Ability.toughness.long',
  intelligence: 'ASPECTSOFPOWER.Ability.intelligence.long',
  willpower: 'ASPECTSOFPOWER.Ability.willpower.long',
  wisdom: 'ASPECTSOFPOWER.Ability.wisdom.long',
  perception: 'ASPECTSOFPOWER.Ability.perception.long',

};

/**
 * Canonical ability-key list, derived from the abilities table above.
 * Import THIS instead of redeclaring the array (it existed as 5 separate
 * copies before 2026-07-03 — a silent-drift hazard when abilities change).
 */
export const ABILITY_KEYS = Object.keys(ASPECTSOFPOWER.abilities);

ASPECTSOFPOWER.abilityAbbreviations = {
  vitality: 'ASPECTSOFPOWER.Ability.vitality.abbr',
  endurance: 'ASPECTSOFPOWER.Ability.endurance.abbr',
  strength: 'ASPECTSOFPOWER.Ability.strength.abbr',
  dexterity: 'ASPECTSOFPOWER.Ability.dexterity.abbr',
  toughness: 'ASPECTSOFPOWER.Ability.toughness.abbr',
  intelligence: 'ASPECTSOFPOWER.Ability.intelligence.abbr',
  willpower: 'ASPECTSOFPOWER.Ability.willpower.abbr',
  wisdom: 'ASPECTSOFPOWER.Ability.wisdom.abbr',
  perception: 'ASPECTSOFPOWER.Ability.perception.abbr',
};

/**
 * Stat curve constants — power curve × per-grade multiplier.
 * Per design-stat-curves.md.
 *   mod = round((stat / NORM)^P × NORM × MULT_BASE^gradeIndex)
 */
ASPECTSOFPOWER.statCurve = {
  NORM: 1085,
  P: 0.8,
  MULT_BASE: 1.25,
  gradeIndex: { G: 0, F: 0, E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 },
};

/**
 * Spell tiers — display labels and cost/multiplier lookups per design-magic-system.md.
 *   base_mana  = spellTierFactors[tier] × spellGradeFactors[grade]
 *   multiplier = spellTierMultipliers[tier]   (designer-overridable per skill)
 */
ASPECTSOFPOWER.spellTiers = {
  basic:   'ASPECTSOFPOWER.SpellTier.basic',
  high:    'ASPECTSOFPOWER.SpellTier.high',
  greater: 'ASPECTSOFPOWER.SpellTier.greater',
  major:   'ASPECTSOFPOWER.SpellTier.major',
  grand:   'ASPECTSOFPOWER.SpellTier.grand',
};

ASPECTSOFPOWER.spellTierFactors = {
  basic: 2, high: 4, greater: 8, major: 25, grand: 50,
};

/**
 * @deprecated Superseded by `skillRarities` (rarity multiplier ladder)
 * per design-skill-rarity-system.md. Kept readable so the migration script
 * can bucket old per-spell tier values into the new starting rarity.
 */
ASPECTSOFPOWER.spellTierMultipliers = {
  basic: 0.20, high: 0.25, greater: 0.30, major: 0.40, grand: 0.60,
};

/**
 * Skill rarity ladder — the universal effect multiplier per
 * design-skill-rarity-system.md. Shared across melee/ranged/magic/healing.
 *
 *   effect = potency × (rarityMult + Σ alterationTag.dmgMod) × (invested/base)^0.2
 *   base_resource = baseFactor × rarityMult × (1 + Σ alterationTag.costMod)
 *
 * Mults are CONSTANT — they never change per grade. What changes is the
 * skill's `rarity` tag (auto-demotes one tier per grade-up E→D and beyond).
 * Floor at not_proficient (0.2) — never zero. Below that = GM discretion.
 */
ASPECTSOFPOWER.skillRarities = {
  not_proficient: { mult: 0.2, label: 'ASPECTSOFPOWER.SkillRarity.not_proficient', color: '#5a3030', subInferior: true },
  neglected:      { mult: 0.3, label: 'ASPECTSOFPOWER.SkillRarity.neglected',      color: '#704040', subInferior: true },
  rusty:          { mult: 0.4, label: 'ASPECTSOFPOWER.SkillRarity.rusty',          color: '#8a5040', subInferior: true },
  inferior:       { mult: 0.5, label: 'ASPECTSOFPOWER.SkillRarity.inferior',       color: '#888888' },
  common:         { mult: 0.6, label: 'ASPECTSOFPOWER.SkillRarity.common',         color: '#ffffff' },
  uncommon:       { mult: 0.7, label: 'ASPECTSOFPOWER.SkillRarity.uncommon',       color: '#1eff00' },
  rare:           { mult: 0.8, label: 'ASPECTSOFPOWER.SkillRarity.rare',           color: '#0070dd' },
  epic:           { mult: 0.9, label: 'ASPECTSOFPOWER.SkillRarity.epic',           color: '#a335ee' },
  legendary:      { mult: 1.0, label: 'ASPECTSOFPOWER.SkillRarity.legendary',      color: '#ff8000' },
  mythic:         { mult: 1.1, label: 'ASPECTSOFPOWER.SkillRarity.mythic',         color: '#e6cc80' },
  divine:         { mult: 1.2, label: 'ASPECTSOFPOWER.SkillRarity.divine',         color: '#ff4444' },
};

/**
 * Demotion order — index used by the grade-up demotion hook.
 * Demoting a rarity = move down one entry in this list.
 * Floor at not_proficient (index 0).
 */
ASPECTSOFPOWER.skillRarityOrder = [
  'not_proficient', 'neglected', 'rusty', 'inferior',
  'common', 'uncommon', 'rare', 'epic',
  'legendary', 'mythic', 'divine',
];

/**
 * Alteration tags — the per-upgrade Alteration choice menu.
 * Each tag carries a damage modifier (subtracts from effective mult, floor 0)
 * and a cost modifier (added as a fraction to the base resource cost).
 *
 *   effective_mult = max(0, rarityMult + Σ tag.dmgMod)
 *   base_resource  = baseFactor × rarityMult × (1 + Σ tag.costMod)
 *
 * `stacking` controls how multiple instances of the same tag interact:
 *   'multiple' — multiple instances allowed (e.g. multiple debuffs with different params)
 *   'max_one'  — only one instance per skill
 *   'replace_aoe' — adding any AOE tag replaces an existing AOE tag
 */
ASPECTSOFPOWER.alterationTags = {
  // Single AOE tag — caster picks size at placement (scroll wheel during preview).
  // Cost scales 2^((diameter - 5) / 5) — see item.mjs spell-invest path.
  // dmgMod: per-target damage drop (you split your output across targets).
  // weightMod: flat slowdown for the AOE wind-up; bigger casts are also
  //   slowed automatically via Wis-controlled channel time on bigger mana.
  aoe:         { label: 'ASPECTSOFPOWER.Alteration.aoe',         dmgMod: -0.20, costMod:  0.00, weightMod: 0.50, category: 'area',         stacking: 'max_one' },
  // Cleave: melee-only. Cone shape with size = wielded weapon's reach.
  // Damage/cost penalties; weightMod is small because reach itself is the gate.
  cleave:      { label: 'ASPECTSOFPOWER.Alteration.cleave',      dmgMod: -0.10, costMod:  0.20, weightMod: 0.30, category: 'damage_shape', stacking: 'max_one' },
  // Thrust: melee-only +5 reach. Consumed in _resolveSkillReach. Mods mirror
  // the generic `reach` alteration; tune once we have play data.
  thrust:      { label: 'ASPECTSOFPOWER.Alteration.thrust',      dmgMod: -0.05, costMod:  0.10, weightMod: 0.10, category: 'range',        stacking: 'max_one'  },
  debuff:      { label: 'ASPECTSOFPOWER.Alteration.debuff',      dmgMod: -0.10, costMod:  0.20, weightMod: 0.20, category: 'status',       stacking: 'multiple' },
  dot:         { label: 'ASPECTSOFPOWER.Alteration.dot',         dmgMod: -0.15, costMod:  0.30, weightMod: 0.30, category: 'status',       stacking: 'max_one'  },
  penetration: { label: 'ASPECTSOFPOWER.Alteration.penetration', dmgMod: -0.05, costMod:  0.00, weightMod: 0.10, category: 'damage_shape', stacking: 'multiple' },
  reach:       { label: 'ASPECTSOFPOWER.Alteration.reach',       dmgMod: -0.05, costMod:  0.10, weightMod: 0.10, category: 'range',        stacking: 'multiple' },
  channeled:   { label: 'ASPECTSOFPOWER.Alteration.channeled',   dmgMod: -0.10, costMod: -0.50, weightMod: 1.00, category: 'cost_shape',   stacking: 'max_one'  },
  self_buff:   { label: 'ASPECTSOFPOWER.Alteration.self_buff',   dmgMod: -0.10, costMod:  0.00, weightMod: 0.10, category: 'self',         stacking: 'multiple' },
};

ASPECTSOFPOWER.spellGradeFactors = {
  G: 2.5, F: 5, E: 10, D: 24, C: 56, B: 130, A: 300, S: 700,
};

/**
 * Spell-tier celerity weights per design-magic-system.md.
 * Drives `wait = weight × multiplier × SCALE / actor_speed` for magic skills.
 * Mirror of weaponWeights but keyed by spell tier rather than weapon-type tag.
 */
ASPECTSOFPOWER.spellTierWeights = {
  basic:    130,
  high:     150,
  greater:  200,
  major:    400,
  grand:    700,
};

/**
 * Melee Option B Str/Dex hybrid blend per design-melee-system.md.
 *   normWeight = clamp01((weight - weightOffset) / weightSpan)
 *   strWeight  = strFloor + slope × normWeight  → [strFloor, strFloor+slope]
 *   dexWeight  = 1 - strWeight
 *   stat_blend = Str_mod × strWeight + Dex_mod × dexWeight
 */
ASPECTSOFPOWER.meleeBlend = {
  strFloor:     0.30,
  slope:        0.70,
  weightOffset: 40,
  weightSpan:   180,  // weight 40 → strWeight 0.30; weight 220 → strWeight 1.00
};

/**
 * Ranged Option α Dex/Per hybrid blend per design-ranged-system.md.
 *   perWeight  = perFloor + slope × normWeight  → [perFloor, perFloor+slope]
 *   dexWeight  = 1 - perWeight
 *   stat_blend = Dex_mod × dexWeight + Per_mod × perWeight
 */
ASPECTSOFPOWER.rangedBlend = {
  perFloor:     0.05,
  slope:        0.55,
  weightOffset: 50,
  weightSpan:   200,  // weight 50 → perWeight 0.05; weight 250 → perWeight 0.60
};

/**
 * Variable resource-invest tuning — shared across casters and weapon users.
 *   safe_invest_stam = Tough_mod × toughCapFactor   (melee soft cap; over-invest = self-damage)
 *   base_stamina     = weight / staminaBaseDivisor × stat_blend / staminaNormalizer
 *
 * Spell-side invest cap is per-tier under the hard-cap design — see
 * spellMaxInvestAboveBase below. Wisdom doesn't have a flat invest knob
 * here; the per-tier table is the single source of truth.
 */
ASPECTSOFPOWER.invest = {
  toughCapFactor:     0.02,
  staminaBaseDivisor: 20,
  staminaNormalizer:  1085,
};

/**
 * Spellstriker tuning (design-spellstriker.md). Type-2 FUSION spellstrikes
 * (weapon strike + `infused` int mana-rider) are balance-bounded so the
 * fusion honors "never best of both worlds": the infusion's mana invest is
 * wis-capped exactly like a real spell of its tier, and its damage is scaled
 * by `infusionCoef` (< 1) — the fusion penalty for also landing the strike.
 *   infusion = Int × infusionCoef × (mana / basicRef)^0.2
 * At 0.7 the infusion ≈ 70% of an equivalent pure spell, so a fusion hit lands
 * ~88% of a fighter's heavy hit while costing BOTH stamina and mana (sim
 * 2026-07-03). Type-1 vehicle spellstrikes are unaffected — they run the full
 * spell formula (rarity mult + wis-cap) already.
 */
ASPECTSOFPOWER.spellstrike = {
  infusionCoef: 0.7,
};

/**
 * Armor-answer system (design-armor-answer-system.md; FLAT/absolute rework
 * 2026-07-18, design-burn-status.md). The physical ARMOR layer (armor+blockDR)
 * is reduced by three FLAT reductions that SUM and are anchored to the
 * ATTACKER's output (never a fraction of the target's armor — that scaled with
 * target grade and let a lower-grade attacker strip a huge absolute chunk of a
 * superior's armor). All grade-correct by construction:
 *   pierce  = pierceHitFrac × attacker hit          (weapon/tag property, per-hit)
 *   crush   = Σ crushHitFrac × applier hit           (stacking debuff, stored flat)
 *   melt    = Σ armorMeltRate × burn-stack dotDamage (global; design-burn-status)
 *   armorAfter = max(0, armor+blockDR − pierce − crush − melt)
 * DR-strip (toughDR layer) is separate (drStrip flag). Legacy %-fields kept for
 * back-compat/migration only; the calc no longer reads them.
 */
ASPECTSOFPOWER.armorAnswer = {
  pierceHitFrac:       0.23,   // pierce flat = frac × attacker hit
  pierceWeaponTypes:  ['hammer', 'mace'],
  crushHitFrac:        0.10,   // crush flat, PER application = frac × applier hit
  armorCrushMaxStacks: 3,      // cap on crush stacks that contribute
  burnMeltRate:        0.5,    // default armor-melt rate (× Σ burn dotDamage)
  // ── legacy %-fields (SUPERSEDED by flat, kept for migration back-compat) ──
  pierceFraction:     0.35,
  armorCrushPerStack: 0.10,
};

/**
 * Power-sense indicators (design-power-sense.md, RULED 2026-07-14).
 * Magnitude is UNIVERSAL (ring for every observer in range); tier is
 * OBSERVER-RELATIVE: invest ÷ observer capacity (wil.mod for mana, the
 * physSafeFrac×tough safe-invest ceiling for physical), bucketed by
 * tierBands into faint/notable/heavy/overwhelming. Affinity identity is
 * gated by the `affinity-sight` sense tag. rangePerPerception: sensory
 * range = observer per.mod × this many ft.
 */
ASPECTSOFPOWER.powerSense = {
  rangePerPerception: 1.0,
  tierBands: [0.3, 0.9, 2.0],
  physSafeFrac: 0.02,
};

/**
 * Affinity display colors (power-sense ring tint, future UI accents).
 * Keys match ASPECTSOFPOWER.affinities. Kept beside the dictionary —
 * candidate to fold into the entries themselves on the next dictionary pass.
 */
ASPECTSOFPOWER.affinityColors = {
  fire: '#ff5722', earth: '#8d6e63', water: '#29b6f6', wind: '#b2dfdb',
  lightning: '#ffee58', ice: '#81d4fa', lunar: '#b39ddb', solar: '#ffb300',
  space: '#5c6bc0', metal: '#90a4ae', heat: '#ff8a65', blood: '#c62828',
  shadow: '#616161', nature: '#66bb6a', poison: '#9ccc65', necromantic: '#7b1fa2',
  holy: '#fff59d', light: '#ffffff', psychic: '#ec407a', time: '#26a69a',
  karma: '#a1887f', physical: '#e0d7c6',
};

/**
 * Celerity timing constants (per design-celerity.md).
 *   wait = (weapon_base_weight × skill_multiplier × SCALE) / actor_speed
 *   round_length = ROUND_K / ref_mod(RL)
 *   3 sword-equivalent swings per round at any grade by construction.
 */
ASPECTSOFPOWER.celerity = {
  SCALE:              10_000,
  ROUND_K:            3_000_000,
  BASELINE_WEIGHT:    100,    // sword reference
  ACTIONS_PER_ROUND:  3,      // by-construction target swings/round
  // Real-time anchor (design-celerity-realtime.md, RULED 2026-07-02):
  // 1 tick ≡ TICK_MS milliseconds of world time. Calibrated so a G1/mundane
  // human (ref_mod 36) takes 2.0s per sword swing (27,778 ticks) and has a
  // 6.0s reference round. DISPLAY-ONLY — waits, rounds, and all balance
  // math stay in ticks; this converts for presentation. Published Celerity
  // rating = mod × 1000 / (SCALE × TICK_MS) action-points per second.
  TICK_MS:            0.072,
  // Orb implement: cumulative spell weight required to discharge the next
  // spell cast as free + fast. Set at Major-tier weight (400) so:
  //   Basic spam (banks 130/cast):  every 4th cast discharges
  //   High spam (banks 150/cast):   every 4th cast discharges
  //   Greater spam (banks 200/cast): every 3rd cast discharges
  //   Major/Grand: every cast discharges (each banks ≥ threshold)
  // Universal across tiers per design 2026-05-06 — Wand stays the speed
  // king on Basic; Orb is the mana-economy alternative.
  // Wand implement: Basic-tier spell wait multiplier (−23% per design
  // 2026-05-06). Lived inline in celerity.mjs before 2026-07-03.
  WAND_BASIC_WAIT_MULT: 0.77,
  ORB_DISCHARGE_THRESHOLD: 400,
  // Base movement weight per 5ft. Multiplied by the selected mode's
  // `celerityMult` (see MOVEMENT_MODES below). Sprint = 1× baseline (this
  // value), Walk = 2× (slower per ft).
  MOVEMENT_BASE_WEIGHT_PER_5FT: 10,
  // Movement modes per design-movement-modes.md. Anchors:
  //   - Celerity: Sprint = 1× baseline (fast); Walk = 2× ticks/ft (slow).
  //   - Stamina:  Walk   = 1× baseline (1 stamina per 5 ft); Sprint = 3×
  //               (3 stamina per 5 ft).
  // The anchors swap between the two dimensions — walking is slow but
  // cheap, sprinting is fast but expensive. Default is Walk; Shift = Sprint.
  MOVEMENT_MODES: {
    walk:   { celerityMult: 2.0, staminaMult: 1.0, label: 'walk'   },
    sprint: { celerityMult: 1.0, staminaMult: 3.0, label: 'sprint' },
  },
  DEFAULT_MOVEMENT_MODE: 'walk',
  // Walk-mode bonus to the relevant defense roll when triggering terrain
  // effects (regions that declare a `targetStat`). +25% of the actor's
  // mod for that stat is added to the roll. Per design-movement-modes.md.
  WALK_TERRAIN_BONUS_FRACTION: 0.25,
  // Channel rate factor — per the Wis-controlled-channel design, channeling
  // mana costs additional celerity time:
  //   channel_ticks = invested × CHANNEL_FACTOR / Wis_mod
  // Spells fire at MAX(base_cast_time, channel_ticks).
  CHANNEL_FACTOR: 3000,
  // Manual break-free is deterministic in time, NOT stat-dependent:
  //   wait = referenceRoundLength(actorRL) × BREAK_FREE_ROUND_FRACTION
  // 1/3 = one "action's worth" of an actor's round, matching the
  // ~3-actions-per-round design invariant. Break attempts pace the same
  // as a sword swing at any grade — the BREAK ROLL is what scales with
  // stat, not the time to attempt.
  BREAK_FREE_ROUND_FRACTION: 1 / 3,
  // Break-roll yield multiplier per round afflicted (linear growth):
  //   yieldMult = 1 + (roundsAfflicted × BREAK_FREE_YIELD_PER_ROUND)
  // Round 0 = 1×. Round 4 = 2×. Round 8 = 3×. Round 12 = 4×. Etc.
  // Re-applying a non-stackable debuff resets the counter to 0. Caster
  // must keep afflicting to keep the target on the slow grind.
  BREAK_FREE_YIELD_PER_ROUND: 0.25,
  // Default activation fraction for `granted` skills (race/item/system-given).
  // wait = referenceRoundLength(actorRL) × tagConfig.grantedActivationFraction
  // (defaulting here when the skill omits an explicit value). 1/3 mirrors
  // break-free — one action's worth of an actor's round. Build-neutral.
  GRANTED_DEFAULT_FRACTION: 1 / 3,
};

/**
 * Active Defense tuning (design-active-defense.md v2, shipped 2026-06-12).
 * ALL values are percentages of rolls or fractions of the actor's own
 * tempo — never flat constants (stats span ~50→5,600 across grades; flat
 * numbers can't survive the curve).
 */
ASPECTSOFPOWER.defenseTuning = {
  // Dodge: each dodge delays the defender's next action by this fraction
  // of their own action wait (declared action's wait when queued, else
  // last wait, else a baseline-weight dex step).
  dodgeCostFraction: 0.25,
  // Scramble: consecutive dodges degrade the dodge value by this fraction
  // per stack; stacks decay continuously (1 stack per ¼ personal round ×
  // scrambleDecayQuarterRounds).
  scrambleStackPct: 0.15,
  scrambleDecayQuarterRounds: 1,
  // Graze band: a failed dodge within this fraction of the attacker's hit
  // total takes HALF damage (restores the partial-mitigation smoothing the
  // pools used to provide).
  grazeBandPct: 0.10,
  // Dodge basis divisor: the dodge ROLL uses defense.value ÷ this. The ×1.1
  // in the defense value is pool-era inflation — rolled at full value,
  // parity dodge sits at 91% and mirror fights never resolve (sim
  // 2026-06-12); stripped, parity is a 54% coin flip and fights conclude.
  dodgeBasisDiv: 1.1,
  // Windup: damage multiplier = clamp(weight × skillMult / 100, min, max).
  // UNCLAMPED-linear per 2026-06-11 ruling — dagger 0.6×, sword 1.0×,
  // greatsword 2.0×. Heavy = anti-armor burst, light = on-hit frequency.
  // Spells excluded (mana investment is their burst dial).
  windupMin: 0.5,
  windupMax: 3.0,
  // Block DR: held weapon contributes flat mitigation =
  //   coef × (weight/100) × (1 + str.mod/1085).
  // At coef 80: GS ≈ 266, sword ≈ 133, dagger ≈ 70 vs a full armor set
  // ~364 (the 30-60% design band). Shields excluded — they already grant
  // armorBonus via craftShieldArmorValues.
  blockDRCoef: 80,
  // Shrapnel: instead of the old pool-cost multiplier, shrapnel attacks
  // penalize the dodge roll by this fraction (fragments are hard to dodge).
  shrapnelDodgePenalty: 0.25,
  // Global HP multiplier (gap-analysis Family D, sim-validated 2026-06-11):
  // raises TTK floor so windup bursts don't one-shot same-rank actors.
  hpScale: 1.5,
  // AI defense auto-policy: AI-flagged defenders dodge when their exact
  // dodge win probability (two-d20 contest) meets this threshold; else eat.
  aiDodgeWinProbMin: 0.35,
  // Perceive-to-react gate (design-celerity-realtime.md, RULED 2026-07-02).
  // Active defense may be ATTEMPTED only while
  //   attacker_Celerity <= perceiveGateRatio x defender_Celerity,
  // measured on the build-neutral REFERENCE (race-level) curve. R = 2.5 is
  // sim-locked: it covers the ruled +/-25-level window in every grade from E
  // up, and grade boundaries stay smooth (adjacent-level ratios ~1.26x).
  // A ratio, not a level gap — "gap <= 25" would permit a 10.4x blur at low
  // RL. Set to 0 to disable the gate.
  perceiveGateRatio: 2.5,
  // Mortal-band exemption: when attacker AND defender are both G/F the gate
  // is waived. G's interior spread is 4.1-4.5x across nine levels, which no
  // flat R can honor. Cross-band (G/F vs E+) still uses the ratio.
  perceiveGateMortalBand: true,
};

/**
 * AI profiles (module/systems/ai.mjs). Actors opt in via
 * flags.aspectsofpower.aiProfile; aiSkillUuid overrides skill auto-pick;
 * aiDefense 'auto' (default for AI actors) | 'manual' controls the defense
 * auto-policy; aiDangerFt overrides the skirmisher kite bubble.
 */
ASPECTSOFPOWER.ai = {
  profiles: {
    primitive:  'Primitive (stationary)',
    brawler:    'Brawler (melee)',
    skirmisher: 'Skirmisher (ranged)',
    hexer:      'Hexer (debuff caster)',
  },
  // Per-NPC `flags.aspectsofpower.aiPathMode` — how the unit routes to its
  // destination. 'direct' charges straight (ignores AOE). 'smart' deviates the
  // heading to skirt harmful persistent-AOE regions (ai.mjs _declareStepToward).
  pathModes: {
    direct: 'Direct (charge straight)',
    smart:  'Smart (route around walls & area effects)',
  },
  defaultPathMode: 'direct',
  maxStepFt: 30,   // max movement per AI action
  dangerFt:  15,   // skirmisher kite bubble
  retreatHpPct: 0.25,  // self-preservation faculty: flee when HP fraction < this
  // Hostile NPCs at 0 HP auto-mark defeated (skull overlay, tracker strike)
  // without GM action (updateActor death hook). Player-owned actors exempt.
  autoDefeatHostiles: true,
};

/**
 * Movement / token-collision tuning. Footprints are axis-aligned boxes from each
 * token's width × height (handles 1x1, large, and rectangular tokens uniformly).
 * Shared by the no-stacking clamp + enemy-block (clampMoveNoOverlap) and the
 * equidistant bump (separateOverlappingTokens) in celerity.mjs.
 */
ASPECTSOFPOWER.movement = {
  // Per-side spacing gap in PIXELS beyond edge-touching. 0 = tokens may stand
  // edge-adjacent (touching). Raise for breathing room between bodies; the gap
  // applies on top of each token's own footprint, so it reads the same for big
  // and small tokens.
  tokenGapPx: 0,
};

/**
 * Modular AI BEHAVIOR tags — the composable "brain" of a creature, priced by
 * tier so a smarter conjuration (summon / ritual) costs more. Each behavior
 * sets AI flags on the creature and contributes `tier` points; the summed tier
 * (capped at the cost table length) selects a cost MULTIPLIER applied per
 * subsystem (summon → mana, ritual → power/prep) via resolveAiBehaviors()
 * (module/systems/ai.mjs). Same tags work on a GM-placed hostile (free); the
 * cost only bites when conjured. RULED 2026-06-21 (tier multiplier / unified
 * per-subsystem points / granular tags + presets) — see [[design-ai-behavior-tags]].
 *
 *   category 'brain'   — the movement/attack loop. Pick ONE (sets aiProfile).
 *   category 'faculty' — optional smartness add-ons. Stack freely.
 */
ASPECTSOFPOWER.aiBehaviors = {
  stationary:  { label: 'Stationary',     category: 'brain',   tier: 0, flags: { aiProfile: 'primitive' } },
  melee:       { label: 'Melee brain',    category: 'brain',   tier: 1, flags: { aiProfile: 'brawler' } },
  ranged:      { label: 'Ranged brain',   category: 'brain',   tier: 1, flags: { aiProfile: 'skirmisher' } },
  pathfind:    { label: 'Wall pathfinding', category: 'faculty', tier: 1, flags: { aiPathfind: true } },
  hazardAvoid: { label: 'Hazard avoidance', category: 'faculty', tier: 1, flags: { aiHazardAvoid: true } },
  smartTarget: { label: 'Smart targeting', category: 'faculty', tier: 1, flags: { aiSmartTarget: true } },
  autoDefense: { label: 'Self defense',   category: 'faculty', tier: 1, flags: { aiDefense: 'auto' } },
  focusWeakest:     { label: 'Focus weakest',     category: 'faculty', tier: 1, flags: { aiFocusWeakest: true } },
  selfPreservation: { label: 'Self-preservation', category: 'faculty', tier: 1, flags: { aiSelfPreserve: true } },
};

// tier → cost multiplier (index = summed behavior tier, clamped to last entry).
// Tier 0 mindless = baseline; tier 7 (melee + all 6 faculties) = ×4.3. Tunable.
ASPECTSOFPOWER.aiBrainTierCost = [1.0, 1.3, 1.6, 2.0, 2.5, 3.0, 3.6, 4.3];

// Convenience faculty bundles, applied ON TOP of a chosen brain. Expanded by
// resolveAiBehaviors(); a summon lists e.g. ['melee', 'tactical'].
ASPECTSOFPOWER.aiBehaviorPresets = {
  mindless: [],                                                            // brain only — locks nearest, charges
  trained:  ['smartTarget', 'autoDefense'],                                // picks reachable targets, defends
  tactical: ['pathfind', 'hazardAvoid', 'smartTarget', 'autoDefense'],     // full navigation + defense
  elite:    ['pathfind', 'hazardAvoid', 'smartTarget', 'autoDefense', 'focusWeakest', 'selfPreservation'], // everything
};

/**
 * Which ability mod is rolled to break each debuff type. Shared between the
 * auto-break loop (actor.onStartTurn) and the manual break-free flow
 * (actor-sheet → celerity declare → tracker dispatch).
 */
ASPECTSOFPOWER.debuffBreakStats = {
  root:       'strength',
  paralysis:  'vitality',
  fear:       'willpower',
  taunt:      'intelligence',
  charm:      'willpower',
  enraged:    'wisdom',
};

/**
 * Debuff types that represent a psychological state — exactly one instance
 * exists on a target at a time regardless of source. Re-applying any of
 * these (from any caster) refreshes the existing effect with max(existing,
 * new) values rather than creating a parallel one. "You are either charmed
 * or not"; two casters' charms collapse into the stronger.
 *
 * Physical debuffs (root, paralysis, hemorrhage, etc.) follow the per-skill
 * `stackable` flag instead: stackable → parallel effects with own durations,
 * non-stackable → same-source refresh-with-max.
 */
ASPECTSOFPOWER.singletonDebuffs = ['charm', 'fear', 'taunt', 'enraged'];

/**
 * Casting-speed Wis/Int weights by spell tier — bigger spells lean more
 * toward Wis ("mastery shows"). Wis-spec casters are markedly faster on
 * Major/Grand spells; Int-spec casters retain per-cast damage but pay in
 * cast time. casting_speed = Wis × wis + Int × int.
 */
ASPECTSOFPOWER.castingSpeedWeights = {
  basic:   { wis: 0.60, int: 0.40 },
  high:    { wis: 0.65, int: 0.35 },
  greater: { wis: 0.70, int: 0.30 },
  major:   { wis: 0.80, int: 0.20 },
  grand:   { wis: 0.90, int: 0.10 },
  '':      { wis: 0.60, int: 0.40 },  // fallback for untagged magic skills
};

/**
 * Per-tier Wis-derived hard cap on spell invest above base mana:
 *   max_invest = baseMana + Wis_mod × spellMaxInvestAboveBase[tier]
 * Then clamped by the actor's mana pool. NO self-damage past this cap —
 * it's a hard ceiling. Bigger spells reward Wis with more invest headroom
 * (small spells already have low base; big spells can absorb more channel).
 */
ASPECTSOFPOWER.spellMaxInvestAboveBase = {
  basic:   0.05,
  high:    0.08,
  greater: 0.15,
  major:   0.25,
  grand:   0.40,
  '':      0.10,  // fallback
};

/**
 * Per-RL reference round length lookup (build-neutral, drives every
 * round-anchored mechanic). Computed from the primary-spec stat curve in
 * design-celerity.md. Treat as authoritative; helpers fall back to actor
 * mod if RL falls outside the table.
 */
/**
 * Weapon COMBINATIONS — what is actually in your hands, detected live from
 * equipped gear by systems/weapon-styles.mjs. Never stored, so swapping
 * weapons changes what you can do immediately with nothing to keep in sync.
 *
 * THREE AXES (ruled 2026-07-27; supersedes the two-axis model of `1dc3a67`,
 * where "style" meant the arrangement):
 *
 *   TYPE        — the weapon itself (greatsword, dagger, bow...). Proficiency
 *                 passives declare `tagConfig.profFor` and SCALE THE DAMAGE of
 *                 attacks made with that type (see `weaponProficiency` below).
 *   COMBINATION — how the hands are arranged. Detected, never owned.
 *                 `tagConfig.requiresStyle` names one of these keys.
 *   STYLE       — a Passive skill you OWN that governs a set of attacks, the
 *                 way a Ritualism passive governs a body of rituals. The style
 *                 is the key; the combination is the lock. Attacks name their
 *                 governor in `tagConfig.styleSkill`.
 *
 * Combinations are TYPE-AWARE where the type is the whole point: a greatsword
 * and a greataxe are both two-handed, but they are not the same fighting
 * discipline, so each gets its own key and a generic `two-handed` is kept for
 * skills that genuinely only care about handedness.
 *
 * `inPlay` is the live PC footprint measured 2026-07-27 — evidence for scope
 * decisions, not a guess. Note the generic melee counts EXCLUDE archers now;
 * the earlier `two-handed: 9` wrongly swept in bows, crossbows and staves.
 */
ASPECTSOFPOWER.weaponCombinations = {
  // Two-handed melee, discipline-specific.
  '2h-greatsword':       { label: 'Two-Handed Greatsword', hands: 2, kind: 'melee', types: ['greatsword'], inPlay: 1 },
  '2h-greataxe':         { label: 'Two-Handed Greataxe',   hands: 2, kind: 'melee', types: ['greataxe'],   inPlay: 1 },
  '2h-polearm':          { label: 'Two-Handed Polearm',    hands: 2, kind: 'melee', types: ['polearm', 'spear', 'quarterstaff'], inPlay: 0 },
  'two-handed':          { label: 'Two-Handed',            hands: 2, kind: 'melee', generic: true, inPlay: 1 },

  // Paired weapons, discipline-specific.
  'dual-dagger':         { label: 'Dual Daggers',   hands: 2, kind: 'melee', types: ['dagger'],   inPlay: 0 },
  'dual-sword':          { label: 'Dual Blades',    hands: 2, kind: 'melee', types: ['sword', 'rapier'], inPlay: 0 },
  'dual-gauntlet':       { label: 'Dual Gauntlets', hands: 2, kind: 'melee', types: ['gauntlet'], inPlay: 0 },
  'dual-shield':         { label: 'Dual Shields',   hands: 2, kind: 'melee', types: ['shield', 'greatshield', 'buckler'], inPlay: 0 },
  'dual-wield':          { label: 'Dual Wield',     hands: 2, kind: 'melee', generic: true, inPlay: 0 },

  // Mixed hands.
  'sword-and-board':     { label: 'Sword and Board',     hands: 2, kind: 'melee', inPlay: 2 },
  'blade-and-implement': { label: 'Blade and Implement', hands: 2, kind: 'melee', inPlay: 1 },

  // Single hand / nothing.
  'single-weapon':       { label: 'Single Weapon', hands: 1, kind: 'melee', inPlay: 2 },
  unarmed:               { label: 'Unarmed',       hands: 0, kind: 'melee', inPlay: 0 },

  // RANGED — its own axis. Bows and firearms are two-handed in the literal
  // sense but share nothing with a greatsword discipline; before 2026-07-27
  // they fell into the melee buckets and inflated every count there.
  archery:               { label: 'Archery',  hands: 2, kind: 'ranged', types: ['bow', 'shortbow', 'longbow', 'crossbow'], inPlay: 2 },
  marksman:              { label: 'Marksman', hands: 2, kind: 'ranged', types: ['pistol', 'rifle', 'shotgun'], inPlay: 0 },

  // Casters.
  'implement-only':      { label: 'Implement Only', hands: 1, kind: 'implement', types: ['wand', 'staff', 'orb', 'tome'], inPlay: 11 },
};

/** Back-compat alias: `requiresStyle` values resolve against the same table. */
ASPECTSOFPOWER.weaponStyles = ASPECTSOFPOWER.weaponCombinations;

/**
 * Weapon PROFICIENCY -> damage (ruled 2026-07-27: "attach damage of attacks
 * using weapons to weapon proficiency").
 *
 * The proficiency passive's own RARITY is the mastery ladder — the rarity
 * table already opens with not_proficient / neglected / rusty, which is
 * exactly this. Its multiplier is ANCHORED at common so that `trained` is
 * neutral and the ladder reads as intended:
 *
 *   profDamageMult = skillRarities[prof.rarity].mult / skillRarities[anchor].mult
 *
 *   not_proficient 0.33x · rusty 0.67x · common 1.00x · legendary 1.67x · divine 2.00x
 *
 * ABSENCE IS NEUTRAL, never a penalty. An actor with no proficiency passive
 * for the weapon in hand multiplies by 1.0. This is load-bearing: ~110 NPCs
 * swing natural weapons and every current PC owns zero proficiencies, so a
 * penalty-on-absence rule would silently nerf the entire world the moment it
 * shipped. The sub-common tiers only bite when someone actually OWNS a rusty
 * or not_proficient passive — a deliberate authored statement ("out of
 * practice"), which is also the only way the flavour makes sense.
 */
ASPECTSOFPOWER.weaponProficiency = {
  enabled: true,
  anchor: 'common',
  // Applies to weapon-flavoured roll types only; spells are not proficiency-scaled.
  rollTypes: ['str_weapon', 'dex_weapon', 'phys_melee', 'phys_ranged', 'weapon'],
};

/**
 * Affinity usage-gating (design-affinity-dictionary.md, RULED design-first
 * 2026-07-03; engine shipped 2026-07-26).
 *
 * "Someone with fire affinity cannot use ice affinity items unless they also
 * have ice affinity, which would be rare for a fire person."
 *
 * LOOSENED 2026-07-26: opposition-only. Anyone may wear anything UNLESS they
 * hold a diametrically opposed affinity — lacking an affinity is no barrier.
 * That is what makes it safe to run live: an actor with no roster can never be
 * blocked, so the 105-equipped-item cliff of the strict reading disappears and
 * the rule only bites once affinities are actually granted.
 * Dry-run any time with `game.aspectsofpower.affinity.auditGating()`.
 */
ASPECTSOFPOWER.affinityGating = {
  enabled: true,
  // `air-affinity` is on 26 live items but the dictionary calls it `wind`, and
  // `air-affinity` is not even in the tag registry. Aliasing resolves them
  // rather than leaving 26 items attuned to nothing. (Fix the data too — this
  // is a safety net, not the cure.)
  tagAliases: { air: 'wind' },
};

/**
 * Celestial mechanics (design-calendar-celestial.md, 2026-07-26).
 *
 * The world is our planet, so it runs Foundry's Simplified Gregorian calendar
 * (CONFIG.time.worldCalendarConfig) — months, weekdays, seasons and leap years
 * all come from core. What core does NOT model is the sky, and the sky is
 * mechanical here: the Astral Aetherologist's eight lunar-phase rituals are
 * authored and live in world.skills, waiting on something to tell them which
 * phase it is.
 *
 * `phases` MUST stay byte-identical to those ritual names — they are the join
 * key between the sky and the content.
 */
ASPECTSOFPOWER.celestial = {
  // ── THE ANCHOR ──
  // World time 0 IS a real instant: 2000-01-01 00:00 UTC, JD 2451544.5.
  // Everything below is real ephemeris measured from it, so the moon phase on
  // a world date is the TRUE phase for that real date. Move this one number to
  // re-anchor the campaign; no coefficient changes.
  //
  // MIDNIGHT, not J2000 noon, so that core's calendar (which starts its own
  // year 0 at worldTime 0, midnight) agrees with real months and days
  // date-for-date. Verified live: with the leap patch below, every probe date
  // from 2000-01-01 through 2024-12-04 lands on the correct month/day/time,
  // including 2024-02-29.
  julianDayAtWorldZero: 2451544.5,
  // Core prints the year as the count from ITS year zero, so a real year needs
  // this added back. Our own date formatting derives the true civil date from
  // the Julian day and does not depend on core's year label at all.
  yearAtWorldZero: 2000,

  // ── LUNAR (Meeus, Astronomical Algorithms ch.47 mean elements) ──
  // Mean elongation D: 0 deg = new moon, 180 = full. Rate cross-checks against
  // the synodic month: 36525 / (445267.1114034/360) = 29.5306 d.
  moonElongation: { atEpoch: 297.8501921, degPerCentury: 445267.1114034 },
  // Argument of latitude F: angular distance from the ASCENDING NODE. 0 or 180
  // means the moon is on the ecliptic, which is the other half of an eclipse.
  // Cross-checks against the draconic month: 36525 / (483202.0175233/360)
  // = 27.2122 d. Its slight lag behind the sidereal month IS node regression
  // (a full lap in 18.6 y), so eclipse seasons drift ~19 days earlier a year
  // for free.
  moonArgLatitude: { atEpoch: 93.2720950, degPerCentury: 483202.0175233 },
  // Derived cycle lengths, kept for display and for the golden tests.
  lunarCycleDays: 29.530588853,
  draconicMonthDays: 27.212220817,

  // ── ECLIPSE LIMITS (real ecliptic limits, in DEGREES from the node) ──
  // An eclipse needs a syzygy AND proximity to a node. Testing DEGREES rather
  // than a fudged day-tolerance is what makes the cadence come out right
  // (~4-7 a year, clustered into seasons) instead of firing every fortnight.
  eclipseLimits: { solarPartial: 18.4, solarTotal: 11.8, lunarPartial: 12.2, lunarTotal: 5.9 },

  // The eight phases, in cycle order. MUST stay byte-identical to the eight
  // lunar rituals authored in world.skills — that string is the join key.
  phases: [
    'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
  ],

  // Astronomical quarter days. Core's seasons are MONTH-banded (Spring =
  // months 3-5), which is fine for a label but wrong for a solstice ritual,
  // so the real dates live here.
  quarterDays: {
    'Spring Equinox': { month: 3, day: 20 },
    'Summer Solstice': { month: 6, day: 21 },
    'Autumn Equinox': { month: 9, day: 22 },
    'Winter Solstice': { month: 12, day: 21 },
  },

  // ── METEOR SHOWERS (IMO calendar: activity window, peak, ZHR) ──
  // Annual and calendar-fixed, so a table is the honest model — no orbital
  // mechanics needed for the date, only for the parent comet.
  meteorShowers: [
    { name: 'Quadrantids',   start: { month: 12, day: 28 }, peak: { month: 1, day: 3 },   end: { month: 1, day: 12 },  zhr: 120, parent: null },
    { name: 'Lyrids',        start: { month: 4, day: 14 },  peak: { month: 4, day: 22 },  end: { month: 4, day: 30 },  zhr: 18,  parent: null },
    { name: 'Eta Aquariids', start: { month: 4, day: 19 },  peak: { month: 5, day: 5 },   end: { month: 5, day: 28 },  zhr: 50,  parent: '1P/Halley' },
    { name: 'Delta Aquariids', start: { month: 7, day: 12 }, peak: { month: 7, day: 30 }, end: { month: 8, day: 23 },  zhr: 25,  parent: null },
    { name: 'Perseids',      start: { month: 7, day: 17 },  peak: { month: 8, day: 12 },  end: { month: 8, day: 24 },  zhr: 100, parent: '109P/Swift-Tuttle' },
    { name: 'Orionids',      start: { month: 10, day: 2 },  peak: { month: 10, day: 21 }, end: { month: 11, day: 7 },  zhr: 20,  parent: '1P/Halley' },
    { name: 'Southern Taurids', start: { month: 9, day: 20 }, peak: { month: 11, day: 4 }, end: { month: 11, day: 20 }, zhr: 5,  parent: '2P/Encke' },
    { name: 'Northern Taurids', start: { month: 10, day: 20 }, peak: { month: 11, day: 11 }, end: { month: 12, day: 10 }, zhr: 5, parent: '2P/Encke' },
    { name: 'Leonids',       start: { month: 11, day: 6 },  peak: { month: 11, day: 16 }, end: { month: 11, day: 30 }, zhr: 15,  parent: '55P/Tempel-Tuttle' },
    { name: 'Geminids',      start: { month: 12, day: 4 },  peak: { month: 12, day: 13 }, end: { month: 12, day: 17 }, zhr: 150, parent: null },
    { name: 'Ursids',        start: { month: 12, day: 17 }, peak: { month: 12, day: 21 }, end: { month: 12, day: 26 }, zhr: 10,  parent: null },
  ],

  // ── PLANETS (JPL/DE200 mean elements at J2000, ecliptic of J2000) ──
  // a in AU, angles in degrees. Sidereal period is DERIVED from a by Kepler's
  // third law (P years = a^1.5) rather than listed, so the table cannot drift
  // out of internal agreement with itself.
  planets: {
    Mercury: { a: 0.38709893, e: 0.20563069, L: 252.25084, peri: 77.45645,  node: 48.33167,  inc: 7.00487 },
    Venus:   { a: 0.72333199, e: 0.00677323, L: 181.97973, peri: 131.53298, node: 76.68069,  inc: 3.39471 },
    Earth:   { a: 1.00000011, e: 0.01671022, L: 100.46435, peri: 102.94719, node: -11.26064, inc: 0.00005 },
    Mars:    { a: 1.52366231, e: 0.09341233, L: 355.45332, peri: 336.04084, node: 49.57854,  inc: 1.85061 },
    Jupiter: { a: 5.20336301, e: 0.04839266, L: 34.40438,  peri: 14.75385,  node: 100.55615, inc: 1.30530 },
    Saturn:  { a: 9.53707032, e: 0.05415060, L: 49.94432,  peri: 92.43194,  node: 113.71504, inc: 2.48446 },
    Uranus:  { a: 19.19126393, e: 0.04716771, L: 313.23218, peri: 170.96424, node: 74.22988, inc: 0.76986 },
    Neptune: { a: 30.06896348, e: 0.00858587, L: 304.88003, peri: 44.97135,  node: 131.72169, inc: 1.76917 },
  },

  // Tropical zodiac: twelve 30-degree segments of ecliptic longitude starting
  // at the vernal equinox. This is what "Mars retrograde in Scorpio" reads off.
  zodiac: [
    'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
  ],

  // ── COMETS (known perihelion passage + period) ──
  // A returning comet is a generational event; these are the famous ones with
  // well-determined returns. perihelionJD is a real Julian day.
  comets: [
    { name: '1P/Halley',          periodYears: 74.7,   perihelionJD: 2473682.5, note: 'next perihelion 2061; parent of the Eta Aquariids and Orionids' },
    { name: '2P/Encke',           periodYears: 3.3,    perihelionJD: 2461406.5, note: 'shortest known period; parent of the Taurids' },
    { name: '55P/Tempel-Tuttle',  periodYears: 33.318, perihelionJD: 2463014.5, note: 'next perihelion 2031-05-20; Leonid storms follow it' },
    { name: '109P/Swift-Tuttle',  periodYears: 133.28, perihelionJD: 2497709.5, note: 'next perihelion 2126-07-12; parent of the Perseids' },
  ],
};

/**
 * Non-combat activity registry (design-celerity-realtime.md step 4).
 *
 *   time = cost x qualityMult / Celerity(named stat)
 *
 * `cost` is in the SAME action-point unit as celerity weight — a sword swing
 * is BASELINE_WEIGHT (100). So a leveled character forces a stuck door in the
 * time a mundane one takes to blink, which is the whole point of the
 * re-denomination: superhuman is visible out of combat too.
 *
 * Three task classes (RULED 2026-07-02, option 1 + caveat):
 *   celerity — pure stat race (lockpicking, searching, forcing doors)
 *   clock    — same wall time for everyone (glue curing, a cart's journey)
 *   hybrid   — max() of both (precision work with mandatory cooling stages)
 *
 * `stat` names the ability that drives it. A null stat means "use the skill
 * being performed" — crafting rides its profession's ability.
 *
 * `qualityScaled: true` opts an activity into activityQuality below. Only
 * things with a QUALITY OF OUTPUT qualify — you can forge a sword roughly or
 * masterfully, but a lock is picked or it isn't, and "masterwork door-forcing"
 * is a category error (it read as 2 hours to open a door before this flag
 * existed). Non-scaled activities ignore the multiplier and the clock floor.
 *
 * Costs are the ruled exemplars; author more per activity as they come up.
 * Verify any new cost against the mundane baseline (G1, ref mod 36) — if a
 * G1 human takes an unreasonable time, the cost is wrong.
 */
ASPECTSOFPOWER.activities = {
  drawWeapon:  { label: 'Draw a weapon',        cost: 30,      stat: 'dexterity',    class: 'celerity' },
  forceDoor:   { label: 'Force a stuck door',   cost: 500,     stat: 'strength',     class: 'celerity' },
  pickLock:    { label: 'Pick a simple lock',   cost: 2000,    stat: 'dexterity',    class: 'celerity' },
  disarmTrap:  { label: 'Disarm a trap',        cost: 4000,    stat: 'dexterity',    class: 'celerity' },
  searchRoom:  { label: 'Search a room',        cost: 30000,   stat: 'perception',   class: 'celerity' },
  research:    { label: 'Research a topic',     cost: 60000,   stat: 'intelligence', class: 'celerity' },
  forgeSword:  { label: 'Forge a sword',        cost: 360000,  stat: null,           class: 'celerity', qualityScaled: true },
  ritualPrep:  { label: 'Prepare a ritual',     cost: 120000,  stat: null,           class: 'celerity', qualityScaled: true },
  // Clock-bound: the world takes its own time regardless of who waits.
  cureGlue:    { label: 'Cure glue',            cost: 0, class: 'clock', clockSeconds: 3600 },
  travelMile:  { label: 'Travel a mile (cart)', cost: 0, class: 'clock', clockSeconds: 1200 },
};

/**
 * Quality-relative crafting multiplier (ruling 3 caveat, 2026-07-02):
 * "Smithing at your max potential should take time. Smithing something
 * slipshod that you don't care about should be extremely fast."
 *
 * q = target quality / the crafter's own ceiling, so this is RELATIVE — an
 * S-rank smith knocking out a rough sword pays 0.25x against an enormous
 * Celerity (seconds), while the same smith working at their ceiling pays 25x
 * AND cannot outrun the clock floor. Coefficients are a sketch pending the
 * craft-flow rework sim; the floors are what stop mastery collapsing to
 * instant.
 */
ASPECTSOFPOWER.activityQuality = {
  rough:      { label: 'Rough',      mult: 0.25, clockFloorSeconds: 0 },
  standard:   { label: 'Standard',   mult: 1,    clockFloorSeconds: 0 },
  fine:       { label: 'Fine',       mult: 4,    clockFloorSeconds: 600 },
  masterwork: { label: 'Masterwork', mult: 25,   clockFloorSeconds: 7200 },
};

ASPECTSOFPOWER.referenceRoundLength = {
  1:    83333,
  10:   20408,
  24:   10563,
  25:   9836,
  50:   4702,
  99:   2475,
  199:  907,
  299:  443,
  399:  245,
  499:  145,
  599:  87,
};

/**
 * Canonical weapon weights by weapon-type tag (per design-melee-system.md
 * and design-ranged-system.md). Weight is a TYPE descriptor, not a tier
 * descriptor — a legendary greatsword and a starter greatsword both weigh 200.
 * Identity at higher grades comes from granted skills, multipliers, and
 * augments — not from heavier weights.
 *
 * Lookup is by tag in `system.tags`. First matching tag wins.
 * Falls back to `system.weight` if no tag matches (designer escape hatch).
 */
ASPECTSOFPOWER.weaponWeights = {
  // Melee
  unarmed:    40,
  dagger:     60,
  spear:      70,
  rapier:     70,
  sword:     100,
  axe:       120,
  hammer:    130,
  quarterstaff: 140,
  polearm:   180,
  greatsword: 200,
  greataxe:  220,
  // Defensive weapons. Shields were craftable (buckler/shield/greatshield are
  // all in craftItemTypes) but had NO weight, so they resolved to no weapon
  // type at all — Phil's greatshield read as untyped and could not be part of
  // any combination. Weights sit against their striking analogues: a buckler
  // punches about like a fist, a shield bash like an axe, a greatshield like a
  // polearm you shove rather than swing.
  buckler:    50,
  shield:    120,
  greatshield: 190,
  // Gauntlets — armoured fists. Heavier than bare hands, lighter than a
  // dagger, because the weight is the armour and not a blade.
  gauntlet:   50,
  // Ranged
  pistol:     50,
  shortbow:   70,
  bow:       130,
  crossbow:  150,
  shotgun:   180,
  longbow:   200,
  rifle:     240,
  // Magic implements — for the rare case someone melee-bonks with one.
  // Wand = fists (no real striking surface), staff = quarterstaff (2H stick).
  // For the primary use case (casting spells through the implement), this
  // weight is ignored — spell wait derives from spellTierWeights[tier].
  wand:       40,
  staff:     140,
};

/**
 * Default reach in feet by weapon type-tag. Drives item-derivation and the
 * skill-cast range gate. Greatsword/greataxe/polearm are giant weapons in
 * this system → 10ft. Spear is a 1H reach weapon → 10ft. Everything else is
 * standard 5ft melee. The "Thrust" ability (pending) extends reach by +5
 * temporarily on the wielder's next strike.
 */
ASPECTSOFPOWER.weaponReach = {
  unarmed:    5,
  dagger:     5,
  rapier:     5,
  sword:      5,
  axe:        5,
  hammer:     5,
  quarterstaff: 5,
  spear:     10,
  polearm:   10,
  greatsword: 10,
  greataxe:  10,
  // Magic implements: striking with one is a melee jab — 5ft.
  wand:       5,
  staff:      5,
};

/**
 * Skill categories — top-level grouping that determines available tags.
 */
ASPECTSOFPOWER.skillCategories = {
  combat:     'ASPECTSOFPOWER.SkillCategory.combat',
  profession: 'ASPECTSOFPOWER.SkillCategory.profession',
};

/**
 * Tags that define what a skill does when activated.
 * A skill can have multiple tags (e.g. [attack, debuff]).
 */
ASPECTSOFPOWER.skillTags = {
  // Section-driving tags (show/hide config sections).
  attack:      'ASPECTSOFPOWER.Tag.attack',
  restoration: 'ASPECTSOFPOWER.Tag.restoration',
  buff:        'ASPECTSOFPOWER.Tag.buff',
  debuff:      'ASPECTSOFPOWER.Tag.debuff',
  cleanse:     'ASPECTSOFPOWER.Tag.cleanse',
  repair:      'ASPECTSOFPOWER.Tag.repair',
  aoe:         'ASPECTSOFPOWER.Tag.aoe',
  sustain:     'ASPECTSOFPOWER.Tag.sustain',
  shrapnel:    'ASPECTSOFPOWER.Tag.shrapnel',
  invest:      'ASPECTSOFPOWER.Tag.invest',
  unity:       'ASPECTSOFPOWER.Tag.unity',
  craft:       'ASPECTSOFPOWER.Tag.craft',
  // Trigger tags (auto-fire passives).
  on_death:    'ASPECTSOFPOWER.Tag.on_death',
  // Chain conditional tags (gate when a chained skill is allowed to fire).
  requires_armor_pierce: 'ASPECTSOFPOWER.Tag.requires_armor_pierce',
  // Mine-pair tags (summon places, generic Detonate consumes any).
  mine:        'ASPECTSOFPOWER.Tag.mine',
  detonate:    'ASPECTSOFPOWER.Tag.detonate',
  // Descriptor tags (mechanical effects).
  magic:       'ASPECTSOFPOWER.Tag.magic',
  physical:    'ASPECTSOFPOWER.Tag.physical',
  vocal:       'ASPECTSOFPOWER.Tag.vocal',
  ranged:      'ASPECTSOFPOWER.Tag.ranged',
  melee:       'ASPECTSOFPOWER.Tag.melee',
  infused:     'ASPECTSOFPOWER.Tag.infused',
  // Armor-answer tags (design-armor-answer-system). pierce = static %-ignore of
  // the armor layer (read in the mitigation calc). shred = affinity DR-strip,
  // crush = armor+block reduction (both read in _handleDebuffTag; shred/crush
  // imply `debuff`).
  pierce:      'ASPECTSOFPOWER.Tag.pierce',
  shred:       'ASPECTSOFPOWER.Tag.shred',
  crush:       'ASPECTSOFPOWER.Tag.crush',
  // Mobile (design-concurrent-actions, 2026-07-14): skill can be declared and
  // fired WHILE WALKING (parallel movement track) — potions, pistol shots,
  // wand bolts, thrown knives. Read by the declareAction/declareMovement
  // concurrency gates in celerity.mjs. Sprint never permits concurrency.
  mobile:      'ASPECTSOFPOWER.Tag.mobile',
  // Affinity tags (set skill damage affinity).
  fire:          'ASPECTSOFPOWER.Tag.fire',
  heat:          'ASPECTSOFPOWER.Tag.heat',
  ice:           'ASPECTSOFPOWER.Tag.ice',
  lightning:     'ASPECTSOFPOWER.Tag.lightning',
  earth:         'ASPECTSOFPOWER.Tag.earth',
  water:         'ASPECTSOFPOWER.Tag.water',
  wind:          'ASPECTSOFPOWER.Tag.wind',
  metal:         'ASPECTSOFPOWER.Tag.metal',
  lunar:         'ASPECTSOFPOWER.Tag.lunar',
  solar:         'ASPECTSOFPOWER.Tag.solar',
  space:         'ASPECTSOFPOWER.Tag.space',
  shadow:        'ASPECTSOFPOWER.Tag.shadow',
  light:         'ASPECTSOFPOWER.Tag.light',
  nature:        'ASPECTSOFPOWER.Tag.nature',
  poison:        'ASPECTSOFPOWER.Tag.poison',
  blood:         'ASPECTSOFPOWER.Tag.blood',
  necromantic:   'ASPECTSOFPOWER.Tag.necromantic',
  holy:          'ASPECTSOFPOWER.Tag.holy',
  arcane:        'ASPECTSOFPOWER.Tag.arcane',
  psychic:       'ASPECTSOFPOWER.Tag.psychic',
  // Debuff subtype tags (auto-add debuff parent, auto-set debuff type).
  root:          'ASPECTSOFPOWER.Tag.root',
  immobilized:   'ASPECTSOFPOWER.Tag.immobilized',
  slow:          'ASPECTSOFPOWER.Tag.slow',
  chilled:       'ASPECTSOFPOWER.Tag.chilled',
  frozen:        'ASPECTSOFPOWER.Tag.frozen',
  sleep:         'ASPECTSOFPOWER.Tag.sleep',
  stun:          'ASPECTSOFPOWER.Tag.stun',
  paralysis:     'ASPECTSOFPOWER.Tag.paralysis',
  fear:          'ASPECTSOFPOWER.Tag.fear',
  blind:         'ASPECTSOFPOWER.Tag.blind',
  silence:       'ASPECTSOFPOWER.Tag.silence',
  weaken:        'ASPECTSOFPOWER.Tag.weaken',
  deafened:      'ASPECTSOFPOWER.Tag.deafened',
  taunt:         'ASPECTSOFPOWER.Tag.taunt',
  charm:         'ASPECTSOFPOWER.Tag.charm',
  enraged:       'ASPECTSOFPOWER.Tag.enraged',
  hallucination: 'ASPECTSOFPOWER.Tag.hallucination',
  dismembered:   'ASPECTSOFPOWER.Tag.dismembered',
};

/**
 * Tags available per skill category.
 */
ASPECTSOFPOWER.combatTags = {
  // Section-driving.
  attack:      'ASPECTSOFPOWER.Tag.attack',
  restoration: 'ASPECTSOFPOWER.Tag.restoration',
  buff:        'ASPECTSOFPOWER.Tag.buff',
  debuff:      'ASPECTSOFPOWER.Tag.debuff',
  cleanse:     'ASPECTSOFPOWER.Tag.cleanse',
  aoe:         'ASPECTSOFPOWER.Tag.aoe',
  sustain:     'ASPECTSOFPOWER.Tag.sustain',
  shrapnel:    'ASPECTSOFPOWER.Tag.shrapnel',
  invest:      'ASPECTSOFPOWER.Tag.invest',
  unity:       'ASPECTSOFPOWER.Tag.unity',
  // Triggers.
  on_death:    'ASPECTSOFPOWER.Tag.on_death',
  // Chain conditional.
  requires_armor_pierce: 'ASPECTSOFPOWER.Tag.requires_armor_pierce',
  // Mine-pair (summon places, generic Detonate consumes any).
  mine:        'ASPECTSOFPOWER.Tag.mine',
  detonate:    'ASPECTSOFPOWER.Tag.detonate',
  // Movement-skill family (Stormstride, Charge, Leap, Teleport, Blink, etc.).
  // Marks any skill that affects or executes movement. Used for queryability
  // ("dispel all movement buffs"), Mobility-aura stacking, and the
  // movement-buff handler that applies system-field multipliers to effects.
  movement:    'ASPECTSOFPOWER.Tag.movement',
  // Teleport (instant relocation, ignores walls/terrain/engagement) and
  // Leap (arc movement, halts on engagement, walls below leapApexFt are
  // crossable). Per design-movement-skills.md Phase C.
  teleport:    'ASPECTSOFPOWER.Tag.teleport',
  leap:        'ASPECTSOFPOWER.Tag.leap',
  // Granted: skill is provided by the source (race/item/system primitive)
  // rather than learned/trained. Routes through computeActionWait's
  // build-neutral fixed-fraction path instead of the stat-driven formula.
  granted:     'ASPECTSOFPOWER.Tag.granted',
  // Ground-anchored AOEs (oil slicks, spike traps, vine fields) — only
  // affect targets on the ground. A leaping actor passing overhead
  // skips them. Volumetric AOEs (fireball, gas cloud) leave this OFF.
  ground:      'ASPECTSOFPOWER.Tag.ground',
  // Dash: while the actor has any non-disabled effect carrying this tag,
  // engagement halts skip — they're moving too fast to engage. Author by
  // tagging the buff skill (Stormstride) with `dash`; the spawned effect
  // inherits the tag via _handleBuffTag.
  dash:        'ASPECTSOFPOWER.Tag.dash',
  // Aura: skill produces an actor-centered sustained AOE effect.
  // (Distinct from the aura mechanic baked into buffs — this is a
  // queryable marker for skills whose primary form is an aura.)
  aura:        'ASPECTSOFPOWER.Tag.aura',
  // Social: skill primarily affects social/persuasion/intimidation
  // dynamics rather than direct combat math. Marker tag for the
  // future social mechanics subsystem.
  social:      'ASPECTSOFPOWER.Tag.social',
  // Retaliation: skill fires in response to being attacked. Marker
  // for the future reaction subsystem; currently a queryable category
  // (Shocking Retort, Retaliatory Strike, etc.).
  retaliation: 'ASPECTSOFPOWER.Tag.retaliation',
  // Ritual: skill that's encoded into a physical item out-of-combat
  // (gem, circle, inscription) and activated in-combat by consuming a
  // charge. Activation uses the granted skill timing (1/3 reference
  // round). See design-ritual-subsystem.md.
  ritual:      'ASPECTSOFPOWER.Tag.ritual',
  // Inscribe: profession-style action that takes a raw gem from inventory
  // and a ritual skill known to the caster, and produces a consumable
  // with effectType='ritual' encoding that skill. Mirrors craft/refine.
  inscribe:    'ASPECTSOFPOWER.Tag.inscribe',
  // Descriptors.
  magic:       'ASPECTSOFPOWER.Tag.magic',
  physical:    'ASPECTSOFPOWER.Tag.physical',
  vocal:       'ASPECTSOFPOWER.Tag.vocal',
  ranged:      'ASPECTSOFPOWER.Tag.ranged',
  melee:       'ASPECTSOFPOWER.Tag.melee',
  // Armor-answer (design-armor-answer-system).
  pierce:      'ASPECTSOFPOWER.Tag.pierce',
  shred:       'ASPECTSOFPOWER.Tag.shred',
  crush:       'ASPECTSOFPOWER.Tag.crush',
  // Concurrency (design-concurrent-actions).
  mobile:      'ASPECTSOFPOWER.Tag.mobile',
  // Affinities.
  time:          'ASPECTSOFPOWER.Tag.time',
  karma:         'ASPECTSOFPOWER.Tag.karma',
  fire:          'ASPECTSOFPOWER.Tag.fire',
  heat:          'ASPECTSOFPOWER.Tag.heat',
  ice:           'ASPECTSOFPOWER.Tag.ice',
  lightning:     'ASPECTSOFPOWER.Tag.lightning',
  earth:         'ASPECTSOFPOWER.Tag.earth',
  water:         'ASPECTSOFPOWER.Tag.water',
  wind:          'ASPECTSOFPOWER.Tag.wind',
  metal:         'ASPECTSOFPOWER.Tag.metal',
  lunar:         'ASPECTSOFPOWER.Tag.lunar',
  solar:         'ASPECTSOFPOWER.Tag.solar',
  space:         'ASPECTSOFPOWER.Tag.space',
  shadow:        'ASPECTSOFPOWER.Tag.shadow',
  light:         'ASPECTSOFPOWER.Tag.light',
  nature:        'ASPECTSOFPOWER.Tag.nature',
  poison:        'ASPECTSOFPOWER.Tag.poison',
  blood:         'ASPECTSOFPOWER.Tag.blood',
  necromantic:   'ASPECTSOFPOWER.Tag.necromantic',
  holy:          'ASPECTSOFPOWER.Tag.holy',
  arcane:        'ASPECTSOFPOWER.Tag.arcane',
  psychic:       'ASPECTSOFPOWER.Tag.psychic',
  // Debuff subtypes.
  root:          'ASPECTSOFPOWER.Tag.root',
  immobilized:   'ASPECTSOFPOWER.Tag.immobilized',
  slow:          'ASPECTSOFPOWER.Tag.slow',
  chilled:       'ASPECTSOFPOWER.Tag.chilled',
  frozen:        'ASPECTSOFPOWER.Tag.frozen',
  sleep:         'ASPECTSOFPOWER.Tag.sleep',
  stun:          'ASPECTSOFPOWER.Tag.stun',
  paralysis:     'ASPECTSOFPOWER.Tag.paralysis',
  fear:          'ASPECTSOFPOWER.Tag.fear',
  blind:         'ASPECTSOFPOWER.Tag.blind',
  silence:       'ASPECTSOFPOWER.Tag.silence',
  weaken:        'ASPECTSOFPOWER.Tag.weaken',
  deafened:      'ASPECTSOFPOWER.Tag.deafened',
  taunt:         'ASPECTSOFPOWER.Tag.taunt',
  charm:         'ASPECTSOFPOWER.Tag.charm',
  enraged:       'ASPECTSOFPOWER.Tag.enraged',
  hallucination: 'ASPECTSOFPOWER.Tag.hallucination',
  dismembered:   'ASPECTSOFPOWER.Tag.dismembered',
};

/**
 * Debuff subtype tags → auto-add 'debuff' parent and set debuff type.
 */
ASPECTSOFPOWER.debuffSubtypeTags = {
  root: 'root', immobilized: 'immobilized', slow: 'slow',
  chilled: 'chilled', frozen: 'frozen', sleep: 'sleep',
  stun: 'stun', paralysis: 'paralysis', fear: 'fear',
  blind: 'blind', silence: 'silence', weaken: 'weaken',
  deafened: 'deafened', taunt: 'taunt', charm: 'charm',
  enraged: 'enraged', hallucination: 'hallucination', dismembered: 'dismembered',
};

/**
 * Debuff BEHAVIOR tags (armor-answer system) — adding one to a skill auto-adds
 * the `debuff` parent (so it routes through _handleDebuffTag). Unlike the
 * subtype tags, these carry no debuffType; the mechanic is read straight off
 * the tag in _handleDebuffTag (single source of truth — no buried checkbox).
 *   shred → affinity DR-strip (affinity comes from the skill's own affinity tag)
 *   crush → armor + block reduction (physical/generic; magnitude from armorAnswer)
 */
ASPECTSOFPOWER.debuffBehaviorTags = {
  shred: 'shred',
  crush: 'crush',
};

/**
 * THE AFFINITY DICTIONARY (2026-07-03, design-affinity-dictionary.md).
 * One rich entry per mana affinity — the single source of truth. Both
 * `affinityTags` (the skill-affinity Set) and `craftElements` (crafting
 * material stats) are DERIVED from this below, so nothing drifts.
 *
 * Per-affinity fields:
 *   label          i18n key (ASPECTSOFPOWER.Affinity.<key>).
 *   materialStats  [stat1, stat2, stat3] — the ability trio a MATERIAL of this
 *                  affinity contributes to crafted gear (item-derivation splits
 *                  the stat budget base+1 / base / base-1 across the trio, so
 *                  ORDER matters — stat1 is the dominant material identity).
 *                  Feeds craftElements. Distribution levelled to a 6-8 band
 *                  across the 21 affinities (2026-07-03 redline); the 9
 *                  authored craftElements entries (fire/earth/water/wind/
 *                  lightning/ice/lunar/solar/space) are preserved verbatim.
 *   opposed        Affinity keys this one opposes (future: usage-gating
 *                  rarity, resist/counter logic, enemy-weakness authoring).
 *   lane           'elemental' → damage mitigated by armor+DR (the 2026-07-02
 *                  ruling: elemental NEVER hits veil); 'mental' → mind/soul
 *                  POTENCY via veil; 'hybrid' → case-by-case per skill.
 * (arcane removed 2026-07-03 per user — a specific narrative concept, not a
 *  craftable/character affinity. It survives only as a skill damage-type tag.)
 */
ASPECTSOFPOWER.affinities = {
  // ── Authored craftElements (preserved verbatim; 'air' key → 'wind') ──
  fire:        { label: 'ASPECTSOFPOWER.Affinity.fire',        materialStats: ['strength', 'vitality', 'dexterity'],       opposed: ['ice', 'water'],      lane: 'elemental' },
  earth:       { label: 'ASPECTSOFPOWER.Affinity.earth',       materialStats: ['strength', 'endurance', 'vitality'],       opposed: ['lightning', 'wind'], lane: 'elemental' },
  water:       { label: 'ASPECTSOFPOWER.Affinity.water',       materialStats: ['wisdom', 'willpower', 'endurance'],        opposed: ['fire'],              lane: 'elemental' },
  wind:        { label: 'ASPECTSOFPOWER.Affinity.wind',        materialStats: ['dexterity', 'endurance', 'perception'],    opposed: ['earth'],             lane: 'elemental' },
  lightning:   { label: 'ASPECTSOFPOWER.Affinity.lightning',   materialStats: ['dexterity', 'perception', 'vitality'],     opposed: ['earth'],             lane: 'elemental' },
  ice:         { label: 'ASPECTSOFPOWER.Affinity.ice',         materialStats: ['intelligence', 'perception', 'toughness'], opposed: ['fire', 'heat'],      lane: 'elemental' },
  lunar:       { label: 'ASPECTSOFPOWER.Affinity.lunar',       materialStats: ['intelligence', 'willpower', 'wisdom'],     opposed: ['solar'],             lane: 'elemental' },
  solar:       { label: 'ASPECTSOFPOWER.Affinity.solar',       materialStats: ['vitality', 'perception', 'endurance'],     opposed: ['lunar'],             lane: 'elemental' },
  space:       { label: 'ASPECTSOFPOWER.Affinity.space',       materialStats: ['perception', 'willpower', 'endurance'],    opposed: [],                    lane: 'elemental' },
  // ── New affinities (2026-07-03; trios tuned for the 6-8 distribution) ──
  metal:       { label: 'ASPECTSOFPOWER.Affinity.metal',       materialStats: ['toughness', 'strength', 'endurance'],      opposed: [],                    lane: 'elemental' },
  heat:        { label: 'ASPECTSOFPOWER.Affinity.heat',        materialStats: ['strength', 'endurance', 'vitality'],       opposed: ['ice'],               lane: 'elemental' },
  blood:       { label: 'ASPECTSOFPOWER.Affinity.blood',       materialStats: ['vitality', 'strength', 'toughness'],       opposed: ['holy'],              lane: 'elemental' },
  shadow:      { label: 'ASPECTSOFPOWER.Affinity.shadow',      materialStats: ['dexterity', 'perception', 'strength'],     opposed: ['light', 'holy'],     lane: 'elemental' },
  nature:      { label: 'ASPECTSOFPOWER.Affinity.nature',      materialStats: ['vitality', 'wisdom', 'toughness'],         opposed: ['necromantic'],       lane: 'elemental' },
  poison:      { label: 'ASPECTSOFPOWER.Affinity.poison',      materialStats: ['dexterity', 'intelligence', 'vitality'],   opposed: ['holy'],              lane: 'elemental' },
  necromantic: { label: 'ASPECTSOFPOWER.Affinity.necromantic', materialStats: ['intelligence', 'toughness', 'willpower'],  opposed: ['nature', 'holy'],    lane: 'hybrid' },
  holy:        { label: 'ASPECTSOFPOWER.Affinity.holy',        materialStats: ['willpower', 'wisdom', 'toughness'],        opposed: ['necromantic', 'shadow', 'blood', 'poison'], lane: 'hybrid' },
  light:       { label: 'ASPECTSOFPOWER.Affinity.light',       materialStats: ['perception', 'wisdom', 'willpower'],       opposed: ['shadow'],            lane: 'elemental' },
  psychic:     { label: 'ASPECTSOFPOWER.Affinity.psychic',     materialStats: ['willpower', 'intelligence', 'perception'], opposed: [],                    lane: 'mental' },
  time:        { label: 'ASPECTSOFPOWER.Affinity.time',        materialStats: ['wisdom', 'intelligence', 'dexterity'],     opposed: [],                    lane: 'hybrid' },
  karma:       { label: 'ASPECTSOFPOWER.Affinity.karma',       materialStats: ['wisdom', 'intelligence', 'toughness'],     opposed: [],                    lane: 'hybrid' },
};

/**
 * Affinity skill tags — auto-populate the skill's affinities array.
 * DERIVED from the dictionary above (identical membership to the
 * pre-2026-07-03 flat Set). Do NOT add names here; add a dictionary entry.
 */
ASPECTSOFPOWER.affinityTags = new Set(Object.keys(ASPECTSOFPOWER.affinities));

/**
 * Size tag scaling — multipliers applied to ability mods and defense values.
 * str: multiplier on strength.mod (affects damage).
 * hp: multiplier on health.max (derived from vitality).
 * meleeRangedDef: multiplier on melee and ranged defense values.
 */
ASPECTSOFPOWER.sizeScaling = {
  tiny:       { str: 0.6, hp: 0.6, meleeRangedDef: 1.4 },
  small:      { str: 0.8, hp: 0.8, meleeRangedDef: 1.2 },
  medium:     { str: 1.0, hp: 1.0, meleeRangedDef: 1.0 },
  large:      { str: 1.2, hp: 1.2, meleeRangedDef: 0.8 },
  huge:       { str: 1.4, hp: 1.4, meleeRangedDef: 0.6 },
  gargantuan: { str: 1.6, hp: 1.6, meleeRangedDef: 0.4 },
};

ASPECTSOFPOWER.reactionTypes = {
  dodge:   'ASPECTSOFPOWER.Reaction.dodge',
  parry:   'ASPECTSOFPOWER.Reaction.parry',
  barrier: 'ASPECTSOFPOWER.Reaction.barrier',
  swap:    'ASPECTSOFPOWER.Reaction.swap',
  guardian: 'ASPECTSOFPOWER.Reaction.guardian',
};

// Guardian-reaction behavior modes (per design-guardian-reactions.md).
// Apply when reactionType === 'guardian' on an `ally_attacked` reaction:
//   intercept — redirect the attack onto the guardian, who defends it with
//               their own active defense + armor/veil/HP (bodyguard).
//   cover     — the guardian's defense roll replaces the ally's; success
//               negates, fail → the ally takes it (defend-for-ally).
//   redirect  — attack resolves on the ally, then guardianRedirectPct of the
//               LANDED damage transfers raw onto the guardian (bloodbond).
ASPECTSOFPOWER.guardianModes = {
  intercept: 'ASPECTSOFPOWER.Guardian.intercept',
  cover:     'ASPECTSOFPOWER.Guardian.cover',
  redirect:  'ASPECTSOFPOWER.Guardian.redirect',
};

/**
 * Non-damaging debuff subtypes applied via the debuff tag.
 * Each type stores its key on the ActiveEffect flags for enforcement.
 */
ASPECTSOFPOWER.debuffTypes = {
  none:          'ASPECTSOFPOWER.Debuff.none',
  root:          'ASPECTSOFPOWER.Debuff.root',
  immobilized:   'ASPECTSOFPOWER.Debuff.immobilized',
  slow:          'ASPECTSOFPOWER.Debuff.slow',
  chilled:       'ASPECTSOFPOWER.Debuff.chilled',
  frozen:        'ASPECTSOFPOWER.Debuff.frozen',
  sleep:         'ASPECTSOFPOWER.Debuff.sleep',
  stun:          'ASPECTSOFPOWER.Debuff.stun',
  paralysis:     'ASPECTSOFPOWER.Debuff.paralysis',
  fear:          'ASPECTSOFPOWER.Debuff.fear',
  blind:         'ASPECTSOFPOWER.Debuff.blind',
  silence:       'ASPECTSOFPOWER.Debuff.silence',
  weaken:        'ASPECTSOFPOWER.Debuff.weaken',
  deafened:      'ASPECTSOFPOWER.Debuff.deafened',
  taunt:         'ASPECTSOFPOWER.Debuff.taunt',
  charm:         'ASPECTSOFPOWER.Debuff.charm',
  enraged:       'ASPECTSOFPOWER.Debuff.enraged',
  hallucination: 'ASPECTSOFPOWER.Debuff.hallucination',
  dismembered:   'ASPECTSOFPOWER.Debuff.dismembered',
};

/**
 * Zone effects for persistent AOE regions.
 */
ASPECTSOFPOWER.zoneEffects = {
  none:             'ASPECTSOFPOWER.Zone.none',
  slippery:         'ASPECTSOFPOWER.Zone.slippery',
  difficultTerrain: 'ASPECTSOFPOWER.Zone.difficultTerrain',
};

/**
 * Roll types for skills — used in skill sheet dropdown.
 * Keyed by internal value, value is localization key.
 */
ASPECTSOFPOWER.rollTypes = {
  str_weapon:       'ASPECTSOFPOWER.RollType.strWeapon',
  dex_weapon:       'ASPECTSOFPOWER.RollType.dexWeapon',
  phys_ranged:      'ASPECTSOFPOWER.RollType.physRanged',
  magic:            'ASPECTSOFPOWER.RollType.magic',
  magic_projectile: 'ASPECTSOFPOWER.RollType.magicProjectile',
  magic_melee:      'ASPECTSOFPOWER.RollType.magicMelee',
  wisdom_dexterity: 'ASPECTSOFPOWER.RollType.wisdomDexterity',
};

/**
 * Skill resources.
 */
ASPECTSOFPOWER.skillResources = {
  stamina: 'ASPECTSOFPOWER.Resource.stamina',
  mana:    'ASPECTSOFPOWER.Resource.mana',
  health:  'ASPECTSOFPOWER.Resource.health',
};

/**
 * Gate tag → blocked roll types / resources.
 * Used for skill sheet filtering and runtime blocking.
 */
ASPECTSOFPOWER.gateRules = {
  'no-magic':    { blockedTypes: ['magic', 'magic_projectile', 'magic_melee'], blockedResources: ['mana'] },
  'no-ranged':   { blockedTypes: ['phys_ranged', 'magic', 'magic_projectile'], blockedResources: [] },
  'melee-only':  { blockedTypes: ['phys_ranged', 'magic', 'magic_projectile'], blockedResources: ['mana'] },
  'no-physical': { blockedTypes: ['str_weapon', 'dex_weapon', 'phys_ranged'], blockedResources: ['stamina'] },
  'magic-only':  { blockedTypes: ['str_weapon', 'dex_weapon', 'phys_ranged'], blockedResources: ['stamina'] },
  'no-stamina-skills': { blockedTypes: [], blockedResources: ['stamina'] },
};

ASPECTSOFPOWER.professionTags = {
  repair:      'ASPECTSOFPOWER.Tag.repair',
  craft:       'ASPECTSOFPOWER.Tag.craft',
  gather:      'ASPECTSOFPOWER.Tag.gather',
  refine:      'ASPECTSOFPOWER.Tag.refine',
  preparation: 'ASPECTSOFPOWER.Tag.preparation',
  jewelry:     'ASPECTSOFPOWER.Tag.jewelry',
  armor:       'ASPECTSOFPOWER.Tag.armor',
  weapon:      'ASPECTSOFPOWER.Tag.weapon',
  clothing:    'ASPECTSOFPOWER.Tag.clothing',
  alchemy:     'ASPECTSOFPOWER.Tag.alchemy',
  metal:       'ASPECTSOFPOWER.Tag.metalMat',
  leather:     'ASPECTSOFPOWER.Tag.leatherMat',
  cloth:       'ASPECTSOFPOWER.Tag.clothMat',
  gem:         'ASPECTSOFPOWER.Tag.gem',
  wood:        'ASPECTSOFPOWER.Tag.wood',
  bone:        'ASPECTSOFPOWER.Tag.bone',
  crystal:     'ASPECTSOFPOWER.Tag.crystal',
};

/**
 * Element-to-stat mappings for crafting — DERIVED from the affinity dictionary
 * (single source of truth, 2026-07-03). item-derivation (element from an
 * item's *-affinity tag) and the craft-setup dialog read
 * craftElements[element].{stats, label}. Was hand-maintained + incomplete
 * (only 10 of 22 affinities, and an 'air' vs 'wind' key bug that dropped
 * wind gear to neutral); now every affinity's materialStats flows here and
 * the wind key is correct. `neutral` stays as the no-affinity fallback
 * (empty stats → even 1/9 spread in item-derivation).
 */
ASPECTSOFPOWER.craftElements = Object.fromEntries([
  ...Object.entries(ASPECTSOFPOWER.affinities).map(
    ([key, def]) => [key, { stats: def.materialStats, label: def.label }]
  ),
  ['neutral', { stats: [], label: 'ASPECTSOFPOWER.CraftElement.neutral' }],
]);

/**
 * Quality thresholds for crafted items (progress → quality).
 */
ASPECTSOFPOWER.craftQuality = {
  cracked:  { minProgress: 0,   rarity: 'inferior',  label: 'ASPECTSOFPOWER.CraftQuality.cracked' },
  inferior: { minProgress: 50,  rarity: 'inferior',  label: 'ASPECTSOFPOWER.CraftQuality.inferior' },
  common:   { minProgress: 200, rarity: 'common',    label: 'ASPECTSOFPOWER.CraftQuality.common' },
  uncommon: { minProgress: 500, rarity: 'uncommon',  label: 'ASPECTSOFPOWER.CraftQuality.uncommon' },
  rare:     { minProgress: 1000, rarity: 'rare',     label: 'ASPECTSOFPOWER.CraftQuality.rare' },
};

/**
 * Slot value multipliers for crafting stat/armor calculations.
 * Keyed by typeKey for weapons (since 1H and 2H differ) and by slot for everything else.
 * Lookup at craft time: typeKey first, then outputSlot.
 *
 * Slot value = armor/veil value for armor & jewelry. For shields, slot value (stat) = 0.25
 * but armor value differs (see craftShieldArmorValues).
 */
ASPECTSOFPOWER.craftSlotValues = {
  // ── Armor (slot = type) ──
  chest: 0.50, legs: 0.40, head: 0.20, bracers: 0.20, boots: 0.20,
  gloves: 0.10, back: 0.10,
  // ── Jewelry (slot = type) ──
  // Ring keeps 0.50 but its EFFECTIVE contribution divides by equipped ring
  // count (EquipmentSystem._syncEffects) — total ring budget is constant
  // regardless of how many are worn. Jewelry budget = 0.40 + 2×0.25 + 0.50
  // + 0.30 = 1.70 slot-weight = armor budget (design-jewelry-rebalance.md).
  necklace: 0.40, bracelet: 0.25, ring: 0.50, earring: 0.30,
  // ── Profession (slot = type) ──
  profWeapon: 0.25, profUtility: 0.25, profHead: 0.20, profChest: 0.50,
  profLegs: 0.40, profBoots: 0.20, profGloves: 0.10,
  // ── Weapons (per type — 1H/shields = 25%, 2H = 50%) ──
  sword: 0.25, axe: 0.25, spear: 0.25, dagger: 0.25, hammer: 0.25, rapier: 0.25,
  greatsword: 0.50, greataxe: 0.50, polearm: 0.50, staff: 0.50, bow: 0.50,
  buckler: 0.25, shield: 0.25, greatshield: 0.25,
  // Slot fallback (used by legacy non-flow callers; only relevant for weaponry slot now)
  weaponry: 0.25,
};

/**
 * Shield armor value multipliers — only used for armorBonus on shield items.
 * Shields have separate stat value (25%, see craftSlotValues) and armor value.
 */
ASPECTSOFPOWER.craftShieldArmorValues = {
  buckler:     0.30,  // small
  shield:      0.40,  // medium
  greatshield: 0.50,  // large
};

/**
 * Material value multipliers for crafting.
 */
ASPECTSOFPOWER.craftMaterialValues = {
  metal: 0.5, leather: 0.333, cloth: 0.25, jewelry: 0.5,
};

/**
 * Item types a craft skill can produce. Each entry defines:
 *   category: one of 'armaments' | 'armor' | 'jewelry' | 'profession'
 *   tags:     static system tags applied at craft time (material + affinity tags inherit dynamically)
 *   slot:     equipment slot the crafted item lives in
 * Drives the new craft flow's category + type selection dialogs.
 */
ASPECTSOFPOWER.craftItemTypes = {
  // ── Armaments (slot: weaponry) ──
  sword:        { category: 'armaments', tags: ['weapon', '1H', 'sword'],                       slot: 'weaponry' },
  axe:          { category: 'armaments', tags: ['weapon', '1H', 'axe'],                         slot: 'weaponry' },
  spear:        { category: 'armaments', tags: ['weapon', '1H', 'spear'],                       slot: 'weaponry' },
  dagger:       { category: 'armaments', tags: ['weapon', '1H', 'dagger'],                      slot: 'weaponry' },
  hammer:       { category: 'armaments', tags: ['weapon', '1H', 'hammer'],                      slot: 'weaponry' },
  rapier:       { category: 'armaments', tags: ['weapon', '1H', 'rapier'],                      slot: 'weaponry' },
  greatsword:   { category: 'armaments', tags: ['weapon', '2H', 'greatsword'],                  slot: 'weaponry' },
  greataxe:     { category: 'armaments', tags: ['weapon', '2H', 'greataxe'],                    slot: 'weaponry' },
  polearm:      { category: 'armaments', tags: ['weapon', '2H', 'polearm'],                     slot: 'weaponry' },
  quarterstaff: { category: 'armaments', tags: ['weapon', '2H', 'quarterstaff'],                slot: 'weaponry' },
  staff:        { category: 'armaments', tags: ['weapon', '2H', 'staff'],                       slot: 'weaponry' },
  wand:         { category: 'armaments', tags: ['weapon', '1H', 'wand'],                        slot: 'weaponry' },
  bow:          { category: 'armaments', tags: ['weapon', '2H', 'bow'],                         slot: 'weaponry' },
  buckler:      { category: 'armaments', tags: ['weapon', '1H', 'shield', 'buckler'],           slot: 'weaponry' },
  shield:       { category: 'armaments', tags: ['weapon', '1H', 'shield'],                      slot: 'weaponry' },
  greatshield:  { category: 'armaments', tags: ['weapon', '1H', 'shield', 'greatshield'],       slot: 'weaponry' },
  // Gauntlets as an ARMAMENT, distinct from the `gloves` armour piece: these
  // are what you hit people with. Needed before a dual-gauntlet combination
  // can be detected at all (2026-07-27).
  gauntlet:     { category: 'armaments', tags: ['weapon', '1H', 'gauntlet'],                    slot: 'weaponry' },

  // ── Armor (slot = key) ──
  chest:    { category: 'armor', tags: ['armor', 'chest'],     slot: 'chest' },
  legs:     { category: 'armor', tags: ['armor', 'legs'],      slot: 'legs' },
  head:     { category: 'armor', tags: ['armor', 'head'],      slot: 'head' },
  bracers:  { category: 'armor', tags: ['armor', 'bracers'],   slot: 'bracers' },
  boots:    { category: 'armor', tags: ['armor', 'boots'],     slot: 'boots' },
  gloves:   { category: 'armor', tags: ['armor', 'gloves'],    slot: 'gloves' },
  back:     { category: 'armor', tags: ['armor', 'back'],      slot: 'back' },

  // ── Jewelry (slot = key) ──
  necklace: { category: 'jewelry', tags: ['jewelry', 'necklace'], slot: 'necklace' },
  bracelet: { category: 'jewelry', tags: ['jewelry', 'bracelet'], slot: 'bracelet' },
  ring:     { category: 'jewelry', tags: ['jewelry', 'ring'],     slot: 'ring' },
  earring:  { category: 'jewelry', tags: ['jewelry', 'earring'],  slot: 'earring' },

  // ── Profession (slot = key) ──
  profWeapon:  { category: 'profession', tags: ['profession', 'profWeapon'],  slot: 'profWeapon' },
  profUtility: { category: 'profession', tags: ['profession', 'profUtility'], slot: 'profUtility' },
  profHead:    { category: 'profession', tags: ['profession', 'profHead'],    slot: 'profHead' },
  profChest:   { category: 'profession', tags: ['profession', 'profChest'],   slot: 'profChest' },
  profLegs:    { category: 'profession', tags: ['profession', 'profLegs'],    slot: 'profLegs' },
  profBoots:   { category: 'profession', tags: ['profession', 'profBoots'],   slot: 'profBoots' },
  profGloves:  { category: 'profession', tags: ['profession', 'profGloves'],  slot: 'profGloves' },

  // ── Refined material outputs (no slot — `isMaterial: true` on the created
  // item; feeds future crafts as the material input). The material kind is
  // resolved from these tags at craft time. Per-craft gating happens via the
  // skill's `craftAllowedTypes`.
  gem:    { category: 'material', tags: ['material', 'gem'],     slot: '' },
  ingot:  { category: 'material', tags: ['material', 'metal'],   slot: '' },
  thread: { category: 'material', tags: ['material', 'cloth'],   slot: '' },
  hide:   { category: 'material', tags: ['material', 'leather'], slot: '' },
  plank:  { category: 'material', tags: ['material', 'wood'],    slot: '' },
};

/**
 * Display labels for the four craft categories.
 */
ASPECTSOFPOWER.craftCategories = {
  armaments:  { label: 'Armaments' },
  armor:      { label: 'Armor' },
  jewelry:    { label: 'Jewelry' },
  profession: { label: 'Profession' },
  material:   { label: 'Refined Material' },
};

/**
 * Material rarity → d100 roll floor/ceiling for crafting.
 */
ASPECTSOFPOWER.craftRarityRanges = {
  inferior:  { floor: 0,  ceiling: 25 },
  common:    { floor: 0,  ceiling: 50 },
  uncommon:  { floor: 10, ceiling: 60 },
  rare:      { floor: 20, ceiling: 100 },
  epic:      { floor: 30, ceiling: 120 },
  legendary: { floor: 50, ceiling: 150 },
  mythic:    { floor: 70, ceiling: 175 },
  divine:    { floor: 100, ceiling: 200 },
};

/**
 * Craft sub-type → allowed slots and default materials.
 */
ASPECTSOFPOWER.craftTypes = {
  jewelry:  { slots: ['necklace', 'bracelet', 'ring', 'earring'], materials: ['jewelry', 'gem', 'crystal'] },
  armor:    { slots: ['chest', 'legs', 'head', 'bracers', 'boots', 'gloves', 'back'], materials: ['metal', 'leather'] },
  weapon:   { slots: ['weaponry'], materials: ['metal'] },
  clothing: { slots: ['chest', 'legs', 'head', 'gloves', 'back'], materials: ['cloth', 'leather'] },
};

/**
 * Attributes that buffs and debuffs can target via ActiveEffects.
 */
ASPECTSOFPOWER.buffableAttributes = {
  'abilities.vitality':     'ASPECTSOFPOWER.Ability.vitality.long',
  'abilities.endurance':    'ASPECTSOFPOWER.Ability.endurance.long',
  'abilities.strength':     'ASPECTSOFPOWER.Ability.strength.long',
  'abilities.dexterity':    'ASPECTSOFPOWER.Ability.dexterity.long',
  'abilities.toughness':    'ASPECTSOFPOWER.Ability.toughness.long',
  'abilities.intelligence': 'ASPECTSOFPOWER.Ability.intelligence.long',
  'abilities.willpower':    'ASPECTSOFPOWER.Ability.willpower.long',
  'abilities.wisdom':       'ASPECTSOFPOWER.Ability.wisdom.long',
  'abilities.perception':   'ASPECTSOFPOWER.Ability.perception.long',
  'defense.armor':          'ASPECTSOFPOWER.Defense.armor',
  'defense.veil':           'ASPECTSOFPOWER.Defense.veil',
  'defense.melee':          'ASPECTSOFPOWER.Defense.melee',
  'defense.ranged':         'ASPECTSOFPOWER.Defense.ranged',
  'defense.mind':           'ASPECTSOFPOWER.Defense.mind',
  'defense.soul':           'ASPECTSOFPOWER.Defense.soul',
};

/**
 * Extra effect keys that don't follow the standard `system.X.value` pattern.
 * These appear in the ActiveEffect config dropdown alongside buffableAttributes.
 */
ASPECTSOFPOWER.extraEffectKeys = {
  'system.reactions.max': 'ASPECTSOFPOWER.Defense.reactionsMax',
};

/**
 * Attribute groups for the buff/debuff UI — sorted by category.
 */
ASPECTSOFPOWER.attributeGroups = [
  {
    key: 'abilities',
    label: 'ASPECTSOFPOWER.AttributeGroup.abilities',
    attributes: [
      'abilities.vitality', 'abilities.endurance', 'abilities.strength',
      'abilities.dexterity', 'abilities.toughness', 'abilities.intelligence',
      'abilities.willpower', 'abilities.wisdom', 'abilities.perception',
    ],
  },
  {
    key: 'defense',
    label: 'ASPECTSOFPOWER.AttributeGroup.defenses',
    attributes: ['defense.melee', 'defense.ranged', 'defense.mind', 'defense.soul'],
  },
  {
    key: 'mitigation',
    label: 'ASPECTSOFPOWER.AttributeGroup.mitigation',
    attributes: ['defense.armor', 'defense.veil'],
  },
];

/**
 * Valid targets for the restoration tag.
 */
ASPECTSOFPOWER.restorationTargets = {
  self:     'ASPECTSOFPOWER.HealTarget.self',
  selected: 'ASPECTSOFPOWER.HealTarget.selected',
};

/**
 * Valid targets for the buff tag — mirror of restorationTargets.
 * Self-buffs (Stormstride, Haste, etc.) skip the target prompt and
 * apply to the caster.
 */
ASPECTSOFPOWER.buffTargets = {
  self:     'ASPECTSOFPOWER.HealTarget.self',
  selected: 'ASPECTSOFPOWER.HealTarget.selected',
};

/**
 * Resources the restoration tag can restore.
 */
ASPECTSOFPOWER.restorationResources = {
  health:  'ASPECTSOFPOWER.RestorationResource.health',
  mana:    'ASPECTSOFPOWER.RestorationResource.mana',
  stamina: 'ASPECTSOFPOWER.RestorationResource.stamina',
  barrier: 'ASPECTSOFPOWER.RestorationResource.barrier',
};

/**
 * AOE targeting modes — determines which tokens in the area are affected.
 */
ASPECTSOFPOWER.aoeTargetingModes = {
  all:     'ASPECTSOFPOWER.AOE.targetingAll',
  enemies: 'ASPECTSOFPOWER.AOE.targetingEnemies',
  allies:  'ASPECTSOFPOWER.AOE.targetingAllies',
};

/**
 * AOE template shapes.
 */
ASPECTSOFPOWER.aoeShapes = {
  circle: 'ASPECTSOFPOWER.AOE.shapeCircle',
  cone:   'ASPECTSOFPOWER.AOE.shapeCone',
  ray:    'ASPECTSOFPOWER.AOE.shapeRay',
  rect:   'ASPECTSOFPOWER.AOE.shapeRect',
};

/**
 * Consumable sub-types.
 */
ASPECTSOFPOWER.consumableTypes = {
  potion:  'ASPECTSOFPOWER.Consumable.potion',
  bomb:    'ASPECTSOFPOWER.Consumable.bomb',
  poison:  'ASPECTSOFPOWER.Consumable.poison',
  scroll:  'ASPECTSOFPOWER.Consumable.scroll',
  food:    'ASPECTSOFPOWER.Consumable.food',
  other:   'ASPECTSOFPOWER.Consumable.other',
};

/**
 * Consumable effect types — what happens when the consumable is used.
 */
ASPECTSOFPOWER.consumableEffectTypes = {
  restoration: 'ASPECTSOFPOWER.ConsumableEffect.restoration',
  buff:        'ASPECTSOFPOWER.ConsumableEffect.buff',
  poison:      'ASPECTSOFPOWER.ConsumableEffect.poison',
  bomb:        'ASPECTSOFPOWER.ConsumableEffect.bomb',
  barrier:     'ASPECTSOFPOWER.ConsumableEffect.barrier',
  repairKit:   'ASPECTSOFPOWER.ConsumableEffect.repairKit',
  ritual:      'ASPECTSOFPOWER.ConsumableEffect.ritual',
  none:        'ASPECTSOFPOWER.ConsumableEffect.none',
};

/**
 * Ritual quality scaling per design-ritual-subsystem.md Phase 2.5.
 * The ritual skill's rarity is the "machine quality" — drives the
 * progress threshold (minimum to succeed) and the cap (maximum strength
 * the Medium can store). Better materials and more mana let a ritualist
 * approach the cap of a given ritual, but going beyond requires
 * acquiring a higher-rarity version of the ritual itself.
 *
 * Progress formula: round(wisdom_mod × 0.55 + material_progress × 0.30
 *                          + mana_invested × 0.15)
 * Failure (progress < threshold) consumes materials + mana, no Medium.
 * Success stores Medium with ritualPower = min(progress, cap).
 */
/**
 * Base-grade (G/F/E, gradeIndex=0) ritual scaling. Each ritual carries
 * BOTH a rarity (from this table) and a ritualGrade (E/D/C/B/A/S);
 * higher grades scale these values by `ritualGradeStep^gradeIndex`.
 *
 * Calibration (2026-06-13, sealed-medium model — power IS the hit basis
 * and damage basis): caps map onto live E-party combat values. rare cap
 * 700 → hit ~770 / dmg 560: threatens E casters (HP 384-833), bounces
 * off bruisers. epic 1200 → hit ~1326: connects on every E PC (top
 * melee def 1124), one-shots squishies. legendary 2200 one-shots any
 * E PC — group-masterwork tier. Creator reach: best E ritualist (wis
 * ~750) solo-maxes ~560 progress with strong inputs — epic threshold
 * barely solo; legendary+ thresholds require group rituals (2 parity-
 * matched primaries for legendary, 3 for mythic, D-rank circle for
 * divine) per the group design in design-ritual-subsystem.md.
 *
 *   threshold     — min total progress for prep to succeed (else materials/mana consumed)
 *   materialFloor — min progress of the chosen material to attempt at all (clean failure, nothing consumed)
 *   cap           — max stored ritualPower on success
 */
ASPECTSOFPOWER.ritualScale = {
  inferior:  { threshold:    0, materialFloor:    0, cap:  100 },
  common:    { threshold:   30, materialFloor:    0, cap:  200 },
  uncommon:  { threshold:  100, materialFloor:    0, cap:  400 },
  rare:      { threshold:  250, materialFloor:  200, cap:  700 },
  epic:      { threshold:  500, materialFloor:  400, cap: 1200 },
  legendary: { threshold: 1100, materialFloor:  800, cap: 2200 },
  mythic:    { threshold: 2000, materialFloor: 1500, cap: 4000 },
  divine:    { threshold: 3500, materialFloor: 2500, cap: 7500 },
};

/**
 * Per-grade multiplier on the ritualScale rows. 2.5 (2026-06-13, was
 * 1.25): measured actor mod growth E→D is ~2.75× (stat values roughly
 * +1000 across D levels through the (v/1085)^0.8 curve, × the 1.25
 * grade multiplier). Under the sealed-medium model the cap must track
 * same-grade combat values or higher-grade rituals are useless in
 * their own rank's fights — at 1.25/grade a D-rare cap (875) couldn't
 * scratch D-rank defenses (~2000). No live impact at change time: all
 * existing rituals are E-grade (gradeIndex 0 → multiplier 1).
 */
ASPECTSOFPOWER.ritualGradeStep = 2.5;

/**
 * Group ritual + prep-time tuning (design-ritual-subsystem.md, RULED
 * 2026-06-13; buildable only once the activity framework landed).
 *
 * Grouping trades quality for SPEED, never power: stored power is the MEAN of
 * each participant's solo contribution, so a coven can never exceed its best
 * member and a master who brings a novice drags their own result toward the
 * middle. Parity needs no rule — the average enforces it.
 *
 * Prep time is the payoff: base cost divided by the number of hands. More
 * materials pull the other way (they extend prep), so the full lever-web is
 * "more materials = more power but longer, more people = faster but diluted."
 */
ASPECTSOFPOWER.ritualPrep = {
  // Registry key in ASPECTSOFPOWER.activities supplying the base prep cost.
  activityKey: 'ritualPrep',
  // Each material UNIT beyond the first adds this share of base prep time.
  extraMaterialTimeFactor: 0.5,
};

/**
 * Progress formula weights per design-ritual-subsystem.md Phase 2.5.
 * Sum to 1.0; "wisdom is the dominant input but materials + mana matter."
 */
ASPECTSOFPOWER.ritualProgressWeights = {
  wisdom:   0.55,
  material: 0.30,
  mana:     0.15,
};

/**
 * MULTI-MATERIAL lever (design-ritual-subsystem, ruled 2026-06-13; built
 * 2026-07-25). A prep may consume SEVERAL gems, their progress SUMMED at the
 * 0.30 material weight — the legitimate grind path across the high gates
 * ("I prepared extensively with rare reagents", not "I brought friends").
 * The rarity cap still clamps the ceiling, so more materials only helps you
 * APPROACH a ritual's cap, never exceed the rarity ladder.
 *
 * Per-rarity ITEM CAP — the trash-flood guard: you cannot dump 2,000 junk
 * gems into a common ritual. Rising with rarity means the sacrifice scales
 * with the power reached.
 */
ASPECTSOFPOWER.ritualMaxMaterials = {
  inferior:  1,
  common:    2,
  uncommon:  3,
  rare:      4,
  epic:      6,
  ancient:   8,
  legendary: 10,
  mythic:    12,
  divine:    16,
};

/**
 * Medium types — the physical form an inscribed ritual takes. Drives
 * range/geometry at activation. Phase 2.5 ships `gem` (touch/self) only;
 * `circle` and `pylon` are deferred to a later phase that needs scene-
 * region or persistent-token plumbing.
 */
ASPECTSOFPOWER.mediumTypes = {
  gem:    { label: 'ASPECTSOFPOWER.MediumType.gem',    range:   0, placement: false },
  circle: { label: 'ASPECTSOFPOWER.MediumType.circle', range:  60, placement: true  },
  pylon:  { label: 'ASPECTSOFPOWER.MediumType.pylon',  range: 300, placement: true  },
};

/**
 * Material types for equipment — determines which repair skills can target them.
 */
ASPECTSOFPOWER.materialTypes = {
  metal:   'ASPECTSOFPOWER.Material.metal',
  leather: 'ASPECTSOFPOWER.Material.leather',
  cloth:   'ASPECTSOFPOWER.Material.cloth',
  jewelry: 'ASPECTSOFPOWER.Material.jewelry',
  gem:     'ASPECTSOFPOWER.Material.gem',
  wood:    'ASPECTSOFPOWER.Material.wood',
  bone:    'ASPECTSOFPOWER.Material.bone',
  crystal: 'ASPECTSOFPOWER.Material.crystal',
};

/**
 * Equipment slot definitions — key is the slot ID, max is how many items
 * can occupy that slot simultaneously.
 */
ASPECTSOFPOWER.equipmentSlots = {
  chest:    { label: 'ASPECTSOFPOWER.Equip.Slot.chest',    max: 1, set: 'combat' },
  legs:     { label: 'ASPECTSOFPOWER.Equip.Slot.legs',     max: 1, set: 'combat' },
  head:     { label: 'ASPECTSOFPOWER.Equip.Slot.head',     max: 1, set: 'combat' },
  bracers:  { label: 'ASPECTSOFPOWER.Equip.Slot.bracers',  max: 1, set: 'combat' },
  boots:    { label: 'ASPECTSOFPOWER.Equip.Slot.boots',    max: 1, set: 'combat' },
  gloves:   { label: 'ASPECTSOFPOWER.Equip.Slot.gloves',   max: 1, set: 'combat' },
  back:     { label: 'ASPECTSOFPOWER.Equip.Slot.back',     max: 1, set: 'combat' },
  // Jewelry — applies to both combat and profession loadouts (worn at all times).
  necklace: { label: 'ASPECTSOFPOWER.Equip.Slot.necklace', max: 1, set: 'both' },
  bracelet: { label: 'ASPECTSOFPOWER.Equip.Slot.bracelet', max: 2, set: 'both' },
  ring:     { label: 'ASPECTSOFPOWER.Equip.Slot.ring',     max: 10, set: 'both' },
  earring:  { label: 'ASPECTSOFPOWER.Equip.Slot.earring',  max: 1, set: 'both' },
  weaponry: { label: 'ASPECTSOFPOWER.Equip.Slot.weaponry', max: 2, set: 'combat' },
  // Profession gear slots.
  profWeapon:  { label: 'ASPECTSOFPOWER.Equip.Slot.profWeapon',  max: 1, set: 'profession' },
  profUtility: { label: 'ASPECTSOFPOWER.Equip.Slot.profUtility', max: 1, set: 'profession' },
  profHead:    { label: 'ASPECTSOFPOWER.Equip.Slot.profHead',    max: 1, set: 'profession' },
  profChest:   { label: 'ASPECTSOFPOWER.Equip.Slot.profChest',   max: 1, set: 'profession' },
  profLegs:    { label: 'ASPECTSOFPOWER.Equip.Slot.profLegs',    max: 1, set: 'profession' },
  profBoots:   { label: 'ASPECTSOFPOWER.Equip.Slot.profBoots',   max: 1, set: 'profession' },
  profGloves:  { label: 'ASPECTSOFPOWER.Equip.Slot.profGloves',  max: 1, set: 'profession' },
};

/**
 * Rarity tiers — determines augment slot count and display color.
 */
ASPECTSOFPOWER.rarities = {
  inferior:  { label: 'ASPECTSOFPOWER.Equip.Rarity.inferior',  augments: 0, color: '#888888' },
  common:    { label: 'ASPECTSOFPOWER.Equip.Rarity.common',    augments: 1, color: '#ffffff' },
  uncommon:  { label: 'ASPECTSOFPOWER.Equip.Rarity.uncommon',  augments: 2, color: '#1eff00' },
  rare:      { label: 'ASPECTSOFPOWER.Equip.Rarity.rare',      augments: 3, color: '#0070dd' },
  epic:      { label: 'ASPECTSOFPOWER.Equip.Rarity.epic',      augments: 4, color: '#a335ee' },
  ancient:   { label: 'ASPECTSOFPOWER.Equip.Rarity.ancient',   augments: 5, color: '#c4a882' },
  legendary: { label: 'ASPECTSOFPOWER.Equip.Rarity.legendary', augments: 6, color: '#ff8000' },
  mythic:    { label: 'ASPECTSOFPOWER.Equip.Rarity.mythic',    augments: 7, color: '#e6cc80' },
  divine:    { label: 'ASPECTSOFPOWER.Equip.Rarity.divine',    augments: 8, color: '#ff4444' },
};

/**
 * Augment crafter-scaling ladder (RULED 2026-07-25): an augment's magnitude is
 * driven by the RARITY OF THE APPLYING CRAFT SKILL — "a common grants .1x of
 * the roll, uncommon .2x, etc." Read when the augment template sets
 * `scaleWithCrafter: true`; the snapshot value becomes
 * `floor(craftRoll × augmentRarityMagnifiers[skill.rarity])`.
 *
 * Same augment template, different magnitude per crafter's mastery — a divine
 * smith's Molten is 8× a common smith's. `inferior` sits a half-step below
 * common rather than 0 so an unskilled application still does something.
 */
ASPECTSOFPOWER.augmentRarityMagnifiers = {
  inferior:  0.05,
  common:    0.10,
  uncommon:  0.20,
  rare:      0.30,
  epic:      0.40,
  ancient:   0.50,
  legendary: 0.60,
  mythic:    0.70,
  divine:    0.80,
};

/**
 * Profession augment craft-bonus types — single source of truth for the
 * augment sheet's type dropdown and the craft-side bonus dispatcher.
 * Order here is the display order in the dropdown.
 *
 * `d100Reroll` is intentionally excluded — gated until resource costs are figured out.
 * See memory/design-profession-augments.md for the full design + sim references.
 */
ASPECTSOFPOWER.craftBonusTypes = {
  d100Bonus:            { label: 'ASPECTSOFPOWER.CraftBonus.d100Bonus',            scaling: 'flat-per-grade-d100' },
  craftProgress:        { label: 'ASPECTSOFPOWER.CraftBonus.craftProgress',        scaling: 'magnifier' },
  prepBonus:            { label: 'ASPECTSOFPOWER.CraftBonus.prepBonus',            scaling: 'magnifier' },
  materialPotency:      { label: 'ASPECTSOFPOWER.CraftBonus.materialPotency',      scaling: 'flat' },
  critFailReduce:       { label: 'ASPECTSOFPOWER.CraftBonus.critFailReduce',       scaling: 'magnifier-pct' },
  critSuccessThreshold: { label: 'ASPECTSOFPOWER.CraftBonus.critSuccessThreshold', scaling: 'magnifier-capped' },
  materialPreservation: { label: 'ASPECTSOFPOWER.CraftBonus.materialPreservation', scaling: 'magnifier-pct-capped' },
  // maxProgressBoost: pulled 2026-05-19. Revisit when iteration ceiling becomes
  // a tuning lever — currently it just raised theoreticalMaxProgress (display +
  // rework headroom) which had low impact in practice.
  reworkDecayReduce:    { label: 'ASPECTSOFPOWER.CraftBonus.reworkDecayReduce',    scaling: 'flat-per-grade-decay' },
};

/* -------------------------------------------- */
/*  Rank Tiers & Levelling                       */
/* -------------------------------------------- */

/**
 * Rank tiers — maps rank letter to its level range.
 */
ASPECTSOFPOWER.rankTiers = {
  G: { label: 'ASPECTSOFPOWER.Rank.G', min: 0,   max: 9 },
  F: { label: 'ASPECTSOFPOWER.Rank.F', min: 10,  max: 24 },
  E: { label: 'ASPECTSOFPOWER.Rank.E', min: 25,  max: 99 },
  D: { label: 'ASPECTSOFPOWER.Rank.D', min: 100, max: 199 },
  C: { label: 'ASPECTSOFPOWER.Rank.C', min: 200, max: 299 },
  B: { label: 'ASPECTSOFPOWER.Rank.B', min: 300, max: 399 },
  A: { label: 'ASPECTSOFPOWER.Rank.A', min: 400, max: 499 },
  S: { label: 'ASPECTSOFPOWER.Rank.S', min: 500, max: Infinity },
};

/**
 * Rank equivalence for class / profession templates: which target ranks does
 * a template assigned at a given rank actually cover? Race templates use
 * per-rank `rankGains` and are unaffected by this table.
 *
 * G and F share class / profession structure (a G template's gains apply
 * unchanged through both G-rank and F-rank levels). Higher ranks are each
 * self-contained.
 *
 * Consumed by:
 *   - mass-leveler.applyTrackLevels (engine compatibility check)
 *   - player-releveler-dialog._findTemplatesByRank (picker filtering)
 */
ASPECTSOFPOWER.rankEquivalence = {
  G: ['G', 'F'],
  F: ['F'],
  E: ['E'],
  D: ['D'],
  C: ['C'],
  B: ['B'],
  A: ['A'],
  S: ['S'],
};

/**
 * Determine rank letter from a level value.
 * @param {number} level
 * @returns {string}
 */
ASPECTSOFPOWER.getRankForLevel = function(level) {
  for (const [rank, tier] of Object.entries(ASPECTSOFPOWER.rankTiers)) {
    if (level >= tier.min && level <= tier.max) return rank;
  }
  return 'G';
};

/**
 * Level type labels for race/class/profession.
 */
ASPECTSOFPOWER.levelTypes = {
  race:       'ASPECTSOFPOWER.Level.race',
  class:      'ASPECTSOFPOWER.Level.class',
  profession: 'ASPECTSOFPOWER.Level.profession',
};