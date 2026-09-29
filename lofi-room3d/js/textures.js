/* Habitació amb vistes — textures de píxel dibuixades amb canvas (pantalla del portàtil, làmines) */
(function () {
  'use strict';
  const { RNG, clamp } = LOFI;

  function pixelTex(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }

  // Pantalla del portàtil: editor de codi (o document) que es va escrivint
  const CODE = ['#eb6f92', '#f6c177', '#9ccfd8', '#c4a7e7', '#e0def4', '#e0def4', '#ebbcba', '#8fbfa8'];
  class ScreenTex {
    constructor(w, h) {
      this.w = w; this.h = h;
      const cv = (this.cv = document.createElement('canvas'));
      cv.width = w; cv.height = h;
      this.ctx = cv.getContext('2d');
      this.tex = pixelTex(cv);
      this.rng = new RNG(4242);
      this.mode = 'code';
      this.lineH = 3;
      this.top = 5;
      this.rows = Math.floor((h - this.top - 1) / this.lineH);
      this.lines = [];
      for (let i = 0; i < this.rows - 2; i++) this.lines.push(this.makeLine(true));
      this.cur = this.makeLine(false);
      this.acc = 0; this.pause = 0; this.blink = 0; this.dirty = true;
      this.lineNo = 40;
      this.draw();
    }
    makeLine(done) {
      const r = this.rng;
      if (r.chance(0.14)) return { indent: 0, toks: [], len: 0, typed: 0 };
      const indent = this.mode === 'code' ? r.pick([0, 2, 2, 4, 4, 4, 6, 8]) : 0;
      const toks = [];
      let len = 0;
      const n = this.mode === 'code' ? r.int(1, 4) : r.int(4, 8);
      const maxW = this.w - 10 - indent;
      for (let i = 0; i < n; i++) {
        const l = this.mode === 'code' ? r.int(2, 9) : r.int(2, 7);
        if (len + l + 1 > maxW) break;
        toks.push({ l, c: this.mode === 'code' ? r.pick(CODE) : r.chance(0.08) ? '#c7839a' : '#9a93a8' });
        len += l + 1;
      }
      return { indent, toks, len, typed: done ? len : 0 };
    }
    setMode(m) {
      if (m === this.mode) return;
      this.mode = m;
      this.lines = [];
      for (let i = 0; i < this.rows - 2; i++) this.lines.push(this.makeLine(true));
      this.cur = this.makeLine(false);
      this.dirty = true;
    }
    draw() {
      const g = this.ctx, w = this.w, h = this.h;
      const dark = this.mode === 'code';
      g.fillStyle = dark ? '#232136' : '#f6f1e8';
      g.fillRect(0, 0, w, h);
      // barra de títol
      g.fillStyle = dark ? '#393552' : '#e4dccf';
      g.fillRect(0, 0, w, 3);
      g.fillStyle = '#eb6f92'; g.fillRect(1, 1, 1, 1);
      g.fillStyle = '#f6c177'; g.fillRect(3, 1, 1, 1);
      g.fillStyle = '#9ccfd8'; g.fillRect(5, 1, 1, 1);
      g.fillStyle = dark ? '#6e6a86' : '#b8aea0'; g.fillRect(12, 1, 14, 1);
      const gut = dark ? 6 : 4;
      if (dark) { g.fillStyle = '#2a273f'; g.fillRect(0, 3, gut - 1, h - 3); }
      const all = this.lines.concat([this.cur]);
      const start = Math.max(0, all.length - this.rows);
      for (let i = start; i < all.length; i++) {
        const ln = all[i];
        const y = this.top + (i - start) * this.lineH;
        if (dark) { g.fillStyle = '#56526e'; g.fillRect(1, y, (i + this.lineNo) % 3 === 0 ? 3 : 2, 1); }
        let x = gut + 1 + ln.indent;
        let left = ln.typed;
        for (const t of ln.toks) {
          if (left <= 0) break;
          const l = Math.min(t.l, left);
          g.fillStyle = t.c;
          g.fillRect(x, y, l, 1);
          x += t.l + 1; left -= t.l + 1;
        }
        if (ln === this.cur && this.blink < 0.55) {
          g.fillStyle = dark ? '#e0def4' : '#575279';
          g.fillRect(gut + 1 + ln.indent + Math.min(ln.typed, ln.len), y - 1, 1, 3);
        }
      }
      // minimapa / barra lateral
      g.fillStyle = dark ? '#2a273f' : '#ebe4d8';
      g.fillRect(w - 3, 3, 3, h - 3);
      g.fillStyle = dark ? '#44415a' : '#d4cabb';
      g.fillRect(w - 2, 6 + (this.lineNo % 20), 1, 6);
      this.tex.needsUpdate = true;
    }
    update(dt, st) {
      this.setMode(st.activity === 'study' ? 'doc' : 'code');
      this.blink = (this.blink + dt) % 1.1;
      let changed = false;
      if (st.typing) {
        if (this.pause > 0) this.pause -= dt;
        else {
          this.acc += dt * (this.mode === 'code' ? 11 : 7);
          while (this.acc >= 1) {
            this.acc -= 1;
            this.cur.typed++;
            changed = true;
            if (this.cur.typed >= this.cur.len) {
              this.lines.push(this.cur);
              if (this.lines.length > 60) this.lines.shift();
              this.lineNo++;
              this.cur = this.makeLine(false);
              if (this.rng.chance(0.25)) this.pause = this.rng.range(0.4, 1.8);
              break;
            }
          }
        }
      }
      this._bt = (this._bt || 0) + dt;
      if (changed || this._bt > 0.25) { this._bt = 0; this.draw(); }
    }
  }

  // Làmines de les parets (pixel art petit)
  function artTexture(kind, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
    const rect = (x, y, ww, hh, c) => { g.fillStyle = c; g.fillRect(x, y, ww, hh); };
    if (kind === 'wave') {
      // posta de sol sobre el mar, estil gravat japonès
      const sky = ['#f7e2c8', '#f6d2b4', '#f3bca2', '#eea393', '#e79088'];
      const sh = Math.round(h * 0.56);
      for (let y = 0; y < sh; y++) rect(0, y, w, 1, sky[Math.min(sky.length - 1, Math.floor((y / sh) * sky.length))]);
      // sol
      const cx = Math.round(w * 0.62), cy = Math.round(sh * 0.62), r = Math.round(w * 0.2);
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r && cy + y < sh) px(cx + x, cy + y, (y % 3 === 0 && y > 0) ? '#f6c07a' : '#f6a468');
      // mar amb onades
      const sea = ['#6f9bc4', '#5a86b4', '#4a72a0', '#3e6190'];
      for (let y = sh; y < h; y++) rect(0, y, w, 1, sea[Math.min(sea.length - 1, Math.floor(((y - sh) / (h - sh)) * sea.length))]);
      for (let y = sh + 1; y < h; y += 3) for (let x = (y * 7) % 5; x < w; x += 6) { rect(x, y, 3, 1, '#e8f0f4'); px(x + 1, y - 1, '#e8f0f4'); }
      // ona gran
      for (let x = 0; x < w * 0.45; x++) {
        const yy = Math.round(h - 4 - Math.sin((x / (w * 0.45)) * Math.PI) * h * 0.32);
        rect(x, yy, 1, h - yy, '#2f4f80');
        px(x, yy, '#f4f4ee'); if (x % 3 === 0) px(x, yy + 1, '#f4f4ee');
      }
      // vora
      g.strokeStyle = '#f4ece0'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    } else if (kind === 'leaf') {
      rect(0, 0, w, h, '#f3ead9');
      const cx = w / 2, base = h - 4;
      for (let y = 4; y < base; y++) {
        const t = (y - 4) / (base - 4);
        const half = Math.sin(t * Math.PI) * w * 0.36 * (0.7 + 0.3 * t);
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
          const notch = (Math.floor((y - 4) / 5) % 2 === 0) && Math.abs(x - cx) > half * 0.55 && Math.abs(x - cx) < half * 0.8;
          if (!notch) px(x, y, Math.abs(x - cx) < 1 ? '#8cbf84' : (x < cx ? '#4f8f58' : '#5ea266'));
        }
      }
      for (let y = base; y < h - 1; y++) px(Math.round(cx), y, '#6a8a4a');
      g.strokeStyle = '#e2d6c0'; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    }
    return pixelTex(cv);
  }

  LOFI.ScreenTex = ScreenTex;
  LOFI.artTexture = artTexture;
  LOFI.pixelTex = pixelTex;
})();
