const { fields } = foundry.data;

/**
 * Data model for profession template items.
 * Each profession is rank-specific — it defines stat gains per level for a single rank.
 * At rank breakpoints the GM assigns a new profession template.
 */
export class ProfessionData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // Which rank this profession is for (G, F, E, D, C, B, A, S).
      rank: new fields.StringField({ initial: 'G' }),

      // Stat gains per level within this rank.
      gains: new fields.SchemaField({
        vitality:     new fields.NumberField({ initial: 0, integer: true }),
        endurance:    new fields.NumberField({ initial: 0, integer: true }),
        strength:     new fields.NumberField({ initial: 0, integer: true }),
        dexterity:    new fields.NumberField({ initial: 0, integer: true }),
        toughness:    new fields.NumberField({ initial: 0, integer: true }),
        intelligence: new fields.NumberField({ initial: 0, integer: true }),
        willpower:    new fields.NumberField({ initial: 0, integer: true }),
        wisdom:       new fields.NumberField({ initial: 0, integer: true }),
        perception:   new fields.NumberField({ initial: 0, integer: true }),
      }),

      // Free points gained per level within this rank.
      freePointsPerLevel: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Tags (affinities, immunities, resistances, gates, passives, free-form).
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      // @deprecated — superseded by `tags`. Kept readable for the one-off
      // tag merge migration; consumers should read `tags` exclusively.
      systemTags: new fields.ArrayField(new fields.SchemaField({
        id:    new fields.StringField({ initial: '' }),
        value: new fields.NumberField({ initial: 0 }),
      }), { initial: [] }),

      // UUIDs of compendium skill items this profession grants. Authoritative
      // list of skills a character receives upon taking this profession.
      // Wired via a sync utility / level-up hook (see migration/local/
      // sync_granted_skills.js). Mirrors the equipment-item grantedSkills
      // pattern in item-item.mjs:66.
      grantedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    };
  }
}
