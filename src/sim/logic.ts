import {
  AGES,
  CONSUMPTION,
  DEMOGRAPHY,
  EDUCATION,
  EVENTS,
  HAPPINESS,
  HEALTH,
  NODES,
  RES_KEYS,
  SEASONS,
  UNLOCKS,
  VICTORY,
  type ResKey,
} from '../config/balance';
import { BUILDINGS, FARM_WATER_PER_FOOD, WELL_NEAR_WATER_BONUS } from '../config/buildings';
import { T_WATER, type Building, type Citizen, type EventKind } from './types';
import type { Game } from './world';

const SECOND = 1 / 60; // une seconde de jeu exprimée en années (YEAR_SECONDS = 60)

export function logicStep(g: Game, dtY: number) {
  g.refreshNetwork();
  g.refreshWalk();
  updateEvents(g, dtY);
  updateServices(g);
  fillJobs(g);
  production(g, dtY);
  consumption(g, dtY);
  population(g, dtY);
  regenerateNodes(g, dtY);
  bookkeeping(g, dtY);
  progression(g, dtY);
}

/** Met à jour services, états et progression sans faire avancer le temps (actions en pause, chargement). */
export function refreshInstant(g: Game) {
  g.refreshNetwork();
  g.refreshWalk();
  updateServices(g);
  production(g, 0);
  progression(g, 0);
}

// ============================================================ utilitaires
export function hasEvent(g: Game, k: EventKind) {
  return g.s.events.some((e) => e.kind === k);
}
export function season(g: Game) {
  return SEASONS[g.seasonIndex];
}
function dist(g: Game, a: Building, b: Building) {
  const [ax, ay] = g.center(a);
  const [bx, by] = g.center(b);
  return Math.hypot(ax - bx, ay - by);
}
export function childClass(c: Citizen): 'baby' | 'child' | 'adult' | 'elder' {
  if (c.age < AGES.CHILD) return 'baby';
  if (c.age < AGES.ADULT) return 'child';
  if (c.age < AGES.RETIRE) return 'adult';
  return 'elder';
}

// ============================================================ services
export function updateServices(g: Game) {
  const houses = g.s.buildings.filter((b) => b.type === 'house');
  const occ = new Map<number, number>();
  for (const c of g.s.citizens) if (c.houseId !== null) occ.set(c.houseId, (occ.get(c.houseId) ?? 0) + 1);

  // Autels : chaque maison reliée est desservie par au plus un autel (le plus proche ayant de la place).
  g.altarOf.clear();
  g.altarLoad.clear();
  const altars = g.s.buildings.filter((b) => b.type === 'altar' && g.connected.has(b.id));
  for (const a of altars) g.altarLoad.set(a.id, { served: 0, demand: 0 });
  const connectedHouses = houses.filter((h) => g.connected.has(h.id));
  // Demande : habitants dans le rayon.
  for (const h of connectedHouses) {
    const options = altars
      .filter((a) => dist(g, a, h) <= g.radius(a))
      .sort((a, b) => dist(g, a, h) - dist(g, b, h) || a.id - b.id);
    const n = occ.get(h.id) ?? 0;
    for (const a of options) g.altarLoad.get(a.id)!.demand += n;
    for (const a of options) {
      const load = g.altarLoad.get(a.id)!;
      const cap = BUILDINGS.altar.users![a.level - 1];
      if (load.served + n <= cap) {
        load.served += n;
        g.altarOf.set(h.id, a.id);
        break;
      }
    }
  }

  // Dispensaires : capacité = soignants × 12 habitants.
  g.clinicOf.clear();
  g.clinicLoad.clear();
  const clinics = g.s.buildings.filter((b) => b.type === 'clinic' && g.connected.has(b.id));
  for (const cl of clinics)
    g.clinicLoad.set(cl.id, { served: 0, demand: 0, capacity: cl.workers.length * BUILDINGS.clinic.users![cl.level - 1] });
  for (const h of connectedHouses) {
    const n = occ.get(h.id) ?? 0;
    const options = clinics.filter((c) => dist(g, c, h) <= g.radius(c)).sort((a, b) => dist(g, a, h) - dist(g, b, h) || a.id - b.id);
    for (const c of options) g.clinicLoad.get(c.id)!.demand += n;
    for (const c of options) {
      const load = g.clinicLoad.get(c.id)!;
      if (load.served + n <= load.capacity) {
        load.served += n;
        g.clinicOf.set(h.id, c.id);
        break;
      }
    }
  }

  // Jardins : bonus plafonné.
  g.gardenBonus.clear();
  const gardens = g.s.buildings.filter((b) => b.type === 'garden');
  for (const h of houses) {
    let total = 0;
    for (const gd of gardens) if (dist(g, gd, h) <= g.radius(gd)) total += BUILDINGS.garden.bonus![gd.level - 1];
    if (total > 0) g.gardenBonus.set(h.id, Math.min(HAPPINESS.gardenCap, total));
  }

  // Écoles : enfants 6-17 vivant dans une maison reliée.
  g.schoolOf.clear();
  g.schoolLoad.clear();
  const schools = g.s.buildings.filter((b) => b.type === 'school' && g.connected.has(b.id));
  for (const s of schools)
    g.schoolLoad.set(s.id, {
      students: 0,
      capacity: Math.min(BUILDINGS.school.users![s.level - 1], s.workers.length * EDUCATION.studentsPerTeacher),
    });
  const kids = g.s.citizens
    .filter((c) => c.age >= AGES.CHILD && c.age < AGES.ADULT && c.houseId !== null && g.connected.has(c.houseId))
    .sort((a, b) => a.id - b.id);
  for (const k of kids) {
    const h = g.bById.get(k.houseId!)!;
    const opts = [...schools].sort((a, b) => dist(g, a, h) - dist(g, b, h) || a.id - b.id);
    for (const s of opts) {
      const load = g.schoolLoad.get(s.id)!;
      if (load.students < load.capacity) {
        load.students++;
        g.schoolOf.set(k.id, s.id);
        break;
      }
    }
  }
}

