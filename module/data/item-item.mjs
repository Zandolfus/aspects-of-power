const { fields } = foundry.data;

/**
 * Data model for item-type items (gear/equipment).
 */
export class ItemItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
      quantity:    new fields.NumberField({ initial: 1, min: 0, integer: true }),
      weight:      new fields.NumberField({ initial: 0, min: 0 }),
      formula:     new fields.StringField({ initial: 'd20 + @strength.mod + ceil(@level / 2)' }),

      // --- Equipment fields ---
      equipped:    new fields.BooleanField({ initial: false }),
      slot:        new fields.StringField({ initial: '' }),
      rarity:      new fields.StringField({ initial: 'common' }),
      twoHanded:   new fields.BooleanField({ initial: false }),

      durability: new fields.SchemaField({
        value: new fields.NumberField({ initial: 100, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 100, min: 1, integer: true }),
      }),

      // Stat bonuses — array of { ability, value } pairs.
      // When equipped, these become ActiveEffects with effectType:'equipment'.
      statBonuses: new fields.ArrayField(new fields.SchemaField({
        ability: new fields.StringField({ initial: 'strength' }),
        value:   new fields.NumberField({ initial: 0, integer: true }),
      }), { initial: [] }),

      // Defense bonuses provided by equipment.
      armorBonus: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      veilBonus:  new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Augment slots (auto-set from rarity, but stored for override).
      augmentSlots: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      augments: new fields.ArrayField(new fields.SchemaField({
        name:  new fields.StringField({ initial: '' }),
        bonus: new fields.StringField({ initial: '' }),
      }), { initial: [] }),

      // Skill IDs this item grants access to when equipped.
      grantedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Repair kit fields.
      isRepairKit:  new fields.BooleanField({ initial: false }),
      repairAmount: new fields.NumberField({ initial: 25, min: 0, integer: true }),
    };
  }
}
