/**
 * Player Re-Leveler — wizard that lets a player reset their levels and
 * abilities to a chosen base, then auto-walk class/profession to target
 * levels with a template-picker prompt at each rank boundary. Race level
 * is auto-derived for threefold-path races; explicit input for twofold
 * and onefold.
 *
 * Built atop the engine in ../systems/mass-leveler.mjs (`applyTrackLevels`),
 * which halts at rank boundaries — this dialog wraps that halt with a
 * template picker and continues until the target is reached.
 *
 * Per design-mass-level-system.md and pending-stat-migration.md Phase 7.
 */

import { applyTrackLevels } from '../systems/mass-leveler.mjs';

const ABILITY_KEYS = [
  'vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception',
];

const PATH_TAGS = ['onefold-path', 'twofold-path', 'threefold-path'];

export class PlayerRelevelDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.step = 'baseStats';
    this.baseStats = Object.fromEntries(ABILITY_KEYS.map(k => [k, 5]));
    this.targets = { class: 0, profession: 0, race: 0 };
    this.pathType = 'threefold-path'; // resolved in _initRaceContext
    this.raceTemplateName = '';
    this.allowRaceChange = false;     // opt-in: pause at each rank boundary to optionally swap race
    // Starting race for the walk. Defaults to the actor's current race
    // templateId, but the player can override in step 2 if they actually
    // started as a different race that evolved into the current one.
    this.startingRaceId = this.actor.system.attributes?.race?.templateId ?? '';
    this.availableRaces = [];         // populated by _initRaceContext
    this.runState = null;     // populated during 'run' step
    this.runResults = null;   // populated when run completes
    this._initRaceContext();
  }

  static DEFAULT_OPTIONS = {
    id: 'player-releveler-{id}',
    classes: ['aspects-of-power', 'player-releveler'],
    position: { width: 560, height: 'auto' },
    window: { title: 'Re-Level Character', resizable: true },
    actions: {
      next:         PlayerRelevelDialog._onNext,
      back:         PlayerRelevelDialog._onBack,
      run:          PlayerRelevelDialog._onRun,
      pickTemplate: PlayerRelevelDialog._onPickTemplate,
      cancel:       PlayerRelevelDialog._onCancel,
      close:        PlayerRelevelDialog._onClose,
    },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/player-releveler-dialog.hbs' },
  };

  /* ---------- init helpers ---------- */

  async _initRaceContext() {
    // Build the full list of race templates the player can pick as starting race.
    this.availableRaces = await this._findTemplatesByRank('race', null);

    // Resolve the path-type + display name from the currently-selected starting race.
    const targetId = this.startingRaceId || this.actor.system.attributes?.race?.templateId;
    if (!targetId) {
      this.pathType = 'threefold-path';
      this.raceTemplateName = '';
      return;
    }
    let raceTemplate;
    try { raceTemplate = await fromUuid(targetId); } catch (e) { /* unavailable */ }
    if (!raceTemplate) return;
    this.raceTemplateName = raceTemplate.name;
    // Prefer the unified `tags` field; fall back to legacy `systemTags` for
    // pre-migration data (transitional — will be removed when systemTags is dropped).
    const tagIds = [
      ...(raceTemplate.system.tags ?? []),
      ...(raceTemplate.system.systemTags ?? []).map(t => t.id),
    ];
    for (const p of PATH_TAGS) {
      if (tagIds.includes(p)) { this.pathType = p; return; }
    }
    this.pathType = 'threefold-path';
  }

  get raceIsDerived() { return this.pathType === 'threefold-path'; }

  get derivedRaceLevel() {
    return Math.floor((Number(this.targets.class) + Number(this.targets.profession)) / 2);
  }

  /* ---------- context for template ---------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // Race init is fire-and-forget in the constructor (can't be async). If it
    // hasn't populated by first render, await it now.
    if (!this.availableRaces.length || !this.raceTemplateName) {
      await this._initRaceContext();
    }

    const sys = this.actor.system;
    const currentValues = Object.fromEntries(
      ABILITY_KEYS.map(k => [k, sys.abilities?.[k]?.value ?? 5])
    );

    context.actor = this.actor;
    context.step  = this.step;
    context.abilityKeys = ABILITY_KEYS;
    context.baseStats   = this.baseStats;
    context.currentValues = currentValues;
    context.currentLevels = {
      class:      sys.attributes?.class?.level      ?? 0,
      profession: sys.attributes?.profession?.level ?? 0,
      race:       sys.attributes?.race?.level       ?? 0,
    };
    context.targets = this.targets;
    context.pathType        = this.pathType;
    context.raceIsDerived   = this.raceIsDerived;
    context.raceTemplateName = this.raceTemplateName || '(none assigned)';
    context.derivedRaceLevel = this.raceIsDerived ? this.derivedRaceLevel : null;
    context.targetRaceFinal = this.raceIsDerived ? this.derivedRaceLevel : Number(this.targets.race);
    context.allowRaceChange = this.allowRaceChange;
    context.startingRaceId  = this.startingRaceId;
    context.availableRaces  = this.availableRaces;

    // Run-step extras
    if (this.step === 'run') {
      context.runState = this.runState ?? { logLines: ['Initializing…'] };
    }
    if (this.step === 'summary') {
      context.results = this.runResults ?? {};
    }

    return context;
  }

  /* ---------- form change handler (free-form input bindings) ---------- */

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    // Wire numeric inputs to our state.
    root.querySelectorAll('input[name^="base."]').forEach(el => {
      el.addEventListener('input', () => {
        const key = el.name.slice('base.'.length);
        const v = parseInt(el.value, 10);
        this.baseStats[key] = Number.isFinite(v) && v >= 0 ? v : 0;
      });
    });
    root.querySelectorAll('input[name^="target."]').forEach(el => {
      el.addEventListener('input', () => {
        const key = el.name.slice('target.'.length);
        const v = parseInt(el.value, 10);
        this.targets[key] = Number.isFinite(v) && v >= 0 ? v : 0;
        // Live-update derived race display when class/prof change.
        if (this.raceIsDerived && (key === 'class' || key === 'profession')) {
          const display = root.querySelector('.derived-race-level');
          if (display) display.textContent = this.derivedRaceLevel;
        }
      });
    });
    root.querySelector('input[name="allowRaceChange"]')?.addEventListener('change', e => {
      this.allowRaceChange = e.target.checked;
    });
    root.querySelector('select[name="startingRaceId"]')?.addEventListener('change', async e => {
      this.startingRaceId = e.target.value;
      // Re-resolve path-type / display name; this can flip the derived-vs-explicit race target UI.
      await this._initRaceContext();
      await this.render();
    });
  }

  /* ---------- navigation ---------- */

  static async _onNext(_event, _target) {
    if (this.step === 'baseStats') this.step = 'targets';
    else if (this.step === 'targets') this.step = 'confirm';
    await this.render();
  }

  static async _onBack(_event, _target) {
    if (this.step === 'targets')      this.step = 'baseStats';
    else if (this.step === 'confirm') this.step = 'targets';
    else if (this.step === 'summary') this.step = 'confirm';
    await this.render();
  }

  static async _onCancel(_event, _target) {
    this.close();
  }

  static async _onClose(_event, _target) {
    this.close();
  }

  /* ---------- the run flow ---------- */

  static async _onRun(_event, _target) {
    this.step = 'run';
    this.runState = { logLines: ['Resetting actor…'], waitingForPick: null };
    await this.render();

    try {
      await this._reset();
      this.runState.logLines.push('Reset complete. Walking levels…');
      await this.render();

      // Class
      await this._walkTrack('class', this.targets.class);
      // Profession
      await this._walkTrack('profession', this.targets.profession);
      // Race
      const raceTarget = this.raceIsDerived ? this.derivedRaceLevel : Number(this.targets.race);
      await this._walkTrack('race', raceTarget);

      // Build summary
      this.runResults = this._buildSummary();
      this.step = 'summary';
      this.runState = null;
      await this.render();
    } catch (e) {
      console.error('Re-level failed:', e);
      ui.notifications.error(`Re-level failed: ${e.message}`);
      this.runState.logLines.push(`ERROR: ${e.message}`);
      await this.render();
    }
  }

  /**
   * Reset the actor: zero levels for all three tracks, set abilities to the
   * player-entered base, clear freePoints, clear class/profession templateIds
   * (race templateId preserved — same race, just re-leveled from 0).
   */
  async _reset() {
    // Capture baseline pre-reset values for the summary diff.
    this._preResetSnapshot = {
      class:      this.actor.system.attributes?.class?.level      ?? 0,
      profession: this.actor.system.attributes?.profession?.level ?? 0,
      race:       this.actor.system.attributes?.race?.level       ?? 0,
      freePoints: this.actor.system.freePoints ?? 0,
      abilities:  Object.fromEntries(
        ABILITY_KEYS.map(k => [k, this.actor.system.abilities?.[k]?.value ?? 0])
      ),
    };

    const updates = {
      'system.attributes.class.level':      0,
      'system.attributes.class.templateId': '',
      'system.attributes.class.name':       '',
      'system.attributes.class.cachedTags': [],
      'system.attributes.class.history':    [],
      'system.attributes.profession.level':      0,
      'system.attributes.profession.templateId': '',
      'system.attributes.profession.name':       '',
      'system.attributes.profession.cachedTags': [],
      'system.attributes.profession.history':    [],
      'system.attributes.race.level':       0,
      'system.attributes.race.history':     [],
      'system.freePoints': 0,
    };
    // Set race templateId to the player-chosen starting race (defaults to current).
    // Also refresh name + cachedTags from that race template so equipment/feature
    // tag resolution stays correct after the swap.
    if (this.startingRaceId) {
      let raceTemplate = null;
      try { raceTemplate = await fromUuid(this.startingRaceId); } catch (e) { /* unavailable */ }
      updates['system.attributes.race.templateId'] = this.startingRaceId;
      // Seed race history: the starting race covers from level 1 onward (race
      // level starts at 0; the first level the walker adds is 1).
      updates['system.attributes.race.history'] = [{ fromLevel: 1, templateId: this.startingRaceId }];
      if (raceTemplate) {
        updates['system.attributes.race.name']       = raceTemplate.name;
        // Cache the unified tags array as `[{id, value:0}]` for back-compat
        // with the cachedTags structured schema. systemTags fallback preserved.
        const tagIds = [
          ...(raceTemplate.system.tags ?? []),
          ...(raceTemplate.system.systemTags ?? []).map(t => t.id),
        ];
        updates['system.attributes.race.cachedTags'] = tagIds.map(id => ({ id, value: 0 }));
      }
    }
    for (const k of ABILITY_KEYS) {
      updates[`system.abilities.${k}.value`] = this.baseStats[k] ?? 5;
    }
    await this.actor.update(updates);
  }

  /**
   * Walk a track up to the target level, calling applyTrackLevels in a loop
   * and pausing for a template pick whenever it halts at a rank boundary.
   *
   * For race specifically, when `allowRaceChange` is enabled, the walk is
   * segmented per rank — at each rank threshold we pause and offer an
   * optional race template swap before continuing.
   *
   * @param {'class'|'profession'|'race'} track
   * @param {number} targetLevel
   */
  async _walkTrack(track, targetLevel) {
    if (track === 'race' && this.allowRaceChange) {
      return this._walkRaceWithBoundaryPrompts(targetLevel);
    }
    let safetyCounter = 0;
    while (true) {
      if (++safetyCounter > 50) throw new Error(`${track} walk exceeded safety counter`);

      const cur = this.actor.system.attributes?.[track]?.level ?? 0;
      const remaining = targetLevel - cur;
      if (remaining <= 0) return;

      // If no template assigned for this track, prompt before applying.
      const templateId = this.actor.system.attributes?.[track]?.templateId;
      if (!templateId) {
        const nextLevel = cur + 1;
        const neededRank = CONFIG.ASPECTSOFPOWER.getRankForLevel(nextLevel);
        await this._promptTemplatePick(track, neededRank, nextLevel);
        continue; // re-loop to re-check templateId (which is now set) and proceed
      }

      const result = await applyTrackLevels(this.actor, track, remaining);
      this.runState.logLines.push(
        `${track}: applied ${result.applied}/${remaining} (now level ${cur + result.applied})`
      );
      await this.render();

      if (result.applied >= remaining) return; // done with this track
      if (result.halted && result.reason) {
        // Halted at rank boundary — clear the now-wrong templateId and prompt.
        const newCur = this.actor.system.attributes?.[track]?.level ?? 0;
        const nextLevel = newCur + 1;
        const neededRank = CONFIG.ASPECTSOFPOWER.getRankForLevel(nextLevel);
        await this.actor.update({ [`system.attributes.${track}.templateId`]: '' });
        await this._promptTemplatePick(track, neededRank, nextLevel);
      } else if (result.applied === 0) {
        throw new Error(`${track} walk made no progress: ${result.reason ?? 'unknown'}`);
      }
    }
  }

  /**
   * Walk race in per-rank segments. After each segment that lands at the top
   * of a rank with more target above it, prompt the player for an optional
   * race template swap before continuing. "Keep current" is always offered.
   */
  async _walkRaceWithBoundaryPrompts(targetLevel) {
    const sc = CONFIG.ASPECTSOFPOWER;
    let safety = 0;
    while (true) {
      if (++safety > 50) throw new Error('race walk exceeded safety counter');

      const cur = this.actor.system.attributes?.race?.level ?? 0;
      if (cur >= targetLevel) return;

      const nextLevel = cur + 1;
      const nextRank  = sc.getRankForLevel(nextLevel);
      const tier      = sc.rankTiers[nextRank];
      const segmentMax = Math.min(targetLevel, tier.max);
      const segmentSize = segmentMax - cur;

      // Need a template before applying.
      if (!this.actor.system.attributes?.race?.templateId) {
        await this._promptTemplatePick('race', nextRank, nextLevel);
        continue;
      }

      const result = await applyTrackLevels(this.actor, 'race', segmentSize);
      this.runState.logLines.push(
        `race: applied ${result.applied}/${segmentSize} (now level ${cur + result.applied}, rank ${nextRank})`
      );
      await this.render();

      // Halted mid-segment (template lacked rankGains for this rank).
      if (result.halted && result.applied < segmentSize) {
        const newCur = this.actor.system.attributes?.race?.level ?? 0;
        await this.actor.update({ 'system.attributes.race.templateId': '' });
        await this._promptTemplatePick('race', nextRank, newCur + 1);
        continue;
      }

      // If more target remains, we're about to cross into the next rank — offer optional race swap.
      const nowAt = this.actor.system.attributes?.race?.level ?? 0;
      if (nowAt < targetLevel) {
        const upcomingRank = sc.getRankForLevel(nowAt + 1);
        await this._promptOptionalRaceChange(upcomingRank, nowAt + 1);
      }
    }
  }

  /**
   * Show the template picker step and await the player's choice. Returns
   * after the picker action handler has assigned the template to the actor.
   */
  async _promptTemplatePick(track, neededRank, fromLevel) {
    const candidates = await this._findTemplatesByRank(track, neededRank);
    this.runState.waitingForPick = { track, neededRank, fromLevel, candidates, allowSkip: false };
    this.runState.logLines.push(`Pick a ${track} template for rank ${neededRank}…`);
    await this.render();
    return new Promise(resolve => { this._pickResolve = resolve; });
  }

  /**
   * Prompt for an OPTIONAL race template change at a rank threshold. Same
   * picker UI as `_promptTemplatePick` but with `allowSkip: true` so the
   * player can choose "Keep current race" to proceed without changing.
   */
  async _promptOptionalRaceChange(upcomingRank, fromLevel) {
    const candidates = await this._findTemplatesByRank('race', upcomingRank);
    this.runState.waitingForPick = { track: 'race', neededRank: upcomingRank, fromLevel, candidates, allowSkip: true };
    this.runState.logLines.push(`Optional race change at the rank ${upcomingRank} threshold…`);
    await this.render();
    return new Promise(resolve => { this._pickResolve = resolve; });
  }

  static async _onPickTemplate(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    const pick = this.runState?.waitingForPick;
    if (!pick) return;

    const resolvePick = () => {
      this.runState.waitingForPick = null;
      if (this._pickResolve) {
        const r = this._pickResolve;
        this._pickResolve = null;
        r();
      }
    };

    // Skip sentinel — keep the current template (only valid when allowSkip).
    if (uuid === '__skip__') {
      this.runState.logLines.push(`Race kept (no change at rank ${pick.neededRank} threshold).`);
      await this.render();
      resolvePick();
      return;
    }

    const item = await fromUuid(uuid);
    if (!item) {
      ui.notifications.warn('Template not found');
      return;
    }
    // Cache the picked template's unified `tags` (with legacy systemTags fallback).
    const tagIds = [
      ...(item.system.tags ?? []),
      ...(item.system.systemTags ?? []).map(t => t.id),
    ];
    // Append a history entry: this template covers from `pick.fromLevel` onward.
    // Lookup at level L = findLast(entry => entry.fromLevel <= L).
    const prevHistory = this.actor.system.attributes?.[pick.track]?.history ?? [];
    const nextHistory = [...prevHistory, { fromLevel: pick.fromLevel, templateId: item.uuid }];
    await this.actor.update({
      [`system.attributes.${pick.track}.templateId`]: item.uuid,
      [`system.attributes.${pick.track}.name`]:       item.name,
      [`system.attributes.${pick.track}.cachedTags`]: tagIds.map(id => ({ id, value: 0 })),
      [`system.attributes.${pick.track}.history`]:    nextHistory,
    });
    this.runState.logLines.push(`${pick.track} → ${item.name} (rank ${pick.neededRank}, from level ${pick.fromLevel})`);
    await this.render();
    resolvePick();
  }

  /**
   * Find candidate templates of the given type + rank from world items and
   * compendiums. For race templates, rank is irrelevant (single template
   * spans all ranks via rankGains) — returns by-type only.
   */
  async _findTemplatesByRank(track, rank) {
    const out = [];
    const matches = (item) => {
      if (item.type !== track) return false;
      if (track === 'race') return true; // race templates span all ranks
      if (rank == null) return true;     // wildcard — used for "all of this type"
      // Honor rank equivalence: a template at rank X is acceptable for any
      // rank in `rankEquivalence[X]`. Default is single-rank coverage.
      const tplRank = item.system?.rank ?? 'G';
      const covered = CONFIG.ASPECTSOFPOWER.rankEquivalence?.[tplRank] ?? [tplRank];
      return covered.includes(rank);
    };
    // World items
    for (const i of game.items) {
      if (matches(i)) out.push({ uuid: i.uuid, name: i.name, source: 'world' });
    }
    // Compendiums
    for (const pack of game.packs) {
      if (pack.metadata.type !== 'Item') continue;
      try {
        const index = await pack.getIndex({ fields: ['system.rank'] });
        for (const entry of index) {
          if (entry.type !== track) continue;
          if (track !== 'race' && rank != null) {
            const tplRank = entry.system?.rank ?? 'G';
            const covered = CONFIG.ASPECTSOFPOWER.rankEquivalence?.[tplRank] ?? [tplRank];
            if (!covered.includes(rank)) continue;
          }
          out.push({ uuid: `Compendium.${pack.metadata.id}.Item.${entry._id}`, name: entry.name, source: pack.metadata.label });
        }
      } catch (e) { /* pack unavailable */ }
    }
    // Sort by name for predictable display.
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /**
   * Build the post-run summary diff.
   */
  _buildSummary() {
    const sys = this.actor.system;
    const post = {
      class:      sys.attributes?.class?.level      ?? 0,
      profession: sys.attributes?.profession?.level ?? 0,
      race:       sys.attributes?.race?.level       ?? 0,
      freePoints: sys.freePoints ?? 0,
      abilities:  Object.fromEntries(
        ABILITY_KEYS.map(k => [k, sys.abilities?.[k]?.value ?? 0])
      ),
    };
    const pre = this._preResetSnapshot ?? {};
    const abilityDiff = ABILITY_KEYS.map(k => ({
      key:     k,
      before:  pre.abilities?.[k] ?? 0,
      base:    this.baseStats[k] ?? 5,
      after:   post.abilities[k],
      gained:  post.abilities[k] - (this.baseStats[k] ?? 5),
    }));
    return {
      pre, post,
      abilityDiff,
      freePointsCredited: post.freePoints,
    };
  }
}
