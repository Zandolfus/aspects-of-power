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
  // Orb implement: cumulative spell weight required to discharge the next
  // spell cast as free + fast. Set at Major-tier weight (400) so:
  //   Basic spam (banks 130/cast):  every 4th cast discharges
  //   High spam (banks 150/cast):   every 4th cast discharges
  //   Greater spam (banks 200/cast): every 3rd cast discharges
  //   Major/Grand: every cast discharges (each banks ≥ threshold)
  // Universal across tiers per design 2026-05-06 — Wand stays the speed
  // king on Basic; Orb is the mana-economy alternative.
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
  // Triggers.
  on_death:    'ASPECTSOFPOWER.Tag.on_death',
  // Chain conditional.
  requires_armor_pierce: 'ASPECTSOFPOWER.Tag.requires_armor_pierce',
  // Mine-pair (summon places, generic Detonate consumes any).
  mine:        'ASPECTSOFPOWER.Tag.mine',
  detonate:    'ASPECTSOFPOWER.Tag.detonate',
  // Descriptors.
  magic:       'ASPECTSOFPOWER.Tag.magic',
  physical:    'ASPECTSOFPOWER.Tag.physical',
  vocal:       'ASPECTSOFPOWER.Tag.vocal',
  ranged:      'ASPECTSOFPOWER.Tag.ranged',
  melee:       'ASPECTSOFPOWER.Tag.melee',
  // Affinities.
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
 * Affinity skill tags — auto-populate the skill's affinities array.
 */
ASPECTSOFPOWER.affinityTags = new Set([
  'fire', 'heat', 'ice', 'lightning', 'earth', 'water', 'wind', 'metal',
  'lunar', 'solar', 'space', 'shadow', 'light', 'nature',
  'poison', 'blood', 'necromantic', 'holy', 'arcane', 'psychic',
]);

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
 * Element-to-stat mappings for crafting.
 */
ASPECTSOFPOWER.craftElements = {
  solar:     { stats: ['vitality', 'perception', 'endurance'],     label: 'ASPECTSOFPOWER.CraftElement.solar' },
  lunar:     { stats: ['intelligence', 'willpower', 'wisdom'],     label: 'ASPECTSOFPOWER.CraftElement.lunar' },
  water:     { stats: ['wisdom', 'willpower', 'endurance'],        label: 'ASPECTSOFPOWER.CraftElement.water' },
  fire:      { stats: ['strength', 'vitality', 'dexterity'],       label: 'ASPECTSOFPOWER.CraftElement.fire' },
  earth:     { stats: ['strength', 'endurance', 'vitality'],       label: 'ASPECTSOFPOWER.CraftElement.earth' },
  air:       { stats: ['dexterity', 'endurance', 'perception'],    label: 'ASPECTSOFPOWER.CraftElement.air' },
  lightning: { stats: ['dexterity', 'perception', 'vitality'],     label: 'ASPECTSOFPOWER.CraftElement.lightning' },
  ice:       { stats: ['intelligence', 'perception', 'toughness'], label: 'ASPECTSOFPOWER.CraftElement.ice' },
  space:     { stats: ['perception', 'willpower', 'endurance'],    label: 'ASPECTSOFPOWER.CraftElement.space' },
  neutral:   { stats: [],                                          label: 'ASPECTSOFPOWER.CraftElement.neutral' },
};

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
  necklace: 0.40, bracelet: 0.30, ring: 0.50, earring: 0.30,
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
};

/**
 * Display labels for the four craft categories.
 */
ASPECTSOFPOWER.craftCategories = {
  armaments:  { label: 'Armaments' },
  armor:      { label: 'Armor' },
  jewelry:    { label: 'Jewelry' },
  profession: { label: 'Profession' },
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
  none:        'ASPECTSOFPOWER.ConsumableEffect.none',
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
  maxProgressBoost:     { label: 'ASPECTSOFPOWER.CraftBonus.maxProgressBoost',     scaling: 'magnifier-pct' },
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