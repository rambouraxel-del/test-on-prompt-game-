import { TIME } from '../src/config/balance';
import type { BuildingType } from '../src/config/buildings';
import { Game } from '../src/sim/world';

export const STEPS_PER_YEAR = TIME.YEAR_SECONDS / TIME.FIXED_DT;

export function run(g: Game, years: number) {
  const n = Math.round(years * STEPS_PER_YEAR);
  for (let i = 0; i < n; i++) g.step();
}

/** Premier emplacement valide près du centre ; touchRoad : exige une route reliée adjacente. */
export function findSpot(g: Game, type: BuildingType, touchRoad = true, rot: 0 | 1 = 0): [number, number] {
  const [w, h] = g.footprint(type, rot);
  for (let r = 1; r < 30; r++)
    for (let y = 48 - r; y <= 48 + r; y++)
      for (let x = 48 - r; x <= 48 + r; x++) {
        if (!g.canPlace(type, x, y, rot).ok) continue;
        const touches = g.perimeter({ x, y, w, h }).some(([px, py]) => g.roadConnected[py * g.N + px]);
        if (!touchRoad || touches) return [x, y];
      }
  throw new Error('aucun emplacement pour ' + type);
}

export function rich(g: Game) {
  g.s.stock = { food: 240, water: 240, wood: 220, stone: 160 };
}

/** Empreinte comparable de l'état logique complet. */
export function snapshot(g: Game): string {
  const s = g.s;
  return JSON.stringify({
    tick: s.tick,
    rng: g.rng.state,
    terrain: Array.from(s.terrain).join(''),
    roads: Array.from(s.roads).join(''),
    nodes: s.nodes,
    parcels: s.parcels,
    buildings: s.buildings,
    citizens: s.citizens,
    stock: s.stock,
    events: s.events,
    nextEventAt: s.nextEventAt,
    shortage: s.shortage,
    progress: s.progress,
  });
}
