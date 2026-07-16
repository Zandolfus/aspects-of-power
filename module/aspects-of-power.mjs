// Import document classes.
import { AspectsofPowerActor } from './documents/actor.mjs';
import { AspectsofPowerItem } from './documents/item.mjs';
import { AspectsofPowerToken } from './documents/token.mjs';
import { AspectsofPowerTokenObject } from './canvas/token.mjs';
import { AspectsofPowerTokenRuler } from './canvas/token-ruler.mjs';
import { attachOverlayLayer, detachOverlayLayer, refreshOverlay } from './canvas/movement-overlay.mjs';
import { attachPowerSenseLayer, detachPowerSenseLayer, refreshPowerSense } from './canvas/power-sense-overlay.mjs';
import { resetFirstContactSeen } from './systems/engagement-halts.mjs';
import { onMoveKey, onCommitKey, onCancelKey, clearAllBuffers, getBuffer } from './canvas/movement-buffer.mjs';
import { registerAoeBehavior, setAoeTrigger } from './canvas/aoe-region-behavior.mjs';
import { onPreUpdateTokenForAuras } from './canvas/aura-entry-trigger.mjs';
// Import sheet classes.
import { AspectsofPowerActorSheet } from './sheets/actor-sheet.mjs';
import { AspectsofPowerItemSheet } from './sheets/item-sheet.mjs';
// Import data models.
import { CharacterData } from './data/actor-character.mjs';
import { NpcData } from './data/actor-npc.mjs';
import { ItemItemData } from './data/item-item.mjs';
import { FeatureData } from './data/item-feature.mjs';
import { SkillData } from './data/item-skill.mjs';
import { RaceData } from './data/item-race.mjs';
import { ClassData } from './data/item-class.mjs';
import { ProfessionData } from './data/item-profession.mjs';
import { AugmentData } from './data/item-augment.mjs';
import { ConsumableData } from './data/item-consumable.mjs';
import { AopEffectData } from './data/effect-base.mjs';
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { ASPECTSOFPOWER } from './helpers/config.mjs';
import { isActingGM } from './helpers/gm.mjs';
import { deriveItemStats } from './systems/item-derivation.mjs';
import { getPositionalTags } from './helpers/positioning.mjs';
// Import systems.
import { EquipmentSystem } from './systems/equipment.mjs';
import * as MassLeveler from './systems/mass-leveler.mjs';
import * as TemplateMigration from './systems/template-migration.mjs';
import * as Celerity from './systems/celerity.mjs';
import { SummonHelpers, registerSummonHooks } from './systems/summon.mjs';
import { ChannelHelpers, registerChannelHooks } from './systems/channel.mjs';
import { AIProfiles, registerAIHooks, aiSetFactionFocus } from './systems/ai.mjs';
import { registerSummonHud } from './canvas/summon-hud.mjs';
import { registerMovementHud } from './canvas/movement-hud.mjs';
import { CelerityCombatTracker, installAopTurnMarkerPatch } from './apps/celerity-combat-tracker.mjs';

/* -------------------------------------------- */
/*  Debuff Helpers                              */
/* -------------------------------------------- */

/**
 * Check if an actor has an active (non-disabled) debuff of the given type(s).
 * @param {Actor} actor
 * @param {string|string[]} types  One or more debuffType keys to check for.
 * @returns {ActiveEffect|undefined}  The first matching effect, or undefined.
 */
