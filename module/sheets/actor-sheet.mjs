import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';

/**
 * Extend ActorSheetV2 with Aspects of Power-specific behaviour.
 * @extends {foundry.applications.sheets.ActorSheetV2}
 */
export class AspectsofPowerActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {

  static DEFAULT_OPTIONS = {
    classes: ['aspects-of-power', 'sheet', 'actor'],
    position: { width: 800, height: 800 },
    window: { resizable: true },
    form: { submitOnChange: true },
    tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'features' }],
  };

  // Each actor type maps to its own template file.
  static PARTS = {
    character: { template: 'systems/aspects-of-power/templates/actor/actor-character-sheet.hbs' },
    npc:       { template: 'systems/aspects-of-power/templates/actor/actor-npc-sheet.hbs' },
  };

  /** Render only the part that matches this actor's type. */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    options.parts = [this.actor.type];
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actorData = this.document.toObject(false);

    context.actor    = this.actor;
    context.system   = this.actor.system; // live instance preserves derived fields (e.g. ability.mod)
    context.flags    = actorData.flags;
    context.editable = this.isEditable;
    context.cssClass = this.isEditable ? 'editable' : 'locked';
    context.config = CONFIG.ASPECTSOFPOWER;
    context.items  = this.actor.items.map(i => i.toObject(false));

    if (actorData.type === 'character') {
      this._prepareItems(context);
      this._prepareCharacterData(context);
    }
    if (actorData.type === 'npc') {
      this._prepareItems(context);
    }

    context.enrichedBiography = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.actor.system.biography,
      {
        secrets:    this.document.isOwner,
        rollData:   this.actor.getRollData(),
        relativeTo: this.actor,
      }
    );
    context.rollData = this.actor.getRollData();
    context.effects  = prepareActiveEffectCategories(
      this.actor.allApplicableEffects()
    );

    return context;
  }

  /**
   * Character-specific context modifications.
   * @param {object} context The context object to mutate
   */
  _prepareCharacterData(context) {
    // Extend here for character-specific editor fields or derived data.
  }

  /**
   * Organise and classify Items for the Actor sheet.
   * @param {object} context The context object to mutate
   */
  _prepareItems(context) {
    const gear     = [];
    const features = [];
    const skills   = { Passive: [], Active: [] };

    for (const i of context.items) {
      i.img = i.img || Item.DEFAULT_ICON;
      if (i.type === 'item') {
        gear.push(i);
      } else if (i.type === 'feature') {
        features.push(i);
      } else if (i.type === 'skill') {
        if (i.system.skillType !== undefined) {
          skills[i.system.skillType].push(i);
        }
      }
    }

    context.gear     = gear;
    context.features = features;
    context.skills   = skills;
  }

  /* -------------------------------------------- */

  /**
   * Intercept form changes so that numeric fields are rounded and saved
   * immediately via a targeted document.update() call, bypassing the
   * full-form submit that can drop changes on fast re-renders.
   * @override
   */
  async _onChangeForm(formConfig, event) {
    const input = event.target;
    if (!input?.name) return super._onChangeForm(formConfig, event);

    if (input.type === 'number') {
      const raw = Number(input.value);
      if (!isNaN(raw) && isFinite(raw)) {
        await this.document.update({ [input.name]: Math.round(raw) });
        return;
      }
    }

    return super._onChangeForm(formConfig, event);
  }

  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // AppV2 stores DEFAULT_OPTIONS.tabs config but never instantiates the Tabs
    // widget — bind it manually on every render (PART HTML is replaced each time).
    // Restore the last active tab from tabGroups so submitOnChange re-renders
    // don't reset the user back to the default tab.
    const defaultTab = this.actor.type === 'npc' ? 'description' : 'features';
    const initial = this.tabGroups.primary ?? defaultTab;
    new foundry.applications.ux.Tabs({ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial })
      .bind(this.element);

    // Keep tabGroups in sync when the user clicks a tab.
    this.element.querySelectorAll('.sheet-tabs .item').forEach(el => {
      el.addEventListener('click', () => { this.tabGroups.primary = el.dataset.tab; });
    });

    // Item sheet open — available regardless of edit state.
    this.element.querySelectorAll('.item-edit').forEach(el => {
      el.addEventListener('click', ev => {
        const li   = ev.currentTarget.closest('.item');
        const item = this.actor.items.get(li.dataset.itemId);
        item.sheet.render(true);
      });
    });

    // Everything below requires the sheet to be editable.
    if (!this.isEditable) return;

    // AppV2 doesn't inherit AppV1's activateEditor() — wire up ProseMirror manually.
    this.element.querySelectorAll('.editor-edit').forEach(btn => {
      btn.addEventListener('click', async ev => {
        ev.preventDefault();
        const wrapper   = btn.closest('.editor');
        const contentEl = wrapper?.querySelector('.editor-content');
        if (!contentEl || wrapper.classList.contains('active')) return;
        wrapper.classList.add('active');
        btn.style.display = 'none';
        const fieldName  = contentEl.dataset.target ?? contentEl.dataset.fieldName ?? 'system.biography';
        const rawContent = foundry.utils.getProperty(this.document.toObject(), fieldName) ?? '';
        await foundry.applications.ux.ProseMirrorEditor.create(contentEl, rawContent, {
          document:  this.document,
          fieldName: fieldName,
        });

        // ProseMirrorEditor wraps the editable div in a new .editor-container sibling to
        // .editor-menu. Neither element has a definite CSS height from the flex chain, so
        // measure and set the container height explicitly.
        const menuEl      = wrapper.querySelector('.editor-menu');
        const containerEl = wrapper.querySelector('.editor-container');
        if (menuEl && containerEl) {
          const wrapperRect = wrapper.getBoundingClientRect();
          const available   = wrapperRect.height - menuEl.getBoundingClientRect().height;
          containerEl.style.width    = `${wrapperRect.width}px`;
          containerEl.style.height   = `${Math.max(200, available)}px`;
          containerEl.style.overflowY = 'auto';
        }
      });
    });

    // Add Inventory Item
    this.element.querySelectorAll('.item-create').forEach(el => {
      el.addEventListener('click', this._onItemCreate.bind(this));
    });

    // Delete Inventory Item
    this.element.querySelectorAll('.item-delete').forEach(el => {
      el.addEventListener('click', ev => {
        const li   = ev.currentTarget.closest('.item');
        const item = this.actor.items.get(li.dataset.itemId);
        item.delete();
        li.remove();
      });
    });

    // Active Effect management
    this.element.querySelectorAll('.effect-control').forEach(el => {
      el.addEventListener('click', ev => {
        const row      = ev.currentTarget.closest('li');
        const document = row.dataset.parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(row.dataset.parentId);
        onManageActiveEffect(ev, document);
      });
    });

    // Rollable abilities
    this.element.querySelectorAll('.rollable').forEach(el => {
      el.addEventListener('click', this._onRoll.bind(this));
    });

    // Drag events for macros
    if (this.actor.isOwner) {
      this.element.querySelectorAll('li.item').forEach(li => {
        if (li.classList.contains('inventory-header')) return;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', ev => {
          const itemId = li.dataset.itemId;
          const item   = this.actor.items.get(itemId);
          if (!item) return;
          ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'Item', uuid: item.uuid }));
        }, false);
      });
    }
  }

  /**
   * Handle creating a new Owned Item for the actor.
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    const type   = header.dataset.type;
    const data   = foundry.utils.deepClone(header.dataset);
    const name   = `New ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    const itemData = {
      name,
      type,
      system: data,
    };
    delete itemData.system['type'];
    return Item.create(itemData, { parent: this.actor });
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    if (dataset.rollType === 'item') {
      const itemId = element.closest('.item').dataset.itemId;
      const item   = this.actor.items.get(itemId);
      if (item) return item.roll();
    }

    if (dataset.roll) {
      const label = dataset.label ? `[ability] ${dataset.label}` : '';
      const roll  = new Roll(dataset.roll, this.actor.getRollData());
      roll.toMessage({
        speaker:  ChatMessage.getSpeaker({ actor: this.actor }),
        flavor:   label,
        rollMode: game.settings.get('core', 'rollMode'),
      });
      return roll;
    }
  }
}
