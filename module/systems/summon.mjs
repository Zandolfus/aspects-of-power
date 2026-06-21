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
   * @param {object} [opts.aiFlags=null]    AI flags (aiProfile/aiPathfind/…) to stamp on the clone, from resolveAiBehaviors
   * @returns {Promise<{actorClone:Actor, tokenDoc:TokenDocument}|null>}
   */
  static async spawnSummon({ sourceActor, scene, position, summonType,
                              sourceSkillUuid, hpOverride = 0, namePrefix = '',
                              capacity = 1, aiFlags = null }) {
    if (!sourceActor || !position) return null;
    scene = scene ?? canvas.scene;
    if (!scene) return null;

    // Player-permission shim: Actor.create requires GM. If the caller isn't
    // GM, route the request through the socket so a GM client does the work
    // and returns the resulting actor + token UUIDs. Mirrors the GM-action
    // pattern used for region create/delete elsewhere.
    if (!game.user.isGM) {
      return _requestGMSpawn('spawnSummon', {
        sourceActorUuid: sourceActor.uuid,
        sceneId:         scene.id,
        position,
        summonType,
        sourceSkillUuid,
        hpOverride,
        namePrefix,
        capacity,
        aiFlags,
      });
    }

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
          ...(aiFlags ?? {}),   // AI behavior flags (aiProfile/aiPathfind/…) onto the clone
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
   * Atomic position swap between two tokens on the same scene. Uses bulk
   * updateEmbeddedDocuments with `animate:false` so v14's movement-action
   * pipeline doesn't queue/throttle the second update behind the first
   * (sequential animated updates would land the second op stale-state and
   * silently drop the swap).
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
    ], { animate: false });
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

  /**
   * Tower spawn (per plan pure-gathering-ullman.md, 2026-05-29). Clones from
   * a stub NPC actor (not the summoner), applies `ritualPower × statDistribution`
   * as ability-score overrides, sets AI flags, drops a token on the scene.
   * Auto-registers as combatant if active combat (Foundry default behavior
   * when a token enters a combat-active scene).
   *
   * Stub provides the "kind of construct" identity (token art, prototype
   * disposition, default tags). statDistribution + ritualPower provide the
   * "how strong" axis. AI flags provide the autonomous behavior.
   *
   * @param {object} opts
   * @param {string} opts.stubActorUuid       UUID of the stub NPC to clone from
   * @param {Scene} [opts.scene]              default canvas.scene
   * @param {{x:number,y:number}} opts.position
   * @param {string} opts.ownerActorUuid      summoner (for capacity tracking + summon flag)
   * @param {number} opts.ritualPower         total stat budget
   * @param {object} opts.statDistribution    { ability: weight }, weights ideally sum to 1.0
   * @param {string} opts.aiProfile           AI profile key (default 'primitive')
   * @param {string} opts.aiSkillUuid         skill UUID the AI fires each turn
   * @param {string} opts.summonType          for findSummonsOf grouping (e.g. 'lightstream_prism')
   * @param {string} opts.sourceSkillUuid     the summon-side skill (for capacity tracking)
   * @param {number} [opts.capacity=1]
   * @param {string[]} [opts.extraTags=[]]    pushed onto stub's tags (deduped)
   * @param {string} [opts.namePrefix='']
   * @returns {Promise<{actorClone:Actor, tokenDoc:TokenDocument}|null>}
   */
  static async spawnTower({ stubActorUuid, scene, position, ownerActorUuid,
                              ritualPower, statDistribution, aiProfile = 'primitive',
                              aiSkillUuid, summonType, sourceSkillUuid,
                              capacity = 1, extraTags = [], namePrefix = '', aiFlags = null }) {
    if (!stubActorUuid || !position || !ownerActorUuid) return null;
    scene = scene ?? canvas.scene;
    if (!scene) return null;

    // Player-permission shim — see spawnSummon's note. Route through GM.
    if (!game.user.isGM) {
      return _requestGMSpawn('spawnTower', {
        stubActorUuid, sceneId: scene.id, position, ownerActorUuid,
        ritualPower, statDistribution, aiProfile, aiSkillUuid, summonType,
        sourceSkillUuid, capacity, extraTags, namePrefix, aiFlags,
      });
    }

    const stub = await fromUuid(stubActorUuid);
    if (!stub) {
      ui.notifications.warn(`spawnTower: stub actor ${stubActorUuid} not found.`);
      return null;
    }

    const ownerActor = await fromUuid(ownerActorUuid);
    if (!ownerActor) return null;

    // FIFO-evict over capacity for (owner × summonType)
    const existing = this.findSummonsOf(ownerActor, { summonType, scene });
    while (existing.length >= capacity) {
      const oldest = existing.shift();
      if (oldest) await this.despawnSummon(oldest);
    }

    // Build clone from stub. Strip the stub's _id.
    const stubData = stub.toObject();
    const cloneData = {
      ...stubData,
      _id: undefined,
      name: `${namePrefix}${stubData.name}`,
      ownership: foundry.utils.deepClone(ownerActor.ownership ?? {}),
      flags: {
        ...(stubData.flags ?? {}),
        'aspects-of-power': {
          ...(stubData.flags?.['aspects-of-power'] ?? {}),
          summon: {
            ownerActorUuid,
            sourceSkillUuid,
            summonType,
            spawnedAt:            Date.now(),
            cleanupActorOnDelete: true,
          },
        },
        aspectsofpower: {
          ...(stubData.flags?.aspectsofpower ?? {}),
          aiProfile,
          aiSkillUuid,
          ...(aiFlags ?? {}),   // granular behavior faculties (aiPathfind/…); aiProfile here wins if set
        },
      },
    };
    delete cloneData._id;

    // Apply stat distribution to abilities BEFORE create — so prepareDerivedData
    // computes mod / HP / mana / defenses against the correct values from the start.
    cloneData.system = cloneData.system ?? {};
    cloneData.system.abilities = { ...(cloneData.system.abilities ?? {}) };
    for (const [ability, weight] of Object.entries(statDistribution ?? {})) {
      const value = Math.round(ritualPower * weight);
      cloneData.system.abilities[ability] = {
        ...(cloneData.system.abilities[ability] ?? {}),
        value,
      };
    }

    // Inherit the OWNER's race level (RL) onto the tower for parity. Channel
    // tick cadence + any other RL-derived rates use the actor's own race
    // level — without this the tower defaults to the stub's RL (or fallback
    // 25), ticking meaningfully slower than the summoner's natural rhythm.
    // Per user 2026-05-30: "Willy's summoned construct exists at Willy's tier."
    const ownerRL = ownerActor.system?.attributes?.race?.level ?? null;
    if (ownerRL != null) {
      cloneData.system.attributes = cloneData.system.attributes ?? {};
      cloneData.system.attributes.race = {
        ...(cloneData.system.attributes.race ?? {}),
        level: ownerRL,
      };
    }

    // Push extra tags onto system.tags (deduped).
    const baseTags = Array.isArray(cloneData.system.tags) ? cloneData.system.tags : [];
    const tagSet = new Set([...baseTags, ...extraTags]);
    cloneData.system.tags = Array.from(tagSet);

    const created = await Actor.create(cloneData, { keepId: false });
    if (!created) return null;

    // Grant the AI skill onto the actor so item.roll() has actor context
    // (compendium skills have no .actor and would fail at _buildRollFormulas).
    // Clone via toObject() + createEmbeddedDocuments, mirroring EquipmentSystem
    // ._grantSkills pattern but for a single skill.
    if (aiSkillUuid) {
      const sourceSkill = await fromUuid(aiSkillUuid);
      if (sourceSkill) {
        const skillData = sourceSkill.toObject();
        delete skillData._id;
        skillData.flags = skillData.flags ?? {};
        skillData.flags.aspectsofpower = {
          ...(skillData.flags.aspectsofpower ?? {}),
          grantedFrom: aiSkillUuid,
          isAiSkill: true,
        };
        const [granted] = await created.createEmbeddedDocuments('Item', [skillData]);
        // Re-flag the actor with the GRANTED (actor-embedded) skill's UUID so
        // the AI profile can resolve via fromUuid() and get a real actor-owned doc.
        if (granted) {
          await created.update({
            'flags.aspectsofpower.aiSkillUuid': granted.uuid,
          });
        }
      }
    }

    // After Actor.create, prepareDerivedData computes health.max / mana.max /
    // stamina.max from the new ability scores — but the schema-default `value`
    // fields stay at whatever the stub had. Push them to max so the tower
    // spawns at full pools.
    created.reset();
    const fullPoolUpdate = {};
    if (created.system?.health?.max  > 0) fullPoolUpdate['system.health.value']  = created.system.health.max;
    if (created.system?.mana?.max    > 0) fullPoolUpdate['system.mana.value']    = created.system.mana.max;
    if (created.system?.stamina?.max > 0) fullPoolUpdate['system.stamina.value'] = created.system.stamina.max;
    // Defense pools: max is derived; current pool stays at 0 by default until
    // the round-tick fills them. Stamp current = poolMax so the tower has its
    // dodge pool immediately on spawn.
    for (const k of ['melee', 'ranged', 'mind', 'soul']) {
      const max = created.system?.defense?.[k]?.poolMax ?? 0;
      if (max > 0) fullPoolUpdate[`system.defense.${k}.pool`] = max;
    }
    if (Object.keys(fullPoolUpdate).length > 0) await created.update(fullPoolUpdate);

    // Token spawn — inherit stub's prototypeToken layout; reposition to picked square.
    const grid = scene.grid?.size ?? 100;
    const baseTokenData = created.prototypeToken?.toObject?.() ?? {};
    const tokenData = foundry.utils.mergeObject(baseTokenData, {
      name: created.name,
      actorId: created.id,
      actorLink: true,
      hidden: false,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      flags: {
        'aspects-of-power': {
          summon: {
            ownerActorUuid,
            sourceSkillUuid,
            summonType,
            spawnedAt:            Date.now(),
            cleanupActorOnDelete: true,
          },
        },
      },
    }, { inplace: false });
    tokenData.actorId = created.id;
    tokenData.actorLink = true;
    tokenData.x = position.x - (tokenData.width ?? 1) * grid / 2;
    tokenData.y = position.y - (tokenData.height ?? 1) * grid / 2;

    const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [tokenData]);
    return { actorClone: created, tokenDoc };
  }
}

