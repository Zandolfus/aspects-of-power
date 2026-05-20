// Backfill snapshots on slot entries whose augmentId is an actor-LOCAL item
// (not a compendium UUID).
//
// Context: the snapshot architecture (commit 3aa1656) made each slot entry
// carry inline { itemBonuses, craftBonuses, grantsTags } captured at apply
// time. The original 165-entry migration only covered compendium-UUID
// augments. Augments that lived as world items in an actor's inventory
// (the "local" case — e.g. Wand Inscription on John's Fulgurite Longsword)
// were slotted by an older code path that stored only the bare local id and
// left the snapshot arrays empty.
//
// Consequence: reconcile hook's tag-strip + augment-delta logic both read
// from the slot snapshot, so unslotting a legacy local augment can't
// strip its granted tags or reverse its bonuses on a locked host.
//
// This sweep walks every item on every actor; for each augments[] /
// profAugments[] slot whose augmentId resolves via actor.items.get() AND
// whose snapshot is empty, copies the resolved augment's itemBonuses,
// craftBonuses, and grantsTags into the slot.
//
// `mode` toggle:
//   'dryRun'  — report only, no writes
//   'commit'  — write the backfilled snapshots
//   Optional second behavior: 'compendiumToo' would also resolve
//   compendium-UUID empty snapshots via fromUuid. Currently OFF — those
//   are a separate (rarer) issue from the compendium-hydration race that
//   the eager-ready hook (a618f79) closed for new slots.
//
// Run via:
//   node migration/run_playwright_eval.js migration/backfill_legacy_local_augment_snapshots.js

async () => {
  const MODE = 'dryRun'; // flip to 'commit' to write
  const HANDLE_COMPENDIUM_EMPTY = false;

  const report = {
    backfilled: [],         // local augment, snapshot populated
    localNotFound: [],      // bare id didn't resolve via actor.items.get()
    localWrongType: [],     // resolved but type !== 'augment'
    compendiumEmpty: [],    // UUID slot with empty snapshot (separate issue)
    compendiumBackfilled: [], // only if HANDLE_COMPENDIUM_EMPTY
  };

  const buildSnapshotFromAugment = (augItem) => {
    const s = augItem.system ?? {};
    return {
      itemBonuses: (s.itemBonuses ?? []).map(b => ({
        field:    b.field    ?? '',
        value:    b.value    ?? 0,
        mode:     b.mode     ?? 'flat',
        affinity: b.affinity ?? '',
      })),
      craftBonuses: (s.craftBonuses ?? []).map(b => ({
        type:     b.type     ?? '',
        value:    b.value    ?? 0,
        affinity: b.affinity ?? '',
      })),
      grantsTags: [...(s.grantsTags ?? [])],
    };
  };

  const isEmptySnapshot = (slot) =>
    (slot.itemBonuses?.length  ?? 0) === 0
    && (slot.craftBonuses?.length ?? 0) === 0
    && (slot.grantsTags?.length   ?? 0) === 0;

  for (const actor of game.actors.contents) {
    for (const item of actor.items) {
      if (item.type !== 'item') continue;

      for (const field of ['augments', 'profAugments']) {
        const slots = item.system?.[field] ?? [];
        if (slots.length === 0) continue;

        let touched = false;
        const newSlots = [];
        for (const slot of slots) {
          if (!slot.augmentId) { newSlots.push(slot); continue; }
          if (!isEmptySnapshot(slot)) { newSlots.push(slot); continue; }

          const isLocal = !slot.augmentId.includes('.');
          if (isLocal) {
            const augItem = actor.items.get(slot.augmentId);
            if (!augItem) {
              report.localNotFound.push({
                actor: actor.name, item: item.name, field, augmentId: slot.augmentId,
              });
              newSlots.push(slot);
              continue;
            }
            if (augItem.type !== 'augment') {
              report.localWrongType.push({
                actor: actor.name, item: item.name, field,
                augmentId: slot.augmentId, foundType: augItem.type, foundName: augItem.name,
              });
              newSlots.push(slot);
              continue;
            }
            const snap = buildSnapshotFromAugment(augItem);
            newSlots.push({ augmentId: slot.augmentId, ...snap });
            touched = true;
            report.backfilled.push({
              actor: actor.name, item: item.name, field, augmentName: augItem.name,
              itemBonuses: snap.itemBonuses.length,
              craftBonuses: snap.craftBonuses.length,
              grantsTags: snap.grantsTags,
            });
          } else {
            // Compendium UUID with empty snapshot — hydration-race casualty.
            if (HANDLE_COMPENDIUM_EMPTY) {
              let augDoc = null;
              try { augDoc = await fromUuid(slot.augmentId); } catch (_) {}
              if (augDoc?.system) {
                const snap = buildSnapshotFromAugment(augDoc);
                newSlots.push({ augmentId: slot.augmentId, ...snap });
                touched = true;
                report.compendiumBackfilled.push({
                  actor: actor.name, item: item.name, field, augmentName: augDoc.name,
                  itemBonuses: snap.itemBonuses.length,
                  craftBonuses: snap.craftBonuses.length,
                  grantsTags: snap.grantsTags,
                });
              } else {
                report.compendiumEmpty.push({
                  actor: actor.name, item: item.name, field, augmentId: slot.augmentId,
                  reason: 'fromUuid returned null',
                });
                newSlots.push(slot);
              }
            } else {
              report.compendiumEmpty.push({
                actor: actor.name, item: item.name, field, augmentId: slot.augmentId,
              });
              newSlots.push(slot);
            }
          }
        }

        if (touched && MODE === 'commit') {
          await item.update(
            { ['system.' + field]: newSlots },
            // Skip the reconcile hook for the backfill itself — we're only
            // populating the snapshot, not adding/removing an augment. The
            // futureIds set would equal priorIds so the hook would no-op,
            // but skipping explicitly is cheaper + safer.
            { skipAugmentTagReconcile: true }
          );
        }
      }
    }
  }

  return JSON.stringify({
    mode: MODE,
    handleCompendiumEmpty: HANDLE_COMPENDIUM_EMPTY,
    summary: {
      backfilled:           report.backfilled.length,
      localNotFound:        report.localNotFound.length,
      localWrongType:       report.localWrongType.length,
      compendiumEmpty:      report.compendiumEmpty.length,
      compendiumBackfilled: report.compendiumBackfilled.length,
    },
    backfilled:           report.backfilled,
    localNotFound:        report.localNotFound,
    localWrongType:       report.localWrongType,
    compendiumEmpty:      report.compendiumEmpty,
    compendiumBackfilled: report.compendiumBackfilled,
  }, null, 2);
}
