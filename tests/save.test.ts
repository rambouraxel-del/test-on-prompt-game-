import { describe, expect, it } from 'vitest';
import { Bot } from '../src/sim/bot';
import { deserialize, SaveError, serialize } from '../src/sim/save';
import { Game } from '../src/sim/world';
import { run, snapshot } from './helpers';

describe('sauvegarde et chargement', () => {
  it('conserve exactement l’état logique et reprend à l’identique', () => {
    const g = Game.create(71);
    const bot = new Bot(g);
    for (let i = 0; i < 1200 * 6; i++) {
      g.step();
      if (i % 20 === 0) bot.tick();
    }
    const text = serialize(g);
    const h = deserialize(text);
    expect(snapshot(h)).toBe(snapshot(g));
    // La suite de la simulation est identique
    run(g, 2);
    run(h, 2);
    expect(snapshot(h)).toBe(snapshot(g));
    expect(h.s.citizens.length).toBe(g.s.citizens.length);
  });

  it('refuse les données corrompues avec un message clair', () => {
    const g = Game.create(72);
    const good = JSON.parse(serialize(g));
    const bad = (mut: (d: any) => void) => {
      const d = structuredClone(good);
      mut(d);
      return () => deserialize(JSON.stringify(d));
    };
    expect(() => deserialize('pas du json')).toThrow(SaveError);
    expect(bad((d) => (d.game = 'autre'))).toThrow(/Premiers Foyers/);
    expect(bad((d) => (d.version = 99))).toThrow(/plus récente/);
    expect(bad((d) => (d.terrain = '0:5;'))).toThrow(/terrain/);
    expect(bad((d) => (d.buildings[1].x = d.buildings[0].x))).toThrow();
    expect(bad((d) => (d.citizens[0].houseId = 999))).toThrow(/Logement/);
    expect(bad((d) => (d.citizens[0].age = -3))).toThrow(/Âge/);
    expect(bad((d) => (d.stock.food = -1))).toThrow(/Réserves/);
    expect(bad((d) => d.buildings.shift())).toThrow(/Hôtel de ville/);
  });
});
