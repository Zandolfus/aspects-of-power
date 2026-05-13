/**
 * Movement Path Overlay — draws a translucent line on the canvas from
 * each in-flight movement's start to its destination, with an arrowhead
 * at the destination and a small marker at the token's current
 * interpolated position.
 *
 * Visibility filter mirrors the celerity tracker convention: GMs see all
 * declared movements; players see only PC-owned (`hasPlayerOwner`) tokens'
 * paths. Per design-celerity.md "Public allies, opaque enemies".
 *
 * Wired by main module init: registers canvasReady + updateCombat +
 * updateCombatant + deleteCombat + canvasTearDown hooks.
 */

import { MOVEMENT_ITEM_ID, interpolateMovementPosition, getClockTick } from '../systems/celerity.mjs';
import { getAllBuffers } from './movement-buffer.mjs';

const FLAG_NS = 'aspectsofpower';

/** Module-level container holding all path graphics for the current scene. */
let _overlayContainer = null;

/** rAF-debounce handle — coalesces multiple refresh calls within one frame. */
let _refreshScheduled = null;

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

/**
 * Attach the overlay container to canvas.interface (uppermost overlay group).
 * Called on canvasReady.
 */
export function attachOverlayLayer() {
  if (_overlayContainer && !_overlayContainer.destroyed) {
    _overlayContainer.destroy({ children: true });
  }
  _overlayContainer = new PIXI.Container();
  _overlayContainer.name = 'aop-movement-overlay';
  _overlayContainer.eventMode = 'none'; // pass-through clicks
  // canvas.interface is the uppermost overlay group in v14 — sits above tokens
  // but below HUD elements. Falls back to canvas.controls if interface is gone
  // (older instances or test harnesses).
  const target = canvas.interface ?? canvas.controls;
  if (!target) return;
  target.addChild(_overlayContainer);
  refreshOverlay();
}

export function detachOverlayLayer() {
  if (_refreshScheduled !== null) {
    cancelAnimationFrame(_refreshScheduled);
    _refreshScheduled = null;
  }
  if (_overlayContainer && !_overlayContainer.destroyed) {
    _overlayContainer.destroy({ children: true });
  }
  _overlayContainer = null;
}

/* ------------------------------------------------------------------ */
/*  Render                                                             */
/* ------------------------------------------------------------------ */

/**
 * Public entry — schedules a refresh on the next animation frame.
 * Multiple calls within one frame coalesce into a single redraw,
 * which keeps WASD bursts and parallel-animate clusters from
 * triggering N full path-graphic rebuilds.
 */
export function refreshOverlay() {
  if (_refreshScheduled !== null) return;
  _refreshScheduled = requestAnimationFrame(() => {
    _refreshScheduled = null;
    _refreshOverlayNow();
  });
}

/**
 * Synchronous redraw. Use only when you know exactly one refresh is
 * needed (e.g., canvas teardown). Most callers should use refreshOverlay.
 */
function _refreshOverlayNow() {
  if (!_overlayContainer || _overlayContainer.destroyed) return;
  _overlayContainer.removeChildren().forEach(c => c.destroy({ children: true }));

  const combat = game.combat;
  if (!combat?.started) return;
  const sceneId = canvas.scene?.id;
  const clockTick = getClockTick(combat);

  // Committed declared movements (solid).
  for (const member of combat.combatants) {
    const mv = member.flags?.[FLAG_NS]?.declaredAction;
    if (!mv || mv.itemId !== MOVEMENT_ITEM_ID) continue;
    if (!_isVisibleToCurrentUser(member)) continue;
    const tokenDoc = member.token;
    if (!tokenDoc || tokenDoc.parent?.id !== sceneId) continue;

    const gfx = _buildPathGraphic(tokenDoc, mv, clockTick);
    if (gfx) _overlayContainer.addChild(gfx);
  }

  // Staged WASD buffers (dashed yellow — pre-commit preview).
  for (const buf of getAllBuffers()) {
    const member = combat.combatants.get(buf.combatantId);
    if (!member || !_isVisibleToCurrentUser(member)) continue;
    const tokenDoc = member.token;
    if (!tokenDoc || tokenDoc.parent?.id !== sceneId) continue;

    const gfx = _buildBufferGraphic(tokenDoc, buf);
    if (gfx) _overlayContainer.addChild(gfx);
  }
}

/** Buffered (pre-commit) staging line. Yellow for walk-buffer, orange for
 *  sprint-buffer. Dashed line + open circle + ft label + mode tag. Distinct
 *  from the blue/red declared (committed) lines. */
