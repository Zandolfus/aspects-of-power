/**
 * Painting-Themed Monster Seed Script
 * Creates 8 painting-themed monsters at race level 50 (Rank E).
 * Each has 2-3 skills and appropriate equipment.
 *
 * Usage (Foundry console):
 *   const mod = await import('/systems/aspects-of-power/scripts/seed-painting-mobs.mjs');
 *   await mod.seedAll();                          // creates all 8
 *   await mod.seedAll('Encounters/Gallery');       // into a specific folder
 *   await mod.seedOne('Turpentine Ooze');          // create one by name
 */

import { createMonster } from './create-monster.mjs';

/* ------------------------------------------------------------------ */
/*  Monster Definitions                                               */
/* ------------------------------------------------------------------ */

const MONSTERS = [

  /* ── 1. Turpentine Ooze (melee) ──────────────────────────────── */
  {
    actor: {
      name: 'Turpentine Ooze',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 550, endurance: 450, strength: 400, dexterity: 150,
        toughness: 450, intelligence: 5, willpower: 100, wisdom: 100, perception: 100,
      },
    },
    items: [
      // ── Skills ──
      {
        name: 'Acidic Slam',
        type: 'skill',
        img: 'icons/magic/acid/projectile-faceted-glob.webp',
        system: {
          description: '<p>The ooze surges forward, slamming a pseudopod of caustic turpentine into the target.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'strength', resource: 'stamina',
            cost: 15, diceBonus: 2, targetDefense: 'melee', damageType: 'physical',
          },
        },
      },
      {
        name: 'Dissolving Touch',
        type: 'skill',
        img: 'icons/magic/acid/dissolve-bone-white.webp',
        system: {
          description: '<p>Corrosive turpentine seeps into the target, weakening their musculature.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'strength', resource: 'stamina',
            cost: 25, diceBonus: 2, targetDefense: 'melee', damageType: 'physical',
          },
          tagConfig: {
            debuffType: 'weaken',
            debuffDuration: 3,
            debuffEntries: [{ attribute: 'abilities.strength', value: 0.5 }],
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Corrosive Membrane',
        type: 'item',
        img: 'icons/magic/acid/barrier-bubble-green.webp',
        system: {
          description: '<p>A layer of semi-solid turpentine that absorbs impacts.</p>',
          slot: 'chest', rarity: 'uncommon', equipped: true,
          material: 'leather', weight: 0,
          durability: { value: 150, max: 150 },
          armorBonus: 20, veilBonus: 5,
          statBonuses: [{ ability: 'toughness', value: 30 }],
        },
      },
    ],
  },

  /* ── 2. Animate Easel (melee) ────────────────────────────────── */
  {
    actor: {
      name: 'Animate Easel',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 350, endurance: 300, strength: 500, dexterity: 350,
        toughness: 400, intelligence: 5, willpower: 50, wisdom: 50, perception: 200,
      },
    },
    items: [
      {
        name: 'Leg Sweep',
        type: 'skill',
        img: 'icons/skills/melee/strike-polearm-light.webp',
        system: {
          description: '<p>The easel sweeps its sharpened legs in an arc, knocking the target backward.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'strength', resource: 'stamina',
            cost: 20, diceBonus: 2, targetDefense: 'melee', damageType: 'physical',
          },
          tagConfig: {
            forcedMovement: true,
            forcedMovementDir: 'push',
            forcedMovementDist: 10,
          },
        },
      },
      {
        name: 'Frame Bash',
        type: 'skill',
        img: 'icons/skills/melee/strike-hammer-destructive-orange.webp',
        system: {
          description: '<p>A heavy overhead slam with the easel\'s crossbar.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd12', abilities: 'strength', resource: 'stamina',
            cost: 20, diceBonus: 2, targetDefense: 'melee', damageType: 'physical',
          },
        },
      },
      {
        name: 'Splinter Guard',
        type: 'skill',
        img: 'icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp',
        system: {
          description: '<p>The easel braces its frame, reinforcing itself with jagged splinters.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          magicType: 'non-magical',
          tags: ['buff'],
          roll: {
            dice: 'd8', abilities: 'toughness', resource: 'stamina',
            cost: 15, diceBonus: 1, targetDefense: '', damageType: 'physical',
          },
          tagConfig: {
            buffEntries: [{ attribute: 'defense.armor', value: 1 }],
            buffDuration: 3,
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Hardwood Frame',
        type: 'item',
        img: 'icons/commodities/wood/bark-brown.webp',
        system: {
          description: '<p>Sturdy oak frame that serves as the easel\'s body.</p>',
          slot: 'chest', rarity: 'common', equipped: true,
          material: 'metal', weight: 8,
          durability: { value: 120, max: 120 },
          armorBonus: 25, veilBonus: 0,
          statBonuses: [{ ability: 'toughness', value: 20 }],
        },
      },
      {
        name: 'Sharpened Leg-Spikes',
        type: 'item',
        img: 'icons/weapons/polearms/spear-hooked-spike.webp',
        system: {
          description: '<p>Iron-tipped legs, sharpened to impale.</p>',
          slot: 'hands', rarity: 'common', equipped: true,
          material: 'metal', weight: 3,
          durability: { value: 100, max: 100 },
          armorBonus: 0, veilBonus: 0,
          statBonuses: [{ ability: 'strength', value: 25 }],
        },
      },
    ],
  },

  /* ── 3. Bristle Fiend (ranged) ───────────────────────────────── */
  {
    actor: {
      name: 'Bristle Fiend',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 250, endurance: 250, strength: 100, dexterity: 500,
        toughness: 150, intelligence: 200, willpower: 100, wisdom: 100, perception: 500,
      },
    },
    items: [
      {
        name: 'Bristle Dart',
        type: 'skill',
        img: 'icons/weapons/ammunition/arrow-head-war-flight.webp',
        system: {
          description: '<p>The fiend fires a volley of hardened bristles at range.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'dexterity', resource: 'stamina',
            cost: 12, diceBonus: 2, targetDefense: 'ranged', damageType: 'physical',
          },
        },
      },
      {
        name: 'Blinding Pigment',
        type: 'skill',
        img: 'icons/magic/light/explosion-star-large-orange.webp',
        system: {
          description: '<p>A burst of vivid pigment powder aimed at the target\'s eyes.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'dexterity', resource: 'stamina',
            cost: 25, diceBonus: 2, targetDefense: 'ranged', damageType: 'physical',
          },
          tagConfig: {
            debuffType: 'blind',
            debuffDuration: 2,
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Barbed Bristle Array',
        type: 'item',
        img: 'icons/weapons/ammunition/arrows-bundle-steel.webp',
        system: {
          description: '<p>A cluster of razor-sharp bristles ready to be launched.</p>',
          slot: 'hands', rarity: 'uncommon', equipped: true,
          material: 'metal', weight: 2,
          durability: { value: 80, max: 80 },
          armorBonus: 0, veilBonus: 0,
          statBonuses: [
            { ability: 'dexterity', value: 30 },
            { ability: 'perception', value: 15 },
          ],
        },
      },
      {
        name: 'Pigment-Stained Hide',
        type: 'item',
        img: 'icons/equipment/chest/breastplate-leather-studded-brown.webp',
        system: {
          description: '<p>Hide matted with dried paint, surprisingly tough.</p>',
          slot: 'chest', rarity: 'common', equipped: true,
          material: 'leather', weight: 3,
          durability: { value: 80, max: 80 },
          armorBonus: 10, veilBonus: 5,
          statBonuses: [{ ability: 'toughness', value: 10 }],
        },
      },
    ],
  },

  /* ── 4. Living Fresco (mind) ─────────────────────────────────── */
  {
    actor: {
      name: 'Living Fresco',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 300, endurance: 200, strength: 50, dexterity: 100,
        toughness: 200, intelligence: 500, willpower: 500, wisdom: 400, perception: 200,
      },
    },
    items: [
      {
        name: 'Psychic Brushstroke',
        type: 'skill',
        img: 'icons/magic/control/hypnosis-mesmerism-swirl.webp',
        system: {
          description: '<p>The fresco projects a lance of concentrated thought, painting agony across the target\'s mind.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'intelligence', resource: 'mana',
            cost: 20, diceBonus: 2, targetDefense: 'mind', damageType: 'magical',
          },
        },
      },
      {
        name: 'Maddening Vista',
        type: 'skill',
        img: 'icons/magic/control/fear-fright-shadow-monster-green.webp',
        system: {
          description: '<p>The fresco\'s surface warps into a terrifying panorama that overwhelms the viewer\'s sanity.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          vocalComponent: true,
          magicType: 'magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'willpower', resource: 'mana',
            cost: 30, diceBonus: 2, targetDefense: 'mind', damageType: 'magical',
          },
          tagConfig: {
            debuffType: 'fear',
            debuffDuration: 3,
          },
        },
      },
      {
        name: 'Chromatic Pulse',
        type: 'skill',
        img: 'icons/magic/light/explosion-star-large-purple.webp',
        system: {
          description: '<p>A rippling wave of prismatic energy radiates from the fresco, searing nearby minds.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'magical',
          tags: ['attack'],
          aoe: {
            enabled: true, shape: 'circle', diameter: 20,
            targetingMode: 'enemies', templateDuration: 0,
          },
          roll: {
            dice: 'd8', abilities: 'intelligence', resource: 'mana',
            cost: 35, diceBonus: 2, targetDefense: 'mind', damageType: 'magical',
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Gilded Frame',
        type: 'item',
        img: 'icons/sundries/misc/mirror-steel.webp',
        system: {
          description: '<p>An ornate golden frame that channels magical energy.</p>',
          slot: 'chest', rarity: 'rare', equipped: true,
          material: 'metal', weight: 10,
          durability: { value: 100, max: 100 },
          armorBonus: 10, veilBonus: 25,
          statBonuses: [
            { ability: 'intelligence', value: 30 },
            { ability: 'willpower', value: 20 },
          ],
        },
      },
    ],
  },

  /* ── 5. Half-Finished Abomination (melee + mind) ─────────────── */
  {
    actor: {
      name: 'Half-Finished Abomination',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 600, endurance: 350, strength: 500, dexterity: 200,
        toughness: 350, intelligence: 50, willpower: 200, wisdom: 50, perception: 100,
      },
    },
    items: [
      {
        name: 'Malformed Fist',
        type: 'skill',
        img: 'icons/skills/melee/unarmed-punch-fist.webp',
        system: {
          description: '<p>A lopsided, half-rendered fist crashes into the target with surprising force.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd12', abilities: 'strength', resource: 'stamina',
            cost: 18, diceBonus: 2, targetDefense: 'melee', damageType: 'physical',
          },
        },
      },
      {
        name: 'Visceral Grasp',
        type: 'skill',
        img: 'icons/magic/nature/root-vine-entangled-hand.webp',
        system: {
          description: '<p>Unfinished tendrils of paint lash out and root the target in place.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd10', abilities: 'strength', resource: 'stamina',
            cost: 25, diceBonus: 2, targetDefense: 'melee', damageType: 'physical',
          },
          tagConfig: {
            debuffType: 'root',
            debuffDuration: 2,
          },
        },
      },
      {
        name: 'Anguished Wail',
        type: 'skill',
        img: 'icons/magic/sonic/scream-wail-pointed-orange.webp',
        system: {
          description: '<p>The abomination screams — a sound that exists partly as paint, partly as agony. The incomplete cry stuns nearby minds.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          vocalComponent: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'willpower', resource: 'stamina',
            cost: 30, diceBonus: 1, targetDefense: 'mind', damageType: 'physical',
          },
          tagConfig: {
            debuffType: 'stun',
            debuffDuration: 1,
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Layered Paint Hide',
        type: 'item',
        img: 'icons/equipment/chest/coat-collared-leather-brown.webp',
        system: {
          description: '<p>Thick layers of dried paint form an uneven shell over the abomination\'s torso.</p>',
          slot: 'chest', rarity: 'uncommon', equipped: true,
          material: 'leather', weight: 12,
          durability: { value: 130, max: 130 },
          armorBonus: 22, veilBonus: 8,
          statBonuses: [
            { ability: 'vitality', value: 30 },
            { ability: 'toughness', value: 20 },
          ],
        },
      },
      {
        name: 'Misshapen Claws',
        type: 'item',
        img: 'icons/creatures/claws/claw-bear-brown.webp',
        system: {
          description: '<p>Asymmetric claws, one far larger than the other — the artist never finished.</p>',
          slot: 'hands', rarity: 'uncommon', equipped: true,
          material: 'metal', weight: 4,
          durability: { value: 100, max: 100 },
          armorBonus: 0, veilBonus: 0,
          statBonuses: [{ ability: 'strength', value: 35 }],
        },
      },
    ],
  },

  /* ── 6. Ink Serpent (ranged + melee) ──────────────────────────── */
  {
    actor: {
      name: 'Ink Serpent',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 300, endurance: 300, strength: 200, dexterity: 500,
        toughness: 200, intelligence: 150, willpower: 100, wisdom: 100, perception: 500,
      },
    },
    items: [
      {
        name: 'Ink Jet',
        type: 'skill',
        img: 'icons/magic/water/projectile-bolts-salvo-blue.webp',
        system: {
          description: '<p>The serpent spits a pressurized stream of black ink at its target.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'dexterity', resource: 'stamina',
            cost: 12, diceBonus: 2, targetDefense: 'ranged', damageType: 'physical',
          },
        },
      },
      {
        name: 'Ink Cloud',
        type: 'skill',
        img: 'icons/magic/water/barrier-ice-crystal-wall-jagged-blue.webp',
        system: {
          description: '<p>A burst of opaque ink fills the area, coating everything in blinding darkness.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          aoe: {
            enabled: true, shape: 'circle', diameter: 15,
            targetingMode: 'enemies', templateDuration: 0,
          },
          roll: {
            dice: 'd6', abilities: 'dexterity', resource: 'stamina',
            cost: 30, diceBonus: 2, targetDefense: 'ranged', damageType: 'physical',
          },
          tagConfig: {
            debuffType: 'blind',
            debuffDuration: 2,
          },
        },
      },
      {
        name: 'Constrict',
        type: 'skill',
        img: 'icons/creatures/reptiles/snake-fangs-bite-green.webp',
        system: {
          description: '<p>The serpent coils around the target, squeezing tight with its ink-slick body.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd10', abilities: 'strength', resource: 'stamina',
            cost: 25, diceBonus: 1, targetDefense: 'melee', damageType: 'physical',
          },
          tagConfig: {
            debuffType: 'immobilized',
            debuffDuration: 2,
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Ink-Slick Scales',
        type: 'item',
        img: 'icons/creatures/reptiles/snake-fangs-small-green.webp',
        system: {
          description: '<p>Iridescent scales that shimmer with liquid ink, deflecting blows.</p>',
          slot: 'chest', rarity: 'uncommon', equipped: true,
          material: 'leather', weight: 4,
          durability: { value: 100, max: 100 },
          armorBonus: 15, veilBonus: 10,
          statBonuses: [
            { ability: 'dexterity', value: 25 },
            { ability: 'perception', value: 15 },
          ],
        },
      },
    ],
  },

  /* ── 7. Palette Golem (melee) ────────────────────────────────── */
  {
    actor: {
      name: 'Palette Golem',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 650, endurance: 400, strength: 600, dexterity: 100,
        toughness: 500, intelligence: 5, willpower: 50, wisdom: 50, perception: 100,
      },
    },
    items: [
      {
        name: 'Palette Smash',
        type: 'skill',
        img: 'icons/skills/melee/strike-hammer-destructive-purple.webp',
        system: {
          description: '<p>The golem heaves a massive palette slab overhead and slams it down, sending the target flying.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd12', abilities: 'strength', resource: 'stamina',
            cost: 25, diceBonus: 2, targetDefense: 'melee', damageType: 'physical',
          },
          tagConfig: {
            forcedMovement: true,
            forcedMovementDir: 'push',
            forcedMovementDist: 15,
          },
        },
      },
      {
        name: 'Color Crush',
        type: 'skill',
        img: 'icons/skills/melee/strike-flail-destructive-orange.webp',
        system: {
          description: '<p>The golem brings both fists together on the target in a devastating pinch.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'non-magical',
          tags: ['attack'],
          roll: {
            dice: 'd12', abilities: 'strength', resource: 'stamina',
            cost: 20, diceBonus: 3, targetDefense: 'melee', damageType: 'physical',
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Lacquered Shell',
        type: 'item',
        img: 'icons/equipment/chest/breastplate-banded-steel-gold.webp',
        system: {
          description: '<p>Dozens of dried palettes fused into a thick, lacquered carapace.</p>',
          slot: 'chest', rarity: 'rare', equipped: true,
          material: 'metal', weight: 20,
          durability: { value: 200, max: 200 },
          armorBonus: 35, veilBonus: 5,
          statBonuses: [
            { ability: 'toughness', value: 40 },
            { ability: 'vitality', value: 30 },
          ],
        },
      },
      {
        name: 'Palette Blade',
        type: 'item',
        img: 'icons/weapons/swords/sword-guard-bronze.webp',
        system: {
          description: '<p>A massive palette knife, scaled up to golem proportions. Its edge is caked with dried paint that chips on impact.</p>',
          slot: 'hands', rarity: 'uncommon', equipped: true,
          material: 'metal', weight: 10,
          durability: { value: 150, max: 150 },
          armorBonus: 0, veilBonus: 0,
          statBonuses: [{ ability: 'strength', value: 40 }],
        },
      },
    ],
  },

  /* ── 8. Canvas Phantom (mind) ────────────────────────────────── */
  {
    actor: {
      name: 'Canvas Phantom',
      race: 'monster',
      raceLevel: 50,
      stats: {
        vitality: 200, endurance: 200, strength: 50, dexterity: 300,
        toughness: 100, intelligence: 500, willpower: 500, wisdom: 450, perception: 350,
      },
    },
    items: [
      {
        name: 'Haunting Gaze',
        type: 'skill',
        img: 'icons/magic/perception/eye-ringed-glow-angry-small-purple.webp',
        system: {
          description: '<p>The phantom locks eyes with its target. For an instant, the victim sees their own portrait — decaying.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          magicType: 'magical',
          tags: ['attack'],
          roll: {
            dice: 'd10', abilities: 'intelligence', resource: 'mana',
            cost: 18, diceBonus: 2, targetDefense: 'mind', damageType: 'magical',
          },
        },
      },
      {
        name: 'Painted Nightmare',
        type: 'skill',
        img: 'icons/magic/control/debuff-chains-ropes-purple.webp',
        system: {
          description: '<p>The phantom drags the target\'s consciousness into a half-finished painting where nothing makes sense.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          requiresSight: true,
          vocalComponent: true,
          magicType: 'magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'willpower', resource: 'mana',
            cost: 35, diceBonus: 2, targetDefense: 'mind', damageType: 'magical',
          },
          tagConfig: {
            debuffType: 'hallucination',
            debuffDuration: 3,
          },
        },
      },
      {
        name: 'Spectral Chill',
        type: 'skill',
        img: 'icons/magic/water/snowflake-ice-snow-white.webp',
        system: {
          description: '<p>A wave of supernatural cold emanates from the phantom\'s canvas, slowing all who feel it.</p>',
          skillType: 'Active',
          skillCategory: 'combat',
          magicType: 'magical',
          tags: ['attack', 'debuff'],
          roll: {
            dice: 'd8', abilities: 'intelligence', resource: 'mana',
            cost: 25, diceBonus: 2, targetDefense: 'mind', damageType: 'magical',
          },
          tagConfig: {
            debuffType: 'chilled',
            debuffDuration: 3,
          },
        },
      },
      // ── Equipment ──
      {
        name: 'Ethereal Shroud',
        type: 'item',
        img: 'icons/equipment/back/cape-layered-purple.webp',
        system: {
          description: '<p>A tattered canvas that flutters despite no wind, phasing in and out of reality.</p>',
          slot: 'chest', rarity: 'rare', equipped: true,
          material: 'cloth', weight: 1,
          durability: { value: 60, max: 60 },
          armorBonus: 5, veilBonus: 30,
          statBonuses: [
            { ability: 'intelligence', value: 30 },
            { ability: 'willpower', value: 25 },
            { ability: 'wisdom', value: 20 },
          ],
        },
      },
    ],
  },

];

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Create all painting-themed monsters.
 * @param {string} [folder] — Folder path, e.g. 'Encounters/Gallery'.
 */
