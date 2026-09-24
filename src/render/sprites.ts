// Génération procédurale des sprites pixel art, mis en cache.
import type { BuildingType } from '../config/buildings';
import { P, Pix, hashf, type Canvas } from './pixel';

const cache = new Map<string, Canvas>();
function cached(key: string, make: () => Canvas): Canvas {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
}

export const TS = 16;
export const B_EXTRA = 16;

// ====================================================================== terrain
export function grassTile(v: number): Canvas {
  return cached('grass' + v, () => {
    const p = new Pix(16, 16);
    p.r(0, 0, 16, 16, P.g2);
    p.speckle(0, 0, 16, 16, P.g1, 0.16, v * 7 + 1);
    p.speckle(0, 0, 16, 16, P.g3, 0.1, v * 7 + 2);
    for (let k = 0; k < 3; k++) {
      const x = Math.floor(hashf(k, v, 3) * 14) + 1;
      const y = Math.floor(hashf(v, k, 4) * 13) + 2;
      p.p(x, y, P.g4);
      p.p(x, y + 1, P.g3);
    }
    if (v % 3 === 0) p.speckle(0, 0, 16, 16, P.g0, 0.03, v + 9);
    return p.c;
  });
}

export function sandTile(v: number): Canvas {
  return cached('sand' + v, () => {
    const p = new Pix(16, 16);
    p.r(0, 0, 16, 16, P.s1);
    p.speckle(0, 0, 16, 16, P.s0, 0.12, v * 5 + 1);
    p.speckle(0, 0, 16, 16, P.s2, 0.12, v * 5 + 2);
    return p.c;
  });
}

export function waterTile(v: number): Canvas {
  return cached('water' + v, () => {
    const p = new Pix(16, 16);
    p.r(0, 0, 16, 16, P.w1);
    p.speckle(0, 0, 16, 16, P.w0, 0.08, v * 3 + 1);
    for (let k = 0; k < 2; k++) {
      const x = Math.floor(hashf(k, v, 8) * 11);
      const y = Math.floor(hashf(v, k, 9) * 14) + 1;
      p.hline(x, x + 3, y, P.w2);
    }
    return p.c;
  });
}

/** Route de terre et pavés ; mask : N=1, E=2, S=4, O=8. */
export function roadTile(mask: number, v: number): Canvas {
  return cached(`road${mask}_${v}`, () => {
    const p = new Pix(16, 16);
    const inRoad = (x: number, y: number) => {
      if (x >= 3 && x <= 12 && y >= 3 && y <= 12) return true;
      if (mask & 1 && x >= 3 && x <= 12 && y < 3) return true;
      if (mask & 2 && y >= 3 && y <= 12 && x > 12) return true;
      if (mask & 4 && x >= 3 && x <= 12 && y > 12) return true;
      if (mask & 8 && y >= 3 && y <= 12 && x < 3) return true;
      return false;
    };
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (!inRoad(x, y)) continue;
        const h = hashf(x, y, v + 40);
        p.p(x, y, h < 0.15 ? P.soil2 : h < 0.3 ? P.soil0 : P.soil1);
      }
    // pavés
    for (let y = 1; y < 16; y += 3)
      for (let x = (y % 2) * 2; x < 16; x += 4) {
        if (inRoad(x, y) && inRoad(x + 1, y) && hashf(x, y, v + 7) < 0.55) {
          p.p(x, y, P.s1);
          p.p(x + 1, y, P.s2);
          p.p(x, y + 1, P.soil0);
          p.p(x + 1, y + 1, P.soil0);
        }
      }
    // bordures
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (!inRoad(x, y)) continue;
        const edge = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(([a, b]) => a >= 0 && b >= 0 && a < 16 && b < 16 && !inRoad(a, b));
        if (edge) p.p(x, y, P.b1);
      }
    return p.c;
  });
}

export function decorSprite(kind: number, v: number): Canvas {
  return cached(`decor${kind}_${v}`, () => {
    const p = new Pix(16, 16);
    const ox = Math.floor(hashf(v, kind, 1) * 6) + 2;
    const oy = Math.floor(hashf(kind, v, 2) * 6) + 4;
    switch (kind) {
      case 1: {
        const cols = [P.flowerY, P.flowerW, P.flowerP, P.flowerR];
        for (let k = 0; k < 4; k++) {
          const x = ox + Math.floor(hashf(k, v, 5) * 7);
          const y = oy + Math.floor(hashf(v, k, 6) * 6);
          p.p(x, y + 1, P.l2);
          p.p(x, y, cols[(k + v) % 4]);
        }
        break;
      }
      case 2:
        p.ell(ox + 3, oy + 3, 3.5, 2.8, P.l2);
        p.ell(ox + 2.5, oy + 2.2, 2, 1.5, P.l3);
        p.p(ox + 2, oy + 1, P.l4);
        p.outline(P.l0);
        break;
      case 3:
        p.r(ox, oy + 2, 2, 1, P.r2);
        p.p(ox, oy + 1, P.r3);
        p.r(ox + 4, oy + 4, 1, 1, P.r2);
        p.r(ox + 3, oy, 2, 1, P.r3);
        break;
      case 4:
        p.vline(ox + 1, oy + 2, oy + 3, P.m3);
        p.r(ox, oy + 1, 3, 1, P.berry);
        p.p(ox + 1, oy, P.berry);
        p.p(ox, oy + 1, P.white);
        p.vline(ox + 5, oy + 4, oy + 5, P.m3);
        p.r(ox + 4, oy + 3, 3, 1, P.b3);
        break;
      default:
        for (let k = 0; k < 5; k++) {
          const x = ox + k * 2;
          p.vline(x, oy + 2 - (k % 2), oy + 4, k % 2 ? P.g3 : P.g1);
        }
    }
    return p.c;
  });
}

