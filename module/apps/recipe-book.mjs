import { resolveIngredients, skillsFor } from '../systems/recipes.mjs';
import { derivedRecipeThreshold } from '../helpers/formulas.mjs';

/**
 * THE RECIPE BOOK — a profession window (ruled 2026-08-27: "something more
 * akin to WoW's UI: you open up a profession, there's searchability,
 * collapsibility, etc").
 *
 * The Items-tab shelf answered "do I own this", which is an inventory
 * question. This answers the crafting one: what can I make RIGHT NOW, what am
 * I short of, and make it. Those are different enough to deserve their own
 * window rather than another list on a tab.
 *
 * Shape: professions across the top, search below, collapsible categories in
 * the left list, and the selected formula on the right with its reagents
 * counted have/need against live inventory.
 *
 * ⚠ ALL VIEW STATE LIVES ON THE INSTANCE, not in the DOM. Every craft
 * re-renders the window (inventory changed), and a search box or an open
 * category that reset on each craft would make the thing unusable exactly
 * when it is being used most.
 */
export class RecipeBook extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.search = '';
    this.profession = null;      // null = first available
    this.selectedId = null;
    this.collapsed = new Set();  // category keys the user has folded away
  }

  static DEFAULT_OPTIONS = {
    id: 'aop-recipe-book-{id}',
    classes: ['aspects-of-power', 'recipe-book-app'],
    position: { width: 760, height: 560 },
    window: { title: 'Recipe Book', resizable: true },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/recipe-book.hbs' },
  };

  /** Everything the actor knows, decorated with what it needs and whether we have it. */
  _known() {
    const types = CONFIG.ASPECTSOFPOWER.craftItemTypes ?? {};
    return this.actor.items
      .filter(i => i.type === 'recipe')
      .map(r => {
        const bill = resolveIngredients(this.actor, r);
        const skills = skillsFor(this.actor, r);
        const typeKey = r.system.output?.typeKey || '';
        return {
          id: r.id,
          name: r.name,
          img: r.img,
          productName: r.system.output?.name || r.name,
          profession: r.system.profession || 'Unsorted',
          category: types[typeKey]?.category || 'other',
          typeKey,
          // Authored threshold wins; 0 means difficulty DERIVES from the
          // substances worked — so show what the bar would be against the
          // stock this crafter would actually reach for.
          threshold: (r.system.threshold ?? 0) > 0
            ? r.system.threshold
            : (bill.units.length ? derivedRecipeThreshold(bill.units, typeKey) : 0),
          thresholdDerived: (r.system.threshold ?? 0) <= 0,
          minMana: r.system.minMana ?? 0,
          discovered: r.system.source === 'discovered',
          discoveredBy: r.system.discoveredBy || '',
          requiresTags: r.system.requiresSkillTags ?? [],
          lines: bill.lines,
          ready: bill.ok && skills.length > 0,
          missing: bill.missing,
          skillId: skills[0]?.id ?? '',
          skillName: skills[0]?.name ?? '',
          // Searchable haystack: the product, the formula's own name, and
          // every reagent — looking up "gem" should find what eats gems, not
          // just what is called one.
          haystack: [r.name, r.system.output?.name, typeKey,
                     ...bill.lines.map(l => l.label)].filter(Boolean).join(' ').toLowerCase(),
        };
      });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const all = this._known();

    const professions = [...new Set(all.map(r => r.profession))].sort();
    if (!professions.includes(this.profession)) this.profession = professions[0] ?? null;

    const q = this.search.trim().toLowerCase();
    const shown = all
      .filter(r => r.profession === this.profession)
      .filter(r => !q || r.haystack.includes(q))
      .sort((a, b) => a.productName.localeCompare(b.productName));

    // Group into collapsible categories. A search that matches nothing in a
    // category hides the category outright rather than leaving an empty
    // header behind.
    const groups = new Map();
    for (const r of shown) {
      if (!groups.has(r.category)) groups.set(r.category, []);
      groups.get(r.category).push(r);
    }

    context.actorName = this.actor.name;
    context.search = this.search;
    context.professions = professions.map(p => ({
      key: p,
      label: p.charAt(0).toUpperCase() + p.slice(1),
      active: p === this.profession,
      count: all.filter(r => r.profession === p).length,
    }));
    context.groups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => ({
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        count: list.length,
        readyCount: list.filter(r => r.ready).length,
        open: !this.collapsed.has(key),
        recipes: list.map(r => ({ ...r, selected: r.id === this.selectedId })),
      }));
    // ⚠ CRAFTING A THING IS DOWNTIME, NOT AN INSTANT (professions-as-
    // activities). A craft skill carrying the `activity` tag DECLARES a block
    // on the clock and resolves when the clock reaches it — so clicking Craft
    // correctly produces no item yet. Live-tested 2026-08-27: the button
    // worked and the window said nothing, which reads exactly like a dead
    // button. Surface the block instead.
    const dt = this.actor.flags?.aspectsofpower?.downtime ?? null;
    context.busy = dt?.label ? { label: dt.label, display: dt.display } : null;

    context.hasAny = all.length > 0;
    context.hasShown = shown.length > 0;
    context.selected = shown.find(r => r.id === this.selectedId)
                    ?? all.find(r => r.id === this.selectedId)
                    ?? null;
    context.emptyReason = !all.length
      ? 'No recipes known yet. Improvise a combination that works, and the formula is yours.'
      : (q ? `Nothing in ${this.profession} matches "${this.search}".`
           : `No recipes filed under ${this.profession}.`);
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    root.querySelectorAll('[data-profession]').forEach(el => {
      el.addEventListener('click', () => {
        this.profession = el.dataset.profession;
        this.selectedId = null;
        this.render();
      });
    });

    // Live filtering, and the caret has to survive the re-render or typing
    // into the box fights the user for the cursor.
    const box = root.querySelector('.recipe-search');
    if (box) {
      box.addEventListener('input', () => {
        this.search = box.value;
        const pos = box.selectionStart;
        this.render().then(() => {
          const again = this.element.querySelector('.recipe-search');
          if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        });
      });
    }

    root.querySelectorAll('[data-recipe-id]').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedId = el.dataset.recipeId;
        this.render();
      });
    });

    root.querySelectorAll('details.recipe-category').forEach(el => {
      el.addEventListener('toggle', () => {
        const key = el.dataset.category;
        if (el.open) this.collapsed.delete(key); else this.collapsed.add(key);
      });
    });

    root.querySelector('.recipe-craft')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;                       // a double-click is a double craft
      const skill = this.actor.items.get(btn.dataset.skillId);
      const recipeId = btn.dataset.recipeId;
      if (!skill) return;
      // Straight through the normal roll path so the skill still pays its own
      // costs and timing; `preRecipeId` only skips the mode and picker
      // dialogs the book has already answered.
      //
      // ⚠ executeDeferred: in an ACTIVE combat a plain roll() DECLARES and
      // never settles until the clock advances — no dialog, no error, just a
      // button that appears dead. Crafting is downtime work and should run
      // now; out of combat this changes nothing.
      await skill.roll({ preRecipeId: recipeId, executeDeferred: true });
      this.render();                              // inventory moved, or a block was declared
      // A craft skill tagged `activity` declares downtime instead of
      // resolving now. Say so out loud — the window alone is too quiet for
      // "your smith is booked for the next forty minutes".
      const dt = this.actor.flags?.aspectsofpower?.downtime;
      if (dt?.label) {
        ui.notifications?.info(`${this.actor.name} begins ${dt.label} (${dt.display}).`);
      }
    });
  }
}
