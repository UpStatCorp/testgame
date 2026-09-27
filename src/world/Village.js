import * as THREE from 'three';
import { mulberry32, randRange } from '../core/MathUtils.js';
import { WORLD } from './WorldConfig.js';
import { Textures, texturedBox } from './Textures.js';
import { makeRockGeometry, mergeChildrenByMaterial } from './ProceduralModels.js';
import { Campfire } from './Campfire.js';
import { distanceToPaths } from './Terrain.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Helper: transform local (lx, lz) of a rotated group into world XZ. */
function toWorld(ox, oz, rot, lx, lz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [ox + lx * c + lz * s, oz - lx * s + lz * c];
}

/**
 * Builds the settlement: timber houses with working doors, chests, campfires, well, fences,
 * decorations; registers colliders + interactables and exclusion zones for vegetation.
 */
export class Village {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.terrain = game.terrain;
    this.physics = game.physics;
    this.exclusions = [];
    this.doors = [];
    this.chests = [];
    this.campfires = [];
    this.windowMaterial = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffb050', emissiveIntensity: 0, roughness: 0.4 });
    this.lanternMaterial = new THREE.MeshStandardMaterial({ color: '#ffcc77', emissive: '#ffaa44', emissiveIntensity: 0.2 });
    this.rand = mulberry32(WORLD.seed + 77);

    this.mats = {
      wall: new THREE.MeshStandardMaterial({ map: Textures.planks([150, 110, 70]), roughness: 0.9 }),
      wallDark: new THREE.MeshStandardMaterial({ map: Textures.planks([100, 70, 45]), roughness: 0.9 }),
      beam: new THREE.MeshStandardMaterial({ color: '#4a3322', roughness: 0.85 }),
      roof: new THREE.MeshStandardMaterial({ map: Textures.shingles(), roughness: 0.95 }),
      thatch: new THREE.MeshStandardMaterial({ map: Textures.thatch(), roughness: 1 }),
      stone: new THREE.MeshStandardMaterial({ map: Textures.stone(), roughness: 0.95 }),
      door: new THREE.MeshStandardMaterial({ map: Textures.planks([110, 72, 40]), roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.5, metalness: 0.7 }),
      gold: new THREE.MeshStandardMaterial({ color: '#c8a040', roughness: 0.35, metalness: 0.9 }),
      cloth: new THREE.MeshStandardMaterial({ color: '#8a2f2a', roughness: 0.95, side: THREE.DoubleSide }),
      cloth2: new THREE.MeshStandardMaterial({ color: '#3f72b0', roughness: 0.95, side: THREE.DoubleSide }),
      hay: new THREE.MeshStandardMaterial({ map: Textures.thatch(), color: '#e0c070', roughness: 1 }),
      rock: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    };

    // All non-animated village geometry goes here and is merged per material at the end
    this.staticRoot = new THREE.Group();
    this.scene.add(this.staticRoot);

    const v = WORLD.village;
    this.center = new THREE.Vector3(v.x, this.terrain.getHeight(v.x, v.z), v.z);

    // House layout around the square; doors face the center
    const houses = [
      { a: -2.3, r: 19, w: 7, d: 6, roof: 'roof', chest: true },
      { a: -1.2, r: 20, w: 6, d: 5.5, roof: 'thatch' },
      { a: 0.2, r: 21, w: 8, d: 6.5, roof: 'roof', chest: true, long: true },
      { a: 1.3, r: 19, w: 6.5, d: 5.5, roof: 'thatch' },
      { a: 2.6, r: 20, w: 7, d: 6, roof: 'roof' },
    ];
    for (const h of houses) {
      const x = v.x + Math.cos(h.a) * h.r;
      const z = v.z + Math.sin(h.a) * h.r;
      const rot = Math.atan2(v.x - x, v.z - z);
      this.buildHouse(x, z, rot, h);
    }

