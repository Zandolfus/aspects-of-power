/**
 * Crafting skill-tag handlers — extracted VERBATIM from documents/item.mjs
 * (refactor 2026-07-03; ~1,830 lines, the crafting domain: craft setup
 * dialog, inscribe, refine, gather, augment, craft). Mixed into
 * AspectsofPowerItem.prototype at the bottom of item.mjs, so `this` is the
 * skill item exactly as before — same method identities, relocated source.
 *
 * Carrier-class pattern: the methods live in a class body so the code is
 * byte-identical to its previous class-body form (no object-literal comma
 * surgery); the export collects the prototype methods into a plain mixin.
 */
import { hybridAbilityMod } from '../helpers/formulas.mjs';

class CraftingSkills {
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
      const abMod = hybridAbilityMod(A, r);
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
    const augPrepBonus            = augBonuses.prepBonus || 0;
    const augMaterialPotency      = augBonuses.materialPotency || 0;
    const augCritFailReduce       = augBonuses.critFailReduce || 0;
    const augCritSuccessThreshold = augBonuses.critSuccessThreshold || 0;
    const augMaterialPreservation = augBonuses.materialPreservation || 0;
    const augReworkDecayReduce    = augBonuses.reworkDecayReduce || 0;

    // d100 expectation under material's rarity range.
    const matRarity = materialItem
      ? (materialItem.system.rarity || 'common')
      : (reworkTarget?.system.rarity || 'common');
    const rarityRange = CONFIG.ASPECTSOFPOWER.craftRarityRanges?.[matRarity] ?? { floor: 0, ceiling: 100 };
    const avgD100 = Math.min(50.5 + rarityRange.floor + rarityFloorBonus + d100Bonus, rarityRange.ceiling);
    const avgD100Pct = avgD100 / 100;
    const avgCrafterRoll = Math.round((avgSkillRoll + skillModBonus) * avgD100Pct);
    const avgCrafterCtrb = Math.round(avgCrafterRoll * 0.5);

    // Augment summary line.
    const augLines = [];
    if (skillModBonus)              augLines.push(`Skill +${skillModBonus}`);
    if (d100Bonus)                  augLines.push(`d100 +${d100Bonus}`);
    if (rarityFloorBonus)           augLines.push(`Floor +${rarityFloorBonus}`);
    if (progressBonus)              augLines.push(`Progress +${progressBonus}`);
    if (augPrepBonus)               augLines.push(`Prep +${augPrepBonus}`);
    if (augMaterialPotency)         augLines.push(`MatPotency +${augMaterialPotency}`);
    if (augCritFailReduce)          augLines.push(`CritFailReduce ${augCritFailReduce}%`);
    if (augCritSuccessThreshold)    augLines.push(`CritSuccessThr -${augCritSuccessThreshold}`);
    if (augMaterialPreservation)    augLines.push(`MatPreserve ${augMaterialPreservation}%`);
    if (augReworkDecayReduce)       augLines.push(`ReworkDecay -${augReworkDecayReduce}`);
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
      // materialPotency adds flat to the material-contribution leg.
      const matCtrb = Math.round(effectiveMatProgress * 0.5) + augMaterialPotency;