// ============================================================ emplois
export function fillJobs(g: Game) {
  let avail: Citizen[] | null = null;
  for (const b of g.s.buildings) {
    const cap = g.jobCap(b);
    if (b.target > cap) b.target = cap;
    while (b.workers.length > cap) {
      const c = g.cById.get(b.workers.pop()!);
      if (c) c.jobId = null;
    }
    if (b.workers.length < b.target) {
      avail = avail ?? g.availableAdults();
      while (b.workers.length < b.target && avail.length) {
        const c = avail.shift()!;
        c.jobId = b.id;
        b.workers.push(c.id);
      }
    }
  }
}

// ============================================================ production
function workforce(g: Game, b: Building): number {
  let eff = 0;
  for (const id of b.workers) {
    const c = g.cById.get(id);
    if (!c) continue;
    const healthFactor = c.health < 30 ? 0.5 : 1;
    eff += (1 + EDUCATION.productivityBonus * c.education) * healthFactor;
  }
  return eff;
}

export function wellNearWater(g: Game, b: Building): boolean {
  const r = BUILDINGS.well.radius![0];
  for (let y = b.y - r; y < b.y + b.h + r; y++)
    for (let x = b.x - r; x < b.x + b.w + r; x++)
      if (g.inBounds(x, y) && g.s.terrain[y * g.N + x] === T_WATER) return true;
  return false;
}

/** Nœuds exploitables et accessibles dans le rayon, du plus proche au plus lointain. */
export function harvestableNodes(g: Game, b: Building): number[] {
  const kind = b.type === 'woodcutter' ? 'tree' : 'rock';
  const r = g.radius(b);
  const [cx, cy] = g.center(b);
  const regions = g.buildingRegions(b);
  const out: [number, number][] = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const n = g.nodeAtTile(x, y);
      if (!n || n.kind !== kind || n.state !== 'ok' || n.stock <= 0) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      if (!g.nodeAccessible(n, regions)) continue;
      out.push([n.id, d]);
    }
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return out.map((o) => o[0]);
}

function setStatus(g: Game, b: Building, status: 'active' | 'disconnected' | 'nostaff' | 'noresource' | 'full', msg: string) {
  g.status.set(b.id, { status, msg });
}