function getActiveDebuff(actor, types) {
  if (!actor?.effects) return undefined;
  const typeArr = Array.isArray(types) ? types : [types];
  return actor.effects.find(e =>
    !e.disabled && typeArr.includes(e.system?.debuffType)
  );
}

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once('init', function () {
  // Replace Foundry's sidebar combat tracker with our celerity-aware subclass.
  // Must happen at init, before Foundry instantiates ui.combat.
  CONFIG.ui.combat = CelerityCombatTracker;

  // Patch Foundry's turn-marker machinery so the canvas ring can paint on
  // every "needs input" combatant + the soonest-queued one (not just the
  // single combat.combatant). Safe to call here — CONFIG.Combat.documentClass
  // and CONFIG.Token.objectClass are populated by core before system init.
  installAopTurnMarkerPatch();

  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.aspectsofpower = {
    AspectsofPowerActor,
    AspectsofPowerItem,
    rollItemMacro,
    getPositionalTags,
    massLeveler: MassLeveler,
    templateMigration: TemplateMigration,
    celerity: { ...Celerity },
    // GM faction-focus command (ai.mjs): stamp aiFocusTarget on every
    // AI-profiled unit of a disposition. Console/macro v1.
    aiSetFactionFocus,
  };

  // ── System Settings ──
  game.settings.register('aspects-of-power', 'migrationVersion', {
    name: 'Migration Version',
    scope: 'world',
    config: false,
    type: String,
    default: '0',
  });

  game.settings.register('aspects-of-power', 'woundedTokenThreshold', {
    name: 'Wounded Token Threshold',
    hint: 'HP percentage at or below which the token image swaps to the wounded variant (0 to disable).',
    scope: 'world',
    config: true,
    type: Number,
    default: 30,
    range: { min: 0, max: 100, step: 5 },
  });

  // ── Movement Buffer Keybindings ──
  // Higher-precedence (PRIORITY=0) handlers on WASD intercept core's
  // single-step movement and accumulate into a buffer. Drag-to-move is
  // unaffected — only keypress-driven moves go through the buffer. Per
  // design 2026-05-10, multiple keystrokes consolidate into one celerity
  // declaration.
  const PRIORITY = CONST.KEYBINDING_PRECEDENCE.PRIORITY;
  const _moveBinding = (id, name, key, dx, dy) => {
    game.keybindings.register('aspects-of-power', id, {
      name,
      uneditable: [{ key }],
      onDown: () => onMoveKey(dx, dy),
      precedence: PRIORITY,
      repeat: true,
      reservedModifiers: ['Shift'],
    });
  };
  _moveBinding('bufferedMoveUp',    'Buffered Move (Up)',    'KeyW',  0, -1);
  _moveBinding('bufferedMoveDown',  'Buffered Move (Down)',  'KeyS',  0,  1);
  _moveBinding('bufferedMoveLeft',  'Buffered Move (Left)',  'KeyA', -1,  0);
  _moveBinding('bufferedMoveRight', 'Buffered Move (Right)', 'KeyD',  1,  0);

  game.keybindings.register('aspects-of-power', 'commitBufferedMove', {
    name: 'Commit Buffered Movement',
    hint: 'Declare the accumulated WASD movement as a single celerity action.',
    editable: [{ key: 'Enter' }],
    // onDown can return a boolean OR a Promise — but the keybinding system
    // wants a synchronous boolean for consume. Fire-and-forget the commit;
    // return true to consume only when there's actually a buffer.
    onDown: () => {
      // Synchronous probe for any buffered combatant before consuming.
      const combat = game.combat;
      if (!combat?.started) return false;
      const controlled = canvas?.tokens?.controlled ?? [];
      const hasBuffered = controlled.some(t => {
        const cm = combat.combatants.find(c => c.tokenId === t.id);
        return cm && getBuffer(cm.id) !== null;
      });
      if (!hasBuffered) return false;
      onCommitKey(); // async, but we already know there's something to commit
      return true;
    },
    precedence: PRIORITY,
  });
  game.keybindings.register('aspects-of-power', 'cancelBufferedMove', {
    name: 'Cancel Buffered Movement',
    hint: 'Discard the staged WASD movement; token stays put.',
    editable: [{ key: 'Escape' }],
    onDown: () => onCancelKey(), // returns true only if a buffer was actually cancelled
    precedence: PRIORITY,
  });

  // ── Persistent AOE Region Behavior ──
  // Replaces the legacy updateToken endpoint check with native Foundry
  // RegionBehavior path-segmentation. Brief pass-throughs (token enters
  // and exits a persistent AOE between two parallel-animate ticks) are
  // now caught by Foundry's segmented region events.
  registerAoeBehavior();
  setAoeTrigger((tokenDoc, force) => _triggerPersistentAoe(tokenDoc, force));
  // Expose on the game API so the celerity advance handler can call it
  // for the periodic re-tick scan (still-standing-in cadence).
  game.aspectsofpower._triggerPersistentAoe = _triggerPersistentAoe;

  // Add custom constants for configuration.
  CONFIG.ASPECTSOFPOWER = ASPECTSOFPOWER;

  /**
   * Set an initiative formula for the system
   * @type {String}
   */
  CONFIG.Combat.initiative = {
    formula: '1d20*@perception.mod/100 + @perception.mod',
    decimals: 2,
  };

  // Define custom Document classes
  CONFIG.Actor.documentClass = AspectsofPowerActor;
  CONFIG.Item.documentClass = AspectsofPowerItem;
  CONFIG.Token.documentClass = AspectsofPowerToken;
  CONFIG.Token.objectClass = AspectsofPowerTokenObject;
  CONFIG.Token.rulerClass = AspectsofPowerTokenRuler;

  // We handle effect expiry manually in onStartTurn to avoid race conditions
  // with Foundry's built-in #deleteExpiredEffects (which tries to delete effects
  // that our break rolls already removed).
  CONFIG.ActiveEffect.expiryAction = 'none';

  // Register AE TypeDataModel — all effects use the 'base' type.
  CONFIG.ActiveEffect.dataModels = { base: AopEffectData };

  // Register TypeDataModel classes — these replace template.json schema definitions
  CONFIG.Actor.dataModels = {
    character: CharacterData,
    npc:       NpcData,
  };
  CONFIG.Item.dataModels = {
    item:          ItemItemData,
    feature:       FeatureData,
    skill:         SkillData,
    race:          RaceData,
    class:         ClassData,
    profession:    ProfessionData,
    augment:       AugmentData,
    consumable:    ConsumableData,
  };

  // Register sheet application classes
  foundry.documents.collections.Actors.registerSheet('aspects-of-power', AspectsofPowerActorSheet, {
    makeDefault: true,
    label: 'ASPECTSOFPOWER.SheetLabels.Actor',
  });
  foundry.documents.collections.Items.registerSheet('aspects-of-power', AspectsofPowerItemSheet, {
    makeDefault: true,
    label: 'ASPECTSOFPOWER.SheetLabels.Item',
  });

  // ── Mass Disposition Tool ──
  /**
   * Change disposition of multiple tokens/actors at once.
   * Call with no args to open a dialog, or pass options directly.
   * @param {object} [opts]
   * @param {'selected'|'scene'|'folder'} [opts.scope='selected']
   * @param {string} [opts.folderId] — required when scope is 'folder'
   * @param {number} [opts.disposition] — CONST.TOKEN_DISPOSITIONS value
   */
  game.aspectsofpower.setDisposition = async function (opts) {
    if (!game.user.isGM) { ui.notifications.warn('GM only.'); return; }

    const dispositions = {
      [CONST.TOKEN_DISPOSITIONS.SECRET]:   'Secret',
      [CONST.TOKEN_DISPOSITIONS.HOSTILE]:   'Hostile',
      [CONST.TOKEN_DISPOSITIONS.NEUTRAL]:   'Neutral',
      [CONST.TOKEN_DISPOSITIONS.FRIENDLY]:  'Friendly',
    };

    if (opts?.disposition !== undefined) {
      if (opts.scope === 'folder') {
        // Update prototype token disposition on all actors in the folder (recursive).
        const folder = game.folders.get(opts.folderId);
        if (!folder) { ui.notifications.warn('Folder not found.'); return; }
        const actors = folder.contents.filter(a => a.type === 'character' || a.type === 'npc');
        // Also include subfolders.
        const collectActors = (f) => {
          let result = [...f.contents.filter(a => a.documentName === 'Actor')];
          for (const sub of f.getSubfolders()) result = result.concat(collectActors(sub));
          return result;
        };
        const allActors = collectActors(folder);
        if (allActors.length === 0) { ui.notifications.warn('No actors in folder.'); return; }
        for (const actor of allActors) {
          await actor.update({ 'prototypeToken.disposition': opts.disposition });
        }
        // Also update any placed tokens from these actors on the current scene.
        if (canvas.scene) {
          const actorIds = new Set(allActors.map(a => a.id));
          const sceneTokens = canvas.scene.tokens.filter(t => actorIds.has(t.actorId));
          if (sceneTokens.length > 0) {
            const updates = sceneTokens.map(t => ({ _id: t.id, disposition: opts.disposition }));
            await canvas.scene.updateEmbeddedDocuments('Token', updates);
          }
        }
        ui.notifications.info(`Set ${allActors.length} actor(s) to ${dispositions[opts.disposition]} (prototype + scene tokens).`);
        return;
      }

      const tokens = opts.scope === 'scene'
        ? canvas.tokens.placeables.map(t => t.document)
        : canvas.tokens.controlled.map(t => t.document);
      if (tokens.length === 0) { ui.notifications.warn('No tokens found.'); return; }
      const updates = tokens.map(t => ({ _id: t.id, disposition: opts.disposition }));
      await canvas.scene.updateEmbeddedDocuments('Token', updates);
      ui.notifications.info(`Set ${tokens.length} token(s) to ${dispositions[opts.disposition]}.`);
      return;
    }

    // Dialog mode — build folder options.
    const folderOptions = game.folders
      .filter(f => f.type === 'Actor')
      .map(f => `<option value="${f.id}">${f.name}</option>`)
      .join('');

    const dispOptions = Object.entries(dispositions).map(([val, label]) =>
      `<option value="${val}">${label}</option>`
    ).join('');

    const content = `<form>
      <div class="form-group"><label>Scope</label>
        <select name="scope">
          <option value="selected">Selected Tokens</option>
          <option value="scene">All Tokens on Scene</option>
          <option value="folder">Actor Folder</option>
        </select>
      </div>
      <div class="form-group folder-select" style="display:none"><label>Folder</label>
        <select name="folderId">${folderOptions}</select>
      </div>
      <div class="form-group"><label>Disposition</label>
        <select name="disposition">${dispOptions}</select>
      </div>
    </form>`;

    await foundry.applications.api.DialogV2.wait({
      window: { title: 'Set Token Disposition' },
      content,
      render: (event, dialog) => {
        const root = dialog?.element ?? dialog;
        const form = root.querySelector('form');
        if (!form) return;
        const scopeSelect = form.querySelector('[name="scope"]');
        const folderGroup = form.querySelector('.folder-select');
        scopeSelect.addEventListener('change', () => {
          folderGroup.style.display = scopeSelect.value === 'folder' ? '' : 'none';
        });
      },
      buttons: [{
        action: 'apply', label: 'Apply', icon: 'fas fa-check', default: true,
        callback: async (event, button, dialog) => {
          const form = dialog?.element?.querySelector('form') ?? button.form ?? button.closest('.application')?.querySelector('form');
          if (!form) { ui.notifications.error('Disposition dialog form not found.'); return; }
          const scope = form.querySelector('[name="scope"]').value;
          const disposition = Number(form.querySelector('[name="disposition"]').value);
          const folderId = form.querySelector('[name="folderId"]')?.value;
          await game.aspectsofpower.setDisposition({ scope, disposition, folderId });
        },
      }, { action: 'cancel', label: 'Cancel' }],
      close: () => null,
    });
  };

  // ── Folder context menu: Set Disposition ──
  const _resolveFolderId = (target) => {
    const el = target instanceof HTMLElement ? target : target?.[0];
    if (!el) return null;
    return el.dataset?.folderId ?? el.closest('[data-folder-id]')?.dataset.folderId ?? null;
  };

  Hooks.on('getFolderContextOptions', (application, menuItems) => {
    menuItems.push({
      name: 'Set Disposition',
      label: 'Set Disposition',
      icon: '<i class="fas fa-handshake"></i>',
      condition: (target) => {
        const folderId = _resolveFolderId(target);
        const folder = game.folders.get(folderId);
        return game.user.isGM && folder?.type === 'Actor';
      },
      callback: async (target) => {
        const folderId = _resolveFolderId(target);
        const folder = game.folders.get(folderId);
        if (!folder) return;

        const dispositions = {
          [CONST.TOKEN_DISPOSITIONS.SECRET]:  'Secret',
          [CONST.TOKEN_DISPOSITIONS.HOSTILE]:  'Hostile',
          [CONST.TOKEN_DISPOSITIONS.NEUTRAL]:  'Neutral',
          [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: 'Friendly',
        };
        const dispOptions = Object.entries(dispositions).map(([val, label]) =>
          `<option value="${val}">${label}</option>`
        ).join('');

        await foundry.applications.api.DialogV2.wait({
          window: { title: `Set Disposition — ${folder.name}` },
          content: `<form><div class="form-group"><label>Disposition</label>
            <select name="disposition">${dispOptions}</select></div></form>`,
          buttons: [{
            action: 'apply', label: 'Apply', icon: 'fas fa-check', default: true,
            callback: async (event, button, dialog) => {
              const form = dialog?.element?.querySelector('form') ?? button.form ?? button.closest('.application')?.querySelector('form');
              if (!form) { ui.notifications.error('Disposition dialog form not found.'); return; }
              const disposition = Number(form.querySelector('[name="disposition"]').value);
              await game.aspectsofpower.setDisposition({ scope: 'folder', folderId, disposition });
            },
          }, { action: 'cancel', label: 'Cancel' }],
          close: () => null,
        });
      },
    });
  });

  // Initialize the equipment system hooks.
  EquipmentSystem.initialize();

  // ── Auto-sync cached tags when a template item's tags change ──
  // cachedTags on the actor track is the structured `[{id, value}]` form
  // (kept for backward compat); we wrap the new flat string array for the cache.
  Hooks.on('updateItem', (item, changes, _options, _userId) => {
    if (!isActingGM()) return;
    if (!changes.system?.tags) return;
    if (!['race', 'class', 'profession'].includes(item.type)) return;

    const newTags = (item.system.tags ?? []).map(id => ({ id, value: 0 }));
    const itemUuid = item.uuid;
    const itemId = item.id;

    // Match by UUID or by bare item ID (compendium UUIDs may differ from stored templateId).
    const _matchesTemplate = (templateId) => {
      if (!templateId) return false;
      return templateId === itemUuid || templateId.endsWith(itemId);
    };

    // Sync world actors.
    for (const actor of game.actors) {
      for (const type of ['race', 'class', 'profession']) {
        const attr = actor.system.attributes?.[type];
        if (!attr?.templateId) continue;
        if (_matchesTemplate(attr.templateId)) {
          actor.update({ [`system.attributes.${type}.cachedTags`]: newTags });
        }
      }
    }

    // Sync unlinked token actors on active scenes.
    for (const scene of game.scenes) {
      for (const token of scene.tokens) {
        if (token.actorLink) continue; // linked tokens use world actor above
        const synthActor = token.actor;
        if (!synthActor) continue;
        for (const type of ['race', 'class', 'profession']) {
          const attr = synthActor.system.attributes?.[type];
          if (!attr?.templateId) continue;
          if (_matchesTemplate(attr.templateId)) {
            // Update both synthetic and world actor source for unlinked tokens.
            synthActor.update({ [`system.attributes.${type}.cachedTags`]: newTags });
            const worldActor = game.actors.get(token.actorId);
            if (worldActor) {
              worldActor.update({ [`system.attributes.${type}.cachedTags`]: newTags });
            }
          }
        }
      }
    }
  });

  // ── Augment-granted tag reconcile ── (registered FIRST so the auto-derive
  // hook below sees augment-added tags in cs.tags when it runs.)
  // Per design-augment-tag-grants.md: when an augment is slotted/unslotted
  // on a host item, its `system.grantsTags` are appended/stripped from the
  // host's `system.tags`. Origin is tracked in
  // flags.aspectsofpower.augmentGrantedTags[augmentId] = [tags actually added]
  // so unslot only removes what THIS augment added (preserves manual tags
  // that happened to overlap with what an augment grants).
  Hooks.on('preUpdateItem', (item, changes, options, _userId) => {
    if (item.type !== 'item') return;
    if (options.skipAugmentTagReconcile) return;
    const cs = changes.system;
    if (!cs) return;
    const augFieldChanged = cs.augments !== undefined || cs.profAugments !== undefined;
    if (!augFieldChanged) return;
    if (!item.actor) return; // augment grants only apply when on an actor

    const futureAugs    = (cs.augments ?? item.system.augments ?? [])
      .filter(e => e.augmentId);
    const futureProfAugs = (cs.profAugments ?? item.system.profAugments ?? [])
      .filter(e => e.augmentId);
    const futureIds = new Set([...futureAugs, ...futureProfAugs].map(e => e.augmentId));

    // Augment ids are compendium UUIDs containing dots, which Foundry's flag
    // path resolution would expand into nested objects. Encode dots before
    // using as flag keys; decode on read.
    const encodeId = (id) => id.replaceAll('.', '__');
    const decodeId = (key) => key.replaceAll('__', '.');
    const rawOrigin = item.flags?.aspectsofpower?.augmentGrantedTags ?? {};
    const priorOrigin = {};
    for (const [key, tags] of Object.entries(rawOrigin)) {
      // Skip corrupted nested entries from a prior bug where dot-notation
      // expanded into objects (we only want flat encoded entries here).
      if (Array.isArray(tags)) {
        priorOrigin[decodeId(key)] = tags;
      }
    }
    const priorIds   = new Set(Object.keys(priorOrigin));

    const removedIds = [...priorIds].filter(id => !futureIds.has(id));
    const addedIds   = [...futureIds].filter(id => !priorIds.has(id));
    if (removedIds.length === 0 && addedIds.length === 0) return;

    // Start from the current tags (post any user edits in this same update).
    let tags = [...(cs.tags ?? item.system.tags ?? [])];
    // Build a working copy of origin to figure out what's still granted by
    // remaining augments. The actual flag write uses per-key set/delete
    // operators so removed augments are wiped from the stored map (otherwise
    // Foundry's flag-merge keeps the stale entry).
    const newOrigin = { ...priorOrigin };

    // Strip tags ONLY if this augment was the one that added them (per origin).
    // If the same tag appears in another augment's origin record, leave it.
    for (const removedId of removedIds) {
      const wasAdded = priorOrigin[removedId] ?? [];
      delete newOrigin[removedId];
      for (const tag of wasAdded) {
        const stillAddedByOther = Object.values(newOrigin).some(g => g.includes(tag));
        if (!stillAddedByOther) {
          tags = tags.filter(t => t !== tag);
        }
      }
    }

    // For added augments: only record the tags this augment ACTUALLY added
    // (i.e., that weren't already on the item). That way unslot only strips
    // what slot added — manual additions of the same tag survive.
    // Source for grantsTags is the slot entry SNAPSHOT (set at apply time),
    // not a compendium lookup — race-free.
    const allFutureEntries = [...futureAugs, ...futureProfAugs];
    const entryById = new Map(allFutureEntries.map(e => [e.augmentId, e]));
    for (const addedId of addedIds) {
      const entry = entryById.get(addedId);
      if (!entry) continue;
      const grants = entry.grantsTags ?? [];
      const actuallyAdded = [];
      for (const tag of grants) {
        if (!tags.includes(tag)) {
          tags.push(tag);
          actuallyAdded.push(tag);
        }
      }
      newOrigin[addedId] = actuallyAdded;
    }

    // ── Augment delta: apply/reverse itemBonuses against host fields ──
    // Snapshot-driven. When an augment is slotted, its itemBonuses are added
    // to the host's stat/armor/damage/etc. fields. When unslotted, the
    // SAME values (from the slot's snapshot) are subtracted. This bypasses
    // `lockedFields` because we're writing the delta directly via this hook
    // — the auto-derive hook (which respects locks) doesn't fire for these
    // augment-only changes.
    //
    // Only `mode: 'flat'` bonuses are handled by delta. Percentage-mode
    // bonuses (e.g. Hardening +5% armor) require a full re-derive to revert
    // cleanly and won't auto-reverse on locked items — manual cleanup
    // needed for those. Most existing augments are flat.
    const priorAugList = item.system.augments ?? [];
    const priorProfAugList = item.system.profAugments ?? [];
    const priorEntryById = new Map();
    for (const e of [...priorAugList, ...priorProfAugList]) {
      if (e?.augmentId) priorEntryById.set(e.augmentId, e);
    }

    const statDelta = {};
    let damageBonusDelta = 0;
    let armorBonusDelta  = 0;
    let veilBonusDelta   = 0;
    let drPhysDelta      = 0;
    let drMagDelta       = 0;
    let durabilityMaxDelta = 0;
    let percentageSkipped = false;

    const applyBonusDelta = (entry, sign) => {
      for (const ib of entry.itemBonuses ?? []) {
        if (ib.mode !== 'flat') { percentageSkipped = true; continue; }
        const v = sign * (Number(ib.value) || 0);
        if      (ib.field === 'damageBonus')              damageBonusDelta += v;
        else if (ib.field === 'armorBonus')               armorBonusDelta  += v;
        else if (ib.field === 'veilBonus')                veilBonusDelta   += v;
        else if (ib.field === 'damageReduction.physical') drPhysDelta      += v;
        else if (ib.field === 'damageReduction.magical')  drMagDelta       += v;
        else if (ib.field === 'durability.max')           durabilityMaxDelta += v;
        else if (ib.field?.startsWith('statBonus.')) {
          const ability = ib.field.slice('statBonus.'.length);
          statDelta[ability] = (statDelta[ability] || 0) + v;
        }
      }
    };

    for (const removedId of removedIds) {
      const entry = priorEntryById.get(removedId);
      if (entry) applyBonusDelta(entry, -1);
    }
    for (const addedId of addedIds) {
      const entry = entryById.get(addedId);
      if (entry) applyBonusDelta(entry, +1);
    }

    // GATE: delta only writes the field if it's LOCKED. For unlocked fields
    // the auto-derive hook (registered after this one) will re-compute the
    // augment contribution naturally — applying the delta here would
    // double-count or get stomped depending on order. Locked fields can't
    // be updated by derive, so the delta is the only path that respects
    // augment add/remove for them.
    const locked = new Set(item.system.lockedFields ?? []);

    if (damageBonusDelta !== 0 && locked.has('damageBonus')) {
      cs.damageBonus = (cs.damageBonus ?? item.system.damageBonus ?? 0) + damageBonusDelta;
    }
    if (armorBonusDelta !== 0 && locked.has('armorBonus')) {
      cs.armorBonus = Math.max(0, (cs.armorBonus ?? item.system.armorBonus ?? 0) + armorBonusDelta);
    }
    if (veilBonusDelta !== 0 && locked.has('veilBonus')) {
      cs.veilBonus = Math.max(0, (cs.veilBonus ?? item.system.veilBonus ?? 0) + veilBonusDelta);
    }
    if ((drPhysDelta !== 0 || drMagDelta !== 0) && locked.has('damageReduction')) {
      const curDR = cs.damageReduction ?? item.system.damageReduction ?? { physical: 0, magical: 0 };
      cs.damageReduction = {
        physical: Math.max(0, (curDR.physical ?? 0) + drPhysDelta),
        magical:  Math.max(0, (curDR.magical  ?? 0) + drMagDelta),
      };
    }
    if (durabilityMaxDelta !== 0 && locked.has('durabilityMax')) {
      const curDur = cs.durability ?? item.system.durability ?? { value: 0, max: 0 };
      const newMax = Math.max(0, (curDur.max ?? 0) + durabilityMaxDelta);
      cs.durability = {
        value: Math.min(curDur.value ?? 0, newMax),
        max: newMax,
      };
    }
    if (Object.keys(statDelta).length > 0 && locked.has('statBonuses')) {
      const baseList = cs.statBonuses ?? item.system.statBonuses ?? [];
      const newList = baseList.map(s => ({ ability: s.ability, value: s.value }));
      for (const [ability, delta] of Object.entries(statDelta)) {
        const existing = newList.find(s => s.ability === ability);
        if (existing) {
          existing.value = (existing.value || 0) + delta;
        } else if (delta > 0) {
          newList.push({ ability, value: delta });
        }
      }
      cs.statBonuses = newList.filter(s => (s.value || 0) > 0);
    }
    if (percentageSkipped) {
      console.warn(`[aspects-of-power] augment add/remove on ${item.name}: percentage-mode bonus(es) skipped by delta — re-derive needed (locked items: manual cleanup).`);
    }

    // Only write cs.tags if it actually differs — otherwise we'd spuriously
    // trigger the auto-derive hook (which fires on cs.tags presence) for
    // every augment swap that doesn't change the host's effective tags.
    const priorTags = cs.tags ?? item.system.tags ?? [];
    const tagsChanged = tags.length !== priorTags.length
      || tags.some((t, i) => t !== priorTags[i]);
    if (tagsChanged) cs.tags = tags;
    // Per-key flag patch. Use the `-=KEY` deletion prefix (legacy but
    // reliable across Foundry versions; ForcedDeletion sentinel observed
    // to not always wipe the entry as expected). Keys are dot-encoded so
    // the compendium UUID stays a single key (instead of nesting).
    for (const removedId of removedIds) {
      const k = encodeId(removedId);
      changes[`flags.aspectsofpower.augmentGrantedTags.-=${k}`] = null;
    }
    for (const addedId of addedIds) {
      if (newOrigin[addedId] !== undefined) {
        changes[`flags.aspectsofpower.augmentGrantedTags.${encodeId(addedId)}`] = newOrigin[addedId];
      }
    }
  });

  // ── Item auto-derive on input changes ──
  // When a craftable item's progress / slot / material / rarity / tags
  // changes, re-derive its statBonuses / armorBonus / veilBonus /
  // augmentSlots / durability.max from the new state. Per-field locks
  // in `system.lockedFields` skip individual outputs so manual overrides
  // are preserved across input edits. Registered AFTER the augment-tag-
  // grant reconcile so cs.tags already reflects augment-added tags by
  // the time deriveItemStats runs against it.
  Hooks.on('preUpdateItem', (item, changes, options, _userId) => {
    if (item.type !== 'item') return;
    if (options.skipAutoDerive) return; // escape hatch
    const cs = changes.system;
    if (!cs) return;
    const TRIGGERS = ['progress', 'slot', 'material', 'rarity', 'tags', 'augments'];
    if (!TRIGGERS.some(t => cs[t] !== undefined)) return;

    // Build the post-update view of the item to derive against.
    const futureSys = foundry.utils.mergeObject(
      foundry.utils.deepClone(item.system),
      cs,
      { inplace: false },
    );
    const derived = deriveItemStats({ system: futureSys });
    const locked = new Set(item.system.lockedFields ?? []);

    // Patch only unlocked fields the caller hasn't already explicitly set
    // in this update (so an explicit user edit always wins over derivation).
    if (!locked.has('statBonuses')   && cs.statBonuses === undefined)   cs.statBonuses = derived.statBonuses;
    if (!locked.has('armorBonus')    && cs.armorBonus === undefined)    cs.armorBonus = derived.armorBonus;
    if (!locked.has('veilBonus')     && cs.veilBonus === undefined)     cs.veilBonus = derived.veilBonus;
    if (!locked.has('augmentSlots')  && cs.augmentSlots === undefined)  cs.augmentSlots = derived.augmentSlots;
    if (!locked.has('reach')         && cs.reach === undefined)         cs.reach = derived.reach;
    if (!locked.has('damageBonus')   && cs.damageBonus === undefined)   cs.damageBonus = derived.damageBonus;
    if (!locked.has('damageReduction') && cs.damageReduction === undefined) {
      cs.damageReduction = {
        physical: derived.damageReductionPhysical,
        magical:  derived.damageReductionMagical,
      };
    }
    if (!locked.has('durabilityMax')) {
      cs.durability = cs.durability ?? {};
      if (cs.durability.max === undefined) cs.durability.max = derived.durabilityMax;
      // Cap value at the new max if unspecified.
      const curValue = cs.durability.value ?? item.system.durability?.value ?? 0;
      if (curValue > derived.durabilityMax && cs.durability.value === undefined) {
        cs.durability.value = derived.durabilityMax;
      }
    }
  });

  // ── Skill rarity demotion on character grade-up ──
  // Per design-skill-rarity-system.md: each grade-up at or after E→D
  // demotes every stored skill version one rarity tier (floor at the
  // bottom of skillRarityOrder). G/F/E share gradeIndex 0, so transitions
  // within them don't demote. Multi-grade jumps (e.g., level 99 → 200 =
  // E→C) demote by the full delta in one go.
  Hooks.on('preUpdateActor', (actor, update, options, _userId) => {
    const newRaceLevel = foundry.utils.getProperty(update, 'system.attributes.race.level');
    if (newRaceLevel == null) return;
    const oldRaceLevel = actor.system.attributes?.race?.level ?? 0;
    if (newRaceLevel <= oldRaceLevel) return;
    const sc = CONFIG.ASPECTSOFPOWER;
    const oldRank = sc.getRankForLevel(oldRaceLevel);
    const newRank = sc.getRankForLevel(newRaceLevel);
    const oldIdx = sc.statCurve.gradeIndex[oldRank] ?? 0;
    const newIdx = sc.statCurve.gradeIndex[newRank] ?? 0;
    if (newIdx <= oldIdx) return;
    // Stash for the post-update hook so it fires after the level write
    // commits and the embedded-update doesn't race the parent update.
    options.aopGradeUp = { tiers: newIdx - oldIdx, from: oldRank, to: newRank };
  });

  Hooks.on('updateActor', async (actor, _update, options, userId) => {
    if (game.user.id !== userId) return; // only the initiating client demotes
    if (!options.aopGradeUp) return;
    const { tiers, from, to } = options.aopGradeUp;
    const count = await actor.demoteSkillsByTiers(tiers);
    if (count > 0) {
      ui.notifications.info(`${actor.name} graded ${from}→${to}: ${count} skill version(s) demoted ${tiers} tier${tiers > 1 ? 's' : ''}.`);
    }
  });

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

// If you need to add Handlebars helpers, here is a useful example:
Handlebars.registerHelper('toLowerCase', function (str) {
  return str.toLowerCase();
});

Handlebars.registerHelper('join', function (array, sep) {
  if (!Array.isArray(array)) return '';
  return array.join(typeof sep === 'string' ? sep : ', ');
});
Handlebars.registerHelper('includes', function (array, value) {
  return Array.isArray(array) && array.includes(value);
});

Handlebars.registerHelper('or', function (...args) {
  args.pop(); // remove Handlebars options object
  return args.some(Boolean);
});

Handlebars.registerHelper('and', function (...args) {
  args.pop(); // remove Handlebars options object
  return args.every(Boolean);
});

/**
 * Simple math helper for templates: {{math a '*' b '/' c}}
 * Supports +, -, *, /. Evaluates left-to-right.
 */
Handlebars.registerHelper('math', function (...args) {
  args.pop(); // remove Handlebars options object
  let result = Number(args[0]) || 0;
  for (let i = 1; i < args.length; i += 2) {
    const op = args[i];
    const val = Number(args[i + 1]) || 0;
    if (op === '+') result += val;
    else if (op === '-') result -= val;
    else if (op === '*') result *= val;
    else if (op === '/') result = val !== 0 ? result / val : 0;
  }
  return Math.round(result);
});

/* -------------------------------------------- */
/*  Compendium — Auto-type Create Button        */
/* -------------------------------------------- */

/**
 * Override the "Create Entry" button in our template compendiums so it
 * creates the correct item type (race/class/profession) without showing
 * the generic type-selection dialog.
 */
Hooks.on('renderCompendium', (app, html) => {
  const el = html instanceof HTMLElement ? html : html[0];
  if (!el) return;

  const packId = app.collection?.collection;
  if (!packId) return;

  // ── System template packs: override Create Entry ──────────────────────────
  const typeMap = {
    'aspects-of-power.races': 'race',
    'aspects-of-power.classes': 'class',
    'aspects-of-power.professions': 'profession',
    'aspects-of-power.augments': 'augment',
  };
  const itemType = typeMap[packId];
  if (itemType) {
    const btn = el.querySelector('[data-action="createEntry"]') ?? el.querySelector('.create-entry');
    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.replaceWith(newBtn);
      newBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const label = game.i18n.localize(CONFIG.ASPECTSOFPOWER.levelTypes[itemType]);
        const item = await Item.create(
          { name: `New ${label}`, type: itemType },
          { pack: packId }
        );
        item?.sheet?.render(true);
      });
    }
  }

});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once('ready', async function () {
  // Register celerity tracker auto-refresh hooks (idempotent).

  // Register summon-subsystem deleteToken hook (cleans up cloned actor
  // when its token is removed). Idempotent.
  registerSummonHooks();

  // Register channel-subsystem updateCombat hook (sub-turn tick scheduler).
  registerChannelHooks();

  // Register AI dispatch hook (fires on declared-action completion → routes
  // to the actor's `aiProfile` for next-action decision).
  registerAIHooks();

  // Token-HUD command buttons (Hold / Manual / Focus / Move) for owned AI units.
  registerSummonHud();
  registerMovementHud();

  // Eagerly hydrate the augments compendium so `fromUuidSync` returns full
  // system data (not just index stubs). Required by `deriveItemStats` and
  // `getProfessionAugmentBonuses` which both resolve augment UUIDs sync.
  // Without this, slotted augments silently produce zero bonus.
  try {
    for (const p of game.packs) {
      if (p.metadata.name === 'augments' && p.metadata.packageName === 'aspects-of-power') {
        await p.getDocuments();
        break;
      }
    }
  } catch (e) { console.warn('[aspects-of-power] augment pack hydration failed', e); }

  // ── Orphaned AOE region cleanup ──
  // When a combatant's declaredAction is cleared (cancel button, advance-
  // fire, reset, movement charging it away, etc.) AND the prior declared
  // action had a placed AOE region, the region would otherwise persist on
  // canvas indefinitely. Detect the pre→post transition here and delete.
  // GM-only path (direct delete) when running on the GM client; socket
  // dispatch otherwise to land at the gmDeleteAoeRegion handler.
  Hooks.on('preUpdateCombatant', (combatant, changes, options, _userId) => {
    // Fire-time clear: the tracker clears declaredAction before dispatching
    // the roll, but the roll still needs the placed AOE region to resolve.
    // Skip orphan cleanup when this flag is set — item.roll() will delete
    // the region itself after damage application (for instantaneous AOEs).
    if (options?._aopFireDispatch) return;
    const newDeclared = foundry.utils.getProperty(changes, 'flags.aspectsofpower.declaredAction');
    if (newDeclared === undefined) return;
    const priorRegionId = combatant.flags?.aspectsofpower?.declaredAction?.aoeRegionId;
    const newRegionId = newDeclared?.aoeRegionId ?? null;
    if (!priorRegionId || priorRegionId === newRegionId) return;
    // Region orphaned — try canvas scene first, fall back to the combat's
    // configured scene if different.
    const candidates = [canvas?.scene, combatant.combat?.scene].filter(Boolean);
    for (const scene of candidates) {
      if (!scene.regions?.get(priorRegionId)) continue;
      if (isActingGM()) {
        scene.deleteEmbeddedDocuments('Region', [priorRegionId]).catch(e => console.warn('[orphan-aoe-cleanup]', e));
      } else if (!game.user.isGM) {
        // Players route through the GM. Non-acting GM clients do NOTHING —
        // the acting GM's own copy of this hook handles it (multi-GM safe:
        // both GMs deleting raced, the loser logged an error).
        game.socket.emit('system.aspects-of-power', {
          type: 'gmDeleteAoeRegion',
          sceneId: scene.id,
          regionId: priorRegionId,
        });
      }
      return;
    }
  });

  // Orb spell-charge: reset every combatant's accumulated charge at the
  // start of a fight so stale charge from a prior encounter doesn't leak
  // into a new one. Per-actor flag at flags.aspectsofpower.spellCharge.
  Hooks.on('combatStart', async (combat, _options) => {
    if (game.users.activeGM !== game.user) return; // GM-only
    for (const c of combat.combatants) {
      const actor = c.actor;
      if (!actor) continue;
      const cur = actor.flags?.aspectsofpower?.spellCharge ?? 0;
      if (cur > 0) await actor.update({ 'flags.aspectsofpower.spellCharge': 0 });
    }
  });

  // Socket: when the celerity tracker advances on the GM's client and the
  // next-up actor is owned by an online player, the GM dispatches an
  // executeQueuedAction message → the player's client runs item.roll({
  // executeDeferred: true }) so the variable-invest dialog appears for the
  // player, not the GM.
  game.socket.on('system.aspects-of-power', (data) => {
    if (data?.action !== 'executeQueuedAction') return;
    if (data.targetUserId !== game.user.id) return;
    const actor = game.actors.get(data.actorId);
    const item  = actor?.items?.get(data.itemId);
    if (!item) {
      console.warn('[celerity] executeQueuedAction: item not found', data);
      // Surface the orphan to the player this was dispatched to — a silent
      // skip reads as a hang from their side (pending-combat-ai-backlog).
      ui.notifications.warn(`Your queued action could not fire — the skill or item no longer exists. It has been cancelled.`);
      return;
    }
    item.roll({
      executeDeferred: true,
      preInvestAmount: data.preInvestAmount ?? null,
      preManaInvestAmount: data.preManaInvestAmount ?? null,
      preAoeRegionId: data.preAoeRegionId ?? null,
      preOrbDischarging: data.preOrbDischarging ?? false,
      preTargetIds: data.preTargetIds ?? [],
      preTeleportDestination: data.preTeleportDestination ?? null,
      preLeapDestination: data.preLeapDestination ?? null,
      preLeapApexFt: data.preLeapApexFt ?? null,
      ritualActivation: data.preRitualActivation ?? false,
      aiAutoInvest: data.preAiAutoInvest ?? false,
    }).finally(() => {
      // Ritual temp-skill cleanup: Medium-fired clones are spent once the
      // deferred fire returns (mirrors the GM-local branch in the tracker).
      // .finally (not .then) so an AOE-branch abort or a thrown roll still
      // removes the clone — the queued action was consumed either way.
      if (item.flags?.aspectsofpower?.isRitualActivation && actor.items.get(item.id)) {
        actor.deleteEmbeddedDocuments('Item', [item.id]).catch(() => {});
      }
    });
  });

  // Socket: a non-GM client (attacker) needs a combatant it doesn't own
  // updated — e.g., an NPC it attacked dodged, and the scramble/dodge-cost
  // writes hit the defender's combatant. The active GM applies it.
  game.socket.on('system.aspects-of-power', (data) => {
    if (data?.action !== 'gmCombatantUpdate') return;
    if (game.users.activeGM !== game.user) return;
    const combatant = game.combats.get(data.combatId)?.combatants.get(data.combatantId);
    if (combatant) combatant.update(data.data, data.options ?? {}).catch(err =>
      console.warn('[aop] gmCombatantUpdate failed:', err)
    );
  });

  // ── One-time migrations ──
  // isActingGM: two GM clients hitting ready simultaneously both read the
  // stale migrationVersion and both run the migration — double writes.
  if (isActingGM()) {
    const migrationVersion = game.settings.get('aspects-of-power', 'migrationVersion') ?? '0';
    if (foundry.utils.isNewerVersion('2.1.1', migrationVersion)) {
      // Migrate equipment slot 'hands' → 'weaponry'.
      let migrated = 0;
      for (const actor of game.actors) {
        for (const item of actor.items) {
          if (item.type === 'item' && item.system.slot === 'hands') {
            await item.update({ 'system.slot': 'weaponry' });
            migrated++;
          }
        }
      }
      // Also migrate unowned items in the Items sidebar.
      for (const item of game.items) {
        if (item.type === 'item' && item.system.slot === 'hands') {
          await item.update({ 'system.slot': 'weaponry' });
          migrated++;
        }
      }
      if (migrated > 0) ui.notifications.info(`Migration: renamed ${migrated} equipment slot(s) from "hands" to "weaponry".`);
      await game.settings.set('aspects-of-power', 'migrationVersion', '2.1.1');
    }

    // Migration 2.2.0: Move ActiveEffect flag data into system fields (AE TypeDataModel).
    if (foundry.utils.isNewerVersion('2.2.0', migrationVersion)) {
      let migrated = 0;
      const migrateEffect = async (effect) => {
        const aopFlags = effect.flags?.['aspects-of-power'] ?? {};
        const nohyphenFlags = effect.flags?.aspectsofpower ?? {};
        const merged = { ...nohyphenFlags, ...aopFlags };
        if (Object.keys(merged).length === 0) return;

        const systemUpdate = {};
        const fieldMap = [
          'effectCategory', 'effectType', 'itemSource', 'debuffType', 'debuffDamage',
          'breakProgress', 'dot', 'dotDamage', 'dotDamageType', 'applierActorUuid',
          'casterActorUuid', 'affinities', 'magicType', 'directions',
          'dismemberedSlot', 'sleepActive', 'overhealthDecayReduction',
        ];
        for (const key of fieldMap) {
          if (merged[key] !== undefined) systemUpdate[`system.${key}`] = merged[key];
        }
        // Barrier data is nested.
        if (merged.barrierData) systemUpdate['system.barrierData'] = merged.barrierData;

        if (Object.keys(systemUpdate).length > 0) {
          systemUpdate.type = 'base';
          await effect.update(systemUpdate);
          migrated++;
        }
      };

      // Migrate effects on actors.
      for (const actor of game.actors) {
        for (const effect of actor.effects) await migrateEffect(effect);
        // Effects on owned items.
        for (const item of actor.items) {
          for (const effect of item.effects) await migrateEffect(effect);
        }
      }
      // Migrate effects on unowned items.
      for (const item of game.items) {
        for (const effect of item.effects) await migrateEffect(effect);
      }

      if (migrated > 0) ui.notifications.info(`Migration: moved ${migrated} ActiveEffect flag(s) to system fields.`);
      await game.settings.set('aspects-of-power', 'migrationVersion', '2.2.0');
    }

    // Migration 2.3.0: Backfill `threefold-path` tag on race items missing any path-structure tag.
    if (foundry.utils.isNewerVersion('2.3.0', migrationVersion)) {
      const PATH_TAGS = new Set(['threefold-path', 'twofold-path', 'onefold-path']);
      let backfilled = 0;
      const backfillRace = async (item) => {
        const tags = item.system.systemTags ?? [];
        if (tags.some(t => PATH_TAGS.has(t.id))) return;
        await item.update({ 'system.systemTags': [...tags, { id: 'threefold-path', value: 0 }] });
        backfilled++;
      };
      for (const item of game.items) {
        if (item.type === 'race') await backfillRace(item);
      }
      // Defensive: handle race items embedded on actors (shouldn't exist per current architecture, but safe).
      for (const actor of game.actors) {
        for (const item of actor.items) {
          if (item.type === 'race') await backfillRace(item);
        }
      }
      if (backfilled > 0) ui.notifications.info(`Migration: tagged ${backfilled} race(s) with threefold-path.`);
      await game.settings.set('aspects-of-power', 'migrationVersion', '2.3.0');
    }
  }

  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on('hotbarDrop', (bar, data, slot) => {
    if (data.type !== 'Item') return;
    createItemMacro(data, slot);   // fire-and-forget async
    return false;                  // prevent Foundry's default (which opens the sheet)
  });

  // Socket listener: only the active GM executes mutations so that
  // players can buff/debuff/heal actors they don't own.
  game.socket.on('system.aspects-of-power', async (payload) => {
    // --- Player-side: quick-actions prompt (after their queued action resolves) ---
    if (payload.type === 'quickActionsPrompt' && payload.targetUserId === game.userId) {
      try {
        const actor = game.actors.get(payload.actorId);
        if (!actor) return;
        const { QuickActionsDialog } = await import('./apps/quick-actions-dialog.mjs');
        new QuickActionsDialog(actor).render(true);
      } catch (e) {
        console.warn('Quick-actions prompt failed:', e);
      }
      return;
    }

    // --- Player-side: defense prompt ---
    if (payload.type === 'defensePrompt' && payload.targetUserId === game.userId) {
      const buttons = [];
      if (payload.hasDefend ?? payload.hasPool) {
        buttons.push({ action: 'defend', label: payload.defendLabel ?? 'Defend', icon: 'fas fa-shield-alt', default: true });
      }
      for (const rs of (payload.reactionSkills ?? [])) {
        if (rs.available) {
          buttons.push({ action: `reaction:${rs.id}`, label: rs.name, icon: 'fas fa-bolt' });
        } else {
          buttons.push({ action: `reaction:${rs.id}`, label: `${rs.name} (no reactions)`, icon: 'fas fa-bolt', disabled: true });
        }
      }
      buttons.push({ action: 'takeHit', label: 'Take Hit' });

      const action = await foundry.applications.api.DialogV2.wait({
        window: { title: `Defend — ${payload.targetName}` },
        content: payload.promptContent,
        buttons,
        close: () => 'takeHit',
      });

      let defend = false;
      let reactionSkillId = null;
      if (action === 'defend') {
        defend = true;
      } else if (typeof action === 'string' && action.startsWith('reaction:')) {
        reactionSkillId = action.slice('reaction:'.length);
      }

      game.socket.emit('system.aspects-of-power', {
        type: 'defensePromptResponse',
        requestId: payload.requestId,
        defend,
        reactionSkillId,
      });
      return;
    }

    // --- Player-side: barrier prompt from GM ---
    if (payload.type === 'barrierPrompt' && payload.targetUserId === game.userId) {
      const accepted = await foundry.applications.api.DialogV2.confirm({
        window: { title: `Barrier — ${payload.targetName}` },
        content: payload.promptContent,
        yes: { label: 'Accept', icon: 'fas fa-shield-alt' },
        no: { label: 'Decline' },
      });
      game.socket.emit('system.aspects-of-power', {
        type: 'barrierPromptResponse',
        requestId: payload.requestId,
        accepted,
      });
      return;
    }

    // --- GM-side handlers ---
    if (game.users.activeGM !== game.user) return;

    if (payload.type === 'gmCombatResult') {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: payload.content,
      });
    } else if (['gmApplyBuff', 'gmApplyDebuff', 'gmApplyRestoration', 'gmApplyRepair', 'gmApplyCleanse', 'gmUpdateDefensePool', 'gmConsumeReaction', 'gmExecuteTrade', 'gmCreateAoeRegion', 'gmDeleteAoeRegion'].includes(payload.type)) {
      await AspectsofPowerItem.executeGmAction(payload);
    } else if (payload.type === 'gmCelerityRealtimeToggle') {
      // TRIAL-REALTIME: player clicked the play/pause button. The real loop
      // lives on the GM client (combat.update authority + central dispatch
      // for socket-routed action fires). Toggle our local tracker instance;
      // the start/stop methods write a combat flag so all clients' button
      // icons sync via the document-update broadcast.
      const tracker = ui.combat;
      if (tracker?.constructor?.name === 'CelerityCombatTracker') {
        const flagOn = !!tracker.viewed?.flags?.aspectsofpower?.realtimeRunning;
        if (flagOn || tracker._realtimeRunning) await tracker._realtimeStop();
        else await tracker._realtimeStart();
      }
    }
  });
});

