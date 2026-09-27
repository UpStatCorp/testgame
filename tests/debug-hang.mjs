import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
const t = async (label) => { const s = Date.now(); const r = await page.evaluate(() => [game.time.toFixed(2), game.ui.debug.fps.toFixed(1)]); console.log(label, r, Date.now() - s, 'ms'); };
await page.waitForTimeout(2500); await t('start');
await page.keyboard.press('F1');
await page.waitForTimeout(300);
for (const b of ['Spawn 5 Villagers', 'Spawn 5 Enemies', 'Spawn Item']) { await page.getByText(b).click({ force: true }); await t(b); }
await page.getByText('Spawn Enemy', { exact: true }).click({ force: true }); await t('enemy');
await page.getByText('Spawn Villager', { exact: true }).click({ force: true }); await t('villager');
await page.waitForTimeout(700); await t('wait');
await page.getByText('Clear Spawned Objects').click({ force: true }); await t('clear');
await page.getByText('Ночь (23:00)').click({ force: true }); await t('night');
await page.keyboard.press('F1'); await t('close');
await page.evaluate(() => {
  const cf = game.village.campfires[0];
  game.player.position.set(cf.position.x + 7, cf.position.y, cf.position.z + 7);
  game.cameraRig.smoothedEye = null;
  game.cameraRig.yaw = Math.atan2(7, 7);
  game.inventory.select(2);
});
for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); await t('tick' + i); }
await page.screenshot({ path: 'test-output/hang.png', timeout: 60000 });
await t('shot');
await browser.close();
