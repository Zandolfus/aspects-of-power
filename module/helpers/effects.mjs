/**
 * Manage Active Effect instances through an Actor or Item Sheet via effect control buttons.
 * @param {MouseEvent} event      The left-click event on the effect control
 * @param {Actor|Item} owner      The owning document which manages this effect
 */
export function onManageActiveEffect(event, owner) {
  event.preventDefault();
  const a = event.currentTarget;
  const li = a.closest('li');
  const effect = li.dataset.effectId
    ? owner.effects.get(li.dataset.effectId)
    : null;
  switch (a.dataset.action) {
    case 'create': {
      const sectionType = li.dataset.effectType;
      const isCategory = (sectionType === 'blessing' || sectionType === 'title');
      return owner.createEmbeddedDocuments('ActiveEffect', [
        {
          name: game.i18n.format('DOCUMENT.New', {
            type: game.i18n.localize('DOCUMENT.ActiveEffect'),
          }),
          img: 'icons/svg/aura.svg',
          origin: owner.uuid,
          'duration.rounds':
            sectionType === 'temporary' ? 1 : undefined,
          disabled: sectionType === 'inactive',
          flags: isCategory ? { aspectsofpower: { effectCategory: sectionType } } : {},
        },
      ]);
    }
    case 'edit':
      return effect.sheet.render(true);
    case 'delete':
      return effect.delete();
    case 'toggle':
      return effect.update({ disabled: !effect.disabled });
  }
}

/**
 * Prepare the data structure for Active Effects which are currently embedded in an Actor or Item.
 * @param {ActiveEffect[]} effects    A collection or generator of Active Effect documents to prepare sheet data for
 * @return {object}                   Data for rendering
 */
export function prepareActiveEffectCategories(effects) {
  // Define effect header categories
  const categories = {
    blessing: {
      type: 'blessing',
      label: game.i18n.localize('ASPECTSOFPOWER.Effect.Blessing'),
      effects: [],
    },
    title: {
      type: 'title',
      label: game.i18n.localize('ASPECTSOFPOWER.Effect.Title'),
      effects: [],
    },
    temporary: {
      type: 'temporary',
      label: game.i18n.localize('ASPECTSOFPOWER.Effect.Temporary'),
      effects: [],
    },
    passive: {
      type: 'passive',
      label: game.i18n.localize('ASPECTSOFPOWER.Effect.Passive'),
      effects: [],
    },
    inactive: {
      type: 'inactive',
      label: game.i18n.localize('ASPECTSOFPOWER.Effect.Inactive'),
      effects: [],
    },
  };

  // Iterate over active effects, classifying them into categories
  for (let e of effects) {
    const cat = e.flags?.aspectsofpower?.effectCategory;
    if (cat === 'blessing') {
      e.changeRows = _parseChangesForUI(e);
      e.showChanges = true;
      categories.blessing.effects.push(e);
    } else if (cat === 'title') {
      e.changeRows = _parseChangesForUI(e);
      e.showChanges = true;
      categories.title.effects.push(e);
    } else if (e.disabled) categories.inactive.effects.push(e);
    else if (e.isTemporary) categories.temporary.effects.push(e);
    else categories.passive.effects.push(e);
  }
  return categories;
}

/**
 * Convert an ActiveEffect's raw changes array into a UI-friendly row format
 * for inline editing on blessings/titles.
 * @param {ActiveEffect} effect
 * @returns {object[]} Array of { index, attribute, operation, displayValue }
 */
function _parseChangesForUI(effect) {
  const rows = [];
  for (let i = 0; i < effect.changes.length; i++) {
    const c = effect.changes[i];
    // Extract the buffable attribute key from the full change key.
    // e.g. "system.abilities.vitality.value" → "abilities.vitality"
    const attrMatch = c.key.match(/^system\.(.+)\.value$/);
    const attribute = attrMatch ? attrMatch[1] : c.key;
    const numVal = Number(c.value) || 0;

    let operation, displayValue;
    if (c.mode === 5) { // OVERRIDE
      operation = 'override';
      displayValue = numVal;
    } else if (c.mode === 1) { // MULTIPLY
      if (numVal > 0 && numVal < 1) {
        operation = 'divide';
        displayValue = numVal !== 0 ? Math.round((1 / numVal) * 100) / 100 : 1;
      } else {
        operation = 'multiply';
        displayValue = numVal;
      }
    } else { // ADD (mode 2) or fallback
      if (numVal < 0) {
        operation = 'subtract';
        displayValue = Math.abs(numVal);
      } else {
        operation = 'add';
        displayValue = numVal;
      }
    }

    rows.push({ index: i, attribute, operation, displayValue });
  }
  return rows;
}
