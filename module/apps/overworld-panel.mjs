/**
 * Overworld panel — where you are, and what you know is around you.
 *
 * ⚠ TWO AUDIENCES, ONE WINDOW. Players get a diegetic reading: a region name
 * and a direction, no coordinates and no distances in feet. The GM gets the
 * hex, the world coordinate, the exact distance to the crossing, and which
 * neighbouring maps actually exist. A character does not know they are at
 * 15360, 10652; Baldur's Gate never showed a number, it showed an area name
 * and a map that filled in.
 *
 * Availability is GM-only for a reason that is easy to miss: showing players
 * which hexes have imported scenes leaks which parts of the world have been
 * authored, and with ~100 built out of 8145 land hexes that reads as "the
 * continent is empty" rather than "the continent is unwritten".
 */

import {
  areaStampFor, buildStampFor, locate, locateToken, rosette, availableHexes,
  exploredHexes, hexKey,
} from '../systems/overworld.mjs';
import { hexCentreWorld, hexApothemFt, HEX_SIZE_FT } from '../helpers/hexgrid.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const COMPASS = {
  N: 'north', NE: 'north-east', SE: 'south-east',
  S: 'south', SW: 'south-west', NW: 'north-west',
};

/** SVG radius of one hex in the rosette, in px. */
const CELL_R = 34;

