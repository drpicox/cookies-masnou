/* Habitació amb vistes — l'habitació: parets, finestra, escriptori, objectes, plantes i llums */
(function () {
  'use strict';
  const { clamp, lerp, smooth, damp, RNG, U, DEG, M, Geo, toonMat, patchToon, GLSL } = LOFI;

  // Disposició de l'escena (metres). La paret de la finestra és z = 0 i mira cap a +z.
  const L = (LOFI.LAYOUT = {
    room: { x0: -2.8, x1: 2.8, y1: 2.75, z1: 6 },
    win: { x0: -1.75, x1: 1.45, y0: 0.86, y1: 2.42, zGlass: -0.1, mull: [-0.68, 0.38], transom: 2.03 },
    desk: { x0: -1.3, x1: 1.45, z0: 0.03, z1: 0.72, y: 0.74 },
    chair: { x: 0.77, z: 0.8, yaw: 46 * DEG },
    laptop: { x: 0.53, z: 0.47, yaw: 46 * DEG },
    lamp: { x: 0.02, z: 0.31 },
    mug: { x: 0.4, z: 0.655 },
    notebook: { x: 0.91, z: 0.5 },
    cat: { x: -0.6, z: 0.055 },
    cam: { pos: [-0.14, 1.5, 3.3], target: [0.2, 1.3, 0.0], fov: 40 },
  });

  const C = {
    wall: '#e2bba8', wallLow: '#d9ae9b', base: '#f3ece2', floor: '#a9714d', ceil: '#efe3d6',
    frame: '#f4eee4', frameShade: '#e2d8ca', sill: '#f1e9de', desk: '#c48d5e', deskDark: '#9a6842',
    chair: '#8f6244', cushion: '#eba7a2', blanket: '#eaa79c',
    laptop: '#aba5bf', keys: '#3b3949', bezel: '#2a2836',
    lamp: '#8fd3bf', lampDark: '#6fb8a4', metal: '#b8b4c2',
    mug: '#f5f0e7', mugStripe: '#e7837f', coffee: '#5a3a2a',
    pot1: '#c96f4f', pot2: '#efe6d6', pot3: '#eea7a8', pot4: '#9fd6c2',
    leaf1: '#4f9a5c', leaf2: '#3d7d4c', leaf3: '#6cb56b', leaf4: '#86c77a',
  };
  const BOOKS = ['#e59a8e', '#8fb3d9', '#f0d086', '#9cc59a', '#c7a2d9', '#f2efe8', '#6f86b8', '#d98f6f', '#e7b7c8', '#7fbfb3'];

  // ---------------------------------------------------------------------------
  // Vidre: mostra l'exterior (renderitzat a part) amb gotes, regalims i reflexos
  // ---------------------------------------------------------------------------
  const GLASS_VERT = /* glsl */`
    varying vec3 vW;
    varying vec2 vUv;
    void main(){
      vUv = uv;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const GLASS_FRAG = /* glsl */`
    uniform sampler2D tOutside;
    uniform vec2 uRes;
    uniform float uTime, uWet, uRain, uRefl, uFogGlass;
    uniform vec3 uLampRef; uniform vec3 uLampCol;
    uniform vec3 uScreenRef;
    uniform vec2 uFairy[16];
    uniform float uFairyI;
    uniform vec3 uTint;
    varying vec3 vW;
    varying vec2 vUv;
    ${GLSL.bayer}
    ${GLSL.noise}
    void main(){
      vec2 px = floor(gl_FragCoord.xy);
      float bay = bayer4(px);
      vec2 off = vec2(0.0);
      float hi = 0.0, sh = 0.0;

      // làmina d'aigua quan plou fort
      float sheet = smoothstep(0.45, 1.0, uRain);
      off.x += (vnoise(vec2(px.y * 0.21 + uTime * 1.3, px.x * 0.06)) - 0.5) * 2.4 * sheet;

      // gotes quietes
      if (uWet > 0.01) {
        vec2 cell = floor(px / 3.0);
        vec2 lc = px - cell * 3.0;
        float h = h12(cell);
        float life = fract(uTime * (0.015 + 0.03 * h12(cell + 1.7)) + h * 3.0);
        float alive = step(1.0 - uWet * 0.2, h12(cell + 5.3)) * step(life, 0.92) * step(0.04, life);
        vec2 dp = floor(vec2(h12(cell + 2.2), h12(cell + 8.8)) * 2.0);
        float big = step(0.8, h12(cell + 4.4));
        vec2 q = lc - dp;
        float on = step(abs(q.x - 0.25 * big), 0.5 + 0.5 * big) * step(abs(q.y - 0.25 * big), 0.5 + 0.5 * big);
        if (alive > 0.5) {
          if (on > 0.5 && q.x >= 0.0 && q.y >= 0.0) { off += vec2(0.0, 3.0 + 2.0 * big); hi = 0.1 + 0.18 * step(0.5, q.y) * step(q.x, 0.5) * big + 0.06; }
          else if (q.y == -1.0 && q.x >= 0.0 && q.x <= big) sh = 0.12;
        }
      }
      // regalims (gotes que llisquen deixant un rastre)
      if (uRain > 0.02) {
        float colW = 9.0;
        float ci = floor(px.x / colW);
        float hc = h12(vec2(ci, 3.7));
        if (hc < uRain * 0.85) {
          float x0 = ci * colW + floor(h12(vec2(ci, 9.1)) * (colW - 2.0));
          float spd = 0.05 + 0.09 * h12(vec2(ci, 1.3));
          float s = uTime * spd + hc * 7.0;
          float ph = fract(s);
          // lliscament a batzegades però sempre cap avall: la posició és monòtona (derivada >= 0)
          float nStops = 3.0 + floor(h12(vec2(ci, 5.9)) * 3.0);
          float yN = 1.0 - (ph - sin(6.2831853 * nStops * ph) / (6.2831853 * nStops));
          float y0 = floor(yN * uRes.y * 1.1);
          float dx = px.x - x0;
          float dy = px.y - y0;
          if (dx >= 0.0 && dx <= 1.0 && dy >= 0.0 && dy <= 1.0) { off += vec2(0.0, 4.0); hi = 0.2 + 0.2 * step(0.5, dy) * step(dx, 0.5); }
          else if (dx >= 0.0 && dx <= 1.0 && dy == -1.0) sh = 0.18;
          else if (dx >= 0.0 && dx <= 0.0 && dy > 1.0 && dy < 26.0 + 20.0 * hc) {
            off.x += 1.0;
            float drip = step(0.82, h12(vec2(ci, floor(px.y))));
            hi += drip * 0.12;
          }
        }
      }

      vec2 suv = (gl_FragCoord.xy + off) / uRes;
      vec3 col = texture2D(tOutside, suv).rgb;
      col *= uTint;
      col = mix(col, vec3(1.0), hi);
      col *= 1.0 - sh;

      // entelat a la part de baix quan plou
      float fogB = uFogGlass * (1.0 - smoothstep(0.0, 0.22, vUv.y)) * (0.7 + 0.3 * vnoise(px * 0.15));
      fogB = floor(fogB * 5.0 + bay) / 5.0;
      col = mix(col, vec3(0.78, 0.8, 0.86) * (0.35 + 0.65 * max(col.r, max(col.g, col.b))), fogB * 0.5);

      // reflexos de l'interior (de nit)
      if (uRefl > 0.01) {
        float d = length(gl_FragCoord.xy - uLampRef.xy) / uLampRef.z;
        float g = exp(-d * d * 2.0) * 0.55 + exp(-d * 2.5) * 0.25;
        g = floor(g * 6.0 + bay) / 6.0;
        col += uLampCol * g * uRefl;
        float ds = length((gl_FragCoord.xy - uScreenRef.xy) * vec2(1.0, 1.4)) / uScreenRef.z;
        float gs = exp(-ds * ds * 3.0) * 0.35;
        gs = floor(gs * 5.0 + bay) / 5.0;
        col += vec3(0.5, 0.65, 0.95) * gs * uRefl;
        for (int i = 0; i < 16; i++) {
          vec2 fp = uFairy[i];
          vec2 dd = abs(gl_FragCoord.xy - fp);
          if (dd.x < 0.6 && dd.y < 0.6) col += vec3(1.0, 0.8, 0.45) * 0.45 * uFairyI * uRefl;
        }
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // Material translúcid amb tramat (cortines de gasa)
  function sheerMat(opacity) {
    return toonMat({ vertexColors: true, side: THREE.DoubleSide, key: 'sheer', transparent: true, opacity, depthWrite: false });
  }

  // Material de fullatge amb balanceig suau (atribut aSway)
  function foliageMat(key = 'fol') {
    return toonMat({
      vertexColors: true, side: THREE.DoubleSide, key,
      vertexHead: 'attribute float aSway;\nuniform float uLofiTime;',
      vertexTransform: `
        float sw = aSway;
        if (sw > 0.0) {
          float t = uLofiTime;
          transformed.x += sin(t * 0.9 + position.y * 2.3 + position.z * 1.7) * sw * 0.018;
          transformed.z += sin(t * 0.7 + position.x * 2.1) * sw * 0.012;
        }`,
      uniforms: { uLofiTime: U.uTime },
    });
  }

  // Geometries bàsiques
  const leafShape = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.45, 0.15, 0.5, 0.65, 0, 1);
    s.bezierCurveTo(-0.5, 0.65, -0.45, 0.15, 0, 0);
    return s;
  })();
  const heartShape = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.55, 0.25, 0.6, 0.85, 0.12, 0.9);
    s.bezierCurveTo(0.05, 0.9, 0.0, 0.82, 0, 0.78);
    s.bezierCurveTo(0.0, 0.82, -0.05, 0.9, -0.12, 0.9);
    s.bezierCurveTo(-0.6, 0.85, -0.55, 0.25, 0, 0);
    return s;
  })();
  const monsteraShape = (() => {
    // fulla gran amb osques laterals
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    const R = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      R.push(a);
    }
    s.bezierCurveTo(0.35, 0.05, 0.62, 0.3, 0.6, 0.55);
    s.lineTo(0.38, 0.5);
    s.lineTo(0.56, 0.68);
    s.bezierCurveTo(0.5, 0.85, 0.35, 0.95, 0.2, 1.0);
    s.lineTo(0.16, 0.8);
    s.lineTo(0.08, 1.02);
    s.bezierCurveTo(0.02, 1.03, -0.02, 1.03, -0.06, 1.02);
    s.lineTo(-0.14, 0.82);
    s.lineTo(-0.2, 1.0);
    s.bezierCurveTo(-0.38, 0.95, -0.52, 0.84, -0.57, 0.68);
    s.lineTo(-0.38, 0.52);
    s.lineTo(-0.6, 0.54);
    s.bezierCurveTo(-0.62, 0.3, -0.35, 0.05, 0, 0);
    return s;
  })();

  function bendLeaf(geo, curl = 0.25, fold = 0.2) {
    // corba la fulla (y) i la plega pel nervi (x)
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, p.getZ(i) + curl * y * y - fold * Math.abs(x));
    }
    geo.computeVertexNormals();
    return geo;
  }

  const _up5 = new THREE.Vector3(0, 0.05, 0);

  // ---------------------------------------------------------------------------
  // Flexo articulat: base giratòria, dos braços i capçal. Molles poc esmorteïdes
  // perquè els moviments tinguin una mica de rebot (juganer), i límits perquè
  // mai no toqui el vidre, l'ampit ni res de l'escriptori.
  // ---------------------------------------------------------------------------
  class DeskLamp {
    constructor(room, base) {
      this.room = room;
      this.base = base.clone();
      const mat = room.mat;
      const col = (g, c) => new Geo().add(g, c, M()).mesh(mat);
      const root = (this.root = new THREE.Group());
      root.position.copy(base);
      room.scene.add(root);
      root.add(col(new THREE.CylinderGeometry(0.075, 0.085, 0.022, 16).translate(0, 0.011, 0), C.lamp));
      root.add(col(new THREE.CylinderGeometry(0.02, 0.022, 0.02, 8).translate(0, 0.03, 0), C.lampDark));
      this.L1 = 0.327; this.L2 = 0.249;
      const turn = (this.turn = new THREE.Group());
      turn.position.set(0, 0.035, 0);
      root.add(turn);
      const arm1 = (this.arm1 = new THREE.Group());
      turn.add(arm1);
      arm1.add(col(new THREE.CylinderGeometry(0.011, 0.011, this.L1, 6).translate(0, this.L1 / 2, 0), C.lamp));
      arm1.add(col(new THREE.SphereGeometry(0.016, 8, 6), C.lampDark));
      const arm2 = (this.arm2 = new THREE.Group());
      arm2.position.set(0, this.L1, 0);
      arm1.add(arm2);
      arm2.add(col(new THREE.SphereGeometry(0.019, 8, 6), C.lampDark));
      arm2.add(col(new THREE.CylinderGeometry(0.011, 0.011, this.L2, 6).translate(0, this.L2 / 2, 0), C.lamp));
      // una molla decorativa al llarg del braç de baix
      arm1.add(col(new THREE.CylinderGeometry(0.006, 0.006, this.L1 * 0.7, 5).translate(0.018, this.L1 * 0.45, 0), C.metal));
      const head = (this.head = new THREE.Group());
      head.position.set(0, this.L2, 0);
      arm2.add(head);
      const tilt = (this.tiltG = new THREE.Group());
      head.add(tilt);
      tilt.add(col(new THREE.SphereGeometry(0.017, 8, 6), C.lampDark));
      const shadePts = [new THREE.Vector2(0.012, 0), new THREE.Vector2(0.03, 0.01), new THREE.Vector2(0.05, 0.05), new THREE.Vector2(0.075, 0.1), new THREE.Vector2(0.078, 0.104)];
      tilt.add(col(new THREE.LatheGeometry(shadePts, 16).translate(0, 0.012, 0), C.lamp));
      room.lampInnerMat = new THREE.MeshBasicMaterial({ color: '#fff0c8', side: THREE.BackSide });
      const inner = new THREE.Mesh(new THREE.LatheGeometry(shadePts.map((p) => new THREE.Vector2(p.x * 0.96, p.y + 0.014)), 16), room.lampInnerMat);
      tilt.add(inner);
      room.bulbMat = new THREE.MeshBasicMaterial({ color: '#fff6dc' });
      const bulb = (this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), room.bulbMat));
      bulb.position.set(0, 0.067, 0);
      tilt.add(bulb);
      root.traverse((o) => { if (o.isMesh) { o.castShadow = o !== bulb && o !== inner; o.receiveShadow = true; } });

      // postura de repòs: il·lumina el teclat i la llibreta
      this.restAim = new THREE.Vector3(0.5, 0.745, 0.58);
      this.q = { yaw: 0, a1: 0.08, a2: 1.33, a3: 2.75, tilt: 0 };
      this.v = { yaw: 0, a1: 0, a2: 0, a3: 0, tilt: 0 };
      this.goal = { a1: 0.08, a2: 1.33, tilt: 0 };
      this.aim = this.restAim.clone();
      this.k = 26; this.c = 7.2;   // suau, amb un rebot molt lleu
      this.nod = 0;
      this.solveAim(this.aim, this.q);
      this.bulbWorld = new THREE.Vector3();
      this.dirWorld = new THREE.Vector3(0, -1, 0);
      this.apply();
    }

    // punt del capçal en coordenades del pla del braç (abast, alçada)
    headPlane(a1, a2) { return [this.L1 * Math.sin(a1) + this.L2 * Math.sin(a2), 0.035 + this.L1 * Math.cos(a1) + this.L2 * Math.cos(a2)]; }

    // calcula el gir de la base i l'angle del capçal per apuntar a un punt
    solveAim(P, out) {
      const dx = P.x - this.base.x, dz = P.z - this.base.z;
      out.yaw = Math.atan2(-dz, dx);
      const [hr, hy] = this.headPlane(out.a1, out.a2);
      const pr = Math.hypot(dx, dz), py = P.y - this.base.y;
      out.a3 = Math.atan2(pr - hr, py - hy);
      if (out.a3 < 0) out.a3 += Math.PI * 2;
      return out;
    }

    // mira alguna cosa: postura (a1 = inclinació del braç de baix, a2 = del de dalt) i un toc de cap
    look(P, pose = {}) {
      this.aim.copy(P);
      this.goal.a1 = pose.a1 !== undefined ? pose.a1 : 0.08;
      this.goal.a2 = pose.a2 !== undefined ? pose.a2 : 1.33;
      this.goal.tilt = pose.tilt || 0;
    }
    rest() { this.look(this.restAim, {}); }

    // límits de seguretat: el capçal no s'acosta al vidre ni baixa massa
    safe(t) {
      t.a1 = clamp(t.a1, -0.25, 0.5);
      t.a2 = clamp(t.a2, 0.25, 1.62);
      for (let i = 0; i < 8; i++) {
        const [hr, hy] = this.headPlane(t.a1, t.a2);
        const hz = this.base.z - Math.sin(t.yaw) * hr;
        const hx = this.base.x + Math.cos(t.yaw) * hr;
        const tooLow = this.base.y + hy < 1.06;
        const tooNearWindow = hz < 0.1;
        const tooNearGirl = Math.hypot(hx - 0.7, hz - 0.72) < 0.3;
        if (!tooLow && !tooNearWindow && !tooNearGirl) break;
        t.a1 *= 0.7; t.a2 = t.a2 * 0.8 + 0.6 * 0.2;
      }
      return t;
    }

    update(dt) {
      const tgt = { a1: this.goal.a1, a2: this.goal.a2, tilt: this.goal.tilt, yaw: 0, a3: 0 };
      this.solveAim(this.aim, tgt);
      this.safe(tgt);
      this.solveAim(this.aim, tgt);
      tgt.a3 = clamp(tgt.a3, 0.9, 3.35) + this.nod;
      // gir per la via curta
      let dy = tgt.yaw - this.q.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      tgt.yaw = this.q.yaw + dy;
      const h = Math.min(dt, 1 / 30);
      for (const k of ['yaw', 'a1', 'a2', 'a3', 'tilt']) {
        const acc = this.k * (tgt[k] - this.q[k]) - this.c * this.v[k];
        this.v[k] += acc * h;
        this.q[k] += this.v[k] * h;
      }
      this.apply();
    }

    apply() {
      const q = this.q;
      this.turn.rotation.y = q.yaw;
      this.arm1.rotation.z = -q.a1;
      this.arm2.rotation.z = -(q.a2 - q.a1);
      this.head.rotation.z = -(q.a3 - q.a2);
      this.tiltG.rotation.y = q.tilt;
      this.root.updateMatrixWorld(true);
      this.bulb.getWorldPosition(this.bulbWorld);
      this.dirWorld.set(0, 1, 0).transformDirection(this.tiltG.matrixWorld);
    }
  }
  LOFI.DeskLamp = DeskLamp;

  class Room {
    constructor(seed = 3) {
      this.rng = new RNG(seed);
      this.scene = new THREE.Scene();
      this.mat = toonMat({ vertexColors: true });
      this.fol = foliageMat();
      this.cam = new THREE.PerspectiveCamera(L.cam.fov, 16 / 9, 0.05, 60);
      this.cam.position.fromArray(L.cam.pos);
      this.cam.lookAt(new THREE.Vector3().fromArray(L.cam.target));
      this.cam.layers.enable(1);
      this.baseFov = L.cam.fov;
      this.G = new Geo();          // estàtic (projecta i rep ombres)
      this.F = new Geo();          // fullatge estàtic
      this.sway = [];              // fullatge que es balanceja
      this.buildShell();
      this.buildWindow();
      this.buildDesk();
      this.buildDecor();
      this.buildPlants();
      this.finishStatic();
      this.buildLights();
      this.lampOn = 0; this.lampTarget = 0;
      this.fairyOn = 0;
      this.t = 0;
    }

    // ---------------- parets, terra, sostre ----------------
    buildShell() {
      const G = this.G, R = L.room, W = L.win;
      const wallCol = (v, n, out) => {
        // una mica més fosc a baix i a prop dels racons
        const k = 0.94 + 0.06 * smooth(v.y / 1.4);
        return out.set(C.wall).multiplyScalar(k);
      };
      const T = 0.28;
      // paret del fons amb el forat de la finestra
      G.box(W.x0 - R.x0, R.y1, T, wallCol, M((R.x0 + W.x0) / 2, R.y1 / 2, -T / 2), 3);
      G.box(R.x1 - W.x1, R.y1, T, wallCol, M((R.x1 + W.x1) / 2, R.y1 / 2, -T / 2), 3);
      G.box(W.x1 - W.x0, W.y0, T, wallCol, M((W.x0 + W.x1) / 2, W.y0 / 2, -T / 2), 3);
      G.box(W.x1 - W.x0, R.y1 - W.y1, T, wallCol, M((W.x0 + W.x1) / 2, (R.y1 + W.y1) / 2, -T / 2), 3);
      // parets laterals, terra i sostre
      G.box(0.2, R.y1, R.z1, wallCol, M(R.x0 - 0.1, R.y1 / 2, R.z1 / 2), 3);
      G.box(0.2, R.y1, R.z1, wallCol, M(R.x1 + 0.1, R.y1 / 2, R.z1 / 2), 3);
      G.box(R.x1 - R.x0, 0.1, R.z1, C.floor, M(0, -0.05, R.z1 / 2), 2);
      G.box(R.x1 - R.x0, 0.1, R.z1, C.ceil, M(0, R.y1 + 0.05, R.z1 / 2), 3);
      // sòcols
      G.box(R.x1 - R.x0, 0.09, 0.018, C.base, M(0, 0.045, 0.009));
      G.box(0.018, 0.09, R.z1, C.base, M(R.x0 + 0.009, 0.045, R.z1 / 2));
      G.box(0.018, 0.09, R.z1, C.base, M(R.x1 - 0.009, 0.045, R.z1 / 2));
      // motllura del sostre
      G.box(R.x1 - R.x0, 0.05, 0.03, C.base, M(0, R.y1 - 0.025, 0.015));
      // catifa sota la cadira
      G.box(2.2, 0.012, 1.5, '#c98a78', M(0.6, 0.006, 1.5), 6);
    }

    // ---------------- finestra ----------------
    buildWindow() {
      const G = this.G, W = L.win;
      const fw = 0.065;
      const cx = (W.x0 + W.x1) / 2, cy = (W.y0 + W.y1) / 2, w = W.x1 - W.x0, h = W.y1 - W.y0;
      // folre de fusta (marc interior) a la paret
      G.box(w + 2 * fw, fw, 0.03, C.frame, M(cx, W.y1 + fw / 2, 0.015));
      G.box(fw, h + fw, 0.03, C.frame, M(W.x0 - fw / 2, cy + fw / 2, 0.015));
      G.box(fw, h + fw, 0.03, C.frame, M(W.x1 + fw / 2, cy + fw / 2, 0.015));
      // bastiment al pla del vidre
      const z = W.zGlass, d = 0.07;
      const fc = C.frame;
      G.box(w, 0.055, d, fc, M(cx, W.y1 - 0.0275, z));
      G.box(w, 0.045, d, fc, M(cx, W.y0 + 0.0225, z));
      G.box(0.055, h, d, fc, M(W.x0 + 0.0275, cy, z));
      G.box(0.055, h, d, fc, M(W.x1 - 0.0275, cy, z));
      for (const mx of W.mull) {
        G.box(0.06, h, d + 0.01, fc, M(mx, cy, z));
        // maneta daurada
        G.box(0.018, 0.1, 0.02, '#d9b26a', M(mx + 0.045, W.y0 + 0.62, z + 0.05));
        G.box(0.03, 0.02, 0.03, '#d9b26a', M(mx + 0.045, W.y0 + 0.67, z + 0.03));
      }
      G.box(w, 0.045, d, fc, M(cx, W.transom, z));
      // ampit interior (on dorm el gat)
      G.box(w + 0.2, 0.035, 0.29, C.sill, M(cx, W.y0 - 0.0175, 0.075));
      G.box(w + 0.2, 0.03, 0.015, C.frameShade, M(cx, W.y0 - 0.05, 0.2175));
      // barra de la cortina
      G.add(new THREE.CylinderGeometry(0.012, 0.012, w + 0.9, 8), '#b88a5a', M(cx - 0.05, W.y1 + 0.16, 0.08, 0, 0, Math.PI / 2));
      G.add(new THREE.SphereGeometry(0.025, 8, 6), '#b88a5a', M(cx - 0.05 - (w + 0.9) / 2, W.y1 + 0.16, 0.08));
      G.add(new THREE.SphereGeometry(0.025, 8, 6), '#b88a5a', M(cx - 0.05 + (w + 0.9) / 2, W.y1 + 0.16, 0.08));
      G.box(0.02, 0.1, 0.06, '#b88a5a', M(cx - 0.05 - (w + 0.6) / 2, W.y1 + 0.13, 0.04));
      G.box(0.02, 0.1, 0.06, '#b88a5a', M(cx - 0.05 + (w + 0.6) / 2, W.y1 + 0.13, 0.04));

      // vidre
      this.glassU = {
        tOutside: { value: null }, uRes: U.uRes, uTime: U.uTime, uWet: { value: 0 }, uRain: { value: 0 }, uRefl: { value: 0 },
        uFogGlass: { value: 0 }, uLampRef: { value: new THREE.Vector3(-999, -999, 10) }, uLampCol: { value: new THREE.Color('#ffc880') },
        uScreenRef: { value: new THREE.Vector3(-999, -999, 8) }, uFairy: { value: Array.from({ length: 16 }, () => new THREE.Vector2(-99, -99)) },
        uFairyI: { value: 0 }, uTint: { value: new THREE.Vector3(0.97, 0.985, 1.0) },
      };
      const gm = new THREE.ShaderMaterial({ uniforms: this.glassU, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), gm);
      glass.position.set(cx, cy, z);
      glass.castShadow = false; glass.receiveShadow = false;
      this.glass = glass;
      this.scene.add(glass);

      // cortina de gasa a l'esquerra (plecs)
      const cur = new Geo();
      const cw = 0.55, ch = W.y1 + 0.14 - 0.92, segs = 22;
      const cg = new THREE.PlaneGeometry(cw, ch, segs, 8);
      const cp = cg.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i), y = cp.getY(i);
        const gather = 1 - 0.35 * smooth((y + ch / 2) / ch);
        cp.setX(i, x * gather);
        cp.setZ(i, Math.sin((x / cw) * Math.PI * 9) * 0.035 + 0.02 * Math.sin(y * 3));
      }
      cg.computeVertexNormals();
      cur.add(cg, '#fbf5ec', M(W.x0 - 0.18, 0.92 + ch / 2, 0.1), 0);
      this.curtainMat = sheerMat(0.62);
      const curtain = cur.mesh(this.curtainMat, { cast: false, receive: true });
      curtain.layers.set(1);
      this.scene.add(curtain);
      // cortina recollida a la dreta (més opaca, estreta)
      const cur2 = new Geo();
      const cg2 = new THREE.PlaneGeometry(0.3, ch, 12, 6);
      const cp2 = cg2.attributes.position;
      for (let i = 0; i < cp2.count; i++) {
        const x = cp2.getX(i), y = cp2.getY(i);
        const tie = Math.exp(-Math.pow((y + ch / 2 - 0.55) / 0.25, 2));
        cp2.setX(i, x * (1 - 0.55 * tie));
        cp2.setZ(i, Math.sin((x / 0.3) * Math.PI * 5) * 0.03);
      }
      cg2.computeVertexNormals();
      cur2.add(cg2, '#fbf5ec', M(W.x1 + 0.2, 0.92 + ch / 2, 0.1), 0);
      const curtain2 = cur2.mesh(sheerMat(0.8), { cast: false, receive: true });
      curtain2.layers.set(1);
      this.scene.add(curtain2);
    }

    // ---------------- escriptori, cadira i objectes ----------------
    buildDesk() {
      const G = this.G, D = L.desk, rng = this.rng;
      const dw = D.x1 - D.x0, dd = D.z1 - D.z0, cx = (D.x0 + D.x1) / 2, cz = (D.z0 + D.z1) / 2;
      G.box(dw, 0.04, dd, C.desk, M(cx, D.y - 0.02, cz), 1);
      for (const [x, z] of [[D.x0 + 0.05, D.z0 + 0.05], [D.x1 - 0.05, D.z0 + 0.05], [D.x0 + 0.05, D.z1 - 0.05], [D.x1 - 0.05, D.z1 - 0.05]]) {
        G.box(0.045, D.y - 0.04, 0.045, C.deskDark, M(x, (D.y - 0.04) / 2, z), 1);
      }
      // calaixera a l'esquerra
      G.box(0.42, 0.62, 0.62, '#d4a178', M(D.x0 + 0.26, 0.31, cz), 1);
      for (let i = 0; i < 3; i++) {
        G.box(0.38, 0.17, 0.012, '#dcae86', M(D.x0 + 0.26, 0.1 + i * 0.2, D.z1 - 0.005), 1);
        G.box(0.08, 0.015, 0.02, '#8a6a4a', M(D.x0 + 0.26, 0.14 + i * 0.2, D.z1 + 0.006));
      }

      // cadira
      const ch = L.chair;
      const seatY = 0.46;
      const CH = new Geo();
      CH.box(0.44, 0.035, 0.42, C.chair, M(0, seatY, 0), 1);
      CH.add(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 14), C.cushion, M(0, seatY + 0.0525, -0.01, 0, 0, 0, 1, 1, 0.95), 4);
      for (const [dx, dz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
        CH.box(0.035, seatY, 0.035, C.chair, M(dx, seatY / 2, dz, dz > 0 ? 0.05 : -0.03, 0, 0), 1);
      }
      // respatller baix i corbat
      for (const dx of [-0.18, 0.18]) CH.box(0.035, 0.36, 0.035, C.chair, M(dx, seatY + 0.18, 0.2, 0.08, 0, 0), 1);
      CH.add(new THREE.TorusGeometry(0.24, 0.028, 5, 16, Math.PI * 0.62), C.chair, M(0, seatY + 0.33, 0.05, Math.PI / 2 + 0.1, 0, Math.PI * 0.19, 1, 1, 1.4), 1);
      // manta de llana doblegada sobre el travesser corbat del respatller (sense travessar-lo):
      // el travesser és un arc de radi 0.212–0.268 al voltant de (0, z 0.05) i d'alçada 0.727–0.805
      const arcC = 0.05, railTop = seatY + 0.345;
      const thS = -0.46, thL = 0.92;
      const back = new THREE.CylinderGeometry(0.292, 0.3, 0.27, 12, 4, true, thS, thL);   // cau per darrere
      const bpp = back.attributes.position;
      for (let i = 0; i < bpp.count; i++) {   // plecs suaus de la llana
        const x = bpp.getX(i), y = bpp.getY(i), z = bpp.getZ(i);
        const k = 1 + 0.03 * Math.sin(Math.atan2(x, z) * 22) * (0.5 - y / 0.27);
        bpp.setX(i, x * k); bpp.setZ(i, z * k);
      }
      back.computeVertexNormals();
      CH.add(back, C.blanket, M(0, railTop + 0.012 - 0.135, arcC), 4);
      const top = new THREE.RingGeometry(0.19, 0.3, 12, 1, thS - Math.PI / 2, thL);   // el plec per sobre (angles com el cilindre)
      top.rotateX(-Math.PI / 2);
      CH.add(top, C.blanket, M(0, railTop + 0.012, arcC), 4);
      const flap = new THREE.CylinderGeometry(0.19, 0.19, 0.07, 12, 1, true, thS, thL);   // la solapa de davant
      CH.add(flap, C.blanket, M(0, railTop + 0.012 - 0.035, arcC), 4);
      G.merge(CH, M(ch.x, 0, ch.z, 0, ch.yaw || 0, 0));

      // portàtil
      const lp = L.laptop;
      const lg = new THREE.Group();
      lg.position.set(lp.x, D.y, lp.z);
      lg.rotation.y = lp.yaw;
      this.scene.add(lg);
      const LG = new Geo();
      LG.box(0.33, 0.016, 0.23, C.laptop, M(0, 0.008, 0));
      LG.box(0.29, 0.003, 0.11, C.keys, M(0, 0.0165, -0.025));
      LG.box(0.1, 0.002, 0.06, '#bdb8ca', M(0, 0.0165, 0.07));
      // tapa
      const lid = new THREE.Group();
      lid.position.set(0, 0.016, -0.115);
      lid.rotation.x = -0.28;
      lg.add(lid);
      const TG = new Geo();
      TG.box(0.33, 0.215, 0.008, C.laptop, M(0, 0.1075, -0.004));
      TG.box(0.315, 0.2, 0.002, C.bezel, M(0, 0.108, 0.001));
      // adhesius a la part de darrere
      TG.add(new THREE.CircleGeometry(0.022, 10), '#f5a8b8', M(0.07, 0.13, -0.0085, 0, Math.PI, 0));
      TG.box(0.04, 0.03, 0.001, '#9fd6c2', M(-0.06, 0.09, -0.0085, 0, 0, 0.2));
      const lidMesh = TG.mesh(this.mat);
      lid.add(lidMesh);
      lg.add(LG.mesh(this.mat));
      // pantalla (textura de canvas animada)
      this.screen = new LOFI.ScreenTex(64, 40);
      const sm = new THREE.MeshBasicMaterial({ map: this.screen.tex });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.295, 0.184), sm);
      scr.position.set(0, 0.108, 0.0025);
      lid.add(scr);
      this.laptop = lg; this.lid = lid;
      this.screenWorld = new THREE.Vector3();
      scr.updateMatrixWorld(true);

      // flexo articulat (es mou de tant en tant, com si tingués vida pròpia)
      this.desklamp = new DeskLamp(this, new THREE.Vector3(L.lamp.x, D.y, L.lamp.z));
      this.lampHead = this.desklamp.bulbWorld.clone();
      this.lampDir = this.desklamp.dirWorld.clone();

      // tassa de cafè (objecte propi: la noia l'agafa per beure) amb vapor
      const mg = L.mug;
      const MG = new Geo();
      const mugPts = [new THREE.Vector2(0.0, 0), new THREE.Vector2(0.036, 0), new THREE.Vector2(0.04, 0.005), new THREE.Vector2(0.041, 0.085), new THREE.Vector2(0.037, 0.087), new THREE.Vector2(0.035, 0.012)];
      MG.add(new THREE.LatheGeometry(mugPts, 16), (v, n, out) => out.set(v.y > 0.05 && v.y < 0.065 ? C.mugStripe : C.mug), M());
      MG.add(new THREE.CylinderGeometry(0.034, 0.034, 0.004, 14), C.coffee, M(0, 0.07, 0));
      MG.add(new THREE.TorusGeometry(0.022, 0.007, 6, 10), C.mug, M(-0.045, 0.045, 0, 0, 0.3, 0));
      this.mug = MG.mesh(this.mat);
      this.mug.position.set(mg.x, D.y + 0.006, mg.z);
      // la nansa (x local negativa) mira cap a la noia
      this.mug.rotation.y = Math.atan2(L.chair.z - mg.z, -(L.chair.x - mg.x));
      this.mugHandle = new THREE.Vector3(-0.056, 0.045, 0);
      this.scene.add(this.mug);
      G.add(new THREE.CylinderGeometry(0.055, 0.055, 0.006, 16), '#b98c64', M(mg.x, D.y + 0.003, mg.z), 7);
      {
        const N = 26, pos = new Float32Array(N * 3), sd = new Float32Array(N);
        for (let i = 0; i < N; i++) { pos.set([rng.range(-0.015, 0.015), 0.09, rng.range(-0.015, 0.015)], i * 3); sd[i] = rng.next(); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
        this.steamU = { uTime: U.uTime, uColor: { value: new THREE.Color('#fff8ee') }, uA: { value: 0.5 } };
        const sm = new THREE.ShaderMaterial({
          uniforms: this.steamU, transparent: true, depthWrite: false,
          vertexShader: `attribute float aSeed; uniform float uTime; varying float vA;
            void main(){
              float life = fract(uTime * (0.1 + 0.06 * aSeed) + aSeed * 7.0);
              vec3 p = position;
              p.y += life * 0.17;
              p.x += sin(uTime * 1.2 + aSeed * 12.0 + life * 4.0) * 0.016 * life;
              p.z += cos(uTime * 0.9 + aSeed * 9.0) * 0.01 * life;
              vA = (1.0 - life) * smoothstep(0.0, 0.2, life);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
              gl_PointSize = 1.0;
            }`,
          fragmentShader: `uniform vec3 uColor; uniform float uA; varying float vA;
            void main(){ if (vA * uA < 0.03) discard; gl_FragColor = vec4(uColor, vA * uA); }`,
        });
        this.steam = new THREE.Points(g, sm);
        this.steam.layers.set(1);
        this.steam.frustumCulled = false;
        // el vapor no penja de la tassa: puja sempre recte (se'l recol·loca a cada fotograma)
        this.scene.add(this.steam);
        this.mugHomeY = D.y + 0.006;
      }

      // llibreta oberta i llapis
      const nb = L.notebook;
      const NB = new Geo();
      NB.box(0.17, 0.008, 0.23, '#fdf8ef', M(-0.085, 0.004, 0, 0, 0, 0.02));
      NB.box(0.17, 0.008, 0.23, '#fbf5ea', M(0.085, 0.004, 0, 0, 0, -0.02));
      for (let i = 0; i < 9; i++) {
        NB.box(0.13, 0.001, 0.003, '#b8c6e0', M(-0.085, 0.0085, -0.09 + i * 0.022));
        NB.box(0.13, 0.001, 0.003, '#b8c6e0', M(0.085, 0.0085, -0.09 + i * 0.022));
      }
      NB.box(0.345, 0.004, 0.235, '#7fa7c9', M(0, 0.001, 0));
      this.notebook = NB.mesh(this.mat);
      this.notebook.position.set(nb.x, D.y, nb.z);
      this.notebook.rotation.y = 0.35;
      this.scene.add(this.notebook);
      this.pencil = new Geo().add(new THREE.CylinderGeometry(0.004, 0.004, 0.15, 6), (v, n, out) => out.set(v.y > 0.06 ? '#f29b9b' : v.y < -0.06 ? '#f2d6b0' : '#f3c64d'), M(0, 0, 0)).mesh(this.mat);
      this.scene.add(this.pencil);
      this.pencil.position.set(nb.x + 0.12, D.y + 0.01, nb.z + 0.05);
      this.pencil.rotation.set(Math.PI / 2, 0, 0.8);

      // pila de llibres i llibres drets
      let y = D.y;
      const stackX = -0.9, stackZ = 0.46;
      for (let i = 0; i < 4; i++) {
        const w = rng.range(0.2, 0.26), h = rng.range(0.025, 0.045), d = rng.range(0.15, 0.19);
        const colr = BOOKS[rng.int(0, BOOKS.length - 1)];
        const rot = rng.range(-0.25, 0.25);
        G.box(w, h, d, colr, M(stackX, y + h / 2, stackZ, 0, rot, 0));
        G.box(w - 0.01, h - 0.008, d + 0.002, '#f6efe2', M(stackX + 0.006, y + h / 2, stackZ, 0, rot, 0));
        y += h;
      }
      // test petit damunt la pila
      this.smallPlant(G, this.F, stackX, y, stackZ, 0.045, C.pot4, 'succulent');
      // fila de llibres drets entre sujetallibres
      let bx = -1.27;
      const bz = 0.33;   // davant de la vora de l'ampit (acaba a z = 0.22)
      G.box(0.02, 0.18, 0.12, '#e8d8c0', M(bx - 0.012, D.y + 0.09, bz));
      while (bx < -1.1) {
        const w = rng.range(0.025, 0.05), h = rng.range(0.18, 0.26), d = rng.range(0.13, 0.17);
        const tilt = bx > -1.15 ? -0.25 : 0;
        G.box(w, h, d, BOOKS[rng.int(0, BOOKS.length - 1)], M(bx + w / 2, D.y + h / 2 + (tilt ? 0.005 : 0), bz, 0, 0, tilt));
        if (rng.chance(0.5)) G.box(w + 0.001, 0.012, d + 0.001, '#f4e9d0', M(bx + w / 2, D.y + h * 0.8, bz, 0, 0, tilt));
        bx += w + 0.003;
      }
      // pot de llapis
      G.add(new THREE.CylinderGeometry(0.035, 0.03, 0.1, 12), '#9fb9dd', M(-0.52, D.y + 0.05, 0.37), 7);
      const pcs = ['#f3c64d', '#f29b9b', '#8fd0b8', '#b7a2e0'];
      for (let i = 0; i < 4; i++) G.add(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5), pcs[i], M(-0.52 + (i - 1.5) * 0.012, D.y + 0.12, 0.37 + (i % 2) * 0.01, (i - 1.5) * 0.08, 0, (i - 1.5) * 0.1));
      // altaveu petit / ràdio
      G.box(0.16, 0.1, 0.07, '#e9dccb', M(1.1, D.y + 0.05, 0.12, 0, -0.2, 0));
      G.add(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 14), '#6a5a52', M(1.08, D.y + 0.05, 0.157, Math.PI / 2, -0.2, 0));
      G.box(0.02, 0.02, 0.01, '#d9906a', M(1.15, D.y + 0.08, 0.15, 0, -0.2, 0));
      // espelma
      G.add(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12), '#f6e6d0', M(-1.3, L.win.y0 + 0.03, 0.08));
      this.candle = new THREE.Vector3(-1.3, L.win.y0 + 0.075, 0.08);
      // polaroids enganxades al vidre amb cinta
      this.candleFlameMat = new THREE.MeshBasicMaterial({ color: '#ffcf70' });
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), this.candleFlameMat);
      fl.scale.set(1, 1.8, 1); fl.position.copy(this.candle);
      this.flame = fl;
      this.scene.add(fl);
    }

    // ---------------- decoració de les parets ----------------
    buildDecor() {
      const G = this.G, rng = this.rng, R = L.room, W = L.win;
      // prestatges a la dreta de la finestra
      const sx0 = W.x1 + 0.35, sx1 = R.x1 - 0.25;
      const scx = (sx0 + sx1) / 2, sw = sx1 - sx0;
      for (const sy of [1.25, 1.72]) {
        G.box(sw, 0.03, 0.22, '#caa07a', M(scx, sy, 0.11), 1);
        G.box(0.02, 0.1, 0.02, '#8a7060', M(sx0 + 0.1, sy - 0.066, 0.05));
        G.box(0.02, 0.1, 0.02, '#8a7060', M(sx1 - 0.1, sy - 0.066, 0.05));
      }
      // llibres al prestatge de baix
      let bx = sx0 + 0.05;
      while (bx < scx + 0.05) {
        const w = rng.range(0.03, 0.055), h = rng.range(0.17, 0.25);
        G.box(w, h, 0.16, BOOKS[rng.int(0, BOOKS.length - 1)], M(bx + w / 2, 1.265 + h / 2, 0.11));
        bx += w + 0.004;
      }
      G.box(0.18, 0.13, 0.13, '#efe6d6', M(bx + 0.14, 1.265 + 0.065, 0.11));
      // tocadiscos/caset al prestatge de dalt
      G.box(0.26, 0.26, 0.02, '#2a2632', M(scx - 0.18, 1.735 + 0.13, 0.05, 0, 0, 0.0));
      G.add(new THREE.CircleGeometry(0.11, 18), '#1c1a22', M(scx - 0.18, 1.735 + 0.13, 0.061));
      G.add(new THREE.CircleGeometry(0.035, 12), '#f09a8a', M(scx - 0.18, 1.735 + 0.13, 0.062));
      G.box(0.2, 0.15, 0.015, '#f6d38a', M(scx + 0.05, 1.735 + 0.075, 0.13, 0.05, -0.2, 0));
      G.box(0.16, 0.11, 0.004, '#8fb3d9', M(scx + 0.05, 1.735 + 0.078, 0.139, 0.05, -0.2, 0));
      // rellotge de paret (mostra l'hora de l'escena)
      const ck = new THREE.Vector3(scx + 0.02, 2.2, 0.0);
      G.add(new THREE.CylinderGeometry(0.13, 0.13, 0.035, 20), '#f2e8da', M(ck.x, ck.y, ck.z + 0.0175, Math.PI / 2, 0, 0));
      G.add(new THREE.CylinderGeometry(0.113, 0.113, 0.004, 20), '#fffaf1', M(ck.x, ck.y, ck.z + 0.037, Math.PI / 2, 0, 0));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        G.box(0.008, i % 3 === 0 ? 0.022 : 0.012, 0.003, '#6a5a6a', M(ck.x + Math.sin(a) * 0.095, ck.y + Math.cos(a) * 0.095, ck.z + 0.039, 0, 0, -a));
      }
      const hm = new THREE.MeshBasicMaterial({ color: '#3a3040' });
      const mkHand = (len, wdt) => { const g = new THREE.BoxGeometry(wdt, len, 0.004); g.translate(0, len / 2 - 0.012, 0); return new THREE.Mesh(g, hm); };
      this.hHour = mkHand(0.06, 0.012); this.hMin = mkHand(0.09, 0.008);
      for (const hnd of [this.hHour, this.hMin]) { hnd.position.set(ck.x, ck.y, ck.z + 0.042); this.scene.add(hnd); }
      this.hMin.position.z += 0.003;

      // làmines emmarcades a l'esquerra de la finestra
      const frames = [
        { x: W.x0 - 0.62, y: 1.72, w: 0.42, h: 0.56, art: 'wave' },
        { x: W.x0 - 0.5, y: 1.2, w: 0.26, h: 0.32, art: 'leaf' },
      ];
      for (const f of frames) {
        G.box(f.w, f.h, 0.025, '#3f3548', M(f.x, f.y, 0.0125));
        const tex = LOFI.artTexture(f.art, 32, Math.round(32 * f.h / f.w));
        const pm = new THREE.MeshLambertMaterial({ map: tex });
        patchToon(pm, { key: 'art' });
        const p = new THREE.Mesh(new THREE.PlaneGeometry(f.w - 0.05, f.h - 0.05), pm);
        p.position.set(f.x, f.y, 0.027);
        p.receiveShadow = true;
        this.scene.add(p);
      }
      // guirnalda de fotos amb pinces
      const gy = 2.58;
      for (let i = 0; i < 4; i++) {
        const x = W.x0 - 0.95 + i * 0.2, sag = Math.sin((i + 0.5) / 4 * Math.PI) * 0.05;
        G.box(0.12, 0.14, 0.004, '#fbf7f0', M(x, gy - 0.1 - sag, 0.006, 0, 0, rng.range(-0.1, 0.1)));
        G.box(0.1, 0.09, 0.002, BOOKS[(i * 3) % BOOKS.length], M(x, gy - 0.09 - sag, 0.009, 0, 0, rng.range(-0.1, 0.1)));
      }

      // llumetes (guirnalda de llums al llarg de la finestra)
      this.fairy = [];
      const hooks = [W.x0 - 0.15, W.x0 + 0.65, (W.x0 + W.x1) / 2 + 0.2, W.x1 - 0.5, W.x1 + 0.15];
      const fy = W.y1 + 0.1, fz = 0.05;
      const wirePts = [];
      for (let k = 0; k < hooks.length - 1; k++) {
        const a = hooks[k], b = hooks[k + 1];
        const n = Math.max(4, Math.round((b - a) / 0.1));
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const x = lerp(a, b, t);
          const y = fy - Math.sin(t * Math.PI) * 0.13;
          wirePts.push(new THREE.Vector3(x, y, fz));
          if (i % 1 === 0 && i > 0) this.fairy.push(new THREE.Vector3(x, y - 0.018, fz + 0.005));
        }
      }
      wirePts.push(new THREE.Vector3(hooks[hooks.length - 1], fy, fz));
      const wire = new THREE.CatmullRomCurve3(wirePts);
      G.add(new THREE.TubeGeometry(wire, 160, 0.0035, 3, false), '#4a5a4a', M());
      this.fairyMat = new THREE.MeshBasicMaterial({ color: '#ffd98a' });
      this.fairyGeo = new THREE.SphereGeometry(0.015, 6, 5);
      this.fairyMesh = new THREE.InstancedMesh(this.fairyGeo, this.fairyMat, this.fairy.length);
      const im = new THREE.Matrix4();
      const tints = ['#ffd98a', '#ffc2a8', '#fff0c0', '#ffb8c8', '#c8e8ff'];
      this.fairyBase = [];
      for (let i = 0; i < this.fairy.length; i++) {
        im.makeTranslation(this.fairy[i].x, this.fairy[i].y, this.fairy[i].z);
        this.fairyMesh.setMatrixAt(i, im);
        const c = new THREE.Color(tints[i % tints.length]);
        this.fairyBase.push(c);
        this.fairyMesh.setColorAt(i, c);
      }
      this.fairyMesh.instanceColor.needsUpdate = true;
      this.fairyMesh.layers.set(1);
      this.scene.add(this.fairyMesh);
    }

    // ---------------- plantes ----------------
    leaf(G, shape, size, col, pos, dir, up, curl = 0.25, fold = 0.25, pat = 5) {
      const g = bendLeaf(new THREE.ShapeGeometry(shape, 4), curl, fold);
      // orientació: y de la fulla → dir, z → normal aproximada
      const zAxis = new THREE.Vector3().crossVectors(dir, up).cross(dir).normalize().negate();
      if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 0, 1);
      const xAxis = new THREE.Vector3().crossVectors(dir, zAxis).normalize();
      const m = new THREE.Matrix4().makeBasis(xAxis, dir.clone().normalize(), zAxis);
      m.scale(new THREE.Vector3(size, size, size));
      m.setPosition(pos);
      G.add(g, col, m, pat);
    }

    smallPlant(G, F, x, y, z, r, potCol, kind) {
      const rng = this.rng;
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r * 0.8, 0), new THREE.Vector2(r, r * 1.5), new THREE.Vector2(r * 1.08, r * 1.55), new THREE.Vector2(r * 1.08, r * 1.7), new THREE.Vector2(r * 0.9, r * 1.7)];
      G.add(new THREE.LatheGeometry(pts, 12), potCol, M(x, y, z), 7);
      G.add(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.004, 10), '#5a3c2c', M(x, y + r * 1.6, z));
      const top = y + r * 1.6;
      if (kind === 'succulent') {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
          const out = i < 6 ? 0.9 : 0.35;
          const dir = new THREE.Vector3(Math.cos(a) * out, 0.9, Math.sin(a) * out).normalize();
          this.leaf(F, leafShape, r * (i < 6 ? 1.1 : 0.8), i % 2 ? '#8fc9a0' : '#a8d8b0', new THREE.Vector3(x, top, z), dir, new THREE.Vector3(0, 1, 0), 0.4, 0.3);
        }
      } else if (kind === 'cactus') {
        G.add(new THREE.CapsuleGeometry(r * 0.55, r * 1.4, 4, 8), '#5f9e6a', M(x, top + r * 1.1, z), 5);
        G.add(new THREE.CapsuleGeometry(r * 0.3, r * 0.5, 3, 6), '#5f9e6a', M(x + r * 0.55, top + r * 1.2, z, 0, 0, -0.9), 5);
        G.add(new THREE.SphereGeometry(r * 0.22, 6, 5), '#f5a8c0', M(x, top + r * 2.3, z));
      } else if (kind === 'herb') {
        for (let i = 0; i < 12; i++) {
          const a = rng.range(0, Math.PI * 2), out = rng.range(0.2, 0.8);
          const dir = new THREE.Vector3(Math.cos(a) * out, 1, Math.sin(a) * out).normalize();
          this.leaf(F, leafShape, r * rng.range(0.9, 1.4), rng.pick([C.leaf1, C.leaf3, C.leaf4]), new THREE.Vector3(x + rng.range(-0.3, 0.3) * r, top, z + rng.range(-0.3, 0.3) * r), dir, new THREE.Vector3(0, 1, 0), 0.3, 0.2);
        }
      }
      return top;
    }

    // tija penjant amb fulles en forma de cor (potus) — es balanceja
    vine(start, len, bend, leaves, rng, swayBase = 0) {
      const V = new Geo();
      const pts = [];
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(new THREE.Vector3(start.x + bend.x * t + Math.sin(t * 3 + start.x * 5) * 0.03, start.y - len * t, start.z + bend.z * t * t));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      V.add(new THREE.TubeGeometry(curve, 12, 0.004, 3, false), '#4a7a3c', M());
      for (let i = 0; i < leaves; i++) {
        const t = (i + 0.5) / leaves;
        const p = curve.getPoint(t);
        const side = i % 2 ? 1 : -1;
        const dir = new THREE.Vector3(side * rng.range(0.4, 0.9), rng.range(-0.6, 0.2), rng.range(0.2, 0.8)).normalize();
        this.leaf(V, heartShape, rng.range(0.045, 0.065) * (1 - t * 0.35), rng.pick([C.leaf1, C.leaf3, C.leaf4, '#9ccf6e']), p, dir, new THREE.Vector3(0, 0, 1), 0.15, 0.25);
      }
      const g = V.build();
      const pos = g.attributes.position;
      const sw = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) sw[i] = swayBase + Math.max(0, start.y - pos.getY(i)) / len;
      g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
      const m = new THREE.Mesh(g, this.fol);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      return m;
    }

    // tija que surt del test, passa per sobre la vora (de l'ampit o d'un prestatge) i penja per davant,
    // sense travessar mai cap superfície; si és llarga, s'estira damunt la superfície de sota
    drapeVine(start, o, rng) {
      const V = new Geo();
      const x0 = start.x, dx = o.dx;
      const zH = o.edgeZ + 0.034;
      const pts = [
        start.clone(),
        new THREE.Vector3(x0 + dx * 0.25, o.topY + 0.024, lerp(start.z, o.edgeZ, 0.55)),
        new THREE.Vector3(x0 + dx * 0.45, o.topY + 0.014, o.edgeZ - 0.01),
        new THREE.Vector3(x0 + dx * 0.55, o.topY - 0.006, o.edgeZ + 0.026),
      ];
      const avail = o.topY - 0.03 - (o.floorY + 0.022);
      const hang = Math.min(o.hang, avail);
      for (let k = 1; k <= 4; k++) {
        const u = k / 4;
        pts.push(new THREE.Vector3(x0 + dx * (0.55 + 0.4 * u) + Math.sin(u * 3 + x0 * 9) * 0.01, o.topY - 0.03 - hang * u, zH + 0.008 * Math.sin(u * 2.5)));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      V.add(new THREE.TubeGeometry(curve, 24, 0.004, 3, false), '#4a7a3c', M());
      const lowY = o.floorY + 0.06;
      for (let i = 0; i < o.leaves; i++) {
        const t = (i + 0.6) / (o.leaves + 0.2);
        const p = curve.getPoint(t);
        const side = i % 2 ? 1 : -1;
        let dir;
        if (p.z < o.edgeZ) {            // encara sobre la superfície: fulles cap amunt i endavant
          dir = new THREE.Vector3(side * rng.range(0.3, 0.8), rng.range(0.35, 0.8), rng.range(0.0, 0.5));
          p.y = Math.max(p.y, o.topY + 0.006);
        } else {                        // penjant: fulles cap endavant i als costats, mai cap a la vora
          dir = new THREE.Vector3(side * rng.range(0.3, 0.85), p.y < lowY ? rng.range(0.05, 0.35) : rng.range(-0.45, 0.25), rng.range(0.45, 1.0));
          p.z = Math.max(p.z, o.edgeZ + 0.03);
        }
        this.leaf(V, heartShape, rng.range(0.042, 0.06) * (1 - t * 0.3), rng.pick([C.leaf1, C.leaf3, C.leaf4, '#9ccf6e']), p, dir.normalize(), new THREE.Vector3(0, 0, 1), 0.15, 0.25);
      }
      const g = V.build();
      const pos = g.attributes.position;
      const sw = new Float32Array(pos.count);
      // només es gronxa la part que penja lliure (res que estigui damunt d'una superfície)
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), z = pos.getZ(i);
        sw[i] = z > o.edgeZ + 0.02 && y < o.topY - 0.02 ? clamp((o.topY - 0.02 - y) / Math.max(hang, 0.05)) * 0.8 : 0;
      }
      g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
      const m = new THREE.Mesh(g, this.fol);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.drape = o;
      this.scene.add(m);
      this.drapes = this.drapes || [];
      this.drapes.push(m);
      return m;
    }

    buildPlants() {
      const G = this.G, F = this.F, rng = this.rng, W = L.win, D = L.desk;
      // potus a l'ampit (penja fins a l'escriptori)
      const px = -0.33, pz = 0.08;   // fora de la línia de visió de la font del parc
      const top = this.smallPlant(G, F, px, W.y0, pz, 0.055, C.pot2, 'herb');
      const sillEdge = 0.22;
      [-0.16, -0.08, 0.0, 0.07].forEach((dx, i) => {
        this.drapeVine(new THREE.Vector3(px + (i - 1.5) * 0.025, top - 0.004, pz + 0.045), { dx, edgeZ: sillEdge, topY: W.y0, floorY: D.y, hang: rng.range(0.045, 0.075), leaves: 6 }, rng);
      });
      // cactus i suculenta a l'ampit
      this.smallPlant(G, F, 0.1, W.y0, 0.07, 0.04, C.pot3, 'cactus');
      this.smallPlant(G, F, -1.56, W.y0, 0.07, 0.05, C.pot1, 'succulent');
      this.smallPlant(G, F, 1.28, D.y, 0.3, 0.055, C.pot3, 'herb');
      this.smallPlant(G, F, W.x1 + 0.55, 1.265, 0.1, 0.05, C.pot2, 'succulent');
      // potus al prestatge de dalt, penjant
      const shelfTop = this.smallPlant(G, F, L.room.x1 - 0.5, 1.735, 0.1, 0.06, C.pot4, 'herb');
      for (let i = 0; i < 3; i++) this.drapeVine(new THREE.Vector3(L.room.x1 - 0.5 + (i - 1) * 0.035, shelfTop - 0.004, 0.14), { dx: (i - 1) * 0.07, edgeZ: 0.22, topY: 1.735, floorY: 0.9, hang: rng.range(0.32, 0.55), leaves: 8 }, rng);

      // costella d'Adam gran al racó esquerre
      const mx = W.x0 + 0.3, mz = 1.3;
      const basket = [new THREE.Vector2(0, 0), new THREE.Vector2(0.17, 0), new THREE.Vector2(0.2, 0.26), new THREE.Vector2(0.21, 0.3), new THREE.Vector2(0.19, 0.3)];
      G.add(new THREE.LatheGeometry(basket, 16), (v, n, out) => out.set(Math.floor(v.y * 40) % 2 ? '#d8b88a' : '#c9a574'), M(mx, 0, mz));
      G.add(new THREE.CylinderGeometry(0.18, 0.18, 0.01, 12), '#4a3326', M(mx, 0.28, mz));
      // tiges i fulles en una malla pròpia perquè es gronxin suaument (la base, quieta)
      const MS = new Geo();
      const nL = 9;
      for (let i = 0; i < nL; i++) {
        const a = (i / nL) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const h = rng.range(0.7, 1.35);
        const out = rng.range(0.25, 0.5);
        const tip = new THREE.Vector3(mx + Math.cos(a) * out, 0.28 + h, mz + Math.sin(a) * out * 0.8);
        const base = new THREE.Vector3(mx, 0.3, mz);
        const midp = base.clone().lerp(tip, 0.5); midp.y += 0.12;
        const stem = new THREE.QuadraticBezierCurve3(base, midp, tip);
        MS.add(new THREE.TubeGeometry(stem, 8, 0.008, 4, false), '#5a8a4a', M());
        const dir = new THREE.Vector3(Math.cos(a) * 0.9, rng.range(-0.1, 0.5), Math.sin(a) * 0.7 + 0.2).normalize();
        this.leaf(MS, monsteraShape, rng.range(0.26, 0.36), i % 3 === 0 ? '#3f7f4e' : i % 3 === 1 ? '#4f9658' : '#5aa465', tip, dir, new THREE.Vector3(0, 1, 0), 0.35, 0.28);
      }
      {
        const g = MS.build();
        const P = g.attributes.position;
        const sw = new Float32Array(P.count);
        for (let i = 0; i < P.count; i++) sw[i] = 1.5 * Math.pow(clamp((P.getY(i) - 0.3) / 1.3), 1.4);
        g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
        const m = new THREE.Mesh(g, this.fol);
        m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
        this.monstera = m;
      }

      // planta penjada del sostre a l'esquerra (macramé)
      const hx = W.x0 + 0.32, hz = 0.75, hy = 2.2;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const a0 = new THREE.Vector3(hx, L.room.y1, hz), a1 = new THREE.Vector3(hx + Math.cos(a) * 0.09, hy + 0.1, hz + Math.sin(a) * 0.09);
        const len = a0.distanceTo(a1);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a1.clone().sub(a0).normalize());
        G.add(new THREE.CylinderGeometry(0.003, 0.003, len, 3), '#e8dcc4', new THREE.Matrix4().compose(a0.clone().add(a1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
      }
      const hpts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.06, 0.01), new THREE.Vector2(0.1, 0.06), new THREE.Vector2(0.11, 0.12), new THREE.Vector2(0.1, 0.12)];
      G.add(new THREE.LatheGeometry(hpts, 12), '#f0e2cc', M(hx, hy, hz), 7);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        this.vine(new THREE.Vector3(hx + Math.cos(a) * 0.08, hy + 0.12, hz + Math.sin(a) * 0.08), rng.range(0.3, 0.75), new THREE.Vector3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1 + 0.05), 9, rng, 0.3);
      }
      for (let i = 0; i < 8; i++) {
        const a = rng.range(0, Math.PI * 2);
        const dir = new THREE.Vector3(Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8).normalize();
        this.leaf(F, heartShape, 0.07, rng.pick([C.leaf1, C.leaf3, C.leaf4]), new THREE.Vector3(hx + Math.cos(a) * 0.05, hy + 0.12, hz + Math.sin(a) * 0.05), dir, new THREE.Vector3(0, 1, 0), 0.2, 0.2);
      }

      // llengua de sogra al racó dret
      const sx = L.room.x1 - 0.45, sz = 0.7;
      G.add(new THREE.CylinderGeometry(0.16, 0.13, 0.32, 14), '#efe6d6', M(sx, 0.16, sz), 7);
      G.add(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 12), '#4a3326', M(sx, 0.31, sz));
      for (let i = 0; i < 11; i++) {
        const a = rng.range(0, Math.PI * 2), out = rng.range(0, 0.1);
        const h = rng.range(0.45, 0.85);
        const s = new THREE.Shape();
        s.moveTo(-0.035, 0); s.quadraticCurveTo(-0.045, h * 0.6, 0, h); s.quadraticCurveTo(0.045, h * 0.6, 0.035, 0); s.lineTo(-0.035, 0);
        const g = new THREE.ShapeGeometry(s, 3);
        const cx = sx + Math.cos(a) * out, cz = sz + Math.sin(a) * out;
        F.add(g, (v, n, o) => o.set(Math.abs(v.x - cx) > 0.022 && v.y < 0.3 + h * 0.8 ? '#c9c56a' : ((Math.floor(v.y * 30) % 3) ? '#3f7a4a' : '#2f6440')),
          M(cx, 0.31, cz, rng.range(-0.15, 0.15), a, rng.range(-0.15, 0.15)), 0);
      }
    }

    // pols que sura a la llum del sol (i una mica a la del flexo)
    buildDust() {
      const N = 70, rng = this.rng, W = L.win;
      const pos = new Float32Array(N * 3), sd = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        pos.set([rng.range(W.x0 + 0.1, W.x1 - 0.1), rng.range(0.8, 2.3), rng.range(0.15, 1.9)], i * 3);
        sd[i] = rng.next();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      this.dustU = { uTime: U.uTime, uColor: { value: new THREE.Color('#fff2d0') }, uA: { value: 0 } };
      const m = new THREE.ShaderMaterial({
        uniforms: this.dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aSeed; uniform float uTime; varying float vA;
          void main(){
            vec3 p = position;
            float t = uTime * (0.05 + 0.05 * aSeed) + aSeed * 40.0;
            p.x += sin(t * 1.3) * 0.12 + sin(t * 0.37 + 2.0) * 0.2;
            p.y += sin(t * 0.9 + 1.0) * 0.1 - fract(uTime * 0.004 + aSeed) * 0.3;
            p.z += cos(t * 1.1) * 0.12;
            vA = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed) + aSeed * 30.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = 1.0;
          }`,
        fragmentShader: `uniform vec3 uColor; uniform float uA; varying float vA;
          void main(){ float a = uA * vA; if (a < 0.02) discard; gl_FragColor = vec4(uColor * a, 1.0); }`,
      });
      this.dust = new THREE.Points(g, m);
      this.dust.layers.set(1);
      this.dust.frustumCulled = false;
      this.scene.add(this.dust);
    }

    finishStatic() {
      this.buildDust();
      const s = this.G.mesh(this.mat);
      this.scene.add(s);
      const f = this.F.mesh(this.fol);
      f.geometry.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(f.geometry.attributes.position.count), 1));
      this.scene.add(f);
      this.staticMesh = s;
    }

    // ---------------- llums ----------------
    buildLights() {
      const s = this.scene, W = L.win;
      this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
      s.add(this.hemi);
      // rebot suau des del costat de la càmera (perquè l'interior es llegeixi bé)
      this.bounce = new THREE.DirectionalLight(0xffe0c0, 0.3);
      this.bounce.position.set(1.2, 2.4, 6);
      this.bounce.target.position.set(0.3, 0.9, 0.5);
      s.add(this.bounce, this.bounce.target);
      // sol / lluna a través de la finestra
      const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 1));
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera;
      sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 0.5; sc.far = 30;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.01;
      sun.target.position.set(0, 0.8, 1.4);
      s.add(sun, sun.target);
      // llum difusa que entra per la finestra
      this.winLight = new THREE.PointLight(0xffffff, 1, 14, 1.0);
      this.winLight.position.set((W.x0 + W.x1) / 2, 1.8, -2.4);
      s.add(this.winLight);
      // flexo
      const lamp = (this.lamp = new THREE.SpotLight(0xffc070, 0, 3.4, 62 * DEG, 0.75, 1.5));
      lamp.position.copy(this.lampHead);
      lamp.target.position.copy(this.lampHead).addScaledVector(this.lampDir, 1);
      this.desklamp.light = lamp;
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(512, 512);
      lamp.shadow.camera.near = 0.03; lamp.shadow.camera.far = 3.5;
      lamp.shadow.bias = -0.0015;
      s.add(lamp, lamp.target);
      this.lampFill = new THREE.PointLight(0xffc27a, 0, 3.4, 1.6);
      this.lampFill.position.copy(this.lampHead).add(new THREE.Vector3(0, 0.05, 0.05));
      s.add(this.lampFill);
      // pantalla del portàtil
      this.screenLight = new THREE.PointLight(0xc4d4ff, 0, 1.2, 2);
      s.add(this.screenLight);
      // llumetes
      this.fairyL = [];
      for (const x of [W.x0 + 0.4, (W.x0 + W.x1) / 2, W.x1 - 0.4]) {
        const p = new THREE.PointLight(0xffc88a, 0, 2.6, 1.6);
        p.position.set(x, W.y1 - 0.2, 0.5);
        s.add(p); this.fairyL.push(p);
      }
      // espelma
      this.candleL = new THREE.PointLight(0xffb060, 0, 1.2, 2);
      this.candleL.position.copy(this.candle).add(new THREE.Vector3(0, 0.05, 0.05));
      s.add(this.candleL);
      // llamp (flaix des de fora)
      this.flashL = new THREE.DirectionalLight(0xd8d8ff, 0);
      this.flashL.position.set(0.3, 1.5, -6);
      this.flashL.target.position.set(0, 0.8, 1.5);
      s.add(this.flashL, this.flashL.target);
    }

    // es veu aquest punt de fora des de la càmera, a través del vidre (sense res al mig)?
    isVisible(p) {
      const rc = this._rc || (this._rc = new THREE.Raycaster());
      const o = this.cam.position, d = p.clone().sub(o).normalize();
      if (d.z >= 0) return false;
      const tGlass = (L.win.zGlass - o.z) / d.z;
      const hit = o.clone().addScaledVector(d, tGlass);
      const W = L.win;
      if (hit.x < W.x0 + 0.06 || hit.x > W.x1 - 0.06 || hit.y < W.y0 + 0.06 || hit.y > W.y1 - 0.06) return false;
      rc.set(o, d); rc.far = tGlass - 0.01; rc.layers.set(0);
      const hits = rc.intersectObjects(this.scene.children, true).filter((h) => h.object.isMesh && h.object !== this.glass);
      return hits.length === 0;
    }

    // posició a pantalla (píxels de la resolució baixa) d'un punt del món
    toScreen(v, out) {
      const p = v.clone().project(this.cam);
      const R = U.uRes.value;
      return out.set((p.x * 0.5 + 0.5) * R.x, (p.y * 0.5 + 0.5) * R.y);
    }

    setAspect(aspect) {
      // amb pantalles estretes obrim el camp de visió perquè hi càpiga la noia
      const minHFov = 48 * DEG;
      let fov = this.baseFov;
      const hf = 2 * Math.atan(Math.tan((fov * DEG) / 2) * aspect);
      if (hf < minHFov) fov = (2 * Math.atan(Math.tan(minHFov / 2) / aspect)) / DEG;
      this.cam.fov = Math.min(fov, 75);
      this.cam.aspect = aspect;
      this.cam.updateProjectionMatrix();
    }

    update(dt, tod, wx, st) {
      this.t += dt;
      const c = tod.c, v = tod.v, PI = Math.PI;
      // ambient
      this.hemi.color.copy(c.amb);
      this.hemi.groundColor.copy(c.ambGround);
      this.hemi.intensity = v.ambI * PI * 0.72 + v.flash * PI * 0.9;
      if (v.flash > 0.01) this.hemi.color.lerp(LOFI._flashC || (LOFI._flashC = new THREE.Color('#c8c4ff')), clamp(v.flash));
      this.bounce.color.copy(c.amb).lerp(LOFI._warm || (LOFI._warm = new THREE.Color('#ffc890')), 0.35 + 0.4 * this.lampOn);
      this.bounce.intensity = PI * (0.12 + 0.1 * v.ambI + 0.15 * this.lampOn);
      // sol o lluna
      const useSun = tod.sunLightI >= tod.moonLightI * 0.8;
      const dir = useSun ? tod.sunDir : tod.moonDir;
      const I = useSun ? tod.sunLightI * 1.25 : tod.moonLightI * 0.6;
      this.sun.color.copy(useSun ? c.sunLight : c.moonLight);
      this.sun.intensity = I * PI;
      this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 12);
      this.sun.visible = I > 0.005;
      // finestra
      this.winLight.color.copy(c.win);
      this.winLight.intensity = v.winI * PI * 1.7;
      // flexo (automàtic segons la llum, o forçat)
      let want = st.lamp === 'on' ? 1 : st.lamp === 'off' ? 0 : (this.lampTarget ? (v.lamp > 0.3 ? 1 : 0) : (v.lamp > 0.45 ? 1 : 0));
      if (want !== this.lampTarget) { this.lampTarget = want; if (st.onLampSwitch) st.onLampSwitch(want); }
      this.lampOn = damp(this.lampOn, this.lampTarget, 14, dt);
      const lo = this.lampOn;
      // el flexo es mou: la llum el segueix
      this.desklamp.update(dt);
      this.lampHead.copy(this.desklamp.bulbWorld);
      this.lampDir.copy(this.desklamp.dirWorld);
      this.lamp.position.copy(this.lampHead);
      this.lamp.target.position.copy(this.lampHead).addScaledVector(this.lampDir, 1);
      this.lampFill.position.copy(this.lampHead).addScaledVector(this.lampDir, -0.04).add(_up5);
      this.lamp.intensity = lo * PI * 0.44;
      this.lampFill.intensity = lo * PI * 0.06;
      this.bulbMat.color.set('#6a6258').lerp(new THREE.Color('#fff6dc'), lo);
      this.lampInnerMat.color.set(C.lampDark).multiplyScalar(0.6 + 0.3 * v.ambI).lerp(new THREE.Color('#ffe8b0'), lo);
      // pantalla
      this.screen.update(dt, st);
      const scrW = this.screenWorld.set(0, 0.108, 0.06).applyMatrix4(this.lid.matrixWorld);
      this.screenLight.position.copy(scrW);
      this.screenLight.intensity = PI * (0.05 + 0.12 * (1 - tod.daylight));
      // llumetes
      const fairyWant = st.fairy === 'on' ? 1 : st.fairy === 'off' ? 0 : clamp((v.lamp - 0.2) * 2);
      this.fairyOn = damp(this.fairyOn, fairyWant, 2, dt);
      const fo = this.fairyOn;
      for (let i = 0; i < this.fairyL.length; i++) this.fairyL[i].intensity = fo * PI * (0.13 + 0.02 * Math.sin(this.t * 1.3 + i * 2));
      const tmp = LOFI._fc || (LOFI._fc = new THREE.Color());
      const off = LOFI._fo || (LOFI._fo = new THREE.Color('#8a8272'));
      for (let i = 0; i < this.fairy.length; i++) {
        const tw = 0.75 + 0.25 * Math.sin(this.t * (0.8 + (i % 5) * 0.23) + i * 1.7);
        tmp.copy(off).lerp(this.fairyBase[i], fo * tw).multiplyScalar(1 + 0.35 * fo * tw);
        this.fairyMesh.setColorAt(i, tmp);
      }
      this.fairyMesh.instanceColor.needsUpdate = true;
      // espelma: s'encén al vespre
      const cOn = clamp((v.lamp - 0.5) * 2) * (st.candle === false ? 0 : 1);
      const flick = 0.85 + 0.15 * Math.sin(this.t * 13.7) * Math.sin(this.t * 7.3 + 1.2);
      this.candleL.intensity = cOn * PI * 0.12 * flick;
      this.flame.visible = cOn > 0.05;
      this.flame.scale.set(1, 1.6 + 0.4 * flick, 1);
      // vapor de la tassa: sempre vertical, i s'esvaeix mentre ella l'aixeca per beure
      this.steam.position.copy(this.mug.position);
      const lifted = clamp((this.mug.position.y - this.mugHomeY) / 0.04);
      this.steamU.uA.value = 0.5 * (1 - lifted);
      // pols a la llum
      const sunIn = useSun ? tod.sunLightI * (1 - v.overcast) : 0;
      this.dustU.uA.value = sunIn * 0.5 + lo * 0.1;
      this.dustU.uColor.value.copy(c.sunLight).lerp(LOFI._warm || (LOFI._warm = new THREE.Color('#ffc890')), lo * (1 - sunIn));
      // llamp
      this.flashL.intensity = v.flash * PI * 2.2;
      this.flashL.visible = v.flash > 0.01;
      if (wx.boltDir) this.flashL.position.set(wx.boltDir.x * 8, 3 + wx.boltDir.y * 4, -8);
      // rellotge
      const hr = st.hour;
      this.hHour.rotation.z = -((hr % 12) / 12) * Math.PI * 2;
      this.hMin.rotation.z = -((hr * 60) % 60) / 60 * Math.PI * 2;

      // vidre
      const g = this.glassU;
      g.uWet.value = wx.wet;
      g.uRain.value = v.rain;
      g.uFogGlass.value = clamp(wx.wet * 0.8) * (0.6 + 0.4 * (1 - tod.daylight));
      const refl = clamp(1 - v.bright * 2.2) * 0.9;
      g.uRefl.value = refl;
      g.uLampCol.value.set('#ffc880').multiplyScalar(lo * 0.9);
      const R = U.uRes.value;
      const mirror = (p) => new THREE.Vector3(p.x, p.y, 2 * L.win.zGlass - p.z);
      const s1 = this.toScreen(mirror(this.lampHead), new THREE.Vector2());
      g.uLampRef.value.set(s1.x, s1.y, R.y * 0.05);
      const s2 = this.toScreen(mirror(scrW), new THREE.Vector2());
      g.uScreenRef.value.set(s2.x, s2.y, R.y * 0.04);
      if (!this._fairyRefDone || this._fairyRes !== R.x) {
        for (let i = 0; i < 16; i++) {
          const f = this.fairy[Math.floor((i / 16) * this.fairy.length)];
          const sp = this.toScreen(mirror(f), new THREE.Vector2());
          g.uFairy.value[i].set(Math.floor(sp.x) + 0.5, Math.floor(sp.y) + 0.5);
        }
        this._fairyRefDone = true; this._fairyRes = R.x;
      }
      g.uFairyI.value = fo;
    }
  }

  LOFI.Room = Room;
})();
