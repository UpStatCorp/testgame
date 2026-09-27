import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
console.log(await page.evaluate(() => {
  const counts = {};
  let total = 0, shadow = 0;
  game.scene.traverseVisible((o) => {
    if (!(o.isMesh || o.isPoints || o.isSprite)) return;
    total++;
    if (o.castShadow) shadow++;
    let top = o;
    while (top.parent && top.parent !== game.scene) top = top.parent;
    const key = top.name || top.type + (top.userData.body ? '-body' : '');
    counts[key] = (counts[key] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);
  return JSON.stringify({ total, shadow, sorted });
}));
await browser.close();
