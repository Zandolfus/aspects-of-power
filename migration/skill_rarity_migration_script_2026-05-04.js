// Skill rarity migration — paste into the F12 console.
//
// Per design-skill-rarity-system.md (locked 2026-05-04).
//
// What this does:
//   1. For each skill in the world, decides its new `rarity` based on:
//      a. Legacy 'ancient' rarity      → 'epic' (one-off remap)
//      b. User-set non-default rarity  → preserved (your choice wins)
//      c. Spell with tier set, db matches tier default → tier-mapped:
//             basic→common, high→uncommon, greater→rare, major→epic, grand→legendary
//      d. Spell with tier, hand-tuned db → bucketed by diceBonus
//      e. Non-spell with hand-tuned db   → bucketed by diceBonus
//      f. Otherwise                       → 'common' (default)
//   2. Infers effectType from existing skill `tags`:
//          restoration → heal, debuff → debuff, attack → damage, else → utility
//   3. Resets `roll.diceBonus` to 1 so future code reads pure rarity
//      (ends the dual-mode fallback path).
//
// What this does NOT do:
//   - Touch alterations (stays empty; alteration tags are an upgrade-time choice)
//   - Touch tier/grade on spells (still drives baseMana + invest cap)
//   - Touch originalSkillId (lineage tracking is forward-looking)
//
// Usage:
//   const m = (PASTE-THE-FUNCTION)();
//   m.preview();              // dry-run, prints diff table + summary
//   const snap = m.snapshot();// pre-migration baseline (save to disk)
//   await m.apply();          // commits via update()
//   m.verify();               // sanity-check the result