export class OverworldPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'aop-overworld-panel',
    classes: ['aspects-of-power', 'aop-overworld'],
    position: { width: 420, height: 'auto' },
    window: { title: 'Overworld', icon: 'fas fa-map-location-dot', resizable: true },
    actions: {
      viewHex: OverworldPanel._onViewHex,
      widen: OverworldPanel._onWiden,
    },
  };

  static PARTS = {
    content: { template: 'systems/aspects-of-power/templates/apps/overworld-panel.hbs' },
  };

  static _instance = null;
  static _radius = 1;

  static toggle() {
    if (OverworldPanel._instance?.rendered) { OverworldPanel._instance.close(); return; }
    OverworldPanel._instance ??= new OverworldPanel();
    OverworldPanel._instance.render(true);
  }

  static refresh() {
    if (OverworldPanel._instance?.rendered) OverworldPanel._instance.render(false);
  }

  /* ---------------------------------------------------------------- */

  /**
   * The token this panel speaks for: the user's own character where there is
   * one, else the controlled token, else any player-owned token on the scene.
   * A GM with nothing selected still gets the scene's location, just not a
   * position inside it.
   */
  _subjectToken(scene) {
    const own = canvas?.tokens?.controlled?.[0];
    if (own) return own.document;
    const mine = scene?.tokens?.find(t => t.actor?.id && t.actor.id === game.user.character?.id);
    if (mine) return mine;
    return scene?.tokens?.find(t => t.actor?.hasPlayerOwner) ?? null;
  }

  /**
   * Distance to the border, in words. Bands are fractions of the apothem
   * (519.6 ft), so they mean the same thing on any hex size.
   */
  static _proximity(distanceFt, edge) {
    const a = hexApothemFt();
    const dir = COMPASS[edge] ?? edge;
    if (distanceFt <= a * 0.15) return `at its ${dir} edge`;
    if (distanceFt <= a * 0.5) return `toward the ${dir}`;
    return 'near its heart';
  }

  async _prepareContext() {
    const isGM = game.user.isGM;
    const scene = canvas?.scene ?? game.scenes?.current ?? null;
    const stamp = scene ? areaStampFor(scene) : null;

    /* No stamp is a normal state, not an error: any scene not imported by
       UVTT+ has no place on the overworld and must say so plainly rather than
       rendering a default location. */
    if (!stamp) {
      return { isGM, unplaced: true,
        reason: scene ? 'This scene has no area stamp.' : 'No active scene.' };
    }

    const token = this._subjectToken(scene);
    const loc = token ? locateToken(token)
      : locate(scene, (scene.width ?? 0) / 2, (scene.height ?? 0) / 2);

    const build = buildStampFor(scene);
    const avail = availableHexes();
    const self = avail.get(hexKey(stamp.hex?.[0], stamp.hex?.[1]));

    const ctx = {
      isGM,
      unplaced: false,
      region: stamp.region ?? 'Unknown country',
      areaId: stamp.id,
      hexLabel: stamp.hex ? `${stamp.hex[0]}, ${stamp.hex[1]}` : null,
      offLattice: !!loc?.offLattice,
      radius: OverworldPanel._radius,
      hasToken: !!token,
      tokenName: token?.name ?? null,
    };

    if (loc && !loc.offLattice) {
      const dir = COMPASS[loc.nearest.edge] ?? loc.nearest.edge;
      const explored = exploredHexes();
      const towardKey = loc.toward ? hexKey(loc.toward[0], loc.toward[1]) : null;
      const towardEntry = towardKey ? avail.get(towardKey) : null;
      const towardKnown = towardKey ? explored.has(towardKey) : false;

      ctx.placed = true;
      ctx.bearing = token
        ? `${ctx.region}, ${OverworldPanel._proximity(loc.nearest.distanceFt, loc.nearest.edge)}.`
        : `${ctx.region}.`;
      /* Players learn what lies beyond only where they have actually been. */
      ctx.beyond = towardKnown && towardEntry?.region
        ? `Beyond, to the ${dir}, lies ${towardEntry.region}.`
        : `Beyond, to the ${dir}, unfamiliar country.`;

      if (isGM) {
        ctx.gm = {
          worldFt: `${Math.round(loc.worldFt[0])}, ${Math.round(loc.worldFt[1])}`,
          offset: `${Math.round(loc.offset[0])}, ${Math.round(loc.offset[1])}`,
          crossing: loc.nearest.edge,
          crossingFt: Math.round(loc.nearest.distanceFt),
          towardId: loc.towardId ?? (loc.toward ? `hex_${loc.toward[0]}_${loc.toward[1]}` : null),
          towardBuilt: !!towardEntry,
          outsideOwnHex: loc.outsideOwnHex,
          build: build ? `${build.generator ?? '?'} / ${build.image_id ?? '?'}` : null,
          /* Absence of provenance IS the signal: pre-fix maps carry no x_build,
             and their origin sits 0.38 ft off their neighbours. */
          noBuild: !build,
          driftFt: self?.driftFt != null ? self.driftFt.toFixed(3) : null,
          stale: !!self?.stale,
        };
      }
    }

    ctx.svg = this._rosetteSvg(stamp.hex, isGM);
    return ctx;
  }

  /**
   * The local rosette as plain SVG data. Drawn from world centres and scaled,
   * rather than hand-placed, so the odd-q stagger is inherited from the same
   * function the rest of the system uses instead of being re-derived here.
   */
  _rosetteSvg(hex, isGM) {
    if (!hex) return null;
    const [col, row] = hex;
    const cells = rosette(col, row, OverworldPanel._radius, { gm: isGM });
    const [ox, oy] = hexCentreWorld(col, row);
    const scale = CELL_R / HEX_SIZE_FT;

    const verts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      verts.push([Math.cos(a) * CELL_R, Math.sin(a) * CELL_R]);
    }

    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    const out = cells.map(c => {
      const [wx, wy] = c.centreWorldFt;
      const x = (wx - ox) * scale, y = (wy - oy) * scale;
      minX = Math.min(minX, x - CELL_R); maxX = Math.max(maxX, x + CELL_R);
      minY = Math.min(minY, y - CELL_R); maxY = Math.max(maxY, y + CELL_R);

      /* Three facts, three visual channels — never collapsed into one state.
         fill = exploration, outline = knowledge, badge = availability (GM). */
      const state = c.explored ? 'explored' : c.known ? 'known' : 'blank';
      return {
        ...c,
        x, y,
        points: verts.map(([vx, vy]) => `${(x + vx).toFixed(1)},${(y + vy).toFixed(1)}`).join(' '),
        state,
        /* A cell with no writing on it is unreadable as a map. The GM always
           gets coordinates; a player gets the region name only where they have
           actually been, since the name is itself knowledge. */
        coord: isGM ? `${c.col},${c.row}` : null,
        placeName: !isGM && c.explored ? c.label : null,
        labelY: y + CELL_R * 0.52,
        /* An unbuilt destination is the GM's normal working state, so the mark
           has to be legible at a glance rather than a dot you go looking for. */
        showBadge: isGM && c.available === true && !c.explored,
        showStale: isGM && c.stale === true,
      };
    });

    const pad = 4;
    return {
      cells: out,
      viewBox: `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} `
        + `${(maxX - minX + pad * 2).toFixed(1)} ${(maxY - minY + pad * 2).toFixed(1)}`,
      width: Math.round(maxX - minX + pad * 2),
      height: Math.round(maxY - minY + pad * 2),
    };
  }

  /* ---------------------------------------------------------------- */

  static async _onViewHex(event, target) {
    if (!game.user.isGM) return;
    const scene = game.scenes?.get(target.dataset.sceneId);
    if (scene) await scene.view();
  }

  static async _onWiden() {
    OverworldPanel._radius = OverworldPanel._radius >= 3 ? 1 : OverworldPanel._radius + 1;
    OverworldPanel.refresh();
  }
}

/**
 * ⚠ REGISTER AT init. `getSceneControlButtons` is a BUILD-TIME hook: it fires
 * on the first controls render and on reset only. A registration added at
 * `ready` reports as attached and never fires.
 */
export function registerOverworldPanel() {
  Hooks.on('getSceneControlButtons', (controls) => {
    const group = controls?.tokens;
    if (!group?.tools) return;
    group.tools.aopOverworld = {
      name: 'aopOverworld',
      order: 91,
      title: 'Overworld',
      icon: 'fas fa-map-location-dot',
      visible: true,
      button: true,
      onChange: () => OverworldPanel.toggle(),
    };
  });

  Hooks.on('canvasReady', () => OverworldPanel.refresh());
  Hooks.on('controlToken', () => OverworldPanel.refresh());
  Hooks.on('updateToken', (doc, changes) => {
    if ('x' in changes || 'y' in changes) OverworldPanel.refresh();
  });

  Hooks.once('ready', () => {
    if (!ui.controls?.controls?.tokens?.tools?.aopOverworld) {
      ui.controls?.render({ reset: true });
    }
  });
}
