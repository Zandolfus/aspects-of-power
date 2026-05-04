// NPA mass-leveler — paste config + run.
//
// For each entry in NPA_CONFIG below, this script:
//   1. Resets abilities to 5, levels to 0, freePoints to 0
//   2. Builds history segments: feeder for 0-24 (if needed), original template for 25+
//   3. Walks each track via applyTrackLevelsByHistory (the new history-aware engine)
//   4. Sets HP/MP/SP to max
//
// Result: each NPA ends with full templateHistory populated and stats matching
// the new formula at their original level targets.
//
// Skips: Monster-race NPAs, dead/uninitiated folders, James/Kevin/Mantis (no templates).
//
// Returns: per-actor summary { name, raceLvl/classLvl/profLvl segments, errors }.

async () => {
  const ABILITY_KEYS = ["vitality", "endurance", "strength", "dexterity", "toughness", "intelligence", "willpower", "wisdom", "perception"];

  // Per-NPA feeder picks. classFeeder/profFeeder = G-rank template name to use
  // for levels 1-24 if the original template is rank E. null = no feeder needed.
  const NPA_CONFIG = [
    // class: G-rank original (no feeder needed)
    { name: "Bridget Sutherland", classFeeder: null,             profFeeder: "Chef" },
    { name: "Bruce Bradley",      classFeeder: null,             profFeeder: "Gatherer" },
    { name: "Damian Flynn",       classFeeder: null,             profFeeder: "Beginner Leatherworker of the Cosmos" },
    { name: "Deanna Mendez",      classFeeder: null,             profFeeder: "Pickpocket" },
    { name: "Lincoln Christensen",classFeeder: null,             profFeeder: "Builder" },

    // class: E-rank original (feeder needed)
    { name: "Aiden Fig",          classFeeder: "Mage",           profFeeder: "Windlord's Keeper" },
    { name: "Alda",               classFeeder: "Light Warrior",  profFeeder: "Beast-Speaker" },
    { name: "Amina Wright",       classFeeder: "Mage",           profFeeder: "Beginner Jeweler of the Elements" },
    { name: "Faye",               classFeeder: "Mage",           profFeeder: null },
    { name: "Frieda",             classFeeder: "Archer",         profFeeder: "Student Trapper of the Asrai" },
    { name: "George",             classFeeder: "Heavy Warrior",  profFeeder: "Drums of War, Largo" },
    { name: "Harry Hess",         classFeeder: "Mage",           profFeeder: null },
    { name: "Khalid Holman",      classFeeder: "Medium Warrior", profFeeder: "Beginner Smith of the Moonshadow" },
    { name: "Mary",               classFeeder: "Healer",         profFeeder: null },
    { name: "Mathilda Fry",       classFeeder: "Mage",           profFeeder: null },
    { name: "Olivia",             classFeeder: "Mage",           profFeeder: "Novice Witch-Wright of Iron and Ice" },
    { name: "Rosalie Flynn",      classFeeder: "Healer",         profFeeder: "Novice Tailor" },
    { name: "Sebastian",          classFeeder: "Mage",           profFeeder: "Demonic Butler" },
    { name: "Valentine Fig",      classFeeder: "Mage",           profFeeder: "Alchemist of Flame's Heart" },
    { name: "Woody Dalton",       classFeeder: "Archer",         profFeeder: "Student Shaper of the Asrai" },
  ];

  const { applyTrackLevelsByHistory } = await import("/systems/aspects-of-power/module/systems/mass-leveler.mjs");

  // Build name → uuid lookup for class/prof templates.
  async function buildNameLookup(packId) {
    const pack = game.packs.get(packId);
    if (!pack) return new Map();
    const idx = await pack.getIndex();
    const map = new Map();
    for (const e of idx) map.set(e.name, e.uuid);
    return map;
  }
  const classLookup = await buildNameLookup("aspects-of-power.classes");
  const profLookup = await buildNameLookup("aspects-of-power.professions");

  const results = [];

  for (const cfg of NPA_CONFIG) {
    const actor = game.actors.find(a => a.name === cfg.name);
    if (!actor) {
      results.push({ name: cfg.name, error: "actor not found" });
      continue;
    }

    const errors = [];
    const targets = {
      race: actor.system.attributes.race?.level ?? 0,
      class: actor.system.attributes.class?.level ?? 0,
      profession: actor.system.attributes.profession?.level ?? 0,
    };
    const originalTemplates = {
      race: actor.system.attributes.race?.templateId,
      class: actor.system.attributes.class?.templateId,
      profession: actor.system.attributes.profession?.templateId,
    };

    // ── Step 1: Reset abilities, levels, freePoints. Also clear cachedTags;
    // they'll be rebuilt when templateId gets re-set during the walk.
    const resetUpd = { "system.freePoints": 0 };
    for (const k of ABILITY_KEYS) resetUpd[`system.abilities.${k}.value`] = 5;
    for (const trk of ["race", "class", "profession"]) {
      resetUpd[`system.attributes.${trk}.level`] = 0;
      resetUpd[`system.attributes.${trk}.history`] = [];
    }
    await actor.update(resetUpd, { skipAutoDerive: true });

    // ── Step 2: Build history segments per track
    async function resolveRank(uuid) {
      try { const t = await fromUuid(uuid); return t?._source.system.rank; } catch (e) { return null; }
    }

    const histories = {};

    // CLASS history
    if (originalTemplates.class) {
      const origRank = await resolveRank(originalTemplates.class);
      if (origRank === "E" && cfg.classFeeder) {
        const feederUuid = classLookup.get(cfg.classFeeder);
        if (!feederUuid) {
          errors.push(`class feeder "${cfg.classFeeder}" not found in compendium`);
        } else {
          histories.class = [
            { fromLevel: 0,  templateId: feederUuid },
            { fromLevel: 25, templateId: originalTemplates.class },
          ];
        }
      } else {
        histories.class = [{ fromLevel: 0, templateId: originalTemplates.class }];
      }
    }

    // PROFESSION history (same logic)
    if (originalTemplates.profession) {
      const origRank = await resolveRank(originalTemplates.profession);
      if (origRank === "E" && cfg.profFeeder) {
        const feederUuid = profLookup.get(cfg.profFeeder);
        if (!feederUuid) {
          errors.push(`prof feeder "${cfg.profFeeder}" not found in compendium`);
        } else {
          histories.profession = [
            { fromLevel: 0,  templateId: feederUuid },
            { fromLevel: 25, templateId: originalTemplates.profession },
          ];
        }
      } else {
        histories.profession = [{ fromLevel: 0, templateId: originalTemplates.profession }];
      }
    }

    // RACE history (no feeder concept — race templates have rankGains for all
    // ranks they need; if not, applyTrackLevelsByHistory will halt and report)
    if (originalTemplates.race) {
      histories.race = [{ fromLevel: 0, templateId: originalTemplates.race }];
    }

    // Set histories on actor
    const histUpd = {};
    for (const trk of ["race", "class", "profession"]) {
      if (histories[trk]) histUpd[`system.attributes.${trk}.history`] = JSON.parse(JSON.stringify(histories[trk]));
    }
    if (Object.keys(histUpd).length > 0) {
      await actor.update(histUpd, { skipAutoDerive: true });
    }

    // ── Step 3: Walk each track to its target via the new engine
    const segments = {};
    for (const trk of ["class", "profession", "race"]) {  // class/prof first, race derives if needed
      if (targets[trk] === 0) {
        segments[trk] = [];
        continue;
      }
      try {
        const r = await applyTrackLevelsByHistory(actor, trk, targets[trk]);
        segments[trk] = r.segments;
        if (r.halted) errors.push(`${trk} walk halted: ${r.reason}`);
        if (r.applied !== targets[trk]) errors.push(`${trk} applied ${r.applied}/${targets[trk]}`);
      } catch (e) {
        errors.push(`${trk} walk threw: ${String(e)}`);
      }
    }

    // ── Step 4: Resources to max (refresh prepared data first)
    actor.reset();
    const maxUpd = {
      "system.health.value":  actor.system.health?.max  ?? 0,
      "system.mana.value":    actor.system.mana?.max    ?? 0,
      "system.stamina.value": actor.system.stamina?.max ?? 0,
    };
    await actor.update(maxUpd, { skipAutoDerive: true });

    results.push({
      name: cfg.name,
      targets,
      segments,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  return { count: results.length, results };
}
