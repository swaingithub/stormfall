import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World, WORLD_HALF, EYE_HEIGHT } from './world.js';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { CharacterRig } from './character.js';
import { Skins, SkinnedCharacter } from './skins.js';
import { LootManager } from './loot.js';
import { Zone, PHASES } from './zone.js';
import { Effects } from './effects.js';
import { ThrowableManager } from './throwables.js';
import { Physics } from './physics.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { clamp, rand, dist2D, formatTime } from './utils.js';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _oc = new THREE.Vector3();

function rayAABB(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  let nAxis = 0;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < b.min.x || ox > b.max.x) return -1; }
  else {
    let t1 = (b.min.x - ox) / dx, t2 = (b.max.x - ox) / dx;
    let sign = -1; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(dy) < 1e-9) { if (oy < b.min.y || oy > b.max.y) return -1; }
  else {
    let t1 = (b.min.y - oy) / dy, t2 = (b.max.y - oy) / dy;
    let sign = -2; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 2; }
    if (t1 > tmin) { tmin = t1; nAxis = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(dz) < 1e-9) { if (oz < b.min.z || oz > b.max.z) return -1; }
  else {
    let t1 = (b.min.z - oz) / dz, t2 = (b.max.z - oz) / dz;
    let sign = -3; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 3; }
    if (t1 > tmin) { tmin = t1; nAxis = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return { t: tmin, axis: nAxis };
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  _oc.set(cx - ox, cy - oy, cz - oz);
  const t = _oc.x * dx + _oc.y * dy + _oc.z * dz;
  if (t < 0) return -1;
  const d2 = _oc.lengthSq() - t * t;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return t - Math.sqrt(r2 - d2);
}

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign({ bots: 39, shadows: true, mute: false }, opts);
    this.running = false;
    this.paused = false;
    this.over = false;
    this.elapsed = 0;
    this.state = 'menu';

    this.audio = new AudioEngine();
    this.hud = new HUD();
    this._initRenderer();
    this._initInput();

    // real skinned character models (loaded in the background; CharacterRig fallback)
    this.skins = null;
    Skins.load().then((s) => { this.skins = s; }).catch(() => { this.skins = null; });
  }

  /** Returns a character rig: real skinned soldier when available, else procedural. */
  makeRig(id, def) {
    if (this.skins) {
      try { return new SkinnedCharacter(this.skins, def, id); }
      catch (err) { console.warn('[skins] rig failed, falling back:', err && err.message); }
    }
    return new CharacterRig(id, def);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = this.opts.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 2000);
    this.scene.add(this.camera);
    this._raycaster = new THREE.Raycaster();

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // ---------------- Setup match ----------------
  startMatch(botCount) {
    this.disposeMatch();
    this.opts.bots = botCount ?? this.opts.bots;
    this.over = false;
    this.elapsed = 0;

    this.world = new World().build(this.scene, {
      shadows: this.opts.shadows,
      mood: (() => {
        // ?mood=day|dusk forces a lighting mood (handy for screenshots)
        try {
          const m = new URLSearchParams(location.search).get('mood');
          if (m === 'day' || m === 'dusk') return m;
        } catch (err) { /* ignore */ }
        return Math.random() < 0.45 ? 'dusk' : 'day';
      })(),
    });
    this.effects = new Effects(this.scene);
    this.throwables = new ThrowableManager(this.scene);
    this.loot = new LootManager(this.scene);
    this.loot.spawnFromWorld(this.world);
    this.zone = new Zone(this.scene, WORLD_HALF);

    // Real WASM physics (Rapier): ragdolls + debris. Loads async; game runs without it.
    this.physics = null;
    this._physicsToken = (this._physicsToken || 0) + 1;
    const token = this._physicsToken;
    Physics.create(this.world, this.scene).then((p) => {
      if (token !== this._physicsToken) { if (p) p.dispose(); return; }
      this.physics = p;
      if (p) this.hud.toast('Physics online (Rapier WASM)');
    });

    // ray-box list (walls + trees/rocks as boxes) for analytic raycasts
    this.rayBoxes = this.world.boxes.map((b) => b);
    for (const c of this.world.circles) {
      this.rayBoxes.push(new THREE.Box3(
        new THREE.Vector3(c.x - c.r, 0, c.z - c.r),
        new THREE.Vector3(c.x + c.r, 6, c.z + c.r)));
    }

    // player spawn (deploy from the sky)
    const spawn = this._pickSpawn();
    this.player = new Player(this.scene, this.camera, this);
    this.player.position.set(spawn.x, 70, spawn.z);
    this.player.dropping = true;
    this.player.yaw = rand(0, Math.PI * 2);

    // bots
    this.bots = [];
    this.botsAlive = 0;
    for (let i = 0; i < this.opts.bots; i++) {
      let px, pz, tries = 0;
      do {
        px = rand(-WORLD_HALF + 20, WORLD_HALF - 20);
        pz = rand(-WORLD_HALF + 20, WORLD_HALF - 20);
        tries++;
      } while (tries < 30 && (dist2D(px, pz, spawn.x, spawn.z) < 40 || this.world.groundHeightAt(px, pz) > 0));
      const bot = new Bot(this.scene, i, px, pz, { skill: rand(0.35, 0.9), difficulty: rand(0.7, 1.3), game: this });
      this.bots.push(bot);
      this.botsAlive++;
    }
    this.totalPlayers = this.botsAlive + 1;

    // image-based lighting: one shared PMREM environment for the whole match
    if (!this._envTex) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this._envTex = pm.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
      pm.dispose();
    }
    this.scene.environment = this._envTex;
    this.scene.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.isMeshStandardMaterial) {
          m.envMapIntensity = m.userData.envI !== undefined ? m.userData.envI : 0.35;
        }
      }
    });
    this.renderer.toneMappingExposure = this.world.moodCfg.exposure;

    this.deathTimers = [];
    this.hud.setAlive(this.totalPlayers);
    this.hud.setKills(0);
    this.hud.setHealth(100);
    this.hud.setArmor(0);
    this.hud.setStamina(100, 100);
    this.hud.setWeapon(this.player);
    this.hud.setZone(this.zone);
    this.hud.zoneBanner(`DEPLOYED — ${this.totalPlayers} players, one survivor`);
    this.onZonePush(0, PHASES[0], this.zone.nextCenter);

    this.audio.init();
    this.audio.setMuted(this.opts.mute);

    this.state = 'playing';
    this.clock = new THREE.Clock();
    if (!this.running) { this.running = true; this._loop(); }
  }

  _pickSpawn() {
    for (let i = 0; i < 50; i++) {
      const x = rand(-WORLD_HALF + 30, WORLD_HALF - 30);
      const z = rand(-WORLD_HALF + 30, WORLD_HALF - 30);
      if (this.world.groundHeightAt(x, z) === 0) return { x, y: 0, z };
    }
    return { x: 0, y: 0, z: 0 };
  }

  disposeMatch() {
    this._physicsToken = (this._physicsToken || 0) + 1;
    if (this.physics) { this.physics.dispose(); this.physics = null; }
    if (this.world) {
      this.scene.clear();
      this.camera.clear();
      this.scene.add(this.camera);
      this.world = null;
      this.bots = [];
      this.player = null;
    }
  }

  // ---------------- Raycast ----------------
  /** Returns { dist, point, normal, entity, part } */
  /** Ray vs static world only (boxes + ground). Returns { t, normal }. */
  raycastWorld(origin, dir, maxDist) {
    let bestT = maxDist, normal = null;
    for (const b of this.rayBoxes) {
      const r = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, b, bestT);
      if (r && r.t >= 0 && r.t < bestT) {
        bestT = r.t;
        const a = Math.abs(r.axis);
        const sgn = r.axis > 0 ? 1 : -1;
        normal = a === 1 ? new THREE.Vector3(sgn, 0, 0) : a === 2 ? new THREE.Vector3(0, sgn, 0) : new THREE.Vector3(0, 0, sgn);
      }
    }
    if (dir.y < -1e-6) {
      const t = -origin.y / dir.y;
      if (t >= 0 && t < bestT) { bestT = t; normal = new THREE.Vector3(0, 1, 0); }
    }
    return { t: bestT, normal };
  }

  raycast(origin, dir, maxDist, excludeBot, excludePlayer) {
    const w = this.raycastWorld(origin, dir, maxDist);
    let bestT = w.t, normal = w.normal;
    const d = dir;

    let entity = null, part = null;
    const testEntity = (e) => {
      if (!e || !e.alive || e === excludeBot) return;
      const parts = e.isPlayer ? [
        { name: 'head', off: { x: 0, y: e.eye, z: 0 }, r: 0.24 },
        { name: 'body', off: { x: 0, y: 1.0, z: 0 }, r: 0.42 },
        { name: 'legs', off: { x: 0, y: 0.42, z: 0 }, r: 0.38 },
      ] : e.hitParts;
      for (const p of parts) {
        const cx = e.position.x + p.off.x, cy = e.position.y + p.off.y, cz = e.position.z + p.off.z;
        const t = raySphere(origin.x, origin.y, origin.z, d.x, d.y, d.z, cx, cy, cz, p.r);
        if (t >= 0 && t < bestT) { bestT = t; entity = e; part = p.name; normal = null; }
      }
    };
    if (!excludePlayer && this.player) testEntity(this.player);
    for (const b of this.bots) testEntity(b);

    const point = new THREE.Vector3(origin.x + d.x * bestT, origin.y + d.y * bestT, origin.z + d.z * bestT);
    return { dist: bestT, point, normal, entity, part, bot: entity && !entity.isPlayer ? entity : null };
  }

  // ---------------- Callbacks ----------------
  onHitMarker(type, killed) {
    this.hud.hitmark(type);
    this.audio.hitmarker(type === 'head');
  }
  spawnDamageNumber(point, amount, kind = 'hit') {
    if (!point || !this.camera) return;
    const v = point.clone().project(this.camera);
    if (v.z < -1 || v.z > 1) return;
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    this.hud.damageNumber((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, amount, kind);
  }
  onPlayerHitBy(bot, dmg, part) {
    // directional feedback handled in player.takeDamage
  }
  onBotKilled(killer, victim, point) {
    // victim already has alive=false; make ragdoll shoot blood
    this.effects.blood(point || victim.position.clone().setY(victim.position.y + 1.1));
    const killerName = killer ? (killer.isPlayer ? 'You' : killer.name) : 'The Storm';
    const wName = killer && killer.weapon ? killer.weapon.def.name : (killer && killer.def ? killer.def.name : 'STORM');
    const involved = killer === this.player || victim === this.player;
    this.hud.addKill(killerName, victim.isPlayer ? 'You' : victim.name, wName, involved);
    if (killer === this.player) {
      this.player.kills++;
      this.hud.setKills(this.player.kills);
      this.audio.kill();
    }
    this._recountAlive();
    if (victim.isPlayer) { /* handled elsewhere */ }
  }

  onPlayerDeath(killer) {
    if (this.over) return;
    this.over = true;
    this.state = 'over';
    const place = this.botsAlive + 1;
    this.hud.addKill(killer ? killer.name : 'The Storm', 'You', killer && killer.def ? killer.def.name : 'STORM', true);
    setTimeout(() => this.endMatch(false, place), 1400);
  }

  _recountAlive() {
    this.botsAlive = this.bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
    const alive = this.botsAlive + (this.player.alive ? 1 : 0);
    this.hud.setAlive(alive);
    if (this.player.alive && this.botsAlive === 0 && !this.over) {
      this.over = true;
      this.state = 'over';
      setTimeout(() => this.endMatch(true, 1), 900);
    }
  }

  endMatch(victory, place) {
    this.state = 'ended';
    window.dispatchEvent(new CustomEvent('match-end', { detail: {
      victory, place, kills: this.player.kills, damage: Math.round(this.player.damageDealt),
      time: formatTime(this.elapsed), total: this.totalPlayers,
    } }));
  }

  // ---------------- Zone callbacks ----------------
  onZonePush(phase, p, center) {
    this.hud.zoneBanner(`Zone closing — Phase ${phase + 1}`, '#b57edc');
    this.audio.alarm();
  }
  onZoneShrinkStart() { this.hud.zoneBanner('THE STORM IS MOVING', '#d9b0f0'); }
  onZoneShrunk(phase, dmg) {}

  // ---------------- Input ----------------
  _initInput() {
    this.keys = {};
    this.mouseDX = 0; this.mouseDY = 0;
    this.leftMouse = false; this.rightMouse = false; this.mouseDown = false;
    this.locked = false;
    this.sensitivity = 0.0022;

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Escape') window.dispatchEvent(new Event('request-pause'));
      if (e.code === 'KeyV' && this.state === 'playing' && this.player && !e.repeat) {
        this.player.toggleThirdPerson();
        this.hud.toast(this.player.thirdPerson ? 'Third person (V)' : 'First person (V)');
      }
      if (e.code === 'Tab') e.preventDefault();
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    addEventListener('mousemove', (e) => {
      if (this.locked && this.state === 'playing') { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state === 'playing') {
        if (e.button === 0) { this.leftMouse = true; this.mouseDown = true; }
        if (e.button === 2) this.rightMouse = true;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.leftMouse = false; this.mouseDown = false; }
      if (e.button === 2) this.rightMouse = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.state === 'playing' && !this.paused) {
        window.dispatchEvent(new Event('request-pause'));
      }
    });
  }

  lockPointer() {
    if (this.state === 'playing') this.canvas.requestPointerLock();
  }

  buildInput() {
    const k = this.keys;
    return {
      moveX: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      moveZ: (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0),
      keyShift: !!k.ShiftLeft || !!k.ShiftRight,
      keySpace: !!k.Space,
      keyC: !!k.KeyC || !!k.ControlLeft,
      leftMouse: this.leftMouse,
      rightMouse: this.rightMouse,
      mouseDown: this.mouseDown,
      mouseDX: this.mouseDX,
      mouseDY: this.mouseDY,
      sensitivity: this.sensitivity,
    };
  }

  // ---------------- Main loop ----------------
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock ? this.clock.getDelta() : 0.016, 0.05);
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    if (!this.scene) return;
    if (this.state !== 'playing') return;
    this.effects && this.effects.update(dt);

    this.elapsed += dt;
    const input = this.buildInput();
    if (!this.locked) { input.mouseDX = 0; input.mouseDY = 0; }

    // player
    this.player.update(dt, input);
    this.mouseDX = 0; this.mouseDY = 0;

    // bots
    for (const b of this.bots) b.update(dt, this);

    // clean up long-dead bots
    for (let i = this.bots.length - 1; i >= 0; i--) {
      const b = this.bots[i];
      if (!b.alive && b.deadTime > 12) { b.dispose(); this.bots.splice(i, 1); }
    }

    // loot proximity / prompt / pickup
    const near = this.loot.nearest(this.player.position, 3.4);
    if (near && this.player.alive) {
      const label = this._lootLabel(near);
      this.hud.setPrompt(label);
      if (this.keys.KeyF && !this._fLatch) { this.player.pickup(near); this._fLatch = true; }
    } else {
      this.hud.setPrompt(null);
    }
    if (!this.keys.KeyF) this._fLatch = false;

    // H -> use medkit (heals 50 over channel)
    if (this.keys.KeyH && !this._hLatch && !this.player.healing) {
      if (this.player.useMedkit()) this.hud.toast('Using medkit…');
      this._hLatch = true;
    }
    if (!this.keys.KeyH) this._hLatch = false;

    // G -> throw frag grenade
    if (this.keys.KeyG && !this._gLatch) {
      this.player.throwGrenade();
      this._gLatch = true;
    }
    if (!this.keys.KeyG) this._gLatch = false;

    // Tab -> backpack
    this.invOpen = !!this.keys.Tab;

    // weapon switching
    for (let i = 1; i <= 3; i++) {
      if (this.keys['Digit' + i] && !this['_d' + i]) { this.player.selectSlot(i - 1); this['_d' + i] = true; }
      if (!this.keys['Digit' + i]) this['_d' + i] = false;
    }
    if (this.keys.KeyR && !this._rLatch) { this.player.startReload(); this._rLatch = true; }
    if (!this.keys.KeyR) this._rLatch = false;

    // world systems
    this.loot.update(dt, this.elapsed, this.camera);
    this.throwables.update(dt, this);
    this.zone.update(dt, this);
    if (this.physics) this.physics.step(dt);

    // sun shadow follow
    if (this.world.sun) {
      this.world.sun.position.set(this.player.position.x + 120, 220, this.player.position.z + 80);
      this.world.sun.target.position.copy(this.player.position);
      this.world.sun.target.updateMatrixWorld();
    }

    // HUD
    this.hud.setHealth(this.player.health);
    this.hud.setArmor(this.player.armor);
    this.hud.setStamina(this.player.stamina, this.player.maxStamina);
    this.hud.setWeapon(this.player);
    this.hud.setZone(this.zone);
    const w = this.player.weapon;
    const spread = w ? w.def.spread * (this.player.ads ? 0.4 : (this.player.sprinting ? 1.6 : 1)) * (this.player.velocity.lengthSq() > 1 ? 1.4 : 1) : 0;
    this.hud.setCrosshair(spread, this.player.ads, this.player.sprinting);
    this.hud.setScope(this.player.ads && w && !!(w.def.box && w.def.box.scope));
    this.hud.setUtility(this.player);
    this.hud.setBackpack(this.player, !!this.invOpen);
    this.hud.update(dt, this);
  }

  _lootLabel(item) {
    if (item.type === 'weapon') return `Pick up ${item.data.id.toUpperCase()}`;
    if (item.type === 'ammo') return `Pick up ammo (${item.data.ammoType})`;
    if (item.type === 'armor') return `Equip armor +${item.data.value}`;
    if (item.type === 'grenade') return `Pick up frag grenade`;
    if (item.type === 'attachment') return `Pick up ${item.data.kind === 'extmag' ? 'extended mag' : 'compensator'}`;
    return `Pick up medkit`;
  }

  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') { this.state = 'playing'; this.lockPointer(); } }
}
