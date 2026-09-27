import * as THREE from 'three';
import { clamp } from '../core/MathUtils.js';
import { WORLD } from '../world/WorldConfig.js';

const WALK = 4.6, SPRINT = 7.8, CROUCH = 2.3;
const GROUND_ACCEL = 45, AIR_ACCEL = 9, FRICTION = 11;
const JUMP_VELOCITY = 7.4;
const STEP = 0.5;

/** Kinematic character motor: acceleration, gravity, jumping, crouch, swimming, collisions, footsteps. */
export class PlayerController {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.wish = new THREE.Vector3();
    this.result = {};
    this.stepDistance = 0;
  }

  update(dt) {
    const p = this.player;
    const input = this.game.input;
    const rig = this.game.cameraRig;
    const phys = this.game.physics;
    if (!p.health.alive) {
      p.velocity.set(0, 0, 0);
      return;
    }

    // ---- Input -> wish direction (yaw-relative) ----
    let fx = 0, fz = 0;
    if (input.isDown('KeyW')) fz -= 1;
    if (input.isDown('KeyS')) fz += 1;
    if (input.isDown('KeyA')) fx -= 1;
    if (input.isDown('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
    this.wish.set(fx * cos + fz * sin, 0, -fx * sin + fz * cos);

    // ---- Crouch ----
    const wantCrouch = input.isDown('ControlLeft') || input.isDown('ControlRight') || input.isDown('KeyC');
    p.crouching = wantCrouch && !p.swimming;
    const targetEye = p.crouching ? 1.0 : 1.65;
    p.eyeHeight += (targetEye - p.eyeHeight) * Math.min(1, dt * 12);
    p.height = p.crouching ? 1.15 : 1.8;

    // ---- Sprint & stamina ----
    const wantsSprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    p.sprinting = wantsSprint && fz < 0 && !p.crouching && !p.exhausted && p.stamina > 0 && (p.onGround || p.swimming);
    if (p.sprinting) p.useStamina(16 * dt);

    let speed = p.crouching ? CROUCH : p.sprinting ? SPRINT : WALK;
    if (p.inWater) speed *= p.swimming ? 0.6 : 0.75;
    speed *= p.speedMultiplier;

    // ---- Horizontal acceleration ----
    const v = p.velocity;
    const accel = p.onGround || p.swimming ? GROUND_ACCEL : AIR_ACCEL;
    const targetX = this.wish.x * speed, targetZ = this.wish.z * speed;
    if (len > 0) {
      const dx = targetX - v.x, dz = targetZ - v.z;
      const dl = Math.hypot(dx, dz);
      const maxDelta = accel * dt;
      if (dl <= maxDelta) { v.x = targetX; v.z = targetZ; }
      else { v.x += (dx / dl) * maxDelta; v.z += (dz / dl) * maxDelta; }
    } else if (p.onGround || p.swimming) {
      const f = Math.exp(-FRICTION * dt);
      v.x *= f;
      v.z *= f;
    }

    // ---- Vertical: gravity, jump, swim ----
    const wl = WORLD.waterLevel;
    const ground = phys.groundHeight(p.position.x, p.position.z);
    p.inWater = p.position.y < wl - 0.1;
    p.swimming = p.position.y < wl - 1.25;
    if (p.swimming) {
      // buoyancy keeps the head above water
      const targetY = wl - 1.35;
      v.y += (targetY - p.position.y) * 12 * dt;
      v.y *= Math.exp(-4 * dt);
      if (input.isDown('Space')) v.y = Math.max(v.y, 2.2);
    } else {
      v.y += this.game.physics.gravity * dt;
    }
    if (input.wasPressed('Space') && p.onGround && !p.crouching && !p.swimming) {
      if (p.stamina >= 6 || !p.exhausted) {
        v.y = JUMP_VELOCITY;
        p.onGround = false;
        p.useStamina(8);
        this.game.audio.play('jump', { volume: 0.6 });
      }
    }

    // ---- Integrate + collide ----
    const pos = p.position;
    const prevY = pos.y;
    pos.x += v.x * dt;
    pos.z += v.z * dt;
    pos.y += v.y * dt;

    const res = phys.resolveCylinder(pos, p.radius, p.height, STEP, this.result);
    if (res.hit) {
      const nl = Math.hypot(res.nx, res.nz);
      if (nl > 0) {
        const nx = res.nx / nl, nz = res.nz / nl;
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
      }
    }

    // World boundary (soft wall at the mountains)
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD.playRadius) {
      pos.x *= WORLD.playRadius / r;
      pos.z *= WORLD.playRadius / r;
    }

    // Ground: terrain or walkable box tops
    const terrainY = phys.groundHeight(pos.x, pos.z);
    const groundY = Math.max(terrainY, res.groundY);
    const wasGround = p.onGround;
    if (pos.y <= groundY + 0.02 && v.y <= 0.01) {
      if (!wasGround && prevY - groundY > -1) {
        const impact = -v.y;
        if (impact > 4) {
          rigLand(this.game, impact);
          this.game.audio.play('land', { volume: Math.min(1, impact / 12), surface: this.surface(pos, res) });
        }
        if (impact > 15) p.health.damage((impact - 15) * 5, { type: 'fall' });
      }
      pos.y = groundY;
      v.y = 0;
      p.onGround = true;
    } else if (p.onGround && pos.y - groundY < 0.35 && v.y <= 0 && !p.swimming) {
      // stick to ground when walking downhill
      pos.y = groundY;
      v.y = 0;
    } else {
      p.onGround = false;
    }
    if (p.swimming) p.onGround = false;

    // Steep slope sliding
    if (p.onGround && res.groundY < terrainY) {
      const n = this.game.terrain.getNormal(pos.x, pos.z, new THREE.Vector3());
      if (n.y < 0.62) {
        v.x += n.x * 25 * dt;
        v.z += n.z * 25 * dt;
      }
    }
    void ground;

    // Local velocity for camera roll
    p.localVelocity.set(v.x * cos - v.z * sin, 0, v.x * sin + v.z * cos);

    // ---- Footsteps ----
    const hs = Math.hypot(v.x, v.z);
    if ((p.onGround || p.inWater) && hs > 0.8) {
      this.stepDistance += hs * dt;
      const stride = p.sprinting ? 2.4 : p.crouching ? 1.4 : 2.0;
      if (this.stepDistance > stride) {
        this.stepDistance = 0;
        this.game.audio.play('footstep', { surface: this.surface(pos, res), volume: p.crouching ? 0.35 : p.sprinting ? 1 : 0.7 });
      }
    }

    p.stats.distance += hs * dt;
    p.position.y = Math.max(p.position.y, terrainY - 0.01);
    p.speed = clamp(hs, 0, 20);
  }

  surface(pos, res) {
    if (this.player.inWater) return 'water';
    if (res.groundY > this.game.physics.groundHeight(pos.x, pos.z) + 0.05) return 'wood';
    if (pos.y > 25) return 'stone';
    return 'grass';
  }
}

function rigLand(game, impact) {
  game.cameraRig.land(impact);
}
