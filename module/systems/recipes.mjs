import { materialCapFor } from '../helpers/formulas.mjs';
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
  return (actor?.items ?? []).filter(i => i.type === 'recipe' && skillCanWork(skill, i));
}

/**
 * May this craft skill work this recipe? TWO gates, and both are needed.
 *
 * 1. TAGS — the discipline. Matched against the skill's tags rather than its
 *    name, so any smith can work a smithing recipe. The world's craft skills
 *    already carry a consistent MATERIAL vocabulary (metal, leather,
 *    clothing, jewelry, gem, wood, alchemy), and that is the vocabulary
 *    recipes should demand: a metal helm wants someone who works metal. No
 *    skill in the world carries a profession-name tag, so requiring one would
 *    make every recipe unworkable (found live 2026-08-27).
 *
 * 2. ALLOWED TYPES — the structure. `craftAllowedTypes` already declares what
 *    a skill can physically produce; without this a tailor whose tags happened
 *    to match could work a greatsword recipe, because the recipe path sets
 *    typeKey directly and never passes through the type picker's filter.
 *    Empty list = no restriction, which is the existing back-compat meaning.
 *
 * ONE predicate for the craft dialog and the Recipe Book both, so what the
 * book offers and what the handler accepts cannot drift apart.
 */
export function skillCanWork(skill, recipe) {
  if (skill?.type !== 'skill') return false;
  const tags = skill.system?.tags ?? [];
  if (!tags.includes('craft')) return false;
  // Alchemy skills BRANCH TO THE BREW FLOW before the recipe picker ever
  // runs (_handleCraftTag's isAlchemySkill short-circuit), so an alchemist
  // holding an equipment formula has a recipe their skill structurally
  // cannot execute — and the Book would offer a Craft button that opens a
  // potion dialog. Found 2026-08-28 when the predicate-driven grant handed
  // Cuirass to the alchemists.
  if (tags.includes('alchemy')) return false;
  const req = recipe?.system?.requiresSkillTags ?? [];
  if (!req.every(t => tags.includes(t))) return false;
  const allowed = skill.system?.craftAllowedTypes ?? [];
  const typeKey = recipe?.system?.output?.typeKey || '';
  if (allowed.length && typeKey && !allowed.includes(typeKey)) return false;
  return true;
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
  const lines = [];                         // per-row have/need, for the UI
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
      units.push({ itemId: item.id, progress: item.system.progress ?? 0,
                   count: take, rarity: item.system.rarity || 'common',
                   cap: materialCapFor(item.system) });
      left -= take;
    }
    const what = [row.itemName || row.material || 'material',
                  row.element ? `(${row.element})` : '',
                  (row.minProgress ?? 0) > 0 ? `${row.minProgress}+` : '']
      .filter(Boolean).join(' ');
    // Counted AFTER reservation, so a bill whose rows compete for one stack
    // reports the shortfall on the row that actually went without.
    lines.push({ label: what, need, have: need - left, ok: left <= 0 });
    if (left > 0) missing.push(`${left} more ${what}`);
  }

  // The PRIMARY ingredient is the best unit of the first row — it stands in
  // for the freehand path's single `materialItem`, so element, output
  // material and image all resolve exactly as they always have.
  const primary = picks[0]?.item ?? null;
  return { ok: missing.length === 0, picks, missing, units, requiredUnits, primary, lines };
}

/**
 * The craft skills this actor could execute a recipe with. The inverse of
 * eligibleRecipes, for the book: a recipe you know but have no skill for is
 * still worth SEEING, greyed out, so "I need to train that" is legible.
 */
