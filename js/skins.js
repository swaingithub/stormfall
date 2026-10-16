import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clamp } from './utils.js';
import { buildViewModel } from './weapons.js';

/**
 * Real skinned character support.
 *
 * `Skins.load()` fetches an animated glTF soldier (free, CORS-hosted) once and
 * keeps the template. `SkinnedCharacter` is a drop-in replacement for
 * `CharacterRig` (same public members: root / update / muzzle / setWeapon /
 * dispose) that drives real skeletal animations (idle/walk/run) instead of
 * procedural limbs. If the model can't load the game keeps using CharacterRig.
 *
 * The model faces -Z in bind pose, so it is rotated 180° to face +Z to match
 * the project's convention (root faces +Z at rotation.y = 0).
 */

const DEFAULT_URLS = [
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/Soldier.glb',
];

const _v = new THREE.Vector3();
const _vS = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vE = new THREE.Vector3();
const _vT = new THREE.Vector3();
const _vU = new THREE.Vector3();
const _vF = new THREE.Vector3();
const _vP = new THREE.Vector3();
const _vE2 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _tmpAxis = new THREE.Vector3();
const _tmpW0 = new THREE.Vector3();

/** Rotate `bone` so the direction to its direct `child` points along `worldDir`. */
function pointBone(bone, child, worldDir, a) {
  _tmpAxis.copy(child.position).normalize();
  bone.getWorldQuaternion(_q0);
  _tmpW0.copy(_tmpAxis).applyQuaternion(_q0).normalize();
  _q1.setFromUnitVectors(_tmpW0, worldDir);
  _q2.copy(_q0).premultiply(_q1);          // desired world quaternion
  bone.parent.getWorldQuaternion(_q3);
  _q4.copy(_q3).invert().multiply(_q2);    // desired local quaternion
  bone.quaternion.slerp(_q4, a);
}

export class Skins {
  static async load(urls = DEFAULT_URLS) {
    const loader = new GLTFLoader();
    for (const url of urls) {
      try {
        const gltf = await loader.loadAsync(url);
        const scene = gltf.scene;
        scene.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; }
        });
        const hasClips = (gltf.animations || []).length > 0;
        if (!hasClips) continue;
        console.info('[skins] loaded', url, 'clips:', gltf.animations.map((c) => c.name).join(','));
        return { template: scene, animations: gltf.animations, url };
      } catch (err) {
        console.warn('[skins] failed', url, err && err.message);
      }
    }
    return null;
  }
}

