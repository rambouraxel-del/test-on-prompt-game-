import type { Cost } from './balance';

export type BuildingType =
  | 'townhall'
  | 'house'
  | 'woodcutter'
  | 'stonecutter'
  | 'gatherer'
  | 'well'
  | 'farm'
  | 'granary'
  | 'altar'
  | 'school'
  | 'clinic'
  | 'garden';

export type Category = 'habitat' | 'resources' | 'services' | 'infra';
export type JobKind = 'woodcutter' | 'stonecutter' | 'gatherer' | 'farmer' | 'waterbearer' | 'teacher' | 'healer';

export const JOB_LABEL: Record<JobKind, string> = {
  woodcutter: 'Bûcheron',
  stonecutter: 'Tailleur de pierre',
  gatherer: 'Cueilleur',
  farmer: 'Fermier',
  waterbearer: 'Porteur d’eau',
  teacher: 'Enseignant',
  healer: 'Soignant',
};

export interface BuildingDef {
  type: BuildingType;
  name: string;
  category: Category;
  w: number;
  h: number;
  cost: Cost;
  /** Coût des améliorations vers le niveau 2 et 3. */
  upgradeCost?: [Cost, Cost];
  buildable: boolean;
  demolishable: boolean;
  needsRoad: boolean;
  job?: JobKind;
  /** Nombre de postes par niveau. */
  workers?: [number, number, number];
  /** Capacité d'habitants (maisons). */
  housing?: [number, number, number];
  /** Rayon d'action par niveau (cases). */
  radius?: [number, number, number];
  /** Production annuelle par travailleur. */
  rate?: number;
  /** Multiplicateur de production par niveau. */
  levelMult?: [number, number, number];
  /** Capacité d'usagers par niveau (autel, école, dispensaire). */
  users?: [number, number, number];
  /** Bonus de bonheur par niveau (autel, jardin). */
  bonus?: [number, number, number];
  desc: string;
  levelDesc: [string, string, string];
}