export async function seedAll(folder = 'Mobs/Painting Gallery') {
  const results = [];
  for (const def of MONSTERS) {
    const actor = await _createWithItems(def, folder);
    if (actor) results.push(actor);
  }
  ui.notifications.info(`Created ${results.length} painting-themed monsters.`);
  return results;
}

/**
 * Create a single monster by name.
 * @param {string} name — Monster name (case-insensitive partial match).
 * @param {string} [folder] — Folder path.
 */
export async function seedOne(name, folder = 'Mobs/Painting Gallery') {
  const def = MONSTERS.find(m =>
    m.actor.name.toLowerCase().includes(name.toLowerCase())
  );
  if (!def) {
    ui.notifications.error(`No painting mob matching "${name}". Options: ${MONSTERS.map(m => m.actor.name).join(', ')}`);
    return null;
  }
  return _createWithItems(def, folder);
}

/**
 * List all available monster names.
 */
export function list() {
  return MONSTERS.map(m => m.actor.name);
}

/* ------------------------------------------------------------------ */
/*  Internal                                                          */
/* ------------------------------------------------------------------ */

async function _createWithItems(def, folder) {
  const actorOpts = { ...def.actor };
  if (folder) actorOpts.folder = folder;

  // Create the actor (stats + race level).
  const actor = await createMonster(actorOpts);
  if (!actor) return null;

  // Create embedded items (skills + equipment).
  if (def.items?.length) {
    await actor.createEmbeddedDocuments('Item', def.items);
  }

  console.log(`  → Added ${def.items?.length ?? 0} items to ${actor.name}`);
  return actor;
}
