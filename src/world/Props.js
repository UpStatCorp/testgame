import * as THREE from 'three';
import { mulberry32 } from '../core/MathUtils.js';
import { WORLD } from './WorldConfig.js';
import { makeRockGeometry } from './ProceduralModels.js';
import { Textures, texturedBox } from './Textures.js';
import { distanceToPaths } from './Terrain.js';

const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
const stoneGeos = [0, 1, 2, 3, 4].map((i) => makeRockGeometry(700 + i, 0));

/**
 * Dynamic physics props (stones, crates, barrels, logs, pumpkins). All of them can be pushed,
 * hit with weapons and lifted with telekinesis; small stones can also be picked up with E.
 */
export class Props {
  constructor(game) {
    this.game = game;
    this.rand = mulberry32(WORLD.seed + 31);
    this.crateMat = new THREE.MeshStandardMaterial({ map: Textures.planks([150, 105, 60]), roughness: 0.85 });
    this.barrelMat = new THREE.MeshStandardMaterial({ map: Textures.planks([120, 80, 45]), roughness: 0.8 });
    this.bandMat = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.5, metalness: 0.6 });
    this.logMat = new THREE.MeshStandardMaterial({ color: '#5b3d26', roughness: 0.9 });
    this.pumpkinMat = new THREE.MeshStandardMaterial({ color: '#d8751e', roughness: 0.6 });
    this.spawned = [];
  }

  populate(exclusions) {
    const rand = this.rand;
    const t = this.game.terrain;
    // Loose stones scattered around the world (+ a cluster near spawn for quick testing)
    let n = 0, attempts = 0;
    while (n < 45 && attempts < 3000) {
      attempts++;
      const a = rand() * Math.PI * 2, r = 8 + Math.sqrt(rand()) * 150;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = t.getHeight(x, z);
      if (h < WORLD.waterLevel + 0.3 || h > 30) continue;
      if (exclusions.some((e) => Math.hypot(e.x - x, e.z - z) < e.r)) continue;
      this.spawnStone(new THREE.Vector3(x, h + 0.5, z), 0.18 + rand() * 0.25);
      n++;
    }
    const s = WORLD.spawn;
    for (let i = 0; i < 6; i++) {
      const x = s.x + 5 + rand() * 4, z = s.z - 6 - rand() * 5;
      this.spawnStone(new THREE.Vector3(x, t.getHeight(x, z) + 0.5, z), 0.22 + rand() * 0.25);
    }
    // Village crates / barrels / pumpkins
    const v = WORLD.village;
    const spots = [[7, 9], [8, 10.2], [7.5, 10.8], [-10, 6], [-10.8, 7.2], [12, -3], [-4, -12], [-5, -12.6], [3, 14], [-13, -2]];
    spots.forEach(([dx, dz], i) => {
      const x = v.x + dx, z = v.z + dz;
      const y = t.getHeight(x, z);
      if (distanceToPaths(x, z) < 1.2) return;
      if (i % 3 === 0) this.spawnBarrel(new THREE.Vector3(x, y + 0.5, z));
      else if (i % 3 === 1) this.spawnCrate(new THREE.Vector3(x, y + 0.5, z));
      else this.spawnPumpkin(new THREE.Vector3(x, y + 0.4, z));
    });
    // crates near spawn to toss around with telekinesis
    this.spawnCrate(new THREE.Vector3(s.x - 5, t.getHeight(s.x - 5, s.z - 3) + 0.5, s.z - 3));
    this.spawnBarrel(new THREE.Vector3(s.x - 6.2, t.getHeight(s.x - 6.2, s.z - 1.5) + 0.5, s.z - 1.5));
    this.spawnPumpkin(new THREE.Vector3(s.x + 3, t.getHeight(s.x + 3, s.z - 2) + 0.5, s.z - 2));
  }

  makeBody(mesh, opts) {
    const body = {
      mesh,
      position: mesh.position,
      quaternion: mesh.quaternion,
      radius: opts.radius,
      mass: opts.mass,
      restitution: opts.restitution ?? 0.3,
      friction: opts.friction ?? 2.5,
      buoyancy: opts.buoyancy ?? 0.3,
      material: opts.material || 'stone',
      rollFactor: opts.rollFactor ?? 1,
      name: opts.name,
      tk: true,
    };
    mesh.userData.body = body;
    this.game.scene.add(mesh);
    this.game.physics.addBody(body);
    if (opts.pickupItem) {
      body.pickupItem = opts.pickupItem;
      body.root = mesh;
      body.getPrompt = () => `Подобрать: ${opts.name}`;
      body.interact = (game) => this.pickupBody(body, game);
      this.game.interaction.register(body);
    }
    return body;
  }

  pickupBody(body, game) {
    const left = game.inventory.addItem(body.pickupItem, 1, true);
    if (left > 0) {
      game.ui.notify('Инвентарь полон');
      return;
    }
    game.audio.play('pickup');
    this.removeBody(body);
  }

  removeBody(body) {
    if (this.game.telekinesis.held === body) this.game.telekinesis.release(false);
    this.game.physics.removeBody(body);
    this.game.interaction.unregister(body);
    body.mesh.parent?.remove(body.mesh);
    const i = this.spawned.indexOf(body);
    if (i >= 0) this.spawned.splice(i, 1);
  }

  spawnStone(pos, radius = 0.25) {
    const geo = stoneGeos[Math.floor(Math.random() * stoneGeos.length)];
    const mesh = new THREE.Mesh(geo, stoneMat);
    mesh.scale.set(radius, radius * 1.2, radius);
    mesh.position.copy(pos);
    mesh.castShadow = radius > 0.3;
    mesh.receiveShadow = true;
    return this.makeBody(mesh, { radius: radius * 0.95, mass: 1 + radius * 8, restitution: 0.25, name: 'Камень', pickupItem: radius < 0.5 ? 'stone' : null, material: 'stone', buoyancy: 0.1 });
  }

  spawnCrate(pos) {
    const s = 0.8;
    const mesh = new THREE.Mesh(texturedBox(s, s, s, 0.8), this.crateMat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(s + 0.02, 0.08, s + 0.02), this.bandMat);
    frame.position.y = s / 2 - 0.06;
    const frame2 = frame.clone();
    frame2.position.y = -s / 2 + 0.06;
    mesh.add(frame, frame2);
    mesh.position.copy(pos);
    mesh.castShadow = mesh.receiveShadow = true;
    return this.makeBody(mesh, { radius: 0.45, mass: 3, restitution: 0.2, friction: 5, material: 'wood', name: 'Ящик', rollFactor: 0.25, buoyancy: 0.8 });
  }

  spawnBarrel(pos) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 12), this.barrelMat);
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.55, 12), this.barrelMat);
    mesh.add(mid);
    for (const y of [-0.35, 0.35]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.06, 12), this.bandMat);
      band.position.y = y;
      mesh.add(band);
    }
    mesh.position.copy(pos);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.traverse((o) => { o.castShadow = true; });
    return this.makeBody(mesh, { radius: 0.48, mass: 2.5, restitution: 0.25, friction: 4, material: 'wood', name: 'Бочка', rollFactor: 0.4, buoyancy: 0.9 });
  }

  spawnPumpkin(pos) {
    const geo = new THREE.SphereGeometry(0.35, 12, 8);
    geo.scale(1, 0.75, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 - 0.08 * Math.abs(Math.sin(a * 4));
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.pumpkinMat);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.15, 5), this.logMat);
    stem.position.y = 0.3;
    mesh.add(stem);
    mesh.position.copy(pos);
    mesh.castShadow = mesh.receiveShadow = true;
    return this.makeBody(mesh, { radius: 0.34, mass: 1.5, restitution: 0.35, material: 'wood', name: 'Тыква', buoyancy: 0.9 });
  }

  spawnLog(pos, dir) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 1.6, 8), this.logMat);
    mesh.rotation.z = Math.PI / 2;
    mesh.rotation.y = Math.atan2(dir.x, dir.z);
    mesh.position.copy(pos);
    mesh.castShadow = mesh.receiveShadow = true;
    const body = this.makeBody(mesh, { radius: 0.5, mass: 4, restitution: 0.15, friction: 5, material: 'wood', name: 'Бревно', rollFactor: 0.5, buoyancy: 1.0 });
    body.pickupItem = 'wood';
    body.pickupCount = 3;
    body.root = mesh;
    body.getPrompt = () => 'Разрубить бревно (+3 древесины)';
    body.interact = (game) => {
      game.inventory.addItem('wood', 3, true);
      game.audio.play('hitWood', { position: body.position });
      game.particles.woodChips(body.position.clone(), new THREE.Vector3(0, 1, 0));
      this.removeBody(body);
    };
    this.game.interaction.register(body);
    return body;
  }
}
