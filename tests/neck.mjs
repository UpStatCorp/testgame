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
  await page.waitForTimeout(1500);
  await page.evaluate(() => { game.cameraRig.pitch = -1.2; });
  const anim = await page.evaluate(() => game.playerBody.current);
  const toes = await toeVisibility();
  check(`${pose}: at least one toe in frame and not occluded (pitch -1.2)`, anim === pose && toes.some((t) => t.visible), JSON.stringify({ anim, toes }));
};
await poseCheck('Idle');
if (shots) await page.screenshot({ path: 'test-output/neck-1.2.png', timeout: 120000 });

// Walk / Run: deterministic sweep over 10 explicit phases of the clip (no timing, no movement).
// The game loop is frozen, other actions stopped, and the pose is set via action.time.
const phaseSweep = (clipName) => page.evaluate((clipName) => {
  const g = game, b = g.playerBody;
  g.state = 'frozen';
  g.cameraRig.pitch = -1.2;
  g.cameraRig.place(g.player);
  g.camera.updateMatrixWorld(true);
  b.mixer.stopAllAction();
  const action = b.actions[clipName];
  action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  const dur = action.getClip().duration;
  const rows = [];
  for (let k = 0; k < 10; k++) {
    action.time = (dur * k) / 10;
    b.mixer.update(0);
    for (const bone of b.hiddenBones) bone.scale.setScalar(0);
    b.model.updateMatrixWorld(true);
    rows.push({ k, toes: window.__toeVisibilitySync() });
  }
  return rows;
}, clipName);
await page.evaluate(() => {
  // synchronous copy of toeVisibility for use inside the frozen sweep
  window.__toeVisibilitySync = () => {
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
      return { toe: n.replace('mixamorig', '').replace('ToeBase', ''), inFrame, dist: +dist.toFixed(3), firstHit: hit ? +hit.distance.toFixed(3) : null, visible: inFrame && unoccluded };
    });
  };
});
const phaseTables = {};
for (const clip of ['Walk', 'Run']) {
  const rows = await phaseSweep(clip);
  const good = rows.filter((r) => r.toes.some((t) => t.visible)).length;
  const table = rows.map((r) => `  ${clip} phase ${r.k}: visible=[${r.toes.filter((t) => t.visible).map((t) => t.toe).join(',') || '-'}] ` + r.toes.map((t) => `${t.toe}{inFrame:${t.inFrame},dist:${t.dist},firstHit:${t.firstHit}}`).join(' ')).join('\n');
  phaseTables[clip] = table;
  check(`${clip}: toe visible in >= 5 of 10 phases (pitch -1.2)`, good >= 5, `${good}/10`);
}
// restore normal play
await page.evaluate(() => { const b = game.playerBody; b.mixer.stopAllAction(); b.current = null; b.play('Idle', 0); game.state = 'playing'; });
console.log(results.join('\n'));
console.log(phaseTables.Walk + '\n' + phaseTables.Run);
await browser.close();
