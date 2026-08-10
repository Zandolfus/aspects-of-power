import { TAG_REGISTRY, TAG_CATEGORIES, CAP_BEHAVIOURS } from './tags.mjs';

export const ASPECTSOFPOWER = {};

// Tag system.
ASPECTSOFPOWER.tagRegistry   = TAG_REGISTRY;
ASPECTSOFPOWER.tagCategories = TAG_CATEGORIES;
ASPECTSOFPOWER.capBehaviours = CAP_BEHAVIOURS;

/**
 * The set of Ability Scores used within the system.
 * @type {Object}
 */
ASPECTSOFPOWER.abilities = {
  vitality: 'ASPECTSOFPOWER.Ability.vitality.long',
  endurance: 'ASPECTSOFPOWER.Ability.endurance.long',
  strength: 'ASPECTSOFPOWER.Ability.strength.long',
  dexterity: 'ASPECTSOFPOWER.Ability.dexterity.long',
  toughness: 'ASPECTSOFPOWER.Ability.toughness.long',
  intelligence: 'ASPECTSOFPOWER.Ability.intelligence.long',
  willpower: 'ASPECTSOFPOWER.Ability.willpower.long',
  wisdom: 'ASPECTSOFPOWER.Ability.wisdom.long',
  perception: 'ASPECTSOFPOWER.Ability.perception.long',

};

/**
 * Canonical ability-key list, derived from the abilities table above.
 * Import THIS instead of redeclaring the array (it existed as 5 separate
 * copies before 2026-07-03 — a silent-drift hazard when abilities change).
 */
export const ABILITY_KEYS = Object.keys(ASPECTSOFPOWER.abilities);

ASPECTSOFPOWER.abilityAbbreviations = {
  vitality: 'ASPECTSOFPOWER.Ability.vitality.abbr',
  endurance: 'ASPECTSOFPOWER.Ability.endurance.abbr',
  strength: 'ASPECTSOFPOWER.Ability.strength.abbr',
  dexterity: 'ASPECTSOFPOWER.Ability.dexterity.abbr',
  toughness: 'ASPECTSOFPOWER.Ability.toughness.abbr',
  intelligence: 'ASPECTSOFPOWER.Ability.intelligence.abbr',
  willpower: 'ASPECTSOFPOWER.Ability.willpower.abbr',
  wisdom: 'ASPECTSOFPOWER.Ability.wisdom.abbr',
  perception: 'ASPECTSOFPOWER.Ability.perception.abbr',
};

/**
 * Stat curve constants — power curve × per-grade multiplier.
 * Per design-stat-curves.md.
 *   mod = round((stat / NORM)^P × NORM × MULT_BASE^gradeIndex)
 */
ASPECTSOFPOWER.statCurve = {
  NORM: 1085,
  P: 0.8,
  MULT_BASE: 1.25,
  gradeIndex: { G: 0, F: 0, E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 },
};

/**
 * Spell tiers — display labels and cost/multiplier lookups per design-magic-system.md.
 *   base_mana  = spellTierFactors[tier] × spellGradeFactors[grade]
 *   multiplier = spellTierMultipliers[tier]   (designer-overridable per skill)
 */
ASPECTSOFPOWER.spellTiers = {
  basic:   'ASPECTSOFPOWER.SpellTier.basic',
  high:    'ASPECTSOFPOWER.SpellTier.high',
  greater: 'ASPECTSOFPOWER.SpellTier.greater',
  major:   'ASPECTSOFPOWER.SpellTier.major',
  grand:   'ASPECTSOFPOWER.SpellTier.grand',
};

ASPECTSOFPOWER.spellTierFactors = {
  basic: 2, high: 4, greater: 8, major: 25, grand: 50,
};

/**
 * @deprecated Superseded by `skillRarities` (rarity multiplier ladder)
 * per design-skill-rarity-system.md. Kept readable so the migration script
 * can bucket old per-spell tier values into the new starting rarity.
 */
ASPECTSOFPOWER.spellTierMultipliers = {
  basic: 0.20, high: 0.25, greater: 0.30, major: 0.40, grand: 0.60,
};

/**
 * Skill rarity ladder — the universal effect multiplier per
 * design-skill-rarity-system.md. Shared across melee/ranged/magic/healing.
 *
 *   effect = potency × (rarityMult + Σ alterationTag.dmgMod) × (invested/base)^0.2
 *   base_resource = baseFactor × rarityMult × (1 + Σ alterationTag.costMod)
 *
 * Mults are CONSTANT — they never change per grade. What changes is the
 * skill's `rarity` tag (auto-demotes one tier per grade-up E→D and beyond).
 * Floor at not_proficient (0.2) — never zero. Below that = GM discretion.
 */
ASPECTSOFPOWER.skillRarities = {
  not_proficient: { mult: 0.2, label: 'ASPECTSOFPOWER.SkillRarity.not_proficient', color: '#5a3030', subInferior: true },
  neglected:      { mult: 0.3, label: 'ASPECTSOFPOWER.SkillRarity.neglected',      color: '#704040', subInferior: true },
  rusty:          { mult: 0.4, label: 'ASPECTSOFPOWER.SkillRarity.rusty',          color: '#8a5040', subInferior: true },
  inferior:       { mult: 0.5, label: 'ASPECTSOFPOWER.SkillRarity.inferior',       color: '#888888' },
  common:         { mult: 0.6, label: 'ASPECTSOFPOWER.SkillRarity.common',         color: '#ffffff' },
  uncommon:       { mult: 0.7, label: 'ASPECTSOFPOWER.SkillRarity.uncommon',       color: '#1eff00' },
  rare:           { mult: 0.8, label: 'ASPECTSOFPOWER.SkillRarity.rare',           color: '#0070dd' },
  epic:           { mult: 0.9, label: 'ASPECTSOFPOWER.SkillRarity.epic',           color: '#a335ee' },
  legendary:      { mult: 1.0, label: 'ASPECTSOFPOWER.SkillRarity.legendary',      color: '#ff8000' },
  mythic:         { mult: 1.1, label: 'ASPECTSOFPOWER.SkillRarity.mythic',         color: '#e6cc80' },
  divine:         { mult: 1.2, label: 'ASPECTSOFPOWER.SkillRarity.divine',         color: '#ff4444' },
};

/**
 * Demotion order — index used by the grade-up demotion hook.
 * Demoting a rarity = move down one entry in this list.
 * Floor at not_proficient (index 0).
 */
ASPECTSOFPOWER.skillRarityOrder = [
  'not_proficient', 'neglected', 'rusty', 'inferior',
  'common', 'uncommon', 'rare', 'epic',
  'legendary', 'mythic', 'divine',
];

/**
 * Alteration tags — the per-upgrade Alteration choice menu.
 * Each tag carries a damage modifier (subtracts from effective mult, floor 0)
 * and a cost modifier (added as a fraction to the base resource cost).
 *
 *   effective_mult = max(0, rarityMult + Σ tag.dmgMod)
 *   base_resource  = baseFactor × rarityMult × (1 + Σ tag.costMod)
 *
 * `stacking` controls how multiple instances of the same tag interact:
 *   'multiple' — multiple instances allowed (e.g. multiple debuffs with different params)
 *   'max_one'  — only one instance per skill
 *   'replace_aoe' — adding any AOE tag replaces an existing AOE tag
 */
ASPECTSOFPOWER.alterationTags = {
  // Single AOE tag — caster picks size at placement (scroll wheel during preview).
  // Cost scales 2^((diameter - 5) / 5) — see item.mjs spell-invest path.
  // dmgMod: per-target damage drop (you split your output across targets).
  // weightMod: flat slowdown for the AOE wind-up; bigger casts are also
  //   slowed automatically via Wis-controlled channel time on bigger mana.
  aoe:         { label: 'ASPECTSOFPOWER.Alteration.aoe',         dmgMod: -0.20, costMod:  0.00, weightMod: 0.50, category: 'area',         stacking: 'max_one' },
  // Cleave: melee-only. Cone shape with size = wielded weapon's reach.
  // Damage/cost penalties; weightMod is small because reach itself is the gate.
  cleave:      { label: 'ASPECTSOFPOWER.Alteration.cleave',      dmgMod: -0.10, costMod:  0.20, weightMod: 0.30, category: 'damage_shape', stacking: 'max_one' },
  // Thrust: melee-only +5 reach. Consumed in _resolveSkillReach. Mods mirror
  // the generic `reach` alteration; tune once we have play data.
  thrust:      { label: 'ASPECTSOFPOWER.Alteration.thrust',      dmgMod: -0.05, costMod:  0.10, weightMod: 0.10, category: 'range',        stacking: 'max_one'  },
  debuff:      { label: 'ASPECTSOFPOWER.Alteration.debuff',      dmgMod: -0.10, costMod:  0.20, weightMod: 0.20, category: 'status',       stacking: 'multiple' },
  dot:         { label: 'ASPECTSOFPOWER.Alteration.dot',         dmgMod: -0.15, costMod:  0.30, weightMod: 0.30, category: 'status',       stacking: 'max_one'  },
  penetration: { label: 'ASPECTSOFPOWER.Alteration.penetration', dmgMod: -0.05, costMod:  0.00, weightMod: 0.10, category: 'damage_shape', stacking: 'multiple' },
  reach:       { label: 'ASPECTSOFPOWER.Alteration.reach',       dmgMod: -0.05, costMod:  0.10, weightMod: 0.10, category: 'range',        stacking: 'multiple' },
  channeled:   { label: 'ASPECTSOFPOWER.Alteration.channeled',   dmgMod: -0.10, costMod: -0.50, weightMod: 1.00, category: 'cost_shape',   stacking: 'max_one'  },
  self_buff:   { label: 'ASPECTSOFPOWER.Alteration.self_buff',   dmgMod: -0.10, costMod:  0.00, weightMod: 0.10, category: 'self',         stacking: 'multiple' },
  // ── AMBUSH — THE FIRST POSITIVE dmgMod IN THE GAME (ruled 2026-08-06) ──
  //
  // Every other alteration is a PRICE: you give up damage to buy area, reach,
  // a rider, a DoT. There was no way to buy POWER, so the only lever an author
  // had for "this attack hits harder" was the RARITY LADDER — and rarity is
  // the how-well-do-you-know-this-skill axis, not a power axis. Three sneak
  // attacks (Frieda's Snipe, Gabriel's Sneak Attack, Philip Patton's
  // Assassinate) had been pushed to `divine` purely to raise their damage,
  // which is why they sat on a rarity the user had ruled unreachable.
  //
  // 0.50 is chosen so that `rare` x ambush reproduces `divine` EXACTLY:
  //     0.8 x 1.5 = 1.20 = skillRarities.divine.mult
  // so the three skills keep their damage to the digit while rarity goes back
  // to meaning proficiency — and they can still grow, which divine could not.
  //
  // costMod 0.30 is the PLACEHOLDER FOR THE STEALTH PRECONDITION. An ambush
  // should be paid for by setup (being unseen), but no stealth STATE exists
  // yet — engagement-halts.mjs says so explicitly and the only thing available
  // is Foundry's `token.hidden`, a GM VISIBILITY toggle that means something
  // else. Until stealth lands, the resource cost stands in for the setup.
  // ⚠ When stealth ships, revisit: the cost should probably drop and the
  // damage should become CONDITIONAL rather than always-on.
  //
  // weightMod 0 deliberately: weightMod feeds computeWindupMultiplier, so any
  // value would ALSO change per-hit damage and break the exact-divine match.
  ambush:      { label: 'ASPECTSOFPOWER.Alteration.ambush',      dmgMod:  0.50, costMod:  0.30, weightMod: 0.00, category: 'conditional',  stacking: 'max_one'  },
};

/**
 * SPELL GRADE FACTORS — DERIVED FROM THE STAT CURVE, NOT A SEPARATE LADDER.
 * (Ruled + simmed 2026-08-06. Was `G 2.5, F 5, E 10, D 24, C 56, B 130,
 * A 300, S 700`.)
 *
 * ⚠⚠ THE OLD TABLE PUNISHED EVERY RANK-UP. It stepped x~2.3 per rank while
 * ability mods — which drive BOTH damage and the mana pool — step x1.25
 * (`statCurve.MULT_BASE ^ gradeIndex`). Measured on a caster who actually
 * levels, each rank-up roughly HALVED casts-per-pool at the moment of
 * transition and cost ~100 levels to claw back:
 *
 *     E->D at lvl 100: 20 casts -> 10      C->B at lvl 300: 13 -> 7
 *     D->C at lvl 200: 18 -> 9             B->A at lvl 400:  9 -> 4
 *                                          A->S at lvl 500:  5 -> 3
 *
 * Damage per cast still rose, so it was a SUSTAIN failure, not an output one —
 * a higher-rank caster hit harder and ran dry far faster. It also shrank AOEs
 * (sizing is capped by `2^n x base <= pool`): 2^3 at E down to 2^0 by A.
 *
 * ⚡ WEAPONS ALREADY GOT THIS RIGHT, which is what settled the shape.
 * `baseStamina` is `(weight/divisor) x (blend/normalizer)` with NO grade term,
 * so cost and pool both scale x1.25 and strikes-per-pool is rank-invariant
 * (measured 133/125/125/111/122/111 from E to S). Spells were the outlier.
 * This does not invent a rule; it makes casting obey the one striking follows.
 *
 * DERIVED, NOT TABULATED, so the two ladders can never drift apart again —
 * that drift is the entire bug. `gradeIndex` is 0 for G, F AND E, so cost is
 * flat exactly where the stat multiplier is flat (user 2026-08-06: G/F->E
 * "relatively flat ... g isn't really a thing outside of preinitiation
 * humans"). Resulting values:
 *
 *     G 10   F 10   E 10   D 12.5   C 15.625   B 19.531   A 24.414   S 30.518
 *
 * Live-content impact when this landed: E is unchanged and 108 of the world's
 * 222 actors are E. At G only 5 of 101 actors had a tiered spell (Aaron — a
 * standing "ignore" case, two carrying the retired Drain Animus, one monster,
 * and Beastman Hordecaller); at F only 3 of 13. Tightest real case was Arjan
 * Terry, 44 mana, 4 basic casts -> 2.
 *
 * ⚠ Consumed for BOTH cost and the damage reference — `baseMana` at
 * item.mjs:5216/5664 and `spellDamageRef()` at :5423/:5516/:5673 — so it
 * reaches spells, heals, barriers, spellstrike infusions and AOE sizing.
 * It does NOT reach weapon strikes, ki or stacks.
 */
ASPECTSOFPOWER.spellGradeFactors = Object.fromEntries(
  Object.entries(ASPECTSOFPOWER.statCurve.gradeIndex).map(([rank, gi]) =>
    [rank, 10 * Math.pow(ASPECTSOFPOWER.statCurve.MULT_BASE, gi)]));

/**
 * MAGIC/MELEE UNIFICATION (2026-08-02) — OFF by default, flip to test.
 *
 * A weapon uses its weight TWICE: as WINDUP (damage) and as WAIT (tempo).
 * That pairing is what makes DPR weight-invariant — windup is weight/100 and
 * wait is proportional to weight, so damage-per-round cancels out and weight
 * becomes a pure per-hit-size-versus-tempo dial.
 *
 * Spells only ever used `spellTierWeights` for WAIT. Tier therefore cost time
 * without paying damage, and casting a bigger spell was strictly worse:
 * measured on Willy, DPR ran 1021 (basic) → 873 (greater) → 357 (grand).
 *
 * `spellInvestDamage` and `strikeInvestDamage` are already the same function
 * with windup pinned to 1, so switching this on is "stop passing the neutral
 * value", not a new formula.
 *
 *   model 'none'      shipped behaviour — windup 1
 *         'tier'      windup from spellTierWeights
 *         'implement' the IMPLEMENT is the weapon and the spell adds to it, so
 *                     a wand-basic (40+130) is quick and light while a
 *                     staff-greater (140+200) is a siege engine. Costs nothing
 *                     in DPR — it only moves the per-hit/tempo dial.
 *
 * ⚠ `windupMax` (defenseTuning, 3.0) starts taxing combined weight above 300:
 * wait keeps scaling but damage stops, so heavy-implement/high-tier builds LOSE
 * DPR. Weapons never reach it (greataxe 220 is the heaviest thing in the game),
 * so it has always been a distant ceiling; under 'implement' it becomes an
 * active penalty. `windupMaxSpell` overrides it for spells only.
 *
 * ⚠ Turning this on is a 30-100% caster damage increase. Simmed via
 * migration/archetype_sim.js: healthy on uniformly-built archetypes (immunity
 * 45%→35%, median 3.9→4.5 rounds), but it AMPLIFIES content that is already
 * out of band — on the live roster it roughly halves time-to-kill, because
 * divine-rarity skills and the unscaled legacy branch are already outliers.
 *
 * ENABLED 2026-08-03 as 'implement'. The live-roster alarm above was measured
 * with a CONTINUOUS-DPR sim; under the discrete timing shipped in 6273433 it
 * is far milder — median 3.4 → 2.1 rounds and 15 → 18 sub-2-round matchups,
 * not the near-halving. Casters become slow artillery: every one of Willy's
 * spells now takes longer than a round, and he loses five of six duels.
 */
ASPECTSOFPOWER.spellWeight = {
  model: 'implement',
  // Wands already own BASIC via WAND_BASIC_WAIT_MULT. This re-gates the STAFF's
  // +baseMana of free damage scaling from "cast takes ≥ half a round" to
  // "tier above basic", so each implement owns a band of the tier ladder
  // instead of both keying off cast time.
  //
  // ON: measured +15% on above-basic spells, correctly inert on basic tier,
  // and it changed NO duel outcome — median, immunity, floor and overcommits
  // are identical either way. Chosen for the identity, not the numbers: the
  // wait-threshold gate it replaces can switch the staff OFF mid-build when a
  // caster gets faster, which a tier gate never does.
  tierGatedImplements: true,
  // null = fall back to defenseTuning.windupMax (3.0).
  //
  // ⚠ THE CLAMP MUST NEVER BIND, or the unification inverts. Windup pays for
  // damage while wait pays for tempo; clamping one and not the other makes a
  // HEAVIER implement strictly worse. At 3.0, staff+greater (w340) gets windup
  // 3.0 for 1.7x wait — DPR 1.76 — while wand+greater (w240) gets 2.4 for 1.2x
  // — DPR 2.00. The wand wins, which is precisely backwards. Parity needs
  // max ≥ heaviestWeight/100 (3.4 today). Set well above that so future
  // content cannot silently re-invert it.
  windupMaxSpell: 99,
};

/**
 * Spell-tier celerity weights per design-magic-system.md.
 * Drives `wait = weight × multiplier × SCALE / actor_speed` for magic skills.
 * Mirror of weaponWeights but keyed by spell tier rather than weapon-type tag.
 */
ASPECTSOFPOWER.spellTierWeights = {
  basic:    130,
  high:     150,
  greater:  200,
  major:    400,
  grand:    700,
};

/**
 * Melee Option B Str/Dex hybrid blend per design-melee-system.md.
 *   normWeight = clamp01((weight - weightOffset) / weightSpan)
 *   strWeight  = strFloor + slope × normWeight  → [strFloor, strFloor+slope]
 *   dexWeight  = 1 - strWeight
 *   stat_blend = Str_mod × strWeight + Dex_mod × dexWeight
 */
ASPECTSOFPOWER.meleeBlend = {
  strFloor:     0.30,
  slope:        0.70,
  weightOffset: 40,
  weightSpan:   180,  // weight 40 → strWeight 0.30; weight 220 → strWeight 1.00
};

/**
 * Ranged Option α Dex/Per hybrid blend per design-ranged-system.md.
 *   perWeight  = perFloor + slope × normWeight  → [perFloor, perFloor+slope]
 *   dexWeight  = 1 - perWeight
 *   stat_blend = Dex_mod × dexWeight + Per_mod × perWeight
 */
ASPECTSOFPOWER.rangedBlend = {
  perFloor:     0.05,
  slope:        0.55,
  weightOffset: 50,
  weightSpan:   200,  // weight 50 → perWeight 0.05; weight 250 → perWeight 0.60
};

/**
 * Variable resource-invest tuning — shared across casters and weapon users.
 *   safe_invest_stam = Tough_mod × toughCapFactor   (melee soft cap; over-invest = self-damage)
 *   base_stamina     = weight / staminaBaseDivisor × stat_blend / staminaNormalizer
 *
 * Spell-side invest cap is per-tier under the hard-cap design — see
 * spellMaxInvestAboveBase below. Wisdom doesn't have a flat invest knob
 * here; the per-tier table is the single source of truth.
 */
