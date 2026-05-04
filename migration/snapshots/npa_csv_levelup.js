// NPA CSV-driven level-up.
// Reads the CSV at /systems/aspects-of-power/python/Test/all_chars_leveled_test.csv
// and for each row matching a NON-PC actor in the world, sets that actor's
// race/class/profession history to the CSV's intended history then walks any
// track where the CSV's target level exceeds the current level.
//
// Does NOT reset abilities — only adds levels (and accrues template gains
// for those new levels). Pre-existing stats are preserved.

async () => {
  // Skip these — they're PCs, not NPAs.
  const SKIP_NAMES = new Set(["Phil", "Felicia", "Harvey McKay"]);
  // CSV name → game actor name. Many rows use shortened names.
  const NAME_ALIASES = {
    "Damien":   "Damian Flynn",
    "Rosaly":   "Rosalie Flynn",
    "Frida":    "Frieda",
    "Aiden":    "Aiden Fig",
    "Valentine":"Valentine Fig",
    "Bruce":    "Bruce Bradley",
    "Bridget":  "Bridget Sutherland",
    "Lincoln":  "Lincoln Christensen",
    "Damian":   "Damian Flynn",
    "Woody":    "Woody Dalton",
    "Deanna":   "Deanna Mendez",
  };

  // Minimal CSV parser handling RFC4180-style quoted fields.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { cell += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(cell); cell = ""; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
        else if (c === '\r') { /* skip */ }
        else { cell += c; }
      }
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Build name → uuid map for a compendium (case-insensitive).
  async function buildLookup(packId) {
    const pack = game.packs.get(packId);
    if (!pack) return new Map();
    const idx = await pack.getIndex();
    const map = new Map();
    for (const e of idx) map.set(e.name.toLowerCase().trim(), e.uuid);
    return map;
  }

  // Convert CSV history segment list to engine-ready history.
  // CSV format: [{"class":"mage","from_level":1,"to_level":24}, ...]
  // Engine format: [{fromLevel: 0|1|..., templateId: uuid}]
  function toEngineHistory(csvHistory, kindKey, lookupMap) {
    const segments = [];
    const errors = [];
    for (const seg of csvHistory) {
      const name = (seg[kindKey] || "").toLowerCase().trim();
      if (!name) continue;
      const uuid = lookupMap.get(name);
      if (!uuid) {
        errors.push(`unknown ${kindKey}: "${seg[kindKey]}"`);
        continue;
      }
      const fromLevel = (seg.from_level ?? 1) - 1; // CSV from_level=1 -> our 0
      segments.push({ fromLevel, templateId: uuid });
    }
    return { segments, errors };
  }

  // Fetch CSV
  const r = await fetch("/systems/aspects-of-power/python/Test/all_chars_leveled_test.csv?t=" + Date.now());
  if (!r.ok) return { error: `CSV fetch failed: ${r.status}` };
  const text = await r.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "CSV has no data rows" };

  // Header indices
  const header = rows[0];
  const idx = {
    name: header.indexOf("Name"),
    classLevel: header.indexOf("Class level"),
    profLevel: header.indexOf("Profession level"),
    raceLevel: header.indexOf("Race level"),
    classHistory: header.indexOf("class_history"),
    profHistory: header.indexOf("profession_history"),
    raceHistory: header.indexOf("race_history"),
  };

  // Build template lookup maps
  const classLookup = await buildLookup("aspects-of-power.classes");
  const profLookup = await buildLookup("aspects-of-power.professions");
  const raceLookup = await buildLookup("aspects-of-power.races");

  const { applyTrackLevelsByHistory } = await import("/systems/aspects-of-power/module/systems/mass-leveler.mjs");

  const results = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[idx.name]) continue;
    const csvName = row[idx.name].trim();

    if (SKIP_NAMES.has(csvName)) {
      results.push({ csvName, status: "skipped (PC)" });
      continue;
    }

    const gameName = NAME_ALIASES[csvName] || csvName;
    const actor = game.actors.find(a => a.name === gameName);
    if (!actor) {
      results.push({ csvName, gameName, status: "skipped (actor not found)" });
      continue;
    }

    const csvRace = parseInt(row[idx.raceLevel], 10) || 0;
    const csvClass = parseInt(row[idx.classLevel], 10) || 0;
    const csvProf = parseInt(row[idx.profLevel], 10) || 0;

    let csvClassHist, csvProfHist, csvRaceHist;
    try {
      csvClassHist = JSON.parse(row[idx.classHistory] || "[]");
      csvProfHist = JSON.parse(row[idx.profHistory] || "[]");
      csvRaceHist = JSON.parse(row[idx.raceHistory] || "[]");
    } catch (e) {
      results.push({ csvName, gameName, status: "JSON parse error", error: String(e) });
      continue;
    }

    const errors = [];
    const cls = toEngineHistory(csvClassHist, "class", classLookup);
    const prof = toEngineHistory(csvProfHist, "profession", profLookup);
    const race = toEngineHistory(csvRaceHist, "race", raceLookup);
    errors.push(...cls.errors, ...prof.errors, ...race.errors);

    const histUpd = {};
    if (cls.segments.length > 0)  histUpd["system.attributes.class.history"]      = JSON.parse(JSON.stringify(cls.segments));
    if (prof.segments.length > 0) histUpd["system.attributes.profession.history"] = JSON.parse(JSON.stringify(prof.segments));
    if (race.segments.length > 0) histUpd["system.attributes.race.history"]       = JSON.parse(JSON.stringify(race.segments));
    if (Object.keys(histUpd).length > 0) {
      try { await actor.update(histUpd, { skipAutoDerive: true }); }
      catch (e) { errors.push("history write failed: " + String(e)); }
    }

    // Compute deltas
    const curRace = actor.system.attributes.race.level ?? 0;
    const curClass = actor.system.attributes.class.level ?? 0;
    const curProf = actor.system.attributes.profession.level ?? 0;
    const deltas = {
      race: Math.max(0, csvRace - curRace),
      class: Math.max(0, csvClass - curClass),
      profession: Math.max(0, csvProf - curProf),
    };

    // Walk each track where delta > 0
    const walkResults = {};
    for (const trk of ["class", "profession", "race"]) {
      if (deltas[trk] <= 0) continue;
      try {
        const r2 = await applyTrackLevelsByHistory(actor, trk, deltas[trk]);
        walkResults[trk] = { delta: deltas[trk], applied: r2.applied, segments: r2.segments };
        if (r2.halted) errors.push(`${trk} walk halted: ${r2.reason}`);
      } catch (e) {
        errors.push(`${trk} walk threw: ` + String(e));
      }
    }

    // Resources to max
    actor.reset();
    const maxUpd = {};
    if (actor.system.health?.max) maxUpd["system.health.value"] = actor.system.health.max;
    if (actor.system.mana?.max)   maxUpd["system.mana.value"] = actor.system.mana.max;
    if (actor.system.stamina?.max)maxUpd["system.stamina.value"] = actor.system.stamina.max;
    if (Object.keys(maxUpd).length > 0) await actor.update(maxUpd, { skipAutoDerive: true });

    results.push({
      csvName, gameName,
      current: { race: curRace, class: curClass, profession: curProf },
      target: { race: csvRace, class: csvClass, profession: csvProf },
      deltas,
      walkResults,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  return { count: results.length, results };
}
