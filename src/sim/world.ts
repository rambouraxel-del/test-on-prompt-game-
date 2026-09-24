import {
  AGES,
  DEMOLISH_REFUND,
  MAP,
  PARCELS,
  RES_KEYS,
  RES_LABEL,
  ROAD_COST,
  START,
  STORAGE,
  TIME,
  UNLOCKS,
  type Cost,
  type ResKey,
} from '../config/balance';
import { BUILDINGS, PRODUCERS, type BuildingType } from '../config/buildings';
import { generateMap } from './mapgen';
import { FAMILY_NAMES, FEMALE_NAMES, MALE_NAMES } from './names';
import { Rng } from './rng';
import {
  T_WATER,
  type Building,
  type BuildingStatus,
  type Citizen,
  type GameState,
  type LogEntry,
  type ResourceNode,
  type Stock,
} from './types';
import { logicStep } from './logic';
import { Agents } from './agents';

export const SAVE_VERSION = 1;

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
  cost: Cost;
}

export interface StatusInfo {
  status: BuildingStatus;
  msg: string;
}

export class Game {
  s: GameState;
  rng: Rng;
  readonly N = MAP.SIZE;

  // --- Données dérivées (recalculées, jamais sauvegardées) ---
  occ!: Int32Array;
  nodeAt!: Int32Array;
  bById = new Map<number, Building>();
  cById = new Map<number, Citizen>();
  roadConnected!: Uint8Array;
  connected = new Set<number>();
  walkCost!: Float32Array;
  region!: Int32Array;
  status = new Map<number, StatusInfo>();
  /** Autel desservant chaque maison. */
  altarOf = new Map<number, number>();
  altarLoad = new Map<number, { served: number; demand: number }>();
  clinicOf = new Map<number, number>();
  clinicLoad = new Map<number, { served: number; demand: number; capacity: number }>();
  gardenBonus = new Map<number, number>();
  schoolOf = new Map<number, number>();
  schoolLoad = new Map<number, { students: number; capacity: number }>();
  harvestTarget = new Map<number, number>();
  capacity: Stock = { food: 0, water: 0, wood: 0, stone: 0 };
  fed = { food: 1, water: 1, heat: 1 };
  /** Historique par seconde de jeu : production et consommation. */
  history: { prod: Stock; cons: Stock }[] = [];
  curProd: Stock = { food: 0, water: 0, wood: 0, stone: 0 };
  curCons: Stock = { food: 0, water: 0, wood: 0, stone: 0 };
  producedThisSecond = new Map<number, number>();
  buildingRate = new Map<number, number>();
  buildingRateAcc = new Map<number, number>();

  dirtyNetwork = true;
  dirtyWalk = true;
  groundVersion = 0;
  nodesVersion = 0;
  agents: Agents;
  onLog?: (e: LogEntry) => void;
  onVictory?: () => void;
  onDefeat?: () => void;

  constructor(state: GameState) {
    this.s = state;
    this.rng = new Rng(state.rng);
    this.agents = new Agents(this);
    this.rebuildDerived();
  }

  // ---------------------------------------------------------------- création
  static create(seed: number): Game {
    const rng = new Rng(seed);
    const map = generateMap(rng);
    const N = MAP.SIZE;
    const parcels = new Array(36).fill(false);
    for (const [px, py] of MAP.START_PARCELS) parcels[py * 6 + px] = true;
    const state: GameState = {
      version: SAVE_VERSION,
      seed,
      rng: 0,
      tick: 0,
      size: N,
      terrain: map.terrain,
      decor: map.decor,
      roads: new Uint8Array(N * N),
      nodes: map.nodes,
      parcels,
      parcelsBought: 0,
      buildings: [],
      nextBuildingId: 1,
      citizens: [],
      nextCitizenId: 1,
      stock: { ...START.stock },
      events: [],
      nextEventAt: 4,
      shortage: { food: 0, water: 0, wood: 0 },
      progress: {
        maxPop: 0,
        victoryHold: 0,
        victory: false,
        freePlay: false,
        defeat: false,
        tutorialStep: 0,
        tutorialDone: false,
        births: 0,
        deaths: 0,
        unlockTier: 0,
      },
      log: [],
    };
    state.rng = rng.state;
    const g = new Game(state);
    g.setupStart();
    g.s.rng = g.rng.state;
    return g;
  }

