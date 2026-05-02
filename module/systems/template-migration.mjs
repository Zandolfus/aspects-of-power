/**
 * Template migration — bring class/profession compendium templates onto
 * the new stat-squish totals (per locked decision 2026-05-02, Option C).
 *
 *   G-rank: unchanged (already total 8 ✓)
 *   E-rank: total 18 → 12
 *     - Specialist  (5,4,3,2)+4FP → (4,3,2,1)+2FP
 *     - Pure-free      0    +18FP →    0     +12FP
 *     - Anything else (Augur, Crusher, anomalies) → flagged, NOT auto-migrated
 *
 * Console usage from F12 (GM only):
 *
 *   const TM = game.aspectsofpower.templateMigration;
 *   console.table(await TM.previewE());   // dry run
 *   console.table(await TM.applyE());     // commit
 *
 * Future ranks (F, D, C, B, A, S) are not yet authored anywhere, so this
 * script only touches G and E. New templates at higher ranks should be
 * authored against the new totals (8 + 4×(rankIdx) capped at min 8).
 */

const ABILITY_KEYS = [
  'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception',
];

const E_SPECIALIST_OLD_SHAPE = [5, 4, 3, 2];
const E_SPECIALIST_OLD_FP    = 4;
const E_SPECIALIST_NEW_SHAPE = [4, 3, 2, 1];
const E_SPECIALIST_NEW_FP    = 2;

const E_PUREFREE_OLD_FP = 18;
const E_PUREFREE_NEW_FP = 12;

/* -------------------------------------------------- */
/*  Classification                                    */
/* -------------------------------------------------- */

/**
 * Sort non-zero gains descending and return the resulting array.
 * E.g. {str:4, dex:5, vit:3, wil:2} → [5, 4, 3, 2]
 */
function _gainShape(gains) {
  return ABILITY_KEYS
    .map(k => gains[k] ?? 0)
    .filter(v => v > 0)
    .sort((a, b) => b - a);
}

function _shapeEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Classify an E-rank template against the migration rules.
 * Returns { kind, reason? } where kind is one of:
 *   'specialist' | 'pureFree' | 'outlier' | 'skip'
 */
function _classify(template) {
  if (template.system.rank !== 'E') return { kind: 'skip', reason: 'not E rank' };
  const shape = _gainShape(template.system.gains ?? {});
  const fp = template.system.freePointsPerLevel ?? 0;

  if (_shapeEquals(shape, E_SPECIALIST_OLD_SHAPE) && fp === E_SPECIALIST_OLD_FP) {
    return { kind: 'specialist' };
  }
  if (shape.length === 0 && fp === E_PUREFREE_OLD_FP) {
    return { kind: 'pureFree' };
  }
  return { kind: 'outlier', reason: `shape=[${shape.join(',')}] fp=${fp}` };
}

/* -------------------------------------------------- */
/*  Migration                                         */
/* -------------------------------------------------- */

/**
 * Map specialist (5,4,3,2) to (4,3,2,1) preserving which stat held which rank.
 * E.g. Bloodmage int=5, wis=4, vit=3, wil=2 → int=4, wis=3, vit=2, wil=1.
 */
function _migrateSpecialist(template) {
  const oldGains = template.system.gains ?? {};
  const ranked = ABILITY_KEYS
    .map(k => ({ key: k, val: oldGains[k] ?? 0 }))
    .filter(e => e.val > 0)
    .sort((a, b) => b.val - a.val);
  const newGains = Object.fromEntries(ABILITY_KEYS.map(k => [k, 0]));
  for (let i = 0; i < ranked.length && i < E_SPECIALIST_NEW_SHAPE.length; i++) {
    newGains[ranked[i].key] = E_SPECIALIST_NEW_SHAPE[i];
  }
  return { gains: newGains, freePointsPerLevel: E_SPECIALIST_NEW_FP };
}

/**
 * Yield every class/profession template in compendium packs.
 */
async function* _iterTemplates() {
  for (const pack of game.packs) {
    if (pack.metadata.type !== 'Item') continue;
    const idx = await pack.getIndex();
    for (const entry of idx) {
      if (!['class', 'profession'].includes(entry.type)) continue;
      const doc = await pack.getDocument(entry._id);
      yield { doc, packLabel: pack.metadata.label };
    }
  }
}

/* -------------------------------------------------- */
/*  Public API                                        */
/* -------------------------------------------------- */

/**
 * Dry-run: classify every E-rank template and show the proposed change.
 * Returns an array of { name, type, pack, kind, before, after, reason? }.
 */
export async function previewE() {
  const rows = [];
  for await (const { doc, packLabel } of _iterTemplates()) {
    const cls = _classify(doc);
    if (cls.kind === 'skip') continue;
    const row = {
      name: doc.name,
      type: doc.type,
      pack: packLabel,
      kind: cls.kind,
      beforeShape: _gainShape(doc.system.gains ?? {}).join(','),
      beforeFp: doc.system.freePointsPerLevel,
      afterShape: '(unchanged)',
      afterFp: doc.system.freePointsPerLevel,
    };
    if (cls.kind === 'specialist') {
      const m = _migrateSpecialist(doc);
      row.afterShape = _gainShape(m.gains).join(',');
      row.afterFp = m.freePointsPerLevel;
    } else if (cls.kind === 'pureFree') {
      row.afterShape = '(none)';
      row.afterFp = E_PUREFREE_NEW_FP;
    } else {
      row.reason = cls.reason;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Apply: classify and update every auto-migratable E template.
 * Outliers are skipped and reported. Returns per-row { name, kind, action, reason? }.
 */
export async function applyE() {
  const rows = [];
  for await (const { doc, packLabel } of _iterTemplates()) {
    const cls = _classify(doc);
    if (cls.kind === 'skip') continue;

    if (cls.kind === 'outlier') {
      rows.push({ name: doc.name, type: doc.type, pack: packLabel, kind: 'outlier', action: 'skipped', reason: cls.reason });
      continue;
    }

    let update;
    if (cls.kind === 'specialist') {
      const m = _migrateSpecialist(doc);
      update = { 'system.gains': m.gains, 'system.freePointsPerLevel': m.freePointsPerLevel };
    } else if (cls.kind === 'pureFree') {
      update = { 'system.freePointsPerLevel': E_PUREFREE_NEW_FP };
    }

    try {
      await doc.update(update);
      rows.push({ name: doc.name, type: doc.type, pack: packLabel, kind: cls.kind, action: 'applied' });
    } catch (e) {
      rows.push({ name: doc.name, type: doc.type, pack: packLabel, kind: cls.kind, action: 'failed', reason: e.message });
    }
  }
  return rows;
}
