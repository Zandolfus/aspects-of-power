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

      // ── DR-strip opt-in (armor-answer system, design-armor-answer-system) ──
      // Only effects with drStrip:true reduce the target's toughness DR vs a
      // matching-affinity attack (_getAffinityDRReduction). Keeps DR-strip a
      // DEDICATED debuff property — a generic bleed/venom deals DoT damage but
      // does NOT melt DR. Set from the source skill's tagConfig.debuffDRStrip.
      drStrip:          new fields.BooleanField({ initial: false }),

      // ── Armor Crush (armor-answer system) ──
      // LEGACY fraction (SUPERSEDED 2026-07-18 by armorCrushFlat). Kept so old
      // stored effects don't error; the flat calc no longer reads it.
      armorCrush:       new fields.NumberField({ initial: 0, min: 0 }),
      // FLAT armor reduction this crush debuff contributes while active, summed
      // across stacks in the mitigation calc. Anchored to the APPLIER's hit at
      // apply time (crushHitFrac × dmgRoll) so it's grade-correct — never a
      // fraction of the target's armor. design-burn-status.md.
      armorCrushFlat:   new fields.NumberField({ initial: 0, min: 0 }),
      // Armor-MELT rate (design-burn-status.md): when > 0, this (burn) effect
      // melts armor by armorMeltRate × its dotDamage, summed globally across
      // burn stacks. Explicit opt-in so a generic bleed/poison DoT never melts
      // armor — only skills that declare it (canonical Burn) do.
      armorMeltRate:    new fields.NumberField({ initial: 0, min: 0 }),

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
        // Mana Shell reform-on-break: shell re-forms to full by re-paying
        // reformCost from the caster; failure tears down shell + sustain.
        reform:          new fields.BooleanField({ initial: false }),
        reformCost:      new fields.NumberField({ initial: 0, min: 0, integer: true }),
        reformResource:  new fields.StringField({ initial: 'mana' }),
        casterActorUuid: new fields.StringField({ initial: '' }),
        sourceSkillId:   new fields.StringField({ initial: '' }),
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

      // ── Aura (actor-centered sustained AOE) ──
      // Per design-movement-skills.md Phase B. Effects with auraRadius > 0
      // tick each round via actor.onStartTurn AND fire on entry via the
      // canvas/aura-entry-trigger preUpdateToken hook. auraAmount is
      // snapshotted from the casting skill at apply time (rollTotal ×
      // auraScale). Effect-type dispatch in _tickActorAuras: damage routes
      // to apply-damage button; heal/stam auto-apply via gmApplyRestoration.
      auraRadius:        new fields.NumberField({ initial: 0, min: 0 }),
      auraAmount:        new fields.NumberField({ initial: 0, min: 0 }),
      auraDamage:        new fields.NumberField({ initial: 0, min: 0 }), // legacy alias for damage type; pre-fix snapshot used this
      auraDamageType:    new fields.StringField({ initial: 'physical' }),
      auraTargeting:     new fields.StringField({ initial: 'enemies' }), // 'enemies' | 'allies' | 'all'
      auraAffinities:    new fields.ArrayField(new fields.StringField(), { initial: [] }),
      auraIsMagic:       new fields.BooleanField({ initial: false }),
      auraEffectType:    new fields.StringField({ initial: 'damage' }),  // 'damage' | 'heal' | 'stam'
      auraHealResource:  new fields.StringField({ initial: 'health' }),  // for 'heal' type: 'health' | 'mana' | 'stamina'
      auraHealOverhealth: new fields.BooleanField({ initial: false }),   // for 'heal' type: overflow into overhealth

      // ── Effect tags ──
      // Subset of skill tags that propagate to the spawned effect when
      // applied as a buff/debuff. Used for behavior gating: `dash` makes
      // engagement halts skip while the effect is non-disabled. Future:
      // dispel-by-tag, status display, etc.
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // ── Reaction carried by this effect (Phase E) ──
      // Phase A-D reactions live on actor skills. Phase E lets an active
      // effect (typically a buff applied by an active skill) ALSO carry a
      // reaction config. Use case: "Shocking Retort" Active skill applies
      // an armor buff to self; while the buff is active, melee attackers
      // get countered. The buff carries reactionTrigger + reactionSkillId,
      // and the scan in _firePassiveReactions includes effects matching
      // the trigger.
      //
      // reactionTrigger    — same values as skill tagConfig.reactionTrigger
      //                      ('self_attacked', 'self_struck', etc.). Empty = not a reaction-carrying effect.
      // reactionAttackType — 'any' / 'melee' / 'ranged' filter on the
      //                      incoming attack. Mirrors skill tagConfig.
      // reactionSkillId    — UUID of the skill to fire when triggered.
      //                      Typically a dedicated counter skill on the
      //                      buffed actor. Skill rolls with executeDeferred
      //                      + preTargetIds=[attackerToken.id].
      reactionTrigger:    new fields.StringField({ initial: '' }),
      reactionAttackType: new fields.StringField({ initial: 'any', choices: ['any', 'melee', 'ranged'] }),
      reactionSkillId:    new fields.StringField({ initial: '' }),

      // ── Marked subsystem ──
      // The target carries this effect; when the marker attacks them, the
      // mark fires one or both of:
      //   - markedDamageBonus: multiplier on the marker's incoming DAMAGE
      //     (Marked for Death = +25%). Applied in apply-damage handler.
      //   - markedAttackMultiplier: multiplier on the marker's HIT TOTAL
      //     against this target (Feint = +50% to-hit). Applied in
      //     _handleAttackTag before the defense check.
      // markedByActorUuid identifies which attacker the bonus applies to —
      // marks from different attackers don't cross-pollinate.
      // markedExpiresOnHit: true → effect deletes after the FIRST bonus
      // (attack OR damage) fires. False → persistent for the effect's
      // duration. Bonuses from the same attacker sum within their channel.
      markedByActorUuid:       new fields.StringField({ initial: '' }),
      markedDamageBonus:       new fields.NumberField({ initial: 0, min: 0 }),
      markedAttackMultiplier:  new fields.NumberField({ initial: 0, min: 0 }),
      markedExpiresOnHit:      new fields.BooleanField({ initial: false }),

      // ── Weapon buff (Flameblade etc. — design-spellstriker.md) ──
      // A buff effect with weaponBuffDamage > 0 adds that FLAT amount (typed
      // by weaponBuffAffinities) to the wearer's weapon strikes while active.
      // Snapshotted from the casting skill (rollTotal × weaponBuffScale) at
      // apply time. Aggregated into the actor's system.weaponStrikeBuff by
      // prepareDerivedData; the weapon strike path adds it and routes the
      // portion through the target's per-affinity DR.
      weaponBuffDamage:     new fields.NumberField({ initial: 0, min: 0 }),
      weaponBuffAffinities: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // ── Special flags ──
      dismemberedSlot:          new fields.StringField({ initial: '' }),
      sleepActive:              new fields.BooleanField({ initial: false }),
      overhealthDecayReduction: new fields.NumberField({ initial: 0 }),
    });
    return schema;
  }
}
