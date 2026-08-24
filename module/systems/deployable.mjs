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

  // ONE PERSISTENT CLONE PER DEPLOYABLE (triage 2026-08-23: "pylon should
  // not generate a new actor every time and should be owned by the
  // deployer"). The deployable carries a stable `deployableId` flag that
  // survives every inventory move (toObject copies keep flags), and the
  // clone actor is stamped with the same id — so redeploying finds the
  // actor made last time instead of minting another. Recovery parks the
  // clone (tokenless, itemless — inert to every aura/pylon scan, which
  // all key off the token or the carried pylon item) rather than
  // deleting it, so installed auras survive a deploy/recover cycle.
  // ⚠ Stub edits after first deploy do NOT propagate to an existing
  // clone — the stub is a birth template, not a live link.
  let deployableId = item.flags?.[FLAG_SCOPE]?.deployableId;
  let clone = deployableId
    ? game.actors.find(a => a.flags?.[FLAG_SCOPE]?.deployable?.deployableId === deployableId)
    : null;
  if (!deployableId) deployableId = foundry.utils.randomID();

  // OWNED BY THE DEPLOYER: copy the deploying actor's ownership block onto
  // the clone wholesale, so whoever plays the deployer can open and move
  // their own pylon. Replaced on every deploy (recursive:false — ownership
  // key deletion silently no-ops, so stale entries must be overwritten
  // wholesale, never deleted).
  const cloneOwnership = foundry.utils.deepClone(owner.ownership ?? { default: 0 });

  if (clone) {
    await clone.update({
      name: item.name,
      ...(item.img ? { img: item.img } : {}),
      [`flags.${FLAG_SCOPE}.deployable.ownerUuid`]: owner.uuid,
      [`flags.${FLAG_SCOPE}.deployable.itemName`]: item.name,
    });
    // Ownership separately, wholesale (the verified no-op-safe pattern).
    await clone.update({ ownership: cloneOwnership }, { recursive: false });
  } else {
    // Clone the stub as a world actor so the deployed object owns its own
    // HP and can hold the item. Named for the item, not the stub, so the
    // map reads "Pylon of Civilization" rather than "Pylon Stub".
    const cloneData = stub.toObject();
    delete cloneData._id;
    cloneData.name = item.name;
    if (item.img) cloneData.img = item.img;
    cloneData.ownership = cloneOwnership;
    foundry.utils.setProperty(cloneData, `flags.${FLAG_SCOPE}.deployable`, {
      ownerUuid: owner.uuid,
      itemName: item.name,
      deployableId,
    });
    clone = await Actor.create(cloneData);
    if (!clone) return null;
  }

  const itemData = item.toObject();
  delete itemData._id;
  itemData.system.deployOwnerUuid = owner.uuid;
  foundry.utils.setProperty(itemData, `flags.${FLAG_SCOPE}.deployableId`, deployableId);
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
 * The whole sheet-side deploy flow: ownership checks, destination pick,
 * deployItem. ONE implementation for the item sheet's Deploy button and the
 * actor sheet's inventory-row control (added 2026-08-16 — the button lived
 * only on the item sheet's Equipment tab and read as "not deployable").
 *
 * @param {Item} item  a deployable in someone's inventory
 * @returns {Promise<boolean>} true if a token was placed
 */
export async function promptAndDeploy(item) {
  const actor = item?.actor;
  if (!actor) { ui.notifications.warn('Deploy a copy that is in an inventory.'); return false; }
  if (!actor.isOwner) { ui.notifications.warn('Only the owner can deploy this.'); return false; }
  const token = actor.getActiveTokens?.()?.[0];
  if (!token) { ui.notifications.warn(`${actor.name} has no token on this scene to deploy from.`); return false; }
  const { selectDestinationOnCanvas } = await import('../canvas/destination-prompt.mjs');
  const cfg = CONFIG.ASPECTSOFPOWER.deployable ?? {};
  const dest = await selectDestinationOnCanvas(token, {
    maxDistanceFt: cfg.placeRangeFt ?? 30,
    snapToGrid: true,
    label: `Deploy ${item.name}`,
  });
  if (!dest) return false; // cancelled
  // selectDestinationOnCanvas answers in CENTRE coords; token x/y is top-left.
  const gs = canvas.grid.size;
  const placed = await deployItem(actor, item, { x: dest.x - gs / 2, y: dest.y - gs / 2 });
  return !!placed;
}

/**
 * Sheet-side recover: resolve the deployed token from the item and hand to
 * recoverDeployable as the owner. Shared by both sheets like promptAndDeploy.
 *
 * @param {Item} item  the deployed item (carried by the stub actor)
 * @returns {Promise<boolean>}
 */
export async function recoverByItem(item) {
  const tokenDoc = await fromUuid(item?.system?.deployedTokenUuid ?? '');
  if (!tokenDoc) { ui.notifications.warn('That deployment no longer exists on any scene.'); return false; }
  const owner = await fromUuid(item.system.deployOwnerUuid ?? '');
  return recoverDeployable(owner, tokenDoc);
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
  if (cloneActor?.flags?.[FLAG_SCOPE]?.deployable && !cloneActor.getActiveTokens()?.length) {
    if (cloneActor.flags[FLAG_SCOPE].deployable.deployableId) {
      // Persistent clone (2026-08-23): PARK it, don't delete. Remove the
      // deployed item copy (the original just moved back to the claimant)
      // and leave installed auras aboard — tokenless and pylon-item-less,
      // the parked actor is inert to every aura/pylon scan, and the auras
      // are waiting on the next deploy.
      await cloneActor.deleteEmbeddedDocuments('Item', [deployed.id]);
    } else {
      // Legacy clone from before persistence — still a throwaway. A linked
      // world actor that happens to hold a deployable must not be destroyed
      // (the flag gate above).
      await cloneActor.delete();
    }
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
 * ⚠ TWO GATES: the installer must carry the `leadership` tag AND own the aura.
 * The first pass had ownership alone, because no leadership concept existed in
 * the system and inventing one unasked would have created another reader with
 * no data. The user then ruled Leadership in and tagged Gabriel's profession,
 * so it is now a real gate rather than a guess.
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
  // Command gate: installing into a pylon is a Leadership act. The tag can
  // arrive from a profession, a class or a race — the engine does not care
  // which, only that it is present (the tag-driven-classes principle).
  if (!installer.hasTag?.('leadership')) {
    ui.notifications.warn(`${installer.name} has no Leadership training — only a commander can install an aura into a pylon.`);
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
