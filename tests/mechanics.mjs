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
// Frame time on the software renderer is 0.8-1.8 s, so never rely on fixed durations:
// act, then wait (up to 20 s) for the expected game state.
const until = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
async function holdKeysUntil(keys, fn, arg) {
  for (const k of keys) await page.keyboard.down(k);
  const ok = await until(fn, arg);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  return ok;
}
async function pressUntil(key, fn, arg) {
  await page.keyboard.press(key);
  return until(fn, arg);
}
async function holdMouseUntil(fn, arg) {
  await page.mouse.down();
  const ok = await until(fn, arg);
  await page.mouse.up();
  return ok;
}

await page.goto(base + '?autostart&lite');
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 180000 });
// Tests drive the camera directly: disable real pointer lock so synthetic mouse moves don't rotate it
await page.evaluate(() => { game.input.requestLock = () => {}; if (document.pointerLockElement) { game.ui.intentionalUnlock = true; document.exitPointerLock(); } });
await until(() => game.playerBody.loaded && game.player.onGround);

// ---- Player body (first-person full body) ----
check('Player body loaded', await ev(() => game.playerBody.loaded && !game.playerBody.failed && game.playerBody.hiddenBones.length === 5), JSON.stringify(await ev(() => ({ loaded: game.playerBody.loaded, hidden: game.playerBody.hiddenBones.length }))));
check('Player body idle when standing', await ev(() => game.playerBody.current === 'Idle'));
let runInfo = null;
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
const ran = await until(() => game.playerBody.current === 'Run');
runInfo = await ev(() => ({ anim: game.playerBody.current, speed: Math.hypot(game.player.velocity.x, game.player.velocity.z).toFixed(2) }));
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
check('Player body switches Idle -> Run above speed threshold', ran, JSON.stringify(runInfo));
await until(() => game.playerBody.current === 'Idle');

// ---- Movement ----
const p0 = await ev(() => game.player.position.toArray());
await holdKeysUntil(['KeyW'], (p0) => Math.hypot(game.player.position.x - p0[0], game.player.position.z - p0[2]) > 1.0, p0);
const p1 = await ev(() => game.player.position.toArray());
const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
check('WASD movement', moved > 1.0, `moved ${moved.toFixed(2)}m`);
const sprinting = await holdKeysUntil(['ShiftLeft', 'KeyW'], () => game.player.sprinting);
check('Sprint', sprinting);
await until(() => game.player.onGround && Math.hypot(game.player.velocity.x, game.player.velocity.z) < 0.5);
// Jump: hold Space until the player leaves the ground, then wait for landing
const airborne = await holdKeysUntil(['Space'], () => !game.player.onGround);
check('Jump', airborne);
await until(() => game.player.onGround);
const crouch = await holdKeysUntil(['KeyC'], () => game.player.crouching === true);
check('Crouch', crouch);
await until(() => !game.player.crouching);

// ---- Inventory ----
await pressUntil('Tab', () => game.ui.modal === 'inventory');
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
await until(() => !game.inventory.slots[3] && game.inventory.slots[12]?.id === 'potion');
const moveOk = await ev(() => !game.inventory.slots[3] && game.inventory.slots[12]?.id === 'potion');
check('Inventory drag & drop', moveOk);
// move it back
await page.mouse.move(to.x + 29, to.y + 29);
await page.mouse.down();
await page.mouse.move(from.x + 29, from.y + 29, { steps: 8 });
await page.mouse.up();
await until(() => game.inventory.slots[3]?.id === 'potion');
await pressUntil('Tab', () => game.ui.modal === null);
check('Inventory closes with TAB', await ev(() => game.ui.modal === null));

