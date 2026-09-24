import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config/balance';
import { Runner } from '../src/sim/runner';
import { Game } from '../src/sim/world';
import { snapshot } from './helpers';

function playAt(fps: number, seconds: number, speed: number) {
  const g = Game.create(81);
  const r = new Runner(g);
  r.speed = speed;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) r.advance(1 / fps);
  return g;
}

describe('pas de temps fixe', () => {
  it('même graine ⇒ même carte et mêmes habitants', () => {
    expect(snapshot(Game.create(5))).toBe(snapshot(Game.create(5)));
    expect(snapshot(Game.create(5))).not.toBe(snapshot(Game.create(6)));
  });

  it('résultats identiques à 30, 60 et 144 images par seconde', () => {
    const seconds = 90;
    const a = playAt(30, seconds, 2);
    const b = playAt(60, seconds, 2);
    const c = playAt(144, seconds, 2);
    // Au plus un pas d'écart dû aux arrondis flottants ; on aligne puis on compare.
    const target = Math.max(a.s.tick, b.s.tick, c.s.tick);
    for (const g of [a, b, c]) while (g.s.tick < target) g.step();
    expect(Math.abs(target - (seconds * 2) / TIME.FIXED_DT)).toBeLessThanOrEqual(1);
    expect(snapshot(a)).toBe(snapshot(b));
    expect(snapshot(b)).toBe(snapshot(c));
  });

  it('un long gel (onglet masqué) n’entraîne pas de rattrapage massif', () => {
    const g = Game.create(82);
    const r = new Runner(g);
    r.speed = 4;
    const steps = r.advance(30);
    expect(steps).toBeLessThanOrEqual(TIME.MAX_STEPS_PER_FRAME);
  });
});
