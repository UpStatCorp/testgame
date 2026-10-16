import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Particles } from '../effects/Particles.js';
import { World } from '../world/World.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { InteractionSystem } from '../interaction/InteractionSystem.js';
import { Props } from '../world/Props.js';
import { Pickups } from '../world/Pickups.js';
import { Inventory } from '../inventory/Inventory.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { PlayerController } from '../player/PlayerController.js';
import { Telekinesis } from '../telekinesis/Telekinesis.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { CombatSystem } from '../combat/CombatSystem.js';
import { SpawnSystem } from '../entities/SpawnSystem.js';
import { DialogSystem } from '../ui/DialogSystem.js';
import { UIManager } from '../ui/UIManager.js';
import { setItemEnvMap } from '../items/ItemModels.js';
import { HOTBAR_SIZE } from '../inventory/Inventory.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Composition root: creates every system, runs the main loop and owns global state. */
export class Game {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    const params = new URLSearchParams(location.search);
    this.quality = params.get('quality') || options.quality || 'high';
    // ?lite: minimal rendering load for automated tests on software renderers
    this.lite = params.has('lite');
    if (this.lite) this.quality = 'low';
    this.headless = params.has('autostart');
    this.state = 'loading';
    this.time = 0;
    this.hitStopTimer = 0;
    this.renderSettings = { bloom: this.quality !== 'low' };
    this.perf = { update: 0, render: 0, frame: 16 };
  }

  async init(onProgress = () => {}) {
    const step = async (p, text, fn) => {
      onProgress(p, text);
      await nextFrame();
      fn();
    };

    await step(0.05, 'Разжигаем свет…', () => this.initRenderer());
    await step(0.15, 'Поднимаем горы…', () => {
      this.world = new World(this);
      this.world.buildTerrain();
      this.physics = new PhysicsWorld(this.terrain);
      this.interaction = new InteractionSystem(this);
    });
    await step(0.3, 'Строим деревню…', () => this.world.buildVillage());
    await step(0.45, 'Выращиваем лес…', () => this.world.buildVegetation());
    await step(0.7, 'Зовём облака…', () => {
      this.world.buildAtmosphere();
      this.props = new Props(this);
      this.pickups = new Pickups(this);
    });
    await step(0.8, 'Собираем снаряжение…', () => {
      this.inventory = new Inventory(this.events);
      this.cameraRig = new CameraRig(this.camera);
      this.player = new Player(this);
      this.controller = new PlayerController(this, this.player);
      this.telekinesis = new Telekinesis(this);
      this.weapons = new WeaponSystem(this);
      this.combat = new CombatSystem(this);
      this.props.populate(this.village.exclusions);
    });
    await step(0.9, 'Пробуждаем жителей…', () => {
      this.entities = new SpawnSystem(this);
      this.dialog = new DialogSystem(this, document.getElementById('ui-root'));
      this.ui = new UIManager(this);
      this.entities.init();
      this.player.spawn();
      this.giveStartingItems();
      this.physics.onBodyImpact = (b, speed) => {
        if (speed > 5) this.audio.play(b.material === 'wood' ? 'hitWood' : 'impact', { position: b.position, strength: speed, volume: Math.min(1, speed / 14) });
        if (speed > 9) this.particles.dust(b.position.clone(), 6);
      };
      this.physics.onBodyWater = (b) => {
        this.particles.splash(b.position.clone(), Math.min(2, b.velocity.length() / 6));
        this.audio.play('splash', { position: b.position });
      };
    });
    await step(1, 'Готово', () => {
      // warm-up render to compile shaders before the player sees the world
      this.cameraRig.update(0.016, this.player);
      this.world.update(0.016, 0);
      this.renderer.compile(this.scene, this.camera);
    });
    this.state = 'menu';
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.tick(t));
    if (this.headless) this.start();
  }

  initRenderer() {
    const hi = this.quality !== 'low';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: hi, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.lite ? 0.5 : Math.min(window.devicePixelRatio, hi ? 1.5 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.lite;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1500);
    this.scene.add(this.camera);
    this.events = new EventBus();
    this.input = new Input(this.canvas);
    this.audio = new AudioSystem();
    this.particles = new Particles(this.scene);

    // Environment reflections for metal items (swords, coins)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    setItemEnvMap(env);
    this.envMap = env;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.5, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  giveStartingItems() {
    const inv = this.inventory;
    inv.slots[0] = { id: 'sword', count: 1 };
    inv.slots[1] = { id: 'greatsword', count: 1 };
    inv.slots[2] = { id: 'staff', count: 1 };
    inv.slots[3] = { id: 'potion', count: 3 };
    inv.slots[4] = { id: 'food', count: 4 };
    inv.slots[5] = { id: 'stone', count: 6 };
    inv.slots[8] = { id: 'coin', count: 12 };
    inv.slots[9] = { id: 'wood', count: 5 };
    inv.slots[10] = { id: 'apple', count: 3 };
    inv.selected = 0;
    inv.changed();
  }

  start() {
    if (this.state === 'playing') return;
    this.audio.init();
    this.state = 'playing';
    this.ui.hideStart();
    this.input.requestLock();
    this.ui.notify('Добро пожаловать в Мшистый Дол!');
    setTimeout(() => this.ui.notify('TAB — инвентарь · F1 — меню разработчика'), 1500);
  }

  hitStop(duration) {
    this.hitStopTimer = Math.max(this.hitStopTimer, duration);
  }

  tick(now) {
    const realDt = Math.max(0, Math.min(this.lite ? 0.25 : 0.1, (now - this.last) / 1000));
    this.last = now;
    let dt = realDt;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= realDt;
      dt = realDt * 0.08;
    }
    const modal = this.ui.modal;
    const simulate = this.state === 'playing' && modal !== 'pause';
    this.time += dt;

    const t0 = performance.now();
    if (simulate) {
      // fixed-size substeps keep physics stable on slow frames
      const steps = Math.max(1, Math.ceil(dt / 0.034));
      for (let i = 0; i < steps; i++) {
        this.updateGameplay(dt / steps, modal);
        this.input.clearEdges(); // one-shot key/mouse events are consumed by the first substep
      }
    }
    else if (this.state === 'menu') {
      // idle camera drift on the title screen
      this.cameraRig.yaw = 0.15 + Math.sin(this.time * 0.05) * 0.25;
      this.cameraRig.update(dt, this.player);
    }

    this.world.update(simulate || this.state === 'menu' ? dt : 0, this.time);
    this.particles.update(simulate || this.state === 'menu' ? dt : 0);
    this.audio.updateListener(this.camera);
    this.ui.update(realDt);

    const t1 = performance.now();
    this.bloom.enabled = this.renderSettings.bloom;
    this.renderer.info.reset();
    this.composer.render(realDt);
    const t2 = performance.now();
    // exponential moving averages for the debug overlay
    this.perf.update += (t1 - t0 - this.perf.update) * 0.1;
    this.perf.render += (t2 - t1 - this.perf.render) * 0.1;
    this.perf.frame += (now - (this.perf.lastNow || now) - this.perf.frame) * 0.1;
    this.perf.lastNow = now;
    this.input.endFrame();
  }

  updateGameplay(dt, modal) {
    const input = this.input;
    // Mouse look (only when captured and no window is open)
    if (input.locked && !modal) this.cameraRig.addLook(input.mouseDX, input.mouseDY);
    // Mouse wheel switches hotbar slot (unless adjusting telekinesis distance)
    if (!modal && input.wheel !== 0 && !this.telekinesis.held) {
      const inv = this.inventory;
      inv.select((inv.selected + Math.sign(input.wheel) + HOTBAR_SIZE) % HOTBAR_SIZE);
    }

    this.player.update(dt);
    this.controller.update(dt);
    this.cameraRig.update(dt, this.player);
    this.dialog.update(dt);
    this.weapons.update(dt);
    this.telekinesis.update(dt, this.time);
    this.physics.step(dt);
    this.combat.update(dt);
    this.entities.update(dt);
    this.pickups.update(dt, this.time);
    if (!modal && this.player.health.alive) this.interaction.update();
    else this.interaction.current = null;
    this.audio.updateAmbient(dt, this.dayNight.daylight, this.camera.position);
  }
}
