import * as THREE from 'three';
import { Creature } from './Creature.js';
import { buildVillagerModel, makeNameSprite } from './CreatureModels.js';
import { mulberry32 } from '../core/MathUtils.js';
import { WORLD } from '../world/WorldConfig.js';

const State = { IDLE: 'IDLE', WANDER: 'WANDER', TALK: 'TALK', GREET: 'GREET', FLEE: 'FLEE' };

/** Friendly NPC: wanders around home, idles, greets & faces the player, talks, flees from enemies. */
export class Villager extends Creature {
  constructor(game, position, profile, seed = Math.floor(Math.random() * 1e6)) {
    super(game, position, { radius: 0.35, height: 1.8, maxHp: 100, walkSpeed: 1.4, runSpeed: 4.2 });
    this.profile = profile;
    this.name = profile.name;
    this.rand = mulberry32(seed);
    this.rig = buildVillagerModel(this.rand, profile);
    this.root.add(this.rig.root);
    this.home = position.clone();
    this.wanderRadius = profile.wanderRadius ?? 14;
    this.state = State.IDLE;
    this.stateTime = 0;
    this.idleDuration = 1 + this.rand() * 3;
    this.lookYaw = 0;
    this.greeted = false;
    this.lineIndex = 0;
    this.giftGiven = false;
    this.voicePitch = profile.female ? 1.35 : profile.elder ? 0.8 : 1;
    this.wave = 0;
    this.health.invulnerable = true; // villagers can be startled but not killed

    this.nameSprite = makeNameSprite(profile.name, profile.title || 'Житель');
    this.nameSprite.position.y = 2.25;
    this.nameSprite.visible = false;
    this.root.add(this.nameSprite);

    game.interaction.register(this);
  }

  getPrompt() {
    return `Поговорить: ${this.name}`;
  }

  interact(game) {
    game.dialog.open(this);
  }

  /** Next line of dialogue, or null when finished. */
  nextLine() {
    const lines = this.profile.lines;
    if (this.lineIndex >= lines.length) return null;
    const line = lines[this.lineIndex++];
    return line;
  }

