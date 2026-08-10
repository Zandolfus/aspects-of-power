/**
 * SPATIAL STORAGE — folded space (design-spatial-storage.md, RULED 2026-07-30).
 *
 * What is inside weighs nothing to the carrier. Three rulings shape it:
 *
 *   IT IS AN AUGMENT COSTING TWO SLOTS. Nothing about a base craft folds
 *   space — an item is an ordinary ring until a Spatial Storage augment is
 *   slotted in, and it eats two of the host's slots, so storage competes with
 *   stats, armour and damage for the same scarce resource.
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

import { chargeActionCost, isInActiveCombat } from './celerity.mjs';
import { spatialStorageRows } from '../helpers/formulas.mjs';

/** Is this item a spatial storage? */
export function isStorage(item) {
  return (item?.system?.spatialCapacity ?? 0) > 0;
}

/**
 * Spatial storage is AUGMENT-GRANTED (RULED 2026-07-30) and the augment costs
 * TWO slots, so it competes with stats, armour and damage for the same scarce
 * resource. Nothing about the base craft folds space — `spatialCapacity` is
 * written onto the host by deriveItemStats from the augment's itemBonuses,
 * and its magnitude rides the augment's scaleWithCrafter magnifier, so it is
 * the JEWELLER'S skill that decides how much space folds.
 *
 * There is deliberately no derivedCapacity() helper here: the derivation lives
 * in item-derivation with every other augment-granted field, and a second copy
 * would be exactly the kind of drift this codebase keeps paying for.
 */

/**
 * Every storage the actor owns, with live usage.
 *
 * Thin wrapper over the ONE copy of the math (helpers/formulas
 * `spatialStorageRows`), which actor.prepareDerivedData also uses. The two
 * used to be separate loops that had already drifted — only the actor's
 * produced the `over` flag — which is precisely the duplication this file's
 * own header warns against.
 */
export function storagesOf(actor) {
  return spatialStorageRows(actor?.items ?? []);
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
