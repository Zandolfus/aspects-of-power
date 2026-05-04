async () => {
  const pack = game.packs.get("aspects-of-power.professions");
  if (!pack) return { error: "professions pack not found" };

  // Check if already exists
  const idx = await pack.getIndex();
  const existing = idx.find(e => e.name.toLowerCase() === "blood alchemist");
  if (existing) {
    return { warning: "Blood Alchemist already exists in pack", uuid: existing.uuid };
  }

  const wasLocked = pack.locked;
  if (wasLocked) await pack.configure({ locked: false });

  try {
    const item = await Item.create({
      name: "Blood Alchemist",
      type: "profession",
      img: "icons/svg/item-bag.svg",
      system: {
        description: "<p>Master of blood-based alchemy. Migrated from python game_data tier 2 with compendium-scale per-level totals (12/level: 10 fixed + 2 fp).</p>",
        rank: "E",
        gains: {
          vitality: 3,
          endurance: 0,
          strength: 0,
          dexterity: 0,
          toughness: 0,
          intelligence: 0,
          willpower: 2,
          wisdom: 4,
          perception: 1,
        },
        freePointsPerLevel: 2,
      },
    }, { pack: pack.collection });

    if (wasLocked) await pack.configure({ locked: true });

    return {
      created: true,
      uuid: item.uuid,
      name: item.name,
      rank: item.system.rank,
      gains: item.system.gains,
      freePointsPerLevel: item.system.freePointsPerLevel,
      total: Object.values(item.system.gains).reduce((s, v) => s + (v || 0), 0) + item.system.freePointsPerLevel,
    };
  } catch (e) {
    if (wasLocked) await pack.configure({ locked: true });
    return { error: String(e) };
  }
}
