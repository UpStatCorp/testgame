import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 pcolor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float pixelRatio;
  void main() {
    vAlpha = alpha;
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio * (320.0 / max(-mv.z, 0.1));
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float softness;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, softness, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }`;

class ParticlePool {
  constructor(max, additive, softness) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    this.particles = [];
    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, softness: { value: softness } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  spawn(p) {
    if (!this.free.length) {
      // recycle oldest
      const old = this.particles.shift();
      this.free.push(old.index);
    }
    p.index = this.free.pop();
    this.particles.push(p);
  }

  update(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      const idx = p.index;
      if (p.age >= p.life) {
        this.alphas[idx] = 0;
        this.sizes[idx] = 0;
        this.free.push(idx);
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      const t = p.age / p.life;
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      if (p.swirl) {
        const a = p.age * p.swirl;
        p.pos.x += Math.cos(a) * dt * 0.6;
        p.pos.z += Math.sin(a) * dt * 0.6;
      }
      p.pos.addScaledVector(p.vel, dt);
      this.positions[idx * 3] = p.pos.x;
      this.positions[idx * 3 + 1] = p.pos.y;
      this.positions[idx * 3 + 2] = p.pos.z;
      const c0 = p.color, c1 = p.colorEnd || p.color;
      this.colors[idx * 3] = c0.r + (c1.r - c0.r) * t;
      this.colors[idx * 3 + 1] = c0.g + (c1.g - c0.g) * t;
      this.colors[idx * 3 + 2] = c0.b + (c1.b - c0.b) * t;
      this.sizes[idx] = p.size * (p.sizeEnd !== undefined ? 1 + (p.sizeEnd - 1) * t : 1);
      const fadeIn = Math.min(1, p.age / (p.fadeIn || 0.05));
      this.alphas[idx] = p.alpha * fadeIn * (1 - t * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }
}

/** Central particle manager: sparks, magic, fire, smoke, splashes, dust. */
export class Particles {
  constructor(scene) {
    this.glow = new ParticlePool(4000, true, 0.0);
    this.soft = new ParticlePool(1500, false, 0.2);
    scene.add(this.glow.points, this.soft.points);
    this._c = new THREE.Color();
  }

  /**
   * emit({ position, count, speed, spread(dir jitter 0..1), dir, color, colorEnd, size, sizeEnd,
   *        life, gravity, drag, additive, alpha, box(spawn radius), swirl })
   */
  emit(o) {
    const pool = o.additive === false ? this.soft : this.glow;
    const count = o.count ?? 10;
    const color = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color ?? '#ffffff');
    const colorEnd = o.colorEnd ? (o.colorEnd instanceof THREE.Color ? o.colorEnd : new THREE.Color(o.colorEnd)) : null;
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3();
      if (o.dir) {
        dir.copy(o.dir).normalize();
        dir.x += (Math.random() - 0.5) * 2 * (o.spread ?? 0.3);
        dir.y += (Math.random() - 0.5) * 2 * (o.spread ?? 0.3);
        dir.z += (Math.random() - 0.5) * 2 * (o.spread ?? 0.3);
        dir.normalize();
      } else {
        dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      }
      const speed = (o.speed ?? 3) * (0.5 + Math.random() * 0.8);
      const pos = new THREE.Vector3().copy(o.position);
      if (o.box) {
        pos.x += (Math.random() - 0.5) * 2 * o.box;
        pos.y += (Math.random() - 0.5) * 2 * (o.boxY ?? o.box);
        pos.z += (Math.random() - 0.5) * 2 * o.box;
      }
      const lifeJ = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      pool.spawn({
        pos,
        vel: dir.multiplyScalar(speed),
        color,
        colorEnd,
        size: (o.size ?? 0.2) * (0.7 + Math.random() * 0.6),
        sizeEnd: o.sizeEnd,
        life: lifeJ,
        age: 0,
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 1,
        alpha: o.alpha ?? 1,
        fadeIn: o.fadeIn,
        swirl: o.swirl,
      });
    }
  }

  // ---- Presets ----
  hitSparks(position, dir, heavy = false) {
    this.emit({ position, dir, spread: 0.7, count: heavy ? 40 : 18, speed: heavy ? 9 : 6, color: '#ffe0a0', colorEnd: '#ff5010', size: heavy ? 0.16 : 0.1, life: 0.45, gravity: -14, drag: 2 });
  }
  blood(position, dir, color = '#6a8f2a') {
    // Forest creatures bleed sap
    this.emit({ position, dir, spread: 0.8, count: 16, speed: 4, color, colorEnd: '#2d3d12', size: 0.14, life: 0.6, gravity: -12, drag: 1.5, additive: false });
  }
  woodChips(position, dir) {
    this.emit({ position, dir, spread: 0.8, count: 14, speed: 5, color: '#b08850', colorEnd: '#6a4a2a', size: 0.12, life: 0.7, gravity: -15, drag: 1, additive: false });
  }
  dust(position, count = 12, color = '#b8a88a') {
    this.emit({ position, count, speed: 1.5, color, size: 0.5, sizeEnd: 2.5, life: 1.2, gravity: 0.5, drag: 2, additive: false, alpha: 0.35, box: 0.3 });
  }
  magicBurst(position, color = '#7fd4ff', count = 30) {
    this.emit({ position, count, speed: 4, color, colorEnd: '#4050ff', size: 0.18, life: 0.7, drag: 3, gravity: 1 });
  }
  splash(position, strength = 1) {
    this.emit({ position, dir: new THREE.Vector3(0, 1, 0), spread: 0.5, count: Math.floor(20 * strength), speed: 5 * strength, color: '#d8f0ff', colorEnd: '#6aa8c8', size: 0.14, life: 0.8, gravity: -16, drag: 0.5, additive: false, alpha: 0.8 });
  }
  deathPuff(position) {
    this.emit({ position, count: 30, speed: 2, color: '#5b6b3a', colorEnd: '#2a2a22', size: 0.7, sizeEnd: 3, life: 1.6, gravity: 0.8, drag: 2, additive: false, alpha: 0.5, box: 0.5 });
    this.emit({ position, count: 25, speed: 3, color: '#b8ff7a', colorEnd: '#2a6a2a', size: 0.14, life: 1.2, gravity: 1.5, drag: 1.5 });
  }
  heal(position) {
    this.emit({ position, count: 26, speed: 1.2, dir: new THREE.Vector3(0, 1, 0), spread: 0.9, color: '#9dff9a', colorEnd: '#2aff6a', size: 0.12, life: 1.2, gravity: 1.5, drag: 1, box: 0.4 });
  }

  update(dt) {
    this.glow.update(dt);
    this.soft.update(dt);
  }
}
