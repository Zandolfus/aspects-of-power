/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function () {
  return foundry.applications.handlebars.loadTemplates([
    // Actor partials.
    'systems/aspects-of-power/templates/actor/parts/actor-features.hbs',
    'systems/aspects-of-power/templates/actor/parts/actor-items.hbs',
    'systems/aspects-of-power/templates/actor/parts/actor-skills.hbs',
    'systems/aspects-of-power/templates/actor/parts/actor-effects.hbs',
    'systems/aspects-of-power/templates/actor/parts/actor-stats.hbs',
    // Item partials
    'systems/aspects-of-power/templates/item/parts/item-effects.hbs',
  ]);
};
