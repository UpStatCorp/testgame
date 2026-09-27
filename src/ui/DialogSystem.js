import { el } from './dom.js';

/** Simple NPC conversation: typewriter lines, E / click to advance, auto-close when walking away. */
export class DialogSystem {
  constructor(game, root) {
    this.game = game;
    this.active = null;
    this.speaker = el('div', { class: 'speaker' });
    this.text = el('div', { class: 'text' });
    this.hint = el('div', { class: 'hint', html: '<kbd>E</kbd> — далее · <kbd>Esc</kbd> / отойти — завершить' });
    this.root = el('div', { id: 'dialog', class: 'panel hidden' }, [this.speaker, this.text, this.hint]);
    root.appendChild(this.root);
    this.full = '';
    this.shown = 0;
  }

  open(npc) {
    this.active = npc;
    npc.lineIndex = 0;
    this.speaker.innerHTML = `${npc.name}<small>${npc.profile.title || ''}</small>`;
    this.root.classList.remove('hidden');
    this.game.audio.play('villagerHi', { position: npc.position, pitch: npc.voicePitch });
    this.advance();
  }

  advance() {
    const npc = this.active;
    if (!npc) return;
    // finish typing first
    if (this.shown < this.full.length) {
      this.shown = this.full.length;
      this.text.textContent = this.full;
      return;
    }
    const line = npc.nextLine();
    if (line === null) {
      this.close();
      return;
    }
    this.full = line;
    this.shown = 0;
    this.text.textContent = '';
    this.game.audio.play('uiClick', { volume: 0.4 });
  }

  close() {
    if (!this.active) return;
    const npc = this.active;
    this.active = null;
    this.root.classList.add('hidden');
    npc.onDialogEnd();
  }

  update(dt) {
    if (!this.active) return;
    const input = this.game.input;
    if (input.wasPressed('KeyE') || input.wasMousePressed(0)) {
      input.pressed.delete('KeyE');
      input.mousePressed.delete(0);
      this.advance();
    }
    if (!this.active) return;
    if (this.shown < this.full.length) {
      this.shown = Math.min(this.full.length, this.shown + dt * 55);
      this.text.textContent = this.full.slice(0, Math.floor(this.shown));
    }
    const d = this.active.position.distanceTo(this.game.player.position);
    if (d > 5.5 || !this.game.player.health.alive) this.close();
  }
}
