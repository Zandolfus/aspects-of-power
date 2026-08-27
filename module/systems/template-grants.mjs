/**
 * Template grants — skills and weapon proficiencies conferred by an actor's
 * class / race / profession templates.
 *
 * WHY THIS EXISTS: `grantedSkills` has been on the class, race and profession
 * schemas for a long time and 242 grants across the live world were perfectly
 * in sync with it — but nothing in the engine ever read it. The schema comment
 * pointed at `migration/local/sync_granted_skills.js`, a hand-run utility in a
 * gitignored directory that no longer exists. The data was being maintained by
 * a script nobody could run any more. This is that utility, rebuilt as real
 * code so it cannot go missing again.
 *
 * TEMPLATE GRANTS ARE CUMULATIVE AND ONE-WAY. Equipment grants are revoked on
 * unequip (`EquipmentSystem._removeGrantedSkills`), because putting a sword
 * down takes its skills with it. A class does not work that way: `class.history`
 * is an ordered record of everything you have ever been, and the training stays.
 * So this never deletes — it only ever adds what is missing.
 *
 * DEDUPE IS BY NAME, deliberately. The 242 existing grants were applied by hand
 * and carry no provenance flags, so a flag-only check would duplicate every one
 * of them on the first run. New grants do get flagged, for later archaeology.
 *
 * Console usage:
 *   const T = game.aspectsofpower.templateGrants;
 *   await T.syncTemplateGrants(actor, { dryRun: true });   // report only
 *   await T.syncAll({ dryRun: true });                     // whole world
 */

const TRACKS = ['class', 'race', 'profession'];
const FLAG_SCOPE = 'aspectsofpower';

/** Every template an actor has ever held on a track: history plus current. */
async function templatesFor(actor, track) {
  const attr = actor?.system?.attributes?.[track];
  if (!attr) return [];
  const ids = new Set();
  for (const h of (attr.history ?? [])) if (h?.templateId) ids.add(h.templateId);
  if (attr.templateId) ids.add(attr.templateId);

  const out = [];
  for (const id of ids) {
    try {
      const doc = await fromUuid(id);
      if (doc) out.push(doc);
    } catch { /* pack unavailable — skip rather than fail the whole sync */ }
  }
  return out;
}

/**
 * Resolve the proficiency tiers a set of templates confers, best tier winning
 * where they overlap. Mirrors `weapon-styles.proficiencyFor`: mastery is the
 * rarity ladder, so advancing a class can only ever raise a proficiency —
 * matching the design notes' "gain Uncommon Archery IF NOT ALREADY".
 *
 * @returns {Map<string,string>} weapon type -> rarity
 */
function resolveProfTiers(templates) {
  const order = CONFIG.ASPECTSOFPOWER?.skillRarityOrder ?? [];
  const best = new Map();
  for (const t of templates) {
    for (const g of (t?.system?.profGrants ?? [])) {
      if (!g?.type || !g?.rarity) continue;
      const cur = best.get(g.type);
      if (!cur || order.indexOf(g.rarity) > order.indexOf(cur)) best.set(g.type, g.rarity);
    }
  }
  return best;
}

/**
 * Bring one actor in line with everything their templates confer.
 *
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]  Report without writing.
 * @param {string[]} [opts.tracks] Restrict to some tracks.
 * @returns {Promise<object>} what was (or would be) done
 */
