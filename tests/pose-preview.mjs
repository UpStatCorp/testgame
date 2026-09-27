// Renders first-person weapon poses (rest + swing phases) for visual tuning.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
const weapons = (process.argv[2] || 'sword,greatsword,staff').split(',');
for (const w of weapons) {
  const slot = { sword: 0, greatsword: 1, staff: 2, fists: 7 }[w];
  await page.evaluate((s) => { game.state = 'playing'; game.inventory.select(s); }, slot);
  await page.waitForTimeout(2500);
  const phases = w === 'staff' ? ['rest', 'cast'] : ['rest', 0.25, 0.45, 0.55, 0.75];
  for (const ph of phases) {
    await page.evaluate((ph) => {
      const ws = game.weapons;
      game.state = 'playing';
      ws.viewModel.equipT = 1;
      if (ph === 'rest') { ws.attacking = false; ws.castBlend = 0; }
      else if (ph === 'cast') { ws.attacking = false; ws.castBlend = 1; }
      else { ws.attacking = true; ws.attackTime = ph * ws.def.duration; ws.swingSoundDone = true; ws.hitDone = true; }
      game.player.velocity.set(0, 0, 0);
      ws.update(0);

      game.state = 'frozen';
    }, ph);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-output/pose-${w}-${ph}.png`, timeout: 90000 });
  }
}
await browser.close();