ASPECTSOFPOWER.invest = {
  // HEALTH AS AN INVEST RESOURCE (RULED 2026-07-31). Blood magic and vitality
  // healers pay in their own life, so `health` reaches the spell invest path
  // like mana does. This is the HP a caster must be left with — the invest
  // slider caps here so nobody can commit a lethal amount by accident.
  // (`_commitCastCost` clamps at 0, so the guard has to live at the slider.)
  healthFloor: 1,
  toughCapFactor:     0.02,
  staminaBaseDivisor: 20,
  staminaNormalizer:  1085,
  // THE INVEST CURVE — one exponent behind every "commit more resource for a
  // bigger result" in the game: spell damage, weapon strikes, spellstrike
  // infusion, and (once unified) healing.
  //
  // 0.2 is deliberately flat: committing 4x the resource buys 1.32x the
  // result, so dumping a pool is inefficient and there is no alpha strike.
  // The cost of that flatness is that the invest DIAL barely exists —
  // measured on healing, doubling the commitment buys +15%, which no player
  // would ever choose.
  //
  // ⚠ Raising this is a whole-game change, not a tuning nudge. At 0.5 (sqrt)
  // the same 4x commitment buys 2x. Sim before touching it — the caps
  // (wis/tough) do more to prevent alpha strikes than the exponent does.
  //
  // RULED 0.5 (sqrt) on 2026-08-03, simmed first. At 0.2 the invest dial was
  // decorative: doubling a commitment bought +15%, so nobody would ever spend
  // above base and the slider may as well not exist. At 0.5 it buys +41%, paid
  // for in sustain — a real decision every round.
  //
  // Measured game-wide on the [SIM] testbed, invest at the legal cap: median
  // 4.2 → 3.1 rounds, immunity 35% → 25%, sub-2-round matchups UNCHANGED at 3,
  // no shutouts. It widens expression without moving the floor.
  //
  // ⚠ THE CAPS ARE WHAT MAKE THIS SAFE, not the exponent. Uncapped, sqrt gives
  // 0.7-round medians and 15 of 20 matchups under the floor — but so does 0.2,
  // at 2.0 rounds. See design-invest-curve-and-caps.md before loosening any
  // invest cap, and note that the channel-time brake does NOT bite on spells
  // that are already slow.
  curveExponent: 0.5,
};

/**
 * Spellstriker tuning (design-spellstriker.md). Type-2 FUSION spellstrikes
 * (weapon strike + `infused` int mana-rider) are balance-bounded so the
 * fusion honors "never best of both worlds": the infusion's mana invest is
 * wis-capped exactly like a real spell of its tier, and its damage is scaled
 * by `infusionCoef` (< 1) — the fusion penalty for also landing the strike.
 *   infusion = Int × infusionCoef × (mana / basicRef)^0.2
 * At 0.7 the infusion ≈ 70% of an equivalent pure spell, so a fusion hit lands
 * ~88% of a fighter's heavy hit while costing BOTH stamina and mana (sim
 * 2026-07-03). Type-1 vehicle spellstrikes are unaffected — they run the full
 * spell formula (rarity mult + wis-cap) already.
 */
ASPECTSOFPOWER.spellstrike = {
  infusionCoef: 0.7,
};

/**
 * Armor-answer system (design-armor-answer-system.md; FLAT/absolute rework
 * 2026-07-18, design-burn-status.md). The physical ARMOR layer (armor+blockDR)
 * is reduced by three FLAT reductions that SUM and are anchored to the
 * ATTACKER's output (never a fraction of the target's armor — that scaled with
 * target grade and let a lower-grade attacker strip a huge absolute chunk of a
 * superior's armor). All grade-correct by construction:
 *   pierce  = pierceHitFrac × attacker hit          (weapon/tag property, per-hit)
 *   crush   = Σ crushDamageFrac × applier DAMAGE     (stacking debuff, stored flat)
 *   melt    = Σ armorMeltRate × burn-stack dotDamage (global; design-burn-status)
 *   armorAfter = max(0, armor+blockDR − pierce − crush − melt)
 * DR-strip (toughDR layer) is separate (drStrip flag). Legacy %-fields kept for
 * back-compat/migration only; the calc no longer reads them.
 */
/**
 * ── THE FLAT-IDENTITY RULE (RULED 2026-07-28) ──
 * A weapon's signature mechanic is a property of the WEAPON and does not scale
 * with the wielder's mastery. Hammer pierce and axe wear are both FLAT.
 *
 * Mastery expresses itself as DAMAGE and nothing else
 * (systems/weapon-styles.proficiencyDamageMult). A divine hammer master pierces
 * exactly as deeply as someone who picked one up this morning — they simply hit
 * far harder with it.
 *
 * Chosen for symmetry after the two mechanics were nearly ruled differently.
 * The practical argument: laddering axe wear reopens the multi-axe case (wear
 * scales linearly with attacker count, so five masters strip a kit in ~5 rounds
 * at 20%), and fixing that needs per-round attacker tracking that
 * degradeDurability cannot do — it is called once per damage application with
 * no knowledge of how many attackers exist. Rather than ladder one and not the
 * other, neither ladders.
 *
 * If this is ever revisited, BOTH move together.
 */
ASPECTSOFPOWER.armorAnswer = {
  // FLAT, never laddered by mastery — see the flat-identity rule above.
  pierceHitFrac:       0.23,   // pierce flat = frac × attacker hit
  // Blunt weapons transmit through armour. `mace` was listed here from the
  // start but is NOT a key in weaponWeights, so it has never matched anything —
  // kept only so removing it is a deliberate act rather than a silent one.
  pierceWeaponTypes:  ['hammer', 'greathammer', 'mace'],
  // Crush flat, PER application = frac × the applier's DAMAGE. Named
  // crushHitFrac until 2026-07-30, which was simply wrong — the code always
  // multiplied dmgRoll.total, never the hit total. Old key still read as a
  // fallback so any stale reference keeps working.
  //
  // 0.05 RULED 2026-07-30 from a 2D sweep against the live roster. At 0.10+
  // crush stops being a heavy-armour answer and becomes a universal armour
  // DELETER — three stacks of George's greataxe zeroed every mid-tier wall in
  // the party (Frieda 357→0, Harvey 352→0). At 0.05 it dents them (357→153)
  // and still does its real job: Phil's 912 layer → 708, which turns George's
  // 186/hit into 390/hit and opens a ~2-round kill window inside the 3-round
  // stack duration. The collateral is academic anyway — George already kills
  // mid-tier targets in under a round WITHOUT crush, so the coefficient is
  // tuned purely on the top-two-walls case, which is the only one it decides.
  crushDamageFrac:     0.05,
  armorCrushMaxStacks: 3,      // cap on crush stacks that contribute
  burnMeltRate:        0.5,    // default armor-melt rate (× Σ burn dotDamage)
  // ── AXE WEAR (design-weapon-proficiencies.md, RULED 2026-07-28) ──
  // Armour is worn by what it STOPPED (min(hit, wall) × rate), not by what got
  // through. The previously-ruled "multiply the damage that got through" model
  // is provably inert — a cascade sim found NO case at any multiplier from x1
  // to x4 where a piece ever broke, because a wall thick enough to matter lets
  // nothing through, and anything that does get through kills the target in
  // 1-3 rounds. Wearing on absorbed damage inverts it: the heavier the wall,
  // the harder it works, the faster it wears. HP mitigation is untouched.
  //
  // 10% FLAT, no mastery ladder — per the flat-identity rule above, and because
  // the sim showed the RATE, not the model, drove the multi-axe problem.
  // Rounds to strip a heavy kit with 5 axes: 20% → 5 rounds; 10% → 10.
  // A solo axe never strips anyone. Note the gate is HOLDING an axe, not owning
  // any axe proficiency — untrained hands wear armour at the same rate.
  // Anchored to the ATTACKER's hit, so a gang of inferiors cannot grind down a
  // superior's kit (verified: 8 weak axes leave the best-armoured actor
  // intact). Set to 0 to disable.
  axeWearRate:        0.10,
  axeWeaponTypes:     ['axe', 'greataxe'],
  // ── legacy %-fields (SUPERSEDED by flat, kept for migration back-compat) ──
  pierceFraction:     0.35,
  armorCrushPerStack: 0.10,
};

/**
 * Power-sense indicators (design-power-sense.md, RULED 2026-07-14).
 * Magnitude is UNIVERSAL (ring for every observer in range); tier is
 * OBSERVER-RELATIVE: invest ÷ observer capacity (wil.mod for mana, the
 * physSafeFrac×tough safe-invest ceiling for physical), bucketed by
 * tierBands into faint/notable/heavy/overwhelming. Affinity identity is
 * gated by the `affinity-sight` sense tag. rangePerPerception: sensory
 * range = observer per.mod × this many ft.
 */
ASPECTSOFPOWER.powerSense = {
  rangePerPerception: 1.0,
  tierBands: [0.3, 0.9, 2.0],
  physSafeFrac: 0.02,
};

/**
 * Affinity display colors (power-sense ring tint, future UI accents).
 * Keys match ASPECTSOFPOWER.affinities. Kept beside the dictionary —
 * candidate to fold into the entries themselves on the next dictionary pass.
 */
ASPECTSOFPOWER.affinityColors = {
  fire: '#ff5722', earth: '#8d6e63', water: '#29b6f6', wind: '#b2dfdb',
  lightning: '#ffee58', ice: '#81d4fa', lunar: '#b39ddb', solar: '#ffb300',
  space: '#5c6bc0', metal: '#90a4ae', heat: '#ff8a65', blood: '#c62828',
  shadow: '#616161', nature: '#66bb6a', poison: '#9ccc65', necromantic: '#7b1fa2',
  holy: '#fff59d', light: '#ffffff', psychic: '#ec407a', time: '#26a69a',
  karma: '#a1887f', physical: '#e0d7c6',
};

/**
 * Celerity timing constants (per design-celerity.md).
 *   wait = (weapon_base_weight × skill_multiplier × SCALE) / actor_speed
 *   round_length = ROUND_K / ref_mod(RL)
 *   3 sword-equivalent swings per round at any grade by construction.
 */
ASPECTSOFPOWER.celerity = {
  SCALE:              10_000,
  ROUND_K:            3_000_000,
  BASELINE_WEIGHT:    100,    // sword reference
  ACTIONS_PER_ROUND:  3,      // by-construction target swings/round
  // Real-time anchor (design-celerity-realtime.md, RULED 2026-07-02):
  // 1 tick ≡ TICK_MS milliseconds of world time. Calibrated so a G1/mundane
  // human (ref_mod 36) takes 2.0s per sword swing (27,778 ticks) and has a
  // 6.0s reference round. DISPLAY-ONLY — waits, rounds, and all balance
  // math stay in ticks; this converts for presentation. Published Celerity
  // rating = mod × 1000 / (SCALE × TICK_MS) action-points per second.
  TICK_MS:            0.072,
  // Orb implement: cumulative spell weight required to discharge the next
  // spell cast as free + fast. Set at Major-tier weight (400) so:
  //   Basic spam (banks 130/cast):  every 4th cast discharges
  //   High spam (banks 150/cast):   every 4th cast discharges
  //   Greater spam (banks 200/cast): every 3rd cast discharges
  //   Major/Grand: every cast discharges (each banks ≥ threshold)
  // Universal across tiers per design 2026-05-06 — Wand stays the speed
  // king on Basic; Orb is the mana-economy alternative.
  // Wand implement: Basic-tier spell wait multiplier (−23% per design
  // 2026-05-06). Lived inline in celerity.mjs before 2026-07-03.
  WAND_BASIC_WAIT_MULT: 0.77,
  ORB_DISCHARGE_THRESHOLD: 400,
  // Base movement weight per 5ft. Multiplied by the selected mode's
  // `celerityMult` (see MOVEMENT_MODES below). Sprint = 1× baseline (this
  // value), Walk = 2× (slower per ft).
  MOVEMENT_BASE_WEIGHT_PER_5FT: 10,
  // Movement modes per design-movement-modes.md. Anchors:
  //   - Celerity: Sprint = 1× baseline (fast); Walk = 2× ticks/ft (slow).
  //   - Stamina:  Walk   = 1× baseline (1 stamina per 5 ft); Sprint = 3×
  //               (3 stamina per 5 ft).
  // The anchors swap between the two dimensions — walking is slow but
  // cheap, sprinting is fast but expensive. Default is Walk; Shift = Sprint.
  MOVEMENT_MODES: {
    walk:   { celerityMult: 2.0, staminaMult: 1.0, label: 'walk'   },
    sprint: { celerityMult: 1.0, staminaMult: 3.0, label: 'sprint' },
  },
  DEFAULT_MOVEMENT_MODE: 'walk',
  // Walk-mode bonus to the relevant defense roll when triggering terrain
  // effects (regions that declare a `targetStat`). +25% of the actor's
  // mod for that stat is added to the roll. Per design-movement-modes.md.
  WALK_TERRAIN_BONUS_FRACTION: 0.25,
  // Channel rate factor — per the Wis-controlled-channel design, channeling
  // mana costs additional celerity time:
  //   channel_ticks = invested × CHANNEL_FACTOR / Wis_mod
  // Spells fire at MAX(base_cast_time, channel_ticks).
  CHANNEL_FACTOR: 3000,
  // Manual break-free is deterministic in time, NOT stat-dependent:
  //   wait = referenceRoundLength(actorRL) × BREAK_FREE_ROUND_FRACTION
  // 1/3 = one "action's worth" of an actor's round, matching the
  // ~3-actions-per-round design invariant. Break attempts pace the same
  // as a sword swing at any grade — the BREAK ROLL is what scales with
  // stat, not the time to attempt.
  BREAK_FREE_ROUND_FRACTION: 1 / 3,
  // Break-roll yield multiplier per round afflicted (linear growth):
  //   yieldMult = 1 + (roundsAfflicted × BREAK_FREE_YIELD_PER_ROUND)
  // Round 0 = 1×. Round 4 = 2×. Round 8 = 3×. Round 12 = 4×. Etc.
  // Re-applying a non-stackable debuff resets the counter to 0. Caster
  // must keep afflicting to keep the target on the slow grind.
  BREAK_FREE_YIELD_PER_ROUND: 0.25,
  // Default activation fraction for `granted` skills (race/item/system-given).
  // wait = referenceRoundLength(actorRL) × tagConfig.grantedActivationFraction
  // (defaulting here when the skill omits an explicit value). 1/3 mirrors
  // break-free — one action's worth of an actor's round. Build-neutral.
  GRANTED_DEFAULT_FRACTION: 1 / 3,
  // Realtime anchor: the FASTEST combatant's reference round plays out over
  // this many wall-clock seconds. Everything else (glide speeds, fire delays,
  // the continuous clock) derives its ticks-per-millisecond rate from this.
  REALTIME_FASTEST_ROUND_SECONDS: 5,
};

/**
 * Active Defense tuning (design-active-defense.md v2, shipped 2026-06-12).
 * ALL values are percentages of rolls or fractions of the actor's own
 * tempo — never flat constants (stats span ~50→5,600 across grades; flat
 * numbers can't survive the curve).
 */
ASPECTSOFPOWER.defenseTuning = {
  // Dodge: each dodge delays the defender's next action by this fraction
  // of their own action wait (declared action's wait when queued, else
  // last wait, else a baseline-weight dex step).
  dodgeCostFraction: 0.25,
  // Scramble: consecutive dodges degrade the dodge value by this fraction
  // per stack; stacks decay continuously (1 stack per ¼ personal round ×
  // scrambleDecayQuarterRounds).
  scrambleStackPct: 0.15,
  scrambleDecayQuarterRounds: 1,
  // ⚠ OBSOLETE as of THE MARGIN RULE (2026-07-31) — a failed defence now
  // scales continuously with the margin, so there is no graze STEP to size.
  // Kept only so any content or macro still reading it does not throw.
  grazeBandPct: 0.10,
  // AI defence policy under the margin rule: defend when the expected share
  // turned aside clears this. Replaces aiDodgeWinProbMin, which asked for a
  // 35% chance of TOTAL avoidance — far too conservative once a failed dodge
  // still reduces damage. The brake on always-defending is the scramble stack
  // and the tempo cost, not the odds.
  aiDefendMinReduction: 0.20,
  // Dodge basis divisor: the dodge ROLL uses defense.value ÷ this. The ×1.1
  // in the defense value is pool-era inflation — rolled at full value,
  // parity dodge sits at 91% and mirror fights never resolve (sim
  // 2026-06-12); stripped, parity is a 54% coin flip and fights conclude.
  dodgeBasisDiv: 1.1,
  // Windup: damage multiplier = clamp(weight × skillMult / 100, min, max).
  // UNCLAMPED-linear per 2026-06-11 ruling — dagger 0.6×, sword 1.0×,
  // greatsword 2.0×. Heavy = anti-armor burst, light = on-hit frequency.
  // Spells excluded (mana investment is their burst dial).
  windupMin: 0.5,
  windupMax: 3.0,
  // Block DR: held weapon contributes flat mitigation =
  //   coef × (weight/100) × (1 + str.mod/1085).
  // At coef 80: GS ≈ 266, sword ≈ 133, dagger ≈ 70 vs a full armor set
  // ~364 (the 30-60% design band). Shields excluded — they already grant
  // armorBonus via craftShieldArmorValues.
  blockDRCoef: 80,
  // Parry mass ratio (RULED 2026-07-27, k=0.3 "gentle"): a parry is scaled by
  // min(1, (defenderWeaponWeight / attackerWeaponWeight) ^ k), so heavy weapons
  // are hard to turn aside. At 0.3 a dagger parries a greatsword at x0.70 and a
  // sword at x0.81 — a real thumb on the scale that never decides the exchange
  // on weapon choice alone. Set to 0 to disable. See formulas.parryMassMultiplier.
  parryMassExponent: 0.3,
  // BRACED PARRY (`braced` tag, RULED 2026-07-31). Stamina buys EFFECTIVE
  // weapon weight for the mass ratio only. Price of +1x weight is this
  // fraction of the incoming HIT TOTAL — proportional like the rider cost, so
  // it holds up across grades instead of going free at high level. At 0.05 a
  // 1070 hit charges ~54 stamina per +1x: Gabriel (pool 400, dagger 60) pays
  // ~143 to reach parity with a greataxe, a real bite out of a 400 pool;
  // Phil's claymore is already at x0.97 and barely needs to brace at all.
  // ⚠ 0.05 is a FIRST PASS, not a simmed value — see design-braced-parry.
  bracedCostHitFrac: 0.05,
  // Hard ceiling on the weight multiplier, so a braced dagger cannot pretend
  // to be a siege ram. The mass cap min(1, …) usually binds first anyway.
  bracedMaxWeightMult: 3.0,
  // Shrapnel: instead of the old pool-cost multiplier, shrapnel attacks
  // penalize the dodge roll by this fraction (fragments are hard to dodge).
  shrapnelDodgePenalty: 0.25,
  // Global HP multiplier (gap-analysis Family D, sim-validated 2026-06-11):
  // raises TTK floor so windup bursts don't one-shot same-rank actors.
  hpScale: 1.5,
  // AI defense auto-policy: AI-flagged defenders dodge when their exact
  // dodge win probability (two-d20 contest) meets this threshold; else eat.
  aiDodgeWinProbMin: 0.35,
  // Perceive-to-react gate (design-celerity-realtime.md, RULED 2026-07-02).
  // Active defense may be ATTEMPTED only while
  //   attacker_Celerity <= perceiveGateRatio x defender_Celerity,
  // measured on the build-neutral REFERENCE (race-level) curve. R = 2.5 is
  // sim-locked: it covers the ruled +/-25-level window in every grade from E
  // up, and grade boundaries stay smooth (adjacent-level ratios ~1.26x).
  // A ratio, not a level gap — "gap <= 25" would permit a 10.4x blur at low
  // RL. Set to 0 to disable the gate.
  perceiveGateRatio: 2.5,
  // Mortal-band exemption: when attacker AND defender are both G/F the gate
  // is waived. G's interior spread is 4.1-4.5x across nine levels, which no
  // flat R can honor. Cross-band (G/F vs E+) still uses the ratio.
  perceiveGateMortalBand: true,
};

/**
 * AI profiles (module/systems/ai.mjs). Actors opt in via
 * flags.aspectsofpower.aiProfile; aiSkillUuid overrides skill auto-pick;
 * aiDefense 'auto' (default for AI actors) | 'manual' controls the defense
 * auto-policy; aiDangerFt overrides the skirmisher kite bubble.
 */
ASPECTSOFPOWER.ai = {
  profiles: {
    primitive:  'Primitive (stationary)',
    brawler:    'Brawler (melee)',
    skirmisher: 'Skirmisher (ranged)',
    hexer:      'Hexer (debuff caster)',
  },
  // Per-NPC `flags.aspectsofpower.aiPathMode` — how the unit routes to its
  // destination. 'direct' charges straight (ignores AOE). 'smart' deviates the
  // heading to skirt harmful persistent-AOE regions (ai.mjs _declareStepToward).
  pathModes: {
    direct: 'Direct (charge straight)',
    smart:  'Smart (route around walls & area effects)',
  },
  defaultPathMode: 'direct',
  maxStepFt: 30,   // max movement per AI action
  dangerFt:  15,   // skirmisher kite bubble
  retreatHpPct: 0.25,  // self-preservation faculty: flee when HP fraction < this
  // Hostile NPCs at 0 HP auto-mark defeated (skull overlay, tracker strike)
  // without GM action (updateActor death hook). Player-owned actors exempt.
  autoDefeatHostiles: true,
};

/**
 * Movement / token-collision tuning. Footprints are axis-aligned boxes from each
 * token's width × height (handles 1x1, large, and rectangular tokens uniformly).
 * Shared by the no-stacking clamp + enemy-block (clampMoveNoOverlap) and the
 * equidistant bump (separateOverlappingTokens) in celerity.mjs.
 */
