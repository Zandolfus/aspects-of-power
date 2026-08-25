/**
 * Affinity usage-gating (design-affinity-dictionary.md, RULED design-first
 * 2026-07-03).
 *
 * User's framing: affinities are passives a player unlocks and increases that
 * ALSO gate item usage — "someone with fire affinity cannot use ice affinity
 * items unless they also have ice affinity, which would be rare for a fire
 * person."
 *
 * ── THE RULE (as of 2026-07-26) ──
 * 1. Untagged gear is universal.
 * 2. OWNING the affinity supersedes everything — if you can channel it, you
 *    can use it, even while carrying its opposite.
 * 3. Otherwise you are blocked only by a DIAMETRICALLY OPPOSED affinity you
 *    hold. Merely lacking an affinity is no barrier — untrained, not fighting
 *    yourself.
 * 4. A Unity passive waives a named pair (see unifiedSets).
 * An actor with no roster is therefore never blocked by anything, which is
 * what makes the gate safe to run live.
 *
 * ── HISTORY ──
 * First shipped DISABLED under the strict reading ("must possess the
 * affinity"), because that would have blocked 105 equipped items across 18
 * actors on day one — ZERO actors declare an affinity while 127 of 410 items
 * carry an affinity tag. The opposition-only rule removes that cliff, so the
 * gate now ships ENABLED: it is inert until affinities are granted, then bites
 * only on a genuine clash.
 *
 * Roster source is direction A (affinity passives), the route already chosen in
 * design-affinity-dictionary: an actor "has" fire because they carry a passive
 * skill tagged `fire-affinity`. Actor-level tags are honoured too, so a GM can
 * stamp a creature without authoring a skill.
 *
 * Console usage:
 *   const A = game.aspectsofpower.affinity;
 *   A.actorAffinities(actor);        // what they can channel
 *   A.canUseItem(actor, item);       // {allowed, required, conflicts}
 *   A.unifiedSets(actor);            // opposed pairs they have reconciled
 *   A.auditGating();                 // what WOULD break if enabled
 */

const AFFINITY_TAG = /^(.+)-affinity$/;

function cfg() {
  return globalThis.CONFIG?.ASPECTSOFPOWER?.affinityGating ?? {};
}

/** Canonical affinity keys from the global dictionary. */
export function knownAffinities() {
  return new Set(Object.keys(globalThis.CONFIG?.ASPECTSOFPOWER?.affinities ?? {}));
}

/**
 * Pull affinity keys off a tag list. Aliases catch mis-keyed tags so they
 * degrade to the right affinity instead of resolving to nothing. (The world's
 * 26 `air-affinity` items were migrated to `wind-affinity` on 2026-07-26; the
 * alias stays as a net for future slips.)
 */
export function affinitiesFromTags(tags = []) {
  const aliases = cfg().tagAliases ?? {};
  const known = knownAffinities();
  const found = new Set();
  for (const tag of tags) {
    const m = AFFINITY_TAG.exec(String(tag));
    if (!m) continue;
    const raw = m[1];
    const key = aliases[raw] ?? raw;
    if (known.has(key)) found.add(key);
  }
  return found;
}

/**
 * DAMAGE-TYPING affinities off a tag list (ruled 2026-08-24: "an affinity is
 * an element; a family is what kind of skill it is").
 *
 * Deliberately SEPARATE from `affinitiesFromTags` above, which reads only the
 * `x-affinity` suffix because it feeds the usage GATE — an actor "has" fire
 * because of an affinity passive. Widening that would silently enlarge every
 * actor's roster and start blocking gear. Typing is the other question: what
 * IS this damage. Skills carry plain names (`fire`), gear carries either, so
 * this accepts BOTH conventions and gates on the one dictionary.
 *
 * Family words (`physical`, `magical`, `dread`) are not in the dictionary and
 * so can never leak in — that separation is the whole authoring law.
 *
 * ⚠ A tag whose name collides with an affinity (a hypothetical `light`
 * meaning lightweight) would type the skill. Verified clean world-wide at the
 * migration: 184/184 skills reproduced with ZERO spurious gains.
 */
export function typingFromTags(tags = []) {
  const aliases = cfg().tagAliases ?? {};
  const known = knownAffinities();
  const found = new Set();
  for (const tag of tags) {
    const m = AFFINITY_TAG.exec(String(tag));
    const raw = m ? m[1] : String(tag);
    const key = aliases[raw] ?? raw;
    if (known.has(key)) found.add(key);
  }
  return found;
}

/** Affinities an actor can channel: affinity passives + actor-level tags. */
export function actorAffinities(actor) {
  const found = new Set();
  for (const item of actor?.items ?? []) {
    if (item.type !== 'skill') continue;
    for (const a of affinitiesFromTags(item.system?.tags ?? [])) found.add(a);
  }
  for (const a of affinitiesFromTags(actor?.system?.tags ?? [])) found.add(a);
  return found;
}

/** Affinities an item demands of its wielder. */
export function itemAffinities(item) {
  return affinitiesFromTags(item?.system?.tags ?? []);
}

/**
 * Opposed pairs this actor has RECONCILED (RULED 2026-07-26).
 *
 * A Unity is a high-rarity learnable passive naming one opposed pair —
 * "Unity of Flame and Frost" reconciles fire and ice for its bearer. Permission
 * only: it does not fuse the affinities, grant resistance, or add damage.
 *
 * Read from `tagConfig.unifiedAffinities` rather than the skill's `-affinity`
 * tags, so RECONCILING a pair stays separate from OWNING it. A unity skill can
 * therefore be authored to grant both affinities (add the tags too) or purely
 * to resolve a conflict between affinities you already hold.
 *
 * @returns {Array<Set<string>>} one set per unity passive
 */
