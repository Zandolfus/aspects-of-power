const { fields } = foundry.data;

/**
 * Data model for template grant items.
 * A consumable that, when used, assigns a race/class/profession template to the actor.
 */
export class TemplateGrantData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
      grantType:   new fields.StringField({ initial: 'class', choices: ['race', 'class', 'profession'] }),
      templateId:  new fields.StringField({ initial: '' }),
    };
  }
}