  private setupStart() {
    const c = this.N / 2;
    // Hôtel de ville centré, route principale en dessous, 4 maisons.
    const th = this.forcePlace('townhall', c - 2, c - 3, 0);
    const roadY = c + 1;
    for (let x = c - 11; x <= c + 10; x++) this.forceRoad(x, roadY);
    for (let y = c - 7; y <= roadY; y++) this.forceRoad(c - 3, y);
    for (let y = c - 7; y <= roadY; y++) this.forceRoad(c + 2, y);
    this.forcePlace('house', c - 9, c - 1, 0);
    this.forcePlace('house', c + 4, c - 1, 0);
    this.forcePlace('house', c - 9, c + 2, 0);
    this.forcePlace('house', c + 4, c + 2, 0);
    void th;
    // Habitants : 4 couples et 4 célibataires, âges variés.
    const houses = this.s.buildings.filter((b) => b.type === 'house');
    const surnames = [...FAMILY_NAMES];
    const takeSurname = () => surnames.splice(this.rng.int(0, surnames.length - 1), 1)[0];
    for (let i = 0; i < 4; i++) {
      const last = takeSurname();
      const m = this.addCitizen('M', this.rng.range(20, 40), houses[i].id, null, null, last);
      const f = this.addCitizen('F', Math.max(AGES.ADULT, m.age + this.rng.range(-6, 4)), houses[i].id, null, null, last);
      m.partnerId = f.id;
      f.partnerId = m.id;
      f.sinceBirth = 1.5;
    }
    const singles: ['M' | 'F', number][] = [
      ['M', 19],
      ['F', 20],
      ['M', 24],
      ['F', 22],
    ];
    singles.forEach(([sex, age], i) => {
      this.addCitizen(sex, age + this.rng.range(0, 3), houses[i].id, null, null, takeSurname());
    });
    for (const c2 of this.s.citizens) {
      c2.health = 80;
      c2.happiness = 62;
    }
    this.rebuildDerived();
    this.log('Les premiers colons s’installent autour de l’hôtel de ville.', 'good');
  }

