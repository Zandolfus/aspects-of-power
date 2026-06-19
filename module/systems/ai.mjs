/**
 * Primitive AI (per plan pure-gathering-ullman.md, 2026-05-29).
 *
 * Pluggable per-actor "decide on your turn" registry. Each profile is a small
 * function bundle; content authors register more profiles without engine
 * changes. First profile is `'primitive'` — closest-hostile-in-range-with-LOS
 * targeting, used by tower-class summons.
 *
 * Actor opts in via `flags.aspectsofpower.aiProfile = '<name>'`. The dispatch
 * hook listens for `updateCombatant` and fires the profile's `onActionReady`
 * when the actor's declared action clears (action just resolved).
 *
 * NOTE: `combatTurnChange` is skipped under celerity (per the celerity
 * findings in this build's planning phase). Action firing is the natural
 * "your turn just resolved, decide what's next" event.
 *
 * Public API:
 *   AIProfiles.register(name, profile)
 *   AIProfiles.get(name)
 *
 * Profile shape:
 *   { onActionReady?: async (actor, ctx) => {} }
 */

import { declareAction, declareMovement, findCombatantForActor, getClockTick } from './celerity.mjs';

// Per-combatant re-entrancy guard: an AI acts at most ONCE per celerity clock
// tick. The legitimate loop (declare → clock advances → fire → decide) always
// re-decides at a NEW tick, so this never blocks it — but it hard-stops any
// machine-speed re-entry while the clock is stuck (the blocked-movement loop
// re-declared fractional creep-moves at a non-advancing clock; live 2026-06-14).
const _aiActedAtTick = new Map(); // combatantId → clockTick

class AIProfilesRegistry {
  static #profiles = new Map();

  static register(name, profile) {
    if (!name || !profile) return;
    this.#profiles.set(name, profile);
  }

  static get(name) {
    return this.#profiles.get(name) ?? null;
  }

  static has(name) {
    return this.#profiles.has(name);
  }

