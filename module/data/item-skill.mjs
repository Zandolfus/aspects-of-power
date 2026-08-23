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
      // Ritual grade (per [design-channel-and-tower.md] rescale, 2026-05-27).
      // Each ritual carries BOTH rarity (epic/legendary/etc.) and a grade
      // (E/D/C/B/A/S). Grade scales the prep threshold / materialFloor /
      // cap by `1.25^gradeIndex` — same per-grade multiplier as the stat
      // curve (gradeIndex map at config.mjs:47). So an E-grade epic ritual
      // uses the base ritualScale values; a D-grade epic uses ×1.25.
      // Default 'E' for current authored content. Only consulted for
      // skills with a `ritual` tag; ignored on non-ritual skills.
      ritualGrade: new fields.StringField({ initial: 'E', choices: ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'] }),
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
        // ── FLAT SECONDARY COST (ruled 2026-08-05) ──
        // A second resource spent as a FLAT prerequisite, not invested. Driving
        // case is the ki monk: stamina is the invested resource (it scales the
        // strike and is what makes you pierce), while ki is a gate on FREQUENCY
        // — "spend 3 ki" — so it needs no slider and no damage term.
        //
        // ⚠ DELIBERATELY NOT multi-invest. A genuine second INVEST slider
        // already exists but is welded to the `infused` spellstrike path and
        // hardcodes a damage term per resource; generalising that is a separate
        // unbuilt design ([[pending-multi-invest]]). This is the small half:
        // check it, spend it, done.
        //
        // Ignored when 0 or when the resource is unset, so every existing skill
        // is unaffected.
        secondaryResource: new fields.StringField({ initial: '' }),
        secondaryCost:     new fields.NumberField({ initial: 0, min: 0, integer: true }),
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

      // ID of the item that must be equipped to use this skill. Empty = no requirement.
      requiredEquipment: new fields.StringField({ initial: '' }),

      // Skill chaining: other skills on the same actor that auto-trigger after this skill.
      chainedSkills: new fields.ArrayField(new fields.SchemaField({
        skillId:  new fields.StringField({ initial: '' }),
        trigger:  new fields.StringField({ initial: 'always' }), // 'always', 'on-hit', 'on-miss'
      }), { initial: [] }),

      // Passive craft modifiers — when the actor possesses this skill AND is
      // in profession loadout, these bonuses are aggregated into
      // `getProfessionAugmentBonuses` totals alongside augment-sourced
      // bonuses. Same schema as AugmentData.craftBonuses for parallel
      // consumption in the craft formula.
      craftBonuses: new fields.ArrayField(new fields.SchemaField({
        type:     new fields.StringField({ initial: 'd100Bonus' }),
        value:    new fields.NumberField({ initial: 0 }),
        affinity: new fields.StringField({ initial: '' }),
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
        // ACTIVITY (ruled 2026-08-07) — a key from CONFIG.ASPECTSOFPOWER.activities.
        // Paired with the `activity` TAG, which is what routes it; the key
        // alone is inert, per the tag-dispatch rule.
        //
        // Firing such a skill DECLARES that activity on the downtime clock
        // rather than resolving as a combat action. Meditation becomes an hour
        // that must actually be spent instead of a button that grants mana.
        activityKey:         new fields.StringField({ initial: '' }),
        // INLINE ACTIVITY TIMING (ruled 2026-08-07). Most profession skills
        // will be activities, and giving each one a hand-written entry in
        // config.mjs makes every new craft a CODE change. These let a skill
        // carry its own duration; a registry `activityKey` still wins when
        // named, so shared verbs like `meditate` stay centralised.
        //
        //   activityClass 'celerity' — cost / the actor's stat mod, so a
        //                              better crafter genuinely finishes sooner
        //                 'clock'    — activityHours flat, same for everyone
        //                 'hybrid'   — whichever of the two is LONGER, which is
        //                              what most crafts actually want: a floor
        //                              in real hours that skill can't undercut
        //
        // ⚠ HOURS, NOT SECONDS (user ruled 2026-08-07: "hours is the only
        // reasonable unit"). Downtime is authored by a GM thinking in hours;
        // nobody wants to type 21600. Fractions are fine — 0.5 is half an hour.
        // The engine still converts to seconds at the boundary, because that is
        // what the activity registry and the clock speak.
        //
        // ⚠ The driving STAT needs no field. `resolveStatKey` already falls
        // back to the skill's own `roll.abilities` — crafting rides its
        // profession's stat for free.
        activityClass:       new fields.StringField({ initial: '', blank: true,
                               choices: ['', 'celerity', 'clock', 'hybrid'] }),
        activityCost:        new fields.NumberField({ initial: 0, min: 0 }),
        activityHours:       new fields.NumberField({ initial: 0, min: 0 }),
        activityQualityScaled: new fields.BooleanField({ initial: false }),

        // ── ACTIVITY HASTE AURA (Gabriel's Call to Arms, ruled 2026-08-07) ──
        // A skill that makes OTHER PEOPLE'S activities faster inside its aura.
        // `activityHasteMult` is a TIME multiplier, so below 1 is faster:
        // 0.667 means "a third quicker".
        //
        // `activityHasteFor` names the tag a skill must carry to benefit, so
        // this hastens crafting without also hastening lockpicking. Empty
        // means every activity.
        //
        // ⚠ SUBSCRIPTION SCAN, not tag dispatch — `activityHasteHours` is read
        // by the activity system sweeping every actor, exactly like
        // `meditationAuraBonus`. Adding a routing tag would BREAK it. Ask "who
        // reads this field?" before assuming it needs one.
        activityHasteMult:      new fields.NumberField({ initial: 0, min: 0 }),
        activityHasteFor:       new fields.StringField({ initial: '' }),
        // Radius multiplier when the aura is projected from a deployed PYLON
        // rather than from the caster.
        //
        // ⚠ A PYLON IS A RARE DEPLOYABLE (user, 2026-08-07), i.e. a placed
        // actor, NOT the `pylon` ritual-medium entry in config — that is a
        // different and deferred thing and reading it as the same cost a wrong
        // description once already.
        //
        // Detected by the source actor carrying the `pylon` TAG, so the scan
        // stays source-agnostic: it already walks every token on the scene and
        // does not care whether the aura comes from a person or an object.
        activityHastePylonMult: new fields.NumberField({ initial: 1, min: 1 }),
        restorationTarget:   new fields.StringField({ initial: 'selected' }),
        restorationResource: new fields.StringField({ initial: 'health' }),
        // CAUTERISED REGENERATION (ruled 2026-08-07 for hydras): a damage type
        // that SHUTS THIS HEAL OFF while the recipient is carrying a DoT of
        // that type. '' = never suppressed, which is every existing skill, so
        // this is inert until authored. The classic "you must burn the stumps
        // or the heads grow back", expressed as content rather than hardcoded
        // into one monster.
        //
        // Matched against the DoT effect's `dotDamageType`, so it composes with
        // whatever the burn subsystem already applies rather than inventing a
        // second notion of "on fire".
        regenSuppressedByDot: new fields.StringField({ initial: '' }),
        restorationOverhealth: new fields.BooleanField({ initial: false }),
        // Fraction of the roll actually restored. 1 = the roll IS the heal
        // (every existing skill, unchanged).
        //
        // Added for the Dreams of Light ally halves, whose own description
        // specifies "Heal for 1/2 of rolled value": they spend a BANKED
        // PAYLOAD that the producer priced as DAMAGE, and the same field is
        // worth less as a heal than as a nightmare. Without this the only way
        // to halve it would be to author a second payload, which would break
        // the one-pool-two-uses shape the skill is built around.
        restorationScale:    new fields.NumberField({ initial: 1, min: 0 }),

        // HEAL OVER TIME. `hotDuration > 0` turns a restoration skill from an
        // instant heal into a per-round one on the target: it places an effect
        // that ticks `roll x hotScale` at the recipient's turn start.
        // Delayed value should beat instant value - the heal can be wasted if
        // the target dies first, or overheal if they are topped up - so a HoT
        // that runs its full duration is worth MORE than the same skill cast
        // directly. `hotScale` 0.5 over 3 rounds = 1.5x the burst.
        hotDuration: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        hotScale:    new fields.NumberField({ initial: 0.5, min: 0 }),

        // Buff: array of { attribute, value (multiplier) } pairs + duration.
        // value is a multiplier applied to the roll total (default 1 = full roll value).
        buffEntries: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ initial: 'abilities.strength' }),
          value:     new fields.NumberField({ initial: 1, min: 0 }),
        }), { initial: [] }),
        // GEAR-SOURCED MAGNITUDE (John's Shield Barrier, ruled 2026-08-05).
        // When set, the buff's magnitude comes off an EQUIPPED ITEM instead of
        // off this skill's own damage roll:
        //     magnitude = gearValue x buffFromEquipmentFrac x entry.value
        // Selector is `<source>.<system path>`; 'shield.armorBonus' reads the
        // equipped shield's armour. Resolved by weapon-styles.resolveGearSource,
        // which is ALSO a hard gate in canUseSkill — a skill that reads its
        // strength off a shield refuses to cast without one, rather than
        // quietly applying zero.
        //
        // Shield Barrier was authored as a roll-scaled buff and applied ~193
        // armour off a 47-armour shield, about 40x its intent. The roll was
        // never a proxy for the gear.
        buffFromEquipment:     new fields.StringField({ initial: '' }),
        buffFromEquipmentFrac: new fields.NumberField({ initial: 0.1, min: 0 }),
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

        // Weapon buff (Flameblade etc. — design-spellstriker.md). When a buff
        // with weaponBuffScale > 0 is applied, the casting skill's rollTotal ×
        // weaponBuffScale is snapshotted (FLAT, based on the buff skill's own
        // power) into the effect's system.weaponBuffDamage. While the effect is
        // active, that flat bonus is added to the wearer's WEAPON strikes and
        // typed with the skill's `affinities` (feeds the per-affinity DR path:
        // affinity-DR-strip + elemental-weakness). Low proportion by design —
        // the bonus rides EVERY strike for the duration, so a small scale
        // compounds; cost + duration + buff slot are the gates. Affinity comes
        // from the skill's `affinities` (like the aura block).
        weaponBuffScale:   new fields.NumberField({ initial: 0, min: 0, max: 5 }),

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
        // Attack-type filter on the INCOMING attack (the thing that triggered
        // the reaction). `any` (default) = no filter, fires on any attacker.
        // `melee` = only fires when the incoming attack was a melee strike
        // (Thunder Puppet retaliating only against melee attackers, etc.).
        // `ranged` = only fires when the incoming attack was ranged. The
        // attacker's roll.type drives classification: str_weapon/dex_weapon/
        // magic_melee → melee, others → ranged. Skill tags `melee`/`ranged`
        // override the roll.type classification when present.
        reactionAttackType:    new fields.StringField({ initial: 'any', choices: ['any', 'melee', 'ranged'] }),

        // ── Guardian reactions (per design-guardian-reactions.md) ──
        // When reactionType === 'guardian' on an `ally_attacked` reaction, the
        // mode selects what the guardian does for the attacked ally:
        //   intercept — redirect the attack onto the guardian (they defend it)
        //   cover     — the guardian's defense roll replaces the ally's
        //   redirect  — post-resolve, share guardianRedirectPct of landed dmg
        guardianMode:        new fields.StringField({ initial: 'intercept', choices: ['intercept', 'cover', 'redirect'] }),
        // Fraction of the ally's LANDED damage transferred to the guardian in
        // 'redirect' mode (Option A: raw post-mitigation share — the guardian's
        // own armor is NOT re-applied). 0..1.
        guardianRedirectPct: new fields.NumberField({ initial: 0.5, min: 0, max: 1 }),

        // ── BRACED PARRY (`braced` tag, RULED 2026-07-31) ────────────────
        // Efficiency of the brace: how much EFFECTIVE weapon weight a point of
        // stamina buys, against a price set by the incoming hit total
        // (defenseTuning.bracedCostHitFrac). 1.0 = the standard rate; a
        // masterwork bracing technique can author more. Inert without the
        // `braced` tag, and inert on anything that is not a parry reaction.
        bracedInvestScale: new fields.NumberField({ initial: 1.0, min: 0 }),

        // ── PER-SKILL TO-HIT MULTIPLIER (RULED 2026-07-31) ───────────────
        // Scales this skill's own accuracy, multiplying the hit formula the
        // same way the proficiency ladder does (the two compose). 1 = neutral.
        // Exists for kits whose identity is "this lands badly UNLESS a
        // condition is met" — Mathilda's blood skills sit at 0.5 and are
        // brought back to parity by her Blood Mark's +100% markAttackBonus.
        // Deliberately NOT clamped at 1: a skill may also be MORE accurate.
        hitMult: new fields.NumberField({ initial: 1.0, min: 0 }),

        // ── PER-SKILL LIFESTEAL (RULED 2026-07-31) ───────────────────────
        // Fraction of the HP damage this skill actually deals, credited to the
        // attacker's OVERHEALTH (not health — overhealth is the ceiling-capped
        // buffer). ADDS to the actor-wide passive lifesteal already summed from
        // `flags.aspectsofpower.lifestealPct`, so George's Sanguine Tithe and a
        // per-skill drain stack rather than one overriding the other.
        // (The legacy FLAG keeps its `Pct` suffix; only the authored field was
        // renamed, and it had exactly one user at the time.)
        lifesteal: new fields.NumberField({ initial: 0, min: 0, max: 1 }),

        // ── MARK CONSUMERS (RULED 2026-07-31) ────────────────────────────
        // `markExpiresOnHit` belongs to the MARK — it is set by whoever APPLIED
        // it and burns on the next benefiting attack, whatever that attack is.
        // These two live on the SPENDER instead, so one kit can hold a
        // persistent mark for accuracy AND have a single skill that cashes it
        // in for burst:
        //   markedDamageMult — this skill's damage multiplier while the target
        //     carries any mark from this attacker. 1 = no payoff.
        //   consumesMark — after benefiting, delete this attacker's marks on
        //     the target. The mark is spent by THIS skill specifically.
        // Mathilda: Bolt applies (2 rounds), Drain rides it for accuracy,
        // Spikes consumes it for damage.
        markedDamageMult: new fields.NumberField({ initial: 1.0, min: 0 }),
        // ⚠ consumesMark is LEGACY (RULED 2026-08-20: mark-spender behaviors
        // are TAGS). The engine now gates on the `consume-mark` tag, keeping
        // this field as a read-fallback for content authored before the
        // ruling. The second spender tag is `internal` — while the target
        // carries this attacker's mark, the skill resolves INSIDE the body
        // (Mathilda's Blood Spikes: the implanted blood erupts): the hit
        // cannot be defended (you can't dodge your own bloodstream), the
        // armor/blockDR (or veil) wall never meets it, and toughness DR
        // still applies in full. Barriers and resists are unchanged.
        // Unmarked, an `internal` skill resolves completely normally (at its
        // own hitMult — which is exactly why kits pair it with hitMult < 1:
        // hard to touch from outside, unavoidable from within).
        consumesMark:     new fields.BooleanField({ initial: false }),

        // ── STANCE PARRY RATE (RULED 2026-08-21: "No discounts, instead
        // lightning parry should have an increased parry rate.") ─────────
        // On a `stance` skill: while THIS stance is held, parry-class
        // reactions skip their per-skill cooldown check — parry rate is
        // then bound only by the reaction budget (reactions.max, already
        // AE-modifiable content: Gabriel's Geppetto's Eye runs his at 3).
        // The cooldown still STAMPS on fire, so dropping the stance
        // mid-round leaves the normal throttle correctly in force.
        // Standard stances leave this false: one parry per skill per round.
        stanceParryCooldownFree: new fields.BooleanField({ initial: false }),
        // On a REACTION: only offered while the actor's guard stance is up
        // (RULED 2026-08-21 for Shield Wall cover: "stance required unless a
        // skill exists to remove that requirement" — the requirement is
        // authored per skill, so a legendary version simply sets it false).
        requiresGuardStance: new fields.BooleanField({ initial: false }),

        // ── KINDLE (`kindle` tag, RULED 2026-08-21 — Valentine's Flames
        // Without / Flames Within) ────────────────────────────────────────
        // An AOE attack that feeds the caster per target it catches: after
        // dispatch, a self-buff lands carrying
        // `kindledDmgMod = kindlePerTarget x targets.length` for
        // kindleDuration rounds. The situational-mods registry reads it back
        // into outgoing damage, scoped by shared affinity (a fire kindle
        // boosts fire attacks; authored affinities are the join key).
        // Recasting REPLACES the buff from the same skill — no stacking.
        kindlePerTarget: new fields.NumberField({ initial: 0.1, min: 0 }),
        kindleDuration:  new fields.NumberField({ initial: 2, min: 1, integer: true }),

        // ── DREAD / CURSE FAMILY (design-dread-curse-engine, RULED
        // 2026-08-21) ──────────────────────────────────────────────────────
        // Which stamped effect-tag the spread/transfer/consume verbs match.
        // Empty = the config default (CONFIG.curse.spreadFilterTag, 'dread').
        // "Only spread Dreads. Stun will not be a Dread."
        spreadFilterTag: new fields.StringField({ initial: '' }),
        // Harness Emotions (`harness` tag): self-buff scale and duration for
        // the vented-meter conversion. 0 falls back to the config knobs.
        harnessScale:    new fields.NumberField({ initial: 0, min: 0 }),
        harnessDuration: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // `spend-curse` price override: fraction of capacity this spender
        // costs per cast. 0 = the config default (CONFIG.curse.spendFraction).
        spendCurseFraction: new fields.NumberField({ initial: 0, min: 0 }),
        // Per-skill meter-fill override: fraction of the roll this builder
        // banks. 0 = the config default (CONFIG.curse.fillScale). Lets a
        // weapon conduit trickle (Maia's Lament 0.03) while casts bank full.
        // On a `curse-empath` passive it overrides empathFillScale instead.
        curseFillScale: new fields.NumberField({ initial: 0, min: 0 }),
        // `curse-empath` radius override: how far the bloodline feels
        // suffering, in feet. 0 = config default (CONFIG.curse.empathRadiusFt).
        empathRadiusFt: new fields.NumberField({ initial: 0, min: 0 }),
        // HIT-BASIS OVERRIDE (RULED 2026-08-22: "Felicia -> Willpower/Wis
        // aim"): ability keys replacing the roll type's hard-coded aim
        // grid — primary x0.9 + secondary x0.3, the house two-stat aim
        // shape. Damage formulas are untouched (hit and damage use
        // different stats on magic skills — the damage playbook rule).
        // Empty = the roll type's default aim. Curse skills aim with the
        // caster's will, not scholarship.
        hitPrimary:   new fields.StringField({ initial: '' }),
        hitSecondary: new fields.StringField({ initial: '' }),

        // ── STACKS (design-stacks-subsystem.md, RULED 2026-08-02) ─────────
        // A self-held charge pool on the CASTER. One skill produces into a
        // named pool; others spend from it. Both sides carry `stackPool`;
        // that string is the only thing binding them.
        //   stackProduces  a cast creates this many              (producer)
        //   stackCost      minimum spent per activation          (spender)
        //   stackMaxSpend  ceiling on one activation, 0 = all it has
        //   stackCap       pool maximum the producer will fill to
        //   stackScaling   EXPONENT on the spend, not a per-stack factor:
        //                  multiplier = spent ** stackScaling. 1.0 = linear
        //                  (RULED — spreading is a choice, not an efficiency
        //                  question, so dump and spread must not compete on
        //                  damage). Spending one stack is 1x at every value.
        // A skill with stackProduces > 0 AND stackCost > 0 is legal: it both
        // banks and spends.
        stackPool:     new fields.StringField({ initial: '' }),
        stackProduces: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        stackCost:     new fields.NumberField({ initial: 0, min: 0, integer: true }),
        stackMaxSpend: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        stackCap:      new fields.NumberField({ initial: 0, min: 0, integer: true }),
        //   stackCapStat   ability whose MOD sets the cap instead of the flat
        //                  `stackCap` above (ki monk: 'endurance'). Empty =
        //                  use stackCap verbatim, so this is purely additive.
        //                  Resolved by formulas.statStackCap; the authored
        //                  stackCap becomes the FLOOR.
        stackCapStat:  new fields.StringField({ initial: '' }),
        //   kiOnPierce     ki monk (ruled 2026-08-05). A skill carrying this
        //                  grants its owner that much KI whenever they land
        //                  damage that REACHES HP — a strike that pierced.
        //
        //   ⚠ THE PIERCE CONDITION IS THE BALANCE. A minimum-cost strike does
        //   not get through real armour, so it grants NOTHING; earning ki means
        //   investing above base, which spends above the stamina regen line by
        //   construction. That is what stops 'free strikes -> free ki -> free
        //   healing' without a separate floor rule. Do NOT relax it to 'on any
        //   attack' — that recreates the engine.
        //
        //   Ki is a RESOURCE (system.ki), not stacks: it carries no per-cast
        //   payload and is spent at varying costs, so it uses the pool
        //   machinery. Gated on the `ki` ACTOR TAG.
        kiOnPierce:    new fields.NumberField({ initial: 0, min: 0, integer: true }),
        stackScaling:  new fields.NumberField({ initial: 1.0, min: 0 }),
        // MULTI-TARGET SPREAD. One activation throws F fields across T targets
        // subject to F + T <= stackSpreadBudget. At 6: 5-at-one, 4-at-two,
        // 3-at-three, 2-at-four, 1-at-five — all for the same single action.
        // Spreading buys reach and pays in throughput.
        // 0 (default) = single-target only, so every existing skill is
        // unaffected and the old one-target-per-throw behaviour is preserved.
        stackSpreadBudget: new fields.NumberField({ initial: 0, min: 0, integer: true }),

        // ── HARVEST ON DOT DEATH (Burnt Offering, user ruled 2026-08-03) ──
        // A PASSIVE that pays out when something dies while suffering a DoT
        // THIS actor applied. Burnt Offering: "when an enemy dies while
        // burning from one of your burn effects, gain mana equal to their
        // level / 10".
        //   harvestResource   what is restored ('' = inert)
        //   harvestPerLevel   restored = round(victim race level x this)
        //   harvestDotAffinity  the DoT must carry this affinity ('fire' for
        //     burn). EMPTY means any DoT of this actor's counts — burn has no
        //     dedicated effect flag, it is a fire-affinity DoT, so affinity is
        //     the honest way to ask "was it MY burn".
        harvestResource:    new fields.StringField({ initial: '' }),
        harvestPerLevel:    new fields.NumberField({ initial: 0, min: 0 }),
        harvestDotAffinity: new fields.StringField({ initial: '' }),

        // ── MEDITATION AURA (Mana Attraction, user ruled 2026-08-03) ─────
        // A skill that raises the meditation return of everyone within
        // `auraRadius` feet of its owner, resolved when the `meditate`
        // activity runs rather than ticked — meditation is an hour of world
        // time, not a combat loop, so there is nothing to tick against.
        // The owner benefits from their own field.
        meditationAuraBonus: new fields.NumberField({ initial: 0, min: 0 }),

        // ── Phase E: buff-carries-reaction config ──
        // When an Active `buff`-tagged skill applies its buff, propagate
        // these onto the spawned effect's `system.reaction*` fields so
        // `_firePassiveReactions` can scan and fire the buff-carried
        // reaction. Use case: Shocking Retort applies an armor buff to
        // self; the buff carries `buffReactionTrigger='self_struck'`,
        // `buffReactionAttackType='melee'`, `buffReactionSkillId=<UUID of
        // Shocking Retort Counter>`. When the bearer is hit in melee, the
        // counter skill fires at the attacker. Empty trigger = no reaction
        // config propagated (most buffs are plain stat changes).
        buffReactionTrigger:    new fields.StringField({ initial: '' }),
        buffReactionAttackType: new fields.StringField({ initial: 'any', choices: ['any', 'melee', 'ranged'] }),
        buffReactionSkillId:    new fields.StringField({ initial: '' }),

        // Debuff: subtype (root, stun, blind, etc.) + stat entries + duration + optional DoT.
        debuffType: new fields.StringField({ initial: 'none' }),
        debuffEntries: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ initial: 'abilities.strength' }),
          value:     new fields.NumberField({ initial: 1, min: 0 }),
        }), { initial: [] }),
        debuffDuration:     new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        debuffStackable:    new fields.BooleanField({ initial: false }),
        // ── RIDER subscription (config.riders, RULED 2026-07-30) ─────────
        // A rider fires off the OWNER'S OWN attacks instead of being spent as
        // an action or hand-wired onto one parent via chainedSkills. It is the
        // attacker-side counterpart to reactionTrigger, which only ever
        // described things happening TO you (self_attacked, self_struck…).
        //
        // `procTrigger` — currently 'self_attack_pierced' (fires when one of
        // the owner's attacks got past the target's armour/veil into the DR
        // layer). Empty = not a rider. On-pierce is self-limiting: the rider
        // never fires against walls the owner cannot already beat.
        //
        // `procAttackTags` — ALL of these must be present on the triggering
        // attack. ['physical'] gives "any physical attack I make". Empty means
        // any attack, which is almost never what an author wants.
        //
        // Rate limiting is the STAMINA COST (formulas.procStaminaCost), not a
        // cooldown or a stack cap — see the riders config block.
        procTrigger:        new fields.StringField({ initial: '' }),
        procAttackTags:     new fields.ArrayField(new fields.StringField(), { initial: [] }),
        // Per-rider cost coefficient; 0 = use config.riders.procCostDamageFrac.
        // Needed because the cost scales with the PARENT's damage while stamina
        // pools do not scale with weapon weight: at the 0.20 default a greataxe
        // user (1354 damage, 225 pool) could never afford his own rider, while
        // a dagger user (300 damage, 400 pool) affords six. A rider built for
        // heavy weapons therefore wants a LOWER coefficient — each hit already
        // lands for far more, so a smaller slice of it is still a large
        // absolute cost. Armor Crush runs at 0.05 for exactly this reason.
        procCostFrac:       new fields.NumberField({ initial: 0, min: 0, max: 1 }),
        debuffScaleWithAttack: new fields.NumberField({ initial: 0, min: 0, max: 1 }),
        debuffDirectional:  new fields.BooleanField({ initial: false }),
        debuffDealsDamage:  new fields.BooleanField({ initial: false }),
        debuffDamageType:   new fields.StringField({ initial: 'physical' }),
        // DR-strip opt-in (armor-answer system): when true AND the debuff is a
        // damage DoT with an affinity, the applied effect reduces the target's
        // toughness DR vs matching-affinity attacks (its debuffDamage tick is
        // the strip amount). Only DEDICATED strippers (Hemorrhage, Burn, the
        // per-affinity set) set this — generic DoTs leave it false.
        debuffDRStrip:      new fields.BooleanField({ initial: false }),
        // Armor Crush opt-in (armor-answer system): >0 means this debuff crushes
        // armor. FLAT amount is computed at apply (crushDamageFrac × applier DAMAGE) and
        // stored on the effect as armorCrushFlat — this field is now just the
        // ON gate (any non-zero enables crush; magnitude comes from config).
        debuffArmorCrush:   new fields.NumberField({ initial: 0, min: 0, max: 1 }),
        // `invest` tag on a crush debuff: the flat armour reduction scales on
        // the stamina COMMITTED to the crush instead of a fixed fraction of the
        // parent blow. crushFlat = crushInvestScale × invested. At scale 1.0 and
        // the shipped 0.05 proc cost the base-invest result is byte-identical to
        // the fixed formula, so the lever is purely additive: leaning in buys
        // more armour off, and paying nothing extra changes nothing.
        crushInvestScale:   new fields.NumberField({ initial: 1.0, min: 0 }),
        // Armor MELT rate (design-burn-status.md): >0 means this (burn) debuff
        // melts armor by this rate × its per-tick dotDamage, summed globally.
        // Default 0 = no melt. Canonical Burn sets ~config burnMeltRate (0.5).
        debuffArmorMelt:    new fields.NumberField({ initial: 0, min: 0, max: 2 }),
        // DoT damage scaling: per-tick DoT damage = dmgRoll × dotScale ×
        // defenseMultiplier. Separate from debuffScaleWithAttack (which
        // scales the stat-reduction portion of the debuff) so designers
        // can tune each independently. Per user 2026-05-11: DoTs are
        // low-damage stacking sources; default 0.1 = 10% of attack roll
        // per tick. Zero is a legitimate value (no DoT damage despite
        // the debuff being damage-flagged) — the old "0 = full damage"
        // surprise sentinel is gone.
        dotScale: new fields.NumberField({ initial: 0.1, min: 0, max: 1 }),

        // `invest` tag: DoT tick scales on the amount of the ability's PRIMARY
        // RESOURCE committed (rollData.roll.cost = invested stamina/mana), not
        // the damage roll — the stab/cast/craft is the cause, so the DoT rides
        // its investment. dotDamage = dotInvestScale × invested. Still faces
        // toughness DR at tick time (only a future `virulent` tag bypasses).
        // See [design-hemorrhage-bleed.md].
        dotInvestScale: new fields.NumberField({ initial: 1.0, min: 0 }),

        // UNITY (RULED 2026-07-26): a high-rarity passive that reconciles a
        // pair of diametrically opposed affinities FOR ITS BEARER, so gear of
        // both may be worn. Permission only — no fused affinity, no resistance,
        // no damage bonus (explicit user ruling). List the affinity KEYS from
        // CONFIG.ASPECTSOFPOWER.affinities, e.g. ['fire','ice'].
        // Declared here rather than inferred from `-affinity` tags so that
        // UNIFYING a pair stays separate from GRANTING it — a unity skill
        // reconciles; it does not by itself hand you the affinities.
        unifiedAffinities: new fields.ArrayField(new fields.StringField({ blank: false })),

        // ── Weapon proficiency + style (design-weapon-proficiencies.md) ──
        // profFor: this passive is the proficiency for a weapon TYPE key from
        // CONFIG.weaponWeights ('hammer', 'axe', 'dagger'...). Mastery is the
        // skill's own rarity — highest rarity wins.
        profFor: new fields.StringField({ initial: '' }),
        // Gates, all checked at roll time BEFORE any cost is paid.
        //   requiresStyle     — a CONFIG.weaponCombinations key: how the hands
        //                       must be arranged (detected from equipped gear).
        //   requiresWeaponTag — a weapon TYPE that must be held.
        //   styleSkill        — the NAME of the governing STYLE passive the
        //                       actor must OWN, the way a Ritualism passive
        //                       governs a body of rituals (ruled 2026-07-27:
        //                       the style is the key, the combination is the
        //                       lock). Matched by name so content can be
        //                       authored and granted without threading ids.
        requiresStyle: new fields.StringField({ initial: '' }),
        requiresWeaponTag: new fields.StringField({ initial: '' }),
        styleSkill: new fields.StringField({ initial: '' }),
        // NOTE (2026-07-28): `profArmorBypassPct` and `profDurabilityMult` were
        // declared here and never read by anything. Both are now DELETED rather
        // than wired, because sims disqualified both shapes:
        //
        //   profArmorBypassPct (a fraction of the TARGET's armour) is exactly
        //   the shape the 2026-07-18 flat armor-answer rework rejected — it
        //   lets a lower-grade attacker strip a fixed share of a superior's
        //   armour regardless of how hard they actually swing (a weak hit of
        //   166 would still remove 434 of Phil's 867). Hammers already pierce
        //   at a flat 0.23 × attacker hit; deepening THAT fraction is the
        //   grade-safe way to express hammer mastery.
        //
        //   profDurabilityMult (multiply the damage that got through) is inert:
        //   a round-by-round cascade sim found no case at any multiplier from
        //   x1 to x4 where a piece ever broke. Superseded by armorAnswer
        //   .axeWearRate, which wears armour by what it STOPPED.
        //
        // Left as a comment, not a field, so nobody re-adds them without
        // re-reading why they went.
        // Dual-wield: off-hand contributes this share of its blockDR, and the
        // arrangement costs a little accuracy.
        profOffhandBlockCoef: new fields.NumberField({ initial: 0, min: 0, max: 1 }),
        profHitMalusPct: new fields.NumberField({ initial: 0, min: 0, max: 1 }),

        // Marked subsystem (per [design-ice-maiden.md] / Marked for Death,
        // Feint, etc.). When non-zero, the spawned debuff carries the
        // caster's UUID + bonus so the apply-damage handler can multiply
        // the marker's damage on the marked target.
        //   markBonus: damage multiplier on the marker's incoming damage
        //              against this target (e.g. 0.25 = +25%).
        //   markExpiresOnHit: true → the mark deletes after one trigger
        //              (Feint-style one-shot). False = persistent for
        //              the effect's duration.
        markBonus:         new fields.NumberField({ initial: 0, min: 0 }),
        // Per-attack hit-roll multiplier the spawned mark applies to the
        // marker's NEXT attack against this target (Feint = +50% to-hit).
        // Fires in _handleAttackTag before the defense check. If
        // markExpiresOnHit is true, fires once then deletes the mark.
        markAttackBonus:   new fields.NumberField({ initial: 0, min: 0 }),
        markExpiresOnHit:  new fields.BooleanField({ initial: false }),

        // ── Summon subsystem (per design-summon-subsystem.md) ────────────
        // First user: Ice Clone (Willy). Builds a temporary world-actor clone
        // of the caster, drops a token at the chosen destination, tracks via
        // a `summon` flag on both token and cloned actor for later lookup.
        //   summonType:          string key — 'ice_clone' / 'mana_minion' / etc.
        //                        Empty = skill is not a summon (gate).
        //   summonHpOverride:    0 = use cloned actor's full HP. >0 = force
        //                        this as both max and current vitality (1 for
        //                        Ice Clone — fragile decoy).
        //   summonCapacity:      max concurrent summons of (caster × this
        //                        skill). FIFO-evict over capacity.
        //   summonSwapOnRecast:  if true, recasting the skill while a live
        //                        summon exists swaps positions instead of
        //                        spawning a new one (Mirror Ice Clone pattern).
        summonType:         new fields.StringField({ initial: '' }),
        summonHpOverride:   new fields.NumberField({ initial: 0, min: 0, integer: true }),
        summonCapacity:     new fields.NumberField({ initial: 1, min: 1, max: 10, integer: true }),
        summonSwapOnRecast: new fields.BooleanField({ initial: false }),

        // ── Equipment summons (systems/summon-equipment.mjs) ──────────────
        // Conjured GEAR rather than a creature; exemplar: Threadcutter,
        // Gabriel's soulbound dagger. Gated on summonItemName being
        // non-empty — a skill is a creature summon OR an equipment summon,
        // and the equipment branch exits before the creature gate.
        //   summonItemName:   name of the conjured item. Non-empty = gate.
        //   summonItemTags:   csv item tags ('weapon,1H,dagger') — the
        //                     weight tag drives the strike stat blend.
        //   summonStatSplit:  csv weighted split of the stat budget, e.g.
        //                     'dexterity:0.4,perception:0.3,strength:0.3'.
        //                     Budget itself = class level × rarity rate
        //                     (config.summonEquipment) — never authored.
        summonItemName:  new fields.StringField({ initial: '' }),
        summonItemTags:  new fields.StringField({ initial: 'weapon,1H,dagger' }),
        summonStatSplit: new fields.StringField({ initial: '' }),

        // ── Tower variant (per [design-channel-and-tower.md] / plan
        //    pure-gathering-ullman.md, 2026-05-29). When `summonAsTower`
        //    is true, _handleSummonTag routes through SummonHelpers.spawnTower
        //    instead of spawnSummon — clones from `summonStubActorUuid`,
        //    applies `ritualPower × summonStatDistribution` as ability-score
        //    overrides, sets the AI flags so the tower autonomously fires
        //    `summonAiSkillUuid` each turn under `summonAiProfile`.
        //   summonAsTower:           true → tower path (else fragile-decoy clone path)
        //   summonStubActorUuid:     UUID of stub NPC (e.g. Magitech Construct) to clone from
        //   summonAiProfile:         AI profile key (registered in AIProfiles), default 'primitive'
        //   summonAiSkillUuid:       skill UUID the tower fires each AI action (typically a channel)
        //   summonStatDistribution:  { ability: weight } map, weights ideally sum to 1.0;
        //                            value = round(ritualPower × weight) per ability
        //   summonExtraTags:         pushed onto stub's tags at spawn (deduped),
        //                            e.g. ['light-affinity'] for a solar prism
        summonAsTower:          new fields.BooleanField({ initial: false }),
        summonStubActorUuid:    new fields.StringField({ initial: '' }),
        summonAiProfile:        new fields.StringField({ initial: 'primitive' }),
        summonAiSkillUuid:      new fields.StringField({ initial: '' }),
        summonStatDistribution: new fields.ObjectField({ initial: () => ({}) }),
        summonExtraTags:        new fields.ArrayField(new fields.StringField(), { initial: [] }),
        // AI BEHAVIOR tags (brains/faculties/presets — CONFIG.aiBehaviors) that
        // compose the summon's "brain" and price it: resolveAiBehaviors() maps
        // them to AI flags stamped on the clone and to a tier cost MULTIPLIER on
        // the summon's mana. Supersedes summonAiProfile when non-empty. Empty =
        // legacy behaviour (use summonAiProfile, ×1 cost). [[design-ai-behavior-tags]]
        summonBehaviors:        new fields.ArrayField(new fields.StringField(), { initial: [] }),

        // ── Channel primitive (per plan pure-gathering-ullman.md, 2026-05-29).
        //    A sub-turn ticking damage skill that ramps per consecutive tick
        //    on the same target. Used by towers and by player-cast channels.
        //    Drives the in-memory state in ChannelHelpers (channel.mjs).
        //   channel:              gate — skill IS a channel (else case 'channel' is a no-op)
        //   channelTickInterval:  round-fraction between ticks (1/3 = 3 ticks per round)
        //   channelRampMax:       peak per-tick multiplier (2.5 = tick @ rampTicks deals 2.5× base)
        //   channelRampTicks:     ticks to reach rampMax (linear ramp from 1.0 over this many ticks)
        //   channelTickCost:      mana per tick deducted from caster
        //   channelMaxTicks:      hard cap (0 = unlimited until break — target dies, OOR, LOS, etc.)
        //   channelRange:         override caster's castingRange for the channel's range check (0 = inherit)
        channel:             new fields.BooleanField({ initial: false }),
        channelTickInterval: new fields.NumberField({ initial: 1/3, min: 0 }),
        channelRampMax:      new fields.NumberField({ initial: 2.5, min: 1 }),
        channelRampTicks:    new fields.NumberField({ initial: 3, min: 1, integer: true }),
        channelTickCost:     new fields.NumberField({ initial: 1, min: 0, integer: true }),
        channelMaxTicks:     new fields.NumberField({ initial: 0, min: 0, integer: true }),
        channelRange:        new fields.NumberField({ initial: 0, min: 0, integer: true }),

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
        // Barrier reform (Mana Shell): when the barrier breaks, it reforms
        // to full by consuming the original mana investment from the caster
        // again. Reform fails (barrier + linked sustain drop) if the caster
        // can't pay. Event-driven upkeep — pair with sustain tag at
        // sustainCost 0 so cancelling the sustain dispels the shell.
        barrierReform: new fields.BooleanField({ initial: false }),

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

        // Ritual (per design-ritual-subsystem.md Phase 2.5):
        //   ritualChargesProduced — how many charges one successful prep
        //     creates on the resulting Medium. Set per ritual. Default 1
        //     (single-use). Higher for rituals designed for stretched use.
        //   ritualMinMana — floor on the prep mana-invest slider. The
        //     ritualist can't attempt this ritual with less mana than this.
        //     Doesn't guarantee success — the progress formula (wisdom +
        //     material + mana, weights 0.55 / 0.30 / 0.15) still has to
        //     clear the rarity-derived threshold (see CONFIG.ASPECTSOFPOWER
        //     .ritualScale). Below threshold → materials + mana consumed,
        //     no Medium produced.
        ritualChargesProduced: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        ritualMinMana:         new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // Which moon this ritual belongs to, for the phase empowerment in
        // CONFIG.celestial.lunarAmplitude. Normally LEFT BLANK: the eight
        // authored lunar rituals are named byte-identically to the eight
        // phases, and that name IS the join key. Set this only for lunar
        // content named something else — a "Blood Moon Rite" that should count
        // as Full Moon.
        lunarPhase: new fields.StringField({ initial: '' }),
        // Per-ritual override: which skill does the inscribed Medium fire on
        // activation? Default empty = activate the ritual skill itself (legacy
        // single-skill rituals like Winds of Time). Set when the ritual is a
        // "definition" that points at a separate effect skill — e.g. Ritual
        // of Lightstream Prism → Place Lightstream Prism. Inscribe path
        // (item.mjs:3651) reads this and stores it on the Medium's
        // ritualSkillId. (Per user 2026-05-30: ritualism creates Medium,
        // Medium fires activation skill — they can be different.)
        ritualActivationSkillId: new fields.StringField({ initial: '' }),
      }),
    };
  }
}