ASPECTSOFPOWER.movement = {
  // Per-side spacing gap in PIXELS beyond edge-touching. 0 = tokens may stand
  // edge-adjacent (touching). Raise for breathing room between bodies; the gap
  // applies on top of each token's own footprint, so it reads the same for big
  // and small tokens.
  tokenGapPx: 0,
  // Checkpoint spacing for declared movements, in GRID SQUARES. Checkpoints
  // are both the pause windows (a clock pause freezes each glide at its next
  // checkpoint) and the commit granularity (one update operation each) — so
  // smaller = crisper pauses + finer mid-flight collision checks, at the cost
  // of more update operations per walk.
  checkpointSpacingSquares: 2,
  // THREATENED movement (ruled 2026-08-09): each foot of a path inside a
  // living hostile's melee threat costs this multiple of celerity time.
  // Derived from the LIVE melee roster, not theory: at 3x, walking out of a
  // declared peer swing fails for every current front-liner (George's axe
  // winds up in ~1,365 ticks; even Gabriel at dex 819 needs ~1,465 to walk
  // clear of a reach-10 band) — disengaging an engaged melee demands a
  // SPRINT (3x stamina, all-out). Hit-and-run stays alive: Gabriel WALKS
  // out of a giant's ultraheavy windup (~2,500+ ticks) with room to spare.
  // At 2x, walking escapes were still free for most of the roster.
  threatenedMoveMult: 3,
};

/**
 * Modular AI BEHAVIOR tags — the composable "brain" of a creature, priced by
 * tier so a smarter conjuration (summon / ritual) costs more. Each behavior
 * sets AI flags on the creature and contributes `tier` points; the summed tier
 * (capped at the cost table length) selects a cost MULTIPLIER applied per
 * subsystem (summon → mana, ritual → power/prep) via resolveAiBehaviors()
 * (module/systems/ai.mjs). Same tags work on a GM-placed hostile (free); the
 * cost only bites when conjured. RULED 2026-06-21 (tier multiplier / unified
 * per-subsystem points / granular tags + presets) — see [[design-ai-behavior-tags]].
 *
 *   category 'brain'   — the movement/attack loop. Pick ONE (sets aiProfile).
 *   category 'faculty' — optional smartness add-ons. Stack freely.
 */
ASPECTSOFPOWER.aiBehaviors = {
  stationary:  { label: 'Stationary',     category: 'brain',   tier: 0, flags: { aiProfile: 'primitive' } },
  melee:       { label: 'Melee brain',    category: 'brain',   tier: 1, flags: { aiProfile: 'brawler' } },
  ranged:      { label: 'Ranged brain',   category: 'brain',   tier: 1, flags: { aiProfile: 'skirmisher' } },
  pathfind:    { label: 'Wall pathfinding', category: 'faculty', tier: 1, flags: { aiPathfind: true } },
  hazardAvoid: { label: 'Hazard avoidance', category: 'faculty', tier: 1, flags: { aiHazardAvoid: true } },
  smartTarget: { label: 'Smart targeting', category: 'faculty', tier: 1, flags: { aiSmartTarget: true } },
  autoDefense: { label: 'Self defense',   category: 'faculty', tier: 1, flags: { aiDefense: 'auto' } },
  focusWeakest:     { label: 'Focus weakest',     category: 'faculty', tier: 1, flags: { aiFocusWeakest: true } },
  selfPreservation: { label: 'Self-preservation', category: 'faculty', tier: 1, flags: { aiSelfPreserve: true } },
};

// tier → cost multiplier (index = summed behavior tier, clamped to last entry).
// Tier 0 mindless = baseline; tier 7 (melee + all 6 faculties) = ×4.3. Tunable.
ASPECTSOFPOWER.aiBrainTierCost = [1.0, 1.3, 1.6, 2.0, 2.5, 3.0, 3.6, 4.3];

// Convenience faculty bundles, applied ON TOP of a chosen brain. Expanded by
// resolveAiBehaviors(); a summon lists e.g. ['melee', 'tactical'].
ASPECTSOFPOWER.aiBehaviorPresets = {
  mindless: [],                                                            // brain only — locks nearest, charges
  trained:  ['smartTarget', 'autoDefense'],                                // picks reachable targets, defends
  tactical: ['pathfind', 'hazardAvoid', 'smartTarget', 'autoDefense'],     // full navigation + defense
  elite:    ['pathfind', 'hazardAvoid', 'smartTarget', 'autoDefense', 'focusWeakest', 'selfPreservation'], // everything
};

/**
 * Which ability mod is rolled to break each debuff type. Shared between the
 * auto-break loop (actor.onStartTurn) and the manual break-free flow
 * (actor-sheet → celerity declare → tracker dispatch).
 */
ASPECTSOFPOWER.debuffBreakStats = {
  root:       'strength',
  paralysis:  'vitality',
  fear:       'willpower',
  taunt:      'intelligence',
  charm:      'willpower',
  enraged:    'wisdom',
};

/**
 * Debuff types that represent a psychological state — exactly one instance
 * exists on a target at a time regardless of source. Re-applying any of
 * these (from any caster) refreshes the existing effect with max(existing,
 * new) values rather than creating a parallel one. "You are either charmed
 * or not"; two casters' charms collapse into the stronger.
 *
 * Physical debuffs (root, paralysis, hemorrhage, etc.) follow the per-skill
 * `stackable` flag instead: stackable → parallel effects with own durations,
 * non-stackable → same-source refresh-with-max.
 */
ASPECTSOFPOWER.singletonDebuffs = ['charm', 'fear', 'taunt', 'enraged'];

/**
 * Casting-speed Wis/Int weights by spell tier — bigger spells lean more
 * toward Wis ("mastery shows"). Wis-spec casters are markedly faster on
 * Major/Grand spells; Int-spec casters retain per-cast damage but pay in
 * cast time. casting_speed = Wis × wis + Int × int.
 */
ASPECTSOFPOWER.castingSpeedWeights = {
  basic:   { wis: 0.60, int: 0.40 },
  high:    { wis: 0.65, int: 0.35 },
  greater: { wis: 0.70, int: 0.30 },
  major:   { wis: 0.80, int: 0.20 },
  grand:   { wis: 0.90, int: 0.10 },
  '':      { wis: 0.60, int: 0.40 },  // fallback for untagged magic skills
};

/**
 * HEALING — the potency blend per mode (design-healer-system.md).
 *
 * THE CASTING RESOURCE IS THE MODE. No extra tag is needed, because each mode
 * already spends a different pool, and a skill that costs health simply IS
 * blood magic. All three are wisdom-led; wisdom already drives casting speed,
 * so a healer has one clear primary and the modes differ in their second stat.
 *
 *   mana    cleric   — 0.6 Wis + 0.4 Int
 *   health  vitality — 0.6 Vit + 0.4 Wis  (blood magic; own life is the cost)
 *   stamina aura     — 0.6 Wis + 0.4 Str  (chanter; sustained party support)
 *
 * This blend replaces INT as the potency term in the invest formula, so
 * healing goes through `strikeInvestDamage` exactly like every strike and
 * spell — tier (via windup), rarity and invest all apply. Before this, all 30
 * restoration skills in the world sat on the legacy branch: tier inert, rarity
 * ignored AND inverted (the two strongest heals in the game were `inferior`),
 * and heal size set by a hand-authored dice string.
 */
ASPECTSOFPOWER.healing = {
  blends: {
    mana:    { primary: 'wisdom',   pw: 0.6, secondary: 'intelligence', sw: 0.4 },
    health:  { primary: 'vitality', pw: 0.6, secondary: 'wisdom',       sw: 0.4 },
    stamina: { primary: 'wisdom',   pw: 0.6, secondary: 'strength',     sw: 0.4 },
  },
  // POTENCY COEFFICIENT — the single dial for "how big is a heal".
  //
  // RULED 2026-08-03: a BASIC heal should restore about a THIRD of an average
  // same-level health bar. Without this, healing inherited the damage economy's
  // raw scale and a basic heal was a full bar or more — every heal an undo
  // button rather than attrition management.
  //
  // Calibrated live: average PC health 670 → target 223. A common-rarity basic
  // heal, staff in hand (windup 2.7), typical healer blend 524:
  //   524 x 0.6 x 2.7 x 0.25 = 212
  // Measured across the four real healers, basic lands 197-355 (median 249,
  // 29-53% of a bar); high ~1.5x that, greater ~2.5x.
  //
  // ⚠ Retune this, not the blends — the blends define WHO heals well, this
  // defines how much healing is worth. They are separate questions.
  coefficient: 0.25,
  // Vitality mode: the caster may never drop below this fraction of max HP.
  // Their own health IS the cap — there is no separate ceiling stat.
  selfFloorFrac: 0.25,
  // Aura mode invest ceiling above base, as a fraction of Tough.mod (the
  // physical-resource parallel to the caster's Wis cap).
  staminaCapFactor: 0.15,
};

/**
 * Per-tier Wis-derived hard cap on spell invest above base mana:
 *   max_invest = baseMana + Wis_mod × spellMaxInvestAboveBase[tier]
 * Then clamped by the actor's mana pool. NO self-damage past this cap —
 * it's a hard ceiling. Bigger spells reward Wis with more invest headroom
 * (small spells already have low base; big spells can absorb more channel).
 */
ASPECTSOFPOWER.spellMaxInvestAboveBase = {
  basic:   0.05,
  high:    0.08,
  greater: 0.15,
  major:   0.25,
  grand:   0.40,
  '':      0.10,  // fallback
};

/**
 * Per-RL reference round length lookup (build-neutral, drives every
 * round-anchored mechanic). Computed from the primary-spec stat curve in
 * design-celerity.md. Treat as authoritative; helpers fall back to actor
 * mod if RL falls outside the table.
 */
/**
 * Weapon COMBINATIONS — what is actually in your hands, detected live from
 * equipped gear by systems/weapon-styles.mjs. Never stored, so swapping
 * weapons changes what you can do immediately with nothing to keep in sync.
 *
 * THREE AXES (ruled 2026-07-27; supersedes the two-axis model of `1dc3a67`,
 * where "style" meant the arrangement):
 *
 *   TYPE        — the weapon itself (greatsword, dagger, bow...). Proficiency
 *                 passives declare `tagConfig.profFor` and SCALE THE DAMAGE of
 *                 attacks made with that type (see `weaponProficiency` below).
 *   COMBINATION — how the hands are arranged. Detected, never owned.
 *                 `tagConfig.requiresStyle` names one of these keys.
 *   STYLE       — a Passive skill you OWN that governs a set of attacks, the
 *                 way a Ritualism passive governs a body of rituals. The style
 *                 is the key; the combination is the lock. Attacks name their
 *                 governor in `tagConfig.styleSkill`.
 *
 * Combinations are TYPE-AWARE where the type is the whole point: a greatsword
 * and a greataxe are both two-handed, but they are not the same fighting
 * discipline, so each gets its own key and a generic `two-handed` is kept for
 * skills that genuinely only care about handedness.
 *
 * `inPlay` is the live PC footprint measured 2026-07-27 — evidence for scope
 * decisions, not a guess. Note the generic melee counts EXCLUDE archers now;
 * the earlier `two-handed: 9` wrongly swept in bows, crossbows and staves.
 */
ASPECTSOFPOWER.weaponCombinations = {
  // Two-handed melee, discipline-specific.
  '2h-greatsword':       { label: 'Two-Handed Greatsword', hands: 2, kind: 'melee', types: ['greatsword'], inPlay: 1 },
  '2h-greataxe':         { label: 'Two-Handed Greataxe',   hands: 2, kind: 'melee', types: ['greataxe'],   inPlay: 1 },
  '2h-greathammer':      { label: 'Two-Handed Greathammer', hands: 2, kind: 'melee', types: ['greathammer'], inPlay: 1 },
  '2h-polearm':          { label: 'Two-Handed Polearm',    hands: 2, kind: 'melee', types: ['polearm', 'spear', 'quarterstaff'], inPlay: 0 },
  'two-handed':          { label: 'Two-Handed',            hands: 2, kind: 'melee', generic: true, inPlay: 1 },

  // Paired weapons, discipline-specific.
  'dual-dagger':         { label: 'Dual Daggers',   hands: 2, kind: 'melee', types: ['dagger'],   inPlay: 0 },
  'dual-sword':          { label: 'Dual Blades',    hands: 2, kind: 'melee', types: ['sword', 'rapier'], inPlay: 0 },
  'dual-gauntlet':       { label: 'Dual Gauntlets', hands: 2, kind: 'melee', types: ['gauntlet'], inPlay: 0 },
  'dual-shield':         { label: 'Dual Shields',   hands: 2, kind: 'melee', types: ['shield', 'greatshield', 'buckler'], inPlay: 0 },
  'dual-wield':          { label: 'Dual Wield',     hands: 2, kind: 'melee', generic: true, inPlay: 0 },

  // Mixed hands.
  'sword-and-board':     { label: 'Sword and Board',     hands: 2, kind: 'melee', inPlay: 2 },
  'blade-and-implement': { label: 'Blade and Implement', hands: 2, kind: 'melee', inPlay: 1 },

  // Single hand / nothing.
  'single-weapon':       { label: 'Single Weapon', hands: 1, kind: 'melee', inPlay: 2 },
  'shield-alone':        { label: 'Shield Alone',  hands: 1, kind: 'melee', types: ['shield', 'greatshield', 'buckler'], inPlay: 0 },
  unarmed:               { label: 'Unarmed',       hands: 0, kind: 'melee', inPlay: 0 },

  // RANGED — its own axis. Bows and firearms are two-handed in the literal
  // sense but share nothing with a greatsword discipline; before 2026-07-27
  // they fell into the melee buckets and inflated every count there.
  archery:               { label: 'Archery',  hands: 2, kind: 'ranged', types: ['bow', 'shortbow', 'longbow', 'crossbow'], inPlay: 2 },
  marksman:              { label: 'Marksman', hands: 2, kind: 'ranged', types: ['pistol', 'rifle', 'shotgun'], inPlay: 0 },

  // Casters.
  'implement-only':      { label: 'Implement Only', hands: 1, kind: 'implement', types: ['wand', 'staff', 'orb', 'tome'], inPlay: 11 },
};

/** Back-compat alias: `requiresStyle` values resolve against the same table. */
ASPECTSOFPOWER.weaponStyles = ASPECTSOFPOWER.weaponCombinations;

/**
 * Weapon PROFICIENCY -> damage (ruled 2026-07-27: "attach damage of attacks
 * using weapons to weapon proficiency").
 *
 * The proficiency passive's own RARITY is the mastery ladder — the rarity
 * table already opens with not_proficient / neglected / rusty, which is
 * exactly this. Its multiplier is ANCHORED at common so that `trained` is
 * neutral and the ladder reads as intended:
 *
 *   profDamageMult = skillRarities[prof.rarity].mult / skillRarities[anchor].mult
 *
 *   not_proficient 0.33x · rusty 0.67x · common 1.00x · legendary 1.67x · divine 2.00x
 *
 * LACKING A PROFICIENCY COUNTS AS `untrainedRarity` (rusty, 0.67x) — ruled
 * 2026-07-29 — but ONLY for actors who own at least one proficiency passive.
 * A trained fighter picking up an unfamiliar weapon fumbles with it; a wolf is
 * not "unproficient with its own teeth".
 *
 * That scoping is load-bearing. Applied literally the penalty hit 205 of 211
 * actors for -33%, because 186 resolve through the `unarmed` fallback — every
 * beast and construct whose natural weapons carry no type tag. Keying on
 * ownership makes it self-scoping: grant a creature proficiencies and it opts
 * in, and the bestiary stays untouched until someone decides otherwise.
 *
 * Spells are unaffected regardless: only weapon-flavoured roll types are
 * proficiency-scaled, and magic uses its own.
 */
/**
 * RIDERS — skills that fire off your OWN attacks rather than being spent as an
 * action (design: "Hemorrhage can trigger on any physical attack Gabriel makes").
 *
 * Rate-limited by RESOURCE COST, not by cooldowns or stack caps (RULED
 * 2026-07-30): nothing in this system has a cooldown yet, and a stack cap is a
 * video-game abstraction with no in-world meaning. Bleeding someone costs
 * effort, so the rider charges stamina scaled to the blow that caused it.
 *
 * Cost is a fraction of the PARENT'S DAMAGE, not its hit total. Hit is
 * near-constant across a character's kit (rarity multiplies damage, not
 * accuracy), so a hit-based cost is a flat fee that makes bread-and-butter
 * skills the WORST rider vehicles and the high-rarity burst the best — exactly
 * backwards. Damage-based keeps stamina-per-bleed-point uniform across the kit
 * and stops it taxing accuracy builds (archers have the highest hit totals in
 * the game and would otherwise pay most for the same effect).
 *
 * On 0.20: DoT ticks bypass armour and face only DR, so the cost is really
 * buying ACCESS to armoured targets, not damage — a direct light-weapon hit is
 * ~119 damage/stamina where it lands and ZERO against 11 of 14 party members,
 * while a bleed is ~1 damage/stamina but non-zero against those same 11.
 * Because stacks pool before DR is charged once, the coefficient decides WHICH
 * targets are bleedable at all: at 0.20 a rogue reaches roughly DR 170, and
 * the heaviest tank (DR 256, needing 9 stacks = 540 stamina against a 400 pool)
 * stays out of reach — consistent with hard matchups existing on level.
 */
ASPECTSOFPOWER.riders = {
  // Stamina charged per rider proc = frac × the parent attack's damage.
  procCostDamageFrac: 0.20,
  // Trigger key riders subscribe to. Attacker-side counterpart to the
  // defender-side reactionTrigger vocabulary (self_attacked, self_struck…).
  procTriggerPierced: 'self_attack_pierced',
  // How far past the base cost an `invest`-tagged rider may be pushed, as a
  // multiple of that base. The proc cost was a flat toll with a yes/no prompt;
  // invest-tagging turns it into a lever — how hard you wrench the wound open —
  // and this bounds it. 3.0 keeps a full three-stack crush affordable on the
  // heaviest hitter (George: base 68, ceiling 204, pool 225) so the ceiling
  // binds on the STAMINA POOL rather than on an arbitrary cap, which is where
  // the interesting decision lives. Magnitude scales LINEARLY with the invest
  // (dotInvestScale / crushInvestScale), unlike the ^0.2 curve on swings and
  // casts: a rider has no windup and no cast time, so the pool is the only
  // thing paying for it, and a flat curve would make the lever inert.
  maxInvestMult: 3.0,
};

ASPECTSOFPOWER.weaponProficiency = {
  enabled: true,
  anchor: 'common',
  // What an untrained-but-tracked actor is treated as. Set to 'common' to
  // restore the old absence-is-neutral behaviour for tracked actors too.
  untrainedRarity: 'rusty',
  // Applies to weapon-flavoured roll types only; spells are not proficiency-scaled.
  // `phys_melee` was dropped 2026-07-30: melee already implies physical, so
  // str_weapon/dex_weapon cover it and magic_melee covers the magical side. It
  // had no branch in _buildRollFormulas (fell to the generic else, which sets
  // hitFormula = null — no to-hit roll at all) and is absent from
  // ASPECTSOFPOWER.rollTypes, so it could not even be authored. This list was
  // the last live reference. World content migrated in the same change.
  rollTypes: ['str_weapon', 'dex_weapon', 'phys_ranged', 'weapon'],
  // TO-HIT ladder step (RULED 2026-07-30: "multiply makes the most sense.
  // reduce it down to a 10% difference between each rank"). DELIBERATELY
  // compressed vs the ~16.7% damage step: the d20 band is only a 1.188x span,
  // so the full ratio flips the marquee dodge fight from 99% dodged to a coin
  // flip in ONE tier (sim: migration/proficiency_tohit_sim.js). At 0.10 the
  // same fight walks 99% -> 77% -> 34% across tiers instead. Set 0 to disable
  // the hit half entirely.
  hitPerTier: 0.10,
};

/**
 * Affinity usage-gating (design-affinity-dictionary.md, RULED design-first
 * 2026-07-03; engine shipped 2026-07-26).
 *
 * "Someone with fire affinity cannot use ice affinity items unless they also
 * have ice affinity, which would be rare for a fire person."
 *
 * LOOSENED 2026-07-26: opposition-only. Anyone may wear anything UNLESS they
 * hold a diametrically opposed affinity — lacking an affinity is no barrier.
 * That is what makes it safe to run live: an actor with no roster can never be
 * blocked, so the 105-equipped-item cliff of the strict reading disappears and
 * the rule only bites once affinities are actually granted.
 * Dry-run any time with `game.aspectsofpower.affinity.auditGating()`.
 */
ASPECTSOFPOWER.affinityGating = {
  enabled: true,
  // `air-affinity` is on 26 live items but the dictionary calls it `wind`, and
  // `air-affinity` is not even in the tag registry. Aliasing resolves them
  // rather than leaving 26 items attuned to nothing. (Fix the data too — this
  // is a safety net, not the cure.)
  tagAliases: { air: 'wind' },
};

/**
 * Celestial mechanics (design-calendar-celestial.md, 2026-07-26).
 *
 * The world is our planet, so it runs Foundry's Simplified Gregorian calendar
 * (CONFIG.time.worldCalendarConfig) — months, weekdays, seasons and leap years
 * all come from core. What core does NOT model is the sky, and the sky is
 * mechanical here: the Astral Aetherologist's eight lunar-phase rituals are
 * authored and live in world.skills, waiting on something to tell them which
 * phase it is.
 *
 * `phases` MUST stay byte-identical to those ritual names — they are the join
 * key between the sky and the content.
 */
