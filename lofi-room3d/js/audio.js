/* Lofi Room — procedural sound engine
 * Generative lofi hip-hop + rain / thunder / city / birds / pigeons / room foley.
 * Classic script (works from file://). Web Audio only: every sound is synthesized,
 * noise beds and impulse responses are generated in JS. Exposes window.LofiAudio.
 */
(function () {
  'use strict';

  // ───────────────────────────── utilities ─────────────────────────────
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const chance = (p) => Math.random() < p;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const expRand = (rate) => -Math.log(1 - Math.random()) / rate;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) / 0.5774; };
  function wpickIndex(weights) {
    let sum = 0; for (const w of weights) sum += w;
    let r = Math.random() * sum;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  }
  const wpick = (items, weights) => items[wpickIndex(weights)];

  // Smoothly move an AudioParam towards a value (no clicks, no event pile-up).
  function glide(param, value, t, tau) {
    try {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(value, t, Math.max(0.005, tau));
    } catch (e) { /* ignore */ }
  }
  // Hard reset then glide (for params with pending automation we want to override).
  function reglide(param, value, t, tau) {
    try {
      const cur = param.value;
      param.cancelScheduledValues(t);
      param.setValueAtTime(cur, t);
      param.setTargetAtTime(value, t, Math.max(0.005, tau));
    } catch (e) { /* ignore */ }
  }

  // ───────────────────────────── buffers ─────────────────────────────
  // Seamless loop: generate n+k samples, crossfade the tail into the head.
  function loopify(tmp, n, k, out) {
    for (let i = 0; i < n; i++) out[i] = tmp[i];
    for (let i = 0; i < k; i++) {
      const w = i / k;
      out[i] = tmp[i] * Math.sqrt(w) + tmp[n + i] * Math.sqrt(1 - w);
    }
  }

  function noiseBuffer(ctx, seconds, color, channels) {
    const sr = ctx.sampleRate, n = Math.floor(seconds * sr), k = Math.floor(sr * 0.08);
    const buf = ctx.createBuffer(channels, n, sr);
    const tmp = new Float32Array(n + k);
    for (let c = 0; c < channels; c++) {
      if (color === 'white') {
        for (let i = 0; i < n + k; i++) tmp[i] = Math.random() * 2 - 1;
      } else if (color === 'pink') { // Paul Kellet's refined pink filter
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < n + k; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          tmp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      } else { // brown
        let last = 0;
        for (let i = 0; i < n + k; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          tmp[i] = last * 3.5;
        }
      }
      loopify(tmp, n, k, buf.getChannelData(c));
    }
    return buf;
  }

  // Dark stereo reverb impulse (noise tail that gets darker as it decays).
  function impulse(ctx, seconds, bright, dark, preDelay) {
    const sr = ctx.sampleRate, n = Math.floor(seconds * sr), pd = Math.floor((preDelay || 0.015) * sr);
    const buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0, lp2 = 0;
      for (let i = pd; i < n; i++) {
        const t = (i - pd) / (n - pd);
        const env = Math.exp(-4.6 * t) * (1 - t);
        const a = lerp(bright, dark, Math.sqrt(t));
        lp += a * ((Math.random() * 2 - 1) - lp);
        lp2 += a * (lp - lp2);
        d[i] = lp2 * env;
      }
      // a few soft early reflections
      for (let r = 0; r < 6; r++) {
        const at = pd + Math.floor(rand(0.004, 0.045) * sr);
        if (at < n) d[at] += rand(-0.35, 0.35);
      }
    }
    return buf;
  }

  // Vinyl surface: faint rumble/hiss + dust clicks + rare pops. Long, irregular → loop is inaudible.
  function crackleBuffer(ctx, seconds) {
    const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      a += 0.06 * ((Math.random() * 2 - 1) - a);
      b += 0.06 * ((Math.random() * 2 - 1) - b);
      L[i] = a * 0.018; R[i] = b * 0.018;
    }
    let t = 0;
    for (;;) {
      t += expRand(11);
      const i0 = Math.floor(t * sr);
      if (i0 >= n) break;
      const big = Math.random() < 0.035;
      const amp = (big ? rand(0.22, 0.5) : rand(0.02, 0.14) * Math.pow(Math.random(), 1.6)) * (Math.random() < 0.5 ? -1 : 1);
      const len = big ? randi(24, 70) : randi(3, 14);
      const bal = rand(0.25, 1), left = Math.random() < 0.5;
      for (let k = 0; k < len; k++) {
        const e = amp * Math.exp(-k / (len * 0.28)) * (k === 0 ? 1 : (Math.random() * 2 - 1) * 0.7);
        const j = (i0 + k) % n;
        L[j] += e * (left ? 1 : bal); R[j] += e * (left ? bal : 1);
      }
    }
    // soften: gentle lowpass + DC block
    for (const d of [L, R]) {
      let lp = 0, x1 = 0, y1 = 0;
      for (let i = 0; i < n; i++) {
        lp += 0.55 * (d[i] - lp);
        const y = lp - x1 + 0.995 * y1; x1 = lp; y1 = y;
        d[i] = y;
      }
    }
    return buf;
  }

  // Rain texture layers rendered once: 'fine' patter grains, 'glass' ticks, 'plink' drips.
  function rainLayerBuffer(ctx, seconds, kind) {
    const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const rate = kind === 'fine' ? 190 : kind === 'glass' ? 14 : 1.6;
    let t = rand(0, 0.02);
    for (;;) {
      t += expRand(rate);
      const i0 = Math.floor(t * sr);
      if (i0 >= n) break;
      const pan = Math.random(), gl = Math.sqrt(1 - pan), gr = Math.sqrt(pan);
      if (kind === 'fine') {
        // tiny filtered noise grain
        const amp = rand(0.02, 0.2) * Math.pow(Math.random(), 1.4);
        const len = randi(20, 110), a = rand(0.15, 0.7);
        let lp = 0, env = 1; const dec = Math.exp(-1 / (len * 0.25));
        for (let k = 0; k < len; k++) {
          lp += a * ((Math.random() * 2 - 1) - lp);
          const s = lp * env * amp; env *= dec;
          const j = (i0 + k) % n; L[j] += s * gl; R[j] += s * gr;
        }
      } else {
        // resonant drop: damped sine with slight upward chirp + transient
        const glass = kind === 'glass';
        const f = glass ? rand(2200, 6200) : rand(850, 1900);
        const tau = glass ? rand(0.002, 0.009) : rand(0.012, 0.032);
        const amp = (glass ? rand(0.04, 0.16) : rand(0.08, 0.2)) * Math.pow(Math.random(), 0.8);
        const chirp = glass ? rand(0, 0.15) : rand(0.15, 0.45);
        const len = Math.floor(tau * 7 * sr);
        let ph = 0, env = 1; const dec = Math.exp(-1 / (tau * sr));
        for (let k = 0; k < len; k++) {
          const tt = k / sr;
          ph += 2 * Math.PI * f * (1 + chirp * Math.min(1, tt / (tau * 2))) / sr;
          const tr = k < 24 ? (Math.random() * 2 - 1) * 0.6 * (1 - k / 24) : 0;
          const s = (Math.sin(ph) * (k < 6 ? k / 6 : 1) + tr) * env * amp; env *= dec;
          const j = (i0 + k) % n; L[j] += s * gl; R[j] += s * gr;
        }
      }
    }
    // Normalize so mix gains are meaningful: the dense patter by RMS (then soft-limited),
    // the sparse drop layers by peak (RMS-normalizing sparse clicks makes huge peaks).
    if (kind === 'fine') {
      let ss = 0;
      for (let i = 0; i < n; i++) ss += L[i] * L[i] + R[i] * R[i];
      const g = 0.1 / (Math.sqrt(ss / (2 * n)) || 1);
      for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * g * 2) * 0.5; R[i] = Math.tanh(R[i] * g * 2) * 0.5; }
    } else {
      let pk = 0;
      for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      const g = (kind === 'glass' ? 0.4 : 0.45) / (pk || 1);
      for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    }
    return buf;
  }

  // Nylon-ish Karplus–Strong pluck.
  function pluckBuffer(ctx, midi) {
    const sr = ctx.sampleRate, f = mtof(midi), n = Math.floor(1.8 * sr);
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / f - 0.5));
    const line = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) { lp += 0.45 * ((Math.random() * 2 - 1) - lp); line[i] = lp; }
    // pluck-position comb for a rounder tone
    const pp = Math.max(1, Math.floor(N * 0.18));
    for (let i = N - 1; i >= pp; i--) line[i] -= line[i - pp] * 0.5;
    const decay = clamp(0.9965 - (midi - 60) * 0.00018, 0.990, 0.9975);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const cur = line[idx], nxt = line[(idx + 1) % N];
      line[idx] = (cur + nxt) * 0.5 * decay;
      d[i] = cur;
      idx = (idx + 1) % N;
    }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    const g = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < n; i++) {
      const fi = i < 48 ? i / 48 : 1, fo = i > n - 3000 ? (n - i) / 3000 : 1;
      d[i] *= g * fi * fo;
    }
    return buf;
  }

  // Keyboard click: bright transient + small plastic body + bottom-out thock.
  function keyBuffer(ctx, space) {
    const sr = ctx.sampleRate, n = Math.floor((space ? 0.1 : 0.055) * sr);
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    const f1 = space ? rand(700, 1000) : rand(1700, 3000), f2 = f1 * rand(1.45, 1.85);
    const fb = space ? rand(140, 190) : rand(240, 380);
    const tb = space ? 0.02 : 0.009;
    let prev = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, w = Math.random() * 2 - 1;
      const click = (w - prev) * Math.exp(-t / 0.0012) * 0.45; prev = w;
      const body = (Math.sin(2 * Math.PI * f1 * t) * 0.5 + Math.sin(2 * Math.PI * f2 * t) * 0.22) * Math.exp(-t / 0.005);
      const thock = Math.sin(2 * Math.PI * fb * t) * Math.exp(-t / tb);
      const s = click + body * 0.3 + thock * 0.75;
      lp += 0.6 * (s - lp);
      d[i] = lp * 0.55 * (i < 3 ? i / 3 : 1) * (i > n - 40 ? (n - i) / 40 : 1);
    }
    return buf;
  }

  // Short mechanical click (lamp switch).
  function switchBuffer(ctx) {
    const sr = ctx.sampleRate, n = Math.floor(0.035 * sr);
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, w = Math.random() * 2 - 1;
      d[i] = ((w - prev) * Math.exp(-t / 0.0008) * 0.6 +
        Math.sin(2 * Math.PI * 2300 * t) * Math.exp(-t / 0.004) * 0.35 +
        Math.sin(2 * Math.PI * 610 * t) * Math.exp(-t / 0.007) * 0.3) * (i > n - 30 ? (n - i) / 30 : 1);
      prev = w;
    }
    return buf;
  }

  // ───────────────────────────── harmony data ─────────────────────────────
  // Chord qualities → 4 colour tones (semitones above chord root). Bass plays the root.
  const QUAL = {
    maj7: [4, 7, 11, 14], '6/9': [4, 9, 14, 19], 'maj7#11': [4, 11, 14, 18],
    m7: [3, 7, 10, 14], m11: [3, 10, 14, 17], m6: [3, 9, 14, 19],
    dom7: [4, 10, 14, 21], '7b9': [4, 10, 13, 21], '9sus': [5, 10, 14, 19],
    m7b5: [3, 6, 10, 14], dim7: [3, 6, 9, 12],
  };
  // [degree (semitones above tonic), quality, beats]
  const PROGS = [
    { minor: false, bright: 0.7, c: [[2, 'm7', 4], [7, 'dom7', 4], [0, 'maj7', 4], [9, '7b9', 4]] },
    { minor: false, bright: 0.75, c: [[5, 'maj7', 4], [4, 'm7', 4], [2, 'm7', 4], [0, 'maj7', 4]] },
    { minor: false, bright: 0.6, c: [[5, 'maj7', 4], [4, 'm7', 4], [9, 'm7', 4], [7, '9sus', 4]] },
    { minor: false, bright: 0.8, c: [[0, 'maj7', 4], [9, 'm7', 4], [2, 'm7', 4], [7, 'dom7', 4]] },
    { minor: false, bright: 0.45, c: [[5, 'maj7', 4], [5, 'm6', 4], [4, 'm7', 4], [9, 'dom7', 4]] },
    { minor: true, bright: 0.5, c: [[0, 'm7', 4], [5, 'm7', 4], [10, 'dom7', 4], [3, 'maj7', 4]] },
    { minor: true, bright: 0.4, c: [[8, 'maj7', 4], [7, 'dom7', 4], [0, 'm7', 4], [10, 'm7', 2], [3, 'dom7', 2]] },
    { minor: false, bright: 0.65, c: [[2, 'm7', 4], [7, 'dom7', 4], [4, 'm7', 4], [9, '7b9', 4]] },
    { minor: false, bright: 0.88, c: [[0, 'maj7', 4], [5, 'maj7#11', 4], [0, 'maj7', 4], [7, '9sus', 4]] },
    { minor: false, bright: 0.6, c: [[9, 'm7', 4], [5, 'maj7', 4], [0, 'maj7', 4], [7, '9sus', 4]] },
    { minor: true, bright: 0.22, c: [[2, 'm7b5', 4], [7, '7b9', 4], [0, 'm7', 4], [0, 'm6', 4]] },
    { minor: false, bright: 0.55, c: [[0, 'maj7', 4], [4, 'm7', 4], [5, 'maj7', 4], [5, 'm6', 4]] },
    { minor: false, bright: 0.62, c: [[5, 'maj7', 4], [7, 'dom7', 4], [4, 'm7', 4], [9, 'm7', 4]] },
    { minor: true, bright: 0.18, c: [[0, 'm7', 4], [8, 'maj7', 4], [3, 'maj7', 4], [10, '6/9', 4]] },
    { minor: true, bright: 0.42, c: [[0, 'm11', 4], [5, 'dom7', 4], [0, 'm11', 4], [5, 'dom7', 2], [7, 'm7', 2]] },
    { minor: false, bright: 0.5, c: [[0, 'maj7', 4], [11, 'm7b5', 2], [4, '7b9', 2], [9, 'm7', 4], [2, 'm7', 2], [7, 'dom7', 2]] },
  ];
  const NOTE_CA = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
  const TITLES = {
    nit: ['cafè de mitjanit', 'llum de flexo', 'mar de lluna', 'ciutat adormida', 'estels sobre el terrat',
      'fanals llunyans', 'insomni suau', 'la darrera pàgina', 'gat a la finestra', 'les tres i quart',
      'vaixells de nit', 'lluna de paper', 'silenci de pis alt', 'somnis en minúscula', 'neó sobre el mar', 'abans de dormir'],
    matinada: ['apunts de matinada', 'primer cafè', 'el mar es desperta', 'cel de préssec', 'coloms matiners',
      'boira sobre el port', 'llum de les sis', 'persianes a mitges', 'torrades i llibres', "l'alba a la teulada",
      'rosa de matí', 'els primers vaixells'],
    dia: ['coloms i geranis', 'terrats al sol', 'migdia blau', 'gavines de diumenge', 'plantes al balcó',
      'núvols de cotó', 'biblioteca de casa', 'brisa de ponent', 'roba estesa', 'passeig marítim',
      'llimonada i apunts', 'ones petites'],
    capvespre: ['terrats al capvespre', 'mandarina sobre el mar', 'hora daurada', "el sol se'n va", 'postal de setembre',
      'ombres llargues', 'cel de maduixa', 'tornant a casa', 'les set i mitja', "fanals que s'encenen",
      'reflexos de coure', 'últim raig'],
    pluja: ['pluja a la finestra', 'gotes al vidre', 'tarda de paraigües', 'tempesta llunyana', 'carrers molls',
      'te i trons', 'olor de terra mullada', 'el vidre plora', 'núvols de plom', 'pluja sobre el mar',
      'degoteig', 'manta i llibres'],
  };

  // ───────────────────────────── engine core ─────────────────────────────
  const CHANNELS = ['music', 'vinyl', 'rain', 'thunder', 'city', 'nature', 'room'];
  const DEFAULT_VOL = { master: 0.8, music: 0.7, rain: 0.7, thunder: 0.7, city: 0.3, nature: 0.5, room: 0.45, vinyl: 0.35 };
  const SEND = { rain: 0.1, thunder: 0.5, city: 0.32, nature: 0.26, room: 0.05 }; // outdoor reverb sends (post channel volume)
  const MAKEUP = 1.8;

  function setComp(c, thr, knee, ratio, att, rel) {
    c.threshold.value = thr; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = att; c.release.value = rel;
  }

  class LofiAudio {
    constructor() {
      this.ctx = null;
      this.started = false;
      this.musicOn = true;
      this.muted = false;
      this.paused = false;
      this.vol = Object.assign({}, DEFAULT_VOL);
      this.s = { dayTime: 0.3, rain: 0, storm: 0, typing: false, writing: false, catPurr: false };
      this.song = null;
      this.onSong = null;
      this.mus = null;
      this.ev = {};
      this._start = null;
      this._timer = 0;
      this._hidden = typeof document !== 'undefined' ? !!document.hidden : false;
      this._err = 0;
    }

    // ── public API ──
    start() {
      if (this._start) {
        if (this.ctx && this.ctx.state !== 'running' && !this.paused) this.ctx.resume().catch(() => {});
        return this._start;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return (this._start = Promise.reject(new Error('Web Audio API not available')));
      let ctx;
      try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }
      this.ctx = ctx;
      // resume synchronously inside the user gesture (Safari/iOS)
      const resumed = ctx.resume ? ctx.resume().catch(() => {}) : Promise.resolve();
      this._build();
      this.started = true;
      const t0 = ctx.currentTime + 0.3;
      this._startAmbience(t0);
      if (this.musicOn) this._startMusic(t0);
      this._timer = setInterval(() => this._tick(), 25);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { this._hidden = !!document.hidden; this._tick(); });
      }
      this._start = resumed.then(() => true);
      return this._start;
    }

    setPaused(p) {
      p = !!p;
      if (p === this.paused) return;
      this.paused = p;
      if (!this.ctx) return;
      const ctx = this.ctx;
      clearTimeout(this._pauseT);
      if (p) {
        reglide(this.pauseGain.gain, 0, ctx.currentTime, 0.06);
        this._pauseT = setTimeout(() => { if (this.paused) ctx.suspend().catch(() => {}); }, 380);
      } else {
        ctx.resume().catch(() => {}).then(() => {
          if (!this.paused) reglide(this.pauseGain.gain, 1, ctx.currentTime, 0.08);
          this._tick();
        });
      }
    }

    setMusicOn(on) {
      on = !!on;
      if (on === this.musicOn) return;
      this.musicOn = on;
      if (!this.ctx) return;
      const t = this.ctx.currentTime, mu = this.mus;
      if (on) {
        if (mu.running && mu.stopAt !== Infinity) mu.stopAt = Infinity; // still fading out → simply come back
        else if (!mu.running && !mu.restartAt) {
          if (t - mu.stoppedAt > 45) mu.needNew = true;
          this._startMusic(t + 0.12);
        }
        reglide(this.musicFade.gain, 1, t, 0.35);
        reglide(this.vinylFade.gain, 1, t, 0.5);
      } else {
        mu.stopAt = t + 1.6;
        if (mu.restartAt) { mu.restartAt = 0; mu.switching = false; mu.needNew = true; }
        reglide(this.musicFade.gain, 0, t, 0.38);
        reglide(this.vinylFade.gain, 0, t, 0.5);
      }
    }

    nextSong() {
      if (!this.ctx) return;
      const mu = this.mus, t = this.ctx.currentTime;
      if (!this.musicOn || !mu.running) { mu.needNew = true; mu.secIdx = 0; mu.secBar = 0; return; }
      if (mu.switching) return;
      mu.switching = true;
      mu.running = false;            // no new bars; what is already scheduled fades out
      mu.stoppedAt = t;
      mu.restartAt = t + 1.5;
      reglide(this.musicFade.gain, 0, t, 0.3);
      reglide(this.m.sweep.frequency, 260, t, 0.3);
      mu.anchors.push({ t, beat: 0, bpm: mu.song ? mu.song.bpm : 80, dur: 2, gap: true, drums: false }); // silent until the new song
    }

    getBeat() {
      const mu = this.mus;
      const bpm = mu && mu.song ? mu.song.bpm : 0;
      const off = { beat: null, bpm, playing: false };
      const ctx = this.ctx;
      if (!ctx || !mu || !this.musicOn || this.paused || !mu.running || mu.switching || ctx.state !== 'running') return off;
      const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      const at = ctx.currentTime - lat;
      let a = null;
      for (const x of mu.anchors) if (x.t <= at && (!a || x.t > a.t)) a = x;
      if (!a || a.gap || at > a.t + a.dur * 1.5) return off;
      // `drums`: extra hint — true while the beat (kick/snare) is actually playing in this bar
      return { beat: a.beat + (at - a.t) * a.bpm / 60, bpm: a.bpm, playing: true, drums: a.drums };
    }

    _g(ch) { const v = this.vol[ch]; return v * v; }

    setVolume(ch, v) {
      if (!(ch in this.vol)) return;
      v = clamp(Number(v) || 0, 0, 1);
      this.vol[ch] = v;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      if (ch === 'master') { if (!this.muted) reglide(this.masterGain.gain, this._g('master'), t, 0.05); }
      else reglide(this.ch[ch].gain, this._g(ch), t, 0.05);
    }

    getVolume(ch) { return this.vol[ch]; }

    setMuted(m) {
      this.muted = !!m;
      if (!this.ctx) return;
      reglide(this.masterGain.gain, this.muted ? 0 : this._g('master'), this.ctx.currentTime, 0.08);
    }

    update(s) {
      if (!s) return;
      const S = this.s;
      if (Number.isFinite(s.dayTime)) S.dayTime = ((s.dayTime % 1) + 1) % 1;
      if (Number.isFinite(s.rain)) S.rain = clamp(s.rain, 0, 1);
      if (Number.isFinite(s.storm)) S.storm = clamp(s.storm, 0, 1);
      if (typeof s.typing === 'boolean') S.typing = s.typing;
      if (typeof s.writing === 'boolean') S.writing = s.writing;
      if (typeof s.catPurr === 'boolean') S.catPurr = s.catPurr;
      if (this.ctx && this.started) this._applyAmbience();
    }

    // Debug helper: {master|channel: {peak, rms}} over the last ~46 ms.
    debugLevels() {
      if (!this.ctx) return null;
      if (!this._meters) {
        this._meters = {};
        const mk = (node) => { const a = this.ctx.createAnalyser(); a.fftSize = 2048; node.connect(a); return a; };
        this._meters.master = mk(this.limiter);
        for (const n of CHANNELS) this._meters[n] = mk(this.ch[n]);
        this._meterBuf = new Float32Array(2048);
      }
      const out = {}, b = this._meterBuf;
      for (const k in this._meters) {
        const a = this._meters[k];
        if (!a.getFloatTimeDomainData) continue;
        a.getFloatTimeDomainData(b);
        let pk = 0, ss = 0;
        for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > pk) pk = v; ss += v * v; }
        out[k] = { peak: pk, rms: Math.sqrt(ss / b.length) };
      }
      return out;
    }

    // ── node helpers ──
    _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
    _filter(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
    _pan(p) {
      const c = this.ctx;
      if (c.createStereoPanner) { const s = c.createStereoPanner(); s.pan.value = clamp(p, -1, 1); return s; }
      return c.createGain();
    }
    _osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
    _src(buffer, loop) { const s = this.ctx.createBufferSource(); s.buffer = buffer; s.loop = !!loop; return s; }
    // Disconnect a voice's nodes once its (last) source has ended → no leaks over hours.
    _free(src, nodes) {
      src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } } };
    }
    _noise(t, dur, out, offset) { // white-noise one-shot source
      const s = this._src(this.buf.white, true);
      s.connect(out);
      s.start(t, offset != null ? offset : rand(0, 2));
      s.stop(t + dur);
      return s;
    }

    // ── graph ──
    _build() {
      const ctx = this.ctx;
      this.buf = {
        white: noiseBuffer(ctx, 2.3, 'white', 1),
        pink: noiseBuffer(ctx, 6.7, 'pink', 2),
        brown: noiseBuffer(ctx, 7.9, 'brown', 2),
        keys: [], spaces: [], click: switchBuffer(ctx), pluck: new Map(),
      };
      for (let i = 0; i < 6; i++) this.buf.keys.push(keyBuffer(ctx, false));
      for (let i = 0; i < 2; i++) this.buf.spaces.push(keyBuffer(ctx, true));

      this.limiter = ctx.createDynamicsCompressor();
      setComp(this.limiter, -3, 1, 20, 0.002, 0.15);
      this.makeup = this._gain(MAKEUP);
      this.pauseGain = this._gain(1);
      this.masterGain = this._gain(this.muted ? 0 : this._g('master'));
      this.masterGain.connect(this.pauseGain);
      this.pauseGain.connect(this.makeup);
      this.makeup.connect(this.limiter);
      // final safety: transparent below ~-3 dBFS, smoothly saturates towards 1.0 (never hard-clips)
      this.clipper = ctx.createWaveShaper();
      const cn = 4096, cc = new Float32Array(cn);
      for (let i = 0; i < cn; i++) {
        const x = (i / (cn - 1)) * 4 - 2, ax = Math.abs(x);
        cc[i] = Math.sign(x) * (ax < 0.7 ? ax : 0.7 + 0.3 * Math.tanh((ax - 0.7) / 0.3));
      }
      this.clipper.curve = cc; this.clipper.oversample = '2x';
      this.clipPre = this._gain(0.5); // curve spans inputs [-2, 2] → the shaper sees [-1, 1]
      this.limiter.connect(this.clipPre); this.clipPre.connect(this.clipper);
      this.clipper.connect(ctx.destination);

      this.outVerb = ctx.createConvolver();
      this.outVerb.buffer = impulse(ctx, 3.6, 0.3, 0.035, 0.03);
      const vOut = this._gain(0.9);
      this.outVerb.connect(vOut); vOut.connect(this.masterGain);

      this.ch = {};
      for (const name of CHANNELS) {
        const g = this._gain(this._g(name));
        g.connect(this.masterGain);
        if (SEND[name]) { const s = this._gain(SEND[name]); g.connect(s); s.connect(this.outVerb); }
        this.ch[name] = g;
      }
      this._buildMusic();
      this._buildAmbience();
    }

    _tick() {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const horizon = now + (this._hidden ? 1.7 : 0.32);
      try { this._musicTick(now, horizon); } catch (e) { this._report(e); }
      try { this._ambTick(now, horizon); } catch (e) { this._report(e); }
    }

    _report(e) { if (this._err++ < 6) console.error('[LofiAudio]', e); }
  }

  const P = LofiAudio.prototype;

  // ───────────────────────────── music: data ─────────────────────────────
  const MOOD = {
    nit: { bright: 0.22, bpm: [68, 74], lp: 3000, rev: 0.62, felt: 0.45, lead: [0.45, 0.2, 0.35] },
    matinada: { bright: 0.6, bpm: [72, 79], lp: 4300, rev: 0.48, felt: 0.3, lead: [0.4, 0.35, 0.25] },
    dia: { bright: 0.8, bpm: [77, 86], lp: 5200, rev: 0.38, felt: 0.2, lead: [0.35, 0.45, 0.2] },
    capvespre: { bright: 0.45, bpm: [72, 80], lp: 4000, rev: 0.52, felt: 0.3, lead: [0.4, 0.3, 0.3] },
    pluja: { bright: 0.3, bpm: [66, 74], lp: 2900, rev: 0.66, felt: 0.5, lead: [0.45, 0.25, 0.3] },
  };
  const KICKS = [
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0.9, 0, 0, 0, 0, 0],
    [1, 0, 0, 0.5, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0, 0.45, 0],
    [1, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0.35, 0, 0],
  ];
  const SNARES = [
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.22],
    [0, 0, 0, 0, 1, 0, 0, 0.16, 0, 0, 0, 0, 1, 0, 0, 0],
  ];
  // comping hits within a one-bar chord: [step, lengthSteps, velocity]
  const COMP = [
    [[0, 14, 1]],
    [[0, 6, 1], [6, 9, 0.8]],
    [[0, 7, 1], [10, 6, 0.78]],
    [[0, 3, 1], [3, 5, 0.72], [10, 6, 0.82]],
    [[0, 8, 1], [8, 8, 0.86]],
    [[2, 6, 0.92], [8, 3, 0.72], [11, 5, 0.82]],
  ];
  // bass: [step, lengthSteps, r=root 5=fifth 8=octave a=approach]
  const BASSPAT = [
    [[0, 10, 'r'], [10, 5, 'r']],
    [[0, 7, 'r'], [7, 3, '5'], [10, 4, 'r'], [14, 2, 'a']],
    [[0, 14, 'r'], [14, 2, 'a']],
    [[0, 6, 'r'], [6, 4, '8'], [10, 6, 'r']],
    [[0, 3, 'r'], [3, 7, 'r'], [10, 4, '5'], [14, 2, 'a']],
  ];
  // melody rhythms over a 2-bar phrase (16th steps 0..31)
  const RHY = [[0, 3, 6, 10], [0, 2, 4, 8, 14], [2, 6, 8, 12, 18], [0, 6, 12, 16, 22], [4, 6, 8, 14, 16],
    [0, 3, 8, 11, 16, 19], [0, 4, 10, 16, 20, 26], [6, 8, 10, 16], [0, 2, 3, 6, 16, 18]];

  function drop2(v) {
    const a = v.slice();
    const x = a.splice(a.length - 2, 1)[0] - 12;
    a.unshift(x);
    return a.sort((p, q) => p - q);
  }

  // ───────────────────────────── music: graph ─────────────────────────────
  P._buildMusic = function () {
    const ctx = this.ctx, m = (this.m = {});
    m.in = this._gain(1);
    m.pre = this._gain(0.8);
    m.sat = ctx.createWaveShaper();
    const N = 2048, curve = new Float32Array(N), k = 1.35, nk = Math.tanh(k);
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / nk; }
    m.sat.curve = curve; m.sat.oversample = '2x';
    m.post = this._gain(0.72);
    m.hp = this._filter('highpass', 32, 0.6);
    m.lp = this._filter('lowpass', 4200, 0.55);
    m.sweep = this._filter('lowpass', 20000, 0.5);
    m.wob = ctx.createDelay(0.1); m.wob.delayTime.value = 0.02;
    m.comp = ctx.createDynamicsCompressor(); setComp(m.comp, -20, 10, 2.6, 0.015, 0.25);
    this.musicFade = this._gain(this.musicOn ? 1 : 0);
    m.in.connect(m.pre); m.pre.connect(m.sat); m.sat.connect(m.post); m.post.connect(m.hp); m.hp.connect(m.lp);
    m.lp.connect(m.sweep); m.sweep.connect(m.wob); m.wob.connect(m.comp); m.comp.connect(this.musicFade);
    this.musicFade.connect(this.ch.music);
    // tape wow & flutter (pitch wobble of the whole mix)
    const wow = this._osc('sine', 0.43), wowG = this._gain(0.0011);
    const flut = this._osc('sine', 5.7), flutG = this._gain(0.00005);
    wow.connect(wowG); wowG.connect(m.wob.delayTime); flut.connect(flutG); flutG.connect(m.wob.delayTime);
    wow.start(); flut.start();
    // dark room reverb
    m.revSend = this._gain(1);
    m.rev = ctx.createConvolver(); m.rev.buffer = impulse(ctx, 2.6, 0.38, 0.05, 0.018);
    m.revOut = this._gain(0.5);
    m.revSend.connect(m.rev); m.rev.connect(m.revOut); m.revOut.connect(m.lp);
    // drums
    m.drums = this._gain(1); m.drumLP = this._filter('lowpass', 6800, 0.5);
    m.drums.connect(m.drumLP); m.drumLP.connect(m.in);
    m.drumSend = this._gain(0.1); m.drumLP.connect(m.drumSend); m.drumSend.connect(m.revSend);
    m.snareSend = this._gain(0.22); m.snareSend.connect(m.revSend);
    m.hatHP = this._filter('highpass', 6800, 0.5); m.hatBP = this._filter('bandpass', 9800, 0.6);
    m.hatHP.connect(m.hatBP); m.hatBP.connect(m.drums);
    m.snBP = this._filter('bandpass', 1900, 0.75); m.snBP.connect(m.drums); m.snBP.connect(m.snareSend);
    m.rimBP = this._filter('bandpass', 2900, 3.5); m.rimBP.connect(m.drums); m.rimBP.connect(m.snareSend);
    m.shkBP = this._filter('bandpass', 5600, 1.3); m.shkBP.connect(m.drums);
    // keys: sidechain pump + slow auto-pan
    m.keys = this._gain(1); m.keysPan = this._pan(0);
    m.keys.connect(m.keysPan); m.keysPan.connect(m.in);
    m.keysSend = this._gain(0.34); m.keysPan.connect(m.keysSend); m.keysSend.connect(m.revSend);
    if (m.keysPan.pan) { const ap = this._osc('sine', 0.11), apg = this._gain(0.22); ap.connect(apg); apg.connect(m.keysPan.pan); ap.start(); }
    // bass
    m.bass = this._gain(1); m.bassLP = this._filter('lowpass', 620, 0.7);
    m.bass.connect(m.bassLP); m.bassLP.connect(m.in);
    // lead: vibraphone tremolo, tape echo, big reverb
    m.lead = this._gain(1); m.trem = this._gain(1);
    m.lead.connect(m.trem); m.trem.connect(m.in);
    m.tremLFO = this._osc('sine', 5.2); m.tremDepth = this._gain(0);
    m.tremLFO.connect(m.tremDepth); m.tremDepth.connect(m.trem.gain); m.tremLFO.start();
    m.leadSend = this._gain(0.5); m.trem.connect(m.leadSend); m.leadSend.connect(m.revSend);
    m.echo = ctx.createDelay(2); m.echo.delayTime.value = 0.5;
    m.echoFB = this._gain(0.3); m.echoLP = this._filter('lowpass', 2400, 0.5); m.echoOut = this._gain(0.26);
    m.trem.connect(m.echo); m.echo.connect(m.echoLP); m.echoLP.connect(m.echoFB); m.echoFB.connect(m.echo);
    m.echoLP.connect(m.echoOut); m.echoOut.connect(m.in);
    // vinyl bed (fades with the music)
    this.vinylFade = this._gain(this.musicOn ? 1 : 0); this.vinylFade.connect(this.ch.vinyl);
    this.buf.crackle = crackleBuffer(ctx, 12.7);
    m.crackleG = this._gain(2.5);
    m.crackle = this._src(this.buf.crackle, true); m.crackle.connect(m.crackleG); m.crackleG.connect(this.vinylFade); m.crackle.start();
    const hiss = this._src(this.buf.pink, true), hHP = this._filter('highpass', 3200, 0.5),
      hLP = this._filter('lowpass', 9000, 0.5), hG = this._gain(0.25);
    hiss.connect(hHP); hHP.connect(hLP); hLP.connect(hG); hG.connect(this.vinylFade); hiss.start(0, 1.3);

    this.mus = {
      running: false, song: null, needNew: true, barTime: 0, barDur: 3, stepDur: 0.19, stopAt: Infinity,
      restartAt: 0, stoppedAt: -1e9, switching: false, secIdx: 0, secBar: 0, songBar: 0, gapBars: 0,
      voicing: null, barVoicings: [], anticipated: false, anchors: [], recentProg: [], recentTitles: [], lastRoot: -1,
      mel: { plan: null, motif: null, anchor: 76 },
    };
  };

  // ───────────────────────────── music: songs ─────────────────────────────
  P._moodNow = function () {
    const d = this.s.dayTime, r = this.s.rain;
    if (r > 0.35) return 'pluja';
    if (d < 0.2 || d >= 0.84) return 'nit';
    if (d < 0.33) return 'matinada';
    if (d < 0.66) return 'dia';
    return 'capvespre';
  };

  P._genSections = function () {
    const S = [];
    S.push({ n: 'intro', bars: 4, drums: 0, hats: chance(0.45), bass: 0, keys: 1, pad: 1, lead: 0, lp: [0.42, 0.78] });
    S.push({ n: 'groove', bars: 8, drums: 1, bass: 1, keys: 1, pad: 0, lead: chance(0.25) ? 0.5 : 0, lp: [1, 1] });
    S.push({ n: 'theme', bars: chance(0.5) ? 16 : 8, drums: 1, bass: 1, keys: 1, pad: chance(0.3) ? 1 : 0, lead: 1, lp: [1, 1] });
    if (chance(0.6)) S.push({ n: 'groove2', bars: 8, drums: 1, bass: 1, keys: 1, pad: 0, lead: 0.5, lp: [1, 1] });
    S.push({ n: 'break', bars: chance(0.5) ? 8 : 4, drums: 0, hats: chance(0.5), bass: chance(0.5) ? 1 : 0, keys: 1, pad: 1,
      lead: chance(0.4) ? 0.5 : 0, lp: [0.62, 0.5] });
    S.push({ n: 'theme2', bars: chance(0.5) ? 16 : 8, drums: 1, bass: 1, keys: 1, pad: chance(0.4) ? 1 : 0, lead: 1, lp: [0.85, 1] });
    S.push({ n: 'outro', bars: 4, drums: 0.5, bass: 1, keys: 1, pad: 1, lead: 0, lp: [0.85, 0.35], last: true });
    return S;
  };

  P._genSong = function () {
    const mu = this.mus, mood = this._moodNow(), M = MOOD[mood];
    const w = PROGS.map((p, i) => (mu.recentProg.includes(i) ? 0.04 : 1) * Math.exp(-Math.pow((p.bright - M.bright) / 0.25, 2)));
    const pi = wpickIndex(w);
    mu.recentProg.push(pi); if (mu.recentProg.length > 5) mu.recentProg.shift();
    const prog = PROGS[pi];
    let root = randi(0, 11); if (root === mu.lastRoot) root = (root + 5) % 12; mu.lastRoot = root;
    const segs = []; let pos = 0;
    for (const [deg, q, beats] of prog.c) { segs.push({ root: (root + deg) % 12, q, start: pos, len: beats * 4 }); pos += beats * 4; }
    const progBars = Math.ceil(pos / 16), timeline = [];
    for (let b = 0; b < progBars; b++) {
      const lo = b * 16, hi = lo + 16, list = [];
      for (const s of segs) {
        const a = Math.max(lo, s.start), e = Math.min(hi, s.start + s.len);
        if (e > a) list.push({ root: s.root, q: s.q, start: a - lo, len: e - a });
      }
      timeline.push(list);
    }
    const titles = TITLES[mood].filter((t) => !mu.recentTitles.includes(t));
    const title = pick(titles.length ? titles : TITLES[mood]);
    mu.recentTitles.push(title); if (mu.recentTitles.length > 14) mu.recentTitles.shift();
    const lead = wpick(['mallet', 'pluck', 'flute'], M.lead);
    const scale = prog.minor ? [0, 2, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
    return {
      title, mood, root, minor: prog.minor, timeline, progBars,
      bpm: randi(M.bpm[0], M.bpm[1]),
      key: NOTE_CA[root] + (prog.minor ? ' menor' : ' major'),
      swing: rand(0.555, 0.61),
      keysType: chance(M.felt) ? 'felt' : 'rhodes',
      lead, leadCenter: lead === 'flute' ? randi(72, 76) : randi(74, 79),
      scale: scale.map((x) => (x + root) % 12), scaleNotes: null,
      kick: randi(0, KICKS.length - 1), snare: randi(0, SNARES.length - 1),
      snareType: chance(0.4) ? 'rim' : 'snare', hatDens: rand(0.15, 0.5), shaker: chance(0.3),
      comp: randi(0, COMP.length - 1), push: rand(0.2, 0.55), bassPat: randi(0, BASSPAT.length - 1),
      pump: rand(0.16, 0.3), lp: M.lp, rev: M.rev,
      sections: this._genSections(),
    };
  };

  P._newSong = function () {
    const mu = this.mus, song = this._genSong(), m = this.m, t = this.ctx.currentTime;
    mu.song = song; mu.secIdx = 0; mu.secBar = 0; mu.songBar = 0; mu.gapBars = 0;
    mu.voicing = null; mu.barVoicings = []; mu.anticipated = false;
    mu.stepDur = 60 / song.bpm / 4; mu.barDur = mu.stepDur * 16;
    mu.mel = { plan: null, motif: this._genMotif(), anchor: song.leadCenter };
    glide(m.revOut.gain, song.rev, t, 1.2);
    glide(m.echo.delayTime, mu.stepDur * 3, t, 0.25);
    glide(m.tremDepth.gain, song.lead === 'mallet' ? 0.2 : 0, t, 0.3);
    glide(m.leadSend.gain, song.lead === 'flute' ? 0.62 : 0.5, t, 0.3);
    this.song = { title: song.title, key: song.key, bpm: song.bpm, mood: song.mood };
    if (typeof this.onSong === 'function') {
      const info = Object.assign({}, this.song);
      setTimeout(() => { try { this.onSong(info); } catch (e) { this._report(e); } }, 0);
    }
  };

  // ───────────────────────────── music: transport ─────────────────────────────
  P._startMusic = function (t) {
    const mu = this.mus;
    mu.running = true; mu.stopAt = Infinity; mu.barTime = t;
  };

  P._musicTick = function (now, horizon) {
    const mu = this.mus;
    if (mu.restartAt && !mu.running) {
      if (!this.musicOn) { mu.restartAt = 0; mu.switching = false; mu.needNew = true; }
      else if (mu.restartAt < horizon) {
        const at = Math.max(mu.restartAt, now + 0.03);
        mu.restartAt = 0; mu.switching = false; mu.needNew = true;
        mu.running = true; mu.stopAt = Infinity; mu.barTime = at;
        this.musicFade.gain.setTargetAtTime(1, at, 0.2);
        this.m.sweep.frequency.setTargetAtTime(20000, at + 0.05, 0.5);
      }
    }
    if (!mu.running) return;
    if (mu.stopAt !== Infinity && now >= mu.stopAt) { mu.running = false; mu.stoppedAt = now; return; }
    if (mu.barTime < now - 0.05) mu.barTime = now + 0.06; // main thread stalled → resync, never burst
    let guard = 0;
    while (mu.barTime < horizon && mu.barTime < mu.stopAt && guard++ < 4) {
      this._scheduleBar(mu.barTime);
      mu.barTime += mu.barDur;
    }
  };

  P._anchor = function (t, gap, drums) {
    const mu = this.mus;
    mu.anchors.push({ t, beat: gap ? 0 : mu.songBar * 4, bpm: mu.song ? mu.song.bpm : 80, dur: mu.barDur, gap, drums: !!drums });
    if (mu.anchors.length > 8) mu.anchors.shift();
  };

  // time of 16th step `step` in the bar starting at t (swing applied; works past 15 too)
  P._st = function (t, step) {
    const mu = this.mus, sd = mu.stepDur;
    return t + (step >> 1) * 2 * sd + ((step & 1) ? 2 * sd * mu.song.swing : 0);
  };

  P._scheduleBar = function (t) {
    const mu = this.mus;
    if (mu.gapBars > 0) { // a breath of vinyl between songs
      this._anchor(t, true);
      mu.gapBars--;
      if (mu.gapBars === 0) mu.needNew = true;
      return;
    }
    if (mu.needNew || !mu.song) { mu.needNew = false; this._newSong(); }
    const song = mu.song, sec = song.sections[mu.secIdx];
    this._anchor(t, false, sec.drums > 0 && !(sec.last && mu.secBar === sec.bars - 1));
    // section/mood filter: sweep towards the end-of-bar target
    const k1 = (mu.secBar + 1) / sec.bars;
    const fac = lerp(sec.lp[0], sec.lp[1], k1);
    const base = song.lp * (1 - 0.22 * this.s.rain);
    this.m.lp.frequency.setTargetAtTime(240 * Math.pow(base / 240, fac), t, mu.barDur / 3);

    const chords = song.timeline[mu.songBar % song.progBars];
    const next = song.timeline[(mu.songBar + 1) % song.progBars];
    const last = !!sec.last && mu.secBar === sec.bars - 1;
    const velMul = sec.n === 'intro' || sec.n === 'outro' || sec.n === 'break' ? 0.82 : 1;
    if (sec.keys) this._compBar(t, chords, next, sec, velMul, last);
    if (sec.pad) this._padBar(t, chords, last);
    if (sec.bass) this._bassBar(t, chords, next, sec, last);
    if (sec.drums || sec.hats) this._drumBar(t, sec, last);
    if (sec.lead) this._leadBar(t, chords, sec);

    mu.songBar++; mu.secBar++;
    if (mu.secBar >= sec.bars) {
      mu.secBar = 0; mu.secIdx++;
      if (mu.secIdx >= song.sections.length) {
        mu.secIdx = 0;
        mu.gapBars = 1; // the last chord rings into this bar → never overlap a new key
      }
    }
  };

  // ───────────────────────────── music: parts ─────────────────────────────
  P._voice = function (ch) {
    const mu = this.mus, prev = mu.voicing;
    const pcs = QUAL[ch.q].map((x) => (ch.root + x) % 12);
    let best = null, bestScore = Infinity, fallback = null;
    for (let r = 0; r < pcs.length; r++) {
      const order = pcs.slice(r).concat(pcs.slice(0, r));
      for (let base = 48; base <= 64; base++) {
        if (base % 12 !== order[0]) continue;
        const v = [base];
        for (let i = 1; i < order.length; i++) {
          let n = v[i - 1] + ((((order[i] - v[i - 1]) % 12) + 12) % 12);
          if (n === v[i - 1]) n += 12;
          v.push(n);
        }
        if (!fallback) fallback = v;
        for (const cand of [v, drop2(v)]) {
          const lo = cand[0], hi = cand[cand.length - 1];
          if (lo < 50 || hi > 78) continue;
          let sc = Math.abs((lo + hi) / 2 - 63.5) * 0.7;
          if (prev && prev.length === cand.length) for (let i = 0; i < cand.length; i++) sc += Math.abs(cand[i] - prev[i]);
          if (cand[1] - cand[0] <= 2 && lo < 58) sc += 5; // no muddy low clusters
          sc += Math.random() * 0.8;                      // tiny variety between equal options
          if (sc < bestScore) { bestScore = sc; best = cand; }
        }
      }
    }
    mu.voicing = best || fallback;
    return mu.voicing;
  };

  P._playChord = function (t, v, dur, vel) {
    const song = this.mus.song, up = chance(0.8), strum = rand(0.008, 0.028);
    for (let i = 0; i < v.length; i++) {
      const j = up ? i : v.length - 1 - i;
      const nt = t + i * strum + gauss() * 0.003;
      const nv = clamp(vel * rand(0.82, 1) * (1 + (64 - v[j]) * 0.006), 0.2, 1);
      if (song.keysType === 'felt') this._felt(nt, v[j], nv, dur); else this._rhodes(nt, v[j], nv, dur);
    }
  };

  P._compBar = function (t, chords, next, sec, velMul, last) {
    const mu = this.mus, song = mu.song, sd = mu.stepDur;
    const soft = sec.n === 'intro' || sec.n === 'break' || sec.n === 'outro';
    const skipFirst = mu.anticipated;
    mu.anticipated = false;
    const lastCh = chords[chords.length - 1];
    const antic = !soft && !last && next && next[0] && lastCh && mu.secBar + 1 < sec.bars &&
      !(next[0].root === lastCh.root && next[0].q === lastCh.q) && chance(song.push);
    mu.barVoicings = [];
    for (let ci = 0; ci < chords.length; ci++) {
      const ch = chords[ci];
      let hits;
      if (last) hits = [[0, ch.len + 10, 0.9]];            // final chord rings out
      else if (soft) hits = [[0, ch.len - 1, 0.95]];
      else if (ch.len >= 16) hits = COMP[song.comp];
      else hits = COMP[song.comp].length >= 3 ? [[0, 3, 1], [3, ch.len - 4, 0.75]] : [[0, ch.len - 1, 1]];
      const voicing = (ci === 0 && skipFirst && mu.voicing) ? mu.voicing : this._voice(ch);
      mu.barVoicings[ci] = voicing;
      for (const [st, len, v] of hits) {
        if (st >= ch.len && !last) continue;
        if (ci === 0 && st === 0 && skipFirst) continue;
        let end = st + len;
        if (antic && ci === chords.length - 1) end = Math.min(end, 14 - ch.start);
        if (end <= st) continue;
        const a = this._st(t, ch.start + st), b = last ? a + (end - st) * sd : this._st(t, ch.start + end);
        this._playChord(a, voicing, Math.max(0.12, b - a), v * velMul);
      }
    }
    if (antic) { // push the next chord an 8th early; it sustains through what its downbeat hit would have
      const v2 = this._voice(next[0]), pat = COMP[song.comp];
      const d = next[0].len < 16 ? 2 + (pat.length >= 3 ? 3 : next[0].len - 1) : 2 + (pat[0][0] === 0 ? pat[0][1] : pat[0][0]);
      const a = this._st(t, 14);
      this._playChord(a, v2, this._st(t, 14 + d) - a, 0.95 * velMul);
      mu.anticipated = true;
    }
  };

  P._padBar = function (t, chords, last) {
    const mu = this.mus;
    for (let ci = 0; ci < chords.length; ci++) {
      const ch = chords[ci], v = mu.barVoicings[ci] || this._voice(ch);
      const a = this._st(t, ch.start);
      const b = last ? a + mu.barDur * 1.3 : this._st(t, ch.start + ch.len);
      for (const n of v) this._pad(a, n, b - a + 0.05);
    }
  };

  P._bassBar = function (t, chords, next, sec, last) {
    const song = this.mus.song, sd = this.mus.stepDur;
    const low = (pc) => 33 + ((pc - 33) % 12 + 12) % 12; // A1..G#2
    for (let ci = 0; ci < chords.length; ci++) {
      const ch = chords[ci], root = low(ch.root);
      const nxt = ci + 1 < chords.length ? chords[ci + 1] : next && next[0];
      let pat;
      if (last) pat = [[0, 22, 'r']];
      else if (sec.n === 'break' || sec.n === 'intro') pat = [[0, ch.len, 'r']];
      else if (ch.len >= 16) pat = BASSPAT[song.bassPat];
      else pat = [[0, ch.len - 2, 'r'], [ch.len - 2, 2, 'a']];
      for (const [st, len, kind] of pat) {
        if (st >= ch.len) continue;
        let note = root, vel = rand(0.85, 1);
        if (kind === '5') note = root + 7 > 47 ? root - 5 : root + 7;
        else if (kind === '8') note = root + 12 <= 50 ? root + 12 : root;
        else if (kind === 'a') {
          if (!nxt || !chance(0.65)) continue;
          const nr = low(nxt.root);
          if (nr === root) continue;
          note = nr + (chance(0.6) ? -1 : 1);
          vel *= 0.72;
        }
        const a = this._st(t, ch.start + st);
        const b = last ? a + len * sd : this._st(t, ch.start + Math.min(st + len, ch.len));
        this._bass(a, note, vel, Math.max(0.08, b - a - 0.02));
      }
    }
  };

  P._drumBar = function (t, sec, last) {
    const mu = this.mus, song = mu.song;
    const full = sec.drums >= 1, soft = sec.drums > 0 && sec.drums < 1, hatsOnly = !sec.drums && sec.hats;
    const phraseEnd = (mu.secBar % 8) === 7 || mu.secBar === sec.bars - 1;
    const fill = full && phraseEnd && !last ? pick(['ghost', 'drop', 'stop', 'kick', 'none']) : 'none';
    const K = KICKS[song.kick].slice(), S = SNARES[song.snare].slice();
    if (fill === 'ghost') { S[13] = 0.25; S[15] = 0.35; }
    else if (fill === 'drop') { K[9] = 0; K[10] = 0; }
    else if (fill === 'kick') { K[14] = 0.6; K[15] = 0; }
    if (last) for (let i = 1; i < 16; i++) { K[i] = 0; S[i] = 0; }
    for (let s = 0; s < 16; s++) {
      if (fill === 'stop' && s >= 12) break;
      if (last && s >= 4) break;
      const st = this._st(t, s);
      if (!hatsOnly) {
        if (K[s]) this._kick(st + gauss() * 0.002, K[s] * (soft ? 0.72 : 1) * rand(0.9, 1));
        if (S[s] && !(soft && S[s] < 0.5)) this._snare(st + rand(0.01, 0.022), S[s] * rand(0.85, 1) * (soft ? 0.8 : 1));
      }
      let hv = 0;
      if ((s & 1) === 0) hv = (s % 4 === 0 ? 0.85 : 0.55) * rand(0.8, 1.05);
      else if (chance(song.hatDens)) hv = rand(0.16, 0.3);
      if (hv) {
        const open = !hatsOnly && (s === 6 || s === 14) && chance(0.12);
        this._hat(st + gauss() * 0.004, hv * (hatsOnly ? 0.65 : 1), open);
      }
      if (song.shaker && !hatsOnly && (s & 1)) this._shaker(st, rand(0.3, 0.5));
    }
  };

  P._genMotif = function () {
    const r = pick(RHY), notes = [];
    let deg = 0;
    for (let i = 0; i < r.length; i++) {
      if (i > 0) deg += wpick([-2, -1, 1, 2, 0, 3, -3], [0.12, 0.28, 0.26, 0.12, 0.08, 0.07, 0.07]);
      deg = clamp(deg, -4, 5);
      const nextOn = i + 1 < r.length ? r[i + 1] : 32;
      const len = Math.max(1, Math.min(nextOn - r[i] - (chance(0.3) ? 1 : 0), i === r.length - 1 ? 10 : 6));
      notes.push({ step: r[i], len, deg });
    }
    return notes;
  };

  P._variant = function (motif, kind) {
    if (kind === 'answer') {
      const n = randi(2, 3), start = pick([16, 18, 20]), out = [];
      let d = motif[motif.length - 1].deg + pick([-1, 1, 2]);
      let st = start;
      for (let i = 0; i < n && st < 32; i++) {
        out.push({ step: st, len: i === n - 1 ? 6 : 2, deg: d });
        st += pick([2, 3, 4]); d += pick([-1, -1, 1, -2]);
      }
      return out;
    }
    if (kind === 'cadence') {
      const n = randi(1, 3), out = [], d = pick([0, 2, -1]);
      for (let i = 0; i < n; i++) out.push({ step: [0, 3, 6][i] + (i === 0 ? pick([0, 2]) : 0), len: i === n - 1 ? 14 : 3, deg: d + (n - 1 - i) });
      return out;
    }
    const v = motif.map((x) => Object.assign({}, x));
    if (kind === 'vary') {
      v[v.length - 1].deg += pick([-2, -1, 1, 2]);
      if (v.length > 3 && chance(0.5)) v[v.length - 2].deg += pick([-1, 1]);
      if (chance(0.4) && v.length > 2) {
        const j = randi(1, v.length - 1);
        v[j].step = clamp(v[j].step + pick([-1, 1]), v[j - 1].step + 1, 31);
      }
    }
    return v;
  };

  P._leadPitch = function (deg, ch, strong) {
    const mu = this.mus, song = mu.song;
    if (!song.scaleNotes) {
      song.scaleNotes = [];
      for (let m = song.leadCenter - 10; m <= song.leadCenter + 12; m++) if (song.scale.includes(m % 12)) song.scaleNotes.push(m);
    }
    const sn = song.scaleNotes;
    let ai = 0, bd = 1e9;
    for (let i = 0; i < sn.length; i++) { const d = Math.abs(sn[i] - mu.mel.anchor); if (d < bd) { bd = d; ai = i; } }
    let m = sn[clamp(ai + deg, 0, sn.length - 1)];
    const chordPcs = [ch.root].concat(QUAL[ch.q].map((x) => (ch.root + x) % 12));
    const ok = (pc) => chordPcs.includes(pc) ||
      (!strong && song.scale.includes(pc) && !chordPcs.some((c) => ((pc - c + 12) % 12) === 1));
    if (!ok(((m % 12) + 12) % 12)) {
      for (let d = 1; d < 4; d++) {
        if (ok((m + d) % 12)) { m += d; break; }
        if (ok((((m - d) % 12) + 12) % 12)) { m -= d; break; }
      }
    }
    return m;
  };

  P._leadBar = function (t, chords, sec) {
    const mu = this.mus, song = mu.song, mel = mu.mel;
    if (mu.secBar % 2 === 0) {
      const ph = (mu.secBar >> 1) % 4;
      let kind = sec.lead < 1 ? (chance(0.4) ? 'answer' : 'rest') : ['motif', 'answer', 'vary', 'cadence'][ph];
      if (kind !== 'rest' && chance(0.1)) kind = 'rest';
      if (mu.secBar === 0 && chance(0.35)) mel.motif = this._genMotif();
      mel.plan = kind === 'rest' ? [] : this._variant(mel.motif, kind);
      mel.anchor = song.leadCenter + (kind === 'vary' ? pick([-2, 0, 2]) : 0);
    }
    if (!mel.plan || !mel.plan.length) return;
    const half = mu.secBar % 2;
    for (const n of mel.plan) {
      if ((n.step >> 4) !== half) continue;
      const step = n.step - half * 16;
      const ch = chords.find((c) => step >= c.start && step < c.start + c.len) || chords[0];
      const strong = step % 8 === 0 || n.len >= 6;
      const midi = this._leadPitch(n.deg, ch, strong);
      const a = this._st(t, step), b = this._st(t, step + n.len);
      this._lead(a + gauss() * 0.004, midi, rand(0.75, 1) * (step === 0 ? 1 : 0.9), Math.max(0.1, b - a));
    }
  };

  // ───────────────────────────── music: instruments ─────────────────────────────
  // Electric piano: 2-op FM (ratio 1, decaying index) + a short "bark" partial.
  P._rhodes = function (t, midi, vel, dur) {
    const f = mtof(midi), m = this.m;
    const car = this._osc('sine', f), mod = this._osc('sine', f), mg = this._gain(0);
    const bark = this._osc('sine', f * 3), bg = this._gain(0), amp = this._gain(0);
    mg.gain.setValueAtTime(f * (0.55 + vel * 1.25), t);
    mg.gain.setTargetAtTime(f * 0.18, t, 0.22);
    mod.connect(mg); mg.connect(car.frequency);
    const peak = 0.085 * vel;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.005);
    amp.gain.setTargetAtTime(peak * 0.3, t + 0.005, 1.1);
    amp.gain.setTargetAtTime(0, t + dur, 0.16);
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(peak * 0.16 * vel, t + 0.003);
    bg.gain.setTargetAtTime(0, t + 0.003, 0.045);
    car.connect(amp); bark.connect(bg); bg.connect(amp); amp.connect(m.keys);
    const end = t + dur + 1.0;
    car.start(t); mod.start(t); bark.start(t);
    car.stop(end); mod.stop(end); bark.stop(t + 0.4);
    this._free(car, [amp, mg, bg, car, mod, bark]);
  };

  // Soft felt piano: harmonic periodic wave + closing lowpass + hammer thump.
  P._felt = function (t, midi, vel, dur) {
    const f = mtof(midi), m = this.m;
    if (!this._feltWave) {
      const im = new Float32Array([0, 1, 0.42, 0.16, 0.08, 0.035, 0.015]);
      this._feltWave = this.ctx.createPeriodicWave(new Float32Array(im.length), im);
    }
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this._feltWave); o.frequency.value = f; o.detune.value = rand(-4, 4);
    const lp = this._filter('lowpass', 1000, 0.3), amp = this._gain(0), peak = 0.11 * vel;
    lp.frequency.setValueAtTime(Math.min(9000, f * (4 + vel * 5)), t);
    lp.frequency.setTargetAtTime(Math.max(320, f * 1.3), t, 0.5);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.setTargetAtTime(peak * 0.12, t + 0.004, 0.9);
    amp.gain.setTargetAtTime(0, t + dur, 0.2);
    o.connect(lp); lp.connect(amp); amp.connect(m.keys);
    o.start(t); o.stop(t + dur + 1.2);
    this._free(o, [amp, lp, o]);
    const nz = this._src(this.buf.white, true), nlp = this._filter('lowpass', 900, 0.5), ng = this._gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.03 * vel, t + 0.002);
    ng.gain.setTargetAtTime(0, t + 0.002, 0.012);
    nz.connect(nlp); nlp.connect(ng); ng.connect(m.keys);
    nz.start(t, rand(0, 2)); nz.stop(t + 0.12);
    this._free(nz, [ng, nlp, nz]);
  };

  // Warm pad bed: two detuned triangles, slow swell.
  P._pad = function (t, midi, dur) {
    const f = mtof(midi), m = this.m;
    const o1 = this._osc('triangle', f), o2 = this._osc('triangle', f);
    o1.detune.value = -7; o2.detune.value = 7;
    const lp = this._filter('lowpass', 1100, 0.4), amp = this._gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.02, t + Math.min(0.6, dur * 0.4));
    amp.gain.setTargetAtTime(0, t + dur, 0.35);
    o1.connect(lp); o2.connect(lp); lp.connect(amp); amp.connect(m.keys);
    const end = t + dur + 2;
    o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
    this._free(o1, [amp, lp, o1, o2]);
  };

  // Round bass: sine + a little triangle for small speakers, tiny pitch settle.
  P._bass = function (t, midi, vel, dur) {
    const f = mtof(midi), m = this.m;
    const o = this._osc('sine', f), o2 = this._osc('triangle', f), g2 = this._gain(0.22), amp = this._gain(0);
    for (const osc of [o, o2]) { osc.frequency.setValueAtTime(f * 0.985, t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.04); }
    const peak = 0.3 * vel;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.012);
    amp.gain.setTargetAtTime(peak * 0.62, t + 0.012, 0.25);
    amp.gain.setTargetAtTime(0, t + dur, 0.06);
    o.connect(amp); o2.connect(g2); g2.connect(amp); amp.connect(m.bass);
    const end = t + dur + 0.5;
    o.start(t); o2.start(t); o.stop(end); o2.stop(end);
    this._free(o, [amp, g2, o, o2]);
  };

  P._kick = function (t, vel) {
    const m = this.m, o = this._osc('sine', 128), amp = this._gain(0);
    o.frequency.setValueAtTime(128, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const peak = 0.62 * vel;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setTargetAtTime(0, t + 0.003, 0.13);
    o.connect(amp); amp.connect(m.drums);
    o.start(t); o.stop(t + 0.9);
    this._free(o, [amp, o]);
    const c = this._src(this.buf.white, true), chp = this._filter('highpass', 2500, 0.5), cg = this._gain(0);
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.045 * vel, t + 0.001);
    cg.gain.setTargetAtTime(0, t + 0.001, 0.004);
    c.connect(chp); chp.connect(cg); cg.connect(m.drums);
    c.start(t, rand(0, 2)); c.stop(t + 0.05);
    this._free(c, [cg, chp, c]);
    // sidechain pump on keys/pad
    const song = this.mus.song, d = 1 - (song ? song.pump : 0.2) * vel;
    m.keys.gain.setTargetAtTime(d, t, 0.01);
    m.keys.gain.setTargetAtTime(1, t + 0.07, 0.13);
  };

  P._snare = function (t, vel) {
    const m = this.m, song = this.mus.song;
    if (song && song.snareType === 'rim') {
      const n = this._src(this.buf.white, true), g = this._gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.34 * vel, t + 0.001);
      g.gain.setTargetAtTime(0, t + 0.001, 0.014);
      n.connect(g); g.connect(m.rimBP); n.start(t, rand(0, 2)); n.stop(t + 0.15);
      this._free(n, [g, n]);
      const o = this._osc('triangle', 510), og = this._gain(0);
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.09 * vel, t + 0.001);
      og.gain.setTargetAtTime(0, t + 0.001, 0.018);
      o.connect(og); og.connect(m.drums); o.start(t); o.stop(t + 0.2);
      this._free(o, [og, o]);
      return;
    }
    const n = this._src(this.buf.white, true), g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * vel, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, 0.065);
    n.connect(g); g.connect(m.snBP); n.start(t, rand(0, 2)); n.stop(t + 0.5);
    this._free(n, [g, n]);
    const o = this._osc('triangle', 200), og = this._gain(0);
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(165, t + 0.05);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.12 * vel, t + 0.002);
    og.gain.setTargetAtTime(0, t + 0.002, 0.04);
    o.connect(og); og.connect(m.drums); o.start(t); o.stop(t + 0.35);
    this._free(o, [og, o]);
  };

  P._hat = function (t, vel, open) {
    const m = this.m, n = this._src(this.buf.white, true), g = this._gain(0);
    const tau = open ? 0.11 : rand(0.018, 0.03);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.001);
    g.gain.setTargetAtTime(0, t + 0.001, tau);
    n.connect(g); g.connect(m.hatHP); n.start(t, rand(0, 2)); n.stop(t + tau * 8 + 0.02);
    this._free(n, [g, n]);
  };

  P._shaker = function (t, vel) {
    const m = this.m, n = this._src(this.buf.white, true), g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * vel, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.014, 0.03);
    n.connect(g); g.connect(m.shkBP); n.start(t, rand(0, 2)); n.stop(t + 0.3);
    this._free(n, [g, n]);
  };

  // Lead voices: vibraphone-ish mallet, nylon pluck (Karplus–Strong), breathy flute.
  P._lead = function (t, midi, vel, dur) {
    const type = this.mus.song.lead, m = this.m, f = mtof(midi);
    if (type === 'pluck') {
      let b = this.buf.pluck.get(midi);
      if (!b) { b = pluckBuffer(this.ctx, midi); this.buf.pluck.set(midi, b); }
      const s = this._src(b, false), lp = this._filter('lowpass', 3200, 0.4), g = this._gain(0);
      s.playbackRate.value = Math.pow(2, rand(-5, 5) / 1200);
      g.gain.setValueAtTime(0.17 * vel, t);
      g.gain.setTargetAtTime(0, t + dur + 0.3, 0.25);
      s.connect(lp); lp.connect(g); g.connect(m.lead);
      s.start(t); s.stop(t + Math.min(1.78, dur + 1.4));
      this._free(s, [g, lp, s]);
      return;
    }
    if (type === 'flute') {
      const o = this._osc('sine', f), o2 = this._osc('sine', f * 2), g2 = this._gain(0.1), amp = this._gain(0);
      const vib = this._osc('sine', rand(4.6, 5.4)), vg = this._gain(0);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(f * 0.0045, t + 0.35);
      vib.connect(vg); vg.connect(o.frequency);
      const peak = 0.11 * vel;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.07);
      amp.gain.setTargetAtTime(peak * 0.8, t + 0.07, 0.4);
      amp.gain.setTargetAtTime(0, t + dur, 0.09);
      o.connect(amp); o2.connect(g2); g2.connect(amp); amp.connect(m.lead);
      const n = this._src(this.buf.white, true), bp = this._filter('bandpass', Math.min(9000, f * 2.2), 2.5), ng = this._gain(0);
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.05 * vel, t + 0.04);
      ng.gain.setTargetAtTime(0.012 * vel, t + 0.05, 0.12);
      ng.gain.setTargetAtTime(0, t + dur, 0.07);
      n.connect(bp); bp.connect(ng); ng.connect(m.lead);
      const end = t + dur + 0.6;
      o.start(t); o2.start(t); vib.start(t); n.start(t, rand(0, 2));
      o.stop(end); o2.stop(end); vib.stop(end); n.stop(end);
      this._free(o, [amp, g2, vg, o, o2, vib]);
      this._free(n, [ng, bp, n]);
      return;
    }
    const o = this._osc('sine', f), o2 = this._osc('sine', f * 3.93), g2 = this._gain(0), amp = this._gain(0);
    const peak = 0.13 * vel;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setTargetAtTime(0, t + 0.003, 0.75);
    amp.gain.setTargetAtTime(0, t + dur + 0.15, 0.2);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(peak * 0.35, t + 0.002);
    g2.gain.setTargetAtTime(0, t + 0.002, 0.06);
    o.connect(amp); amp.connect(m.lead); o2.connect(g2); g2.connect(m.lead);
    o.start(t); o2.start(t); o.stop(t + Math.min(dur + 1.2, 3.5)); o2.stop(t + 0.5);
    this._free(o, [amp, g2, o, o2]);
  };

  // ───────────────────────────── ambience: graph ─────────────────────────────
  function birdRate(d) {
    const dawn = Math.exp(-Math.pow((d - 0.27) / 0.035, 2)) * 0.85;
    const morning = smoothstep(0.24, 0.3, d) * (1 - smoothstep(0.42, 0.5, d)) * 0.25;
    const day = smoothstep(0.3, 0.35, d) * (1 - smoothstep(0.7, 0.76, d)) * 0.07;
    const eve = Math.exp(-Math.pow((d - 0.74) / 0.025, 2)) * 0.18;
    return Math.min(1, dawn + morning + day + eve);
  }

  P._loop = function (buffer, out, offset, rate) {
    const s = this._src(buffer, true);
    if (rate) s.playbackRate.value = rate;
    s.connect(out);
    s.start(this.ctx.currentTime + 0.05, offset || 0);
    return s;
  };

  P._buildAmbience = function () {
    const A = (this.amb = {});
    // rain, heard from inside: a touch muffled
    A.rainLP = this._filter('lowpass', 7000, 0.5); A.rainLP.connect(this.ch.rain);
    A.washHP = this._filter('highpass', 380, 0.5); A.washLP = this._filter('lowpass', 2600, 0.5);
    A.washMod = this._gain(1); A.washGain = this._gain(0);
    A.washHP.connect(A.washLP); A.washLP.connect(A.washMod); A.washMod.connect(A.washGain); A.washGain.connect(A.rainLP);
    A.bodyLP = this._filter('lowpass', 480, 0.6); A.bodyGain = this._gain(0);
    A.bodyLP.connect(A.bodyGain); A.bodyGain.connect(A.rainLP);
    A.fineGain = this._gain(0); A.fine2Gain = this._gain(0); A.glassGain = this._gain(0); A.plinkGain = this._gain(0);
    for (const g of [A.fineGain, A.fine2Gain, A.glassGain, A.plinkGain]) g.connect(A.rainLP);
    A.dripBus = this._gain(1); A.dripBus.connect(A.rainLP);
    // storm wind
    A.windBP = this._filter('bandpass', 420, 0.8); A.windLP = this._filter('lowpass', 1400, 0.5);
    A.windMod = this._gain(0.5); A.windGain = this._gain(0);
    A.windBP.connect(A.windLP); A.windLP.connect(A.windMod); A.windMod.connect(A.windGain); A.windGain.connect(this.ch.rain);
    // distant city wash
    A.cityLP = this._filter('lowpass', 280, 0.5); A.cityBP = this._filter('bandpass', 750, 0.45);
    A.cityBPg = this._gain(0.5); A.cityGain = this._gain(0);
    A.cityLP.connect(A.cityGain); A.cityBP.connect(A.cityBPg); A.cityBPg.connect(A.cityGain); A.cityGain.connect(this.ch.city);
    // cat purr: low noise × ~24 Hz pulse × breathing
    A.purrLP = this._filter('lowpass', 210, 0.7); A.purrAM = this._gain(0.5); A.purrBreath = this._gain(0.6); A.purrGain = this._gain(0);
    A.purrLP.connect(A.purrAM); A.purrAM.connect(A.purrBreath); A.purrBreath.connect(A.purrGain); A.purrGain.connect(this.ch.room);
    A.purrOsc = this._osc('sine', 24); A.purrOscG = this._gain(0.5);
    A.purrOsc.connect(A.purrOscG); A.purrOscG.connect(A.purrAM.gain);
    // room foley
    A.roomBus = this._gain(1); A.roomLP = this._filter('lowpass', 8000, 0.5);
    A.roomBus.connect(A.roomLP); A.roomLP.connect(this.ch.room);
    A.typeBus = this._pan(0.08); A.typeBus.connect(A.roomBus);
    A.writeBus = this._pan(-0.05); A.writeBus.connect(A.roomBus);
    // birds & pigeons are outside the glass
    A.natLP = this._filter('lowpass', 7500, 0.5); A.natLP.connect(this.ch.nature);
    A.wet = 0; A.lastT = 0; A.targets = {};
    A.dripF = 1000; A.dripPan = 0.3; A.dripPer = 1.1;
  };

  P._startAmbience = function () {
    const A = this.amb, B = this.buf;
    this._loop(B.pink, A.washHP, rand(0, 6));
    this._loop(B.brown, A.bodyLP, rand(0, 7));
    this._loop(B.pink, A.windBP, rand(0, 6), 0.93);
    this._loop(B.brown, A.cityLP, rand(0, 7), 0.97);
    this._loop(B.pink, A.cityBP, rand(0, 6), 1.04);
    this._loop(B.brown, A.purrLP, rand(0, 7), 1.1);
    A.purrOsc.start();
    A.lastT = this.ctx.currentTime;
    this._applyAmbience(true);
    // rain textures are rendered a moment later so start() stays snappy
    setTimeout(() => {
      try {
        const ctx = this.ctx;
        B.rainFine = rainLayerBuffer(ctx, 7.9, 'fine');
        B.rainGlass = rainLayerBuffer(ctx, 9.3, 'glass');
        B.rainPlink = rainLayerBuffer(ctx, 10.7, 'plink');
        this._loop(B.rainFine, A.fineGain, rand(0, 7));
        this._loop(B.rainFine, A.fine2Gain, rand(0, 7), 0.9);
        this._loop(B.rainGlass, A.glassGain, rand(0, 9));
        this._loop(B.rainPlink, A.plinkGain, rand(0, 10));
      } catch (e) { this._report(e); }
    }, 60);
  };

  P._applyAmbience = function (force) {
    const A = this.amb, s = this.s, t = this.ctx.currentTime, r = s.rain, day = s.dayTime;
    const light = smoothstep(0.2, 0.3, day) * (1 - smoothstep(0.8, 0.9, day));
    const set = (key, param, v, tau) => {
      const prev = A.targets[key];
      if (!force && prev !== undefined && Math.abs(prev - v) <= 0.002 * Math.max(1, Math.abs(v))) return;
      A.targets[key] = v;
      glide(param, v, t, tau);
    };
    set('wash', A.washGain.gain, 1.0 * Math.pow(r, 0.9), 0.6);
    set('washLP', A.washLP.frequency, 1500 + 3400 * r, 0.8);
    set('body', A.bodyGain.gain, 0.6 * smoothstep(0.35, 1, r), 0.8);
    set('fine', A.fineGain.gain, 0.9 * smoothstep(0, 0.5, r), 0.6);
    set('fine2', A.fine2Gain.gain, 0.7 * smoothstep(0.45, 1, r), 0.6);
    set('glass', A.glassGain.gain, 0.6 * smoothstep(0.02, 0.35, r), 0.6);
    set('plink', A.plinkGain.gain, 0.6 * smoothstep(0.05, 0.4, r) * (1 - 0.4 * r), 0.8);
    set('wind', A.windGain.gain, 2.4 * Math.pow(s.storm, 1.2), 1.2);
    set('city', A.cityGain.gain, 0.5 * (0.45 + 0.55 * light) * (1 - 0.35 * r), 2);
    set('purr', A.purrGain.gain, s.catPurr ? 0.22 : 0, 1.2);
  };

  // Event stream: fire(t) plays (or not) and returns seconds until the next event.
  P._stream = function (key, now, horizon, fire, first) {
    let t = this.ev[key];
    if (t === undefined || t < now - 0.3) t = now + (first || 0.05);
    let guard = 0;
    while (t < horizon && guard++ < 60) t += Math.max(0.02, fire(t));
    this.ev[key] = t;
  };

  P._ambTick = function (now, horizon) {
    const A = this.amb, s = this.s, day = s.dayTime, r = s.rain;
    const dt = clamp(now - A.lastT, 0, 5); A.lastT = now;
    A.wet += (r - A.wet) * (1 - Math.exp(-dt / (r > A.wet ? 3 : 80))); // drips linger after the rain
    if (r > 0.01 && now >= (A.nextAM || 0)) { glide(A.washMod.gain, rand(0.8, 1.18), now, 0.12); A.nextAM = now + rand(0.15, 0.4); }
    if (s.storm > 0.02 && now >= (A.nextGust || 0)) {
      glide(A.windMod.gain, rand(0.2, 1.1), now, rand(0.35, 1.1));
      glide(A.windBP.frequency, rand(260, 720), now, 0.9);
      A.nextGust = now + rand(0.7, 2.4);
    }
    if (s.catPurr && now >= (A.nextBreath || 0)) {
      A.inhale = !A.inhale;
      glide(A.purrBreath.gain, A.inhale ? 0.45 : 1, now, 0.35);
      glide(A.purrOsc.frequency, A.inhale ? 22 : 25.5, now, 0.3);
      A.nextBreath = now + (A.inhale ? rand(1.1, 1.4) : rand(1.4, 1.9));
    }
    if (now >= (A.nextDripChange || 0)) {
      A.dripF = rand(700, 1500); A.dripPan = rand(-0.7, 0.7); A.dripPer = rand(0.55, 1.7);
      A.nextDripChange = now + rand(15, 45);
    }
    const light = smoothstep(0.2, 0.3, day) * (1 - smoothstep(0.8, 0.9, day));
    this._stream('drip', now, horizon, (t) => {
      if (A.wet > 0.1 && chance(0.5 + A.wet * 0.5)) this._drip(t, A.wet);
      return A.dripPer * rand(0.8, 1.2);
    });
    this._stream('car', now, horizon, (t) => { if (chance(0.3 + 0.7 * light)) this._carPass(t); return rand(12, 38); }, rand(4, 20));
    this._stream('horn', now, horizon, (t) => {
      if (day > 0.28 && day < 0.88 && chance(0.6)) this._boatHorn(t);
      return rand(150, 420);
    }, rand(40, 160));
    this._stream('bird', now, horizon, (t) => {
      if (chance(birdRate(day) * (1 - 0.85 * r))) this._bird(t);
      return Math.min(6, expRand(1.1));
    }, 0.5);
    this._stream('gull', now, horizon, (t) => {
      if (day > 0.3 && day < 0.78 && chance(0.55 * (1 - r))) this._gull(t);
      return rand(22, 70);
    }, rand(8, 30));
    if (s.typing) {
      if (!A.typeState) A.typeState = { left: randi(2, 8), words: randi(3, 10), back: 0 };
      this._stream('type', now, horizon, (t) => this._typeKey(t), rand(0.05, 0.3));
    } else { delete this.ev.type; A.typeState = null; }
    if (s.writing) {
      if (!A.writeState) A.writeState = { n: randi(3, 9), w: randi(4, 9) };
      this._stream('write', now, horizon, (t) => this._stroke(t), rand(0.05, 0.4));
    } else { delete this.ev.write; A.writeState = null; }
  };

  // ───────────────────────────── ambience: voices ─────────────────────────────
  // Gutter drip: a small water "plink" (bubble resonance gliding up).
  P._drip = function (t, wet) {
    const A = this.amb, f = A.dripF * rand(0.97, 1.03);
    const o = this._osc('sine', f), g = this._gain(0), p = this._pan(A.dripPan);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rand(1.25, 1.6), t + 0.05);
    const peak = 0.14 * clamp(wet * 1.5, 0.2, 1) * rand(0.7, 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, 0.03);
    o.connect(g); g.connect(p); p.connect(A.dripBus);
    o.start(t); o.stop(t + 0.25);
    this._free(o, [p, g, o]);
  };

  P._carPass = function (t) {
    const dur = rand(4, 7), dir = chance(0.5) ? 1 : -1;
    const n = this._src(this.buf.pink, true), bp = this._filter('bandpass', 320, 1.1), g = this._gain(0), p = this._pan(-0.75 * dir);
    if (p.pan) { p.pan.setValueAtTime(-0.75 * dir, t); p.pan.linearRampToValueAtTime(0.75 * dir, t + dur); }
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.linearRampToValueAtTime(rand(650, 900), t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(300, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(3.5, 5.5), t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(this.ch.city);
    n.start(t, rand(0, 6)); n.stop(t + dur + 0.1);
    this._free(n, [p, g, bp, n]);
  };

  // Far-off ship horn over the sea: low, soft, slightly detuned, lots of air.
  P._boatHorn = function (t) {
    const f = rand(72, 98), blasts = chance(0.35) ? 2 : 1;
    const o1 = this._osc('sawtooth', f), o2 = this._osc('sawtooth', f * 1.006), o3 = this._osc('sine', f * 0.5), g3 = this._gain(0.5);
    const lp = this._filter('lowpass', 480, 1.4), g = this._gain(0), p = this._pan(rand(-0.5, 0.5));
    let tt = t;
    g.gain.setValueAtTime(0, t);
    for (let b = 0; b < blasts; b++) {
      const len = b === 0 ? rand(1.6, 2.6) : rand(0.8, 1.2);
      g.gain.setTargetAtTime(0.4, tt, 0.18);
      g.gain.setTargetAtTime(0, tt + len, 0.35);
      tt += len + rand(0.9, 1.3);
    }
    o1.connect(lp); o2.connect(lp); o3.connect(g3); g3.connect(lp); lp.connect(g); g.connect(p); p.connect(this.ch.city);
    const end = tt + 2.5;
    for (const o of [o1, o2, o3]) { o.start(t); o.stop(end); }
    this._free(o1, [p, g, lp, g3, o1, o2, o3]);
  };

  P._bird = function (t) {
    const A = this.amb, dist = rand(0.2, 1);
    const o = this._osc('sine', 3000), g = this._gain(0), lp = this._filter('lowpass', lerp(9000, 3500, dist), 0.5), p = this._pan(rand(-0.85, 0.85));
    const peak = lerp(0.14, 0.045, dist) * (1 - 0.5 * this.s.rain);
    o.connect(g); g.connect(lp); lp.connect(p); p.connect(A.natLP);
    const F = o.frequency, sp = randi(0, 3);
    let tt = t;
    g.gain.setValueAtTime(0, t);
    if (sp === 0) { // tweets: rising sweeps
      const n = randi(2, 5), f0 = rand(2800, 4200);
      for (let i = 0; i < n; i++) {
        const d = rand(0.04, 0.075), f = f0 * rand(0.92, 1.08);
        F.setValueAtTime(f, tt); F.exponentialRampToValueAtTime(f * rand(1.2, 1.55), tt + d);
        g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(peak, tt + d * 0.3); g.gain.linearRampToValueAtTime(0, tt + d);
        tt += d + rand(0.05, 0.13);
      }
    } else if (sp === 1) { // trill
      const n = randi(6, 14), f = rand(4200, 5600), d = rand(0.025, 0.04);
      for (let i = 0; i < n; i++) {
        const ff = f * (1 - i * 0.008);
        F.setValueAtTime(ff * 1.1, tt); F.exponentialRampToValueAtTime(ff * 0.9, tt + d);
        g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(peak * 0.8, tt + d * 0.3); g.gain.linearRampToValueAtTime(0, tt + d);
        tt += d + 0.012;
      }
    } else if (sp === 2) { // "tea-cher" two-note call
      const n = randi(2, 4), hi = rand(4300, 5200), lo = hi * rand(0.68, 0.78);
      for (let i = 0; i < n; i++) {
        for (const [f, d] of [[hi, 0.075], [lo, 0.09]]) {
          F.setValueAtTime(f, tt); F.linearRampToValueAtTime(f * 0.97, tt + d);
          g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(peak, tt + 0.012);
          g.gain.setValueAtTime(peak, tt + d - 0.015); g.gain.linearRampToValueAtTime(0, tt + d);
          tt += d + 0.035;
        }
        tt += 0.09;
      }
    } else { // warble: lower, melodic glides
      const n = randi(4, 8);
      let f = rand(1900, 2700);
      F.setValueAtTime(f, tt);
      for (let i = 0; i < n; i++) {
        const d = rand(0.06, 0.16);
        f = clamp(f * rand(0.8, 1.25), 1600, 3600);
        F.setTargetAtTime(f, tt, d * 0.25);
        g.gain.setTargetAtTime(peak * rand(0.5, 1), tt, 0.01);
        g.gain.setTargetAtTime(peak * 0.15, tt + d * 0.7, 0.015);
        tt += d;
      }
      g.gain.setTargetAtTime(0, tt, 0.02);
      tt += 0.12;
    }
    o.start(t); o.stop(tt + 0.1);
    this._free(o, [p, lp, g, o]);
  };

  P._gull = function (t) {
    const A = this.amb, n = randi(2, 4), dist = rand(0.5, 1);
    const o = this._osc('sawtooth', 900), bp = this._filter('bandpass', 1500, 1.8), lp = this._filter('lowpass', lerp(4000, 2200, dist), 0.5);
    const g = this._gain(0), p = this._pan(rand(-0.8, 0.8));
    const peak = lerp(0.2, 0.08, dist) * (1 - 0.7 * this.s.rain);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(p); p.connect(A.natLP);
    let tt = t;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const long = i === n - 1 && chance(0.6), d = long ? rand(0.35, 0.5) : rand(0.16, 0.24), f0 = rand(820, 1000);
      o.frequency.setValueAtTime(f0 * 0.9, tt);
      o.frequency.linearRampToValueAtTime(f0 * 1.08, tt + d * 0.18);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.62, tt + d);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(peak, tt + 0.02);
      g.gain.linearRampToValueAtTime(peak * 0.6, tt + d * 0.6);
      g.gain.linearRampToValueAtTime(0, tt + d);
      tt += d + rand(0.1, 0.22);
    }
    o.start(t); o.stop(tt + 0.1);
    this._free(o, [p, lp, bp, g, o]);
  };

  P._typeKey = function (t) {
    const st = this.amb.typeState;
    if (st.back > 0) { // a little burst of backspaces
      st.back--; this._key(t, false, 0.8);
      return st.back > 0 ? rand(0.07, 0.1) : rand(0.18, 0.35);
    }
    if (st.left > 0) {
      st.left--; this._key(t, false, 1);
      return st.left === 0 ? rand(0.09, 0.2) : clamp(0.115 + gauss() * 0.035, 0.055, 0.24);
    }
    this._key(t, true, 1); // spacebar
    st.words--; st.left = randi(2, 8);
    if (chance(0.06)) st.back = randi(2, 5);
    if (st.words <= 0) { st.words = randi(3, 10); return chance(0.25) ? rand(2, 5) : rand(0.45, 1.6); }
    return clamp(0.13 + gauss() * 0.04, 0.07, 0.26);
  };

  P._key = function (t, space, vel) {
    const B = this.buf, s = this._src(space ? pick(B.spaces) : pick(B.keys), false);
    const g = this._gain((space ? 0.46 : 0.4) * vel * rand(0.7, 1));
    s.playbackRate.value = rand(0.95, 1.05);
    s.connect(g); g.connect(this.amb.typeBus); s.start(t);
    this._free(s, [g, s]);
  };

  // Pencil stroke on paper.
  P._stroke = function (t) {
    const st = this.amb.writeState, d = rand(0.07, 0.3);
    const src = this._src(this.buf.white, true), hp = this._filter('highpass', 1400, 0.5), bp = this._filter('bandpass', rand(2600, 4600), 1.1), g = this._gain(0);
    const peak = rand(0.08, 0.15);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.02);
    g.gain.linearRampToValueAtTime(peak * rand(0.5, 1), t + d * 0.6);
    g.gain.linearRampToValueAtTime(0, t + d);
    const f0 = bp.frequency.value;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.linearRampToValueAtTime(f0 * rand(0.8, 1.2), t + d);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.amb.writeBus);
    src.start(t, rand(0, 2)); src.stop(t + d + 0.05);
    this._free(src, [g, bp, hp, src]);
    st.n--;
    if (st.n <= 0) {
      st.n = randi(3, 9); st.w--;
      if (st.w <= 0) { st.w = randi(4, 9); return d + rand(1.0, 3.2); }
      return d + rand(0.25, 0.7);
    }
    return d + rand(0.03, 0.14);
  };

  // ───────────────────────────── one-shot SFX (public) ─────────────────────────────
  P.thunder = function (dist) {
    if (!this.ctx || !this.started) return;
    dist = clamp(Number.isFinite(dist) ? dist : 0.5, 0, 1);
    const near = 1 - dist, t = this.ctx.currentTime + 0.02;
    const p0 = rand(-0.5, 0.5), pan = this._pan(p0);
    pan.connect(this.ch.thunder);
    if (near > 0.45) { // crack + tearing crackle
      const k = (near - 0.45) / 0.55;
      const n = this._src(this.buf.white, true), hp = this._filter('highpass', 900 + 1600 * k, 0.5), g = this._gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.75 * k + 0.1, t + 0.004);
      g.gain.setTargetAtTime(0.22 * k, t + 0.004, 0.05);
      let tt = t + 0.05;
      const nb = randi(4, 8);
      for (let i = 0; i < nb; i++) {
        tt += rand(0.03, 0.12);
        g.gain.setTargetAtTime(rand(0.15, 0.5) * k, tt, 0.01);
        g.gain.setTargetAtTime(0.05 * k, tt + 0.02, 0.04);
      }
      g.gain.setTargetAtTime(0, tt + 0.05, 0.12);
      n.connect(hp); hp.connect(g); g.connect(pan);
      n.start(t, rand(0, 2)); n.stop(tt + 1.2);
      this._free(n, [g, hp, n]);
    }
    const dur = lerp(9, 5.5, dist) * rand(0.85, 1.15);
    const src = this._src(this.buf.brown, true), lp = this._filter('lowpass', 200 + 700 * near, 0.7), lp2 = this._filter('lowpass', 160 + 900 * near, 0.5);
    const g = this._gain(0), peak = lerp(0.35, 1.0, near) * 2.4;
    src.playbackRate.value = rand(0.75, 0.95);
    lp.frequency.setValueAtTime(200 + 700 * near, t);
    lp.frequency.setTargetAtTime(90 + 120 * near, t + 0.3, dur * 0.35);
    const att = lerp(0.06, 0.8, dist);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    let tt = t + att;
    const nSw = randi(2, 5);
    for (let i = 0; i < nSw; i++) {
      const at = tt + rand(0.3, 1.2);
      g.gain.setTargetAtTime(peak * rand(0.25, 0.5), tt, 0.35);
      g.gain.setTargetAtTime(peak * rand(0.55, 0.95) * (1 - i / (nSw + 1)), at, 0.15);
      tt = at + 0.2;
    }
    const endT = Math.max(tt + 0.5, t + dur);
    g.gain.setTargetAtTime(0, tt, (endT - tt) / 3);
    if (pan.pan) { pan.pan.setValueAtTime(p0, t); pan.pan.linearRampToValueAtTime(clamp(p0 + rand(-0.5, 0.5), -0.8, 0.8), endT); }
    src.connect(lp); lp.connect(lp2); lp2.connect(g); g.connect(pan);
    src.start(t, rand(0, 7)); src.stop(endT + 3);
    this._free(src, [g, lp, lp2, src, pan]);
  };

  P.pigeonCoo = function (pan) {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime + 0.03, A = this.amb;
    const p = this._pan(clamp(Number(pan) || 0, -1, 1)), lp = this._filter('lowpass', 1100, 0.7);
    const o = this._osc('sine', 330), o2 = this._osc('sine', 660), g2 = this._gain(0.18), g = this._gain(0), trem = this._gain(1);
    const am = this._osc('sine', rand(26, 34)), amg = this._gain(0);
    am.connect(amg); amg.connect(trem.gain);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(trem); trem.connect(lp); lp.connect(p); p.connect(A.natLP);
    const k = rand(0.92, 1.08), peak = 0.38, F = o.frequency, F2 = o2.frequency;
    const seg = (a, f0, f1, d, amp, rough) => {
      F.setValueAtTime(f0 * k, a); F.exponentialRampToValueAtTime(f1 * k, a + d);
      F2.setValueAtTime(2 * f0 * k, a); F2.exponentialRampToValueAtTime(2 * f1 * k, a + d);
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(amp, a + d * 0.25);
      g.gain.linearRampToValueAtTime(amp * 0.7, a + d * 0.75);
      g.gain.linearRampToValueAtTime(0, a + d);
      amg.gain.setValueAtTime(rough, a); trem.gain.setValueAtTime(1 - rough, a);
    };
    let tt = t;
    seg(tt, 300, 345, 0.2, peak * 0.55, 0.15); tt += 0.26;   // "oo"
    seg(tt, 370, 300, 0.5, peak, 0.45); tt += 0.55;          // "rrroo" (throaty)
    seg(tt, 310, 265, 0.34, peak * 0.6, 0.2); tt += 0.34;     // "coo"
    if (chance(0.4)) {
      tt += rand(0.25, 0.5);
      seg(tt, 300, 340, 0.18, peak * 0.45, 0.15); tt += 0.25;
      seg(tt, 360, 290, 0.45, peak * 0.8, 0.45); tt += 0.45;
    }
    const end = tt + 0.2;
    o.start(t); o2.start(t); am.start(t);
    o.stop(end); o2.stop(end); am.stop(end);
    this._free(o, [p, lp, trem, g, g2, amg, o, o2, am]);
  };

  P.wingFlaps = function (pan, n) {
    if (!this.ctx || !this.started) return;
    n = clamp(Math.round(Number(n) || 6), 1, 24);
    const t = this.ctx.currentTime + 0.02, A = this.amb, p0 = clamp(Number(pan) || 0, -1, 1);
    const src = this._src(this.buf.white, true), bp = this._filter('bandpass', 1300, 0.7), lp = this._filter('lowpass', 3800, 0.5);
    const g = this._gain(0), p = this._pan(p0);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(p); p.connect(A.natLP);
    let tt = t;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1);
      const amp = 0.8 * (i < 2 ? 1 : lerp(0.9, 0.35, k)) * rand(0.8, 1);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(amp, tt + 0.008);
      g.gain.setTargetAtTime(0, tt + 0.01, 0.028);
      bp.frequency.setValueAtTime(rand(1000, 1700), tt);
      tt += lerp(0.075, 0.11, k) * rand(0.9, 1.1);
    }
    if (p.pan) { p.pan.setValueAtTime(p0, t); p.pan.linearRampToValueAtTime(clamp(p0 * 1.5, -1, 1), tt); }
    src.start(t, rand(0, 2)); src.stop(tt + 0.3);
    this._free(src, [p, g, lp, bp, src]);
  };

  P.pageTurn = function () {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime + 0.02, A = this.amb, d = rand(0.35, 0.55);
    const src = this._src(this.buf.white, true), hp = this._filter('highpass', 500, 0.5), bp = this._filter('bandpass', 800, 0.8);
    const g = this._gain(0), p = this._pan(rand(-0.25, 0.1));
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(p); p.connect(A.roomBus);
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + d * 0.7);
    bp.frequency.exponentialRampToValueAtTime(1400, t + d);
    g.gain.setValueAtTime(0, t);
    for (let i = 1; i <= 5; i++) g.gain.linearRampToValueAtTime(rand(0.12, 0.34), t + (d * i) / 6);
    g.gain.linearRampToValueAtTime(0, t + d + 0.04);
    const f = this._src(this.buf.white, true), flp = this._filter('lowpass', 500, 0.6), fg = this._gain(0);
    f.connect(flp); flp.connect(fg); fg.connect(p);
    fg.gain.setValueAtTime(0, t + d);
    fg.gain.linearRampToValueAtTime(0.4, t + d + 0.01);
    fg.gain.setTargetAtTime(0, t + d + 0.012, 0.03);
    src.start(t, rand(0, 2)); src.stop(t + d + 0.1);
    f.start(t + d, rand(0, 2)); f.stop(t + d + 0.3);
    this._free(f, [p, g, bp, hp, fg, flp, src, f]);
  };

  P.lampClick = function () {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime + 0.01, p = this._pan(0.15);
    p.connect(this.amb.roomBus);
    const parts = [[0, 0.5, 1], [rand(0.06, 0.09), 0.3, 1.25]];
    parts.forEach(([dt, v, r], i) => {
      const s = this._src(this.buf.click, false), g = this._gain(v);
      s.playbackRate.value = r * rand(0.95, 1.05);
      s.connect(g); g.connect(p); s.start(t + dt);
      this._free(s, i === parts.length - 1 ? [g, s, p] : [g, s]);
    });
  };

  window.LofiAudio = LofiAudio;
})();
