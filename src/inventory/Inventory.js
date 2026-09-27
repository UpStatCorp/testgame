import { getItem } from '../items/ItemDatabase.js';

export const HOTBAR_SIZE = 8;
export const BACKPACK_SIZE = 24;

/** Slot-based inventory. Slots 0..7 form the hotbar. Emits 'inventory:changed'. */
export class Inventory {
  constructor(events) {
    this.events = events;
    this.slots = new Array(HOTBAR_SIZE + BACKPACK_SIZE).fill(null);
    this.selected = 0;
  }

  changed() {
    this.events.emit('inventory:changed', this);
  }

  /** Adds items, stacking first then filling empty slots. Returns count that did not fit. */
  addItem(id, count = 1, notify = false) {
    const def = getItem(id);
    if (!def) return count;
    let left = count;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < def.stackSize) {
        const add = Math.min(left, def.stackSize - s.count);
        s.count += add;
        left -= add;
      }
    }
    // weapons/tools prefer the hotbar, resources prefer the backpack after hotbar is checked
    const order = [...this.slots.keys()];
    for (const i of order) {
      if (left <= 0) break;
      if (!this.slots[i]) {
        const add = Math.min(left, def.stackSize);
        this.slots[i] = { id, count: add };
        left -= add;
      }
    }
    const added = count - left;
    if (added > 0) {
      this.changed();
      if (notify) this.events.emit('item:added', { id, count: added });
    }
    if (left > 0) this.events.emit('inventory:full', { id, count: left });
    return left;
  }

  count(id) {
    return this.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
  }

  removeFromSlot(index, count = 1) {
    const s = this.slots[index];
    if (!s) return 0;
    const n = Math.min(count, s.count);
    s.count -= n;
    if (s.count <= 0) this.slots[index] = null;
    this.changed();
    return n;
  }

  removeItem(id, count = 1) {
    let left = count;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) left -= this.removeFromSlot(i, left);
    }
    return count - left;
  }

  /** Move/merge/swap stacks between slots (drag & drop). */
  move(from, to) {
    if (from === to) return;
    const a = this.slots[from], b = this.slots[to];
    if (!a) return;
    if (b && b.id === a.id) {
      const max = getItem(a.id).stackSize;
      const add = Math.min(a.count, max - b.count);
      b.count += add;
      a.count -= add;
      if (a.count <= 0) this.slots[from] = null;
    } else {
      this.slots[to] = a;
      this.slots[from] = b;
    }
    this.changed();
  }

  /** Split half of a stack into the first empty slot. */
  split(index) {
    const s = this.slots[index];
    if (!s || s.count < 2) return;
    const empty = this.slots.findIndex((x) => !x);
    if (empty < 0) return;
    const half = Math.floor(s.count / 2);
    s.count -= half;
    this.slots[empty] = { id: s.id, count: half };
    this.changed();
  }

  select(index) {
    if (index < 0 || index >= HOTBAR_SIZE) return;
    if (this.selected !== index) {
      this.selected = index;
      this.events.emit('hotbar:selected', index);
      this.changed();
    }
  }

  getSelected() {
    return this.slots[this.selected];
  }
}