ASPECTSOFPOWER.celestial = {
  // ── THE ANCHOR ──
  // World time 0 IS a real instant: 2000-01-01 00:00 UTC, JD 2451544.5.
  // Everything below is real ephemeris measured from it, so the moon phase on
  // a world date is the TRUE phase for that real date. Move this one number to
  // re-anchor the campaign; no coefficient changes.
  //
  // MIDNIGHT, not J2000 noon, so that core's calendar (which starts its own
  // year 0 at worldTime 0, midnight) agrees with real months and days
  // date-for-date. Verified live: with the leap patch below, every probe date
  // from 2000-01-01 through 2024-12-04 lands on the correct month/day/time,
  // including 2024-02-29.
  julianDayAtWorldZero: 2451544.5,
  // Core prints the year as the count from ITS year zero, so a real year needs
  // this added back. Our own date formatting derives the true civil date from
  // the Julian day and does not depend on core's year label at all.
  yearAtWorldZero: 2000,

  // ── LUNAR (Meeus, Astronomical Algorithms ch.47 mean elements) ──
  // Mean elongation D: 0 deg = new moon, 180 = full. Rate cross-checks against
  // the synodic month: 36525 / (445267.1114034/360) = 29.5306 d.
  moonElongation: { atEpoch: 297.8501921, degPerCentury: 445267.1114034 },
  // Argument of latitude F: angular distance from the ASCENDING NODE. 0 or 180
  // means the moon is on the ecliptic, which is the other half of an eclipse.
  // Cross-checks against the draconic month: 36525 / (483202.0175233/360)
  // = 27.2122 d. Its slight lag behind the sidereal month IS node regression
  // (a full lap in 18.6 y), so eclipse seasons drift ~19 days earlier a year
  // for free.
  moonArgLatitude: { atEpoch: 93.2720950, degPerCentury: 483202.0175233 },
  // Derived cycle lengths, kept for display and for the golden tests.
  lunarCycleDays: 29.530588853,
  draconicMonthDays: 27.212220817,

  // ── ECLIPSE LIMITS (real ecliptic limits, in DEGREES from the node) ──
  // An eclipse needs a syzygy AND proximity to a node. Testing DEGREES rather
  // than a fudged day-tolerance is what makes the cadence come out right
  // (~4-7 a year, clustered into seasons) instead of firing every fortnight.
  eclipseLimits: { solarPartial: 18.4, solarTotal: 11.8, lunarPartial: 12.2, lunarTotal: 5.9 },

  // The eight phases, in cycle order. MUST stay byte-identical to the eight
  // lunar rituals authored in world.skills — that string is the join key.
  phases: [
    'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
  ],

  // Lunar ritual empowerment (RULED 2026-07-29: empowered in phase, weakened
  // out of it — the hard "only in your phase" gate was declined).
  //
  //   mult = 1 + lunarAmplitude x cos(delta)
  //
  // where delta is the real angle between the ritual's own phase centre (index
  // x 45 degrees: new moon 0, full moon 180) and the moon's current elongation.
  // Deriving it from the actual angle rather than a step table buys three
  // things for free: neighbouring phases are MILDLY empowered, the multiplier
  // moves continuously as the moon does instead of jumping when a phase name
  // ticks over, and the trough always lands on the true opposite phase.
  //
  // At 0.40 a ritual cast under its own moon is x1.40 and under the opposite
  // moon x0.60 — a 2.33x spread, so waiting for your phase is a real decision
  // (worst-case wait is half a synodic month, about 14.8 days). Set to 0 to
  // disable. Which phase a skill belongs to is resolved from its NAME against
  // the `phases` list above, so the byte-identical naming is load-bearing;
  // `tagConfig.lunarPhase` overrides it for content named something else.
  lunarAmplitude: 0.40,
  // A skill must carry this tag to be phase-scaled at all, so a non-lunar skill
  // that happens to share a name is never caught by accident.
  lunarRequiresTag: 'lunar',

  // Astronomical quarter days. Core's seasons are MONTH-banded (Spring =
  // months 3-5), which is fine for a label but wrong for a solstice ritual,
  // so the real dates live here.
  quarterDays: {
    'Spring Equinox': { month: 3, day: 20 },
    'Summer Solstice': { month: 6, day: 21 },
    'Autumn Equinox': { month: 9, day: 22 },
    'Winter Solstice': { month: 12, day: 21 },
  },

  // ── METEOR SHOWERS (IMO calendar: activity window, peak, ZHR) ──
  // Annual and calendar-fixed, so a table is the honest model — no orbital
  // mechanics needed for the date, only for the parent comet.
  meteorShowers: [
    { name: 'Quadrantids',   start: { month: 12, day: 28 }, peak: { month: 1, day: 3 },   end: { month: 1, day: 12 },  zhr: 120, parent: null },
    { name: 'Lyrids',        start: { month: 4, day: 14 },  peak: { month: 4, day: 22 },  end: { month: 4, day: 30 },  zhr: 18,  parent: null },
    { name: 'Eta Aquariids', start: { month: 4, day: 19 },  peak: { month: 5, day: 5 },   end: { month: 5, day: 28 },  zhr: 50,  parent: '1P/Halley' },
    { name: 'Delta Aquariids', start: { month: 7, day: 12 }, peak: { month: 7, day: 30 }, end: { month: 8, day: 23 },  zhr: 25,  parent: null },
    { name: 'Perseids',      start: { month: 7, day: 17 },  peak: { month: 8, day: 12 },  end: { month: 8, day: 24 },  zhr: 100, parent: '109P/Swift-Tuttle' },
    { name: 'Orionids',      start: { month: 10, day: 2 },  peak: { month: 10, day: 21 }, end: { month: 11, day: 7 },  zhr: 20,  parent: '1P/Halley' },
    { name: 'Southern Taurids', start: { month: 9, day: 20 }, peak: { month: 11, day: 4 }, end: { month: 11, day: 20 }, zhr: 5,  parent: '2P/Encke' },
    { name: 'Northern Taurids', start: { month: 10, day: 20 }, peak: { month: 11, day: 11 }, end: { month: 12, day: 10 }, zhr: 5, parent: '2P/Encke' },
    { name: 'Leonids',       start: { month: 11, day: 6 },  peak: { month: 11, day: 16 }, end: { month: 11, day: 30 }, zhr: 15,  parent: '55P/Tempel-Tuttle' },
    { name: 'Geminids',      start: { month: 12, day: 4 },  peak: { month: 12, day: 13 }, end: { month: 12, day: 17 }, zhr: 150, parent: null },
    { name: 'Ursids',        start: { month: 12, day: 17 }, peak: { month: 12, day: 21 }, end: { month: 12, day: 26 }, zhr: 10,  parent: null },
  ],

  // ── PLANETS (JPL/DE200 mean elements at J2000, ecliptic of J2000) ──
  // a in AU, angles in degrees. Sidereal period is DERIVED from a by Kepler's
  // third law (P years = a^1.5) rather than listed, so the table cannot drift
  // out of internal agreement with itself.
  planets: {
    Mercury: { a: 0.38709893, e: 0.20563069, L: 252.25084, peri: 77.45645,  node: 48.33167,  inc: 7.00487 },
    Venus:   { a: 0.72333199, e: 0.00677323, L: 181.97973, peri: 131.53298, node: 76.68069,  inc: 3.39471 },
    Earth:   { a: 1.00000011, e: 0.01671022, L: 100.46435, peri: 102.94719, node: -11.26064, inc: 0.00005 },
    Mars:    { a: 1.52366231, e: 0.09341233, L: 355.45332, peri: 336.04084, node: 49.57854,  inc: 1.85061 },
    Jupiter: { a: 5.20336301, e: 0.04839266, L: 34.40438,  peri: 14.75385,  node: 100.55615, inc: 1.30530 },
    Saturn:  { a: 9.53707032, e: 0.05415060, L: 49.94432,  peri: 92.43194,  node: 113.71504, inc: 2.48446 },
    Uranus:  { a: 19.19126393, e: 0.04716771, L: 313.23218, peri: 170.96424, node: 74.22988, inc: 0.76986 },
    Neptune: { a: 30.06896348, e: 0.00858587, L: 304.88003, peri: 44.97135,  node: 131.72169, inc: 1.76917 },
  },

  // Tropical zodiac: twelve 30-degree segments of ecliptic longitude starting
  // at the vernal equinox. This is what "Mars retrograde in Scorpio" reads off.
  zodiac: [
    'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
  ],

  // ── COMETS (known perihelion passage + period) ──
  // A returning comet is a generational event; these are the famous ones with
  // well-determined returns. perihelionJD is a real Julian day.
  comets: [
    { name: '1P/Halley',          periodYears: 74.7,   perihelionJD: 2473682.5, note: 'next perihelion 2061; parent of the Eta Aquariids and Orionids' },
    { name: '2P/Encke',           periodYears: 3.3,    perihelionJD: 2461406.5, note: 'shortest known period; parent of the Taurids' },
    { name: '55P/Tempel-Tuttle',  periodYears: 33.318, perihelionJD: 2463014.5, note: 'next perihelion 2031-05-20; Leonid storms follow it' },
    { name: '109P/Swift-Tuttle',  periodYears: 133.28, perihelionJD: 2497709.5, note: 'next perihelion 2126-07-12; parent of the Perseids' },
  ],
};

/**
 * Non-combat activity registry (design-celerity-realtime.md step 4).
 *
 *   time = cost x qualityMult / Celerity(named stat)
 *
 * `cost` is in the SAME action-point unit as celerity weight — a sword swing
 * is BASELINE_WEIGHT (100). So a leveled character forces a stuck door in the
 * time a mundane one takes to blink, which is the whole point of the
 * re-denomination: superhuman is visible out of combat too.
 *
 * Three task classes (RULED 2026-07-02, option 1 + caveat):
 *   celerity — pure stat race (lockpicking, searching, forcing doors)
 *   clock    — same wall time for everyone (glue curing, a cart's journey)
 *   hybrid   — max() of both (precision work with mandatory cooling stages)
 *
 * `stat` names the ability that drives it. A null stat means "use the skill
 * being performed" — crafting rides its profession's ability.
 *
 * `qualityScaled: true` opts an activity into activityQuality below. Only
 * things with a QUALITY OF OUTPUT qualify — you can forge a sword roughly or
 * masterfully, but a lock is picked or it isn't, and "masterwork door-forcing"
 * is a category error (it read as 2 hours to open a door before this flag
 * existed). Non-scaled activities ignore the multiplier and the clock floor.
 *
 * Costs are the ruled exemplars; author more per activity as they come up.
 * Verify any new cost against the mundane baseline (G1, ref mod 36) — if a
 * G1 human takes an unreasonable time, the cost is wrong.
 */
ASPECTSOFPOWER.activities = {
  drawWeapon:  { label: 'Draw a weapon',        cost: 30,      stat: 'dexterity',    class: 'celerity' },
  forceDoor:   { label: 'Force a stuck door',   cost: 500,     stat: 'strength',     class: 'celerity' },
  pickLock:    { label: 'Pick a simple lock',   cost: 2000,    stat: 'dexterity',    class: 'celerity' },
  disarmTrap:  { label: 'Disarm a trap',        cost: 4000,    stat: 'dexterity',    class: 'celerity' },
  searchRoom:  { label: 'Search a room',        cost: 30000,   stat: 'perception',   class: 'celerity' },
  research:    { label: 'Research a topic',     cost: 60000,   stat: 'intelligence', class: 'celerity' },
  forgeSword:  { label: 'Forge a sword',        cost: 360000,  stat: null,           class: 'celerity', qualityScaled: true },
  ritualPrep:  { label: 'Prepare a ritual',     cost: 120000,  stat: null,           class: 'celerity', qualityScaled: true },
  // Clock-bound: the world takes its own time regardless of who waits.
  cureGlue:    { label: 'Cure glue',            cost: 0, class: 'clock', clockSeconds: 3600 },
  travelMile:  { label: 'Travel a mile (cart)', cost: 0, class: 'clock', clockSeconds: 1200 },
  // MEDITATION (user ruled 2026-08-03): an hour of quiet restores a FRACTION
  // of max mana. Clock-bound on purpose — meditating faster because you are
  // dexterous makes no sense, and the whole point is that it costs an hour of
  // world time you could have spent travelling or crafting.
  // The fraction is read from the ACTOR (`system.meditation.fraction`), not
  // fixed here, so a passive can raise it — see meditation.baseFraction.
  // ⚠ TWO RESTORES, INDEPENDENTLY GATED. Each entry is skipped when its pool's
  // max is 0, so a mage (ki.max 0, no `ki` tag) gets only the mana line and a
  // monk gets both. Ki refills FULLY — `fraction: 1` — because ki is restored
  // by TIME, the one currency that cannot be farmed in place, and that is what
  // stops a monk banking ki on a training dummy between fights (ruled
  // 2026-08-05). An hour of meditation is a full ki bar.
  meditate:    { label: 'Meditate', cost: 0, class: 'clock', clockSeconds: 3600,
                 restore: [
                   // Mana reads the ACTOR's fraction so a passive (and the
                   // meditation aura) can raise it. 0.10 baseline.
                   { resource: 'mana',    fractionPath: 'meditation.fraction' },
                   // ⚠ KI IS A FRACTION, NOT A FULL REFILL (user ruled
                   // 2026-08-07). Ki is earned by piercing a guard; an hour of
                   // sitting still should not hand back a full pool, or every
                   // fight opens at maximum ki without any of it being earned.
                   // A quarter is ~4 hours from empty.
                   //
                   // ⚠ 0.25 IS ALSO THE PRACTICAL FLOOR. Restores round —
                   // `gain = round(max * frac)` — and ki pools are small
                   // integers (cap 10, typically 3-8). At 0.10 a pool of 4
                   // rounds to ZERO and the entry does nothing at all.
                   { resource: 'ki',      fraction: 0.25 },
                   // Stamina recovers on its own out of combat, so this is
                   // convenience rather than a new lever; kept fractional so
                   // meditation does not become the canonical stamina button.
                   { resource: 'stamina', fraction: 0.50 },
                 ] },
};

/**
 * MEDITATION — mana recovery outside combat.
 *
 * An hour of meditation restores `baseFraction` of max mana. This is the only
 * self-service mana refill in the game, which is what makes mana a genuinely
 * finite per-fight resource: you cannot top up mid-fight, only between them.
 *
 * ⚠ `baseFraction` MUST equal the `system.meditation.fraction` schema initial
 * on actor-character.mjs. The schema default is what an actor actually carries;
 * this is the documented baseline and the value migrations reset to.
 */
ASPECTSOFPOWER.meditation = {
  baseFraction: 0.10,
};

/**
 * STRAIN — max HP burned to buy a resource conversion past what the body
 * tolerates (user ruled 2026-08-03).
 *
 * THE PROBLEM IT SOLVES: stamina regenerates and mana does not, so any
 * stamina-to-mana conversion is an engine. In combat that engine is a trickle
 * (5%/round becomes ~4 mana/round at 5:1, against a median 3-round fight), but
 * OUT of combat stamina is effectively unlimited, which would delete mana as a
 * limiter entirely.
 *
 * Charging max HP fixes it because max HP is restored only by TIME. The
 * limiter stops being an amount and becomes a duration — the same currency
 * meditation already spends.
 *
 * ⚠ TUNE AGAINST MEDITATION, NOT IN ISOLATION. Meditation gives 10% of max
 * mana per hour for free, so conversion is only ever bought for SPEED. The
 * strain charged should cost roughly the meditation time it saves, or
 * converting is either pointless or strictly better than resting.
 *
 * ⚠ recoveryPerHour is INERT until there is a world-time tick to drive it —
 * deferred with the clock work. Until then strain must be cleared by hand.
 */
/**
 * HEALER'S SIGNATURE (design-healer-system.md) — the fraction of OFFENSIVE
 * damage a healer gives up.
 *
 * "The energies they channel are altered by their own signature, making them
 * less effective when used offensively." Mechanically this is the sacrifice
 * that pays for the healer kit: conversions, three healing modes, and the only
 * in-combat mana refill in the game.
 *
 * Driven by the `healer` ACTOR tag (user ruled 2026-08-03), so it can arrive
 * from a class, a profession, a race or a direct grant without the engine
 * caring which — and it applies ONCE regardless of how many of those say so,
 * because a tag is either present or it is not.
 *
 * ⚠ Applies to damage only. Healing, barriers and restoration are untouched —
 * a signature that dampened healing would be taxing the thing it pays for.
 */
ASPECTSOFPOWER.healerSignature = 0.25;

/**
 * Deployable items (design-deployable-items). A deployable is a rare item that
 * is PLACED rather than consumed — deploying spawns a stub actor and moves the
 * item onto it, so the deployed thing is identified by what it carries.
 */
ASPECTSOFPOWER.deployable = {
  // How far from the deployer a deployable may be placed, in feet. You set a
  // pylon down near yourself; you do not lob it across the battlefield.
  placeRangeFt: 30,
};

ASPECTSOFPOWER.strain = {
  // Hard floor: strain can never take more than this fraction of true max HP.
  maxFrac: 0.5,
  // Fraction of true max HP recovered per hour of world time.
  recoveryPerHour: 0.05,
  // Toughness divisor for conversion strain:
  //   strain = destinationGained / (Tough.mod x conversionDivisor)
  //
  // ANCHORED TO MEDITATION. Gaining 10% of max mana (one hour of meditating)
  // should cost ~5% strain (one hour of strain recovery), making conversion
  // time-NEUTRAL rather than free: you skip the hour, you owe the hour.
  // Solved across the live roster, 7 puts Harvey (mana 678, tough 201) at
  // 68 / (201 x 7) = 0.048 — break-even.
  //
  // ⚠ Toughness DIVIDES the strain rather than granting a free allowance. A
  // per-cast allowance is trivially split into many small casts, and cast time
  // does not plug that: channel wait is LINEAR in amount, so ten small
  // conversions cost the same time as one large one. Dividing means every
  // conversion costs something and toughness makes you better at it.
  conversionDivisor: 7,
};

/**
 * BARRIERS ARE CASTS, NOT HEALS (user ruled 2026-08-03).
 *
 * A barrier runs the attack-spell formula — INT potency, tier, grade, rarity,
 * windup, invest curve, and the same Wis-based invest cap — and produces
 * temporary HP instead of damage. It does NOT use the healing blends: the mode
 * system answers "what kind of healer are you", and a ward is not a heal.
 *
 * ⚠⚠ NO COEFFICIENT AND NO barrierMultiplier — TIER IS THE DIAL.
 *
 * Both were removed after measuring in the right unit. A barrier absorbs RAW
 * damage, and armour eats most of a raw hit, so "share of a health bar" wildly
 * overstates it — that framing said 80% of barrier/tier combinations were
 * broken. The honest unit is INCOMING HITS ABSORBED, and in that unit a basic
 * barrier lands at a median 0.95 hits across the combat-ready roster: exactly
 * one attack. Higher tiers buy 2-3 hits and so justify costing an action.
 *
 * So the tier ladder already separates the two jobs, with no extra knob:
 *   basic          reaction shields - eat the attack that triggered you
 *   high / greater action-cost wards - absorb 2-3 hits, worth a turn
 *
 * The multiplier went with it because RARITY is the identity lever every other
 * spell already uses. A per-skill x3 is a second, unbalanced power axis hiding
 * in one field — it is how Harvey's Guardian Ward was a x3 ward while reading
 * as `common`. Rarity spans 2.67x (inferior 0.45 to divine 1.2) against the
 * multiplier's 3x, so it can carry the same range honestly.
 *
 * ⚠ The invest CAP is what stops a runaway, not a coefficient — barriers
 * inherit `spellMaxInvestAboveBase`, holding max legal commit to 26-105 mana
 * against the whole pool the old bespoke prompt allowed.
 *
 * ⚠ ACCEPTED (user, 2026-08-03): the premier mage gets the stronger shield.
 * Willy's mana pool buys the largest invest cap, so his basic reaction shield
 * absorbs ~2.16 hits against Gabriel's 0.73. That spread is the caster stats
 * doing their job, not a bug.
 *
 * `tagConfig.barrierMultiplier` still exists in the schema and still drives the
 * LEGACY (untiered) path, which stays `investedMana x multiplier` until a
 * barrier's content is authored with a tier.
 */
ASPECTSOFPOWER.barrier = {
  // Potency blend. Pure INT made the warders 2.48x worse at warding than the
  // artillery casters; 50/50 puts them at 1.03x. See barrierStatBlend.
  blend: { primary: 'intelligence', secondary: 'wisdom', pw: 0.5, sw: 0.5 },
};

/**
 * AURAS (design-healer-system.md — the chanter's range envelope).
 *
 * Radius = authored radius x (1 + Per.mod / perceptionDivisor). See
 * `auraRadiusFor` in helpers/formulas.mjs for why this is multiplicative on
 * the authored base rather than the memo's flat `Per_mod x range_factor`.
 *
 * ⚠ 1000 IS THE KNOB THAT KEEPS AURAS A POSITIONING DECISION. Measured against
 * real party spacing 2026-08-03 (median ally pair 9-35 ft on combat maps), it
 * puts a 20 ft aura at 20 ft for a novice and 41 ft for the highest-perception
 * character in the world — always covering the huddle, never the battlefield.
 * Dropping it toward 100 makes auras map-wide for the current main cast.
 */
/**
 * STACKS — stat-derived caps (ki monk, ruled 2026-08-05).
 * Stacks are COUNTED OBJECTS, not a resource bar, so an ability mod in the
 * hundreds has to become a ceiling in the single digits. statCapDivisor does
 * that; statCapMax stops a colossal endurance build carrying a silly bar.
 */
