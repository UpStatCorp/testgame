// Visual screenshots at real quality (slow on software renderers; a few frames only).
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('test-output', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?autostart&quality=' + (process.argv[2] || 'high'));
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
await page.evaluate(() => { game.input.requestLock = () => {}; if (document.pointerLockElement) { game.ui.intentionalUnlock = true; document.exitPointerLock(); } });
const views = [
  ['spawn', () => {}],
  ['lake', () => { game.player.position.set(-10, game.terrain.getHeight(-10, -42), -42); game.cameraRig.yaw = -0.4; game.cameraRig.pitch = -0.08; game.cameraRig.smoothedEye = null; }],
  ['sunset', () => { game.dayNight.setHour(18.5); game.player.position.set(4, game.terrain.getHeight(4, 34), 34); game.cameraRig.yaw = 0.15; game.cameraRig.smoothedEye = null; }],
  ['night', () => { game.dayNight.setHour(23); const cf = game.village.campfires[0]; game.player.position.set(cf.position.x + 6, cf.position.y, cf.position.z + 6); game.cameraRig.yaw = Math.atan2(6, 6); game.cameraRig.pitch = -0.12; game.cameraRig.smoothedEye = null; game.inventory.select(2); }],
];
for (const [name, fn] of views) {
  await page.evaluate(fn);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `test-output/view-${name}.png`, timeout: 120000 });
}
await browser.close();
