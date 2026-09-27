import * as THREE from 'three';
import { Creature } from './Creature.js';
import { buildForestCreatureModel, makeNameSprite, HealthBar3D } from './CreatureModels.js';
import { mulberry32, angleDiff } from '../core/MathUtils.js';
import { WORLD } from '../world/WorldConfig.js';

export const EnemyState = { IDLE: 'IDLE', PATROL: 'PATROL', CHASE: 'CHASE', ATTACK: 'ATTACK', DEAD: 'DEAD' };

const VARIANTS = {
  forest: { name: 'Лесная тварь', hp: 80, damage: 13, walk: 1.6, run: 4.6, attackRange: 2.0, sight: 20, radius: 0.45, height: 1.7, windup: 0.45, recover: 0.7, loot: 4 },
  brute: { name: 'Древний Шатун', hp: 220, damage: 26, walk: 1.3, run: 3.7, attackRange: 2.8, sight: 24, radius: 0.7, height: 2.5, windup: 0.75, recover: 1.0, loot: 12 },
};

/**
 * Hostile "Forest Creature" with an explicit state machine:
 * IDLE -> PATROL (random waypoints near home) -> CHASE (sees player) -> ATTACK (wind-up, strike, recover) -> DEAD.
 */
export class ForestCreature extends Creature {
  constructor(game, position, variant = 'forest', seed = Math.floor(Math.random() * 1e6)) {
    const v = VARIANTS[variant];
    super(game, position, { radius: v.radius, height: v.height, maxHp: v.hp, walkSpeed: v.walk, runSpeed: v.run });
    this.variant = variant;
    this.cfg = v;
    this.name = v.name;
    this.rand = mulberry32(seed);
    this.rig = buildForestCreatureModel(this.rand, variant);
    this.root.add(this.rig.root);
    this.home = position.clone();
    this.state = EnemyState.IDLE;
    this.stateTime = 0;
    this.idleDuration = 1 + this.rand() * 2;
    this.attackPhase = 'windup';
    this.attackHitDone = false;
    this.lostSightTime = 0;
    this.alertTime = 0;
    this.growlTimer = 2 + this.rand() * 6;
    this.deathTime = 0;
    this.hurtAnim = 0;

    this.healthBar = new HealthBar3D(v.radius > 0.5 ? 1.3 : 0.9);
    this.healthBar.group.position.y = v.height + 0.35;
    this.healthBar.group.visible = false;
    this.root.add(this.healthBar.group);
    this.label = makeNameSprite(v.name, '', variant === 'brute' ? '#ff9a6a' : '#e8f0a0');
    this.label.scale.set(1.6, 0.4, 1);
    this.label.position.y = v.height + 0.62;
    this.label.visible = false;
    this.root.add(this.label);
  }

  get isEnemy() {
    return true;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    if (s === EnemyState.ATTACK) {
      this.attackPhase = 'windup';
      this.attackHitDone = false;
      this.game.audio.play('creatureAttack', { position: this.position });
    }
    if (s === EnemyState.CHASE && this.alertTime <= 0) {
      this.alertTime = 8;
      this.game.audio.play('growl', { position: this.position, pitch: this.variant === 'brute' ? 0.7 : 1 });
      this.game.events.emit('enemy:alert', this);
    }
  }

  canSeePlayer() {
    const player = this.game.player;
    if (!player.health.alive) return false;
    const eye = this.position.clone();
    eye.y += this.height * 0.8;
    const target = player.position.clone();
    target.y += player.eyeHeight;
    const to = target.clone().sub(eye);
    const dist = to.length();
    const sight = this.cfg.sight * (player.crouching ? 0.6 : 1) * (this.game.dayNight.isNight ? 1.15 : 1);
    if (dist > sight) return false;
    // field of view (wide) unless player is very close or making noise (sprinting)
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flat = to.clone().setY(0).normalize();
    const close = dist < (player.sprinting ? 12 : 6);
    if (!close && fwd.dot(flat) < -0.2) return false;
    return this.game.physics.raycastStatic(eye, to.normalize(), dist) === Infinity;
  }

