/* Habitació amb vistes — personatges: la noia amb cascos i el gat */
(function () {
  'use strict';
  const { clamp, lerp, smooth, damp, RNG, U, DEG, M, Geo, toonMat } = LOFI;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  // Material dels personatges: toon + llum de contorn (rim) des de la finestra
  function charMat(key = 'char') {
    const u = LOFI.charU || (LOFI.charU = {
      uRimCol: { value: new THREE.Color('#ffb080') },
      uRimDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
      uRimI: { value: 0.6 },
    });
    return toonMat({
      vertexColors: true, key, uniforms: u,
      fragmentHead: 'uniform vec3 uRimCol; uniform vec3 uRimDir; uniform float uRimI;',
      fragmentTail: `
        {
          vec3 Vv = normalize(vViewPosition);
          vec3 Rd = normalize((viewMatrix * vec4(uRimDir, 0.0)).xyz);
          float fres = 1.0 - max(dot(normal, Vv), 0.0);
          float rim = step(0.6, fres) * step(0.12, dot(normal, Rd));
          outgoingLight = mix(outgoingLight, uRimCol * (0.45 + 0.75 * diffuseColor.rgb), rim * uRimI);
        }`,
    });
  }
  LOFI.charMat = charMat;

  // Cilindre unitari (alçada 1, base a y=0) per col·locar segments entre dos punts
  function unitCyl(r0, r1, seg = 8) {
    const g = new THREE.CylinderGeometry(r1, r0, 1, seg, 1);
    g.translate(0, 0.5, 0);
    return g;
  }
  const _up = V3(0, 1, 0), _d = V3(), _q = new THREE.Quaternion();
  function placeSeg(mesh, a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / Math.max(len, 1e-5)));
    mesh.scale.set(1, len, 1);
  }
  // IK de dos ossos: retorna el colze
  function ik2(S, T, a, b, pole, outE, outT) {
    const d0 = S.distanceTo(T);
    const d = clamp(d0, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const u = V3().subVectors(T, S).normalize();
    outT.copy(S).addScaledVector(u, d);
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(a * a - x * x, 0));
    const v = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    outE.copy(S).addScaledVector(u, x).addScaledVector(v, h);
    return outE;
  }

  // Tub amb radi variable, reconstruït a cada fotograma (cues, cables...)
  class Tube {
    constructor(n, radial, mat, colorFn) {
      this.n = n; this.radial = radial;
      const vc = n * radial + 1;
      this.pos = new Float32Array(vc * 3);
      this.nor = new Float32Array(vc * 3);
      const col = new Float32Array(vc * 3);
      const idx = [];
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
        const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
        idx.push(a, b, c, b, d, c);
      }
      const tip = n * radial;
      for (let j = 0; j < radial; j++) idx.push((n - 1) * radial + j, (n - 1) * radial + ((j + 1) % radial), tip);
      const cc = new THREE.Color();
      for (let i = 0; i < n; i++) { cc.set(colorFn(i, n)); for (let j = 0; j < radial; j++) col.set([cc.r, cc.g, cc.b], (i * radial + j) * 3); }
      cc.set(colorFn(n - 1, n)); col.set([cc.r, cc.g, cc.b], tip * 3);
      const g = new THREE.BufferGeometry();
      g.setIndex(idx);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.mesh = new THREE.Mesh(g, mat);
      this.mesh.castShadow = true; this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      this._t = V3(); this._n = V3(); this._b = V3(); this._d = V3();
    }
    update(pts, radii) {
      const n = this.n, R = this.radial, P = this.pos, Nn = this.nor;
      const T = this._t, Nv = this._n, B = this._b, D = this._d, up = V3(0, 1, 0);
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        T.subVectors(b, a).normalize();
        Nv.crossVectors(T, Math.abs(T.y) > 0.9 ? V3(1, 0, 0) : up).normalize();
        B.crossVectors(Nv, T).normalize();
        for (let j = 0; j < R; j++) {
          const ang = (j / R) * Math.PI * 2;
          D.copy(Nv).multiplyScalar(Math.cos(ang)).addScaledVector(B, Math.sin(ang));
          const k = (i * R + j) * 3;
          P[k] = pts[i].x + D.x * radii[i]; P[k + 1] = pts[i].y + D.y * radii[i]; P[k + 2] = pts[i].z + D.z * radii[i];
          Nn[k] = D.x; Nn[k + 1] = D.y; Nn[k + 2] = D.z;
        }
      }
      const tip = n * R * 3, last = pts[n - 1];
      T.subVectors(pts[n - 1], pts[n - 2]).normalize();
      P[tip] = last.x + T.x * radii[n - 1]; P[tip + 1] = last.y + T.y * radii[n - 1]; P[tip + 2] = last.z + T.z * radii[n - 1];
      Nn[tip] = T.x; Nn[tip + 1] = T.y; Nn[tip + 2] = T.z;
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.normal.needsUpdate = true;
    }
  }
  LOFI.Tube = Tube;

  const COL = {
    skin: '#f7c4a2', blush: '#f0908c', hair: '#5e3429', hairHi: '#8a4f3c', hairLo: '#46271f',
    sweater: '#f2c35f', sweaterRib: '#e8b44e', pants: '#5b6283', sock: '#f4ede2',
    phone: '#f7f1e8', phoneAcc: '#f3a3b5', phoneDark: '#d8cfc4', scrunch: '#f08aa0',
    lash: '#2c1c1e',
  };

  // ---------------------------------------------------------------------------
  // La noia
  // ---------------------------------------------------------------------------
  class Girl {
    constructor(room) {
      this.room = room;
      this.rng = new RNG(77);
      const L = LOFI.LAYOUT;
      const mat = (this.mat = charMat());
      const root = (this.root = new THREE.Group());
      root.position.set(L.chair.x, 0.07, L.chair.z);
      root.rotation.y = L.chair.yaw;
      room.scene.add(root);

      // cames i malucs (estàtics)
      const LG = new Geo();
      const limb = (a, b, r, c) => {
        const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
        LG.add(new THREE.CapsuleGeometry(r, a.distanceTo(b), 4, 8), c, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(1, 1, 1)));
      };
      LG.add(new THREE.SphereGeometry(0.15, 12, 8), COL.pants, M(0, 0.555, 0.02, 0, 0, 0, 1, 0.6, 0.85));
      for (const s of [-1, 1]) {
        const hip = V3(s * 0.085, 0.55, 0.0), knee = V3(s * 0.09, 0.53, -0.4), ankle = V3(s * 0.095, 0.0, -0.44);
        limb(hip, knee, 0.066, COL.pants);
        limb(knee, ankle, 0.052, COL.pants);
        LG.add(new THREE.SphereGeometry(0.05, 8, 6), COL.sock, M(s * 0.095, -0.035, -0.47, 0, 0, 0, 1, 0.7, 1.6));
      }
      root.add(LG.mesh(mat));

      // columna (s'inclina i respira)
      const spine = (this.spine = new THREE.Group());
      spine.position.set(0, 0.56, 0.03);
      spine.rotation.x = -0.1;
      root.add(spine);
      const TG = new Geo();
      const prof = [[0.132, 0], [0.148, 0.04], [0.157, 0.1], [0.162, 0.18], [0.161, 0.26], [0.154, 0.32], [0.138, 0.36], [0.108, 0.39], [0.07, 0.41], [0.045, 0.42]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      TG.add(new THREE.LatheGeometry(prof, 18), (v, n, o) => o.set(v.y < 0.035 ? COL.sweaterRib : COL.sweater), M(0, 0, 0, 0, 0, 0, 1.1, 1, 0.8), 4);
      TG.add(new THREE.TorusGeometry(0.048, 0.02, 6, 14), COL.sweaterRib, M(0, 0.418, 0, Math.PI / 2, 0, 0, 1, 1, 1), 4);
      TG.add(new THREE.CylinderGeometry(0.036, 0.038, 0.08, 8), COL.skin, M(0, 0.44, -0.005));
      this.torso = TG.mesh(mat);
      spine.add(this.torso);
      this.shoulders = [V3(-0.162, 0.345, -0.005), V3(0.162, 0.345, -0.005)];

      // cap
      const neck = (this.neck = new THREE.Group());
      neck.position.set(0, 0.43, -0.01);
      spine.add(neck);
      const head = (this.head = new THREE.Group());
      head.position.set(0, 0.1, -0.01);
      head.rotation.order = 'YXZ';
      head.scale.setScalar(0.9);
      neck.add(head);
      this.buildHead(head, mat);

      // braços (IK)
      this.arms = [-1, 1].map((s) => this.makeArm(s, mat));

      // estat d'animació
      this.look = { yaw: 10 * DEG, pitch: -14 * DEG, roll: 0 };
      this.lookT = { yaw: 10 * DEG, pitch: -14 * DEG, roll: 0 };
      this.hands = [V3(), V3()];
      this.handsT = [V3(), V3()];
      this.blinkT = 2; this.blinking = 0;
      this.t = 0;
      this.nod = 0;
      this.computeTargets();
      this.handsT[0].copy(this.kb[0]); this.handsT[1].copy(this.kb[1]);
      this.hands[0].copy(this.kb[0]); this.hands[1].copy(this.kb[1]);
    }

    buildHead(head, mat) {
      const G = new Geo();
      // pell
      G.add(new THREE.SphereGeometry(0.1, 20, 14), COL.skin, M(0, 0, 0, 0, 0, 0, 0.93, 1, 0.97));
      G.add(new THREE.SphereGeometry(0.052, 10, 8), COL.skin, M(0, -0.05, -0.035, 0, 0, 0, 1.25, 0.9, 1.1)); // mandíbula
      G.add(new THREE.SphereGeometry(0.014, 6, 5), COL.skin, M(0, -0.016, -0.1, 0, 0, 0, 0.8, 1, 1.1));   // nas
      for (const s of [-1, 1]) {
        G.add(new THREE.SphereGeometry(0.021, 6, 5), COL.blush, M(s * 0.057, -0.03, -0.074, 0, 0, 0, 1, 0.55, 0.5));
        G.add(new THREE.SphereGeometry(0.018, 6, 5), COL.skin, M(s * 0.094, -0.005, 0.005, 0, 0, 0, 0.5, 1, 0.8)); // orella
      }
      // cabell: esfera deformada amb forat per a la cara
      const hg = new THREE.SphereGeometry(0.113, 26, 18);
      const hp = hg.attributes.position;
      const n = V3();
      for (let i = 0; i < hp.count; i++) {
        n.fromBufferAttribute(hp, i).normalize();
        let r = 0.113 + 0.004 * Math.sin(n.x * 23 + n.y * 17) * Math.sin(n.z * 19);
        // obertura de la cara (davant, sota el serrell)
        const face = smooth((-n.z - 0.2) / 0.3) * smooth((0.22 - n.y) / 0.18) * smooth((0.8 - Math.abs(n.x)) / 0.2);
        r = lerp(r, 0.07, face);
        // serrell: una mica més avall al front, en punxes
        if (n.z < -0.3 && n.y > 0.05 && n.y < 0.4) r += 0.006 * (0.5 + 0.5 * Math.sin(n.x * 40));
        // clatell: el cabell baixa fins a l'inici del coll
        let y = n.y * r, x = n.x * r, z = n.z * r;
        if (n.y < -0.1 && n.z > -0.2) { y -= 0.045 * smooth((-n.y - 0.1) / 0.6) * smooth((n.z + 0.2) / 0.6); z += 0.01 * smooth((-n.y) / 0.6); }
        hp.setXYZ(i, x * 0.97, y + 0.008, z + 0.01);
      }
      hg.computeVertexNormals();
      G.add(hg, (v, nn, o) => {
        // reflex de "anell" brillant al cabell
        const lat = v.y;
        if (lat > 0.045 && lat < 0.07 && nn.z > -0.2) return o.set(COL.hairHi);
        if (lat < -0.07) return o.set(COL.hairLo);
        return o.set(COL.hair);
      }, M());
      // monyo, gomet i llapis
      G.add(new THREE.SphereGeometry(0.056, 12, 10), (v, nn, o) => o.set(v.y > 0.16 && nn.x < 0 ? COL.hairHi : COL.hair), M(0.0, 0.1, 0.055, 0, 0, 0, 1, 0.9, 1));
      G.add(new THREE.SphereGeometry(0.03, 8, 6), COL.hair, M(0.03, 0.14, 0.07));
      G.add(new THREE.TorusGeometry(0.036, 0.012, 6, 12), COL.scrunch, M(0.0, 0.07, 0.05, 1.2, 0, 0.1));
      G.add(new THREE.CylinderGeometry(0.0045, 0.0045, 0.17, 6), (v, nn, o) => o.set(v.y > 0.16 ? '#f29b9b' : '#f3c64d'), M(0.0, 0.12, 0.06, 0.3, 0, 1.05));
      // flocs solts a les temples
      for (const s of [-1, 1]) {
        const c = new THREE.CatmullRomCurve3([V3(s * 0.088, 0.045, -0.078), V3(s * 0.1, 0.0, -0.074), V3(s * 0.096, -0.035, -0.07), V3(s * 0.103, -0.06, -0.062)]);
        G.add(new THREE.TubeGeometry(c, 8, 0.0045, 4, false), COL.hairHi, M());
      }
      const nape = new THREE.CatmullRomCurve3([V3(-0.03, -0.06, 0.09), V3(-0.035, -0.11, 0.08), V3(-0.025, -0.15, 0.07)]);
      G.add(new THREE.TubeGeometry(nape, 6, 0.005, 4, false), COL.hair, M());
      this.headMesh = G.mesh(mat);
      head.add(this.headMesh);

      // ulls (pestanyes) — separats per poder parpellejar
      this.eyes = [];
      for (const s of [-1, 1]) {
        const EG = new Geo();
        EG.box(0.03, 0.007, 0.006, COL.lash, M(0, 0, 0));
        EG.box(0.012, 0.005, 0.005, COL.lash, M(s * 0.018, 0.004, 0.002, 0, 0, s * 0.5));
        const e = EG.mesh(mat, { cast: false });
        e.position.set(s * 0.04, 0.008, -0.087);
        e.rotation.set(0.1, -s * 0.42, s * -0.08);
        head.add(e);
        this.eyes.push(e);
      }

      // cascos
      const PG = new Geo();
      PG.add(new THREE.TorusGeometry(0.126, 0.011, 6, 26, Math.PI), COL.phone, M(0, 0.005, 0.01, 0, 0, 0, 1, 1.02, 1));
      PG.add(new THREE.TorusGeometry(0.118, 0.012, 6, 14, Math.PI * 0.42), COL.phoneAcc, M(0, 0.005, 0.01, 0, 0, Math.PI * 0.29, 1, 1.02, 1));
      for (const s of [-1, 1]) {
        const cx = s * 0.125;
        PG.add(new THREE.CylinderGeometry(0.05, 0.05, 0.034, 16), COL.phone, M(cx, -0.012, 0.004, 0, 0, Math.PI / 2));
        PG.add(new THREE.CylinderGeometry(0.036, 0.036, 0.006, 14), COL.phoneDark, M(cx + s * 0.018, -0.012, 0.004, 0, 0, Math.PI / 2));
        PG.add(new THREE.TorusGeometry(0.038, 0.013, 6, 14), COL.phoneAcc, M(cx - s * 0.02, -0.012, 0.004, 0, Math.PI / 2, 0));
        PG.box(0.016, 0.04, 0.022, COL.phone, M(s * 0.126, 0.03, 0.006));
        // petit cor al lateral
        PG.add(new THREE.SphereGeometry(0.008, 6, 5), COL.phoneAcc, M(cx + s * 0.022, -0.006, 0.0));
        PG.add(new THREE.SphereGeometry(0.008, 6, 5), COL.phoneAcc, M(cx + s * 0.022, -0.006, 0.01));
        PG.add(new THREE.ConeGeometry(0.011, 0.012, 6), COL.phoneAcc, M(cx + s * 0.022, -0.016, 0.005, Math.PI, 0, 0));
      }
      this.phones = PG.mesh(mat);
      head.add(this.phones);
      // llumeta del casc
      this.ledMat = new THREE.MeshBasicMaterial({ color: '#8ff0c8' });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 4, 3), this.ledMat);
      led.position.set(-0.143, -0.03, 0.02);
      head.add(led);
      this.led = led;
    }

    makeArm(side, mat) {
      const arm = {};
      const sw = COL.sweater;
      arm.upper = new THREE.Mesh(LOFI.withPat(this.colorGeo(unitCyl(0.052, 0.046, 8), sw), 4), mat);
      arm.fore = new THREE.Mesh(LOFI.withPat(this.colorGeo(unitCyl(0.043, 0.047, 8), sw), 4), mat);
      arm.elbow = new THREE.Mesh(LOFI.withPat(this.colorGeo(new THREE.SphereGeometry(0.047, 8, 6), sw), 4), mat);
      arm.shoulder = new THREE.Mesh(LOFI.withPat(this.colorGeo(new THREE.SphereGeometry(0.056, 10, 8), sw), 4), mat);
      // mà (palmell + dits junts + polze), prou gran al costat de la màniga
      const HG = new Geo();
      HG.add(new THREE.SphereGeometry(0.036, 10, 8), COL.skin, M(0, 0, -0.035, 0, 0, 0, 1.2, 0.62, 1.45));
      HG.add(new THREE.SphereGeometry(0.016, 6, 5), COL.skin, M(side * -0.036, 0.004, -0.028, 0, 0, 0, 1, 0.9, 1.6));
      arm.hand = HG.mesh(mat);
      const cuff = new THREE.CylinderGeometry(0.046, 0.046, 0.028, 8);
      arm.cuff = new THREE.Mesh(LOFI.withPat(this.colorGeo(cuff, COL.sweaterRib), 4), mat);
      for (const k of ['upper', 'fore', 'elbow', 'shoulder', 'hand', 'cuff']) {
        arm[k].castShadow = true; arm[k].receiveShadow = true;
        this.root.add(arm[k]);
      }
      arm.side = side;
      arm.S = V3(); arm.E = V3(); arm.W = V3();
      return arm;
    }

    colorGeo(g, col) {
      const c = new THREE.Color(col);
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    }

    // punts objectiu en coordenades locals de la noia
    computeTargets() {
      const room = this.room;
      this.root.updateMatrixWorld(true);
      room.laptop.updateMatrixWorld(true);
      room.notebook.updateMatrixWorld(true);
      const toLocal = (v) => this.root.worldToLocal(v.clone());
      const lp = room.laptop;
      this.kb = [toLocal(lp.localToWorld(V3(-0.075, 0.058, 0.035))), toLocal(lp.localToWorld(V3(0.07, 0.058, 0.03)))];
      this.pad = toLocal(lp.localToWorld(V3(0.0, 0.056, 0.08)));
      const nb = room.notebook;
      this.nbL = toLocal(nb.localToWorld(V3(-0.1, 0.058, 0.03)));
      this.nbR = toLocal(nb.localToWorld(V3(0.06, 0.056, 0.02)));
      // mans a la falda (sobre les cuixes, lluny de la taula)
      this.rest = [V3(-0.12, 0.645, -0.17), V3(0.12, 0.645, -0.16)];
      this.chin = V3(-0.03, 1.0, -0.2);
    }

    mugLocal() { return this.root.worldToLocal(this.room.mug.position.clone()); }

    update(dt, st, beat) {
      this.t += dt;
      const t = this.t;
      // respiració
      const br = Math.sin(t * 1.55);
      this.spine.scale.set(1 + br * 0.006, 1 + br * 0.012, 1 + br * 0.008);
      this.lean = damp(this.lean || 0, st.leanFwd || 0, 4, dt);
      this.spine.rotation.x = -0.1 + br * 0.006 - this.lean;
      // mirada
      const k = 1 - Math.exp(-dt * 5);
      this.look.yaw += (this.lookT.yaw - this.look.yaw) * k;
      this.look.pitch += (this.lookT.pitch - this.look.pitch) * k;
      this.look.roll += (this.lookT.roll - this.look.roll) * k;
      // cop de cap amb el ritme
      let nod = 0;
      if (beat && beat.playing && beat.beat !== null) {
        const ph = beat.beat % 1;
        nod = Math.exp(-ph * 7) * 0.055 * (st.nodAmt === undefined ? 1 : st.nodAmt) * (beat.drums === false ? 0.35 : 1);
      }
      this.nod = damp(this.nod, nod, 25, dt);
      const sway = Math.sin(t * 0.37) * 0.02;
      this.head.rotation.set(this.look.pitch - this.nod, this.look.yaw + sway * 0.5, this.look.roll + sway);
      // parpelleig
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blinking = 0.13; this.blinkT = this.rng.range(2.5, 6.5); }
      if (this.blinking > 0) this.blinking -= dt;
      for (const e of this.eyes) e.scale.y = this.blinking > 0 ? 0.3 : 1;
      // llumeta del casc
      this.led.visible = Math.sin(t * 2.2) > -0.2;

      // mans (objectius amb suavitzat); si una mà ve de sota la taula, primer puja per sobre la vora
      const hw = this._hw || (this._hw = V3());
      for (let i = 0; i < 2; i++) {
        this.hands[i].lerp(this.handsT[i], 1 - Math.exp(-dt * 9));
        hw.copy(this.hands[i]).applyMatrix4(this.root.matrixWorld);
        if (hw.z < 0.745 && hw.y < 0.785) { hw.y = 0.785; this.hands[i].copy(this.root.worldToLocal(hw)); }
      }
      // braços
      this.spine.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) this.solveArm(this.arms[i], this.hands[i], i);
    }

    solveArm(arm, target, i) {
      const s = arm.side;
      arm.S.copy(this.shoulders[i]);
      this.spine.localToWorld(arm.S);
      this.root.worldToLocal(arm.S);
      const pole = (this.poles && this.poles[i]) || V3(s * 0.9, -0.12, 0.42);
      ik2(arm.S, target, 0.25, 0.23, pole, arm.E, arm.W);
      placeSeg(arm.upper, arm.S, arm.E);
      placeSeg(arm.fore, arm.E, arm.W);
      arm.elbow.position.copy(arm.E);
      arm.shoulder.position.copy(arm.S).add(V3(s * -0.012, 0.004, 0));
      // puny i mà
      const dir = V3().subVectors(arm.W, arm.E).normalize();
      arm.cuff.position.copy(arm.W).addScaledVector(dir, -0.012);
      arm.cuff.quaternion.setFromUnitVectors(_up, dir);
      arm.hand.position.copy(arm.W).addScaledVector(dir, 0.008);
      // la mà mira cap endavant seguint l'avantbraç, palmell avall
      const m = new THREE.Matrix4().lookAt(V3(0, 0, 0), dir.clone().negate(), V3(0, 1, 0));
      arm.hand.quaternion.setFromRotationMatrix(m);
    }
  }

  // ---------------------------------------------------------------------------
  // El gat (dorm a l'ampit; es desperta si hi ha coloms)
  // ---------------------------------------------------------------------------
  const CAT = { fur: '#e9a15e', furDark: '#c87a3c', white: '#f8f0e6', nose: '#f0a0a6', eye: '#b8d86a', pupil: '#2a2420', ear: '#f3b8b0' };
  class Cat {
    constructor(room) {
      this.room = room;
      this.rng = new RNG(31);
      const L = LOFI.LAYOUT;
      const mat = (this.mat = charMat('cat'));
      const root = (this.root = new THREE.Group());
      root.position.set(L.cat.x, L.win.y0 + 0.003, L.cat.z);
      root.rotation.y = 0;
      // gat adult arraulit (~42 cm), més gran que un colom, i que cap a l'ampit sense sobresortir
      root.scale.setScalar(1.3);
      room.scene.add(root);
      const cx0 = L.cat.x, cy0 = L.win.y0;
      const tabby = (v, n, o) => {
        // coordenades locals del gat
        const lx = v.x, ly = v.y;
        const white = (lx < -0.06 && (n.y < 0.25 || ly < 0.05)) || ly < 0.014;
        if (white) return o.set(CAT.white);
        return o.set(CAT.fur);
      };
      // cos arrupit (més rodó)
      const BG = new Geo();
      BG.add(new THREE.SphereGeometry(0.1, 18, 12), tabby, M(0.02, 0.068, 0, 0, 0, 0, 1.3, 0.7, 0.92), 8);
      BG.add(new THREE.SphereGeometry(0.08, 14, 10), tabby, M(0.1, 0.064, -0.01, 0, 0, 0, 1, 0.78, 0.9), 8);
      BG.add(new THREE.SphereGeometry(0.05, 10, 8), tabby, M(-0.07, 0.06, 0.03, 0, 0, 0, 1, 0.8, 0.9), 8);
      // potes davanteres blanques
      BG.add(new THREE.SphereGeometry(0.024, 8, 6), CAT.white, M(-0.12, 0.018, 0.066, 0, 0.25, 0, 1.6, 0.8, 1));
      BG.add(new THREE.SphereGeometry(0.024, 8, 6), CAT.white, M(-0.088, 0.016, 0.078, 0, 0.25, 0, 1.6, 0.8, 1));
      this.body = BG.mesh(mat);
      root.add(this.body);
      // cap
      const head = (this.head = new THREE.Group());
      head.position.set(-0.12, 0.06, 0.035);
      head.rotation.order = 'YXZ';
      root.add(head);
      const HG = new Geo();
      HG.add(new THREE.SphereGeometry(0.063, 14, 10), (v, n, o) => o.set(n.z > 0.5 && n.y < 0.1 ? CAT.white : (n.y > 0.5 && Math.sin(n.x * 40) > 0.3 ? CAT.furDark : CAT.fur)), M(0, 0, 0, 0, 0, 0, 1.08, 0.92, 1));
      HG.add(new THREE.SphereGeometry(0.028, 8, 6), CAT.white, M(0, -0.02, 0.045, 0, 0, 0, 1.2, 0.8, 0.9));
      HG.add(new THREE.SphereGeometry(0.008, 5, 4), CAT.nose, M(0, -0.008, 0.07));
      this.head.add(HG.mesh(mat));
      this.ears = [];
      for (const s of [-1, 1]) {
        const eg = new Geo();
        eg.add(new THREE.ConeGeometry(0.024, 0.045, 4), CAT.fur, M(0, 0.02, 0));
        eg.add(new THREE.ConeGeometry(0.014, 0.03, 4), CAT.ear, M(0, 0.016, 0.008));
        const ear = eg.mesh(mat);
        ear.position.set(s * 0.034, 0.045, -0.005);
        ear.rotation.set(-0.1, 0, s * -0.35);
        head.add(ear);
        this.ears.push(ear);
      }
      // ulls: tancats (línia) i oberts
      this.eyesClosed = []; this.eyesOpen = [];
      for (const s of [-1, 1]) {
        const c = new Geo().box(0.022, 0.004, 0.004, '#4a3228', M(0, 0, 0, 0, 0, s * 0.25)).mesh(mat, { cast: false });
        c.position.set(s * 0.024, 0.008, 0.052);
        head.add(c); this.eyesClosed.push(c);
        const og = new Geo();
        og.add(new THREE.SphereGeometry(0.012, 8, 6), CAT.eye, M(0, 0, 0, 0, 0, 0, 1, 1, 0.5));
        og.box(0.004, 0.016, 0.004, CAT.pupil, M(0, 0, 0.006));
        const o = og.mesh(mat, { cast: false });
        o.position.set(s * 0.025, 0.01, 0.05);
        o.visible = false;
        head.add(o); this.eyesOpen.push(o);
      }
      // cua: tub amb gruix variable que es refà a cada fotograma
      this.tail = new LOFI.Tube(14, 7, mat, (i, n) => (i >= n - 2 ? CAT.white : (i % 4 === 1 ? CAT.furDark : CAT.fur)));
      root.add(this.tail.mesh);
      this.tailPts = Array.from({ length: 14 }, () => V3());
      this.tailR = Array.from({ length: 14 }, (_, i) => lerp(0.019, 0.012, i / 13));
      // volums del cos (coordenades locals) perquè la cua no els travessi; l'últim és el cap (es mou)
      const E = (x, y, z, rx, ry, rz) => ({ c: V3(x, y, z), r: V3(rx, ry, rz) });
      this.bodyParts = [
        E(0.02, 0.068, 0, 0.13, 0.07, 0.092), E(0.1, 0.064, -0.01, 0.08, 0.0624, 0.072), E(-0.07, 0.06, 0.03, 0.05, 0.04, 0.045),
        E(-0.12, 0.018, 0.066, 0.04, 0.02, 0.03), E(-0.088, 0.016, 0.078, 0.04, 0.02, 0.03), E(-0.12, 0.06, 0.035, 0.07, 0.062, 0.068),
      ];
      // vora de l'ampit (z = 0.2175) en coordenades locals del gat
      this.zMaxLocal = (0.2175 - L.cat.z) / 1.3;
      this.t = 0;
      this.awake = 0; this.awakeT = 0;
      this.look = { yaw: 0, pitch: 0 };
      this.lookT = { yaw: 0, pitch: 0 };
      this.earT = 5;
      this.purring = true;
    }
    colorGeo(g, col) { return Girl.prototype.colorGeo(g, col); }

    update(dt, target) {
      this.t += dt;
      const t = this.t;
      const br = Math.sin(t * 2.1);
      this.body.scale.set(1 + br * 0.012, 1 + br * 0.03, 1 + br * 0.012);
      // despertar si hi ha un colom
      const wantAwake = target ? 1 : 0;
      this.awake = damp(this.awake, wantAwake, wantAwake ? 3 : 0.6, dt);
      const aw = this.awake;
      if (target) {
        const lp = this.root.worldToLocal(target.clone());
        const hp = this.head.position;
        // el cap mira cap a +z en local: yaw = atan2(dx, dz)
        let yaw = Math.atan2(lp.x - hp.x, lp.z - hp.z);
        this.lookT.yaw = clamp(yaw, -2.5, 2.5);
        this.lookT.pitch = -0.12;
      } else { this.lookT.yaw = 0.35; this.lookT.pitch = 0.3; }
      const k = 1 - Math.exp(-dt * 4);
      this.look.yaw += (this.lookT.yaw * aw - this.look.yaw) * k;
      this.look.pitch += (lerp(0.3, this.lookT.pitch, aw) - this.look.pitch) * k;
      this.head.position.y = lerp(0.06, 0.12, aw) + br * 0.002;
      this.head.position.x = lerp(-0.12, -0.1, aw);
      this.head.rotation.set(this.look.pitch, this.look.yaw, lerp(0.35, 0, aw));
      const open = aw > 0.6;
      for (const e of this.eyesClosed) e.visible = !open;
      for (const e of this.eyesOpen) e.visible = open;
      // orelles: tremolor de tant en tant, i ben dretes si està despert
      this.earT -= dt;
      let tw = 0;
      if (this.earT < 0) { tw = Math.sin(-this.earT * 40) * 0.5; if (this.earT < -0.25) this.earT = this.rng.range(4, 14); }
      this.ears[0].rotation.z = 0.35 + tw * (1 - aw) - aw * 0.1;
      this.ears[1].rotation.z = -0.35 - aw * 0.1 + Math.sin(t * 9) * 0.05 * smooth((aw - 0.4) / 0.3);
      // cua enrotllada al voltant del cos; la punta es mou (molt si mira alguna cosa).
      // Cada punt s'aparta de les parts del cos i no surt de l'ampit ni hi entra.
      const N = this.tailPts.length;
      const parts = this.bodyParts;
      const hp = this.head.position;
      parts[parts.length - 1].c.set(hp.x, hp.y, hp.z);
      const bs = 1 + Math.abs(br) * 0.03;
      // fases acumulades: si la velocitat canvia (despert ↔ adormit), el moviment no fa salts
      this.tailPh = (this.tailPh || 0) + dt * (1.2 + aw * 4);
      this.liftPh = (this.liftPh || 0) + dt * (0.9 + aw * 3);
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const ang = lerp(-0.35, 2.05, u);
        const wig = Math.sin(this.tailPh - u * 3) * (0.012 + aw * 0.04) * u * u;
        const lift = Math.max(0, Math.sin(this.liftPh - u * 2.5)) * (0.003 + aw * 0.022) * u * u;
        const R = 0.13 - u * 0.02;
        const p = this.tailPts[i].set(0.04 + Math.cos(ang) * R * 1.1 + wig, 0.022 + u * 0.012 + lift, Math.sin(ang) * R * 0.78 + 0.01);
        const rad = this.tailR[i] + 0.004;
        for (let it = 0; it < 4; it++) {
          for (const e of parts) {
            const ex = e.r.x * bs + rad, ey = e.r.y * bs + rad, ez = e.r.z * bs + rad;
            const qx = (p.x - e.c.x) / ex, qy = (p.y - e.c.y) / ey, qz = (p.z - e.c.z) / ez;
            const l = Math.sqrt(qx * qx + qy * qy + qz * qz);
            if (l < 1) { const k = 1 / Math.max(l, 1e-4); p.set(e.c.x + qx * k * ex, e.c.y + qy * k * ey, e.c.z + qz * k * ez); }
          }
          p.y = Math.max(p.y, this.tailR[i] + 0.003);
          p.z = Math.min(p.z, this.zMaxLocal - this.tailR[i]);
        }
      }
      this.tail.update(this.tailPts, this.tailR);
      this.purring = aw < 0.3;
    }
  }

  // ---------------------------------------------------------------------------
  // Direcció: activitats de la noia, interaccions amb el gat i els coloms
  // ---------------------------------------------------------------------------
  class Characters {
    constructor(room, outside) {
      this.room = room;
      this.outside = outside;
      this.girl = new Girl(room);
      this.cat = new Cat(room);
      this.pigeons = LOFI.Pigeons ? new LOFI.Pigeons(outside, room) : null;
      this.rng = new RNG(5);
      this.act = { name: 'type', t: 0, dur: 20, phase: 0 };
      this.mode = 'computer';
      this.tap = 0;
      this.sipState = null;
      this.lastSip = 0;
      this.idle = 0;
    }

    pickNext(st) {
      const r = this.rng, a = this.act;
      const study = this.mode === 'study';
      const opts = study
        ? [['write', 5], ['think', 1.2], ['window', 1], ['sip', 1], ['read', 2]]
        : [['type', 6], ['think', 1], ['window', 1.1], ['sip', 1], ['scroll', 1.5]];
      if (this.pigeons && this.pigeons.onLedge() && r.chance(0.7)) opts.push(['pigeon', 6]);
      const tot = opts.reduce((s, o) => s + o[1], 0);
      let x = r.next() * tot, name = opts[0][0];
      for (const o of opts) { if ((x -= o[1]) <= 0) { name = o[0]; break; } }
      if (name === a.name && name !== 'type' && name !== 'write') name = study ? 'write' : 'type';
      const durs = { type: [14, 40], write: [14, 36], think: [4, 8], window: [5, 10], sip: [5.5, 6.5], scroll: [4, 9], read: [6, 12], pigeon: [5, 9] };
      const d = durs[name];
      Object.assign(a, { name, t: 0, dur: r.range(d[0], d[1]), phase: 0 });
    }

    // ---------------- el flexo (amb una mica de vida pròpia, però discret) ----------------
    // Normalment il·lumina la feina: el teclat o, quan ella escriu, la llibreta (l'ajuda).
    // De tant en tant, i poc sovint, fa un gest de curiositat variat.
    updateLamp(dt, wx, beat) {
      const lamp = this.room.desklamp;
      if (!lamp) return;
      const r = this.rng, room = this.room, act = this.act.name;
      const lb = this.lampB || (this.lampB = { act: 'rest', t: r.range(70, 150), cool: 0, age: 0, seen: {} });
      lb.t -= dt; lb.cool -= dt; lb.age += dt;
      lamp.nod = 0;
      const tmp = this._lampV || (this._lampV = V3());
      // on apunta quan treballa
      const work = act === 'write' || act === 'read';
      if (!this._workAim) this._workAim = lamp.restAim.clone();
      const wa = work ? tmp.copy(room.notebook.position).add(V3(0, 0.01, 0)) : tmp.set(0.5, 0.745, 0.58);
      this._workAim.lerp(wa, 1 - Math.exp(-dt * 1.2));
      lamp.restAim.copy(this._workAim);
      const start = (name, dur) => { lb.act = name; lb.t = dur; lb.age = 0; };
      // reaccions (una sola vegada per cosa, i no sempre)
      const once = (key, p) => { if (lb.seen[key]) return false; lb.seen[key] = true; return r.chance(p); };
      if (wx.flash > 0.5 && lb.cool <= 0 && lb.act !== 'startle') { start('startle', 1.4); lb.cool = 20; }
      if (lb.act === 'rest' && lb.cool <= 0) {
        const pt = this.pigeons && this.pigeons.ledgeTarget();
        const ff = this.outside && this.outside.fireflyTarget ? this.outside.fireflyTarget() : null;
        if (!pt) lb.seen.pigeon = false;
        if (!ff) lb.seen.firefly = false;
        if (act !== 'window') lb.seen.window = false;
        if (act !== 'sip') lb.seen.sip = false;
        if (pt && once('pigeon', 0.35)) { start('curious', r.range(3, 4.5)); lb.target = 'pigeon'; lb.cool = 25; }
        else if (ff && once('firefly', 0.45)) { start('curious', r.range(3.5, 5)); lb.target = 'firefly'; lb.cool = 25; }
        else if (act === 'window' && once('window', 0.3)) { start('window', r.range(4, 6)); lb.cool = 25; }
        else if (act === 'sip' && once('sip', 0.2)) { start('mug', 2.5); lb.cool = 25; }
      }
      if (lb.t <= 0) {
        if (lb.act !== 'rest') { lb.act = 'rest'; lb.t = r.range(90, 240); lb.cool = 12; lamp.rest(); }
        else {
          // un gest espontani, variat (i sense repetir l'anterior)
          const music = beat && beat.playing && beat.drums;
          const opts = [['peek', 2], ['cat', this.cat.root.visible ? (this.cat.awake > 0.5 ? 2.5 : 1) : 0], ['girl', 1], ['stretch', 0.5], ['dance', music ? 1 : 0], ['mug', 0.4]]
            .filter((o) => o[0] !== lb.last);
          const tot = opts.reduce((x, o) => x + o[1], 0);
          let x = r.next() * tot, pick = 'peek';
          for (const o of opts) { if ((x -= o[1]) <= 0) { pick = o[0]; break; } }
          lb.last = pick;
          start(pick, { peek: r.range(2.5, 3.5), cat: r.range(2.5, 4), girl: r.range(2, 3), stretch: 2.2, dance: r.range(4, 6), mug: 2.2 }[pick]);
        }
      }
      switch (lb.act) {
        case 'startle': this.girl.head.getWorldPosition(tmp); tmp.y += 0.9; lamp.look(tmp, { a1: -0.2, a2: 0.55, tilt: 0.35 }); break;
        case 'curious': {
          const p = lb.target === 'pigeon' ? this.pigeons && this.pigeons.ledgeTarget() : this.outside.fireflyTarget();
          if (p) lamp.look(p, { a1: 0.04, a2: 1.05, tilt: 0.28 }); else lb.t = Math.min(lb.t, 0.3);
          break;
        }
        case 'cat': this.cat.head.getWorldPosition(tmp); lamp.look(tmp, { a1: 0.12, a2: 1.2, tilt: 0.3 }); break;
        case 'girl': this.girl.head.getWorldPosition(tmp); lamp.look(tmp, { a1: 0.08, a2: 1.1, tilt: -0.25 }); break;
        case 'peek': lamp.look(room.screenWorld, { a1: 0.3, a2: 1.45, tilt: 0.28 }); break;
        case 'mug': tmp.copy(room.mug.position); tmp.y += 0.06; lamp.look(tmp, { a1: 0.2, a2: 1.35, tilt: 0.2 }); break;
        case 'window': tmp.set(-0.3 + Math.sin(lb.age * 0.35) * 0.9, 1.45, -3); lamp.look(tmp, { a1: -0.04, a2: 0.95, tilt: 0.1 }); break;
        case 'stretch': tmp.copy(lamp.base).add(V3(0.05, 1.4, 0.15)); lamp.look(tmp, { a1: -0.18, a2: 0.32, tilt: 0 }); break;
        case 'dance': {
          lamp.look(lamp.restAim, { a1: 0.1, a2: 1.28, tilt: 0 });
          if (beat && beat.playing && beat.beat !== null) {
            lamp.nod = Math.exp(-(beat.beat % 1) * 5) * 0.15;
            lamp.goal.tilt = Math.sin(beat.beat * Math.PI * 0.5) * 0.2;
          } else lb.t = Math.min(lb.t, 0.3);
          break;
        }
        default: lamp.rest(); lamp.goal.tilt = Math.sin(lb.age * 0.23) * 0.03;
      }
    }

    update(dt, tod, wx, st, S, app) {
      const g = this.girl, room = this.room, r = this.rng;
      // mode (auto alterna entre ordinador i estudi cada estona)
      const want = S.activity === 'auto' ? (this.autoMode || 'computer') : S.activity;
      if (S.activity === 'auto') {
        this.autoT = (this.autoT || r.range(150, 300)) - dt;
        if (this.autoT <= 0) { this.autoMode = (this.autoMode || 'computer') === 'computer' ? 'study' : 'computer'; this.autoT = r.range(160, 360); }
      }
      if (want !== this.mode) { this.mode = want; this.act.t = this.act.dur; }
      st.activity = this.mode;

      const a = this.act;
      a.t += dt;
      if (a.t >= a.dur) this.pickNext(st);
      const L = g.lookT, H = g.handsT;
      st.typing = false; st.writing = false;
      const t = g.t;
      const jitter = (s) => V3((Math.sin(t * 7.1 + s) + Math.sin(t * 11.3 + s * 2)) * 0.003, Math.max(0, Math.sin(t * 13 + s * 3)) * 0.006, 0);
      switch (a.name) {
        case 'type': {
          // escriu a ràfegues: una estona teclejant, una estona pensant o llegint
          this.burst = (this.burst === undefined ? 4 : this.burst) - dt;
          if (this.burst <= 0) { this.typingOn = !this.typingOn; this.burst = this.typingOn ? r.range(2.5, 9) : r.range(1.5, 7); }
          st.typing = !!this.typingOn;
          L.yaw = 14 * DEG; L.pitch = -15 * DEG; L.roll = 0.04;
          H[0].copy(g.kb[0]).add(st.typing ? jitter(0) : V3());
          H[1].copy(g.kb[1]).add(st.typing ? jitter(5) : V3());
          break;
        }
        case 'scroll': {
          L.yaw = 12 * DEG; L.pitch = -13 * DEG; L.roll = 0.05;
          H[0].copy(g.rest[0]);
          H[1].copy(g.pad).add(V3(Math.sin(t * 1.5) * 0.02, 0, Math.cos(t * 1.1) * 0.01));
          break;
        }
        case 'write': {
          st.writing = Math.sin(t * 0.9) > -0.7;
          L.yaw = 2 * DEG; L.pitch = -30 * DEG; L.roll = 0.08;
          H[0].copy(g.kb[0]);   // la mà esquerra reposa al portàtil; escriu amb la dreta
          const w = st.writing ? V3(Math.sin(t * 9) * 0.01 + ((t * 0.02) % 0.06), Math.abs(Math.sin(t * 17)) * 0.004, Math.cos(t * 9) * 0.006) : V3();
          H[1].copy(g.nbR).add(w);
          break;
        }
        case 'read': {
          L.yaw = 6 * DEG; L.pitch = -26 * DEG; L.roll = -0.04;
          H[0].copy(g.kb[0]); H[1].copy(g.nbR);
          if (a.phase === 0 && a.t > a.dur * 0.6) { a.phase = 1; if (app.audio && app.audio.started) app.audio.pageTurn(); }
          if (a.phase === 1 && a.t < a.dur * 0.72) H[1].copy(g.nbR).lerp(g.nbL, 0.35).add(V3(0, 0.03, 0));
          break;
        }
        case 'think': {
          L.yaw = 26 * DEG; L.pitch = 4 * DEG; L.roll = -0.12;
          H[0].copy(g.chin); H[1].copy(g.kb[1]);
          break;
        }
        case 'window': {
          L.yaw = -30 * DEG; L.pitch = 5 * DEG; L.roll = -0.05;
          H[0].copy(g.rest[0]); H[1].copy(g.kb[1]);
          break;
        }
        case 'pigeon': {
          const p = this.pigeons && this.pigeons.ledgeTarget();
          if (p) {
            const lp = g.root.worldToLocal(p.clone());
            L.yaw = clamp(Math.atan2(-lp.x, -lp.z), -0.2, 1.1); L.pitch = 0.02; L.roll = -0.08;
          } else { L.yaw = 40 * DEG; L.pitch = 0.05; }
          H[0].copy(g.rest[0]); H[1].copy(g.kb[1]);
          break;
        }
        case 'sip': {
          const m = room.mug;
          if (!this.mugHome) { this.mugHome = m.position.clone(); this.mugHomeQ = m.quaternion.clone(); }
          const u = a.t / a.dur;
          const ss = (x0, x1) => smooth((u - x0) / (x1 - x0));
          const toGirl = V3(g.root.position.x - this.mugHome.x, 0, g.root.position.z - this.mugHome.z).normalize();
          // l'agafa per la nansa: la mà queda just al costat de la nansa, del cantó de la noia
          const handleW = room.mugHandle.clone().applyQuaternion(this.mugHomeQ).add(this.mugHome);
          const handOff = toGirl.clone().multiplyScalar(0.022).add(V3(0, 0.004, 0));
          const grabW = handleW.clone().add(handOff);
          const grabL = g.root.worldToLocal(grabW.clone());
          const aboveL = g.root.worldToLocal(grabW.clone().add(V3(0, 0.06, 0)).addScaledVector(toGirl, 0.03));
          const mouthL = g.root.worldToLocal(g.head.localToWorld(V3(-0.01, -0.105, -0.14)));
          const reach = ss(0.0, 0.12) * (1 - ss(0.8, 0.92));
          const up = ss(0.27, 0.42) * (1 - ss(0.64, 0.78));
          st.leanFwd = 0.07 * reach * (1 - up) + 0.02 * up;
          if (u < 0.14) H[0].copy(g.kb[0]).lerp(aboveL, ss(0, 0.12));
          else if (u < 0.27) H[0].copy(aboveL).lerp(grabL, ss(0.14, 0.25));
          else if (u < 0.8) H[0].copy(grabL).lerp(mouthL, up);
          else if (u < 0.86) H[0].copy(grabL).lerp(aboveL, ss(0.8, 0.85));
          else H[0].copy(aboveL).lerp(g.kb[0], ss(0.86, 1.0));
          L.yaw = lerp(20, 12, up) * DEG; L.pitch = lerp(-22, 9, up) * DEG; L.roll = 0;
          g.poles = [V3().set(-0.75, -0.55, 0.15).lerp(V3(-0.25, -0.95, -0.35), up), null];
          H[1].copy(g.kb[1]);
          // mentre la té agafada: la nansa segueix la mà i la tassa s'inclina cap a ella per beure
          const holding = u > 0.25 && u < 0.8;
          if (holding) {
            const hw = g.root.localToWorld(g.hands[0].clone());
            const tip = ss(0.44, 0.52) * (1 - ss(0.58, 0.64));
            const axis = V3().crossVectors(V3(0, 1, 0), toGirl).normalize();
            const Q = new THREE.Quaternion().setFromAxisAngle(axis, 0.5 * tip).multiply(this.mugHomeQ);
            const handleNow = hw.sub(handOff);
            m.quaternion.copy(Q);
            m.position.copy(handleNow).sub(room.mugHandle.clone().applyQuaternion(Q));
          } else { m.position.copy(this.mugHome); m.quaternion.copy(this.mugHomeQ); }
          break;
        }
      }
      if (a.name !== 'sip' && this.mugHome) { room.mug.position.copy(this.mugHome); room.mug.quaternion.copy(this.mugHomeQ); }
      st.nodAmt = a.name === 'type' || a.name === 'write' || a.name === 'scroll' ? 1 : 0.5;
      // colzes: amunt quan agafa la tassa, enfora quan té la mà a la falda
      const lapL = H[0].distanceTo(g.rest[0]) < 0.05, lapR = H[1].distanceTo(g.rest[1]) < 0.05;
      if (a.name !== 'sip') {
        g.poles = [a.name === 'think' ? V3(-0.85, -0.35, -0.25) : lapL ? V3(-1, -0.25, 0.15) : null, lapR ? V3(1, -0.25, 0.15) : null];
        st.leanFwd = 0;
      }
      if (LOFI.charU) {
        const cu = LOFI.charU;
        cu.uRimCol.value.copy(tod.c.win).lerp(tod.c.glow, 0.5 * tod.v.glowI);
        cu.uRimI.value = clamp(0.25 + 0.55 * tod.v.winI * (1 - 0.4 * tod.v.overcast), 0, 0.85) + tod.v.flash * 0.6;
      }
      const beat = app.audio && app.audio.started && app.audio.getBeat ? app.audio.getBeat() : null;
      g.update(dt, st, beat);
      this.updateLamp(dt, wx, beat);

      // gat i coloms
      if (this.pigeons) this.pigeons.update(dt, tod, wx, S, app);
      const pt = S.cat ? ((this.pigeons && this.pigeons.ledgeTarget()) || (this.outside.fireflyTarget && this.outside.fireflyTarget())) : null;
      this.cat.root.visible = !!S.cat;
      if (S.cat) this.cat.update(dt, pt);
      st.catPurr = !!S.cat && this.cat.purring;
    }
  }

  LOFI.Girl = Girl;
  LOFI.Cat = Cat;
  LOFI.Characters = Characters;
})();
