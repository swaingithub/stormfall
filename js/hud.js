import { clamp, formatTime } from './utils.js';
import { AMMO_LABEL, WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.alive = $('alive-count');
    this.kills = $('kill-count');
    this.zonePhase = $('zone-phase');
    this.zoneLabel = $('zone-label');
    this.zoneBlock = $('zone-block');
    this.killfeed = $('killfeed');
    this.prompt = $('prompt');
    this.promptKey = $('prompt-key');
    this.promptText = $('prompt-text');
    this.hpFill = $('hp-fill'); this.apFill = $('ap-fill'); this.stFill = $('st-fill');
    this.hpText = $('hp-text'); this.apText = $('ap-text');
    this.staminaRow = $('stamina-row');
    this.weaponName = $('weapon-name');
    this.magAmmo = $('mag-ammo'); this.reserveAmmo = $('reserve-ammo');
    this.reloadHint = $('reload-hint');
    this.crosshair = $('crosshair');
    this.chT = document.querySelector('.ch-t'); this.chB = document.querySelector('.ch-b');
    this.chL = document.querySelector('.ch-l'); this.chR = document.querySelector('.ch-r');
    this.hitmarker = $('hitmarker');
    this.vignette = $('damage-vignette');
    this.stormVig = $('storm-vignette');
    this.lowhp = $('lowhp');
    this.healBar = $('heal-bar'); this.healFill = $('heal-fill');
    this.zoneBannerEl = $('zone-banner');
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.invSlots = [...document.querySelectorAll('#inventory .slot')];
    this.hud = $('hud');

    this.scopeEl = $('scope');
    this.medCount = $('med-count');
    this.grenCount = $('gren-count');
    this.backpack = $('backpack');
    this.bpWeapons = $('bp-weapons');
    this.bpAmmo = $('bp-ammo');
    this.bpUtil = $('bp-util');
    this.compassStrip = $('compass-strip');
    this.dmgNums = $('damage-numbers');

    this.feeds = [];
    this.dmgOpacity = 0;
    this.hitmarkerT = 0;
    this.lastHealth = 100;

    // directional damage indicator
    this.dirEl = document.createElement('div');
    this.dirEl.style.cssText = 'position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;';
    this.hud.appendChild(this.dirEl);
    this.dirT = 0;
    this.compassBuilt = false;
    this.compassP = 2.4;
  }

  buildCompass() {
    const strip = this.compassStrip;
    if (!strip || this.compassBuilt) return;
    const p = this.compassP;
    const cards = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let a = -360; a < 720; a += 15) {
      const deg = ((a % 360) + 360) % 360;
      const el = document.createElement('div');
      const major = deg % 45 === 0;
      el.className = 'ctick' + (major ? ' major' : '');
      el.style.left = (a * p) + 'px';
      if (cards[deg] !== undefined) { el.classList.add('card'); el.textContent = cards[deg]; }
      else if (deg % 30 === 0) { el.textContent = deg; }
      strip.appendChild(el);
    }
    this.compassBuilt = true;
  }

  updateCompass(yaw) {
    if (!this.compassBuilt) this.buildCompass();
    const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    this.compassStrip.style.transform = `translateX(${-heading * this.compassP}px)`;
  }

  damageNumber(x, y, amount, kind = 'hit') {
    const host = this.dmgNums || this.hud;
    const el = document.createElement('div');
    el.className = 'dmgnum ' + kind;
    el.textContent = amount;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    host.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }

  show() { this.hud.classList.remove('hidden'); }
  hide() { this.hud.classList.add('hidden'); }

  setAlive(n) { this.alive.textContent = n; }
  setKills(n) { this.kills.textContent = n; }

  setHealth(hp) {
    const pct = clamp(hp / 100, 0, 1) * 100;
    this.hpFill.style.width = pct + '%';
    this.hpText.textContent = Math.ceil(hp);
    if (hp <= 30 && hp > 0) this.lowhp.classList.add('on');
    else this.lowhp.classList.remove('on');
  }
  setArmor(ap) {
    this.apFill.style.width = clamp(ap / 100, 0, 1) * 100 + '%';
    this.apText.textContent = Math.ceil(ap);
  }
  setStamina(st, max) {
    this.stFill.style.width = clamp(st / max, 0, 1) * 100 + '%';
    this.staminaRow.classList.toggle('show', st < max - 0.5);
  }

  setWeapon(player) {
    const w = player.weapon;
    if (w) {
      this.weaponName.textContent = w.def.name;
      this.magAmmo.textContent = w.mag;
      this.reserveAmmo.textContent = player.ammo[w.def.ammoType] + ' (' + AMMO_LABEL[w.def.ammoType] + ')';
    } else {
      this.weaponName.textContent = 'UNARMED';
      this.magAmmo.textContent = '0';
      this.reserveAmmo.textContent = '—';
    }
    this.reloadHint.classList.toggle('hidden', !player.reloading);
    // inventory slots
    for (let i = 0; i < 3; i++) {
      const inst = player.weapons[i];
      this.invSlots[i].querySelector('.slot-name').textContent = inst ? inst.def.name : '—';
      this.invSlots[i].classList.toggle('active', i === player.slot);
    }
  }

  setCrosshair(spread, ads, sprinting) {
    const gap = ads ? 2 : clamp(4 + spread * 900 + (sprinting ? 6 : 0), 4, 40);
    const len = ads ? 4 : 8;
    this.chT.style.transform = `translateY(${-gap}px)`;
    this.chB.style.transform = `translateY(${gap}px)`;
    this.chL.style.transform = `translateX(${-gap}px)`;
    this.chR.style.transform = `translateX(${gap}px)`;
    this.chT.style.height = this.chB.style.height = len + 'px';
    this.chL.style.width = this.chR.style.width = len + 'px';
    this.crosshair.style.opacity = ads ? 0.35 : 1;
  }

  setZone(zone) {
    this.zonePhase.textContent = Math.min(zone.phase + 1, 9);
    this.zoneLabel.textContent = zone.label();
    const imminent = zone.state === 'shrink' || (zone.state === 'wait' && zone.timer < 8);
    this.zoneBlock.classList.toggle('warning', imminent);
  }

  setScope(on) {
    this.scopeEl.classList.toggle('hidden', !on);
  }

  setUtility(player) {
    if (this.medCount) this.medCount.textContent = player.medkits ?? 0;
    if (this.grenCount) this.grenCount.textContent = player.grenades ?? 0;
  }

  setBackpack(player, open) {
    if (!this.backpack) return;
    this.backpack.classList.toggle('hidden', !open);
    if (!open) return;
    this.bpWeapons.textContent = [0, 1, 2]
      .map((i) => (player.weapons[i] ? `${i + 1}:${player.weapons[i].def.name}` : `${i + 1}:—`))
      .join('   ');
    this.bpAmmo.textContent = Object.entries(player.ammo)
      .map(([k, v]) => `${AMMO_LABEL[k] || k} ${v}`).join('   ');
    this.bpUtil.textContent = `Meds ${player.medkits ?? 0}   Frags ${player.grenades ?? 0}` +
      (player.attachments ? `   ${player.attachments.extmag ? 'ExtMag ' : ''}${player.attachments.grip ? 'Compensator' : ''}` : '');
  }

  setPrompt(text, key = 'F') {
    if (text) {
      this.prompt.classList.remove('hidden');
      this.promptKey.textContent = key;
      this.promptText.textContent = text;
    } else this.prompt.classList.add('hidden');
  }

  setHeal(p) {
    if (p > 0) { this.healBar.classList.remove('hidden'); this.healFill.style.width = clamp(p, 0, 1) * 100 + '%'; }
    else this.healBar.classList.add('hidden');
  }

  hitmark(type) {
    this.hitmarker.classList.remove('hidden');
    this.hitmarker.classList.toggle('kill', type === 'kill');
    this.hitmarker.classList.add('show');
    this.hitmarkerT = type === 'kill' ? 0.35 : 0.18;
    this.hitmarker.style.filter = type === 'head' ? 'drop-shadow(0 0 5px #ffcc00)' : (type === 'kill' ? 'drop-shadow(0 0 5px #ff5722)' : 'none');
  }

  flashDamage(i) { this.dmgOpacity = Math.min(1, this.dmgOpacity + i); }
  stormFlash(i) { this.stormVig.style.opacity = clamp(i, 0, 1); }

  hurtDirection(from, player) {
    if (!from) return;
    const ang = Math.atan2(from.x - player.position.x, from.z - player.position.z);
    const rel = ang - player.yaw;
    this.dirEl.style.transform = `rotate(${-rel}rad)`;
    this.dirEl.innerHTML = `<div style="position:absolute;left:-24px;top:-90px;width:48px;height:30px;
      background:radial-gradient(ellipse at bottom, rgba(255,60,60,0.95), transparent 70%);
      clip-path:polygon(50% 0, 100% 100%, 0 100%);"></div>`;
    this.dirT = 0.9;
  }

  addKill(killerName, victimName, weaponName, involved, killedByPlayer) {
    const el = document.createElement('div');
    el.className = 'kf' + (involved ? ' me' : '');
    el.innerHTML = `<span class="name">${killerName}</span><span class="wp">${weaponName}</span><span class="name">${victimName}</span>`;
    this.killfeed.appendChild(el);
    this.feeds.push({ el, t: 6 });
    while (this.feeds.length > 6) { const f = this.feeds.shift(); f.el.remove(); }
  }

  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.hud.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 1200);
    // cleanup old
  }

  zoneBanner(text, color) {
    this.zoneBannerEl.textContent = text;
    this.zoneBannerEl.classList.remove('hidden');
    this.zoneBannerEl.style.borderColor = color || '#b57edc';
    this.zoneBannerEl.style.color = color || '#e9d5ff';
    clearTimeout(this._zbT);
    this._zbT = setTimeout(() => this.zoneBannerEl.classList.add('hidden'), 3200);
  }

  // ---------------- Minimap ----------------
  drawMinimap(game) {
    const ctx = this.mctx;
    const W = this.minimap.width, H = this.minimap.height;
    const R = W / 2;
    const worldR = 300;
    const range = 120; // meters visible
    const scale = R / range;
    const px = game.player.position.x, pz = game.player.position.z;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();

    // background
    ctx.fillStyle = 'rgba(18,26,20,0.75)';
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const gridStep = 50 * scale;
    const offX = (-px * scale) % gridStep;
    for (let x = offX; x < W; x += gridStep) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    const offZ = (-pz * scale) % gridStep;
    for (let y = offZ; y < H; y += gridStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const toMap = (wx, wz) => [R + (wx - px) * scale, R + (wz - pz) * scale];

    // world boundary
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    const [bx1, by1] = toMap(-worldR, -worldR), [bx2, by2] = toMap(worldR, worldR);
    ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

    // next zone ring
    const [nx, ny] = toMap(game.zone.nextCenter.x, game.zone.nextCenter.z);
    ctx.beginPath();
    ctx.arc(nx, ny, game.zone.nextRadius * scale, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);

    // current zone boundary
    const [cx, cy] = toMap(game.zone.center.x, game.zone.center.z);
    ctx.beginPath();
    ctx.arc(cx, cy, game.zone.radius * scale, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(181,126,220,0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
    // storm fill outside zone
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, game.zone.radius * scale, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(120,50,170,0.28)'; ctx.fill('evenodd');
    ctx.restore();

    // loot (weapons only, nearby)
    for (const it of game.loot.items) {
      if (it.type !== 'weapon') continue;
      const d = Math.hypot(it.position.x - px, it.position.z - pz);
      if (d > 45) continue;
      const [lx, ly] = toMap(it.position.x, it.position.z);
      ctx.fillStyle = 'rgba(255,152,0,0.9)';
      ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // enemies nearby (reveal within 55m)
    for (const b of game.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.position.x - px, b.position.z - pz);
      if (d > 55) continue;
      const [ex, ey] = toMap(b.position.x, b.position.z);
      ctx.fillStyle = 'rgba(255,70,70,0.95)';
      ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();

    // player arrow (center, always)
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-game.player.yaw + Math.PI);
    ctx.fillStyle = '#ffb400';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // border
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2; ctx.stroke();
  }

  update(dt, game) {
    // damage vignette decay
    if (this.dmgOpacity > 0) {
      this.dmgOpacity = Math.max(0, this.dmgOpacity - dt * 2.2);
      this.vignette.style.opacity = this.dmgOpacity;
    }
    if (this.hitmarkerT > 0) {
      this.hitmarkerT -= dt;
      if (this.hitmarkerT <= 0) this.hitmarker.classList.remove('show');
    }
    if (this.dirT > 0) { this.dirT -= dt; if (this.dirT <= 0) this.dirEl.innerHTML = ''; }

    // killfeed timers
    for (let i = this.feeds.length - 1; i >= 0; i--) {
      this.feeds[i].t -= dt;
      if (this.feeds[i].t <= 0) { this.feeds[i].el.remove(); this.feeds.splice(i, 1); }
    }

    // storm vignette from outside-zone
    if (game.player.alive) {
      const outside = game.zone.isOutside(game.player.position.x, game.player.position.z);
      this.stormVig.style.opacity = outside ? 0.55 : 0;
    }

    this.drawMinimap(game);
    this.updateCompass(game.player.yaw);
  }
}
