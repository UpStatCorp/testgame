import * as THREE from 'three';
import { jitterGeometry } from '../world/ProceduralModels.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedurally built rigs (groups with named pivot joints) for villagers and forest creatures.

function part(geo, color, parent, x = 0, y = 0, z = 0, opts = {}) {
  const mat = opts.material || new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.85, flatShading: !!opts.flat, emissive: opts.emissive || '#000000', emissiveIntensity: opts.emissiveIntensity ?? 0 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  // tiny details (eyes, teeth, claws) don't need to cast shadows
  geo.computeBoundingSphere();
  m.castShadow = geo.boundingSphere.radius > 0.09;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const SKIN = ['#e0b08a', '#c89070', '#f0c8a0', '#a8765a'];
const HAIR = ['#3a2a1a', '#8a5a2a', '#d8b870', '#6a6a6a', '#b04a20', '#e8e0d0'];
const TUNIC = ['#6a3a2a', '#3a5a3a', '#4a4a6a', '#8a6a3a', '#5a2a3a', '#2f4f5f', '#7a7a5a'];
const PANTS = ['#3a3028', '#2a2a30', '#4a3a2a', '#3a4030'];

export function buildVillagerModel(rand, opts = {}) {
  const root = new THREE.Group();
  const skin = SKIN[Math.floor(rand() * SKIN.length)];
  const hair = opts.elder ? '#e8e4dc' : HAIR[Math.floor(rand() * HAIR.length)];
  const tunic = opts.tunic || TUNIC[Math.floor(rand() * TUNIC.length)];
  const pants = PANTS[Math.floor(rand() * PANTS.length)];
  const female = opts.female ?? rand() < 0.5;
  const s = opts.elder ? 0.95 : 0.95 + rand() * 0.12;
  root.scale.setScalar(s);

  const hips = pivot(root, 0, 0.92, 0);
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = pivot(hips, side * 0.11, 0, 0);
    part(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8), pants, hip, 0, -0.27, 0);
    const boot = part(new THREE.BoxGeometry(0.13, 0.12, 0.22), '#2a1c12', hip, 0, -0.82, 0.03);
    boot.castShadow = true;
    legs.push(hip);
  }
  const torso = pivot(hips, 0, 0, 0);
  // Tunic (a bit flared at the bottom for dresses)
  const body = part(new THREE.CylinderGeometry(female ? 0.2 : 0.21, female ? 0.3 : 0.24, 0.62, 10), tunic, torso, 0, 0.28, 0);
  body.scale.z = 0.72;
  if (female) part(new THREE.CylinderGeometry(0.28, 0.36, 0.35, 10), tunic, torso, 0, -0.12, 0).scale.z = 0.8;
  part(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 10), '#3a2414', torso, 0, 0.06, 0).scale.z = 0.75; // belt
  part(new THREE.BoxGeometry(0.06, 0.05, 0.02), '#c8a040', torso, 0, 0.06, 0.17);
  // Shoulders / cloak
  if (opts.cloak || rand() < 0.4) {
    const cloak = part(new THREE.CylinderGeometry(0.26, 0.34, 0.8, 10, 1, true, Math.PI * 0.6, Math.PI * 0.8), opts.cloak || '#4a3a2a', torso, 0, 0.2, -0.02, { roughness: 1 });
    cloak.material.side = THREE.DoubleSide;
    cloak.rotation.y = Math.PI;
  }
  const neck = pivot(torso, 0, 0.62, 0);
  const head = pivot(neck, 0, 0.02, 0);
  part(new THREE.SphereGeometry(0.13, 12, 10), skin, head, 0, 0.12, 0).scale.set(0.95, 1.08, 1);
  // eyes
  for (const side of [-1, 1]) part(new THREE.SphereGeometry(0.015, 6, 4), '#1a1a1a', head, side * 0.045, 0.14, 0.115);
  part(new THREE.ConeGeometry(0.02, 0.05, 4), skin, head, 0, 0.1, 0.13).rotation.x = Math.PI / 2;
  // hair
  const hairCap = part(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, head, 0, 0.14, -0.01);
  hairCap.scale.set(1, 1, 1.05);
  if (female) {
    const braid = part(new THREE.CapsuleGeometry(0.05, 0.3, 3, 6), hair, head, 0, -0.08, -0.12);
    braid.rotation.x = 0.2;
  } else if (opts.elder || rand() < 0.6) {
    const beard = part(new THREE.ConeGeometry(0.1, opts.elder ? 0.32 : 0.2, 8), hair, head, 0, opts.elder ? -0.07 : 0.0, 0.08);
    beard.rotation.x = Math.PI;
    beard.scale.z = 0.6;
  }
  if (opts.hat || rand() < 0.25) {
    part(new THREE.ConeGeometry(0.17, 0.22, 10), opts.hat || '#5a4a3a', head, 0, 0.32, 0);
  }
  // arms
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = pivot(torso, side * 0.26, 0.55, 0);
    part(new THREE.CapsuleGeometry(0.06, 0.3, 3, 8), tunic, sh, 0, -0.2, 0);
    const fore = pivot(sh, 0, -0.38, 0);
    part(new THREE.CapsuleGeometry(0.05, 0.22, 3, 6), skin, fore, 0, -0.12, 0);
    arms.push({ shoulder: sh, fore });
  }
  if (opts.staff) {
    const st = part(new THREE.CylinderGeometry(0.025, 0.03, 1.7, 6), '#5a3a22', arms[1].fore, 0, -0.2, 0.05);
    st.position.y = -0.25;
  }
  optimizeRig(root);
  return { root, hips, torso, head, neck, legs, arms, scale: s };
}

