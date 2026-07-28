/**
 * Weapon combinations, styles, and type proficiency
 * (design-weapon-proficiencies.md).
 *
 * THREE AXES (ruled 2026-07-27; supersedes the two-axis model of `1dc3a67`):
 *
 *   TYPE        — the weapon itself (greatsword, dagger, bow...). A proficiency
 *                 Passive declares `tagConfig.profFor` and its RARITY scales
 *                 the damage of attacks made with that type.
 *
 *   COMBINATION — how the hands are arranged, DETECTED from equipped gear and
 *                 never stored, so swapping weapons changes what you can do
 *                 immediately. `tagConfig.requiresStyle` names one.
 *
 *   STYLE       — a Passive skill you OWN that governs a set of attacks, the
 *                 way a Ritualism passive governs a body of rituals. The style
 *                 is the key; the combination is the lock. A governed attack
 *                 names its governor in `tagConfig.styleSkill`.
 *
 * Console usage:
 *   const S = game.aspectsofpower.weaponStyles;
 *   S.detectStyles(actor);                  // ['2h-greataxe','two-handed']
 *   S.weaponTypesOf(actor);                 // ['greataxe']
 *   S.proficiencyDamageMult(actor, item);   // 1.0 when untracked
 *   S.canUseSkill(actor, skill);            // {allowed, reason}
 */

import { proficiencyMultiplier } from '../helpers/formulas.mjs';

/** Equipped, unbroken weapon-slot items. A broken weapon arranges nothing. */
function equippedWeapons(actor) {
  return (actor?.items ?? []).filter(i =>
    i.type === 'item' && i.system?.equipped && i.system?.slot === 'weaponry'
    && !((i.system?.durability?.max ?? 0) > 0 && (i.system?.durability?.value ?? 0) <= 0));
}

const has = (item, tag) => (item?.system?.tags ?? []).includes(tag);
const isShield = (i) => has(i, 'shield') || has(i, 'greatshield') || has(i, 'buckler');
const isImplement = (i) => has(i, 'wand') || has(i, 'staff') || has(i, 'orb') || has(i, 'tome');

const RANGED_TYPES = ['bow', 'shortbow', 'longbow', 'crossbow', 'pistol', 'rifle', 'shotgun'];
const FIREARM_TYPES = ['pistol', 'rifle', 'shotgun'];

/**
 * Weapon TYPE keys for a single item, resolved from its tags against the
 * weapon-weight table (the same table blockDR and celerity read, so type
 * detection can never drift from weight).
 */
export function weaponTypesOfItem(item) {
  const table = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponWeights ?? {};
  return (item?.system?.tags ?? []).filter(t => table[t] != null);
}

/** Every weapon TYPE key the actor is currently wielding. */
export function weaponTypesOf(actor) {
  const found = new Set();
  for (const w of equippedWeapons(actor)) for (const t of weaponTypesOfItem(w)) found.add(t);
  return [...found];
}

const isRangedItem = (i) => weaponTypesOfItem(i).some(t => RANGED_TYPES.includes(t));

/**
 * Which combinations is this actor currently in? More than one applies by
 * design: a greataxe is both `2h-greataxe` (the discipline) and `two-handed`
 * (the generic), so a skill can gate on whichever granularity it means.
 *
 * @returns {string[]}
 */
export function detectStyles(actor) {
  const eq = equippedWeapons(actor);
  if (!eq.length) return ['unarmed'];

  const shields = eq.filter(isShield);
  const implements_ = eq.filter(isImplement);
  // RANGED is its own axis. A bow is two-handed in the literal sense but
  // shares no discipline with a greatsword; before 2026-07-27 archers fell
  // into the melee buckets and inflated every count there.
  const ranged = eq.filter(i => isRangedItem(i) && !isShield(i) && !isImplement(i));
  const melee = eq.filter(w => !isShield(w) && !isImplement(w) && !isRangedItem(w));

  const out = [];
  const typesOf = (list) => list.flatMap(weaponTypesOfItem);
  const allAre = (list, keys) => list.length > 0
    && list.every(i => weaponTypesOfItem(i).some(t => keys.includes(t)));

  // ── Ranged ──
  if (ranged.length) {
    const t = typesOf(ranged);
    if (t.some(x => FIREARM_TYPES.includes(x))) out.push('marksman');
    if (t.some(x => ['bow', 'shortbow', 'longbow', 'crossbow'].includes(x))) out.push('archery');
  }

  // ── Paired melee: discipline first, generic after ──
  if (melee.length >= 2) {
    if (allAre(melee, ['dagger'])) out.push('dual-dagger');
    if (allAre(melee, ['sword', 'rapier'])) out.push('dual-sword');
    if (allAre(melee, ['gauntlet'])) out.push('dual-gauntlet');
    out.push('dual-wield');
  }
  // Two shields is a real (if eccentric) discipline, so it is matched on the
  // shields themselves rather than falling through to sword-and-board.
  if (shields.length >= 2 && !melee.length) out.push('dual-shield');

  // ── Two-handed melee ──
  const twoHanders = melee.filter(w => has(w, '2H'));
  if (twoHanders.length && !shields.length) {
    const t = typesOf(twoHanders);
    if (t.includes('greatsword')) out.push('2h-greatsword');
    if (t.includes('greataxe')) out.push('2h-greataxe');
    if (t.some(x => ['polearm', 'spear', 'quarterstaff'].includes(x))) out.push('2h-polearm');
    out.push('two-handed');
  }

  // ── Mixed and single ──
  if (melee.length === 1 && shields.length >= 1) out.push('sword-and-board');
  if (melee.length === 1 && implements_.length >= 1) out.push('blade-and-implement');
  if (melee.length === 1 && !twoHanders.length && !shields.length && !implements_.length) {
    out.push('single-weapon');
  }
  if (implements_.length && !melee.length && !ranged.length) out.push('implement-only');

  return out.length ? [...new Set(out)] : ['other'];
}

