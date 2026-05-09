// Backfill augment-tag-grants on every host item that has slotted augments.
//
// The reconcile hook in aspects-of-power.mjs only fires when system.augments
// or system.profAugments is in the update payload. Items with augments
// slotted BEFORE the grantsTags feature shipped have no flags.aspectsofpower
// .augmentGrantedTags origin record, so their augments contribute no tags
// to the host's effective tag set.
//
// This script finds every actor-owned item with non-empty augments arrays,
// reads the grantsTags from each slotted augment, and re-saves the augments
// array unchanged — which triggers the reconcile hook and writes the
// augmentGrantedTags origin map plus appends the granted tags to system.tags.
//
// Idempotent: items already in sync (matching origin map) get a no-op write.
// Run via:
//   node migration/run_playwright_eval.js migration/backfill_augment_tag_grants.js

async () => {
  const log = [];
  let touched = 0;
  let skipped = 0;
  for (const actor of game.actors.contents) {
    for (const item of actor.items) {
      if (item.type !== 'item') continue;
      const augs = item.system?.augments ?? [];
      const profAugs = item.system?.profAugments ?? [];
      const hasAny = augs.some(a => a.augmentId) || profAugs.some(a => a.augmentId);
      if (!hasAny) { skipped++; continue; }
      // Re-save the augments array unchanged — triggers preUpdateItem
      // hook which reconciles tags + origin map.
      const update = {};
      if (augs.length) update['system.augments'] = augs.map(a => ({ augmentId: a.augmentId ?? '' }));
      if (profAugs.length) update['system.profAugments'] = profAugs.map(a => ({ augmentId: a.augmentId ?? '' }));
      await item.update(update);
      touched++;
      log.push(`${actor.name} / ${item.name}: re-saved (${augs.filter(a => a.augmentId).length}+${profAugs.filter(a => a.augmentId).length} augments)`);
    }
  }
  return JSON.stringify({ touched, skipped, sample: log.slice(0, 12) }, null, 2);
}
