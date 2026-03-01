/**
 * Export actors from a folder to CSV matching the all_chars_migrated.csv template.
 *
 * Usage (Foundry console):
 *   const mod = await import('/systems/aspects-of-power/scripts/export-actors-csv.mjs');
 *   await mod.exportFolder('Tutorial NPCs/Humans');
 *
 * Or specify a custom folder path:
 *   await mod.exportFolder('My Folder/Subfolder');
 */

const ABILITIES = [
  'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception',
];

const HEADERS = [
  'Name', 'Class', 'Class level', 'Race', 'Profession', 'Profession level',
  'Character Type', 'Race level', 'Race rank',
  'tier_thresholds', 'class_history', 'profession_history', 'race_history',
  'is_manual_character', 'manual_base_stats', 'manual_current_stats',
  'validation_status', 'creation_history',
  // Current values.
  ...ABILITIES,
  // Modifiers.
  ...ABILITIES.map(a => `${a}_modifier`),
  // Base (starting value, usually 5).
  ...ABILITIES.map(a => `${a}_base`),
  // Class gains.
  ...ABILITIES.map(a => `${a}_class`),
  // Profession gains.
  ...ABILITIES.map(a => `${a}_profession`),
  // Race gains.
  ...ABILITIES.map(a => `${a}_race`),
  // Item/equipment gains.
  ...ABILITIES.map(a => `${a}_item`),
  // Blessing gains.
  ...ABILITIES.map(a => `${a}_blessing`),
  // Free point allocation.
  ...ABILITIES.map(a => `${a}_free_points`),
  'free_points',
];

/**
 * Find a folder by path (e.g. "Tutorial NPCs/Humans").
 */
function findFolder(path) {
  const parts = path.split('/');
  let folder = null;
  for (const part of parts) {
    folder = game.folders.find(f =>
      f.name === part && f.type === 'Actor' && (folder ? f.folder?.id === folder.id : !f.folder)
    );
    if (!folder) return null;
  }
  return folder;
}

/**
 * Get all actors in a folder (non-recursive).
 */
function getActorsInFolder(folder) {
  return game.actors.filter(a => a.folder?.id === folder.id);
}

/**
 * Compute per-ability gains from a template item and a level.
 * Handles both single-rank items (class/profession with `gains`)
 * and multi-rank items (race with `rankGains`).
 */
function computeTemplateGains(templateItem, level) {
  const gains = {};
  for (const a of ABILITIES) gains[a] = 0;
  if (!templateItem || level <= 0) return gains;

  const sys = templateItem.system;

  // Multi-rank template (race): rankGains keyed by tier letter.
  if (sys.rankGains) {
    const tiers = CONFIG.ASPECTSOFPOWER.rankTiers;
    for (let lvl = 1; lvl <= level; lvl++) {
      const rank = CONFIG.ASPECTSOFPOWER.getRankForLevel(lvl);
      const tierGains = sys.rankGains?.[rank];
      if (!tierGains) continue;
      for (const a of ABILITIES) {
        gains[a] += tierGains[a] ?? 0;
      }
    }
    return gains;
  }

  // Single-rank template (class/profession): flat gains per level.
  if (sys.gains) {
    for (const a of ABILITIES) {
      gains[a] = (sys.gains[a] ?? 0) * level;
    }
    return gains;
  }

  return gains;
}

/**
 * Build one CSV row for an actor.
 */
