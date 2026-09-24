import { MAP, RES_KEYS } from '../config/balance';
import { BUILDINGS, type BuildingType } from '../config/buildings';
import type { Building, Citizen, GameState, ResourceNode } from './types';
import { Game, SAVE_VERSION } from './world';

export class SaveError extends Error {}

const GAME_ID = 'les-premiers-foyers';

function encodeBytes(a: Uint8Array): string {
  // Encodage RLE compact "valeur:nombre;"
  let out = '';
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v) n++;
    out += n === 1 ? `${v};` : `${v}:${n};`;
    i += n;
  }
  return out;
}

function decodeBytes(s: unknown, len: number, max: number, label: string): Uint8Array {
  if (typeof s !== 'string') throw new SaveError(`Champ « ${label} » manquant`);
  const out = new Uint8Array(len);
  let p = 0;
  for (const tok of s.split(';')) {
    if (!tok) continue;
    const [vs, ns] = tok.split(':');
    const v = Number(vs);
    const n = ns === undefined ? 1 : Number(ns);
    if (!Number.isInteger(v) || v < 0 || v > max || !Number.isInteger(n) || n < 1 || p + n > len)
      throw new SaveError(`Champ « ${label} » corrompu`);
    out.fill(v, p, p + n);
    p += n;
  }
  if (p !== len) throw new SaveError(`Champ « ${label} » de taille incorrecte`);
  return out;
}

