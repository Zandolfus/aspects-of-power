// Import document classes.
import { AspectsofPowerActor } from './documents/actor.mjs';
import { AspectsofPowerItem } from './documents/item.mjs';
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
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { ASPECTSOFPOWER } from './helpers/config.mjs';
import { getPositionalTags } from './helpers/positioning.mjs';
// Import systems.
import { EquipmentSystem } from './systems/equipment.mjs';

/**
 * Check if an actor is an assigned player character (not just owned).
 */
function _isPlayerCharacter(actor) {
  return game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
}

/* -------------------------------------------- */
/*  Movement Distance Tracker (per combat turn) */
/* -------------------------------------------- */

/**
 * Tracks cumulative movement distance (in feet) per combatant for the
 * current movement segment.  A "segment" is the window between two skill
 * uses (or between turn-start and the first skill use).  The segment
 * distance is capped at sprintRange.
 *
 * Key: combatant ID, Value: feet moved in the current segment.
 * Reset when a skill is used (bumping the action counter) or when a new
 * turn starts.
 */
const _segmentMovement = new Map();

/**
 * Tracks how many skill actions a combatant has used this turn (max 3).
 * Movement itself does NOT consume an action — only skill rolls do.
 */
const _moveActionTracker = new Map();

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
    !e.disabled && typeArr.includes(e.flags?.['aspects-of-power']?.debuffType)
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
    !e.disabled && typeArr.includes(e.flags?.['aspects-of-power']?.debuffType)
  );
}

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once('init', function () {
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.aspectsofpower = {
    AspectsofPowerActor,
    AspectsofPowerItem,
    rollItemMacro,
    getPositionalTags,
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
      const used = (_moveActionTracker.get(combatant.id) ?? 0) + 1;
      _moveActionTracker.set(combatant.id, used);
      _segmentMovement.set(combatant.id, 0); // reset segment for next move
      return used;
    },
  };

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

  // Initialize the equipment system hooks.
  EquipmentSystem.initialize();

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

Hooks.once('ready', function () {
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
        buttons.push({ action: `reaction:${rs.id}`, label: rs.name, icon: 'fas fa-bolt' });
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
    } else if (['gmApplyBuff', 'gmApplyDebuff', 'gmApplyRestoration', 'gmApplyCleanse', 'gmUpdateDefensePool', 'gmConsumeReaction'].includes(payload.type)) {
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
/*  Stamina Regeneration — Start of Turn        */
/* -------------------------------------------- */

/**
 * Regenerate stamina at the start of each combatant's turn.
 * The regen rate is stored on the actor as system.staminaRegen (percentage of max).
 * Only the GM executes the update to avoid duplicate writes.
 */
Hooks.on('combatTurnChange', async (combat, _prior, current) => {
  if (!game.user.isGM) return;

  const combatant = combat.combatants.get(current.combatantId);
  if (!combatant?.actor) return;

  const actor   = combatant.actor;
  const stamina = actor.system.stamina;
  const regenPct = actor.system.staminaRegen ?? 5;
  const regenAmt = Math.floor(stamina.max * (regenPct / 100));

  // Already at max — nothing to do.
  if (stamina.value >= stamina.max) return;

  const newValue = Math.min(stamina.max, stamina.value + regenAmt);
  await actor.update({ 'system.stamina.value': newValue });

  const staminaWhisper = _isPlayerCharacter(actor) ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    ...staminaWhisper,
    content: `<p><em>${actor.name} regenerates ${newValue - stamina.value} stamina (${regenPct}% of ${stamina.max}).</em></p>`,
  });
});

/* -------------------------------------------- */
/*  Defense Pool Reset — Combatant's Turn        */
/* -------------------------------------------- */

/**
 * Reset defense pools and reactions at the start of each combatant's turn.
 * Only the GM executes the update to avoid duplicate writes.
 */
Hooks.on('combatTurnChange', async (combat, _prior, current) => {
  if (!game.user.isGM) return;

  const combatant = combat.combatants.get(current.combatantId);
  if (!combatant?.actor) return;

  const actor = combatant.actor;
  const updateData = {};
  const speaker = ChatMessage.getSpeaker({ actor });
  const defPoolWhisper = _isPlayerCharacter(actor) ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };

  // Check for active sleep effects that modify mind defense restoration.
  const sleepEffects = getActiveDebuffs(actor, 'sleep');
  // Sum of all active sleep debuff rolls that reduce mind defense restoration.
  const sleepDrain = sleepEffects.reduce((sum, e) =>
    sum + (e.flags?.['aspects-of-power']?.debuffDamage ?? 0), 0);

  for (const defKey of ['melee', 'ranged', 'mind', 'soul']) {
    const poolMax = actor.system.defense[defKey]?.poolMax ?? 0;
    let targetPool = poolMax;

    // Sleep reduces mind defense restoration.
    if (defKey === 'mind' && sleepDrain > 0) {
      const currentPool = actor.system.defense.mind?.pool ?? 0;
      const normalRestoration = poolMax - currentPool;
      const reducedRestoration = Math.max(0, normalRestoration - sleepDrain);
      targetPool = currentPool + reducedRestoration;

      // Check if sleep activates (mind pool stays at 0).
      if (targetPool <= 0) {
        targetPool = 0;
        // Flag sleep as "active" (target is now asleep).
        for (const se of sleepEffects) {
          if (!se.flags?.['aspects-of-power']?.sleepActive) {
            await se.setFlag('aspects-of-power', 'sleepActive', true);
            ChatMessage.create({
              speaker, ...defPoolWhisper,
              content: `<p><strong>${actor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.fellAsleep')}</p>`,
            });
          }
        }
      } else {
        // Mind defense recovered past sleep threshold — wake up.
        for (const se of sleepEffects) {
          if (se.flags?.['aspects-of-power']?.sleepActive && targetPool >= (se.flags['aspects-of-power'].debuffDamage ?? 0)) {
            await se.delete();
            ChatMessage.create({
              speaker, ...defPoolWhisper,
              content: `<p><strong>${actor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.wokeUp')}</p>`,
            });
          }
        }
      }
    }

    if ((actor.system.defense[defKey]?.pool ?? 0) !== targetPool) {
      updateData[`system.defense.${defKey}.pool`] = targetPool;
    }
  }
  // Reset reactions to max.
  const reactions = actor.system.reactions;
  if (reactions && reactions.value !== reactions.max) {
    updateData['system.reactions.value'] = reactions.max;
  }
  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }
});

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
/*  Debuff Enforcement — Turn Start             */
/* -------------------------------------------- */

