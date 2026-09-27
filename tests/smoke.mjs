// Headless smoke test: boots the game, checks for runtime errors, takes screenshots.
// Usage: node tests/smoke.mjs [url]   (expects a running dev/preview server)
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/?autostart&quality=low';
const out = 'test-output';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(url);
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/01-spawn.png` });
console.log('ERRORS:\n' + (errors.join('\n') || 'none'));
await browser.close();
