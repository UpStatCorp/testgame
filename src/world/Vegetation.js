import * as THREE from 'three';
import { mulberry32, smoothstep, randRange } from '../core/MathUtils.js';
import { WORLD } from './WorldConfig.js';
import { distanceToPaths } from './Terrain.js';
import {
  makePineGeometry, makeOakGeometry, makeBirchGeometry, makeBushGeometry, makeFernGeometry,
  makeRockGeometry, makeGrassTuftGeometry, makeFlowerGeometry, applyWind,
} from './ProceduralModels.js';

const TREE_TYPES = {
  pine: { make: makePineGeometry, trunkR: 0.3, wood: 4, variants: 3, wind: 0.35, href: 12 },
  oak: { make: makeOakGeometry, trunkR: 0.48, wood: 5, variants: 3, wind: 0.3, href: 8 },
  birch: { make: makeBirchGeometry, trunkR: 0.22, wood: 3, variants: 2, wind: 0.4, href: 8 },
};

/**
 * Procedurally scatters trees, bushes, ferns, rocks, grass and flowers with natural variation
 * (noise-driven density, random scale/rotation/offsets, spacing checks - no visible grid).
 */
export class Vegetation {
  constructor(scene, terrain, physics, exclusions, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.physics = physics;
    this.exclusions = exclusions;
    this.quality = quality;
    this.rand = mulberry32(WORLD.seed + 5);
    this.trees = [];
    this.treeMeshes = [];
    this.spacing = new Map(); // coarse hash for spacing checks
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.shaking = new Set();

    this.placeTrees();
    this.placeRocks();
    this.placeBushesAndFerns();
    this.placeGrass();
    this.placeFlowers();
  }

  isExcluded(x, z, pad = 0) {
    for (const e of this.exclusions) {
      const dx = x - e.x, dz = z - e.z;
      if (dx * dx + dz * dz < (e.r + pad) ** 2) return true;
    }
    return false;
  }

