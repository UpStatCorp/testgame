import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?autostart&quality=low');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.keyboard.press('F1');
await page.waitForTimeout(300);
console.log(await page.evaluate(() => {
  const b = [...document.querySelectorAll('#debug button')].find((x) => x.textContent === 'Spawn 5 Villagers');
  const r = b.getBoundingClientRect();
  const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return JSON.stringify({ modal: game.ui.modal, rect: [r.x, r.y, r.width, r.height], at: at && (at.id || at.className || at.tagName), pe: getComputedStyle(b).pointerEvents, dbgPe: getComputedStyle(document.getElementById('debug')).pointerEvents, rootZ: getComputedStyle(document.getElementById('ui-root')).zIndex });
}));
await browser.close();