  pickPatrolTarget() {
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 4 + this.rand() * 18;
      const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (this.game.terrain.getHeight(x, z) < WORLD.waterLevel + 0.3) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return this.home.clone();
  }

  onDamaged(amount) {
    this.hurtAnim = 1;
    this.healthBar.visibleTime = 6;
    this.game.audio.play('creatureHurt', { position: this.position });
    this.game.ui.damageNumber(this.position.clone().setY(this.position.y + this.height + 0.2), amount);
    if (this.state === EnemyState.IDLE || this.state === EnemyState.PATROL) this.setState(EnemyState.CHASE);
    this.lostSightTime = 0;
  }

  onDeath(src) {
    this.setState(EnemyState.DEAD);
    this.desiredSpeed = 0;
    this.game.audio.play('creatureDie', { position: this.position });
    this.game.player.stats.kills++;
    this.game.events.emit('enemy:killed', this);
    this.label.visible = false;
    this.healthBar.group.visible = false;
    void src;
  }

  dropLoot() {
    const pos = this.position.clone().setY(this.position.y + 0.8);
    const coins = Math.floor(this.cfg.loot * (0.5 + this.rand()));
    const rnd = () => new THREE.Vector3((this.rand() - 0.5) * 3, 4 + this.rand() * 2, (this.rand() - 0.5) * 3);
    if (coins > 0) this.game.pickups.spawn('coin', coins, pos, { velocity: rnd(), debug: this.spawnedByDebug });
    if (this.rand() < 0.45) this.game.pickups.spawn('wood', 1 + Math.floor(this.rand() * 2), pos, { velocity: rnd(), debug: this.spawnedByDebug });
    if (this.rand() < 0.25) this.game.pickups.spawn('food', 1, pos, { velocity: rnd(), debug: this.spawnedByDebug });
    if (this.rand() < (this.variant === 'brute' ? 0.8 : 0.12)) this.game.pickups.spawn('potion', 1, pos, { velocity: rnd(), debug: this.spawnedByDebug });
  }

