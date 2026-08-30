/**
 * GM-identity and whisper-routing helpers.
 *
 * THE MULTI-GM RULE: `game.user.isGM` is true on EVERY logged-in GM client
 * simultaneously. A world-mutating hook gated on it runs once per GM client —
 * with two GMs connected (this table's normal state: the human GM plus the
 * Claude automation login) that means double actor updates, double effect
 * deletes, double AOE ticks. Hooks that MUTATE world state must gate on
 * `isActingGM()` so exactly one client acts. Hooks that only render/refresh
 * local UI may keep plain `isGM`.
 *
 * This module already had the correct pattern in canvas/aura-entry-trigger.mjs
 * (2026-05-10 double-fired death blooms); it is centralized here so new hooks
 * reach for the safe helper by default.
 */

/**
 * The single designated acting GM for this table.
 *
 * ⚠⚠ THE AUTOMATION LOGIN MUST NEVER OUTRANK THE HUMAN. History: cf90981
 * shipped this claiming the automation login had been winning
 * `game.users.activeGM` by id sort during the 08-30 session. That diagnosis
 * was REFUTED the next day against core v14 source: `Users#getDesignatedUser`
 * orders by ROLE first and id only on ties, and the automation login is an
 * Assistant (role 3) under a full Gamemaster (role 4) - the human held
 * acting-GM all session, and the tick failures had other causes. The sort
 * below is kept anyway, now as a STRUCTURAL guarantee: nothing pins the
 * automation login's role, and a promotion to full GM would silently hand
 * it every arbiter (its id sorts first). This helper plus
 * patchCoreDesignation() below make automation-last true regardless of
 * role, and keep OUR arbiter and CORE's from ever disagreeing about who
 * acts (a disagreement is double execution on one side, silence on the
 * other).
 *
 * Resolution is deterministic on every client from the same data (active +
 * isGM + name + id): active GMs, automation logins LAST, then id order.
 * When the human GM is offline the automation login still acts - overnight
 * ops depend on that.
 * @returns {User|null}
 */
const AUTOMATION_USERS = new Set(['Claude']);
export function actingGM() {
  const gms = game.users.filter(u => u.active && u.isGM).sort((a, b) => {
    const auto = (AUTOMATION_USERS.has(a.name) ? 1 : 0) - (AUTOMATION_USERS.has(b.name) ? 1 : 0);
    return auto || (a.id < b.id ? -1 : 1);
  });
  return gms[0] ?? null;
}

/**
 * Extend the automation-last guarantee into CORE's own arbiter.
 * `Users#getDesignatedUser` backs both `users.activeGM` and
 * `User#isDesignated`, and core routes real work through them - notably
 * `TeleportTokenRegionBehaviorType.#shouldTeleport` designates which client
 * EXECUTES a player's cross-scene hex travel (players lack
 * TOKEN_CREATE/TOKEN_DELETE, so a GM client performs the delete+create and
 * pulls the mover's view). Core orders by role, then lowest id.
 *
 * Today the automation login is role 3 and loses on role everywhere, so
 * this wrap changes nothing - but nothing pins that role, and a promotion
 * to full GM would silently hand a thrashing pipeline client every core
 * designation (teleport execution included) by id sort, while actingGM()
 * above kept pointing OUR gates at the human: two arbiters disagreeing.
 * The wrap keeps core's ordering untouched among non-automation users and
 * lets an automation login qualify only when NO other user matches - the
 * same overnight-ops guarantee actingGM() gives. Applied to the class
 * prototype at init, before any collection exists.
 */
export function patchCoreDesignation() {
  const proto = foundry.documents.collections.Users.prototype;
  const original = proto.getDesignatedUser;
  proto.getDesignatedUser = function (condition) {
    return original.call(this, u => !AUTOMATION_USERS.has(u.name) && condition(u))
      ?? original.call(this, condition);
  };
}

/**
 * True when this client is the single designated acting GM.
 * @returns {boolean}
 */
export function isActingGM() {
  const gm = actingGM();
  return !!gm && game.user.id === gm.id;
}

/**
 * True when the actor is an assigned player character (any active or inactive
 * user has it set as their character). NPC/hostile actors return false — their
 * chat output is generally GM-whispered.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isPlayerCharacter(actor) {
  if (!actor) return false;
  return game.users.some(u => u.character?.id === actor.id);
}

/**
 * Spread-ready whisper block: `{...gmWhisperFor(actor)}` adds a GM whisper
 * for non-player actors and nothing for player characters — the standard
 * "players see their own results, NPC results whisper to the GM" routing.
 * @param {Actor|null} actor
 * @returns {{whisper?: User[]}}
 */
export function gmWhisperFor(actor) {
  return isPlayerCharacter(actor) ? {} : { whisper: ChatMessage.getWhisperRecipients('GM') };
}

/**
 * The active non-GM user whose assigned character IS this actor, or null.
 * Ownership permission alone is not enough (players may have OWNER on NPCs
 * without being the defender/actor in question).
 * @param {Actor|null} actor
 * @returns {User|null}
 */
export function findOwningPlayer(actor) {
  if (!actor) return null;
  return game.users.find(u => u.active && !u.isGM && u.character?.id === actor.id) ?? null;
}
