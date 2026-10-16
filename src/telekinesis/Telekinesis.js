import * as THREE from 'three';

const BEAM_SEGMENTS = 24;

/**
 * Telekinesis staff mechanics:
 *  hover highlight + reticle, LMB hold to grab (object floats in front of the camera following look),
 *  wheel changes distance, release LMB throws, RMB gently drops. Visuals: glowing beam, swirl particles,
 *  aura around the object, point light; audio: continuous hum.
 */
export class Telekinesis {
  constructor(game) {
    this.game = game;
    this.hovered = null;
    this.held = null;
    this.holdDistance = 4;
    this.minDist = 2;
    this.maxDist = 12;
    this.maxGrabRange = 18;
    this.throwSpeed = 30;
    this.hum = null;
    this.chargeTime = 0;
    this.target = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.prevHeldPos = new THREE.Vector3();

    // Beam: a camera-facing ribbon along a bezier curve (updated per frame)
    const positions = new Float32Array((BEAM_SEGMENTS + 1) * 2 * 3);
    const uvs = new Float32Array((BEAM_SEGMENTS + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= BEAM_SEGMENTS; i++) {
      uvs[i * 4] = i / BEAM_SEGMENTS; uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = i / BEAM_SEGMENTS; uvs[i * 4 + 3] = 1;
      if (i < BEAM_SEGMENTS) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    this.beamUniforms = { time: { value: 0 }, intensity: { value: 0 } };
    this.beam = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.beamUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float time, intensity;
          varying vec2 vUv;
          void main() {
            float across = abs(vUv.y - 0.5) * 2.0;
            float core = smoothstep(1.0, 0.0, across);
            float pulse = 0.55 + 0.45 * sin(vUv.x * 40.0 - time * 18.0);
            float wave = 0.7 + 0.3 * sin(vUv.x * 13.0 + time * 7.0);
            vec3 col = mix(vec3(0.25, 0.55, 1.0), vec3(0.8, 0.95, 1.0), core * core);
            float a = core * pulse * wave * intensity * smoothstep(0.0, 0.08, vUv.x);
            gl_FragColor = vec4(col * 1.8, a);
          }`,
      })
    );
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.beam.renderOrder = 6;
    game.scene.add(this.beam);

    // Aura sphere around held/hovered object
    this.aura = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, strength: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main(){
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position,1.0);
            vV = normalize(-mv.xyz); vP = position;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float time, strength;
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main(){
            float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
            float bands = 0.6 + 0.4 * sin(vP.y * 10.0 + time * 6.0);
            gl_FragColor = vec4(vec3(0.35, 0.7, 1.0) * 1.5, rim * bands * strength);
          }`,
      })
    );
    this.aura.visible = false;
    this.aura.renderOrder = 7;
    game.scene.add(this.aura);

    this.light = new THREE.PointLight('#5fb8ff', 0, 8, 2);
    game.scene.add(this.light);
    this._v = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  findTarget() {
    const game = this.game;
    const origin = game.camera.position;
    const dir = game.cameraRig.forward;
    const hit = game.physics.raycastBodies(origin, dir, this.maxGrabRange);
    if (!hit || !hit.body.tk) return null;
    // blocked by walls/terrain?
    const block = game.physics.raycastStatic(origin, dir, hit.distance);
    if (block < hit.distance - 0.3) return null;
    return hit.body;
  }

