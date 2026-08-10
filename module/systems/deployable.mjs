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

/**
 * Install an aura skill into a deployed pylon (user, 2026-08-10: "a pylon is
 * also a place for Leadership professions to deploy specific auras").
 *
 * The pylon does not own an aura of its own. A commander installs one, and
 * from then on the PYLON is the aura's source — which is the whole point,
 * because `activityHasteFor` multiplies an aura's radius by the skill's
 * `activityHastePylonMult` when its source holds a pylon item. Gabriel's Call
 * to Arms is authored at radius 60 with a pylon multiplier of 10, so hosted it
 * covers 600 ft and keeps covering it after he walks away.
 *
 * ⚠ GATED ON OWNING THE SKILL, not on a profession. There is no `leadership`
 * profession tag in the system — inventing one here would have created a
 * fourth orphaned reader. Owning the aura is already the real restriction:
 * exactly one actor in the world has Call to Arms.
 *
 * @param {Actor} installer
 * @param {TokenDocument} pylonToken
 * @param {Item} skill  an aura skill the installer owns
 * @returns {Promise<boolean>}
 */
export async function installAuraInPylon(installer, pylonToken, skill) {
  const pylon = pylonToken?.actor;
  if (!pylon || !skill) return false;
  if (!isPylonActor(pylon)) {
    ui.notifications.warn(`${pylonToken?.name ?? 'That'} is not a deployed pylon.`);
    return false;
  }
  if (!installer?.items?.get(skill.id)) {
    ui.notifications.warn(`${installer?.name ?? 'You'} does not own ${skill.name}.`);
    return false;
  }
  if (!((skill.system?.tagConfig?.auraRadius ?? 0) > 0)) {
    ui.notifications.warn(`${skill.name} has no aura radius to project.`);
    return false;
  }
  if (pylon.items.some(i => i.name === skill.name)) {
    ui.notifications.warn(`${skill.name} is already installed in this pylon.`);
    return false;
  }
  if (!isActingGM()) {
    game.socket.emit('system.aspects-of-power', {
      action: 'aopInstallPylonAura',
      installerUuid: installer.uuid, skillId: skill.id, tokenUuid: pylonToken.uuid,
    });
    return true;
  }

  const data = skill.toObject();
  delete data._id;
  foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.installedBy`, installer.uuid);
  await pylon.createEmbeddedDocuments('Item', [data]);
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: installer }),
    content: `<p><em>${installer.name} installs <strong>${skill.name}</strong> into ${pylonToken.name}.</em></p>`,
  });
  return true;
}

/** Remove an installed aura from a pylon. Only the installer may take it back. */
export async function uninstallAuraFromPylon(claimant, pylonToken, skillName) {
  const pylon = pylonToken?.actor;
  const installed = pylon?.items?.find(i => i.name === skillName
    && i.flags?.[FLAG_SCOPE]?.installedBy);
  if (!installed) return false;
  if (installed.flags[FLAG_SCOPE].installedBy !== claimant?.uuid) {
    ui.notifications.warn(`Only whoever installed ${skillName} can remove it.`);
    return false;
  }
  if (!isActingGM()) {
    game.socket.emit('system.aspects-of-power', {
      action: 'aopUninstallPylonAura',
      claimantUuid: claimant.uuid, tokenUuid: pylonToken.uuid, skillName,
    });
    return true;
  }
  await installed.delete();
  return true;
}

/** Does this actor carry a pylon item — i.e. is it a deployed pylon? */
export function isPylonActor(actor) {
  for (const item of actor?.items ?? []) {
    if ((item.system?.tags ?? []).includes('pylon')) return true;
  }
  return false;
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
      } else if (data?.action === 'aopInstallPylonAura') {
        const installer = await fromUuid(data.installerUuid);
        const tokenDoc = await fromUuid(data.tokenUuid);
        const skill = installer?.items?.get(data.skillId);
        if (installer && tokenDoc && skill) await installAuraInPylon(installer, tokenDoc, skill);
      } else if (data?.action === 'aopUninstallPylonAura') {
        const claimant = await fromUuid(data.claimantUuid);
        const tokenDoc = await fromUuid(data.tokenUuid);
        if (claimant && tokenDoc) await uninstallAuraFromPylon(claimant, tokenDoc, data.skillName);
      }
    } catch (err) {
      console.error('Aspects of Power | deployable socket handler failed', err);
    }
  });
}
