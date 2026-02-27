const { fields } = foundry.data;

const abilityGainsSchema = () => new fields.SchemaField({
  vitality:     new fields.NumberField({ initial: 0, integer: true }),
  endurance:    new fields.NumberField({ initial: 0, integer: true }),
  strength:     new fields.NumberField({ initial: 0, integer: true }),
  dexterity:    new fields.NumberField({ initial: 0, integer: true }),
  toughness:    new fields.NumberField({ initial: 0, integer: true }),
  intelligence: new fields.NumberField({ initial: 0, integer: true }),
  willpower:    new fields.NumberField({ initial: 0, integer: true }),
  wisdom:       new fields.NumberField({ initial: 0, integer: true }),
  perception:   new fields.NumberField({ initial: 0, integer: true }),
});

const freePointsField = () => new fields.NumberField({ initial: 0, min: 0, integer: true });

/**
 * Data model for class template items.
 * Defines per-rank stat gains and free points for each level.
 */
export class ClassData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      rankGains: new fields.SchemaField({
        G: abilityGainsSchema(),
        F: abilityGainsSchema(),
        E: abilityGainsSchema(),
        D: abilityGainsSchema(),
        C: abilityGainsSchema(),
        B: abilityGainsSchema(),
        A: abilityGainsSchema(),
        S: abilityGainsSchema(),
      }),

      freePointsPerLevel: new fields.SchemaField({
        G: freePointsField(),
        F: freePointsField(),
        E: freePointsField(),
        D: freePointsField(),
        C: freePointsField(),
        B: freePointsField(),
        A: freePointsField(),
        S: freePointsField(),
      }),
    };
  }
}
