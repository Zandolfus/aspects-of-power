const { fields } = foundry.data;

/**
 * Data model for character-type actors.
 */
export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const abilitySchema = () => new fields.SchemaField({
      value: new fields.NumberField({ initial: 5, min: 0, integer: true }),
    });
    const defenseSchema = () => new fields.SchemaField({
      value: new fields.NumberField({ initial: 0, integer: true }),
    });
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

      attributes: new fields.SchemaField({
        class: new fields.SchemaField({
          level: new fields.NumberField({ initial: 1, min: 0, integer: true }),
          name:  new fields.StringField({ initial: 'Uninitiated' }),
        }),
        race: new fields.SchemaField({
          level: new fields.NumberField({ initial: 0, min: 0, integer: true }),
          name:  new fields.StringField({ initial: 'Human' }),
          rank:  new fields.StringField({ initial: 'G' }),
        }),
        profession: new fields.SchemaField({
          level: new fields.NumberField({ initial: 0, min: 0, integer: true }),
          name:  new fields.StringField({ initial: 'Uninitiated' }),
        }),
      }),

      abilities: new fields.SchemaField({
        vitality:     abilitySchema(),
        endurance:    abilitySchema(),
        strength:     abilitySchema(),
        dexterity:    abilitySchema(),
        toughness:    abilitySchema(),
        intelligence: abilitySchema(),
        willpower:    abilitySchema(),
        wisdom:       abilitySchema(),
        perception:   abilitySchema(),
      }),

      defense: new fields.SchemaField({
        armor:  defenseSchema(),
        veil:   defenseSchema(),
        melee:  defenseSchema(),
        ranged: defenseSchema(),
        mind:   defenseSchema(),
        soul:   defenseSchema(),
      }),

      // Base stamina regeneration per turn (percentage of max stamina).
      // Active effects can modify this value via system.staminaRegen.
      staminaRegen: new fields.NumberField({ initial: 5, min: 0 }),
    };
  }
}