function production(g: Game, dtY: number) {
  const s = season(g);
  const harvest = hasEvent(g, 'harvest');
  const drought = hasEvent(g, 'drought');
  g.harvestTarget.clear();
  for (const b of g.s.buildings) {
    const def = BUILDINGS[b.type];
    if (def.needsRoad && !g.connected.has(b.id)) {
      setStatus(g, b, 'disconnected', 'Non relié à l’hôtel de ville par la route');
      continue;
    }
    if (b.type === 'house') {
      const free = g.houseFree(b);
      if (free <= 0) setStatus(g, b, 'full', 'Maison pleine : aucune place pour une naissance');
      else setStatus(g, b, 'active', `${free} place(s) libre(s)`);
      continue;
    }
    if (b.type === 'altar') {
      const load = g.altarLoad.get(b.id);
      if (load && load.demand > load.served) setStatus(g, b, 'full', `Capacité saturée : ${load.demand - load.served} fidèle(s) non desservi(s)`);
      else setStatus(g, b, 'active', 'Actif');
      continue;
    }
    if (b.type === 'school' || b.type === 'clinic') {
      if (b.workers.length === 0) setStatus(g, b, 'nostaff', 'Aucun personnel affecté');
      else if (b.type === 'school') {
        const l = g.schoolLoad.get(b.id);
        const waiting = g.s.citizens.filter((c) => c.age >= AGES.CHILD && c.age < AGES.ADULT && !g.schoolOf.has(c.id)).length;
        if (l && l.students >= l.capacity && waiting > 0) setStatus(g, b, 'full', `Capacité saturée : ${waiting} enfant(s) non scolarisé(s)`);
        else setStatus(g, b, 'active', 'Actif');
      } else {
        const l = g.clinicLoad.get(b.id);
        if (l && l.demand > l.served) setStatus(g, b, 'full', 'Capacité saturée : ajoutez des soignants');
        else setStatus(g, b, 'active', 'Actif');
      }
      continue;
    }
    if (!g.isProducer(b)) {
      setStatus(g, b, 'active', 'Actif');
      continue;
    }
    if (b.workers.length === 0) {
      setStatus(g, b, 'nostaff', 'Aucun travailleur : production arrêtée');
      g.buildingRateAcc.set(b.id, (g.buildingRateAcc.get(b.id) ?? 0) + 0);
      continue;
    }
    const lvl = def.levelMult![b.level - 1];
    let amount = def.rate! * workforce(g, b) * lvl * dtY;
    let res: ResKey;
    switch (b.type) {
      case 'gatherer':
        res = 'food';
        amount *= s.gatherMult * (harvest ? EVENTS.harvest.foodMult : 1);
        break;
      case 'farm':
        res = 'food';
        amount *= s.farmMult * (harvest ? EVENTS.harvest.foodMult : 1);
        break;
      case 'well':
        res = 'water';
        if (wellNearWater(g, b)) amount *= 1 + WELL_NEAR_WATER_BONUS;
        if (drought) amount *= EVENTS.drought.wellMult;
        break;
      case 'woodcutter':
        res = 'wood';
        break;
      default:
        res = 'stone';
    }
    const room = g.capacity[res] - g.s.stock[res];
    if (room <= 1e-6) {
      setStatus(g, b, 'full', `Stock de ${res === 'food' ? 'nourriture' : res === 'water' ? 'eau' : res === 'wood' ? 'bois' : 'pierre'} plein : construisez un grenier`);
      continue;
    }
    amount = Math.min(amount, room);
    let status: { st: 'active' | 'noresource'; msg: string } = { st: 'active', msg: 'Actif' };
    if (b.type === 'farm') {
      const needWater = amount * FARM_WATER_PER_FOOD;
      if (g.s.stock.water < needWater) {
        amount = g.s.stock.water / FARM_WATER_PER_FOOD;
        status = { st: 'noresource', msg: 'Manque d’eau pour irriguer les cultures' };
      }
      const used = amount * FARM_WATER_PER_FOOD;
      g.s.stock.water = Math.max(0, g.s.stock.water - used);
      g.curCons.water += used;
    }
    if (b.type === 'woodcutter' || b.type === 'stonecutter') {
      const nodes = harvestableNodes(g, b);
      let need = amount;
      let got = 0;
      for (const id of nodes) {
        if (need <= 1e-9) break;
        const n = g.s.nodes[id];
        const take = Math.min(need, n.stock);
        n.stock -= take;
        need -= take;
        got += take;
        if (!g.harvestTarget.has(b.id)) g.harvestTarget.set(b.id, id);
        if (n.stock <= 1e-6) {
          n.stock = 0;
          n.state = 'depleted';
          n.timer = n.kind === 'tree' ? NODES.treeRegrowDelay : NODES.rockRegrowDelay;
          g.dirtyWalk = true;
          g.nodesVersion++;
        }
      }
      amount = got;
      if (nodes.length === 0) status = { st: 'noresource', msg: b.type === 'woodcutter' ? 'Aucun arbre accessible dans le rayon' : 'Aucun gisement accessible dans le rayon' };
    }
    if (amount > 0) {
      g.s.stock[res] = Math.min(g.capacity[res], g.s.stock[res] + amount);
      g.curProd[res] += amount;
      g.buildingRateAcc.set(b.id, (g.buildingRateAcc.get(b.id) ?? 0) + amount);
    }
    setStatus(g, b, status.st, status.msg);
  }
}

// ============================================================ consommation
export function demand(g: Game): { food: number; water: number; wood: number } {
  const s = season(g);
  let food = 0;
  let water = 0;
  for (const c of g.s.citizens) {
    const cl = childClass(c);
    if (cl === 'adult') {
      food += CONSUMPTION.foodAdult;
      water += CONSUMPTION.waterAdult;
    } else if (cl === 'elder') {
      food += CONSUMPTION.foodElder;
      water += CONSUMPTION.waterElder;
    } else {
      food += CONSUMPTION.foodChild;
      water += CONSUMPTION.waterChild;
    }
  }
  water *= s.waterUseMult * (hasEvent(g, 'drought') ? EVENTS.drought.waterUseMult : 1);
  let wood = 0;
  if (s.heating) {
    const inhabited = new Set(g.s.citizens.map((c) => c.houseId).filter((h) => h !== null));
    wood = inhabited.size * CONSUMPTION.heatingWoodPerHouse;
  }
  return { food, water, wood };
}

