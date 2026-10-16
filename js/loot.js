import * as THREE from 'three';
import { rand, randInt, choice, chance, dist2D } from './utils.js';
import { WEAPONS, AMMO_MAX } from './weapons.js';

const COLORS = {
  weapon: 0xff9800,
  ammo: 0xffd54f,
  armor: 0x29b6f6,
  health: 0x66bb6a,
  grenade: 0x8bc34a,
  attachment: 0xba68c8,
};

const WEAPON_IDS = ['pistol', 'vector', 'smg', 'rifle', 'shotgun', 'dmr', 'sniper', 'lmg'];
const WEAPON_WEIGHTS = { pistol: 16, vector: 14, smg: 22, rifle: 24, shotgun: 13, dmr: 11, sniper: 9, lmg: 7 };

function weightedWeapon() {
  let total = 0; for (const k in WEAPON_WEIGHTS) total += WEAPON_WEIGHTS[k];
  let r = Math.random() * total;
  for (const k in WEAPON_WEIGHTS) { r -= WEAPON_WEIGHTS[k]; if (r <= 0) return k; }
  return 'rifle';
}

function makeLabelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.roundRect(6, 10, 244, 44, 10); ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 30px Segoe UI, Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class Loot {
  constructor(type, data, x, z, y = 0) {
    this.type = type;
    this.data = data;
    this.position = new THREE.Vector3(x, y, z);
    this.taken = false;
    this.bob = Math.random() * Math.PI * 2;
  }

  build() {
    const g = new THREE.Group();
    const color = COLORS[this.type];
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.3 });
    let core;
    if (this.type === 'weapon') core = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.16), mat);
    else if (this.type === 'ammo') core = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.22), mat);
    else if (this.type === 'armor') core = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), mat);
    else if (this.type === 'grenade') core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 10), mat);
    else if (this.type === 'attachment') core = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.12), mat);
    else core = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), mat);
    core.position.y = 0.55;
    g.add(core);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);

    // label
    let text = '';
    if (this.type === 'weapon') text = WEAPONS[this.data.id].name;
    else if (this.type === 'ammo') text = `${this.data.amount} Ammo`;
    else if (this.type === 'armor') text = `Armor ${this.data.value}`;
    else if (this.type === 'grenade') text = `Frag x${this.data.amount}`;
    else if (this.type === 'attachment') text = this.data.kind === 'extmag' ? 'Extended Mag' : 'Compensator';
    else text = `Medkit +${this.data.heal}`;
    const sprMat = new THREE.SpriteMaterial({ map: makeLabelTexture(text, '#' + new THREE.Color(color).getHexString()), transparent: true, depthTest: true, depthWrite: false });
    const spr = new THREE.Sprite(sprMat);
    spr.scale.set(1.6, 0.4, 1);
    spr.position.y = 1.1;
    g.add(spr);
    this.spr = spr;

    this.mesh = g;
    this.core = core;
    g.position.copy(this.position);
    g.position.y = this.position.y;
    return g;
  }

  update(dt, t, camera) {
    if (!this.mesh) return;
    this.bob += dt * 2;
    this.core.rotation.y += dt * 1.5;
    this.mesh.position.y = this.position.y + Math.sin(this.bob) * 0.08;
    if (this.spr && camera) {
      const d = camera.position.distanceTo(this.mesh.position);
      const vis = d < 42;
      this.spr.visible = vis;
      if (vis) {
        this.spr.material.opacity = Math.min(1, Math.max(0, (42 - d) / 10));
        const sc = 0.85 + Math.min(d, 42) * 0.02;
        this.spr.scale.set(1.6 * sc, 0.4 * sc, 1);
      }
    }
  }
}

export class LootManager {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  spawnFromWorld(world) {
    for (const spot of world.lootSpawns) {
      if (chance(0.85)) this.spawnAt(spot.x, spot.z, spot.y || 0, 'weapon');
      if (chance(0.6)) this.spawnAt(spot.x + rand(-1, 1), spot.z + rand(-1, 1), spot.y || 0, 'ammo');
      if (chance(0.35)) this.spawnAt(spot.x + rand(-1, 1), spot.z + rand(-1, 1), spot.y || 0, 'armor');
      if (chance(0.5)) this.spawnAt(spot.x + rand(-1, 1), spot.z + rand(-1, 1), spot.y || 0, 'health');
      if (chance(0.22)) this.spawnAt(spot.x + rand(-1, 1), spot.z + rand(-1, 1), spot.y || 0, 'grenade');
      if (chance(0.12)) this.spawnAt(spot.x + rand(-1, 1), spot.z + rand(-1, 1), spot.y || 0, 'attachment');
    }
    // scattered wild loot
    for (let i = 0; i < 90; i++) {
      const x = rand(-290, 290);
      const z = rand(-290, 290);
      const t = choice(['weapon', 'ammo', 'ammo', 'armor', 'health', 'health', 'grenade', 'attachment']);
      this.spawnAt(x, z, 0, t);
    }
  }

  spawnAt(x, z, y, type) {
    let data;
    if (type === 'weapon') data = { id: weightedWeapon() };
    else if (type === 'ammo') {
      const id = choice(WEAPON_IDS);
      const at = WEAPONS[id].ammoType;
      const amt = { light: 30, heavy: 30, shell: 8, sniper: 5 }[at];
      data = { ammoType: at, amount: amt };
    } else if (type === 'armor') data = { value: choice([30, 50, 50, 75]) };
    else if (type === 'grenade') data = { amount: choice([1, 1, 2]) };
    else if (type === 'attachment') data = { kind: choice(['extmag', 'grip']) };
    else data = { heal: choice([30, 50]) };

    const item = new Loot(type, data, x, z, y);
    const mesh = item.build();
    this.group.add(mesh);
    this.items.push(item);
    return item;
  }

  update(dt, t, camera) {
    for (const it of this.items) if (!it.taken) it.update(dt, t, camera);
  }

  nearest(pos, maxDist = 3.2) {
    let best = null, bd = maxDist;
    for (const it of this.items) {
      if (it.taken) continue;
      const d = dist2D(pos.x, pos.z, it.position.x, it.position.z);
      const dy = Math.abs(pos.y - it.position.y);
      if (d < bd && dy < 2.5) { bd = d; best = it; }
    }
    return best;
  }

  take(item) {
    item.taken = true;
    this.group.remove(item.mesh);
    item.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }
}
