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
  // Descriptor tags (mechanical effects).
  magic:       'ASPECTSOFPOWER.Tag.magic',
  physical:    'ASPECTSOFPOWER.Tag.physical',
  vocal:       'ASPECTSOFPOWER.Tag.vocal',
  ranged:      'ASPECTSOFPOWER.Tag.ranged',
  melee:       'ASPECTSOFPOWER.Tag.melee',
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
 */
ASPECTSOFPOWER.craftSlotValues = {
  chest: 0.5, legs: 0.4, head: 0.2, bracers: 0.2, boots: 0.2,
  gloves: 0.1, back: 0.1, necklace: 0.4, bracelet: 0.3, ring: 0.5,
  earring: 0.3, weaponry: 0.25,
};

/**
 * Material value multipliers for crafting.
 */
ASPECTSOFPOWER.craftMaterialValues = {
  metal: 0.5, leather: 0.333, cloth: 0.25, jewelry: 0.5,
};

/**
 * Material rarity → d100 roll floor/ceiling for crafting.
 */
ASPECTSOFPOWER.craftRarityRanges = {
  inferior:  { floor: 1,  ceiling: 25 },
  common:    { floor: 1,  ceiling: 50 },
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