() => {
  const skillRarities = CONFIG.ASPECTSOFPOWER.skillRarities;

  // Old per-tier defaults (now @deprecated). Used to detect "this skill
  // inherits its tier's default mult" vs "this skill is hand-tuned away
  // from the tier default."
  const SPELL_TIER_DEFAULTS = {
    basic: 0.20, high: 0.25, greater: 0.30, major: 0.40, grand: 0.60,
  };

  // Spell tier → new rarity mapping. Each tier represents a spell-category
  // power band; the closest matching new-system rarity for an at-tier spell.
  const TIER_TO_RARITY = {
    basic:   'common',
    high:    'uncommon',
    greater: 'rare',
    major:   'epic',
    grand:   'legendary',
  };

  function bucketByDiceBonus(db) {
    if (db == null) return null;
    if (db <= 0.55) return 'inferior';
    if (db < 0.65)  return 'common';
    if (db < 0.75)  return 'uncommon';
    if (db < 0.85)  return 'rare';
    if (db < 0.95)  return 'epic';
    if (db < 1.05)  return 'legendary';
    if (db < 1.15)  return 'mythic';
    return 'divine';
  }

  function inferEffectType(skill) {
    const tags = skill.system.tags || [];
    if (tags.includes('restoration')) return 'heal';
    if (tags.includes('debuff')) return 'debuff';
    if (tags.includes('attack')) return 'damage';
    // No clear effect-type tag — fall back to "damage" if the skill has any
    // damage-formula evidence (formula string or non-default diceBonus).
    // Catches legacy damage skills that forgot the 'attack' tag.
    const r = skill.system.roll || {};
    if (skill.system.formula || (r.diceBonus != null && r.diceBonus !== 1)) return 'damage';
    return 'utility';
  }

  function diceBonusMatchesTierDefault(db, tier) {
    if (db == null) return true; // null inherits the tier default
    const def = SPELL_TIER_DEFAULTS[tier];
    if (def == null) return false;
    return Math.abs(db - def) < 0.001;
  }

  function decide(skill) {
    const oldRarity = skill.system.rarity || 'common';
    const oldDb     = skill.system.roll?.diceBonus;
    const tier      = skill.system.roll?.tier;
    const newEffectType = inferEffectType(skill);

    // 1) Legacy 'ancient' → 'epic' (per user direction)
    if (oldRarity === 'ancient') {
      return { newRarity: 'epic', newEffectType, reason: 'ancient-remap' };
    }

    // 2) Preserve user-set non-default rarity
    if (oldRarity !== 'common' && skillRarities[oldRarity]) {
      return { newRarity: oldRarity, newEffectType, reason: 'preserve-user-rarity' };
    }

    // 3) Spell with tier
    if (tier && TIER_TO_RARITY[tier]) {
      if (diceBonusMatchesTierDefault(oldDb, tier)) {
        return { newRarity: TIER_TO_RARITY[tier], newEffectType, reason: 'tier-map' };
      }
      const bucketed = bucketByDiceBonus(oldDb);
      return { newRarity: bucketed || 'common', newEffectType, reason: 'hand-tuned-bucket' };
    }

    // 4) Non-spell with hand-tuned diceBonus
    if (oldDb != null && oldDb !== 1) {
      const bucketed = bucketByDiceBonus(oldDb);
      return { newRarity: bucketed || 'common', newEffectType, reason: 'diceBonus-bucket' };
    }

    // 5) Default
    return { newRarity: 'common', newEffectType, reason: 'default' };
  }

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
    const d = decide(skill);
    const oldRarity     = skill.system.rarity || 'common';
    const oldEffectType = skill.system.effectType || 'damage';
    const oldDb         = skill.system.roll?.diceBonus;
    const changed = (oldRarity !== d.newRarity)
                 || (oldEffectType !== d.newEffectType)
                 || (oldDb != null && oldDb !== 1);
    return {
      changed,
      oldRarity, newRarity: d.newRarity,
      oldEffectType, newEffectType: d.newEffectType,
      oldDb, newDb: 1,
      reason: d.reason,
    };
  }

  return {
    decide, diff,

    preview() {
      const rows = [];
      const summary = { total: 0, changed: 0, byReason: {}, byNewRarity: {} };
      for (const { actor, skill } of allSkills()) {
        summary.total++;
        const d = diff(skill);
        if (d.changed) summary.changed++;
        summary.byReason[d.reason]      = (summary.byReason[d.reason]      || 0) + 1;
        summary.byNewRarity[d.newRarity] = (summary.byNewRarity[d.newRarity] || 0) + 1;
        rows.push({ actor: actor?.name ?? '(world)', skill: skill.name, ...d });
      }
      console.table(rows.filter(r => r.changed));
      console.log('Summary:', summary);
      return { summary, rows };
    },

    snapshot() {
      const rows = [];
      for (const { actor, skill } of allSkills()) {
        rows.push({
          actorId:    actor?.id   ?? null,
          actorName:  actor?.name ?? null,
          skillId:    skill.id,
          skillName:  skill.name,
          rarity:     skill.system.rarity,
          effectType: skill.system.effectType,
          diceBonus:  skill.system.roll?.diceBonus,
          tier:       skill.system.roll?.tier,
          grade:      skill.system.roll?.grade,
          tags:       [...(skill.system.tags || [])],
        });
      }
      return JSON.stringify({
        timestamp:     new Date().toISOString(),
        worldTitle:    game.world.title,
        systemVersion: game.system.version,
        skillCount:    rows.length,
        skills:        rows,
      }, null, 2);
    },

    async apply() {
      let updated = 0, skipped = 0;
      const errors = [];
      for (const { actor, skill } of allSkills()) {
        try {
          const d = diff(skill);
          if (!d.changed) { skipped++; continue; }
          await skill.update({
            'system.rarity':         d.newRarity,
            'system.effectType':     d.newEffectType,
            'system.roll.diceBonus': 1,
          });
          updated++;
        } catch (e) {
          errors.push({ actor: actor?.name, skill: skill.name, error: String(e) });
        }
      }
      console.log(`Migration complete: ${updated} updated, ${skipped} skipped, ${errors.length} errors`);
      if (errors.length) console.warn('Errors:', errors);
      return { updated, skipped, errors };
    },

    verify() {
      const issues = [];
      for (const { actor, skill } of allSkills()) {
        const r = skill.system.rarity;
        if (!skillRarities[r]) {
          issues.push({ actor: actor?.name ?? '(world)', skill: skill.name, issue: `invalid rarity: ${r}` });
        }
        const db = skill.system.roll?.diceBonus;
        if (db != null && db !== 1) {
          issues.push({ actor: actor?.name ?? '(world)', skill: skill.name, issue: `diceBonus still hand-tuned: ${db}` });
        }
      }
      console.log(`Verification: ${issues.length} issues`);
      if (issues.length) console.table(issues);
      return issues;
    },
  };
}
