import * as THREE from 'three';
import { clamp, damp } from '../core/MathUtils.js';

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

    const cam = this.camera;
    this.euler.set(this.pitch + sy, this.yaw + sx, this.roll + sr);
    cam.quaternion.setFromEuler(this.euler);
    // Apply bob in camera-local space (sideways + vertical)
    const rightV = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(player.position.x, this.smoothedEye + this.bobOffset.y + this.landDip, player.position.z);
    cam.position.addScaledVector(rightV, this.bobOffset.x);

    // FOV kick when sprinting
    const targetFov = this.baseFov + (sprint && hs > 5 ? 7 : 0);
    this.fov = damp(this.fov, targetFov, 6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.getWorldDirection(this.forward);
  }
}
