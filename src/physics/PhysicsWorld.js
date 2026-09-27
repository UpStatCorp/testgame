import * as THREE from 'three';
import { WORLD } from '../world/WorldConfig.js';

/**
 * Lightweight custom physics:
 *  - static colliders: vertical cylinders ("circle") and oriented boxes ("box") with a Y-range
 *  - terrain heightfield ground
 *  - dynamic spheres (rocks, crates, logs...) with gravity, bouncing, rolling, sleeping, buoyancy
 * Stored in a uniform spatial hash for fast neighbour queries.
 */
const CELL = 8;

export class PhysicsWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.gravity = -22;
    this.grid = new Map();
    this.colliders = new Set();
    this.bodies = [];
    this.queryStamp = 0;
    this._tmpN = new THREE.Vector3();
    this.onBodyImpact = null; // (body, speed) => void
    this.onBodyWater = null;
  }

  // ---------- static colliders ----------
  _cells(c) {
    const r = c.type === 'circle' ? c.r : Math.hypot(c.hx, c.hz);
    const x0 = Math.floor((c.x - r) / CELL), x1 = Math.floor((c.x + r) / CELL);
    const z0 = Math.floor((c.z - r) / CELL), z1 = Math.floor((c.z + r) / CELL);
    const keys = [];
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keys.push(x * 100003 + z);
    return keys;
  }

  add(c) {
    c._stamp = 0;
    c.enabled = c.enabled !== false;
    if (c.type === 'box') {
      c.cos = Math.cos(c.rot || 0);
      c.sin = Math.sin(c.rot || 0);
    }
    c._keys = this._cells(c);
    for (const k of c._keys) {
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(c);
    }
    this.colliders.add(c);
    return c;
  }

  addCircle(x, z, r, y0, y1, data = null) {
    return this.add({ type: 'circle', x, z, r, y0, y1, data });
  }

  addBox(x, z, hx, hz, rot, y0, y1, data = null) {
    return this.add({ type: 'box', x, z, hx, hz, rot, y0, y1, data });
  }

  remove(c) {
    if (!c || !this.colliders.has(c)) return;
    for (const k of c._keys) {
      const arr = this.grid.get(k);
      if (arr) {
        const i = arr.indexOf(c);
        if (i >= 0) arr.splice(i, 1);
      }
    }
    this.colliders.delete(c);
  }

  update(c) {
    this.remove(c);
    this.add(c);
  }

  query(x, z, r, out = []) {
    out.length = 0;
    this.queryStamp++;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.grid.get(cx * 100003 + cz);
        if (!arr) continue;
        for (const c of arr) {
          if (c._stamp === this.queryStamp || !c.enabled) continue;
          c._stamp = this.queryStamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Push a vertical capsule/cylinder (feet at pos.y, given height) out of static colliders in XZ.
   * Returns the push normal sum (x,z) or null. Also returns the highest walkable box top.
   */
  resolveCylinder(pos, radius, height, stepHeight = 0.45, result = {}) {
    result.hit = false;
    result.nx = 0;
    result.nz = 0;
    result.groundY = -Infinity;
    const list = this.query(pos.x, pos.z, radius + 2, this._q || (this._q = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const c of list) {
        if (pos.y + height < c.y0 || pos.y > c.y1) continue;
        if (c.type === 'circle') {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const rr = radius + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            if (c.y1 - pos.y <= stepHeight && c.walkable) {
              result.groundY = Math.max(result.groundY, c.y1);
              continue;
            }
            const d = Math.sqrt(d2) || 0.0001;
            const push = rr - d;
            const nx = dx / d, nz = dz / d;
            pos.x += nx * push;
            pos.z += nz * push;
            result.hit = true;
            result.nx += nx;
            result.nz += nz;
          }
        } else {
          // transform into box local space (matches three.js rotation.y = rot)
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          const cx = Math.max(-c.hx, Math.min(c.hx, lx));
          const cz = Math.max(-c.hz, Math.min(c.hz, lz));
          let ox = lx - cx, oz = lz - cz;
          const d2 = ox * ox + oz * oz;
          if (d2 >= radius * radius) continue;
          // Walkable top (e.g. stepping onto a platform/crate-like box)
          if (c.y1 - pos.y <= stepHeight) {
            result.groundY = Math.max(result.groundY, c.y1);
            continue;
          }
          let lnx, lnz, push;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            lnx = ox / d; lnz = oz / d; push = radius - d;
          } else {
            // Center inside box: push out along the smallest penetration axis
            const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
            if (px < pz) { lnx = Math.sign(lx) || 1; lnz = 0; push = px + radius; }
            else { lnx = 0; lnz = Math.sign(lz) || 1; push = pz + radius; }
          }
          const nx = lnx * c.cos + lnz * c.sin;
          const nz = -lnx * c.sin + lnz * c.cos;
          pos.x += nx * push;
          pos.z += nz * push;
          result.hit = true;
          result.nx += nx;
          result.nz += nz;
        }
      }
    }
    return result;
  }

  groundHeight(x, z) {
    return this.terrain.getHeight(x, z);
  }

  // ---------- dynamic bodies ----------
  addBody(body) {
    body.velocity = body.velocity || new THREE.Vector3();
    body.angular = body.angular || new THREE.Vector3();
    body.mass = body.mass ?? 1;
    body.restitution = body.restitution ?? 0.3;
    body.friction = body.friction ?? 2.5;
    body.sleeping = false;
    body.sleepTimer = 0;
    body.held = false;
    body.inWater = false;
    body.onGround = false;
    body.buoyancy = body.buoyancy ?? 0.4;
    this.bodies.push(body);
    return body;
  }

  removeBody(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  wake(body) {
    body.sleeping = false;
    body.sleepTimer = 0;
  }

  step(dt) {
    const sub = 2;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const b of this.bodies) {
        if (b.sleeping) continue;
        this.integrateBody(b, h);
      }
      this.collideBodies();
    }
    for (const b of this.bodies) {
      if (b.mesh) {
        b.mesh.position.copy(b.position);
        if (b.mesh.quaternion && b.quaternion) b.mesh.quaternion.copy(b.quaternion);
      }
    }
  }

  integrateBody(b, dt) {
    const p = b.position, v = b.velocity;
    if (!b.held) v.y += this.gravity * dt;
    // Water buoyancy + drag
    const wl = WORLD.waterLevel;
    const wasInWater = b.inWater;
    b.inWater = p.y - b.radius * 0.3 < wl;
    if (b.inWater) {
      if (!wasInWater && this.onBodyWater && v.length() > 2) this.onBodyWater(b);
      const sub = Math.min(1, (wl - (p.y - b.radius)) / (2 * b.radius));
      if (!b.held) v.y += -this.gravity * b.buoyancy * 2.2 * sub * dt;
      const drag = Math.exp(-2.5 * dt);
      v.multiplyScalar(drag);
    }
    p.addScaledVector(v, dt);

    // Terrain
    const gh = this.terrain.getHeight(p.x, p.z);
    b.onGround = false;
    if (p.y - b.radius < gh) {
      const n = this.terrain.getNormal(p.x, p.z, this._tmpN);
      p.y = gh + b.radius;
      const vn = v.dot(n);
      if (vn < 0) {
        if (-vn > 4 && this.onBodyImpact) this.onBodyImpact(b, -vn);
        v.addScaledVector(n, -(1 + b.restitution) * vn);
        if (Math.abs(vn) < 1.5) v.addScaledVector(n, -v.dot(n)); // kill tiny bounces
      }
      // Slope-driven rolling + friction
      const f = Math.exp(-b.friction * dt);
      v.x *= f;
      v.z *= f;
      b.onGround = true;
    }

    // Static colliders (horizontal push + landing on box tops)
    const list = this.query(p.x, p.z, b.radius + 2, this._bq || (this._bq = []));
    for (const c of list) {
      if (p.y + b.radius < c.y0 || p.y - b.radius > c.y1) continue;
      let nx = 0, nz = 0, pen = 0;
      if (c.type === 'circle') {
        const dx = p.x - c.x, dz = p.z - c.z;
        const rr = b.radius + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.0001;
        nx = dx / d; nz = dz / d; pen = rr - d;
      } else {
        const dx = p.x - c.x, dz = p.z - c.z;
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        const cx = Math.max(-c.hx, Math.min(c.hx, lx));
        const cz = Math.max(-c.hz, Math.min(c.hz, lz));
        const ox = lx - cx, oz = lz - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= b.radius * b.radius) continue;
        // resting on top?
        if (p.y - b.radius > c.y1 - 0.35 && v.y <= 0) {
          p.y = c.y1 + b.radius;
          if (v.y < -4 && this.onBodyImpact) this.onBodyImpact(b, -v.y);
          v.y = -v.y * b.restitution * 0.5;
          if (Math.abs(v.y) < 1) v.y = 0;
          const f = Math.exp(-b.friction * dt);
          v.x *= f; v.z *= f;
          b.onGround = true;
          continue;
        }
        let lnx, lnz;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          lnx = ox / d; lnz = oz / d; pen = b.radius - d;
        } else {
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) { lnx = Math.sign(lx) || 1; lnz = 0; pen = px + b.radius; }
          else { lnx = 0; lnz = Math.sign(lz) || 1; pen = pz + b.radius; }
        }
        nx = lnx * c.cos + lnz * c.sin;
        nz = -lnx * c.sin + lnz * c.cos;
      }
      p.x += nx * pen;
      p.z += nz * pen;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) {
        if (-vn > 5 && this.onBodyImpact) this.onBodyImpact(b, -vn);
        v.x -= (1 + b.restitution) * vn * nx;
        v.z -= (1 + b.restitution) * vn * nz;
      }
    }

    // World boundary
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD.playRadius + 20) {
      p.x *= (WORLD.playRadius + 20) / r;
      p.z *= (WORLD.playRadius + 20) / r;
      v.x *= -0.3; v.z *= -0.3;
    }
    if (p.y < -30) {
      p.y = this.terrain.getHeight(p.x, p.z) + 3;
      v.set(0, 0, 0);
    }

    // Rotation: rolling on ground, tumbling in the air
    if (b.quaternion) {
      if (b.onGround && !b.held) {
        b.angular.set(v.z, 0, -v.x).multiplyScalar(1 / Math.max(0.2, b.radius) * (b.rollFactor ?? 1));
      } else {
        b.angular.multiplyScalar(Math.exp(-0.5 * dt));
      }
      const w = b.angular.length();
      if (w > 1e-4) {
        const q = PhysicsWorld._q.setFromAxisAngle(PhysicsWorld._axis.copy(b.angular).divideScalar(w), w * dt);
        b.quaternion.premultiply(q);
      }
    }

    // Sleep
    if (!b.held && b.onGround && v.lengthSq() < 0.04) {
      b.sleepTimer += dt;
      if (b.sleepTimer > 0.8) {
        b.sleeping = true;
        v.set(0, 0, 0);
      }
    } else b.sleepTimer = 0;
  }

  collideBodies() {
    const bs = this.bodies;
    const n = bs.length;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        if (a.sleeping && b.sleeping) continue;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const pen = rr - d;
        const ima = a.held ? 0 : 1 / a.mass, imb = b.held ? 0 : 1 / b.mass;
        const sum = ima + imb || 1;
        a.position.x -= nx * pen * (ima / sum); a.position.y -= ny * pen * (ima / sum); a.position.z -= nz * pen * (ima / sum);
        b.position.x += nx * pen * (imb / sum); b.position.y += ny * pen * (imb / sum); b.position.z += nz * pen * (imb / sum);
        const rvx = b.velocity.x - a.velocity.x, rvy = b.velocity.y - a.velocity.y, rvz = b.velocity.z - a.velocity.z;
        const vn = rvx * nx + rvy * ny + rvz * nz;
        if (vn < 0) {
          const e = Math.min(a.restitution, b.restitution);
          const jimp = (-(1 + e) * vn) / sum;
          a.velocity.x -= jimp * ima * nx; a.velocity.y -= jimp * ima * ny; a.velocity.z -= jimp * ima * nz;
          b.velocity.x += jimp * imb * nx; b.velocity.y += jimp * imb * ny; b.velocity.z += jimp * imb * nz;
          if (-vn > 1) { this.wake(a); this.wake(b); }
          if (-vn > 5 && this.onBodyImpact) this.onBodyImpact(a, -vn);
        }
      }
    }
  }

  /** Ray vs dynamic bodies (spheres). Returns {body, distance} or null. */
  raycastBodies(origin, dir, maxDist) {
    let best = null;
    for (const b of this.bodies) {
      if (b.noRaycast) continue;
      const ox = b.position.x - origin.x, oy = b.position.y - origin.y, oz = b.position.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > maxDist + b.radius) continue;
      const px = ox - dir.x * t, py = oy - dir.y * t, pz = oz - dir.z * t;
      const d2 = px * px + py * py + pz * pz;
      const r = b.radius * 1.15;
      if (d2 > r * r) continue;
      const dist = t - Math.sqrt(r * r - d2);
      if (dist <= maxDist && (!best || dist < best.distance)) best = { body: b, distance: dist };
    }
    return best;
  }

  /** Ray vs static colliders (approximate, used to block interaction/TK through walls). */
  raycastStatic(origin, dir, maxDist) {
    const steps = Math.ceil(maxDist / 0.25);
    const p = PhysicsWorld._p;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      p.copy(origin).addScaledVector(dir, t);
      if (p.y < this.terrain.getHeight(p.x, p.z)) return t;
      const list = this.query(p.x, p.z, 0.5, this._rq || (this._rq = []));
      for (const c of list) {
        if (p.y < c.y0 || p.y > c.y1) continue;
        if (c.type === 'circle') {
          if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < c.r * c.r) return t;
        } else {
          const dx = p.x - c.x, dz = p.z - c.z;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz) return t;
        }
      }
    }
    return Infinity;
  }
}
PhysicsWorld._q = new THREE.Quaternion();
PhysicsWorld._axis = new THREE.Vector3();
PhysicsWorld._p = new THREE.Vector3();
