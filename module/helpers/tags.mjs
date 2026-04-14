/**
 * Tag Registry for Aspects of Power.
 * Central definition of all system tags — affinities, immunities,
 * resistances, capability gates, and passive modifiers.
 *
 * Each tag has:
 *   label:       Localization key for display
 *   category:    'affinity' | 'immunity' | 'resistance' | 'gate' | 'passive'
 *   implies:     Array of other tag IDs that this tag auto-grants
 *   description: Localization key for tooltip/description
 */

/* ------------------------------------------------------------------ */
/*  Tag Categories                                                    */
/* ------------------------------------------------------------------ */

export const TAG_CATEGORIES = {
  affinity:   { label: 'ASPECTSOFPOWER.Tag.Category.affinity',   color: '#42a5f5' },
  immunity:   { label: 'ASPECTSOFPOWER.Tag.Category.immunity',   color: '#66bb6a' },
  resistance: { label: 'ASPECTSOFPOWER.Tag.Category.resistance', color: '#ffca28' },
  gate:       { label: 'ASPECTSOFPOWER.Tag.Category.gate',       color: '#ef5350' },
  passive:    { label: 'ASPECTSOFPOWER.Tag.Category.passive',    color: '#ab47bc' },
};

/* ------------------------------------------------------------------ */
/*  Tag Registry                                                      */
/* ------------------------------------------------------------------ */

