// Recherche de chemin A* sur la grille (8 directions sans couper les coins).
// cost[i] = 0 : case infranchissable ; sinon coût de traversée (les routes sont moins chères).

class MinHeap {
  ids: number[] = [];
  pr: number[] = [];
  push(id: number, p: number) {
    const ids = this.ids;
    const pr = this.pr;
    let i = ids.length;
    ids.push(id);
    pr.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= p) break;
      ids[i] = ids[parent];
      pr[i] = pr[parent];
      i = parent;
    }
    ids[i] = id;
    pr[i] = p;
  }
  pop(): number {
    const ids = this.ids;
    const pr = this.pr;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pr.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        if (r < n && pr[r] < pr[l]) l = r;
        if (pr[l] >= lastP) break;
        ids[i] = ids[l];
        pr[i] = pr[l];
        i = l;
      }
      ids[i] = lastId;
      pr[i] = lastP;
    }
    return top;
  }
  get size() {
    return this.ids.length;
  }
}

export class PathFinder {
  private g: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private stamp = 0;
  constructor(private n: number) {
    this.g = new Float32Array(n * n);
    this.from = new Int32Array(n * n);
    this.seen = new Uint32Array(n * n);
    this.closed = new Uint32Array(n * n);
  }

  /** Renvoie la liste des index de cases du départ à l'arrivée, ou null. */
  find(cost: Float32Array, start: number, goal: number, maxNodes = 6000): number[] | null {
    const n = this.n;
    if (cost[start] === 0 || cost[goal] === 0) return null;
    if (start === goal) return [start];
    this.stamp++;
    const stamp = this.stamp;
    const heap = new MinHeap();
    const gx = goal % n;
    const gy = (goal / n) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % n) - gx);
      const dy = Math.abs(((i / n) | 0) - gy);
      return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * 0.9;
    };
    this.g[start] = 0;
    this.seen[start] = stamp;
    this.from[start] = -1;
    heap.push(start, h(start));
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      if (cur === goal) {
        const path: number[] = [];
        let c = cur;
        while (c !== -1) {
          path.push(c);
          c = this.from[c];
        }
        return path.reverse();
      }
      if (++expanded > maxNodes) return null;
      const cx = cur % n;
      const cy = (cur / n) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const ni = ny * n + nx;
          const c = cost[ni];
          if (c === 0 || this.closed[ni] === stamp) continue;
          let step = c;
          if (dx && dy) {
            if (cost[cy * n + nx] === 0 || cost[ny * n + cx] === 0) continue;
            step = c * Math.SQRT2;
          }
          const ng = this.g[cur] + step;
          if (this.seen[ni] !== stamp || ng < this.g[ni]) {
            this.seen[ni] = stamp;
            this.g[ni] = ng;
            this.from[ni] = cur;
            heap.push(ni, ng + h(ni));
          }
        }
      }
    }
    return null;
  }
}
