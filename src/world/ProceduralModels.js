import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/MathUtils.js';

// Geometry builders for stylized low-poly props. All return non-indexed geometries with
// a per-vertex `color` attribute so several parts can be merged into a single draw call.

export function colorize(geo, color, jitter = 0, rand = Math.random) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const count = g.attributes.position.count;
  const arr = new Float32Array(count * 3);
  const c = new THREE.Color(color);
  // jitter per triangle for a faceted painterly look
  for (let i = 0; i < count; i += 3) {
    const j = 1 + (rand() - 0.5) * jitter;
    for (let k = 0; k < 3 && i + k < count; k++) {
      arr[(i + k) * 3] = c.r * j;
      arr[(i + k) * 3 + 1] = c.g * j;
      arr[(i + k) * 3 + 2] = c.b * j;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export function jitterGeometry(geo, amount, rand = Math.random) {
  // Jitter shared positions consistently (weld by rounded key) so the mesh stays closed.
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [(rand() - 0.5) * amount, (rand() - 0.5) * amount, (rand() - 0.5) * amount]);
    const o = map.get(key);
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  pos.needsUpdate = true;
  return geo;
}

export function merge(geos) {
  const prepared = geos.map((g) => {
    let x = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(x.attributes)) {
      if (!['position', 'normal', 'color'].includes(name)) x.deleteAttribute(name);
    }
    if (!x.attributes.normal) x.computeVertexNormals();
    return x;
  });
  const m = mergeGeometries(prepared, false);
  m.computeVertexNormals();
  return m;
}

// ---------------- Trees ----------------
export function makePineGeometry(seed) {
  const rand = mulberry32(seed);
  const parts = [];
  const trunkH = 3.2 + rand() * 0.8;
  const trunk = new THREE.CylinderGeometry(0.14, 0.32, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(colorize(trunk, '#5a3d27', 0.25, rand));
  const layers = 4 + Math.floor(rand() * 2);
  let y = trunkH * 0.55;
  let radius = 2.5 + rand() * 0.5;
  const greens = ['#2f5a2a', '#355f2c', '#2a4f27', '#3b6a31'];
  for (let i = 0; i < layers; i++) {
    const h = 2.9 - i * 0.25;
    const cone = new THREE.ConeGeometry(radius, h, 8, 2);
    jitterGeometry(cone, 0.35, rand);
    cone.rotateY(rand() * Math.PI);
    cone.translate((rand() - 0.5) * 0.2, y + h / 2, (rand() - 0.5) * 0.2);
    parts.push(colorize(cone, greens[i % greens.length], 0.22, rand));
    y += h * 0.55;
    radius *= 0.76;
  }
  return merge(parts);
}

export function makeOakGeometry(seed) {
  const rand = mulberry32(seed);
  const parts = [];
  const trunkH = 3.4 + rand() * 1.2;
  const trunk = new THREE.CylinderGeometry(0.28, 0.5, trunkH, 7);
  jitterGeometry(trunk, 0.08, rand);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(colorize(trunk, '#5b4330', 0.2, rand));
  // branches
  for (let i = 0; i < 3; i++) {
    const br = new THREE.CylinderGeometry(0.08, 0.18, 2.2, 5);
    br.translate(0, 1.1, 0);
    br.rotateZ(0.7 + rand() * 0.4);
    br.rotateY(rand() * Math.PI * 2);
    br.translate(0, trunkH * 0.75, 0);
    parts.push(colorize(br, '#55402d', 0.2, rand));
  }
  const greens = ['#4f7a2e', '#5a8633', '#46702a', '#66913a'];
  const blobs = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 1.4 + rand() * 1.1;
    const s = new THREE.IcosahedronGeometry(r, 1);
    jitterGeometry(s, 0.45, rand);
    const a = rand() * Math.PI * 2;
    const d = i === 0 ? 0 : 1.2 + rand() * 1.1;
    s.scale(1, 0.8, 1);
    s.translate(Math.cos(a) * d, trunkH + 1.0 + rand() * 1.6 - (d > 1.5 ? 0.4 : 0), Math.sin(a) * d);
    parts.push(colorize(s, greens[Math.floor(rand() * greens.length)], 0.25, rand));
  }
  return merge(parts);
}

