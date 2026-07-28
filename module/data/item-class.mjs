const { fields } = foundry.data;

/**
 * Data model for class template items.
 * Each class is rank-specific — it defines stat gains per level for a single rank.
 * At rank breakpoints the GM assigns a new class template.
 */
export class ClassData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // Which rank this class is for (G, F, E, D, C, B, A, S).
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

      // UUIDs of compendium skill items this class grants. Mirrors the
      // profession + equipment grantedSkills pattern. Applied by
      // systems/template-grants.mjs.
      grantedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Weapon proficiencies this class confers, and at what MASTERY
      // (design-weapon-proficiencies.md). A plain grantedSkills UUID list
      // cannot express this: the very same Sword Proficiency is `common` for a
      // Light Warrior's finesse weapons and `inferior` for a Heavy Warrior's
      // one-handers, so the tier has to travel with the grant rather than
      // living on the source skill.
      //
      // Enumerated per TYPE, not per group — "two-handed common" is stored as
      // one entry each for greatsword, greataxe, polearm and quarterstaff, so
      // the table stays explicit and a new weapon type never silently joins a
      // class's repertoire.
      //
      // Resolution is BEST-TIER-WINS across every template on the actor's
      // history, and grants are upgrade-only: advancing a class can raise a
      // proficiency but never demote one (the design notes' "gain Uncommon
      // Archery IF NOT ALREADY").
      profGrants: new fields.ArrayField(new fields.SchemaField({
        type:   new fields.StringField({ initial: '' }),   // CONFIG.weaponWeights key
        rarity: new fields.StringField({ initial: 'common' }),
      }), { initial: [] }),
    };
  }
}
