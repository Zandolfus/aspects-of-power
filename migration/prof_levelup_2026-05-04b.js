async () => {
  const TARGETS = {
    "Lincoln Christensen": 80,
    "Bruce Bradley":       78,
    "Rosalie Flynn":       78,
    "Bridget Sutherland":  76,
    "Damian Flynn":        70,
    "Woody Dalton":        62,
    "Amina Wright":        60,
    "Deanna Mendez":       56,
    "Mary":                54,
    "Olivia":              54,
  };
  const { applyTrackLevelsByHistory } = await import("/systems/aspects-of-power/module/systems/mass-leveler.mjs");
  const results = [];
  for (const [name, target] of Object.entries(TARGETS)) {
    const a = game.actors.find(x => x.name === name);
    if (!a) { results.push({ name, error: "not found" }); continue; }
    const cur = a.system.attributes.profession.level ?? 0;
    const delta = target - cur;
    if (delta <= 0) { results.push({ name, current: cur, target, status: "no-op" }); continue; }
    try {
      const r = await applyTrackLevelsByHistory(a, "profession", delta);
      a.reset();
      // Cap HP/MP/SP to max
      const maxUpd = {
        "system.health.value":  a.system.health.max,
        "system.mana.value":    a.system.mana.max,
        "system.stamina.value": a.system.stamina.max,
      };
      await a.update(maxUpd, { skipAutoDerive: true });
      results.push({
        name, current: cur, target, delta,
        applied: r.applied,
        segments: r.segments,
        halted: r.halted, reason: r.reason,
        finalLevel: a.system.attributes.profession.level,
      });
    } catch (e) {
      results.push({ name, current: cur, target, error: String(e) });
    }
  }
  return { count: results.length, results };
}
