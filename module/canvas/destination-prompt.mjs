/**
 * Destination-on-canvas prompt — pick an arbitrary point on the canvas
 * for movement-skill primitives (Teleport / Leap / Blink).
 *
 * Similar in shape to `selectMarkerOnCanvas`, but returns a free position
 * rather than picking an existing region. Caller specifies:
 *   - max distance from caster (range gate)
 *   - whether sight is required (Foundry vision polygon, not raw LOS)
 *   - whether to snap to grid centers
 *
 * Visual: range ring on the casting token + crosshair at cursor. Cursor
 * tints green inside range / red outside. Sight-failure shows a different
 * tint (amber) when sight is required and the cursor is in-range but
 * unseen.
 *
 * Returns {x, y, elevation} on click; null on Esc / right-click / cancel.
 */

/**
 * @param {Token|TokenDocument|object} caster  Caster's token (or token doc).
 *                                             Used as the range origin and
 *                                             sight source.
 * @param {object} [opts]
 * @param {number}  [opts.maxDistanceFt=30]   Range gate.
 * @param {boolean} [opts.requireSight=false] When true, destination must be
 *                                            visible to the caster via
 *                                            canvas.visibility.testVisibility.
 * @param {boolean} [opts.snapToGrid=true]    Snap return coords to grid centers.
 * @param {string}  [opts.label]              Label drawn near cursor.
 * @param {string}  [opts.message]            Override the notification text.
 * @returns {Promise<{x:number, y:number, elevation:number}|null>}
 */
