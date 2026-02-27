const { fields } = foundry.data;

/**
 * Data model for class template items.
 * Each class is rank-specific — it defines stat gains per level for a single rank.
 * At rank breakpoints the GM assigns a new class template.
 */
export class ClassData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // Which rank this class is for (G, F, E, D, C, B, A, S).
      rank: new fields.StringField({ initial: 'G' }),

      // Stat gains per level within this rank.
      gains: new fields.SchemaField({
        vitality:     new fields.NumberField({ initial: 0, integer: true }),
        endurance:    new fields.NumberField({ initial: 0, integer: true }),
        strength:     new fields.NumberField({ initial: 0, integer: true }),
        dexterity:    new fields.NumberField({ initial: 0, integer: true }),
        toughness:    new fields.NumberField({ initial: 0, integer: true }),
        intelligence: new fields.NumberField({ initial: 0, integer: true }),
        willpower:    new fields.NumberField({ initial: 0, integer: true }),
        wisdom:       new fields.NumberField({ initial: 0, integer: true }),
        perception:   new fields.NumberField({ initial: 0, integer: true }),
      }),

      // Free points gained per level within this rank.
      freePointsPerLevel: new fields.NumberField({ initial: 0, min: 0, integer: true }),
    };
  }
}
