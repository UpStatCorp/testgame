/** Reusable health component for the player, creatures and villagers. */
export class Health {
  constructor(max, { regenRate = 0, regenDelay = 5, onDamage = null, onDeath = null, onHeal = null } = {}) {
    this.max = max;
    this.current = max;
    this.regenRate = regenRate;
    this.regenDelay = regenDelay;
    this.sinceDamage = 999;
    this.onDamage = onDamage;
    this.onDeath = onDeath;
    this.onHeal = onHeal;
    this.invulnerable = false;
    this.bonusRegen = 0; // extra temporary regeneration (food)
    this.bonusTime = 0;
  }

  get alive() {
    return this.current > 0;
  }

  get ratio() {
    return this.current / this.max;
  }

  damage(amount, source = null) {
    if (!this.alive || this.invulnerable || amount <= 0) return 0;
    const dealt = Math.min(this.current, amount);
    this.current -= dealt;
    this.sinceDamage = 0;
    if (this.onDamage) this.onDamage(dealt, source);
    if (this.current <= 0) {
      this.current = 0;
      if (this.onDeath) this.onDeath(source);
    }
    return dealt;
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.current;
    this.current = Math.min(this.max, this.current + amount);
    const healed = this.current - before;
    if (healed > 0 && this.onHeal) this.onHeal(healed);
    return healed;
  }

  addRegen(total, duration) {
    this.bonusRegen = total / duration;
    this.bonusTime = duration;
  }

  reset() {
    this.current = this.max;
    this.sinceDamage = 999;
    this.bonusTime = 0;
  }

  update(dt) {
    if (!this.alive) return;
    this.sinceDamage += dt;
    if (this.bonusTime > 0) {
      this.bonusTime -= dt;
      this.current = Math.min(this.max, this.current + this.bonusRegen * dt);
    }
    if (this.regenRate > 0 && this.sinceDamage > this.regenDelay) {
      this.current = Math.min(this.max, this.current + this.regenRate * dt);
    }
  }
}
