// Import document classes.
import { AspectsofPowerActor } from './documents/actor.mjs';
import { AspectsofPowerItem } from './documents/item.mjs';
import { AspectsofPowerToken } from './documents/token.mjs';
import { AspectsofPowerTokenObject } from './canvas/token.mjs';
import { AspectsofPowerTokenRuler } from './canvas/token-ruler.mjs';
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
import { getPositionalTags } from './helpers/positioning.mjs';
// Import systems.
import { EquipmentSystem } from './systems/equipment.mjs';
import * as MassLeveler from './systems/mass-leveler.mjs';
import * as TemplateMigration from './systems/template-migration.mjs';
import * as Celerity from './systems/celerity.mjs';
import { CelerityTracker, openTracker as openCelerityTracker, refreshTracker as refreshCelerityTracker, registerCelerityTrackerHooks } from './apps/celerity-tracker.mjs';
import { CelerityCombatTracker } from './apps/celerity-combat-tracker.mjs';

/**
 * Check if an actor is an assigned player character (not just owned).
 */
function _isPlayerCharacter(actor) {
  return game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
}

/* -------------------------------------------- */
/*  Movement Distance Tracker (per combat turn) */
/* -------------------------------------------- */

// Movement trackers are now on AspectsofPowerToken (module/documents/token.mjs).

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

/**
 * Get all active debuffs of the given type(s) on an actor.
 * @param {Actor} actor
 * @param {string|string[]} types
 * @returns {ActiveEffect[]}
 */
