const { fields } = foundry.data;

/**
 * Data model for skill-type items (active and passive skills).
 */
export class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
      // Rarity drives the universal effect multiplier per design-skill-rarity-system.md.
      // 11 tiers: not_proficient .. divine, mults 0.2 .. 1.2 step 0.1.
      // Auto-demotes one tier on character grade-up E→D and beyond (floor at not_proficient).
      // No `choices` here so old data with off-list values doesn't reject; migration normalizes.
      rarity:      new fields.StringField({ initial: 'common' }),
      // What the skill's primary effect IS — locked at creation. Alterations only add SIDE effects.
      effectType:  new fields.StringField({ initial: 'damage', choices: ['damage', 'heal', 'debuff', 'utility'] }),
      // Alteration tags acquired through upgrades. Each entry refs an entry in
      // CONFIG.ASPECTSOFPOWER.alterationTags (which carries dmgMod/costMod/capability metadata).
      // Per-instance params (e.g. which debuff a 'debuff' alteration applies) live in `params`.
      alterations: new fields.ArrayField(new fields.SchemaField({
        id:     new fields.StringField({ initial: '' }),
        params: new fields.ObjectField({ initial: {} }),
      }), { initial: [] }),
      // Lineage tracking — UUID of the originally-acquired (OG) skill in this lineage.
      // Per the design, branching is OG-only: a player wanting a parallel build
      // re-upgrades from the OG, NOT from an intermediate version.
      originalSkillId: new fields.StringField({ initial: '' }),
      skillCategory: new fields.StringField({ initial: 'combat' }),
      skillType:     new fields.StringField({ initial: 'Passive' }),
      // For Reaction skills: what type of reaction (dodge, parry, barrier).
      reactionType:  new fields.StringField({ initial: 'dodge' }),
      formula:     new fields.StringField({ initial: '' }),
      roll: new fields.SchemaField({
        dice:         new fields.StringField({ initial: '' }),
        abilities:    new fields.StringField({ initial: '' }),  // primary ability (back-compat name)
        resource:     new fields.StringField({ initial: '' }),
        cost:         new fields.NumberField({ initial: 0, integer: true }),
        type:         new fields.StringField({ initial: '' }),
        diceBonus:    new fields.NumberField({ initial: 1 }),
        // Which of the four defenses this skill tests against (melee/ranged/mind/soul).
        targetDefense: new fields.StringField({ initial: '' }),
        // Whether this skill deals physical damage (armor) or non-physical (veil).
        damageType:   new fields.StringField({ initial: 'physical' }),
        // Pure vs Hybrid stat usage. Pure = primary at 100%; Hybrid blends two abilities at weights.
        statType:         new fields.StringField({ initial: 'pure', choices: ['pure', 'hybrid'] }),
        secondaryAbility: new fields.StringField({ initial: '' }),
        primaryWeight:    new fields.NumberField({ initial: 1.0, min: 0, max: 1 }),
        secondaryWeight:  new fields.NumberField({ initial: 0, min: 0, max: 1 }),
        // Spell tier/grade — drive base_mana cost computation per design-magic-system.md.
        // Empty for non-spell skills. base_mana = spellTierFactors[tier] × spellGradeFactors[grade].
        // blank:true required — StringField defaults to blank:false, which rejects '' even when listed in choices.
        tier:  new fields.StringField({ initial: '', blank: true, choices: ['', 'basic', 'high', 'greater', 'major', 'grand'] }),
        grade: new fields.StringField({ initial: '', blank: true, choices: ['', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'] }),

        // Celerity action-weight multiplier (per design-celerity.md):
        //   wait = (weapon_weight × actionWeightMultiplier × SCALE) / actor_speed
        // 1.0 = baseline (e.g. a sword swing on a sword); 0.7 = quick-jab; 1.5 = cleave.
        actionWeightMultiplier: new fields.NumberField({ initial: 1.0, min: 0.1 }),
      }),

      // Craft skills: which item types this skill can produce (keys from CONFIG.ASPECTSOFPOWER.craftItemTypes).
      // Empty for non-craft skills.
      craftAllowedTypes: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Tags that define what this skill does when activated (e.g. ["attack","debuff"]).
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Elemental or thematic affinities (e.g. "fire", "lunar", "space").
      // Used to match against debuffs on the target to reduce toughness DR.
      affinities: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Whether this skill is magical or non-magical.
      // Used alongside affinities to match target debuffs.
      magicType: new fields.StringField({ initial: 'non-magical' }),

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
        zoneEffect:       new fields.StringField({ initial: 'none' }),
      }),

      // Skill component flags — determine which debuffs block this skill.
      requiresSight:   new fields.BooleanField({ initial: false }),
      vocalComponent:  new fields.BooleanField({ initial: false }),
      requiresHearing: new fields.BooleanField({ initial: false }),

      // Per-tag configuration.
      // Attack tag reuses roll.targetDefense and roll.damageType — no extra config needed.
      tagConfig: new fields.SchemaField({
        restorationTarget:   new fields.StringField({ initial: 'selected' }),
        restorationResource: new fields.StringField({ initial: 'health' }),
        restorationOverhealth: new fields.BooleanField({ initial: false }),

        // Buff: array of { attribute, value (multiplier) } pairs + duration.
        // value is a multiplier applied to the roll total (default 1 = full roll value).
        buffEntries: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ initial: 'abilities.strength' }),
          value:     new fields.NumberField({ initial: 1, min: 0 }),
        }), { initial: [] }),
        buffDuration:  new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        buffStackable: new fields.BooleanField({ initial: false }),

        // Debuff: subtype (root, stun, blind, etc.) + stat entries + duration + optional DoT.
        debuffType: new fields.StringField({ initial: 'none' }),
        debuffEntries: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ initial: 'abilities.strength' }),
          value:     new fields.NumberField({ initial: 1, min: 0 }),
        }), { initial: [] }),
        debuffDuration:     new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        debuffStackable:    new fields.BooleanField({ initial: false }),
        debuffScaleWithAttack: new fields.NumberField({ initial: 0, min: 0, max: 1 }),
        debuffDirectional:  new fields.BooleanField({ initial: false }),
        debuffDealsDamage:  new fields.BooleanField({ initial: false }),
        debuffDamageType:   new fields.StringField({ initial: 'physical' }),

        // Forced movement: push or pull target on hit.
        forcedMovement:     new fields.BooleanField({ initial: false }),
        forcedMovementDir:  new fields.StringField({ initial: 'push' }),   // 'push' or 'pull'
        forcedMovementDist: new fields.NumberField({ initial: 5, min: 5, integer: true }),

        // Barrier: mana-to-HP multiplier for barrier restoration skills.
        barrierMultiplier: new fields.NumberField({ initial: 1, min: 0 }),

        // Repair: which material types this skill can repair.
        repairMaterials: new fields.ArrayField(new fields.StringField(), { initial: [] }),

        // Sustain: per-round upkeep cost/resource to maintain the active effect.
        sustainCost:     new fields.NumberField({ initial: 0, min: 0, integer: true }),
        sustainResource: new fields.StringField({ initial: 'mana' }),

        // Shrapnel: defense pool consumption multiplier (>1.0 = harder to dodge).
        shrapnelMultiplier: new fields.NumberField({ initial: 1.5, min: 1.0, max: 5.0 }),

        // Craft: output configuration.
        craftOutputSlot:     new fields.StringField({ initial: '' }),
        craftOutputMaterial: new fields.StringField({ initial: '' }),

        // Gather: output material configuration.
        gatherMaterial: new fields.StringField({ initial: '' }),
        gatherElement:  new fields.StringField({ initial: '' }),
      }),
    };
  }
}
