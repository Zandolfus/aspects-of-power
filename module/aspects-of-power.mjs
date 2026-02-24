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
// Import systems.
import { EquipmentSystem } from './systems/equipment.mjs';

/* -------------------------------------------- */
/*  Movement Distance Tracker (per combat turn) */
/* -------------------------------------------- */

/**
 * Tracks cumulative movement distance (in feet) per combatant per turn.
 * Key: combatant ID, Value: total feet moved this turn.
 * Reset at the start of each combatant's turn via combatTurnChange.
 */
const _movementTracker = new Map();

/**
 * Tracks how many movement actions a combatant has used this turn (max 3).
 * Each token drag counts as one movement action.
 */
const _moveActionTracker = new Map();

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
    if (game.users.activeGM !== game.user) return;

    if (payload.type === 'gmCombatResult') {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: payload.content,
      });
    } else if (['gmApplyBuff', 'gmApplyDebuff', 'gmApplyRestoration'].includes(payload.type)) {
      await AspectsofPowerItem.executeGmAction(payload);
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

      const damage    = flags.dotDamage ?? 0;
      if (damage <= 0) continue;

      const health    = c.actor.system.health;
      const newHealth = Math.max(0, health.value - damage);
      await c.actor.update({ 'system.health.value': newHealth });

      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<p><strong>${c.actor.name}</strong> takes <strong>${damage}</strong> `
               + `${flags.dotDamageType ?? 'physical'} damage from ${effect.name} (ignores mitigation). `
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
  _movementTracker.clear();
  _moveActionTracker.clear();
});

/**
 * Clean up the movement tracker when combat ends.
 */
Hooks.on('deleteCombat', () => {
  _movementTracker.clear();
  _moveActionTracker.clear();
});

/* -------------------------------------------- */
/*  Stamina-based Movement Cost & Limits        */
/* -------------------------------------------- */

/**
 * Intercept token movement to enforce stamina costs, maximum range, and
 * a 3-action-per-turn movement limit.
 *
 * Each token drag counts as one movement action (max 3 per turn).
 * Per action:
 *   Walk zone:   1 stamina per 5 ft, up to walkRange ft
 *   Sprint zone: 3 stamina per 5 ft, from walkRange to sprintRange ft
 *   Beyond sprintRange: movement blocked.
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

  const walkRange = actor.system.walkRange;
  if (!walkRange || walkRange <= 0) return;

  const sprintRange = actor.system.sprintRange;
  const stamina     = actor.system.stamina;

  // Check movement actions remaining (max 3 per turn).
  const actionsUsed = _moveActionTracker.get(combatant.id) ?? 0;
  if (actionsUsed >= 3) {
    ui.notifications.warn('No movement actions remaining this turn! (3/3 used)');
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

  // Per-action distance cap (single move can't exceed sprintRange).
  if (moveSnapped > sprintRange) {
    ui.notifications.warn(`Maximum movement distance exceeded! (${Math.round(sprintRange)} ft max per action)`);
    return false;
  }

  // Calculate stamina cost for this action's distance.
  // Walk zone: 0 → walkRange at 1 stamina/5ft.
  // Sprint zone: walkRange → sprintRange at 3 stamina/5ft.
  let staminaCost = 0;
  for (let ft = 5; ft <= moveSnapped; ft += 5) {
    staminaCost += (ft <= walkRange) ? 1 : 3;
  }

  // Check sufficient stamina.
  if (staminaCost > stamina.value) {
    ui.notifications.warn('Insufficient stamina to move!');
    return false;
  }

  // Update trackers synchronously, deduct stamina asynchronously.
  const actionNum = actionsUsed + 1;
  _moveActionTracker.set(combatant.id, actionNum);

  const prevDistance  = _movementTracker.get(combatant.id) ?? 0;
  _movementTracker.set(combatant.id, prevDistance + moveSnapped);

  const newStamina = stamina.value - staminaCost;
  Promise.resolve().then(async () => {
    await actor.update({ 'system.stamina.value': newStamina });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><em>${actor.name} spends ${staminaCost} stamina on movement `
             + `(${moveSnapped} ft, action ${actionNum}/3). `
             + `Stamina: ${newStamina}/${stamina.max}</em></p>`,
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
