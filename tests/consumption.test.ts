import { describe, expect, it } from 'vitest';
import { demand } from '../src/sim/logic';
import { Game } from '../src/sim/world';
import { findSpot, rich, run } from './helpers';

describe('consommation et pénuries', () => {
  it('les stocks ne deviennent jamais négatifs et la pénurie dégrade santé puis cause des décès', () => {
    const g = Game.create(51);
    g.s.stock.food = 5;
    g.s.stock.water = 400;
    let minFood = Infinity;
    let firstShortage = -1;
    for (let i = 0; i < 1200 * 4; i++) {
      g.step();
      minFood = Math.min(minFood, g.s.stock.food, g.s.stock.water, g.s.stock.wood, g.s.stock.stone);
      if (firstShortage < 0 && g.s.shortage.food > 0) firstShortage = g.years;
    }
    expect(minFood).toBeGreaterThanOrEqual(0);
    expect(firstShortage).toBeGreaterThan(0);
    expect(g.s.progress.deaths).toBeGreaterThan(0);
    // Délai de réaction : aucun décès pendant la première demi-année de pénurie
    const firstDeath = g.s.log.find((e) => /mort/.test(e.text));
    expect(firstDeath!.t / 60 - firstShortage).toBeGreaterThan(0.5);
  });

  it('les enfants consomment moins que les adultes', () => {
    const g = Game.create(52);
    const d0 = demand(g);
    const c = g.s.citizens[0];
    c.age = 8;
    const d1 = demand(g);
    expect(d1.food).toBeLessThan(d0.food);
  });

  it('une capacité atteinte bloque proprement la production', () => {
    const g = Game.create(53);
    rich(g);
    const [x, y] = findSpot(g, 'well');
    const b = g.place('well', x, y, 0).building!;
    for (let i = 0; i < 3; i++) g.addWorker(b.id);
    g.s.stock.water = g.capacity.water;
    run(g, 0.01);
    expect(g.s.stock.water).toBeLessThanOrEqual(g.capacity.water);
    // Consommation en cours : la production reprend, sans jamais dépasser la capacité
    run(g, 1);
    expect(g.s.stock.water).toBeLessThanOrEqual(g.capacity.water + 1e-9);
    g.s.stock.water = g.capacity.water;
    for (const c of g.s.citizens) c.age = 0.5; // consommation minimale
    g.step();
    for (let i = 0; i < 5; i++) g.step();
    const st = g.status.get(b.id);
    expect(['full', 'active']).toContain(st?.status);
  });

  it('une colonie négligée finit par disparaître', () => {
    const g = Game.create(54);
    run(g, 8);
    expect(g.s.citizens.length).toBe(0);
    expect(g.s.progress.defeat).toBe(true);
  });
});
