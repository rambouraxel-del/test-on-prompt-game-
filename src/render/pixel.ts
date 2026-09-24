// Outils de dessin pixel art sur canvas hors écran + palette limitée.

export const P = {
  outline: '#2a1d17',
  shadow: 'rgba(20,12,8,0.28)',
  // herbe
  g0: '#3b6b2c',
  g1: '#4f8a38',
  g2: '#63a044',
  g3: '#7db957',
  g4: '#9fd06d',
  // sable
  s0: '#b89a62',
  s1: '#d2b77c',
  s2: '#e6d39c',
  // eau
  w0: '#244e7a',
  w1: '#2f6a9e',
  w2: '#4a8cc0',
  w3: '#7ab4dc',
  w4: '#cfe8f4',
  // bois
  b0: '#4a2e1c',
  b1: '#6b4428',
  b2: '#8c5d35',
  b3: '#b07f4a',
  b4: '#d4a86a',
  // feuillage
  l0: '#1f4424',
  l1: '#2d6130',
  l2: '#3f8038',
  l3: '#5ba045',
  l4: '#86c45d',
  // pierre
  r0: '#3e3f47',
  r1: '#5d5f69',
  r2: '#80838c',
  r3: '#a6a9b0',
  r4: '#cfd1d4',
  // toits
  red0: '#6e2a24',
  red1: '#963a2e',
  red2: '#bd5539',
  red3: '#d9794c',
  blue0: '#2e3a57',
  blue1: '#43557a',
  blue2: '#5e76a0',
  blue3: '#86a0c6',
  th0: '#7a5a26',
  th1: '#a37b35',
  th2: '#c99d47',
  th3: '#e2bf68',
  grn0: '#2c4f36',
  grn1: '#3f6e48',
  grn2: '#5a9160',
  // murs
  m0: '#8f7a5a',
  m1: '#bca47c',
  m2: '#dccaa0',
  m3: '#efe3c4',
  // divers
  skin0: '#b9774e',
  skin1: '#e6b68a',
  skin2: '#f3cfa6',
  gold: '#f0c649',
  gold0: '#b98a2a',
  berry: '#c43b4c',
  flowerY: '#f4d35e',
  flowerW: '#f4efe6',
  flowerP: '#d17ab8',
  flowerR: '#e0584a',
  dark: '#1b1411',
  glow: '#ffe7a3',
  white: '#f5f1e8',
  soil0: '#5b3b23',
  soil1: '#7a5033',
  soil2: '#94653f',
};

export type Canvas = HTMLCanvasElement;

export class Pix {
  c: Canvas;
  x: CanvasRenderingContext2D;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.c = document.createElement('canvas');
    this.c.width = w;
    this.c.height = h;
    this.x = this.c.getContext('2d')!;
    this.x.imageSmoothingEnabled = false;
  }
  p(x: number, y: number, col: string) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.x.fillStyle = col;
    this.x.fillRect(Math.floor(x), Math.floor(y), 1, 1);
  }
  r(x: number, y: number, w: number, h: number, col: string) {
    if (w <= 0 || h <= 0) return;
    this.x.fillStyle = col;
    this.x.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  }
  hline(x0: number, x1: number, y: number, col: string) {
    this.r(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, col);
  }
  vline(x: number, y0: number, y1: number, col: string) {
    this.r(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, col);
  }
  /** Ellipse pleine. */
  ell(cx: number, cy: number, rx: number, ry: number, col: string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.p(x, y, col);
      }
  }
  /** Ajoute un contour sombre autour des pixels opaques. */
  outline(col = P.outline) {
    const img = this.x.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const w = this.w;
    const h = this.h;
    const mark: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] > 40) continue;
        const nb = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = (ny * w + nx) * 4;
          if (d[j + 3] > 200) {
            mark.push(x, y);
            break;
          }
        }
      }
    this.x.fillStyle = col;
    for (let k = 0; k < mark.length; k += 2) this.x.fillRect(mark[k], mark[k + 1], 1, 1);
  }
  /** Motif de bruit ordonné avec une couleur. */
  speckle(x: number, y: number, w: number, h: number, col: string, density: number, seed: number) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const v = hashf(xx, yy, seed);
        if (v < density) this.p(xx, yy, col);
      }
  }
}

export function hashf(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
