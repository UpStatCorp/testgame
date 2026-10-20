import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { aimBone } from './ArmIK.js';

// First-person right arm: only the right-arm triangles of the body mesh, on its own skeleton copy,
// attached to the camera (root space == camera space). The arm is built from the hand: the palm sits on
// the grip with an orientation fixed to the weapon, the forearm comes out of the wrist within anatomical
// limits, and the upper arm (stretching up to 2x) connects the elbow to a shoulder point that may slide,
// but only outside the frame (below or right of it).
const SHOULDER = new THREE.Vector3(0.3, -0.35, 0); // default shoulder joint, camera space
const MAX_UPPER = 2.0;
const MAX_FORE = 1.4;
const SHOULDER_SMOOTH = 14; // damp rate of the sliding shoulder (the hand never depends on it)
const MAX_FORE_TWIST = Math.PI / 2; // forearm roll relative to the upper arm (0 = rig bind pose)
const DEG = Math.PI / 180;
const HINGE_FADE = [3 * DEG, 45 * DEG]; // elbow bend over which the real bend direction takes over
const HINGE_SMOOTH = 20; // damp rate of the upper-arm roll (rolling around its own axis moves no joint)
const HINGE_STRAIGHT = new THREE.Vector3(0, 1, 0); // elbow hinge of a straight arm, camera space
// Wrist limits (hand frame: x towards the index finger, y along the fingers, z towards the palm)
const RADIAL = 20 * DEG; // towards the thumb
const ULNAR = 30 * DEG; // towards the little finger
const FLEX = 50 * DEG;
const EXT = 45 * DEG;
const LIMIT_MARGIN = 0.5 * DEG; // solve slightly inside the limits
// Grip: the hilt crosses the palm diagonally, from the base of the index finger to the heel of the hand
// on the little-finger side. GRIP_ALPHA tilts the hilt from the knuckle line towards the fingers,
// GRIP_ROLL turns the hand around the hilt.
const GRIP_ALPHA = 40 * DEG;
const GRIP_ROLL = -30 * DEG;
export const GRIP_ROT = (() => {
  const h = new THREE.Vector3(0, 1, 0); // hilt axis in the holder, towards the blade
  const w = new THREE.Vector3(0, 0, -1);
  const x = h.clone().multiplyScalar(Math.cos(GRIP_ALPHA)).addScaledVector(w, -Math.sin(GRIP_ALPHA));
  const y = h.clone().multiplyScalar(Math.sin(GRIP_ALPHA)).addScaledVector(w, Math.cos(GRIP_ALPHA));
  const roll = new THREE.Quaternion().setFromAxisAngle(h, GRIP_ROLL);
  x.applyQuaternion(roll);
  y.applyQuaternion(roll);
  const z = x.clone().cross(y);
  // hand bone axes: local X = -z (back of the hand), local Y = y (fingers), local Z = x (index side)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(z.negate(), y, x));
})();
export const PALM = new THREE.Vector3(-0.025, 0.085, 0); // grip axis in the hand frame (m): mid-palm
export const WRIST_LIMITS = { RADIAL, ULNAR, FLEX, EXT };
// Finger curl (rad) per joint around the local Z axis; thumb wraps over the fingers
const FINGERS = { Index: [1.25, 1.45, 0.8], Middle: [1.35, 1.5, 0.8], Ring: [1.45, 1.5, 0.8], Pinky: [1.55, 1.45, 0.8] };
const THUMB = [new THREE.Euler(0.2, 0.0, -0.4), new THREE.Euler(0, 0, -0.6), new THREE.Euler(0, 0, -0.5)];

const TAN_V = Math.tan((75 / 2) * DEG); // camera vertical half-FOV
const SHOULDER_MARGIN = 0.06; // m: the shoulder mesh around the joint must stay out of frame too

/** Camera-space point is outside the frame, below or to the right of it (or beside/behind the eye). */
export function outOfFrameBelowRight(p, aspect) {
  if (p.z >= -0.02) return p.y < -0.1 || p.x > 0.1;
  const d = -p.z;
  return -p.y - SHOULDER_MARGIN > d * TAN_V || p.x - SHOULDER_MARGIN > d * TAN_V * aspect;
}

