/**
 * Seed script: Create starter profession gear items in the world.
 *
 * Run in console:
 *   const mod = await import('/systems/aspects-of-power/scripts/seed-profession-gear.mjs');
 *   await mod.seedAll();
 */

const PROFESSION_GEAR = {
  // ── Smithing ──
  smith: {
    label: 'Smithing',
    items: [
      { name: "Apprentice's Hammer",      slot: 'profWeapon',  material: 'metal', rarity: 'common', progress: 50, description: 'A basic smithing hammer for shaping metal.' },
      { name: "Apprentice's Tongs",       slot: 'profUtility', material: 'metal', rarity: 'common', progress: 50, description: 'Simple tongs for holding hot metal.' },
      { name: "Smith's Leather Apron",    slot: 'profChest',   material: 'leather', rarity: 'common', progress: 30, description: 'Protects against sparks and heat.' },
      { name: "Smith's Gloves",           slot: 'profGloves',  material: 'leather', rarity: 'common', progress: 20, description: 'Heat-resistant work gloves.' },
      { name: "Smith's Boots",            slot: 'profBoots',   material: 'leather', rarity: 'common', progress: 20, description: 'Sturdy boots for the forge.' },
    ],
  },

  // ── Jeweler ──
  jeweler: {
    label: 'Jewelcrafting',
    items: [
      { name: "Jeweler's Chisel",         slot: 'profWeapon',  material: 'metal', rarity: 'common', progress: 50, description: 'A fine chisel for cutting gems.' },
      { name: "Jeweler's Loupe",          slot: 'profUtility', material: 'jewelry', rarity: 'common', progress: 50, description: 'A magnifying loupe for inspecting gemstones.' },
      { name: "Jeweler's Visor",          slot: 'profHead',    material: 'metal', rarity: 'common', progress: 30, description: 'Magnifying visor for precision work.' },
      { name: "Jeweler's Smock",          slot: 'profChest',   material: 'cloth', rarity: 'common', progress: 20, description: 'A clean work smock with many pockets.' },
      { name: "Jeweler's Gloves",         slot: 'profGloves',  material: 'cloth', rarity: 'common', progress: 20, description: 'Thin gloves for delicate gem handling.' },
    ],
  },

  // ── Alchemy ──
  alchemist: {
    label: 'Alchemy',
    items: [
      { name: "Apprentice's Stirring Rod", slot: 'profWeapon',  material: 'metal', rarity: 'common', progress: 50, description: 'A glass-tipped rod for mixing reagents.' },
      { name: "Apprentice's Mortar",       slot: 'profUtility', material: 'metal', rarity: 'common', progress: 50, description: 'A stone mortar and pestle for grinding.' },
      { name: "Alchemist's Goggles",       slot: 'profHead',    material: 'leather', rarity: 'common', progress: 30, description: 'Protective goggles for volatile reactions.' },
      { name: "Alchemist's Coat",          slot: 'profChest',   material: 'cloth', rarity: 'common', progress: 30, description: 'Stain-resistant work coat.' },
      { name: "Alchemist's Gloves",        slot: 'profGloves',  material: 'leather', rarity: 'common', progress: 20, description: 'Chemical-resistant gloves.' },
    ],
  },

  // ── Chef / Cooking ──
  chef: {
    label: 'Cooking',
    items: [
      { name: "Chef's Knife",             slot: 'profWeapon',  material: 'metal', rarity: 'common', progress: 50, description: 'A sharp utility knife for food preparation.' },
      { name: "Chef's Ladle",             slot: 'profUtility', material: 'metal', rarity: 'common', progress: 40, description: 'A sturdy ladle for stirring and serving.' },
      { name: "Chef's Hat",               slot: 'profHead',    material: 'cloth', rarity: 'common', progress: 20, description: 'The traditional tall hat of a cook.' },
      { name: "Chef's Apron",             slot: 'profChest',   material: 'cloth', rarity: 'common', progress: 20, description: 'A flour-dusted work apron.' },
      { name: "Chef's Gloves",            slot: 'profGloves',  material: 'cloth', rarity: 'common', progress: 15, description: 'Heat-resistant kitchen gloves.' },
    ],
  },

  // ── Leatherworker ──
  leatherworker: {
    label: 'Leatherworking',
    items: [
      { name: "Leatherworker's Awl",      slot: 'profWeapon',  material: 'metal', rarity: 'common', progress: 50, description: 'A sharp awl for punching holes in hide.' },
      { name: "Leatherworker's Shears",   slot: 'profUtility', material: 'metal', rarity: 'common', progress: 50, description: 'Heavy shears for cutting leather.' },
      { name: "Tanner's Apron",           slot: 'profChest',   material: 'leather', rarity: 'common', progress: 30, description: 'A thick hide apron for messy tanning work.' },
      { name: "Tanner's Gloves",          slot: 'profGloves',  material: 'leather', rarity: 'common', progress: 20, description: 'Reinforced gloves for handling rough hides.' },
      { name: "Tanner's Boots",           slot: 'profBoots',   material: 'leather', rarity: 'common', progress: 20, description: 'Waterproof boots for the tanning pit.' },
    ],
  },

  // ── Builder / Architect ──
  builder: {
    label: 'Construction',
    items: [
      { name: "Builder's Mallet",         slot: 'profWeapon',  material: 'wood', rarity: 'common', progress: 50, description: 'A wooden mallet for driving pegs and joints.' },
      { name: "Builder's Square",         slot: 'profUtility', material: 'metal', rarity: 'common', progress: 40, description: 'A measuring square for precise angles.' },
      { name: "Builder's Cap",            slot: 'profHead',    material: 'leather', rarity: 'common', progress: 20, description: 'A protective cap for construction work.' },
      { name: "Builder's Vest",           slot: 'profChest',   material: 'leather', rarity: 'common', progress: 25, description: 'A sturdy work vest with tool loops.' },
      { name: "Builder's Boots",          slot: 'profBoots',   material: 'leather', rarity: 'common', progress: 20, description: 'Steel-toed work boots.' },
    ],
  },

  // ── Shaper (Asrai woodworking/weaving) ──
  shaper: {
    label: 'Shaping',
    items: [
      { name: "Shaper's Wand",            slot: 'profWeapon',  material: 'wood', rarity: 'common', progress: 50, description: 'A living-wood wand for guiding growth.' },
      { name: "Shaper's Thread Spool",    slot: 'profUtility', material: 'cloth', rarity: 'common', progress: 40, description: 'Enchanted thread for weaving natural fibers.' },
      { name: "Shaper's Circlet",         slot: 'profHead',    material: 'wood', rarity: 'common', progress: 30, description: 'A wooden circlet that aids concentration.' },
      { name: "Shaper's Robe",            slot: 'profChest',   material: 'cloth', rarity: 'common', progress: 25, description: 'A flowing robe that doesn\'t restrict hand movement.' },
      { name: "Shaper's Gloves",          slot: 'profGloves',  material: 'cloth', rarity: 'common', progress: 20, description: 'Thin gloves for delicate thread manipulation.' },
    ],
  },

  // ── Witch-Wright (mana crafting) ──
  witchwright: {
    label: 'Witch-Wrighting',
    items: [
      { name: "Witch-Wright's Focus",     slot: 'profWeapon',  material: 'crystal', rarity: 'common', progress: 50, description: 'A crystalline focus for channeling mana into materials.' },
      { name: "Witch-Wright's Crucible",  slot: 'profUtility', material: 'metal', rarity: 'common', progress: 50, description: 'A mana-conductive crucible for melting enchanted metals.' },
      { name: "Witch-Wright's Goggles",   slot: 'profHead',    material: 'metal', rarity: 'common', progress: 30, description: 'Mana-sight goggles for seeing energy flow.' },
      { name: "Witch-Wright's Coat",      slot: 'profChest',   material: 'cloth', rarity: 'common', progress: 25, description: 'A mana-resistant work coat.' },
      { name: "Witch-Wright's Gloves",    slot: 'profGloves',  material: 'leather', rarity: 'common', progress: 20, description: 'Insulated gloves for handling mana-charged materials.' },
    ],
  },

  // ── Herbalist / Botanist ──
  herbalist: {
    label: 'Herbalism',
    items: [
      { name: "Herbalist's Sickle",       slot: 'profWeapon',  material: 'metal', rarity: 'common', progress: 50, description: 'A curved sickle for harvesting herbs.' },
      { name: "Herbalist's Pouch",        slot: 'profUtility', material: 'leather', rarity: 'common', progress: 40, description: 'A preservation pouch that keeps herbs fresh.' },
      { name: "Herbalist's Hat",          slot: 'profHead',    material: 'cloth', rarity: 'common', progress: 20, description: 'A wide-brimmed hat for field work.' },
      { name: "Herbalist's Vest",         slot: 'profChest',   material: 'cloth', rarity: 'common', progress: 20, description: 'A vest with many pockets for specimens.' },
      { name: "Herbalist's Boots",        slot: 'profBoots',   material: 'leather', rarity: 'common', progress: 20, description: 'Waterproof boots for marshes and forests.' },
    ],
  },

  // ── Miner ──
  miner: {
    label: 'Mining',
    items: [
      { name: "Miner's Pickaxe",          slot: 'profWeapon',  material: 'metal', rarity: 'common', progress: 50, description: 'A sturdy pickaxe for breaking rock and ore.' },
      { name: "Miner's Lantern",          slot: 'profUtility', material: 'metal', rarity: 'common', progress: 30, description: 'A reliable lantern for dark tunnels.' },
      { name: "Miner's Helmet",           slot: 'profHead',    material: 'metal', rarity: 'common', progress: 30, description: 'A reinforced helmet for cave-ins.' },
      { name: "Miner's Vest",             slot: 'profChest',   material: 'leather', rarity: 'common', progress: 25, description: 'A thick vest with ore pockets.' },
      { name: "Miner's Boots",            slot: 'profBoots',   material: 'leather', rarity: 'common', progress: 20, description: 'Steel-toed boots for mine work.' },
    ],
  },
};

