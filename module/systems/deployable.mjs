/**
 * Deployable items (ruled 2026-08-10).
 *
 * A deployable is a RARE ITEM that is placed rather than consumed. Using it
 * spawns a stub actor to stand in for it on the map, and the item itself
 * MOVES onto that stub. That is the whole trick: the deployed thing is
 * recognised by what it carries, so nothing needs a tag describing the actor,
 * and recovering the item takes its effects with it automatically.
 *
 * Pylon of Civilization is the first: an aura sourced from a token holding a
 * pylon item reaches `activityHastePylonMult` times further
 * (systems/activities `isPylonSource`).
 *
 * RECOVERY IS OWNER-ONLY. Anyone can see the thing; only the actor who put it
 * down can pick it up. `deployOwnerUuid` is stamped at deploy time and is the
 * single authority — not token ownership, which a GM hands out for other
 * reasons entirely.
 */

import { isActingGM } from '../helpers/gm.mjs';

const FLAG_SCOPE = 'aspects-of-power';

/** Is this item a deployable that is currently placed on a scene? */
export function isDeployed(item) {
  return !!item?.system?.deployedTokenUuid;
}

/** Is this item deployable at all (a stub is configured)? */
export function isDeployable(item) {
  return !!item?.system?.deployStubActorUuid;
}

/**
 * Place a deployable: clone its stub actor, drop a token at `position`, and
 * move the item from the owner's inventory onto the clone.
 *
 * The item is MOVED, not copied. A copy would let an owner deploy the same
 * rare item repeatedly, and would leave two objects claiming to be the one
 * pylon when it came time to recover.
 *
 * @param {Actor} owner
 * @param {Item} item
 * @param {{x: number, y: number}} position  top-left canvas coords
 * @param {Scene} [scene]
 * @returns {Promise<TokenDocument|null>}
 */
export async function deployItem(owner, item, position, scene = null) {
  if (!owner || !item) return null;
  scene = scene ?? canvas.scene;
  if (!scene) return null;
  if (isDeployed(item)) {
    ui.notifications.warn(`${item.name} is already deployed.`);
    return null;
  }
  const stubUuid = item.system?.deployStubActorUuid;
  if (!stubUuid) {
    ui.notifications.warn(`${item.name} has no deployable stub configured.`);
    return null;
  }
  if (!isActingGM()) {
    // Spawning an actor and moving an item between actors are both GM-level
    // writes. Mirrors the summon subsystem's player shim.
    game.socket.emit('system.aspects-of-power', {
      action: 'aopDeployItem',
      ownerUuid: owner.uuid, itemId: item.id,
      sceneId: scene.id, position,
    });
    return null;
  }

  const stub = await fromUuid(stubUuid);
  if (!stub) {
    ui.notifications.error(`${item.name}: its stub actor no longer exists.`);
    return null;
  }

  // Clone the stub as a world actor so the deployed object owns its own HP
  // and can hold the item. Named for the item, not the stub, so the map
  // reads "Pylon of Civilization" rather than "Pylon Stub".
  const cloneData = stub.toObject();
  delete cloneData._id;
  cloneData.name = item.name;
  if (item.img) cloneData.img = item.img;
  foundry.utils.setProperty(cloneData, `flags.${FLAG_SCOPE}.deployable`, {
    ownerUuid: owner.uuid,
    itemName: item.name,
  });
  const clone = await Actor.create(cloneData);
  if (!clone) return null;

  const itemData = item.toObject();
  delete itemData._id;
  itemData.system.deployOwnerUuid = owner.uuid;
  const [placedItem] = await clone.createEmbeddedDocuments('Item', [itemData]);

  const tokenData = await clone.getTokenDocument({
    x: Math.round(position.x), y: Math.round(position.y),
    actorLink: true, disposition: 0,
  });
  const [token] = await scene.createEmbeddedDocuments('Token', [tokenData.toObject()]);
  if (!token) {
    await clone.delete();
    return null;
  }

  // Point the placed copy at its own token, then remove the carried original.
  // Order matters: if the delete failed we would rather have a deployed thing
  // that knows where it is than an owner holding a ghost.
  await placedItem.update({ 'system.deployedTokenUuid': token.uuid });
  await item.delete();

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    content: `<p><em>${owner.name} deploys <strong>${item.name}</strong>.</em></p>`,
  });
  return token;
}

/**
 * Recover a deployed item back into its owner's inventory, deleting the stub
 * token and its clone actor.
 *
 * @param {Actor} claimant  who is trying to pick it up
 * @param {TokenDocument} tokenDoc  the deployed token
 * @returns {Promise<boolean>}
 */
export async function recoverDeployable(claimant, tokenDoc) {
  const deployed = tokenDoc?.actor?.items?.find(i => i.system?.deployedTokenUuid);
  if (!deployed) return false;
  const ownerUuid = deployed.system.deployOwnerUuid;
  if (claimant?.uuid !== ownerUuid) {
    const owner = await fromUuid(ownerUuid);
    ui.notifications.warn(
      `Only ${owner?.name ?? 'its owner'} can recover ${deployed.name}.`);
    return false;
  }
  if (!isActingGM()) {
    game.socket.emit('system.aspects-of-power', {
      action: 'aopRecoverDeployable',
      claimantUuid: claimant.uuid, tokenUuid: tokenDoc.uuid,
    });
    return true;
  }

  const itemData = deployed.toObject();
  delete itemData._id;
  itemData.system.deployedTokenUuid = '';
  itemData.system.deployOwnerUuid = '';
  await claimant.createEmbeddedDocuments('Item', [itemData]);

  const cloneActor = tokenDoc.actor;
  await tokenDoc.delete();
  // Only delete the clone when it is the throwaway we made — a linked world
  // actor that happens to hold a deployable must not be destroyed.
  if (cloneActor?.flags?.[FLAG_SCOPE]?.deployable && !cloneActor.getActiveTokens()?.length) {
    await cloneActor.delete();
  }

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: claimant }),
    content: `<p><em>${claimant.name} recovers <strong>${deployed.name}</strong>.</em></p>`,
  });
  return true;
}

export function registerDeployableHooks() {
  game.socket.on('system.aspects-of-power', async (data) => {
    if (!isActingGM()) return;
    try {
      if (data?.action === 'aopDeployItem') {
        const owner = await fromUuid(data.ownerUuid);
        const item = owner?.items?.get(data.itemId);
        const scene = game.scenes.get(data.sceneId);
        if (owner && item && scene) await deployItem(owner, item, data.position, scene);
      } else if (data?.action === 'aopRecoverDeployable') {
        const claimant = await fromUuid(data.claimantUuid);
        const tokenDoc = await fromUuid(data.tokenUuid);
        if (claimant && tokenDoc) await recoverDeployable(claimant, tokenDoc);
      }
    } catch (err) {
      console.error('Aspects of Power | deployable socket handler failed', err);
    }
  });
}
