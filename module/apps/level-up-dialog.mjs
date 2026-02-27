/**
 * Level-up dialog — allows players to level race/class/profession,
 * preview stat gains from the assigned template, and allocate free points.
 */
export class LevelUpDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.selectedType = null;
    this.allocation = {};
    for (const key of Object.keys(CONFIG.ASPECTSOFPOWER.abilities)) {
      this.allocation[key] = 0;
    }
  }

  static DEFAULT_OPTIONS = {
    id: 'level-up-dialog-{id}',
    classes: ['aspects-of-power', 'level-up-dialog'],
    position: { width: 540, height: 'auto' },
    window: { title: 'ASPECTSOFPOWER.Level.dialogTitle', resizable: true },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/level-up-dialog.hbs' },
  };

  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;
    const types = ['race', 'class', 'profession'];

    context.actor = this.actor;
    context.types = await Promise.all(types.map(async type => {
      const attr = sys.attributes[type];
      const templateItem = attr.templateId ? await fromUuid(attr.templateId) : null;
      const currentRank = CONFIG.ASPECTSOFPOWER.getRankForLevel(attr.level);
      const nextLevel = attr.level + 1;
      const nextRank = CONFIG.ASPECTSOFPOWER.getRankForLevel(nextLevel);
      const rankChanged = currentRank !== nextRank;

      let gains = null;
      let freePointsGained = 0;
      if (templateItem) {
        if (['class', 'profession'].includes(type)) {
          // Class/profession items are rank-specific: single gains object + single free points value.
          gains = templateItem.system.gains ?? {};
          freePointsGained = templateItem.system.freePointsPerLevel ?? 0;
        } else {
          // Race items have per-rank gains.
          gains = templateItem.system.rankGains?.[nextRank] ?? {};
          freePointsGained = templateItem.system.freePointsPerLevel?.[nextRank] ?? 0;
        }
      }

      return {
        type,
        label: game.i18n.localize(CONFIG.ASPECTSOFPOWER.levelTypes[type]),
        currentLevel: attr.level,
        currentRank,
        nextLevel,
        nextRank,
        rankChanged,
        hasTemplate: !!templateItem,
        templateName: templateItem?.name ?? game.i18n.localize('ASPECTSOFPOWER.Level.noTemplate'),
        gains,
        freePointsGained,
      };
    });

    context.selectedType = this.selectedType;
    context.currentFreePoints = sys.freePoints ?? 0;
    context.allocation = this.allocation;

    const abilityKeys = Object.keys(CONFIG.ASPECTSOFPOWER.abilities);
    context.abilityKeys = abilityKeys;

    if (this.selectedType) {
      const sel = context.types.find(t => t.type === this.selectedType);
      context.selectedTypeData = sel;
      context.totalFreePoints = (sys.freePoints ?? 0) + (sel?.freePointsGained ?? 0);
      context.allocatedPoints = Object.values(this.allocation).reduce((s, v) => s + v, 0);
      context.remainingPoints = context.totalFreePoints - context.allocatedPoints;

      // Build stat gain rows for the preview table.
      context.gainRows = abilityKeys.map(key => {
        const templateGain = sel?.gains?.[key] ?? 0;
        const freeGain = this.allocation[key] ?? 0;
        return {
          key,
          label: game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[key]),
          templateGain,
          freeGain,
          total: templateGain + freeGain,
        };
      });
    }

    return context;
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    // Type selection buttons.
    this.element.querySelectorAll('.level-type-select').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedType = el.dataset.type;
        for (const key of Object.keys(CONFIG.ASPECTSOFPOWER.abilities)) {
          this.allocation[key] = 0;
        }
        this.render();
      });
    });

    // Free point allocation inputs.
    this.element.querySelectorAll('.free-point-input').forEach(el => {
      el.addEventListener('change', () => {
        const key = el.dataset.ability;
        this.allocation[key] = Math.max(0, Math.round(Number(el.value) || 0));
        this.render();
      });
    });

    // Confirm button.
    this.element.querySelector('.level-up-confirm')?.addEventListener('click', () => {
      this._applyLevelUp();
    });

    // Back button.
    this.element.querySelector('.level-up-back')?.addEventListener('click', () => {
      this.selectedType = null;
      this.render();
    });
  }

  /* -------------------------------------------- */

  async _applyLevelUp() {
    if (!this.selectedType) return;

    const sys = this.actor.system;
    const attr = sys.attributes[this.selectedType];
    const templateItem = attr.templateId ? await fromUuid(attr.templateId) : null;
    if (!templateItem) {
      ui.notifications.warn(game.i18n.localize('ASPECTSOFPOWER.Level.noTemplate'));
      return;
    }

    const nextLevel = attr.level + 1;
    const nextRank = CONFIG.ASPECTSOFPOWER.getRankForLevel(nextLevel);
    const currentRank = CONFIG.ASPECTSOFPOWER.getRankForLevel(attr.level);
    let gains, freePointsGained;
    if (['class', 'profession'].includes(this.selectedType)) {
      gains = templateItem.system.gains ?? {};
      freePointsGained = templateItem.system.freePointsPerLevel ?? 0;
    } else {
      gains = templateItem.system.rankGains?.[nextRank] ?? {};
      freePointsGained = templateItem.system.freePointsPerLevel?.[nextRank] ?? 0;
    }

    // Validate allocation.
    const totalFree = (sys.freePoints ?? 0) + freePointsGained;
    const allocated = Object.values(this.allocation).reduce((s, v) => s + v, 0);
    if (allocated > totalFree) {
      ui.notifications.warn('Too many free points allocated!');
      return;
    }

    // Build the update object.
    const updates = {};
    updates[`system.attributes.${this.selectedType}.level`] = nextLevel;

    const abilityKeys = Object.keys(CONFIG.ASPECTSOFPOWER.abilities);
    for (const key of abilityKeys) {
      const templateGain = gains[key] ?? 0;
      const freeGain = this.allocation[key] ?? 0;
      const totalGain = templateGain + freeGain;
      if (totalGain !== 0) {
        const currentBase = this.actor._source.system.abilities[key].value;
        updates[`system.abilities.${key}.value`] = currentBase + totalGain;
      }
    }

    updates['system.freePoints'] = totalFree - allocated;

    await this.actor.update(updates);

    // Chat message.
    const typeLabel = game.i18n.localize(CONFIG.ASPECTSOFPOWER.levelTypes[this.selectedType]);
    const rankChanged = currentRank !== nextRank;
    const gainSummary = abilityKeys
      .map(k => {
        const tg = gains[k] ?? 0;
        const fg = this.allocation[k] ?? 0;
        const total = tg + fg;
        if (total === 0) return null;
        return `${game.i18n.localize(CONFIG.ASPECTSOFPOWER.abilities[k])} +${total}`;
      })
      .filter(Boolean)
      .join(', ');

    let content = `<div class="level-up-message">
      <h3>${this.actor.name} levelled up!</h3>
      <p><strong>${typeLabel}</strong>: Level ${attr.level} &rarr; ${nextLevel} (Rank ${nextRank})</p>`;
    if (rankChanged) {
      content += `<p class="rank-up-notice"><strong>${game.i18n.localize('ASPECTSOFPOWER.Level.rankBreakpoint')}</strong> ${currentRank} &rarr; ${nextRank}</p>`;
    }
    if (gainSummary) {
      content += `<p>Stat gains: ${gainSummary}</p>`;
    }
    if (freePointsGained > 0) {
      content += `<p>Free points gained: ${freePointsGained}</p>`;
    }
    const remaining = totalFree - allocated;
    if (remaining > 0) {
      content += `<p>Unspent free points: ${remaining}</p>`;
    }
    content += `</div>`;

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
    });

    this.close();
  }
}
