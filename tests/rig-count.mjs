import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
console.log(await page.evaluate(() => {
  const out = [];
  for (const c of game.entities.creatures.slice(0, 20)) {
    let n = 0; c.root.traverse((o) => { if (o.isMesh || o.isSprite) n++; });
    out.push(`${c.name}:${n}:${c.root.visible}`);
  }
  let chestN = 0; for (const ch of game.village.chests) ch.root.traverse((o) => { if (o.isMesh) chestN++; });
  let cfN = 0; for (const cf of game.village.campfires) cf.root.traverse((o) => { if (o.isMesh) cfN++; });
  return out.join(' ') + ` chests:${chestN} campfires:${cfN}`;
}));
await browser.close();
