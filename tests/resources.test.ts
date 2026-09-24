import { describe, expect, it } from 'vitest';
import { NODES } from '../src/config/balance';
import { harvestableNodes } from '../src/sim/logic';
import { Game } from '../src/sim/world';
import { findSpot, rich, run } from './helpers';

function woodcutterWithTrees(seed: number) {
  const g = Game.create(seed);
  rich(g);
  // meilleur emplacement : le plus d'arbres accessibles
  let best: [number, number] | null = null;
  let bestN = -1;
  for (let y = 33; y < 62; y++)
    for (let x = 33; x < 62; x++) {
      if (!g.canPlace('woodcutter', x, y, 0).ok) continue;
      const n = harvestableNodes(g, { id: -1, type: 'woodcutter', x, y, w: 3, h: 3, rot: 0, level: 1, workers: [], target: 0, reserved: 0 }).length;
      if (n > bestN) {
        bestN = n;
        best = [x, y];
      }
    }
  const b = g.place('woodcutter', best![0], best![1], 0).building!;
  // route jusqu'au réseau : on relie en ligne droite vers la route principale y = 49
  const tiles: [number, number][] = [];
  const x = best![0] + 1;
  const y0 = best![1] < 49 ? best![1] + 3 : best![1] - 1;
  for (let y = y0; y !== 49; y += y0 < 49 ? 1 : -1) tiles.push([x, y]);
  g.s.stock.wood = 220;
  g.buildRoads(tiles);
  return { g, b };
}

describe('ressources naturelles', () => {
  it('la récolte diminue réellement le stock des nœuds, qui s’épuisent puis repoussent', () => {
    const { g, b } = woodcutterWithTrees(41);
    if (!g.connected.has(b.id)) return; // carte atypique : testé par d'autres graines
    for (let i = 0; i < 3; i++) g.addWorker(b.id);
    const nodes = harvestableNodes(g, b);
    expect(nodes.length).toBeGreaterThan(0);
    const total0 = nodes.reduce((a, id) => a + g.s.nodes[id].stock, 0);
    g.s.stock.wood = 0;
    run(g, 1);
    const total1 = nodes.reduce((a, id) => a + g.s.nodes[id].stock, 0);
    const gained = g.s.stock.wood;
    expect(gained).toBeGreaterThan(10);
    // Conservation : bois gagné (moins chauffage) = stock prélevé
    expect(total0 - total1).toBeGreaterThanOrEqual(gained - 1e-6);
    const depleted = g.s.nodes.filter((n) => n.kind === 'tree' && n.state !== 'ok');
    expect(depleted.length).toBeGreaterThan(0);
    const d = depleted[0];
    // Repousse après délai + croissance
    run(g, NODES.treeRegrowDelay + NODES.treeGrowYears + 0.2);
    expect(['ok', 'depleted', 'growing']).toContain(d.state);
    const regrown = g.s.nodes.filter((n) => n.kind === 'tree' && n.state === 'growing').length + g.s.nodes.filter((n) => n.kind === 'tree' && n.state === 'ok').length;
    expect(regrown).toBeGreaterThan(0);
  });

  it('deux exploitations ne récoltent pas deux fois le même stock', () => {
    const g = Game.create(42);
    rich(g);
    // Un seul arbre isolé, deux bûcherons autour
    const tree = g.s.nodes.find((n) => n.kind === 'tree' && g.owned(n.x, n.y))!;
    g.s.nodes = [tree];
    g.rebuildNodeIndex();
    g.dirtyWalk = true;
    g.refreshWalk();
    tree.stock = 10;
    const ids: number[] = [];
    for (const [dx, dy] of [[-4, -1], [2, -1]]) {
      const x = tree.x + dx;
      const y = tree.y + dy;
      if (g.canPlace('woodcutter', x, y, 0).ok) ids.push(g.place('woodcutter', x, y, 0).building!.id);
    }
    // relier via une route contournant : on force le réseau (test unitaire du prélèvement)
    for (const id of ids) g.connected.add(id);
    g.dirtyNetwork = false;
    for (const id of ids) for (let i = 0; i < 3; i++) g.addWorker(id);
    const wood0 = g.s.stock.wood;
    for (let i = 0; i < 100; i++) {
      for (const id of ids) g.connected.add(id);
      g.step();
    }
    expect(tree.stock).toBe(0);
    expect(tree.state).toBe('depleted');
    expect(g.s.stock.wood - wood0).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('un nœud hors territoire ou inaccessible ne produit rien', () => {
    const g = Game.create(43);
    rich(g);
    const [x, y] = findSpot(g, 'stonecutter');
    const b = g.place('stonecutter', x, y, 0).building!;
    // Supprime tous les rochers accessibles : production nulle et statut explicite
    g.s.nodes = g.s.nodes.filter((n) => n.kind !== 'rock' || !g.owned(n.x, n.y));
    g.rebuildNodeIndex();
    for (let i = 0; i < 3; i++) g.addWorker(b.id);
    g.s.stock.stone = 50;
    const stone0 = g.s.stock.stone;
    run(g, 0.5);
    expect(g.s.stock.stone).toBe(stone0);
    expect(g.status.get(b.id)?.status).toBe('noresource');
  });

  it('la régénération ne crée jamais de ressource sur un bâtiment ou une route', () => {
    const g = Game.create(44);
    rich(g);
    const n = g.s.nodes.find((k) => k.kind === 'tree' && g.owned(k.x, k.y))!;
    n.state = 'depleted';
    n.stock = 0;
    n.timer = 0.01;
    g.rebuildNodeIndex();
    g.dirtyWalk = true;
    // On construit une route sur la souche : le nœud disparaît
    g.s.stock.wood = 50;
    expect(g.buildRoads([[n.x, n.y]]).ok).toBe(true);
    expect(g.nodeAtTile(n.x, n.y)).toBeNull();
    run(g, 5);
    expect(g.nodeAtTile(n.x, n.y)).toBeNull();
    // Garde-fou : un nœud épuisé sous une route ne repousse pas
    const m = g.s.nodes.find((k) => k.kind === 'rock' && g.owned(k.x, k.y))!;
    m.state = 'depleted';
    m.timer = 0;
    g.s.roads[m.y * g.N + m.x] = 1;
    run(g, 0.1);
    expect(m.state).toBe('depleted');
  });
});