// ====================================================================== nœuds
/** Arbres : 16×24. stage : 0 épuisé, 1 pousse, 2 jeune, 3 adulte. */
export function treeSprite(variant: number, stage: number): Canvas {
  return cached(`tree${variant}_${stage}`, () => {
    const p = new Pix(16, 24);
    if (stage === 0) {
      p.r(5, 18, 6, 4, P.b2);
      p.r(5, 17, 6, 2, P.b3);
      p.r(7, 17, 2, 1, P.b1);
      p.p(4, 21, P.b1);
      p.p(11, 21, P.b1);
      p.outline();
      return p.c;
    }
    if (stage === 1) {
      p.vline(8, 17, 21, P.b2);
      p.r(6, 16, 2, 2, P.l3);
      p.r(9, 17, 2, 2, P.l2);
      p.p(8, 15, P.l4);
      p.outline(P.l0);
      return p.c;
    }
    const s = stage === 2 ? 0.65 : 1;
    const cy = 22 - 13 * s;
    if (variant === 1) {
      // sapin
      p.r(7, 19, 2, 4, P.b1);
      const layers = [
        [cy + 7 * s, 6.5 * s],
        [cy + 3 * s, 5 * s],
        [cy - 1 * s, 3.5 * s],
      ];
      for (const [ly, lw] of layers) {
        for (let k = 0; k < 5 * s + 1; k++) {
          const half = (lw * (k + 1)) / (5 * s + 1);
          p.hline(Math.round(8 - half), Math.round(7 + half), Math.round(ly - 5 * s + k), k > 3 * s ? P.l1 : P.l2);
        }
      }
      p.p(8, Math.round(cy - 6 * s), P.l3);
      p.speckle(3, 2, 10, 18, P.l3, 0.08, 11);
      p.outline(P.l0);
      return p.c;
    }
    const leaf = variant === 2 ? [P.l2, P.l3, P.l4, P.g4] : [P.l1, P.l2, P.l3, P.l4];
    if (variant === 2) {
      p.r(7, 13, 2, 10, P.m3);
      p.p(7, 16, P.dark);
      p.p(8, 19, P.dark);
    } else {
      p.r(7, 15, 2, 8, P.b1);
      p.p(8, 15, P.b2);
      p.p(6, 22, P.b1);
      p.p(9, 22, P.b1);
    }
    const r = 6.8 * s;
    p.ell(8, cy, r, r * 0.9, leaf[0]);
    p.ell(7.5, cy - 0.8, r * 0.85, r * 0.75, leaf[1]);
    p.ell(6.5, cy - 2, r * 0.5, r * 0.45, leaf[2]);
    p.speckle(2, 1, 12, 16, leaf[3], 0.05, variant + 3);
    p.speckle(2, 1, 12, 16, leaf[0], 0.03, variant + 5);
    p.outline(P.l0);
    return p.c;
  });
}

/** Rochers : 16×16. stage : 0 épuisé, 1 reconstitution, 2 plein. */
export function rockSprite(variant: number, stage: number): Canvas {
  return cached(`rock${variant}_${stage}`, () => {
    const p = new Pix(16, 16);
    if (stage === 0) {
      p.r(3, 12, 2, 1, P.r2);
      p.r(8, 13, 3, 1, P.r1);
      p.p(11, 11, P.r2);
      p.p(6, 10, P.r3);
      return p.c;
    }
    const s = stage === 1 ? 0.6 : 1;
    const cx = 8 + (variant - 1) * 0.6;
    p.ell(cx, 14 - 5 * s, 6.5 * s, 5 * s, P.r1);
    p.ell(cx - 0.5, 13 - 5 * s, 5.5 * s, 4 * s, P.r2);
    p.ell(cx - 1.5, 12 - 5.5 * s, 3 * s, 2 * s, P.r3);
    if (variant !== 1 && stage === 2) {
      p.ell(cx + 4, 13, 2.5, 2, P.r1);
      p.ell(cx + 3.7, 12.6, 1.8, 1.3, P.r2);
    }
    p.speckle(2, 3, 12, 11, P.r4, 0.04, variant + 20);
    p.speckle(2, 3, 12, 11, P.r0, 0.04, variant + 21);
    if (variant === 2 && stage === 2) {
      p.p(cx - 2, 9, P.gold);
      p.p(cx + 1, 11, P.gold);
    }
    p.outline();
    return p.c;
  });
}

// ====================================================================== bâtiments
type Ramp = [string, string, string, string];
const RED: Ramp = [P.red0, P.red1, P.red2, P.red3];
const BLUE: Ramp = [P.blue0, P.blue1, P.blue2, P.blue3];
const THATCH: Ramp = [P.th0, P.th1, P.th2, P.th3];
const GREEN: Ramp = [P.grn0, P.grn1, P.grn2, P.l3];
const STONE: Ramp = [P.r0, P.r1, P.r2, P.r3];
const WOOD: Ramp = [P.b0, P.b1, P.b2, P.b3];
const PLASTER: Ramp = [P.m0, P.m1, P.m2, P.m3];