  update(dt) {
    super.update(dt);
    this.stateTime += dt;
    if (this.alertTime > 0) this.alertTime -= dt;
    const player = this.game.player;
    const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
    const distXZ = Math.hypot(toPlayer.x, toPlayer.z);

    switch (this.state) {
      case EnemyState.IDLE:
        this.desiredSpeed = 0;
        if (this.canSeePlayer()) this.setState(EnemyState.CHASE);
        else if (this.stateTime > this.idleDuration) {
          this.moveTarget = this.pickPatrolTarget();
          this.setState(EnemyState.PATROL);
        }
        break;

      case EnemyState.PATROL:
        this.desiredSpeed = this.walkSpeed;
        if (this.canSeePlayer()) this.setState(EnemyState.CHASE);
        else if (!this.moveTarget || Math.hypot(this.moveTarget.x - this.position.x, this.moveTarget.z - this.position.z) < 0.8 || this.stuckTime > 2) {
          this.stuckTime = 0;
          this.idleDuration = 1.5 + this.rand() * 3;
          this.setState(EnemyState.IDLE);
        }
        break;

      case EnemyState.CHASE: {
        if (!player.health.alive) {
          this.setState(EnemyState.PATROL);
          this.moveTarget = this.pickPatrolTarget();
          break;
        }
        this.desiredSpeed = this.runSpeed;
        // Sidestep around obstacles when stuck
        if (this.stuckTime > 0.6) {
          const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize().multiplyScalar(this.rand() < 0.5 ? 3 : -3);
          this.detour = this.position.clone().add(side);
          this.detourTime = 0.8;
          this.stuckTime = 0;
        }
        if (this.detourTime > 0) {
          this.detourTime -= dt;
          this.moveTarget = this.detour;
        } else {
          this.moveTarget = player.position.clone();
        }
        const sees = this.canSeePlayer();
        this.lostSightTime = sees ? 0 : this.lostSightTime + dt;
        if (distXZ < this.cfg.attackRange && Math.abs(toPlayer.y) < 2) this.setState(EnemyState.ATTACK);
        else if (distXZ > 40 || this.lostSightTime > 6) {
          this.moveTarget = this.home.clone();
          this.setState(EnemyState.PATROL);
        }
        break;
      }

      case EnemyState.ATTACK: {
        this.desiredSpeed = 0;
        this.faceTowards(player.position, dt, this.attackPhase === 'windup' ? 8 : 1);
        const c = this.cfg;
        if (this.attackPhase === 'windup' && this.stateTime > c.windup) {
          this.attackPhase = 'strike';
          this.stateTime = 0;
        } else if (this.attackPhase === 'strike') {
          if (!this.attackHitDone && this.stateTime > 0.08) {
            this.attackHitDone = true;
            const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
            const flat = toPlayer.clone().setY(0);
            const d = flat.length();
            if (d < c.attackRange + 0.6 && fwd.dot(flat.normalize()) > 0.3 && Math.abs(toPlayer.y) < 2.2 && player.health.alive) {
              player.health.damage(c.damage * (0.85 + this.rand() * 0.3), { type: 'enemy', from: this });
              player.velocity.addScaledVector(fwd, this.variant === 'brute' ? 9 : 5);
              player.velocity.y += 2.5;
              this.game.particles.blood(player.position.clone().setY(player.position.y + 1.2), fwd, '#a02020');
              this.game.audio.play('hit', { heavy: this.variant === 'brute', metal: false });
            }
            // brute slam shakes the ground
            if (this.variant === 'brute') {
              this.game.particles.dust(this.position.clone().add(fwd.clone().multiplyScalar(1.5)), 20);
              if (player.position.distanceTo(this.position) < 8) this.game.cameraRig.addTrauma(0.35);
            }
          }
          if (this.stateTime > 0.25) {
            this.attackPhase = 'recover';
            this.stateTime = 0;
          }
        } else if (this.attackPhase === 'recover' && this.stateTime > c.recover) {
          this.setState(distXZ < c.attackRange ? EnemyState.ATTACK : EnemyState.CHASE);
          if (this.state === EnemyState.ATTACK) { this.stateTime = 0; this.attackPhase = 'windup'; this.attackHitDone = false; }
        }
        break;
      }

      case EnemyState.DEAD:
        this.desiredSpeed = 0;
        this.deathTime += dt;
        if (this.deathTime > 1.0 && !this.lootDropped) {
          this.lootDropped = true;
          this.dropLoot();
          this.game.particles.deathPuff(this.position.clone().setY(this.position.y + 0.6));
        }
        if (this.deathTime > 2.2) this.root.position.y -= dt * 0.8;
        if (this.deathTime > 4.5) this.dispose();
        break;
    }

    // Growls while roaming/chasing
    this.growlTimer -= dt;
    if (this.growlTimer <= 0 && this.state !== EnemyState.DEAD) {
      this.growlTimer = 4 + this.rand() * 8;
      this.game.audio.play('growl', { position: this.position, pitch: (this.variant === 'brute' ? 0.7 : 1) * (0.9 + this.rand() * 0.2), volume: 0.7 });
    }

    if (this.state !== EnemyState.DEAD) {
      this.steer(dt);
      this.physicsStep(dt);
    } else if (this.deathTime < 2.2) {
      this.velocity.x *= 0.9;
      this.velocity.z *= 0.9;
      this.physicsStep(dt);
    }
    this.animate(dt);
    this.updateUI(dt, distXZ);
  }