/* -------------------------------------------- */
/*  ActiveEffect Config — Attribute Key Dropdown */
/* -------------------------------------------- */

/**
 * Replace the free-text "Attribute Key" input in the built-in ActiveEffect
 * config sheet with a <select> dropdown populated from buffableAttributes.
 */
Hooks.on('renderActiveEffectConfig', (app, element, _options) => {
  const el = element instanceof HTMLElement ? element : element[0];
  if (!el) return;
  const keyInputs = el.querySelectorAll('input[name^="changes."][name$=".key"]');
  if (!keyInputs.length) return;

  const attrs = CONFIG.ASPECTSOFPOWER.buffableAttributes;
  keyInputs.forEach(input => {
    const select = document.createElement('select');
    select.name = input.name;
    select.className = input.className;

    // Blank option for unset rows
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '\u2014 Select \u2014';
    select.appendChild(emptyOpt);

    // Standard attributes: short key → system.{key}.value
    for (const [attrKey, label] of Object.entries(attrs)) {
      const fullKey = `system.${attrKey}.value`;
      const opt = document.createElement('option');
      opt.value = fullKey;
      opt.textContent = game.i18n.localize(label);
      if (input.value === fullKey) opt.selected = true;
      select.appendChild(opt);
    }
    // Extra effect keys that don't follow the .value pattern.
    const extras = CONFIG.ASPECTSOFPOWER.extraEffectKeys ?? {};
    for (const [fullKey, label] of Object.entries(extras)) {
      const opt = document.createElement('option');
      opt.value = fullKey;
      opt.textContent = game.i18n.localize(label);
      if (input.value === fullKey) opt.selected = true;
      select.appendChild(opt);
    }

    input.replaceWith(select);
  });
});

