/**
 * Augment Compendium Seed Script
 * Run this in the Foundry VTT console (F12) as GM:
 *   const mod = await import('/systems/aspects-of-power/scripts/seed-augments.mjs');
 *   await mod.seed();
 *
 * Or paste the seed() function body directly into the console.
 */
export async function seed() {
  const pack = game.packs.get('aspects-of-power.augments');
  if (!pack) {
    ui.notifications.error('Augments compendium not found!');
    return;
  }

  // Unlock the pack for editing.
  await pack.configure({ locked: false });

  const augments = [
    // ── Deflection ──
    {
      name: 'Deflection',
      type: 'augment',
      img: 'icons/magic/defensive/shield-barrier-deflection-blue.webp',
      system: {
        description: '<p><strong>Reaction.</strong> Attempt to deflect a ranged attack flying towards you by warping space. Costs 20 mana. Increases ranged defense by 10%, up to 352.</p>',
        statBonuses: [],
      },
    },

    // ── Headshot ──
    {
      name: 'Headshot',
      type: 'augment',
      img: 'icons/skills/ranged/target-bullseye-arrow-glowing.webp',
      system: {
        description: '<p>Take aim at an enemy and fire a blast of mana at the target. Make a physical ranged attack roll. If you hit, determine if it is a headshot or not.</p><p>If your attack roll is double or more the ranged defense of the target, it is a guaranteed headshot. If it is not double or more, compare the two values and roll a d20. On a 20, it becomes a headshot. For every 5% above the enemy\'s ranged defense, the headshot range increases.</p><p>Deals 500 damage on a normal strike. Deals double damage on a headshot. Costs 50 stored mana.</p>',
        statBonuses: [],
      },
    },

    // ── Yellow Sapphire ──
    {
      name: 'Yellow Sapphire',
      type: 'augment',
      img: 'icons/commodities/gems/gem-faceted-octagon-yellow.webp',
      system: {
        description: '<p>Stores up to 200 mana. Slowly absorbs mana over time (5/hour).</p>',
        statBonuses: [],
      },
    },

    // ── Minor Dangersense ──
    {
      name: 'Minor Dangersense',
      type: 'augment',
      img: 'icons/magic/perception/eye-ringed-glow-angry-red.webp',
      system: {
        description: '<p>Alerts the wearer of potential danger. Only works at short ranges.</p>',
        statBonuses: [],
      },
    },

    // ── Silent Eavesdrop ──
    {
      name: 'Silent Eavesdrop',
      type: 'augment',
      img: 'icons/magic/perception/ear-runes-glow-blue.webp',
      system: {
        description: '<p>Consumes 20 mana to silently listen to any whisper or quiet conversation within 15 feet, even through thin walls or curtains. Sounds are delivered via magical murmur.</p>',
        statBonuses: [],
      },
    },

    // ── Flickerstep ──
    {
      name: 'Flickerstep',
      type: 'augment',
      img: 'icons/magic/movement/trail-streak-zigzag-blue.webp',
      system: {
        description: '<p><strong>Reaction.</strong> Stores a charge over a day-long period. User can reactively tap into the ring and blink 10ft in any direction. A temporary afterimage is generated at the point of origin.</p>',
        statBonuses: [],
      },
    },

    // ── Ember Aura ──
    {
      name: 'Ember Aura',
      type: 'augment',
      img: 'icons/magic/fire/flame-burning-hand-orange.webp',
      system: {
        description: '<p>The ring generates a field of heat around the wearer. Wearer can ignite flammable material with a touch. Also grants resistance to cold temperatures.</p>',
        statBonuses: [],
      },
    },

    // ── Mirror Veil ──
    {
      name: 'Mirror Veil',
      type: 'augment',
      img: 'icons/magic/defensive/shield-barrier-flaming-diamond-purple.webp',
      system: {
        description: '<p><strong>Reaction.</strong> Stores a charge over a day-long period. Automatically attempts to reflect a single target magic attack that would strike its user using a contested willpower roll. Any attempt consumes the charge.</p>',
        statBonuses: [],
      },
    },

    // ── Illuminated Sight ──
    {
      name: 'Illuminated Sight',
      type: 'augment',
      img: 'icons/magic/perception/eye-ringed-glow-blue.webp',
      system: {
        description: '<p>Consumes 20 mana to reveal a 30ft area in line of sight, revealing anyone within the area whose stealth roll is 800 or below.</p>',
        statBonuses: [],
      },
    },

    // ── Gem Slot ──
    {
      name: 'Gem Slot',
      type: 'augment',
      img: 'icons/commodities/gems/gem-faceted-round-green.webp',
      system: {
        description: '<p>A beautiful green gem appears to have been grown into the staff itself. Stores up to 400 mana.</p>',
        statBonuses: [],
      },
    },

    // ── Natural Feeding ──
    {
      name: 'Natural Feeding',
      type: 'augment',
      img: 'icons/magic/nature/root-vine-entangled-hand.webp',
      system: {
        description: '<p>The staff can pierce the wielder\'s hand and drain vitality to generate mana for the staff to store. 1:1 ratio.</p><p>Alternatively, plant the staff in the ground and it will slowly regain mana at a rate of 10/hour.</p>',
        statBonuses: [],
      },
    },

    // ── Nature's Wrath ──
    {
      name: "Nature's Wrath",
      type: 'augment',
      img: 'icons/magic/nature/root-vine-barrier-wall-green.webp',
      system: {
        description: '<p>Conjures a wild patch of thorns that wrap and pierce an enemy. Uses the wielder\'s intelligence at a .6 modifier. Causes bleeding, poisoning, and constriction. Consumes 200 of the stored mana in the staff.</p>',
        statBonuses: [],
      },
    },

    // ── Mana Capacitor ──
    {
      name: 'Mana Capacitor',
      type: 'augment',
      img: 'icons/magic/lightning/bolt-strike-chest-blue.webp',
      system: {
        description: '<p>Mana can be stored in the threads, up to 400. Can be drawn upon for casting.</p><p>Upon being struck, automatically casts mana shield for the full quantity.</p>',
        statBonuses: [],
      },
    },

    // ── Mana-Absorptive Fabric ──
    {
      name: 'Mana-Absorptive Fabric',
      type: 'augment',
      img: 'icons/magic/symbols/runes-star-pentagon-blue.webp',
      system: {
        description: '<p>The robe passively absorbs mana in the atmosphere. Stores 10 mana/hour under standard conditions.</p>',
        statBonuses: [],
      },
    },

    // ── Born Upon the Wind ──
    {
      name: 'Born Upon the Wind',
      type: 'augment',
      img: 'icons/magic/air/wind-tornado-wall-blue.webp',
      system: {
        description: '<p>By consuming 40 mana, the robe can generate a gust of wind that can lift the wearer 40 feet in any direction.</p>',
        statBonuses: [],
      },
    },
  ];

  const created = await Item.createDocuments(augments, { pack: pack.collection });
  ui.notifications.info(`Created ${created.length} augments in the compendium.`);

  // Re-lock the pack.
  await pack.configure({ locked: true });

  console.log('Augment seed complete:', created.map(a => a.name));
}
