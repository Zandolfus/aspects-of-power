/**
 * Mass leveler — bulk-apply level gains across many actors.
 *
 * Per design-mass-level-system.md, this is the engine that powers both
 * GM bulk setup and the Phase 7 stat-squish re-level. Free points always
 * accumulate to `system.freePoints` for manual spend (per locked decision
 * in pending-stat-migration.md); never auto-allocated.
 *
 * Usage from F12 console (GM only):
 *
 *   const ML = game.aspectsofpower.massLeveler;
 *   const { rows, errors } = ML.parseCsv(`
 *     Gabriel,class,50
 *     Willy,profession,20
 *   `);
 *   console.table(await ML.preview(rows));
 *   console.table(await ML.apply(rows));
 */

const ABILITY_KEYS = [
  'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception',
];

const PATH_TAGS = ['onefold-path', 'twofold-path', 'threefold-path'];

/**
 * Apply N levels to one (actor, track), accumulating template gains and
 * crediting free points to the actor's pool. Halts at the first level that
 * crosses the assigned template's rank (class/profession) or that has no
 * gains row (race), and returns the actual count applied + the halt reason.
 *
 * @param {Actor} actor
 * @param {'class'|'profession'|'race'} track
 * @param {number} levelsToAdd
 * @returns {Promise<{applied: number, halted: boolean, reason?: string}>}
 */
export async function applyTrackLevels(actor, track, levelsToAdd) {
  if (!actor || levelsToAdd <= 0) return { applied: 0, halted: false };

  const sys = actor.system;
  const attr = sys.attributes?.[track];
  if (!attr) return { applied: 0, halted: true, reason: `no system.attributes.${track}` };

  let templateItem = null;
  if (attr.templateId) {
    try { templateItem = await fromUuid(attr.templateId); } catch (e) { /* pack unavailable */ }
  }
  if (!templateItem) return { applied: 0, halted: true, reason: `no ${track} template assigned` };

  const startLevel = attr.level ?? 0;
  const gainsAccum = Object.fromEntries(ABILITY_KEYS.map(k => [k, 0]));
  let freePointsAccum = 0;
  let appliedCount = 0;
  let haltReason = null;

  for (let i = 0; i < levelsToAdd; i++) {
    const nextLevel = startLevel + i + 1;
    const nextRank = CONFIG.ASPECTSOFPOWER.getRankForLevel(nextLevel);

    if (track === 'class' || track === 'profession') {
      const templateRank = templateItem.system.rank ?? 'G';
      if (nextRank !== templateRank) {
        haltReason = `${track} template "${templateItem.name}" is rank ${templateRank}; level ${nextLevel} needs rank ${nextRank}. Assign a new ${track} template and re-run.`;
        break;
      }
      const gains = templateItem.system.gains ?? {};
      for (const k of ABILITY_KEYS) gainsAccum[k] += gains[k] ?? 0;
      freePointsAccum += templateItem.system.freePointsPerLevel ?? 0;
    } else {
      // Race: per-rank gains in a single template.
      const rankGains = templateItem.system.rankGains?.[nextRank];
      if (!rankGains) {
        haltReason = `race template "${templateItem.name}" has no rankGains for rank ${nextRank}.`;
        break;
      }
      for (const k of ABILITY_KEYS) gainsAccum[k] += rankGains[k] ?? 0;
      freePointsAccum += templateItem.system.freePointsPerLevel?.[nextRank] ?? 0;
    }
    appliedCount++;
  }

  if (appliedCount > 0) {
    const updates = { [`system.attributes.${track}.level`]: startLevel + appliedCount };
    for (const k of ABILITY_KEYS) {
      if (gainsAccum[k] !== 0) {
        const cur = actor._source.system.abilities[k].value;
        updates[`system.abilities.${k}.value`] = cur + gainsAccum[k];
      }
    }
    if (freePointsAccum > 0) {
      updates['system.freePoints'] = (sys.freePoints ?? 0) + freePointsAccum;
    }
    await actor.update(updates);
  }

  return { applied: appliedCount, halted: !!haltReason, reason: haltReason ?? undefined };
}

/**
 * Read the path-type tag from a race template ('onefold-path' | 'twofold-path' | 'threefold-path').
 * Defaults to threefold-path (matches the new-race default and the 2.3.0 backfill).
 */
function _getRacePathType(raceTemplate) {
  const tags = (raceTemplate.system.systemTags ?? []).map(t => t.id);
  for (const p of PATH_TAGS) if (tags.includes(p)) return p;
  return 'threefold-path';
}

/**
 * Apply derived race level gains for an actor, based on its race's path-type tag
 * and the change in (class.level + profession.level) since the snapshot.
 *
 * Per design-mass-level-system.md:
 *   onefold-path : skipped (race driven directly by CSV row instead)
 *   twofold-path : raceDelta = newCombined - oldCombined  (1:1)
 *   threefold-path: raceDelta = floor(new/2) - floor(old/2)  (odd remainders carry)
 */
