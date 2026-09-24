import { describe, expect, it } from 'vitest';
import { Bot } from '../src/sim/bot';
import { averageHappiness } from '../src/sim/logic';
import { Game } from '../src/sim/world';
import { STEPS_PER_YEAR } from './helpers';

describe('équilibrage (simulation accélérée avec stratégie simple)', () => {
  it('une stratégie simple fait croître la colonie sur plusieurs décennies', () => {
    for (const seed of [101, 202]) {
      const g = Game.create(seed);
      const bot = new Bot(g);
      let minStock = Infinity;
      let grownKid = false;
      for (let i = 0; i < STEPS_PER_YEAR * 35; i++) {
        g.step();
        if (i % 20 === 0) bot.tick();
        minStock = Math.min(minStock, ...Object.values(g.s.stock));
        if (!grownKid && g.s.citizens.some((c) => c.motherId !== null && c.age >= 18)) grownKid = true;
      }
      expect(minStock).toBeGreaterThanOrEqual(0);
      expect(g.s.citizens.length).toBeGreaterThan(25);
      expect(grownKid).toBe(true);
      expect(averageHappiness(g)).toBeGreaterThan(55);
      // Croissance maîtrisée
      expect(g.s.citizens.length).toBeLessThan(150);
    }
  }, 120_000);
});