function roof(p: Pix, x: number, y: number, w: number, h: number, ramp: Ramp, style: 'tile' | 'thatch' | 'slate' = 'tile') {
  const ridge = y + Math.max(2, Math.round(h * 0.32));
  for (let yy = y; yy < y + h; yy++) {
    const back = yy < ridge;
    let col = back ? ramp[2] : ramp[1];
    if (yy === ridge) col = ramp[3];
    p.hline(x, x + w - 1, yy, col);
    const rel = yy - ridge;
    if (!back && rel > 0) {
      if (style === 'tile' && rel % 3 === 0) {
        p.hline(x, x + w - 1, yy, ramp[0]);
      } else if (style === 'tile') {
        for (let xx = x + ((rel >> 1) % 2) * 2; xx < x + w; xx += 4) p.p(xx, yy, ramp[0]);
      } else if (style === 'thatch') {
        for (let xx = x; xx < x + w; xx++) if (hashf(xx, yy, 3) < 0.3) p.p(xx, yy, hashf(xx, yy, 4) < 0.5 ? ramp[0] : ramp[2]);
      } else if (rel % 2 === 0) {
        for (let xx = x + (rel % 4); xx < x + w; xx += 3) p.p(xx, yy, ramp[0]);
      }
    } else if (back && style !== 'slate') {
      for (let xx = x; xx < x + w; xx++) if (hashf(xx, yy, 5) < 0.12) p.p(xx, yy, ramp[1]);
    }
  }
  p.hline(x, x + w - 1, y + h - 1, ramp[0]);
  p.hline(x + 1, x + w - 2, y, ramp[3]);
}

function wall(p: Pix, x: number, y: number, w: number, h: number, ramp: Ramp, kind: 'plaster' | 'stone' | 'log' | 'plank' = 'plaster') {
  p.r(x, y, w, h, ramp[2]);
  if (kind === 'stone') {
    for (let yy = y; yy < y + h; yy++) {
      const row = yy - y;
      if (row % 3 === 2) p.hline(x, x + w - 1, yy, ramp[1]);
      else for (let xx = x + (Math.floor(row / 3) % 2) * 2; xx < x + w; xx += 4) p.p(xx, yy, ramp[1]);
    }
    p.speckle(x, y, w, h, ramp[3], 0.08, w + h);
  } else if (kind === 'log') {
    for (let yy = y; yy < y + h; yy += 2) p.hline(x, x + w - 1, yy, ramp[1]);
    for (let yy = y; yy < y + h; yy += 2) {
      p.p(x, yy, ramp[3]);
      p.p(x + w - 1, yy, ramp[3]);
    }
  } else if (kind === 'plank') {
    for (let xx = x; xx < x + w; xx += 3) p.vline(xx, y, y + h - 1, ramp[1]);
  } else {
    p.speckle(x, y, w, h, ramp[1], 0.06, w * 3 + h);
  }
  p.hline(x, x + w - 1, y, ramp[0]);
  p.hline(x, x + w - 1, y + h - 1, ramp[0]);
}

function timber(p: Pix, x: number, y: number, w: number, h: number) {
  p.vline(x, y, y + h - 1, P.b1);
  p.vline(x + w - 1, y, y + h - 1, P.b1);
  p.hline(x, x + w - 1, y + Math.floor(h / 2), P.b1);
}

function door(p: Pix, x: number, y: number, w: number, h: number, col = P.b1) {
  p.r(x - 1, y - 1, w + 2, h + 1, P.b0);
  p.r(x, y, w, h, col);
  for (let xx = x + 1; xx < x + w; xx += 2) p.vline(xx, y + 1, y + h - 1, P.b0);
  p.p(x + w - 2, y + Math.floor(h / 2), P.gold);
}

function windowAt(p: Pix, x: number, y: number, lit = false) {
  p.r(x - 1, y - 1, 6, 6, P.b0);
  p.r(x, y, 4, 4, lit ? P.glow : P.w2);
  p.p(x, y, lit ? P.white : P.w3);
  p.p(x + 1, y, lit ? P.white : P.w3);
  p.vline(x + 2, y, y + 3, P.b1);
  p.hline(x, x + 3, y + 2, P.b1);
}

function flowerBox(p: Pix, x: number, y: number) {
  p.r(x - 1, y, 6, 2, P.b2);
  p.p(x, y - 1, P.flowerR);
  p.p(x + 2, y - 1, P.flowerY);
  p.p(x + 3, y - 1, P.flowerP);
  p.p(x + 1, y - 1, P.l3);
}

function chimney(p: Pix, x: number, y: number) {
  p.r(x, y, 4, 7, P.r1);
  p.r(x, y, 4, 1, P.r3);
  p.p(x + 1, y + 3, P.r0);
  p.p(x + 2, y + 5, P.r0);
}

function logPile(p: Pix, x: number, y: number, n: number) {
  for (let row = 0; row < 3; row++)
    for (let k = 0; k < n - row; k++) {
      const cx = x + k * 4 + row * 2;
      const cy = y - row * 3;
      p.r(cx, cy, 4, 3, P.b3);
      p.p(cx + 1, cy + 1, P.b2);
      p.p(cx + 2, cy + 1, P.b4);
      p.hline(cx, cx + 3, cy + 2, P.b1);
    }
}

