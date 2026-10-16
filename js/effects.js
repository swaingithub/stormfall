import * as THREE from 'three';
import { rand, clamp } from './utils.js';

function radialTexture(color, hard = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hard) {
    g.addColorStop(0, color); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.impacts = [];
    this.bloods = [];
    this.decals = [];
    this.puffs = [];
    this._buildPools();
  }

  _buildPools() {
    // Tracers: pooled lines
    for (let i = 0; i < 90; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0, max: 0.07 });
    }
    this.tracerIdx = 0;

    // impacts: sprites
    this.impactTex = radialTexture('rgba(255,220,140,1)');
    for (let i = 0; i < 40; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.impactTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      spr.visible = false; spr.scale.set(0.5, 0.5, 0.5);
      this.scene.add(spr);
      this.impacts.push({ spr, life: 0, max: 0.18 });
    }
    this.impactIdx = 0;

    // blood
    this.bloodTex = radialTexture('rgba(190,20,20,1)');
    for (let i = 0; i < 48; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bloodTex, transparent: true, depthWrite: false }));
      spr.visible = false; spr.scale.set(0.4, 0.4, 0.4);
      this.scene.add(spr);
      this.bloods.push({ spr, life: 0, max: 0.32, vel: new THREE.Vector3() });
    }
    this.bloodIdx = 0;

    // decals (bullet holes)
    this.decalTex = radialTexture('rgba(10,10,10,0.85)', true);
    this.decalGeo = new THREE.PlaneGeometry(0.16, 0.16);

    // smoke / dust puffs
    this.smokeTex = radialTexture('rgba(120,120,120,0.7)');
    for (let i = 0; i < 80; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }));
      spr.visible = false; spr.scale.set(0.4, 0.4, 0.4);
      this.scene.add(spr);
      this.puffs.push({ spr, life: 0, max: 0.6, vel: new THREE.Vector3(), grow: 1.2 });
    }
    this.puffIdx = 0;
  }

  _puff() {
    const p = this.puffs[this.puffIdx];
    this.puffIdx = (this.puffIdx + 1) % this.puffs.length;
    return p;
  }

  smoke(point, dir, scale = 0.5) {
    const p = this._puff();
    p.spr.position.copy(point);
    p.spr.visible = true;
    p.spr.material.opacity = 0.55;
    p.spr.material.color.setHex(0x9a9a9a);
    p.spr.scale.setScalar(scale);
    p.vel.set(rand(-0.3, 0.3), rand(0.4, 0.9), rand(-0.3, 0.3));
    if (dir) p.vel.addScaledVector(dir, 0.6);
    p.grow = 1.6;
    p.life = 0.5; p.max = 0.5;
  }

  dust(point) {
    const p = this._puff();
    p.spr.position.copy(point); p.spr.position.y += 0.1;
    p.spr.visible = true;
    p.spr.material.opacity = 0.4;
    p.spr.material.color.setHex(0xcaa76a);
    p.spr.scale.setScalar(0.22);
    p.vel.set(rand(-0.4, 0.4), rand(0.2, 0.6), rand(-0.4, 0.4));
    p.grow = 1.1;
    p.life = 0.35; p.max = 0.35;
  }

  explosion(point, radius) {
    // bright core flash
    const im = this.impacts[this.impactIdx];
    this.impactIdx = (this.impactIdx + 1) % this.impacts.length;
    im.spr.position.copy(point);
    im.spr.visible = true;
    im.spr.material.opacity = 1;
    im.spr.scale.setScalar(radius * 0.6);
    im.life = 0.14; im.max = 0.14;

    for (let i = 0; i < 16; i++) {
      const p = this._puff();
      p.spr.position.copy(point).add(new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).multiplyScalar(radius * 0.3));
      p.spr.visible = true;
      p.spr.material.opacity = 0.7;
      p.spr.material.color.setHex(i % 3 === 0 ? 0xffa24a : 0x555555);
      p.spr.scale.setScalar(rand(0.6, 1.4));
      p.vel.set(rand(-2, 2), rand(0.6, 2.4), rand(-2, 2));
      p.grow = rand(2, 4);
      p.life = rand(0.6, 1.4); p.max = p.life;
    }

    // scorch decal on the ground
    const decal = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: this.smokeTex, color: 0x050505, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    decal.position.set(point.x, 0.02, point.z);
    decal.rotation.x = -Math.PI / 2;
    decal.scale.setScalar(radius * 0.7);
    this.scene.add(decal);
    this.decals.push({ mesh: decal, life: 14 });
    if (this.decals.length > 90) { const old = this.decals.shift(); this.scene.remove(old.mesh); old.mesh.material.dispose(); }
  }

  tracer(from, to, thick) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
    t.line.material.opacity = thick ? 0.9 : 0.6;
    t.line.material.color.setHex(thick ? 0xffffff : 0xffe08a);
    t.life = t.max;
    t.line.visible = true;
  }

  impact(point, normal, object) {
    const im = this.impacts[this.impactIdx];
    this.impactIdx = (this.impactIdx + 1) % this.impacts.length;
    im.spr.position.copy(point);
    if (normal) im.spr.position.addScaledVector(normal, 0.05);
    im.spr.visible = true;
    im.spr.material.opacity = 1;
    im.spr.scale.setScalar(rand(0.3, 0.6));
    im.life = im.max;

    // decal on solid surfaces
    if (object && normal) {
      const decal = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, opacity: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      decal.position.copy(point).addScaledVector(normal, 0.02);
      decal.lookAt(point.clone().add(normal));
      decal.rotation.z = rand(0, Math.PI * 2);
      this.scene.add(decal);
      this.decals.push({ mesh: decal, life: 8 });
      if (this.decals.length > 80) {
        const old = this.decals.shift();
        this.scene.remove(old.mesh); old.mesh.material.dispose();
      }
    }
  }

  bloodDecal(point) {
    const decal = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: this.smokeTex, color: 0x5a0d0d, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    decal.position.set(point.x, 0.02, point.z);
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = rand(0, Math.PI * 2);
    decal.scale.setScalar(rand(1.4, 3.2) * 0.14);
    this.scene.add(decal);
    this.decals.push({ mesh: decal, life: 12 });
    if (this.decals.length > 90) { const old = this.decals.shift(); this.scene.remove(old.mesh); old.mesh.material.dispose(); }
  }

  blood(point) {
    this.bloodDecal(point);
    for (let i = 0; i < 4; i++) {
      const b = this.bloods[this.bloodIdx];
      this.bloodIdx = (this.bloodIdx + 1) % this.bloods.length;
      b.spr.position.copy(point);
      b.spr.visible = true;
      b.spr.material.opacity = 1;
      b.spr.scale.setScalar(rand(0.15, 0.35));
      b.vel.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1));
      b.life = b.max;
    }
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = clamp((t.life / t.max) * 0.9, 0, 1);
        if (t.life <= 0) t.line.visible = false;
      }
    }
    for (const im of this.impacts) {
      if (im.life > 0) {
        im.life -= dt;
        im.spr.material.opacity = clamp(im.life / im.max, 0, 1);
        im.spr.scale.addScalar(dt * 3);
        if (im.life <= 0) im.spr.visible = false;
      }
    }
    for (const b of this.bloods) {
      if (b.life > 0) {
        b.life -= dt;
        b.vel.y -= 12 * dt;
        b.spr.position.addScaledVector(b.vel, dt);
        b.spr.material.opacity = clamp(b.life / b.max, 0, 1);
        b.spr.scale.addScalar(dt * 0.4);
        if (b.life <= 0) b.spr.visible = false;
      }
    }
    for (const p of this.puffs) {
      if (p.life > 0) {
        p.life -= dt;
        p.vel.multiplyScalar(1 - Math.min(1, dt * 2.2));
        p.vel.y += dt * 0.4;
        p.spr.position.addScaledVector(p.vel, dt);
        p.spr.scale.addScalar(dt * p.grow);
        p.spr.material.opacity = clamp((p.life / p.max) * 0.7, 0, 1);
        if (p.life <= 0) p.spr.visible = false;
      }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life < 1) {
        d.mesh.material.opacity = clamp(d.life, 0, 1);
        d.mesh.material.transparent = true;
      }
      if (d.life <= 0) { this.scene.remove(d.mesh); d.mesh.material.dispose(); this.decals.splice(i, 1); }
    }
  }
}
