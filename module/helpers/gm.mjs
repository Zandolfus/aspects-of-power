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
 * ⚠⚠ THE AUTOMATION LOGIN MUST NEVER OUTRANK THE HUMAN (found 2026-08-30,
 * a full live session's worth of pain): Foundry's `game.users.activeGM`
 * picks the active GM with the LOWEST id, and the Claude automation user's
 * id sorts before the Gamemaster's — so whenever the automation browser was
 * connected it silently became the acting GM. During that session it was
 * bulk-importing scenes, reloading between chunks, and crashed once; every
 * isActingGM-gated engine loop (persistent-zone reticks, DoT ticks, aura
 * ticks) and every player socket op was routed to a client that was not
 * listening. The table felt it as "persistent aoes not applying damage",
 * missing dot ticks, stuck hex travel, and dead reaction prompts.
 *
 * Resolution is deterministic on every client from the same data (active +
 * isGM + name + id), exactly like Foundry's own arbiter: active GMs,
 * automation logins LAST, then id order. When the human GM is offline the
 * automation login still acts — overnight ops depend on that.
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
