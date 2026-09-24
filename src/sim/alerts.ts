import { BUILDINGS } from '../config/buildings';
import { AGES, SEASONS } from '../config/balance';
import { autonomy, birthBlockers, demand, averageHappiness } from './logic';
import type { Game } from './world';

export interface Alert {
  id: string;
  level: 'bad' | 'warn' | 'info';
  text: string;
  x?: number;
  y?: number;
  buildingId?: number;
}

function months(years: number) {
  return Math.max(0, Math.round(years * 12));
}

/** Alertes actionnables calculées à partir de l'état courant. */
export function computeAlerts(g: Game): Alert[] {
  const out: Alert[] = [];
  const th = g.townhall();
  const [tx, ty] = th ? g.center(th) : [48, 48];
  for (const k of ['food', 'water'] as const) {
    const label = k === 'food' ? 'nourriture' : 'eau';
    if (g.s.shortage[k] > 0) out.push({ id: 'short-' + k, level: 'bad', text: `Pénurie d’${k === 'food' ? 'aliments' : 'eau'} : la santé chute !`, x: tx, y: ty });
    else {
      const a = autonomy(g, k);
      if (a < 0.5) out.push({ id: 'low-' + k, level: 'warn', text: `Réserves de ${label} : ~${months(a)} mois d’autonomie`, x: tx, y: ty });
    }
    if (g.s.stock[k] >= g.capacity[k] - 0.5) out.push({ id: 'cap-' + k, level: 'info', text: `Stock de ${label} plein : construisez un grenier`, x: tx, y: ty });
  }
  // Hiver et bois
  const si = g.seasonIndex;
  const d = demand(g);
  const winterNeed = (SEASONS[3].heating ? g.s.buildings.filter((b) => b.type === 'house' && g.occupants(b.id) > 0).length : 0) * 3.5;
  if ((si === 2 || si === 3) && g.s.stock.wood < winterNeed) out.push({ id: 'wood-winter', level: 'warn', text: 'Bois insuffisant pour chauffer les maisons cet hiver', x: tx, y: ty });
  if (si === 3 && g.s.shortage.wood > 0 && d.wood > 0) out.push({ id: 'cold', level: 'bad', text: 'Les maisons ont froid : manque de bois', x: tx, y: ty });
  for (const k of ['wood', 'stone'] as const)
    if (g.s.stock[k] >= g.capacity[k] - 0.5) out.push({ id: 'cap-' + k, level: 'info', text: `Stock de ${k === 'wood' ? 'bois' : 'pierre'} plein`, x: tx, y: ty });

  // Bâtiments en difficulté (regroupés par type de problème au-delà de deux)
  const groups: Record<string, { level: Alert['level']; items: { text: string; b: (typeof g.s.buildings)[number] }[]; plural: string }> = {
    dis: { level: 'bad', items: [], plural: 'bâtiments non reliés à la route' },
    staff: { level: 'warn', items: [], plural: 'bâtiments sans personnel' },
    res: { level: 'warn', items: [], plural: 'exploitations sans ressource' },
    full: { level: 'info', items: [], plural: 'services à capacité saturée' },
  };
  for (const b of g.s.buildings) {
    const st = g.status.get(b.id);
    if (!st || st.status === 'active' || b.type === 'house') continue;
    const name = BUILDINGS[b.type].name;
    if (st.status === 'disconnected') groups.dis.items.push({ text: `${name} non relié(e) à la route`, b });
    else if (st.status === 'nostaff') groups.staff.items.push({ text: `${name} sans personnel`, b });
    else if (st.status === 'noresource') groups.res.items.push({ text: `${name} : ${st.msg.toLowerCase()}`, b });
    else if (st.status === 'full' && (b.type === 'altar' || b.type === 'school' || b.type === 'clinic')) groups.full.items.push({ text: `${name} : capacité saturée`, b });
  }
  for (const [key, grp] of Object.entries(groups)) {
    if (!grp.items.length) continue;
    const list = grp.items.length > 2 ? [{ text: `${grp.items.length} ${grp.plural}`, b: grp.items[0].b }] : grp.items;
    for (const it of list) {
      const [cx, cy] = g.center(it.b);
      out.push({ id: key + it.b.id + (list.length === 1 && grp.items.length > 2 ? 'g' : ''), level: grp.level, text: it.text, x: cx, y: cy, buildingId: it.b.id });
    }
  }
  const discHouses = g.s.buildings.filter((b) => b.type === 'house' && !g.connected.has(b.id));
  if (discHouses.length) {
    const [cx, cy] = g.center(discHouses[0]);
    out.push({ id: 'dishouse', level: 'warn', text: `${discHouses.length} maison(s) non reliée(s) : pas de services`, x: cx, y: cy, buildingId: discHouses[0].id });
  }
  const homeless = g.s.citizens.filter((c) => c.houseId === null).length;
  if (homeless) out.push({ id: 'homeless', level: 'bad', text: `${homeless} habitant(s) sans abri : construisez des maisons`, x: tx, y: ty });
  const idle = g.availableAdults().length;
  if (idle) out.push({ id: 'idle', level: 'info', text: `${idle} adulte(s) sans emploi`, x: tx, y: ty });
  // Naissances bloquées faute de place
  const blocked = g.s.citizens.filter(
    (c) => c.sex === 'F' && c.partnerId !== null && c.age >= AGES.FERTILE_MIN && c.age <= AGES.FERTILE_MAX && !c.pregnancy && birthBlockers(g, c).includes('aucune place libre dans la maison'),
  );
  if (blocked.length) {
    const h = g.bById.get(blocked[0].houseId!);
    out.push({
      id: 'nobirth',
      level: 'info',
      text: `${blocked.length} couple(s) sans place pour un enfant : bâtissez ou améliorez des maisons`,
      x: h ? g.center(h)[0] : tx,
      y: h ? g.center(h)[1] : ty,
      buildingId: h?.id,
    });
  }
  const hap = averageHappiness(g);
  if (g.s.citizens.length && hap < 45) out.push({ id: 'unhappy', level: 'warn', text: `Bonheur moyen bas (${Math.round(hap)} %)`, x: tx, y: ty });
  const sick = g.s.citizens.filter((c) => c.health < 35).length;
  if (sick) out.push({ id: 'sick', level: 'bad', text: `${sick} habitant(s) en mauvaise santé`, x: tx, y: ty });
  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
