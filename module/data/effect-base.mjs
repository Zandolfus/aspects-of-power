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

      // ── Special flags ──
      dismemberedSlot:          new fields.StringField({ initial: '' }),
      sleepActive:              new fields.BooleanField({ initial: false }),
      overhealthDecayReduction: new fields.NumberField({ initial: 0 }),
    });
    return schema;
  }
}
