import { clamp } from './utils.js';

/**
 * Fully procedural WebAudio engine — no external sound files.
 * Generates gunshots, impacts, footsteps, UI blips, storm rumble etc.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._noiseBuf = null;
    this._ambient = null;
    this._listener = { x: 0, y: 0, z: 0 };
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this._noiseBuf = this._makeNoise(1.0);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  setListener(x, y, z) { this._listener.x = x; this._listener.y = y; this._listener.z = z; }

  _makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // attenuation based on distance from listener
  _distGain(x, z, maxDist = 120) {
    if (x === undefined) return 1;
    const dx = x - this._listener.x;
    const dz = z - this._listener.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    return clamp(1 - d / maxDist, 0, 1) ** 1.7;
  }

  _env(node, gain, attack, decay, t0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    return g;
  }

  /**
   * Gunshot: layered noise burst + body sine sweep + click transient.
   * type tunes the character (pistol/smg/rifle/shotgun/sniper).
   */
  gunshot(type = 'rifle', x, z) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const att = this._distGain(x, z);
    if (att <= 0.001) return;

    const cfg = {
      pistol:  { vol: 0.5, cut: 2600, dur: 0.16, body: 180, bodyGain: 0.35, sub: 90 },
      smg:     { vol: 0.42, cut: 3200, dur: 0.12, body: 220, bodyGain: 0.3, sub: 100 },
      rifle:   { vol: 0.6, cut: 2000, dur: 0.22, body: 130, bodyGain: 0.5, sub: 70 },
      shotgun: { vol: 0.75, cut: 1500, dur: 0.34, body: 90, bodyGain: 0.7, sub: 55 },
      sniper:  { vol: 0.85, cut: 1700, dur: 0.44, body: 100, bodyGain: 0.8, sub: 45 },
      lmg:     { vol: 0.6, cut: 1900, dur: 0.24, body: 120, bodyGain: 0.55, sub: 65 },
    }[type] || { vol: 0.5, cut: 2400, dur: 0.18, body: 150, bodyGain: 0.4, sub: 80 };

    const vol = cfg.vol * att;

    // noise burst through lowpass
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = 1.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cfg.cut, t0);
    lp.frequency.exponentialRampToValueAtTime(cfg.cut * 0.25, t0 + cfg.dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    src.connect(lp); lp.connect(hp);
    const e1 = this._env(hp, vol, 0.002, cfg.dur, t0);
    e1.connect(this.master);
    src.start(t0); src.stop(t0 + cfg.dur + 0.05);

    // low body
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cfg.body, t0);
    osc.frequency.exponentialRampToValueAtTime(cfg.sub, t0 + cfg.dur * 0.8);
    const e2 = this._env(osc, vol * cfg.bodyGain, 0.003, cfg.dur * 0.9, t0);
    e2.connect(this.master);
    osc.start(t0); osc.stop(t0 + cfg.dur + 0.05);

    // sharp click
    const clickSrc = ctx.createBufferSource();
    clickSrc.buffer = this._noiseBuf;
    const clickHp = ctx.createBiquadFilter();
    clickHp.type = 'highpass'; clickHp.frequency.value = 4000;
    clickSrc.connect(clickHp);
    const e3 = this._env(clickHp, vol * 0.5, 0.0005, 0.03, t0);
    e3.connect(this.master);
    clickSrc.start(t0); clickSrc.stop(t0 + 0.05);
  }

  impact(x, z) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const att = this._distGain(x, z, 60);
    if (att <= 0.001) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.5;
    src.connect(bp);
    const e = this._env(bp, 0.35 * att, 0.001, 0.08, t0);
    e.connect(this.master);
    src.start(t0); src.stop(t0 + 0.12);
  }

  hitmarker(headshot = false) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(headshot ? 1600 : 1100, t0);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 900 : 700, t0 + 0.06);
    const e = this._env(osc, 0.18, 0.001, 0.06, t0);
    e.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.09);
  }

  hurt() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(80, t0 + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    osc.connect(lp);
    const e = this._env(lp, 0.3, 0.005, 0.25, t0);
    e.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.3);
  }

  footstep(sprint = false) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = sprint ? 900 : 600;
    src.connect(lp);
    const e = this._env(lp, sprint ? 0.13 : 0.08, 0.001, 0.09, t0);
    e.connect(this.master);
    src.start(t0); src.stop(t0 + 0.12);
  }

  reload(stage = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const freq = [240, 320, 180, 420][stage % 4];
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const e = this._env(osc, 0.08, 0.001, 0.05, t0);
    e.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.06);
    // mechanical noise
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 3;
    src.connect(bp);
    const e2 = this._env(bp, 0.09, 0.001, 0.04, t0);
    e2.connect(this.master);
    src.start(t0); src.stop(t0 + 0.07);
  }

  pickup() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    [660, 990].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const e = this._env(osc, 0.12, 0.002, 0.1, t0 + i * 0.06);
      e.connect(this.master);
      osc.start(t0 + i * 0.06); osc.stop(t0 + i * 0.06 + 0.15);
    });
  }

  kill() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const e = this._env(osc, 0.16, 0.002, 0.14, t0 + i * 0.08);
      e.connect(this.master);
      osc.start(t0 + i * 0.08); osc.stop(t0 + i * 0.08 + 0.2);
    });
  }

  alarm() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, t0 + i * 0.35);
      osc.frequency.linearRampToValueAtTime(300, t0 + i * 0.35 + 0.3);
      const e = this._env(osc, 0.2, 0.02, 0.28, t0 + i * 0.35);
      e.connect(this.master);
      osc.start(t0 + i * 0.35); osc.stop(t0 + i * 0.35 + 0.34);
    }
  }

  explosion(x, z) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const att = this._distGain(x, z, 200);
    if (att <= 0.001) return;
    // deep boom
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(32, t0 + 0.7);
    const e = this._env(osc, 0.9 * att, 0.005, 0.75, t0);
    e.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.8);
    // debris noise
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t0);
    lp.frequency.exponentialRampToValueAtTime(180, t0 + 0.5);
    src.connect(lp);
    const e2 = this._env(lp, 0.5 * att, 0.002, 0.5, t0);
    e2.connect(this.master);
    src.start(t0); src.stop(t0 + 0.6);
  }

  throwSound(x, z) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const att = this._distGain(x, z, 60);
    if (att <= 0.001) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    src.connect(bp);
    const e = this._env(bp, 0.14 * att, 0.004, 0.14, t0);
    e.connect(this.master);
    src.start(t0); src.stop(t0 + 0.2);
  }

  // Continuous storm rumble tied to intensity 0..1
  storm(intensity) {
    if (!this.ctx || this.muted) return;
    if (!isFinite(intensity)) intensity = 0;
    intensity = clamp(intensity, 0, 1);
    if (!this._ambient) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 300;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start();
      this._ambient = { g, lp };
    }
    const t = this.ctx.currentTime;
    this._ambient.g.gain.linearRampToValueAtTime(clamp(intensity, 0, 1) * 0.28, t + 0.5);
    this._ambient.lp.frequency.linearRampToValueAtTime(200 + clamp(intensity, 0, 1) * 600, t + 0.5);
  }
  stopStorm() { if (this._ambient) this._ambient.g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5); }
}
