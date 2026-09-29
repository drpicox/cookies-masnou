/* Habitació amb vistes — panell de control, dreceres de teclat i àudio */
(function () {
  'use strict';
  const app = LOFI.app;
  const S = app.S;
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const { clamp, TimeOfDay } = { clamp: LOFI.clamp, TimeOfDay: LOFI.TimeOfDay };

  if (window.LofiAudio && !app.audio) {
    try { app.audio = new window.LofiAudio(); } catch (e) { console.warn('Àudio no disponible', e); }
  }
  const audio = app.audio;

  const fmt = (h) => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
  const WX_LABEL = { clear: 'serè', cloudy: 'ennuvolat', rain: 'plou', storm: 'tempesta' };

  // ---------------- avís breu ----------------
  let toastT = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 1700);
  }

  // ---------------- controls genèrics ----------------
  function paintRange(input) {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--p', p + '%');
  }
  function segment(id, value, onPick) {
    const el = $(id);
    const set = (v) => { for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(v)); };
    set(value);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      set(b.dataset.v);
      onPick(b.dataset.v);
    });
    return set;
  }
  function toggle(id, value, onChange) {
    const el = $(id);
    el.checked = !!value;
    el.addEventListener('change', () => onChange(el.checked));
    return (v) => { el.checked = !!v; };
  }

  // ---------------- temps del dia ----------------
  const rngHour = $('rngHour');
  let draggingHour = false;
  rngHour.addEventListener('input', () => {
    draggingHour = true;
    if (S.timeMode === 'real') { S.timeMode = 'fixed'; setTimeMode('fixed'); }
    app.setHour(parseFloat(rngHour.value), false);
    if (S.timeMode === 'fixed') S.hour = parseFloat(rngHour.value);
    $('valHour').textContent = fmt(parseFloat(rngHour.value));
    paintRange(rngHour);
    app.save();
  });
  rngHour.addEventListener('change', () => { draggingHour = false; });
  const setTimeMode = segment('segTime', S.timeMode, (v) => {
    S.timeMode = v;
    if (v === 'fixed') S.hour = app.hour;
    $('rowDay').style.display = v === 'cycle' ? '' : 'none';
    app.save();
    toast({ cycle: 'El temps passa', real: 'Hora real', fixed: 'Temps aturat' }[v]);
  });
  $('rowDay').style.display = S.timeMode === 'cycle' ? '' : 'none';
  const rngDay = $('rngDay');
  rngDay.value = S.dayMinutes;
  const dayLabel = () => { $('valDay').textContent = S.dayMinutes >= 60 ? (S.dayMinutes / 60).toFixed(S.dayMinutes % 60 ? 1 : 0).replace('.', ',') + ' h' : S.dayMinutes + ' min'; };
  dayLabel(); paintRange(rngDay);
  rngDay.addEventListener('input', () => { S.dayMinutes = parseInt(rngDay.value, 10); dayLabel(); paintRange(rngDay); app.save(); });

  const PRESET_NAMES = { 1.6: 'Nit estrellada', 6.12: 'Sortida del sol', 12.4: 'Dia', 17.62: 'Posta de sol' };
  function goPreset(h) {
    if (S.timeMode === 'real') { S.timeMode = 'fixed'; setTimeMode('fixed'); $('rowDay').style.display = 'none'; }
    app.setHour(h, true);
    if (S.timeMode === 'fixed') S.hour = h;
    app.save();
    toast(PRESET_NAMES[h] || fmt(h));
  }
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) goPreset(parseFloat(b.dataset.h));
  });

  // ---------------- temps (meteorologia) ----------------
  const setWeatherSeg = segment('segWeather', S.weather, (v) => { app.setWeather(v); toast(v === 'auto' ? 'Temps automàtic' : WX_LABEL[v][0].toUpperCase() + WX_LABEL[v].slice(1)); });
  const rngRain = $('rngRain');
  rngRain.value = Math.round(S.rainAmount * 100);
  $('valRain').textContent = rngRain.value + '%';
  paintRange(rngRain);
  rngRain.addEventListener('input', () => {
    S.rainAmount = rngRain.value / 100;
    app.weather.rainAmount = S.rainAmount;
    $('valRain').textContent = rngRain.value + '%';
    paintRange(rngRain);
    app.save();
  });
  $('btnBolt').addEventListener('click', () => { app.bolt(); });
  $('btnPigeon').addEventListener('click', () => {
    const p = app.chars && app.chars.pigeons;
    if (!p) return;
    if (!S.pigeons) { S.pigeons = true; setPig(true); app.save(); }
    if (app.tod.daylight < 0.3) toast('Els coloms dormen de nit');
    else if (app.weather.s.rain > 0.25) toast('Amb pluja no volen sortir');
    else { p.summon(); toast('Un colom!'); }
  });

  // ---------------- escena ----------------
  segment('segAct', S.activity, (v) => { S.activity = v; app.save(); toast({ auto: 'Fa el que vol', computer: 'A l\'ordinador', study: 'Estudiant' }[v]); });
  segment('segLamp', S.lamp, (v) => { S.lamp = v; app.save(); });
  segment('segFairy', S.fairy, (v) => { S.fairy = v; app.save(); });
  const setPig = toggle('chkPigeons', S.pigeons, (v) => { S.pigeons = v; app.save(); });
  toggle('chkCat', S.cat, (v) => { S.cat = v; app.save(); });
  toggle('chkCandle', S.candle, (v) => { S.candle = v; app.save(); });

  // ---------------- imatge ----------------
  segment('segPx', S.pixelH, (v) => { S.pixelH = parseInt(v, 10); app.resize(); app.save(); });
  toggle('chkOutline', S.outlines, (v) => { S.outlines = v; app.pipe.opts.outlines = v; app.save(); });
  toggle('chkBloom', S.bloom, (v) => { S.bloom = v; app.pipe.opts.bloom = v; app.save(); });
  toggle('chkGrain', S.grain, (v) => { S.grain = v; app.pipe.opts.grain = v; app.save(); });
  toggle('chkParallax', S.parallax !== false, (v) => { S.parallax = v; app.save(); toast(v ? 'Paral·laxi' : 'Càmera quieta'); });
  segment('segFps', S.fps, (v) => { S.fps = parseInt(v, 10); app.save(); });

  // ---------------- so ----------------
  const MIX = [
    ['master', 'General'], ['music', 'Música'], ['vinyl', 'Vinil i cinta'], ['rain', 'Pluja'],
    ['thunder', 'Trons'], ['city', 'Ciutat'], ['nature', 'Ocells i coloms'], ['room', 'Habitació (teclat, llapis, gat)'],
  ];
  const mixer = $('mixer');
  for (const [k, label] of MIX) {
    const row = document.createElement('label');
    row.className = 'range';
    row.innerHTML = `<span class="lbl"><span>${label}</span><b>${Math.round(S.vol[k] * 100)}</b></span><input type="range" min="0" max="100" step="1" value="${Math.round(S.vol[k] * 100)}" aria-label="Volum: ${label}">`;
    const input = row.querySelector('input'), val = row.querySelector('b');
    paintRange(input);
    input.addEventListener('input', () => {
      S.vol[k] = input.value / 100;
      val.textContent = input.value;
      paintRange(input);
      if (audio && audio.started) audio.setVolume(k, S.vol[k]);
      app.save();
    });
    mixer.appendChild(row);
  }

  function setSongUI(info) {
    const title = info && info.title ? info.title : '—';
    $('npTitle').textContent = title;
    $('uiSong').textContent = title;
    const sub = info ? [info.key, info.bpm ? Math.round(info.bpm) + ' bpm' : null].filter(Boolean).join(' · ') : '';
    $('npSub').textContent = sub ? 'lofi generat · ' + sub : 'lofi generat en directe';
    $('uiSongSub').textContent = sub || 'lofi generat en directe';
  }
  function refreshPlaying() {
    const on = !!(audio && audio.started && S.musicOn && !S.muted);
    body.classList.toggle('playing', !!(audio && audio.started && S.musicOn));
    body.classList.toggle('paused', !on);
    body.classList.toggle('muted', !!S.muted);
    $('btnPlay').textContent = S.musicOn ? '⏸ Pausa la música' : '▶ Posa la música';
    $('nowPlaying').classList.toggle('hidden', !(audio && audio.started));
  }

  let starting = null;
  async function startAudio() {
    if (!audio) { toast('Aquest navegador no pot fer so'); return false; }
    if (audio.started) return true;
    if (starting) return starting;
    starting = (async () => {
      try {
        audio.onSong = (info) => { setSongUI(info); if (!body.classList.contains('panel-open')) toast('♪ ' + info.title); };
        // perquè la primera cançó ja encaixi amb l'hora i el temps que fa
        const ws = app.weather.s;
        audio.update({ dayTime: app.hour / 24, rain: ws.rain, storm: ws.storm });
        await audio.start();
        for (const k of Object.keys(S.vol)) audio.setVolume(k, S.vol[k]);
        audio.setMuted(!!S.muted);
        audio.setMusicOn(!!S.musicOn);
        if (audio.song) setSongUI(audio.song);
        body.classList.remove('silent');
        refreshPlaying();
        return true;
      } catch (e) {
        console.warn('No s\'ha pogut engegar l\'àudio', e);
        toast('No s\'ha pogut engegar el so');
        return false;
      } finally { starting = null; }
    })();
    return starting;
  }
  async function toggleMusic() {
    if (!audio) return;
    if (!audio.started) { S.musicOn = true; await startAudio(); app.save(); return; }
    S.musicOn = !S.musicOn;
    audio.setMusicOn(S.musicOn);
    refreshPlaying();
    app.save();
    toast(S.musicOn ? 'Música' : 'Música en pausa');
  }
  async function toggleMute() {
    S.muted = !S.muted;
    if (audio && audio.started) audio.setMuted(S.muted);
    else if (!S.muted) await startAudio();
    refreshPlaying();
    app.save();
    toast(S.muted ? 'Silenci' : 'So');
  }
  async function nextSong() {
    if (!audio) return;
    if (!audio.started) { await startAudio(); return; }
    if (!S.musicOn) { S.musicOn = true; audio.setMusicOn(true); refreshPlaying(); }
    audio.nextSong();
  }
  $('btnPlay').addEventListener('click', toggleMusic);
  $('btnNext').addEventListener('click', nextSong);
  $('btnMusic').addEventListener('click', toggleMusic);
  $('btnMute').addEventListener('click', toggleMute);

  // ---------------- pantalla d'inici ----------------
  const intro = $('intro');
  function closeIntro() { intro.classList.add('gone'); introOpen = false; poke(); }
  let introOpen = !(new URLSearchParams(location.search).get('intro') === '0');
  if (!introOpen) intro.classList.add('gone');
  $('startBtn').addEventListener('click', async () => { closeIntro(); await startAudio(); });
  $('silentBtn').addEventListener('click', () => { closeIntro(); body.classList.add('silent'); });

  // ---------------- panell ----------------
  const panel = $('panel');
  function setPanel(open) {
    body.classList.toggle('panel-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) syncClock(true);
    poke();
  }
  const togglePanel = () => setPanel(!body.classList.contains('panel-open'));
  $('btnPanel').addEventListener('click', () => setPanel(true));
  $('btnClose').addEventListener('click', () => setPanel(false));

  // ---------------- pantalla completa ----------------
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function toggleFullscreen() {
    const el = document.documentElement;
    if (!fsEl()) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) { const p = req.call(el); if (p && p.catch) p.catch(() => toast('No es pot posar a pantalla completa')); }
      else toast('Pantalla completa no disponible');
    } else {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) ex.call(document);
    }
  }
  const onFs = () => { body.classList.toggle('fs', !!fsEl()); setTimeout(app.resize, 60); };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  $('btnFull').addEventListener('click', toggleFullscreen);
  $('scene').addEventListener('dblclick', toggleFullscreen);

  // ---------------- repòs: amaga el cursor i els botons ----------------
  let idleT = null;
  function poke() {
    body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      if (!body.classList.contains('panel-open') && !introOpen) body.classList.add('idle');
    }, 3200);
  }
  for (const ev of ['mousemove', 'mousedown', 'touchstart', 'wheel']) window.addEventListener(ev, poke, { passive: true });
  poke();

  // ---------------- teclat ----------------
  const WX_CYCLE = ['clear', 'rain', 'storm', 'auto'];
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    poke();
    const k = e.key.toLowerCase();
    if (k === 'h' || k === 'tab') { e.preventDefault(); togglePanel(); }
    else if (k === 'escape') { if (body.classList.contains('panel-open')) setPanel(false); else if (introOpen) closeIntro(); }
    else if (k === 'f') toggleFullscreen();
    else if (k === ' ') { e.preventDefault(); if (introOpen) { closeIntro(); startAudio(); } else toggleMusic(); }
    else if (k === 'm') toggleMute();
    else if (k === 'n') nextSong();
    else if (k === 'l') app.bolt();
    else if (k === 'c') $('btnPigeon').click();
    else if (k === 'r') {
      const i = (WX_CYCLE.indexOf(S.weather) + 1) % WX_CYCLE.length;
      app.setWeather(WX_CYCLE[i]); setWeatherSeg(WX_CYCLE[i]);
      toast(WX_CYCLE[i] === 'auto' ? 'Temps automàtic' : WX_LABEL[WX_CYCLE[i]][0].toUpperCase() + WX_LABEL[WX_CYCLE[i]].slice(1));
    }
    else if (k >= '1' && k <= '4') goPreset([1.6, 6.12, 12.4, 17.62][+k - 1]);
    else if (k === 'arrowright' || k === 'arrowleft') {
      if (e.target && e.target.type === 'range') return;
      e.preventDefault();
      if (S.timeMode === 'real') { S.timeMode = 'fixed'; setTimeMode('fixed'); $('rowDay').style.display = 'none'; }
      const h = app.hour + (k === 'arrowright' ? 0.25 : -0.25);
      app.setHour(h, false);
      if (S.timeMode === 'fixed') S.hour = ((h % 24) + 24) % 24;
      app.save();
      toast(fmt(h));
    }
  });

  // ---------------- rellotge del panell ----------------
  let lastClock = 0;
  function syncClock(force) {
    const now = performance.now();
    if (!force && now - lastClock < 250) return;
    lastClock = now;
    const h = app.hour;
    $('uiClock').textContent = fmt(h);
    $('uiPhase').textContent = TimeOfDay.phaseName(h / 24);
    const ph = app.weather.phase;
    $('uiWeather').textContent = (WX_LABEL[ph] || ph) + (S.weather === 'auto' ? ' · auto' : '');
    if (!draggingHour) { rngHour.value = h; $('valHour').textContent = fmt(h); paintRange(rngHour); }
    const btns = $('presets').querySelectorAll('button');
    for (const b of btns) b.classList.toggle('on', Math.abs(((parseFloat(b.dataset.h) - h + 36) % 24) - 12) < 0.3);
  }
  app.onTick = () => { if (body.classList.contains('panel-open')) syncClock(false); };

  // pausa de l'àudio quan la pestanya s'amaga? No: la música segueix sonant (és el que es vol d'un lofi).
  refreshPlaying();
  syncClock(true);
  if (new URLSearchParams(location.search).has('panel')) setPanel(true);
  LOFI.ui = { toast, setPanel, startAudio, toggleFullscreen };
})();