function stoneBlocks(p: Pix, x: number, y: number, n: number) {
  for (let k = 0; k < n; k++) {
    const bx = x + (k % 3) * 6 - Math.floor(k / 3) * 3;
    const by = y - Math.floor(k / 3) * 5;
    p.r(bx, by, 6, 5, P.r2);
    p.r(bx, by, 6, 2, P.r3);
    p.vline(bx + 5, by, by + 4, P.r1);
    p.hline(bx, bx + 5, by + 4, P.r1);
  }
}

function fence(p: Pix, x: number, y: number, w: number, h: number) {
  for (let xx = x; xx < x + w; xx++) {
    p.p(xx, y, P.b2);
    p.p(xx, y + h - 1, P.b2);
    if ((xx - x) % 4 === 0) {
      p.p(xx, y - 1, P.b3);
      p.p(xx, y + h - 2, P.b3);
    }
  }
  for (let yy = y; yy < y + h; yy++) {
    p.p(x, yy, P.b2);
    p.p(x + w - 1, yy, P.b2);
  }
}

function levelDecor(p: Pix, W: number, level: number) {
  // Fanion de niveau (1 à 3 bandes dorées).
  if (level < 2) return;
  const x = W - 7;
  p.vline(x, 1, 12, P.b1);
  p.r(x + 1, 1, 5, 4 + (level - 2) * 2, level === 3 ? P.gold : P.blue2);
  p.p(x + 5, 5 + (level - 2) * 2, P.outline);
}