function _buildBufferGraphic(tokenDoc, buf) {
  const gfx = new PIXI.Graphics();
  gfx.eventMode = 'none';
  const w = (tokenDoc.width ?? 1) * canvas.grid.size;
  const h = (tokenDoc.height ?? 1) * canvas.grid.size;
  const cx = w / 2, cy = h / 2;
  const sx = buf.startPos.x + cx;
  const sy = buf.startPos.y + cy;
  const ex = buf.destPos.x + cx;
  const ey = buf.destPos.y + cy;
  const dx = ex - sx, dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len <= 1) return null;
  const isSprint = buf.mode === 'sprint';
  const color = isSprint ? 0xff8833 : 0xffcc33; // orange = sprint, yellow = walk
  const alpha = 0.95;
  _drawDashedLine(gfx, sx, sy, ex, ey, color, alpha);
  // Open circle at destination (filled white center, mode-tinted border).
  if (typeof gfx.drawCircle === 'function') {
    gfx.beginFill(0xffffff, 0.6);
    gfx.lineStyle(2, color, 1.0);
    gfx.drawCircle(ex, ey, 7);
    gfx.endFill();
  } else {
    gfx.circle(ex, ey, 7);
    gfx.fill({ color: 0xffffff, alpha: 0.6 });
    gfx.stroke({ color, alpha: 1.0, width: 2 });
  }
  // Distance + mode label near the destination.
  const label = new PIXI.Text(`${buf.totalDistFt}ft ${isSprint ? '(sprint)' : '(walk)'} — Enter to commit`, {
    fontSize: 12,
    fill: color,
    stroke: 0x000000,
    strokeThickness: 3,
    fontWeight: 'bold',
  });
  label.x = ex + 12;
  label.y = ey - 8;
  gfx.addChild(label);
  return gfx;
}

/**
 * Per design-celerity.md "Public allies, opaque enemies": GM sees all,
 * players see only PC-owned movements (their own PC + other PCs' moves).
 */
function _isVisibleToCurrentUser(combatant) {
  if (game.user.isGM) return true;
  return combatant.actor?.hasPlayerOwner === true;
}

/**
 * Build a Graphics object for one movement: line from start to end,
 * arrowhead at end, dot at current interpolated position.
 */
function _buildPathGraphic(tokenDoc, mv, clockTick) {
  const gfx = new PIXI.Graphics();
  gfx.eventMode = 'none';

  // Token-center offset (token x/y is top-left).
  const w = (tokenDoc.width ?? 1) * canvas.grid.size;
  const h = (tokenDoc.height ?? 1) * canvas.grid.size;
  const cx = w / 2;
  const cy = h / 2;
  const sx = mv.startPos.x + cx;
  const sy = mv.startPos.y + cy;
  const ex = mv.endPos.x + cx;
  const ey = mv.endPos.y + cy;

  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len <= 1) return null;
  const ux = dx / len;
  const uy = dy / len;

  // Color: PC vs NPC (blue/red base), brighter saturation for sprint.
  // Walk paths are slightly desaturated to reinforce "the cautious mode".
  const isPC = tokenDoc.actor?.hasPlayerOwner === true;
  const isSprint = mv.movementMode === 'sprint';
  let color;
  if (isPC) color = isSprint ? 0x55aaff : 0x4477cc;     // bright blue / muted blue
  else      color = isSprint ? 0xff4444 : 0xcc6666;     // bright red / muted red
  const alpha = 0.85;

  // Dashed line (rendered as repeating segments).
  _drawDashedLine(gfx, sx, sy, ex, ey, color, alpha);

  // Arrowhead at destination.
  const arrowSize = 14;
  const ax1 = ex - ux * arrowSize - uy * (arrowSize * 0.5);
  const ay1 = ey - uy * arrowSize + ux * (arrowSize * 0.5);
  const ax2 = ex - ux * arrowSize + uy * (arrowSize * 0.5);
  const ay2 = ey - uy * arrowSize - ux * (arrowSize * 0.5);
  if (typeof gfx.drawPolygon === 'function') {
    gfx.beginFill(color, alpha);
    gfx.drawPolygon([ex, ey, ax1, ay1, ax2, ay2]);
    gfx.endFill();
  } else {
    gfx.poly([ex, ey, ax1, ay1, ax2, ay2]);
    gfx.fill({ color, alpha });
  }

  // Current-position marker at the lerp point (small dot).
  const cur = interpolateMovementPosition(mv, clockTick);
  const px = cur.x + cx;
  const py = cur.y + cy;
  if (typeof gfx.drawCircle === 'function') {
    gfx.beginFill(color, 1.0);
    gfx.lineStyle(2, 0xffffff, 0.8);
    gfx.drawCircle(px, py, 5);
    gfx.endFill();
  } else {
    gfx.circle(px, py, 5);
    gfx.fill({ color, alpha: 1.0 });
    gfx.stroke({ color: 0xffffff, alpha: 0.8, width: 2 });
  }

  return gfx;
}

/**
 * Manual dashed-line via repeating segments (PIXI has no native dashed
 * stroke). Dash 12px, gap 8px.
 */
function _drawDashedLine(gfx, x1, y1, x2, y2, color, alpha) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const dash = 12;
  const gap = 8;
  const stride = dash + gap;
  let dist = 0;
  const useV7 = typeof gfx.lineStyle === 'function';
  if (useV7) gfx.lineStyle(3, color, alpha);
  while (dist < len) {
    const segEnd = Math.min(dist + dash, len);
    const sx = x1 + ux * dist;
    const sy = y1 + uy * dist;
    const ex = x1 + ux * segEnd;
    const ey = y1 + uy * segEnd;
    if (useV7) {
      gfx.moveTo(sx, sy);
      gfx.lineTo(ex, ey);
    } else {
      gfx.moveTo(sx, sy).lineTo(ex, ey).stroke({ color, alpha, width: 3 });
    }
    dist += stride;
  }
}