function consumption(g: Game, dtY: number) {
  const d = demand(g);
  const take = (k: 'food' | 'water' | 'wood', need: number) => {
    if (need <= 0) return 1;
    const got = Math.min(need, g.s.stock[k]);
    g.s.stock[k] = Math.max(0, g.s.stock[k] - got);
    g.curCons[k] += got;
    return got / need;
  };
  g.fed.food = take('food', d.food * dtY);
  g.fed.water = take('water', d.water * dtY);
  g.fed.heat = take('wood', d.wood * dtY);
  const upd = (k: 'food' | 'water' | 'wood', ratio: number) => {
    if (ratio < 0.999) g.s.shortage[k] += dtY;
    else g.s.shortage[k] = 0;
  };
  const wasFood = g.s.shortage.food > 0;
  const wasWater = g.s.shortage.water > 0;
  upd('food', g.fed.food);
  upd('water', g.fed.water);
  upd('wood', g.fed.heat);
  if (!wasFood && g.s.shortage.food > 0) g.log('Pénurie de nourriture ! La santé et le bonheur vont chuter.', 'bad');
  if (!wasWater && g.s.shortage.water > 0) g.log('Pénurie d’eau ! La santé et le bonheur vont chuter.', 'bad');
}

// ============================================================ bonheur
export interface HappyPart {
  label: string;
  value: number;
}

export function happinessParts(g: Game, c: Citizen): { parts: HappyPart[]; target: number } {
  const parts: HappyPart[] = [{ label: 'Base', value: HAPPINESS.base }];
  parts.push(g.s.shortage.food > 0 ? { label: 'Faim (pénurie de nourriture)', value: HAPPINESS.hungry } : { label: 'Bien nourri', value: HAPPINESS.fed });
  parts.push(g.s.shortage.water > 0 ? { label: 'Soif (pénurie d’eau)', value: HAPPINESS.thirsty } : { label: 'Accès à l’eau', value: HAPPINESS.watered });
  const house = c.houseId !== null ? g.bById.get(c.houseId) : undefined;
  if (!house) parts.push({ label: 'Sans abri', value: HAPPINESS.homeless });
  else {
    parts.push({ label: `Logement niveau ${house.level}`, value: HAPPINESS.house[house.level - 1] });
    const connected = g.connected.has(house.id);
    if (!connected) parts.push({ label: 'Maison non reliée (pas de services)', value: HAPPINESS.disconnectedHouse });
    const occ = g.occupants(house.id);
    if (occ / g.housingCap(house) > HAPPINESS.crowdedRatio) parts.push({ label: 'Logement surpeuplé', value: HAPPINESS.crowded });
    const altar = g.altarOf.get(house.id);
    if (altar !== undefined) {
      const a = g.bById.get(altar)!;
      parts.push({ label: `Autel niveau ${a.level}`, value: BUILDINGS.altar.bonus![a.level - 1] });
    } else parts.push({ label: 'Pas d’accès à un autel', value: HAPPINESS.religionMissing });
    const gb = g.gardenBonus.get(house.id);
    if (gb) parts.push({ label: 'Jardins à proximité', value: gb });
  }
  if (c.health >= HAPPINESS.healthGoodThreshold) parts.push({ label: 'Bonne santé', value: HAPPINESS.healthGood });
  else if (c.health < HAPPINESS.healthBadThreshold) parts.push({ label: 'Mauvaise santé', value: HAPPINESS.healthBad });
  if (season(g).heating && g.s.shortage.wood > 0) parts.push({ label: 'Froid (manque de bois)', value: HAPPINESS.cold });
  const sum = parts.reduce((a, p) => a + p.value, 0);
  return { parts, target: Math.max(0, Math.min(100, sum)) };
}

export function averageHappiness(g: Game): number {
  if (!g.s.citizens.length) return 0;
  return g.s.citizens.reduce((a, c) => a + c.happiness, 0) / g.s.citizens.length;
}

// ============================================================ santé
export function healthTarget(g: Game, c: Citizen): number {
  const house = c.houseId !== null ? g.bById.get(c.houseId) : undefined;
  let t = HEALTH.target;
  if (!house) t = HEALTH.targetHomeless;
  else if (g.clinicOf.has(house.id)) t = HEALTH.targetClinic;
  if (c.age > AGES.RETIRE) t -= (c.age - AGES.RETIRE) * HEALTH.oldAgeTargetLoss;
  return Math.max(10, t);
}