/* -------------------------------------------- */
/*  Turn Lifecycle — Consolidated               */
/* -------------------------------------------- */

/**
 * Consolidated turn-start hook. Delegates to actor.onStartTurn()
 * which handles stamina regen, overhealth decay, defense pools,
 * debuff break rolls, and turn-skip announcements.
 * Only the GM executes to avoid duplicate writes.
 */
Hooks.on('combatTurnChange', async (combat, _prior, current) => {
  if (!isActingGM()) return;
  // Skip under celerity — round-end mechanics fire from the celerity tracker's
  // advance handler instead. (Foundry's turn pointer change still happens for
  // pan-to-active sync, but we don't want to re-run regen/sustain/etc.)
  if (CONFIG.ui.combat?.name === 'CelerityCombatTracker') return;
  const combatant = combat.combatants.get(current.combatantId);
  if (!combatant?.actor) return;
  await combatant.actor.onStartTurn(combat, current);
});

// Overhealth decay, defense pool reset, and debuff enforcement are now
// consolidated in AspectsofPowerActor.onStartTurn() above.
/**
 * Initialize defense pools and reactions when combat starts.
 */
Hooks.on('combatStart', async (combat) => {
  if (!isActingGM()) return;
  for (const combatant of combat.combatants) {
    if (!combatant.actor) continue;
    const actor = combatant.actor;
    const updateData = {};
    for (const defKey of ['melee', 'ranged', 'mind', 'soul']) {
      const poolMax = actor.system.defense[defKey]?.poolMax ?? 0;
      updateData[`system.defense.${defKey}.pool`] = poolMax;
    }
    updateData['system.reactions.value'] = actor.system.reactions?.max ?? 1;
    await actor.update(updateData);
  }
});

/* -------------------------------------------- */
/*  DoT Damage — Applier's Turn                 */
/* -------------------------------------------- */

/**
 * Apply damage-over-time from debuff ActiveEffects at the start of the
 * applier's turn. Damage bypasses armor/veil (applied directly).
 * Only the GM executes to avoid duplicate writes.
 */