const ARM_BONES = /^mixamorig:?Right(Shoulder|Arm|ForeArm|Hand)/;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _f = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _fibo = [];
for (let i = 0; i < 300; i++) {
  const y = 1 - (2 * i + 1) / 300, r = Math.sqrt(1 - y * y), t = i * 2.39996;
  _fibo.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
}

/** Forearm direction for wrist angles (a: + towards the little finger, b: + extension) in a hand frame. */
function forearmDir(out, x, y, z, a, b) {
  return out.copy(y).addScaledVector(x, Math.tan(a)).addScaledVector(z, Math.tan(b)).normalize();
}

/** Twist angle of a local quaternion around its Y axis (swing-twist decomposition). */
export function twistY(q) {
  const s = q.w < 0 ? -1 : 1; // q and -q are the same rotation
  return 2 * Math.atan2(q.y * s, q.w * s);
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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

    // Shoulder joint position when the scene sits at the origin (the clavicle chain is never animated)
    this.root.updateMatrixWorld(true);
    this.shoulderOffset = this.upper.getWorldPosition(new THREE.Vector3());
    // world-space unit length of the bones at scale 1 (scene scale is uniform)
    this.unit = this.fore.getWorldPosition(_v).distanceTo(this.shoulderOffset) / this.upperLen0;
    this.L1 = this.upperLen0 * this.unit;
    this.L2 = this.foreLen0 * this.unit;

    // Hand frame from the rig (bone-local): y towards Middle1, x = Index1 - Pinky1 orthogonalised, z = x * y
    this.handY = find('RightHandMiddle1').position.clone().normalize();
    this.handX = find('RightHandIndex1').position.clone().sub(find('RightHandPinky1').position);
    this.handX.addScaledVector(this.handY, -this.handX.dot(this.handY)).normalize();
    this.handZ = this.handX.clone().cross(this.handY);
    // Elbow hinge in the upper-arm bone frame: in the bind (T) pose the forearm flexes forward (-Z)
    this.upper.getWorldQuaternion(_q);
    _v.copy(this.fore.getWorldPosition(_v2)).sub(this.shoulderOffset).normalize();
    this.hinge = _v.cross(_v2.set(0, 0, -1)).normalize().applyQuaternion(_q.invert());

    this.k1 = 1;
    this.k2 = 1;
    this.error = 0;
    this.aspect = 16 / 9;
    this.shoulder = SHOULDER.clone(); // smoothed, camera space
    this.wrist = new THREE.Vector3(); // camera space
    this.elbow = new THREE.Vector3();
    this.dir = new THREE.Vector3(); // forearm direction (elbow -> wrist), camera space
    this.wristAngles = { lateral: 0, flex: 0, bend: 0 };
    this.foreTwist = 0;
    this.twistNeed = 0;
    this.elbowBend = 0;
    this.hingeDir = new THREE.Vector3(0, 1, 0); // smoothed elbow hinge, camera space
    this._grip = new THREE.Vector3();
    this._gripQ = new THREE.Quaternion();
    this._handQ = new THREE.Quaternion();
    this._rootQ = new THREE.Quaternion();
    this._target = new THREE.Vector3();
  }

  /** Best forearm direction: closest to `d` (shoulder->wrist) inside the wrist limits. */
  chooseForearm(out, d, x, y, z) {
    const dy = d.dot(y);
    const a = Math.atan2(d.dot(x), dy), b = Math.atan2(d.dot(z), dy);
    const R = RADIAL - LIMIT_MARGIN, U = ULNAR - LIMIT_MARGIN, F = FLEX - LIMIT_MARGIN, E = EXT - LIMIT_MARGIN;
    if (dy > 0 && a >= -R && a <= U && b >= -F && b <= E) return out.copy(d);
    // optimum on the boundary of the limit box: golden-section search along each edge
    let best = -2;
    const score = (aa, bb) => forearmDir(_c, x, y, z, aa, bb).dot(d);
    const edge = (fixA, val, lo, hi) => {
      const g = 0.381966;
      let l = lo, h = hi;
      for (let i = 0; i < 28; i++) {
        const m1 = l + (h - l) * g, m2 = h - (h - l) * g;
        const s1 = fixA ? score(val, m1) : score(m1, val);
        const s2 = fixA ? score(val, m2) : score(m2, val);
        if (s1 < s2) l = m1; else h = m2;
      }
      const t = (l + h) / 2;
      const aa = fixA ? val : t, bb = fixA ? t : val;
      const sc = score(aa, bb);
      if (sc > best) { best = sc; out.copy(_c); }
    };
    edge(true, -R, -F, E);
    edge(true, U, -F, E);
    edge(false, -F, -R, U);
    edge(false, E, -R, U);
    return out;
  }

  /** Shoulder point closest to `pref` with the elbow reachable by the upper arm (1..2x), out of frame. */
  placeShoulder(out, pref, elbow) {
    const { L1 } = this;
    _d.subVectors(pref, elbow);
    const r = THREE.MathUtils.clamp(_d.length(), L1, MAX_UPPER * L1);
    out.copy(elbow).addScaledVector(_d.normalize(), r);
    if (outOfFrameBelowRight(out, this.aspect)) return true;
    let bd = Infinity;
    for (const rr of [1, 1.25, 1.5, 1.75, 2]) {
      for (const dir of _fibo) {
        _s.copy(elbow).addScaledVector(dir, rr * L1);
        if (!outOfFrameBelowRight(_s, this.aspect)) continue;
        const q = _s.distanceToSquared(pref);
        if (q < bd) { bd = q; out.copy(_s); }
      }
    }
    return bd < Infinity;
  }

  /** Places the palm on `gripObject` (world position, orientation from `holder`). dt=Infinity: no smoothing. */
  update(dt, gripObject, holder) {
    for (const [b, q] of this.bind) b.quaternion.copy(q);
    for (const f of this.fingers) f.bone.quaternion.copy(this.bind.get(f.bone)).multiply(f.q);
    this.root.updateWorldMatrix(true, false);
    _m.copy(this.root.matrixWorld).invert();
    this.root.getWorldQuaternion(this._rootQ);

    // Hand frame and wrist point in camera (root) space
    this._grip.copy(gripObject.getWorldPosition(_v)).applyMatrix4(_m);
    holder.getWorldQuaternion(this._gripQ).multiply(GRIP_ROT);
    this._handQ.copy(this._rootQ).invert().multiply(this._gripQ);
    _x.copy(this.handX).applyQuaternion(this._handQ);
    _y.copy(this.handY).applyQuaternion(this._handQ);
    _z.copy(this.handZ).applyQuaternion(this._handQ);
    this.wrist.copy(PALM).applyQuaternion(this._handQ).negate().add(this._grip);

    // Forearm direction from the (current) shoulder, then elbow, then shoulder placement; repeat to settle
    const target = this._target;
    let shoulderOk = false;
    target.copy(SHOULDER);
    for (let it = 0; it < 3; it++) {
      _d.subVectors(this.wrist, target).normalize();
      this.chooseForearm(_f, _d, _x, _y, _z);
      this.dir.copy(_f);
      for (this.k2 = 1; this.k2 <= MAX_FORE + 1e-9; this.k2 += 0.02) {
        this.elbow.copy(this.wrist).addScaledVector(this.dir, -this.L2 * this.k2);
        if ((shoulderOk = this.placeShoulder(_s, SHOULDER, this.elbow))) break;
      }
      this.k2 = Math.min(this.k2, MAX_FORE);
      target.copy(_s);
    }
    // Smooth the shoulder, then put it back on the reachable shell around the elbow
    if (Number.isFinite(dt)) this.shoulder.lerp(target, 1 - Math.exp(-SHOULDER_SMOOTH * dt));
    else this.shoulder.copy(target);
    _d.subVectors(this.shoulder, this.elbow);
    const r = THREE.MathUtils.clamp(_d.length(), this.L1, MAX_UPPER * this.L1);
    _s.copy(this.elbow).addScaledVector(_d.normalize(), r);
    this.shoulder.copy(outOfFrameBelowRight(_s, this.aspect) ? _s : target);
    this.shoulderOk = shoulderOk;

    // Pose the bones: stretch, place the shoulder joint, aim upper arm and forearm, orient the hand
    this.k1 = this.shoulder.distanceTo(this.elbow) / this.L1;
    this.fore.position.y = this.upperLen0 * this.k1;
    this.hand.position.y = this.foreLen0 * this.k2;
    this.upperProxy.scale.set(1, this.k1, 1);
    this.foreProxy.scale.set(1, this.k2, 1);
    this.scene.position.copy(this.shoulder).sub(this.shoulderOffset);
    this.root.updateMatrixWorld(true);
    const toWorld = (p, out) => out.copy(p).applyMatrix4(this.root.matrixWorld);
    aimBone(this.upper, toWorld(this.shoulder, _v), this.fore.getWorldPosition(_v2), toWorld(this.elbow, _s));
    this.rollUpperToHinge(dt);
    this.fore.getWorldPosition(_v);
    aimBone(this.fore, _v, this.hand.getWorldPosition(_v2), toWorld(this.wrist, _s));
    this.fore.getWorldQuaternion(_q);
    this.hand.quaternion.copy(_q.invert().multiply(this._gripQ));
    this.distributeTwist();
    this.hand.updateMatrixWorld(true);

    this.error = this.hand.getWorldPosition(_v).distanceTo(toWorld(this.wrist, _v2));
    const dy = this.dir.dot(_y);
    this.wristAngles.lateral = Math.atan2(this.dir.dot(_x), dy);
    this.wristAngles.flex = Math.atan2(this.dir.dot(_z), dy);
    this.wristAngles.bend = Math.acos(THREE.MathUtils.clamp(dy, -1, 1));
  }

  /**
   * Rolls the upper arm around its axis so the elbow bends around its hinge (forearm flexes forward).
   * A straight arm has no bend direction: its hinge points along HINGE_STRAIGHT (camera up, i.e. the elbow
   * crease faces up/in), and the real bend direction fades in with the elbow angle, so the roll is continuous.
   */
  rollUpperToHinge(dt) {
    _d.subVectors(this.elbow, this.shoulder).normalize(); // upper arm, camera space
    _e.crossVectors(_d, this.dir); // hinge of the actual bend, camera space
    const bend = Math.asin(Math.min(1, _e.length()));
    this.elbowBend = _d.dot(this.dir) < 0 ? Math.PI - bend : bend;
    const w = THREE.MathUtils.smoothstep(this.elbowBend, HINGE_FADE[0], HINGE_FADE[1]);
    if (w > 0) _e.normalize();
    _s.copy(HINGE_STRAIGHT).addScaledVector(_d, -HINGE_STRAIGHT.dot(_d)).normalize().multiplyScalar(1 - w);
    _e.multiplyScalar(w).add(_s).normalize(); // wanted hinge
    if (Number.isFinite(dt)) {
      this.hingeDir.lerp(_e, 1 - Math.exp(-HINGE_SMOOTH * dt));
      _e.copy(this.hingeDir).addScaledVector(_d, -this.hingeDir.dot(_d));
      if (_e.lengthSq() < 1e-8) _e.copy(_s);
      _e.normalize();
    }
    this.hingeDir.copy(_e);
    this.upper.getWorldQuaternion(_q);
    _q2.copy(this._rootQ).invert().multiply(_q); // upper arm orientation in camera space
    _c.copy(this.hinge).applyQuaternion(_q2); // current hinge, camera space (perpendicular to _d)
    const angle = Math.atan2(_s.crossVectors(_c, _e).dot(_d), _c.dot(_e));
    _q2.setFromAxisAngle(_d.applyQuaternion(this._rootQ), angle).multiply(this.upper.getWorldQuaternion(_q)); // world roll
    this.upper.parent.getWorldQuaternion(_q);
    this.upper.quaternion.copy(_q.invert().multiply(_q2));
    this.upper.updateMatrixWorld(true);
  }

  /**
   * Roll around the forearm axis: the forearm takes the hand's twist (pronation/supination) as long as
   * it stays within +-90 deg of the upper arm; the rest stays in the wrist.
   */
  distributeTwist() {
    const hq = this.hand.quaternion;
    const handTwist = twistY(hq);
    const foreTwist = twistY(this.fore.quaternion);
    this.twistNeed = wrapAngle(foreTwist + handTwist);
    const total = THREE.MathUtils.clamp(this.twistNeed, -MAX_FORE_TWIST, MAX_FORE_TWIST);
    const move = total - foreTwist;
    _q.setFromAxisAngle(AXIS_Y, move);
    this.fore.quaternion.multiply(_q);
    hq.premultiply(_q.invert());
    this.fore.updateMatrixWorld(true);
    this.foreTwist = twistY(this.fore.quaternion);
  }
}
