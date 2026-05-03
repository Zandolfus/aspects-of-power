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
 * Data model for race template items.
 * Defines per-rank stat gains and free points for each level.
 */
export class RaceData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // For path-twofold races: which secondary path is allowed.
      // 'class' / 'profession' = locked to that path; 'choice' = player picks at character creation.
      // Ignored for path-threefold and path-onefold races.
      twofoldType: new fields.StringField({
        initial: 'choice',
        choices: ['class', 'profession', 'choice'],
      }),

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

      // Tags (affinities, immunities, resistances, gates, passives, free-form).
      // Drives entity-property dispatch via `CONFIG.ASPECTSOFPOWER.tagRegistry`
      // when the tag is registered, and accepts free-form strings otherwise.
      // New races default to threefold-path; GM can swap to twofold/onefold on the race sheet.
      tags: new fields.ArrayField(new fields.StringField(), { initial: ['threefold-path'] }),
      // @deprecated — superseded by `tags`. Kept readable for the one-off
      // tag merge migration; consumers should read `tags` exclusively.
      systemTags: new fields.ArrayField(new fields.SchemaField({
        id:    new fields.StringField({ initial: '' }),
        value: new fields.NumberField({ initial: 0 }),
      }), { initial: [] }),
    };
  }
}
