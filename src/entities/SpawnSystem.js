import * as THREE from 'three';
import { Villager } from './Villager.js';
import { ForestCreature } from './ForestCreature.js';
import { VILLAGER_PROFILES, RANDOM_NAMES, RANDOM_LINES } from './VillagerData.js';
import { WORLD } from '../world/WorldConfig.js';
import { ITEMS } from '../items/ItemDatabase.js';

/**
 * Owns all creatures. Spawns the initial villagers, keeps a roaming enemy population in the forest
 * (bigger at night), and provides debug spawn commands (F1 menu).
 */
export class SpawnSystem {
  constructor(game) {
    this.game = game;
    this.creatures = [];
    this.ambientTimer = 5;
    this.spawnedDebug = [];
  }

  get villagers() {
    return this.creatures.filter((c) => !c.isEnemy && !c.removed);
  }
  get enemies() {
    return this.creatures.filter((c) => c.isEnemy && !c.removed);
  }

  init() {
    const v = WORLD.village;
    VILLAGER_PROFILES.forEach((profile, i) => {
      const a = (i / VILLAGER_PROFILES.length) * Math.PI * 2 + 0.4;
      const r = 5 + (i % 3) * 3;
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      const pos = new THREE.Vector3(x, this.game.terrain.getHeight(x, z), z);
      if (profile.title === 'Рыбак') {
        pos.set(WORLD.lake.x - 12, 0, WORLD.lake.z + 34);
        pos.y = this.game.terrain.getHeight(pos.x, pos.z);
      }
      const villager = new Villager(this.game, pos, { ...profile, wanderRadius: profile.title === 'Рыбак' ? 6 : 13 }, 1000 + i * 17);
      if (profile.title === 'Рыбак') villager.home = pos.clone();
      else villager.home = new THREE.Vector3(v.x, 0, v.z);
      this.creatures.push(villager);
    });
    // Initial enemy population
    for (let i = 0; i < 6; i++) this.spawnAmbientEnemy(true);
    // one brute guarding the rune stones
    const rs = this.game.village.runeCircle;
    if (rs) this.addEnemy(new THREE.Vector3(rs.x + 3, rs.y, rs.z + 3), 'brute');
  }

  addEnemy(pos, variant = 'forest', debug = false) {
    pos.y = this.game.terrain.getHeight(pos.x, pos.z);
    const e = new ForestCreature(this.game, pos, variant);
    e.spawnedByDebug = debug;
    this.creatures.push(e);
    if (debug) this.spawnedDebug.push(e);
    return e;
  }

  addVillager(pos, debug = false) {
    pos.y = this.game.terrain.getHeight(pos.x, pos.z);
    const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    const female = /[аяе]$/.test(name);
    const lines = RANDOM_LINES[Math.floor(Math.random() * RANDOM_LINES.length)];
    const v = new Villager(this.game, pos, { name, title: 'Путник', female, lines, wanderRadius: 10 });
    v.home = pos.clone();
    v.spawnedByDebug = debug;
    this.creatures.push(v);
    if (debug) this.spawnedDebug.push(v);
    return v;
  }

  /** Valid ground position in front of the player (for debug spawns). */
  pointNearPlayer(minD = 6, maxD = 12) {
    const p = this.game.player.position;
    const fwd = this.game.cameraRig.forward;
    const baseAng = Math.atan2(fwd.x, fwd.z);
    for (let i = 0; i < 30; i++) {
      const a = baseAng + (Math.random() - 0.5) * 1.6;
      const d = minD + Math.random() * (maxD - minD);
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (this.game.terrain.getHeight(x, z) < WORLD.waterLevel + 0.2) continue;
      const test = new THREE.Vector3(x, this.game.terrain.getHeight(x, z), z);
      const res = this.game.physics.resolveCylinder(test.clone(), 0.5, 1.8, 0.45, {});
      if (res.hit) continue;
      return test;
    }
    return new THREE.Vector3(p.x + fwd.x * 4, p.y, p.z + fwd.z * 4);
  }

