/* Habitació amb vistes — utilitats compartides */
(function () {
  'use strict';
  const LOFI = (window.LOFI = window.LOFI || {});

  // Treballem en espai de pantalla (sRGB) de cap a cap: els colors que escrivim són els que es veuen.
  THREE.ColorManagement.enabled = false;

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => clamp((v - a) / (b - a));
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
  const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
  const wrap = (v, a, b) => { const r = b - a; return ((((v - a) % r) + r) % r) + a; };
  // diferència amb signe més curta en un cercle de període 1
  const cyc = (a, b) => { let d = (b - a) % 1; if (d < -0.5) d += 1; if (d > 0.5) d -= 1; return d; };
  // campana suau centrada a c amb amplada w (en un cercle de període 1)
  const bell = (t, c, w) => { const d = Math.abs(cyc(t, c)) / w; return d >= 1 ? 0 : smooth(1 - d); };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  class RNG {
    constructor(seed = 1) { this.f = mulberry32(seed); }
    next() { return this.f(); }
    range(a, b) { return a + (b - a) * this.f(); }
    int(a, b) { return Math.floor(a + (b - a + 1) * this.f()); }
    pick(arr) { return arr[Math.floor(this.f() * arr.length) % arr.length]; }
    chance(p) { return this.f() < p; }
    sign() { return this.f() < 0.5 ? -1 : 1; }
    gauss() { let u = 0, v = 0; while (u === 0) u = this.f(); while (v === 0) v = this.f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
  }
  const rand = new RNG((Date.now() & 0xffffff) ^ 0x5eed);

  function hash11(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
  function hash21(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return s - Math.floor(s); }
  function vnoise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash11(i), hash11(i + 1), u); }
  function fbm1(x, oct = 3) { let s = 0, a = 0.5, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise1(x); n += a; x *= 2.03; a *= 0.5; } return s / n; }

  const col = (hex) => new THREE.Color(hex);
  function mixC(out, a, b, t) { out.r = lerp(a.r, b.r, t); out.g = lerp(a.g, b.g, t); out.b = lerp(a.b, b.b, t); return out; }
  function lum(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

  // GLSL compartit
  const GLSL = {
    bayer: /* glsl */`
      float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }
    `,
    noise: /* glsl */`
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h12(i), h12(i + vec2(1,0)), u.x), mix(h12(i + vec2(0,1)), h12(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
    `,
  };

  Object.assign(LOFI, {
    TAU, DEG, clamp, lerp, invLerp, smooth, smoother, damp, wrap, cyc, bell,
    RNG, rand, mulberry32, hash11, hash21, vnoise1, fbm1, col, mixC, lum, GLSL,
  });
})();
