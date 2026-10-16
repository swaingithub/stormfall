import * as THREE from 'three';

/**
 * WASM rigid-body physics (Rapier3D) driving death ragdolls and loose debris.
 *
 * Loaded lazily: `await Physics.create(world)` fetches the Rapier compat build
 * (WebAssembly inlined as base64, CORS-enabled CDN) and builds a static world
 * matching the level colliders. If the network/library is unavailable the game
 * falls back to the original scripted animations — nothing throws.
 *
 * Everything here is best-effort: the game must run with or without it.
 */

const WORLD_MEM = 0x0001;
const RAG_MEM = 0x0002;

// Ragdoll part layout (root at the feet, facing +Z, metres).
const PARTS = [
  { name: 'pelvis', kind: 'capsule', hh: 0.09, r: 0.13, pos: [0, 0.95, 0], mat: 'pants' },
  { name: 'chest', kind: 'capsule', hh: 0.15, r: 0.16, pos: [0, 1.30, 0], mat: 'shirt' },
  { name: 'head', kind: 'ball', r: 0.125, pos: [0, 1.62, 0], mat: 'helmet' },
  { name: 'armL', kind: 'capsule', hh: 0.20, r: 0.055, pos: [-0.26, 1.24, 0], mat: 'shirt' },
  { name: 'armR', kind: 'capsule', hh: 0.20, r: 0.055, pos: [0.26, 1.24, 0], mat: 'shirt' },
  { name: 'legL', kind: 'capsule', hh: 0.30, r: 0.078, pos: [-0.12, 0.62, 0], mat: 'pants' },
  { name: 'legR', kind: 'capsule', hh: 0.30, r: 0.078, pos: [0.12, 0.62, 0], mat: 'pants' },
];

const JOINTS = [
  ['pelvis', 'chest', [0, 0.175, 0], [0, -0.175, 0]],
  ['chest', 'head', [0, 0.16, 0], [0, -0.16, 0]],
  ['chest', 'armL', [-0.24, 0.12, 0], [0, 0.20, 0]],
  ['chest', 'armR', [0.24, 0.12, 0], [0, 0.20, 0]],
  ['pelvis', 'legL', [-0.12, -0.05, 0], [0, 0.30, 0]],
  ['pelvis', 'legR', [0.12, -0.05, 0], [0, 0.30, 0]],
];

const PALETTES = [
  { shirt: 0x3d5a40, pants: 0x24282a, helmet: 0x2e3b2a, skin: 0xc98d63 },
  { shirt: 0x6b3d3d, pants: 0x2a2018, helmet: 0x3a2626, skin: 0xe0ac7e },
  { shirt: 0x3d4a5a, pants: 0x1c2430, helmet: 0x263241, skin: 0xa9774f },
  { shirt: 0x6b6b3d, pants: 0x27271c, helmet: 0x44442a, skin: 0xd6a06b },
  { shirt: 0x4a3d5a, pants: 0x211b2a, helmet: 0x332a40, skin: 0xbd8352 },
  { shirt: 0x2f4f4f, pants: 0x182424, helmet: 0x233838, skin: 0xe6b98c },
];

export class Physics {
  static async create(world, scene) {
    let RAPIER;
    try {
      const mod = await import('rapier');
      RAPIER = mod.default || mod;
      await RAPIER.init();
    } catch (err) {
      console.warn('[physics] Rapier unavailable, using fallback animation:', err && err.message);
      return null;
    }
    try {
      const p = new Physics(RAPIER, world);
      p.scene = scene || null;
      return p;
    } catch (err) {
      console.warn('[physics] world build failed:', err && err.message);
      return null;
    }
  }

  constructor(RAPIER, world) {
    this.RAPIER = RAPIER;
    this.scene = world.scene || null;
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.world.timestep = 1 / 60;
    this.acc = 0;
    this.ragdolls = [];
    this.debris = [];
    this._buildStatic(world);
  }

  _quatFromYaw(yaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }

