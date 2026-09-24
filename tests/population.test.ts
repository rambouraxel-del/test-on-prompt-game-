import { describe, expect, it } from 'vitest';
import { AGES } from '../src/config/balance';
import { birthBlockers, related } from '../src/sim/logic';
import { Game } from '../src/sim/world';
import { findSpot, rich, run } from './helpers';

function comfy(g: Game) {
  g.s.stock = { food: 250, water: 250, wood: 220, stone: 160 };
}

describe('démographie', () => {
  it('la première naissance survient rapidement avec des réserves correctes', () => {
    const g = Game.create(61);
    let t = -1;
    for (let i = 0; i < 1200 * 4 && t < 0; i++) {
      if (i % 200 === 0) comfy(g);
      g.step();
      if (g.s.progress.births > 0) t = g.years;
    }
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(3);
  });

  it('une naissance exige une place libre, réservée pendant la grossesse ; la capacité n’est jamais dépassée', () => {
    const g = Game.create(62);
    for (let i = 0; i < 1200 * 12; i++) {
      if (i % 100 === 0) comfy(g);
      g.step();
      if (i % 50 === 0)
        for (const h of g.s.buildings.filter((b) => b.type === 'house')) expect(g.occupants(h.id) + h.reserved).toBeLessThanOrEqual(g.housingCap(h));
    }
    // Maisons pleines : les couples sont bloqués par le logement
    const blocked = g.s.citizens.filter((c) => c.sex === 'F' && c.partnerId !== null && !c.pregnancy && birthBlockers(g, c).includes('aucune place libre dans la maison'));
    const housesFull = g.s.buildings.filter((b) => b.type === 'house').every((h) => g.houseFree(h) <= 0);
    if (housesFull) expect(blocked.length).toBeGreaterThan(0);
    // Réservations cohérentes avec les grossesses en cours
    const reserved = g.s.buildings.reduce((a, b) => a + b.reserved, 0);
    const pregnantWithRes = g.s.citizens.filter((c) => c.pregnancy && c.pregnancy.houseId !== null).length;
    expect(reserved).toBe(pregnantWithRes);
  });

  it('aucun couple entre parents/enfants ni frères et sœurs', () => {
    const g = Game.create(63);
    for (let i = 0; i < 1200 * 30; i++) {
      if (i % 100 === 0) comfy(g);
      if (i % 3000 === 0) {
        g.s.stock.wood = 220;
        g.s.stock.stone = 160;
        try {
          const [x, y] = findSpot(g, 'house', false);
          g.place('house', x, y, 0);
        } catch {
          /* plus de place */
        }
      }
      g.step();
    }
    for (const c of g.s.citizens) {
      if (c.partnerId === null) continue;
      const p = g.cById.get(c.partnerId)!;
      expect(related(c, p)).toBe(false);
      expect(p.sex).not.toBe(c.sex);
      expect(p.partnerId).toBe(c.id);
    }
    expect(g.s.progress.births).toBeGreaterThan(5);
  });

  it('passage enfant → adulte, retraite (libère l’emploi) et décès (libère logement et conjoint)', () => {
    const g = Game.create(64);
    rich(g);
    const [x, y] = findSpot(g, 'gatherer');
    const b = g.place('gatherer', x, y, 0).building!;
    const kid = g.addCitizen('M', AGES.ADULT - 0.05, g.s.buildings.find((h) => h.type === 'house')!.id, null, null);
    expect(g.isAdultWorker(kid)).toBe(false);
    run(g, 0.1);
    expect(g.isAdultWorker(kid)).toBe(true);
    expect(g.s.log.some((e) => e.text.includes('devient adulte'))).toBe(true);
    // retraite
    g.addWorker(b.id);
    const w = g.cById.get(b.workers[0])!;
    w.age = AGES.RETIRE - 0.01;
    run(g, 0.05);
    expect(w.jobId).toBeNull();
    expect(b.workers.includes(w.id)).toBe(false);
    // décès par santé nulle
    const victim = g.s.citizens.find((c) => c.partnerId !== null)!;
    const partner = g.cById.get(victim.partnerId!)!;
    victim.health = 0;
    g.s.stock.food = 0;
    run(g, 0.02);
    expect(g.cById.has(victim.id)).toBe(false);
    expect(partner.partnerId).toBeNull();
  });

  it('démolir une maison reloge ses habitants ou les rend sans-abri, sans jamais les faire disparaître', () => {
    const g = Game.create(65);
    const pop = g.s.citizens.length;
    const houses = g.s.buildings.filter((b) => b.type === 'house');
    g.demolish(houses[0].id);
    expect(g.s.citizens.length).toBe(pop);
    g.demolish(houses[1].id);
    g.demolish(houses[2].id);
    expect(g.s.citizens.length).toBe(pop);
    const homeless = g.s.citizens.filter((c) => c.houseId === null).length;
    expect(homeless).toBeGreaterThan(0);
    const last = houses[3];
    expect(g.occupants(last.id)).toBeLessThanOrEqual(g.housingCap(last));
    // Une nouvelle maison permet le relogement automatique
    g.s.stock.wood = 200;
    g.s.stock.stone = 100;
    const [x, y] = findSpot(g, 'house', false);
    g.place('house', x, y, 0);
    run(g, 0.05);
    expect(g.s.citizens.filter((c) => c.houseId === null).length).toBeLessThan(homeless);
  });
});
