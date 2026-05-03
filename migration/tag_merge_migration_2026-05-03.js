// Tag merge migration — paste into the F12 console.
//
// Merges every item's `system.systemTags` (structured `{id, value}[]`) into
// `system.tags` (flat string array). Per the unified-tags decision, since
// no tags in the world currently carry non-zero values, the merge is a
// straight string-list union. systemTags entries are then cleared on the
// item so the legacy field stays empty going forward.
//
// Also rebuilds each actor's `attributes.{race,class,profession}.cachedTags`
// from the assigned template's now-merged `tags` field, so the runtime
// cache reflects the unified data immediately (the live updateItem hook
// already does this on subsequent edits).
//
// Usage:
//   const m = (PASTE-THE-FUNCTION)();
//   m.preview();   // dry-run table + summary
//   m.snapshot();  // returns JSON of pre-migration tag state
//   await m.apply();  // commits
//   m.verify();

() => {
  const ITEM_TYPES = ['race', 'class', 'profession', 'item'];

  function* allItems() {
    for (const i of game.items) {
      if (ITEM_TYPES.includes(i.type)) yield { actor: null, item: i };
    }
    for (const a of game.actors) {
      for (const i of a.items) {
        if (ITEM_TYPES.includes(i.type)) yield { actor: a, item: i };
      }
    }
  }

  function diffOne(item) {
    const oldTags = item.system.tags ?? [];
    const oldSystemTags = (item.system.systemTags ?? []).map(t => t.id).filter(Boolean);
    const merged = Array.from(new Set([...oldTags, ...oldSystemTags]));
    const changed = oldSystemTags.length > 0 || merged.length !== oldTags.length;
    return { oldTags, oldSystemTags, merged, changed };
  }

  return {
    diffOne,

    preview() {
      const rows = [];
      let changedCount = 0;
      for (const { actor, item } of allItems()) {
        const d = diffOne(item);
        if (d.changed) {
          changedCount++;
          rows.push({
            actor: actor?.name ?? '(world)',
            type: item.type,
            name: item.name,
            tagsBefore: d.oldTags.join(',') || '—',
            systemTagsBefore: d.oldSystemTags.join(',') || '—',
            tagsAfter: d.merged.join(','),
          });
        }
      }
      console.table(rows);
      console.log(`Total items: ${[...allItems()].length}; Changed: ${changedCount}`);
      return { changedCount, rows };
    },

    snapshot() {
      const rows = [];
      for (const { actor, item } of allItems()) {
        rows.push({
          actorId:   actor?.id ?? null,
          actorName: actor?.name ?? null,
          itemId:    item.id,
          itemName:  item.name,
          itemType:  item.type,
          tags:        [...(item.system.tags ?? [])],
          systemTags:  (item.system.systemTags ?? []).map(t => ({ id: t.id, value: t.value })),
        });
      }
      return JSON.stringify({
        timestamp:     new Date().toISOString(),
        worldTitle:    game.world.title,
        systemVersion: game.system.version,
        itemCount:     rows.length,
        items:         rows,
      }, null, 2);
    },

    async apply() {
      let updated = 0, skipped = 0;
      const errors = [];
      for (const { actor, item } of allItems()) {
        try {
          const d = diffOne(item);
          if (!d.changed) { skipped++; continue; }
          await item.update({
            'system.tags':       d.merged,
            'system.systemTags': [],
          });
          updated++;
        } catch (e) {
          errors.push({ actor: actor?.name, item: item.name, error: String(e) });
        }
      }

      // Refresh per-actor cachedTags from each assigned template. Read the
      // UNION of tags + systemTags on the template — compendium templates
      // may still be unmigrated (locked packs), so legacy systemTags is the
      // only source there. Without the union we'd silently drop cached
      // affinities on templates that haven't been migrated themselves.
      let cacheUpdated = 0;
      for (const a of game.actors) {
        const updates = {};
        for (const type of ['race', 'class', 'profession']) {
          const attr = a.system.attributes?.[type];
          if (!attr?.templateId) continue;
          let tpl;
          try { tpl = await fromUuid(attr.templateId); } catch (e) { continue; }
          if (!tpl) continue;
          const ids = [
            ...(tpl.system?.tags ?? []),
            ...(tpl.system?.systemTags ?? []).map(t => t.id),
          ];
          const unique = [...new Set(ids.filter(Boolean))];
          updates[`system.attributes.${type}.cachedTags`] = unique.map(id => ({ id, value: 0 }));
        }
        if (Object.keys(updates).length > 0) {
          await a.update(updates);
          cacheUpdated++;
        }
      }

      console.log(`Items: ${updated} updated, ${skipped} skipped. Actor caches refreshed: ${cacheUpdated}. Errors: ${errors.length}.`);
      if (errors.length) console.warn('Errors:', errors);
      return { updated, skipped, cacheUpdated, errors };
    },

    verify() {
      const issues = [];
      for (const { actor, item } of allItems()) {
        const remaining = (item.system.systemTags ?? []).map(t => t.id).filter(Boolean);
        if (remaining.length > 0) {
          issues.push({ actor: actor?.name, item: item.name, issue: `systemTags not cleared: ${remaining.join(',')}` });
        }
      }
      console.log(`Verification: ${issues.length} issues`);
      if (issues.length) console.table(issues);
      return issues;
    },
  };
}