/* ─────────────────────────────────────────────────────────────────────────── *
 * GM-routing for spawn requests                                                *
 *                                                                              *
 * Actor.create() requires GM permissions. When a non-GM player triggers a      *
 * summon (cast Mirror Ice Clone, activate Lightstream Prism medium, etc.),    *
 * the public SummonHelpers.spawnSummon / spawnTower methods serialize the     *
 * request and emit it via socket. A GM client picks it up, runs the same      *
 * spawn function locally (now with GM perms), and emits the resulting actor   *
 * + token UUIDs back to the requester. The requester resolves them to docs    *
 * and returns the {actorClone, tokenDoc} shape callers expect.                *
 * ─────────────────────────────────────────────────────────────────────────── */

const SOCKET_CHANNEL = 'system.aspects-of-power';
const SPAWN_RESPONSE_TIMEOUT_MS = 15000;

/**
 * Emit a spawn request via socket and await the GM's response.
 * Resolves to `{actorClone, tokenDoc}` (looked up by UUID on receipt) or null.
 */
async function _requestGMSpawn(method, payload) {
  const requestId = foundry.utils.randomID();
  const targetUserId = game.user.id;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => { cleanup(); resolve(null); }, SPAWN_RESPONSE_TIMEOUT_MS);
    // Sync handler that fires-and-forgets the async work — socket.on shouldn't
    // receive a Promise return value (some host environments treat that as a
    // sync-response promise that goes out of scope).
    const handler = (response) => {
      if (response?.type !== 'summonSpawnResponse') return;
      if (response.requestId !== requestId) return;
      if (response.targetUserId !== targetUserId) return;
      cleanup();
      if (!response.success) {
        ui.notifications.warn(`Summon failed: ${response.error ?? 'unknown'}`);
        resolve(null);
        return;
      }
      (async () => {
        const actorClone = response.actorUuid ? await fromUuid(response.actorUuid) : null;
        const tokenDoc   = response.tokenUuid ? await fromUuid(response.tokenUuid) : null;
        resolve(actorClone && tokenDoc ? { actorClone, tokenDoc } : null);
      })().catch(err => {
        console.error('[summon] response handler error:', err);
        resolve(null);
      });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      game.socket.off(SOCKET_CHANNEL, handler);
    };
    game.socket.on(SOCKET_CHANNEL, handler);
    game.socket.emit(SOCKET_CHANNEL, {
      type: 'summonSpawnRequest',
      method,
      payload,
      requestId,
      requesterId: targetUserId,
    });
  });
}

