/**
 * SPATIAL STORAGE — folded space (design-spatial-storage.md, RULED 2026-07-30).
 *
 * What is inside weighs nothing to the carrier. Two rulings shape it:
 *
 *   CAPACITY IS DERIVED FROM THE CRAFT, the same way armorBonus is —
 *   progress x slotValue x rarity x coef. A better jeweller makes a roomier
 *   ring, so capacity tracks the power curve instead of drifting from it.
 *
 *   RETRIEVING COSTS AN ACTION. Reaching into folded space is a turn's worth
 *   of celerity, so a spatial ring is a logistics tool rather than a free
 *   weapon-swap engine. Storing is free — putting something away as you walk
 *   is not the interesting decision.
 *
 * THE EQUIPPED RULE IS LOAD-BEARING. Contents are weightless only while the
 * storage is equipped. An unequipped ring is a ring, not a portal, and its
 * contents come crashing back onto your back. That is also what stops nesting
 * from laundering weight: a bag inside a ring is not itself equipped, so the
 * bag's CONTENTS still weigh — only the bag's own mass is hidden.
 *
 * Console usage:
 *   const S = game.aspectsofpower.spatial;
 *   S.storagesOf(actor);              // [{id, name, capacity, used, free}]
 *   await S.store(actor, itemId, ringId);
 *   await S.retrieve(actor, itemId);  // costs an action in combat
 */

import { spatialCapacityLb } from '../helpers/formulas.mjs';
import { chargeActionCost, isInActiveCombat } from './celerity.mjs';

/** Is this item a spatial storage? */
export function isStorage(item) {
  return (item?.system?.spatialCapacity ?? 0) > 0;
}

/**
 * Capacity this item SHOULD have, from its craft. Used at craft time and by
 * the backfill; the stored value is what the rest of the system reads.
 */
export function derivedCapacity(item) {
  const s = item?.system ?? {};
  const req = globalThis.CONFIG?.ASPECTSOFPOWER?.spatialStorage?.requiredTag ?? 'spatial';
  if (req && !(s.tags ?? []).includes(req)) return 0;
  return spatialCapacityLb({ progress: s.progress, slot: s.slot, rarity: s.rarity });
}

/** Every storage the actor owns, with live usage. */
export function storagesOf(actor) {
  const out = [];
  for (const item of (actor?.items ?? [])) {
    if (!isStorage(item)) continue;
    let used = 0;
    for (const inner of actor.items) {
      if (inner.system?.storedIn === item.id) used += (inner.system.weight ?? 0) * (inner.system.quantity ?? 1);
    }
    const capacity = item.system.spatialCapacity;
    out.push({ id: item.id, name: item.name, equipped: !!item.system.equipped,
               capacity, used: Math.round(used * 10) / 10,
               free: Math.round((capacity - used) * 10) / 10 });
  }
  return out;
}

/** Contents of one storage. */
export function contentsOf(actor, storageId) {
  return (actor?.items ?? []).filter(i => i.system?.storedIn === storageId);
}

/**
 * Put an item into a storage. Free — the interesting decision is getting it
 * back out, not putting it away.
 *
 * Refuses to store the storage in itself, to overfill, or to store something
 * still equipped (you cannot fold away the armour you are wearing).
 *
 * @returns {Promise<{ok:boolean, reason?:string, free?:number}>}
 */
export async function store(actor, itemId, storageId) {
  const item = actor?.items?.get(itemId);
  const storage = actor?.items?.get(storageId);
  if (!item || !storage) return { ok: false, reason: 'Item or storage not found.' };
  if (!isStorage(storage)) return { ok: false, reason: `${storage.name} is not a spatial storage.` };
  if (itemId === storageId) return { ok: false, reason: 'A storage cannot hold itself.' };
  if (item.system?.equipped) return { ok: false, reason: `Unequip ${item.name} first.` };

  const info = storagesOf(actor).find(s => s.id === storageId);
  const adding = (item.system.weight ?? 0) * (item.system.quantity ?? 1);
  if (adding > info.free) {
    return { ok: false, reason: `${storage.name} has ${info.free} lb free; ${item.name} is ${Math.round(adding)} lb.` };
  }
  await item.update({ 'system.storedIn': storageId });
  return { ok: true, free: Math.round((info.free - adding) * 10) / 10 };
}

/**
 * Take an item back out. COSTS AN ACTION in combat — reaching into folded
 * space is a turn's worth of celerity (config.spatialStorage
 * .retrieveWaitFraction). Out of combat it is free, since there is no clock.
 *
 * @returns {Promise<{ok:boolean, reason?:string, waitCost?:number}>}
 */
export async function retrieve(actor, itemId) {
  const item = actor?.items?.get(itemId);
  if (!item) return { ok: false, reason: 'Item not found.' };
  if (!item.system?.storedIn) return { ok: false, reason: `${item.name} is not in storage.` };

  let waitCost = 0;
  if (isInActiveCombat(actor)) {
    const frac = CONFIG.ASPECTSOFPOWER.spatialStorage?.retrieveWaitFraction ?? 1.0;
    waitCost = await chargeActionCost(actor, frac);
  }
  await item.update({ 'system.storedIn': '' });
  return { ok: true, waitCost };
}
