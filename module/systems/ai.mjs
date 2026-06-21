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

/**
 * Resolve a list of AI BEHAVIOR keys (brains, faculties, and/or preset names —
 * see CONFIG.ASPECTSOFPOWER.aiBehaviors / aiBehaviorPresets) into the concrete
 * AI flags to stamp on a creature plus the conjuring cost multiplier.
 *
 * Presets expand to their faculty lists; duplicates collapse. The summed tier
 * (clamped to the cost table) picks the multiplier each conjurer applies to its
 * own cost currency (summon → mana, ritual → power/prep).
 *
 * @param {string[]} keys
 * @returns {{flags: object, tier: number, costMult: number, resolved: string[]}}
 */
export function resolveAiBehaviors(keys = []) {
  const sc = CONFIG.ASPECTSOFPOWER;
  const reg = sc.aiBehaviors ?? {};
  const presets = sc.aiBehaviorPresets ?? {};
  const costTable = sc.aiBrainTierCost ?? [1];

  const expanded = [];
  for (const k of (keys ?? [])) {
    if (presets[k]) expanded.push(...presets[k]);
    else expanded.push(k);
  }

  const flags = {};
  let tier = 0;
  const resolved = [];
  for (const k of [...new Set(expanded)]) {
    const b = reg[k];
    if (!b) continue;
    Object.assign(flags, b.flags ?? {});
    tier += b.tier ?? 0;
    resolved.push(k);
  }
  tier = Math.max(0, Math.min(tier, costTable.length - 1));
  return { flags, tier, costMult: costTable[tier] ?? 1, resolved };
}

/**
 * Shared, PROFILE-AGNOSTIC target ordering. ANY AI profile — current or future
 * — calls this to get its candidate list already governed by the universal
 * targeting flags: `aiTargetSet` (restrict to a set), `aiFocusWeakest` (lowest
 * HP first), and the commanded `aiFocusTarget` (jumped to the front). A new
 * profile that uses this inherits all of them, plus any future command that
 * sets one of these flags, with zero extra code.
 */
export function aiOrderTargets(actor, hostiles) {
  const f = actor.flags?.aspectsofpower ?? {};
  let list = hostiles;
  const set = f.aiTargetSet;
  if (Array.isArray(set) && set.length) {
    const inSet = list.filter(h => set.includes(h.tokenDoc.id));
    if (inSet.length) list = inSet;
  }
  if (f.aiFocusWeakest) {
    list = [...list].sort((a, b) =>
      (a.tokenDoc.actor?.system?.health?.value ?? 0) - (b.tokenDoc.actor?.system?.health?.value ?? 0));
  }
  if (f.aiFocusTarget) {
    const fi = list.findIndex(h => h.tokenDoc.id === f.aiFocusTarget);
    if (fi > 0) list = [list[fi], ...list.slice(0, fi), ...list.slice(fi + 1)];
  }
  return list;
}

/** Profile-agnostic command check: is this unit commanded to hold position? */
export function aiHoldsPosition(actor) {
  return !!actor.flags?.aspectsofpower?.aiHold;
}

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
 * Persistent-AOE regions on the actor's scene that would HARM this unit:
 * damaging / debuff zones that target it. A zone is a hazard if its
 * `targetingMode` is 'all', or it's an 'enemies' zone cast by the opposite
 * side (casterDisposition ≠ self). 'allies' zones (heals/buffs) and zones
 * cast by our own side are ignored. Read by 'smart' path mode to route around
 * standing hazards. (persistentData shape: item.mjs region creation ~5624.)
 */
function _hazardRegionsFor(selfTokenDoc) {
  const scene = selfTokenDoc.parent;
  if (!scene) return [];
  const selfDisp = selfTokenDoc.disposition;
  const out = [];
  for (const region of (scene.regions ?? [])) {
    const f = region.flags?.['aspects-of-power'];
    if (!f?.persistent || !f.persistentData) continue;
    const mode = f.persistentData.targetingMode ?? 'all';
    if (mode === 'allies') continue;                                   // heal/buff zone
    if (mode === 'enemies' && f.persistentData.casterDisposition === selfDisp) continue; // our side's zone
    out.push(region);
  }
  return out;
}

