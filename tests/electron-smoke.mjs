// Launches the packaged desktop app (electron/main.cjs) and checks the game boots.
// Usage (Linux CI/container): xvfb-run node tests/electron-smoke.mjs
import { _electron as electron } from 'playwright';
const app = await electron.launch({ args: ['.', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 240000 });
console.log('title:', await win.title());
await win.click('text=Начать путешествие', { force: true });
await win.waitForFunction(() => window.game.state === 'playing', null, { timeout: 60000 });
await win.waitForTimeout(4000);
await win.screenshot({ path: 'test-output/electron.png', timeout: 120000 });
console.log('state:', await win.evaluate(() => game.state), 'errors:', errors.length ? errors : 'none');
await app.close();
