/**
 * Summon subsystem (per design-summon-subsystem.md).
 *
 * Builds temporary world-actor clones of a source actor with optional HP
 * overrides, drops scene tokens, tracks via flags, supports position-swap
 * and despawn. First user: Ice Clone (Willy).
 *
 * Token + cloned-actor both carry:
 *   flags['aspects-of-power'].summon = {
 *     ownerActorUuid:        source actor UUID
 *     sourceSkillUuid:       skill that summoned (for capacity tracking)
 *     summonType:            'ice_clone' / 'mana_minion' / etc.
 *     spawnedAt:             epoch ms
 *     cleanupActorOnDelete:  true → deleteToken hook will purge linked actor
 *   }
 */
export class SummonHelpers {
  /**
   * Clone source actor → temporary world actor with overrides → drop a token
   * at the target position. FIFO-evicts prior summons of (caster × summonType)
   * over capacity. Caller is responsible for picking a free square; this only
   * places the token, it doesn't check engagement.
   *
   * @param {object} opts
   * @param {Actor}  opts.sourceActor       actor to clone
   * @param {Scene} [opts.scene]            scene to drop token onto (default canvas.scene)
   * @param {{x:number,y:number}} opts.position  pixel coords (token will center here)
   * @param {string} opts.summonType        key — 'ice_clone' etc.
   * @param {string} opts.sourceSkillUuid   skill that summoned (capacity key)
   * @param {number} [opts.hpOverride=0]    0 = use source's full HP; >0 = force max+current to this
   * @param {string} [opts.namePrefix='']
   * @param {number} [opts.capacity=1]      max concurrent of (caster × this summonType)
   * @returns {Promise<{actorClone:Actor, tokenDoc:TokenDocument}|null>}
   */
  static async spawnSummon({ sourceActor, scene, position, summonType,
                              sourceSkillUuid, hpOverride = 0, namePrefix = '',
                              capacity = 1 }) {
    if (!sourceActor || !position) return null;
    scene = scene ?? canvas.scene;
    if (!scene) return null;

    // FIFO-evict over capacity for (caster × summonType).
    const existing = this.findSummonsOf(sourceActor, { summonType, scene });
    while (existing.length >= capacity) {
      const oldest = existing.shift();
      if (oldest) await this.despawnSummon(oldest);
    }

    // Build the cloned actor's source data with overrides.
    const sourceData = sourceActor.toObject();
    const cloneData = {
      ...sourceData,
      _id: undefined,
      name: `${namePrefix}${sourceActor.name}`,
      ownership: foundry.utils.deepClone(sourceActor.ownership ?? {}),
      flags: {
        ...(sourceData.flags ?? {}),
        'aspects-of-power': {
          ...(sourceData.flags?.['aspects-of-power'] ?? {}),
          summon: {
            ownerActorUuid:       sourceActor.uuid,
            sourceSkillUuid,
            summonType,
            spawnedAt:            Date.now(),
            cleanupActorOnDelete: true,
          },
        },
      },
    };
    delete cloneData._id;

    if (hpOverride > 0 && cloneData.system?.health) {
      cloneData.system.health.value = hpOverride;
      cloneData.system.health.max   = hpOverride;
    }

    // Create the actor doc.
    const created = await Actor.create(cloneData, { keepId: false });
    if (!created) return null;

    // Re-assert HP override post-prep (derived data may have re-computed max).
    if (hpOverride > 0) {
      await created.update({
        'system.health.value': hpOverride,
        'system.health.max':   hpOverride,
      });
    }

    // Build token doc at position.
    const grid = scene.grid?.size ?? 100;
    const tokenData = {
      name: created.name,
      actorId: created.id,
      actorLink: true,
      x: position.x - grid / 2,
      y: position.y - grid / 2,
      hidden: false,
      flags: {
        'aspects-of-power': {
          summon: {
            ownerActorUuid:       sourceActor.uuid,
            sourceSkillUuid,
            summonType,
            spawnedAt:            Date.now(),
            cleanupActorOnDelete: true,
          },
        },
      },
    };

    // Use the actor's default token as a base so we keep the portrait / size.
    const baseTokenData = created.prototypeToken?.toObject?.() ?? {};
    const merged = foundry.utils.mergeObject(baseTokenData, tokenData, { inplace: false });
    merged.actorId = created.id;
    merged.actorLink = true;
    merged.x = position.x - (merged.width ?? 1) * grid / 2;
    merged.y = position.y - (merged.height ?? 1) * grid / 2;

    const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [merged]);
    return { actorClone: created, tokenDoc };
  }

  /**
   * Find live summon tokens on the scene owned by actor, optionally filtered
   * by summonType. Sorted oldest → newest.
   * @param {Actor} actor
   * @param {object} [opts]
   * @param {string} [opts.summonType]
   * @param {Scene}  [opts.scene]
   * @returns {TokenDocument[]}
   */
  static findSummonsOf(actor, { summonType = null, scene = null } = {}) {
    if (!actor) return [];
    scene = scene ?? canvas.scene;
    if (!scene) return [];
    const ownerUuid = actor.uuid;
    const tokens = scene.tokens?.contents ?? [];
    const matches = tokens.filter(t => {
      const s = t.flags?.['aspects-of-power']?.summon;
      if (!s || s.ownerActorUuid !== ownerUuid) return false;
      if (summonType && s.summonType !== summonType) return false;
      return true;
    });
    matches.sort((a, b) => (a.flags['aspects-of-power'].summon.spawnedAt ?? 0)
                         - (b.flags['aspects-of-power'].summon.spawnedAt ?? 0));
    return matches;
  }

  /**
   * Atomic position swap between two tokens on the same scene.
   * Uses scene.updateEmbeddedDocuments so both updates land in a single
   * transaction and renderers see no in-between frame.
   * @param {TokenDocument} tokenDocA
   * @param {TokenDocument} tokenDocB
   */
  static async swapPositions(tokenDocA, tokenDocB) {
    if (!tokenDocA || !tokenDocB) return;
    if (tokenDocA.parent?.id !== tokenDocB.parent?.id) return;
    const scene = tokenDocA.parent;
    const ax = tokenDocA.x, ay = tokenDocA.y;
    const bx = tokenDocB.x, by = tokenDocB.y;
    await scene.updateEmbeddedDocuments('Token', [
      { _id: tokenDocA.id, x: bx, y: by },
      { _id: tokenDocB.id, x: ax, y: ay },
    ]);
  }

  /**
   * Delete a summon token. The deleteToken hook (registerSummonHooks) handles
   * cleaning up the linked cloned actor when its flag says so, so this
   * function just removes the token — manual actor deletion would race the
   * hook and double-delete.
   * @param {TokenDocument} tokenDoc
   */
  static async despawnSummon(tokenDoc) {
    if (!tokenDoc) return;
    const scene = tokenDoc.parent;
    if (scene) await scene.deleteEmbeddedDocuments('Token', [tokenDoc.id]);
  }
}

/**
 * deleteToken hook: when a summon token is deleted (manually or via despawn),
 * purge its linked cloned actor if the flag says so. Without this hook a GM
 * who right-clicks → delete on the token would leave the world actor behind.
 */
export function registerSummonHooks() {
  Hooks.on('deleteToken', async (tokenDoc, _options, _userId) => {
    if (!game.user.isGM) return;
    const summonFlag = tokenDoc.flags?.['aspects-of-power']?.summon;
    if (!summonFlag?.cleanupActorOnDelete) return;
    const actor = game.actors.get(tokenDoc.actorId);
    if (actor && actor.flags?.['aspects-of-power']?.summon?.cleanupActorOnDelete) {
      await actor.delete();
    }
  });
}
