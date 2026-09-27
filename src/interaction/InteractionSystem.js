import * as THREE from 'three';

/**
 * Finds the interactable under the crosshair (doors, chests, campfires, NPCs, pickups, stones, trees)
 * and triggers it with E. Interactables expose: root (Object3D), getPrompt(game), interact(game),
 * optional position and name.
 */
export class InteractionSystem {
  constructor(game) {
    this.game = game;
    this.items = new Set();
    this.range = 3.4;
    this.current = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = this.range;
    this._roots = [];
    this._wp = new THREE.Vector3();
  }

  register(it) {
    this.items.add(it);
    if (it.root) it.root.userData.interactable = it;
  }

  unregister(it) {
    this.items.delete(it);
    if (this.current === it) this.current = null;
  }

  findInteractable(obj) {
    while (obj) {
      if (obj.userData.interactable) return obj.userData.interactable;
      obj = obj.parent;
    }
    return null;
  }

  update() {
    const game = this.game;
    const cam = game.camera;
    const origin = cam.position;
    const dir = game.cameraRig.forward;
    this._roots.length = 0;
    for (const it of this.items) {
      if (!it.root || it.disabled) continue;
      const p = it.position || it.root.getWorldPosition(this._wp);
      if (p.distanceToSquared(origin) < 64) this._roots.push(it.root);
    }
    this.raycaster.set(origin, dir);
    this.raycaster.camera = cam;
    this.raycaster.far = this.range;
    let best = null, bestDist = Infinity;
    if (this._roots.length) {
      const hits = this.raycaster.intersectObjects(this._roots, true);
      for (const h of hits) {
        const it = this.findInteractable(h.object);
        if (it && h.distance < bestDist && it.getPrompt(game)) {
          best = it;
          bestDist = h.distance;
          break;
        }
      }
    }
    // Trees (instanced) via analytic test
    const tree = game.vegetation.raycastTrees(origin, dir, this.range);
    if (tree && tree.distance < bestDist && !tree.tree.felled) {
      best = game.world.getTreeInteractable(tree.tree);
      bestDist = tree.distance;
    }
    // Don't interact through walls
    if (best && best.kind !== 'tree') {
      const block = game.physics.raycastStatic(origin, dir, bestDist);
      if (block < bestDist - 0.45) best = null;
    }
    this.current = best;
    if (best && game.input.wasPressed('KeyE')) {
      best.interact(game);
      game.events.emit('interacted', best);
    }
  }

  get prompt() {
    return this.current ? this.current.getPrompt(this.game) : null;
  }
}
