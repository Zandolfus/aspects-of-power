/**
 * Template snapshot — dump every class/profession/race compendium template's
 * gain/free-point state. Companion to snapshot_script.js (which dumps actor
 * state). Run before any template-mutating migration so the prior values are
 * recoverable.
 *
 * Usage in F12 console:
 *   const data = await (PASTE THIS WHOLE FUNCTION)();
 *   copy(JSON.stringify(data, null, 2));   // copy to clipboard, paste into file
 *
 * Output file convention:
 *   migration/snapshots/templates_<label>_<date>.json
 */
async () => {
  const out = [];
  for (const pack of game.packs) {
    if (pack.metadata.type !== 'Item') continue;
    const idx = await pack.getIndex();
    for (const e of idx) {
      if (!['class', 'profession', 'race'].includes(e.type)) continue;
      const doc = await pack.getDocument(e._id);
      const sys = doc.system;
      const row = {
        uuid: doc.uuid,
        name: doc.name,
        type: doc.type,
        pack: pack.metadata.label,
      };
      if (doc.type === 'race') {
        row.rankGains = sys.rankGains ?? {};
        row.freePointsPerLevel = sys.freePointsPerLevel ?? {};
      } else {
        row.rank = sys.rank;
        row.gains = sys.gains ?? {};
        row.freePointsPerLevel = sys.freePointsPerLevel ?? 0;
      }
      out.push(row);
    }
  }
  return {
    timestamp: new Date().toISOString(),
    foundryVersion: game.version,
    systemVersion: game.system.version,
    worldTitle: game.world.title,
    templateCount: out.length,
    templates: out,
  };
}
