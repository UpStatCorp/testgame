import { el } from './dom.js';
import { HUD } from './HUD.js';
import { InventoryUI } from './InventoryUI.js';
import { DebugMenu } from './DebugMenu.js';

const CONTROLS = [
  ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Движение'],
  ['<kbd>Мышь</kbd>', 'Осмотр'],
  ['<kbd>Space</kbd>', 'Прыжок'],
  ['<kbd>Shift</kbd>', 'Бег'],
  ['<kbd>Ctrl</kbd> / <kbd>C</kbd>', 'Присесть'],
  ['<kbd>E</kbd>', 'Взаимодействовать'],
  ['<kbd>ЛКМ</kbd>', 'Атака / использовать / телекинез'],
  ['<kbd>ПКМ</kbd>', 'Опустить предмет (жезл)'],
  ['<kbd>Колесо</kbd>', 'Дистанция телекинеза / смена слота'],
  ['<kbd>1</kbd>–<kbd>8</kbd>', 'Панель быстрого доступа'],
  ['<kbd>TAB</kbd>', 'Инвентарь'],
  ['<kbd>F1</kbd> / <kbd>`</kbd>', 'Меню разработчика'],
  ['<kbd>Esc</kbd>', 'Пауза / освободить мышь'],
];

/**
 * Coordinates HUD + modal windows (inventory, debug, pause, start, death) with pointer lock and input gating.
 */
export class UIManager {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.hud = new HUD(game, this.root);
    this.inventory = new InventoryUI(game, this.root);
    this.debug = new DebugMenu(game, this.root);
    this.modal = null; // 'inventory' | 'debug' | 'pause' | 'start' | 'death'
    this.intentionalUnlock = false;
    this.buildStart();
    this.buildPause();
    this.buildDeath();
    this.resumeHint = el('div', { class: 'panel resume-hint hidden interactive', html: 'Кликните, чтобы вернуться в игру', onclick: () => this.resume() });
    this.root.appendChild(this.resumeHint);

