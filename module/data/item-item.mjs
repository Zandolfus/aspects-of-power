const { fields } = foundry.data;

/**
 * Data model for item-type items (gear/equipment).
 */
export class ItemItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),
      quantity:    new fields.NumberField({ initial: 1, min: 0, integer: true }),
      weight:      new fields.NumberField({ initial: 0, min: 0 }),
      formula:     new fields.StringField({ initial: 'd20 + @strength.mod + ceil(@level / 2)' }),

      // --- Equipment fields ---
      equipped:    new fields.BooleanField({ initial: false }),
      slot:        new fields.StringField({ initial: '' }),

      // Which hand holds an equipped weaponry-slot item (design-hand-slots,
      // ruled 2026-08-16): '' | 'main' | 'off'. Empty means "unassigned" and
      // every consumer falls back to the legacy heaviest-non-shield rule, so
      // the bestiary (which never assigns hands) is untouched. A 2H-tagged
      // weapon occupies both hands by derivation, never by storing 'main'
      // twice. Soft-enforced: the sheet assigns, helpers derive, nothing
      // hard-rejects — hard enforcement arrives with the dual-wield build.
      // ⚠ NO `choices` — a StringField with choices implies blank:false, so
      // every EXISTING item (whose hand is '') failed to initialize and the
      // whole world's equipment vanished (live 2026-08-16, caught in verify).
      // Plain string like `slot` above; consumers only read 'main'/'off'.
      hand:        new fields.StringField({ initial: '' }),

      // Additional slots — item can be cross-listed in multiple slot types.
      // E.g. a hammer in 'weaponry' (combat) can also be in 'profWeapon' (profession).
      additionalSlots: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      rarity:      new fields.StringField({ initial: 'common' }),
      twoHanded:   new fields.BooleanField({ initial: false }),

      // Material type — determines which repair skills can target this item.
      material:    new fields.StringField({ initial: '' }),

      // ── SPATIAL STORAGE (design-spatial-storage.md, RULED 2026-07-30) ──
      // Folded space: what is inside weighs nothing to the carrier.
      //
      // `spatialCapacity` > 0 marks this item AS a storage, and holds its
      // capacity in POUNDS. Derived at craft from progress x slot x rarity,
      // the same shape as armorBonus — a better jeweller makes a roomier ring,
      // so capacity tracks the power curve instead of drifting from it.
      spatialCapacity: new fields.NumberField({ initial: 0, min: 0 }),
      // `storedIn` holds the ID of the storage item this one lives inside.
      // Weight is excluded from carryWeight only while that storage is present
      // AND equipped — an unequipped ring is a ring, not a portal, so its
      // contents come crashing back onto your back.
      storedIn:    new fields.StringField({ initial: '' }),

      // Progress determines derived values (durability max, stats in the future).
      progress:    new fields.NumberField({ initial: 0, min: 0, integer: true }),

      durability: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 0, min: 0, integer: true }),
      }),

      // Stat bonuses — array of { ability, value } pairs.
      // When equipped, these become ActiveEffects with effectType:'equipment'.
      statBonuses: new fields.ArrayField(new fields.SchemaField({
        ability: new fields.StringField({ initial: 'strength' }),
        value:   new fields.NumberField({ initial: 0, integer: true }),
      }), { initial: [] }),

      // Defense bonuses provided by equipment.
      armorBonus: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      veilBonus:  new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Reach (in feet) for melee weapons. Used by skills tagged with the
      // `cleave` alteration to derive a cone-shape AOE matching the
      // weapon's natural arc — daggers stay short, polearms reach far.
      // Default 5 ft (one square). Designer-set per weapon item.
      reach: new fields.NumberField({ initial: 5, min: 5, integer: true }),

      // Flat damage bonus contributed when this item is wielded (weapon).
      // Set by augment itemBonuses (e.g. Sharpness +20, Molten +15).
      // Summed across the actor's equipped weapons into
      // actor.system.equippedDamageBonus and added to outgoing damage.
      damageBonus: new fields.NumberField({ initial: 0, integer: true }),

      // Flat damage reduction contributed when this item is equipped (armor).
      // Set by augment itemBonuses (e.g. Inscribe Physical Resist +8).
      // Summed across all equipped items into
      // actor.system.damageReduction.{physical,magical} and subtracted
      // from incoming damage in the apply-damage flow.
      damageReduction: new fields.SchemaField({
        physical: new fields.NumberField({ initial: 0, integer: true }),
        magical:  new fields.NumberField({ initial: 0, integer: true }),
        // Per-affinity DR map: { fire: 5, ice: 3, lightning: 8, ... }
        // Aggregated on the actor into system.damageReduction.affinities and
        // applied as a pre-step per-segment against affinity-tagged incoming
        // damage (augment-routed damage segments only — base weapon damage
        // continues to flow through physical/magical).
        affinities: new fields.ObjectField({ initial: () => ({}) }),
      }),

      // Augment slots (auto-set from rarity, but stored for override).
      augmentSlots: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      // Each slot entry carries:
      //   - `augmentId`  : UUID of the source compendium template (display-only)
      //   - snapshot of the augment's effect data (itemBonuses, craftBonuses,
      //     grantsTags) captured at apply time. Reads at firing time go to
      //     the snapshot — no compendium lookup needed (eliminates the
      //     fromUuidSync / pack-hydration race). Per design memo: augment
      //     values are frozen at craft time (future per-crafter scaling
      //     will compute these snapshot values when player crafting ships).
      augments: new fields.ArrayField(new fields.SchemaField({
        augmentId: new fields.StringField({ initial: '' }),
        itemBonuses: new fields.ArrayField(new fields.SchemaField({
          field:      new fields.StringField({ initial: '' }),
          value:      new fields.NumberField({ initial: 0 }),
          mode:       new fields.StringField({ initial: 'flat' }),
          // Set when a percentage-mode template bonus was RESOLVED to an
          // absolute value against the host at apply time (audit/display only
          // — `value` is already the resolved flat amount).
          pctOfHost:  new fields.NumberField({ initial: 0 }),
          affinity:   new fields.StringField({ initial: '' }),
          affinities: new fields.ObjectField({ initial: () => ({}) }),
        }), { initial: [] }),
        craftBonuses: new fields.ArrayField(new fields.SchemaField({
          type:     new fields.StringField({ initial: '' }),
          value:    new fields.NumberField({ initial: 0 }),
          affinity: new fields.StringField({ initial: '' }),
        }), { initial: [] }),
        grantsTags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        // Both snapshotted at slot time by crafting-skills, and both were
        // being SILENTLY DROPPED — a SchemaField discards keys it does not
        // declare, so `slotCost` never survived the write despite the writer
        // and the sheet both assuming it did (the sheet's fromUuid fallback
        // masked it). Declared here so the snapshot is what it claims to be.
        slotCost: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        // Brand of Shadows Bound: item progress gained per enemy the WEARER
        // kills. See the actor-death handler in aspects-of-power.mjs.
        onKillProgress: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // Snapshotted from the augment so the cap survives slotting. The
        // carrier's own tags come along too — a conditional is meaningless
        // without the tag it qualifies.
        tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        conditionalTags: new fields.ArrayField(new fields.SchemaField({
          id:        new fields.StringField({ initial: 'cap' }),
          qualifies: new fields.StringField({ initial: 'stacking' }),
          value:     new fields.NumberField({ initial: 0 }),
          atCap:     new fields.StringField({ initial: 'stop' }),
        }), { initial: [] }),
      }), { initial: [] }),

      // Profession augment slots — additional slots on profession gear that
      // ONLY accept augments tagged as profession augments.
      profAugmentSlots: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      profAugments: new fields.ArrayField(new fields.SchemaField({
        augmentId: new fields.StringField({ initial: '' }),
        itemBonuses: new fields.ArrayField(new fields.SchemaField({
          field:      new fields.StringField({ initial: '' }),
          value:      new fields.NumberField({ initial: 0 }),
          mode:       new fields.StringField({ initial: 'flat' }),
          // Set when a percentage-mode template bonus was RESOLVED to an
          // absolute value against the host at apply time (audit/display only
          // — `value` is already the resolved flat amount).
          pctOfHost:  new fields.NumberField({ initial: 0 }),
          affinity:   new fields.StringField({ initial: '' }),
          affinities: new fields.ObjectField({ initial: () => ({}) }),
        }), { initial: [] }),
        craftBonuses: new fields.ArrayField(new fields.SchemaField({
          type:     new fields.StringField({ initial: '' }),
          value:    new fields.NumberField({ initial: 0 }),
          affinity: new fields.StringField({ initial: '' }),
        }), { initial: [] }),
        grantsTags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        slotCost: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        onKillProgress: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // Snapshotted from the augment so the cap survives slotting. The
        // carrier's own tags come along too — a conditional is meaningless
        // without the tag it qualifies.
        tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        conditionalTags: new fields.ArrayField(new fields.SchemaField({
          id:        new fields.StringField({ initial: 'cap' }),
          qualifies: new fields.StringField({ initial: 'stacking' }),
          value:     new fields.NumberField({ initial: 0 }),
          atCap:     new fields.StringField({ initial: 'stop' }),
        }), { initial: [] }),
      }), { initial: [] }),

      // Skill IDs this item grants access to when equipped.
      grantedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Tags — unified field for free-form labels (weapon/armor/material/element)
      // AND registry-backed entity properties (affinities, resistances, passives).
      // Registry lookup via `CONFIG.ASPECTSOFPOWER.tagRegistry` when defined.
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      // @deprecated — merged into `tags`. Kept readable for the one-off
      // tag merge migration; consumers should read `tags` exclusively.
      systemTags: new fields.ArrayField(new fields.SchemaField({
        id:    new fields.StringField({ initial: '' }),
        value: new fields.NumberField({ initial: 0 }),
      }), { initial: [] }),

      // ── Deployable (design 2026-08-10) ────────────────────────────────
      // A rare item that is PLACED rather than used up: deploying spawns a
      // stub actor to hold it, and the item travels ONTO that actor. That is
      // what makes the deployed thing identifiable — an aura sourced from it
      // is a pylon aura because the pylon ITEM is sitting in its inventory,
      // so nothing needs a pylon tag on an actor.
      //   deployStubActorUuid  the stub NPC cloned to stand in for the item
      //   deployedTokenUuid    set while deployed; empty when carried
      //   deployOwnerUuid      who may recover it — the owner, and only them
      deployStubActorUuid: new fields.StringField({ initial: '' }),
      deployedTokenUuid:   new fields.StringField({ initial: '' }),
      deployOwnerUuid:     new fields.StringField({ initial: '' }),

      // Repair kit fields.
      isRepairKit:  new fields.BooleanField({ initial: false }),
      repairAmount: new fields.NumberField({ initial: 25, min: 0, integer: true }),

      // Crafting material fields.
      isMaterial:      new fields.BooleanField({ initial: false }),
      isRefined:       new fields.BooleanField({ initial: false }),
      materialElement: new fields.StringField({ initial: '' }),
      maxProgress:     new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Crafting iteration tracking — 0 = freshly crafted, increments per rework.
      reworkCount:     new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Per-field locks for the auto-derivation hook. When a field name
      // (e.g. 'armorBonus', 'statBonuses') is in this array, the
      // preUpdateItem auto-derive step skips it so user manual values
      // are preserved across progress / slot / material / rarity edits.
      // Lock UI lives on the item sheet next to each derivable field.
      lockedFields: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    };
  }
}
