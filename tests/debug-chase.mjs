import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
await page.evaluate(() => {
  const g = game;
  const f = g.cameraRig.forward.clone().setY(0).normalize();
  const pos = g.player.position.clone().addScaledVector(f, 8);
  const e = g.entities.addEnemy(pos, 'forest', true);
  e.setState('CHASE');
  window.__e = e;
});
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(250);
  console.log(await page.evaluate(() => JSON.stringify({ p: game.player.position.toArray().map((v) => +v.toFixed(2)), v: game.player.velocity.toArray().map((v) => +v.toFixed(2)), pitch: +game.cameraRig.pitch.toFixed(2), hp: +game.player.health.current.toFixed(0), st: __e.state, ep: __e.position.toArray().map((v) => +v.toFixed(1)) })));
}
await browser.close();
