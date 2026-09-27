import * as THREE from 'three';
import { el } from './dom.js';
import { getItemIcon } from '../items/ItemIcons.js';
import { getItem, ItemType } from '../items/ItemDatabase.js';
import { HOTBAR_SIZE } from '../inventory/Inventory.js';

const TYPE_NAMES = {
  weapon: 'Оружие', magic: 'Магический артефакт', resource: 'Ресурс', consumable: 'Расходуемое', currency: 'Валюта',
};

/** Inventory window (TAB): hotbar row + backpack grid, drag & drop, split, use, drop to world, details panel. */
export class InventoryUI {
  constructor(game, root) {
    this.game = game;
    this.focused = 0;
    this.dragFrom = null;
    this.ghost = null;

    this.hotbarGrid = el('div', { class: 'inv-grid' });
    this.backpackGrid = el('div', { class: 'inv-grid' });
    this.slotEls = [];
    const inv = game.inventory;
    for (let i = 0; i < inv.slots.length; i++) {
      const s = el('div', { class: 'slot', 'data-index': String(i) });
      if (i < HOTBAR_SIZE) s.appendChild(el('span', { class: 'key', text: String(i + 1) }));
      s.addEventListener('pointerdown', (e) => this.onPointerDown(e, i));
      s.addEventListener('pointerenter', () => { if (!this.dragFrom && inv.slots[i]) this.showDetails(i); });
      s.addEventListener('contextmenu', (e) => { e.preventDefault(); this.useSlot(i); });
      (i < HOTBAR_SIZE ? this.hotbarGrid : this.backpackGrid).appendChild(s);
      this.slotEls.push(s);
    }
    this.details = el('div', { class: 'inv-details' });
    this.coins = el('div', { class: 'inv-coins' });
    this.window = el('div', { class: 'panel inv-window interactive' }, [
      el('div', { class: 'inv-main' }, [
        el('div', { class: 'panel-title', text: 'ИНВЕНТАРЬ' }),
        el('div', { class: 'inv-section-label', text: 'ПАНЕЛЬ БЫСТРОГО ДОСТУПА (1–8)' }),
        this.hotbarGrid,
        el('div', { class: 'inv-section-label', text: 'РЮКЗАК' }),
        this.backpackGrid,
        el('div', { class: 'inv-footer', html: '<b>Перетаскивание</b> — переместить / объединить · <kbd>ПКМ</kbd> — использовать / экипировать<br><kbd>Shift</kbd>+клик — разделить стопку · перетащите за пределы окна — выбросить<br><kbd>TAB</kbd> — закрыть' }),
        this.coins,
      ]),
      this.details,
    ]);
    this.root = el('div', { id: 'inventory', class: 'hidden interactive' }, [this.window]);
    root.appendChild(this.root);

    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    game.events.on('inventory:changed', () => { if (this.isOpen) this.render(); });
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open() {
    this.root.classList.remove('hidden');
    this.focused = this.game.inventory.selected;
    this.render();
    this.showDetails(this.focused);
  }

  close() {
    this.cancelDrag();
    this.root.classList.add('hidden');
  }

  render() {
    const inv = this.game.inventory;
    inv.slots.forEach((item, i) => {
      const s = this.slotEls[i];
      s.querySelectorAll('img,.count').forEach((n) => n.remove());
      s.classList.toggle('selected', i === inv.selected);
      s.classList.toggle('focused', i === this.focused);
      if (item) {
        s.appendChild(el('img', { src: getItemIcon(item.id), draggable: 'false' }));
        if (item.count > 1) s.appendChild(el('span', { class: 'count', text: String(item.count) }));
      }
    });
    this.coins.textContent = `◉ Монеты: ${inv.count('coin')}`;
    this.showDetails(this.focused);
  }

  showDetails(i) {
    this.focused = i;
    const item = this.game.inventory.slots[i];
    this.slotEls.forEach((s, j) => s.classList.toggle('focused', j === i));
    this.details.innerHTML = '';
    if (!item) {
      this.details.appendChild(el('div', { class: 'type', text: 'Пустой слот' }));
      return;
    }
    const def = getItem(item.id);
    const actions = el('div', { class: 'actions' });
    if (def.type === ItemType.CONSUMABLE) actions.appendChild(el('button', { class: 'btn small', text: 'Использовать', onclick: () => this.useSlot(i) }));
    if (i >= HOTBAR_SIZE || def.weapon) actions.appendChild(el('button', { class: 'btn small', text: i < HOTBAR_SIZE ? 'Взять в руки' : 'На панель', onclick: () => this.useSlot(i) }));
    if (item.count > 1) actions.appendChild(el('button', { class: 'btn small', text: 'Разделить', onclick: () => this.game.inventory.split(i) }));
    actions.appendChild(el('button', { class: 'btn small danger', text: 'Выбросить', onclick: () => this.dropSlot(i) }));
    this.details.append(
      el('div', { class: 'big-icon' }, [el('img', { src: getItemIcon(item.id) })]),
      el('div', { class: 'name', text: def.name }),
      el('div', { class: 'type', text: `${TYPE_NAMES[def.type] || def.type} · ${item.count} / ${def.stackSize}` }),
      el('div', { class: 'desc', text: def.description }),
      el('div', { class: 'stats', text: def.stats || '' }),
      actions
    );
  }

  useSlot(i) {
    const game = this.game;
    const inv = game.inventory;
    const item = inv.slots[i];
    if (!item) return;
    const def = getItem(item.id);
    game.audio.play('uiClick');
    if (def.type === ItemType.CONSUMABLE) {
      game.weapons.consume(def, i);
      return;
    }
    if (i < HOTBAR_SIZE) {
      inv.select(i);
      return;
    }
    // Move from backpack to the first free hotbar slot (or swap into the selected one) and equip it
    let target = inv.slots.slice(0, HOTBAR_SIZE).findIndex((x) => !x);
    if (target < 0) target = inv.selected;
    inv.move(i, target);
    inv.select(target);
  }

  dropSlot(i) {
    const game = this.game;
    const item = game.inventory.slots[i];
    if (!item) return;
    const fwd = game.cameraRig.forward;
    const pos = game.camera.position.clone().addScaledVector(fwd, 1.2);
    const vel = new THREE.Vector3(fwd.x * 3, 2.5, fwd.z * 3);
    if (item.id === 'stone') {
      for (let k = 0; k < item.count; k++) {
        const b = game.props.spawnStone(pos.clone().add(new THREE.Vector3(0, k * 0.4, 0)), 0.2);
        b.velocity.copy(vel);
      }
    } else {
      game.pickups.spawn(item.id, item.count, pos, { velocity: vel });
    }
    game.inventory.slots[i] = null;
    game.inventory.changed();
    game.audio.play('uiClose');
  }

  onPointerDown(e, i) {
    if (e.button !== 0) return;
    const inv = this.game.inventory;
    this.showDetails(i);
    if (!inv.slots[i]) return;
    if (e.shiftKey) {
      inv.split(i);
      return;
    }
    this.dragFrom = i;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragging = false;
  }

  onPointerMove(e) {
    if (this.dragFrom === null) return;
    if (!this.dragging && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > 5) {
      this.dragging = true;
      const item = this.game.inventory.slots[this.dragFrom];
      this.ghost = el('img', { id: 'drag-ghost', src: getItemIcon(item.id) });
      document.body.appendChild(this.ghost);
      this.slotEls[this.dragFrom].classList.add('dragging');
      this.game.audio.play('uiClick');
    }
    if (this.dragging) {
      this.ghost.style.left = `${e.clientX}px`;
      this.ghost.style.top = `${e.clientY}px`;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.slot');
      this.slotEls.forEach((s) => s.classList.toggle('drag-over', s === over));
    }
  }

  onPointerUp(e) {
    if (this.dragFrom === null) return;
    const from = this.dragFrom;
    if (this.dragging) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const slot = target?.closest?.('.slot');
      if (slot && slot.dataset.index !== undefined) {
        const to = Number(slot.dataset.index);
        this.game.inventory.move(from, to);
        this.focused = to;
        this.game.audio.play('uiClick');
      } else if (!target?.closest?.('.inv-window')) {
        this.dropSlot(from);
      }
    } else if (from < HOTBAR_SIZE) {
      this.game.inventory.select(from);
      this.game.audio.play('uiClick');
    }
    this.cancelDrag();
    this.render();
  }

  cancelDrag() {
    if (this.ghost) this.ghost.remove();
    this.ghost = null;
    this.slotEls.forEach((s) => s.classList.remove('dragging', 'drag-over'));
    this.dragFrom = null;
    this.dragging = false;
  }
}
