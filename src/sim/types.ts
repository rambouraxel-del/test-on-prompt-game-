import type { ResKey } from '../config/balance';
import type { BuildingType } from '../config/buildings';

export const T_GRASS = 0;
export const T_WATER = 1;
export const T_SAND = 2;

export type Stock = Record<ResKey, number>;

export type NodeKind = 'tree' | 'rock';
export interface ResourceNode {
  id: number;
  kind: NodeKind;
  x: number;
  y: number;
  stock: number;
  max: number;
  /** 'ok' = exploitable, 'depleted' = épuisé en attente, 'growing' = en reconstitution. */
  state: 'ok' | 'depleted' | 'growing';
  /** Temps restant (années) avant de passer à l'état suivant. */
  timer: number;
  variant: number;
}

export type BuildingStatus = 'active' | 'disconnected' | 'nostaff' | 'noresource' | 'full';

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 1;
  level: number;
  /** Identifiants des travailleurs affectés. */
  workers: number[];
  /** Nombre de postes souhaités par le joueur. */
  target: number;
  /** Réservations de places pour les naissances à venir (maisons). */
  reserved: number;
}

export interface Pregnancy {
  remaining: number;
  fatherId: number;
  houseId: number | null;
}

export interface Citizen {
  id: number;
  first: string;
  last: string;
  sex: 'M' | 'F';
  age: number;
  health: number;
  happiness: number;
  houseId: number | null;
  jobId: number | null;
  education: number;
  partnerId: number | null;
  fatherId: number | null;
  motherId: number | null;
  pregnancy: Pregnancy | null;
  /** Années écoulées depuis la dernière naissance (mères). */
  sinceBirth: number;
}

export type EventKind = 'harvest' | 'drought' | 'illness';
export interface ActiveEvent {
  kind: EventKind;
  remaining: number;
  total: number;
}

export interface LogEntry {
  t: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'warn';
  x?: number;
  y?: number;
}

export interface Progress {
  maxPop: number;
  victoryHold: number;
  victory: boolean;
  freePlay: boolean;
  defeat: boolean;
  tutorialStep: number;
  tutorialDone: boolean;
  births: number;
  deaths: number;
  unlockTier: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  /** Nombre de pas fixes simulés depuis le début (le temps en découle). */
  tick: number;
  size: number;
  terrain: Uint8Array;
  decor: Uint8Array;
  roads: Uint8Array;
  nodes: ResourceNode[];
  parcels: boolean[];
  parcelsBought: number;
  buildings: Building[];
  nextBuildingId: number;
  citizens: Citizen[];
  nextCitizenId: number;
  stock: Stock;
  events: ActiveEvent[];
  nextEventAt: number;
  shortage: { food: number; water: number; wood: number };
  progress: Progress;
  log: LogEntry[];
}
