import { MAP, NODES } from '../config/balance';
import { Rng } from './rng';
import { T_GRASS, T_SAND, T_WATER, type ResourceNode } from './types';

export interface GeneratedMap {
  terrain: Uint8Array;
  decor: Uint8Array;
  nodes: ResourceNode[];
}

/** Bruit de valeur lissé multi-octave, entièrement déterminé par le RNG. */
function valueNoise(rng: Rng, size: number, cell: number, octaves: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(2, Math.floor(cell / 2 ** o));
    const gw = Math.ceil(size / c) + 2;
    const grid = new Float32Array(gw * gw);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = x / c;
        const gy = y / c;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const a = grid[y0 * gw + x0];
        const b = grid[y0 * gw + x0 + 1];
        const cc = grid[(y0 + 1) * gw + x0];
        const d = grid[(y0 + 1) * gw + x0 + 1];
        out[y * size + x] += (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export const DECOR_NONE = 0;
export const DECOR_KINDS = 5; // 1 fleurs, 2 buisson, 3 cailloux, 4 champignons, 5 herbes hautes

export function generateMap(rng: Rng): GeneratedMap {
  const N = MAP.SIZE;
  const terrain = new Uint8Array(N * N);
  const decor = new Uint8Array(N * N);
  const water = valueNoise(rng, N, 22, 3);
  const forest = valueNoise(rng, N, 14, 3);
  const rocks = valueNoise(rng, N, 9, 2);
  const detail = valueNoise(rng, N, 4, 2);

  const c = N / 2;
  const startMin = MAP.START_PARCELS.reduce((m, p) => Math.min(m, p[0]), 99) * MAP.PARCEL;
  const startMax = (MAP.START_PARCELS.reduce((m, p) => Math.max(m, p[0]), 0) + 1) * MAP.PARCEL - 1;
  const inStart = (x: number, y: number) => x >= startMin && x <= startMax && y >= startMin && y <= startMax;

  // Eau : lacs issus du bruit, atténués près du centre.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - c, y - c);
      const centerDamp = d < 14 ? 0.35 : d < 22 ? 0.12 : 0;
      const v = water[y * N + x] - centerDamp;
      if (v > 0.63) terrain[y * N + x] = T_WATER;
    }
  }
  // Petit étang garanti dans la zone de départ, dans un coin choisi par la graine.
  const corners: [number, number][] = [
    [startMin + 6, startMin + 6],
    [startMax - 6, startMin + 6],
    [startMin + 6, startMax - 6],
    [startMax - 6, startMax - 6],
  ];
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const [pondX, pondY] = corners[order[0]];
  const [forestX, forestY] = corners[order[1]];
  const [rockX, rockY] = corners[order[2]];
  let startWater = 0;
  for (let y = startMin; y <= startMax; y++) for (let x = startMin; x <= startMax; x++) if (terrain[y * N + x] === T_WATER) startWater++;
  if (startWater < 20) {
    const rx = rng.range(3, 4.5);
    const ry = rng.range(2.5, 3.5);
    for (let y = pondY - 5; y <= pondY + 5; y++)
      for (let x = pondX - 6; x <= pondX + 6; x++) {
        const n = (detail[y * N + x] - 0.5) * 0.6;
        if (((x - pondX) / rx) ** 2 + ((y - pondY) / ry) ** 2 < 1 + n) terrain[y * N + x] = T_WATER;
      }
  }
  // Clairière centrale garantie.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) if (Math.hypot(x - c + 0.5, y - c + 0.5) < 11) terrain[y * N + x] = T_GRASS;
  // Bord de carte : pas d'eau collée aux limites extrêmes (lisibilité).
  // Plages de sable autour de l'eau.
  const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && terrain[y * N + x] === T_WATER;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (terrain[y * N + x] !== T_GRASS) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isWater(x + dx, y + dy)) near = true;
      if (near && detail[y * N + x] > 0.35) terrain[y * N + x] = T_SAND;
    }

  const nodes: ResourceNode[] = [];
  const nodeAt = new Int32Array(N * N).fill(-1);
  const addNode = (kind: 'tree' | 'rock', x: number, y: number) => {
    const i = y * N + x;
    if (terrain[i] !== T_GRASS || nodeAt[i] >= 0) return false;
    if (Math.hypot(x - c + 0.5, y - c + 0.5) < 10) return false;
    const max = kind === 'tree' ? NODES.treeStock : NODES.rockStock;
    nodeAt[i] = nodes.length;
    nodes.push({ id: nodes.length, kind, x, y, stock: max, max, state: 'ok', timer: 0, variant: rng.int(0, 2) });
    return true;
  };

  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      if (terrain[i] !== T_GRASS) continue;
      const f = forest[i];
      const r = rocks[i];
      if (r > 0.69 && rng.chance(0.45)) addNode('rock', x, y);
      else if (f > 0.58 && rng.chance(0.25 + (f - 0.58) * 3)) addNode('tree', x, y);
      else if (rng.chance(0.012)) addNode('tree', x, y);
    }

  // Garanties de ressources dans la zone de départ.
  const count = (kind: string) => nodes.filter((n) => n.kind === kind && inStart(n.x, n.y) && Math.hypot(n.x - c, n.y - c) < 17).length;
  let guard = 0;
  while (count('tree') < 45 && guard++ < 2000) {
    const x = Math.round(forestX + rng.range(-5, 5));
    const y = Math.round(forestY + rng.range(-5, 5));
    if (inStart(x, y)) addNode('tree', x, y);
  }
  guard = 0;
  while (count('rock') < 18 && guard++ < 2000) {
    const x = Math.round(rockX + rng.range(-3.5, 3.5));
    const y = Math.round(rockY + rng.range(-3.5, 3.5));
    if (inStart(x, y)) addNode('rock', x, y);
  }

  // Décors non bloquants.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (terrain[i] !== T_GRASS || nodeAt[i] >= 0) continue;
      const v = detail[i];
      if (rng.chance(0.07)) {
        if (v > 0.6) decor[i] = 1;
        else if (v < 0.3) decor[i] = 5;
        else decor[i] = rng.pick([1, 2, 3, 4, 5]);
      }
    }

  // Ré-indexation propre.
  nodes.forEach((n, i) => (n.id = i));
  return { terrain, decor, nodes };
}
