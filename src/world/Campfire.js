import * as THREE from 'three';
import { makeRockGeometry, mergeChildrenByMaterial } from './ProceduralModels.js';

const stoneGeo = makeRockGeometry(901, 0);
const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
const logMat = new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.9 });
const charMat = new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 1, emissive: '#ff4010', emissiveIntensity: 0 });

/** Interactive campfire: stone ring, logs, flame particles, flickering light, crackle audio. */
export class Campfire {
  constructor(game, position, lit, scale = 1, withLight = true) {
    this.game = game;
    this.position = position.clone();
    this.scale = scale;
    this.lit = lit;
    this.root = new THREE.Group();
    this.root.position.copy(position);
    this.root.scale.setScalar(scale);
    game.scene.add(this.root);

    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(stoneGeo, stoneMat);
      s.position.set(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
      s.scale.set(0.22, 0.2, 0.18);
      s.rotation.y = a;
      s.castShadow = s.receiveShadow = true;
      this.root.add(s);
    }
    const logGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.0, 6);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(logGeo, logMat);
      const a = (i / 4) * Math.PI * 2;
      l.position.set(Math.cos(a) * 0.2, 0.38, Math.sin(a) * 0.2);
      const dir = new THREE.Vector3(-Math.cos(a) * 0.55, 1, -Math.sin(a) * 0.55).normalize();
      l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      l.castShadow = true;
      this.root.add(l);
    }
    this.embers = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), charMat.clone());
    this.embers.rotation.x = -Math.PI / 2;
    this.embers.position.y = 0.03;
    this.root.add(this.embers);
    // Seating logs around the fire
    for (const a of [0.4, 2.5, 4.4]) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 8), logMat);
      seat.position.set(Math.cos(a) * 2.1, 0.2, Math.sin(a) * 2.1);
      seat.rotation.set(0, -a, Math.PI / 2);
      seat.castShadow = seat.receiveShadow = true;
      this.root.add(seat);
      const wx = position.x + Math.cos(a) * 2.1 * scale, wz = position.z + Math.sin(a) * 2.1 * scale;
      game.physics.addBox(wx, wz, 0.2 * scale, 0.8 * scale, -a + Math.PI / 2, position.y - 1, position.y + 0.42 * scale, { kind: 'seat' });
    }
    game.physics.addCircle(position.x, position.z, 0.6 * scale, position.y - 1, position.y + 0.5, { kind: 'campfire' });

    mergeChildrenByMaterial(this.root);
    this.light = null;
    if (withLight) {
      this.light = new THREE.PointLight('#ff9040', 0, 16 * scale, 1.6);
      this.light.position.set(0, 1.0, 0);
      this.root.add(this.light);
    }
    this.flicker = 0;
    this.emitAcc = 0;
    this.crackleTimer = 0;
  }

  getPrompt() {
    return this.lit ? 'Потушить костёр' : 'Разжечь костёр';
  }

  interact(game) {
    this.lit = !this.lit;
    game.audio.play(this.lit ? 'ignite' : 'extinguish', { position: this.position });
    if (!this.lit) game.particles.dust(this.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 20, '#777777');
  }

  update(dt, time) {
    const target = this.lit ? 1 : 0;
    this.flicker += (target - this.flicker) * Math.min(1, dt * 3);
    const f = this.flicker;
    const n = Math.sin(time * 13.1) * 0.12 + Math.sin(time * 7.3 + 1) * 0.1 + Math.sin(time * 23.7) * 0.05;
    if (this.light) this.light.intensity = f * (18 + n * 12) * this.scale;
    this.embers.material.emissiveIntensity = f * (1.5 + n * 2);

    const cam = this.game.camera.position;
    const dist = cam.distanceTo(this.position);
    if (f > 0.05 && dist < 90) {
      this.emitAcc += dt * 40 * f;
      const p = this.game.particles;
      const base = this.position;
      while (this.emitAcc > 1) {
        this.emitAcc -= 1;
        p.emit({ position: new THREE.Vector3(base.x, base.y + 0.25 * this.scale, base.z), box: 0.22 * this.scale, boxY: 0.05, count: 1, dir: new THREE.Vector3(0, 1, 0), spread: 0.12, speed: 1.6 * this.scale, color: '#ffd070', colorEnd: '#ff3a08', size: 0.55 * this.scale, sizeEnd: 0.2, life: 0.75, drag: 0.5, gravity: 1.2, alpha: 0.9 });
        if (Math.random() < 0.12) p.emit({ position: new THREE.Vector3(base.x, base.y + 0.4, base.z), box: 0.2, count: 1, dir: new THREE.Vector3(0, 1, 0), spread: 0.4, speed: 3, color: '#ffb040', colorEnd: '#ff2000', size: 0.06, life: 1.6, gravity: 0.6, drag: 0.3, swirl: 6 });
        if (Math.random() < 0.15) p.emit({ position: new THREE.Vector3(base.x, base.y + 1.1 * this.scale, base.z), box: 0.15, count: 1, dir: new THREE.Vector3(0.15, 1, 0), spread: 0.15, speed: 1.1, color: '#3a3430', colorEnd: '#8a8480', size: 0.6, sizeEnd: 3.5, life: 3.5, drag: 0.4, additive: false, alpha: 0.28, fadeIn: 0.4 });
      }
      this.crackleTimer -= dt;
      if (this.crackleTimer <= 0 && dist < 25) {
        this.crackleTimer = 0.08 + Math.random() * 0.35;
        this.game.audio.play('crackle', { position: this.position, volume: 0.6 * f });
      }
    }
  }
}