export function buildingSprite(type: BuildingType, level: number, w: number, h: number, season = 0): Canvas {
  return cached(`b_${type}_${level}_${w}x${h}_${type === 'farm' ? season : 0}`, () => {
    const W = w * TS;
    const H = h * TS + B_EXTRA;
    const p = new Pix(W, H);
    const E = B_EXTRA;
    const fy = E; // haut de l'empreinte
    const FH = h * TS;
    switch (type) {
      case 'townhall': {
        const wallH = 22;
        const wy = H - wallH - 2;
        roof(p, 1, fy - 2, W - 2, wy - fy + 4, BLUE, 'slate');
        wall(p, 3, wy, W - 6, wallH, STONE, 'stone');
        // tour centrale
        const tx = W / 2 - 9;
        wall(p, tx, 8, 18, wy - 6, STONE, 'stone');
        p.r(tx - 2, 2, 22, 8, P.blue1);
        p.r(tx, 0, 18, 3, P.blue2);
        p.hline(tx - 2, tx + 19, 9, P.blue0);
        // horloge
        p.ell(W / 2, 18, 4, 4, P.m3);
        p.p(W / 2, 16, P.dark);
        p.p(W / 2, 17, P.dark);
        p.p(W / 2 + 1, 18, P.dark);
        // drapeau
        p.vline(W / 2, 0, 3, P.b1);
        // porte en arc
        door(p, W / 2 - 5, H - 14, 10, 12, P.b2);
        p.hline(W / 2 - 4, W / 2 + 3, H - 15, P.b0);
        windowAt(p, 9, wy + 6, true);
        windowAt(p, 19, wy + 6);
        windowAt(p, W - 23, wy + 6);
        windowAt(p, W - 13, wy + 6, true);
        // bannières
        for (let k = 0; k < level; k++) {
          const bx = W / 2 - 16 + k * 26 - (level === 1 ? -16 : level === 2 ? -3 : 0);
          p.r(bx, wy + 3, 4, 9, P.red1);
          p.p(bx + 1, wy + 11, P.red1);
          p.p(bx + 1, wy + 5, P.gold);
          p.p(bx + 2, wy + 5, P.gold);
        }
        break;
      }
      case 'house': {
        const wallH = w >= h ? 14 : 13;
        const wy = H - wallH - 1;
        const ramp = level === 3 ? BLUE : RED;
        roof(p, 1, fy - (level === 3 ? 10 : 7), W - 2, wy - fy + (level === 3 ? 12 : 9), ramp, 'tile');
        if (level >= 2) chimney(p, W - 14, fy - 12);
        wall(p, 3, wy, W - 6, wallH, PLASTER);
        if (level === 3) p.r(3, H - 4, W - 6, 3, P.r2), p.hline(3, W - 4, H - 4, P.r3);
        timber(p, 3, wy, W - 6, wallH);
        const dx = Math.floor(W / 2) - 3;
        door(p, dx, H - 11, 6, 10);
        if (W >= 48) {
          windowAt(p, 10, wy + 4, level >= 2);
          windowAt(p, W - 14, wy + 4);
          if (level >= 2) {
            flowerBox(p, 10, wy + 9);
            flowerBox(p, W - 14, wy + 9);
          }
        } else {
          windowAt(p, 6, wy + 3);
          if (level >= 2) flowerBox(p, 6, wy + 8);
        }
        if (level === 3) {
          // lucarne
          const lx = W / 2 - 3;
          const ly = fy - 3;
          p.r(lx - 1, ly - 2, 8, 8, P.m2);
          p.hline(lx - 2, lx + 7, ly - 3, P.blue0);
          windowAt(p, lx + 1, ly, true);
        }
        break;
      }
      case 'woodcutter': {
        const wy = H - 16;
        roof(p, 1, fy - 6, 32, wy - fy + 8, THATCH, 'thatch');
        wall(p, 3, wy, 28, 14, WOOD, 'log');
        door(p, 13, H - 11, 6, 9);
        windowAt(p, 5, wy + 4);
        logPile(p, 33, H - 6, 3);
        // billot + hache
        p.r(36, fy + 6, 7, 5, P.b2);
        p.r(36, fy + 5, 7, 2, P.b3);
        p.vline(40, fy - 1, fy + 5, P.b1);
        p.r(40, fy - 2, 4, 3, P.r3);
        if (level >= 2) logPile(p, 33, fy + 20, 2);
        break;
      }
      case 'stonecutter': {
        const wy = H - 16;
        roof(p, 1, fy - 4, 30, wy - fy + 6, [P.r0, P.r1, P.r2, P.r3], 'slate');
        wall(p, 3, wy, 26, 14, STONE, 'stone');
        door(p, 12, H - 11, 6, 9);
        stoneBlocks(p, 32, H - 7, level >= 2 ? 5 : 3);
        // pioche
        p.vline(36, fy + 2, fy + 10, P.b1);
        p.hline(33, 40, fy + 2, P.r3);
        p.p(32, fy + 3, P.r3);
        p.p(41, fy + 3, P.r3);
        break;
      }
      case 'gatherer': {
        const cx = 18;
        p.ell(cx, H - 12, 15, 9, P.th1);
        p.ell(cx, H - 18, 12, 11, P.th2);
        p.ell(cx - 3, H - 23, 6, 5, P.th3);
        p.speckle(3, H - 30, 30, 26, P.th0, 0.12, 4);
        p.vline(cx, H - 32, H - 28, P.b1);
        door(p, cx - 3, H - 10, 6, 8);
        // paniers
        const bk = (x: number, y: number, fruit: string) => {
          p.r(x, y, 7, 5, P.b3);
          p.hline(x, x + 6, y + 2, P.b2);
          p.r(x + 1, y - 2, 5, 2, fruit);
          p.p(x + 2, y - 3, fruit);
        };
        bk(W - 12, H - 8, P.berry);
        bk(W - 13, H - 20, P.flowerP);
        if (level >= 2) bk(W - 20, H - 6, P.th3);
        break;
      }
      case 'well': {
        const cx = W / 2;
        const cy = H - 10;
        p.ell(cx, cy, 12, 8, P.r1);
        p.ell(cx, cy - 1, 11, 7, P.r2);
        p.ell(cx, cy - 2, 8, 4.5, P.r0);
        p.ell(cx, cy - 2, 7, 3.5, P.w1);
        p.p(cx - 3, cy - 3, P.w3);
        for (let k = -10; k <= 10; k += 4) p.p(cx + k, cy + 2, P.r3);
        // poteaux et toit
        p.r(cx - 11, cy - 22, 2, 20, P.b1);
        p.r(cx + 9, cy - 22, 2, 20, P.b1);
        p.hline(cx - 10, cx + 10, cy - 18, P.b2);
        roof(p, cx - 14, cy - 30, 28, 9, level >= 2 ? BLUE : RED, 'tile');
        p.vline(cx, cy - 17, cy - 8, P.m1);
        p.r(cx - 2, cy - 8, 4, 3, P.b2);
        p.hline(cx - 2, cx + 1, cy - 8, P.r2);
        break;
      }
      case 'farm': {
        // champ
        const fx = 2;
        const fyy = fy + 2;
        const fw = W - 4;
        const fh = FH - 4;
        p.r(fx, fyy, fw, fh, P.soil1);
        for (let yy = fyy; yy < fyy + fh; yy++) {
          if ((yy - fyy) % 4 === 0) p.hline(fx, fx + fw - 1, yy, P.soil0);
        }
        const crop = [
          [P.l3, P.l4],
          [P.l2, P.l3],
          [P.th2, P.th3],
          [P.soil2, P.white],
        ][season];
        for (let yy = fyy + 1; yy < fyy + fh - 1; yy += 4)
          for (let xx = fx + 1; xx < fx + fw - 1; xx += 2) {
            if (xx < fx + 26 && yy < fyy + 22) continue;
            const tall = season === 1 || season === 2 ? 2 : 1;
            if (season === 3) {
              if (hashf(xx, yy, 2) < 0.4) p.p(xx, yy + 1, P.white);
              continue;
            }
            p.vline(xx, yy + 2 - tall, yy + 1, crop[0]);
            if (hashf(xx, yy, 1) < 0.5) p.p(xx, yy + 1 - tall, crop[1]);
          }
        fence(p, 1, fy + 1, W - 2, FH - 2);
        // grange
        roof(p, 2, fy - 6, 26, 16, RED, 'tile');
        wall(p, 4, fy + 10, 22, 12, WOOD, 'plank');
        door(p, 11, fy + 13, 8, 9, P.red1);
        p.p(12, fy + 15, P.white);
        p.p(17, fy + 15, P.white);
        if (level >= 2) {
          // silo
          p.r(W - 14, fy - 8, 10, 22, P.r2);
          p.ell(W - 9, fy - 8, 5, 3, P.red2);
          p.vline(W - 12, fy - 5, fy + 12, P.r3);
        }
        break;
      }
      case 'granary': {
        const wy = H - 22;
        roof(p, 1, fy - 8, W - 2, wy - fy + 10, RED, 'tile');
        if (level >= 2) {
          p.r(W / 2 - 4, fy - 12, 8, 5, P.b2);
          p.hline(W / 2 - 5, W / 2 + 4, fy - 13, P.red0);
        }
        wall(p, 3, wy, W - 6, 20, WOOD, 'plank');
        const dx = W / 2 - 7;
        p.r(dx - 1, H - 17, 16, 16, P.b0);
        p.r(dx, H - 16, 14, 15, P.b2);
        for (let k = 0; k < 14; k++) {
          p.p(dx + k, H - 16 + Math.floor((k * 15) / 14), P.b1);
          p.p(dx + 13 - k, H - 16 + Math.floor((k * 15) / 14), P.b1);
        }
        p.vline(dx + 7, H - 16, H - 2, P.b0);
        // sacs
        const sack = (x: number, y: number) => {
          p.ell(x, y, 3, 3, P.m2);
          p.ell(x - 0.5, y - 0.5, 2, 2, P.m3);
          p.p(x, y - 3, P.b1);
        };
        sack(6, H - 4);
        sack(W - 6, H - 4);
        if (level >= 3) sack(W - 10, H - 3);
        break;
      }
      case 'altar': {
        const cx = W / 2;
        p.r(3, H - 12, W - 6, 10, P.r1);
        p.r(4, H - 13, W - 8, 9, P.r2);
        p.r(6, H - 15, W - 12, 5, P.r3);
        p.hline(4, W - 5, H - 4, P.r0);
        // menhir
        const mh = 18 + level * 4;
        p.r(cx - 3, H - 15 - mh, 6, mh, P.r2);
        p.r(cx - 3, H - 15 - mh, 2, mh, P.r3);
        p.r(cx - 2, H - 16 - mh, 4, 1, P.r2);
        // glyphe
        p.p(cx, H - 10 - mh, P.gold);
        p.vline(cx, H - 8 - mh, H - 5 - mh, P.gold);
        p.hline(cx - 1, cx + 1, H - 7 - mh, P.gold);
        // bougies
        for (const bx of [7, W - 8]) {
          p.r(bx, H - 18, 2, 4, P.white);
          p.p(bx, H - 19, P.flowerY);
          p.p(bx + 1, H - 20, P.glow);
        }
        p.p(5, H - 5, P.flowerP);
        p.p(W - 6, H - 6, P.flowerY);
        break;
      }
      case 'school': {
        const wy = H - 18;
        roof(p, 1, fy - 6, W - 2, wy - fy + 8, BLUE, 'slate');
        wall(p, 3, wy, W - 6, 16, PLASTER);
        // clocheton
        const cx = W / 2;
        p.r(cx - 5, fy - 14, 10, 10, P.m2);
        p.r(cx - 3, fy - 12, 6, 6, P.b0);
        p.ell(cx, fy - 8, 2, 2, P.gold);
        p.r(cx - 7, fy - 17, 14, 3, P.blue1);
        p.hline(cx - 5, cx + 4, fy - 18, P.blue2);
        door(p, cx - 3, H - 12, 6, 10);
        for (const wx of [8, 18, W - 24, W - 14]) windowAt(p, wx, wy + 5);
        // tableau
        p.r(W - 8, H - 10, 6, 6, P.b1);
        p.r(W - 7, H - 9, 4, 3, P.grn0);
        p.p(W - 6, H - 8, P.white);
        break;
      }
      case 'clinic': {
        const wy = H - 18;
        roof(p, 1, fy - 6, W - 2, wy - fy + 8, GREEN, 'tile');
        wall(p, 3, wy, W - 6, 16, [P.m1, P.m2, P.white, P.white], 'plaster');
        door(p, W / 2 - 3, H - 12, 6, 10, P.grn1);
        windowAt(p, 7, wy + 5);
        windowAt(p, W - 11, wy + 5);
        // enseigne feuille
        p.r(W / 2 - 4, wy - 7, 8, 7, P.white);
        p.hline(W / 2 - 4, W / 2 + 3, wy - 7, P.m1);
        p.ell(W / 2, wy - 3.5, 2.5, 2, P.l3);
        p.vline(W / 2, wy - 5, wy - 2, P.l1);
        // pots d'herbes
        for (const px of [5, W - 8]) {
          p.r(px, H - 5, 4, 3, P.red2);
          p.r(px, H - 7, 4, 2, P.l3);
          p.p(px + 1, H - 8, P.l4);
        }
        if (level >= 2) chimney(p, 8, fy - 10);
        break;
      }
      case 'garden': {
        p.r(2, fy + 2, W - 4, FH - 4, P.g3);
        // haies
        for (let xx = 2; xx < W - 2; xx++) {
          p.p(xx, fy + 2, P.l2);
          p.p(xx, fy + 3, P.l1);
          p.p(xx, H - 3, P.l1);
          p.p(xx, H - 4, P.l2);
        }
        for (let yy = fy + 2; yy < H - 2; yy++) {
          p.p(2, yy, P.l1);
          p.p(3, yy, P.l2);
          p.p(W - 3, yy, P.l1);
          p.p(W - 4, yy, P.l2);
        }
        p.speckle(4, fy + 4, W - 8, FH - 8, P.g4, 0.08, 17);
        const cols = [P.flowerR, P.flowerY, P.flowerP, P.flowerW];
        for (let k = 0; k < 10 + level * 6; k++) {
          const x = 5 + Math.floor(hashf(k, 1, level) * (W - 10));
          const y = fy + 5 + Math.floor(hashf(1, k, level) * (FH - 10));
          p.p(x, y, cols[k % 4]);
        }
        // fontaine
        const cx = W / 2;
        const cy = fy + FH / 2;
        p.ell(cx, cy + 1, 6, 4, P.r1);
        p.ell(cx, cy, 5, 3, P.r3);
        p.ell(cx, cy, 3.5, 2, P.w2);
        p.vline(cx, cy - 6, cy - 1, P.r2);
        p.p(cx, cy - 7, P.w3);
        p.p(cx - 1, cy - 6, P.w4);
        p.p(cx + 1, cy - 5, P.w4);
        if (level >= 3) {
          p.r(5, fy + 6, 2, 6, P.b2);
          p.r(W - 7, fy + 6, 2, 6, P.b2);
        }
        break;
      }
    }
    p.outline();
    levelDecor(p, W, type === 'townhall' || type === 'house' ? 1 : level);
    return p.c;
  });
}

