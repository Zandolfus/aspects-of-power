const { fields } = foundry.data;

/**
 * RECIPE — "a known sequence of ingredients that results in a product"
 * (user, ruling the design 2026-08-26; see design-recipe-system memo).
 *
 * A recipe is an item the crafter CARRIES, so knowing one means holding one.
 * That is what makes knowledge tradeable (a book hands over a copy), visible
 * (it lists on the sheet), and grantable through machinery that already
 * exists — `grantedSkills` on equipment and template-grants for professions.
 *
 * Crafting is RECIPE-ONLY: every output is an authored recipe. Recipes reach
 * a crafter three ways, and all three are content rather than engine
 * exceptions:
 *   1. taking a profession grants its starter set,
 *   2. a recipe book grants copies,
 *   3. a successful FREEFORM experiment generates one (`discovered`).
 */
export class RecipeData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // ── WHO MAY EXECUTE IT ──────────────────────────────────────────────
      // Matched against the executing craft skill's TAGS, not its name: any
      // smithing skill should be able to work a smithing recipe, and naming
      // one skill would make every recipe a per-character artifact. Empty =
      // any craft skill may attempt it.
      requiresSkillTags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      // Optional floor on the executing skill's own roll, for recipes that
      // are simply beyond a novice regardless of materials. 0 = no floor.
      requiresSkillProgress: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // ── THE BILL OF MATERIALS ───────────────────────────────────────────
      // One row per ingredient. `material` is a materialTypes key (metal,
      // gem, crystal...); `itemName` optionally pins a SPECIFIC material by
      // name for recipes that call for one particular substance; `element`
      // optionally demands an affinity. `quantity` is the MINIMUM — pouring
      // in more is the quality lever (ruling 4), not a way to cheat the bill.
      //
      // ⚠ `minProgress` gates the QUALITY of each ingredient, and is the
      // reason a recipe can demand "good steel" rather than merely "steel".
      inputs: new fields.ArrayField(new fields.SchemaField({
        material:    new fields.StringField({ initial: '' }),
        itemName:    new fields.StringField({ initial: '' }),
        element:     new fields.StringField({ initial: '' }),
        quantity:    new fields.NumberField({ initial: 1, min: 1, integer: true }),
        minProgress: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      }), { initial: [] }),

      // Mana as an ingredient. Same semantics as tagConfig.craftMinMana on
      // the skill (shipped 7e9e01f) — a floor below which the recipe cannot
      // be attempted, and a quality curve above it. The RECIPE's floor takes
      // precedence over the skill's when both are set: the formula is a
      // property of what is being made.
      minMana: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // ── THE GATE (ruling 5: threshold failure, ritual-shaped) ───────────
      // Minimum total progress for the attempt to produce anything. Miss it
      // and the ingredients are gone — which is what gives a rare recipe its
      // teeth. 0 = ungated (a recipe anyone can execute badly but not fail).
      threshold: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // ── THE PRODUCT ─────────────────────────────────────────────────────
      // `typeKey` is a craftItemTypes key and drives slot, stat budget and
      // defence routing exactly as the freehand path does today — the recipe
      // fixes the item's IDENTITY, while progress still decides how good this
      // particular copy is. A bad crafter makes a poor Skysteel Dagger, not a
      // different item.
      output: new fields.SchemaField({
        name:     new fields.StringField({ initial: '' }),
        img:      new fields.StringField({ initial: '' }),
        typeKey:  new fields.StringField({ initial: '' }),
        material: new fields.StringField({ initial: '' }),
        element:  new fields.StringField({ initial: '' }),
        quantity: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        // Free-form tags stamped on the product on top of the type's own.
        tags:     new fields.ArrayField(new fields.StringField(), { initial: [] }),
        // Authored extras a freehand craft cannot produce: augments built
        // into the product, and skills it grants while equipped. Both are
        // UUID lists resolved at craft time against machinery that already
        // ships (augment slotting, equipment._grantSkills).
        augments:      new fields.ArrayField(new fields.StringField(), { initial: [] }),
        grantedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      }),

      // ── PROVENANCE ──────────────────────────────────────────────────────
      // 'authored' — written by a designer, the real formula.
      // 'discovered' — generated by a successful freeform experiment, and so
      //   a record of what that crafter actually did rather than of the best
      //   way to do it. Kept distinct so a discovered recipe can later be
      //   compared against, or refined toward, the authored one.
      // ⚠ Plain StringField with NO `choices` — a choices list silently
      // rejected a pack create on 08-24 and vaporised the world once before
      // that (e4c333b). Extend by convention, validate in code if ever.
      source:        new fields.StringField({ initial: 'authored' }),
      discoveredBy:  new fields.StringField({ initial: '' }),
      // Free-form profession label for grouping on the sheet and in books.
      profession:    new fields.StringField({ initial: '' }),
      rarity:        new fields.StringField({ initial: 'common' }),
    };
  }
}
