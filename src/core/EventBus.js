// Minimal publish/subscribe bus used to decouple gameplay systems from UI/audio.
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name)?.delete(fn);
  }
  emit(name, payload) {
    const set = this.listeners.get(name);
    if (set) for (const fn of set) fn(payload);
  }
}