export function serialize(g: Game): string {
  const s = g.s;
  s.rng = g.rng.state;
  const data = {
    game: GAME_ID,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    seed: s.seed,
    rng: s.rng,
    tick: s.tick,
    size: s.size,
    terrain: encodeBytes(s.terrain),
    decor: encodeBytes(s.decor),
    roads: encodeBytes(s.roads),
    nodes: s.nodes.map((n) => [n.kind === 'tree' ? 0 : 1, n.x, n.y, n.stock, n.max, n.state, n.timer, n.variant]),
    parcels: s.parcels.map((p) => (p ? 1 : 0)).join(''),
    parcelsBought: s.parcelsBought,
    buildings: s.buildings,
    nextBuildingId: s.nextBuildingId,
    citizens: s.citizens,
    nextCitizenId: s.nextCitizenId,
    stock: s.stock,
    events: s.events,
    nextEventAt: s.nextEventAt,
    shortage: s.shortage,
    progress: s.progress,
    log: s.log.slice(-40),
  };
  return JSON.stringify(data);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
function req(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new SaveError(msg);
}

export function deserialize(text: string): Game {
  let d: any;
  try {
    d = JSON.parse(text);
  } catch {
    throw new SaveError('Le fichier n’est pas un JSON valide.');
  }
  req(d && typeof d === 'object', 'Contenu vide ou invalide.');
  req(d.game === GAME_ID, 'Ce fichier n’est pas une sauvegarde des Premiers Foyers.');
  req(isInt(d.version), 'Version de sauvegarde absente.');
  req(d.version <= SAVE_VERSION, `Version de sauvegarde ${d.version} plus récente que le jeu (${SAVE_VERSION}).`);
  req(d.size === MAP.SIZE, 'Taille de carte incompatible.');
  const N = MAP.SIZE;
  req(isInt(d.seed) && isInt(d.rng) && isInt(d.tick) && d.tick >= 0, 'Graine ou horloge invalide.');
  const terrain = decodeBytes(d.terrain, N * N, 2, 'terrain');
  const decor = decodeBytes(d.decor, N * N, 5, 'décor');
  const roads = decodeBytes(d.roads, N * N, 1, 'routes');

  req(Array.isArray(d.nodes), 'Liste des ressources naturelles absente.');
  const nodes: ResourceNode[] = d.nodes.map((t: unknown, i: number) => {
    req(Array.isArray(t) && t.length === 8, `Ressource naturelle ${i} corrompue.`);
    const [k, x, y, stock, max, state, timer, variant] = t as any[];
    req(k === 0 || k === 1, `Type de ressource ${i} invalide.`);
    req(isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < N && y < N, `Position de ressource ${i} invalide.`);
    req(isNum(stock) && isNum(max) && stock >= 0 && stock <= max + 1e-6, `Stock de ressource ${i} invalide.`);
    req(state === 'ok' || state === 'depleted' || state === 'growing', `État de ressource ${i} invalide.`);
    req(isNum(timer) && isInt(variant), `Minuterie de ressource ${i} invalide.`);
    return { id: i, kind: k === 0 ? 'tree' : 'rock', x, y, stock, max, state, timer, variant };
  });

  req(typeof d.parcels === 'string' && d.parcels.length === 36 && /^[01]+$/.test(d.parcels), 'Parcelles invalides.');
  const parcels = [...d.parcels].map((c: string) => c === '1');
  req(isInt(d.parcelsBought) && d.parcelsBought >= 0, 'Compteur de parcelles invalide.');

  req(Array.isArray(d.buildings), 'Liste des bâtiments absente.');
  const occ = new Int32Array(N * N).fill(-1);
  const bIds = new Set<number>();
  const buildings: Building[] = d.buildings.map((b: any, i: number) => {
    req(b && typeof b === 'object', `Bâtiment ${i} corrompu.`);
    req(typeof b.type === 'string' && b.type in BUILDINGS, `Type de bâtiment ${i} inconnu.`);
    const def = BUILDINGS[b.type as BuildingType];
    req(isInt(b.id) && !bIds.has(b.id), `Identifiant de bâtiment ${i} invalide.`);
    bIds.add(b.id);
    req(b.rot === 0 || b.rot === 1, `Rotation du bâtiment ${i} invalide.`);
    const w = b.rot ? def.h : def.w;
    const h = b.rot ? def.w : def.h;
    req(b.w === w && b.h === h, `Empreinte du bâtiment ${i} incohérente.`);
    req(isInt(b.x) && isInt(b.y) && b.x >= 0 && b.y >= 0 && b.x + w <= N && b.y + h <= N, `Position du bâtiment ${i} hors carte.`);
    req(isInt(b.level) && b.level >= 1 && b.level <= 3, `Niveau du bâtiment ${i} invalide.`);
    req(Array.isArray(b.workers) && b.workers.every(isInt), `Personnel du bâtiment ${i} invalide.`);
    req(isInt(b.target) && b.target >= 0 && isInt(b.reserved) && b.reserved >= 0, `Compteurs du bâtiment ${i} invalides.`);
    for (let y = b.y; y < b.y + h; y++)
      for (let x = b.x; x < b.x + w; x++) {
        req(occ[y * N + x] === -1, `Bâtiments superposés (${i}).`);
        req(terrain[y * N + x] !== 1, `Bâtiment ${i} sur l’eau.`);
        req(!roads[y * N + x], `Bâtiment ${i} sur une route.`);
        occ[y * N + x] = b.id;
      }
    return { id: b.id, type: b.type, x: b.x, y: b.y, w, h, rot: b.rot, level: b.level, workers: [...b.workers], target: b.target, reserved: b.reserved };
  });
  req(buildings.filter((b) => b.type === 'townhall').length === 1, 'Hôtel de ville absent ou dupliqué.');

  req(Array.isArray(d.citizens), 'Liste des habitants absente.');
  const cIds = new Set<number>();
  const citizens: Citizen[] = d.citizens.map((c: any, i: number) => {
    req(c && typeof c === 'object', `Habitant ${i} corrompu.`);
    req(isInt(c.id) && !cIds.has(c.id), `Identifiant d’habitant ${i} invalide.`);
    cIds.add(c.id);
    req(typeof c.first === 'string' && typeof c.last === 'string', `Nom de l’habitant ${i} invalide.`);
    req(c.sex === 'M' || c.sex === 'F', `Sexe de l’habitant ${i} invalide.`);
    req(isNum(c.age) && c.age >= 0 && c.age < 150, `Âge de l’habitant ${i} invalide.`);
    req(isNum(c.health) && c.health >= 0 && c.health <= 100, `Santé de l’habitant ${i} invalide.`);
    req(isNum(c.happiness) && c.happiness >= 0 && c.happiness <= 100, `Bonheur de l’habitant ${i} invalide.`);
    req(isNum(c.education) && c.education >= 0 && c.education <= 1, `Éducation de l’habitant ${i} invalide.`);
    req(isNum(c.sinceBirth), `Données de naissance de l’habitant ${i} invalides.`);
    for (const k of ['houseId', 'jobId', 'partnerId', 'fatherId', 'motherId']) req(c[k] === null || isInt(c[k]), `Lien ${k} de l’habitant ${i} invalide.`);
    if (c.pregnancy !== null) {
      req(typeof c.pregnancy === 'object' && isNum(c.pregnancy.remaining) && isInt(c.pregnancy.fatherId), `Grossesse de l’habitant ${i} invalide.`);
      req(c.pregnancy.houseId === null || isInt(c.pregnancy.houseId), `Grossesse de l’habitant ${i} invalide.`);
    }
    return {
      id: c.id,
      first: c.first,
      last: c.last,
      sex: c.sex,
      age: c.age,
      health: c.health,
      happiness: c.happiness,
      houseId: c.houseId,
      jobId: c.jobId,
      education: c.education,
      partnerId: c.partnerId,
      fatherId: c.fatherId,
      motherId: c.motherId,
      pregnancy: c.pregnancy ? { ...c.pregnancy } : null,
      sinceBirth: c.sinceBirth,
    };
  });
  // Cohérence des références
  const bMap = new Map(buildings.map((b) => [b.id, b]));
  const cMap = new Map(citizens.map((c) => [c.id, c]));
  for (const c of citizens) {
    if (c.houseId !== null) req(bMap.get(c.houseId)?.type === 'house', `Logement de ${c.first} introuvable.`);
    if (c.jobId !== null) req(bMap.get(c.jobId)?.workers.includes(c.id), `Emploi de ${c.first} incohérent.`);
    if (c.partnerId !== null) req(cMap.get(c.partnerId)?.partnerId === c.id, `Couple de ${c.first} incohérent.`);
  }
  const seenWorkers = new Set<number>();
  for (const b of buildings)
    for (const w of b.workers) {
      req(cMap.get(w)?.jobId === b.id, 'Affectation de travailleur incohérente.');
      req(!seenWorkers.has(w), 'Travailleur affecté deux fois.');
      seenWorkers.add(w);
    }
  for (const b of buildings) {
    if (b.type !== 'house') continue;
    const occN = citizens.filter((c) => c.houseId === b.id).length;
    const cap = BUILDINGS.house.housing![b.level - 1];
    req(occN + b.reserved <= cap, 'Maison au-delà de sa capacité.');
  }

  req(d.stock && RES_KEYS.every((k) => isNum(d.stock[k]) && d.stock[k] >= 0), 'Réserves invalides.');
  req(Array.isArray(d.events), 'Événements invalides.');
  for (const e of d.events) req(e && ['harvest', 'drought', 'illness'].includes(e.kind) && isNum(e.remaining) && isNum(e.total), 'Événement invalide.');
  req(isNum(d.nextEventAt), 'Calendrier des événements invalide.');
  req(d.shortage && isNum(d.shortage.food) && isNum(d.shortage.water) && isNum(d.shortage.wood), 'Pénuries invalides.');
  const p = d.progress;
  req(p && isInt(p.maxPop) && isNum(p.victoryHold) && typeof p.victory === 'boolean' && isInt(p.tutorialStep), 'Progression invalide.');
  req(isInt(d.nextBuildingId) && isInt(d.nextCitizenId), 'Compteurs invalides.');
  req(Array.isArray(d.log), 'Journal invalide.');

  const state: GameState = {
    version: SAVE_VERSION,
    seed: d.seed >>> 0,
    rng: d.rng >>> 0,
    tick: d.tick,
    size: N,
    terrain,
    decor,
    roads,
    nodes,
    parcels,
    parcelsBought: d.parcelsBought,
    buildings,
    nextBuildingId: Math.max(d.nextBuildingId, ...buildings.map((b) => b.id + 1)),
    citizens,
    nextCitizenId: Math.max(d.nextCitizenId, ...citizens.map((c) => c.id + 1), 1),
    stock: { food: d.stock.food, water: d.stock.water, wood: d.stock.wood, stone: d.stock.stone },
    events: d.events.map((e: any) => ({ kind: e.kind, remaining: e.remaining, total: e.total })),
    nextEventAt: d.nextEventAt,
    shortage: { food: d.shortage.food, water: d.shortage.water, wood: d.shortage.wood },
    progress: {
      maxPop: p.maxPop,
      victoryHold: p.victoryHold,
      victory: p.victory,
      freePlay: !!p.freePlay,
      defeat: !!p.defeat,
      tutorialStep: p.tutorialStep,
      tutorialDone: !!p.tutorialDone,
      births: isInt(p.births) ? p.births : 0,
      deaths: isInt(p.deaths) ? p.deaths : 0,
      unlockTier: isInt(p.unlockTier) ? p.unlockTier : 0,
    },
    log: d.log
      .filter((e: any) => e && typeof e.text === 'string')
      .map((e: any) => ({ t: isNum(e.t) ? e.t : 0, text: e.text, kind: e.kind ?? 'info', x: e.x, y: e.y })),
  };
  const g = new Game(state);
  g.rebuildDerived();
  // Mise à jour immédiate des données dérivées sans avancer le temps.
  return g;
}