export class SkinnedCharacter {
  constructor(skin, weaponDef = null) {
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(skin.template);
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
        // per-instance material so disposal/tinting is safe
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      }
    });
    // face +Z
    this.inner = new THREE.Group();
    this.inner.rotation.y = Math.PI;
    this.inner.add(this.model);
    this.root.add(this.inner);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of skin.animations) {
      const n = clip.name.toLowerCase();
      const a = this.mixer.clipAction(clip);
      a.loop = THREE.LoopRepeat;
      if (n.includes('idle')) this.actions.idle = a;
      else if (n.includes('run')) this.actions.run = a;
      else if (n.includes('walk')) this.actions.walk = a;
    }
    this.cur = null;
    this.speedSmooth = 0;

    // The weapon is parented to `root` and, when the rig exposes a right-hand
    // bone, is moved to that hand's position each frame while staying aimed
    // forward. (Mixamo bone chains here are scaled ~0.01, so parenting the gun
    // to the bone directly would make it microscopic — following the hand via
    // world position keeps the gun life-sized.) Falls back to a fixed
    // hip-height mount if the model has no hand bone.
    this.handBone = null;
    this.model.traverse((o) => {
      if (!this.handBone && o.isBone && /right_?hand$/i.test(o.name)) this.handBone = o;
    });
    // arm/torso bones used for the aiming pose
    this.bones = {};
    this.model.traverse((o) => {
      if (!o.isBone) return;
      const n = o.name.toLowerCase();
      if (/rightarm$/.test(n)) this.bones.rArm = o;
      else if (/rightforearm$/.test(n)) this.bones.rFore = o;
      else if (/rightshoulder$/.test(n)) this.bones.rShoulder = o;
      else if (/right_?hand$/.test(n)) this.bones.rHand = o;
      else if (/leftarm$/.test(n)) this.bones.lArm = o;
      else if (/leftforearm$/.test(n)) this.bones.lFore = o;
      else if (/leftshoulder$/.test(n)) this.bones.lShoulder = o;
      else if (/left_?hand$/.test(n)) this.bones.lHand = o;
      else if (/spine2$/.test(n)) this.bones.spine2 = o;
      else if (/spine1$/.test(n)) this.bones.spine1 = o;
      else if (/neck$/.test(n)) this.bones.neck = o;
      else if (/head$/.test(n)) this.bones.head = o;
    });
    this.aimSmooth = 0;
    this.weaponMount = new THREE.Group();
    this.weaponMount.scale.setScalar(0.9);
    this.root.add(this.weaponMount);
    this._handAlign = !!this.handBone;
    if (!this.handBone) this.weaponMount.position.set(-0.28, 1.05, 0.18);
    if (weaponDef) this.setWeapon(weaponDef);
  }

  setWeapon(weaponDef) {
    if (this.gun) {
      this.weaponMount.remove(this.gun);
      this.gun.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      this.gun = null;
    }
    if (this.flash) { this.weaponMount.remove(this.flash); this.flash = null; }
    if (!weaponDef) return;
    const gun = buildViewModel(weaponDef);
    gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.weaponMount.add(gun);
    this.gun = gun;
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 })
    );
    flash.position.set(0, 0.01, (weaponDef.box.body[2] / 2) + (weaponDef.box.bar || 0.3));
    this.weaponMount.add(flash);
    this.flash = flash;
  }

  muzzle() { if (this.flash) this.flash.material.opacity = 1; }

  update(dt, s = {}) {
    const alive = s.alive !== false;
    const speed = alive ? (s.speed || 0) : 0;
    this.speedSmooth += (speed - this.speedSmooth) * Math.min(1, dt * 8);
    let want = 'idle';
    if (alive) {
      if (this.speedSmooth > 4.4) want = 'run';
      else if (this.speedSmooth > 0.5) want = 'walk';
    }
    const next = this.actions[want] || this.actions.idle;
    if (next && next !== this.cur) {
      if (this.cur) this.cur.fadeOut(0.25);
      next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
      this.cur = next;
    }
    if (this.cur) {
      if (want === 'run') this.cur.timeScale = clamp(0.75 + this.speedSmooth / 8, 0.8, 1.6);
      else if (want === 'walk') this.cur.timeScale = clamp(0.7 + this.speedSmooth / 5, 0.7, 1.5);
      else this.cur.timeScale = 1;
    }
    this.mixer.update(dt);
    // raise the arms into a shouldered aiming pose while engaged
    this._aim(s, dt);
    // keep the held weapon in the right hand and pointing where the character
    // faces (pitching with the aim), independent of the animation pose
    if (this._handAlign && this.handBone) {
      this.handBone.getWorldPosition(_v);   // also refreshes this.root.matrixWorld
      this.root.worldToLocal(_v);
      this.weaponMount.position.copy(_v);
      this.weaponMount.position.z += 0.12;
      this.weaponMount.quaternion.identity();
      this.weaponMount.rotateX(-(s.aimPitch || 0));
    }
    if (this.flash && this.flash.material.opacity > 0) {
      this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 16);
    }
  }

  /** Blend the arms from the animation into a shouldered aiming pose (2-bone IK). */
  _aim(s, dt) {
    const b = this.bones;
    if (!b || !b.rArm || !b.rFore || !b.rHand) return;
    const want = s.alive !== false && !!s.aiming;
    this.aimSmooth += ((want ? 1 : 0) - this.aimSmooth) * Math.min(1, dt * 6);
    const a = this.aimSmooth;
    if (a < 0.02) return;

    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(_q0);

    const pitch = s.aimPitch || 0;
    const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
    const pivot = _vU.set(0, 1.40, 0);
    const gripTarget = _vT.set(-0.10, -0.02, 0.42);
    gripTarget.set(gripTarget.x, gripTarget.y * cp - gripTarget.z * sp, gripTarget.y * sp + gripTarget.z * cp).add(pivot);
    this.root.localToWorld(gripTarget);
    const supportTarget = _vF.set(0.07, -0.05, 0.68);
    supportTarget.set(supportTarget.x, supportTarget.y * cp - supportTarget.z * sp, supportTarget.y * sp + supportTarget.z * cp).add(pivot);
    this.root.localToWorld(supportTarget);

    // elbow poles (world): out to the sides, down, slightly back
    const rPole = _vP.set(-0.45, -1, -0.2).applyQuaternion(_q0).normalize().clone();
    const lPole = _vE2.set(0.45, -1, -0.2).applyQuaternion(_q0).normalize().clone();

    this._aimArm(b.rArm, b.rFore, b.rHand, gripTarget, rPole, a);
    if (b.lArm && b.lFore && b.lHand) this._aimArm(b.lArm, b.lFore, b.lHand, supportTarget, lPole, a);
  }

  _aimArm(upper, lower, hand, target, pole, a) {
    upper.getWorldPosition(_vS);
    lower.getWorldPosition(_vB);
    hand.getWorldPosition(_vE);
    const L1 = _vS.distanceTo(_vB);
    const L2 = _vB.distanceTo(_vE);
    if (L1 < 1e-4 || L2 < 1e-4) return;
    _vU.copy(target).sub(_vS);
    let d = _vU.length();
    if (d < 1e-4) return;
    d = clamp(d, Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.9995);
    _vU.normalize();
    _vP.copy(pole).addScaledVector(_vU, -pole.dot(_vU));
    if (_vP.lengthSq() < 1e-6) _vP.set(_vU.z, 0, -_vU.x);
    _vP.normalize();
    const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const ang = Math.acos(clamp(cosA, -1, 1));
    _vF.copy(_vU).multiplyScalar(Math.cos(ang)).addScaledVector(_vP, Math.sin(ang)).normalize();
    _vE2.copy(_vS).addScaledVector(_vF, L1);
    _vB.copy(target).sub(_vE2).normalize();
    pointBone(upper, lower, _vF, a);
    pointBone(lower, hand, _vB, a);
  }

  dispose() {
    if (this.gun) this.gun.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m && m.dispose && m.dispose());
      }
    });
    if (this.mixer) this.mixer.stopAllAction();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
