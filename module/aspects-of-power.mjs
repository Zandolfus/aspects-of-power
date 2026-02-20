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
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { ASPECTSOFPOWER } from './helpers/config.mjs';

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
    item:    ItemItemData,
    feature: FeatureData,
    skill:   SkillData,
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

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once('ready', function () {
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on('hotbarDrop', (bar, data, slot) => createItemMacro(data, slot));

  // Socket listener: only the active GM creates combat-result messages so that
  // the originating player is never the message author and can never see them.
  game.socket.on('system.aspects-of-power', async (payload) => {
    if (game.users.activeGM !== game.user) return;
    if (payload.type === 'gmCombatResult') {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: payload.content,
      });
    }
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

  // Chat message for troubleshooting — remove or whisper once stable.
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>${actor.name} regenerates ${newValue - stamina.value} stamina (${regenPct}% of ${stamina.max}).</em></p>`,
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

      const actorUuid = btn.dataset.actorUuid;
      const damage    = parseInt(btn.dataset.damage, 10);
      const target    = await fromUuid(actorUuid);
      if (!target || isNaN(damage)) return;

      const health    = target.system.health;
      const newHealth = Math.max(0, health.value - damage);
      await target.update({ 'system.health.value': newHealth });

      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${target.name}</strong> takes <strong>${damage}</strong> damage. `
               + `Health: ${newHealth} / ${health.max}${newHealth === 0 ? ' — <em>Incapacitated!</em>' : ''}</p>`,
      });

      // Disable the button so it can't be double-applied.
      btn.disabled = true;
      btn.textContent = 'Applied';
    });
  });
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
  // If it is, retrieve it based on the uuid.
  const item = await Item.fromDropData(data);

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
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemUuid
 */
function rollItemMacro(itemUuid) {
  // Reconstruct the drop data so that we can load the item.
  const dropData = {
    type: 'Item',
    uuid: itemUuid,
  };
  // Load the item from the uuid.
  Item.fromDropData(dropData).then((item) => {
    // Determine if the item loaded and if it's an owned item.
    if (!item || !item.parent) {
      const itemName = item?.name ?? itemUuid;
      return ui.notifications.warn(
        `Could not find item ${itemName}. You may need to delete and recreate this macro.`
      );
    }

    // Trigger the item roll
    item.roll();
  });
}
