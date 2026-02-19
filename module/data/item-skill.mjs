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
    };
  }
}
