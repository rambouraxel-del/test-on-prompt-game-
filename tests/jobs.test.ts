import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/world';
import { killCitizen } from '../src/sim/logic';
import { findSpot, rich, run } from './helpers';

describe('affectation des travailleurs', () => {
  it('un adulte n’occupe qu’un poste, sans dépasser les places ni le personnel disponible', () => {
    const g = Game.create(31);
    rich(g);
    g.s.stock.wood = 220;
    const buildings = [] as number[];
    for (const t of ['gatherer', 'well', 'woodcutter', 'stonecutter', 'gatherer'] as const) {
      const [x, y] = findSpot(g, t);
      g.s.stock.wood = 220;
      g.s.stock.stone = 160;
      buildings.push(g.place(t, x, y, 0).building!.id);
    }
    // 12 adultes pour 15 postes
    let ok = 0;
    for (const id of buildings) for (let i = 0; i < 5; i++) if (g.addWorker(id).ok) ok++;
    expect(ok).toBe(12);
    for (const id of buildings) expect(g.bById.get(id)!.workers.length).toBeLessThanOrEqual(3);
    const all = g.s.buildings.flatMap((b) => b.workers);
    expect(new Set(all).size).toBe(all.length);
    for (const c of g.s.citizens) {
      if (c.jobId === null) continue;
      expect(g.bById.get(c.jobId)!.workers.filter((w) => w === c.id).length).toBe(1);
    }
    expect(g.addWorker(buildings[4]).reason).toMatch(/Aucun adulte|pourvus/);
    // Retrait puis réaffectation
    expect(g.removeWorker(buildings[0]).ok).toBe(true);
    expect(g.availableAdults().length).toBe(1);
  });

  it('un décès libère le poste, qui est pourvu automatiquement si un adulte est libre', () => {
    const g = Game.create(32);
    rich(g);
    const [x, y] = findSpot(g, 'gatherer');
    const b = g.place('gatherer', x, y, 0).building!;
    for (let i = 0; i < 3; i++) g.addWorker(b.id);
    const w = g.cById.get(b.workers[0])!;
    killCitizen(g, w, 'de test');
    expect(b.workers.includes(w.id)).toBe(false);
    expect(b.target).toBe(3);
    run(g, 0.01);
    expect(b.workers.length).toBe(3);
  });

  it('les enfants et retraités ne peuvent pas travailler', () => {
    const g = Game.create(33);
    rich(g);
    const [x, y] = findSpot(g, 'gatherer');
    const b = g.place('gatherer', x, y, 0).building!;
    for (const c of g.s.citizens) c.age = c.id % 2 ? 10 : 70;
    expect(g.addWorker(b.id).ok).toBe(false);
  });
});
