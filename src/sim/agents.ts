// Déplacements visuels des habitants : trajets logement ↔ travail/école, promenades.
// Purement visuel (n'influence pas l'économie), mais exécuté au pas fixe pour rester fluide et reproductible.
import { AGES } from '../config/balance';
import { PathFinder } from './path';
import { hash2 } from './rng';
import type { Citizen } from './types';
import type { Game } from './world';

export interface Agent {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  path: number[] | null;
  pi: number;
  mode: 'inside' | 'walking' | 'idle' | 'working';
  timer: number;
  goal: number;
  goalMode: 'inside' | 'idle' | 'working';
  place: number | null;
  dir: 1 | -1;
  walkT: number;
  waiting: boolean;
}

const CYCLE = 24; // durée d'une "journée" visuelle (s)
const WORK_SHARE = 0.6;
const MAX_PATHS_PER_STEP = 6;

export class Agents {
  list = new Map<number, Agent>();
  private finder: PathFinder;
  private queue: number[] = [];
  private t = 0;
  constructor(private g: Game) {
    this.finder = new PathFinder(g.N);
  }

  remove(id: number) {
    this.list.delete(id);
  }

  invalidatePaths() {
    for (const a of this.list.values()) {
      if (a.mode === 'walking') {
        a.path = null;
        this.request(a);
      }
    }
  }

  private request(a: Agent) {
    if (a.waiting) return;
    a.waiting = true;
    this.queue.push(a.id);
  }

  private homeDoor(c: Citizen): number | null {
    if (c.houseId !== null) {
      const h = this.g.bById.get(c.houseId);
      if (h) return this.g.door(h);
    }
    const th = this.g.townhall();
    return th ? this.g.door(th) : null;
  }

  private spawn(c: Citizen): Agent | null {
    const door = this.homeDoor(c);
    if (door === null) return null;
    const N = this.g.N;
    const x = (door % N) + 0.5;
    const y = Math.floor(door / N) + 0.5;
    const a: Agent = {
      id: c.id,
      x,
      y,
      px: x,
      py: y,
      path: null,
      pi: 0,
      mode: 'inside',
      timer: hash2(c.id, 7) * 6,
      goal: door,
      goalMode: 'inside',
      place: c.houseId,
      dir: 1,
      walkT: hash2(c.id, 3) * 10,
      waiting: false,
    };
    this.list.set(c.id, a);
    return a;
  }

  update(dt: number) {
    const g = this.g;
    this.t += dt;
    if (g.dirtyWalk) g.refreshWalk();
    // Synchronisation avec la population.
    if (this.list.size !== g.s.citizens.length || this.t % 1 < dt) {
      for (const c of g.s.citizens) if (!this.list.has(c.id)) this.spawn(c);
      for (const id of [...this.list.keys()]) if (!g.cById.has(id)) this.list.delete(id);
    }
    // Calculs de chemin échelonnés.
    let budget = MAX_PATHS_PER_STEP;
    while (budget > 0 && this.queue.length) {
      const id = this.queue.shift()!;
      const a = this.list.get(id);
      if (!a) continue;
      a.waiting = false;
      budget--;
      this.computePath(a);
    }
    for (const a of this.list.values()) {
      a.px = a.x;
      a.py = a.y;
      if (a.mode === 'walking') this.walk(a, dt);
      else {
        a.timer -= dt;
        if (a.mode === 'working') a.walkT += dt;
        if (a.timer <= 0 && !a.waiting) this.decide(a);
      }
    }
  }

  private tileOf(a: Agent) {
    return Math.floor(a.y) * this.g.N + Math.floor(a.x);
  }

  private computePath(a: Agent) {
    const g = this.g;
    let start = this.tileOf(a);
    if (!g.walkCost[start]) {
      // Case devenue impraticable : on repart de la porte du logement.
      const c = g.cById.get(a.id);
      const door = c ? this.homeDoor(c) : null;
      if (door === null) return;
      start = door;
      a.x = (door % g.N) + 0.5;
      a.y = Math.floor(door / g.N) + 0.5;
      a.px = a.x;
      a.py = a.y;
    }
    const path = this.finder.find(g.walkCost, start, a.goal);
    if (!path) {
      a.mode = 'idle';
      a.timer = 2 + hash2(a.id, Math.floor(this.t)) * 3;
      a.path = null;
      return;
    }
    a.path = path;
    a.pi = 1;
    a.mode = 'walking';
  }