function getActiveDebuffs(actor, types) {
  if (!actor?.effects) return [];
  const typeArr = Array.isArray(types) ? types : [types];
  return actor.effects.filter(e =>
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

  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.aspectsofpower = {
    AspectsofPowerActor,
    AspectsofPowerItem,
    rollItemMacro,
    getPositionalTags,
    massLeveler: MassLeveler,
    templateMigration: TemplateMigration,
    celerity: { ...Celerity, openTracker: openCelerityTracker, refreshTracker: refreshCelerityTracker, CelerityTracker },
    /**
     * Called when a skill is used to consume an action and reset the movement
     * segment for the given actor.  Returns the new action count, or null
     * if no combat / combatant found.
     * @param {Actor} actor
     * @returns {number|null}
     */
    consumeAction(actor) {
      const combat = game.combat;
      if (!combat?.started) return null;
      const token = actor.getActiveTokens()[0];
      if (!token) return null;
      const combatant = combat.combatants.find(
        c => c.tokenId === token.id && c.sceneId === token.document.parent?.id
      );
      if (!combatant) return null;
      return AspectsofPowerToken.consumeAction(combatant.id);
    },
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

  // ── Auto-sync cached tags when a template item's systemTags change ──
  Hooks.on('updateItem', (item, changes, _options, _userId) => {
    if (!game.user.isGM) return;
    if (!changes.system?.systemTags) return;
    if (!['race', 'class', 'profession'].includes(item.type)) return;

    const newTags = item.system.systemTags ?? [];
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

Handlebars.registerHelper('includes', function (array, value) {
  return Array.isArray(array) && array.includes(value);
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
  registerCelerityTrackerHooks();

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
      return;
    }
    item.roll({ executeDeferred: true, preInvestAmount: data.preInvestAmount ?? null });
  });

  // ── One-time migrations ──
  if (game.user.isGM) {
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
    // --- Player-side: defense prompt ---
    if (payload.type === 'defensePrompt' && payload.targetUserId === game.userId) {
      const buttons = [];
      if (payload.hasPool) {
        buttons.push({ action: 'defend', label: 'Defend', icon: 'fas fa-shield-alt', default: true });
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
    } else if (['gmApplyBuff', 'gmApplyDebuff', 'gmApplyRestoration', 'gmApplyRepair', 'gmApplyCleanse', 'gmUpdateDefensePool', 'gmConsumeReaction', 'gmExecuteTrade'].includes(payload.type)) {
      await AspectsofPowerItem.executeGmAction(payload);
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
  if (!game.user.isGM) return;
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
  if (!game.user.isGM) return;
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
  if (!game.user.isGM) return;
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
               + `${flags.dotDamageType ?? 'physical'} damage from ${effect.name} (DR: −${drValue}). `
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
  if (!game.user.isGM) return;
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
});

/* -------------------------------------------- */
/*  AOE Template Expiry — Duration Tracking     */
/* -------------------------------------------- */

/**
 * Delete AOE Regions whose duration (in rounds) has elapsed.
 * Only the GM executes to avoid duplicate deletes.
 */
Hooks.on('combatTurnChange', async (combat, prior, _current) => {
  if (!game.user.isGM) return;
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

  // Guard: only draw for tokens the current user owns.
  if (!token.document.isOwner) return;

  // Guard: check the toggle flag.
  const showRange = token.document.getFlag('aspects-of-power', 'showRange');
  if (!showRange) return;

  // Guard: need a valid actor with a derived castingRange.
  const actor = token.document.actor;
  if (!actor?.system?.castingRange) return;

  // Convert world-unit range (feet) to canvas pixels.
  const rangeInFeet  = actor.system.castingRange;
  const pixelsPerFoot = canvas.grid.size / canvas.grid.distance;
  const radiusPx     = rangeInFeet * pixelsPerFoot;

  // Center the circle on the token's visual center.
  const centerX = (token.document.width * canvas.grid.size) / 2;
  const centerY = (token.document.height * canvas.grid.size) / 2;

  const gfx = new PIXI.Graphics();

  // PIXI v7 (beginFill/drawCircle) vs v8 (circle/fill) — detect which API is available.
  if (typeof gfx.drawCircle === 'function') {
    // PIXI v7 style
    gfx.beginFill(0x4488ff, 0.1);
    gfx.lineStyle(2, 0x4488ff, 0.5);
    gfx.drawCircle(centerX, centerY, radiusPx);
    gfx.endFill();
  } else {
    // PIXI v8 style
    gfx.circle(centerX, centerY, radiusPx);
    gfx.fill({ color: 0x4488ff, alpha: 0.1 });
    gfx.stroke({ color: 0x4488ff, alpha: 0.5, width: 2 });
  }

  // Add on top of the token's children so the circle is visible.
  token.addChild(gfx);
  token._castingRangeAura = gfx;
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

  const isActive = tokenDoc.getFlag('aspects-of-power', 'showRange') ? 'active' : '';
  const button = document.createElement('div');
  button.classList.add('control-icon');
  if (isActive) button.classList.add('active');
  button.setAttribute('data-action', 'toggle-casting-range');
  button.setAttribute('title', 'Toggle Casting Range');
  button.innerHTML = '<i class="fas fa-bullseye"></i>';

  button.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const current = tokenDoc.getFlag('aspects-of-power', 'showRange');
    await tokenDoc.setFlag('aspects-of-power', 'showRange', !current);
    button.classList.toggle('active');
  });

  // Append to the right-side column of the HUD.
  const rightCol = html.querySelector('.col.right') ?? html.querySelector('.right');
  if (rightCol) rightCol.appendChild(button);
});

/* -------------------------------------------- */
/*  Movement Tracker Reset — Start of Turn      */
/* -------------------------------------------- */

/**
 * Clear movement trackers on turn change and combat end.
 */
Hooks.on('combatTurnChange', () => AspectsofPowerToken.clearTrackers());
Hooks.on('deleteCombat', () => AspectsofPowerToken.clearTrackers());

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

    // Check if already affected this round. affectedTokens is now {tokenId: round}.
    const affectedMap = pd.affectedTokens ?? {};
    const lastAffectedRound = affectedMap[tokenDoc.id] ?? -1;
    const currentRound = game.combat?.round ?? 0;
    if (lastAffectedRound >= currentRound) continue;

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

    // Mark as affected this round.
    const updatedMap = { ...(pd.affectedTokens ?? {}), [tokenDoc.id]: currentRound };
    await doc.update({ 'flags.aspects-of-power.persistentData.affectedTokens': updatedMap });

    // Apply effects.
    const casterActor = await fromUuid(flags.casterActorUuid);
    const targetActor = tokenDoc.actor;
    if (!casterActor || !targetActor) continue;

    const speaker = ChatMessage.getSpeaker({ actor: casterActor });
    const rollTotal = pd.rollTotal ?? 0;

    for (const tag of (pd.tags ?? [])) {
      if (tag === 'debuff' && pd.tagConfig?.debuffType && pd.tagConfig.debuffType !== 'none') {
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

      if (tag === 'attack' && rollTotal > 0) {
        ChatMessage.create({
          whisper: ChatMessage.getWhisperRecipients('GM'),
          content: `<p><strong>${targetActor.name}</strong> in AOE zone — `
                 + `<strong>${rollTotal}</strong> ${pd.damageType} damage incoming.</p>`
                 + `<button class="apply-damage" data-actor-uuid="${targetActor.uuid}" `
                 + `data-damage="${rollTotal}" data-toughness="${targetActor.system.defense?.dr?.value ?? 0}" `
                 + `data-damage-type="${pd.damageType}" data-affinity-dr="0">Apply Damage</button>`,
        });
      }

      if (tag === 'buff' && (pd.tagConfig?.buffEntries ?? []).length > 0) {
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
    }

    triggered = true;
  }

  return triggered;
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
  if (!game.user.isGM) return;
  if (!('x' in changes) && !('y' in changes)) return;
  await _checkZoneEffects(tokenDoc);
  await _triggerPersistentAoe(tokenDoc, false);
});

/**
 * At the start of each combatant's turn, re-trigger any persistent AOE
 * they're currently standing in. This clears their "affected this round"
 * flag first (so they can be re-hit) and forces the trigger.
 */
Hooks.on('combatTurnChange', async (combat, _prior, current) => {
  if (!game.user.isGM) return;

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
      const incomingDmg = parseInt(btn.dataset.damage, 10);
      const drValue = parseInt(btn.dataset.toughness, 10) || 0;
      const affinityDR   = parseInt(btn.dataset.affinityDr, 10) || 0;
      const damageType = btn.dataset.damageType || 'physical';
      const target     = await fromUuid(actorUuid);
      if (!target || isNaN(incomingDmg)) return;

      const isPhysical = damageType === 'physical';
      const mitigation = isPhysical
        ? (target.system.defense.armor?.value ?? 0)
        : (target.system.defense.veil?.value ?? 0);

      // --- Damage routing: Barrier → Armor/Veil → Toughness → Overhealth → HP ---
      let remaining = incomingDmg;
      const updateData = {};
      const parts = [];
      let barrierAbsorbed = false;

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
          // Barrier broken — delete the effect.
          await barrierEffect.delete();
        } else {
          // Update the effect's barrier data.
          await barrierEffect.update({
            'system.barrierData.value': newBarrierVal,
          });
        }
        parts.push(`Barrier: −${absorbed}${newBarrierVal === 0 ? ' (broken)' : ''}`);
      }

      // 2. Armor/Veil reduces whatever got through the barrier.
      if (remaining > 0 && mitigation > 0) {
        const mitigated = Math.min(mitigation, remaining);
        remaining = Math.max(0, remaining - mitigation);
        parts.push(`${isPhysical ? 'Armor' : 'Veil'}: −${mitigated}`);
      }

      // 3. DR (with affinity reduction) reduces whatever got through armor.
      if (remaining > 0) {
        const effectiveDR = Math.max(0, drValue - affinityDR);
        const drReduced = Math.min(effectiveDR, remaining);
        remaining = Math.max(0, remaining - effectiveDR);
        if (drReduced > 0) parts.push(`DR: −${drReduced}`);
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
  if (!game.user.isGM) return;
  if (game.userId !== userId && !changes.system?.health) return;

  // Only react to health value changes.
  const healthChange = changes.system?.health;
  if (healthChange?.value === undefined) return;

  // Actor death — clear all active sustains.
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
