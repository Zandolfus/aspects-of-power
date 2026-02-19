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
  Actors.unregisterSheet('core', ActorSheet);
  Actors.registerSheet('aspects-of-power', AspectsofPowerActorSheet, {
    makeDefault: true,
    label: 'ASPECTSOFPOWER.SheetLabels.Actor',
  });
  Items.unregisterSheet('core', ItemSheet);
  Items.registerSheet('aspects-of-power', AspectsofPowerItemSheet, {
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
