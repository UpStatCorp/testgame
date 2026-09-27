import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { Sky } from './Sky.js';
import { DayNightCycle } from './DayNightCycle.js';
import { Water } from './Water.js';
import { Village } from './Village.js';
import { Vegetation } from './Vegetation.js';
import { Atmosphere } from './Atmosphere.js';
import { windUniforms } from './ProceduralModels.js';
import { WORLD } from './WorldConfig.js';

/** Builds and updates the whole environment. Steps are exposed so loading can report progress. */
export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.treeInteractables = new Map();
  }

  buildTerrain() {
    const g = this.game;
    g.terrain = this.terrain = new Terrain();
    this.scene.add(this.terrain.mesh);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    g.dayNight = this.dayNight = new DayNightCycle(this.scene, this.sky, g.renderer, g.quality);
    this.water = new Water(this.terrain, this.dayNight);
    this.scene.add(this.water.mesh);
  }

  buildVillage() {
    this.game.village = this.village = new Village(this.game);
  }

  buildVegetation() {
    this.game.vegetation = this.vegetation = new Vegetation(this.scene, this.terrain, this.game.physics, this.village.exclusions, this.game.lite ? 'lite' : this.game.quality);
  }

  buildAtmosphere() {
    this.atmosphere = new Atmosphere(this.scene, this.dayNight, this.game.quality);
  }

  /** Trees are instanced; interaction wrappers are created lazily. */
  getTreeInteractable(tree) {
    if (!this.treeInteractables.has(tree)) {
      const names = { pine: 'ель', oak: 'дуб', birch: 'берёза' };
      this.treeInteractables.set(tree, {
        kind: 'tree',
        tree,
        getPrompt: () => (tree.felled ? null : `Собрать древесину (${names[tree.type]}, ${tree.wood})`),
        interact: (game) => {
          if (!game.player.useStamina(5) && !game.player.godMode) return;
          game.audio.play('hitWood', { position: new THREE.Vector3(tree.x, tree.y + 1, tree.z) });
          game.particles.woodChips(new THREE.Vector3(tree.x, game.camera.position.y - 0.2, tree.z), game.cameraRig.forward.clone().negate());
          this.harvestTree(tree, 1);
        },
      });
    }
    return this.treeInteractables.get(tree);
  }

  harvestTree(tree, amount) {
    if (tree.felled) return;
    const g = this.game;
    this.vegetation.shakeTree(tree);
    const got = Math.min(amount, tree.wood);
    tree.wood -= got;
    if (got > 0) g.inventory.addItem('wood', got, true);
    // falling leaves
    g.particles.emit({ position: new THREE.Vector3(tree.x, tree.y + tree.height * 0.6, tree.z), box: 2, count: 12, speed: 0.6, color: '#6a9a3a', colorEnd: '#4a6a2a', size: 0.14, life: 2.5, gravity: -1.5, drag: 1.5, additive: false });
    if (tree.wood <= 0) {
      this.vegetation.fellTree(tree);
      g.audio.play('impact', { position: new THREE.Vector3(tree.x, tree.y, tree.z), strength: 14, pitch: 0.6 });
      g.cameraRig.addTrauma(0.2);
      const dir = new THREE.Vector3(tree.x, 0, tree.z).sub(g.player.position).setY(0).normalize();
      g.props.spawnLog(new THREE.Vector3(tree.x + dir.x * 1.5, tree.y + 1.2, tree.z + dir.z * 1.5), dir);
      g.particles.dust(new THREE.Vector3(tree.x, tree.y + 0.5, tree.z), 25);
      g.ui.notify('Дерево срублено! Осталось бревно.');
    }
  }

  update(dt, time) {
    const cam = this.game.camera;
    windUniforms.uTime.value = time;
    this.dayNight.update(dt, this.game.player.position);
    this.sky.update(cam.position, time);
    this.water.update(time);
    this.village.update(dt, time, this.dayNight);
    this.vegetation.update(dt);
    this.atmosphere.update(dt, time, cam.position);
    void WORLD;
  }
}