Hooks.on('combatTurnChange', async (combat, _prior, current) => {
  if (!isActingGM()) return;
  // Skip under celerity — DoTs fire per-actor at celerity round boundaries
  // via runRoundEnd. The legacy turn-change DoT pass would double-tick.
  if (CONFIG.ui.combat?.name === 'CelerityCombatTracker') return;

  const combatant = combat.combatants.get(current.combatantId);
  if (!combatant?.actor) return;
  const applierUuid = combatant.actor.uuid;

  // Check every combatant for DoT effects placed by the current actor.
  for (const c of combat.combatants) {
    if (!c.actor) continue;
    for (const effect of c.actor.effects) {
      const sys = effect.system ?? {};
      if (!sys.dot || sys.applierActorUuid !== applierUuid || effect.disabled) continue;

      const rawDamage = sys.dotDamage ?? 0;
      if (rawDamage <= 0) continue;

      const drValue = c.actor.system.defense?.dr?.value ?? 0;
      const damage  = Math.max(0, rawDamage - drValue);
      const health  = c.actor.system.health;
      const newHealth = Math.max(0, health.value - damage);
      await c.actor.update({ 'system.health.value': newHealth });

      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${c.actor.name}</strong> takes <strong>${damage}</strong> `
               + `${sys.dotDamageType ?? 'physical'} damage from ${effect.name} (DR: −${drValue}). `
               + `Health: ${newHealth} / ${health.max}`
               + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
      });
    }
  }
});

/* -------------------------------------------- */
/*  Effect Expiry — v14 Auto-Delete Cleanup     */
/* -------------------------------------------- */

/**
 * v14: CONFIG.ActiveEffect.expiryAction = 'delete' handles duration-based
 * deletion automatically. This hook cleans up side-effects (blind status,
 * dismembered slots) when any ActiveEffect is deleted.
 */
Hooks.on('deleteActiveEffect', async (effect, _options, _userId) => {
  if (!isActingGM()) return;
  const actor = effect.parent;
  if (!actor || !(actor instanceof Actor)) return;

  // Remove Foundry blind status if a blind debuff was deleted.
  if (effect.system?.debuffType === 'blind') {
    for (const t of actor.getActiveTokens()) {
      if (t.document.hasStatusEffect('blind')) {
        await t.document.toggleActiveEffect({ id: 'blind', name: 'Blind', img: 'icons/svg/blind.svg' }, { active: false });
      }
    }
  }

  // Post expiry notification for effects that had a duration.
  const dur = effect.duration;
  if (dur?.rounds > 0) {
    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: `<p>Expired: <strong>${effect.name}</strong> on ${actor.name}</p>`,
    });
  }

  // ── Sustain end → drop linked buff(s) ──
  // When a sustain marker effect is removed (out of mana, actor death,
  // manual dispel), any other AE on the same actor whose `origin` traces
  // back to the same source skill is also removed. Without this, a buff
  // applied alongside the sustain would outlive its upkeep.
  // Linking: sustain stores `system.itemSource` = source skill id. Buff's
  // `origin` is the skill UUID; we match the `.Item.<id>` suffix.
  if (effect.system?.effectType === 'sustain') {
    const sustainItemId = effect.system?.itemSource;
    if (sustainItemId) {
      const linked = actor.effects.filter(e => {
        if (e.id === effect.id) return false;
        const m = (e.origin ?? '').match(/\.Item\.([A-Za-z0-9]+)$/);
        return m && m[1] === sustainItemId;
      });
      if (linked.length > 0) {
        await actor.deleteEmbeddedDocuments('ActiveEffect', linked.map(e => e.id));
        ChatMessage.create({
          whisper: ChatMessage.getWhisperRecipients('GM'),
          content: `<p><strong>${actor.name}</strong> — sustain ended; linked effects dropped: ${linked.map(e => e.name).join(', ')}</p>`,
        });
      }
    }
  }
});

/* -------------------------------------------- */
/*  AOE Template Expiry — Duration Tracking     */
/* -------------------------------------------- */

/**
 * Delete AOE Regions whose duration (in rounds) has elapsed.
 * Only the GM executes to avoid duplicate deletes.
 */
Hooks.on('combatTurnChange', async (combat, prior, _current) => {
  if (!isActingGM()) return;
  if (!canvas.scene?.regions) return;

  const toDelete = [];
  for (const doc of canvas.scene.regions) {
    const flags = doc.flags?.['aspects-of-power'] ?? {};
    if (!flags.aoe) continue;

    const duration = flags.templateDuration ?? 0;
    if (duration <= 0) continue;

    const placedRound = flags.placedRound ?? 0;
    if (placedRound > 0 && combat.round - placedRound >= duration) {
      toDelete.push(doc.id);
    }
  }

  if (toDelete.length > 0) {
    await canvas.scene.deleteEmbeddedDocuments('Region', toDelete);
    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: `<p>Expired ${toDelete.length} AOE area(s).</p>`,
    });
  }
});

/* -------------------------------------------- */
/*  Casting Range Aura — Canvas Visual          */
/* -------------------------------------------- */

/**
 * Draw a translucent circle around owned tokens whose casting range
 * aura is toggled on. Redrawn on every token refresh (idempotent).
 * Only visible to the token's owning player(s).
 */
Hooks.on('refreshToken', (token) => {
  // ── Facing indicator ──────────────────────────────────────────────────────
  if (token._facingIndicator) {
    token._facingIndicator.destroy();
    token._facingIndicator = null;
  }

  const rotRad = (token.document.rotation ?? 0) * Math.PI / 180;
  const cx     = token.w / 2;
  const cy     = token.h / 2;
  const r      = Math.min(token.w, token.h) / 2;
  // Foundry rotation 0 = image as-is; default token art faces south (+y).
  // Forward = direction the character visually faces.
  const fwdX   = -Math.sin(rotRad);
  const fwdY   = Math.cos(rotRad);
  const rgtX   = Math.cos(rotRad);
  const rgtY   = Math.sin(rotRad);
  const hw     = r * 0.2;
  const depth  = r * 0.3;
  const tipX   = cx + fwdX * r;
  const tipY   = cy + fwdY * r;
  const pts    = [
    tipX,                               tipY,
    tipX - fwdX * depth + rgtX * hw,   tipY - fwdY * depth + rgtY * hw,
    tipX - fwdX * depth - rgtX * hw,   tipY - fwdY * depth - rgtY * hw,
  ];

  const fi = new PIXI.Graphics();
  if (typeof fi.drawPolygon === 'function') {
    fi.beginFill(0xffffff, 0.9);
    fi.lineStyle(1, 0x222222, 0.6);
    fi.drawPolygon(pts);
    fi.endFill();
  } else {
    fi.poly(pts);
    fi.fill({ color: 0xffffff, alpha: 0.9 });
    fi.stroke({ color: 0x222222, alpha: 0.6, width: 1 });
  }
  token.addChild(fi);
  token._facingIndicator = fi;

  // ── Casting range aura ────────────────────────────────────────────────────
  // Remove any existing aura graphic first (idempotent redraw).
  if (token._castingRangeAura) {
    token._castingRangeAura.destroy();
    token._castingRangeAura = null;
  }

  // Wrapped in an IIFE so the inner early-returns only skip THIS branch,
  // not the rest of the refreshToken hook (the in-range hostile highlight
  // below this needs to run regardless of casting-aura state).
  (() => {
    if (!token.document.isOwner) return;
    const userMap = game.user.getFlag('aspects-of-power', 'showRangeFor') ?? {};
    if (!userMap[token.document.id]) return;
    const actor = token.document.actor;
    if (!actor?.system?.castingRange) return;

    const rangeInFeet  = actor.system.castingRange;
    const pixelsPerFoot = canvas.grid.size / canvas.grid.distance;
    const radiusPx     = rangeInFeet * pixelsPerFoot;
    const centerX = (token.document.width * canvas.grid.size) / 2;
    const centerY = (token.document.height * canvas.grid.size) / 2;

    const gfx = new PIXI.Graphics();
    if (typeof gfx.drawCircle === 'function') {
      gfx.beginFill(0x4488ff, 0.1);
      gfx.lineStyle(2, 0x4488ff, 0.5);
      gfx.drawCircle(centerX, centerY, radiusPx);
      gfx.endFill();
    } else {
      gfx.circle(centerX, centerY, radiusPx);
      gfx.fill({ color: 0x4488ff, alpha: 0.1 });
      gfx.stroke({ color: 0x4488ff, alpha: 0.5, width: 2 });
    }
    token.addChild(gfx);
    token._castingRangeAura = gfx;
  })();

  // ── In-range hostile highlight ─────────────────────────────────────────────
  // Replaces the auto-on-selection threat-range circle. When ANY friendly
  // token is controlled, every hostile within the controller's effective
  // weapon/catalyst range gets a yellow outline ring. Tells the player
  // exactly who they can act on right now without overlaying a giant
  // circle on the map.
  if (token._inRangeHighlight) {
    token._inRangeHighlight.destroy();
    token._inRangeHighlight = null;
  }
  if (token.document.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
      && shouldHighlightHostile(token)) {
    // Soft halo: 4 concentric circles, each wider + dimmer + thicker.
    // Reads as a faint warm glow leaking outside the token bounds
    // rather than a hard yellow outline.
    const baseRadius = Math.max(token.w, token.h) / 2;
    const cxLocal = token.w / 2;
    const cyLocal = token.h / 2;
    const glow = new PIXI.Graphics();
    // Render BEHIND the sprite so the glow halos behind the art.
    // PIXI graphics with negative zIndex won't help here because Token
    // doesn't sortChildren; instead use addChildAt(...,  0) so it draws
    // first (behind everything else added later).
    const layers = [
      { extra: 10, width: 4, alpha: 0.08 },
      { extra: 7,  width: 4, alpha: 0.14 },
      { extra: 4,  width: 3, alpha: 0.20 },
      { extra: 2,  width: 2, alpha: 0.28 },
    ];
    const color = 0xffd86b; // warm pale gold
    for (const L of layers) {
      if (typeof glow.drawCircle === 'function') {
        glow.lineStyle(L.width, color, L.alpha);
        glow.drawCircle(cxLocal, cyLocal, baseRadius + L.extra);
      } else {
        glow.circle(cxLocal, cyLocal, baseRadius + L.extra);
        glow.stroke({ color, alpha: L.alpha, width: L.width });
      }
    }
    token.addChildAt(glow, 0);
    token._inRangeHighlight = glow;
  }
});

/**
 * Effective range a controlled actor can act at, in feet. Depends on
 * the actor's equipped weaponry-slot item:
 *  - Magic catalyst (wand/staff/orb tag): casting range from actor system.
 *  - Melee weapon: weapon reach, min 5 ft.
 *  - Ranged (pending design): returns null for now.
 *  - Unarmed: 5 ft.
 */
function getEffectiveRangeFt(actor) {
  if (!actor) return null;
  const equipped = actor.items?.find(i =>
    i.type === 'item' && i.system?.equipped && i.system?.slot === 'weaponry'
  );
  if (!equipped) return 5;
  const tags = equipped.system?.tags ?? [];
  if (tags.includes('wand') || tags.includes('staff') || tags.includes('orb')) {
    return actor.system?.castingRange ?? 5;
  }
  if (tags.includes('ranged')) return null; // pending design
  return Math.max(5, equipped.system?.reach ?? 5);
}

/**
 * Edge-to-edge distance in feet between two tokens. Accounts for
 * each token's size so a Large monster has its full edge reachable
 * by an adjacent Medium, not center-to-center distance.
 */
function tokenEdgeDistanceFt(t1, t2) {
  const dx = t1.center.x - t2.center.x;
  const dy = t1.center.y - t2.center.y;
  const centerDist = Math.hypot(dx, dy);
  const r1 = Math.max(t1.document.width ?? 1, t1.document.height ?? 1) * canvas.grid.size / 2;
  const r2 = Math.max(t2.document.width ?? 1, t2.document.height ?? 1) * canvas.grid.size / 2;
  const edgeDistPx = Math.max(0, centerDist - r1 - r2);
  return edgeDistPx / (canvas.grid.size / canvas.grid.distance);
}

/**
 * True if `hostileToken` is within effective range of any currently
 * controlled friendly token (caller passes only the hostile; we read
 * controlled friendlies from canvas.tokens).
 */
function shouldHighlightHostile(hostileToken) {
  const friendlies = canvas.tokens?.controlled?.filter(t =>
    t.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY && t.actor
  ) ?? [];
  if (friendlies.length === 0) return false;
  return friendlies.some(f => {
    const rangeFt = getEffectiveRangeFt(f.actor);
    if (rangeFt == null) return false;
    return tokenEdgeDistanceFt(f, hostileToken) <= rangeFt;
  });
}

/** Force every hostile token to redraw so the highlight ring picks up
 *  a new selection / friendly movement / weapon swap. */
function refreshHostileHighlights() {
  if (!canvas?.tokens?.placeables) return;
  for (const t of canvas.tokens.placeables) {
    if (t.document.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE && t.refresh) {
      t.refresh();
    }
  }
}

// Selection change — refresh the token itself plus every hostile so the
// in-range highlight rings appear / disappear immediately rather than
// waiting for some other refresh trigger.
Hooks.on('controlToken', (token, _controlled) => {
  if (token?.refresh) token.refresh();
  refreshHostileHighlights();
});

// A friendly moved or had their equipment swapped — recompute hostile
// highlights against the new position / range.
Hooks.on('updateToken', (doc, changes, _options, _userId) => {
  if (changes.x === undefined && changes.y === undefined) return;
  if (doc.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) return;
  refreshHostileHighlights();
});
Hooks.on('updateItem', (item, changes, _options, _userId) => {
  const sys = changes?.system ?? {};
  if (sys.equipped === undefined && sys.reach === undefined && sys.tags === undefined && sys.slot === undefined) return;
  const actor = item.parent;
  if (!actor?.getActiveTokens) return;
  const tokens = actor.getActiveTokens();
  if (tokens.some(t => t.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY)) {
    refreshHostileHighlights();
  }
});

/* -------------------------------------------- */
/*  Token HUD — Casting Range Toggle            */
/* -------------------------------------------- */

/**
 * Add a "Toggle Casting Range" button to the Token HUD.
 * Only shown for tokens the user owns.
 */
Hooks.on('renderTokenHUD', (hud, html, data) => {
  const tokenDoc = hud.object.document;
  if (!tokenDoc.isOwner) return;
  if (!tokenDoc.actor?.system?.castingRange) return;

  // Per-user toggle — `showRangeFor` is a map { tokenId: true } stored on
  // the user's own flags. Each client reads/writes their own. GM toggling
  // on Token X doesn't show the aura on the player's view, and vice versa.
  const userMap = game.user.getFlag('aspects-of-power', 'showRangeFor') ?? {};
  const isActive = userMap[tokenDoc.id] ? 'active' : '';
  const button = document.createElement('div');
  button.classList.add('control-icon');
  if (isActive) button.classList.add('active');
  button.setAttribute('data-action', 'toggle-casting-range');
  button.setAttribute('title', 'Toggle Casting Range (this client only)');
  button.innerHTML = '<i class="fas fa-bullseye"></i>';

  button.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const map = game.user.getFlag('aspects-of-power', 'showRangeFor') ?? {};
    if (map[tokenDoc.id]) {
      // Toggle off — setFlag merges by default, so a JS `delete` + setFlag
      // would just restore the key on next merge. Use the V14.360+
      // ForcedDeletion sentinel for the unset (the legacy `-=key` prefix
      // still works but logs a deprecation warning).
      // The sentinel must be an INSTANCE, not the class — passing the class
      // is silently ignored and the key never deletes (see actor.mjs, which
      // does `new FD()`, and reference_foundry_quirks #11).
      const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
      await game.user.update({
        [`flags.aspects-of-power.showRangeFor.${tokenDoc.id}`]: ForcedDeletion ? new ForcedDeletion() : null,
      });
    } else {
      // Toggle on — merge a single new entry; merge semantics are fine here.
      await game.user.setFlag('aspects-of-power', 'showRangeFor', { [tokenDoc.id]: true });
    }
    button.classList.toggle('active');
    // Trigger refreshToken so the aura redraws (or clears) immediately.
    if (hud.object.refresh) hud.object.refresh();
  });

  // Append to the right-side column of the HUD.
  const rightCol = html.querySelector('.col.right') ?? html.querySelector('.right');
  if (rightCol) rightCol.appendChild(button);
});

/* -------------------------------------------- */
/*  Movement Tracker Reset — Start of Turn      */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Movement Path Overlay                       */
/* -------------------------------------------- */

// Attach + detach the path-overlay container with the canvas lifecycle.
Hooks.on('canvasReady', () => attachOverlayLayer());
Hooks.on('canvasTearDown', () => detachOverlayLayer());

// Power-sense ring overlay (design-power-sense): same lifecycle + triggers,
// plus controlToken (the observer changed → range/sense gates re-evaluate)
// and updateActor (sense tags / stats changed).
Hooks.on('canvasReady', () => attachPowerSenseLayer());
Hooks.on('canvasTearDown', () => detachPowerSenseLayer());
Hooks.on('controlToken', () => { refreshPowerSense(); refreshOverlay(); });
Hooks.on('updateToken', () => { refreshPowerSense(); refreshOverlay(); });

// Re-render overlay when any combatant's flags change (declare / cancel /
// movement completion clears the flag) or the combat clock advances (so
// the current-position dot moves along the path).
Hooks.on('updateCombatant', (combatant, change) => {
  if (change?.flags?.aspectsofpower?.declaredAction !== undefined) {
    refreshOverlay();
    refreshPowerSense();
  }
});
Hooks.on('updateCombat', (combat, change) => {
  // Clock-tick changes don't always pass through `change` if we're updating
  // it directly via combat.update — easier to refresh on any combat update.
  refreshOverlay();
  refreshPowerSense();
});
Hooks.on('deleteCombat', () => { refreshOverlay(); refreshPowerSense(); });

// Reset first-contact-seen tracking on combat start so each new encounter
// starts with no stale "already seen" memory carrying over. Per design
// 2026-05-10: first-contact LOS halts trigger only on truly new enemies
// per encounter.
Hooks.on('combatStart', combat => resetFirstContactSeen(combat));

// Persistent AOE entry-tick on region creation. Foundry's RegionBehavior
// tokenEnter only fires on token movement INTO a region — not when a
// region is created with tokens already inside. Verified empirically
// 2026-05-10. Without this hook, casting a Vine Trap on top of a target
// would create the region but never fire the entry tick (no pool drain,
// no immediate damage, etc.) until the target moved or the next round-tick.
//
// Gate to ACTIVE GM ONLY. createRegion fires on every connected client;
// multiple GMs (e.g. GM + Claude) racing through the cadence check before
// any document write commits will all pass the gate and apply duplicate
// effects. The cadence dedupe alone isn't sufficient because document
// updates propagate async via socket — the read state is stale across
// clients. game.users.activeGM is Foundry's canonical "the GM that
// handles GM-only actions" (typically the first/oldest active GM).
Hooks.on('createRegion', async (region, options, userId) => {
  if (game.user.id !== game.users.activeGM?.id) return;
  const flags = region.flags?.['aspects-of-power'];
  if (!flags?.persistent || !flags.persistentData) return;
  const scene = region.parent;
  if (!scene) return;
  const trigger = game.aspectsofpower?._triggerPersistentAoe;
  if (typeof trigger !== 'function') return;
  for (const tokenDoc of scene.tokens) {
    const tok = tokenDoc.object;
    if (!tok) continue;
    const center = tok.center;
    if (!region.testPoint({ x: center.x, y: center.y, elevation: tokenDoc.elevation ?? 0 })) continue;
    await trigger(tokenDoc, false); // force=false — cadence gate dedupes multi-fires
  }
});

// Clear any staged movement buffers when combat ends or the scene tears
// down — buffers are transient client-side state.
Hooks.on('deleteCombat', () => clearAllBuffers());
Hooks.on('canvasTearDown', () => clearAllBuffers());

// Re-render the path overlay on buffer change so the staged destination
// shows up live as the player taps WASD.
Hooks.on('aopMovementBufferChanged', () => refreshOverlay());

/* -------------------------------------------- */
/*  Stamina-based Movement Cost & Limits        */
/* -------------------------------------------- */

// Movement enforcement is now handled by AspectsofPowerToken._preUpdateMovement / _onUpdateMovement.

/* -------------------------------------------- */
/*  Persistent AOE — Token Enters Area          */
/* -------------------------------------------- */

/**
 * Check if a token is inside a persistent AOE area and apply its effects.
 * Shared by the updateToken hook (entering area) and the turn-start hook
 * (standing in area at start of turn).
 * Returns true if the AOE triggered.
 */
async function _triggerPersistentAoe(tokenDoc, force = false) {
  const token = tokenDoc.object;
  if (!token) return false;
  const center = token.center;

  const collection = canvas.scene.regions;
  if (!collection) return false;

  let triggered = false;

  for (const doc of collection) {
    const flags = doc.flags?.['aspects-of-power'];
    if (!flags?.persistent || !flags.persistentData) continue;

    const pd = flags.persistentData;

    // Cadence: tick on entry (force=true bypasses the period check),
    // otherwise re-tick if currentClockTick - lastTickedAt >=
    // casterReticPeriod (caster's reference round / 4 per design 2026-05-10).
    // affectedTokens is {tokenId: lastTickedAtClockTick}.
    const affectedMap = pd.affectedTokens ?? {};
    const lastTickAt = affectedMap[tokenDoc.id] ?? null;
    const currentTick = game.combat?.flags?.aspectsofpower?.clockTick ?? 0;
    const period = pd.casterReticPeriod ?? 1175;
    if (lastTickAt !== null && !force && (currentTick - lastTickAt) < period) continue;

    // Check containment.
    const obj = doc;
    // v14: RegionDocument#testPoint with elevated point.
    if (!doc.testPoint({ x: center.x, y: center.y, elevation: tokenDoc.elevation ?? 0 })) continue;

    // Disposition filter.
    const tokenDisp = tokenDoc.disposition;
    const casterDisp = pd.casterDisposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    if (pd.targetingMode === 'enemies') {
      if (casterDisp === CONST.TOKEN_DISPOSITIONS.FRIENDLY && tokenDisp !== CONST.TOKEN_DISPOSITIONS.HOSTILE) continue;
      if (casterDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE && tokenDisp !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;
      if (casterDisp === CONST.TOKEN_DISPOSITIONS.NEUTRAL) continue;
    } else if (pd.targetingMode === 'allies') {
      if (tokenDisp !== casterDisp) continue;
    }

    // Record last-ticked clockTick for this token.
    const updatedMap = { ...(pd.affectedTokens ?? {}), [tokenDoc.id]: currentTick };
    await doc.update({ 'flags.aspects-of-power.persistentData.affectedTokens': updatedMap });

    // Apply effects.
    const casterActor = await fromUuid(flags.casterActorUuid);
    const targetActor = tokenDoc.actor;
    if (!casterActor || !targetActor) continue;

    const speaker = ChatMessage.getSpeaker({ actor: casterActor });
    const rollTotal = pd.rollTotal ?? 0;

    // Dispatch by tag composition per design-aoe-dispatch.md.
    const tagSet = new Set(pd.tags ?? []);
    const isShrapnel = pd.isShrapnel ?? tagSet.has('shrapnel');
    const isMagic = pd.isMagic ?? tagSet.has('magic');
    const targetDefense = pd.targetDefense ?? 'melee';
    const targetingPool = (targetDefense === 'mind' || targetDefense === 'soul');

    if (tagSet.has('attack') && rollTotal > 0) {
      // Damage AOE.
      // - Shrapnel: ranged attack with hitBonus, pool applies (target's
      //   ranged pool absorbs hit), then armor (physical) or veil (magical).
      // - Plain attack-AOE: bypass pool (you're inside the effect),
      //   route directly to armor (physical) or veil (magical) → DR → HP.
      const hitBonus = isShrapnel ? (pd.tagConfig?.shrapnelHitBonus ?? 4) : 0;
      const finalHit = (pd.hitTotal ?? rollTotal) + hitBonus;
      // Armor-answer routing (2026-07-16): veil only for mind/soul zones;
      // physical AND elemental zone damage face armor. (Was: all `magic` → veil.)
      const zoneMitLane = targetingPool ? 'veil' : 'armor';
      const mitigationLine = zoneMitLane === 'veil'
        ? '(mind/soul: → veil → DR → HP)'
        : '(physical/elemental: → armor → DR → HP)';
      const poolLine = isShrapnel
        ? `Hit ${finalHit} vs target's ${targetDefense} pool — pool absorbs first.`
        : 'Pool BYPASSED (persistent zone — no dodging).';

      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${targetActor.name}</strong> caught in AOE zone — `
               + `<strong>${rollTotal}</strong> ${pd.damageType} damage `
               + `${isShrapnel ? '(shrapnel)' : '(environmental)'}.</p>`
               + `<p><em>${poolLine} ${mitigationLine}</em></p>`
               + `<button class="apply-damage" data-actor-uuid="${targetActor.uuid}" `
               + `data-damage="${rollTotal}" data-toughness="${targetActor.system.defense?.dr?.value ?? 0}" `
               + `data-damage-type="${pd.damageType}" data-affinity-dr="0" data-mitigation="${zoneMitLane}" `
               + `data-bypass-pool="${!isShrapnel}">Apply Damage</button>`,
      });
    }

    // Zone-debuff gate must mirror _handleDebuffTag's semantics (item.mjs):
    // a debuff is "real" when it has a CC subtype OR stat-reduction entries
    // OR deals DoT damage. The old gate required debuffType !== 'none',
    // which silently skipped every pure stat-reduction zone debuff — the
    // "AOE zone-debuff never applies" bug (design-class-spell-libraries).
    const zoneDebuffCfg = pd.tagConfig ?? {};
    const zoneHasDebuffPayload =
      (zoneDebuffCfg.debuffType && zoneDebuffCfg.debuffType !== 'none')
      || (zoneDebuffCfg.debuffEntries?.length > 0)
      || !!zoneDebuffCfg.debuffDealsDamage;
    if (tagSet.has('debuff') && zoneHasDebuffPayload) {
      // Debuff AOE.
      // - Mental (targetDefense mind/soul): ablative pool depletion. Each
      //   tick subtracts debuffPoolCost from target's mind/soul pool. When
      //   pool hits 0, the debuff applies fully.
      // - Physical (targetDefense melee/ranged): bypass pool (no dodging),
      //   apply per saveModel.
      if (targetingPool) {
        await _resolveMentalDebuffTick(targetActor, pd, flags, targetDefense, speaker);
      } else {
        await _resolvePhysicalDebuffTick(targetActor, pd, flags, rollTotal, speaker);
      }
    }

    if (tagSet.has('buff') && (pd.tagConfig?.buffEntries ?? []).length > 0) {
      const changes = pd.tagConfig.buffEntries.map(e => ({
        key: `system.${e.attribute}.value`,
        type: 'add',
        value: Math.round(rollTotal * (e.value || 1)),
      }));
      await AspectsofPowerItem.executeGmAction({
        type: 'gmApplyBuff',
        targetActorUuid: targetActor.uuid,
        effectName: `AOE Buff`,
        originUuid: flags.casterActorUuid,
        changes,
        duration: pd.tagConfig.buffDuration ?? 1,
        stackable: pd.tagConfig.buffStackable ?? false,
        img: 'icons/svg/aura.svg',
        speaker,
      });
    }

    triggered = true;
  }

  return triggered;
}

/**
 * Walk-mode terrain-resistance bonus per design-movement-modes.md. An actor
 * with an in-flight Walk movement declaration gets +25% of their relevant
 * stat's mod added to defense rolls vs terrain effects. Sprint movers and
 * stationary tokens (no movement declared) get no bonus.
 *
 * @param {Actor}  targetActor
 * @param {string} ability       e.g. 'dexterity', 'willpower'
 * @returns {number}             flat bonus to add (rounded)
 */
function _walkTerrainBonus(targetActor, ability) {
  const combat = game.combat;
  if (!combat?.started) return 0;
  const combatant = combat.combatants.find(c => c.actor?.id === targetActor?.id);
  if (!combatant) return 0;
  const decl = combatant.flags?.aspectsofpower?.declaredMovement;
  if (!decl || decl.itemId !== Celerity.MOVEMENT_ITEM_ID) return 0;
  if (decl.movementMode !== 'walk') return 0;
  const fraction = CONFIG.ASPECTSOFPOWER.celerity?.WALK_TERRAIN_BONUS_FRACTION ?? 0.25;
  const mod = targetActor.system.abilities?.[ability]?.mod ?? 0;
  return Math.round(mod * fraction);
}

/**
 * Mental-debuff per-tick resolution. Per design-aoe-dispatch.md:
 * mind/soul pools represent RESISTANCE (not avoidance). Each tick of a
 * persistent mental AOE depletes the target's relevant pool by the
 * caster's full hit-roll total (snapshotted at cast time). When pool
 * hits 0, the debuff applies fully.
 *
 * Per-skill tagConfig.debuffPoolCost overrides this if > 0 (lets designers
 * set a flat per-tick cost for special skills). Default 0 = auto-derive
 * from caster's hitTotal.
 *
 * Pool regenerates per round normally — a high-willpower target can
 * sustain through a long zone, a weak-willed one folds quickly.
 */
async function _resolveMentalDebuffTick(targetActor, pd, flags, defenseKey, speaker) {
  const override = pd.tagConfig?.debuffPoolCost ?? 0;
  const derived = pd.hitTotal ?? pd.rollTotal ?? 0;
  const rawCost = override > 0 ? override : derived;
  // Walk-mode terrain resistance applies to mental pool depletion too if
  // tagConfig declares a `targetStat` for this region (e.g., willpower for
  // hypnotic pattern). Reduces the per-tick cost by 0.25 × that stat's mod.
  const targetStat = pd.tagConfig?.targetStat ?? null;
  const walkReduction = targetStat ? _walkTerrainBonus(targetActor, targetStat) : 0;
  const cost = Math.max(0, rawCost - walkReduction);
  const defense = targetActor.system.defense?.[defenseKey];
  if (!defense) return;
  const currentPool = defense.pool ?? 0;
  const newPool = Math.max(0, currentPool - cost);
  await targetActor.update({ [`system.defense.${defenseKey}.pool`]: newPool });

  const debuffType = pd.tagConfig.debuffType;
  const walkNote = walkReduction > 0 ? ` (walking: -${walkReduction})` : '';
  if (newPool > 0) {
    // Pool absorbed it — debuff doesn't land yet.
    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: `<p><strong>${targetActor.name}</strong> resists <strong>${debuffType}</strong> from AOE — `
             + `${defenseKey} pool ${currentPool} → ${newPool} (-${cost}${walkNote}).</p>`,
    });
    return;
  }

  // Pool depleted — debuff lands.
  const duration = pd.tagConfig.debuffDuration ?? 1;
  const entries = (pd.tagConfig.debuffEntries ?? []).map(e => ({
    key: `system.${e.attribute}.value`,
    type: 'add',
    value: -Math.round((pd.rollTotal ?? 0) * (e.value || 1)),
  }));
  const dealsDmg = pd.tagConfig.debuffDealsDamage ?? false;
  const dotType = pd.tagConfig.debuffDamageType ?? pd.damageType;

  const effectData = {
    name: `AOE: ${debuffType}`,
    img: 'icons/svg/hazard.svg',
    origin: flags.casterActorUuid,
    duration: { rounds: duration, startRound: game.combat?.round ?? 0, startTurn: game.combat?.turn ?? 0 },
    disabled: false,
    changes: entries,
    type: 'base',
    system: {
      debuffDamage: pd.rollTotal ?? 0,
      debuffType,
      casterActorUuid: flags.casterActorUuid,
      ...(dealsDmg ? { dot: true, dotDamage: pd.rollTotal ?? 0, dotDamageType: dotType, applierActorUuid: flags.casterActorUuid } : {}),
    },
  };

  await AspectsofPowerItem.executeGmAction({
    type: 'gmApplyDebuff',
    targetActorUuid: targetActor.uuid,
    effectName: effectData.name,
    originUuid: flags.casterActorUuid,
    effectData,
    duration,
    stackable: pd.tagConfig.debuffStackable ?? false,
    statSummary: `${defenseKey} pool depleted — succumbs to ${debuffType}`,
    // Mental AOE zones are mind/soul-targeting by construction — route
    // potency through the target's veil (CC-through-veil rule).
    targetDefense: defenseKey,
    speaker,
  });
}

/**
 * Physical-debuff per-tick resolution. Per design-aoe-dispatch.md:
 * physical pools (melee/ranged) BYPASS for persistent zones (no dodging
 * a poison cloud you're standing in). Apply per `saveModel`:
 *   'none'    — debuff always applies
 *   'perTick' — save vs caster's hitTotal each cycle
 *   'onEntry' — save once on entry; locked in on failure
 *
 * Default 'none' = original behavior (apply unconditionally).
 */
async function _resolvePhysicalDebuffTick(targetActor, pd, flags, rollTotal, speaker) {
  const saveModel = pd.tagConfig?.saveModel ?? 'none';
  if (saveModel === 'perTick') {
    const ability = pd.tagConfig?.saveAbility ?? 'willpower';
    const baseMod = targetActor.system.abilities?.[ability]?.mod ?? 0;
    const walkBonus = _walkTerrainBonus(targetActor, ability);
    const saveMod = baseMod + walkBonus;
    const target = pd.hitTotal ?? rollTotal;
    if (saveMod >= target) {
      const walkNote = walkBonus > 0 ? ` (walking: +${walkBonus})` : '';
      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${targetActor.name}</strong> resists <strong>${pd.tagConfig.debuffType}</strong> via ${ability} save (${saveMod}${walkNote} vs ${target}).</p>`,
      });
      return;
    }
  }

  const debuffType = pd.tagConfig.debuffType;
  const duration = pd.tagConfig.debuffDuration ?? 1;
  const entries = (pd.tagConfig.debuffEntries ?? []).map(e => ({
    key: `system.${e.attribute}.value`,
    type: 'add',
    value: -Math.round(rollTotal * (e.value || 1)),
  }));
  const dealsDmg = pd.tagConfig.debuffDealsDamage ?? false;
  const dotType = pd.tagConfig.debuffDamageType ?? pd.damageType;

  const effectData = {
    name: `AOE: ${debuffType}`,
    img: 'icons/svg/hazard.svg',
    origin: flags.casterActorUuid,
    duration: { rounds: duration, startRound: game.combat?.round ?? 0, startTurn: game.combat?.turn ?? 0 },
    disabled: false,
    changes: entries,
    type: 'base',
    system: {
      debuffDamage: rollTotal,
      debuffType,
      casterActorUuid: flags.casterActorUuid,
      ...(dealsDmg ? { dot: true, dotDamage: rollTotal, dotDamageType: dotType, applierActorUuid: flags.casterActorUuid } : {}),
    },
  };

  await AspectsofPowerItem.executeGmAction({
    type: 'gmApplyDebuff',
    targetActorUuid: targetActor.uuid,
    effectName: effectData.name,
    originUuid: flags.casterActorUuid,
    effectData,
    duration,
    stackable: pd.tagConfig.debuffStackable ?? false,
    statSummary: entries.map(e => `${e.key.replace('system.', '').replace('.value', '')} ${e.value}`).join(', '),
    speaker,
  });
}

