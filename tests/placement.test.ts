import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/world';
import { T_WATER } from '../src/sim/types';
import { findSpot, rich } from './helpers';

describe('placement et collisions', () => {
  it('accepte un emplacement libre et paie seulement après validation', () => {
    const g = Game.create(11);
    rich(g);
    const [x, y] = findSpot(g, 'gatherer');
    const wood = g.s.stock.wood;
    const r = g.place('gatherer', x, y, 0);
    expect(r.ok).toBe(true);
    expect(g.s.stock.wood).toBe(wood - 20);
    // Un second placement au même endroit échoue sans rien payer
    const r2 = g.place('gatherer', x, y, 0);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toMatch(/bâtiment/);
    expect(g.s.stock.wood).toBe(wood - 20);
  });

  it('refuse l’eau, les ressources, les routes, le territoire verrouillé et le hors-carte', () => {
    const g = Game.create(12);
    rich(g);
    const N = g.N;
    // eau dans le territoire
    let water: [number, number] | null = null;
    for (let i = 0; i < N * N && !water; i++) if (g.s.terrain[i] === T_WATER && g.owned(i % N, Math.floor(i / N))) water = [i % N, Math.floor(i / N)];
    expect(water).not.toBeNull();
    expect(g.canPlace('well', water![0], water![1], 0).reason).toMatch(/eau/);
    // arbre
    const tree = g.s.nodes.find((n) => n.kind === 'tree' && g.owned(n.x, n.y))!;
    expect(g.canPlace('garden', tree.x, tree.y, 0).reason).toMatch(/arbre/);
    // route (route principale en y = 49)
    expect(g.canPlace('garden', 37, 49, 0).reason).toMatch(/route/);
    // territoire verrouillé
    expect(g.canPlace('garden', 5, 5, 0).reason).toMatch(/Territoire/);
    // hors carte
    expect(g.canPlace('garden', 96, 50, 0).reason).toMatch(/Hors/);
    // bâtiment existant (hôtel de ville)
    expect(g.canPlace('garden', 47, 46, 0).reason).toMatch(/bâtiment/);
  });

  it('la rotation échange l’empreinte des bâtiments rectangulaires', () => {
    const g = Game.create(13);
    rich(g);
    expect(g.footprint('house', 0)).toEqual([4, 2]);
    expect(g.footprint('house', 1)).toEqual([2, 4]);
    const [x, y] = findSpot(g, 'house', false, 1);
    const r = g.place('house', x, y, 1);
    expect(r.ok).toBe(true);
    expect([r.building!.w, r.building!.h]).toEqual([2, 4]);
  });

  it('refuse un bâtiment verrouillé ou trop cher', () => {
    const g = Game.create(14);
    rich(g);
    const [x, y] = findSpot(g, 'gatherer');
    expect(g.canPlace('farm', x, y, 0).reason).toMatch(/16 habitants/);
    g.s.stock.wood = 3;
    expect(g.canPlace('gatherer', x, y, 0).reason).toMatch(/insuffisantes/);
  });

  it('démolition : remboursement partiel annoncé et hôtel de ville protégé', () => {
    const g = Game.create(15);
    rich(g);
    const [x, y] = findSpot(g, 'woodcutter');
    const b = g.place('woodcutter', x, y, 0).building!;
    const refund = g.refundFor(b);
    expect(refund).toEqual({ wood: 10, stone: 2 });
    const wood = g.s.stock.wood;
    expect(g.demolish(b.id).ok).toBe(true);
    expect(g.s.stock.wood).toBe(wood + 10);
    expect(g.buildingAt(x, y)).toBeNull();
    expect(g.demolish(g.townhall().id).ok).toBe(false);
  });

  it('achat de parcelle adjacente avec coût croissant', () => {
    const g = Game.create(16);
    g.s.stock = { food: 250, water: 250, wood: 220, stone: 160 };
    expect(g.parcelCheck(0, 0).ok).toBe(false);
    const c0 = g.parcelCost();
    expect(g.parcelCheck(1, 2).ok).toBe(true);
    expect(g.buyParcel(1, 2).ok).toBe(true);
    expect(g.owned(16, 32)).toBe(true);
    const c1 = g.parcelCost();
    expect(c1.wood!).toBeGreaterThan(c0.wood!);
    expect(g.parcelCheck(0, 2).ok || g.parcelCheck(0, 2).reason?.includes('insuffisantes')).toBeTruthy();
  });
});