  animate(dt) {
    const r = this.rig;
    const sp = this.animSpeed;
    const run = sp > 2.5;
    this.animPhase += dt * (sp > 0.1 ? sp * (run ? 2.2 : 3.2) : 0);
    const ph = this.animPhase;
    const t = performance.now() * 0.001;
    const swing = Math.min(1, sp / 1.5) * (run ? 0.8 : 0.5);
    r.legs[0].rotation.x = Math.sin(ph) * swing;
    r.legs[1].rotation.x = -Math.sin(ph) * swing;
    r.hips.position.y = 0.95 + Math.abs(Math.sin(ph)) * 0.06 * Math.min(1, sp);
    r.torso.rotation.x = 0.35 + (run ? 0.25 : 0) + Math.sin(t * 1.5) * 0.03;
    r.arms[0].shoulder.rotation.x = Math.sin(ph) * swing * 0.7 - 0.2;
    r.arms[1].shoulder.rotation.x = -Math.sin(ph) * swing * 0.7 - 0.2;
    r.arms[0].fore.rotation.x = -0.4;
    r.arms[1].fore.rotation.x = -0.4;
    r.jaw.rotation.x = 0.1 + Math.max(0, Math.sin(t * 2.3)) * 0.1;
    r.head.rotation.x = -0.35 + Math.sin(t * 1.2) * 0.05;

    if (this.state === EnemyState.ATTACK) {
      const p = this.attackPhase;
      const k = p === 'windup' ? Math.min(1, this.stateTime / this.cfg.windup) : p === 'strike' ? 1 - Math.min(1, this.stateTime / 0.25) : 0;
      if (p === 'windup') {
        r.arms[0].shoulder.rotation.x = -2.6 * k;
        r.arms[1].shoulder.rotation.x = -2.6 * k;
        r.torso.rotation.x = 0.35 - 0.5 * k;
        r.jaw.rotation.x = 0.1 + 0.5 * k;
      } else if (p === 'strike') {
        r.arms[0].shoulder.rotation.x = -2.6 * k + (1 - k) * 0.6;
        r.arms[1].shoulder.rotation.x = -2.6 * k + (1 - k) * 0.6;
        r.torso.rotation.x = 0.35 + 0.4 * (1 - k);
      } else {
        r.torso.rotation.x = 0.6;
        r.arms[0].shoulder.rotation.x = 0.4;
        r.arms[1].shoulder.rotation.x = 0.4;
      }
    }
    if (this.state === EnemyState.DEAD) {
      const k = Math.min(1, this.deathTime / 0.9);
      this.rig.root.rotation.x = -k * Math.PI * 0.47;
      this.rig.root.position.y = k * 0.25;
      r.eyeMat.emissiveIntensity = 3 * (1 - k);
    }
    // Hurt flinch + flash
    if (this.hurtAnim > 0) {
      this.hurtAnim = Math.max(0, this.hurtAnim - dt * 4);
      r.torso.rotation.x -= this.hurtAnim * 0.4;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      r.barkMat.emissive.setRGB(this.flash * 0.9, this.flash * 0.25, this.flash * 0.1);
    }
    // idle look-around
    if (this.state === EnemyState.IDLE) r.neck.rotation.y = Math.sin(t * 0.8 + this.animPhase) * 0.6;
    else r.neck.rotation.y *= 0.9;
    void angleDiff;
  }

  updateUI(dt, dist) {
    const hb = this.healthBar;
    if (hb.visibleTime > 0) hb.visibleTime -= dt;
    const show = this.state !== EnemyState.DEAD && dist < 30 && (hb.visibleTime > 0 || this.state === EnemyState.CHASE || this.state === EnemyState.ATTACK);
    hb.group.visible = show;
    this.label.visible = show || (dist < 12 && this.state !== EnemyState.DEAD);
    if (show) {
      hb.set(this.health.ratio, dt);
      // billboard: counter-rotate the creature's yaw, then face camera
      hb.group.quaternion.copy(this.root.quaternion).invert().multiply(this.game.camera.quaternion);
    }
  }
}
