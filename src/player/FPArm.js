import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// First-person right arm: only the right-arm triangles of the body mesh, on its own skeleton copy,
// attached to the camera (root space == camera space). The arm is built from the hand: the palm sits on
// the grip with an orientation fixed to the weapon, the forearm comes out of the wrist within anatomical
// limits with the elbow slightly bent, and the upper arm (stretching up to 2x) connects the elbow to a
// shoulder point that may slide, but only outside the frame (below or right of it). The swivel of the
// elbow around the shoulder-wrist line is chosen every frame so the forearm roll stays within its range
// and the wrist barely twists.
const SHOULDER = new THREE.Vector3(0.3, -0.35, 0); // default shoulder joint, camera space
const MAX_UPPER = 2.0;
const MAX_FORE = 1.4;
const DEG = Math.PI / 180;
const ELBOW_BEND = 15 * DEG; // preferred elbow bend (10..20 deg where the wrist limits allow)
const FORE_TWIST_LIMIT = 85 * DEG; // forearm roll from neutral (thumb up)
const WRIST_TWIST_LIMIT = 10 * DEG;
const ELBOW_PREF = new THREE.Vector3(0.45, -1, 0).normalize(); // elbow points down and a little out
const SWIVEL_STEPS = 36;
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
const _u = new THREE.Vector3();
const _h = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x2 = new THREE.Vector3();
const _o2 = new THREE.Vector3();
const _m2 = new THREE.Matrix4();
const _qm = new THREE.Quaternion();
const _sp = new THREE.Vector3();
const _fa = new THREE.Vector3();
const _ep = new THREE.Vector3();
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
    // Bind data in camera space (the scene is unrotated and in its bind pose here)
    this.upperParentQ = this.upper.parent.getWorldQuaternion(new THREE.Quaternion());
    const upperBindQ = this.upper.getWorldQuaternion(new THREE.Quaternion());
    const foreBindQ = this.fore.getWorldQuaternion(new THREE.Quaternion());
    const handBindQ = this.hand.getWorldQuaternion(new THREE.Quaternion());
    this.foreBindLocal = this.fore.quaternion.clone();
    this.handBindLocalInv = this.hand.quaternion.clone().invert();
    // Elbow hinge in the upper-arm bone frame: in the bind (T) pose the forearm flexes forward (-Z)
    _v.copy(this.fore.getWorldPosition(_v2)).sub(this.shoulderOffset).normalize();
    this.hingeLocal = _v.cross(_v2.set(0, 0, -1)).applyQuaternion(_q.copy(upperBindQ).invert());
    this.hingeLocal.y = 0;
    this.hingeLocal.normalize();
    this.basisLocal = new THREE.Matrix4().makeBasis(this.hingeLocal, AXIS_Y, this.hingeLocal.clone().cross(AXIS_Y));
    // Neutral forearm roll: the palm faces forward (thumb up) in the T-pose
    const axis = AXIS_Y.clone().applyQuaternion(foreBindQ);
    const palm = this.handZ.clone().applyQuaternion(handBindQ);
    palm.addScaledVector(axis, -palm.dot(axis)).normalize();
    const fwd = new THREE.Vector3(0, 0, -1);
    fwd.addScaledVector(axis, -fwd.dot(axis)).normalize();
    const turn = Math.atan2(_v.crossVectors(palm, fwd).dot(axis), palm.dot(fwd));
    this.neutralTwist = wrapAngle(twistY(this.foreBindLocal) + turn);

    this.k1 = 1;
    this.k2 = 1;
    this.error = 0;
    this.aspect = 16 / 9;
    this.shoulder = SHOULDER.clone(); // camera space
    this.shoulderPref = SHOULDER.clone(); // preferred shoulder point for the solve
    this.wrist = new THREE.Vector3(); // camera space
    this.elbow = new THREE.Vector3();
    this.dir = new THREE.Vector3(); // forearm direction (elbow -> wrist), camera space
    this.wristAngles = { lateral: 0, flex: 0, bend: 0 };
    this.elbowBend = 0;
    this.foreTwist = 0; // from neutral
    this.wristTwist = 0;
    this.swivel = null; // previous swivel angle (continuity)
    this._grip = new THREE.Vector3();
    this._gripQ = new THREE.Quaternion();
    this._handQ = new THREE.Quaternion();
    this._rootQ = new THREE.Quaternion();
    this._cand = this.makeCandidate();
    this._best = this.makeCandidate();
  }

  makeCandidate() {
    return {
      phi: 0, cost: Infinity, ok: false, f: new THREE.Vector3(), E: new THREE.Vector3(), S: new THREE.Vector3(),
      Qu: new THREE.Quaternion(), Qf: new THREE.Quaternion(), k1: 1, k2: 1, bend: 0, foreTwist: 0, wristTwist: 0, elbowIn: false,
    };
  }

  copyCandidate(dst, src) {
    for (const k of Object.keys(src)) {
      if (src[k] && src[k].copy) dst[k].copy(src[k]);
      else dst[k] = src[k];
    }
  }

  /** Best forearm direction: closest to `d` inside the wrist limits. */
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
      const sc = fixA ? score(val, t) : score(t, val);
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

  /** Camera-space point: [in frame, above or left of the frame]. */
  framing(p) {
    if (p.z > -0.05) return [false, false];
    const nx = p.x / (-p.z * TAN_V * this.aspect), ny = p.y / (-p.z * TAN_V);
    return [Math.abs(nx) <= 1 && Math.abs(ny) <= 1, ny > 1 || nx < -1];
  }

  /**
   * Arm for one swivel angle `phi` of the elbow around the shoulder-wrist line (0 = elbow up, pi = down).
   * Fills candidate `c` (camera space) and its cost.
   */
  evaluate(phi, c, x, y, z) {
    const W = this.wrist, L2 = this.L2;
    const d = _d.subVectors(W, this.shoulderPref).normalize();
    _e.set(0, 1, 0).addScaledVector(d, -d.y).normalize(); // e1: up, perpendicular to d
    const o = _v.copy(_e).multiplyScalar(Math.cos(phi)).addScaledVector(_s.crossVectors(d, _e), Math.sin(phi));
    const dC = _x2.copy(d), oC = _o2.copy(o);
    // forearm tilt that bends the elbow by ELBOW_BEND (shoulder at its default point)
    const bendAt = (th) => {
      c.f.copy(dC).multiplyScalar(Math.cos(th)).addScaledVector(oC, -Math.sin(th));
      c.E.copy(W).addScaledVector(c.f, -L2);
      _u.subVectors(c.E, this.shoulderPref).normalize();
      return Math.acos(THREE.MathUtils.clamp(_u.dot(c.f), -1, 1));
    };
    let lo = 0, hi = 60 * DEG;
    if (bendAt(hi) > ELBOW_BEND) for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (bendAt(m) < ELBOW_BEND) lo = m; else hi = m; }
    bendAt((lo + hi) / 2);
    // wrist limits, then elbow and shoulder
    this.chooseForearm(_f, c.f, x, y, z);
    c.f.copy(_f);
    c.ok = false;
    for (c.k2 = 1; c.k2 <= MAX_FORE + 1e-9; c.k2 += 0.02) {
      c.E.copy(W).addScaledVector(c.f, -L2 * c.k2);
      if ((c.ok = this.placeShoulder(c.S, this.shoulderPref, c.E))) break;
    }
    c.k2 = Math.min(c.k2, MAX_FORE);
    _u.subVectors(c.E, c.S);
    c.k1 = _u.length() / this.L1;
    _u.normalize();
    c.bend = Math.acos(THREE.MathUtils.clamp(_u.dot(c.f), -1, 1));
    // upper arm: Y along the bone, elbow hinge perpendicular to the bend plane
    _h.crossVectors(_u, c.f);
    if (_h.lengthSq() < 1e-8) _h.crossVectors(oC, dC);
    _h.addScaledVector(_u, -_h.dot(_u)).normalize();
    _m.makeBasis(_h, _u, _s.crossVectors(_h, _u));
    _m2.copy(this.basisLocal).transpose().premultiply(_m);
    c.Qu.setFromRotationMatrix(_m2);
    // forearm without extra roll, then the roll that leaves the wrist untwisted
    _q.copy(c.Qu).multiply(this.foreBindLocal);
    _s.copy(AXIS_Y).applyQuaternion(_q);
    c.Qf.setFromUnitVectors(_s, c.f).multiply(_q);
    _qm.copy(c.Qf).invert().multiply(this._handQ).multiply(this.handBindLocalInv); // wrist deviation (forearm frame)
    let t = 0;
    for (let i = 0; i < 5; i++) t += twistY(_q2.setFromAxisAngle(AXIS_Y, -t).multiply(_qm));
    const base = twistY(_q.copy(c.Qu).invert().multiply(c.Qf));
    const need = wrapAngle(base + t - this.neutralTwist);
    c.foreTwist = THREE.MathUtils.clamp(need, -FORE_TWIST_LIMIT, FORE_TWIST_LIMIT);
    const roll = t + (c.foreTwist - need);
    c.wristTwist = twistY(_q2.setFromAxisAngle(AXIS_Y, -roll).multiply(_qm));
    c.Qf.multiply(_q2.setFromAxisAngle(AXIS_Y, roll));
    // cost (degrees)
    const [inFrame, topLeft] = this.framing(c.E);
    c.elbowIn = inFrame;
    _p.copy(ELBOW_PREF).addScaledVector(dC, -ELBOW_PREF.dot(dC)).normalize();
    const style = Math.acos(THREE.MathUtils.clamp(oC.dot(_p), -1, 1)) / DEG;
    const wv = Math.max(0, Math.abs(c.wristTwist) - WRIST_TWIST_LIMIT + 0.5 * DEG) / DEG;
    const bendErr = (c.bend - ELBOW_BEND) / DEG;
    let cost = 1e4 * wv * wv + 4 * bendErr * bendErr + 0.02 * style * style + 0.02 * (c.foreTwist / DEG) ** 2;
    if (!c.ok) cost += 1e7;
    if (topLeft) cost += 1e6;
    if (inFrame) cost += 2e3;
    if (this.swivel !== null) cost += 0.5 * (wrapAngle(phi - this.swivel) / DEG) ** 2;
    c.phi = phi;
    c.cost = cost;
    return cost;
  }

  /** Places the palm on `gripObject` (world position, orientation from `holder`). */
  update(dt, gripObject, holder) {
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

    // Swivel: coarse scan, then golden-section refinement around the best sample
    const best = this._best, c = this._cand;
    best.cost = Infinity;
    for (let i = 0; i < SWIVEL_STEPS; i++) {
      if (this.evaluate((i / SWIVEL_STEPS) * 2 * Math.PI - Math.PI, c, _x, _y, _z) < best.cost) this.copyCandidate(best, c);
    }
    const step = (2 * Math.PI) / SWIVEL_STEPS;
    let l = best.phi - step, h = best.phi + step;
    for (let i = 0; i < 20; i++) {
      const m1 = l + (h - l) * 0.381966, m2 = h - (h - l) * 0.381966;
      if (this.evaluate(m1, c, _x, _y, _z) < this.evaluate(m2, c, _x, _y, _z)) h = m2; else l = m1;
    }
    if (this.evaluate((l + h) / 2, c, _x, _y, _z) < best.cost) this.copyCandidate(best, c);
    // Wrist still twisted too much: turn the shoulder around the forearm axis (this turns the elbow hinge,
    // hence the forearm roll), by the smallest angle that brings the wrist twist within its limit.
    if (Math.abs(best.wristTwist) > WRIST_TWIST_LIMIT - 0.5 * DEG) {
      const phi = best.phi;
      _sp.copy(best.S).sub(best.E);
      _fa.copy(best.f);
      _ep.copy(best.E);
      let found = false;
      for (let k = 1; k <= 60 && !found; k++) {
        for (const sign of [1, -1]) {
          this.shoulderPref.copy(_sp).applyAxisAngle(_fa, sign * k * 3 * DEG).add(_ep);
          if (!outOfFrameBelowRight(this.shoulderPref, this.aspect)) continue;
          this.evaluate(phi, c, _x, _y, _z);
          if (c.ok && Math.abs(c.wristTwist) <= WRIST_TWIST_LIMIT - 0.5 * DEG) { this.copyCandidate(best, c); found = true; break; }
        }
      }
      this.shoulderPref.copy(SHOULDER);
    }
    this.swivel = best.phi;

    // Pose the bones from the chosen candidate (camera-space orientations)
    this.k1 = best.k1;
    this.k2 = best.k2;
    this.shoulder.copy(best.S);
    this.elbow.copy(best.E);
    this.dir.copy(best.f);
    this.elbowBend = best.bend;
    this.foreTwist = best.foreTwist;
    this.wristTwist = best.wristTwist;
    this.elbowIn = best.elbowIn;
    this.fore.position.y = this.upperLen0 * this.k1;
    this.hand.position.y = this.foreLen0 * this.k2;
    this.upperProxy.scale.set(1, this.k1, 1);
    this.foreProxy.scale.set(1, this.k2, 1);
    this.scene.position.copy(this.shoulder).sub(this.shoulderOffset);
    this.upper.quaternion.copy(this.upperParentQ).invert().multiply(best.Qu);
    this.fore.quaternion.copy(best.Qu).invert().multiply(best.Qf);
    this.hand.quaternion.copy(best.Qf).invert().multiply(this._handQ);
    this.root.updateMatrixWorld(true);

    this.error = this.hand.getWorldPosition(_v).distanceTo(_v2.copy(this.wrist).applyMatrix4(this.root.matrixWorld));
    const dy = this.dir.dot(_y);
    this.wristAngles.lateral = Math.atan2(this.dir.dot(_x), dy);
    this.wristAngles.flex = Math.atan2(this.dir.dot(_z), dy);
    this.wristAngles.bend = Math.acos(THREE.MathUtils.clamp(dy, -1, 1));
  }
}
