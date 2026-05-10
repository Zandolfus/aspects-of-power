/**
 * Custom RegionBehaviorType for Aspects of Power persistent AOEs.
 *
 * Fires on Foundry's path-aware region events (TOKEN_ENTER, TOKEN_MOVE_IN,
 * TOKEN_ROUND_START), routing to the existing triggerPersistentAoe function
 * which reads persistentData from the region's flags. Foundry segmentizes
 * movement paths between updates, so brief pass-throughs (token enters and
 * exits between two of our parallel-animate ticks) are caught natively.
 *
 * Per design 2026-05-10: replace the custom updateToken endpoint check
 * (which missed path-crossings) with native RegionBehavior path-segmentation.
 *
 * The behavior itself carries no system data — all configuration lives on
 * region.flags['aspects-of-power'].persistentData as before. This is purely
 * an event-router so we don't have to migrate existing data.
 */

const FLAG_NS = 'aspects-of-power';
const TYPE_KEY = `${FLAG_NS}.persistentAoe`;

let _triggerFn = null;

/**
 * Inject the trigger function (avoids circular import). Called once at init
 * by aspects-of-power.mjs after triggerPersistentAoe is defined.
 */
export function setAoeTrigger(fn) {
  _triggerFn = fn;
}

class PersistentAoeBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {}; // No system data — config lives on the region's flags.
  }

  async _handleRegionEvent(event) {
    if (!game.user.isGM) return; // Only GM applies effects.
    if (!_triggerFn) return; // Trigger not yet wired.
    const tokenDoc = event.data?.token;
    if (!tokenDoc) return;

    // tokenEnter and tokenMoveIn both indicate "the token is now inside";
    // tokenMoveIn is the path-segmentation variant that fires when the
    // sprite passes through the region between two updates.
    if (event.name === 'tokenEnter' || event.name === 'tokenMoveIn') {
      await _triggerFn(tokenDoc, false);
    } else if (event.name === 'tokenRoundStart') {
      // Re-trigger at the start of a token's round if they're standing in
      // the region. Mirrors the existing combatTurnChange hook behavior.
      await _triggerFn(tokenDoc, true);
    }
  }
}

/**
 * Register the behavior type. Call once during init.
 */
export function registerAoeBehavior() {
  CONFIG.RegionBehavior.dataModels[TYPE_KEY] = PersistentAoeBehavior;
}

/**
 * Build the behavior entry to attach to a region's `behaviors` array
 * during creation. Returns the entry object for createEmbeddedDocuments.
 */
export function buildAoeBehaviorEntry() {
  return {
    type: TYPE_KEY,
    name: 'Persistent AOE Trigger',
    system: {},
  };
}
