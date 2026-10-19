// Right-arm IK on the one-handed sword: distance from the wrist bone (after IK) to the grip target.
// Deterministic: the game loop is frozen, poses come straight from WeaponDefinitions.
// Usage: node tests/arm-ik.mjs [shot]   (needs the game served on :4173)
import { chromium } from 'playwright';
const TOL = 0.03;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:4173/?autostart&lite');
await page.waitForFunction(() => window.game && game.state === 'playing' && game.playerBody.loaded, null, { timeout: 180000 });
await page.evaluate(() => { game.input.requestLock = () => {}; if (document.pointerLockElement) { game.ui.intentionalUnlock = true; document.exitPointerLock(); } });
await page.evaluate(() => { game.inventory.selected = 0; game.events.emit('inventory:changed'); game.cameraRig.pitch = 0; });
await page.waitForFunction(() => game.weapons.viewModel.currentId === 'sword' && game.weapons.viewModel.equipT >= 1, null, { timeout: 120000 });

const table = await page.evaluate(async () => {
  const { WEAPONS } = await import('/src/weapons/WeaponDefinitions.js');
  const g = game, b = g.playerBody, vm = g.weapons.viewModel, rig = g.cameraRig, V = g.camera.position.constructor;
  g.state = 'frozen';
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (keys, u) => { // same as WeaponSystem.samplePose
    let a = keys[0], c = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) if (u >= keys[i].u && u <= keys[i + 1].u) { a = keys[i]; c = keys[i + 1]; break; }
    const t = c.u > a.u ? smooth((u - a.u) / (c.u - a.u)) : 1;
    return { p: [0, 1, 2].map((i) => a.p[i] + (c.p[i] - a.p[i]) * t), r: [0, 1, 2].map((i) => a.r[i] + (c.r[i] - a.r[i]) * t) };
  };
  const bone = (n) => b.model.getObjectByName('mixamorig' + n);
  const measure = (label, pitch, pose) => {
    rig.pitch = pitch;
    rig.place(g.player);
    g.camera.updateMatrixWorld(true);
    vm.sway.set(0, 0);
    vm.update(0, pose, rig, g.player);
    b.update(0);
    const wrist = bone('RightHand').getWorldPosition(new V());
    const target = vm.rightHand.getWorldPosition(new V());
    const shoulder = bone('RightArm').getWorldPosition(new V());
    const reach = shoulder.distanceTo(bone('RightForeArm').getWorldPosition(new V())) + bone('RightForeArm').getWorldPosition(new V()).distanceTo(wrist);
    return { label, pitch, err: +wrist.distanceTo(target).toFixed(4), need: +shoulder.distanceTo(target).toFixed(3), reach: +reach.toFixed(3), active: b.armActive };
  };
  const rows = [];
  for (let i = -4; i <= 4; i++) rows.push(measure('rest', +(i * 0.3).toFixed(1), WEAPONS.sword.rest));
  WEAPONS.sword.swings.forEach((keys, s) => {
    for (let k = 0; k < 10; k++) rows.push(measure(`swing${s + 1} u=${(k / 9).toFixed(2)}`, 0, sample(keys, k / 9)));
  });
  rig.pitch = 0;
  return rows;
});
console.log('case                 pitch   err(m)   shoulder->target   arm length');
for (const r of table) console.log(`${r.label.padEnd(20)} ${String(r.pitch).padStart(5)}   ${r.err.toFixed(4)}   ${r.need.toFixed(3).padStart(8)}           ${r.reach.toFixed(3)}${r.active ? '' : '  (IK inactive!)'}`);
const pitch0 = table.filter((r) => r.pitch === 0);
const worst = Math.max(...pitch0.map((r) => r.err));
const ok = pitch0.every((r) => r.active && r.err <= TOL);
console.log(`${ok ? 'PASS' : 'FAIL'}  pitch 0 rest + all swing phases: wrist within ${TOL} m of grip (worst ${worst.toFixed(4)} m)`);
await browser.close();
process.exit(ok ? 0 : 1);
