import * as THREE from 'three';
import { el } from './dom.js';
import { getItemIcon } from '../items/ItemIcons.js';
import { getItem } from '../items/ItemDatabase.js';
import { HOTBAR_SIZE } from '../inventory/Inventory.js';
import { WORLD } from '../world/WorldConfig.js';

/** In-game HUD: crosshair, prompt, HP/stamina, hotbar, compass, clock, notifications, vignettes, floating text. */
export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = el('div', { id: 'hud' });
    root.appendChild(this.root);

    this.vignette = el('div', { id: 'damage-vignette' });
    this.lowHp = el('div', { id: 'lowhp-vignette' });
    this.healV = el('div', { id: 'heal-vignette' });
    this.waterTint = el('div', { id: 'water-tint' });
    this.root.append(this.waterTint, this.vignette, this.lowHp, this.healV);

    this.crosshair = el('div', { id: 'crosshair' }, [el('div', { class: 'ring' }), el('div', { class: 'dot' }), el('div', { class: 'hitmarker' })]);
    this.prompt = el('div', { id: 'prompt', class: 'hidden' });
    this.tkHint = el('div', { id: 'tk-hint', class: 'hidden', html: 'Жезл: наведитесь на предмет · <kbd>ЛКМ</kbd> удерживать — поднять · отпустить — бросить · <kbd>Колесо</kbd> дистанция · <kbd>ПКМ</kbd> опустить' });
    this.root.append(this.crosshair, this.prompt, this.tkHint);

    // Vitals
    this.hpFill = el('div', { class: 'fill' });
    this.hpLag = el('div', { class: 'lag' });
    this.hpBar = el('div', { class: 'bar hp' }, [this.hpLag, this.hpFill]);
    this.hpText = el('span', { text: '100 / 100' });
    this.stFill = el('div', { class: 'fill' });
    this.stBar = el('div', { class: 'bar stam' }, [this.stFill]);
    this.root.append(el('div', { id: 'vitals' }, [
      el('div', { class: 'bar-label' }, [el('span', { text: 'ЗДОРОВЬЕ' }), this.hpText]), this.hpBar,
      el('div', { class: 'bar-label' }, [el('span', { text: 'ВЫНОСЛИВОСТЬ' })]), this.stBar,
    ]));

    // Hotbar
    this.hotbar = el('div', { id: 'hotbar', class: 'panel' });
    this.hotbarSlots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = el('div', { class: 'slot' }, [el('span', { class: 'key', text: String(i + 1) })]);
      this.hotbar.appendChild(s);
      this.hotbarSlots.push(s);
    }
    this.weaponName = el('div', { id: 'weapon-name' });
    this.root.append(this.hotbar, this.weaponName);

    // Compass
    this.compassStrip = el('div', { id: 'compass-strip' });
    this.root.append(el('div', { id: 'compass' }, [this.compassStrip]));
    this.buildCompass();

    // Clock
    this.clockIcon = el('span', { class: 'icon' });
    this.clockText = el('span');
    this.killsText = el('span', { class: 'kills' });
    this.root.append(el('div', { id: 'clock', class: 'panel' }, [this.clockIcon, this.clockText, this.killsText]));

    this.notifications = el('div', { id: 'notifications' });
    this.floatLayer = el('div', { id: 'float-layer' });
    this.root.append(this.notifications, this.floatLayer);

    this.floaters = [];
    this.nameTimer = 0;
    this.lastHp = 100;
    game.events.on('inventory:changed', () => this.renderHotbar());
    game.events.on('item:added', ({ id, count }) => {
      const it = getItem(id);
      this.notify(`+${count} ${it.name}`, id);
    });
    game.events.on('inventory:full', () => this.notify('Инвентарь полон!'));
    game.events.on('player:damaged', () => {
      this.vignette.style.opacity = '1';
      setTimeout(() => (this.vignette.style.opacity = '0'), 160);
    });
    game.events.on('player:healed', () => {
      this.healV.style.opacity = '1';
      setTimeout(() => (this.healV.style.opacity = '0'), 500);
    });
    game.events.on('creature:hit', () => {
      this.crosshair.classList.remove('hit');
      void this.crosshair.offsetWidth;
      this.crosshair.classList.add('hit');
    });
    game.events.on('weapon:equipped', ({ id }) => this.showWeaponName(id));
    this.renderHotbar();
  }

  buildCompass() {
    // 3 revolutions so it can scroll seamlessly
    const px = 2.2; // pixels per degree
    this.compassPx = px;
    const labels = { 0: 'С', 45: 'СВ', 90: 'В', 135: 'ЮВ', 180: 'Ю', 225: 'ЮЗ', 270: 'З', 315: 'СЗ' };
    for (let rev = -1; rev <= 1; rev++) {
      for (let d = 0; d < 360; d += 15) {
        const x = (rev * 360 + d) * px;
        const txt = labels[d] || '·';
        const cls = labels[d] ? (d % 90 === 0 ? 'major' : '') : 'tick';
        this.compassStrip.appendChild(el('span', { class: cls, text: txt, style: `left:${x}px` }));
      }
    }
    // points of interest markers
    this.poiEls = [];
    const pois = [
      { name: '⌂', x: WORLD.village.x, z: WORLD.village.z },
      { name: '≈', x: WORLD.lake.x, z: WORLD.lake.z },
      { name: 'ᚱ', x: 72, z: 48 },
    ];
    for (const p of pois) {
      const e = el('span', { class: 'poi', text: p.name });
      this.compassStrip.appendChild(e);
      this.poiEls.push({ e, ...p });
    }
  }

  renderHotbar() {
    const inv = this.game.inventory;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = this.hotbarSlots[i];
      const item = inv.slots[i];
      s.classList.toggle('selected', i === inv.selected);
      s.querySelectorAll('img,.count').forEach((n) => n.remove());
      if (item) {
        s.appendChild(el('img', { src: getItemIcon(item.id) }));
        if (item.count > 1) s.appendChild(el('span', { class: 'count', text: String(item.count) }));
      }
    }
  }

  showWeaponName(id) {
    const it = id ? getItem(id) : null;
    this.weaponName.textContent = it ? it.name : 'Пустые руки';
    this.weaponName.style.opacity = '1';
    clearTimeout(this._wnT);
    this._wnT = setTimeout(() => (this.weaponName.style.opacity = '0'), 1800);
    this.tkHint.classList.toggle('hidden', id !== 'staff');
  }

  notify(text, iconId = null) {
    const n = el('div', { class: 'notification' }, [iconId ? el('img', { src: getItemIcon(iconId) }) : null, el('span', { text })]);
    this.notifications.appendChild(n);
    while (this.notifications.children.length > 6) this.notifications.firstChild.remove();
    setTimeout(() => n.classList.add('fade'), 2600);
    setTimeout(() => n.remove(), 3200);
  }

  /** Speech bubble above a creature, anchored to its head in screen space. */
  floatingText(target, text, duration = 2.6) {
    const e = el('div', { class: 'floating speech', text });
    this.floatLayer.appendChild(e);
    this.floaters.push({ e, target, offset: (target.height || 1.8) + 0.6, time: duration });
  }

  damageNumber(pos, amount) {
    const e = el('div', { class: `floating dmg-number${amount >= 40 ? ' big' : ''}`, text: String(Math.round(amount)) });
    this.floatLayer.appendChild(e);
    this.floaters.push({ e, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), time: 0.9 });
  }

  flashStamina() {
    this.stBar.classList.remove('flash');
    void this.stBar.offsetWidth;
    this.stBar.classList.add('flash');
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    // Vitals
    const hpR = p.health.ratio;
    this.hpFill.style.width = `${hpR * 100}%`;
    this.hpLag.style.width = `${hpR * 100}%`;
    this.hpText.textContent = `${Math.ceil(p.health.current)} / ${p.health.max}`;
    this.hpBar.classList.toggle('regen', p.health.bonusTime > 0 || (p.health.sinceDamage > p.health.regenDelay && hpR < 1));
    this.stFill.style.width = `${(p.stamina / p.maxStamina) * 100}%`;
    this.stBar.classList.toggle('exhausted', p.exhausted);
    this.lowHp.style.opacity = hpR < 0.3 && p.health.alive ? String(1 - hpR / 0.3) : '0';
    this.waterTint.style.opacity = p.swimming ? '1' : '0';

    // Crosshair + prompt
    const tk = game.telekinesis;
    const staff = game.weapons.def.id === 'staff';
    this.crosshair.classList.toggle('tk', staff && !!tk.hovered && !tk.held);
    this.crosshair.classList.toggle('tk-hold', !!tk.held);
    const prompt = game.dialog.active ? null : game.interaction.prompt;
    this.crosshair.classList.toggle('interact', !!prompt && !tk.held);
    if (prompt && !tk.held && p.health.alive) {
      this.prompt.innerHTML = `<kbd>E</kbd> — ${prompt}`;
      this.prompt.classList.remove('hidden');
    } else if (staff && tk.hovered && !tk.held) {
      this.prompt.innerHTML = `<kbd>ЛКМ</kbd> — Телекинез: ${tk.hovered.name || 'предмет'}`;
      this.prompt.classList.remove('hidden');
    } else {
      this.prompt.classList.add('hidden');
    }

    // Compass
    const yawDeg = ((-game.cameraRig.yaw * 180) / Math.PI) % 360;
    const heading = (yawDeg + 360) % 360; // camera forward at yaw 0 is -Z = north, clockwise positive
    const center = 210;
    this.compassStrip.style.transform = `translateX(${center - heading * this.compassPx}px)`;
    for (const poi of this.poiEls) {
      const dx = poi.x - p.position.x, dz = poi.z - p.position.z;
      let bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      bearing = (bearing + 360) % 360;
      let rel = bearing - heading;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      poi.e.style.left = `${(heading + rel) * this.compassPx}px`;
      poi.e.style.opacity = Math.hypot(dx, dz) < 8 ? '0' : '1';
    }

    // Clock
    const dn = game.dayNight;
    this.clockIcon.textContent = dn.isNight ? '☾' : dn.hour < 7.5 || dn.hour > 18 ? '◐' : '☀';
    this.clockIcon.style.color = dn.isNight ? '#b0c4ff' : '#ffd070';
    this.clockText.textContent = dn.clockString;
    this.killsText.textContent = `⚔ ${p.stats.kills}`;

    // Floating texts
    const cam = game.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.time -= dt;
      if (f.time <= 0 || (f.target && f.target.removed)) {
        f.e.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      if (f.target) v.copy(f.target.position).setY(f.target.position.y + f.offset);
      else v.copy(f.pos);
      const dist = v.distanceTo(cam.position);
      v.project(cam);
      const visible = v.z < 1 && dist < 30;
      f.e.style.display = visible ? '' : 'none';
      if (visible) {
        f.e.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
        f.e.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
        if (f.target) f.e.style.opacity = String(Math.min(1, f.time * 2));
      }
    }
  }
}
