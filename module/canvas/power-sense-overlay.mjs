/**
 * Power-Sense Overlay (design-power-sense.md, RULED 2026-07-14).
 *
 * Draws a thin PULSING RING around any token whose combatant has a declared
 * (queued) non-movement action with resource invested — the visual of "what
 * the actors are sensing": how much power is being poured into the windup.
 *
 * RULED model:
 *  - MAGNITUDE IS UNIVERSAL: everyone senses big mana and sees big windups —
 *    the ring shows for any observer within sensory range. Tier is
 *    OBSERVER-RELATIVE (no flat constants): invest ÷ the observer's own
 *    corresponding capacity (wil.mod for mana, safe-invest ceiling for
 *    physical), bucketed into faint / notable / heavy / overwhelming.
 *  - AFFINITY IDENTITY IS GATED: the ring is monochrome unless this client's
 *    observer carries the `affinity-sight` sense tag (GM always) — then it
 *    tints with the declared skill's affinity color.
 *  - Silent/stealth casting (future): skills will be able to suppress or
 *    reduce their ring; content hook, not implemented here.
 *
 * Per-client rendering (movement-overlay architecture): each client rebuilds
 * its own picture from combatant flags, so range/sense gating is local.
 */

import { MOVEMENT_ITEM_ID } from '../systems/celerity.mjs';

const FLAG_NS = 'aspectsofpower';

let _container = null;
let _refreshScheduled = null;
let _tickerFn = null;

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

export function attachPowerSenseLayer() {
  if (_container && !_container.destroyed) _container.destroy({ children: true });
  _container = new PIXI.Container();
  _container.name = 'aop-power-sense';
  _container.eventMode = 'none';
  const target = canvas.interface ?? canvas.controls;
  if (!target) return;
  target.addChild(_container);

  // One shared ticker pulses every ring child (alpha oscillation). Pulse rate
  // scales with tier — an overwhelming windup thrums visibly faster.
  if (_tickerFn) canvas.app?.ticker?.remove(_tickerFn);
  _tickerFn = () => {
    if (!_container || _container.destroyed) return;
    const t = performance.now() / 1000;
    for (const child of _container.children) {
      const p = child._aopPulse;
      if (!p) continue;
      child.alpha = p.base * (0.55 + 0.45 * Math.sin(t * p.speed));
    }
  };
  canvas.app?.ticker?.add(_tickerFn);
  refreshPowerSense();
}

export function detachPowerSenseLayer() {
  if (_refreshScheduled !== null) { cancelAnimationFrame(_refreshScheduled); _refreshScheduled = null; }
  if (_tickerFn) { canvas.app?.ticker?.remove(_tickerFn); _tickerFn = null; }
  if (_container && !_container.destroyed) _container.destroy({ children: true });
  _container = null;
}

/* ------------------------------------------------------------------ */
/*  Render                                                             */
/* ------------------------------------------------------------------ */

export function refreshPowerSense() {
  if (_refreshScheduled !== null) return;
  _refreshScheduled = requestAnimationFrame(() => {
    _refreshScheduled = null;
    _refreshNow();
  });
}