const LV = (a: string, b: string, c: string): [string, string, string] => [a, b, c];

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  townhall: {
    type: 'townhall',
    name: 'Hôtel de ville',
    category: 'infra',
    w: 4,
    h: 4,
    cost: {},
    upgradeCost: [
      { wood: 120, stone: 100 },
      { wood: 220, stone: 200 },
    ],
    buildable: false,
    demolishable: false,
    needsRoad: false,
    desc: 'Cœur de la colonie : racine du réseau routier et stockage de base.',
    levelDesc: LV('Stockage de base', 'Stockage +120 par ressource', 'Stockage +240 par ressource'),
  },
  house: {
    type: 'house',
    name: 'Maison',
    category: 'habitat',
    w: 4,
    h: 2,
    cost: { wood: 30, stone: 10 },
    upgradeCost: [
      { wood: 40, stone: 30 },
      { wood: 70, stone: 60 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: false,
    housing: [5, 7, 9],
    desc: 'Loge un foyer. Une route reliée donne accès aux services.',
    levelDesc: LV('5 habitants, confort +5', '7 habitants, confort +10', '9 habitants, confort +15'),
  },
  woodcutter: {
    type: 'woodcutter',
    name: 'Cabane de bûcheron',
    category: 'resources',
    w: 3,
    h: 3,
    cost: { wood: 20, stone: 5 },
    upgradeCost: [
      { wood: 40, stone: 25 },
      { wood: 70, stone: 50 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    job: 'woodcutter',
    workers: [3, 4, 5],
    radius: [6, 7, 8],
    rate: 22,
    levelMult: [1, 1.15, 1.3],
    desc: 'Abat les arbres dans son rayon. Les arbres repoussent après un délai.',
    levelDesc: LV('3 postes, rayon 6', '4 postes, rayon 7, +15 %', '5 postes, rayon 8, +30 %'),
  },
  stonecutter: {
    type: 'stonecutter',
    name: 'Camp de tailleurs',
    category: 'resources',
    w: 3,
    h: 3,
    cost: { wood: 30 },
    upgradeCost: [
      { wood: 50, stone: 25 },
      { wood: 80, stone: 50 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    job: 'stonecutter',
    workers: [3, 4, 5],
    radius: [6, 7, 8],
    rate: 13,
    levelMult: [1, 1.15, 1.3],
    desc: 'Taille la pierre des gisements dans son rayon. Les gisements se reconstituent lentement.',
    levelDesc: LV('3 postes, rayon 6', '4 postes, rayon 7, +15 %', '5 postes, rayon 8, +30 %'),
  },
  gatherer: {
    type: 'gatherer',
    name: 'Cabane de cueilleurs',
    category: 'resources',
    w: 3,
    h: 3,
    cost: { wood: 20 },
    upgradeCost: [
      { wood: 35, stone: 20 },
      { wood: 60, stone: 40 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    job: 'gatherer',
    workers: [3, 4, 5],
    rate: 45,
    levelMult: [1, 1.15, 1.3],
    desc: 'Récolte baies et racines. Rendement modeste et très saisonnier.',
    levelDesc: LV('3 postes', '4 postes, +15 %', '5 postes, +30 %'),
  },
  well: {
    type: 'well',
    name: 'Puits',
    category: 'resources',
    w: 2,
    h: 2,
    cost: { wood: 10, stone: 20 },
    upgradeCost: [
      { wood: 25, stone: 35 },
      { wood: 45, stone: 60 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    job: 'waterbearer',
    workers: [3, 4, 5],
    radius: [4, 4, 4],
    rate: 55,
    levelMult: [1, 1.15, 1.3],
    desc: 'Tire l’eau de la nappe. +40 % si une étendue d’eau est à 4 cases ou moins.',
    levelDesc: LV('3 postes', '4 postes, +15 %', '5 postes, +30 %'),
  },
  farm: {
    type: 'farm',
    name: 'Ferme',
    category: 'resources',
    w: 4,
    h: 4,
    cost: { wood: 45, stone: 15 },
    upgradeCost: [
      { wood: 60, stone: 35 },
      { wood: 90, stone: 60 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    job: 'farmer',
    workers: [3, 4, 5],
    rate: 75,
    levelMult: [1, 1.15, 1.3],
    desc: 'Cultures abondantes, sensibles aux saisons. Consomme 0,3 eau par unité de nourriture.',
    levelDesc: LV('3 postes', '4 postes, +15 %', '5 postes, +30 %'),
  },
  granary: {
    type: 'granary',
    name: 'Grenier',
    category: 'infra',
    w: 3,
    h: 3,
    cost: { wood: 40, stone: 15 },
    upgradeCost: [
      { wood: 50, stone: 35 },
      { wood: 80, stone: 60 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    desc: 'Augmente la capacité de stockage de toutes les ressources (s’il est relié).',
    levelDesc: LV('+150 par ressource', '+260 par ressource', '+400 par ressource'),
  },
  altar: {
    type: 'altar',
    name: 'Autel',
    category: 'services',
    w: 2,
    h: 2,
    cost: { wood: 15, stone: 25 },
    upgradeCost: [
      { wood: 30, stone: 45 },
      { wood: 50, stone: 80 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    radius: [9, 11, 13],
    users: [20, 35, 50],
    bonus: [8, 11, 14],
    desc: 'Dessert les maisons reliées dans son rayon, dans la limite de sa capacité. Non cumulable.',
    levelDesc: LV('Rayon 9, 20 fidèles, bonheur +8', 'Rayon 11, 35 fidèles, bonheur +11', 'Rayon 13, 50 fidèles, bonheur +14'),
  },
  school: {
    type: 'school',
    name: 'École',
    category: 'services',
    w: 4,
    h: 3,
    cost: { wood: 55, stone: 35 },
    upgradeCost: [
      { wood: 60, stone: 50 },
      { wood: 90, stone: 80 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    job: 'teacher',
    workers: [2, 3, 4],
    users: [10, 16, 22],
    levelMult: [1, 1.2, 1.4],
    desc: 'Les enseignants instruisent les enfants de 6 à 17 ans vivant dans une maison reliée (6 élèves par enseignant).',
    levelDesc: LV('2 enseignants, 10 élèves', '3 enseignants, 16 élèves, +20 % de vitesse', '4 enseignants, 22 élèves, +40 % de vitesse'),
  },
  clinic: {
    type: 'clinic',
    name: 'Dispensaire',
    category: 'services',
    w: 3,
    h: 3,
    cost: { wood: 50, stone: 40 },
    upgradeCost: [
      { wood: 60, stone: 50 },
      { wood: 90, stone: 80 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: true,
    job: 'healer',
    workers: [2, 3, 4],
    radius: [10, 12, 14],
    users: [12, 12, 12],
    desc: 'Les soignants améliorent la santé des maisons reliées dans le rayon (12 habitants par soignant). Ne compense pas la faim ni la soif.',
    levelDesc: LV('2 soignants, rayon 10', '3 soignants, rayon 12', '4 soignants, rayon 14'),
  },
  garden: {
    type: 'garden',
    name: 'Jardin',
    category: 'services',
    w: 2,
    h: 2,
    cost: { wood: 10, stone: 5, food: 5 },
    upgradeCost: [
      { wood: 20, stone: 15 },
      { wood: 35, stone: 30 },
    ],
    buildable: true,
    demolishable: true,
    needsRoad: false,
    radius: [5, 6, 7],
    bonus: [4, 6, 8],
    desc: 'Embellit le voisinage : bonheur des maisons dans le rayon (total des jardins plafonné à +10).',
    levelDesc: LV('Rayon 5, bonheur +4', 'Rayon 6, bonheur +6', 'Rayon 7, bonheur +8'),
  },
};

export const CATEGORY_LABEL: Record<Category, string> = {
  habitat: 'Habitat',
  resources: 'Ressources',
  services: 'Services',
  infra: 'Infrastructures',
};

export const PRODUCERS: BuildingType[] = ['woodcutter', 'stonecutter', 'gatherer', 'well', 'farm'];

export const FARM_WATER_PER_FOOD = 0.3;
export const WELL_NEAR_WATER_BONUS = 0.4;
