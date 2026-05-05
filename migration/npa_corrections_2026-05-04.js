async () => {
  // Each entry: NPA name + ability deltas to ADD (negative subtracts) + freePoints delta.
  // Computed as: diff = (correct_template_gains) - (wrong_template_gains) for the
  // single level that was misclassified (CSV transition level 24 was treated as
  // "rank E" but should have been "rank G/F" per CSV semantic of from_level=25
  // meaning "starts AT level 25, so 24 is still the prior template").
  const CORRECTIONS = [
    // Faye prof: Sapling->Seed for level 24 (Sapling - Seed = +wil:2,+wis:1,+per:1)
    { name: "Faye", abilities: { willpower: -2, wisdom: -1, perception: -1 }, fp: 0 },
    // Deanna prof: Thief->Pickpocket for level 24
    { name: "Deanna Mendez", abilities: { endurance: -1, dexterity: -2, perception: -1 }, fp: 0 },
    // Mary prof: High Advocate->Advocate for level 24 (no stat diff, fp diff 12->8 = -4)
    { name: "Mary", abilities: {}, fp: -4 },
    // Sebastian class: Sandman->Mage for level 24
    { name: "Sebastian", abilities: { strength: -1, dexterity: -4, willpower: -1, wisdom: 1, perception: 1 }, fp: 0 },
    // Sebastian prof: Head Demonic Butler->Demonic Butler for level 24
    // (combined into above entry — apply both via two iterations? No, do as two entries with same name)
    // Actually let's do separate entries for clarity, then sum at apply time
  ];
  // Sebastian prof correction (separate entry, will sum with class above)
  CORRECTIONS.push({ name: "Sebastian", abilities: { dexterity: -2, intelligence: -1, wisdom: -1 }, fp: 0 });
  // Aiden Fig prof: Bonded->Keeper for level 24
  CORRECTIONS.push({ name: "Aiden Fig", abilities: { dexterity: -1, intelligence: -2, willpower: -1 }, fp: 0 });
  // Harry Hess prof: Tailor of Ingenuity->Novice Tailor for level 24
  CORRECTIONS.push({ name: "Harry Hess", abilities: { dexterity: -2, wisdom: -1, perception: -1 }, fp: 0 });

  const results = [];
  for (const corr of CORRECTIONS) {
    const a = game.actors.find(x => x.name === corr.name);
    if (!a) { results.push({ name: corr.name, error: "not found" }); continue; }
    const updates = {};
    const before = {};
    const after = {};
    for (const [stat, delta] of Object.entries(corr.abilities)) {
      const cur = a._source.system.abilities[stat].value;
      const next = Math.max(0, cur + delta);
      updates[`system.abilities.${stat}.value`] = next;
      before[stat] = cur;
      after[stat] = next;
    }
    if (corr.fp !== 0) {
      const curFp = a._source.system.freePoints ?? 0;
      const nextFp = Math.max(0, curFp + corr.fp);
      updates["system.freePoints"] = nextFp;
      before.fp = curFp;
      after.fp = nextFp;
    }
    if (Object.keys(updates).length > 0) {
      try {
        await a.update(updates, { skipAutoDerive: true });
        results.push({ name: corr.name, status: "applied", before, after });
      } catch (e) {
        results.push({ name: corr.name, error: String(e), updates });
      }
    } else {
      results.push({ name: corr.name, status: "noop" });
    }
  }
  // Re-resync HP/MP/SP to max after stat changes
  const touched = new Set(CORRECTIONS.map(c => c.name));
  for (const name of touched) {
    const a = game.actors.find(x => x.name === name);
    if (!a) continue;
    a.reset();
    const maxUpd = {};
    if (a.system.health?.max) maxUpd["system.health.value"] = a.system.health.max;
    if (a.system.mana?.max) maxUpd["system.mana.value"] = a.system.mana.max;
    if (a.system.stamina?.max) maxUpd["system.stamina.value"] = a.system.stamina.max;
    if (Object.keys(maxUpd).length > 0) await a.update(maxUpd, { skipAutoDerive: true });
  }
  return { count: results.length, results };
}