/**
 * GM-side socket listener: receive spawn requests, run them locally with GM
 * permissions, emit response with the new doc UUIDs. Registered alongside the
 * other summon hooks below.
 */
function _registerGMSpawnListener() {
  // Sync wrapper, async work runs fire-and-forget so socket.on doesn't see
  // a Promise return value (avoids "Promised response went out of scope").
  game.socket.on(SOCKET_CHANNEL, (msg) => {
    if (!game.user.isGM) return;
    if (msg?.type !== 'summonSpawnRequest') return;
    const { method, payload, requestId, requesterId } = msg;

    const respond = (success, extra) => {
      game.socket.emit(SOCKET_CHANNEL, {
        type: 'summonSpawnResponse',
        targetUserId: requesterId,
        requestId,
        success,
        ...extra,
      });
    };

    (async () => {
      try {
        let result = null;
        if (method === 'spawnSummon') {
          const sourceActor = await fromUuid(payload.sourceActorUuid);
          const scene = game.scenes.get(payload.sceneId) ?? canvas.scene;
          result = await SummonHelpers.spawnSummon({
            sourceActor, scene,
            position:        payload.position,
            summonType:      payload.summonType,
            sourceSkillUuid: payload.sourceSkillUuid,
            hpOverride:      payload.hpOverride,
            namePrefix:      payload.namePrefix,
            capacity:        payload.capacity,
            aiFlags:         payload.aiFlags,
          });
        } else if (method === 'spawnTower') {
          const scene = game.scenes.get(payload.sceneId) ?? canvas.scene;
          result = await SummonHelpers.spawnTower({
            stubActorUuid:    payload.stubActorUuid,
            scene,
            position:         payload.position,
            ownerActorUuid:   payload.ownerActorUuid,
            ritualPower:      payload.ritualPower,
            statDistribution: payload.statDistribution,
            aiProfile:        payload.aiProfile,
            aiSkillUuid:      payload.aiSkillUuid,
            summonType:       payload.summonType,
            sourceSkillUuid:  payload.sourceSkillUuid,
            capacity:         payload.capacity,
            extraTags:        payload.extraTags,
            namePrefix:       payload.namePrefix,
            aiFlags:          payload.aiFlags,
          });
        } else {
          respond(false, { error: `unknown spawn method: ${method}` });
          return;
        }

        if (!result) {
          respond(false, { error: 'spawn returned null' });
          return;
        }
        respond(true, {
          actorUuid: result.actorClone?.uuid ?? null,
          tokenUuid: result.tokenDoc?.uuid ?? null,
        });
      } catch (e) {
        console.error('[summon] GM spawn handler error:', e);
        respond(false, { error: e.message });
      }
    })();
  });
}

/**
 * deleteToken hook: when a summon token is deleted (manually or via despawn),
 * purge its linked cloned actor if the flag says so. Without this hook a GM
 * who right-clicks → delete on the token would leave the world actor behind.
 */
export function registerSummonHooks() {
  // GM-side spawn-request listener (player → GM socket bridge for Actor.create)
  _registerGMSpawnListener();

  Hooks.on('deleteToken', async (tokenDoc, _options, _userId) => {
    if (!game.user.isGM) return;
    const summonFlag = tokenDoc.flags?.['aspects-of-power']?.summon;
    if (!summonFlag?.cleanupActorOnDelete) return;
    const actor = game.actors.get(tokenDoc.actorId);
    // Cancel any active channel the dying summon is mid-firing so the
    // scheduler doesn't try to tick from a destroyed actor next clock advance.
    if (actor) {
      try {
        const { ChannelHelpers } = await import('./channel.mjs');
        ChannelHelpers.cancelChannel(actor.uuid);
      } catch (_) { /* channel module not loaded — fine */ }
    }
    if (actor && actor.flags?.['aspects-of-power']?.summon?.cleanupActorOnDelete) {
      await actor.delete();
    }
  });
}
