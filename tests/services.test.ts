import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/config/buildings';
import { happinessParts, updateServices } from '../src/sim/logic';
import { Game } from '../src/sim/world';
import { findSpot, run } from './helpers';

function unlockAll(g: Game) {
  g.s.progress.maxPop = 60;
  g.s.stock = { food: 250, water: 250, wood: 220, stone: 160 };
}

describe('services', () => {
  it('autels : bonus non cumulable et capacité respectée', () => {
    const g = Game.create(91);
    unlockAll(g);
    const [x1, y1] = findSpot(g, 'altar');
    g.place('altar', x1, y1, 0);
    unlockAll(g);
    const [x2, y2] = findSpot(g, 'altar');
    g.place('altar', x2, y2, 0);
    updateServices(g);
    const c = g.s.citizens[0];
    const parts = happinessParts(g, c).parts.filter((p) => /Autel/.test(p.label));
    expect(parts.length).toBeLessThanOrEqual(1);
    // Surcharge : trop d'habitants pour la capacité
    const house = g.bById.get(c.houseId!)!;
    house.level = 3;
    for (let i = 0; i < 40; i++) g.addCitizen('M', 30, null, null, null);
    updateServices(g);
    for (const [id, load] of g.altarLoad) {
      const a = g.bById.get(id)!;
      expect(load.served).toBeLessThanOrEqual(BUILDINGS.altar.users![a.level - 1]);
    }
  });

  it('école : scolarise avec des enseignants et fait progresser l’éducation', () => {
    const g = Game.create(92);
    unlockAll(g);
    const house = g.s.buildings.find((b) => b.type === 'house')!;
    // Libère de la place et ajoute un enfant
    const kid = g.addCitizen('F', 8, null, null, null);
    kid.houseId = house.id;
    const [x, y] = findSpot(g, 'school');
    const s = g.place('school', x, y, 0).building!;
    updateServices(g);
    expect(g.schoolOf.has(kid.id)).toBe(false); // pas d'enseignant
    g.addWorker(s.id);
    run(g, 1);
    expect(g.schoolOf.get(kid.id)).toBe(s.id);
    expect(kid.education).toBeGreaterThan(0.1);
  });

  it('dispensaire : améliore la santé mais ne compense pas une pénurie', () => {
    const g = Game.create(93);
    unlockAll(g);
    for (const c of g.s.citizens) c.health = 60;
    const [x, y] = findSpot(g, 'clinic');
    const cl = g.place('clinic', x, y, 0).building!;
    g.addWorker(cl.id);
    g.addWorker(cl.id);
    run(g, 0.5);
    const covered = g.s.citizens.filter((c) => c.houseId !== null && g.clinicOf.has(c.houseId));
    expect(covered.length).toBeGreaterThan(0);
    expect(covered[0].health).toBeGreaterThan(65);
    // Famine : aucune récupération même desservi
    g.s.stock.food = 0;
    const h0 = covered[0].health;
    run(g, 0.3);
    expect(covered[0].health).toBeLessThan(h0);
  });
});
