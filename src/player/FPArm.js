import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TwoBoneIK } from './ArmIK.js';
import { damp } from '../core/MathUtils.js';

// First-person right arm: only the right-arm triangles of the body mesh, on its own skeleton copy,
// attached to the camera. The shoulder joint sits at a fixed camera-space point; the arm stretches
// along its bones (upper arm first) when the grip is farther than the arm is long.
const SHOULDER = new THREE.Vector3(0.17, -0.28, -0.07); // camera space, below the frame
const BEND = 0.98; // need = distance / BEND: keeps a slight elbow bend
const MAX_UPPER = 2.0;
const MAX_FORE = 1.4;
const STRETCH_SMOOTH = 12; // damp rate of the arm length (shortening only lags; reaching never does)
// Grip: hand-bone axes (Y fingers, Z towards index/thumb, -X palm) relative to the weapon holder
export const GRIP_ROT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
export const PALM = new THREE.Vector3(-0.025, 0.085, 0); // grip axis in the hand frame (m): mid-palm
// Finger curl (rad) per joint around the local Z axis; thumb wraps over the fingers
const FINGERS = { Index: [1.25, 1.45, 0.8], Middle: [1.35, 1.5, 0.8], Ring: [1.45, 1.5, 0.8], Pinky: [1.55, 1.45, 0.8] };
const THUMB = [new THREE.Euler(0.2, 0.0, -0.4), new THREE.Euler(0, 0, -0.6), new THREE.Euler(0, 0, -0.5)];

const ARM_BONES = /^mixamorig:?Right(Shoulder|Arm|ForeArm|Hand)/;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _axis = new THREE.Vector3(0, 1, 0);

/** Proxy that the skeleton skins with: the bone's own frame, stretched along its axis only. */
function stretchProxy(bone) {
  const proxy = new THREE.Bone();
  proxy.name = `${bone.name}_stretch`;
  bone.add(proxy);
  return proxy;
}

