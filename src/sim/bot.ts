// Joueur automatique simple, utilisé pour les tests d'équilibrage et la simulation accélérée.
import { BUILDINGS, type BuildingType } from '../config/buildings';
import { MAP } from '../config/balance';
import { demand, harvestableNodes, wellNearWater } from './logic';
import type { Building } from './types';
import type { Game } from './world';

interface Candidate {
  x: number;
  y: number;
  rot: 0 | 1;
  score: number;
  roadFrom: number | null;
}

export class Bot {
  lastAction = -1;
  actions: string[] = [];
  constructor(private g: Game) {}

  /** Champ de distance (en cases de route à construire) depuis le réseau relié. */
  private roadField(): { dist: Int32Array; prev: Int32Array } {
    const g = this.g;
    const N = g.N;
    const dist = new Int32Array(N * N).fill(-1);
    const prev = new Int32Array(N * N).fill(-1);
    const q: number[] = [];
    for (let i = 0; i < N * N; i++)
      if (g.roadConnected[i]) {
        dist[i] = 0;
        q.push(i);
      }
    let h = 0;
    while (h < q.length) {
      const i = q[h++];
      const x = i % N;
      const y = (i / N) | 0;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (!g.inBounds(nx, ny)) continue;
        const j = ny * N + nx;
        if (dist[j] >= 0) continue;
        if (g.tileBlockReason(nx, ny, true) !== null) continue;
        dist[j] = dist[i] + 1;
        prev[j] = i;
        q.push(j);
      }
    }
    return { dist, prev };
  }

  place(type: BuildingType, score: (x: number, y: number, w: number, h: number) => number): Building | null {
    const g = this.g;
    if (!g.isUnlocked(type) || !g.canAfford(BUILDINGS[type].cost)) return null;
    const { dist, prev } = this.roadField();
    const needsRoad = BUILDINGS[type].needsRoad || type === 'house';
    let best: Candidate | null = null;
    const N = g.N;
    const rots: (0 | 1)[] = BUILDINGS[type].w === BUILDINGS[type].h ? [0] : [0, 1];
    for (const rot of rots) {
      const [w, h] = g.footprint(type, rot);
      for (let y = 1; y < N - h; y++)
        for (let x = 1; x < N - w; x++) {
          if (!g.owned(x, y) || !g.owned(x + w - 1, y + h - 1)) continue;
          if (!g.canPlace(type, x, y, rot).ok) continue;
          let roadLen = 0;
          let roadFrom: number | null = null;
          if (needsRoad) {
            let bestD = Infinity;
            for (const [px, py] of g.perimeter({ x, y, w, h })) {
              const i = py * N + px;
              if (g.roadConnected[i]) {
                bestD = 0;
                roadFrom = null;
                break;
              }
              if (dist[i] > 0 && dist[i] < bestD) {
                bestD = dist[i];
                roadFrom = i;
              }
            }
            if (bestD === Infinity) continue;
            roadLen = bestD;
          }
          // Laisse une marge libre autour pour ne pas étouffer le réseau.
          const s = score(x, y, w, h) + roadLen * 1.2;
          if (!best || s < best.score) best = { x, y, rot, score: s, roadFrom };
        }
    }
    if (!best) return null;
    // Route d'accès éventuelle (construite après le bâtiment pour ne pas occuper son emplacement).
    const res = g.place(type, best.x, best.y, best.rot);
    if (!res.ok || !res.building) return null;
    if (best.roadFrom !== null) {
      const tiles: [number, number][] = [];
      let i = best.roadFrom;
      while (i >= 0 && !g.roadConnected[i]) {
        tiles.push([i % N, (i / N) | 0]);
        i = prev[i];
      }
      g.buildRoads(tiles);
    }
    this.actions.push(`an ${g.year}: ${BUILDINGS[type].name}`);
    return res.building;
  }

  private nearCenter(x: number, y: number, w: number, h: number) {
    const th = this.g.townhall();
    const [cx, cy] = this.g.center(th);
    return Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
  }

  private resourceScore(kind: 'woodcutter' | 'stonecutter') {
    return (x: number, y: number, w: number, h: number) => {
      const fake = { id: -1, type: kind, x, y, w, h, rot: 0 as const, level: 1, workers: [], target: 0, reserved: 0 };
      const n = harvestableNodes(this.g, fake).length;
      if (n < 4) return 1e6;
      return this.nearCenter(x, y, w, h) * 0.3 - n * 1.5;
    };
  }

  private count(type: BuildingType) {
    return this.g.s.buildings.filter((b) => b.type === type).length;
  }

  private expected(types: BuildingType[]): number {
    const g = this.g;
    let t = 0;
    for (const b of g.s.buildings) {
      if (!types.includes(b.type) || !g.connected.has(b.id)) continue;
      const def = BUILDINGS[b.type];
      let r = def.rate! * b.workers.length * def.levelMult![b.level - 1] * 0.96;
      if (b.type === 'well' && wellNearWater(g, b)) r *= 1.4;
      t += r;
    }
    return t;
  }

  /** Libère un travailleur d'un poste moins prioritaire. */
  private freeWorker(): boolean {
    const g = this.g;
    const order: BuildingType[] = ['stonecutter', 'school', 'woodcutter', 'clinic'];
    for (const t of order) {
      const b = g.s.buildings.find((b) => b.type === t && b.workers.length > (t === 'woodcutter' ? 1 : 0));
      if (b) {
        g.removeWorker(b.id);
        return true;
      }
    }
    return false;
  }

  private ensure(types: BuildingType[], need: number, build: () => unknown) {
    const g = this.g;
    for (let guard = 0; guard < 12 && this.expected(types) < need; guard++) {
      const slot = g.s.buildings.find((b) => types.includes(b.type) && g.connected.has(b.id) && b.workers.length < g.jobCap(b));
      if (!slot) {
        if (!build()) return;
        continue;
      }
      if (!g.availableAdults().length && !this.freeWorker()) return;
      if (!g.addWorker(slot.id).ok) return;
    }
  }

  staff() {
    const g = this.g;
    // Libère le personnel des exploitations bloquées par un stock plein.
    for (const b of g.s.buildings)
      if (g.isProducer(b) && g.status.get(b.id)?.status === 'full' && b.workers.length > 1) g.removeWorker(b.id);
    const d = demand(g);
    const kids = g.s.citizens.filter((c) => c.age >= 6 && c.age < 18).length;
    const nearCenter = (x: number, y: number, w: number, h: number) => this.nearCenter(x, y, w, h);
    this.ensure(['gatherer', 'farm'], d.food * 1.2 + 10, () =>
      g.isUnlocked('farm') ? this.place('farm', nearCenter) ?? this.place('gatherer', nearCenter) : this.place('gatherer', nearCenter),
    );
    const farmWater = this.expected(['farm']) * 0.3;
    this.ensure(['well'], d.water * 1.15 + farmWater + 8, () => this.place('well', nearCenter));
    const fill = (t: BuildingType, max: number) => {
      for (const b of g.s.buildings.filter((b) => b.type === t && g.connected.has(b.id)))
        while (b.workers.length < Math.min(max, g.jobCap(b)) && g.addWorker(b.id).ok);
    };
    fill('woodcutter', 3);
    fill('stonecutter', 2);
    if (kids > 0) fill('school', Math.ceil(kids / 6));
    fill('clinic', 99);
    fill('woodcutter', 99);
    fill('stonecutter', 99);
  }

  tick() {
    const g = this.g;
    const period = Math.floor(g.years * 4);
    if (period === this.lastAction) return;
    this.lastAction = period;
    this.staff();
    const pop = g.s.citizens.length;
    const blockedCouples = g.s.citizens.filter(
      (c) => c.sex === 'F' && c.partnerId !== null && c.age < 40 && !c.pregnancy && c.houseId !== null && g.houseFree(g.bById.get(c.houseId)!) < 1,
    ).length;
    const freeHousing = g.s.buildings.filter((b) => b.type === 'house').reduce((a, b) => a + Math.max(0, g.houseFree(b)), 0);

    const want: [boolean, () => unknown][] = [
      [this.count('gatherer') === 0, () => this.place('gatherer', (x, y, w, h) => this.nearCenter(x, y, w, h))],
      [this.count('well') === 0, () => this.place('well', (x, y, w, h) => this.nearCenter(x, y, w, h))],
      [this.count('woodcutter') === 0, () => this.place('woodcutter', this.resourceScore('woodcutter'))],
      [this.count('stonecutter') === 0 && g.s.stock.wood >= 30, () => this.place('stonecutter', this.resourceScore('stonecutter'))],
      [this.count('altar') < Math.ceil(pop / 18), () => this.place('altar', (x, y, w, h) => this.nearCenter(x, y, w, h))],
      [freeHousing < 3 || blockedCouples > 0, () => this.place('house', (x, y, w, h) => this.nearCenter(x, y, w, h))],
      [
        (g.s.stock.wood > g.capacity.wood * 0.85 || g.s.stock.stone > g.capacity.stone * 0.85) && this.count('granary') < pop / 12,
        () => this.place('granary', (x, y, w, h) => this.nearCenter(x, y, w, h)),
      ],
      [this.count('garden') < Math.floor(pop / 10), () => this.place('garden', (x, y, w, h) => this.nearCenter(x, y, w, h))],
      [g.isUnlocked('school') && this.count('school') === 0 && g.s.citizens.some((c) => c.age >= 5 && c.age < 18), () => this.place('school', (x, y, w, h) => this.nearCenter(x, y, w, h))],
      [g.isUnlocked('clinic') && this.count('clinic') < Math.floor(pop / 30) + 1, () => this.place('clinic', (x, y, w, h) => this.nearCenter(x, y, w, h))],
      [this.count('woodcutter') < 2 && pop > 20, () => this.place('woodcutter', this.resourceScore('woodcutter'))],
    ];
    for (const [cond, act] of want) if (cond) {
      act();
      this.staff();
    }

    // Bûcherons sans arbres : on en reconstruit ailleurs.
    for (const b of g.s.buildings.filter((b) => b.type === 'woodcutter' || b.type === 'stonecutter')) {
      if (harvestableNodes(g, b).length === 0 && g.status.get(b.id)?.status === 'noresource') {
        const type = b.type as 'woodcutter' | 'stonecutter';
        g.demolish(b.id);
        this.place(type, this.resourceScore(type));
      }
    }
    // Améliorations
    if (g.maxLevelUnlocked >= 2)
      for (const b of g.s.buildings) {
        if (b.type === 'house' || b.type === 'altar' || b.type === 'well' || b.type === 'gatherer' || b.type === 'farm') {
          if (b.level < g.maxLevelUnlocked && g.upgradeCheck(b).ok && g.s.stock.wood > 80) g.upgrade(b.id);
        }
      }
    // Expansion
    const P = g.N / MAP.PARCEL;
    if (g.s.stock.wood > g.capacity.wood * 0.6 && g.s.stock.stone > 60) {
      for (let py = 0; py < P; py++)
        for (let px = 0; px < P; px++) if (g.parcelCheck(px, py).ok) {
          g.buyParcel(px, py);
          this.actions.push(`an ${g.year}: parcelle ${px},${py}`);
          return this.staff();
        }
    }
    this.staff();
  }
}
