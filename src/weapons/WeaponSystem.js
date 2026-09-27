import * as THREE from 'three';
import { WEAPONS } from './WeaponDefinitions.js';
import { ViewModel } from './ViewModel.js';
import { getItem, ItemType } from '../items/ItemDatabase.js';
import { smoothstep } from '../core/MathUtils.js';

function samplePose(keys, u) {
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (u >= keys[i].u && u <= keys[i + 1].u) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const t = b.u > a.u ? smoothstep(0, 1, (u - a.u) / (b.u - a.u)) : 1;
  return {
    p: [0, 1, 2].map((i) => a.p[i] + (b.p[i] - a.p[i]) * t),
    r: [0, 1, 2].map((i) => a.r[i] + (b.r[i] - a.r[i]) * t),
  };
}

/**
 * Equips whatever is selected in the hotbar and handles primary use:
 * melee swings (sword/greatsword/fists), staff (telekinesis), consumables, throwing stones.
 */
export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.viewModel = new ViewModel(game.camera);
    this.equippedId = null;
    this.def = WEAPONS.fists;
    this.attacking = false;
    this.attackTime = 0;
    this.cooldown = 0;
    this.swingIndex = 0;
    this.hitDone = false;
    this.swingSoundDone = false;
    this.castBlend = 0;
    this.useAnim = null;
    game.events.on('inventory:changed', () => this.syncEquipped());
  }

  syncEquipped() {
    const slot = this.game.inventory.getSelected();
    const id = slot ? slot.id : null;
    if (id === this.equippedId) return;
    this.equippedId = id;
    this.attacking = false;
    const item = id ? getItem(id) : null;
    if (item && item.weapon) this.def = WEAPONS[item.weapon];
    else if (item) this.def = WEAPONS.item;
    else this.def = WEAPONS.fists;
    this.viewModel.setModel(id || 'fists');
    if (this.def.id !== 'staff') this.game.telekinesis.release(false);
    this.game.audio.play('equip', { volume: 0.6 });
    this.game.events.emit('weapon:equipped', { id, def: this.def });
  }

  get equippedItem() {
    return this.equippedId ? getItem(this.equippedId) : null;
  }

  update(dt) {
    const game = this.game;
    const input = game.input;
    const player = game.player;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const item = this.equippedItem;
    const alive = player.health.alive;

    // ----- primary action -----
    if (alive && this.def.id === 'staff') {
      game.telekinesis.handleInput(input, dt);
    } else if (alive && item && item.type === ItemType.CONSUMABLE) {
      if (input.wasMousePressed(0) && this.cooldown <= 0) this.consume(item);
    } else if (alive && item && item.throwable) {
      if (input.wasMousePressed(0) && this.cooldown <= 0) this.throwStone();
    } else if (alive && (this.def === WEAPONS.fists || item?.type === ItemType.WEAPON)) {
      if (input.isMouseDown(0) && !this.attacking && this.cooldown <= 0) this.startAttack();
    }

    // ----- animation -----
    let pose = this.def.rest;
    if (this.attacking) {
      this.attackTime += dt;
      const u = Math.min(1, this.attackTime / this.def.duration);
      const swings = this.def.swings;
      pose = samplePose(swings[this.swingIndex % swings.length], u);
      if (!this.swingSoundDone && u > this.def.hitTime - 0.18) {
        this.swingSoundDone = true;
        game.audio.play('swing', { heavy: this.def.heavy });
        const rolls = this.def.trailRoll;
        if (rolls) this.viewModel.spawnTrail(this.def, rolls[this.swingIndex % rolls.length]);
        if (this.def.heavy) game.cameraRig.addTrauma(0.15);
      }
      if (!this.hitDone && u >= this.def.hitTime) {
        this.hitDone = true;
        game.combat.meleeAttack(this.def);
      }
      if (u >= 1) {
        this.attacking = false;
        this.swingIndex++;
      }
    } else if (this.useAnim) {
      this.useAnim.t += dt;
      const u = Math.min(1, this.useAnim.t / WEAPONS.item.duration);
      pose = samplePose(WEAPONS.item.swings[0], u);
      if (u >= 1) this.useAnim = null;
    } else if (this.def.id === 'staff') {
      const target = game.telekinesis.held ? 1 : game.telekinesis.hovered ? 0.35 : 0;
      this.castBlend += (target - this.castBlend) * Math.min(1, dt * 8);
      const a = this.def.rest, b = this.def.cast;
      const k = this.castBlend;
      const jitter = game.telekinesis.held ? Math.sin(performance.now() * 0.03) * 0.004 : 0;
      pose = {
        p: [a.p[0] + (b.p[0] - a.p[0]) * k + jitter, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k],
        r: [a.r[0] + (b.r[0] - a.r[0]) * k, a.r[1] + (b.r[1] - a.r[1]) * k, a.r[2] + (b.r[2] - a.r[2]) * k + jitter * 4],
      };
      const crystal = this.viewModel.model?.userData.crystal;
      if (crystal) {
        crystal.rotation.y += dt * (1 + k * 6);
        crystal.material.emissiveIntensity = 1.8 + k * 3 + Math.sin(performance.now() * 0.004) * 0.4;
      }
    }
    // sprinting lowers the weapon a bit
    if (player.sprinting && !this.attacking) {
      pose = { p: [pose.p[0] + 0.05, pose.p[1] - 0.06, pose.p[2] + 0.05], r: [pose.r[0] + 0.25, pose.r[1] + 0.2, pose.r[2]] };
    }
    this.viewModel.root.visible = alive;
    this.viewModel.update(dt, pose, game.cameraRig, player);
  }

  startAttack() {
    const player = this.game.player;
    if (!player.hasStamina(this.def.stamina)) {
      this.game.ui.flashStamina();
      return;
    }
    player.useStamina(this.def.stamina);
    this.attacking = true;
    this.attackTime = 0;
    this.hitDone = false;
    this.swingSoundDone = false;
    this.cooldown = this.def.cooldown;
  }

  consume(item, slotIndex = this.game.inventory.selected) {
    const game = this.game;
    const p = game.player;
    if (item.heal && p.health.current >= p.health.max && !item.stamina) {
      game.ui.notify('Здоровье уже полное');
      return;
    }
    game.inventory.removeFromSlot(slotIndex, 1);
    if (item.heal) p.health.heal(item.heal);
    if (item.regen) p.health.addRegen(item.regen, 10);
    if (item.stamina) p.stamina = Math.min(p.maxStamina, p.stamina + item.stamina);
    game.audio.play(item.id === 'potion' ? 'drink' : 'eat');
    game.audio.play('heal', { volume: 0.5 });
    const pos = p.position.clone().add(new THREE.Vector3(0, 1, 0));
    game.particles.heal(pos);
    game.ui.notify(`Использовано: ${item.name}`);
    game.events.emit('player:healed');
    this.useAnim = { t: 0 };
    this.cooldown = 0.6;
  }

  throwStone() {
    const game = this.game;
    game.inventory.removeFromSlot(game.inventory.selected, 1);
    const dir = game.cameraRig.forward.clone();
    const pos = game.camera.position.clone().addScaledVector(dir, 0.8);
    pos.y -= 0.15;
    const body = game.props.spawnStone(pos, 0.2);
    body.velocity.copy(dir).multiplyScalar(22).add(game.player.velocity);
    body.velocity.y += 2;
    body.thrownBy = 'player';
    body.dangerTime = 1.5;
    body.angular.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    game.audio.play('throw', { volume: 0.5 });
    this.useAnim = { t: 0 };
    this.cooldown = 0.45;
  }
}
