// First-person right arm (one-handed sword): hand on the grip, wrist angles, stretch, framing.
// Deterministic: the game loop is frozen, poses come straight from WeaponDefinitions.
// Rows: rest at pitch -1.2..1.2 and 101 phases of each swing (no smoothing), then the same swings
// played at 60 fps with smoothing (the hand must not leave the grip).
// Wrist angles are measured from bone positions only (reviewer's method):
//   f = ForeArm->Hand, y = Hand->Middle1, x = Index1-Pinky1 orthogonalised to y, z = x*y
//   bend = angle(f, y), lateral = atan2(f.x, f.y) (+ towards the little finger), flex = atan2(f.z, f.y) (- flexion)
// Usage: node tests/arm-ik.mjs [full]   (needs the game served on :4173; 'full' prints every row)
import { chromium } from 'playwright';
const TOL = 0.01;
const D = 180 / Math.PI;
const LIM = { radial: 20, ulnar: 30, flex: 50, ext: 45 };
const full = process.argv[2] === 'full';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:4173/?autostart&lite');
await page.waitForFunction(() => window.game && game.state === 'playing' && game.playerBody.loaded, null, { timeout: 180000 });
await page.evaluate(() => { game.input.requestLock = () => {}; game.inventory.selected = 0; game.events.emit('inventory:changed'); game.cameraRig.pitch = 0; });
await page.waitForFunction(() => game.weapons.viewModel.currentId === 'sword' && game.weapons.viewModel.equipT >= 1, null, { timeout: 120000 });

