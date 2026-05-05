() => {
  // Exclusions as lowercase first-name tokens (with aliases for spelling variants).
  const EXCLUDE = new Set([
    "felicia", "gabriel", "john", "will", "willy", "harvey", "phil",
    "sebastian", "aaron",
    "frida", "frieda", "george", "hilda", "alda", "khalid", "harry",
    "valentine", "aiden", "yasmin", "carmen", "madeline",
  ]);

  const remaining = [];
  const excludedHits = new Set();
  for (const a of game.actors) {
    if (a.prototypeToken?.disposition !== 1) continue;
    const firstWord = (a.name || "").split(/\s+/)[0].toLowerCase();
    if (EXCLUDE.has(firstWord)) {
      excludedHits.add(firstWord);
      continue;
    }
    const r = a.system.attributes?.race;
    const c = a.system.attributes?.class;
    const p = a.system.attributes?.profession;
    remaining.push({
      name: a.name,
      folder: a.folder?.name ?? "(none)",
      race: r?.name,
      raceLvl: r?.level ?? 0,
      classLvl: c?.level ?? 0,
      profLvl: p?.level ?? 0,
      hasTpls: !!(r?.templateId && c?.templateId && p?.templateId),
      isMonster: (r?.name || "").toLowerCase().includes("monster"),
    });
  }
  // Identify exclusion entries that DIDN'T hit (so user knows which names weren't matched)
  const unmatched = [...EXCLUDE].filter(name => !excludedHits.has(name));
  return { count: remaining.length, remaining, excluded_hit: [...excludedHits], unmatched_exclusions: unmatched };
}