function buildRow(actor) {
  const sys = actor.system;
  const attrs = sys.attributes;

  // Resolve template items for class/race/profession.
  const classTemplate = attrs.class.templateId ? actor.items.get(attrs.class.templateId) : null;
  const raceTemplate = attrs.race.templateId ? actor.items.get(attrs.race.templateId) : null;
  const profTemplate = attrs.profession.templateId ? actor.items.get(attrs.profession.templateId) : null;

  const classGains = computeTemplateGains(classTemplate, attrs.class.level);
  const raceGains = computeTemplateGains(raceTemplate, attrs.race.level);
  const profGains = computeTemplateGains(profTemplate, attrs.profession.level);

  // Build history arrays (single entry each since we only know current).
  const classHistory = classTemplate
    ? JSON.stringify([{ class: attrs.class.name, from_level: 1, to_level: null }])
    : '[]';
  const profHistory = profTemplate
    ? JSON.stringify([{ profession: attrs.profession.name, from_level: 1, to_level: null }])
    : '[]';
  const raceHistory = JSON.stringify([{ race: attrs.race.name, from_race_level: 1, to_race_level: null }]);

  const row = {};
  row['Name'] = actor.name;
  row['Class'] = attrs.class.name ?? '';
  row['Class level'] = attrs.class.level ?? 0;
  row['Race'] = attrs.race.name ?? '';
  row['Profession'] = attrs.profession.name ?? '';
  row['Profession level'] = attrs.profession.level ?? 0;
  row['Character Type'] = actor.type;
  row['Race level'] = attrs.race.level ?? 0;
  row['Race rank'] = attrs.race.rank ?? 'G';
  row['tier_thresholds'] = '"[25, 100, 200]"';
  row['class_history'] = `"${classHistory.replace(/"/g, '""')}"`;
  row['profession_history'] = `"${profHistory.replace(/"/g, '""')}"`;
  row['race_history'] = `"${raceHistory.replace(/"/g, '""')}"`;
  row['is_manual_character'] = 'FALSE';
  row['manual_base_stats'] = '{}';
  row['manual_current_stats'] = '{}';
  row['validation_status'] = 'exported';
  row['creation_history'] = '{}';

  // Ability values, modifiers, breakdowns.
  let totalFreePoints = 0;
  for (const a of ABILITIES) {
    const ability = sys.abilities[a];
    const bd = ability.breakdown ?? {};
    const base = 5; // Starting base value.

    // Equipment: use raw (uncapped) to match the CSV format.
    const equipRaw = bd.equipmentBonusRaw ?? 0;
    const blessing = (bd.blessingAdd ?? 0);

    // Free points = source value - base - class - profession - race gains.
    const sourceValue = actor._source?.system?.abilities?.[a]?.value ?? ability.value;
    const freePoints = sourceValue - base - (classGains[a] ?? 0) - (profGains[a] ?? 0) - (raceGains[a] ?? 0);

    row[a] = bd.final ?? ability.value;
    row[`${a}_modifier`] = ability.mod ?? 0;
    row[`${a}_base`] = base;
    row[`${a}_class`] = classGains[a] ?? 0;
    row[`${a}_profession`] = profGains[a] ?? 0;
    row[`${a}_race`] = raceGains[a] ?? 0;
    row[`${a}_item`] = equipRaw;
    row[`${a}_blessing`] = blessing;
    row[`${a}_free_points`] = freePoints;
    totalFreePoints += freePoints;
  }
  row['free_points'] = sys.freePoints ?? totalFreePoints;

  return row;
}

/**
 * Escape a CSV field value.
 */
function csvEscape(val) {
  if (val === undefined || val === null) return '';
  const str = String(val);
  // Already manually quoted (JSON fields).
  if (str.startsWith('"') && str.endsWith('"')) return str;
  // Needs quoting if contains comma, quote, or newline.
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Main export function.
 * @param {string} folderPath  Slash-delimited folder path, e.g. "Tutorial NPCs/Humans".
 */
export async function exportFolder(folderPath) {
  const folder = findFolder(folderPath);
  if (!folder) {
    ui.notifications.error(`Folder "${folderPath}" not found.`);
    return;
  }

  const actors = getActorsInFolder(folder);
  if (actors.length === 0) {
    ui.notifications.warn(`No actors found in "${folderPath}".`);
    return;
  }

  const rows = actors.map(a => buildRow(a));

  // Build CSV string.
  const lines = [HEADERS.join(',')];
  for (const row of rows) {
    const line = HEADERS.map(h => csvEscape(row[h])).join(',');
    lines.push(line);
  }
  const csv = lines.join('\n');

  // Trigger download.
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderPath.replace(/\//g, '_')}_export.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  ui.notifications.info(`Exported ${rows.length} actors from "${folderPath}" to CSV.`);
  console.log(`CSV export complete: ${rows.length} actors.`);
}
