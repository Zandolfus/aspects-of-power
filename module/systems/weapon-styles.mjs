/**
 * Weapon styles + type proficiency resolution
 * (design-weapon-proficiencies.md; styles broken out as a first-class axis
 * per the 2026-07-26 ruling).
 *
 * TWO AXES, deliberately separate:
 *
 *   TYPE  — what is in your hand (hammer, axe, sword, dagger, bow...).
 *           Proficiency passives carry riders that improve what you do with
 *           that type: `tagConfig.profFor: 'hammer'`.
 *
 *   STYLE — how your hands are arranged (two-handed, dual-wield,
 *           sword-and-board...). Styles UNLOCK skills: a skill declaring
 *           `tagConfig.requiresStyle: 'dual-wield'` is unusable unless that
 *           arrangement is actually equipped.
 *
 * Styles are detected from equipped gear, never stored — so swapping weapons
 * changes what you can do immediately, with nothing to keep in sync.
 *
 * Live footprint when this was written (97 combat-capable actors):
 *   one-handed alone 19 · two-handed 9 · sword-and-board 2 ·
 *   blade-and-implement 1 · dual-wield 0
 * Dual-wield is aspirational content; the others are what people actually play.
 *
 * Console usage:
 *   const S = game.aspectsofpower.weaponStyles;
 *   S.detectStyles(actor);              // ['two-handed']
 *   S.weaponTypesOf(actor);             // ['greataxe','axe']
 *   S.canUseSkill(actor, skill);        // {allowed, reason}
 */

/** Equipped, unbroken weapon-slot items. A broken weapon arranges nothing. */
function equippedWeapons(actor) {
  return (actor?.items ?? []).filter(i =>
    i.type === 'item' && i.system?.equipped && i.system?.slot === 'weaponry'
    && !((i.system?.durability?.max ?? 0) > 0 && (i.system?.durability?.value ?? 0) <= 0));
}

const has = (item, tag) => (item?.system?.tags ?? []).includes(tag);
const isShield = (i) => has(i, 'shield') || has(i, 'greatshield') || has(i, 'buckler');
const isImplement = (i) => has(i, 'wand') || has(i, 'staff') || has(i, 'orb') || has(i, 'tome');

/**
 * Weapon TYPE keys an actor is currently wielding, resolved from the item's
 * tags against the weapon-weight table (the same table blockDR and celerity
 * read, so type detection can never drift from weight).
 */
export function weaponTypesOf(actor) {
  const table = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponWeights ?? {};
  const found = new Set();
  for (const w of equippedWeapons(actor)) {
    for (const tag of (w.system?.tags ?? [])) if (table[tag] != null) found.add(tag);
  }
  return [...found];
}

/** Weapon type keys for a single item (heaviest-first is the caller's job). */
export function weaponTypesOfItem(item) {
  const table = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponWeights ?? {};
  return (item?.system?.tags ?? []).filter(t => table[t] != null);
}

/**
 * Which styles is this actor currently in? More than one can apply — a
 * greatsword is both 'two-handed' and (trivially) 'single-weapon' — so skills
 * gate on the specific arrangement they need.
 *
 * @returns {string[]}
 */
export function detectStyles(actor) {
  const eq = equippedWeapons(actor);
  if (!eq.length) return ['unarmed'];

  const shields = eq.filter(isShield);
  const implements_ = eq.filter(isImplement);
  const melee = eq.filter(w => !isShield(w) && !isImplement(w));
  const twoHanders = eq.filter(w => has(w, '2H'));

  const styles = [];
  if (twoHanders.length && !shields.length) styles.push('two-handed');
  if (melee.length >= 2) styles.push('dual-wield');
  if (melee.length === 1 && shields.length >= 1) styles.push('sword-and-board');
  if (melee.length === 1 && implements_.length >= 1) styles.push('blade-and-implement');
  if (eq.length === 1 && melee.length === 1 && !twoHanders.length) styles.push('single-weapon');
  if (implements_.length && !melee.length) styles.push('implement-only');
  return styles.length ? styles : ['other'];
}

/** Is the actor currently in this style? */
export function hasStyle(actor, style) {
  return detectStyles(actor).includes(style);
}

/**
 * The proficiency passive governing a weapon type, if the actor has one.
 * Highest rarity wins — mastery is the rarity ladder (common trained →
 * legendary prodigy), so a better passive simply supersedes a lesser one.
 */
export function proficiencyFor(actor, weaponType) {
  const order = globalThis.CONFIG?.ASPECTSOFPOWER?.skillRarityOrder ?? [];
  let best = null, bestRank = -1;
  for (const s of (actor?.items ?? [])) {
    if (s.type !== 'skill') continue;
    const pf = s.system?.tagConfig?.profFor;
    if (!pf || pf !== weaponType) continue;
    const rank = order.indexOf(s.system?.rarity ?? '');
    if (rank >= bestRank) { best = s; bestRank = rank; }
  }
  return best;
}

/** All proficiency passives that apply to what the actor is holding. */
export function activeProficiencies(actor) {
  return weaponTypesOf(actor)
    .map(t => ({ type: t, skill: proficiencyFor(actor, t) }))
    .filter(x => x.skill);
}

/**
 * May this skill be used with the actor's current arrangement?
 * Gates on `tagConfig.requiresStyle` and `tagConfig.requiresWeaponTag`.
 */
export function canUseSkill(actor, skill) {
  const tc = skill?.system?.tagConfig ?? {};
  const needStyle = tc.requiresStyle;
  const needWeapon = tc.requiresWeaponTag;

  if (needStyle && !hasStyle(actor, needStyle)) {
    const label = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponStyles?.[needStyle]?.label ?? needStyle;
    return { allowed: false, reason: `${skill.name} needs the ${label} style — check what you have equipped.` };
  }
  if (needWeapon && !weaponTypesOf(actor).includes(needWeapon)) {
    return { allowed: false, reason: `${skill.name} requires a ${needWeapon} in hand.` };
  }
  return { allowed: true, reason: '' };
}

export const WeaponStyleHelpers = {
  weaponTypesOf, weaponTypesOfItem, detectStyles, hasStyle,
  proficiencyFor, activeProficiencies, canUseSkill,
};
