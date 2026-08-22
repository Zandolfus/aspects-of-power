import { EquipmentSystem } from '../systems/equipment.mjs';
import { getPositionalTags } from '../helpers/positioning.mjs';
import { houseHitFormula, hybridAbilityMod, weaponStatBlend, healStatBlend, spellDamageRef, spellInvestDamage, spellWindupMultiplier, spellCastWeight, strikeInvestDamage, coInvestDamage, investSelfDamage as computeInvestSelfDamage, effectiveDodgeValue, splitEvenlyWithRemainder, parryMassMultiplier, bracedParryWeight, bracedMaxUsefulInvest, defenceMarginMultiplier, defenseTimeCost, defenseDiveSurcharge, dotTickDamage, burnDetonatePayload, bulwarkWallBonus, procStaminaCost, crushFlatAmount, riderMaxInvest, auraRadiusFor, barrierStatBlend, hotTickAmount, effectiveDamageMultiplier, clashOutcome } from '../helpers/formulas.mjs';
import { resolveSituationalMods } from '../systems/situational-mods.mjs';
import { recordActionFired, declareAction, isInActiveCombat, computeActionWait, referenceRoundLength, computeWindupMultiplier, getScrambleStacks, addScrambleStack, applyDodgeCost, findCombatantForActor, perceiveGate, getDefenseBudget, spendDefenseBudget, setLastSwungHand, computeActionHeft, actorRoundLength } from '../systems/celerity.mjs';
import { getThreatRadiusFt, actorIsDashing } from '../systems/engagement-halts.mjs';
import { selectTargetOnCanvas, selectTargetsOnCanvas, skillNeedsTargetPrompt, skillTargetsAtFire, selectMarkerOnCanvas } from '../canvas/target-prompt.mjs';
import { regionTokenOverlap, segmentIntersect } from '../helpers/geometry.mjs';
import { CraftingSkillsMixin } from '../systems/crafting-skills.mjs';
import { executeGmAction as executeGmActionImpl } from '../systems/gm-actions.mjs';
import { proficiencyDamageMult, proficiencyHitMult, heldWeaponWeight, heldImplementWeight, mainHandWeapon, offHandWeapon, dualWieldEligible, handOf } from '../systems/weapon-styles.mjs';
import { stackDamageMultiplier, spendableRange, clampSpread, getStackCount, getStackPayload, addStacks, spendStacks, resolveStackCap } from '../systems/stacks.mjs';
import { resolveCoInvest } from '../systems/co-invest.mjs';

/**
 * Check if an actor is an assigned player character (not just owned).
 * @param {Actor} actor
 * @returns {boolean}
 */
function _isPlayerCharacter(actor) {
  return game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
}

/**
 * The damage figure a `clash` reaction is measured against.
 *
 * Only the clash branch reads this; every other reaction resolves off the
 * to-hit. Dual-defence attacks split their damage 50/50 across the two halves
 * and each half is gated by its own defence check, so a clash meeting one half
 * must be measured against that half — otherwise a single counter would be
 * judged against a blow twice the size it is actually stopping, and would lose
 * clashes it should win.
 *
 * @param {Roll|null} dmgRoll
 * @param {boolean} hasDualDefense
 * @returns {number}
 */
function _clashIncoming(dmgRoll, hasDualDefense) {
  const total = Math.max(0, Math.round(dmgRoll?.total ?? 0));
  return hasDualDefense ? Math.round(total / 2) : total;
}

/**
 * Exact dodge win probability against an ALREADY-ROLLED hit total: the
 * defender's d20 is the only random part — fraction of the 20 faces where
 * dodgeValue × (1 + d/100) ≥ hitTotal. Used by the AI defense auto-policy.
 */
function _dodgeWinProb(dodgeValue, hitTotal) {
  if (dodgeValue <= 0 || hitTotal <= 0) return 0;
  let wins = 0;
  for (let d = 1; d <= 20; d++) {
    if (dodgeValue * (1 + d / 100) >= hitTotal) wins++;
  }
  return wins / 20;
}

/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class AspectsofPowerItem extends Item {
  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    // As with the actor class, items are documents that can have their data
    // preparation methods overridden (such as prepareBaseData()).
    super.prepareData();
  }
  prepareDerivedData() {
    const itemData = this;
    const actorData = this.actor;
    super.prepareDerivedData();
  }
  /**
   * Prepare a data object which defines the data schema used by dice roll commands against this Item
   * @override
   */
  getRollData() {
    // Starts off by populating the roll data with the full source data (includes
    // non-schema fields like `roll` stored in the database).
    const rollData = this.system.toObject();

    // Quit early if there's no parent actor
    if (!this.actor) return rollData;

    // If present, add the actor's roll data
    rollData.actor = this.actor.getRollData();

    return rollData;
  }

  /* ------------------------------------------------------------------ */
  /*  Formula helpers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Build to-hit and damage formula strings from the skill's roll config.
   * @param {object} rollData  The roll data object from getRollData().
   * @returns {{ hitFormula: string|null, dmgFormula: string }}
   */
  /**
   * Prompt the user for how much mana to spend on a barrier skill.
   * @param {number} maxMana  Current mana available.
   * @returns {Promise<number|null>}  Chosen mana amount, or null if cancelled.
   */

  async _promptBarrierManaCost(maxMana) {
    const multiplier = this.system.tagConfig?.barrierMultiplier ?? 1;
    // DialogV2.wait, not a hand-rolled promise: every dialog in the system goes
    // through the static helper so one stub can drive them all headlessly (a
    // manual `new Promise` + `new DialogV2` cannot be intercepted, and a test
    // walking that path HANGS on a click that never comes).
    return foundry.applications.api.DialogV2.wait({
      window: { title: 'Barrier — Mana Cost' },
      content: `<div class="form-group">
          <label>Mana to spend (max ${maxMana}):</label>
          <input type="number" name="manaCost" value="${maxMana}" min="1" max="${maxMana}" autofocus />
        </div>
        <p class="hint">Barrier HP = Mana &times; ${multiplier}</p>`,
      buttons: [
        {
          action: 'confirm',
          label: 'Create Barrier',
          default: true,
          callback: (event, button) => {
            const val = parseInt(button.form.elements.manaCost?.value, 10);
            return Math.min(Math.max(1, val || 0), maxMana);
          },
        },
        { action: 'cancel', label: 'Cancel', callback: () => null },
      ],
      close: () => null,
    });
  }

  /**
   * Prompt for how many stacks to commit to this activation.
   *
   * Shows the resulting multiplier live so the player is choosing a payoff, not
   * a number. Via DialogV2.wait so one stub drives it headlessly, per the
   * standard every dialog in this system follows.
   *
   * @returns {Promise<number|null>} Stacks to spend, or null if cancelled.
   */
  async _promptStackSpend(pool, min, max, scaling = 1) {
    const rows = [];
    for (let n = min; n <= max; n++) {
      const m = stackDamageMultiplier(n, scaling);
      rows.push(`<option value="${n}"${n === max ? ' selected' : ''}>`
        + `${n} — x${Math.round(m * 100) / 100} effect</option>`);
    }
    return foundry.applications.api.DialogV2.wait({
      window: { title: `${this.name} — Spend Stacks` },
      content: `<div class="form-group">
          <label>Stacks to spend (${min}-${max} held):</label>
          <select name="stackSpend" autofocus>${rows.join('')}</select>
        </div>
        <p class="hint">Pool: ${pool}. Spreading across targets and dumping into
        one are both valid — they trade breadth for burst, not efficiency.</p>`,
      buttons: [
        {
          action: 'confirm',
          label: 'Spend',
          default: true,
          callback: (event, button) => {
            const val = parseInt(button.form.elements.stackSpend?.value, 10);
            return Math.min(Math.max(min, val || min), max);
          },
        },
        { action: 'cancel', label: 'Cancel', callback: () => null },
      ],
      close: () => null,
    });
  }

  /**
   * Prompt for how many fields to throw at EACH targeted token.
   *
   * One number per target, because the player assigns freely — 3-and-1 across
   * two targets is a different tactical choice from 2-and-2 (finish one, chip
   * the other) and the rule has no reason to forbid it.
   *
   * Over-budget entries are trimmed by `clampSpread` rather than rejected, so a
   * mis-typed number costs a field instead of the whole action.
   *
   * @returns {Promise<Array<{id,name,fields}>|null>} Assignment, or null if cancelled.
   */
  async _promptStackSpread(pool, held, budget, targets, payload) {
    const rows = targets.map(t => `<div class="form-group">
        <label>${t.name}</label>
        <input type="number" name="tgt_${t.id}" value="0" min="0" max="${held}" step="1" />
      </div>`).join('');
    // Only feasible rows: every target needs at least one field, so F >= T,
    // and F + T <= budget then caps targets at floor(budget / 2). At budget 6
    // that is 5-at-one, 4-at-two, 3-at-three — and no fourth target, ever.
    const ladder = [];
    for (let tt = 1; tt <= Math.floor(budget / 2); tt++) {
      ladder.push(`${budget - tt} at ${tt}`);
    }
    return foundry.applications.api.DialogV2.wait({
      window: { title: `${this.name} — Throw Fields` },
      content: `<p><strong>${held}</strong> held${payload > 0 ? `, ${Math.round(payload)} damage each` : ''}.</p>
        ${rows}
        <p class="hint">Fields + targets must not exceed ${budget} — ${ladder.join(', ')}.
        Over-budget assignments are trimmed from the largest pile.</p>`,
      buttons: [
        {
          action: 'confirm',
          label: 'Throw',
          default: true,
          callback: (event, button) => {
            const wanted = targets.map(t => ({
              id: t.id,
              fields: parseInt(button.form.elements[`tgt_${t.id}`]?.value, 10) || 0,
            }));
            const legal = clampSpread(wanted, budget, held);
            return legal.length
              ? legal.map(l => ({ ...l, name: targets.find(t => t.id === l.id)?.name ?? '?' }))
              : null;
          },
        },
        { action: 'cancel', label: 'Cancel', callback: () => null },
      ],
      close: () => null,
    });
  }

  /**
   * Producer side: bank this skill's stacks onto the CASTER after a successful
   * cast. No-op for every skill that does not declare `stackProduces`.
   */
  async _produceStacks(speaker, rollMode, castDamage = 0) {
    const cfg = this.system.tagConfig ?? {};
    if (!cfg.stackPool || !(cfg.stackProduces > 0) || !this.actor) return;
    const before = getStackCount(this.actor, cfg.stackPool);
    // Bank what this cast was worth, split across the fields it made. The
    // producer pays the mana and the windup; the spender is free to fire and
    // simply cashes this in. A producer that rolls no damage banks 0, and its
    // spenders fall back to scaling their own formula.
    const payload = cfg.stackProduces > 0 && castDamage > 0
      ? castDamage / cfg.stackProduces : 0;
    const after = await addStacks(this.actor, cfg.stackPool, cfg.stackProduces, {
      // One resolver for every site that needs this actor's ceiling for this
      // pool — flat `stackCap`, or `stackCapStat` naming an ability whose mod
      // sets it (ki: endurance). See systems/stacks.resolveStackCap.
      cap: resolveStackCap(this.actor, cfg.stackPool),
      sourceSkill: this.name,
      label: `${this.name} (${cfg.stackPool})`,
      img: this.img,
      payload,
    });
    const gained = after - before;
    ChatMessage.create({
      speaker, rollMode,
      content: `<p><em>${this.actor.name} conjures <strong>${gained}</strong> `
             + `${gained === 1 ? 'stack' : 'stacks'} — ${after} held`
             + `${cfg.stackCap > 0 ? ` / ${cfg.stackCap}` : ''}`
             + `${payload > 0 ? `, worth ${Math.round(payload)} each` : ''}.`
             + `${gained < cfg.stackProduces ? ' Pool is full.' : ''}</em></p>`,
    });
  }

  /**
   * Resolve which weapon item drives this skill's weight + tags.
   *   1. If `system.requiredEquipment` is set and resolves on the actor → that item.
   *   2. Else, the actor's currently-equipped weaponry-slot item with the heaviest
   *      canonical weight, excluding shields (so Phil wielding Claymore + Shield
   *      picks the Claymore for Strike).
   *   3. Else, null (caller falls back to legacy formula).
   *
   * @returns {Item|null}
   */
  _resolveWeaponForSkill() {
    if (!this.actor) return null;
    // Declared-weapon pin: the fire path resolves with the weapon the
    // declare priced, while it is still equipped. A vanished/unequipped pin
    // falls through to fresh resolution (degraded, documented).
    if (this._pinnedWeaponId) {
      const pinned = this.actor.items.get(this._pinnedWeaponId);
      if (pinned?.system?.equipped) return pinned;
    }
    if (this.system.requiredEquipment) {
      const direct = this.actor.items.get(this.system.requiredEquipment);
      if (direct) return direct;
    }
    // Hand-aware since 2026-08-16 (design-hand-slots): an explicit main-hand
    // assignment wins; with none anywhere, mainHandWeapon falls back to the
    // exact heaviest-non-shield rule that used to live inline here, so
    // hand-less actors (the whole bestiary) resolve identically. One
    // deliberate delta: a BROKEN weapon no longer resolves (equippedWeapons
    // filters 0-durability) — a shattered blade should not drive the damage
    // formula, matching how styles already treated it.
    //
    // DUAL-WIELD ROTATION (design-dual-wield-tempo): when both hands hold a
    // 1H weapon, weapon-typed attacks alternate hands — the next swing
    // resolves with the hand OPPOSITE the last one that fired (first swing
    // is main). Skills that pin a weapon type (requiresWeaponTag) opt out of
    // rotation, per the adversarial findings on player agency — and so do
    // BOTH-HANDS skills (requiresStyle dual-*, e.g. Twin Strike): both
    // weapons strike at once, there is no "other hand" to rotate to.
    if (!this.system.tagConfig?.requiresWeaponTag
        && !(this.system.tagConfig?.requiresStyle ?? '').startsWith('dual')
        && ['str_weapon', 'dex_weapon', 'phys_ranged'].includes(this.system.roll?.type ?? '')
        && dualWieldEligible(this.actor)) {
      const last = findCombatantForActor(this.actor)?.flags?.aspectsofpower?.lastSwungHand ?? 'off';
      const pick = last === 'main' ? offHandWeapon(this.actor) : mainHandWeapon(this.actor);
      if (pick) return pick;
    }
    return mainHandWeapon(this.actor);
  }

  /**
   * Canonical weapon weight from weapon-type tag (per design memos), with
   * `system.weight` as a fallback for items that don't carry a known tag.
   * Tag lookup wins because weight is a form descriptor — all greatswords
   * are 200, regardless of tier or how the item was authored.
   *
   * @param {Item} item
   * @returns {number}  Canonical weight, or `system.weight` if no tag matches, or 0.
   */
  static resolveWeaponWeight(item) {
    if (!item) return 0;
    const table = CONFIG.ASPECTSOFPOWER.weaponWeights ?? {};
    const tags = item.system?.tags ?? [];
    // FAMILY HEADS LOSE TO FAMILY MEMBERS (2026-08-21). Crafted items carry
    // both the head tag and the size tag ('shield' + 'greatshield' — a shim
    // for literal-tag readers), and first-match-by-item-tag-order priced
    // Phil's greatshield at 120 for weeks. When a matched tag is a family
    // head and a member of its family also matches, the member wins.
    const families = CONFIG.ASPECTSOFPOWER.weaponTypeFamilies ?? {};
    let match = null;
    for (const tag of tags) {
      if (table[tag] == null) continue;
      const fam = families[tag];
      if (fam && tags.some(t => t !== tag && fam.includes(t) && table[t] != null)) continue;
      match = tag;
      break;
    }
    if (match != null) return table[match];
    return item.system?.weight ?? 0;
  }

  /** Roll types whose "weapon" is a held melee implement — and which therefore
   *  have a meaningful answer when the hands are empty. */
  static UNARMED_CAPABLE_TYPES = new Set(['str_weapon', 'dex_weapon']);

  /**
   * The weight a melee action actually swings at, with EMPTY HANDS RESOLVING
   * TO FISTS rather than to nothing (ruled 2026-08-07).
   *
   * `unarmed` was already a fully specified weapon type — weight 40, reach 5,
   * its own combination entry, its own proficiency fallback — and NOTHING read
   * those numbers for damage or tempo, because `_resolveWeaponForSkill` returns
   * null for empty hands and every consumer gates on weight > 0. The effect was
   * two unrelated penalties on the same character:
   *
   *   DAMAGE — weight 0 dropped the strike to the LEGACY formula, so rarity and
   *            stamina invest did nothing at all. A `rare` unarmed skill hit
   *            exactly as hard as a common one.
   *   TEMPO  — celerity fell back to BASELINE_WEIGHT, which is 100, the SWORD
   *            reference. Fists cost sword time: 1580 ticks against the 632
   *            they should. A 2.5x tax for holding nothing.
   *
   * This bit 184 of 222 actors — the bestiary's default state, not a monk's
   * quirk. Every beast whose natural weapons carry no type tag was on it.
   *
   * ⚠ MELEE ONLY. An archer with no bow must stay on the legacy path: empty
   * hands are a perfectly good club and are not a perfectly good longbow.
   * Magic never reaches here — spells carry tier weight instead.
   *
   * Weight 40 is not a buff dressed as a fix. Under the magic/melee
   * unification DPR is weight-invariant, so 40 buys speed and gives up
   * per-hit — and low per-hit against flat armour walls is exactly the ki
   * monk's intended weakness, the one `kiOnPierce` is built to reward beating.
   *
   * @param {Item|null} skill
   * @param {Item|null} [weapon]  optional pre-resolved weapon
   * @returns {number} weight, or 0 when there is genuinely no weapon concept
   */
  static resolveEffectiveWeaponWeight(skill, weapon = null) {
    const held = weapon ?? skill?._resolveWeaponForSkill?.() ?? null;
    const real = AspectsofPowerItem.resolveWeaponWeight(held);
    if (real > 0) return real;
    const type = skill?.system?.roll?.type ?? '';
    if (!AspectsofPowerItem.UNARMED_CAPABLE_TYPES.has(type)) return 0;
    return CONFIG.ASPECTSOFPOWER.weaponWeights?.unarmed ?? 40;
  }

  /**
   * Resolve a skill's effective multiplier, cost mod, and weight mod
   * from its rarity tag + alteration list. Per design-dmgmod-multiplicative.md:
   *   effective_mult            = max(0, rarityMult × Π(1 + alteration.dmgMod))
   *   cost_mult                 = 1 + Σ alteration.costMod
   *   effective_weight_mult     = 1 + Σ alteration.weightMod
   * Returned for callers to apply to base resource costs and action
   * weight; this method does NOT touch the actor or update anything.
   *
   * @returns {{rarityMult:number, effectiveMult:number, costMultiplier:number, effectiveWeightMultiplier:number}}
   */
  /**
   * COST + WEIGHT ONLY — the cheap half, depending on nothing but the skill's
   * own authored alterations.
   *
   * ⚠ SPLIT OUT 2026-08-06 BECAUSE CELERITY WAS PAYING FOR DAMAGE TERMS.
   * `computeActionWait` / `computeWindupMultiplier` call this for
   * `effectiveWeightMultiplier` alone, but the combined method also resolved
   * weapon proficiency and ran a `calendar.moonState(worldTime)` lookup — so
   * deciding how long a sword swing takes consulted the phase of the moon.
   * Neither term affects weight. Keep it that way: nothing that only needs
   * cost or weight should call `_resolveRarityMods`.
   *
   * @returns {{costMultiplier:number, effectiveWeightMultiplier:number}}
   */
  _resolveCostWeightMods() {
    const sc = CONFIG.ASPECTSOFPOWER;
    let costMod = 0;
    let weightMod = 0;
    for (const alt of this.system.alterations || []) {
      const tag = sc.alterationTags?.[alt.id];
      if (!tag) continue;
      costMod   += tag.costMod   ?? 0;
      weightMod += tag.weightMod ?? 0;
    }
    return { costMultiplier: 1 + costMod, effectiveWeightMultiplier: 1 + weightMod };
  }

  _resolveRarityMods() {
    const sc = CONFIG.ASPECTSOFPOWER;
    const rarity     = this.system.rarity || 'common';
    const rarityMult = sc.skillRarities?.[rarity]?.mult ?? 0.6;
    const alterations = this.system.alterations || [];
    // dmgMod is MULTIPLICATIVE (design-dmgmod-multiplicative.md): effective_mult
    // = rarityMult × Π(1 + dmgMod). A flat additive penalty off the small
    // rarityMult base (0.2–1.2) is disproportionate — a −0.20 is −40% at
    // inferior but −17% at divine, and the grade-up demotion treadmill drives
    // it toward the zero floor. The factor form is a constant percentage at
    // every rarity, demotion-immune, and never zeroes. Anchored at legendary
    // (rarityMult 1.0), where additive and multiplicative coincide.
    // ⚠ dmgMods are COLLECTED here and multiplied by the shared pure function
    // (formulas.alterationDamageFactor) rather than folded in inline, so the
    // skill-upgrade dialog's PREVIEW can call the identical math. It could
    // not before, and had silently kept the pre-`300ce09` additive form.
    const dmgMods = [];
    let costMod = 0;
    let weightMod = 0;
    const altIds = new Set();
    for (const alt of alterations) {
      const tag = sc.alterationTags?.[alt.id];
      if (!tag) continue;
      dmgMods.push(tag.dmgMod ?? 0);
      costMod   += tag.costMod   ?? 0;
      weightMod += tag.weightMod ?? 0;
      altIds.add(alt.id);
    }
    // Tag/flag coupling (design-dmgmod-multiplicative.md): an INTRINSIC aoe/debuff
    // skill pays the same damage penalty as one that spent an upgrade on the
    // alteration. Without this the penalty only reads `alterations` — which no
    // live skill uses — so area/debuff authored directly via the tag dodges its
    // cost. Deduped against altIds so a skill carrying both isn't charged twice.
    // aoe: area costs output (tag OR the legacy aoe.enabled flag). debuff: gated
    // to attack spells so pure-utility debuffs (slow/fear) aren't taxed on damage.
    const skillTags = this.system.tags ?? [];
    if ((skillTags.includes('aoe') || this.system.aoe?.enabled === true) && !altIds.has('aoe')) {
      dmgMods.push(sc.alterationTags?.aoe?.dmgMod ?? 0);
    }
    if (skillTags.includes('debuff') && skillTags.includes('attack') && !altIds.has('debuff')) {
      dmgMods.push(sc.alterationTags?.debuff?.dmgMod ?? 0);
    }
    // SITUATIONAL MODIFIERS — weapon proficiency, lunar phase, and whatever
    // comes next. These used to be two hardcoded named terms right here; they
    // are now a registry (systems/situational-mods.mjs) so adding the next
    // conditional is an entry rather than an edit to the damage core.
    // The attachment point is still this method, which is what the original
    // comment was actually right about: it feeds the plain roll path AND both
    // invest paths, so attaching anywhere else would leave invest unscaled.
    const situational = resolveSituationalMods(this);

    return {
      rarityMult,
      // Which situational effects are LIVE on this roll, [{id, mult}]. Only
      // ones that actually apply appear — the hardcoded version could not
      // express that, because an inapplicable term was an indistinguishable 1.
      situational,
      effectiveMult:             effectiveDamageMultiplier(rarityMult, dmgMods,
                                   situational.map(s => s.mult)),
      costMultiplier:            1 + costMod,
      effectiveWeightMultiplier: 1 + weightMod,
    };
  }


  /**
   * Proficiency damage multiplier for THIS skill, or 1 when it does not apply.
   * Only weapon-flavoured roll types are proficiency-scaled (spells are not),
   * and only when the skill actually deals attack damage.
   * @returns {number}
   */
  _proficiencyDamageMult() {
    const cfg = CONFIG.ASPECTSOFPOWER?.weaponProficiency ?? {};
    if (cfg.enabled === false || !this.actor) return 1;
    const rollTypes = cfg.rollTypes ?? [];
    if (!rollTypes.includes(this.system?.roll?.type)) return 1;
    return proficiencyDamageMult(this.actor, this._proficiencyWeapon()) || 1;
  }

  /**
   * Which weapon should this skill's proficiency be judged against?
   * (RULED 2026-07-29: "It should be based on the weapon you are swinging.")
   *
   * `requiresWeaponTag` wins, because `_resolveWeaponForSkill` deliberately
   * EXCLUDES shields — it exists to find the thing whose weight drives the
   * damage formula, so a shield bash would otherwise be judged against the
   * greatsword on the wielder's back. Shield Bash declares `shield`, so asking
   * the skill what it needs finds the right object.
   *
   * Falls back to the damage-formula weapon, then to null, which lets
   * proficiencyDamageMult use everything held (and resolve empty hands to
   * `unarmed`) exactly as before.
   *
   * @returns {Item|null}
   */
  _proficiencyWeapon() {
    const tag = this.system?.tagConfig?.requiresWeaponTag;
    if (tag) {
      // Family-aware, matching the gate in canUseSkill: a skill that declares
      // `shield` is about whatever shield is in hand, greatshield included.
      const fams = CONFIG.ASPECTSOFPOWER?.weaponTypeFamilies ?? {};
      const family = fams[tag] ?? [tag];
      const match = this.actor.items.find(i => i.type === 'item'
        && i.system?.slot === 'weaponry' && i.system?.equipped === true
        && (i.system?.tags ?? []).some(t => family.includes(t)));
      if (match) return match;
    }
    return this._resolveWeaponForSkill?.() ?? null;
  }

  /**
   * Variable resource-invest dialog. Generic over mana (caster) and stamina
   * (melee/ranged) — same math, different labels and potency stat. Player
   * chooses how much to invest from base up to pool. Past the safe ceiling,
   * invest deals linear self-damage scaled by the potency stat. Per
   * design-skill-rarity-system.md (effect curve `(invested/base)^0.2`,
   * self-damage `excess/safeInvest`).
   *
   * @param {object} args
   * @param {number} args.baseCost     Minimum invest (e.g. base_mana, base_stamina).
   * @param {number} args.safeInvest   Headroom above base before self-damage.
   * @param {number} args.maxPool      Actor's current resource pool.
   * @param {number} args.potency      Damage stat (Int_mod for spells, stat_blend for weapons).
   * @param {number} args.multiplier   Per-skill damage multiplier.
   * @param {string} args.resourceLabel  Lowercase resource label ("mana", "stamina").
   * @param {string} args.potencyLabel   Display label for the potency stat ("Int", "Str/Dex blend", etc.).
   * @param {string} args.label        Skill name for dialog title.
   * @param {number} [args.windup]     Weapon windup multiplier (weight×mult/100).
   *                                   1 for spells, which have no windup term.
   * @param {number} [args.truePool]   The actor's ACTUAL resource pool, when
   *                                   `maxPool` is a lower slider ceiling.
   * @param {number} [args.flatBonus]  Flat damage added after the curve (weapon
   *                                   buffs), so the preview totals what lands.
   * @returns {Promise<number|null>}   Selected invest amount, or null on cancel.
   */
  async _promptResourceInvest({ baseCost, safeInvest, maxPool, potency, multiplier, resourceLabel, potencyLabel, label, channelStat = null, channelFactor = null, hardCap = false, damageRef = null, windup = 1, truePool = null, flatBonus = 0 }) {
    const safeCeiling = baseCost + safeInvest;
    const startInvest = baseCost;
    // Damage curve: potency × multiplier × windup × (invested/ref)^0.2 — very
    // flat, invest is a small lever. Self-damage: linear in excess/safeInvest.
    // `damageRef` overrides the denominator so this preview matches the actual
    // roll: spells normalize by a fixed grade-relative ref (spellDamageRef — the 65f8a42 tier fix), not
    // their own baseMana; weapons pass none and keep baseCost.
    //
    // WINDUP (2026-07-30): the preview called spellInvestDamage on BOTH paths,
    // which has no weapon-weight term — so a dagger previewed 501 for a swing
    // that dealt 300 (1.67× over) and a greataxe under-read by the inverse.
    // This is now literally the function the strike path calls, with windup 1
    // for spells (mathematically identical to the old spellInvestDamage call).
    // Code standard 2: a dialog preview and its real path MUST call the same
    // function — see [[playbook-damage-measurement]].
    const dmgRef = Math.max(1, damageRef ?? baseCost);
    const computeDmg = (v) => strikeInvestDamage(potency, multiplier, windup, v, dmgRef)
      + Math.max(0, Math.round(flatBonus));
    const computeSelfDmg = (v) => computeInvestSelfDamage(potency, v, baseCost, safeInvest);
    // Channel time for spell invest — Wis_mod controls rate per design memo.
    const computeChannelTime = (channelStat && channelFactor)
      ? (v) => Math.round(v * channelFactor / Math.max(1, channelStat))
      : null;

    const channelRow = computeChannelTime ? `
          <div class="channel-row" style="grid-column:1 / -1;color:#9cf;">
            Channel time: <strong class="channel-display">${computeChannelTime(startInvest)}</strong> ticks
            <span style="font-size:11px;color:#888;"> (added to celerity wait)</span>
          </div>` : '';

    const ceilingLabel = hardCap ? 'Max invest' : 'Safe ceiling';
    const ceilingValue = hardCap ? maxPool : safeCeiling;
    // `maxPool` is the SLIDER ceiling, not the pool — the weapon path clamps it
    // so worst-case self-damage can't exceed current HP, which made a 400-stamina
    // rogue read "Pool: 14". Show the real pool, and the cap separately when the
    // two differ.
    const shownPool = Math.round(truePool ?? maxPool);
    const sliderCapRow = (!hardCap && shownPool !== maxPool)
      ? `<div>Max invest: <strong>${maxPool}</strong> <span style="font-size:11px;color:#888;">(self-damage cap)</span></div>`
      : '';
    const windupCell = (windup !== 1)
      ? `<div>Windup: <strong>${windup.toFixed(2)}×</strong></div>` : '';
    const flatRow = (flatBonus > 0)
      ? `<div>Weapon buff: <strong>+${Math.round(flatBonus)}</strong></div>` : '';
    const selfDmgRow = hardCap ? '' : `
          <div class="self-dmg-row" style="grid-column:1 / -1;">
            Self-damage: <strong class="self-dmg-display">${computeSelfDmg(startInvest)}</strong>
            <span class="self-dmg-hint" style="font-size:11px;color:#888;"> (over-invest past safe ceiling)</span>
          </div>`;
    const content = `
      <div class="resource-invest">
        <div class="invest-meta" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:12px;">
          <div>Base ${resourceLabel}: <strong>${baseCost}</strong></div>
          <div>${ceilingLabel}: <strong>${ceilingValue}</strong></div>
          <div>Pool: <strong>${shownPool}</strong></div>
          ${sliderCapRow}
          <div>${potencyLabel} × Mult: <strong>${potency} × ${multiplier}</strong></div>
          ${windupCell}
          ${flatRow}
        </div>
        <div class="form-group">
          <label>Invest: <span class="invest-display">${startInvest}</span> ${resourceLabel}</label>
          <input type="range" name="invest" min="${baseCost}" max="${maxPool}" value="${startInvest}" step="1" style="width:100%;" />
        </div>
        <div class="invest-readouts" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">
          <div>Predicted damage: <strong class="dmg-display">${computeDmg(startInvest)}</strong></div>
          <div>Pool after: <strong class="remaining-display">${shownPool - startInvest}</strong></div>
          ${channelRow}
          ${selfDmgRow}
        </div>
        <p class="hint" style="font-size:11px;margin-top:8px;">Damage = ${potencyLabel} × multiplier${windup !== 1 ? ' × windup' : ''} × (invested/base)^0.2.${computeChannelTime ? ' Channel time scales with invest / Wis.' : ''}${hardCap ? '' : ` Excess past safe ceiling deals ${potencyLabel} × (excess/safe) self-damage.`}</p>
      </div>`;

    // DialogV2.wait with a `render` hook, not a hand-rolled promise: the static
    // helper is the one seam a headless test can stub, so every dialog in the
    // system goes through it. (This one in particular is why "firing a
    // variable-invest skill headlessly hangs on the invest dialog" was a
    // standing workaround — nothing could intercept it.)
    return foundry.applications.api.DialogV2.wait({
      window: { title: `${label} — ${resourceLabel.charAt(0).toUpperCase() + resourceLabel.slice(1)} Investment` },
      content,
      buttons: [
        {
          action: 'confirm',
          label: 'Use',
          default: true,
          callback: (event, button) => {
            const val = parseInt(button.form.elements.invest?.value, 10);
            return Math.min(Math.max(baseCost, val || baseCost), maxPool);
          },
        },
        { action: 'cancel', label: 'Cancel', callback: () => null },
      ],
      close: () => null,
      // Live readout wiring, once the dialog has mounted.
      render: (event, dialog) => {
        const root = dialog?.element ?? dialog;
        if (!root) return;
        const slider = root.querySelector('input[name="invest"]');
        const investDisplay = root.querySelector('.invest-display');
        const dmgDisplay = root.querySelector('.dmg-display');
        const selfDmgDisplay = root.querySelector('.self-dmg-display');
        const selfDmgRowEl = root.querySelector('.self-dmg-row');
        const remainingDisplay = root.querySelector('.remaining-display');
        const channelDisplay = root.querySelector('.channel-display');
        if (!slider) return;
        slider.addEventListener('input', () => {
          const v = parseInt(slider.value, 10);
          const dmg = computeDmg(v);
          investDisplay.textContent = v;
          dmgDisplay.textContent = dmg;
          remainingDisplay.textContent = shownPool - v;
          if (channelDisplay && computeChannelTime) channelDisplay.textContent = computeChannelTime(v);
          if (selfDmgDisplay && selfDmgRowEl) {
            const selfDmg = computeSelfDmg(v);
            selfDmgDisplay.textContent = selfDmg;
            selfDmgRowEl.style.color = selfDmg > 0 ? '#c33' : '';
            selfDmgRowEl.style.fontWeight = selfDmg > 0 ? 'bold' : '';
          }
        });
      },
    });
  }

  /**
   * Two-slider invest dialog: the skill's PRIMARY resource plus one CO-INVEST
   * pool (systems/co-invest.mjs — `infused` mana, `effort` stamina,
   * `life-drain` health).
   *
   * Generalised 2026-08-10. It used to take parameters literally named
   * `stamina` and `mana`, which is why the one-tag-per-resource ruling could
   * be recorded but never used. Both sides are now described by the caller, so
   * this serves the weapon path (stamina primary) and the spell path (mana or
   * health primary) with the same code.
   *
   *   primary = potency × multiplier × windup × (invest / damageRef)^curve
   *   co      = potency × coef       ×          (invest / dmgRef)^curve
   *
   * Only the primary carries a safe ceiling and over-invest self-damage, and
   * only when the caller supplies a `safeInvest` band — a spell's hard wis-cap
   * passes 0 and the row disappears.
   *
   * @returns {Promise<{primary:number, co:number}|null>}
   */
  async _promptCoInvest({ primary, co, multiplier, label, potencyLabel, channelStat = null, channelFactor = null, baseWait = 0, windup = 1, flatBonus = 0 }) {
    const safeCeiling = primary.baseCost + primary.safeInvest;
    const hasSafeBand = primary.safeInvest > 0;
    const startPrimary = primary.baseCost;
    const startCo = co.baseCost;
    const pLabel = primary.resourceLabel ?? 'primary';
    const cLabel = co.resource;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // Windup was hardcoded to 1 here once, the same preview-drift bug as the
    // single dialog — an infused strike is still a weapon swing and carries
    // the weight term (2026-07-30, [[playbook-damage-measurement]]).
    const _flat = Math.max(0, Math.round(flatBonus));
    // Both previews call the SAME helpers the real paths call. That is the one
    // non-negotiable rule in this file (8de305b).
    const computePrimary = (v) => strikeInvestDamage(primary.potency, multiplier, windup, v, Math.max(primary.damageRef ?? primary.baseCost, 1)) + _flat;
    const computeCo = (v) => coInvestDamage(co.potency, co.coef, v, co.dmgRef);
    const computeSelfDmg = (v) => computeInvestSelfDamage(primary.potency, v, primary.baseCost, primary.safeInvest);
    // Channel time on a MANA co-invest only — Wis controls the rate, mirroring
    // the spell path so heavy infusion adds the same celerity wait penalty as
    // channelling a spell of equivalent mana cost. Physical exertion and blood
    // are not channelled, so those riders pass no channelStat.
    const computeChannel = (channelStat && channelFactor)
      ? (v) => Math.round(v * channelFactor / Math.max(1, channelStat))
      : null;

    const content = `
      <div class="resource-invest dual-resource">
        <div class="invest-meta" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:12px;">
          <div>Base (${pLabel}): <strong>${primary.baseCost}</strong></div>
          <div>${co.label} base (${cLabel}): <strong>${co.baseCost}</strong></div>
          <div>${potencyLabel} × Mult: <strong>${primary.potency} × ${multiplier}</strong></div>
          <div>${co.potencyLabel} mod: <strong>${co.potency}</strong></div>
          ${windup !== 1 ? `<div>Windup: <strong>${windup.toFixed(2)}×</strong></div>` : ''}
          ${_flat > 0 ? `<div>Weapon buff: <strong>+${_flat}</strong></div>` : ''}
        </div>

        <div class="form-group" style="margin-top:6px;">
          <label>${cap(cLabel)} invest: <span class="co-display">${startCo}</span> / pool ${co.maxPool}</label>
          <input type="range" name="co" min="${co.baseCost}" max="${co.maxPool}" value="${startCo}" step="1" style="width:100%;" />
          <div style="font-size:11px;color:#9cf;">${co.label} damage: <strong class="co-dmg-display">${computeCo(startCo)}</strong></div>
          ${computeChannel ? `<div class="channel-row" style="font-size:11px;color:#fc6;display:${computeChannel(startCo) > baseWait ? 'block' : 'none'};">Channel time: <strong class="channel-display">${computeChannel(startCo)}</strong> ticks <span style="font-size:11px;color:#888;">(exceeds base wait ${baseWait} — celerity wait increases)</span></div>` : ''}
        </div>

        <div class="form-group" style="margin-top:10px;">
          <label>${cap(pLabel)} invest: <span class="primary-display">${startPrimary}</span> / pool ${primary.maxPool}</label>
          <input type="range" name="primary" min="${primary.baseCost}" max="${primary.maxPool}" value="${startPrimary}" step="1" style="width:100%;" />
          <div style="font-size:11px;color:#9cf;">${primary.damageLabel ?? 'Strike'} damage: <strong class="primary-dmg-display">${computePrimary(startPrimary)}</strong></div>
          ${hasSafeBand ? `<div class="self-dmg-row" style="font-size:11px;color:#888;">Self-damage: <strong class="self-dmg-display">${computeSelfDmg(startPrimary)}</strong> <span style="font-size:11px;color:#888;">(over-invest past safe ceiling ${safeCeiling})</span></div>` : ''}
        </div>

        <div class="invest-readouts" style="display:grid;grid-template-columns:1fr;gap:4px;margin-top:10px;border-top:1px solid #444;padding-top:6px;">
          <div style="font-size:14px;">Total damage: <strong class="total-display">${computePrimary(startPrimary) + computeCo(startCo)}</strong></div>
        </div>

        <p class="hint" style="font-size:11px;margin-top:8px;">${primary.damageLabel ?? 'Strike'} = ${potencyLabel} × multiplier${windup !== 1 ? ' × windup' : ''} × (${pLabel}/base)^curve. ${co.label} = ${co.potencyLabel} × ${co.coef} × (${cLabel}/ref)^curve, capped by wisdom like a spell of this tier.${hasSafeBand ? ` ${cap(pLabel)} excess past the safe ceiling deals self-damage;` : ''} ${cLabel} has no self-damage${cLabel === 'health' ? ' beyond the cost itself' : ''}.</p>
      </div>`;

    // Same uniformity rule as the single-resource invest above: static helper
    // + `render` hook, so one stub can drive every dialog in the system.
    return foundry.applications.api.DialogV2.wait({
      window: { title: `${label} — ${co.label} (${cap(pLabel)} + ${cap(cLabel)})` },
      content,
      buttons: [
        {
          action: 'confirm',
          label: 'Use',
          default: true,
          callback: (event, button) => {
            const pv = parseInt(button.form.elements.primary?.value, 10);
            const cv = parseInt(button.form.elements.co?.value, 10);
            const pClamped = Math.min(Math.max(primary.baseCost, pv || primary.baseCost), primary.maxPool);
            const cClamped = Math.min(Math.max(co.baseCost,      cv || co.baseCost),      co.maxPool);
            return { primary: pClamped, co: cClamped };
          },
        },
        { action: 'cancel', label: 'Cancel', callback: () => null },
      ],
      close: () => null,
      render: (event, dialog) => {
        const root = dialog?.element ?? dialog;
        if (!root) return;
        const coSlider      = root.querySelector('input[name="co"]');
        const primarySlider = root.querySelector('input[name="primary"]');
        const coDisplay      = root.querySelector('.co-display');
        const primaryDisplay = root.querySelector('.primary-display');
        const primaryDmgDisplay = root.querySelector('.primary-dmg-display');
        const coDmgDisplay      = root.querySelector('.co-dmg-display');
        const totalDisplay      = root.querySelector('.total-display');
        const selfDmgDisplay    = root.querySelector('.self-dmg-display');
        const selfDmgRowEl      = root.querySelector('.self-dmg-row');

        const refreshTotal = () => {
          const pv = parseInt(primarySlider?.value, 10) || primary.baseCost;
          const cv = parseInt(coSlider?.value, 10) || co.baseCost;
          totalDisplay.textContent = computePrimary(pv) + computeCo(cv);
        };
        const channelDisplay = root.querySelector('.channel-display');
        const channelRowEl = root.querySelector('.channel-row');
        if (coSlider) {
          coSlider.addEventListener('input', () => {
            const v = parseInt(coSlider.value, 10);
            coDisplay.textContent = v;
            coDmgDisplay.textContent = computeCo(v);
            if (channelDisplay && computeChannel) {
              const ch = computeChannel(v);
              channelDisplay.textContent = ch;
              // Only surface the channel-time row when it would actually push the
              // celerity wait past the strike's base wait — otherwise it's noise.
              if (channelRowEl) channelRowEl.style.display = (ch > baseWait) ? 'block' : 'none';
            }
            refreshTotal();
          });
        }
        if (primarySlider) {
          primarySlider.addEventListener('input', () => {
            const v = parseInt(primarySlider.value, 10);
            primaryDisplay.textContent = v;
            primaryDmgDisplay.textContent = computePrimary(v);
            if (selfDmgDisplay && selfDmgRowEl) {
              const selfDmg = computeSelfDmg(v);
              selfDmgDisplay.textContent = selfDmg;
              selfDmgRowEl.style.color = selfDmg > 0 ? '#c33' : '#888';
              selfDmgRowEl.style.fontWeight = selfDmg > 0 ? 'bold' : '';
            }
            refreshTotal();
          });
        }

      },
    });
  }

  /**
   * Invest dialog for an `invest`-tagged RIDER proc (Hemorrhage, Armor Crush).
   *
   * A rider without the tag gets a flat cost and a yes/no prompt. With it, the
   * cost becomes the FLOOR of a slider and the effect's magnitude scales
   * linearly off what is actually committed — "how hard do you tear the wound
   * open". Cancel/close still declines the proc entirely, so the skip option
   * the flat prompt provided is preserved.
   *
   * @returns {Promise<number|null>} stamina to commit, or null to decline.
   */
  async _promptRiderInvest({ riderItem, parentName, targetName, baseCost, maxInvest, pool }) {
    const tc = riderItem.system?.tagConfig ?? {};
    const hasDot   = (tc.debuffDealsDamage ?? false) || (riderItem.system.tags ?? []).includes('shred');
    const dotScale = tc.dotInvestScale ?? 1.0;
    const crushOn  = ((riderItem.system.tags ?? []).includes('crush'))
                  || ((tc.debuffArmorCrush ?? 0) > 0);
    const crushScale = tc.crushInvestScale ?? 1.0;
    const dotAt   = (v) => Math.max(0, Math.round(dotScale * v));
    const crushAt = (v) => Math.max(0, Math.round(crushScale * v));

    const readouts = [
      hasDot  ? `<div>Damage per round: <strong class="rider-dot">${dotAt(baseCost)}</strong></div>` : '',
      crushOn ? `<div>Armour removed: <strong class="rider-crush">${crushAt(baseCost)}</strong></div>` : '',
    ].filter(Boolean).join('');

    const content = `
      <div class="resource-invest rider-invest">
        <p style="margin:0 0 6px;">${parentName} pierced <strong>${targetName}</strong>.</p>
        <div class="invest-meta" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:12px;">
          <div>Base cost: <strong>${baseCost}</strong></div>
          <div>Max invest: <strong>${maxInvest}</strong></div>
          <div>Stamina: <strong>${pool}</strong></div>
        </div>
        <div class="form-group">
          <label>Invest: <span class="invest-display">${baseCost}</span> stamina</label>
          <input type="range" name="invest" min="${baseCost}" max="${maxInvest}" value="${baseCost}" step="1" style="width:100%;" />
        </div>
        <div class="invest-readouts" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">
          ${readouts}
          <div>Stamina after: <strong class="remaining-display">${pool - baseCost}</strong></div>
        </div>
        <p class="hint" style="font-size:11px;margin-top:8px;">Scales linearly with what you commit. Cancel to let the wound close.</p>
      </div>`;

    return foundry.applications.api.DialogV2.wait({
      window: { title: `${riderItem.name}` },
      content,
      buttons: [
        {
          action: 'confirm',
          label: 'Apply',
          default: true,
          callback: (event, button) => {
            const v = parseInt(button.form.elements.invest?.value, 10);
            return Math.min(Math.max(baseCost, v || baseCost), maxInvest);
          },
        },
        { action: 'cancel', label: 'Skip', callback: () => null },
      ],
      close: () => null,
      render: (event, dialog) => {
        const root = dialog?.element ?? dialog;
        const slider = root?.querySelector('input[name="invest"]');
        if (!slider) return;
        const investDisplay = root.querySelector('.invest-display');
        const dotDisplay    = root.querySelector('.rider-dot');
        const crushDisplay  = root.querySelector('.rider-crush');
        const remaining     = root.querySelector('.remaining-display');
        slider.addEventListener('input', () => {
          const v = parseInt(slider.value, 10);
          investDisplay.textContent = v;
          if (dotDisplay)   dotDisplay.textContent   = dotAt(v);
          if (crushDisplay) crushDisplay.textContent = crushAt(v);
          remaining.textContent = pool - v;
        });
      },
    });
  }

  /**
   * BRACED PARRY invest prompt (`braced` tag, RULED 2026-07-31). Stamina buys
   * EFFECTIVE weapon weight for the mass ratio only. The slider's ceiling is
   * the exact point that reaches PARITY with the attacker's weapon — past that
   * `parryMassMultiplier`'s min(1, …) cap makes further stamina worthless, so
   * the dialog never offers a wasted point.
   *
   * Returns the stamina to spend, or null if declined (an ordinary free parry).
   */
  async _promptBracedInvest({ skillName, weapon, defWeight, atkWeight, hitTotal, pool, scale }) {
    const maxInvest = bracedMaxUsefulInvest(defWeight, atkWeight, hitTotal, pool, scale);
    if (maxInvest <= 0) return null;   // already out-massing — nothing to buy
    const at = (v) => {
      const w = bracedParryWeight(defWeight, v, hitTotal, scale);
      return { w: Math.round(w), m: parryMassMultiplier(w, atkWeight) };
    };
    const start = at(0), best = at(maxInvest);
    const content = `
      <div class="resource-invest braced-invest">
        <p style="margin:0 0 6px;">Bracing <strong>${skillName}</strong>${weapon ? ` (${weapon})` : ''}
          against a heavier weapon.</p>
        <div class="invest-meta" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:12px;">
          <div>Your weapon: <strong>${defWeight}</strong></div>
          <div>Theirs: <strong>${atkWeight}</strong></div>
          <div>Stamina: <strong>${pool}</strong></div>
          <div>To parity: <strong>${maxInvest}</strong></div>
        </div>
        <div class="form-group">
          <label>Brace: <span class="invest-display">0</span> stamina</label>
          <input type="range" name="invest" min="0" max="${maxInvest}" value="0" step="1" style="width:100%;" />
        </div>
        <div class="invest-readouts" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">
          <div>Effective weight: <strong class="braced-weight">${start.w}</strong></div>
          <div>Parry scale: <strong class="braced-mass">x${start.m.toFixed(2)}</strong></div>
          <div>Stamina after: <strong class="remaining-display">${pool}</strong></div>
        </div>
        <p class="hint" style="font-size:11px;margin-top:8px;">Full brace reaches x${best.m.toFixed(2)} — being
          outmassed is a penalty, out-massing is never a bonus, so the slider stops where it stops helping.
          Bracing costs nothing but stamina; leave it at 0 for an ordinary parry.</p>
      </div>`;
    return foundry.applications.api.DialogV2.wait({
      window: { title: `${skillName} — Brace` },
      content,
      buttons: [
        {
          action: 'confirm', label: 'Parry', default: true,
          callback: (event, button) => {
            const v = parseInt(button.form.elements.invest?.value, 10);
            return Math.min(Math.max(0, v || 0), maxInvest);
          },
        },
        { action: 'none', label: 'Parry Unbraced', callback: () => 0 },
      ],
      close: () => null,
      render: (event, dialog) => {
        const root = dialog?.element ?? dialog;
        const slider = root?.querySelector('input[name="invest"]');
        if (!slider) return;
        const invD = root.querySelector('.invest-display');
        const wD   = root.querySelector('.braced-weight');
        const mD   = root.querySelector('.braced-mass');
        const remD = root.querySelector('.remaining-display');
        slider.addEventListener('input', () => {
          const v = parseInt(slider.value, 10) || 0;
          const r = at(v);
          invD.textContent = v;
          wD.textContent = r.w;
          mD.textContent = 'x' + r.m.toFixed(2);
          remD.textContent = pool - v;
        });
      },
    });
  }

  /**
   * @param {object} rollData
   * @param {object} [opts]
   * @param {boolean} [opts.applyRarityMult]  Multiply damage by the skill's
   *   effectiveMult (rarity x dmgMods). OPT-IN because this same builder feeds
   *   the crafting refine/prep rolls, where a rarity multiplier would silently
   *   re-tune crafting output. Combat dispatch sites that never reach the
   *   invest path (on-death, chained riders, detonated summons) pass true;
   *   they were the only paths where a skill's rarity did nothing.
   */
  _buildRollFormulas(rollData, { applyRarityMult = false } = {}) {
    const A   = this.actor.system.abilities;
    // Pure (default): primary ability mod at full weight; hybrid blends
    // primary + secondary at configured weights — helpers/formulas.mjs.
    const ab = hybridAbilityMod(A, rollData.roll);
    // diceBonus null/undefined produces a `* null` term in the dmg formula
    // → Foundry parses as StringTerm("null") → "Unresolved StringTerm null"
    // crash on roll evaluation. Default to 1 (the schema initial), matching
    // the dice fallback below. Old skills with null diceBonus stop crashing.
    const dbRaw = rollData.roll.diceBonus ?? 1;
    // Same precedence the invest paths use: an explicit diceBonus wins,
    // otherwise the rarity-derived effective multiplier.
    const dbBase = (applyRarityMult && (!dbRaw || dbRaw === 1))
      ? (this._resolveRarityMods?.()?.effectiveMult ?? dbRaw)
      : dbRaw;
    // Weapon proficiency applies EITHER WAY. effectiveMult already carries it,
    // but an explicit diceBonus bypasses effectiveMult entirely — so without
    // this a skill could opt out of proficiency scaling just by authoring a
    // diceBonus, which is exactly the sort of silent exemption a content author
    // would never notice. Multiplied on top of the authored value instead.
    const db = (applyRarityMult && dbRaw && dbRaw !== 1)
      ? dbBase * this._proficiencyDamageMult()
      : dbBase;
    const dic = rollData.roll.dice || '0';
    const typ = rollData.roll.type;

    rollData.roll.abilitymod    = ab;
    rollData.roll.resourcevalue = this.actor.system[rollData.roll.resource]?.value ?? 0;

    let hitFormula, dmgFormula;

    if (typ === 'dex_weapon') {
      const m = `${A.dexterity.mod}*(9/10)+${A.strength.mod}*(3/10)`;
      hitFormula = houseHitFormula(m);
      dmgFormula = `(((${dic}/50*(${A.strength.mod}*(9/10)+${A.dexterity.mod}*(3/10)))+${A.strength.mod}+${A.dexterity.mod}*(3/10))*${db})`;

    } else if (typ === 'str_weapon') {
      const m = `${A.strength.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = houseHitFormula(m);
      dmgFormula = `((${dic}/50*(${A.strength.mod})+${A.strength.mod}+${A.strength.mod}*(3/10))*${db})`;

    } else if (typ === 'phys_ranged') {
      const m = `${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = houseHitFormula(m);
      dmgFormula = `(((${dic}/50*(${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10)))+${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10))*${db})`;

    } else if (typ === 'magic_projectile') {
      const m = `${A.intelligence.mod}*(9/10)+${A.perception.mod}*(3/10)`;
      hitFormula = houseHitFormula(m);
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;

    } else if (typ === 'magic_melee') {
      const m = `${A.intelligence.mod}*(9/10)+${A.strength.mod}*(3/10)`;
      hitFormula = houseHitFormula(m);
      dmgFormula = `(((${dic}/50*(${m}))+(${m}))*${db})`;

    } else if (typ === 'magic') {
      const m = `${A.intelligence.mod}`;
      hitFormula = houseHitFormula(m);
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;

    } else if (typ === 'wisdom_dexterity') {
      const m = `${A.wisdom.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = houseHitFormula(m);
      dmgFormula = `(((${dic}/50*(${m}))+(${m}))*${db})`;

    } else {
      // Generic fallback: no separate to-hit roll, just the damage formula.
      hitFormula = null;
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;
    }

    // Augment-sourced flat damage bonus from equipped items (Sharpness, the
    // 6 elemental affinity-binding augments, etc.). Aggregated on the actor
    // by prepareDerivedData into system.equippedDamageBonus. Adds after the
    // multiplier so the bonus is genuinely flat — doesn't scale with crit
    // multipliers or invest sliders.
    const equippedDmgBonus = this.actor.system.equippedDamageBonus ?? 0;
    if (equippedDmgBonus !== 0) {
      dmgFormula = `(${dmgFormula} + ${equippedDmgBonus})`;
    }

    return { hitFormula, dmgFormula };
  }

  /**
   * Spellstrike accuracy (ruled 2026-07-03): a `spellstrike` skill hits with
   * the WIELDED WEAPON, not its casting stat — the spell discharges on the
   * weapon's hit. Returns a hit formula built from the weapon's weight-based
   * stat blend (light weapons → Dex-leaning, heavy → Str-leaning; ranged
   * weapons → Dex/Per), reusing the same `meleeBlend`/`rangedBlend` config the
   * weapon DAMAGE path uses so accuracy tracks "the weapon he uses" with no
   * per-skill authoring. Returns null when no weapon is wielded (caller keeps
   * the casting-stat fallback + warns). Bare-fist-as-weapon is the future
   * proper answer to the no-weapon case.
   *
   * @returns {string|null} hit formula, or null if no weapon wielded.
   */
  _resolveSpellstrikeHitFormula() {
    if (!this.actor) return null;
    const weapon = this._resolveWeaponForSkill();
    if (!weapon) return null;
    const weight = AspectsofPowerItem.resolveWeaponWeight(weapon);
    const A = this.actor.system.abilities;
    // NOTE: ranged here classifies by weapon TAG while the damage path
    // classifies by roll.type === 'phys_ranged' — a known inconsistency
    // (audit 2026-07-03 bug 2.10), preserved as-is pending a ruling.
    const RANGED = new Set(['pistol', 'shortbow', 'bow', 'crossbow', 'shotgun', 'longbow', 'rifle']);
    const isRanged = (weapon.system?.tags ?? []).some(t => RANGED.has(t));
    const { blend } = weaponStatBlend(weight, {
      str: A.strength?.mod ?? 0, dex: A.dexterity?.mod ?? 0, per: A.perception?.mod ?? 0,
    }, isRanged);
    return houseHitFormula(String(Math.max(0, blend)));
  }

  /* ------------------------------------------------------------------ */
  /*  Tag handlers                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Resolve a single defense check (pool + reaction prompt) for one defKey
   * against one target. Extracted so dual-defense skills can run it twice.
   *
   * Returns: { isHit, damageMultiplier, defenseLine, reactionLine }
   *   - isHit: true unless the defense fully dodged or a reaction nullified
   *   - damageMultiplier: 1.0 = full damage, <1.0 = partial defense reduction
   *   - defenseLine, reactionLine: HTML fragments for the chat result block
   */
  /**
   * Reactive choice prompt for non-`self_attacked` triggers (Phase D).
   * Filters reactor's Reaction-skillType skills by trigger + cooldown +
   * budget + resource cost, then routes the choice to the reactor's owner
   * via the existing `defensePrompt` socket flow (no defense-pool option).
   *
   * Returns the chosen reaction skill ID (string) or null on decline /
   * timeout / no candidates.
   */
  /**
   * Classify an attacking skill (or raw roll.type string) as melee / ranged /
   * any. Used by the reactionAttackType filter to skip reactions whose filter
   * doesn't match the incoming attack.
   *
   * Tags `melee` / `ranged` on the skill override the roll.type heuristic.
   * roll.type str_weapon / dex_weapon / magic_melee → melee. Everything else
   * with a non-empty roll.type → ranged. Empty / unknown → 'any'.
   *
   * @param {Item|string|null} skillOrType
   * @returns {'melee'|'ranged'|'any'}
   */
  static _classifyAttackType(skillOrType) {
    if (!skillOrType) return 'any';
    let rollType = '';
    let tags = [];
    if (typeof skillOrType === 'string') {
      rollType = skillOrType;
    } else {
      rollType = skillOrType.system?.roll?.type ?? '';
      tags = skillOrType.system?.tags ?? [];
    }
    if (tags.includes('melee')) return 'melee';
    if (tags.includes('ranged')) return 'ranged';
    const MELEE_TYPES = new Set(['str_weapon', 'dex_weapon', 'magic_melee']);
    if (MELEE_TYPES.has(rollType)) return 'melee';
    if (rollType) return 'ranged';
    return 'any';
  }

  /**
   * Returns true if a reaction skill's `reactionAttackType` filter matches
   * the incoming attack. `any` matches anything; `melee`/`ranged` match only
   * their own classification. Reactions filtered for melee will not fire
   * against ranged attackers, and vice versa.
   */
  static _reactionMatchesAttackType(reactionSkill, attackerType) {
    const filter = reactionSkill.system?.tagConfig?.reactionAttackType ?? 'any';
    if (filter === 'any') return true;
    return filter === attackerType;
  }

  /**
   * Classify a skill's AOE context for Phase F dispatch routing.
   *   'not-aoe'         — single-target attack, normal pipeline
   *   'aoe-shrapnel'    — AOE with `shrapnel` tag; uses ranged-attack
   *                       pipeline (per design-aoe-dispatch.md). Dodge/
   *                       parry/barrier can apply.
   *   'aoe-mental'      — AOE debuff targeting mind/soul defense; uses
   *                       ablative pool depletion (already handled in
   *                       persistent-region behavior, but flagged here
   *                       for routing distinctness).
   *   'aoe-volumetric'  — AOE attack with no shrapnel or mental subtype.
   *                       Bypasses physical defense pools — "you can't
   *                       dodge gas." Dodge/parry/barrier reactions skip.
   *                       Per the design memo, this is the default AOE
   *                       case unless tagged otherwise.
   */
  static _classifyAoeContext(skill) {
    if (!skill) return 'not-aoe';
    const sys = skill.system ?? {};
    const tags = sys.tags ?? [];
    const isAoe = sys.aoe?.enabled === true
                || tags.includes('aoe')
                || (sys.alterations ?? []).some(a => (a.id ?? a) === 'aoe');
    if (!isAoe) return 'not-aoe';
    if (tags.includes('shrapnel')) return 'aoe-shrapnel';
    const def = sys.roll?.targetDefense;
    if (def === 'mind' || def === 'soul') return 'aoe-mental';
    return 'aoe-volumetric';
  }

  async _promptReactiveChoice(reactorActor, triggerKey, ctx) {
    if (!reactorActor) return null;
    const reactions = reactorActor.system.reactions ?? { value: 0, max: 1 };
    if (reactions.value <= 0) return null;
    // Cooldown entries: skillId → roundsRemaining. Decremented at onStartTurn.
    // Entry present with > 0 = on cooldown. No entry = ready.
    const cooldowns = reactorActor.flags?.aspectsofpower?.reactionCooldowns ?? {};
    // Classify the attacker once for the attack-type filter (melee/ranged/any).
    // ctx.attackerSkill carries the originating attack item when available.
    const attackerType = this.constructor._classifyAttackType(ctx?.attackerSkill ?? this);
    const candidates = reactorActor.items.filter(s => {
      if (s.type !== 'skill' || s.system.skillType !== 'Reaction') return false;
      const trig = s.system.tagConfig?.reactionTrigger ?? '';
      if (trig !== triggerKey) return false; // strict match — no legacy fallback for non-self_attacked
      if ((cooldowns[s.id] ?? 0) > 0) return false;
      if (!this.constructor._reactionMatchesAttackType(s, attackerType)) return false;
      const resKey = s.system.roll?.resource;
      const cost = s.system.roll?.cost ?? 0;
      if (resKey && cost > 0) {
        const have = reactorActor.system[resKey]?.value ?? 0;
        if (have < cost) return false;
      }
      // Authored stance requirement (Shield Wall cover, ruled 2026-08-21:
      // "stance required unless a skill exists to remove that requirement").
      if (s.system.tagConfig?.requiresGuardStance === true
          && (CONFIG.ASPECTSOFPOWER.guardStance?.enabled ?? true)) {
        const _rCbt = findCombatantForActor(reactorActor);
        if (_rCbt && !_rCbt.flags?.aspectsofpower?.guardStance) return false;
      }
      return true;
    });
    if (candidates.length === 0) return null;

    const reactionList = candidates.map(s => ({
      id: s.id, name: s.name, img: s.img,
      reactionType: s.system.reactionType ?? 'dodge',
      available: true,
    }));
    const promptContent = ctx?.promptText ?? `<p>Reactive trigger: ${triggerKey}</p>`;

    const characterOwner = game.users.find(u =>
      u.active && !u.isGM && u.character?.id === reactorActor.id
    );
    const playerOwner = characterOwner?.id ?? null;

    let result = { reactionSkillId: null };
    if (playerOwner) {
      const requestId = foundry.utils.randomID();
      result = await new Promise((resolve) => {
        const timeout = setTimeout(() => { cleanup(); resolve({ reactionSkillId: null }); }, 30000);
        const handler = (response) => {
          if (response.type !== 'defensePromptResponse' || response.requestId !== requestId) return;
          cleanup();
          resolve({ reactionSkillId: response.reactionSkillId ?? null });
        };
        const cleanup = () => {
          clearTimeout(timeout);
          game.socket.off('system.aspects-of-power', handler);
        };
        game.socket.on('system.aspects-of-power', handler);
        game.socket.emit('system.aspects-of-power', {
          type: 'defensePrompt',
          targetUserId: playerOwner,
          targetName: reactorActor.name,
          promptContent,
          requestId,
          hasPool: false,
          reactionSkills: reactionList,
        });
      });
    } else if (game.user.isGM) {
      result = await this._showDefenseDialog(reactorActor.name, promptContent, false, reactionList);
    }
    return result.reactionSkillId ?? null;
  }

  /**
   * Fire a chosen reactive skill with budget + cooldown bookkeeping.
   * Used by Phase D triggers after `_promptReactiveChoice` returns a pick.
   */
  async _commitReactiveFire(reactorActor, reactionSkill, attackerToken) {
    if (!reactorActor || !reactionSkill) return;
    await this._gmAction({ type: 'gmConsumeReaction', targetActorUuid: reactorActor.uuid });
    // Stamp rounds-remaining = skill.reactionCooldown. Decremented at each
    // onStartTurn; auto-pruned when it hits 0. Default 1 = unavailable
    // until the actor's next reference round begins.
    const cdLen = reactionSkill.system?.tagConfig?.reactionCooldown ?? 1;
    if (cdLen > 0) {
      await reactorActor.update({
        [`flags.aspectsofpower.reactionCooldowns.${reactionSkill.id}`]: cdLen,
      });
    }
    if (attackerToken) {
      // Owner-route: a counterstrike reaction's roll (and any variable-invest
      // dialog) must run on the REACTOR's owning player's client, not on
      // whoever drove the attack resolution (the GM, for NPC attacks). Mirrors
      // the celerity executeQueuedAction routing — fixes the invest-dialog-on-GM
      // bug for variable-invest ally reactions. No online owner → run locally.
      const owner = game.users.find(u => u.active && !u.isGM && u.character?.id === reactorActor.id);
      if (owner && owner.id !== game.user.id) {
        game.socket.emit('system.aspects-of-power', {
          action: 'executeQueuedAction',
          actorId: reactorActor.id,
          itemId: reactionSkill.id,
          targetUserId: owner.id,
          preTargetIds: [attackerToken.id],
        });
      } else {
        await reactionSkill.roll({ executeDeferred: true, preTargetIds: [attackerToken.id] });
      }
    }
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: reactorActor }),
      content: `<p><em>${reactorActor.name} reacts with <strong>${reactionSkill.name}</strong>!</em></p>`,
    });
  }

  /**
   * Passive reaction auto-fire. Scans `reactorActor`'s `skillType: 'Passive'`
   * skills tagged `retaliation` whose `tagConfig.reactionTrigger` matches
   * `triggerKey`. Each match fires automatically — no player prompt, no
   * reactions-budget consumption, no cooldown enforcement. Author sets
   * cost=0 for free-fire (Thorns); non-zero cost still gets deducted by
   * the standard roll path.
   *
   * Distinct from the Reactive flow which prompts the player and is
   * gated by budget + cooldown. Passives are always-on.
   *
   * @param {Actor} reactorActor   The actor whose passives may fire.
   * @param {Token|null} targetToken   The token to target with the retaliation
   *                                   (typically the attacker).
   * @param {string} triggerKey    The event key (e.g. 'self_attacked',
   *                               'ally_attacked', 'self_damage_taken').
   */
  async _firePassiveReactions(reactorActor, targetToken, triggerKey, attackerSkill = null) {
    if (!reactorActor || !targetToken) return;
    // Classify the incoming attack so reactionAttackType-filtered passives
    // (e.g. Thunder Puppet, melee-only) can skip non-matching triggers.
    // Falls back to `this` if no explicit attackerSkill passed (most callers
    // are `this` = the attacking skill firing the trigger).
    const attackerType = this.constructor._classifyAttackType(attackerSkill ?? this);
    const passives = reactorActor.items.filter(s =>
      s.type === 'skill' &&
      s.system.skillType === 'Passive' &&
      (s.system.tags ?? []).includes('retaliation') &&
      (s.system.tagConfig?.reactionTrigger ?? '') === triggerKey &&
      this.constructor._reactionMatchesAttackType(s, attackerType)
    );
    for (const skill of passives) {
      try {
        await skill.roll({ executeDeferred: true, preTargetIds: [targetToken.id] });
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: reactorActor }),
          content: `<p><em>${reactorActor.name}'s <strong>${skill.name}</strong> triggers (${triggerKey})!</em></p>`,
        });
      } catch (err) {
        console.warn('[reactions] passive reaction roll failed:', skill.name, triggerKey, err);
      }
    }

    // ── Phase E: buff-carried reactions ──
    // Scan the reactor's active effects for matching reactionTrigger + attack
    // type. Each carrier effect's reactionSkillId points to the skill that
    // fires when triggered (typically a dedicated counter skill). Use case:
    // Shocking Retort applies an armor buff to self; while the buff is non-
    // disabled, melee attackers eat the counter.
    const effects = reactorActor.allApplicableEffects?.() ?? reactorActor.effects ?? [];
    for (const eff of effects) {
      if (eff.disabled) continue;
      const sys = eff.system;
      if (!sys) continue;
      if ((sys.reactionTrigger ?? '') !== triggerKey) continue;
      const effAttackType = sys.reactionAttackType ?? 'any';
      if (effAttackType !== 'any' && effAttackType !== attackerType) continue;
      const skillUuid = sys.reactionSkillId;
      if (!skillUuid) continue;
      let counterSkill = null;
      try { counterSkill = await fromUuid(skillUuid); } catch (e) { /* not found */ }
      if (!counterSkill || counterSkill.type !== 'skill') {
        console.warn('[reactions] buff-carried reaction skill not found:', skillUuid, eff.name);
        continue;
      }
      try {
        await counterSkill.roll({ executeDeferred: true, preTargetIds: [targetToken.id] });
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: reactorActor }),
          content: `<p><em>${reactorActor.name}'s <strong>${eff.name}</strong> triggers <strong>${counterSkill.name}</strong> (${triggerKey})!</em></p>`,
        });
      } catch (err) {
        console.warn('[reactions] buff-carried reaction roll failed:', eff.name, counterSkill.name, triggerKey, err);
      }
    }
  }

  /** @deprecated Use `_firePassiveReactions` directly. */
  async _firePassiveRetaliations(targetActor, attackerToken, triggerKey) {
    return this._firePassiveReactions(targetActor, attackerToken, triggerKey);
  }

  /**
   * @param {number} incomingDamage  The attack's own damage roll, needed ONLY
   *   by the `clash` reaction, which compares blow against blow. Every other
   *   reaction works off the to-hit, which is why this arrives late and
   *   defaults to 0 — a clash with nothing to measure simply does nothing.
   */
  async _resolveDefenseCheck(item, targetActor, defKey, hitTotal, attackerToken = null,
                             incomingDamage = 0) {
    const pool    = targetActor.system.defense[defKey]?.pool ?? 0;
    const poolMax = targetActor.system.defense[defKey]?.poolMax ?? 0;
    const defLabel = defKey.charAt(0).toUpperCase() + defKey.slice(1);
    const isPhysicalLane = defKey === 'melee' || defKey === 'ranged';

    const skillTags = item.system?.tags ?? [];
    const shrapnelMult = skillTags.includes('shrapnel')
      ? (item.system?.tagConfig?.shrapnelMultiplier ?? 1.5)
      : 1;
    const effectiveHit = Math.round(hitTotal * shrapnelMult);

    const defenseResult = await this._promptDefensePool(targetActor, defKey, hitTotal, item.name, effectiveHit);

    let isHit = true;
    let damageMultiplier = 1;
    let defenseLine = '';
    let reactionLine = '';
    let swappedTargetActor = null;
    let swappedTargetToken = null;

    if (isPhysicalLane) {
      // ── Active defense: DODGE (design-active-defense.md) ──
      // Opposed house-grammar roll off defense.value, scramble-penalized.
      // Attempt costs (scramble stack + celerity delay) apply win or lose.
      // Graze band: a near-miss takes half damage — restores the partial-
      // mitigation smoothing the old pools provided. No pool is touched.
      if (defenseResult.defend) {
        const dt = CONFIG.ASPECTSOFPOWER.defenseTuning ?? {};
        // DEFENCE-TIME BUDGET (design-defense-time-budget, ruled 2026-08-16):
        // the dodge spends defence time proportional to the INCOMING swing's
        // commitment instead of stacking scramble + delaying the next action.
        // No scramble under this model — the budget IS the fatigue.
        const econBudget = (dt.defenseEconModel ?? 'budget') === 'budget';
        const stacks = econBudget ? 0 : getScrambleStacks(targetActor);
        const dv = effectiveDodgeValue(targetActor, defKey, stacks, dt);
        const die = await new Roll('1d20').evaluate();
        let droll = dv * (1 + die.total / 100);
        // Shrapnel is hard to dodge — penalize the roll (replaces the old
        // pool-cost multiplier for physical lanes).
        if (shrapnelMult > 1) droll *= (1 - (dt.shrapnelDodgePenalty ?? 0.25));
        droll = Math.round(droll);

        let costNote = '';
        if (econBudget) {
          // HEFT + SURCHARGE (design-defense-time-budget, ruled 2026-08-16):
          // the dodge pays the blow's committed mass in the defender's own
          // time; an over-cap blow empties the whole reserve AND burns
          // stamina scaled to the excess — the dive from the meteor.
          let heft = 100;
          try { heft = computeActionHeft(this.actor, item, null, null, { forDefense: true }); } catch (e) { /* no actor context */ }
          const budget = getDefenseBudget(targetActor);
          const rawCost = defenseTimeCost(heft, actorRoundLength(targetActor), dt);
          const cost = Math.min(rawCost, budget.max);
          const surcharge = defenseDiveSurcharge(rawCost, budget.max,
            targetActor.system.stamina?.max ?? 0, dt);
          await spendDefenseBudget(targetActor, cost);
          if (surcharge > 0) {
            this._gmAction({ type: 'gmSpendResource', targetActorUuid: targetActor.uuid,
              resource: 'stamina', amount: surcharge });
          }
          const after = getDefenseBudget(targetActor);
          costNote = ` — ${cost} defence time spent`
            + (surcharge > 0 ? ` + ${surcharge} stamina (a dive beyond limits)` : '')
            + ` (${after.remaining}/${after.max} left)`;
        } else {
          await addScrambleStack(targetActor);
          const cost = await applyDodgeCost(targetActor);
          costNote = cost > 0 ? ` — next action +${cost} ticks` : '';
        }

        // Dodging is MOVEMENT — a held working cannot survive the dive
        // (ruled 2026-08-16: rooted while holding; reactions only). A GUARD
        // STANCE falls the same way (design-guard-stances): in guard you
        // answer with the parry, not footwork.
        {
          const _hc = findCombatantForActor(targetActor);
          if (_hc?.flags?.aspectsofpower?.heldCast) {
            await _hc.update({ 'flags.aspectsofpower.heldCast': null }).catch(() => {});
            ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }),
              content: `<p><strong>${targetActor.name}</strong>'s held working slips loose as they move — it collapses.</p>` });
          }
          if (_hc?.flags?.aspectsofpower?.guardStance) {
            await _hc.update({ 'flags.aspectsofpower.guardStance': null }).catch(() => {});
            ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }),
              content: `<p><em>${targetActor.name}'s guard drops — footwork over posture.</em></p>` });
          }
        }
        const speaker = ChatMessage.getSpeaker({ actor: targetActor });

        // THE MARGIN RULE (RULED 2026-07-31): how badly you lost decides what
        // fraction lands. Replaces avoid / graze-0.5 / full, where two pips of
        // a d20 was the difference between 465 damage and dying.
        damageMultiplier = defenceMarginMultiplier(droll, hitTotal);
        if (damageMultiplier <= 0) {
          isHit = false;
          defenseLine = `<p>${defLabel} dodge: <strong>success</strong> (${droll} vs ${hitTotal})${costNote}</p>`;
          ChatMessage.create({ speaker,
            content: `<p><strong>${targetActor.name}</strong> dodges the ${defLabel.toLowerCase()} attack! (${droll} vs ${hitTotal}) <em>May reposition 5ft.</em></p>`,
          });
        } else {
          const _redPct = Math.round((1 - damageMultiplier) * 100);
          defenseLine = `<p>${defLabel} dodge: <strong>partial</strong> (${droll} vs ${hitTotal} — ${_redPct}% reduced)${costNote}</p>`;
          ChatMessage.create({ speaker,
            content: `<p><strong>${targetActor.name}</strong> gives ground — ${_redPct}% of the blow turned aside. (${droll} vs ${hitTotal})</p>`,
          });
        }
      } else if (defenseResult.perceiveGated) {
        defenseLine = `<p>${defLabel} defense: <strong>too fast to react</strong>`
          + ` (${(defenseResult.perceiveRatio ?? 0).toFixed(1)}x Celerity — the blow is a blur)</p>`;
      } else {
        defenseLine = `<p>${defLabel} defense: takes the hit (bulk absorbs)</p>`;
      }
    } else if (defenseResult.defend && pool > 0) {
      if (pool >= effectiveHit) {
        isHit = false;
        const newPool = pool - effectiveHit;
        await this._gmAction({ type: 'gmUpdateDefensePool', targetActorUuid: targetActor.uuid, defKey, newPool });
        defenseLine = `<p>${defLabel} defense: full dodge (pool ${pool} → ${newPool} / ${poolMax})</p>`;
      } else {
        damageMultiplier = 1 - (pool / effectiveHit);
        await this._gmAction({ type: 'gmUpdateDefensePool', targetActorUuid: targetActor.uuid, defKey, newPool: 0 });
        defenseLine = `<p>${defLabel} defense: partial (${Math.round((1 - damageMultiplier) * 100)}% reduced, pool ${pool} → 0 / ${poolMax})</p>`;
      }
    } else if (pool > 0) {
      defenseLine = `<p>${defLabel} defense: declined (pool ${pool} / ${poolMax})</p>`;
    } else {
      defenseLine = `<p>${defLabel} defense: no pool remaining (0 / ${poolMax})</p>`;
    }

    if (!isPhysicalLane && defenseResult.defend && pool > 0) {
      const pct = pool >= effectiveHit ? 100 : Math.round((pool / effectiveHit) * 100);
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: pool >= effectiveHit
          ? `<p><strong>${targetActor.name}</strong> fully dodges the ${defLabel.toLowerCase()} attack!</p>`
          : `<p><strong>${targetActor.name}</strong> partially blocks the ${defLabel.toLowerCase()} attack (${pct}% reduced).</p>`,
      });
    }

    // SHIELD ARMOR LIVES IN THE BLOCK (ruled 2026-08-21: "shields shouldn't
    // add full passive armor and instead only apply their full armor as
    // additional DR when blocking"). Set by the parry branch when the
    // parrying implement is shield-family; joins the armor wall for THIS
    // hit only, win or lose — the shield is interposed on the attempt.
    let bonusMitigation = 0;
    if (defenseResult.reactionSkillId) {
      const reactionSkill = targetActor.items.get(defenseResult.reactionSkillId);
      if (reactionSkill) {
        const rType = reactionSkill.system.reactionType ?? 'dodge';
        await this._gmAction({ type: 'gmConsumeReaction', targetActorUuid: targetActor.uuid });
        // Stamp rounds-remaining = skill.reactionCooldown (decremented at
        // each onStartTurn; auto-pruned at 0). Default 1 = next round.
        const _cdLen = reactionSkill.system?.tagConfig?.reactionCooldown ?? 1;
        if (_cdLen > 0) {
          await targetActor.update({
            [`flags.aspectsofpower.reactionCooldowns.${reactionSkill.id}`]: _cdLen,
          });
        }
        const reactionSpeaker = ChatMessage.getSpeaker({ actor: targetActor });

        if (rType === 'dodge') {
          isHit = false;
          reactionLine = `<p><em>${targetActor.name} dodges with <strong>${reactionSkill.name}</strong>!</em></p>`;
          ChatMessage.create({ speaker: reactionSpeaker,
            content: `<p><strong>${targetActor.name}</strong> deftly dodges the attack with <strong>${reactionSkill.name}</strong>!</p>`,
          });
        } else if (rType === 'block') {
          // A BLOCK IS A BLOCK: IT ADDS ARMOR (ruled 2026-08-21 — "Blocks
          // and parries are different things"). No opposed roll, no whiff:
          // the judged implement is interposed and its full armorBonus
          // joins THIS hit's wall (applied to `mitigation` downstream,
          // before the pipeline and the data-mitigation-value stamp). The
          // blow still lands; it just meets plate. The reliable soak
          // beside the parry's contested full-negate.
          const _impl = reactionSkill._proficiencyWeapon?.() ?? null;
          let _bulwarkNote = '';
          if ((CONFIG.ASPECTSOFPOWER.guardStance?.shieldArmorModel ?? 'block') === 'block') {
            const _shieldArmor = Math.max(0, Math.round(_impl?.system?.armorBonus ?? 0));
            bonusMitigation = _shieldArmor;
            // BULWARK (braced BLOCK, phase 2 ruled 2026-08-21, greatshield
            // content): stamina invested buys additional wall at the braced
            // price — bracedCostHitFrac x hitTotal per +100% of the shield's
            // armor, capped at bulwarkMaxBonusMult. Same local-prompt guard
            // as braced parries: another player's defender gets a plain block.
            if (_shieldArmor > 0 && (reactionSkill.system.tags ?? []).includes('braced')) {
              const _bwFrac = CONFIG.ASPECTSOFPOWER.defenseTuning?.bracedCostHitFrac ?? 0.05;
              const _bwMax = CONFIG.ASPECTSOFPOWER.guardStance?.bulwarkMaxBonusMult ?? 1.0;
              const _bwPool = targetActor.system.stamina?.value ?? 0;
              const _bwFullCost = Math.max(1, Math.round(_bwFrac * hitTotal));
              const _bwCap = Math.min(_bwPool, Math.round(_bwFullCost * _bwMax));
              const _bwPlayer = game.users.find(u =>
                u.active && !u.isGM && u.character?.id === targetActor.id);
              const _bwMayDecide = _bwPlayer
                ? _bwPlayer.id === game.user.id
                : (game.user.isGM || targetActor.isOwner);
              let _bwSpent = 0;
              if (_bwMayDecide && _bwCap > 0) {
                const chosen = await foundry.applications.api.DialogV2.wait({
                  window: { title: `${reactionSkill.name} — Brace the wall` },
                  content: `<p>Incoming hit ${hitTotal}. The shield holds <strong>+${_shieldArmor}</strong>; `
                    + `stamina braces it further — <strong>${_bwFullCost}</strong> stamina per additional +${_shieldArmor} `
                    + `(cap +${Math.round(_shieldArmor * _bwMax)}). Pool: ${_bwPool}.</p>`
                    + `<div class="form-group"><label>Brace stamina</label>`
                    + `<input type="number" name="brace" value="0" min="0" max="${_bwCap}" step="1" autofocus /></div>`,
                  buttons: [
                    { action: 'ok', label: 'Block', default: true,
                      callback: (ev, btn) => Number(btn.form?.elements?.brace?.value ?? 0) },
                    { action: 'plain', label: 'Plain block', callback: () => 0 },
                  ],
                  close: () => 0,
                }) ?? 0;
                _bwSpent = Math.min(Math.max(0, Math.round(chosen)), _bwCap);
              }
              if (_bwSpent > 0) {
                const _bwBonus = bulwarkWallBonus(_shieldArmor, _bwSpent, hitTotal, _bwFrac, _bwMax);
                bonusMitigation += _bwBonus;
                await targetActor.update({ 'system.stamina.value': _bwPool - _bwSpent });
                _bulwarkNote = ` (braced ${_bwSpent} stam -> +${_bwBonus})`;
              }
            }
          }
          reactionLine = `<p><em>${targetActor.name} blocks with <strong>${reactionSkill.name}</strong>`
            + (bonusMitigation > 0 ? ` — wall +${bonusMitigation}${_bulwarkNote}` : '') + `.</em></p>`;
          ChatMessage.create({ speaker: reactionSpeaker,
            content: `<p><strong>${targetActor.name}</strong> takes the blow on `
              + `${_impl?.name ?? 'the shield'}${bonusMitigation > 0 ? ` — <strong>+${bonusMitigation}</strong> to the wall${_bulwarkNote}` : ''}.</p>`,
          });
        } else if (rType === 'parry') {
          const parryRoll = await reactionSkill.roll({ parryOnly: true });
          const rawParry = parryRoll ? Math.round(parryRoll.total) : 0;
          // MASS RATIO (ruled 2026-07-27) — it is hard to parry a huge sword.
          // The defender's own weapon weight already feeds their blend, but the
          // attacker's did nothing, so a dagger turned a claymore aside exactly
          // as well as another claymore. Capped at 1: being outmassed is a
          // penalty, out-massing is not a bonus.
          // BRACED (`braced` tag, RULED 2026-07-31): stamina buys EFFECTIVE
          // weight for the mass ratio only. Opt-in per skill, so an untagged
          // parry behaves exactly as before and stays free.
          let _defW = heldWeaponWeight(targetActor);
          const _atkW = heldWeaponWeight(this.actor);
          // BUCKLER ASSIST (phase 2, ruled 2026-08-21): while the raised
          // guard is a buckler, weapon parries add the buckler's weight to
          // their effective mass — the off-hand deflects alongside the
          // blade (dagger 60 + buckler 60 vs an axe: mass 0.68 -> 0.83).
          // Braced stamina still stacks on top toward parity.
          let _bucklerAssist = 0;
          {
            const _gsCbt2 = findCombatantForActor(targetActor);
            const _gItem = targetActor.items.get(
              _gsCbt2?.flags?.aspectsofpower?.guardStance?.guardItemId ?? '');
            if (_gItem && (_gItem.system.tags ?? []).includes('buckler')) {
              _bucklerAssist = AspectsofPowerItem.resolveWeaponWeight(_gItem);
              _defW += _bucklerAssist;
            }
          }
          let effDefW = _defW;
          let bracedSpent = 0;
          if ((reactionSkill.system.tags ?? []).includes('braced')) {
            const _pool = targetActor.system.stamina?.value ?? 0;
            const _scale = reactionSkill.system?.tagConfig?.bracedInvestScale ?? 1.0;
            // ⚠ ROUTING LIMIT: unlike _promptDefensePool this prompt is LOCAL,
            // so it must only be shown to someone entitled to make the
            // defender's decision. When the defender is another player's
            // character the brace is skipped (an ordinary free parry) rather
            // than popping the slider on the attacker's screen. Lifting this
            // means mirroring the defensePrompt socket round-trip.
            const _defenderPlayer = game.users.find(u =>
              u.active && !u.isGM && u.character?.id === targetActor.id);
            const _mayDecide = _defenderPlayer
              ? _defenderPlayer.id === game.user.id
              : (game.user.isGM || targetActor.isOwner);
            const chosen = _mayDecide ? await this._promptBracedInvest({
              skillName: reactionSkill.name,
              weapon: reactionSkill._proficiencyWeapon?.()?.name ?? null,
              defWeight: _defW, atkWeight: _atkW, hitTotal, pool: _pool, scale: _scale,
            }) : null;
            bracedSpent = Math.min(Math.max(0, chosen ?? 0), _pool);
            if (bracedSpent > 0) {
              effDefW = bracedParryWeight(_defW, bracedSpent, hitTotal, _scale);
              await targetActor.update({ 'system.stamina.value': _pool - bracedSpent });
            }
          }
          const massMult = parryMassMultiplier(effDefW, _atkW);
          // PROFICIENCY SCALES THE PARRY too (ruled 2026-07-29). Judged against
          // the implement actually doing the parrying, so Shield Block is rated
          // on the shield rather than on whatever else the defender carries.
          //
          // It also means a legendary dagger master parries about as well as a
          // novice with a greatshield, so mastery can overturn the mass rule at
          // the top of the ladder. That is the ruled intent: skill should be
          // able to beat physics eventually.
          //
          // (The old "this makes it a CLIFF rather than a curve" caveat here is
          // RESOLVED as of the margin rule — the ladder now slides the damage
          // fraction instead of flipping a pass/fail threshold.)
          const parryProf = proficiencyDamageMult(
            targetActor, reactionSkill._proficiencyWeapon?.() ?? null);
          const parryTotal = Math.round(rawParry * massMult * parryProf);
          const bits = [];
          if (_bucklerAssist > 0) bits.push(`buckler +${_bucklerAssist} mass`);
          if (bracedSpent > 0) bits.push(`braced ${bracedSpent} stam -> weight ${Math.round(effDefW)}`);
          if (massMult < 1) bits.push(`outmassed x${massMult.toFixed(2)}`);
          if (parryProf !== 1) bits.push(`proficiency x${parryProf.toFixed(2)}`);
          const massNote = bits.length
            ? ` <em>(${bits.join(', ')} of ${rawParry})</em>` : '';
          // THE MARGIN RULE reaches parry too (RULED 2026-07-31). Left binary
          // it would be STRICTLY DOMINATED: measured against the proportional
          // dodge it lost 11 of 12 live matchups, and at an identical basis a
          // binary defence takes 11x the damage of a proportional one, because
          // falling short buys nothing at all. Takes the BETTER of the parry
          // and whatever the dodge/pool branch already achieved, so declaring
          // a parry can never leave you worse off than not declaring one.
          const parryMult = defenceMarginMultiplier(parryTotal, hitTotal);
          if (parryMult < damageMultiplier) damageMultiplier = parryMult;
          if (damageMultiplier <= 0) {
            isHit = false;
            reactionLine = `<p><em>${targetActor.name} parries with <strong>${reactionSkill.name}</strong>! `
                         + `(${parryTotal} vs ${hitTotal})${massNote}</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> parries the blow with <strong>${reactionSkill.name}</strong>! (${parryTotal} vs ${hitTotal})${massNote}</p>`,
            });
          } else {
            reactionLine = `<p><em>${targetActor.name} fails to parry with <strong>${reactionSkill.name}</strong> `
                         + `(${parryTotal} vs ${hitTotal})${massNote}</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> attempts to parry with <strong>${reactionSkill.name}</strong> but fails! (${parryTotal} vs ${hitTotal})${massNote}</p>`,
            });
          }
        } else if (rType === 'barrier') {
          await reactionSkill.roll();
          reactionLine = `<p><em>${targetActor.name} reacts with <strong>${reactionSkill.name}</strong> (Barrier)!</em></p>`;
          ChatMessage.create({ speaker: reactionSpeaker,
            content: `<p><strong>${targetActor.name}</strong> raises a barrier with <strong>${reactionSkill.name}</strong>!</p>`,
          });
        } else if (rType === 'clash') {
          // CLASH — meet the blow with a blow (design-clash-reaction.md).
          //
          // The defender rolls their counter's DAMAGE and it is measured
          // against the incoming damage directly. Larger wins; only the
          // difference lands, on whoever lost. This is the one reaction that
          // can hurt the attacker by defending, so it is also the one that can
          // leave the defender worse off than simply eating the hit would
          // have — that symmetry is the point, not an oversight.
          //
          // ⚠ IT DOES NOT STACK WITH THE DODGE/POOL RESULT. Parry above takes
          // the BETTER of itself and whatever the pool already achieved, which
          // is right for a defence that only ever subtracts. A clash REPLACES
          // the outcome, because the excess dealt back to the attacker is
          // computed from this exact exchange; blending it with a partial dodge
          // would pay the defender twice for the same blow.
          const clashRoll = await reactionSkill.roll({ clashOnly: true });
          const clashDamage = clashRoll ? Math.max(0, Math.round(clashRoll.total)) : 0;
          const outcome = clashOutcome(incomingDamage, clashDamage);

          damageMultiplier = outcome.damageMultiplier;
          isHit = outcome.damageMultiplier > 0;

          const tally = `${clashDamage} vs ${Math.round(incomingDamage)}`;
          if (outcome.winner === 'defender') {
            // The attacker eats the excess RAW — see clashOutcome's contract.
            // Stamped as a damage source so a kill here still credits the
            // clasher (new damage paths that skip this lose kill credit
            // silently — design-gear-sourced-skills).
            const atkActor = attackerToken?.actor ?? this.actor ?? null;
            const excess = outcome.attackerTakes;
            if (atkActor && excess > 0) {
              const h = atkActor.system?.health ?? {};
              await atkActor.update({
                'system.health.value': Math.max(0, (h.value ?? 0) - excess),
                'flags.aspectsofpower.lastDamageSourceUuid': targetActor.uuid,
              });
            }
            reactionLine = `<p><em>${targetActor.name} overpowers the blow with `
                         + `<strong>${reactionSkill.name}</strong> (${tally})!</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> meets the attack with `
                     + `<strong>${reactionSkill.name}</strong> and overpowers it (${tally}) — `
                     + `<strong>${atkActor?.name ?? 'the attacker'}</strong> takes `
                     + `<strong>${excess}</strong> from the backlash.</p>`,
            });
          } else if (outcome.winner === 'tie') {
            reactionLine = `<p><em>${targetActor.name} meets the blow exactly with `
                         + `<strong>${reactionSkill.name}</strong> (${tally}) — both are spent.</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> and the attack annihilate each other exactly (${tally}).</p>`,
            });
          } else {
            reactionLine = `<p><em>${targetActor.name} is overpowered through `
                         + `<strong>${reactionSkill.name}</strong> (${tally}) — `
                         + `${outcome.defenderTakes} gets through.</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> clashes with `
                     + `<strong>${reactionSkill.name}</strong> but is overpowered (${tally}).</p>`,
            });
          }
        } else if (rType === 'retaliation') {
          // Phase B post-resolve: counter-strike the attacker. The incoming
          // attack still resolves normally (retaliation doesn't negate it);
          // the reaction fires its own damage roll against the attacker.
          if (attackerToken) {
            await reactionSkill.roll({ executeDeferred: true, preTargetIds: [attackerToken.id] });
          }
          reactionLine = `<p><em>${targetActor.name} retaliates with <strong>${reactionSkill.name}</strong>!</em></p>`;
          ChatMessage.create({ speaker: reactionSpeaker,
            content: `<p><strong>${targetActor.name}</strong> strikes back with <strong>${reactionSkill.name}</strong>!</p>`,
          });
        } else if (rType === 'swap') {
          // Summon-swap reaction (per design-summon-subsystem.md). Find the
          // actor's most recent summon, swap positions atomically. The attack
          // is then redirected onto the clone (which now occupies the
          // original target's square) — `isHit` stays as-resolved, but the
          // damage application rebinds onto the clone so the original actor
          // is safe at the swapped location. Per user 2026-05-24.
          const { SummonHelpers } = await import('../systems/summon.mjs');
          const summons = SummonHelpers.findSummonsOf(targetActor);
          const targetTokenDoc = targetActor.getActiveTokens?.()?.[0]?.document ?? null;
          if (summons.length > 0 && targetTokenDoc) {
            const cloneTokenDoc = summons[summons.length - 1];
            await SummonHelpers.swapPositions(targetTokenDoc, cloneTokenDoc);
            const cloneToken = cloneTokenDoc.object;
            const cloneActor = cloneTokenDoc.actor;
            if (cloneToken && cloneActor) {
              swappedTargetActor = cloneActor;
              swappedTargetToken = cloneToken;
            }
            reactionLine = `<p><em>${targetActor.name} swaps places with their clone via <strong>${reactionSkill.name}</strong>!</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> swaps with their clone via <strong>${reactionSkill.name}</strong>! The attack lands on the clone.</p>`,
            });
          } else {
            reactionLine = `<p><em>${targetActor.name} attempted <strong>${reactionSkill.name}</strong> but no clone exists.</em></p>`;
          }
        }
      }
    }

    // A defensive reaction that NEGATED the hit (dodge/parry succeeded →
    // isHit false) supersedes the physical-lane "takes the hit (bulk absorbs)"
    // fallback, which is set earlier (before we know a reaction will fire). Drop
    // the stale line so the card doesn't read "takes the hit" AND "parries!".
    // (2026-07-15 cosmetic finding.)
    if (defenseResult.reactionSkillId && isHit === false) defenseLine = '';

    return { isHit, damageMultiplier, defenseLine, reactionLine, swappedTargetActor, swappedTargetToken, bonusMitigation };
  }

  /**
   * Attack tag: resolve hit vs target defense pool, calculate mitigated damage,
   * and post a GM-whispered combat result with an Apply Damage button.
   *
   * Defense pool flow:
   *   pool >= toHit  → full dodge, pool -= toHit
   *   0 < pool < toHit → partial, damage *= (1 - pool/toHit), pool = 0
   *   pool == 0       → full hit
   *
   * Dual defense ("single blow, two defenses" — e.g. Earth's Rise):
   *   When `roll.secondaryTargetDefense` is set, the hit rolls against BOTH
   *   defenses. Damage splits 50/50 across the two halves; each half is gated
   *   by its own defense check independently. Defense pipeline (barrier,
   *   armor/veil, toughness) runs ONCE on the combined post-defense damage —
   *   so the target isn't double-tapped by toughness across the two halves.
   */
  async _handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetTokenOverride = null, aoeFraction = 1, opts = {}) {
    // `skipDefense`: this attack is a chained RIDER — the parent attack already
    // resolved the target's defense (dodge/parry/pool/guardian) and its cost.
    // The rider must NOT put up a second Defend prompt (an orphanable dialog
    // that re-resolves + double-applies when clicked, per 2026-07-15 test) nor
    // re-fire retaliations/guardian reactions. Damage still passes through the
    // target's passive mitigation (armor/veil/toughness) downstream.
    // stackMult: a stack SPENDER's payoff, resolved once per activation in
    // roll() and threaded in — NOT recomputed here, because this method runs
    // once PER TARGET on an AOE and the pool must only be charged once.
    const { skipDefense = false, stackMult = 1 } = opts;
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    let targetToken    = targetTokenOverride ?? game.user.targets.first() ?? null;
    let targetActor    = targetToken?.actor ?? null;
    if (!targetActor) return;

    const targetDefKey    = rollData.roll.targetDefense;
    const secondaryDefKey = rollData.roll.secondaryTargetDefense ?? '';
    const hasDualDefense  = !!secondaryDefKey && secondaryDefKey !== targetDefKey;

    let   hitTotal     = hitRoll ? Math.round(hitRoll.total) : 0;
    // ── Mark subsystem: to-hit boost ──
    // If this attacker has any marks on the target carrying
    // markedAttackMultiplier > 0, sum the bonuses and multiply hitTotal
    // BEFORE the defense check runs. Per-attacker (markedByActorUuid match).
    // Per-mark expires-on-hit consumes the mark after the boost is applied,
    // regardless of whether the resulting attack lands or misses.
    if (hitRoll && targetActor && this.actor?.uuid) {
      const attackerUuid = this.actor.uuid;
      const myAttackMarks = targetActor.effects.filter(e =>
        !e.disabled
        && (e.system?.markedAttackMultiplier ?? 0) > 0
        && e.system?.markedByActorUuid === attackerUuid
      );
      const attackBonus = myAttackMarks.reduce(
        (s, e) => s + (Number(e.system?.markedAttackMultiplier) || 0), 0,
      );
      if (attackBonus > 0) {
        const before = hitTotal;
        hitTotal = Math.round(hitTotal * (1 + attackBonus));
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          ...(whisperGM ? { whisper: whisperGM } : {}),
          content: `<p><em>${this.actor.name}'s attack is boosted by a mark on ${targetActor.name}: +${Math.round(attackBonus * 100)}% to-hit (${before} → ${hitTotal})</em></p>`,
        });
        const oneShots = myAttackMarks.filter(e => e.system?.markedExpiresOnHit === true);
        if (oneShots.length > 0) {
          await targetActor.deleteEmbeddedDocuments('ActiveEffect', oneShots.map(e => e.id));
        }
      }
    }

    // ── MARK CONSUMERS (RULED 2026-07-31) ─────────────────────────────────
    // The spender's side of the mark economy. `markExpiresOnHit` above belongs
    // to the MARK and burns on whatever attack happens to benefit next; these
    // belong to the SKILL, so a kit can hold a persistent mark for accuracy
    // and still have one skill that cashes it in for burst damage.
    // Counts ANY mark from this attacker, not just to-hit ones — a pure
    // damage-bonus mark is still something to spend.
    let markDmgMult = 1;
    // markInternalActive: the target carries this attacker's mark and this
    // skill carries the `internal` spender tag — it will resolve from INSIDE
    // the body (no defence check, no armor/veil wall; toughness DR still
    // meets it). Captured HERE, before consume deletes the mark documents.
    // Spender behaviors are TAGS (RULED 2026-08-20): `consume-mark` and
    // `internal`, pierce-style gates. tagConfig.consumesMark is the legacy
    // read-fallback for pre-ruling content; markedDamageMult stays tagConfig
    // (a magnitude, not a behavior).
    let markInternalActive = false;
    if (targetActor && this.actor?.uuid) {
      const _tc = this.system?.tagConfig ?? {};
      const _tags = this.system?.tags ?? [];
      const _mult = _tc.markedDamageMult ?? 1;
      const _consumes = _tags.includes('consume-mark') || _tc.consumesMark === true;
      const _internal = _tags.includes('internal');
      if (_mult !== 1 || _consumes || _internal) {
        const myMarks = targetActor.effects.filter(e =>
          !e.disabled
          && e.system?.markedByActorUuid === this.actor.uuid
          && (((e.system?.markedAttackMultiplier ?? 0) > 0) || ((e.system?.markedDamageBonus ?? 0) > 0))
        );
        if (myMarks.length > 0) {
          markInternalActive = _internal;
          if (_mult !== 1) {
            markDmgMult = _mult;
            ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this.actor }),
              ...(whisperGM ? { whisper: whisperGM } : {}),
              content: `<p><em>${this.name} tears the mark open on ${targetActor.name}: `
                     + `x${_mult} damage${_consumes ? ' — mark consumed' : ''}.</em></p>`,
            });
          }
          if (_consumes) {
            await targetActor.deleteEmbeddedDocuments('ActiveEffect', myMarks.map(e => e.id));
          }
        }
      }
    }

    // ── BURN DETONATE (`consume-burn` tag, RULED 2026-08-21) ──────────────
    // Valentine's Snapfire: "fires on burning targets within reach are
    // instantly consumed, dealing their remaining damage in a single flash."
    // Sums each burn's remaining schedule (dotDamage × ticks left, resolved
    // with the SAME expression the onStartTurn countdown uses) into a flat
    // addition to THIS hit's raw, then deletes the consumed burns. Scoped to
    // dot effects carrying armorMeltRate > 0 — the armor-melt scoping rule
    // (design-burn-status) — so a bleed or poison can never be detonated.
    // ANY caster's burns qualify ("fires", not "your fires"): John softens,
    // Valentine snaps the flames shut. NOTE ORDERING: this runs before the
    // mitigation calc below, so _getArmorMeltFlat no longer sees the deleted
    // burns — detonating trades the melt (and the drip) for the flash.
    let burnDetonateFlat = 0;
    if (targetActor && (this.system.tags ?? []).includes('consume-burn')) {
      const _burns = targetActor.effects.filter(e => !e.disabled
        && e.system?.dot === true && (e.system?.armorMeltRate ?? 0) > 0);
      if (_burns.length > 0) {
        burnDetonateFlat = burnDetonatePayload(_burns.map(e => ({
          dotDamage: e.system?.dotDamage ?? 0,
          remaining: e.system?.roundsRemaining
            ?? Number(e.duration?.value ?? e._source?.duration?.value ?? 0),
        })));
        if (burnDetonateFlat > 0) {
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            ...(whisperGM ? { whisper: whisperGM } : {}),
            content: `<p><em>${this.name} snaps the flames shut on ${targetActor.name}: `
                   + `${_burns.length} burn${_burns.length > 1 ? 's' : ''} consumed — +${burnDetonateFlat} damage in a single flash.</em></p>`,
          });
        }
        await targetActor.deleteEmbeddedDocuments('ActiveEffect', _burns.map(e => e.id));
      }
    }

    const isPhysical   = rollData.roll.damageType === 'physical';
    // Armor-answer routing (2026-07-16 ruling): VEIL defends mind/soul attacks
    // ONLY. Physical AND elemental damage face the ARMOR layer (armor+blockDR,
    // reduced by crush/pierce) plus toughness/affinity DR. The lane is the
    // attack's targetDefense — NOT damageType — because elemental attacks are
    // 'magical' yet must hit armor, not veil. (mitigLabel + the apply-damage
    // button's data-mitigation carry this same lane so display and application
    // agree.)
    const _targetDef = rollData.roll.targetDefense;
    const usesVeil   = _targetDef === 'mind' || _targetDef === 'soul';
    let mitigation;
    if (!usesVeil) {
      const _aa = CONFIG.ASPECTSOFPOWER.armorAnswer ?? {};
      const armorLayer = (targetActor.system.defense.armor?.value ?? 0) + (targetActor.system.defense.blockDR ?? 0);
      // FLAT armor-answer (design-burn-status.md, 2026-07-18): pierce/crush/melt
      // are ABSOLUTE reductions anchored to the ATTACKER's output — they SUM and
      // subtract, never a fraction of the target's armor (%-of-target scaled with
      // target grade and let a lower-grade attacker strip a huge chunk of a
      // superior's armor). Grade-correct by construction.
      const _hit = Math.max(0, Math.round(dmgRoll?.total ?? 0));
      const crushFlat = this._getArmorCrushFlat(targetActor);
      const meltFlat  = this._getArmorMeltFlat(targetActor);
      const _wpnTags = this._resolveWeaponForSkill?.()?.system?.tags ?? [];
      const hasPierce = (this.system.tags ?? []).includes('pierce')
        || (_aa.pierceWeaponTypes ?? ['hammer', 'greathammer', 'mace']).some(t => _wpnTags.includes(t));
      const pierceFlat = hasPierce ? Math.round((_aa.pierceHitFrac ?? 0.23) * _hit) : 0;
      mitigation = Math.max(0, armorLayer - pierceFlat - crushFlat - meltFlat);
    } else {
      mitigation = (targetActor.system.defense.veil?.value ?? 0);
    }
    // Internal eruption (markedInternal, RULED 2026-08-20): the blow starts
    // inside the body, so the external wall — armor+blockDR or veil — never
    // meets it. Toughness DR (effectiveToughness below) is deliberately NOT
    // touched: the ruling keeps the body's own resilience in the way.
    if (markInternalActive) mitigation = 0;
    const attackerToken      = this.actor.getActiveTokens()[0] ?? null;
    const baseDR             = targetActor.system.defense?.dr?.value ?? 0;
    const affinityDR         = this._getAffinityDRReduction(targetActor, attackerToken, targetToken);
    const effectiveToughness = Math.max(0, baseDR - affinityDR);
    const mitigLabel         = usesVeil ? 'Veil' : 'Armor';

    // ── Defense check(s): one per defense, sequentially. Dual-defense skills
    // run two prompts; the defender chooses pool/reaction independently for
    // each. Damage is split 50/50 across the halves.
    let primaryResult   = { isHit: true, damageMultiplier: 1, defenseLine: '', reactionLine: '' };
    let secondaryResult = null;

    // ── Passive retaliation auto-fire: self_attacked (Phase B) ──
    // Before the defense check, scan target's Passive + retaliation skills
    // matching the `self_attacked` trigger. They fire automatically — no
    // budget, no cooldown enforcement, no player prompt. Author sets cost=0
    // for free-fire passives (Thorns-style); non-zero cost is still paid.
    if (!skipDefense) await this._firePassiveReactions(targetActor, attackerToken, 'self_attacked');

    // Guardian-cover (P2b): when a guardian chooses cover, the defense check
    // below runs vs the GUARDIAN (coverGuardian) instead of the ally — their
    // dodge/pools/cost — while damage still lands on the ally with the ally's
    // own barrier/armor/DR. Null = no cover this attack.
    let coverGuardian = null;
    // Guardian-redirect (P2c): when a guardian chooses redirect, the attack
    // resolves on the ally normally; then redirectPct of the LANDED (final)
    // damage transfers RAW onto the guardian (Option A — no guardian armor
    // re-applied). Null = no redirect this attack.
    let redirectGuardian = null;
    let redirectPct = 0;
    // ── Ally-attacked passive auto-fire (Phase C) ──
    // Scan friendly actors with `ally_attacked` passives within their
    // configured `reactionTriggerRange` of `targetActor`. Each fires
    // automatically against the attacker. Savior's Slash is the canonical
    // case (15ft, non-hostile triggers fire from a reactor in range).
    if (!skipDefense && attackerToken && targetToken && game.combat?.started) {
      const gridSize = canvas.grid.size;
      const gridDist = canvas.grid.distance;
      const pxPerFt = gridSize / gridDist;
      const targetCenter = targetToken.center;
      for (const cm of game.combat.combatants) {
        const reactor = cm.actor;
        const rTok = cm.token?.object;
        if (!reactor || !rTok) continue;
        if (reactor.id === targetActor.id) continue;
        if (reactor.id === this.actor?.id) continue; // attacker can't react on its own attack
        // Only same-disposition (friendly) reactors trigger.
        if (cm.token.disposition !== targetToken.document.disposition) continue;
        // Compute distance once — used by both passive + reactive checks.
        const dx = targetCenter.x - rTok.center.x;
        const dy = targetCenter.y - rTok.center.y;
        const distFt = Math.hypot(dx, dy) / pxPerFt;

        // ── Passive ally_attacked auto-fire ──
        const passiveCandidates = reactor.items.filter(s =>
          s.type === 'skill' &&
          s.system.skillType === 'Passive' &&
          (s.system.tags ?? []).includes('retaliation') &&
          (s.system.tagConfig?.reactionTrigger ?? '') === 'ally_attacked'
        );
        for (const skill of passiveCandidates) {
          const range = skill.system.tagConfig?.reactionTriggerRange ?? 0;
          if (range > 0 && distFt > range) continue;
          try {
            await skill.roll({ executeDeferred: true, preTargetIds: [attackerToken.id] });
            ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: reactor }),
              content: `<p><em>${reactor.name}'s <strong>${skill.name}</strong> triggers (${targetActor.name} attacked within ${Math.round(distFt)}ft)!</em></p>`,
            });
          } catch (err) {
            console.warn('[reactions] ally_attacked passive failed:', skill.name, err);
          }
        }

        // ── Reactive (player-prompted) ally_attacked (Phase D) ──
        // Independent of passive presence — a reactor with ONLY a Reaction-
        // skillType ally_attacked skill (no passive) still gets the prompt.
        const reactiveCandidates = reactor.items.filter(s =>
          s.type === 'skill' &&
          s.system.skillType === 'Reaction' &&
          (s.system.tagConfig?.reactionTrigger ?? '') === 'ally_attacked'
        ).filter(s => {
          const range = s.system.tagConfig?.reactionTriggerRange ?? 0;
          return range === 0 || distFt <= range;
        });
        if (reactiveCandidates.length > 0) {
          const promptText = `<p><strong>${targetActor.name}</strong> is being attacked within ${Math.round(distFt)} ft. React?</p>`;
          const chosenId = await this._promptReactiveChoice(reactor, 'ally_attacked', { promptText, attackerToken, attackedActor: targetActor });
          if (chosenId) {
            const chosen = reactor.items.get(chosenId);
            if (chosen) {
              const gMode = chosen.system?.reactionType === 'guardian'
                ? (chosen.system?.tagConfig?.guardianMode ?? 'intercept')
                : null;
              if (gMode === 'intercept') {
                // Purely-defensive bodyguard (design-guardian-reactions.md).
                // Consume the reactor's reaction + stamp cooldown, then REDIRECT
                // the in-flight attack onto the guardian — done BEFORE the
                // defense check below (~the _resolveDefenseCheck call), so it
                // resolves vs the GUARDIAN's own dodge/parry/armor/veil/HP. No
                // skill roll, no counterstrike (the skill is the trigger). One
                // interceptor per attack → break the ally scan.
                await this._gmAction({ type: 'gmConsumeReaction', targetActorUuid: reactor.uuid });
                const _cd = chosen.system?.tagConfig?.reactionCooldown ?? 1;
                if (_cd > 0) await reactor.update({ [`flags.aspectsofpower.reactionCooldowns.${chosen.id}`]: _cd });

                // ── GEAR-SOURCED SELF-BUFF ON INTERCEPT ──────────────────
                // An interceptor that also braces its own kit (John's Shield
                // Barrier: "while it holds, its own defensive properties are
                // increased by 10 percent") must have that buff UP before the
                // redirected attack resolves against them — this runs ahead of
                // the target swap below for exactly that reason.
                //
                // ⚠ ONLY gear-sourced buffs. This path deliberately does not
                // roll the skill, so there is no dmgRoll for a roll-scaled buff
                // to be a fraction OF; applying one here would silently write a
                // zero. A gear-sourced magnitude is the one kind that needs no
                // roll, which is what makes it safe to fire from a trigger.
                const _gTc = chosen.system?.tagConfig ?? {};
                if (_gTc.buffFromEquipment && (_gTc.buffEntries ?? []).length > 0) {
                  try {
                    await chosen._handleBuffTag(
                      chosen, chosen.getRollData(), { total: 0 },
                      ChatMessage.getSpeaker({ actor: reactor }), 'roll', chosen.name);
                    // Effect creation re-prepares the actor, but reset() makes
                    // the armour read below unambiguous rather than depending
                    // on that (playbook-live-data-reliability).
                    reactor.reset();
                  } catch (err) {
                    console.warn('[reactions] intercept self-buff failed:', chosen.name, err);
                  }
                }

                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: reactor }),
                  content: `<p><em><strong>${reactor.name}</strong> intercepts the attack on ${targetActor.name} with <strong>${chosen.name}</strong> — they take the hit!</em></p>`,
                });
                targetActor = reactor;
                targetToken = rTok;
                break;
              } else if (gMode === 'cover') {
                // Defend-for-ally (design-guardian-reactions.md): the GUARDIAN's
                // defense roll replaces the ally's — the defense check below runs
                // vs coverGuardian. Hit stays on the ally; guardian success
                // negates it, failure → the ally takes it with the ally's own
                // mitigation. Consume reaction + cooldown, break (one coverer).
                await this._gmAction({ type: 'gmConsumeReaction', targetActorUuid: reactor.uuid });
                const _cd = chosen.system?.tagConfig?.reactionCooldown ?? 1;
                if (_cd > 0) await reactor.update({ [`flags.aspectsofpower.reactionCooldowns.${chosen.id}`]: _cd });
                coverGuardian = reactor;
                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: reactor }),
                  content: `<p><em><strong>${reactor.name}</strong> covers ${targetActor.name} with <strong>${chosen.name}</strong> — defending the blow in their stead!</em></p>`,
                });
                break;
              } else if (gMode === 'redirect') {
                // Bloodbond: the attack resolves on the ally; a share of the
                // LANDED damage transfers raw to the guardian, applied via the
                // redirect button on the result card (below). Consume reaction +
                // cooldown, break (one redirector per attack).
                await this._gmAction({ type: 'gmConsumeReaction', targetActorUuid: reactor.uuid });
                const _cd = chosen.system?.tagConfig?.reactionCooldown ?? 1;
                if (_cd > 0) await reactor.update({ [`flags.aspectsofpower.reactionCooldowns.${chosen.id}`]: _cd });
                redirectGuardian = reactor;
                redirectPct = Math.max(0, Math.min(1, chosen.system?.tagConfig?.guardianRedirectPct ?? 0.5));
                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: reactor }),
                  content: `<p><em><strong>${reactor.name}</strong> bonds with ${targetActor.name} via <strong>${chosen.name}</strong> — they will share the blow!</em></p>`,
                });
                break;
              } else if (gMode) {
                // Unknown guardian mode — consume + note, no counterstrike.
                await this._gmAction({ type: 'gmConsumeReaction', targetActorUuid: reactor.uuid });
                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: reactor }),
                  content: `<p><em>${reactor.name}'s <strong>${chosen.name}</strong> (guardian: ${gMode}) — unknown mode.</em></p>`,
                });
              } else {
                await this._commitReactiveFire(reactor, chosen, attackerToken);
              }
            }
          }
        }
      }
    }

    // Phase F: volumetric AOEs bypass physical defense pools — "you can't
    // dodge gas." `_classifyAoeContext` returns 'aoe-volumetric' for any
    // AOE attack-tagged skill without `shrapnel` and not targeting mind/
    // soul defense (those have their own pipelines). Skip the pool prompt
    // (and therefore the reactive dodge/parry/barrier choice, which lives
    // in `_promptDefensePool` inside `_resolveDefenseCheck`). Damage flows
    // straight through to armor/veil/toughness at fraction-scaled full.
    // Shrapnel AOEs and single-target attacks keep their existing pipeline.
    const aoeContext = this.constructor._classifyAoeContext(this);
    const bypassPool = aoeContext === 'aoe-volumetric';
    const _defLabel = (k) => (k ?? '').charAt(0).toUpperCase() + (k ?? '').slice(1);
    // Chained riders (skipDefense) auto-hit exactly like volumetric AOEs skip
    // the pool — no Defend prompt — but the chat note names the real reason.
    // markedInternal joins them (RULED 2026-08-20): the attacker's mark is
    // already inside the target's body, and you can't dodge your own
    // bloodstream — guaranteed hit, full margin, no defence-time spent.
    if (bypassPool || skipDefense || markInternalActive) {
      const _primaryNote = markInternalActive
        ? `Unavoidable — the mark erupts from within (no defence possible).`
        : bypassPool
          ? `${_defLabel(targetDefKey)} pool bypassed (volumetric AOE — can't dodge gas).`
          : `Chained hit — parent attack already resolved the defense.`;
      primaryResult = { isHit: true, damageMultiplier: 1,
        defenseLine: `<p><em>${_primaryNote}</em></p>`,
        reactionLine: '' };
      if (hasDualDefense) {
        secondaryResult = { isHit: true, damageMultiplier: 1,
          defenseLine: bypassPool ? `<p><em>${_defLabel(secondaryDefKey)} pool bypassed.</em></p>` : '',
          reactionLine: '' };
      }
    } else {
      // Guardian-cover: defend with the guardian's roll/pools/cost when set;
      // damage still applies to the ally (targetActor) downstream.
      const _defender = coverGuardian ?? targetActor;
      if (hitRoll && targetDefKey) {
        // ⚠ The raw damage roll is threaded in for `clash` only. On a DUAL
        // defence each half faces its own check, so the clash is measured
        // against the HALF it actually meets — passing the full total there
        // would let one counter out-clash a blow twice its real size.
        primaryResult = await this._resolveDefenseCheck(item, _defender, targetDefKey, hitTotal, attackerToken,
          _clashIncoming(dmgRoll, hasDualDefense));
      }
      if (hasDualDefense && hitRoll) {
        secondaryResult = await this._resolveDefenseCheck(item, _defender, secondaryDefKey, hitTotal, attackerToken,
          _clashIncoming(dmgRoll, hasDualDefense));
      }
    }

    // Swap-reaction (per design-summon-subsystem.md): if the defense pipeline
    // resolved with a `swap` reaction, the in-flight attack is redirected
    // onto the clone — rebind targetActor + targetToken for the remaining
    // damage application + downstream tag handlers.
    if (primaryResult.swappedTargetActor && primaryResult.swappedTargetToken) {
      targetActor = primaryResult.swappedTargetActor;
      targetToken = primaryResult.swappedTargetToken;
    }

    // Shield-block wall bonus (ruled 2026-08-21): the blocking shield's full
    // armorBonus joins THIS hit's mitigation — before the pipeline runs and
    // before data-mitigation-value is stamped, so display and application
    // agree (the crush/pierce lesson).
    const _blockWall = (primaryResult.bonusMitigation ?? 0)
                     + (secondaryResult?.bonusMitigation ?? 0);
    if (_blockWall > 0) mitigation += _blockWall;

    const halfFactor = hasDualDefense ? 0.5 : 1.0;
    const isHit = primaryResult.isHit || (secondaryResult?.isHit ?? false);

    // For chat output and the combat-result return value (legacy callers).
    const damageMultiplier = primaryResult.damageMultiplier;
    const defenseLine      = (primaryResult.defenseLine ?? '')
                           + (secondaryResult ? secondaryResult.defenseLine : '');
    const reactionLine     = (primaryResult.reactionLine ?? '')
                           + (secondaryResult ? secondaryResult.reactionLine : '');

    // ── self_struck passive auto-fire (defense-pool failure) ──
    // "Struck" semantically means the defense pool didn't fully absorb the
    // hit. Fires when isHit (defense check passed → hit landed) regardless
    // of whether armor/veil/barrier further reduces HP loss. Distinct from
    // self_damage_taken (which requires finalDamage > 0 past armor) and
    // hp_threshold (HP transition, still at apply-damage button).
    //
    // Was previously in the apply-damage handler (aspects-of-power.mjs)
    // gated by actualHpLoss > 0 — that was effectively "got hit AND
    // armor didn't fully soak it." Moved here to match the user's intent:
    // Shocking Retort fires when the melee pool fails, not when HP drops.
    if (isHit) {
      await this._firePassiveReactions(targetActor, attackerToken, 'self_struck');
    }

    // Damage pipeline: raw → AOE-overlap fraction → per-half defense
    // pool % → barrier (pre-armor) → armor/veil → toughness.
    //
    // AOE fraction (per design 2026-05-12): for AOE attacks, the
    // dispatch loop passes the per-target overlap fraction (0..1 of
    // the token's footprint inside the AOE shape). Single-target
    // attacks pass the default 1.0 → no scaling. A token half in the
    // explosion takes half damage all the way through.
    const fracClamped = Math.max(0, Math.min(1, aoeFraction ?? 1));
    // markDmgMult: a mark CONSUMER's payoff (1 when this skill is not one, or
    // the target carries no mark of this attacker's).
    // stackMult: a stack SPENDER's payoff — `spent ** stackScaling`, 1 when
    // this skill spends no stacks.
    // burnDetonateFlat joins AFTER the multipliers — it is relocated DoT
    // damage with its own magnitude, not part of this swing's roll.
    const rawDmg = Math.max(0, Math.round(dmgRoll.total * fracClamped * markDmgMult * stackMult) + burnDetonateFlat);
    // ⚠ ORDERING (RULED 2026-07-31): the defence multiplier is NO LONGER
    // applied here. Under the margin rule, multiplying before the flat
    // armour/DR subtraction makes a good defence plus any wall reach zero —
    // measured at 25 of 40 live matchups immune. What flows into the wall is
    // now the share of the blow that LANDED (which halves of a dual-defence
    // attack connected); the margin scales what SURVIVES the wall, below.
    const primaryContrib   = primaryResult.isHit   ? rawDmg * halfFactor : 0;
    const secondaryContrib = (secondaryResult?.isHit) ? rawDmg * halfFactor : 0;
    const afterDefense     = Math.max(0, Math.round(primaryContrib + secondaryContrib));
    // Weighted margin across the halves that actually landed. With a single
    // defence this is just its own multiplier; with two it averages them, so
    // equal multipliers reproduce the old total exactly.
    const _landed = (primaryResult.isHit ? halfFactor : 0)
                  + (secondaryResult?.isHit ? halfFactor : 0);
    const defenceMargin = _landed > 0
      ? (((primaryResult.isHit ? primaryResult.damageMultiplier * halfFactor : 0)
        + (secondaryResult?.isHit ? secondaryResult.damageMultiplier * halfFactor : 0)) / _landed)
      : 0;

    // Per-affinity damage breakdown — two contributors get bucketed here
    // so the apply-damage handler can subtract the TARGET's per-affinity
    // DR per slice:
    //   1) Augment-sourced damageBonus from equipped weapons, split per
    //      augment's `affinities` distribution (via the actor's pre-derived
    //      equippedDamageBonusByAffinity map).
    //   2) This skill's own damage, routed through `this.system.affinities`
    //      if the skill declares any. For pure-affinity spells (Ice Spear
    //      → ['ice']) the whole non-augment portion of damage lands in the
    //      skill-affinity bucket and runs through ice DR rather than
    //      generic magical DR.
    // Untyped damage (no skill affinity AND no augment affinity) flows
    // through the existing armor/DR/barrier pipeline unchanged.
    let damageBreakdownAttr = '';
    {
      const equipped = this.actor?.system?.equippedDamageBonus ?? 0;
      const breakdownRaw = this.actor?.system?.equippedDamageBonusByAffinity ?? {};
      const ratio = (Number.isFinite(dmgRoll.total) && dmgRoll.total > 0)
        ? afterDefense / dmgRoll.total
        : 0;
      const scaled = {};

      // (1) Augment damage portion.
      if (equipped > 0 && ratio > 0) {
        const totalAugmentAfter = equipped * ratio;
        const totalWeight = Object.entries(breakdownRaw)
          .filter(([k]) => k !== 'untyped')
          .reduce((s, [, v]) => s + (Number(v) || 0), 0);
        if (totalWeight > 0) {
          for (const [k, v] of Object.entries(breakdownRaw)) {
            if (k === 'untyped') continue;
            const part = Math.round(totalAugmentAfter * ((Number(v) || 0) / totalWeight));
            if (part > 0) scaled[k] = (scaled[k] || 0) + part;
          }
        }
      }

      // (1b) Weapon-buff portion (Flameblade): the flat affinity damage a
      // weapon-buff effect adds to WEAPON strikes only (recorded on rollData
      // by the strike path). Route its post-defense share through the buff's
      // affinities. Gated on the skill actually being a weapon strike so a
      // spell cast while buffed doesn't wrongly attribute buff damage it never
      // received.
      let weaponBuffAfter = 0;
      const weaponBuffRaw = rollData?.roll?.weaponBuffDamage ?? 0;
      const weaponBuffAff = rollData?.roll?.weaponBuffAffinities ?? [];
      if (weaponBuffRaw > 0 && weaponBuffAff.length > 0 && ratio > 0) {
        weaponBuffAfter = Math.round(weaponBuffRaw * ratio);
        for (const [aff, part] of Object.entries(splitEvenlyWithRemainder(weaponBuffAfter, weaponBuffAff))) {
          if (part > 0) scaled[aff] = (scaled[aff] || 0) + part;
        }
      }

      // (2) Skill-affinity portion: route the non-augment, non-weapon-buff
      // damage through the skill's affinities, split evenly across multiple
      // (the last slice absorbs rounding to keep the sum exact).
      const skillAffinities = this.system?.affinities ?? [];
      if (skillAffinities.length > 0 && ratio > 0) {
        const augmentPortion = Math.round(equipped * ratio);
        const skillPortion = Math.max(0, afterDefense - augmentPortion - weaponBuffAfter);
        if (skillPortion > 0) {
          for (const [aff, part] of Object.entries(splitEvenlyWithRemainder(skillPortion, skillAffinities))) {
            scaled[aff] = (scaled[aff] || 0) + part;
          }
        }
      }

      if (Object.keys(scaled).length > 0) {
        damageBreakdownAttr = ` data-damage-breakdown='${JSON.stringify(scaled)}'`;
      }
    }

    // Barrier absorbs before armor/veil — it takes raw (post-defense-pool) damage.
    const barrierValue = targetActor.system.barrier?.value ?? 0;
    let barrierLine = '';
    let barrierAbsorbs = 0;
    let afterBarrier = afterDefense;
    if (isHit && barrierValue > 0) {
      barrierAbsorbs = Math.min(barrierValue, afterDefense);
      afterBarrier = afterDefense - barrierAbsorbs;
      barrierLine = `<p>Barrier absorbs: ${barrierAbsorbs} / ${barrierValue}${barrierAbsorbs >= barrierValue ? ' <em>(breaks)</em>' : ''}</p>`;
    }

    // Armor/veil reduces whatever got through the barrier.
    const preToughnessDmg = Math.max(0, afterBarrier - mitigation);
    // ⚠ THE MARGIN LANDS HERE, LAST (RULED 2026-07-31) — after barrier, after
    // armour/veil, after DR. Applying it any earlier lets a decent defence
    // plus any wall reach zero. Consequence accepted: barrier and armour are
    // charged against the FULL blow, so giving ground does not preserve your
    // barrier — the shell takes the impact regardless of your footwork.
    const postDR      = Math.max(0, preToughnessDmg - effectiveToughness);
    const finalDamage = isHit ? Math.max(0, Math.round(postDR * defenceMargin)) : 0;
    const displayDamage   = finalDamage;

    // ── self_damage_taken passive auto-fire (Phase C) ──
    // Fires after the full damage pipeline computes the final number but
    // before the apply-damage button is generated (and before HP is
    // actually deducted by the GM click). Only when there IS damage to
    // take — pure misses don't trigger this hook.
    if (finalDamage > 0 && isHit) {
      await this._firePassiveReactions(targetActor, attackerToken, 'self_damage_taken');
    }

    // Dual-defense status badge: full HIT only if both halves landed; PARTIAL
    // if exactly one landed; MISS if neither did. Single-defense uses the
    // existing HIT / MISS dichotomy.
    const resultBadge = (() => {
      if (!hasDualDefense) return isHit
        ? `<strong style="color:green;">HIT</strong>`
        : `<strong style="color:red;">MISS</strong>`;
      const both = primaryResult.isHit && secondaryResult.isHit;
      const one  = primaryResult.isHit !== secondaryResult.isHit;
      if (both) return `<strong style="color:green;">HIT</strong>`;
      if (one)  return `<strong style="color:#f80;">PARTIAL</strong>`;
      return `<strong style="color:red;">MISS</strong>`;
    })();

    const hitLine = hitRoll && targetDefKey
      ? (hasDualDefense
          ? `<p>Attack: ${hitTotal} vs ${targetActor.name} — split between ${targetDefKey} + ${secondaryDefKey} defenses</p>`
          : `<p>Attack: ${hitTotal} vs ${targetActor.name}</p>`)
      : '';

    // For dual defense, show each half's contribution to make the
    // "single blow with one toughness application" intent explicit.
    const halvesLine = hasDualDefense
      ? `<p>Halves: ${primaryResult.isHit ? primaryContrib : 0} (${targetDefKey}) + ${secondaryResult.isHit ? secondaryContrib : 0} (${secondaryDefKey}) = <strong>${afterDefense}</strong></p>`
      : '';

    const toughnessLine = preToughnessDmg > 0
      ? `<p>DR: −${Math.min(effectiveToughness, preToughnessDmg)}${affinityDR > 0 ? ` <em>(−${affinityDR} affinity)</em>` : ''}</p>`
      : '';

    // Forced movement info for the button data attributes.
    const fm = item.system.tagConfig ?? {};
    const hasForcedMovement = fm.forcedMovement && isHit;
    const fmDir  = fm.forcedMovementDir ?? 'push';
    const fmDist = fm.forcedMovementDist ?? 5;
    const fmLine = hasForcedMovement
      ? `<p><strong>${game.i18n.localize('ASPECTSOFPOWER.ForcedMovement.label')}:</strong> ${game.i18n.localize(`ASPECTSOFPOWER.ForcedMovement.${fmDir}`)} ${fmDist} ft</p>`
      : '';
    // Always emit attacker-token-id so the apply-damage handler can fire
    // post-resolve triggers (self_struck, hp_threshold) at the attacker.
    // Also stash the attacker's classified attack type so the apply-damage
    // handler can apply the reactionAttackType filter (melee-only reactions
    // shouldn't fire vs ranged attackers, etc.). Forced-movement attrs
    // piggyback on the same button when applicable.
    const _attackerType = this.constructor._classifyAttackType(this);
    const _attackerActorUuid = this.actor?.uuid ?? '';
    // ⚠ THE SOURCE SKILL RIDES THE CARD (2026-08-07). `kiOnPierce` is a
    // PER-SKILL field, but the apply-damage handler only ever received the
    // attacking ACTOR — so it summed kiOnPierce across every skill the actor
    // owned and granted that total on any piercing hit, from any skill. A
    // dedicated ki builder and a skill that merely sat in the sheet were
    // indistinguishable. Stamping the skill here is what makes the field mean
    // what its name says.
    const _sourceSkillUuid = this.uuid ?? '';
    const _atkAttr = ` data-attacker-token-id="${attackerToken?.id ?? ''}" data-attacker-actor-uuid="${_attackerActorUuid}" data-attacker-attack-type="${_attackerType}" data-source-skill-uuid="${_sourceSkillUuid}"`;
    const fmAttrs = hasForcedMovement
      ? `${_atkAttr} data-forced-dir="${fmDir}" data-forced-dist="${fmDist}" data-hit-total="${hitTotal}"`
      : _atkAttr;

    // Defense-reduction line: hidden for dual defense (the per-half halvesLine
    // already conveys partial reductions); shown for single defense as before.
    const defenseReductionLine = (!hasDualDefense && damageMultiplier < 1)
      ? `<p>Defense reduction: −${Math.round((1 - damageMultiplier) * 100)}%</p>`
      : '';

    // Guardian-redirect (P2c): split the LANDED final damage — the ally keeps
    // (1−pct), the guardian takes pct RAW (Option A: no guardian armor). Override
    // the ally button to the kept amount with toughness/affinity 0 so the handler
    // doesn't re-mitigate (mitigation already applied at resolve); keep fmAttrs so
    // the ally's self_struck/hp_threshold still fire. Add a guardian apply button.
    // data-mitigation is the armor-answer lane (armor for physical+elemental,
    // veil for mind/soul) — the apply-damage handler routes on it so the actual
    // HP mitigation matches the display above. (data-damage-type is kept for
    // affinity/display semantics.)
    const _mitLane = usesVeil ? 'veil' : 'armor';
    // data-mitigation-value carries the FINAL armor/veil mitigation computed here
    // (armor lane already reduced by flat pierce/crush/melt). The apply handler
    // uses it verbatim instead of recomputing raw armor+blockDR — without this,
    // crush/pierce/melt were DISPLAY-ONLY (handler applied raw armor). Single
    // source → display and applied damage can't drift. design-burn-status.md.
    let allyApplyAttr = `data-damage="${afterDefense}"
             data-toughness="${baseDR}"
             data-affinity-dr="${affinityDR}"
             data-damage-type="${isPhysical ? 'physical' : 'magical'}"
             data-defence-margin="${defenceMargin}"
             data-lifesteal="${item.system?.tagConfig?.lifesteal ?? 0}"
             data-mitigation="${_mitLane}" data-mitigation-value="${mitigation}"${damageBreakdownAttr}${fmAttrs}`;
    let redirectLine = '';
    let redirectButton = '';
    if (redirectGuardian && isHit && finalDamage > 0) {
      const share = Math.round(finalDamage * redirectPct);
      const keep  = Math.max(0, finalDamage - share);
      allyApplyAttr = `data-damage="${keep}"
             data-toughness="0"
             data-affinity-dr="0"
             data-damage-type="${isPhysical ? 'physical' : 'magical'}"
             data-mitigation="${_mitLane}" data-mitigation-value="0"${fmAttrs}`;
      redirectLine = `<p><em>Redirected ${share} of ${finalDamage} to ${redirectGuardian.name} (${Math.round(redirectPct * 100)}%).</em></p>`;
      redirectButton = `<button class="apply-damage"
             data-actor-uuid="${redirectGuardian.uuid}"
             data-damage="${share}"
             data-toughness="0"
             data-affinity-dr="0"
             data-damage-type="${isPhysical ? 'physical' : 'magical'}"
             data-mitigation="${_mitLane}" data-mitigation-value="0"
             style="margin-top:6px;width:100%;">
             Apply redirected ${share} to ${redirectGuardian.name}
           </button>`;
    }

    const gmContent = isHit
      ? `<div class="combat-result">
           <h3>${item.name} — ${resultBadge}</h3>
           ${hitLine}
           ${defenseLine}
           ${reactionLine}
           <hr>
           <p>Raw damage: ${rawDmg}${hasDualDefense ? ' (split 50/50 across halves)' : ''}${fracClamped < 1 ? ` <em>(AOE overlap ${Math.round(fracClamped * 100)}% × ${Math.round(dmgRoll.total)} roll)</em>` : ''}</p>
           ${halvesLine}
           <p>${mitigLabel}: −${mitigation}</p>
           ${defenseReductionLine}
           ${barrierLine}
           ${toughnessLine}
           <p><strong>Final damage: ${displayDamage}</strong></p>
           ${redirectLine}
           ${fmLine}
           <button class="apply-damage"
             data-actor-uuid="${targetActor.uuid}"
             ${allyApplyAttr}
             style="margin-top:6px;width:100%;">
             Apply to ${targetActor.name}
           </button>
           ${redirectButton}
         </div>`
      : `<div class="combat-result">
           <h3>${item.name} — ${resultBadge}</h3>
           ${hitLine}
           ${defenseLine}
           ${reactionLine}
         </div>`;

    if (game.user.isGM) {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: gmContent,
      });
    } else {
      game.socket.emit('system.aspects-of-power', { type: 'gmCombatResult', content: gmContent });
    }

    // Barrier fully absorbs → flag so debuff/DoT can be skipped.
    const fullyBlocked = isHit && preToughnessDmg > 0 && barrierValue >= preToughnessDmg;
    // Pierce flag for chained-skill gating: did some damage make it past
    // the target's armor/veil into the DR layer? Used by chains tagged
    // `requires_armor_pierce` (e.g. Hemorrhage — light-warrior bleed
    // shouldn't trigger off a fully-deflected blow). Per design 2026-05-11:
    // armor and veil are interchangeable for this check since some
    // bolt-spells route through armor (Pyroblast) while bleed-style
    // chains on magical parents would want the equivalent veil-pierce
    // signal. Designers tag specific chains; untagged chains fire on hit.
    const piercedMitigation = isHit && preToughnessDmg > 0;

    // mine tag (per design 2026-05-12): summon-style skills plant a
    // persistent region "mine" at the target's position. A generic
    // Detonate skill (tag `detonate`) can later consume any of the
    // caster's mines, firing this skill's snapshotted AOE + damage
    // formula at the mine's location. FIFO-evict at mineCapacity.
    // Only on hit and only via the primary defense.
    if (isHit && (item.system.tags ?? []).includes('mine') && targetToken) {
      await this._placeMine(targetToken, item.system.tagConfig?.mineCapacity ?? 1);
    }

    return { isHit, fullyBlocked, damageMultiplier, piercedMitigation };
  }

  /**
   * Place a mine region at a target token's position. Used by mine-
   * tagged skills (Steel Tree Summon, etc.) so the generic Detonate
   * skill can later consume any one of the caster's mines.
   *
   * The mine snapshots THIS skill's roll config and aoe shape/size at
   * placement — Detonate reads these back to build the explosion. That
   * keeps the explosion identity with the summon (different mine =
   * different explosion) without requiring a paired attack-skill.
   *
   * - FIFO-eviction at capacity per caster + summon-source.
   * - Region is small (5ft circle), visible to everyone, persists
   *   indefinitely until detonated.
   *
   * @param {Token|TokenDocument} targetToken
   * @param {number} capacity   max concurrent mines of THIS summon per caster
   */
  async _placeMine(targetToken, capacity) {
    if (!this.actor) return;
    const tokenDoc = targetToken.document ?? targetToken;
    const tokenObj = targetToken.object ?? targetToken;
    const center = tokenObj.center ?? {
      x: tokenDoc.x + (tokenDoc.width * canvas.grid.size) / 2,
      y: tokenDoc.y + (tokenDoc.height * canvas.grid.size) / 2,
    };
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const radiusPx = 5 * pxPerFt;
    const casterUuid = this.actor.uuid;
    const summonUuid = this.uuid;

    // FIFO-evict over capacity for THIS summon-source on THIS caster.
    // Different summons (Steel Tree vs. future Crystal Bomb) each have
    // their own capacity counter.
    const existing = (canvas.scene?.regions?.contents ?? []).filter(r => {
      const f = r.flags?.['aspects-of-power'];
      return f?.mine === true && f?.summonItemUuid === summonUuid && f?.casterActorUuid === casterUuid;
    }).sort((a, b) => (a.flags?.['aspects-of-power']?.placedAt ?? 0)
                    - (b.flags?.['aspects-of-power']?.placedAt ?? 0));
    while (existing.length >= capacity) {
      const toDelete = existing.shift();
      if (toDelete) await this._gmDeleteRegion(canvas.scene, toDelete.id);
    }

    const regionData = {
      name: `${this.name} mine`,
      color: '#caa64f', // warm steel-amber
      visibility: 2, // ALWAYS visible to all players
      shapes: [{ type: 'circle', x: center.x, y: center.y, radius: radiusPx }],
      behaviors: [], // pure marker — no entry/movement triggers
      flags: {
        'aspects-of-power': {
          mine: true,
          summonItemUuid: summonUuid,
          summonSkillName: this.name,
          casterActorUuid: casterUuid,
          placedAt: Date.now(),
          // Snapshot of the summon's roll + aoe so Detonate can fire
          // exactly the right explosion later, even if the summon item
          // is edited or unequipped between placement and detonation.
          summonAoe: foundry.utils.deepClone(this.system.aoe ?? {}),
          summonRoll: foundry.utils.deepClone(this.system.roll ?? {}),
          summonTags: [...(this.system.tags ?? [])],
        },
      },
    };
    await this._gmCreateRegion(canvas.scene, regionData);
  }

  /**
   * Summon tag (per design-summon-subsystem.md): clone the caster into a
   * temporary world actor with HP override + drop a token at the chosen
   * destination. If `summonSwapOnRecast` is true and a live summon of this
   * type already exists, swap positions instead.
   *
   * Fires once per cast (not per target). Skill picks its own destination
   * via destination-prompt, range = caster's `castingRange`.
   */
  async _handleSummonTag(item, rollData, speaker, rollMode, label, preInvestAmount = 0, summonRoll = null) {
    if (!this.actor) return;
    const tc = item.system.tagConfig ?? {};
    // Equipment summon — conjured gear, not a creature. Gated on its own
    // field and handled before the creature gate: a skill is one or the
    // other, and equipment needs no token, no destination, no capacity.
    if (tc.summonItemName) {
      const { executeEquipmentSummon } = await import('../systems/summon-equipment.mjs');
      await executeEquipmentSummon(this, speaker, rollMode);
      return;
    }
    if (!tc.summonType) return;
    const { SummonHelpers } = await import('../systems/summon.mjs');

    const casterToken = this.actor.getActiveTokens?.()?.[0]?.document ?? null;
    if (!casterToken) {
      ui.notifications.warn(`${this.name}: no caster token on canvas.`);
      return;
    }

    // Swap-on-recast: if a live summon of this type exists, swap and exit.
    if (tc.summonSwapOnRecast) {
      const existing = SummonHelpers.findSummonsOf(this.actor, { summonType: tc.summonType });
      if (existing.length > 0) {
        const cloneTokenDoc = existing[existing.length - 1];
        await SummonHelpers.swapPositions(casterToken, cloneTokenDoc);
        ChatMessage.create({
          speaker, rollMode,
          content: `<p><em>${this.actor.name} swaps places with their ${cloneTokenDoc.name} via <strong>${this.name}</strong>.</em></p>`,
        });
        return;
      }
    }

    // No existing clone → pick destination + spawn.
    const { selectDestinationOnCanvas } = await import('../canvas/destination-prompt.mjs');
    const maxFt = this.actor.system?.castingRange ?? 40;
    const dest = await selectDestinationOnCanvas(casterToken.object ?? casterToken, {
      maxDistanceFt: maxFt,
      requireSight: true,
      snapToGrid: true,
      label: this.name,
      message: `Click summon destination for ${this.name} (range ${maxFt} ft; Esc cancels).`,
    });
    if (!dest) {
      ui.notifications.info(`${this.name} cancelled.`);
      return;
    }

    // Tower-variant route (per plan pure-gathering-ullman.md, 2026-05-29).
    // When `summonAsTower` is true, clone from a stub NPC + apply ritualPower
    // × statDistribution as ability-score overrides + set AI flags. Otherwise
    // fall through to the fragile-decoy clone path (Ice Clone).
    if (tc.summonAsTower) {
      // ritualPower comes from the activator's preInvestAmount (passed by the
      // ritual-activation path at item.mjs:5852 and threaded through the
      // dispatch loop into _handleSummonTag's preInvestAmount arg).
      const rawRitualPower = preInvestAmount ?? 0;
      if (!tc.summonStubActorUuid || rawRitualPower <= 0) {
        ui.notifications.warn(`${this.name}: tower spawn requires summonStubActorUuid + non-zero ritualPower (got ${rawRitualPower}).`);
        return;
      }
      // AI behavior brain: summonBehaviors (new) supersedes summonAiProfile. The
      // behavior tier DILUTES effective ritualPower — a smarter conjuration needs
      // a stronger medium for the same stats ("higher ritualPower" cost, per the
      // unified per-subsystem cost ruling). [[design-ai-behavior-tags]]
      let aiFlags = null, costMult = 1;
      if ((tc.summonBehaviors ?? []).length) {
        const { resolveAiBehaviors } = await import('/systems/aspects-of-power/module/systems/ai.mjs');
        const b = resolveAiBehaviors(tc.summonBehaviors);
        aiFlags = b.flags; costMult = b.costMult;
      }
      const ritualPower = Math.max(1, Math.round(rawRitualPower / costMult));
      const tower = await SummonHelpers.spawnTower({
        stubActorUuid:    tc.summonStubActorUuid,
        scene:            canvas.scene,
        position:         { x: dest.x, y: dest.y },
        ownerActorUuid:   this.actor.uuid,
        ritualPower,
        statDistribution: tc.summonStatDistribution ?? {},
        aiProfile:        aiFlags?.aiProfile ?? tc.summonAiProfile ?? 'primitive',
        aiSkillUuid:      tc.summonAiSkillUuid ?? '',
        aiFlags,
        summonType:       tc.summonType,
        sourceSkillUuid:  this.uuid,
        capacity:         tc.summonCapacity,
        extraTags:        tc.summonExtraTags ?? [],
      });
      if (tower) {
        ChatMessage.create({
          speaker, rollMode,
          content: `<p><em>${this.actor.name} erects <strong>${tower.tokenDoc.name}</strong> (ritualPower ${ritualPower}).</em></p>`,
        });
      }
      return;
    }

    // Resolve AI behavior tags → flags stamped on the clone (opt-in: only when
    // summonBehaviors is set; bare decoy clones stay passive). [[design-ai-behavior-tags]]
    let summonAiFlags = null;
    const behKeys = tc.summonBehaviors ?? [];
    if (behKeys.length) {
      const { resolveAiBehaviors } = await import('/systems/aspects-of-power/module/systems/ai.mjs');
      summonAiFlags = resolveAiBehaviors(behKeys).flags;
    }

    // V × VECTOR (unified summon model, 2026-07-25). One roll in, a
    // creature-shaped stat block out — the same math the tower path has always
    // used, so clone-summons stop being a bespoke flat-HP special case.
    //   V      = the ritual medium's power when activated that way, else this
    //            cast's own roll (already scales with the caster's stats and
    //            the skill's rarity — exactly the summoner-model definition).
    //   vector = tagConfig.summonStatDistribution, the creature's SHAPE.
    // Skills with no vector fall back to the legacy hpOverride branch.
    const summonVector = tc.summonStatDistribution ?? {};
    const summonV = (preInvestAmount > 0)
      ? preInvestAmount
      : Math.max(0, Math.round(summonRoll?.total ?? 0));
    const spawned = await SummonHelpers.spawnSummon({
      sourceActor:     this.actor,
      scene:           canvas.scene,
      position:        { x: dest.x, y: dest.y },
      summonType:      tc.summonType,
      sourceSkillUuid: this.uuid,
      hpOverride:      tc.summonHpOverride,
      capacity:        tc.summonCapacity,
      namePrefix:      '',
      aiFlags:         summonAiFlags,
      statValue:       summonV,
      statVector:      summonVector,
    });
    if (spawned) {
      ChatMessage.create({
        speaker, rollMode,
        content: `<p><em>${this.actor.name} conjures <strong>${spawned.tokenDoc.name}</strong> via ${this.name}.</em></p>`,
      });
    }
  }

  /**
   * Channel tag (per plan pure-gathering-ullman.md, 2026-05-29). Each cast
   * starts a new channel OR continues an existing one on the same target.
   * Different-target re-cast resets the ramp. Damage applies via per-tick
   * scheduler (channel.mjs), NOT here — this handler just registers state.
   *
   * Target resolution: preTargetIds (when invoked via AI .roll({preTargetIds}))
   * or game.user.targets.first() for direct player cast.
   */
  async _handleChannelTag(item, rollData, speaker, rollMode, label) {
    if (!this.actor) return;
    const tc = item.system?.tagConfig ?? {};
    if (!tc.channel) return;

    const targetToken = game.user.targets.first() ?? null;
    if (!targetToken) {
      ui.notifications.warn(`${this.name}: no target selected.`);
      return;
    }

    const { ChannelHelpers } = await import('../systems/channel.mjs');
    const existing = ChannelHelpers.findChannelOf(this.actor.uuid);
    const state = await ChannelHelpers.startOrContinueChannel(this.actor, item, targetToken);
    if (!state) {
      ui.notifications.warn(`${this.name}: channel could not start.`);
      return;
    }

    const continuing = existing
      && existing.targetTokenId === (targetToken.document?.id ?? targetToken.id)
      && existing.targetActorUuid === (targetToken.actor?.uuid ?? '');
    const phrase = continuing
      ? `<em>${this.actor.name} sustains <strong>${this.name}</strong> on ${targetToken.document?.name ?? targetToken.name} (tick ${state.consecutiveOnTarget}).</em>`
      : `<em>${this.actor.name} begins <strong>${this.name}</strong> on ${targetToken.document?.name ?? targetToken.name}.</em>`;
    ChatMessage.create({ speaker, rollMode, content: `<p>${phrase}</p>` });
  }

  /**
   * Prompt the target's owner to choose whether to defend with their pool.
   * Player-owned targets are prompted via socket; GM-owned via direct dialog.
   */
  async _promptDefensePool(targetActor, defKey, hitTotal, attackName, effectiveHit = null) {
    // effectiveHit: the shrapnel-multiplied hit the MENTAL-lane pool is
    // actually depleted against in _resolveDefenseCheck. The preview used to
    // compute full/partial off raw hitTotal, promising "Full dodge, pool
    // 400→100" and then delivering partial. Physical-lane text stays on raw
    // hitTotal — the dodge roll genuinely compares against it (shrapnel
    // penalizes the dodge roll instead).
    const mentalHit = Math.max(1, Math.round(effectiveHit ?? hitTotal));
    const pool    = targetActor.system.defense[defKey]?.pool ?? 0;
    const poolMax = targetActor.system.defense[defKey]?.poolMax ?? 0;
    const defLabel = defKey.charAt(0).toUpperCase() + defKey.slice(1);

    // Gather reaction skills, filtered by trigger + cooldown + resource.
    // Phase B v1 = trigger `self_attacked` (this prompt fires when the actor
    // is being attacked). Legacy reactions with no trigger set are included
    // for back-compat. Cooldowns and resource costs gate availability.
    const reactions = targetActor.system.reactions ?? { value: 0, max: 1 };
    // Cooldown entries: skillId → roundsRemaining. Entry present with > 0 = on cooldown.
    const cooldowns = targetActor.flags?.aspectsofpower?.reactionCooldowns ?? {};
    // Lazy summon-presence check used only by swap-typed reactions.
    let _hasSummon = null;
    const hasSummonPresence = () => {
      if (_hasSummon !== null) return _hasSummon;
      try {
        // Sync import not possible — fall back to the scene-tokens flag check
        // inline (same predicate as SummonHelpers.findSummonsOf).
        const ownerUuid = targetActor.uuid;
        const tokens = canvas.scene?.tokens?.contents ?? [];
        _hasSummon = tokens.some(t => t.flags?.['aspects-of-power']?.summon?.ownerActorUuid === ownerUuid);
      } catch (_e) { _hasSummon = false; }
      return _hasSummon;
    };
    // Guard stance state, resolved ONCE for the filter below: parry-class
    // reactions require it (design-guard-stances), and a lightning-class
    // stance (stanceParryCooldownFree) waives the parry COOLDOWN while held
    // — rate then bound only by the reaction budget (RULED 2026-08-21:
    // "increased parry rate", no entry discounts).
    const _gsEnabled = CONFIG.ASPECTSOFPOWER.guardStance?.enabled ?? true;
    const _gsCbt = _gsEnabled ? findCombatantForActor(targetActor) : null;
    const _gsStance = _gsCbt?.flags?.aspectsofpower?.guardStance ?? null;
    const reactionSkills = targetActor.items.filter(s => {
      if (s.type !== 'skill' || s.system.skillType !== 'Reaction') return false;
      const trig = s.system.tagConfig?.reactionTrigger ?? '';
      // Empty trigger = legacy; include for back-compat. Specific trigger
      // must match the current event (`self_attacked`).
      if (trig && trig !== 'self_attacked') return false;
      // Parries AND blocks are guard-work (blocks ruled their own type
      // 2026-08-21: "a block is a block: it adds armor") — both require
      // the raised stance; the lightning cooldown waiver stays parry-only.
      const _rt = s.system.reactionType ?? 'dodge';
      const _isParry = _rt === 'parry';
      const _isGuardWork = _isParry || _rt === 'block';
      if ((cooldowns[s.id] ?? 0) > 0
          && !(_isParry && _gsStance?.parryCooldownFree)) return false;
      // Resource gate: actor must be able to afford the cost.
      const resKey = s.system.roll?.resource;
      const cost   = s.system.roll?.cost ?? 0;
      if (resKey && cost > 0) {
        const have = targetActor.system[resKey]?.value ?? 0;
        if (have < cost) return false;
      }
      // Swap-reaction gate: hide unless the actor has a live summon to swap with.
      if ((s.system.reactionType ?? '') === 'swap' && !hasSummonPresence()) return false;
      // GUARD STANCE gate (design-guard-stances, RULED 2026-08-21): in an
      // active combat, parry- and block-class reactions require the raised
      // guard — the pre-paid answer. Out of combat there is no economy to
      // bypass, so both stay available (`enabled: false` reverts wholesale).
      if (_isGuardWork && _gsEnabled && _gsCbt && !_gsStance) return false;
      // Authored stance requirement (Shield Wall etc. — "stance required
      // unless a skill exists to remove that requirement").
      if (s.system.tagConfig?.requiresGuardStance === true
          && _gsEnabled && _gsCbt && !_gsStance) return false;
      return true;
    });
    const reactionList = reactionSkills.map(s => ({
      id: s.id, name: s.name, img: s.img,
      reactionType: s.system.reactionType ?? 'dodge',
      available: reactions.value > 0,
    }));

    // ── Lane split (active defense, design-active-defense.md) ──
    // Physical lanes (melee/ranged): "defend" = DODGE — an opposed roll off
    // defense.value, scramble-penalized, blind-gated, costing celerity time.
    // Mental lanes (mind/soul): legacy pool semantics unchanged.
    const isPhysicalLane = defKey === 'melee' || defKey === 'ranged';
    const dt = CONFIG.ASPECTSOFPOWER.defenseTuning ?? {};

    // ── Perceive-to-react gate (design-celerity-realtime.md) ──
    // Too large a Celerity gap and the blow is a blur: no dodge, no parry,
    // no reaction. Physical lanes only — mind/soul are not reflexes, they
    // are the veil holding, and a thought does not arrive too fast to see.
    const gate = isPhysicalLane
      ? perceiveGate(this.actor, targetActor)
      : { canReact: true, ratio: 1, waived: false };
    if (!gate.canReact) reactionList.length = 0;

    let hasDefend, defendLabel, defenseText;
    // DEFENCE-TIME BUDGET: cost of dodging THIS swing, and what is left.
    // `this` is the attacking item, so the swing's committed ticks come from
    // the same computeActionWait the attacker paid.
    const _econBudget = (dt.defenseEconModel ?? 'budget') === 'budget';
    let _budget = null, _dodgeCost = 0, _surcharge = 0;
    if (isPhysicalLane && _econBudget) {
      let heft = 100;
      try { heft = computeActionHeft(this.actor, this, null, null, { forDefense: true }); } catch (e) { /* no combat context */ }
      _budget = getDefenseBudget(targetActor);
      const rawCost = defenseTimeCost(heft, actorRoundLength(targetActor), dt);
      _dodgeCost = Math.min(rawCost, _budget.max);
      _surcharge = defenseDiveSurcharge(rawCost, _budget.max, targetActor.system.stamina?.max ?? 0, dt);
    }
    if (isPhysicalLane) {
      // Perception gate: you can't dodge what you can't see.
      const blinded = targetActor.effects.some(e => !e.disabled && e.system?.debuffType === 'blind');
      const stacks = _econBudget ? 0 : getScrambleStacks(targetActor);
      const dv = Math.round(effectiveDodgeValue(targetActor, defKey, stacks, dt));
      // Over-cap blows: divable only at FULL reserve, and only if the
      // stamina surcharge is payable. In-cap blows: plain affordability.
      const _isDive = _surcharge > 0;
      const _stam = targetActor.system.stamina?.value ?? 0;
      const affordable = !_econBudget
        || (_isDive ? (_budget.remaining >= _budget.max && _stam >= _surcharge)
          : _budget.remaining >= _dodgeCost);
      hasDefend = !blinded && dv > 0 && gate.canReact && affordable;
      defendLabel = _isDive ? 'Dive' : 'Dodge';
      const scrambleNote = (!_econBudget && stacks >= 1)
        ? ` (scramble −${Math.round((dt.scrambleStackPct ?? 0.15) * stacks * 100)}%)`
        : '';
      const econNote = _econBudget
        ? (_isDive
          ? `<p><em>A dive beyond limits: your ENTIRE reserve + ${_surcharge} stamina.</em></p>`
          : `<p><em>Costs ${_dodgeCost} defence time (${_budget.remaining}/${_budget.max} left).</em></p>`)
        : `<p><em>Dodging delays your next action and adds a scramble stack — win or lose.</em></p>`;
      defenseText = hasDefend
        ? `<p>Dodge value: <strong>${dv}</strong>${scrambleNote} vs to-hit ${hitTotal}.</p>` + econNote
        : (blinded ? `<p><em>Blinded — you cannot dodge what you cannot see.</em></p>`
          : (!gate.canReact
            ? `<p><em>Too fast to react — the blow lands before you can move (${gate.ratio.toFixed(1)}x your Celerity).</em></p>`
            : (_econBudget && _budget
              ? (_isDive
                ? `<p><em>Diving from this needs a FULL reserve (${_budget.remaining}/${_budget.max}) and ${_surcharge} stamina (${_stam} left).</em></p>`
                : `<p><em>Out of defence time — this dodge needs ${_dodgeCost}, ${_budget.remaining} left.</em></p>`)
              : '')));
    } else {
      hasDefend = pool > 0;
      defendLabel = 'Defend';
      const fullDodge = pool > 0 && pool >= mentalHit;
      defenseText = '';
      if (pool > 0) {
        const outcomeText = fullDodge
          ? `<strong>Full dodge.</strong> Pool: ${pool} → ${pool - mentalHit}`
          : `<strong>Partial defense (${Math.round((pool / mentalHit) * 100)}% reduction).</strong> Pool: ${pool} → 0`;
        defenseText = `<p>${defLabel} defense pool: ${pool} / ${poolMax}</p><p>If you defend: ${outcomeText}</p>`;
      }
    }

    // ── AI defense auto-policy ──
    // AI-flagged defenders decide without any dialog: physical lanes dodge
    // when the exact win probability (single d20 vs the rolled hit total)
    // meets the threshold, else eat through bulk; mental lanes spend pool
    // whenever it exists. GM gets a whispered one-liner instead of a prompt.
    // Opt out per-actor with flags.aspectsofpower.aiDefense = 'manual'.
    const aiFlags = targetActor.flags?.aspectsofpower ?? {};
    if (aiFlags.aiProfile && (aiFlags.aiDefense ?? 'auto') === 'auto') {
      let defend = false;
      let note = gate.canReact ? 'takes the hit' : 'cannot react — too fast to see';
      if (isPhysicalLane && hasDefend) {
        // hasDefend already carries the budget-affordability gate under the
        // budget economy, so the AI cannot overdraw defence time.
        const aiStacks = _econBudget ? 0 : getScrambleStacks(targetActor);
        const aiDv = effectiveDodgeValue(targetActor, defKey, aiStacks, dt);
        // Under THE MARGIN RULE defending is never wasted — any dodge basis
        // turns aside a proportional share — so the old "35% chance of TOTAL
        // avoidance" gate is far too conservative and would have AI actors eat
        // blows they could have halved. Decide on the EXPECTED REDUCTION
        // instead; the brake on always-defending is the scramble stack and the
        // tempo cost, not the odds. `aiDodgeWinProbMin` is retained only for
        // the whispered readout.
        const p = _dodgeWinProb(aiDv, hitTotal);
        const expReduction = 1 - defenceMarginMultiplier(aiDv, hitTotal);
        defend = expReduction >= (dt.aiDefendMinReduction ?? 0.20);
        note = defend
          ? `defends (turns aside ≈${Math.round(expReduction * 100)}%, full-avoid p≈${Math.round(p * 100)}%)`
          : `takes the hit (would only turn aside ≈${Math.round(expReduction * 100)}%)`;
      } else if (!isPhysicalLane && pool > 0) {
        defend = true;
        note = 'spends pool';
      }
      ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `<p><em>[AI] ${targetActor.name} ${note} vs ${attackName}.</em></p>`,
      });
      return { defend, reactionSkillId: null, perceiveGated: !gate.canReact, perceiveRatio: gate.ratio };
    }

    // Nothing to offer at all — eat the hit without a prompt.
    if (!hasDefend && reactionList.length === 0) {
      return { defend: false, reactionSkillId: null, perceiveGated: !gate.canReact, perceiveRatio: gate.ratio };
    }

    const reactionText = reactionList.length > 0
      ? `<p>Reactions: ${reactions.value} / ${reactions.max}</p>`
      : '';

    const promptContent = `<p><strong>${attackName}</strong> incoming (to-hit: ${hitTotal})</p>${defenseText}${reactionText}`;

    // Find the owning player — only prompt the user whose assigned character
    // IS this actor. Ownership permissions alone are not enough (players may
    // have OWNER on NPCs/mobs without being the defender).
    const characterOwner = game.users.find(u =>
      u.active && !u.isGM && u.character?.id === targetActor.id
    );
    const playerOwner = characterOwner?.id ?? null;

    let result = { defend: false, reactionSkillId: null };
    if (playerOwner) {
      const requestId = foundry.utils.randomID();
      result = await new Promise((resolve) => {
        const timeout = setTimeout(() => { cleanup(); resolve({ defend: false, reactionSkillId: null }); }, 30000);
        const handler = (response) => {
          if (response.type !== 'defensePromptResponse' || response.requestId !== requestId) return;
          cleanup();
          resolve({ defend: response.defend, reactionSkillId: response.reactionSkillId ?? null });
        };
        const cleanup = () => {
          clearTimeout(timeout);
          game.socket.off('system.aspects-of-power', handler);
        };
        game.socket.on('system.aspects-of-power', handler);
        game.socket.emit('system.aspects-of-power', {
          type: 'defensePrompt',
          targetUserId: playerOwner,
          targetName: targetActor.name,
          promptContent,
          requestId,
          hasDefend,
          defendLabel,
          reactionSkills: reactionList,
        });
      });
    } else if (game.user.isGM) {
      // GM-owned target and we ARE the GM — show dialog locally.
      result = await this._showDefenseDialog(targetActor.name, promptContent, hasDefend, reactionList, defendLabel);
    } else {
      // GM-owned target but a player is attacking — route to GM via socket.
      const requestId = foundry.utils.randomID();
      const gmUser = game.users.find(u => u.isGM && u.active);
      if (gmUser) {
        result = await new Promise((resolve) => {
          const timeout = setTimeout(() => { cleanup(); resolve({ defend: false, reactionSkillId: null }); }, 30000);
          const handler = (response) => {
            if (response.type !== 'defensePromptResponse' || response.requestId !== requestId) return;
            cleanup();
            resolve({ defend: response.defend, reactionSkillId: response.reactionSkillId ?? null });
          };
          const cleanup = () => {
            clearTimeout(timeout);
            game.socket.off('system.aspects-of-power', handler);
          };
          game.socket.on('system.aspects-of-power', handler);
          game.socket.emit('system.aspects-of-power', {
            type: 'defensePrompt',
            targetUserId: gmUser.id,
            targetName: targetActor.name,
            promptContent,
            requestId,
            hasDefend,
            defendLabel,
            reactionSkills: reactionList,
          });
        });
      }
    }

    return result;
  }

  /**
   * Show the defense/reaction dialog locally (for GM-owned targets).
   * Returns { defend: boolean, reactionSkillId: string|null }.
   */
  async _showDefenseDialog(targetName, promptContent, hasDefend, reactionSkills, defendLabel = 'Defend') {
    const buttons = [];
    if (hasDefend) {
      buttons.push({ action: 'defend', label: defendLabel, icon: 'fas fa-shield-alt', default: true });
    }
    for (const rs of reactionSkills) {
      if (rs.available) {
        buttons.push({ action: `reaction:${rs.id}`, label: rs.name, icon: 'fas fa-bolt' });
      } else {
        buttons.push({ action: `reaction:${rs.id}`, label: `${rs.name} (no reactions)`, icon: 'fas fa-bolt', disabled: true });
      }
    }
    buttons.push({ action: 'takeHit', label: 'Take Hit' });

    const action = await foundry.applications.api.DialogV2.wait({
      window: { title: `Defend — ${targetName}` },
      content: promptContent,
      buttons,
      close: () => 'takeHit',
    });

    if (action === 'defend') return { defend: true, reactionSkillId: null };
    if (typeof action === 'string' && action.startsWith('reaction:')) {
      return { defend: false, reactionSkillId: action.slice('reaction:'.length) };
    }
    return { defend: false, reactionSkillId: null };
  }

  /**
   * Resolve the effective reach of a melee skill in feet.
   *
   *   skill.system.reach > 0  →  use that (skill explicitly overrides weapon)
   *   else                    →  use the wielded weapon's reach
   *   else                    →  5 (default melee reach)
   *
   * @param {Item|null} weapon  Optional pre-resolved weapon (avoids re-lookup).
   * @returns {number}  Reach in feet.
   */
  _resolveSkillReach(weapon = null) {
    const skillReach = this.system?.reach ?? 0;
    let reach = skillReach > 0
      ? skillReach
      : ((weapon ?? this._resolveWeaponForSkill?.())?.system?.reach ?? 5);
    if ((this.system?.alterations ?? []).some(a => a.id === 'thrust')) reach += 5;
    return reach;
  }

  /**
   * Cleave cone size in feet. Base Cleave caps at 5ft regardless of weapon;
   * actors with the `cleave-expansion` passive tag scale up to full weapon
   * reach (via _resolveSkillReach). The expansion is binary — no per-step
   * stamina cost. The passive itself is the gate.
   */
  _resolveCleaveReach(weapon = null) {
    const fullReach = this._resolveSkillReach(weapon);
    if (this.actor?.hasTag?.('cleave-expansion')) return fullReach;
    return Math.min(fullReach, 5);
  }

  /**
   * Range-gate a melee strike at declare time. Returns true if all targets
   * are within the effective reach; false (with chat warning) if any target
   * is out of range. No-op for non-melee skills, for AOE/Cleave skills (which
   * use cone shape instead of target distance), and for skills with no token
   * targets selected (untargeted casts proceed under existing rules).
   *
   * Distance: edge-to-edge (subtracts caster + target token radii) so
   * adjacent tokens count as touching at 0ft, matching tabletop intuition.
   */
  _checkMeleeReach() {
    const meleeTypes = new Set(['str_weapon', 'dex_weapon', 'magic_melee']);
    if (!meleeTypes.has(this.system?.roll?.type)) return true;
    const hasCleave = (this.system?.alterations ?? []).some(a => a.id === 'cleave');
    if (hasCleave) return true; // Cleave gates by cone shape, not target distance.
    // AOE skills (Blazing Greatsword, etc.) are placement-gated, not
    // target-reach-gated — their cone/circle/rect determines who's hit.
    // Without this skip, magic_melee AOEs incorrectly demanded a melee-reach
    // target before placement.
    const tags = this.system?.tags ?? [];
    if (this.system?.aoe?.enabled === true || tags.includes('aoe')
        || (this.system?.alterations ?? []).some(a => (a.id ?? a) === 'aoe')) return true;

    const targets = [...game.user.targets];
    if (targets.length === 0) return true;

    const casterToken = this.actor?.getActiveTokens?.()?.[0];
    if (!casterToken) return true;

    const reach = this._resolveSkillReach();
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const reachPx = reach * pxPerFt;

    for (const tgt of targets) {
      // Token center-to-center distance, then subtract approximate radii so
      // a Medium creature 5ft away (one square over) reads as ~0ft edge dist.
      const cx = casterToken.center?.x ?? casterToken.x;
      const cy = casterToken.center?.y ?? casterToken.y;
      const tx = tgt.center?.x ?? tgt.x;
      const ty = tgt.center?.y ?? tgt.y;
      const dist = Math.hypot(tx - cx, ty - cy);
      const casterRadius = (casterToken.w ?? canvas.grid.size) / 2;
      const tgtRadius    = (tgt.w ?? canvas.grid.size) / 2;
      const edgeDist     = Math.max(0, dist - casterRadius - tgtRadius);
      if (edgeDist > reachPx) {
        const edgeFt = Math.round(edgeDist / pxPerFt);
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          flavor: this.name,
          content: `<p><em>⚠️ ${tgt.document?.name ?? tgt.name ?? 'Target'} is ${edgeFt} ft away (reach ${reach} ft). Out of range — strike fails to land.</em></p>`,
        });
        return false;
      }
    }
    return true;
  }

  /**
   * Compute total toughness DR reduction from debuffs on the target that
   * share an affinity or magic type with this skill.
   *
   * Directional debuffs (directions.length > 0) only apply when the attacker
   * is currently in one of those positions relative to the target.
   * Non-directional debuffs (directions: []) always apply when affinity matches.
   *
   * @param {Actor} targetActor
   * @param {Token|null} attackerToken  The attacker's canvas token.
   * @param {Token|null} targetToken    The target's canvas token.
   * @returns {number}
   */
  /**
   * FLAT armor-crush reduction (armor-answer system, flat rework 2026-07-18):
   * sum the stored `armorCrushFlat` (absolute, anchored to each applier's hit)
   * across active crush debuffs, using at most armorCrushMaxStacks of them
   * (largest first). Grade-correct — the amount reflects the attackers' output,
   * not the target's armor. design-burn-status.md.
   * @returns {number} absolute armor reduction
   */
  _getArmorCrushFlat(targetActor) {
    const aa = CONFIG.ASPECTSOFPOWER.armorAnswer ?? {};
    const maxStacks = aa.armorCrushMaxStacks ?? 3;
    const vals = [];
    for (const effect of targetActor.allApplicableEffects()) {
      const v = Number(effect.system?.armorCrushFlat ?? 0) || 0;
      if (v > 0) vals.push(v);
    }
    vals.sort((a, b) => b - a);
    return vals.slice(0, maxStacks).reduce((s, v) => s + v, 0);
  }

  /**
   * FLAT armor-MELT reduction (design-burn-status.md): fire's answer to armor.
   * Sums `armorMeltRate × dotDamage` over active burn stacks that OPT IN via a
   * non-zero armorMeltRate — a generic bleed/poison DoT never melts armor.
   * GLOBAL: any attacker benefits from a burned target's softened armor, and
   * stacks from multiple casters sum (swarm-vs-superior is valid).
   * @returns {number} absolute armor reduction
   */
  _getArmorMeltFlat(targetActor) {
    let total = 0;
    for (const effect of targetActor.allApplicableEffects()) {
      const rate = Number(effect.system?.armorMeltRate ?? 0) || 0;
      if (rate <= 0) continue;
      const dot = Number(effect.system?.dotDamage ?? 0) || 0;
      if (dot > 0) total += rate * dot;
    }
    return Math.round(total);
  }

  _getAffinityDRReduction(targetActor, attackerToken = null, targetToken = null) {
    const skillMagicType  = (this.system.tags ?? []).includes('magic') ? 'magical' : '';
    const rollType = this.system.roll?.type;
    const isPhysWeaponType = rollType === 'str_weapon' || rollType === 'dex_weapon' || rollType === 'phys_ranged';

    const skillAffinities = [...(this.system.affinities ?? [])];
    if (isPhysWeaponType && !skillMagicType) {
      // "A sword is a sword" (ruled 2026-07-03): a weapon STRIKE is always
      // physical, PLUS the WIELDED WEAPON's enchant affinity (a lightning
      // sword deals phys + lightning → matches both a physical and a lightning
      // stripper). We derive from the WEAPON only — NOT the actor's aggregate
      // collectedTags, which would smear every equipped gear affinity onto
      // every swing (a fire ring + ice armor shouldn't colour a sword-strike).
      if (!skillAffinities.includes('physical')) skillAffinities.push('physical');
      const weapon = this._resolveWeaponForSkill?.();
      const wpnAff = [
        ...((weapon?.system?.tags ?? [])
          .filter(t => typeof t === 'string' && t.endsWith('-affinity'))
          .map(t => t.replace('-affinity', ''))),
        ...(weapon?.system?.affinities ?? []),
      ];
      for (const aff of wpnAff) if (!skillAffinities.includes(aff)) skillAffinities.push(aff);
    } else if (this.actor?.system?.collectedTags) {
      // Magic / non-weapon skills keep the actor-innate affinity merge
      // (a fire-affinity caster's spells read fire) — unchanged behavior.
      for (const [tagId, data] of this.actor.system.collectedTags) {
        if (data.category === 'affinity') {
          const affinityName = tagId.replace('-affinity', '');
          if (!skillAffinities.includes(affinityName)) skillAffinities.push(affinityName);
        }
      }
    }
    if (!skillAffinities.length && !skillMagicType) return 0;

    const currentPositions = (attackerToken && targetToken)
      ? getPositionalTags(attackerToken, targetToken)
      : [];

    let total = 0;
    for (const effect of targetActor.allApplicableEffects()) {
      const sys = effect.system ?? {};
      // DR-strip is now OPT-IN (armor-answer system): only dedicated stripper
      // debuffs (drStrip:true) melt DR — a generic affinity DoT no longer does.
      if (!sys.drStrip) continue;
      if (!sys.debuffDamage || !sys.dot) continue;

      const effectAffinities = sys.affinities ?? [];
      const effectMagicType  = sys.magicType ?? '';
      const effectDirections = sys.directions ?? [];

      const sharesAffinity  = skillAffinities.some(a => effectAffinities.includes(a));
      const sharesMagicType = skillMagicType && skillMagicType === effectMagicType;
      if (!(sharesAffinity || sharesMagicType)) continue;

      if (effectDirections.length > 0 && !currentPositions.some(p => effectDirections.includes(p))) continue;

      total += sys.debuffDamage;
    }
    return total;
  }

  /**
   * Companion to `_gmCreateRegion`. Players can't delete regions they don't
   * OWN — so the rollback path on cast cancellation has to route through the
   * GM the same way creation does. Fire-and-forget; we don't wait for a
   * response since the player has nothing to do with the result.
   */
  _gmDeleteRegion(scene, regionId) {
    if (game.user.isGM) {
      const region = scene.regions.get(regionId);
      if (region) return scene.deleteEmbeddedDocuments('Region', [regionId]);
      return Promise.resolve();
    }
    game.socket.emit('system.aspects-of-power', {
      type: 'gmDeleteAoeRegion',
      sceneId: scene.id,
      regionId,
    });
    return Promise.resolve();
  }

  /**
   * Request the GM to create an AOE Region on the current user's behalf.
   *
   * V14.360 enforces OWNER-on-parent for embedded-region creation; players
   * have neither OWNER nor a way to bypass it client-side. So the player
   * sends regionData over a socket, the active GM creates the region, and
   * emits a response with the new region's UUID. The player resolves a
   * promise with the resulting RegionDocument (or null on timeout/error).
   *
   * GM users skip the round-trip and create directly.
   */
  async _gmCreateRegion(scene, regionData) {
    if (game.user.isGM) {
      const [region] = await scene.createEmbeddedDocuments('Region', [regionData]);
      return region;
    }
    const requestId = foundry.utils.randomID();
    return new Promise((resolve) => {
      const cleanup = () => game.socket.off('system.aspects-of-power', handler);
      const timeout = setTimeout(() => {
        cleanup();
        ui.notifications.error('AOE region creation timed out — is a GM online?');
        resolve(null);
      }, 10000);
      const handler = (msg) => {
        if (msg?.type !== 'aoeRegionCreated') return;
        // Skip events not addressed to us — saves attach/detach work on
        // other player clients receiving the broadcast.
        if (msg.targetUserId && msg.targetUserId !== game.user.id) return;
        if (msg.requestId !== requestId) return;
        clearTimeout(timeout);
        cleanup();
        if (msg.error) {
          ui.notifications.error(`AOE region creation failed: ${msg.error}`);
          resolve(null);
          return;
        }
        const region = msg.regionUuid ? fromUuidSync(msg.regionUuid) : null;
        resolve(region);
      };
      game.socket.on('system.aspects-of-power', handler);
      game.socket.emit('system.aspects-of-power', {
        type: 'gmCreateAoeRegion',
        requestId,
        sceneId: scene.id,
        regionData,
        requesterId: game.user.id,
      });
    });
  }

  /**
   * Route a payload to the GM for execution. If the current user IS the GM,
   * execute directly; otherwise send via socket.
   */
  async _gmAction(payload) {
    // Automatically whisper GM-only for non-player actors.
    if (!_isPlayerCharacter(this.actor)) {
      payload.whisperGM = ChatMessage.getWhisperRecipients('GM');
    }
    if (game.user.isGM) {
      await AspectsofPowerItem.executeGmAction(payload);
    } else {
      game.socket.emit('system.aspects-of-power', payload);
    }
  }

  /**
   * Execute a GM-routed action. Called directly by the GM or via the socket
   * handler. The implementation lives in systems/gm-actions.mjs (refactor
   * 2026-07-03); this static delegate keeps every existing caller working
   * (aspects-of-power.mjs socket routing, actor.mjs via
   * CONFIG.Item.documentClass, and _gmAction below).
   */
  static async executeGmAction(payload) {
    return executeGmActionImpl(payload);
  }

  /**
   * Restoration tag: restore health, mana, or stamina and route through GM.
   */
  async _handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    // `restorationScale` is 1 for every skill that does not set it, so this is
    // a no-op everywhere it is not authored. See the schema note: it exists so
    // a BANKED-PAYLOAD spender can restore a fraction of a payload that was
    // priced as damage (Dreams of Light: "Heal for 1/2 of rolled value").
    const _restScale = this.system.tagConfig?.restorationScale ?? 1;
    let amount     = Math.round(dmgRoll.total * _restScale);
    const target   = this.system.tagConfig?.restorationTarget ?? 'selected';
    const resource = this.system.tagConfig?.restorationResource ?? 'health';

    // ── CAUTERISED REGENERATION ──────────────────────────────────────────
    // A heal may declare a damage type that switches it OFF while the
    // recipient carries a DoT of that type — "burn the stumps or the heads
    // grow back", as content rather than as a special case bolted to one
    // monster. Inert unless authored, so no existing heal changes.
    //
    // ⚠ Reads the DoT effect list, NOT the last damage source. What most
    // recently hit the target is irrelevant; what matters is whether the
    // wound is still burning right now. Same reasoning as Burnt Offering's
    // "died WHILE burning, not killed BY the burn".
    const _suppressType = this.system.tagConfig?.regenSuppressedByDot ?? '';
    if (_suppressType) {
      const _recipient = targetTokenOverride?.actor
        ?? game.user.targets.first()?.actor ?? this.actor;
      const _burning = _recipient?.effects?.some(e => !e.disabled && e.system?.dot
        && e.system?.dotDamageType === _suppressType);
      if (_burning) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><em><strong>${_recipient.name}</strong> cannot regenerate — the `
                 + `${_suppressType} is still in the wound.</em></p>`,
        });
        return;
      }
    }

    // BARRIERS ARE CASTS (user ruled 2026-08-03): the roll IS the barrier, same
    // as a heal, so card, preview and applied amount cannot drift apart.
    // ⚠ Only skills that actually reached the invest branch have a meaningful
    // roll. An UNTIERED barrier still falls to the legacy path and keeps the old
    // `investedMana x barrierMultiplier`, or it would read as an unscaled roll
    // with no tier and no rarity behind it.
    if (resource === 'barrier' && rollData.roll.variableManaCost != null) {
      const multiplier = this.system.tagConfig?.barrierMultiplier ?? 1;
      amount = Math.round(rollData.roll.variableManaCost * multiplier);
    }

    let targetActor;
    if (target === 'self' && !targetTokenOverride) {
      targetActor = this.actor;
    } else {
      const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
      targetActor = targetToken?.actor ?? null;
    }

    // HEAL OVER TIME: place a ticking effect instead of healing now. Routed
    // through the GM like every other restoration, because it writes to a
    // third party's document.
    const _hotRounds = this.system.tagConfig?.hotDuration ?? 0;
    if (_hotRounds > 0 && resource !== 'barrier' && targetActor) {
      // ⚠ Scale applies here too — a heal that restores half its roll must
      // also tick half, or authoring `hotDuration` would silently undo it.
      const { tick, total } = hotTickAmount(
        Math.round(dmgRoll.total * _restScale), this.system.tagConfig?.hotScale ?? 0.5, _hotRounds);
      await this._gmAction({
        type: 'gmApplyHot',
        targetActorUuid: targetActor.uuid,
        effectName: `${item.name}`,
        originUuid: this.uuid,
        img: item.img ?? 'icons/svg/regen.svg',
        amount: tick, resource, rounds: _hotRounds, total,
        speaker, rollMode,
      });
      return;
    }

    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No valid restoration target.</em></p>` });
      return;
    }

    const actionPayload = {
      type: 'gmApplyRestoration',
      targetActorUuid: targetActor.uuid,
      amount,
      resource,
      overhealth: this.system.tagConfig?.restorationOverhealth ?? false,
      speaker, rollMode,
    };

    // Barrier creation passes affinities, source name, and caster cost info
    // so the GM can deduct cost only after the target accepts.
    if (resource === 'barrier') {
      actionPayload.barrierAffinities = this.system.affinities ?? [];
      actionPayload.barrierSource = this.name;
      const casterRes = rollData.roll.resource ?? 'mana';
      const casterCost = rollData.roll.cost ?? 0;
      actionPayload.casterActorUuid = this.actor.uuid;
      actionPayload.casterResource = casterRes;
      actionPayload.casterCost = casterCost;
      // Mana Shell reform: barrier re-forms on break by re-paying the
      // original investment. originUuid links the barrier effect to the
      // skill (sustain-end teardown matches origin); sourceSkillId lets
      // reform-failure tear down the sustain marker in return.
      if (this.system.tagConfig?.barrierReform) {
        actionPayload.barrierReform = true;
        // Reform re-pays what was actually committed: the invest amount on the
        // cast path, the prompted mana on the legacy one. `roll.cost` carries
        // both, so this keeps working now that barriers invest like spells.
        actionPayload.reformCost =
          Math.round(rollData.roll.variableManaCost ?? casterCost ?? 0) || 0;
        actionPayload.originUuid = this.uuid;
        actionPayload.sourceSkillId = this.id;
      }
    }

    await this._gmAction(actionPayload);
  }

  /**
   * Resolve a teleport skill's effective max distance in feet. When the
   * skill's `tagConfig.teleportMaxDistance` is 0 (the default), inherit
   * the caster's spell-throwing reach via `actor.system.castingRange`
   * (40 + Per.mod/10). When the skill author sets an explicit > 0 value,
   * use that as a fixed override (short Blink-style skills, or super-
   * long-range Mass Teleport).
   *
   * Returns rounded feet. Used by the declare-time destination prompt
   * (range gate) and the computeActionWait granted-tag distance lerp.
   */
  _resolveTeleportMaxDistance(actor) {
    const explicit = this.system?.tagConfig?.teleportMaxDistance ?? 0;
    if (explicit > 0) return explicit;
    return Math.max(5, Math.round(actor?.system?.castingRange ?? 30));
  }

  /**
   * Teleport tag: relocate the caster's token to the previously-picked
   * destination. Validation (range + sight) happened at declare time via
   * selectDestinationOnCanvas; this handler just commits the move. Walls
   * and engagement are bypassed (no path traversal). Aura entry triggers
   * fire automatically via the preUpdateToken hook on the position change.
   *
   * @param {Item}   item
   * @param {object} rollData
   * @param {object} speaker
   * @param {string} rollMode
   * @param {string} label
   * @param {object|null} destination  {x, y, elevation} from declare-time pick.
   */
  async _handleTeleportTag(item, rollData, speaker, rollMode, label, destination) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const casterToken = this.actor?.getActiveTokens?.()?.[0] ?? null;
    if (!casterToken || !destination) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>${this.actor?.name ?? 'Caster'} — teleport failed (no destination at fire time).</em></p>` });
      return;
    }
    const gridSize = canvas.grid.size;
    const w = casterToken.document.width * gridSize;
    const h = casterToken.document.height * gridSize;
    const tl = { x: destination.x - w / 2, y: destination.y - h / 2 };
    // Use Foundry v14 native `displace` movement action: walls=null,
    // visualize=false — no animation slide, no path-segment region
    // triggers, no wall collision. Region behaviors STILL fire on
    // arrival (the destination is inside) via Foundry's normal entry
    // detection. This is the right semantic for "true" teleportation.
    await casterToken.document.move({
      x: tl.x,
      y: tl.y,
      elevation: destination.elevation ?? casterToken.document.elevation ?? 0,
      action: 'displace',
    }, { _aopTeleport: true });
    ChatMessage.create({
      speaker, rollMode,
      ...(whisperGM ? { whisper: whisperGM } : {}),
      content: `<p><em>${this.actor.name} teleports via <strong>${label}</strong>.</em></p>`,
    });
  }

  /**
   * Leap tag: arc movement to a destination. The caster's token is moved
   * along a 2D path (token stays at ground elevation throughout — AOEs
   * and engagement evaluate normally). Walls in scene levels with
   * elevation.top ≥ leapApexFt block; lower-level walls are bypassed.
   * Engagement-halts apply mid-arc per design (Phase C Q4 = halts).
   *
   * @param {Item}   item
   * @param {object} rollData
   * @param {object} speaker
   * @param {string} rollMode
   * @param {string} label
   * @param {object|null} destination  {x, y, elevation} from declare-time pick.
   * @param {number|null} apexFt       Skill's leap apex height.
   */
  async _handleLeapTag(item, rollData, speaker, rollMode, label, destination, apexFt) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const casterToken = this.actor?.getActiveTokens?.()?.[0] ?? null;
    if (!casterToken || !destination) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>${this.actor?.name ?? 'Caster'} — leap failed (no destination at fire time).</em></p>` });
      return;
    }
    const gridSize = canvas.grid.size;
    const w = casterToken.document.width * gridSize;
    const h = casterToken.document.height * gridSize;
    const apex = apexFt ?? this.system.tagConfig?.leapApexFt ?? 10;

    // Walls in scene levels whose elevation.top is at-or-above leapApexFt
    // remain blocking; lower-level walls are bypassed. Engagement halt
    // (entry into an opposing token's threat radius) also truncates the
    // arc — engagement applies mid-arc per Phase C Q4. Final truncation
    // = closest of (wall hit, engagement entry, full destination).
    const startCenter = { x: casterToken.center.x, y: casterToken.center.y };
    const endCenter   = { x: destination.x, y: destination.y };
    const wallHit = this._findLeapBlockingWall(startCenter, endCenter, apex);
    const engHit  = this._findLeapEngagementHalt(startCenter, endCenter, casterToken);
    let finalCenter = endCenter;
    let truncated = false;
    let truncReason = '';
    let bestT = 1.0;
    const dxSeg = endCenter.x - startCenter.x;
    const dySeg = endCenter.y - startCenter.y;
    const lenSqSeg = dxSeg * dxSeg + dySeg * dySeg || 1;
    const _tFor = (pt) => ((pt.x - startCenter.x) * dxSeg + (pt.y - startCenter.y) * dySeg) / lenSqSeg;
    if (wallHit) {
      const t = _tFor(wallHit.intersection);
      if (t >= 0 && t < bestT) { bestT = t; finalCenter = wallHit.intersection; truncated = true; truncReason = 'wall'; }
    }
    if (engHit) {
      const t = _tFor(engHit.intersection);
      if (t >= 0 && t < bestT) { bestT = t; finalCenter = engHit.intersection; truncated = true; truncReason = 'engagement'; }
    }
    const tl = { x: finalCenter.x - w / 2, y: finalCenter.y - h / 2 };
    // Default movement (action='walk' under the hood). Foundry's native
    // wall collision applies — meaning the wall-apex bypass we compute
    // above is currently advisory only (Foundry will re-truncate at
    // any wall). Apex-aware bypass requires a custom v14 movement
    // action with walls=null and is deferred to a follow-up.
    // Path-region triggering and AOE-on-path work normally here, which
    // is the correct A' behavior (leaping through a fire field hits).
    //
    // Transient `_aopInLeap` marker on the token document — read by the
    // persistent-AOE region behavior to filter ground-anchored AOEs
    // (oil slicks, spike traps): leaper passes overhead, skips them.
    // Cleared after the await so subsequent moves don't carry the flag.
    casterToken.document._aopInLeap = true;
    try {
      await casterToken.document.update({
        x: tl.x,
        y: tl.y,
        elevation: destination.elevation ?? casterToken.document.elevation ?? 0,
      }, { _aopLeap: true });
    } finally {
      delete casterToken.document._aopInLeap;
    }
    const truncatedNote = truncated
      ? (truncReason === 'engagement' ? ' — leap halted at enemy engagement' : ' — leap halted at wall')
      : '';
    ChatMessage.create({
      speaker, rollMode,
      ...(whisperGM ? { whisper: whisperGM } : {}),
      content: `<p><em>${this.actor.name} leaps via <strong>${label}</strong> (apex ${apex} ft)${truncatedNote}.</em></p>`,
    });
  }

  /**
   * Find the closest point along a leap segment where the leaper enters an
   * opposing token's threat radius. Same engagement model as normal movement
   * (per engagement-halts.mjs) but evaluated against the leap's 2D segment
   * rather than a queued movement on the celerity stack.
   *
   * Returns { intersection: {x, y}, opponentId } or null.
   */
  _findLeapEngagementHalt(start, end, casterToken) {
    if (!game.combat?.started) return null;
    const moverDisp = casterToken.document?.disposition ?? 0;
    if (moverDisp === 0) return null;
    // Dashing leapers skip engagement entirely — Stormstride etc.
    if (this.actor && actorIsDashing(this.actor)) return null;
    const gridSize = canvas.grid.size;
    const gridDist = canvas.grid.distance;
    const pxPerFt  = gridSize / gridDist;

    const casterReachFt = getThreatRadiusFt(casterToken.document);

    let bestT = Infinity;
    let bestPt = null;
    let bestOppId = null;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return null;

    for (const cm of game.combat.combatants) {
      const oppToken = cm.token?.object ?? cm.token;
      if (!oppToken || !cm.token) continue;
      if (cm.actor?.id === this.actor?.id) continue;
      const oppDisp = cm.token.disposition;
      // Only opposing-disposition tokens (positive vs negative). Friendly /
      // neutral don't halt the leap.
      if (oppDisp === 0 || moverDisp === 0) continue;
      if ((moverDisp > 0) === (oppDisp > 0)) continue;
      const oppCenter = oppToken.center ?? { x: cm.token.x + (cm.token.width * gridSize) / 2, y: cm.token.y + (cm.token.height * gridSize) / 2 };

      // Threat distance: max(caster reach, opponent reach) — long-reach
      // weapons control the engagement, matching normal-movement halts.
      const oppReachFt = getThreatRadiusFt(cm.token);
      const threatFt = Math.max(casterReachFt, oppReachFt);
      // Include the token's effective radius in pixels so the halt fires
      // when the leaper touches the threat ring, not the token center.
      const oppRadiusFt = (cm.token.width * gridDist) / 2;
      const radiusPx = (threatFt + oppRadiusFt) * pxPerFt;
      // Skip if start is already inside the threat circle — leaper is
      // already engaged; the leap launches FROM engagement, doesn't
      // halt on first entry.
      const sdx = start.x - oppCenter.x;
      const sdy = start.y - oppCenter.y;
      if ((sdx * sdx + sdy * sdy) <= radiusPx * radiusPx) continue;

      // Line-circle intersection. Solve (start + t*(end-start) - center)^2 = r^2
      const fx = start.x - oppCenter.x;
      const fy = start.y - oppCenter.y;
      const a = lenSq;
      const b = 2 * (fx * dx + fy * dy);
      const c = (fx * fx + fy * fy) - radiusPx * radiusPx;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      // First entry into the circle: smaller t (provided it's in [0,1]).
      const t = t1 >= 0 ? t1 : (t2 >= 0 ? t2 : -1);
      if (t < 0 || t > 1) continue;
      if (t < bestT) {
        bestT = t;
        bestPt = { x: start.x + t * dx, y: start.y + t * dy };
        bestOppId = cm.id;
      }
    }
    return bestPt ? { intersection: bestPt, opponentId: bestOppId } : null;
  }

  /**
   * Find the first wall along a leap segment that blocks the leap.
   * A wall blocks if any of its scene-levels has elevation.top ≥ apexFt.
   * Returns { wallId, intersection: {x, y} } or null.
   */
  _findLeapBlockingWall(start, end, apexFt) {
    const scene = canvas.scene;
    if (!scene) return null;
    const sceneLevels = scene.levels?.contents ?? scene.levels ?? [];
    const levelTopById = new Map();
    for (const lvl of sceneLevels) {
      const top = lvl.elevation?.top;
      levelTopById.set(lvl._id ?? lvl.id, typeof top === 'number' ? top : Infinity);
    }
    let bestT = Infinity;
    let bestPt = null;
    for (const wall of scene.walls.contents) {
      if (wall.move === 0) continue; // wall doesn't restrict movement
      const wallLevels = wall.levels ?? [];
      // No level association = treat as full-height (always blocks leap).
      let maxTop = wallLevels.length === 0 ? Infinity : 0;
      for (const lid of wallLevels) {
        const top = levelTopById.get(lid) ?? Infinity;
        if (top > maxTop) maxTop = top;
      }
      if (maxTop < apexFt) continue; // wall is shorter than apex — bypass
      // Intersect the leap segment with the wall segment.
      const [wx1, wy1, wx2, wy2] = wall.c;
      const hit = segmentIntersect(start.x, start.y, end.x, end.y, wx1, wy1, wx2, wy2);
      if (!hit) continue;
      // Parametric t along the leap segment for ordering.
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq <= 0) continue;
      const t = ((hit.x - start.x) * dx + (hit.y - start.y) * dy) / lenSq;
      if (t < 0 || t > 1) continue;
      if (t < bestT) { bestT = t; bestPt = hit; }
    }
    return bestPt ? { intersection: bestPt } : null;
  }

  /**
   * Buff tag: build payload and route through GM.
   * Values are roll-based: rollTotal * entry.value (multiplier, default 1).
   */
  async _handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const tc = this.system.tagConfig ?? {};

    // Buff target resolution: self skips the target prompt and applies to
    // the caster's actor. Selected uses the current target (default).
    const buffTarget = tc.buffTarget ?? 'selected';
    let targetActor = null;
    if (buffTarget === 'self') {
      targetActor = this.actor;
    } else {
      const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
      targetActor = targetToken?.actor ?? null;
    }
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No target for buff.</em></p>` });
      return;
    }

    const entries  = tc.buffEntries ?? [];
    const duration = tc.buffDuration ?? 1;
    const rollTotal = Math.round(dmgRoll.total);

    // GEAR-SOURCED MAGNITUDE. When `buffFromEquipment` names an item field, the
    // buff is a fraction of THE GEAR, not of this skill's damage roll — a shield
    // ward is worth what the shield is worth. The cast is already refused in
    // canUseSkill when the gear is absent, so an unresolved source here means a
    // skill reached this path without the roll-time gate; fall back to the roll
    // rather than silently applying nothing.
    let magnitudeBase = rollTotal;
    let gearNote = '';
    if (tc.buffFromEquipment) {
      const { resolveGearSource } = await import('../systems/weapon-styles.mjs');
      const src = resolveGearSource(this.actor, tc.buffFromEquipment);
      if (src) {
        magnitudeBase = src.value * (tc.buffFromEquipmentFrac ?? 0.1);
        gearNote = ` — ${Math.round((tc.buffFromEquipmentFrac ?? 0.1) * 100)}% of ${src.item.name}`;
      } else {
        console.warn(`[buff] ${item.name}: buffFromEquipment '${tc.buffFromEquipment}' `
          + `did not resolve on ${this.actor?.name}; falling back to the roll total.`);
      }
    }

    const changes = entries.map(e => ({
      key:   `system.${e.attribute}.value`,
      type:  'add',
      value: Math.round(magnitudeBase * (e.value || 1)),
    }));

    // System overrides for non-stat buff fields (e.g. movement multipliers
    // from Stormstride / Haste / Slow, aura damage from Stormstride's
    // electrical field). Only populated when the skill actually defines
    // them — keeps default values from getting written pointlessly.
    const systemOverrides = {};
    const moveSpeed   = tc.movementSpeedBuff ?? 1;
    const moveStamina = tc.movementStaminaBuff ?? 1;
    if (moveSpeed !== 1) systemOverrides.movementSpeedMultiplier = moveSpeed;
    if (moveStamina !== 1) systemOverrides.movementStaminaMultiplier = moveStamina;

    // Effect-tag propagation. A whitelisted subset of the source skill's
    // tags lands on the spawned effect's `system.tags` so behavior gates
    // (e.g., engagement-halt skip on `dash`) can read them. Author opts
    // in by adding the tag to the SKILL — Stormstride tagged `dash` makes
    // its buff effect carry `dash`.
    const EFFECT_TAG_WHITELIST = ['dash'];
    const skillTagsArr = this.system.tags ?? [];
    const propagatedTags = EFFECT_TAG_WHITELIST.filter(t => skillTagsArr.includes(t));
    if (propagatedTags.length > 0) systemOverrides.tags = propagatedTags;

    // Phase E: buff-carried reaction config. When the source skill has
    // buffReactionTrigger set, propagate the reaction fields onto the
    // spawned effect so _firePassiveReactions / the apply-damage handler
    // can scan it. The encoded skill at buffReactionSkillId fires when
    // the trigger event lands on the buffed actor (typically a dedicated
    // counter skill — Shocking Retort buff → Shocking Retort Counter).
    if (tc.buffReactionTrigger) {
      systemOverrides.reactionTrigger    = tc.buffReactionTrigger;
      systemOverrides.reactionAttackType = tc.buffReactionAttackType ?? 'any';
      systemOverrides.reactionSkillId    = tc.buffReactionSkillId ?? '';
    }

    // Aura snapshot: per-tick value = rollTotal × auraScale, frozen at
    // apply time. Dispatched by auraEffectType in actor._tickActorAuras:
    //   'damage' → apply-damage button + chat
    //   'heal'   → gmApplyRestoration (health by default, configurable)
    //   'stam'   → gmApplyRestoration with stamina
    // Also fires on entry via the movement-hook trigger.
    // Radius is the AUTHORED number stretched by the caster's perception, and
    // like auraAmount it is frozen onto the effect at apply time — the field is
    // as wide as the caster who made it, and stays that wide if they are later
    // buffed or blinded. See auraRadiusFor for why this is multiplicative.
    const auraRadius = auraRadiusFor(tc.auraRadius,
      this.actor?.system?.abilities?.perception?.mod ?? 0);
    if (auraRadius > 0) {
      const auraScale = tc.auraScale ?? 0.3;
      const amount = Math.max(0, Math.round(rollTotal * auraScale));
      systemOverrides.auraRadius        = auraRadius;
      systemOverrides.auraAmount        = amount;
      systemOverrides.auraDamage        = amount; // legacy alias
      systemOverrides.auraDamageType    = tc.auraDamageType ?? 'physical';
      systemOverrides.auraTargeting     = tc.auraTargeting ?? 'enemies';
      systemOverrides.auraAffinities    = [...(this.system.affinities ?? [])];
      systemOverrides.auraIsMagic       = (this.system.tags ?? []).includes('magic');
      systemOverrides.auraEffectType    = tc.auraEffectType ?? 'damage';
      systemOverrides.auraHealResource  = tc.auraHealResource ?? 'health';
      systemOverrides.auraHealOverhealth = tc.auraHealOverhealth ?? false;
      // Seed the resource-aura cadence cursor to NOW, so an aura cast mid-round
      // starts owing from this moment instead of paying a backlog from tick 0.
      systemOverrides.auraLastTick = game.combat?.flags?.aspectsofpower?.clockTick ?? 0;
    }

    // Weapon buff snapshot (Flameblade — design-spellstriker.md). Flat
    // per-strike affinity damage = rollTotal × weaponBuffScale, frozen at
    // apply time (based on the buff skill's own power, not the strike). Read
    // by the wearer's weapon strike path via system.weaponStrikeBuff; typed by
    // the skill's affinities so it routes through the target's per-affinity DR.
    const weaponBuffScale = tc.weaponBuffScale ?? 0;
    if (weaponBuffScale > 0) {
      systemOverrides.weaponBuffDamage = Math.max(0, Math.round(rollTotal * weaponBuffScale));
      systemOverrides.weaponBuffAffinities = [...(this.system.affinities ?? [])];
    }

    // If the only thing this skill does is set system overrides (no stat
    // changes), still let it through — Stormstride is the canonical case.
    if (entries.length === 0 && Object.keys(systemOverrides).length === 0) return;

    await this._gmAction({
      type: 'gmApplyBuff',
      targetActorUuid: targetActor.uuid,
      effectName: `${item.name} (Buff)`,
      originUuid: this.uuid,
      changes,
      duration,
      stackable: tc.buffStackable ?? false,
      img: item.img ?? 'icons/svg/aura.svg',
      systemOverrides,
      magnitudeNote: gearNote,
      speaker, rollMode,
    });
  }

  /**
   * Debuff tag: build payload and route through GM.
   * Stat values are roll-based: rollTotal * entry.value (multiplier, default 1).
   * DoT damage = raw roll total, bypasses mitigation.
   */
  async _handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null, defenseMultiplier = 1) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No target for debuff.</em></p>` });
      return;
    }

    const entries    = this.system.tagConfig?.debuffEntries ?? [];
    const duration   = this.system.tagConfig?.debuffDuration ?? 1;
    // Armor-answer behavior tags (single source of truth, mirroring how `pierce`
    // is read straight off the tags array). `shred` = affinity DR-strip; `crush`
    // = armor+block reduction. OR'd with the legacy tagConfig flags so pre-tag
    // skills keep working. `shred` forces a damaging DoT because the strip only
    // fires on a dot:true / debuffDamage>0 effect (the Hemorrhage bug).
    const _tags      = this.system.tags ?? [];
    const hasShred   = _tags.includes('shred');
    const hasCrush   = _tags.includes('crush');
    const dealsDmg   = (this.system.tagConfig?.debuffDealsDamage ?? false) || hasShred;
    const dmgType    = this.system.tagConfig?.debuffDamageType ?? 'physical';
    // Derive debuffType from a subtype TAG when tagConfig doesn't set it.
    // Skills tagged with a CC subtype (paralysis/stun/root/…) BEFORE the item
    // sheet started auto-wiring tagConfig.debuffType (item-sheet _addSkillTag)
    // kept debuffType 'none' and silently applied NO control effect — the tag
    // is the single source of truth, so honor it. (2026-07-15 test: Puppet
    // Strings carried `paralysis` but debuffType 'none' → no CC.)
    let debuffType = this.system.tagConfig?.debuffType ?? 'none';
    if (debuffType === 'none') {
      const _subtypeMap = CONFIG.ASPECTSOFPOWER.debuffSubtypeTags ?? {};
      const _subtypeTag = _tags.find(t => _subtypeMap[t]);
      if (_subtypeTag) debuffType = _subtypeMap[_subtypeTag];
    }
    // Scale debuff by defense multiplier (partial defense = partial debuff).
    // If debuffScaleWithAttack > 0, debuff strength is a fraction of attack damage.
    const attackScaling = this.system.tagConfig?.debuffScaleWithAttack ?? 0;
    const baseTotal = attackScaling > 0
      ? Math.round(dmgRoll.total * attackScaling)
      : Math.round(dmgRoll.total);
    const rollTotal = Math.round(baseTotal * defenseMultiplier);

    // Build stat-reduction changes (roll-based).
    const changes = entries.map(e => ({
      key:   `system.${e.attribute}.value`,
      type:  'add',
      value: -Math.round(rollTotal * (e.value || 1)),
    }));

    // DoT damage uses its own scale factor (dotScale, default 0.1) so a
    // bleed-style chain ticks for ~10% of the attack roll per round per
    // stack rather than the full attack damage. Separate from
    // debuffScaleWithAttack which keeps governing stat-reduction
    // strength. Per user 2026-05-11. Computed BEFORE effectData so the
    // description advertises the real per-round tick — it used to
    // interpolate the full rollTotal, overstating the tick 10×
    // (the refresh path at gmApplyDebuff already reported the scaled
    // number, so create/refresh disagreed).
    // `invest` tag: the DoT's per-tick damage scales on the PRIMARY RESOURCE
    // committed to the ability (rollData.roll.cost holds the invested amount
    // after the invest step — stamina for a stab, mana for a cast), not the
    // damage roll. The stab/cast/craft is the cause, so the DoT rides its own
    // investment. Still faces toughness DR at tick time. See [design-hemorrhage-bleed].
    const dotScale = this.system.tagConfig?.dotScale ?? 0.1;
    const _hasInvestTag = (this.system.tags ?? []).includes('invest');
    const _investAmt = Math.max(0, Math.round(rollData.roll?.investedAmount ?? rollData.roll?.cost ?? 0));
    const _investScale = this.system.tagConfig?.dotInvestScale ?? 1.0;
    // `parentDamage` is present only when _executeChainedSkills spawned this
    // rider, and makes the bleed size off the strike that caused it rather
    // than off its own roll — see formulas.dotTickDamage for why.
    const dotDmg = dealsDmg
      ? dotTickDamage({
          ownDamage: dmgRoll?.total ?? 0,
          parentDamage: rollData.roll?.parentDamage ?? 0,
          dotScale,
          hasInvestTag: _hasInvestTag,
          investAmount: _investAmt,
          investScale: _investScale,
          defenseMultiplier,
        })
      : 0;

    // Build effect data with optional DoT flags.
    const effectName = `${item.name} (Debuff)`;
    const effectData = {
      name:        effectName,
      img:         item.img ?? 'icons/svg/downgrade.svg',
      origin:      this.uuid,
      duration:    { rounds: duration },
      disabled:    false,
      changes,
      description: dealsDmg
        ? `Deals <strong>${dotDmg}</strong> ${dmgType} damage per round (bypasses armor &amp; veil; reduced by Toughness).`
        : '',
    };

    // Capture positional tags for all debuffs so DR is direction-gated by default.
    // 'debuffDirectional' now acts as an "Omnidirectional DR" opt-out:
    // when set, directions is empty and the DR applies regardless of angle.
    const isOmnidirectional = this.system.tagConfig?.debuffDirectional ?? false;
    const casterToken       = isOmnidirectional ? null : (this.actor.getActiveTokens()[0] ?? null);
    const directions        = (!isOmnidirectional && casterToken && targetToken)
      ? getPositionalTags(casterToken, targetToken)
      : [];

    // Dismembered: GM chooses which equipment slot to disable.
    let dismemberedSlot = null;
    if (debuffType === 'dismembered') {
      const slots = CONFIG.ASPECTSOFPOWER.equipmentSlots ?? {};
      const slotOptions = Object.entries(slots)
        .map(([key, def]) => `<option value="${key}">${game.i18n.localize(def.label ?? `ASPECTSOFPOWER.Equip.Slot.${key}`)}</option>`)
        .join('');
      dismemberedSlot = await foundry.applications.api.DialogV2.wait({
        window: { title: 'Dismember — Choose Slot' },
        content: `<div class="form-group"><label>Slot to disable:</label><select name="slot">${slotOptions}</select></div>`,
        buttons: [{
          action: 'confirm', label: 'Confirm', default: true,
          callback: (event, button) => button.form.elements.slot?.value || null,
        }, {
          action: 'cancel', label: 'Cancel', callback: () => null,
        }],
        close: () => null,
      });
      if (!dismemberedSlot) return; // cancelled
    }

    // (dotScale/dotDmg hoisted above effectData — see comment there.)

    // Store debuff metadata in the AE TypeDataModel system fields.
    // Marked subsystem: when the skill defines markBonus > 0, the spawned
    // effect tags the caster's UUID so apply-damage can multiply the
    // marker's incoming damage against this target.
    // ⚠ GATED ON THE `mark` TAG (user ruled 2026-08-06: "Mark should likely be
    // a tag of its own"). Before this the mark rode along on any skill that
    // happened to set markBonus, so marking REQUIRED being a debuff —
    // Mathilda's Blood Bolt carried `debuff` with no debuff content whatsoever,
    // purely to deliver a mark. All five live mark skills were tagged BEFORE
    // this gate shipped, so nothing lost its mark in between.
    const markBonus        = this.system.tagConfig?.markBonus ?? 0;
    const markAttackBonus  = this.system.tagConfig?.markAttackBonus ?? 0;
    const markExpiresOnHit = this.system.tagConfig?.markExpiresOnHit ?? false;
    const markActive       = _tags.includes('mark')
      && (markBonus > 0 || markAttackBonus > 0);
    // Armor Crush (armor-answer system): a pure crush debuff has no stat
    // entries / DoT / debuffType, so it would otherwise fail the effectData
    // gate below and silently apply nothing. Treat a non-zero armorCrush as
    // reason enough to spawn the carrying effect. The `crush` tag supplies the
    // config default magnitude; the legacy debuffArmorCrush flag still counts
    // (larger of the two wins).
    const _crushDefault    = CONFIG.ASPECTSOFPOWER.armorAnswer?.armorCrushPerStack ?? 0.10;
    const armorCrushVal    = Math.max(
      hasCrush ? _crushDefault : 0,
      this.system.tagConfig?.debuffArmorCrush ?? 0,
    );
    // FLAT crush amount (flat rework 2026-07-18): anchored to the applier's
    // DAMAGE at apply time → grade-correct. armorCrushVal is now just the ON
    // gate; the flat value is what _getArmorCrushFlat sums.
    //
    // Sizes off the PARENT when this is a rider (RULED 2026-07-30, same rule
    // as the bleed): a bigger blow crushes more armour. Before this, crush used
    // its own roll while the DoT used the parent's — the two rider magnitudes
    // disagreed. riderDamageBase is now the single source for both.
    //
    // With the `invest` tag it rides the stamina COMMITTED to the crush instead
    // (same override the DoT tick takes), so leaning on the proc buys more
    // armour off. Identical at base invest — see crushFlatAmount.
    const _crushFrac = CONFIG.ASPECTSOFPOWER.armorAnswer?.crushDamageFrac
                    ?? CONFIG.ASPECTSOFPOWER.armorAnswer?.crushDamageFrac ?? 0.05;
    const armorCrushFlat = crushFlatAmount({
      enabled: armorCrushVal > 0,
      hasInvestTag: _hasInvestTag,
      investAmount: _investAmt,
      investScale: this.system.tagConfig?.crushInvestScale ?? 1.0,
      crushFrac: _crushFrac,
      parentDamage: rollData.roll?.parentDamage ?? 0,
      ownDamage: dmgRoll?.total ?? 0,
    });
    // Armor-MELT rate for burn effects (design-burn-status.md): opt-in via
    // tagConfig.debuffArmorMelt; only on a damaging DoT (its tick is the base).
    const armorMeltRate = (dealsDmg && (this.system.tagConfig?.debuffArmorMelt ?? 0) > 0)
      ? (this.system.tagConfig?.debuffArmorMelt ?? 0)
      : 0;
    effectData.type = 'base';
    effectData.system = {
      debuffDamage: rollTotal,
      debuffType,
      casterActorUuid: this.actor.uuid,
      affinities: this.system.affinities ?? [],
      magicType: (this.system.tags ?? []).includes('magic') ? 'magical' : 'non-magical',
      directions,
      ...(dismemberedSlot ? { dismemberedSlot } : {}),
      ...(dealsDmg ? { dot: true, dotDamage: dotDmg, dotDamageType: dmgType, applierActorUuid: this.actor.uuid, drStrip: hasShred || !!this.system.tagConfig?.debuffDRStrip } : {}),
      ...(armorCrushVal > 0 ? { armorCrush: armorCrushVal, armorCrushFlat } : {}),
      ...(armorMeltRate > 0 ? { armorMeltRate } : {}),
      ...(markActive ? {
        markedByActorUuid:      this.actor.uuid,
        markedDamageBonus:      markBonus,
        markedAttackMultiplier: markAttackBonus,
        markedExpiresOnHit:     markExpiresOnHit,
      } : {}),
    };

    const statSummary = entries.length > 0
      ? entries.map(e => `${e.attribute} -${Math.round(rollTotal * (e.value || 1))}`).join(', ')
      : null;

    await this._gmAction({
      type: 'gmApplyDebuff',
      targetActorUuid: targetActor.uuid,
      effectName,
      originUuid: this.uuid,
      stackable: this.system.tagConfig?.debuffStackable ?? false,
      effectData: (changes.length > 0 || dealsDmg || debuffType !== 'none' || markActive || armorCrushVal > 0) ? effectData : null,
      dotDamage: dotDmg,
      dotDamageType: dmgType,
      duration,
      statSummary,
      // Mind/soul-targeting debuffs route potency through the target's veil
      // (CC-through-veil rule, design-archetype-defense-gap.md). Empty/unset
      // targetDefense falls through to 'melee' = not veil-gated.
      targetDefense: rollData.roll?.targetDefense || 'melee',
      speaker, rollMode,
    });
  }

  /**
   * Repair tag: distribute repair amount across a target's equipped gear.
   * Targets the selected token (or self if no target). Routes through GM.
   */
  async _handleRepairTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const amount = Math.round(dmgRoll.total);

    let targetActor;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    targetActor = targetToken?.actor ?? null;

    // Fall back to self if no target selected.
    if (!targetActor && !targetTokenOverride) {
      targetActor = this.actor;
    }

    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No valid repair target.</em></p>` });
      return;
    }

    await this._gmAction({
      type: 'gmApplyRepair',
      targetActorUuid: targetActor.uuid,
      amount,
      materials: this.system.tagConfig?.repairMaterials ?? [],
      skillName: item.name,
      speaker, rollMode,
    });
  }

  /**
   * Cleanse tag: add the roll total to breakProgress on magical debuffs on the target.
   * Only magical skills can cleanse. Distributes roll total across debuffs (strongest first)
   * until the budget is exhausted or all debuffs are processed.
   */
  async _handleCleanseTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>${game.i18n.localize('ASPECTSOFPOWER.Cleanse.noTarget')}</em></p>` });
      return;
    }

    // Only magical skills can cleanse.
    if (!(this.system.tags ?? []).includes('magic')) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>${game.i18n.localize('ASPECTSOFPOWER.Cleanse.nonMagical')}</em></p>` });
      return;
    }

    const rollTotal = Math.round(dmgRoll.total);

    await this._gmAction({
      type: 'gmApplyCleanse',
      targetActorUuid: targetActor.uuid,
      rollTotal,
      skillName: item.name,
      speaker, rollMode,
    });
  }


  /* ------------------------------------------------------------------ */
  /*  AOE helpers                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Determine the template fill color based on the skill's tags.
   * Attack/debuff → red, restoration/buff → green, fallback → blue.
   */
  _getAoeColor() {
    const tags = this.system.tags ?? [];
    if (tags.includes('attack') || tags.includes('debuff')) return '#ff4444';
    if (tags.includes('restoration') || tags.includes('buff') || tags.includes('repair') || tags.includes('cleanse')) return '#44ff44';
    return '#4488ff';
  }

  /**
   * Interactively place an AOE Region for an AOE skill.
   * Supports circle, cone, ray, and rectangle shapes.
   *
   * Circle/Rect: preview follows cursor, click to place center.
   * Cone/Ray: origin locked to caster, mouse aims direction, click to confirm.
   *
   * Rect uses Foundry's native rect type: distance = diagonal of the square
   * (Math.hypot(size, size)), direction = 45° for grid alignment. Origin is
   * the top-left corner, offset so the click is the center.
   *
   * @param {Token} casterToken  The caster's canvas token.
   * @returns {Promise<RegionDocument|null>}
   */
  /**
   * Place an AOE Region on the scene via interactive click placement.
   * v14: uses Scene Regions instead of MeasuredTemplates.
   * @returns {RegionDocument|null}
   */
  async _placeAoeTemplate(casterToken, aoeOverride = null, maxSizeFt = null) {
    // Optional per-cast aoe override (e.g., Cleave alteration sets
    // shape='cone' and diameter from the weapon's reach). Falls back
    // to the skill's static aoe block when no override is supplied.
    // `maxSizeFt` (when supplied) caps the scroll-wheel growth — used by
    // the per-cast AOE-budget flow so players can't scroll past what
    // their committed mana can afford.
    const aoe = aoeOverride ?? this.system.aoe;
    const shape = aoe.shape ?? 'circle';
    const castingRange = this.actor.system.castingRange ?? 0;
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const castingRangePx = castingRange * pxPerFt;
    const fillColor = this._getAoeColor();
    const cc = casterToken.center;

    // Cone/Ray originate from the caster — validate reach vs casting range.
    const isDirected = (shape === 'cone' || shape === 'ray');
    if (isDirected && aoe.diameter > castingRange) {
      ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.AOE.outOfRange'));
      return null;
    }

    // Mutable size: scroll wheel during placement adjusts by ±5 ft.
    let currentDiameter = aoe.diameter;
    const SCROLL_STEP_FT = 5;
    const MIN_SIZE_FT = 5;

    let lastPos = { x: cc.x, y: cc.y };

    // Preview graphics overlay.
    const preview = new PIXI.Graphics();
    preview.alpha = 0.4;
    canvas.stage.addChild(preview);

    const drawPreview = (pos) => {
      lastPos = pos;
      preview.clear();
      preview.beginFill(foundry.utils.Color.from(fillColor), 0.4);

      const rectSidePx = currentDiameter * pxPerFt;
      const rectHalfPx = rectSidePx / 2;

      if (shape === 'circle') {
        const radiusPx = (currentDiameter / 2) * pxPerFt;
        preview.drawCircle(pos.x, pos.y, radiusPx);
      } else if (shape === 'cone') {
        // Draw cone as a triangle from caster toward cursor.
        const dx = pos.x - cc.x;
        const dy = pos.y - cc.y;
        const dir = Math.atan2(dy, dx);
        const halfAngle = (aoe.angle / 2) * (Math.PI / 180);
        const radiusPx = currentDiameter * pxPerFt;
        preview.moveTo(cc.x, cc.y);
        preview.lineTo(cc.x + Math.cos(dir - halfAngle) * radiusPx, cc.y + Math.sin(dir - halfAngle) * radiusPx);
        preview.lineTo(cc.x + Math.cos(dir + halfAngle) * radiusPx, cc.y + Math.sin(dir + halfAngle) * radiusPx);
        preview.closePath();
      } else if (shape === 'ray') {
        // Draw ray as a rotated rectangle from caster toward cursor.
        const dx = pos.x - cc.x;
        const dy = pos.y - cc.y;
        const dir = Math.atan2(dy, dx);
        const lengthPx = currentDiameter * pxPerFt;
        const widthPx = (aoe.width ?? 5) * pxPerFt;
        const hw = widthPx / 2;
        const perpX = -Math.sin(dir) * hw;
        const perpY = Math.cos(dir) * hw;
        const endX = cc.x + Math.cos(dir) * lengthPx;
        const endY = cc.y + Math.sin(dir) * lengthPx;
        preview.moveTo(cc.x + perpX, cc.y + perpY);
        preview.lineTo(endX + perpX, endY + perpY);
        preview.lineTo(endX - perpX, endY - perpY);
        preview.lineTo(cc.x - perpX, cc.y - perpY);
        preview.closePath();
      } else {
        // Rectangle: centered on cursor.
        preview.drawRect(pos.x - rectHalfPx, pos.y - rectHalfPx, rectSidePx, rectSidePx);
      }
      preview.endFill();
    };

    let resolved = false;

    return new Promise((resolve) => {
      const onPointerMove = (event) => {
        const pos = event.data?.getLocalPosition(canvas.app.stage)
                    ?? canvas.mousePosition ?? { x: 0, y: 0 };
        drawPreview(pos);
      };

      // Scroll wheel during placement adjusts the AOE size in 5-ft increments.
      // For directed shapes (cone/ray) this is reach; for circles/rectangles
      // it's diameter. Min size is 5 ft. Cone reach is also clamped to the
      // caster's casting range. `maxSizeFt` (per-cast AOE budget) caps growth.
      const onWheel = (event) => {
        const dir = event.deltaY < 0 ? 1 : -1;
        let next = currentDiameter + dir * SCROLL_STEP_FT;
        if (next < MIN_SIZE_FT) next = MIN_SIZE_FT;
        if (isDirected && next > castingRange) next = castingRange;
        if (maxSizeFt != null && next > maxSizeFt) next = maxSizeFt;
        if (next === currentDiameter) return;
        currentDiameter = next;
        drawPreview(lastPos);
        // Suppress page scrolling while placing.
        event.preventDefault?.();
        if (event.stopPropagation) event.stopPropagation();
      };

      const onPointerDown = async (event) => {
        if (resolved) return;
        const pos = event.data?.getLocalPosition(canvas.app.stage)
                    ?? canvas.mousePosition ?? { x: 0, y: 0 };

        // Range validation for placed shapes.
        if (!isDirected) {
          const dist = Math.sqrt((pos.x - cc.x) ** 2 + (pos.y - cc.y) ** 2);
          if (dist > castingRangePx) {
            ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.AOE.outOfRange'));
            return;
          }
        }

        resolved = true;
        cleanup();

        // Use the (possibly scroll-adjusted) currentDiameter for the placed shape.
        const placedDiameterPx = currentDiameter * pxPerFt;
        const placedHalfPx = placedDiameterPx / 2;

        // Build the Region shape data.
        let shapeData;
        if (shape === 'circle') {
          shapeData = { type: 'circle', x: pos.x, y: pos.y, radius: placedHalfPx };
        } else if (shape === 'cone') {
          const dx = pos.x - cc.x;
          const dy = pos.y - cc.y;
          const rotation = Math.toDegrees(Math.atan2(dy, dx));
          shapeData = { type: 'cone', x: cc.x, y: cc.y, radius: placedDiameterPx, angle: aoe.angle, rotation };
        } else if (shape === 'ray') {
          const dx = pos.x - cc.x;
          const dy = pos.y - cc.y;
          const rotation = Math.toDegrees(Math.atan2(dy, dx));
          shapeData = { type: 'line', x: cc.x, y: cc.y, length: placedDiameterPx, width: (aoe.width ?? 5) * pxPerFt, rotation };
        } else {
          // Rectangle centered on click.
          shapeData = { type: 'rectangle', x: pos.x - placedHalfPx, y: pos.y - placedHalfPx, width: placedDiameterPx, height: placedDiameterPx, rotation: 0 };
        }

        // Build region behaviors (e.g., difficult terrain uses native modifyMovementCost).
        const behaviors = [];
        if ((aoe.zoneEffect ?? 'none') === 'difficultTerrain') {
          behaviors.push({
            type: 'modifyMovementCost',
            name: 'Difficult Terrain',
            system: { difficulties: { walk: 2, crawl: 2, swim: 2, climb: 2 } },
          });
        }
        // Persistent AOEs get our custom RegionBehavior that fires the
        // damage/buff/debuff dispatch on tokenEnter / tokenMoveIn /
        // tokenRoundStart events. Foundry segmentizes movement paths
        // between updates so brief pass-throughs are caught natively
        // (the old updateToken endpoint check missed those).
        if ((aoe.templateDuration ?? 0) > 0) {
          behaviors.push({
            // Bare type name. Must match the key our PersistentAoeBehavior
            // is registered under in CONFIG.RegionBehavior.dataModels (also
            // bare). Using the namespaced 'aspects-of-power.persistentAoe'
            // here is rejected by validation; using the namespaced key on
            // dataModels orphans the behavior from its class (no
            // _getTerrainEffects, breaks the drag path planner).
            type: 'persistentAoe',
            name: 'Persistent AOE Trigger',
            system: {},
          });
        }

        const regionData = {
          name: `${this.name} AOE`,
          color: fillColor,
          visibility: 2, // ALWAYS visible
          shapes: [shapeData],
          behaviors,
          flags: {
            'aspects-of-power': {
              aoe: true,
              casterActorUuid: this.actor.uuid,
              skillItemUuid: this.uuid,
              templateDuration: aoe.templateDuration,
              placedRound: game.combat?.round ?? 0,
              persistent: (aoe.templateDuration ?? 0) > 0,
              persistentData: (aoe.templateDuration ?? 0) > 0 ? {
                tags: this.system.tags ?? [],
                tagConfig: this.system.tagConfig ?? {},
                rollTotal: null,
                hitTotal: null,
                damageType: this.system.roll?.damageType ?? 'physical',
                // targetDefense + isMagic snapshotted so re-tick dispatch
                // doesn't need to re-fetch the source skill (which may have
                // been edited since cast). Per design-aoe-dispatch.md.
                targetDefense: this.system.roll?.targetDefense ?? 'melee',
                isMagic: (this.system.tags ?? []).includes('magic'),
                isShrapnel: (this.system.tags ?? []).includes('shrapnel'),
                targetingMode: aoe.targetingMode ?? 'all',
                zoneEffect: aoe.zoneEffect ?? 'none',
                casterDisposition: this.actor.getActiveTokens()?.[0]?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                // Cadence period in ticks: caster's reference round / 4.
                // Per design 2026-05-10: an AOE ticks on entry, then every
                // quarter-round of the CASTER's reference frame thereafter
                // for any token still inside. Faster casters (higher RL)
                // produce AOEs that tick faster.
                casterReticPeriod: (() => {
                  try {
                    const rl = this.actor.system?.attributes?.race?.level ?? 1;
                    const refRound = game.aspectsofpower?.celerity?.referenceRoundLength?.(rl) ?? 4702;
                    return Math.max(1, Math.round(refRound / 4));
                  } catch (e) { return 1175; }
                })(),
                // affectedTokens: tokenId → clockTick of last tick.
                // Replaces the legacy round-number tracking; per-actor
                // re-tick eligibility is currentClockTick - lastTick >=
                // casterReticPeriod.
                affectedTokens: {},
              } : null,
            },
          },
        };

        // V14.360 enforces OWNER-on-parent for embedded-region creation, which
        // players don't have. Route through GM-side dispatch so the player can
        // place AOEs on any scene without scene-ownership privilege.
        const created = await this._gmCreateRegion(canvas.scene, regionData);
        if (!created) { resolve(null); return; }
        await new Promise(r => setTimeout(r, 50));
        resolve(created);
      };

      const onCancel = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        ui.notifications.info(game.i18n.localize('ASPECTSOFPOWER.AOE.placementCancelled'));
        resolve(null);
      };

      const onKeyDown = (event) => { if (event.key === 'Escape') onCancel(); };

      const cleanup = () => {
        canvas.stage.removeChild(preview);
        preview.destroy();
        canvas.stage.off('pointermove', onPointerMove);
        canvas.stage.off('pointerdown', onPointerDown);
        canvas.stage.off('rightdown', onCancel);
        canvas.app?.view?.removeEventListener?.('wheel', onWheel, { capture: true, passive: false });
        document.removeEventListener('keydown', onKeyDown);
        canvas.tokens.activate();
      };

      canvas.stage.on('pointermove', onPointerMove);
      canvas.stage.on('pointerdown', onPointerDown);
      canvas.stage.on('rightdown', onCancel);
      // Wheel needs DOM-level listener (PIXI doesn't surface wheel events).
      // Capture + non-passive so we can preventDefault and avoid page-zoom.
      canvas.app?.view?.addEventListener?.('wheel', onWheel, { capture: true, passive: false });
      document.addEventListener('keydown', onKeyDown);
    });
  }

  /**
   * Find all tokens within a placed AOE Region, filtered by targeting mode.
   * Returns `Array<{ token, fraction }>` where fraction in [0, 1] is the
   * portion of the token's footprint inside the region — used by the AOE
   * dispatch to scale damage proportionally (per design 2026-05-12).
   * Tokens below the inclusion floor (5%) are dropped entirely.
   *
   * @param {RegionDocument} regionDoc
   * @returns {Array<{ token: Token, fraction: number }>}
   */
  _getAoeTargets(regionDoc) {
    const targetingMode = this.system.aoe.targetingMode ?? 'all';
    const casterToken = this.actor.getActiveTokens()?.[0] ?? null;
    const casterDisp = casterToken?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    const casterId = casterToken?.id ?? null;

    // Only auto-exclude the caster from shapes that ORIGINATE at the caster
    // (cone, ray). Circles / rectangles are placed by the player — if their
    // own token is inside the area, they put it there on purpose.
    const shapes = regionDoc.shapes ?? [];
    const originatesAtCaster = shapes.some(s => s?.type === 'cone' || s?.type === 'line');

    const INCLUSION_FLOOR = 0.05; // <5% overlap = treated as no hit
    const qualifying = [];

    for (const token of canvas.tokens.placeables) {
      if (token.document.hidden) continue;
      if (originatesAtCaster && casterId && token.id === casterId) continue;

      // Exact polygon-intersection fraction: token rect clipped against
      // each region shape, area summed, divided by token's footprint area.
      // See helpers/geometry.mjs for the math.
      const fraction = regionTokenOverlap(regionDoc, token.document);
      if (fraction < INCLUSION_FLOOR) continue;

      // Disposition filter.
      if (targetingMode === 'enemies') {
        if (casterDisp === CONST.TOKEN_DISPOSITIONS.FRIENDLY
            && token.document.disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE) continue;
        if (casterDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE
            && token.document.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;
        if (casterDisp === CONST.TOKEN_DISPOSITIONS.NEUTRAL) continue;
      } else if (targetingMode === 'allies') {
        if (token.document.disposition !== casterDisp) continue;
      }

      qualifying.push({ token, fraction });
    }

    return qualifying;
  }

  /**
   * Build an AOE region centered on a fixed point (e.g., a consumed
   * marker's location). Mirrors the region-data construction in
   * _placeAoeTemplate but without the interactive placement UI.
   *
   * Supports circle and rectangle shapes (the "explode in place" cases).
   * Cone/ray on a fixed-point detonation is geometrically odd — the
   * apex would be at the marker — and is not modeled here; designers
   * using consumes_marker should keep the AOE shape circle/rect.
   *
   * @param {{x:number, y:number}} point  Canvas coordinates of the AOE center
   * @returns {Promise<RegionDocument|null>}
   */
  async _placeAoeAtPoint(point, aoeOverride = null) {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
    const aoe = aoeOverride ?? this.system.aoe ?? {};
    const shape = aoe.shape ?? 'circle';
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const diameterPx = (aoe.diameter ?? 5) * pxPerFt;
    const fillColor = this._getAoeColor();

    let shapeData;
    if (shape === 'circle') {
      shapeData = { type: 'circle', x: point.x, y: point.y, radius: diameterPx / 2 };
    } else if (shape === 'rectangle' || shape === 'rect') {
      const half = diameterPx / 2;
      shapeData = { type: 'rectangle', x: point.x - half, y: point.y - half, width: diameterPx, height: diameterPx, rotation: 0 };
    } else {
      // Fallback to circle for cone/ray — see method doc.
      shapeData = { type: 'circle', x: point.x, y: point.y, radius: diameterPx / 2 };
    }

    const behaviors = [];
    // Difficult terrain uses Foundry's native modifyMovementCost behavior —
    // mirror of the _placeAoeTemplate path so non-variable AOEs placed through
    // this helper (static declare-time placement) also get the movement bite,
    // not just persistentData.zoneEffect (which nothing reads for difficult
    // terrain — only slippery is handled in _checkZoneEffects).
    if ((aoe.zoneEffect ?? 'none') === 'difficultTerrain') {
      behaviors.push({
        type: 'modifyMovementCost',
        name: 'Difficult Terrain',
        system: { difficulties: { walk: 2, crawl: 2, swim: 2, climb: 2 } },
      });
    }
    if ((aoe.templateDuration ?? 0) > 0) {
      behaviors.push({ type: 'persistentAoe', name: 'Persistent AOE Trigger', system: {} });
    }

    const regionData = {
      name: `${this.name} AOE`,
      color: fillColor,
      visibility: 2,
      shapes: [shapeData],
      behaviors,
      flags: {
        'aspects-of-power': {
          aoe: true,
          casterActorUuid: this.actor.uuid,
          skillItemUuid: this.uuid,
          templateDuration: aoe.templateDuration ?? 0,
          placedRound: game.combat?.round ?? 0,
          persistent: (aoe.templateDuration ?? 0) > 0,
          persistentData: (aoe.templateDuration ?? 0) > 0 ? {
            tags: this.system.tags ?? [],
            tagConfig: this.system.tagConfig ?? {},
            rollTotal: null,
            hitTotal: null,
            damageType: this.system.roll?.damageType ?? 'physical',
            targetDefense: this.system.roll?.targetDefense ?? 'melee',
            isMagic: (this.system.tags ?? []).includes('magic'),
            isShrapnel: (this.system.tags ?? []).includes('shrapnel'),
            targetingMode: aoe.targetingMode ?? 'all',
            zoneEffect: aoe.zoneEffect ?? 'none',
            casterDisposition: this.actor.getActiveTokens()?.[0]?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL,
            casterReticPeriod: (() => {
              try {
                const rl = this.actor.system?.attributes?.race?.level ?? 1;
                const refRound = game.aspectsofpower?.celerity?.referenceRoundLength?.(rl) ?? 4702;
                return Math.max(1, Math.round(refRound / 4));
              } catch (e) { return 1175; }
            })(),
            affectedTokens: {},
          } : null,
        },
      },
    };
    const created = await this._gmCreateRegion(canvas.scene, regionData);
    if (!created) return null;
    await new Promise(r => setTimeout(r, 50));
    return created;
  }

  /**
   * Rotate the caster's token to face a target point.
   * @param {object} targetPoint  { x, y } in canvas coordinates.
   */
  async _orientToward(targetPoint) {
    const casterToken = this.actor.getActiveTokens()?.[0];
    if (!casterToken) return;
    const cc = casterToken.center;
    const dx = targetPoint.x - cc.x;
    const dy = targetPoint.y - cc.y;
    if (dx === 0 && dy === 0) return;
    const angle = Math.toDegrees(Math.atan2(dy, dx)) - 90;
    await casterToken.document.update({ rotation: angle });
  }

  /**
   * Auto-fire an on_death-tagged passive AOE skill from a dying actor's
   * location. Bypasses the normal Passive short-circuit, target prompt,
   * celerity defer, and resource cost (the actor has nothing left to spend).
   *
   * Death Bloom-style: builds an AOE region centered on the corpse, runs the
   * skill's tag dispatch (attack / debuff / restoration / buff) against
   * tokens in the region, then removes the region (instantaneous burst).
   *
   * Caller is the death hook in aspects-of-power.mjs (GM-only). Hook fires
   * before any token deletion, so the dying actor's stats and active token
   * are still reachable.
   *
   * @param {Token|TokenDocument} deadToken  Where to center the burst.
   */
  async _fireOnDeath(deadToken) {
    if (!this.actor) return;
    const aoe = this.system.aoe;
    // AOE-ness keys on the tag OR the enabled flag, same as the cast paths
    // (roll dispatch, invest placement, dmgMod coupling) — a tag-only skill
    // must not silently skip its burst.
    if (!aoe?.enabled && !(this.system.tags ?? []).includes('aoe')) return;

    const tokenObj = deadToken.object ?? deadToken;
    const tokenDoc = deadToken.document ?? deadToken;
    const cc = tokenObj.center ?? {
      x: tokenDoc.x + (tokenDoc.width * canvas.grid.size) / 2,
      y: tokenDoc.y + (tokenDoc.height * canvas.grid.size) / 2,
    };

    const item     = this;
    const rollData = this.getRollData();
    const speaker  = ChatMessage.getSpeaker({ actor: this.actor, token: tokenDoc });
    const rollMode = game.settings.get('core', 'messageMode');
    const label    = `[${item.type}] ${item.name}`;
    const tags     = this.system.tags ?? [];

    // ── Build synthetic AOE region centered on the corpse ────────────────
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const placedDiameterPx = aoe.diameter * pxPerFt;
    const fillColor = this._getAoeColor();
    const shape = aoe.shape ?? 'circle';
    let shapeData;
    if (shape === 'circle') {
      shapeData = { type: 'circle', x: cc.x, y: cc.y, radius: placedDiameterPx / 2 };
    } else {
      // Rect fallback for non-circle on-death AOEs (rare; cone/ray don't
      // make sense from a corpse with no facing).
      const half = placedDiameterPx / 2;
      shapeData = { type: 'rectangle', x: cc.x - half, y: cc.y - half, width: placedDiameterPx, height: placedDiameterPx, rotation: 0 };
    }

    const regionData = {
      name: `${this.name} (Death)`,
      color: fillColor,
      visibility: 2,
      shapes: [shapeData],
      behaviors: [],
      flags: {
        'aspects-of-power': {
          aoe: true,
          casterActorUuid: this.actor.uuid,
          skillItemUuid: this.uuid,
          templateDuration: 0,
          placedRound: game.combat?.round ?? 0,
          persistent: false,
          persistentData: null,
          deathTrigger: true,
        },
      },
    };

    const region = await this._gmCreateRegion(canvas.scene, regionData);
    if (!region) return;
    await new Promise(r => setTimeout(r, 50));

    try {
      // ── Build rolls ────────────────────────────────────────────────────
      const { hitFormula, dmgFormula } = this._buildRollFormulas(rollData, { applyRarityMult: true });
      let hitRoll = null;
      if (hitFormula) {
        hitRoll = new Roll(hitFormula, rollData);
        await hitRoll.evaluate();
      }
      const dmgRoll = new Roll(dmgFormula, rollData);
      await dmgRoll.evaluate();

      // ── Find targets ───────────────────────────────────────────────────
      // _getAoeTargets only auto-excludes the caster from cone/ray shapes.
      // Death blooms are circles centered ON the corpse, so the dying
      // actor's token would otherwise be hit by its own burst (the
      // 2026-05-10 combat log showed Saurians "1 target — Bloomed Saurian"
      // — themselves). Strip the dead token explicitly.
      const allTargets = this._getAoeTargets(region);
      const deadTokenId = (deadToken.document ?? deadToken).id;
      const targets = allTargets.filter(t => t.token.id !== deadTokenId);

      // Announce death-trigger.
      ChatMessage.create({
        speaker, rollMode,
        content: `<div class="aoe-result"><p><strong>${this.actor.name}</strong> dies — <strong>${this.name}</strong> bursts! ${targets.length} target(s)${targets.length ? ' — ' + targets.map(t => t.token.document.name).join(', ') : ''}.</p></div>`,
      });

      if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, flavor: `${label} — To Hit` });
      await dmgRoll.toMessage({ speaker, rollMode, flavor: `${label} — Roll` });

      // ── Dispatch each tag to each qualifying token ─────────────────────
      // Mirrors the AOE dispatch loop in roll(); skips tags that don't make
      // sense for a death-trigger (craft / gather / refine / cleanse / repair).
      const hitResults = new Map();
      for (const tag of tags) {
        for (const { token: targetToken, fraction } of targets) {
          switch (tag) {
            case 'attack': {
              const result = await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetToken, fraction);
              if (result) hitResults.set(targetToken, result);
              break;
            }
            case 'debuff': {
              const attackResult = hitResults.get(targetToken);
              if (attackResult && !attackResult.isHit) break;
              if (attackResult?.fullyBlocked) break;
              const defMult = attackResult?.damageMultiplier ?? 1;
              await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken, defMult);
              break;
            }
            // MARK WITHOUT DEBUFF. `mark` routes to the same handler: the
            // effect-spawn gate already fires on `markActive` alone, so a
            // skill carrying only `mark` produces a mark-bearing effect with
            // no debuff content. Skipped when `debuff` is also present, or
            // the handler would run twice and apply the mark twice.
            case 'mark': {
              if (orderedTags.includes('debuff')) break;
              const _mr = hitResults.get(targetToken);
              if (_mr && !_mr.isHit) break;
              await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken, _mr?.damageMultiplier ?? 1);
              break;
            }
            case 'restoration':
              await this._handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'buff':
              await this._handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
          }
        }
      }
    } finally {
      // Instantaneous burst — clean up the synthetic region.
      await this._gmDeleteRegion(canvas.scene, region.id);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Consumable usage                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Use a consumable item. Applies its effect, consumes a charge (or quantity),
   * and posts a chat message.
   */
  async useConsumable() {
    if (this.type !== 'consumable') return;
    const sys = this.system;

    // Check charges / quantity.
    if (sys.charges.value <= 0 && sys.quantity <= 0) {
      ui.notifications.warn(`${this.name} has no charges or uses remaining.`);
      return;
    }

    const effectType = sys.effectType;

    // Repair kits are used via the equipment repair button, not directly.
    if (effectType === 'repairKit') {
      ui.notifications.info('Use the repair button on equipment to use this repair kit.');
      return;
    }

    // Build a summary for the confirmation dialog.
    const effectSummary = this._getConsumableEffectSummary();

    // Confirmation dialog.
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: `Use ${this.name}?` },
      content: `<p>Use <strong>${this.name}</strong>?</p>`
        + `<p class="hint">${effectSummary}</p>`,
      yes: { label: 'Use', icon: 'fas fa-flask' },
      no: { label: 'Cancel' },
    });
    if (!confirmed) return;

    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'messageMode');
    const gmOnly = !_isPlayerCharacter(this.actor);
    const whisperGM = gmOnly ? ChatMessage.getWhisperRecipients('GM') : undefined;

    // Determine target (self for restoration/buff, selected for poison).
    let targetActor = this.actor;
    if (effectType === 'buff') {
      const targetToken = game.user.targets.first();
      targetActor = targetToken?.actor ?? this.actor;
    }

    let chatContent = `<p><strong>${this.actor.name}</strong> uses <strong>${this.name}</strong>.</p>`;

    switch (effectType) {
      case 'restoration': {
        const resource = sys.restoration.resource;
        const amount = sys.restoration.amount;
        if (amount > 0 && targetActor) {
          await this._gmAction({
            type: 'gmApplyRestoration',
            targetActorUuid: targetActor.uuid,
            amount,
            resource,
            overhealth: sys.restoration.overhealth ?? false,
            speaker, rollMode,
          });
        }
        break;
      }

      case 'buff': {
        if (sys.buff.entries.length > 0 && targetActor) {
          const changes = sys.buff.entries.map(e => ({
            key: `system.${e.attribute}.value`,
            type: 'add',
            value: e.value,
          }));
          const effectName = `${this.name} (Consumable)`;
          await this._gmAction({
            type: 'gmApplyBuff',
            targetActorUuid: targetActor.uuid,
            effectName,
            originUuid: this.uuid,
            stackable: false,
            changes,
            duration: sys.buff.duration,
            speaker, rollMode,
          });
        }
        break;
      }

      case 'barrier': {
        const barrierHP = sys.barrier.value;
        if (barrierHP > 0 && targetActor) {
          await this._gmAction({
            type: 'gmApplyRestoration',
            targetActorUuid: targetActor.uuid,
            amount: barrierHP,
            resource: 'barrier',
            barrierAffinities: [],
            barrierSource: this.name,
            speaker, rollMode,
          });
        }
        break;
      }

      case 'poison': {
        // Apply poison flag to the actor's next N attacks.
        const poisonData = {
          damage: sys.poison.damage,
          damageType: sys.poison.damageType,
          remaining: sys.poison.duration,
          source: this.name,
        };
        await this.actor.setFlag('aspects-of-power', 'appliedPoison', poisonData);
        chatContent = `<p><strong>${this.actor.name}</strong> applies <strong>${this.name}</strong> `
          + `(${sys.poison.damage} ${sys.poison.damageType} damage, ${sys.poison.duration} attacks).</p>`;
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: chatContent });
        break;
      }

      case 'bomb': {
        chatContent = `<p><strong>${this.actor.name}</strong> throws <strong>${this.name}</strong> `
          + `(${sys.bomb.damage} ${sys.bomb.damageType} damage, ${sys.bomb.diameter}ft ${sys.bomb.shape}).</p>`;
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: chatContent });
        break;
      }

      case 'ritual': {
        if (!sys.ritualSkillId) {
          ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
            content: `<p><em>${this.name} has no ritual skill encoded — nothing happens.</em></p>` });
          return; // don't consume a charge on a null-ritual no-op
        }
        let ritualSkill = null;
        try { ritualSkill = await fromUuid(sys.ritualSkillId); } catch (e) { /* not found */ }
        if (!ritualSkill || ritualSkill.type !== 'skill') {
          ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
            content: `<p><em>${this.name}: encoded ritual skill not found (${sys.ritualSkillId}).</em></p>` });
          return;
        }
        // Ritual skills carry the `granted` tag so their cast timing is the
        // build-neutral 1/3 reference round (per design — the gem grants the
        // ability, not the caster's training). Fire through the standard
        // skill pipeline — declare-then-fire happens via celerity as normal.
        //
        // Phase 2.5: pass the stored ritualPower as preInvestAmount so the
        // skill's variable-mana invest path uses it directly (skipping the
        // player invest prompt). Effect strength scales from the prep-time
        // ritualPower, not the activating caster's resources. Ritual skills
        // should be authored as variable-mana magic skills for this to
        // actually scale the rolled effect; if they aren't, preInvestAmount
        // is ignored and the cast runs at baseline strength.
        const ritualPower = sys.ritualPower ?? 0;
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          content: `<p><strong>${this.actor.name}</strong> activates <strong>${this.name}</strong> — invoking <em>${ritualSkill.name}</em> at stored power ${ritualPower}.</p>` });
        // ritualActivation flag: in the variable-spell branch, forces cost
        // to 0 (the prep mana was the only payment). preInvestAmount drives
        // damage scaling via (invested/baseMana)^0.2 — the Medium's stored
        // power IS the invest amount. Ritual skills need to be authored as
        // variable-spell-qualifying (attack tag + spellTier + spellGrade)
        // for this to actually move the damage number.
        //
        // If the resolved ritualSkill has no actor (compendium-sourced via
        // ritualActivationSkillId override), it can't .roll() — _isPlayerCharacter
        // and other roll-path helpers dereference this.actor. Clone it onto the
        // activator first, roll on the owned copy, then clean up. If the
        // activator already has an embedded copy (legacy rituals where the
        // skill is granted to the caster), use it directly.
        let rollableSkill = ritualSkill;
        let cleanupTempSkill = false;
        if (!ritualSkill.actor) {
          // Match by grantedFrom UUID ONLY — a bare name match can hijack an
          // unrelated same-named skill (live world has two different "Gem
          // Ritualism" items, common-jeweler vs rare-inscribe).
          const existing = this.actor.items.find(i =>
            i.type === 'skill'
            && i.flags?.aspectsofpower?.grantedFrom === ritualSkill.uuid
          );
          if (existing) {
            rollableSkill = existing;
          } else {
            const skillData = ritualSkill.toObject();
            delete skillData._id;
            skillData.flags = skillData.flags ?? {};
            skillData.flags.aspectsofpower = {
              ...(skillData.flags.aspectsofpower ?? {}),
              grantedFrom: ritualSkill.uuid,
              isRitualActivation: true,
            };
            const [created] = await this.actor.createEmbeddedDocuments('Item', [skillData]);
            rollableSkill = created;
            cleanupTempSkill = true;
          }
        }
        try {
          await rollableSkill.roll({
            preInvestAmount: Math.max(1, ritualPower),
            ritualActivation: true,
          });
        } finally {
          if (cleanupTempSkill && rollableSkill?.id) {
            // In active combat roll() DECLARES rather than executes — the
            // clone must survive until the tracker fires it at the scheduled
            // tick (deleting here orphaned the queued action: "queued item
            // not found", charge wasted — live bug 2026-06-12). The dispatch
            // sites (tracker GM-local branch + executeQueuedAction socket
            // handler) delete isRitualActivation clones after the fire.
            const cm = findCombatantForActor(this.actor);
            const queuedId = cm?.flags?.aspectsofpower?.declaredAction?.itemId;
            if (queuedId !== rollableSkill.id) {
              try { await this.actor.deleteEmbeddedDocuments('Item', [rollableSkill.id]); } catch (_) { /* best-effort */ }
            }
          }
        }
        break;
      }

      case 'none': {
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: chatContent });
        break;
      }
    }

    // Consume a charge. If charges hit 0, consume a quantity and reset charges.
    const updateData = {};
    let newCharges = sys.charges.value - 1;
    if (newCharges <= 0 && sys.charges.max > 0) {
      // Multi-charge item: consume quantity, reset charges.
      const newQty = sys.quantity - 1;
      if (newQty <= 0) {
        await this.delete();
        return;
      }
      updateData['system.quantity'] = newQty;
      updateData['system.charges.value'] = sys.charges.max;
    } else if (sys.charges.max <= 1) {
      // Single-use: consume quantity directly.
      const newQty = sys.quantity - 1;
      if (newQty <= 0) {
        await this.delete();
        return;
      }
      updateData['system.quantity'] = newQty;
    } else {
      updateData['system.charges.value'] = newCharges;
    }
    await this.update(updateData);
  }

  /**
   * Build a human-readable summary of this consumable's effect.
   * @returns {string}
   */
  _getConsumableEffectSummary() {
    const sys = this.system;
    const effectLabel = game.i18n.localize(
      CONFIG.ASPECTSOFPOWER.consumableEffectTypes[sys.effectType] ?? 'ASPECTSOFPOWER.ConsumableEffect.none'
    );
    switch (sys.effectType) {
      case 'restoration': {
        const resLabel = game.i18n.localize(
          CONFIG.ASPECTSOFPOWER.restorationResources[sys.restoration.resource] ?? 'Health'
        );
        return `${effectLabel}: ${resLabel} +${sys.restoration.amount}`;
      }
      case 'buff': {
        const parts = (sys.buff.entries ?? []).map(e => {
          const attrKey = e.attribute?.split('.').pop() ?? '?';
          const sign = e.value >= 0 ? '+' : '';
          return `${attrKey} ${sign}${e.value}`;
        });
        return `${effectLabel}: ${parts.join(', ')} (${sys.buff.duration} rounds)`;
      }
      case 'barrier':
        return `${effectLabel}: ${sys.barrier.value} HP barrier`;
      case 'poison':
        return `${effectLabel}: ${sys.poison.damage} ${sys.poison.damageType} damage for ${sys.poison.duration} attacks`;
      case 'bomb':
        return `${effectLabel}: ${sys.bomb.damage} ${sys.bomb.damageType} damage, ${sys.bomb.diameter}ft ${sys.bomb.shape}`;
      case 'repairKit':
        return `${effectLabel}: +${sys.repairAmount} durability`;
      case 'ritual':
        return sys.ritualSkillId
          ? `${effectLabel}: encoded skill ${sys.ritualSkillId} (${sys.charges?.value ?? 0}/${sys.charges?.max ?? 0} charges)`
          : `${effectLabel}: (no skill encoded)`;
      default:
        return effectLabel;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Main roll dispatcher                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Handle clickable rolls. Evaluates the shared formula once, then dispatches
   * to per-tag handlers based on the skill's tags array.
   * @private
   */
  async roll(options = {}) {
    // Pin this roll to the weapon the DECLARE priced (threaded from the
    // declaredAction through both dispatch routes as preWeaponId). Assigned
    // unconditionally so a plain roll self-clears any stale pin — no finally
    // needed. _resolveWeaponForSkill honours the pin while the weapon is
    // still equipped, which keeps wait, damage, wear and reach on the same
    // blade and closes the mid-windup weapon-swap exploit.
    this._pinnedWeaponId = options.preWeaponId ?? null;

    // ── CAST HOLDING (RULED 2026-08-16, config.castHolding) ──
    // A tiered cast reaching its fire tick may be HELD: the whole fire
    // payload is stored on the combatant and re-rolled verbatim at release,
    // so costs, targets and invests all resolve at the moment of release.
    // Escalating upkeep is charged at each personal round (onStartTurn);
    // the holder is rooted (movement declares refuse); dodging shakes the
    // working loose; reactions stay available. AI never holds.
    if (options.executeDeferred && !options.skipHoldPrompt && !options.aiAutoInvest
        && this.type === 'skill' && this.actor
        && ['magic', 'magic_projectile', 'magic_melee'].includes(this.system.roll?.type ?? '')
        && (this.system.roll?.tier ?? '') !== ''
        && isInActiveCombat(this.actor)
        && !this.actor.flags?.aspectsofpower?.aiProfile) {
      const combatant = findCombatantForActor(this.actor);
      if (combatant && !combatant.flags?.aspectsofpower?.heldCast) {
        // VARIABLE HOLD (user 2026-08-16: "hold until allied/enemy action"):
        // the trigger is chosen at hold time — manual, or auto-release the
        // moment the next ally / enemy acts (the readied-action pattern).
        const choice = await foundry.applications.api.DialogV2.wait({
          window: { title: `${this.name} is ready` },
          content: `<p>The working is complete. Release now, or hold it — `
            + `rooted, upkeep doubling each round, reactions only. `
            + `Held workings can wait on a trigger.</p>`,
          buttons: [
            { action: 'release', label: 'Release', default: true, callback: () => 'release' },
            { action: 'hold', label: 'Hold (manual)', callback: () => 'manual' },
            { action: 'ally', label: 'Until an ally acts', callback: () => 'ally' },
            { action: 'enemy', label: 'Until an enemy acts', callback: () => 'enemy' },
          ],
          close: () => 'release',
        }) ?? 'release';
        if (choice !== 'release') {
          const sc = CONFIG.ASPECTSOFPOWER;
          const tier = this.system.roll?.tier ?? 'basic';
          const gradeF = sc.spellGradeFactors?.[this.actor.system.attributes?.race?.rank] ?? 0;
          const baseMana = Math.max(1, Math.round((sc.spellTierFactors?.[tier] ?? 1) * gradeF));
          const stored = { ...options, skipHoldPrompt: true };
          const flagData = { 'flags.aspectsofpower.heldCast': {
            itemId: this.id, options: stored, baseMana, roundsHeld: 0, trigger: choice } };
          // Combatant writes are GM-only at the server; same routing shape
          // as celerity's _safeCombatantUpdate.
          if (game.user.isGM) await combatant.update(flagData);
          else game.socket.emit('system.aspects-of-power', {
            action: 'gmCombatantUpdate', combatId: combatant.combat?.id,
            combatantId: combatant.id, data: flagData,
          });
          const trigNote = choice === 'ally' ? ' It will fly the moment an ally acts.'
            : choice === 'enemy' ? ' It will fly the moment an enemy acts.' : '';
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: `<p><strong>${this.actor.name}</strong> HOLDS <strong>${this.name}</strong> — `
              + `the completed working hangs ready, and they cannot move.${trigNote}</p>`
              + `<p><button type="button" class="held-cast-release" data-actor-uuid="${this.actor.uuid}">Release</button> `
              + `<button type="button" class="held-cast-collapse" data-actor-uuid="${this.actor.uuid}">Let it collapse</button></p>`,
          });
          return;
        }
      }
    }
    // Combination / weapon-type / STYLE gate (design-weapon-proficiencies.md).
    // A skill that names a required arrangement, weapon, or governing style is
    // unusable without it — the same shape as the existing
    // requires_armor_pierce family. Checked before any cost is paid so a
    // refused skill never charges the actor.
    if (this.type === 'skill' && this.actor) {
      const tc = this.system?.tagConfig ?? {};
      if (tc.requiresStyle || tc.requiresWeaponTag || tc.styleSkill || tc.buffFromEquipment) {
        const { canUseSkill } = await import('../systems/weapon-styles.mjs');
        const verdict = canUseSkill(this.actor, this);
        if (!verdict.allowed) {
          ui.notifications?.warn(verdict.reason);
          return;
        }
      }
    }

    // Consumables have no roll grammar — their entry point is useConsumable().
    // The character sheet knows that (the flask button calls it directly), but
    // `rollItemMacro` calls roll() blindly, so a ritual medium dragged to the
    // hotbar threw "cannot read properties of undefined (reading 'abilities')"
    // instead of being used. Route it rather than crash.
    if (this.type === 'consumable') return this.useConsumable();

    const item     = this;
    // `let` so the detonate-redirect path can shadow rollData with the
    // summon's roll snapshot at AOE dispatch time.
    let rollData = this.getRollData();

    // Summon BEHAVIOR cost: a smarter conjured brain costs more (tier multiplier
    // on the summon's mana). resolveAiBehaviors sums the behavior tiers → mult,
    // applied to rollData.roll.cost so affordability + deduction + display all
    // reflect it. See [[design-ai-behavior-tags]].
    const _summonBeh = this.system.tagConfig?.summonBehaviors ?? [];
    if (_summonBeh.length && (rollData.roll?.cost ?? 0) > 0) {
      const { resolveAiBehaviors } = await import('/systems/aspects-of-power/module/systems/ai.mjs');
      rollData.roll.cost = Math.round(rollData.roll.cost * (resolveAiBehaviors(_summonBeh).costMult ?? 1));
    }
    const speaker  = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'messageMode');
    const label    = `[${item.type}] ${item.name}`;
    const gmOnly = !_isPlayerCharacter(this.actor);
    const whisperGM = gmOnly ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const tags     = this.system.tags ?? [];

    // ── Gate check: block execution if actor has restricting tags ──
    if (this.actor?.system?.collectedTags) {
      const gateRules = CONFIG.ASPECTSOFPOWER.gateRules ?? {};
      const rollType = rollData.roll?.type ?? '';
      const resource = rollData.roll?.resource ?? '';
      for (const [tagId] of this.actor.system.collectedTags) {
        const rule = gateRules[tagId];
        if (!rule) continue;
        if (rollType && rule.blockedTypes?.includes(rollType)) {
          const tagLabel = game.i18n.localize(CONFIG.ASPECTSOFPOWER.tagRegistry?.[tagId]?.label ?? tagId);
          ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Gate.blocked')} (${tagLabel})`);
          return;
        }
        if (resource && rule.blockedResources?.includes(resource)) {
          const tagLabel = game.i18n.localize(CONFIG.ASPECTSOFPOWER.tagRegistry?.[tagId]?.label ?? tagId);
          ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Gate.blocked')} (${tagLabel})`);
          return;
        }
      }
    }

    // ── Sustain toggle: if already active, end it and skip execution ──
    if (tags.includes('sustain') && this.actor) {
      const existingSustain = this.actor.effects.find(e =>
        !e.disabled
        && e.system?.effectType === 'sustain'
        && e.system?.itemSource === this.id
      );
      if (existingSustain) {
        await existingSustain.delete();
        ChatMessage.create({
          speaker,
          content: `<p><strong>${this.actor.name}</strong> ends <strong>${item.name}</strong>.</p>`,
        });
        return;
      }
    }

    // ── Parry-only mode: evaluate just the hit roll for comparison ─────
    if (options.parryOnly) {
      const { hitFormula } = this._buildRollFormulas(rollData);
      if (!hitFormula) return null;
      const hitRoll = new Roll(hitFormula, rollData);
      await hitRoll.evaluate();
      await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Parry` });
      return hitRoll;
    }

    // ── Clash-only mode: evaluate just the DAMAGE, for a damage-vs-damage
    // counter (`reactionType: 'clash'`). Sibling of parryOnly above, which
    // takes the hit formula for the same reason — the caller needs one number
    // to compare and must not fire a second full attack pipeline to get it.
    //
    // ⚠ RARITY IS APPLIED HERE. `_buildRollFormulas` defaults to the PREVIEW
    // shape, which omits the rarity multiplier; a clash priced against a
    // rarity-boosted attack while rolling its own damage un-boosted would lose
    // clashes it should win, and nothing about the result would look wrong.
    if (options.clashOnly) {
      const { dmgFormula } = this._buildRollFormulas(rollData, { applyRarityMult: true });
      if (!dmgFormula) return null;
      const clashRoll = new Roll(dmgFormula, rollData);
      await clashRoll.evaluate();
      await clashRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Clash` });
      return clashRoll;
    }

    // ── ACTIVITY DECLARATION ──────────────────────────────────────────────
    // An `activity`-tagged skill does not resolve as a combat action at all:
    // it puts a BLOCK ON THE CLOCK and stops. The activity framework applies
    // whatever the activity restores when the clock reaches the end of that
    // block, which is the whole shape of the downtime barrier — commit the
    // hour first, collect afterwards.
    //
    // ⚠ ROUTED BY THE TAG, not by the key. `activityKey` on its own is inert,
    // matching every other tagConfig field in this system.
    //
    // ⚠ REFUSED IN COMBAT. Declaring an hour of meditation mid-fight is
    // nonsense, and silently writing a downtime flag on a combatant would put
    // a block on the calendar that nobody meant to start.
    // ⚠⚠ `fromActivityCompletion` SKIPS THIS ENTIRELY. The downtime resolver
    // fires the declaring skill so its real payload runs, and that skill still
    // carries the `activity` tag — without this guard it would declare the same
    // block again and the clock would never get past it.
    if ((item.system.tags ?? []).includes('activity') && !options.fromActivityCompletion) {
      const tc = item.system.tagConfig ?? {};
      const key = tc.activityKey ?? '';
      // Inline timing, for the profession skills that will not each earn a
      // registry entry. A named key still wins — see computeActivityTime.
      // ⚠ HOURS IN, SECONDS OUT. The field is authored in hours because that is
      // how downtime is thought about; the registry and the clock both speak
      // seconds, so the conversion happens here at the boundary and nowhere else.
      const _hours = Number(tc.activityHours) || 0;
      const inline = (tc.activityCost > 0 || _hours > 0)
        ? { label: item.name,
            class: tc.activityClass || (_hours > 0 && !tc.activityCost ? 'clock' : 'celerity'),
            cost: tc.activityCost || 0,
            clockSeconds: Math.round(_hours * 3600),
            qualityScaled: tc.activityQualityScaled === true }
        : null;

      if (!key && !inline) {
        ui.notifications?.warn(`${item.name} is tagged 'activity' but names no activityKey `
          + `and carries no inline duration.`);
        return;
      }
      if (this.actor && isInActiveCombat(this.actor)) {
        ui.notifications?.warn(`${item.name} is downtime — not usable in combat.`);
        return;
      }
      const { DowntimeHelpers } = await import('../systems/downtime.mjs');
      return DowntimeHelpers.declare(this.actor, key, {
        inline,
        sourceSkillUuid: this.uuid,
        // The activity's stat falls back to this skill's own roll ability, so
        // a smithing skill is paced by the smith's stat with nothing authored.
        skill: this,
      });
    }

    // Passive skills → post description only (no roll).
    // EXCEPTION: when executeDeferred is true, the call originated from a
    // reaction trigger (e.g., the hp_threshold scanner firing Bloodrage).
    // We let the roll proceed so the passive's tag handlers (buff, attack,
    // etc.) actually fire and produce their effects. User-clicked passives
    // still short-circuit to description.
    if (this.system.skillType === 'Passive' && !options.executeDeferred) {
      ChatMessage.create({
        speaker,
        rollMode,
        flavor: label,
        content: item.system.description ?? '',
      });
      return;
    }

    // ── Debuff enforcement: check if the actor is blocked from using this skill ──
    if (this.actor) {
      const _hasDebuff = (types) => {
        const arr = Array.isArray(types) ? types : [types];
        return this.actor.effects.find(e =>
          !e.disabled && arr.includes(e.system?.debuffType)
        );
      };

      // Turn-skipping debuffs block all active skill use.
      const skipDebuff = _hasDebuff(['stun', 'sleep', 'paralysis']);
      if (skipDebuff) {
        const typeName = game.i18n.localize(
          CONFIG.ASPECTSOFPOWER.debuffTypes[skipDebuff.system?.debuffType] ?? 'Debuff'
        );
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotAct')} (${typeName})`);
        return;
      }

      // Immobilized blocks PHYSICAL skills. `resource !== 'mana'` was a proxy
      // for that, which broke the moment health became a casting resource
      // (2026-07-31) — an immobilized blood mage is not moving, she is
      // bleeding, and should still be able to cast. Ask the real question:
      // anything carrying the `magic` tag is a cast, whatever it costs.
      if (_hasDebuff('immobilized')
          && rollData.roll.resource !== 'mana'
          && !tags.includes('magic')) {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotAct')} (${game.i18n.localize('ASPECTSOFPOWER.Debuff.immobilized')})`);
        return;
      }

      // Silence blocks skills with vocal components.
      if (_hasDebuff('silence') && this.system.vocalComponent) {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.silenced')} — cannot use ${this.name}!`);
        return;
      }

      // Stacks: a spender with an empty pool cannot fire at all. Checked HERE,
      // beside the other cannot-act gates, so the player is never walked
      // through target selection and an invest dialog for a cast that was
      // never going to resolve. The actual spend happens on the fire path.
      const _stkGate = this.system.tagConfig ?? {};
      if (_stkGate.stackPool && (_stkGate.stackCost ?? 0) > 0) {
        const _held = getStackCount(this.actor, _stkGate.stackPool);
        if (_held < _stkGate.stackCost) {
          ui.notifications.warn(
            `${this.name}: needs ${_stkGate.stackCost} ${_stkGate.stackPool} `
            + `${_stkGate.stackCost === 1 ? 'stack' : 'stacks'}, ${this.actor.name} has ${_held}.`);
          return;
        }
      }

      // Blind blocks skills that require sight.
      if (_hasDebuff('blind') && this.system.requiresSight) {
        // Blind doesn't fully block — it reduces to-hit. Mark for later.
        rollData._blindDebuff = _hasDebuff('blind');
      }

      // Deafened blocks skills that require hearing.
      if (_hasDebuff('deafened') && this.system.requiresHearing) {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.deafened')} — cannot use ${this.name}!`);
        return;
      }

      // Weaken: mark for damage reduction later.
      const weakenEffect = _hasDebuff('weaken');
      if (weakenEffect) {
        rollData._weakenDebuff = weakenEffect;
      }
    }

    // ── Click-skill-then-pick-target (per design 2026-05-10) ──
    // Replaces Foundry's pre-target-T-then-cast workflow. AOE skills
    // bypass — their own placement flow handles canvas selection.
    //
    // Two timing modes:
    //   - Melee/instant: prompt at DECLARE so the engagement-halt math
    //     can use the chosen target's position. Skipped on deferred fire.
    //   - Ranged: prompt at FIRE so the situation (LOS, target HP,
    //     better targets) reflects the moment of resolution. Skipped at
    //     declare for these.
    const targetsAtFire = skillTargetsAtFire(this);
    if (!options.executeDeferred && options.preInvestAmount == null
        && skillNeedsTargetPrompt(this) && !targetsAtFire) {
      // ⚠ A stack SPREAD skill needs the multi-target prompt. The single-target
      // one clears every prior target and resolves on the first click, so
      // routing a spread through it would silently collapse it to one target
      // no matter what the player picked — the spread would be unreachable in
      // normal play.
      // Target ceiling comes from the rule itself: every target needs at least
      // one field, so F >= T, and F + T <= budget gives T <= budget/2.
      const _spCfg = this.system.tagConfig ?? {};
      const _spBudget = (_spCfg.stackPool && (_spCfg.stackCost ?? 0) > 0)
        ? (_spCfg.stackSpreadBudget ?? 0) : 0;
      if (_spBudget > 0) {
        const held = getStackCount(this.actor, _spCfg.stackPool);
        const maxT = Math.max(1, Math.min(Math.floor(_spBudget / 2), held));
        const picked = await selectTargetsOnCanvas({
          max: maxT,
          message: `Click up to ${maxT} target${maxT === 1 ? '' : 's'} for ${this.name}, Enter to confirm (Esc to cancel)`,
        });
        if (!picked?.length) {
          ui.notifications.info(`${this.name} cancelled.`);
          return;
        }
      } else {
        const picked = await selectTargetOnCanvas({
          message: `Click target for ${this.name} (Esc to cancel)`,
        });
        if (!picked) {
          ui.notifications.info(`${this.name} cancelled.`);
          return;
        }
      }
    }

    // ── Restore targets on deferred fire ──
    // game.user.targets is per-client-per-session; the player who
    // picked at declare time may have deselected by fire time. Restore
    // from preTargetIds (snapshotted at declare time, passed through
    // the celerity dispatch socket).
    if (options.executeDeferred && Array.isArray(options.preTargetIds) && options.preTargetIds.length > 0) {
      // Snapshot before clearing — setTarget(false) mutates game.user.targets
      // (a Set) during iteration, which can skip members and leave stale
      // targets alive alongside the restored snapshot.
      for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false, groupSelection: false });
      let liveTargets = 0;
      for (const id of options.preTargetIds) {
        const tok = canvas.tokens?.get(id);
        if (!tok) continue;
        // Stale-target guard: a target that died in the declare→fire window is
        // still a live canvas token (not yet deleted), so the old code happily
        // re-targeted the corpse — applying a full hit AND re-triggering its
        // on-death effects (e.g. detonating Death Bloom on an already-dead
        // creature). Don't swing at the dead.
        const hp = tok.actor?.system?.health?.value;
        if (typeof hp === 'number' && hp <= 0) continue;
        tok.setTarget(true, { releaseOthers: false, groupSelection: false });
        liveTargets++;
      }
      // If every snapshotted target died before the action resolved, the
      // attack whiffs. Fizzle before damage / on-death re-triggers, mirroring
      // the no-target-picked abort below. Area skills are exempt — they resolve
      // on their template/centroid, not a single living token, so a dead anchor
      // token shouldn't cancel the blast.
      // Match the full area predicate used by the static-AOE pre-placement
      // block below — in-world spells largely still use the legacy
      // system.aoe.enabled flag (no `aoe` tag), and the alteration id can be
      // `aoe` as well as `cleave`. Testing only tag+cleave made legacy AOE
      // spells fizzle when their anchor target died in the declare→fire gap,
      // even though the blast resolves on its template, not the token.
      const _isAreaSkill = (this.system.tags ?? []).includes('aoe')
        || this.system.aoe?.enabled === true
        || (this.system.alterations ?? []).some(a => (a.id ?? a) === 'cleave' || (a.id ?? a) === 'aoe');
      if (liveTargets === 0 && !_isAreaSkill) {
        ui.notifications.info(`${this.name} fizzles — its target is already down.`);
        return;
      }
    }

    // ── Fire-time target prompt (ranged) ──
    // Ranged skills defer the target pick until the cast actually fires.
    // The intent signal comes from declare: empty preTargetIds means
    // "no target chosen yet, prompt me at fire." Current game.user.targets
    // can't be the gate — the player may have T-keyed a different token
    // for an unrelated reason between declare and fire, and we'd fire at
    // that stale selection instead of prompting. `selectTargetOnCanvas`
    // clears targets internally before opening the picker, so the stale
    // selection is harmless.
    const _noSnapshotTarget = !Array.isArray(options.preTargetIds) || options.preTargetIds.length === 0;
    if (options.executeDeferred && targetsAtFire && _noSnapshotTarget) {
      const picked = await selectTargetOnCanvas({
        message: `Click target for ${this.name} (Esc to abort)`,
      });
      if (!picked) {
        ui.notifications.info(`${this.name} aborted at fire time — no target picked.`);
        return;
      }
    }

    // Melee reach gate: skip the cast if any selected target is beyond reach.
    // Skipped at fire time (preInvestAmount supplied) since the player already
    // committed at declare time and the target may have moved harmlessly since.
    if (!options.executeDeferred && options.preInvestAmount == null && !this._checkMeleeReach()) {
      return;
    }

    // Build formulas (also populates rollData.roll.abilitymod and resourcevalue).
    // Done BEFORE the celerity defer gate so the variable-invest dialog (which
    // needs formula context) can capture the invest amount at declaration time.
    let { hitFormula, dmgFormula } = this._buildRollFormulas(rollData);

    // ── Spellstrike accuracy override (ruled 2026-07-03) ──────────────────
    // A `spellstrike` skill's accuracy comes from the WIELDED WEAPON, not its
    // casting stat — the spell discharges on the weapon's hit. Two authoring
    // patterns ride this one rule: TYPE-1 vehicle (magic-type + spellstrike +
    // tier → spell-only damage via the invest path below) has its int hit
    // flipped to the weapon here; TYPE-2 fusion (str/dex_weapon + `infused` +
    // spellstrike → weapon strike + int mana-rider) is already weapon-based so
    // this is a consistent no-op. No weapon wielded → keep the casting-stat
    // fallback + warn (bare-fist-as-weapon is the future proper answer).
    if (tags.includes('spellstrike')) {
      const ssHit = this._resolveSpellstrikeHitFormula();
      if (ssHit) {
        hitFormula = ssHit;
      } else {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><em>⚠️ Spellstrike with no weapon wielded — hitting with your casting stat. Equip a weapon to strike with it.</em></p>`,
        });
      }
    }

    // ── PROFICIENCY ON TO-HIT (RULED 2026-07-30) ──────────────────────────
    // Mastery of the weapon type scales accuracy on its own COMPRESSED ladder
    // (10% per tier vs the damage ladder's ~16.7%) — sim in
    // migration/proficiency_tohit_sim.js; design-proficiency-tohit.md.
    // Gated to the same weapon-flavoured roll types as the damage scaling,
    // and applied AFTER the spellstrike override so a TYPE-2 fusion (weapon
    // roll type + spellstrike) keeps it on its weapon-derived hit. TYPE-1
    // vehicles (magic roll type) stay neutral — same scope line the damage
    // side draws. Parries never reach here (options.parryOnly returns above),
    // so the defender-side parry proficiency (81b20fa) cannot double-count.
    // Chained/rider children build their formulas directly and stay neutral.
    if (hitFormula
        && (CONFIG.ASPECTSOFPOWER.weaponProficiency?.rollTypes ?? []).includes(rollData.roll.type)) {
      const _hm = proficiencyHitMult(this.actor, this._proficiencyWeapon());
      if (_hm !== 1) hitFormula = `(${hitFormula})*${_hm}`;
    }

    // ── PER-SKILL TO-HIT MULTIPLIER (RULED 2026-07-31) ────────────────────
    // The skill's OWN accuracy, composing with the proficiency ladder above.
    // Ungated by roll type — a spell may be as clumsy as a weapon. Mathilda's
    // blood kit rides this at 0.5, restored to parity by her Blood Mark.
    {
      const _sm = this.system?.tagConfig?.hitMult ?? 1;
      if (hitFormula && _sm !== 1) hitFormula = `(${hitFormula})*${_sm}`;
    }

    // ── Variable resource invest (per design-magic/melee/ranged-system.md) ─
    // Two gated paths share the same dialog:
    //   Spell: mana + attack + tier+grade set                → Int × mult × √invested
    //   Weapon: stamina + attack + (str_weapon|dex_weapon|phys_ranged) +
    //           requiredEquipment with weight                → blend × mult × √invested
    // Skills that don't match either path keep the legacy formula.
    //
    // The dialog runs HERE (before the celerity defer gate) so the player who
    // owns the actor confirms the invest amount at click time. The amount is
    // then passed to declareAction so the celerity wait reflects it (per
    // Reading-A: Wis controls channel rate, more invest = longer wait). At
    // fire time (executeDeferred), preInvestAmount is supplied and the dialog
    // is skipped.
    let investSelfDamage = 0;
    let investSelfDamageFlavor = ''; // "over-channeling" / "over-exerting"
    let investedAmount = null;       // captured for declareAction
    // CO-INVEST (systems/co-invest.mjs): a second pool spent on top of the
    // primary invest, for an extra damage term. `_commitCastCost` deducts it
    // independently of the primary resource cost. All three stay inert unless
    // the skill carries a co-invest tag naming a pool it does NOT already
    // invest, and the actor can meet that pool's tier floor.
    let coInvestCost = 0;
    let coInvestResource = '';
    let coInvestLabel = '';
    // Orb implement state captured for _commitCastCost. orbBanked: weight to add
    // on a normal qualifying cast. orbDischargedThisCast: true when the cast
    // consumed accumulated charge (resets to 0 after commit).
    let orbBanked = 0;
    let orbDischargedThisCast = false;
    let coInvestDmg = 0;            // for chat breakdown
    // Per-cast AOE context for spells with the `aoe` alteration. Captured at
    // invest-commit time, consumed after AOE template placement to recompute
    // damage based on the actually-placed size. Null when not in play.
    let aoePerCastContext = null;
    const sc = CONFIG.ASPECTSOFPOWER;

    // hasCleave is needed early (variable-spell branch needs to know whether
    // this is an AOE-via-Cleave for placement order); the AOE block below
    // re-uses the same flag.
    const hasCleave = (this.system.alterations ?? []).some(a => a.id === 'cleave');

    const spellTier  = this.system.roll?.tier  ?? '';
    // Spell grade auto-derives from the casting actor's race rank (G/F/E/D/…)
    // so designers don't have to set it per-skill. Falls back to the skill's
    // own `grade` field for compendium / world skills with no actor.
    const spellGrade = this.actor?.system?.attributes?.race?.rank
                    || this.system.roll?.grade
                    || '';
    // HEALTH IS AN INVEST RESOURCE (RULED 2026-07-31). Paying in blood is a
    // real school here, not a flavour label — and before this, choosing
    // `health` silently dropped the skill onto the legacy formula, where its
    // RARITY was ignored entirely (Mathilda's rare Blood Drain out-damaged by
    // her common Blood Bolt, because only Drain reached this path). Substrate
    // for vitality healers, who spend their own life as the casting cost.
    // ⚠ A stack spender in BANKED-PAYLOAD mode is not variable-invest at all:
    // its damage was priced by the producer, so investing mana into it would
    // buy nothing. Without this it would open an invest dialog, charge the
    // caster, and change no number — and "firing is free except for time" is
    // an explicit ruling. Its tier still drives cast SPEED; only the damage
    // and the cost come from the pool.
    const _stkSpender = this.system.tagConfig ?? {};
    const _isPayloadSpender = !!_stkSpender.stackPool
      && (_stkSpender.stackCost ?? 0) > 0
      && getStackPayload(this.actor, _stkSpender.stackPool) > 0;

    // A stack PRODUCER is priced exactly like an attack spell — same invest
    // dialog, same tier/grade/windup damage formula — it just banks the result
    // instead of throwing it at someone. Without this it would need the
    // `attack` tag to reach the invest branch, and would then try to attack a
    // target it does not have; falling back to the legacy formula instead
    // would bank a payload with no windup and no rarity.
    const _isStackProducer = !!_stkSpender.stackPool && (_stkSpender.stackProduces ?? 0) > 0;

    // HEALER UNIFICATION (design-healer-system.md). A restoration skill is
    // priced exactly like an attack spell — same invest dialog, same Wis cap,
    // same tier/windup/rarity — it just restores instead of harming. Without
    // this it fell to the legacy branch, where tier was inert, invest bought
    // nothing, and rarity was not merely ignored but INVERTED: the multiplier
    // the legacy path skips is the skill's own, so the two strongest heals in
    // the world were both `inferior`.
    // Gated on tier like every other spell, so a heal with no tier stays on
    // the legacy branch until its content is authored.
    // ⚠ A HEALING AURA IS A HEAL, AND IT IS NOT `restoration`-TAGGED.
    // Auras are spawned by `_handleBuffTag`, so an aura skill carries `buff`.
    // Tagging it `restoration` as well does NOT work: the dispatch is a
    // `for (tag of tags)` loop over a switch, so both handlers fire and the
    // cast delivers a direct heal AND an aura. So the chanter mode has to be
    // recognised by what the aura DOES, not by the tag that routes it.
    const _isHealAura = tags.includes('buff')
      && (this.system.tagConfig?.auraEffectType ?? 'damage') === 'heal'
      && (this.system.tagConfig?.auraRadius ?? 0) > 0;

    const _isHeal = (tags.includes('restoration')
      && (this.system.tagConfig?.restorationResource ?? 'health') !== 'barrier')
      || _isHealAura;

    // BARRIERS ARE CASTS, NOT HEALS (user ruled 2026-08-03). They join the same
    // invest branch as an attack spell — same dialog, same Wis invest cap, same
    // tier/windup/rarity — and keep INT as their potency rather than swapping in
    // a healing blend. A ward is a thing you conjure, so the stat that makes you
    // a good caster is the stat that makes it big.
    //
    // Before this a barrier was `investedMana x barrierMultiplier`: no stat term
    // at all, so a wisdom-811 healer and a wisdom-200 swordsman made identical
    // shields, and tier, rarity and windup were all inert.
    const _isBarrier = tags.includes('restoration')
      && (this.system.tagConfig?.restorationResource ?? 'health') === 'barrier';

    // ⚠ STAMINA IS A CASTING RESOURCE FOR HEALS ONLY. The chanter mode is
    // defined by casting from stamina (healing.blends.stamina), but stamina was
    // not an accepted spell resource, so a stamina-cast heal fell to the legacy
    // branch and the third healing blend was unreachable by construction - no
    // amount of content could have invoked it. Deliberately NOT widened past
    // heals: `isVariableWeapon` owns stamina for attacks, and letting attacks
    // through here would give every weapon skill a second, spell-shaped path.
    const _castResource = rollData.roll.resource;
    const _castResourceOk = ['mana', 'health'].includes(_castResource)
      || (_isHeal && _castResource === 'stamina');

    const isVariableSpell = _castResourceOk
      && spellTier && spellGrade
      && (tags.includes('attack') || _isStackProducer || _isHeal || _isBarrier)
      && !_isPayloadSpender;

    const isVariableWeapon = rollData.roll.resource === 'stamina'
      && tags.includes('attack')
      && ['str_weapon', 'dex_weapon', 'phys_ranged'].includes(rollData.roll.type);

    if (isVariableSpell) {
      const tierFactor  = sc.spellTierFactors[spellTier];
      const gradeFactor = sc.spellGradeFactors[spellGrade];
      const baseManaAt5ft = Math.round(tierFactor * gradeFactor);
      let   baseMana    = baseManaAt5ft;
      // AOE flow: place the template first (scroll-wheel picks size, capped
      // by what current mana can afford via 2^n × base ≤ pool), then derive
      // a sized baseMana from the placed diameter. The invest dialog then
      // uses sizedBaseMana as its minimum — the player commits to that as
      // the cost and may go above for damage scaling. Cost = invested.
      // Trigger the new sized-base + scroll-wheel flow whenever a skill
       // exposes any AOE — either via the new alteration system OR the legacy
       // system.aoe.enabled flag. Without this, in-world spells (which all
       // still use the legacy flag) skip the new flow entirely.
      const hasAoeAlteration = (this.system.alterations ?? []).some(a => a.id === 'aoe')
        || !!this.system.aoe?.enabled;
      const wisMod      = this.actor.system.abilities?.wisdom?.mod ?? 0;
      // Live read — slider must cap at the actor's CURRENT pool.
      // ⚠ When the pool IS health, hold back a floor so no one can invest
      // themselves to death at the slider. `_commitCastCost` clamps at 0, not
      // 1, so without this the dialog would happily offer a lethal commit.
      const _resKey     = rollData.roll.resource;
      const _healthFloor = (_resKey === 'health')
        ? Math.max(1, sc.invest?.healthFloor ?? 1)
        : 0;
      const livePool    = Math.max(0,
        Math.round(this.actor.system[_resKey]?.value ?? 0) - _healthFloor);
      const intMod      = this.actor.system.abilities?.intelligence?.mod ?? 0;
      // Multiplier resolution: prefer hand-tuned `diceBonus` (designer-set,
      // non-default value) so existing spells don't drift before migration.
      // Otherwise use the rarity-based effective mult — same ladder as
      // weapons (common = 0.60). The old per-tier fallback created an
      // unintentional cliff where common-rarity spells (the schema default)
      // dropped to tierMult (Basic 0.20 = 1/3 of weapon parity); removed
      // 2026-05-04. spellTierMultipliers config is now UI-only.
      const dbVal       = this.system.roll?.diceBonus ?? 1;
      const { effectiveMult } = this._resolveRarityMods();
      const multiplier  = (dbVal && dbVal !== 1) ? dbVal : effectiveMult;

      // Ritual activation is free (the gem is the energy source) — the
      // activator's own mana pool is irrelevant, don't gate on it.
      if (livePool < baseManaAt5ft && !options.ritualActivation) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          // Names the ACTUAL resource: stamina is a valid casting resource for
          // heals now, and a chanter told they lack "mana" would go looking in
          // the wrong pool.
          content: `<p>Not enough ${_resKey} to cast (need ${baseManaAt5ft}, have ${livePool}).</p>`,
        });
        return;
      }

      // ── AOE pre-placement: pick size first, then derive sized base ──
      // Cap the scroll-wheel size at what current mana can afford.
      // Captured here for the AOE block downstream so we don't re-place.
      //
      // Static declaration: the player places the AOE at declare time, the
      // region persists on the scene during the celerity wait, and at fire
      // time we look up the SAME region (by ID, threaded through declareAction
      // → combatant flag → socket → preAoeRegionId) instead of re-prompting.
      // This is the user's "AOE is a strategic choice; you commit when you
      // declare" design intent.
      let preplacedTemplateDoc = null;
      let preplacedAoeShape = null;
      let preplacedAoeOverride = null;
      if (hasAoeAlteration) {
        // Compute Cleave override regardless of declare-vs-fire path.
        if (hasCleave) {
          const wpn = this._resolveWeaponForSkill?.();
          const reach = this._resolveCleaveReach(wpn);
          preplacedAoeOverride = {
            ...(this.system.aoe ?? {}),
            enabled: true,
            shape: 'cone',
            diameter: reach,
            angle: 60,
            targetingMode: this.system.aoe?.targetingMode ?? 'enemies',
          };
        }
        const aoeBaseSize = this.system.aoe?.baseSize ?? 5;

        if (options.preAoeRegionId) {
          // Fire-time path: reuse the region the player placed at declare time.
          preplacedTemplateDoc = canvas.scene?.regions?.get(options.preAoeRegionId) ?? null;
          if (!preplacedTemplateDoc) {
            ChatMessage.create({
              speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
              flavor: label,
              content: '<p><em>⚠️ Declared AOE region no longer exists (was the area deleted between declare and fire?). Cast aborted.</em></p>',
            });
            return;
          }
          preplacedAoeShape = preplacedTemplateDoc.shapes?.[0];
        } else {
          // Declare-time path: interactive placement.
          const casterToken = this.actor.getActiveTokens()?.[0];
          if (!casterToken) {
            ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: '<p><em>No token found on canvas for AOE placement.</em></p>' });
            return;
          }
          // Per-skill AOE base size — sizes at-or-below this are free; above
          // incurs 2^n cost growth where the doubling step is the baseSize
          // itself, not a hardcoded 5ft. So a Fireball (baseSize 20) doubles
          // when scaled to 40ft, quadruples at 60ft. Default 5 preserves
          // prior behavior (5ft doublings for default skills).
          // Solving cost = baseMana × 2^((N - baseSize) / baseSize) for N
          // given the player's pool gives N = baseSize × (1 + log2(pool/baseMana)).
          const maxAffordableSize = Math.max(aoeBaseSize, Math.round(aoeBaseSize * (1 + Math.floor(Math.log2(Math.max(1, livePool / Math.max(1, baseManaAt5ft)))))));
          const placementMaxSize = Math.min(maxAffordableSize, Math.max(25, aoeBaseSize * 5));
          preplacedTemplateDoc = await this._placeAoeTemplate(casterToken, preplacedAoeOverride, placementMaxSize);
          if (!preplacedTemplateDoc) return; // cancelled
          preplacedAoeShape = preplacedTemplateDoc.shapes?.[0];
        }
        // Derive sized base from the actual placed diameter, using the
        // per-skill base size as the cost reference AND the doubling step.
        // Same math regardless of declare-vs-fire — the placed region is the
        // source of truth.
        if (preplacedAoeShape) {
          const pxPerFt = canvas.grid.size / canvas.grid.distance;
          let placedDiameter = aoeBaseSize;
          if (preplacedAoeShape.type === 'circle') placedDiameter = (preplacedAoeShape.radius * 2) / pxPerFt;
          else if (preplacedAoeShape.type === 'cone') placedDiameter = preplacedAoeShape.radius / pxPerFt;
          else if (preplacedAoeShape.type === 'line') placedDiameter = preplacedAoeShape.length / pxPerFt;
          else if (preplacedAoeShape.type === 'rectangle') placedDiameter = preplacedAoeShape.width / pxPerFt;
          baseMana = Math.max(baseManaAt5ft, Math.round(baseManaAt5ft * Math.pow(2, Math.max(0, placedDiameter - aoeBaseSize) / aoeBaseSize)));
        }
      }

      // Hard cap on invest = baseMana + Wis × spellMaxInvestAboveBase[tier],
      // clamped by mana pool. NO self-damage past this cap — Wis is the
      // absolute ceiling per locked design. baseMana is now the sized base
      // for AOE (was at-5ft for non-AOE), so the wis-above-base headroom
      // scales with the AOE size choice.
      const aboveBaseFactor = sc.spellMaxInvestAboveBase?.[spellTier]
        ?? sc.spellMaxInvestAboveBase?.['']
        ?? 1.0;
      const wisCap   = Math.round(baseMana + wisMod * aboveBaseFactor);
      const maxInvest = Math.min(livePool, wisCap);

      if (livePool < baseMana && !options.ritualActivation) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p>Not enough mana to cast at this AOE size (need ${baseMana}, have ${livePool}).</p>`,
        });
        if (preplacedTemplateDoc) await this._gmDeleteRegion(canvas.scene, preplacedTemplateDoc.id);
        return;
      }

      // Orb implement: when banked spell-charge meets the threshold, the
      // next spell cast is a "discharge" — free mana + fast (BASELINE_WEIGHT)
      // wait. The wait is overridden in computeActionWait; here we skip the
      // invest dialog and force cost to 0. Damage uses base invest (=
      // baseMana). After the cast commits, charge resets in _commitCastCost.
      // Universal across tiers per design 2026-05-06.
      //
      // At deferred-fire time, honor the discharge decision captured at
      // declare time — the actor's live spellCharge may have changed
      // between declare and fire (other spells banked or discharged), but
      // the player committed to the discharge when they queued the action.
      const orbCharge = this.actor?.flags?.aspectsofpower?.spellCharge ?? 0;
      const isOrbQualifying = !!spellTier;
      const hasOrbEquipped = this.actor?.getEquippedImplements?.().has('orb');
      const orbDischarging = options.preOrbDischarging
        ?? (isOrbQualifying && hasOrbEquipped
            && orbCharge >= (sc.celerity?.ORB_DISCHARGE_THRESHOLD ?? 400));

      // CO-INVEST on the cast path (systems/co-invest.mjs): `effort` (stamina)
      // or `life-drain` (health) beside a mana cast, `infused` beside a blood
      // cast. The resolver drops any tag naming this cast's OWN resource, so
      // the common cases resolve to null and this costs nothing.
      //
      // ⚠ ATTACKS ONLY. The co-invest term is added to `dmgFormula`, and on a
      // heal or a barrier that string IS the heal/absorb amount — a rider
      // there would silently inflate healing rather than damage.
      const _coEligible = !orbDischarging && !options.ritualActivation
        && tags.includes('attack') && !_isHeal && !_isBarrier;
      const coInvest = _coEligible
        ? resolveCoInvest(this.actor, this, {
            primaryResource: _resKey, tier: spellTier, grade: spellGrade,
            // On a cast, the attack's own potency IS int — so straining
            // physically to push a spell harder makes a bigger SPELL, which is
            // the same "the effort goes where the attack goes" rule.
            hostPotency: intMod,
          })
        : null;
      const useCoInvest = !!coInvest?.affordable;
      if (coInvest && !useCoInvest) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><em>Not enough ${coInvest.resource} for ${coInvest.label} (needs ${coInvest.baseCost || '?'}, has ${coInvest.pool}). Casting without it.</em></p>`,
        });
      }

      let invested;
      let coInvested = 0;
      if (orbDischarging) {
        // Discharge path: no dialog, base damage, zero cost.
        invested = baseMana;
      } else if (useCoInvest && options.preInvestAmount == null && !options.aiAutoInvest) {
        // Two sliders: the cast's own resource plus the co-invest pool. Only a
        // MANA co-invest is channelled — and when the cast itself is mana, the
        // primary invest already drives channel time, so the second slider
        // never adds any.
        //
        // ⚠ windup 1 deliberately, matching the single-slider spell dialog
        // beside it: `spellWindupMultiplier` is resolved below and returns 1
        // while config.spellWeight is off (the default). Both spell previews
        // agree with each other, which matters more here than agreeing with a
        // model nothing has switched on.
        const result = await this._promptCoInvest({
          primary: {
            baseCost: baseMana, safeInvest: 0, maxPool: maxInvest, potency: intMod,
            damageRef: spellDamageRef(gradeFactor), resourceLabel: _resKey,
            damageLabel: 'Spell',
          },
          co: coInvest,
          multiplier, label, potencyLabel: 'Int',
          channelStat: coInvest.channelled ? wisMod : null,
          channelFactor: coInvest.channelled ? (sc.celerity?.CHANNEL_FACTOR ?? 3000) : null,
          baseWait: computeActionWait(this.actor, this, null, null, null),
          windup: 1,
        });
        if (result === null) {
          if (preplacedTemplateDoc) await this._gmDeleteRegion(canvas.scene, preplacedTemplateDoc.id);
          return;
        }
        invested = result.primary;
        coInvested = result.co;
      } else {
        // Deferred fire re-spends the co-invest captured at declare time so the
        // damage and cost match what the player committed to.
        const _preCo = options.preCoInvestAmount ?? options.preManaInvestAmount;
        if (useCoInvest && _preCo != null) coInvested = Math.min(_preCo, coInvest.maxPool);
        invested = (options.preInvestAmount != null)
          // Ritual activation bypasses the wis-derived invest cap (F1, ruled
          // 2026-06-13): prep already wisdom-weighted AND rarity-capped the
          // stored power — clamping again at fire crushed the ladder (live:
          // power 300 → invest 52). The gem's power is the gem's power.
          ? (options.ritualActivation
              ? Math.max(1, options.preInvestAmount)
              // ⚠ FLOOR AT baseMana, NOT JUST CAP AT maxInvest (user ruled
              // 2026-08-05: "if we floor the cost/tier we should be fine").
              // The dialog already enforces this floor (`min="${baseCost}"`)
              // and aiAutoInvest casts at exactly baseMana — this path was the
              // only one that would accept LESS than a minimum cast.
              //
              // It matters because of renewability: the healer sim found 23
              // self-funding configurations, EVERY ONE of them stamina and
              // EVERY ONE below 1x base cost. Stamina regenerates 5% of max
              // per round while mana regenerates nothing in combat, so a heal
              // cheaper than its own base turns a renewable pool into a
              // perpetual healing engine. At 1x base nothing self-funds.
              // Flooring here makes the unreachable-by-dialog case
              // unreachable by script and AI too.
              : Math.min(Math.max(baseMana, options.preInvestAmount), maxInvest))
          : options.aiAutoInvest
          ? Math.min(baseMana, maxInvest)                  // AI: minimum cast, no prompt
          : await this._promptResourceInvest({
              baseCost: baseMana,
              safeInvest: 0,                              // hard cap = no soft zone
              maxPool: maxInvest,
              potency: intMod, multiplier,
              // NOT hardcoded 'mana' — health is a casting resource as of
              // 2026-07-31, and a blood mage being told she is spending mana
              // while the dialog drains her HP is a lie the player acts on.
              resourceLabel: _resKey, potencyLabel: 'Int', label,
              channelStat: wisMod,
              channelFactor: sc.celerity?.CHANNEL_FACTOR ?? null,
              hardCap: true,                              // hide safe-ceiling/self-damage rows
              damageRef: spellDamageRef(gradeFactor),
              // maxPool here is the WIS-capped invest ceiling, so without this
              // the hardCap layout printed the same number twice — once labelled
              // "Max invest" and once labelled "Pool".
              truePool: livePool,
            });
        if (invested === null) {
          if (preplacedTemplateDoc) await this._gmDeleteRegion(canvas.scene, preplacedTemplateDoc.id);
          return;
        }
      }

      // Record the co-invest for the spend + the chat breakdown. Same helper
      // the dialog previewed with, so the number the player committed against
      // is the number they get.
      if (useCoInvest && coInvested > 0) {
        coInvestCost = coInvested;
        coInvestResource = coInvest.resource;
        coInvestLabel = coInvest.label;
        coInvestDmg = coInvestDamage(coInvest.potency, coInvest.coef, coInvested, coInvest.dmgRef);
      }

      investedAmount = invested;
      // ritualActivation: when firing a ritual via a Medium, the mana was
      // already spent at prep time. The stored ritualPower drives invest for
      // damage scaling, but the activator pays nothing — the gem is the
      // energy source. Same zero-cost branch as orbDischarging.
      rollData.roll.cost = (orbDischarging || options.ritualActivation) ? 0 : invested;
      rollData.roll.variableSpellInvest = invested;
      // Persist Orb state for _commitCastCost: discharge resets, normal
      // qualifying cast banks the spell's tier weight (banking weight, not
      // wait, per the threshold-400 design — see celerity.mjs ORB_DISCHARGE_THRESHOLD).
      if (isOrbQualifying && this.actor?.getEquippedImplements?.().has('orb')) {
        if (orbDischarging) {
          orbDischargedThisCast = true;
        } else {
          orbBanked = sc.spellTierWeights?.[spellTier] ?? 0;
        }
      }
      // Staff implement: +baseMana effective mana free for damage scaling.
      // The original pre-celerity design statement: "When casting a spell
      // using half or more than half your AP, increase the spell damage/
      // size by one base cost for free." AP is a measurement of time, so
      // the celerity-era equivalent is: the cast's wait (including any
      // mana-channel time from heavy invest) must be ≥ 50% of the actor's
      // reference round length. Big slow casts qualify; small quick ones
      // don't, regardless of tier.
      //
      // The actor pays the original `invested` cost; damage is computed
      // as if they spent one base cost on top, comping a free base cast.
      // High-tier scaling is implicit — Major/Grand baseMana is huge, so
      // +baseMana on a qualifying Grand cast is a massive damage swing.
      //
      // (AOE-size variant — "one base cost free = +1 size step" — is a
      // separate follow-up; placement-time UX needs to allow scrolling one
      // step beyond the affordable max when the threshold will be met.)
      const rl = this.actor?.system?.attributes?.race?.level ?? 1;
      const roundLen = referenceRoundLength(rl);
      const castWaitWithInvest = computeActionWait(this.actor, this, null, invested);
      const apThresholdTicks = Math.ceil(roundLen * 0.5);
      // Staff bonus is mutually exclusive with Orb discharge — a discharged
      // cast is already free + fast, no need to stack +baseMana on top.
      // TIER-GATED IMPLEMENTS (config.spellWeight.tierGatedImplements, OFF by
      // default): give each implement a band of the tier ladder instead of both
      // keying off cast time. Wands already own BASIC via WAND_BASIC_WAIT_MULT;
      // this hands the staff everything ABOVE basic. The wait-threshold gate is
      // otherwise unchanged — and note the two disagree in an interesting way:
      // the threshold rewards slow casts, so speeding a caster up can switch
      // the staff OFF mid-build, which the tier gate never does.
      const _tierGated = CONFIG.ASPECTSOFPOWER.spellWeight?.tierGatedImplements === true;
      const _staffQualifies = _tierGated
        ? spellTier !== 'basic'
        : (roundLen > 0 && castWaitWithInvest >= apThresholdTicks);
      const hasStaff = !orbDischarging
        && this.actor?.getEquippedImplements?.().has('staff')
        && _staffQualifies;
      const effectiveInvested = hasStaff ? invested + baseMana : invested;
      // Damage uses sized base for AOE (so over-invest above sized base
      // boosts damage), original base for non-AOE.
      if (options.ritualActivation) {
        // SEALED-MEDIUM model (F2, ruled 2026-06-13): the Medium was written
        // at inscription — BOTH accuracy and damage derive from the stored
        // ritualPower, not the activator's stats. The activator contributes
        // the action, the position, and the aim; the gem is the caster.
        // Tower precedent: spawnTower already consumes ritualPower as the
        // summon's whole stat budget. No grade multiplier here — the
        // ritualScale cap table already scales thresholds/caps by grade, so
        // stored power has grade baked in. Rarity `multiplier` stays: same
        // grammar as spells (basis × rarity mult), basis is power not stats.
        const power = Math.max(1, invested);
        hitFormula = houseHitFormula(power);
        dmgFormula = String(Math.round(power * multiplier));
      } else {
        // Invest normalized by a GRADE-RELATIVE FIXED reference (the basic
        // tier's baseMana at this grade), NOT the spell's own baseMana.
        // Normalizing by the spell's own baseMana cancelled tier out of damage
        // entirely — every tier dealt the same base (int×mult) and higher tiers
        // actually did LESS at safe invest (bigger denominator). With a fixed
        // reference, ABSOLUTE mana invested drives damage, so higher tiers
        // (which inherently commit more mana) hit harder. Grade-relative so the
        // ratio is grade-invariant (tier scaling identical at every grade; the
        // grade power-jump comes purely from the int stat curve). Still ^0.2
        // concave → dumping the pool is inefficient, no alpha strike.
        const spellDmgRef = spellDamageRef(gradeFactor);
        // MAGIC/MELEE UNIFICATION (config.spellWeight, OFF by default). A weapon
        // spends its weight twice — windup for damage, wait for tempo — which is
        // what makes DPR weight-invariant. Spells only spent it on wait, so tier
        // cost time and bought no damage. `spellInvestDamage` IS
        // `strikeInvestDamage` with windup pinned to 1, so when the model is off
        // this is byte-identical to the old call.
        const _spellWindup = spellWindupMultiplier(spellTier, heldImplementWeight(this.actor));
        // HEALER UNIFICATION: a restoration skill swaps INT for its mode's
        // healing blend and is otherwise identical — same reference, same
        // windup, same rarity, same invest curve. The mode comes from the
        // casting RESOURCE, because a spell that costs health simply IS blood
        // magic. Everything downstream reads dmgRoll.total, so the heal is the
        // roll: card, preview and applied amount cannot drift apart.
        const _potency = _isHeal
          ? healStatBlend(this.actor.system.abilities, rollData.roll.resource)
          : (_isBarrier
              ? barrierStatBlend(this.actor.system.abilities)
              : intMod);
        // The healing coefficient rides the RARITY multiplier rather than the
        // blend: the blend answers "who heals well", the coefficient answers
        // "how much is a heal worth". Keeping them separate means retuning heal
        // size never disturbs which stats a healer wants.
        const _healCoef = _isHeal ? (sc.healing?.coefficient ?? 0.25) : 1;
        // ⚠ A BARRIER TAKES NO COEFFICIENT AND NO barrierMultiplier — TIER IS
        // THE DIAL (ruled 2026-08-03 after measuring). Both were removed for
        // the same reason: measured in the RIGHT UNIT they were correcting a
        // problem that did not exist. Absorption looks alarming against a
        // health bar, but a barrier eats RAW damage and armour eats most of a
        // raw hit, so the honest unit is INCOMING HITS ABSORBED. In that unit,
        // a basic barrier lands at a median 0.95 hits across the live roster —
        // exactly one attack, which is precisely what a reaction shield is for.
        // Higher tiers then buy 2-3 hits and justify costing an action.
        // The multiplier went with it because rarity is the identity lever
        // every other spell already uses; keeping a second, unbalanced power
        // axis in a single field is what let a x3 hide inside a `common`.
        // + coInvestDmg: the second pool's term. Zero unless this cast carries
        // a co-invest tag for a pool it does not already spend, and gated to
        // attacks upstream so it can never inflate a heal or a barrier.
        dmgFormula = String(strikeInvestDamage(_potency, multiplier * _healCoef,
          _spellWindup, effectiveInvested, spellDmgRef) + coInvestDmg);
      }

      // Hand off to the AOE block below: store the pre-placed template +
      // override so the placement step there can skip re-prompting.
      if (preplacedTemplateDoc) {
        aoePerCastContext = {
          preplacedTemplateDoc,
          preplacedAoeShape,
          preplacedAoeOverride,
        };
      }
      // Spells: no self-damage path under the hard-cap design. Weapons retain it.
    } else if (isVariableWeapon) {
      // Find the weapon for weight + hybrid blend. Hard-link via requiredEquipment
      // takes precedence (e.g. "Soulreaver Strike" must use Soulreaver). For generic
      // skills like "Strike", fall back to the actor's equipped weaponry-slot item
      // (highest-weight non-shield) so designers don't have to wire requiredEquipment
      // on every variant.
      const weapon = this._resolveWeaponForSkill();
      // Empty hands resolve to FISTS on melee roll types — see
      // resolveEffectiveWeaponWeight. Ranged still reports 0 and falls to
      // legacy, which is correct: no bow is no bow.
      const weaponWeight = AspectsofPowerItem.resolveEffectiveWeaponWeight(this, weapon);
      // No weapon weight → fall back to legacy formula path. Warn the player
      // so they know the new pillar isn't being applied (Ability/Dice/Cost
      // from the schema are driving damage, not weapon weight + rarity).
      if (weaponWeight <= 0) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><em>⚠️ No ranged weapon — using legacy formula. Equip one to use the ranged pillar (rarity-driven multiplier × stamina invest).</em></p>`,
        });
      }
      if (weaponWeight > 0) {
        const isRanged = rollData.roll.type === 'phys_ranged';
        const A = this.actor.system.abilities;
        const toughMod = A.toughness?.mod ?? 0;

        // Hybrid stat_blend per design Option B (melee) / Option α (ranged) —
        // ONE implementation in helpers/formulas.mjs, shared with the
        // spellstrike hit override and celerity speed.
        const { blend: statBlend, label: potencyLabel } = weaponStatBlend(weaponWeight, {
          str: A.strength?.mod ?? 0, dex: A.dexterity?.mod ?? 0, per: A.perception?.mod ?? 0,
        }, isRanged);

        // base_stamina uses stat_blend for both melee and ranged — per the
        // 2026-05-03 rebalance, "high-output bodies cost more fuel" applies
        // to BOTH Str specs and Dex specs. The blend reflects whichever stat
        // is doing the work for the wielded weapon, so cost stays internally
        // consistent with damage. Old "elegant property" of constant per-round
        // burn across weapons becomes per-round = 15 × blend / 1085 (now
        // depends on build-vs-weapon match — off-spec weapons cost less AND
        // damage less, which is more coherent than purely flat costs).
        let baseStamina = Math.max(1, Math.round((weaponWeight / sc.invest.staminaBaseDivisor) * (statBlend / sc.invest.staminaNormalizer)));
        // Cleave stamina cost is flat (no per-reach scaling). Expansion past
        // 5ft cone is gated by the `cleave-expansion` passive tag rather than
        // a per-cast cost — see _resolveCleaveReach.
        const safeInvest = Math.max(0, Math.round(toughMod * sc.invest.toughCapFactor));
        // Live read — see equivalent comment above on the spell path.
        const livePool = Math.round(this.actor.system[rollData.roll.resource]?.value ?? 0);
        // Cap invest so the worst-case self-damage at the slider's max equals
        // the actor's current HP. Self-damage is now linear:
        //   self_dmg = potency × (excess/safeInvest) ≤ curHp
        //   → excess ≤ safeInvest × (curHp / potency).
        const curHp = Math.round(this.actor.system.health?.value ?? 0);
        let maxPool = livePool;
        if (safeInvest > 0 && statBlend > 0 && curHp > 0) {
          const maxExcess = safeInvest * (curHp / statBlend);
          maxPool = Math.min(maxPool, Math.floor(baseStamina + safeInvest + maxExcess));
        }
        // Multiplier resolution: prefer hand-tuned `diceBonus` (designer-set,
        // non-default value) so existing skills don't drift before migration.
        // Otherwise fall back to the rarity-based effective mult.
        // An authored diceBonus still carries weapon proficiency (0a25721 —
        // "an authored diceBonus can no longer opt out of proficiency"; that
        // commit patched _buildRollFormulas and this path had been missed, so
        // the REAL damage path let authored skills silently skip the ladder).
        const dbVal = this.system.roll?.diceBonus ?? 1;
        const { effectiveMult } = this._resolveRarityMods();
        const multiplier = (dbVal !== 1)
          ? dbVal * this._proficiencyDamageMult()
          : effectiveMult;

        // Windup and the weapon buff are resolved BEFORE the invest dialog so
        // the preview can include them — they are terms of the damage the swing
        // actually deals, and a preview that omits them is a lie the player
        // commits stamina against (2026-07-30).
        const windup = computeWindupMultiplier(this, weapon);
        const _wpnBuffPre = this.actor.system?.weaponStrikeBuff ?? null;
        const weaponBuffDmg = Math.max(0, Math.round(_wpnBuffPre?.damage ?? 0));

        if (livePool < baseStamina) {
          ChatMessage.create({
            speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
            flavor: label,
            content: `<p>Not enough stamina (need ${baseStamina}, have ${livePool}).</p>`,
          });
          return;
        }

        // CO-INVEST: a strike that also drains a second pool for an extra
        // damage term. `infused` (mana) is the shipped spellstriker fusion;
        // `life-drain` (health) is the same shape paid in blood. `effort` is
        // resolved away here because stamina is already this path's primary —
        // the resolver refuses to double-dip one pool.
        //
        // A CO-INVEST IS A RESOURCE INJECTION, NOT AN AUTHORED SPELL (user
        // ruling 2026-08-10: "I thought this worked just as a mana injection
        // as for spellstrikers"). An untiered weapon skill injects at BASIC
        // tier; authoring a higher tier is how a designer makes it bigger, and
        // grade auto-derives from the actor's race rank. Before that ruling,
        // `spellTierFactors['']` was undefined and EVERY untiered infused
        // skill silently fell through to a plain swing.
        //
        // The invest is wis-capped exactly like a real spell of this tier, so
        // a spellstrike can't pump more into its magical half than a dedicated
        // caster could into the same-tier spell (design-spellstriker fusion
        // balance, 2026-07-03), and damage is normalised by a grade-relative
        // FIXED reference rather than the skill's own base (65f8a42) so higher
        // tiers scale up instead of down.
        const coInvest = resolveCoInvest(this.actor, this, {
          primaryResource: rollData.roll.resource, tier: spellTier, grade: spellGrade,
          // A HOST_POTENCY pool (effort) scales by the swing's OWN blend, so a
          // dagger's exertion is dex-weighted and a greathammer's is
          // str-weighted — `weaponStatBlend` already did that weighting.
          hostPotency: statBlend,
        });
        const useCoInvest = !!coInvest?.affordable;
        if (coInvest && !useCoInvest) {
          ChatMessage.create({
            speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
            flavor: label,
            content: `<p><em>Not enough ${coInvest.resource} for ${coInvest.label} (needs ${coInvest.baseCost || '?'}, has ${coInvest.pool}). Striking without it.</em></p>`,
          });
        }

        // Same pre-capture pattern as the spell path.
        let invested = null;
        let coInvested = 0;
        if (options.preInvestAmount != null) {
          // Same floor as the spell path: a swing cannot cost less than its
          // own base stamina. Deferred re-spend passes a dialog-approved
          // value which is already >= base, so this is a no-op there and a
          // guard against scripted/AI callers.
          invested = Math.min(Math.max(baseStamina, options.preInvestAmount), maxPool);
          // Deferred-fire: re-spend the co-invest captured at declare time so
          // the damage and cost match what the player committed to.
          const _preCo = options.preCoInvestAmount ?? options.preManaInvestAmount;
          if (useCoInvest && _preCo != null) {
            coInvested = Math.min(_preCo, coInvest.maxPool);
          }
        } else if (options.aiAutoInvest) {
          // AI: minimum swing (base stamina, no over-exertion/self-damage),
          // and no co-invest — an NPC does not gamble a second pool.
          invested = Math.min(baseStamina, maxPool);
        } else if (useCoInvest) {
          // Only a MANA co-invest is channelled, so only that one gets the
          // wisdom rate and the channel-time readout. Pre-compute the strike's
          // base wait (no invest, no co-invest) so the dialog can hide the row
          // when the chosen amount would not actually slow the swing.
          const wisMod = this.actor.system.abilities?.wisdom?.mod ?? 0;
          const baseWait = computeActionWait(this.actor, this, weapon, null, null);
          const result = await this._promptCoInvest({
            primary: { baseCost: baseStamina, safeInvest, maxPool, potency: statBlend, damageRef: baseStamina, resourceLabel: 'stamina', damageLabel: 'Strike' },
            co: coInvest,
            multiplier, label, potencyLabel,
            channelStat: coInvest.channelled ? wisMod : null,
            channelFactor: coInvest.channelled ? (sc.celerity?.CHANNEL_FACTOR ?? 3000) : null,
            baseWait, windup, flatBonus: weaponBuffDmg,
          });
          if (result === null) return; // cancelled
          invested = result.primary;
          coInvested = result.co;
        } else {
          invested = await this._promptResourceInvest({
            baseCost: baseStamina, safeInvest, maxPool,
            potency: statBlend, multiplier,
            resourceLabel: 'stamina', potencyLabel, label,
            windup, truePool: livePool, flatBonus: weaponBuffDmg,
          });
        }
        if (invested === null) return; // cancelled

        investedAmount = invested;
        rollData.roll.cost = invested;
        rollData.roll.variableWeaponInvest = invested;
        // Windup (design-active-defense.md): weight→damage coupling. Heavy
        // weapons hit harder per swing (GS 2.0×), light hit lighter (dagger
        // 0.6×) — raw DPS-neutral with wait ∝ weight; the defense layer
        // (one big dodge vs many scrambling dodges) provides the archetype RPS.
        // Resolved above the invest dialog so the preview shows the same number.
        const strikeDmg = strikeInvestDamage(statBlend, multiplier, windup, invested, baseStamina);
        if (useCoInvest && coInvested > 0) {
          coInvestCost = coInvested;
          coInvestResource = coInvest.resource;
          coInvestLabel = coInvest.label;
          // Fusion-penalty coef + grade-relative fixed ref (see the co-invest
          // block above). Same helper the dialog previewed with.
          coInvestDmg = coInvestDamage(coInvest.potency, coInvest.coef, coInvested, coInvest.dmgRef);
        }
        // Weapon buff (Flameblade — design-spellstriker.md): flat affinity
        // damage added to WEAPON strikes while a weapon-buff effect is active
        // (aggregated on the actor by prepareDerivedData). Recorded on rollData
        // so the per-affinity damage breakdown routes this portion through the
        // buff's affinity DR. Applies to melee AND ranged strikes (flaming
        // arrows), NOT to spells/vehicle-spellstrikes. Read above the dialog
        // (weaponBuffDmg) so the preview includes it; re-read here only for the
        // affinity list that routes its share through the buff's DR.
        const weaponBuff = _wpnBuffPre;
        if (weaponBuffDmg > 0) {
          rollData.roll.weaponBuffDamage = weaponBuffDmg;
          rollData.roll.weaponBuffAffinities = [...(weaponBuff.affinities ?? [])];
        }
        dmgFormula = String(strikeDmg + coInvestDmg + weaponBuffDmg);

        // Linear self-damage per design-skill-rarity-system.md: scales 1:1
        // with how far past the safe ceiling you push (shared helper — same
        // math the invest dialogs preview).
        const _wSelf = computeInvestSelfDamage(statBlend, invested, baseStamina, safeInvest);
        if (_wSelf > 0) {
          investSelfDamage = _wSelf;
          investSelfDamageFlavor = 'over-exerting';
        }
      }
    }

    // Variable mana cost for LEGACY (untiered) barrier skills only.
    // ⚠ A barrier that reached the invest branch already committed its mana at
    // the invest dialog — prompting again here would charge twice and overwrite
    // the roll-driven amount with a flat mana multiple, silently undoing the
    // whole barriers-are-casts change.
    const isBarrier = !isVariableSpell
      && tags.includes('restoration')
      && this.system.tagConfig?.restorationResource === 'barrier';
    if (isBarrier) {
      const maxMana = this.actor.system[rollData.roll.resource]?.value ?? 0;
      if (maxMana <= 0) {
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: label, content: `Not enough ${rollData.roll.resource}` });
        return;
      }
      const chosenMana = (options.preInvestAmount != null)
        ? options.preInvestAmount
        : await this._promptBarrierManaCost(maxMana);
      if (chosenMana === null) return; // cancelled
      investedAmount = chosenMana;
      rollData.roll.cost = chosenMana;
      rollData.roll.variableManaCost = chosenMana;
    }

    // ── Static AOE pre-placement (non-variable-spell AOEs) ──
    // Variable-spell AOEs (fireball etc) already pre-placed earlier as part
    // of the invest dialog. Non-attack AOEs (Vine Trap, Spore Heal field,
    // etc.) skip that branch — without this block they'd defer to fire
    // time and prompt placement when the player clicks Advance. Bad UX.
    // Place at declare time so the player commits the location now.
    if (!options.executeDeferred
        && (this.system.aoe?.enabled === true
          || (this.system.tags ?? []).includes('aoe')
          || (this.system.alterations ?? []).some(a => (a.id ?? a) === 'aoe'))
        && !aoePerCastContext?.preplacedTemplateDoc
        && this.actor && isInActiveCombat(this.actor)) {
      const casterToken = this.actor.getActiveTokens()?.[0];
      if (casterToken) {
        let placedRegion = null;
        // detonate tag (per design 2026-05-12): the skill detonates any
        // of the caster's previously-placed mines. The mine's flags
        // carry a snapshot of the summon's aoe + roll config, so the
        // explosion is the summon's identity (Steel Tree explodes as
        // shrapnel, future Crystal Bomb explodes as light/cold, etc.).
        // Detonate itself owns no AOE config beyond being the trigger.
        const tagsList = this.system.tags ?? [];
        if (tagsList.includes('detonate')) {
          const mine = await selectMarkerOnCanvas(null, this.actor.uuid, {
            message: `Click one of your mines to detonate ${this.name} (Esc to cancel)`,
            noneMessage: `No mines to detonate — place one first.`,
          });
          if (!mine) return; // no mines OR cancelled
          const markerShape = mine.shapes?.[0];
          const markerCenter = markerShape?.type === 'circle'
            ? { x: markerShape.x, y: markerShape.y }
            : (markerShape?.type === 'rectangle'
                ? { x: markerShape.x + (markerShape.width ?? 0) / 2, y: markerShape.y + (markerShape.height ?? 0) / 2 }
                : null);
          if (!markerCenter) return;
          // Build the explosion region from the mine's snapshotted aoe
          // config. _placeAoeAtPoint reads this.system.aoe, so for the
          // duration of this call we override with the mine's snapshot.
          const mineAoe = mine.flags?.['aspects-of-power']?.summonAoe ?? this.system.aoe;
          placedRegion = await this._placeAoeAtPoint(markerCenter, mineAoe);
          if (!placedRegion) return;
          // Stash the mine ID + the summon UUID in the AOE region's
          // flags so fire-time resolution can delete the mine AND use
          // the summon's damage formula instead of Detonate's own.
          await placedRegion.update({
            'flags.aspects-of-power.consumedMarkerId': mine.id,
            'flags.aspects-of-power.summonItemUuid': mine.flags?.['aspects-of-power']?.summonItemUuid ?? null,
          });
          aoePerCastContext = { preplacedTemplateDoc: placedRegion, consumedMarkerId: mine.id };
        }
        if (!placedRegion) {
          placedRegion = await this._placeAoeTemplate(casterToken, null, null);
          if (!placedRegion) return; // cancelled
          aoePerCastContext = { preplacedTemplateDoc: placedRegion };
        }
      }
    }

    // ── Movement-skill destination prompt (teleport / leap) ───────────
    // Captured at declare time so the deferred fire knows where to go.
    // Skips when re-entering on executeDeferred. selectDestinationOnCanvas
    // validates range + (for teleport) sight via canvas.visibility.testVisibility.
    let teleportDestination = null;
    let leapDestination = null;
    if (!options.executeDeferred) {
      const _casterToken = this.actor?.getActiveTokens?.()?.[0] ?? null;
      if (tags.includes('teleport') && _casterToken) {
        const { selectDestinationOnCanvas } = await import('../canvas/destination-prompt.mjs');
        const maxFt = this._resolveTeleportMaxDistance(this.actor);
        teleportDestination = await selectDestinationOnCanvas(_casterToken, {
          maxDistanceFt: maxFt,
          requireSight: true,
          snapToGrid: true,
          label: this.name,
          message: `Click destination for ${this.name} (range ${maxFt} ft, sight required; Esc cancels)`,
        });
        if (!teleportDestination) {
          ui.notifications.info(`${this.name} cancelled.`);
          return;
        }
      } else if (tags.includes('leap') && _casterToken) {
        const { selectDestinationOnCanvas } = await import('../canvas/destination-prompt.mjs');
        const maxFt = this.system.tagConfig?.leapMaxDistance ?? 20;
        leapDestination = await selectDestinationOnCanvas(_casterToken, {
          maxDistanceFt: maxFt,
          requireSight: false,
          snapToGrid: true,
          label: this.name,
          message: `Click leap destination for ${this.name} (range ${maxFt} ft; Esc cancels)`,
        });
        if (!leapDestination) {
          ui.notifications.info(`${this.name} cancelled.`);
          return;
        }
      }
    }

    // ── Celerity declaration gate ─────────────────────────────────────
    // In an active combat, queue this skill on the combatant's
    // declaredAction flag and bail. The tracker's "Advance to next" fires
    // it later via `item.roll({ executeDeferred: true, preInvestAmount })`
    // once the clock reaches the scheduled tick. The captured investedAmount
    // (above) feeds Wis-controlled channel time in the celerity wait calc.
    if (!options.executeDeferred && this.actor && isInActiveCombat(this.actor)) {
      // Snapshot picked target IDs at declare time so the deferred fire
      // can restore game.user.targets — the player may deselect between
      // declare and fire (typical celerity gap of seconds-to-minutes).
      //
      // EXCEPTION: ranged skills (`skillTargetsAtFire`) defer target
      // selection entirely to fire-time. Snapshotting here would capture
      // a stale pre-selection (e.g., John was selected for a prior cast,
      // player queues Full Moon Bolt without re-targeting) and shoot the
      // wrong actor at fire when the prompt should have appeared instead.
      // Empty array → restore branch is a no-op, fire-time prompt fires.
      const targetIds = skillTargetsAtFire(this)
        ? []
        : [...game.user.targets].map(t => t.id);
      const declared = await declareAction(this.actor, this, {
        investAmount: investedAmount,
        coInvestAmount: coInvestCost > 0 ? coInvestCost : null,
        coInvestResource,
        // Kept alongside, MANA ONLY: celerity charges channel time for a mana
        // co-invest and the power-sense overlay reads it as magical output. A
        // stamina or blood co-invest is neither, so it must not appear here.
        manaInvestAmount: (coInvestResource === 'mana' && coInvestCost > 0) ? coInvestCost : null,
        aoeRegionId: aoePerCastContext?.preplacedTemplateDoc?.id ?? null,
        // Persist the orb-discharge decision so the deferred fire honors it
        // even if the actor's spellCharge changes between declare and fire.
        orbDischarging: orbDischargedThisCast,
        targetIds,
        teleportDestination,
        leapDestination,
        leapApexFt: leapDestination ? (this.system.tagConfig?.leapApexFt ?? 10) : null,
        // Medium-fired ritual: persist so the deferred fire keeps cost 0
        // (the prep mana was the only payment) — lost otherwise.
        ritualActivation: !!options.ritualActivation,
      });
      return declared;
    }

    // ── STACKS: spend the pool (systems/stacks.mjs) ─────────────────────
    // Fire path only — the declare branch returned above, so a queued cast
    // banks nothing and spends nothing until it actually resolves.
    // Re-checked live rather than trusting the declare-time gate: the pool can
    // empty between declare and fire, which under celerity is seconds to
    // minutes of real table time.
    let stackMult = 1;
    let stackSpent = 0;
    let stackSpread = null;   // [{id, name, fields}] when split across targets
    let stackPayloadEach = 0;
    const _stkCfg = this.system.tagConfig ?? {};
    if (_stkCfg.stackPool && (_stkCfg.stackCost ?? 0) > 0) {
      const held = getStackCount(this.actor, _stkCfg.stackPool);
      const { min, max } = spendableRange(held, _stkCfg.stackCost, _stkCfg.stackMaxSpend);
      if (max < min) {
        ChatMessage.create({ speaker, rollMode, flavor: label,
          content: `Not enough ${_stkCfg.stackPool} stacks (need ${min}, have ${held}).` });
        return;
      }
      // SPREAD MODE: one activation may split fields across several targets,
      // subject to fields + targets <= stackSpreadBudget. Single-target is just
      // the T=1 row of the same rule, so both go through this prompt when a
      // budget is configured.
      const _budget = _stkCfg.stackSpreadBudget ?? 0;
      const _payloadPreview = getStackPayload(this.actor, _stkCfg.stackPool);
      let want = min;
      if (_budget > 0) {
        const tgts = [...game.user.targets];
        if (!tgts.length) {
          ui.notifications.warn(`${this.name}: pick at least one target.`);
          return;
        }
        const assigned = await this._promptStackSpread(
          _stkCfg.stackPool, held, _budget,
          tgts.map(t => ({ id: t.id, name: t.actor?.name ?? t.name })), _payloadPreview);
        if (!assigned?.length) return;   // cancelled or nothing assigned
        stackSpread = assigned;
        want = assigned.reduce((s, a) => s + a.fields, 0);
      } else if (max > min) {
        // Only ask when there is a real choice to make.
        want = await this._promptStackSpend(_stkCfg.stackPool, min, max, _stkCfg.stackScaling ?? 1);
        if (want == null) return;   // cancelled — nothing spent, no cost paid
      }
      // Read the banked payload BEFORE spending — spendStacks deletes the
      // effect when the pool empties, taking the payload with it.
      const payload = getStackPayload(this.actor, _stkCfg.stackPool);
      stackSpent = await spendStacks(this.actor, _stkCfg.stackPool, want);
      if (stackSpent <= 0) {
        ChatMessage.create({ speaker, rollMode, flavor: label,
          content: `${_stkCfg.stackPool} stacks were spent before this resolved.` });
        return;
      }
      if (payload > 0) {
        // BANKED-PAYLOAD MODE. The producer already paid for this damage, so
        // the spender REPLACES its own formula rather than scaling it. This is
        // what lets the hurl be free to fire: a zero-invest spell computes zero
        // damage, since `(invested/20) ** 0.2` is 0 at 0.
        // Overriding the formula (not a post-hoc multiplier) keeps the posted
        // roll, the chat card and the applied damage all the same number.
        stackPayloadEach = payload;
        // On a spread, this formula is only the FIRST target's share; the
        // dispatch loop re-rolls per target from stackPayloadEach.
        const _first = stackSpread?.length ? stackSpread[0].fields : stackSpent;
        dmgFormula = String(Math.max(1, Math.round(payload * _first)));
        stackMult = 1;
      } else {
        stackMult = stackDamageMultiplier(stackSpent, _stkCfg.stackScaling ?? 1);
      }
      const _left = getStackCount(this.actor, _stkCfg.stackPool);
      ChatMessage.create({
        speaker, rollMode,
        content: `<p><em>${this.actor.name} spends <strong>${stackSpent}</strong> `
               + `${stackSpent === 1 ? 'stack' : 'stacks'} on ${this.name}`
               + `${stackSpread?.length > 1
                    ? ` — ${stackSpread.map(a => `${a.fields} at ${a.name}`).join(', ')}`
                    : ''}`
               + `${stackMult !== 1 ? ` — x${Math.round(stackMult * 100) / 100} effect` : ''}`
               + ` (${_left} remaining).</em></p>`,
      });
    }

    // Not enough resource → warn and abort.
    // Read live so a state change between formula-build and now (e.g. mana
    // drained while the variable-invest dialog was open) is caught.
    const liveResAtCheck = this.actor.system[rollData.roll.resource]?.value ?? 0;
    if (liveResAtCheck < rollData.roll.cost) {
      ChatMessage.create({
        speaker,
        rollMode,
        flavor: label,
        content: `Not enough ${rollData.roll.resource} (need ${rollData.roll.cost}, have ${liveResAtCheck}).`,
      });
      return;
    }

    // ── FLAT SECONDARY COST (ki monk, ruled 2026-08-05) ──────────────────
    // A second resource spent flat rather than invested — ki gates HOW OFTEN
    // the big abilities come out, while stamina remains the invested dial.
    // Checked at the same chokepoint as the primary so a skill can never fire
    // half-paid, and read LIVE for the same reason the primary is.
    const _secRes = rollData.roll.secondaryResource;
    const _secCost = Math.max(0, Math.round(rollData.roll.secondaryCost ?? 0));
    if (_secRes && _secCost > 0) {
      const livePool = this.actor.system[_secRes];
      // ⚠ CHECK THE COMBINED DEMAND ON THIS POOL, not just this cost. A
      // co-invest already spends a second pool; a skill that co-invests AND
      // declares a flat secondary into the SAME pool must afford BOTH, or the
      // gate passes and the deduction floors at 0 — a partial spend that looks
      // like a successful cast.
      const _alsoCoInvest = (_secRes === coInvestResource && rollData.roll.resource !== coInvestResource)
        ? Math.max(0, Math.round(coInvestCost || 0)) : 0;
      const _need = _secCost + _alsoCoInvest;
      // ⚠ A missing pool is a REFUSAL, not a free pass. An actor without the
      // `ki` tag has ki.max 0, and letting the cast through because the pool
      // "isn't there" would hand every untagged actor free ki abilities.
      const liveSec = livePool?.value ?? 0;
      if (!livePool || liveSec < _need) {
        ChatMessage.create({
          speaker, rollMode, flavor: label,
          content: `Not enough ${_secRes} (need ${_need}`
            + (_alsoCoInvest ? ` — ${_secCost} cost + ${_alsoCoInvest} ${coInvestLabel.toLowerCase()}` : '')
            + `, have ${liveSec}).`,
        });
        return;
      }
    }

    // ── Evaluate both rolls (shared across all tags) ────────────────────
    // `let` so the detonate-redirect block below can swap in the summon's
    // rolls when this cast is consuming a mine (damage = summon identity).
    let hitRoll = hitFormula ? new Roll(hitFormula, rollData) : null;
    if (hitRoll) await hitRoll.evaluate();

    // ── HEALER'S SIGNATURE (design-healer-system.md) ────────────────────
    // A healer's channelled energy turns poorly to harm. Applied HERE, at the
    // single point every damage branch converges on, rather than inside the
    // spell / weapon / legacy branches separately — three copies of one tax
    // is three chances for them to drift.
    //
    // ⚠ OFFENSIVE ONLY. Gated on the `attack` tag, so heals, barriers and
    // restoration are untouched: dampening healing would tax the very thing
    // the signature pays for.
    //
    // Single application by construction — `healer` is an ACTOR TAG, so a
    // healer class AND a healer profession still read as one tag, which is
    // exactly the no-stacking rule the design asks for.
    if (tags.includes('attack') && this.actor?.hasTag?.('healer')) {
      const _sig = Math.max(0, Math.min(1, sc.healerSignature ?? 0.25));
      if (_sig > 0) dmgFormula = `(${dmgFormula}) * ${1 - _sig}`;
    }

    let dmgRoll = new Roll(dmgFormula, rollData);
    await dmgRoll.evaluate();

    // ── Apply debuff modifiers to roll totals ─────────────────────────
    // Blind: reduce to-hit by amount perception was overcome.
    if (rollData._blindDebuff && hitRoll) {
      const debuffRoll    = rollData._blindDebuff.system?.debuffDamage ?? 0;
      const perceptionMod = this.actor.system.abilities?.perception?.mod ?? 0;
      const hitReduction  = Math.max(0, debuffRoll - perceptionMod);
      if (hitReduction > 0) {
        hitRoll._total = Math.max(0, hitRoll.total - hitReduction);
      }
    }

    // Weaken: reduce damage by the debuff's strength modifier reduction.
    if (rollData._weakenDebuff && dmgRoll) {
      const debuffRoll   = rollData._weakenDebuff.system?.debuffDamage ?? 0;
      const strengthMod  = this.actor.system.abilities?.strength?.mod ?? 0;
      const dmgReduction = Math.max(0, debuffRoll - strengthMod);
      if (dmgReduction > 0) {
        dmgRoll._total = Math.max(0, dmgRoll.total - dmgReduction);
      }
    }

    // Enraged: increase melee damage by the enraged bonus %.
    const enragedBonus = this.actor.system.enragedDamageBonus ?? 0;
    if (enragedBonus > 0 && dmgRoll) {
      const rollType = rollData.roll.type;
      if (rollType === 'str_weapon' || rollType === 'dex_weapon' || rollType === 'magic_melee') {
        dmgRoll._total = Math.round(dmgRoll.total * (1 + enragedBonus));
      }
    }

    const resource  = rollData.roll.resource;

    // Helper to commit resource cost + over-invest self-damage atomically.
    // Called from each cast-completion branch (AOE-after-placement, non-AOE);
    // never called from cancellation paths so self-damage doesn't commit on a
    // back-out. Skipped for barrier skills — they defer cost to a GM action.
    //
    // Reads the live resource value at commit time (not the cached
    // rollData.roll.resourcevalue) so a state change between formula-build
    // and commit can't cause an overspend.
    const _commitCastCost = async () => {
      if (isBarrier) return;
      const updates = {};

      // ── ACCUMULATE SPENDS, THEN WRITE ONCE ─────────────────────────────
      // ⚠ TWO CONTRIBUTORS TO THE SAME POOL MUST SUM, NOT OVERWRITE. A
      // spellstriker invests stamina AND mana via the `infused` path; if that
      // skill also declared a flat mana secondary, the two writes both targeted
      // `system.mana.value` and the LAST one won — silently discarding the
      // infusion cost, so the striker got their invested mana free.
      //
      // Each contributor also has to be measured against the SAME starting
      // value; computing `live - amount` independently per contributor would
      // subtract each from the original pool rather than from the running
      // total, which is the same bug wearing a different hat.
      const _spend = new Map();
      const _addSpend = (res, amt) => {
        const n = Math.round(Number(amt) || 0);
        if (!res || n <= 0 || !this.actor.system[res]) return;
        _spend.set(res, (_spend.get(res) ?? 0) + n);
      };
      _addSpend(resource, rollData.roll.cost);
      // Co-invest: a second pool on top of the primary invest. The
      // same-resource guard is PRESERVED from the original — when the primary
      // already IS that pool, roll.cost is taken to cover it. (The resolver
      // refuses that case upstream too, so this is belt and braces.)
      if (resource !== coInvestResource) _addSpend(coInvestResource, coInvestCost);
      // Flat secondary (ki). Same guard, same reason.
      const _sr = rollData.roll.secondaryResource;
      const _sc2 = Math.max(0, Math.round(rollData.roll.secondaryCost ?? 0));
      if (_sr !== resource) _addSpend(_sr, _sc2);
      // ⚠ OVER-INVEST SELF-DAMAGE IS A SPEND ON HEALTH, not its own write.
      // It used to go straight into `updates`, which was only safe while the
      // co-invest pool was always mana. A `life-drain` strike that ALSO
      // over-exerts now targets system.health.value twice and the last write
      // wins — precisely the defect this accumulator exists to prevent.
      if (investSelfDamage > 0) _addSpend('health', investSelfDamage);

      for (const [res, amt] of _spend) {
        const live = this.actor.system[res]?.value ?? 0;
        updates[`system.${res}.value`] = Math.max(0, Math.round(live - amt));
      }
      // Orb charge: discharge resets charge to 0; normal qualifying cast
      // banks the spell's tier weight onto the existing charge.
      if (orbDischargedThisCast) {
        updates['flags.aspectsofpower.spellCharge'] = 0;
      } else if (orbBanked > 0) {
        const curCharge = this.actor.flags?.aspectsofpower?.spellCharge ?? 0;
        updates['flags.aspectsofpower.spellCharge'] = curCharge + orbBanked;
      }
      await this.actor.update(updates);
      if (investSelfDamage > 0) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><strong>${this.actor.name}</strong> takes <strong>${investSelfDamage}</strong> self-damage from ${investSelfDamageFlavor}.</p>`,
        });
      }
      if (orbDischargedThisCast) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><em>Orb discharge:</em> <strong>${this.actor.name}</strong>'s orb releases its accumulated charge — cast for free at minimum wait.</p>`,
        });
      } else if (orbBanked > 0) {
        const newCharge = (this.actor.flags?.aspectsofpower?.spellCharge ?? 0); // already updated above
        const threshold = sc.celerity?.ORB_DISCHARGE_THRESHOLD ?? 400;
        const ready = newCharge >= threshold ? ' <strong>(ready to discharge!)</strong>' : '';
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><em>Orb charge:</em> ${newCharge} / ${threshold}${ready}</p>`,
        });
      }
      if (coInvestCost > 0 && coInvestDmg > 0) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><em>${coInvestLabel}:</em> spent <strong>${coInvestCost}</strong> ${coInvestResource} for <strong>+${coInvestDmg}</strong> damage.</p>`,
        });
      }
      // Celerity recording: in deferred-fire mode the tracker has already
      // cleared the declaredAction + nextActionTick flags before invoking
      // this roll, so don't re-queue. For non-combat fires, recordActionFired
      // is a safe no-op (it returns null when the actor isn't in combat).
      if (!options.executeDeferred) {
        const cel = await recordActionFired(this.actor, this);
        if (cel) {
          ChatMessage.create({
            speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
            flavor: label,
            content: `<p><em>Celerity:</em> wait <strong>${cel.wait}</strong> ticks → next action at tick <strong>${cel.scheduledTick}</strong>.</p>`,
          });
        }
      } else {
        // Deferred action just resolved → dispatch the quick-actions
        // dialog (mirrors the defense dialog routing pattern). Fires for
        // any actor with favorites — PC or NPC — to keep combat moving.
        // PC with linked player online → socket dispatch.
        // PC without / NPC → local render (typically GM running it).
        const actor = this.actor;
        if (actor) {
          const hasFavorites = actor.items.some(i => i.type === 'skill' && i.system.favorite);
          if (hasFavorites) {
            const linkedPlayer = game.users.find(u =>
              u.active && !u.isGM && u.character?.id === actor.id
            );
            if (linkedPlayer && linkedPlayer.id !== game.user.id) {
              game.socket.emit('system.aspects-of-power', {
                type: 'quickActionsPrompt',
                targetUserId: linkedPlayer.id,
                actorId: actor.id,
              });
            } else {
              try {
                const { QuickActionsDialog } = await import('../apps/quick-actions-dialog.mjs');
                new QuickActionsDialog(actor).render(true);
              } catch (e) {
                console.warn('Quick-actions dialog failed to pop:', e);
              }
            }
          }
        }
      }
    };

    // ── Weapon durability: degrade if raw damage exceeds the weapon's limit ──
    // Wears the weapon the attack RESOLVES with — the same resolution the
    // damage math uses — not the requiredEquipment link. The old gate left
    // 26 of the party's 27 weapon attack skills unable to wear anything
    // (measured 2026-08-15); requiredEquipment is a loadout constraint, not
    // a wear channel. Weapon-typed attacks only: casting through a wand is
    // not swinging it. Unarmed resolves to no item and wears nothing.
    if (tags.includes('attack')
      && ['str_weapon', 'dex_weapon', 'phys_ranged'].includes(this.system.roll?.type ?? '')) {
      const weapon = this._resolveWeaponForSkill?.()
        ?? (this.system.requiredEquipment ? this.actor.items.get(this.system.requiredEquipment) : null);
      if (weapon) {
        const weight = AspectsofPowerItem.resolveEffectiveWeaponWeight(this, weapon);
        await EquipmentSystem.degradeWeaponOnAttack(weapon, dmgRoll.total, weight);
        // Dual-wield rotation state: this swing's hand becomes the LAST hand,
        // so the next weapon attack resolves (and prices) with the other one.
        // Updated at FIRE, the only moment a swing actually happened.
        // Both-hands skills (requiresStyle dual-*) are rotation-NEUTRAL:
        // both hands moved, neither earns the next alternation edge.
        if (dualWieldEligible(this.actor)
            && !(this.system.tagConfig?.requiresStyle ?? '').startsWith('dual')) {
          await setLastSwungHand(this.actor, handOf(this.actor, weapon));
        }
      }
    }

    // ── AOE branch: place template, detect targets, then deduct cost ──
    // Cleave alteration: melee skill with the cleave tag becomes a cone
    // sized to the wielded weapon's reach. Treats Cleave as an AOE even
    // when system.aoe.enabled is false on the underlying skill.
    // hasCleave already computed earlier (needed by the variable-spell branch).
    let aoeOverride = aoePerCastContext?.preplacedAoeOverride ?? null;
    if (!aoeOverride && hasCleave) {
      const wpn = this._resolveWeaponForSkill?.();
      const reach = this._resolveCleaveReach(wpn);
      aoeOverride = {
        ...(this.system.aoe ?? {}),
        enabled: true,
        shape: 'cone',
        diameter: reach,
        angle: 60,
        targetingMode: this.system.aoe?.targetingMode ?? 'enemies',
      };
    }
    const isAoe = (this.system.aoe?.enabled || hasCleave) && tags.length > 0;
    if (isAoe) {
      const casterToken = this.actor.getActiveTokens()?.[0];
      if (!casterToken) {
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: '<p><em>No token found on canvas for AOE placement.</em></p>' });
        return dmgRoll;
      }

      // Variable-spell flow already placed during the invest step (so the
      // sized base could feed the invest dialog). Reuse that placement; only
      // place fresh for AOE skills outside the variable-spell path.
      let templateDoc = aoePerCastContext?.preplacedTemplateDoc ?? null;
      // Fire-time region fetch: declare-time placement region for non-
      // variable AOEs is threaded through options.preAoeRegionId. Without
      // this fallback, Detonate / Vine Trap / etc. would re-prompt at fire
      // time, breaking the static-declaration intent.
      if (!templateDoc && options.preAoeRegionId) {
        templateDoc = canvas.scene?.regions?.get(options.preAoeRegionId) ?? null;
      }
      if (!templateDoc) {
        templateDoc = await this._placeAoeTemplate(casterToken, aoeOverride, null);
        if (!templateDoc) return dmgRoll;
      }

      // Which item/tags the per-target dispatch below uses. Normally this
      // skill's own; the detonate branch swaps in the consumed mine's summon
      // so the explosion resolves as the SUMMON's attack.
      let dispatchItem = item;
      let dispatchTags = tags;

      // Detonate redirect: if this AOE was triggered by a `detonate`-
      // tagged skill consuming a mine, the region carries the summon
      // item's UUID. Override hit/dmg rolls with the summon's formulas
      // built from the caster's current stats so damage reflects the
      // summon's identity (Steel Tree Summon's piercing roll, not
      // Detonate's generic trigger roll). Per design 2026-05-12.
      const detonateSummonUuid = templateDoc.flags?.['aspects-of-power']?.summonItemUuid;
      if (detonateSummonUuid) {
        const summonItem = await fromUuid(detonateSummonUuid).catch(() => null);
        if (summonItem && summonItem.actor?.id === this.actor?.id) {
          const summonRollData = summonItem.getRollData();
          const summonFormulas = summonItem._buildRollFormulas(summonRollData, { applyRarityMult: true });
          if (summonFormulas.hitFormula) {
            hitRoll = new Roll(summonFormulas.hitFormula, summonRollData);
            await hitRoll.evaluate();
          } else {
            hitRoll = null;
          }
          dmgRoll = new Roll(summonFormulas.dmgFormula, summonRollData);
          await dmgRoll.evaluate();
          // Also override damageType / targetDefense for downstream
          // defense routing. rollData lives in this function's scope —
          // shallow-merge the relevant roll fields.
          rollData = foundry.utils.deepClone(rollData);
          rollData.roll = { ...rollData.roll, ...summonRollData.roll };
          // The explosion IS the summon's attack — dispatch the SUMMON's tags
          // on the SUMMON item. Without this the loop below iterates the
          // trigger's tags (Detonate = ['detonate','magic']), matches no
          // `attack` case, and the detonation applies NOTHING: rolls post, the
          // AOE announces targets, zero damage lands (confirmed live 2026-07-18).
          // Also restores the summon's identity tags (shrapnel/pierce/element)
          // that gate mitigation and the dodge penalty.
          dispatchItem = summonItem;
          dispatchTags = summonItem.system.tags ?? [];
        }
      }

      // Orient caster toward the AOE center.
      const aoeShape = templateDoc.shapes?.[0];
      if (aoeShape) {
        await this._orientToward({ x: aoeShape.x, y: aoeShape.y });
      }

      // Damage already accounts for the placed size in the variable-spell
      // path (sized baseMana fed into the invest dialog and the dmgFormula).
      // Nothing to recompute here.

      // Store roll totals on persistent AOE templates for later trigger.
      const persistFlags = templateDoc.flags?.['aspects-of-power'];
      if (persistFlags?.persistent && persistFlags.persistentData) {
        await templateDoc.update({
          'flags.aspects-of-power.persistentData.rollTotal': Math.round(dmgRoll.total),
          'flags.aspects-of-power.persistentData.hitTotal': hitRoll ? Math.round(hitRoll.total) : null,
        });
      }

      // Detect qualifying tokens.
      const targets = this._getAoeTargets(templateDoc);
      if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.AOE.noTokensInArea'));
      }

      // Post roll results to chat.
      if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — To Hit` });
      await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Roll` });

      // Announce targets with their overlap fraction (informational).
      if (targets.length > 0) {
        const targetDescs = targets.map(t => {
          const pct = Math.round(t.fraction * 100);
          return pct >= 99 ? t.token.document.name : `${t.token.document.name} (${pct}%)`;
        }).join(', ');
        ChatMessage.create({
          speaker, rollMode,
          content: `<div class="aoe-result"><p><strong>AOE:</strong> ${targets.length} target(s) — ${targetDescs}</p></div>`,
        });
      }

      // ── KINDLE (`kindle` tag, RULED 2026-08-21 — Flames Without feeds
      // Flames Within): each target this AOE catches feeds a self-buff on
      // the caster — kindledDmgMod = kindlePerTarget × targets caught, for
      // kindleDuration rounds, scoped by the skill's affinities (the
      // `kindled` situational mod does the read-back). Recasting REPLACES
      // the buff from this same skill; it never stacks with itself.
      if ((this.system.tags ?? []).includes('kindle') && targets.length > 0 && this.actor) {
        const _kPer = this.system.tagConfig?.kindlePerTarget ?? 0.1;
        const _kDur = Math.max(1, Math.round(this.system.tagConfig?.kindleDuration ?? 2));
        const _kMod = Math.round(_kPer * targets.length * 100) / 100;
        if (_kMod > 0) {
          const _stale = this.actor.effects.filter(e =>
            (e.system?.kindledDmgMod ?? 0) > 0 && e.origin === this.uuid);
          if (_stale.length) {
            await this.actor.deleteEmbeddedDocuments('ActiveEffect', _stale.map(e => e.id));
          }
          await this.actor.createEmbeddedDocuments('ActiveEffect', [{
            name: `${this.name} — Kindled`,
            img: this.img,
            origin: this.uuid,
            duration: { value: _kDur, type: 'rounds' },
            type: 'base',
            system: {
              kindledDmgMod: _kMod,
              affinities: [...(this.system.affinities ?? [])],
              casterActorUuid: this.actor.uuid,
            },
          }]);
          ChatMessage.create({
            speaker, rollMode,
            content: `<p><em>${this.actor.name} draws the released flames back in: `
                   + `+${Math.round(_kMod * 100)}% ${(this.system.affinities ?? []).join('/') || 'own'}-damage `
                   + `for ${_kDur} rounds (${targets.length} target${targets.length > 1 ? 's' : ''} caught).</em></p>`,
          });
        }
      }

      // Dispatch each tag to each qualifying token. Damage is scaled by
      // the per-target overlap fraction (per design 2026-05-12) — a token
      // 50% inside the AOE takes 50% of the rolled damage.
      const hitResults = new Map();
      for (const tag of dispatchTags) {
        for (const { token: targetToken, fraction } of targets) {
          switch (tag) {
            case 'attack': {
              const result = await dispatchItem._handleAttackTag(dispatchItem, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetToken, fraction);
              if (result) hitResults.set(targetToken, result);
              break;
            }
            case 'restoration':
              await dispatchItem._handleRestorationTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'buff':
              await dispatchItem._handleBuffTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'debuff': {
              // Skip debuff if the attack missed or barrier fully absorbed for this target.
              const attackResult = hitResults.get(targetToken);
              if (attackResult && !attackResult.isHit) break;
              if (attackResult?.fullyBlocked) break;
              const defMult = attackResult?.damageMultiplier ?? 1;
              await dispatchItem._handleDebuffTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label, targetToken, defMult);
              break;
            }
            // MARK WITHOUT DEBUFF. `mark` routes to the same handler: the
            // effect-spawn gate already fires on `markActive` alone, so a
            // skill carrying only `mark` produces a mark-bearing effect with
            // no debuff content. Skipped when `debuff` is also present, or
            // the handler would run twice and apply the mark twice.
            case 'mark': {
              if (orderedTags.includes('debuff')) break;
              const _mr = hitResults.get(targetToken);
              if (_mr && !_mr.isHit) break;
              await dispatchItem._handleDebuffTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label, targetToken, _mr?.damageMultiplier ?? 1);
              break;
            }
            case 'repair':
              await dispatchItem._handleRepairTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'cleanse':
              await dispatchItem._handleCleanseTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'craft':
              await dispatchItem._handleCraftTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label);
              break;
            case 'gather':
              await dispatchItem._handleGatherTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label);
              break;
            case 'refine':
              await dispatchItem._handleRefineTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label);
              break;
            case 'inscribe':
              await dispatchItem._handleInscribeTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label);
              break;
            case 'augment':
              await dispatchItem._handleAugmentTag(dispatchItem, rollData, dmgRoll, speaker, rollMode, label);
              break;
          }
        }
      }

      // Execute chained skills after all parent tags have resolved.
      await this._executeChainedSkills(hitResults, targets, speaker, rollMode,
        { investedAmount, parentDamage: dmgRoll?.total ?? 0,
          // PLAYERS KEEP FULL CONTROL: gate on OWNERSHIP, not on who happens to
          // be logged in. _isPlayerCharacter requires a non-GM user to be
          // ACTIVE with this actor assigned, so a GM driving a PC -- or a
          // player who stepped away -- silently lost the right to decide
          // whether to spend their own stamina. hasPlayerOwner is true for any
          // player-owned actor regardless of who is online; only genuine NPCs
          // auto-fire.
          autoRiders: !!options.aiAutoInvest || !this.actor?.hasPlayerOwner });

      // Mark initial targets as affected on persistent AOEs. Keys are token
      // ids and values are CLOCK TICKS — the re-tick eligibility check
      // (_triggerPersistentAoe) compares affectedTokens[tokenId] against
      // clockTick. The old code keyed by `t.id` (undefined — targets are
      // {token, fraction} wrappers) and stored combat ROUND numbers, which
      // corrupted the per-token re-tick cadence.
      if (persistFlags?.persistent) {
        const currentTick = game.combat?.flags?.aspectsofpower?.clockTick ?? 0;
        const affectedMap = {};
        for (const t of targets) {
          const tokenId = t.token?.id ?? t.id;
          if (tokenId) affectedMap[tokenId] = currentTick;
        }
        await templateDoc.update({ 'flags.aspects-of-power.persistentData.affectedTokens': affectedMap });
      }

      // Deduct resource cost AFTER effects are applied.
      // Barrier skills defer cost deduction to executeGmAction (after target accepts).
      await _commitCastCost();

      // Remove instantaneous AOE regions (duration = 0). Routes through GM
      // dispatch since players don't have OWNER on the scene; a direct
      // delete here would silently fail and orphan the region on canvas.
      if ((this.system.aoe.templateDuration ?? 0) === 0) {
        await this._gmDeleteRegion(canvas.scene, templateDoc.id);
      }

      // consumes_marker: also delete the marker that this cast detonated.
      // The marker ID is stashed in the AOE region's flags at declare time
      // (selectMarkerOnCanvas branch), which survives the declare→fire
      // boundary so this works for both immediate and deferred resolution.
      const consumedMarkerId = templateDoc?.flags?.['aspects-of-power']?.consumedMarkerId
        ?? aoePerCastContext?.consumedMarkerId;
      if (consumedMarkerId) {
        await this._gmDeleteRegion(canvas.scene, consumedMarkerId);
      }

      await this._applySustainEffect(speaker);
      await this._produceStacks(speaker, rollMode, dmgRoll?.total ?? 0);
      return dmgRoll;
    }

    // ── Deduct resource cost (non-AOE) ──────────────────────────────────
    // Barrier skills defer cost until after the target accepts.
    await _commitCastCost();

    // ── STACKS: bank the pool (producer side) ───────────────────────────
    // After the cost is committed, so a cast that could not be paid for
    // conjures nothing.
    await this._produceStacks(speaker, rollMode, dmgRoll?.total ?? 0);

    // ── Legacy behavior for tagless skills ──────────────────────────────
    if (tags.length === 0) {
      const targetToken  = game.user.targets.first() ?? null;
      const targetActor  = targetToken?.actor ?? null;
      const targetDefKey = rollData.roll.targetDefense;

      if (targetActor && targetDefKey && hitRoll) {
        await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label);
        await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Attack` });
        await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Damage` });
      } else {
        if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: 'To Hit' });
        await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: label });
      }
      return dmgRoll;
    }

    // ── Post roll results to chat once (shared) ─────────────────────────
    if (hitRoll) await hitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — To Hit` });
    await dmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${label} — Roll` });

    // ── Orient caster toward target (single-target) ──
    const singleTarget = game.user.targets.first() ?? null;
    if (singleTarget) {
      await this._orientToward(singleTarget.center);
    }

    // ── Dispatch to each tag handler (single-target) ─────────────────────
    // Movement tags (teleport / leap) fire FIRST so the token's position
    // updates before any attack/damage/etc. tags resolve at the new
    // location. Step-and-strike skills (e.g. Subtle Step: teleport in a
    // flash of lightning) should arrive at the destination before the
    // strike resolves, not strike from the original position then teleport.
    const MOVEMENT_TAGS_FIRST = new Set(['teleport', 'leap']);
    const orderedTags = [...tags].sort((a, b) => {
      const aMove = MOVEMENT_TAGS_FIRST.has(a);
      const bMove = MOVEMENT_TAGS_FIRST.has(b);
      if (aMove && !bMove) return -1;
      if (!aMove && bMove) return 1;
      return 0;
    });
    const hitResults = new Map();
    for (const tag of orderedTags) {
      switch (tag) {
        case 'attack': {
          // SPREAD: resolve each target separately with its own share of the
          // fields. The to-hit roll is SHARED across targets, matching how the
          // AOE dispatch already treats a multi-target attack — one action, one
          // swing of intent, many landing points.
          if (stackSpread?.length > 1) {
            for (const asg of stackSpread) {
              const tok = canvas.tokens.get(asg.id);
              if (!tok) continue;
              const share = Math.max(1, Math.round(stackPayloadEach * asg.fields));
              const shareRoll = await new Roll(String(share)).evaluate();
              const result = await this._handleAttackTag(item, rollData, hitRoll, shareRoll,
                speaker, rollMode, `${label} — ${asg.fields} at ${asg.name}`, tok, 1, { stackMult: 1 });
              if (result) hitResults.set(asg.id, result);
            }
            break;
          }
          const soleTarget = stackSpread?.length === 1 ? canvas.tokens.get(stackSpread[0].id) : null;
          const result = await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label,
            soleTarget, 1, { stackMult });
          if (result) hitResults.set(null, result);
          break;
        }
        // RESTORATION / BUFF SPREAD. A banked payload can be split across
        // several ALLIES exactly as the attack case splits it across enemies —
        // Dreams of Light hurls the same five fields either way, so the two
        // halves must divide them by the same rule.
        //
        // ⚠ Without this a spread spender would SPEND every stack and heal only
        // ONE target for the first share: `dmgRoll` is built from
        // `stackSpread[0].fields`, and these handlers otherwise fall back to
        // `game.user.targets.first()`. The stacks would be gone with nothing to
        // show for them.
        case 'restoration':
          if (stackSpread?.length > 1) {
            for (const asg of stackSpread) {
              const tok = canvas.tokens.get(asg.id);
              if (!tok) continue;
              const share = Math.max(1, Math.round(stackPayloadEach * asg.fields));
              const shareRoll = await new Roll(String(share)).evaluate();
              await this._handleRestorationTag(item, rollData, shareRoll, speaker, rollMode,
                `${label} — ${asg.fields} at ${asg.name}`, tok);
            }
            break;
          }
          await this._handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label,
            stackSpread?.length === 1 ? canvas.tokens.get(stackSpread[0].id) : null);
          break;
        case 'buff':
          if (stackSpread?.length > 1) {
            for (const asg of stackSpread) {
              const tok = canvas.tokens.get(asg.id);
              if (!tok) continue;
              const share = Math.max(1, Math.round(stackPayloadEach * asg.fields));
              const shareRoll = await new Roll(String(share)).evaluate();
              await this._handleBuffTag(item, rollData, shareRoll, speaker, rollMode,
                `${label} — ${asg.fields} at ${asg.name}`, tok);
            }
            break;
          }
          await this._handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label,
            stackSpread?.length === 1 ? canvas.tokens.get(stackSpread[0].id) : null);
          break;
        // MARK WITHOUT DEBUFF — see the note on the AOE dispatch above.
        case 'mark': {
          if (orderedTags.includes('debuff')) break;
          const _mr = hitResults.get(null);
          if (_mr && !_mr.isHit) break;
          if (_mr?.fullyBlocked) break;
          await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, null, _mr?.damageMultiplier ?? 1);
          break;
        }
        case 'debuff': {
          // Skip debuff if the attack missed or barrier fully absorbed.
          const attackResult = hitResults.get(null);
          if (attackResult && !attackResult.isHit) break;
          if (attackResult?.fullyBlocked) break;
          const defMult = attackResult?.damageMultiplier ?? 1;
          await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, null, defMult);
          break;
        }
        case 'repair':
          await this._handleRepairTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'cleanse':
          await this._handleCleanseTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'craft':
          await this._handleCraftTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'gather':
          await this._handleGatherTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'refine':
          await this._handleRefineTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'inscribe':
          await this._handleInscribeTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'augment':
          await this._handleAugmentTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'teleport':
          // Out of combat there is no celerity declare→fire round-trip, so the
          // destination picked moments ago lives in the local, not options.
          await this._handleTeleportTag(item, rollData, speaker, rollMode, label, options.preTeleportDestination ?? teleportDestination ?? null);
          break;
        case 'leap':
          await this._handleLeapTag(item, rollData, speaker, rollMode, label,
            options.preLeapDestination ?? leapDestination ?? null,
            options.preLeapApexFt ?? (leapDestination ? (this.system.tagConfig?.leapApexFt ?? 10) : null));
          break;
        case 'summon':
          await this._handleSummonTag(item, rollData, speaker, rollMode, label, options.preInvestAmount, dmgRoll);
          break;
        case 'channel':
          await this._handleChannelTag(item, rollData, speaker, rollMode, label);
          break;
        case 'stance':
          await this._handleStanceTag(item, speaker, rollMode, label);
          break;
      }
    }

    // Execute chained skills after all parent tags have resolved.
    await this._executeChainedSkills(hitResults, null, speaker, rollMode,
      { investedAmount, parentDamage: dmgRoll?.total ?? 0,
        autoRiders: !!options.aiAutoInvest || !this.actor?.hasPlayerOwner });

    await this._applySustainEffect(speaker);
    return dmgRoll;
  }

  /**
   * GUARD STANCE (`stance` tag, design-guard-stances, RULED 2026-08-21).
   * Raise the guard: write `guardStance` on the combatant so parry-class
   * reactions unlock at the defence prompt. The entry PRICE was already
   * paid as this action's celerity wait (_resolveCelerityWeight prices a
   * stance skill by its required guard's weight — the swing formula).
   * Moving, attacking, or dodging collapses it (celerity gates + the
   * dodge branch). Out of combat there is no economy: just announce.
   */
  async _handleStanceTag(item, speaker, rollMode, label) {
    const guard = this._proficiencyWeapon?.() ?? null;
    const combatant = findCombatantForActor(this.actor);
    if (combatant) {
      if (combatant.flags?.aspectsofpower?.guardStance?.itemId === this.id) {
        ChatMessage.create({ speaker, rollMode,
          content: `<p><em>${this.actor.name} is already in ${this.name}.</em></p>` });
        return;
      }
      const flagData = { 'flags.aspectsofpower.guardStance': {
        itemId: this.id, guardItemId: guard?.id ?? null, name: this.name,
        // Lightning-class stances: parries skip their cooldown while held
        // (rate bound by the reaction budget instead).
        parryCooldownFree: this.system.tagConfig?.stanceParryCooldownFree === true } };
      // Combatant writes are GM-only at the server; same routing shape as
      // the held-cast write above.
      if (game.user.isGM) await combatant.update(flagData);
      else game.socket.emit('system.aspects-of-power', {
        action: 'gmCombatantUpdate', combatId: combatant.combat?.id,
        combatantId: combatant.id, data: flagData,
      });
    }
    ChatMessage.create({ speaker, rollMode,
      content: `<p><strong>${this.actor.name}</strong> sets <strong>${this.name}</strong>`
        + (guard ? ` behind ${guard.name}` : '')
        + ` — rooted and ready. Parries are live; moving or striking drops the guard.</p>` });
  }

  /**
   * Execute chained skills after the parent skill's tags have resolved.
   * Each chained skill runs its own rolls and tag handlers, but:
   *   - Resource cost is skipped (chain is "free").
   *   - The chained skill does NOT trigger its own chains (no recursion).
   *   - The chained skill targets the same token(s) as the parent.
   *
   * @param {Map<Token|null, {isHit: boolean, fullyBlocked: boolean}>} hitResults  Per-target hit results from parent.
   * @param {Token[]|null} aoeTargets              AOE targets array, or null for single-target.
   * @param {object} speaker                       Chat speaker data.
   * @param {string} rollMode                      Roll mode setting.
   * @private
   */
  /**
   * Create a sustain ActiveEffect on the caster if the skill has the 'sustain' tag.
   * No-op if the skill doesn't have the tag or there's no caster.
   */
  async _applySustainEffect(speaker) {
    const tags = this.system.tags ?? [];
    if (!tags.includes('sustain') || !this.actor) return;

    const cost     = this.system.tagConfig?.sustainCost ?? 0;
    const resource = this.system.tagConfig?.sustainResource ?? 'mana';

    await this.actor.createEmbeddedDocuments('ActiveEffect', [{
      name: `${this.name} (Sustained)`,
      img: this.img,
      type: 'base',
      system: {
        effectType: 'sustain',
        effectCategory: 'temporary',
        itemSource: this.id,
        sustainCost: cost,
        sustainResource: resource,
      },
    }]);

    ChatMessage.create({
      speaker,
      content: `<p><strong>${this.actor.name}</strong> begins sustaining <strong>${this.name}</strong> (${cost} ${resource}/round).</p>`,
    });
  }

  /**
   * Riders that subscribe to THIS attack, discovered on the actor rather than
   * enumerated by the parent (config.riders). Returns synthetic chain entries
   * so they run down the same execution path as hand-wired chainedSkills —
   * one code path means a rider's DoT sizes off the parent automatically,
   * exactly like a wired chain.
   *
   * A rider must (a) subscribe to the pierced trigger, (b) match every tag in
   * procAttackTags against THIS attack, and (c) not be the attack itself.
   * Affordability is checked at fire time, per-target, since each proc is paid
   * for separately.
   */
  _discoverRiders() {
    const cfg = CONFIG.ASPECTSOFPOWER.riders ?? {};
    const key = cfg.procTriggerPierced ?? 'self_attack_pierced';
    const myTags = this.system.tags ?? [];
    const out = [];
    for (const s of (this.actor?.items ?? [])) {
      if (s.type !== 'skill' || s.id === this.id) continue;
      if ((s.system?.tagConfig?.procTrigger ?? '') !== key) continue;
      const need = s.system?.tagConfig?.procAttackTags ?? [];
      if (!need.every(t => myTags.includes(t))) continue;
      out.push({ skillId: s.id, trigger: 'on-hit', _rider: true });
    }
    return out;
  }

  async _executeChainedSkills(hitResults, aoeTargets, speaker, rollMode, chainContext = {}) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const chains = [...(this.system.chainedSkills ?? []), ...this._discoverRiders()];
    if (chains.length === 0) return;

    for (const chain of chains) {
      if (!chain.skillId) continue;

      const chainedItem = this.actor.items.get(chain.skillId);
      if (!chainedItem || chainedItem.type !== 'skill') continue;
      // Passives are not valid HAND-WIRED chain steps (a chain step is an
      // action the parent triggers, and a passive has no action to take), but
      // they ARE the natural shape for a RIDER: "you bleed people when you get
      // through their armour" is a property of how you fight, not something
      // you spend an action on. Same precedent as retaliation passives, which
      // already auto-fire off the reaction triggers. The rider path dispatches
      // the skill's tag handlers directly rather than going through roll(), so
      // the user-clicked-passive short-circuit never applies here.
      if (chainedItem.system.skillType === 'Passive' && !chain._rider) continue;

      // Determine target list: AOE targets or [null] (single-target uses game.user.targets).
      const targets = aoeTargets ?? [null];

      for (const targetToken of targets) {
        // Evaluate trigger condition per-target.
        const hitResult = hitResults.get(targetToken) ?? hitResults.get(null);
        const wasHit = hitResult?.isHit;
        if (chain.trigger === 'on-hit' && wasHit !== true) continue;
        if (chain.trigger === 'on-miss' && wasHit !== false) continue;

        // Per design 2026-05-11: chains only fire when the parent attack
        // actually landed and delivered damage past the target's
        // defensive layers up to the point each chain cares about.
        //   - miss / fully-blocked barrier / fully-absorbed pool → skip
        //   - chain tagged `requires_armor_pierce` AND parent didn't
        //     pierce armor/veil → skip with a brief chat note
        // Per-target so an AOE that bled through some targets but not
        // others (boss with high armor vs minions) chains only on the
        // pierced ones.
        // ── RIDER gate: on-pierce + stamina cost ────────────────────────
        // Checked BEFORE the shared chain gates below. A rider fires off every
        // qualifying swing, so the no-pierce case is the COMMON case and must
        // exit silently — the requires_armor_pierce gate further down posts a
        // chat line, which at ~6 attacks/round would be pure spam.
        //
        // Riders subscribe to the attack rather than being wired to it, so the
        // trigger IS the pierce condition, and each proc pays its own cost.
        // Cost scales with the parent's damage — that is the whole rate limit;
        // no cooldown, no stack cap (config.riders).
        // Set by the rider gate when an `invest`-tagged rider takes a variable
        // commitment, and used below to override the parent's investedAmount on
        // the rider's own rollData — a rider's magnitude rides ITS OWN invest,
        // not the strike's.
        let riderInvest = null;
        if (chain._rider) {
          if (hitResult?.isHit !== true) continue;
          if (hitResult?.fullyBlocked === true) continue;
          if (hitResult?.piercedMitigation !== true) continue;
          // Per-rider coefficient wins over the config default: a rider built
          // for heavy weapons needs a lower fraction, because cost scales with
          // the parent's damage while stamina pools do not scale with weapon
          // weight (see the procCostFrac schema note).
          const frac = (chainedItem.system?.tagConfig?.procCostFrac ?? 0) || null;
          const cost = procStaminaCost(chainContext?.parentDamage ?? 0, frac);
          const pool = Math.round(this.actor.system.stamina?.value ?? 0);
          // `invest` tag turns the flat toll into a lever: the cost is the floor
          // of a slider and the rider's magnitude scales linearly off what is
          // committed. At base invest the result is identical to the flat
          // formula (dotInvestScale 0.5 × 0.20-cost = the old 0.10 dotScale;
          // crushInvestScale 1.0 × 0.05-cost = the old 0.05 crush), so this is
          // purely additive — nothing is nerfed by adding the tag.
          const riderInvests = (chainedItem.system.tags ?? []).includes('invest');
          if (pool < cost) {
            ChatMessage.create({
              speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
              content: `<p><em>${chainedItem.name} didn't trigger — not enough stamina `
                     + `(need ${cost}, have ${pool}).</em></p>`,
            });
            continue;
          }
          // ASK, don't auto-spend. The cost is meant to be a decision, and a
          // rider that fires on every piercing swing would otherwise drain a
          // rogue's pool on targets already bleeding or about to die. AI and
          // non-player actors take it automatically — a GM driving a dozen
          // hostiles cannot be prompted per swing.
          let spend = cost;
          if (!chainContext?.autoRiders) {
            const tName = targetToken?.document?.name ?? 'the target';
            if (riderInvests) {
              const maxInvest = riderMaxInvest(cost, pool);
              const chosen = await this._promptRiderInvest({
                riderItem: chainedItem, parentName: this.name, targetName: tName,
                baseCost: cost, maxInvest, pool,
              });
              if (chosen === null) continue;
              spend = Math.min(Math.max(cost, chosen), pool);
            } else {
              const proceed = await foundry.applications.api.DialogV2.wait({
                window: { title: `${chainedItem.name}` },
                content: `<p>${this.name} pierced <strong>${tName}</strong>.</p>`
                       + `<p>Apply <strong>${chainedItem.name}</strong> for `
                       + `<strong>${cost}</strong> stamina? `
                       + `<span class="hint">(${pool} → ${pool - cost})</span></p>`,
                buttons: [
                  { action: 'yes', label: `Apply (${cost})`, default: true, callback: () => true },
                  { action: 'no', label: 'Skip', callback: () => false },
                ],
                close: () => false,
              });
              if (!proceed) continue;
            }
          }
          if (riderInvests) riderInvest = spend;
          await this.actor.update({ 'system.stamina.value': pool - spend });
          ChatMessage.create({
            speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
            content: `<p><em>${this.actor.name} tears the wound open — `
                   + `<strong>${chainedItem.name}</strong> (${spend} stamina).</em></p>`,
          });
        }

        const chainTags = chainedItem.system.tags ?? [];
        const isAttackChild = chainTags.includes('attack')
          || chainTags.includes('debuff') || chainTags.includes('restoration')
          || chainTags.includes('buff') || chainTags.includes('cleanse')
          || chainTags.includes('repair');
        if (isAttackChild && hitResult) {
          if (hitResult.isHit === false) continue;
          if (hitResult.fullyBlocked === true) continue;
          if ((hitResult.damageMultiplier ?? 1) <= 0) continue;
          if (chainTags.includes('requires_armor_pierce') && hitResult.piercedMitigation !== true) {
            const tName = targetToken?.document?.name ?? 'target';
            ChatMessage.create({
              speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
              content: `<p><em>${chainedItem.name} didn't trigger on ${tName} — ${this.name} didn't pierce armor.</em></p>`,
            });
            continue;
          }
        }

        // Build the chained skill's own rolls.
        const chainRollData = chainedItem.getRollData();
        // CHAIN CONTEXT (designed in design-chained-skills, built 2026-07-25):
        // a rider has no invest of its own — the chain is free, "the parent's
        // invest covers both phases". Carry the PARENT's invested amount so
        // invest-scaling riders (the `invest` tag) size off what was actually
        // committed to the strike/cast that caused them, instead of the
        // rider's own flat cost. Direct casts are unaffected (they fall back
        // to roll.cost, which for a variable cast already IS the invest).
        if (chainContext?.investedAmount != null) {
          chainRollData.roll = { ...(chainRollData.roll ?? {}),
            investedAmount: Math.max(0, Math.round(chainContext.investedAmount)) };
        }
        // Carry the PARENT's damage total the same way, so a DoT rider sizes
        // off the strike that spawned it (RULED 2026-07-30 — "Hemorrhage should
        // be chained to the strike that spawned it"). Riders roll their own
        // (deliberately small) damage for the direct hit; only the tick reads
        // this. Without it a Feint-boosted 1026 strike left the same ~46 bleed
        // as an unbuffed one, which severed the rotation's payoff from its
        // setup and kept the bleed under every realistic DR. See
        // formulas.dotTickDamage.
        if (chainContext?.parentDamage != null) {
          chainRollData.roll = { ...(chainRollData.roll ?? {}),
            parentDamage: Math.max(0, Math.round(chainContext.parentDamage)) };
        }
        // An `invest`-tagged RIDER paid its own stamina above, and that — not
        // the parent's invest — is what its magnitude rides. Overrides the
        // carry-down, so the two invest semantics don't collide: a hand-wired
        // chain step still inherits the parent's commitment (the chain is free),
        // while a rider that charged for itself scales on its own charge.
        if (riderInvest != null) {
          chainRollData.roll = { ...(chainRollData.roll ?? {}),
            investedAmount: Math.max(0, Math.round(riderInvest)) };
        }
        const chainLabel = `[chain] ${chainedItem.name}`;
        const { hitFormula: cHitF, dmgFormula: cDmgF } = chainedItem._buildRollFormulas(chainRollData, { applyRarityMult: true });

        // A RIDER rolls no hit of its own — the parent attack already resolved
        // the defense, and (RULED 2026-08-16: "hemorrhage damage should be
        // exclusively through the hit that procs it and stamina invest") it
        // deals no direct damage either. The damage FORMULA is still rolled
        // below because debuff magnitudes (DR-strip, crush) read it; it just
        // never reaches HP.
        const cHitRoll = (cHitF && !chain._rider) ? new Roll(cHitF, chainRollData) : null;
        if (cHitRoll) await cHitRoll.evaluate();

        const cDmgRoll = new Roll(cDmgF, chainRollData);
        await cDmgRoll.evaluate();

        // Post chained skill rolls to chat.
        if (cHitRoll) await cHitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${chainLabel} — To Hit` });
        await cDmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${chainLabel} — ${chain._rider ? 'Potency' : 'Roll'}` });

        // Dispatch each of the chained skill's own tags. (chainTags
        // already declared above for the pierce / fully-blocked gate.)
        for (const tag of chainTags) {
          switch (tag) {
            case 'attack':
              // Riders skip the attack dispatch entirely — no second hit card,
              // no direct HP application (see the ruling above). Hand-wired
              // chain steps keep it: they are real follow-up actions.
              if (chain._rider) break;
              // Chain step: no second Defend prompt (parent already resolved it).
              await chainedItem._handleAttackTag(chainedItem, chainRollData, cHitRoll, cDmgRoll, speaker, rollMode, chainLabel, targetToken, 1, { skipDefense: true });
              break;
            case 'restoration':
              await chainedItem._handleRestorationTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'buff':
              await chainedItem._handleBuffTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'debuff':
              await chainedItem._handleDebuffTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'repair':
              await chainedItem._handleRepairTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
            case 'cleanse':
              await chainedItem._handleCleanseTag(chainedItem, chainRollData, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
              break;
          }
        }
      }
    }
  }
}

// Crafting tag handlers live in systems/crafting-skills.mjs and are mixed
// into the prototype here — identical method identities, relocated source.
Object.assign(AspectsofPowerItem.prototype, CraftingSkillsMixin);
