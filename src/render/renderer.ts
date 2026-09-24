import { MAP, TIME } from '../config/balance';
import { BUILDINGS, type BuildingType } from '../config/buildings';
import { AGES } from '../config/balance';
import { hash2 } from '../sim/rng';
import { T_SAND, T_WATER, type Building } from '../sim/types';
import type { Game } from '../sim/world';
import { P } from './pixel';
import {
  B_EXTRA,
  JOB_COLORS,
  TS,
  buildingSprite,
  decorSprite,
  grassTile,
  iconSprite,
  personSprite,
  roadTile,
  rockSprite,
  sandTile,
  treeSprite,
  waterTile,
  type IconKind,
} from './sprites';

export class Camera {
  x = (MAP.SIZE * TS) / 2;
  y = (MAP.SIZE * TS) / 2;
  zoom = 2;
  minZoom = 0.6;
  maxZoom = 5;
  clamp() {
    const size = MAP.SIZE * TS;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    this.x = Math.max(0, Math.min(size, this.x));
    this.y = Math.max(0, Math.min(size, this.y));
  }
}

export interface Overlay {
  hoverTile: [number, number] | null;
  preview: {
    type: BuildingType;
    x: number;
    y: number;
    w: number;
    h: number;
    ok: boolean;
  } | null;
  roadTiles: { x: number; y: number; ok: boolean }[];
  demolishTiles: [number, number][];
  selectedBuilding: number | null;
  selectedCitizen: number | null;
  selectedParcel: number | null;
  showParcels: boolean;
  showGrid: boolean;
  tool: string;
  demolishHover: number | null;
}

const STATUS_ICON: Record<string, IconKind> = {
  disconnected: 'noroad',
  nostaff: 'nostaff',
  noresource: 'noresource',
  full: 'full',
};