  _buildStatic(world) {
    const R = this.RAPIER;
    // ground
    const gDesc = R.RigidBodyDesc.fixed().setTranslation(0, -1, 0);
    const ground = this.world.createRigidBody(gDesc);
    this.world.createCollider(R.ColliderDesc.cuboid(1200, 1, 1200).setFriction(0.9), ground);

    for (const b of world.boxes) {
      const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
      const hx = Math.max(0.02, (b.max.x - b.min.x) / 2);
      const hy = Math.max(0.02, (b.max.y - b.min.y) / 2);
      const hz = Math.max(0.02, (b.max.z - b.min.z) / 2);
      const rb = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
      this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9), rb);
    }
    for (const c of world.circles) {
      const rb = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(c.x, 4, c.z));
      this.world.createCollider(R.ColliderDesc.cylinder(4, c.r).setFriction(0.9), rb);
    }
  }

  setScene(scene) { this.scene = scene; }

  // ---------------- Ragdolls ----------------
  spawnRagdoll(position, yaw, paletteIndex = 0, impulse = null) {
    if (!this.world || !this.scene) return null;
    const R = this.RAPIER;
    const pal = PALETTES[(paletteIndex | 0) % PALETTES.length];
    const mats = {
      shirt: new THREE.MeshStandardMaterial({ color: pal.shirt, roughness: 0.85 }),
      pants: new THREE.MeshStandardMaterial({ color: pal.pants, roughness: 0.85 }),
      helmet: new THREE.MeshStandardMaterial({ color: pal.helmet, roughness: 0.5, metalness: 0.15 }),
    };
    for (const k in mats) { mats[k].userData.envI = 0.4; mats[k].envMapIntensity = 0.4; }
    const group = new THREE.Group();
    this.scene.add(group);

    const q = this._quatFromYaw(yaw);
    const bodies = {};
    const meshes = {};
    const colliders = [];

    for (const p of PARTS) {
      const rx = p.pos[0], ry = p.pos[1], rz = p.pos[2];
      const rbDesc = R.RigidBodyDesc.dynamic()
        .setTranslation(position.x + rx, position.y + ry, position.z + rz)
        .setRotation(q)
        .setLinearDamping(0.5)
        .setAngularDamping(0.8)
        .setCanSleep(true);
      const rb = this.world.createRigidBody(rbDesc);
      let colDesc;
      if (p.kind === 'ball') colDesc = R.ColliderDesc.ball(p.r).setDensity(0.8).setRestitution(0.05).setFriction(0.9);
      else colDesc = R.ColliderDesc.capsule(p.hh, p.r).setDensity(0.9).setRestitution(0.05).setFriction(0.92);
      colDesc.setCollisionGroups((RAG_MEM << 16) | WORLD_MEM);
      colliders.push(this.world.createCollider(colDesc, rb));
      bodies[p.name] = rb;

      const geo = p.kind === 'ball'
        ? new THREE.SphereGeometry(p.r, 12, 10)
        : new THREE.CapsuleGeometry(p.r, p.hh * 2, 4, 8);
      const mesh = new THREE.Mesh(geo, mats[p.mat] || mats.shirt);
      mesh.castShadow = true;
      group.add(mesh);
      meshes[p.name] = mesh;
    }

    for (const [a, b, la, lb] of JOINTS) {
      const jd = R.JointData.spherical({ x: la[0], y: la[1], z: la[2] }, { x: lb[0], y: lb[1], z: lb[2] });
      try { this.world.createImpulseJoint(jd, bodies[a], bodies[b], true); } catch (e) { /* skip bad joint */ }
    }

    if (impulse) {
      for (const name of ['chest', 'pelvis', 'head']) {
        bodies[name].applyImpulse({ x: impulse.x * 0.6, y: impulse.y * 0.6 + 0.3, z: impulse.z * 0.6 }, true);
      }
    }
    // topple + tumble so it collapses instead of balancing on its feet
    const rnd = (a) => (Math.random() - 0.5) * a;
    for (const p of PARTS) {
      bodies[p.name].setAngvel({ x: rnd(5), y: rnd(4), z: rnd(5) }, true);
    }
    bodies.chest.applyImpulse({ x: rnd(1.0), y: 0.2, z: rnd(1.0) }, true);
    bodies.head.applyImpulse({ x: rnd(0.6), y: 0, z: rnd(0.6) }, true);

    const rag = {
      group, bodies, meshes, mats,
      life: 0, maxLife: 9,
      update: (dt) => {
        for (const p of PARTS) {
          const rb = bodies[p.name];
          const t = rb.translation();
          const r = rb.rotation();
          const m = meshes[p.name];
          m.position.set(t.x, t.y, t.z);
          m.quaternion.set(r.x, r.y, r.z, r.w);
        }
        this.life = (this.life || 0) + dt;
        rag.life += dt;
        if (rag.life > rag.maxLife) {
          const k = Math.max(0, 1 - (rag.life - rag.maxLife) / 1.5);
          group.traverse((o) => { if (o.isMesh) o.material.opacity = k; });
        }
      },
      dispose: () => {
        for (const p of PARTS) this.world.removeRigidBody(bodies[p.name]);
        group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
        Object.values(mats).forEach((m) => m.dispose());
        this.scene.remove(group);
      },
      done: () => rag.life > rag.maxLife + 1.5,
    };
    for (const m of Object.values(mats)) { m.transparent = true; }
    this.ragdolls.push(rag);
    return rag;
  }

  // ---------------- Debris ----------------
  spawnDebris(point, count = 6, color = 0x5a6472) {
    if (!this.world || !this.scene) return;
    const R = this.RAPIER;
    for (let i = 0; i < count; i++) {
      const s = 0.15 + Math.random() * 0.2;
      const rb = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(point.x + (Math.random() - 0.5) * 0.6, point.y + 0.4 + Math.random() * 0.6, point.z + (Math.random() - 0.5) * 0.6)
          .setLinearDamping(0.2).setAngularDamping(0.3)
      );
      rb.applyImpulse({
        x: (Math.random() - 0.5) * 3, y: 1.4 + Math.random() * 2, z: (Math.random() - 0.5) * 3,
      }, true);
      const col = this.world.createCollider(R.ColliderDesc.cuboid(s, s, s).setDensity(0.7).setRestitution(0.35).setFriction(0.7)
        .setCollisionGroups((RAG_MEM << 16) | WORLD_MEM), rb);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(s * 2, s * 2, s * 2),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, envMapIntensity: 0.4 })
      );
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.debris.push({ rb, mesh, life: 0, maxLife: 7 });
    }
  }

  impact(point, radius = 5, strength = 6) {
    if (!this.world) return;
    const r2 = radius * radius;
    const push = (rb, scale) => {
      const t = rb.translation();
      const dx = t.x - point.x, dy = t.y - point.y, dz = t.z - point.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) return;
      const d = Math.sqrt(d2) + 1e-3;
      const f = (1 - d / radius) * strength * scale;
      rb.applyImpulse({ x: (dx / d) * f, y: (dy / d) * f + f * 0.5, z: (dz / d) * f }, true);
    };
    for (const rag of this.ragdolls) for (const p of PARTS) push(rag.bodies[p.name], 12);
    for (const d of this.debris) push(d.rb, 4);
  }

  step(dt) {
    if (!this.world) return;
    this.acc += Math.min(dt, 0.1);
    const fixed = 1 / 60;
    let steps = 0;
    while (this.acc >= fixed && steps < 5) { this.world.step(); this.acc -= fixed; steps++; }
    if (steps === 0) return;

    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i];
      r.update(dt);
      if (r.done()) { r.dispose(); this.ragdolls.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const t = d.rb.translation(), rot = d.rb.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      d.life += dt;
      if (d.life > d.maxLife) {
        this.world.removeRigidBody(d.rb);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  dispose() {
    try { for (const r of this.ragdolls) r.dispose(); } catch (e) { /* noop */ }
    for (const d of this.debris) { try { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); } catch (e) { /* noop */ } }
    this.ragdolls = []; this.debris = [];
    if (this.world) { try { this.world.free(); } catch (e) { /* noop */ } this.world = null; }
  }
}
