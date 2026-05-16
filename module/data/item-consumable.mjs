const { fields } = foundry.data;

/**
 * Data model for consumable-type items (potions, bombs, poisons, scrolls, etc.).
 */
export class ConsumableData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
      quantity:    new fields.NumberField({ initial: 1, min: 0, integer: true }),
      weight:      new fields.NumberField({ initial: 0, min: 0 }),
      rarity:      new fields.StringField({ initial: 'common' }),

      // What kind of consumable this is.
      consumableType: new fields.StringField({ initial: 'potion' }),

      // Charges per unit (e.g. a wand with 10 charges). 0 = single-use (consumed on use).
      charges: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),

      // --- Effect configuration ---
      // The effect this consumable produces when used.
      effectType: new fields.StringField({ initial: 'restoration' }),

      // Restoration: which resource to restore and by how much.
      restoration: new fields.SchemaField({
        resource: new fields.StringField({ initial: 'health' }),
        amount:   new fields.NumberField({ initial: 0, min: 0, integer: true }),
        overhealth: new fields.BooleanField({ initial: false }),
      }),

      // Buff: stat changes + duration.
      buff: new fields.SchemaField({
        entries: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ initial: 'abilities.strength' }),
          value:     new fields.NumberField({ initial: 0, integer: true }),
        }), { initial: [] }),
        duration: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      }),

      // Poison: applied to a weapon, adds damage/debuff to next N attacks.
      poison: new fields.SchemaField({
        damage:     new fields.NumberField({ initial: 0, min: 0, integer: true }),
        damageType: new fields.StringField({ initial: 'physical' }),
        duration:   new fields.NumberField({ initial: 3, integer: true, min: 1 }),
      }),

      // Barrier: creates a barrier on the user with a fixed HP value.
      barrier: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      }),

      // Bomb: AOE damage on throw.
      bomb: new fields.SchemaField({
        damage:     new fields.NumberField({ initial: 0, min: 0, integer: true }),
        damageType: new fields.StringField({ initial: 'physical' }),
        shape:      new fields.StringField({ initial: 'circle' }),
        diameter:   new fields.NumberField({ initial: 10, min: 5, integer: true }),
      }),

      // Repair Kit: how much durability is restored per use.
      repairAmount: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Ritual: a physical item (gem, inscribed circle, etc.) that encodes a
      // ritual skill. Activated in-combat by consuming one charge; fires the
      // referenced skill with granted-skill timing (1/3 reference round).
      // Charges track uses remaining; when value hits 0 the item is depleted.
      // See design-ritual-subsystem.md.
      //
      // Phase 2.5 fields:
      //   mediumType  — drives range/geometry behavior at activation.
      //     gem    = held / touch range (no placement step)
      //     circle = scene-anchored AOE (placed at prep time, fires from
      //              the inscribed location; range derived from placement)
      //     pylon  = long-range network node (deferred)
      //   ritualPower — strength stored on the Medium at prep time. Equal
      //     to the achieved progress, clamped to the ritual's quality cap
      //     (rarity-derived). Passed into activation as preInvestAmount so
      //     the existing roll pipeline scales effect strength accordingly.
      ritualSkillId: new fields.StringField({ initial: '' }),
      mediumType:    new fields.StringField({ initial: 'gem' }),
      ritualPower:   new fields.NumberField({ initial: 0, min: 0, integer: true }),
    };
  }
}
