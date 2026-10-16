import * as THREE from 'three';
import { clamp, lerp, damp, rand, randInt } from './utils.js';
import { WEAPONS, AMMO_MAX, buildViewModel } from './weapons.js';
import { CharacterRig } from './character.js';
import { THROWABLES } from './throwables.js';

const GRAVITY = -22;
const WALK = 5.4, SPRINT = 8.6, CROUCH = 2.9;
const JUMP = 8.4;
const STAND_H = 1.8, CROUCH_H = 1.2;
const STAND_EYE = 1.62, CROUCH_EYE = 1.02;
const RADIUS = 0.4;

export class Player {
  constructor(scene, camera, game) {
    this.scene = scene;
    this.camera = camera;
    this.game = game;
    this.isPlayer = true;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shotStreak = 0;
    this.grounded = false;
    this.crouching = false;
    this.sprinting = false;
    this.height = STAND_H;
    this.eye = STAND_EYE;

    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.maxArmor = 100;
    this.alive = true;
    this.grenades = 2;
    this.medkits = 1;
    this.attachments = { extmag: false, grip: false };

    this.stamina = 100;
    this.maxStamina = 100;

    this.weapons = [null, null, null];
    this.slot = -1;
    this.ammo = { light: 60, heavy: 0, shell: 0, sniper: 0 };

    this.reloading = false;
    this.reloadT = 0;
    this.fireCooldown = 0;
    this.healing = false;
    this.healT = 0;
    this.healTotal = 0;

    this.ads = false;
    this.bobT = 0;
    this.stepDist = 0;
    this.viewKick = new THREE.Vector3();
    this.switchAnim = 0;
    this.cameraShake = 0;

    this.kills = 0;
    this.damageDealt = 0;

    // viewmodel container
    this.viewGroup = new THREE.Group();
    camera.add(this.viewGroup);
    if (!camera.parent) scene.add(camera);
    this.currentViewModel = null;

    // muzzle flash light
    this.flash = new THREE.PointLight(0xffd080, 0, 8, 2);
    this.flash.position.set(0.25, -0.1, -0.8);
    camera.add(this.flash);

    // parachute (used during the deploy drop)
    this.dropping = false;
    const chute = new THREE.Group();
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xff5722, roughness: 0.9, side: THREE.DoubleSide });
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
    canopy.position.y = 1.0; canopy.rotation.x = Math.PI;
    chute.add(canopy);
    for (const dx of [-0.7, 0.7]) for (const dz of [-0.4, 0.4]) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0x333333 }));
      line.position.set(dx * 0.6, 0.45, dz * 0.6);
      line.rotation.z = -dx * 0.35; line.rotation.x = dz * 0.35;
      chute.add(line);
    }
    chute.visible = false;
    chute.position.set(0, 1.3, -0.2);
    camera.add(chute);
    this.parachute = chute;

    // small light so the first-person weapon is always readable
    this.vmLight = new THREE.PointLight(0xffffff, 0.9, 3.2, 2);
    this.vmLight.position.set(0.2, 0.4, 0.2);
    camera.add(this.vmLight);

    // visible third-person body (real skinned soldier when available)
    this.thirdPerson = false;
    this.body = this.game.makeRig ? this.game.makeRig(2, null) : new CharacterRig(2);
    this.body.root.visible = false;
    scene.add(this.body.root);

    // realism state
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.landDip = 0;
    this.lean = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.fireAnim = 0;
    this.vault = null;
    this.slide = null;
    this.crouchLatch = false;

    this.giveWeapon('pistol');
    this.ammo.light = 90;
  }

  toggleThirdPerson() {
    this.thirdPerson = !this.thirdPerson;
    this.body.root.visible = this.thirdPerson;
    if (this.viewGroup) this.viewGroup.visible = !this.thirdPerson;
  }

  get weapon() { return this.slot >= 0 ? this.weapons[this.slot] : null; }

  /** Magazine size for a weapon def, accounting for the extended-mag attachment. */
  magSize(def) { return def.magSize + (this.attachments.extmag ? Math.ceil(def.magSize * 0.35) : 0); }

  giveWeapon(id) {
    const def = WEAPONS[id];
    const inst = { id, def, mag: this.magSize(def) };
    // place in first empty slot, else replace current
    let idx = this.weapons.findIndex((w) => w === null);
    if (idx === -1) idx = this.slot >= 0 ? this.slot : 0;
    const replaced = this.weapons[idx];
    this.weapons[idx] = inst;
    if (replaced && replaced.def.id === id) { /* keep */ }
    this.selectSlot(idx);
    return inst;
  }

  selectSlot(i) {
    if (i < 0 || i > 2 || !this.weapons[i]) return;
    if (this.slot === i) return;
    this.slot = i;
    this.reloading = false;
    this.buildViewModel();
    this.switchAnim = 1;
    this.game.audio.reload(0);
  }

  buildViewModel() {
    if (this.currentViewModel) this.viewGroup.remove(this.currentViewModel);
    const def = this.weapon.def;
    this.currentViewModel = buildViewModel(def);
    this.currentViewModel.scale.setScalar(0.42);
    this.viewGroup.add(this.currentViewModel);
    if (this.body) this.body.setWeapon(def);
  }

  addAmmo(type, amount) {
    this.ammo[type] = clamp(this.ammo[type] + amount, 0, AMMO_MAX[type]);
  }

  // ---------------- Shooting ----------------
  tryFire() {
    if (!this.alive || this.healing) return;
    const w = this.weapon;
    if (!w || this.reloading || this.fireCooldown > 0) return;
    if (w.mag <= 0) { this.startReload(); return; }
    const def = w.def;
    this.fireCooldown = 60 / def.rpm;
    w.mag--;

    const spreadMul = this.ads ? 0.35 : (this.crouching ? 0.7 : (this.sprinting ? 1.5 : 1));
    const moving = this.velocity.lengthSq() > 1 ? 1.4 : 1;
    const spread = def.spread * spreadMul * moving;
    for (let p = 0; p < def.pellets; p++) {
      this.fireBullet(def, spread);
    }

    // recoil (weapon-specific climb + horizontal drift pattern)
    const kick = def.recoil * (this.ads ? 0.6 : 1) * (this.attachments.grip ? 0.65 : 1);
    this.shotStreak = Math.min((this.shotStreak || 0) + 1, 24);
    const i = this.shotStreak;
    const climb = 0.7 + Math.min(i, 9) * 0.14;
    const drift = Math.sin(i * 1.6) * Math.min(i, 10) * 0.05;
    this.recoilPitch += kick * 0.012 * climb;
    this.recoilYaw += kick * 0.006 * drift;
    this.viewKick.z += def.recoil * 0.02;
    this.viewKick.y += def.recoil * 0.006;
    this.cameraShake = Math.min(this.cameraShake + def.recoil * 0.001, 0.02);
    this.flash.intensity = 3.2;
    this.flash.distance = 9;
    this.fireAnim = 0.12;
    if (this.body) this.body.muzzle();
    if (this.game.effects) {
      const sp = this.camera.position.clone();
      const sd = new THREE.Vector3(); this.camera.getWorldDirection(sd);
      sp.addScaledVector(sd, 0.8); sp.y -= 0.12;
      this.game.effects.smoke(sp, sd, 0.35);
    }

    this.game.audio.gunshot(def.type, this.position.x, this.position.z);
  }

  fireBullet(def, spread) {
    this.camera.updateMatrixWorld();
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (this.thirdPerson) {
      // fire from the character's weapon, not the chase camera
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      origin.copy(this.position).addScaledVector(fwd, 0.5);
      origin.y += this.eye - 0.18;
    } else {
      this.camera.getWorldPosition(origin);
    }
    // apply spread
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const sx = (Math.random() - 0.5) * spread * 2;
    const sy = (Math.random() - 0.5) * spread * 2;
    dir.addScaledVector(right, sx).addScaledVector(up, sy).normalize();

    const maxDist = def.range;
    const hit = this.game.raycast(origin, dir, maxDist, null, this);
    const end = hit.point || origin.clone().addScaledVector(dir, maxDist);
    // visual bullet drop (hitscan accuracy retained)
    const flight = hit.dist / def.speed;
    end.y -= 0.5 * 9.8 * flight * flight;
    this.game.effects.tracer(origin, end, def.type === 'sniper' || def.type === 'lmg');

    if (hit.bot) {
      const distFrac = hit.dist / maxDist;
      let dmg = def.damage;
      if (distFrac > 0.6) dmg *= lerp(1, 0.6, (distFrac - 0.6) / 0.4);
      if (hit.part === 'head') dmg *= def.headMult;
      else if (hit.part === 'legs') dmg *= 0.85;
      const wasAlive = hit.bot.alive;
      const before = hit.bot.health + hit.bot.armor;
      hit.bot.takeDamage(dmg, this, hit.point);
      this.game.spawnDamageNumber(hit.point, Math.round(dmg), !hit.bot.alive ? 'kill' : (hit.part === 'head' ? 'head' : 'hit'));
      this.damageDealt += Math.min(dmg, before);
      if (hit.bot.alive && wasAlive) {
        this.game.onHitMarker(hit.part === 'head' ? 'head' : 'hit', false);
      }
      this.game.effects.blood(hit.point || hit.bot.position);
    } else if (hit.point) {
      this.game.effects.impact(hit.point, hit.normal, hit.object);
      this.game.audio.impact(hit.point.x, hit.point.z);
    }
  }

  startReload() {
    const w = this.weapon;
    if (!w || this.reloading) return;
    if (w.mag >= this.magSize(w.def)) return;
    if (this.ammo[w.def.ammoType] <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadStage = 0;
  }

  finishReload() {
    const w = this.weapon;
    const need = this.magSize(w.def) - w.mag;
    const avail = this.ammo[w.def.ammoType];
    const take = Math.min(need, avail);
    w.mag += take;
    this.ammo[w.def.ammoType] -= take;
    this.reloading = false;
  }

  // ---------------- Items ----------------
  pickup(item) {
    const g = this.game;
    if (item.type === 'weapon') {
      const def = WEAPONS[item.data.id];
      const inst = { id: item.data.id, def, mag: this.magSize(def) };
      let idx = this.weapons.findIndex((w) => w === null);
      if (idx === -1) idx = this.slot;
      // drop current weapon in that slot
      const old = this.weapons[idx];
      if (old) {
        const dropPos = this.position.clone();
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        dropPos.addScaledVector(fwd, 1.2);
        g.loot.spawnAt(dropPos.x, dropPos.z, dropPos.y, 'weapon');
        const d = g.loot.items[g.loot.items.length - 1];
        d.data.id = old.id;
        // rebuild label mesh
        g.loot.group.remove(d.mesh);
        const nb = d.build(); g.loot.group.add(nb);
      }
      this.weapons[idx] = inst;
      this.selectSlot(idx);
      g.hud.toast(`Picked up ${def.name}`);
    } else if (item.type === 'ammo') {
      this.addAmmo(item.data.ammoType, item.data.amount);
      g.hud.toast(`+${item.data.amount} ${item.data.ammoType} ammo`);
    } else if (item.type === 'armor') {
      this.armor = clamp(this.armor + item.data.value, 0, this.maxArmor);
      g.hud.toast(`Armor +${item.data.value}`);
    } else if (item.type === 'grenade') {
      this.grenades = Math.min(5, this.grenades + item.data.amount);
      g.hud.toast(`Frag Grenade x${item.data.amount}`);
    } else if (item.type === 'health') {
      this.medkits = Math.min(3, this.medkits + 1);
      g.audio.pickup();
      g.hud.toast('Medkit +1');
    } else if (item.type === 'attachment') {
      if (this.attachments[item.data.kind]) { g.loot.take(item); return; }
      this.attachments[item.data.kind] = true;
      // extend the current magazine immediately
      const w = this.weapon;
      if (w && item.data.kind === 'extmag') w.mag = this.magSize(w.def);
      g.hud.toast(item.data.kind === 'extmag' ? 'Extended Mag equipped' : 'Compensator equipped');
    }
    g.audio.pickup();
    g.loot.take(item);
  }

  useMedkit() {
    if (this.healing || this.health >= this.maxHealth || this.medkits <= 0) return false;
    this.medkits--;
    this.healing = true;
    this.healT = 0;
    this.healTotal = 50;
    return true;
  }

  throwGrenade() {
    if (!this.alive || this.dropping || this.grenades <= 0) return false;
    const g = this.game;
    if (!g.throwables) return false;
    this.grenades--;
    const origin = this.position.clone();
    origin.y += this.eye - 0.1;
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    origin.addScaledVector(fwd, 0.6);
    g.throwables.throw(THROWABLES.frag, origin, dir, 22);
    g.audio.throwSound(this.position.x, this.position.z);
    return true;
  }

  _findVault() {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const world = this.game.world;
    const py = this.position.y;
    let best = null;
    for (const b of world.boxes) {
      const top = b.max.y;
      const rise = top - py;
      if (rise < 0.45 || rise > 1.6) continue;
      if (top > 30) continue; // boundary walls
      const px = this.position.x + fwd.x * 0.95;
      const pz = this.position.z + fwd.z * 0.95;
      if (px < b.min.x - 0.35 || px > b.max.x + 0.35) continue;
      if (pz < b.min.z - 0.35 || pz > b.max.z + 0.35) continue;
      if (!best || top < best.top) best = { top };
    }
    return best;
  }

  _startVault(v) {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const to = this.position.clone().addScaledVector(fwd, 1.5);
    to.y = v.top + 0.01;
    this.vault = { t: 0, dur: 0.42, from: this.position.clone(), to };
    this.game.audio.footstep(false);
  }

  // ---------------- Damage ----------------
  takeDamage(dmg, from, point) {
    if (!this.alive) return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    // aim punch: incoming fire jolts your aim
    this.recoilPitch += Math.min(dmg, 40) * 0.0011;
    this.recoilYaw += rand(-1, 1) * Math.min(dmg, 40) * 0.0007;
    this.cameraShake = Math.min(0.045, this.cameraShake + dmg * 0.0009);
    this.game.audio.hurt();
    this.game.hud.flashDamage(Math.min(1, dmg / 45));
    this.game.hud.hurtDirection(from, this);
    if (this.health <= 0) { this.health = 0; this.die(from); }
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.game.onPlayerDeath(killer);
  }

  zoneDamage(d) {
    if (!this.alive) return;
    this.health -= d;
    this.game.hud.flashDamage(d * 0.4);
    if (this.health <= 0) { this.health = 0; this.die(null); }
  }

  // ---------------- Update ----------------
  update(dt, input) {
    if (!this.alive) { this.updateCamera(dt); return; }

    // rotation from mouse deltas
    this.yaw -= input.mouseDX * input.sensitivity;
    this.pitch -= input.mouseDY * input.sensitivity;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);

    // recoil recovery
    this.yaw += this.recoilYaw;
    this.pitch += this.recoilPitch;
    this.recoilYaw = damp(this.recoilYaw, 0, 12, dt);
    this.recoilPitch = damp(this.recoilPitch, 0, 12, dt);
    if (this.shotStreak > 0) this.shotStreak = Math.max(0, this.shotStreak - dt * 6);

    // ADS
    const wantAds = input.rightMouse;
    this.ads = wantAds && !this.reloading;

    // ---- crouch / crouch-slide ----
    const wantCrouch = input.keyC;
    if (this.slide) {
      this.slide.t += dt;
      if (this.slide.t >= this.slide.dur) this.slide = null;
    }
    if (wantCrouch && !this.crouchLatch && this.grounded && this.sprinting && !this.slide &&
        Math.hypot(this.velocity.x, this.velocity.z) > 5.5) {
      this.slide = { t: 0, dur: 0.75, dir: new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)) };
    }
    this.crouchLatch = wantCrouch;

    this.crouching = (wantCrouch && this.grounded) || !!this.slide;
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    const targetEye = this.crouching ? CROUCH_EYE : STAND_EYE;
    this.height = damp(this.height, targetH, 12, dt);
    this.eye = damp(this.eye, targetEye, 12, dt);

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // sprint
    const wantSprint = input.keyShift && !this.crouching && input.moveZ > 0.1 && this.stamina > 1 && !this.ads && !this.slide;
    this.sprinting = wantSprint && this.grounded;

    // stamina
    if (this.sprinting) this.stamina = clamp(this.stamina - dt * 18, 0, this.maxStamina);
    else this.stamina = clamp(this.stamina + dt * (this.grounded ? 14 : 6), 0, this.maxStamina);

    if (this.vault) {
      // scripted vault over a low obstacle
      this.vault.t += dt;
      const p = clamp(this.vault.t / this.vault.dur, 0, 1);
      const e = p * p * (3 - 2 * p);
      this.position.lerpVectors(this.vault.from, this.vault.to, e);
      this.position.y += Math.sin(p * Math.PI) * 0.2;
      if (p >= 1) { this.position.copy(this.vault.to); this.vault = null; this.grounded = true; }
      this.velocity.set(0, 0, 0);
    } else {
      // desired horizontal velocity (or sliding momentum)
      let targetVel;
      if (this.slide) {
        const spd = lerp(SPRINT, 2.6, clamp(this.slide.t / this.slide.dur, 0, 1));
        targetVel = new THREE.Vector3(this.slide.dir.x * spd, 0, this.slide.dir.z * spd);
      } else {
        const speed = this.sprinting ? SPRINT : (this.crouching ? CROUCH : WALK);
        const wish = new THREE.Vector3();
        wish.addScaledVector(fwd, input.moveZ);
        wish.addScaledVector(right, input.moveX);
        if (wish.lengthSq() > 1) wish.normalize();
        targetVel = wish.multiplyScalar(speed);
      }
      const accel = this.slide ? 60 : (this.dropping ? 18 : (this.grounded ? 45 : 9));
      this.velocity.x = damp(this.velocity.x, targetVel.x, accel / 4, dt);
      this.velocity.z = damp(this.velocity.z, targetVel.z, accel / 4, dt);

      // coyote time + jump buffering + vault trigger
      if (this.grounded) this.coyote = 0.12; else this.coyote = Math.max(0, this.coyote - dt);
      const jumpPressed = input.keySpace && !this.jumpLatch && !this.dropping;
      if (jumpPressed) { this.jumpBuffer = 0.15; this.jumpLatch = true; }
      if (!input.keySpace) this.jumpLatch = false;
      if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
      if (jumpPressed && this.grounded && !this.crouching) {
        const v = this._findVault();
        if (v) this._startVault(v);
      }
      if (!this.vault) {
        if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouching && !this.dropping) {
          this.velocity.y = JUMP;
          this.grounded = false;
          this.coyote = 0; this.jumpBuffer = 0;
        }

        const grav = this.dropping ? -18 : GRAVITY;
        this.velocity.y += grav * dt;
        this.velocity.y = Math.max(this.velocity.y, this.dropping ? -26 : -60);

        const wasAir = !this.grounded;
        const wasDropping = this.dropping;
        const fallSpeed = this.velocity.y;
        const col = this.game.world.moveActor(this.position, this.velocity, dt, RADIUS, this.height, 0.55);
        this.grounded = col.grounded;
        if (this.grounded && this.dropping) { this.dropping = false; this.parachute.visible = false; }
        if (this.grounded && wasAir && !wasDropping) {
          const mag = Math.abs(fallSpeed);
          this.landDip = clamp((mag - 6) / 16, 0, 1) * 0.32;
          this.cameraShake = Math.min(0.03, mag * 0.0012);
          if (mag > 16) this.takeDamage(Math.min(100, (mag - 16) * 6), null, this.position);
        }
      }
    }
    if (this.dropping) this.parachute.visible = true;

    // strafe lean
    this.lean = damp(this.lean, -input.moveX * 0.05 * clamp(Math.hypot(this.velocity.x, this.velocity.z) / SPRINT, 0, 1), 8, dt);
    this.landDip = damp(this.landDip, 0, 8, dt);

    // weapon sway from mouse motion
    this.swayX = damp(this.swayX, clamp(-input.mouseDX * input.sensitivity * 6, -0.05, 0.05), 10, dt);
    this.swayY = damp(this.swayY, clamp(-input.mouseDY * input.sensitivity * 6, -0.05, 0.05), 10, dt);

    // footsteps
    if (this.grounded) {
      const horiz = Math.hypot(this.velocity.x, this.velocity.z);
      this.stepDist += horiz * dt;
      const stride = this.sprinting ? 2.0 : 2.6;
      if (this.stepDist > stride && horiz > 1) {
        this.stepDist = 0;
        this.game.audio.footstep(this.sprinting);
        if (this.game.effects) this.game.effects.dust(this.position.clone());
      }
    }

    // weapons
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.reloading) {
      this.reloadT += dt;
      const prog = this.reloadT / this.weapon.def.reloadTime;
      if (prog > 0.3 && this.reloadStage === 0) { this.reloadStage = 1; this.game.audio.reload(1); }
      if (prog > 0.6 && this.reloadStage === 1) { this.reloadStage = 2; this.game.audio.reload(2); }
      if (prog >= 1) { this.finishReload(); this.game.audio.reload(3); }
    }
    if (input.mouseDown && input.leftMouse) {
      const w = this.weapon;
      if (w && (w.def.auto || !this.fireLatch)) {
        this.tryFire();
        this.fireLatch = true;
      }
    }
    if (!input.leftMouse) this.fireLatch = false;

    // healing channel
    if (this.healing) {
      this.healT += dt;
      const dur = 2.5;
      if (this.healT >= dur) {
        this.health = clamp(this.health + this.healTotal, 0, this.maxHealth);
        this.healing = false;
        this.game.hud.toast('Healed');
      }
      this.game.hud.setHeal(this.healT / dur);
      // interrupt if damaged heavily handled by flag in takeDamage? keep simple: movement cancels
      if (this.sprinting) { this.healing = false; }
    } else {
      this.game.hud.setHeal(0);
    }

    this.flash.intensity = damp(this.flash.intensity, 0, 18, dt);
    if (this.fireAnim > 0) this.fireAnim -= dt;

    this.updateBody(dt);
    this.updateViewModel(dt);
    this.updateCamera(dt);
  }

  updateBody(dt) {
    if (!this.body) return;
    this.body.root.position.copy(this.position);
    this.body.root.rotation.set(0, this.yaw + Math.PI, 0);
    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    this.body.update(dt, {
      speed: horiz,
      grounded: this.grounded,
      crouch: this.crouching ? 1 : 0,
      aimPitch: this.pitch,
      alive: this.alive,
      firing: this.fireAnim > 0,
      aiming: this.ads || this.fireAnim > 0,
    });
    // lean into strafes
    if (this.body.spine) this.body.spine.rotation.z += this.lean;
  }

  updateViewModel(dt) {
    if (!this.currentViewModel) return;
    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    this.bobT += dt * (this.sprinting ? 13 : 9);
    const bobAmt = this.grounded ? Math.min(horiz / SPRINT, 1) * (this.sprinting ? 0.028 : 0.016) : 0;
    const bobX = Math.cos(this.bobT) * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobT)) * bobAmt;

    // aim-down-sights base position
    const baseX = this.ads ? 0.0 : 0.17;
    const baseY = this.ads ? -0.1 : -0.16;
    const baseZ = this.ads ? -0.3 : -0.46;

    this.viewKick.z = damp(this.viewKick.z, 0, 14, dt);
    this.viewKick.y = damp(this.viewKick.y, 0, 14, dt);

    let sx = 0, sy = 0;
    if (this.switchAnim > 0) {
      this.switchAnim = Math.max(0, this.switchAnim - dt * 4);
      sx += this.switchAnim * 0.3;
      sy -= this.switchAnim * 0.6;
    }

    let rz = 0, ry = 0;
    if (this.reloading) {
      const p = this.reloadT / this.weapon.def.reloadTime;
      const tilt = Math.sin(p * Math.PI);
      ry += tilt * 0.7;
      sy -= tilt * 0.15;
      rz += tilt * 0.3;
    }

    const m = this.currentViewModel;
    m.position.x = damp(m.position.x, baseX + bobX + sx + this.swayX, 18, dt);
    m.position.y = damp(m.position.y, baseY - bobY + sy + this.viewKick.y + this.swayY, 18, dt);
    m.position.z = damp(m.position.z, baseZ + this.viewKick.z, 18, dt);
    m.rotation.x = damp(m.rotation.x, ry - this.viewKick.y * 2 + this.swayY * 3, 14, dt);
    m.rotation.z = damp(m.rotation.z, rz + sx + this.swayX * 3, 14, dt);
    m.rotation.y = damp(m.rotation.y, -sx - this.swayX * 2, 14, dt);

    // fov for ADS + sprint speed push
    const targetFov = this.ads ? this.weapon.def.adsFov : (75 + (this.sprinting ? 4 : 0));
    this.camera.fov = damp(this.camera.fov, targetFov, 12, dt);
    this.camera.updateProjectionMatrix();
  }

  updateCamera(dt) {
    const eyePos = this.position.clone();
    eyePos.y += this.eye - this.landDip;
    // camera shake
    if (this.cameraShake > 0) {
      eyePos.x += rand(-1, 1) * this.cameraShake;
      eyePos.y += rand(-1, 1) * this.cameraShake;
      this.cameraShake = damp(this.cameraShake, 0, 10, dt);
    }
    // small head bob
    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    const hb = this.grounded ? Math.sin(this.bobT) * Math.min(horiz / SPRINT, 1) * 0.03 : 0;
    eyePos.y += hb;

    const e = new THREE.Euler(this.pitch, this.yaw, this.lean, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(e);

    if (this.thirdPerson) {
      const target = eyePos.clone().add(new THREE.Vector3(0, 0.15, 0));
      const back = forward.clone().negate();
      const want = 4.4;
      let dist = want;
      if (this.game.raycastWorld) {
        const hit = this.game.raycastWorld(target, back, want + 0.5);
        if (hit && hit.t < want + 0.5) dist = Math.max(1.2, hit.t - 0.35);
      }
      const rightV = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const camPos = target.clone().addScaledVector(back, dist).addScaledVector(rightV, 0.7);
      this.camera.position.copy(camPos);
      this.camera.quaternion.setFromEuler(e);
    } else {
      this.camera.position.copy(eyePos);
      this.camera.quaternion.setFromEuler(e);
    }

    this.game.audio.setListener(this.position.x, this.position.y, this.position.z);
  }
}