/**
 * Create all profession gear sets as world items.
 */
export async function seedAll() {
  const items = [];

  for (const [profKey, prof] of Object.entries(PROFESSION_GEAR)) {
    for (const gear of prof.items) {
      items.push({
        name: gear.name,
        type: 'item',
        img: 'icons/svg/item-bag.svg',
        system: {
          description: `<p>${gear.description}</p><p><em>${prof.label} profession gear.</em></p>`,
          slot: gear.slot,
          material: gear.material,
          rarity: gear.rarity,
          progress: gear.progress,
          durability: { value: gear.progress * 2, max: gear.progress * 2 },
          equipped: false,
          quantity: 1,
          weight: 1,
        },
      });
    }
  }

  const created = await Item.createDocuments(items);
  ui.notifications.info(`Created ${created.length} profession gear items across ${Object.keys(PROFESSION_GEAR).length} professions.`);
  console.log(`Seeded profession gear:`, created.map(i => i.name));
  return created;
}

/**
 * Create gear for a specific profession and add to an actor.
 * @param {Actor} actor - The actor to receive the gear.
 * @param {string} profKey - Key from PROFESSION_GEAR (smith, jeweler, alchemist, etc.)
 */
export async function seedForActor(actor, profKey) {
  const prof = PROFESSION_GEAR[profKey];
  if (!prof) {
    ui.notifications.warn(`Unknown profession: ${profKey}. Available: ${Object.keys(PROFESSION_GEAR).join(', ')}`);
    return;
  }

  const items = prof.items.map(gear => ({
    name: gear.name,
    type: 'item',
    img: 'icons/svg/item-bag.svg',
    system: {
      description: `<p>${gear.description}</p><p><em>${prof.label} profession gear.</em></p>`,
      slot: gear.slot,
      material: gear.material,
      rarity: gear.rarity,
      progress: gear.progress,
      durability: { value: gear.progress * 2, max: gear.progress * 2 },
      equipped: false,
      quantity: 1,
      weight: 1,
    },
  }));

  const created = await actor.createEmbeddedDocuments('Item', items);
  ui.notifications.info(`Added ${created.length} ${prof.label} gear items to ${actor.name}.`);
  return created;
}
