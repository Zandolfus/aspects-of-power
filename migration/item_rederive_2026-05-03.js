// Item re-derive migration — paste into the F12 console.
//
// Re-runs `deriveItemStats()` against every equipment item (type='item')
// in the world and on every actor, and writes back the new statBonuses /
// armorBonus / veilBonus / augmentSlots / durability.max. Fields listed
// in each item's `system.lockedFields` are preserved (manual overrides
// survive). Items missing the inputs derivation needs (no progress, no
// slot) are skipped and reported.
//
// Equipped items get their ActiveEffects auto-refreshed via the existing
// updateItem → EquipmentSystem._syncEffects chain.
//
// Compendium items are NOT touched in this pass (handle separately if
// you want to migrate authored compendium templates too).
//
// Augments are excluded — `type === 'item'` only, not `type === 'augment'`.
//
// Usage:
//   const m = (PASTE-THE-FUNCTION)();
//   m.preview();           // dry-run table + summary
//   m.snapshot();          // download baseline JSON before applying
//   await m.apply();       // commits with { diff: false }
//   m.verify();            // re-derive and confirm match

() => {
  // ── Inline copy of deriveItemStats from module/systems/item-derivation.mjs ──
  // Kept identical so a console paste is fully self-contained. If the live
  // derivation function changes, update this copy before running.
  const ABILITY_KEYS = [
    'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
    'intelligence', 'willpower', 'wisdom', 'perception',
  ];

  function derive(itemOrPatch) {
    const sc = CONFIG.ASPECTSOFPOWER;
    const sys = itemOrPatch.system ?? itemOrPatch;
    const progress = sys.progress ?? 0;
    const slot     = sys.slot ?? '';
    const material = sys.material ?? '';
    const rarity   = sys.rarity ?? 'common';
    const tags     = sys.tags ?? [];

    const knownTypes = Object.entries(sc.craftItemTypes ?? {});
    let typeKey = null;
    let bestScore = 0;
    for (const [k, def] of knownTypes) {
      const overlap = (def.tags ?? []).filter(t => tags.includes(t)).length;
      if (overlap > bestScore) { bestScore = overlap; typeKey = k; }
    }
    const itemTypeDef = typeKey ? sc.craftItemTypes[typeKey] : null;
    const slotCategory = itemTypeDef?.category;
    const isShield = tags.includes('shield');

    const affinityTag = tags.find(t => typeof t === 'string' && t.endsWith('-affinity'));
    const element = affinityTag ? affinityTag.replace(/-affinity$/, '') : 'neutral';
    const elementDef = sc.craftElements?.[element];

    const slotValue = sc.craftSlotValues?.[typeKey]
                   ?? sc.craftSlotValues?.[slot]
                   ?? 0.25;
    const matValue  = sc.craftMaterialValues?.[material] ?? 0.5;

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

  function* allItems() {
    for (const a of game.actors) {
      for (const i of a.items) {
        if (i.type === 'item') yield { actor: a, item: i };
      }
    }
    for (const i of game.items) {
      if (i.type === 'item') yield { actor: null, item: i };
    }
  }

  /** Stable string of statBonuses for comparison. */
  function statBonusKey(arr) {
    return (arr ?? [])
      .filter(b => b?.ability && b.value)
      .map(b => `${b.ability}:${b.value}`)
      .sort()
      .join('|');
  }

  /**
   * Compute the diff between current source values and freshly-derived ones,
   * masked by lockedFields. Returns null if nothing would change.
   */
  function computeDiff(item) {
    const src = item._source.system;
    const progress = src.progress ?? 0;
    const slot = src.slot ?? '';

    if (progress === 0) return { skip: 'no-progress' };
    if (!slot) return { skip: 'no-slot' };

    const derived = derive({ system: src });
    const locked = new Set(src.lockedFields ?? []);

    const changes = {};
    const before = {};
    const after = {};

    if (!locked.has('statBonuses')) {
      const oldKey = statBonusKey(src.statBonuses);
      const newKey = statBonusKey(derived.statBonuses);
      if (oldKey !== newKey) {
        changes.statBonuses = derived.statBonuses;
        before.statBonuses = src.statBonuses ?? [];
        after.statBonuses = derived.statBonuses;
      }
    }
    if (!locked.has('armorBonus')) {
      const cur = src.armorBonus ?? 0;
      if (cur !== derived.armorBonus) {
        changes.armorBonus = derived.armorBonus;
        before.armorBonus = cur;
        after.armorBonus = derived.armorBonus;
      }
    }
    if (!locked.has('veilBonus')) {
      const cur = src.veilBonus ?? 0;
      if (cur !== derived.veilBonus) {
        changes.veilBonus = derived.veilBonus;
        before.veilBonus = cur;
        after.veilBonus = derived.veilBonus;
      }
    }
    if (!locked.has('augmentSlots')) {
      const cur = src.augmentSlots ?? 0;
      if (cur !== derived.augmentSlots) {
        changes.augmentSlots = derived.augmentSlots;
        before.augmentSlots = cur;
        after.augmentSlots = derived.augmentSlots;
      }
    }
    if (!locked.has('durabilityMax')) {
      const curMax = src.durability?.max ?? 0;
      if (curMax !== derived.durabilityMax) {
        const curVal = src.durability?.value ?? 0;
        changes.durability = { max: derived.durabilityMax };
        // Clamp value to new max only if it would exceed.
        if (curVal > derived.durabilityMax) changes.durability.value = derived.durabilityMax;
        before.durabilityMax = curMax;
        after.durabilityMax = derived.durabilityMax;
      }
    }

    if (Object.keys(changes).length === 0) return null;
    return { changes, before, after, locked: [...locked] };
  }

  return {
    derive,

    preview() {
      const rows = [];
      const summary = { total: 0, changed: 0, unchanged: 0, skipped: {}, equipped: 0 };
      for (const { actor, item } of allItems()) {
        summary.total++;
        const d = computeDiff(item);
        if (!d) { summary.unchanged++; continue; }
        if (d.skip) {
          summary.skipped[d.skip] = (summary.skipped[d.skip] ?? 0) + 1;
          continue;
        }
        summary.changed++;
        if (item.system.equipped) summary.equipped++;
        rows.push({
          actor: actor?.name ?? '(world)',
          item: item.name,
          slot: item._source.system.slot,
          progress: item._source.system.progress,
          rarity: item._source.system.rarity,
          equipped: item.system.equipped ? 'Y' : '',
          locked: d.locked.join(',') || '—',
          stats: `${statBonusKey(d.before.statBonuses) || '—'} → ${statBonusKey(d.after.statBonuses) || '—'}`,
          armor: d.before.armorBonus !== undefined ? `${d.before.armorBonus}→${d.after.armorBonus}` : '—',
          veil:  d.before.veilBonus  !== undefined ? `${d.before.veilBonus}→${d.after.veilBonus}`   : '—',
          augSl: d.before.augmentSlots !== undefined ? `${d.before.augmentSlots}→${d.after.augmentSlots}` : '—',
          durMax: d.before.durabilityMax !== undefined ? `${d.before.durabilityMax}→${d.after.durabilityMax}` : '—',
        });
      }
      console.table(rows);
      console.log('Summary:', summary);
      return { summary, rows };
    },

    /** Download a JSON snapshot of every touched item's pre-migration state. */
    snapshot() {
      const baseline = [];
      for (const { actor, item } of allItems()) {
        const d = computeDiff(item);
        if (!d || d.skip) continue;
        const src = item._source.system;
        baseline.push({
          actorId: actor?.id ?? null,
          actorName: actor?.name ?? null,
          itemId: item.id,
          itemName: item.name,
          slot: src.slot,
          progress: src.progress,
          rarity: src.rarity,
          material: src.material,
          tags: [...(src.tags ?? [])],
          equipped: item.system.equipped ?? false,
          before: {
            statBonuses: src.statBonuses ?? [],
            armorBonus: src.armorBonus ?? 0,
            veilBonus: src.veilBonus ?? 0,
            augmentSlots: src.augmentSlots ?? 0,
            durability: { max: src.durability?.max ?? 0, value: src.durability?.value ?? 0 },
          },
          lockedFields: [...(src.lockedFields ?? [])],
        });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `item_rederive_baseline_${stamp}.json`;
      saveDataToFile(JSON.stringify(baseline, null, 2), 'application/json', filename);
      console.log(`Snapshot: ${baseline.length} items captured → ${filename}`);
      return baseline;
    },

    async apply() {
      let updated = 0, skipped = 0, equippedSynced = 0;
      const skipReasons = {};
      const errors = [];
      for (const { actor, item } of allItems()) {
        try {
          const d = computeDiff(item);
          if (!d) { skipped++; continue; }
          if (d.skip) {
            skipReasons[d.skip] = (skipReasons[d.skip] ?? 0) + 1;
            skipped++;
            continue;
          }
          // Build dot-notation update so nested durability merges cleanly.
          const upd = {};
          if (d.changes.statBonuses !== undefined) upd['system.statBonuses'] = d.changes.statBonuses;
          if (d.changes.armorBonus  !== undefined) upd['system.armorBonus']  = d.changes.armorBonus;
          if (d.changes.veilBonus   !== undefined) upd['system.veilBonus']   = d.changes.veilBonus;
          if (d.changes.augmentSlots !== undefined) upd['system.augmentSlots'] = d.changes.augmentSlots;
          if (d.changes.durability) {
            if (d.changes.durability.max   !== undefined) upd['system.durability.max']   = d.changes.durability.max;
            if (d.changes.durability.value !== undefined) upd['system.durability.value'] = d.changes.durability.value;
          }
          // skipAutoDerive: we already computed the derived values; no need
          // to re-run preUpdateItem and risk clobbering our explicit updates.
          // diff:false: dodges the silent array-update skip we hit during the
          // magic-tag backfill.
          await item.update(upd, { diff: false, skipAutoDerive: true });
          updated++;
          if (item.system.equipped) equippedSynced++;
        } catch (e) {
          errors.push({ actor: actor?.name, item: item.name, error: String(e) });
        }
      }
      console.log(`Item re-derive: ${updated} updated (${equippedSynced} equipped → AE refreshed), ${skipped} skipped, ${errors.length} errors`);
      if (Object.keys(skipReasons).length) console.log('Skip reasons:', skipReasons);
      if (errors.length) console.warn('Errors:', errors);
      return { updated, skipped, equippedSynced, errors, skipReasons };
    },

    verify() {
      const issues = [];
      for (const { actor, item } of allItems()) {
        const d = computeDiff(item);
        if (!d || d.skip) continue;
        // After apply, computeDiff should return null for everything that
        // got migrated. Anything still showing changes is an issue.
        issues.push({
          actor: actor?.name ?? '(world)',
          item: item.name,
          remaining: Object.keys(d.changes ?? {}).join(','),
        });
      }
      console.log(`Verification: ${issues.length} issues`);
      if (issues.length) console.table(issues);
      return issues;
    },
  };
}
