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
  affinity:   { label: 'ASPECTSOFPOWER.SystemTag.Category.affinity',   color: '#42a5f5' },
  immunity:   { label: 'ASPECTSOFPOWER.SystemTag.Category.immunity',   color: '#66bb6a' },
  resistance: { label: 'ASPECTSOFPOWER.SystemTag.Category.resistance', color: '#ffca28' },
  gate:       { label: 'ASPECTSOFPOWER.SystemTag.Category.gate',       color: '#ef5350' },
  passive:    { label: 'ASPECTSOFPOWER.SystemTag.Category.passive',    color: '#ab47bc' },
  size:       { label: 'ASPECTSOFPOWER.SystemTag.Category.size',       color: '#78909c' },
  path:       { label: 'ASPECTSOFPOWER.SystemTag.Category.path',       color: '#26a69a' },
};

/* ------------------------------------------------------------------ */
/*  Tag Registry                                                      */
/* ------------------------------------------------------------------ */

export const TAG_REGISTRY = {

  // ── Affinities ──
  'fire-affinity':        { label: 'ASPECTSOFPOWER.SystemTag.fire.label',        category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.fire.desc' },
  'heat-affinity':        { label: 'ASPECTSOFPOWER.SystemTag.heat.label',        category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.heat.desc' },
  'ice-affinity':         { label: 'ASPECTSOFPOWER.SystemTag.ice.label',         category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.ice.desc' },
  'lightning-affinity':   { label: 'ASPECTSOFPOWER.SystemTag.lightning.label',   category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.lightning.desc' },
  'earth-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.earth.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.earth.desc' },
  'water-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.water.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.water.desc' },
  'wind-affinity':        { label: 'ASPECTSOFPOWER.SystemTag.wind.label',        category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.wind.desc' },
  'metal-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.metal.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.metal.desc' },
  'lunar-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.lunar.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.lunar.desc' },
  'solar-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.solar.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.solar.desc' },
  'space-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.space.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.space.desc' },
  'shadow-affinity':      { label: 'ASPECTSOFPOWER.SystemTag.shadow.label',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.shadow.desc' },
  'light-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.light.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.light.desc' },
  'nature-affinity':      { label: 'ASPECTSOFPOWER.SystemTag.nature.label',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.nature.desc' },
  'poison-affinity':      { label: 'ASPECTSOFPOWER.SystemTag.poison.label',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.poison.desc' },
  'blood-affinity':       { label: 'ASPECTSOFPOWER.SystemTag.blood.label',       category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.blood.desc' },
  'necromantic-affinity': { label: 'ASPECTSOFPOWER.SystemTag.necromantic.label', category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.necromantic.desc' },
  'holy-affinity':        { label: 'ASPECTSOFPOWER.SystemTag.holy.label',        category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.holy.desc' },
  'arcane-affinity':      { label: 'ASPECTSOFPOWER.SystemTag.arcane.label',      category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.arcane.desc' },
  'psychic-affinity':     { label: 'ASPECTSOFPOWER.SystemTag.psychic.label',     category: 'affinity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.psychic.desc' },

  // ── Immunities ──
  'stun-immune':        { label: 'ASPECTSOFPOWER.SystemTag.stunImmune.label',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.stunImmune.desc' },
  'paralysis-immune':   { label: 'ASPECTSOFPOWER.SystemTag.paralysisImmune.label',   category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.paralysisImmune.desc' },
  'sleep-immune':       { label: 'ASPECTSOFPOWER.SystemTag.sleepImmune.label',       category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.sleepImmune.desc' },
  'poison-immune':      { label: 'ASPECTSOFPOWER.SystemTag.poisonImmune.label',      category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.poisonImmune.desc' },
  'fear-immune':        { label: 'ASPECTSOFPOWER.SystemTag.fearImmune.label',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.fearImmune.desc' },
  'charm-immune':       { label: 'ASPECTSOFPOWER.SystemTag.charmImmune.label',       category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.charmImmune.desc' },
  'blind-immune':       { label: 'ASPECTSOFPOWER.SystemTag.blindImmune.label',       category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.blindImmune.desc' },
  'root-immune':        { label: 'ASPECTSOFPOWER.SystemTag.rootImmune.label',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.rootImmune.desc' },
  'frozen-immune':      { label: 'ASPECTSOFPOWER.SystemTag.frozenImmune.label',      category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.frozenImmune.desc' },
  'silence-immune':     { label: 'ASPECTSOFPOWER.SystemTag.silenceImmune.label',     category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.silenceImmune.desc' },
  'dismembered-immune': { label: 'ASPECTSOFPOWER.SystemTag.dismemberedImmune.label', category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.dismemberedImmune.desc' },
  'fire-immune':        { label: 'ASPECTSOFPOWER.SystemTag.fireImmune.label',        category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.fireImmune.desc' },
  'ice-immune':         { label: 'ASPECTSOFPOWER.SystemTag.iceImmune.label',         category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.iceImmune.desc' },
  'lightning-immune':   { label: 'ASPECTSOFPOWER.SystemTag.lightningImmune.label',   category: 'immunity', implies: [], description: 'ASPECTSOFPOWER.SystemTag.lightningImmune.desc' },

  // ── Resistances (flat numeric reduction) ──
  'fire-resist':      { label: 'ASPECTSOFPOWER.SystemTag.fireResist.label',      category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.SystemTag.fireResist.desc' },
  'ice-resist':       { label: 'ASPECTSOFPOWER.SystemTag.iceResist.label',       category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.SystemTag.iceResist.desc' },
  'lightning-resist': { label: 'ASPECTSOFPOWER.SystemTag.lightningResist.label', category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.SystemTag.lightningResist.desc' },
  'poison-resist':    { label: 'ASPECTSOFPOWER.SystemTag.poisonResist.label',    category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.SystemTag.poisonResist.desc' },
  'stun-resist':      { label: 'ASPECTSOFPOWER.SystemTag.stunResist.label',      category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.SystemTag.stunResist.desc' },
  'fear-resist':      { label: 'ASPECTSOFPOWER.SystemTag.fearResist.label',      category: 'resistance', implies: [], description: 'ASPECTSOFPOWER.SystemTag.fearResist.desc' },

  // ── Capability Gates ──
  'no-magic':          { label: 'ASPECTSOFPOWER.SystemTag.noMagic.label',         category: 'gate', implies: [], description: 'ASPECTSOFPOWER.SystemTag.noMagic.desc' },
  'no-ranged':         { label: 'ASPECTSOFPOWER.SystemTag.noRanged.label',        category: 'gate', implies: [], description: 'ASPECTSOFPOWER.SystemTag.noRanged.desc' },
  'melee-only':        { label: 'ASPECTSOFPOWER.SystemTag.meleeOnly.label',       category: 'gate', implies: [], description: 'ASPECTSOFPOWER.SystemTag.meleeOnly.desc' },
  'no-stamina-skills': { label: 'ASPECTSOFPOWER.SystemTag.noStamina.label',       category: 'gate', implies: [], description: 'ASPECTSOFPOWER.SystemTag.noStamina.desc' },
  'magic-only':        { label: 'ASPECTSOFPOWER.SystemTag.magicOnly.label',       category: 'gate', implies: [], description: 'ASPECTSOFPOWER.SystemTag.magicOnly.desc' },
  'no-physical':       { label: 'ASPECTSOFPOWER.SystemTag.noPhysical.label',      category: 'gate', implies: [], description: 'ASPECTSOFPOWER.SystemTag.noPhysical.desc' },

  // ── Size ──
  'tiny':       { label: 'ASPECTSOFPOWER.SystemTag.tiny.label',       category: 'size', implies: [], description: 'ASPECTSOFPOWER.SystemTag.tiny.desc' },
  'small':      { label: 'ASPECTSOFPOWER.SystemTag.small.label',      category: 'size', implies: [], description: 'ASPECTSOFPOWER.SystemTag.small.desc' },
  'medium':     { label: 'ASPECTSOFPOWER.SystemTag.medium.label',     category: 'size', implies: [], description: 'ASPECTSOFPOWER.SystemTag.medium.desc' },
  'large':      { label: 'ASPECTSOFPOWER.SystemTag.large.label',      category: 'size', implies: [], description: 'ASPECTSOFPOWER.SystemTag.large.desc' },
  'huge':       { label: 'ASPECTSOFPOWER.SystemTag.huge.label',       category: 'size', implies: [], description: 'ASPECTSOFPOWER.SystemTag.huge.desc' },
  'gargantuan': { label: 'ASPECTSOFPOWER.SystemTag.gargantuan.label', category: 'size', implies: [], description: 'ASPECTSOFPOWER.SystemTag.gargantuan.desc' },

  // ── Passive Modifiers ──
  'armored':       { label: 'ASPECTSOFPOWER.SystemTag.armored.label',       category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.SystemTag.armored.desc' },
  'ethereal':      { label: 'ASPECTSOFPOWER.SystemTag.ethereal.label',      category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.SystemTag.ethereal.desc' },
  'heavy':         { label: 'ASPECTSOFPOWER.SystemTag.heavy.label',         category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.SystemTag.heavy.desc' },
  'flying':        { label: 'ASPECTSOFPOWER.SystemTag.flying.label',        category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.SystemTag.flying.desc' },
  'aquatic':       { label: 'ASPECTSOFPOWER.SystemTag.aquatic.label',       category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.SystemTag.aquatic.desc' },
  'darkvision':    { label: 'ASPECTSOFPOWER.SystemTag.darkvision.label',    category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.SystemTag.darkvision.desc' },
  'noncorporeal':  { label: 'ASPECTSOFPOWER.SystemTag.noncorporeal.label',  category: 'passive', implies: [],                                    description: 'ASPECTSOFPOWER.SystemTag.noncorporeal.desc' },
  // Creature types.
  'humanoid':    { label: 'ASPECTSOFPOWER.SystemTag.humanoid.label',    category: 'passive', implies: [],                                                      description: 'ASPECTSOFPOWER.SystemTag.humanoid.desc' },
  'beast':       { label: 'ASPECTSOFPOWER.SystemTag.beast.label',       category: 'passive', implies: [],                                                      description: 'ASPECTSOFPOWER.SystemTag.beast.desc' },
  'elemental':   { label: 'ASPECTSOFPOWER.SystemTag.elemental.label',   category: 'passive', implies: ['poison-immune', 'charm-immune'],                       description: 'ASPECTSOFPOWER.SystemTag.elemental.desc' },
  'demon':       { label: 'ASPECTSOFPOWER.SystemTag.demon.label',       category: 'passive', implies: [],                                                      description: 'ASPECTSOFPOWER.SystemTag.demon.desc' },
  'undead':      { label: 'ASPECTSOFPOWER.SystemTag.undead.label',      category: 'passive', implies: ['poison-immune', 'charm-immune'],                       description: 'ASPECTSOFPOWER.SystemTag.undead.desc' },
  'construct':   { label: 'ASPECTSOFPOWER.SystemTag.construct.label',   category: 'passive', implies: ['stun-immune', 'poison-immune', 'charm-immune'],        description: 'ASPECTSOFPOWER.SystemTag.construct.desc' },

  // ── Race Path Structure (mutually exclusive — drives mass-leveler race derivation) ──
  // Twofold sub-type (class-locked / profession-locked / choice) is configured on the race item itself.
  'threefold-path': { label: 'ASPECTSOFPOWER.SystemTag.threefoldPath.label', category: 'path', implies: [], description: 'ASPECTSOFPOWER.SystemTag.threefoldPath.desc' },
  'twofold-path':   { label: 'ASPECTSOFPOWER.SystemTag.twofoldPath.label',   category: 'path', implies: [], description: 'ASPECTSOFPOWER.SystemTag.twofoldPath.desc' },
  'onefold-path':   { label: 'ASPECTSOFPOWER.SystemTag.onefoldPath.label',   category: 'path', implies: [], description: 'ASPECTSOFPOWER.SystemTag.onefoldPath.desc' },
};
