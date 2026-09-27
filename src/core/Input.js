// Keyboard / mouse input with per-frame "pressed" edges and pointer-lock handling.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseButtons = new Set();
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.enabled = true; // gameplay input gate (false while UI captures input)
    this.locked = false;
    this.onKeyDownHandlers = [];
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      // Prevent browser defaults for game keys (Tab focus, F1 help, Space scroll, Ctrl shortcuts)
      if (['Tab', 'F1', 'Space', 'ArrowUp', 'ArrowDown', 'Backquote'].includes(e.code) || (e.ctrlKey && this.locked)) {
        e.preventDefault();
      }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.code !== 'Escape') return;
      if (!e.repeat) {
        this.keys.add(e.code);
        this.pressed.add(e.code);
        for (const h of this.onKeyDownHandlers) h(e.code, e);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });
    window.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      this.mouseReleased.add(e.button);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        // Clamp crazy spikes some browsers produce right after locking
        const dx = Math.max(-300, Math.min(300, e.movementX || 0));
        const dy = Math.max(-300, Math.min(300, e.movementY || 0));
        this.mouseDX += dx;
        this.mouseDY += dy;
      }
    });
    window.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true }
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          try {
            const p2 = this.canvas.requestPointerLock();
            if (p2 && p2.catch) p2.catch(() => {});
          } catch (_) { /* ignore */ }
        });
      }
    } catch (_) {
      /* pointer lock unavailable (e.g. headless) */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onKeyDown(fn) {
    this.onKeyDownHandlers.push(fn);
  }

  isDown(code) {
    return this.enabled && this.keys.has(code);
  }
  wasPressed(code) {
    return this.enabled && this.pressed.has(code);
  }
  isMouseDown(btn) {
    return this.enabled && this.mouseButtons.has(btn);
  }
  wasMousePressed(btn) {
    return this.enabled && this.mousePressed.has(btn);
  }
  wasMouseReleased(btn) {
    return this.mouseReleased.has(btn);
  }

  /** Drop one-shot events (pressed/released/wheel/mouse delta) without touching held state. */
  clearEdges() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  // Called at the end of each frame
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
