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
    position: { width: 800, height: 600 },
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

    context.system = this.actor.system; // live instance preserves derived fields (e.g. ability.mod)
    context.flags  = actorData.flags;
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

  /** @override */
  _onRender(context, options) {
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
      const handler = ev => this._onDragStart(ev);
      this.element.querySelectorAll('li.item').forEach(li => {
        if (li.classList.contains('inventory-header')) return;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', handler, false);
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
