import * as THREE from 'three';
import { mulberry32, SimplexNoise } from '../core/MathUtils.js';
import { jitterGeometry } from './ProceduralModels.js';

/** Distant mountain silhouettes, drifting clouds, pollen motes by day and fireflies by night. */
export class Atmosphere {
  constructor(scene, dayNight, quality) {
    this.scene = scene;
    this.dayNight = dayNight;
    this.rand = mulberry32(4242);
    this.buildDistantMountains();
    this.buildClouds();
    this.buildMotes(quality);
  }

  buildDistantMountains() {
    const noise = new SimplexNoise(77);
    const segs = 160;
    const rings = [
      { r: 330, h: 150, color: '#5f6f7a' },
      { r: 420, h: 200, color: '#71808c' },
    ];
    for (const ring of rings) {
      const positions = [];
      const colors = [];
      const col = new THREE.Color(ring.color);
      const snow = new THREE.Color('#e8eef2');
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const h0 = ring.h * (0.35 + 0.65 * Math.abs(noise.fbm(Math.cos(a0) * 2 + ring.r, Math.sin(a0) * 2, 4)) * 1.6);
        const h1 = ring.h * (0.35 + 0.65 * Math.abs(noise.fbm(Math.cos(a1) * 2 + ring.r, Math.sin(a1) * 2, 4)) * 1.6);
        const x0 = Math.cos(a0) * ring.r, z0 = Math.sin(a0) * ring.r;
        const x1 = Math.cos(a1) * ring.r, z1 = Math.sin(a1) * ring.r;
        const base = -20;
        positions.push(x0, base, z0, x1, base, z1, x1, h1, z1, x0, base, z0, x1, h1, z1, x0, h0, z0);
        const cs = [0, 0, 1, 0, 1, 1];
        const hs = [base, base, h1, base, h1, h0];
        for (let k = 0; k < 6; k++) {
          const c = col.clone().multiplyScalar(0.8 + (hs[k] / ring.h) * 0.3);
          if (hs[k] > ring.h * 0.8) c.lerp(snow, 0.7);
          colors.push(c.r, c.g, c.b);
        }
        void cs;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = -5;
      this.scene.add(mesh);
    }
  }

  buildClouds() {
    this.clouds = new THREE.Group();
    this.cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, fog: false, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.25 });
    const rand = this.rand;
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Group();
      const puffs = 4 + Math.floor(rand() * 5);
      for (let j = 0; j < puffs; j++) {
        const g = new THREE.IcosahedronGeometry(8 + rand() * 10, 1);
        jitterGeometry(g, 3, rand);
        const m = new THREE.Mesh(g, this.cloudMat);
        m.position.set((j - puffs / 2) * 10 + rand() * 6, rand() * 5, rand() * 12 - 6);
        m.scale.y = 0.45 + rand() * 0.2;
        c.add(m);
      }
      const a = rand() * Math.PI * 2, r = 80 + rand() * 450;
      c.position.set(Math.cos(a) * r, 140 + rand() * 60, Math.sin(a) * r);
      c.rotation.y = rand() * Math.PI;
      this.clouds.add(c);
    }
    this.scene.add(this.clouds);
  }

  buildMotes(quality) {
    const count = quality === 'low' ? 150 : 400;
    this.moteCount = count;
    const pos = new Float32Array(count * 3);
    this.motePhase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.motePhase[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(this.motePhase, 1));
    this.moteUniforms = {
      time: { value: 0 },
      center: { value: new THREE.Vector3() },
      night: { value: 0 },
      pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.moteUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float time, night, pixelRatio;
        uniform vec3 center;
        attribute float phase;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec3 p = position;
          p.x += sin(time * 0.3 + phase) * 2.0;
          p.y += sin(time * 0.5 + phase * 1.3) * 0.8;
          p.z += cos(time * 0.25 + phase * 0.7) * 2.0;
          // wrap around the camera
          p.xz = center.xz + mod(p.xz - center.xz + 30.0, 60.0) - 30.0;
          p.y += center.y - 2.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float blink = 0.5 + 0.5 * sin(time * 2.5 + phase * 5.0);
          vAlpha = mix(0.35, blink * blink, night) * smoothstep(60.0, 20.0, -mv.z) * smoothstep(1.5, 5.0, -mv.z);
          vColor = mix(vec3(1.0, 0.95, 0.8), vec3(0.75, 1.0, 0.35), night);
          gl_PointSize = min(mix(0.09, 0.2, night) * pixelRatio * 320.0 / max(-mv.z, 0.5), 18.0 * pixelRatio);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d) * vAlpha;
          gl_FragColor = vec4(vColor * 1.6, a);
        }`,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  update(dt, time, cameraPos) {
    const dn = this.dayNight;
    // Clouds drift with wind and wrap around
    for (const c of this.clouds.children) {
      c.position.x += dt * 3;
      if (c.position.x > 550) c.position.x = -550;
    }
    const light = 0.25 + dn.daylight * 0.75;
    this.cloudMat.color.copy(dn.sun.color).lerp(new THREE.Color('#ffffff'), 0.5).multiplyScalar(light);
    this.cloudMat.emissive.copy(this.scene.fog.color);
    this.cloudMat.emissiveIntensity = 0.5;
    this.moteUniforms.time.value = time;
    this.moteUniforms.center.value.copy(cameraPos);
    this.moteUniforms.night.value = 1 - dn.daylight;
  }
}
