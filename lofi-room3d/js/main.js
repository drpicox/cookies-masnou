/* Habitació amb vistes — bucle principal i orquestració */
(function () {
  'use strict';
  const { clamp, lerp, wrap, damp, smooth } = LOFI;
  const params = new URLSearchParams(location.search);

  // ---------------- ajustos ----------------
  const DEFAULTS = {
    timeMode: 'cycle', hour: 17.4, dayMinutes: 24,
    weather: 'auto', rainAmount: 0.7,
    activity: 'auto', pigeons: true, cat: true, lamp: 'auto', fairy: 'auto', candle: true,
    pixelH: 270, outlines: true, bloom: true, grain: true, fps: 30, parallax: true,
    vol: { master: 0.8, music: 0.7, rain: 0.7, thunder: 0.7, city: 0.3, nature: 0.5, room: 0.45, vinyl: 0.35 },
    musicOn: true, muted: false,
  };
  const KEY = 'habitacio-amb-vistes:v1';
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { s = {}; }
    const out = Object.assign({}, DEFAULTS, s);
    out.vol = Object.assign({}, DEFAULTS.vol, s.vol || {});
    return out;
  }
  const S = loadSettings();
  // amb paràmetres de prova a l'URL no desem res (no volem trepitjar els ajustos de l'usuari)
  const testMode = ['h', 'w', 'px', 'a', 'cam', 'freeze', 'dev'].some((k) => params.has(k));
  let saveT = null;
  function save() {
    if (testMode) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* res */ } }, 300);
  }

  // paràmetres d'URL (per provar): ?h=18.5&w=rain&freeze&intro=0
  if (params.has('h')) { S.hour = parseFloat(params.get('h')); if (params.has('freeze')) S.timeMode = 'fixed'; }
  if (params.has('w')) S.weather = params.get('w');
  if (params.has('px')) S.pixelH = parseInt(params.get('px'), 10);
  if (params.has('a')) S.activity = params.get('a');

  // ---------------- escena ----------------
  const canvas = document.getElementById('scene');
  const pipe = new LOFI.Pipeline(canvas);
  pipe.opts.outlines = S.outlines; pipe.opts.bloom = S.bloom; pipe.opts.grain = S.grain;
  const tod = new LOFI.TimeOfDay();
  const room = new LOFI.Room(3);
  if (params.has('cam')) {
    const v = params.get('cam').split(',').map(Number);
    room.cam.position.set(v[0], v[1], v[2]);
    room.cam.lookAt(v[3], v[4], v[5]);
    if (params.has('fov')) room.baseFov = +params.get('fov');
  }
  const outside = new LOFI.Outside(7);
  outside.visibleTest = (p) => room.isVisible(p);
  const weather = new LOFI.Weather(11);
  weather.rainAmount = S.rainAmount;
  weather.setMode(S.weather, true);
  const chars = LOFI.Characters ? new LOFI.Characters(room, outside) : null;

  const realHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  let hour = S.timeMode === 'real' ? realHour() : S.hour;
  let goTo = null;     // transició suau cap a una hora triada

  const state = {
    hour, dayT: hour / 24, activity: 'computer', typing: false, writing: false, catPurr: false,
    lamp: S.lamp, fairy: S.fairy, candle: S.candle,
    onLampSwitch: (on) => { if (app.audio && app.audio.started) app.audio.lampClick(); },
  };

  const app = (LOFI.app = {
    S, save, tod, room, outside, weather, pipe, chars, state, audio: null,
    get hour() { return hour; },
    setHour(h, smoothGo = true) {
      h = wrap(h, 0, 24);
      if (!smoothGo) { hour = h; goTo = null; return; }
      let d = h - hour;
      if (d < 0) d += 24;             // sempre endavant, com el temps
      if (d > 20) d -= 24;            // excepte si és gairebé enrere
      goTo = { from: hour, to: hour + d, t: 0, dur: clamp(Math.abs(d) * 0.35, 1.2, 4.5) };
    },
    setWeather(m) { S.weather = m; weather.setMode(m); save(); },
    bolt(near) { weather.strike(outside, onThunder, near === undefined ? 0.35 : (near ? 1 : 0)); },
    resize,
  });

  function onThunder(dist) { if (app.audio && app.audio.started) app.audio.thunder(dist); }

  // ---------------- mida ----------------
  function resize() {
    const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
    const H = clamp(S.pixelH | 0, 120, 540);
    let aspect = vw / vh;
    // cobrim la finestra: fora d'aquest marge retallem en lloc de deformar
    const a = clamp(aspect, 0.5, 2.6);
    const w = Math.max(2, Math.round(H * a)), h = H;
    pipe.setSize(w, h);
    room.setAspect(w / h);
    // escala CSS per cobrir sense deformar
    const scale = Math.max(vw / w, vh / h);
    canvas.style.width = Math.ceil(w * scale) + 'px';
    canvas.style.height = Math.ceil(h * scale) + 'px';
    canvas.style.left = Math.round((vw - w * scale) / 2) + 'px';
    canvas.style.top = Math.round((vh - h * scale) / 2) + 'px';
    room._fairyRefDone = false;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------- càmera amb paral·laxi ----------------
  // Quan no toques res, deriva molt a poc a poc; amb el ratolí, el segueix suaument.
  const camBase = { pos: room.cam.position.clone(), target: new THREE.Vector3().fromArray(LOFI.LAYOUT.cam.target) };
  const par = { x: 0, y: 0, z: 0, mx: 0, my: 0, last: -1e9 };
  window.addEventListener('mousemove', (e) => {
    par.mx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    par.my = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    par.last = performance.now();
  }, { passive: true });
  document.addEventListener('mouseleave', () => { par.last = -1e9; });
  function updateCamera(dt) {
    if (params.has('cam')) return;
    const t = LOFI.U.uTime.value;
    let tx = 0, ty = 0, tz = 0;
    const mouse = performance.now() - par.last < 7000;
    if (S.parallax !== false) {
      const dx = Math.sin(t * 0.07) * 0.06 + Math.sin(t * 0.023 + 1) * 0.04;
      const dy = Math.sin(t * 0.053 + 2) * 0.025;
      const dz = Math.sin(t * 0.031) * 0.05;
      if (mouse) { tx = par.mx * 0.16 + dx * 0.25; ty = -par.my * 0.075 + dy * 0.25; tz = dz * 0.3; }
      else { tx = dx; ty = dy; tz = dz; }
    }
    const k = 1 - Math.exp(-dt * (mouse ? 2.2 : 0.7));
    par.x += (tx - par.x) * k; par.y += (ty - par.y) * k; par.z += (tz - par.z) * k;
    room.cam.position.set(camBase.pos.x + par.x, camBase.pos.y + par.y, camBase.pos.z + par.z);
    room.cam.lookAt(camBase.target.x + par.x * 0.3, camBase.target.y + par.y * 0.3, camBase.target.z);
    room._fairyRefDone = false;
  }

  // ---------------- bucle ----------------
  let last = performance.now();
  let saveTick = 0;
  function step(dt) {
    LOFI.U.uTime.value += dt;
    updateCamera(dt);
    // temps del dia
    if (goTo) {
      goTo.t += dt / goTo.dur;
      const k = smooth(goTo.t);
      hour = wrap(lerp(goTo.from, goTo.to, k), 0, 24);
      if (goTo.t >= 1) { goTo = null; if (S.timeMode === 'fixed') S.hour = hour; }
    } else if (S.timeMode === 'real') hour = realHour();
    else if (S.timeMode === 'cycle') hour = wrap(hour + (dt * 24) / (S.dayMinutes * 60), 0, 24);
    if (S.timeMode !== 'fixed' && !goTo) S.hour = hour;
    state.hour = hour; state.dayT = hour / 24;
    // amb l'hora real, la lluna també té la fase d'avui (però mai del tot invisible)
    tod.moonPhase = S.timeMode === 'real' ? LOFI.clamp(LOFI.TimeOfDay.realMoonPhase(), 0.08, 0.92) : 0.42;
    state.lamp = S.lamp; state.fairy = S.fairy; state.candle = S.candle;

    const wx = weather.update(dt, outside, onThunder);
    tod.update(hour / 24, wx);
    if (chars) chars.update(dt, tod, wx, state, S, app);
    room.update(dt, tod, wx, state);
    outside.update(dt, tod, wx, room.cam, S);
    if (app.audio && app.audio.started) {
      app.audio.update({ dayTime: hour / 24, rain: wx.rain, storm: wx.storm, typing: state.typing, writing: state.writing, catPurr: state.catPurr });
    }
    if (app.onTick) app.onTick(dt);
    // desa l'hora de tant en tant perquè en tornar continuï on era
    saveTick += dt;
    if (saveTick > 10) { saveTick = 0; save(); }
  }

  function render() {
    room.glassU.tOutside.value = pipe.rtOut.texture;
    const night = 1 - tod.daylight;
    pipe.render({ outScene: outside.scene, outCam: outside.cam, roomScene: room.scene, cam: room.cam, bloom: 0.38 + 0.3 * night });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const minMs = 1000 / clamp(S.fps, 10, 60) - 1.5;
    if (now - last < minMs) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(dt);
    render();
  }
  // depuració: avança la simulació manualment (útil amb la pestanya en segon pla)
  app.advance = (sec = 1, fps = 30) => {
    const n = Math.max(1, Math.round(sec * fps));
    for (let i = 0; i < n; i++) step(1 / fps);
    render();
    return LOFI.U.uTime.value;
  };

  // depuració: desa una captura ampliada del canvas a un servidor local (només amb ?dev)
  if (params.has('dev')) app.shot = async (name = 'shot', scale = 3) => {
    render();
    const c2 = document.createElement('canvas');
    c2.width = pipe.w * scale; c2.height = pipe.h * scale;
    const g2 = c2.getContext('2d');
    g2.imageSmoothingEnabled = false;
    g2.drawImage(canvas, 0, 0, c2.width, c2.height);
    const r = await fetch('http://127.0.0.1:8767/save?name=' + encodeURIComponent(name), { method: 'POST', body: c2.toDataURL('image/png') });
    return r.text();
  };

  // un primer pas perquè tot estigui a lloc abans de pintar
  step(0.016);
  render();
  requestAnimationFrame(frame);
  document.documentElement.classList.add('ready');
})();