export function selectDestinationOnCanvas(caster, opts = {}) {
  const {
    maxDistanceFt = 30,
    requireSight = false,
    snapToGrid = true,
    label = '',
    message,
  } = opts;

  const casterToken = caster?.object ?? caster;
  if (!casterToken?.center) {
    ui.notifications.warn('Cannot prompt for destination — no caster token.');
    return Promise.resolve(null);
  }

  const center = { x: casterToken.center.x, y: casterToken.center.y };
  const gridSize = canvas.grid.size;
  const gridDist = canvas.grid.distance;
  const pxPerFt = gridSize / gridDist;
  const rangePx = maxDistanceFt * pxPerFt;

  return new Promise((resolve) => {
    const notif = ui.notifications.info(
      message ?? `Click destination (range ${maxDistanceFt} ft${requireSight ? ', sight required' : ''}; Esc to cancel)`,
      { permanent: true },
    );
    document.body.classList.add('aop-targeting');

    // ── Graphics overlay ──────────────────────────────────────────────
    const layer = new PIXI.Container();
    layer.zIndex = 9999;
    layer.eventMode = 'none';
    canvas.stage.addChild(layer);

    const ring = new PIXI.Graphics();
    ring.lineStyle(2, 0x4488ff, 0.7);
    ring.drawCircle(center.x, center.y, rangePx);
    layer.addChild(ring);

    const cursor = new PIXI.Graphics();
    layer.addChild(cursor);

    let labelText = null;
    if (label) {
      labelText = new PIXI.Text(label, { fontFamily: 'Signika, sans-serif', fontSize: 14, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
      labelText.anchor.set(0.5, 1.2);
      layer.addChild(labelText);
    }

    // Resolution + cleanup wiring.
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const drawCursor = (pos, withinRange, hasSight) => {
      cursor.clear();
      let color = 0x44ff44; // green (ok)
      if (!withinRange)         color = 0xff4444; // red (out of range)
      else if (!hasSight)       color = 0xffbb33; // amber (in range, no sight)
      cursor.lineStyle(2, color, 0.95);
      cursor.drawCircle(pos.x, pos.y, gridSize * 0.4);
      // Crosshair
      cursor.moveTo(pos.x - gridSize * 0.55, pos.y);
      cursor.lineTo(pos.x + gridSize * 0.55, pos.y);
      cursor.moveTo(pos.x, pos.y - gridSize * 0.55);
      cursor.lineTo(pos.x, pos.y + gridSize * 0.55);
      if (labelText) {
        labelText.position.set(pos.x, pos.y - gridSize * 0.5);
      }
    };

    const snap = (pos) => {
      if (!snapToGrid) return pos;
      // Snap to nearest grid center (gridless still snaps to gridSize).
      const sx = Math.round((pos.x - gridSize / 2) / gridSize) * gridSize + gridSize / 2;
      const sy = Math.round((pos.y - gridSize / 2) / gridSize) * gridSize + gridSize / 2;
      return { x: sx, y: sy };
    };

    const checkPos = (pos) => {
      const snapped = snap(pos);
      const dx = snapped.x - center.x;
      const dy = snapped.y - center.y;
      const withinRange = Math.hypot(dx, dy) <= rangePx;
      const hasSight = requireSight
        ? !!canvas.visibility?.testVisibility?.(snapped, { tolerance: 2, object: casterToken })
        : true;
      return { snapped, withinRange, hasSight };
    };

    const onPointerMove = (event) => {
      const pos = event.data?.getLocalPosition?.(canvas.stage)
              ?? canvas.mousePosition
              ?? { x: 0, y: 0 };
      const { snapped, withinRange, hasSight } = checkPos(pos);
      drawCursor(snapped, withinRange, hasSight);
    };

    const onPointerDown = (event) => {
      // Left click commits if valid; otherwise toast and stay open.
      if (event.button !== undefined && event.button !== 0) return;
      const pos = event.data?.getLocalPosition?.(canvas.stage)
              ?? canvas.mousePosition
              ?? { x: 0, y: 0 };
      const { snapped, withinRange, hasSight } = checkPos(pos);
      if (!withinRange) {
        ui.notifications.warn('Destination out of range.');
        return;
      }
      if (requireSight && !hasSight) {
        ui.notifications.warn('Destination is not in sight.');
        return;
      }
      if (event.stopPropagation) event.stopPropagation();
      if (event.preventDefault)  event.preventDefault();
      finish({ x: snapped.x, y: snapped.y, elevation: casterToken.document?.elevation ?? 0 });
    };

    // Tokens absorb left-click before stage. Monkey-patch _onClickLeft for
    // the prompt lifetime to route clicks-on-tokens to our hit-test too.
    const TokenCls = CONFIG.Token.objectClass;
    const origOnClickLeft = TokenCls.prototype._onClickLeft;
    TokenCls.prototype._onClickLeft = function (event) {
      const pos = event?.data?.getLocalPosition?.(canvas.stage)
              ?? canvas.mousePosition
              ?? { x: this.center?.x ?? 0, y: this.center?.y ?? 0 };
      const { snapped, withinRange, hasSight } = checkPos(pos);
      if (!withinRange) {
        ui.notifications.warn('Destination out of range.');
        return;
      }
      if (requireSight && !hasSight) {
        ui.notifications.warn('Destination is not in sight.');
        return;
      }
      if (event?.stopPropagation) event.stopPropagation();
      if (event?.preventDefault)  event.preventDefault();
      finish({ x: snapped.x, y: snapped.y, elevation: casterToken.document?.elevation ?? 0 });
    };

    const onRightDown = () => finish(null);

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        finish(null);
      }
    };

    const cleanup = () => {
      TokenCls.prototype._onClickLeft = origOnClickLeft;
      canvas.stage?.off?.('pointerdown', onPointerDown);
      canvas.stage?.off?.('pointermove', onPointerMove);
      canvas.stage?.off?.('rightdown', onRightDown);
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('aop-targeting');
      try { canvas.stage.removeChild(layer); layer.destroy({ children: true }); } catch { /* noop */ }
      try { ui.notifications.remove(notif); } catch { /* noop */ }
    };

    canvas.stage.on('pointerdown', onPointerDown);
    canvas.stage.on('pointermove', onPointerMove);
    canvas.stage.on('rightdown', onRightDown);
    document.addEventListener('keydown', onKey, true);
  });
}
