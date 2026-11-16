/* =====================================================================
   Rene's Rampart – Client (Darstellung, Steuerung, Ton, Menüs, Netzwerk)
   ===================================================================== */
(function () {
  'use strict';
  const E = window.RampartEngine;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  // ------------------------------------------------------------------
  // Speicher
  // ------------------------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rr_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rr_' + k, JSON.stringify(v)); } catch (e) { } }
  };
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  }
  function rgba(h, a) { const c = hexToRgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function shade(h, f) { return f < 0 ? mix(h, '#000000', -f) : mix(h, '#ffffff', f); }
  const hash = (i, k) => { let x = Math.imul(i ^ (k * 0x9e3779b1), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  function vnoise(x, y, cell, k) {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const h = (a, b) => hash(a * 7919 + b * 104729, k);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------
  // Ton (Web Audio Synthesizer)
  // ------------------------------------------------------------------
  const Sfx = {
    ctx: null, master: null, on: store.get('sound', true), noise: null, last: {},
    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.on ? 0.6 : 0;
          const comp = this.ctx.createDynamicsCompressor();
          comp.threshold.value = -14; comp.ratio.value = 5;
          this.master.connect(comp); comp.connect(this.ctx.destination);
          const len = this.ctx.sampleRate * 1.2;
          this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const d = this.noise.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { }
    },
    setOn(v) { this.on = v; store.set('sound', v); if (this.master) this.master.gain.value = v ? 0.6 : 0; },
    ok(key, gap) {
      if (!this.ctx || !this.on || G.silent) return false;
      const t = this.ctx.currentTime;
      if (key && this.last[key] && t - this.last[key] < (gap || 0.03)) return false;
      if (key) this.last[key] = t;
      return true;
    },
    env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    },
    nz(t, dur, type, f0, f1, q, peak, attack) {
      const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = type; f.Q.value = q || 1;
      f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain(); this.env(g, t, attack || 0.005, peak, dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    },
    osc(t, dur, type, f0, f1, peak, attack) {
      const c = this.ctx, o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain(); this.env(g, t, attack || 0.005, peak, dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    },
    boom(v = 1) { if (!this.ok('boom', 0.045)) return; const t = this.ctx.currentTime; this.osc(t, 0.35, 'sine', 120, 38, 0.9 * v); this.nz(t, 0.28, 'lowpass', 1600, 200, 0.7, 0.7 * v); this.nz(t, 0.06, 'highpass', 2500, 0, 0.7, 0.25 * v); },
    explode(v = 1) { if (!this.ok('exp', 0.05)) return; const t = this.ctx.currentTime; this.nz(t, 0.55 * v + 0.2, 'lowpass', 1400, 120, 0.8, 0.85 * v); this.osc(t, 0.3, 'sine', 90, 30, 0.6 * v); this.nz(t + 0.04, 0.25, 'bandpass', 3200, 900, 2, 0.18 * v); },
    thud() { if (!this.ok('thud', 0.05)) return; const t = this.ctx.currentTime; this.nz(t, 0.18, 'lowpass', 700, 150, 0.8, 0.45); this.osc(t, 0.12, 'sine', 140, 60, 0.3); },
    splash() { if (!this.ok('spl', 0.06)) return; const t = this.ctx.currentTime; this.nz(t, 0.45, 'bandpass', 1800, 500, 1.2, 0.45, 0.02); this.nz(t, 0.2, 'highpass', 4000, 0, 0.6, 0.12); },
    whistle(d = 1) { if (!this.ok('wh', 0.25)) return; const t = this.ctx.currentTime; this.osc(t, Math.max(0.4, d), 'sine', 1500, 420, 0.08, 0.08); },
    click() { if (!this.ok('click', 0.03)) return; const t = this.ctx.currentTime; this.nz(t, 0.06, 'bandpass', 2600, 1800, 3, 0.5); this.osc(t, 0.05, 'square', 420, 200, 0.12); this.nz(t + 0.04, 0.08, 'bandpass', 1500, 900, 3, 0.25); },
    clank() { if (!this.ok('clank', 0.05)) return; const t = this.ctx.currentTime; this.osc(t, 0.25, 'triangle', 310, 300, 0.3); this.osc(t, 0.2, 'triangle', 466, 460, 0.18); this.nz(t, 0.05, 'highpass', 3000, 0, 1, 0.3); },
    tick() { if (!this.ok('tick', 0.2)) return; const t = this.ctx.currentTime; this.osc(t, 0.06, 'sine', 1200, 1200, 0.2); },
    err() { if (!this.ok('err', 0.15)) return; const t = this.ctx.currentTime; this.osc(t, 0.12, 'square', 180, 150, 0.12); this.osc(t + 0.1, 0.14, 'square', 140, 120, 0.12); },
    pickup() { if (!this.ok('pick', 0.1)) return; const t = this.ctx.currentTime; [660, 880, 1320].forEach((f, k) => this.osc(t + k * 0.07, 0.15, 'square', f, f, 0.12)); },
    fanfare() {
      if (!this.ok('fan', 0.8)) return; const t = this.ctx.currentTime;
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.38]].forEach(([f, d]) => { this.osc(t + d, 0.22, 'triangle', f, f, 0.22); this.osc(t + d, 0.22, 'square', f / 2, f / 2, 0.05); });
      [523, 659, 784].forEach(f => this.osc(t + 0.55, 0.6, 'triangle', f, f, 0.12));
    },
    victory() {
      if (!this.ok('vic', 2)) return; const t = this.ctx.currentTime;
      const seq = [[392, 0], [523, 0.15], [659, 0.3], [784, 0.45], [659, 0.62], [784, 0.75], [1047, 0.95]];
      seq.forEach(([f, d]) => { this.osc(t + d, 0.3, 'triangle', f, f, 0.25); this.osc(t + d, 0.3, 'sawtooth', f / 2, f / 2, 0.04); });
      [523, 659, 784, 1047].forEach(f => this.osc(t + 1.15, 1.2, 'triangle', f, f, 0.12));
    },
    horn() { if (!this.ok('horn', 1)) return; const t = this.ctx.currentTime; this.osc(t, 0.9, 'sawtooth', 98, 92, 0.12, 0.08); this.osc(t, 0.9, 'sawtooth', 147, 140, 0.08, 0.08); },
    crackle() { if (!this.ok('crk', 0.2)) return; const t = this.ctx.currentTime; for (let k = 0; k < 5; k++) this.nz(t + k * 0.05, 0.05, 'bandpass', 3000 + Math.random() * 2000, 0, 3, 0.15); }
  };

  // ------------------------------------------------------------------
  // Deutsche Sprachausgabe
  // ------------------------------------------------------------------
  const Voice = {
    on: store.get('voice', true), voice: null, unlocked: false, lastText: '', lastT: 0,
    pick() {
      if (!window.speechSynthesis) return;
      const vs = speechSynthesis.getVoices().filter(v => /^de(-|_|$)/i.test(v.lang));
      const pref = ['Markus', 'Yannick', 'Conrad', 'Google Deutsch', 'Microsoft Stefan', 'Microsoft Conrad', 'Anna', 'Helena', 'Petra', 'Katja'];
      let best = null;
      for (const p of pref) { best = vs.find(v => v.name.indexOf(p) >= 0); if (best) break; }
      this.voice = best || vs.find(v => /de-DE/i.test(v.lang)) || vs[0] || null;
    },
    unlock() {
      if (this.unlocked || !window.speechSynthesis) return;
      this.unlocked = true;
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'de-DE'; speechSynthesis.speak(u); } catch (e) { }
    },
    say(text, interrupt) {
      if (!this.on || G.silent || !window.speechSynthesis) return;
      const now = performance.now();
      if (text === this.lastText && now - this.lastT < 1500) return;
      this.lastText = text; this.lastT = now;
      try {
        if (interrupt) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'de-DE'; if (this.voice) u.voice = this.voice;
        u.rate = 1.08; u.pitch = 0.72; u.volume = 1;
        speechSynthesis.speak(u);
      } catch (e) { }
    },
    setOn(v) { this.on = v; store.set('voice', v); if (!v && window.speechSynthesis) speechSynthesis.cancel(); }
  };
  if (window.speechSynthesis) { Voice.pick(); speechSynthesis.onvoiceschanged = () => Voice.pick(); }

  // ------------------------------------------------------------------
  // Spielzustand auf dem Client
  // ------------------------------------------------------------------
  const G = {
    mode: 'none',       // 'online' | 'local' | 'attract' | 'none'
    view: null,         // Ansicht (bei lokal: Engine-Zustand selbst)
    local: null,        // lokaler Engine-Zustand
    me: -1, me2: -1,    // eigene Spieler-ID(s)
    recvAt: 0, silent: false, paused: false,
    rot: 0, rot2: 0,
    room: null, localRoom: null, isLocal2P: false,
    lastPhase: '', resultShown: false, online: false
  };
  G.now = function () {
    const V = G.view; if (!V) return 0;
    if (G.mode === 'online') return V.time + Math.min(0.6, (performance.now() - G.recvAt) / 1000);
    return V.time;
  };
  const myP = () => (G.view && G.me >= 0 ? G.view.players[G.me] : null);
  const myTeam = () => { const p = myP(); return p ? p.team : -99; };

  // ------------------------------------------------------------------
  // Netzwerk
  // ------------------------------------------------------------------
  const Net = {
    ws: null, cid: store.get('cid', null), ready: false, wanted: false, retry: 0, timer: null, pending: [],
    url() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; },
    connect() {
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
      this.wanted = true;
      let ws;
      try { ws = new WebSocket(this.url()); } catch (e) { this.schedule(); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        ws.send(JSON.stringify({ t: 'hello', cid: this.cid, name: UI.name() }));
      };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onNet(m); };
      ws.onclose = () => {
        this.ready = false;
        if (this.ws === ws) this.ws = null;
        if (G.mode === 'online' || G.room) UI.toast('Verbindung unterbrochen – verbinde neu …', true);
        setServerStatus(false);
        if (this.wanted) this.schedule();
      };
      ws.onerror = () => { };
    },
    schedule() {
      clearTimeout(this.timer);
      const d = Math.min(8000, 600 * Math.pow(1.6, this.retry++));
      this.timer = setTimeout(() => this.connect(), d);
    },
    send(o) {
      if (this.ws && this.ws.readyState === 1 && this.ready) this.ws.send(JSON.stringify(o));
      else { this.pending.push(o); this.connect(); }
    },
    flush() { const p = this.pending; this.pending = []; for (const o of p) this.send(o); }
  };

  function onNet(m) {
    switch (m.t) {
      case 'hello':
        Net.cid = m.cid; store.set('cid', m.cid); Net.ready = true; setServerStatus(true);
        Net.flush();
        if (UI.autoJoin && !G.room) { const code = UI.autoJoin; UI.autoJoin = null; Net.send({ t: 'join', code, name: UI.name() }); }
        break;
      case 'room': {
        const wasIn = G.room && G.room.inGame;
        G.room = m.room;
        setUrlRoom(m.room.code);
        if (!m.room.inGame) {
          if (G.mode === 'online') { stopGame(); }
          if (!UI.isScreen('lobby') || wasIn) UI.show('lobby');
          renderLobby();
        }
        break;
      }
      case 'start':
        startOnline(m);
        break;
      case 's':
        if (G.mode !== 'online' || !G.view) return;
        G.recvAt = performance.now();
        handleEvents(E.applyTick(G.view, m));
        break;
      case 'res':
        if (m.err) feedbackError(m.err);
        break;
      case 'err':
        UI.toast(m.msg, true); Sfx.err();
        if (m.code === 'noroom') { setUrlRoom(null); }
        break;
      case 'toast':
        UI.toast(m.msg);
        break;
      case 'left':
        G.room = null; setUrlRoom(null);
        break;
      case 'pong': break;
    }
  }

  function setUrlRoom(code) {
    try {
      const u = new URL(location.href);
      if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
      history.replaceState(null, '', u.toString());
    } catch (e) { }
  }
  function roomLink(code) {
    return location.origin + location.pathname + '?room=' + encodeURIComponent(code);
  }
  function setServerStatus(ok) {
    G.online = ok;
    const st = $('#srv-status');
    if (location.protocol === 'file:') { st.textContent = 'Offline-Datei geöffnet – nur Offline-Modus verfügbar.'; $('#online-box').classList.add('off'); return; }
    st.textContent = ok ? '🟢 Server verbunden – Raum erstellen oder Code eingeben' : '🔴 Server nicht erreichbar – Offline-Modus geht immer';
    $('#online-box').classList.toggle('off', !ok);
  }

  // ------------------------------------------------------------------
  // Darstellung (2.5D-Tabletop)
  // ------------------------------------------------------------------
  const cv = $('#game');
  const ctx = cv.getContext('2d');
  const R = {
    dpr: 1, vw: 1, vh: 1, rot: 0, TS: 28, viewRef: null, key: '',
    terrain: null, ground: null, gctx: null, walls: null, wctx: null,
    builtGrid: -1, builtCastle: -1, builtZone: -1, lastBuild: 0,
    cam: { x: 0, y: 0, s: 20, tx: 0, ty: 0, ts: 20, manual: false, mode: 'fit', init: false, focus: null },
    shake: 0, parts: [], waves: [], floats: [], flags: [], foam1: null, foam2: null, sparkles: [], pcol: [], tcol: [],
    time: 0
  };
  const PHASE_LABEL = { select: 'Burg wählen', cannon: 'Kanonen aufstellen', ready: 'Bereitmachen …', battle: 'Feuer frei!', cease: 'Feuer einstellen!', build: 'Mauern reparieren', score: 'Auswertung', over: 'Spielende' };
  const PHASE_DUR = { select: E.T.SELECT, cannon: E.T.CANNON, ready: E.T.READY, battle: E.T.BATTLE, cease: E.T.CEASE, build: E.T.BUILD, score: E.T.SCORE, over: 1 };

  function resize() {
    R.vw = Math.max(1, window.innerWidth); R.vh = Math.max(1, window.innerHeight);
    R.dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4.2e6 / (R.vw * R.vh)));
    cv.width = Math.round(R.vw * R.dpr); cv.height = Math.round(R.vh * R.dpr);
    const rot = R.vh > R.vw * 1.05 ? 1 : 0;
    if (rot !== R.rot) { R.rot = rot; R.key = ''; }
    R.cam.init = false; R.cam.manual = false;
    if (G.view) computeFocus();
    const rh = $('#rotate-hint');
    rh.classList.toggle('hidden', !(rot && isTouch && G.mode !== 'attract' && G.view && !store.get('rhint', false) && UI.inGame));
    if (!rh.classList.contains('hidden')) {
      setTimeout(() => { rh.style.top = ($('#hud-players').getBoundingClientRect().bottom + 8) + 'px'; }, 50);
      clearTimeout(R.rhT); R.rhT = setTimeout(() => rh.classList.add('hidden'), 9000);
    }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  const mW = () => (R.rot ? G.view.H : G.view.W);
  const mH = () => (R.rot ? G.view.W : G.view.H);
  function w2m(x, y) { return R.rot ? [G.view.H - y, x] : [x, y]; }
  function m2w(x, y) { return R.rot ? [y, G.view.H - x] : [x, y]; }
  function rect2m(x, y, w, h) { return R.rot ? [G.view.H - y - h, x, h, w] : [x, y, w, h]; }
  function dir2m(dx, dy) { return R.rot ? [-dy, dx] : [dx, dy]; }
  function s2w(sx, sy) { return m2w((sx - R.cam.x) / R.cam.s, (sy - R.cam.y) / R.cam.s); }
  function m2s(mx, my) { return [R.cam.x + mx * R.cam.s, R.cam.y + my * R.cam.s]; }

  function viewArea() {
    let top = 8, bottom = 8;
    if (UI.inGame) {
      const landscapePhone = isTouch && R.vw > R.vh && R.vh < 560;
      if (landscapePhone) top = $('#hud-top').getBoundingClientRect().bottom - 2;
      else top = Math.max($('#hud-players').getBoundingClientRect().bottom, 48) + 4;
      const btns = !$('#hud-bottom').classList.contains('hidden');
      bottom = isTouch && !landscapePhone && btns ? 92 : isTouch ? 10 : 14;
    }
    return { x: 6, y: top, w: Math.max(50, R.vw - 12), h: Math.max(50, R.vh - top - bottom) };
  }

  function computeFocus() {
    const V = G.view; R.cam.focus = null;
    if (!V || G.me < 0) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < V.N; i++) {
      const z = V.zone[i];
      if (z === G.me || V.wall[i] === G.me || (V.occT[i] === 1 && V.castles[V.occId[i]] && V.castles[V.occId[i]].owner === G.me)) {
        const x = i % V.W, y = (i / V.W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return;
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(V.W - 1, x1 + 2); y1 = Math.min(V.H - 1, y1 + 2);
    const [mx, my, w, h] = rect2m(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    R.cam.focus = { x: mx, y: my, w, h };
  }

  function camTarget() {
    const A = viewArea();
    let bx = 0, by = 0, bw = mW(), bh = mH();
    if (R.cam.mode === 'focus' && R.cam.focus) { bx = R.cam.focus.x; by = R.cam.focus.y; bw = R.cam.focus.w; bh = R.cam.focus.h; }
    const s = Math.min(A.w / bw, A.h / bh);
    return { s, x: A.x + (A.w - bw * s) / 2 - bx * s, y: A.y + (A.h - bh * s) / 2 - by * s, fit: Math.min(A.w / mW(), A.h / mH()) };
  }
  function setCamMode(mode) {
    R.cam.mode = mode; R.cam.manual = false;
    computeFocus();
  }
  function updateCamera(dt) {
    if (!G.view) return;
    const c = R.cam, t = camTarget();
    c.fit = t.fit;
    if (!c.init) { c.x = t.x; c.y = t.y; c.s = t.s; c.init = true; }
    if (!c.manual) { c.tx = t.x; c.ty = t.y; c.ts = t.s; }
    const k = 1 - Math.exp(-dt * 7);
    c.x = lerp(c.x, c.tx, k); c.y = lerp(c.y, c.ty, k); c.s = lerp(c.s, c.ts, k);
  }
  function zoomAt(sx, sy, factor) {
    const c = R.cam;
    if (!c.manual) { c.tx = c.x; c.ty = c.y; c.ts = c.s; }
    c.manual = true;
    const ns = clamp(c.ts * factor, (c.fit || c.s) * 0.7, Math.max((c.fit || c.s) * 5, 60));
    const f = ns / c.ts;
    c.tx = sx - (sx - c.tx) * f; c.ty = sy - (sy - c.ty) * f; c.ts = ns;
    c.x = c.tx; c.y = c.ty; c.s = c.ts;
    clampCam();
  }
  function panBy(dx, dy) {
    const c = R.cam;
    if (!c.manual) { c.tx = c.x; c.ty = c.y; c.ts = c.s; }
    c.manual = true;
    c.tx += dx; c.ty += dy; c.x = c.tx; c.y = c.ty;
    clampCam();
  }
  function clampCam() {
    const c = R.cam, w = mW() * c.ts, h = mH() * c.ts, m = 70;
    const lx = Math.min(R.vw - w - m, m), hx = Math.max(R.vw - w - m, m);
    const ly = Math.min(R.vh - h - m, m), hy = Math.max(R.vh - h - m, m);
    c.tx = clamp(c.tx, lx, hx); c.ty = clamp(c.ty, ly, hy);
    c.x = c.tx; c.y = c.ty;
  }

  // ---------- Caches ----------
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const CLIFF = 0.24; // Klippenhöhe in Feldern

  function ensureCaches() {
    const V = G.view; if (!V) return;
    const t = camTarget();
    const TS = clamp(Math.ceil(t.fit * R.dpr * 1.35), 18, 40);
    const key = R.rot + '|' + TS + '|' + V.W + 'x' + V.H;
    if (R.viewRef !== V || R.key !== key) {
      R.viewRef = V; R.key = key; R.TS = TS;
      R.ground = makeCanvas(mW() * TS, mH() * TS); R.gctx = R.ground.getContext('2d');
      R.walls = makeCanvas(mW() * TS, (mH() + 1) * TS); R.wctx = R.walls.getContext('2d');
      R.SS = 6; R.shadow = makeCanvas(mW() * R.SS, (mH() + 1) * R.SS); R.sctx = R.shadow.getContext('2d');
      R.builtGrid = -1; R.builtCastle = -1; R.builtZone = V.zoneVer;
      buildStatic();
    }
    if (R.builtZone !== V.zoneVer) { R.builtZone = V.zoneVer; R.builtGrid = -1; }
    const now = performance.now();
    if ((R.builtGrid !== V.gridVer || R.builtCastle !== V.castleVer || R.builtPl !== V.playerVer) && now - R.lastBuild > 70) {
      R.builtGrid = V.gridVer; R.builtCastle = V.castleVer; R.builtPl = V.playerVer; R.lastBuild = now;
      R.pcol = V.players.map(p => p.color);
      R.tcol = []; for (let tm = 0; tm < 8; tm++) R.tcol[tm] = E.teamColor(V, tm);
      buildGround(); buildWalls();
    }
  }

  function landDistField(V) {
    const d = new Uint8Array(V.N).fill(9), q = [];
    for (let i = 0; i < V.N; i++) if (V.land[i]) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % V.W, y = (i / V.W) | 0;
      if (d[i] >= 8) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= V.W || yy >= V.H) continue;
        const j = yy * V.W + xx; if (d[j] <= d[i] + 1) continue; d[j] = d[i] + 1; q.push(j);
      }
    }
    return d;
  }

  // Weiche Masken: Landraster (1 Feld) -> hochaufgelöstes, geglättetes Feld
  function boxBlur(f, W, H, r) {
    const tmp = new Float32Array(f.length), n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const o = y * W; let acc = 0;
      for (let k = -r; k <= r; k++) acc += f[o + clamp(k, 0, W - 1)];
      for (let x = 0; x < W; x++) { tmp[o + x] = acc / n; acc += f[o + Math.min(W - 1, x + r + 1)] - f[o + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) { f[y * W + x] = acc / n; acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
    }
  }
  function landField(scale, blurTiles, passes) {
    const V = G.view, MW = mW(), MH = mH();
    const Wp = Math.round(MW * scale), Hp = Math.round(MH * scale);
    const lm = new Uint8Array(MW * MH);
    for (let i = 0; i < V.N; i++) if (V.land[i]) { const [mx, my] = rect2m(i % V.W, (i / V.W) | 0, 1, 1); lm[my * MW + mx] = 1; }
    const f = new Float32Array(Wp * Hp);
    for (let py = 0; py < Hp; py++) {
      const my = Math.min(MH - 1, (py / scale) | 0), ro = my * MW, po = py * Wp;
      for (let px = 0; px < Wp; px++) f[po + px] = lm[ro + Math.min(MW - 1, (px / scale) | 0)];
    }
    const r = Math.max(1, Math.round(blurTiles * scale));
    for (let k = 0; k < passes; k++) boxBlur(f, Wp, Hp, r);
    return { f, Wp, Hp };
  }
  function maskFromField(F, lo, hi, soft, rgb) {
    const c = makeCanvas(F.Wp, F.Hp), g = c.getContext('2d');
    const img = g.createImageData(F.Wp, F.Hp), d = img.data, f = F.f;
    for (let i = 0; i < f.length; i++) {
      const v = f[i];
      let a = (v - lo) / soft + 0.5; a = a < 0 ? 0 : a > 1 ? 1 : a;
      if (hi !== null) { let b = (hi - v) / soft + 0.5; b = b < 0 ? 0 : b > 1 ? 1 : b; if (b < a) a = b; }
      const o = i * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function tinted(mask, color, w, h) {
    const c = makeCanvas(w || mask.width, h || mask.height), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(mask, 0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function buildStatic() {
    const V = G.view, TS = R.TS, MW = mW(), MH = mH();
    const W0 = MW * TS, H0 = MH * TS;
    const dl = landDistField(V);
    // 1) Wasser (Tiefenverlauf, halbe Auflösung)
    const small = makeCanvas(MW, MH), sg = small.getContext('2d'), im = sg.createImageData(MW, MH);
    const cS = hexToRgb('#47b4cf'), cM = hexToRgb('#1d74a6'), cD = hexToRgb('#10497a');
    for (let y = 0; y < V.H; y++) for (let x = 0; x < V.W; x++) {
      const i = y * V.W + x; const [mx, my] = rect2m(x, y, 1, 1); const o = (my * MW + mx) * 4;
      const t = clamp((dl[i] - 1) / 5, 0, 1) * 0.92 + vnoise(x, y, 4, 4) * 0.08;
      const A = t < 0.45 ? cS : cM, B = t < 0.45 ? cM : cD, tt = t < 0.45 ? t / 0.45 : (t - 0.45) / 0.55;
      im.data[o] = lerp(A[0], B[0], tt); im.data[o + 1] = lerp(A[1], B[1], tt); im.data[o + 2] = lerp(A[2], B[2], tt); im.data[o + 3] = 255;
    }
    sg.putImageData(im, 0, 0);
    R.water = makeCanvas(W0 / 2, H0 / 2);
    const wg = R.water.getContext('2d'); wg.imageSmoothingEnabled = true; wg.imageSmoothingQuality = 'high';
    wg.drawImage(small, -0.5 * TS / 2, -0.5 * TS / 2, (MW + 1) * TS / 2, (MH + 1) * TS / 2);
    // 2) Geglättete Landmasken
    const FS = Math.min(TS, 18);
    const F1 = landField(FS, 0.28, 2);
    const F2 = landField(Math.max(5, FS / 3), 0.9, 2);
    const landMask = maskFromField(F1, 0.5, null, 0.07, [255, 255, 255]);
    R.landMask = landMask;
    const glow = maskFromField(F2, 0.05, null, 0.35, [150, 235, 240]);
    wg.globalAlpha = 0.42; wg.drawImage(glow, 0, CLIFF * TS / 2, R.water.width, R.water.height); wg.globalAlpha = 1;
    // Ränder weich in den Ozean auslaufen lassen
    wg.globalCompositeOperation = 'destination-in';
    const ww2 = R.water.width, wh2 = R.water.height, fe = TS * 1.2;
    const feather = makeCanvas(ww2, wh2), fg2 = feather.getContext('2d');
    fg2.fillStyle = '#fff'; fg2.fillRect(0, 0, ww2, wh2);
    fg2.globalCompositeOperation = 'destination-out';
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, fe, 0, 0, 0, fe, wh2], [ww2, 0, ww2 - fe, 0, ww2 - fe, 0, fe, wh2], [0, 0, 0, fe, 0, 0, ww2, fe], [0, wh2, 0, wh2 - fe, 0, wh2 - fe, ww2, fe]]) {
      const lgr = fg2.createLinearGradient(x0, y0, x1, y1);
      lgr.addColorStop(0, 'rgba(0,0,0,1)'); lgr.addColorStop(1, 'rgba(0,0,0,0)');
      fg2.fillStyle = lgr; fg2.fillRect(rx, ry, rw, rh);
    }
    wg.drawImage(feather, 0, 0);
    wg.globalCompositeOperation = 'source-over';
    R.foamA = maskFromField(F1, 0.07, 0.17, 0.05, [255, 255, 255]);
    R.foamB = maskFromField(F2, 0.16, 0.24, 0.05, [255, 255, 255]);
    // 3) Land: nasser Sand, Sand, Klippe, Gras
    const cliff = CLIFF * TS;
    R.land = makeCanvas(W0, H0 + Math.ceil(cliff) + 2);
    const lg = R.land.getContext('2d'); lg.imageSmoothingEnabled = true; lg.imageSmoothingQuality = 'high';
    lg.drawImage(tinted(maskFromField(F1, 0.2, null, 0.12, [255, 255, 255]), 'rgba(196,176,120,0.75)', W0, H0), 0, cliff);
    lg.drawImage(tinted(maskFromField(F1, 0.3, null, 0.06, [255, 255, 255]), '#ead7a0', W0, H0), 0, cliff * 0.9);
    lg.drawImage(tinted(landMask, '#5b3f27', W0, H0), 0, cliff);
    lg.drawImage(tinted(landMask, '#7c5a37', W0, H0), 0, cliff * 0.55);
    lg.drawImage(tinted(landMask, '#94704a', W0, H0), 0, cliff * 0.25);
    lg.drawImage(tinted(landMask, '#3d7a2b', W0, H0), 0, Math.max(1, TS * 0.06));
    const grass = makeCanvas(W0, H0), gg = grass.getContext('2d');
    paintGrass(gg, W0, H0, TS);
    gg.globalCompositeOperation = 'destination-in'; gg.imageSmoothingEnabled = true;
    gg.drawImage(landMask, 0, 0, W0, H0);
    lg.drawImage(grass, 0, 0);
    // Licht von links oben
    lg.globalCompositeOperation = 'source-atop';
    const lgt = lg.createLinearGradient(0, 0, W0, H0);
    lgt.addColorStop(0, 'rgba(255,245,200,0.10)'); lgt.addColorStop(0.5, 'rgba(255,255,255,0)'); lgt.addColorStop(1, 'rgba(10,30,60,0.12)');
    lg.fillStyle = lgt; lg.fillRect(0, 0, R.land.width, R.land.height);
    lg.globalCompositeOperation = 'source-over';
    // 4) Deko, Wellen, Wolken
    buildDecor();
    R.sparkles = [];
    for (let k = 0; k < 70; k++) {
      const x = Math.random() * V.W, y = Math.random() * V.H;
      if (dl[Math.floor(y) * V.W + Math.floor(x)] < 2) continue;
      R.sparkles.push({ x, y, ph: Math.random() * 7, sp: 0.6 + Math.random() });
    }
    if (!R.waveTex) R.waveTex = makeWaveTex();
    if (!R.cloudTex) R.cloudTex = makeCloudTex();
    R.clouds = [];
    for (let k = 0; k < 5; k++) R.clouds.push({ x: Math.random() * MW, y: Math.random() * MH, s: 9 + Math.random() * 8, sp: 0.18 + Math.random() * 0.15 });
  }

  function paintGrass(g, W0, H0, TS) {
    const V = G.view, rnd = seeded(V.W * 7919 + V.H * 31 + 17);
    const gr = g.createLinearGradient(0, 0, W0, H0);
    gr.addColorStop(0, '#7dc855'); gr.addColorStop(1, '#5ea543');
    g.fillStyle = gr; g.fillRect(0, 0, W0, H0);
    const cols = [[146, 214, 96, 0.32], [74, 146, 50, 0.32], [120, 196, 80, 0.3], [62, 128, 44, 0.26], [176, 210, 96, 0.2]];
    const tiles = W0 * H0 / (TS * TS);
    for (let k = 0; k < tiles / 3.5; k++) {
      const x = rnd() * W0, y = rnd() * H0, r = TS * (0.9 + rnd() * 2.6);
      const c = cols[(rnd() * cols.length) | 0];
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`); rg.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.lineCap = 'round';
    for (let k = 0; k < tiles * 4; k++) {
      const x = rnd() * W0, y = rnd() * H0, len = TS * (0.07 + rnd() * 0.1);
      g.strokeStyle = rnd() < 0.55 ? 'rgba(38,92,28,0.32)' : 'rgba(200,240,150,0.32)';
      g.lineWidth = Math.max(1, TS * 0.035);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * len * 0.7, y - len); g.stroke();
    }
    const fl = ['#fff7dc', '#ffd84a', '#ff9fb8', '#c9b6ff', '#ffffff'];
    for (let k = 0; k < tiles * 0.22; k++) {
      const x = rnd() * W0, y = rnd() * H0;
      g.fillStyle = fl[(rnd() * fl.length) | 0];
      g.beginPath(); g.arc(x, y, Math.max(1.2, TS * 0.055), 0, 7); g.fill();
      g.fillStyle = 'rgba(255,190,40,0.9)'; g.beginPath(); g.arc(x, y, Math.max(0.6, TS * 0.022), 0, 7); g.fill();
    }
  }

  function makeWaveTex() {
    const s = 256, c = makeCanvas(s, s), g = c.getContext('2d'), rnd = seeded(4242);
    g.lineCap = 'round';
    for (let k = 0; k < 70; k++) {
      const x = rnd() * s, y = rnd() * s, L = 14 + rnd() * 26, a = 0.25 + rnd() * 0.4;
      g.strokeStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; g.lineWidth = 1.5 + rnd() * 1.8;
      for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
        g.beginPath(); g.moveTo(x + dx - L / 2, y + dy); g.quadraticCurveTo(x + dx, y + dy - 5, x + dx + L / 2, y + dy); g.stroke();
      }
    }
    return c;
  }
  function makeCloudTex() {
    const c = makeCanvas(256, 180), g = c.getContext('2d'), rnd = seeded(99);
    for (let k = 0; k < 9; k++) {
      const x = 50 + rnd() * 156, y = 50 + rnd() * 80, r = 35 + rnd() * 40;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(10,25,45,0.55)'); rg.addColorStop(1, 'rgba(10,25,45,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    return c;
  }

  function buildDecor() {
    const V = G.view, rnd = seeded(V.W * 13 + V.H * 7 + 99);
    R.decor = [];
    const near = new Uint8Array(V.N);
    for (const c of V.castles) for (let y = c.y - 3; y <= c.y + 4; y++) for (let x = c.x - 3; x <= c.x + 4; x++) if (x >= 0 && y >= 0 && x < V.W && y < V.H) near[y * V.W + x] = 1;
    for (let i = 0; i < V.N; i++) {
      if (!V.land[i] || near[i]) continue;
      const x = i % V.W, y = (i / V.W) | 0;
      const forest = vnoise(x, y, 4.2, 21);
      let p = forest > 0.66 ? 0.6 : forest > 0.56 ? 0.2 : 0.035;
      if (V.zone[i] === 255) p *= 0.35;
      const r = rnd();
      if (r < p) {
        const k = rnd() < 0.4 ? 'pine' : rnd() < 0.82 ? 'tree' : 'bush';
        R.decor.push({ i, x: x + 0.25 + rnd() * 0.5, y: y + 0.45 + rnd() * 0.4, k, s: 0.75 + rnd() * 0.4, v: rnd() });
      } else if (r < p + 0.03) R.decor.push({ i, x: x + 0.3 + rnd() * 0.4, y: y + 0.55 + rnd() * 0.3, k: 'rock', s: 0.5 + rnd() * 0.5, v: rnd() });
    }
  }

  function cobbleCanvas(TS) {
    if (R.cobble && R.cobbleTS === TS) return R.cobble;
    const s = Math.max(40, Math.round(TS * 2)), c = makeCanvas(s, s), g = c.getContext('2d'), rnd = seeded(77);
    g.fillStyle = '#8f8572'; g.fillRect(0, 0, s, s);
    const n = 5, cell = s / n;
    const stones = [];
    for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
      stones.push({ x: xx * cell + (yy % 2) * cell * 0.5 + cell * 0.5 + (rnd() - 0.5) * cell * 0.12, y: yy * cell + cell * 0.5 + (rnd() - 0.5) * cell * 0.12, sh: rnd(), rx: cell * (0.4 + rnd() * 0.06), ry: cell * (0.36 + rnd() * 0.06) });
    }
    for (const st of stones) for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
      const x = st.x + dx, y = st.y + dy;
      if (x < -cell || y < -cell || x > s + cell || y > s + cell) continue;
      g.fillStyle = mix('#b9ae96', '#d6ccb6', st.sh);
      g.beginPath(); g.ellipse(x, y, st.rx, st.ry, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.ellipse(x - st.rx * 0.2, y - st.ry * 0.25, st.rx * 0.55, st.ry * 0.4, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(60,45,30,0.18)';
      g.beginPath(); g.ellipse(x + st.rx * 0.1, y + st.ry * 0.55, st.rx * 0.8, st.ry * 0.25, 0, 0, 7); g.fill();
    }
    R.cobble = c; R.cobbleTS = TS;
    return c;
  }

  function flagCanvas(TS) {
    if (R.flagc && R.flagTS === TS) return R.flagc;
    const s0 = Math.max(32, Math.round(TS * 1.5)), c = makeCanvas(s0, s0), g = c.getContext('2d'), rnd = seeded(5);
    g.fillStyle = '#8f846c'; g.fillRect(0, 0, s0, s0);
    const rows = 3, rh = s0 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -(r % 2) * s0 * 0.25;
      while (x < s0) {
        const w = s0 * (0.28 + rnd() * 0.22);
        const tone = 0.85 + rnd() * 0.25;
        const col = 'rgb(' + Math.round(214 * tone) + ',' + Math.round(203 * tone) + ',' + Math.round(178 * tone) + ')';
        for (const dx of [-s0, 0, s0]) {
          g.fillStyle = col; g.fillRect(x + dx + 1, r * rh + 1, w - 2, rh - 2);
          g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + dx + 1, r * rh + 1, w - 2, Math.max(1, rh * 0.12));
        }
        x += w;
      }
    }
    R.flagc = c; R.flagTS = TS;
    return c;
  }

  function buildGround() {
    const V = G.view, TS = R.TS, g = R.gctx;
    g.clearRect(0, 0, R.ground.width, R.ground.height);
    const W = V.W, H = V.H;
    // Burghöfe: Pflaster + Teamfarbe
    const pat = g.createPattern(cobbleCanvas(TS), 'repeat');
    g.fillStyle = pat;
    for (let i = 0; i < V.N; i++) {
      if (V.terr[i] < 0) continue;
      const [mx, my] = rect2m(i % W, (i / W) | 0, 1, 1);
      g.fillRect(mx * TS, my * TS, TS + 0.5, TS + 0.5);
    }
    for (let i = 0; i < V.N; i++) {
      const t = V.terr[i]; if (t < 0) continue;
      const [mx, my] = rect2m(i % W, (i / W) | 0, 1, 1);
      g.fillStyle = rgba(R.tcol[t] || '#ffffff', 0.18);
      g.fillRect(mx * TS, my * TS, TS + 0.5, TS + 0.5);
    }
    // weicher Innenrand in Teamfarbe
    for (let i = 0; i < V.N; i++) {
      const t = V.terr[i]; if (t < 0) continue;
      const x = i % W, y = (i / W) | 0;
      const [mx, my] = rect2m(x, y, 1, 1);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && V.terr[yy * W + xx] === t) continue;
        const [mdx, mdy] = dir2m(dx, dy);
        const px = mx * TS, py = my * TS, d = TS * 0.45;
        let gr;
        if (mdx === 1) gr = g.createLinearGradient(px + TS, 0, px + TS - d, 0);
        else if (mdx === -1) gr = g.createLinearGradient(px, 0, px + d, 0);
        else if (mdy === 1) gr = g.createLinearGradient(0, py + TS, 0, py + TS - d);
        else gr = g.createLinearGradient(0, py, 0, py + d);
        gr.addColorStop(0, rgba(R.tcol[t] || '#ffffff', 0.55)); gr.addColorStop(1, rgba(R.tcol[t] || '#ffffff', 0));
        g.fillStyle = gr; g.fillRect(px, py, TS + 0.5, TS + 0.5);
      }
    }
    // Zonengrenzen (dezent)
    g.setLineDash([TS * 0.2, TS * 0.22]); g.lineWidth = Math.max(1, TS * 0.05); g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineCap = 'round';
    g.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!V.land[i] || V.terr[i] >= 0) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const xx = x + dx, yy = y + dy; if (xx >= W || yy >= H) continue;
        const j = yy * W + xx; if (!V.land[j] || V.zone[j] === V.zone[i] || V.terr[j] >= 0) continue;
        const ax = dx ? x + 1 : x, ay = dx ? y : y + 1, bx = x + 1, by = y + 1;
        const [m1x, m1y] = w2m(ax, ay), [m2x, m2y] = w2m(bx, by);
        g.moveTo(m1x * TS, m1y * TS); g.lineTo(m2x * TS, m2y * TS);
      }
    }
    g.stroke(); g.setLineDash([]);
    // Krater & Brandstellen
    for (let i = 0; i < V.N; i++) {
      if (!V.crater[i] && !V.fire[i]) continue;
      const x = i % W, y = (i / W) | 0;
      const [mx, my] = rect2m(x, y, 1, 1);
      const cx = (mx + 0.5) * TS, cy = (my + 0.5) * TS;
      if (V.fire[i]) {
        const fg = g.createRadialGradient(cx, cy, 0, cx, cy, TS * 0.75);
        fg.addColorStop(0, 'rgba(20,14,10,0.9)'); fg.addColorStop(0.7, 'rgba(40,28,18,0.6)'); fg.addColorStop(1, 'rgba(40,28,18,0)');
        g.fillStyle = fg; g.beginPath(); g.arc(cx, cy, TS * 0.75, 0, 7); g.fill();
      }
      if (V.crater[i]) {
        const gr = g.createRadialGradient(cx, cy, TS * 0.04, cx, cy, TS * 0.6);
        gr.addColorStop(0, 'rgba(28,18,10,0.95)'); gr.addColorStop(0.45, 'rgba(62,44,26,0.8)'); gr.addColorStop(0.75, 'rgba(110,85,52,0.45)'); gr.addColorStop(1, 'rgba(110,85,52,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, TS * 0.6, TS * 0.5, 0, 0, 7); g.fill();
        g.strokeStyle = 'rgba(190,160,115,0.45)'; g.lineWidth = Math.max(1, TS * 0.05);
        g.beginPath(); g.ellipse(cx, cy - TS * 0.03, TS * 0.34, TS * 0.27, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.fillStyle = 'rgba(120,110,95,0.85)';
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + (hash(i, 40 + k) - 0.5) * TS * 0.9, cy + (hash(i, 50 + k) - 0.5) * TS * 0.75, TS * (0.04 + hash(i, 60 + k) * 0.04), 0, 7); g.fill(); }
      }
    }
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingEnabled = true;
    g.drawImage(R.landMask, 0, 0, R.ground.width, R.ground.height);
    g.globalCompositeOperation = 'source-over';
  }

  function wallAtM(mx, my) {
    const V = G.view;
    const [x, y] = m2w(mx + 0.5, my + 0.5);
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= V.W || yi >= V.H) return false;
    return V.wall[yi * V.W + xi] >= 0;
  }

  function buildWalls() {
    const V = G.view, TS = R.TS, g = R.wctx, OY = TS, SS = R.SS, sg = R.sctx;
    g.clearRect(0, 0, R.walls.width, R.walls.height);
    sg.clearRect(0, 0, R.shadow.width, R.shadow.height);
    sg.fillStyle = '#000';
    const items = [];
    for (let i = 0; i < V.N; i++) {
      if (V.wall[i] < 0) continue;
      const x = i % V.W, y = (i / V.W) | 0;
      const [mx, my] = rect2m(x, y, 1, 1);
      items.push({ k: 0, mx, my, sy: my + 0.8, i });
      sg.fillRect((mx + 0.22) * SS, (my + 0.2) * SS + SS, 0.9 * SS, 0.95 * SS);
    }
    for (const c of V.castles) {
      const [mx, my] = rect2m(c.x, c.y, 2, 2);
      items.push({ k: 1, mx, my, sy: my + 1.6, c });
      sg.beginPath(); sg.ellipse((mx + 1.35) * SS, (my + 1.75) * SS + SS, 1.2 * SS, 0.65 * SS, 0, 0, 7); sg.fill();
    }
    for (const d of R.decor || []) {
      const i = d.i;
      if (V.wall[i] >= 0 || V.occT[i] || V.crater[i] || V.fire[i] || V.terr[i] >= 0) continue;
      const [mx, my] = w2m(d.x, d.y);
      items.push({ k: 2, mx, my, sy: my, d });
      if (d.k !== 'rock') { sg.beginPath(); sg.ellipse((mx + 0.28 * d.s) * SS, (my + 0.05) * SS + SS, 0.42 * d.s * SS, 0.2 * d.s * SS, 0, 0, 7); sg.fill(); }
    }
    items.sort((a, b) => a.sy - b.sy || a.mx - b.mx);
    R.flags = [];
    for (const it of items) {
      if (it.k === 0) drawWallTile(g, it.mx, it.my, it.i, TS, OY);
      else if (it.k === 1) drawCastle(g, it.mx, it.my, it.c, TS, OY);
      else drawDecor(g, it.mx, it.my, it.d, TS, OY);
    }
  }

  const WALL_W = 0.64, WALL_H = 0.46;
  function drawWallTile(g, mx, my, i, TS, OY) {
    const V = G.view;
    const owner = V.wall[i], hp = V.whp[i];
    const col = R.pcol[owner] || '#888888';
    const e = wallAtM(mx + 1, my), w = wallAtM(mx - 1, my), s = wallAtM(mx, my + 1), n = wallAtM(mx, my - 1);
    const ne = wallAtM(mx + 1, my - 1), nw = wallAtM(mx - 1, my - 1), se = wallAtM(mx + 1, my + 1), sw = wallAtM(mx - 1, my + 1);
    const bast = hp >= 2;
    const ww = WALL_W, a = (1 - ww) / 2, h = WALL_H, ins = 0.13;
    const X = mx * TS, Y = my * TS + OY;
    const topC = bast ? mix('#aab2bd', col, 0.12) : mix('#e6ddc8', col, 0.14), sideC = bast ? '#646c77' : '#ab9f84', sideD = bast ? '#4a5059' : '#857a63', walkC = bast ? mix('#8d96a2', col, 0.15) : mix('#cfc3a8', col, 0.18);
    const shapes = [{ x: a, y: a, w: ww, h: ww, o: 'c' }];
    if (e) shapes.push({ x: 0.5, y: a, w: 0.5, h: ww, o: 'h' });
    if (w) shapes.push({ x: 0, y: a, w: 0.5, h: ww, o: 'h' });
    if (s) shapes.push({ x: a, y: 0.5, w: ww, h: 0.5, o: 'v' });
    if (n) shapes.push({ x: a, y: 0, w: ww, h: 0.5, o: 'v' });
    const qne = n && e && ne, qnw = n && w && nw, qse = s && e && se, qsw = s && w && sw;
    if (qne) shapes.push({ x: 0.5, y: 0, w: 0.5, h: 0.5, o: 'q' });
    if (qnw) shapes.push({ x: 0, y: 0, w: 0.5, h: 0.5, o: 'q' });
    if (qse) shapes.push({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, o: 'q' });
    if (qsw) shapes.push({ x: 0, y: 0.5, w: 0.5, h: 0.5, o: 'q' });
    const diag = [];
    if (ne && !n && !e) diag.push([1, -1]);
    if (nw && !n && !w) diag.push([-1, -1]);
    if (se && !s && !e) diag.push([1, 1]);
    if (sw && !s && !w) diag.push([-1, 1]);
    const fr = (x, y, w0, h0) => g.fillRect(X + x * TS, Y + y * TS, w0 * TS + 0.7, h0 * TS + 0.7);
    const diagPoly = (dx, dy, off, shrink) => {
      const ux = dx / Math.SQRT2, uy = dy / Math.SQRT2, hw = ww / 2 - (shrink || 0);
      const px = -uy * hw, py = ux * hw, L = 0.78;
      g.beginPath();
      g.moveTo(X + (0.5 + px) * TS, Y + (0.5 + py + off) * TS);
      g.lineTo(X + (0.5 + ux * L + px) * TS, Y + (0.5 + uy * L + py + off) * TS);
      g.lineTo(X + (0.5 + ux * L - px) * TS, Y + (0.5 + uy * L - py + off) * TS);
      g.lineTo(X + (0.5 - px) * TS, Y + (0.5 - py + off) * TS);
      g.closePath(); g.fill();
    };
    // Seitenflächen (vom Boden bis zur Krone)
    g.fillStyle = sideC;
    for (const r of shapes) fr(r.x, r.y - h, r.w, r.h + h);
    for (const [dx, dy] of diag) for (const off of [0, -h * 0.25, -h * 0.5, -h * 0.75, -h]) diagPoly(dx, dy, off);
    // Mauerwerk-Fugen, dunkle Fußkante und Teamband
    for (const r of shapes) {
      const bottom = r.y + r.h;
      g.fillStyle = 'rgba(0,0,0,0.10)'; fr(r.x, bottom - h * 0.5, r.w, 0.025);
      g.fillStyle = sideD; fr(r.x, bottom - 0.07, r.w, 0.07);
      g.fillStyle = col; fr(r.x, bottom - h * 0.42, r.w, h * 0.24);
      g.fillStyle = 'rgba(255,255,255,0.2)'; fr(r.x, bottom - h * 0.42, r.w, h * 0.05);
    }
    for (const [dx, dy] of diag) { g.fillStyle = col; diagPoly(dx, dy, -h * 0.25, 0.02); }
    // Krone
    g.fillStyle = topC;
    for (const r of shapes) fr(r.x, r.y - h, r.w, r.h);
    for (const [dx, dy] of diag) diagPoly(dx, dy, -h);
    // Wehrgang (vertieft, Steinplatten) – verbindet sich mit den Armen
    if (!R.flagPat || R.flagPatTS !== TS) { R.flagPat = g.createPattern(flagCanvas(TS), 'repeat'); R.flagPatTS = TS; }
    const walkRects = [];
    for (const r of shapes) {
      let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
      if (r.o === 'h') {
        const east = r.x >= 0.5;
        if (!(east ? qne : qnw)) y0 += ins;
        if (!(east ? qse : qsw)) y1 -= ins;
      } else if (r.o === 'v') {
        const south = r.y >= 0.5;
        if (!(south ? qsw : qnw)) x0 += ins;
        if (!(south ? qse : qne)) x1 -= ins;
      } else if (r.o === 'c') {
        if (!w) x0 += ins; if (!e) x1 -= ins; if (!n) y0 += ins; if (!s) y1 -= ins;
      }
      walkRects.push([x0, y0 - h, x1 - x0, y1 - y0]);
    }
    g.fillStyle = R.flagPat; for (const q of walkRects) fr(q[0], q[1], q[2], q[3]);
    g.fillStyle = bast ? 'rgba(40,46,56,0.45)' : rgba(col, 0.13); for (const q of walkRects) fr(q[0], q[1], q[2], q[3]);
    for (const [dx, dy] of diag) { g.fillStyle = walkC; diagPoly(dx, dy, -h, ins); }
    // Zinnen auf den Außenkanten
    const ml = 0.17, mh = 0.11;
    const merlon = (x, y, w0, d0) => {
      g.fillStyle = sideC; fr(x, y - h - mh, w0, d0 + mh);
      g.fillStyle = topC; fr(x, y - h - mh, w0, d0);
      g.fillStyle = 'rgba(255,255,255,0.35)'; fr(x, y - h - mh, w0, 0.025);
    };
    const runX = (x0, x1, y) => { for (let p = x0 + 0.08; p + ml <= x1 + 0.001; p += 0.5) merlon(p, y, ml, ins); };
    const runY = (y0, y1, x) => { for (let p = y0 + 0.08; p + ml <= y1 + 0.001; p += 0.5) merlon(x, p, ins, ml); };
    for (const r of shapes) {
      if (r.o === 'q') continue;
      if (r.o === 'h') { const east = r.x >= 0.5; if (!(east ? qne : qnw)) runX(r.x, r.x + r.w, r.y); if (!(east ? qse : qsw)) runX(r.x, r.x + r.w, r.y + r.h - ins); }
      else if (r.o === 'v') { const south = r.y >= 0.5; if (!(south ? qsw : qnw)) runY(r.y, r.y + r.h, r.x); if (!(south ? qse : qne)) runY(r.y, r.y + r.h, r.x + r.w - ins); }
      else {
        if (!n) runX(a, a + ww, a); if (!s) runX(a, a + ww, a + ww - ins);
        if (!w && !(n || s)) runY(a, a + ww, a); if (!e && !(n || s)) runY(a, a + ww, a + ww - ins);
        if (n || s) { if (!w) runY(a, a + ww, a); if (!e) runY(a, a + ww, a + ww - ins); }
      }
    }
    if (bast) {
      g.fillStyle = 'rgba(35,40,48,0.85)';
      for (const [ax, ay] of [[0.32, 0.32], [0.68, 0.32], [0.32, 0.68], [0.68, 0.68]]) { g.beginPath(); g.arc(X + ax * TS, Y + (ay - h) * TS, TS * 0.045, 0, 7); g.fill(); }
    }
    // Ecktürme an Ecken und Kreuzungen
    const cnt = (e ? 1 : 0) + (w ? 1 : 0) + (s ? 1 : 0) + (n ? 1 : 0);
    const corner = cnt === 2 && ((n && e && !ne) || (n && w && !nw) || (s && e && !se) || (s && w && !sw));
    if (corner) drawTower(g, X + 0.5 * TS, Y + 0.62 * TS, 0.36 * TS, (h + 0.24) * TS, topC, sideC, sideD, col, TS, null);
  }

  function drawTower(g, cx, by, r, ht, topC, sideC, sideD, col, TS, roofC, roofH) {
    const ry = r * 0.5;
    const grd = g.createLinearGradient(cx - r, 0, cx + r, 0);
    grd.addColorStop(0, shade(sideC.startsWith('#') ? sideC : '#ab9f84', 0.18)); grd.addColorStop(0.55, sideC); grd.addColorStop(1, sideD);
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(cx, by, r, ry, 0, 0, Math.PI); g.lineTo(cx - r, by - ht); g.lineTo(cx + r, by - ht); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(cx - r, by - ht * 0.5, r * 2, Math.max(1, TS * 0.025));
    g.fillStyle = col; g.fillRect(cx - r, by - ht + ht * 0.2, r * 2, Math.max(1.5, TS * 0.08));
    if (roofC) {
      const rh = roofH || r * 2.2;
      g.fillStyle = roofC;
      g.beginPath(); g.moveTo(cx - r * 1.18, by - ht); g.lineTo(cx, by - ht - rh); g.lineTo(cx + r * 1.18, by - ht); g.quadraticCurveTo(cx, by - ht + ry * 1.2, cx - r * 1.18, by - ht); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.moveTo(cx, by - ht - rh); g.lineTo(cx + r * 1.18, by - ht); g.quadraticCurveTo(cx + r * 0.6, by - ht + ry * 0.9, cx + r * 0.15, by - ht + ry * 0.6); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.beginPath(); g.moveTo(cx, by - ht - rh); g.lineTo(cx - r * 1.18, by - ht); g.lineTo(cx - r * 0.75, by - ht + ry * 0.2); g.closePath(); g.fill();
      return by - ht - rh;
    }
    g.fillStyle = topC; g.beginPath(); g.ellipse(cx, by - ht, r, ry, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(110,95,70,0.35)'; g.beginPath(); g.ellipse(cx, by - ht + ry * 0.1, r * 0.66, ry * 0.62, 0, 0, 7); g.fill();
    for (let k = 0; k < 8; k += 2) {
      const an = k / 8 * Math.PI * 2 + 0.3;
      const mx2 = cx + Math.cos(an) * r * 0.86, my2 = by - ht + Math.sin(an) * ry * 0.86;
      g.fillStyle = sideC; g.fillRect(mx2 - r * 0.17, my2 - TS * 0.1, r * 0.34, TS * 0.12);
      g.fillStyle = topC; g.fillRect(mx2 - r * 0.17, my2 - TS * 0.1, r * 0.34, TS * 0.05);
    }
    return by - ht;
  }

  function drawCastle(g, mx, my, c, TS, OY) {
    const col = c.owner >= 0 && R.pcol[c.owner] ? R.pcol[c.owner] : '#7f8b97';
    const roofC = c.citadel ? '#f2b01e' : (c.owner >= 0 ? col : '#6f7c88');
    const X = mx * TS, Y = my * TS + OY, S = TS;
    const topC = c.citadel ? '#f1e8d2' : '#e6ddc8', sideC = '#ab9f84', sideD = '#857a63';
    // Plattform
    const ph = 0.2;
    g.fillStyle = sideD; g.fillRect(X + 0.06 * S, Y + 0.3 * S, 1.88 * S, 1.62 * S);
    g.fillStyle = sideC; g.fillRect(X + 0.06 * S, Y + 0.3 * S, 1.88 * S, 1.5 * S);
    g.fillStyle = '#cfc4ab'; g.fillRect(X + 0.06 * S, Y + (0.3 - ph) * S, 1.88 * S, 1.6 * S - 0.12 * S);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(X + 0.06 * S, Y + (0.3 - ph) * S, 1.88 * S, Math.max(1, S * 0.04));
    // hintere Türme
    drawTower(g, X + 0.36 * S, Y + 0.62 * S, 0.3 * S, 0.95 * S, topC, sideC, sideD, col, S, roofC, 0.62 * S);
    drawTower(g, X + 1.64 * S, Y + 0.62 * S, 0.3 * S, 0.95 * S, topC, sideC, sideD, col, S, roofC, 0.62 * S);
    // Bergfried
    const kx = X + 0.52 * S, kw = 0.96 * S, kb = Y + 1.5 * S, kh = 1.2 * S, kd = 0.55 * S;
    const kg = g.createLinearGradient(kx, 0, kx + kw, 0);
    kg.addColorStop(0, '#c9bd9f'); kg.addColorStop(1, '#a39478');
    g.fillStyle = kg; g.fillRect(kx, kb - kh, kw, kh);
    g.fillStyle = topC; g.fillRect(kx, kb - kh - kd, kw, kd);
    g.fillStyle = 'rgba(110,95,70,0.3)'; g.fillRect(kx + kw * 0.12, kb - kh - kd * 0.82, kw * 0.76, kd * 0.64);
    for (let k = 0; k < 4; k++) {
      const zx = kx + k * kw / 4 + kw * 0.04;
      g.fillStyle = sideC; g.fillRect(zx, kb - kh - S * 0.13, kw / 4 * 0.58, S * 0.15);
      g.fillStyle = topC; g.fillRect(zx, kb - kh - S * 0.13, kw / 4 * 0.58, S * 0.06);
    }
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let k = 1; k < 4; k++) g.fillRect(kx, kb - kh + k * kh / 4, kw, Math.max(1, S * 0.02));
    // Tor
    g.fillStyle = '#3a2a17';
    g.beginPath(); g.moveTo(X + S - S * 0.17, kb); g.lineTo(X + S - S * 0.17, kb - S * 0.3); g.arc(X + S, kb - S * 0.3, S * 0.17, Math.PI, 0); g.lineTo(X + S + S * 0.17, kb); g.fill();
    g.strokeStyle = 'rgba(255,220,150,0.25)'; g.lineWidth = Math.max(1, S * 0.03);
    g.beginPath(); g.arc(X + S, kb - S * 0.3, S * 0.19, Math.PI, 0); g.stroke();
    // Banner am Bergfried
    const bc = c.owner >= 0 ? col : '#e9edf2';
    g.fillStyle = bc;
    const bx = X + S * 0.66, bw = S * 0.18, btop = kb - kh + S * 0.1, blen = S * 0.55;
    for (const ox of [0, S * 0.5]) {
      g.beginPath(); g.moveTo(bx + ox, btop); g.lineTo(bx + ox + bw, btop); g.lineTo(bx + ox + bw, btop + blen); g.lineTo(bx + ox + bw / 2, btop + blen - bw * 0.5); g.lineTo(bx + ox, btop + blen); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(bx + ox, btop, bw * 0.3, blen * 0.85); g.fillStyle = bc;
    }
    if (c.citadel) {
      g.fillStyle = '#f2c14e'; g.strokeStyle = '#7a5208'; g.lineWidth = Math.max(1, S * 0.04);
      star(g, X + S, kb - kh * 0.62, S * 0.16, S * 0.07); g.fill(); g.stroke();
    }
    // vordere Türme
    drawTower(g, X + 0.34 * S, Y + 1.72 * S, 0.3 * S, 0.8 * S, topC, sideC, sideD, col, S, roofC, 0.55 * S);
    drawTower(g, X + 1.66 * S, Y + 1.72 * S, 0.3 * S, 0.8 * S, topC, sideC, sideD, col, S, roofC, 0.55 * S);
    R.flags.push({ c, mx: (X + S) / TS, my: (kb - kh - kd * 0.5 - OY) / TS });
  }
  function star(g, x, y, r1, r2) {
    g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? r2 : r1; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.closePath();
  }

  function drawDecor(g, mx, my, d, TS, OY) {
    const X = mx * TS, Y = my * TS + OY, s = d.s * TS;
    if (d.k === 'rock') {
      g.fillStyle = '#7d7f84'; g.beginPath(); g.ellipse(X, Y, s * 0.32, s * 0.2, 0, 0, 7); g.fill();
      g.fillStyle = '#a3a6ab'; g.beginPath(); g.ellipse(X - s * 0.06, Y - s * 0.07, s * 0.22, s * 0.13, 0, 0, 7); g.fill();
      return;
    }
    if (d.k === 'bush') {
      g.fillStyle = '#356f2c'; g.beginPath(); g.arc(X - s * 0.12, Y - s * 0.12, s * 0.2, 0, 7); g.arc(X + s * 0.12, Y - s * 0.1, s * 0.18, 0, 7); g.fill();
      g.fillStyle = '#4f9440'; g.beginPath(); g.arc(X - s * 0.1, Y - s * 0.18, s * 0.13, 0, 7); g.fill();
      return;
    }
    g.fillStyle = '#6a4a2c'; g.fillRect(X - s * 0.05, Y - s * 0.28, s * 0.1, s * 0.3);
    if (d.k === 'pine') {
      const cols = d.v < 0.5 ? ['#2c6a3a', '#3a8447', '#4c9b55'] : ['#2d6236', '#3b7a40', '#4f9249'];
      for (let k = 0; k < 3; k++) {
        const yb = Y - s * (0.2 + k * 0.24), wdt = s * (0.36 - k * 0.08);
        g.fillStyle = cols[k];
        g.beginPath(); g.moveTo(X - wdt, yb); g.lineTo(X, yb - s * 0.42); g.lineTo(X + wdt, yb); g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath(); g.moveTo(X, yb - s * 0.42); g.lineTo(X + wdt, yb); g.lineTo(X + wdt * 0.15, yb); g.closePath(); g.fill();
      }
      return;
    }
    const base = d.v < 0.33 ? '#3f8a3a' : d.v < 0.66 ? '#4a943e' : '#5b9a38';
    g.fillStyle = shade(base, -0.25); g.beginPath(); g.arc(X + s * 0.05, Y - s * 0.5, s * 0.38, 0, 7); g.fill();
    g.fillStyle = base; g.beginPath(); g.arc(X - s * 0.04, Y - s * 0.56, s * 0.34, 0, 7); g.arc(X + s * 0.16, Y - s * 0.62, s * 0.24, 0, 7); g.fill();
    g.fillStyle = shade(base, 0.25); g.beginPath(); g.arc(X - s * 0.12, Y - s * 0.68, s * 0.17, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(X - s * 0.16, Y - s * 0.74, s * 0.07, 0, 7); g.fill();
  }

  // ---------- Partikel & Effekte ----------
  function addP(p) { if (R.parts.length > 650) R.parts.splice(0, 50); R.parts.push(p); }
  function rndr(a, b) { return a + Math.random() * (b - a); }
  function burst(wx, wy, kind, opt) {
    if (!G.view) return;
    const [x, y] = w2m(wx, wy);
    const o = opt || {};
    const col = o.color || '#c9bba0';
    if (kind === 'explosion' || kind === 'big') {
      const big = kind === 'big';
      addP({ t: 'flash', x, y, z: 0.2, life: 0.22, max: 0.22, r: big ? 1.9 : 1.1 });
      addP({ t: 'ring', x, y, z: 0, life: 0.45, max: 0.45, r: big ? 2.6 : 1.5, c: 'rgba(255,240,200,' });
      for (let k = 0; k < (big ? 18 : 10); k++) addP({ t: 'spark', x, y, z: 0.3, vx: rndr(-3, 3), vy: rndr(-3, 3), vz: rndr(1, 4), life: rndr(0.3, 0.7), max: 0.7, c: Math.random() < 0.5 ? '#ffd56a' : '#ff8a3d' });
      for (let k = 0; k < (big ? 14 : 8); k++) addP({ t: 'debris', x, y, z: 0.3, vx: rndr(-2.4, 2.4), vy: rndr(-2.4, 2.4), vz: rndr(2, 5), life: rndr(0.8, 1.4), max: 1.4, c: k % 3 ? col : '#6b6152', s: rndr(0.08, 0.17) });
      for (let k = 0; k < (big ? 8 : 4); k++) addP({ t: 'smoke', x: x + rndr(-0.3, 0.3), y: y + rndr(-0.3, 0.3), z: 0.3, vx: rndr(-0.3, 0.3), vy: rndr(-0.3, 0.3), vz: rndr(0.4, 1), life: rndr(1, 1.8), max: 1.8, r: rndr(0.3, 0.6), c: big ? 50 : 90 });
    } else if (kind === 'dirt') {
      addP({ t: 'flash', x, y, z: 0.1, life: 0.12, max: 0.12, r: 0.7 });
      for (let k = 0; k < 9; k++) addP({ t: 'debris', x, y, z: 0.1, vx: rndr(-1.8, 1.8), vy: rndr(-1.8, 1.8), vz: rndr(1.5, 4), life: rndr(0.6, 1.1), max: 1.1, c: k % 2 ? '#6e5236' : '#4f3a24', s: rndr(0.06, 0.13) });
      for (let k = 0; k < 3; k++) addP({ t: 'smoke', x, y, z: 0.2, vx: rndr(-0.3, 0.3), vy: rndr(-0.3, 0.3), vz: rndr(0.3, 0.8), life: rndr(0.8, 1.3), max: 1.3, r: rndr(0.25, 0.45), c: 120 });
    } else if (kind === 'splash') {
      addP({ t: 'ring', x, y, z: 0, life: 0.6, max: 0.6, r: 1.2, c: 'rgba(230,250,255,' });
      for (let k = 0; k < 14; k++) addP({ t: 'drop', x, y, z: 0.1, vx: rndr(-1.2, 1.2), vy: rndr(-1.2, 1.2), vz: rndr(2.5, 5.5), life: rndr(0.5, 0.9), max: 0.9, s: rndr(0.05, 0.1) });
    } else if (kind === 'sparks') {
      for (let k = 0; k < 10; k++) addP({ t: 'spark', x, y, z: 0.4, vx: rndr(-2.5, 2.5), vy: rndr(-2.5, 2.5), vz: rndr(1, 3), life: rndr(0.25, 0.5), max: 0.5, c: '#ffe08a' });
      addP({ t: 'smoke', x, y, z: 0.3, vx: 0, vy: 0, vz: 0.6, life: 0.9, max: 0.9, r: 0.35, c: 110 });
    } else if (kind === 'fire') {
      addP({ t: 'flash', x, y, z: 0.2, life: 0.3, max: 0.3, r: 1.6, c: 'rgba(255,140,40,' });
      for (let k = 0; k < 26; k++) addP({ t: 'ember', x: x + rndr(-1, 1), y: y + rndr(-1, 1), z: 0.2, vx: rndr(-0.8, 0.8), vy: rndr(-0.8, 0.8), vz: rndr(1, 3), life: rndr(0.6, 1.4), max: 1.4 });
    } else if (kind === 'puff') {
      addP({ t: 'smoke', x, y, z: 0.4, vx: rndr(-0.2, 0.2), vy: rndr(-0.2, 0.2), vz: 0.8, life: 0.7, max: 0.7, r: 0.3, c: 200 });
    } else if (kind === 'gold') {
      addP({ t: 'ring', x, y, z: 0.3, life: 0.6, max: 0.6, r: 1.4, c: 'rgba(255,215,90,' });
      for (let k = 0; k < 16; k++) addP({ t: 'spark', x, y, z: 0.5, vx: rndr(-2, 2), vy: rndr(-2, 2), vz: rndr(2, 4), life: rndr(0.5, 0.9), max: 0.9, c: k % 2 ? '#ffd84a' : '#fff6c0' });
    } else if (kind === 'dust') {
      for (let k = 0; k < 4; k++) addP({ t: 'smoke', x: x + rndr(-0.4, 0.4), y: y + rndr(-0.2, 0.4), z: 0.05, vx: rndr(-0.6, 0.6), vy: rndr(-0.2, 0.3), vz: 0.2, life: 0.55, max: 0.55, r: 0.22, c: 210 });
    } else if (kind === 'muzzle') {
      addP({ t: 'flash', x, y, z: 0.5, life: 0.1, max: 0.1, r: 0.6 });
      for (let k = 0; k < 3; k++) addP({ t: 'smoke', x, y, z: 0.5, vx: rndr(-0.4, 0.4), vy: rndr(-0.4, 0.4), vz: rndr(0.4, 0.9), life: rndr(0.6, 1), max: 1, r: rndr(0.25, 0.4), c: 225 });
    }
  }
  function shakeAt(wx, wy, amount) {
    const p = myP();
    let f = 0.35;
    if (p && p.home >= 0) {
      const c = G.view.castles[p.home];
      const d = Math.hypot(c.x + 1 - wx, c.y + 1 - wy);
      f = d < 6 ? 1 : d < 12 ? 0.6 : 0.3;
    }
    R.shake = Math.min(14, R.shake + amount * f);
  }
  function addWave(team, cid) {
    const V = G.view; const c = V.castles[cid]; if (!c) return;
    const start = c.y * V.W + c.x;
    if (V.terr[start] !== team) return;
    const seen = new Uint8Array(V.N), q = [start]; seen[start] = 1;
    for (let h = 0; h < q.length && q.length < 2500; h++) {
      const i = q[h], x = i % V.W, y = (i / V.W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= V.W || yy >= V.H) continue;
        const j = yy * V.W + xx; if (seen[j] || V.terr[j] !== team) continue; seen[j] = 1; q.push(j);
      }
    }
    const [ox, oy] = w2m(c.x + 1, c.y + 1);
    const tiles = q.map(i => { const [mx, my] = rect2m(i % V.W, (i / V.W) | 0, 1, 1); return [mx, my, Math.hypot(mx + 0.5 - ox, my + 0.5 - oy)]; });
    let maxD = 0; for (const t of tiles) maxD = Math.max(maxD, t[2]);
    R.waves.push({ tiles, t0: R.time, maxD, col: R.tcol[team] || '#ffffff' });
  }
  function addFloat(wx, wy, text, col) {
    const [x, y] = w2m(wx, wy);
    R.floats.push({ x, y, text, col: col || '#fff', t0: R.time });
    if (R.floats.length > 20) R.floats.shift();
  }

  // ---------- Bild zeichnen ----------
  function render(dt) {
    R.time += dt;
    const V = G.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!V) return;
    ensureCaches();
    updateCamera(dt);
    const c = R.cam, d = R.dpr;
    let sx = 0, sy = 0;
    if (R.shake > 0.15) { sx = (Math.random() * 2 - 1) * R.shake; sy = (Math.random() * 2 - 1) * R.shake; R.shake *= Math.exp(-dt * 9); } else R.shake = 0;
    ctx.setTransform(d * c.s, 0, 0, d * c.s, d * (c.x + sx), d * (c.y + sy));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(R.water, 0, 0, mW(), mH());
    drawWater();
    ctx.drawImage(R.land, 0, 0, mW(), R.land.height / R.TS);
    ctx.drawImage(R.ground, 0, 0, mW(), mH());
    drawWaves();
    drawFireTiles(dt);
    drawUnderHighlights();
    ctx.globalAlpha = 0.3; ctx.drawImage(R.shadow, 0, -1, mW(), mH() + 1); ctx.globalAlpha = 1;
    ctx.drawImage(R.walls, 0, -1, mW(), mH() + 1);
    drawFlags();
    drawShips(); drawCrates(); drawCannons();
    drawOverHighlights();
    drawGhosts();
    drawBalls();
    drawParticles(dt);
    drawClouds(dt);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    drawLabels(); drawFloats(); drawCrosshairs();
  }

  function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, Math.PI * 2); }

  function drawWater() {
    const MW = mW(), MH = mH(), t = R.time;
    // Wellenmuster (zwei Lagen, gegenläufig)
    if (R.waveTex) {
      const sz = 7;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, MW, MH); ctx.clip();
      for (const [alpha, vx, vy, off] of [[0.16, 0.22, 0.06, 0], [0.1, -0.15, 0.1, 3.3]]) {
        ctx.globalAlpha = alpha;
        const ox = ((t * vx + off) % sz + sz) % sz, oy = ((t * vy + off) % sz + sz) % sz;
        for (let y = -sz + oy; y < MH; y += sz) for (let x = -sz + ox; x < MW; x += sz) ctx.drawImage(R.waveTex, x, y, sz, sz);
      }
      ctx.restore();
    }
    // Funkeln
    for (const s of R.sparkles) {
      const a = Math.pow(Math.max(0, Math.sin(t * s.sp + s.ph)), 6) * 0.8;
      if (a < 0.05) continue;
      const [mx, my] = w2m(s.x + Math.sin(t * 0.3 + s.ph) * 0.3, s.y);
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      ctx.fillRect(mx - 0.1, my - 0.015, 0.2, 0.03); ctx.fillRect(mx - 0.015, my - 0.07, 0.03, 0.14);
    }
    // Brandung um die Küsten
    const off = CLIFF * 0.9;
    ctx.globalAlpha = 0.45 + 0.3 * Math.sin(t * 1.7);
    ctx.drawImage(R.foamA, 0, off, MW, MH);
    ctx.globalAlpha = 0.22 + 0.2 * Math.sin(t * 1.7 + 2.2);
    ctx.drawImage(R.foamB, 0, off + 0.04 * Math.sin(t * 1.7 + 2.2), MW, MH);
    ctx.globalAlpha = 1;
  }

  function drawClouds(dt) {
    if (!R.clouds || !R.cloudTex) return;
    const MW = mW(), MH = mH();
    ctx.globalAlpha = 0.16;
    for (const c of R.clouds) {
      c.x += c.sp * dt;
      if (c.x - c.s > MW) { c.x = -c.s; c.y = Math.random() * MH; }
      ctx.drawImage(R.cloudTex, c.x - c.s / 2, c.y - c.s * 0.35, c.s, c.s * 0.7);
    }
    ctx.globalAlpha = 1;
  }

  function drawWaves() {
    for (let k = R.waves.length - 1; k >= 0; k--) {
      const w = R.waves[k];
      const r = (R.time - w.t0) * 16;
      if (r > w.maxD + 4) { R.waves.splice(k, 1); continue; }
      for (const [mx, my, dd] of w.tiles) {
        const diff = r - dd;
        if (diff < 0 || diff > 3.5) continue;
        const a = (1 - diff / 3.5) * 0.7;
        ctx.fillStyle = 'rgba(255,255,230,' + a.toFixed(3) + ')';
        ctx.fillRect(mx, my, 1.02, 1.02);
      }
    }
  }

  function drawFireTiles(dt) {
    const V = G.view;
    if (R.fireVer !== V.gridVer) {
      R.fireVer = V.gridVer; R.fireList = [];
      for (let i = 0; i < V.N; i++) if (V.fire[i]) { const [mx, my] = rect2m(i % V.W, (i / V.W) | 0, 1, 1); R.fireList.push([mx, my, i]); }
    }
    if (!R.fireList.length) return;
    for (const [mx, my, i] of R.fireList) {
      for (let k = 0; k < 3; k++) {
        const fx = mx + 0.22 + 0.28 * k, fy = my + 0.8;
        const h = 0.38 + 0.16 * Math.sin(R.time * 9 + i * 1.7 + k * 2.1);
        ctx.fillStyle = 'rgba(255,110,30,0.85)';
        ctx.beginPath(); ctx.moveTo(fx - 0.13, fy); ctx.quadraticCurveTo(fx - 0.12, fy - h * 0.6, fx, fy - h); ctx.quadraticCurveTo(fx + 0.12, fy - h * 0.6, fx + 0.13, fy); ctx.fill();
        ctx.fillStyle = 'rgba(255,220,90,0.9)';
        ctx.beginPath(); ctx.moveTo(fx - 0.06, fy); ctx.quadraticCurveTo(fx - 0.05, fy - h * 0.4, fx, fy - h * 0.6); ctx.quadraticCurveTo(fx + 0.05, fy - h * 0.4, fx + 0.06, fy); ctx.fill();
      }
      if (Math.random() < dt * 1.2) addP({ t: 'smoke', x: mx + 0.5, y: my + 0.5, z: 0.5, vx: rndr(-0.1, 0.1), vy: 0, vz: 0.8, life: 1.2, max: 1.2, r: 0.25, c: 60 });
    }
  }

  function drawFlags() {
    const V = G.view;
    for (const f of R.flags) {
      const c = f.c;
      const col = c.owner >= 0 && V.players[c.owner] ? V.players[c.owner].color : '#eef1f4';
      const x = f.mx, y = f.my, t = R.time * 4 + c.id * 1.3;
      ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.moveTo(x, y + 0.05); ctx.lineTo(x, y - 0.78); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x, y - 0.78);
      for (let k = 1; k <= 6; k++) { const u = k / 6; ctx.lineTo(x + u * 0.62, y - 0.78 + Math.sin(t - u * 3) * 0.07 * u); }
      for (let k = 6; k >= 0; k--) { const u = k / 6; ctx.lineTo(x + u * 0.62, y - 0.47 + Math.sin(t - u * 3) * 0.07 * u); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fill();
      ctx.fillStyle = col; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.arc(x, y - 0.8, 0.05, 0, 7); ctx.fill();
    }
  }

  function drawUnderHighlights() {
    const V = G.view, p = myP();
    if (!p) return;
    const pulse = 0.5 + 0.5 * Math.sin(R.time * 5);
    if (V.phase === 'select' && p.home < 0) {
      for (const c of V.castles) {
        if (c.zone !== G.me || c.owner >= 0 || c.citadel) continue;
        const [mx, my] = rect2m(c.x, c.y, 2, 2);
        ctx.strokeStyle = 'rgba(255,215,90,' + (0.5 + pulse * 0.5).toFixed(2) + ')'; ctx.lineWidth = 0.14;
        ellipse(mx + 1, my + 1.2, 1.5 + pulse * 0.25, 1.05 + pulse * 0.18); ctx.stroke();
        ctx.fillStyle = 'rgba(255,215,90,0.18)'; ctx.fill();
      }
    }
  }
  function drawOverHighlights() {
    const V = G.view, p = myP();
    if (!p || !p.alive) return;
    const pulse = 0.5 + 0.5 * Math.sin(R.time * 6);
    if (V.phase === 'select' && p.home < 0) {
      for (const c of V.castles) {
        if (c.zone !== G.me || c.owner >= 0 || c.citadel) continue;
        const [mx, my] = rect2m(c.x, c.y, 2, 2);
        const bob = Math.sin(R.time * 5) * 0.2;
        arrow(mx + 1, my - 1.9 + bob, '#ffd54a');
      }
    }
    if (V.phase === 'build' || V.phase === 'score') {
      for (const c of V.castles) {
        if (c.owner !== G.me || c.encl === p.team) continue;
        const [mx, my] = rect2m(c.x, c.y, 2, 2);
        ctx.strokeStyle = 'rgba(255,70,70,' + (0.45 + pulse * 0.55).toFixed(2) + ')'; ctx.lineWidth = 0.13;
        ellipse(mx + 1, my + 1.2, 1.55, 1.1); ctx.stroke();
        ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.arc(mx + 1, my - 1.6, 0.42, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 0.62px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!', mx + 1, my - 1.57);
      }
    }
  }
  function arrow(x, y, col) {
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.moveTo(x - 0.35, y - 0.5); ctx.lineTo(x + 0.35, y - 0.5); ctx.lineTo(x + 0.35, y); ctx.lineTo(x + 0.6, y); ctx.lineTo(x, y + 0.6); ctx.lineTo(x - 0.6, y); ctx.lineTo(x - 0.35, y); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  function drawCannons() {
    const V = G.view, now = G.now();
    const list = V.cannons.slice().sort((a, b) => rect2m(a.x, a.y, 2, 2)[1] - rect2m(b.x, b.y, 2, 2)[1]);
    for (const c of list) {
      const [rx, ry] = rect2m(c.x, c.y, 2, 2);
      const cx = rx + 1, cy = ry + 1;
      const pl = V.players[c.owner];
      const col = pl ? pl.color : '#888';
      const inactive = (V.phase === 'battle' || V.phase === 'cease') && !c.active;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(cx + 0.14, cy + 0.3, 0.74, 0.4); ctx.fill();
      ctx.fillStyle = '#6c6353'; ellipse(cx, cy + 0.12, 0.68, 0.47); ctx.fill();
      ctx.fillStyle = c.super ? '#c7a557' : '#a49a85'; ellipse(cx, cy, 0.68, 0.47); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ellipse(cx - 0.1, cy - 0.1, 0.5, 0.3); ctx.fill();
      ctx.fillStyle = c.super ? '#9c7a2c' : '#7e7563'; ellipse(cx, cy + 0.02, 0.5, 0.33); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 0.09; ellipse(cx, cy, 0.6, 0.41); ctx.stroke();
      // Lafette & Rohr
      const dm = dir2m(Math.cos(c.ang), Math.sin(c.ang));
      const a = Math.atan2(dm[1], dm[0]);
      const rel = c.super ? 2.8 : 2.2;
      const since = now - (c.readyAt - rel);
      const recoil = since >= 0 && since < 0.3 ? (1 - since / 0.3) * 0.2 : 0;
      const px = -dm[1] * 0.3, py = dm[0] * 0.3 * 0.7;
      ctx.fillStyle = '#4a3220';
      ctx.save(); ctx.translate(cx, cy - 0.08); ctx.rotate(a); ctx.fillRect(-0.32 - recoil * 0.5, -0.17, 0.5, 0.34); ctx.restore();
      ctx.fillStyle = '#2b1d12';
      ellipse(cx + px, cy - 0.06 + py, 0.12, 0.12); ctx.fill(); ellipse(cx - px, cy - 0.06 - py, 0.12, 0.12); ctx.fill();
      ctx.fillStyle = '#8a6a44';
      ellipse(cx + px, cy - 0.06 + py, 0.05, 0.05); ctx.fill(); ellipse(cx - px, cy - 0.06 - py, 0.05, 0.05); ctx.fill();
      ctx.save(); ctx.translate(cx, cy - 0.2); ctx.rotate(a);
      const L = c.super ? 1.0 : 0.82, Wd = c.super ? 0.3 : 0.24;
      const grd = ctx.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
      grd.addColorStop(0, c.super ? '#ffe9a0' : '#7d858e'); grd.addColorStop(0.4, c.super ? '#d9a21f' : '#3a4047'); grd.addColorStop(1, c.super ? '#7a5208' : '#121518');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(-0.18 - recoil, 0, Wd * 0.55, Math.PI / 2, Math.PI * 1.5); ctx.lineTo(L - recoil, -Wd / 2 * 0.78); ctx.lineTo(L - recoil, Wd / 2 * 0.78); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.super ? '#8a6208' : '#1a1d20'; ctx.fillRect(L - 0.09 - recoil, -Wd / 2 * 0.95, 0.1, Wd * 0.95);
      ctx.fillRect(0.25 - recoil, -Wd / 2 * 0.9, 0.05, Wd * 0.9);
      ctx.restore();
      if (inactive) {
        ctx.fillStyle = 'rgba(40,40,50,0.5)'; ellipse(cx, cy, 0.72, 0.5); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 0.5px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('z', cx + 0.25, cy - 0.55); ctx.fillText('z', cx + 0.5, cy - 0.85);
      } else if (V.phase === 'battle' && (c.owner === G.me || c.owner === G.me2)) {
        const rem = c.readyAt - now;
        if (rem > 0) {
          ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 0.1;
          ctx.beginPath(); ctx.arc(cx, cy, 0.82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - rem / rel)); ctx.stroke();
        } else {
          ctx.fillStyle = '#7dff8a'; ctx.beginPath(); ctx.arc(cx + 0.6, cy - 0.5, 0.1, 0, 7); ctx.fill();
        }
      }
      const maxHp = c.super ? 4 : 3;
      if (c.hp < maxHp) {
        for (let k = 0; k < maxHp; k++) { ctx.fillStyle = k < c.hp ? '#ff5a5a' : 'rgba(0,0,0,0.45)'; ctx.fillRect(cx - 0.45 + k * 0.32, cy + 0.72, 0.24, 0.12); }
      }
    }
  }

  function drawShips() {
    const V = G.view;
    for (const sh of V.ships) {
      const [mx, my0] = w2m(sh.x, sh.y);
      const bob = Math.sin(R.time * 2.6 + sh.id) * 0.06;
      const my = my0 + bob;
      const dm = dir2m(Math.cos(sh.ang), Math.sin(sh.ang));
      const a = Math.atan2(dm[1], dm[0]);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(a);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.moveTo(-0.8, 0.25); ctx.quadraticCurveTo(-1.4, 0.45, -1.9, 0.5 + Math.sin(R.time * 3) * 0.05); ctx.moveTo(-0.8, -0.25); ctx.quadraticCurveTo(-1.4, -0.45, -1.9, -0.5); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(0.08, 0.14, 0.95, 0.42); ctx.fill();
      ctx.fillStyle = '#5a3418';
      ctx.beginPath(); ctx.moveTo(0.95, 0); ctx.quadraticCurveTo(0.5, 0.42, -0.75, 0.36); ctx.lineTo(-0.85, 0); ctx.lineTo(-0.75, -0.36); ctx.quadraticCurveTo(0.5, -0.42, 0.95, 0); ctx.fill();
      ctx.fillStyle = '#8a5a30';
      ctx.beginPath(); ctx.moveTo(0.75, 0); ctx.quadraticCurveTo(0.4, 0.28, -0.6, 0.24); ctx.lineTo(-0.6, -0.24); ctx.quadraticCurveTo(0.4, -0.28, 0.75, 0); ctx.fill();
      ctx.restore();
      // Mast & Segel (immer nach oben)
      ctx.strokeStyle = '#3b2412'; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - 1.25); ctx.stroke();
      ctx.fillStyle = '#efe4c8';
      ctx.beginPath(); ctx.moveTo(mx - 0.45, my - 1.1); ctx.quadraticCurveTo(mx, my - 1.0 + Math.sin(R.time * 2) * 0.05, mx + 0.45, my - 1.1); ctx.lineTo(mx + 0.42, my - 0.4); ctx.quadraticCurveTo(mx, my - 0.3, mx - 0.42, my - 0.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(mx, my - 0.78, 0.15, 0, 7); ctx.fill();
      ctx.fillStyle = '#efe4c8'; ctx.fillRect(mx - 0.07, my - 0.82, 0.05, 0.05); ctx.fillRect(mx + 0.02, my - 0.82, 0.05, 0.05);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(mx, my - 1.25); ctx.lineTo(mx + 0.38, my - 1.18 + Math.sin(R.time * 6) * 0.03); ctx.lineTo(mx, my - 1.08); ctx.fill();
      if (sh.hp < 3) for (let k = 0; k < 3; k++) { ctx.fillStyle = k < sh.hp ? '#ff5a5a' : 'rgba(0,0,0,0.5)'; ctx.fillRect(mx - 0.42 + k * 0.3, my + 0.5, 0.24, 0.1); }
    }
  }

  const CRATE_COL = { cluster: '#e5484d', fire: '#f2862e', repair: '#2fbf5a' };
  function drawCrates() {
    const V = G.view, now = G.now();
    for (const cr of V.crates) {
      const [mx, my0] = w2m(cr.x, cr.y);
      const alt = cr.landAt > now ? (cr.landAt - now) / 2.2 * 3 : 0;
      const my = my0 + (cr.water && !alt ? Math.sin(R.time * 3 + cr.id) * 0.05 : 0);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.3 - Math.min(0.2, alt * 0.06)).toFixed(3) + ')';
      ellipse(mx, my + 0.25, 0.42 - alt * 0.05, 0.2); ctx.fill();
      const by = my - alt;
      if (!alt) {
        const g = 0.35 + 0.3 * Math.sin(R.time * 5 + cr.id);
        ctx.strokeStyle = 'rgba(255,230,120,' + g.toFixed(2) + ')'; ctx.lineWidth = 0.08; ellipse(mx, my + 0.1, 0.7, 0.45); ctx.stroke();
      }
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(mx - 0.34, by - 0.18, 0.68, 0.46);
      ctx.fillStyle = '#b8803f'; ctx.fillRect(mx - 0.34, by - 0.4, 0.68, 0.32);
      ctx.strokeStyle = '#5e3a17'; ctx.lineWidth = 0.05; ctx.strokeRect(mx - 0.34, by - 0.4, 0.68, 0.68);
      ctx.fillStyle = CRATE_COL[cr.k] || '#fff'; ctx.beginPath(); ctx.arc(mx, by + 0.02, 0.17, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      if (cr.k === 'repair') { ctx.fillRect(mx - 0.1, by - 0.025, 0.2, 0.09); ctx.fillRect(mx - 0.045, by - 0.08, 0.09, 0.2); }
      else if (cr.k === 'fire') { ctx.beginPath(); ctx.moveTo(mx - 0.07, by + 0.1); ctx.quadraticCurveTo(mx - 0.09, by - 0.04, mx, by - 0.12); ctx.quadraticCurveTo(mx + 0.09, by - 0.04, mx + 0.07, by + 0.1); ctx.fill(); }
      else { for (const [ox, oy] of [[0, -0.07], [-0.07, 0.06], [0.07, 0.06]]) { ctx.beginPath(); ctx.arc(mx + ox, by + 0.02 + oy, 0.045, 0, 7); ctx.fill(); } }
      if (alt > 0) {
        const cy = by - 1.15;
        ctx.strokeStyle = 'rgba(60,40,20,0.8)'; ctx.lineWidth = 0.03;
        ctx.beginPath(); ctx.moveTo(mx - 0.32, by - 0.4); ctx.lineTo(mx - 0.7, cy); ctx.moveTo(mx + 0.32, by - 0.4); ctx.lineTo(mx + 0.7, cy); ctx.moveTo(mx, by - 0.4); ctx.lineTo(mx, cy - 0.1); ctx.stroke();
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = k % 2 ? '#ffffff' : '#e5484d';
          ctx.beginPath(); ctx.moveTo(mx, cy); ctx.arc(mx, cy, 0.75, Math.PI + k * Math.PI / 4, Math.PI + (k + 1) * Math.PI / 4); ctx.closePath(); ctx.fill();
        }
      }
    }
  }

  function drawBalls() {
    const V = G.view, now = G.now();
    for (const b of V.balls) {
      let t = (now - b.born) / b.dur;
      if (t > 1.05) continue;
      t = clamp(t, 0, 1);
      const wx = lerp(b.sx, b.tx, t), wy = lerp(b.sy, b.ty, t);
      const [mx, my] = w2m(wx, wy);
      const dist = Math.hypot(b.tx - b.sx, b.ty - b.sy);
      const H = (0.5 + dist * 0.13) * 4 * t * (1 - t) + (b.h0 ? 0.6 * (1 - t) : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.32)'; ellipse(mx, my + 0.05, 0.2, 0.11); ctx.fill();
      const r = b.k === 's' ? 0.25 : b.h0 ? 0.13 : 0.17;
      const y = my - H;
      if (b.k === 'f') {
        ctx.fillStyle = 'rgba(255,130,30,0.35)'; ctx.beginPath(); ctx.arc(mx, y, r * 2.4, 0, 7); ctx.fill();
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(mx, y, r * 1.1, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff2b0'; ctx.beginPath(); ctx.arc(mx - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); ctx.fill();
        if (Math.random() < 0.6) addP({ t: 'ember', x: mx, y: my, z: H, vx: rndr(-0.3, 0.3), vy: rndr(-0.3, 0.3), vz: 0.3, life: 0.5, max: 0.5 });
      } else {
        const gr = ctx.createRadialGradient(mx - r * 0.35, y - r * 0.35, r * 0.1, mx, y, r);
        gr.addColorStop(0, b.k === 's' ? '#fff0b0' : b.k === 'c' ? '#ff9a9a' : '#8a9097');
        gr.addColorStop(1, b.k === 's' ? '#a8790f' : b.k === 'c' ? '#7a1418' : b.k === 'p' ? '#2a1010' : '#121417');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(mx, y, r, 0, 7); ctx.fill();
        if (b.k === 'c') { ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 0.04; for (let k = 0; k < 6; k++) { const aa = k * Math.PI / 3 + R.time * 6; ctx.beginPath(); ctx.moveTo(mx + Math.cos(aa) * r, y + Math.sin(aa) * r); ctx.lineTo(mx + Math.cos(aa) * r * 1.6, y + Math.sin(aa) * r * 1.6); ctx.stroke(); } }
        if (Math.random() < 0.45) addP({ t: 'smoke', x: mx, y: my, z: H, vx: 0, vy: 0, vz: 0.1, life: 0.5, max: 0.5, r: 0.11, c: 235 });
      }
    }
  }

  function drawParticles(dt) {
    const ps = R.parts;
    let w = 0;
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      p.life -= dt;
      if (p.life <= 0) continue;
      ps[w++] = p;
      p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.z += (p.vz || 0) * dt;
      const f = p.life / p.max;
      switch (p.t) {
        case 'spark': p.vz -= 9 * dt; if (p.z < 0) { p.z = 0; p.vz = 0; p.vx *= 0.6; p.vy *= 0.6; }
          ctx.fillStyle = p.c; ctx.globalAlpha = Math.min(1, f * 1.5); ctx.fillRect(p.x - 0.05, p.y - p.z - 0.05, 0.1, 0.1); break;
        case 'debris': p.vz -= 11 * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
          ctx.fillStyle = p.c; ctx.globalAlpha = Math.min(1, f * 2); ctx.fillRect(p.x - p.s / 2, p.y - p.z - p.s / 2, p.s, p.s); break;
        case 'drop': p.vz -= 11 * dt; if (p.z < 0) { p.life = 0; break; }
          ctx.fillStyle = 'rgba(225,245,255,0.9)'; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.s, 0, 7); ctx.fill(); break;
        case 'ember': p.vz -= 1 * dt;
          ctx.fillStyle = Math.random() < 0.5 ? '#ffb347' : '#ff6a1f'; ctx.globalAlpha = f; ctx.fillRect(p.x - 0.04, p.y - p.z - 0.04, 0.08, 0.08); break;
        case 'smoke': { p.vz *= 0.97; const r = p.r * (1 + (1 - f) * 1.4); ctx.globalAlpha = f * 0.5; ctx.fillStyle = 'rgb(' + p.c + ',' + p.c + ',' + p.c + ')'; ctx.beginPath(); ctx.arc(p.x, p.y - p.z, r, 0, 7); ctx.fill(); break; }
        case 'flash': { const r = p.r * (0.6 + (1 - f) * 0.6); const g = ctx.createRadialGradient(p.x, p.y - p.z, 0, p.x, p.y - p.z, r); g.addColorStop(0, 'rgba(255,255,230,' + f + ')'); g.addColorStop(0.4, (p.c || 'rgba(255,200,80,') + (f * 0.8) + ')'); g.addColorStop(1, 'rgba(255,120,30,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - p.z, r, 0, 7); ctx.fill(); break; }
        case 'ring': ctx.globalAlpha = 1; ctx.strokeStyle = p.c + (f * 0.8).toFixed(3) + ')'; ctx.lineWidth = 0.08; ellipse(p.x, p.y - p.z, p.r * (1 - f) + 0.1, (p.r * (1 - f) + 0.1) * 0.65); ctx.stroke(); break;
      }
    }
    ps.length = w;
    ctx.globalAlpha = 1;
  }

  function drawGhosts() {
    const V = G.view;
    for (const ct of controllers()) {
      if (!ct.has) continue;
      const p = V.players[ct.pid];
      if (!p || !p.alive) continue;
      if (V.phase === 'build' && p.piece) {
        const gh = ghostPiece(ct);
        const okT = G.now() < V.phaseEnd - p.penalty;
        const valid = okT && E.canPlacePiece(V, ct.pid, p.piece, gh.x, gh.y, ct.rot);
        for (const [cx, cy] of gh.cells) {
          const [mx, my] = rect2m(gh.x + cx, gh.y + cy, 1, 1);
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(mx + 0.12, my + 0.12, 1, 1);
          ctx.fillStyle = !valid ? 'rgba(255,70,70,0.55)' : p.bastionArmed ? 'rgba(150,180,220,0.75)' : rgba(p.color, 0.55);
          ctx.fillRect(mx, my - 0.42, 1, 1);
          ctx.fillStyle = !valid ? 'rgba(150,20,20,0.6)' : 'rgba(255,255,255,0.35)';
          ctx.fillRect(mx, my + 0.58, 1, 0.42);
          ctx.strokeStyle = valid ? 'rgba(255,255,255,0.95)' : 'rgba(255,200,200,0.95)'; ctx.lineWidth = 0.06;
          ctx.strokeRect(mx + 0.03, my - 0.39, 0.94, 0.94);
        }
        if (ct.label) labelAtWorld(gh.x + 0.5, gh.y - 0.6, ct.label, p.color);
      } else if (V.phase === 'cannon' && p.cannonsToPlace + p.superToPlace > 0) {
        const gx = Math.round(ct.wx - 1), gy = Math.round(ct.wy - 1);
        const valid = E.canPlaceCannon(V, ct.pid, gx, gy);
        const [mx, my] = rect2m(gx, gy, 2, 2);
        ctx.fillStyle = valid ? rgba(p.color, 0.35) : 'rgba(255,70,70,0.4)'; ctx.fillRect(mx, my, 2, 2);
        ctx.strokeStyle = valid ? 'rgba(255,255,255,0.95)' : 'rgba(255,200,200,0.95)'; ctx.lineWidth = 0.07; ctx.strokeRect(mx + 0.04, my + 0.04, 1.92, 1.92);
        ctx.fillStyle = p.superToPlace > 0 ? 'rgba(242,193,78,0.85)' : 'rgba(30,32,36,0.75)';
        ellipse(mx + 1, my + 1, 0.5, 0.36); ctx.fill();
        ctx.fillRect(mx + 1, my + 0.85, 0.75, 0.3);
        if (ct.label) labelAtWorld(gx + 1, gy - 0.4, ct.label, p.color);
      }
    }
  }
  function labelAtWorld(wx, wy, text, col) {
    const [mx, my] = w2m(wx, wy);
    ctx.font = 'bold 0.55px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 0.4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(mx - w / 2, my - 0.35, w, 0.7);
    ctx.fillStyle = col; ctx.fillText(text, mx, my);
  }

  function drawLabels() {
    const V = G.view;
    if (R.cam.s < 7) return;
    ctx.font = '700 ' + Math.round(clamp(R.cam.s * 0.42, 10, 13)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of V.players) {
      if (p.home < 0 || !p.alive) continue;
      const c = V.castles[p.home];
      const f = R.flags.find(fl => fl.c.id === c.id);
      const [mx, my] = f ? [f.mx, f.my - 1.2] : w2m(c.x + 1, c.y - 1);
      const [sx, sy] = m2s(mx, my);
      const txt = p.name + (p.bot ? ' 🤖' : '');
      const w = ctx.measureText(txt).width + 20;
      ctx.fillStyle = 'rgba(6,13,22,0.72)';
      roundRect(ctx, sx - w / 2, sy - 10, w, 20, 10); ctx.fill();
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(sx - w / 2 + 9, sy, 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = p.id === G.me ? '#ffd56a' : '#fff'; ctx.fillText(txt, sx + 5, sy + 0.5);
    }
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function drawFloats() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = R.floats.length - 1; k >= 0; k--) {
      const f = R.floats[k], age = R.time - f.t0;
      if (age > 1.3) { R.floats.splice(k, 1); continue; }
      const [sx, sy] = m2s(f.x, f.y);
      ctx.globalAlpha = 1 - age / 1.3;
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(f.text, sx, sy - age * 30);
      ctx.fillStyle = f.col; ctx.fillText(f.text, sx, sy - age * 30);
    }
    ctx.globalAlpha = 1;
  }
  function drawCrosshairs() {
    const V = G.view;
    if (V.phase !== 'battle') return;
    for (const ct of controllers()) {
      if (!ct.has || (ct.touch && !ct.key)) continue;
      const p = V.players[ct.pid]; if (!p || !p.alive) continue;
      const tx = Math.floor(ct.wx) + 0.5, ty = Math.floor(ct.wy) + 0.5;
      const inR = readyInRange(ct.pid, tx, ty);
      const [mx, my] = w2m(tx, ty);
      const [sx, sy] = m2s(mx, my);
      const r = Math.max(9, R.cam.s * 0.7);
      ctx.strokeStyle = inR ? 'rgba(255,255,255,0.95)' : 'rgba(255,90,90,0.95)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - r * 1.5, sy); ctx.lineTo(sx - r * 0.5, sy); ctx.moveTo(sx + r * 0.5, sy); ctx.lineTo(sx + r * 1.5, sy);
      ctx.moveTo(sx, sy - r * 1.5); ctx.lineTo(sx, sy - r * 0.5); ctx.moveTo(sx, sy + r * 0.5); ctx.lineTo(sx, sy + r * 1.5); ctx.stroke();
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 7); ctx.fill();
      if (ct.label) { ctx.font = '800 12px system-ui'; ctx.fillStyle = p.color; ctx.textAlign = 'left'; ctx.fillText(ct.label, sx + r + 4, sy - r); }
    }
  }
  function readyInRange(pid, tx, ty) {
    const V = G.view, now = G.now();
    for (const c of V.cannons) {
      if (c.owner !== pid || !c.active || c.readyAt > now) continue;
      if (Math.hypot(c.x + 1 - tx, c.y + 1 - ty) <= E.cannonRange(V, c)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Steuerung
  // ------------------------------------------------------------------
  const Aim = { has: false, sx: 0, sy: 0, wx: 0, wy: 0, touch: isTouch };
  const Aim2 = { has: false, tx: 0, ty: 0 };
  const DRAG_OFF = 72;
  function controllers() {
    const list = [];
    if (G.me >= 0) list.push({ pid: G.me, has: Aim.has, wx: Aim.wx, wy: Aim.wy, rot: G.rot, touch: Aim.touch, label: G.me2 >= 0 ? 'P1' : '' });
    if (G.me2 >= 0) list.push({ pid: G.me2, has: Aim2.has, wx: Aim2.tx + 0.5, wy: Aim2.ty + 0.5, rot: G.rot2, key: true, label: 'P2' });
    return list;
  }
  const ctrl1 = () => controllers()[0];
  const ctrl2 = () => controllers().find(c => c.key);
  function ghostPiece(ct) {
    const p = G.view.players[ct.pid];
    const cells = E.pieceCells(p.piece, ct.rot);
    let bw = 0, bh = 0;
    for (const [x, y] of cells) { bw = Math.max(bw, x + 1); bh = Math.max(bh, y + 1); }
    return { cells, x: Math.round(ct.wx - bw / 2), y: Math.round(ct.wy - bh / 2) };
  }
  function setAimScreen(sx, sy, off) {
    Aim.sx = sx; Aim.sy = sy - (off ? DRAG_OFF : 0);
    const [wx, wy] = s2w(Aim.sx, Aim.sy);
    Aim.wx = wx; Aim.wy = wy; Aim.has = true;
  }
  function defaultAim() {
    const V = G.view, p = myP();
    if (!p) return;
    const c = V.castles[p.home] || V.castles.find(k => k.owner === G.me);
    if (!c) return;
    // Erste Lücke in der Nähe der Burg suchen
    let best = null, bd = 1e9;
    if (V.phase === 'build') {
      for (let y = c.y - 6; y <= c.y + 7; y++) for (let x = c.x - 6; x <= c.x + 7; x++) {
        if (x < 0 || y < 0 || x >= V.W || y >= V.H) continue;
        const i = y * V.W + x;
        if (!E.buildable(V, p.team, i)) continue;
        const d = Math.abs(Math.max(Math.abs(x - c.x - 0.5), Math.abs(y - c.y - 0.5)) - 3.5);
        if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
      }
    }
    if (!best) best = [c.x + 1, c.y - 2];
    Aim.wx = best[0]; Aim.wy = best[1]; Aim.has = true;
    const [mx, my] = w2m(Aim.wx, Aim.wy); [Aim.sx, Aim.sy] = m2s(mx, my);
  }
  function tapOnGhost(wx, wy) {
    const V = G.view, ct = ctrl1(); if (!ct || !ct.has) return false;
    const p = V.players[ct.pid]; if (!p) return false;
    if (V.phase === 'build' && p.piece) {
      const gh = ghostPiece(ct);
      for (const [cx, cy] of gh.cells) if (Math.abs(gh.x + cx + 0.5 - wx) < 1.1 && Math.abs(gh.y + cy + 0.5 - wy) < 1.1) return true;
      return false;
    }
    if (V.phase === 'cannon') {
      const gx = Math.round(ct.wx - 1), gy = Math.round(ct.wy - 1);
      return wx > gx - 0.6 && wx < gx + 2.6 && wy > gy - 0.6 && wy < gy + 2.6;
    }
    return false;
  }

  function act(pid, m) {
    if (G.mode === 'local') {
      const r = E.input(G.local, pid, m);
      if (!r.ok) feedbackError(r.err);
      return r.ok;
    }
    if (G.mode === 'online') { Net.send({ t: 'in', m }); return true; }
    return false;
  }
  function feedbackError(msg) {
    if (msg === 'Nachladen …') {
      if (Aim.has && G.view) addFloat(Aim.wx, Aim.wy, '⏳ Nachladen', '#ffd56a');
      return;
    }
    if (msg === 'Außer Reichweite!') {
      Sfx.err();
      if (Aim.has && G.view) addFloat(Aim.wx, Aim.wy, 'Außer Reichweite', '#ff8080');
      return;
    }
    Sfx.err();
    UI.toast(msg, true);
    if (Aim.has && G.view) addFloat(Aim.wx, Aim.wy, '✖', '#ff8080');
  }
  function castleAt(wx, wy, pid) {
    const V = G.view; let best = null, bd = 2.6;
    for (const c of V.castles) {
      if (c.zone !== pid || c.owner >= 0 || c.citadel) continue;
      const d = Math.hypot(c.x + 1 - wx, c.y + 1 - wy);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function doPrimary(ct) {
    const V = G.view;
    if (!ct || !V) return;
    const p = V.players[ct.pid];
    if (!p || !p.alive) return;
    switch (V.phase) {
      case 'select': {
        if (p.home >= 0) return;
        const c = castleAt(ct.wx, ct.wy, ct.pid);
        if (c) act(ct.pid, { a: 'sel', c: c.id }); else feedbackError((isTouch ? 'Tippe' : 'Klicke') + ' auf eine Burg mit Pfeil!');
        break;
      }
      case 'cannon': {
        if (p.cannonsToPlace + p.superToPlace <= 0) return feedbackError('Alle Kanonen stehen – gleich geht es los!');
        const gx = Math.round(ct.wx - 1), gy = Math.round(ct.wy - 1);
        if (!E.canPlaceCannon(V, ct.pid, gx, gy)) return feedbackError('Kanonen nur in deinem umschlossenen Gebiet!');
        if (act(ct.pid, { a: 'can', x: gx, y: gy }) && G.mode === 'online') Sfx.clank();
        break;
      }
      case 'build': {
        if (!p.piece) return;
        const gh = ghostPiece(ct);
        if (G.now() > V.phaseEnd - p.penalty) return feedbackError('Deine Bauzeit ist um!');
        if (!E.canPlacePiece(V, ct.pid, p.piece, gh.x, gh.y, ct.rot)) return feedbackError('Hier kann nicht gebaut werden!');
        if (act(ct.pid, { a: 'piece', x: gh.x, y: gh.y, r: ct.rot }) && G.mode === 'online') Sfx.click();
        break;
      }
      case 'battle': {
        if (G.mode === 'online') {
          const tx = Math.floor(ct.wx) + 0.5, ty = Math.floor(ct.wy) + 0.5;
          if (readyInRange(ct.pid, tx, ty)) { Sfx.boom(1); G.optBoom = performance.now(); }
        }
        act(ct.pid, { a: 'fire', x: ct.wx, y: ct.wy });
        break;
      }
      case 'ready': UI.toast('Gleich … noch nicht feuern!'); break;
    }
  }
  function rotate(who) {
    if (!G.view || G.view.phase !== 'build') return;
    if (who === 2) G.rot2 = (G.rot2 + 1) % 4; else G.rot = (G.rot + 1) % 4;
    Sfx.tick();
    UI.infoKey = '';
  }
  function special(kind) {
    const p = myP(); if (!p || !p.alive || !G.view) return;
    if (G.view.phase === 'build') {
      if (!G.view.settings.sabotage) return UI.toast('Büro-Sabotage ist in diesem Spiel ausgeschaltet.');
      if (kind === 'skip') { if (act(G.me, { a: 'skip' })) Sfx.tick(); }
      else if (kind === 'bastion') { if (act(G.me, { a: 'bastion' })) { Sfx.clank(); UI.toast(p.bastionArmed ? 'Bastion abgebrochen' : '🛡 Bastion aktiv: Das nächste Teil hält 2 Treffer aus!'); } }
    }
    closeSpecialMenu();
  }
  function closeSpecialMenu() { $('#special-menu').classList.add('hidden'); }

  const ptrs = new Map();
  let gest = null, pinch = null;
  const pdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  cv.addEventListener('pointerdown', (e) => {
    Sfx.unlock(); Voice.unlock();
    if (!UI.inGame || !G.view) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (er) { }
    closeSpecialMenu();
    const P = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), type: e.pointerType, btn: e.button, moved: false };
    ptrs.set(e.pointerId, P);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const c = R.cam; c.manual = true; c.tx = c.x; c.ty = c.y; c.ts = c.s;
      pinch = { d0: Math.max(10, pdist(a, b)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s0: c.s, x0: c.x, y0: c.y };
      gest = 'pinch';
      return;
    }
    if (ptrs.size > 2) return;
    Aim.touch = e.pointerType !== 'mouse';
    if (e.pointerType === 'mouse') { gest = e.button === 0 ? 'mouse' : 'mpan'; setAimScreen(e.clientX, e.clientY, false); }
    else gest = 'touch';
  });
  cv.addEventListener('pointermove', (e) => {
    if (!UI.inGame || !G.view) return;
    const P = ptrs.get(e.pointerId);
    if (!P) { if (e.pointerType === 'mouse') { Aim.touch = false; setAimScreen(e.clientX, e.clientY, false); } return; }
    const dx = e.clientX - P.x, dy = e.clientY - P.y;
    P.x = e.clientX; P.y = e.clientY;
    if (!P.moved && Math.hypot(P.x - P.x0, P.y - P.y0) > (P.type === 'mouse' ? 5 : 10)) P.moved = true;
    if (gest === 'pinch') {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      const d = pdist(a, b), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const c = R.cam, fit = c.fit || c.s;
      const ns = clamp(pinch.s0 * d / pinch.d0, fit * 0.7, Math.max(fit * 5, 60));
      const mx = (pinch.cx - pinch.x0) / pinch.s0, my = (pinch.cy - pinch.y0) / pinch.s0;
      c.ts = c.s = ns; c.tx = c.x = cx - mx * ns; c.ty = c.y = cy - my * ns;
      clampCam();
      return;
    }
    if (P.type === 'mouse') {
      setAimScreen(e.clientX, e.clientY, false);
      if (gest === 'mpan' && P.moved) panBy(dx, dy);
      return;
    }
    const ph = G.view.phase;
    if ((ph === 'build' || ph === 'cannon') && myP() && myP().alive) {
      if (P.moved) { gest = 'drag'; setAimScreen(e.clientX, e.clientY, true); }
    } else if (P.moved) { gest = 'pan'; panBy(dx, dy); }
  });
  function endPtr(e, cancel) {
    const P = ptrs.get(e.pointerId);
    if (!P) return;
    ptrs.delete(e.pointerId);
    if (gest === 'pinch') { if (ptrs.size === 0) gest = null; return; }
    if (cancel || !G.view) { gest = null; return; }
    const ph = G.view.phase;
    if (P.type === 'mouse') {
      if (gest === 'mouse' && P.btn === 0 && !(P.moved && ph !== 'battle' && ph !== 'build' && ph !== 'cannon')) { setAimScreen(e.clientX, e.clientY, false); doPrimary(ctrl1()); }
      else if (P.btn === 2 && !P.moved) rotate(1);
      gest = null; return;
    }
    if (gest === 'drag') doPrimary(ctrl1());
    else if (gest === 'touch' && !P.moved) {
      if (ph === 'cannon') {
        setAimScreen(e.clientX, e.clientY, false);
        doPrimary(ctrl1());
      } else if (ph === 'build') {
        const [wx, wy] = s2w(e.clientX, e.clientY);
        if (Aim.has && tapOnGhost(wx, wy)) doPrimary(ctrl1());
        else { setAimScreen(e.clientX, e.clientY, false); Sfx.tick(); }
      } else {
        setAimScreen(e.clientX, e.clientY, false);
        if (ph === 'battle') { const [mx, my] = w2m(Aim.wx, Aim.wy); addP({ t: 'ring', x: mx, y: my, z: 0, life: 0.35, max: 0.35, r: 0.9, c: 'rgba(255,255,255,' }); }
        doPrimary(ctrl1());
      }
    }
    gest = null;
  }
  cv.addEventListener('pointerup', (e) => endPtr(e, false));
  cv.addEventListener('pointercancel', (e) => endPtr(e, true));
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size && G.view && G.view.phase === 'battle') Aim.has = false; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    if (!UI.inGame || !G.view) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (!UI.inGame || !G.view) return;
    const k = e.key;
    if (k === 'Escape') { togglePause(); return; }
    if (G.me2 >= 0) {
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (mv) {
        e.preventDefault();
        if (!Aim2.has) defaultAim2();
        const [mdx, mdy] = mv;
        const [wdx, wdy] = R.rot ? [mdy, -mdx] : [mdx, mdy];
        Aim2.tx = clamp(Aim2.tx + wdx, 0, G.view.W - 1); Aim2.ty = clamp(Aim2.ty + wdy, 0, G.view.H - 1); Aim2.has = true;
        return;
      }
      if (k === 'Enter') { e.preventDefault(); if (!Aim2.has) defaultAim2(); doPrimary(ctrl2()); return; }
      if (k === '#' || k === "'" || k === '-' || k === '.' || (k === 'Shift' && e.location === 2) || k === '0') { e.preventDefault(); rotate(2); return; }
    }
    if (k === 'r' || k === 'R' || k === ' ') { e.preventDefault(); rotate(1); }
    else if (k === 's' || k === 'S') special('skip');
    else if (k === 'b' || k === 'B') special('bastion');
    else if (k === 'f' || k === 'F') toggleFS();
    else if (k === 'z' || k === 'Z') toggleZoom();
    else if (k === 'm' || k === 'M') toggleSound();
  });
  function defaultAim2() {
    const V = G.view, p = V.players[G.me2]; if (!p) return;
    const c = V.castles[p.home] || V.castles.find(k => k.owner === G.me2) || V.castles.find(k => k.zone === G.me2 && !k.citadel);
    if (c) { Aim2.tx = c.x; Aim2.ty = V.phase === 'select' ? c.y : c.y - 2; } else { Aim2.tx = V.W >> 1; Aim2.ty = V.H >> 1; }
    Aim2.has = true;
  }

  function toggleZoom() {
    setCamMode(R.cam.mode === 'focus' ? 'fit' : 'focus');
    UI.toast(R.cam.mode === 'focus' ? '🔍 Ansicht: Deine Burg' : '🗺️ Ansicht: Ganze Insel');
  }
  function toggleSound() {
    Sfx.unlock();
    Sfx.setOn(!Sfx.on);
    updateSoundButtons();
  }
  function updateSoundButtons() {
    $('#h-sound').textContent = Sfx.on ? '🔊' : '🔇';
    $('#btn-sound').textContent = Sfx.on ? '🔊 Ton an' : '🔇 Ton aus';
    $('#p-voice').textContent = Voice.on ? '🗣️ Sprachausgabe an' : '🤐 Sprachausgabe aus';
  }
  function toggleFS() {
    const d = document, el = d.documentElement;
    const isFs = d.fullscreenElement || d.webkitFullscreenElement;
    try {
      if (!isFs) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          const r = req.call(el, { navigationUI: 'hide' });
          if (r && r.then) r.then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => fsFallback());
        } else fsFallback();
      } else {
        (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      }
    } catch (e) { fsFallback(); }
    setTimeout(resize, 300);
  }
  function fsFallback() {
    if (isIOS) UI.toast('iPhone: Über „Teilen → Zum Home-Bildschirm“ installieren – dann läuft das Spiel im Vollbild!');
    else UI.toast('Vollbild wird von diesem Browser nicht unterstützt.');
  }

  // ------------------------------------------------------------------
  // Spiel-Ereignisse → Effekte, Ton, Sprache
  // ------------------------------------------------------------------
  const note = (m, e) => { if (G.mode !== 'attract') UI.toast(m, e); };
  const isMine = (pid) => pid >= 0 && (pid === G.me || pid === G.me2);
  function handleEvents(evs) {
    const V = G.view;
    if (!V || !evs || !evs.length) return;
    const T = myTeam();
    for (const e of evs) {
      switch (e.e) {
        case 'phase': onPhase(e.ph); break;
        case 'ball': {
          const b = e.b;
          if (!b.h0) {
            burst(b.sx, b.sy, 'muzzle');
            const opt = G.mode === 'online' && isMine(b.o) && performance.now() - (G.optBoom || 0) < 700;
            if (!opt) Sfx.boom(isMine(b.o) ? 1 : b.o < 0 ? 0.8 : 0.4);
          }
          const tx = Math.floor(b.tx), ty = Math.floor(b.ty);
          if (!isMine(b.o) && T >= 0 && tx >= 0 && ty >= 0 && tx < V.W && ty < V.H) {
            const ti = ty * V.W + tx;
            const w = V.wall[ti];
            if (V.terr[ti] === T || (w >= 0 && V.players[w] && V.players[w].team === T)) {
              setTimeout(() => Sfx.whistle(b.dur * 0.6), Math.max(0, b.dur * 350));
            }
          }
          break;
        }
        case 'split': burst(e.x, e.y, 'puff'); Sfx.thud(); break;
        case 'imp': impactFx(e); break;
        case 'conq':
          addWave(e.team, e.cid);
          if (e.team === T && V.phase === 'build') { Sfx.fanfare(); Voice.say('Gebiet erobert!'); }
          break;
        case 'capture':
          if (isMine(e.pid)) { Voice.say('Burg erobert!'); note('🏰 Neue Burg erobert!'); }
          break;
        case 'elim': {
          const p = V.players[e.pid];
          if (isMine(e.pid)) {
            Voice.say('Du bist ausgeschieden!', true);
            UI.banner('Ausgeschieden!', e.mate >= 0 ? 'Dein Team kämpft weiter – feuere es an!' : 'Schau zu, wie es weitergeht');
          } else if (p) {
            note('💀 ' + p.name + ' ist ausgeschieden' + (e.mate >= 0 && V.players[e.mate] ? ' – ' + V.players[e.mate].name + ' übernimmt die Mauern' : ''));
            Voice.say(p.name + ' ist ausgeschieden');
          }
          computeFocus();
          break;
        }
        case 'crate': {
          burst(e.x, e.y, 'gold');
          if (isMine(e.pid)) {
            Sfx.pickup();
            const n = { cluster: 'Streubombe', fire: 'Brandgeschoss', repair: 'Reparatur-Trupp' }[e.k];
            Voice.say(n + '!');
            note('📦 ' + n + (e.k === 'repair' ? ' kommt in der Bauphase!' : ' geladen (2 Schuss)!'));
          }
          break;
        }
        case 'sink':
          burst(e.x, e.y, 'big'); burst(e.x, e.y, 'splash'); Sfx.explode(1); Sfx.splash();
          if (isMine(e.by)) { Voice.say('Schiff versenkt!'); note('🏴‍☠️ Piratenschiff versenkt! +40'); }
          break;
        case 'pirates':
          Sfx.horn();
          if (e.team === T) { Voice.say('Piraten greifen an!'); note('🏴‍☠️ Piraten greifen dich an – versenk sie!', true); }
          else note('🏴‍☠️ Piraten greifen ' + E.teamLabel(V, e.team) + ' an!');
          break;
        case 'place':
          if (isMine(e.pid) && G.mode !== 'online') Sfx.click();
          for (const i of e.tiles) burst(i % V.W + 0.5, ((i / V.W) | 0) + 0.5, 'dust');
          break;
        case 'can':
          if (isMine(e.pid) && G.mode !== 'online') Sfx.clank();
          burst(e.x + 1, e.y + 1, 'dust');
          if (isMine(e.pid) && e.sup) note('👑 Super-Kanone steht – doppelte Reichweite!');
          break;
        case 'repair':
          if (isMine(e.pid)) { note('🔧 Reparatur-Trupp hat ' + e.tiles.length + ' Lücken geflickt!'); Voice.say('Reparatur-Trupp im Einsatz!'); }
          for (const i of e.tiles) burst(i % V.W + 0.5, ((i / V.W) | 0) + 0.5, 'gold');
          break;
        case 'bastion':
          for (const i of e.tiles) burst(i % V.W + 0.5, ((i / V.W) | 0) + 0.5, 'sparks');
          break;
        case 'skip': if (isMine(e.pid)) note('⏭ Teil übersprungen (−2 Sek.)'); break;
        case 'sel': if (isMine(e.pid)) { Sfx.fanfare(); computeFocus(); } break;
        case 'over': onOver(e.result); break;
      }
    }
  }

  function impactFx(e) {
    const V = G.view;
    const near = (amt) => shakeAt(e.x, e.y, amt);
    switch (e.r) {
      case 'wall': case 'wallhit': burst(e.x, e.y, 'explosion', { color: '#d8ccb2' }); Sfx.explode(0.75); near(4); break;
      case 'cdead': burst(e.x, e.y, 'big', { color: '#5a4a3a' }); Sfx.explode(1.25); near(9); break;
      case 'cannon': case 'castle': burst(e.x, e.y, 'sparks'); Sfx.thud(); near(2.5); break;
      case 'ground': burst(e.x, e.y, 'dirt'); Sfx.thud(); near(1.5); break;
      case 'water': burst(e.x, e.y, 'splash'); Sfx.splash(); break;
      case 'ship': burst(e.x, e.y, 'explosion', { color: '#6b4423' }); burst(e.x, e.y, 'splash'); Sfx.explode(0.8); break;
      case 'fire': burst(e.x, e.y, 'fire'); burst(e.x, e.y, 'dirt'); Sfx.crackle(); Sfx.explode(0.6); near(4); break;
      case 'crate': burst(e.x, e.y, 'sparks'); break;
      default: burst(e.x, e.y, 'puff'); Sfx.thud();
    }
    if (e.k === 's') burst(e.x, e.y, 'explosion', { color: '#f2c14e' });
    if (isMine(e.o) && (e.r === 'wall' || e.r === 'cdead')) addFloat(e.x, e.y - 0.5, e.r === 'cdead' ? '+30' : '+4', '#ffd56a');
  }

  function onPhase(ph) {
    const V = G.view;
    closeSpecialMenu();
    const p = myP();
    const alive = p && p.alive;
    switch (ph) {
      case 'select':
        UI.banner('Burg wählen!', alive ? (isTouch ? 'Tippe' : 'Klicke') + ' auf eine Burg mit Pfeil' : '');
        Voice.say('Wähle deine Burg!'); break;
      case 'cannon':
        UI.banner('Kanonen aufstellen', alive ? (p.cannonsToPlace + p.superToPlace) + ' neue Kanone' + (p.cannonsToPlace + p.superToPlace === 1 ? '' : 'n') + (p.superToPlace ? ' inkl. Super-Kanone' : '') : '');
        Voice.say('Kanonen aufstellen!'); Sfx.clank(); break;
      case 'ready':
        UI.banner('Bereitmachen!'); Voice.say('Bereitmachen!', true);
        setTimeout(() => { if (G.view === V && V.phase === 'ready') { UI.banner('Zielen!'); Voice.say('Zielen!'); } }, 1500);
        break;
      case 'battle': UI.banner('Feuer frei!'); Voice.say('Feuer frei!', true); Sfx.horn(); break;
      case 'cease': UI.banner('Feuer einstellen!'); Voice.say('Feuer einstellen!', true); break;
      case 'build': UI.banner('Mauern reparieren!', alive ? 'Schließe deine Burg wieder komplett ein' : ''); Voice.say('Mauern reparieren!', true); break;
      case 'score': {
        if (alive && !V.result) {
          const n = V.castles.filter(c => c.owner === G.me && c.encl === p.team).length;
          if (n) note('✔ ' + n + ' Burg' + (n > 1 ? 'en' : '') + ' umschlossen – weiter geht’s!');
        }
        break;
      }
    }
    computeFocus();
    const touchPlayer = isTouch && alive && G.me2 < 0;
    setCamMode(touchPlayer && (ph === 'build' || ph === 'cannon' || ph === 'select') ? 'focus' : 'fit');
    if (alive && (ph === 'build' || ph === 'cannon') && (isTouch || !Aim.has)) defaultAim();
    if (G.me2 >= 0 && (ph === 'build' || ph === 'cannon') && !Aim2.has) defaultAim2();
    UI.infoKey = ''; UI.btnKey = '';
  }

  function onOver(result) {
    if (!result || G.resultShown) return;
    G.resultShown = true;
    Sfx.victory();
    Voice.say(result.teamMode ? result.label + ' gewinnt!' : result.label + ' gewinnt!', true);
    UI.banner(result.label + ' gewinnt!', result.reason === 'rounds' ? 'Rundenlimit erreicht – die meisten Punkte zählen' : 'Letzte Festung steht!');
    recordLocalStats(result);
    setTimeout(() => { if (G.view && G.view.result === result || G.resultShown) UI.showEnd(result); }, 2200);
  }

  function recordLocalStats(result) {
    const st = store.get('stats', {});
    for (const pid of [G.me, G.me2]) {
      if (pid < 0) continue;
      const pr = result.players.find(x => x.id === pid);
      if (!pr) continue;
      const key = pr.name.toLowerCase();
      const e = st[key] || (st[key] = { name: pr.name, games: 0, wins: 0, walls: 0, cannons: 0, castles: 0, ships: 0, shots: 0, hits: 0, best: 0 });
      e.games++; if (result.winners.includes(pid)) e.wins++;
      e.walls += pr.stats.walls; e.cannons += pr.stats.cannons; e.castles += pr.stats.captured; e.ships += pr.stats.ships;
      e.shots += pr.stats.shots; e.hits += pr.stats.hits; e.best = Math.max(e.best, pr.score);
    }
    store.set('stats', st);
  }

  // ------------------------------------------------------------------
  // Oberfläche
  // ------------------------------------------------------------------
  const UI = {
    inGame: false, autoJoin: null, cur: 'menu', prev: 'menu', infoKey: '', btnKey: '', chipKey: '', toastT: 0,
    name() { return (($('#in-name').value || store.get('name', '')) + '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || 'Ritter'; },
    show(name) {
      for (const s of ['menu', 'lobby', 'help', 'board']) $('#scr-' + s).classList.toggle('hidden', s !== name);
      if (name !== this.cur) { this.prev = this.cur; this.cur = name; }
      if (!this.inGame && G.mode !== 'attract' && !G.view) startAttract();
    },
    hideScreens() { for (const s of ['menu', 'lobby', 'help', 'board']) $('#scr-' + s).classList.add('hidden'); this.cur = 'none'; },
    isScreen(n) { return this.cur === n; },
    toast(msg, err) {
      const t = $('#toast');
      t.textContent = msg; t.classList.toggle('err', !!err);
      t.classList.add('show');
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => t.classList.remove('show'), err ? 2200 : 2800);
    },
    banner(text, sub) {
      if (!this.inGame) return;
      const b = $('#banner');
      b.innerHTML = escapeHtml(text) + (sub ? '<small>' + escapeHtml(sub) + '</small>' : '');
      b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    },
    showEnd(r) {
      const meWin = r.winners.includes(G.me) || r.winners.includes(G.me2);
      $('#end-crown').textContent = meWin ? '👑' : G.me >= 0 ? '🏳️' : '🏆';
      $('#end-title').textContent = r.label + ' gewinnt!';
      $('#end-title').style.color = r.color;
      $('#end-sub').textContent = (r.reason === 'rounds' ? 'Nach ' + r.round + ' Runden entscheiden die Punkte.' : 'Die letzte Festung steht nach ' + r.round + ' Runde' + (r.round === 1 ? '' : 'n') + '.') + (meWin ? ' Glückwunsch!' : '');
      const rows = r.players.slice().sort((a, b) => b.score - a.score).map(p => {
        const acc = p.stats.shots ? Math.round(p.stats.hits / p.stats.shots * 100) : 0;
        return '<tr class="' + (isMine(p.id) ? 'me ' : '') + (p.alive ? '' : 'dead') + '"><td><span class="pdot" style="background:' + p.color + '"></span>' + escapeHtml(p.name) + (p.bot ? ' 🤖' : '') + (r.winners.includes(p.id) ? ' 👑' : '') + '</td>' +
          '<td>' + p.score + '</td><td>' + p.stats.walls + '</td><td>' + p.stats.cannons + '</td><td>' + p.stats.captured + '</td><td>' + p.stats.ships + '</td><td>' + acc + ' %</td></tr>';
      }).join('');
      $('#end-table').innerHTML = '<thead><tr><th>Spieler</th><th>Punkte</th><th>Mauern</th><th>Kanonen</th><th>Burgen</th><th>Schiffe</th><th>Treffer</th></tr></thead><tbody>' + rows + '</tbody>';
      const canAgain = G.mode === 'local' || (G.room && G.room.host === G.room.you);
      $('#btn-again').classList.toggle('hidden', !canAgain);
      $('#end-wait').classList.toggle('hidden', canAgain || G.mode !== 'online');
      $('#scr-end').classList.remove('hidden');
    }
  };

  function updateHUD() {
    const V = G.view; if (!V) return;
    const now = G.now();
    const rem = Math.max(0, V.phaseEnd - now);
    const dur = PHASE_DUR[V.phase] || 1;
    const sec = Math.ceil(rem);
    const nameTxt = (PHASE_LABEL[V.phase] || '') + (V.phase !== 'over' && V.phase !== 'score' ? ' · ' + sec + ' s' : '');
    const pn = $('#phase-name'); if (pn.textContent !== nameTxt) pn.textContent = nameTxt;
    $('#phase-bar i').style.transform = 'scaleX(' + clamp(rem / dur, 0, 1).toFixed(3) + ')';
    $('#phase-bar').classList.toggle('warn', rem < 5 && (V.phase === 'build' || V.phase === 'battle'));
    const rt = V.round ? 'Runde ' + V.round + (V.settings.rounds ? '/' + V.settings.rounds : '') : 'Start';
    const hr = $('#hud-round'); if (hr.textContent !== rt) hr.textContent = rt;
    if (sec !== G.lastSec) {
      G.lastSec = sec;
      if (sec <= 3 && sec > 0 && (V.phase === 'build' || V.phase === 'battle' || V.phase === 'cannon' || V.phase === 'select')) Sfx.tick();
    }
    // Spieler-Chips
    const ck = V.playerVer + '|' + V.castleVer + '|' + V.phase;
    const pnow = performance.now();
    if (ck !== UI.chipKey || (V.statVer !== UI.chipStat && pnow - (UI.chipT || 0) > 450)) { UI.chipKey = ck; UI.chipStat = V.statVer; UI.chipT = pnow; renderChips(); }
    // Info & Buttons
    const p = myP();
    const ready = p && V.phase === 'battle' ? V.cannons.filter(c => c.owner === G.me && c.active && c.readyAt <= now).length : 0;
    const ik = V.phase + '|' + V.playerVer + '|' + V.cannonVer + '|' + G.rot + '|' + ready + '|' + (p && p.alive);
    if (ik !== UI.infoKey) { UI.infoKey = ik; renderInfo(ready); }
    const bk = V.phase + '|' + V.playerVer + '|' + (p && p.alive);
    if (bk !== UI.btnKey) { UI.btnKey = bk; renderButtons(); }
  }

  function renderChips() {
    const V = G.view;
    const cnt = (p) => V.castles.filter(c => c.owner === p.id && c.encl === p.team).length;
    const chip = (p) => '<div class="pchip' + (isMine(p.id) ? ' me' : '') + (p.alive ? '' : ' dead') + '"><span class="dot" style="background:' + p.color + '"></span>' +
      '<span class="pn">' + escapeHtml(p.name) + '</span>' + (p.bot ? '🤖' : '') + ' <span class="cs">♜' + cnt(p) + '</span> <span class="sc">' + p.score + '</span></div>';
    let html = '';
    if (V.teamMode) {
      for (let t = 0; t < V.teamCount; t++) {
        const ps = V.players.filter(p => p.team === t);
        html += '<div class="pchip team-sep" style="color:' + E.TEAM_COLORS[t] + '">' + E.TEAM_NAMES[t] + ' ' + E.teamScore(V, t) + '</div>' + ps.map(chip).join('');
      }
    } else html = V.players.map(chip).join('');
    $('#hud-players').innerHTML = html;
  }

  function pieceCanvas(kind, rot, color, size) {
    const c = document.createElement('canvas');
    const px = size * 2;
    c.width = px; c.height = px;
    const g = c.getContext('2d');
    const cells = E.pieceCells(kind, rot);
    let bw = 0, bh = 0; for (const [x, y] of cells) { bw = Math.max(bw, x + 1); bh = Math.max(bh, y + 1); }
    const cs = Math.floor(px / Math.max(4, Math.max(bw, bh) + 0.5));
    const ox = (px - bw * cs) / 2, oy = (px - bh * cs) / 2;
    for (const [x, y] of cells) {
      g.fillStyle = mix('#e6dcc6', color, 0.35); g.fillRect(ox + x * cs + 1, oy + y * cs + 1, cs - 2, cs - 2);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(ox + x * cs + 1, oy + y * cs + cs * 0.72, cs - 2, cs * 0.28 - 1);
    }
    c.style.width = size + 'px'; c.style.height = size + 'px';
    return c;
  }

  function renderInfo(ready) {
    const V = G.view, p = myP(), box = $('#hud-info');
    box.innerHTML = '';
    if (G.me < 0) { box.textContent = '👀 Du schaust zu'; return; }
    if (!p.alive) { box.textContent = V.phase === 'over' ? '' : '💀 Ausgeschieden – du schaust zu'; return; }
    switch (V.phase) {
      case 'select': box.textContent = p.home >= 0 ? '✔ Burg gewählt – warte auf die anderen' : '🏰 ' + (isTouch ? 'Tippe' : 'Klicke') + ' auf eine Burg mit Pfeil'; break;
      case 'cannon': {
        const n = p.cannonsToPlace + p.superToPlace;
        box.textContent = n ? '🧨 ' + n + ' Kanone' + (n === 1 ? '' : 'n') + ' setzen' + (p.superToPlace ? ' (👑 Super-Kanone zuerst)' : '') : '✔ Alle Kanonen stehen';
        break;
      }
      case 'battle': case 'cease': case 'ready': {
        const tot = V.cannons.filter(c => c.owner === G.me).length;
        let t = '💣 ' + ready + '/' + tot + ' bereit';
        if (p.special) t += ' · <span class="amm">' + (p.special.type === 'fire' ? '🔥 Brand' : '✸ Streu') + ' ×' + p.special.n + (p.specialArmed ? ' (aktiv)' : ' (aus)') + '</span>';
        if (p.repairCrew) t += ' · 🔧×' + p.repairCrew;
        box.innerHTML = t; break;
      }
      case 'build': {
        if (!p.piece) break;
        box.appendChild(pieceCanvas(p.piece, G.rot, p.color, 46));
        const nx = pieceCanvas(p.next, 0, p.color, 30); nx.className = 'next';
        const sp = document.createElement('span'); sp.textContent = 'Nächstes:'; sp.className = 'nlbl'; sp.style.opacity = 0.7; sp.style.fontSize = '11px';
        box.appendChild(sp); box.appendChild(nx);
        if (p.bastionArmed) { const b = document.createElement('span'); b.textContent = '🛡 Bastion'; b.className = 'amm'; box.appendChild(b); }
        if (G.me2 >= 0) { const p2 = V.players[G.me2]; if (p2 && p2.alive && p2.piece) { const s2 = document.createElement('span'); s2.textContent = ' | P2:'; box.appendChild(s2); box.appendChild(pieceCanvas(p2.piece, G.rot2, p2.color, 34)); } }
        break;
      }
      default: box.textContent = '';
    }
  }

  function renderButtons() {
    const V = G.view, p = myP(), alive = p && p.alive;
    const ph = V.phase;
    const rotB = $('#b-rot'), plB = $('#b-place'), spB = $('#b-special');
    rotB.classList.toggle('hidden', !(alive && ph === 'build'));
    plB.classList.toggle('hidden', !(alive && (ph === 'build' || ph === 'cannon')));
    const showSp = alive && ((ph === 'build' && V.settings.sabotage) || ((ph === 'battle' || ph === 'ready') && p.special));
    spB.classList.toggle('hidden', !showSp);
    spB.classList.toggle('on', !!(alive && ph !== 'build' && p.special && p.specialArmed));
    spB.innerHTML = ph === 'build' ? '⚡<span>Spezial</span>' : (p && p.special && p.special.type === 'fire' ? '🔥' : '✸') + '<span>' + (p && p.specialArmed ? 'Aktiv' : 'Aus') + '</span>';
    $('#sp-skip').disabled = !alive || p.skipUsed;
    $('#sp-bastion').disabled = !alive || (p.bastionUsed && !p.bastionArmed);
    $('#sp-bastion').innerHTML = p && p.bastionArmed ? '🛡 Bastion abbrechen' : '🛡 Bastion <small>(nächstes Teil 2 Treffer)</small>';
    $('#hud-bottom').classList.toggle('hidden', rotB.classList.contains('hidden') && plB.classList.contains('hidden') && spB.classList.contains('hidden'));
    if (!showSp) closeSpecialMenu();
  }

  // ---------- Lobby ----------
  function currentRoom() { return G.localRoom || G.room; }
  function renderLobby() {
    const room = currentRoom(); if (!room) return;
    const local = !!room.local;
    const host = local || room.host === room.you;
    const st = room.settings;
    $('#lobby-title').textContent = local ? (room.twoP ? 'Zu zweit an einem PC' : 'Offline gegen Bots') : 'Raum-Code';
    $('#lobby-code').textContent = local ? 'OFFLINE' : room.code;
    $('#lobby-share').classList.toggle('hidden', local);
    $$('#set-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === st.mode));
    $$('#set-ffa button').forEach(b => b.classList.toggle('on', +b.dataset.v === st.ffa));
    $$('#set-rounds button').forEach(b => b.classList.toggle('on', +b.dataset.v === st.rounds));
    $('#row-ffa').classList.toggle('hidden', st.mode !== 'ffa');
    for (const k of ['crates', 'pirates', 'citadel', 'sabotage']) $('#set-' + k).checked = !!st[k];
    $('#lobby-settings').classList.toggle('locked', !host);
    $$('#lobby-settings .seg').forEach(s => s.classList.toggle('locked', !host));
    $$('#lobby-settings input').forEach(i => (i.disabled = !host));
    const lvlName = E.BOT_LEVELS;
    const slotsEl = $('#slots');
    slotsEl.innerHTML = '';
    room.slots.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'slot ' + s.kind + (s.you ? ' you' : '') + (s.online === false ? ' offline' : '');
      d.style.borderColor = s.kind !== 'open' ? s.color : '';
      let sub = '';
      if (s.kind === 'bot') sub = '🤖 Bot · ' + lvlName[s.level];
      else if (s.kind === 'human') sub = (s.you ? 'Du' : 'Mensch') + (s.host ? ' · Gastgeber' : '') + (s.online === false ? ' · offline' : '');
      else sub = host ? 'Bot hinzufügen →' : 'Tippen zum Wechseln';
      d.innerHTML = '<span class="dot" style="background:' + s.color + '"></span><div class="nm">' + (s.kind === 'open' ? 'Frei' : escapeHtml(s.name)) + '<small>' + escapeHtml(s.colorName + ' · ' + sub) + '</small></div><div class="acts"></div>' +
        (st.mode !== 'ffa' ? '<span class="team-tag" style="background:' + E.TEAM_COLORS[s.team] + '">Team ' + E.TEAM_NAMES[s.team] + '</span>' : '');
      const acts = d.querySelector('.acts');
      if (host && s.kind !== 'human') {
        for (const lv of ['easy', 'mid', 'pro']) {
          const b = document.createElement('button');
          b.textContent = { easy: 'L', mid: 'M', pro: 'P' }[lv];
          b.title = lvlName[lv];
          if (s.kind === 'bot' && s.level === lv) b.classList.add('on');
          b.onclick = (ev) => { ev.stopPropagation(); lobbyAct({ a: 'bot', slot: i, level: lv }); };
          acts.appendChild(b);
        }
        if (s.kind === 'bot') {
          const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Bot entfernen';
          x.onclick = (ev) => { ev.stopPropagation(); lobbyAct({ a: 'bot', slot: i, level: null }); };
          acts.appendChild(x);
        }
      } else if (host && s.kind === 'human' && !s.you && !local) {
        const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Auf Zuschauerbank setzen';
        x.onclick = (ev) => { ev.stopPropagation(); lobbyAct({ a: 'kick', slot: i }); };
        acts.appendChild(x);
      }
      if (s.kind === 'open') d.onclick = () => lobbyAct({ a: 'move', slot: i });
      slotsEl.appendChild(d);
    });
    const open = room.slots.filter(s => s.kind === 'open').length;
    $('#fill-row').classList.toggle('hidden', !host || !open);
    $('#slot-hint').textContent = local ? '– L / M / P = Bot-Stärke (Leicht, Mittel, Büro-Profi)' : '– tippe auf einen freien Platz, um dorthin zu wechseln';
    $('#btn-start').classList.toggle('hidden', !host);
    $('#lobby-wait').classList.toggle('hidden', host);
    const occ = room.slots.filter(s => s.kind !== 'open').length;
    $('#btn-start').disabled = st.mode === 'ffa' ? occ < 2 : open > 0;
    $('#btn-start').textContent = st.mode !== 'ffa' && open > 0 ? 'Plätze füllen …' : '⚔️ Spiel starten';
    const sp = room.spectators || [];
    $('#lobby-spect').textContent = sp.length ? '👀 Zuschauer: ' + sp.join(', ') : (local ? '' : 'Teile den Link – Freunde landen direkt in deinem Raum.');
  }

  function lobbyAct(m) {
    const room = currentRoom(); if (!room) return;
    if (!room.local) { Net.send(Object.assign({ t: 'lobby' }, m)); return; }
    const st = room.settings;
    switch (m.a) {
      case 'settings': Object.assign(st, m.v); layoutLocal(room); break;
      case 'bot': {
        const s = room.slots[m.slot]; if (!s || s.kind === 'human') break;
        if (!m.level) Object.assign(s, { kind: 'open', name: '', level: null });
        else if (s.kind === 'bot') s.level = m.level;
        else Object.assign(s, { kind: 'bot', name: localBotName(room), level: m.level });
        break;
      }
      case 'fill': for (const s of room.slots) if (s.kind === 'open') Object.assign(s, { kind: 'bot', name: localBotName(room), level: m.level }); break;
      case 'move': {
        const s = room.slots[m.slot]; if (!s || s.kind !== 'open') break;
        const cur = room.slots.find(x => x.kind === 'human' && x.hid === 1);
        if (cur) { Object.assign(s, { kind: 'human', name: cur.name, hid: 1, you: true }); Object.assign(cur, { kind: 'open', name: '', hid: 0, you: false }); }
        break;
      }
    }
    store.set('localSettings', st);
    renderLobby();
  }
  function localBotName(room) {
    const used = new Set(room.slots.map(s => s.name));
    const pool = E.BOT_NAMES.filter(n => !used.has(n));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'Bot';
  }
  function newLocalRoom(twoP) {
    const def = { mode: 'ffa', ffa: twoP ? 2 : 4, rounds: 8, crates: true, pirates: true, citadel: true, sabotage: true };
    const settings = Object.assign(def, twoP ? { ffa: 2 } : store.get('localSettings', {}));
    const room = { local: true, twoP, settings, slots: [], spectators: [] };
    layoutLocal(room);
    return room;
  }
  function layoutLocal(room) {
    const st = room.settings;
    const n = st.mode === 'ffa' ? clamp(st.ffa | 0, 2, 6) : E.MODES[st.mode].teams.length;
    const lay = E.slotLayout(st.mode, n);
    const old = room.slots || [];
    const bots = old.filter(s => s.kind === 'bot');
    const next = lay.map(l => Object.assign({ kind: 'open', name: '', level: null, hid: 0, you: false }, l));
    next[0] = Object.assign(next[0], { kind: 'human', name: UI.name(), hid: 1, you: true });
    if (room.twoP && next[1]) next[1] = Object.assign(next[1], { kind: 'human', name: 'Spieler 2', hid: 2, you: true });
    let bi = 0;
    for (const s of next) {
      if (s.kind !== 'open') continue;
      const b = bots[bi++];
      Object.assign(s, { kind: 'bot', name: b ? b.name : '', level: b ? b.level : 'mid' });
    }
    room.slots = next;
    for (const s of next) if (s.kind === 'bot' && !s.name) s.name = localBotName(room);
  }

  // ---------- Spielstart / -ende ----------
  function enterGame() {
    UI.inGame = true;
    UI.hideScreens();
    $('#scr-end').classList.add('hidden');
    $('#scr-pause').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    G.silent = false; G.paused = false; G.resultShown = false; G.rot = 0; G.rot2 = 0; G.lastSec = -1;
    R.parts = []; R.waves = []; R.floats = []; R.cam.init = false; R.cam.manual = false;
    Aim.has = false; Aim2.has = false;
    UI.chipKey = ''; UI.infoKey = ''; UI.btnKey = '';
    resize();
    if (G.view.phase !== 'over') onPhase(G.view.phase);
    else if (G.view.result) onOver(G.view.result);
  }
  function startLocal() {
    const room = G.localRoom; if (!room) return;
    const st = room.settings;
    const occ = room.slots.filter(s => s.kind !== 'open');
    if (st.mode === 'ffa' && occ.length < 2) return UI.toast('Mindestens 2 Spieler nötig.', true);
    if (st.mode !== 'ffa' && occ.length < room.slots.length) return UI.toast('Bitte alle Plätze besetzen.', true);
    const slots = occ.map((s, k) => ({ name: s.kind === 'human' && s.hid === 1 ? UI.name() : s.name, bot: s.kind === 'bot' ? s.level : null, team: st.mode === 'ffa' ? k : s.team, color: s.color, colorName: s.colorName }));
    G.local = E.createGame({ seed: (Math.random() * 4294967295) >>> 0, mode: st.mode, slots, settings: { rounds: st.rounds, crates: st.crates, pirates: st.pirates, citadel: st.citadel, sabotage: st.sabotage } });
    E.drainEvents(G.local);
    G.view = G.local; G.mode = 'local';
    G.me = occ.findIndex(s => s.hid === 1); G.me2 = occ.findIndex(s => s.hid === 2);
    enterGame();
  }
  function startOnline(m) {
    G.view = E.viewFromInit(m.init); G.local = null;
    G.me = m.you; G.me2 = -1; G.mode = 'online'; G.recvAt = performance.now();
    G.localRoom = null;
    enterGame();
    if (G.me < 0) UI.toast('👀 Das Spiel läuft schon – du schaust zu.');
  }
  function stopGame() {
    UI.inGame = false;
    $('#hud').classList.add('hidden');
    $('#scr-end').classList.add('hidden');
    $('#scr-pause').classList.add('hidden');
    $('#rotate-hint').classList.add('hidden');
    G.view = null; G.local = null; G.mode = 'none'; G.me = -1; G.me2 = -1;
    if (window.speechSynthesis) speechSynthesis.cancel();
    startAttract();
  }
  function quitGame() {
    if (G.mode === 'online') { Net.send({ t: 'leave' }); G.room = null; setUrlRoom(null); }
    G.localRoom = null;
    stopGame();
    UI.show('menu');
  }
  function togglePause() {
    const el = $('#scr-pause');
    const show = el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
    if (G.mode === 'local') G.paused = show;
  }

  // ---------- Attract-Modus (Bots kämpfen im Hintergrund des Menüs) ----------
  function startAttract() {
    const lay = E.slotLayout('ffa', 4);
    G.local = E.createGame({
      seed: (Math.random() * 4294967295) >>> 0, mode: 'ffa',
      slots: lay.map((l, i) => Object.assign({ name: E.BOT_NAMES[(i * 3) % E.BOT_NAMES.length], bot: ['pro', 'mid', 'pro', 'mid'][i] }, l)),
      settings: { rounds: 0, crates: true, pirates: true, citadel: true, sabotage: true }
    });
    E.drainEvents(G.local);
    G.view = G.local; G.mode = 'attract'; G.me = -1; G.me2 = -1; G.silent = true;
    R.cam.init = false; R.cam.mode = 'fit'; R.cam.manual = false; R.parts = []; R.waves = [];
    resize();
  }

  // ---------- Rangliste ----------
  function showBoard(tab) {
    UI.show('board');
    $$('#board-tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
    const tbl = $('#board-table'), stEl = $('#board-status');
    const head = '<thead><tr><th>#</th><th>Name</th><th>Siege</th><th>Spiele</th><th>Mauern</th><th>Burgen</th><th>Kanonen</th><th>Treffer</th></tr></thead>';
    const rows = (list) => list.map((e, k) => {
      const acc = e.shots ? Math.round(e.hits / e.shots * 100) : 0;
      return '<tr' + (e.name.toLowerCase() === UI.name().toLowerCase() ? ' class="me"' : '') + '><td>' + (k + 1) + '</td><td>' + escapeHtml(e.name) + '</td><td>' + e.wins + '</td><td>' + e.games + '</td><td>' + e.walls + '</td><td>' + e.castles + '</td><td>' + e.cannons + '</td><td>' + acc + ' %</td></tr>';
    }).join('');
    if (tab === 'local') {
      const list = Object.values(store.get('stats', {})).sort((a, b) => b.wins - a.wins || b.games - a.games);
      tbl.innerHTML = head + '<tbody>' + rows(list) + '</tbody>';
      stEl.textContent = list.length ? 'Alle Spiele auf diesem Gerät (online & offline).' : 'Noch keine Spiele auf diesem Gerät.';
      return;
    }
    tbl.innerHTML = head;
    stEl.textContent = 'Lade Rangliste …';
    fetch('api/leaderboard', { cache: 'no-store' }).then(r => r.json()).then(d => {
      tbl.innerHTML = head + '<tbody>' + rows(d.players || []) + '</tbody>';
      stEl.textContent = (d.players && d.players.length ? '' : 'Noch keine Online-Spiele. ') + 'Gespielte Online-Partien: ' + (d.games || 0);
    }).catch(() => { stEl.textContent = 'Server nicht erreichbar – schau unter „Dieses Gerät“.'; });
  }

  // ---------- Teilen ----------
  function inviteText(code) {
    return '⚔️ Komm in meine Festung! Ich spiele RENE\'S RAMPART – Burgen bauen, Kanonen feuern, Mauern flicken. Raum-Code: ' + code + '\n👉 ' + roomLink(code);
  }
  function shareResultText(r) {
    const me = r.players.find(p => isMine(p.id));
    const win = r.winners.includes(G.me);
    const link = location.origin + location.pathname;
    let t = '🏰 RENE\'S RAMPART: ' + r.label + ' hat gewonnen!';
    if (me) {
      const acc = me.stats.shots ? Math.round(me.stats.hits / me.stats.shots * 100) : 0;
      t += '\n' + (win ? '👑 Und ich war dabei – Sieg!' : '😤 Ich wurde knapp überrannt …');
      t += '\n💥 ' + me.name + ': ' + me.stats.walls + ' Mauern zerbröselt, ' + me.stats.cannons + ' Kanonen erledigt, ' + me.stats.captured + ' Burgen eingesackt, Trefferquote ' + acc + ' %.';
      if (acc >= 60) t += '\n🎯 Scharfschütze des Tages!';
      else if (me.stats.walls >= 40) t += '\n🏚️ Abrissbirne vom Dienst!';
      else if (me.stats.ships >= 2) t += '\n🏴‍☠️ Schrecken der Piraten!';
      else if (me.stats.crates >= 3) t += '\n📦 Kistenjäger-Ehrenabzeichen!';
    }
    t += '\nTraust du dich? 👉 ' + (G.room && G.mode === 'online' ? roomLink(G.room.code) : link);
    return t;
  }
  function openWA(text) {
    const url = 'https://wa.me/?text=' + encodeURIComponent(text);
    const w = window.open(url, '_blank');
    if (!w) location.href = url;
  }

  // ------------------------------------------------------------------
  // Knöpfe verdrahten
  // ------------------------------------------------------------------
  function wire() {
    const nameIn = $('#in-name');
    nameIn.value = store.get('name', '');
    nameIn.addEventListener('input', () => { store.set('name', nameIn.value.trim().slice(0, 16)); });
    nameIn.addEventListener('change', () => { if (G.room && Net.ready) Net.send({ t: 'name', name: UI.name() }); });
    const needName = () => {
      if (!nameIn.value.trim()) { nameIn.focus(); UI.toast('Bitte gib zuerst deinen Namen ein.', true); return false; }
      store.set('name', UI.name()); return true;
    };
    $('#btn-create').onclick = () => { Sfx.unlock(); Voice.unlock(); if (!needName()) return; G.localRoom = null; Net.send({ t: 'create', name: UI.name() }); };
    const join = () => {
      Sfx.unlock(); Voice.unlock();
      if (!needName()) return;
      const code = $('#in-code').value.trim().toUpperCase();
      if (code.length !== 4) { UI.toast('Der Raum-Code hat 4 Zeichen.', true); return; }
      G.localRoom = null;
      Net.send({ t: 'join', code, name: UI.name() });
    };
    $('#btn-join').onclick = join;
    $('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
    $('#btn-offline').onclick = () => { Sfx.unlock(); Voice.unlock(); store.set('name', UI.name()); G.localRoom = newLocalRoom(false); UI.show('lobby'); renderLobby(); };
    $('#btn-local2').onclick = () => { Sfx.unlock(); Voice.unlock(); store.set('name', UI.name()); G.localRoom = newLocalRoom(true); UI.show('lobby'); renderLobby(); };
    $('#btn-board').onclick = () => showBoard(G.online ? 'online' : 'local');
    $$('#board-tabs button').forEach(b => (b.onclick = () => showBoard(b.dataset.v)));
    $('#btn-help').onclick = () => UI.show('help');
    $$('[data-back]').forEach(b => (b.onclick = () => {
      if (UI.inGame) { UI.hideScreens(); return; }
      UI.show(UI.prev && UI.prev !== UI.cur && UI.prev !== 'none' ? UI.prev : 'menu');
    }));
    $('#btn-fs').onclick = toggleFS; $('#h-fs').onclick = toggleFS;
    $('#btn-sound').onclick = toggleSound; $('#h-sound').onclick = toggleSound;
    $('#h-zoom').onclick = toggleZoom;
    $('#h-menu').onclick = togglePause;
    $('#p-resume').onclick = togglePause;
    $('#p-voice').onclick = () => { Voice.setOn(!Voice.on); updateSoundButtons(); if (Voice.on) Voice.say('Sprachausgabe an'); };
    $('#p-help').onclick = () => { $('#scr-pause').classList.add('hidden'); if (G.mode === 'local') G.paused = true; UI.show('help'); $('#scr-help').classList.remove('hidden'); };
    $('#p-quit').onclick = () => { $('#scr-pause').classList.add('hidden'); quitGame(); };
    // Hilfe aus dem Spiel heraus schließen -> Pause aufheben
    $('#scr-help [data-back]').addEventListener('click', () => { if (UI.inGame) { $('#scr-help').classList.add('hidden'); G.paused = false; } });

    // Lobby
    $$('#set-mode button').forEach(b => (b.onclick = () => lobbyAct({ a: 'settings', v: { mode: b.dataset.v } })));
    $$('#set-ffa button').forEach(b => (b.onclick = () => lobbyAct({ a: 'settings', v: { ffa: +b.dataset.v } })));
    $$('#set-rounds button').forEach(b => (b.onclick = () => lobbyAct({ a: 'settings', v: { rounds: +b.dataset.v } })));
    for (const k of ['crates', 'pirates', 'citadel', 'sabotage']) $('#set-' + k).onchange = (e) => lobbyAct({ a: 'settings', v: { [k]: e.target.checked } });
    $$('[data-fill]').forEach(b => (b.onclick = () => lobbyAct({ a: 'fill', level: b.dataset.fill })));
    $('#btn-start').onclick = () => {
      Sfx.unlock(); Voice.unlock();
      const room = currentRoom(); if (!room) return;
      if (room.local) startLocal(); else Net.send({ t: 'lobby', a: 'start' });
    };
    $('#btn-leave').onclick = () => {
      if (G.localRoom) { G.localRoom = null; UI.show('menu'); return; }
      Net.send({ t: 'leave' }); G.room = null; setUrlRoom(null); UI.show('menu');
    };
    $('#btn-wa').onclick = () => { if (G.room) openWA(inviteText(G.room.code)); };
    $('#btn-copy').onclick = () => {
      if (!G.room) return;
      const link = roomLink(G.room.code);
      if (navigator.share && isTouch) { navigator.share({ title: "Rene's Rampart", text: inviteText(G.room.code), url: link }).catch(() => { }); return; }
      const done = () => UI.toast('🔗 Link kopiert: ' + link);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done).catch(() => prompt('Link kopieren:', link));
      else prompt('Link kopieren:', link);
    };

    // Spiel-Knöpfe
    $('#b-rot').onclick = () => rotate(1);
    $('#b-place').onclick = () => { if (!Aim.has) defaultAim(); doPrimary(ctrl1()); };
    $('#b-special').onclick = () => {
      const V = G.view, p = myP(); if (!V || !p) return;
      if (V.phase === 'build') { $('#special-menu').classList.toggle('hidden'); renderButtons(); }
      else if (p.special) { act(G.me, { a: 'arm' }); Sfx.tick(); }
    };
    $('#sp-skip').onclick = () => special('skip');
    $('#sp-bastion').onclick = () => special('bastion');

    // Spielende
    $('#btn-share').onclick = () => { const r = G.view && G.view.result; if (r) openWA(shareResultText(r)); };
    $('#btn-again').onclick = () => {
      $('#scr-end').classList.add('hidden');
      if (G.mode === 'local') {
        const room = G.localRoom;
        if (room) { stopGame(); G.localRoom = room; startLocal(); }
        else quitGame();
      } else if (G.mode === 'online') Net.send({ t: 'rematch' });
    };
    $('#btn-menu').onclick = () => { $('#scr-end').classList.add('hidden'); quitGame(); };

    // Installation
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
    $('#btn-install').onclick = () => {
      if (deferred) { deferred.prompt(); deferred.userChoice.finally(() => { deferred = null; }); }
      else $('#scr-install').classList.remove('hidden');
    };
    $('#scr-install [data-close]').onclick = () => $('#scr-install').classList.add('hidden');
    if (standalone) { $('#btn-install').classList.add('hidden'); $('#install-hint').classList.add('hidden'); }
    $('#rh-close').onclick = () => { store.set('rhint', true); $('#rotate-hint').classList.add('hidden'); };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && G.mode === 'local' && UI.inGame && !G.paused) togglePause();
    });
    updateSoundButtons();
  }

  // ------------------------------------------------------------------
  // Hauptschleife
  // ------------------------------------------------------------------
  let lastT = performance.now();
  function loop(t) {
    const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    try {
      if ((G.mode === 'local' && !G.paused) || G.mode === 'attract') {
        const s = G.local;
        let rem = dt * (G.mode === 'attract' ? 1.4 : 1);
        while (rem > 1e-6) { const st = Math.min(rem, 0.05); E.step(s, st); rem -= st; }
        const evs = E.drainEvents(s);
        if (s.dirty.length) { for (const i of s.dirty) s.dflag[i] = 0; s.dirty.length = 0; }
        handleEvents(evs);
        if (G.mode === 'attract' && s.phase === 'over' && s.time > s.phaseStart + 5) startAttract();
      }
      render(dt);
      if (UI.inGame && G.view) updateHUD();
    } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  function boot() {
    wire();
    const params = new URLSearchParams(location.search);
    const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (roomParam) $('#in-code').value = roomParam;
    if (params.has('debug')) window.__rr = { G, R, UI, E, Net, Sfx, Voice, startLocal, quitGame };
    resize();
    startAttract();
    UI.show('menu');
    requestAnimationFrame(loop);
    if (location.protocol === 'file:') { setServerStatus(false); return; }
    const ctl = window.AbortController ? new AbortController() : null;
    const to = setTimeout(() => ctl && ctl.abort(), 4500);
    fetch('api/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(r => r.json()).then(d => {
      clearTimeout(to);
      if (!d || !d.ok) throw new Error('kein Server');
      if (roomParam) {
        if (store.get('name', '')) UI.autoJoin = roomParam;
        else setTimeout(() => { $('#in-name').focus(); UI.toast('Gib deinen Namen ein und tippe auf „Beitreten“ (Raum ' + roomParam + ').'); }, 400);
      }
      Net.connect();
    }).catch(() => { clearTimeout(to); setServerStatus(false); });
  }
  boot();
})();
