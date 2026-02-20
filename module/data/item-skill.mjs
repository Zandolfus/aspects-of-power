const { fields } = foundry.data;

/**
 * Data model for skill-type items (active and passive skills).
 */
export class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
      skillType:   new fields.StringField({ initial: 'Passive' }),
      formula:     new fields.StringField({ initial: '' }),
      roll: new fields.SchemaField({
        dice:      new fields.StringField({ initial: '' }),
        abilities: new fields.StringField({ initial: '' }),
        resource:  new fields.StringField({ initial: '' }),
        cost:      new fields.NumberField({ initial: 0, integer: true }),
        type:      new fields.StringField({ initial: '' }),
        diceBonus: new fields.NumberField({ initial: 1 }),
      }),
    };
  }
}