/** True if the straight segment a→b passes through any hazard region
 *  (sampled at a handful of points, endpoints included). */
function _segmentCrossesHazard(a, b, hazards) {
  if (!hazards.length) return false;
  const STEPS = 6;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, elevation: 0 };
    for (const r of hazards) { if (r.testPoint(p)) return true; }
  }
  return false;
}

/**
 * Wall pathfinding — bounded coarse-grid A* that routes AROUND movement walls.
 * Returns `{waypoint, reachable}`: `waypoint` (center coords) is the next point
 * to head toward (the caller then does the usual stamina-clamp + step +
 * wall-halving); `reachable` is whether ANY route exists (used by path-aware
 * target selection to skip walled-off targets). waypoint = goalCenter when the
 * straight line is already clear (cheap early out) or when no route is found
 * (reachable:false → caller falls back to charge/halve/idle).
 *
 * Foundry's native drag pathfinder is private (Token.#recalculatePlannedMovementPath),
 * and public Token#findMovementPath only CONSTRAINS (clips at walls) without
 * routing — hence this. 8-neighbour grid at the scene cell size; box = start+
 * goal bbox expanded by `margin`; LOS-smoothed so we return the FARTHEST path
 * node still directly reachable (no jittery one-cell creeping). Cost-capped.
 */
function _findWallPath(selfCenter, goalCenter) {
  const move = CONFIG.Canvas.polygonBackends?.move;
  if (!move?.testCollision) return goalCenter;
  const blocked = (a, b) => move.testCollision(a, b, { type: 'move', mode: 'any' });
  if (!blocked(selfCenter, goalCenter)) return { waypoint: goalCenter, reachable: true }; // straight line clear

  const cell = canvas.grid?.size || 100;
  const margin = 14 * cell;
  const minX = Math.min(selfCenter.x, goalCenter.x) - margin;
  const minY = Math.min(selfCenter.y, goalCenter.y) - margin;
  const maxX = Math.max(selfCenter.x, goalCenter.x) + margin;
  const maxY = Math.max(selfCenter.y, goalCenter.y) + margin;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell));
  const MAX_CELLS = 4000;
  if (cols * rows > MAX_CELLS) return { waypoint: goalCenter, reachable: true }; // box too large — assume reachable, charge direct

  const ptOf = (c, r) => ({ x: minX + c * cell + cell / 2, y: minY + r * cell + cell / 2 });
  const idx = (c, r) => r * cols + c;
  const clamp = (v, hi) => Math.max(0, Math.min(hi - 1, v));
  const sC = clamp(Math.floor((selfCenter.x - minX) / cell), cols), sR = clamp(Math.floor((selfCenter.y - minY) / cell), rows);
  const gC = clamp(Math.floor((goalCenter.x - minX) / cell), cols), gR = clamp(Math.floor((goalCenter.y - minY) / cell), rows);
  const h = (c, r) => Math.hypot(c - gC, r - gR);

  const open = [{ c: sC, r: sR, g: 0, f: h(sC, sR) }];
  const gScore = new Map([[idx(sC, sR), 0]]);
  const came = new Map();
  const closed = new Set();
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = false, iters = 0;

  while (open.length && iters++ < MAX_CELLS) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ci = idx(cur.c, cur.r);
    if (cur.c === gC && cur.r === gR) { found = true; break; }
    if (closed.has(ci)) continue;
    closed.add(ci);
    const curPt = ptOf(cur.c, cur.r);
    for (const [dc, dr] of NB) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = idx(nc, nr);
      if (closed.has(ni)) continue;
      if (blocked(curPt, ptOf(nc, nr))) continue; // wall between adjacent cells
      const tentative = cur.g + Math.hypot(dc, dr);
      if (tentative < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, tentative);
        came.set(ni, ci);
        open.push({ c: nc, r: nr, g: tentative, f: tentative + h(nc, nr) });
      }
    }
  }
  if (!found) return { waypoint: goalCenter, reachable: false }; // no route within the box

  // Reconstruct start→goal cell order (excluding the start cell).
  const path = [];
  let cur = idx(gC, gR);
  const startIdx = idx(sC, sR);
  while (cur !== undefined && cur !== startIdx) { path.push(cur); cur = came.get(cur); }
  path.reverse();

  // LOS smoothing: head toward the FARTHEST path node still directly reachable.
  for (let i = path.length - 1; i >= 0; i--) {
    const p = ptOf(path[i] % cols, Math.floor(path[i] / cols));
    if (!blocked(selfCenter, p)) return { waypoint: p, reachable: true };
  }
  return { waypoint: goalCenter, reachable: true };
}

