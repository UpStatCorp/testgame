import * as THREE from 'three';

/**
 * Hit detection & damage resolution:
 *  - melee arcs (range + angular cone + line-of-sight) against creatures, physics props and trees
 *  - fast-moving physics bodies (thrown rocks, telekinesis projectiles) damaging creatures
 */
export class CombatSystem {
  constructor(game) {
    this.game = game;
    this._fwd = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._origin = new THREE.Vector3();
  }

  inArc(origin, fwd, target, range, arc) {
    const to = this._to.subVectors(target, origin);
    const vertical = to.y;
    to.y = 0;
    const dist = to.length();
    if (dist > range) return null;
    if (Math.abs(vertical) > 2.6) return null;
    if (dist > 0.3) {
      to.divideScalar(dist);
      const ang = Math.acos(THREE.MathUtils.clamp(to.dot(fwd), -1, 1));
      if (ang > arc / 2) return null;
    }
    return dist;
  }

  meleeAttack(def) {
    const game = this.game;
    const origin = this._origin.copy(game.camera.position);
    const fwd3 = game.cameraRig.forward;
    const fwd = this._fwd.set(fwd3.x, 0, fwd3.z).normalize();
    let hitSomething = false;
    let hitCount = 0;

    // Creatures (enemies and villagers)
    for (const c of game.entities.creatures) {
      if (!c.health.alive) continue;
      const center = c.position.clone();
      center.y += c.height * 0.5;
      const d = this.inArc(origin, fwd, center, def.range + c.radius, def.arc);
      if (d === null) continue;
      const dir = new THREE.Vector3().subVectors(center, origin);
      const los = game.physics.raycastStatic(origin, dir.clone().normalize(), Math.max(0, dir.length() - c.radius - 0.3));
      if (los !== Infinity) continue;
      const kb = dir.clone().setY(0).normalize();
      c.takeHit(def.damage * (0.9 + Math.random() * 0.2), kb.multiplyScalar(def.knockback), { source: 'player', weapon: def.id });
      const hitPos = center.clone().addScaledVector(dir.normalize(), -c.radius * 0.8);
      game.particles.hitSparks(hitPos, dir.clone().negate(), def.heavy);
      if (c.isEnemy) game.particles.blood(hitPos, dir);
      hitSomething = true;
      hitCount++;
    }

    // Physics props get knocked around
    for (const b of game.physics.bodies) {
      if (b.held) continue;
      const d = this.inArc(origin, fwd, b.position, def.range + b.radius, def.arc);
      if (d === null) continue;
      const dir = new THREE.Vector3().subVectors(b.position, origin).setY(0).normalize();
      const impulse = (def.knockback * 1.6) / Math.max(0.5, b.mass);
      b.velocity.addScaledVector(dir, impulse);
      b.velocity.y += impulse * 0.35;
      b.angular.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(impulse * 2);
      game.physics.wake(b);
      game.particles.hitSparks(b.position, dir.clone().negate(), false);
      game.audio.play(b.material === 'wood' ? 'hitWood' : 'hitStone', { position: b.position });
      if (b.onHit) b.onHit(def);
      hitSomething = true;
    }

    // Trees give wood
    const tHit = game.vegetation.raycastTrees(origin, fwd3, def.range + 0.4);
    if (tHit && !tHit.tree.felled) {
      const p = origin.clone().addScaledVector(fwd3, tHit.distance);
      game.particles.woodChips(p, fwd3.clone().negate());
      game.audio.play('hitWood', { position: p });
      game.world.harvestTree(tHit.tree, def.heavy ? 2 : 1);
      hitSomething = true;
    }

    if (hitSomething) {
      game.audio.play('hit', { heavy: def.heavy, metal: def.id !== 'fists' });
      game.cameraRig.addTrauma(def.heavy ? 0.45 : 0.18);
      if (hitCount > 0) game.hitStop(def.heavy ? 0.09 : 0.04);
    }
    return hitSomething;
  }

  /** Thrown / flung physics bodies hurt creatures on contact. */
  update(dt) {
    const game = this.game;
    for (const b of game.physics.bodies) {
      if (b.dangerTime > 0) b.dangerTime -= dt;
      const speed = b.velocity.length();
      if (speed < 7 || b.held) continue;
      for (const c of game.entities.creatures) {
        if (!c.health.alive) continue;
        if (c.lastBodyHit === b && c.lastBodyHitTime > 0) continue;
        const cy = c.position.y + c.height * 0.5;
        const dx = b.position.x - c.position.x, dz = b.position.z - c.position.z;
        const dy = b.position.y - cy;
        const rr = b.radius + c.radius;
        if (dx * dx + dz * dz > rr * rr || Math.abs(dy) > c.height * 0.6 + b.radius) continue;
        const dmg = Math.min(120, speed * b.mass * 1.6);
        const dir = b.velocity.clone().setY(0).normalize();
        c.takeHit(dmg, dir.clone().multiplyScalar(Math.min(14, speed * b.mass * 0.4)), { source: 'projectile' });
        c.lastBodyHit = b;
        c.lastBodyHitTime = 0.6;
        game.particles.hitSparks(b.position, dir.clone().negate(), dmg > 40);
        if (c.isEnemy) game.particles.blood(b.position, dir);
        game.audio.play('hit', { position: b.position, heavy: dmg > 40, metal: false });
        // bounce back
        b.velocity.multiplyScalar(-0.3);
        b.velocity.y = 3;
      }
    }
  }
}
