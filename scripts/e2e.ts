// Test de bout en bout dans un vrai navigateur (Chromium) :
// nouvelle partie → construction → route → affectation → production → amélioration → sauvegarde → rechargement.
// Usage : npm run build && npx vite preview --port 4173 &  puis  npm run e2e
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.E2E_URL ?? 'http://localhost:4173/';
const EXEC = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
mkdirSync('e2e-shots', { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let failures = 0;
function check(cond: boolean, label: string) {
  console.log(`${cond ? '✔' : '✘'} ${label}`);
  if (!cond) failures++;
}

async function tileToScreen(p: Page, x: number, y: number): Promise<[number, number]> {
  return p.evaluate(
    ([x, y]) => {
      const app = (window as any).__app;
      const cam = app.renderer.cam;
      const c = app.renderer.canvas;
      return [(x * 16 + 8 - cam.x) * cam.zoom + c.clientWidth / 2, (y * 16 + 8 - cam.y) * cam.zoom + c.clientHeight / 2];
    },
    [x, y],
  );
}

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(600);
await page.screenshot({ path: 'e2e-shots/01-menu.png' });

// Nouvelle partie avec graine fixe
await page.click('[data-m="new"]');
await page.fill('#seed-input', 'e2e');
await page.click('[data-act="new-go"]');
await page.waitForTimeout(500);
check(await page.evaluate(() => !!(window as any).__app.game), 'Nouvelle partie créée');
// Pause pour des mesures stables pendant la construction
await page.keyboard.press('Space');

// --- Construction d'une cabane de cueilleurs touchant une route reliée
await page.click('[data-act="cat"][data-cat="resources"]');
await page.click('[data-act="build"][data-type="gatherer"]');
const spot = await page.evaluate(() => {
  const g = (window as any).__app.game;
  for (let r = 3; r < 14; r++)
    for (let y = 48 - r; y <= 48 + r; y++)
      for (let x = 48 - r; x <= 48 + r; x++) {
        if (!g.canPlace('gatherer', x, y, 0).ok) continue;
        const touches = g.perimeter({ x, y, w: 3, h: 3 }).some(([px, py]: number[]) => g.roadConnected[py * g.N + px]);
        if (touches) return [x, y];
      }
  return null;
});
check(spot !== null, 'Emplacement valide trouvé pour la cabane');
const [sx, sy] = await tileToScreen(page, spot![0] + 1, spot![1] + 1);
await page.mouse.move(sx, sy);
await page.waitForTimeout(100);
await page.screenshot({ path: 'e2e-shots/02-preview.png' });
await page.mouse.click(sx, sy);
await page.waitForTimeout(200);
const gathererId = await page.evaluate(() => (window as any).__app.game.s.buildings.find((b: any) => b.type === 'gatherer')?.id ?? null);
check(gathererId !== null, 'Cabane de cueilleurs construite par clic');
check(await page.evaluate((id) => (window as any).__app.game.connected.has(id), gathererId), 'Cabane reliée au réseau');

// --- Puits isolé puis route tracée à la souris
await page.click('[data-act="build"][data-type="well"]');
const wellSpot = await page.evaluate(() => {
  const g = (window as any).__app.game;
  // Cherche un emplacement à 3 cases au sud de la route principale y=49
  for (let x = 40; x < 58; x++) {
    const y = 53;
    if (!g.canPlace('well', x, y, 0).ok) continue;
    let clear = true;
    for (let yy = 50; yy < 53; yy++) if (g.roadCheck(x, yy) !== null) clear = false;
    if (clear) return [x, y];
  }
  return null;
});
check(wellSpot !== null, 'Emplacement de puits trouvé');
const [wx, wy] = await tileToScreen(page, wellSpot![0], wellSpot![1]);
await page.mouse.click(wx, wy);
await page.waitForTimeout(150);
const wellId = await page.evaluate(() => (window as any).__app.game.s.buildings.find((b: any) => b.type === 'well')?.id ?? null);
check(wellId !== null, 'Puits construit');
check(!(await page.evaluate((id) => (window as any).__app.game.connected.has(id), wellId)), 'Puits initialement non relié');
await page.keyboard.press('Escape');
await page.click('[data-act="tool"][data-tool="road"]');
const [r1x, r1y] = await tileToScreen(page, wellSpot![0], wellSpot![1] - 1);
const [r2x, r2y] = await tileToScreen(page, wellSpot![0], 50);
await page.mouse.move(r1x, r1y);
await page.mouse.down();
await page.mouse.move((r1x + r2x) / 2, (r1y + r2y) / 2, { steps: 4 });
await page.mouse.move(r2x, r2y, { steps: 4 });
await page.screenshot({ path: 'e2e-shots/03-road-drag.png' });
await page.mouse.up();
await page.waitForTimeout(200);
check(await page.evaluate((id) => (window as any).__app.game.connected.has(id), wellId), 'Route tracée : puits relié');
await page.keyboard.press('Escape');

// --- Sélection et affectation avec le bouton +
const [gx, gy] = await tileToScreen(page, spot![0] + 1, spot![1] + 1);
await page.mouse.click(gx, gy);
await page.waitForTimeout(250);
check(await page.isVisible('#panel'), 'Panneau du bâtiment affiché');
for (let i = 0; i < 3; i++) {
  await page.click('#panel [data-act="add-worker"]');
  await page.waitForTimeout(80);
}
const workers = await page.evaluate((id) => (window as any).__app.game.bById.get(id).workers.length, gathererId);
check(workers === 3, `3 travailleurs affectés (obtenu ${workers})`);
const disabled = await page.isDisabled('#panel [data-act="add-worker"]');
check(disabled, 'Bouton + désactivé une fois les postes pourvus');
await page.screenshot({ path: 'e2e-shots/04-panel.png' });

// --- Production à vitesse ×4
const food0 = await page.evaluate(() => (window as any).__app.game.s.stock.food);
await page.click('[data-act="speed"][data-id="4"]');
await page.waitForTimeout(6000);
const prod = await page.evaluate((id) => (window as any).__app.game.buildingRate.get(id) ?? 0, gathererId);
const year = await page.evaluate(() => (window as any).__app.game.years);
check(prod > 0, `Production réelle de la cabane : ${prod.toFixed(1)} nourriture/an`);
check(year > 0.25, `Le temps avance (${year.toFixed(2)} an)`);
const food1 = await page.evaluate(() => (window as any).__app.game.s.stock.food);
console.log(`  nourriture ${food0.toFixed(1)} → ${food1.toFixed(1)}`);
await page.screenshot({ path: 'e2e-shots/05-running.png' });

// --- Amélioration (palier de population forcé pour le test : niveau 2 exige 24 habitants)
await page.evaluate(() => {
  const g = (window as any).__app.game;
  g.s.progress.maxPop = 24;
  g.s.stock.wood = 200;
  g.s.stock.stone = 150;
});
await page.waitForTimeout(300);
await page.click('#panel [data-act="upgrade"]');
await page.waitForTimeout(200);
const lvl = await page.evaluate((id) => (window as any).__app.game.bById.get(id).level, gathererId);
check(lvl === 2, `Amélioration au niveau 2 (niveau ${lvl})`);
const cap = await page.evaluate((id) => (window as any).__app.game.jobCap((window as any).__app.game.bById.get(id)), gathererId);
check(cap === 4, `Capacité portée à 4 postes (${cap})`);

// --- Sauvegarde manuelle puis rechargement
await page.keyboard.press('Space');
const before = await page.evaluate(() => {
  const g = (window as any).__app.game;
  return JSON.stringify({
    tick: g.s.tick,
    b: g.s.buildings.map((b: any) => [b.type, b.x, b.y, b.level, b.workers.length]),
    pop: g.s.citizens.length,
    stock: Object.values(g.s.stock).map((v: any) => v.toFixed(3)),
  });
});
await page.click('[data-act="quick-save"]');
await page.waitForTimeout(300);
await page.reload();
await page.waitForTimeout(600);
await page.click('[data-m="load-manual"]');
await page.waitForTimeout(500);
const after = await page.evaluate(() => {
  const g = (window as any).__app.game;
  return JSON.stringify({
    tick: g.s.tick,
    b: g.s.buildings.map((b: any) => [b.type, b.x, b.y, b.level, b.workers.length]),
    pop: g.s.citizens.length,
    stock: Object.values(g.s.stock).map((v: any) => v.toFixed(3)),
  });
});
check(before === after, 'État identique après sauvegarde et rechargement');
if (before !== after) console.log('  avant : ' + before + '\n  après : ' + after);
await page.screenshot({ path: 'e2e-shots/06-reloaded.png' });

// --- Import d'un fichier corrompu : message clair
await page.evaluate(() => localStorage.setItem('lpf.save.manual', '{"game":"les-premiers-foyers","version":1,"size":96,"seed":1,"rng":1,"tick":5,"terrain":"0:9;"}'));
await page.evaluate(() => (window as any).__app.showMainMenu());
await page.waitForTimeout(200);
await page.click('[data-m="load-manual"]');
await page.waitForTimeout(200);
const msg = await page.textContent('#modal-root');
check(!!msg && msg.includes('corrompue'), 'Sauvegarde corrompue signalée clairement');
await page.screenshot({ path: 'e2e-shots/07-corrupt.png' });

// --- Écran plus petit
await page.setViewportSize({ width: 800, height: 600 });
await page.click('[data-act="modal-close"]');
await page.click('[data-m="continue"]');
await page.waitForTimeout(500);
await page.screenshot({ path: 'e2e-shots/08-small.png' });
check(await page.isVisible('#buildbar'), 'Barre de construction visible en 800×600');

check(errors.length === 0, `Aucune erreur console (${errors.length})`);
for (const e of errors) console.log('   ' + e);
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les contrôles E2E sont passés.');
process.exit(failures ? 1 : 0);