// ============================================================ population
function population(g: Game, dtY: number) {
  const dead: [Citizen, string][] = [];
  const illness = hasEvent(g, 'illness');
  const hungry = 1 - g.fed.food;
  const thirsty = 1 - g.fed.water;
  const cold = season(g).heating ? 1 - g.fed.heat : 0;

  for (const c of [...g.s.citizens]) {
    const prevAge = c.age;
    c.age += dtY;
    c.sinceBirth += dtY;
    // Passages d'âge
    if (prevAge < AGES.ADULT && c.age >= AGES.ADULT) {
      g.log(`${c.first} ${c.last} devient adulte et peut travailler.`, 'good');
    }
    if (prevAge < AGES.RETIRE && c.age >= AGES.RETIRE) {
      if (c.jobId !== null) g.releaseJob(c);
      g.log(`${c.first} ${c.last} prend sa retraite.`, 'info');
    }
    // Éducation
    const school = g.schoolOf.get(c.id);
    if (school !== undefined) {
      const s = g.bById.get(school)!;
      c.education = Math.min(1, c.education + (dtY / EDUCATION.yearsForFull) * BUILDINGS.school.levelMult![s.level - 1]);
    }
    // Santé
    const house = c.houseId !== null ? g.bById.get(c.houseId) : undefined;
    const covered = house ? g.clinicOf.has(house.id) : false;
    const target = healthTarget(g, c);
    let dh = 0;
    const deprived = hungry > 0.001 || thirsty > 0.001;
    if (!deprived) {
      const rate = covered ? HEALTH.driftClinic : HEALTH.drift;
      const diff = target - c.health;
      dh += Math.sign(diff) * Math.min(Math.abs(diff), rate * dtY);
    }
    dh -= HEALTH.starvation * hungry * dtY;
    dh -= HEALTH.thirst * thirsty * dtY;
    dh -= HEALTH.cold * cold * dtY;
    if (illness) dh -= (covered ? HEALTH.illnessClinic : HEALTH.illness) * dtY;
    c.health = Math.max(0, Math.min(100, c.health + dh));
    // Bonheur
    const { target: ht } = happinessParts(g, c);
    const hd = ht - c.happiness;
    c.happiness += Math.sign(hd) * Math.min(Math.abs(hd), HAPPINESS.drift * dtY);
    // Décès
    let hazard = 0;
    if (c.age >= AGES.RETIRE) hazard += DEMOGRAPHY.oldAgeBase * Math.pow(DEMOGRAPHY.oldAgeGrowth, c.age - AGES.RETIRE);
    if (c.health < DEMOGRAPHY.criticalHealth) hazard += DEMOGRAPHY.criticalHazard;
    if (c.health <= 0 || (hazard > 0 && g.rng.next() < 1 - Math.exp(-hazard * dtY))) {
      const cause = c.health <= 0 || c.health < DEMOGRAPHY.criticalHealth ? (hungry > 0 ? 'de faim' : thirsty > 0 ? 'de soif' : 'de maladie') : 'de vieillesse';
      dead.push([c, cause]);
    }
  }
  for (const [c, cause] of dead) killCitizen(g, c, cause);

  pregnancies(g, dtY);
  couples(g, dtY);
  rehouse(g);
  relocate(g, dtY);
}

export function killCitizen(g: Game, c: Citizen, cause: string) {
  g.releaseJob(c);
  if (c.partnerId !== null) {
    const p = g.cById.get(c.partnerId);
    if (p) p.partnerId = null;
  }
  if (c.pregnancy && c.pregnancy.houseId !== null) {
    const h = g.bById.get(c.pregnancy.houseId);
    if (h) h.reserved = Math.max(0, h.reserved - 1);
  }
  const house = c.houseId !== null ? g.bById.get(c.houseId) : undefined;
  g.s.citizens = g.s.citizens.filter((o) => o !== c);
  g.cById.delete(c.id);
  g.s.progress.deaths++;
  g.agents.remove(c.id);
  g.log(`${c.first} ${c.last} est mort(e) ${cause} à ${Math.floor(c.age)} ans.`, 'bad', house ? house.x + house.w / 2 : undefined, house ? house.y + house.h / 2 : undefined);
}

export function related(a: Citizen, b: Citizen): boolean {
  if (a.fatherId === b.id || a.motherId === b.id || b.fatherId === a.id || b.motherId === a.id) return true;
  if (a.fatherId !== null && a.fatherId === b.fatherId) return true;
  if (a.motherId !== null && a.motherId === b.motherId) return true;
  return false;
}

export function birthBlockers(g: Game, mother: Citizen): string[] {
  const out: string[] = [];
  const father = mother.partnerId !== null ? g.cById.get(mother.partnerId) : undefined;
  if (!father) out.push('pas de conjoint');
  if (mother.age < AGES.FERTILE_MIN || mother.age > AGES.FERTILE_MAX) out.push(`âge fertile ${AGES.FERTILE_MIN}–${AGES.FERTILE_MAX} ans`);
  if (mother.pregnancy) out.push('grossesse en cours');
  if (mother.sinceBirth < DEMOGRAPHY.birthCooldown) out.push('naissance récente');
  if (mother.health < DEMOGRAPHY.minHealth || (father && father.health < DEMOGRAPHY.minHealth)) out.push('santé insuffisante');
  const hap = father ? (mother.happiness + father.happiness) / 2 : mother.happiness;
  if (hap < DEMOGRAPHY.minHappiness) out.push(`bonheur du couple < ${DEMOGRAPHY.minHappiness}`);
  if (g.s.stock.food < DEMOGRAPHY.minFoodStock || g.s.shortage.food > 0) out.push('réserves de nourriture insuffisantes');
  if (g.s.stock.water < DEMOGRAPHY.minWaterStock || g.s.shortage.water > 0) out.push('réserves d’eau insuffisantes');
  const house = mother.houseId !== null ? g.bById.get(mother.houseId) : undefined;
  if (!house) out.push('sans logement');
  else if (g.houseFree(house) < 1) out.push('aucune place libre dans la maison');
  return out;
}