function _refreshNow() {
  if (!_container || _container.destroyed) return;
  _container.removeChildren().forEach(c => c.destroy({ children: true }));

  const combat = game.combat;
  if (!combat?.started) return;
  const sceneId = canvas.scene?.id;
  const cfg = CONFIG.ASPECTSOFPOWER.powerSense ?? {};

  // This client's observer: the user's first controlled owned token, else
  // their first owned token on the scene. GM has no observer (sees all,
  // self-relative tiers).
  const observer = game.user.isGM ? null : _findObserverToken();
  if (!game.user.isGM && !observer) return; // no eyes on the field — sense nothing

  for (const member of combat.combatants) {
    const da = member.flags?.[FLAG_NS]?.declaredAction;
    if (!da || da.itemId === MOVEMENT_ITEM_ID) continue;

    const invest = Number(da.investAmount ?? 0) || 0;
    const manaInvest = Number(da.manaInvestAmount ?? 0) || 0;
    if (invest <= 0 && manaInvest <= 0) continue; // nothing being poured in

    const tokenDoc = member.token;
    if (!tokenDoc || tokenDoc.parent?.id !== sceneId) continue;
    if (tokenDoc.hidden && !game.user.isGM) continue;

    const lane = manaInvest > 0 ? 'mana' : 'physical';
    const amount = lane === 'mana' ? manaInvest : invest;

    // ── Sensory range gate (observer-relative; GM unlimited) ──
    let obsActor = null;
    if (observer) {
      obsActor = observer.actor;
      const rangeFt = (obsActor?.system?.abilities?.perception?.mod ?? 0)
        * (cfg.rangePerPerception ?? 1.0);
      const pxPerFt = canvas.grid.size / canvas.grid.distance;
      const dist = Math.hypot(
        _centerX(tokenDoc) - _centerX(observer.document ?? observer),
        _centerY(tokenDoc) - _centerY(observer.document ?? observer),
      );
      if (dist > rangeFt * pxPerFt) continue; // beyond this observer's senses
    } else {
      obsActor = member.actor; // GM: self-relative → "objective" tier
    }

    // ── Observer-relative tier (no flat constants) ──
    const ratio = _magnitudeRatio(lane, amount, obsActor, cfg);
    const bands = cfg.tierBands ?? [0.3, 0.9, 2.0];
    let tier = 0; // 0 faint · 1 notable · 2 heavy · 3 overwhelming
    for (const b of bands) { if (ratio >= b) tier++; }

    // ── Affinity identity: gated by the affinity-sight sense tag ──
    let color = lane === 'mana' ? 0xcfd8ff : 0xffe0c2; // cool vs warm neutral
    const canReadAffinity = game.user.isGM || obsActor?.hasTag?.('affinity-sight');
    if (canReadAffinity) {
      const skill = member.actor?.items?.get(da.itemId);
      const aff = (skill?.system?.affinities ?? [])[0];
      const hex = CONFIG.ASPECTSOFPOWER.affinityColors?.[aff];
      if (hex) color = Number(`0x${hex.replace('#', '')}`);
    }

    _container.addChild(_buildRing(tokenDoc, tier, color));
  }
}

function _findObserverToken() {
  const owned = canvas.tokens?.placeables?.filter(t => t.actor?.isOwner) ?? [];
  return canvas.tokens?.controlled?.find(t => t.actor?.isOwner) ?? owned[0] ?? null;
}

const _centerX = (d) => d.x + ((d.width ?? 1) * canvas.grid.size) / 2;
const _centerY = (d) => d.y + ((d.height ?? 1) * canvas.grid.size) / 2;

/**
 * Observer-relative magnitude: how big is this invest against what *I* could
 * muster? Mana → my wil.mod (mana pool). Physical → my safe-invest ceiling
 * (physSafeFrac × tough.mod — the same 2% ceiling the invest dialog uses).
 */
function _magnitudeRatio(lane, amount, obsActor, cfg) {
  if (!obsActor) return 0;
  if (lane === 'mana') {
    const denom = Math.max(1, obsActor.system?.abilities?.willpower?.mod ?? 1);
    return amount / denom;
  }
  const tough = obsActor.system?.abilities?.toughness?.mod ?? 1;
  const denom = Math.max(1, (cfg.physSafeFrac ?? 0.02) * tough);
  return amount / denom;
}

/** Thin pulsing ring just outside the token bounds; tier drives thickness,
 *  radius pad, and pulse speed. */
function _buildRing(tokenDoc, tier, color) {
  const gfx = new PIXI.Graphics();
  gfx.eventMode = 'none';
  const cx = _centerX(tokenDoc);
  const cy = _centerY(tokenDoc);
  const baseR = ((Math.max(tokenDoc.width ?? 1, tokenDoc.height ?? 1)) * canvas.grid.size) / 2;
  const radius = baseR + 5 + tier * 3;
  const thickness = 1.5 + tier * 1.25;

  if (typeof gfx.lineStyle === 'function') {
    gfx.lineStyle(thickness, color, 1.0);
    gfx.drawCircle(cx, cy, radius);
  } else {
    gfx.circle(cx, cy, radius).stroke({ color, alpha: 1.0, width: thickness });
  }
  // Overwhelming gets a faint second halo.
  if (tier >= 3) {
    if (typeof gfx.lineStyle === 'function') {
      gfx.lineStyle(1, color, 0.5);
      gfx.drawCircle(cx, cy, radius + 5);
    } else {
      gfx.circle(cx, cy, radius + 5).stroke({ color, alpha: 0.5, width: 1 });
    }
  }
  gfx._aopPulse = { base: 0.45 + tier * 0.15, speed: 2 + tier * 1.5 };
  return gfx;
}