// ---- Hotbar & weapons ----
for (const [key, id] of [['Digit1', 'sword'], ['Digit2', 'greatsword'], ['Digit3', 'staff']]) {
  await pressUntil(key, (id) => game.weapons.equippedId === id, id);
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
await pressUntil('Digit1', () => game.weapons.equippedId === 'sword');
let idx = await spawnEnemyInFront(2.2);
await aimAt(idx);
await until(() => game.cameraRig.forward.y < 0); // camera updated with the aim
const hp0 = await ev((i) => game.entities.creatures[i].health.current, idx);
await holdMouseUntil((a) => game.entities.creatures[a.i].health.current < a.hp, { i: idx, hp: hp0 });
await shot('04-sword-swing');
const hp1 = await ev((i) => game.entities.creatures[i].health.current, idx);
check('Sword damages enemy', hp1 < hp0, `${hp0} -> ${hp1.toFixed(1)}`);
// Greatsword finishing blows
await pressUntil('Digit2', () => game.weapons.equippedId === 'greatsword');
const victim = await ev((i) => { window.__victim = game.entities.creatures[i]; return true; }, idx);
for (let k = 0; k < 8 && victim; k++) {
  if (!(await ev(() => window.__victim.health.alive))) break;
  await aimAt(idx);
  await ev(() => { game.player.stamina = 100; });
  const hpK = await ev(() => window.__victim.health.current);
  // one swing: hold until the hit lands (or the creature dies), then wait for the swing to finish
  await holdMouseUntil((h) => !window.__victim.health.alive || window.__victim.health.current < h, hpK);
  if (k === 0) await shot('05-greatsword-swing');
  await until(() => !game.weapons.attacking && game.weapons.cooldown <= 0);
}
const dead = await ev(() => game.player.stats.kills);
check('Enemy dies (state DEAD, kill counted)', dead >= 1, `kills=${dead}`);
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

// ---- Telekinesis ----
await pressUntil('Digit3', () => game.weapons.equippedId === 'staff');
await ev(() => {
  const g = game;
  const f = g.cameraRig.forward.clone().setY(0).normalize();
  const pos = g.player.position.clone().addScaledVector(f, 3.5);
  pos.y = g.terrain.getHeight(pos.x, pos.z) + 0.5;
  window.__crate = g.props.spawnCrate(pos);
  g.props.spawned.push(window.__crate);
});
await until(() => window.__crate.sleeping || (window.__crate.onGround && window.__crate.velocity.length() < 0.3));
const aimCrate = () => ev(() => {
  const c = window.__crate.position, cam = game.camera.position;
  const dx = c.x - cam.x, dy = c.y - cam.y, dz = c.z - cam.z;
  game.cameraRig.yaw = Math.atan2(-dx, -dz);
  game.cameraRig.pitch = Math.atan2(dy, Math.hypot(dx, dz));
});
await aimCrate();
await until(() => game.telekinesis.hovered === window.__crate);
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
// each E either finishes the typewriter line, shows the next line, or closes the dialog
for (let i = 0; i < 20; i++) {
  const prev = await ev(() => game.dialog.active ? { full: game.dialog.full, done: game.dialog.shown >= game.dialog.full.length } : null);
  if (!prev) break;
  await pressUntil('KeyE', (p) => !game.dialog.active || game.dialog.full !== p.full || (!p.done && game.dialog.shown >= game.dialog.full.length), prev);
}
const dlg = await ev(() => [!!game.dialog.active, game.inventory.count('potion'), game.entities.villagers.find((x) => x.profile.title === 'Старейшина').giftGiven, game.dialog.active?.lineIndex]);
check('Dialog finishes + gift', !dlg[0] && dlg[2], JSON.stringify(dlg));

// ---- Door / chest / campfire interactions ----
// campfire: look at it from 2.5m
const cfBefore = await ev(() => {
  const cf = game.village.campfires[0];
  // keep villagers out of the line of sight (the elder idles next to this fire)
  for (const v of game.entities.villagers) {
    if (v.position.distanceTo(cf.position) < 6) { v.position.set(cf.position.x - 8, v.position.y, cf.position.z - 8); v.home = v.position.clone(); v.state = 'IDLE'; v.idleDuration = 999; v.desiredSpeed = 0; }
  }
  game.player.position.set(cf.position.x + 2.6, cf.position.y, cf.position.z);
  game.cameraRig.smoothedEye = null;
  game.cameraRig.yaw = Math.atan2(2.6, 0);
  game.cameraRig.pitch = -0.55;
  return cf.lit;
});
await until(() => (game.interaction.prompt || '').includes('костёр'));
const cfPrompt = await ev(() => game.interaction.prompt);
await pressUntil('KeyE', (b) => game.village.campfires[0].lit !== b, cfBefore);
const cfAfter = await ev(() => game.village.campfires[0].lit);
check('Campfire toggle', (cfPrompt || '').includes('костёр') && cfBefore !== cfAfter, `prompt="${cfPrompt}" lit ${cfBefore}->${cfAfter}`);
await pressUntil('KeyE', (b) => game.village.campfires[0].lit === b, cfBefore); // restore
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
await until(() => !game.dialog.active);
const [heal, potions0] = await ev(() => {
  game.player.health.current = 40;
  game.inventory.select(3);
  return [game.player.health.current, game.inventory.count('potion')];
});
await until(() => game.weapons.equippedId === 'potion' && game.weapons.cooldown <= 0);
await holdMouseUntil((n) => game.inventory.count('potion') < n, potions0);
const [heal2, potions1] = await ev(() => [game.player.health.current, game.inventory.count('potion')]);
// the potion must actually be consumed (+50 HP); regeneration alone must not pass this check
check('Potion heals', potions1 === potions0 - 1 && heal2 >= heal + 45, `hp ${heal} -> ${heal2.toFixed(0)}, potions ${potions0} -> ${potions1}`);

// ---- Stone throwing ----
await pressUntil('Digit6', () => game.weapons.cooldown <= 0 && game.weapons.equippedId === 'stone');
const stonesBefore = await ev(() => game.inventory.count('stone'));
await holdMouseUntil((n) => game.inventory.count('stone') < n, stonesBefore);
check('Throw stone from hotbar', (await ev(() => game.inventory.count('stone'))) === stonesBefore - 1);

// ---- Debug menu ----
await pressUntil('F1', () => game.ui.modal === 'debug');
check('F1 opens debug menu', await ev(() => game.ui.modal === 'debug'));
// Count only debug-spawned creatures: the ambient spawner may add/remove forest creatures
// at any time (every 15 s of game time it tops the population up), which used to give 8 -> 21.
const debugCounts = () => ev(() => {
  const d = game.entities.spawnedDebug.filter((c) => !c.removed);
  return { villagers: d.filter((c) => !c.isEnemy).length, enemies: d.filter((c) => c.isEnemy).length, items: game.pickups.list.filter((p) => p.debug).length };
});
const d0 = await debugCounts();
await page.getByText('Spawn 5 Villagers').click({ force: true });
await page.getByText('Spawn 5 Enemies').click({ force: true });
await page.getByText('Spawn Item').click({ force: true });
await page.getByText('Spawn Enemy', { exact: true }).click({ force: true });
await page.getByText('Spawn Villager', { exact: true }).click({ force: true });
await until((d) => game.entities.spawnedDebug.filter((c) => !c.removed).length >= d.villagers + d.enemies + 12, d0);
const d1 = await debugCounts();
check('Debug spawns creatures', d1.villagers === d0.villagers + 6 && d1.enemies === d0.enemies + 6 && d1.items === d0.items + 1, `${JSON.stringify(d0)} -> ${JSON.stringify(d1)}`);
await shot('09-debug-menu');
await page.getByText('Clear Spawned Objects').click({ force: true });
await until(() => game.entities.spawnedDebug.length === 0 && !game.entities.creatures.some((c) => c.spawnedByDebug && !c.removed));
const d2 = await debugCounts();
check('Clear spawned', d2.villagers === 0 && d2.enemies === 0 && d2.items === 0, `${JSON.stringify(d1)} -> ${JSON.stringify(d2)}`);
await page.getByText('Ночь (23:00)').click({ force: true });
await pressUntil('F1', () => game.ui.modal === null);
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
await until(() => game.ui.modal === 'death');
check('Death screen', await ev(() => game.ui.modal === 'death'));
await shot('14-death');
await page.getByText('Возродиться в деревне').click({ force: true });
await until(() => game.player.health.alive && game.ui.modal === null);
check('Respawn', await ev(() => game.player.health.alive && game.player.health.current === 100 && game.ui.modal === null));

// ---- Pause via Escape ----
await pressUntil('Escape', () => game.ui.modal === 'pause');
check('Esc opens pause menu', await ev(() => game.ui.modal === 'pause'));
await shot('15-pause');
console.log('modal before resume:', await ev(() => game.ui.modal));
await page.getByText('Продолжить').click({ force: true });
await until(() => game.ui.modal === null);
check('Resume', await ev(() => game.ui.modal === null));

const fps = await ev(() => game.ui.debug.fps);
console.log(results.join('\n'));
console.log(`FPS (swiftshader): ${fps.toFixed(1)}`);
console.log('ERRORS:\n' + ([...new Set(errors.map((e) => e.split('\n')[0]))].join('\n') || 'none'));
await browser.close();
