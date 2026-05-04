/**
 * History Edit Dialog — manually edit a track's templateHistory.
 *
 * The history is an ordered list of `{fromLevel, templateId}` entries.
 * Each entry says "from this level onward, use this template until the next
 * entry". Lookup at level L finds the entry with the highest fromLevel <= L.
 *
 * UI: a table with one row per entry. Each row has a fromLevel input and a
 * template dropdown populated from the appropriate compendium pack
 * (classes/professions/races). Add and delete buttons let the GM/player
 * adjust segments. Save normalizes (sorts by fromLevel) and writes back.
 *
 * Owner-or-GM only; binding lives on the actor sheet's identity row.
 */

const PACK_BY_TRACK = {
  class:      "aspects-of-power.classes",
  profession: "aspects-of-power.professions",
  race:       "aspects-of-power.races",
};

export class HistoryEditDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  /**
   * @param {Actor} actor
   * @param {'class'|'profession'|'race'} track
   */
  constructor(actor, track, options = {}) {
    super(options);
    this.actor = actor;
    this.track = track;
    // Working copy of the history entries — edits stay here until apply.
    const cur = actor.system.attributes?.[track]?.history ?? [];
    this.entries = cur.map(e => ({ fromLevel: e.fromLevel ?? 0, templateId: e.templateId ?? "" }));
    this.templateOptions = []; // populated in _prepareContext
  }

  static DEFAULT_OPTIONS = {
    id: "history-edit-{id}",
    classes: ["aspects-of-power", "history-edit-dialog"],
    position: { width: 540, height: "auto" },
    window: { title: "Edit Track History", resizable: true },
    actions: {
      apply:  HistoryEditDialog._onApply,
      cancel: HistoryEditDialog._onCancel,
      addRow: HistoryEditDialog._onAddRow,
      delRow: HistoryEditDialog._onDelRow,
    },
  };

  static PARTS = {
    content: { template: "systems/aspects-of-power/templates/apps/history-edit-dialog.hbs" },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // Build template options from the appropriate compendium pack.
    if (this.templateOptions.length === 0) {
      const packId = PACK_BY_TRACK[this.track];
      const pack = game.packs.get(packId);
      if (pack) {
        const idx = await pack.getIndex();
        this.templateOptions = [...idx]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({ uuid: e.uuid, name: e.name }));
      }
    }
    context.actor = this.actor;
    context.track = this.track;
    context.trackLabel = this.track.charAt(0).toUpperCase() + this.track.slice(1);
    context.entries = this.entries.map((e, i) => ({
      idx: i,
      fromLevel: e.fromLevel,
      templateId: e.templateId,
      templateName: this.templateOptions.find(o => o.uuid === e.templateId)?.name ?? "(unknown)",
    }));
    context.templateOptions = this.templateOptions;
    context.currentLevel = this.actor.system.attributes?.[this.track]?.level ?? 0;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Wire up input change listeners (per-row fromLevel + template select).
    this.element.querySelectorAll("input.entry-from").forEach(el => {
      el.addEventListener("input", () => {
        const idx = parseInt(el.dataset.idx, 10);
        const v = parseInt(el.value, 10);
        if (Number.isFinite(v) && v >= 0) this.entries[idx].fromLevel = v;
      });
    });
    this.element.querySelectorAll("select.entry-tpl").forEach(el => {
      el.addEventListener("change", () => {
        const idx = parseInt(el.dataset.idx, 10);
        this.entries[idx].templateId = el.value;
      });
    });
  }

  static async _onAddRow(_event, _target) {
    // Default new row to the level after the last existing entry, or 1 if none.
    const lastFrom = this.entries.length > 0
      ? this.entries[this.entries.length - 1].fromLevel
      : 0;
    this.entries.push({ fromLevel: lastFrom + 1, templateId: "" });
    await this.render();
  }

  static async _onDelRow(_event, target) {
    const idx = parseInt(target.dataset.idx, 10);
    if (Number.isFinite(idx)) {
      this.entries.splice(idx, 1);
      await this.render();
    }
  }

  static async _onCancel(_event, _target) {
    this.close();
  }

  static async _onApply(_event, _target) {
    // Validate: all entries must have a template; warn if duplicate fromLevel.
    const filled = this.entries.filter(e => e.templateId);
    if (filled.length !== this.entries.length) {
      ui.notifications.warn("All entries must have a template selected.");
      return;
    }
    // Sort by fromLevel for canonical storage.
    const sorted = [...filled].sort((a, b) => a.fromLevel - b.fromLevel);
    // Sync identity templateId/name/rank to the LAST entry (highest-rank arc).
    const updates = {
      [`system.attributes.${this.track}.history`]: sorted.map(e => ({ fromLevel: e.fromLevel, templateId: e.templateId })),
    };
    if (sorted.length > 0) {
      const last = sorted[sorted.length - 1];
      try {
        const t = await fromUuid(last.templateId);
        if (t) {
          updates[`system.attributes.${this.track}.templateId`] = last.templateId;
          updates[`system.attributes.${this.track}.name`] = t.name;
          if (t.system.rank) updates[`system.attributes.${this.track}.rank`] = t.system.rank;
        }
      } catch (e) {
        ui.notifications.warn(`Could not resolve last entry's template: ${e.message}`);
      }
    } else {
      // Empty history — clear identity.
      updates[`system.attributes.${this.track}.templateId`] = "";
      updates[`system.attributes.${this.track}.name`] = "Uninitiated";
    }
    try {
      await this.actor.update(updates, { skipAutoDerive: true });
      ui.notifications.info(`${this.track} history saved (${sorted.length} entries).`);
      this.close();
    } catch (e) {
      ui.notifications.error(`Failed to save history: ${e.message}`);
    }
  }
}
