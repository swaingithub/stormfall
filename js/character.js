import * as THREE from 'three';
import { clamp, lerp, damp } from './utils.js';
import { buildViewModel } from './weapons.js';

/**
 * A realistic articulated humanoid character rig.
 *
 * Hierarchy (all lengths in meters, feet at y = 0, faces +Z):
 *   root
 *     body         (crouch / landing dip offset)
 *       pelvis
 *         spine     (torso lean)
 *           chest, vest, backpack
 *           neck -> head -> helmet + visor
 *           aimPivot (pitches with aim)
 *             shoulderL/R -> elbowL/R -> forearm -> hand
 *             weaponMount -> gun
 *         hipL/R -> kneeL/R -> shin -> foot
 *
 * The rig only stores pose parameters; `update(dt, state)` animates everything
 * procedurally so the same rig drives bots and the player.
 */

const PALETTES = [
  { shirt: 0x3d5a40, pants: 0x24282a, skin: 0xc98d63, helmet: 0x2e3b2a, boots: 0x1b1d1f, vest: 0x2a3327 },
  { shirt: 0x6b3d3d, pants: 0x2a2018, skin: 0xe0ac7e, helmet: 0x3a2626, boots: 0x1c1611, vest: 0x3a2626 },
  { shirt: 0x3d4a5a, pants: 0x1c2430, skin: 0xa9774f, helmet: 0x263241, boots: 0x141922, vest: 0x2a3542 },
  { shirt: 0x6b6b3d, pants: 0x27271c, skin: 0xd6a06b, helmet: 0x44442a, boots: 0x1d1d14, vest: 0x3d3d26 },
  { shirt: 0x4a3d5a, pants: 0x211b2a, skin: 0xbd8352, helmet: 0x332a40, boots: 0x171220, vest: 0x2c2438 },
  { shirt: 0x2f4f4f, pants: 0x182424, skin: 0xe6b98c, helmet: 0x233838, boots: 0x101b1b, vest: 0x1f3232 },
];

export class CharacterRig {
  constructor(paletteIndex = 0, weaponDef = null) {
    const pal = PALETTES[paletteIndex % PALETTES.length];
    const mat = (color, rough = 0.85, metal = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

    this.m = {
      shirt: mat(pal.shirt), pants: mat(pal.pants), skin: mat(pal.skin),
      helmet: mat(pal.helmet, 0.5, 0.15), boots: mat(pal.boots, 0.7, 0.1),
      vest: mat(pal.vest, 0.7, 0.15), pouch: mat(pal.vest, 0.85, 0),
      glove: mat(pal.boots, 0.65, 0.1),
    };
    this.allMats = Object.values(this.m);

    // animation state
    this.phase = Math.random() * Math.PI * 2;
    this.speedNorm = 0;
    this.crouch = 0;
    this.aimPitch = 0;
    this.bob = 0;
    this.dip = 0;
    this.recoil = 0;
    this.prevFiring = false;
    this.dead = false;

    this._build(weaponDef);
  }

  get root() { return this.top; }

  _limb(length, radius, material, taper = 1) {
    const g = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 5, 8);
    if (taper !== 1) g.scale(1 + (1 - taper) * 0.3, 1, taper);
    g.translate(0, -length / 2, 0); // origin at the top joint
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  _build(weaponDef) {
    const root = new THREE.Group();
    this.top = root;

    const body = new THREE.Group();
    root.add(body);
    this.body = body;

    // ---- pelvis + torso ----
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.92;
    body.add(pelvis);
    this.pelvis = pelvis;
    const pelvisMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.08, 4, 10), this.m.pants);
    pelvisMesh.scale.set(1.35, 1, 0.9);
    pelvisMesh.castShadow = true;
    pelvis.add(pelvisMesh);

