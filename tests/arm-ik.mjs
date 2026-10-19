// First-person right arm (one-handed sword): wrist error after IK and stretch factors.
// Deterministic: the game loop is frozen, poses come straight from WeaponDefinitions.
// Rows: rest at pitch -1.2..1.2 and 101 phases of each swing (converged stretch), then the same
// swings played at 60 fps with the time-smoothed stretch (the hand must not leave the grip).
// Usage: node tests/arm-ik.mjs [full]   (needs the game served on :4173; 'full' prints every row)
import { chromium } from 'playwright';
const TOL = 0.01;
const full = process.argv[2] === 'full';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:4173/?autostart&lite');
await page.waitForFunction(() => window.game && game.state === 'playing' && game.playerBody.loaded, null, { timeout: 180000 });
await page.evaluate(() => { game.input.requestLock = () => {}; game.inventory.selected = 0; game.events.emit('inventory:changed'); game.cameraRig.pitch = 0; });
await page.waitForFunction(() => game.weapons.viewModel.currentId === 'sword' && game.weapons.viewModel.equipT >= 1, null, { timeout: 120000 });

const res = await page.evaluate(async () => {
  const { WEAPONS } = await import('/src/weapons/WeaponDefinitions.js');
  const { PALM, GRIP_ROT } = await import('/src/player/FPArm.js');
  const g = game, vm = g.weapons.viewModel, rig = g.cameraRig, arm = vm.fpArm;
  g.state = 'frozen';
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (keys, u) => { // same as WeaponSystem.samplePose
    let a = keys[0], c = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) if (u >= keys[i].u && u <= keys[i + 1].u) { a = keys[i]; c = keys[i + 1]; break; }
    const t = c.u > a.u ? smooth((u - a.u) / (c.u - a.u)) : 1;
    return { p: [0, 1, 2].map((i) => a.p[i] + (c.p[i] - a.p[i]) * t), r: [0, 1, 2].map((i) => a.r[i] + (c.r[i] - a.r[i]) * t) };
  };
  const pose = (pitch, p, dt) => {
    rig.pitch = pitch;
    rig.place(g.player);
    g.camera.updateMatrixWorld(true);
    vm.sway.set(0, 0);
    vm.update(0, p, rig, g.player);
    arm.update(dt, vm.rightHand, vm.holder);
    // independent of arm.error: palm point of the hand bone vs the grip point of the sword
    const V = g.camera.position.constructor, hq = arm.hand.getWorldQuaternion(vm.holder.quaternion.clone());
    const palm = arm.hand.getWorldPosition(new V()).add(PALM.clone().applyQuaternion(hq));
    const gripQ = vm.holder.getWorldQuaternion(hq.clone()).multiply(GRIP_ROT);
    const palmErr = palm.distanceTo(vm.rightHand.getWorldPosition(new V()));
    return { err: Math.max(arm.error, palmErr), rotErr: hq.angleTo(gripQ), k1: arm.k1, k2: arm.k2, total: (arm.k1 * arm.L1 + arm.k2 * arm.L2) / (arm.L1 + arm.L2) };
  };
  const rows = [];
  for (let i = -4; i <= 4; i++) rows.push({ label: 'rest', pitch: +(i * 0.3).toFixed(1), ...pose(i * 0.3, WEAPONS.sword.rest, Infinity) });
  WEAPONS.sword.swings.forEach((keys, s) => {
    for (let k = 0; k <= 100; k++) rows.push({ label: `swing${s + 1} u=${(k / 100).toFixed(2)}`, pitch: 0, ...pose(0, sample(keys, k / 100), Infinity) });
  });
  // played at 60 fps with smoothing, starting from rest
  const dur = WEAPONS.sword.duration, dt = 1 / 60;
  const played = [];
  WEAPONS.sword.swings.forEach((keys, s) => {
    pose(0, WEAPONS.sword.rest, Infinity);
    let worst = 0, at = 0;
    for (let t = 0; t <= dur + 0.5; t += dt) {
      const r = pose(0, sample(keys, Math.min(1, t / dur)), dt);
      if (r.err > worst) { worst = r.err; at = Math.min(1, t / dur); }
    }
    played.push({ swing: s + 1, worst, at });
  });
  rig.pitch = 0;
  return { rows, played, L: [arm.L1, arm.L2], tris: arm.triangles };
});
const f = (x, n = 3) => x.toFixed(n);
console.log(`FP arm: ${res.tris} triangles, upper ${f(res.L[0])} m, forearm ${f(res.L[1])} m`);
console.log('case            pitch  err(m)   upper k  fore k  total');
const show = (r) => console.log(`${r.label.padEnd(15)} ${String(r.pitch).padStart(5)}  ${f(r.err, 4)}   ${f(r.k1)}    ${f(r.k2)}   ${f(r.total)}`);
for (const r of res.rows) if (full || r.label === 'rest' || /u=\d\.\d[05]$/.test(r.label) && Math.round(parseFloat(r.label.split('=')[1]) * 100) % 10 === 0 || ['0.44', '0.56', '0.67'].some((u) => r.label.endsWith(u))) show(r);
const max = (key) => res.rows.reduce((a, r) => (r[key] > a[key] ? r : a));
for (const key of ['err', 'rotErr', 'k1', 'k2', 'total']) { const m = max(key); console.log(`max ${key.padEnd(5)} ${f(m[key], 4)} at ${m.label} pitch ${m.pitch}`); }
for (const p of res.played) console.log(`played swing${p.swing} at 60 fps (smoothed stretch): worst err ${f(p.worst, 4)} at u=${f(p.at, 2)}`);
const restK = res.rows.find((r) => r.label === 'rest' && r.pitch === 0);
const checks = [
  [`wrist within ${TOL} m in all ${res.rows.length} rows (wrist target and palm-on-grip)`, res.rows.every((r) => r.err <= TOL)],
  ['hand orientation = grip orientation (< 0.01 rad) in all rows', res.rows.every((r) => r.rotErr < 0.01)],
  [`wrist within ${TOL} m while playing swings with smoothing`, res.played.every((p) => p.worst <= TOL)],
  ['rest total length <= 1.3', restK.total <= 1.3],
  ['upper <= 2.0 and forearm <= 1.4 everywhere', res.rows.every((r) => r.k1 <= 2 + 1e-9 && r.k2 <= 1.4 + 1e-9)],
];
for (const [n, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
await browser.close();
process.exit(checks.every((c) => c[1]) ? 0 : 1);