export async function applyDerivedRaceLevels(actor, prevClassLvl, prevProfLvl) {
  const raceAttr = actor.system.attributes?.race;
  if (!raceAttr?.templateId) return { applied: 0, halted: false };

  let raceTemplate;
  try { raceTemplate = await fromUuid(raceAttr.templateId); } catch (e) { return { applied: 0, halted: true, reason: 'race template unavailable' }; }
  if (!raceTemplate) return { applied: 0, halted: false };

  const pathType = _getRacePathType(raceTemplate);
  if (pathType === 'onefold-path') return { applied: 0, halted: false }; // driven by explicit CSV row instead

  const newClassLvl = actor.system.attributes.class?.level ?? 0;
  const newProfLvl  = actor.system.attributes.profession?.level ?? 0;
  const oldCombined = prevClassLvl + prevProfLvl;
  const newCombined = newClassLvl + newProfLvl;

  const raceDelta = pathType === 'twofold-path'
    ? (newCombined - oldCombined)
    : (Math.floor(newCombined / 2) - Math.floor(oldCombined / 2));

  if (raceDelta <= 0) return { applied: 0, halted: false };
  return await applyTrackLevels(actor, 'race', raceDelta);
}

/**
 * Parse CSV input into typed rows. Format: "Actor Name,Track,TargetLevel" per line.
 * Lines starting with # and blank lines are ignored. Header rows (e.g.
 * "Actor,Track,TargetLevel") are auto-detected and skipped.
 *
 * @param {string} csv
 * @returns {{rows: Array<{actor: Actor, track: string, targetLevel: number}>, errors: Array<{line: number, error: string}>}}
 */
export function parseCsv(csv) {
  const rows = [];
  const errors = [];
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const [i, line] of lines.entries()) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length !== 3) {
      errors.push({ line: i + 1, error: `expected 3 columns, got ${parts.length}` });
      continue;
    }
    const [actorName, trackRaw, targetLevelRaw] = parts;
    // Skip header row.
    if (i === 0 && trackRaw.toLowerCase() === 'track') continue;
    const track = trackRaw.toLowerCase();
    if (!['class', 'profession', 'race'].includes(track)) {
      errors.push({ line: i + 1, error: `invalid track "${trackRaw}" (expected class, profession, or race)` });
      continue;
    }
    const targetLevel = parseInt(targetLevelRaw, 10);
    if (!Number.isFinite(targetLevel) || targetLevel < 0) {
      errors.push({ line: i + 1, error: `invalid level "${targetLevelRaw}"` });
      continue;
    }
    const actor = game.actors.getName(actorName);
    if (!actor) {
      errors.push({ line: i + 1, error: `actor "${actorName}" not found` });
      continue;
    }
    rows.push({ actor, track, targetLevel });
  }
  return { rows, errors };
}

/**
 * Dry-run preview — returns what apply() would do without mutating any actor.
 * Useful for sanity-checking a CSV before committing.
 *
 * @param {Array<{actor: Actor, track: string, targetLevel: number}>} rows
 * @returns {Promise<Array<{actor: string, track: string, currentLevel: number, targetLevel: number, delta: number, note?: string}>>}
 */
export async function preview(rows) {
  const out = [];
  for (const row of rows) {
    const cur = row.actor.system.attributes?.[row.track]?.level ?? 0;
    const delta = row.targetLevel - cur;
    let note = '';
    if (delta < 0) note = 'target below current — no change';
    else if (delta === 0) note = 'already at target';
    out.push({ actor: row.actor.name, track: row.track, currentLevel: cur, targetLevel: row.targetLevel, delta, note });
  }
  return out;
}

/**
 * Apply the rows. Class/profession/explicit-race rows applied first, then
 * race-derived gains (per path-type tag) for any actor without an explicit
 * race row. Each row returns its own per-track result; race-derived results
 * are appended with track 'race-derived'.
 *
 * @param {Array<{actor: Actor, track: string, targetLevel: number}>} rows
 * @returns {Promise<Array<{actor: string, track: string, applied: number, halted: boolean, reason?: string, note?: string}>>}
 */
export async function apply(rows) {
  // Snapshot pre-state per actor so derived race math uses the right baseline.
  const preState = new Map();
  for (const row of rows) {
    if (!preState.has(row.actor)) {
      preState.set(row.actor, {
        class: row.actor.system.attributes?.class?.level ?? 0,
        profession: row.actor.system.attributes?.profession?.level ?? 0,
      });
    }
  }

  const results = [];

  // Pass 1: explicit rows (class, profession, race).
  for (const row of rows) {
    const cur = row.actor.system.attributes?.[row.track]?.level ?? 0;
    const delta = row.targetLevel - cur;
    if (delta <= 0) {
      results.push({ actor: row.actor.name, track: row.track, applied: 0, halted: false, note: delta < 0 ? 'target below current' : 'already at target' });
      continue;
    }
    const r = await applyTrackLevels(row.actor, row.track, delta);
    results.push({ actor: row.actor.name, track: row.track, ...r });
  }

  // Pass 2: derived race gains for actors that didn't get an explicit race row.
  const explicitRaceActors = new Set(rows.filter(r => r.track === 'race').map(r => r.actor));
  for (const [actor, pre] of preState) {
    if (explicitRaceActors.has(actor)) continue;
    const r = await applyDerivedRaceLevels(actor, pre.class, pre.profession);
    if (r.applied > 0 || r.halted) {
      results.push({ actor: actor.name, track: 'race-derived', ...r });
    }
  }

  return results;
}
