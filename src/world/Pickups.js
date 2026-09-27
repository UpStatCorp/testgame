import * as THREE from 'three';
import { createItemModel } from '../items/ItemModels.js';
import { getItem } from '../items/ItemDatabase.js';

const ringGeo = new THREE.RingGeometry(0.25, 0.32, 24);
ringGeo.rotateX(-Math.PI / 2);

/** Loose items lying in the world (bobbing, spinning, glowing). Pick up with E; coins auto-collect. */
export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(id, count, position, { debug = false, velocity = null } = {}) {
    const def = getItem(id);
    if (!def) return null;
    const root = new THREE.Group();
    const model = createItemModel(id);
    const s = ['sword', 'greatsword', 'staff'].includes(id) ? 0.9 : id === 'wood' ? 1.1 : 1.6;
    model.scale.multiplyScalar(s);
    if (['sword', 'greatsword', 'staff'].includes(id)) model.rotation.z = Math.PI / 2.3;
    root.add(model);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffe8a0', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.y = -0.18;
    root.add(ring);
    // invisible, larger hit proxy for comfortable aiming
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    root.add(proxy);
    root.position.copy(position);
    this.game.scene.add(root);
    const p = {
      id, count, root, model, ring, debug,
      position: root.position,
      velocity: velocity ? velocity.clone() : new THREE.Vector3(),
      settled: !velocity,
      phase: Math.random() * 10,
      getPrompt: () => `Подобрать: ${def.name}${count > 1 ? ` ×${count}` : ''}`,
      interact: (game) => this.collect(p, game),
    };
    const gh = this.game.terrain.getHeight(position.x, position.z);
    p.baseY = Math.max(position.y, gh + 0.45);
    this.list.push(p);
    this.game.interaction.register(p);
    return p;
  }

  collect(p, game) {
    const left = game.inventory.addItem(p.id, p.count, true);
    if (left === p.count) {
      game.ui.notify('Инвентарь полон');
      return;
    }
    game.audio.play(p.id === 'coin' ? 'coin' : 'pickup');
    game.particles.emit({ position: p.root.position, count: 14, speed: 2, color: '#fff0b0', colorEnd: '#ffa030', size: 0.1, life: 0.5, drag: 3 });
    if (left > 0) {
      p.count = left;
      return;
    }
    this.remove(p);
  }

  remove(p) {
    this.game.scene.remove(p.root);
    this.game.interaction.unregister(p);
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  clearDebug() {
    for (const p of [...this.list]) if (p.debug) this.remove(p);
  }

  update(dt, time) {
    const player = this.game.player;
    for (const p of [...this.list]) {
      if (!p.settled) {
        p.velocity.y -= 18 * dt;
        p.root.position.addScaledVector(p.velocity, dt);
        const gh = this.game.terrain.getHeight(p.root.position.x, p.root.position.z) + 0.45;
        if (p.root.position.y <= gh) {
          p.root.position.y = gh;
          p.baseY = gh;
          p.settled = true;
        }
      } else {
        p.root.position.y = p.baseY + Math.sin(time * 2 + p.phase) * 0.08;
      }
      p.model.rotation.y += dt * 1.2;
      p.ring.material.opacity = 0.35 + Math.sin(time * 3 + p.phase) * 0.15;
      // coins are magnetised to the player
      if (p.id === 'coin' && player.health.alive) {
        const d = p.root.position.distanceTo(player.position.clone().setY(player.position.y + 0.8));
        if (d < 1.4) this.collect(p, this.game);
      }
    }
  }
}