export function buildForestCreatureModel(rand, variant = 'forest') {
  const root = new THREE.Group();
  const brute = variant === 'brute';
  const bark = brute ? '#3a3226' : '#4a3a28';
  const moss = brute ? '#3f5a2a' : '#56782e';
  const eye = brute ? '#ff7030' : '#c8ff5a';
  const barkMat = new THREE.MeshStandardMaterial({ color: bark, roughness: 0.95, flatShading: true });
  const mossMat = new THREE.MeshStandardMaterial({ color: moss, roughness: 1, flatShading: true });
  const eyeMat = new THREE.MeshStandardMaterial({ color: eye, emissive: eye, emissiveIntensity: 3 });
  const hips = pivot(root, 0, 0.95, 0);
  // Digitigrade legs
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = pivot(hips, side * 0.2, 0, 0);
    const thigh = part(jitterGeometry(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 6), 0.05, rand), null, hip, 0, -0.22, 0.06, { material: barkMat });
    thigh.rotation.x = -0.35;
    const knee = pivot(hip, 0, -0.45, 0.13);
    const shin = part(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6), null, knee, 0, -0.22, -0.08, { material: barkMat });
    shin.rotation.x = 0.4;
    const foot = part(new THREE.ConeGeometry(0.1, 0.25, 5), null, knee, 0, -0.47, 0.0, { material: barkMat });
    foot.rotation.x = Math.PI / 2;
    legs.push(hip);
  }
  // Hunched torso
  const torso = pivot(hips, 0, 0.05, 0);
  const chest = part(jitterGeometry(new THREE.IcosahedronGeometry(0.42, 1), 0.12, rand), null, torso, 0, 0.35, 0.1, { material: barkMat });
  chest.scale.set(1, 1.1, 0.8);
  // moss mound on the back + spikes/branches
  const mound = part(jitterGeometry(new THREE.IcosahedronGeometry(0.36, 1), 0.15, rand), null, torso, 0, 0.55, -0.18, { material: mossMat });
  mound.scale.set(1.1, 0.7, 0.9);
  for (let i = 0; i < 5; i++) {
    const sp = part(new THREE.ConeGeometry(0.04, 0.35 + rand() * 0.2, 4), null, torso, (rand() - 0.5) * 0.5, 0.7 + rand() * 0.15, -0.2 - rand() * 0.15, { material: barkMat });
    sp.rotation.set(-0.6 - rand() * 0.4, 0, (rand() - 0.5) * 0.8);
  }
  // Head
  const neck = pivot(torso, 0, 0.62, 0.3);
  const head = pivot(neck, 0, 0, 0);
  const skull = part(jitterGeometry(new THREE.IcosahedronGeometry(0.2, 1), 0.06, rand), null, head, 0, 0.05, 0.1, { material: barkMat });
  skull.scale.set(1, 0.85, 1.25);
  const jaw = pivot(head, 0, -0.05, 0.1);
  const jawMesh = part(new THREE.BoxGeometry(0.22, 0.06, 0.22), null, jaw, 0, -0.03, 0.08, { material: barkMat });
  jawMesh.rotation.x = 0.1;
  for (let i = 0; i < 4; i++) {
    const tooth = part(new THREE.ConeGeometry(0.015, 0.06, 4), '#e8e0c0', jaw, -0.075 + i * 0.05, 0.02, 0.17);
    tooth.rotation.x = 0;
  }
  for (const side of [-1, 1]) {
    part(new THREE.SphereGeometry(0.035, 8, 6), null, head, side * 0.08, 0.1, 0.3, { material: eyeMat });
    // antlers
    const antler = pivot(head, side * 0.1, 0.18, 0.02);
    const a1 = part(new THREE.CylinderGeometry(0.018, 0.03, 0.45, 5), null, antler, 0, 0.2, 0, { material: barkMat });
    antler.rotation.z = -side * 0.5;
    antler.rotation.x = -0.3;
    const b = part(new THREE.CylinderGeometry(0.012, 0.02, 0.22, 4), null, antler, side * 0.06, 0.3, 0.02, { material: barkMat });
    b.rotation.z = -side * 0.9;
    void a1;
  }
  // Long arms with claws
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = pivot(torso, side * 0.42, 0.5, 0.15);
    const upper = part(jitterGeometry(new THREE.CylinderGeometry(0.07, 0.1, 0.55, 6), 0.04, rand), null, sh, 0, -0.26, 0, { material: barkMat });
    upper.rotation.z = side * 0.1;
    const fore = pivot(sh, side * 0.03, -0.52, 0);
    part(new THREE.CylinderGeometry(0.05, 0.075, 0.5, 6), null, fore, 0, -0.24, 0, { material: barkMat });
    for (let i = 0; i < 3; i++) {
      const claw = part(new THREE.ConeGeometry(0.02, 0.2, 4), '#d8d0b0', fore, (i - 1) * 0.04, -0.55, 0.03);
      claw.rotation.x = Math.PI + 0.3;
    }
    arms.push({ shoulder: sh, fore });
  }
  const scale = brute ? 1.45 : 0.95 + rand() * 0.15;
  root.scale.setScalar(scale);
  // merged per-joint meshes share one material; it is used for the hit flash
  const merged = optimizeRig(root, { flatShading: true });
  return { root, hips, torso, head, neck, jaw, legs, arms, eyeMat, scale, barkMat: merged };
}

