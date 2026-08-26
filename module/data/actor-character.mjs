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
      // KI — the monk resource. Granted by the `ki` ACTOR TAG: `ki.max` derives
      // from endurance in prepareDerivedData and is 0 for anyone without the
      // tag, so the field existing costs every other actor nothing.
      ki:        resourceSchema(0, 0),

      // STRAIN — max HP temporarily burned away, as a FRACTION of true max.
      // The price of pushing a resource conversion past what the body
      // tolerates: you get the mana now and carry the hole until it heals.
      // Charged in a currency only TIME restores, which is the point — it
      // turns an out-of-combat "infinite stamina" engine into a time cost.
      // ⚠ Floored at `strainMaxFrac` (0.5) in prepareDerivedData so this can
      // never become a suicide button.
      strain: new fields.NumberField({ initial: 0, min: 0, max: 1 }),

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

      // Meditation: the fraction of MAX MANA recovered by an hour of the
      // `meditate` activity. A schema field rather than a config constant
      // because it is an ACTIVE-EFFECT TARGET — John's passive adds to it, and
      // any future trait can too. The initial MUST match
      // `config.meditation.baseFraction`; a stale default here would silently
      // diverge from the number the activity registry advertises.
      meditation: new fields.SchemaField({
        fraction: new fields.NumberField({ initial: 0.10, min: 0 }),
      }),

      // BUFF CAPACITY (design-healer-system.md phase 6). Capacity and current
      // usage are both DERIVED — see prepareDerivedData — so only the choice
      // is stored, per the house stored-fallback rule.
      //
      // ⚠ The toggle belongs to the RECIPIENT, not the caster. A healer cannot
      // decide on your behalf that you can afford to bleed for their buff.
      // Default OFF: overcap buffs truncate to the room left and nobody takes
      // damage they did not opt into.
      buffs: new fields.SchemaField({
        acceptOvercap: new fields.BooleanField({ initial: false }),
      }),

      biography: new fields.HTMLField({ initial: '' }),

      // Wounded token image — swaps token art when HP drops below threshold.
      tokenImageWounded: new fields.StringField({ initial: '' }),

      // Actor-level system tags (design-power-sense, 2026-07-14): direct grants
      // (senses, boons) alongside the template cachedTags. Registry IDs
      // (helpers/tags.mjs); ingested by _collectTags with source 'actor'.
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      attributes: new fields.SchemaField({
        class: new fields.SchemaField({
          level:      new fields.NumberField({ initial: 1, min: 0, integer: true }),
          name:       new fields.StringField({ initial: 'Uninitiated' }),
          templateId: new fields.StringField({ initial: '' }),
          rank:       new fields.StringField({ initial: 'G' }),
          // Transition log: each entry says "from this level onward, use this template".
          // Lookup at level L = findLast(entry => entry.fromLevel <= L). Empty array
          // means "no historical record" — engines should fall back to the current
          // templateId for all levels (legacy actors). On level-up that crosses into
          // a new template, append a new entry.
          history: new fields.ArrayField(new fields.SchemaField({
            fromLevel:  new fields.NumberField({ initial: 0, min: 0, integer: true }),
            templateId: new fields.StringField({ initial: '' }),
          }), { initial: [] }),
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
          history: new fields.ArrayField(new fields.SchemaField({
            fromLevel:  new fields.NumberField({ initial: 0, min: 0, integer: true }),
            templateId: new fields.StringField({ initial: '' }),
          }), { initial: [] }),
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
          history: new fields.ArrayField(new fields.SchemaField({
            fromLevel:  new fields.NumberField({ initial: 0, min: 0, integer: true }),
            templateId: new fields.StringField({ initial: '' }),
          }), { initial: [] }),
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

      // ── AFFINITY CONSTITUTION (ruled 2026-08-24) ──
      // { fire: 1.5, ice: 0.7, ... } — a MULTIPLIER on damage of that
      // affinity after the wall. >1 = VULNERABLE, <1 = INURED, 1.0/absent
      // = neutral. Pairs with the FLAT wall modifier on gear
      // (system.damageReduction.affinities): armour answers an element,
      // constitution IS one. INTRINSIC — never derived from equipment.
      affinityMultipliers: new fields.ObjectField({ initial: () => ({}) }),

      // ── COMPLEX AFFINITIES (ruled 2026-08-24, built 2026-08-25) ──
      // { solar: { light: 50, fire: 30, life: 20 } } — how THIS actor's
      // magic decomposes a named affinity into weighted slices. THE ONLY
      // source: there is no world default, because the same word means
      // different things to different casters ("a desert native's Solar is
      // light/fire/death; an earth native's is light/fire/life"). A name
      // absent here is ATOMIC. CONFIG.complexAffinityPresets is an authoring
      // menu copied in here, never a fallback.
      complexAffinities: new fields.ObjectField({ initial: () => ({}) }),

      // Reactions per round (usually 1). Resets at start of combatant's turn.
      reactions: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
    };
  }
}
