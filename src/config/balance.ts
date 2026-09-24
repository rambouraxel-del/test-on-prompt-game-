// Données d'équilibrage centralisées : coûts, rendements, consommations, rayons, seuils et durées.
// Toutes les grandeurs "par an" sont exprimées pour une année de jeu (YEAR_SECONDS secondes à vitesse ×1).

export type ResKey = 'food' | 'water' | 'wood' | 'stone';
export const RES_KEYS: ResKey[] = ['food', 'water', 'wood', 'stone'];
export type Cost = Partial<Record<ResKey, number>>;

export const RES_LABEL: Record<ResKey, string> = {
  food: 'Nourriture',
  water: 'Eau',
  wood: 'Bois',
  stone: 'Pierre',
};

export const TIME = {
  /** Durée d'une année en secondes de jeu à vitesse ×1. */
  YEAR_SECONDS: 60,
  /** Pas de simulation fixe (secondes). */
  FIXED_DT: 0.05,
  /** Nombre de pas fixes entre deux mises à jour logiques. */
  LOGIC_EVERY: 5,
  /** Nombre maximal de pas simulés par image (évite la spirale de rattrapage). */
  MAX_STEPS_PER_FRAME: 40,
};

export const MAP = {
  SIZE: 96,
  TILE: 16,
  PARCEL: 16,
  /** Parcelles débloquées au départ (coordonnées de parcelle). */
  START_PARCELS: [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ] as [number, number][],
};

export const SEASONS = [
  {
    key: 'spring',
    name: 'Printemps',
    gatherMult: 1.1,
    farmMult: 1.1,
    waterUseMult: 1.0,
    heating: false,
    effects: 'Printemps favorable : cueillette et cultures +10 %.',
  },
  {
    key: 'summer',
    name: 'Été',
    gatherMult: 1.0,
    farmMult: 1.0,
    waterUseMult: 1.35,
    heating: false,
    effects: 'Été chaud : consommation d’eau +35 %.',
  },
  {
    key: 'autumn',
    name: 'Automne',
    gatherMult: 1.4,
    farmMult: 1.5,
    waterUseMult: 1.0,
    heating: false,
    effects: 'Automne généreux : cueillette +40 %, cultures +50 %.',
  },
  {
    key: 'winter',
    name: 'Hiver',
    gatherMult: 0.35,
    farmMult: 0.25,
    waterUseMult: 0.9,
    heating: true,
    effects: 'Hiver rude : cueillette −65 %, cultures −75 %, chauffage au bois des maisons.',
  },
] as const;

export const CONSUMPTION = {
  /** Consommation annuelle par habitant selon l'âge. */
  foodAdult: 10,
  foodChild: 5,
  foodElder: 8,
  waterAdult: 10,
  waterChild: 5,
  waterElder: 8,
  /** Bois de chauffage par maison habitée et par an, uniquement en hiver. */
  heatingWoodPerHouse: 14,
};

export const STORAGE = {
  base: { food: 250, water: 250, wood: 220, stone: 160 } as Record<ResKey, number>,
  /** Bonus de l'hôtel de ville par niveau au-delà du premier. */
  townhallPerLevel: 120,
  /** Bonus d'un entrepôt par niveau (index = niveau - 1). */
  granary: [150, 260, 400],
};

export const START = {
  stock: { food: 160, water: 160, wood: 170, stone: 90 } as Record<ResKey, number>,
  adults: 12,
};

export const AGES = {
  CHILD: 6,
  ADULT: 18,
  RETIRE: 65,
  FERTILE_MIN: 18,
  FERTILE_MAX: 42,
  COUPLE_MAX: 55,
  COUPLE_MAX_DIFF: 12,
};

export const DEMOGRAPHY = {
  /** Taux annuel de formation d'un couple pour une femme célibataire éligible. */
  coupleRate: 1.2,
  /** Taux annuel de conception quand toutes les conditions sont réunies. */
  conceptionRate: 0.8,
  /** Durée de la grossesse (années). */
  pregnancyYears: 0.75,
  /** Intervalle minimal entre deux naissances pour une mère (années). */
  birthCooldown: 1.5,
  minHappiness: 55,
  minHealth: 50,
  minFoodStock: 25,
  minWaterStock: 25,
  /** Risque de décès lié à l'âge : base * growth^(âge - 65), par an. */
  oldAgeBase: 0.012,
  oldAgeGrowth: 1.12,
  /** Risque annuel de décès quand la santé est critique. */
  criticalHealth: 20,
  criticalHazard: 0.35,
};

export const HEALTH = {
  target: 80,
  targetClinic: 96,
  targetHomeless: 60,
  drift: 12,
  driftClinic: 26,
  starvation: 38,
  thirst: 55,
  cold: 10,
  illness: 22,
  illnessClinic: 5,
  oldAgeTargetLoss: 0.8,
};

export const HAPPINESS = {
  base: 35,
  fed: 10,
  hungry: -25,
  watered: 10,
  thirsty: -25,
  house: [5, 10, 15],
  homeless: -20,
  disconnectedHouse: -10,
  crowded: -5,
  crowdedRatio: 0.8,
  religionMissing: -5,
  gardenCap: 10,
  healthGood: 5,
  healthGoodThreshold: 70,
  healthBad: -10,
  healthBadThreshold: 40,
  cold: -10,
  /** Vitesse de convergence du bonheur réel vers la cible (points par an). */
  drift: 60,
};

export const EDUCATION = {
  /** Années de scolarité pour atteindre 100 % d'éducation. */
  yearsForFull: 8,
  /** Bonus de productivité maximal d'un adulte entièrement instruit. */
  productivityBonus: 0.3,
  studentsPerTeacher: 6,
};

export const VICTORY = {
  population: 60,
  happiness: 70,
  holdYears: 2,
};

export const EVENTS = {
  firstEventYear: 4,
  minInterval: 2.5,
  maxInterval: 4.5,
  harvest: { years: 0.5, foodMult: 1.5 },
  drought: { years: 0.5, wellMult: 0.6, waterUseMult: 1.2 },
  illness: { years: 0.5 },
  migrants: { minFree: 2, minHappiness: 60 },
};

export const PARCELS = {
  baseCost: { wood: 60, stone: 40, food: 20 } as Cost,
  /** Coût = base × (1 + a·n + b·n²) où n = parcelles déjà achetées. */
  linear: 0.45,
  quadratic: 0.05,
};

export const NODES = {
  treeStock: 24,
  rockStock: 40,
  /** Délai avant repousse d'un arbre abattu (années), puis croissance. */
  treeRegrowDelay: 2,
  treeGrowYears: 1.5,
  rockRegrowDelay: 6,
  rockGrowYears: 4,
};

export const ROAD_COST: Cost = { wood: 1 };
export const DEMOLISH_REFUND = 0.5;

export const UNLOCKS = [
  { pop: 0, label: 'Départ', buildings: ['house', 'woodcutter', 'stonecutter', 'gatherer', 'well', 'granary', 'altar', 'garden'], maxLevel: 1 },
  { pop: 16, label: '16 habitants', buildings: ['farm', 'school'], maxLevel: 1 },
  { pop: 24, label: '24 habitants', buildings: ['clinic'], maxLevel: 2 },
  { pop: 40, label: '40 habitants', buildings: [], maxLevel: 3 },
];

export const AUTOSAVE_SECONDS = 45;
