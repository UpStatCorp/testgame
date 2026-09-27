import * as THREE from 'three';
import { makeRockGeometry } from '../world/ProceduralModels.js';

// Procedural 3D models for items: used for first-person view models and world pickups.

let envMap = null;
export const sharedMaterials = {};

export function setItemEnvMap(tex) {
  envMap = tex;
  for (const m of Object.values(sharedMaterials)) {
    if (m.metalness > 0.3) {
      m.envMap = tex;
      m.needsUpdate = true;
    }
  }
}

function mat(name, params) {
  if (!sharedMaterials[name]) {
    sharedMaterials[name] = new THREE.MeshStandardMaterial(params);
    if (envMap && params.metalness > 0.3) sharedMaterials[name].envMap = envMap;
  }
  return sharedMaterials[name];
}

const M = {
  steel: () => mat('steel', { color: '#c9d2da', metalness: 0.9, roughness: 0.28, envMapIntensity: 1.0 }),
  darkSteel: () => mat('darkSteel', { color: '#8d97a3', metalness: 0.9, roughness: 0.35, envMapIntensity: 1.0 }),
  fuller: () => mat('fuller', { color: '#5a646e', metalness: 0.85, roughness: 0.4 }),
  gold: () => mat('gold', { color: '#d4a84a', metalness: 0.95, roughness: 0.3 }),
  leather: () => mat('leather', { color: '#4a2e1c', roughness: 0.85 }),
  wood: () => mat('wood', { color: '#6b4528', roughness: 0.8 }),
  darkWood: () => mat('darkWood', { color: '#3e2616', roughness: 0.8 }),
  crystal: () => mat('crystal', { color: '#8fe6ff', emissive: '#3ab8ff', emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.92 }),
  potionGlass: () => mat('glass', { color: '#e8f4ff', roughness: 0.05, transparent: true, opacity: 0.35 }),
  potionLiquid: () => mat('liquid', { color: '#e0243a', emissive: '#801020', emissiveIntensity: 0.6, roughness: 0.2 }),
  cork: () => mat('cork', { color: '#9a6a3a', roughness: 0.9 }),
  meat: () => mat('meat', { color: '#9a4a24', roughness: 0.7 }),
  bone: () => mat('bone', { color: '#efe6d2', roughness: 0.6 }),
  coin: () => mat('coin', { color: '#f0c050', metalness: 0.95, roughness: 0.25, emissive: '#402a00', emissiveIntensity: 0.3 }),
  apple: () => mat('apple', { color: '#c0302a', roughness: 0.45 }),
  skin: () => mat('skin', { color: '#d9a27c', roughness: 0.7 }),
  sleeve: () => mat('sleeve', { color: '#4a5a3a', roughness: 0.95 }),
  glove: () => mat('glove', { color: '#3a2618', roughness: 0.8 }),
};
export const ItemMaterials = M;

function bladeGeometry(length, width, thickness, tipLen) {
  // Diamond cross-section blade built from a custom profile, pointing +Y
  const half = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(-half * 0.92, length - tipLen);
  shape.lineTo(0, length);
  shape.lineTo(half * 0.92, length - tipLen);
  shape.lineTo(half, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness * 0.2,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: half * 0.35,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -thickness * 0.1);
  geo.computeVertexNormals();
  return geo;
}

function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function createSword() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.018, 0.02, 0.16, 8), M.leather(), 0, -0.02, 0);
  for (let i = 0; i < 4; i++) add(g, new THREE.TorusGeometry(0.021, 0.004, 4, 10), M.leather(), 0, -0.08 + i * 0.04, 0).rotation.x = Math.PI / 2;
  add(g, new THREE.SphereGeometry(0.03, 10, 8), M.gold(), 0, -0.12, 0);
  const guard = add(g, new THREE.BoxGeometry(0.2, 0.028, 0.04), M.gold(), 0, 0.07, 0);
  guard.geometry.translate(0, 0, 0);
  add(g, new THREE.SphereGeometry(0.022, 8, 6), M.gold(), 0.1, 0.07, 0);
  add(g, new THREE.SphereGeometry(0.022, 8, 6), M.gold(), -0.1, 0.07, 0);
  add(g, bladeGeometry(0.72, 0.055, 0.012, 0.1), M.steel(), 0, 0.085, 0);
  add(g, new THREE.BoxGeometry(0.012, 0.5, 0.018), M.fuller(), 0, 0.36, 0);
  g.userData.tip = new THREE.Vector3(0, 0.8, 0);
  return g;
}