/**
 * KI — the monk resource (ruled 2026-08-05). A real POOL, not stacks: ki
 * carries no per-cast payload, is spent at varying costs by many abilities,
 * and wants the existing cost/affordability/bar machinery. Granted by the `ki`
 * ACTOR TAG; without it ki.max derives to 0 and the resource never appears.
 *
 * max = clamp(round(endurance.mod / capDivisor), 0, capMax)
 * Deliberately a SMALL bar — ki funds big abilities, it is not a mana pool.
 *
 * ⚠⚠ capDivisor WAS 150, WHICH MADE THE POOL SMALLER THAN A SINGLE SPEND.
 * Measured 2026-08-06 across the 11 plausible monk bodies on the live roster:
 * at 150 the pools came out 1,3,1,2,3,2,1,2,2,1,1 — so with Rising Mist
 * costing 3 ki, only 2 of 11 could cast their own class heal AT ALL, and
 * those two only by emptying the bar. The class was mathematically unable to
 * use its own resource, and nothing reported it: an unaffordable cast just
 * quietly never happens.
 *
 * 60 gives pools of 2-8 (10 of 11 can afford a 3-ki heal, a strong-endurance
 * monk banks two casts), which keeps the bar small and readable while making
 * ki an actual currency rather than a locked door.
 */
ASPECTSOFPOWER.ki = {
  capDivisor: 60,
  capMax:     10,
};

ASPECTSOFPOWER.stacks = {
  statCapDivisor: 150,
  statCapMax:     10,
};

ASPECTSOFPOWER.auras = {
  perceptionDivisor: 1000,

  // ── TICK CADENCE (design-aura-ticks.md, user ruled 2026-08-04) ──
  // "Heals in fractions, unlike damage, is always fine. Maybe we split aura
  // resource effects into three ticks per reference round."
  //
  // RESOURCE auras (heal / stam) pay in thirds of the caster's reference
  // round. Throughput is unchanged — each tick is amount/N — so this is not a
  // buff. What it buys is SPATIAL FIDELITY: the celerity clock is a continuous
  // axis, so a target walking through an aura is credited for the thirds they
  // were actually inside instead of being judged by one all-or-nothing sample.
  //
  // ⚠ DAMAGE AURAS STAY AT ONE TICK PER ROUND. Flat armour and DR apply PER
  // HIT, so splitting damage three ways lets the full wall shave each third —
  // often to zero. The split is lossless for healing and lossy for damage.
  ticksPerReferenceRound: 3,
  // Backstop on catch-up work. An aura whose last payout is far behind (a
  // reloaded world, a long manual clock jump) would otherwise loop thousands
  // of times. Past this we pay the capped number and resync, and say so.
  maxCatchUpTicks: 12,
};

/**
 * BUFF CAPACITY (design-healer-system.md, healer pillar phase 6).
 *
 * One global budget for borrowed power: you can carry buffs worth `fraction`
 * of the sum of your own nine ability values. Past that, either the buff
 * truncates or you pay for the overflow in HP — the RECIPIENT chooses, via
 * `system.buffs.acceptOvercap`.
 *
 * ⚠ THE ARCHETYPE SPLIT COMES FROM THE HP POOL, NOT THE CAP. Measured on the
 * live roster, capacities are remarkably flat — Gabriel 641, Phil 601, John
 * 594, Willy 577 against Faye 326, Lincoln 359 — while HP spans 203 (Faye) to
 * 1388 (Phil). So the same overflow costs Faye a third of her life and Phil
 * a twentieth. That is the whole mechanic: tanks are buff anchors because they
 * can EAT the overcap, not because they are allowed more of it.
 *
 * ⚠ COUNTS ONLY EFFECTS EXPLICITLY STAMPED `effectType: 'buff'`. Inferring
 * "is this a buff" from the data is impossible — of the 87 live non-equipment
 * effects that change a stat, the untagged majority are titles, blessings,
 * untagged gear and debuffs. Counting those would leave every PC permanently
 * overcap from their own title before a healer casts anything.
 *
 * Sized against measured content 2026-08-03: Bloodrage (+99 str) costs 17% of
 * a cap and is untouched; Dreams of Light (+687 across three stats) is over the
 * cap of every PC in the game; Barkskin and Bark Brace each eat a full cap
 * alone. It binds on the outliers and leaves the tuned content alone.
 */
ASPECTSOFPOWER.buffCap = {
  // Capacity = fraction x sum of the nine ability values.
  fraction: 0.20,
  // Overcap price, in flat HP per stat point of overflow, on apply.
  overcapDamageRate: 0.20,
  // Which change keys cost budget. Abilities AND defence in ONE pool — see
  // buffCost() in helpers/formulas.mjs for why they share a budget.
  countedKeyPrefixes: ['system.abilities.', 'system.defense.'],
};

/**
 * RESOURCE CONVERSION (design-healer-system.md) — healer-only.
 *
 * Rates are SOURCE units per 1 DESTINATION unit, except where the memo marks a
 * conversion as efficient (vitality), where 1 source buys several destination.
 *
 * ⚠ VALUE FOLLOWS RENEWABILITY, measured 2026-08-03:
 *   stamina  regenerates 5% of max PER ROUND in combat, and out of combat is
 *            effectively unlimited → cheapest by far
 *   mana     NO regen in combat; 10% per HOUR of meditation → expensive
 *   vitality NO regen at all, and running out is death → most expensive, but
 *            the most COMPRESSIBLE: spending it buys the most, which is the
 *            blood-magic bargain. Bounded by the 25%-HP self-floor.
 */
ASPECTSOFPOWER.conversions = {
  stamina_mana:    { from: 'stamina', to: 'mana',    rate: 5,    label: 'Channel Vitality to Spirit' },
  stamina_health:  { from: 'stamina', to: 'health',  rate: 10,   label: 'Reinforce Flesh' },
  mana_stamina:    { from: 'mana',    to: 'stamina', rate: 0.5,  label: 'Mystic Second Wind' },
  mana_health:     { from: 'mana',    to: 'health',  rate: 5,    label: 'Mend Self' },
  health_mana:     { from: 'health',  to: 'mana',    rate: 0.2,  label: 'Blood Magic' },
  health_stamina:  { from: 'health',  to: 'stamina', rate: 0.1,  label: 'Tap Life Force' },
};

/**
 * Quality-relative crafting multiplier (ruling 3 caveat, 2026-07-02):
 * "Smithing at your max potential should take time. Smithing something
 * slipshod that you don't care about should be extremely fast."
 *
 * q = target quality / the crafter's own ceiling, so this is RELATIVE — an
 * S-rank smith knocking out a rough sword pays 0.25x against an enormous
 * Celerity (seconds), while the same smith working at their ceiling pays 25x
 * AND cannot outrun the clock floor. Coefficients are a sketch pending the
 * craft-flow rework sim; the floors are what stop mastery collapsing to
 * instant.
 */
ASPECTSOFPOWER.activityQuality = {
  rough:      { label: 'Rough',      mult: 0.25, clockFloorSeconds: 0 },
  standard:   { label: 'Standard',   mult: 1,    clockFloorSeconds: 0 },
  fine:       { label: 'Fine',       mult: 4,    clockFloorSeconds: 600 },
  masterwork: { label: 'Masterwork', mult: 25,   clockFloorSeconds: 7200 },
};

ASPECTSOFPOWER.referenceRoundLength = {
  1:    83333,
  10:   20408,
  24:   10563,
  25:   9836,
  50:   4702,
  99:   2475,
  199:  907,
  299:  443,
  399:  245,
  499:  145,
  599:  87,
};

/**
 * Canonical weapon weights by weapon-type tag (per design-melee-system.md
 * and design-ranged-system.md). Weight is a TYPE descriptor, not a tier
 * descriptor — a legendary greatsword and a starter greatsword both weigh 200.
 * Identity at higher grades comes from granted skills, multipliers, and
 * augments — not from heavier weights.
 *
 * Lookup is by tag in `system.tags`. First matching tag wins.
 * Falls back to `system.weight` if no tag matches (designer escape hatch).
 */
/**
 * PHYSICAL WEIGHT — volume x density (design-item-weight.md, RULED 2026-07-30).
 *
 *   weight_lb = volume_L(slot) x density_kgPerL(material) / 0.45359237
 *
 * Two rulings shape this:
 *   1. "AOP armor is super thick and heavy." The volumes below are the volume
 *      of MATERIAL in the piece and run ~7x historical - a 6 L breastplate is
 *      47 kg where a real one is 5-9. That is deliberate, not a slip.
 *   2. "Materials get heavier as their mana density increases" - the inverse
 *      of the usual mithril trope. Density is a per-MATERIAL authored value,
 *      NOT derived from item rarity: a crude fulgurite helm and a masterwork
 *      one weigh the same, because craftsmanship shows up in armour value.
 *
 * ⚠ carryCapacity is in POUNDS (str.mod x 2.5). Densities here are kg/L, so
 * every comparison MUST convert. Comparing them directly understates loads by
 * 2.2x — it produced a false "nobody is near capacity, weights change nothing"
 * conclusion before it was caught.
 *
 * CALIBRATION ANCHOR: John was AT capacity when he first crafted his harness
 * and took leather boots rather than metal to stay under. At fulgurite =
 * silver he lands on that line at str ~205 (513 lb vs 555 with metal boots),
 * and reaches 66% of capacity at his current str 311. Gold density would have
 * required str 376 at crafting time — above his CURRENT strength — so the
 * story itself rules it out. See migration/armor_weight_calc.js.
 */
ASPECTSOFPOWER.slotVolume = {
  // Litres of material per piece (user baseline 2026-07-30).
  chest: 6, legs: 6, head: 2, boots: 2, bracers: 2, gloves: 2, back: 2,
  shield: 6,          // resolved from the shield/greatshield/buckler TAG, not a slot
};

/**
 * Density in kg per litre, keyed by `item.system.material` (the CLASS), with
 * `item.system.materialSpecies` overriding when a specific material is known.
 *
 * ⚠ `metal` defaults to FULGURITE (10.49, silver), because fulgurite is the
 * only metal that exists in the world right now — "Lightning Metal" IS
 * fulgurite, just named from a gathering source that has not been built yet.
 * When mundane steel is introduced it wants an explicit species key at 7.85,
 * and this default should drop back with it.
 */
ASPECTSOFPOWER.materialDensity = {
  metal: 10.49, leather: 0.95, cloth: 0.30, wood: 0.70,
  bone: 1.80, crystal: 2.60, gem: 4.00, jewelry: 10.49,
};

/**
 * Materials with NO volume model — the slot table does not describe them.
 * A circlet sits in the head slot but is ornament, not a helmet's worth of
 * metal; pricing it by slot volume made a mana diadem weigh 46 lb. Items in
 * these materials keep whatever weight was authored for them.
 */
ASPECTSOFPOWER.volumelessMaterials = ['jewelry'];

/**
 * SPATIAL STORAGE (design-spatial-storage.md, RULED 2026-07-30).
 *
 * Folded space: contents weigh nothing to the carrier.
 *
 * IT IS AN AUGMENT, COSTING TWO SLOTS. Nothing about a base craft folds space
 * - an item is an ordinary ring or amulet until a Spatial Storage augment is
 * slotted into it, and that augment eats two of the host's augment slots. So
 * spatial storage competes directly with stats, armour and damage for the same
 * scarce resource: a rare ring (3 slots) carrying one has a single slot left
 * for anything else. `slotCost` already existed on the augment schema and both
 * slotting paths honour it - this is its first real user.
 *
 * Capacity rides the augment's `scaleWithCrafter` magnifier, so it is the
 * JEWELLER'S skill that decides how much space folds - consistent with the
 * 2026-07-25 ruling that augment magnitude comes from the crafter.
 */
ASPECTSOFPOWER.spatialStorage = {
  // CRAFTED CAPACITY IS DIMINISHING (ruled 2026-08-10: "I don't want people
  // carrying infinite goodies in a ring").
  //
  //   capacity = floor(craftRoll ^ capacityExponent x rarityMagnifier x capacityScale)
  //
  // The rarity ladder only spans 16x (0.05 -> 0.8) but the stat curve spans
  // 100x+ across grades, so a LINEAR capacity would be decided by the
  // crafter's level, not their mastery, and would grow without limit. Under
  // the square root a 100x stat gap becomes roughly a 10x capacity gap:
  //
  //   Amina (int mod 314), divine craft   ->  ~297 lb
  //   C-grade crafter,     divine craft   -> ~1,380 lb
  //   S-grade crafter,     divine craft   -> ~3,100 lb
  //
  // capacityScale is solved so a divine craft at the CURRENT jeweller's power
  // lands at ~300 lb, the number the two hand-authored rings carry.
  // Exponent 0.5 matches invest.curveExponent — same shape, same reasoning.
  capacityExponent: 0.5,
  capacityScale: 20,
  // Retrieving from folded space costs an action. Expressed as a fraction of
  // the actor's own baseline action wait, so it scales with celerity like
  // every other timing in the system rather than being a flat tick count.
  retrieveWaitFraction: 1.0,
  // Slots the Spatial Storage augment consumes on its host.
  augmentSlotCost: 2,
};

/** Specific materials, overriding the class default where known. */
ASPECTSOFPOWER.materialSpeciesDensity = {
  fulgurite: 10.49,   // silver — the world's metal
  steel: 7.85, iron: 7.87, bronze: 8.80, silver: 10.49, gold: 19.30,
};

/**
 * Weapon volume comes from the existing weaponWeights table rather than a
 * second hand-authored list, so weapon mass can never drift from the weight
 * that already drives celerity and windup: volume_L = weaponWeight / divisor.
 * At 100 a dagger is 0.6 L and a greataxe 2.2 L, which in fulgurite is 14 lb
 * and 51 lb — heavy, consistent with the armour, and retunable with ONE number.
 */
ASPECTSOFPOWER.weaponVolumeDivisor = 100;

ASPECTSOFPOWER.weaponWeights = {
  // Melee
  unarmed:    40,
  dagger:     60,
  spear:      70,
  rapier:     70,
  sword:     100,
  axe:       120,
  hammer:    130,
  quarterstaff: 140,
  polearm:   180,
  greatsword: 200,
  greataxe:  220,
  // Greathammer sits at the top of the melee table. The one-handed pair sets
  // the spacing — hammer 130 is ten over axe 120 — so the two-handed pair
  // keeps it: greathammer 230 is ten over greataxe 220.
  greathammer: 230,
  // Defensive weapons. Shields were craftable (buckler/shield/greatshield are
  // all in craftItemTypes) but had NO weight, so they resolved to no weapon
  // type at all — Phil's greatshield read as untyped and could not be part of
  // any combination. Weights sit against their striking analogues: a buckler
  // punches about like a fist, a shield bash like an axe, a greatshield like a
  // polearm you shove rather than swing.
  buckler:    50,
  shield:    120,
  greatshield: 190,
  // Gauntlets — armoured fists. Heavier than bare hands, lighter than a
  // dagger, because the weight is the armour and not a blade.
  gauntlet:   50,
  // Ranged
  pistol:     50,
  shortbow:   70,
  bow:       130,
  crossbow:  150,
  shotgun:   180,
  longbow:   200,
  rifle:     240,
  // Magic implements — for the rare case someone melee-bonks with one.
  // Wand = fists (no real striking surface), staff = quarterstaff (2H stick).
  // For the primary use case (casting spells through the implement), this
  // weight is ignored — spell wait derives from spellTierWeights[tier].
  wand:       40,
  staff:     140,
};

/**
 * Weapon TYPE keys that stand in for a FAMILY when a skill gates on them.
 *
 * `requiresWeaponTag: 'shield'` means "a shield", not "the 120-weight one" —
 * without this, Shield Bash refused Phil's greatshield, which is the exact
 * object the skill is about. A key absent from this table is its own sole
 * member, so gates on specific types (greataxe, longbow) are unaffected.
 *
 * Only shields need this today: they are the one type key that doubles as a
 * category name. Add an entry when another does.
 */
ASPECTSOFPOWER.weaponTypeFamilies = {
  shield: ['shield', 'greatshield', 'buckler'],
};

/**
 * Default reach in feet by weapon type-tag. Drives item-derivation and the
 * skill-cast range gate. Greatsword/greataxe/polearm are giant weapons in
 * this system → 10ft. Spear is a 1H reach weapon → 10ft. Everything else is
 * standard 5ft melee. The "Thrust" ability (pending) extends reach by +5
 * temporarily on the wielder's next strike.
 */
ASPECTSOFPOWER.weaponReach = {
  unarmed:    5,
  dagger:     5,
  rapier:     5,
  sword:      5,
  axe:        5,
  hammer:     5,
  quarterstaff: 5,
  spear:     10,
  polearm:   10,
  greatsword: 10,
  greataxe:  10,
  // Magic implements: striking with one is a melee jab — 5ft.
  wand:       5,
  staff:      5,
};

/**
 * Skill categories — top-level grouping that determines available tags.
 */
ASPECTSOFPOWER.skillCategories = {
  combat:     'ASPECTSOFPOWER.SkillCategory.combat',
  profession: 'ASPECTSOFPOWER.SkillCategory.profession',
};

/**
 * Skill creation presets (2026-07-31). One click on the create-time picker
 * sets skill type, tags, roll config and family defaults, so authoring starts
 * from "a Strike" or "a Channel" instead of a blank 146-field model. `data` is
 * a partial update merged onto the fresh skill; tag side-effects that the
 * sheet's autocomplete would apply (aoe.enabled, tagConfig.channel, affinity
 * lists) must be included here EXPLICITLY because no autocomplete runs.
 * Values are starting points, not rulings — every one is editable after.
 */
ASPECTSOFPOWER.skillPresets = {
  blank: {
    label: 'Blank', group: 'General',
    hint: 'No defaults. The full sheet, from scratch.',
    data: null,
  },
  strike_str: {
    label: 'Strike (Strength)', group: 'Martial',
    hint: 'Melee weapon attack on the strength pillar.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['attack', 'melee', 'physical'],
      roll: { type: 'str_weapon', resource: 'stamina', targetDefense: 'melee', damageType: 'physical' } } },
  },
  strike_dex: {
    label: 'Strike (Finesse)', group: 'Martial',
    hint: 'Melee weapon attack on the dexterity pillar.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['attack', 'melee', 'physical'],
      roll: { type: 'dex_weapon', resource: 'stamina', targetDefense: 'melee', damageType: 'physical' } } },
  },
  shot: {
    label: 'Ranged Shot', group: 'Martial',
    hint: 'Physical ranged weapon attack (bow, gun, thrown).',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['attack', 'ranged', 'physical'],
      roll: { type: 'phys_ranged', resource: 'stamina', targetDefense: 'ranged', damageType: 'physical' } } },
  },
  rider: {
    label: 'Rider (procs off own attacks)', group: 'Martial',
    hint: 'Passive that fires when your attack pierces armor - Hemorrhage-style. Configure the debuff it applies.',
    data: { system: { skillType: 'Passive', skillCategory: 'combat', tags: ['debuff'],
      tagConfig: { procTrigger: 'self_attack_pierced', debuffDealsDamage: true, dotScale: 0.1, debuffDuration: 3 } } },
  },
  proficiency: {
    label: 'Weapon Proficiency', group: 'Martial',
    hint: 'The passive that IS your skill with a weapon type. Set Proficiency For, then its rarity is the mastery ladder.',
    data: { system: { skillType: 'Passive', skillCategory: 'combat', tags: [] } },
  },
  bolt: {
    label: 'Bolt (single target)', group: 'Magic',
    hint: 'Magic projectile against ranged defense.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['attack', 'magic', 'ranged'], requiresSight: true,
      roll: { type: 'magic_projectile', resource: 'mana', tier: 'basic', abilities: 'intelligence', targetDefense: 'ranged', damageType: 'magical' } } },
  },
  blast: {
    label: 'Blast (AOE)', group: 'Magic',
    hint: 'Area spell - circle template, everyone inside.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['attack', 'magic', 'aoe'], requiresSight: true,
      roll: { type: 'magic_projectile', resource: 'mana', tier: 'high', abilities: 'intelligence', targetDefense: 'ranged', damageType: 'magical' },
      aoe: { enabled: true, shape: 'circle', diameter: 20, targetingMode: 'all' } } },
  },
  channel: {
    label: 'Channel (sustained beam)', group: 'Magic',
    hint: 'Tick loop that ramps while sustained. Tag side-effect included.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['attack', 'magic', 'channel'], requiresSight: true,
      roll: { type: 'magic_projectile', resource: 'mana', tier: 'basic', abilities: 'intelligence', targetDefense: 'ranged', damageType: 'magical' },
      tagConfig: { channel: true } } },
  },
  summon: {
    label: 'Summon', group: 'Magic',
    hint: 'Conjure a creature. Pick its brain and faculties on the sheet.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['summon', 'magic'],
      roll: { resource: 'mana', tier: 'basic', abilities: 'intelligence' } } },
  },
  ritual: {
    label: 'Ritual', group: 'Magic',
    hint: 'Encoded into a medium out of combat, activated by consuming a charge.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['ritual', 'magic'], ritualGrade: 'E',
      roll: { resource: 'mana', abilities: 'wisdom' } } },
  },
  buff: {
    label: 'Buff', group: 'Support',
    hint: 'Timed stat multiplier on self or an ally.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['buff', 'magic'],
      roll: { resource: 'mana', tier: 'basic', abilities: 'willpower' },
      tagConfig: { buffTarget: 'selected', buffDuration: 3 } } },
  },
  heal: {
    label: 'Heal', group: 'Support',
    hint: 'Restore health to a target.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['restoration', 'magic'],
      roll: { resource: 'mana', tier: 'basic', abilities: 'wisdom' },
      tagConfig: { restorationTarget: 'selected', restorationResource: 'health' } } },
  },
  barrier: {
    label: 'Barrier', group: 'Support',
    hint: 'Mana becomes a damage-absorbing shell (HP = mana x multiplier).',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['restoration', 'magic'],
      roll: { resource: 'mana', tier: 'basic', abilities: 'willpower' },
      tagConfig: { restorationTarget: 'selected', restorationResource: 'barrier', barrierMultiplier: 1 } } },
  },
  dot: {
    label: 'Debuff / DoT', group: 'Support',
    hint: 'Attack that leaves a stat debuff or damage-over-time on the target.',
    data: { system: { skillType: 'Active', skillCategory: 'combat', tags: ['attack', 'debuff'],
      roll: { resource: 'mana', targetDefense: 'melee' },
      tagConfig: { debuffDealsDamage: true, dotScale: 0.1, debuffDuration: 3 } } },
  },
  reaction_dodge: {
    label: 'Reaction: Dodge', group: 'Reaction',
    hint: 'Evasive reaction when attacked, before damage.',
    data: { system: { skillType: 'Reaction', skillCategory: 'combat', reactionType: 'dodge',
      roll: { resource: 'stamina' },
      tagConfig: { reactionTrigger: 'self_attacked', reactionCooldown: 1 } } },
  },
  reaction_parry: {
    label: 'Reaction: Parry', group: 'Reaction',
    hint: 'Meet the blow with your weapon (mass rule applies).',
    data: { system: { skillType: 'Reaction', skillCategory: 'combat', reactionType: 'parry',
      roll: { resource: 'stamina' },
      tagConfig: { reactionTrigger: 'self_attacked', reactionCooldown: 1 } } },
  },
  guardian: {
    label: 'Reaction: Guardian', group: 'Reaction',
    hint: 'Protect an ally under attack - intercept, cover, or redirect.',
    data: { system: { skillType: 'Reaction', skillCategory: 'combat', reactionType: 'guardian',
      roll: { resource: 'stamina' },
      tagConfig: { reactionTrigger: 'ally_attacked', reactionTriggerRange: 15, reactionCooldown: 1, guardianMode: 'intercept' } } },
  },
  craft: {
    label: 'Craft', group: 'Profession',
    hint: 'Produce items. Pick allowed types on the sheet.',
    data: { system: { skillType: 'Active', skillCategory: 'profession', tags: ['craft'],
      roll: { resource: 'stamina' } } },
  },
  gather: {
    label: 'Gather', group: 'Profession',
    hint: 'Pull materials from the world.',
    data: { system: { skillType: 'Active', skillCategory: 'profession', tags: ['gather'],
      roll: { resource: 'stamina' } } },
  },
};