export function makeBirchGeometry(seed) {
  const rand = mulberry32(seed);
  const parts = [];
  const trunkH = 5 + rand() * 1.5;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const h = trunkH / segs;
    const r0 = 0.2 - i * 0.025, r1 = 0.2 - (i + 1) * 0.025;
    const seg = new THREE.CylinderGeometry(Math.max(0.06, r1), r0, h, 6);
    seg.translate(0, h * i + h / 2, 0);
    parts.push(colorize(seg, i % 2 === 0 ? '#e6e2d8' : '#d7d2c4', 0.3, rand));
  }
  const greens = ['#8aa640', '#9bb24a', '#7c9a39'];
  for (let i = 0; i < 4; i++) {
    const r = 1.0 + rand() * 0.6;
    const s = new THREE.IcosahedronGeometry(r, 1);
    jitterGeometry(s, 0.35, rand);
    s.scale(0.9, 1.25, 0.9);
    const a = rand() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.7 + rand() * 0.6;
    s.translate(Math.cos(a) * d, trunkH - 0.6 + rand() * 1.6, Math.sin(a) * d);
    parts.push(colorize(s, greens[Math.floor(rand() * greens.length)], 0.25, rand));
  }
  return merge(parts);
}

export function makeBushGeometry(seed, berries = false) {
  const rand = mulberry32(seed);
  const parts = [];
  const n = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.5 + rand() * 0.35;
    const s = new THREE.IcosahedronGeometry(r, 0);
    jitterGeometry(s, 0.2, rand);
    const a = rand() * Math.PI * 2;
    s.translate(Math.cos(a) * 0.45, r * 0.7, Math.sin(a) * 0.45);
    parts.push(colorize(s, ['#3f6a2a', '#4d7a30', '#366025'][i % 3], 0.3, rand));
  }
  if (berries) {
    for (let i = 0; i < 10; i++) {
      const b = new THREE.IcosahedronGeometry(0.07, 0);
      const a = rand() * Math.PI * 2;
      const r = 0.55 + rand() * 0.3;
      b.translate(Math.cos(a) * r, 0.4 + rand() * 0.5, Math.sin(a) * r);
      parts.push(colorize(b, '#c0283a', 0.2, rand));
    }
  }
  return merge(parts);
}

export function makeFernGeometry(seed) {
  const rand = mulberry32(seed);
  const parts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const leaf = new THREE.ConeGeometry(0.12, 1.1, 3, 1);
    leaf.scale(1, 1, 0.25);
    leaf.translate(0, 0.55, 0);
    leaf.rotateX(0.9 + rand() * 0.4);
    leaf.rotateY((i / n) * Math.PI * 2 + rand() * 0.3);
    parts.push(colorize(leaf, rand() > 0.5 ? '#4f7f2f' : '#5d8d36', 0.2, rand));
  }
  return merge(parts);
}

export function makeRockGeometry(seed, detail = 1) {
  const rand = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const offsets = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 0.75 + rand() * 0.45);
    v.multiplyScalar(offsets.get(key));
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  // Moss on top-facing faces
  const n = geo.attributes.normal;
  const colors = new Float32Array(n.count * 3);
  const rock = new THREE.Color('#7b776f');
  const rock2 = new THREE.Color('#5f5c57');
  const moss = new THREE.Color('#566f2e');
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i += 3) {
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    c.copy(rock).lerp(rock2, rand());
    if (ny > 0.55 && rand() > 0.25) c.lerp(moss, 0.75);
    const j = 0.9 + rand() * 0.2;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r * j;
      colors[(i + k) * 3 + 1] = c.g * j;
      colors[(i + k) * 3 + 2] = c.b * j;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return geo;
}