export function unifiedSets(actor) {
  const sets = [];
  for (const item of actor?.items ?? []) {
    if (item.type !== 'skill') continue;
    if (!(item.system?.tags ?? []).includes('unity')) continue;
    const keys = (item.system?.tagConfig?.unifiedAffinities ?? []).filter(Boolean);
    if (keys.length >= 2) sets.push(new Set(keys));
  }
  return sets;
}

/** Is this specific clash reconciled by one of the actor's unities? */
export function isUnified(actor, a, b) {
  return unifiedSets(actor).some(s => s.has(a) && s.has(b));
}

/**
 * May this actor use this item?
 *
 * @returns {{allowed:boolean, required:string[], conflicts:string[],
 *            reason:string}}
 */
export function canUseItem(actor, item) {
  const required = [...itemAffinities(item)];
  const ok = { allowed: true, required, conflicts: [], reason: '' };
  if (!cfg().enabled) return ok;
  if (!required.length) return ok;            // untagged gear is universal

  // Opposition-only, superseding the stricter "must possess the affinity"
  // reading of the 2026-07-03 ruling — that one measured at 105 blocked
  // equipped items across 18 actors on day one.
  const owned = actorAffinities(actor);
  if (!owned.size) return ok;                 // no affinity, nothing to clash

  // ── OWNERSHIP SUPERSEDES OPPOSITION (RULED 2026-07-26) ──
  // If you can channel the affinity, you can use the gear — full stop, even if
  // you also carry something that opposes it. Only an affinity you DON'T own
  // can be repelled by one you do. This is what lets a bearer of both sides of
  // a pair simply use both.
  const unowned = required.filter(a => !owned.has(a));
  if (!unowned.length) return ok;

  const dict = globalThis.CONFIG?.ASPECTSOFPOWER?.affinities ?? {};
  // Checked BOTH directions. The dictionary is symmetric today (verified: 24
  // pairs, zero asymmetric), but authoring only one side later should not
  // silently open a hole.
  const unities = unifiedSets(actor);
  const reconciled = (a, b) => unities.some(u => u.has(a) && u.has(b));
  const conflicts = [];
  for (const need of unowned) {
    const clash = [...owned].find(o =>
      ((dict[o]?.opposed ?? []).includes(need) || (dict[need]?.opposed ?? []).includes(o))
      // A Unity passive reconciles exactly this pair for its bearer.
      && !reconciled(o, need));
    if (clash) conflicts.push({ item: need, actor: clash });
  }
  if (!conflicts.length) return ok;

  return {
    allowed: false, required,
    conflicts: conflicts.map(c => `${c.item} vs your ${c.actor}`),
    reason: `${item.name} is attuned to ${conflicts.map(c => c.item).join(', ')}, `
          + `which opposes your ${[...new Set(conflicts.map(c => c.actor))].join(', ')} affinity.`,
  };
}

/**
 * Dry run the RULE regardless of the switch: who is currently blocked, and by
 * what. Also reports affinity-shaped tags that resolve to nothing (content
 * bugs). Run it after granting affinities, before anyone complains.
 */
export function auditGating({ assumeEnabled = true } = {}) {
  const wasEnabled = cfg().enabled;
  if (assumeEnabled) cfg().enabled = true;   // dry run the rule, not the switch
  const rows = [];
  let blockedEquipped = 0;
  for (const actor of game.actors) {
    const owned = [...actorAffinities(actor)];
    const equipped = actor.items.filter(i => i.type === 'item' && i.system?.equipped);
    // Audit through canUseItem itself — an audit with its own copy of the rule
    // is an audit that will eventually lie about the rule.
    const blocked = equipped
      .map(i => ({ i, v: canUseItem(actor, i) }))
      .filter(x => !x.v.allowed);
    if (!blocked.length) continue;
    blockedEquipped += blocked.length;
    rows.push({ actor: actor.name, owned,
      blocked: blocked.map(x => `${x.i.name} [${x.v.conflicts.join('; ')}]`) });
  }
  // Tags that look like affinities but resolve to nothing — content bugs.
  const unresolved = new Map();
  for (const actor of game.actors) {
    for (const i of actor.items) {
      for (const tag of (i.system?.tags ?? [])) {
        const m = AFFINITY_TAG.exec(String(tag));
        if (!m) continue;
        const aliases = cfg().tagAliases ?? {};
        const key = aliases[m[1]] ?? m[1];
        if (!knownAffinities().has(key)) unresolved.set(tag, (unresolved.get(tag) ?? 0) + 1);
      }
    }
  }
  const result = {
    enabled: wasEnabled,
    actorsAffected: rows.length,
    blockedEquippedItems: blockedEquipped,
    unresolvedAffinityTags: Object.fromEntries(unresolved),
    detail: rows,
  };
  cfg().enabled = wasEnabled;
  return result;
}

/** Hook target for the equip path; returns true when the equip may proceed. */
export function checkEquip(actor, item, { notify = true } = {}) {
  const verdict = canUseItem(actor, item);
  if (!verdict.allowed && notify) ui.notifications?.warn(verdict.reason);
  return verdict.allowed;
}

export const AffinityHelpers = {
  knownAffinities, affinitiesFromTags, actorAffinities, itemAffinities,
  unifiedSets, isUnified, canUseItem, checkEquip, auditGating,
};