// ====================================================================== habitants
export interface PersonLook {
  female: boolean;
  child: boolean;
  elder: boolean;
  shirt: string;
  hair: string;
  skin: string;
}

export const JOB_COLORS: Record<string, string> = {
  woodcutter: P.grn1,
  stonecutter: P.r1,
  gatherer: P.flowerP,
  farmer: P.th1,
  waterbearer: P.blue2,
  teacher: '#7a4f8f',
  healer: P.white,
  none: P.m0,
  child: P.flowerY,
};

export function personSprite(look: PersonLook, frame: number): Canvas {
  const key = `p${+look.female}${+look.child}${+look.elder}${look.shirt}${look.hair}${look.skin}${frame}`;
  return cached(key, () => {
    const p = new Pix(10, 14);
    const s = look.child ? 1 : 0;
    const top = look.child ? 4 : 1;
    const hx = 3;
    const hair = look.elder ? P.r3 : look.hair;
    // tête
    p.r(hx, top, 4, 4, look.skin);
    p.r(hx, top, 4, 1, hair);
    p.p(hx, top + 1, hair);
    p.p(hx + 3, top + 1, hair);
    if (look.female) {
      p.vline(hx - 1, top + 1, top + 4, hair);
      p.vline(hx + 4, top + 1, top + 4, hair);
    }
    p.p(hx + 1, top + 2, P.dark);
    p.p(hx + 2, top + 2, P.dark);
    // corps
    const by = top + 4;
    const bh = look.child ? 3 : 5;
    p.r(hx, by, 4, bh, look.shirt);
    const armSwing = frame % 2 === 0 ? 0 : 1;
    p.vline(hx - 1, by + armSwing, by + bh - 2 + armSwing, look.shirt);
    p.vline(hx + 4, by + 1 - armSwing, by + bh - 1 - armSwing, look.shirt);
    p.p(hx - 1, by + bh - 1 + armSwing, look.skin);
    p.p(hx + 4, by + bh - armSwing, look.skin);
    if (look.female && !look.child) {
      p.r(hx - 1, by + bh - 1, 6, 2, look.shirt);
    }
    // jambes
    const ly = by + bh + (look.female && !look.child ? 1 : 0);
    const legH = look.child ? 2 : 3 - (look.female ? 1 : 0);
    const pants = look.female ? P.b1 : P.b0;
    if (frame === 1) {
      p.vline(hx, ly, ly + legH - 1, pants);
      p.vline(hx + 3, ly, ly + legH - 2, pants);
    } else if (frame === 3) {
      p.vline(hx, ly, ly + legH - 2, pants);
      p.vline(hx + 3, ly, ly + legH - 1, pants);
    } else {
      p.vline(hx + 1, ly, ly + legH - 1, pants);
      p.vline(hx + 2, ly, ly + legH - 1, pants);
    }
    if (look.elder) p.vline(hx + 5, by + 2, by + bh + 2, P.b2);
    void s;
    p.outline();
    return p.c;
  });
}