/** Is the actor currently in this combination? */
export function hasStyle(actor, style) {
  return detectStyles(actor).includes(style);
}

/**
 * The proficiency passive governing a weapon type, if the actor owns one.
 * Highest rarity wins — mastery IS the rarity ladder, so a better passive
 * simply supersedes a lesser one.
 */
export function proficiencyFor(actor, weaponType) {
  const order = globalThis.CONFIG?.ASPECTSOFPOWER?.skillRarityOrder ?? [];
  let best = null, bestRank = -1;
  for (const s of (actor?.items ?? [])) {
    if (s.type !== 'skill') continue;
    if (s.system?.tagConfig?.profFor !== weaponType) continue;
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
 * Damage multiplier from weapon proficiency, anchored so that `common`
 * (trained) is neutral:
 *
 *   mult = skillRarities[prof.rarity].mult / skillRarities[anchor].mult
 *
 * ABSENCE IS NEUTRAL — an actor with no proficiency for the weapon in hand
 * returns 1.0, never a penalty. This is load-bearing: ~110 NPCs swing natural
 * weapons and no PC owns a proficiency yet, so penalising absence would nerf
 * the entire world on the commit that shipped it. The sub-common tiers only
 * bite when someone actually OWNS a rusty / not_proficient passive.
 *
 * When several types are held (a wand in one hand, a sword in the other) the
 * BEST applicable proficiency wins — you are credited for the hand you know.
 *
 * @param {Actor} actor
 * @param {Item} [weapon] Resolve against one weapon; omit to use everything held.
 * @returns {number}
 */
export function proficiencyDamageMult(actor, weapon = null) {
  const cfg = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponProficiency ?? {};
  if (cfg.enabled === false) return 1;

  const types = weapon ? weaponTypesOfItem(weapon) : weaponTypesOf(actor);
  const found = [];
  for (const t of types) {
    const p = proficiencyFor(actor, t);
    if (!p) continue;                       // untracked type contributes nothing
    found.push(proficiencyMultiplier(p.system?.rarity ?? null));
  }
  // No proficiency owned for anything in hand -> neutral, never a penalty.
  // Own one and it applies, including the sub-common tiers.
  return found.length ? Math.max(...found) : 1;
}

/**
 * Heaviest equipped weapon weight, used as "the mass in your hands" by the
 * parry mass rule. Shields COUNT here (unlike blockDR, which excludes them to
 * avoid double-dipping with their armorBonus) because a shield is exactly what
 * you would raise against a heavy blow — which is what makes a greatshield the
 * natural answer to a greatsword.
 *
 * Returns 0 when nothing resolvable is held; callers floor it.
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function heldWeaponWeight(actor) {
  const table = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponWeights ?? {};
  let best = 0;
  for (const w of equippedWeapons(actor)) {
    for (const t of weaponTypesOfItem(w)) best = Math.max(best, table[t] ?? 0);
  }
  return best;
}

/**
 * May this skill be used with what the actor currently has, and knows?
 * Gates on `requiresStyle` (the arrangement), `requiresWeaponTag` (the type
 * in hand), and `styleSkill` (the governing Passive the actor must OWN).
 */
export function canUseSkill(actor, skill) {
  const C = globalThis.CONFIG?.ASPECTSOFPOWER ?? {};
  const tc = skill?.system?.tagConfig ?? {};

  if (tc.requiresStyle && !hasStyle(actor, tc.requiresStyle)) {
    const label = C.weaponCombinations?.[tc.requiresStyle]?.label ?? tc.requiresStyle;
    return { allowed: false, reason: `${skill.name} needs the ${label} combination — check what you have equipped.` };
  }
  if (tc.requiresWeaponTag && !weaponTypesOf(actor).includes(tc.requiresWeaponTag)) {
    return { allowed: false, reason: `${skill.name} requires a ${tc.requiresWeaponTag} in hand.` };
  }
  // The style is a key you must own. Matched by NAME so content can be
  // authored and granted without threading ids through every skill.
  if (tc.styleSkill) {
    const owned = (actor?.items ?? []).some(i => i.type === 'skill'
      && i.system?.skillType === 'Passive' && i.name === tc.styleSkill);
    if (!owned) {
      return { allowed: false, reason: `${skill.name} is governed by ${tc.styleSkill}, which you have not learned.` };
    }
  }
  return { allowed: true, reason: '' };
}

export const WeaponStyleHelpers = {
  weaponTypesOf, weaponTypesOfItem, detectStyles, hasStyle,
  proficiencyFor, activeProficiencies, proficiencyDamageMult,
  heldWeaponWeight, canUseSkill,
};
