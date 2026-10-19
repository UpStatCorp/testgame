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
const curve = await page.evaluate(() => {
  const R = game.cameraRig.constructor;
  let m = 0, at = 0, nonZeroAbove = 0;
  for (let p = 0.5; p >= -1.55; p -= 0.005) {
    const d = R.neckDelta(p, 0.7);
    const fwd = Math.hypot(d.x, d.z);
    if (p >= -0.3 && d.length() !== 0) nonZeroAbove++;
    if (fwd > m) { m = fwd; at = p; }
  }
  return { maxFwd: +m.toFixed(4), atPitch: +at.toFixed(2), FWD_MAX: R.NECK_FWD_MAX, DOWN_MAX: R.NECK_DOWN_MAX, nonZeroAbove };
});
check('Neck offset strictly 0 for pitch >= -0.3', curve.nonZeroAbove === 0, JSON.stringify(curve));
check('Max forward camera shift <= 0.3 m (< player radius 0.35)', curve.maxFwd <= 0.3 && curve.FWD_MAX <= 0.3, JSON.stringify(curve));

await page.evaluate(() => { game.cameraRig.pitch = -1.2; });
await page.waitForTimeout(2000);
const toes = await page.evaluate(() => ['mixamorigLeftToeBase', 'mixamorigRightToeBase'].map((n) => {
  const v = game.playerBody.model.getObjectByName(n).getWorldPosition(new game.camera.position.constructor()).project(game.camera);
  return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(3)];
}));
check('Toes project inside the camera frame at pitch -1.2', toes.every(([x, y, z]) => Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1 && z > -1), JSON.stringify(toes));
const occl = await page.evaluate(() => {
  const g = game, V = g.camera.position.constructor;
  const meshes = [];
  g.playerBody.model.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) { o.computeBoundingSphere?.(); meshes.push(o); } });
  const rc = new g.interaction.raycaster.constructor();
  return ['mixamorigLeftToeBase', 'mixamorigRightToeBase'].map((n) => {
    const toe = g.playerBody.model.getObjectByName(n).getWorldPosition(new V());
    const dir = toe.clone().sub(g.camera.position);
    const dist = dir.length();
    rc.set(g.camera.position, dir.normalize());
    rc.near = 0; rc.far = dist + 0.5;
    const hit = rc.intersectObjects(meshes, false)[0];
    return { toe: n.replace('mixamorig', ''), dist: +dist.toFixed(3), firstHit: hit ? +hit.distance.toFixed(3) : null };
  });
});
check('Toes not occluded by the body (first hit >= dist - 0.12)', occl.every((o) => o.firstHit === null || o.firstHit >= o.dist - 0.12), JSON.stringify(occl));
if (shots) await page.screenshot({ path: 'test-output/neck-1.2.png', timeout: 120000 });
console.log(results.join('\n'));
await browser.close();