function pregnancies(g: Game, dtY: number) {
  const pConceive = 1 - Math.exp(-DEMOGRAPHY.conceptionRate * dtY);
  for (const m of [...g.s.citizens]) {
    if (m.sex !== 'F') continue;
    if (m.pregnancy) {
      m.pregnancy.remaining -= dtY;
      if (m.pregnancy.remaining <= 0) giveBirth(g, m);
      continue;
    }
    if (m.partnerId === null) continue;
    if (birthBlockers(g, m).length) continue;
    if (g.rng.next() < pConceive) {
      const house = g.bById.get(m.houseId!)!;
      house.reserved++;
      m.pregnancy = { remaining: DEMOGRAPHY.pregnancyYears, fatherId: m.partnerId, houseId: house.id };
      g.log(`${m.first} ${m.last} attend un enfant (place réservée).`, 'good', house.x + house.w / 2, house.y + house.h / 2);
    }
  }
}

function giveBirth(g: Game, m: Citizen) {
  const p = m.pregnancy!;
  m.pregnancy = null;
  m.sinceBirth = 0;
  let houseId: number | null = null;
  if (p.houseId !== null) {
    const h = g.bById.get(p.houseId);
    if (h) {
      h.reserved = Math.max(0, h.reserved - 1);
      houseId = h.id;
    }
  }
  if (houseId === null && m.houseId !== null) {
    const h = g.bById.get(m.houseId);
    if (h && g.houseFree(h) >= 1) houseId = h.id;
  }
  const father = g.cById.get(p.fatherId);
  const sex = g.rng.chance(0.5) ? 'M' : 'F';
  const child = g.addCitizen(sex, 0, houseId, p.fatherId, m.id, father?.last ?? m.last);
  child.health = 85;
  child.happiness = m.happiness;
  g.s.progress.births++;
  const h = houseId !== null ? g.bById.get(houseId) : undefined;
  g.log(
    `Naissance de ${child.first} ${child.last}${houseId === null ? ' (sans logement !)' : ''}.`,
    houseId === null ? 'warn' : 'good',
    h ? h.x + h.w / 2 : undefined,
    h ? h.y + h.h / 2 : undefined,
  );
}

function couples(g: Game, dtY: number) {
  const p = 1 - Math.exp(-DEMOGRAPHY.coupleRate * dtY);
  const eligible = (c: Citizen) => c.partnerId === null && c.age >= AGES.ADULT && c.age <= AGES.COUPLE_MAX;
  const women = g.s.citizens.filter((c) => c.sex === 'F' && eligible(c));
  for (const w of women) {
    if (w.partnerId !== null) continue;
    if (g.rng.next() >= p) continue;
    const men = g.s.citizens
      .filter((m) => m.sex === 'M' && eligible(m) && Math.abs(m.age - w.age) <= AGES.COUPLE_MAX_DIFF && !related(m, w))
      .sort((a, b) => Math.abs(a.age - w.age) - Math.abs(b.age - w.age) || a.id - b.id);
    if (!men.length) continue;
    const m = men[0];
    w.partnerId = m.id;
    m.partnerId = w.id;
    // Emménagement commun si possible.
    const hw = w.houseId !== null ? g.bById.get(w.houseId) : undefined;
    const hm = m.houseId !== null ? g.bById.get(m.houseId) : undefined;
    if (hw !== hm) {
      if (hw && g.houseFree(hw) >= 1) g.moveInto(m, hw);
      else if (hm && g.houseFree(hm) >= 1) g.moveInto(w, hm);
      else {
        const h = g.findHouse(2, hw ? g.center(hw) : undefined);
        if (h) {
          g.moveInto(w, h);
          g.moveInto(m, h);
        }
      }
    }
    const h = w.houseId !== null ? g.bById.get(w.houseId) : undefined;
    g.log(`${w.first} ${w.last} et ${m.first} ${m.last} fondent un foyer.`, 'good', h ? h.x + h.w / 2 : undefined, h ? h.y + h.h / 2 : undefined);
  }
}

/** Déménagements spontanés quand une maison libre permet d'agrandir un foyer (taux annuel). */
const MOVE_RATE = 1.5;

