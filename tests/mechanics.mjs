// End-to-end mechanics test in headless Chromium (SwiftShader).
// Exercises: movement, inventory (open/drag&drop), all weapons, combat kill, telekinesis grab/throw,
// NPC dialog, interaction (door/chest/campfire), debug spawn menu, day/night, death/respawn.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] || 'http://localhost:4173/';
const out = 'test-output';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const results = [];
const check = (name, ok, info = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const shot = async (n) => { if (process.env.SHOTS) await page.screenshot({ path: `${out}/${n}.png`, timeout: 90000 }); };
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(base + '?autostart&lite');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
// Tests drive the camera directly: disable real pointer lock so synthetic mouse moves don't rotate it
await page.evaluate(() => { game.input.requestLock = () => {}; if (document.pointerLockElement) { game.ui.intentionalUnlock = true; document.exitPointerLock(); } });
await wait(1500);

// ---- Player body (first-person full body) ----
check('Player body loaded', await ev(() => game.playerBody.loaded && !game.playerBody.failed && game.playerBody.hiddenBones.length === 5), JSON.stringify(await ev(() => ({ loaded: game.playerBody.loaded, hidden: game.playerBody.hiddenBones.length }))));
check('Player body idle when standing', await ev(() => game.playerBody.current === 'Idle'));
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
const ran = await page.waitForFunction(() => game.playerBody.current === 'Run', null, { timeout: 30000 }).then(() => true).catch(() => false);
const runInfo = await ev(() => ({ anim: game.playerBody.current, speed: Math.hypot(game.player.velocity.x, game.player.velocity.z).toFixed(2) }));
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
check('Player body switches Idle -> Run above speed threshold', ran, JSON.stringify(runInfo));
await page.waitForFunction(() => game.playerBody.current === 'Idle', null, { timeout: 30000 }).catch(() => {});

// ---- Movement ----
const p0 = await ev(() => game.player.position.toArray());
await page.keyboard.down('KeyW');
await wait(3000);
await page.keyboard.up('KeyW');
const p1 = await ev(() => game.player.position.toArray());
const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
check('WASD movement', moved > 1.0, `moved ${moved.toFixed(2)}m`);
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
await wait(800);
const sprinting = await ev(() => game.player.sprinting);
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
check('Sprint', sprinting);
await ev(() => { window.__air = false; window.__airT = setInterval(() => { if (!game.player.onGround) window.__air = true; }, 5); });
await page.keyboard.press('Space');
await wait(1500);
const airborne = await ev(() => { clearInterval(window.__airT); return window.__air; });
check('Jump', airborne);
await wait(800);
await page.keyboard.down('KeyC'); await wait(400);
const crouch = await ev(() => game.player.crouching);
await page.keyboard.up('KeyC');
check('Crouch', crouch);

// ---- Inventory ----
await page.keyboard.press('Tab');
await wait(400);
const invOpen = await ev(() => game.ui.modal === 'inventory');
check('Inventory opens with TAB', invOpen);
await shot('02-inventory');
// drag slot 3 (potion, index 3) onto backpack slot 12
const from = await page.locator('.inv-grid .slot[data-index="3"]').boundingBox();
const to = await page.locator('.inv-grid .slot[data-index="12"]').boundingBox();
await page.mouse.move(from.x + 29, from.y + 29);
await page.mouse.down();
await page.mouse.move(from.x + 60, from.y + 40, { steps: 5 });
await page.mouse.move(to.x + 29, to.y + 29, { steps: 8 });
await page.mouse.up();
await wait(200);
const moveOk = await ev(() => !game.inventory.slots[3] && game.inventory.slots[12]?.id === 'potion');
check('Inventory drag & drop', moveOk);
// move it back
await page.mouse.move(to.x + 29, to.y + 29);
await page.mouse.down();
await page.mouse.move(from.x + 29, from.y + 29, { steps: 8 });
await page.mouse.up();
await page.keyboard.press('Tab');
await wait(300);
check('Inventory closes with TAB', await ev(() => game.ui.modal === null));

// ---- Hotbar & weapons ----
for (const [key, id] of [['Digit1', 'sword'], ['Digit2', 'greatsword'], ['Digit3', 'staff']]) {
  await page.keyboard.press(key);
  await wait(500);
  const eq = await ev(() => game.weapons.equippedId);
  check(`Hotbar ${key} equips ${id}`, eq === id);
  await shot(`03-weapon-${id}`);
}

// ---- Combat: sword kills an enemy ----
async function spawnEnemyInFront(dist) {
  return ev((d) => {
    const g = game;
    const f = g.cameraRig.forward.clone().setY(0).normalize();
    const pos = g.player.position.clone().addScaledVector(f, d);
    const e = g.entities.addEnemy(pos, 'forest', true);
    e.setState('IDLE');
    e.stateTime = -100; // stay put
    e.yaw = Math.atan2(-f.x, -f.z);
    return g.entities.creatures.indexOf(e);
  }, dist);
}
async function aimAt(idx) {
  await ev((i) => {
    const e = game.entities.creatures[i];
    const p = game.player.position;
    const dx = e.position.x - p.x, dz = e.position.z - p.z;
    game.cameraRig.yaw = Math.atan2(-dx, -dz);
    game.cameraRig.pitch = -0.1;
  }, idx);
}
const coins0 = await ev(() => game.inventory.count('coin'));
await page.keyboard.press('Digit1');
await wait(400);
let idx = await spawnEnemyInFront(2.2);
await aimAt(idx);
await wait(300);
const hp0 = await ev((i) => game.entities.creatures[i].health.current, idx);
await page.mouse.down();
await wait(250);
await shot('04-sword-swing');
await wait(900);
await page.mouse.up();
const hp1 = await ev((i) => game.entities.creatures[i].health.current, idx);
check('Sword damages enemy', hp1 < hp0, `${hp0} -> ${hp1.toFixed(1)}`);
// Greatsword finishing blows
await page.keyboard.press('Digit2');
await wait(400);
for (let k = 0; k < 4; k++) {
  const alive = await ev((i) => game.entities.creatures[i]?.health.alive, idx);
  if (!alive) break;
  await aimAt(idx);
  await ev(() => { game.player.stamina = 100; });
  await page.mouse.down();
  await wait(650);
  if (k === 0) await shot('05-greatsword-swing');
  await wait(700);
  await page.mouse.up();
}
const dead = await ev(() => game.player.stats.kills);
check('Enemy dies (state DEAD, kill counted)', dead >= 1, `kills=${dead}`);
await wait(1500);
await page.waitForFunction((c) => game.pickups.list.length > 0 || game.inventory.count('coin') > c, coins0, { timeout: 30000 }).catch(() => {});
const loot = await ev(() => [game.pickups.list.length, game.inventory.count('coin')]);
check('Enemy drops loot', loot[0] > 0 || loot[1] > coins0, `pickups=${loot[0]} coins ${coins0}->${loot[1]}`);

// ---- Enemy AI: chase + attack ----
const hpBefore = await ev(() => game.player.health.current);
idx = await spawnEnemyInFront(8);
await ev((i) => { const e = game.entities.creatures[i]; e.stateTime = 0; e.setState('CHASE'); }, idx);
await page.waitForFunction((a) => { const e = game.entities.creatures[a.i]; return e.state === 'ATTACK' || game.player.health.current < a.hp; }, { i: idx, hp: hpBefore }, { timeout: 60000 }).catch(() => {});
const st = await ev((i) => game.entities.creatures[i].state, idx);
const hpAfter = await ev(() => game.player.health.current);
check('Enemy chases/attacks player', hpAfter < hpBefore || st === 'ATTACK', `state=${st} hp ${hpBefore}->${hpAfter.toFixed(0)}`);
await shot('06-enemy-attack');
await ev(() => game.entities.killAllEnemies());
await wait(500);

// ---- Telekinesis ----
await page.keyboard.press('Digit3');
await wait(400);
await ev(() => {
  const g = game;
  const f = g.cameraRig.forward.clone().setY(0).normalize();
  const pos = g.player.position.clone().addScaledVector(f, 3.5);
  pos.y = g.terrain.getHeight(pos.x, pos.z) + 0.5;
  window.__crate = g.props.spawnCrate(pos);
  g.props.spawned.push(window.__crate);
});
await wait(1200);
await ev(() => {
  const c = window.__crate.position, cam = game.camera.position;
  const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
  game.cameraRig.yaw = Math.atan2(-dx, -dz);
  game.cameraRig.pitch = Math.atan2(dy, Math.hypot(dx, dz));
});
const aimCrate = () => ev(() => {
  const c = window.__crate.position, cam = game.camera.position;
  const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
  game.cameraRig.yaw = Math.atan2(-dx, -dz);
  game.cameraRig.pitch = Math.atan2(dy, Math.hypot(dx, dz));
});
await page.waitForFunction(() => game.telekinesis.hovered === window.__crate, null, { timeout: 30000 }).catch(() => {});
check('Telekinesis hover highlight', await ev(() => game.telekinesis.hovered === window.__crate));
await aimCrate();
await page.mouse.down();
await page.waitForFunction(() => game.telekinesis.held === window.__crate, null, { timeout: 20000 }).catch(() => {});
await ev(() => { game.cameraRig.pitch = 0.15; });
await page.waitForFunction(() => window.__crate.position.y > game.terrain.getHeight(window.__crate.position.x, window.__crate.position.z) + 1, null, { timeout: 30000 }).catch(() => {});
check('Telekinesis grab (object held & lifted)', await ev(() => game.telekinesis.held === window.__crate && window.__crate.position.y > game.terrain.getHeight(window.__crate.position.x, window.__crate.position.z) + 1));
await shot('07-telekinesis');
await page.mouse.up();
await page.waitForFunction(() => !game.telekinesis.held, null, { timeout: 20000 }).catch(() => {});
const speed = await ev(() => window.__crate.velocity.length());
check('Telekinesis throw on release', speed > 8, `speed=${speed.toFixed(1)}`);
await wait(1500);

// ---- NPC dialog ----
const placeNearElder = () => ev(() => {
  const v = game.entities.villagers.find((x) => x.profile.title === 'Старейшина');
  v.state = 'IDLE'; v.stateTime = 0; v.idleDuration = 999; v.desiredSpeed = 0; v.velocity.set(0, 0, 0);
  game.entities.killAllEnemies();
  const p = game.player.position;
  p.set(v.position.x + 2, v.position.y, v.position.z);
  game.player.velocity.set(0, 0, 0);
  game.cameraRig.smoothedEye = null;
  game.cameraRig.yaw = Math.atan2(2, 0);
  game.cameraRig.pitch = -0.1;
  return v.name;
});
const talked = await placeNearElder();
for (let i = 0; i < 10; i++) {
  const ok = await page.waitForFunction(() => !!game.interaction.prompt, null, { timeout: 4000 }).then(() => true).catch(() => false);
  if (ok) break;
  await placeNearElder();
}
const prompt = await ev(() => game.interaction.prompt);
check('NPC interaction prompt', !!prompt && prompt.includes('Поговорить'), `"${prompt}"`);
await page.keyboard.press('KeyE');
await page.waitForFunction(() => !!game.dialog.active, null, { timeout: 20000 }).catch(() => {});
check('Dialog opens', await ev(() => !!game.dialog.active), talked);
await shot('08-dialog');
for (let i = 0; i < 14; i++) { if (!(await ev(() => !!game.dialog.active))) break; await page.keyboard.press('KeyE'); await wait(700); }
const dlg = await ev(() => [!!game.dialog.active, game.inventory.count('potion'), game.entities.villagers.find((x) => x.profile.title === 'Старейшина').giftGiven, game.dialog.active?.lineIndex]);
check('Dialog finishes + gift', !dlg[0] && dlg[2], JSON.stringify(dlg));

// ---- Door / chest / campfire interactions ----
// campfire: look at it from 2.5m
const cfBefore = await ev(() => {
  const cf = game.village.campfires[0];
  game.player.position.set(cf.position.x + 2.6, cf.position.y, cf.position.z);
  game.cameraRig.smoothedEye = null;
  game.cameraRig.yaw = Math.atan2(2.6, 0);
  game.cameraRig.pitch = -0.55;
  return cf.lit;
});
await wait(500);
const cfPrompt = await ev(() => game.interaction.prompt);
await page.keyboard.press('KeyE');
await page.waitForFunction((b) => game.village.campfires[0].lit !== b, cfBefore, { timeout: 15000 }).catch(() => {});
const cfAfter = await ev(() => game.village.campfires[0].lit);
check('Campfire toggle', cfBefore !== cfAfter, `prompt="${cfPrompt}"`);
await page.keyboard.press('KeyE');
// chest inside house: use direct interact API to validate loot logic
const chestLoot = await ev(() => {
  const c = game.village.chests[0];
  const before = game.inventory.count('coin');
  c.interact(game);
  return [before, game.inventory.count('coin'), c.opened];
});
check('Chest opens and gives loot', chestLoot[2] && chestLoot[1] > chestLoot[0], JSON.stringify(chestLoot));
const doorState = await ev(() => {
  const d = game.village.doors[0];
  d.interact(game);
  return [d.open, d.collider.enabled];
});
check('Door opens (collider disabled)', doorState[0] && !doorState[1]);

// ---- Door blocks movement when closed ----
const blocked = await ev(() => {
  const d = game.village.doors[0];
  d.interact(game); // close
  const c = d.collider;
  return c.enabled;
});
check('Door closes (collider enabled)', blocked);

// ---- Tree harvesting ----
const wood = await ev(() => {
  const t = game.vegetation.trees.find((t) => !t.felled);
  const before = game.inventory.count('wood');
  game.world.getTreeInteractable(t).interact(game);
  game.world.harvestTree(t, 10);
  return [before, game.inventory.count('wood'), t.felled];
});
check('Tree harvest gives wood & fells tree', wood[1] > wood[0] && wood[2], JSON.stringify(wood));

// ---- Consumables ----
const heal = await ev(() => {
  game.player.health.current = 40;
  game.inventory.select(3);
  return game.player.health.current;
});
await wait(300);
await page.waitForFunction(() => game.weapons.cooldown <= 0, null, { timeout: 20000 }).catch(() => {});
await page.mouse.down(); await wait(400); await page.mouse.up();
await page.waitForFunction((h) => game.player.health.current > h, heal, { timeout: 20000 }).catch(() => {});
const heal2 = await ev(() => game.player.health.current);
check('Potion heals', heal2 > heal, `${heal} -> ${heal2.toFixed(0)}`);

// ---- Stone throwing ----
await page.keyboard.press('Digit6');
await page.waitForFunction(() => game.weapons.cooldown <= 0 && game.weapons.equippedId === 'stone', null, { timeout: 20000 }).catch(() => {});
const stonesBefore = await ev(() => game.inventory.count('stone'));
await page.mouse.down(); await wait(400); await page.mouse.up();
await page.waitForFunction((n) => game.inventory.count('stone') < n, stonesBefore, { timeout: 20000 }).catch(() => {});
check('Throw stone from hotbar', (await ev(() => game.inventory.count('stone'))) === stonesBefore - 1);

// ---- Debug menu ----
await page.keyboard.press('F1');
await wait(300);
check('F1 opens debug menu', await ev(() => game.ui.modal === 'debug'));
const count0 = await ev(() => game.entities.creatures.length);
await page.getByText('Spawn 5 Villagers').click({ force: true });
await page.getByText('Spawn 5 Enemies').click({ force: true });
await page.getByText('Spawn Item').click({ force: true });
await page.getByText('Spawn Enemy', { exact: true }).click({ force: true });
await page.getByText('Spawn Villager', { exact: true }).click({ force: true });
await wait(700);
const count1 = await ev(() => game.entities.creatures.length);
check('Debug spawns creatures', count1 === count0 + 12, `${count0} -> ${count1}`);
await shot('09-debug-menu');
await page.getByText('Clear Spawned Objects').click({ force: true });
await page.waitForFunction((n) => game.entities.creatures.length <= n + 1, count0, { timeout: 15000 }).catch(() => {});
const count2 = await ev(() => game.entities.creatures.length);
check('Clear spawned', count2 <= count0 + 1, `${count1} -> ${count2}`);
await page.getByText('Ночь (23:00)').click({ force: true });
await page.keyboard.press('F1');
await wait(300);
await ev(() => {
  const cf = game.village.campfires[0];
  game.player.position.set(cf.position.x + 7, cf.position.y, cf.position.z + 7);
  game.cameraRig.smoothedEye = null;
  game.cameraRig.yaw = Math.atan2(7, 7);
  game.cameraRig.pitch = -0.1;
  game.inventory.select(2);
});
await wait(1500);
await shot('10-night');
await ev(() => game.dayNight.setHour(18.3));
await wait(800);
await shot('11-sunset');
// ---- Views of the world ----
await ev(() => {
  game.dayNight.setHour(9.5);
  const l = game.world.village; // lakeside view
  game.player.position.set(-5, game.terrain.getHeight(-5, -40), -40);
  game.cameraRig.smoothedEye = null;
  game.cameraRig.yaw = 0.2;
  game.cameraRig.pitch = -0.05;
  game.inventory.select(0);
});
await wait(1500);
await shot('12-lake');
await ev(() => {
  game.player.position.set(40, game.terrain.getHeight(40, 60), 60);
  game.cameraRig.smoothedEye = null;
  game.cameraRig.yaw = -2.4;
  game.cameraRig.pitch = 0;
});
await wait(1500);
await shot('13-forest');

// ---- Death & respawn ----
await ev(() => game.player.health.damage(1000));
await wait(2200);
check('Death screen', await ev(() => game.ui.modal === 'death'));
await shot('14-death');
await page.getByText('Возродиться в деревне').click({ force: true });
await wait(500);
check('Respawn', await ev(() => game.player.health.alive && game.player.health.current === 100 && game.ui.modal === null));

// ---- Pause via Escape ----
await page.keyboard.press('Escape');
await wait(500);
check('Esc opens pause menu', await ev(() => game.ui.modal === 'pause'));
await shot('15-pause');
console.log('modal before resume:', await ev(() => game.ui.modal));
await page.getByText('Продолжить').click({ force: true });
await wait(800);
check('Resume', await ev(() => game.ui.modal === null));

const fps = await ev(() => game.ui.debug.fps);
console.log(results.join('\n'));
console.log(`FPS (swiftshader): ${fps.toFixed(1)}`);
console.log('ERRORS:\n' + ([...new Set(errors.map((e) => e.split('\n')[0]))].join('\n') || 'none'));
await browser.close();