export function makeGrassTuftGeometry() {
  // 3 crossed tapered blades; normals point up for soft, ground-matching lighting
  const blades = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI + 0.3;
    const w = 0.1, h = 0.38 + (i % 3) * 0.12;
    const bend = 0.12;
    const verts = [
      -w, 0, 0, w, 0, 0, w * 0.6, h * 0.5, bend * 0.4,
      -w, 0, 0, w * 0.6, h * 0.5, bend * 0.4, -w * 0.6, h * 0.5, bend * 0.4,
      -w * 0.6, h * 0.5, bend * 0.4, w * 0.6, h * 0.5, bend * 0.4, 0, h, bend,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.rotateY(a);
    g.translate(Math.cos(a * 3) * 0.16, 0, Math.sin(a * 3) * 0.16);
    blades.push(g);
  }
  const geo = mergeGeometries(blades);
  const count = geo.attributes.position.count;
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < count; i++) {
    normals[i * 3 + 1] = 1;
    const t = pos.getY(i) / 0.7;
    const shade = 0.55 + t * 0.55;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function makeFlowerGeometry(color) {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.012, 0.015, 0.35, 3);
  stem.translate(0, 0.175, 0);
  parts.push(colorize(stem, '#4c7a2a'));
  for (let i = 0; i < 5; i++) {
    const p = new THREE.CircleGeometry(0.06, 4);
    p.rotateX(-Math.PI / 2 + 0.3);
    p.translate(0, 0.35, 0.05);
    p.rotateY((i / 5) * Math.PI * 2);
    parts.push(colorize(p, color));
  }
  const c = new THREE.IcosahedronGeometry(0.03, 0);
  c.translate(0, 0.37, 0);
  parts.push(colorize(c, '#f2d24a'));
  return merge(parts);
}

// ---------------- Wind shader injection ----------------
export const windUniforms = { uTime: { value: 0 }, uWindStrength: { value: 1 } };

/**
 * Adds coherent world-space wind sway to an (instanced) material.
 * `amount` scales displacement, `heightRef` is the height where sway reaches `amount`.
 */
export function applyWind(material, amount, heightRef, flutter = 0, keepNormal = false) {
  material.onBeforeCompile = (shader) => {
    if (keepNormal) {
      // Grass: light both faces like the ground (no back-face normal flip -> no black blades)
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
    }
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            mat3 im = mat3(instanceMatrix);
            vec3 ipos = vec3(instanceMatrix[3]);
          #else
            mat3 im = mat3(1.0);
            vec3 ipos = vec3(0.0);
          #endif
          float hgt = clamp(position.y / ${heightRef.toFixed(2)}, 0.0, 1.5);
          float phase = ipos.x * 0.13 + ipos.z * 0.09;
          float gust = 0.55 + 0.45 * sin(uTime * 0.35 + ipos.x * 0.02);
          float sway = (sin(uTime * 1.6 + phase) * 0.6 + sin(uTime * 2.9 + phase * 1.7) * 0.25 + 0.35) * gust;
          vec3 windW = vec3(1.0, 0.0, 0.45) * sway * ${amount.toFixed(3)} * hgt * hgt * uWindStrength;
          ${flutter > 0 ? `windW += vec3(sin(uTime * 7.0 + position.x * 4.0 + phase), 0.0, cos(uTime * 6.0 + position.z * 4.0)) * ${flutter.toFixed(3)} * hgt;` : ''}
          float s2 = max(dot(im[0], im[0]), 1e-4);
          transformed += (transpose(im) * windW) / s2;
        }`
      );
  };
  material.customProgramCacheKey = () => `wind-${amount}-${heightRef}-${flutter}-${keepNormal}`;
  return material;
}

/** Merge the direct mesh children of `node` that share a material (keeps local transforms). */
export function mergeChildrenByMaterial(node) {
  const groups = new Map();
  for (const c of [...node.children]) {
    if (!c.isMesh || c.isInstancedMesh || c.children.length) continue;
    c.updateMatrix();
    const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    g.applyMatrix4(c.matrix);
    const key = c.material.uuid + c.castShadow;
    if (!groups.has(key)) groups.set(key, { mat: c.material, cast: c.castShadow, geos: [] });
    groups.get(key).geos.push(g);
    node.remove(c);
  }
  for (const { mat, cast, geos } of groups.values()) {
    const names = Object.keys(geos[0].attributes);
    const ok = geos.filter((g) => names.every((n) => g.attributes[n]) && Object.keys(g.attributes).length === names.length);
    const m = new THREE.Mesh(mergeGeometries(ok, false), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    node.add(m);
  }
}
