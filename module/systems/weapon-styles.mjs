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

import { proficiencyMultiplier, proficiencyHitMultiplier } from '../helpers/formulas.mjs';

/** Equipped, unbroken weapon-slot items. A broken weapon arranges nothing. */
function equippedWeapons(actor) {
  return (actor?.items ?? []).filter(i =>
    i.type === 'item' && i.system?.equipped && i.system?.slot === 'weaponry'
    && !((i.system?.durability?.max ?? 0) > 0 && (i.system?.durability?.value ?? 0) <= 0));
}

/** Hands an item occupies: 2 for a 2H-tagged weapon, 1 otherwise. Derived,
 *  never stored — a greatsword does not write 'main' twice. */
export function handsUsed(item) {
  return (item?.system?.tags ?? []).includes('2H') ? 2 : 1;
}

/**
 * The MAIN-HAND weapon (design-hand-slots, ruled 2026-08-16).
 *
 * Explicit assignment wins: the equipped weaponry item with `system.hand`
 * 'main' (a 2H weapon counts as main whatever its field says — it fills both
 * hands). With NO assignment anywhere, falls back to the legacy rule — the
 * heaviest equipped non-shield — so the bestiary, which never assigns hands,
 * behaves exactly as before this field existed.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function mainHandWeapon(actor) {
  const eq = equippedWeapons(actor);
  const explicit = eq.find(i => i.system?.hand === 'main' || handsUsed(i) === 2);
  if (explicit) return explicit;
  // Legacy fallback: heaviest non-shield (the pre-hands _resolveWeaponForSkill rule).
  const table = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponWeights ?? {};
  let best = null, bestW = 0;
  for (const i of eq) {
    if (isShield(i)) continue;
    if (i.system?.hand === 'off') continue; // an assigned off-hand never main-hands by weight
    let w = 0;
    for (const t of (i.system?.tags ?? [])) if (table[t] != null) { w = table[t]; break; }
    if (!w) w = i.system?.weight ?? 0;
    if (w > bestW) { best = i; bestW = w; }
  }
  return best;
}

/**
 * The OFF-HAND item: explicit `hand` 'off' first, else the equipped shield,
 * else the second-heaviest non-shield when two are held unassigned. Null when
 * the off hand is genuinely empty (or a 2H weapon fills it).
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function offHandWeapon(actor) {
  const eq = equippedWeapons(actor);
  if (eq.some(i => handsUsed(i) === 2)) return null; // both hands are full of one thing
  const explicit = eq.find(i => i.system?.hand === 'off');
  if (explicit) return explicit;
  const main = mainHandWeapon(actor);
  const shield = eq.find(i => isShield(i) && i !== main);
  if (shield) return shield;
  return eq.find(i => i !== main && !isShield(i)) ?? null;
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

/**
 * Every weapon TYPE key the actor is currently wielding.
 *
 * Empty hands resolve to `unarmed` rather than to nothing. Fists are a weapon
 * type with a weight (40) like any other, and without this an Unarmed
 * Proficiency could never resolve — the resolver reads equipped items, and a
 * brawler equips nothing.
 *
 * Deliberately EMPTY HANDS ONLY: holding anything at all, shield or implement
 * included, suppresses it. Modelling a free off-hand would mean deciding which
 * hand each item occupies, which nothing else in the system tracks.
 */
