/**
 * Skill creation presets — the create-time archetype picker.
 *
 * Creating a fresh skill offers one dialog: pick what KIND of skill this is
 * (Strike, Bolt, Buff, Reaction...) and the preset writes skill type, tags,
 * roll config and family defaults from CONFIG.ASPECTSOFPOWER.skillPresets.
 * The sheet then opens showing exactly the sections that matter. Presets are
 * starting points, not constraints — everything stays editable.
 *
 * The offer fires ONLY for a blank, freshly-named skill created by THIS
 * client (createItem fires on every connected client), so bulk grants,
 * template clones, upgrade-lineage copies and migration scripts — which all
 * carry real names or content — never see the dialog.
 */
export class SkillPresets {

  /** Register the create-time hook. Called once from the system init hook. */
  static initialize() {
    Hooks.on('createItem', (item, _options, userId) => {
      if (userId !== game.user.id) return;
      if (item.type !== 'skill') return;
      if (!this.isBlank(item)) return;
      // Fire-and-forget: the sheet is opening in parallel; the picker sits on
      // top of it and the update re-renders underneath.
      this.offer(item);
    });
  }

  /**
   * A skill is "blank" when it still carries the default creation name and
   * no authored content. Name check is deliberate: it is what separates a
   * hand-created skill from a script-created or cloned one.
   */
  static isBlank(item) {
    const sys = item.system ?? {};
    return (sys.tags ?? []).length === 0
      && !sys.description
      && /^new skill/i.test(item.name ?? '');
  }

  /** Show the archetype picker and apply the chosen preset. */
  static async offer(item) {
    const presets = CONFIG.ASPECTSOFPOWER.skillPresets ?? {};
    const keys = Object.keys(presets);
    if (!keys.length) return;

    // Group options the way the config authors them.
    const groups = {};
    for (const key of keys) {
      const p = presets[key];
      (groups[p.group ?? 'Other'] ??= []).push({ key, ...p });
    }
    const optionsHtml = Object.entries(groups).map(([group, entries]) =>
      `<optgroup label="${group}">` + entries.map(e =>
        `<option value="${e.key}">${e.label}</option>`).join('') + '</optgroup>'
    ).join('');
    const hintsJson = JSON.stringify(Object.fromEntries(
      keys.map(k => [k, presets[k].hint ?? ''])));

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `What kind of skill is ${item.name}?` },
      position: { width: 420 },
      content: `
        <form class="skill-preset-picker">
          <p class="hint" style="font-size:11px;color:#888;margin:0 0 6px;">
            A preset sets the skill type, tags and family defaults so the sheet
            opens showing only what matters. Everything stays editable.</p>
          <select name="preset" style="width:100%;">${optionsHtml}</select>
          <p class="hint skill-preset-hint" style="font-size:11px;color:#aaa;min-height:2.2em;margin:6px 0 0;"></p>
          <script type="application/json" class="skill-preset-hints">${hintsJson}</script>
        </form>`,
      render: (_event, dialog) => {
        const root = dialog?.element ?? dialog;
        const sel = root.querySelector('select[name="preset"]');
        const hintEl = root.querySelector('.skill-preset-hint');
        const hints = JSON.parse(root.querySelector('.skill-preset-hints')?.textContent ?? '{}');
        const sync = () => { if (hintEl) hintEl.textContent = hints[sel.value] ?? ''; };
        sel?.addEventListener('change', sync);
        sync();
      },
      buttons: [{
        action: 'apply', label: 'Apply', icon: 'fas fa-check', default: true,
        callback: (_event, button, dialog) => {
          const root = dialog?.element ?? button.form ?? null;
          return root?.querySelector('select[name="preset"]')?.value ?? 'blank';
        },
      }, {
        action: 'blank', label: 'Start Blank',
      }],
      close: () => null,
    });

    if (choice === null || choice === 'blank') return;
    const preset = presets[choice];
    if (!preset?.data) return;
    // The document may have been deleted while the dialog sat open.
    const collection = item.parent ? item.parent.items : game.items;
    if (!collection.has(item.id)) return;
    await item.update(foundry.utils.deepClone(preset.data));
  }
}