/**
 * Tags available per skill category. combatTags and professionTags are THE
 * authoritative skill-tag registries — the sheet autocomplete reads them by
 * skillCategory. (A third parallel registry, skillTags, drifted for months
 * with zero readers and was deleted 2026-07-31.)
 */
ASPECTSOFPOWER.combatTags = {
  // Section-driving.
  attack:      'ASPECTSOFPOWER.Tag.attack',
  // ACTIVITY (ruled 2026-08-07): firing this skill DECLARES a downtime
  // activity on the clock instead of resolving as a combat action. The skill
  // names which one in `tagConfig.activityKey`. That is what turns Meditation
  // from a button that grants mana into an hour that has to be spent.
  //
  // ⚠ Nothing is restored at declaration time. The activity framework applies
  // its `restore` block when the CLOCK reaches the end of the block, which is
  // the entire point of the downtime barrier: you commit the hour first.
  activity:    'ASPECTSOFPOWER.Tag.activity',
  // HASTE (ruled 2026-08-07): an aura that makes OTHER PEOPLE'S activities
  // faster — Gabriel's Call to Arms. Distinct from `activity` because the
  // hastening skill is NOT itself an activity: Call to Arms is a buff, and
  // without its own tag its config had no section to live in on the sheet.
  haste:       'ASPECTSOFPOWER.Tag.haste',
  restoration: 'ASPECTSOFPOWER.Tag.restoration',
  buff:        'ASPECTSOFPOWER.Tag.buff',
  debuff:      'ASPECTSOFPOWER.Tag.debuff',
  // MARK is its own section-driving tag (user ruled 2026-08-06: "Mark should
  // likely be a tag of its own"). It used to be reachable ONLY as a field on a
  // debuff — `markBonus` is read inside `_handleDebuffTag` — so marking
  // required being a debuff. Mathilda's Blood Bolt was the proof: it carried
  // `debuff` with no debuff content at all, purely to deliver a mark.
  mark:        'ASPECTSOFPOWER.Tag.mark',
  cleanse:     'ASPECTSOFPOWER.Tag.cleanse',
  aoe:         'ASPECTSOFPOWER.Tag.aoe',
  sustain:     'ASPECTSOFPOWER.Tag.sustain',
  shrapnel:    'ASPECTSOFPOWER.Tag.shrapnel',
  invest:      'ASPECTSOFPOWER.Tag.invest',
  unity:       'ASPECTSOFPOWER.Tag.unity',
  // Triggers.
  on_death:    'ASPECTSOFPOWER.Tag.on_death',
  // Chain conditional.
  requires_armor_pierce: 'ASPECTSOFPOWER.Tag.requires_armor_pierce',
  // Mine-pair (summon places, generic Detonate consumes any).
  mine:        'ASPECTSOFPOWER.Tag.mine',
  detonate:    'ASPECTSOFPOWER.Tag.detonate',
  // Summon (conjured creature) and channel (sustained tick loop) each gate a
  // whole config section on the skill sheet, but were never in a registry the
  // autocomplete reads — the sections were reachable only by console-injecting
  // the tag. Added 2026-07-31.
  summon:      'ASPECTSOFPOWER.Tag.summon',
  channel:     'ASPECTSOFPOWER.Tag.channel',
  // Stacks: a self-held charge pool on the CASTER (systems/stacks.mjs).
  // Produce N with one skill, spend 1..N with another. Marks are the same
  // shape but live on the TARGET, which is why this is its own subsystem.
  stacks:      'ASPECTSOFPOWER.Tag.stacks',
  // Braced: a parry reaction that may spend stamina to parry as if the weapon
  // were heavier (mass ratio only). Inert on anything that is not a parry.
  braced:      'ASPECTSOFPOWER.Tag.braced',
  // Movement-skill family (Stormstride, Charge, Leap, Teleport, Blink, etc.).
  // Marks any skill that affects or executes movement. Used for queryability
  // ("dispel all movement buffs"), Mobility-aura stacking, and the
  // movement-buff handler that applies system-field multipliers to effects.
  movement:    'ASPECTSOFPOWER.Tag.movement',
  // Teleport (instant relocation, ignores walls/terrain/engagement) and
  // Leap (arc movement, halts on engagement, walls below leapApexFt are
  // crossable). Per design-movement-skills.md Phase C.
  teleport:    'ASPECTSOFPOWER.Tag.teleport',
  leap:        'ASPECTSOFPOWER.Tag.leap',
  // Granted: skill is provided by the source (race/item/system primitive)
  // rather than learned/trained. Routes through computeActionWait's
  // build-neutral fixed-fraction path instead of the stat-driven formula.
  granted:     'ASPECTSOFPOWER.Tag.granted',
  // Ground-anchored AOEs (oil slicks, spike traps, vine fields) — only
  // affect targets on the ground. A leaping actor passing overhead
  // skips them. Volumetric AOEs (fireball, gas cloud) leave this OFF.
  ground:      'ASPECTSOFPOWER.Tag.ground',
  // Dash: while the actor has any non-disabled effect carrying this tag,
  // engagement halts skip — they're moving too fast to engage. Author by
  // tagging the buff skill (Stormstride) with `dash`; the spawned effect
  // inherits the tag via _handleBuffTag.
  dash:        'ASPECTSOFPOWER.Tag.dash',
  // Aura: skill produces an actor-centered sustained AOE effect.
  // (Distinct from the aura mechanic baked into buffs — this is a
  // queryable marker for skills whose primary form is an aura.)
  aura:        'ASPECTSOFPOWER.Tag.aura',
  // Social: skill primarily affects social/persuasion/intimidation
  // dynamics rather than direct combat math. Marker tag for the
  // future social mechanics subsystem.
  social:      'ASPECTSOFPOWER.Tag.social',
  // Retaliation: skill fires in response to being attacked. Marker
  // for the future reaction subsystem; currently a queryable category
  // (Shocking Retort, Retaliatory Strike, etc.).
  retaliation: 'ASPECTSOFPOWER.Tag.retaliation',
  // Ritual: skill that's encoded into a physical item out-of-combat
  // (gem, circle, inscription) and activated in-combat by consuming a
  // charge. Activation uses the granted skill timing (1/3 reference
  // round). See design-ritual-subsystem.md.
  ritual:      'ASPECTSOFPOWER.Tag.ritual',
  // Inscribe: profession-style action that takes a raw gem from inventory
  // and a ritual skill known to the caster, and produces a consumable
  // with effectType='ritual' encoding that skill. Mirrors craft/refine.
  inscribe:    'ASPECTSOFPOWER.Tag.inscribe',
  // Descriptors.
  magic:       'ASPECTSOFPOWER.Tag.magic',
  physical:    'ASPECTSOFPOWER.Tag.physical',
  vocal:       'ASPECTSOFPOWER.Tag.vocal',
  ranged:      'ASPECTSOFPOWER.Tag.ranged',
  melee:       'ASPECTSOFPOWER.Tag.melee',
  // Armor-answer (design-armor-answer-system).
  pierce:      'ASPECTSOFPOWER.Tag.pierce',
  shred:       'ASPECTSOFPOWER.Tag.shred',
  crush:       'ASPECTSOFPOWER.Tag.crush',
  // Concurrency (design-concurrent-actions).
  mobile:      'ASPECTSOFPOWER.Tag.mobile',
  // Resource riders — ONE TAG PER RESOURCE (multi-invest ruling; names chosen
  // 2026-08-10). Each marks a weapon strike that also spends a second pool for
  // an extra damage term:
  //   infused    = MANA      (type-2 fusion spellstrike; the shipped one)
  //   effort     = STAMINA
  //   life-drain = VITALITY / health
  // ⚠ Only `infused` has an ENGINE PATH today: _promptDualResourceInvest is
  // still welded to it and hardcodes one damage term per resource. `effort`
  // and `life-drain` are registered so the ruling is concrete and authorable,
  // but until the dialog is generalised they are INERT — do not author content
  // against them expecting a second slider. See pending-multi-invest.
  infused:     'ASPECTSOFPOWER.Tag.infused',
  effort:      'ASPECTSOFPOWER.Tag.effort',
  'life-drain': 'ASPECTSOFPOWER.Tag.lifeDrain',
  // Affinities.
  time:          'ASPECTSOFPOWER.Tag.time',
  karma:         'ASPECTSOFPOWER.Tag.karma',
  fire:          'ASPECTSOFPOWER.Tag.fire',
  heat:          'ASPECTSOFPOWER.Tag.heat',
  ice:           'ASPECTSOFPOWER.Tag.ice',
  lightning:     'ASPECTSOFPOWER.Tag.lightning',
  earth:         'ASPECTSOFPOWER.Tag.earth',
  water:         'ASPECTSOFPOWER.Tag.water',
  wind:          'ASPECTSOFPOWER.Tag.wind',
  metal:         'ASPECTSOFPOWER.Tag.metal',
  lunar:         'ASPECTSOFPOWER.Tag.lunar',
  solar:         'ASPECTSOFPOWER.Tag.solar',
  space:         'ASPECTSOFPOWER.Tag.space',
  shadow:        'ASPECTSOFPOWER.Tag.shadow',
  light:         'ASPECTSOFPOWER.Tag.light',
  nature:        'ASPECTSOFPOWER.Tag.nature',
  poison:        'ASPECTSOFPOWER.Tag.poison',
  blood:         'ASPECTSOFPOWER.Tag.blood',
  necromantic:   'ASPECTSOFPOWER.Tag.necromantic',
  holy:          'ASPECTSOFPOWER.Tag.holy',
  arcane:        'ASPECTSOFPOWER.Tag.arcane',
  psychic:       'ASPECTSOFPOWER.Tag.psychic',
  // Debuff subtypes.
  root:          'ASPECTSOFPOWER.Tag.root',
  immobilized:   'ASPECTSOFPOWER.Tag.immobilized',
  slow:          'ASPECTSOFPOWER.Tag.slow',
  chilled:       'ASPECTSOFPOWER.Tag.chilled',
  frozen:        'ASPECTSOFPOWER.Tag.frozen',
  sleep:         'ASPECTSOFPOWER.Tag.sleep',
  stun:          'ASPECTSOFPOWER.Tag.stun',
  paralysis:     'ASPECTSOFPOWER.Tag.paralysis',
  fear:          'ASPECTSOFPOWER.Tag.fear',
  blind:         'ASPECTSOFPOWER.Tag.blind',
  silence:       'ASPECTSOFPOWER.Tag.silence',
  weaken:        'ASPECTSOFPOWER.Tag.weaken',
  deafened:      'ASPECTSOFPOWER.Tag.deafened',
  taunt:         'ASPECTSOFPOWER.Tag.taunt',
  charm:         'ASPECTSOFPOWER.Tag.charm',
  enraged:       'ASPECTSOFPOWER.Tag.enraged',
  hallucination: 'ASPECTSOFPOWER.Tag.hallucination',
  dismembered:   'ASPECTSOFPOWER.Tag.dismembered',
};

/**
 * Debuff subtype tags → auto-add 'debuff' parent and set debuff type.
 */
ASPECTSOFPOWER.debuffSubtypeTags = {
  root: 'root', immobilized: 'immobilized', slow: 'slow',
  chilled: 'chilled', frozen: 'frozen', sleep: 'sleep',
  stun: 'stun', paralysis: 'paralysis', fear: 'fear',
  blind: 'blind', silence: 'silence', weaken: 'weaken',
  deafened: 'deafened', taunt: 'taunt', charm: 'charm',
  enraged: 'enraged', hallucination: 'hallucination', dismembered: 'dismembered',
};

/**
 * Debuff BEHAVIOR tags (armor-answer system) — adding one to a skill auto-adds
 * the `debuff` parent (so it routes through _handleDebuffTag). Unlike the
 * subtype tags, these carry no debuffType; the mechanic is read straight off
 * the tag in _handleDebuffTag (single source of truth — no buried checkbox).
 *   shred → affinity DR-strip (affinity comes from the skill's own affinity tag)
 *   crush → armor + block reduction (physical/generic; magnitude from armorAnswer)
 */
ASPECTSOFPOWER.debuffBehaviorTags = {
  shred: 'shred',
  crush: 'crush',
};

/**
 * THE AFFINITY DICTIONARY (2026-07-03, design-affinity-dictionary.md).
 * One rich entry per mana affinity — the single source of truth. Both
 * `affinityTags` (the skill-affinity Set) and `craftElements` (crafting
 * material stats) are DERIVED from this below, so nothing drifts.
 *
 * Per-affinity fields:
 *   label          i18n key (ASPECTSOFPOWER.Affinity.<key>).
 *   materialStats  [stat1, stat2, stat3] — the ability trio a MATERIAL of this
 *                  affinity contributes to crafted gear (item-derivation splits
 *                  the stat budget base+1 / base / base-1 across the trio, so
 *                  ORDER matters — stat1 is the dominant material identity).
 *                  Feeds craftElements. Distribution levelled to a 6-8 band
 *                  across the 21 affinities (2026-07-03 redline); the 9
 *                  authored craftElements entries (fire/earth/water/wind/
 *                  lightning/ice/lunar/solar/space) are preserved verbatim.
 *   opposed        Affinity keys this one opposes (future: usage-gating
 *                  rarity, resist/counter logic, enemy-weakness authoring).
 *   lane           'elemental' → damage mitigated by armor+DR (the 2026-07-02
 *                  ruling: elemental NEVER hits veil); 'mental' → mind/soul
 *                  POTENCY via veil; 'hybrid' → case-by-case per skill.
 * (arcane removed 2026-07-03 per user — a specific narrative concept, not a
 *  craftable/character affinity. It survives only as a skill damage-type tag.)
 */
ASPECTSOFPOWER.affinities = {
  // ── Authored craftElements (preserved verbatim; 'air' key → 'wind') ──
  fire:        { label: 'ASPECTSOFPOWER.Affinity.fire',        materialStats: ['strength', 'vitality', 'dexterity'],       opposed: ['ice', 'water'],      lane: 'elemental' },
  earth:       { label: 'ASPECTSOFPOWER.Affinity.earth',       materialStats: ['strength', 'endurance', 'vitality'],       opposed: ['lightning', 'wind'], lane: 'elemental' },
  water:       { label: 'ASPECTSOFPOWER.Affinity.water',       materialStats: ['wisdom', 'willpower', 'endurance'],        opposed: ['fire'],              lane: 'elemental' },
  wind:        { label: 'ASPECTSOFPOWER.Affinity.wind',        materialStats: ['dexterity', 'endurance', 'perception'],    opposed: ['earth'],             lane: 'elemental' },
  lightning:   { label: 'ASPECTSOFPOWER.Affinity.lightning',   materialStats: ['dexterity', 'perception', 'vitality'],     opposed: ['earth'],             lane: 'elemental' },
  ice:         { label: 'ASPECTSOFPOWER.Affinity.ice',         materialStats: ['intelligence', 'perception', 'toughness'], opposed: ['fire', 'heat'],      lane: 'elemental' },
  lunar:       { label: 'ASPECTSOFPOWER.Affinity.lunar',       materialStats: ['intelligence', 'willpower', 'wisdom'],     opposed: ['solar'],             lane: 'elemental' },
  solar:       { label: 'ASPECTSOFPOWER.Affinity.solar',       materialStats: ['vitality', 'perception', 'endurance'],     opposed: ['lunar'],             lane: 'elemental' },
  space:       { label: 'ASPECTSOFPOWER.Affinity.space',       materialStats: ['perception', 'willpower', 'endurance'],    opposed: [],                    lane: 'elemental' },
  // ── New affinities (2026-07-03; trios tuned for the 6-8 distribution) ──
  metal:       { label: 'ASPECTSOFPOWER.Affinity.metal',       materialStats: ['toughness', 'strength', 'endurance'],      opposed: [],                    lane: 'elemental' },
  heat:        { label: 'ASPECTSOFPOWER.Affinity.heat',        materialStats: ['strength', 'endurance', 'vitality'],       opposed: ['ice'],               lane: 'elemental' },
  blood:       { label: 'ASPECTSOFPOWER.Affinity.blood',       materialStats: ['vitality', 'strength', 'toughness'],       opposed: ['holy'],              lane: 'elemental' },
  shadow:      { label: 'ASPECTSOFPOWER.Affinity.shadow',      materialStats: ['dexterity', 'perception', 'strength'],     opposed: ['light', 'holy'],     lane: 'elemental' },
  nature:      { label: 'ASPECTSOFPOWER.Affinity.nature',      materialStats: ['vitality', 'wisdom', 'toughness'],         opposed: ['necromantic'],       lane: 'elemental' },
  poison:      { label: 'ASPECTSOFPOWER.Affinity.poison',      materialStats: ['dexterity', 'intelligence', 'vitality'],   opposed: ['holy'],              lane: 'elemental' },
  necromantic: { label: 'ASPECTSOFPOWER.Affinity.necromantic', materialStats: ['intelligence', 'toughness', 'willpower'],  opposed: ['nature', 'holy'],    lane: 'hybrid' },
  holy:        { label: 'ASPECTSOFPOWER.Affinity.holy',        materialStats: ['willpower', 'wisdom', 'toughness'],        opposed: ['necromantic', 'shadow', 'blood', 'poison'], lane: 'hybrid' },
  light:       { label: 'ASPECTSOFPOWER.Affinity.light',       materialStats: ['perception', 'wisdom', 'willpower'],       opposed: ['shadow'],            lane: 'elemental' },
  psychic:     { label: 'ASPECTSOFPOWER.Affinity.psychic',     materialStats: ['willpower', 'intelligence', 'perception'], opposed: [],                    lane: 'mental' },
  time:        { label: 'ASPECTSOFPOWER.Affinity.time',        materialStats: ['wisdom', 'intelligence', 'dexterity'],     opposed: [],                    lane: 'hybrid' },
  karma:       { label: 'ASPECTSOFPOWER.Affinity.karma',       materialStats: ['wisdom', 'intelligence', 'toughness'],     opposed: [],                    lane: 'hybrid' },
};

/**
 * Affinity skill tags — auto-populate the skill's affinities array.
 * DERIVED from the dictionary above (identical membership to the
 * pre-2026-07-03 flat Set). Do NOT add names here; add a dictionary entry.
 */
ASPECTSOFPOWER.affinityTags = new Set(Object.keys(ASPECTSOFPOWER.affinities));

/**
 * Size tag scaling — multipliers applied to ability mods and defense values.
 * str: multiplier on strength.mod (affects damage).
 * hp: multiplier on health.max (derived from vitality).
 * meleeRangedDef: multiplier on melee and ranged defense values.
 */
ASPECTSOFPOWER.sizeScaling = {
  tiny:       { str: 0.6, hp: 0.6, meleeRangedDef: 1.4 },
  small:      { str: 0.8, hp: 0.8, meleeRangedDef: 1.2 },
  medium:     { str: 1.0, hp: 1.0, meleeRangedDef: 1.0 },
  large:      { str: 1.2, hp: 1.2, meleeRangedDef: 0.8 },
  huge:       { str: 1.4, hp: 1.4, meleeRangedDef: 0.6 },
  gargantuan: { str: 1.6, hp: 1.6, meleeRangedDef: 0.4 },
};