    this.buildWell(v.x - 6, v.z - 5);
    this.addCampfire(v.x + 3, v.z + 4, true, 1.2);
    this.addCampfire(v.x + 20, v.z + 44, true, 0.9); // camp along the southern path near spawn
    this.addCampfire(WORLD.lake.x - 30, WORLD.lake.z + 30, false, 0.9); // lakeside camp
    this.buildMarketStall(v.x + 9, v.z - 8, 0.6);
    this.buildFences();
    this.buildDecor();
    this.buildDock();
    this.buildStandingStones();
    // Chest at the lakeside camp
    this.addChest(WORLD.lake.x - 27, WORLD.lake.z + 33, 2.2, [
      { id: 'coin', count: 25 }, { id: 'potion', count: 2 }, { id: 'food', count: 2 },
    ]);
    this.exclusions.push({ x: v.x, z: v.z, r: 12 });
    this.mergeStatic();
  }

  /** Merge static meshes by material to cut draw calls (hundreds of boxes -> a few dozen batches). */
  mergeStatic() {
    const root = this.staticRoot;
    root.updateMatrixWorld(true);
    const groups = new Map();
    const toRemove = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      for (let p = o; p && p !== root; p = p.parent) if (p.userData.dynamic) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.morphAttributes = {};
      const key = `${o.material.uuid}|${o.castShadow}`;
      if (!groups.has(key)) groups.set(key, { material: o.material, cast: o.castShadow, geos: [] });
      groups.get(key).geos.push(g);
      toRemove.push(o);
    });
    for (const o of toRemove) o.parent.remove(o);
    for (const { material, cast, geos } of groups.values()) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, material);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.name = 'village-static';
      this.scene.add(m);
    }
  }

  groundY(x, z) {
    return this.terrain.getHeight(x, z);
  }

  addMesh(geo, mat, x, y, z, parent = this.staticRoot, shadows = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadows;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ---------------- houses ----------------
  buildHouse(x, z, rot, opts) {
    const { w, d } = opts;
    const wallH = 2.9;
    const t = 0.25;
    // Base height = max terrain under footprint so it never floats below ground
    let base = -Infinity;
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
      const [wx, wz] = toWorld(x, z, rot, lx, lz);
      base = Math.max(base, this.groundY(wx, wz));
    }
    base += 0.25;
    const g = new THREE.Group();
    g.position.set(x, base, z);
    g.rotation.y = rot;
    this.staticRoot.add(g);
    const M = this.mats;
    const wallMat = opts.long ? M.wallDark : M.wall;

    // Stone foundation (goes into the ground)
    const found = this.addMesh(texturedBox(w + 0.5, 1.4, d + 0.5, 1.5), M.stone, 0, -0.6, 0, g);
    found.castShadow = false;
    // Wooden floor
    this.addMesh(texturedBox(w - 0.1, 0.12, d - 0.1, 2), M.wallDark, 0, 0.06, 0, g);

    const doorW = 1.3, doorH = 2.15;
    // Back wall
    this.addMesh(texturedBox(w, wallH, t, 2), wallMat, 0, wallH / 2, -d / 2 + t / 2, g);
    // Side walls with window openings (simple: full walls + window insets)
    this.addMesh(texturedBox(t, wallH, d, 2), wallMat, -w / 2 + t / 2, wallH / 2, 0, g);
    this.addMesh(texturedBox(t, wallH, d, 2), wallMat, w / 2 - t / 2, wallH / 2, 0, g);
    // Front wall split around the door
    const sideW = (w - doorW) / 2;
    this.addMesh(texturedBox(sideW, wallH, t, 2), wallMat, -w / 2 + sideW / 2, wallH / 2, d / 2 - t / 2, g);
    this.addMesh(texturedBox(sideW, wallH, t, 2), wallMat, w / 2 - sideW / 2, wallH / 2, d / 2 - t / 2, g);
    this.addMesh(texturedBox(doorW, wallH - doorH, t, 2), wallMat, 0, doorH + (wallH - doorH) / 2, d / 2 - t / 2, g);

    // Timber frame beams
    const beamGeoV = new THREE.BoxGeometry(0.22, wallH, 0.22);
    for (const [bx, bz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [-doorW / 2 - 0.1, d / 2], [doorW / 2 + 0.1, d / 2]]) {
      this.addMesh(beamGeoV, M.beam, bx, wallH / 2, bz, g);
    }
    const beamH = new THREE.BoxGeometry(w + 0.2, 0.2, 0.2);
    this.addMesh(beamH, M.beam, 0, wallH, d / 2, g);
    this.addMesh(beamH, M.beam, 0, wallH, -d / 2, g);
    this.addMesh(beamH, M.beam, 0, 0.3, -d / 2, g);
    const beamD = new THREE.BoxGeometry(0.2, 0.2, d + 0.2);
    this.addMesh(beamD, M.beam, -w / 2, wallH, 0, g);
    this.addMesh(beamD, M.beam, w / 2, wallH, 0, g);

    // Windows (glow at night)
    for (const side of [-1, 1]) {
      const win = this.addMesh(new THREE.BoxGeometry(0.08, 0.7, 0.9), this.windowMaterial, side * (w / 2 + 0.01), 1.6, 0, g, false);
      const frame = new THREE.BoxGeometry(0.12, 0.12, 1.1);
      this.addMesh(frame, M.beam, side * (w / 2 + 0.03), 1.98, 0, g);
      this.addMesh(frame, M.beam, side * (w / 2 + 0.03), 1.22, 0, g);
      this.addMesh(new THREE.BoxGeometry(0.1, 0.7, 0.08), M.beam, side * (w / 2 + 0.04), 1.6, 0, g);
      win.receiveShadow = false;
    }

    // Gable roof
    const roofH = 2.2;
    const overhang = 0.6;
    const ang = Math.atan2(roofH, w / 2);
    const run = w / 2 + overhang;
    const slopeLen = run / Math.cos(ang) + 0.2;
    const roofMat = opts.roof === 'thatch' ? M.thatch : M.roof;
    const top = wallH + roofH;
    for (const side of [-1, 1]) {
      const r = this.addMesh(texturedBox(slopeLen, 0.18, d + overhang * 2, 2), roofMat, side * run / 2, top - Math.tan(ang) * run / 2 + 0.1, 0, g);
      r.rotation.z = -side * ang;
    }
    // Ridge beam
    this.addMesh(new THREE.BoxGeometry(0.25, 0.25, d + overhang * 2 + 0.1), M.beam, 0, wallH + roofH + 0.02, 0, g);
    // Gable triangles
    const tri = new THREE.Shape();
    tri.moveTo(-w / 2, 0);
    tri.lineTo(w / 2, 0);
    tri.lineTo(0, roofH);
    tri.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(tri, { depth: t, bevelEnabled: false });
    gableGeo.scale(1, 1, 1);
    for (const zSide of [-1, 1]) {
      const gm = this.addMesh(gableGeo, wallMat, 0, wallH, zSide * (d / 2) - (zSide > 0 ? t : 0), g);
      gm.material = wallMat;
      // map uv scale for extrude geometry (uses world units already) -> scale down
    }
    // Crossed gable decorations
    for (const s of [-1, 1]) {
      const deco = this.addMesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), M.beam, s * 0.35, wallH + roofH + 0.35, d / 2 + overhang, g);
      deco.rotation.z = s * 0.5;
    }
    // Chimney
    const chim = this.addMesh(texturedBox(0.7, 2.4, 0.7, 1.2), M.stone, w / 4, wallH + roofH - 0.2, -d / 4, g);
    this.chimneys = this.chimneys || [];
    const chimTop = new THREE.Vector3();
    chim.updateWorldMatrix(true, false);
    chimTop.set(0, 1.3, 0).applyMatrix4(chim.matrixWorld);
    this.chimneys.push(chimTop);

    // Doorstep
    this.addMesh(texturedBox(1.8, 0.3, 0.8, 1.2), M.stone, 0, -0.05, d / 2 + 0.5, g);

    // Interior furniture
    this.addMesh(texturedBox(1.4, 0.08, 0.8, 1), M.wallDark, -w / 2 + 1.2, 0.8, -d / 2 + 1, g);
    for (const [lx, lz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) {
      this.addMesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), M.beam, -w / 2 + 1.2 + lx, 0.4, -d / 2 + 1 + lz, g);
    }
    // Bed with blanket
    this.addMesh(texturedBox(1.1, 0.45, 2, 1), M.wallDark, w / 2 - 0.9, 0.25, -d / 2 + 1.2, g);
    this.addMesh(new THREE.BoxGeometry(1.0, 0.12, 1.4), M.cloth, w / 2 - 0.9, 0.52, -d / 2 + 1.5, g);
    // Hanging lantern (inner warm light is simulated by window glow)
    this.addMesh(new THREE.BoxGeometry(0.25, 0.35, 0.25), this.lanternMaterial, 0, wallH - 0.4, 0, g, false);

    g.updateMatrixWorld(true);

    // ---- Colliders ----
    const y0 = base - 1, y1 = base + wallH + roofH;
    const addWall = (lx, lz, hx, hz, yTop = y1, yBot = y0) => {
      const [wx, wz] = toWorld(x, z, rot, lx, lz);
      this.physics.addBox(wx, wz, hx, hz, rot, yBot, yTop, { kind: 'wall' });
    };
    addWall(0, -d / 2 + t / 2, w / 2, t / 2);
    addWall(-w / 2 + t / 2, 0, t / 2, d / 2);
    addWall(w / 2 - t / 2, 0, t / 2, d / 2);
    addWall(-w / 2 + sideW / 2, d / 2 - t / 2, sideW / 2, t / 2);
    addWall(w / 2 - sideW / 2, d / 2 - t / 2, sideW / 2, t / 2);
    addWall(0, d / 2 - t / 2, doorW / 2, t / 2, y1, base + doorH); // lintel
    // Floor is walkable (step up)
    const [fx, fz] = toWorld(x, z, rot, 0, 0);
    this.physics.addBox(fx, fz, w / 2 - t, d / 2 - t, rot, y0, base + 0.12, { kind: 'floor' });
    const [sx, sz] = toWorld(x, z, rot, 0, d / 2 + 0.5);
    this.physics.addBox(sx, sz, 0.9, 0.4, rot, y0, base + 0.1, { kind: 'floor' });
    // Table + bed colliders
    {
      const [tx, tz] = toWorld(x, z, rot, -w / 2 + 1.2, -d / 2 + 1);
      this.physics.addBox(tx, tz, 0.7, 0.4, rot, base, base + 0.84, { kind: 'furniture' });
      const [bx, bz] = toWorld(x, z, rot, w / 2 - 0.9, -d / 2 + 1.2);
      this.physics.addBox(bx, bz, 0.55, 1.0, rot, base, base + 0.58, { kind: 'furniture' });
    }

    // ---- Door ----
    this.addDoor(g, x, z, rot, base, doorW, doorH, d / 2 - t / 2);

    // ---- Chest inside ----
    if (opts.chest) {
      const [cx, cz] = toWorld(x, z, rot, w / 2 - 0.8, d / 2 - 1.1);
      this.addChest(cx, cz, rot + Math.PI / 2, [
        { id: 'potion', count: 1 }, { id: 'coin', count: 15 + Math.floor(this.rand() * 20) }, { id: 'food', count: 2 },
      ], base + 0.12);
    }

    this.exclusions.push({ x, z, r: Math.max(w, d) * 0.75 + 1 });
  }

  addDoor(houseGroup, hx, hz, rot, base, doorW, doorH, lz) {
    const pivot = new THREE.Group();
    pivot.position.set(-doorW / 2, 0.12, lz + 0.02);
    pivot.userData.dynamic = true;
    houseGroup.add(pivot);
    const leaf = new THREE.Mesh(texturedBox(doorW - 0.05, doorH - 0.1, 0.08, 1.2), this.mats.door);
    leaf.position.set(doorW / 2, (doorH - 0.1) / 2, 0);
    leaf.castShadow = leaf.receiveShadow = true;
    pivot.add(leaf);
    for (const yy of [0.4, doorH - 0.5]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.1, 0.08, 0.1), this.mats.metal);
      band.position.set(doorW / 2, yy, 0.02);
      pivot.add(band);
    }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 10), this.mats.metal);
    handle.position.set(doorW - 0.2, 1.05, 0.08);
    pivot.add(handle);

    const [cx, cz] = toWorld(hx, hz, rot, 0, lz);
    const collider = this.physics.addBox(cx, cz, doorW / 2, 0.1, rot, base - 1, base + doorH, { kind: 'door' });
    const door = {
      pivot, leaf, collider, open: false, angle: 0, target: 0,
      root: leaf,
      position: new THREE.Vector3(cx, base + 1, cz),
      getPrompt: () => (door.open ? 'Закрыть дверь' : 'Открыть дверь'),
      interact: (game) => {
        door.open = !door.open;
        door.target = door.open ? -Math.PI * 0.55 : 0;
        collider.enabled = !door.open;
        game.audio.play(door.open ? 'doorOpen' : 'doorClose', { position: door.position });
      },
    };
    this.doors.push(door);
    this.game.interaction.register(door);
  }

  addChest(x, z, rot, loot, yOverride) {
    const y = yOverride ?? this.groundY(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.scene.add(g);
    const body = this.addMesh(texturedBox(1.0, 0.55, 0.62, 1), this.mats.door, 0, 0.275, 0, g);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.55, -0.31);
    g.add(lidPivot);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 1.0, 10, 1, false, 0, Math.PI), this.mats.door);
    lid.rotation.z = Math.PI / 2;
    lid.rotation.y = Math.PI / 2;
    lid.position.set(0, 0, 0.31);
    lid.castShadow = true;
    lidPivot.add(lid);
    for (const bx of [-0.35, 0.35]) {
      this.addMesh(new THREE.BoxGeometry(0.08, 0.57, 0.64), this.mats.metal, bx, 0.28, 0, g);
      const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.325, 0.08, 10, 1, false, 0, Math.PI), this.mats.metal);
      lb.rotation.z = Math.PI / 2;
      lb.rotation.y = Math.PI / 2;
      lb.position.set(bx, 0, 0.31);
      lidPivot.add(lb);
    }
    this.addMesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), this.mats.gold, 0, 0.45, 0.32, g);
    // Soft glow of treasure inside when opened
    mergeChildrenByMaterial(g);
    mergeChildrenByMaterial(lidPivot);
    const glow = new THREE.PointLight('#ffcc66', 0, 3);
    glow.position.set(0, 0.7, 0);
    g.add(glow);
    this.physics.addBox(x, z, 0.5, 0.31, rot, y - 0.5, y + 0.85, { kind: 'chest' });
    const chest = {
      root: g, loot, opened: false, looted: false, lidAngle: 0, lidPivot, glow,
      position: new THREE.Vector3(x, y + 0.5, z),
      getPrompt: () => (chest.opened ? (chest.looted ? 'Закрыть сундук' : 'Забрать добычу') : 'Открыть сундук'),
      interact: (game) => {
        if (!chest.opened) {
          chest.opened = true;
          game.audio.play('chestOpen', { position: chest.position });
          if (!chest.looted) {
            chest.looted = true;
            chest.glowTime = 1.5;
            for (const it of chest.loot) game.inventory.addItem(it.id, it.count, true);
            game.particles.emit({ position: chest.position.clone().add(new THREE.Vector3(0, 0.3, 0)), count: 30, speed: 2, dir: new THREE.Vector3(0, 1, 0), spread: 0.6, color: '#ffd878', colorEnd: '#ff9a30', size: 0.12, life: 1, gravity: -2 });
          } else {
            game.ui.notify('Сундук пуст');
          }
        } else {
          chest.opened = false;
          game.audio.play('chestClose', { position: chest.position });
        }
      },
    };
    this.chests.push(chest);
    this.game.interaction.register(chest);
    this.exclusions.push({ x, z, r: 1.2 });
    return chest;
  }

  addCampfire(x, z, lit, scale = 1) {
    const cf = new Campfire(this.game, new THREE.Vector3(x, this.groundY(x, z), z), lit, scale, this.campfires.length < 3);
    this.campfires.push(cf);
    this.game.interaction.register(cf);
    this.exclusions.push({ x, z, r: 3.5 });
  }

  buildWell(x, z) {
    const y = this.groundY(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.staticRoot.add(g);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 12, 1, true), this.mats.stone);
    ring.position.y = 0.45;
    ring.material = this.mats.stone;
    ring.castShadow = ring.receiveShadow = true;
    g.add(ring);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(1.0, 12), new THREE.MeshStandardMaterial({ color: '#0a1a22', roughness: 0.1 }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.3;
    g.add(inner);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.12, 6, 16), this.mats.stone);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.9;
    g.add(rim);
    for (const s of [-1, 1]) this.addMesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), this.mats.beam, s * 1.0, 1.1, 0, g);
    const roof = this.addMesh(new THREE.ConeGeometry(1.6, 0.9, 4), this.mats.thatch, 0, 2.55, 0, g);
    roof.rotation.y = Math.PI / 4;
    const axle = this.addMesh(new THREE.CylinderGeometry(0.08, 0.08, 2.1, 6), this.mats.beam, 0, 1.8, 0, g);
    axle.rotation.z = Math.PI / 2;
    this.addMesh(new THREE.CylinderGeometry(0.2, 0.17, 0.3, 8), this.mats.wallDark, 0, 1.3, 0, g);
    this.physics.addCircle(x, z, 1.25, y - 1, y + 2.8, { kind: 'well' });
    this.exclusions.push({ x, z, r: 2 });
  }

  buildMarketStall(x, z, rot) {
    const y = this.groundY(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.staticRoot.add(g);
    this.addMesh(texturedBox(2.6, 0.1, 1.2, 1), this.mats.wall, 0, 0.95, 0, g);
    this.addMesh(texturedBox(2.6, 0.9, 0.1, 1), this.mats.wallDark, 0, 0.45, 0.55, g);
    for (const [px, pz] of [[-1.25, -0.55], [1.25, -0.55], [-1.25, 0.55], [1.25, 0.55]]) {
      this.addMesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), this.mats.beam, px, 1.2, pz, g);
    }
    // striped canopy
    for (let i = 0; i < 6; i++) {
      const c = this.addMesh(new THREE.BoxGeometry(0.46, 0.04, 1.6), i % 2 ? this.mats.cloth : new THREE.MeshStandardMaterial({ color: '#e8dcc0', roughness: 1 }), -1.15 + i * 0.46, 2.45, 0.1, g);
      c.rotation.x = -0.25;
    }
    // goods: apples, bread
    for (let i = 0; i < 9; i++) {
      const a = this.addMesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshStandardMaterial({ color: i % 3 ? '#b8302a' : '#7ab83a', roughness: 0.5 }), -0.9 + (i % 3) * 0.15, 1.06, -0.2 + Math.floor(i / 3) * 0.15, g);
      a.castShadow = false;
    }
    for (let i = 0; i < 3; i++) {
      const b = this.addMesh(new THREE.CapsuleGeometry(0.1, 0.2, 3, 6), new THREE.MeshStandardMaterial({ color: '#c08a48', roughness: 0.8 }), 0.4 + i * 0.3, 1.1, 0, g);
      b.rotation.z = Math.PI / 2;
    }
    const [wx, wz] = [x, z];
    this.physics.addBox(wx, wz, 1.35, 0.65, rot, y - 1, y + 1.0, { kind: 'stall' });
    this.exclusions.push({ x, z, r: 2 });
  }

  buildFences() {
    const v = WORLD.village;
    const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.2, 5);
    const railGeo = new THREE.BoxGeometry(0.08, 0.1, 1);
    const posts = [];
    // Fence arc around the south-west of the village, with gaps for paths
    const r = 30;
    for (let a = 0.9; a < 5.4; a += 0.085) {
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (this.isNearPath(x, z, 3.5)) { posts.push(null); continue; }
      posts.push(new THREE.Vector3(x, this.groundY(x, z), z));
    }
    const inst = new THREE.InstancedMesh(postGeo, this.mats.beam, posts.length);
    const railInst = new THREE.InstancedMesh(railGeo, this.mats.beam, posts.length * 2);
    const m = new THREE.Matrix4();
    let pi = 0, ri = 0;
    const q = new THREE.Quaternion();
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      if (!p) continue;
      m.makeTranslation(p.x, p.y + 0.5, p.z);
      inst.setMatrixAt(pi++, m);
      const nxt = posts[i + 1];
      if (nxt) {
        const mid = p.clone().add(nxt).multiplyScalar(0.5);
        const len = p.distanceTo(nxt);
        const ang = Math.atan2(nxt.x - p.x, nxt.z - p.z);
        const pitch = Math.atan2(nxt.y - p.y, Math.hypot(nxt.x - p.x, nxt.z - p.z));
        q.setFromEuler(new THREE.Euler(-pitch, ang, 0, 'YXZ'));
        for (const h of [0.45, 0.85]) {
          m.compose(new THREE.Vector3(mid.x, mid.y + h, mid.z), q, new THREE.Vector3(1, 1, len));
          railInst.setMatrixAt(ri++, m);
        }
        this.physics.addBox(mid.x, mid.z, 0.08, len / 2, ang, mid.y - 1, mid.y + 1.0, { kind: 'fence' });
      }
    }
    inst.count = pi;
    railInst.count = ri;
    inst.castShadow = railInst.castShadow = true;
    inst.receiveShadow = railInst.receiveShadow = true;
    this.scene.add(inst, railInst);
  }

  isNearPath(x, z, d) {
    return distanceToPaths(x, z) < d;
  }

  buildDecor() {
    const v = WORLD.village;
    const rand = this.rand;
    // Hay bales
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2, r = 10 + rand() * 12;
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (this.isBlocked(x, z, 1.5)) continue;
      const y = this.groundY(x, z);
      const hay = this.addMesh(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 12), this.mats.hay, x, y + 0.6, z);
      hay.rotation.z = Math.PI / 2;
      hay.rotation.y = rand() * Math.PI;
      this.physics.addCircle(x, z, 0.65, y - 1, y + 1.2, { kind: 'hay' });
      this.exclusions.push({ x, z, r: 1 });
    }
    // Log piles
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2, r = 12 + rand() * 12;
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (this.isBlocked(x, z, 2)) continue;
      const y = this.groundY(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = rand() * Math.PI;
      this.staticRoot.add(g);
      const logGeo = new THREE.CylinderGeometry(0.18, 0.18, 2, 7);
      const rows = [[-0.4, 0], [0, 0], [0.4, 0], [-0.2, 1], [0.2, 1], [0, 2]];
      for (const [lx, row] of rows) {
        const l = this.addMesh(logGeo, this.mats.beam, lx, 0.18 + row * 0.33, 0, g);
        l.rotation.x = Math.PI / 2;
      }
      this.physics.addBox(x, z, 0.7, 1.05, g.rotation.y, y - 1, y + 0.9, { kind: 'logs' });
      this.exclusions.push({ x, z, r: 1.6 });
    }
    // Lantern posts along the square
    this.lanternLights = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = v.x + Math.cos(a) * 11, z = v.z + Math.sin(a) * 11;
      if (this.isBlocked(x, z, 0.8)) continue;
      const y = this.groundY(x, z);
      this.addMesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), this.mats.beam, x, y + 1.3, z);
      const arm = this.addMesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), this.mats.beam, x + 0.2, y + 2.55, z);
      arm.castShadow = false;
      const lamp = this.addMesh(new THREE.BoxGeometry(0.2, 0.28, 0.2), this.lanternMaterial, x + 0.42, y + 2.35, z, this.staticRoot, false);
      lamp.castShadow = false;
      this.physics.addCircle(x, z, 0.12, y - 1, y + 2.6, { kind: 'post' });
    }
    // Signpost at spawn
    const sx = WORLD.spawn.x - 6.5, sz = WORLD.spawn.z - 2;
    const sy = this.groundY(sx, sz);
    this.addMesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6), this.mats.beam, sx, sy + 1.2, sz);
    const sign1 = this.addMesh(texturedBox(1.2, 0.3, 0.06, 1), this.mats.wall, sx + 0.4, sy + 2.0, sz);
    sign1.rotation.y = 0.4;
    const sign2 = this.addMesh(texturedBox(1.0, 0.3, 0.06, 1), this.mats.wall, sx - 0.3, sy + 1.6, sz);
    sign2.rotation.y = -0.7;
    this.physics.addCircle(sx, sz, 0.12, sy - 1, sy + 2.4, { kind: 'post' });

    // Banners at the village entrance
    for (const s of [-1, 1]) {
      const bx = v.x + 5 + s * 4.5, bz = v.z + 27;
      const by = this.groundY(bx, bz);
      this.addMesh(new THREE.CylinderGeometry(0.09, 0.11, 4.2, 6), this.mats.beam, bx, by + 2.1, bz);
      const banner = this.addMesh(new THREE.PlaneGeometry(0.8, 1.8, 1, 4), s > 0 ? this.mats.cloth : this.mats.cloth2, bx, by + 3.0, bz + 0.1, this.scene);
      banner.userData.banner = true;
      this.banners = this.banners || [];
      this.banners.push(banner);
      this.physics.addCircle(bx, bz, 0.13, by - 1, by + 4.2, { kind: 'post' });
    }
  }

  isBlocked(x, z, r) {
    for (const e of this.exclusions) if (Math.hypot(x - e.x, z - e.z) < e.r + r) return true;
    return this.isNearPath(x, z, 2.5);
  }

  buildDock() {
    // Small wooden pier into the lake
    const l = WORLD.lake;
    const sx = l.x - 8, sz = l.z + 28;
    const dirx = 0.15, dirz = -1;
    const len = 12;
    const rot = Math.atan2(dirx, dirz);
    const y = WORLD.waterLevel + 0.55;
    const g = new THREE.Group();
    g.position.set(sx, y, sz);
    g.rotation.y = rot;
    this.staticRoot.add(g);
    this.addMesh(texturedBox(2, 0.12, len, 1.5), this.mats.wall, 0, 0, len / 2, g);
    for (let i = 0; i <= len; i += 3) {
      for (const s of [-0.9, 0.9]) this.addMesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), this.mats.beam, s, -1.2, i, g);
    }
    const [cx, cz] = toWorld(sx, sz, rot, 0, len / 2);
    this.physics.addBox(cx, cz, 1, len / 2, rot, y - 3, y + 0.06, { kind: 'floor' });
    // a boat tied to the dock
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.5, 3.2, 8, 1, true, 0, Math.PI), this.mats.wallDark);
    hull.material = new THREE.MeshStandardMaterial({ map: Textures.planks([110, 75, 45]), side: THREE.DoubleSide, roughness: 0.9 });
    hull.rotation.x = Math.PI / 2;
    hull.rotation.y = Math.PI;
    hull.castShadow = true;
    boat.add(hull);
    const [bx, bz] = toWorld(sx, sz, rot, 1.8, len - 2);
    boat.position.set(bx, WORLD.waterLevel + 0.4, bz);
    boat.rotation.y = rot;
    this.boat = boat;
    this.scene.add(boat);
  }

  buildStandingStones() {
    // Mysterious ring of runestones on a hill to the east
    const cx = 72, cz = 48;
    const rockGeo = makeRockGeometry(501, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = cx + Math.cos(a) * 7, z = cz + Math.sin(a) * 7;
      const y = this.groundY(x, z);
      const m = new THREE.Mesh(rockGeo, this.mats.rock);
      m.scale.set(0.8, 2.6 + (i % 3) * 0.4, 0.5);
      m.position.set(x, y + 1.6, z);
      m.rotation.y = -a;
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      this.physics.addCircle(x, z, 0.75, y - 1, y + 4, { kind: 'rock' });
      // glowing rune
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.6), new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.85, map: this.runeTexture() }));
      rune.position.set(x - Math.cos(a) * 0.52, y + 2.0, z - Math.sin(a) * 0.52);
      rune.lookAt(cx, y + 2.0, cz);
      this.scene.add(rune);
    }
    this.exclusions.push({ x: cx, z: cz, r: 9 });
    this.runeCircle = new THREE.Vector3(cx, this.groundY(cx, cz), cz);
  }

  runeTexture() {
    if (this._rune) return this._rune;
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(32, 12); ctx.lineTo(32, 116);
    ctx.moveTo(32, 30); ctx.lineTo(54, 52);
    ctx.moveTo(32, 30); ctx.lineTo(10, 52);
    ctx.moveTo(32, 70); ctx.lineTo(52, 92);
    ctx.stroke();
    this._rune = new THREE.CanvasTexture(cv);
    return this._rune;
  }

  update(dt, time, dayNight) {
    const night = 1 - dayNight.daylight;
    this.windowMaterial.emissiveIntensity = 0.15 + night * 2.2;
    this.lanternMaterial.emissiveIntensity = 0.3 + night * 3.5;
    for (const d of this.doors) {
      d.angle += (d.target - d.angle) * Math.min(1, dt * 6);
      d.pivot.rotation.y = d.angle;
    }
    for (const c of this.chests) {
      const t = c.opened ? -1.9 : 0;
      c.lidAngle += (t - c.lidAngle) * Math.min(1, dt * 7);
      c.lidPivot.rotation.x = c.lidAngle;
      if (c.glowTime > 0) {
        c.glowTime -= dt;
        c.glow.intensity = Math.max(0, c.glowTime) * 3;
      }
    }
    for (const cf of this.campfires) cf.update(dt, time);
    if (this.banners) {
      for (const b of this.banners) b.rotation.y = Math.sin(time * 1.5 + b.position.x) * 0.25;
    }
    if (this.boat) {
      this.boat.position.y = WORLD.waterLevel + 0.3 + Math.sin(time * 1.2) * 0.05;
      this.boat.rotation.z = Math.sin(time * 0.9) * 0.04;
    }
    // Chimney smoke
    this._smokeT = (this._smokeT || 0) + dt;
    if (this._smokeT > 0.25 && this.chimneys) {
      this._smokeT = 0;
      for (const c of this.chimneys) {
        this.game.particles.emit({ position: c, count: 1, dir: new THREE.Vector3(0.3, 1, 0.1), spread: 0.2, speed: 1.2, color: '#9a9a9a', colorEnd: '#d0d0d0', size: 0.8, sizeEnd: 4, life: 5, drag: 0.3, additive: false, alpha: 0.25, fadeIn: 0.5 });
      }
    }
  }
}
