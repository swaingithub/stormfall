import * as THREE from 'three';
import { clamp, lerp, rand } from './utils.js';

export const PHASES = [
  { wait: 30, shrink: 40, radius: 210, dmg: 1 },
  { wait: 26, shrink: 36, radius: 150, dmg: 2 },
  { wait: 24, shrink: 32, radius: 105, dmg: 3 },
  { wait: 22, shrink: 30, radius: 70, dmg: 5 },
  { wait: 20, shrink: 28, radius: 45, dmg: 8 },
  { wait: 18, shrink: 26, radius: 26, dmg: 11 },
  { wait: 16, shrink: 24, radius: 13, dmg: 15 },
  { wait: 15, shrink: 22, radius: 6, dmg: 20 },
  { wait: 14, shrink: 40, radius: 0.6, dmg: 30 },
];

export class Zone {
  constructor(scene, startRadius = 300) {
    this.scene = scene;
    this.center = new THREE.Vector3(0, 0, 0);
    this.radius = startRadius;
    this.startRadius = startRadius;
    this.phase = -1;          // last completed phase index (-1 = initial)
    this.pendingIndex = 0;    // next phase to close
    this.maxPhase = PHASES.length - 1;
    this.state = 'wait';
    this.timer = 12;          // grace before first close
    this.dmg = 0;
    this._buildMeshes();
    this._rollNext(PHASES[0]);
  }

  _buildMeshes() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xb57edc, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 40, 64, 1, true), mat);
    this.wall.position.y = 20;
    this.scene.add(this.wall);

    const topMat = new THREE.MeshBasicMaterial({ color: 0xd9b0f0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    this.wallTop = new THREE.Mesh(new THREE.CylinderGeometry(1.004, 1.004, 0.8, 64, 1, true), topMat);
    this.wallTop.position.y = 40;
    this.scene.add(this.wallTop);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    this.nextRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.0, 80), ringMat);
    this.nextRing.rotation.x = -Math.PI / 2;
    this.nextRing.position.y = 0.15;
    this.scene.add(this.nextRing);

    this._sync();
  }

  _sync() {
    this.wall.scale.set(this.radius, 1, this.radius);
    this.wall.position.set(this.center.x, 20, this.center.z);
    this.wallTop.scale.set(this.radius, 1, this.radius);
    this.wallTop.position.set(this.center.x, 40, this.center.z);
    if (this.nextRadius !== undefined) {
      this.nextRing.scale.set(this.nextRadius, this.nextRadius, 1);
      this.nextRing.position.set(this.nextCenter.x, 0.15, this.nextCenter.z);
      this.nextRing.visible = this.nextRadius < this.radius - 0.5;
    }
  }

  isOutside(x, z) {
    const dx = x - this.center.x, dz = z - this.center.z;
    return dx * dx + dz * dz > this.radius * this.radius;
  }

  _rollNext(p) {
    this.nextRadius = p.radius;
    const maxOff = Math.max(0, this.radius - this.nextRadius) * 0.8;
    const ang = rand(0, Math.PI * 2);
    const d = rand(0, maxOff);
    this.nextCenter = new THREE.Vector3(
      clamp(this.center.x + Math.cos(ang) * d, -300 + this.nextRadius, 300 - this.nextRadius),
      0,
      clamp(this.center.z + Math.sin(ang) * d, -300 + this.nextRadius, 300 - this.nextRadius));
    this._sync();
  }

  _beginShrink(game) {
    const p = PHASES[Math.min(this.pendingIndex, this.maxPhase)];
    this.startCenter = this.center.clone();
    this.startR = this.radius;
    this.targetCenter = this.nextCenter.clone();
    this.targetRadius = this.nextRadius;
    this.shrinkDur = p.shrink;
    this.shrinkT = 0;
    this.state = 'shrink';
    game.onZoneShrinkStart(this.pendingIndex);
  }

  _completeShrink(game) {
    const p = PHASES[Math.min(this.pendingIndex, this.maxPhase)];
    this.center.copy(this.targetCenter);
    this.radius = this.targetRadius;
    this.dmg = p.dmg;
    this.phase = this.pendingIndex;
    this.pendingIndex++;
    this._sync();
    game.onZoneShrunk(this.phase, p.dmg);

    if (this.pendingIndex <= this.maxPhase) {
      const np = PHASES[this.pendingIndex];
      this._rollNext(np);
      this.state = 'wait';
      this.timer = np.wait;
      game.onZonePush(this.pendingIndex, np, this.nextCenter);
    } else {
      this.state = 'wait';
      this.timer = 9999;
    }
  }

  update(dt, game) {
    if (this.state === 'wait') {
      this.timer -= dt;
      if (this.timer <= 0 && this.pendingIndex <= this.maxPhase) this._beginShrink(game);
    } else if (this.state === 'shrink') {
      this.shrinkT += dt;
      const t = clamp(this.shrinkT / this.shrinkDur, 0, 1);
      this.center.lerpVectors(this.startCenter, this.targetCenter, t);
      this.radius = lerp(this.startR, this.targetRadius, t);
      this._sync();
      if (t >= 1) this._completeShrink(game);
    }

    // storm damage
    if (this.dmg > 0) {
      const d = this.dmg * dt;
      if (game.player.alive && this.isOutside(game.player.position.x, game.player.position.z)) {
        game.player.zoneDamage(d);
      }
      for (const b of game.bots) {
        if (!b.alive) continue;
        if (this.isOutside(b.position.x, b.position.z)) {
          b.zoneAccum = (b.zoneAccum || 0) + d;
          if (b.zoneAccum >= 0.75) { b.takeDamage(b.zoneAccum, null, b.position); b.zoneAccum = 0; }
        }
      }
    }

    // storm audio
    const outside = game.player.alive && this.isOutside(game.player.position.x, game.player.position.z);
    let intensity = 0;
    if (game.player.alive) {
      const distToWall = Math.abs(Math.hypot(game.player.position.x - this.center.x, game.player.position.z - this.center.z) - this.radius);
      intensity = clamp(1 - distToWall / 80, 0, 1) * (outside ? 1 : 0.65);
    }
    if (!isFinite(intensity)) intensity = 0;
    game.audio.storm(intensity);
  }

  timeToShrink() { return this.state === 'wait' ? Math.max(0, this.timer) : 0; }
  label() {
    if (this.state === 'shrink') return 'CLOSING';
    if (this.timer > 9000) return 'FINAL';
    return `NEXT ${Math.ceil(this.timer)}s`;
  }
}