/**
 * Check zone effects (slippery, difficult terrain) on every movement.
 * These fire independently from persistent AOE tag effects — no per-round limit.
 */
async function _checkZoneEffects(tokenDoc) {
  const token = tokenDoc.object;
  if (!token) return;
  const center = token.center;
  const collection = canvas.scene.regions;
  if (!collection) return;

  for (const doc of collection) {
    const flags = doc.flags?.['aspects-of-power'];
    if (!flags?.persistent || !flags.persistentData) continue;
    const pd = flags.persistentData;
    const zoneEffect = pd.zoneEffect ?? 'none';
    if (zoneEffect === 'none') continue;

    // Containment check.
    if (!doc.testPoint({ x: center.x, y: center.y, elevation: tokenDoc.elevation ?? 0 })) continue;

    // Disposition filter.
    const tokenDisp = tokenDoc.disposition;
    const casterDisp = pd.casterDisposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    if (pd.targetingMode === 'enemies') {
      if (casterDisp === CONST.TOKEN_DISPOSITIONS.FRIENDLY && tokenDisp !== CONST.TOKEN_DISPOSITIONS.HOSTILE) continue;
      if (casterDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE && tokenDisp !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;
      if (casterDisp === CONST.TOKEN_DISPOSITIONS.NEUTRAL) continue;
    } else if (pd.targetingMode === 'allies') {
      if (tokenDisp !== casterDisp) continue;
    }

    const targetActor = tokenDoc.actor;
    if (!targetActor) continue;
    const rollTotal = pd.rollTotal ?? 0;
    const _isPC = game.users.some(u => !u.isGM && u.active && u.character?.id === targetActor.id);
    const whisper = _isPC ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };

    if (zoneEffect === 'slippery') {
      const dexMod = targetActor.system.abilities?.dexterity?.mod ?? 0;
      const d20 = Math.floor(Math.random() * 20) + 1;
      const checkValue = Math.round((d20 / 100) * dexMod + dexMod);
      const passed = checkValue >= rollTotal;

      if (!passed) {
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: targetActor }),
          ...whisper,
          content: `<p><strong>${targetActor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Zone.slipped')} (${checkValue} vs ${rollTotal})</p>`,
        });
        const proneData = {
          name: 'Prone',
          img: 'icons/svg/falling.svg',
          origin: flags.casterActorUuid,
          duration: { rounds: 1, startRound: game.combat?.round ?? 0, startTurn: game.combat?.turn ?? 0 },
          disabled: false,
          changes: [],
          type: 'base',
          system: { debuffDamage: 0, debuffType: 'immobilized', casterActorUuid: flags.casterActorUuid },
        };
        await AspectsofPowerItem.executeGmAction({
          type: 'gmApplyDebuff',
          targetActorUuid: targetActor.uuid,
          effectName: proneData.name,
          originUuid: flags.casterActorUuid,
          effectData: proneData,
          duration: 1,
          stackable: false,
          speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        });
      } else {
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: targetActor }),
          ...whisper,
          content: `<p><strong>${targetActor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Zone.keptFooting')} (${checkValue} vs ${rollTotal})</p>`,
        });
      }
    }
    // Future: difficult terrain handling here.
  }
}

