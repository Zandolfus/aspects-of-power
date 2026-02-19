const { fields } = foundry.data;

/**
 * Data model for npc-type actors.
 */
export class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const resourceSchema = (valueInitial, maxInitial) => new fields.SchemaField({
      value: new fields.NumberField({ initial: valueInitial, min: 0, integer: true }),
      min:   new fields.NumberField({ initial: 0, min: 0, integer: true }),
      max:   new fields.NumberField({ initial: maxInitial, min: 0, integer: true }),
    });

    return {
      health:    resourceSchema(5, 10),
      stamina:   resourceSchema(5, 10),
      mana:      resourceSchema(5, 5),
      biography: new fields.HTMLField({ initial: '' }),
      cr:        new fields.NumberField({ initial: 0, min: 0, integer: true }),
    };
  }
}