function relocate(g: Game, dtY: number) {
  const p = 1 - Math.exp(-MOVE_RATE * dtY);
  for (const c of g.s.citizens) {
    if (c.houseId === null || c.pregnancy) continue;
    const house = g.bById.get(c.houseId);
    if (!house || g.houseFree(house) > 0) continue;
    // 1) Jeune adulte célibataire vivant chez un parent : il s'installe ailleurs.
    if (c.age >= AGES.ADULT && c.partnerId === null) {
      const withParent = g.s.citizens.some((o) => o.houseId === c.houseId && (o.id === c.motherId || o.id === c.fatherId));
      if (!withParent || g.rng.next() >= p) continue;
      const target = g.findHouse(2, g.center(house));
      if (target) {
        g.moveInto(c, target);
        g.log(`${c.first} ${c.last} quitte le foyer familial pour une maison libre.`, 'info', target.x + target.w / 2, target.y + target.h / 2);
      }
      continue;
    }
    // 2) Couple fertile à l'étroit : le foyer (couple + enfants mineurs) déménage vers une maison plus spacieuse.
    if (c.sex === 'F' && c.partnerId !== null && c.age <= AGES.FERTILE_MAX) {
      if (g.rng.next() >= p) continue;
      const household = g.s.citizens.filter(
        (o) => o.houseId === c.houseId && (o.id === c.id || o.id === c.partnerId || ((o.motherId === c.id || o.fatherId === c.partnerId) && o.age < AGES.ADULT)),
      );
      const target = g.findHouse(household.length + 1, g.center(house));
      if (target && target.id !== house.id) {
        for (const o of household) g.moveInto(o, target);
        g.log(`Le foyer de ${c.first} ${c.last} emménage dans une maison plus grande.`, 'info', target.x + target.w / 2, target.y + target.h / 2);
      }
    }
  }
}

/** Relogement des sans-abri, familles d'abord. */
export function rehouse(g: Game) {
  const homeless = g.s.citizens.filter((c) => c.houseId === null);
  if (!homeless.length) return;
  for (const grp of g.familyGroups(homeless)) {
    const need = grp.length;
    const h = g.findHouse(need);
    if (h) {
      for (const c of grp) g.moveInto(c, h);
      continue;
    }
    for (const c of grp) {
      const h1 = g.findHouse(1);
      if (h1) g.moveInto(c, h1);
    }
  }
}

// ============================================================ ressources naturelles
function regenerateNodes(g: Game, dtY: number) {
  let changed = false;
  for (const n of g.s.nodes) {
    if (n.state === 'ok') continue;
    n.timer -= dtY;
    const i = n.y * g.N + n.x;
    // Jamais de régénération sous un bâtiment ou une route.
    if (g.occ[i] >= 0 || g.s.roads[i]) continue;
    if (n.state === 'depleted' && n.timer <= 0) {
      n.state = 'growing';
      n.timer = n.kind === 'tree' ? NODES.treeGrowYears : NODES.rockGrowYears;
      changed = true;
    } else if (n.state === 'growing') {
      const total = n.kind === 'tree' ? NODES.treeGrowYears : NODES.rockGrowYears;
      n.stock = Math.min(n.max, n.max * (1 - Math.max(0, n.timer) / total));
      if (n.timer <= 0) {
        n.state = 'ok';
        n.stock = n.max;
        changed = true;
        g.dirtyWalk = true;
      }
    }
  }
  if (changed) g.nodesVersion++;
}

// ============================================================ comptabilité
function bookkeeping(g: Game, dtY: number) {
  void dtY;
  // Échantillon chaque seconde de jeu.
  if (g.s.tick % 20 === 0) {
    g.history.push({ prod: { ...g.curProd }, cons: { ...g.curCons } });
    if (g.history.length > 60) g.history.shift();
    for (const k of RES_KEYS) {
      g.curProd[k] = 0;
      g.curCons[k] = 0;
    }
    for (const [id, v] of g.buildingRateAcc) {
      const prev = g.buildingRate.get(id) ?? v * 60;
      g.buildingRate.set(id, prev * 0.9 + v * 60 * 0.1);
    }
    g.buildingRateAcc.clear();
    for (const b of g.s.buildings) if (!g.buildingRateAcc.has(b.id)) g.buildingRateAcc.set(b.id, 0);
  }
}

/** Taux moyens (par an) sur la dernière saison. */
export function recentRates(g: Game): { prod: Record<ResKey, number>; cons: Record<ResKey, number> } {
  const prod = { food: 0, water: 0, wood: 0, stone: 0 };
  const cons = { food: 0, water: 0, wood: 0, stone: 0 };
  const h = g.history.slice(-15);
  if (!h.length) return { prod, cons };
  for (const e of h)
    for (const k of RES_KEYS) {
      prod[k] += e.prod[k];
      cons[k] += e.cons[k];
    }
  for (const k of RES_KEYS) {
    prod[k] = (prod[k] / h.length) * 60;
    cons[k] = (cons[k] / h.length) * 60;
  }
  return { prod, cons };
}

/** Estimation de l'autonomie (années) : stock / (demande − production récente). */
export function autonomy(g: Game, k: 'food' | 'water'): number {
  const r = recentRates(g);
  const d = demand(g);
  const net = r.prod[k] - (k === 'water' ? r.cons.water : d.food);
  if (net >= -0.01) return Infinity;
  return g.s.stock[k] / -net;
}