/**
 * When a token moves, check zone effects (every movement) and persistent AOE tags (once per round).
 */
Hooks.on('updateToken', async (tokenDoc, changes, _options, _userId) => {
  if (!isActingGM()) return;
  if (!('x' in changes) && !('y' in changes)) return;
  await _checkZoneEffects(tokenDoc);
  await _triggerPersistentAoe(tokenDoc, false);
});

/**
 * Aura entry trigger — when a token moves, fire aura effects for any
 * (source, target) pair that transitioned from outside-aura to inside-aura.
 * In-memory geometry, no document writes per check. Per design-movement-skills.md.
 */
Hooks.on('preUpdateToken', (tokenDoc, changes, options, userId) =>
  onPreUpdateTokenForAuras(tokenDoc, changes, options, userId)
);

/**
 * At the start of each combatant's turn, re-trigger any persistent AOE
 * they're currently standing in. This clears their "affected this round"
 * flag first (so they can be re-hit) and forces the trigger.
 */
Hooks.on('combatTurnChange', async (combat, _prior, current) => {
  if (!isActingGM()) return;

  const combatant = combat.combatants.get(current.combatantId);
  if (!combatant?.token) return;
  const tokenDoc = combatant.token;

  // Re-trigger persistent AOEs on the token at turn start.
  // The round-based tracking in affectedTokens prevents same-round double-dipping.
  // force=true bypasses the affected check so turn-start always evaluates.
  await _triggerPersistentAoe(tokenDoc, true);
});

/* -------------------------------------------- */
/*  Apply Damage Button — GM Whisper            */
/* -------------------------------------------- */

/**
 * Bind the "Apply damage" button that appears in GM-whispered combat result messages.
 * Reduces the target actor's health and posts a public notification.
 */
Hooks.on('renderChatMessageHTML', (message, html) => {
  html.querySelectorAll('.apply-damage').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!game.user.isGM) return;

      const actorUuid  = btn.dataset.actorUuid;
      let   incomingDmg = parseInt(btn.dataset.damage, 10);
      const drValue = parseInt(btn.dataset.toughness, 10) || 0;
      const affinityDR   = parseInt(btn.dataset.affinityDr, 10) || 0;
      const damageType = btn.dataset.damageType || 'physical';
      const target     = await fromUuid(actorUuid);
      if (!target || isNaN(incomingDmg)) return;

      const isPhysical = damageType === 'physical';
      // Armor-answer routing (2026-07-16 ruling): VEIL defends mind/soul only;
      // physical AND elemental face the armor layer. The resolver stamps the
      // lane on data-mitigation ('armor'|'veil'); prefer it so the applied HP
      // mitigation matches the chat display. Fall back to the legacy
      // damageType split for buttons that don't set it (raw/redirect helpers).
      // NOTE: `isPhysical` still keys the separate Phys/Mag DR-resist layer
      // below (that's about damage TYPE, not the armor/veil lane).
      const mitigLane = btn.dataset.mitigation
        || (isPhysical ? 'armor' : 'veil');
      const mitigation = mitigLane === 'armor'
        ? (target.system.defense.armor?.value ?? 0) + (target.system.defense.blockDR ?? 0)
        : (target.system.defense.veil?.value ?? 0);

      // --- Damage routing: Mark bonus → Affinity DR → Barrier → Armor/Veil → DR → Overhealth → HP ---
      const updateData = {};
      const parts = [];
      let barrierAbsorbed = false;

      // ── Step -1: Marked subsystem ──
      // If the target carries any "marked" effects whose `markedByActorUuid`
      // matches THIS attacker, sum the bonus multipliers and amplify the
      // raw incoming damage. Per-attacker summing — different markers each
      // keep their own bonus. Effects with `markedExpiresOnHit: true` are
      // deleted after the bonus fires (Feint-style one-shot).
      const attackerActorUuid = btn.dataset.attackerActorUuid || '';
      if (attackerActorUuid) {
        const myMarks = target.effects.filter(e =>
          !e.disabled
          && (e.system?.markedDamageBonus ?? 0) > 0
          && e.system?.markedByActorUuid === attackerActorUuid
        );
        const totalBonus = myMarks.reduce((s, e) => s + (Number(e.system?.markedDamageBonus) || 0), 0);
        if (totalBonus > 0) {
          const before = incomingDmg;
          incomingDmg = Math.round(incomingDmg * (1 + totalBonus));
          parts.push(`Marked: +${Math.round(totalBonus * 100)}% (${before} → ${incomingDmg})`);
          // Delete expires-on-hit marks AFTER applying the bonus.
          const oneShots = myMarks.filter(e => e.system?.markedExpiresOnHit === true);
          if (oneShots.length > 0) {
            await target.deleteEmbeddedDocuments('ActiveEffect', oneShots.map(e => e.id));
          }
        }
      }

      // 0. Per-affinity DR pre-step. The attack chat carried a breakdown
      // attribute describing the augment-routed damage slices that make up
      // part of `incomingDmg`. Each slice is reduced by the target's
      // per-affinity DR (system.damageReduction.affinities[<name>]). The
      // sum of reductions subtracts from incomingDmg before the rest of
      // the pipeline. Base + untyped damage is not in the breakdown — it
      // flows through the existing armor/DR/barrier path unchanged.
      let affinityBreakdown = {};
      try {
        affinityBreakdown = btn.dataset.damageBreakdown ? JSON.parse(btn.dataset.damageBreakdown) : {};
      } catch (_) { affinityBreakdown = {}; }
      const affinityDRMap = target.system.damageReduction?.affinities ?? {};
      let affinityResistTotal = 0;
      const affinityResistParts = [];
      for (const [aff, sliceVal] of Object.entries(affinityBreakdown)) {
        const sliceNum = Number(sliceVal) || 0;
        if (sliceNum <= 0) continue;
        const resist = Number(affinityDRMap[aff]) || 0;
        if (resist <= 0) continue;
        const reduced = Math.min(resist, sliceNum);
        affinityResistTotal += reduced;
        affinityResistParts.push(`${aff}: −${reduced}`);
      }
      if (affinityResistTotal > 0) {
        incomingDmg = Math.max(0, incomingDmg - affinityResistTotal);
        parts.push(`Affinity resist (${affinityResistParts.join(', ')})`);
      }

      // 0b. Affinity-based debuff cleanse. Each affinity slice in the
      // incoming damage that matches a debuff's cleanse-affinity strips
      // ONE stack of that debuff. Hardcoded mapping for now (chilled ←
      // fire); promote to CONFIG once we have more pairings.
      const cleanseByAffinity = { fire: ['chilled'] };
      const cleansedReports = [];
      for (const [aff, sliceVal] of Object.entries(affinityBreakdown)) {
        if ((Number(sliceVal) || 0) <= 0) continue;
        const cleansableDebuffTypes = cleanseByAffinity[aff];
        if (!cleansableDebuffTypes) continue;
        for (const dType of cleansableDebuffTypes) {
          const candidate = target.effects.find(e =>
            !e.disabled && e.system?.debuffType === dType
          );
          if (candidate) {
            await candidate.delete();
            cleansedReports.push(`${aff} stripped 1 ${dType} stack`);
          }
        }
      }
      if (cleansedReports.length) parts.push(cleansedReports.join('; '));

      let remaining = incomingDmg;

      // 1. Barrier absorbs first (if present). No toughness/DR on this portion.
      const barrier = target.system.barrier;
      const barrierEffect = target.effects.find(e =>
        !e.disabled && e.system?.effectType === 'barrier'
      );
      if (barrier?.value > 0 && barrierEffect) {
        const absorbed = Math.min(barrier.value, remaining);
        const newBarrierVal = barrier.value - absorbed;
        remaining -= absorbed;
        barrierAbsorbed = true;

        if (newBarrierVal === 0) {
          // Barrier broken. Reforming shells (Mana Shell) re-form to full by
          // re-paying the original investment from the caster — the
          // remainder of the BREAKING hit still passes through (shell broke
          // mid-hit; the fresh shell faces the NEXT attack). If the caster
          // can't pay, the shell dies and tears down its sustain marker.
          const bd = barrierEffect.system?.barrierData ?? {};
          let reformed = false;
          if (bd.reform && bd.casterActorUuid) {
            const payer = await fromUuid(bd.casterActorUuid);
            const res = bd.reformResource ?? 'mana';
            const cost = Math.max(0, Math.round(bd.reformCost ?? 0));
            const avail = payer?.system?.[res]?.value ?? 0;
            if (payer && cost > 0 && avail >= cost) {
              await payer.update({ [`system.${res}.value`]: avail - cost });
              await barrierEffect.update({ 'system.barrierData.value': bd.max ?? cost });
              reformed = true;
              parts.push(`Barrier: −${absorbed} (shattered — reforms, −${cost} ${res})`);
            }
          }
          if (!reformed) {
            await barrierEffect.delete();
            // Reform failure: drop the linked sustain marker on the caster
            // so the dead shell doesn't linger as a phantom upkeep.
            if (bd.reform && bd.sourceSkillId && bd.casterActorUuid) {
              const payer = await fromUuid(bd.casterActorUuid);
              const sustain = payer?.effects?.find(e =>
                e.system?.effectType === 'sustain' && e.system?.itemSource === bd.sourceSkillId);
              if (sustain) await sustain.delete();
            }
            parts.push(`Barrier: −${absorbed} ${bd.reform ? '(shattered — too drained to reform)' : '(broken)'}`);
          }
        } else {
          // Update the effect's barrier data.
          await barrierEffect.update({
            'system.barrierData.value': newBarrierVal,
          });
          parts.push(`Barrier: −${absorbed}`);
        }
      }

      // 2. Armor/Veil reduces whatever got through the barrier.
      if (remaining > 0 && mitigation > 0) {
        const mitigated = Math.min(mitigation, remaining);
        remaining = Math.max(0, remaining - mitigation);
        parts.push(`${mitigLane === 'armor' ? 'Armor' : 'Veil'}: −${mitigated}`);
      }

      // 3. DR (with affinity reduction) reduces whatever got through armor.
      if (remaining > 0) {
        const effectiveDR = Math.max(0, drValue - affinityDR);
        const drReduced = Math.min(effectiveDR, remaining);
        remaining = Math.max(0, remaining - effectiveDR);
        if (drReduced > 0) parts.push(`DR: −${drReduced}`);
      }

      // 3b. Augment-sourced flat damage reduction (Inscribe Physical/Magical
      // Resist). Subtracts a flat amount based on damage type. Designed to
      // be modest — per user note "no % reductions, way too powerful."
      if (remaining > 0) {
        const drKey = isPhysical ? 'physical' : 'magical';
        const augDR = target.system.damageReduction?.[drKey] ?? 0;
        if (augDR > 0) {
          const augReduced = Math.min(augDR, remaining);
          remaining = Math.max(0, remaining - augDR);
          parts.push(`${isPhysical ? 'Phys' : 'Mag'} Resist: −${augReduced}`);
        }
      }

      // 3. Overhealth absorbs next.
      const overhealth = target.system.overhealth;
      if (remaining > 0 && overhealth?.value > 0) {
        const ohAbsorbed = Math.min(overhealth.value, remaining);
        remaining -= ohAbsorbed;
        updateData['system.overhealth.value'] = overhealth.value - ohAbsorbed;
        parts.push(`Overhealth: −${ohAbsorbed}`);
      }

      // 4. Remaining hits HP.
      const health = target.system.health;
      const newHealth = Math.max(0, health.value - remaining);
      updateData['system.health.value'] = newHealth;
      if (remaining > 0) parts.push(`Health: −${remaining}`);

      await target.update(updateData);

      // Sleep breaks on taking damage.
      if (remaining > 0) {
        const sleepEffect = getActiveDebuff(target, 'sleep');
        if (sleepEffect) {
          await sleepEffect.delete();
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: target }),
            content: `<p><strong>${target.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.wokeUp')} (took damage)</p>`,
          });
        }
      }

      // Degrade durability only on damage that passed through barriers.
      if (!barrierAbsorbed || remaining > 0) {
        const effectiveDR = Math.max(0, drValue - affinityDR);
        const postBarrierDmg = barrierAbsorbed ? Math.max(0, incomingDmg - (barrier?.value ?? 0)) : incomingDmg;
        const totalDurabilityDmg = Math.max(0, postBarrierDmg - mitigation - effectiveDR);
        if (totalDurabilityDmg > 0) await EquipmentSystem.degradeDurability(target, totalDurabilityDmg, damageType);
      }

      const breakdown = parts.length ? ` (${parts.join(', ')})` : '';
      const actualHpLoss = health.value - newHealth;
      const barrierRemaining = barrierAbsorbed ? Math.max(0, barrier.value - Math.min(barrier.value, incomingDmg)) : 0;
      const barrierLine = barrierAbsorbed
        ? `<br>Barrier: ${barrierRemaining} / ${barrier.max} remaining`
        : '';
      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${target.name}</strong> takes <strong>${actualHpLoss}</strong> health damage.${breakdown ? `<br>${breakdown}` : ''}`
               + `<br>Health: ${newHealth} / ${health.max}${barrierLine}`
               + `${newHealth === 0 ? '<br><em>Incapacitated!</em>' : ''}</p>`,
      });

      // ── Forced movement ──
      const forcedDir  = btn.dataset.forcedDir;
      const forcedDist = parseInt(btn.dataset.forcedDist, 10);
      if (forcedDir && forcedDist > 0) {
        await _applyForcedMovement(target, btn.dataset.attackerTokenId, forcedDir, forcedDist, parseInt(btn.dataset.hitTotal, 10) || 0);
      }

      // ── Lifesteal → overhealth ──
      // Any attacker passive skill carrying `flags.aspectsofpower.lifestealPct`
      // (0..1) credits that fraction of HP damage dealt to the attacker's
      // overhealth pool. Capped by overhealth.cap (200% max HP, enforced in
      // actor.mjs prepareDerivedData). George's "Sanguine Tithe" is the first
      // user; flag-based so any other actor can pick it up without schema
      // changes. Sums across multiple lifesteal skills if present.
      if (actualHpLoss > 0) {
        const attackerTokenIdForLifesteal = btn.dataset.attackerTokenId;
        const attackerForLifesteal = attackerTokenIdForLifesteal
          ? canvas.tokens?.get(attackerTokenIdForLifesteal)?.actor
          : null;
        if (attackerForLifesteal?.system?.overhealth) {
          let totalPct = 0;
          for (const item of attackerForLifesteal.items) {
            if (item.type !== 'skill') continue;
            const pct = Number(item.flags?.aspectsofpower?.lifestealPct ?? 0);
            if (pct > 0) totalPct += pct;
          }
          if (totalPct > 0) {
            const oh = attackerForLifesteal.system.overhealth;
            const gain = Math.round(actualHpLoss * totalPct);
            const newOh = Math.min(oh.cap ?? Number.POSITIVE_INFINITY, (oh.value ?? 0) + gain);
            const actualGain = newOh - (oh.value ?? 0);
            if (actualGain > 0) {
              await attackerForLifesteal.update({ 'system.overhealth.value': newOh });
              ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: attackerForLifesteal }),
                content: `<p><em>${attackerForLifesteal.name}</em> siphons <strong>+${actualGain}</strong> overhealth `
                       + `(${Math.round(totalPct * 100)}% of ${actualHpLoss}). `
                       + `Overhealth: ${newOh}${oh.cap ? ` / ${oh.cap}` : ''}</p>`,
              });
            }
          }
        }
      }

      // ── Post-resolve passive reactions (Phase C) ──
      // self_struck: HP damage actually dealt. hp_threshold: HP fraction
      // crossed below the per-skill threshold. Both fire AFTER the HP
      // update commits. Reaches the attacker via the button's data attr.
      const attackerTokenId = btn.dataset.attackerTokenId;
      const attackerToken = attackerTokenId ? canvas.tokens?.get(attackerTokenId) : null;
      // Stashed on the apply-damage button at item.mjs button-construction —
      // gates reactionAttackType-filtered passives (Thunder Puppet melee-only).
      // Default 'any' if missing so older damage messages still process normally.
      const attackerType = btn.dataset.attackerAttackType || 'any';
      const matchesAttackType = (s) => {
        const filter = s.system.tagConfig?.reactionAttackType ?? 'any';
        return filter === 'any' || filter === attackerType;
      };
      if (attackerToken) {
        // Note: `self_struck` reactions moved to _handleAttackTag post-defense
        // (item.mjs) — semantic is "defense pool failed," not "HP went down,"
        // so it fires when the hit lands regardless of armor reduction.
        // This handler now only fires `hp_threshold` (which needs the HP
        // transition delta to detect threshold crossings).
        // hp_threshold: per-skill crossing check (oldFrac >= T, newFrac < T).
        const maxHp = health.max || 1;
        const oldFrac = health.value / maxHp;
        const newFrac = newHealth / maxHp;
        const hpThreshPassives = target.items.filter(s =>
          s.type === 'skill' &&
          s.system.skillType === 'Passive' &&
          (s.system.tags ?? []).includes('retaliation') &&
          (s.system.tagConfig?.reactionTrigger ?? '') === 'hp_threshold' &&
          matchesAttackType(s)
        );
        for (const skill of hpThreshPassives) {
          const threshold = skill.system.tagConfig?.reactionThresholdPct ?? 0;
          if (threshold > 0 && oldFrac >= threshold && newFrac < threshold) {
            try {
              await skill.roll({ executeDeferred: true, preTargetIds: [attackerToken.id] });
              ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: target }),
                content: `<p><em>${target.name}'s <strong>${skill.name}</strong> triggers (HP crossed below ${Math.round(threshold * 100)}%)!</em></p>`,
              });
            } catch (err) { console.warn('[reactions] hp_threshold failed:', skill.name, err); }
          }
        }
      }

      // Disable the button so it can't be double-applied.
      btn.disabled = true;
      btn.textContent = 'Applied';
    });
  });
});

