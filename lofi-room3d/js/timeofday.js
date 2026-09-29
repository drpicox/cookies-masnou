/* Habitació amb vistes — paleta del cicle del dia i posició del sol i la lluna */
(function () {
  'use strict';
  const { clamp, lerp, smooth, cyc, col, mixC, lum, DEG } = LOFI;

  // Fotogrames clau (t: 0 = mitjanit, 0.25 = 06:00, 0.5 = migdia, 0.75 = 18:00)
  // top/mid/hor: degradat del cel; glow: resplendor de l'horitzó cap al sol; sun: disc;
  // cloudLit/cloudShade: núvols; seaHi/seaLo: mar a l'horitzó / a prop; fog: boira llunyana;
  // amb/ambGround: llum ambient de l'habitació; win: llum que entra per la finestra.
  const KEYS = [
    { t: 0.000, top: '#0b0f2d', mid: '#171c4a', hor: '#2c3170', glow: '#4b4d8f', glowI: 0.30, sun: '#ffe9b0',
      cloudLit: '#454a82', cloudShade: '#1c2046', seaHi: '#252c62', seaLo: '#0e1336', fog: '#20255a',
      amb: '#2a3068', ambGround: '#1a1426', ambI: 0.34, win: '#3a4588', winI: 0.35, city: 1.0, stars: 1.0, lamp: 1.0 },
    { t: 0.195, top: '#10143a', mid: '#20265a', hor: '#3e3f7e', glow: '#5a5590', glowI: 0.35, sun: '#ffe9b0',
      cloudLit: '#4f4e88', cloudShade: '#22244c', seaHi: '#2c3368', seaLo: '#11173a', fog: '#2c2f66',
      amb: '#2f3570', ambGround: '#1c1628', ambI: 0.36, win: '#40488c', winI: 0.36, city: 0.95, stars: 0.95, lamp: 1.0 },
    { t: 0.225, top: '#1e2762', mid: '#4c4a8a', hor: '#b88aa8', glow: '#e8a0a8', glowI: 0.55, sun: '#ffd8b0',
      cloudLit: '#c890b0', cloudShade: '#403f7a', seaHi: '#8a7aa8', seaLo: '#262d64', fog: '#6e6496',
      amb: '#4a4a86', ambGround: '#241a30', ambI: 0.45, win: '#8a78b0', winI: 0.45, city: 0.75, stars: 0.45, lamp: 0.9 },
    { t: 0.243, top: '#2f3f86', mid: '#9a78b0', hor: '#ffa888', glow: '#ff9f80', glowI: 0.85, sun: '#ffe2b0',
      cloudLit: '#ffb4a4', cloudShade: '#6c5c9a', seaHi: '#e89ca2', seaLo: '#3a4482', fog: '#b890a8',
      amb: '#9a82aa', ambGround: '#3a2632', ambI: 0.6, win: '#ffa890', winI: 0.66, city: 0.5, stars: 0.12, lamp: 0.75 },
    { t: 0.26, top: '#4862aa', mid: '#d69cb2', hor: '#ffc092', glow: '#ffbe80', glowI: 0.8, sun: '#fff0c4',
      cloudLit: '#ffd2b4', cloudShade: '#9888b6', seaHi: '#f8c2a2', seaLo: '#4a5a9a', fog: '#d8b2b2',
      amb: '#c0a6b6', ambGround: '#46303a', ambI: 0.74, win: '#ffc8a0', winI: 0.85, city: 0.22, stars: 0.0, lamp: 0.35 },
    { t: 0.285, top: '#5a84cc', mid: '#b4bce0', hor: '#ffdcc0', glow: '#ffe8c8', glowI: 0.6, sun: '#fff8e8',
      cloudLit: '#fff0e4', cloudShade: '#a4acd0', seaHi: '#c8d4ea', seaLo: '#4470ae', fog: '#d0d2e2',
      amb: '#b8c0dc', ambGround: '#4a3a36', ambI: 0.86, win: '#f4e8e4', winI: 0.95, city: 0.06, stars: 0.0, lamp: 0.05 },
    { t: 0.320, top: '#5d8fd8', mid: '#a6c6ec', hor: '#f4e4d4', glow: '#fff4e0', glowI: 0.45, sun: '#fffaf0',
      cloudLit: '#fff8f0', cloudShade: '#aab8d6', seaHi: '#b4d0ea', seaLo: '#3f76b4', fog: '#c6d6ea',
      amb: '#b4c4de', ambGround: '#4a3a34', ambI: 0.9, win: '#e8eef8', winI: 1.0, city: 0.02, stars: 0.0, lamp: 0.0 },
    { t: 0.500, top: '#4c8be4', mid: '#8cbef2', hor: '#d2eaff', glow: '#ffffff', glowI: 0.25, sun: '#ffffff',
      cloudLit: '#ffffff', cloudShade: '#b4c6e4', seaHi: '#98c6ee', seaLo: '#2a72bc', fog: '#bad6f2',
      amb: '#c4d6f0', ambGround: '#4e3e38', ambI: 1.0, win: '#f0f6ff', winI: 1.1, city: 0.0, stars: 0.0, lamp: 0.0 },
    { t: 0.650, top: '#4a84d6', mid: '#96baea', hor: '#eedcca', glow: '#fff0d4', glowI: 0.45, sun: '#fffaf0',
      cloudLit: '#fff4e8', cloudShade: '#b0bad8', seaHi: '#a6c4e4', seaLo: '#3470b4', fog: '#ccd2e0',
      amb: '#ccccdc', ambGround: '#4e3c36', ambI: 0.95, win: '#fff2e0', winI: 1.05, city: 0.0, stars: 0.0, lamp: 0.0 },
    { t: 0.705, top: '#5068b2', mid: '#d4a2a2', hor: '#ffcf8a', glow: '#ffbe70', glowI: 0.9, sun: '#fff0c0',
      cloudLit: '#ffd8a0', cloudShade: '#a888a8', seaHi: '#f6c690', seaLo: '#4c66a6', fog: '#dcb4a4',
      amb: '#dcb4a4', ambGround: '#4a3030', ambI: 0.86, win: '#ffcf96', winI: 1.0, city: 0.08, stars: 0.0, lamp: 0.25 },
    { t: 0.738, top: '#3a3a80', mid: '#c46a92', hor: '#ff9a5e', glow: '#ff8c52', glowI: 1.15, sun: '#ffd878',
      cloudLit: '#ffa06e', cloudShade: '#784a82', seaHi: '#ff9e6e', seaLo: '#3e407c', fog: '#c07888',
      amb: '#c48496', ambGround: '#3e2430', ambI: 0.7, win: '#ff9e70', winI: 0.95, city: 0.35, stars: 0.0, lamp: 0.6 },
    { t: 0.758, top: '#272b6a', mid: '#8a4e8c', hor: '#ee8878', glow: '#f07a72', glowI: 0.8, sun: '#ffc070',
      cloudLit: '#f08c94', cloudShade: '#4a3a72', seaHi: '#b86a8a', seaLo: '#2a3068', fog: '#7c5a8a',
      amb: '#6c5a8c', ambGround: '#2c1c2c', ambI: 0.5, win: '#c8789a', winI: 0.6, city: 0.7, stars: 0.12, lamp: 0.9 },
    { t: 0.785, top: '#161b4c', mid: '#373a7a', hor: '#865a8c', glow: '#aa6a8e', glowI: 0.5, sun: '#ffc070',
      cloudLit: '#76598a', cloudShade: '#2a2a5a', seaHi: '#48447a', seaLo: '#181d4a', fog: '#3a3a6c',
      amb: '#3a3c74', ambGround: '#20182a', ambI: 0.4, win: '#5a5494', winI: 0.45, city: 0.95, stars: 0.6, lamp: 1.0 },
    { t: 0.830, top: '#0d1231', mid: '#1b2050', hor: '#303576', glow: '#4f4f92', glowI: 0.32, sun: '#ffe9b0',
      cloudLit: '#484c86', cloudShade: '#1e2248', seaHi: '#272e64', seaLo: '#0f1438', fog: '#22275c',
      amb: '#2b3169', ambGround: '#1a1426', ambI: 0.34, win: '#3b4689', winI: 0.35, city: 1.0, stars: 1.0, lamp: 1.0 },
  ];
  const COLOR_KEYS = ['top', 'mid', 'hor', 'glow', 'sun', 'cloudLit', 'cloudShade', 'seaHi', 'seaLo', 'fog', 'amb', 'ambGround', 'win'];
  const NUM_KEYS = ['glowI', 'ambI', 'winI', 'city', 'stars', 'lamp'];
  for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = col(k[c]);

  // Colors de referència per al temps tapat
  const OVERCAST_DAY = { top: col('#7d8aa2'), mid: col('#9aa4b6'), hor: col('#b8bcc6'), cloudLit: col('#b4bac6'), cloudShade: col('#6c7488'),
    seaHi: col('#98a0ae'), seaLo: col('#4a5668'), fog: col('#a4aab8') };
  const OVERCAST_NIGHT = { top: col('#15141f'), mid: col('#221f30'), hor: col('#3a3042'), cloudLit: col('#3e3450'), cloudShade: col('#1c1a2a'),
    seaHi: col('#262632'), seaLo: col('#101018'), fog: col('#2e2a3c') };

  const tmpA = new THREE.Color(), tmpB = new THREE.Color();

  class TimeOfDay {
    constructor() {
      this.c = {};
      for (const k of COLOR_KEYS) this.c[k] = new THREE.Color();
      this.c.sunLight = new THREE.Color();
      this.c.moonLight = new THREE.Color('#9fb2ff');
      this.c.cloudRim = new THREE.Color();
      this.v = {};
      this.sunDir = new THREE.Vector3();
      this.moonDir = new THREE.Vector3();
      this.sunEl = 0; this.moonEl = 0;
      this.sunLightI = 0; this.moonLightI = 0;
      this.daylight = 0;
      this.moonPhase = 0.45;
      // Recorregut: s'aixeca per l'esquerra sobre el mar i es pon per la dreta.
      this.path = { sunRise: -13 * DEG, sunSet: 3 * DEG, sunMax: 52 * DEG, moonRise: -19 * DEG, moonSet: 14 * DEG, moonMax: 11 * DEG };
    }

    static dirFrom(az, el, out) {
      const ce = Math.cos(el);
      return out.set(Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce);
    }

    update(dayT, wx) {
      const P = this.path;
      // Sol
      const sEl = P.sunMax * Math.sin(2 * Math.PI * (dayT - 0.25));
      const sAz = lerp(P.sunRise, P.sunSet, (dayT - 0.25) / 0.5);
      this.sunEl = sEl;
      TimeOfDay.dirFrom(sAz, sEl, this.sunDir);
      // Lluna (oposada, fa un arc baix que sempre queda dins la finestra)
      let mt = dayT - 0.75; if (mt < -0.25) mt += 1;
      const mEl = P.moonMax * Math.sin(2 * Math.PI * mt) - 1.2 * DEG;
      const mAz = lerp(P.moonRise, P.moonSet, mt / 0.5);
      this.moonEl = mEl;
      TimeOfDay.dirFrom(mAz, mEl, this.moonDir);

      // Interpolació dels fotogrames
      let i = 0;
      while (i < KEYS.length - 1 && KEYS[i + 1].t <= dayT) i++;
      const a = KEYS[i], b = KEYS[(i + 1) % KEYS.length];
      const tb = b.t <= a.t ? b.t + 1 : b.t;
      const f = smooth((dayT - a.t) / (tb - a.t));
      for (const k of COLOR_KEYS) mixC(this.c[k], a[k], b[k], f);
      for (const k of NUM_KEYS) this.v[k] = lerp(a[k], b[k], f);

      // Llum directa
      const sunUp = smooth((Math.sin(sEl) + 0.015) / 0.13);
      this.daylight = smooth((Math.sin(sEl) + 0.1) / 0.3);
      this.sunLightI = sunUp;
      // color de la llum del sol: càlid a prop de l'horitzó
      const warm = 1 - smooth(Math.sin(sEl) / 0.35);
      mixC(this.c.sunLight, tmpA.set('#fff6e8'), mixC(tmpB, this.c.glow, this.c.sun, 0.35), warm);
      const moonUp = smooth((Math.sin(mEl) + 0.02) / 0.08);
      const moonBright = 0.35 + 0.65 * Math.sin(Math.PI * this.moonPhase);
      this.moonLightI = moonUp * moonBright * (1 - this.daylight);

      // Temps: tapat, pluja, tempesta, llampec
      const oc = clamp(wx ? wx.overcast : 0), rain = clamp(wx ? wx.rain : 0), flash = wx ? wx.flash || 0 : 0;
      this.v.overcast = oc; this.v.rain = rain;
      if (oc > 0) {
        const night = 1 - this.daylight;
        const dark = 1 - 0.4 * rain;
        for (const k of Object.keys(OVERCAST_DAY)) {
          mixC(tmpA, OVERCAST_DAY[k], OVERCAST_NIGHT[k], night);
          // conserva una mica del to del moment (posta càlida sota els núvols)
          mixC(tmpB, tmpA, this.c[k], 0.22);
          tmpB.multiplyScalar(dark);
          mixC(this.c[k], this.c[k], tmpB, oc);
        }
        this.v.glowI *= 1 - 0.75 * oc;
        this.v.stars *= 1 - oc;
        this.v.ambI *= 1 - 0.3 * oc - 0.15 * rain;
        this.v.winI *= 1 - 0.35 * oc - 0.15 * rain;
        mixC(this.c.win, this.c.win, tmpA.copy(this.c.hor).multiplyScalar(1.1), oc * 0.6);
        this.sunLightI *= 1 - 0.92 * oc;
        this.moonLightI *= 1 - 0.95 * oc;
        this.v.lamp = Math.max(this.v.lamp, smooth((oc - 0.35) / 0.5) * 0.9 * (0.5 + 0.5 * rain));
      }
      mixC(this.c.cloudRim, this.c.glow, this.c.sun, 0.4);
      if (flash > 0) {
        const fl = tmpA.set('#dcd6ff');
        for (const k of ['top', 'mid', 'hor', 'cloudLit', 'cloudShade', 'seaHi', 'seaLo', 'fog']) mixC(this.c[k], this.c[k], fl, clamp(flash * (k.startsWith('cloud') ? 0.7 : 0.4)));
      }
      this.v.flash = flash;
      this.v.bright = lum(this.c.hor);
    }

    // Fase real de la lluna (0 = nova, 0.5 = plena)
    static realMoonPhase(date = new Date()) {
      const ref = Date.UTC(2000, 0, 6, 18, 14);
      const syn = 29.530588853 * 86400000;
      return (((date.getTime() - ref) / syn) % 1 + 1) % 1;
    }

    // Etiqueta del moment en català
    static phaseName(dayT) {
      const h = dayT * 24;
      if (h < 5) return 'Nit estrellada';
      if (h < 6.4) return 'Alba';
      if (h < 9.5) return 'Matí';
      if (h < 14) return 'Migdia';
      if (h < 16.9) return 'Tarda';
      if (h < 18.6) return 'Posta de sol';
      if (h < 20) return 'Capvespre';
      return 'Nit';
    }
  }

  LOFI.TimeOfDay = TimeOfDay;
})();