  spacingOk(x, z, minDist) {
    const k = (Math.floor(x / 4) * 1000 + Math.floor(z / 4));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.spacing.get(k + dx * 1000 + dz);
        if (!arr) continue;
        for (const p of arr) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < Math.max(minDist, p[2]) ** 2) return false;
      }
    }
    return true;
  }

  addSpacing(x, z, r) {
    const k = Math.floor(x / 4) * 1000 + Math.floor(z / 4);
    if (!this.spacing.has(k)) this.spacing.set(k, []);
    this.spacing.get(k).push([x, z, r]);
  }

  slopeAt(x, z) {
    return 1 - this.terrain.getNormal(x, z, this._p).y;
  }

  forestDensity(x, z) {
    const n = this.terrain.noise.fbm(x * 0.012 + 100, z * 0.012, 3) * 0.5 + 0.5;
    let d = smoothstep(0.3, 0.75, n);
    const vd = Math.hypot(x - WORLD.village.x, z - WORLD.village.z);
    d *= smoothstep(WORLD.village.radius + 4, WORLD.village.radius + 22, vd);
    const pd = distanceToPaths(x, z);
    d *= smoothstep(2.5, 6, pd);
    // keep spawn meadow open-ish
    const sd = Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z);
    d *= 0.25 + 0.75 * smoothstep(8, 22, sd);
    return d;
  }

  // -------- trees --------
  placeTrees() {
    const rand = this.rand;
    const target = this.quality === 'lite' ? 400 : this.quality === 'low' ? 900 : 1700;
    const variantMats = [];
    const placements = { pine: [], oak: [], birch: [] };
    let attempts = 0;
    let placed = 0;
    while (placed < target && attempts < target * 25) {
      attempts++;
      const ang = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 200;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const h = this.terrain.getHeight(x, z);
      if (h < WORLD.waterLevel + 0.8 || h > 55) continue;
      if (this.slopeAt(x, z) > 0.4) continue;
      const dens = this.forestDensity(x, z);
      if (rand() > dens * 0.95 + 0.04) continue;
      if (this.isExcluded(x, z, 2)) continue;
      if (!this.spacingOk(x, z, 2.6)) continue;
      // Type distribution by altitude + noise
      const tn = this.terrain.noise2.fbm(x * 0.02, z * 0.02, 2);
      let type = 'oak';
      if (h > 18 || tn > 0.15) type = 'pine';
      else if (tn < -0.3) type = 'birch';
      if (rand() < 0.15) type = ['pine', 'oak', 'birch'][Math.floor(rand() * 3)];
      const scale = randRange(rand, 0.75, 1.3) * (type === 'pine' ? 1.1 : 1);
      placements[type].push({ x, z, y: h - 0.15, scale, rot: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.08, variant: Math.floor(rand() * TREE_TYPES[type].variants) });
      this.addSpacing(x, z, 2.2 * scale);
      placed++;
    }

    for (const [type, list] of Object.entries(placements)) {
      const def = TREE_TYPES[type];
      for (let v = 0; v < def.variants; v++) {
        const items = list.filter((p) => p.variant === v);
        if (!items.length) continue;
        const geo = def.make(WORLD.seed * 7 + v * 31 + type.length * 101);
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
        applyWind(mat, def.wind, def.href, 0.04);
        variantMats.push(mat);
        const mesh = new THREE.InstancedMesh(geo, mat, items.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `trees-${type}-${v}`;
        const color = new THREE.Color();
        items.forEach((p, i) => {
          const tree = {
            type, index: i, mesh, x: p.x, z: p.z, y: p.y, scale: p.scale, rot: p.rot, tilt: p.tilt,
            trunkR: def.trunkR * p.scale, height: 10 * p.scale, wood: def.wood, maxWood: def.wood,
            felled: false, shake: 0, id: this.trees.length,
          };
          this.setTreeMatrix(tree, 0);
          color.setHSL(0.25 + (this.rand() - 0.5) * 0.05, 0.35, 0.45 + (this.rand() - 0.5) * 0.12);
          const t = 0.85 + this.rand() * 0.3;
          mesh.setColorAt(i, color.setRGB(t, t * (0.95 + this.rand() * 0.1), t * 0.95));
          tree.collider = this.physics.addCircle(p.x, p.z, tree.trunkR + 0.05, p.y - 1, p.y + 6 * p.scale, { kind: 'tree', tree });
          this.trees.push(tree);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.scene.add(mesh);
        this.treeMeshes.push(mesh);
      }
    }
  }

  setTreeMatrix(tree, shakeAngle) {
    const q = this._q.setFromEuler(new THREE.Euler(tree.tilt + shakeAngle, tree.rot, tree.tilt * 0.5 + shakeAngle * 0.6, 'YXZ'));
    const s = tree.felled ? 0 : tree.scale;
    this._m.compose(this._p.set(tree.x, tree.y, tree.z), q, this._s.set(s, s, s));
    tree.mesh.setMatrixAt(tree.index, this._m);
    tree.mesh.instanceMatrix.needsUpdate = true;
  }

  shakeTree(tree) {
    tree.shake = 1;
    this.shaking.add(tree);
  }

  fellTree(tree) {
    tree.felled = true;
    this.setTreeMatrix(tree, 0);
    // stump
    const stump = new THREE.Mesh(
      new THREE.CylinderGeometry(tree.trunkR * 0.9, tree.trunkR * 1.2, 0.7, 7),
      new THREE.MeshLambertMaterial({ color: '#6a4b31', flatShading: true })
    );
    stump.position.set(tree.x, tree.y + 0.35, tree.z);
    stump.castShadow = stump.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.CircleGeometry(tree.trunkR * 0.88, 7), new THREE.MeshLambertMaterial({ color: '#c8a070' }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.351;
    stump.add(top);
    this.scene.add(stump);
    tree.collider.y1 = tree.y + 0.7;
    tree.collider.walkable = true;
    this.physics.update(tree.collider);
  }

  /** Analytic ray vs tree trunk cylinders. */
  raycastTrees(origin, dir, maxDist) {
    let best = null;
    const list = this.physics.query(origin.x + dir.x * maxDist * 0.5, origin.z + dir.z * maxDist * 0.5, maxDist, []);
    for (const c of list) {
      if (!c.data || c.data.kind !== 'tree') continue;
      const tree = c.data.tree;
      // 2D ray-circle
      const ox = origin.x - c.x, oz = origin.z - c.z;
      const a = dir.x * dir.x + dir.z * dir.z;
      if (a < 1e-6) continue;
      const b = 2 * (ox * dir.x + oz * dir.z);
      const r = c.r + 0.15;
      const cc = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * cc;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0 || t > maxDist) continue;
      const y = origin.y + dir.y * t;
      if (y < c.y0 || y > c.y1) continue;
      if (!best || t < best.distance) best = { tree, distance: t };
    }
    return best;
  }

  // -------- rocks --------
  placeRocks() {
    const rand = this.rand;
    const geos = [0, 1, 2, 3].map((i) => makeRockGeometry(WORLD.seed + 300 + i, 1));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
    const placements = geos.map(() => []);
    const total = this.quality === 'low' ? 260 : 420;
    let attempts = 0;
    let n = 0;
    while (n < total && attempts < total * 30) {
      attempts++;
      const ang = rand() * Math.PI * 2;
      const r = 20 + Math.sqrt(rand()) * 200;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const h = this.terrain.getHeight(x, z);
      if (h < WORLD.waterLevel - 1.5) continue;
      if (this.isExcluded(x, z, 2) || distanceToPaths(x, z) < 3) continue;
      const slope = this.slopeAt(x, z);
      // Big boulders prefer slopes/mountains, small ones anywhere
      const big = r > 150 || slope > 0.25 ? rand() < 0.8 : rand() < 0.25;
      const scale = big ? randRange(rand, 1.8, 4.5) * (r > 160 ? 1.6 : 1) : randRange(rand, 0.5, 1.3);
      if (!this.spacingOk(x, z, scale * 1.2)) continue;
      const v = Math.floor(rand() * geos.length);
      placements[v].push({ x, z, y: h - scale * 0.25, scale, sy: scale * randRange(rand, 0.7, 1.1), rot: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.4 });
      this.addSpacing(x, z, scale * 1.1);
      if (scale > 0.9) this.physics.addCircle(x, z, scale * 0.85, h - 1, h + scale * 0.7, { kind: 'rock' });
      n++;
    }
    placements.forEach((list, v) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geos[v], mat, list.length);
      const e = new THREE.Euler();
      list.forEach((p, i) => {
        this._q.setFromEuler(e.set(p.tilt, p.rot, p.tilt * 0.5));
        this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(p.scale, p.sy, p.scale * randRange(rand, 0.8, 1.2)));
        mesh.setMatrixAt(i, this._m);
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.name = 'rocks';
      this.scene.add(mesh);
    });
  }

  // -------- bushes / ferns --------
  placeBushesAndFerns() {
    const rand = this.rand;
    const defs = [
      { geo: makeBushGeometry(11), count: 500, minDens: 0.1, scale: [0.7, 1.4] },
      { geo: makeBushGeometry(12, true), count: 160, minDens: 0.05, scale: [0.7, 1.1], berry: true },
      { geo: makeFernGeometry(13), count: 900, minDens: 0.25, scale: [0.7, 1.4] },
    ];
    const q = this.quality === 'lite' ? 0.2 : this.quality === 'low' ? 0.5 : 1;
    for (const def of defs) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      applyWind(mat, 0.08, 1.2, 0.03);
      const items = [];
      let attempts = 0;
      const count = Math.floor(def.count * q);
      while (items.length < count && attempts < count * 20) {
        attempts++;
        const ang = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 175;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const h = this.terrain.getHeight(x, z);
        if (h < WORLD.waterLevel + 0.5 || h > 40 || this.slopeAt(x, z) > 0.45) continue;
        if (this.isExcluded(x, z, 0.5) || distanceToPaths(x, z) < 2) continue;
        const dens = this.forestDensity(x, z);
        if (rand() > dens + def.minDens) continue;
        items.push({ x, z, y: h - 0.05, s: randRange(rand, def.scale[0], def.scale[1]), rot: rand() * Math.PI * 2 });
      }
      const mesh = new THREE.InstancedMesh(def.geo, mat, items.length);
      items.forEach((p, i) => {
        this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
        this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(p.s, p.s * randRange(rand, 0.8, 1.2), p.s));
        mesh.setMatrixAt(i, this._m);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.name = 'bushes';
      this.scene.add(mesh);
    }
  }

  // -------- grass (chunked instancing for frustum culling) --------
  placeGrass() {
    const rand = this.rand;
    const geo = makeGrassTuftGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    applyWind(mat, 0.22, 0.6, 0, true);
    this.grassMaterial = mat;
    const chunk = 44;
    const extent = 165;
    const density = this.quality === 'lite' ? 0.05 : this.quality === 'low' ? 0.6 : 1.3; // tufts per m² at full density
    const col = new THREE.Color();
    const baseA = new THREE.Color('#6f9a35');
    const baseB = new THREE.Color('#8fae42');
    const dark = new THREE.Color('#4d7428');
    const dry = new THREE.Color('#b0a650');
    let total = 0;
    for (let cx = -extent; cx < extent; cx += chunk) {
      for (let cz = -extent; cz < extent; cz += chunk) {
        const items = [];
        const tries = Math.floor(chunk * chunk * density);
        for (let i = 0; i < tries; i++) {
          const x = cx + rand() * chunk, z = cz + rand() * chunk;
          const r = Math.hypot(x, z);
          if (r > extent) continue;
          const h = this.terrain.getHeight(x, z);
          if (h < WORLD.waterLevel + 0.35 || h > 30) continue;
          const slope = this.slopeAt(x, z);
          if (slope > 0.32) continue;
          const pd = distanceToPaths(x, z);
          if (pd < 1.4 && rand() > 0.1) continue;
          const vd = Math.hypot(x - WORLD.village.x, z - WORLD.village.z);
          if (vd < 12 && rand() > 0.25) continue;
          if (this.isExcluded(x, z, -0.5)) continue;
          // patchy meadows
          const patch = this.terrain.noise2.fbm(x * 0.05, z * 0.05, 2) * 0.5 + 0.5;
          if (rand() > 0.35 + patch * 0.8) continue;
          items.push({ x, z, y: h - 0.03, patch });
        }
        if (!items.length) continue;
        const mesh = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((p, i) => {
          const s = randRange(rand, 0.8, 1.4) * (0.85 + p.patch * 0.45);
          this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
          this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(s, s * randRange(rand, 0.8, 1.3), s));
          mesh.setMatrixAt(i, this._m);
          const forest = this.terrain.noise.fbm(p.x * 0.012 + 100, p.z * 0.012, 3) * 0.5 + 0.5;
          col.copy(baseA).lerp(baseB, p.patch).lerp(dark, smoothstep(0.45, 0.8, forest) * 0.6);
          const n2 = this.terrain.noise2.fbm(p.x * 0.11 + 9, p.z * 0.11, 2) * 0.5 + 0.5;
          col.lerp(dry, smoothstep(0.62, 0.9, n2) * 0.5);
          mesh.setColorAt(i, col);
        });
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mesh.name = 'grass';
        this.scene.add(mesh);
        total += items.length;
      }
    }
    this.grassCount = total;
  }

  placeFlowers() {
    const rand = this.rand;
    const colors = ['#f4f1ea', '#f2cf3c', '#9a6ad6', '#e0607a', '#6aa0e6'];
    const perColor = this.quality === 'low' ? 120 : 320;
    for (const c of colors) {
      const geo = makeFlowerGeometry(c);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      applyWind(mat, 0.12, 0.35);
      const items = [];
      let attempts = 0;
      while (items.length < perColor && attempts < perColor * 30) {
        attempts++;
        // flowers cluster in meadows
        const cxz = this.terrain.noise2.fbm(attempts * 0.37, 3.1, 1);
        const ang = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 150;
        const x = Math.cos(ang) * r + cxz, z = Math.sin(ang) * r;
        const h = this.terrain.getHeight(x, z);
        if (h < WORLD.waterLevel + 0.5 || this.slopeAt(x, z) > 0.3) continue;
        if (this.forestDensity(x, z) > 0.5 || this.isExcluded(x, z)) continue;
        if (distanceToPaths(x, z) < 1.5) continue;
        const patch = this.terrain.noise2.fbm(x * 0.07 + c.length, z * 0.07, 2);
        if (patch < 0.1) continue;
        items.push({ x, z, y: h - 0.02 });
      }
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((p, i) => {
        const s = randRange(rand, 0.8, 1.5);
        this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
        this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(s, s, s));
        mesh.setMatrixAt(i, this._m);
      });
      mesh.computeBoundingSphere();
      mesh.name = 'flowers';
      this.scene.add(mesh);
    }
  }

  update(dt) {
    for (const tree of this.shaking) {
      tree.shake = Math.max(0, tree.shake - dt * 2.2);
      const a = Math.sin(tree.shake * 22) * 0.035 * tree.shake;
      this.setTreeMatrix(tree, a);
      if (tree.shake <= 0) this.shaking.delete(tree);
    }
  }
}
