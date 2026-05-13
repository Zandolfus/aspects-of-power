const { fields } = foundry.data;

/**
 * Base ActiveEffect TypeDataModel for Aspects of Power.
 * Replaces the dual flag namespaces (aspects-of-power / aspectsofpower)
 * with a proper typed schema.
 */
export class AopEffectData extends foundry.data.ActiveEffectTypeDataModel {
  static defineSchema() {
    const schema = super.defineSchema();
    Object.assign(schema, {
      // ── Effect category & source ──
      effectCategory: new fields.StringField({ initial: '' }),       // blessing, title, temporary, passive, inactive
      effectType:     new fields.StringField({ initial: '' }),       // equipment, barrier, or empty
      itemSource:     new fields.StringField({ initial: '' }),       // item ID for equipment effects

      // ── Debuff fields ──
      debuffType:       new fields.StringField({ initial: 'none' }),
      debuffDamage:     new fields.NumberField({ initial: 0 }),      // roll total / break threshold
      breakProgress:    new fields.NumberField({ initial: 0 }),      // cumulative break progress
      roundsAfflicted:  new fields.NumberField({ initial: 0, min: 0, integer: true }), // increments per round; scales break-roll yield; resets on re-apply

      // ── Damage over time ──
      dot:              new fields.BooleanField({ initial: false }),
      dotDamage:        new fields.NumberField({ initial: 0 }),
      dotDamageType:    new fields.StringField({ initial: 'physical' }),
      applierActorUuid: new fields.StringField({ initial: '' }),

      // ── Caster / source tracking ──
      casterActorUuid:  new fields.StringField({ initial: '' }),
      affinities:       new fields.ArrayField(new fields.StringField(), { initial: [] }),
      magicType:        new fields.StringField({ initial: 'non-magical' }),
      directions:       new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // ── Barrier ──
      barrierData: new fields.SchemaField({
        value:      new fields.NumberField({ initial: 0 }),
        max:        new fields.NumberField({ initial: 0 }),
        affinities: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        source:     new fields.StringField({ initial: '' }),
      }, { nullable: true, initial: null }),

      // ── Sustain ──
      sustainCost:     new fields.NumberField({ initial: 0, integer: true }),
      sustainResource: new fields.StringField({ initial: 'mana' }),

      // ── Movement modifiers ──
      // Active effects with these fields contribute to the actor's
      // aggregate movement multipliers (computed in prepareDerivedData).
      // Stormstride / Haste set movementSpeedMultiplier > 1 (faster);
      // Slow / Chilled set it < 1. Stamina multiplier > 1 means the
      // movement burns MORE stamina (encumbrance-style); < 1 = efficient.
      movementSpeedMultiplier:   new fields.NumberField({ initial: 1, min: 0 }),
      movementStaminaMultiplier: new fields.NumberField({ initial: 1, min: 0 }),

      // ── Special flags ──
      dismemberedSlot:          new fields.StringField({ initial: '' }),
      sleepActive:              new fields.BooleanField({ initial: false }),
      overhealthDecayReduction: new fields.NumberField({ initial: 0 }),
    });
    return schema;
  }
}
