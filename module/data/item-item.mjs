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

      // Additional slots — item can be cross-listed in multiple slot types.
      // E.g. a hammer in 'weaponry' (combat) can also be in 'profWeapon' (profession).
      additionalSlots: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      rarity:      new fields.StringField({ initial: 'common' }),
      twoHanded:   new fields.BooleanField({ initial: false }),

      // Material type — determines which repair skills can target this item.
      material:    new fields.StringField({ initial: '' }),

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
        affinities: new fields.ObjectField({ initial: {} }),
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
          affinity:   new fields.StringField({ initial: '' }),
          affinities: new fields.ObjectField({ initial: {} }),
        }), { initial: [] }),
        craftBonuses: new fields.ArrayField(new fields.SchemaField({
          type:     new fields.StringField({ initial: '' }),
          value:    new fields.NumberField({ initial: 0 }),
          affinity: new fields.StringField({ initial: '' }),
        }), { initial: [] }),
        grantsTags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
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
          affinity:   new fields.StringField({ initial: '' }),
          affinities: new fields.ObjectField({ initial: {} }),
        }), { initial: [] }),
        craftBonuses: new fields.ArrayField(new fields.SchemaField({
          type:     new fields.StringField({ initial: '' }),
          value:    new fields.NumberField({ initial: 0 }),
          affinity: new fields.StringField({ initial: '' }),
        }), { initial: [] }),
        grantsTags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
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