/**
 * Declare a straight-line movement step from the actor's token toward (or
 * away from — pass a negative-direction destPoint) a destination point.
 * Wall-checked center-to-center; on collision the step halves (2 retries).
 * Stamina-gated: shrinks the step to what the actor can afford; below 5ft
 * gives up. Returns true if a movement was declared.
 *
 * Routing is driven by the actor's BEHAVIOR FACULTY flags (set by aiBehaviors
 * tags): `aiPathfind` → A* wall routing, `aiHazardAvoid` → AOE deviation. The
 * legacy `aiPathMode` flag is honored as a fallback ('smart' = both on).
 * Without them, the creature charges straight (ignores walls/AOE).
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

  // Behavior faculties (granular flags; aiPathMode is the legacy fallback where
  // 'smart' = both pathfind + hazard-avoid, 'direct'/absent = neither).
  const _f = actor.flags?.aspectsofpower ?? {};
  const _legacySmart = _f.aiPathMode === 'smart';
  const wantPathfind    = _f.aiPathfind    ?? _legacySmart;
  const wantHazardAvoid = _f.aiHazardAvoid ?? _legacySmart;

  // WALL ROUTING (pathfind faculty): aim toward the next waypoint of an A* route
  // around movement walls (returns destPoint unchanged when the straight line is
  // already clear, so cheap in open fights). Without it, charge straight.
  let aim = destPoint;
  if (wantPathfind) aim = _findWallPath(selfCenter, destPoint).waypoint;

  let ux, uy;
  {
    const dx = aim.x - selfCenter.x;
    const dy = aim.y - selfCenter.y;
    const dist = Math.hypot(dx, dy) || 1;
    ux = dx / dist; uy = dy / dist;
  }

  // AOE AVOIDANCE (hazard-avoid faculty): if the step along the (possibly
  // wall-routed) heading would cross a harmful AOE, deviate. Sample increasing
  // left/right offsets and take the smallest that clears (cos(80°)≈0.17 > 0, so
  // every candidate still advances). None clears → keep the heading (moving
  // beats freezing; next decision re-evaluates).
  if (wantHazardAvoid) {
    const hazards = _hazardRegionsFor(selfTokenDoc);
    if (hazards.length) {
      const travelPx = stepFt * pxPerFt;
      const directEnd = { x: selfCenter.x + ux * travelPx, y: selfCenter.y + uy * travelPx };
      if (_segmentCrossesHazard(selfCenter, directEnd, hazards)) {
        const base = Math.atan2(uy, ux);
        const DEG = Math.PI / 180;
        for (const off of [20, -20, 40, -40, 60, -60, 80, -80]) {
          const a = base + off * DEG;
          const cand = { x: selfCenter.x + Math.cos(a) * travelPx, y: selfCenter.y + Math.sin(a) * travelPx };
          if (_segmentCrossesHazard(selfCenter, cand, hazards)) continue;
          ux = Math.cos(a); uy = Math.sin(a);
          break;
        }
      }
    }
  }

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

/** Self-preservation faculty (aiSelfPreserve): true when the actor is below the
 *  retreat HP fraction AND a threat sits within ~2× its danger bubble. */
