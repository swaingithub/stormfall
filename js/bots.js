import * as THREE from 'three';
import { clamp, rand, randInt, choice, dist2D, dist3D, lerp, damp, lerpAngle } from './utils.js';
import { WEAPONS, WEAPON_TIER } from './weapons.js';
import { THROWABLES } from './throwables.js';
import { CharacterRig } from './character.js';

const BOT_NAMES = [
  'Viper', 'Ghost', 'Rogue', 'Havoc', 'Blitz', 'Fury', 'Nomad', 'Raptor', 'Cobra', 'Vandal',
  'Echo', 'Reaper', 'Talon', 'Bishop', 'Knight', 'Onyx', 'Wraith', 'Falcon', 'Bandit', 'Cipher',
  'Drake', 'Jinx', 'Kilo', 'Maverick', 'Nova', 'Pilot', 'Quake', 'Ranger', 'Saber', 'Titan',
  'Umbra', 'Vortex', 'Widow', 'Xeno', 'Yeti', 'Zulu', 'Ace', 'Bolt', 'Crow', 'Dusk',
  'Ember', 'Flint', 'Grit', 'Hawk', 'Iris', 'Joker', 'Kraken', 'Lynx', 'Midas', 'Nyx',
  'Ozone', 'Prowl', 'Rhino', 'Storm', 'Thorn', 'Ulf', 'Vega', 'Wolf', 'Zephyr', 'Brick',
];

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export class Bot {
  constructor(scene, id, x, z, opts = {}) {
    this.scene = scene;
    this.id = id;
    this.game = opts.game || null;
    this.name = BOT_NAMES[id % BOT_NAMES.length] + (id >= BOT_NAMES.length ? randInt(2, 99) : '');
    this.isPlayer = false;

    this.position = new THREE.Vector3(x, 0, z);
    this.velocity = new THREE.Vector3();
    this.yaw = rand(0, Math.PI * 2);
    this.grounded = false;
    this.height = 1.8;

    this.skill = opts.skill ?? rand(0.35, 0.95);
    this.health = 100;
    this.armor = choice([0, 0, 30, 50, 75]);
    this.alive = true;
    this.deadTime = 0;
    this.fallDir = null;
    this.currentKiller = null;

    // weapon
    const ids = this.skill > 0.75 ? ['rifle', 'dmr', 'sniper', 'lmg', 'vector'] : ['rifle', 'vector', 'smg', 'shotgun', 'pistol'];
    this.wid = choice(ids);
    this.def = WEAPONS[this.wid];
    this.mag = this.def.magSize;
    this.reserve = 999;
    this.reloading = false;
    this.reloadT = 0;

    this.fireCooldown = 0;
    this.burstTimer = rand(0.4, 1.2);
    this.firing = false;
    this.reactionTimer = 0;
    this.target = null;
    this.thinkTimer = rand(0, 0.3);
    this.aimPitch = 0;

    // AI state
    this.state = 'rotate';
    this.seesTarget = false;
    this.timeOnTarget = 0;
    this.aimError = 1;
    this.lastSeenTimer = 99;
    this.lootGoal = null;
    this.healTimer = 0;
    this.grenadeCd = rand(6, 16);
    this.difficulty = opts.difficulty ?? 1;   // 0.6 easy .. 1.4 hard

    this.goal = new THREE.Vector3(x, 0, z);
    this.goalTimer = 0;
    this.stuckTimer = 0;
    this.lastPos = this.position.clone();
    this.strafeDir = choice([-1, 1]);
    this.strafeTimer = rand(0.5, 1.5);

    this.hitParts = [
      { name: 'head', off: new THREE.Vector3(0, 1.55, 0), r: 0.24 },
      { name: 'body', off: new THREE.Vector3(0, 1.12, 0), r: 0.42 },
      { name: 'legs', off: new THREE.Vector3(0, 0.46, 0), r: 0.4 },
    ];

    this.rig = (this.game && this.game.makeRig) ? this.game.makeRig(this.id, this.def) : new CharacterRig(this.id, this.def);
    this.mesh = this.rig.root;
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
  }

  takeDamage(dmg, attacker, point) {
    if (!this.alive) return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    if (attacker && attacker.alive) { this.target = attacker; this.thinkTimer = 0; }
    if (this.health <= 0) {
      this.health = 0;
      this.die(attacker, point);
    }
  }

  die(attacker, point) {
    if (!this.alive) return;
    this.alive = false;
    this.deadTime = 0;
    this.velocity.set(0, 0, 0);
    this.fallDir = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
    this.currentKiller = attacker;
    // real WASM ragdoll (falls back to scripted collapse if physics is unavailable)
    if (this.game && this.game.physics) {
      const dir = new THREE.Vector3();
      if (attacker && attacker.position) dir.copy(this.position).sub(attacker.position).setY(0).normalize().multiplyScalar(1.6);
      this.ragdoll = this.game.physics.spawnRagdoll(this.position, this.yaw, this.id, dir.lengthSq() > 0 ? dir : null);
      if (this.ragdoll) this.mesh.visible = false;
    }
    if (this.game) this.game.onBotKilled(attacker, this, point);
  }

  /** Switch to a new weapon (used when looting an upgrade). */
  _equip(def) {
    this.wid = def.id;
    this.def = def;
    this.mag = def.magSize;
    this.reloading = false;
    this.reloadT = 0;
    if (this.rig) this.rig.setWeapon(def);
  }

  _shoot(game) {
    const t = this.target;
    if (!t || !t.alive) return;
    const origin = tmpV.copy(this.position); origin.y += 1.35;
    const aim = tmpV2.copy(t.position); aim.y += (t.isPlayer ? t.eye : 1.15);
    const dist = origin.distanceTo(aim);
    const dir = aim.sub(origin).normalize();
    // error shrinks the longer the bot tracks a target (harder bots converge faster)
    const err = (1 - this.skill) * 0.07 * (1 + dist / 70) * this.aimError / this.difficulty + (this.def.spread || 0);
    dir.x += rand(-1, 1) * err;
    dir.y += rand(-1, 1) * err * 0.6;
    dir.z += rand(-1, 1) * err;
    dir.normalize();

    const maxDist = this.def.range;
    const hit = game.raycast(origin, dir, maxDist, this, null);
    const end = hit.point || origin.clone().addScaledVector(dir, maxDist);
    game.effects.tracer(origin.clone(), end, false);

    this.mag--;
    this.fireCooldown = 60 / this.def.rpm;
    this.rig.muzzle();
    game.audio.gunshot(this.def.type, this.position.x, this.position.z);

    if (hit.entity && hit.entity !== this) {
      let dmg = this.def.damage;
      if (hit.part === 'head') dmg *= this.def.headMult;
      else if (hit.part === 'legs') dmg *= 0.85;
      if (dist > maxDist * 0.6) dmg *= lerp(1, 0.6, (dist / maxDist - 0.6) / 0.4);
      hit.entity.takeDamage(dmg, this, hit.point);
    } else if (hit.point) {
      game.effects.impact(hit.point, hit.normal, hit.object);
    }
  }

  _throwGrenade(game) {
    const t = this.target;
    if (!t || !t.alive) return;
    const origin = this.position.clone(); origin.y += 1.4;
    const aim = t.position.clone(); aim.y += 0.9;
    const dist = origin.distanceTo(aim);
    const lead = origin.clone().addScaledVector(aim.clone().sub(origin).normalize(), dist);
    const dir = lead.sub(origin).normalize();
    // lob it a little high so it arcs onto the target
    dir.y += 0.25 * (dist / 20);
    dir.normalize();
    game.throwables.throw(THROWABLES.frag, origin, dir, clamp(10 + dist * 0.7, 12, 26));
    game.audio.throwSound(this.position.x, this.position.z);
    this.grenadeCd = rand(11, 20);
  }

  _isVisible(game, e) {
    const from = tmpV.copy(this.position); from.y += 1.35;
    const to = tmpV2.copy(e.position); to.y += (e.isPlayer ? e.eye : 1.15);
    const d = from.distanceTo(to);
    const dir = to.sub(from).normalize();
    const hit = game.raycast(from.clone(), dir, d + 2, this, null);
    return hit.entity === e || (!hit.entity && hit.dist >= d - 1);
  }

  /** Find a spot that puts a solid obstacle between this bot and a threat. */
  _findCover(game, threat) {
    let best = null, bestScore = -Infinity;
    const bx = this.position.x, bz = this.position.z;
    const tdx = threat.position.x - bx, tdz = threat.position.z - bz;
    const tlen = Math.hypot(tdx, tdz) + 1e-6;
    for (const b of game.world.boxes) {
      if (b.max.y - this.position.y < 0.9 || b.max.y > 30) continue;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const d = dist2D(bx, bz, cx, cz);
      if (d > 16 || d < 1.2) continue;
      const cdx = cx - bx, cdz = cz - bz;
      const clen = Math.hypot(cdx, cdz) + 1e-6;
      const dot = (tdx * cdx + tdz * cdz) / (tlen * clen);   // toward threat?
      if (dot < 0.25) continue;
      const score = dot - d / 40;
      if (score > bestScore) {
        bestScore = score;
        const away = new THREE.Vector3(cx - threat.position.x, 0, cz - threat.position.z).normalize();
        best = new THREE.Vector3(cx, 0, cz).addScaledVector(away, 2.2);
      }
    }
    return best;
  }

  think(game) {
    const z = game.zone;
    const outside = z.isOutside(this.position.x, this.position.z);

    let best = null, bestD = Infinity;
    const consider = (e) => {
      if (!e.alive || e === this) return;
      const d = dist3D(this.position, e.position);
      if (d < bestD && d < 85) { bestD = d; best = e; }
    };
    consider(game.player);
    for (const b of game.bots) if (b !== this) consider(b);

    let visible = null;
    if (best && this._isVisible(game, best)) visible = best;
    this.seesTarget = !!visible;
    this.target = visible || (best && bestD < 26 ? best : (this.target && this.target.alive ? this.target : null));

    if (outside) {
      const cx = z.center.x, cz = z.center.z;
      const ang = Math.atan2(this.position.z - cz, this.position.x - cx);
      const r = z.radius * 0.72;
      this.goal.set(cx + Math.cos(ang) * r, 0, cz + Math.sin(ang) * r);
      this.goalTimer = 2;
      this.state = 'rotate';
    } else if (visible) {
      if (this.health < 42) {
        const cover = this._findCover(game, visible);
        if (cover) { this.goal.copy(cover); this.goalTimer = 1.6; this.state = 'cover'; }
        else this.state = 'engage';
      } else {
        this.state = 'engage';
        this.goalTimer = 0;
      }
    } else if (this.target && this.lastSeenTimer < 3.5) {
      this.state = 'push';
      this.goal.copy(this.target.position);
      this.goalTimer = 0.8;
    } else {
      // out of combat: loot the nearest item, else wander
      const near = this._nearestLoot(game, 34);
      if (near) {
        this.lootGoal = near;
        this.goal.copy(near.position);
        this.state = 'loot';
        this.goalTimer = 2.5;
      } else if (this.goalTimer <= 0) {
        const ang = rand(0, Math.PI * 2);
        const rr = rand(20, 60);
        this.goal.set(
          clamp(this.position.x + Math.cos(ang) * rr, -280, 280), 0,
          clamp(this.position.z + Math.sin(ang) * rr, -280, 280));
        if (z.isOutside(this.goal.x, this.goal.z)) this.goal.set(z.center.x, 0, z.center.z);
        this.goalTimer = rand(3, 7);
        this.state = 'rotate';
      }
    }

    // passive healing when safe and not in a fight
    if (!visible && !this.target && !outside && this.health < 85 && this.health > 0) {
      this.healTimer += 0.25;
      if (this.healTimer > 3) { this.health = Math.min(100, this.health + 22); this.healTimer = 0; }
    } else this.healTimer = 0;
  }

  _nearestLoot(game, maxD = 40) {
    let best = null, bd = maxD;
    for (const it of game.loot.items) {
      const d = dist2D(this.position.x, this.position.z, it.position.x, it.position.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  _tryLoot(game) {
    const near = this._nearestLoot(game, 2.4);
    if (!near) return;
    const d = dist2D(this.position.x, this.position.z, near.position.x, near.position.z);
    if (d > 2.2) return;
    if (near.type === 'weapon') {
      const nd = WEAPONS[near.data.id];
      if (WEAPON_TIER[nd.id] > WEAPON_TIER[this.wid]) this._equip(nd);
      else return; // leave upgrades we don't need
    } else if (near.type === 'armor') {
      if (this.armor >= 90) return;
      this.armor = clamp(this.armor + near.data.value, 0, 100);
    } else if (near.type === 'health') {
      if (this.health > 75) return;
      this.health = clamp(this.health + near.data.heal, 0, 100);
    } else if (near.type === 'ammo') {
      this.reserve += near.data.amount;
    } else if (near.type === 'grenade') {
      // bots don't hoard grenades, but picking up refills their throw cooldown
      this.grenadeCd = Math.min(this.grenadeCd, 4);
      game.loot.take(near); return;
    } else return;
    game.loot.take(near);
    if (this.lootGoal === near) this.lootGoal = null;
  }

  update(dt, game) {
    if (!this.alive) {
      this.deadTime += dt;
      if (!this.ragdoll) this._updateDeath(dt);
      return;
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) { this.think(game); this.thinkTimer = rand(0.15, 0.35); }
    this.lastSeenTimer = this.seesTarget ? 0 : this.lastSeenTimer + dt;
    if (this.grenadeCd > 0) this.grenadeCd -= dt;

    let moveDir = null;
    let speed = 4.6;
    const t = this.target;
    const inCombat = (this.state === 'engage' || this.state === 'cover' || this.state === 'push') && t && t.alive;

    if (inCombat) {
      const d = dist2D(this.position.x, this.position.z, t.position.x, t.position.z);
      const desiredYaw = Math.atan2(t.position.x - this.position.x, t.position.z - this.position.z);
      this.yaw = lerpAngle(this.yaw, desiredYaw, clamp(dt * 6 * (0.5 + this.skill), 0, 1));

      const toward = new THREE.Vector3(t.position.x - this.position.x, 0, t.position.z - this.position.z).normalize();
      const side = new THREE.Vector3(-toward.z, 0, toward.x);
      moveDir = new THREE.Vector3();

      if (this.state === 'cover' || this.state === 'push') {
        const gd = dist2D(this.position.x, this.position.z, this.goal.x, this.goal.z);
        if (gd > 1.5) moveDir.copy(new THREE.Vector3(this.goal.x - this.position.x, 0, this.goal.z - this.position.z).normalize());
        speed = 7.2;
      } else {
        const ideal = this.wid === 'shotgun' ? 12 : (this.wid === 'sniper' || this.wid === 'dmr' ? 42 : 24);
        if (d > ideal + 6) moveDir.add(toward);
        else if (d < ideal - 8) moveDir.sub(toward);
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = rand(0.6, 1.8); }
        moveDir.addScaledVector(side, this.strafeDir * 0.8);
        if (moveDir.lengthSq() > 0) moveDir.normalize();
        speed = 5.4;
      }

      // vertical aim toward target
      const dy = (t.position.y + (t.isPlayer ? t.eye : 1.15)) - (this.position.y + 1.35);
      const hd = Math.max(0.1, d);
      this.aimPitch = damp(this.aimPitch, Math.atan2(dy, hd), 8, dt);
      this.timeOnTarget += dt;
      this.aimError = clamp(1 - this.timeOnTarget * 1.4, 0.12, 1);

      if (this.reloading) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) { this.mag = this.def.magSize; this.reloading = false; }
      } else {
        this.reactionTimer -= dt;
        const canShoot = this.seesTarget && this.mag > 0 && this.fireCooldown <= 0 &&
          this.reactionTimer <= 0 && d < this.def.range * 0.95;
        if (this.mag <= 0) { this.reloading = true; this.reloadT = this.def.reloadTime; }
        else if (canShoot) {
          this.burstTimer -= dt;
          if (this.burstTimer > 0) { this.firing = true; this._shoot(game); }
          else { this.burstTimer = this.def.auto ? rand(0.3, 0.9) : rand(0.5, 1.1); this.firing = false; }
        } else {
          this.firing = false;
        }
      }

      // occasional grenade
      if (this.seesTarget && this.grenadeCd <= 0 && this.skill > 0.5 && d > 9 && d < 30) {
        this._throwGrenade(game);
      }
    } else {
      this.aimPitch = damp(this.aimPitch, 0, 6, dt);
      this.firing = false;
      this.timeOnTarget = 0;
      this.aimError = 1;
      if (this.reloading) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) { this.mag = this.def.magSize; this.reloading = false; }
      }
      const d = dist2D(this.position.x, this.position.z, this.goal.x, this.goal.z);
      if (d > 2.5) {
        const desiredYaw = Math.atan2(this.goal.x - this.position.x, this.goal.z - this.position.z);
        this.yaw = lerpAngle(this.yaw, desiredYaw, clamp(dt * 5, 0, 1));
        moveDir = new THREE.Vector3(this.goal.x - this.position.x, 0, this.goal.z - this.position.z).normalize();
        speed = d > 30 ? 7.0 : 4.8;
      } else { this.goalTimer = 0; }
      this.goalTimer -= dt;

      if (this.state === 'loot' || Math.random() < 0.03) this._tryLoot(game);
    }

    // stuck detection
    this.stuckTimer -= dt;
    if (this.stuckTimer <= 0) {
      const moved = dist2D(this.position.x, this.position.z, this.lastPos.x, this.lastPos.z);
      if (moved < 0.25 && (this.goalTimer > 0 || inCombat)) {
        const ang = this.yaw + choice([-1, 1]) * Math.PI / 2;
        this.goal.set(this.position.x + Math.sin(ang) * 8, 0, this.position.z + Math.cos(ang) * 8);
      }
      this.lastPos.copy(this.position);
      this.stuckTimer = 0.8;
    }

    if (moveDir) {
      this.velocity.x = damp(this.velocity.x, moveDir.x * speed, 10, dt);
      this.velocity.z = damp(this.velocity.z, moveDir.z * speed, 10, dt);
    } else {
      this.velocity.x = damp(this.velocity.x, 0, 10, dt);
      this.velocity.z = damp(this.velocity.z, 0, 10, dt);
    }
    this.velocity.y += -22 * dt;
    this.velocity.y = Math.max(this.velocity.y, -50);
    const col = game.world.moveActor(this.position, this.velocity, dt, 0.42, this.height, 0.45);
    this.grounded = col.grounded;

    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.reactionTimer > 0) this.reactionTimer -= dt;
    if (this.seesTarget && this.lastTarget !== this.target) {
      this.reactionTimer = (1 - this.skill) * 0.55;
      this.timeOnTarget = 0;
      this.lastTarget = this.target;
    }
    if (!this.seesTarget) this.lastTarget = null;

    this._animate(dt);
  }

  _animate(dt) {
    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0, this.yaw, 0);
    this.rig.update(dt, {
      speed: horiz,
      grounded: this.grounded,
      crouch: 0,
      aimPitch: this.aimPitch,
      alive: true,
      firing: this.firing,
      aiming: !!(this.target && this.target.alive &&
        (this.state === 'engage' || this.state === 'cover' || this.state === 'push')),
    });
  }

  _updateDeath(dt) {
    this.rig.update(dt, { alive: false });
    const p = clamp(this.deadTime / 0.7, 0, 1);
    const ease = 1 - (1 - p) * (1 - p);
    const rot = ease * (Math.PI / 2);
    const axis = new THREE.Vector3(this.fallDir.z, 0, -this.fallDir.x).normalize();
    tmpQ.setFromAxisAngle(axis, rot);
    this.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.mesh.quaternion.multiply(tmpQ);
    if (this.deadTime > 6) this.mesh.position.y = this.position.y - (this.deadTime - 6) * 0.35;
    else { this.mesh.position.copy(this.position); this.mesh.position.y = this.position.y + 0.1; }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.rig.dispose();
  }
}
