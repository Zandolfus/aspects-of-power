const { fields } = foundry.data;

/**
 * Data model for augment items — slottable enhancements for equipment.
 */
export class AugmentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ initial: '' }),

      // Stat bonuses — same {ability, value} schema as equipment statBonuses.
      // These add to the actor's stats via the equipment's ActiveEffect.
      statBonuses: new fields.ArrayField(new fields.SchemaField({
        ability: new fields.StringField({ initial: 'strength' }),
        value:   new fields.NumberField({ initial: 0, integer: true }),
      }), { initial: [] }),

      // Item bonuses — modify the host equipment item's own properties.
      // e.g. +5% armorBonus on the item itself, not the actor directly.
      //
      // Affinity routing:
      //   - `affinities` (dictionary, preferred) maps affinity name to a
      //     relative weight. e.g. `{fire: 0.5, metal: 0.5}` splits this
      //     bonus 50/50; `{lightning: 1}` routes 100% through lightning.
      //     Weights are normalized at use, so `{fire: 1, metal: 1}` and
      //     `{fire: 0.5, metal: 0.5}` are equivalent.
      //   - `affinity` (legacy single-string) is back-compat shorthand for
      //     `{<affinity>: 1}`. New authoring should use `affinities`.
      //   - Both empty → untyped bonus, routes through host's base
      //     damage type (physical/magical).
      itemBonuses: new fields.ArrayField(new fields.SchemaField({
        field:      new fields.StringField({ initial: 'armorBonus' }),
        value:      new fields.NumberField({ initial: 0 }),
        mode:       new fields.StringField({ initial: 'percentage' }),
        affinity:   new fields.StringField({ initial: '' }),
        affinities: new fields.ObjectField({ initial: () => ({}) }),
      }), { initial: [] }),

      // Per-craft magnifier — if > 0, the augment's bonus values are scaled
      // at apply time: `snapshotValue = floor(skill.dmgRoll.total × magnifierPct)`.
      // Each `itemBonuses[i].value` (and craftBonuses[i].value) on the
      // template represents the BASELINE — the actual snapshot value is
      // computed per-application using the crafter's skill roll. magnifierPct
      // of 0 means use the template value verbatim (no scaling).
      magnifierPct: new fields.NumberField({ initial: 0, min: 0 }),

      // Crafter-mastery scaling (RULED 2026-07-25). When true, the magnifier
      // is NOT the static `magnifierPct` above — it's derived from the RARITY
      // of the craft skill applying the augment, via
      // CONFIG.ASPECTSOFPOWER.augmentRarityMagnifiers (common 0.1, uncommon
      // 0.2, … divine 0.8). "The magnitude should be based on the crafter's
      // skill in crafting." Takes precedence over magnifierPct when set.
      scaleWithCrafter: new fields.BooleanField({ initial: false }),

      // Profession augment flag — only fits in profession augment slots.
      // @deprecated — superseded by the `tags` array below. Kept readable for
      // back-compat reads but new code should check `tags.includes('profession')`.
      isProfessionAugment: new fields.BooleanField({ initial: false }),

      // Slot-eligibility tags. Read by `_handleAugmentTag` at slot time:
      //   - 'combat'      → fits in host's `augments[]` (combat slots)
      //   - 'profession'  → fits in host's `profAugments[]` (prof slots)
      //   - both          → hybrid; fits either, prefers prof
      // Empty tags falls back to legacy isProfessionAugment for back-compat.
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Craft bonuses applied when the augment is equipped on profession gear.
      // affinity (optional): only applies when material/output element matches.
      craftBonuses: new fields.ArrayField(new fields.SchemaField({
        type:     new fields.StringField({ initial: 'craftProgress' }),
        value:    new fields.NumberField({ initial: 0 }),
        affinity: new fields.StringField({ initial: '' }),
      }), { initial: [] }),

      // Tags this augment grants to the host item when slotted. The reconcile
      // hook in aspects-of-power.mjs appends these to item.system.tags on
      // slot, strips them on unslot (tracking origin in
      // flags.aspectsofpower.augmentGrantedTags so manual additions of the
      // same tag survive). Per design-augment-tag-grants.md.
      grantsTags: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      // Number of contiguous augment slots this augment occupies on the host
      // item. Default 1 (one slot per augment, current behavior). Larger
      // values mean the augment needs N consecutive free slots when slotted,
      // and removing it clears all N. Bonuses still apply ONCE regardless of
      // slotCost (iteration code dedupes by augment id).
      slotCost: new fields.NumberField({ initial: 1, min: 1, integer: true }),

      // ── ON-KILL PROGRESS (Brand of Shadows Bound, ruled 2026-08-05) ──
      // Item `progress` the HOST gains each time the wearer kills something.
      // Progress drives crafted stats, so a branded weapon genuinely levels
      // with use rather than sitting at whatever it was forged at.
      //
      // ⚠ THE CREDIT RULE IS "LANDED THE KILLING BLOW" — deliberately the
      // OPPOSITE of Burnt Offering, which pays out when a victim dies WHILE
      // carrying your DoT regardless of what actually killed them. Both hang
      // off the same actor-death hook; do not copy one rule into the other.
      // Resolved via flags.aspectsofpower.lastDamageSourceUuid, stamped by
      // whichever damage path wrote the lethal HP.
      //
      // NOT scaled by magnifierPct/scaleWithCrafter: this is a counter, not a
      // magnitude, and a crafter-scaled +2.7 progress per kill means nothing.
      // The RATE stays a field, not a tag: how much is gained per event is
      // inseparable from the event itself (per kill here; per target hit for
      // Flames Without; per round for a chill). Tags answer the general
      // question - does this accumulate, and is it bounded.
      onKillProgress: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // ── CONDITIONAL TAGS (user ruled 2026-08-05) ──
      // Qualifiers on this augment's own `tags`. The lifetime cap lives here:
      //   tags:            ['combat', 'stacking']
      //   conditionalTags: [{ id: 'cap', qualifies: 'stacking', value: 100 }]
      //
      // Parallel to `tags` rather than folded into it because `tags` is read as
      // a flat string array in 109 places (shield detection, weapon types, slot
      // eligibility); giving those entries a value would have meant touching
      // every one, with silent non-matching as the failure mode.
      //
      // Counted on the HOST in `flags.aspectsofpower.onKillProgressGained`, and
      // deliberately NOT reset by unslotting and re-slotting - the item already
      // grew, and a reset would make the cap a formality.
      conditionalTags: new fields.ArrayField(new fields.SchemaField({
        id:        new fields.StringField({ initial: 'cap' }),
        qualifies: new fields.StringField({ initial: 'stacking' }),
        value:     new fields.NumberField({ initial: 0 }),
        // stop | transform | trigger — see CAP_BEHAVIOURS. Only `stop` is
        // implemented; the others are declared so the vocabulary is fixed.
        atCap:     new fields.StringField({ initial: 'stop' }),
      }), { initial: [] }),
    };
  }
}
