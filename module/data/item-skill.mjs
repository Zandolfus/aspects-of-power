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
      // For Reaction skills: what type of reaction (dodge, parry, barrier,
      // retaliation). Drives the default pipeline injection point:
      //   dodge       → pre-defense (can cancel the hit)
      //   parry       → at defense roll (modifies / counters)
      //   barrier     → at damage application (consumes barrier first)
      //   retaliation → post-resolve (counter-strike the attacker)
      // Override per-skill via tagConfig.reactionPhase (advanced).
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
        // Optional second defense for "single blow, two defenses" skills (e.g.
        // Earth's Rise: ground bursts up = melee defense, lightning descends =
        // ranged defense). When set, hit rolls against BOTH defenses, damage
        // splits 50/50 between the two halves; defense pipeline still runs
        // ONCE on the combined damage. Empty disables the secondary check.
        secondaryTargetDefense: new fields.StringField({ initial: '' }),
        // Melee reach in feet. 0 = inherit from the wielded weapon's reach
        // (default 5ft). Set explicitly when a skill has special reach
        // semantics (e.g. Lunge with extended reach). Used to range-gate the
        // strike at declare time and to size Cleave cones.
        reach: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // Optional affinity tag for the secondary half — lets the second-half
        // damage be flavored differently from the primary affinity for
        // affinity-DR purposes. Falls back to the primary affinity when empty.
        secondaryAffinity: new fields.StringField({ initial: '' }),
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
      // `baseSize` is the spell's natural footprint: sizes at-or-below it
      // cost the unmodified baseMana; sizes above it incur 2^n cost growth
      // (per design — Fireball-style spells have a free natural size).
      // Defaults to 5 (the historical universal floor) so existing skills
      // keep current behavior; designers opt in by raising it per-skill.
      aoe: new fields.SchemaField({
        enabled:          new fields.BooleanField({ initial: false }),
        shape:            new fields.StringField({ initial: 'circle' }),
        diameter:         new fields.NumberField({ initial: 10, min: 5, integer: true }),
        baseSize:         new fields.NumberField({ initial: 5, min: 5, integer: true }),
        width:            new fields.NumberField({ initial: 5, min: 5, integer: true }),
        angle:            new fields.NumberField({ initial: 53, min: 1, max: 360 }),
        targetingMode:    new fields.StringField({ initial: 'all' }),
        templateDuration: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        zoneEffect:       new fields.StringField({ initial: 'none' }),
      }),

      // Player-marked "favorite" skill — surfaced in the post-action
      // quick-actions dialog during celerity combat for one-click cast.
      favorite: new fields.BooleanField({ initial: false }),

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
        buffTarget:    new fields.StringField({ initial: 'selected' }), // 'self' | 'selected'
        // Movement-buff multipliers (per design-movement-skills.md Phase A.5).
        // Written into the applied effect's system.movementSpeedMultiplier /
        // system.movementStaminaMultiplier. > 1 on speed = faster; < 1 on
        // stamina = more efficient. Default 1 = no movement effect.
        movementSpeedBuff:    new fields.NumberField({ initial: 1, min: 0 }),
        movementStaminaBuff:  new fields.NumberField({ initial: 1, min: 0 }),
        // Aura authoring (per design-movement-skills.md Phase B). When the
        // buff is applied, the casting skill's rollTotal × auraScale is
        // snapshotted into the effect's system.auraAmount. Each round-start
        // (AND on entry via the movement hook) the aura ticks against
        // tokens within auraRadius. auraEffectType dispatches:
        //   'damage' → apply-damage button (Storm Stride, poison cloud)
        //   'heal'   → gmApplyRestoration (Chanter's healing hymn)
        //   'stam'   → gmApplyRestoration with stamina (Chanter's sustain aura)
        auraRadius:        new fields.NumberField({ initial: 0, min: 0 }),
        auraEffectType:    new fields.StringField({ initial: 'damage' }), // 'damage' | 'heal' | 'stam'
        auraDamageType:    new fields.StringField({ initial: 'physical' }),
        auraTargeting:     new fields.StringField({ initial: 'enemies' }), // 'enemies' | 'allies' | 'all'
        auraScale:         new fields.NumberField({ initial: 0.3, min: 0, max: 5 }),
        auraHealResource:  new fields.StringField({ initial: 'health' }), // 'health' | 'mana' | 'stamina'
        auraHealOverhealth: new fields.BooleanField({ initial: false }),

        // Teleport (per design-movement-skills.md Phase C). Max distance
        // from caster's token center to destination. Default 0 = inherit
        // the caster's `system.castingRange` (40 + Per.mod/10) so teleport
        // reach scales with the caster's spell-throwing reach. Override
        // with > 0 for a fixed-range teleport (e.g., short Blink-style
        // skills) regardless of the caster's casting range. Sight required
        // (vision polygon, not raw LOS) — caster's vision currently reaching
        // the destination, including from auxiliary sources like scrying
        // skills. Walls and engagement halts are bypassed. Aura entry
        // triggers fire on arrival.
        teleportMaxDistance: new fields.NumberField({ initial: 0, min: 0, integer: true }),

        // Leap (per design-movement-skills.md Phase C). Max arc distance
        // start-to-end. The apex value is consulted ONLY for the wall
        // pass-through check: walls with top < leapApexFt are non-blocking
        // for this movement; taller walls still block. Token stays at
        // ground elevation throughout — AOEs and engagement evaluate the
        // 2D path normally (so leaping through a fire field still eats
        // the fire, and an enemy's threat radius halts the arc).
        leapMaxDistance: new fields.NumberField({ initial: 20, min: 5, integer: true }),
        leapApexFt:      new fields.NumberField({ initial: 10, min: 0, integer: true }),

        // Granted activation fraction (per design-movement-skills.md).
        // When the `granted` tag is on the skill, computeActionWait bypasses
        // the standard stat-driven formula. For non-distance skills the
        // result is simply:
        //   wait = referenceRoundLength(actor) × grantedActivationFraction
        // For teleport/leap (distance varies per cast), wait LERPs between
        // the min and max fractions by `distancePicked / maxDistance`:
        //   frac = lerp(grantedMinActivationFraction, grantedActivationFraction, dist/max)
        // Default min = 1/9, max = 1/3 = short teleport 1/9 round, max-range
        // 1/3 round. Author can set min == max to disable distance scaling
        // (use for non-mobility granted skills like break-free reactions).
        grantedActivationFraction:    new fields.NumberField({ initial: 1 / 3, min: 0, max: 2 }),
        grantedMinActivationFraction: new fields.NumberField({ initial: 1 / 9, min: 0, max: 2 }),

        // ── Reaction subsystem (per design-reaction-subsystem.md) ────────
        // What event the reaction listens to. Shared with passive-retaliation
        // skills (skillType=Passive + `retaliation` tag) so the same event
        // detection covers both reactive (player-prompted) and passive
        // (auto-fire) flows. Empty = not a reaction-driven skill.
        //   self_attacked      — to-hit roll vs self (pre-damage)
        //   self_damage_taken  — damage about to apply (post-defense, pre-HP)
        //   ally_attacked      — to-hit roll vs non-hostile within reactionTriggerRange
        //   self_struck        — post-resolve damage actually dealt
        //   hp_threshold       — actor's HP drops below reactionThresholdPct
        reactionTrigger:       new fields.StringField({ initial: '' }),
        // Range gate for `ally_attacked` — ft from the reactor to the
        // attacked ally that triggers the reaction. 0 = no range gate.
        reactionTriggerRange:  new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // HP-fraction threshold for `hp_threshold` triggers (Bloodrage etc.).
        // Fires when (HP / maxHP) drops below this value.
        reactionThresholdPct:  new fields.NumberField({ initial: 0, min: 0, max: 1 }),
        // Reaction cooldown in actor's reference rounds. Default 1 = once
        // per round. Skill can fire once per `reactionCooldown` rounds.
        reactionCooldown:      new fields.NumberField({ initial: 1, min: 0, integer: true }),
        // Advanced: override the pipeline injection point. Default derives
        // from `roll.reactionType` (dodge=pre_defense, parry=at_defense,
        // barrier=at_damage_app, retaliation=post_resolve). Set explicitly
        // for skills that need a non-default phase. Empty = use default.
        reactionPhase:         new fields.StringField({ initial: '' }),

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
        // DoT damage scaling: per-tick DoT damage = dmgRoll × dotScale ×
        // defenseMultiplier. Separate from debuffScaleWithAttack (which
        // scales the stat-reduction portion of the debuff) so designers
        // can tune each independently. Per user 2026-05-11: DoTs are
        // low-damage stacking sources; default 0.1 = 10% of attack roll
        // per tick. Zero is a legitimate value (no DoT damage despite
        // the debuff being damage-flagged) — the old "0 = full damage"
        // surprise sentinel is gone.
        dotScale: new fields.NumberField({ initial: 0.1, min: 0, max: 1 }),

        // Mine-pair tags (mine / detonate):
        //   mineCapacity: max concurrent mines per caster placed by this
        //     summon. Default 1; upgrades can raise it so the caster can
        //     plant multiple mines. FIFO-eviction at capacity. The mine
        //     itself snapshots the summon's roll + aoe config at placement
        //     so the generic Detonate skill can fire whatever explosion
        //     the summoner defined. Detonate has no key and no capacity —
        //     it consumes any of the caster's mines.
        mineCapacity: new fields.NumberField({ initial: 1, min: 1, max: 10, integer: true }),

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
        // Shrapnel: flat hit-bonus added to ranged attack roll for shrapnel
        // AOEs (compensates for "everyone's caught in the burst"). Per
        // design-aoe-dispatch.md.
        shrapnelHitBonus: new fields.NumberField({ initial: 4, min: 0, max: 20, integer: true }),

        // AOE debuff dispatch (per design-aoe-dispatch.md):
        //
        // Mental debuffs (targetDefense mind/soul) use ABLATIVE pool
        // depletion. Per-tick cost defaults to the caster's full hitTotal
        // (snapshotted at cast time). Override by setting debuffPoolCost > 0
        // for a flat per-tick value (special skills like steady curses).
        //
        // Physical debuffs (poison/slow/weakness/etc) bypass pool entirely
        // (you can't dodge a gas cloud you're standing in) and use saveModel
        // to determine application:
        //   'none'    — debuff always applies
        //   'perTick' — save vs caster's hit total each tick
        //   'onEntry' — save once on entry; locked in on failure
        debuffPoolCost: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        saveModel:      new fields.StringField({ initial: 'none', choices: ['none', 'perTick', 'onEntry'] }),
        saveAbility:    new fields.StringField({ initial: 'willpower' }),

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