// ============================================================ événements
function updateEvents(g: Game, dtY: number) {
  for (const e of g.s.events) e.remaining -= dtY;
  const ended = g.s.events.filter((e) => e.remaining <= 0);
  g.s.events = g.s.events.filter((e) => e.remaining > 0);
  for (const e of ended) g.log(`Fin de l’événement : ${EVENT_LABEL[e.kind]}.`, 'info');
  if (g.years < g.s.nextEventAt) return;
  g.s.nextEventAt = g.years + g.rng.range(EVENTS.minInterval, EVENTS.maxInterval);
  const options: string[] = [];
  const si = g.seasonIndex;
  if (si !== 3) options.push('harvest', 'harvest');
  if (si === 1 || si === 0) options.push('drought');
  if (g.s.citizens.length >= 14) options.push('illness');
  const freeSlots = g.s.buildings.filter((b) => b.type === 'house').reduce((a, b) => a + Math.max(0, g.houseFree(b)), 0);
  if (freeSlots >= EVENTS.migrants.minFree && averageHappiness(g) >= EVENTS.migrants.minHappiness) options.push('migrants', 'migrants');
  if (!options.length) return;
  const pick = g.rng.pick(options);
  if (pick === 'migrants') {
    const n = Math.min(freeSlots, g.rng.int(2, 3));
    const last = undefined;
    for (let i = 0; i < n; i++) {
      const h = g.findHouse(1);
      const c = g.addCitizen(g.rng.chance(0.5) ? 'M' : 'F', g.rng.range(18, 32), h?.id ?? null, null, null, last);
      c.happiness = 60;
    }
    g.log(`${n} voyageurs, attirés par la réputation du village, s’installent.`, 'good');
    return;
  }
  const kind = pick as EventKind;
  const years = kind === 'harvest' ? EVENTS.harvest.years : kind === 'drought' ? EVENTS.drought.years : EVENTS.illness.years;
  g.s.events.push({ kind, remaining: years, total: years });
  g.log(`Événement : ${EVENT_LABEL[kind]} — ${EVENT_DESC[kind]}`, kind === 'harvest' ? 'good' : 'warn');
}

export const EVENT_LABEL: Record<EventKind, string> = {
  harvest: 'Récolte exceptionnelle',
  drought: 'Sécheresse',
  illness: 'Maladie passagère',
};
export const EVENT_DESC: Record<EventKind, string> = {
  harvest: 'nourriture produite +50 %.',
  drought: 'puits −40 %, consommation d’eau +20 %.',
  illness: 'la santé baisse, sauf chez les habitants desservis par un dispensaire.',
};

// ============================================================ progression
function progression(g: Game, dtY: number) {
  const p = g.s.progress;
  const pop = g.s.citizens.length;
  if (pop > p.maxPop) p.maxPop = pop;
  // Paliers
  let tier = 0;
  UNLOCKS.forEach((u, i) => {
    if (p.maxPop >= u.pop) tier = i;
  });
  if (tier > p.unlockTier) {
    for (let t = p.unlockTier + 1; t <= tier; t++) {
      const u = UNLOCKS[t];
      const parts = u.buildings.map((b) => BUILDINGS[b as keyof typeof BUILDINGS].name);
      if (u.maxLevel > UNLOCKS[t - 1].maxLevel) parts.push(`amélioration au niveau ${u.maxLevel}`);
      g.log(`Palier ${u.label} atteint : ${parts.join(', ')} débloqué(s) !`, 'good');
    }
    p.unlockTier = tier;
  }
  // Victoire
  if (!p.victory) {
    const ok =
      pop >= VICTORY.population && averageHappiness(g) >= VICTORY.happiness && g.s.shortage.food === 0 && g.s.shortage.water === 0;
    if (ok) {
      p.victoryHold += dtY;
      if (p.victoryHold >= VICTORY.holdYears) {
        p.victory = true;
        g.log('Victoire ! La colonie prospère depuis deux années.', 'good');
        g.onVictory?.();
      }
    } else p.victoryHold = 0;
  }
  // Défaite
  if (pop === 0 && !p.defeat) {
    p.defeat = true;
    g.log('La colonie s’est éteinte.', 'bad');
    g.onDefeat?.();
  }
  // Tutoriel
  if (!p.tutorialDone) {
    const prods = g.s.buildings.filter((b) => g.isProducer(b));
    const steps = [
      () => prods.length > 0,
      () => prods.some((b) => g.connected.has(b.id)),
      () => prods.some((b) => g.connected.has(b.id) && b.workers.length > 0),
      () =>
        g.s.buildings.some((b) => (b.type === 'gatherer' || b.type === 'farm') && b.workers.length > 0 && g.connected.has(b.id)) &&
        g.s.buildings.some((b) => b.type === 'well' && b.workers.length > 0 && g.connected.has(b.id)),
      () => g.s.buildings.some((b) => (b.type === 'altar' && g.connected.has(b.id)) || b.type === 'garden'),
      () => p.births > 0 || g.s.citizens.some((c) => c.pregnancy),
    ];
    while (p.tutorialStep < steps.length && steps[p.tutorialStep]()) p.tutorialStep++;
    if (p.tutorialStep >= steps.length) {
      p.tutorialDone = true;
      g.log('Tutoriel terminé : la colonie est sur de bons rails !', 'good');
    }
  }
  void SECOND;
}