      // Prep impact: avg prep bonus = skill / 10, plus the prepBonus augment.
      let prepBonusPreview = augPrepBonus;
      if (prepId) {
        const prepSkill = actor.items.get(prepId);
        if (prepSkill) {
          const avgPrepSkill = avgSkillRollFor(prepSkill);
          prepBonusPreview += Math.round(avgPrepSkill / 10);
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

      // Cap (theoretical max): perfect d100 outcome. For iterative, use the
      // existing item's stored cap.
      const cap = reworkTarget
        ? (reworkTarget.system.maxProgress ?? 0)
        : Math.round(effectiveMatProgress * 0.5) + augMaterialPotency + Math.round((avgSkillRoll + skillModBonus) * 1.0 * 0.5) + progressBonus + prepBonusPreview;

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

  /**
   * Inscribe tag: profession-style action that encodes a ritual skill into a
   * raw gem from inventory, producing a consumable with effectType='ritual'
   * that activates the encoded skill in-combat. Phase 2 of design-ritual-
   * subsystem.md.
   *
   * Walks the user through the same sequential-button pattern the craft
   * pipeline uses: material → ritual subset → confirm. Each step cancels
   * cleanly. Roll has already happened upstream; quality is logged but
   * doesn't drive the charge count (fixed at 3 for first cut; tune later).
   */
  async _handleInscribeTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const actor = this.actor;
    if (!actor) return;

    const sc = CONFIG.ASPECTSOFPOWER;
    const weights = sc.ritualProgressWeights ?? { wisdom: 0.55, material: 0.30, mana: 0.15 };
    const ritualScale = sc.ritualScale ?? {};

    // Scale a ritual's rarity row by its grade tag. Base values are at
    // gradeIndex 0 (G/F/E); higher grades multiply by ritualGradeStep
    // per index (2.5 per the 2026-06-13 sealed-medium calibration —
    // caps must track same-grade combat values; see config.mjs).
    const computeScaledScale = (ritualSkill) => {
      const rarity = ritualSkill.system?.rarity ?? 'common';
      const grade  = ritualSkill.system?.ritualGrade ?? 'E';
      const base   = ritualScale[rarity] ?? ritualScale.common ?? { threshold: 0, materialFloor: 0, cap: 0 };
      const gIdx   = sc.statCurve?.gradeIndex?.[grade] ?? 0;
      const gMult  = Math.pow(sc.ritualGradeStep ?? 2.5, gIdx);
      return {
        threshold:     Math.round((base.threshold     ?? 0) * gMult),
        materialFloor: Math.round((base.materialFloor ?? 0) * gMult),
        cap:           Math.round((base.cap           ?? 0) * gMult),
        rarity, grade, gradeMult: gMult,
      };
    };

    // ── Step 1: Material picker — gems with non-zero progress ──
    // Per the user 2026-05-16: rituals consume crafting materials (type='item',
    // isMaterial) whose `progress` value feeds the prep formula. Filter for
    // gem-material specifically (system.material === 'gem').
    const gemMaterials = actor.items.filter(i =>
      i.type === 'item'
      && i.system?.isMaterial
      && (i.system?.material === 'gem' || (i.system?.tags ?? []).includes('gem'))
      && (i.system?.progress ?? 0) > 0
      && (i.system?.quantity ?? 1) > 0
    );
    if (gemMaterials.length === 0) {
      ChatMessage.create({ speaker, rollMode,
        content: `<p><em>${actor.name} has no progress-bearing gem materials to inscribe with.</em></p>` });
      return;
    }
    const gemButtons = gemMaterials.map(g => {
      const qty = g.system.quantity ?? 1;
      const rare = g.system.rarity ?? 'common';
      const prog = g.system.progress ?? 0;
      return { action: g.id, label: `${g.name} [${rare}, progress ${prog}]${qty > 1 ? ` ×${qty}` : ''}` };
    });
    gemButtons.push({ action: 'cancel', label: 'Cancel' });
    const gemChoice = await foundry.applications.api.DialogV2.wait({
      window: { title: `${item.name} — Select Material` },
      content: '<p>Pick a gem material to inscribe with. The gem\'s progress value contributes to the ritual\'s success.</p>',
      buttons: gemButtons,
      close: () => 'cancel',
    });
    if (gemChoice === 'cancel') return;
    const sourceGem = actor.items.get(gemChoice);
    if (!sourceGem) return;

    // ── Step 2: Ritual subset (ritual-tagged skills the actor knows) ──
    // craft/profession skills can carry `ritual` as flavor (Catalyst
    // Crafting on Witch-Wrights) — they describe ritual-adjacent crafting,
    // not encodable rituals. Exclude them so the picker only offers real
    // ritual definitions.
    const ritualSkills = actor.items.filter(i =>
      i.type === 'skill'
      && (i.system?.tags ?? []).includes('ritual')
      && !(i.system?.tags ?? []).includes('inscribe')
      && !(i.system?.tags ?? []).includes('craft')
    );
    if (ritualSkills.length === 0) {
      ChatMessage.create({ speaker, rollMode,
        content: `<p><em>${actor.name} knows no ritual skills to inscribe.</em></p>` });
      return;
    }
    const ritualButtons = ritualSkills.map(s => {
      const scaled = computeScaledScale(s);
      const charges = s.system?.tagConfig?.ritualChargesProduced ?? 1;
      const matNote = scaled.materialFloor > 0 ? `, mat≥${scaled.materialFloor}` : '';
      return {
        action: s.id,
        label: `${s.name} [${scaled.grade}-${scaled.rarity}] — thr ${scaled.threshold}/cap ${scaled.cap}${matNote}, ${charges} charge${charges === 1 ? '' : 's'}`,
      };
    });
    ritualButtons.push({ action: 'cancel', label: 'Cancel' });
    const ritualChoice = await foundry.applications.api.DialogV2.wait({
      window: { title: `${item.name} — Select Ritual` },
      content: `<p>Pick which ritual to encode into <strong>${sourceGem.name}</strong>:</p>`,
      buttons: ritualButtons,
      close: () => 'cancel',
    });
    if (ritualChoice === 'cancel') return;
    const ritualSkill = actor.items.get(ritualChoice);
    if (!ritualSkill) return;

    // ── Step 3: Setup dialog — mana invest + projected progress ──
    const scaled = computeScaledScale(ritualSkill);
    const rarity = scaled.rarity;
    const grade  = scaled.grade;
    const threshold = scaled.threshold;
    const cap = scaled.cap;
    const materialFloor = scaled.materialFloor;
    const charges = ritualSkill.system?.tagConfig?.ritualChargesProduced ?? 1;
    const minMana = ritualSkill.system?.tagConfig?.ritualMinMana ?? 0;
    const wisdomMod = Math.max(0, Math.round(actor.system?.abilities?.wisdom?.mod ?? 0));
    const materialProgress = sourceGem.system?.progress ?? 0;
    const currentMana = Math.round(actor.system?.mana?.value ?? 0);
    const initialMana = Math.max(minMana, Math.min(currentMana, minMana || 1));

    // Material-floor gate — clean failure, NOTHING consumed. Per the
    // 2026-05-27 rescale, high-tier rituals require an appropriately
    // high-progress material; wisdom + mana alone can't substitute.
    if (materialProgress < materialFloor) {
      ChatMessage.create({ speaker, rollMode,
        content: `<p><em>${actor.name} cannot inscribe <strong>${ritualSkill.name}</strong> [${grade}-${rarity}]: <strong>${sourceGem.name}</strong> (progress ${materialProgress}) falls below the required material floor of ${materialFloor}. Nothing consumed.</em></p>` });
      return;
    }

    if (currentMana < minMana) {
      ChatMessage.create({ speaker, rollMode,
        content: `<p><em>${actor.name} needs at least ${minMana} mana to prepare ${ritualSkill.name} (has ${currentMana}). Nothing consumed.</em></p>` });
      return;
    }

    // Inline JS in the dialog content updates the projected-progress readout
    // when the player drags the mana input. Span ids are scoped enough that
    // duplicate dialogs are unlikely; if they collide it just means stale
    // numbers in the older instance.
    const setupResult = await foundry.applications.api.DialogV2.wait({
      window: { title: `${item.name} — Ritual Setup` },
      content: `
        <div class="craft-setup">
          <p><strong>Ritualist:</strong> ${actor.name} (wisdom mod ${wisdomMod})</p>
          <p><strong>Material:</strong> ${sourceGem.name} — progress ${materialProgress}${materialFloor > 0 ? ` (floor ${materialFloor} ✓)` : ''}</p>
          <p><strong>Ritual:</strong> ${ritualSkill.name} [${grade}-${rarity}] — threshold ${threshold} / cap ${cap}, produces ${charges} charge${charges === 1 ? '' : 's'}</p>
          <hr>
          <div class="form-group">
            <label>Mana to invest (${minMana} – ${currentMana})</label>
            <input type="number" name="manaInvest" id="aop-ritual-mana" value="${initialMana}" min="${minMana}" max="${currentMana}" step="1" />
          </div>
          <p class="hint">
            Progress = round(${weights.wisdom} × wis + ${weights.material} × mat + ${weights.mana} × mana)<br>
            Projected: <strong id="aop-ritual-projected">—</strong>
            (needs ≥ ${threshold} to succeed; cap ${cap})
          </p>
          <p id="aop-ritual-warn" class="hint" style="display:none;color:#ef5350;"></p>
          <script>
            (() => {
              const inp  = document.getElementById('aop-ritual-mana');
              const out  = document.getElementById('aop-ritual-projected');
              const warn = document.getElementById('aop-ritual-warn');
              const btn  = document.querySelector('button[data-action="prep"]');
              if (!inp || !out) return;
              const update = () => {
                const raw = Number(inp.value);
                const inRange = Number.isFinite(raw) && raw >= ${minMana} && raw <= ${currentMana};
                if (!inRange) {
                  out.textContent = '—';
                  warn.style.display = 'block';
                  warn.textContent = raw < ${minMana}
                    ? \`Below minimum mana (${minMana}).\`
                    : \`Above available mana (${currentMana}).\`;
                  if (btn) btn.disabled = true;
                  return;
                }
                warn.style.display = 'none';
                if (btn) btn.disabled = false;
                const p = Math.round(${weights.wisdom} * ${wisdomMod} + ${weights.material} * ${materialProgress} + ${weights.mana} * raw);
                const ok = p >= ${threshold};
                out.textContent = p + (ok ? ' (success)' : ' (FAIL — materials + mana lost)');
                out.style.color = ok ? '#4caf50' : '#ef5350';
              };
              inp.addEventListener('input', update);
              update();
            })();
          </script>
        </div>
      `,
      buttons: [
        { action: 'prep', label: 'Prepare', icon: 'fas fa-gem', default: true, callback: (event, button, dialog) => {
          const inp = dialog.element.querySelector('[name="manaInvest"]');
          const raw = Number(inp?.value);
          // Server-side guard — JS button-disable can be bypassed; refuse
          // out-of-range values here too.
          if (!Number.isFinite(raw) || raw < minMana || raw > currentMana) return { invalid: true };
          return { mana: raw };
        } },
        { action: 'cancel', label: 'Cancel' },
      ],
      close: () => 'cancel',
    });
    if (!setupResult || setupResult === 'cancel') return;
    if (setupResult.invalid) {
      ChatMessage.create({ speaker, rollMode,
        content: `<p><em>Ritual aborted: mana invest must be between ${minMana} and ${currentMana}.</em></p>` });
      return;
    }

    const manaInvested = setupResult.mana;
    const progress = Math.round(weights.wisdom * wisdomMod + weights.material * materialProgress + weights.mana * manaInvested);

    // Re-fetch the gem in case state shifted while dialogs were open.
    const liveSrc = actor.items.get(sourceGem.id);
    if (!liveSrc) {
      ChatMessage.create({ speaker, rollMode,
        content: '<p><em>Inscribe failed: material no longer available. (No mana/material spent.)</em></p>' });
      return;
    }

    // ── Always consume: one material + the invested mana ──
    const srcQty = liveSrc.system.quantity ?? 1;
    if (srcQty <= 1) {
      await liveSrc.delete();
    } else {
      await liveSrc.update({ 'system.quantity': srcQty - 1 });
    }
    if (manaInvested > 0) {
      const manaNow = Math.round(actor.system?.mana?.value ?? 0);
      await actor.update({ 'system.mana.value': Math.max(0, manaNow - manaInvested) });
    }

    // ── Branch on success/failure ──
    if (progress < threshold) {
      ChatMessage.create({ speaker, rollMode,
        content: `<div class="craft-result">
          <h3>${item.name} — Ritual Failed</h3>
          <hr>
          <p><strong>${actor.name}</strong> attempts to inscribe <strong>${ritualSkill.name}</strong> [${grade}-${rarity}] into <strong>${liveSrc.name}</strong>, but the progress falls short.</p>
          <p>Progress: <strong style="color:#ef5350;">${progress}</strong> / threshold ${threshold} (cap ${cap})</p>
          <p class="hint">Inputs — wis ${wisdomMod}, material ${materialProgress}, mana ${manaInvested} → consumed.</p>
        </div>` });
      return;
    }

    const storedPower = Math.min(progress, cap);
    // Per-ritual override: if the ritual skill defines a separate
    // activation skill (`ritualActivationSkillId`), the Medium points to
    // THAT instead of the ritual definition itself. Lets ritual definitions
    // (like Ritual of Lightstream Prism) describe a recipe while a
    // separate effect skill (Place Lightstream Prism) does the work.
    // Per user 2026-05-30: ritualism makes Medium, Medium fires activation
    // skill — they can be different items.
    const activationOverride = ritualSkill.system?.tagConfig?.ritualActivationSkillId ?? '';
    const activationUuid = activationOverride || ritualSkill.uuid;
    const inscribedName = `Inscribed ${liveSrc.name.replace(/^Raw\s+/i, '')} (${ritualSkill.name})`;
    const [inscribed] = await actor.createEmbeddedDocuments('Item', [{
      name: inscribedName,
      type: 'consumable',
      img: liveSrc.img,
      system: {
        description: `<p>A gem inscribed with the sigils of ${ritualSkill.name}. Activating it consumes one charge to invoke the encoded ritual with stored power ${storedPower}.</p>`,
        quantity: 1,
        weight: liveSrc.system.weight ?? 0.1,
        rarity: liveSrc.system.rarity ?? 'common',
        consumableType: 'gem',
        effectType: 'ritual',
        ritualSkillId: activationUuid,
        ritualPower: storedPower,
        mediumType: 'gem',
        charges: { value: charges, max: charges },
      },
    }]);

    ChatMessage.create({ speaker, rollMode,
      content: `<div class="craft-result">
        <h3>${item.name} — Inscription Complete</h3>
        <hr>
        <p><strong>${actor.name}</strong> inscribes <strong>${ritualSkill.name}</strong> into <strong>${liveSrc.name}</strong>.</p>
        <p>Progress: <strong style="color:#4caf50;">${progress}</strong> / threshold ${threshold} ${progress > cap ? `(capped at ${cap})` : ''}</p>
        <p>Result: <strong>${inscribed.name}</strong> — stored power <strong>${storedPower}</strong>, ${charges} charge${charges === 1 ? '' : 's'}.</p>
        <p class="hint">Inputs — wis ${wisdomMod}, material ${materialProgress}, mana ${manaInvested}.</p>
      </div>` });
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
                           ?? { floor: 0, ceiling: 100 };
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

    // Mirror crafting's chat layout — show all bonus contributions and floor/cap breakdown
    // so the player can audit why the result came out the way it did.
    const rawSkillRoll = Math.round(dmgRoll.total);
    const skillLine = gatherSkillBonus
      ? `${rawSkillRoll} + ${gatherSkillBonus} (augment) = ${skillRoll}`
      : `${skillRoll}`;
    const d100Floor = gatherRarityRange.floor + gatherD100Bonus;
    const d100Line = d100Floor
      ? `${d100Roll.total} + ${d100Floor} = ${effectiveD100} (cap ${gatherRarityRange.ceiling})`
      : `${d100Roll.total} (cap ${gatherRarityRange.ceiling})`;
    const rawProgress = Math.round(skillRoll * d100Pct);
    const progressLine = gatherProgressBonus
      ? `${skillRoll} × ${d100Pct.toFixed(2)} = ${rawProgress} + ${gatherProgressBonus} (augment) = ${gatherProgress}`
      : `${skillRoll} × ${d100Pct.toFixed(2)} = ${gatherProgress}`;

    ChatMessage.create({
      speaker,
      content: `<div class="craft-result">
        <h3>${item.name} — Gathering Result</h3>
        <hr>
        ${natLine}
        <p><strong>Rarity:</strong> ${rarityLabel}</p>
        ${element ? `<p><strong>Element:</strong> ${element.charAt(0).toUpperCase() + element.slice(1)}</p>` : ''}
        <p><strong>Skill Roll:</strong> ${skillLine}</p>
        <p><strong>d100:</strong> ${d100Line}</p>
        <p><strong>Progress:</strong> ${progressLine}</p>
        ${gatherAugLine}
        <p><em>Created: ${itemName}</em></p>
      </div>`,
    });

    gatheredItem.sheet.render(true);
  }

  /**
   * Augment tag: apply a linked augment to a target equipment item.
   *
   * Skill carries the augment UUID at `flags.aspectsofpower.appliesAugmentId`.
   * Skill tags follow the [profession, <profession>, augment, <material?>]
   * convention — the optional material tag (gem/metal/cloth/wood/leather)
   * signals that the crafter must consume a matching isMaterial item from
   * inventory before the augment is inscribed. Tagless = ex nihilo.
   *
   * Flow:
   *   1. Resolve the augment doc
   *   2. If material required, pick from crafter inventory
   *   3. Pick target equipment item from crafter inventory
   *   4. Verify slot headroom (augment slotCost vs target augmentSlots)
   *   5. Push { augmentId } onto target.system.augments, consume material, chat
   *
   * Target item filtering is intentionally permissive — the dialog shows
   * every equipment item the crafter holds. The flavor description on
   * each augment tells the player what kinds of items make sense.
   */
  async _handleAugmentTag(item, rollData, dmgRoll, speaker, rollMode, label) {
    const actor = this.actor;
    if (!actor) return;

    // Resolve the augment to apply. Two modes:
    //   1. Direct: skill flag `appliesAugmentId` is a fixed UUID (most augments)
    //   2. Engrave dispatch: skill flag `engraveDispatch` is true → look up the
    //      actor's `flags.aspectsofpower.knownEngraves` (array of ability slugs)
    //      and either auto-pick (single known) or prompt (multiple).
    let augmentDoc;
    if (item.flags?.aspectsofpower?.engraveDispatch === true) {
      const known = actor.flags?.aspectsofpower?.knownEngraves ?? [];
      if (known.length === 0) {
        ui.notifications.warn(`${actor.name} doesn't know any engravings yet.`);
        return;
      }
      let chosenAbility = known[0];
      if (known.length > 1) {
        const abButtons = known.map(ab => ({
          action: ab,
          label: ab[0].toUpperCase() + ab.slice(1),
        }));
        abButtons.push({ action: 'cancel', label: 'Cancel' });
        const ch = await foundry.applications.api.DialogV2.wait({
          window: { title: `${item.name} — Engrave Which Stat?` },
          content: `<p>Select an ability to engrave (+10 ${'<em>(at slot)</em>'}).</p>`,
          buttons: abButtons,
          close: () => 'cancel',
        });
        if (ch === 'cancel') return;
        chosenAbility = ch;
      }
      // Resolve the matching Engrave <Ability> augment by name from the augments pack.
      const targetName = `Engrave ${chosenAbility[0].toUpperCase()}${chosenAbility.slice(1)}`;
      let pack = null;
      for (const p of game.packs) {
        if (p.metadata.name === 'augments' && p.metadata.packageName === 'aspects-of-power') { pack = p; break; }
      }
      if (!pack) { ui.notifications.warn('Augments compendium not found.'); return; }
      const idx = pack.index.find(e => e.name === targetName);
      if (!idx) { ui.notifications.warn(`Engrave augment "${targetName}" not in compendium.`); return; }
      augmentDoc = await pack.getDocument(idx._id);
    } else {
      const augmentUuid = item.flags?.aspectsofpower?.appliesAugmentId;
      if (!augmentUuid) {
        ui.notifications.warn(`${item.name}: no augment linked (flags.aspectsofpower.appliesAugmentId or engraveDispatch).`);
        return;
      }
      try { augmentDoc = await fromUuid(augmentUuid); }
      catch (e) { /* unavailable */ }
      if (!augmentDoc) {
        ui.notifications.warn(`${item.name}: linked augment ${augmentUuid} not resolvable.`);
        return;
      }
    }

    // Material requirement: skill tags include a material kind that must
    // be matched by an isMaterial item in the crafter's inventory.
    const tags = item.system.tags ?? [];
    const MATERIAL_TAGS = new Set(['gem', 'metal', 'cloth', 'wood', 'leather', 'crystal', 'jewelry']);
    const requiredMaterial = tags.find(t => MATERIAL_TAGS.has(t));

    let materialItem = null;
    if (requiredMaterial) {
      const candidates = actor.items.filter(i =>
        i.type === 'item'
        && i.system?.isMaterial === true
        && (i.system?.material === requiredMaterial || i.system?.tags?.includes(requiredMaterial))
      );
      if (candidates.length === 0) {
        ui.notifications.warn(`${item.name}: no ${requiredMaterial} material in ${actor.name}'s inventory.`);
        return;
      }
      const matButtons = candidates.map(m => ({
        action: m.id,
        label: `${m.name} (${m.system.material}${m.system.materialElement ? ' / ' + m.system.materialElement : ''}, ×${m.system.quantity ?? 1})`,
      }));
      matButtons.push({ action: 'cancel', label: 'Cancel' });
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: `${item.name} — Select ${requiredMaterial}` },
        content: `<p>Select a ${requiredMaterial} material to inscribe with the augment:</p>`,
        buttons: matButtons,
        close: () => 'cancel',
      });
      if (choice === 'cancel') return;
      materialItem = actor.items.get(choice);
      if (!materialItem) return;
    }

    // Pick target equipment item (skip materials, augments, consumables,
    // skills — only inscribable equipment).
    const targetCandidates = actor.items.filter(i =>
      i.type === 'item'
      && i.system?.isMaterial !== true
      && (i.system?.slot ?? '') !== ''
    );
    if (targetCandidates.length === 0) {
      ui.notifications.warn(`${item.name}: no equipment items on ${actor.name} to augment.`);
      return;
    }
    // Use a <select> rather than one-button-per-item — equipment lists on
    // a stocked actor overflow the dialog otherwise.
    const targetOptions = targetCandidates.map(t => {
      const combatUsedOpt = (t.system.augments     ?? []).filter(e => e.augmentId).length;
      const profUsedOpt   = (t.system.profAugments ?? []).filter(e => e.augmentId).length;
      const combatFreeOpt = (t.system.augmentSlots     ?? 0) - combatUsedOpt;
      const profFreeOpt   = (t.system.profAugmentSlots ?? 0) - profUsedOpt;
      const slotsLabel = `combat ${combatFreeOpt}/${t.system.augmentSlots ?? 0}, prof ${profFreeOpt}/${t.system.profAugmentSlots ?? 0}`;
      return `<option value="${t.id}">${t.name} — ${t.system.slot} (${slotsLabel})</option>`;
    }).join('');
    const targetChoice = await new Promise(resolve => {
      new foundry.applications.api.DialogV2({
        window: { title: `${item.name} — Select Target Item` },
        content: `<p>Select the equipment item to inscribe <strong>${augmentDoc.name}</strong> onto:</p>
                  <div class="form-group"><label>Target:</label><select name="target">${targetOptions}</select></div>`,
        buttons: [{
          action: 'confirm', label: 'Confirm', default: true,
          callback: (event, button) => resolve(button.form.elements.target?.value || null),
        }, {
          action: 'cancel', label: 'Cancel',
          callback: () => resolve(null),
        }],
        close: () => resolve(null),
      }).render({ force: true });
    });
    if (!targetChoice) return;
    const targetItem = actor.items.get(targetChoice);
    if (!targetItem) return;

    // Slot routing by augment tags. The augment carries `tags` that say
    // which slot types it fits in:
    //   - 'combat'      → host's `augments[]`
    //   - 'profession'  → host's `profAugments[]`
    //   - both          → hybrid; prefer prof if open, else combat
    // Legacy back-compat: empty `tags` falls back to `isProfessionAugment`
    // boolean → ['profession'] or ['combat'].
    const slotCost = augmentDoc.system?.slotCost ?? 1;
    let augTags = augmentDoc.system?.tags ?? [];
    if (augTags.length === 0) {
      augTags = augmentDoc.system?.isProfessionAugment ? ['profession'] : ['combat'];
    }
    const fitsCombat = augTags.includes('combat');
    const fitsProf   = augTags.includes('profession');

    // Empty {augmentId: ''} entries represent cleared slots (the reconcile
    // hook's convention) — don't count them as used.
    const combatUsed  = (targetItem.system?.augments     ?? []).filter(e => e.augmentId).length;
    const combatTotal = targetItem.system?.augmentSlots     ?? 0;
    const profUsed    = (targetItem.system?.profAugments ?? []).filter(e => e.augmentId).length;
    const profTotal   = targetItem.system?.profAugmentSlots ?? 0;
    const combatFree  = combatTotal - combatUsed;
    const profFree    = profTotal   - profUsed;

    // Prefer prof slot for hybrids; else fall back to whichever the aug fits.
    let slotField, currentList, totalSlots;
    if (fitsProf && profFree >= slotCost) {
      slotField = 'profAugments'; currentList = targetItem.system?.profAugments ?? []; totalSlots = profTotal;
    } else if (fitsCombat && combatFree >= slotCost) {
      slotField = 'augments';     currentList = targetItem.system?.augments     ?? []; totalSlots = combatTotal;
    } else {
      const wantedSlotType = fitsProf && !fitsCombat ? 'profession'
                           : fitsCombat && !fitsProf ? 'combat'
                           : 'either';
      ui.notifications.warn(`${targetItem.name}: no compatible ${wantedSlotType} slot free for ${augmentDoc.name} (need ${slotCost}; combat ${combatFree}/${combatTotal}, prof ${profFree}/${profTotal}).`);
      return;
    }

    // Apply: append augmentId + a SNAPSHOT of the augment's effect data, then
    // consume material if used. Snapshot makes read paths (deriveItemStats,
    // getProfessionAugmentBonuses, grants-reconcile) independent of compendium
    // hydration and freezes the augment's values at apply time.
    //
    // Per-crafter scaling: if the template has `magnifierPct > 0`, each
    // bonus's `value` is scaled by the crafter's skill roll for THIS
    // application: `snapshotValue = floor(dmgRoll.total × magnifierPct)`.
    // The "minor roll and take a percentage" model — naturally tracks
    // crafter quality (their stat mod + dice + any active augments on the
    // application skill itself). magnifierPct of 0 = use template values
    // verbatim (legacy / non-scaling augments).
    const magnifierPct = Number(augmentDoc.system?.magnifierPct ?? 0);
    const skillRollTotal = Math.round(dmgRoll?.total ?? 0);
    const scaleValue = (templateValue) => {
      if (magnifierPct > 0 && skillRollTotal > 0) {
        return Math.floor(skillRollTotal * magnifierPct);
      }
      return templateValue;
    };
    // Normalize affinity routing: legacy `affinity: 'fire'` becomes
    // `affinities: {fire: 1}`; explicit `affinities` map wins when both set.
    const normalizeAffinities = (b) => {
      const explicit = b.affinities && typeof b.affinities === 'object' ? b.affinities : {};
      if (Object.keys(explicit).length > 0) return { ...explicit };
      if (b.affinity) return { [b.affinity]: 1 };
      return {};
    };
    const snapshotItemBonuses = (augmentDoc.system?.itemBonuses ?? []).map(b => ({
      field:      b.field,
      value:      scaleValue(b.value),
      mode:       b.mode,
      affinity:   b.affinity ?? '',
      affinities: normalizeAffinities(b),
    }));
    const snapshotCraftBonuses = (augmentDoc.system?.craftBonuses ?? []).map(b => ({
      type:     b.type,
      value:    scaleValue(b.value),
      affinity: b.affinity ?? '',
    }));
    const snapshotEntry = {
      augmentId:    augmentDoc.uuid,
      itemBonuses:  snapshotItemBonuses,
      craftBonuses: snapshotCraftBonuses,
      grantsTags:   [...(augmentDoc.system?.grantsTags ?? [])],
    };
    // Prune cleared {augmentId: ''} entries so garbage from earlier removes
    // doesn't accumulate and the array stays aligned with actual usage.
    const updatedAugs = [...currentList.filter(e => e.augmentId), snapshotEntry];
    await targetItem.update({ ['system.' + slotField]: updatedAugs });

    if (materialItem) {
      if ((materialItem.system.quantity ?? 1) <= 1) await materialItem.delete();
      else await materialItem.update({ 'system.quantity': materialItem.system.quantity - 1 });
    }

    // Chat message.
    const matLine = materialItem
      ? `<p><strong>Material:</strong> ${materialItem.name} (consumed)</p>`
      : '';
    const tagsLine = (augmentDoc.system?.grantsTags ?? []).length > 0
      ? `<p><strong>Grants tags:</strong> ${augmentDoc.system.grantsTags.join(', ')}</p>`
      : '';
    ChatMessage.create({
      speaker,
      content: `<div class="augment-result">
        <h3>${item.name}</h3>
        <hr>
        <p><strong>${actor.name}</strong> inscribes <strong>${augmentDoc.name}</strong> onto <strong>${targetItem.name}</strong>.</p>
        ${matLine}
        ${tagsLine}
        <p class="hint">${slotField === 'profAugments' ? 'Prof' : 'Combat'} slots used: ${updatedAugs.length} / ${totalSlots}.</p>
      </div>`,
    });
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
    let prepDisplayInfo = null; // { skillName, rollTotal, rollContribution } — used to rebuild prepLine after augs are read
    if (prepId) {
      const prepSkill = actor.items.get(prepId);
      if (prepSkill) {
        const prepRollData = prepSkill.getRollData();
        const { dmgFormula: prepDmgF } = prepSkill._buildRollFormulas(prepRollData);
        const prepRoll = new Roll(prepDmgF, prepRollData);
        await prepRoll.evaluate();
        const prepRollContribution = Math.round(Math.round(prepRoll.total) / 10);
        prepBonus = prepRollContribution;
        prepDisplayInfo = { skillName: prepSkill.name, rollTotal: Math.round(prepRoll.total), rollContribution: prepRollContribution };
        // prepLine rebuilt below after augPrepBonus is folded in.
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
    // Extended craft-bonus set (design-profession-augments.md):
    const augPrepBonus            = profAugBonuses.prepBonus || 0;
    const augMaterialPotency      = profAugBonuses.materialPotency || 0;
    const augCritFailReduce       = profAugBonuses.critFailReduce || 0;
    const augCritSuccessThreshold = profAugBonuses.critSuccessThreshold || 0;
    const augMaterialPreservation = profAugBonuses.materialPreservation || 0;
    const augReworkDecayReduce    = profAugBonuses.reworkDecayReduce || 0;
    // Apply prepBonus augment to the prep step's contribution (computed above).
    prepBonus += augPrepBonus;
    // Rebuild prepLine to show the prep-roll piece + the augment piece inline.
    if (prepDisplayInfo) {
      const augPrepExpr = augPrepBonus ? ` + (${augPrepBonus})` : '';
      prepLine = `<p><strong>Preparation (${prepDisplayInfo.skillName}):</strong> `
               + `Roll ${prepDisplayInfo.rollTotal} ÷ 10 = ${prepDisplayInfo.rollContribution}${augPrepExpr} = <strong>+${prepBonus}</strong></p>`;
    } else if (augPrepBonus) {
      // No prep skill rolled, but the augment still contributes.
      prepLine = `<p><strong>Preparation Augment:</strong> +${augPrepBonus}</p>`;
    }

    const augBonusParts = [];
    if (skillModBonus)              augBonusParts.push(`Skill +${skillModBonus}`);
    if (d100Bonus)                  augBonusParts.push(`d100 +${d100Bonus}`);
    if (rarityFloorBonus)           augBonusParts.push(`Floor +${rarityFloorBonus}`);
    if (progressBonus)              augBonusParts.push(`Progress +${progressBonus}`);
    if (augPrepBonus)               augBonusParts.push(`Prep +${augPrepBonus}`);
    if (augMaterialPotency)         augBonusParts.push(`MatPotency +${augMaterialPotency}`);
    if (augCritFailReduce)          augBonusParts.push(`CritFailReduce ${augCritFailReduce}%`);
    if (augCritSuccessThreshold)    augBonusParts.push(`CritSuccessThr -${augCritSuccessThreshold}`);
    if (augMaterialPreservation)    augBonusParts.push(`MatPreserve ${augMaterialPreservation}%`);
    if (augReworkDecayReduce)       augBonusParts.push(`ReworkDecay -${augReworkDecayReduce}`);
    const profAugLine = augBonusParts.length
      ? `<p><strong>Profession Augments:</strong> ${augBonusParts.join(', ')}</p>`
      : '';

    // Additive d100: floor boosts the roll, ceiling caps it.
    // For iterative reworks (no material), use the existing item's rarity.
    const matRarity = materialItem
      ? (materialItem.system.rarity || 'common')
      : (reworkTarget?.system.rarity || 'common');
    const rarityRange = CONFIG.ASPECTSOFPOWER.craftRarityRanges?.[matRarity]
                     ?? { floor: 0, ceiling: 100 };
    // critFailReduce: roll a save. If it fires, treat d100=1 as d100=2 so the
    // craft proceeds (and materials are preserved by virtue of not entering
    // the fail branch). Per design memo: "Rare-but-decisive."
    const critFailReducedFire = d100Roll.total === 1
      && augCritFailReduce > 0
      && Math.random() * 100 < augCritFailReduce;
    const effectiveD100Raw = critFailReducedFire ? 2 : d100Roll.total;
    const effectiveD100 = Math.min(effectiveD100Raw + rarityRange.floor + rarityFloorBonus + d100Bonus, rarityRange.ceiling);
    const d100Pct = effectiveD100 / 100;
    // critSuccessThreshold: lowers the d100 needed for masterwork/crit-success.
    // Floor at 90 (per memo cap of 10 deduction). Default threshold = 100.
    const critSuccessThr = Math.max(90, 100 - augCritSuccessThreshold);
    const isCritSuccess = effectiveD100Raw >= critSuccessThr;

    // ── Critical failure: d100 of 1 ──
    if (effectiveD100Raw === 1) {
      // Iterative reworks carry NO material (materialItem is null) — guard the
      // name interpolations or a nat-1 on a rework throws instead of reporting.
      const isAlchemyFailure = (item.system.tags ?? []).includes('alchemy') && !!materialItem;
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
          ${materialItem ? `<p><strong>Material:</strong> ${materialItem.name}</p>` : ''}
          ${failureMsg}
        </div>`,
      });
      return;
    }

    // 50/50 split: material quality + crafter skill.
    // Iterative reworks have no material; only crafter contributes via the rework formula below.
    const materialProgress = materialItem ? (materialItem.system.progress ?? 0) : 0;
    // materialPotency: flat add on top of the half-of-progress material contribution.
    const materialContribution = Math.round(materialProgress * 0.5) + augMaterialPotency;

    const skillRoll = Math.round(dmgRoll.total) + skillModBonus;
    const crafterRoll = Math.round(skillRoll * d100Pct);
    const crafterContribution = Math.round(crafterRoll * 0.5);

    // Theoretical max for THIS craft: what would result if the crafter rolled a perfect d100 (=100).
    // Uses 1.0 instead of rarity ceiling so the cap doesn't swing wildly with material rarity.
    const maxCrafterRoll = skillRoll;
    const theoreticalMaxProgress = Math.round(materialProgress * 0.5) + augMaterialPotency + Math.round(maxCrafterRoll * 0.5) + prepBonus + progressBonus;

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
        // reworkDecayReduce: pulls the divisor down (more progress per rework),
        // floored at 1.1 to keep the divide stable.
        const divisor = Math.max(1.1, existingCount + 5 - augReworkDecayReduce);
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
    // critSuccess: bump quality one tier up. Quality tiers are sorted high-to-low
    // here, so "up" is the entry BEFORE the current one in the sorted list.
    if (isCritSuccess) {
      const currentIdx = qualityTiers.findIndex(([k]) => k === qualityKey);
      if (currentIdx > 0) {
        const [bumpKey, bumpData] = qualityTiers[currentIdx - 1];
        qualityKey = bumpKey;
        qualityData = bumpData;
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
      : (isCritSuccess
          ? `<p style="color:#ffca28;font-size:1.1em;">&#9733; Crit Success (d100 ${d100Roll.total} &ge; ${critSuccessThr})! Quality bumped one tier. &#9733;</p>`
          : '');

    // ── Branch: Alchemy (consumable) vs Equipment ──
    const isAlchemy = tags.includes('alchemy');
    // materialPreservation eligibility: alchemy or cooking. These professions
    // craft "consumables from ingredients" where a roll-good might let you
    // stretch one leaf into two doses. Equipment crafts (1 material → 1 piece)
    // don't qualify — preservation there would just be a free craft.
    const isMaterialPreservingCraft = isAlchemy || tags.includes('cooking') || tags.includes('chef');
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
      // materialPreservation: % chance to save the ingredient ("stretched one
      // leaf into two doses"). Alchemy + cooking eligible per design.
      const alchemyMaterialPreserved = !reworkTarget
        && isMaterialPreservingCraft
        && augMaterialPreservation > 0
        && Math.random() * 100 < augMaterialPreservation;
      if (!reworkTarget && !alchemyMaterialPreserved) {
        if ((materialItem.system.quantity ?? 1) <= 1) {
          await materialItem.delete();
        } else {
          await materialItem.update({ 'system.quantity': materialItem.system.quantity - 1 });
        }
      }
      const alchemyMatPreservedLine = alchemyMaterialPreserved
        ? `<p style="color:#80cbc4;">&#10003; Ingredient preserved by augment (${augMaterialPreservation}% chance).</p>`
        : '';

      // d100 + Crafter + Material lines with inline (x) bonus notation.
      const d100BonusExprA        = d100Bonus        ? ` + (${d100Bonus})`        : '';
      const rarityFloorBonusExprA = rarityFloorBonus ? ` + (${rarityFloorBonus})` : '';
      const skillModExprA         = skillModBonus    ? ` + (${skillModBonus})`    : '';
      const skillRollDisplayA     = skillModBonus
        ? `${Math.round(dmgRoll.total)}${skillModExprA} = ${skillRoll}`
        : `${skillRoll}`;
      const matPotencyExprA = augMaterialPotency ? ` + (${augMaterialPotency})` : '';
      ChatMessage.create({
        speaker,
        content: `<div class="craft-result">
          <h3>${item.name} — Alchemy Result</h3>
          <hr>
          ${craftNatLine}
          ${refineLine}
          ${prepLine}
          ${alchemyMatPreservedLine}
          <p><strong>Material:</strong> ${materialItem.name} (${matRarity}, progress ${materialProgress})</p>
          <p><strong>Material (50%):</strong> ${materialProgress} × 0.5${matPotencyExprA} = ${materialContribution}</p>
          <p><strong>d100:</strong> ${d100Roll.total}${d100BonusExprA}${rarityFloorBonusExprA} + ${rarityRange.floor} = ${effectiveD100} (cap ${rarityRange.ceiling})</p>
          <p><strong>Crafter (50%):</strong> ${skillRollDisplayA} × ${d100Pct.toFixed(2)} = ${crafterRoll} × 0.5 = ${crafterContribution}</p>
          ${profAugLine}
          <p><strong>Total Progress:</strong> ${materialContribution} + ${crafterContribution} + ${prepBonus}${progressBonus ? ` + (${progressBonus})` : ''} = <strong>${totalProgress}</strong></p>
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

      // ── Material output: refined ingredient that feeds future crafts ──
      // Picked when the chosen item type has `category: 'material'` (gem,
      // ingot, thread, hide, plank). Skips stat/armor/augment derivation
      // (materials don't have those) and writes an `isMaterial: true` item.
      // Iterative rework not supported — each craft outputs a fresh material.
      const isMaterialOutput = itemTypeDef?.category === 'material';
      if (isMaterialOutput) {
        const MATERIAL_KINDS = ['gem', 'metal', 'cloth', 'leather', 'wood'];
        const matKind = (itemTypeDef.tags ?? []).find(t => MATERIAL_KINDS.includes(t)) ?? outputMaterial;
        [createdItem] = await actor.createEmbeddedDocuments('Item', [{
          name: itemName,
          type: 'item',
          img: materialItem.img,
          system: {
            description: `<p>Refined by ${actor.name} from ${materialItem.name}.</p>`,
            slot: '',
            isMaterial: true,
            material: matKind,
            materialElement: element && element !== 'neutral' ? element : '',
            rarity: qualityData.rarity,
            progress: totalProgress,
            maxProgress: theoreticalMaxProgress,
            quantity: 1,
            weight: 1,
            tags: [...staticTypeTags],
            systemTags: craftedSystemTags,
          },
        }]);
        // Consume source material (no preservation — that's alchemy/cooking only).
        if (!reworkTarget) {
          if ((materialItem.system.quantity ?? 1) <= 1) await materialItem.delete();
          else await materialItem.update({ 'system.quantity': materialItem.system.quantity - 1 });
        }
        // d100 + Crafter + Material lines with inline (x) bonus notation.
        const d100BonusExprM        = d100Bonus        ? ` + (${d100Bonus})`        : '';
        const rarityFloorBonusExprM = rarityFloorBonus ? ` + (${rarityFloorBonus})` : '';
        const skillModExprM         = skillModBonus    ? ` + (${skillModBonus})`    : '';
        const skillRollDisplayM     = skillModBonus
          ? `${Math.round(dmgRoll.total)}${skillModExprM} = ${skillRoll}`
          : `${skillRoll}`;
        const matPotencyExprM = augMaterialPotency ? ` + (${augMaterialPotency})` : '';
        ChatMessage.create({
          speaker,
          content: `<div class="craft-result">
            <h3>${item.name} — Refinement Result</h3>
            <hr>
            ${craftNatLine}
            ${refineLine}
            ${prepLine}
            <p><strong>Source:</strong> ${materialItem.name} (${matRarity}, progress ${materialProgress})</p>
            <p><strong>Material (50%):</strong> ${materialProgress} × 0.5${matPotencyExprM} = ${materialContribution}</p>
            <p><strong>d100:</strong> ${d100Roll.total}${d100BonusExprM}${rarityFloorBonusExprM} + ${rarityRange.floor} = ${effectiveD100} (cap ${rarityRange.ceiling})</p>
            <p><strong>Crafter (50%):</strong> ${skillRollDisplayM} × ${d100Pct.toFixed(2)} = ${crafterRoll} × 0.5 = ${crafterContribution}</p>
            ${profAugLine}
            <p><strong>Total Progress:</strong> ${materialContribution} + ${crafterContribution} + ${prepBonus}${progressBonus ? ` + (${progressBonus})` : ''} = <strong>${totalProgress}</strong></p>
            <p><strong>Quality:</strong> ${qualityKey.charAt(0).toUpperCase() + qualityKey.slice(1)} (${qualityData.rarity})</p>
            <p><strong>Material kind:</strong> ${matKind}${element && element !== 'neutral' ? ` (${element})` : ''}</p>
            <p><em>Refined: ${createdItem.name}</em></p>
          </div>`,
        });
        createdItem.sheet.render(true);
        return;
      }

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
      // materialPreservation does NOT apply here: equipment crafts are 1 material
      // → 1 piece, so preservation would just be "free craft". Per user direction,
      // preservation only applies to alchemy/cooking (1 ingredient might cover
      // multiple doses — the "use one leaf where two might be necessary" idea).
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

      const matPotencyExpr = augMaterialPotency
        ? ` + (${augMaterialPotency})`
        : '';
      const matLine = materialItem
        ? `<p><strong>Material:</strong> ${materialItem.name} (${matRarity}, progress ${materialProgress})</p>
           <p><strong>Material (50%):</strong> ${materialProgress} × 0.5${matPotencyExpr} = ${materialContribution}</p>`
        : `<p><em>Iterative rework — no material consumed.</em></p>`;
      // d100 + Crafter lines with inline (x) bonus notation.
      const d100BonusExpr        = d100Bonus        ? ` + (${d100Bonus})`        : '';
      const rarityFloorBonusExpr = rarityFloorBonus ? ` + (${rarityFloorBonus})` : '';
      const skillModExpr         = skillModBonus    ? ` + (${skillModBonus})`    : '';
      const skillRollDisplay     = skillModBonus
        ? `${Math.round(dmgRoll.total)}${skillModExpr} = ${skillRoll}`
        : `${skillRoll}`;
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
          <p><strong>d100:</strong> ${d100Roll.total}${d100BonusExpr}${rarityFloorBonusExpr} + ${rarityRange.floor} = ${effectiveD100} (cap ${rarityRange.ceiling})</p>
          <p><strong>Crafter (50%):</strong> ${skillRollDisplay} × ${d100Pct.toFixed(2)} = ${crafterRoll} × 0.5 = ${crafterContribution}</p>
          ${profAugLine}
          <p><strong>Total Progress:</strong> ${materialContribution} + ${crafterContribution} + ${prepBonus}${progressBonus ? ` + (${progressBonus})` : ''} = <strong>${totalProgress}</strong></p>
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
}

export const CraftingSkillsMixin = {};
for (const name of Object.getOwnPropertyNames(CraftingSkills.prototype)) {
  if (name !== 'constructor') CraftingSkillsMixin[name] = CraftingSkills.prototype[name];
}
