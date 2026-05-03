import { EquipmentSystem } from '../systems/equipment.mjs';
import { getPositionalTags } from '../helpers/positioning.mjs';
import { recordActionFired, declareAction, isInActiveCombat } from '../systems/celerity.mjs';

/**
 * Check if an actor is an assigned player character (not just owned).
 * @param {Actor} actor
 * @returns {boolean}
 */
function _isPlayerCharacter(actor) {
  return game.users.some(u => !u.isGM && u.active && u.character?.id === actor.id);
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
  /**
   * Combined "Craft Setup" dialog: refine + prep selection with a live preview of expected outcome.
   * Replaces the old separate refine/prep offer dialogs in _handleCraftTag.
   * Returns: { refineId, prepId } or 'cancel' if dismissed. Empty {} if nothing to ask about.
   */
  async _showCraftSetupDialog({ item, actor, materialItem, reworkTarget, typeKey }) {
    // What's available?
    let refineSkills = [];
    let refineHeadroom = 0;
    if (materialItem) {
      refineSkills = actor.items.filter(i =>
        i.type === 'skill' && (i.system.tags ?? []).includes('refine')
      );
      const cur = materialItem.system.progress ?? 0;
      const max = materialItem.system.maxProgress ?? Math.round(cur * 1.2);
      refineHeadroom = Math.max(0, max - cur);
    }
    const showRefine = refineSkills.length > 0 && refineHeadroom > 0;

    const prepSkills = actor.items.filter(i =>
      i.type === 'skill' && (i.system.tags ?? []).includes('preparation')
    );
    const showPrep = prepSkills.length > 0;

    // Skip the dialog entirely if there's nothing to choose.
    if (!showRefine && !showPrep) return {};

    const A = actor.system.abilities;

    // Helper: compute average skill roll for any skill (used by craft, prep, and refine previews).
    const avgSkillRollFor = (skill) => {
      const r = skill.system?.roll ?? {};
      const primaryMod = A[r.abilities]?.mod ?? 0;
      let abMod = primaryMod;
      if (r.statType === 'hybrid') {
        const secMod = A[r.secondaryAbility]?.mod ?? 0;
        const pw = r.primaryWeight ?? 1.0;
        const sw = r.secondaryWeight ?? 0;
        abMod = Math.round(primaryMod * pw + secMod * sw);
      }
      const dm = String(r.dice || '0').match(/(\d*)d(\d+)/);
      const diceCount = dm ? (parseInt(dm[1]) || 1) : 0;
      const diceSize  = dm ? parseInt(dm[2]) : 0;
      const avgDice = diceCount * (diceSize + 1) / 2;
      const diceBonus = r.diceBonus ?? 1;
      return Math.round(((avgDice / 100) + 1) * abMod * diceBonus);
    };

    const avgSkillRoll = avgSkillRollFor(item);

    // Profession augment bonuses (element-filtered, fixed at dialog open).
    const matEl = materialItem ? (materialItem.system.materialElement || '') : '';
    const augBonuses = actor.getProfessionAugmentBonuses(matEl);
    const d100Bonus        = augBonuses.d100Bonus || 0;
    const progressBonus    = augBonuses.craftProgress || 0;
    const skillModBonus    = augBonuses.craftSkillMod || 0;
    const rarityFloorBonus = augBonuses.rarityFloor || 0;

    // d100 expectation under material's rarity range.
    const matRarity = materialItem
      ? (materialItem.system.rarity || 'common')
      : (reworkTarget?.system.rarity || 'common');
    const rarityRange = CONFIG.ASPECTSOFPOWER.craftRarityRanges?.[matRarity] ?? { floor: 1, ceiling: 100 };
    const avgD100 = Math.min(50.5 + rarityRange.floor + rarityFloorBonus + d100Bonus, rarityRange.ceiling);
    const avgD100Pct = avgD100 / 100;
    const avgCrafterRoll = Math.round((avgSkillRoll + skillModBonus) * avgD100Pct);
    const avgCrafterCtrb = Math.round(avgCrafterRoll * 0.5);

    // Augment summary line.
    const augLines = [];
    if (skillModBonus)    augLines.push(`Skill +${skillModBonus}`);
    if (d100Bonus)        augLines.push(`d100 +${d100Bonus}`);
    if (rarityFloorBonus) augLines.push(`Floor +${rarityFloorBonus}`);
    if (progressBonus)    augLines.push(`Progress +${progressBonus}`);
    const augSummary = augLines.length > 0 ? augLines.join(', ') : '<em>None active</em>';

    // Quality tiers (sorted high to low) for tier-lookup in preview.
    const qualitySorted = Object.entries(CONFIG.ASPECTSOFPOWER.craftQuality ?? {})
      .sort((a, b) => b[1].minProgress - a[1].minProgress);
    const qualityForProgress = (p) => {
      for (const [key, def] of qualitySorted) {
        if (p >= def.minProgress) return { key, label: key.charAt(0).toUpperCase() + key.slice(1), rarity: def.rarity };
      }
      return { key: 'cracked', label: 'Cracked', rarity: 'inferior' };
    };

    // Live preview HTML — recomputes when refine/prep selections change.
    const computePreview = (refineId, prepId) => {
      // Refine impact: avg refine gain added to material progress.
      let effectiveMatProgress = materialItem ? (materialItem.system.progress ?? 0) : 0;
      let refineGainPreview = 0;
      if (refineId && materialItem) {
        const refineSkill = actor.items.get(refineId);
        if (refineSkill) {
          const avgRefineSkill = avgSkillRollFor(refineSkill);
          const avgRefineGain = Math.round(avgRefineSkill * 0.5);  // avg d100Pct = 0.5
          refineGainPreview = Math.min(avgRefineGain, refineHeadroom);
          effectiveMatProgress += refineGainPreview;
        }
      }
      const matCtrb = Math.round(effectiveMatProgress * 0.5);

      // Prep impact: avg prep bonus = skill / 10.
      let prepBonusPreview = 0;
      if (prepId) {
        const prepSkill = actor.items.get(prepId);
        if (prepSkill) {
          const avgPrepSkill = avgSkillRollFor(prepSkill);
          prepBonusPreview = Math.round(avgPrepSkill / 10);
        }
      }

      const total = matCtrb + avgCrafterCtrb + progressBonus + prepBonusPreview;

      // Min/max range: d100 spans 1-100 (modulated by floor + ceiling).
      const minD100 = Math.min(1 + rarityRange.floor + rarityFloorBonus + d100Bonus, rarityRange.ceiling);
      const maxD100 = Math.min(100 + rarityRange.floor + rarityFloorBonus + d100Bonus, rarityRange.ceiling);
      const skillEffective = avgSkillRoll + skillModBonus;
      const minCrafterCtrb = Math.round(Math.round(skillEffective * minD100 / 100) * 0.5);
      const maxCrafterCtrb = Math.round(Math.round(skillEffective * maxD100 / 100) * 0.5);
      const minTotal = matCtrb + minCrafterCtrb + progressBonus + prepBonusPreview;
      const maxTotal = matCtrb + maxCrafterCtrb + progressBonus + prepBonusPreview;

      // Cap (theoretical max): perfect d100 outcome. For iterative, use the existing item's stored cap.
      const cap = reworkTarget
        ? (reworkTarget.system.maxProgress ?? 0)
        : Math.round(effectiveMatProgress * 0.5) + Math.round((avgSkillRoll + skillModBonus) * 1.0 * 0.5) + progressBonus + prepBonusPreview;

      const qExpected = qualityForProgress(total);
      const qCap = qualityForProgress(cap);
      const qLine = qExpected.key === qCap.key
        ? `<strong>Expected quality:</strong> ${qExpected.label}`
        : `<strong>Expected quality:</strong> ${qExpected.label} <span style="opacity:0.7;">(up to ${qCap.label} on a perfect roll)</span>`;

      return `
        <p style="margin:2px 0;"><strong>Active Profession Augments:</strong> ${augSummary}</p>
        <p style="margin:2px 0;"><strong>Expected outcome (averages):</strong></p>
        <ul style="margin:2px 0;padding-left:20px;">
          <li>Material contribution: ${matCtrb}${refineGainPreview ? ` <span style="opacity:0.7;">(after refine +${refineGainPreview})</span>` : ''}</li>
          <li>Crafter contribution: ${avgCrafterCtrb} <span style="opacity:0.7;">(skill ${avgSkillRoll + skillModBonus} × d100 ${avgD100.toFixed(0)}%)</span></li>
          ${progressBonus ? `<li>Augment progress: +${progressBonus}</li>` : ''}
          ${prepBonusPreview ? `<li>Preparation bonus: +${prepBonusPreview}</li>` : ''}
        </ul>
        <p style="margin:4px 0 0 0;"><strong>~${total} progress</strong> on average <span style="opacity:0.7;">(range ${minTotal}–${maxTotal}, cap ${cap})</span>.</p>
        <p style="margin:2px 0;">${qLine}</p>
      `;
    };

    // Build static parts.
    const headerLine = reworkTarget
      ? `<h3 style="margin:4px 0;">Reworking: ${reworkTarget.name}</h3>`
      : `<h3 style="margin:4px 0;">Crafting: ${typeKey ? (typeKey.charAt(0).toUpperCase() + typeKey.slice(1)) : 'Item'}</h3>`;

    const matInfoLine = materialItem
      ? `<p style="margin:2px 0;"><strong>Material:</strong> ${materialItem.name} (${matRarity}, progress ${materialItem.system.progress ?? 0})</p>`
      : `<p style="margin:2px 0;"><em>Iterative rework — no material consumed.</em></p>`;

    const refineRow = showRefine
      ? `<div class="form-group">
           <label>Refine</label>
           <select name="refineSkill" class="craft-setup-refine">
             <option value="">Skip</option>
             ${refineSkills.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
           </select>
           <span class="hint">Refines material first (up to +${refineHeadroom} headroom).</span>
         </div>`
      : '';

    const prepRow = showPrep
      ? `<div class="form-group">
           <label>Preparation</label>
           <select name="prepSkill" class="craft-setup-prep">
             <option value="">Skip</option>
             ${prepSkills.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
           </select>
           <span class="hint">Adds prep bonus (skill ÷ 10) to craft.</span>
         </div>`
      : '';

    const initialPreview = computePreview('', '');
    const previewBlock = `<div class="craft-setup-preview" style="background:rgba(0,0,0,0.08);padding:6px;border-radius:3px;margin-top:6px;font-size:11px;">${initialPreview}</div>`;

    const content = `<form>${headerLine}${matInfoLine}${refineRow}${prepRow}${previewBlock}</form>`;

    return await foundry.applications.api.DialogV2.wait({
      window: { title: `${item.name} — Craft Setup` },
      content,
      // Wire up live-update listeners after the dialog renders.
      render: (event, dialog) => {
        const root = dialog?.element ?? dialog;
        if (!root) return;
        const form    = root.querySelector('form');
        const preview = form?.querySelector('.craft-setup-preview');
        const refSel  = form?.querySelector('.craft-setup-refine');
        const prepSel = form?.querySelector('.craft-setup-prep');
        if (!preview) return;
        const recompute = () => {
          const rid = refSel?.value ?? '';
          const pid = prepSel?.value ?? '';
          preview.innerHTML = computePreview(rid, pid);
        };
        refSel?.addEventListener('change', recompute);
        prepSel?.addEventListener('change', recompute);
      },
      buttons: [
        {
          action: 'craft', label: 'Craft', icon: 'fas fa-hammer', default: true,
          callback: (event, button, dialog) => {
            const form = dialog?.element?.querySelector('form')
              ?? button.form
              ?? button.closest('.application')?.querySelector('form');
            if (!form) return null;
            return {
              refineId: form.querySelector('[name="refineSkill"]')?.value ?? '',
              prepId:   form.querySelector('[name="prepSkill"]')?.value ?? '',
            };
          },
        },
        { action: 'cancel', label: 'Cancel' },
      ],
      close: () => 'cancel',
    });
  }

  async _promptBarrierManaCost(maxMana) {
    const multiplier = this.system.tagConfig?.barrierMultiplier ?? 1;
    return new Promise(resolve => {
      let resolved = false;
      new foundry.applications.api.DialogV2({
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
              resolved = true;
              const val = parseInt(button.form.elements.manaCost?.value, 10);
              resolve(Math.min(Math.max(1, val || 0), maxMana));
            },
          },
          {
            action: 'cancel',
            label: 'Cancel',
            callback: () => { resolved = true; resolve(null); },
          },
        ],
        close: () => { if (!resolved) resolve(null); },
      }).render(true);
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
    if (this.system.requiredEquipment) {
      const direct = this.actor.items.get(this.system.requiredEquipment);
      if (direct) return direct;
    }
    let best = null;
    let bestWeight = 0;
    for (const i of this.actor.items) {
      if (i.type !== 'item') continue;
      const s = i.system;
      if (s?.slot !== 'weaponry') continue;
      if (s?.equipped !== true) continue;
      if ((s?.tags ?? []).includes('shield')) continue;
      const w = AspectsofPowerItem.resolveWeaponWeight(i);
      if (w <= 0) continue;
      if (w > bestWeight) { best = i; bestWeight = w; }
    }
    return best;
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
    for (const tag of item.system?.tags ?? []) {
      if (table[tag] != null) return table[tag];
    }
    return item.system?.weight ?? 0;
  }

  /**
   * Resolve a skill's effective multiplier and cost mod from its rarity
   * tag + alteration list. Per design-skill-rarity-system.md:
   *   effective_mult = max(0, rarityMult + Σ alteration.dmgMod)
   *   cost_mult      = 1 + Σ alteration.costMod
   * Cost-mult is returned for callers to apply to base resource costs;
   * this method does NOT touch the resource pool itself.
   *
   * @returns {{rarityMult:number, effectiveMult:number, costMultiplier:number}}
   */
  _resolveRarityMods() {
    const sc = CONFIG.ASPECTSOFPOWER;
    const rarity     = this.system.rarity || 'common';
    const rarityMult = sc.skillRarities?.[rarity]?.mult ?? 0.6;
    const alterations = this.system.alterations || [];
    let dmgMod = 0;
    let costMod = 0;
    for (const alt of alterations) {
      const tag = sc.alterationTags?.[alt.id];
      if (!tag) continue;
      dmgMod += tag.dmgMod ?? 0;
      costMod += tag.costMod ?? 0;
    }
    return {
      rarityMult,
      effectiveMult:  Math.max(0, rarityMult + dmgMod),
      costMultiplier: 1 + costMod,
    };
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
   * @returns {Promise<number|null>}   Selected invest amount, or null on cancel.
   */
  async _promptResourceInvest({ baseCost, safeInvest, maxPool, potency, multiplier, resourceLabel, potencyLabel, label, channelStat = null, channelFactor = null, hardCap = false }) {
    const safeCeiling = baseCost + safeInvest;
    const startInvest = baseCost;
    // Damage curve: potency × multiplier × (invested/base)^0.2 — very flat,
    // invest is a small lever. Self-damage: linear in excess/safeInvest.
    const computeDmg = (v) => Math.round(potency * multiplier * Math.pow(Math.max(v, 1) / Math.max(baseCost, 1), 0.2));
    const computeSelfDmg = (v) => {
      const excess = Math.max(0, v - safeCeiling);
      if (excess <= 0 || safeInvest <= 0) return 0;
      return Math.round(potency * (excess / safeInvest));
    };
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
          <div>Pool: <strong>${maxPool}</strong></div>
          <div>${potencyLabel} × Mult: <strong>${potency} × ${multiplier}</strong></div>
        </div>
        <div class="form-group">
          <label>Invest: <span class="invest-display">${startInvest}</span> ${resourceLabel}</label>
          <input type="range" name="invest" min="${baseCost}" max="${maxPool}" value="${startInvest}" step="1" style="width:100%;" />
        </div>
        <div class="invest-readouts" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">
          <div>Predicted damage: <strong class="dmg-display">${computeDmg(startInvest)}</strong></div>
          <div>Pool after: <strong class="remaining-display">${maxPool - startInvest}</strong></div>
          ${channelRow}
          ${selfDmgRow}
        </div>
        <p class="hint" style="font-size:11px;margin-top:8px;">Damage = ${potencyLabel} × multiplier × (invested/base)^0.2.${computeChannelTime ? ' Channel time scales with invest / Wis.' : ''}${hardCap ? '' : ` Excess past safe ceiling deals ${potencyLabel} × (excess/safe) self-damage.`}</p>
      </div>`;

    let resolveFn;
    const promise = new Promise(res => { resolveFn = res; });
    let resolved = false;
    const safeResolve = (v) => { if (!resolved) { resolved = true; resolveFn(v); } };

    const dlg = new foundry.applications.api.DialogV2({
      window: { title: `${label} — ${resourceLabel.charAt(0).toUpperCase() + resourceLabel.slice(1)} Investment` },
      content,
      buttons: [
        {
          action: 'confirm',
          label: 'Use',
          default: true,
          callback: (event, button) => {
            const val = parseInt(button.form.elements.invest?.value, 10);
            safeResolve(Math.min(Math.max(baseCost, val || baseCost), maxPool));
          },
        },
        { action: 'cancel', label: 'Cancel', callback: () => safeResolve(null) },
      ],
      close: () => safeResolve(null),
    });
    await dlg.render(true);

    // Wire live updates after the dialog mounts.
    const root = dlg.element;
    const slider = root.querySelector('input[name="invest"]');
    const investDisplay = root.querySelector('.invest-display');
    const dmgDisplay = root.querySelector('.dmg-display');
    const selfDmgDisplay = root.querySelector('.self-dmg-display');
    const selfDmgRowEl = root.querySelector('.self-dmg-row');
    const remainingDisplay = root.querySelector('.remaining-display');
    const channelDisplay = root.querySelector('.channel-display');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        const dmg = computeDmg(v);
        investDisplay.textContent = v;
        dmgDisplay.textContent = dmg;
        remainingDisplay.textContent = maxPool - v;
        if (channelDisplay && computeChannelTime) channelDisplay.textContent = computeChannelTime(v);
        if (selfDmgDisplay && selfDmgRowEl) {
          const selfDmg = computeSelfDmg(v);
          selfDmgDisplay.textContent = selfDmg;
          selfDmgRowEl.style.color = selfDmg > 0 ? '#c33' : '';
          selfDmgRowEl.style.fontWeight = selfDmg > 0 ? 'bold' : '';
        }
      });
    }

    return promise;
  }

  _buildRollFormulas(rollData) {
    const A   = this.actor.system.abilities;
    // Pure (default): use primary ability mod at full weight.
    // Hybrid: blend primary + secondary at configured weights (e.g., 0.7 + 0.3).
    const primaryMod = A[rollData.roll.abilities]?.mod ?? 0;
    let ab = primaryMod;
    if (rollData.roll.statType === 'hybrid') {
      const secondaryMod = A[rollData.roll.secondaryAbility]?.mod ?? 0;
      const pw = rollData.roll.primaryWeight ?? 1.0;
      const sw = rollData.roll.secondaryWeight ?? 0;
      ab = Math.round(primaryMod * pw + secondaryMod * sw);
    }
    const db  = rollData.roll.diceBonus;
    const dic = rollData.roll.dice || '0';
    const typ = rollData.roll.type;

    rollData.roll.abilitymod    = ab;
    rollData.roll.resourcevalue = this.actor.system[rollData.roll.resource]?.value ?? 0;

    let hitFormula, dmgFormula;

    if (typ === 'dex_weapon') {
      const m = `${A.dexterity.mod}*(9/10)+${A.strength.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${A.strength.mod}*(9/10)+${A.dexterity.mod}*(3/10)))+${A.strength.mod}+${A.dexterity.mod}*(3/10))*${db})`;

    } else if (typ === 'str_weapon') {
      const m = `${A.strength.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `((${dic}/50*(${A.strength.mod})+${A.strength.mod}+${A.strength.mod}*(3/10))*${db})`;

    } else if (typ === 'phys_ranged') {
      const m = `${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10)))+${A.perception.mod}*(9/10)+${A.dexterity.mod}*(3/10))*${db})`;

    } else if (typ === 'magic_projectile') {
      const m = `${A.intelligence.mod}*(9/10)+${A.perception.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;

    } else if (typ === 'magic_melee') {
      const m = `${A.intelligence.mod}*(9/10)+${A.strength.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${m}))+(${m}))*${db})`;

    } else if (typ === 'magic') {
      const m = `${A.intelligence.mod}`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;

    } else if (typ === 'wisdom_dexterity') {
      const m = `${A.wisdom.mod}*(9/10)+${A.dexterity.mod}*(3/10)`;
      hitFormula = `((((d20/100)*(${m}))+(${m})))`;
      dmgFormula = `(((${dic}/50*(${m}))+(${m}))*${db})`;

    } else {
      // Generic fallback: no separate to-hit roll, just the damage formula.
      hitFormula = null;
      dmgFormula = `(((${dic}/100*${ab})+${ab})*${db})`;
    }

    return { hitFormula, dmgFormula };
  }

  /* ------------------------------------------------------------------ */
  /*  Tag handlers                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Attack tag: resolve hit vs target defense pool, calculate mitigated damage,
   * and post a GM-whispered combat result with an Apply Damage button.
   *
   * Defense pool flow:
   *   pool >= toHit  → full dodge, pool -= toHit
   *   0 < pool < toHit → partial, damage *= (1 - pool/toHit), pool = 0
   *   pool == 0       → full hit
   */
  async _handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken  = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor  = targetToken?.actor ?? null;
    if (!targetActor) return;

    const targetDefKey = rollData.roll.targetDefense;
    const hitTotal     = hitRoll ? Math.round(hitRoll.total) : 0;
    const isPhysical   = rollData.roll.damageType === 'physical';
    const mitigation   = isPhysical
      ? (targetActor.system.defense.armor?.value ?? 0)
      : (targetActor.system.defense.veil?.value  ?? 0);
    const attackerToken      = this.actor.getActiveTokens()[0] ?? null;
    const baseDR             = targetActor.system.defense?.dr?.value ?? 0;
    const affinityDR         = this._getAffinityDRReduction(targetActor, attackerToken, targetToken);
    const effectiveToughness = Math.max(0, baseDR - affinityDR);
    const mitigLabel         = isPhysical ? 'Armor' : 'Veil';

    // ── Defense pool + reaction resolution ─────────────────────────────
    let isHit = true;
    let damageMultiplier = 1;
    let defenseLine = '';
    let reactionLine = '';

    if (hitRoll && targetDefKey) {
      const pool    = targetActor.system.defense[targetDefKey]?.pool ?? 0;
      const poolMax = targetActor.system.defense[targetDefKey]?.poolMax ?? 0;
      const defLabel = targetDefKey.charAt(0).toUpperCase() + targetDefKey.slice(1);

      // Shrapnel: inflates the effective hit cost to deplete defense pool faster.
      const skillTags = item.system?.tags ?? [];
      const shrapnelMult = skillTags.includes('shrapnel')
        ? (item.system?.tagConfig?.shrapnelMultiplier ?? 1.5)
        : 1;
      const effectiveHit = Math.round(hitTotal * shrapnelMult);

      // Prompt the defender (shows defense pool and/or available reactions).
      const defenseResult = await this._promptDefensePool(
        targetActor, targetDefKey, hitTotal, item.name
      );

      // Handle defense pool usage.
      if (defenseResult.defend && pool > 0) {
        if (pool >= effectiveHit) {
          isHit = false;
          const newPool = pool - effectiveHit;
          await this._gmAction({
            type: 'gmUpdateDefensePool',
            targetActorUuid: targetActor.uuid,
            defKey: targetDefKey,
            newPool,
          });
          defenseLine = `<p>${defLabel} defense: full dodge (pool ${pool} → ${newPool} / ${poolMax})</p>`;
        } else {
          damageMultiplier = 1 - (pool / effectiveHit);
          await this._gmAction({
            type: 'gmUpdateDefensePool',
            targetActorUuid: targetActor.uuid,
            defKey: targetDefKey,
            newPool: 0,
          });
          defenseLine = `<p>${defLabel} defense: partial (${Math.round((1 - damageMultiplier) * 100)}% reduced, pool ${pool} → 0 / ${poolMax})</p>`;
        }
      } else if (pool > 0) {
        defenseLine = `<p>${defLabel} defense: declined (pool ${pool} / ${poolMax})</p>`;
      } else {
        defenseLine = `<p>${defLabel} defense: no pool remaining (0 / ${poolMax})</p>`;
      }

      // Post public defense message so players see what happened.
      if (defenseResult.defend && pool > 0) {
        const pct = pool >= effectiveHit ? 100 : Math.round((pool / effectiveHit) * 100);
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: targetActor }),
          content: pool >= effectiveHit
            ? `<p><strong>${targetActor.name}</strong> fully dodges the attack!</p>`
            : `<p><strong>${targetActor.name}</strong> partially blocks the attack (${pct}% reduced).</p>`,
        });
      }

      // Handle reaction skill usage.
      if (defenseResult.reactionSkillId) {
        const reactionSkill = targetActor.items.get(defenseResult.reactionSkillId);
        if (reactionSkill) {
          const rType = reactionSkill.system.reactionType ?? 'dodge';

          // Consume a reaction via GM action.
          await this._gmAction({
            type: 'gmConsumeReaction',
            targetActorUuid: targetActor.uuid,
          });

          const reactionSpeaker = ChatMessage.getSpeaker({ actor: targetActor });

          if (rType === 'dodge') {
            isHit = false;
            reactionLine = `<p><em>${targetActor.name} dodges with <strong>${reactionSkill.name}</strong>!</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> deftly dodges the attack with <strong>${reactionSkill.name}</strong>!</p>`,
            });
          } else if (rType === 'parry') {
            const parryRoll = await reactionSkill.roll({ parryOnly: true });
            const parryTotal = parryRoll ? Math.round(parryRoll.total) : 0;
            if (parryTotal >= hitTotal) {
              isHit = false;
              reactionLine = `<p><em>${targetActor.name} parries with <strong>${reactionSkill.name}</strong>! `
                           + `(${parryTotal} vs ${hitTotal})</em></p>`;
              ChatMessage.create({ speaker: reactionSpeaker,
                content: `<p><strong>${targetActor.name}</strong> parries the blow with <strong>${reactionSkill.name}</strong>! (${parryTotal} vs ${hitTotal})</p>`,
              });
            } else {
              reactionLine = `<p><em>${targetActor.name} fails to parry with <strong>${reactionSkill.name}</strong> `
                           + `(${parryTotal} vs ${hitTotal})</em></p>`;
              ChatMessage.create({ speaker: reactionSpeaker,
                content: `<p><strong>${targetActor.name}</strong> attempts to parry with <strong>${reactionSkill.name}</strong> but fails! (${parryTotal} vs ${hitTotal})</p>`,
              });
            }
          } else if (rType === 'barrier') {
            await reactionSkill.roll();
            reactionLine = `<p><em>${targetActor.name} reacts with <strong>${reactionSkill.name}</strong> (Barrier)!</em></p>`;
            ChatMessage.create({ speaker: reactionSpeaker,
              content: `<p><strong>${targetActor.name}</strong> raises a barrier with <strong>${reactionSkill.name}</strong>!</p>`,
            });
          }
        }
      }
    }

    // Damage pipeline: raw → defense pool % → barrier (pre-armor) → armor/veil → toughness.
    const rawDmg          = Math.round(dmgRoll.total);
    const afterDefense    = isHit ? Math.max(0, Math.round(rawDmg * damageMultiplier)) : 0;

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
    const finalDamage     = isHit ? Math.max(0, preToughnessDmg - effectiveToughness) : 0;
    const displayDamage   = finalDamage;

    const resultBadge = isHit
      ? `<strong style="color:green;">HIT</strong>`
      : `<strong style="color:red;">MISS</strong>`;

    const hitLine = hitRoll && targetDefKey
      ? `<p>Attack: ${hitTotal} vs ${targetActor.name}</p>`
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
    const fmAttrs = hasForcedMovement
      ? ` data-forced-dir="${fmDir}" data-forced-dist="${fmDist}" data-attacker-token-id="${attackerToken?.id ?? ''}" data-hit-total="${hitTotal}"`
      : '';

    const gmContent = isHit
      ? `<div class="combat-result">
           <h3>${item.name} — ${resultBadge}</h3>
           ${hitLine}
           ${defenseLine}
           ${reactionLine}
           <hr>
           <p>Raw damage: ${rawDmg}</p>
           <p>${mitigLabel}: −${mitigation}</p>
           ${damageMultiplier < 1 ? `<p>Defense reduction: −${Math.round((1 - damageMultiplier) * 100)}%</p>` : ''}
           ${barrierLine}
           ${toughnessLine}
           <p><strong>Final damage: ${displayDamage}</strong></p>
           ${fmLine}
           <button class="apply-damage"
             data-actor-uuid="${targetActor.uuid}"
             data-damage="${afterDefense}"
             data-toughness="${baseDR}"
             data-affinity-dr="${affinityDR}"
             data-damage-type="${isPhysical ? 'physical' : 'magical'}"${fmAttrs}
             style="margin-top:6px;width:100%;">
             Apply to ${targetActor.name}
           </button>
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
    return { isHit, fullyBlocked, damageMultiplier };
  }

  /**
   * Prompt the target's owner to choose whether to defend with their pool.
   * Player-owned targets are prompted via socket; GM-owned via direct dialog.
   */
  async _promptDefensePool(targetActor, defKey, hitTotal, attackName) {
    const pool    = targetActor.system.defense[defKey]?.pool ?? 0;
    const poolMax = targetActor.system.defense[defKey]?.poolMax ?? 0;
    const defLabel = defKey.charAt(0).toUpperCase() + defKey.slice(1);

    // Gather reaction skills — always show them if the actor has any,
    // even if reactions are consumed (player sees them greyed context).
    const reactions = targetActor.system.reactions ?? { value: 0, max: 1 };
    const reactionSkills = targetActor.items.filter(i => i.type === 'skill' && i.system.skillType === 'Reaction');
    const reactionList = reactionSkills.map(s => ({
      id: s.id, name: s.name, img: s.img,
      reactionType: s.system.reactionType ?? 'dodge',
      available: reactions.value > 0,
    }));

    // If pool is empty and no reaction skills exist at all, skip prompt.
    if (pool <= 0 && reactionList.length === 0) return { defend: false, reactionSkillId: null };

    const fullDodge = pool > 0 && pool >= hitTotal;
    let defenseText = '';
    if (pool > 0) {
      const outcomeText = fullDodge
        ? `<strong>Full dodge.</strong> Pool: ${pool} → ${pool - hitTotal}`
        : `<strong>Partial defense (${Math.round((pool / hitTotal) * 100)}% reduction).</strong> Pool: ${pool} → 0`;
      defenseText = `<p>${defLabel} defense pool: ${pool} / ${poolMax}</p><p>If you defend: ${outcomeText}</p>`;
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
          hasPool: pool > 0,
          reactionSkills: reactionList,
        });
      });
    } else if (game.user.isGM) {
      // GM-owned target and we ARE the GM — show dialog locally.
      result = await this._showDefenseDialog(targetActor.name, promptContent, pool > 0, reactionList);
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
            hasPool: pool > 0,
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
  async _showDefenseDialog(targetName, promptContent, hasPool, reactionSkills) {
    const buttons = [];
    if (hasPool) {
      buttons.push({ action: 'defend', label: 'Defend', icon: 'fas fa-shield-alt', default: true });
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
  _getAffinityDRReduction(targetActor, attackerToken = null, targetToken = null) {
    // Merge skill affinities with actor's innate affinities from tags.
    const skillAffinities = [...(this.system.affinities ?? [])];
    if (this.actor?.system?.collectedTags) {
      for (const [tagId, data] of this.actor.system.collectedTags) {
        if (data.category === 'affinity') {
          const affinityName = tagId.replace('-affinity', '');
          if (!skillAffinities.includes(affinityName)) skillAffinities.push(affinityName);
        }
      }
    }
    const skillMagicType  = this.system.magicType ?? '';
    if (!skillAffinities.length && !skillMagicType) return 0;

    const currentPositions = (attackerToken && targetToken)
      ? getPositionalTags(attackerToken, targetToken)
      : [];

    let total = 0;
    for (const effect of targetActor.allApplicableEffects()) {
      const sys = effect.system ?? {};
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
   * Execute a GM-routed action. Called directly by the GM or via socket handler.
   * @param {object} payload
   */
  static async executeGmAction(payload) {
    const msgWhisper = payload.whisperGM ? { whisper: payload.whisperGM } : {};
    switch (payload.type) {

      case 'gmApplyRestoration': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const resource    = payload.resource ?? 'health';
        const pool        = target.system[resource];
        const resLabel    = resource.charAt(0).toUpperCase() + resource.slice(1);

        // Health restoration; overflows into overhealth only if skill opts in.
        if (resource === 'health') {
          const newHealth   = Math.min(pool.max, pool.value + payload.amount);
          const healthGain  = newHealth - pool.value;
          const excess      = payload.amount - healthGain;
          const updateData  = { 'system.health.value': newHealth };
          let ohGain = 0;

          if (excess > 0 && payload.overhealth && target.system.overhealth) {
            const oh       = target.system.overhealth;
            const ohCap    = oh.cap ?? (pool.max * 2);
            const newOh    = Math.min(ohCap, oh.value + excess);
            ohGain         = newOh - oh.value;
            updateData['system.overhealth.value'] = newOh;
          }

          await target.update(updateData);
          const ohNote = ohGain > 0 ? ` (+${ohGain} overhealth)` : '';
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> restores <strong>${healthGain}</strong> ${resLabel}${ohNote}. `
                   + `${resLabel}: ${newHealth} / ${pool.max}</p>`,
          });
        } else if (resource === 'barrier') {
          // Barrier creation via ActiveEffect.
          const barrierValue = payload.amount;
          const affinities   = payload.barrierAffinities ?? [];
          const source       = payload.barrierSource ?? '';
          const affText = affinities.length > 0 ? ` (${affinities.join(', ')})` : '';

          // Check for existing barrier effect.
          const existingEffect = target.effects.find(e =>
            !e.disabled && e.system?.effectType === 'barrier'
          );

          // Prompt the target's owner to accept. If the target is an NPC, GM decides.
          const owners = Object.entries(target.ownership ?? {})
            .filter(([uid, level]) => level >= 3 && uid !== 'default')
            .map(([uid]) => uid);
          const playerOwner = owners.find(uid => {
            const u = game.users.get(uid);
            return u?.active && !u.isGM;
          });

          // Build confirmation prompt content.
          const existingNote = existingEffect
            ? `<p class="hint">This will replace the current barrier (${existingEffect.system?.barrierData?.value ?? 0} / ${existingEffect.system?.barrierData?.max ?? 0}).</p>`
            : '';
          const promptContent = `<p>Apply a <strong>${barrierValue}</strong> HP barrier${affText} from <strong>${source}</strong>?</p>${existingNote}`;

          let accepted = false;
          if (playerOwner) {
            // Send prompt to the player via socket and wait for response.
            const requestId = foundry.utils.randomID();
            accepted = await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                cleanup();
                resolve(true); // Default accept on timeout (30s).
              }, 30000);

              const handler = (response) => {
                if (response.type !== 'barrierPromptResponse' || response.requestId !== requestId) return;
                cleanup();
                resolve(response.accepted);
              };

              const cleanup = () => {
                clearTimeout(timeout);
                game.socket.off('system.aspects-of-power', handler);
              };

              game.socket.on('system.aspects-of-power', handler);
              game.socket.emit('system.aspects-of-power', {
                type: 'barrierPrompt',
                targetUserId: playerOwner,
                targetName: target.name,
                promptContent,
                requestId,
              });
            });
          } else {
            // GM-owned target (NPC) — prompt the GM directly.
            accepted = await foundry.applications.api.DialogV2.confirm({
              window: { title: `Barrier — ${target.name}` },
              content: promptContent,
              yes: { label: 'Accept', icon: 'fas fa-shield-alt' },
              no: { label: 'Decline' },
            });
          }

          if (!accepted) {
            ChatMessage.create({
              speaker: payload.speaker, ...msgWhisper,
              content: `<p><strong>${target.name}</strong> declined the barrier.</p>`,
            });
            return;
          }

          // Deduct caster's resource cost now that barrier was accepted.
          if (payload.casterActorUuid && payload.casterCost) {
            const caster = await fromUuid(payload.casterActorUuid);
            if (caster) {
              const res = payload.casterResource ?? 'mana';
              const curVal = caster.system[res]?.value ?? 0;
              await caster.update({ [`system.${res}.value`]: Math.max(0, curVal - payload.casterCost) });
            }
          }

          // Remove existing barrier effect if present.
          if (existingEffect) {
            await existingEffect.delete();
          }

          // Create barrier ActiveEffect.
          await target.createEmbeddedDocuments('ActiveEffect', [{
            name: `Barrier: ${source}`,
            img: 'icons/magic/defensive/shield-barrier-glowing-blue.webp',
            disabled: false,
            type: 'base',
            system: {
              effectType: 'barrier',
              effectCategory: 'temporary',
              barrierData: {
                value: barrierValue,
                max: barrierValue,
                affinities,
                source,
              },
            },
          }]);

          const replaced = existingEffect ? ' (replaced existing barrier)' : '';
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> gains a <strong>${barrierValue}</strong> point barrier${affText}${replaced}.</p>`,
          });
        } else {
          const newValue    = Math.min(pool.max, pool.value + payload.amount);
          const actualGain  = newValue - pool.value;
          await target.update({ [`system.${resource}.value`]: newValue });
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> restores <strong>${actualGain}</strong> ${resLabel}. `
                   + `${resLabel}: ${newValue} / ${pool.max}</p>`,
          });
        }
        break;
      }

      case 'gmApplyBuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const combat = game.combat;
        const startRound = combat?.round ?? 0;
        const startTurn  = combat?.turn ?? 0;

        const existing = target.effects.find(
          e => e.origin === payload.originUuid && e.name === payload.effectName
        );

        if (existing && !existing.disabled) {
          if (payload.stackable) {
            // Stackable: merge new values into the existing effect's changes.
            const merged = [...(existing.changes ?? [])].map(c => ({ ...c }));
            for (const incoming of payload.changes) {
              const match = merged.find(m => m.key === incoming.key && m.type === incoming.type);
              if (match) {
                match.value = Number(match.value) + Number(incoming.value);
              } else {
                merged.push({ ...incoming });
              }
            }
            // Duration becomes the maximum of what's remaining vs. the new application.
            const existingRemaining = ((existing.duration?.startRound ?? 0) + (existing.duration?.rounds ?? 0)) - startRound;
            const newDuration = Math.max(existingRemaining, payload.duration);
            await existing.update({
              changes: merged,
              'duration.rounds': newDuration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            });
            const mergedTotal = merged.reduce((sum, c) => sum + Number(c.value), 0);
            ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
              content: `<p>Buff on <strong>${target.name}</strong> stacked (total +${mergedTotal}) for ${newDuration} rounds.</p>`,
            });
          } else {
            // Non-stackable: keep higher total.
            const newTotal = payload.changes.reduce((sum, c) => sum + Number(c.value), 0);
            const currentTotal = (existing.changes ?? []).reduce((sum, c) => sum + Number(c.value), 0);
            if (newTotal > currentTotal) {
              await existing.update({
                changes: payload.changes,
                'duration.rounds': payload.duration,
                'duration.startRound': startRound,
                'duration.startTurn': startTurn,
              });
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p>Buff on <strong>${target.name}</strong> upgraded (total +${newTotal}, was +${currentTotal}).</p>`,
              });
            } else {
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p>Existing buff on <strong>${target.name}</strong> is stronger (+${currentTotal}). No change.</p>`,
              });
            }
          }
        } else {
          // No existing active effect (or disabled) — create new.
          if (existing?.disabled) {
            await existing.update({
              disabled: false,
              changes: payload.changes,
              'duration.rounds': payload.duration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            });
          } else {
            await target.createEmbeddedDocuments('ActiveEffect', [{
              name:   payload.effectName,
              img:    payload.img,
              origin: payload.originUuid,
              duration: { rounds: payload.duration, startRound, startTurn },
              disabled: false,
              changes: payload.changes,
            }]);
          }
          const summary = payload.changes.map(c => {
            const attr = c.key.replace('system.', '').replace('.value', '');
            return `${attr} +${c.value}`;
          }).join(', ');
          ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> buffed: ${summary} for ${payload.duration} rounds.</p>`,
          });
        }
        break;
      }

      case 'gmApplyRepair': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const materials = payload.materials ?? [];
        const restored = await EquipmentSystem.repairAllEquipped(target, payload.amount, materials);
        const matLabel = materials.length > 0
          ? materials.map(m => game.i18n.localize(CONFIG.ASPECTSOFPOWER.materialTypes[m] ?? m)).join(', ')
          : 'all';
        ChatMessage.create({
          speaker: payload.speaker, ...msgWhisper,
          content: `<p><strong>${payload.skillName}</strong> repairs <strong>${target.name}</strong>'s ${matLabel} equipment `
                 + `(+${restored} durability distributed across matching gear).</p>`,
        });
        break;
      }

      case 'gmApplyDebuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;

        // ── Immunity check ──
        const debuffTypeCheck = payload.effectData?.system?.debuffType ?? 'none';
        const isImmune = target.isImmuneTo?.(debuffTypeCheck) || target.system?.collectedTags?.has?.(`${debuffTypeCheck}-immune`);
        if (isImmune) {
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> is immune to <strong>${game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffTypeCheck] ?? debuffTypeCheck)}</strong>!</p>`,
          });
          break;
        }

        // ── Resistance check — reduce duration ──
        if (payload.effectData && payload.duration) {
          const resistance = target.getResistance?.(debuffTypeCheck) ?? 0;
          if (resistance > 0 && payload.effectData.system?.debuffDamage) {
            // Flat reduction to debuff strength (break threshold).
            payload.effectData.system.debuffDamage = Math.max(0, payload.effectData.system.debuffDamage - resistance);
            if (payload.effectData.system.debuffDamage <= 0) {
              ChatMessage.create({
                speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> resists <strong>${game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffTypeCheck] ?? debuffTypeCheck)}</strong> entirely! (resistance: ${resistance})</p>`,
              });
              break;
            }
          }
        }

        const combat = game.combat;
        const startRound = combat?.round ?? 0;
        const startTurn  = combat?.turn ?? 0;

        // Stackable debuffs: merge into existing effect with same origin + name.
        if (payload.effectData) {
          const existing = payload.stackable
            ? target.effects.find(e => e.origin === payload.originUuid && e.name === payload.effectName && !e.disabled)
            : null;

          if (existing) {
            // Merge stat changes: add incoming values to matching keys.
            const merged = [...(existing.changes ?? [])].map(c => ({ ...c }));
            for (const incoming of (payload.effectData.changes ?? [])) {
              const match = merged.find(m => m.key === incoming.key && m.type === incoming.type);
              if (match) {
                match.value = Number(match.value) + Number(incoming.value);
              } else {
                merged.push({ ...incoming });
              }
            }

            // Duration becomes the maximum of what's remaining vs. the new application.
            const existingRemaining = ((existing.duration?.startRound ?? 0) + (existing.duration?.rounds ?? 0)) - startRound;
            const newDuration = Math.max(existingRemaining, payload.duration);

            // Merge DoT flags: add incoming damage to existing.
            const updateData = {
              changes: merged,
              'duration.rounds': newDuration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            };
            // Stack debuffDamage (break threshold) and DoT via system fields.
            const existingSys = existing.system ?? {};
            const incomingSys = payload.effectData.system ?? {};
            const existingDebuffDmg = existingSys.debuffDamage ?? 0;
            const incomingDebuffDmg = incomingSys.debuffDamage ?? 0;
            const newDebuffDamage = existingDebuffDmg + incomingDebuffDmg;

            const systemUpdate = { debuffDamage: newDebuffDamage, breakProgress: 0 };

            if (incomingSys.dot) {
              const existingDot = existingSys.dotDamage ?? 0;
              const incomingDot = incomingSys.dotDamage ?? 0;
              systemUpdate.dot = true;
              systemUpdate.dotDamage = existingDot + incomingDot;
              systemUpdate.dotDamageType = incomingSys.dotDamageType;
              systemUpdate.applierActorUuid = incomingSys.applierActorUuid;
              updateData.description = `Deals <strong>${systemUpdate.dotDamage}</strong> ${systemUpdate.dotDamageType} damage per round (bypasses armor &amp; veil; reduced by Toughness).`;
            }

            updateData.system = systemUpdate;

            await existing.update(updateData);
            const mergedTotal = merged.reduce((sum, c) => sum + Math.abs(Number(c.value)), 0);
            const stackInfo = mergedTotal > 0 ? ` (stat total -${mergedTotal})` : ` (strength ${newDebuffDamage})`;
            ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
              content: `<p>Debuff on <strong>${target.name}</strong> stacked${stackInfo} for ${newDuration} rounds.</p>`,
            });
          } else {
            // No existing — create new effect. Use nested duration object for v14.
            if (!payload.effectData.duration) payload.effectData.duration = {};
            payload.effectData.duration.startRound = startRound;
            payload.effectData.duration.startTurn = startTurn;
            await target.createEmbeddedDocuments('ActiveEffect', [payload.effectData]);

            if (payload.statSummary) {
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> debuffed: ${payload.statSummary} for ${payload.duration} rounds.</p>`,
              });
            }

            // Blind: apply Foundry blind status to disable token vision.
            const dType = payload.effectData.system?.debuffType;
            if (dType === 'blind') {
              const tokens = target.getActiveTokens();
              for (const t of tokens) {
                if (!t.document.hasStatusEffect('blind')) {
                  await t.document.toggleActiveEffect({ id: 'blind', name: 'Blind', img: 'icons/svg/blind.svg' }, { active: true });
                }
              }
            }

            // Dismembered: force-unequip items in the disabled slot.
            const dSlot = payload.effectData.system?.dismemberedSlot;
            if (dType === 'dismembered' && dSlot) {
              const equippedInSlot = target.items.filter(
                i => i.type === 'item' && i.system.equipped && i.system.slot === dSlot
              );
              for (const equippedItem of equippedInSlot) {
                await EquipmentSystem.unequip(equippedItem);
              }
              const slotLabel = game.i18n.localize(`ASPECTSOFPOWER.Equip.Slot.${dSlot}`) || dSlot;
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> loses use of <strong>${slotLabel}</strong> slot!</p>`,
              });
            }
          }
        }

        // Immediate DoT damage (bypasses armor/veil AND barrier, but not DR).
        // Pre-existing wounds bypass barriers — routes through: Overhealth → HP.
        if (payload.dotDamage > 0) {
          const dotDR = target.system.defense?.dr?.value ?? 0;
          let remaining = Math.max(0, payload.dotDamage - dotDR);
          const updateData = {};
          const parts = [];

          // Overhealth absorbs first (DoTs bypass barrier).
          const overhealth = target.system.overhealth;
          if (remaining > 0 && overhealth.value > 0) {
            const absorbed = Math.min(overhealth.value, remaining);
            remaining -= absorbed;
            updateData['system.overhealth.value'] = overhealth.value - absorbed;
            parts.push(`Overhealth: −${absorbed}`);
          }

          // Remaining hits HP.
          const health = target.system.health;
          const newHealth = Math.max(0, health.value - remaining);
          updateData['system.health.value'] = newHealth;
          if (remaining > 0) parts.push(`Health: −${remaining}`);

          await target.update(updateData);

          const mitigated = Math.max(0, payload.dotDamage - dotDR);
          const breakdown = parts.length ? ` (${parts.join(', ')})` : '';
          ChatMessage.create({
            whisper: ChatMessage.getWhisperRecipients('GM'),
            content: `<p><strong>${target.name}</strong> takes <strong>${mitigated}</strong> `
                   + `${payload.dotDamageType} damage from ${payload.effectName} (DR: −${dotDR})${breakdown}. `
                   + `Health: ${newHealth} / ${health.max}`
                   + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
          });
        }
        break;
      }

      case 'gmApplyCleanse': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;

        // Find all magical debuffs on the target, sorted strongest (highest debuffDamage) first.
        const magicalDebuffs = target.effects
          .filter(e => {
            if (e.disabled) return false;
            const sys = e.system;
            if (!sys?.debuffType || sys.debuffType === 'none') return false;
            return sys.magicType === 'magical';
          })
          .sort((a, b) =>
            (b.system?.debuffDamage ?? 0) - (a.system?.debuffDamage ?? 0)
          );

        if (magicalDebuffs.length === 0) {
          ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
            content: `<p><em>${game.i18n.localize('ASPECTSOFPOWER.Cleanse.noDebuffs')}</em></p>`,
          });
          break;
        }

        // Distribute cleanse roll total across debuffs as breakProgress.
        let budget = payload.rollTotal;
        const results = [];
        for (const effect of magicalDebuffs) {
          if (budget <= 0) break;
          const sys = effect.system;
          const threshold = sys.debuffDamage ?? 0;
          const previousProgress = sys.breakProgress ?? 0;
          const typeName = game.i18n.localize(
            CONFIG.ASPECTSOFPOWER.debuffTypes[sys.debuffType] ?? sys.debuffType
          );

          // Add full budget to this effect's progress.
          const newProgress = previousProgress + budget;

          if (newProgress >= threshold && threshold > 0) {
            // Cleansed! Remove the effect, carry over excess.
            const excess = newProgress - threshold;
            budget = excess;
            await effect.delete();
            results.push(`<strong>${typeName}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Cleanse.cleansed')} <strong>${target.name}</strong>! [${newProgress} / ${threshold}]`);
          } else {
            // Partial progress — consume entire budget.
            await effect.update({ 'system.breakProgress': newProgress });
            budget = 0;
            results.push(`${game.i18n.localize('ASPECTSOFPOWER.Cleanse.progress')} <strong>${typeName}</strong>: [${newProgress} / ${threshold}]`);
          }
        }

        ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
          content: `<p><strong>${payload.skillName}</strong> cleanses <strong>${target.name}</strong> (roll: ${payload.rollTotal}):</p>`
                 + `<ul>${results.map(r => `<li>${r}</li>`).join('')}</ul>`,
        });
        break;
      }

      case 'gmUpdateDefensePool': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const defKey = payload.defKey;
        if (!['melee', 'ranged', 'mind', 'soul'].includes(defKey)) return;
        await target.update({ [`system.defense.${defKey}.pool`]: payload.newPool });
        break;
      }

      case 'gmConsumeReaction': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const reactions = target.system.reactions;
        if (reactions && reactions.value > 0) {
          await target.update({ 'system.reactions.value': reactions.value - 1 });
        }
        break;
      }

      case 'gmExecuteTrade': {
        const { TradingSystem } = await import('../systems/trading.mjs');
        await TradingSystem._performTransfer(payload);
        break;
      }
    }
  }

  /**
   * Restoration tag: restore health, mana, or stamina and route through GM.
   */
  async _handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    let amount     = Math.round(dmgRoll.total);
    const target   = this.system.tagConfig?.restorationTarget ?? 'selected';
    const resource = this.system.tagConfig?.restorationResource ?? 'health';

    // Barrier: value comes from variable mana cost × multiplier, not roll total.
    if (resource === 'barrier') {
      const multiplier = this.system.tagConfig?.barrierMultiplier ?? 1;
      amount = Math.round((rollData.roll.variableManaCost ?? amount) * multiplier);
    }

    let targetActor;
    if (target === 'self' && !targetTokenOverride) {
      targetActor = this.actor;
    } else {
      const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
      targetActor = targetToken?.actor ?? null;
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
    }

    await this._gmAction(actionPayload);
  }

  /**
   * Buff tag: build payload and route through GM.
   * Values are roll-based: rollTotal * entry.value (multiplier, default 1).
   */
  async _handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetTokenOverride = null) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const targetToken = targetTokenOverride ?? game.user.targets.first() ?? null;
    const targetActor = targetToken?.actor ?? null;
    if (!targetActor) {
      ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: `<p><em>No target for buff.</em></p>` });
      return;
    }

    const entries  = this.system.tagConfig?.buffEntries ?? [];
    const duration = this.system.tagConfig?.buffDuration ?? 1;
    const rollTotal = Math.round(dmgRoll.total);

    if (entries.length === 0) return;

    const changes = entries.map(e => ({
      key:   `system.${e.attribute}.value`,
      type:  'add',
      value: Math.round(rollTotal * (e.value || 1)),
    }));

    await this._gmAction({
      type: 'gmApplyBuff',
      targetActorUuid: targetActor.uuid,
      effectName: `${item.name} (Buff)`,
      originUuid: this.uuid,
      changes,
      duration,
      stackable: this.system.tagConfig?.buffStackable ?? false,
      img: item.img ?? 'icons/svg/aura.svg',
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
    const dealsDmg   = this.system.tagConfig?.debuffDealsDamage ?? false;
    const dmgType    = this.system.tagConfig?.debuffDamageType ?? 'physical';
    const debuffType = this.system.tagConfig?.debuffType ?? 'none';
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
        ? `Deals <strong>${rollTotal}</strong> ${dmgType} damage per round (bypasses armor &amp; veil; reduced by Toughness).`
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
      dismemberedSlot = await new Promise(resolve => {
        new foundry.applications.api.DialogV2({
          window: { title: 'Dismember — Choose Slot' },
          content: `<div class="form-group"><label>Slot to disable:</label><select name="slot">${slotOptions}</select></div>`,
          buttons: [{
            action: 'confirm', label: 'Confirm', default: true,
            callback: (event, button) => resolve(button.form.elements.slot?.value || null),
          }, {
            action: 'cancel', label: 'Cancel',
            callback: () => resolve(null),
          }],
          close: () => resolve(null),
        }).render({ force: true });
      });
      if (!dismemberedSlot) return; // cancelled
    }

    // Store debuff metadata in the AE TypeDataModel system fields.
    effectData.type = 'base';
    effectData.system = {
      debuffDamage: rollTotal,
      debuffType,
      casterActorUuid: this.actor.uuid,
      affinities: this.system.affinities ?? [],
      magicType: this.system.magicType ?? 'non-magical',
      directions,
      ...(dismemberedSlot ? { dismemberedSlot } : {}),
      ...(dealsDmg ? { dot: true, dotDamage: rollTotal, dotDamageType: dmgType, applierActorUuid: this.actor.uuid } : {}),
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
      effectData: (changes.length > 0 || dealsDmg || debuffType !== 'none') ? effectData : null,
      dotDamage: dealsDmg ? rollTotal : 0,
      dotDamageType: dmgType,
      duration,
      statSummary,
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
    if ((this.system.magicType ?? 'non-magical') !== 'magical') {
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

  /**
   * Refine tag: select a material from inventory and improve its progress.
   * Can be used standalone or as part of the craft pipeline.
   */
  async _handleRefineTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const actor = this.actor;
    if (!actor) return;

    // Find materials with room to grow (current progress < max potential).
    const materials = actor.items.filter(i => {
      if (i.type !== 'item' || !i.system.isMaterial) return false;
      const cur = i.system.progress ?? 0;
      const max = i.system.maxProgress ?? Math.round(cur * 1.2);
      return cur < max;
    });
    if (materials.length === 0) {
      ui.notifications.warn('No materials available for refinement (all at max potential).');
      return;
    }

    const matButtons = materials.map(m => {
      const elLabel = m.system.materialElement ? ` [${m.system.materialElement}]` : '';
      const cur = m.system.progress ?? 0;
      const max = m.system.maxProgress ?? Math.round(cur * 1.2);
      return { action: m.id, label: `${m.name}${elLabel} — ${cur}/${max}` };
    });
    matButtons.push({ action: 'cancel', label: 'Cancel' });

    const selectedMat = await foundry.applications.api.DialogV2.wait({
      window: { title: `${item.name} — Select Material to Refine` },
      content: '<p>Which material do you want to refine?</p>',
      buttons: matButtons,
      close: () => 'cancel',
    });
    if (selectedMat === 'cancel') return;

    const materialItem = actor.items.get(selectedMat);
    if (!materialItem) return;

    // Roll refine: skill × d100%, capped at remaining headroom toward maxProgress.
    const skillRoll = Math.round(dmgRoll.total);
    const d100Roll = new Roll('1d100');
    await d100Roll.evaluate();
    const d100Pct = d100Roll.total / 100;
    const rawGain = Math.round(skillRoll * d100Pct);
    const oldProgress = materialItem.system.progress ?? 0;
    const maxProgress = materialItem.system.maxProgress ?? Math.round(oldProgress * 1.2);
    const headroom = Math.max(0, maxProgress - oldProgress);
    const refineGain = Math.min(rawGain, headroom);

    const newProgress = oldProgress + refineGain;
    // Update name suffix to reflect new progress.
    const refinedName = `${materialItem.name.replace(/ - \d+$/, '')} - ${newProgress}`;
    await materialItem.update({
      name: refinedName,
      'system.progress': newProgress,
      'system.isRefined': true,
    });

    const natLine = d100Roll.total === 100
      ? '<p style="color:#ffca28;font-size:1.2em;">&#9733; Perfect Refinement! Natural 100! &#9733;</p>'
      : '';
    const capLine = rawGain > headroom
      ? `<p><em>Capped at max potential (${maxProgress}, +${headroom} available)</em></p>`
      : '';
    const maxLine = newProgress >= maxProgress
      ? '<p><em>Material is now at maximum potential.</em></p>'
      : '';

    ChatMessage.create({
      speaker,
      content: `<div class="craft-result">
        <h3>${item.name} — Refinement Result</h3>
        <hr>
        ${natLine}
        <p><strong>Material:</strong> ${materialItem.name}</p>
        <p><strong>Skill Roll:</strong> ${skillRoll} × d100 (${d100Roll.total}) = ${rawGain}</p>
        ${capLine}
        <p><strong>Progress:</strong> ${oldProgress} → <strong>${newProgress}</strong> / ${maxProgress} (+${refineGain})</p>
        ${maxLine}
      </div>`,
    });
  }

  /**
   * Gather tag: roll to create a material item in the actor's inventory.
   * Progress = skillRoll × d100%. Determines material quality.
   */
  async _handleGatherTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const actor = this.actor;
    if (!actor) return;

    const gatherConfig = item.system.tagConfig;
    const tags = item.system.tags ?? [];

    // Detect material type from tags (metal, leather, cloth, jewelry, gem, wood, bone, crystal).
    const materialTypes = Object.keys(CONFIG.ASPECTSOFPOWER.materialTypes ?? {});
    const materialType = tags.find(t => materialTypes.includes(t))
                      || gatherConfig?.gatherMaterial || '';

    // ── Step 1: Select material rarity ──
    const rarityRanges = CONFIG.ASPECTSOFPOWER.craftRarityRanges ?? {};
    const rarityButtons = Object.keys(rarityRanges).map(r => ({
      action: r,
      label: r.charAt(0).toUpperCase() + r.slice(1),
    }));
    rarityButtons.push({ action: 'cancel', label: 'Cancel' });

    const selectedRarity = await foundry.applications.api.DialogV2.wait({
      window: { title: `${item.name} — Material Rarity` },
      content: '<p>What rarity of material are you harvesting?</p>',
      buttons: rarityButtons,
      close: () => 'cancel',
    });
    if (selectedRarity === 'cancel') return;

    // ── Step 2: Select element/affinity ──
    const craftElements = CONFIG.ASPECTSOFPOWER.craftElements ?? {};
    const elementButtons = Object.entries(craftElements).map(([key, def]) => ({
      action: key,
      label: game.i18n.localize(def.label),
    }));
    elementButtons.push({ action: 'none', label: 'None' });
    elementButtons.push({ action: 'cancel', label: 'Cancel' });

    const selectedElement = await foundry.applications.api.DialogV2.wait({
      window: { title: `${item.name} — Element` },
      content: '<p>What element is this material?</p>',
      buttons: elementButtons,
      close: () => 'cancel',
    });
    if (selectedElement === 'cancel') return;
    const element = selectedElement === 'none' ? '' : selectedElement;

    // Profession augment bonuses from equipped profession gear (element-filtered).
    const gatherAugBonuses = actor.getProfessionAugmentBonuses(element);
    const gatherD100Bonus = gatherAugBonuses.d100Bonus || 0;
    const gatherSkillBonus = gatherAugBonuses.craftSkillMod || 0;
    const gatherProgressBonus = gatherAugBonuses.gatherProgress || 0;
    const gatherAugParts = [];
    if (gatherSkillBonus)    gatherAugParts.push(`Skill +${gatherSkillBonus}`);
    if (gatherD100Bonus)     gatherAugParts.push(`d100 +${gatherD100Bonus}`);
    if (gatherProgressBonus) gatherAugParts.push(`Progress +${gatherProgressBonus}`);
    const gatherAugLine = gatherAugParts.length
      ? `<p><strong>Profession Augments:</strong> ${gatherAugParts.join(', ')}</p>`
      : '';

    // Roll d100 for gathering conditions.
    const d100Roll = new Roll('1d100');
    await d100Roll.evaluate();
    // Apply the same rarity floor/ceiling clamping as crafting: floor adds
    // a flat boost, ceiling caps the result. Failure check below still
    // uses the raw roll, so a natural 1 still ruins the attempt regardless.
    const gatherRarityRange = CONFIG.ASPECTSOFPOWER.craftRarityRanges?.[selectedRarity]
                           ?? { floor: 1, ceiling: 100 };
    const effectiveD100 = Math.min(
      d100Roll.total + gatherRarityRange.floor + gatherD100Bonus,
      gatherRarityRange.ceiling,
    );
    const d100Pct = effectiveD100 / 100;

    const skillRoll = Math.round(dmgRoll.total) + gatherSkillBonus;
    const gatherProgress = Math.round(skillRoll * d100Pct) + gatherProgressBonus;

    // Failure check: d100 of 1 ruins the attempt.
    if (d100Roll.total <= 1) {
      ChatMessage.create({
        speaker,
        content: `<div class="craft-result">
          <h3>${item.name} — Gathering Failed</h3>
          <hr>
          <p><strong>Skill Roll:</strong> ${skillRoll}</p>
          <p><strong>d100:</strong> ${d100Roll.total} — <em>Critical failure! Materials ruined.</em></p>
        </div>`,
      });
      return;
    }

    // Build material name.
    const elPrefix = element
      ? `${element.charAt(0).toUpperCase() + element.slice(1)} `
      : '';
    const matLabel = materialType
      ? materialType.charAt(0).toUpperCase() + materialType.slice(1)
      : 'Material';
    const rarityLabel = selectedRarity.charAt(0).toUpperCase() + selectedRarity.slice(1);
    const itemName = `${elPrefix}${matLabel} (${rarityLabel}) - ${gatherProgress}`;

    // Tag inheritance for gathered materials: free-form (material type) + registry (affinity).
    const matFreeTags = [];
    if (materialType) matFreeTags.push(materialType);
    // Per the unified tags merge — append affinity to the same `tags` array
    // (registry awareness drives behavior; the field type is uniform).
    if (element && element !== 'neutral') matFreeTags.push(`${element}-affinity`);

    // Create the material item and open its sheet for renaming.
    // Max potential is +20% above the gathered progress — refinement can grow toward this.
    const [gatheredItem] = await actor.createEmbeddedDocuments('Item', [{
      name: itemName,
      type: 'item',
      img: item.img,
      system: {
        description: `<p>Gathered by ${actor.name} using ${item.name}.</p>`,
        quantity: 1,
        isMaterial: true,
        material: materialType,
        materialElement: element,
        rarity: selectedRarity,
        progress: gatherProgress,
        maxProgress: Math.round(gatherProgress * 1.2),
        tags: matFreeTags,
      },
    }]);

    const natLine = d100Roll.total === 100
      ? '<p style="color:#ffca28;font-size:1.2em;">&#9733; Perfect Harvest! Natural 100! &#9733;</p>'
      : '';

    ChatMessage.create({
      speaker,
      content: `<div class="craft-result">
        <h3>${item.name} — Gathering Result</h3>
        <hr>
        ${natLine}
        <p><strong>Rarity:</strong> ${rarityLabel}</p>
        <p><strong>Skill Roll:</strong> ${skillRoll}</p>
        <p><strong>d100:</strong> ${d100Roll.total} (${d100Pct.toFixed(2)})</p>
        <p><strong>Progress:</strong> ${skillRoll} × ${d100Pct.toFixed(2)} = ${gatherProgress}</p>
        ${gatherAugLine}
        <p><em>Created: ${itemName}</em></p>
      </div>`,
    });

    gatheredItem.sheet.render(true);
  }

  /**
   * Craft tag: multi-step crafting dialog.
   * Step 1: Select output slot (filtered by craft sub-type tags)
   * Step 2: Select material from inventory
   * Step 3: Offer refinement if material is unrefined
   * Step 4: Offer preparation buffs if actor has preparation skills
   * Step 5: Roll and create the item
   */
  async _handleCraftTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const actor = this.actor;
    if (!actor) return;

    const tags = item.system.tags ?? [];
    const craftConfig = item.system.tagConfig;
    const isAlchemySkill = tags.includes('alchemy');

    // Item type registry + skill's allowed types (empty = no restriction, back-compat).
    const itemTypesConfig = CONFIG.ASPECTSOFPOWER.craftItemTypes ?? {};
    const categoryDefs = CONFIG.ASPECTSOFPOWER.craftCategories ?? {};
    const allowedTypeKeys = item.system.craftAllowedTypes ?? [];
    const filteredTypes = allowedTypeKeys.length > 0
      ? Object.fromEntries(Object.entries(itemTypesConfig).filter(([k]) => allowedTypeKeys.includes(k)))
      : itemTypesConfig;

    // Back-compat material filter from craftTypes (legacy tag → material whitelist).
    const craftTypes = CONFIG.ASPECTSOFPOWER.craftTypes ?? {};
    let allowedMaterials = null;
    for (const [tk, td] of Object.entries(craftTypes)) {
      if (tags.includes(tk)) { allowedMaterials = td.materials; break; }
    }

    let outputSlot = '';
    let materialItem = null;
    let reworkTarget = null;
    let typeKey = null;          // chosen craftItemTypes key (sword/chest/ring/etc.)
    let inheritedTypeTags = [];  // static tags from craftItemTypes[typeKey]

    if (isAlchemySkill) {
      // Alchemy: skip slot/category/type — just pick a material.
      const materials = actor.items.filter(i => i.type === 'item' && i.system.isMaterial);
      if (materials.length === 0) {
        ui.notifications.warn('No materials in inventory.');
        return;
      }
      const matButtons = materials.map(m => {
        const elLabel = m.system.materialElement ? ` [${m.system.materialElement}]` : '';
        return { action: m.id, label: `${m.name}${elLabel}` };
      });
      matButtons.push({ action: 'cancel', label: 'Cancel' });
      const matChoice = await foundry.applications.api.DialogV2.wait({
        window: { title: `${item.name} — Select Material` },
        content: '<p>Pick a material for the brew:</p>',
        buttons: matButtons,
        close: () => 'cancel',
      });
      if (matChoice === 'cancel') return;
      materialItem = actor.items.get(matChoice);
      if (!materialItem) return;
    } else {
      // ── Step 1: Mode (New / Iterative) ──
      const modeChoice = await foundry.applications.api.DialogV2.wait({
        window: { title: `${item.name} — Craft Mode` },
        content: '<p>Starting a new item or iterating on an existing one?</p>',
        buttons: [
          { action: 'new',  label: 'New Item',         icon: 'fas fa-plus', default: true },
          { action: 'iter', label: 'Iterative Craft',  icon: 'fas fa-redo' },
          { action: 'cancel', label: 'Cancel' },
        ],
        close: () => 'cancel',
      });
      if (modeChoice === 'cancel') return;

      if (modeChoice === 'iter') {
        // ── Iterative: pick rework target, no material ──
        const existing = actor.items.filter(i =>
          i.type === 'item' && !i.system.isMaterial && (i.system.maxProgress ?? 0) > 0
        );
        if (existing.length === 0) {
          ui.notifications.warn('No existing crafted items to rework.');
          return;
        }
        const reworkButtons = existing.map(e => {
          const cnt = e.system.reworkCount ?? 0;
          const cur = e.system.progress ?? 0;
          const max = e.system.maxProgress ?? 0;
          const atMax = max > 0 && cur >= max;
          return {
            action: e.id,
            label: `${e.name} (×${cnt + 1}, ${cur}/${max})${atMax ? ' — AT MAX' : ''}`,
          };
        });
        reworkButtons.push({ action: 'cancel', label: 'Cancel' });
        const reworkChoice = await foundry.applications.api.DialogV2.wait({
          window: { title: 'Choose Item to Rework' },
          content: '<p>Pick an existing item to improve. (No material consumed.)</p>',
          buttons: reworkButtons,
          close: () => 'cancel',
        });
        if (reworkChoice === 'cancel') return;
        reworkTarget = actor.items.get(reworkChoice);
        if (!reworkTarget) return;
        outputSlot = reworkTarget.system.slot;
        // No material for iterative — materialItem stays null.
      } else {
        // ── New: Step 2 (Category) → Step 3 (Type) → Step 4 (Material) ──
        const availableCategories = new Set(Object.values(filteredTypes).map(t => t.category));
        if (availableCategories.size === 0) {
          ui.notifications.warn('This skill cannot craft any items (no allowed types configured).');
          return;
        }
        const catButtons = [...availableCategories].map(c => ({
          action: c,
          label: categoryDefs[c]?.label ?? (c.charAt(0).toUpperCase() + c.slice(1)),
        }));
        catButtons.push({ action: 'cancel', label: 'Cancel' });
        const catChoice = await foundry.applications.api.DialogV2.wait({
          window: { title: `${item.name} — Category` },
          content: '<p>What category are you crafting?</p>',
          buttons: catButtons,
          close: () => 'cancel',
        });
        if (catChoice === 'cancel') return;

        const typesInCategory = Object.entries(filteredTypes).filter(([k, t]) => t.category === catChoice);
        const typeButtons = typesInCategory.map(([k]) => ({
          action: k,
          label: k.charAt(0).toUpperCase() + k.slice(1),
        }));
        typeButtons.push({ action: 'cancel', label: 'Cancel' });
        const typeChoice = await foundry.applications.api.DialogV2.wait({
          window: { title: `${item.name} — Type` },
          content: `<p>Which ${catChoice} type?</p>`,
          buttons: typeButtons,
          close: () => 'cancel',
        });
        if (typeChoice === 'cancel') return;
        typeKey = typeChoice;
        const typeDef = filteredTypes[typeKey];
        outputSlot = typeDef.slot;
        inheritedTypeTags = typeDef.tags ?? [];

        // Material picker.
        const materials = actor.items.filter(i => {
          if (i.type !== 'item' || !i.system.isMaterial) return false;
          if (allowedMaterials && i.system.material && !allowedMaterials.includes(i.system.material)) return false;
          return true;
        });
        if (materials.length === 0) {
          ui.notifications.warn('No suitable crafting materials in inventory.');
          return;
        }
        const matButtons = materials.map(m => {
          const elLabel = m.system.materialElement ? ` [${m.system.materialElement}]` : '';
          return { action: m.id, label: `${m.name}${elLabel}` };
        });
        matButtons.push({ action: 'cancel', label: 'Cancel' });
        const matChoice = await foundry.applications.api.DialogV2.wait({
          window: { title: `${item.name} — Select Material` },
          content: `<p>Choose a material for your ${typeKey}:</p>`,
          buttons: matButtons,
          close: () => 'cancel',
        });
        if (matChoice === 'cancel') return;
        materialItem = actor.items.get(matChoice);
        if (!materialItem) return;

      }
    }

    // ── Combined Setup dialog: refine + prep selection + preview ──
    // Replaces the old separate refine/prep offer dialogs.
    const combinedSetup = await this._showCraftSetupDialog({
      item, actor, materialItem, reworkTarget, typeKey,
    });
    if (combinedSetup === 'cancel' || combinedSetup === null || combinedSetup === undefined) return;
    const refineId = combinedSetup?.refineId ?? '';
    const prepId   = combinedSetup?.prepId ?? '';

    // Accumulated pre-craft chat lines — injected into the final craft message.
    let refineLine = '';
    let prepLine   = '';

    // ── Execute refine (if selected, only on new path with material) ──
    if (refineId && materialItem) {
      const refineSkill = actor.items.get(refineId);
      if (refineSkill) {
        const refineRollData = refineSkill.getRollData();
        const { dmgFormula: refDmgF } = refineSkill._buildRollFormulas(refineRollData);
        const refRoll = new Roll(refDmgF, refineRollData);
        await refRoll.evaluate();
        const refineD100 = new Roll('1d100');
        await refineD100.evaluate();
        const cur = materialItem.system.progress ?? 0;
        const max = materialItem.system.maxProgress ?? Math.round(cur * 1.2);
        const headroom = Math.max(0, max - cur);
        const rawGain = Math.round(Math.round(refRoll.total) * (refineD100.total / 100));
        const refineGain = Math.min(rawGain, headroom);
        const newProgress = cur + refineGain;
        const refinedName = `${materialItem.name.replace(/ - \d+$/, '')} - ${newProgress}`;
        await materialItem.update({
          name: refinedName,
          'system.progress': newProgress,
          'system.isRefined': true,
        });
        materialItem = actor.items.get(materialItem.id);
        refineLine = `<p><strong>Refine (${refineSkill.name}):</strong> `
                   + `Skill ${Math.round(refRoll.total)} × d100 (${refineD100.total}) = ${rawGain}`
                   + `${rawGain > headroom ? ` <span style="opacity:0.7;">(capped at +${headroom})</span>` : ''}. `
                   + `Progress: ${cur} → <strong>${newProgress}</strong> / ${max}.</p>`;
      }
    }

    // ── Execute prep (selection came from combined setup dialog) ──
    let prepBonus = 0;
    if (prepId) {
      const prepSkill = actor.items.get(prepId);
      if (prepSkill) {
        const prepRollData = prepSkill.getRollData();
        const { dmgFormula: prepDmgF } = prepSkill._buildRollFormulas(prepRollData);
        const prepRoll = new Roll(prepDmgF, prepRollData);
        await prepRoll.evaluate();
        prepBonus = Math.round(Math.round(prepRoll.total) / 10);

        prepLine = `<p><strong>Preparation (${prepSkill.name}):</strong> `
                 + `Roll ${Math.round(prepRoll.total)} ÷ 10 = <strong>+${prepBonus}</strong> bonus.</p>`;
      }
    }

    // ── Step 5: Craft roll ──
    const d100Roll = new Roll('1d100');
    await d100Roll.evaluate();

    // Profession augment bonuses from equipped profession gear (element-filtered).
    // Iterative reworks have no material — no element drift, no rarity from material.
    const matElement = materialItem ? (materialItem.system.materialElement || '') : '';
    const profAugBonuses = actor.getProfessionAugmentBonuses(matElement);
    const d100Bonus = profAugBonuses.d100Bonus || 0;
    const skillModBonus = profAugBonuses.craftSkillMod || 0;
    const progressBonus = profAugBonuses.craftProgress || 0;
    const rarityFloorBonus = profAugBonuses.rarityFloor || 0;
    const augBonusParts = [];
    if (skillModBonus)    augBonusParts.push(`Skill +${skillModBonus}`);
    if (d100Bonus)        augBonusParts.push(`d100 +${d100Bonus}`);
    if (rarityFloorBonus) augBonusParts.push(`Floor +${rarityFloorBonus}`);
    if (progressBonus)    augBonusParts.push(`Progress +${progressBonus}`);
    const profAugLine = augBonusParts.length
      ? `<p><strong>Profession Augments:</strong> ${augBonusParts.join(', ')}</p>`
      : '';

    // Additive d100: floor boosts the roll, ceiling caps it.
    // For iterative reworks (no material), use the existing item's rarity.
    const matRarity = materialItem
      ? (materialItem.system.rarity || 'common')
      : (reworkTarget?.system.rarity || 'common');
    const rarityRange = CONFIG.ASPECTSOFPOWER.craftRarityRanges?.[matRarity]
                     ?? { floor: 1, ceiling: 100 };
    const effectiveD100 = Math.min(d100Roll.total + rarityRange.floor + rarityFloorBonus + d100Bonus, rarityRange.ceiling);
    const d100Pct = effectiveD100 / 100;

    // ── Critical failure: d100 of 1 ──
    if (d100Roll.total === 1) {
      const isAlchemyFailure = (item.system.tags ?? []).includes('alchemy');
      const failureMsg = isAlchemyFailure
        ? `<p><strong>Materials destroyed!</strong> ${materialItem.name} is consumed in the failed brew.</p>`
        : `<p><strong>Craft failed.</strong> Materials are preserved — try again.</p>`;

      // Alchemy: consume the material. Equipment: leave it alone.
      if (isAlchemyFailure) {
        if ((materialItem.system.quantity ?? 1) <= 1) {
          await materialItem.delete();
        } else {
          await materialItem.update({ 'system.quantity': materialItem.system.quantity - 1 });
        }
      }

      ChatMessage.create({
        speaker,
        content: `<div class="craft-result">
          <h3>${item.name} — Critical Failure</h3>
          <hr>
          <p style="color:#ef5350;font-size:1.2em;">&#10008; Natural 1 on d100! &#10008;</p>
          <p><strong>Material:</strong> ${materialItem.name}</p>
          ${failureMsg}
        </div>`,
      });
      return;
    }

    // 50/50 split: material quality + crafter skill.
    // Iterative reworks have no material; only crafter contributes via the rework formula below.
    const materialProgress = materialItem ? (materialItem.system.progress ?? 0) : 0;
    const materialContribution = Math.round(materialProgress * 0.5);

    const skillRoll = Math.round(dmgRoll.total) + skillModBonus;
    const crafterRoll = Math.round(skillRoll * d100Pct);
    const crafterContribution = Math.round(crafterRoll * 0.5);

    // Theoretical max for THIS craft: what would result if the crafter rolled a perfect d100 (=100).
    // Uses 1.0 instead of rarity ceiling so the cap doesn't swing wildly with material rarity.
    const maxCrafterRoll = skillRoll;
    const theoreticalMaxProgress = Math.round(materialProgress * 0.5) + Math.round(maxCrafterRoll * 0.5) + prepBonus + progressBonus;

    let totalProgress = materialContribution + crafterContribution + prepBonus + progressBonus;

    // Iterative rework: crafter-only contribution (no material, no 50/50 split since
    // material isn't being consumed). Apply 1/(reworkCount+2) diminishing returns,
    // capped at the item's maxProgress.
    let reworkAddedProgress = 0;
    let reworkBlocked = false;
    if (reworkTarget) {
      const existingMax = reworkTarget.system.maxProgress ?? 0;
      const existingProgress = reworkTarget.system.progress ?? 0;
      const headroom = Math.max(0, existingMax - existingProgress);

      if (headroom <= 0) {
        reworkBlocked = true;
      } else {
        const existingCount = reworkTarget.system.reworkCount ?? 0;
        // Divisor offset of 5 calibrated so an item maxes out in ~5 total crafts
        // (1 initial + ~4 reworks on average); see python/Test/augment_value_sim.py.
        const divisor = existingCount + 5;
        // Crafter-only — material is not consumed and doesn't contribute on rework.
        const reworkContribution = crafterRoll + prepBonus + progressBonus;
        const rawAdd = Math.round(reworkContribution / divisor);
        reworkAddedProgress = Math.min(rawAdd, headroom);
        totalProgress = existingProgress + reworkAddedProgress;
      }
    }

    if (reworkBlocked) {
      ChatMessage.create({
        speaker,
        content: `<div class="craft-result">
          <h3>${item.name} — Rework Blocked</h3>
          <hr>
          <p><strong>${reworkTarget.name}</strong> is already at maximum potential (${reworkTarget.system.maxProgress}). No further improvement is possible.</p>
        </div>`,
      });
      return;
    }

    // Determine quality from thresholds.
    const qualityTiers = Object.entries(CONFIG.ASPECTSOFPOWER.craftQuality)
      .sort((a, b) => b[1].minProgress - a[1].minProgress);
    let qualityKey = 'cracked';
    let qualityData = qualityTiers[qualityTiers.length - 1][1];
    for (const [key, data] of qualityTiers) {
      if (totalProgress >= data.minProgress) {
        qualityKey = key;
        qualityData = data;
        break;
      }
    }

    // For iterative reworks (no material), extract element from reworkTarget's stored affinity tag.
    let element = materialItem ? (materialItem.system.materialElement || '') : '';
    if (!element && reworkTarget) {
      // Look in the unified `tags` field; legacy systemTags retained as fallback.
      const tagIds = [
        ...(reworkTarget.system.tags ?? []),
        ...(reworkTarget.system.systemTags ?? []).map(t => t.id),
      ];
      const aff = tagIds.find(id => id?.endsWith('-affinity'));
      if (aff) element = aff.replace(/-affinity$/, '');
    }
    const craftNatLine = d100Roll.total === 100
      ? '<p style="color:#ffca28;font-size:1.2em;">&#9733; Masterwork! Natural 100! &#9733;</p>'
      : '';

    // ── Branch: Alchemy (consumable) vs Equipment ──
    const isAlchemy = tags.includes('alchemy');
    let createdItem;

    if (isAlchemy) {
      // Determine consumable type from skill tags.
      let consumableType = 'potion';
      let effectType = 'restoration';
      if (tags.includes('attack') || tags.includes('aoe')) { consumableType = 'bomb'; effectType = 'bomb'; }
      else if (tags.includes('debuff'))    effectType = 'poison';
      else if (tags.includes('buff'))      effectType = 'buff';
      else if (tags.includes('cleanse'))   effectType = 'restoration';

      // Build consumable data from skill's tagConfig.
      const tc = item.system.tagConfig ?? {};
      const consumableData = {
        description: `<p>Brewed by ${actor.name} using ${materialItem.name}.</p>`,
        quantity: 1,
        rarity: qualityData.rarity,
        consumableType,
        effectType,
        charges: { value: 1, max: 1 },
      };

      // Map skill effects to consumable fields based on progress.
      if (effectType === 'restoration') {
        consumableData.restoration = {
          resource: tc.restorationResource || 'health',
          amount: totalProgress,
          overhealth: tc.restorationOverhealth || false,
        };
      } else if (effectType === 'buff') {
        consumableData.buff = {
          entries: (tc.buffEntries || []).map(e => ({
            attribute: e.attribute,
            value: Math.round((e.value || 1) * totalProgress * 0.1),
          })),
          duration: tc.buffDuration || 1,
        };
      } else if (effectType === 'poison') {
        consumableData.poison = {
          damage: totalProgress,
          damageType: tc.debuffDamageType || 'physical',
          duration: tc.debuffDuration || 3,
        };
      } else if (effectType === 'bomb') {
        consumableData.bomb = {
          damage: totalProgress,
          damageType: tc.debuffDamageType || 'physical',
          shape: tc.craftOutputSlot || 'circle',
          diameter: 10,
        };
      }

      const elPrefix = element ? `${element.charAt(0).toUpperCase() + element.slice(1)} ` : '';
      const typeLabel = consumableType.charAt(0).toUpperCase() + consumableType.slice(1);
      const itemName = `${elPrefix}${typeLabel}`;

      [createdItem] = await actor.createEmbeddedDocuments('Item', [{
        name: itemName,
        type: 'consumable',
        img: materialItem.img,
        system: consumableData,
      }]);

      // Consume material — but only on initial craft. Reworks reuse existing item, no mat cost.
      if (!reworkTarget) {
        if ((materialItem.system.quantity ?? 1) <= 1) {
          await materialItem.delete();
        } else {
          await materialItem.update({ 'system.quantity': materialItem.system.quantity - 1 });
        }
      }

      ChatMessage.create({
        speaker,
        content: `<div class="craft-result">
          <h3>${item.name} — Alchemy Result</h3>
          <hr>
          ${craftNatLine}
          ${refineLine}
          ${prepLine}
          <p><strong>Material:</strong> ${materialItem.name} (${matRarity}, progress ${materialProgress})</p>
          <p><strong>Material (50%):</strong> ${materialProgress} × 0.5 = ${materialContribution}</p>
          <p><strong>Crafter (50%):</strong> ${skillRoll} × ${d100Pct.toFixed(2)} = ${crafterRoll} × 0.5 = ${crafterContribution}</p>
          <p><strong>d100:</strong> ${d100Roll.total} + ${rarityRange.floor} = ${effectiveD100} (cap ${rarityRange.ceiling})</p>
          ${profAugLine}
          <p><strong>Total Progress:</strong> ${totalProgress}</p>
          <p><strong>Quality:</strong> ${qualityKey.charAt(0).toUpperCase() + qualityKey.slice(1)} (${qualityData.rarity})</p>
          <p><strong>Type:</strong> ${typeLabel} (${effectType})</p>
          <p><em>Created: ${createdItem.name}</em></p>
        </div>`,
      });

    } else {
      // ── Equipment crafting (existing logic) ──
      const elementDef = CONFIG.ASPECTSOFPOWER.craftElements?.[element];
      const outputMaterial = craftConfig?.craftOutputMaterial
        || (materialItem ? materialItem.system.material : null)
        || (reworkTarget ? reworkTarget.system.material : null)
        || 'metal';
      // Resolve type tags up-front (drives slotValue lookup, defense routing, naming).
      // Priority: new-flow typeKey → reworkTarget's stored tags → outputSlot fallback.
      const itemTypeDef = typeKey
        ? (CONFIG.ASPECTSOFPOWER.craftItemTypes?.[typeKey])
        : (CONFIG.ASPECTSOFPOWER.craftItemTypes?.[outputSlot]);
      let staticTypeTags;
      if (inheritedTypeTags.length > 0) {
        staticTypeTags = inheritedTypeTags;
      } else if (reworkTarget) {
        // Read both arrays — type tags now live in system.tags (free-form), but legacy items
        // and registry-backed tags (affinities) still come from system.systemTags.
        const freeTags  = reworkTarget.system.tags ?? [];
        const sysTagIds = (reworkTarget.system.systemTags ?? []).map(t => t.id);
        staticTypeTags = [...freeTags, ...sysTagIds];
      } else {
        staticTypeTags = itemTypeDef?.tags ?? [];
      }
      const slotCategory = itemTypeDef?.category;
      const isShield = staticTypeTags.includes('shield');

      // Slot value lookup: typeKey first (so 1H/2H weapons get distinct values), then outputSlot.
      // For iterative reworks, derive an effective typeKey by picking the most specific match
      // (highest tag-overlap with the existing item's stored tags). This avoids 'greatshield'
      // resolving to 'shield' just because 'shield' comes earlier in config order.
      let effectiveTypeKey = typeKey;
      if (!effectiveTypeKey && reworkTarget) {
        const knownTypes = Object.entries(CONFIG.ASPECTSOFPOWER.craftItemTypes ?? {});
        let bestKey = null;
        let bestScore = 0;
        for (const [k, def] of knownTypes) {
          const overlap = (def.tags ?? []).filter(t => staticTypeTags.includes(t)).length;
          if (overlap > bestScore) { bestScore = overlap; bestKey = k; }
        }
        effectiveTypeKey = bestKey;
      }
      const slotValue = CONFIG.ASPECTSOFPOWER.craftSlotValues?.[effectiveTypeKey]
        ?? CONFIG.ASPECTSOFPOWER.craftSlotValues?.[outputSlot]
        ?? 0.25;
      const matValue = CONFIG.ASPECTSOFPOWER.craftMaterialValues?.[outputMaterial] ?? 0.5;

      // Stat budget = Progress × Slot value × 0.25 (universal — slotValue encodes 1H/2H).
      const totalStatBudget = Math.round(totalProgress * slotValue * 0.25);
      const statBonuses = [];

      if (elementDef?.stats?.length >= 3 && totalStatBudget > 0) {
        const base = Math.round(totalStatBudget / 3);
        const remainder = Math.round(totalStatBudget % 3);
        let s1, s2, s3;
        if (remainder === 0)      { s1 = base + 1; s2 = base;     s3 = base - 1; }
        else if (remainder === 1) { s1 = base + 2; s2 = base;     s3 = base - 1; }
        else                      { s1 = base + 1; s2 = base;     s3 = base - 2; }
        statBonuses.push(
          { ability: elementDef.stats[0], value: Math.max(0, s1) },
          { ability: elementDef.stats[1], value: Math.max(0, s2) },
          { ability: elementDef.stats[2], value: Math.max(0, s3) },
        );
      } else if (element === 'neutral' && totalStatBudget > 0) {
        const perStat = Math.round(totalStatBudget / 9);
        for (const ab of ['vitality','endurance','strength','dexterity','toughness','intelligence','willpower','wisdom','perception']) {
          if (perStat > 0) statBonuses.push({ ability: ab, value: perStat });
        }
      }

      // Defense routing: armor slots → armor bonus, jewelry → veil, shields → armor (separate value), other weapons → neither.
      const isArmorSlot   = slotCategory === 'armor';
      const isJewelrySlot = slotCategory === 'jewelry';
      const defenseValue = Math.round(totalProgress * slotValue * matValue);
      let armorBonus = isArmorSlot ? defenseValue : 0;
      const veilBonus  = isJewelrySlot ? defenseValue : 0;
      // Shields use a separate armor value table (small/medium/large = 30/40/50%).
      if (isShield) {
        const shieldArmorValue = CONFIG.ASPECTSOFPOWER.craftShieldArmorValues?.[effectiveTypeKey] ?? 0.30;
        armorBonus = Math.round(totalProgress * shieldArmorValue * matValue);
      }

      const rarityDef = CONFIG.ASPECTSOFPOWER.rarities?.[qualityData.rarity];
      const augmentSlots = rarityDef?.augments ?? 0;

      // Tag inheritance:
      //   - free-form tags (sword/1H/weapon/metal etc.) → system.tags (chip UI)
      //   - registry-backed affinity tag → system.systemTags (mechanical effects)
      const craftedFreeTags = [...staticTypeTags];
      if (outputMaterial) craftedFreeTags.push(outputMaterial);
      const craftedSystemTags = [];
      if (element && element !== 'neutral') craftedSystemTags.push({ id: `${element}-affinity`, value: 0 });

      // Name format: "{Element-Prefixed Type} - {progress}". Use typeKey for weapons (sword/axe/etc.),
      // outputSlot for armor/jewelry/profession (slot == type).
      const elPrefix = element ? `${element.charAt(0).toUpperCase() + element.slice(1)} ` : '';
      const nameRoot = typeKey || outputSlot;
      const niceName = nameRoot.charAt(0).toUpperCase() + nameRoot.slice(1);
      const itemName = `${elPrefix}${niceName} - ${totalProgress}`;

      if (reworkTarget) {
        // Update the existing item with new totals; bump rework count.
        // maxProgress is locked at first craft and not updated.
        // Name updates with new progress; tags are preserved (set on initial craft).
        const reworkName = `${reworkTarget.name.replace(/ - \d+$/, '')} - ${totalProgress}`;
        await reworkTarget.update({
          name: reworkName,
          'system.progress': totalProgress,
          'system.durability.value': totalProgress * 2,
          'system.durability.max': totalProgress * 2,
          'system.rarity': qualityData.rarity,
          'system.statBonuses': statBonuses,
          'system.armorBonus': armorBonus,
          'system.veilBonus': veilBonus,
          'system.augmentSlots': augmentSlots,
          'system.reworkCount': (reworkTarget.system.reworkCount ?? 0) + 1,
        });
        createdItem = reworkTarget;
      } else {
        [createdItem] = await actor.createEmbeddedDocuments('Item', [{
          name: itemName,
          type: 'item',
          img: materialItem.img,
          system: {
            description: `<p>Crafted by ${actor.name} using ${materialItem.name}.</p>`,
            slot: outputSlot,
            material: outputMaterial,
            rarity: qualityData.rarity,
            progress: totalProgress,
            maxProgress: theoreticalMaxProgress,
            durability: { value: totalProgress * 2, max: totalProgress * 2 },
            statBonuses,
            armorBonus,
            veilBonus,
            augmentSlots,
            tags: craftedFreeTags,
            systemTags: craftedSystemTags,
          },
        }]);
      }

      // Consume material — but only on initial craft. Reworks reuse existing item, no mat cost.
      if (!reworkTarget) {
        if ((materialItem.system.quantity ?? 1) <= 1) {
          await materialItem.delete();
        } else {
          await materialItem.update({ 'system.quantity': materialItem.system.quantity - 1 });
        }
      }

      const statLine = statBonuses.length
        ? statBonuses.map(s => `${s.ability}: +${s.value}`).join(', ')
        : 'none';

      const reworkLine = reworkTarget
        ? `<p><strong>Rework:</strong> ×${reworkTarget.system.reworkCount} → ×${(reworkTarget.system.reworkCount ?? 0) + 1} (added +${reworkAddedProgress} with diminishing returns)</p>`
        : '';
      const headerTitle = reworkTarget ? 'Rework Result' : 'Crafting Result';
      const createdLine = reworkTarget
        ? `<p><em>Improved: ${createdItem.name}</em></p>`
        : `<p><em>Created: ${createdItem.name}</em></p>`;

      const matLine = materialItem
        ? `<p><strong>Material:</strong> ${materialItem.name} (${matRarity}, progress ${materialProgress})</p>
           <p><strong>Material (50%):</strong> ${materialProgress} × 0.5 = ${materialContribution}</p>`
        : `<p><em>Iterative rework — no material consumed.</em></p>`;
      ChatMessage.create({
        speaker,
        content: `<div class="craft-result">
          <h3>${item.name} — ${headerTitle}</h3>
          <hr>
          ${craftNatLine}
          ${reworkLine}
          ${refineLine}
          ${prepLine}
          ${matLine}
          <p><strong>Crafter (50%):</strong> ${skillRoll} × ${d100Pct.toFixed(2)} = ${crafterRoll} × 0.5 = ${crafterContribution}</p>
          <p><strong>d100:</strong> ${d100Roll.total} + ${rarityRange.floor} = ${effectiveD100} (cap ${rarityRange.ceiling})</p>
          ${profAugLine}
          <p><strong>Total Progress:</strong> ${totalProgress}</p>
          <p><strong>Quality:</strong> ${qualityKey.charAt(0).toUpperCase() + qualityKey.slice(1)} (${qualityData.rarity})</p>
          ${armorBonus ? `<p><strong>Armor:</strong> ${armorBonus}</p>` : ''}
          ${veilBonus ? `<p><strong>Veil:</strong> ${veilBonus}</p>` : ''}
          <p><strong>Stats:</strong> ${statLine}</p>
          <p><strong>Augment Slots:</strong> ${augmentSlots}</p>
          ${createdLine}
        </div>`,
      });
    }

    createdItem.sheet.render(true);
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
  async _placeAoeTemplate(casterToken) {
    const aoe = this.system.aoe;
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
      // caster's casting range.
      const onWheel = (event) => {
        const dir = event.deltaY < 0 ? 1 : -1;
        let next = currentDiameter + dir * SCROLL_STEP_FT;
        if (next < MIN_SIZE_FT) next = MIN_SIZE_FT;
        if (isDirected && next > castingRange) next = castingRange;
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
                targetingMode: aoe.targetingMode ?? 'all',
                zoneEffect: aoe.zoneEffect ?? 'none',
                casterDisposition: this.actor.getActiveTokens()?.[0]?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                affectedTokens: {},
              } : null,
            },
          },
        };

        const [created] = await canvas.scene.createEmbeddedDocuments('Region', [regionData]);
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
   * v14: uses RegionDocument#testPoint for containment testing.
   * @param {RegionDocument} regionDoc
   * @returns {Token[]}
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

    const qualifying = [];

    for (const token of canvas.tokens.placeables) {
      if (token.document.hidden) continue;

      if (originatesAtCaster && casterId && token.id === casterId) continue;

      const center = token.center;

      // v14: use RegionDocument#testPoint with elevated point.
      if (!regionDoc.testPoint({ x: center.x, y: center.y, elevation: token.document.elevation ?? 0 })) continue;

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

      qualifying.push(token);
    }

    return qualifying;
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
    const item     = this;
    const rollData = this.getRollData();
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

    // Passive skills → post description only (no roll).
    if (this.system.skillType === 'Passive') {
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

      // Immobilized blocks physical (non-mana) skills.
      if (_hasDebuff('immobilized') && rollData.roll.resource !== 'mana') {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.cannotAct')} (${game.i18n.localize('ASPECTSOFPOWER.Debuff.immobilized')})`);
        return;
      }

      // Silence blocks skills with vocal components.
      if (_hasDebuff('silence') && this.system.vocalComponent) {
        ui.notifications.warn(`${this.actor.name} ${game.i18n.localize('ASPECTSOFPOWER.Debuff.silenced')} — cannot use ${this.name}!`);
        return;
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

    // Flush any pending stamina costs from movement so resource checks are accurate.
    const TokenClass = CONFIG.Token.documentClass;
    if (TokenClass?.flushStamina) await TokenClass.flushStamina();

    // Build formulas (also populates rollData.roll.abilitymod and resourcevalue).
    // Done BEFORE the celerity defer gate so the variable-invest dialog (which
    // needs formula context) can capture the invest amount at declaration time.
    let { hitFormula, dmgFormula } = this._buildRollFormulas(rollData);

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
    const sc = CONFIG.ASPECTSOFPOWER;

    const spellTier  = this.system.roll?.tier  ?? '';
    const spellGrade = this.system.roll?.grade ?? '';
    const isVariableSpell = rollData.roll.resource === 'mana'
      && spellTier && spellGrade
      && tags.includes('attack');

    const isVariableWeapon = rollData.roll.resource === 'stamina'
      && tags.includes('attack')
      && ['str_weapon', 'dex_weapon', 'phys_ranged'].includes(rollData.roll.type);

    if (isVariableSpell) {
      const tierFactor  = sc.spellTierFactors[spellTier];
      const gradeFactor = sc.spellGradeFactors[spellGrade];
      const baseMana    = Math.round(tierFactor * gradeFactor);
      const wisMod      = this.actor.system.abilities?.wisdom?.mod ?? 0;
      // Live read — slider must cap at the actor's CURRENT mana.
      const livePool    = Math.round(this.actor.system[rollData.roll.resource]?.value ?? 0);
      const intMod      = this.actor.system.abilities?.intelligence?.mod ?? 0;
      // Multiplier resolution: prefer hand-tuned `diceBonus` (designer-set,
      // non-default value) so existing spells don't drift before migration.
      // Otherwise fall back to the rarity-based effective mult; legacy
      // `spellTierMultipliers` retained as a final fallback for skills that
      // have neither been migrated nor hand-tuned.
      const tierMult    = sc.spellTierMultipliers[spellTier];
      const dbVal       = this.system.roll?.diceBonus ?? 1;
      const { effectiveMult } = this._resolveRarityMods();
      const multiplier  = (dbVal && dbVal !== 1) ? dbVal
                        : (this.system.rarity && this.system.rarity !== 'common') ? effectiveMult
                        : (tierMult ?? effectiveMult);

      // Hard cap on invest = baseMana + Wis × spellMaxInvestAboveBase[tier],
      // clamped by mana pool. NO self-damage past this cap — Wis is the
      // absolute ceiling per locked design.
      const aboveBaseFactor = sc.spellMaxInvestAboveBase?.[spellTier]
        ?? sc.spellMaxInvestAboveBase?.['']
        ?? 1.0;
      const wisCap   = Math.round(baseMana + wisMod * aboveBaseFactor);
      const maxInvest = Math.min(livePool, wisCap);

      if (livePool < baseMana) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p>Not enough mana to cast (need ${baseMana}, have ${livePool}).</p>`,
        });
        return;
      }

      const invested = (options.preInvestAmount != null)
        ? Math.min(options.preInvestAmount, maxInvest)  // clamp pre-capture too
        : await this._promptResourceInvest({
            baseCost: baseMana,
            safeInvest: 0,                              // hard cap = no soft zone
            maxPool: maxInvest,
            potency: intMod, multiplier,
            resourceLabel: 'mana', potencyLabel: 'Int', label,
            channelStat: wisMod,
            channelFactor: sc.celerity?.CHANNEL_FACTOR ?? null,
            hardCap: true,                              // hide safe-ceiling/self-damage rows
          });
      if (invested === null) return; // cancelled

      investedAmount = invested;
      rollData.roll.cost = invested;
      rollData.roll.variableSpellInvest = invested;
      dmgFormula = String(Math.round(intMod * multiplier * Math.pow(Math.max(invested, 1) / Math.max(baseMana, 1), 0.2)));
      // Spells: no self-damage path under the hard-cap design. Weapons retain it.
    } else if (isVariableWeapon) {
      // Find the weapon for weight + hybrid blend. Hard-link via requiredEquipment
      // takes precedence (e.g. "Soulreaver Strike" must use Soulreaver). For generic
      // skills like "Strike", fall back to the actor's equipped weaponry-slot item
      // (highest-weight non-shield) so designers don't have to wire requiredEquipment
      // on every variant.
      const weapon = this._resolveWeaponForSkill();
      const weaponWeight = AspectsofPowerItem.resolveWeaponWeight(weapon);
      // No weapon weight → fall back to legacy formula path (skill not yet migrated).
      // The else branch below intentionally does nothing; legacy dmgFormula stays.
      if (weaponWeight > 0) {
        const isRanged = rollData.roll.type === 'phys_ranged';
        const A = this.actor.system.abilities;
        const strMod = A.strength?.mod  ?? 0;
        const dexMod = A.dexterity?.mod ?? 0;
        const perMod = A.perception?.mod ?? 0;
        const toughMod = A.toughness?.mod ?? 0;

        // Compute hybrid stat_blend per design Option B (melee) / Option α (ranged).
        let statBlend, potencyLabel;
        if (isRanged) {
          const b = sc.rangedBlend;
          const norm = Math.max(0, Math.min(1, (weaponWeight - b.weightOffset) / b.weightSpan));
          const perWeight = b.perFloor + b.slope * norm;
          const dexWeight = 1 - perWeight;
          statBlend = Math.round(dexMod * dexWeight + perMod * perWeight);
          potencyLabel = 'Dex/Per';
        } else {
          const b = sc.meleeBlend;
          const norm = Math.max(0, Math.min(1, (weaponWeight - b.weightOffset) / b.weightSpan));
          const strWeight = b.strFloor + b.slope * norm;
          const dexWeight = 1 - strWeight;
          statBlend = Math.round(strMod * strWeight + dexMod * dexWeight);
          potencyLabel = 'Str/Dex';
        }

        // base_stamina uses stat_blend for both melee and ranged — per the
        // 2026-05-03 rebalance, "high-output bodies cost more fuel" applies
        // to BOTH Str specs and Dex specs. The blend reflects whichever stat
        // is doing the work for the wielded weapon, so cost stays internally
        // consistent with damage. Old "elegant property" of constant per-round
        // burn across weapons becomes per-round = 15 × blend / 1085 (now
        // depends on build-vs-weapon match — off-spec weapons cost less AND
        // damage less, which is more coherent than purely flat costs).
        const baseStamina = Math.max(1, Math.round((weaponWeight / sc.invest.staminaBaseDivisor) * (statBlend / sc.invest.staminaNormalizer)));
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
        const dbVal = this.system.roll?.diceBonus ?? 1;
        const { effectiveMult } = this._resolveRarityMods();
        const multiplier = (dbVal !== 1) ? dbVal : effectiveMult;

        if (livePool < baseStamina) {
          ChatMessage.create({
            speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
            flavor: label,
            content: `<p>Not enough stamina (need ${baseStamina}, have ${livePool}).</p>`,
          });
          return;
        }

        // Same pre-capture pattern as the spell path.
        const invested = (options.preInvestAmount != null)
          ? Math.min(options.preInvestAmount, maxPool)
          : await this._promptResourceInvest({
              baseCost: baseStamina, safeInvest, maxPool,
              potency: statBlend, multiplier,
              resourceLabel: 'stamina', potencyLabel, label,
            });
        if (invested === null) return; // cancelled

        investedAmount = invested;
        rollData.roll.cost = invested;
        rollData.roll.variableWeaponInvest = invested;
        dmgFormula = String(Math.round(statBlend * multiplier * Math.pow(Math.max(invested, 1) / Math.max(baseStamina, 1), 0.2)));

        const excess = Math.max(0, invested - (baseStamina + safeInvest));
        if (excess > 0 && safeInvest > 0) {
          // Linear self-damage per design-skill-rarity-system.md: scales 1:1
          // with how far past safe ceiling you push.
          investSelfDamage = Math.round(statBlend * (excess / safeInvest));
          investSelfDamageFlavor = 'over-exerting';
        }
      }
    }

    // Variable mana cost for barrier skills — prompt user for amount.
    const isBarrier = tags.includes('restoration') && this.system.tagConfig?.restorationResource === 'barrier';
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

    // ── Celerity declaration gate ─────────────────────────────────────
    // In an active combat, queue this skill on the combatant's
    // declaredAction flag and bail. The tracker's "Advance to next" fires
    // it later via `item.roll({ executeDeferred: true, preInvestAmount })`
    // once the clock reaches the scheduled tick. The captured investedAmount
    // (above) feeds Wis-controlled channel time in the celerity wait calc.
    if (!options.executeDeferred && this.actor && isInActiveCombat(this.actor)) {
      const declared = await declareAction(this.actor, this, { investAmount: investedAmount });
      return declared;
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

    // ── Evaluate both rolls (shared across all tags) ────────────────────
    const hitRoll = hitFormula ? new Roll(hitFormula, rollData) : null;
    if (hitRoll) await hitRoll.evaluate();

    const dmgRoll = new Roll(dmgFormula, rollData);
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
      const liveRes = this.actor.system[resource]?.value ?? 0;
      const newResVal = Math.max(0, Math.round(liveRes - rollData.roll.cost));
      const updates = { [`system.${resource}.value`]: newResVal };
      if (investSelfDamage > 0) {
        const curHp = this.actor.system.health?.value ?? 0;
        updates['system.health.value'] = Math.max(0, curHp - investSelfDamage);
      }
      await this.actor.update(updates);
      if (investSelfDamage > 0) {
        ChatMessage.create({
          speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}),
          flavor: label,
          content: `<p><strong>${this.actor.name}</strong> takes <strong>${investSelfDamage}</strong> self-damage from ${investSelfDamageFlavor}.</p>`,
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
      }
    };

    // ── Weapon durability: degrade if raw damage exceeds the weapon's limit ──
    if (tags.includes('attack') && this.system.requiredEquipment) {
      const weapon = this.actor.items.get(this.system.requiredEquipment);
      if (weapon) {
        await EquipmentSystem.degradeWeaponOnAttack(weapon, dmgRoll.total);
      }
    }

    // ── Consume a combat action (for movement segmentation) ──
    game.aspectsofpower?.consumeAction?.(this.actor);

    // ── AOE branch: place template, detect targets, then deduct cost ──
    const isAoe = this.system.aoe?.enabled && tags.length > 0;
    if (isAoe) {
      const casterToken = this.actor.getActiveTokens()?.[0];
      if (!casterToken) {
        ChatMessage.create({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), content: '<p><em>No token found on canvas for AOE placement.</em></p>' });
        return dmgRoll;
      }

      // Interactive placement — cancelled means no cost.
      const templateDoc = await this._placeAoeTemplate(casterToken);
      if (!templateDoc) return dmgRoll;

      // Orient caster toward the AOE center.
      const aoeShape = templateDoc.shapes?.[0];
      if (aoeShape) {
        await this._orientToward({ x: aoeShape.x, y: aoeShape.y });
      }

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

      // Announce targets.
      if (targets.length > 0) {
        const targetNames = targets.map(t => t.document.name).join(', ');
        ChatMessage.create({
          speaker, rollMode,
          content: `<div class="aoe-result"><p><strong>AOE:</strong> ${targets.length} target(s) — ${targetNames}</p></div>`,
        });
      }

      // Dispatch each tag to each qualifying token.
      const hitResults = new Map();
      for (const tag of tags) {
        for (const targetToken of targets) {
          switch (tag) {
            case 'attack': {
              const result = await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label, targetToken);
              if (result) hitResults.set(targetToken, result);
              break;
            }
            case 'restoration':
              await this._handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'buff':
              await this._handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'debuff': {
              // Skip debuff if the attack missed or barrier fully absorbed for this target.
              const attackResult = hitResults.get(targetToken);
              if (attackResult && !attackResult.isHit) break;
              if (attackResult?.fullyBlocked) break;
              const defMult = attackResult?.damageMultiplier ?? 1;
              await this._handleDebuffTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken, defMult);
              break;
            }
            case 'repair':
              await this._handleRepairTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
              break;
            case 'cleanse':
              await this._handleCleanseTag(item, rollData, dmgRoll, speaker, rollMode, label, targetToken);
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
          }
        }
      }

      // Execute chained skills after all parent tags have resolved.
      await this._executeChainedSkills(hitResults, targets, speaker, rollMode);

      // Mark initial targets as affected this round on persistent AOEs.
      if (persistFlags?.persistent) {
        const currentRound = game.combat?.round ?? 0;
        const affectedMap = {};
        for (const t of targets) affectedMap[t.id] = currentRound;
        await templateDoc.update({ 'flags.aspects-of-power.persistentData.affectedTokens': affectedMap });
      }

      // Deduct resource cost AFTER effects are applied.
      // Barrier skills defer cost deduction to executeGmAction (after target accepts).
      await _commitCastCost();

      // Remove instantaneous AOE regions (duration = 0).
      if ((this.system.aoe.templateDuration ?? 0) === 0) {
        await canvas.scene.deleteEmbeddedDocuments('Region', [templateDoc.id]);
      }

      await this._applySustainEffect(speaker);
      return dmgRoll;
    }

    // ── Deduct resource cost (non-AOE) ──────────────────────────────────
    // Barrier skills defer cost until after the target accepts.
    await _commitCastCost();

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
    const hitResults = new Map();
    for (const tag of tags) {
      switch (tag) {
        case 'attack': {
          const result = await this._handleAttackTag(item, rollData, hitRoll, dmgRoll, speaker, rollMode, label);
          if (result) hitResults.set(null, result);
          break;
        }
        case 'restoration':
          await this._handleRestorationTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
        case 'buff':
          await this._handleBuffTag(item, rollData, dmgRoll, speaker, rollMode, label);
          break;
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
      }
    }

    // Execute chained skills after all parent tags have resolved.
    await this._executeChainedSkills(hitResults, null, speaker, rollMode);

    await this._applySustainEffect(speaker);
    return dmgRoll;
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

  async _executeChainedSkills(hitResults, aoeTargets, speaker, rollMode) {
    const whisperGM = !_isPlayerCharacter(this.actor) ? ChatMessage.getWhisperRecipients('GM') : undefined;
    const chains = this.system.chainedSkills ?? [];
    if (chains.length === 0) return;

    for (const chain of chains) {
      if (!chain.skillId) continue;

      const chainedItem = this.actor.items.get(chain.skillId);
      if (!chainedItem || chainedItem.type !== 'skill') continue;
      if (chainedItem.system.skillType === 'Passive') continue;

      // Determine target list: AOE targets or [null] (single-target uses game.user.targets).
      const targets = aoeTargets ?? [null];

      for (const targetToken of targets) {
        // Evaluate trigger condition per-target.
        const hitResult = hitResults.get(targetToken) ?? hitResults.get(null);
        const wasHit = hitResult?.isHit;
        if (chain.trigger === 'on-hit' && wasHit !== true) continue;
        if (chain.trigger === 'on-miss' && wasHit !== false) continue;

        // Build the chained skill's own rolls.
        const chainRollData = chainedItem.getRollData();
        const chainLabel = `[chain] ${chainedItem.name}`;
        const { hitFormula: cHitF, dmgFormula: cDmgF } = chainedItem._buildRollFormulas(chainRollData);

        const cHitRoll = cHitF ? new Roll(cHitF, chainRollData) : null;
        if (cHitRoll) await cHitRoll.evaluate();

        const cDmgRoll = new Roll(cDmgF, chainRollData);
        await cDmgRoll.evaluate();

        // Post chained skill rolls to chat.
        if (cHitRoll) await cHitRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${chainLabel} — To Hit` });
        await cDmgRoll.toMessage({ speaker, rollMode, ...(whisperGM ? { whisper: whisperGM } : {}), flavor: `${chainLabel} — Roll` });

        // Dispatch each of the chained skill's own tags.
        const chainTags = chainedItem.system.tags ?? [];
        for (const tag of chainTags) {
          switch (tag) {
            case 'attack':
              await chainedItem._handleAttackTag(chainedItem, chainRollData, cHitRoll, cDmgRoll, speaker, rollMode, chainLabel, targetToken);
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