export function skillsFor(actor, recipe) {
  return (actor?.items ?? []).filter(i => skillCanWork(i, recipe));
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

/**
 * DISCOVERY IS MATCHING (ruled 2026-08-26: "If a player selects Freehand,
 * Armor, Helm and then puts in 1 iron ingot and rolls a 115, it should match
 * Armor, Helm, 1 Iron Ingot").
 *
 * This is what supplies the "100" that the freeform surcharge is 15% above,
 * and it needs no invented difficulty ladder: the threshold comes from the
 * recipe the improviser was UNKNOWINGLY reproducing. Experimentation is
 * guessing the combination, and the recipe library is the definition of what
 * can be guessed.
 *
 * Does this pile of ingredients satisfy this recipe's bill EXACTLY?
 *
 * Both directions matter. Every row must be covered, and nothing may be left
 * over — throwing a ruby in alongside the iron is a different working, and
 * must not match the plain helm. Rows are matched MOST-CONSTRAINED FIRST so a
 * specific row ("Skysteel Ingot") is not starved by a general one ("any
 * metal") greedily eating its stock.
 */
export function attemptMatchesBill(recipe, picks) {
  const rows = (recipe?.system?.inputs ?? []).map(r => ({
    row: r,
    spec: (r.itemName ? 1 : 0) + (r.element ? 1 : 0)
        + ((r.minProgress ?? 0) > 0 ? 1 : 0) + (r.material ? 1 : 0),
  })).sort((a, b) => b.spec - a.spec);

  const left = new Map();
  const byId = new Map();
  for (const p of (picks ?? [])) {
    left.set(p.item.id, (left.get(p.item.id) ?? 0) + p.count);
    byId.set(p.item.id, p.item);
  }
  if (!rows.length) return left.size === 0;

  for (const { row } of rows) {
    let need = Math.max(1, Number(row.quantity) || 1);
    for (const [id, have] of left) {
      if (need <= 0) break;
      if (have <= 0 || !matchesInput(byId.get(id), row)) continue;
      const take = Math.min(have, need);
      left.set(id, have - take);
      need -= take;
    }
    if (need > 0) return false;                    // a row went uncovered
  }
  for (const have of left.values()) if (have > 0) return false;  // extras spoil it
  return true;
}

/**
 * The recipe an improvised attempt just reproduced, if any: same product
 * type, same bill. Null means this combination is not a formula anyone has
 * written down — there is nothing to discover, and nothing to price against.
 */
export function findMatchingRecipe(library, typeKey, picks) {
  const want = typeKey || '';
  // MOST SPECIFIC WINS (ruled 2026-08-28, the generic-baseline model): one
  // fulgurite ingot matches both the generic Helm (1 any material) and the
  // Fulgurite Helm (1 Fulgurite) — the improviser reproduced the SPECIFIC
  // formula, and the generic must never shadow it.
  const hits = (library ?? []).filter(r =>
    (r.system?.output?.typeKey || '') === want && attemptMatchesBill(r, picks));
  hits.sort((a, b) => recipeSpecificity(b) - recipeSpecificity(a));
  return hits[0] ?? null;
}

/** How constrained a recipe's bill is — the tiebreak when one pile matches
 *  several formulas. A wildcard row scores 0; itemName, element, minProgress
 *  and material each add a point per row. */
export function recipeSpecificity(recipe) {
  return (recipe?.system?.inputs ?? []).reduce((s, r) =>
    s + (r.itemName ? 1 : 0) + (r.element ? 1 : 0)
      + ((r.minProgress ?? 0) > 0 ? 1 : 0) + (r.material ? 1 : 0), 0);
}

/**
 * The SUBSTANCE a material item is a piece of: its name shorn of the
 * bookkeeping — the ` - 221` progress suffix and the `(Uncommon)` rarity
 * annotation. "Fulgurite - 221" and "Fulgurite - 180" are the same substance
 * at different quality, and a minted recipe must treat them as one thing.
 */
export function substanceName(name) {
  return String(name ?? '')
    .replace(/ - \d+$/, '')
    .replace(/\s*\((inferior|common|uncommon|rare|epic|legendary|mythic|divine)\)/i, '')
    .trim();
}

/** A generic recipe is a BASELINE: a single bill row with no pinned
 *  substance. It defines the structure of a product ("a helm is 1 base
 *  material") and exists to be specialized. */
export function isGenericRecipe(recipe) {
  const rows = recipe?.system?.inputs ?? [];
  return rows.length === 1 && !rows[0].itemName;
}

/**
 * SPECIALIZATION (ruled 2026-08-28: "generic recipes... should be the
 * baseline for other recipes... Each subtype of base material requires a
 * recipe or a freeform craft to GENERATE their specific recipe").
 *
 * Improvise a generic's structure with one concrete substance and succeed,
 * and the world gains the specialized formula: Helm worked with Fulgurite
 * mints "Fulgurite Helm" — same threshold, same structure, the substance
 * pinned into the bill. Returns plain recipe DATA (no document side effects)
 * or null when the pile cannot specialize: mixed substances make a plain
 * generic product, not a formula.
 *
 * v1 limitation, on purpose: only single-row generics mint. Specializing a
 * multi-row bill needs a per-row allocation of the pile, and no authored
 * generic has more than one row yet.
 */
export function specializationOf(generic, picks) {
  if (!isGenericRecipe(generic) || !(picks?.length)) return null;
  const first = picks[0].item;
  const sub = substanceName(first.name);
  if (!sub) return null;
  const kind = first.system?.material ?? '';
  const element = first.system?.materialElement ?? '';
  for (const p of picks) {
    if (substanceName(p.item.name) !== sub) return null;
    if ((p.item.system?.material ?? '') !== kind) return null;
    if ((p.item.system?.materialElement ?? '') !== element) return null;
  }
  const row = generic.system.inputs[0];
  const productBase = generic.system.output?.name || generic.system.output?.typeKey || 'Work';
  const productName = `${sub} ${productBase}`;
  return {
    name: productName,
    type: 'recipe',
    img: generic.img,
    system: {
      description: `<p>The ${String(productBase).toLowerCase()} pattern, worked in ${sub}.</p>`,
      profession: generic.system.profession ?? '',
      rarity: first.system?.rarity ?? generic.system.rarity ?? 'common',
      requiresSkillTags: [...(generic.system.requiresSkillTags ?? [])],
      threshold: generic.system.threshold ?? 0,
      minMana: generic.system.minMana ?? 0,
      inputs: [{ material: kind, itemName: sub, element,
                 quantity: row.quantity ?? 1, minProgress: 0 }],
      output: {
        ...structuredClone(generic.system.output ?? {}),
        name: productName,
        material: kind || (generic.system.output?.material ?? ''),
        element,
      },
      source: 'discovered',
      discoveredBy: '',
    },
  };
}

/**
 * The bar this attempt must clear (ruled 2026-08-26: "freecrafting success
 * and recipe unlock should be proportional to each other — say a recipe
 * requires 100 craft quality, freecrafting should take 115 or so").
 *
 * Knowing the recipe does not change what you roll; it lowers the bar. One
 * number, in the same units as everything else in crafting.
 *
 * ⚠ MEASURED REGRESSIVE (sim 2026-08-26): at 1.15 a master keeps 95% of their
 * successes when improvising, a novice only 63%. Defensible — a master can
 * wing it, and recipes matter most to those who have the least — but raising
 * the surcharge to threaten good crafters punishes bad ones several times
 * harder.
 */
export function craftBar(threshold, known, cfg = null) {
  const sc = cfg ?? (globalThis.CONFIG?.ASPECTSOFPOWER ?? {});
  const t = Math.max(0, Number(threshold) || 0);
  if (t <= 0 || known) return t;
  const surcharge = Number(sc.recipeTuning?.freeformSurcharge);
  return Math.round(t * (Number.isFinite(surcharge) && surcharge >= 1 ? surcharge : 1.15));
}

/** Every recipe that exists in the world — the library of what CAN be made. */
export function recipeLibrary() {
  return (globalThis.game?.items ?? []).filter(i => i.type === 'recipe');
}

/** Does this actor already know this recipe? Matched by NAME, since a granted
 *  copy is a different document from the library original. */
export function alreadyKnows(actor, recipe) {
  return (actor?.items ?? []).some(i => i.type === 'recipe' && i.name === recipe?.name);
}

export const RecipeHelpers = {
  eligibleRecipes, matchesInput, resolveIngredients, consumeIngredients,
  attemptMatchesBill, findMatchingRecipe, craftBar, recipeLibrary, alreadyKnows,
  skillsFor, skillCanWork, recipeSpecificity, substanceName, isGenericRecipe,
  specializationOf,
};