  setHighlight(body, on) {
    if (!body) return;
    body.mesh.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.emissive) return;
      if (on) {
        if (!o.userData.tkOrigMat) {
          o.userData.tkOrigMat = o.material;
          o.material = o.material.clone();
        }
        o.material.emissive = new THREE.Color('#2a78ff');
        o.material.emissiveIntensity = 0.55;
      } else if (o.userData.tkOrigMat) {
        o.material.dispose();
        o.material = o.userData.tkOrigMat;
        delete o.userData.tkOrigMat;
      }
    });
  }

  handleInput(input, dt) {
    const game = this.game;
    if (!this.held) {
      const t = this.findTarget();
      if (t !== this.hovered) {
        this.setHighlight(this.hovered, false);
        this.hovered = t;
        this.setHighlight(t, true);
      }
      if (input.wasMousePressed(0) && this.hovered) this.grab(this.hovered);
      else if (input.wasMousePressed(0)) {
        // fizzle
        game.weapons.viewModel.getTipWorld(this.tip);
        game.particles.magicBurst(this.tip, '#7fd4ff', 8);
        game.audio.play('magic', { volume: 0.3 });
      }
    } else {
      if (input.wheel !== 0) this.holdDistance = THREE.MathUtils.clamp(this.holdDistance - input.wheel * 0.7, this.minDist, this.maxDist);
      if (input.isDown('KeyQ')) this.holdDistance = Math.max(this.minDist, this.holdDistance - dt * 5);
      if (input.isDown('KeyR')) this.holdDistance = Math.min(this.maxDist, this.holdDistance + dt * 5);
      this.chargeTime += dt;
      if (input.wasMousePressed(2)) this.release(false);
      else if (!input.isMouseDown(0)) this.release(true);
    }
  }

  grab(body) {
    const game = this.game;
    this.held = body;
    body.held = true;
    game.physics.wake(body);
    this.setHighlight(body, true);
    this.hovered = null;
    this.holdDistance = THREE.MathUtils.clamp(game.camera.position.distanceTo(body.position), this.minDist + 1, 6);
    this.chargeTime = 0;
    this.prevHeldPos.copy(body.position);
    game.audio.play('grab');
    this.hum = game.audio.startLoop('tkHum');
    game.particles.magicBurst(body.position, '#8fd8ff', 30);
    game.events.emit('tk:grab', body);
  }

  release(throwIt) {
    const body = this.held;
    if (!body) {
      if (!throwIt && this.hovered) {
        this.setHighlight(this.hovered, false);
        this.hovered = null;
      }
      return;
    }
    const game = this.game;
    body.held = false;
    this.setHighlight(body, false);
    if (throwIt) {
      const dir = game.cameraRig.forward;
      // heavier objects fly slower; a short hold still throws decently
      const speed = this.throwSpeed * Math.min(1, 1.6 / Math.sqrt(body.mass)) * (0.7 + Math.min(0.3, this.chargeTime * 0.3));
      body.velocity.copy(dir).multiplyScalar(speed);
      body.velocity.y += 1.5;
      body.angular.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
      body.dangerTime = 2;
      game.audio.play('throw');
      game.particles.magicBurst(body.position, '#b0e8ff', 25);
      game.cameraRig.addTrauma(0.1);
    } else {
      body.velocity.multiplyScalar(0.3);
    }
    game.physics.wake(body);
    this.held = null;
    if (this.hum) {
      this.hum.stop();
      this.hum = null;
    }
    game.events.emit('tk:release', body);
  }

  update(dt, time) {
    const game = this.game;
    const equippedStaff = game.weapons.def.id === 'staff';
    if (!equippedStaff && this.hovered) {
      this.setHighlight(this.hovered, false);
      this.hovered = null;
    }
    const body = this.held;
    this.beamUniforms.time.value = time;
    this.aura.material.uniforms.time.value = time;

    if (body) {
      // Target point in front of the camera; spring the body toward it
      const cam = game.camera.position;
      this.target.copy(cam).addScaledVector(game.cameraRig.forward, this.holdDistance + body.radius);
      // keep it floating clearly above the ground
      const gh = game.terrain.getHeight(this.target.x, this.target.z) + body.radius + 0.9;
      if (this.target.y < gh) this.target.y = gh;
      const toT = this._v.subVectors(this.target, body.position);
      // Velocity servo toward the target point (heavier objects respond more sluggishly)
      const desired = this._c.copy(toT).multiplyScalar(11);
      if (desired.length() > 28) desired.setLength(28);
      const resp = Math.min(1, (dt * 14) / Math.sqrt(Math.max(1, body.mass)));
      body.velocity.lerp(desired, resp);
      // bobbing float + gentle spin
      body.velocity.y += Math.sin(time * 3) * 0.6 * dt;
      body.angular.set(0.4, 1.2, 0.3);
      // too far (e.g. snagged behind a wall) -> drop
      if (toT.length() > 8) this.release(false);
      if (this.hum) this.hum.setIntensity(Math.min(1, body.velocity.length() / 10));
    }

    // Visuals
    const showBeam = !!this.held;
    this.beam.visible = showBeam;
    const targetBody = this.held || (equippedStaff ? this.hovered : null);
    if (targetBody) {
      this.aura.visible = true;
      this.aura.position.copy(targetBody.position);
      this.aura.scale.setScalar(targetBody.radius * (this.held ? 1.7 : 1.45) * (1 + Math.sin(time * 5) * 0.04));
      this.aura.material.uniforms.strength.value = this.held ? 1 : 0.55;
      this.light.position.copy(targetBody.position);
      this.light.intensity = this.held ? 6 + Math.sin(time * 9) * 1.5 : 1.5;
    } else {
      this.aura.visible = false;
      this.light.intensity = 0;
    }

    if (showBeam) {
      game.weapons.viewModel.getTipWorld(this.tip);
      this.updateBeam(this.tip, this.held.position, time);
      this.beamUniforms.intensity.value = 1;
      // particles streaming along the beam + swirl around object
      if (Math.random() < 0.9) {
        const u = Math.random();
        const p = this.bezier(u, this._p);
        game.particles.emit({ position: p, count: 1, speed: 0.4, color: '#a8e4ff', colorEnd: '#3060ff', size: 0.07, life: 0.4, drag: 2 });
      }
      const b = this.held;
      const a = time * 7;
      for (let i = 0; i < 2; i++) {
        const ang = a + i * Math.PI;
        const r = b.radius * 1.5;
        const pos = new THREE.Vector3(b.position.x + Math.cos(ang) * r, b.position.y + Math.sin(time * 3 + i) * b.radius, b.position.z + Math.sin(ang) * r);
        game.particles.emit({ position: pos, count: 1, speed: 0.3, color: '#c8f0ff', colorEnd: '#4070ff', size: 0.09, life: 0.6, drag: 1, gravity: 0.5 });
      }
      // crystal sparkle
      game.particles.emit({ position: this.tip, count: 1, speed: 0.6, color: '#e0f8ff', colorEnd: '#4a8aff', size: 0.06, life: 0.3, drag: 3 });
    }
  }

  bezier(u, out) {
    const a = this.bezA, c = this.bezC, b = this.bezB;
    const iu = 1 - u;
    return out.set(
      iu * iu * a.x + 2 * iu * u * c.x + u * u * b.x,
      iu * iu * a.y + 2 * iu * u * c.y + u * u * b.y,
      iu * iu * a.z + 2 * iu * u * c.z + u * u * b.z
    );
  }

  updateBeam(from, to, time) {
    const cam = this.game.camera.position;
    this.bezA = from.clone();
    this.bezB = to.clone();
    // control point: along the look ray, slightly lifted -> graceful curve
    const mid = this.game.camera.position.clone().addScaledVector(this.game.cameraRig.forward, from.distanceTo(to) * 0.55);
    mid.y += 0.3 + Math.sin(time * 2) * 0.1;
    this.bezC = mid;
    const pos = this.beam.geometry.attributes.position;
    const p = new THREE.Vector3(), p2 = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (let i = 0; i <= BEAM_SEGMENTS; i++) {
      const u = i / BEAM_SEGMENTS;
      this.bezier(u, p);
      // wobble
      p.x += Math.sin(u * 20 + time * 12) * 0.03 * Math.sin(u * Math.PI);
      p.y += Math.cos(u * 17 + time * 10) * 0.03 * Math.sin(u * Math.PI);
      this.bezier(Math.min(1, u + 0.01), p2);
      tangent.subVectors(p2, p).normalize();
      toCam.subVectors(cam, p).normalize();
      side.crossVectors(tangent, toCam).normalize();
      const w = 0.035 + u * 0.06;
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
    }
    pos.needsUpdate = true;
  }
}
