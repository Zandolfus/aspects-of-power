/**
 * Monster Creator Script
 * Creates NPC actors with race-only leveling (monsters/familiars).
 *
 * Usage (Foundry console):
 *   const mod = await import('/systems/aspects-of-power/scripts/create-monster.mjs');
 *
 *   // Create a monster with auto-distributed stats:
 *   await mod.createMonster({
 *     name: 'Dire Wolf',
 *     race: 'monster',
 *     raceLevel: 30,
 *     stats: { vitality: 200, endurance: 150, strength: 250, dexterity: 300,
 *              toughness: 100, intelligence: 5, willpower: 50, wisdom: 50, perception: 200 },
 *     folder: 'Tutorial NPCs/Monsters',
 *   });
 *
 *   // Create with just a level (all free points remain unallocated):
 *   await mod.createMonster({ name: 'Slime', race: 'monster', raceLevel: 10 });
 *
 *   // Create a familiar:
 *   await mod.createMonster({
 *     name: 'Lilya',
 *     race: 'monster',
 *     raceLevel: 35,
 *     type: 'familiar',
 *     stats: { vitality: 305, endurance: 205, strength: 305, dexterity: 405,
 *              toughness: 105, intelligence: 5, willpower: 55, wisdom: 56, perception: 305 },
 *   });
 */

const ABILITIES = [
  'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception',
];

/**
 * Race data — mirrors game_data.py.
 * Each race has rank_ranges with per-level stat gains.
 */
const RACES = {
  monster: {
    rank_ranges: [
      { min_level: 0, max_level: 24, stats: { free_points: 42 }, rank: 'F' },
      { min_level: 25, max_level: 99, stats: { free_points: 63 }, rank: 'E' },
    ],
  },
  human: {
    rank_ranges: [
      { min_level: 0, max_level: 9, stats: { dexterity: 1, strength: 1, vitality: 1, endurance: 1, toughness: 1, willpower: 1, wisdom: 1, intelligence: 1, perception: 1, free_points: 1 }, rank: 'G' },
      { min_level: 10, max_level: 24, stats: { dexterity: 1, strength: 1, vitality: 1, endurance: 1, toughness: 1, willpower: 1, wisdom: 1, intelligence: 1, perception: 1, free_points: 2 }, rank: 'F' },
      { min_level: 25, max_level: 99, stats: { dexterity: 2, strength: 2, vitality: 2, endurance: 2, toughness: 2, willpower: 2, wisdom: 2, intelligence: 2, perception: 2, free_points: 5 }, rank: 'E' },
      { min_level: 100, max_level: 1000, stats: { dexterity: 6, strength: 6, vitality: 6, endurance: 6, toughness: 6, willpower: 6, wisdom: 6, intelligence: 6, perception: 6, free_points: 15 }, rank: 'D' },
    ],
  },
  'half-asrai': {
    rank_ranges: [
      { min_level: 0, max_level: 9, stats: { dexterity: 2, toughness: 2, wisdom: 2, perception: 2, free_points: 2 }, rank: 'G' },
      { min_level: 10, max_level: 24, stats: { dexterity: 2, toughness: 2, wisdom: 2, perception: 2, free_points: 3 }, rank: 'F' },
      { min_level: 25, max_level: 99, stats: { dexterity: 4, toughness: 4, wisdom: 4, perception: 4, free_points: 7 }, rank: 'E' },
    ],
  },
  asrai: {
    rank_ranges: [
      { min_level: 0, max_level: 24, stats: { dexterity: 3, toughness: 2, wisdom: 2, perception: 2, vitality: 2 }, rank: 'F' },
      { min_level: 24, max_level: 99, stats: { dexterity: 5, toughness: 4, wisdom: 4, perception: 4, vitality: 4 }, rank: 'E' },
    ],
  },
  demon: {
    rank_ranges: [
      { min_level: 0, max_level: 24, stats: { strength: 2, dexterity: 2, wisdom: 2, intelligence: 2, willpower: 2, perception: 1 }, rank: 'F' },
      { min_level: 24, max_level: 99, stats: { strength: 3, dexterity: 3, wisdom: 3, intelligence: 3, willpower: 3, perception: 3, free_points: 5 }, rank: 'E' },
    ],
  },
  'juvenile astral elf': {
    rank_ranges: [
      { min_level: 25, max_level: 99, stats: { willpower: 3, perception: 3, intelligence: 3, vitality: 3, dexterity: 3, wisdom: 3, free_points: 5 }, rank: 'E' },
    ],
  },
};

/**
 * Get the rank range for a given race and level.
 */
function getRangeForLevel(race, level) {
  const raceData = RACES[race.toLowerCase()];
  if (!raceData) return null;
  for (const range of raceData.rank_ranges) {
    if (level >= range.min_level && level <= range.max_level) return range;
  }
  return null;
}

/**
 * Compute race gains from level 1 to raceLevel.
 * Returns { stats: {ability: total}, freePoints: total, rank: string }.
 */
