import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/MathUtils.js';

/** First-person camera: smoothed look, head bob (walk/sprint), landing dip, strafe roll, trauma shake, dynamic FOV. */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.baseFov = 75;
    this.fov = 75;
    this.eyeHeight = 1.65;
    this.smoothedEye = null;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.roll = 0;
    this.trauma = 0;
    this.time = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.bobOffset = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.basePosition = new THREE.Vector3();
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeR = 0;
    this._neck = new THREE.Vector3();
  }

  /**
   * Explicit look-down curve: t = smoothstep(0.3, 1.2, -pitch); forward = FWD_MAX*t, down = DOWN_MAX*t.
   * Strictly (0,0,0) for pitch >= -0.3, so normal play is unchanged.
   */
  static neckDelta(pitch, yaw, out = new THREE.Vector3()) {
    const t = smoothstep(0.3, 1.2, -pitch);
    const forward = CameraRig.NECK_FWD_MAX * t;
    return out.set(-Math.sin(yaw) * forward, -CameraRig.NECK_DOWN_MAX * t, -Math.cos(yaw) * forward);
  }

  addLook(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    this.lookDX = dx;
    this.lookDY = dy;
  }

  addTrauma(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  land(speed) {
    this.landVel -= Math.min(speed, 20) * 0.045;
  }

  update(dt, player) {
    this.time += dt;
    // Smooth vertical eye position (stairs, crouch transitions)
    const targetEyeY = player.position.y + player.eyeHeight;
    if (this.smoothedEye === null) this.smoothedEye = targetEyeY;
    const dy = targetEyeY - this.smoothedEye;
    this.smoothedEye = Math.abs(dy) > 2 ? targetEyeY : damp(this.smoothedEye, targetEyeY, 18, dt);

    // Head bob driven by horizontal speed
    const hs = Math.hypot(player.velocity.x, player.velocity.z);
    const moving = player.onGround && hs > 0.5;
    const sprint = player.sprinting;
    const targetAmt = moving ? (sprint ? 1 : 0.55) * Math.min(1, hs / 4) : 0;
    this.bobAmount = damp(this.bobAmount, targetAmt, 8, dt);
    this.bobPhase += dt * hs * (sprint ? 1.45 : 1.75);
    const ampY = sprint ? 0.075 : 0.045;
    const ampX = sprint ? 0.05 : 0.03;
    this.bobOffset.set(Math.cos(this.bobPhase) * ampX * this.bobAmount, Math.abs(Math.sin(this.bobPhase)) * ampY * this.bobAmount * 1.4 - ampY * 0.5 * this.bobAmount, 0);

    // Landing spring
    this.landVel += (-this.landDip * 90 - this.landVel * 12) * dt;
    this.landDip += this.landVel * dt;

    // Strafe roll
    const right = player.localVelocity ? player.localVelocity.x : 0;
    this.roll = damp(this.roll, -right * 0.006 + (sprint ? Math.sin(this.bobPhase) * 0.006 : 0), 6, dt);

    // Trauma shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma;
    const t = this.time * 25;
    const sx = (Math.sin(t * 1.3) + Math.sin(t * 2.7) * 0.5) * shake * 0.04;
    const sy = (Math.cos(t * 1.1) + Math.sin(t * 3.1) * 0.5) * shake * 0.04;
    const sr = Math.sin(t * 0.9) * shake * 0.05;

    this.shakeX = sx;
    this.shakeY = sy;
    this.shakeR = sr;
    this.place(player);

    // FOV kick when sprinting
    const cam = this.camera;
    const targetFov = this.baseFov + (sprint && hs > 5 ? 7 : 0);
    this.fov = damp(this.fov, targetFov, 6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.camera.getWorldDirection(this.forward);
  }

  /**
   * Places/orients the camera from the current rig state without advancing it (no smoothing,
   * bob or shake steps). Called by update() and again at the end of the gameplay step, after
   * systems that move the player (e.g. creature separation), so the camera never lags a step.
   */
  place(player) {
    const cam = this.camera;
    this.euler.set(this.pitch + this.shakeY, this.yaw + this.shakeX, this.roll + this.shakeR);
    cam.quaternion.setFromEuler(this.euler);
    // Apply bob in camera-local space (sideways + vertical)
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    cam.position.set(player.position.x, this.smoothedEye + this.bobOffset.y + this.landDip, player.position.z);
    cam.position.x += rightX * this.bobOffset.x;
    cam.position.z += rightZ * this.bobOffset.x;
    this.basePosition.copy(cam.position); // pre-neck position (exactly the old formula)
    // Eyes move forward/down when looking down (neck pivot approximation). Zero for pitch >= -0.3.
    cam.position.add(CameraRig.neckDelta(this.pitch, this.yaw, this._neck));
    cam.getWorldDirection(this.forward);
  }
}

CameraRig.NECK_FWD_MAX = 0.3; // m, must stay <= 0.3 (< player radius 0.35)
CameraRig.NECK_DOWN_MAX = 0.0; // m
