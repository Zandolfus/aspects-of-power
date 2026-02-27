/**
 * Seed Compendiums Script
 * Paste this entire script into Foundry's browser console (F12) to populate
 * the Races, Classes, and Professions compendiums from game_data.py.
 *
 * Safe to run multiple times — it clears existing entries first.
 *
 * Tier 1 (G-F) classes/professions are combined into one item (rank "G").
 * Items are organized into folders by rank within each compendium.
 */
(async () => {
  const PACK_CLASSES     = 'aspects-of-power.classes';
  const PACK_PROFESSIONS = 'aspects-of-power.professions';
  const PACK_RACES       = 'aspects-of-power.races';

  // ──────────────────────────────────────────────
  //  CLASS DATA (rank-specific items)
  //  Python Tier 1 → Rank G-F (combined)
  //  Python Tier 2 → Rank E
  // ──────────────────────────────────────────────
  const classTier1 = {
    "Mage":            { gains: { intelligence: 2, willpower: 2, wisdom: 1, perception: 1 }, free: 2 },
    "Healer":          { gains: { willpower: 2, wisdom: 2, intelligence: 1, perception: 1 }, free: 2 },
    "Archer":          { gains: { perception: 2, dexterity: 2, endurance: 1, vitality: 1 }, free: 2 },
    "Heavy Warrior":   { gains: { strength: 2, vitality: 2, endurance: 1, toughness: 1 }, free: 2 },
    "Medium Warrior":  { gains: { strength: 2, dexterity: 2, endurance: 1, vitality: 1 }, free: 2 },
    "Light Warrior":   { gains: { dexterity: 2, endurance: 2, vitality: 1, strength: 1 }, free: 2 },
  };

  const classTier2 = {
    "Thunder Puppet's Shadow":  { gains: { dexterity: 5, strength: 4, vitality: 3, endurance: 2 }, free: 4 },
    "Astral Aetherologist":     { gains: { intelligence: 5, willpower: 4, wisdom: 3, perception: 2 }, free: 4 },
    "Glamourweaver":            { gains: { wisdom: 5, intelligence: 4, willpower: 3, toughness: 2 }, free: 4 },
    "Waywatcher":               { gains: { perception: 5, dexterity: 4, wisdom: 3, toughness: 2 }, free: 4 },
    "Glade Guardian":           { gains: { dexterity: 5, strength: 4, toughness: 3, wisdom: 2 }, free: 4 },
    "Sniper":                   { gains: { perception: 5, dexterity: 4, endurance: 3, toughness: 2 }, free: 4 },
    "Augur":                    { gains: { wisdom: 6, willpower: 6, vitality: 6 }, free: 4 },
    "Monk":                     { gains: { dexterity: 5, strength: 4, toughness: 3, vitality: 2 }, free: 4 },
    "Spearman":                 { gains: { strength: 5, dexterity: 4, vitality: 3, endurance: 2 }, free: 4 },
    "Knife Artist":             { gains: { dexterity: 5, perception: 4, vitality: 3, endurance: 2 }, free: 4 },
    "Bloodmage":                { gains: { intelligence: 5, wisdom: 4, vitality: 3, willpower: 2 }, free: 4 },
    "Aspiring Blade of Light":  { gains: { strength: 5, dexterity: 4, vitality: 3, endurance: 2 }, free: 4 },
    "Beginner Assassin":        { gains: { dexterity: 5, strength: 4, perception: 3, endurance: 2 }, free: 4 },
    "Hydromancer":              { gains: { intelligence: 5, willpower: 4, vitality: 3, perception: 2 }, free: 4 },
    "Clergyman":                { gains: { wisdom: 5, willpower: 4, vitality: 3, endurance: 2 }, free: 4 },
    "Swashbuckler":             { gains: { strength: 5, dexterity: 4, vitality: 3, endurance: 2 }, free: 4 },
    "Witch of Ages":            { gains: { willpower: 5, intelligence: 4, wisdom: 3, vitality: 2 }, free: 4 },
    "Curse Eater":              { gains: { willpower: 5, perception: 4, vitality: 3, dexterity: 2 }, free: 4 },
    "Fireborne":                { gains: { intelligence: 5, willpower: 4, vitality: 3, toughness: 2 }, free: 4 },
    "Windcaller":               { gains: { intelligence: 5, perception: 4, wisdom: 3, willpower: 2 }, free: 4 },
    "Overwatch":                { gains: { perception: 5, dexterity: 4, endurance: 3, strength: 2 }, free: 4 },
    "Blood Warden":             { gains: { vitality: 5, strength: 4, dexterity: 3, toughness: 2 }, free: 4 },
    "Windservant":              { gains: { intelligence: 5, dexterity: 4, willpower: 3, vitality: 2 }, free: 4 },
    "Ice Maiden":               { gains: { intelligence: 5, willpower: 4, wisdom: 3, dexterity: 2 }, free: 4 },
    "Paramedic":                { gains: { wisdom: 5, willpower: 4, dexterity: 3, vitality: 2 }, free: 4 },
    "Treewalker":               { gains: { perception: 5, dexterity: 4, endurance: 3, vitality: 2 }, free: 4 },
    "Triage Healer":            { gains: { wisdom: 5, willpower: 4, perception: 3, endurance: 2 }, free: 4 },
    "Sandman":                  { gains: { dexterity: 5, willpower: 4, intelligence: 3, strength: 2 }, free: 4 },
    "Pyroclast Magus":          { gains: { intelligence: 5, willpower: 4, vitality: 3, perception: 2 }, free: 4 },
  };

  // ──────────────────────────────────────────────
  //  PROFESSION DATA (rank-specific items)
  // ──────────────────────────────────────────────
  const profTier1 = {
    "Beginner Jeweler of the Elements":      { gains: { wisdom: 2, dexterity: 2, vitality: 1, perception: 1 }, free: 2 },
    "Beginner Smith of the Moonshadow":      { gains: { strength: 2, perception: 2, vitality: 1, intelligence: 1 }, free: 2 },
    "Justiciar":                             { gains: {}, free: 8 },
    "Judge":                                 { gains: {}, free: 8 },
    "Magistrate":                            { gains: {}, free: 8 },
    "Advocate":                              { gains: {}, free: 8 },
    "Gatherer":                              { gains: { strength: 2, perception: 2, dexterity: 1, endurance: 1 }, free: 2 },
    "Chef":                                  { gains: { dexterity: 2, perception: 2, strength: 1, endurance: 1 }, free: 2 },
    "Student Trapper of the Asrai":          { gains: { perception: 2, dexterity: 2, vitality: 1, endurance: 1 }, free: 2 },
    "Pickpocket":                            { gains: { perception: 2, dexterity: 2, strength: 1, endurance: 1 }, free: 2 },
    "Novice Tailor":                         { gains: { dexterity: 2, perception: 2, wisdom: 1, willpower: 1 }, free: 2 },
    "Builder":                               { gains: { strength: 2, dexterity: 2, endurance: 1, intelligence: 1 }, free: 2 },
    "Windlord's Keeper":                     { gains: { intelligence: 2, dexterity: 2, willpower: 1, toughness: 1 }, free: 2 },
    "Beginner Leatherworker of the Cosmos":  { gains: { dexterity: 2, willpower: 2, strength: 1, intelligence: 1 }, free: 2 },
    "Seed of New Life":                      { gains: { willpower: 2, wisdom: 2, perception: 1, vitality: 1 }, free: 2 },
    "Vanguard of New Growth":                { gains: { perception: 2, vitality: 2, strength: 1, toughness: 1 }, free: 2 },
    "Student Shaper of the Asrai":           { gains: { dexterity: 2, perception: 2, willpower: 1, wisdom: 1 }, free: 2 },
    "Alchemist of Flame's Heart":            { gains: { wisdom: 2, perception: 2, willpower: 1, intelligence: 1 }, free: 2 },
    "Drums of War, Largo":                   { gains: { strength: 2, dexterity: 2, willpower: 1, wisdom: 1 }, free: 2 },
    "Novice Witch-Wright of Iron and Ice":   { gains: { intelligence: 2, wisdom: 2, willpower: 1, vitality: 1 }, free: 2 },
    "Beast-Speaker":                         { gains: { vitality: 2, wisdom: 2, endurance: 1, dexterity: 1 }, free: 2 },
    "Student Blood Alchemist":               { gains: { wisdom: 2, vitality: 2, willpower: 1, perception: 1 }, free: 2 },
    "Demonic Butler":                        { gains: {}, free: 8 },
  };

  const profTier2 = {
    "Crusher":                               { gains: { strength: 6, dexterity: 4, endurance: 4 }, free: 4 },
    "Chef for the Masses":                   { gains: { perception: 5, dexterity: 4, strength: 3, endurance: 2 }, free: 4 },
    "Trapper of the Asrai":                  { gains: { perception: 5, dexterity: 4, vitality: 3, endurance: 2 }, free: 4 },
    "Thief":                                 { gains: { dexterity: 5, perception: 4, endurance: 3, strength: 2 }, free: 4 },
    "Tailor of Ingenuity":                   { gains: { dexterity: 5, perception: 4, wisdom: 3, willpower: 2 }, free: 4 },
    "Architect":                             { gains: { strength: 5, dexterity: 4, endurance: 3, willpower: 2 }, free: 4 },
    "Drums of War, Andante":                 { gains: { strength: 5, dexterity: 4, willpower: 3, wisdom: 2 }, free: 4 },
    "Student Leatherworker of the Cosmos":   { gains: { dexterity: 5, willpower: 4, strength: 3, intelligence: 2 }, free: 4 },
    "Witch-Wright of Iron and Ice":          { gains: { intelligence: 5, wisdom: 4, willpower: 3, vitality: 2 }, free: 4 },
    "Beast-Tamer":                           { gains: { vitality: 5, wisdom: 4, endurance: 3, dexterity: 2 }, free: 4 },
    "Windlord's Bonded":                     { gains: { intelligence: 5, dexterity: 4, willpower: 3, toughness: 2 }, free: 4 },
    "True Vanguard of New Growth":           { gains: { perception: 5, vitality: 4, strength: 3, toughness: 2 }, free: 4 },
    "Sapling of New Life":                   { gains: { willpower: 5, wisdom: 4, perception: 3, vitality: 2 }, free: 4 },
    "High Judge":                            { gains: {}, free: 18 },
    "High Justiciar":                        { gains: {}, free: 18 },
    "High Magistrate":                       { gains: {}, free: 18 },
    "High Advocate":                         { gains: {}, free: 18 },
    "Mana-Jeweler of the Elements":          { gains: { willpower: 5, wisdom: 4, intelligence: 3, vitality: 2 }, free: 4 },
    "Shaper of the Asrai":                   { gains: { dexterity: 5, perception: 4, willpower: 3, wisdom: 2 }, free: 4 },
    "Blazing Alchemist of Flame's Heart":    { gains: { wisdom: 5, perception: 4, willpower: 3, intelligence: 2 }, free: 4 },
    "Witch-Wright of Jewels":                { gains: { wisdom: 5, dexterity: 4, vitality: 3, perception: 2 }, free: 4 },
    "Proficient Smith of the Moonshadow":    { gains: { strength: 5, perception: 4, vitality: 3, intelligence: 2 }, free: 4 },
    "Head Demonic Butler":                   { gains: {}, free: 8 },
    "Field Smith of the Moonshadow":         { gains: { intelligence: 5, willpower: 4, perception: 3, strength: 2 }, free: 4 },
  };

  // ──────────────────────────────────────────────
  //  RACE DATA (multi-rank items)
  // ──────────────────────────────────────────────
  const races = {
    "Human": {
      rankGains: {
        G: { vitality: 1, endurance: 1, strength: 1, dexterity: 1, toughness: 1, intelligence: 1, willpower: 1, wisdom: 1, perception: 1 },
        F: { vitality: 1, endurance: 1, strength: 1, dexterity: 1, toughness: 1, intelligence: 1, willpower: 1, wisdom: 1, perception: 1 },
        E: { vitality: 2, endurance: 2, strength: 2, dexterity: 2, toughness: 2, intelligence: 2, willpower: 2, wisdom: 2, perception: 2 },
        D: { vitality: 6, endurance: 6, strength: 6, dexterity: 6, toughness: 6, intelligence: 6, willpower: 6, wisdom: 6, perception: 6 },
      },
      freePointsPerLevel: { G: 1, F: 2, E: 5, D: 15 },
    },
    "Half-Asrai": {
      rankGains: {
        G: { dexterity: 2, toughness: 2, wisdom: 2, perception: 2 },
        F: { dexterity: 2, toughness: 2, wisdom: 2, perception: 2 },
        E: { dexterity: 4, toughness: 4, wisdom: 4, perception: 4 },
      },
      freePointsPerLevel: { G: 2, F: 3, E: 7 },
    },
    "Asrai": {
      rankGains: {
        F: { dexterity: 3, toughness: 2, wisdom: 2, perception: 2, vitality: 2 },
        E: { dexterity: 5, toughness: 4, wisdom: 4, perception: 4, vitality: 4 },
      },
      freePointsPerLevel: {},
    },
    "Monster": {
      rankGains: {},
      freePointsPerLevel: { F: 42, E: 63 },
    },
    "Juvenile Astral Elf": {
      rankGains: {
        E: { willpower: 3, perception: 3, intelligence: 3, vitality: 3, dexterity: 3, wisdom: 3 },
      },
      freePointsPerLevel: { E: 5 },
    },
    "Demon": {
      rankGains: {
        F: { strength: 2, dexterity: 2, wisdom: 2, intelligence: 2, willpower: 2, perception: 1 },
        E: { strength: 3, dexterity: 3, wisdom: 3, intelligence: 3, willpower: 3, perception: 3 },
      },
      freePointsPerLevel: { E: 5 },
    },
  };

  // ──────────────────────────────────────────────
  //  HELPERS
  // ──────────────────────────────────────────────

  /** Build a full gains object with all 9 abilities (defaulting to 0). */
  function fullGains(partial) {
    return {
      vitality: 0, endurance: 0, strength: 0, dexterity: 0, toughness: 0,
      intelligence: 0, willpower: 0, wisdom: 0, perception: 0,
      ...partial,
    };
  }

  /** Build full rankGains for a race (all 8 ranks, defaulting missing to zeroes). */
  function fullRankGains(partial) {
    const result = {};
    for (const rank of ['G','F','E','D','C','B','A','S']) {
      result[rank] = fullGains(partial[rank] ?? {});
    }
    return result;
  }

  /** Build full freePointsPerLevel for a race (all 8 ranks, default 0). */
  function fullFreePoints(partial) {
    const result = {};
    for (const rank of ['G','F','E','D','C','B','A','S']) {
      result[rank] = partial[rank] ?? 0;
    }
    return result;
  }

  /** Clear all documents and folders from a compendium pack. */
  async function clearPack(packId) {
    const pack = game.packs.get(packId);
    if (!pack) { console.warn(`Pack ${packId} not found!`); return; }
    // Delete items first, then folders.
    const docs = await pack.getDocuments();
    if (docs.length) {
      const ids = docs.map(d => d.id);
      await Item.deleteDocuments(ids, { pack: packId });
      console.log(`Deleted ${ids.length} items from ${packId}`);
    }
    // Delete folders.
    const folders = pack.folders;
    if (folders.size) {
      const folderIds = folders.map(f => f.id);
      await Folder.deleteDocuments(folderIds, { pack: packId });
      console.log(`Deleted ${folderIds.length} folders from ${packId}`);
    }
  }

  /**
   * Create rank folders in a compendium pack.
   * @param {string} packId  - The compendium pack ID.
   * @param {string[]} ranks - The rank labels to create folders for.
   * @returns {Object} Map of rank label → folder ID.
   */
  async function createRankFolders(packId, ranks) {
    const folderData = ranks.map((label, i) => ({
      name: label,
      type: 'Item',
      sorting: 'm',
      sort: (i + 1) * 100000,
    }));
    const created = await Folder.createDocuments(folderData, { pack: packId });
    const map = {};
    for (const folder of created) {
      map[folder.name] = folder.id;
    }
    return map;
  }

  /** Build a rank-specific item (class or profession). */
  function buildRankItem(name, rank, data, type, folderId) {
    return {
      name,
      type,
      folder: folderId,
      system: {
        rank,
        gains: fullGains(data.gains),
        freePointsPerLevel: data.free,
      },
    };
  }

  // ──────────────────────────────────────────────
  //  SEED LOGIC
  // ──────────────────────────────────────────────

  console.log('=== Seeding Compendiums ===');

  // Clear existing data.
  await clearPack(PACK_CLASSES);
  await clearPack(PACK_PROFESSIONS);
  await clearPack(PACK_RACES);

  // --- Classes ---
  const classFolders = await createRankFolders(PACK_CLASSES, ['Rank G-F', 'Rank E']);
  const classItems = [];
  for (const [name, data] of Object.entries(classTier1)) {
    classItems.push(buildRankItem(name, 'G', data, 'class', classFolders['Rank G-F']));
  }
  for (const [name, data] of Object.entries(classTier2)) {
    classItems.push(buildRankItem(name, 'E', data, 'class', classFolders['Rank E']));
  }
  await Item.createDocuments(classItems, { pack: PACK_CLASSES });
  console.log(`Created ${classItems.length} class items in ${Object.keys(classFolders).length} folders.`);

  // --- Professions ---
  const profFolders = await createRankFolders(PACK_PROFESSIONS, ['Rank G-F', 'Rank E']);
  const profItems = [];
  for (const [name, data] of Object.entries(profTier1)) {
    profItems.push(buildRankItem(name, 'G', data, 'profession', profFolders['Rank G-F']));
  }
  for (const [name, data] of Object.entries(profTier2)) {
    profItems.push(buildRankItem(name, 'E', data, 'profession', profFolders['Rank E']));
  }
  await Item.createDocuments(profItems, { pack: PACK_PROFESSIONS });
  console.log(`Created ${profItems.length} profession items in ${Object.keys(profFolders).length} folders.`);

  // --- Races ---
  // Races are multi-rank, no rank folders needed.
  const raceItems = [];
  for (const [name, data] of Object.entries(races)) {
    raceItems.push({
      name,
      type: 'race',
      system: {
        rankGains: fullRankGains(data.rankGains),
        freePointsPerLevel: fullFreePoints(data.freePointsPerLevel),
      },
    });
  }
  await Item.createDocuments(raceItems, { pack: PACK_RACES });
  console.log(`Created ${raceItems.length} race items.`);

  console.log('=== Seeding Complete ===');
  ui.notifications.info(`Compendiums seeded: ${classItems.length} classes, ${profItems.length} professions, ${raceItems.length} races.`);
})();