/**
 * At the start of a combatant's turn, enforce turn-skipping debuffs (stun, paralysis,
 * sleep, immobilized) and process auto-roll break checks for applicable debuffs.
 *
 * Break mechanics by debuff type:
 *   root       → Strength roll vs debuff roll total
 *   stun       → Does not break (expires by duration)
 *   paralysis  → Vitality roll vs debuff roll total
 *   fear       → Willpower roll vs debuff roll total (flee is GM-enforced)
 *   taunt      → Intelligence roll vs debuff roll total
 *   charm      → Willpower roll vs debuff roll total
 *   enraged    → Wisdom roll vs debuff roll total
 *   sleep      → Handled separately (mind defense recovery system)
 */
const DEBUFF_BREAK_STAT = {
  root:      'strength',
  paralysis: 'vitality',
  fear:      'willpower',
  taunt:     'intelligence',
  charm:     'willpower',
  enraged:   'wisdom',
};

const TURN_SKIP_DEBUFFS = ['stun', 'paralysis', 'sleep', 'immobilized'];

Hooks.on('combatTurnChange', async (combat, _prior, current) => {
  if (!game.user.isGM) return;

  const combatant = combat.combatants.get(current.combatantId);
  if (!combatant?.actor) return;
  const actor = combatant.actor;
  const speaker = ChatMessage.getSpeaker({ actor });
  const gmWhisper = _isPlayerCharacter(actor) ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };

  // Collect all active debuffs with a type.
  const typedDebuffs = actor.effects.filter(e =>
    !e.disabled && e.flags?.['aspects-of-power']?.debuffType
    && e.flags['aspects-of-power'].debuffType !== 'none'
  );

  for (const effect of typedDebuffs) {
    const flags      = effect.flags['aspects-of-power'];
    const debuffType = flags.debuffType;
    const rollTotal  = flags.debuffDamage ?? 0;
    const typeName   = game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffType] ?? debuffType);

    // Check if this debuff has a break stat.
    const breakStat = DEBUFF_BREAK_STAT[debuffType];
    if (breakStat) {
      const statMod = actor.system.abilities?.[breakStat]?.mod ?? 0;
      const breakRoll = new Roll('1d20 + @mod', { mod: statMod });
      await breakRoll.evaluate();
      const breakLabel = game.i18n.localize(`ASPECTSOFPOWER.Ability.${breakStat}.long`);

      // Accumulate break progress across turns.
      const previousProgress = flags.breakProgress ?? 0;
      const newProgress = previousProgress + breakRoll.total;

      if (newProgress >= rollTotal) {
        // Broke free!
        // Remove Foundry blind status if breaking free of blind.
        if (debuffType === 'blind') {
          const tokens = actor.getActiveTokens();
          for (const t of tokens) {
            if (t.document.hasStatusEffect('blind')) {
              await t.document.toggleActiveEffect({ id: 'blind', name: 'Blind', icon: 'icons/svg/blind.svg' }, { active: false });
            }
          }
        }
        await effect.delete();
        await breakRoll.toMessage({
          speaker, ...gmWhisper,
          flavor: `${typeName} — ${game.i18n.localize('ASPECTSOFPOWER.Debuff.breakRoll')} (${breakLabel}) [${newProgress} / ${rollTotal}]`,
        });
        ChatMessage.create({
          speaker, ...gmWhisper,
          content: `<p><strong>${actor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.broke')} <strong>${typeName}</strong>!</p>`,
        });
        continue; // Effect removed, skip turn-skip check.
      } else {
        // Save cumulative progress on the effect.
        await effect.setFlag('aspects-of-power', 'breakProgress', newProgress);
        await breakRoll.toMessage({
          speaker, ...gmWhisper,
          flavor: `${typeName} — ${game.i18n.localize('ASPECTSOFPOWER.Debuff.breakRoll')} (${breakLabel}) [${newProgress} / ${rollTotal}]`,
        });
        ChatMessage.create({
          speaker, ...gmWhisper,
          content: `<p><strong>${actor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.failedBreak')} <strong>${typeName}</strong>.</p>`,
        });
      }
    }

    // Announce turn-skipping debuffs.
    if (TURN_SKIP_DEBUFFS.includes(debuffType)) {
      ChatMessage.create({
        speaker, ...gmWhisper,
        content: `<p><strong>${actor.name}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotAct')} (${typeName})</p>`,
      });
    }
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

  const combatant = combat.combatants.get(current.combatantId);
  if (!combatant?.actor) return;
  const applierUuid = combatant.actor.uuid;

  // Check every combatant for DoT effects placed by the current actor.
  for (const c of combat.combatants) {
    if (!c.actor) continue;
    for (const effect of c.actor.effects) {
      const flags = effect.flags?.['aspects-of-power'] ?? {};
      if (!flags.dot || flags.applierActorUuid !== applierUuid || effect.disabled) continue;

      const rawDamage = flags.dotDamage ?? 0;
      if (rawDamage <= 0) continue;

      const toughnessMod = c.actor.system.abilities?.toughness?.mod ?? 0;
      const damage  = Math.max(0, rawDamage - toughnessMod);
      const health  = c.actor.system.health;
      const newHealth = Math.max(0, health.value - damage);
      await c.actor.update({ 'system.health.value': newHealth });

      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${c.actor.name}</strong> takes <strong>${damage}</strong> `
               + `${flags.dotDamageType ?? 'physical'} damage from ${effect.name} (Toughness: −${toughnessMod}). `
               + `Health: ${newHealth} / ${health.max}`
               + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
      });
    }
  }
});

/* -------------------------------------------- */
/*  Effect Expiry — Duration Tracking           */
/* -------------------------------------------- */

/**
 * Delete ActiveEffects whose duration (in rounds) has elapsed.
 * Effects expire at the end of the TARGET's turn — so we only check
 * the combatant whose turn just ended (the "prior" combatant).
 * Only the GM executes to avoid duplicate deletes.
 */
Hooks.on('combatTurnChange', async (combat, prior, _current) => {
  if (!game.user.isGM) return;
  if (!prior?.combatantId) return;

  const combatant = combat.combatants.get(prior.combatantId);
  if (!combatant?.actor) return;

  const actor = combatant.actor;
  const toDelete = [];
  for (const effect of actor.effects) {
    const dur = effect.duration;
    if (!dur.rounds || dur.rounds <= 0) continue;
    const startRound = dur.startRound ?? 0;
    if (startRound > 0 && combat.round - startRound >= dur.rounds) {
      toDelete.push(effect.id);
    }
  }
  if (toDelete.length > 0) {
    // Remove Foundry blind status if a blind debuff is expiring.
    for (const id of toDelete) {
      const effect = actor.effects.get(id);
      if (effect?.flags?.['aspects-of-power']?.debuffType === 'blind') {
        const tokens = actor.getActiveTokens();
        for (const t of tokens) {
          if (t.document.hasStatusEffect('blind')) {
            await t.document.toggleActiveEffect({ id: 'blind', name: 'Blind', icon: 'icons/svg/blind.svg' }, { active: false });
          }
        }
      }
    }
    const names = toDelete.map(id => actor.effects.get(id)?.name).filter(Boolean);
    await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: `<p>Expired effects on <strong>${actor.name}</strong>: ${names.join(', ')}</p>`,
    });
  }
});

/* -------------------------------------------- */
/*  AOE Template Expiry — Duration Tracking     */
/* -------------------------------------------- */

/**
 * Delete AOE MeasuredTemplates whose duration (in rounds) has elapsed.
 * Only the GM executes to avoid duplicate deletes.
 */
Hooks.on('combatTurnChange', async (combat, prior, _current) => {
  if (!game.user.isGM) return;

  const toDelete = [];
  for (const templateDoc of canvas.scene.templates) {
    const flags = templateDoc.flags?.['aspects-of-power'] ?? {};
    if (!flags.aoe) continue;

    const duration = flags.templateDuration ?? 0;
    if (duration <= 0) continue;

    const placedRound = flags.placedRound ?? 0;
    if (placedRound > 0 && combat.round - placedRound >= duration) {
      toDelete.push(templateDoc.id);
    }
  }

  if (toDelete.length > 0) {
    await canvas.scene.deleteEmbeddedDocuments('MeasuredTemplate', toDelete);
    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: `<p>Expired ${toDelete.length} AOE template(s).</p>`,
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
 * Clear cumulative movement distance when a new turn starts.
 * Runs on every client so the preUpdateToken guard works locally.
 */
Hooks.on('combatTurnChange', () => {
  _segmentMovement.clear();
  _moveActionTracker.clear();
});

/**
 * Clean up the movement tracker when combat ends.
 */
Hooks.on('deleteCombat', () => {
  _segmentMovement.clear();
  _moveActionTracker.clear();
});

/* -------------------------------------------- */
/*  Stamina-based Movement Cost & Limits        */
/* -------------------------------------------- */

/**
 * Intercept token movement to enforce stamina costs and maximum range.
 *
 * Movement is cumulative within a "segment" — the window between skill
 * uses.  Players can move freely (via arrow keys, drags, etc.) until
 * they hit the per-segment cap (sprintRange).  Using a skill starts a
 * new segment by bumping the action counter and resetting segment
 * distance.  Max 3 actions per turn.
 *
 * Per segment:
 *   Walk zone:   1 stamina per 5 ft, up to walkRange ft cumulative
 *   Sprint zone: 3 stamina per 5 ft, from walkRange to sprintRange ft
 *   Beyond sprintRange: movement blocked until a new segment starts.
 *
 * Only applies during active combat. GM moves are exempt.
 */
Hooks.on('preUpdateToken', (tokenDoc, changes, options, userId) => {
  // Only process position changes.
  if (!('x' in changes) && !('y' in changes)) return;

  // Only the user who initiated the move should evaluate this.
  if (game.user.id !== userId) return;

  // Exempt: no active combat.
  const combat = game.combat;
  if (!combat?.started) return;

  // Exempt: the mover is a GM.
  if (game.user.isGM) return;

  // Identify the combatant for this token.
  const combatant = combat.combatants.find(
    c => c.tokenId === tokenDoc.id && c.sceneId === tokenDoc.parent?.id
  );
  if (!combatant) return;

  const actor = tokenDoc.actor;
  if (!actor?.system) return;

  // Block movement for root, immobilized, frozen, sleep, stun, paralysis debuffs.
  const moveBlocker = getActiveDebuff(actor, ['root', 'immobilized', 'frozen', 'sleep', 'stun', 'paralysis']);
  if (moveBlocker) {
    const typeName = game.i18n.localize(
      CONFIG.ASPECTSOFPOWER.debuffTypes[moveBlocker.flags['aspects-of-power'].debuffType] ?? 'Debuff'
    );
    ui.notifications.warn(`${actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotMove')} (${typeName})`);
    return false;
  }

  let walkRange = actor.system.walkRange;
  if (!walkRange || walkRange <= 0) return;

  let sprintRange = actor.system.sprintRange;
  const stamina     = actor.system.stamina;

  // Chilled: reduce movement speed by comparing endurance to debuff roll.
  const chilledEffect = getActiveDebuff(actor, 'chilled');
  if (chilledEffect) {
    const debuffRoll   = chilledEffect.flags?.['aspects-of-power']?.debuffDamage ?? 0;
    const enduranceMod = actor.system.abilities?.endurance?.mod ?? 0;
    const reduction    = Math.max(0, debuffRoll - enduranceMod);
    walkRange   = Math.max(0, walkRange - reduction);
    sprintRange = Math.max(0, sprintRange - reduction);
    if (walkRange <= 0 && sprintRange <= 0) {
      ui.notifications.warn(`${actor.name} is frozen solid! (Chilled overcame Endurance)`);
      return false;
    }
  }

  // Check if the combatant has exhausted all 3 actions (no more movement allowed).
  const actionsUsed = _moveActionTracker.get(combatant.id) ?? 0;
  if (actionsUsed >= 3) {
    ui.notifications.warn('No movement remaining this turn! (3/3 actions used)');
    return false;
  }

  // Calculate the distance of this move in feet.
  const oldX = tokenDoc.x;
  const oldY = tokenDoc.y;
  const newX = changes.x ?? oldX;
  const newY = changes.y ?? oldY;

  const dx = newX - oldX;
  const dy = newY - oldY;
  const distancePx   = Math.sqrt(dx * dx + dy * dy);
  const pixelsPerFoot = canvas.grid.size / canvas.grid.distance;
  const moveFeet     = distancePx / pixelsPerFoot;

  // Snap to 5ft increments.
  const moveSnapped = Math.round(moveFeet / 5) * 5;
  if (moveSnapped <= 0) return;

  // Cumulative segment distance check — can't exceed sprintRange in one segment.
  const segmentSoFar = _segmentMovement.get(combatant.id) ?? 0;
  const newSegmentTotal = segmentSoFar + moveSnapped;
  if (newSegmentTotal > sprintRange) {
    const remaining = Math.max(0, sprintRange - segmentSoFar);
    ui.notifications.warn(`Movement cap reached! (${remaining} ft remaining this segment, ${Math.round(sprintRange)} ft max)`);
    return false;
  }

  // Calculate stamina cost based on cumulative position in walk/sprint zones.
  // Each 5ft step is walk (1 stamina) or sprint (3 stamina) based on cumulative distance.
  let staminaCost = 0;
  for (let ft = segmentSoFar + 5; ft <= newSegmentTotal; ft += 5) {
    staminaCost += (ft <= walkRange) ? 1 : 3;
  }

  // Check sufficient stamina.
  if (staminaCost > stamina.value) {
    ui.notifications.warn('Insufficient stamina to move!');
    return false;
  }

  // Update segment tracker synchronously, deduct stamina asynchronously.
  _segmentMovement.set(combatant.id, newSegmentTotal);

  const newStamina = stamina.value - staminaCost;
  const moveWhisper = _isPlayerCharacter(actor) ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
  Promise.resolve().then(async () => {
    await actor.update({ 'system.stamina.value': newStamina });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      ...moveWhisper,
      content: `<p><em>${actor.name} moves ${moveSnapped} ft (${newSegmentTotal}/${Math.round(sprintRange)} ft this segment). `
             + `Stamina: −${staminaCost} (${newStamina}/${stamina.max})</em></p>`,
    });
  });
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
      const preToughnessDmg = parseInt(btn.dataset.damage, 10);
      const toughnessMod = parseInt(btn.dataset.toughness, 10) || 0;
      const affinityDR   = parseInt(btn.dataset.affinityDr, 10) || 0;
      const damageType = btn.dataset.damageType || 'physical';
      const target     = await fromUuid(actorUuid);
      if (!target || isNaN(preToughnessDmg)) return;

      // --- Damage routing: Barrier → Toughness → Overhealth → HP ---
      // Toughness and affinity DR only apply to damage that passes through barriers.
      let remaining = preToughnessDmg;
      const updateData = {};
      const parts = [];
      let barrierAbsorbed = false;

      // 1. Barrier absorbs first (if present). No toughness/DR on this portion.
      const barrier = target.system.barrier;
      const barrierEffect = target.effects.find(e =>
        !e.disabled && e.flags?.aspectsofpower?.effectType === 'barrier'
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
            'flags.aspectsofpower.barrierData.value': newBarrierVal,
          });
        }
        parts.push(`Barrier: −${absorbed}${newBarrierVal === 0 ? ' (broken)' : ''}`);
      }

      // 2. Toughness (with affinity DR) reduces whatever got through the barrier.
      if (remaining > 0) {
        const effectiveToughness = Math.max(0, toughnessMod - affinityDR);
        const toughnessReduced = Math.min(effectiveToughness, remaining);
        remaining = Math.max(0, remaining - effectiveToughness);
        if (toughnessReduced > 0) parts.push(`Toughness: −${toughnessReduced}`);
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

      // Degrade durability on equipped items that provide the relevant defense.
      const effectiveTough = Math.max(0, toughnessMod - affinityDR);
      const totalDamage = Math.max(0, preToughnessDmg - effectiveTough);
      await EquipmentSystem.degradeDurability(target, totalDamage, damageType);

      const breakdown = parts.length ? ` (${parts.join(', ')})` : '';
      const actualHpLoss = health.value - newHealth;
      const newBarrierValue = barrierAbsorbed ? Math.max(0, barrier.value - Math.min(barrier.value, preToughnessDmg)) : 0;
      const barrierLine = barrierAbsorbed
        ? `<br>Barrier: ${newBarrierValue} / ${barrier.max} remaining`
        : '';
      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${target.name}</strong> takes <strong>${preToughnessDmg}</strong> incoming damage${breakdown}.`
               + `<br>HP damage: ${actualHpLoss} &nbsp;|&nbsp; Health: ${newHealth} / ${health.max}${barrierLine}`
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
  const strRoll = new Roll('1d20 + @str', { str: strMod });
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
