/**
 * Jewelry rebalance migration — 2026-06-11
 * Companion to commits: bracelet slotValue 0.25 + ring division.
 *
 * Run in the Foundry console as GM (or via playwright eval) AFTER the
 * server has the new code. Paste the whole file, then call:
 *
 *   await jewelryMigration.audit()          — read-only: bracelet preview,
 *                                             ring inventory, armor/veil
 *                                             augment double-count exposure
 *   await jewelryMigration.applyBracelets() — re-derive all bracelets
 *   await jewelryMigration.applyRings()     — re-sync equipped rings so the
 *                                             division takes effect
 *
 * Order: audit → review output → applyBracelets → applyRings.
 */
window.jewelryMigration = (() => {
  const MOD = '/systems/aspects-of-power/module';

  async function libs() {
    const { deriveItemStats } = await import(`${MOD}/systems/item-derivation.mjs`);
    const { EquipmentSystem } = await import(`${MOD}/systems/equipment.mjs`);
    return { deriveItemStats, EquipmentSystem };
  }

  // Every item document in world + actor inventories matching a predicate.
  function* allItems(pred) {
    for (const i of game.items) if (i.type === 'item' && pred(i)) yield { item: i, owner: null };
    for (const a of game.actors)
      for (const i of a.items) if (i.type === 'item' && pred(i)) yield { item: i, owner: a };
  }

  async function audit() {
    const { deriveItemStats } = await libs();
    const out = { bracelets: [], rings: [], doubleCount: [] };

    // 1. Bracelet preview: stored vs re-derived under the new 0.25 slotValue.
    for (const { item, owner } of allItems(i => i.system.slot === 'bracelet')) {
      const locked = new Set(item.system.lockedFields ?? []);
      const d = deriveItemStats(item);
      out.bracelets.push({
        name: item.name, owner: owner?.name ?? '(world)',
        equipped: !!item.system.equipped,
        veil: `${item.system.veilBonus} → ${locked.has('veilBonus') ? 'LOCKED' : d.veilBonus}`,
        stats: `${(item.system.statBonuses ?? []).map(b => `${b.ability}:${b.value}`).join(' ')} → ` +
               (locked.has('statBonuses') ? 'LOCKED' : (d.statBonuses ?? []).map(b => `${b.ability}:${b.value}`).join(' ')),
      });
    }

    // 2. Ring inventory: who wears how many (the division divisor per actor).
    for (const a of game.actors) {
      const rings = a.items.filter(i => i.type === 'item' && i.system.equipped && i.system.slot === 'ring');
      if (rings.length > 0) out.rings.push({ actor: a.name, count: rings.length, rings: rings.map(r => r.name) });
    }

    // 3. Armor/veil augment double-count exposure (pre-existing bug, NOT
    //    fixed by this migration — informational). Stored value vs
    //    augment-stripped derivation on items carrying armor/veil augments.
    for (const { item, owner } of allItems(i => i.system.equipped)) {
      const augs = [...(item.system.augments ?? []), ...(item.system.profAugments ?? [])];
      const hasAVaug = augs.some(a => (a?.itemBonuses ?? []).some(b => b.field === 'armorBonus' || b.field === 'veilBonus'));
      if (!hasAVaug) continue;
      const pure = deriveItemStats({ system: { ...item.system, augments: [], profAugments: [] } });
      const dArmor = (item.system.armorBonus ?? 0) - (pure.armorBonus ?? 0);
      const dVeil  = (item.system.veilBonus ?? 0)  - (pure.veilBonus ?? 0);
      if (dArmor !== 0 || dVeil !== 0) {
        out.doubleCount.push({
          name: item.name, owner: owner?.name ?? '(world)', slot: item.system.slot,
          bakedArmorDelta: dArmor, bakedVeilDelta: dVeil,
          note: 'stored value includes augment portion; _syncEffects re-adds it (double-count). Rings immune post-rebalance.',
        });
      }
    }

    console.log('═══ BRACELETS (stored → new derivation) ═══');
    console.table(out.bracelets);
    console.log('═══ EQUIPPED RING COUNTS (division divisors) ═══');
    console.table(out.rings);
    console.log('═══ ARMOR/VEIL AUGMENT DOUBLE-COUNT EXPOSURE (informational) ═══');
    console.table(out.doubleCount);
    return out;
  }

  async function applyBracelets() {
    const { deriveItemStats } = await libs();
    let n = 0;
    for (const { item } of allItems(i => i.system.slot === 'bracelet')) {
      const locked = new Set(item.system.lockedFields ?? []);
      const d = deriveItemStats(item);
      const upd = {};
      if (!locked.has('statBonuses')) upd['system.statBonuses'] = d.statBonuses;
      if (!locked.has('veilBonus'))   upd['system.veilBonus'] = d.veilBonus;
      if (!locked.has('armorBonus'))  upd['system.armorBonus'] = d.armorBonus;
      if (Object.keys(upd).length === 0) continue;
      // skipAutoDerive — we already derived; equipped items re-sync via the
      // statBonuses/veilBonus branch of _onItemUpdate.
      await item.update(upd, { diff: false, skipAutoDerive: true });
      n++;
    }
    console.log(`applyBracelets: ${n} bracelets re-derived (equipped ones auto-resynced).`);
    return n;
  }

  async function applyRings() {
    const { EquipmentSystem } = await libs();
    let actors = 0, rings = 0;
    for (const a of game.actors) {
      const equipped = a.items.filter(i => i.type === 'item' && i.system.equipped && i.system.slot === 'ring');
      if (equipped.length === 0) continue;
      actors++;
      for (const r of equipped) { await EquipmentSystem._syncEffects(r); rings++; }
    }
    console.log(`applyRings: re-synced ${rings} equipped rings across ${actors} actors.`);
    return { actors, rings };
  }

  return { audit, applyBracelets, applyRings };
})();
console.log('jewelryMigration loaded: await jewelryMigration.audit() / .applyBracelets() / .applyRings()');