  onDialogEnd() {
    this.lineIndex = 0;
    if (this.profile.gift && !this.giftGiven) {
      this.giftGiven = true;
      this.game.inventory.addItem(this.profile.gift.id, this.profile.gift.count, true);
      this.game.ui.notify(this.profile.gift.line);
      this.game.audio.play('pickup');
    }
    this.setState(State.IDLE);
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  takeHit(damage, knock, info) {
    super.takeHit(damage, knock.multiplyScalar(0.5), info);
    this.game.audio.play('villagerHi', { position: this.position, pitch: this.voicePitch * 1.4 });
    this.game.ui.floatingText(this, ['Ай! Осторожнее!', 'Эй! Я же свой!', 'Ты что творишь?!'][Math.floor(Math.random() * 3)]);
    this.fleeFrom = this.game.player.position.clone();
    this.setState(State.FLEE);
  }

  pickWanderTarget() {
    for (let i = 0; i < 10; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 2 + this.rand() * this.wanderRadius;
      const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (this.game.terrain.getHeight(x, z) < WORLD.waterLevel + 0.3) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return this.home.clone();
  }

  nearestEnemy(maxDist) {
    let best = null, bd = maxDist;
    for (const c of this.game.entities.creatures) {
      if (!c.isEnemy || !c.health.alive) continue;
      const d = c.position.distanceTo(this.position);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  update(dt) {
    super.update(dt);
    this.stateTime += dt;
    const player = this.game.player;
    const toPlayer = player.position.distanceTo(this.position);
    const talking = this.game.dialog.active === this;

    if (talking && this.state !== State.TALK) this.setState(State.TALK);

    // Threat check
    const enemy = this.state !== State.TALK ? this.nearestEnemy(9) : null;
    if (enemy && this.state !== State.FLEE) {
      this.fleeFrom = enemy.position.clone();
      this.setState(State.FLEE);
      if (Math.random() < 0.5) this.game.ui.floatingText(this, 'Помогите! Тварь!');
    }

    switch (this.state) {
      case State.IDLE:
        this.desiredSpeed = 0;
        // Look around idly
        this.lookYaw = Math.sin(this.stateTime * 0.7 + this.animPhase) * 0.5;
        if (toPlayer < 5 && player.health.alive) {
          this.faceTowards(player.position, dt, 3);
          this.lookYaw = 0;
          if (!this.greeted) {
            this.greeted = true;
            this.setState(State.GREET);
          }
        }
        if (toPlayer > 12) this.greeted = false;
        if (this.state === State.IDLE && this.stateTime > this.idleDuration && toPlayer > 4) {
          this.moveTarget = this.pickWanderTarget();
          this.setState(State.WANDER);
        }
        break;
      case State.GREET:
        this.desiredSpeed = 0;
        this.faceTowards(player.position, dt, 6);
        if (this.stateTime < 0.05) {
          this.game.audio.play('villagerHi', { position: this.position, pitch: this.voicePitch });
          if (Math.random() < 0.6) this.game.ui.floatingText(this, 'Привет, путник!');
        }
        this.wave = Math.min(1, this.wave + dt * 4);
        if (this.stateTime > 1.8) {
          this.setState(State.IDLE);
          this.idleDuration = 3 + this.rand() * 3;
        }
        break;
      case State.WANDER:
        this.desiredSpeed = this.walkSpeed;
        if (!this.moveTarget || this.position.distanceTo(this.moveTarget.clone().setY(this.position.y)) < 0.6 || this.stuckTime > 1.5 || this.stateTime > 20) {
          this.stuckTime = 0;
          this.setState(State.IDLE);
          this.idleDuration = 2 + this.rand() * 5;
          this.desiredSpeed = 0;
        }
        if (toPlayer < 3 && player.health.alive) {
          this.setState(State.IDLE);
        }
        break;
      case State.TALK:
        this.desiredSpeed = 0;
        this.faceTowards(player.position, dt, 8);
        this.lookYaw = 0;
        if (!talking) this.setState(State.IDLE);
        break;
      case State.FLEE: {
        const away = this.position.clone().sub(this.fleeFrom || this.position).setY(0);
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        away.normalize().multiplyScalar(6);
        this.moveTarget = this.position.clone().add(away);
        this.desiredSpeed = this.runSpeed;
        if (this.stateTime > 4 && !this.nearestEnemy(12)) {
          this.setState(State.IDLE);
          this.moveTarget = null;
        }
        break;
      }
    }
    if (this.state !== State.GREET) this.wave = Math.max(0, this.wave - dt * 3);

    this.steer(dt);
    this.physicsStep(dt);
    this.animate(dt);
    this.nameSprite.visible = toPlayer < 9;
  }

  animate(dt) {
    const r = this.rig;
    const sp = this.animSpeed;
    const run = sp > 2.5;
    this.animPhase += dt * (sp > 0.1 ? sp * (run ? 2.6 : 3.8) : 0);
    const swing = Math.min(1, sp / 1.4) * (run ? 0.9 : 0.55);
    const ph = this.animPhase;
    r.legs[0].rotation.x = Math.sin(ph) * swing;
    r.legs[1].rotation.x = -Math.sin(ph) * swing;
    r.arms[0].shoulder.rotation.x = -Math.sin(ph) * swing * 0.9;
    r.arms[1].shoulder.rotation.x = Math.sin(ph) * swing * 0.9;
    r.arms[0].fore.rotation.x = -0.2 - (run ? 0.8 : 0.1);
    r.arms[1].fore.rotation.x = -0.2 - (run ? 0.8 : 0.1);
    r.arms[0].shoulder.rotation.z = -0.08;
    r.arms[1].shoulder.rotation.z = 0.08;
    // Wave (right arm)
    if (this.wave > 0) {
      r.arms[1].shoulder.rotation.z = 0.08 + this.wave * 2.4;
      r.arms[1].shoulder.rotation.x = 0;
      r.arms[1].fore.rotation.z = Math.sin(performance.now() * 0.012) * 0.5 * this.wave;
    } else r.arms[1].fore.rotation.z = 0;
    // Talking gestures
    if (this.state === State.TALK) {
      r.arms[0].shoulder.rotation.x = -0.4 + Math.sin(performance.now() * 0.004) * 0.25;
      r.arms[0].fore.rotation.x = -0.9;
      r.head.rotation.x = Math.sin(performance.now() * 0.006) * 0.06;
    }
    // bob + breathing
    r.hips.position.y = 0.92 + Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, sp) + Math.sin(performance.now() * 0.002 + this.animPhase) * 0.008;
    r.torso.rotation.x = run ? 0.2 : 0.03;
    r.neck.rotation.y += (this.lookYaw - r.neck.rotation.y) * Math.min(1, dt * 3);
  }
}
