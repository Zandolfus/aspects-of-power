const { fields } = foundry.data;

/**
 * Data model for augment items — slottable enhancements for equipment.
 */
export class AugmentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // Stat bonuses — same {ability, value} schema as equipment statBonuses.
      statBonuses: new fields.ArrayField(new fields.SchemaField({
        ability: new fields.StringField({ initial: 'strength' }),
        value:   new fields.NumberField({ initial: 0, integer: true }),
      }), { initial: [] }),
    };
  }
}