export function weaponTypesOf(actor) {
  const found = new Set();
  for (const w of equippedWeapons(actor)) for (const t of weaponTypesOfItem(w)) found.add(t);
  if (!found.size) found.add('unarmed');
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
  // 1H only (adversarial finding 2026-08-16, design-dual-wield-tempo): two
  // equipped GREATSWORDS are not a pair of anything — without this check
  // they detected as dual-wield and opened Twin Strike.
  const paired = melee.filter(w => has(w, '1H'));
  if (paired.length >= 2) {
    if (allAre(paired, ['dagger'])) out.push('dual-dagger');
    if (allAre(paired, ['sword', 'rapier'])) out.push('dual-sword');
    if (allAre(paired, ['gauntlet'])) out.push('dual-gauntlet');
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
    if (t.includes('greathammer')) out.push('2h-greathammer');
    if (t.some(x => ['polearm', 'spear', 'quarterstaff'].includes(x))) out.push('2h-polearm');
    out.push('two-handed');
  }

  // ── Mixed and single ──
  if (melee.length === 1 && shields.length >= 1) out.push('sword-and-board');
  if (melee.length === 1 && implements_.length >= 1) out.push('blade-and-implement');
  // A lone shield and nothing else. Without this it fell through every branch
  // into `other`, the junk bucket, which no skill can gate on — a silent hole
  // found by actually equipping one.
  if (shields.length === 1 && !melee.length && !implements_.length && !ranged.length) {
    out.push('shield-alone');
  }
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
 * LACKING A PROFICIENCY COUNTS AS RUSTY (ruled 2026-07-29) — but only for
 * actors who are PROFICIENCY-TRACKED, meaning they own at least one
 * proficiency passive. A trained fighter picking up an unfamiliar weapon
 * fumbles with it; a wolf is not "unproficient with its own teeth".
 *
 * That scoping is load-bearing. Applying the penalty literally would have hit
 * 205 of 211 actors for -33%, because 186 of them resolve through the
 * `unarmed` fallback — every beast and construct whose natural weapons carry
 * no type tag. Keying on ownership makes the rule self-scoping: grant a
 * creature proficiencies and it opts in, and the bestiary stays untouched
 * until someone decides otherwise.
 *
 * Pass `weapon` and the multiplier is judged against THAT weapon alone — which
 * is what the attack path does (ruled 2026-07-29: "it should be based on the
 * weapon you are swinging"). Omit it and the best of everything held wins,
 * which is the right answer for callers that are asking about the actor rather
 * than about one strike.
 *
 * @param {Actor} actor
 * @param {Item} [weapon] Resolve against one weapon; omit to use everything held.
 * @returns {number}
 */
export function proficiencyDamageMult(actor, weapon = null) {
  const rarities = _resolveProfRarities(actor, weapon);
  if (!rarities) return 1;
  return Math.max(...rarities.map(r => proficiencyMultiplier(r)));
}

/**
 * Proficiency multiplier for TO-HIT — same resolution as the damage mult
 * (tracked-only, untrained counts as rusty, judged against the weapon being
 * swung, best of the weapon's types), mapped through the COMPRESSED hit
 * ladder (RULED 2026-07-30, 10% per tier — see formulas.proficiencyHitMultiplier
 * for why the two ladders differ).
 *
 * @param {Actor} actor
 * @param {Item} [weapon] Resolve against one weapon; omit to use everything held.
 * @returns {number}
 */
export function proficiencyHitMult(actor, weapon = null) {
  const rarities = _resolveProfRarities(actor, weapon);
  if (!rarities) return 1;
  return Math.max(...rarities.map(r => proficiencyHitMultiplier(r)));
}

/**
 * Shared resolution for both proficiency multipliers: WHICH rarity applies.
 * Returns the per-type rarity keys, or null when the actor is neutral
 * (untracked, proficiency disabled, or no resolvable weapon types). Split out
 * 2026-07-30 when the hit multiplier landed — two copies of the tracked/
 * untrained/type-resolution policy would drift, and this policy is the
 * load-bearing part (see the scoping note above proficiencyDamageMult).
 */
function _resolveProfRarities(actor, weapon) {
  const cfg = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponProficiency ?? {};
  if (cfg.enabled === false) return null;

  // Untracked actors are neutral, exactly as before. The penalty only exists
  // for someone who has demonstrably been trained in SOMETHING.
  const tracked = (actor?.items ?? []).some(i =>
    i.type === 'skill' && i.system?.tagConfig?.profFor);
  if (!tracked) return null;

  const untrained = cfg.untrainedRarity ?? 'rusty';
  const anchor = cfg.anchor ?? 'common';
  const types = weapon ? weaponTypesOfItem(weapon) : weaponTypesOf(actor);
  if (!types.length) return null;
  return types.map(t => {
    const p = proficiencyFor(actor, t);
    // No passive at all -> untrained. A passive with NO rarity set -> the
    // anchor (neutral, multiplier 1 on both ladders) — matching the pre-split
    // behaviour where proficiencyMultiplier(null) returned 1.
    return p ? (p.system?.rarity ?? anchor) : untrained;
  });
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
 * Weight of the heaviest equipped IMPLEMENT (wand/staff/orb/tome/...), 0 if the
 * caster is holding none.
 *
 * Distinct from `heldWeaponWeight` on purpose: under the magic/melee
 * unification a cast's weight is implement + tier, and a caster with a sword
 * on their belt is not casting through the sword. Reads the same implement set
 * `getEquippedImplements` uses, so what makes a wand an implement for the
 * discount also makes it one for the weight.
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function heldImplementWeight(actor) {
  const table = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponWeights ?? {};
  let best = 0;
  for (const t of (actor?.getEquippedImplements?.() ?? [])) {
    best = Math.max(best, table[t] ?? 0);
  }
  return best;
}

/**
 * Weapon TYPE keys that satisfy a required type, INCLUDING its family.
 *
 * An author who picks `shield` means "a shield", not "the 120-weight one" —
 * before this, Shield Bash gated on the literal key and Phil's greatshield did
 * not satisfy it. Families are declared in CONFIG.weaponTypeFamilies; a key
 * with no family is its own sole member, so every existing gate is unchanged.
 *
 * @param {string} typeKey
 * @returns {string[]}
 */
export function weaponTypeFamily(typeKey) {
  const fams = globalThis.CONFIG?.ASPECTSOFPOWER?.weaponTypeFamilies ?? {};
  return fams[typeKey] ?? [typeKey];
}

/**
 * Resolve the EQUIPPED item a gear-sourced magnitude reads from.
 *
 * Selector is `<source>.<system path>` — `shield.armorBonus` means "the
 * equipped shield's system.armorBonus". Sources:
 *   shield    — the equipped shield-family item with the largest value
 *   weapon    — the heaviest equipped non-shield weapon (the strike weapon)
 *   implement — the equipped wand/staff/orb/tome with the largest value
 *
 * Exists so a buff can scale off gear instead of off its own damage roll
 * (design: John's Shield Barrier is 10% of the shield he is actually holding).
 * Returns null when nothing satisfies it, which is what makes the gate a hard
 * failure rather than a silent zero.
 *
 * @param {Actor} actor
 * @param {string} selector
 * @returns {{item:Item, value:number, source:string, path:string}|null}
 */
export function resolveGearSource(actor, selector) {
  if (!actor || !selector) return null;
  const dot = String(selector).indexOf('.');
  if (dot <= 0) return null;
  const source = selector.slice(0, dot);
  const path = selector.slice(dot + 1);
  if (!path) return null;

  const eq = equippedWeapons(actor);
  let pool;
  if (source === 'shield') pool = eq.filter(isShield);
  else if (source === 'implement') pool = eq.filter(isImplement);
  else if (source === 'weapon') pool = eq.filter(i => !isShield(i) && !isImplement(i));
  else return null;

  let best = null;
  let bestVal = 0;
  for (const i of pool) {
    const v = Number(foundry.utils.getProperty(i.system ?? {}, path));
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!best || v > bestVal) { best = i; bestVal = v; }
  }
  return best ? { item: best, value: bestVal, source, path } : null;
}

/**
 * May this skill be used with what the actor currently has, and knows?
 * Gates on `requiresStyle` (the arrangement), `requiresWeaponTag` (the type
 * in hand), `styleSkill` (the governing Passive the actor must OWN), and
 * `buffFromEquipment` (the gear the magnitude is READ FROM must be present).
 */
export function canUseSkill(actor, skill) {
  const C = globalThis.CONFIG?.ASPECTSOFPOWER ?? {};
  const tc = skill?.system?.tagConfig ?? {};

  if (tc.requiresStyle && !hasStyle(actor, tc.requiresStyle)) {
    const label = C.weaponCombinations?.[tc.requiresStyle]?.label ?? tc.requiresStyle;
    return { allowed: false, reason: `${skill.name} needs the ${label} combination — check what you have equipped.` };
  }
  if (tc.requiresWeaponTag) {
    const family = weaponTypeFamily(tc.requiresWeaponTag);
    if (!weaponTypesOf(actor).some(t => family.includes(t))) {
      return { allowed: false, reason: `${skill.name} requires a ${tc.requiresWeaponTag} in hand.` };
    }
  }
  // Gear as a blocker: a skill whose magnitude comes off an item cannot be
  // cast without that item. Refused here, before any cost is paid, rather
  // than falling through to a magnitude of zero.
  if (tc.buffFromEquipment && !resolveGearSource(actor, tc.buffFromEquipment)) {
    const src = String(tc.buffFromEquipment).split('.')[0];
    return { allowed: false, reason: `${skill.name} draws its strength from your ${src} — you have none equipped.` };
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

/**
 * Can this actor's attacks ALTERNATE hands (design-dual-wield-tempo)?
 * Both hands must hold a 1H, non-shield weapon. Shields are the guard hand —
 * sword-and-board is its own style, not a rotation.
 */
export function dualWieldEligible(actor) {
  const main = mainHandWeapon(actor);
  const off = offHandWeapon(actor);
  if (!main || !off || main === off) return false;
  if (handsUsed(main) === 2 || handsUsed(off) === 2) return false;
  if (isShield(main) || isShield(off)) return false;
  const oneH = (i) => (i.system?.tags ?? []).includes('1H');
  return oneH(main) && oneH(off);
}

/**
 * Rarity of the owned Dual Wielding style passive (highest wins, like
 * proficiencyFor), or null when untrained — the hybrid gate's key.
 */
export function dualWieldPassiveRarity(actor) {
  const order = globalThis.CONFIG?.ASPECTSOFPOWER?.skillRarityOrder ?? [];
  let best = null, bestRank = -1;
  for (const s of (actor?.items ?? [])) {
    if (s.type !== 'skill' || s.system?.skillType !== 'Passive') continue;
    if (s.name !== 'Dual Wielding') continue;
    const rank = order.indexOf(s.system?.rarity ?? '');
    if (rank >= bestRank) { best = s.system?.rarity ?? null; bestRank = rank; }
  }
  return best;
}

/** Which hand a resolved weapon is effectively in (explicit wins, else the
 *  main-hand resolution decides). Null for no weapon. */
export function handOf(actor, weapon) {
  if (!weapon) return null;
  if (weapon.system?.hand === 'main' || weapon.system?.hand === 'off') return weapon.system.hand;
  return weapon === mainHandWeapon(actor) ? 'main' : 'off';
}

export const WeaponStyleHelpers = {
  weaponTypesOf, weaponTypesOfItem, detectStyles, hasStyle,
  proficiencyFor, activeProficiencies, proficiencyDamageMult,
  heldWeaponWeight, canUseSkill, weaponTypeFamily, resolveGearSource,
  mainHandWeapon, offHandWeapon, handsUsed,
};
