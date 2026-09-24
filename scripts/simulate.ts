// Simulation accélérée : stratégie simple sur plusieurs décennies + colonie négligée.
import { Bot } from '../src/sim/bot';
import { averageHappiness } from '../src/sim/logic';
import { Game } from '../src/sim/world';
import { TIME } from '../src/config/balance';

const STEPS_PER_YEAR = TIME.YEAR_SECONDS / TIME.FIXED_DT;

function report(g: Game, label: string) {
  const c = g.s.citizens;
  const kids = c.filter((x) => x.age < 18).length;
  const elders = c.filter((x) => x.age >= 65).length;
  const workers = c.filter((x) => x.jobId !== null).length;
  const st = g.s.stock;
  console.log(
    `${label} an ${String(g.year).padStart(3)} | pop ${String(c.length).padStart(3)} (enf ${kids}, ret ${elders}, trav ${workers}) | bonheur ${averageHappiness(g).toFixed(0)} | ` +
      `nour ${st.food.toFixed(0)}/${g.capacity.food} eau ${st.water.toFixed(0)}/${g.capacity.water} bois ${st.wood.toFixed(0)} pierre ${st.stone.toFixed(0)} | bât ${g.s.buildings.length} parc ${g.s.parcelsBought} | naiss ${g.s.progress.births} décès ${g.s.progress.deaths}${g.s.progress.victory ? ' VICTOIRE' : ''}`,
  );
}

const seeds = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const years = 50;
for (const seed of seeds.length ? seeds : [1, 42, 2024]) {
  const g = Game.create(seed);
  const bot = new Bot(g);
  let firstBirth = -1;
  let firstAdult = -1;
  let victoryYear = -1;
  const t0 = Date.now();
  for (let y = 0; y < years; y++) {
    for (let s = 0; s < STEPS_PER_YEAR; s++) {
      g.step();
      if (s % 20 === 0) bot.tick();
      if (firstBirth < 0 && g.s.progress.births > 0) firstBirth = g.years;
      if (firstAdult < 0 && g.s.citizens.some((c) => c.fatherId !== null && c.age >= 18)) firstAdult = g.years;
      if (victoryYear < 0 && g.s.progress.victory) victoryYear = g.years;
    }
    if (y % 5 === 4 || y < 3) report(g, `[graine ${seed}]`);
  }
  console.log(
    `  → 1re naissance : ${firstBirth.toFixed(2)} an(s), 1er enfant adulte : ${firstAdult.toFixed(1)}, victoire : ${victoryYear.toFixed(1)}, durée ${(Date.now() - t0) / 1000}s`,
  );
}

// Colonie négligée : aucune action du joueur.
const n = Game.create(7);
for (let y = 0; y < 8; y++) {
  for (let s = 0; s < STEPS_PER_YEAR; s++) n.step();
  report(n, '[négligée]');
}
