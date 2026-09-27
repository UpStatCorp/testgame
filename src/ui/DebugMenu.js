import * as THREE from 'three';
import { el } from './dom.js';
import { ITEMS } from '../items/ItemDatabase.js';
import { WORLD } from '../world/WorldConfig.js';

/** Developer menu (F1): live stats + spawn / world / cheat commands. */
export class DebugMenu {
  constructor(game, root) {
    this.game = game;
    this.stats = el('div', { class: 'stats' });
    const spawns = game.entities;
    const btn = (text, fn, cls = '') => el('button', { class: `btn ${cls}`, text, onclick: () => { game.audio.play('uiClick'); fn(); this.refresh(); } });
    this.godBtn = btn('Режим бога: выкл', () => {
      game.player.godMode = !game.player.godMode;
    });
    this.speedBtn = btn('Скорость времени ×1', () => {
      const dn = game.dayNight;
      dn.timeScale = dn.timeScale === 1 ? 10 : dn.timeScale === 10 ? 60 : 1;
    });
    this.bloomBtn = btn('Свечение (Bloom): вкл', () => {
      game.renderSettings.bloom = !game.renderSettings.bloom;
    });
    this.root = el('div', { id: 'debug', class: 'panel hidden interactive' }, [
      el('div', { class: 'panel-title', text: 'DEVELOPER MENU' }),
      this.stats,
      el('div', { class: 'section', text: 'SPAWN' }),
      el('div', { class: 'grid' }, [
        btn('Spawn Villager', () => spawns.debugSpawnVillager(1)),
        btn('Spawn Enemy', () => spawns.debugSpawnEnemy(1)),
        btn('Spawn 5 Villagers', () => spawns.debugSpawnVillager(5)),
        btn('Spawn 5 Enemies', () => spawns.debugSpawnEnemy(5)),
        btn('Spawn Item', () => spawns.debugSpawnItem()),
        btn('Spawn Brute', () => spawns.debugSpawnEnemy(1, 'brute')),
        btn('Spawn Prop', () => spawns.debugSpawnProp()),
        btn('Clear Spawned Objects', () => spawns.clearSpawned(), 'danger'),
      ]),
      el('div', { class: 'section', text: 'PLAYER' }),
      el('div', { class: 'grid' }, [
        btn('Полное лечение', () => { game.player.health.reset(); game.player.stamina = 100; }),
        this.godBtn,
        btn('Выдать все предметы', () => {
          for (const id of Object.keys(ITEMS)) if (game.inventory.count(id) === 0) game.inventory.addItem(id, Math.min(5, ITEMS[id].stackSize), true);
        }),
        btn('Убить всех врагов', () => spawns.killAllEnemies(), 'danger'),
      ]),
      el('div', { class: 'section', text: 'WORLD' }),
      el('div', { class: 'grid' }, [
        btn('Утро (07:00)', () => game.dayNight.setHour(7)),
        btn('Полдень (12:00)', () => game.dayNight.setHour(12)),
        btn('Закат (18:30)', () => game.dayNight.setHour(18.4)),
        btn('Ночь (23:00)', () => game.dayNight.setHour(23)),
        this.speedBtn,
        this.bloomBtn,
      ]),
      el('div', { class: 'section', text: 'TELEPORT' }),
      el('div', { class: 'grid' }, [
        btn('Деревня', () => this.teleport(WORLD.spawn.x, WORLD.spawn.z)),
        btn('Озеро', () => this.teleport(WORLD.lake.x - 10, WORLD.lake.z + 36)),
        btn('Камни Рун', () => this.teleport(64, 40)),
        btn('Горы', () => this.teleport(-120, -110)),
      ]),
      el('div', { class: 'section', text: 'F1 — закрыть' }),
    ]);
    root.appendChild(this.root);
    this.fps = 60;
    this.frames = 0;
    this.acc = 0;
  }

  teleport(x, z) {
    const p = this.game.player;
    p.position.set(x, this.game.terrain.getHeight(x, z) + 0.5, z);
    p.velocity.set(0, 0, 0);
    this.game.cameraRig.smoothedEye = null;
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }
  open() {
    this.root.classList.remove('hidden');
    this.refresh();
  }
  close() {
    this.root.classList.add('hidden');
  }

  refresh() {
    const g = this.game;
    this.godBtn.textContent = `Режим бога: ${g.player.godMode ? 'вкл' : 'выкл'}`;
    this.godBtn.classList.toggle('on', g.player.godMode);
    this.speedBtn.textContent = `Скорость времени ×${g.dayNight.timeScale}`;
    this.bloomBtn.textContent = `Свечение (Bloom): ${g.renderSettings.bloom ? 'вкл' : 'выкл'}`;
    this.bloomBtn.classList.toggle('on', g.renderSettings.bloom);
  }

  update(dt) {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      if (this.isOpen) this.renderStats();
    }
  }

  renderStats() {
    const g = this.game;
    const p = g.player.position;
    const ents = g.entities;
    const villagers = ents.villagers.length;
    const enemies = ents.enemies;
    const alive = enemies.filter((e) => e.health.alive).length;
    const states = {};
    for (const e of enemies) states[e.state] = (states[e.state] || 0) + 1;
    const info = g.renderer.info;
    this.stats.innerHTML = [
      `FPS: <b>${(1000 / g.perf.frame).toFixed(0)}</b> · CPU ${g.perf.update.toFixed(1)} ms · render ${g.perf.render.toFixed(1)} ms`,
      `Draw calls: ${info.render.calls} · треугольники: ${(info.render.triangles / 1000).toFixed(0)}k`,
      `Позиция: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
      `Активные NPC: <b>${villagers + enemies.length}</b> (жители: ${villagers}, враги: ${alive})`,
      `Состояния врагов: ${Object.entries(states).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}`,
      `Физ. объекты: ${g.physics.bodies.length} (спят: ${g.physics.bodies.filter((b) => b.sleeping).length}) · предметы: ${g.pickups.list.length}`,
      `Время: ${g.dayNight.clockString} ${g.dayNight.isNight ? '(ночь)' : '(день)'} · трава: ${g.vegetation.grassCount}`,
      `HP: ${g.player.health.current.toFixed(0)} · Стамина: ${g.player.stamina.toFixed(0)} · Убито: ${g.player.stats.kills}`,
    ].join('<br>');
    void THREE;
  }
}
