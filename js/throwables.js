import * as THREE from 'three';
import { clamp, rand } from './utils.js';

/** Throwable definitions. */
export const THROWABLES = {
  frag: { id: 'frag', name: 'Frag Grenade', fuse: 2.4, radius: 6.5, maxDamage: 118, color: 0x3f5132 },
};

const GRAV = -20;

export class Grenade {
  constructor(def, origin, velocity) {
    this.def = def;
    this.position = origin.clone();
    this.velocity = velocity.clone();
    this.fuse = def.fuse;
    this.dead = false;
    this.bounces = 0;

    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.5 })
    );
    g.add(body);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.7, envMapIntensity: 0.3 })
    );
    g.add(band);
    g.castShadow = true;
    this.mesh = g;
    this.mesh.position.copy(this.position);
  }

  update(dt, game) {
    if (this.dead) return;
    this.velocity.y += GRAV * dt;
    this.position.addScaledVector(this.velocity, dt);
    const r = 0.11;

    // ground
    if (this.position.y < r) {
      this.position.y = r;
      if (this.velocity.y < 0) this.velocity.y = -this.velocity.y * 0.35;
      this.velocity.x *= 0.7; this.velocity.z *= 0.7;
    }
    // world boxes
    for (const b of game.world.boxes) {
      if (this.position.x < b.min.x - r || this.position.x > b.max.x + r) continue;
      if (this.position.y < b.min.y - r || this.position.y > b.max.y + r) continue;
      if (this.position.z < b.min.z - r || this.position.z > b.max.z + r) continue;
      // penetration depths along each axis
      const dxa = (b.max.x + r) - this.position.x, dxb = this.position.x - (b.min.x - r);
      const dya = (b.max.y + r) - this.position.y, dyb = this.position.y - (b.min.y - r);
      const dza = (b.max.z + r) - this.position.z, dzb = this.position.z - (b.min.z - r);
      const m = Math.min(dxa, dxb, dya, dyb, dza, dzb);
      if (m === dxa) { this.position.x = b.max.x + r; this.velocity.x = Math.abs(this.velocity.x) * 0.4; }
      else if (m === dxb) { this.position.x = b.min.x - r; this.velocity.x = -Math.abs(this.velocity.x) * 0.4; }
      else if (m === dya) { this.position.y = b.max.y + r; this.velocity.y = Math.abs(this.velocity.y) * 0.35; }
      else if (m === dyb) { this.position.y = b.min.y - r; this.velocity.y = -Math.abs(this.velocity.y) * 0.35; }
      else if (m === dza) { this.position.z = b.max.z + r; this.velocity.z = Math.abs(this.velocity.z) * 0.4; }
      else { this.position.z = b.min.z - r; this.velocity.z = -Math.abs(this.velocity.z) * 0.4; }
      this.bounces++;
    }

    this.mesh.position.copy(this.position);
    this.mesh.rotation.x += this.velocity.z * dt * 2;
    this.mesh.rotation.z -= this.velocity.x * dt * 2;

    this.fuse -= dt;
    if (this.fuse <= 0) this.explode(game);
  }

  explode(game) {
    if (this.dead) return;
    this.dead = true;
    const R = this.def.radius;
    const p = this.position;

    game.effects.explosion(p, R);
    game.audio.explosion(p.x, p.z);

    // real physics: shockwave pushes ragdolls/debris, spawns scattered chunks
    if (game.physics) {
      game.physics.impact(p, R * 1.1, 7);
      game.physics.spawnDebris(p, 5, 0x6a7280);
    }

    const targets = [];
    if (game.player && game.player.alive) targets.push(game.player);
    for (const b of game.bots) if (b.alive) targets.push(b);

    for (const e of targets) {
      const chest = e.position.clone();
      chest.y += (e.isPlayer ? e.eye : 1.1);
      const d = chest.distanceTo(p);
      if (d > R) continue;
      // line of sight
      const dir = chest.clone().sub(p).normalize();
      const los = game.raycastWorld(p.clone().addScaledVector(dir, 0.2), dir, d);
      if (los && los.t < d - 0.4) continue;
      const falloff = Math.pow(1 - d / R, 1.3);
      const dmg = this.def.maxDamage * falloff;
      e.takeDamage(dmg, null, chest);
      if (e.isPlayer) {
        game.hud.flashDamage(clamp(falloff * 0.8, 0, 1));
        game.player.cameraShake = Math.min(0.05, falloff * 0.06);
      }
    }
  }
}

export class ThrowableManager {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  throw(def, origin, dir, power = 22) {
    const v = dir.clone().normalize().multiplyScalar(power);
    v.y += 3.2;
    const g = new Grenade(def, origin, v);
    this.scene.add(g.mesh);
    this.items.push(g);
    return g;
  }

  update(dt, game) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const g = this.items[i];
      g.update(dt, game);
      if (g.dead) {
        this.scene.remove(g.mesh);
        g.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        this.items.splice(i, 1);
      }
    }
  }
}
