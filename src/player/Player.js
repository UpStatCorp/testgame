import * as THREE from 'three';
import { Health } from '../entities/Health.js';
import { WORLD } from '../world/WorldConfig.js';

/** Player state: transform, vitals (HP/stamina), death + respawn. */
export class Player {
  constructor(game) {
    this.game = game;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.localVelocity = new THREE.Vector3();
    this.radius = 0.35;
    this.height = 1.8;
    this.eyeHeight = 1.65;
    this.onGround = false;
    this.crouching = false;
    this.sprinting = false;
    this.inWater = false;
    this.swimming = false;
    this.speed = 0;
    this.speedMultiplier = 1;
    this.maxStamina = 100;
    this.stamina = 100;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.deathTimer = 0;
    this.godMode = false;
    this.stats = { distance: 0, kills: 0 };

    this.health = new Health(100, {
      regenRate: 2.5,
      regenDelay: 6,
      onDamage: (amount, source) => {
        game.events.emit('player:damaged', { amount, source });
        game.cameraRig.addTrauma(Math.min(0.6, amount / 30));
        game.audio.play('hurt');
      },
      onDeath: () => this.die(),
    });
    this.spawnPoint = new THREE.Vector3(WORLD.spawn.x, 0, WORLD.spawn.z);
  }

  spawn() {
    const t = this.game.terrain;
    this.position.set(this.spawnPoint.x, t.getHeight(this.spawnPoint.x, this.spawnPoint.z), this.spawnPoint.z);
    this.velocity.set(0, 0, 0);
    this.health.reset();
    this.stamina = this.maxStamina;
    this.exhausted = false;
    // Face north toward the village and the lake
    this.game.cameraRig.yaw = 0.15;
    this.game.cameraRig.pitch = -0.05;
    this.game.cameraRig.smoothedEye = null;
  }

  useStamina(amount) {
    if (this.godMode) return true;
    if (this.stamina <= 0) return false;
    this.stamina = Math.max(0, this.stamina - amount);
    this.staminaDelay = 1.0;
    if (this.stamina <= 0) this.exhausted = true;
    return true;
  }

  hasStamina(amount) {
    return this.godMode || (!this.exhausted && this.stamina >= amount * 0.5);
  }

  die() {
    this.deathTimer = 0;
    this.game.audio.play('death');
    this.game.events.emit('player:died');
    this.game.telekinesis?.release(false);
  }

  respawn() {
    this.spawn();
    this.game.events.emit('player:respawned');
  }

  update(dt) {
    this.health.invulnerable = this.godMode;
    this.health.update(dt);
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else this.stamina = Math.min(this.maxStamina, this.stamina + 24 * dt);
    if (this.exhausted && this.stamina > 25) this.exhausted = false;
    // Warmth: standing near a lit fire accelerates healing
    if (this.health.alive) {
      for (const cf of this.game.village.campfires) {
        if (cf.lit && cf.position.distanceTo(this.position) < 4) this.health.heal(3 * dt);
      }
    }
    if (!this.health.alive) this.deathTimer += dt;
  }
}