ASPECTSOFPOWER.reactionTypes = {
  dodge:   'ASPECTSOFPOWER.Reaction.dodge',
  parry:   'ASPECTSOFPOWER.Reaction.parry',
  barrier: 'ASPECTSOFPOWER.Reaction.barrier',
  swap:    'ASPECTSOFPOWER.Reaction.swap',
  guardian: 'ASPECTSOFPOWER.Reaction.guardian',
  // CLASH (ruled 2026-08-07): meet the blow with a blow. Both damages are
  // compared, the larger wins, and only the difference lands — on the loser.
  // The only reaction that can hurt the attacker by DEFENDING, as opposed to
  // `retaliation`, which lets the hit land and answers it separately.
  clash:   'ASPECTSOFPOWER.Reaction.clash',
};

// ⚠ `retaliation` is a REAL reactionType that is deliberately absent from the
// map above: this map populates the authoring dropdown, and retaliation is
// selected by tagging rather than by picking it there. Do not "fix" the
// omission by adding it — and do not assume this map is the complete
// vocabulary when reading the dispatch in item.mjs.

// Guardian-reaction behavior modes (per design-guardian-reactions.md).
// Apply when reactionType === 'guardian' on an `ally_attacked` reaction:
//   intercept — redirect the attack onto the guardian, who defends it with
//               their own active defense + armor/veil/HP (bodyguard).
//   cover     — the guardian's defense roll replaces the ally's; success
//               negates, fail → the ally takes it (defend-for-ally).
//   redirect  — attack resolves on the ally, then guardianRedirectPct of the
//               LANDED damage transfers raw onto the guardian (bloodbond).
ASPECTSOFPOWER.guardianModes = {
  intercept: 'ASPECTSOFPOWER.Guardian.intercept',
  cover:     'ASPECTSOFPOWER.Guardian.cover',
  redirect:  'ASPECTSOFPOWER.Guardian.redirect',
};

/**
 * Non-damaging debuff subtypes applied via the debuff tag.
 * Each type stores its key on the ActiveEffect flags for enforcement.
 */
ASPECTSOFPOWER.debuffTypes = {
  none:          'ASPECTSOFPOWER.Debuff.none',
  root:          'ASPECTSOFPOWER.Debuff.root',
  immobilized:   'ASPECTSOFPOWER.Debuff.immobilized',
  slow:          'ASPECTSOFPOWER.Debuff.slow',
  chilled:       'ASPECTSOFPOWER.Debuff.chilled',
  frozen:        'ASPECTSOFPOWER.Debuff.frozen',
  sleep:         'ASPECTSOFPOWER.Debuff.sleep',
  stun:          'ASPECTSOFPOWER.Debuff.stun',
  paralysis:     'ASPECTSOFPOWER.Debuff.paralysis',
  fear:          'ASPECTSOFPOWER.Debuff.fear',
  blind:         'ASPECTSOFPOWER.Debuff.blind',
  silence:       'ASPECTSOFPOWER.Debuff.silence',
  weaken:        'ASPECTSOFPOWER.Debuff.weaken',
  deafened:      'ASPECTSOFPOWER.Debuff.deafened',
  taunt:         'ASPECTSOFPOWER.Debuff.taunt',
  charm:         'ASPECTSOFPOWER.Debuff.charm',
  enraged:       'ASPECTSOFPOWER.Debuff.enraged',
  hallucination: 'ASPECTSOFPOWER.Debuff.hallucination',
  dismembered:   'ASPECTSOFPOWER.Debuff.dismembered',
};

/**
 * DEBUFF BUILD-UP — a debuff that accumulates until it becomes a worse one.
 *
 * Generalised 2026-08-10 from the hand-wired Chilled → Frozen check that had
 * been living inside the gmApplyDebuff switch. The design was always that most
 * caps are GATEWAYS rather than ceilings (see CAP_BEHAVIOURS in helpers/tags:
 * `transform` was declared and unimplemented) — chilled freezes you solid,
 * Sinner's Remorse eventually costs you your actions, armour below a tenth
 * shatters. This registry is the `transform` half made real.
 *
 * Per entry, keyed by the ACCUMULATING debuff type:
 *   into           the debuff type it becomes
 *   name / img     display for the spawned effect
 *   thresholdStat  ability whose MOD the accumulated total must reach. Chilled
 *                  uses dexterity because that is the stat it drains: it
 *                  freezes you exactly when it would have taken all of it.
 *   thresholdFlat  flat total instead of (or as a floor under) the stat
 *   duration       rounds of the resulting debuff
 *   tags           tags stamped on the spawned effect
 *
 * ⚠ REPLACE, DON'T LAYER (confirmed UX, design-player-augments): crossing the
 * threshold DELETES every accumulated stack and spawns the successor. Already
 * suffering the successor refreshes its duration instead of stacking a second.
 */
ASPECTSOFPOWER.debuffBuildup = {
  chilled: {
    into:          'frozen',
    name:          'Frozen',
    img:           'icons/magic/water/snowflake-ice-blue.webp',
    thresholdStat: 'dexterity',
    thresholdFlat: 0,
    duration:      2,
    tags:          ['ice', 'frozen'],
  },
};

/**
 * Zone effects for persistent AOE regions.
 */
ASPECTSOFPOWER.zoneEffects = {
  none:             'ASPECTSOFPOWER.Zone.none',
  slippery:         'ASPECTSOFPOWER.Zone.slippery',
  difficultTerrain: 'ASPECTSOFPOWER.Zone.difficultTerrain',
};

/**
 * Roll types for skills — used in skill sheet dropdown.
 * Keyed by internal value, value is localization key.
 */
ASPECTSOFPOWER.rollTypes = {
  str_weapon:       'ASPECTSOFPOWER.RollType.strWeapon',
  dex_weapon:       'ASPECTSOFPOWER.RollType.dexWeapon',
  phys_ranged:      'ASPECTSOFPOWER.RollType.physRanged',
  magic:            'ASPECTSOFPOWER.RollType.magic',
  magic_projectile: 'ASPECTSOFPOWER.RollType.magicProjectile',
  magic_melee:      'ASPECTSOFPOWER.RollType.magicMelee',
  wisdom_dexterity: 'ASPECTSOFPOWER.RollType.wisdomDexterity',
};

/**
 * Skill resources.
 */
ASPECTSOFPOWER.skillResources = {
  stamina: 'ASPECTSOFPOWER.Resource.stamina',
  mana:    'ASPECTSOFPOWER.Resource.mana',
  health:  'ASPECTSOFPOWER.Resource.health',
};

/**
 * Gate tag → blocked roll types / resources.
 * Used for skill sheet filtering and runtime blocking.
 */
ASPECTSOFPOWER.gateRules = {
  'no-magic':    { blockedTypes: ['magic', 'magic_projectile', 'magic_melee'], blockedResources: ['mana'] },
  'no-ranged':   { blockedTypes: ['phys_ranged', 'magic', 'magic_projectile'], blockedResources: [] },
  'melee-only':  { blockedTypes: ['phys_ranged', 'magic', 'magic_projectile'], blockedResources: ['mana'] },
  'no-physical': { blockedTypes: ['str_weapon', 'dex_weapon', 'phys_ranged'], blockedResources: ['stamina'] },
  'magic-only':  { blockedTypes: ['str_weapon', 'dex_weapon', 'phys_ranged'], blockedResources: ['stamina'] },
  'no-stamina-skills': { blockedTypes: [], blockedResources: ['stamina'] },
};

ASPECTSOFPOWER.professionTags = {
  repair:      'ASPECTSOFPOWER.Tag.repair',
  craft:       'ASPECTSOFPOWER.Tag.craft',
  gather:      'ASPECTSOFPOWER.Tag.gather',
  refine:      'ASPECTSOFPOWER.Tag.refine',
  preparation: 'ASPECTSOFPOWER.Tag.preparation',
  jewelry:     'ASPECTSOFPOWER.Tag.jewelry',
  armor:       'ASPECTSOFPOWER.Tag.armor',
  weapon:      'ASPECTSOFPOWER.Tag.weapon',
  clothing:    'ASPECTSOFPOWER.Tag.clothing',
  alchemy:     'ASPECTSOFPOWER.Tag.alchemy',
  metal:       'ASPECTSOFPOWER.Tag.metalMat',
  leather:     'ASPECTSOFPOWER.Tag.leatherMat',
  cloth:       'ASPECTSOFPOWER.Tag.clothMat',
  gem:         'ASPECTSOFPOWER.Tag.gem',
  wood:        'ASPECTSOFPOWER.Tag.wood',
  bone:        'ASPECTSOFPOWER.Tag.bone',
  crystal:     'ASPECTSOFPOWER.Tag.crystal',
};

/**
 * Element-to-stat mappings for crafting — DERIVED from the affinity dictionary
 * (single source of truth, 2026-07-03). item-derivation (element from an
 * item's *-affinity tag) and the craft-setup dialog read
 * craftElements[element].{stats, label}. Was hand-maintained + incomplete
 * (only 10 of 22 affinities, and an 'air' vs 'wind' key bug that dropped
 * wind gear to neutral); now every affinity's materialStats flows here and
 * the wind key is correct. `neutral` stays as the no-affinity fallback
 * (empty stats → even 1/9 spread in item-derivation).
 */
ASPECTSOFPOWER.craftElements = Object.fromEntries([
  ...Object.entries(ASPECTSOFPOWER.affinities).map(
    ([key, def]) => [key, { stats: def.materialStats, label: def.label }]
  ),
  ['neutral', { stats: [], label: 'ASPECTSOFPOWER.CraftElement.neutral' }],
]);

/**
 * Quality thresholds for crafted items (progress → quality).
 */
ASPECTSOFPOWER.craftQuality = {
  cracked:  { minProgress: 0,   rarity: 'inferior',  label: 'ASPECTSOFPOWER.CraftQuality.cracked' },
  inferior: { minProgress: 50,  rarity: 'inferior',  label: 'ASPECTSOFPOWER.CraftQuality.inferior' },
  common:   { minProgress: 200, rarity: 'common',    label: 'ASPECTSOFPOWER.CraftQuality.common' },
  uncommon: { minProgress: 500, rarity: 'uncommon',  label: 'ASPECTSOFPOWER.CraftQuality.uncommon' },
  rare:     { minProgress: 1000, rarity: 'rare',     label: 'ASPECTSOFPOWER.CraftQuality.rare' },
};

/**
 * Slot value multipliers for crafting stat/armor calculations.
 * Keyed by typeKey for weapons (since 1H and 2H differ) and by slot for everything else.
 * Lookup at craft time: typeKey first, then outputSlot.
 *
 * Slot value = armor/veil value for armor & jewelry. For shields, slot value (stat) = 0.25
 * but armor value differs (see craftShieldArmorValues).
 */
ASPECTSOFPOWER.craftSlotValues = {
  // ── Armor (slot = type) ──
  chest: 0.50, legs: 0.40, head: 0.20, bracers: 0.20, boots: 0.20,
  gloves: 0.10, back: 0.10,
  // ── Jewelry (slot = type) ──
  // Ring keeps 0.50 but its EFFECTIVE contribution divides by equipped ring
  // count (EquipmentSystem._syncEffects) — total ring budget is constant
  // regardless of how many are worn. Jewelry budget = 0.40 + 2×0.25 + 0.50
  // + 0.30 = 1.70 slot-weight = armor budget (design-jewelry-rebalance.md).
  necklace: 0.40, bracelet: 0.25, ring: 0.50, earring: 0.30,
  // ── Profession (slot = type) ──
  profWeapon: 0.25, profUtility: 0.25, profHead: 0.20, profChest: 0.50,
  profLegs: 0.40, profBoots: 0.20, profGloves: 0.10,
  // ── Weapons (per type — 1H/shields = 25%, 2H = 50%) ──
  sword: 0.25, axe: 0.25, spear: 0.25, dagger: 0.25, hammer: 0.25, rapier: 0.25,
  greatsword: 0.50, greataxe: 0.50, polearm: 0.50, staff: 0.50, bow: 0.50,
  buckler: 0.25, shield: 0.25, greatshield: 0.25,
  // Slot fallback (used by legacy non-flow callers; only relevant for weaponry slot now)
  weaponry: 0.25,
};

/**
 * Shield armor value multipliers — only used for armorBonus on shield items.
 * Shields have separate stat value (25%, see craftSlotValues) and armor value.
 */
ASPECTSOFPOWER.craftShieldArmorValues = {
  buckler:     0.30,  // small
  shield:      0.40,  // medium
  greatshield: 0.50,  // large
};

/**
 * Material value multipliers for crafting.
 */
ASPECTSOFPOWER.craftMaterialValues = {
  metal: 0.5, leather: 0.333, cloth: 0.25, jewelry: 0.5,
};

/**
 * Item types a craft skill can produce. Each entry defines:
 *   category: one of 'armaments' | 'armor' | 'jewelry' | 'profession'
 *   tags:     static system tags applied at craft time (material + affinity tags inherit dynamically)
 *   slot:     equipment slot the crafted item lives in
 * Drives the new craft flow's category + type selection dialogs.
 */
ASPECTSOFPOWER.craftItemTypes = {
  // ── Armaments (slot: weaponry) ──
  sword:        { category: 'armaments', tags: ['weapon', '1H', 'sword'],                       slot: 'weaponry' },
  axe:          { category: 'armaments', tags: ['weapon', '1H', 'axe'],                         slot: 'weaponry' },
  spear:        { category: 'armaments', tags: ['weapon', '1H', 'spear'],                       slot: 'weaponry' },
  dagger:       { category: 'armaments', tags: ['weapon', '1H', 'dagger'],                      slot: 'weaponry' },
  hammer:       { category: 'armaments', tags: ['weapon', '1H', 'hammer'],                      slot: 'weaponry' },
  rapier:       { category: 'armaments', tags: ['weapon', '1H', 'rapier'],                      slot: 'weaponry' },
  greatsword:   { category: 'armaments', tags: ['weapon', '2H', 'greatsword'],                  slot: 'weaponry' },
  greataxe:     { category: 'armaments', tags: ['weapon', '2H', 'greataxe'],                    slot: 'weaponry' },
  greathammer:  { category: 'armaments', tags: ['weapon', '2H', 'greathammer'],                 slot: 'weaponry' },
  polearm:      { category: 'armaments', tags: ['weapon', '2H', 'polearm'],                     slot: 'weaponry' },
  quarterstaff: { category: 'armaments', tags: ['weapon', '2H', 'quarterstaff'],                slot: 'weaponry' },
  staff:        { category: 'armaments', tags: ['weapon', '2H', 'staff'],                       slot: 'weaponry' },
  wand:         { category: 'armaments', tags: ['weapon', '1H', 'wand'],                        slot: 'weaponry' },
  bow:          { category: 'armaments', tags: ['weapon', '2H', 'bow'],                         slot: 'weaponry' },
  buckler:      { category: 'armaments', tags: ['weapon', '1H', 'shield', 'buckler'],           slot: 'weaponry' },
  shield:       { category: 'armaments', tags: ['weapon', '1H', 'shield'],                      slot: 'weaponry' },
  greatshield:  { category: 'armaments', tags: ['weapon', '1H', 'shield', 'greatshield'],       slot: 'weaponry' },
  // Gauntlets as an ARMAMENT, distinct from the `gloves` armour piece: these
  // are what you hit people with. Needed before a dual-gauntlet combination
  // can be detected at all (2026-07-27).
  gauntlet:     { category: 'armaments', tags: ['weapon', '1H', 'gauntlet'],                    slot: 'weaponry' },

  // ── Armor (slot = key) ──
  chest:    { category: 'armor', tags: ['armor', 'chest'],     slot: 'chest' },
  legs:     { category: 'armor', tags: ['armor', 'legs'],      slot: 'legs' },
  head:     { category: 'armor', tags: ['armor', 'head'],      slot: 'head' },
  bracers:  { category: 'armor', tags: ['armor', 'bracers'],   slot: 'bracers' },
  boots:    { category: 'armor', tags: ['armor', 'boots'],     slot: 'boots' },
  gloves:   { category: 'armor', tags: ['armor', 'gloves'],    slot: 'gloves' },
  back:     { category: 'armor', tags: ['armor', 'back'],      slot: 'back' },

  // ── Jewelry (slot = key) ──
  necklace: { category: 'jewelry', tags: ['jewelry', 'necklace'], slot: 'necklace' },
  bracelet: { category: 'jewelry', tags: ['jewelry', 'bracelet'], slot: 'bracelet' },
  ring:     { category: 'jewelry', tags: ['jewelry', 'ring'],     slot: 'ring' },
  earring:  { category: 'jewelry', tags: ['jewelry', 'earring'],  slot: 'earring' },

  // ── Profession (slot = key) ──
  profWeapon:  { category: 'profession', tags: ['profession', 'profWeapon'],  slot: 'profWeapon' },
  profUtility: { category: 'profession', tags: ['profession', 'profUtility'], slot: 'profUtility' },
  profHead:    { category: 'profession', tags: ['profession', 'profHead'],    slot: 'profHead' },
  profChest:   { category: 'profession', tags: ['profession', 'profChest'],   slot: 'profChest' },
  profLegs:    { category: 'profession', tags: ['profession', 'profLegs'],    slot: 'profLegs' },
  profBoots:   { category: 'profession', tags: ['profession', 'profBoots'],   slot: 'profBoots' },
  profGloves:  { category: 'profession', tags: ['profession', 'profGloves'],  slot: 'profGloves' },

  // ── Refined material outputs (no slot — `isMaterial: true` on the created
  // item; feeds future crafts as the material input). The material kind is
  // resolved from these tags at craft time. Per-craft gating happens via the
  // skill's `craftAllowedTypes`.
  gem:    { category: 'material', tags: ['material', 'gem'],     slot: '' },
  ingot:  { category: 'material', tags: ['material', 'metal'],   slot: '' },
  thread: { category: 'material', tags: ['material', 'cloth'],   slot: '' },
  hide:   { category: 'material', tags: ['material', 'leather'], slot: '' },
  plank:  { category: 'material', tags: ['material', 'wood'],    slot: '' },
};

/**
 * Display labels for the four craft categories.
 */
ASPECTSOFPOWER.craftCategories = {
  armaments:  { label: 'Armaments' },
  armor:      { label: 'Armor' },
  jewelry:    { label: 'Jewelry' },
  profession: { label: 'Profession' },
  material:   { label: 'Refined Material' },
};

/**
 * Material rarity → d100 roll floor/ceiling for crafting.
 */
ASPECTSOFPOWER.craftRarityRanges = {
  inferior:  { floor: 0,  ceiling: 25 },
  common:    { floor: 0,  ceiling: 50 },
  uncommon:  { floor: 10, ceiling: 60 },
  rare:      { floor: 20, ceiling: 100 },
  epic:      { floor: 30, ceiling: 120 },
  legendary: { floor: 50, ceiling: 150 },
  mythic:    { floor: 70, ceiling: 175 },
  divine:    { floor: 100, ceiling: 200 },
};

/**
 * Craft sub-type → allowed slots and default materials.
 */
ASPECTSOFPOWER.craftTypes = {
  jewelry:  { slots: ['necklace', 'bracelet', 'ring', 'earring'], materials: ['jewelry', 'gem', 'crystal'] },
  armor:    { slots: ['chest', 'legs', 'head', 'bracers', 'boots', 'gloves', 'back'], materials: ['metal', 'leather'] },
  weapon:   { slots: ['weaponry'], materials: ['metal'] },
  clothing: { slots: ['chest', 'legs', 'head', 'gloves', 'back'], materials: ['cloth', 'leather'] },
};

/**
 * Attributes that buffs and debuffs can target via ActiveEffects.
 */
ASPECTSOFPOWER.buffableAttributes = {
  'abilities.vitality':     'ASPECTSOFPOWER.Ability.vitality.long',
  'abilities.endurance':    'ASPECTSOFPOWER.Ability.endurance.long',
  'abilities.strength':     'ASPECTSOFPOWER.Ability.strength.long',
  'abilities.dexterity':    'ASPECTSOFPOWER.Ability.dexterity.long',
  'abilities.toughness':    'ASPECTSOFPOWER.Ability.toughness.long',
  'abilities.intelligence': 'ASPECTSOFPOWER.Ability.intelligence.long',
  'abilities.willpower':    'ASPECTSOFPOWER.Ability.willpower.long',
  'abilities.wisdom':       'ASPECTSOFPOWER.Ability.wisdom.long',
  'abilities.perception':   'ASPECTSOFPOWER.Ability.perception.long',
  'defense.armor':          'ASPECTSOFPOWER.Defense.armor',
  'defense.veil':           'ASPECTSOFPOWER.Defense.veil',
  'defense.melee':          'ASPECTSOFPOWER.Defense.melee',
  'defense.ranged':         'ASPECTSOFPOWER.Defense.ranged',
  'defense.mind':           'ASPECTSOFPOWER.Defense.mind',
  'defense.soul':           'ASPECTSOFPOWER.Defense.soul',
};

/**
 * Extra effect keys that don't follow the standard `system.X.value` pattern.
 * These appear in the ActiveEffect config dropdown alongside buffableAttributes.
 */
ASPECTSOFPOWER.extraEffectKeys = {
  'system.reactions.max': 'ASPECTSOFPOWER.Defense.reactionsMax',
};

/**
 * Attribute groups for the buff/debuff UI — sorted by category.
 */