function _shouldRetreat(actor, hostiles, selfTokenDoc) {
  if (!actor.flags?.aspectsofpower?.aiSelfPreserve) return false;
  const hp = actor.system?.health?.value ?? 0;
  const max = actor.system?.health?.max ?? 1;
  if (max <= 0 || hp / max >= (CONFIG.ASPECTSOFPOWER.ai?.retreatHpPct ?? 0.25)) return false;
  const nearest = hostiles[0];
  if (!nearest) return false;
  const dangerFt = actor.flags?.aspectsofpower?.aiDangerFt ?? CONFIG.ASPECTSOFPOWER.ai?.dangerFt ?? 15;
  return _edgeDistFt(selfTokenDoc, nearest.tokenDoc) < dangerFt * 2;
}

/** Flee directly away from the nearest threat (sprint). Returns true if a
 *  retreat move was declared. Reuses _declareStepToward so a smart retreater
 *  still routes around walls/AOE while fleeing. */
async function _fleeFrom(actor, selfTokenDoc, hostiles) {
  const sc = _centerOf(selfTokenDoc);
  const nc = hostiles[0].tCenter;
  const away = { x: sc.x + (sc.x - nc.x), y: sc.y + (sc.y - nc.y) };
  return _declareStepToward(actor, selfTokenDoc, away, 30, 'sprint');
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

    // SELF-PRESERVATION faculty: flee when low on HP with a threat nearby.
    if (_shouldRetreat(actor, hostiles, selfTokenDoc) && await _fleeFrom(actor, selfTokenDoc, hostiles)) return;

    const ai = CONFIG.ASPECTSOFPOWER.ai ?? {};
    const f = actor.flags?.aspectsofpower ?? {};
    const legacySmart = f.aiPathMode === 'smart';
    const smartTarget = f.aiSmartTarget ?? legacySmart;
    const canPathfind = f.aiPathfind ?? legacySmart;
    const reach = skill._resolveSkillReach?.() ?? 5;
    const selfCenter = _centerOf(selfTokenDoc);
    const moveBlocked = (a, b) => CONFIG.Canvas.polygonBackends?.move?.testCollision?.(a, b, { type: 'move', mode: 'any' });

    // Universal target ordering — target-set restriction, focus-weakest, and the
    // commanded focus, all applied by the shared aiOrderTargets() so this and
    // every future profile share one implementation.
    const candidates = aiOrderTargets(actor, hostiles);

    // Target selection. SMART-TARGET faculty → path-aware, NO lock: walk the
    // nearest-sorted set and take the first we can act on (in reach / straight-
    // reachable / A*-reachable when pathfind is on), falling through when one is
    // walled off — never freezes on an unreachable enemy while a reachable one
    // stands beside it. WITHOUT the faculty → simple lock on the nearest.
    let target = null, targetGap = 0, attackNow = false;
    if (smartTarget) {
      for (const cand of candidates) {
        const gap = _edgeDistFt(selfTokenDoc, cand.tokenDoc);
        if (gap <= reach) { target = cand; targetGap = gap; attackNow = true; break; }
        if (!moveBlocked(selfCenter, cand.tCenter)) { target = cand; targetGap = gap; break; }
        if (canPathfind && _findWallPath(selfCenter, cand.tCenter).reachable) { target = cand; targetGap = gap; break; }
        // unreachable from here — try the next-nearest
      }
      if (!target) return _idle(actor, skill, 'no reachable target');
    } else {
      target = candidates[0];
      targetGap = _edgeDistFt(selfTokenDoc, target.tokenDoc);
      attackNow = targetGap <= reach;
    }

    if (attackNow) {
      // Declare-and-wait (paced by the tracker); aiAutoInvest threaded through
      // declaredAction so the deferred fire auto-invests (no dialog).
      await declareAction(actor, skill, { targetIds: [target.tokenDoc.id], aiAutoInvest: true });
      return;
    }

    // HOLD POSITION (summoner order): never advance — idle in place and only
    // strike when a target comes into reach.
    if (aiHoldsPosition(actor)) return _idle(actor, skill, 'holding position');

    // Close the gap: stop a hair inside reach; sprint when far, walk when close.
    const wantFt = Math.max(5, targetGap - Math.max(0, reach - 2));
    const mode = targetGap > 2 * (ai.maxStepFt ?? 30) ? 'sprint' : 'walk';
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

    // SELF-PRESERVATION faculty: flee far when low on HP with a threat nearby.
    if (_shouldRetreat(actor, hostiles, selfTokenDoc) && await _fleeFrom(actor, selfTokenDoc, hostiles)) return;

    const ai = CONFIG.ASPECTSOFPOWER.ai ?? {};
    const pxPerFt = canvas.grid.size / canvas.grid.distance;
    const skillRange = skill.system?.castingRange ?? 0;
    const rangeFt = skillRange > 0 ? skillRange : (actor.system?.castingRange ?? 60);
    const dangerFt = actor.flags?.aspectsofpower?.aiDangerFt ?? ai.dangerFt ?? 15;
    const hold = aiHoldsPosition(actor);

    // Kite first: nearest threat inside the danger bubble → back away (unless
    // commanded to hold position).
    const nearest = hostiles[0];
    const nearestFt = _edgeDistFt(selfTokenDoc, nearest.tokenDoc);
    if (!hold && nearestFt < dangerFt) {
      const selfCenter = _centerOf(selfTokenDoc);
      const away = {
        x: selfCenter.x + (selfCenter.x - nearest.tCenter.x),
        y: selfCenter.y + (selfCenter.y - nearest.tCenter.y),
      };
      const moved = await _declareStepToward(actor, selfTokenDoc, away, 20, 'walk');
      if (moved) return;
      // Cornered — fall through and shoot point-blank instead.
    }

    // Shoot a target in range with LOS — nearest by default, or lowest-HP with
    // the FOCUS-WEAKEST faculty.
    // Universal target ordering (focus-weakest / commanded focus / target-set),
    // shared via aiOrderTargets() so the shoot pick matches every other profile.
    const shootList = aiOrderTargets(actor, hostiles);
    const shootable = shootList.find(h =>
      h.distPx <= rangeFt * pxPerFt && _hasLOS(h.tCenter, h.tokenDoc)
    );
    if (shootable) {
      // Declare-and-wait with aiAutoInvest threaded (see brawler note).
      await declareAction(actor, skill, { targetIds: [shootable.tokenDoc.id], aiAutoInvest: true });
      return;
    }

    // HOLD POSITION: don't advance for a shot — idle and wait.
    if (hold) return _idle(actor, skill, 'holding position');
    // Nobody shootable — advance toward the nearest hostile to gain range/LOS.
    const moved = await _declareStepToward(actor, selfTokenDoc, nearest.tCenter, 30, 'walk');
    if (!moved) return _idle(actor, skill, 'no shot and path blocked');
  },
};

AIProfiles.register('skirmisher', skirmisherProfile);

/**
 * Summoner MOVE order: command a one-step move toward a destination center,
 * respecting the actor's pathfind/hazard faculties + walls + stamina (reuses
 * _declareStepToward, so capped at ai.maxStepFt per click). Returns true if a
 * move was declared. Used by the token-HUD command surface.
 */
export async function aiCommandMove(actor, destCenter) {
  const selfTokenDoc = _selfTokenDoc(actor);
  if (!selfTokenDoc) return false;
  const c = _centerOf(selfTokenDoc);
  const want = Math.hypot(destCenter.x - c.x, destCenter.y - c.y) / (canvas.grid.size / canvas.grid.distance);
  if (want < 1) return false;
  return _declareStepToward(actor, selfTokenDoc, destCenter, want, 'walk');
}

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
    // MANUAL command (summoner driving it directly): the AI stands down.
    if (actor.flags?.aspectsofpower?.aiCommand === 'manual') return;

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
    if (actor.flags?.aspectsofpower?.aiCommand === 'manual') return; // owner-driven
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
    if (actor.flags?.aspectsofpower?.aiCommand === 'manual') return; // owner-driven
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
