/* Habitació amb vistes — coloms: passen volant i de tant en tant es posen a l'ampit */
(function () {
  'use strict';
  const { clamp, lerp, smooth, RNG, M, Geo, toonMat } = LOFI;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  const PC = { body: '#b3bbcc', belly: '#c3c9d6', wing: '#a4acbf', bar: '#4e5468', neck: '#72b09c', neck2: '#a07cb8', head: '#98a0b4', beak: '#3b3538', cere: '#ece6dc', eye: '#f08a3a', leg: '#d86a6a', tail: '#8a93a8', tailTip: '#3d4254' };

  function bez(p0, p1, p2, p3, t, out) {
    const u = 1 - t;
    return out.set(0, 0, 0)
      .addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t)
      .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t);
  }

  class Pigeon {
    constructor(mat, rng, tint = 0) {
      this.rng = rng;
      const g = (this.g = new THREE.Group());
      g.visible = false;
      g.scale.setScalar(0.92);
      const shade = (hex) => new THREE.Color(hex).multiplyScalar(1 - tint * 0.18);
      // cos
      const B = new Geo();
      B.add(new THREE.SphereGeometry(0.1, 12, 9), (v, n, o) => o.copy(shade(n.y < -0.4 ? PC.belly : PC.body)), M(0, 0.125, 0, 0, 0, 0, 0.62, 0.6, 1.12));
      B.add(new THREE.SphereGeometry(0.062, 10, 8), (v, n, o) => o.copy(shade(v.y < 0.15 ? PC.neck2 : PC.neck)), M(0, 0.165, 0.075, -0.3, 0, 0, 1, 1.15, 1));
      B.add(new THREE.BoxGeometry(0.07, 0.014, 0.11), (v, n, o) => o.copy(shade(v.z < -0.19 ? PC.tailTip : PC.tail)), M(0, 0.115, -0.15, 0.22, 0, 0));
      for (const s of [-1, 1]) {
        // ales plegades amb dues franges fosques
        B.add(new THREE.SphereGeometry(0.1, 10, 7), (v, n, o) => o.copy(shade(Math.abs(v.z + 0.02) < 0.012 || Math.abs(v.z + 0.058) < 0.012 ? PC.bar : PC.wing)), M(s * 0.05, 0.14, -0.035, 0.12, 0, 0, 0.26, 0.45, 1.05));
        B.add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 5), PC.leg, M(s * 0.025, 0.035, 0.02));
        B.box(0.022, 0.006, 0.03, PC.leg, M(s * 0.025, 0.012, 0.03));
      }
      this.bodyMesh = B.mesh(mat, { cast: false, receive: false });
      this.folded = this.bodyMesh;
      g.add(this.bodyMesh);
      // cap
      const head = (this.head = new THREE.Group());
      head.position.set(0, 0.2, 0.1);
      g.add(head);
      const H = new Geo();
      H.add(new THREE.SphereGeometry(0.034, 10, 8), shade(PC.head), M(0, 0.028, 0.02));
      H.add(new THREE.ConeGeometry(0.008, 0.026, 5), PC.beak, M(0, 0.022, 0.062, Math.PI / 2, 0, 0));
      H.add(new THREE.SphereGeometry(0.009, 5, 4), PC.cere, M(0, 0.03, 0.05, 0, 0, 0, 1, 0.7, 1));
      for (const s of [-1, 1]) H.add(new THREE.SphereGeometry(0.007, 5, 4), PC.eye, M(s * 0.025, 0.036, 0.034));
      head.add(H.mesh(mat, { cast: false, receive: false }));
      // ales esteses (per volar)
      this.wings = [];
      for (const s of [-1, 1]) {
        const piv = new THREE.Group();
        piv.position.set(s * 0.045, 0.16, 0.01);
        const W = new Geo();
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.05); shape.lineTo(0.12, 0.06); shape.lineTo(0.27, 0.0); shape.lineTo(0.22, -0.05); shape.lineTo(0.1, -0.07); shape.lineTo(0, -0.06); shape.lineTo(0, 0.05);
        const wg = new THREE.ShapeGeometry(shape);
        wg.rotateX(-Math.PI / 2);
        if (s < 0) wg.scale(-1, 1, 1);
        W.add(wg, (v, n, o) => o.copy(shade(Math.abs(v.x) > 0.2 ? PC.bar : (Math.abs(v.z + 0.02) < 0.01 ? PC.bar : PC.wing))), M());
        const wm = W.mesh(LOFI.pigeonWingMat || (LOFI.pigeonWingMat = toonMat({ vertexColors: true, side: THREE.DoubleSide, key: 'pwing' })), { cast: false, receive: false });
        piv.add(wm);
        piv.visible = false;
        g.add(piv);
        this.wings.push(piv);
      }
      this.state = 'hidden';
      this.t = 0;
      this.flap = 0;
      this.pos = V3();
    }

    setFlying(on) {
      for (const w of this.wings) w.visible = on;
    }

    // posa l'ocell en una trajectòria
    fly(path, dur, next) {
      this.state = 'fly';
      this.path = path; this.dur = dur; this.pt = 0; this.next = next;
      this.g.visible = true;
      this.setFlying(true);
    }

    update(dt, ctx) {
      this.t += dt;
      const g = this.g;
      if (this.state === 'fly') {
        this.pt += dt / this.dur;
        const t = Math.min(this.pt, 1);
        const p = this.path;
        const e = p.ease ? p.ease(t) : t;
        bez(p[0], p[1], p[2], p[3], e, this.pos);
        const ahead = bez(p[0], p[1], p[2], p[3], Math.min(1, e + 0.02), V3());
        const dir = ahead.sub(this.pos);
        if (dir.lengthSq() > 1e-8) {
          g.rotation.y = Math.atan2(dir.x, dir.z);
          g.rotation.x = clamp(-dir.y / Math.max(Math.hypot(dir.x, dir.z), 1e-4), -0.6, 0.6) * 0.6;
        }
        g.position.copy(this.pos);
        // aleteig: fort a l'arrencada i a l'aterratge, planeja a mig camí
        const glide = p.glide ? smooth((t - 0.35) / 0.1) * (1 - smooth((t - 0.6) / 0.1)) : 0;
        const rate = lerp(8.5, 0.0, glide) + (p.landing ? smooth((t - 0.75) / 0.2) * 5 : 0);
        this.flap += dt * rate;
        const amp = lerp(1.05, 0.12, glide);
        const a = Math.sin(this.flap * Math.PI * 2) * amp + 0.15;
        this.wings[0].rotation.z = -a; this.wings[1].rotation.z = a;
        this.head.position.z = 0.1; this.head.rotation.x = 0;
        if (this.pt >= 1) {
          this.g.rotation.x = 0;
          if (this.next === 'ledge') { this.state = 'ledge'; this.setFlying(false); this.lt = 0; this.act = 'idle'; this.actT = 1; this.heading = g.rotation.y; }
          else { this.state = 'hidden'; g.visible = false; this.setFlying(false); }
          if (ctx.onArrive) ctx.onArrive(this);
        }
      } else if (this.state === 'ledge') {
        this.ledgeUpdate(dt, ctx);
      }
    }

    ledgeUpdate(dt, ctx) {
      const g = this.g, r = this.rng;
      this.lt += dt;
      this.actT -= dt;
      if (this.actT <= 0) {
        const opts = ['walk', 'walk', 'peck', 'idle', 'coo', 'turn', 'look'];
        this.act = r.pick(opts);
        this.actT = { walk: r.range(1.2, 3), peck: r.range(0.8, 1.6), idle: r.range(1, 3), coo: r.range(2.2, 3.4), turn: 0.5, look: r.range(1.5, 3.5) }[this.act];
        if (this.act === 'turn') this.targetHeading = r.pick([Math.PI / 2, -Math.PI / 2, 0.15, -0.15]);
        if (this.act === 'look') this.targetHeading = r.chance(0.6) ? Math.PI * 0.95 : (r.chance(0.5) ? Math.PI / 2 : -Math.PI / 2); // de cara al vidre (el gat!)
        if (this.act === 'walk' && Math.abs(Math.sin(this.heading)) < 0.5) this.targetHeading = r.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
        if (this.act === 'coo' && ctx.onCoo) ctx.onCoo(this);
      }
      if (this.targetHeading !== undefined) {
        let d = this.targetHeading - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += d * (1 - Math.exp(-dt * 8));
      }
      g.rotation.y = this.heading;
      let headZ = 0.1, headX = 0, puff = 1, body = 0;
      const lim = ctx.ledge;
      if (this.act === 'walk') {
        const f = 2.6;
        const ph = (this.lt * f) % 1;
        const fwd = V3(Math.sin(this.heading), 0, Math.cos(this.heading));
        const nx = g.position.x + fwd.x * dt * 0.17;
        if (nx < lim.x0 || nx > lim.x1) { this.targetHeading = this.heading + Math.PI; this.act = 'turn'; this.actT = 0.5; }
        else g.position.x = nx;
        headZ = 0.1 + (ph < 0.18 ? lerp(-0.014, 0.02, ph / 0.18) : lerp(0.02, -0.014, (ph - 0.18) / 0.82));
        body = Math.abs(Math.sin(ph * Math.PI * 2)) * 0.006;
      } else if (this.act === 'peck') {
        const ph = (this.lt * 2.2) % 1;
        headX = ph < 0.35 ? Math.sin((ph / 0.35) * Math.PI) * 1.1 : 0;
        headZ = 0.1 + headX * 0.03;
      } else if (this.act === 'coo') {
        const ph = this.lt * 3.1;
        puff = 1 + 0.18 * smooth(Math.sin(ph) * 0.5 + 0.5);
        headX = -0.25 + Math.sin(ph * 2) * 0.12;
        g.rotation.y = this.heading + Math.sin(this.lt * 2.2) * 0.35;
      } else if (this.act === 'look') {
        headX = -0.1;
        this.head.rotation.y = Math.sin(this.lt * 1.7) * 0.5;
      }
      if (this.act !== 'look') this.head.rotation.y *= 0.9;
      this.head.position.z = headZ;
      this.head.rotation.x = headX;
      this.bodyMesh.scale.set(puff, 1 + (puff - 1) * 0.6, 1 + (puff - 1) * 0.3);
      g.position.y = ctx.ledge.y + body;
    }
  }

  class Pigeons {
    constructor(outside, room) {
      this.outside = outside;
      this.room = room;
      this.rng = new RNG(1234);
      this.mat = toonMat({ vertexColors: true, key: 'pigeon' });
      this.list = [];
      for (let i = 0; i < 5; i++) {
        const p = new Pigeon(this.mat, this.rng, i % 3 === 1 ? 1 : i % 3 === 2 ? -0.6 : 0);
        outside.scene.add(p.g);
        this.list.push(p);
      }
      const L = LOFI.LAYOUT;
      this.ledge = { y: L.win.y0 - 0.04, z: -0.3, x0: L.win.x0 + 0.66, x1: L.win.x1 - 0.2, land0: -1.02, land1: -0.28 };
      this.next = this.rng.range(12, 30);
      this.leaveT = 0;
      this.app = null;
    }

    onLedge() { return this.list.some((p) => p.state === 'ledge'); }
    ledgeTarget() {
      const p = this.list.find((q) => q.state === 'ledge' || (q.state === 'fly' && q.next === 'ledge' && q.pt > 0.6));
      return p ? p.g.position.clone().add(V3(0, 0.15, 0)) : null;
    }
    free() { return this.list.filter((p) => p.state === 'hidden'); }

    pan(x) { return clamp(x / 2.2, -1, 1); }

    spawnFlyby(n) {
      const r = this.rng;
      const free = this.free();
      const dir = r.sign();
      const D = r.range(2.5, 11);
      const y0 = r.range(0.4, 3.2);
      const span = 2 + D * 0.9;
      const base = r.range(0, 1);
      for (let i = 0; i < Math.min(n, free.length); i++) {
        const p = free[i];
        const dz = -D - i * r.range(0.3, 0.9), dy = y0 + r.range(-0.3, 0.4) + i * 0.15;
        const off = i * r.range(0.35, 0.7);
        const a = V3(-dir * (span + off), dy + r.range(-0.4, 0.6), dz);
        const d = V3(dir * (span - off + 1), dy + r.range(-0.5, 1.2), dz + r.range(-3, 1));
        const b = a.clone().lerp(d, 0.33).add(V3(0, r.range(-0.8, 0.5), r.range(-1, 1)));
        const c = a.clone().lerp(d, 0.66).add(V3(0, r.range(-0.4, 0.8), r.range(-1, 1)));
        const path = [a, b, c, d];
        path.glide = r.chance(0.6) || base > 0.5;
        const len = a.distanceTo(d);
        p.fly(path, len / r.range(3.2, 4.4), 'hidden');
        p.flap = r.next();
      }
      if (D < 5 && this.app && this.app.audio && this.app.audio.started) this.app.audio.wingFlaps(0, 3 + n);
    }

    spawnLanding() {
      const r = this.rng;
      const p = this.free()[0];
      if (!p) return;
      const L = this.ledge;
      const others = this.list.filter((q) => q.state === 'ledge').map((q) => q.g.position.x);
      // llocs lliures a banda i banda del gat (vistos des de l'habitació)
      const spot = () => (r.chance(0.5) ? r.range(-1.15, -0.9) : r.range(-0.34, -0.08));
      let x = spot();
      for (let k = 0; k < 6 && others.some((o) => Math.abs(o - x) < 0.3); k++) x = spot();
      const side = r.sign();
      const end = V3(x, L.y, L.z);
      const a = V3(side * r.range(3.5, 6), r.range(1.8, 3.4), -r.range(3, 6));
      const b = a.clone().lerp(end, 0.4).add(V3(0, r.range(0.2, 0.8), -1));
      const c = end.clone().add(V3(side * 0.6, 0.55, -0.9));
      const path = [a, b, c, end];
      path.landing = true;
      path.ease = (t) => 1 - Math.pow(1 - t, 1.8);
      p.fly(path, r.range(2.4, 3.2), 'ledge');
      p.landTimer = r.range(18, 55);
      this.pendingFlapAt = 2.0;
      this.pendingPan = this.pan(x);
    }

    takeoff(p) {
      const r = this.rng;
      const s = p.g.position.clone();
      const side = r.sign();
      const a = s.clone();
      const b = s.clone().add(V3(side * 0.4, 0.5, -0.8));
      const c = s.clone().add(V3(side * 2, 1.5, -2.5));
      const d = s.clone().add(V3(side * r.range(5, 8), r.range(2, 4), -r.range(4, 9)));
      p.fly([a, b, c, d], r.range(2.2, 3), 'hidden');
      if (this.app && this.app.audio && this.app.audio.started) this.app.audio.wingFlaps(this.pan(s.x), 6);
    }

    update(dt, tod, wx, S, app) {
      this.app = app;
      const allowed = S.pigeons && tod.daylight > 0.3 && wx.rain < 0.25;
      const ctx = {
        ledge: this.ledge,
        onCoo: (p) => { if (app.audio && app.audio.started) app.audio.pigeonCoo(this.pan(p.g.position.x)); },
        onArrive: () => {},
      };
      for (const p of this.list) {
        p.update(dt, ctx);
        if (p.state === 'ledge') {
          p.landTimer -= dt;
          if (p.landTimer <= 0 || !allowed) this.takeoff(p);
        }
      }
      if (this.pendingFlapAt !== undefined) {
        this.pendingFlapAt -= dt;
        if (this.pendingFlapAt <= 0) { if (app.audio && app.audio.started) app.audio.wingFlaps(this.pendingPan, 5); this.pendingFlapAt = undefined; }
      }
      if (!allowed) return;
      this.next -= dt;
      if (this.next <= 0) {
        const r = this.rng;
        const onLedge = this.list.filter((q) => q.state === 'ledge').length;
        if (r.chance(0.42) && onLedge < 2) this.spawnLanding();
        else this.spawnFlyby(r.int(1, 4));
        this.next = r.range(40, 110);
      }
    }

    // per al panell: força un colom
    summon() { if (this.onLedge() || this.rng.chance(0.3)) this.spawnFlyby(3); else this.spawnLanding(); }
  }

  LOFI.Pigeons = Pigeons;
})();