ASPECTSOFPOWER.attributeGroups = [
  {
    key: 'abilities',
    label: 'ASPECTSOFPOWER.AttributeGroup.abilities',
    attributes: [
      'abilities.vitality', 'abilities.endurance', 'abilities.strength',
      'abilities.dexterity', 'abilities.toughness', 'abilities.intelligence',
      'abilities.willpower', 'abilities.wisdom', 'abilities.perception',
    ],
  },
  {
    key: 'defense',
    label: 'ASPECTSOFPOWER.AttributeGroup.defenses',
    attributes: ['defense.melee', 'defense.ranged', 'defense.mind', 'defense.soul'],
  },
  {
    key: 'mitigation',
    label: 'ASPECTSOFPOWER.AttributeGroup.mitigation',
    attributes: ['defense.armor', 'defense.veil'],
  },
];

/**
 * Valid targets for the restoration tag.
 */
ASPECTSOFPOWER.restorationTargets = {
  self:     'ASPECTSOFPOWER.HealTarget.self',
  selected: 'ASPECTSOFPOWER.HealTarget.selected',
};

/**
 * Valid targets for the buff tag — mirror of restorationTargets.
 * Self-buffs (Stormstride, Haste, etc.) skip the target prompt and
 * apply to the caster.
 */
ASPECTSOFPOWER.buffTargets = {
  self:     'ASPECTSOFPOWER.HealTarget.self',
  selected: 'ASPECTSOFPOWER.HealTarget.selected',
};

/**
 * Resources the restoration tag can restore.
 */
ASPECTSOFPOWER.restorationResources = {
  health:  'ASPECTSOFPOWER.RestorationResource.health',
  mana:    'ASPECTSOFPOWER.RestorationResource.mana',
  stamina: 'ASPECTSOFPOWER.RestorationResource.stamina',
  barrier: 'ASPECTSOFPOWER.RestorationResource.barrier',
};

/**
 * AOE targeting modes — determines which tokens in the area are affected.
 */
ASPECTSOFPOWER.aoeTargetingModes = {
  all:     'ASPECTSOFPOWER.AOE.targetingAll',
  enemies: 'ASPECTSOFPOWER.AOE.targetingEnemies',
  allies:  'ASPECTSOFPOWER.AOE.targetingAllies',
};

/**
 * AOE template shapes.
 */
ASPECTSOFPOWER.aoeShapes = {
  circle: 'ASPECTSOFPOWER.AOE.shapeCircle',
  cone:   'ASPECTSOFPOWER.AOE.shapeCone',
  ray:    'ASPECTSOFPOWER.AOE.shapeRay',
  rect:   'ASPECTSOFPOWER.AOE.shapeRect',
};

/**
 * Consumable sub-types.
 */
ASPECTSOFPOWER.consumableTypes = {
  potion:  'ASPECTSOFPOWER.Consumable.potion',
  bomb:    'ASPECTSOFPOWER.Consumable.bomb',
  poison:  'ASPECTSOFPOWER.Consumable.poison',
  scroll:  'ASPECTSOFPOWER.Consumable.scroll',
  food:    'ASPECTSOFPOWER.Consumable.food',
  other:   'ASPECTSOFPOWER.Consumable.other',
};

/**
 * Consumable effect types — what happens when the consumable is used.
 */
ASPECTSOFPOWER.consumableEffectTypes = {
  restoration: 'ASPECTSOFPOWER.ConsumableEffect.restoration',
  buff:        'ASPECTSOFPOWER.ConsumableEffect.buff',
  poison:      'ASPECTSOFPOWER.ConsumableEffect.poison',
  bomb:        'ASPECTSOFPOWER.ConsumableEffect.bomb',
  barrier:     'ASPECTSOFPOWER.ConsumableEffect.barrier',
  repairKit:   'ASPECTSOFPOWER.ConsumableEffect.repairKit',
  ritual:      'ASPECTSOFPOWER.ConsumableEffect.ritual',
  none:        'ASPECTSOFPOWER.ConsumableEffect.none',
};

/**
 * Ritual quality scaling per design-ritual-subsystem.md Phase 2.5.
 * The ritual skill's rarity is the "machine quality" — drives the
 * progress threshold (minimum to succeed) and the cap (maximum strength
 * the Medium can store). Better materials and more mana let a ritualist
 * approach the cap of a given ritual, but going beyond requires
 * acquiring a higher-rarity version of the ritual itself.
 *
 * Progress formula: round(wisdom_mod × 0.55 + material_progress × 0.30
 *                          + mana_invested × 0.15)
 * Failure (progress < threshold) consumes materials + mana, no Medium.
 * Success stores Medium with ritualPower = min(progress, cap).
 */
/**
 * Base-grade (G/F/E, gradeIndex=0) ritual scaling. Each ritual carries
 * BOTH a rarity (from this table) and a ritualGrade (E/D/C/B/A/S);
 * higher grades scale these values by `ritualGradeStep^gradeIndex`.
 *
 * Calibration (2026-06-13, sealed-medium model — power IS the hit basis
 * and damage basis): caps map onto live E-party combat values. rare cap
 * 700 → hit ~770 / dmg 560: threatens E casters (HP 384-833), bounces
 * off bruisers. epic 1200 → hit ~1326: connects on every E PC (top
 * melee def 1124), one-shots squishies. legendary 2200 one-shots any
 * E PC — group-masterwork tier. Creator reach: best E ritualist (wis
 * ~750) solo-maxes ~560 progress with strong inputs — epic threshold
 * barely solo; legendary+ thresholds require group rituals (2 parity-
 * matched primaries for legendary, 3 for mythic, D-rank circle for
 * divine) per the group design in design-ritual-subsystem.md.
 *
 *   threshold     — min total progress for prep to succeed (else materials/mana consumed)
 *   materialFloor — min progress of the chosen material to attempt at all (clean failure, nothing consumed)
 *   cap           — max stored ritualPower on success
 */
ASPECTSOFPOWER.ritualScale = {
  inferior:  { threshold:    0, materialFloor:    0, cap:  100 },
  common:    { threshold:   30, materialFloor:    0, cap:  200 },
  uncommon:  { threshold:  100, materialFloor:    0, cap:  400 },
  rare:      { threshold:  250, materialFloor:  200, cap:  700 },
  epic:      { threshold:  500, materialFloor:  400, cap: 1200 },
  legendary: { threshold: 1100, materialFloor:  800, cap: 2200 },
  mythic:    { threshold: 2000, materialFloor: 1500, cap: 4000 },
  divine:    { threshold: 3500, materialFloor: 2500, cap: 7500 },
};

/**
 * Per-grade multiplier on the ritualScale rows. 2.5 (2026-06-13, was
 * 1.25): measured actor mod growth E→D is ~2.75× (stat values roughly
 * +1000 across D levels through the (v/1085)^0.8 curve, × the 1.25
 * grade multiplier). Under the sealed-medium model the cap must track
 * same-grade combat values or higher-grade rituals are useless in
 * their own rank's fights — at 1.25/grade a D-rare cap (875) couldn't
 * scratch D-rank defenses (~2000). No live impact at change time: all
 * existing rituals are E-grade (gradeIndex 0 → multiplier 1).
 */
ASPECTSOFPOWER.ritualGradeStep = 2.5;

/**
 * Group ritual + prep-time tuning (design-ritual-subsystem.md, RULED
 * 2026-06-13; buildable only once the activity framework landed).
 *
 * Grouping trades quality for SPEED, never power: stored power is the MEAN of
 * each participant's solo contribution, so a coven can never exceed its best
 * member and a master who brings a novice drags their own result toward the
 * middle. Parity needs no rule — the average enforces it.
 *
 * Prep time is the payoff: base cost divided by the number of hands. More
 * materials pull the other way (they extend prep), so the full lever-web is
 * "more materials = more power but longer, more people = faster but diluted."
 */
ASPECTSOFPOWER.ritualPrep = {
  // Registry key in ASPECTSOFPOWER.activities supplying the base prep cost.
  activityKey: 'ritualPrep',
  // Each material UNIT beyond the first adds this share of base prep time.
  extraMaterialTimeFactor: 0.5,
};

/**
 * Progress formula weights per design-ritual-subsystem.md Phase 2.5.
 * Sum to 1.0; "wisdom is the dominant input but materials + mana matter."
 */
ASPECTSOFPOWER.ritualProgressWeights = {
  wisdom:   0.55,
  material: 0.30,
  mana:     0.15,
};

/**
 * MULTI-MATERIAL lever (design-ritual-subsystem, ruled 2026-06-13; built
 * 2026-07-25). A prep may consume SEVERAL gems, their progress SUMMED at the
 * 0.30 material weight — the legitimate grind path across the high gates
 * ("I prepared extensively with rare reagents", not "I brought friends").
 * The rarity cap still clamps the ceiling, so more materials only helps you
 * APPROACH a ritual's cap, never exceed the rarity ladder.
 *
 * Per-rarity ITEM CAP — the trash-flood guard: you cannot dump 2,000 junk
 * gems into a common ritual. Rising with rarity means the sacrifice scales
 * with the power reached.
 */
ASPECTSOFPOWER.ritualMaxMaterials = {
  inferior:  1,
  common:    2,
  uncommon:  3,
  rare:      4,
  epic:      6,
  ancient:   8,
  legendary: 10,
  mythic:    12,
  divine:    16,
};

/**
 * Medium types — the physical form an inscribed ritual takes. Drives
 * range/geometry at activation. Phase 2.5 ships `gem` (touch/self) only;
 * `circle` and `pylon` are deferred to a later phase that needs scene-
 * region or persistent-token plumbing.
 */
ASPECTSOFPOWER.mediumTypes = {
  gem:    { label: 'ASPECTSOFPOWER.MediumType.gem',    range:   0, placement: false },
  circle: { label: 'ASPECTSOFPOWER.MediumType.circle', range:  60, placement: true  },
  pylon:  { label: 'ASPECTSOFPOWER.MediumType.pylon',  range: 300, placement: true  },
};

/**
 * Material types for equipment — determines which repair skills can target them.
 */
ASPECTSOFPOWER.materialTypes = {
  metal:   'ASPECTSOFPOWER.Material.metal',
  leather: 'ASPECTSOFPOWER.Material.leather',
  cloth:   'ASPECTSOFPOWER.Material.cloth',
  jewelry: 'ASPECTSOFPOWER.Material.jewelry',
  gem:     'ASPECTSOFPOWER.Material.gem',
  wood:    'ASPECTSOFPOWER.Material.wood',
  bone:    'ASPECTSOFPOWER.Material.bone',
  crystal: 'ASPECTSOFPOWER.Material.crystal',
};

/**
 * Equipment slot definitions — key is the slot ID, max is how many items
 * can occupy that slot simultaneously.
 */
ASPECTSOFPOWER.equipmentSlots = {
  chest:    { label: 'ASPECTSOFPOWER.Equip.Slot.chest',    max: 1, set: 'combat' },
  legs:     { label: 'ASPECTSOFPOWER.Equip.Slot.legs',     max: 1, set: 'combat' },
  head:     { label: 'ASPECTSOFPOWER.Equip.Slot.head',     max: 1, set: 'combat' },
  bracers:  { label: 'ASPECTSOFPOWER.Equip.Slot.bracers',  max: 1, set: 'combat' },
  boots:    { label: 'ASPECTSOFPOWER.Equip.Slot.boots',    max: 1, set: 'combat' },
  gloves:   { label: 'ASPECTSOFPOWER.Equip.Slot.gloves',   max: 1, set: 'combat' },
  back:     { label: 'ASPECTSOFPOWER.Equip.Slot.back',     max: 1, set: 'combat' },
  // Jewelry — applies to both combat and profession loadouts (worn at all times).
  necklace: { label: 'ASPECTSOFPOWER.Equip.Slot.necklace', max: 1, set: 'both' },
  bracelet: { label: 'ASPECTSOFPOWER.Equip.Slot.bracelet', max: 2, set: 'both' },
  ring:     { label: 'ASPECTSOFPOWER.Equip.Slot.ring',     max: 10, set: 'both' },
  earring:  { label: 'ASPECTSOFPOWER.Equip.Slot.earring',  max: 1, set: 'both' },
  weaponry: { label: 'ASPECTSOFPOWER.Equip.Slot.weaponry', max: 2, set: 'combat' },
  // Profession gear slots.
  profWeapon:  { label: 'ASPECTSOFPOWER.Equip.Slot.profWeapon',  max: 1, set: 'profession' },
  profUtility: { label: 'ASPECTSOFPOWER.Equip.Slot.profUtility', max: 1, set: 'profession' },
  profHead:    { label: 'ASPECTSOFPOWER.Equip.Slot.profHead',    max: 1, set: 'profession' },
  profChest:   { label: 'ASPECTSOFPOWER.Equip.Slot.profChest',   max: 1, set: 'profession' },
  profLegs:    { label: 'ASPECTSOFPOWER.Equip.Slot.profLegs',    max: 1, set: 'profession' },
  profBoots:   { label: 'ASPECTSOFPOWER.Equip.Slot.profBoots',   max: 1, set: 'profession' },
  profGloves:  { label: 'ASPECTSOFPOWER.Equip.Slot.profGloves',  max: 1, set: 'profession' },
};

/**
 * Rarity tiers — determines augment slot count and display color.
 */
ASPECTSOFPOWER.rarities = {
  inferior:  { label: 'ASPECTSOFPOWER.Equip.Rarity.inferior',  augments: 0, color: '#888888' },
  common:    { label: 'ASPECTSOFPOWER.Equip.Rarity.common',    augments: 1, color: '#ffffff' },
  uncommon:  { label: 'ASPECTSOFPOWER.Equip.Rarity.uncommon',  augments: 2, color: '#1eff00' },
  rare:      { label: 'ASPECTSOFPOWER.Equip.Rarity.rare',      augments: 3, color: '#0070dd' },
  epic:      { label: 'ASPECTSOFPOWER.Equip.Rarity.epic',      augments: 4, color: '#a335ee' },
  ancient:   { label: 'ASPECTSOFPOWER.Equip.Rarity.ancient',   augments: 5, color: '#c4a882' },
  legendary: { label: 'ASPECTSOFPOWER.Equip.Rarity.legendary', augments: 6, color: '#ff8000' },
  mythic:    { label: 'ASPECTSOFPOWER.Equip.Rarity.mythic',    augments: 7, color: '#e6cc80' },
  divine:    { label: 'ASPECTSOFPOWER.Equip.Rarity.divine',    augments: 8, color: '#ff4444' },
};

/**
 * Augment crafter-scaling ladder (RULED 2026-07-25): an augment's magnitude is
 * driven by the RARITY OF THE APPLYING CRAFT SKILL — "a common grants .1x of
 * the roll, uncommon .2x, etc." Read when the augment template sets
 * `scaleWithCrafter: true`; the snapshot value becomes
 * `floor(craftRoll × augmentRarityMagnifiers[skill.rarity])`.
 *
 * Same augment template, different magnitude per crafter's mastery — a divine
 * smith's Molten is 8× a common smith's. `inferior` sits a half-step below
 * common rather than 0 so an unskilled application still does something.
 */
ASPECTSOFPOWER.augmentRarityMagnifiers = {
  inferior:  0.05,
  common:    0.10,
  uncommon:  0.20,
  rare:      0.30,
  epic:      0.40,
  ancient:   0.50,
  legendary: 0.60,
  mythic:    0.70,
  divine:    0.80,
};

/**
 * Profession augment craft-bonus types — single source of truth for the
 * augment sheet's type dropdown and the craft-side bonus dispatcher.
 * Order here is the display order in the dropdown.
 *
 * `d100Reroll` is intentionally excluded — gated until resource costs are figured out.
 * See memory/design-profession-augments.md for the full design + sim references.
 */
ASPECTSOFPOWER.craftBonusTypes = {
  d100Bonus:            { label: 'ASPECTSOFPOWER.CraftBonus.d100Bonus',            scaling: 'flat-per-grade-d100' },
  craftProgress:        { label: 'ASPECTSOFPOWER.CraftBonus.craftProgress',        scaling: 'magnifier' },
  prepBonus:            { label: 'ASPECTSOFPOWER.CraftBonus.prepBonus',            scaling: 'magnifier' },
  materialPotency:      { label: 'ASPECTSOFPOWER.CraftBonus.materialPotency',      scaling: 'flat' },
  critFailReduce:       { label: 'ASPECTSOFPOWER.CraftBonus.critFailReduce',       scaling: 'magnifier-pct' },
  critSuccessThreshold: { label: 'ASPECTSOFPOWER.CraftBonus.critSuccessThreshold', scaling: 'magnifier-capped' },
  materialPreservation: { label: 'ASPECTSOFPOWER.CraftBonus.materialPreservation', scaling: 'magnifier-pct-capped' },
  // maxProgressBoost: pulled 2026-05-19. Revisit when iteration ceiling becomes
  // a tuning lever — currently it just raised theoreticalMaxProgress (display +
  // rework headroom) which had low impact in practice.
  reworkDecayReduce:    { label: 'ASPECTSOFPOWER.CraftBonus.reworkDecayReduce',    scaling: 'flat-per-grade-decay' },
};

/* -------------------------------------------- */
/*  Rank Tiers & Levelling                       */
/* -------------------------------------------- */

/**
 * Rank tiers — maps rank letter to its level range.
 */
ASPECTSOFPOWER.rankTiers = {
  G: { label: 'ASPECTSOFPOWER.Rank.G', min: 0,   max: 9 },
  F: { label: 'ASPECTSOFPOWER.Rank.F', min: 10,  max: 24 },
  E: { label: 'ASPECTSOFPOWER.Rank.E', min: 25,  max: 99 },
  D: { label: 'ASPECTSOFPOWER.Rank.D', min: 100, max: 199 },
  C: { label: 'ASPECTSOFPOWER.Rank.C', min: 200, max: 299 },
  B: { label: 'ASPECTSOFPOWER.Rank.B', min: 300, max: 399 },
  A: { label: 'ASPECTSOFPOWER.Rank.A', min: 400, max: 499 },
  S: { label: 'ASPECTSOFPOWER.Rank.S', min: 500, max: Infinity },
};

/**
 * Rank equivalence for class / profession templates: which target ranks does
 * a template assigned at a given rank actually cover? Race templates use
 * per-rank `rankGains` and are unaffected by this table.
 *
 * G and F share class / profession structure (a G template's gains apply
 * unchanged through both G-rank and F-rank levels). Higher ranks are each
 * self-contained.
 *
 * Consumed by:
 *   - mass-leveler.applyTrackLevels (engine compatibility check)
 *   - player-releveler-dialog._findTemplatesByRank (picker filtering)
 */
ASPECTSOFPOWER.rankEquivalence = {
  G: ['G', 'F'],
  F: ['F'],
  E: ['E'],
  D: ['D'],
  C: ['C'],
  B: ['B'],
  A: ['A'],
  S: ['S'],
};

/**
 * Determine rank letter from a level value.
 * @param {number} level
 * @returns {string}
 */
ASPECTSOFPOWER.getRankForLevel = function(level) {
  for (const [rank, tier] of Object.entries(ASPECTSOFPOWER.rankTiers)) {
    if (level >= tier.min && level <= tier.max) return rank;
  }
  return 'G';
};

/**
 * Level type labels for race/class/profession.
 */
ASPECTSOFPOWER.levelTypes = {
  race:       'ASPECTSOFPOWER.Level.race',
  class:      'ASPECTSOFPOWER.Level.class',
  profession: 'ASPECTSOFPOWER.Level.profession',
};
/**
 * UNARMED STAT GRANT (ruled 2026-08-07).
 *
 * A fighter with empty hands forgoes whatever stat block a weapon carries, and
 * nothing replaced it. This is that replacement: the Unarmed Proficiency
 * passive grants stats in the weapon's place, scaled by its own rarity — which
 * is already the mastery ladder.
 *
 * ⚠ THE NUMBERS ARE MEASURED, NOT CHOSEN. Across the 35 stat-carrying weapons
 * in this world the medians run common 27, uncommon 36, rare 45 — a clean +9
 * per rarity step — and the typical weapon spreads its total over THREE
 * abilities in a 36/34/30 shape ([18,17,15], [16,15,13]). Both are reproduced
 * here. Re-derive from live gear before changing them.
 *
 * ⚠ DELIBERATELY RANK-NEUTRAL. Weapons in this system do not scale with rank —
 * that property is what settled the rank ladder (design-rank-ladder) — so
 * fists must not either, or they would outpace the swords they stand in for.
 * Proficiency rarity carries all of the progression.
 *
 * Gated on OWNING the Unarmed Proficiency passive, matching how the untrained
 * proficiency penalty is scoped: own a proficiency and you opt in. That keeps
 * the 184 weaponless bestiary actors exactly as they are.
 */
/**
 * Overworld travel between hex areas.
 *
 * The confirmation prompt itself is CORE — `teleportToken.choice` asks the user
 * who moved the token. What core has no concept of is combat, so the only thing
 * configured here is the combat gate.
 */
ASPECTSOFPOWER.overworld = {
  // Block a token that is in a STARTED combat from moving into an exit region.
  // A GM gets a confirm instead of a hard stop; players are stopped outright.
  blockExitDuringCombat: true,
};

ASPECTSOFPOWER.unarmedGrant = {
  enabled: true,
  // Ordered: primary, secondary, tertiary.
  abilities: ['dexterity', 'strength', 'endurance'],
  split: [0.36, 0.34, 0.30],
  totalByRarity: {
    not_proficient: 0,
    neglected:       9,
    rusty:          18,
    inferior:       22,
    common:         27,
    uncommon:       36,
    rare:           45,
    epic:           54,
    legendary:      63,
    mythic:         72,
    divine:         81,
  },
};
