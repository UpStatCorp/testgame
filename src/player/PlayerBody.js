import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TwoBoneIK } from './ArmIK.js';

// Temporary full-body model for first-person view (three.js example "Soldier", Mixamo rig).
const MODEL_URL = `${import.meta.env.BASE_URL}models/Soldier.glb`;
const HIDDEN_BONES = ['mixamorig:Head', 'mixamorig:LeftShoulder', 'mixamorig:RightShoulder', 'mixamorig:LeftArm', 'mixamorig:RightArm'];
const HIDDEN_BONE_KEYS = new Set(HIDDEN_BONES.map((n) => n.replace(':', '')));
// Shown (and driven by IK) only while the one-handed sword is equipped
const RIGHT_ARM_KEYS = new Set(['mixamorigRightShoulder', 'mixamorigRightArm']);
// ?oldarms: keep the procedural ViewModel arms for every weapon (comparison / rollback)
const OLD_ARMS = new URLSearchParams(location.search).has('oldarms');
const WALK_THRESHOLD = 0.4; // m/s
const RUN_THRESHOLD = 5.4; // m/s (walk is 4.6, sprint 7.8)
const BACK_OFFSET = 0.05; // body stands under the camera; the neck pivot in CameraRig moves the eyes forward when looking down

/**
 * Visual-only player body: follows the player's feet and camera yaw, blends Idle/Walk/Run by
 * horizontal speed. Head and arms are hidden (the ViewModel still draws hands and weapons).
 * Known limitation: no strafe/back clips, so the body always faces the camera yaw.
 */
export class PlayerBody {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.name = 'player-body';
    this.loaded = false;
    this.failed = false;
    this.actions = {};
    this.current = null;
    this.hiddenBones = [];
    this._fwd = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._targetQ = new THREE.Quaternion();
    this._pole = new THREE.Vector3();
    this.armIK = null;
    this.armActive = false;
    this.ikError = 0;
    game.scene.add(this.root);
  }

  load() {
    return new Promise((resolve) => {
      new GLTFLoader().load(
        MODEL_URL,
        (gltf) => {
          this.setup(gltf);
          resolve(true);
        },
        undefined,
        (err) => {
          console.error('PlayerBody: failed to load', MODEL_URL, err);
          this.failed = true;
          resolve(false);
        }
      );
    });
  }

  setup(gltf) {
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // skinned bounds don't follow the animation
      }
      // GLTFLoader sanitizes node names ('mixamorig:Head' -> 'mixamorigHead'), so compare without ':'
      if (o.isBone && HIDDEN_BONE_KEYS.has(o.name.replace(':', ''))) this.hiddenBones.push(o);
    });
    // Scale so the model is as tall as the player capsule
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y;
    const scale = this.game.player.height / height;
    model.scale.multiplyScalar(scale);
    model.position.y = -box.min.y * scale;
    this.root.add(model);
    this.model = model;

    const bone = (n) => model.getObjectByName(`mixamorig${n}`);
    if (bone('RightArm') && bone('RightForeArm') && bone('RightHand')) {
      this.armIK = new TwoBoneIK(bone('RightArm'), bone('RightForeArm'), bone('RightHand'));
    }

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.play('Idle', 0);
    if (this.hiddenBones.length !== HIDDEN_BONES.length) console.warn('PlayerBody: hidden bones found', this.hiddenBones.map((b) => b.name));
    this.loaded = true;
  }

  play(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next || this.current === name) return;
    const prev = this.actions[this.current];
    next.reset().setEffectiveWeight(1).play();
    if (prev) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }

  update(dt) {
    if (!this.loaded) return;
    const p = this.game.player;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const moving = speed > WALK_THRESHOLD && (p.onGround || p.inWater);
    this.play(!moving ? 'Idle' : speed > RUN_THRESHOLD ? 'Run' : 'Walk');
    // Match playback speed to ground speed so feet don't slide too much
    if (this.current === 'Walk') this.actions.Walk.timeScale = THREE.MathUtils.clamp(speed / 2.6, 0.6, 1.8);
    if (this.current === 'Run') this.actions.Run.timeScale = THREE.MathUtils.clamp(speed / 6.5, 0.8, 1.4);
    this.mixer.update(dt);
    const vm = this.game.weapons.viewModel;
    this.armActive = !OLD_ARMS && !!this.armIK && vm.currentId === 'sword';
    vm.rightArm.visible = vm.rightHand.visible = !this.armActive;
    for (const b of this.hiddenBones) {
      // after the mixer, in case clips key scale
      b.scale.setScalar(this.armActive && RIGHT_ARM_KEYS.has(b.name) ? 1 : 0);
    }

    const yaw = this.game.cameraRig.yaw;
    this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    // Crouch/swim lower the eye; sink the (standing) body by the same amount
    const sink = 1.65 - p.eyeHeight;
    this.root.position.set(p.position.x, p.position.y - sink, p.position.z).addScaledVector(this._fwd, -BACK_OFFSET);
    this.root.rotation.y = yaw; // Soldier faces -Z like the camera (verified: toes point along the view)
    this.root.visible = p.health.alive;
    if (this.armActive) this.solveRightArm(yaw);
  }

  /** Puts the right hand (wrist bone) on the sword grip point: the hidden ViewModel glove. */
  solveRightArm(yaw) {
    const hand = this.game.weapons.viewModel.rightHand;
    this.root.updateMatrixWorld(true);
    hand.updateWorldMatrix(true, false);
    hand.getWorldPosition(this._target);
    hand.getWorldQuaternion(this._targetQ);
    // elbow out (body right) and down
    this._pole.set(Math.cos(yaw), -1, -Math.sin(yaw));
    this.ikError = this.armIK.solve(this._target, this._pole, this._targetQ);
  }
}
