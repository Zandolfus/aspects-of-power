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

      // Additional slots — item can be cross-listed in multiple slot types.
      // E.g. a hammer in 'weaponry' (combat) can also be in 'profWeapon' (profession).
      additionalSlots: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      rarity:      new fields.StringField({ initial: 'common' }),
      twoHanded:   new fields.BooleanField({ initial: false }),

      // Material type — determines which repair skills can target this item.
      material:    new fields.StringField({ initial: '' }),

      // Progress determines derived values (durability max, stats in the future).
      progress:    new fields.NumberField({ initial: 0, min: 0, integer: true }),

      durability: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 0, min: 0, integer: true }),
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
        augmentId: new fields.StringField({ initial: '' }),
      }), { initial: [] }),

      // Profession augment slots — additional slots on profession gear that
      // ONLY accept augments tagged as profession augments.
      profAugmentSlots: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      profAugments: new fields.ArrayField(new fields.SchemaField({
        augmentId: new fields.StringField({ initial: '' }),
      }), { initial: [] }),

      // Skill IDs this item grants access to when equipped.
      grantedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // System tags (affinities, resistances, passives from equipment) — registry-backed.
      systemTags: new fields.ArrayField(new fields.SchemaField({
        id:    new fields.StringField({ initial: '' }),
        value: new fields.NumberField({ initial: 0 }),
      }), { initial: [] }),

      // Free-form tags (weapon/armor/material/element identifiers — same shape as skill.tags).
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Repair kit fields.
      isRepairKit:  new fields.BooleanField({ initial: false }),
      repairAmount: new fields.NumberField({ initial: 25, min: 0, integer: true }),

      // Crafting material fields.
      isMaterial:      new fields.BooleanField({ initial: false }),
      isRefined:       new fields.BooleanField({ initial: false }),
      materialElement: new fields.StringField({ initial: '' }),
      maxProgress:     new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Crafting iteration tracking — 0 = freshly crafted, increments per rework.
      reworkCount:     new fields.NumberField({ initial: 0, min: 0, integer: true }),
    };
  }
}
