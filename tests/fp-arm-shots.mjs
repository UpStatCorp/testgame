// Frozen-frame screenshots of the first-person sword arm.
// Usage: node tests/fp-arm-shots.mjs [query] [pitch] [swing u or ""] [swing index] [name] [closeup "fov,ox,oy,oz"]
import { chromium } from 'playwright';
const [q = '', pitch = '0', u = '', swing = '0', name = 'fp', fov = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://localhost:4173/?autostart&quality=low' + q);
await page.waitForFunction(() => window.game && game.state === 'playing' && game.playerBody?.loaded, null, { timeout: 180000 });
await page.evaluate(() => { game.input.requestLock = () => {}; game.inventory.selected = 0; game.events.emit('inventory:changed'); });
await page.waitForFunction(() => game.weapons.viewModel.equipT >= 1, null, { timeout: 120000 });
await page.evaluate(async ([pitch, u, swing, fov]) => {
  const { WEAPONS } = await import('/src/weapons/WeaponDefinitions.js');
  const g = game, vm = g.weapons.viewModel, rig = g.cameraRig;
  g.state = 'frozen';
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (keys, u) => { let a = keys[0], c = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) if (u >= keys[i].u && u <= keys[i + 1].u) { a = keys[i]; c = keys[i + 1]; break; }
    const t = c.u > a.u ? smooth((u - a.u) / (c.u - a.u)) : 1;
    return { p: [0, 1, 2].map((i) => a.p[i] + (c.p[i] - a.p[i]) * t), r: [0, 1, 2].map((i) => a.r[i] + (c.r[i] - a.r[i]) * t) }; };
  rig.pitch = pitch; rig.place(g.player);
  g.playerBody.update(0);
  g.camera.updateMatrixWorld(true);
  vm.sway.set(0, 0);
  // the arm solver keeps the previous elbow swivel: walk the swing from its start like the game does
  if (vm.fpArm) vm.fpArm.swivel = null;
  const steps = u === '' ? [WEAPONS.sword.rest] : Array.from({ length: Math.round(+u * 100) + 1 }, (_, k) => sample(WEAPONS.sword.swings[swing], k / 100));
  for (const pose of steps) {
    vm.update(0, pose, rig, g.player);
    vm.fpArm?.update(Infinity, vm.rightHand, vm.holder);
  }
  document.getElementById('ui-root').style.display = 'none';
  for (const el of document.querySelectorAll('#hud, .hud, #hotbar')) el.style.display = 'none';
  if (fov) { // close-up from a separate camera; fov = "deg,ox,oy,oz" offset from the grip in game-camera space
    const [deg, ox, oy, oz] = fov.split(',').map(Number);
    const V = g.camera.position.constructor;
    const grip = vm.rightHand.getWorldPosition(new V());
    const cam = g.camera.clone(false);
    cam.fov = deg; cam.near = 0.01; cam.updateProjectionMatrix();
    cam.position.copy(grip).add(new V(ox, oy, oz).applyQuaternion(g.camera.quaternion));
    cam.up.set(0, 1, 0).applyQuaternion(g.camera.quaternion);
    cam.lookAt(grip); cam.updateMatrixWorld(true);
    g.composer.passes[0].camera = cam;
    g.bloom.enabled = false;
    window.__closeCam = cam;
  }
  g.composer.render(0.016);
}, [+pitch, u, +swing, fov]);
await page.waitForTimeout(1500);
await page.screenshot({ path: `test-output/${name}.png`, timeout: 120000 });
await browser.close();
