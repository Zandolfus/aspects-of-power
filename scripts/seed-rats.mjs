/**
 * Rat Pack Monster Seed Script
 * Creates 4 rat-themed monsters at race level 60 (Rank E).
 *
 * Usage (Foundry console):
 *   const mod = await import('/systems/aspects-of-power/scripts/seed-rats.mjs');
 *   await mod.seedAll();                        // creates all 4
 *   await mod.seedAll('Encounters/Rats');        // into a specific folder
 *   await mod.seedOne('Rat Knight');             // create one by name
 */

import { createMonster } from './create-monster.mjs';

/* ------------------------------------------------------------------ */
/*  Monster Definitions                                               */
/* ------------------------------------------------------------------ */
// Race level 60: total stat budget = 3321 (3276 free + 45 base)

const MONSTERS = [

  /* ── 1. Rat Knight (melee tank) ─────────────────────────────── */
  {
    actor: {
      name: 'Rat Knight',
      race: 'monster',
      raceLevel: 60,
      type: 'character',
      stats: {
        vitality: 700, endurance: 350, strength: 650, dexterity: 400,
        toughness: 600, intelligence: 20, willpower: 200, wisdom: 51, perception: 350,
      }, // sum: 3321
    },
    items: [
      {
        name: 'Rusted Lance Thrust',
        type: 'skill',
        system: {
          description: '<p>The rat knight levels its corroded lance and charges forward with disciplined fury.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd12', abilities: 'strength', resource: 'stamina',
            cost: 25, diceBonus: 0.6, targetDefense: 'melee', damageType: 'physical',
            type: 'str_weapon',
          },
        },
      },
      {
        name: 'Shield Bash',
        type: 'skill',
        system: {
          description: '<p>A brutal slam with a dented iron buckler, sending the target stumbling.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'strength', resource: 'stamina',
            cost: 20, diceBonus: 0.5, targetDefense: 'melee', damageType: 'physical',
            type: 'str_weapon',
          },
          tagConfig: {
            forcedMovement: true,
            forcedMovementDir: 'push',
            forcedMovementDist: 10,
          },
        },
      },
      {
        name: 'Rally Cry',
        type: 'skill',
        system: {
          description: '<p>The knight screeches a commanding war cry, hardening the resolve of nearby allies.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          vocalComponent: true,
          magicType: 'non-magical',
          tags: ['buff'],
          roll: {
            dice: 'd6', abilities: 'willpower', resource: 'stamina',
            cost: 15, diceBonus: 0.4, targetDefense: '', damageType: 'physical',
          },
          tagConfig: {
            buffEntries: [{ attribute: 'defense.armor', value: 0.5 }],
            buffDuration: 3,
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Scrapplate Cuirass',
        type: 'item',
        system: {
          description: '<p>Hammered together from stolen armor fragments. Surprisingly sturdy.</p>',
          slot: 'chest', rarity: 'uncommon', equipped: true,
          material: 'metal', weight: 10,
          durability: { value: 180, max: 180 },
          armorBonus: 35, veilBonus: 0,
          statBonuses: [{ ability: 'toughness', value: 25 }],
        },
      },
      {
        name: 'Rusted Knight\'s Lance',
        type: 'item',
        system: {
          description: '<p>A human lance, re-fitted for smaller paws. The rust adds character — and tetanus.</p>',
          slot: 'weaponry', rarity: 'uncommon', equipped: true,
          material: 'metal', weight: 6,
          durability: { value: 150, max: 150 },
          armorBonus: 0, veilBonus: 0,
          statBonuses: [{ ability: 'strength', value: 30 }],
        },
      },
      {
        name: 'Dented Buckler',
        type: 'item',
        system: {
          description: '<p>A small round shield bearing the mark of whatever unfortunate knight lost it.</p>',
          slot: 'back', rarity: 'common', equipped: true,
          material: 'metal', weight: 3,
          durability: { value: 120, max: 120 },
          armorBonus: 15, veilBonus: 0,
          statBonuses: [{ ability: 'toughness', value: 10 }],
        },
      },
    ],
  },

  /* ── 2. Rat Warrior (melee DPS) ─────────────────────────────── */
  {
    actor: {
      name: 'Rat Warrior',
      race: 'monster',
      raceLevel: 60,
      type: 'character',
      stats: {
        vitality: 550, endurance: 300, strength: 700, dexterity: 550,
        toughness: 400, intelligence: 20, willpower: 150, wisdom: 21, perception: 630,
      }, // sum: 3321
    },
    items: [
      {
        name: 'Frenzied Slash',
        type: 'skill',
        system: {
          description: '<p>A rapid flurry of claws and teeth, tearing at anything within reach.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'dexterity', resource: 'stamina',
            cost: 18, diceBonus: 0.6, targetDefense: 'melee', damageType: 'physical',
            type: 'dex_weapon',
          },
        },
      },
      {
        name: 'Hamstring Bite',
        type: 'skill',
        system: {
          description: '<p>The warrior darts low, sinking teeth into the target\'s leg to slow their retreat.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'dexterity', resource: 'stamina',
            cost: 22, diceBonus: 0.5, targetDefense: 'melee', damageType: 'physical',
            type: 'dex_weapon',
          },
          tagConfig: {
            debuffType: 'slow',
            debuffDuration: 2,
          },
        },
      },
      {
        name: 'Gutting Strike',
        type: 'skill',
        system: {
          description: '<p>A vicious upward rip aimed at exposed flesh. Bleeds heavily.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd12', abilities: 'strength', resource: 'stamina',
            cost: 30, diceBonus: 0.7, targetDefense: 'melee', damageType: 'physical',
            type: 'str_weapon',
          },
          tagConfig: {
            debuffType: 'weaken',
            debuffDuration: 3,
            debuffEntries: [{ attribute: 'abilities.endurance', value: 0.3 }],
            debuffDealsDamage: true,
            debuffDamageType: 'physical',
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Sharpened Bone Blades',
        type: 'item',
        system: {
          description: '<p>Twin blades carved from the femurs of larger prey. Light and wicked sharp.</p>',
          slot: 'weaponry', rarity: 'uncommon', equipped: true,
          material: 'bone', weight: 3,
          durability: { value: 130, max: 130 },
          armorBonus: 0, veilBonus: 0,
          statBonuses: [
            { ability: 'strength', value: 20 },
            { ability: 'dexterity', value: 20 },
          ],
        },
      },
      {
        name: 'Ragged Leather Harness',
        type: 'item',
        system: {
          description: '<p>Scavenged leather strips wrapped tight. Mobility over protection.</p>',
          slot: 'chest', rarity: 'common', equipped: true,
          material: 'leather', weight: 4,
          durability: { value: 100, max: 100 },
          armorBonus: 12, veilBonus: 0,
          statBonuses: [{ ability: 'dexterity', value: 15 }],
        },
      },
    ],
  },

  /* ── 3. Rat Swarm (AOE/numbers) ─────────────────────────────── */
  {
    actor: {
      name: 'Rat Swarm',
      race: 'monster',
      raceLevel: 60,
      type: 'character',
      stats: {
        vitality: 400, endurance: 500, strength: 300, dexterity: 700,
        toughness: 350, intelligence: 5, willpower: 100, wisdom: 16, perception: 950,
      }, // sum: 3321
    },
    items: [
      {
        name: 'Swarming Bites',
        type: 'skill',
        system: {
          description: '<p>Dozens of tiny jaws latch on from every direction. Impossible to dodge them all.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          aoe: {
            enabled: true, shape: 'circle', diameter: 15,
            targetingMode: 'enemies', templateDuration: 0,
          },
          roll: {
            dice: 'd6', abilities: 'dexterity', resource: 'stamina',
            cost: 20, diceBonus: 0.4, targetDefense: 'melee', damageType: 'physical',
            type: 'dex_weapon',
          },
        },
      },
      {
        name: 'Engulf',
        type: 'skill',
        system: {
          description: '<p>The swarm surges over a target, covering them entirely. The rat tide pins them under sheer weight.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'dexterity', resource: 'stamina',
            cost: 30, diceBonus: 0.5, targetDefense: 'melee', damageType: 'physical',
            type: 'dex_weapon',
          },
          tagConfig: {
            debuffType: 'immobilized',
            debuffDuration: 1,
          },
        },
      },
      {
        name: 'Scatter',
        type: 'skill',
        system: {
          description: '<p>The swarm explodes outward in every direction, reforming moments later. Anything caught in the blast is overwhelmed.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          magicType: 'non-magical',
          tags: ['attack'],
          aoe: {
            enabled: true, shape: 'circle', diameter: 25,
            targetingMode: 'enemies', templateDuration: 0,
          },
          roll: {
            dice: 'd6', abilities: 'perception', resource: 'stamina',
            cost: 35, diceBonus: 0.4, targetDefense: 'ranged', damageType: 'physical',
            type: 'phys_ranged',
          },
        },
      },
    ],
  },

  /* ── 4. Poisonous Rat (debuff specialist) ───────────────────── */
  {
    actor: {
      name: 'Poisonous Rat',
      race: 'monster',
      raceLevel: 60,
      type: 'character',
      stats: {
        vitality: 450, endurance: 300, strength: 400, dexterity: 600,
        toughness: 350, intelligence: 150, willpower: 300, wisdom: 121, perception: 650,
      }, // sum: 3321
    },
    items: [
      {
        name: 'Venomous Bite',
        type: 'skill',
        system: {
          description: '<p>Needle-like fangs puncture flesh and inject a potent neurotoxin. The wound festers rapidly.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'dexterity', resource: 'stamina',
            cost: 20, diceBonus: 0.5, targetDefense: 'melee', damageType: 'physical',
            type: 'dex_weapon',
          },
          tagConfig: {
            debuffType: 'weaken',
            debuffDuration: 3,
            debuffEntries: [
              { attribute: 'abilities.strength', value: 0.3 },
              { attribute: 'abilities.dexterity', value: 0.3 },
            ],
            debuffDealsDamage: true,
            debuffDamageType: 'physical',
          },
        },
      },
      {
        name: 'Toxic Spit',
        type: 'skill',
        system: {
          description: '<p>The rat hocks a glob of viscous green venom at range. Contact with skin causes burning and nausea.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd6', abilities: 'perception', resource: 'stamina',
            cost: 18, diceBonus: 0.4, targetDefense: 'ranged', damageType: 'physical',
            type: 'phys_ranged',
          },
          tagConfig: {
            debuffType: 'blind',
            debuffDuration: 2,
          },
        },
      },
      {
        name: 'Paralytic Sting',
        type: 'skill',
        system: {
          description: '<p>The rat\'s barbed tail lashes out, delivering a dose of paralytic venom directly into the nervous system.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd10', abilities: 'dexterity', resource: 'stamina',
            cost: 30, diceBonus: 0.5, targetDefense: 'melee', damageType: 'physical',
            type: 'dex_weapon',
          },
          tagConfig: {
            debuffType: 'paralysis',
            debuffDuration: 2,
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Venom Glands',
        type: 'item',
        system: {
          description: '<p>Swollen glands behind the jaw that produce a constant supply of toxin.</p>',
          slot: 'weaponry', rarity: 'uncommon', equipped: true,
          material: 'bone', weight: 1,
          durability: { value: 100, max: 100 },
          armorBonus: 0, veilBonus: 0,
          statBonuses: [
            { ability: 'dexterity', value: 20 },
            { ability: 'perception', value: 15 },
          ],
        },
      },
      {
        name: 'Mottled Hide',
        type: 'item',
        system: {
          description: '<p>Discolored, toxic-resistant skin. The patterns serve as warning to predators.</p>',
          slot: 'chest', rarity: 'common', equipped: true,
          material: 'leather', weight: 3,
          durability: { value: 90, max: 90 },
          armorBonus: 10, veilBonus: 5,
          statBonuses: [{ ability: 'toughness', value: 15 }],
        },
      },
    ],
  },
];

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

export async function seedAll(folderPath) {
  const results = [];
  for (const def of MONSTERS) {
    const actor = await _createWithItems(def, folderPath);
    if (actor) results.push(actor);
  }
  ui.notifications.info(`Created ${results.length} rat monsters.`);
  return results;
}

export async function seedOne(name, folderPath) {
  const def = MONSTERS.find(m => m.actor.name === name);
  if (!def) {
    ui.notifications.warn(`Unknown rat: "${name}". Available: ${MONSTERS.map(m => m.actor.name).join(', ')}`);
    return null;
  }
  const actor = await _createWithItems(def, folderPath);
  if (actor) ui.notifications.info(`Created ${name}.`);
  return actor;
}
