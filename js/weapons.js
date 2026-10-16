import * as THREE from 'three';

/**
 * Weapon definitions. Damage is per-bullet (shotgun uses pellets).
 * ammoType groups reserve ammo: light, heavy, shell, sniper.
 */
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P92', type: 'pistol', ammoType: 'light',
    damage: 26, headMult: 2.4, rpm: 400, magSize: 15, reloadTime: 1.7,
    spread: 0.012, recoil: 0.9, pellets: 1, auto: false, range: 220, speed: 400,
    box: { bar: 0.34, body: [0.09, 0.14, 0.34], color: 0x2b2b2b }, adsFov: 55,
  },
  smg: {
    id: 'smg', name: 'UMP45', type: 'smg', ammoType: 'light',
    damage: 21, headMult: 2.0, rpm: 620, magSize: 30, reloadTime: 2.2,
    spread: 0.022, recoil: 0.7, pellets: 1, auto: true, range: 180, speed: 420,
    box: { bar: 0.3, body: [0.1, 0.16, 0.42], color: 0x3a3f47, stock: true }, adsFov: 52,
  },
  rifle: {
    id: 'rifle', name: 'M416', type: 'rifle', ammoType: 'heavy',
    damage: 33, headMult: 2.2, rpm: 660, magSize: 30, reloadTime: 2.3,
    spread: 0.015, recoil: 1.1, pellets: 1, auto: true, range: 300, speed: 520,
    box: { bar: 0.46, body: [0.1, 0.17, 0.5], color: 0x33372e, stock: true, scope: true }, adsFov: 48,
  },
  shotgun: {
    id: 'shotgun', name: 'S686', type: 'shotgun', ammoType: 'shell',
    damage: 20, headMult: 1.5, rpm: 160, magSize: 2, reloadTime: 2.6,
    spread: 0.06, recoil: 2.2, pellets: 9, auto: false, range: 60, speed: 380,
    box: { bar: 0.5, body: [0.11, 0.15, 0.5], color: 0x4a3324, stock: true }, adsFov: 58,
  },
  sniper: {
    id: 'sniper', name: 'KAR98K', type: 'sniper', ammoType: 'sniper',
    damage: 82, headMult: 2.6, rpm: 50, magSize: 5, reloadTime: 3.4,
    spread: 0.002, recoil: 3.2, pellets: 1, auto: false, range: 600, speed: 900,
    box: { bar: 0.72, body: [0.1, 0.16, 0.62], color: 0x402f22, stock: true, scope: true, long: true }, adsFov: 20,
  },
  lmg: {
    id: 'lmg', name: 'M249', type: 'lmg', ammoType: 'heavy',
    damage: 35, headMult: 2.0, rpm: 720, magSize: 75, reloadTime: 4.6,
    spread: 0.03, recoil: 1.4, pellets: 1, auto: true, range: 280, speed: 500,
    box: { bar: 0.5, body: [0.13, 0.19, 0.55], color: 0x2f3238, stock: true, drum: true }, adsFov: 50,
  },
  vector: {
    id: 'vector', name: 'Vector', type: 'smg', ammoType: 'light',
    damage: 18, headMult: 1.9, rpm: 1100, magSize: 33, reloadTime: 1.9,
    spread: 0.026, recoil: 0.5, pellets: 1, auto: true, range: 150, speed: 420,
    box: { bar: 0.22, body: [0.09, 0.15, 0.36], color: 0x2a2f36, stock: true }, adsFov: 56,
  },
  dmr: {
    id: 'dmr', name: 'SLR', type: 'dmr', ammoType: 'sniper',
    damage: 54, headMult: 2.5, rpm: 130, magSize: 10, reloadTime: 2.8,
    spread: 0.004, recoil: 1.9, pellets: 1, auto: false, range: 460, speed: 820,
    box: { bar: 0.6, body: [0.1, 0.16, 0.58], color: 0x3b3025, stock: true, scope: true, long: true }, adsFov: 32,
  },
};

/** Weapons a bot may spawn with, grouped by rough power tier. */
export const WEAPON_TIER = {
  pistol: 1, vector: 2, smg: 2, shotgun: 2, rifle: 3, dmr: 3, lmg: 3, sniper: 4,
};

export const AMMO_MAX = { light: 180, heavy: 180, shell: 60, sniper: 40 };
export const AMMO_LABEL = { light: '9mm', heavy: '5.56', shell: '12g', sniper: '7.62' };

/** Loot beam / label colors per weapon power tier (COD-style rarity). */
export const TIER_GLOW = { 1: 0x9e9e9e, 2: 0x4aa3ff, 3: 0xb06cff, 4: 0xffc44d };

/** Build a simple but recognizable first-person weapon model. */
export function buildViewModel(def) {
  const g = new THREE.Group();
  const c = def.box || {};
  const mat = new THREE.MeshStandardMaterial({ color: c.color || 0x2b2b2b, roughness: 0.6, metalness: 0.5, envMapIntensity: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.4, envMapIntensity: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(c.body[0], c.body[1], c.body[2]), mat);
  g.add(body);
  let zEnd = c.body[2] / 2;

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, c.bar, 8), darkMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, zEnd + c.bar / 2 - 0.05);
  g.add(barrel);

  // grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), darkMat);
  grip.position.set(0, -0.13, -0.05);
  grip.rotation.x = -0.2;
  g.add(grip);

  if (c.stock) {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.22), mat);
    stock.position.set(0, -0.02, -c.body[2] / 2 - 0.08);
    g.add(stock);
  }
  if (c.scope) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, c.long ? 0.34 : 0.22, 10), darkMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.13, c.long ? 0.05 : -0.02);
    g.add(scope);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff }));
    lens.position.set(0, 0.13, (c.long ? 0.05 : -0.02) + (c.long ? 0.17 : 0.11));
    g.add(lens);
  }
  if (c.drum) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12), darkMat);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.12, 0.1);
    g.add(drum);
  } else if (def.type !== 'pistol') {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.09), darkMat);
    mag.position.set(0, -0.16, 0.05);
    g.add(mag);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  return g;
}
