/**
 * SITUATIONAL DAMAGE MODIFIERS — the engine-evaluated half of a skill's
 * effect multiplier.
 *
 * WHY THIS EXISTS (user, 2026-08-06: *"Why hardcode it?"*)
 *
 * A skill's effect multiplier has two kinds of term, and only one of them had
 * a system:
 *
 *   AUTHORED     the author picks it at upgrade time, it is static, and it
 *                lives in `alterationTags` — a registry, extensible without
 *                touching engine code.
 *   SITUATIONAL  the ENGINE evaluates it at roll time against world state
 *                (weapon proficiency, the phase of the moon, one day stealth
 *                or terrain or elevation). There was no registry, so each one
 *                got HARDCODED as a named term inside
 *                `Item#_resolveRarityMods`.
 *
 * Three had accumulated that way (the aoe/debuff intrinsic-tag coupling,
 * proficiency, and lunar phase), and the costs were real:
 *
 *  - `_resolveRarityMods` is called from CELERITY twice, purely for
 *    `effectiveWeightMultiplier` — so computing how long a sword swing takes
 *    consulted weapon proficiency AND called `calendar.moonState(worldTime)`.
 *    For a number that depends on neither. (Fixed alongside this by splitting
 *    `_resolveCostWeightMods` out; celerity now calls that.)
 *  - `formulas.effectiveDamageMultiplier` had to ACCEPT profMult and lunarMult
 *    as parameters precisely because they were hardcoded in a document method
 *    no other caller could reproduce — which is the shape that let the
 *    skill-upgrade dialog's preview drift from the real path for months.
 *  - Every new conditional meant another edit to the damage core.
 *
 * Adding one now is a registry entry. `ambush` should move here when stealth
 * ships and its bonus becomes conditional rather than always-on.
 *
 * CONTRACT: `resolve(item)` returns a MULTIPLIER, and returns exactly `1`
 * when it does not apply. Entries returning 1 are dropped, so a skill that
 * opts into nothing pays for nothing.
 *
 * Lives in systems/ rather than helpers/config because it imports
 * weapon-styles; helpers must import nothing from systems
 * (playbook-code-standards, rule 10).
 */
import { lunarPhaseMultiplier } from '../helpers/formulas.mjs';
import { proficiencyDamageMult } from './weapon-styles.mjs';

/**
 * @typedef {object} SituationalMod
 * @property {string} id
 * @property {string} label
 * @property {(item: Item) => number} resolve  multiplier, or 1 when N/A
 */

/** @type {SituationalMod[]} */
export const SITUATIONAL_MODS = [
  {
    id: 'proficiency',
    label: 'ASPECTSOFPOWER.Situational.proficiency',
    /**
     * Mastery of the weapon TYPE in hand scales the damage of attacks made
     * with it, anchored so `common` (trained) is neutral (ruled 2026-07-27).
     * Only weapon-flavoured roll types are scaled — spells are not.
     * ⚠ ABSENCE is neutral, but a BELOW-TRAINED tier genuinely penalises:
     * measured on the live roster this runs 0.833 to 1.167.
     */
    resolve(item) {
      const cfg = CONFIG.ASPECTSOFPOWER?.weaponProficiency ?? {};
      if (cfg.enabled === false || !item?.actor) return 1;
      const rollTypes = cfg.rollTypes ?? [];
      if (!rollTypes.includes(item.system?.roll?.type)) return 1;
      return proficiencyDamageMult(item.actor, item._proficiencyWeapon?.() ?? null) || 1;
    },
  },
  {
    id: 'lunar',
    label: 'ASPECTSOFPOWER.Situational.lunar',
    /**
     * A lunar ritual is empowered under its own moon and weakened under the
     * opposite one (ruled 2026-07-29). Which moon comes from
     * `tagConfig.lunarPhase` if set, else the skill's NAME matched against
     * CONFIG.celestial.phases — the eight authored rituals are named
     * byte-identically to the eight phases so that join needs no per-skill
     * authoring.
     *
     * ⚠ THE TAG GATE IS FIRST AND IS THE POINT: without it this would run a
     * calendar lookup on every skill in the game. Measured 2026-08-06, ZERO
     * skills in the world return anything but 1 here — the eight lunar
     * rituals were never authored.
     */
    resolve(item) {
      const cel = CONFIG.ASPECTSOFPOWER?.celestial ?? {};
      if (!(cel.lunarAmplitude > 0)) return 1;
      const needTag = cel.lunarRequiresTag;
      if (needTag && !(item?.system?.tags ?? []).includes(needTag)) return 1;

      const phases = cel.phases ?? [];
      const declared = item?.system?.tagConfig?.lunarPhase || '';
      const idx = phases.indexOf(declared || item?.name);
      if (idx < 0) return 1;

      // ⚠ Pass worldTime EXPLICITLY. Omitting it is what made this ship dead
      // in `44d6ec6`: moonState had no default, returned NaN elongation, and
      // the finite-check below quietly reported "no moon effect".
      const elong = game.aspectsofpower?.calendar
        ?.moonState?.(game.time.worldTime)?.elongation;
      if (!Number.isFinite(elong)) return 1;
      return lunarPhaseMultiplier(idx, elong);
    },
  },
  {
    id: 'kindled',
    label: 'ASPECTSOFPOWER.Situational.kindled',
    /**
     * Kindled self-buffs (kindle tag, ruled 2026-08-21): an AOE that caught
     * N targets left `kindledDmgMod = kindlePerTarget × N` on the caster.
     * Bonuses SUM across distinct kindled effects, then apply as one
     * multiplier — scoped by affinity: a fire kindle boosts fire attacks
     * (shared entry in `system.affinities`), and an affinity-less kindle
     * boosts everything the caster throws.
     */
    resolve(item) {
      const actor = item?.actor;
      if (!actor) return 1;
      // Typing is DERIVED from tags (ruled 2026-08-24) — the stored
      // `system.affinities` is deprecated and out of sync on any skill the
      // sheet never toggled, which would silently un-scope a kindle.
      const atkAff = item?.effectiveAffinities?.() ?? item?.system?.affinities ?? [];
      let bonus = 0;
      for (const e of actor.allApplicableEffects?.() ?? []) {
        if (e.disabled) continue;
        const k = e.system?.kindledDmgMod ?? 0;
        if (k <= 0) continue;
        const eAff = e.system?.affinities ?? [];
        if (eAff.length && !atkAff.some(a => eAff.includes(a))) continue;
        bonus += k;
      }
      return 1 + bonus;
    },
  },
];

/**
 * Evaluate every situational modifier against a skill.
 *
 * Entries that do not apply (returning 1) are DROPPED rather than carried as
 * 1s, so callers can show the player exactly which situational effects are
 * live on this roll — something the hardcoded version could not express.
 *
 * A throwing entry is treated as inapplicable rather than taking the whole
 * damage calculation down with it: a broken situational modifier must never
 * stop a skill from rolling.
 *
 * @param {Item} item
 * @param {SituationalMod[]} [registry]
 * @returns {{id: string, mult: number}[]}
 */
export function resolveSituationalMods(item, registry = SITUATIONAL_MODS) {
  const out = [];
  for (const mod of registry ?? []) {
    let v;
    try {
      v = Number(mod.resolve(item));
    } catch (err) {
      console.error(`Aspects of Power | situational mod "${mod.id}" threw`, err);
      continue;
    }
    if (!Number.isFinite(v) || v === 1) continue;
    out.push({ id: mod.id, mult: v });
  }
  return out;
}
