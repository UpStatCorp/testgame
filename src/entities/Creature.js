import * as THREE from 'three';
import { Health } from './Health.js';
import { angleDiff } from '../core/MathUtils.js';
import { WORLD } from '../world/WorldConfig.js';

/** Base class for living things: movement w/ collisions, facing, knockback, health, floating UI. */
export class Creature {
  constructor(game, position, { radius = 0.4, height = 1.8, maxHp = 100, walkSpeed = 1.6, runSpeed = 4 } = {}) {
    this.game = game;
    this.root = new THREE.Group();
    this.position = this.root.position;
    this.position.copy(position);
    this.velocity = new THREE.Vector3();
    this.knockback = new THREE.Vector3();
    this.radius = radius;
    this.height = height;
    this.walkSpeed = walkSpeed;
    this.runSpeed = runSpeed;
    this.yaw = Math.random() * Math.PI * 2;
    this.onGround = true;
    this.moveTarget = null;
    this.desiredSpeed = 0;
    this.animPhase = Math.random() * 10;
    this.animSpeed = 0;
    this.stuckTime = 0;
    this.flash = 0;
    this.lastBodyHitTime = 0;
    this.removed = false;
    this.spawnedByDebug = false;
    this.health = new Health(maxHp, {
      onDamage: (amt, src) => this.onDamaged(amt, src),
      onDeath: (src) => this.onDeath(src),
    });
    this.result = {};
    game.scene.add(this.root);
  }

  get isEnemy() {
    return false;
  }

  /** Steer toward moveTarget at desiredSpeed (set by AI). */
  steer(dt) {
    let vx = 0, vz = 0;
    if (this.moveTarget && this.desiredSpeed > 0) {
      const dx = this.moveTarget.x - this.position.x;
      const dz = this.moveTarget.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.2) {
        vx = (dx / d) * this.desiredSpeed;
        vz = (dz / d) * this.desiredSpeed;
        const targetYaw = Math.atan2(dx, dz);
        this.yaw += angleDiff(this.yaw, targetYaw) * Math.min(1, dt * 7);
      }
    }
    // smooth acceleration
    const a = Math.min(1, dt * 8);
    this.velocity.x += (vx - this.velocity.x) * a;
    this.velocity.z += (vz - this.velocity.z) * a;
  }

  faceTowards(target, dt, rate = 6) {
    const targetYaw = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    this.yaw += angleDiff(this.yaw, targetYaw) * Math.min(1, dt * rate);
  }

  physicsStep(dt) {
    const p = this.position;
    const before = p.clone();
    // knockback decays
    p.x += (this.velocity.x + this.knockback.x) * dt;
    p.z += (this.velocity.z + this.knockback.z) * dt;
    this.knockback.multiplyScalar(Math.exp(-6 * dt));

    // Avoid deep water (walk around lakes)
    const h = this.game.terrain.getHeight(p.x, p.z);
    if (h < WORLD.waterLevel - 0.6 && this.health.alive) {
      p.x = before.x;
      p.z = before.z;
      this.stuckTime += dt * 3;
    }
    const res = this.game.physics.resolveCylinder(p, this.radius, this.height, 0.45, this.result);
    const ground = Math.max(this.game.terrain.getHeight(p.x, p.z), res.groundY);
    this.velocity.y += this.game.physics.gravity * dt;
    p.y += this.velocity.y * dt;
    if (p.y <= ground) {
      p.y = ground;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (p.y - ground < 0.4 && this.velocity.y <= 0) {
      p.y = ground;
      this.velocity.y = 0;
    } else this.onGround = false;

    const r = Math.hypot(p.x, p.z);
    if (r > WORLD.playRadius) {
      p.x *= WORLD.playRadius / r;
      p.z *= WORLD.playRadius / r;
    }
    // Stuck detection (AI can pick another target)
    const moved = Math.hypot(p.x - before.x, p.z - before.z);
    if (this.desiredSpeed > 0.5 && moved < this.desiredSpeed * dt * 0.3) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    this.root.rotation.y = this.yaw;
    this.animSpeed = Math.hypot(this.velocity.x, this.velocity.z);
  }

  takeHit(damage, knock, info = {}) {
    if (!this.health.alive) return;
    this.knockback.add(knock);
    this.velocity.y = Math.max(this.velocity.y, knock.length() * 0.25);
    this.flash = 1;
    this.lastHitInfo = info;
    this.health.damage(damage, info);
    this.game.events.emit('creature:hit', { creature: this, damage });
  }

  onDamaged() {}
  onDeath() {}

  update(dt) {
    this.health.update(dt);
    if (this.lastBodyHitTime > 0) this.lastBodyHitTime -= dt;
  }

  dispose() {
    this.removed = true;
    this.game.scene.remove(this.root);
    this.game.interaction.unregister(this);
  }
}
