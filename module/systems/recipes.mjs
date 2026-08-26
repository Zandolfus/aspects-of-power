/**
 * RECIPES — "a known sequence of ingredients that results in a product"
 * (design-recipe-system, RULED 2026-08-26).
 *
 * A recipe is an Item the crafter CARRIES, so knowing one means holding one.
 * This module answers the three questions the craft handler needs:
 *   1. which recipes may THIS skill work?
 *   2. does the crafter have the ingredients?
 *   3. what bar must this attempt clear?
 *
 * It deliberately does NOT build the product. The recipe pre-fills the
 * choices the craft dialogs would have made (type, slot, material) and the
 * shipped craft math runs unchanged on top — so a recipe-made item and a
 * freehand item are the same item, priced by the same formulas. Duplicating
 * that math to "own" recipe output would guarantee the two drift.
 */

/**
 * Recipes this actor knows that this craft skill is allowed to work.
 *
 * Matched by TAG, never by skill name: any smithing skill should be able to
 * work a smithing recipe, and naming one skill would make every recipe a
 * per-character artifact. A recipe with no required tags is universal.
 */
export function eligibleRecipes(actor, skill) {
  const skillTags = new Set(skill?.system?.tags ?? []);
  return (actor?.items ?? []).filter(i => {
    if (i.type !== 'recipe') return false;
    const req = i.system?.requiresSkillTags ?? [];
    return req.every(t => skillTags.has(t));
  });
}

/**
 * Does one inventory item satisfy one ingredient row?
 *
 * Every declared constraint must hold; an unset constraint is a wildcard, so
 * a bare `{material: 'metal', quantity: 2}` means "any two metal".
 * `minProgress` is what lets a recipe demand GOOD steel rather than merely
 * steel — the reason a recipe can be beyond a crafter's current stock.
 */
export function matchesInput(item, row) {
  if (item?.type !== 'item' || !item.system?.isMaterial) return false;
  if (row.material && item.system.material !== row.material) return false;
  if (row.element && (item.system.materialElement || '') !== row.element) return false;
  if (row.itemName && !item.name.toLowerCase().includes(row.itemName.toLowerCase())) return false;
  if ((row.minProgress ?? 0) > 0 && (item.system.progress ?? 0) < row.minProgress) return false;
  return true;
}

/**
 * Resolve a recipe's whole bill against an actor's inventory.
 *
 * Picks the BEST stock first (highest progress), because ingredient quality
 * is the quantity-weighted mean and the crafter would obviously reach for
 * their best. ⚠ Reserves across rows: one physical stack cannot satisfy two
 * ingredient rows at once, or a bill of "2 metal + 2 metal" would pass on a
 * single pair.
 *
 * @returns {{ok:boolean, picks:Array<{item:Item,count:number}>,
 *            missing:string[], units:Array<{progress:number,count:number}>,
 *            requiredUnits:number, primary:Item|null}}
 */
export function resolveIngredients(actor, recipe) {
  const rows = recipe?.system?.inputs ?? [];
  const reserved = new Map();               // itemId -> units already claimed
  const picks = [];
  const missing = [];
  const units = [];
  let requiredUnits = 0;

  for (const row of rows) {
    const need = Math.max(1, Number(row.quantity) || 1);
    requiredUnits += need;
    const candidates = (actor?.items ?? [])
      .filter(i => matchesInput(i, row))
      .sort((a, b) => (b.system.progress ?? 0) - (a.system.progress ?? 0));

    let left = need;
    for (const item of candidates) {
      if (left <= 0) break;
      const have = Math.max(0, (item.system.quantity ?? 1) - (reserved.get(item.id) ?? 0));
      if (have <= 0) continue;
      const take = Math.min(have, left);
      reserved.set(item.id, (reserved.get(item.id) ?? 0) + take);
      picks.push({ item, count: take });
      units.push({ progress: item.system.progress ?? 0, count: take });
      left -= take;
    }
    if (left > 0) {
      const what = [row.itemName || row.material || 'material',
                    row.element ? `(${row.element})` : '',
                    (row.minProgress ?? 0) > 0 ? `progress ${row.minProgress}+` : '']
        .filter(Boolean).join(' ');
      missing.push(`${left} more ${what}`);
    }
  }

  // The PRIMARY ingredient is the best unit of the first row — it stands in
  // for the freehand path's single `materialItem`, so element, output
  // material and image all resolve exactly as they always have.
  const primary = picks[0]?.item ?? null;
  return { ok: missing.length === 0, picks, missing, units, requiredUnits, primary };
}

/**
 * Consume a resolved bill. Re-checks live quantities first, because dialogs
 * were open in between and stock may have moved — the same guard the inscribe
 * path uses, and for the same reason.
 *
 * @returns {Promise<boolean>} false if anything had moved; NOTHING is consumed
 *          in that case, so the caller can abort cleanly.
 */
export async function consumeIngredients(actor, picks) {
  const tally = new Map();
  for (const { item, count } of picks) {
    tally.set(item.id, (tally.get(item.id) ?? 0) + count);
  }
  for (const [id, n] of tally) {
    const live = actor.items.get(id);
    if (!live || (live.system.quantity ?? 1) < n) return false;
  }
  for (const [id, n] of tally) {
    const live = actor.items.get(id);
    const q = live.system.quantity ?? 1;
    if (q <= n) await live.delete();
    else await live.update({ 'system.quantity': q - n });
  }
  return true;
}

/*
 * ⚠ NOT HERE YET — THE FREEFORM SURCHARGE (ruled 2026-08-26: "freecrafting
 * success and recipe unlock should be proportional to each other. Say a
 * recipe requires 100 craft quality, freecrafting should take 115 or so").
 *
 * The rule is settled and simmed; what is NOT settled is where the 100 comes
 * from when you are improvising, because the recipe that would carry the
 * threshold is the thing you are trying to invent. That needs a baseline
 * difficulty per product, which is a separate ruling. Deliberately left
 * unbuilt rather than shipped as a dial with no reader — see the memo.
 */

export const RecipeHelpers = {
  eligibleRecipes, matchesInput, resolveIngredients, consumeIngredients,
};
