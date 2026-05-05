async () => {
  const SKIP_NAMES = new Set(["Phil", "Felicia", "Harvey McKay"]);
  const NAME_ALIASES = {
    "Damien": "Damian Flynn", "Rosaly": "Rosalie Flynn", "Frida": "Frieda",
    "Aiden": "Aiden Fig", "Valentine": "Valentine Fig", "Bruce": "Bruce Bradley",
    "Bridget": "Bridget Sutherland", "Lincoln": "Lincoln Christensen",
    "Damian": "Damian Flynn", "Woody": "Woody Dalton", "Deanna": "Deanna Mendez",
    "Fei": "Faye",
  };
  function parseCsv(text) {
    const rows = []; let row = []; let cell = ""; let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cell += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(cell); cell = ""; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
        else if (c === '\r') {} else cell += c;
      }
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  const r = await fetch("/systems/aspects-of-power/python/Test/all_chars_leveled_test.csv?t=" + Date.now());
  const rows = parseCsv(await r.text());
  const h = rows[0];
  const ix = { name: h.indexOf("Name"), cls: h.indexOf("Class level"), prof: h.indexOf("Profession level"), race: h.indexOf("Race level") };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row[ix.name]) continue;
    const csvName = row[ix.name].trim();
    const skip = SKIP_NAMES.has(csvName) ? "PC" : "";
    const gameName = NAME_ALIASES[csvName] || csvName;
    const actor = game.actors.find(a => a.name === gameName);
    const status = skip || (!actor ? "NOT_FOUND" : "");
    const csvR = parseInt(row[ix.race], 10) || 0;
    const csvC = parseInt(row[ix.cls], 10) || 0;
    const csvP = parseInt(row[ix.prof], 10) || 0;
    const curR = actor?.system.attributes.race?.level ?? 0;
    const curC = actor?.system.attributes.class?.level ?? 0;
    const curP = actor?.system.attributes.profession?.level ?? 0;
    out.push({ csvName, gameName, status, race: { cur: curR, csv: csvR, delta: Math.max(0, csvR - curR) }, cls: { cur: curC, csv: csvC, delta: Math.max(0, csvC - curC) }, prof: { cur: curP, csv: csvP, delta: Math.max(0, csvP - curP) } });
  }
  return out;
}
