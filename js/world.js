import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, randInt, choice, clamp, dist2D } from './utils.js';

export const WORLD_HALF = 300;
const EYE_HEIGHT = 1.6;

function mergeBoxes(specs) {
  if (specs.length === 0) return null;
  const geos = specs.map((s) => {
    const g = new THREE.BoxGeometry(s.sx, s.sy, s.sz);
    g.translate(s.cx, s.cy, s.cz);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, '#3d5a30');
  g.addColorStop(0.5, '#486a37');
  g.addColorStop(1, '#37502c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  // broad dirt patches
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024, r = 40 + Math.random() * 130;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(96,80,50,0.35)');
    grad.addColorStop(1, 'rgba(96,80,50,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // fine grass noise
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024;
    const n = Math.random();
    if (n < 0.5) ctx.fillStyle = `rgba(28,46,24,${Math.random() * 0.35})`;
    else if (n < 0.8) ctx.fillStyle = `rgba(120,140,74,${Math.random() * 0.28})`;
    else ctx.fillStyle = `rgba(80,64,40,${Math.random() * 0.22})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#2f6fb0');
  g.addColorStop(0.42, '#6fa5cc');
  g.addColorStop(0.62, '#a9c6da');
  g.addColorStop(0.78, '#d3d3c4');
  g.addColorStop(1.0, '#c6bba0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // soft clouds in the upper band
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 1024, y = Math.random() * 300;
    const r = 24 + Math.random() * 90;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + Math.random() * 0.14;
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialTex(color, hard = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (hard) { g.addColorStop(0, color); g.addColorStop(0.45, color); g.addColorStop(1, 'rgba(0,0,0,0)'); }
  else { g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class World {
  constructor() {
    this.boxes = [];           // THREE.Box3 colliders (walls, roofs, crates)
    this.circles = [];         // { x, z, r } cylinder colliders (trees, rocks)
    this.solids = [];          // meshes for bullet raycasts
    this.lootSpawns = [];      // { x, z, y }
    this.group = new THREE.Group();
    this.pois = [];
  }

  build(scene, opts = {}) {
    const { shadows = true } = opts;
    scene.add(this.group);

    // ---- Sky dome (procedural gradient + clouds) ----
    const skyGeo = new THREE.SphereGeometry(1400, 48, 24);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1000;
    scene.add(sky);
    this.sky = sky;

    // ---- Sun disc + glow sprite ----
    const sunDir = new THREE.Vector3(0.5, 0.72, 0.36).normalize();
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTex('rgba(255,246,214,0.95)'), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, opacity: 0.9,
    }));
    sunSprite.scale.setScalar(320);
    sunSprite.position.copy(sunDir).multiplyScalar(1150);
    scene.add(sunSprite);

    scene.fog = new THREE.FogExp2(0xaab8c4, 0.0011);
    scene.background = new THREE.Color(0x8ba6bd);

    // ---- Lights ----
    const hemi = new THREE.HemisphereLight(0x9ec6ff, 0x4b5438, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe6bd, 2.1);
    sun.position.copy(sunDir).multiplyScalar(300);
    sun.castShadow = shadows;
    if (shadows) {
      sun.shadow.mapSize.set(2048, 2048);
      const d = 130;
      sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
      sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 900;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.35;
    }
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // ---- Ground ----
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2 + 1600, WORLD_HALF * 2 + 1600, 1, 1), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    scene.add(ground);
    this.solids.push(ground);
    this.ground = ground;

    // ---- Invisible boundary walls ----
    const H = WORLD_HALF;
    const bounds = [
      { cx: 0, cz: H, sx: H * 2, sz: 2 }, { cx: 0, cz: -H, sx: H * 2, sz: 2 },
      { cx: H, cz: 0, sx: 2, sz: H * 2 }, { cx: -H, cz: 0, sx: 2, sz: H * 2 },
    ];
    for (const b of bounds) this.boxes.push(new THREE.Box3(
      new THREE.Vector3(b.cx - b.sx / 2, 0, b.cz - b.sz / 2),
      new THREE.Vector3(b.cx + b.sx / 2, 60, b.cz + b.sz / 2)));

    // ---- Roads (decorative grid) ----
    this._buildRoads(scene, shadows);

    // ---- Water ----
    this._buildWater(scene, shadows);

    // ---- Buildings / POIs ----
    this._buildSettlements(scene, shadows);

    // ---- Trees ----
    this._buildTrees(scene, shadows);

    // ---- Rocks & crates ----
    this._buildProps(scene, shadows);

    return this;
  }

  _addBoxCollider(cx, cy, cz, sx, sy, sz) {
    this.boxes.push(new THREE.Box3(
      new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2)));
  }

  _buildRoads(scene, shadows) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b3b38, roughness: 0.95 });
    const geos = [];
    for (let i = -1; i <= 1; i++) {
      const off = i * 150;
      let g = new THREE.BoxGeometry(WORLD_HALF * 2, 0.1, 10); g.translate(0, 0.05, off); geos.push(g);
      g = new THREE.BoxGeometry(10, 0.1, WORLD_HALF * 2); g.translate(off, 0.05, 0); geos.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.receiveShadow = shadows;
    scene.add(mesh);
    geos.forEach((g) => g.dispose());
  }

  _buildWater(scene, shadows) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x245a72, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.9,
      envMapIntensity: 1.4,
    });
    this.waters = [];
    const lakes = [
      { x: -560, z: 430, rx: 210, rz: 150 },
      { x: 620, z: -520, rx: 170, rz: 200 },
      { x: 40, z: 690, rx: 240, rz: 130 },
    ];
    for (const l of lakes) {
      const geo = new THREE.CircleGeometry(1, 48);
      const water = new THREE.Mesh(geo, mat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(l.x, 0.05, l.z);
      water.scale.set(l.rx, l.rz, 1);
      water.receiveShadow = false;
      scene.add(water);
      this.waters.push({ ...l, mesh: water });
    }
  }

  _buildSettlements(scene, shadows) {
    const wallSpecs = [];
    const roofSpecs = [];
    const metalSpecs = [];
    const windowSpecs = [];
    const occupied = [];
    const spots = [];

    // scatter POI centers
    const clusterCenters = [];
    for (let i = 0; i < 14; i++) {
      let x, z, tries = 0;
      do {
        x = rand(-WORLD_HALF + 60, WORLD_HALF - 60);
        z = rand(-WORLD_HALF + 60, WORLD_HALF - 60);
        tries++;
      } while (tries < 30 && clusterCenters.some((c) => dist2D(c.x, c.z, x, z) < 90));
      clusterCenters.push({ x, z });
    }
    this.pois = clusterCenters.map((c, i) => ({ name: `Sector ${String.fromCharCode(65 + i)}`, x: c.x, z: c.z }));

    for (const cc of clusterCenters) {
      const n = randInt(3, 6);
      for (let k = 0; k < n; k++) {
        let x, z, ok = false, tries = 0;
        while (!ok && tries < 40) {
          x = cc.x + rand(-45, 45);
          z = cc.z + rand(-45, 45);
          tries++;
          ok = !occupied.some((o) => dist2D(o.x, o.z, x, z) < o.r + 14);
        }
        if (!ok) continue;
        const w = rand(7, 15), d = rand(7, 15), h = rand(3.2, 5.2), t = 0.55;
        occupied.push({ x, z, r: Math.max(w, d) / 2 });
        this._makeBuilding(x, z, w, d, h, t, wallSpecs, roofSpecs, metalSpecs, spots);
        this._windows(windowSpecs, x, z, w, d, h, t);
      }
    }

    // a couple of tall towers with accessible rooftops via crate stacks
    for (let i = 0; i < 4; i++) {
      const cc = choice(clusterCenters);
      const x = cc.x + rand(-30, 30), z = cc.z + rand(-30, 30);
      this._makeTower(x, z, wallSpecs, roofSpecs, metalSpecs, spots);
    }

    // large two-level warehouses (enterable, with mezzanine ramp)
    for (let i = 0; i < 3; i++) {
      const cc = choice(clusterCenters);
      const x = cc.x + rand(-40, 40), z = cc.z + rand(-40, 40);
      if (clusterCenters.every((other) => dist2D(other.x, other.z, x, z) > 6)) {
        this._makeWarehouse(x, z, wallSpecs, roofSpecs, metalSpecs, spots);
        this._windows(windowSpecs, x, z, 16, 22, 6.2, 0.6);
      }
    }

    const wallGeo = mergeBoxes(wallSpecs);
    if (wallGeo) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xcac3b2, roughness: 0.9, metalness: 0.02 });
      const mesh = new THREE.Mesh(wallGeo, mat);
      mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      scene.add(mesh); this.solids.push(mesh);
    }
    const roofGeo = mergeBoxes(roofSpecs);
    if (roofGeo) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 0.85 });
      const mesh = new THREE.Mesh(roofGeo, mat);
      mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      scene.add(mesh); this.solids.push(mesh);
    }
    const metalGeo = mergeBoxes(metalSpecs);
    if (metalGeo) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a6472, roughness: 0.5, metalness: 0.6 });
      const mesh = new THREE.Mesh(metalGeo, mat);
      mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      scene.add(mesh); this.solids.push(mesh);
    }
    const winGeo = mergeBoxes(windowSpecs);
    if (winGeo) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.12, metalness: 0.55 });
      const mesh = new THREE.Mesh(winGeo, mat);
      mesh.castShadow = false; mesh.receiveShadow = false;
      scene.add(mesh); this.solids.push(mesh);
    }

    // Register colliders + loot spawns
    // (colliders were pushed directly during build via _addBoxCollider)
    for (const s of spots) this.lootSpawns.push(s);
  }

  _windows(specs, x, z, w, d, h, t) {
    const y = h * 0.62, wh = 1.0, ww = 1.1, off = t / 2 + 0.02;
    const hw = w / 2, hd = d / 2;
    const nx = Math.max(1, Math.round(w / 3.2) - 1);
    const nz = Math.max(1, Math.round(d / 3.2) - 1);
    for (let i = 0; i < nx; i++) {
      const px = x - hw + (w / (nx + 1)) * (i + 1);
      specs.push({ cx: px, cy: y, cz: z - hd - off, sx: ww, sy: wh, sz: 0.07 });
      specs.push({ cx: px, cy: y, cz: z + hd + off, sx: ww, sy: wh, sz: 0.07 });
    }
    for (let i = 0; i < nz; i++) {
      const pz = z - hd + (d / (nz + 1)) * (i + 1);
      specs.push({ cx: x - hw - off, cy: y, cz: pz, sx: 0.07, sy: wh, sz: ww });
      specs.push({ cx: x + hw + off, cy: y, cz: pz, sx: 0.07, sy: wh, sz: ww });
    }
  }

  _makeBuilding(x, z, w, d, h, t, wallSpecs, roofSpecs, metalSpecs, spots) {
    const hw = w / 2, hd = d / 2;
    const doorW = 2.2;
    const wallY = h / 2;

    const pushWall = (cx, cz, sx, sz) => {
      wallSpecs.push({ cx, cy: wallY, cz, sx, sy: h, sz });
      this._addBoxCollider(cx, wallY, cz, sx, h, sz);
    };
    // back wall (full)
    pushWall(x, z - hd, w, t);
    // left / right full
    pushWall(x - hw, z, t, d);
    pushWall(x + hw, z, t, d);
    // front wall with door gap
    const seg = (w - doorW) / 2;
    if (seg > 0.2) {
      const dz = z + hd;
      pushWall(x - (doorW / 2 + seg / 2), dz, seg, t);
      pushWall(x + (doorW / 2 + seg / 2), dz, seg, t);
      // lintel above door
      wallSpecs.push({ cx: x, cy: h - 0.6, cz: dz, sx: doorW, sy: 1.2, sz: t });
      this._addBoxCollider(x, h - 0.6, dz, doorW, 1.2, t);
    } else {
      pushWall(x, z + hd, w, t);
    }

    // optional interior divider
    if (Math.random() < 0.6) {
      const seg2 = (d - doorW) / 2;
      const ix = x + rand(-hw * 0.3, hw * 0.3);
      if (seg2 > 0.3) {
        wallSpecs.push({ cx: ix, cy: wallY, cz: z - (doorW / 2 + seg2 / 2), sx: t, sy: h, sz: seg2 });
        wallSpecs.push({ cx: ix, cy: wallY, cz: z + (doorW / 2 + seg2 / 2), sx: t, sy: h, sz: seg2 });
        this._addBoxCollider(ix, wallY, z - (doorW / 2 + seg2 / 2), t, h, seg2);
        this._addBoxCollider(ix, wallY, z + (doorW / 2 + seg2 / 2), t, h, seg2);
      }
    }

    // roof (sometimes open)
    if (Math.random() < 0.75) {
      roofSpecs.push({ cx: x, cy: h + 0.15, cz: z, sx: w + 0.4, sy: 0.3, sz: d + 0.4 });
      this._addBoxCollider(x, h + 0.15, z, w + 0.4, 0.3, d + 0.4);
    }

    // loot inside + by the door
    const lootCount = randInt(1, 3);
    for (let i = 0; i < lootCount; i++) {
      spots.push({ x: x + rand(-hw + 1, hw - 1), z: z + rand(-hd + 1, hd - 1), y: 0 });
    }
    if (Math.random() < 0.5) spots.push({ x: x + rand(-hw, hw), z: z + hd + rand(1.5, 4), y: 0 });

    // crate stack for cover/jumping
    if (Math.random() < 0.5) {
      const cx = x + rand(-hw - 4, hw + 4), cz = z + rand(-hd - 4, hd + 4);
      if (dist2D(cx, cz, x, z) > Math.max(hw, hd) + 1.5) {
        const cnt = randInt(1, 3);
        for (let i = 0; i < cnt; i++) {
          metalSpecs.push({ cx: cx, cy: 0.6 + i * 1.2, cz: cz, sx: 1.2, sy: 1.2, sz: 1.2 });
          this._addBoxCollider(cx, 0.6 + i * 1.2, cz, 1.2, 1.2, 1.2);
        }
        spots.push({ x: cx, z: cz, y: cnt * 1.2 });
      }
    }
  }

  _makeTower(x, z, wallSpecs, roofSpecs, metalSpecs, spots) {
    const w = 8, d = 8, h = 9, t = 0.6;
    const hw = w / 2, hd = d / 2;
    const doorW = 2.4;
    wallSpecs.push({ cx: x, cy: h / 2, cz: z - hd, sx: w, sy: h, sz: t });
    this._addBoxCollider(x, h / 2, z - hd, w, h, t);
    wallSpecs.push({ cx: x - hw, cy: h / 2, cz: z, sx: t, sy: h, sz: d });
    this._addBoxCollider(x - hw, h / 2, z, t, h, d);
    wallSpecs.push({ cx: x + hw, cy: h / 2, cz: z, sx: t, sy: h, sz: d });
    this._addBoxCollider(x + hw, h / 2, z, t, h, d);
    const seg = (w - doorW) / 2;
    const dz = z + hd;
    wallSpecs.push({ cx: x - (doorW / 2 + seg / 2), cy: h / 2, cz: dz, sx: seg, sy: h, sz: t });
    wallSpecs.push({ cx: x + (doorW / 2 + seg / 2), cy: h / 2, cz: dz, sx: seg, sy: h, sz: t });
    this._addBoxCollider(x - (doorW / 2 + seg / 2), h / 2, dz, seg, h, t);
    this._addBoxCollider(x + (doorW / 2 + seg / 2), h / 2, dz, seg, h, t);
    // roof platform (climb via external crate stairs)
    roofSpecs.push({ cx: x, cy: h + 0.2, cz: z, sx: w + 1, sy: 0.4, sz: d + 1 });
    this._addBoxCollider(x, h + 0.2, z, w + 1, 0.4, d + 1);

    // external crate stair up to roof
    let step = 0;
    for (let yy = 1.2; yy < h + 0.4; yy += 1.2) {
      const sx = x + hw + 2 + step * 1.0;
      metalSpecs.push({ cx: sx, cy: yy, cz: z, sx: 1.4, sy: 1.2, sz: 1.4 });
      this._addBoxCollider(sx, yy, z, 1.4, 1.2, 1.4);
      step++;
    }
    spots.push({ x, z, y: h + 0.4 });
    spots.push({ x: x + rand(-3, 3), z: z + rand(-3, 3), y: 0 });
  }

  /** Large two-level warehouse: open interior, mezzanine reachable by a stepped ramp. */
  _makeWarehouse(x, z, wallSpecs, roofSpecs, metalSpecs, spots) {
    const w = 16, d = 22, h = 6.2, t = 0.6, hw = w / 2, hd = d / 2;
    const doorW = 3.4;
    const push = (cx, cy, cz, sx, sy, sz) => { wallSpecs.push({ cx, cy, cz, sx, sy, sz }); this._addBoxCollider(cx, cy, cz, sx, sy, sz); };

    // back + side walls (with a door gap in the back)
    const seg = (w - doorW) / 2;
    push(x - (doorW / 2 + seg / 2), h / 2, z - hd, seg, h, t);
    push(x + (doorW / 2 + seg / 2), h / 2, z - hd, seg, h, t);
    push(x, h - 0.7, z - hd, doorW, 1.4, t);
    push(x - hw, h / 2, z, t, h, d);
    push(x + hw, h / 2, z, t, h, d);
    // front with wide door
    const seg2 = (w - doorW) / 2;
    push(x - (doorW / 2 + seg2 / 2), h / 2, z + hd, seg2, h, t);
    push(x + (doorW / 2 + seg2 / 2), h / 2, z + hd, seg2, h, t);
    push(x, h - 0.7, z + hd, doorW, 1.4, t);

    // roof
    roofSpecs.push({ cx: x, cy: h + 0.2, cz: z, sx: w + 0.6, sy: 0.4, sz: d + 0.6 });
    this._addBoxCollider(x, h + 0.2, z, w + 0.6, 0.4, d + 0.6);

    // mezzanine platform over the back half (y = 3.2)
    const mezzY = 3.2;
    metalSpecs.push({ cx: x, cy: mezzY, cz: z - hd / 2, sx: w - 0.4, sy: 0.3, sz: hd });
    this._addBoxCollider(x, mezzY, z - hd / 2, w - 0.4, 0.3, hd);
    // support pillars
    for (const sx of [-1, 1]) for (const sz of [1, 2]) {
      const px = x + sx * (hw - 1.1), pz = z - hd + sz * (hd / 2.5);
      metalSpecs.push({ cx: px, cy: h / 2, cz: pz, sx: 0.7, sy: h, sz: 0.7 });
      this._addBoxCollider(px, h / 2, pz, 0.7, h, 0.7);
    }
    // stepped ramp up to the mezzanine
    const steps = 6;
    const rampLen = 6.5;
    for (let i = 0; i < steps; i++) {
      const cy = (mezzY / steps) * (i + 1) - 0.15;
      const cz = z + hd - 1.5 - (rampLen / steps) * i;
      const sxPos = x + hw - 3.2;
      metalSpecs.push({ cx: sxPos, cy, cz, sx: 3.0, sy: 0.35, sz: rampLen / steps + 0.15 });
      this._addBoxCollider(sxPos, cy, cz, 3.0, 0.35, rampLen / steps + 0.15);
    }
    // external crate stair to the roof
    let step = 0;
    for (let yy = 1.2; yy < h + 0.6; yy += 1.2) {
      const sxPos = x - hw - 2 - step * 1.0;
      metalSpecs.push({ cx: sxPos, cy: yy, cz: z, sx: 1.4, sy: 1.2, sz: 1.4 });
      this._addBoxCollider(sxPos, yy, z, 1.4, 1.2, 1.4);
      step++;
    }

    // loot: ground floor, mezzanine, roof
    for (let i = 0; i < 4; i++) spots.push({ x: x + rand(-hw + 2, hw - 2), z: z + rand(-hd + 2, hd - 2), y: 0 });
    spots.push({ x: x + rand(-hw + 2, hw - 2), z: z - hd / 2, y: mezzY + 0.2 });
    spots.push({ x, z, y: h + 0.4 });
  }

  _buildTrees(scene, shadows) {    const count = 260;
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 4, 6);
    trunkGeo.translate(0, 2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    trunks.castShadow = shadows; trunks.receiveShadow = shadows;

    const foliageGeo = new THREE.IcosahedronGeometry(2.1, 0);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1, flatShading: true });
    const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, count);
    foliage.castShadow = shadows;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 12) {
      tries++;
      const x = rand(-WORLD_HALF + 8, WORLD_HALF - 8);
      const z = rand(-WORLD_HALF + 8, WORLD_HALF - 8);
      // keep off roads
      if (Math.abs(x % 150) < 7 || Math.abs(z % 150) < 7) continue;
      if (this.boxes.some((b) => x > b.min.x - 2 && x < b.max.x + 2 && z > b.min.z - 2 && z < b.max.z + 2)) continue;
      if (this.circles.some((c) => dist2D(c.x, c.z, x, z) < c.r + 4)) continue;

      const sc = rand(0.8, 1.5);
      const sy = sc * rand(0.9, 1.4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, Math.PI * 2));
      p.set(x, 0, z); s.set(sc, sy, sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(placed, m);
      const fs = sc * 1.15;
      p.set(x, 4.0 * sy + 1.2 * fs, z); s.set(fs, fs, fs);
      m.compose(p, q, s);
      foliage.setMatrixAt(placed, m);
      this.circles.push({ x, z, r: 0.5 * sc });
      placed++;
    }
    trunks.count = placed; foliage.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    scene.add(trunks); scene.add(foliage);
    this.solids.push(trunks, foliage);
  }

  _buildProps(scene, shadows) {
    // rocks
    const rockGeo = new THREE.DodecahedronGeometry(1.4, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x77787a, roughness: 1, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 90);
    rocks.castShadow = shadows; rocks.receiveShadow = shadows;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let placed = 0, tries = 0;
    while (placed < 90 && tries < 900) {
      tries++;
      const x = rand(-WORLD_HALF + 6, WORLD_HALF - 6), z = rand(-WORLD_HALF + 6, WORLD_HALF - 6);
      if (this.boxes.some((b) => x > b.min.x - 2 && x < b.max.x + 2 && z > b.min.z - 2 && z < b.max.z + 2)) continue;
      if (this.circles.some((c) => dist2D(c.x, c.z, x, z) < c.r + 3)) continue;
      const sc = rand(0.6, 1.8);
      q.setFromEuler(new THREE.Euler(rand(0, 1), rand(0, Math.PI * 2), rand(0, 1)));
      p.set(x, sc * 0.5, z); s.set(sc, sc * 0.8, sc);
      m.compose(p, q, s);
      rocks.setMatrixAt(placed, m);
      this.circles.push({ x, z, r: sc * 0.9 });
      placed++;
    }
    rocks.count = placed;
    rocks.instanceMatrix.needsUpdate = true;
    scene.add(rocks);
    this.solids.push(rocks);

    this._buildCoverProps(scene, shadows);
  }

  _buildCoverProps(scene, shadows) {
    const containerColors = [0xb5502f, 0x2f6f8f, 0x8f7a2f, 0x3f7a46, 0x7a3f6f];
    const geos = [];
    const dummy = new THREE.Object3D();
    const palette = [];
    const place = (x, z, w, h, d, color, climb = true) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2, z);
      const idx = palette.length;
      palette.push(color);
      geos.push({ g, idx });
      this._addBoxCollider(x, h / 2, z, w, h, d);
    };
    const clear = (x, z, r) =>
      !this.boxes.some((b) => x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) &&
      !this.circles.some((c) => dist2D(c.x, c.z, x, z) < c.r + r);

    // Shipping containers (climbable, 6m tall so roof is reachable via crates)
    let n = 0, t = 0;
    while (n < 18 && t < 400) {
      t++;
      const x = rand(-WORLD_HALF + 30, WORLD_HALF - 30), z = rand(-WORLD_HALF + 30, WORLD_HALF - 30);
      if (!clear(x, z, 8)) continue;
      place(x, z, 12, 2.6, 2.6, containerColors[(Math.random() * containerColors.length) | 0]);
      n++;
    }
    // Wrecked cars (cover)
    n = 0; t = 0;
    while (n < 12 && t < 300) {
      t++;
      const x = rand(-WORLD_HALF + 20, WORLD_HALF - 20), z = rand(-WORLD_HALF + 20, WORLD_HALF - 20);
      if (!clear(x, z, 7)) continue;
      place(x, z, 4.4, 1.5, 2.0, 0x53585c);
      n++;
    }
    // Sandbag lines (low cover)
    n = 0; t = 0;
    while (n < 26 && t < 400) {
      t++;
      const x = rand(-WORLD_HALF + 20, WORLD_HALF - 20), z = rand(-WORLD_HALF + 20, WORLD_HALF - 20);
      if (!clear(x, z, 6)) continue;
      const long = Math.random() < 0.5;
      place(x, z, long ? 6 : 1.2, 1.1, long ? 1.2 : 6, 0x8a7a55);
      n++;
    }

    const byColor = new Map();
    for (const { g, idx } of geos) {
      const key = palette[idx];
      if (!byColor.has(key)) byColor.set(key, []);
      byColor.get(key).push(g);
    }
    for (const [color, list] of byColor) {
      const mesh = new THREE.Mesh(
        mergeGeometries(list, false),
        new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: color === 0x53585c ? 0.5 : 0.15 })
      );
      mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      scene.add(mesh);
      this.solids.push(mesh);
      list.forEach((g) => g.dispose());
    }

    // Barrels (cylinders, low cover)
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9a3b2c, roughness: 0.6, metalness: 0.35 });
    const barrels = new THREE.InstancedMesh(barrelGeo, barrelMat, 70);
    barrels.castShadow = shadows; barrels.receiveShadow = shadows;
    let bp = 0, bt = 0;
    while (bp < 70 && bt < 900) {
      bt++;
      const x = rand(-WORLD_HALF + 8, WORLD_HALF - 8), z = rand(-WORLD_HALF + 8, WORLD_HALF - 8);
      if (this.boxes.some((b) => x > b.min.x - 1.5 && x < b.max.x + 1.5 && z > b.min.z - 1.5 && z < b.max.z + 1.5)) continue;
      if (this.circles.some((c) => dist2D(c.x, c.z, x, z) < c.r + 1.5)) continue;
      dummy.position.set(x, 0.55, z);
      dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
      dummy.updateMatrix();
      barrels.setMatrixAt(bp, dummy.matrix);
      this.circles.push({ x, z, r: 0.5 });
      bp++;
    }
    barrels.count = bp;
    barrels.instanceMatrix.needsUpdate = true;
    scene.add(barrels);
    this.solids.push(barrels);
  }

  // ---------------- Collision ----------------
  /** Move an actor (cylinder) with AABB/cylinder world collision. pos = feet position.
   *  stepHeight lets the actor automatically climb low ledges/crates. */
  moveActor(pos, vel, dt, radius, height, stepHeight = 0) {
    const result = { grounded: false, ceiling: false, wall: false, stepped: false };
    const hw = WORLD_HALF - 1;
    const canStep = (b) => stepHeight > 0 && vel.y <= 0.1 && (b.max.y - pos.y) > 0.02 && (b.max.y - pos.y) <= stepHeight;

    // X axis
    pos.x += vel.x * dt;
    for (const b of this.boxes) {
      if (pos.y + height <= b.min.y + 1e-4 || pos.y >= b.max.y - 1e-4) continue;
      if (pos.z + radius <= b.min.z || pos.z - radius >= b.max.z) continue;
      if (pos.x + radius > b.min.x && pos.x - radius < b.max.x) {
        if (canStep(b)) { pos.y = b.max.y + 0.002; result.stepped = true; continue; }
        const center = (b.min.x + b.max.x) / 2;
        if (pos.x < center) pos.x = b.min.x - radius; else pos.x = b.max.x + radius;
        vel.x = 0; result.wall = true;
      }
    }
    for (const c of this.circles) {
      if (pos.y + height <= 0 || pos.y >= 4) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = c.x + (dx / d) * rr;
        vel.x = 0; result.wall = true;
      }
    }
    pos.x = clamp(pos.x, -hw, hw);

    // Z axis
    pos.z += vel.z * dt;
    for (const b of this.boxes) {
      if (pos.y + height <= b.min.y + 1e-4 || pos.y >= b.max.y - 1e-4) continue;
      if (pos.x + radius <= b.min.x || pos.x - radius >= b.max.x) continue;
      if (pos.z + radius > b.min.z && pos.z - radius < b.max.z) {
        if (canStep(b)) { pos.y = b.max.y + 0.002; result.stepped = true; continue; }
        const center = (b.min.z + b.max.z) / 2;
        if (pos.z < center) pos.z = b.min.z - radius; else pos.z = b.max.z + radius;
        vel.z = 0; result.wall = true;
      }
    }
    for (const c of this.circles) {
      if (pos.y + height <= 0 || pos.y >= 4) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.z = c.z + (dz / d) * rr;
        vel.z = 0; result.wall = true;
      }
    }
    pos.z = clamp(pos.z, -hw, hw);

    // Y axis
    const prevY = pos.y;
    pos.y += vel.y * dt;
    for (const b of this.boxes) {
      if (pos.x + radius <= b.min.x || pos.x - radius >= b.max.x) continue;
      if (pos.z + radius <= b.min.z || pos.z - radius >= b.max.z) continue;
      if (pos.y < b.max.y && pos.y + height > b.min.y) {
        if (vel.y <= 0 && prevY >= b.max.y - 0.35) {
          pos.y = b.max.y; vel.y = 0; result.grounded = true;
        } else if (vel.y > 0 && prevY + height <= b.min.y + 0.35) {
          pos.y = b.min.y - height; vel.y = 0; result.ceiling = true;
        } else if (prevY < b.max.y && prevY + height > b.min.y) {
          // spawned/deep overlap: push to nearest
          const upDist = b.max.y - pos.y;
          const downDist = (pos.y + height) - b.min.y;
          if (upDist < downDist) { pos.y = b.max.y; vel.y = 0; result.grounded = true; }
          else { pos.y = b.min.y - height; vel.y = 0; result.ceiling = true; }
        }
      }
    }
    if (pos.y <= 0) { pos.y = 0; if (vel.y < 0) vel.y = 0; result.grounded = true; }

    return result;
  }

  groundHeightAt(x, z) {
    let h = 0;
    for (const b of this.boxes) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y < 30) {
        if (b.max.y > h) h = b.max.y;
      }
    }
    return h;
  }
}

export { EYE_HEIGHT };
