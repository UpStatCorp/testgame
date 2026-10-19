import * as THREE from 'three';
import { ItemMaterials, createItemModel } from '../items/ItemModels.js';
import { damp, smoothstep } from '../core/MathUtils.js';

// ?oldarms: keep the procedural arms for every weapon (comparison / rollback)
const OLD_ARMS = new URLSearchParams(location.search).has('oldarms');

const TRAIL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TRAIL_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float progress;
  uniform float fade;
  varying vec2 vUv;
  void main() {
    // vUv.x runs along the arc, vUv.y across (inner->outer)
    float head = progress;
    float along = vUv.x;
    if (along > head) discard;
    float tail = smoothstep(head - 0.75, head, along);
    float edge = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
    float a = tail * edge * fade;
    gl_FragColor = vec4(color * (1.2 + vUv.y), a);
  }`;

function arcGeometry(radius, width, arcDeg, segments = 40) {
  const pos = [], uv = [], idx = [];
  const arc = (arcDeg * Math.PI) / 180;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -arc / 2 + arc * t;
    for (let j = 0; j <= 1; j++) {
      const r = radius - width + width * j;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      uv.push(t, j);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** First-person weapon/hand rendering attached to the camera, with procedural animation. */
export class ViewModel {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    camera.add(this.root);
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.model = null;
    this.currentId = null;
    this.sway = new THREE.Vector2();
    this.equipT = 1;
    this.time = 0;
    this.trails = [];
    this.pose = { p: new THREE.Vector3(), r: new THREE.Euler() };

    // Arms (sleeve + glove), stretched each frame between hand and an off-screen shoulder
    const sleeveGeo = new THREE.CylinderGeometry(0.045, 0.06, 1, 8);
    sleeveGeo.translate(0, 0.5, 0);
    this.rightArm = new THREE.Mesh(sleeveGeo, ItemMaterials.sleeve());
    this.leftArm = new THREE.Mesh(sleeveGeo, ItemMaterials.sleeve());
    const gloveGeo = new THREE.BoxGeometry(0.075, 0.1, 0.085);
    this.rightHand = new THREE.Mesh(gloveGeo, ItemMaterials.glove());
    this.leftHand = new THREE.Mesh(gloveGeo, ItemMaterials.glove());
    this.root.add(this.rightArm, this.leftArm);
    this.holder.add(this.rightHand);
    this.holder.add(this.leftHand);
    for (const m of [this.rightArm, this.leftArm, this.rightHand, this.leftHand]) {
      m.renderOrder = 10;
    }
    this.rightShoulder = new THREE.Vector3(0.38, -0.75, 0.2);
    this.leftShoulder = new THREE.Vector3(-0.38, -0.75, 0.2);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.fpArm = null;
  }

  /** Real (skinned) right arm used instead of the procedural one while the one-handed sword is out. */
  setFPArm(fpArm) {
    this.fpArm = fpArm;
    fpArm.root.visible = false;
    this.root.add(fpArm.root);
  }

  get usesFPArm() {
    return !!this.fpArm && !OLD_ARMS && this.currentId === 'sword';
  }

  setModel(id) {
    if (this.currentId === id) return;
    this.currentId = id;
    if (this.model) this.holder.remove(this.model);
    this.model = null;
    if (id && id !== 'fists') {
      this.model = createItemModel(id);
      this.model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.renderOrder = 10;
        }
      });
      if (id === 'sword') this.model.scale.setScalar(0.95);
      if (id === 'greatsword') this.model.scale.setScalar(0.85);
      if (id === 'staff') {
        this.model.scale.setScalar(0.85);
        this.model.position.y = -0.1;
      }
      if (['potion', 'food', 'apple', 'coin', 'stone', 'wood'].includes(id)) {
        this.model.scale.setScalar(id === 'wood' ? 0.8 : 1.3);
        this.model.position.set(0, 0.03, -0.02);
      }
      this.holder.add(this.model);
    }
    const twoHanded = id === 'greatsword';
    this.leftArm.visible = twoHanded;
    this.leftHand.visible = twoHanded;
    this.leftHand.position.set(0, -0.22, 0);
    this.rightHand.position.set(0, id === 'greatsword' ? -0.05 : 0, 0);
    this.equipT = 0;
  }

  /** Spawns a fading slash arc in camera space. */
  spawnTrail(def, roll) {
    if (!def.trail) return;
    const tr = def.trail;
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(tr.color) }, progress: { value: 0 }, fade: { value: 1 } },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(arcGeometry(tr.radius, tr.width, tr.arc), mat);
    mesh.position.set(0, -0.15, -1.25);
    mesh.rotation.set(-0.35, 0, roll);
    mesh.renderOrder = 20;
    // arc sweeps along +theta; flip for reversed swings
    if (roll > Math.PI / 2) mesh.scale.x = -1;
    this.root.add(mesh);
    this.trails.push({ mesh, t: 0, dur: def.heavy ? 0.4 : 0.26 });
  }

  /**
   * Blend target pose with sway + bob and apply it.
   * pose: {p:[..], r:[..]}, rig: CameraRig (for bob and look deltas)
   */
  update(dt, pose, rig, player) {
    this.time += dt;
    this.equipT = Math.min(1, this.equipT + dt * 3.5);
    const equipDrop = (1 - smoothstep(0, 1, this.equipT)) * 0.5;

    // Mouse sway (weapon lags behind look)
    this.sway.x = damp(this.sway.x, THREE.MathUtils.clamp(-rig.lookDX * 0.0009, -0.06, 0.06), 10, dt);
    this.sway.y = damp(this.sway.y, THREE.MathUtils.clamp(rig.lookDY * 0.0009, -0.06, 0.06), 10, dt);
    rig.lookDX = 0;
    rig.lookDY = 0;

    const bob = rig.bobOffset;
    const breathe = Math.sin(this.time * 1.6) * 0.006;
    const crouchOff = player.crouching ? 0.03 : 0;
    this.holder.position.set(
      pose.p[0] + this.sway.x - bob.x * 0.6,
      pose.p[1] + this.sway.y - bob.y * 0.5 + breathe - equipDrop + crouchOff,
      pose.p[2]
    );
    this.holder.rotation.set(pose.r[0] + this.sway.y * 1.5 + equipDrop * 1.2, pose.r[1] + this.sway.x * 2, pose.r[2]);

    // Arms follow hands
    this.holder.updateMatrix();
    this.updateArm(this.rightArm, this.rightHand, this.rightShoulder);
    if (this.leftArm.visible) this.updateArm(this.leftArm, this.leftHand, this.leftShoulder);
    const fp = this.usesFPArm;
    this.rightArm.visible = this.rightHand.visible = !fp;
    if (this.fpArm) {
      this.fpArm.root.visible = fp;
      if (fp) this.fpArm.update(dt, this.rightHand, this.holder);
    }

    // Trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.t += dt;
      const u = tr.t / tr.dur;
      tr.mesh.material.uniforms.progress.value = Math.min(1.2, u * 2.2);
      tr.mesh.material.uniforms.fade.value = 1 - smoothstep(0.4, 1, u);
      if (u >= 1) {
        this.root.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        tr.mesh.material.dispose();
        this.trails.splice(i, 1);
      }
    }
  }

  updateArm(arm, hand, shoulder) {
    const handPos = this._v.copy(hand.position).applyMatrix4(this.holder.matrix);
    const dir = this._v2.subVectors(handPos, shoulder);
    const len = dir.length();
    arm.position.copy(shoulder);
    arm.scale.set(1, Math.max(0.01, len - 0.03), 1);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  /** World-space position of the model tip (sword tip / staff crystal). */
  getTipWorld(target) {
    if (!this.model || !this.model.userData.tip) return this.camera.getWorldPosition(target);
    this.root.updateWorldMatrix(true, true);
    return target.copy(this.model.userData.tip).applyMatrix4(this.model.matrixWorld);
  }
}
