/**
 * Item stat derivation — extracted from the craft flow so any update to
 * a craftable item's progress / slot / material / rarity / tags can
 * recompute its derived stats automatically.
 *
 * Returns a `{statBonuses, armorBonus, veilBonus, augmentSlots,
 * durabilityMax}` object given an item-data view (item document or
 * `{system: ...}` patch). Per-stat / per-field "manual override" locks
 * live on the item as `system.lockedFields = ['armorBonus', ...]`; the
 * caller decides which derived fields to actually apply.
 */

const ABILITY_KEYS = [
  'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception',
];

/**
 * Derive an item's stat bundle from its current schema fields.
 * Mirrors the math in item.mjs `_handleCraft` so existing crafted items
 * compute identically to a freshly-crafted one with the same inputs.
 *
 * @param {Item|{system:object}} itemOrPatch
 * @returns {{statBonuses:Array<{ability:string,value:number}>, armorBonus:number, veilBonus:number, augmentSlots:number, durabilityMax:number}}
 */
export function deriveItemStats(itemOrPatch) {
  const sc = CONFIG.ASPECTSOFPOWER;
  const sys = itemOrPatch.system ?? itemOrPatch;

  const progress = sys.progress ?? 0;
  const slot     = sys.slot ?? '';
  const material = sys.material ?? '';
  const rarity   = sys.rarity ?? 'common';
  const tags     = sys.tags ?? [];

  // Resolve the most-specific craftItemType by tag overlap. This handles
  // weapons (sword vs greatsword) and shields (shield vs greatshield)
  // without relying on the original craft-time typeKey. Tag-resolution
  // rule: prefer perfect matches (all typeKey tags present in item), and
  // among perfect matches prefer the most specific (longest tag list).
  // Fall back to best partial overlap only if no perfect match exists.
  // Without this, e.g. an item tagged [weapon,1H,shield,X-affinity] would
  // tie buckler and shield at overlap=3, and iteration order would pick
  // buckler (lower armor value) over shield.
  const knownTypes = Object.entries(sc.craftItemTypes ?? {});
  let typeKey = null;
  let bestScore = 0;
  let perfectMatch = false;
  for (const [k, def] of knownTypes) {
    const tk = def.tags ?? [];
    if (tk.length === 0) continue;
    const overlap = tk.filter(t => tags.includes(t)).length;
    const isPerfect = overlap === tk.length;
    if (isPerfect) {
      // Prefer perfect matches — among them, more tags = more specific.
      if (!perfectMatch || tk.length > bestScore) {
        perfectMatch = true;
        bestScore = tk.length;
        typeKey = k;
      }
    } else if (!perfectMatch && overlap > bestScore) {
      bestScore = overlap;
      typeKey = k;
    }
  }
  const itemTypeDef = typeKey ? sc.craftItemTypes[typeKey] : null;
  const slotCategory = itemTypeDef?.category;
  const isShield = tags.includes('shield');

  // Element inferred from any *-affinity tag in the unified tags array.
  const affinityTag = tags.find(t => typeof t === 'string' && t.endsWith('-affinity'));
  const element = affinityTag ? affinityTag.replace(/-affinity$/, '') : 'neutral';
  const elementDef = sc.craftElements?.[element];

  // slotValue lookup: typeKey first (1H/2H differentiation), then slot fallback.
  const slotValue = sc.craftSlotValues?.[typeKey]
                 ?? sc.craftSlotValues?.[slot]
                 ?? 0.25;
  const matValue  = sc.craftMaterialValues?.[material] ?? 0.5;

  // ── Stat budget ──
  const totalStatBudget = Math.round(progress * slotValue * 0.25);
  const statBonuses = [];
  if (elementDef?.stats?.length >= 3 && totalStatBudget > 0) {
    const base = Math.round(totalStatBudget / 3);
    const remainder = totalStatBudget % 3;
    let s1, s2, s3;
    if (remainder === 0)      { s1 = base + 1; s2 = base; s3 = base - 1; }
    else if (remainder === 1) { s1 = base + 2; s2 = base; s3 = base - 1; }
    else                      { s1 = base + 1; s2 = base; s3 = base - 2; }
    statBonuses.push(
      { ability: elementDef.stats[0], value: Math.max(0, s1) },
      { ability: elementDef.stats[1], value: Math.max(0, s2) },
      { ability: elementDef.stats[2], value: Math.max(0, s3) },
    );
  } else if (element === 'neutral' && totalStatBudget > 0) {
    const perStat = Math.round(totalStatBudget / 9);
    for (const ab of ABILITY_KEYS) {
      if (perStat > 0) statBonuses.push({ ability: ab, value: perStat });
    }
  }

  // ── Defense routing ──
  const isArmorSlot   = slotCategory === 'armor';
  const isJewelrySlot = slotCategory === 'jewelry';
  const defenseValue  = Math.round(progress * slotValue * matValue);
  let armorBonus = isArmorSlot ? defenseValue : 0;
  let veilBonus  = isJewelrySlot ? defenseValue : 0;
  if (isShield) {
    const shieldArmorValue = sc.craftShieldArmorValues?.[typeKey] ?? 0.30;
    armorBonus = Math.round(progress * shieldArmorValue * matValue);
  }

  const rarityDef = sc.rarities?.[rarity];
  const augmentSlots = rarityDef?.augments ?? 0;

  return {
    statBonuses,
    armorBonus,
    veilBonus,
    augmentSlots,
    durabilityMax: progress * 2,
  };
}

/** Fields the derivation can touch (what the lock UI shows toggles for). */
export const DERIVABLE_FIELDS = ['statBonuses', 'armorBonus', 'veilBonus', 'augmentSlots', 'durabilityMax'];