export class Renderer {
  ctx: CanvasRenderingContext2D;
  cam = new Camera();
  private ground: HTMLCanvasElement;
  private groundVersion = -1;
  dpr = 1;
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ground = document.createElement('canvas');
    this.ground.width = MAP.SIZE * TS;
    this.ground.height = MAP.SIZE * TS;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  /** Coordonnées écran (CSS px) → monde (px). */
  screenToWorld(sx: number, sy: number): [number, number] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return [(sx - w / 2) / this.cam.zoom + this.cam.x, (sy - h / 2) / this.cam.zoom + this.cam.y];
  }
  screenToTile(sx: number, sy: number): [number, number] {
    const [wx, wy] = this.screenToWorld(sx, sy);
    return [Math.floor(wx / TS), Math.floor(wy / TS)];
  }

  private rebuildGround(g: Game) {
    const ctx = this.ground.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const N = g.N;
    const s = g.s;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const t = s.terrain[i];
        const v = Math.floor(hash2(x, y) * 8);
        const px = x * TS;
        const py = y * TS;
        if (t === T_WATER) {
          ctx.drawImage(waterTile(v % 4), px, py);
          // écume sur les bords
          ctx.fillStyle = P.w3;
          const land = (xx: number, yy: number) => g.inBounds(xx, yy) && s.terrain[yy * N + xx] !== T_WATER;
          if (land(x, y - 1)) ctx.fillRect(px, py, TS, 2);
          if (land(x, y + 1)) ctx.fillRect(px, py + TS - 1, TS, 1);
          if (land(x - 1, y)) ctx.fillRect(px, py, 1, TS);
          if (land(x + 1, y)) ctx.fillRect(px + TS - 1, py, 1, TS);
          ctx.fillStyle = P.w4;
          if (land(x, y - 1)) ctx.fillRect(px + (v % 5) + 2, py, 4, 1);
        } else if (t === T_SAND) {
          ctx.drawImage(sandTile(v % 4), px, py);
        } else {
          ctx.drawImage(grassTile(v), px, py);
        }
        if (s.roads[i]) {
          let mask = 0;
          if (y > 0 && s.roads[i - N]) mask |= 1;
          if (x < N - 1 && s.roads[i + 1]) mask |= 2;
          if (y < N - 1 && s.roads[i + N]) mask |= 4;
          if (x > 0 && s.roads[i - 1]) mask |= 8;
          // connexion visuelle vers les bâtiments adjacents
          if (y > 0 && g.occ[i - N] >= 0) mask |= 1;
          if (x < N - 1 && g.occ[i + 1] >= 0) mask |= 2;
          if (y < N - 1 && g.occ[i + N] >= 0) mask |= 4;
          if (x > 0 && g.occ[i - 1] >= 0) mask |= 8;
          ctx.drawImage(roadTile(mask, v % 3), px, py);
        } else if (s.decor[i] && g.occ[i] < 0) {
          ctx.drawImage(decorSprite(s.decor[i], v), px, py);
        }
      }
    this.groundVersion = g.groundVersion;
  }

  draw(g: Game, ov: Overlay, alpha: number, realTime: number) {
    const ctx = this.ctx;
    const cam = this.cam;
    if (this.groundVersion !== g.groundVersion) this.rebuildGround(g);
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const z = cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1d2a1a';
    ctx.fillRect(0, 0, cw, ch);
    const ox = Math.round(cw / 2 - cam.x * z);
    const oy = Math.round(ch / 2 - cam.y * z);
    ctx.setTransform(z, 0, 0, z, ox, oy);

    const N = g.N;
    const x0 = Math.max(0, Math.floor(cam.x / TS - cw / 2 / z / TS) - 2);
    const y0 = Math.max(0, Math.floor(cam.y / TS - ch / 2 / z / TS) - 2);
    const x1 = Math.min(N - 1, Math.ceil(cam.x / TS + cw / 2 / z / TS) + 2);
    const y1 = Math.min(N - 1, Math.ceil(cam.y / TS + ch / 2 / z / TS) + 3);

    ctx.drawImage(this.ground, 0, 0);

    // Reflets animés sur l'eau.
    ctx.fillStyle = P.w3;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (g.s.terrain[y * N + x] !== T_WATER) continue;
        const h = hash2(x, y, 5);
        const phase = (realTime * 0.4 + h * 10) % 4;
        if (phase < 1.2) {
          const px = x * TS + Math.floor(h * 9) + 2;
          const py = y * TS + Math.floor(hash2(y, x, 6) * 12) + 2;
          ctx.fillRect(px + Math.floor(phase * 2), py, 3, 1);
        }
      }

    // Grille de construction.
    if (ov.showGrid) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      for (let x = x0; x <= x1 + 1; x++) ctx.fillRect(x * TS, y0 * TS, 1 / z, (y1 - y0 + 1) * TS);
      for (let y = y0; y <= y1 + 1; y++) ctx.fillRect(x0 * TS, y * TS, (x1 - x0 + 1) * TS, 1 / z);
    }

    // Rayons de couverture.
    const sel = ov.selectedBuilding !== null ? g.bById.get(ov.selectedBuilding) : undefined;
    const radiusOf = (type: BuildingType, level: number) => BUILDINGS[type].radius?.[level - 1] ?? 0;
    const drawRadius = (cx: number, cy: number, r: number, col: string) => {
      ctx.beginPath();
      ctx.arc(cx * TS, cy * TS, r * TS, 0, Math.PI * 2);
      ctx.fillStyle = col + '22';
      ctx.fill();
      ctx.strokeStyle = col + 'cc';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const radiusColor = (t: BuildingType) =>
      t === 'altar' ? '#f0c649' : t === 'clinic' ? '#7fd08a' : t === 'garden' ? '#e38bd0' : t === 'well' ? '#7ab4dc' : '#ffffff';
    if (sel && radiusOf(sel.type, sel.level) > 0) {
      const [cx, cy] = g.center(sel);
      drawRadius(cx, cy, radiusOf(sel.type, sel.level), radiusColor(sel.type));
      // Maisons desservies
      if (sel.type === 'altar' || sel.type === 'clinic' || sel.type === 'garden') {
        for (const h of g.s.buildings) {
          if (h.type !== 'house') continue;
          const served =
            sel.type === 'altar' ? g.altarOf.get(h.id) === sel.id : sel.type === 'clinic' ? g.clinicOf.get(h.id) === sel.id : Math.hypot(g.center(h)[0] - cx, g.center(h)[1] - cy) <= radiusOf('garden', sel.level);
          const inRange = Math.hypot(g.center(h)[0] - cx, g.center(h)[1] - cy) <= radiusOf(sel.type, sel.level);
          if (!inRange) continue;
          ctx.fillStyle = served ? 'rgba(120,230,120,0.35)' : 'rgba(240,80,60,0.35)';
          ctx.fillRect(h.x * TS, h.y * TS, h.w * TS, h.h * TS);
        }
      }
    }
    if (ov.preview && radiusOf(ov.preview.type, 1) > 0) {
      drawRadius(ov.preview.x + ov.preview.w / 2, ov.preview.y + ov.preview.h / 2, radiusOf(ov.preview.type, 1), radiusColor(ov.preview.type));
    }
    // Maisons non couvertes par un autel (quand on place un autel).
    if (ov.preview?.type === 'altar' || sel?.type === 'altar') {
      for (const h of g.s.buildings)
        if (h.type === 'house' && !g.altarOf.has(h.id)) {
          ctx.strokeStyle = 'rgba(240,80,60,0.9)';
          ctx.lineWidth = 1 / cam.zoom;
          ctx.strokeRect(h.x * TS + 0.5, h.y * TS + 0.5, h.w * TS - 1, h.h * TS - 1);
        }
    }

    // Objets triés par profondeur.
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const n = g.nodeAtTile(x, y);
        if (!n) continue;
        items.push({
          y: (y + 1) * TS - 0.1,
          draw: () => {
            if (n.kind === 'tree') {
              const stage = n.state === 'depleted' ? 0 : n.state === 'growing' ? (n.stock / n.max < 0.5 ? 1 : 2) : 3;
              if (stage >= 2) {
                ctx.fillStyle = P.shadow;
                ctx.beginPath();
                ctx.ellipse(x * TS + 9, y * TS + 14, 6, 2.5, 0, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.drawImage(treeSprite(n.variant, stage), x * TS, y * TS - 8);
            } else {
              const stage = n.state === 'depleted' ? 0 : n.state === 'growing' ? 1 : 2;
              ctx.drawImage(rockSprite(n.variant, stage), x * TS, y * TS);
            }
          },
        });
      }
    for (const b of g.s.buildings) {
      if (b.x > x1 + 1 || b.x + b.w < x0 - 1 || b.y > y1 + 2 || b.y + b.h < y0 - 1) continue;
      items.push({ y: (b.y + b.h) * TS, draw: () => this.drawBuilding(g, b, ov, realTime) });
    }
    for (const a of g.agents.list.values()) {
      if (a.mode === 'inside') continue;
      const ax = a.px + (a.x - a.px) * alpha;
      const ay = a.py + (a.y - a.py) * alpha;
      if (ax < x0 - 1 || ax > x1 + 1 || ay < y0 - 1 || ay > y1 + 1) continue;
      const c = g.cById.get(a.id);
      if (!c) continue;
      items.push({
        y: ay * TS + 1,
        draw: () => {
          const job = c.jobId !== null ? BUILDINGS[g.bById.get(c.jobId)?.type ?? 'house'].job : undefined;
          const look = {
            female: c.sex === 'F',
            child: c.age < AGES.ADULT,
            elder: c.age >= AGES.RETIRE,
            shirt: c.age < AGES.ADULT ? JOB_COLORS.child : JOB_COLORS[job ?? 'none'],
            hair: [P.b0, P.b1, P.th1, P.dark, P.red0][c.id % 5],
            skin: [P.skin1, P.skin2, P.skin0][Math.floor(hash2(c.id, 1) * 3)],
          };
          let frame = 0;
          if (a.mode === 'walking') frame = Math.floor(a.walkT * 8) % 4;
          else if (a.mode === 'working') frame = Math.floor(a.walkT * 3) % 2 === 0 ? 0 : 1;
          const spr = personSprite(look, frame);
          const px = Math.round(ax * TS - 5);
          const py = Math.round(ay * TS - 12 - (a.mode === 'walking' && frame % 2 ? 1 : 0));
          ctx.fillStyle = P.shadow;
          ctx.fillRect(px + 2, py + 12, 6, 2);
          if (a.dir < 0) {
            ctx.save();
            ctx.translate(px + 10, py);
            ctx.scale(-1, 1);
            ctx.drawImage(spr, 0, 0);
            ctx.restore();
          } else ctx.drawImage(spr, px, py);
          if (ov.selectedCitizen === c.id) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1 / cam.zoom;
            ctx.strokeRect(px, py - 1, 10, 15);
          }
          if (a.mode === 'working') {
            // petit éclat de travail
            if (Math.floor(a.walkT * 3) % 2 === 1) {
              ctx.fillStyle = P.white;
              ctx.fillRect(px + (a.dir > 0 ? 10 : -1), py + 5, 1, 1);
            }
          }
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // Ambiance hivernale : voile froid léger.
    if (g.seasonIndex === 3) {
      const fade = Math.min(1, g.seasonProgress * 6, (1 - g.seasonProgress) * 6);
      ctx.fillStyle = `rgba(215,232,255,${(0.2 * fade).toFixed(3)})`;
      ctx.fillRect(x0 * TS, y0 * TS, (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS);
      // Flocons au sol (motif fixe) et flocons qui tombent.
      ctx.fillStyle = `rgba(250,252,255,${(0.85 * fade).toFixed(3)})`;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * N + x;
          if (g.s.terrain[i] === T_WATER || g.occ[i] >= 0) continue;
          const h = hash2(x, y, 9);
          ctx.fillRect(x * TS + Math.floor(h * 14) + 1, y * TS + Math.floor(hash2(y, x, 10) * 14) + 1, 1, 1);
          if (h > 0.5) ctx.fillRect(x * TS + Math.floor(hash2(x, y, 11) * 14) + 1, y * TS + Math.floor(h * 13) + 2, 1, 1);
          if (h > 0.8) {
            const fy = (realTime * 18 + h * 400) % (TS * 3);
            ctx.fillRect(x * TS + Math.floor(hash2(x, y, 12) * 15) + Math.round(Math.sin(realTime + h * 6) * 2), y * TS - TS + fy, 1, 1);
          }
        }
    } else if (g.seasonIndex === 2) {
      ctx.fillStyle = 'rgba(255,170,60,0.06)';
      ctx.fillRect(x0 * TS, y0 * TS, (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS);
    }

    // Voile sur les parcelles verrouillées.
    const PC = MAP.PARCEL;
    const PN = N / PC;
    for (let py = 0; py < PN; py++)
      for (let px = 0; px < PN; px++) {
        const idx = py * PN + px;
        if (g.s.parcels[idx]) continue;
        const buyable = g.parcelCheck(px, py).reason !== 'La parcelle doit toucher le territoire possédé';
        ctx.fillStyle = ov.selectedParcel === idx ? 'rgba(30,24,20,0.25)' : buyable && ov.showParcels ? 'rgba(20,16,14,0.38)' : 'rgba(18,14,12,0.52)';
        ctx.fillRect(px * PC * TS, py * PC * TS, PC * TS, PC * TS);
        // hachures légères
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        for (let k = 0; k < PC * 2; k += 2) ctx.fillRect(px * PC * TS + k * 8, py * PC * TS, 2, PC * TS);
        if (ov.showParcels && buyable) {
          ctx.strokeStyle = ov.selectedParcel === idx ? '#f0c649' : 'rgba(240,198,73,0.55)';
          ctx.lineWidth = 2 / cam.zoom;
          ctx.strokeRect(px * PC * TS + 2, py * PC * TS + 2, PC * TS - 4, PC * TS - 4);
        }
      }
    // Limites du territoire.
    ctx.strokeStyle = 'rgba(240,198,73,0.5)';
    ctx.lineWidth = 1.5 / cam.zoom;
    for (let py = 0; py < PN; py++)
      for (let px = 0; px < PN; px++) {
        if (!g.s.parcels[py * PN + px]) continue;
        const X = px * PC * TS;
        const Y = py * PC * TS;
        const S = PC * TS;
        const own = (a: number, b: number) => a >= 0 && b >= 0 && a < PN && b < PN && g.s.parcels[b * PN + a];
        ctx.beginPath();
        if (!own(px, py - 1)) (ctx.moveTo(X, Y), ctx.lineTo(X + S, Y));
        if (!own(px, py + 1)) (ctx.moveTo(X, Y + S), ctx.lineTo(X + S, Y + S));
        if (!own(px - 1, py)) (ctx.moveTo(X, Y), ctx.lineTo(X, Y + S));
        if (!own(px + 1, py)) (ctx.moveTo(X + S, Y), ctx.lineTo(X + S, Y + S));
        ctx.stroke();
      }

    // Routes en prévisualisation.
    for (const t of ov.roadTiles) {
      ctx.globalAlpha = 0.7;
      if (t.ok) ctx.drawImage(roadTile(15, 0), t.x * TS, t.y * TS);
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.ok ? 'rgba(90,220,110,0.35)' : 'rgba(230,60,50,0.45)';
      ctx.fillRect(t.x * TS, t.y * TS, TS, TS);
    }
    for (const [x, y] of ov.demolishTiles) {
      ctx.fillStyle = 'rgba(230,60,50,0.45)';
      ctx.fillRect(x * TS, y * TS, TS, TS);
    }

    // Aperçu de bâtiment.
    if (ov.preview) {
      const pv = ov.preview;
      ctx.globalAlpha = 0.65;
      ctx.drawImage(buildingSprite(pv.type, 1, pv.w, pv.h, g.seasonIndex), pv.x * TS, pv.y * TS - B_EXTRA);
      ctx.globalAlpha = 1;
      ctx.fillStyle = pv.ok ? 'rgba(90,220,110,0.35)' : 'rgba(230,60,50,0.45)';
      for (let yy = pv.y; yy < pv.y + pv.h; yy++)
        for (let xx = pv.x; xx < pv.x + pv.w; xx++) {
          const bad = g.tileBlockReason(xx, yy) !== null;
          ctx.fillStyle = bad ? 'rgba(230,60,50,0.5)' : pv.ok ? 'rgba(90,220,110,0.3)' : 'rgba(230,160,50,0.3)';
          ctx.fillRect(xx * TS, yy * TS, TS, TS);
        }
      ctx.strokeStyle = pv.ok ? '#7de08a' : '#e8574a';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.strokeRect(pv.x * TS, pv.y * TS, pv.w * TS, pv.h * TS);
      // Accès routier potentiel
      if (BUILDINGS[pv.type].needsRoad) {
        for (const [px, py] of g.perimeter(pv)) {
          if (g.roadConnected[py * N + px]) {
            ctx.fillStyle = 'rgba(240,198,73,0.6)';
            ctx.fillRect(px * TS + 5, py * TS + 5, 6, 6);
          }
        }
      }
    }

    // Case survolée.
    if (ov.hoverTile && !ov.preview) {
      const [hx, hy] = ov.hoverTile;
      ctx.strokeStyle = ov.tool === 'demolish' ? 'rgba(240,90,70,0.9)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1 / cam.zoom;
      ctx.strokeRect(hx * TS + 0.5, hy * TS + 0.5, TS - 1, TS - 1);
    }
    void TIME;
  }

  private drawBuilding(g: Game, b: Building, ov: Overlay, realTime: number) {
    const ctx = this.ctx;
    const spr = buildingSprite(b.type, b.level, b.w, b.h, g.seasonIndex);
    // ombre
    ctx.fillStyle = P.shadow;
    ctx.fillRect(b.x * TS + 4, b.y * TS + 6, b.w * TS, b.h * TS - 4);
    ctx.drawImage(spr, b.x * TS, b.y * TS - B_EXTRA);
    const selected = ov.selectedBuilding === b.id;
    const demol = ov.demolishHover === b.id;
    if (selected || demol) {
      ctx.strokeStyle = demol ? '#e8574a' : '#fff6c8';
      ctx.lineWidth = 2 / this.cam.zoom;
      ctx.strokeRect(b.x * TS - 1, b.y * TS - 1, b.w * TS + 2, b.h * TS + 2);
      if (demol) {
        ctx.fillStyle = 'rgba(230,60,50,0.3)';
        ctx.fillRect(b.x * TS, b.y * TS, b.w * TS, b.h * TS);
      }
    }
    // Pastilles de niveau
    if (BUILDINGS[b.type].upgradeCost) {
      for (let k = 0; k < b.level; k++) {
        const px = b.x * TS + 2 + k * 5;
        const py = (b.y + b.h) * TS - 5;
        ctx.fillStyle = P.outline;
        ctx.fillRect(px - 1, py - 1, 5, 5);
        ctx.fillStyle = k < b.level ? P.gold : P.r2;
        ctx.fillRect(px, py, 3, 3);
      }
    }
    // Icône d'état
    const st = g.status.get(b.id);
    if (st && st.status !== 'active' && !(b.type === 'house' && st.status === 'full')) {
      const icon = STATUS_ICON[st.status];
      if (icon) {
        const bob = Math.round(Math.sin(realTime * 3 + b.id) * 1.5);
        const ix = (b.x + b.w / 2) * TS - 7;
        const iy = b.y * TS - B_EXTRA - 6 + bob;
        ctx.fillStyle = 'rgba(20,14,10,0.75)';
        ctx.fillRect(ix - 1, iy - 1, 16, 16);
        ctx.fillStyle = st.status === 'full' ? '#e8b64a' : '#e8574a';
        ctx.fillRect(ix, iy, 14, 14);
        ctx.drawImage(iconSprite(icon), ix + 1, iy + 1);
      }
    }
    // Maison : icône bébé si grossesse en cours
    if (b.type === 'house' && b.reserved > 0) {
      const ix = (b.x + b.w) * TS - 12;
      const iy = b.y * TS - B_EXTRA + 2 + Math.round(Math.sin(realTime * 2 + b.id));
      ctx.drawImage(iconSprite('baby'), ix, iy);
    }
    // Fumée de cheminée l'hiver ou niveau 2+
    if (b.type === 'house' && b.level >= 2 && g.occupants(b.id) > 0) {
      const t = (realTime * 0.8 + b.id * 0.37) % 1;
      ctx.fillStyle = `rgba(220,220,220,${0.55 * (1 - t)})`;
      ctx.fillRect((b.x + b.w) * TS - 12 + Math.round(t * 3), b.y * TS - B_EXTRA - 4 - Math.round(t * 8), 3, 3);
    }
  }
}

/** Minicarte : 2 px par case. */
export function drawMinimap(canvas: HTMLCanvasElement, g: Game, cam: Camera, viewW: number, viewH: number) {
  const ctx = canvas.getContext('2d')!;
  const N = g.N;
  const s = canvas.width / N;
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const col = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const C = {
    grass: col(P.g2),
    sand: col(P.s1),
    water: col(P.w1),
    tree: col(P.l1),
    rock: col(P.r2),
    road: col(P.soil2),
    house: col(P.red2),
    prod: col(P.th2),
    serv: col(P.blue3),
    th: col(P.gold),
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      let c = g.s.terrain[i] === T_WATER ? C.water : g.s.terrain[i] === T_SAND ? C.sand : C.grass;
      const n = g.nodeAt[i] >= 0 ? g.s.nodes[g.nodeAt[i]] : null;
      if (n && n.state !== 'depleted') c = n.kind === 'tree' ? C.tree : C.rock;
      if (g.s.roads[i]) c = C.road;
      const bid = g.occ[i];
      if (bid >= 0) {
        const b = g.bById.get(bid)!;
        c = b.type === 'townhall' ? C.th : b.type === 'house' ? C.house : BUILDINGS[b.type].category === 'resources' ? C.prod : C.serv;
      }
      const locked = !g.s.parcels[g.parcelIndex(x, y)];
      const k = locked ? 0.45 : 1;
      d[i * 4] = c[0] * k;
      d[i * 4 + 1] = c[1] * k;
      d[i * 4 + 2] = c[2] * k;
      d[i * 4 + 3] = 255;
    }
  const tmp = document.createElement('canvas');
  tmp.width = N;
  tmp.height = N;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  // Fenêtre de la caméra
  const vw = viewW / cam.zoom / TS;
  const vh = viewH / cam.zoom / TS;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect((cam.x / TS - vw / 2) * s + 0.5, (cam.y / TS - vh / 2) * s + 0.5, vw * s, vh * s);
}
