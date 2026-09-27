import { chromium } from 'playwright';
const q = process.argv[2] || 'low';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:4173/?autostart&${q}`);
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
const measure = async (label) => {
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => ({ frame: game.perf.frame.toFixed(0), upd: game.perf.update.toFixed(1), rend: game.perf.render.toFixed(0), calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles, progs: game.renderer.info.programs.length, geos: game.renderer.info.memory.geometries }));
  console.log(label, JSON.stringify(r));
};
await measure('day');
await page.evaluate(() => game.dayNight.setHour(23));
await measure('night');
await browser.close();
