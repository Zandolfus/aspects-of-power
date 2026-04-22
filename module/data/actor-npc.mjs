const { fields } = foundry.data;

/**
 * Data model for npc-type actors.
 * NPCs follow the same rule set as characters.
 */
export class NpcData extends foundry.abstract.TypeDataModel {
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
      biography: new fields.HTMLField({ initial: '' }),
      cr:        new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Wounded token image — swaps token art when HP drops below threshold.
      tokenImageWounded: new fields.StringField({ initial: '' }),

      // Base stamina regeneration per turn (percentage of max stamina).
      staminaRegen: new fields.NumberField({ initial: 5, min: 0 }),

      // Race rank drives the vitality modifier multiplier in derivation.
      attributes: new fields.SchemaField({
        race: new fields.SchemaField({
          level: new fields.NumberField({ initial: 0, min: 0, integer: true }),
          rank:  new fields.StringField({ initial: 'G' }),
        }),
      }),

      credits: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Full ability scores — derived data (mods, resource maxes) flows from these.
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

      // Defense values: melee/ranged/mind/soul are derived; armor/veil are set manually.
      defense: new fields.SchemaField({
        armor:  defenseSchema(),
        veil:   defenseSchema(),
        melee:  defenseSchema(),
        ranged: defenseSchema(),
        mind:   defenseSchema(),
        soul:   defenseSchema(),
      }),

      // Reactions per round (usually 1). Resets at start of combatant's turn.
      reactions: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),

      // Barrier — populated from ActiveEffects in prepareDerivedData.
      barrier: new fields.SchemaField({
        value:      new fields.NumberField({ initial: 0, min: 0, integer: true }),
        max:        new fields.NumberField({ initial: 0, min: 0, integer: true }),
        affinities: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        source:     new fields.StringField({ initial: '' }),
      }),
    };
  }
}
