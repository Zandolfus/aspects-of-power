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
        dice:         new fields.StringField({ initial: '' }),
        abilities:    new fields.StringField({ initial: '' }),
        resource:     new fields.StringField({ initial: '' }),
        cost:         new fields.NumberField({ initial: 0, integer: true }),
        type:         new fields.StringField({ initial: '' }),
        diceBonus:    new fields.NumberField({ initial: 1 }),
        // Which of the four defenses this skill tests against (melee/ranged/mind/soul).
        targetDefense: new fields.StringField({ initial: '' }),
        // Whether this skill deals physical damage (armor) or non-physical (veil).
        damageType:   new fields.StringField({ initial: 'physical' }),
      }),

      // Tags that define what this skill does when activated (e.g. ["attack","debuff"]).
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Per-tag configuration. Flat schema for simpler form binding.
      // Attack tag reuses roll.targetDefense and roll.damageType — no extra config needed.
      tagConfig: new fields.SchemaField({
        healTarget:      new fields.StringField({ initial: 'selected' }),
        buffAttribute:   new fields.StringField({ initial: 'abilities.strength' }),
        buffDuration:    new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        debuffAttribute: new fields.StringField({ initial: 'abilities.strength' }),
        debuffDuration:  new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      }),
    };
  }
}
