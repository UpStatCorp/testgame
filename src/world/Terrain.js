import * as THREE from 'three';
import { SimplexNoise, smoothstep, lerp, clamp } from '../core/MathUtils.js';
import { WORLD } from './WorldConfig.js';

// Distance from point to segment
function distToSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz), 0, 1);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

export function distanceToPaths(x, z) {
  let best = Infinity;
  for (const path of WORLD.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const d = distToSegment(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Procedural heightfield terrain. Height is computed analytically once into a grid,
 * then sampled bilinearly so gameplay height queries match the rendered mesh.
 */
export class Terrain {
  constructor() {
    this.noise = new SimplexNoise(WORLD.seed);
    this.noise2 = new SimplexNoise(WORLD.seed + 17);
    this.size = WORLD.size;
    this.segments = WORLD.segments;
    this.cell = this.size / this.segments;
    this.half = this.size / 2;
    this.verts = this.segments + 1;
    this.heights = new Float32Array(this.verts * this.verts);
    for (let iz = 0; iz < this.verts; iz++) {
      for (let ix = 0; ix < this.verts; ix++) {
        const x = -this.half + ix * this.cell;
        const z = -this.half + iz * this.cell;
        this.heights[iz * this.verts + ix] = this.computeHeight(x, z);
      }
    }
    this.mesh = this.buildMesh();
  }

  // Wobbly lake mask in [0..1] (1 = deep water)
  lakeFactor(x, z, lake) {
    const dx = x - lake.x, dz = z - lake.z;
    const ang = Math.atan2(dz, dx);
    const r = lake.radius * (1 + 0.18 * Math.sin(ang * 3 + 1.3) + 0.1 * Math.sin(ang * 5 - 0.4));
    const d = Math.sqrt(dx * dx + dz * dz);
    return 1 - smoothstep(r * 0.45, r * 1.15, d);
  }

  computeHeight(x, z) {
    const n = this.noise;
    let h = 4.5;
    h += n.fbm(x * 0.0065, z * 0.0065, 4) * 12;
    h += n.fbm(x * 0.025 + 40, z * 0.025, 3) * 2.2;
    h += (n.ridged(x * 0.012, z * 0.012, 3) - 0.3) * 6;

    // Mountains ring at the edge of the map
    const r = Math.sqrt(x * x + z * z);
    const m = smoothstep(150, 235, r);
    const ridge = n.ridged(x * 0.009 + 10, z * 0.009 - 7, 5);
    h += m * m * (45 + ridge * 110);

    // Paths are slightly carved and smoothed
    const pd = distanceToPaths(x, z);
    h -= (1 - smoothstep(1.5, 5, pd)) * 0.35;

    // Flatten village plateau
    const v = WORLD.village;
    const vd = Math.hypot(x - v.x, z - v.z);
    const vt = smoothstep(v.radius * 0.8, v.radius * 1.5, vd);
    h = lerp(v.height + n.fbm(x * 0.05, z * 0.05, 2) * 0.25, h, vt);

    // Lakes
    for (const lake of [WORLD.lake, WORLD.pond]) {
      const lf = this.lakeFactor(x, z, lake);
      if (lf > 0) h = lerp(h, WORLD.waterLevel - 4.5 * (lake.radius / 34) - 0.6, smoothstep(0, 1, lf));
    }
    return h;
  }

  getHeight(x, z) {
    const fx = (x + this.half) / this.cell;
    const fz = (z + this.half) / this.cell;
    const ix = clamp(Math.floor(fx), 0, this.segments - 1);
    const iz = clamp(Math.floor(fz), 0, this.segments - 1);
    const tx = clamp(fx - ix, 0, 1);
    const tz = clamp(fz - iz, 0, 1);
    const v = this.verts;
    const h00 = this.heights[iz * v + ix];
    const h10 = this.heights[iz * v + ix + 1];
    const h01 = this.heights[(iz + 1) * v + ix];
    const h11 = this.heights[(iz + 1) * v + ix + 1];
    // Match the triangulation of PlaneGeometry (diagonal from (0,1) to (1,0))
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  getNormal(x, z, target = new THREE.Vector3()) {
    const e = 0.6;
    const hl = this.getHeight(x - e, z), hr = this.getHeight(x + e, z);
    const hd = this.getHeight(x, z - e), hu = this.getHeight(x, z + e);
    return target.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  isWater(x, z) {
    return this.getHeight(x, z) < WORLD.waterLevel + 0.15;
  }

  buildMesh() {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const ix = Math.round((x + this.half) / this.cell);
      const iz = Math.round((z + this.half) / this.cell);
      pos.setY(i, this.heights[iz * this.verts + ix]);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color('#5d8a2e');
    const grassB = new THREE.Color('#7c9a3a');
    const grassDark = new THREE.Color('#3f6424');
    const dry = new THREE.Color('#a39a4a');
    const dirt = new THREE.Color('#7a5c3a');
    const sand = new THREE.Color('#b8a47a');
    const mud = new THREE.Color('#4a4032');
    const rock = new THREE.Color('#6f6c66');
    const rockDark = new THREE.Color('#55524d');
    const snow = new THREE.Color('#eef2f5');
    const wl = WORLD.waterLevel;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const slope = 1 - nrm.getY(i);
      const n1 = this.noise2.fbm(x * 0.03, z * 0.03, 3) * 0.5 + 0.5;
      const n2 = this.noise2.fbm(x * 0.11 + 9, z * 0.11, 2) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, n1);
      const forest = this.noise.fbm(x * 0.012 + 100, z * 0.012, 3) * 0.5 + 0.5;
      c.lerp(grassDark, smoothstep(0.45, 0.8, forest) * 0.7);
      c.lerp(dry, smoothstep(0.62, 0.9, n2) * 0.45);
      // paths & village ground
      const pd = distanceToPaths(x, z);
      c.lerp(dirt, (1 - smoothstep(1.2, 3.2 + n2 * 1.5, pd)) * 0.9);
      const vd = Math.hypot(x - WORLD.village.x, z - WORLD.village.z);
      c.lerp(dirt, (1 - smoothstep(6, 16, vd)) * 0.55 * n1);
      // shores
      c.lerp(sand, 1 - smoothstep(wl + 0.2, wl + 1.3, y));
      c.lerp(mud, 1 - smoothstep(wl - 1.5, wl - 0.2, y));
      // rock on steep slopes and mountains
      const rockT = smoothstep(0.28, 0.45, slope) + smoothstep(22, 40, y) * 0.8;
      c.lerp(n2 > 0.5 ? rock : rockDark, clamp(rockT, 0, 1));
      // snow caps
      const snowT = smoothstep(62 + n1 * 18, 80 + n1 * 18, y) * (1 - smoothstep(0.45, 0.7, slope));
      c.lerp(snow, snowT);
      // subtle brightness variation
      const b = 0.9 + n2 * 0.18;
      colors[i * 3] = c.r * b;
      colors[i * 3 + 1] = c.g * b;
      colors[i * 3 + 2] = c.b * b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      map: Terrain.makeDetailTexture(),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  // Tileable grayscale detail texture to break up flat vertex colors.
  static makeDetailTexture() {
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(s, s);
    const noise = new SimplexNoise(99);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        // tileable noise via torus mapping
        const a = (x / s) * Math.PI * 2, b = (y / s) * Math.PI * 2;
        const nx = Math.cos(a) * 3, ny = Math.sin(a) * 3, nz = Math.cos(b) * 3, nw = Math.sin(b) * 3;
        let v = noise.noise2D(nx + nz * 0.7, ny + nw * 0.7) * 0.5 + noise.noise2D(nx * 3 + nw, ny * 3 - nz) * 0.3;
        v += (Math.random() - 0.5) * 0.35;
        const g = Math.floor(clamp(0.86 + v * 0.14, 0, 1) * 255);
        const i = (y * s + x) * 4;
        img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(130, 130);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
}