export class FPArm {
  constructor(sourceScene, scale) {
    const scene = SkeletonUtils.clone(sourceScene);
    scene.scale.setScalar(scale);
    this.root = new THREE.Group();
    this.root.name = 'fp-arm';
    this.root.add(scene);
    this.scene = scene;

    let mesh = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o;
    });
    // drop every other mesh (visor etc.)
    const others = [];
    scene.traverse((o) => { if (o.isMesh && o !== mesh) others.push(o); });
    for (const o of others) o.parent.remove(o);

    const bones = mesh.skeleton.bones;
    const armIdx = new Set(bones.map((b, i) => (ARM_BONES.test(b.name) ? i : -1)).filter((i) => i >= 0));
    const geo = mesh.geometry.clone();
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const onArm = new Uint8Array(si.count);
    for (let v = 0; v < si.count; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (armIdx.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      onArm[v] = w > 0.5 ? 1 : 0;
    }
    const src = geo.index.array, kept = [];
    for (let t = 0; t < src.length; t += 3) {
      if (onArm[src[t]] && onArm[src[t + 1]] && onArm[src[t + 2]]) kept.push(src[t], src[t + 1], src[t + 2]);
    }
    geo.setIndex(kept);
    geo.groups.length = 0;
    this.triangles = kept.length / 3;

    const find = (n) => scene.getObjectByName(`mixamorig${n}`);
    this.upper = find('RightArm');
    this.fore = find('RightForeArm');
    this.hand = find('RightHand');
    // Skin the upper arm / forearm through stretch proxies so the scale never reaches child bones
    const skel = mesh.skeleton;
    this.upperProxy = stretchProxy(this.upper);
    this.foreProxy = stretchProxy(this.fore);
    const newBones = bones.map((b) => (b === this.upper ? this.upperProxy : b === this.fore ? this.foreProxy : b));
    const arm = new THREE.SkinnedMesh(geo, mesh.material);
    arm.name = 'fp-arm-mesh';
    arm.frustumCulled = false;
    arm.castShadow = false;
    arm.receiveShadow = false;
    arm.renderOrder = 10;
    mesh.parent.add(arm);
    mesh.parent.remove(mesh);
    arm.bind(new THREE.Skeleton(newBones, skel.boneInverses), mesh.bindMatrix);
    this.mesh = arm;

    this.upperLen0 = this.fore.position.y;
    this.foreLen0 = this.hand.position.y;
    this.bind = new Map();
    scene.traverse((o) => { if (o.isBone || /^mixamorig/.test(o.name)) this.bind.set(o, o.quaternion.clone()); });
    this.fingers = [];
    for (const [name, curl] of Object.entries(FINGERS)) {
      curl.forEach((a, i) => this.fingers.push({ bone: find(`RightHand${name}${i + 1}`), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a) }));
    }
    THUMB.forEach((e, i) => this.fingers.push({ bone: find(`RightHandThumb${i + 1}`), q: new THREE.Quaternion().setFromEuler(e) }));
    this.fingers = this.fingers.filter((f) => f.bone); // the Soldier rig has no Pinky3

    // Put the shoulder joint on SHOULDER (root frame == camera space)
    this.root.updateMatrixWorld(true);
    this.upper.getWorldPosition(_v);
    scene.position.copy(SHOULDER).sub(_v);
    this.root.updateMatrixWorld(true);
    // world-space unit length of the bones at scale 1 (scene scale is uniform)
    this.unit = this.fore.getWorldPosition(_v).distanceTo(this.upper.getWorldPosition(_v2)) / this.upperLen0;
    this.L1 = this.upperLen0 * this.unit;
    this.L2 = this.foreLen0 * this.unit;

    this.ik = new TwoBoneIK(this.upper, this.fore, this.hand);
    this.length = this.L1 + this.L2;
    this.k1 = 1;
    this.k2 = 1;
    this.error = 0;
    this._grip = new THREE.Vector3();
    this._gripQ = new THREE.Quaternion();
    this._wrist = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._shoulder = new THREE.Vector3();
  }

  /** Arm length split: the upper arm stretches first (to MAX_UPPER), then the forearm (to MAX_FORE). */
  setLength(total) {
    const { L1, L2 } = this;
    this.k1 = THREE.MathUtils.clamp((total - L2) / L1, 1, MAX_UPPER);
    this.k2 = THREE.MathUtils.clamp((total - this.k1 * L1) / L2, 1, MAX_FORE);
    this.fore.position.y = this.upperLen0 * this.k1;
    this.hand.position.y = this.foreLen0 * this.k2;
    this.upperProxy.scale.set(1, this.k1, 1);
    this.foreProxy.scale.set(1, this.k2, 1);
  }

  /** Places the palm on `gripObject` (world position, orientation from `holder`). dt=Infinity: no smoothing. */
  update(dt, gripObject, holder) {
    for (const [b, q] of this.bind) b.quaternion.copy(q);
    for (const f of this.fingers) f.bone.quaternion.copy(this.bind.get(f.bone)).multiply(f.q);
    this.root.updateWorldMatrix(true, true);

    gripObject.getWorldPosition(this._grip);
    holder.getWorldQuaternion(this._gripQ).multiply(GRIP_ROT);
    this._wrist.copy(PALM).applyQuaternion(this._gripQ);
    this._wrist.subVectors(this._grip, this._wrist);

    // Arm length: smoothed towards need, but never shorter than the shoulder->wrist distance
    const dist = this.upper.getWorldPosition(this._shoulder).distanceTo(this._wrist);
    const need = Math.max(this.L1 + this.L2, dist / BEND);
    const reach = dist + 1e-4;
    this.length = Number.isFinite(dt) ? damp(this.length, need, STRETCH_SMOOTH, dt) : need;
    this.length = Math.max(this.length, reach, this.L1 + this.L2);
    this.setLength(this.length);
    this.upper.updateMatrixWorld(true);

    // Elbow out (camera right) and down
    this.root.getWorldQuaternion(_q);
    this._pole.set(1, -1, 0.3).applyQuaternion(_q);
    this.ik.solve(this._wrist, this._pole, this._gripQ);
    this.transferTwist();
    this.error = this.hand.getWorldPosition(_v).distanceTo(this._wrist);
  }

  /** Moves the hand's twist around the forearm axis into the forearm, so the wrist doesn't candy-wrap. */
  transferTwist() {
    const hq = this.hand.quaternion;
    // twist of the hand around the forearm's Y axis
    _q.set(0, hq.y, 0, hq.w);
    if (_q.lengthSq() < 1e-10) return;
    _q.normalize();
    this.fore.quaternion.multiply(_q);
    _q2.copy(_q).invert();
    this.hand.quaternion.premultiply(_q2);
    this.fore.updateMatrixWorld(true);
  }
}
