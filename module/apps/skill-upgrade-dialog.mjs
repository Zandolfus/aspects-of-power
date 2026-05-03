/**
 * Skill Upgrade Dialog — per-upgrade choice between Specialization (clean
 * rarity bump) and Alteration (rarity bump + add a tag). Per the locked
 * design in design-skill-rarity-system.md:
 *
 *   - Each upgrade bumps rarity by one tier (the constant +0.1 mult).
 *   - Specialization keeps the skill clean — no new behavior.
 *   - Alteration adds an alteration tag (subtracts from effective mult,
 *     adds to base resource cost, grants the tag's capability).
 *   - The OG skill is preserved; upgrades create NEW skill items linked
 *     via `originalSkillId`. Lineage is linear forward, OG-only branching.
 *   - Stacking rules from CONFIG.ASPECTSOFPOWER.alterationTags[id].stacking:
 *       'multiple'    — multiple instances allowed
 *       'max_one'     — only one per skill
 *       'replace_aoe' — adding any AOE tag removes existing AOE tag(s)
 */

export class SkillUpgradeDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(skill, options = {}) {
    super(options);
    this.skill = skill;
    this.actor = skill.actor; // null if world/compendium item
    this.upgradeType = 'specialization'; // 'specialization' | 'alteration'
    this.selectedAlterationId = '';
  }

  static DEFAULT_OPTIONS = {
    id: 'skill-upgrade-{id}',
    classes: ['aspects-of-power', 'skill-upgrade-dialog'],
    position: { width: 540, height: 'auto' },
    window: { title: 'Upgrade Skill', resizable: true },
    actions: {
      confirm: SkillUpgradeDialog._onConfirm,
      cancel:  SkillUpgradeDialog._onCancel,
    },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/skill-upgrade-dialog.hbs' },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sc = CONFIG.ASPECTSOFPOWER;
    const order = sc.skillRarityOrder ?? [];

    const currentRarity = this.skill.system.rarity || 'common';
    const currentIdx = order.indexOf(currentRarity);
    const nextIdx = currentIdx + 1;
    const isMaxRarity = nextIdx >= order.length;
    const nextRarity = isMaxRarity ? null : order[nextIdx];

    const currentMult = sc.skillRarities?.[currentRarity]?.mult ?? 0.6;
    const nextMult = nextRarity ? (sc.skillRarities[nextRarity]?.mult ?? null) : null;

    const currentAlterations = this.skill.system.alterations || [];
    const currentAltIds = new Set(currentAlterations.map(a => a.id).filter(Boolean));

    // Available alterations + per-tag eligibility (max_one already-have → disabled)
    const availableAlts = Object.entries(sc.alterationTags ?? {}).map(([id, tag]) => {
      let disabled = false;
      let disabledReason = '';
      if (tag.stacking === 'max_one' && currentAltIds.has(id)) {
        disabled = true;
        disabledReason = 'Already added (max one per skill)';
      }
      return { id, ...tag, disabled, disabledReason, label: tag.label };
    });

    // Compute the "preview" of what the upgraded skill would look like
    let previewAlterations = [...currentAlterations];
    let previewTagDef = null;
    if (this.upgradeType === 'alteration' && this.selectedAlterationId) {
      previewTagDef = sc.alterationTags?.[this.selectedAlterationId];
      if (previewTagDef) {
        if (previewTagDef.stacking === 'replace_aoe') {
          previewAlterations = previewAlterations.filter(a => sc.alterationTags?.[a.id]?.category !== 'area');
        }
        previewAlterations = [...previewAlterations, { id: this.selectedAlterationId, params: {} }];
      }
    }
    const previewDmgMod  = previewAlterations.reduce((s, a) => s + (sc.alterationTags?.[a.id]?.dmgMod ?? 0), 0);
    const previewCostMod = previewAlterations.reduce((s, a) => s + (sc.alterationTags?.[a.id]?.costMod ?? 0), 0);
    const previewEffectiveMult = nextMult != null ? Math.max(0, nextMult + previewDmgMod) : null;

    context.skill = this.skill;
    context.ownedByActor = !!this.actor;
    context.actorName = this.actor?.name ?? null;
    context.currentRarityKey = currentRarity;
    context.currentRarityLabel = sc.skillRarities?.[currentRarity]?.label ?? currentRarity;
    context.currentMult = currentMult;
    context.nextRarityKey = nextRarity;
    context.nextRarityLabel = nextRarity ? (sc.skillRarities[nextRarity]?.label ?? nextRarity) : null;
    context.nextMult = nextMult;
    context.isMaxRarity = isMaxRarity;
    context.upgradeType = this.upgradeType;
    context.selectedAlterationId = this.selectedAlterationId;
    context.availableAlts = availableAlts;
    context.currentAlterations = currentAlterations.map(a => ({
      id: a.id,
      label: sc.alterationTags?.[a.id]?.label ?? a.id,
      dmgMod: sc.alterationTags?.[a.id]?.dmgMod ?? 0,
      costMod: sc.alterationTags?.[a.id]?.costMod ?? 0,
    }));
    context.previewAlterations = previewAlterations.map(a => ({
      id: a.id,
      label: sc.alterationTags?.[a.id]?.label ?? a.id,
    }));
    context.previewDmgMod = previewDmgMod;
    context.previewCostMod = previewCostMod;
    context.previewEffectiveMult = previewEffectiveMult;
    context.previewCostMultiplier = (1 + previewCostMod).toFixed(2);
    context.previewName = this._suggestName(nextRarity);
    context.canConfirm = this.actor && !isMaxRarity && (this.upgradeType === 'specialization' || this.selectedAlterationId);
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelectorAll('input[name="upgradeType"]').forEach(el => {
      el.addEventListener('change', async e => {
        this.upgradeType = e.target.value;
        if (this.upgradeType === 'specialization') this.selectedAlterationId = '';
        await this.render();
      });
    });
    root.querySelector('select[name="alterationId"]')?.addEventListener('change', async e => {
      this.selectedAlterationId = e.target.value;
      await this.render();
    });
  }

  /** Strip a trailing "(...)" suffix and re-append with the new rarity label. */
  _suggestName(nextRarity) {
    const sc = CONFIG.ASPECTSOFPOWER;
    if (!nextRarity) return this.skill.name;
    const base = this.skill.name.replace(/\s*\([^)]*\)\s*$/, '').trim() || this.skill.name;
    const label = sc.skillRarities?.[nextRarity]?.label
      ? game.i18n.localize(sc.skillRarities[nextRarity].label)
      : nextRarity;
    return `${base} (${label})`;
  }

  static async _onConfirm(_event, _target) {
    if (!this.actor) {
      ui.notifications.warn('Skill must be owned by an actor to upgrade.');
      return;
    }
    const sc = CONFIG.ASPECTSOFPOWER;
    const order = sc.skillRarityOrder ?? [];
    const currentRarity = this.skill.system.rarity || 'common';
    const currentIdx = order.indexOf(currentRarity);
    const nextIdx = currentIdx + 1;
    if (nextIdx >= order.length) {
      ui.notifications.warn('Skill is already at maximum rarity.');
      return;
    }
    const nextRarity = order[nextIdx];

    let newAlterations = [...(this.skill.system.alterations || [])];
    if (this.upgradeType === 'alteration') {
      if (!this.selectedAlterationId) {
        ui.notifications.warn('Select an alteration tag first.');
        return;
      }
      const altDef = sc.alterationTags?.[this.selectedAlterationId];
      if (!altDef) {
        ui.notifications.warn('Unknown alteration tag.');
        return;
      }
      if (altDef.stacking === 'max_one' && newAlterations.some(a => a.id === this.selectedAlterationId)) {
        ui.notifications.warn(`This skill already has ${game.i18n.localize(altDef.label)}.`);
        return;
      }
      if (altDef.stacking === 'replace_aoe') {
        newAlterations = newAlterations.filter(a => sc.alterationTags?.[a.id]?.category !== 'area');
      }
      newAlterations.push({ id: this.selectedAlterationId, params: {} });
    }

    // OG resolution: if this skill was itself created via upgrade, its
    // originalSkillId already points to the OG. Otherwise THIS skill IS the OG.
    const originalSkillId = this.skill.system.originalSkillId || this.skill.uuid;

    const sourceData = this.skill.toObject();
    delete sourceData._id;
    sourceData.system.rarity = nextRarity;
    sourceData.system.alterations = newAlterations;
    sourceData.system.originalSkillId = originalSkillId;
    sourceData.name = this._suggestName(nextRarity);

    const created = await Item.createDocuments([sourceData], { parent: this.actor });
    const newItem = created?.[0];
    if (!newItem) {
      ui.notifications.error('Failed to create upgraded skill.');
      return;
    }
    ui.notifications.info(`Created ${newItem.name} from ${this.skill.name}.`);
    this.close();
  }

  static async _onCancel(_event, _target) {
    this.close();
  }
}