    const spine = new THREE.Group();     // pivot at the waist
    spine.position.y = 0.06;
    pelvis.add(spine);
    this.spine = spine;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.28, 5, 12), this.m.shirt);
    torso.scale.set(1.5, 1, 0.95);
    torso.position.y = 0.2;
    torso.castShadow = true;
    spine.add(torso);
    this.torso = torso;

    const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.2, 5, 12), this.m.vest);
    vest.scale.set(1.5, 1, 0.98);
    vest.position.y = 0.22;
    vest.castShadow = true;
    spine.add(vest);
    this.vest = vest;

    // chest pouches / mag pouches
    for (const px of [-0.115, 0, 0.115]) {
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.055), this.m.pouch);
      pouch.position.set(px, 0.2, 0.175);
      pouch.castShadow = true;
      spine.add(pouch);
    }

    // neck + head
    const neck = new THREE.Group();
    neck.position.y = 0.44;
    spine.add(neck);
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 8), this.m.skin);
    neckMesh.position.y = 0.03;
    neck.add(neckMesh);
    const head = new THREE.Group();
    head.position.y = 0.14;
    neck.add(head);
    this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), this.m.skin);
    skull.scale.set(0.92, 1.08, 1);
    skull.castShadow = true;
    head.add(skull);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), this.m.helmet);
    helmet.position.y = 0.02;
    helmet.castShadow = true;
    head.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: 0.2, metalness: 0.6 }));
    visor.position.set(0, 0.01, 0.11);
    head.add(visor);

    // backpack
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.16), this.m.vest);
    pack.position.set(0, 0.2, -0.2);
    pack.castShadow = true;
    spine.add(pack);

    // ---- aim pivot (arms + weapon pitch together) ----
    const aim = new THREE.Group();
    aim.position.set(0, 0.34, 0.05);
    spine.add(aim);
    this.aim = aim;

    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.24 * side, 0.06, 0);
      aim.add(shoulder);
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.088, 10, 8), this.m.vest);
      pad.scale.set(1, 1.05, 1);
      pad.castShadow = true;
      shoulder.add(pad);
      const upper = this._limb(0.28, 0.062, this.m.shirt);
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      const fore = this._limb(0.26, 0.05, this.m.skin);
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.m.glove);
      hand.scale.set(1, 1.1, 0.8);
      hand.position.y = -0.27;
      elbow.add(hand);
      return { shoulder, elbow, hand };
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    // ---- weapon mounted to the hands ----
    const weaponMount = new THREE.Group();
    aim.add(weaponMount);
    this.weaponMount = weaponMount;
    if (weaponDef) this.setWeapon(weaponDef);

    // ---- legs ----
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.115 * side, -0.04, 0);
      pelvis.add(hip);
      const thigh = this._limb(0.44, 0.078, this.m.pants);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      const kneePad = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.11, 0.055), this.m.glove);
      kneePad.position.set(0, 0.0, 0.06);
      kneePad.castShadow = true;
      knee.add(kneePad);
      const shin = this._limb(0.42, 0.058, this.m.pants);
      knee.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), this.m.boots);
      foot.position.set(0, -0.44, 0.05);
      foot.castShadow = true;
      knee.add(foot);
      return { hip, knee };
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);
  }

  /** Trigger a muzzle flash (called every shot by owner). */
  muzzle() { if (this.flash) this.flash.material.opacity = 1; this.recoil = 0.14; }

  /** (Re)build the weapon held in the hands. */
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

  update(dt, s) {
    // s: { speed, grounded, crouch (0..1), aimPitch, alive, firing }
    const crouch = this.crouch = damp(this.crouch, s.crouch || 0, 8, dt);
    const speed = s.speed || 0;
    this.speedNorm = clamp(speed / 8.5, 0, 1.2);

    const alive = s.alive !== false;
    this.dead = !alive;

    if (!alive) { this._death(dt); return; }

    // gait phase advances with distance travelled (feet don't skate)
    this.phase += dt * (2.2 + speed * 1.35) * (speed > 0.3 ? 1 : 0.18);
    const p = this.phase;
    const walk = clamp(speed / 3.2, 0, 1);      // 0 idle -> 1 walking
    const run = clamp((speed - 3.2) / 5.3, 0, 1); // extra for sprint
    const swing = (0.42 * walk + 0.35 * run) * (s.grounded ? 1 : 0.25);

    const sin = Math.sin(p), cos = Math.cos(p);

    // ---- legs: thigh swing + knee bend (shin only bends backward) ----
    const legL = this.legL, legR = this.legR;
    const thighL = swing * sin;
    const thighR = swing * -sin;
    legL.hip.rotation.x = thighL;
    legR.hip.rotation.x = thighR;
    legL.knee.rotation.x = -Math.max(0, (0.55 * walk + 0.6 * run) * Math.sin(p + 1.15)) - 0.06;
    legR.knee.rotation.x = -Math.max(0, (0.55 * walk + 0.6 * run) * Math.sin(p + 1.15 + Math.PI)) - 0.06;

    // crouch bends the legs and lowers the body
    const ckL = crouch * 1.0;
    legL.hip.rotation.x += crouch * 0.55 + thighL * 0;
    legR.hip.rotation.x += crouch * 0.55 + thighR * 0;
    legL.knee.rotation.x -= ckL;
    legR.knee.rotation.x -= ckL;

    // ---- body height: crouch + landing dip + run bob ----
    const bob = (0.03 * Math.abs(Math.cos(p)) * walk) + (0.045 * Math.abs(Math.sin(p)) * run);
    this.body.position.y = -0.42 * crouch - this.dip + bob;
    this.dip = damp(this.dip, 0, 9, dt);

    // ---- torso lean + wobble ----
    const lean = 0.05 * walk + 0.16 * run + 0.28 * crouch;
    this.spine.rotation.x = damp(this.spine.rotation.x, lean - this.aimPitch * 0.15, 10, dt);
    this.spine.rotation.z = Math.sin(p) * 0.045 * (walk + run);
    this.spine.rotation.y = -Math.sin(p) * 0.09 * (walk + run);

    // idle breathing + weight shift
    const idle = 1 - clamp(walk + run, 0, 1);
    const breathe = 0.5 + 0.5 * Math.sin(performance.now() * 0.0013 + this.phase * 0.2);
    this.torso.scale.y = 1 + idle * 0.02 * breathe;
    this.vest.scale.y = 1 + idle * 0.014 * breathe;
    this.spine.position.x = Math.sin(performance.now() * 0.0007 + this.phase) * 0.006 * idle;

    // ---- aim pivot: pitch with aim + recoil kick ----
    if (s.firing && !this.prevFiring) this.recoil = 0.14;
    this.prevFiring = !!s.firing;
    this.recoil = damp(this.recoil, 0, 12, dt);
    this.aimPitch = damp(this.aimPitch, s.aimPitch || 0, 14, dt);
    this.aim.rotation.x = -this.aimPitch + this.recoil * 0.6;
    // subtle sway while moving
    this.aim.rotation.z = Math.sin(p * 0.5) * 0.05 * walk;
    this.aim.position.z = 0.05 - this.recoil * 0.6;

    // ---- arms: two-handed ready pose ----
    const swingArm = (0.28 * walk + 0.22 * run);
    this.armR.shoulder.rotation.set(-1.32 + Math.sin(p) * swingArm * 0.5, 0.12, -0.22);
    this.armR.elbow.rotation.set(1.05, 0, 0);
    this.armL.shoulder.rotation.set(-1.42 - Math.sin(p) * swingArm * 0.5, -0.28, 0.34);
    this.armL.elbow.rotation.set(1.2, 0, 0);

    // weapon sits between the hands
    this.weaponMount.position.set(0.11, -0.34, 0.42);
    this.weaponMount.rotation.set(0, 0, 0);

    // head steadies against torso lean, looks with aim
    this.head.rotation.x = -this.spine.rotation.x * 0.6 + this.aimPitch * 0.45;

    // muzzle flash decay
    if (this.flash && this.flash.material.opacity > 0)
      this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 16);
  }

  _death(dt) {
    // go limp
    const relax = (o, tx, tz = 0) => { o.rotation.x = lerp(o.rotation.x, tx, 0.2); o.rotation.z = lerp(o.rotation.z, tz, 0.2); };
    relax(this.legL.hip, 0.5, 0.1); relax(this.legR.hip, 0.2, -0.1);
    relax(this.legL.knee, -1.1); relax(this.legR.knee, -0.7);
    relax(this.armR.shoulder, -0.4, -0.5); relax(this.armL.shoulder, -0.2, 0.6);
    this.armR.elbow.rotation.x = lerp(this.armR.elbow.rotation.x, 0.3, 0.2);
    this.armL.elbow.rotation.x = lerp(this.armL.elbow.rotation.x, 0.4, 0.2);
    this.head.rotation.x = lerp(this.head.rotation.x, 0.4, 0.2);
    this.spine.rotation.x = lerp(this.spine.rotation.x, 0.15, 0.1);
  }

  dispose() {
    this.top.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.allMats.forEach((m) => m.dispose());
  }
}