function computeRaceGains(race, raceLevel) {
  const gains = {};
  for (const a of ABILITIES) gains[a] = 0;
  let freePoints = 0;
  let rank = 'G';

  for (let lvl = 1; lvl <= raceLevel; lvl++) {
    const range = getRangeForLevel(race, lvl);
    if (!range) continue;
    rank = range.rank;
    for (const [stat, val] of Object.entries(range.stats)) {
      if (stat === 'free_points') freePoints += val;
      else if (gains[stat] !== undefined) gains[stat] += val;
    }
  }

  return { stats: gains, freePoints, rank };
}

/**
 * Find a folder by slash-delimited path. Creates missing folders if create=true.
 */
async function resolveFolder(path, create = true) {
  if (!path) return null;
  const parts = path.split('/');
  let parent = null;

  for (const part of parts) {
    let folder = game.folders.find(f =>
      f.name === part && f.type === 'Actor' && (parent ? f.folder?.id === parent.id : !f.folder)
    );
    if (!folder && create) {
      const data = { name: part, type: 'Actor' };
      if (parent) data.folder = parent.id;
      folder = await Folder.create(data);
    }
    if (!folder) return null;
    parent = folder;
  }
  return parent;
}

/**
 * Create a monster/familiar actor.
 *
 * @param {object} opts
 * @param {string} opts.name         - Actor name (required).
 * @param {string} opts.race         - Race key from RACES (default: 'monster').
 * @param {number} opts.raceLevel    - Race level (required).
 * @param {string} [opts.type]       - Actor type: 'npc' or 'character' (default: 'npc').
 * @param {string} [opts.folder]     - Folder path, e.g. 'Tutorial NPCs/Monsters'.
 * @param {object} [opts.stats]      - Target stat values (overrides base 5 + race gains).
 *                                     Remaining free points are calculated as residual.
 * @param {string} [opts.img]        - Token/portrait image path.
 */
export async function createMonster(opts) {
  const {
    name,
    race = 'monster',
    raceLevel,
    type = 'npc',
    folder: folderPath,
    stats: targetStats,
    img,
  } = opts;

  if (!name) { ui.notifications.error('Monster name is required.'); return; }
  if (!raceLevel || raceLevel < 1) { ui.notifications.error('raceLevel must be >= 1.'); return; }

  const raceKey = race.toLowerCase();
  if (!RACES[raceKey]) {
    ui.notifications.error(`Unknown race "${race}". Available: ${Object.keys(RACES).join(', ')}`);
    return;
  }

  // Compute race gains.
  const { stats: raceGains, freePoints: totalFreePoints, rank } = computeRaceGains(raceKey, raceLevel);

  // Build ability values.
  const abilities = {};
  const BASE = 5;
  let usedFreePoints = 0;

  for (const a of ABILITIES) {
    const raceBonus = raceGains[a] ?? 0;
    if (targetStats && targetStats[a] !== undefined) {
      // User specified a target value. Difference from (base + race) is free point allocation.
      const target = targetStats[a];
      const allocated = target - BASE - raceBonus;
      usedFreePoints += Math.max(0, allocated);
      abilities[a] = { value: target };
    } else {
      // No target — just base + race gains.
      abilities[a] = { value: BASE + raceBonus };
    }
  }

  const remainingFreePoints = totalFreePoints - usedFreePoints;

  // Resolve folder.
  const folder = folderPath ? await resolveFolder(folderPath) : null;

  // Create actor data.
  const actorData = {
    name,
    type,
    img: img || 'icons/svg/mystery-man.svg',
    system: {
      abilities,
      attributes: {
        race: { level: raceLevel, name: race, rank },
        class: { level: 0, name: '', rank: 'G' },
        profession: { level: 0, name: '', rank: 'G' },
      },
      freePoints: Math.max(0, remainingFreePoints),
    },
  };

  if (folder) actorData.folder = folder.id;

  const actor = await Actor.create(actorData);

  const statSummary = ABILITIES.map(a => `${a}: ${abilities[a].value}`).join(', ');
  console.log(`Created ${name} (${race} L${raceLevel}, rank ${rank})`);
  console.log(`  Stats: ${statSummary}`);
  console.log(`  Free points: ${remainingFreePoints} remaining of ${totalFreePoints} total`);

  if (remainingFreePoints < 0) {
    ui.notifications.warn(`${name}: Stats exceed available free points by ${Math.abs(remainingFreePoints)}!`);
  } else {
    ui.notifications.info(`Created ${name} — ${race} L${raceLevel} (${remainingFreePoints} free points remaining).`);
  }

  return actor;
}

/**
 * Batch create multiple monsters from an array of definitions.
 *
 * @param {object[]} monsters - Array of opts objects (same as createMonster).
 */
export async function createMonsters(monsters) {
  const results = [];
  for (const def of monsters) {
    const actor = await createMonster(def);
    if (actor) results.push(actor);
  }
  ui.notifications.info(`Created ${results.length} monsters.`);
  return results;
}
