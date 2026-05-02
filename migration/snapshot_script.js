() => {
  const actors = game.actors.contents;
  const snapshot = actors.map(a => {
    const ab = a.system.abilities ?? {};
    const attrs = a.system.attributes ?? {};
    const out = {
      id: a.id,
      name: a.name,
      type: a.type,
      race: {
        rank: attrs.race?.rank ?? null,
        level: attrs.race?.level ?? null,
        name: attrs.race?.name ?? null,
        templateId: attrs.race?.templateId ?? null,
      },
      class: {
        level: attrs.class?.level ?? null,
        name: attrs.class?.name ?? null,
        templateId: attrs.class?.templateId ?? null,
      },
      profession: {
        level: attrs.profession?.level ?? null,
        name: attrs.profession?.name ?? null,
        templateId: attrs.profession?.templateId ?? null,
      },
      health: a.system.health ?? null,
      mana: a.system.mana ?? null,
      stamina: a.system.stamina ?? null,
      overhealth: a.system.overhealth ?? null,
      reactions: a.system.reactions ?? null,
      freePoints: a.system.freePoints ?? null,
      abilities: {},
    };
    for (const stat of ['vitality','endurance','strength','dexterity','toughness','intelligence','willpower','wisdom','perception']) {
      out.abilities[stat] = {
        value: ab[stat]?.value ?? null,
        mod: ab[stat]?.mod ?? null,
      };
    }
    return out;
  });
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    foundryVersion: game.version,
    systemVersion: game.system?.version ?? null,
    worldTitle: game.world.title,
    actorCount: actors.length,
    actors: snapshot,
  });
}