    const input = game.input;
    input.onKeyDown((code) => this.onKey(code));
    input.onLockChange = (locked) => {
      if (locked) {
        this.resumeHint.classList.add('hidden');
        return;
      }
      if (this.intentionalUnlock) {
        this.intentionalUnlock = false;
        return;
      }
      // Browser released the lock (Esc): open pause unless another modal is up
      if (game.state === 'playing' && !this.modal) this.openPause();
    };
    game.canvas.addEventListener('click', () => {
      if (game.state === 'playing' && !this.modal && !input.locked) input.requestLock();
    });
    game.events.on('player:died', () => setTimeout(() => this.openDeath(), 1400));
  }

  notify(t, icon) { this.hud.notify(t, icon); }
  floatingText(target, text) { this.hud.floatingText(target, text); }
  damageNumber(pos, amount) { this.hud.damageNumber(pos, amount); }
  flashStamina() { this.hud.flashStamina(); }

  buildStart() {
    const grid = el('div', { class: 'controls-grid' });
    for (const [k, v] of CONTROLS) grid.append(el('span', { html: k }), el('span', { text: v }));
    this.startBtn = el('button', { class: 'btn primary', text: 'Начать путешествие', onclick: () => this.game.start() });
    this.start = el('div', { class: 'overlay interactive' }, [
      el('div', { class: 'start-title', text: 'Эхо Северных Лесов' }),
      el('div', { class: 'start-sub', text: 'Мшистый Дол ждёт своего героя' }),
      el('div', { class: 'panel menu-box' }, [el('div', { class: 'panel-title', text: 'УПРАВЛЕНИЕ' }), grid, this.startBtn]),
    ]);
    this.root.appendChild(this.start);
    this.modal = 'start';
  }

  buildPause() {
    const g = this.game;
    const sens = el('input', { type: 'range', min: '0.3', max: '3', step: '0.05', value: '1' });
    sens.addEventListener('input', () => (g.cameraRig.sensitivity = 0.0022 * Number(sens.value)));
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(g.audio.volume) });
    vol.addEventListener('input', () => g.audio.setVolume(Number(vol.value)));
    const fov = el('input', { type: 'range', min: '60', max: '100', step: '1', value: '75' });
    fov.addEventListener('input', () => (g.cameraRig.baseFov = Number(fov.value)));
    const invert = el('input', { type: 'checkbox' });
    invert.addEventListener('change', () => (g.cameraRig.invertY = invert.checked));
    const grid = el('div', { class: 'controls-grid' });
    for (const [k, v] of CONTROLS) grid.append(el('span', { html: k }), el('span', { text: v }));
    this.controlsBox = el('div', { class: 'hidden' }, [grid]);
    this.pause = el('div', { class: 'overlay hidden interactive' }, [
      el('div', { class: 'panel menu-box' }, [
        el('div', { class: 'panel-title', text: 'ПАУЗА' }),
        el('button', { class: 'btn primary', text: 'Продолжить', onclick: () => this.resume() }),
        el('div', { class: 'setting-row' }, [el('span', { text: 'Чувствительность мыши' }), sens]),
        el('div', { class: 'setting-row' }, [el('span', { text: 'Громкость' }), vol]),
        el('div', { class: 'setting-row' }, [el('span', { text: 'Поле зрения (FOV)' }), fov]),
        el('div', { class: 'setting-row' }, [el('span', { text: 'Инвертировать мышь по Y' }), invert]),
        el('button', { class: 'btn', text: 'Управление', onclick: () => this.controlsBox.classList.toggle('hidden') }),
        this.controlsBox,
        el('button', { class: 'btn', text: 'Полноэкранный режим', onclick: () => this.toggleFullscreen() }),
      ]),
    ]);
    this.root.appendChild(this.pause);
  }

  buildDeath() {
    this.deathStats = el('div', { class: 'start-sub' });
    this.death = el('div', { class: 'overlay death-overlay hidden interactive' }, [
      el('div', { class: 'death-title', text: 'ВЫ ПОГИБЛИ' }),
      this.deathStats,
      el('button', { class: 'btn primary', text: 'Возродиться в деревне', onclick: () => this.respawn() }),
    ]);
    this.root.appendChild(this.death);
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        // In fullscreen, Keyboard Lock lets Ctrl+W etc. reach the game (Chromium)
        if (navigator.keyboard?.lock) navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'Tab']).catch(() => {});
      } else await document.exitFullscreen();
    } catch (_) { /* not allowed */ }
  }

  setModal(m) {
    this.modal = m;
    this.game.input.enabled = !m;
    if (m) {
      this.game.input.keys.clear();
      this.game.input.mouseButtons.clear();
    }
  }

  releaseForUI() {
    if (this.game.input.locked) {
      this.intentionalUnlock = true;
      this.game.input.releaseLock();
    }
  }

  resume() {
    this.pause.classList.add('hidden');
    this.inventory.close();
    this.debug.close();
    this.setModal(null);
    this.game.audio.play('uiClose');
    this.game.input.requestLock();
    // If the browser refuses the lock (e.g. cooldown after Esc), show a click-to-resume hint
    setTimeout(() => {
      if (!this.game.input.locked && this.game.state === 'playing' && !this.modal && !this.game.headless) this.resumeHint.classList.remove('hidden');
    }, 400);
  }

  openPause() {
    this.inventory.close();
    this.debug.close();
    this.setModal('pause');
    this.pauseOpenedAt = performance.now();
    this.pause.classList.remove('hidden');
    this.game.audio.play('uiOpen');
  }

  openDeath() {
    this.inventory.close();
    this.debug.close();
    this.pause.classList.add('hidden');
    this.releaseForUI();
    this.setModal('death');
    this.deathStats.textContent = `Повержено врагов: ${this.game.player.stats.kills} · Пройдено: ${Math.round(this.game.player.stats.distance)} м`;
    this.death.classList.remove('hidden');
  }

  respawn() {
    this.death.classList.add('hidden');
    this.game.player.respawn();
    this.resume();
  }

  hideStart() {
    this.start.classList.add('hidden');
    this.setModal(null);
  }

  toggleInventory() {
    if (this.modal === 'inventory') {
      this.inventory.close();
      this.game.audio.play('uiClose');
      this.resume();
    } else if (!this.modal || this.modal === 'debug') {
      this.debug.close();
      this.releaseForUI();
      this.setModal('inventory');
      this.inventory.open();
      this.game.audio.play('uiOpen');
    }
  }

  toggleDebug() {
    if (this.modal === 'debug') {
      this.debug.close();
      this.resume();
    } else if (!this.modal || this.modal === 'inventory') {
      this.inventory.close();
      this.releaseForUI();
      this.setModal('debug');
      this.debug.open();
      this.game.audio.play('uiOpen');
    }
  }

  onKey(code) {
    const game = this.game;
    if (game.state !== 'playing') return;
    if (code === 'Tab') this.toggleInventory();
    else if (code === 'F1' || code === 'Backquote') this.toggleDebug();
    else if (code === 'Escape') {
      if (game.dialog.active) game.dialog.close();
      else if (this.modal === 'inventory' || this.modal === 'debug') {
        this.inventory.close();
        this.debug.close();
        this.resume();
      } else if (this.modal === 'pause') {
        // ignore the Esc that just released the pointer lock and opened this menu
        if (performance.now() - this.pauseOpenedAt > 350) this.resume();
      }
      else if (!this.modal) this.openPause();
    } else if (!this.modal && code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 8) game.inventory.select(n - 1);
    }
  }

  update(dt) {
    this.hud.update(dt);
    this.debug.update(dt);
  }
}
