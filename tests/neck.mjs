// Neck-pivot camera checks: pitch 0 == old formula (1e-6); toes visible at pitch -1.2.
import { chromium } from 'playwright';
const shots = process.argv[2] === 'shot';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing' && game.playerBody.loaded, null, { timeout: 180000 });
await page.evaluate(() => { game.input.requestLock = () => {}; if (document.pointerLockElement) { game.ui.intentionalUnlock = true; document.exitPointerLock(); } });
const results = [];
const check = (n, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`);

await page.evaluate(() => { game.cameraRig.pitch = 0; });
await page.waitForTimeout(1500);
const d0 = await page.evaluate(() => {
  const r = game.cameraRig, p = game.player, cam = game.camera;
  // the pre-change formula, recomputed independently
  const old = new cam.position.constructor(p.position.x, r.smoothedEye + r.bobOffset.y + r.landDip, p.position.z);
  old.x += Math.cos(r.yaw) * r.bobOffset.x; old.z += -Math.sin(r.yaw) * r.bobOffset.x;
  return [cam.position.distanceTo(old), cam.position.distanceTo(r.basePosition)];
});
check('Camera at pitch 0 identical to old formula', d0[0] < 1e-6 && d0[1] < 1e-6, JSON.stringify(d0));
const maxFwd = await page.evaluate(() => {
  let m = 0, at = 0;
  for (let p = 0; p >= -1.5; p -= 0.01) { const d = game.cameraRig.constructor.neckDelta(p, 0); if (-d.z > m) { m = -d.z; at = p; } }
  return [m, at];
});
check('Max forward camera shift < 0.2 m and < player radius', maxFwd[0] < 0.2 && maxFwd[0] < 0.35, JSON.stringify(maxFwd.map((v) => +v.toFixed(3))));

await page.evaluate(() => { game.cameraRig.pitch = -1.2; });
await page.waitForTimeout(2000);
const toes = await page.evaluate(() => ['mixamorigLeftToeBase', 'mixamorigRightToeBase'].map((n) => {
  const v = game.playerBody.model.getObjectByName(n).getWorldPosition(new game.camera.position.constructor()).project(game.camera);
  return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(3)];
}));
check('Toes project inside the camera frame at pitch -1.2', toes.every(([x, y, z]) => Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1 && z > -1), JSON.stringify(toes));
if (shots) await page.screenshot({ path: 'test-output/neck-1.2.png', timeout: 120000 });
console.log(results.join('\n'));
await browser.close();