export async function syncTemplateGrants(actor, { dryRun = false, tracks = TRACKS } = {}) {
  const report = { actor: actor?.name, skills: [], proficiencies: [], upgrades: [], skipped: [] };
  if (!actor) return report;

  const ownedSkillNames = new Set(
    actor.items.filter(i => i.type === 'skill').map(i => i.name));
  // Recipes dedupe by name in their own namespace — a formula and a skill can
  // share a name (Smithing the skill, "Smithing" nothing), and collapsing them
  // into one set would have one silently suppress the other.
  const ownedRecipeNames = new Set(
    actor.items.filter(i => i.type === 'recipe').map(i => i.name));
  const toCreate = [];
  const allTemplates = [];

  for (const track of tracks) {
    const templates = await templatesFor(actor, track);
    allTemplates.push(...templates);

    for (const tpl of templates) {
      for (const uuid of (tpl.system?.grantedSkills ?? [])) {
        if (!uuid) continue;
        let src = null;
        try { src = await fromUuid(uuid); } catch { /* broken link */ }
        if (!src || src.type !== 'skill') { report.skipped.push(`broken grant on ${tpl.name}: ${uuid}`); continue; }
        // Name dedupe: the pre-existing hand-applied grants carry no flags.
        if (ownedSkillNames.has(src.name)) continue;
        ownedSkillNames.add(src.name);
        const data = src.toObject();
        delete data._id;
        foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantedByTemplate`, tpl.uuid);
        foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantedFrom`, uuid);
        toCreate.push(data);
        report.skills.push(`${src.name} (from ${tpl.name})`);
      }

      // Starter recipes (ruled 2026-08-26). Same shape as the skill grant
      // above deliberately — a formula arrives the way a skill does.
      for (const uuid of (tpl.system?.grantedRecipes ?? [])) {
        if (!uuid) continue;
        let src = null;
        try { src = await fromUuid(uuid); } catch { /* broken link */ }
        if (!src || src.type !== 'recipe') {
          report.skipped.push(`broken recipe grant on ${tpl.name}: ${uuid}`);
          continue;
        }
        if (ownedRecipeNames.has(src.name)) continue;
        ownedRecipeNames.add(src.name);
        const data = src.toObject();
        delete data._id;
        foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantedByTemplate`, tpl.uuid);
        foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantedFrom`, uuid);
        toCreate.push(data);
        (report.recipes ??= []).push(`${src.name} (from ${tpl.name})`);
      }
    }
  }

  // ── Weapon proficiencies, which a plain UUID list cannot express: the same
  // Sword Proficiency is `common` for a Heavy Warrior's two-handers and
  // `inferior` for their one-handers, so the TIER has to travel with the grant.
  const tiers = resolveProfTiers(allTemplates);
  if (tiers.size) {
    const pack = game.packs.get('world.skills');
    const profSources = new Map();
    if (pack) {
      for (const d of await pack.getDocuments()) {
        const pf = d._source?.system?.tagConfig?.profFor;
        if (pf) profSources.set(pf, d);
      }
    }
    const order = CONFIG.ASPECTSOFPOWER?.skillRarityOrder ?? [];
    for (const [type, rarity] of tiers) {
      const owned = actor.items.find(i => i.type === 'skill' && i.system?.tagConfig?.profFor === type);
      if (owned) {
        // Upgrade only — a class advancement must never demote you.
        if (order.indexOf(rarity) > order.indexOf(owned.system.rarity)) {
          report.upgrades.push(`${type}: ${owned.system.rarity} -> ${rarity}`);
          if (!dryRun) await owned.update({ 'system.rarity': rarity });
        }
        continue;
      }
      const src = profSources.get(type);
      if (!src) { report.skipped.push(`no proficiency authored for '${type}'`); continue; }
      const data = src.toObject();
      delete data._id;
      data.system.rarity = rarity;
      foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantedByTemplate`, 'profGrants');
      toCreate.push(data);
      report.proficiencies.push(`${type}:${rarity}`);
    }
  }

  if (toCreate.length && !dryRun) await actor.createEmbeddedDocuments('Item', toCreate);
  report.created = toCreate.length;
  report.dryRun = dryRun;
  return report;
}

/**
 * Sync every player-owned actor (or all actors with `includeNpcs`).
 * @param {object} [opts]
 * @returns {Promise<object[]>}
 */
export async function syncAll({ dryRun = false, includeNpcs = false, tracks = TRACKS } = {}) {
  const out = [];
  for (const a of game.actors) {
    if (!includeNpcs && !a.hasPlayerOwner) continue;
    const r = await syncTemplateGrants(a, { dryRun, tracks });
    if (r.created || r.upgrades.length || r.skipped.length) out.push(r);
  }
  return out;
}

export const TemplateGrants = { syncTemplateGrants, syncAll, resolveProfTiers };