  spawnAmbientEnemy(initial = false) {
    const player = this.game.player.position;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 50 + Math.random() * 110;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.game.terrain.getHeight(x, z);
      if (h < WORLD.waterLevel + 0.5 || h > 30) continue;
      if (!initial && Math.hypot(x - player.x, z - player.z) < 40) continue;
      if (Math.hypot(x - WORLD.village.x, z - WORLD.village.z) < WORLD.village.radius + 12) continue;
      const variant = this.game.dayNight.isNight && Math.random() < 0.25 ? 'brute' : 'forest';
      return this.addEnemy(new THREE.Vector3(x, h, z), variant);
    }
    return null;
  }

  // ----- Debug commands -----
  debugSpawnVillager(n = 1) {
    for (let i = 0; i < n; i++) this.addVillager(this.pointNearPlayer(4, 10), true);
    this.game.audio.play('spawn');
  }
  debugSpawnEnemy(n = 1, variant = 'forest') {
    for (let i = 0; i < n; i++) {
      const e = this.addEnemy(this.pointNearPlayer(9, 16), variant, true);
      this.game.particles.deathPuff(e.position.clone().setY(e.position.y + 0.5));
    }
    this.game.audio.play('spawn');
  }
  debugSpawnItem() {
    const ids = Object.keys(ITEMS);
    const id = ids[Math.floor(Math.random() * ids.length)];
    const pos = this.pointNearPlayer(2, 4);
    pos.y += 1.5;
    const count = ITEMS[id].stackSize > 1 ? 1 + Math.floor(Math.random() * Math.min(5, ITEMS[id].stackSize)) : 1;
    this.game.pickups.spawn(id, count, pos, { debug: true, velocity: new THREE.Vector3(0, 3, 0) });
    this.game.audio.play('spawn');
    return id;
  }
  debugSpawnProp() {
    const pos = this.pointNearPlayer(3, 6);
    pos.y += 2;
    const r = Math.random();
    const b = r < 0.4 ? this.game.props.spawnCrate(pos) : r < 0.7 ? this.game.props.spawnBarrel(pos) : this.game.props.spawnStone(pos, 0.3 + Math.random() * 0.4);
    this.game.props.spawned.push(b);
    this.game.audio.play('spawn');
  }
  clearSpawned() {
    for (const c of this.spawnedDebug) if (!c.removed) c.dispose();
    this.spawnedDebug = [];
    this.game.pickups.clearDebug();
    for (const b of [...this.game.props.spawned]) this.game.props.removeBody(b);
    this.game.audio.play('uiClose');
  }
  killAllEnemies() {
    for (const c of this.creatures) if (c.isEnemy && c.health.alive) c.health.damage(99999);
  }

  update(dt) {
    const player = this.game.player;
    const cam = this.game.camera.position;
    for (const c of this.creatures) {
      if (c.removed) continue;
      c.update(dt);
      // distance culling (fog hides them anyway)
      if (!c.removed) c.root.visible = c.position.distanceToSquared(cam) < 120 * 120;
    }
    // remove disposed
    for (let i = this.creatures.length - 1; i >= 0; i--) if (this.creatures[i].removed) this.creatures.splice(i, 1);

    // Separation between creatures + player
    const cs = this.creatures;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (!a.health.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (!b.health.alive) continue;
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (rr - d) * 0.5;
          a.position.x -= (dx / d) * push; a.position.z -= (dz / d) * push;
          b.position.x += (dx / d) * push; b.position.z += (dz / d) * push;
        }
      }
      // player
      if (player.health.alive) {
        const dx = player.position.x - a.position.x, dz = player.position.z - a.position.z;
        const rr = a.radius + player.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6 && Math.abs(player.position.y - a.position.y) < a.height) {
          const d = Math.sqrt(d2);
          const push = rr - d;
          player.position.x += (dx / d) * push * 0.7;
          player.position.z += (dz / d) * push * 0.7;
          a.position.x -= (dx / d) * push * 0.3;
          a.position.z -= (dz / d) * push * 0.3;
        }
      }
    }
    // Player pushes physics props when walking into them
    for (const b of this.game.physics.bodies) {
      if (b.held) continue;
      const dx = b.position.x - player.position.x, dz = b.position.z - player.position.z;
      const rr = b.radius + player.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && b.position.y < player.position.y + player.height && b.position.y + b.radius > player.position.y && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const push = rr - d;
        b.position.x += nx * push;
        b.position.z += nz * push;
        const pv = player.velocity.x * nx + player.velocity.z * nz;
        if (pv > 0) {
          b.velocity.x += nx * pv * 1.2 / b.mass;
          b.velocity.z += nz * pv * 1.2 / b.mass;
        }
        this.game.physics.wake(b);
      }
    }

    // Keep an ambient enemy population
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 15;
      const target = this.game.dayNight.isNight ? 10 : 6;
      const ambient = this.creatures.filter((c) => c.isEnemy && !c.spawnedByDebug && c.health.alive).length;
      if (ambient < target) this.spawnAmbientEnemy();
    }
  }
}