export function createGreatsword() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.022, 0.025, 0.36, 8), M.leather(), 0, -0.1, 0);
  for (let i = 0; i < 7; i++) add(g, new THREE.TorusGeometry(0.026, 0.005, 4, 10), M.darkWood(), 0, -0.26 + i * 0.05, 0).rotation.x = Math.PI / 2;
  add(g, new THREE.OctahedronGeometry(0.045, 0), M.darkSteel(), 0, -0.31, 0);
  // Wide curved crossguard
  const guard = new THREE.Group();
  guard.position.y = 0.1;
  g.add(guard);
  add(guard, new THREE.BoxGeometry(0.36, 0.045, 0.06), M.darkSteel());
  for (const s of [-1, 1]) {
    const tip = add(guard, new THREE.ConeGeometry(0.03, 0.12, 6), M.darkSteel(), s * 0.2, 0.04, 0);
    tip.rotation.z = -s * 0.8;
  }
  add(guard, new THREE.OctahedronGeometry(0.04, 0), M.gold(), 0, 0, 0.03);
  // Ricasso + long blade
  add(g, new THREE.BoxGeometry(0.07, 0.12, 0.022), M.darkSteel(), 0, 0.18, 0);
  add(g, bladeGeometry(1.25, 0.1, 0.018, 0.18), M.darkSteel(), 0, 0.2, 0);
  add(g, new THREE.BoxGeometry(0.02, 0.9, 0.028), M.fuller(), 0, 0.68, 0);
  g.userData.tip = new THREE.Vector3(0, 1.45, 0);
  return g;
}

export function createStaff() {
  const g = new THREE.Group();
  const shaft = add(g, new THREE.CylinderGeometry(0.02, 0.026, 1.35, 7), M.wood(), 0, 0.2, 0);
  shaft.castShadow = false;
  for (const y of [-0.3, 0.3, 0.75]) add(g, new THREE.TorusGeometry(0.027, 0.007, 5, 10), M.gold(), 0, y, 0).rotation.x = Math.PI / 2;
  // Claws cradling the crystal
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const claw = add(g, new THREE.ConeGeometry(0.014, 0.2, 5), M.darkWood(), Math.cos(a) * 0.05, 0.93, Math.sin(a) * 0.05);
    claw.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
  }
  const crystal = add(g, new THREE.OctahedronGeometry(0.06, 0), M.crystal(), 0, 1.0, 0);
  crystal.scale.y = 1.6;
  crystal.castShadow = false;
  g.userData.crystal = crystal;
  g.userData.tip = new THREE.Vector3(0, 1.0, 0);
  return g;
}

export function createStone() {
  const m = new THREE.Mesh(makeRockGeometry(Math.floor(Math.random() * 1000), 0), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
  m.scale.setScalar(0.18);
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export function createWood() {
  const g = new THREE.Group();
  for (const [x, y] of [[-0.07, 0], [0.07, 0], [0, 0.11]]) {
    const log = add(g, new THREE.CylinderGeometry(0.065, 0.065, 0.45, 7), M.wood(), x, y, 0);
    log.rotation.x = Math.PI / 2;
  }
  return g;
}

export function createPotion() {
  const g = new THREE.Group();
  add(g, new THREE.SphereGeometry(0.075, 12, 10), M.potionGlass(), 0, 0.075, 0);
  add(g, new THREE.SphereGeometry(0.065, 12, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), M.potionLiquid(), 0, 0.075, 0);
  add(g, new THREE.CylinderGeometry(0.022, 0.028, 0.07, 8), M.potionGlass(), 0, 0.17, 0);
  add(g, new THREE.CylinderGeometry(0.024, 0.02, 0.035, 8), M.cork(), 0, 0.215, 0);
  return g;
}

export function createFood() {
  const g = new THREE.Group();
  const meat = add(g, new THREE.SphereGeometry(0.09, 10, 8), M.meat(), 0, 0.06, 0);
  meat.scale.set(1.2, 0.8, 0.9);
  const bone = add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6), M.bone(), 0.12, 0.06, 0);
  bone.rotation.z = Math.PI / 2;
  add(g, new THREE.SphereGeometry(0.025, 6, 5), M.bone(), 0.2, 0.075, 0.015);
  add(g, new THREE.SphereGeometry(0.025, 6, 5), M.bone(), 0.2, 0.05, -0.015);
  return g;
}

export function createApple() {
  const g = new THREE.Group();
  add(g, new THREE.SphereGeometry(0.06, 10, 8), M.apple(), 0, 0.06, 0);
  add(g, new THREE.CylinderGeometry(0.005, 0.005, 0.04, 4), M.darkWood(), 0, 0.13, 0);
  return g;
}

export function createCoin() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const c = add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), M.coin(), (i - 1) * 0.03, 0.006 + i * 0.013, (i % 2) * 0.02);
    c.rotation.x = i === 2 ? 0.3 : 0;
  }
  return g;
}

const builders = {
  sword: createSword, greatsword: createGreatsword, staff: createStaff, stone: createStone,
  wood: createWood, potion: createPotion, food: createFood, coin: createCoin, apple: createApple,
};

export function createItemModel(id) {
  const b = builders[id] || createStone;
  return b();
}