/* -------------------------------------------- */
/*  Forced Movement                             */
/* -------------------------------------------- */

/**
 * Apply forced movement (push/pull) to a target after damage.
 * The target rolls 1d20 + strength mod vs the attacker's hit total.
 * If the target's roll >= hitTotal, they resist completely.
 * Otherwise, they are moved the full configured distance.
 *
 * @param {Actor} targetActor      The target being pushed/pulled.
 * @param {string} attackerTokenId The attacker's token ID (for direction).
 * @param {string} dir             'push' or 'pull'.
 * @param {number} distFt          Distance in feet.
 * @param {number} hitTotal        The attacker's hit roll total.
 */
async function _applyForcedMovement(targetActor, attackerTokenId, dir, distFt, hitTotal) {
  const targetToken = targetActor.getActiveTokens()[0];
  if (!targetToken) return;

  const scene = targetToken.document.parent;
  const attackerTokenDoc = attackerTokenId ? scene?.tokens?.get(attackerTokenId) : null;
  if (!attackerTokenDoc) return;

  // Strength contest: target rolls 1d20 + strength mod vs hit total.
  const strMod = targetActor.system.abilities?.strength?.mod ?? 0;
  const strRoll = new Roll('(1d20 / 100) * @str + @str', { str: strMod });
  await strRoll.evaluate();
  await strRoll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    flavor: `${game.i18n.localize('ASPECTSOFPOWER.ForcedMovement.label')} — Strength Contest (vs ${hitTotal})`,
  });

  if (strRoll.total >= hitTotal) {
    // Resisted!
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content: `<p><strong>${targetActor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.ForcedMovement.resisted')} (${strRoll.total} vs ${hitTotal})</p>`,
    });
    return;
  }

  // Calculate direction vector.
  const ax = attackerTokenDoc.x;
  const ay = attackerTokenDoc.y;
  const tx = targetToken.document.x;
  const ty = targetToken.document.y;

  let dx = tx - ax;
  let dy = ty - ay;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return; // tokens stacked, no direction

  // Normalize.
  dx /= mag;
  dy /= mag;

  // Push = away from attacker (same direction), Pull = toward attacker (reverse).
  if (dir === 'pull') {
    dx = -dx;
    dy = -dy;
  }

  // Convert feet to pixels.
  const pixelsPerFoot = canvas.grid.size / canvas.grid.distance;
  const movePx = distFt * pixelsPerFoot;

  // Calculate new position and snap to grid.
  const rawX = tx + dx * movePx;
  const rawY = ty + dy * movePx;
  const snapped = canvas.grid.getSnappedPoint({ x: rawX, y: rawY }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });

  // Move the token (GM-side, bypasses preUpdateToken movement checks via GM exemption).
  await targetToken.document.update({ x: snapped.x, y: snapped.y });

  const dirLabel = dir === 'push'
    ? game.i18n.localize('ASPECTSOFPOWER.ForcedMovement.pushed')
    : game.i18n.localize('ASPECTSOFPOWER.ForcedMovement.pulled');
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `<p><strong>${targetActor.name}</strong> ${dirLabel} ${distFt} ft! (${strRoll.total} vs ${hitTotal})</p>`,
  });
}

/* -------------------------------------------- */
/*  Wounded Token Image Swap                    */
/* -------------------------------------------- */

/**
 * Swap token image when an actor's HP crosses the wounded threshold.
 * Only the GM executes to avoid duplicate updates.
 * Stores the original image in a flag so it can be restored when healed.
 */
Hooks.on('updateActor', async (actor, changes, _options, userId) => {
  // Multi-GM dedup: only the ACTIVE GM (one designated client) handles
  // these effects. Plain `game.user.isGM` lets every connected GM client
  // run the hook in parallel, which double-fired death blooms in the
  // 2026-05-10 combat log (Claude + Gamemaster accounts both connected).
  if (game.users.activeGM !== game.user) return;
  if (game.userId !== userId && !changes.system?.health) return;

  // Only react to health value changes.
  const healthChange = changes.system?.health;
  if (healthChange?.value === undefined) return;

  // Actor death — clear active sustains, then auto-fire on_death-tagged passives.
  // Hook fires on the HP-zero crossing; if HP later climbs above 0 and crosses
  // again, this fires again (each death is its own event).
  if (actor.system.health.value <= 0) {
    const deathSustains = actor.effects.filter(e =>
      !e.disabled && e.system?.effectType === 'sustain'
    );
    if (deathSustains.length > 0) {
      await actor.deleteEmbeddedDocuments('ActiveEffect', deathSustains.map(e => e.id));
      ChatMessage.create({
        content: `<p><strong>${actor.name}</strong>'s sustained skills end — ${deathSustains.map(e => e.name).join(', ')}.</p>`,
      });
    }

    // on_death-tagged passive AOE skills auto-fire ONCE from a single
    // representative token. For unlinked actors (one per token) this is
    // the dying token. For linked actors with multiple tokens sharing
    // HP, only one burst — firing from every token of a shared actor
    // would produce N death blooms for one death.
    const deathSkills = actor.items.filter(i =>
      i.type === 'skill' && (i.system?.tags ?? []).includes('on_death')
    );
    if (deathSkills.length > 0) {
      const tok = actor.getActiveTokens()?.[0];
      if (tok) {
        for (const skill of deathSkills) {
          try {
            await skill._fireOnDeath(tok);
          } catch (e) {
            console.error(`[on_death] auto-fire failed for ${actor.name} / ${skill.name}:`, e);
          }
        }
      }
    }

    // Unqueue any pending celerity action — a corpse can't act. Posts a
    // chat note so other players see why the next-up indicator changed.
    for (const combat of game.combats) {
      const cm = combat.combatants.find(c => c.actorId === actor.id);
      const declared = cm?.flags?.aspectsofpower?.declaredAction
        ?? cm?.flags?.aspectsofpower?.declaredMovement;
      if (!declared) continue;
      await cm.update({
        'flags.aspectsofpower.declaredAction': null,
        'flags.aspectsofpower.declaredMovement': null,
        'flags.aspectsofpower.nextActionTick': null,
      });
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${actor.name}'s queued <strong>${declared.label}</strong> is cancelled — incapacitated.</em></p>`,
      });
    }

    // Auto-death for hostiles (pending-combat-ai-backlog): hostile NPCs at
    // 0 HP are marked defeated + skulled without GM action. Player-owned
    // actors are exempt — downed PCs stay a GM/narrative call.
    if ((CONFIG.ASPECTSOFPOWER.ai?.autoDefeatHostiles ?? true) && !actor.hasPlayerOwner) {
      // getActiveTokens(linked, document): linked=true returns ONLY tokens
      // linked to the actor — empty for unlinked-token NPCs (i.e. nearly every
      // hostile), so auto-defeat never fired for them (2026-07-15 test: a dead
      // Saurian stayed un-defeated while its on_death AOE still fired via the
      // no-arg getActiveTokens above). Use all active tokens as documents.
      const isHostile = actor.getActiveTokens(false, true)
        .some(d => d.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE);
      if (isHostile) {
        for (const combat of game.combats) {
          const cm = combat.combatants.find(c => c.actorId === actor.id);
          if (cm && !cm.defeated) await cm.update({ defeated: true });
        }
        try {
          const deadId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
          if (!actor.statuses?.has(deadId)) {
            await actor.toggleStatusEffect(deadId, { active: true, overlay: true });
          }
        } catch (e) {
          console.warn('[auto-death] could not apply dead overlay:', e);
        }
      }
    }
  }

  const threshold = game.settings.get('aspects-of-power', 'woundedTokenThreshold');
  if (threshold <= 0) return;

  const health = actor.system.health;
  const hpPct = (health.value / health.max) * 100;
  const isWounded = hpPct <= threshold && health.value > 0;
  const woundedImg = actor.system.tokenImageWounded;

  for (const token of actor.getActiveTokens()) {
    const doc = token.document;
    const originalImg = doc.getFlag('aspects-of-power', 'originalTokenImg');
    const hadTint = doc.getFlag('aspects-of-power', 'woundedTint');

    if (isWounded) {
      if (woundedImg) {
        // Swap to wounded image — save original first.
        if (!originalImg) {
          await doc.setFlag('aspects-of-power', 'originalTokenImg', doc.texture.src);
        }
        if (doc.texture.src !== woundedImg) {
          await doc.update({ 'texture.src': woundedImg });
        }
      } else if (!hadTint) {
        // No wounded image set — apply red tint fallback.
        await doc.setFlag('aspects-of-power', 'woundedTint', true);
        await doc.update({ 'texture.tint': '#ff4444' });
      }
    } else {
      // Healed above threshold — restore everything.
      if (originalImg) {
        if (doc.texture.src !== originalImg) {
          await doc.update({ 'texture.src': originalImg });
        }
        await doc.unsetFlag('aspects-of-power', 'originalTokenImg');
      }
      if (hadTint) {
        await doc.update({ 'texture.tint': '#ffffff' });
        await doc.unsetFlag('aspects-of-power', 'woundedTint');
      }
    }
  }
});

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createItemMacro(data, slot) {
  // First, determine if this is a valid owned item.
  if (data.type !== 'Item') return;
  if (!data.uuid.includes('Actor.') && !data.uuid.includes('Token.')) {
    return ui.notifications.warn(
      'You can only create macro buttons for owned Items'
    );
  }
  // Retrieve the item by UUID.
  const item = await fromUuid(data.uuid);
  if (!item) return;

  // Create the macro command using the uuid.
  const command = `game.aspectsofpower.rollItemMacro("${data.uuid}");`;
  let macro = game.macros.find(
    (m) => m.name === item.name && m.command === command
  );
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: 'script',
      img: item.img,
      command: command,
      flags: { 'aspects-of-power.itemMacro': true },
    });
  }
  game.user.assignHotbarMacro(macro, slot);
  return false;
}

/**
 * Roll an Item macro from a hotbar slot.
 * @param {string} itemUuid
 */
async function rollItemMacro(itemUuid) {
  const item = await fromUuid(itemUuid);
  if (!item || !item.parent) {
    const itemName = item?.name ?? itemUuid;
    return ui.notifications.warn(
      `Could not find item ${itemName}. You may need to delete and recreate this macro.`
    );
  }
  item.roll();
}
