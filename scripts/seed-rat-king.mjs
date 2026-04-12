/**
 * Rat King Monster Seed Script
 * Creates a Rat King at race level 70 (Rank E).
 * High physical stats, low intelligence/wisdom. Melee-focused swarm lord.
 *
 * Usage (Foundry console):
 *   const mod = await import('/systems/aspects-of-power/scripts/seed-rat-king.mjs');
 *   await mod.seed();                        // creates in root
 *   await mod.seed('Encounters/Sewers');      // into a specific folder
 */

import { createMonster } from './create-monster.mjs';

/* ------------------------------------------------------------------ */
/*  Monster Definition                                                */
/* ------------------------------------------------------------------ */

const RAT_KING = {
  actor: {
    name: 'Rat King',
    race: 'monster',
    raceLevel: 70,
    type: 'character',
    stats: {
      vitality: 900, endurance: 200, strength: 900, dexterity: 600,
      toughness: 700, intelligence: 20, willpower: 200, wisdom: 20, perception: 400,
    },
  },
  items: [
    // ── Skills ──
    {
      name: 'Gnashing Swarm',
      type: 'skill',
      system: {
        description: '<p>The Rat King surges forward as a writhing mass of teeth and claws, tearing into the target from every direction.</p>',
        skillType: 'Active',
        skillCategory: 'combat',
        requiresSight: true,
        magicType: 'non-magical',
        tags: ['attack'],
        roll: {
          dice: 'd12', abilities: 'strength', resource: 'stamina',
          cost: 25, diceBonus: 0.7, targetDefense: 'melee', damageType: 'physical',
          type: 'str_weapon',
        },
      },
    },
    {
      name: 'Tail Lash',
      type: 'skill',
      system: {
        description: '<p>A tangle of knotted tails whips outward, striking the target and sending them stumbling backward.</p>',
        skillType: 'Active',
        skillCategory: 'combat',
        requiresSight: true,
        magicType: 'non-magical',
        tags: ['attack'],
        roll: {
          dice: 'd10', abilities: 'dexterity', resource: 'stamina',
          cost: 20, diceBonus: 0.5, targetDefense: 'melee', damageType: 'physical',
          type: 'dex_weapon',
        },
        tagConfig: {
          forcedMovement: true,
          forcedMovementDir: 'push',
          forcedMovementDist: 10,
        },
      },
    },
    {
      name: 'Plague Bite',
      type: 'skill',
      system: {
        description: '<p>Diseased fangs sink deep, injecting filth that weakens the target\'s body over time.</p>',
        skillType: 'Active',
        skillCategory: 'combat',
        requiresSight: true,
        magicType: 'non-magical',
        tags: ['attack', 'debuff'],
        roll: {
          dice: 'd8', abilities: 'strength', resource: 'stamina',
          cost: 30, diceBonus: 0.5, targetDefense: 'melee', damageType: 'physical',
          type: 'str_weapon',
        },
        tagConfig: {
          debuffType: 'weaken',
          debuffDuration: 3,
          debuffEntries: [
            { attribute: 'abilities.strength', value: 0.4 },
            { attribute: 'abilities.endurance', value: 0.4 },
          ],
          dot: true,
          dotDamageType: 'physical',
        },
      },
    },

    // ── Equipment ──
    {
      name: 'Matted Fur Hide',
      type: 'item',
      system: {
        description: '<p>Layers of matted, filth-caked fur hardened into a natural armor. Reeks of the sewers.</p>',
        slot: 'chest', rarity: 'uncommon', equipped: true,
        material: 'leather', weight: 12,
        durability: { value: 200, max: 200 },
        armorBonus: 40, veilBonus: 0,
        statBonuses: [
          { ability: 'toughness', value: 30 },
          { ability: 'vitality', value: 20 },
        ],
      },
    },
    {
      name: 'Crown of Knotted Tails',
      type: 'item',
      system: {
        description: '<p>The tangled mass of tails binding the swarm together — the source of the Rat King\'s hive coordination.</p>',
        slot: 'head', rarity: 'uncommon', equipped: true,
        material: 'leather', weight: 3,
        durability: { value: 150, max: 150 },
        armorBonus: 10, veilBonus: 0,
        statBonuses: [
          { ability: 'perception', value: 25 },
          { ability: 'willpower', value: 15 },
        ],
      },
    },
    {
      name: 'Gnawing Fangs',
      type: 'item',
      system: {
        description: '<p>Hundreds of razor-sharp teeth across dozens of maws, constantly growing and resharpening.</p>',
        slot: 'weaponry', rarity: 'uncommon', equipped: true,
        material: 'bone', weight: 2,
        durability: { value: 180, max: 180 },
        armorBonus: 0, veilBonus: 0,
        statBonuses: [
          { ability: 'strength', value: 35 },
          { ability: 'dexterity', value: 15 },
        ],
      },
    },
    {
      name: 'Calloused Paws',
      type: 'item',
      system: {
        description: '<p>Thick-padded feet toughened from years in stone tunnels. Surprisingly quick.</p>',
        slot: 'boots', rarity: 'common', equipped: true,
        material: 'leather', weight: 2,
        durability: { value: 120, max: 120 },
        armorBonus: 5, veilBonus: 0,
        statBonuses: [{ ability: 'dexterity', value: 20 }],
      },
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function _createWithItems(def, folder) {
  const actorOpts = { ...def.actor, type: 'character' };
  if (folder) actorOpts.folder = folder;
  const actor = await createMonster(actorOpts);
  if (!actor) return null;

  if (def.items?.length) {
    await actor.createEmbeddedDocuments('Item', def.items);
  }
  return actor;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export async function seed(folderPath) {
  const actor = await _createWithItems(RAT_KING, folderPath);
  if (actor) ui.notifications.info(`Created Rat King.`);
  return actor;
}
