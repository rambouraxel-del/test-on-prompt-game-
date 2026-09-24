import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/world';
import { findSpot, rich } from './helpers';

describe('connectivité routière', () => {
  it('un bâtiment est relié via une route rejoignant l’hôtel de ville, et perd le lien si un tronçon est supprimé', () => {
    const g = Game.create(21);
    rich(g);
    g.s.stock.wood = 220;
    // Emplacement libre de toute route, à distance de la route principale (y = 49)
    let spot: [number, number] | null = null;
    for (let x = 36; x < 60 && !spot; x++) {
      if (!g.canPlace('well', x, 54, 0).ok) continue;
      if ([50, 51, 52, 53].every((y) => g.roadCheck(x, y) === null)) spot = [x, 54];
    }
    expect(spot).not.toBeNull();
    const [x, y] = spot!;
    const well = g.place('well', x, y, 0).building!;
    expect(g.connected.has(well.id)).toBe(false);
    // Route isolée (ne rejoint pas le réseau) : insuffisante
    g.buildRoads([[x, 53], [x, 52]]);
    expect(g.connected.has(well.id)).toBe(false);
    // Tronçon manquant : le puits devient relié
    g.buildRoads([[x, 51], [x, 50]]);
    expect(g.connected.has(well.id)).toBe(true);
    // Suppression d'un tronçon intermédiaire : déconnexion
    g.removeRoads([[x, 51]]);
    expect(g.connected.has(well.id)).toBe(false);
    expect(g.s.log.some((e) => /n’est plus relié/.test(e.text))).toBe(true);
    // Reconstruction : de nouveau relié
    g.buildRoads([[x, 51]]);
    expect(g.connected.has(well.id)).toBe(true);
  });

  it('le coût du tracé ne compte que les cases constructibles', () => {
    const g = Game.create(22);
    const plan = g.roadPlan([
      [40, 49], // route existante
      [40, 50], // maison
      [45, 30], // hors territoire
    ]);
    expect(plan.valid.length).toBe(0);
    const free = findSpot(g, 'garden', false);
    const plan2 = g.roadPlan([free, free, [free[0] + 1, free[1]]]);
    expect(plan2.valid.length).toBe(2);
    expect(plan2.cost.wood).toBe(2);
  });

  it('une route dans une zone sans lien avec l’hôtel de ville ne relie rien', () => {
    const g = Game.create(23);
    rich(g);
    const [x, y] = findSpot(g, 'gatherer', false);
    const b = g.place('gatherer', x, y, 0).building!;
    if (!g.connected.has(b.id)) {
      expect(g.roadConnected.some((v, i) => v === 1 && g.s.roads[i] === 0)).toBe(false);
    }
    // les routes reliées forment un sous-ensemble des routes
    for (let i = 0; i < g.N * g.N; i++) if (g.roadConnected[i]) expect(g.s.roads[i]).toBe(1);
  });
});
