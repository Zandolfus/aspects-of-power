const { fields } = foundry.data;

/**
 * Data model for augment items — slottable enhancements for equipment.
 */
export class AugmentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // Stat bonuses — same {ability, value} schema as equipment statBonuses.
      // These add to the actor's stats via the equipment's ActiveEffect.
      statBonuses: new fields.ArrayField(new fields.SchemaField({
        ability: new fields.StringField({ initial: 'strength' }),
        value:   new fields.NumberField({ initial: 0, integer: true }),
      }), { initial: [] }),

      // Item bonuses — modify the host equipment item's own properties.
      // e.g. +5% armorBonus on the item itself, not the actor directly.
      itemBonuses: new fields.ArrayField(new fields.SchemaField({
        field: new fields.StringField({ initial: 'armorBonus' }),
        value: new fields.NumberField({ initial: 0 }),
        mode:  new fields.StringField({ initial: 'percentage' }),
      }), { initial: [] }),

      // Profession augment flag — only fits in profession augment slots.
      isProfessionAugment: new fields.BooleanField({ initial: false }),

      // Craft bonuses applied when the augment is equipped on profession gear.
      // affinity (optional): only applies when material/output element matches.
      craftBonuses: new fields.ArrayField(new fields.SchemaField({
        type:     new fields.StringField({ initial: 'craftProgress' }),
        value:    new fields.NumberField({ initial: 0 }),
        affinity: new fields.StringField({ initial: '' }),
      }), { initial: [] }),
    };
  }
}