// ====================================================================== icônes
export type IconKind =
  | 'food'
  | 'water'
  | 'wood'
  | 'stone'
  | 'pop'
  | 'happy'
  | 'warn'
  | 'noroad'
  | 'nostaff'
  | 'noresource'
  | 'full'
  | 'baby'
  | 'road'
  | 'demolish'
  | 'parcel'
  | 'select'
  | 'health'
  | 'edu'
  | 'house'
  | 'work'
  | 'child'
  | 'elder';

export function iconSprite(kind: IconKind): Canvas {
  return cached('icon' + kind, () => {
    const p = new Pix(12, 12);
    switch (kind) {
      case 'food':
        p.ell(6, 7, 4.5, 4, P.red2);
        p.ell(5, 6, 2, 1.8, P.red3);
        p.vline(6, 1, 3, P.b1);
        p.r(7, 1, 3, 2, P.l3);
        break;
      case 'water':
        for (let y = 1; y < 11; y++) {
          const half = y < 4 ? (y - 1) * 0.8 : Math.min(4, 1.5 + (y - 3));
          p.hline(Math.round(6 - half), Math.round(5 + half), y, y > 7 ? P.w1 : P.w2);
        }
        p.hline(3, 8, 10, P.w1);
        p.p(4, 6, P.w4);
        p.p(4, 7, P.w3);
        break;
      case 'wood':
        p.r(1, 4, 10, 5, P.b2);
        p.hline(1, 10, 4, P.b3);
        p.hline(1, 10, 8, P.b1);
        p.ell(10, 6.5, 2, 2.6, P.b4);
        p.p(10, 6, P.b2);
        break;
      case 'stone':
        p.ell(6, 7, 5, 4, P.r1);
        p.ell(5.5, 6.3, 4, 3, P.r2);
        p.ell(4.5, 5.3, 2, 1.5, P.r3);
        break;
      case 'pop':
      case 'work':
      case 'child':
      case 'elder':
        p.r(4, 1, 4, 4, P.skin1);
        p.r(4, 1, 4, 1, kind === 'elder' ? P.r3 : P.b1);
        p.r(3, 5, 6, 5, kind === 'work' ? P.grn1 : kind === 'child' ? P.flowerY : P.blue2);
        p.r(4, 10, 1, 2, P.b0);
        p.r(7, 10, 1, 2, P.b0);
        if (kind === 'work') p.r(9, 3, 1, 6, P.b1), p.r(8, 2, 3, 2, P.r3);
        break;
      case 'happy':
        p.ell(6, 6, 5, 5, P.flowerY);
        p.p(4, 4, P.dark);
        p.p(7, 4, P.dark);
        p.hline(4, 7, 8, P.dark);
        p.p(3, 7, P.dark);
        p.p(8, 7, P.dark);
        break;
      case 'health':
        p.ell(4, 4.5, 2.8, 2.8, P.red2);
        p.ell(8, 4.5, 2.8, 2.8, P.red2);
        for (let y = 5; y < 11; y++) p.hline(1 + (y - 5), 10 - (y - 5), y, P.red2);
        p.p(3, 3, P.red3);
        break;
      case 'edu':
        p.r(1, 3, 5, 7, P.white);
        p.r(6, 3, 5, 7, P.m3);
        p.vline(6, 3, 10, P.b1);
        p.hline(2, 4, 5, P.r2);
        p.hline(7, 9, 5, P.r2);
        p.hline(2, 4, 7, P.r2);
        break;
      case 'house':
        for (let y = 1; y < 6; y++) p.hline(6 - y, 5 + y, y, P.red2);
        p.r(2, 6, 8, 5, P.m2);
        p.r(5, 8, 2, 3, P.b1);
        break;
      case 'warn':
        for (let y = 1; y < 11; y++) p.hline(Math.round(6 - y / 2), Math.round(5 + y / 2), y, P.flowerY);
        p.vline(6, 4, 7, P.dark);
        p.vline(5, 4, 7, P.dark);
        p.r(5, 9, 2, 1, P.dark);
        break;
      case 'noroad':
        p.r(0, 4, 12, 4, P.soil1);
        p.hline(0, 11, 4, P.soil0);
        p.hline(0, 11, 7, P.soil0);
        for (let k = 1; k < 11; k++) {
          p.p(k, k, P.red2);
          p.p(11 - k, k, P.red2);
        }
        break;
      case 'nostaff':
        p.r(4, 1, 4, 4, P.skin1);
        p.r(3, 5, 6, 6, P.m0);
        for (let k = 0; k < 12; k++) p.p(k, 11 - k, P.red2);
        break;
      case 'noresource':
        p.r(2, 4, 8, 7, P.b2);
        p.hline(2, 9, 4, P.b3);
        p.r(3, 5, 6, 5, P.b0);
        p.p(6, 1, P.red2);
        p.vline(6, 1, 2, P.red2);
        break;
      case 'full':
        p.r(1, 3, 10, 8, P.b2);
        p.r(2, 4, 8, 6, P.th2);
        p.hline(1, 10, 3, P.b3);
        p.vline(6, 0, 2, P.red2);
        p.hline(5, 7, 1, P.red2);
        break;
      case 'baby':
        p.ell(6, 5, 3, 3, P.skin2);
        p.r(3, 7, 6, 4, P.flowerW);
        p.p(5, 5, P.dark);
        p.p(7, 5, P.dark);
        break;
      case 'road':
        p.r(0, 3, 12, 6, P.soil1);
        p.hline(0, 11, 3, P.b1);
        p.hline(0, 11, 8, P.b1);
        p.r(2, 5, 2, 1, P.s2);
        p.r(7, 6, 2, 1, P.s2);
        break;
      case 'demolish':
        p.vline(6, 4, 11, P.b1);
        p.vline(7, 4, 11, P.b2);
        p.r(2, 1, 9, 4, P.r2);
        p.r(2, 1, 9, 1, P.r3);
        break;
      case 'parcel':
        p.r(1, 1, 10, 10, P.g2);
        p.hline(1, 10, 1, P.gold);
        p.hline(1, 10, 10, P.gold);
        p.vline(1, 1, 10, P.gold);
        p.vline(10, 1, 10, P.gold);
        p.vline(6, 3, 8, P.b1);
        p.r(6, 3, 3, 2, P.red2);
        break;
      case 'select':
        for (let k = 0; k < 8; k++) p.vline(2 + Math.floor(k / 2), 1 + k, 1 + k, P.white);
        p.vline(2, 1, 9, P.white);
        p.r(3, 3, 2, 5, P.white);
        break;
    }
    p.outline();
    return p.c;
  });
}

const urlCache = new Map<string, string>();
export function iconURL(kind: IconKind): string {
  let u = urlCache.get(kind);
  if (!u) {
    u = iconSprite(kind).toDataURL();
    urlCache.set(kind, u);
  }
  return u;
}

export function spriteURL(key: string, make: () => Canvas): string {
  let u = urlCache.get(key);
  if (!u) {
    u = make().toDataURL();
    urlCache.set(key, u);
  }
  return u;
}