const res = await page.evaluate(async () => {
  const { WEAPONS } = await import('/src/weapons/WeaponDefinitions.js');
  const { PALM, twistY } = await import('/src/player/FPArm.js');
  const g = game, vm = g.weapons.viewModel, rig = g.cameraRig, arm = vm.fpArm, V = g.camera.position.constructor;
  g.state = 'frozen';
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (keys, u) => { // same as WeaponSystem.samplePose
    let a = keys[0], c = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) if (u >= keys[i].u && u <= keys[i + 1].u) { a = keys[i]; c = keys[i + 1]; break; }
    const t = c.u > a.u ? smooth((u - a.u) / (c.u - a.u)) : 1;
    return { p: [0, 1, 2].map((i) => a.p[i] + (c.p[i] - a.p[i]) * t), r: [0, 1, 2].map((i) => a.r[i] + (c.r[i] - a.r[i]) * t) };
  };
  const bone = (n) => arm.scene.getObjectByName('mixamorig' + n).getWorldPosition(new V());
  const ndc = (p) => { const c = p.clone().applyMatrix4(g.camera.matrixWorldInverse); const n = p.clone().project(g.camera); return { x: n.x, y: n.y, behind: c.z > -0.05 }; };
  const inFrame = (n) => !n.behind && Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1;
  const topLeft = (n) => !n.behind && (n.y > 1 || n.x < -1);
  const pose = (pitch, p, dt) => {
    rig.pitch = pitch;
    rig.place(g.player);
    g.camera.updateMatrixWorld(true);
    vm.sway.set(0, 0);
    vm.update(0, p, rig, g.player);
    arm.aspect = g.camera.aspect;
    arm.update(dt, vm.rightHand, vm.holder);
    arm.scene.updateMatrixWorld(true);
    // palm point on the sword grip (independent of arm.error)
    const hq = arm.hand.getWorldQuaternion(vm.holder.quaternion.clone());
    const palm = bone('RightHand').add(PALM.clone().applyQuaternion(hq));
    const err = Math.max(arm.error, palm.distanceTo(vm.rightHand.getWorldPosition(new V())));
    // wrist angles from bone positions
    const hand = bone('RightHand'), f = hand.clone().sub(bone('RightForeArm')).normalize();
    const y = bone('RightHandMiddle1').sub(hand).normalize();
    const x = bone('RightHandIndex1').sub(bone('RightHandPinky1'));
    x.addScaledVector(y, -x.dot(y)).normalize();
    const z = x.clone().cross(y);
    const fy = f.dot(y);
    const elbow = ndc(bone('RightForeArm')), shoulder = ndc(bone('RightArm'));
    return {
      err, bend: Math.acos(Math.min(1, Math.max(-1, fy))), lateral: Math.atan2(f.dot(x), fy), flex: Math.atan2(f.dot(z), fy),
      twist: twistY(arm.fore.quaternion), wristTwist: Math.atan2(Math.sin(arm.twistNeed - twistY(arm.fore.quaternion)), Math.cos(arm.twistNeed - twistY(arm.fore.quaternion))),
      elbowBend: arm.elbowBend, upperQ: arm.upper.getWorldQuaternion(vm.holder.quaternion.clone()), foreQ: arm.fore.getWorldQuaternion(vm.holder.quaternion.clone()),
      upperDir: bone('RightForeArm').sub(bone('RightArm')).normalize(), foreDir: f.clone(), holderQ: vm.holder.quaternion.clone(), k1: arm.k1, k2: arm.k2, shift: arm.shoulder.distanceTo(new V(0.3, -0.35, 0)),
      elbowIn: inFrame(elbow), elbowTL: topLeft(elbow), shoulderIn: inFrame(shoulder) || topLeft(shoulder), elbowNdc: [elbow.x, elbow.y],
    };
  };
  const rows = [];
  for (let i = -4; i <= 4; i++) rows.push({ label: 'rest', pitch: +(i * 0.3).toFixed(1), ...pose(i * 0.3, WEAPONS.sword.rest, Infinity) });
  WEAPONS.sword.swings.forEach((keys, s) => {
    let prev = null;
    for (let k = 0; k <= 100; k++) {
      const r = { label: `swing${s + 1} u=${(k / 100).toFixed(2)}`, pitch: 0, ...pose(0, sample(keys, k / 100), Infinity) };
      // continuity between neighbouring phases (1% of the swing apart)
      const ang = (a, b) => Math.acos(Math.min(1, a.dot(b)));
      r.jump = prev ? Math.max(ang(r.upperDir, prev.upperDir), r.foreQ.angleTo(prev.foreQ)) : 0; // visible: arm directions + forearm incl. roll
      r.rollJump = prev ? r.upperQ.angleTo(prev.upperQ) : 0; // upper arm incl. roll around its own axis
      r.holderJump = prev ? r.holderQ.angleTo(prev.holderQ) : 0;
      prev = r;
      rows.push(r);
    }
  });
  for (const r of rows) { delete r.upperQ; delete r.foreQ; delete r.upperDir; delete r.foreDir; delete r.holderQ; r.jump ??= 0; r.rollJump ??= 0; r.holderJump ??= 0; }
  const dur = WEAPONS.sword.duration, dt = 1 / 60;
  const played = [];
  WEAPONS.sword.swings.forEach((keys, s) => {
    pose(0, WEAPONS.sword.rest, Infinity);
    let worst = 0, at = 0, shoulderIn = false, prevUp = null, roll = 0, rollAt = 0;
    for (let t = 0; t <= dur + 0.5; t += dt) {
      const r = pose(0, sample(keys, Math.min(1, t / dur)), dt);
      shoulderIn ||= r.shoulderIn;
      if (prevUp && r.upperQ.angleTo(prevUp) > roll) { roll = r.upperQ.angleTo(prevUp); rollAt = Math.min(1, t / dur); }
      prevUp = r.upperQ;
      if (r.err > worst) { worst = r.err; at = Math.min(1, t / dur); }
    }
    played.push({ swing: s + 1, worst, at, shoulderIn, roll, rollAt });
  });
  rig.pitch = 0;
  return { rows, played, L: [arm.L1, arm.L2], tris: arm.triangles };
});
const f = (x, n = 3) => x.toFixed(n);
const deg = (r) => (r * D).toFixed(1).padStart(6);
console.log(`FP arm: ${res.tris} triangles, upper ${f(res.L[0])} m, forearm ${f(res.L[1])} m`);
console.log('wrist: lateral + = towards little finger (limit -20..+30), flex/ext - = flexion (limit -50..+45)');
console.log('foreTwist: forearm roll vs upper arm (0 = rig bind pose), wristTwist: remainder left in the wrist');
console.log('case            pitch  err(m)    bend  lateral  flex/ext  foreTwist  wristTwist  elbow bend  upper k  fore k  shoulder shift  elbow');
const show = (r) => console.log(`${r.label.padEnd(15)} ${String(r.pitch).padStart(5)}  ${f(r.err, 4)}  ${deg(r.bend)}  ${deg(r.lateral)}   ${deg(r.flex)}    ${deg(r.twist)}      ${deg(r.wristTwist)}      ${deg(r.elbowBend)}    ${f(r.k1)}    ${f(r.k2)}   ${f(r.shift)}          ${r.elbowTL ? 'TOP/LEFT!' : r.elbowIn ? 'in frame' : 'out'}`);
const pick = (r) => full || r.label === 'rest' || ['0.00', '0.10', '0.20', '0.30', '0.40', '0.50', '0.60', '0.70', '0.80', '0.90', '1.00'].some((u) => r.label.endsWith(u));
for (const r of res.rows) if (pick(r)) show(r);
const worstBy = (fn) => res.rows.reduce((a, r) => (fn(r) > fn(a) ? r : a));
console.log('worst rows:');
for (const [name, fn] of [['bend', (r) => r.bend], ['radial', (r) => -r.lateral], ['ulnar', (r) => r.lateral], ['flexion', (r) => -r.flex], ['extension', (r) => r.flex], ['|foreTwist|', (r) => Math.abs(r.twist)], ['upper k', (r) => r.k1], ['fore k', (r) => r.k2], ['|wristTwist|', (r) => Math.abs(r.wristTwist)], ['shoulder shift', (r) => r.shift], ['err', (r) => r.err], ['phase jump', (r) => r.jump], ['upper roll', (r) => r.rollJump]]) {
  const r = worstBy(fn); process.stdout.write(`  ${name.padEnd(14)} `); show(r);
  if (name === 'phase jump') console.log(`                 max visible turn between neighbouring phases (arm directions, forearm incl. roll): ${deg(r.jump)} deg; sword turns ${deg(r.holderJump)} deg there`);
  if (name === 'upper roll') console.log(`                 max upper-arm turn incl. roll around its own axis between neighbouring phases (no smoothing): ${deg(r.rollJump)} deg`);
}
for (const p of res.played) console.log(`played swing${p.swing} at 60 fps (smoothed): worst err ${f(p.worst, 4)} at u=${f(p.at, 2)}, shoulder in frame: ${p.shoulderIn}, max upper-arm turn per frame (incl. roll) ${deg(p.roll)} at u=${f(p.rollAt, 2)}`);
const eps = 0.05; // deg, numeric slack on the limit boundary
const rest = res.rows.filter((r) => r.label === 'rest');
const checks = [
  ['no visible jumps: arm directions and forearm turn <= 15 deg between neighbouring swing phases', res.rows.every((r) => r.jump * D <= 15)],
  [`hand on the grip within ${TOL} m in all ${res.rows.length} rows`, res.rows.every((r) => r.err <= TOL)],
  [`hand on the grip within ${TOL} m while playing swings with smoothing`, res.played.every((p) => p.worst <= TOL)],
  ['wrist within limits (radial 20, ulnar 30, flexion 50, extension 45) in all rows', res.rows.every((r) => -r.lateral * D <= LIM.radial + eps && r.lateral * D <= LIM.ulnar + eps && -r.flex * D <= LIM.flex + eps && r.flex * D <= LIM.ext + eps)],
  ['rest: total wrist bend <= 25 deg', rest.every((r) => r.bend * D <= 25)],
  ['forearm twist relative to the upper arm within +-90 deg', res.rows.every((r) => Math.abs(r.twist * D) <= 90 + eps)],
  ['upper <= 2.0 and forearm <= 1.4 everywhere, both >= 1', res.rows.every((r) => r.k1 <= 2 + 1e-6 && r.k2 <= 1.4 + 1e-6 && r.k1 >= 1 - 1e-6 && r.k2 >= 1 - 1e-6)],
  ['rest: elbow and shoulder out of frame', rest.every((r) => !r.elbowIn && !r.elbowTL && !r.shoulderIn)],
  ['swings: shoulder never in frame, elbow never above/left of the frame', res.rows.every((r) => !r.shoulderIn && !r.elbowTL) && res.played.every((p) => !p.shoulderIn)],
];
for (const [n, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
await browser.close();
process.exit(checks.every((c) => c[1]) ? 0 : 1);
