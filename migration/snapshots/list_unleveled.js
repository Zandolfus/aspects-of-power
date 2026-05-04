() => {
  const PC_NAMES = new Set(["Phil", "John", "Willy", "Gabriel", "Felicia", "Harvey McKay"]);
  const SKIP_FOLDERS = new Set(["0. Dead", "Player Actors"]);
  const buckets = {
    friendly_no_template: [],
    friendly_monster_race: [],
    friendly_dead_or_player_folder: [],
    hostile: [],
    neutral: [],
    secret: [],
    unknown_disposition: [],
  };
  for (const a of game.actors) {
    if (PC_NAMES.has(a.name)) continue;
    const disp = a.prototypeToken?.disposition;
    const folder = a.folder?.name ?? "(none)";
    const race = a.system.attributes?.race;
    const cls = a.system.attributes?.class;
    const prof = a.system.attributes?.profession;
    const raceName = (race?.name || "").toLowerCase();
    const isMonster = raceName.includes("monster");
    const inSkipFolder = SKIP_FOLDERS.has(folder);
    const hasAllTpls = !!(race?.templateId && cls?.templateId && prof?.templateId);

    const entry = {
      name: a.name, folder,
      race: race?.name, raceLvl: race?.level ?? 0,
      classLvl: cls?.level ?? 0, profLvl: prof?.level ?? 0,
      hasTpls: hasAllTpls,
    };

    if (disp === 1) {
      // friendly
      if (inSkipFolder) buckets.friendly_dead_or_player_folder.push(entry);
      else if (isMonster) buckets.friendly_monster_race.push(entry);
      else if (!hasAllTpls) buckets.friendly_no_template.push(entry);
      // else: was leveled — skip
    } else if (disp === -1) {
      buckets.hostile.push(entry);
    } else if (disp === 0) {
      buckets.neutral.push(entry);
    } else if (disp === -2) {
      buckets.secret.push(entry);
    } else {
      buckets.unknown_disposition.push({ ...entry, disposition: disp });
    }
  }
  // Top folders for hostile (since there are many)
  const hostileFolders = {};
  for (const e of buckets.hostile) hostileFolders[e.folder] = (hostileFolders[e.folder] || 0) + 1;
  return {
    counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    friendly_no_template: buckets.friendly_no_template,
    friendly_monster_race: buckets.friendly_monster_race,
    friendly_dead_or_player_folder: buckets.friendly_dead_or_player_folder,
    neutral: buckets.neutral,
    secret: buckets.secret,
    unknown_disposition: buckets.unknown_disposition,
    hostile_folders: Object.fromEntries(Object.entries(hostileFolders).sort((a, b) => b[1] - a[1])),
  };
}
