/**
 * Affinity usage-gating (design-affinity-dictionary.md, RULED design-first
 * 2026-07-03).
 *
 * User's framing: affinities are passives a player unlocks and increases that
 * ALSO gate item usage — "someone with fire affinity cannot use ice affinity
 * items unless they also have ice affinity, which would be rare for a fire
 * person."
 *
 * ── SHIPPED DISABLED ON PURPOSE ──
 * `CONFIG.ASPECTSOFPOWER.affinityGating.enabled` defaults to FALSE, because as
 * of 2026-07-26 the live world cannot pass this gate: ZERO actors declare any
 * affinity, while 127 of 410 items carry an affinity tag and every PC has
 * between one and seven of them EQUIPPED. Turning it on before actors have
 * rosters would strip the party. Grant affinities first, dry-run with
 * `auditGating()`, then enable.
 *
 * Roster source is direction A (affinity passives), the route already chosen in
 * design-affinity-dictionary: an actor "has" fire because they carry a passive
 * skill tagged `fire-affinity`. Actor-level tags are honoured too, so a GM can
 * stamp a creature without authoring a skill.
 *
 * Console usage:
 *   const A = game.aspectsofpower.affinity;
 *   A.actorAffinities(actor);        // what they can channel
 *   A.canUseItem(actor, item);       // {allowed, missing, opposed}
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
 * Pull affinity keys off a tag list. Aliases are resolved here rather than in
 * the data, so a mis-keyed tag degrades to the right affinity instead of
 * silently resolving to nothing (the live world has 26 items tagged
 * `air-affinity` against a dictionary that calls it `wind`).
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
 * May this actor use this item?
 *
 * @returns {{allowed:boolean, required:string[], missing:string[],
 *            opposed:string[], reason:string}}
 */
export function canUseItem(actor, item) {
  const required = [...itemAffinities(item)];
  const ok = { allowed: true, required, missing: [], opposed: [], reason: '' };
  if (!cfg().enabled) return ok;
  if (!required.length) return ok;            // untagged gear is universal

  const owned = actorAffinities(actor);
  const missing = required.filter(a => !owned.has(a));
  if (!missing.length) return { ...ok, allowed: true };

  // Opposed affinities are the flavour of the ruling: a fire person holding an
  // ice item is not merely untrained, they are working against themselves.
  const dict = globalThis.CONFIG?.ASPECTSOFPOWER?.affinities ?? {};
  const opposed = missing.filter(a =>
    [...owned].some(o => (dict[o]?.opposed ?? []).includes(a)));

  return {
    allowed: false, required, missing, opposed,
    reason: opposed.length
      ? `${item.name} is attuned to ${opposed.join(', ')}, which opposes your affinity.`
      : `${item.name} requires the ${missing.join(', ')} affinity.`,
  };
}

/**
 * Dry run: what would break if the gate were switched on right now.
 * Report BEFORE enabling — this is the whole reason it ships disabled.
 */
export function auditGating() {
  const rows = [];
  let blockedEquipped = 0;
  for (const actor of game.actors) {
    const owned = [...actorAffinities(actor)];
    const equipped = actor.items.filter(i => i.type === 'item' && i.system?.equipped);
    const blocked = equipped.filter(i => {
      const req = [...itemAffinities(i)];
      return req.length && req.some(a => !owned.includes(a));
    });
    if (!blocked.length) continue;
    blockedEquipped += blocked.length;
    rows.push({ actor: actor.name, owned,
      blocked: blocked.map(i => `${i.name} [${[...itemAffinities(i)].join(',')}]`) });
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
  return {
    enabled: !!cfg().enabled,
    actorsAffected: rows.length,
    blockedEquippedItems: blockedEquipped,
    unresolvedAffinityTags: Object.fromEntries(unresolved),
    detail: rows,
  };
}

/** Hook target for the equip path; returns true when the equip may proceed. */
export function checkEquip(actor, item, { notify = true } = {}) {
  const verdict = canUseItem(actor, item);
  if (!verdict.allowed && notify) ui.notifications?.warn(verdict.reason);
  return verdict.allowed;
}

export const AffinityHelpers = {
  knownAffinities, affinitiesFromTags, actorAffinities, itemAffinities,
  canUseItem, checkEquip, auditGating,
};