  private walk(a: Agent, dt: number) {
    const g = this.g;
    if (!a.path) {
      if (!a.waiting) this.request(a);
      return;
    }
    let left = dt;
    while (left > 0 && a.path) {
      if (a.pi >= a.path.length) {
        this.arrive(a);
        return;
      }
      const t = a.path[a.pi];
      const tx = (t % g.N) + 0.5;
      const ty = Math.floor(t / g.N) + 0.5;
      const speed = g.s.roads[this.tileOf(a)] ? 2.6 : 1.8;
      const dx = tx - a.x;
      const dy = ty - a.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.01) a.dir = dx > 0 ? 1 : -1;
      const stepLen = speed * left;
      a.walkT += left;
      if (d <= stepLen) {
        a.x = tx;
        a.y = ty;
        left -= d / speed;
        a.pi++;
        if (!g.walkCost[t]) {
          // Obstacle apparu sur le trajet : recalcul.
          a.path = null;
          this.request(a);
          return;
        }
      } else {
        a.x += (dx / d) * stepLen;
        a.y += (dy / d) * stepLen;
        left = 0;
      }
    }
  }

  private arrive(a: Agent) {
    a.path = null;
    a.mode = a.goalMode;
    a.timer = a.goalMode === 'inside' ? 4 + hash2(a.id, Math.floor(this.t * 3)) * 5 : 3 + hash2(a.id, Math.floor(this.t * 7)) * 4;
  }

  private goTo(a: Agent, tile: number | null, mode: Agent['goalMode'], place: number | null) {
    if (tile === null) {
      a.timer = 3;
      return;
    }
    a.goal = tile;
    a.goalMode = mode;
    a.place = place;
    if (tile === this.tileOf(a)) {
      this.arrive(a);
      return;
    }
    a.mode = 'walking';
    a.path = null;
    this.request(a);
  }

  private decide(a: Agent) {
    const g = this.g;
    const c = g.cById.get(a.id);
    if (!c) return;
    const phase = ((this.t + hash2(a.id, 11) * CYCLE) % CYCLE) / CYCLE;
    const workTime = phase < WORK_SHARE;
    const home = c.houseId !== null ? g.bById.get(c.houseId) : undefined;
    const homeDoor = this.homeDoor(c);
    const roll = hash2(a.id, Math.floor(this.t * 13));

    if (workTime && c.jobId !== null) {
      const b = g.bById.get(c.jobId);
      if (b) {
        const target = g.harvestTarget.get(b.id);
        if (target !== undefined && roll < 0.7) {
          const n = g.s.nodes[target];
          if (n) {
            const spot = this.freeNeighbor(n.x, n.y);
            if (spot !== null) return this.goTo(a, spot, 'working', b.id);
          }
        }
        if ((b.type === 'farm' || b.type === 'gatherer') && roll < 0.6) {
          const spot = this.randomNear(b.x + b.w / 2, b.y + b.h / 2, b.type === 'farm' ? 3 : 5, roll);
          if (spot !== null) return this.goTo(a, spot, 'working', b.id);
        }
        if (a.place === b.id && a.mode === 'inside') {
          a.timer = 3;
          return;
        }
        return this.goTo(a, g.door(b), 'inside', b.id);
      }
    }
    const school = g.schoolOf.get(c.id);
    if (workTime && school !== undefined) {
      const s = g.bById.get(school);
      if (s) {
        if (a.place === s.id && a.mode === 'inside') {
          a.timer = 3;
          return;
        }
        return this.goTo(a, g.door(s), 'inside', s.id);
      }
    }
    // Temps libre : promenade près du logement ou retour à la maison.
    const baby = c.age < AGES.CHILD;
    if (!baby && roll < 0.45) {
      const [cx, cy] = home ? g.center(home) : g.center(g.townhall());
      const spot = this.randomNear(cx, cy, 6, roll);
      if (spot !== null) return this.goTo(a, spot, 'idle', null);
    }
    if (a.mode === 'inside' && a.place === (home?.id ?? null)) {
      a.timer = 3 + roll * 4;
      return;
    }
    return this.goTo(a, homeDoor, home ? 'inside' : 'idle', home?.id ?? null);
  }

  private freeNeighbor(x: number, y: number): number | null {
    const g = this.g;
    const opts = [
      [x - 1, y],
      [x + 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of opts) {
      if (!g.inBounds(nx, ny)) continue;
      const i = ny * g.N + nx;
      if (g.walkCost[i]) return i;
    }
    return null;
  }

  private randomNear(cx: number, cy: number, r: number, seed: number): number | null {
    const g = this.g;
    for (let k = 0; k < 8; k++) {
      const x = Math.floor(cx + (hash2(k, Math.floor(seed * 1e6)) * 2 - 1) * r);
      const y = Math.floor(cy + (hash2(Math.floor(seed * 1e6), k) * 2 - 1) * r);
      if (!g.inBounds(x, y)) continue;
      const i = y * g.N + x;
      if (g.walkCost[i]) return i;
    }
    return null;
  }
}
