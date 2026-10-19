// Screenshot set for the neck-pivot camera + first-person body.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing' && game.playerBody.loaded, null, { timeout: 180000 });
await page.evaluate(() => { game.input.requestLock = () => {}; if (document.pointerLockElement) { game.ui.intentionalUnlock = true; document.exitPointerLock(); } });
const ev = (f, a) => page.evaluate(f, a);
const state = () => ev(() => ({ anim: game.playerBody.current, crouch: game.player.crouching, eye: +game.player.eyeHeight.toFixed(2), camY: +(game.camera.position.y - game.player.position.y).toFixed(2) }));
const shot = async (name) => { console.log(name, JSON.stringify(await state())); await page.screenshot({ path: `test-output/neck-${name}.png`, timeout: 120000 }); };

for (const p of [-0.9, -1.2, -1.35]) {
  await ev((p) => { game.cameraRig.pitch = p; }, p);
  await page.waitForTimeout(2500);
  await shot(`stand${p}`);
}
await ev(() => { game.cameraRig.pitch = -1.2; });
await page.keyboard.down('KeyW');
await page.waitForFunction(() => game.playerBody.current === 'Walk', null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
await shot('walk-1.2');
await page.keyboard.down('ShiftLeft');
await page.waitForFunction(() => game.playerBody.current === 'Run', null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
await shot('run-1.2');
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
await page.waitForFunction(() => game.playerBody.current === 'Idle', null, { timeout: 30000 }).catch(() => {});
await page.keyboard.down('KeyC');
await page.waitForFunction(() => game.player.eyeHeight < 1.05, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
await shot('crouch-1.2');
await page.keyboard.up('KeyC');

// Against a house wall: walk into it, then look down
const wall = await ev(() => {
  const g = game;
  const c = [...g.physics.colliders].find((c) => c.data?.kind === 'wall' && c.type === 'box' && c.hx > 2 && c.hz < 0.3);
  // outward normal along the box local z axis (choose the side away from the house centre)
  const n = { x: Math.sin(c.rot), z: Math.cos(c.rot) };
  const door = g.village.doors.reduce((a, d) => (Math.hypot(d.position.x - c.x, d.position.z - c.z) < Math.hypot(a.position.x - c.x, a.position.z - c.z) ? d : a));
  const sign = (c.x - door.position.x) * n.x + (c.z - door.position.z) * n.z > 0 ? 1 : -1;
  n.x *= sign; n.z *= sign;
  const px = c.x + n.x * (c.hz + 1.5), pz = c.z + n.z * (c.hz + 1.5);
  g.player.position.set(px, g.terrain.getHeight(px, pz), pz);
  g.player.velocity.set(0, 0, 0);
  g.cameraRig.smoothedEye = null;
  g.cameraRig.yaw = Math.atan2(n.x, n.z); // look toward -n (into the wall)
  g.cameraRig.pitch = 0;
  window.__wall = c;
  return { c: [c.x, c.z, c.hx, c.hz, c.rot].map((v) => +v.toFixed(2)) };
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyW');
await ev(() => { game.cameraRig.pitch = -1.2; });
await page.waitForTimeout(2500);
const inside = await ev(() => {
  const c = window.__wall, cam = game.camera.position;
  const dx = cam.x - c.x, dz = cam.z - c.z;
  const lx = dx * Math.cos(c.rot) - dz * Math.sin(c.rot), lz = dx * Math.sin(c.rot) + dz * Math.cos(c.rot);
  const p = game.player.position;
  const pdx = p.x - c.x, pdz = p.z - c.z;
  const plz = pdx * Math.sin(c.rot) + pdz * Math.cos(c.rot);
  return { camLocalZ: +lz.toFixed(3), playerLocalZ: +plz.toFixed(3), halfThickness: c.hz, camInsideWall: Math.abs(lx) < c.hx && Math.abs(lz) < c.hz, gapToWallFace: +(Math.abs(lz) - c.hz).toFixed(3) };
});
console.log('wall', JSON.stringify(wall), JSON.stringify(inside));
await shot('wall-1.2');
console.log('errors', errors.length ? errors : 'none');
await browser.close();
