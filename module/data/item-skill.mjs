const { fields } = foundry.data;

/**
 * Data model for skill-type items (active and passive skills).
 */
export class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
      skillCategory: new fields.StringField({ initial: 'combat' }),
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

      // ID of the item that must be equipped to use this skill. Empty = no requirement.
      requiredEquipment: new fields.StringField({ initial: '' }),

      // Skill chaining: other skills on the same actor that auto-trigger after this skill.
      chainedSkills: new fields.ArrayField(new fields.SchemaField({
        skillId:  new fields.StringField({ initial: '' }),
        trigger:  new fields.StringField({ initial: 'always' }), // 'always', 'on-hit', 'on-miss'
      }), { initial: [] }),

      // AOE modifier — applies to all active tags when enabled.
      aoe: new fields.SchemaField({
        enabled:          new fields.BooleanField({ initial: false }),
        shape:            new fields.StringField({ initial: 'circle' }),
        diameter:         new fields.NumberField({ initial: 10, min: 5, integer: true }),
        width:            new fields.NumberField({ initial: 5, min: 5, integer: true }),
        angle:            new fields.NumberField({ initial: 53, min: 1, max: 360 }),
        targetingMode:    new fields.StringField({ initial: 'all' }),
        templateDuration: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      }),

      // Per-tag configuration.
      // Attack tag reuses roll.targetDefense and roll.damageType — no extra config needed.
      tagConfig: new fields.SchemaField({
        restorationTarget:   new fields.StringField({ initial: 'selected' }),
        restorationResource: new fields.StringField({ initial: 'health' }),

        // Buff: array of { attribute, value (multiplier) } pairs + duration.
        // value is a multiplier applied to the roll total (default 1 = full roll value).
        buffEntries: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ initial: 'abilities.strength' }),
          value:     new fields.NumberField({ initial: 1, min: 0 }),
        }), { initial: [] }),
        buffDuration:  new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        buffStackable: new fields.BooleanField({ initial: false }),

        // Debuff: array of { attribute, value (multiplier) } pairs + duration + optional DoT.
        debuffEntries: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ initial: 'abilities.strength' }),
          value:     new fields.NumberField({ initial: 1, min: 0 }),
        }), { initial: [] }),
        debuffDuration:    new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        debuffDealsDamage: new fields.BooleanField({ initial: false }),
        debuffDamageType:  new fields.StringField({ initial: 'physical' }),

        // Repair: which material types this skill can repair.
        repairMaterials: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      }),
    };
  }
}