export const TAG_REGISTRY = {

  // ── Affinities ──
  'fire-affinity':        { label: 'ASPECTSOFPOWER.Tag.fire',        category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.fire.desc' },
  'ice-affinity':         { label: 'ASPECTSOFPOWER.Tag.ice',         category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.ice.desc' },
  'lightning-affinity':   { label: 'ASPECTSOFPOWER.Tag.lightning',   category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.lightning.desc' },
  'earth-affinity':       { label: 'ASPECTSOFPOWER.Tag.earth',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.earth.desc' },
  'water-affinity':       { label: 'ASPECTSOFPOWER.Tag.water',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.water.desc' },
  'wind-affinity':        { label: 'ASPECTSOFPOWER.Tag.wind',        category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.wind.desc' },
  'lunar-affinity':       { label: 'ASPECTSOFPOWER.Tag.lunar',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.lunar.desc' },
  'solar-affinity':       { label: 'ASPECTSOFPOWER.Tag.solar',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.solar.desc' },
  'space-affinity':       { label: 'ASPECTSOFPOWER.Tag.space',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.space.desc' },
  'shadow-affinity':      { label: 'ASPECTSOFPOWER.Tag.shadow',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.shadow.desc' },
  'light-affinity':       { label: 'ASPECTSOFPOWER.Tag.light',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.light.desc' },
  'nature-affinity':      { label: 'ASPECTSOFPOWER.Tag.nature',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.nature.desc' },
  'poison-affinity':      { label: 'ASPECTSOFPOWER.Tag.poison',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.poison.desc' },
  'blood-affinity':       { label: 'ASPECTSOFPOWER.Tag.blood',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.blood.desc' },
  'necromantic-affinity': { label: 'ASPECTSOFPOWER.Tag.necromantic', category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.necromantic.desc' },
  'holy-affinity':        { label: 'ASPECTSOFPOWER.Tag.holy',        category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.holy.desc' },
  'arcane-affinity':      { label: 'ASPECTSOFPOWER.Tag.arcane',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.arcane.desc' },
  'psychic-affinity':     { label: 'ASPECTSOFPOWER.Tag.psychic',     category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.Tag.psychic.desc' },

  // ── Immunities ──
  'stun-immune':        { label: 'ASPECTSOFPOWER.Tag.stunImmune',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.stunImmune.desc' },
  'paralysis-immune':   { label: 'ASPECTSOFPOWER.Tag.paralysisImmune',   category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.paralysisImmune.desc' },
  'sleep-immune':       { label: 'ASPECTSOFPOWER.Tag.sleepImmune',       category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.sleepImmune.desc' },
  'poison-immune':      { label: 'ASPECTSOFPOWER.Tag.poisonImmune',      category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.poisonImmune.desc' },
  'fear-immune':        { label: 'ASPECTSOFPOWER.Tag.fearImmune',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.fearImmune.desc' },
  'charm-immune':       { label: 'ASPECTSOFPOWER.Tag.charmImmune',       category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.charmImmune.desc' },
  'blind-immune':       { label: 'ASPECTSOFPOWER.Tag.blindImmune',       category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.blindImmune.desc' },
  'root-immune':        { label: 'ASPECTSOFPOWER.Tag.rootImmune',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.rootImmune.desc' },
  'frozen-immune':      { label: 'ASPECTSOFPOWER.Tag.frozenImmune',      category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.frozenImmune.desc' },
  'silence-immune':     { label: 'ASPECTSOFPOWER.Tag.silenceImmune',     category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.silenceImmune.desc' },
  'dismembered-immune': { label: 'ASPECTSOFPOWER.Tag.dismemberedImmune', category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.dismemberedImmune.desc' },
  'fire-immune':        { label: 'ASPECTSOFPOWER.Tag.fireImmune',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.fireImmune.desc' },
  'ice-immune':         { label: 'ASPECTSOFPOWER.Tag.iceImmune',         category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.iceImmune.desc' },
  'lightning-immune':   { label: 'ASPECTSOFPOWER.Tag.lightningImmune',   category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.Tag.lightningImmune.desc' },

  // ── Resistances (flat numeric reduction) ──
  'fire-resist':      { label: 'ASPECTSOFPOWER.Tag.fireResist',      category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.Tag.fireResist.desc' },
  'ice-resist':       { label: 'ASPECTSOFPOWER.Tag.iceResist',       category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.Tag.iceResist.desc' },
  'lightning-resist': { label: 'ASPECTSOFPOWER.Tag.lightningResist', category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.Tag.lightningResist.desc' },
  'poison-resist':    { label: 'ASPECTSOFPOWER.Tag.poisonResist',    category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.Tag.poisonResist.desc' },
  'stun-resist':      { label: 'ASPECTSOFPOWER.Tag.stunResist',      category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.Tag.stunResist.desc' },
  'fear-resist':      { label: 'ASPECTSOFPOWER.Tag.fearResist',      category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.Tag.fearResist.desc' },

  // ── Capability Gates ──
  'no-magic':          { label: 'ASPECTSOFPOWER.Tag.noMagic',         category: 'gate', implies: [], description: 'ASPECTSOFPOWER.Tag.noMagic.desc' },
  'no-ranged':         { label: 'ASPECTSOFPOWER.Tag.noRanged',        category: 'gate', implies: [], description: 'ASPECTSOFPOWER.Tag.noRanged.desc' },
  'melee-only':        { label: 'ASPECTSOFPOWER.Tag.meleeOnly',       category: 'gate', implies: [], description: 'ASPECTSOFPOWER.Tag.meleeOnly.desc' },
  'no-stamina-skills': { label: 'ASPECTSOFPOWER.Tag.noStamina',       category: 'gate', implies: [], description: 'ASPECTSOFPOWER.Tag.noStamina.desc' },
  'magic-only':        { label: 'ASPECTSOFPOWER.Tag.magicOnly',       category: 'gate', implies: [], description: 'ASPECTSOFPOWER.Tag.magicOnly.desc' },
  'no-physical':       { label: 'ASPECTSOFPOWER.Tag.noPhysical',      category: 'gate', implies: [], description: 'ASPECTSOFPOWER.Tag.noPhysical.desc' },

  // ── Passive Modifiers ──
  'armored':    { label: 'ASPECTSOFPOWER.Tag.armored',    category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.Tag.armored.desc' },
  'ethereal':   { label: 'ASPECTSOFPOWER.Tag.ethereal',   category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.Tag.ethereal.desc' },
  'heavy':      { label: 'ASPECTSOFPOWER.Tag.heavy',      category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.Tag.heavy.desc' },
  'flying':     { label: 'ASPECTSOFPOWER.Tag.flying',     category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.Tag.flying.desc' },
  'aquatic':    { label: 'ASPECTSOFPOWER.Tag.aquatic',    category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.Tag.aquatic.desc' },
  'darkvision': { label: 'ASPECTSOFPOWER.Tag.darkvision', category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.Tag.darkvision.desc' },
  'undead':     { label: 'ASPECTSOFPOWER.Tag.undead',     category: 'passive', implies: ['poison-immune', 'charm-immune'],     description: 'ASPECTSOFPOWER.Tag.undead.desc' },
  'construct':  { label: 'ASPECTSOFPOWER.Tag.construct',  category: 'passive', implies: ['stun-immune', 'poison-immune', 'charm-immune'], description: 'ASPECTSOFPOWER.Tag.construct.desc' },
};
