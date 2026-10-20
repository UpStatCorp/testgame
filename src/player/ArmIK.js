import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qw = new THREE.Quaternion();

/** Rotates `bone` (in world space) so the direction from `pivot` to `from` turns into `pivot`->`to`. */
export function aimBone(bone, pivot, from, to) {
  _from.subVectors(from, pivot).normalize();
  _to.subVectors(to, pivot).normalize();
  _q.setFromUnitVectors(_from, _to);
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q.multiply(_qw)));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (upper -> lower -> end), solved in world space on top of the animated pose.
 * Bone lengths are taken from the rig, never stretched: an unreachable target leaves the arm straight
 * and pointing at it. The elbow bends in the plane containing `poleWorld`.
 */
export class TwoBoneIK {
  constructor(upper, lower, end) {
    this.upper = upper;
    this.lower = lower;
    this.end = end;
  }

  /** Returns the remaining distance from the end bone to the target (0 when reached). */
  solve(targetPos, poleWorld, targetQuat = null) {
    const { upper, lower, end } = this;
    upper.getWorldPosition(_a);
    lower.getWorldPosition(_b);
    end.getWorldPosition(_c);
    const l1 = _a.distanceTo(_b);
    const l2 = _b.distanceTo(_c);
    _t.copy(targetPos);
    _dir.subVectors(_t, _a);
    const dist = THREE.MathUtils.clamp(_dir.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    _dir.normalize();

    // Elbow: law of cosines, offset towards the pole, perpendicular to the shoulder->target line
    const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const along = l1 * cosA;
    const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    _pole.copy(poleWorld);
    _bend.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir));
    if (_bend.lengthSq() < 1e-8) _bend.set(0, -1, 0).addScaledVector(_dir, _dir.y);
    _bend.normalize();
    _elbow.copy(_a).addScaledVector(_dir, along).addScaledVector(_bend, out);

    aimBone(upper, _a, _b, _elbow);
    lower.getWorldPosition(_b);
    end.getWorldPosition(_c);
    aimBone(lower, _b, _c, _t);

    if (targetQuat) {
      lower.getWorldQuaternion(_qp);
      end.quaternion.copy(_qp.invert().multiply(targetQuat));
      end.updateMatrixWorld(true);
    }
    return end.getWorldPosition(_c).distanceTo(targetPos);
  }
}