  forcePlace(type: BuildingType, x: number, y: number, rot: 0 | 1): Building {
    const def = BUILDINGS[type];
    const w = rot ? def.h : def.w;
    const h = rot ? def.w : def.h;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = yy * this.N + xx;
        this.s.terrain[i] = 0;
        this.s.decor[i] = 0;
        this.s.roads[i] = 0;
      }
    this.s.nodes = this.s.nodes.filter((n) => n.x < x || n.x >= x + w || n.y < y || n.y >= y + h);
    const b: Building = { id: this.s.nextBuildingId++, type, x, y, w, h, rot, level: 1, workers: [], target: 0, reserved: 0 };
    this.s.buildings.push(b);
    this.rebuildDerived();
    return b;
  }

  private forceRoad(x: number, y: number) {
    const i = y * this.N + x;
    if (this.occ && this.occ[i] >= 0) return;
    this.s.terrain[i] = 0;
    this.s.decor[i] = 0;
    this.s.nodes = this.s.nodes.filter((n) => n.x !== x || n.y !== y);
    this.s.roads[i] = 1;
    this.rebuildDerived();
  }

  addCitizen(sex: 'M' | 'F', age: number, houseId: number | null, fatherId: number | null, motherId: number | null, last?: string): Citizen {
    const c: Citizen = {
      id: this.s.nextCitizenId++,
      first: this.rng.pick(sex === 'M' ? MALE_NAMES : FEMALE_NAMES),
      last: last ?? this.rng.pick(FAMILY_NAMES),
      sex,
      age,
      health: 80,
      happiness: 60,
      houseId,
      jobId: null,
      education: 0,
      partnerId: null,
      fatherId,
      motherId,
      pregnancy: null,
      sinceBirth: 99,
    };
    this.s.citizens.push(c);
    this.cById.set(c.id, c);
    return c;
  }

  // ---------------------------------------------------------------- dérivés
  rebuildDerived() {
    const N = this.N;
    this.bById.clear();
    for (const b of this.s.buildings) this.bById.set(b.id, b);
    this.cById.clear();
    for (const c of this.s.citizens) this.cById.set(c.id, c);
    this.occ = new Int32Array(N * N).fill(-1);
    for (const b of this.s.buildings)
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) this.occ[y * N + x] = b.id;
    this.rebuildNodeIndex();
    this.dirtyNetwork = true;
    this.dirtyWalk = true;
    this.groundVersion++;
    this.refreshNetwork();
    this.refreshWalk();
    this.computeCapacity();
  }

  rebuildNodeIndex() {
    this.nodeAt = new Int32Array(this.N * this.N).fill(-1);
    this.s.nodes.forEach((n, i) => {
      n.id = i;
      this.nodeAt[n.y * this.N + n.x] = i;
    });
    this.nodesVersion++;
  }

  // ---------------------------------------------------------------- temps
  get time(): number {
    return this.s.tick * TIME.FIXED_DT;
  }
  get years(): number {
    return this.time / TIME.YEAR_SECONDS;
  }
  get year(): number {
    return Math.floor(this.years) + 1;
  }
  get seasonIndex(): number {
    return Math.floor((this.years % 1) * 4) % 4;
  }
  get seasonProgress(): number {
    return ((this.years % 1) * 4) % 1;
  }

  /** Avance la simulation d'un pas fixe. */
  step() {
    this.s.tick++;
    this.agents.update(TIME.FIXED_DT);
    if (this.s.tick % TIME.LOGIC_EVERY === 0) {
      logicStep(this, (TIME.FIXED_DT * TIME.LOGIC_EVERY) / TIME.YEAR_SECONDS);
      this.s.rng = this.rng.state;
    }
  }

  // ---------------------------------------------------------------- utilitaires
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.N && y < this.N;
  }
  parcelIndex(x: number, y: number) {
    return Math.floor(y / MAP.PARCEL) * (this.N / MAP.PARCEL) + Math.floor(x / MAP.PARCEL);
  }
  owned(x: number, y: number) {
    return this.inBounds(x, y) && this.s.parcels[this.parcelIndex(x, y)];
  }
  nodeAtTile(x: number, y: number): ResourceNode | null {
    if (!this.inBounds(x, y)) return null;
    const i = this.nodeAt[y * this.N + x];
    return i >= 0 ? this.s.nodes[i] : null;
  }
  buildingAt(x: number, y: number): Building | null {
    if (!this.inBounds(x, y)) return null;
    const id = this.occ[y * this.N + x];
    return id >= 0 ? this.bById.get(id) ?? null : null;
  }
  townhall(): Building {
    return this.s.buildings.find((b) => b.type === 'townhall')!;
  }
  center(b: Building): [number, number] {
    return [b.x + b.w / 2, b.y + b.h / 2];
  }
  log(text: string, kind: LogEntry['kind'] = 'info', x?: number, y?: number) {
    const e: LogEntry = { t: this.time, text, kind, x, y };
    this.s.log.push(e);
    if (this.s.log.length > 80) this.s.log.splice(0, this.s.log.length - 80);
    this.onLog?.(e);
  }

  // ---------------------------------------------------------------- ressources
  canAfford(cost: Cost): boolean {
    return RES_KEYS.every((k) => (cost[k] ?? 0) <= this.s.stock[k] + 1e-9);
  }
  missingText(cost: Cost): string {
    const parts: string[] = [];
    for (const k of RES_KEYS) {
      const need = cost[k] ?? 0;
      if (need > this.s.stock[k] + 1e-9) parts.push(`${RES_LABEL[k].toLowerCase()} ${Math.floor(this.s.stock[k])}/${need}`);
    }
    return parts.length ? 'Ressources insuffisantes : ' + parts.join(', ') : '';
  }
  pay(cost: Cost) {
    for (const k of RES_KEYS) this.s.stock[k] = Math.max(0, this.s.stock[k] - (cost[k] ?? 0));
  }
  gain(k: ResKey, amount: number) {
    this.s.stock[k] = Math.min(this.capacity[k], this.s.stock[k] + amount);
  }

  computeCapacity() {
    const cap: Stock = { ...STORAGE.base };
    const th = this.s.buildings.find((b) => b.type === 'townhall');
    if (th) for (const k of RES_KEYS) cap[k] += (th.level - 1) * STORAGE.townhallPerLevel;
    for (const b of this.s.buildings)
      if (b.type === 'granary' && this.connected.has(b.id)) for (const k of RES_KEYS) cap[k] += STORAGE.granary[b.level - 1];
    this.capacity = cap;
  }

  // ---------------------------------------------------------------- progression
  get maxLevelUnlocked(): number {
    let lvl = 1;
    for (const u of UNLOCKS) if (this.s.progress.maxPop >= u.pop) lvl = Math.max(lvl, u.maxLevel);
    return lvl;
  }
  unlockPop(type: BuildingType): number {
    for (const u of UNLOCKS) if (u.buildings.includes(type)) return u.pop;
    return Infinity;
  }
  isUnlocked(type: BuildingType): boolean {
    return this.s.progress.maxPop >= this.unlockPop(type);
  }

  // ---------------------------------------------------------------- capacités des bâtiments
  housingCap(b: Building): number {
    return BUILDINGS[b.type].housing?.[b.level - 1] ?? 0;
  }
  jobCap(b: Building): number {
    return BUILDINGS[b.type].workers?.[b.level - 1] ?? 0;
  }
  radius(b: Building): number {
    return BUILDINGS[b.type].radius?.[b.level - 1] ?? 0;
  }
  residents(houseId: number): Citizen[] {
    return this.s.citizens.filter((c) => c.houseId === houseId);
  }
  occupants(houseId: number): number {
    let n = 0;
    for (const c of this.s.citizens) if (c.houseId === houseId) n++;
    return n;
  }
  houseFree(b: Building): number {
    return this.housingCap(b) - this.occupants(b.id) - b.reserved;
  }

  // ---------------------------------------------------------------- placement
  footprint(type: BuildingType, rot: 0 | 1): [number, number] {
    const d = BUILDINGS[type];
    return rot ? [d.h, d.w] : [d.w, d.h];
  }

  tileBlockReason(x: number, y: number, forRoad = false): string | null {
    if (!this.inBounds(x, y)) return 'Hors de la carte';
    if (!this.owned(x, y)) return 'Territoire non acquis';
    const i = y * this.N + x;
    if (this.s.terrain[i] === T_WATER) return 'Impossible de construire sur l’eau';
    if (this.occ[i] >= 0) return 'Emplacement occupé par un bâtiment';
    if (this.s.roads[i]) return forRoad ? 'Route déjà présente' : 'Emplacement occupé par une route';
    const n = this.nodeAtTile(x, y);
    if (n && n.state !== 'depleted') return n.kind === 'tree' ? 'Un arbre occupe l’emplacement' : 'Un gisement de pierre occupe l’emplacement';
    return null;
  }

  canPlace(type: BuildingType, x: number, y: number, rot: 0 | 1): PlaceCheck {
    const def = BUILDINGS[type];
    const cost = def.cost;
    if (!def.buildable) return { ok: false, reason: 'Ce bâtiment ne peut pas être construit', cost };
    if (!this.isUnlocked(type)) return { ok: false, reason: `Débloqué à ${this.unlockPop(type)} habitants`, cost };
    const [w, h] = this.footprint(type, rot);
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const r = this.tileBlockReason(xx, yy);
        if (r) return { ok: false, reason: r, cost };
      }
    if (!this.canAfford(cost)) return { ok: false, reason: this.missingText(cost), cost };
    return { ok: true, cost };
  }

  place(type: BuildingType, x: number, y: number, rot: 0 | 1): PlaceCheck & { building?: Building } {
    const check = this.canPlace(type, x, y, rot);
    if (!check.ok) return check;
    this.pay(check.cost);
    const [w, h] = this.footprint(type, rot);
    this.clearDepleted(x, y, w, h);
    const b: Building = { id: this.s.nextBuildingId++, type, x, y, w, h, rot, level: 1, workers: [], target: 0, reserved: 0 };
    this.s.buildings.push(b);
    this.bById.set(b.id, b);
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        this.occ[yy * this.N + xx] = b.id;
        this.s.decor[yy * this.N + xx] = 0;
      }
    this.afterTopologyChange();
    if (BUILDINGS[type].needsRoad && !this.connected.has(b.id))
      this.log(`${BUILDINGS[type].name} construit, mais non relié au réseau routier.`, 'warn', x + w / 2, y + h / 2);
    return { ...check, building: b };
  }

  private clearDepleted(x: number, y: number, w: number, h: number) {
    const before = this.s.nodes.length;
    this.s.nodes = this.s.nodes.filter((n) => n.x < x || n.x >= x + w || n.y < y || n.y >= y + h);
    if (this.s.nodes.length !== before) this.rebuildNodeIndex();
  }

  /** Coût total investi dans le bâtiment (construction + améliorations). */
  investedCost(b: Building): Cost {
    const def = BUILDINGS[b.type];
    const total: Cost = { ...def.cost };
    for (let l = 2; l <= b.level; l++) {
      const up = def.upgradeCost?.[l - 2] ?? {};
      for (const k of RES_KEYS) total[k] = (total[k] ?? 0) + (up[k] ?? 0);
    }
    return total;
  }
  refundFor(b: Building): Cost {
    const inv = this.investedCost(b);
    const r: Cost = {};
    for (const k of RES_KEYS) if (inv[k]) r[k] = Math.floor(inv[k]! * DEMOLISH_REFUND);
    return r;
  }

  demolish(id: number): { ok: boolean; reason?: string } {
    const b = this.bById.get(id);
    if (!b) return { ok: false, reason: 'Bâtiment introuvable' };
    if (!BUILDINGS[b.type].demolishable) return { ok: false, reason: 'L’hôtel de ville ne peut pas être démoli' };
    const refund = this.refundFor(b);
    for (const wid of b.workers) {
      const c = this.cById.get(wid);
      if (c) c.jobId = null;
    }
    b.workers = [];
    this.s.buildings = this.s.buildings.filter((o) => o.id !== id);
    this.bById.delete(id);
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) this.occ[yy * this.N + xx] = -1;
    for (const k of RES_KEYS) if (refund[k]) this.gain(k, refund[k]!);
    if (b.type === 'house') this.evictHouse(b);
    this.afterTopologyChange();
    this.log(`${BUILDINGS[b.type].name} démoli(e).`, 'info', b.x + b.w / 2, b.y + b.h / 2);
    return { ok: true };
  }

  /** Reloge les habitants d'une maison démolie, familles d'abord ; sinon ils deviennent sans-abri. */
  private evictHouse(b: Building) {
    const people = this.s.citizens.filter((c) => c.houseId === b.id);
    for (const c of people) c.houseId = null;
    // Grossesses : la réservation disparaît avec la maison.
    for (const c of this.s.citizens) if (c.pregnancy && c.pregnancy.houseId === b.id) c.pregnancy.houseId = null;
    const groups = this.familyGroups(people);
    let homeless = 0;
    for (const grp of groups) {
      const need = grp.length + grp.filter((c) => c.pregnancy).length;
      let target = this.findHouse(need);
      if (target) {
        for (const c of grp) this.moveInto(c, target);
      } else {
        for (const c of grp) {
          target = this.findHouse(1 + (c.pregnancy ? 1 : 0)) ?? this.findHouse(1);
          if (target) this.moveInto(c, target);
          else homeless++;
        }
      }
    }
    if (homeless > 0) this.log(`${homeless} habitant(s) se retrouvent sans abri.`, 'bad', b.x + b.w / 2, b.y + b.h / 2);
    else if (people.length) this.log(`${people.length} habitant(s) relogé(s).`, 'info');
  }

  familyGroups(people: Citizen[]): Citizen[][] {
    const left = new Set(people);
    const groups: Citizen[][] = [];
    for (const c of people) {
      if (!left.has(c)) continue;
      const grp = [c];
      left.delete(c);
      for (const o of people) {
        if (!left.has(o)) continue;
        const linked =
          o.partnerId === c.id ||
          o.motherId === c.id ||
          o.fatherId === c.id ||
          (c.partnerId !== null && (o.motherId === c.partnerId || o.fatherId === c.partnerId));
        if (linked) {
          grp.push(o);
          left.delete(o);
        }
      }
      groups.push(grp);
    }
    return groups;
  }

  findHouse(need: number, near?: [number, number]): Building | null {
    let best: Building | null = null;
    let bestScore = Infinity;
    for (const b of this.s.buildings) {
      if (b.type !== 'house') continue;
      if (this.houseFree(b) < need) continue;
      const [cx, cy] = this.center(b);
      const score = (near ? Math.hypot(cx - near[0], cy - near[1]) : 0) + (this.connected.has(b.id) ? 0 : 1000) + b.id * 1e-3;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  moveInto(c: Citizen, house: Building) {
    if (c.pregnancy && c.pregnancy.houseId !== null) {
      const old = this.bById.get(c.pregnancy.houseId);
      if (old) old.reserved = Math.max(0, old.reserved - 1);
      c.pregnancy.houseId = null;
    }
    c.houseId = house.id;
    if (c.pregnancy && this.houseFree(house) >= 1) {
      house.reserved++;
      c.pregnancy.houseId = house.id;
    }
  }

  upgradeCheck(b: Building): { ok: boolean; reason?: string; cost?: Cost } {
    const def = BUILDINGS[b.type];
    if (!def.upgradeCost) return { ok: false, reason: 'Ce bâtiment ne s’améliore pas' };
    if (b.level >= 3) return { ok: false, reason: 'Niveau maximal atteint' };
    const cost = def.upgradeCost[b.level - 1];
    if (b.level + 1 > this.maxLevelUnlocked) {
      const tier = UNLOCKS.find((u) => u.maxLevel >= b.level + 1);
      return { ok: false, reason: `Niveau ${b.level + 1} débloqué à ${tier?.pop ?? '?'} habitants`, cost };
    }
    if (!this.canAfford(cost)) return { ok: false, reason: this.missingText(cost), cost };
    return { ok: true, cost };
  }

  upgrade(id: number): { ok: boolean; reason?: string } {
    const b = this.bById.get(id);
    if (!b) return { ok: false, reason: 'Bâtiment introuvable' };
    const chk = this.upgradeCheck(b);
    if (!chk.ok) return chk;
    this.pay(chk.cost!);
    b.level++;
    this.computeCapacity();
    this.log(`${BUILDINGS[b.type].name} amélioré(e) au niveau ${b.level}.`, 'good', b.x + b.w / 2, b.y + b.h / 2);
    return { ok: true };
  }

  // ---------------------------------------------------------------- routes
  roadCheck(x: number, y: number): string | null {
    return this.tileBlockReason(x, y, true);
  }

  /** Coût et cases valides d'un tracé de route. */
  roadPlan(tiles: [number, number][]): { valid: [number, number][]; invalid: number; cost: Cost } {
    const seen = new Set<number>();
    const valid: [number, number][] = [];
    let invalid = 0;
    for (const [x, y] of tiles) {
      const i = y * this.N + x;
      if (seen.has(i)) continue;
      seen.add(i);
      if (this.roadCheck(x, y) === null) valid.push([x, y]);
      else if (!(this.inBounds(x, y) && this.s.roads[i])) invalid++;
    }
    const cost: Cost = {};
    for (const k of RES_KEYS) if (ROAD_COST[k]) cost[k] = ROAD_COST[k]! * valid.length;
    return { valid, invalid, cost };
  }

  buildRoads(tiles: [number, number][]): { ok: boolean; built: number; reason?: string } {
    const plan = this.roadPlan(tiles);
    if (plan.valid.length === 0) return { ok: false, built: 0, reason: 'Aucune case constructible sur ce tracé' };
    if (!this.canAfford(plan.cost)) return { ok: false, built: 0, reason: this.missingText(plan.cost) };
    this.pay(plan.cost);
    let removedNode = false;
    for (const [x, y] of plan.valid) {
      const i = y * this.N + x;
      this.s.roads[i] = 1;
      this.s.decor[i] = 0;
      if (this.nodeAt[i] >= 0) removedNode = true;
    }
    if (removedNode) {
      const set = new Set(plan.valid.map(([x, y]) => y * this.N + x));
      this.s.nodes = this.s.nodes.filter((n) => !set.has(n.y * this.N + n.x));
      this.rebuildNodeIndex();
    }
    this.afterTopologyChange();
    return { ok: true, built: plan.valid.length };
  }

  removeRoads(tiles: [number, number][]): number {
    let n = 0;
    for (const [x, y] of tiles) {
      if (!this.inBounds(x, y)) continue;
      const i = y * this.N + x;
      if (this.s.roads[i] && this.owned(x, y)) {
        this.s.roads[i] = 0;
        n++;
      }
    }
    if (n) this.afterTopologyChange();
    return n;
  }

  /** Recalcule réseau, marche et signale les bâtiments nouvellement déconnectés. */
  afterTopologyChange() {
    const before = new Set(this.connected);
    this.dirtyNetwork = true;
    this.dirtyWalk = true;
    this.groundVersion++;
    this.refreshNetwork();
    this.refreshWalk();
    this.computeCapacity();
    const lost = this.s.buildings.filter((b) => before.has(b.id) && !this.connected.has(b.id));
    if (lost.length) {
      const b = lost[0];
      this.log(
        lost.length === 1
          ? `${BUILDINGS[b.type].name} n’est plus relié(e) à l’hôtel de ville.`
          : `${lost.length} bâtiments ne sont plus reliés à l’hôtel de ville.`,
        'bad',
        b.x + b.w / 2,
        b.y + b.h / 2,
      );
    }
    const gained = this.s.buildings.filter((b) => !before.has(b.id) && this.connected.has(b.id) && b.type !== 'townhall');
    if (gained.length && before.size > 0) {
      const b = gained[0];
      this.log(
        gained.length === 1 ? `${BUILDINGS[b.type].name} est maintenant relié(e).` : `${gained.length} bâtiments sont maintenant reliés.`,
        'good',
        b.x + b.w / 2,
        b.y + b.h / 2,
      );
    }
    this.agents.invalidatePaths();
  }

  /** Cases périphériques (4-voisinage) d'un bâtiment. */
  perimeter(b: { x: number; y: number; w: number; h: number }): [number, number][] {
    const out: [number, number][] = [];
    for (let x = b.x; x < b.x + b.w; x++) {
      out.push([x, b.y - 1], [x, b.y + b.h]);
    }
    for (let y = b.y; y < b.y + b.h; y++) {
      out.push([b.x - 1, y], [b.x + b.w, y]);
    }
    return out.filter(([x, y]) => this.inBounds(x, y));
  }

  refreshNetwork() {
    if (!this.dirtyNetwork) return;
    this.dirtyNetwork = false;
    const N = this.N;
    const rc = new Uint8Array(N * N);
    const th = this.s.buildings.find((b) => b.type === 'townhall');
    this.connected.clear();
    if (th) {
      this.connected.add(th.id);
      const queue: number[] = [];
      for (const [x, y] of this.perimeter(th)) {
        const i = y * N + x;
        if (this.s.roads[i] && !rc[i]) {
          rc[i] = 1;
          queue.push(i);
        }
      }
      while (queue.length) {
        const i = queue.pop()!;
        const x = i % N;
        const y = (i / N) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1];
        for (const j of nb) {
          if (j >= 0 && this.s.roads[j] && !rc[j]) {
            rc[j] = 1;
            queue.push(j);
          }
        }
      }
      for (const b of this.s.buildings) {
        if (b === th) continue;
        if (this.perimeter(b).some(([x, y]) => rc[y * N + x])) this.connected.add(b.id);
      }
    }
    this.roadConnected = rc;
  }

  isWalkable(i: number): boolean {
    if (this.s.terrain[i] === T_WATER || this.occ[i] >= 0) return false;
    const ni = this.nodeAt[i];
    if (ni >= 0 && this.s.nodes[ni].state === 'ok') return false;
    return true;
  }

  refreshWalk() {
    if (!this.dirtyWalk) return;
    this.dirtyWalk = false;
    const N = this.N;
    const cost = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      if (!this.isWalkable(i)) continue;
      cost[i] = this.s.roads[i] ? 1 : 2.2;
    }
    this.walkCost = cost;
    const region = new Int32Array(N * N).fill(-1);
    let r = 0;
    const stack: number[] = [];
    for (let i = 0; i < N * N; i++) {
      if (cost[i] === 0 || region[i] >= 0) continue;
      region[i] = r;
      stack.push(i);
      while (stack.length) {
        const k = stack.pop()!;
        const x = k % N;
        const y = (k / N) | 0;
        if (x > 0 && cost[k - 1] && region[k - 1] < 0) (region[k - 1] = r), stack.push(k - 1);
        if (x < N - 1 && cost[k + 1] && region[k + 1] < 0) (region[k + 1] = r), stack.push(k + 1);
        if (y > 0 && cost[k - N] && region[k - N] < 0) (region[k - N] = r), stack.push(k - N);
        if (y < N - 1 && cost[k + N] && region[k + N] < 0) (region[k + N] = r), stack.push(k + N);
      }
      r++;
    }
    this.region = region;
  }

  /** Régions de marche accessibles depuis le pourtour d'un bâtiment. */
  buildingRegions(b: Building): Set<number> {
    const set = new Set<number>();
    for (const [x, y] of this.perimeter(b)) {
      const r = this.region[y * this.N + x];
      if (r >= 0) set.add(r);
    }
    return set;
  }

  /** Un nœud est accessible s'il est dans le territoire et touche une case praticable reliée au bâtiment. */
  nodeAccessible(n: ResourceNode, regions: Set<number>): boolean {
    if (!this.owned(n.x, n.y)) return false;
    const N = this.N;
    const nb: [number, number][] = [
      [n.x - 1, n.y],
      [n.x + 1, n.y],
      [n.x, n.y - 1],
      [n.x, n.y + 1],
    ];
    for (const [x, y] of nb) {
      if (!this.inBounds(x, y)) continue;
      const r = this.region[y * N + x];
      if (r >= 0 && regions.has(r)) return true;
    }
    return false;
  }

  /** Case d'accès d'un bâtiment (route adjacente de préférence). */
  door(b: Building): number | null {
    const N = this.N;
    let best: number | null = null;
    let bestScore = Infinity;
    const cx = b.x + b.w / 2;
    const by = b.y + b.h;
    for (const [x, y] of this.perimeter(b)) {
      const i = y * N + x;
      if (!this.walkCost[i]) continue;
      const score = Math.abs(x + 0.5 - cx) + Math.abs(y + 0.5 - by) * 0.8 + (this.s.roads[i] ? 0 : 3);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- parcelles
  parcelCost(): Cost {
    const n = this.s.parcelsBought;
    const m = 1 + PARCELS.linear * n + PARCELS.quadratic * n * n;
    const c: Cost = {};
    for (const k of RES_KEYS) if (PARCELS.baseCost[k]) c[k] = Math.round(PARCELS.baseCost[k]! * m);
    return c;
  }
  parcelCheck(px: number, py: number): { ok: boolean; reason?: string; cost: Cost } {
    const P = this.N / MAP.PARCEL;
    const cost = this.parcelCost();
    if (px < 0 || py < 0 || px >= P || py >= P) return { ok: false, reason: 'Hors de la carte', cost };
    if (this.s.parcels[py * P + px]) return { ok: false, reason: 'Parcelle déjà acquise', cost };
    const adj = [
      [px - 1, py],
      [px + 1, py],
      [px, py - 1],
      [px, py + 1],
    ].some(([x, y]) => x >= 0 && y >= 0 && x < P && y < P && this.s.parcels[y * P + x]);
    if (!adj) return { ok: false, reason: 'La parcelle doit toucher le territoire possédé', cost };
    for (const k of RES_KEYS)
      if ((cost[k] ?? 0) > this.capacity[k])
        return { ok: false, reason: `Capacité de stockage insuffisante (${RES_LABEL[k].toLowerCase()}) : construisez un grenier`, cost };
    if (!this.canAfford(cost)) return { ok: false, reason: this.missingText(cost), cost };
    return { ok: true, cost };
  }
  buyParcel(px: number, py: number): { ok: boolean; reason?: string } {
    const chk = this.parcelCheck(px, py);
    if (!chk.ok) return chk;
    this.pay(chk.cost);
    this.s.parcels[py * (this.N / MAP.PARCEL) + px] = true;
    this.s.parcelsBought++;
    this.groundVersion++;
    this.log('Nouvelle parcelle acquise : le territoire s’agrandit.', 'good', px * MAP.PARCEL + 8, py * MAP.PARCEL + 8);
    return { ok: true };
  }

  // ---------------------------------------------------------------- emplois
  isAdultWorker(c: Citizen) {
    return c.age >= AGES.ADULT && c.age < AGES.RETIRE;
  }
  availableAdults(): Citizen[] {
    return this.s.citizens
      .filter((c) => this.isAdultWorker(c) && c.jobId === null)
      .sort((a, b) => b.education - a.education || a.id - b.id);
  }
  addWorker(id: number): { ok: boolean; reason?: string } {
    const b = this.bById.get(id);
    if (!b) return { ok: false, reason: 'Bâtiment introuvable' };
    const cap = this.jobCap(b);
    if (cap === 0) return { ok: false, reason: 'Ce bâtiment n’emploie personne' };
    if (b.workers.length >= cap) return { ok: false, reason: 'Tous les postes sont pourvus' };
    const avail = this.availableAdults();
    if (!avail.length) return { ok: false, reason: 'Aucun adulte disponible' };
    const c = avail[0];
    c.jobId = b.id;
    b.workers.push(c.id);
    b.target = Math.max(b.target, b.workers.length);
    return { ok: true };
  }
  removeWorker(id: number): { ok: boolean; reason?: string } {
    const b = this.bById.get(id);
    if (!b) return { ok: false, reason: 'Bâtiment introuvable' };
    if (b.workers.length === 0) {
      if (b.target > 0) {
        b.target--;
        return { ok: true };
      }
      return { ok: false, reason: 'Aucun travailleur à retirer' };
    }
    const wid = b.workers.pop()!;
    const c = this.cById.get(wid);
    if (c) c.jobId = null;
    b.target = b.workers.length;
    return { ok: true };
  }
  releaseJob(c: Citizen) {
    if (c.jobId === null) return;
    const b = this.bById.get(c.jobId);
    if (b) b.workers = b.workers.filter((w) => w !== c.id);
    c.jobId = null;
  }

  isProducer(b: Building) {
    return PRODUCERS.includes(b.type);
  }
}
