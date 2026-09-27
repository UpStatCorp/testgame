import * as THREE from 'three';
import { smoothstep, clamp } from '../core/MathUtils.js';

// Drives sun/moon light, ambient, fog and sky colors from a 0..24h clock.
const KEYS = [
  // hour, sky top, horizon, fog, sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity
  { h: 0, top: '#050a18', hor: '#141d33', fog: '#101828', sun: '#8fa6ff', si: 0.35, hs: '#26345a', hg: '#10141c', hi: 0.35 },
  { h: 4.5, top: '#0b1430', hor: '#2a3050', fog: '#1d2338', sun: '#8fa6ff', si: 0.3, hs: '#2a3558', hg: '#12141a', hi: 0.35 },
  { h: 6, top: '#3d5a8c', hor: '#f0a36a', fog: '#c89a80', sun: '#ffb070', si: 1.2, hs: '#8fa3c8', hg: '#4a3a2c', hi: 0.6 },
  { h: 8, top: '#4a86c8', hor: '#cfe0ea', fog: '#b9cfd9', sun: '#ffe2b0', si: 2.6, hs: '#b8d4f0', hg: '#5a5a3c', hi: 0.8 },
  { h: 12, top: '#3574c2', hor: '#c2dcec', fog: '#b4cfe0', sun: '#fff6e4', si: 3.1, hs: '#c4dcf5', hg: '#5f6040', hi: 0.9 },
  { h: 16.5, top: '#3f78bf', hor: '#d6dfe0', fog: '#c2d0d6', sun: '#ffe6bc', si: 2.7, hs: '#bcd2ee', hg: '#5f5a3c', hi: 0.8 },
  { h: 18.6, top: '#445d94', hor: '#f79a5c', fog: '#d09a7c', sun: '#ff9a50', si: 1.5, hs: '#8f98c0', hg: '#4c3a2c', hi: 0.6 },
  { h: 20, top: '#141c3c', hor: '#50405a', fog: '#2e2e42', sun: '#9aaaff', si: 0.35, hs: '#3a4268', hg: '#16161e', hi: 0.4 },
  { h: 24, top: '#050a18', hor: '#141d33', fog: '#101828', sun: '#8fa6ff', si: 0.35, hs: '#26345a', hg: '#10141c', hi: 0.35 },
].map((k) => ({
  ...k,
  top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), fog: new THREE.Color(k.fog),
  sun: new THREE.Color(k.sun), hs: new THREE.Color(k.hs), hg: new THREE.Color(k.hg),
}));

export class DayNightCycle {
  constructor(scene, sky, renderer, quality) {
    this.scene = scene;
    this.sky = sky;
    this.hour = 8.2;
    this.dayLengthSeconds = 600; // full 24h cycle in 10 minutes
    this.timeScale = 1;
    this.paused = false;

    this.sun = new THREE.DirectionalLight('#fff2d8', 3);
    this.sun.castShadow = true;
    const sm = quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const s = this.sun.shadow.camera;
    s.left = -70; s.right = 70; s.top = 70; s.bottom = -70; s.near = 1; s.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight('#c4dcf5', '#5f6040', 0.8);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.08);
    scene.add(this.ambient);

    scene.fog = new THREE.Fog('#b4cfe0', 40, 430);
    this.sunDir = new THREE.Vector3();
    this.isNight = false;
    this.daylight = 1;
    this._tmp = { top: new THREE.Color(), hor: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color() };
  }

  sample(hour) {
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (hour >= KEYS[i].h && hour <= KEYS[i + 1].h) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const t = smoothstep(0, 1, (hour - a.h) / (b.h - a.h));
    const o = this._tmp;
    o.top.copy(a.top).lerp(b.top, t);
    o.hor.copy(a.hor).lerp(b.hor, t);
    o.fog.copy(a.fog).lerp(b.fog, t);
    o.sun.copy(a.sun).lerp(b.sun, t);
    o.hs.copy(a.hs).lerp(b.hs, t);
    o.hg.copy(a.hg).lerp(b.hg, t);
    o.si = a.si + (b.si - a.si) * t;
    o.hi = a.hi + (b.hi - a.hi) * t;
    return o;
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
  }

  update(dt, focus) {
    if (!this.paused) this.hour = (this.hour + (dt * this.timeScale * 24) / this.dayLengthSeconds) % 24;
    // Sun path: rises in the east (+x), sets in the west, tilted to the south.
    const ang = ((this.hour - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), -0.35).normalize();
    const sunUp = this.sunDir.y;
    this.daylight = smoothstep(-0.08, 0.2, sunUp);
    this.isNight = sunUp < -0.05;

    const k = this.sample(this.hour);
    // Directional light is the sun by day, the moon by night
    const lightDir = sunUp > -0.05 ? this.sunDir : this.sunDir.clone().negate().setZ(0.2).normalize();
    const elevationFade = clamp(Math.abs(lightDir.y) * 4, 0, 1);
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.si * elevationFade;
    this.sun.position.copy(focus).addScaledVector(lightDir, 180);
    this.sun.target.position.copy(focus);
    // Snap shadow camera to texels to avoid shimmering
    this.sun.target.updateMatrixWorld();

    this.hemi.color.copy(k.hs);
    this.hemi.groundColor.copy(k.hg);
    this.hemi.intensity = k.hi;

    this.scene.fog.color.copy(k.fog);
    this.scene.fog.near = 30 + this.daylight * 30;
    this.scene.fog.far = 240 + this.daylight * 220;

    const u = this.sky.uniforms;
    u.topColor.value.copy(k.top);
    u.horizonColor.value.copy(k.fog).lerp(k.hor, 0.5);
    u.groundColor.value.copy(k.fog).multiplyScalar(0.85);
    u.sunDir.value.copy(this.sunDir);
    u.sunColor.value.copy(k.sun);
    u.starIntensity.value = 1 - smoothstep(-0.25, 0.02, sunUp);
  }

  get clockString() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