// ---------- floating UI (health bar + name) ----------
export function makeNameSprite(text, sub = '', color = '#ffe8b0') {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 44px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 56);
  if (sub) {
    ctx.font = 'italic 30px Georgia, serif';
    ctx.fillStyle = '#d0c8b8';
    ctx.fillText(sub, 256, 100);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(2.0, 0.5, 1);
  sprite.renderOrder = 8;
  sprite.raycast = () => {}; // labels are not interactable
  return sprite;
}

export class HealthBar3D {
  constructor(width = 0.9) {
    this.group = new THREE.Group();
    const bgGeo = new THREE.PlaneGeometry(width + 0.04, 0.12);
    const fgGeo = new THREE.PlaneGeometry(width, 0.08);
    fgGeo.translate(width / 2, 0, 0);
    this.bg = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({ color: '#150d08', transparent: true, opacity: 0.75, depthWrite: false, fog: false }));
    this.lag = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: '#f0d080', transparent: true, depthWrite: false, fog: false }));
    this.fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: '#c8302a', transparent: true, depthWrite: false, fog: false }));
    this.lag.position.set(-width / 2, 0, 0.001);
    this.fg.position.set(-width / 2, 0, 0.002);
    this.group.add(this.bg, this.lag, this.fg);
    this.group.renderOrder = 9;
    for (const m of [this.bg, this.lag, this.fg]) m.raycast = () => {};
    for (const m of [this.bg, this.lag, this.fg]) m.renderOrder = 9;
    this.lagValue = 1;
    this.visibleTime = 0;
  }

  set(ratio, dt) {
    this.fg.scale.x = Math.max(0.0001, ratio);
    this.lagValue += (ratio - this.lagValue) * Math.min(1, dt * 3);
    this.lag.scale.x = Math.max(0.0001, this.lagValue);
  }
}

/**
 * Draw-call optimisation: for every joint in a rig, merge its plain child meshes into one
 * vertex-coloured mesh (a villager goes from ~30 draw calls to ~11). Emissive, transparent
 * and double-sided parts stay separate. Returns the shared merged material.
 */
export function optimizeRig(root, { flatShading = false } = {}) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading });
  const nodes = [];
  root.traverse((o) => { if (!o.isMesh) nodes.push(o); });
  for (const node of nodes) {
    const plain = node.children.filter((c) => c.isMesh && c.material && !c.material.transparent && c.material.side !== THREE.DoubleSide && !(c.material.emissive && c.material.emissive.getHex() !== 0) && c.children.length === 0);
    if (plain.length === 0) continue;
    const geos = [];
    let cast = false;
    for (const m of plain) {
      m.updateMatrix();
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
      const col = m.material.color;
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      geos.push(g);
      cast = cast || m.castShadow;
      node.remove(m);
    }
    const merged = new THREE.Mesh(mergeGeometries(geos, false), material);
    merged.castShadow = cast;
    merged.receiveShadow = true;
    node.add(merged);
  }
  return material;
}
