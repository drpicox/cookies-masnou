/* Habitació amb vistes — el temps: núvols, pluja, tempesta i llamps */
(function () {
  'use strict';
  const { clamp, lerp, damp, RNG } = LOFI;

  const MODES = {
    clear: { cover: 0.42, overcast: 0, rain: 0, storm: 0 },
    cloudy: { cover: 0.78, overcast: 0.35, rain: 0, storm: 0 },
    rain: { cover: 0.95, overcast: 0.88, rain: 1, storm: 0.12 },
    storm: { cover: 1, overcast: 1, rain: 1, storm: 1 },
  };

  class Weather {
    constructor(seed = 11) {
      this.rng = new RNG(seed);
      this.mode = 'auto';
      this.rainAmount = 0.7;
      this.s = { cover: 0.3, overcast: 0, rain: 0, storm: 0, wet: 0, flash: 0, boltAlpha: 0, boltDir: null };
      this.auto = { phase: 'clear', timer: this.rng.range(150, 320) };
      this.flashSeq = [];
      this.nextBolt = 8;
      this.pending = [];   // trons pendents {t, dist}
    }

    setMode(m, instant = false) {
      this.mode = m;
      if (m === 'auto') { this.auto.timer = this.rng.range(60, 200); }
      if (instant) {
        const t = this.targets();
        Object.assign(this.s, { cover: t.cover, overcast: t.overcast, rain: t.rain, storm: t.storm, wet: t.rain > 0 ? 0.8 : 0 });
      }
    }

    get phase() { return this.mode === 'auto' ? this.auto.phase : this.mode; }

    targets() {
      const ph = this.phase;
      const t = Object.assign({}, MODES[ph] || MODES.clear);
      if (ph === 'rain') t.rain = this.rainAmount;
      if (ph === 'storm') t.rain = Math.max(0.75, this.rainAmount);
      return t;
    }

    stepAuto(dt) {
      const a = this.auto, r = this.rng;
      a.timer -= dt;
      if (a.timer > 0) return;
      const next = {
        clear: () => (r.chance(0.55) ? ['cloudy', r.range(90, 200)] : ['clear', r.range(150, 300)]),
        cloudy: () => (r.chance(0.6) ? (r.chance(0.3) ? ['storm', r.range(120, 240)] : ['rain', r.range(150, 330)]) : ['clear', r.range(180, 360)]),
        rain: () => (r.chance(0.2) ? ['storm', r.range(90, 180)] : ['cloudy', r.range(60, 150)]),
        storm: () => ['rain', r.range(80, 160)],
      }[a.phase]();
      a.phase = next[0]; a.timer = next[1];
    }

    // Llamp: seqüència de flaixos + tro retardat
    strike(outside, onThunder, nearChance) {
      // de tant en tant, un llamp cau ben a prop, sobre una antena d'una torre
      const pNear = nearChance !== undefined ? nearChance : (this.s.storm > 0.6 ? 0.22 : 0.1);
      const info = outside ? outside.strike(this.rng.chance(pNear)) : { az: 0, dist: 0.5 };
      const r = this.rng;
      const seq = [];
      let t = 0;
      const n = r.int(2, 4);
      for (let i = 0; i < n; i++) {
        seq.push({ t, v: r.range(0.6, 1), bolt: true });
        t += r.range(0.04, 0.09);
        seq.push({ t, v: r.range(0.05, 0.25), bolt: i < n - 1 });
        t += r.range(0.04, 0.12);
      }
      seq.push({ t, v: 0, bolt: false });
      this.flashSeq = seq.map((e) => ({ ...e, v: Math.min(1.3, e.v * lerp(1, 0.55, info.dist) * (info.near ? 1.25 : 1)) }));
      this.flashT = 0;
      this.s.boltDir = { x: Math.sin(info.az), y: 0.5 };
      const delay = info.near ? 0.06 : 0.5 + info.dist * 4.5;
      this.pending.push({ t: delay, dist: info.dist });
      this._onThunder = onThunder;
      return info;
    }

    update(dt, outside, onThunder) {
      if (this.mode === 'auto') this.stepAuto(dt);
      const tg = this.targets();
      const s = this.s;
      s.cover = damp(s.cover, tg.cover, 0.06, dt);
      s.overcast = damp(s.overcast, tg.overcast, 0.07, dt);
      // la pluja arriba quan ja està ennuvolat
      const rainT = tg.rain * clamp((s.overcast - 0.45) / 0.35);
      s.rain = damp(s.rain, rainT, rainT > s.rain ? 0.12 : 0.18, dt);
      if (s.rain < 0.004 && rainT === 0) s.rain = 0;
      s.storm = damp(s.storm, tg.storm, 0.1, dt);
      s.wet = s.rain > s.wet ? damp(s.wet, Math.min(1, s.rain * 1.3), 0.5, dt) : Math.max(0, s.wet - dt / 150);

      // llamps
      if (s.storm > 0.55 && s.rain > 0.3) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.strike(outside, onThunder);
          this.nextBolt = this.rng.range(7, 22) / (0.6 + 0.4 * s.storm);
        }
      }
      // reprodueix la seqüència de flaixos
      let flash = 0, bolt = 0;
      if (this.flashSeq.length) {
        this.flashT += dt;
        let cur = null;
        for (const e of this.flashSeq) if (e.t <= this.flashT) cur = e;
        const last = this.flashSeq[this.flashSeq.length - 1];
        if (this.flashT > last.t + 0.5) this.flashSeq = [];
        else if (cur) { flash = cur.v; bolt = cur.bolt ? 1 : 0; if (cur === last) flash = 0.2 * Math.exp(-(this.flashT - last.t) * 8); }
      }
      s.flash = flash;
      s.boltAlpha = bolt;
      // trons pendents
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const p = this.pending[i];
        p.t -= dt;
        if (p.t <= 0) { this.pending.splice(i, 1); const cb = onThunder || this._onThunder; if (cb) cb(p.dist); }
      }
      return s;
    }
  }

  LOFI.Weather = Weather;
})();
