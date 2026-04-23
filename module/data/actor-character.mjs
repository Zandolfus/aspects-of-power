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
      pool:  new fields.NumberField({ initial: 0, min: 0, integer: true }),
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

      overhealth: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        decayRate: new fields.NumberField({ initial: 10, min: 0 }),
      }),

      barrier: new fields.SchemaField({
        value:      new fields.NumberField({ initial: 0, min: 0, integer: true }),
        max:        new fields.NumberField({ initial: 0, min: 0, integer: true }),
        affinities: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        source:     new fields.StringField({ initial: '' }),
      }),

      biography: new fields.HTMLField({ initial: '' }),

      // Wounded token image — swaps token art when HP drops below threshold.
      tokenImageWounded: new fields.StringField({ initial: '' }),

      attributes: new fields.SchemaField({
        class: new fields.SchemaField({
          level:      new fields.NumberField({ initial: 1, min: 0, integer: true }),
          name:       new fields.StringField({ initial: 'Uninitiated' }),
          templateId: new fields.StringField({ initial: '' }),
          rank:       new fields.StringField({ initial: 'G' }),
          cachedTags: new fields.ArrayField(new fields.SchemaField({
            id: new fields.StringField({ initial: '' }),
            value: new fields.NumberField({ initial: 0 }),
          }), { initial: [] }),
        }),
        race: new fields.SchemaField({
          level:      new fields.NumberField({ initial: 0, min: 0, integer: true }),
          name:       new fields.StringField({ initial: 'Human' }),
          templateId: new fields.StringField({ initial: '' }),
          rank:       new fields.StringField({ initial: 'G' }),
          cachedTags: new fields.ArrayField(new fields.SchemaField({
            id: new fields.StringField({ initial: '' }),
            value: new fields.NumberField({ initial: 0 }),
          }), { initial: [] }),
        }),
        profession: new fields.SchemaField({
          level:      new fields.NumberField({ initial: 0, min: 0, integer: true }),
          name:       new fields.StringField({ initial: 'Uninitiated' }),
          templateId: new fields.StringField({ initial: '' }),
          rank:       new fields.StringField({ initial: 'G' }),
          cachedTags: new fields.ArrayField(new fields.SchemaField({
            id: new fields.StringField({ initial: '' }),
            value: new fields.NumberField({ initial: 0 }),
          }), { initial: [] }),
        }),
      }),

      freePoints: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      credits: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Active gear loadout — combat or profession. Equipment effects filter by this.
      activeLoadout: new fields.StringField({ initial: 'combat' }),

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
        dr:     new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true }),
        }),
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

      // Reactions per round (usually 1). Resets at start of combatant's turn.
      reactions: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
    };
  }
}