  static all() {
    return Array.from(this.#profiles.keys());
  }
}

export const AIProfiles = AIProfilesRegistry;

/* ---------------------------------------------------------------------------- */
/*  Built-in 'primitive' profile                                                */
/* ---------------------------------------------------------------------------- */

/**
 * Closest-hostile-with-LOS targeting. On ties, prefer the actor's current
 * channel target (sticky), else coinflip.
 *
 * Reads actor flag `aiSkillUuid` for the skill to fire (typically a channel).
 */
const primitiveProfile = {
  onActionReady: async (actor, _ctx) => {
    const skillUuid = actor.flags?.aspectsofpower?.aiSkillUuid;
    if (!skillUuid) return;
    const skill = await fromUuid(skillUuid);
    if (!skill) return;

    const selfToken = actor.getActiveTokens?.()?.[0];
    if (!selfToken) return;
    const selfTokenDoc = selfToken.document;
    const scene = selfTokenDoc.parent;
    if (!scene) return;

    // Range: skill.castingRange override or channel-range override or actor.castingRange
    const channelRange = skill.system?.tagConfig?.channelRange ?? 0;
    const rangeFt = channelRange > 0 ? channelRange : (actor.system?.castingRange ?? 60);
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const rangePx = rangeFt * pxPerFt;

    // Resolve self center
    const selfCenter = {
      x: selfTokenDoc.x + (selfTokenDoc.width  * canvas.grid.size) / 2,
      y: selfTokenDoc.y + (selfTokenDoc.height * canvas.grid.size) / 2,
    };

    // Candidate targets: hostile relative to self. Disposition: self FRIENDLY
    // (1) sees disposition HOSTILE (-1) as enemy. self HOSTILE sees FRIENDLY
    // as enemy. NEUTRAL on either side is treated as enemy iff hostility
    // mismatches.
    const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
    const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    const selfDisp = selfTokenDoc.disposition;
    const isHostileToSelf = (otherDisp) => {
      if (selfDisp === FRIENDLY) return otherDisp === HOSTILE;
      if (selfDisp === HOSTILE) return otherDisp === FRIENDLY;
      return false;
    };

    const candidates = [];
    for (const t of scene.tokens.contents) {
      if (t.id === selfTokenDoc.id) continue;
      if (!t.actor) continue;
      if ((t.actor.system?.health?.value ?? 0) <= 0) continue;
      if (!isHostileToSelf(t.disposition)) continue;

      const tCenter = {
        x: t.x + (t.width  * canvas.grid.size) / 2,
        y: t.y + (t.height * canvas.grid.size) / 2,
      };
      const dx = tCenter.x - selfCenter.x;
      const dy = tCenter.y - selfCenter.y;
      const distPx = Math.hypot(dx, dy);
      if (distPx > rangePx) continue;

      // LOS check
      const visible = canvas.visibility?.testVisibility?.(tCenter, {
        tolerance: 2,
        object: t.object ?? null,
      });
      if (visible === false) continue;

      candidates.push({ tokenDoc: t, distPx, tCenter });
    }

    if (candidates.length === 0) {
      // No targets — skip this turn. Declare a no-op declaration with a fixed
      // wait so the AI gets another turn to re-evaluate.
      await declareAction(actor, skill, { targetIds: [], skipNoTarget: true });
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${actor.name} scans for targets — none in range.</em></p>`,
      });
      return;
    }

    // Sort closest first
    candidates.sort((a, b) => a.distPx - b.distPx);
    const minDist = candidates[0].distPx;
    const ties = candidates.filter(c => Math.abs(c.distPx - minDist) < 0.5); // within half a pixel

    // Sticky tiebreak: prefer current channel target if in the tied set
    let chosen = ties[0];
    if (ties.length > 1) {
      const { ChannelHelpers } = await import('./channel.mjs');
      const currentChannel = ChannelHelpers.findChannelOf(actor.uuid);
      if (currentChannel) {
        const sticky = ties.find(c => c.tokenDoc.id === currentChannel.targetTokenId);
        if (sticky) chosen = sticky;
      }
      if (chosen === ties[0] && ties.length > 1) {
        // Coinflip among ties
        chosen = ties[Math.floor(((selfTokenDoc.id.charCodeAt(0) + Date.now() % 1000) % ties.length))];
        // Date.now() is not allowed in workflow agents but is fine here; just need
        // a non-deterministic pick. Fall back: ties[0].
      }
    }

    // Fire the skill — the channel-tag handler routes to startOrContinueChannel.
    // `executeDeferred: true` + `preTargetIds` causes item.roll() to set
    // game.user.targets to the chosen token (see item.mjs:6085) before
    // dispatching to the tag handlers, so they see the right target.
    await skill.roll({ executeDeferred: true, preTargetIds: [chosen.tokenDoc.id] });

    // Schedule the next AI tick via declareAction
    await declareAction(actor, skill, { targetIds: [chosen.tokenDoc.id] });
  },
};

AIProfiles.register('primitive', primitiveProfile);

/* ---------------------------------------------------------------------------- */
/*  Shared helpers for mobile profiles (brawler / skirmisher)                    */
/* ---------------------------------------------------------------------------- */

function _selfTokenDoc(actor) {
  return actor.getActiveTokens?.()?.[0]?.document ?? null;
}

function _centerOf(tokenDoc) {
  return {
    x: tokenDoc.x + (tokenDoc.width  * canvas.grid.size) / 2,
    y: tokenDoc.y + (tokenDoc.height * canvas.grid.size) / 2,
  };
}

function _isHostileToSelf(selfDisp, otherDisp) {
  const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
  const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  if (selfDisp === FRIENDLY) return otherDisp === HOSTILE;
  if (selfDisp === HOSTILE) return otherDisp === FRIENDLY;
  return false;
}

/** Alive enemies of `selfTokenDoc` on its scene, with centers + distances. */
function _aliveHostilesOf(selfTokenDoc) {
  const scene = selfTokenDoc.parent;
  if (!scene) return [];
  const selfCenter = _centerOf(selfTokenDoc);
  const out = [];
  for (const t of scene.tokens.contents) {
    if (t.id === selfTokenDoc.id) continue;
    if (!t.actor) continue;
    if ((t.actor.system?.health?.value ?? 0) <= 0) continue;
    if (!_isHostileToSelf(selfTokenDoc.disposition, t.disposition)) continue;
    const tCenter = _centerOf(t);
    const distPx = Math.hypot(tCenter.x - selfCenter.x, tCenter.y - selfCenter.y);
    out.push({ tokenDoc: t, tCenter, distPx });
  }
  out.sort((a, b) => a.distPx - b.distPx);
  return out;
}

/** Edge-to-edge distance in feet (matches _checkMeleeReach math). */
function _edgeDistFt(selfTokenDoc, otherTokenDoc) {
  const pxPerFt = canvas.grid.size / canvas.grid.distance;
  const a = _centerOf(selfTokenDoc);
  const b = _centerOf(otherTokenDoc);
  const centerDist = Math.hypot(b.x - a.x, b.y - a.y);
  const rA = (selfTokenDoc.width  * canvas.grid.size) / 2;
  const rB = (otherTokenDoc.width * canvas.grid.size) / 2;
  return Math.max(0, centerDist - rA - rB) / pxPerFt;
}

function _hasLOS(point, tokenDoc) {
  const visible = canvas.visibility?.testVisibility?.(point, {
    tolerance: 2,
    object: tokenDoc.object ?? null,
  });
  return visible !== false;
}

/**
 * Pick the attack skill for an AI profile. `aiSkillUuid` flag overrides;
 * else the most expensive affordable Active attack skill whose roll.type
 * is in `rollTypes` (cost as a rough power proxy).
 */
async function _pickAttackSkill(actor, rollTypes) {
  const overrideUuid = actor.flags?.aspectsofpower?.aiSkillUuid;
  if (overrideUuid) {
    const s = await fromUuid(overrideUuid);
    if (s) return s;
  }
  const typeSet = new Set(rollTypes);
  const candidates = actor.items.filter(s => {
    if (s.type !== 'skill' || s.system.skillType !== 'Active') return false;
    if (!(s.system.tags ?? []).includes('attack')) return false;
    if (!typeSet.has(s.system.roll?.type ?? '')) return false;
    const resKey = s.system.roll?.resource;
    const cost = s.system.roll?.cost ?? 0;
    if (resKey && cost > 0 && (actor.system[resKey]?.value ?? 0) < cost) return false;
    return true;
  });
  candidates.sort((a, b) => (b.system.roll?.cost ?? 0) - (a.system.roll?.cost ?? 0));
  return candidates[0] ?? null;
}

/**
 * Declare a straight-line movement step from the actor's token toward (or
 * away from — pass a negative-direction destPoint) a destination point.
 * Wall-checked center-to-center; on collision the step halves (2 retries).
 * Stamina-gated: shrinks the step to what the actor can afford; below 5ft
 * gives up. Returns true if a movement was declared.
 *
 * v1 limitations (documented): straight-line only, no pathfinding, flat
 * stamina cost (ceil(ft/5) × mode mult — no terrain surcharges).
 */
async function _declareStepToward(actor, selfTokenDoc, destPoint, wantFt, mode) {
  const ai = CONFIG.ASPECTSOFPOWER.ai ?? {};
  const modes = CONFIG.ASPECTSOFPOWER.celerity?.MOVEMENT_MODES ?? {};
  const m = modes[mode] ?? modes.walk ?? { staminaMult: 1 };
  const pxPerFt = canvas.grid.size / canvas.grid.distance;

  let stepFt = Math.min(wantFt, ai.maxStepFt ?? 30);

  // Stamina gate — shrink to affordable.
  const stamina = actor.system?.stamina?.value ?? 0;
  const costOf = (ft) => Math.ceil(ft / 5) * (m.staminaMult ?? 1);
  if (costOf(stepFt) > stamina) {
    stepFt = Math.floor((stamina / (m.staminaMult ?? 1))) * 5;
  }
  if (stepFt < 5) return false;

  const selfCenter = _centerOf(selfTokenDoc);
  const dx = destPoint.x - selfCenter.x;
  const dy = destPoint.y - selfCenter.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;

  // Wall check center-to-center; halve twice on collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const travelPx = stepFt * pxPerFt;
    const endCenter = { x: selfCenter.x + ux * travelPx, y: selfCenter.y + uy * travelPx };
    const blocked = CONFIG.Canvas.polygonBackends?.move?.testCollision?.(
      selfCenter, endCenter, { type: 'move', mode: 'any' }
    );
    if (!blocked) {
      const startPos = { x: selfTokenDoc.x, y: selfTokenDoc.y };
      const endPos = { x: selfTokenDoc.x + ux * travelPx, y: selfTokenDoc.y + uy * travelPx };
      const res = await declareMovement(actor, startPos, endPos, stepFt, costOf(stepFt), mode);
      return !!res;
    }
    stepFt = Math.floor(stepFt / 2 / 5) * 5;
    if (stepFt < 5) break;
  }
  return false;
}

/** Idle declare so the AI loop re-evaluates later. Needs a skill for wait math. */
async function _idle(actor, skill, note) {
  if (skill) await declareAction(actor, skill, { targetIds: [], skipNoTarget: true });
  ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients('GM'),
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><em>[AI] ${actor.name}: ${note}${skill ? '' : ' — no usable skill, AI stalled (GM intervention needed)'}.</em></p>`,
  });
}

/* ---------------------------------------------------------------------------- */
/*  'brawler' — mobile melee: close to reach, then swing                         */
/* ---------------------------------------------------------------------------- */

const brawlerProfile = {
  onActionReady: async (actor, _ctx) => {
    const selfTokenDoc = _selfTokenDoc(actor);
    if (!selfTokenDoc) return;

    const skill = await _pickAttackSkill(actor, ['str_weapon', 'dex_weapon', 'magic_melee']);
    const hostiles = _aliveHostilesOf(selfTokenDoc);
    if (hostiles.length === 0) return _idle(actor, skill, 'no targets on scene');
    if (!skill) return _idle(actor, null, 'no affordable melee attack skill');

    // Nearest; among near-ties (within 25%) prefer one with LOS — melee
    // pursues even without LOS (it hunts), LOS just breaks ties.
    const nearest = hostiles[0];
    const nearTies = hostiles.filter(h => h.distPx <= nearest.distPx * 1.25);
    const target = nearTies.find(h => _hasLOS(h.tCenter, h.tokenDoc)) ?? nearest;

    const reach = skill._resolveSkillReach?.() ?? 5;
    const gapFt = _edgeDistFt(selfTokenDoc, target.tokenDoc);

    if (gapFt <= reach) {
      // Declare-and-wait (paced by the tracker), NOT fire-immediately. Firing
      // via executeDeferred here + declaring caused a double-fire AND the
      // tracker's later fire prompted for invest. aiAutoInvest is threaded
      // through declaredAction so the deferred fire auto-invests, no dialog.
      await declareAction(actor, skill, { targetIds: [target.tokenDoc.id], aiAutoInvest: true });
      return;
    }

    // Close the gap: stop a hair inside reach; sprint when far, walk when close.
    const ai = CONFIG.ASPECTSOFPOWER.ai ?? {};
    const wantFt = Math.max(5, gapFt - Math.max(0, reach - 2));
    const mode = gapFt > 2 * (ai.maxStepFt ?? 30) ? 'sprint' : 'walk';
    const moved = await _declareStepToward(actor, selfTokenDoc, target.tCenter, wantFt, mode);
    if (!moved) return _idle(actor, skill, 'path blocked or out of stamina');
  },
};

AIProfiles.register('brawler', brawlerProfile);

/* ---------------------------------------------------------------------------- */
/*  'skirmisher' — mobile ranged: kite out of danger, shoot from the band       */
/* ---------------------------------------------------------------------------- */

const skirmisherProfile = {
  onActionReady: async (actor, _ctx) => {
    const selfTokenDoc = _selfTokenDoc(actor);
    if (!selfTokenDoc) return;

    const skill = await _pickAttackSkill(actor, ['phys_ranged', 'magic_projectile', 'magic']);
    const hostiles = _aliveHostilesOf(selfTokenDoc);
    if (hostiles.length === 0) return _idle(actor, skill, 'no targets on scene');
    if (!skill) return _idle(actor, null, 'no affordable ranged attack skill');

    const ai = CONFIG.ASPECTSOFPOWER.ai ?? {};
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const skillRange = skill.system?.castingRange ?? 0;
    const rangeFt = skillRange > 0 ? skillRange : (actor.system?.castingRange ?? 60);
    const dangerFt = actor.flags?.aspectsofpower?.aiDangerFt ?? ai.dangerFt ?? 15;

    // Kite first: nearest threat inside the danger bubble → back away.
    const nearest = hostiles[0];
    const nearestFt = _edgeDistFt(selfTokenDoc, nearest.tokenDoc);
    if (nearestFt < dangerFt) {
      const selfCenter = _centerOf(selfTokenDoc);
      const away = {
        x: selfCenter.x + (selfCenter.x - nearest.tCenter.x),
        y: selfCenter.y + (selfCenter.y - nearest.tCenter.y),
      };
      const moved = await _declareStepToward(actor, selfTokenDoc, away, 20, 'walk');
      if (moved) return;
      // Cornered — fall through and shoot point-blank instead.
    }

    // Shoot the nearest target in range with LOS.
    const shootable = hostiles.find(h =>
      h.distPx <= rangeFt * pxPerFt && _hasLOS(h.tCenter, h.tokenDoc)
    );
    if (shootable) {
      // Declare-and-wait with aiAutoInvest threaded (see brawler note).
      await declareAction(actor, skill, { targetIds: [shootable.tokenDoc.id], aiAutoInvest: true });
      return;
    }

    // Nobody shootable — advance toward the nearest hostile to gain range/LOS.
    const moved = await _declareStepToward(actor, selfTokenDoc, nearest.tCenter, 30, 'walk');
    if (!moved) return _idle(actor, skill, 'no shot and path blocked');
  },
};

AIProfiles.register('skirmisher', skirmisherProfile);

/* ---------------------------------------------------------------------------- */
/*  Dispatch hook                                                                */
/* ---------------------------------------------------------------------------- */

/**
 * Hook on `updateCombatant`: when a combatant's declaredAction clears
 * (action fired), look up the actor's aiProfile flag and dispatch.
 * GM-only so we don't double-fire in multiplayer.
 */
export function registerAIHooks() {
  Hooks.on('updateCombatant', async (combatantDoc, changes, _options, _userId) => {
    if (!game.user.isGM) return;

    // CANCEL-to-redeclare also nulls declaredAction but is NOT an action
    // firing — ignoring it is what stops the infinite re-trigger loop
    // (declareAction cancels existing → null → would re-fire onActionReady →
    // declares → cancels → … machine-speed; live bug 2026-06-14).
    if (_options?._aopCancelRedeclare) return;

    // We care about declaredAction transitions from set → null (action fired)
    const declaredChange = changes?.flags?.['aspectsofpower']?.declaredAction;
    if (declaredChange !== null && declaredChange !== undefined) return;
    // After the update, the combatant's declaredAction should be null
    if (combatantDoc.flags?.aspectsofpower?.declaredAction) return;

    const actor = combatantDoc.actor;
    if (!actor) return;
    const profileName = actor.flags?.aspectsofpower?.aiProfile;
    if (!profileName) return;
    const profile = AIProfiles.get(profileName);
    if (!profile?.onActionReady) return;

    // Once-per-tick guard: refuse to re-decide while the clock is stuck.
    const clk = combatantDoc.combat ? getClockTick(combatantDoc.combat) : 0;
    if (_aiActedAtTick.get(combatantDoc.id) === clk) return;
    _aiActedAtTick.set(combatantDoc.id, clk);

    // Fire AI decision asynchronously so the current update cycle settles
    setTimeout(() => {
      profile.onActionReady(actor, { combatant: combatantDoc }).catch(err =>
        console.warn(`[ai] ${profileName} onActionReady failed for ${actor.name}:`, err)
      );
    }, 100);
  });

  // ── Kickoff: AI combatants declare their FIRST action without waiting ──
  // The dispatch hook only fires on declaredAction CLEAR transitions, so a
  // freshly-added AI combatant (or a whole combat at start) sat idle until
  // the GM manually advanced — this kicks each one once. Covers towers too.
  const _kick = (combatantDoc) => {
    if (!game.user.isGM) return;
    if (combatantDoc.flags?.aspectsofpower?.declaredAction) return;
    const actor = combatantDoc.actor;
    const profileName = actor?.flags?.aspectsofpower?.aiProfile;
    if (!profileName) return;
    const profile = AIProfiles.get(profileName);
    if (!profile?.onActionReady) return;
    // Once-per-tick guard (shared with the dispatch hook).
    const clk = combatantDoc.combat ? getClockTick(combatantDoc.combat) : 0;
    if (_aiActedAtTick.get(combatantDoc.id) === clk) return;
    _aiActedAtTick.set(combatantDoc.id, clk);
    // Delay lets the combat-start update settle (combat.started flips true
    // AFTER the combatStart hook returns; the profile's declareAction reads
    // findCombatantForActor which needs the started combat).
    setTimeout(() => {
      profile.onActionReady(actor, { combatant: combatantDoc }).catch(err =>
        console.warn(`[ai] ${profileName} kickoff failed for ${actor.name}:`, err)
      );
    }, 200);
  };

  // combatStart fires for the whole roster; createCombatant covers mid-fight
  // adds (e.g. a summoned tower). Guard createCombatant on an already-started
  // combat so it doesn't double-kick everyone at combat start.
  Hooks.on('combatStart', (combat) => {
    _aiActedAtTick.clear(); // fresh combat — drop stale per-combatant marks
    for (const c of combat.combatants) _kick(c);
  });
  Hooks.on('createCombatant', (combatantDoc) => {
    if (combatantDoc.combat?.started) _kick(combatantDoc);
  });

  // ── Round-start re-trigger: recover INERT AI ──
  // ROOT CAUSE FIX (2026-06-19): the dispatch hook fires only on a
  // declaredAction set→null TRANSITION. An AI whose decision produced NO
  // declaredAction (no affordable skill — common after stamina drain — no
  // reachable target, or a move that left it null across a clock jump) sits
  // at null forever: it never transitions, so it never re-decides, even once
  // stamina has regenerated. celerity.runRoundStart emits `aopRoundStart`
  // AFTER onStartTurn (post-regen) once per actor reference round; re-fire
  // onActionReady for any INERT (null-declaredAction) AI combatant so it gets
  // another chance. Skips combatants that already have a declared action
  // (the firing combatant still holds its action when round-start runs).
  Hooks.on('aopRoundStart', (combat, combatantDoc) => {
    if (!game.user.isGM) return;
    if (combatantDoc.flags?.aspectsofpower?.declaredAction) return; // not inert
    const actor = combatantDoc.actor;
    const profileName = actor?.flags?.aspectsofpower?.aiProfile;
    if (!profileName) return;
    const profile = AIProfiles.get(profileName);
    if (!profile?.onActionReady) return;
    // Share the once-per-tick guard so we never stack with a same-tick dispatch.
    const clk = combatantDoc.combat ? getClockTick(combatantDoc.combat) : 0;
    if (_aiActedAtTick.get(combatantDoc.id) === clk) return;
    _aiActedAtTick.set(combatantDoc.id, clk);
    setTimeout(() => {
      profile.onActionReady(actor, { combatant: combatantDoc }).catch(err =>
        console.warn(`[ai] ${profileName} round-start re-trigger failed for ${actor.name}:`, err)
      );
    }, 100);
  });
}
