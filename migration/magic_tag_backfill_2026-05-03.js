// Magic-tag backfill — paste into the F12 console.
//
// Ensures every skill whose `system.roll.type` is one of the magic roll
// types (`magic`, `magic_projectile`, `magic_melee`) carries `'magic'`
// in its `system.tags` array. Drives the new skill-sheet UI: the spell
// tier dropdown is conditional on the `magic` tag.
//
// Skips skills that already have the tag. Doesn't touch any other field.
//
// Usage:
//   const m = (PASTE-THE-FUNCTION)();
//   m.preview();        // dry-run table + summary
//   await m.apply();    // commits
//   m.verify();         // sanity-check

() => {
  const MAGIC_TYPES = new Set(['magic', 'magic_projectile', 'magic_melee']);

  function* allSkills() {
    for (const a of game.actors) {
      for (const i of a.items) {
        if (i.type === 'skill') yield { actor: a, skill: i };
      }
    }
    for (const i of game.items) {
      if (i.type === 'skill') yield { actor: null, skill: i };
    }
  }

  function diff(skill) {
    const rollType = skill.system.roll?.type ?? '';
    const tags = skill.system.tags ?? [];
    const isMagic = MAGIC_TYPES.has(rollType);
    const hasMagic = tags.includes('magic');
    return {
      changed: isMagic && !hasMagic,
      rollType,
      tags,
      reason: !isMagic ? 'not-magic-type' : (hasMagic ? 'already-tagged' : 'will-add-magic'),
    };
  }

  return {
    diff,

    preview() {
      const rows = [];
      const summary = { total: 0, changed: 0, alreadyTagged: 0, nonMagic: 0 };
      for (const { actor, skill } of allSkills()) {
        summary.total++;
        const d = diff(skill);
        if (d.changed) {
          summary.changed++;
          rows.push({
            actor: actor?.name ?? '(world)',
            skill: skill.name,
            rollType: d.rollType,
            tagsBefore: d.tags.join(',') || '—',
            tagsAfter: [...d.tags, 'magic'].join(','),
          });
        } else if (d.reason === 'already-tagged') summary.alreadyTagged++;
        else summary.nonMagic++;
      }
      console.table(rows);
      console.log('Summary:', summary);
      return { summary, rows };
    },

    async apply() {
      let updated = 0, skipped = 0;
      const errors = [];
      for (const { actor, skill } of allSkills()) {
        try {
          const d = diff(skill);
          if (!d.changed) { skipped++; continue; }
          // Read source tags (not the prepared system view) so we don't lose
          // any pre-existing entries to data-prep stripping. `diff: false`
          // bypasses Foundry's diff comparison which was silently dropping
          // some array-add updates on certain actors during the first run.
          const currentSource = skill._source.system.tags ?? [];
          const next = Array.from(new Set([...currentSource, 'magic']));
          await skill.update({ 'system.tags': next }, { diff: false });
          updated++;
        } catch (e) {
          errors.push({ actor: actor?.name, skill: skill.name, error: String(e) });
        }
      }
      console.log(`Magic-tag backfill: ${updated} updated, ${skipped} skipped, ${errors.length} errors`);
      if (errors.length) console.warn('Errors:', errors);
      return { updated, skipped, errors };
    },

    verify() {
      const issues = [];
      for (const { actor, skill } of allSkills()) {
        const rollType = skill.system.roll?.type ?? '';
        const tags = skill.system.tags ?? [];
        if (MAGIC_TYPES.has(rollType) && !tags.includes('magic')) {
          issues.push({ actor: actor?.name ?? '(world)', skill: skill.name, issue: `magic-type skill missing 'magic' tag` });
        }
      }
      console.log(`Verification: ${issues.length} issues`);
      if (issues.length) console.table(issues);
      return issues;
    },
  };
}
