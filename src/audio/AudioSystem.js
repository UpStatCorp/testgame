import * as THREE from 'three';

/**
 * Procedural WebAudio sound engine.
 * Every sound is a small synth "recipe" registered by name, so real samples can replace them later:
 *   audio.loadSample('swing', 'sounds/swing.ogg')  -> play('swing') uses the file instead.
 * Positional sounds use distance attenuation + stereo panning relative to the camera.
 */
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.samples = new Map();
    this.recipes = new Map();
    this.listenerPos = new THREE.Vector3();
    this.listenerRight = new THREE.Vector3(1, 0, 0);
    this.ambient = null;
    this.registerDefaults();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    this.master.connect(comp).connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(2);
    this.startAmbient();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  async loadSample(name, url) {
    if (!this.ctx) return;
    const res = await fetch(url);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    this.samples.set(name, buf);
  }

  register(name, recipe) {
    this.recipes.set(name, recipe);
  }

  updateListener(camera) {
    this.listenerPos.copy(camera.position);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  /** Creates the output chain (gain + pan) for a sound, respecting position. */
  output(opts = {}) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    let vol = opts.volume ?? 1;
    let pan = 0;
    if (opts.position) {
      const d = this.listenerPos.distanceTo(opts.position);
      const maxD = opts.maxDistance ?? 40;
      if (d > maxD) return null;
      vol *= Math.max(0, 1 - d / maxD) ** 1.5;
      const dir = new THREE.Vector3().subVectors(opts.position, this.listenerPos);
      if (d > 0.5) pan = THREE.MathUtils.clamp(dir.normalize().dot(this.listenerRight), -1, 1) * 0.8;
    }
    gain.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p).connect(this.master);
    } else gain.connect(this.master);
    return gain;
  }

  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const out = this.output(opts);
    if (!out) return;
    const sample = this.samples.get(name);
    if (sample) {
      const src = this.ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = opts.pitch ?? 1;
      src.connect(out);
      src.start();
      return;
    }
    const recipe = this.recipes.get(name);
    if (recipe) recipe(this.ctx, out, this.ctx.currentTime, opts);
  }

  // ---------- synthesis building blocks ----------
  noise(out, t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.005, freqEnd, rate = 1 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(out, t, dur, { type = 'sine', freq = 440, freqEnd, gain = 0.5, attack = 0.005, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  registerDefaults() {
    const A = this;
    const r = (n, f) => this.register(n, f);
    r('footstep', (ctx, out, t, o) => {
      const surf = o.surface || 'grass';
      if (surf === 'wood') {
        A.tone(out, t, 0.09, { type: 'triangle', freq: 140 + Math.random() * 30, freqEnd: 90, gain: 0.35 });
        A.noise(out, t, 0.06, { freq: 900, q: 2, gain: 0.25 });
      } else if (surf === 'water') {
        A.noise(out, t, 0.25, { freq: 700 + Math.random() * 400, freqEnd: 300, q: 1.2, gain: 0.35, attack: 0.02 });
      } else if (surf === 'stone') {
        A.noise(out, t, 0.07, { freq: 2200, q: 1.5, gain: 0.3 });
      } else {
        A.noise(out, t, 0.12, { type: 'bandpass', freq: 1400 + Math.random() * 800, freqEnd: 600, q: 0.8, gain: 0.28, attack: 0.01 });
        A.noise(out, t + 0.02, 0.08, { type: 'highpass', freq: 3500, q: 0.5, gain: 0.08 });
      }
    });
    r('jump', (ctx, out, t) => A.noise(out, t, 0.15, { freq: 900, freqEnd: 400, q: 1, gain: 0.2 }));
    r('land', (ctx, out, t, o) => {
      A.tone(out, t, 0.15, { freq: 90, freqEnd: 50, gain: 0.4 * (o.volume ?? 1) });
      A.noise(out, t, 0.15, { freq: 700, freqEnd: 300, q: 0.8, gain: 0.3 });
    });
    r('swing', (ctx, out, t, o) => {
      const heavy = o.heavy;
      A.noise(out, t, heavy ? 0.45 : 0.22, { type: 'bandpass', freq: heavy ? 500 : 1200, freqEnd: heavy ? 180 : 3200, q: heavy ? 1.5 : 2.5, gain: heavy ? 0.7 : 0.45, attack: heavy ? 0.12 : 0.05 });
    });
    r('hit', (ctx, out, t, o) => {
      const heavy = o.heavy;
      A.tone(out, t, heavy ? 0.35 : 0.18, { type: 'sine', freq: heavy ? 110 : 180, freqEnd: 40, gain: heavy ? 0.9 : 0.6 });
      A.noise(out, t, heavy ? 0.3 : 0.15, { type: 'lowpass', freq: heavy ? 1500 : 2500, q: 0.7, gain: heavy ? 0.8 : 0.5 });
      if (o.metal !== false) {
        A.tone(out, t, 0.4, { type: 'triangle', freq: heavy ? 820 : 1250, gain: 0.08 });
        A.tone(out, t, 0.3, { type: 'sine', freq: heavy ? 1960 : 2710, gain: 0.05 });
      }
    });
    r('hitWood', (ctx, out, t) => {
      A.tone(out, t, 0.12, { type: 'triangle', freq: 220, freqEnd: 110, gain: 0.5 });
      A.noise(out, t, 0.1, { freq: 1100, q: 3, gain: 0.4 });
    });
    r('hitStone', (ctx, out, t) => {
      A.noise(out, t, 0.12, { freq: 2600, q: 2, gain: 0.45 });
      A.tone(out, t, 0.08, { type: 'square', freq: 320, freqEnd: 120, gain: 0.08 });
    });
    r('impact', (ctx, out, t, o) => {
      const g = Math.min(1, (o.strength ?? 5) / 12);
      A.tone(out, t, 0.2, { freq: 120 * (o.pitch ?? 1), freqEnd: 50, gain: 0.6 * g });
      A.noise(out, t, 0.12, { type: 'lowpass', freq: 1200, q: 0.8, gain: 0.5 * g });
    });
    r('splash', (ctx, out, t) => {
      A.noise(out, t, 0.6, { freq: 1500, freqEnd: 300, q: 0.6, gain: 0.5, attack: 0.01 });
    });
    r('magic', (ctx, out, t) => {
      [660, 880, 1320].forEach((f, i) => A.tone(out, t + i * 0.04, 0.5, { type: 'sine', freq: f, freqEnd: f * 1.5, gain: 0.12 }));
      A.noise(out, t, 0.4, { type: 'highpass', freq: 5000, q: 0.5, gain: 0.08 });
    });
    r('grab', (ctx, out, t) => {
      A.tone(out, t, 0.35, { type: 'sine', freq: 300, freqEnd: 900, gain: 0.2 });
      A.tone(out, t, 0.35, { type: 'triangle', freq: 450, freqEnd: 1350, gain: 0.08, detune: 12 });
    });
    r('throw', (ctx, out, t) => {
      A.tone(out, t, 0.3, { type: 'sine', freq: 900, freqEnd: 200, gain: 0.2 });
      A.noise(out, t, 0.35, { freq: 800, freqEnd: 3000, q: 2, gain: 0.35, attack: 0.03 });
    });
    r('pickup', (ctx, out, t) => {
      [880, 1175, 1568].forEach((f, i) => A.tone(out, t + i * 0.06, 0.25, { type: 'triangle', freq: f, gain: 0.12 }));
    });
    r('coin', (ctx, out, t) => {
      A.tone(out, t, 0.2, { type: 'square', freq: 1976, gain: 0.05 });
      A.tone(out, t + 0.07, 0.35, { type: 'square', freq: 2637, gain: 0.05 });
    });
    r('uiClick', (ctx, out, t) => A.tone(out, t, 0.06, { type: 'triangle', freq: 900, freqEnd: 600, gain: 0.15 }));
    r('uiOpen', (ctx, out, t) => {
      A.noise(out, t, 0.18, { freq: 600, freqEnd: 1600, q: 1.5, gain: 0.25, attack: 0.03 });
      A.tone(out, t, 0.12, { type: 'triangle', freq: 400, freqEnd: 600, gain: 0.1 });
    });
    r('uiClose', (ctx, out, t) => {
      A.noise(out, t, 0.16, { freq: 1500, freqEnd: 500, q: 1.5, gain: 0.22, attack: 0.02 });
    });
    r('equip', (ctx, out, t) => {
      A.noise(out, t, 0.25, { type: 'highpass', freq: 3000, q: 0.5, gain: 0.2, attack: 0.05 });
      A.tone(out, t + 0.05, 0.3, { type: 'triangle', freq: 1400, gain: 0.05 });
    });
    r('doorOpen', (ctx, out, t) => {
      A.tone(out, t, 0.6, { type: 'sawtooth', freq: 180, freqEnd: 260, gain: 0.06, attack: 0.05 });
      A.tone(out, t + 0.2, 0.4, { type: 'sawtooth', freq: 240, freqEnd: 150, gain: 0.05 });
      A.noise(out, t, 0.4, { freq: 400, q: 3, gain: 0.1 });
    });
    r('doorClose', (ctx, out, t) => {
      A.tone(out, t + 0.1, 0.25, { freq: 100, freqEnd: 50, gain: 0.6 });
      A.noise(out, t + 0.1, 0.2, { type: 'lowpass', freq: 900, gain: 0.5 });
    });
    r('chestOpen', (ctx, out, t) => {
      A.tone(out, t, 0.5, { type: 'sawtooth', freq: 140, freqEnd: 220, gain: 0.05 });
      A.noise(out, t, 0.3, { freq: 500, q: 2, gain: 0.15 });
      [1047, 1319, 1568, 2093].forEach((f, i) => A.tone(out, t + 0.25 + i * 0.07, 0.4, { type: 'sine', freq: f, gain: 0.07 }));
    });
    r('chestClose', (ctx, out, t) => {
      A.tone(out, t, 0.2, { freq: 120, freqEnd: 60, gain: 0.4 });
      A.noise(out, t, 0.15, { type: 'lowpass', freq: 1000, gain: 0.3 });
    });
    r('crackle', (ctx, out, t) => {
      A.noise(out, t, 0.03 + Math.random() * 0.03, { type: 'highpass', freq: 1500 + Math.random() * 3000, q: 1, gain: 0.25 + Math.random() * 0.3, attack: 0.002 });
    });
    r('ignite', (ctx, out, t) => {
      A.noise(out, t, 0.8, { type: 'lowpass', freq: 400, freqEnd: 2000, q: 0.8, gain: 0.5, attack: 0.1 });
    });
    r('extinguish', (ctx, out, t) => {
      A.noise(out, t, 0.9, { type: 'highpass', freq: 2500, freqEnd: 5000, q: 0.5, gain: 0.25, attack: 0.02 });
    });
    r('drink', (ctx, out, t) => {
      for (let i = 0; i < 4; i++) A.tone(out, t + i * 0.13, 0.1, { freq: 300 + i * 40, freqEnd: 180, gain: 0.25 });
    });
    r('eat', (ctx, out, t) => {
      for (let i = 0; i < 3; i++) A.noise(out, t + i * 0.16, 0.09, { freq: 1800, q: 1, gain: 0.3 });
    });
    r('heal', (ctx, out, t) => {
      [523, 659, 784, 1047].forEach((f, i) => A.tone(out, t + i * 0.08, 0.6, { freq: f, gain: 0.08 }));
    });
    r('hurt', (ctx, out, t) => {
      A.tone(out, t, 0.25, { type: 'sawtooth', freq: 220, freqEnd: 110, gain: 0.15 });
      A.noise(out, t, 0.2, { type: 'lowpass', freq: 800, gain: 0.5 });
    });
    r('death', (ctx, out, t) => {
      A.tone(out, t, 1.8, { type: 'sawtooth', freq: 180, freqEnd: 40, gain: 0.2, attack: 0.05 });
      A.tone(out, t, 1.8, { type: 'sine', freq: 90, freqEnd: 30, gain: 0.4 });
    });
    r('growl', (ctx, out, t, o) => {
      const p = o.pitch ?? 1;
      A.tone(out, t, 0.7, { type: 'sawtooth', freq: 70 * p, freqEnd: 55 * p, gain: 0.25, attack: 0.08 });
      A.noise(out, t, 0.7, { type: 'lowpass', freq: 500 * p, q: 4, gain: 0.35, attack: 0.1 });
    });
    r('creatureAttack', (ctx, out, t) => {
      A.tone(out, t, 0.35, { type: 'sawtooth', freq: 120, freqEnd: 260, gain: 0.2 });
      A.noise(out, t, 0.25, { freq: 900, freqEnd: 400, q: 2, gain: 0.3 });
    });
    r('creatureHurt', (ctx, out, t) => {
      A.tone(out, t, 0.3, { type: 'square', freq: 300, freqEnd: 140, gain: 0.08 });
      A.noise(out, t, 0.2, { freq: 1200, q: 3, gain: 0.3 });
    });
    r('creatureDie', (ctx, out, t) => {
      A.tone(out, t, 1.2, { type: 'sawtooth', freq: 160, freqEnd: 35, gain: 0.25 });
      A.noise(out, t, 1.0, { type: 'lowpass', freq: 700, freqEnd: 150, q: 3, gain: 0.35 });
    });
    r('villagerHi', (ctx, out, t, o) => {
      const p = o.pitch ?? 1;
      A.tone(out, t, 0.12, { type: 'triangle', freq: 260 * p, freqEnd: 330 * p, gain: 0.12 });
      A.tone(out, t + 0.13, 0.16, { type: 'triangle', freq: 300 * p, freqEnd: 240 * p, gain: 0.12 });
    });
    r('bird', (ctx, out, t, o) => {
      const base = 2200 + Math.random() * 1800;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) A.tone(out, t + i * 0.11, 0.08, { freq: base * (1 + (Math.random() - 0.5) * 0.3), freqEnd: base * 1.4, gain: 0.05 * (o.volume ?? 1) });
    });
    r('cricket', (ctx, out, t) => {
      for (let i = 0; i < 3; i++) A.tone(out, t + i * 0.05, 0.03, { type: 'square', freq: 4200, gain: 0.02 });
    });
    r('spawn', (ctx, out, t) => {
      A.tone(out, t, 0.5, { freq: 200, freqEnd: 800, gain: 0.15 });
      A.noise(out, t, 0.4, { freq: 3000, q: 0.5, gain: 0.1 });
    });
  }

  // ---------- loops ----------
  startAmbient() {
    const ctx = this.ctx;
    // Wind: filtered noise with slow LFO on filter + gain
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.07;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(f.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.05;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.035;
    lfo2.connect(lfo2Gain).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    lfo.start();
    lfo2.start();
    this.ambient = { windGain: g, birdTimer: 2, cricketTimer: 1 };
  }

  updateAmbient(dt, daylight, cameraPos) {
    if (!this.ctx || !this.ambient || this.ctx.state !== 'running') return;
    const a = this.ambient;
    a.birdTimer -= dt;
    if (a.birdTimer <= 0) {
      a.birdTimer = 1.5 + Math.random() * 5;
      if (daylight > 0.4) {
        const pos = cameraPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, 8, (Math.random() - 0.5) * 40));
        this.play('bird', { position: pos, maxDistance: 60, volume: 0.9 });
      }
    }
    a.cricketTimer -= dt;
    if (a.cricketTimer <= 0) {
      a.cricketTimer = 0.4 + Math.random() * 1.2;
      if (daylight < 0.4) {
        const pos = cameraPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
        this.play('cricket', { position: pos, maxDistance: 40 });
      }
    }
  }

  /** Continuous telekinesis hum; returns a handle with setIntensity() and stop(). */
  startLoop(name) {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(0.12, ctx.currentTime, 0.1);
    out.connect(this.master);
    const oscs = [];
    if (name === 'tkHum') {
      for (const [f, type] of [[110, 'sawtooth'], [165, 'sine'], [220.5, 'triangle']]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        o.connect(lp).connect(out);
        o.start();
        oscs.push(o);
      }
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const lg = ctx.createGain();
      lg.gain.value = 8;
      lfo.connect(lg);
      for (const o of oscs) lg.connect(o.frequency);
      lfo.start();
      oscs.push(lfo);
    }
    return {
      setIntensity: (v) => {
        for (let i = 0; i < 3 && i < oscs.length; i++) oscs[i].frequency.setTargetAtTime([110, 165, 220.5][i] * (1 + v * 0.5), ctx.currentTime, 0.1);
      },
      stop: () => {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        setTimeout(() => {
          for (const o of oscs) o.stop();
          out.disconnect();
        }, 400);
      },
    };
  }
}
