import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
await page.evaluate(() => {
  window.__log = [];
  const g = game;
  const orig = g.updateGameplay.bind(g);
  g.updateGameplay = (dt, modal) => {
    orig(dt, modal);
    const p = g.player;
    if (!isFinite(p.position.y) || p.position.y > 60 || Math.abs(p.velocity.y) > 30) {
      __log.push(JSON.stringify({ t: g.time.toFixed(2), dt, p: p.position.toArray(), v: p.velocity.toArray(), g: p.onGround, sw: p.swimming }));
    }
  };
  const f = g.cameraRig.forward.clone().setY(0).normalize();
  const pos = g.player.position.clone().addScaledVector(f, 2.2);
  window.__e = g.entities.addEnemy(pos, 'forest', true);
  __e.setState('CHASE');
});
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500);
  const r = await Promise.race([
    page.evaluate(() => JSON.stringify({ t: game.time.toFixed(2), p: game.player.position.toArray().map((v) => +v.toFixed(2)), v: game.player.velocity.toArray().map((v) => +v.toFixed(2)), hp: +game.player.health.current.toFixed(0), st: __e.state, ph: __e.attackPhase, log: __log.slice(0, 3) })),
    new Promise((r) => setTimeout(() => r('TIMEOUT (page frozen)'), 20000)),
  ]);
  console.log(r);
  if (r.startsWith('TIMEOUT')) break;
}
await browser.close();
