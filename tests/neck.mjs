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

// At pitch -1.2 at least one toe must be inside the frame AND not occluded by the body.
// (The rear foot of a stance is hidden by the pelvis, as for a real person - accepted.)
const toeVisibility = () => page.evaluate(() => {
  const g = game, V = g.camera.position.constructor;
  const meshes = [];
  g.playerBody.model.traverse((o) => { if (o.isMesh) { o.computeBoundingSphere?.(); meshes.push(o); } });
  const rc = new g.interaction.raycaster.constructor();
  return ['mixamorigLeftToeBase', 'mixamorigRightToeBase'].map((n) => {
    const toe = g.playerBody.model.getObjectByName(n).getWorldPosition(new V());
    const ndc = toe.clone().project(g.camera);
    const inFrame = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z > -1 && ndc.z < 1;
    const dir = toe.clone().sub(g.camera.position);
    const dist = dir.length();
    rc.set(g.camera.position, dir.normalize());
    rc.near = 0; rc.far = dist + 0.5;
    const hit = rc.intersectObjects(meshes, false)[0];
    const unoccluded = !hit || hit.distance >= dist - 0.12;
    return { toe: n.replace('mixamorig', ''), ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], inFrame, dist: +dist.toFixed(3), firstHit: hit ? +hit.distance.toFixed(3) : null, visible: inFrame && unoccluded };
  });
});
const poseCheck = async (pose) => {
  await page.evaluate(() => { game.cameraRig.pitch = -1.2; });
  if (pose !== 'Idle') await page.waitForFunction((a) => game.playerBody.current === a, pose, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { game.cameraRig.pitch = -1.2; });
  const anim = await page.evaluate(() => game.playerBody.current);
  const toes = await toeVisibility();
  check(`${pose}: at least one toe in frame and not occluded (pitch -1.2)`, anim === pose && toes.some((t) => t.visible), JSON.stringify({ anim, toes }));
};
await poseCheck('Idle');
if (shots) await page.screenshot({ path: 'test-output/neck-1.2.png', timeout: 120000 });
await page.keyboard.down('KeyW');
await poseCheck('Walk');
await page.keyboard.down('ShiftLeft');
await poseCheck('Run');
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
console.log(results.join('\n'));
await browser.close();
