/* =====================================================================
   Rene's Rampart – gemeinsame Spiel-Engine
   Läuft identisch auf dem Server (Node.js) und im Browser (Offline-Modus).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RampartEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------
  // Konstanten
  // ------------------------------------------------------------------
  const T = { SELECT: 15, CANNON: 15, READY: 3, BATTLE: 20, CEASE: 2.5, BUILD: 25, SCORE: 4.5 };
  const MAX_CANNONS = 14;
  const RELOAD = 2.2, RELOAD_SUPER = 2.8;

  const MODES = {
    ffa:     { name: 'Jeder gegen Jeden', short: 'FFA', teams: null },
    '2v2':   { name: '2 gegen 2', short: '2v2', teams: [0, 0, 1, 1] },
    '3v3':   { name: '3 gegen 3', short: '3v3', teams: [0, 0, 0, 1, 1, 1] },
    '2v2v2': { name: '2 gegen 2 gegen 2', short: '2v2v2', teams: [0, 0, 1, 1, 2, 2] }
  };
  const TEAM_NAMES = ['Blau', 'Rot', 'Gold'];
  const TEAM_COLORS = ['#2f80ed', '#e5484d', '#f2b01e'];
  const TEAM_SHADES = [
    ['#2f80ed', '#35c3e6', '#7c6cf6'],
    ['#e5484d', '#f2862e', '#e0479e'],
    ['#f2b01e', '#bcd437', '#f7d774']
  ];
  const TEAM_SHADE_NAMES = [['Blau', 'Himmelblau', 'Indigo'], ['Rot', 'Orange', 'Pink'], ['Gold', 'Limette', 'Sand']];
  const FFA_COLORS = ['#2f80ed', '#e5484d', '#f2b01e', '#3dbb4e', '#9b5de5', '#1fc8b4'];
  const FFA_NAMES = ['Blau', 'Rot', 'Gold', 'Grün', 'Lila', 'Türkis'];
  const BOT_NAMES = ['Ritter Rost', 'Burgfräulein Bit', 'Kanonen-Karl', 'Mauer-Marianne', 'Baron Bolzen',
    'Zinnen-Zenzi', 'Graf Granate', 'Herzog Hammer', 'Lady Lunte', 'Sir Sandsack', 'Gräfin Graben', 'Hauptmann Hacke'];
  const BOT_LEVELS = { easy: 'Leicht', mid: 'Mittel', pro: 'Büro-Profi' };

  const PIECES = {
    '1':  { cells: [[0, 0]], w: 6 },
    'I2': { cells: [[0, 0], [1, 0]], w: 9 },
    'I3': { cells: [[0, 0], [1, 0], [2, 0]], w: 10 },
    'V3': { cells: [[0, 0], [1, 0], [0, 1]], w: 12 },
    'I4': { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], w: 7 },
    'L4': { cells: [[0, 0], [0, 1], [0, 2], [1, 2]], w: 9 },
    'J4': { cells: [[1, 0], [1, 1], [1, 2], [0, 2]], w: 9 },
    'T4': { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], w: 8 },
    'S4': { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], w: 6 },
    'Z4': { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], w: 6 },
    'O4': { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], w: 5 },
    'U5': { cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], w: 4 }
  };
  const PIECE_KEYS = Object.keys(PIECES);
  const PIECE_TOTAL_W = PIECE_KEYS.reduce((a, k) => a + PIECES[k].w, 0);

  const BOT = {
    easy: { sel: [3, 7], can: [1.3, 2.3], fire: [1.4, 2.2], err: 1.8, build: [1.9, 2.7], smart: 0 },
    mid:  { sel: [1.5, 4], can: [0.7, 1.3], fire: [0.8, 1.3], err: 0.9, build: [1.1, 1.6], smart: 1 },
    pro:  { sel: [0.8, 2], can: [0.35, 0.7], fire: [0.4, 0.62], err: 0.25, build: [0.6, 0.9], smart: 2 }
  };

  const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  // ------------------------------------------------------------------
  // Zufall (deterministisch, Mulberry32)
  // ------------------------------------------------------------------
  function makeRng(seed) {
    let a = seed >>> 0;
    const f = function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.state = () => a;
    return f;
  }
  function rnd(s) { // Zufall im Spielzustand (serialisierbar)
    s.rs = (s.rs + 0x6D2B79F5) | 0;
    let t = s.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (s, a, b) => a + rnd(s) * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ------------------------------------------------------------------
  // Slots / Farben
  // ------------------------------------------------------------------
  function slotLayout(mode, ffaCount) {
    const m = MODES[mode] || MODES.ffa;
    const out = [];
    if (!m.teams) {
      const n = clamp(ffaCount | 0 || 2, 2, 6);
      for (let i = 0; i < n; i++) out.push({ team: i, color: FFA_COLORS[i], colorName: FFA_NAMES[i] });
    } else {
      const idx = [0, 0, 0];
      for (const t of m.teams) {
        const k = idx[t]++;
        out.push({ team: t, color: TEAM_SHADES[t][k], colorName: TEAM_SHADE_NAMES[t][k] });
      }
    }
    return out;
  }
  function teamLabel(s, team) {
    if (s.teamMode) return 'Team ' + TEAM_NAMES[team];
    const p = s.players.find(q => q.team === team);
    return p ? p.name : '?';
  }
  function teamColor(s, team) {
    if (s.teamMode) return TEAM_COLORS[team];
    const p = s.players.find(q => q.team === team);
    return p ? p.color : '#888';
  }

  // ------------------------------------------------------------------
  // Kartengenerator
  // ------------------------------------------------------------------
  function mapSize(n) {
    return [[44, 28], [44, 28], [44, 28], [50, 32], [54, 34], [58, 36], [62, 38]][clamp(n, 0, 6)];
  }
  function makeNoise(rng, W, H, cell) {
    const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return function (x, y) {
      const fx = x / cell, fy = y / cell;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  }

  function generateMap(seed, teamsOfSlots, opts) {
    const n = teamsOfSlots.length;
    for (let attempt = 0; attempt < 40; attempt++) {
      const m = tryGenerate((seed + attempt * 7919) >>> 0, teamsOfSlots, opts, attempt >= 25);
      if (m) return m;
    }
    return tryGenerate(seed, teamsOfSlots, opts, true, true);
  }

  function tryGenerate(seed, teams, opts, relaxed, force) {
    const rng = makeRng(seed);
    const n = teams.length;
    const [W, H] = mapSize(n);
    const N = W * H;
    const mcx = W / 2, mcy = H / 2;
    const centerR = Math.max(5.6, Math.min(W, H) * 0.17);
    // Zonen-Zentren auf einer Ellipse – Teampartner liegen nebeneinander
    let start = -Math.PI / 2;
    if (n === 2) start = Math.PI; else if (n === 4) start = -3 * Math.PI / 4; else if (n === 6) start = -5 * Math.PI / 6;
    const rx = W * 0.31, ry = H * 0.29;
    const centers = [];
    for (let i = 0; i < n; i++) {
      const a = start + i * Math.PI * 2 / n;
      centers.push({ x: mcx + Math.cos(a) * rx, y: mcy + Math.sin(a) * ry });
    }
    const n1 = makeNoise(rng, W, H, 7), n2 = makeNoise(rng, W, H, 3.5);
    const m1 = makeNoise(rng, W, H, 6), m2 = makeNoise(rng, W, H, 6);
    const land = new Uint8Array(N), zone = new Uint8Array(N).fill(254);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
        if (edge < 2) continue;
        const ex = (x + 0.5 - mcx) / (W * 0.465), ey = (y + 0.5 - mcy) / (H * 0.455);
        let v = Math.sqrt(ex * ex + ey * ey) + (n1(x, y) - 0.5) * 0.42 + (n2(x, y) - 0.5) * 0.16;
        const dc = Math.hypot(x + 0.5 - mcx, y + 0.5 - mcy);
        if (dc < centerR + 1.5) v = 0;
        if (edge === 2) v += 0.25;
        if (v >= 1) continue;
        // Mäandernde Flüsse zwischen gegnerischen Zonen
        const px = x + 0.5 + (m1(x, y) - 0.5) * 3.4, py = y + 0.5 + (m2(x, y) - 0.5) * 3.4;
        let a = -1, da = 1e9, b = -1, db = 1e9;
        for (let k = 0; k < n; k++) {
          const d = Math.hypot(px - centers[k].x, py - centers[k].y);
          if (d < da) { b = a; db = da; a = k; da = d; } else if (d < db) { b = k; db = d; }
        }
        if (dc >= centerR) {
          if (b >= 0 && teams[a] !== teams[b]) {
            const far = clamp((dc - centerR) / (Math.min(W, H) * 0.45), 0, 1);
            const w = 1.25 + far * 1.3;
            if (db - da < w) continue; // Fluss
          }
          zone[i] = a;
        } else zone[i] = 255;
        land[i] = 1;
      }
    }
    // Kleine Inseln entfernen, kleine Seen füllen
    cleanup(W, H, land, zone);
    // Burgen platzieren
    const castles = [];
    const perZone = n <= 4 ? 3 : 2;
    const clr = new Int8Array(N).fill(-1);
    function clearance(x, y, z) {
      let k = 0;
      for (; k <= 5; k++) {
        let ok = true;
        for (let yy = y - k; yy <= y + 1 + k && ok; yy++) {
          for (let xx = x - k; xx <= x + 1 + k; xx++) {
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) { ok = false; break; }
            const j = yy * W + xx;
            if (!land[j] || zone[j] !== z) { ok = false; break; }
          }
        }
        if (!ok) break;
      }
      return k - 1;
    }
    for (let z = 0; z < n; z++) {
      const cands = [];
      for (let y = 1; y < H - 2; y++) for (let x = 1; x < W - 2; x++) {
        const i = y * W + x;
        if (!land[i] || zone[i] !== z) continue;
        const c = clearance(x, y, z);
        if (c >= 2) cands.push({ x, y, c });
      }
      const homeNeed = relaxed ? 3 : 4;
      const homeC = cands.filter(c => c.c >= homeNeed);
      if (!homeC.length && !force) return null;
      const pool0 = homeC.length ? homeC : cands;
      if (!pool0.length) return null;
      let best = null, bs = -1e9;
      for (const c of pool0) {
        const d = Math.hypot(c.x + 1 - centers[z].x, c.y + 1 - centers[z].y);
        const sc = Math.min(c.c, 5) * 2 - d * 0.35 + rng() * 0.6;
        if (sc > bs) { bs = sc; best = c; }
      }
      const mine = [best];
      for (let k = 1; k < perZone; k++) {
        let b2 = null, s2 = -1e9;
        for (const c of cands) {
          if (c.c < (relaxed ? 2 : 3)) continue;
          let md = 1e9;
          for (const o of mine) md = Math.min(md, Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)));
          if (md < 7) continue;
          const sc = Math.min(md, 12) * 0.8 + Math.min(c.c, 4) + rng() * 0.8;
          if (sc > s2) { s2 = sc; b2 = c; }
        }
        if (b2) mine.push(b2);
      }
      if (mine.length < Math.min(2, perZone) && !relaxed && !force) return null;
      for (const c of mine) castles.push({ x: c.x, y: c.y, zone: z, clr: c.c, citadel: false });
    }
    // Zitadelle / zentrale Burg
    const cx = Math.floor(mcx) - 1, cy = Math.floor(mcy) - 1;
    castles.push({ x: cx, y: cy, zone: 255, clr: 4, citadel: !!opts.citadel });
    // Meeresdistanz (für treibende Kisten & Piratenschiffe)
    const seaDist = new Uint16Array(N).fill(65535);
    const q = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!land[i] && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) { seaDist[i] = 0; q.push(i); }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIR4) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (land[j] || seaDist[j] !== 65535) continue;
        seaDist[j] = seaDist[i] + 1; q.push(j);
      }
    }
    return { W, H, land, zone, castles, centers, seaDist, seed };
  }

  function cleanup(W, H, land, zone) {
    const N = W * H, seen = new Uint8Array(N);
    for (let s0 = 0; s0 < N; s0++) {
      if (seen[s0]) continue;
      const isLand = land[s0];
      const comp = [s0]; seen[s0] = 1;
      let touchesEdge = false;
      for (let h = 0; h < comp.length; h++) {
        const i = comp[h], x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
        for (const [dx, dy] of DIR4) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (seen[j] || land[j] !== isLand) continue;
          seen[j] = 1; comp.push(j);
        }
      }
      if (isLand && comp.length < 14) for (const i of comp) { land[i] = 0; zone[i] = 254; }
      if (!isLand && !touchesEdge && comp.length < 7) {
        for (const i of comp) {
          const x = i % W, y = (i / W) | 0;
          let z = 255;
          for (const [dx, dy] of DIR4) { const j = (y + dy) * W + x + dx; if (land[j]) { z = zone[j]; break; } }
          land[i] = 1; zone[i] = z;
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Spiel erstellen
  // ------------------------------------------------------------------
  function createGame(cfg) {
    const mode = MODES[cfg.mode] ? cfg.mode : 'ffa';
    const slots = cfg.slots;
    const n = slots.length;
    const settings = Object.assign({ rounds: 8, crates: true, pirates: true, citadel: true, sabotage: true }, cfg.settings || {});
    const teamsOfSlots = slots.map(s => s.team);
    const map = generateMap((cfg.seed >>> 0) || 1, teamsOfSlots, { citadel: settings.citadel });
    const W = map.W, H = map.H, N = W * H;
    const s = {
      v: 1, W, H, N, mode, settings, seed: map.seed,
      teamMode: !!MODES[mode].teams,
      teamCount: Math.max(...teamsOfSlots) + 1,
      land: map.land, zone: map.zone, seaDist: map.seaDist,
      zoneTeam: teamsOfSlots.slice(),
      wall: new Int8Array(N).fill(-1), whp: new Uint8Array(N), crater: new Uint8Array(N), fire: new Uint8Array(N),
      terr: new Int8Array(N).fill(-1),
      occT: new Uint8Array(N), occId: new Int32Array(N).fill(-1),
      castles: map.castles.map((c, id) => ({ id, x: c.x, y: c.y, zone: c.zone, clr: c.clr, citadel: c.citadel, owner: -1, home: -1, encl: -1 })),
      cannons: [], balls: [], ships: [], crates: [],
      players: slots.map((sl, i) => ({
        id: i, name: String(sl.name || ('Spieler ' + (i + 1))).slice(0, 16), team: sl.team, color: sl.color, colorName: sl.colorName,
        bot: sl.bot || null, alive: true, home: -1, score: 0,
        cannonsToPlace: 0, superToPlace: 0, piece: null, next: null,
        skipUsed: false, bastionUsed: false, bastionArmed: false, penalty: 0,
        special: null, specialArmed: true, repairCrew: 0, lost: [], lastHitBy: -1,
        stats: { shots: 0, hits: 0, walls: 0, cannons: 0, ships: 0, crates: 0, captured: 0, maxCastles: 0, pieces: 0 },
        ai: { next: 0, focus: -1, focusTeam: -1, focusUntil: 0 }
      })),
      phase: 'select', phaseStart: 0, phaseEnd: T.SELECT, round: 0, time: 0,
      rs: ((cfg.seed >>> 0) ^ 0x9e3779b9) | 0,
      nextId: 1, ev: [], dirty: [], dflag: new Uint8Array(N),
      gridVer: 1, cannonVer: 1, castleVer: 1, playerVer: 1, zoneVer: 1, shipVer: 1, crateVer: 1, statVer: 1,
      comps: [], prevRegion: {}, nextCrate: 0, result: null,
      rangeN: Math.max(22, Math.round(W * 0.5)), rangeS: 0,
      bwCache: {}, pirateField: null
    };
    s.rangeS = s.rangeN * 2;
    for (const c of s.castles) setOcc(s, c.x, c.y, 1, c.id);
    for (const p of s.players) p.ai.next = rr(s, ...(BOT[p.bot] || BOT.mid).sel);
    s.ev.push({ e: 'phase', ph: 'select', rd: 0 });
    return s;
  }

  // ------------------------------------------------------------------
  // Raster-Helfer
  // ------------------------------------------------------------------
  function markDirty(s, i) {
    if (!s.dflag[i]) { s.dflag[i] = 1; s.dirty.push(i); }
    s.gridVer++;
  }
  function setOcc(s, x, y, t, id) {
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
      const i = yy * s.W + xx; s.occT[i] = t; s.occId[i] = t ? id : -1;
    }
  }
  function rebuildOcc(s) {
    s.occT.fill(0); s.occId.fill(-1);
    for (const c of s.castles) setOcc(s, c.x, c.y, 1, c.id);
    for (const c of s.cannons) setOcc(s, c.x, c.y, 2, c.id);
  }
  const inB = (s, x, y) => x >= 0 && y >= 0 && x < s.W && y < s.H;
  function teamOf(s, pid) { return pid >= 0 && s.players[pid] ? s.players[pid].team : -1; }
  function teamWallAt(s, T, i) { const w = s.wall[i]; return w >= 0 && s.players[w].team === T; }
  function zoneOK(s, T, i) { const z = s.zone[i]; return z === 255 || (z < 254 && s.zoneTeam[z] === T); }
  function buildable(s, T, i) {
    return s.land[i] === 1 && s.wall[i] < 0 && s.occT[i] === 0 && !s.crater[i] && !s.fire[i] && zoneOK(s, T, i);
  }
  function cannonById(s, id) { for (const c of s.cannons) if (c.id === id) return c; return null; }
  function aliveTeams(s) {
    const t = new Set();
    for (const p of s.players) if (p.alive) t.add(p.team);
    return [...t];
  }
  function teamScore(s, T) { let v = 0; for (const p of s.players) if (p.team === T) v += p.score; return v; }

  function pieceCells(kind, r) {
    let cells = PIECES[kind] ? PIECES[kind].cells.map(c => c.slice()) : [[0, 0]];
    r = ((r | 0) % 4 + 4) % 4;
    for (let k = 0; k < r; k++) cells = cells.map(([x, y]) => [-y, x]);
    let mx = 1e9, my = 1e9;
    for (const [x, y] of cells) { if (x < mx) mx = x; if (y < my) my = y; }
    return cells.map(([x, y]) => [x - mx, y - my]);
  }
  function randPiece(s) {
    let r = rnd(s) * PIECE_TOTAL_W;
    for (const k of PIECE_KEYS) { r -= PIECES[k].w; if (r <= 0) return k; }
    return 'I2';
  }

  function canPlacePiece(s, pid, kind, ax, ay, r) {
    const p = s.players[pid]; if (!p) return false;
    const cells = pieceCells(kind, r);
    for (const [cx, cy] of cells) {
      const x = ax + cx, y = ay + cy;
      if (!inB(s, x, y)) return false;
      if (!buildable(s, p.team, y * s.W + x)) return false;
    }
    return true;
  }
  function canPlaceCannon(s, pid, x, y) {
    const p = s.players[pid]; if (!p) return false;
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
      if (!inB(s, xx, yy)) return false;
      const i = yy * s.W + xx;
      if (!s.land[i] || s.terr[i] !== p.team || s.wall[i] >= 0 || s.occT[i] || s.crater[i] || s.fire[i]) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Gebiets-Berechnung (Flood-Fill)
  // ------------------------------------------------------------------
  function computeTerritory(s, announce) {
    const { W, H, N } = s;
    const best = new Int32Array(N).fill(0x3fffffff);
    const terr = new Int8Array(N).fill(-1);
    const comps = [];
    const reach = new Uint8Array(N), cid = new Int32Array(N);
    const q = new Int32Array(N);
    for (const T of aliveTeams(s)) {
      reach.fill(0);
      let qh = 0, qt = 0;
      for (let x = 0; x < W; x++) for (const y of [0, H - 1]) {
        const i = y * W + x; if (!reach[i] && !teamWallAt(s, T, i)) { reach[i] = 1; q[qt++] = i; }
      }
      for (let y = 0; y < H; y++) for (const x of [0, W - 1]) {
        const i = y * W + x; if (!reach[i] && !teamWallAt(s, T, i)) { reach[i] = 1; q[qt++] = i; }
      }
      while (qh < qt) {
        const i = q[qh++], x = i % W, y = (i / W) | 0;
        if (x > 0) { const j = i - 1; if (!reach[j] && !teamWallAt(s, T, j)) { reach[j] = 1; q[qt++] = j; } }
        if (x < W - 1) { const j = i + 1; if (!reach[j] && !teamWallAt(s, T, j)) { reach[j] = 1; q[qt++] = j; } }
        if (y > 0) { const j = i - W; if (!reach[j] && !teamWallAt(s, T, j)) { reach[j] = 1; q[qt++] = j; } }
        if (y < H - 1) { const j = i + W; if (!reach[j] && !teamWallAt(s, T, j)) { reach[j] = 1; q[qt++] = j; } }
      }
      cid.fill(-1);
      for (let s0 = 0; s0 < N; s0++) {
        if (reach[s0] || cid[s0] >= 0 || teamWallAt(s, T, s0)) continue;
        const tiles = [s0]; cid[s0] = 1;
        const cs = new Set();
        for (let h = 0; h < tiles.length; h++) {
          const i = tiles[h], x = i % W, y = (i / W) | 0;
          if (s.occT[i] === 1) cs.add(s.occId[i]);
          for (const [dx, dy] of DIR4) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (reach[j] || cid[j] >= 0 || teamWallAt(s, T, j)) continue;
            cid[j] = 1; tiles.push(j);
          }
        }
        if (cs.size) comps.push({ team: T, tiles, castles: [...cs], size: tiles.length });
      }
    }
    for (const c of comps) for (const i of c.tiles) if (c.size < best[i]) { best[i] = c.size; terr[i] = c.team; }
    for (let i = 0; i < N; i++) if (s.terr[i] !== terr[i]) { s.terr[i] = terr[i]; markDirty(s, i); }
    s.comps = comps;
    // Burg-Umschließung
    for (const c of s.castles) {
      const t = terr[c.y * W + c.x];
      if (t !== c.encl) {
        const was = c.encl;
        c.encl = t;
        s.castleVer++;
        if (announce && t >= 0 && was !== t) s.ev.push({ e: 'conq', team: t, cid: c.id });
      }
    }
  }

  function compOfCastle(s, cid) {
    for (const c of s.comps) if (c.castles.includes(cid)) {
      // kleinste Komponente zählt
      let best = c;
      for (const d of s.comps) if (d.castles.includes(cid) && d.size < best.size) best = d;
      return best;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Phasen
  // ------------------------------------------------------------------
  function setPhase(s, ph, dur) {
    s.phase = ph; s.phaseStart = s.time; s.phaseEnd = s.time + dur;
    s.ev.push({ e: 'phase', ph, rd: s.round });
    s.playerVer++;
  }

  function buildRing(s, p, c) {
    for (let y = c.y - 3; y <= c.y + 4; y++) for (let x = c.x - 3; x <= c.x + 4; x++) {
      if (x > c.x - 3 && x < c.x + 4 && y > c.y - 3 && y < c.y + 4) continue;
      if (!inB(s, x, y)) continue;
      const i = y * s.W + x;
      if (s.land[i] && s.wall[i] < 0 && s.occT[i] === 0 && zoneOK(s, p.team, i)) {
        s.wall[i] = p.id; s.whp[i] = 1; markDirty(s, i);
      }
    }
  }

  function selectCastle(s, p, cid) {
    if (s.phase !== 'select') return fail('Die Burgwahl ist vorbei.');
    if (p.home >= 0) return fail('Du hast schon eine Burg gewählt.');
    const c = s.castles[cid | 0];
    if (!c) return fail('Unbekannte Burg.');
    if (c.zone !== p.id) return fail('Wähle eine Burg in deinem Gebiet!');
    if (c.owner >= 0) return fail('Diese Burg ist schon vergeben.');
    c.owner = p.id; c.home = p.id; p.home = c.id;
    buildRing(s, p, c);
    s.castleVer++; s.playerVer++;
    s.ev.push({ e: 'sel', pid: p.id, cid: c.id });
    return ok();
  }

  function bestHomeCastle(s, p) {
    let best = null, bs = -1e9;
    for (const c of s.castles) {
      if (c.zone !== p.id || c.owner >= 0) continue;
      const sc = c.clr * 3 + farFromEnemies(s, p, c) * 0.15;
      if (sc > bs) { bs = sc; best = c; }
    }
    return best;
  }
  function farFromEnemies(s, p, c) {
    let md = 1e9;
    for (const o of s.castles) {
      if (o.zone >= 254 || o.zone === p.id) continue;
      if (s.zoneTeam[o.zone] === p.team) continue;
      md = Math.min(md, Math.hypot(o.x - c.x, o.y - c.y));
    }
    return md === 1e9 ? 0 : md;
  }

  function finishSelect(s) {
    for (const p of s.players) {
      if (p.home < 0) {
        const c = bestHomeCastle(s, p);
        if (c) selectCastle(s, p, c.id);
      }
    }
    computeTerritory(s, false);
    s.round = 1;
    for (const p of s.players) {
      if (p.home < 0) { p.alive = false; continue; }
      p.cannonsToPlace = 3; p.superToPlace = 0;
      p.ai.next = s.time + rr(s, 0.4, 1.2);
    }
    setPhase(s, 'cannon', T.CANNON);
  }

  function startBattle(s) {
    for (const c of s.cannons) {
      const T0 = teamOf(s, c.owner);
      let act = true;
      for (let yy = c.y; yy < c.y + 2; yy++) for (let xx = c.x; xx < c.x + 2; xx++) if (s.terr[yy * s.W + xx] !== T0) act = false;
      c.active = act;
      c.readyAt = s.time + 0.2 + rnd(s) * 0.4;
    }
    s.cannonVer++;
    // Regionen merken (Bots nutzen sie für die Reparatur)
    s.prevRegion = {};
    for (const c of s.castles) {
      if (c.encl < 0) continue;
      const comp = compOfCastle(s, c.id);
      if (comp) s.prevRegion[c.id] = comp.tiles;
    }
    s.bwCache = {};
    s.nextCrate = s.time + rr(s, 2.5, 5);
    for (const p of s.players) { p.ai.next = s.time + rr(s, 0.2, 0.9); p.ai.focus = -1; p.ai.focusUntil = 0; }
    setPhase(s, 'battle', T.BATTLE);
    spawnPirates(s);
  }

  function startBuild(s) {
    for (const b of s.balls) s.ev.push({ e: 'rm', id: b.id });
    s.balls = [];
    for (const sh of s.ships) s.ev.push({ e: 'shipgone', id: sh.id });
    s.ships = []; s.shipVer++;
    for (const c of s.crates) s.ev.push({ e: 'crgone', id: c.id });
    s.crates = []; s.crateVer++;
    computeTerritory(s, false);
    for (const p of s.players) {
      if (!p.alive) continue;
      p.piece = randPiece(s); p.next = randPiece(s);
      p.skipUsed = false; p.bastionUsed = false; p.bastionArmed = false; p.penalty = 0;
      p.ai.next = s.time + rr(s, 0.5, 1.2); p.ai.thick = 0;
      if (p.repairCrew > 0) {
        p.repairCrew--;
        const fixed = [];
        for (let k = p.lost.length - 1; k >= 0 && fixed.length < 3; k--) {
          const i = p.lost[k];
          if (s.wall[i] >= 0 || s.occT[i] || !s.land[i] || !zoneOK(s, p.team, i)) continue;
          s.crater[i] = 0; s.fire[i] = 0;
          s.wall[i] = p.id; s.whp[i] = 1; markDirty(s, i);
          fixed.push(i);
        }
        s.ev.push({ e: 'repair', pid: p.id, tiles: fixed });
      }
      p.lost = [];
    }
    computeTerritory(s, true);
    setPhase(s, 'build', T.BUILD);
  }

  function endBuild(s) {
    computeTerritory(s, false);
    // Burgen gutschreiben
    for (const c of s.castles) {
      if (c.encl < 0) continue;
      const T0 = c.encl;
      if (c.owner >= 0 && s.players[c.owner].team === T0 && s.players[c.owner].alive) continue;
      const comp = compOfCastle(s, c.id);
      const cnt = {};
      if (comp) {
        for (const i of comp.tiles) {
          const x = i % s.W, y = (i / s.W) | 0;
          for (const [dx, dy] of DIR4) {
            const xx = x + dx, yy = y + dy; if (!inB(s, xx, yy)) continue;
            const j = yy * s.W + xx;
            if (teamWallAt(s, T0, j) && s.players[s.wall[j]].alive) cnt[s.wall[j]] = (cnt[s.wall[j]] || 0) + 1;
          }
        }
      }
      let bestP = -1, bc = -1;
      for (const k in cnt) if (cnt[k] > bc) { bc = cnt[k]; bestP = +k; }
      if (bestP < 0) { const pl = s.players.find(p => p.team === T0 && p.alive); bestP = pl ? pl.id : -1; }
      if (bestP >= 0 && c.owner !== bestP) {
        c.owner = bestP;
        s.players[bestP].stats.captured++;
        s.players[bestP].score += 25;
        s.ev.push({ e: 'capture', pid: bestP, cid: c.id });
      }
    }
    s.castleVer++;
    // Punkte & Ausscheiden
    for (const comp of s.comps) {
      const owners = new Set();
      for (const cid of comp.castles) { const o = s.castles[cid].owner; if (o >= 0 && s.players[o].team === comp.team) owners.add(o); }
      if (!owners.size) continue;
      const share = Math.round(comp.size / 2 / owners.size);
      for (const o of owners) s.players[o].score += share;
    }
    const eliminated = [];
    for (const p of s.players) {
      if (!p.alive) continue;
      let cnt = 0;
      for (const c of s.castles) if (c.owner === p.id && c.encl === p.team) { cnt++; p.score += c.home === p.id ? 50 : 30; }
      p.stats.maxCastles = Math.max(p.stats.maxCastles, cnt);
      if (cnt === 0) eliminated.push(p);
    }
    for (const p of eliminated) eliminate(s, p);
    // Krater & Brände kühlen ab
    for (let i = 0; i < s.N; i++) if (s.crater[i] || s.fire[i]) { s.crater[i] = 0; s.fire[i] = 0; markDirty(s, i); }
    if (eliminated.length) computeTerritory(s, false);
    // Sieg prüfen
    const at = aliveTeams(s);
    if (at.length <= 1) {
      s.result = makeResult(s, at.length ? at[0] : bestTeam(s, null), 'last');
    } else if (s.settings.rounds > 0 && s.round >= s.settings.rounds) {
      s.result = makeResult(s, bestTeam(s, at), 'rounds');
    }
    s.playerVer++; s.statVer++;
    setPhase(s, 'score', T.SCORE);
  }

  function bestTeam(s, teams) {
    const list = teams || [...new Set(s.players.map(p => p.team))];
    let bt = list[0], bv = -1e9;
    for (const t of list) { const v = teamScore(s, t); if (v > bv) { bv = v; bt = t; } }
    return bt;
  }

  function makeResult(s, team, reason) {
    const winners = s.players.filter(p => p.team === team).map(p => p.id);
    return {
      team, reason, winners, label: teamLabel(s, team), color: teamColor(s, team), teamMode: s.teamMode, round: s.round,
      players: s.players.map(p => ({ id: p.id, name: p.name, team: p.team, color: p.color, bot: p.bot, alive: p.alive, score: p.score, stats: Object.assign({}, p.stats) }))
    };
  }

  function eliminate(s, p) {
    p.alive = false;
    p.cannonsToPlace = 0; p.superToPlace = 0; p.piece = null; p.next = null;
    const mate = s.players.find(q => q.alive && q.team === p.team && q.id !== p.id);
    s.ev.push({ e: 'elim', pid: p.id, mate: mate ? mate.id : -1 });
    if (mate) {
      for (let i = 0; i < s.N; i++) if (s.wall[i] === p.id) { s.wall[i] = mate.id; markDirty(s, i); }
      for (const c of s.cannons) if (c.owner === p.id) c.owner = mate.id;
      for (const c of s.castles) if (c.owner === p.id) c.owner = mate.id;
    } else {
      for (let i = 0; i < s.N; i++) if (s.wall[i] === p.id) { s.wall[i] = -1; s.whp[i] = 0; markDirty(s, i); }
      s.cannons = s.cannons.filter(c => c.owner !== p.id);
      for (const c of s.castles) if (c.owner === p.id) { c.owner = -1; }
      // Gebiet wird neutral (freies Land)
      if (!s.teamMode || !s.players.some(q => q.team === p.team && q.alive)) {
        for (let i = 0; i < s.N; i++) if (s.zone[i] === p.id) s.zone[i] = 255;
        s.zoneVer++;
        s.ev.push({ e: 'zone', z: p.id });
      }
      rebuildOcc(s);
    }
    s.cannonVer++; s.castleVer++; s.playerVer++;
  }

  function nextRound(s) {
    s.round++;
    for (const p of s.players) {
      if (!p.alive) continue;
      let cnt = 0, sup = 0;
      for (const c of s.castles) {
        if (c.owner !== p.id || c.encl !== p.team) continue;
        cnt += c.home === p.id ? 2 : 1;
        if (c.citadel && s.settings.citadel) sup = 1;
      }
      const have = s.cannons.filter(c => c.owner === p.id).length;
      if (sup && s.cannons.some(c => c.owner === p.id && c.super)) sup = 0;
      p.superToPlace = have < MAX_CANNONS ? sup : 0;
      p.cannonsToPlace = Math.max(0, Math.min(cnt, MAX_CANNONS - have - p.superToPlace));
      p.ai.next = s.time + rr(s, 0.4, 1.2);
    }
    setPhase(s, 'cannon', T.CANNON);
  }

  // ------------------------------------------------------------------
  // Aktionen
  // ------------------------------------------------------------------
  const ok = (x) => Object.assign({ ok: true }, x || {});
  const fail = (err) => ({ ok: false, err });

  function placeCannon(s, p, x, y) {
    if (s.phase !== 'cannon') return fail('Jetzt werden keine Kanonen platziert.');
    if (p.cannonsToPlace + p.superToPlace <= 0) return fail('Keine Kanonen mehr übrig.');
    if (!canPlaceCannon(s, p.id, x, y)) return fail('Kanonen nur in deinem umschlossenen Gebiet!');
    const sup = p.superToPlace > 0;
    if (sup) p.superToPlace--; else p.cannonsToPlace--;
    const c = { id: s.nextId++, x, y, owner: p.id, hp: sup ? 4 : 3, readyAt: 0, ang: -Math.PI / 2, super: sup, active: true };
    s.cannons.push(c);
    setOcc(s, x, y, 2, c.id);
    s.cannonVer++; s.playerVer++;
    s.ev.push({ e: 'can', pid: p.id, x, y, sup });
    return ok();
  }

  function cannonRange(s, c) { return c.super ? s.rangeS : s.rangeN; }

  function fire(s, p, tx, ty) {
    if (s.phase !== 'battle') return fail('Feuer erst in der Gefechtsphase!');
    if (!isFinite(tx) || !isFinite(ty)) return fail('Ungültiges Ziel.');
    tx = clamp(tx, 0, s.W - 0.01); ty = clamp(ty, 0, s.H - 0.01);
    const gx = Math.floor(tx) + 0.5, gy = Math.floor(ty) + 0.5;
    let best = null, bd = 1e9, anyReady = false, anyActive = false;
    for (const c of s.cannons) {
      if (c.owner !== p.id || !c.active || c.hp <= 0) continue;
      anyActive = true;
      if (c.readyAt > s.time) continue;
      anyReady = true;
      const d = Math.hypot(c.x + 1 - gx, c.y + 1 - gy);
      if (d > cannonRange(s, c)) continue;
      // normale Kanonen bevorzugen, Super-Kanone nur wenn nötig
      const dd = d + (c.super ? 1000 : 0);
      if (dd < bd) { bd = dd; best = c; }
    }
    if (!best) return fail(!anyActive ? 'Keine einsatzbereiten Kanonen!' : anyReady ? 'Außer Reichweite!' : 'Nachladen …');
    const d = Math.hypot(best.x + 1 - gx, best.y + 1 - gy);
    let k = best.super ? 's' : 'n';
    if (p.special && p.specialArmed && p.special.n > 0 && !best.super) {
      k = p.special.type === 'fire' ? 'f' : 'c';
      p.special.n--;
      if (p.special.n <= 0) p.special = null;
      s.playerVer++;
    }
    const b = { id: s.nextId++, o: p.id, sx: best.x + 1, sy: best.y + 1, tx: gx, ty: gy, born: s.time, dur: 0.55 + d * 0.045, k };
    s.balls.push(b);
    best.readyAt = s.time + (best.super ? RELOAD_SUPER : RELOAD);
    best.ang = Math.atan2(gy - best.y - 1, gx - best.x - 1);
    s.cannonVer++;
    p.stats.shots++; s.statVer++;
    s.ev.push({ e: 'ball', b });
    return ok();
  }

  function placePiece(s, p, ax, ay, r) {
    if (s.phase !== 'build') return fail('Jetzt wird nicht gebaut.');
    if (!p.piece) return fail('Kein Mauerteil.');
    if (s.time > s.phaseEnd - p.penalty) return fail('Deine Bauzeit ist um!');
    if (!canPlacePiece(s, p.id, p.piece, ax, ay, r)) return fail('Hier kann nicht gebaut werden!');
    const cells = pieceCells(p.piece, r);
    const hp = p.bastionArmed ? 2 : 1;
    const placed = [];
    for (const [cx, cy] of cells) {
      const i = (ay + cy) * s.W + ax + cx;
      s.wall[i] = p.id; s.whp[i] = hp; markDirty(s, i); placed.push(i);
    }
    if (p.bastionArmed) { p.bastionArmed = false; s.ev.push({ e: 'bastion', pid: p.id, tiles: placed }); }
    p.stats.pieces++;
    p.piece = p.next; p.next = randPiece(s);
    s.playerVer++;
    s.ev.push({ e: 'place', pid: p.id, tiles: placed });
    computeTerritory(s, true);
    return ok();
  }

  function skipPiece(s, p) {
    if (!s.settings.sabotage) return fail('Sabotage ist ausgeschaltet.');
    if (s.phase !== 'build') return fail('Nur in der Bauphase.');
    if (p.skipUsed) return fail('Schon benutzt in dieser Runde.');
    p.skipUsed = true; p.penalty += 2;
    p.piece = p.next; p.next = randPiece(s);
    s.playerVer++;
    s.ev.push({ e: 'skip', pid: p.id });
    return ok();
  }

  function armBastion(s, p) {
    if (!s.settings.sabotage) return fail('Sabotage ist ausgeschaltet.');
    if (s.phase !== 'build') return fail('Nur in der Bauphase.');
    if (p.bastionArmed) { p.bastionArmed = false; p.bastionUsed = false; s.playerVer++; return ok({ off: true }); }
    if (p.bastionUsed) return fail('Bastion schon benutzt in dieser Runde.');
    p.bastionArmed = true; p.bastionUsed = true;
    s.playerVer++;
    return ok();
  }

  function input(s, pid, m) {
    const p = s.players[pid];
    if (!p || !m || typeof m !== 'object') return fail('Ungültig.');
    if (!p.alive) return fail('Du bist ausgeschieden.');
    switch (m.a) {
      case 'sel': return selectCastle(s, p, m.c | 0);
      case 'can': return placeCannon(s, p, m.x | 0, m.y | 0);
      case 'fire': return fire(s, p, +m.x, +m.y);
      case 'piece': return placePiece(s, p, m.x | 0, m.y | 0, m.r | 0);
      case 'skip': return skipPiece(s, p);
      case 'bastion': return armBastion(s, p);
      case 'arm': p.specialArmed = !p.specialArmed; s.playerVer++; return ok();
      default: return fail('Unbekannte Aktion.');
    }
  }

  // ------------------------------------------------------------------
  // Treffer
  // ------------------------------------------------------------------
  function destroyWall(s, i, by) {
    const o = s.wall[i];
    s.wall[i] = -1; s.whp[i] = 0; s.crater[i] = 1; markDirty(s, i);
    if (o >= 0) {
      const v = s.players[o];
      v.lost.push(i); if (v.lost.length > 60) v.lost.shift();
      if (by >= 0) v.lastHitBy = by;
    }
    if (by >= 0) { s.players[by].stats.walls++; s.players[by].score += 4; s.statVer++; }
  }
  function destroyCannon(s, c, by) {
    s.cannons = s.cannons.filter(x => x !== c);
    setOcc(s, c.x, c.y, 0, -1);
    for (let yy = c.y; yy < c.y + 2; yy++) for (let xx = c.x; xx < c.x + 2; xx++) { const i = yy * s.W + xx; s.crater[i] = 1; markDirty(s, i); }
    if (by >= 0) { s.players[by].stats.cannons++; s.players[by].score += 30; s.statVer++; }
    if (c.owner >= 0 && by >= 0) s.players[c.owner].lastHitBy = by;
    s.ev.push({ e: 'cdead', id: c.id, x: c.x, y: c.y, o: c.owner });
  }

  // Gibt zurück: 'wall' | 'wallhit' | 'cannon' | 'cdead' | 'castle' | 'own' | 'ground' | 'water'
  function damageTile(s, x, y, team, by) {
    if (!inB(s, x, y)) return 'water';
    const i = y * s.W + x;
    const w = s.wall[i];
    if (w >= 0) {
      if (team >= 0 && s.players[w].team === team) return 'own';
      s.whp[i]--;
      if (s.whp[i] <= 0) { destroyWall(s, i, by); return 'wall'; }
      markDirty(s, i);
      return 'wallhit';
    }
    if (s.occT[i] === 2) {
      const c = cannonById(s, s.occId[i]);
      if (c) {
        if (team >= 0 && teamOf(s, c.owner) === team) return 'own';
        c.hp--; s.cannonVer++;
        if (c.hp <= 0) { destroyCannon(s, c, by); return 'cdead'; }
        if (by >= 0 && c.owner >= 0) s.players[c.owner].lastHitBy = by;
        return 'cannon';
      }
    }
    if (s.occT[i] === 1) return 'castle';
    if (!s.land[i]) return 'water';
    if (!s.crater[i]) { s.crater[i] = 1; markDirty(s, i); }
    return 'ground';
  }

  function impact(s, b) {
    const x = Math.floor(b.tx), y = Math.floor(b.ty);
    const team = b.o >= 0 ? teamOf(s, b.o) : -1;
    let res = 'ground', hit = false;
    if (b.k === 'f') {
      res = 'fire';
      for (const [xx, yy] of [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!inB(s, xx, yy)) continue;
        const i = yy * s.W + xx;
        if (!s.land[i]) continue;
        const w = s.wall[i];
        if (w >= 0 && s.players[w].team !== team) { destroyWall(s, i, b.o); hit = true; }
        else if (s.occT[i] === 2) {
          const c = cannonById(s, s.occId[i]);
          if (c && teamOf(s, c.owner) !== team && !(xx !== c.x || yy !== c.y)) {
            c.hp--; s.cannonVer++; hit = true;
            if (c.hp <= 0) destroyCannon(s, c, b.o);
          }
        }
        if (s.wall[i] < 0 && s.occT[i] === 0 && !s.fire[i]) { s.fire[i] = 1; markDirty(s, i); }
      }
    } else if (b.k === 's') {
      const r0 = damageTile(s, x, y, team, b.o);
      res = r0;
      for (const [dx, dy] of DIR4) {
        const r1 = damageTile(s, x + dx, y + dy, team, b.o);
        if (r1 === 'wall' || r1 === 'cdead' || r1 === 'cannon' || r1 === 'wallhit') hit = true;
      }
      if (r0 === 'wall' || r0 === 'cdead' || r0 === 'cannon' || r0 === 'wallhit') hit = true;
    } else {
      res = damageTile(s, x, y, team, b.o);
      if (res === 'wall' || res === 'cdead' || res === 'cannon' || res === 'wallhit') hit = true;
    }
    // Schiffe
    if (b.o >= 0) {
      for (const sh of s.ships.slice()) {
        if (Math.hypot(sh.x - b.tx, sh.y - b.ty) <= (b.k === 's' ? 1.6 : 1.05)) {
          sh.hp--; hit = true; res = 'ship'; s.shipVer++;
          if (sh.hp <= 0) {
            s.ships = s.ships.filter(q => q !== sh);
            s.players[b.o].stats.ships++; s.players[b.o].score += 40; s.statVer++;
            s.ev.push({ e: 'sink', id: sh.id, x: sh.x, y: sh.y, by: b.o });
          }
        }
      }
      for (const cr of s.crates.slice()) {
        if (Math.hypot(cr.x - b.tx, cr.y - b.ty) <= 0.95) {
          collectCrate(s, cr, s.players[b.o]); hit = true; res = 'crate';
        }
      }
      if (hit) s.players[b.o].stats.hits++;
      s.statVer++;
    }
    s.ev.push({ e: 'imp', id: b.id, x: b.tx, y: b.ty, k: b.k, r: res, o: b.o });
  }

  function collectCrate(s, cr, p) {
    s.crates = s.crates.filter(c => c !== cr); s.crateVer++;
    p.stats.crates++; p.score += 15;
    if (cr.k === 'repair') p.repairCrew++;
    else {
      const type = cr.k === 'fire' ? 'fire' : 'cluster';
      if (p.special && p.special.type === type) p.special.n += 2;
      else p.special = { type, n: 2 };
      p.specialArmed = true;
    }
    s.playerVer++;
    s.ev.push({ e: 'crate', id: cr.id, pid: p.id, k: cr.k, x: cr.x, y: cr.y });
  }

  function updateBalls(s) {
    if (!s.balls.length) return;
    const keep = [];
    const list = s.balls; s.balls = [];
    for (const b of list) {
      const t = (s.time - b.born) / b.dur;
      if (b.k === 'c' && t >= 0.62) {
        // Streubombe teilt sich in 3 Geschosse
        const px = b.sx + (b.tx - b.sx) * t, py = b.sy + (b.ty - b.sy) * t;
        const rem = Math.max(0.25, b.dur * (1 - t));
        const dx = b.tx - b.sx, dy = b.ty - b.sy, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L;
        const offs = [[0, 0], [nx * 1.6 + dx / L * 0.6, ny * 1.6 + dy / L * 0.6], [-nx * 1.6 - dx / L * 0.6, -ny * 1.6 - dy / L * 0.6]];
        s.ev.push({ e: 'split', id: b.id, x: px, y: py });
        for (const [ox, oy] of offs) {
          const tx = clamp(Math.floor(b.tx + ox) + 0.5, 0.5, s.W - 0.5), ty = clamp(Math.floor(b.ty + oy) + 0.5, 0.5, s.H - 0.5);
          const nb = { id: s.nextId++, o: b.o, sx: px, sy: py, tx, ty, born: s.time, dur: rem, k: 'n', h0: true };
          keep.push(nb);
          s.ev.push({ e: 'ball', b: nb });
        }
        if (b.o >= 0) s.players[b.o].stats.shots += 2;
        continue;
      }
      if (t >= 1) impact(s, b); else keep.push(b);
    }
    s.balls = keep.concat(s.balls);
  }

  // ------------------------------------------------------------------
  // Versorgungskisten
  // ------------------------------------------------------------------
  function updateCrates(s, dt) {
    if (!s.settings.crates || s.phase !== 'battle') return;
    const maxC = s.players.length > 4 ? 3 : 2;
    if (s.time >= s.nextCrate && s.crates.length < maxC && s.time < s.phaseEnd - 4) {
      s.nextCrate = s.time + rr(s, 4, 7.5);
      for (let tries = 0; tries < 60; tries++) {
        const x = Math.floor(rnd(s) * s.W), y = Math.floor(rnd(s) * s.H), i = y * s.W + x;
        let water = false;
        if (s.land[i]) {
          if (s.wall[i] >= 0 || s.occT[i]) continue;
        } else {
          if (s.seaDist[i] < 3 || s.seaDist[i] === 65535) continue;
          let nearLand = false;
          for (const [dx, dy] of DIR8) { const xx = x + dx, yy = y + dy; if (inB(s, xx, yy) && s.land[yy * s.W + xx]) nearLand = true; }
          if (!nearLand) continue;
          water = true;
        }
        const r = rnd(s);
        const k = r < 0.4 ? 'cluster' : r < 0.75 ? 'fire' : 'repair';
        const cr = { id: s.nextId++, x: x + 0.5, y: y + 0.5, k, landAt: s.time + 2.2, water };
        s.crates.push(cr); s.crateVer++;
        s.ev.push({ e: 'crdrop', id: cr.id, x: cr.x, y: cr.y, k });
        break;
      }
    }
    for (const cr of s.crates.slice()) {
      if (!cr.water || s.time < cr.landAt) continue;
      const x = Math.floor(cr.x), y = Math.floor(cr.y), i = y * s.W + x;
      const here = s.seaDist[i];
      if (here <= 2) { s.crates = s.crates.filter(c => c !== cr); s.crateVer++; s.ev.push({ e: 'crgone', id: cr.id }); continue; }
      let bx = x, by = y;
      for (const [dx, dy] of DIR4) {
        const xx = x + dx, yy = y + dy; if (!inB(s, xx, yy)) continue;
        const j = yy * s.W + xx;
        if (!s.land[j] && s.seaDist[j] < s.seaDist[by * s.W + bx]) { bx = xx; by = yy; }
      }
      const tx = bx + 0.5, ty = by + 0.5;
      const d = Math.hypot(tx - cr.x, ty - cr.y);
      if (d > 0.01) { const sp = Math.min(d, 0.32 * dt); cr.x += (tx - cr.x) / d * sp; cr.y += (ty - cr.y) / d * sp; s.crateVer++; }
    }
  }

  // ------------------------------------------------------------------
  // Piraten
  // ------------------------------------------------------------------
  function spawnPirates(s) {
    if (!s.settings.pirates || s.round < 2) return;
    const at = aliveTeams(s);
    if (at.length < 2) return;
    const lead = bestTeam(s, at);
    // Angriffsfelder: Wasser in Schussweite einer Mauer des führenden Teams
    const W = s.W, H = s.H, N = s.N;
    const target = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) {
      if (!teamWallAt(s, lead, i)) continue;
      const x = i % W, y = (i / W) | 0;
      for (let yy = y - 6; yy <= y + 6; yy++) for (let xx = x - 6; xx <= x + 6; xx++) {
        if (!inB(s, xx, yy)) continue;
        const j = yy * W + xx;
        if (!s.land[j] && s.seaDist[j] !== 65535 && (xx - x) * (xx - x) + (yy - y) * (yy - y) <= 36) { target[j] = 1; any = true; }
      }
    }
    if (!any) return;
    const dist = new Uint16Array(N).fill(65535), q = [];
    for (let i = 0; i < N; i++) if (target[i]) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIR8) {
        const xx = x + dx, yy = y + dy; if (!inB(s, xx, yy)) continue;
        const j = yy * W + xx;
        if (s.land[j] || dist[j] !== 65535) continue;
        if (dx && dy && (s.land[y * W + xx] || s.land[yy * W + x])) continue;
        dist[j] = dist[i] + 1; q.push(j);
      }
    }
    s.pirateField = { team: lead, dist };
    const count = 1 + (at.length >= 3 ? 1 : 0) + (s.round >= 5 ? 1 : 0);
    const spawns = [];
    for (let i = 0; i < N; i++) if (!s.land[i] && s.seaDist[i] <= 1 && dist[i] !== 65535 && dist[i] > 4) spawns.push(i);
    if (!spawns.length) return;
    for (let k = 0; k < count; k++) {
      const i = spawns[Math.floor(rnd(s) * spawns.length)];
      s.ships.push({ id: s.nextId++, x: i % W + 0.5, y: ((i / W) | 0) + 0.5, ang: 0, hp: 3, readyAt: s.time + rr(s, 3, 5), team: lead });
    }
    s.shipVer++;
    s.ev.push({ e: 'pirates', team: lead });
  }

  function updateShips(s, dt) {
    if (!s.ships.length) return;
    const f = s.pirateField; if (!f) return;
    const W = s.W;
    for (const sh of s.ships) {
      const x = Math.floor(sh.x), y = Math.floor(sh.y), i = y * W + x;
      const here = f.dist[i];
      if (here > 0 && here !== 65535) {
        let bx = x, by = y, bd = here;
        for (const [dx, dy] of DIR8) {
          const xx = x + dx, yy = y + dy; if (!inB(s, xx, yy)) continue;
          const j = yy * W + xx;
          if (f.dist[j] < bd) { bd = f.dist[j]; bx = xx; by = yy; }
        }
        const tx = bx + 0.5, ty = by + 0.5, d = Math.hypot(tx - sh.x, ty - sh.y);
        if (d > 0.001) {
          const sp = Math.min(d, 1.5 * dt);
          sh.x += (tx - sh.x) / d * sp; sh.y += (ty - sh.y) / d * sp;
          sh.ang = Math.atan2(ty - sh.y, tx - sh.x);
        }
      }
      if (s.phase === 'battle' && s.time >= sh.readyAt) {
        // Ziel: Mauer des führenden Teams in Reichweite
        let tgt = -1, n = 0;
        const R = 8;
        for (let yy = y - R; yy <= y + R; yy++) for (let xx = x - R; xx <= x + R; xx++) {
          if (!inB(s, xx, yy)) continue;
          const j = yy * W + xx;
          if (teamWallAt(s, f.team, j) && (xx - x) ** 2 + (yy - y) ** 2 <= R * R) { n++; if (rnd(s) * n < 1) tgt = j; }
        }
        if (tgt >= 0) {
          const tx = tgt % W + 0.5, ty = ((tgt / W) | 0) + 0.5;
          const d = Math.hypot(tx - sh.x, ty - sh.y);
          const b = { id: s.nextId++, o: -1, sx: sh.x, sy: sh.y, tx, ty, born: s.time, dur: 0.55 + d * 0.05, k: 'p' };
          s.balls.push(b);
          s.ev.push({ e: 'ball', b });
          sh.readyAt = s.time + rr(s, 2.4, 3.4);
        } else sh.readyAt = s.time + 0.8;
      }
    }
    s.shipVer++;
  }

  // ------------------------------------------------------------------
  // KI-Bots
  // ------------------------------------------------------------------
  function botStep(s, p) {
    const L = BOT[p.bot] || BOT.mid;
    if (s.time < p.ai.next) return;
    switch (s.phase) {
      case 'select': {
        if (p.home < 0) {
          let c = null;
          if (L.smart >= 1) c = bestHomeCastle(s, p);
          else {
            const list = s.castles.filter(c0 => c0.zone === p.id && c0.owner < 0 && c0.clr >= 3);
            c = list.length ? list[Math.floor(rnd(s) * list.length)] : bestHomeCastle(s, p);
          }
          if (c) selectCastle(s, p, c.id);
        }
        p.ai.next = s.time + 1;
        break;
      }
      case 'cannon': {
        if (p.cannonsToPlace + p.superToPlace > 0) {
          const spot = botCannonSpot(s, p, L);
          if (spot) placeCannon(s, p, spot[0], spot[1]);
          else { p.cannonsToPlace = 0; p.superToPlace = 0; s.playerVer++; }
        }
        p.ai.next = s.time + rr(s, ...L.can);
        break;
      }
      case 'battle': {
        const tgt = botTarget(s, p, L);
        if (tgt) {
          const ang = rnd(s) * Math.PI * 2, e = L.err * Math.sqrt(rnd(s));
          fire(s, p, tgt[0] + Math.cos(ang) * e, tgt[1] + Math.sin(ang) * e);
        }
        p.ai.next = s.time + rr(s, ...L.fire);
        break;
      }
      case 'build': {
        if (p.piece && s.time < s.phaseEnd - p.penalty) {
          const ch = botBuild(s, p, L);
          if (ch) {
            if (ch.gain > 0 && L.smart >= 1 && s.settings.sabotage && !p.bastionUsed && ch.gain >= 2) armBastion(s, p);
            placePiece(s, p, ch.x, ch.y, ch.r);
          } else if (s.settings.sabotage && !p.skipUsed && L.smart >= 1 && botBlueprints(s, p, L).length) skipPiece(s, p);
        }
        p.ai.next = s.time + rr(s, ...L.build);
        break;
      }
      default: p.ai.next = s.time + 0.3;
    }
  }

  function botCannonSpot(s, p, L) {
    const W = s.W;
    let best = null, bs = -1e9, bestWallPen = 0;
    const myCastleComps = new Set();
    for (const c of s.castles) if (c.owner === p.id && c.encl === p.team) {
      const comp = compOfCastle(s, c.id); if (comp) myCastleComps.add(comp);
    }
    const mine = new Uint8Array(s.N);
    for (const comp of myCastleComps) for (const i of comp.tiles) mine[i] = 1;
    let ex = 0, ey = 0, en = 0;
    for (const c of s.castles) if (c.owner >= 0 && s.players[c.owner].team !== p.team) { ex += c.x; ey += c.y; en++; }
    if (en) { ex /= en; ey /= en; }
    for (let y = 0; y < s.H - 1; y++) for (let x = 0; x < W - 1; x++) {
      if (s.terr[y * W + x] !== p.team) continue;
      if (!canPlaceCannon(s, p.id, x, y)) continue;
      let sc = 0, wallPen = 0;
      if (mine[y * W + x]) sc += 3;
      for (let yy = y - 1; yy <= y + 2; yy++) for (let xx = x - 1; xx <= x + 2; xx++) {
        if (!inB(s, xx, yy)) continue;
        if (xx >= x && xx <= x + 1 && yy >= y && yy <= y + 1) continue;
        const j = yy * W + xx;
        if (s.wall[j] >= 0 && s.terr[j] !== p.team) { sc -= 2.5; wallPen++; }
        else if (s.wall[j] >= 0) sc -= 0.6;
        if (s.occT[j] === 2) sc -= 0.8;
        if (s.occT[j] === 1) sc -= 1.2;
      }
      if (L.smart >= 2 && en) sc -= Math.hypot(x - ex, y - ey) * 0.04;
      sc += rnd(s) * (L.smart === 0 ? 3 : 0.6);
      if (sc > bs) { bs = sc; best = [x, y]; bestWallPen = wallPen; }
    }
    // Profis lassen Platz für Reparaturen statt die Burg zuzustellen
    const have = s.cannons.filter(c => c.owner === p.id).length;
    if (best && L.smart >= 1 && have >= 4 && bestWallPen >= 2) return null;
    return best;
  }

  function boundaryWalls(s, T0) {
    const c = s.bwCache[T0];
    if (c && s.time - c.t < 1.2) return c.list.filter(i => teamWallAt(s, T0, i));
    const set = new Set();
    for (const comp of s.comps) {
      if (comp.team !== T0) continue;
      for (const i of comp.tiles) {
        const x = i % s.W, y = (i / s.W) | 0;
        for (const [dx, dy] of DIR4) {
          const xx = x + dx, yy = y + dy; if (!inB(s, xx, yy)) continue;
          const j = yy * s.W + xx;
          if (teamWallAt(s, T0, j)) set.add(j);
        }
      }
    }
    const list = [...set];
    s.bwCache[T0] = { t: s.time, list };
    return list;
  }

  function botTarget(s, p, L) {
    const ready = s.cannons.filter(c => c.owner === p.id && c.active && c.hp > 0 && c.readyAt <= s.time);
    if (!ready.length) return null;
    const inRange = (x, y) => ready.some(c => Math.hypot(c.x + 1 - x, c.y + 1 - y) <= cannonRange(s, c));
    const flight = (x, y) => {
      let d = 1e9; for (const c of ready) d = Math.min(d, Math.hypot(c.x + 1 - x, c.y + 1 - y));
      return 0.55 + d * 0.045;
    };
    // Kisten
    if (s.crates.length && rnd(s) < [0.2, 0.45, 0.8][L.smart]) {
      let best = null, bd = 1e9;
      for (const cr of s.crates) {
        if (!inRange(cr.x, cr.y)) continue;
        const d = Math.hypot(cr.x - s.W / 2, cr.y - s.H / 2) * 0 + rnd(s);
        if (d < bd) { bd = d; best = cr; }
      }
      if (best) {
        let x = best.x, y = best.y;
        if (best.water && s.time >= best.landAt && L.smart >= 2) {
          // Treibende Kiste – kaum Bewegung, Mitte anvisieren
        }
        return [x, y];
      }
    }
    // Piratenschiffe, die uns angreifen
    if (s.ships.length && L.smart >= 1 && rnd(s) < 0.65) {
      for (const sh of s.ships) {
        if (sh.team !== p.team || !inRange(sh.x, sh.y)) continue;
        const ft = flight(sh.x, sh.y);
        const vx = Math.cos(sh.ang) * 1.5, vy = Math.sin(sh.ang) * 1.5;
        const moving = s.pirateField && s.pirateField.dist[Math.floor(sh.y) * s.W + Math.floor(sh.x)] > 0;
        return moving && L.smart >= 2 ? [sh.x + vx * ft, sh.y + vy * ft] : [sh.x, sh.y];
      }
    }
    // Gegnerisches Team wählen
    const enemies = aliveTeams(s).filter(t => t !== p.team);
    if (!enemies.length) return null;
    if (s.time > p.ai.focusUntil || !enemies.includes(p.ai.focusTeam)) {
      const lead = bestTeam(s, enemies);
      const atk = p.lastHitBy >= 0 ? teamOf(s, p.lastHitBy) : -1;
      const myHome = s.castles[p.home] || s.castles[0];
      let near = enemies[0], nd = 1e9;
      for (const c of s.castles) {
        if (c.owner < 0) continue;
        const t = teamOf(s, c.owner);
        if (!enemies.includes(t)) continue;
        const d = Math.hypot(c.x - myHome.x, c.y - myHome.y);
        if (d < nd) { nd = d; near = t; }
      }
      const r = rnd(s);
      let pick = near;
      if (r < 0.35) pick = lead; else if (r < 0.55 && enemies.includes(atk)) pick = atk;
      else if (r > 0.85) pick = enemies[Math.floor(rnd(s) * enemies.length)];
      p.ai.focusTeam = pick; p.ai.focus = -1;
      p.ai.focusUntil = s.time + rr(s, 4, 8);
    }
    const ft = p.ai.focusTeam;
    // Kanonen jagen (Profis)
    if (L.smart >= 2 && rnd(s) < 0.18) {
      let best = null, bd = 1e9;
      for (const c of s.cannons) {
        if (teamOf(s, c.owner) !== ft || !inRange(c.x + 1, c.y + 1)) continue;
        const d = c.hp + rnd(s);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) return [best.x + 0.5 + Math.floor(rnd(s) * 2), best.y + 0.5 + Math.floor(rnd(s) * 2)];
    }
    let list = boundaryWalls(s, ft).filter(i => inRange(i % s.W + 0.5, ((i / s.W) | 0) + 0.5));
    if (!list.length || L.smart === 0) {
      // irgendeine gegnerische Mauer oder Kanone
      const any = [];
      for (let i = 0; i < s.N; i += 1) {
        if (s.wall[i] >= 0 && s.players[s.wall[i]].team !== p.team) {
          const x = i % s.W + 0.5, y = ((i / s.W) | 0) + 0.5;
          if (inRange(x, y)) any.push(i);
        }
      }
      if (L.smart === 0 && list.length && rnd(s) < 0.5) { /* teils Ring-Mauern */ }
      else if (any.length) list = any;
    }
    if (!list.length) return null;
    if (L.smart >= 2) {
      // Breschen schlagen: auf einen Punkt konzentrieren
      const valid = p.ai.focus >= 0 && list.some(i => Math.abs(i % s.W - p.ai.focus % s.W) <= 2 && Math.abs(((i / s.W) | 0) - ((p.ai.focus / s.W) | 0)) <= 2);
      if (!valid) p.ai.focus = list[Math.floor(rnd(s) * list.length)];
      const fx = p.ai.focus % s.W, fy = (p.ai.focus / s.W) | 0;
      let best = list[0], bd = 1e9;
      for (const i of list) {
        const d = Math.hypot(i % s.W - fx, ((i / s.W) | 0) - fy) + rnd(s) * 0.8;
        if (d < bd) { bd = d; best = i; }
      }
      return [best % s.W + 0.5, ((best / s.W) | 0) + 0.5];
    }
    const i = list[Math.floor(rnd(s) * list.length)];
    return [i % s.W + 0.5, ((i / s.W) | 0) + 0.5];
  }

  // --- Bauen: Bauplan berechnen ---
  function regionAround(s, c, k) {
    const tiles = [];
    for (let y = c.y - k; y <= c.y + 1 + k; y++) for (let x = c.x - k; x <= c.x + 1 + k; x++) {
      if (!inB(s, x, y)) return null;
      const i = y * s.W + x;
      if (!s.land[i]) return null;
      tiles.push(i);
    }
    return tiles;
  }
  function fixRegion(s, T0, tiles0, strict, c) {
    const W = s.W, H = s.H;
    const mask = new Uint8Array(s.N), forb = new Uint8Array(s.N);
    for (const i of tiles0) mask[i] = 1;
    let tiles = tiles0.slice();
    const limit = tiles0.length * 2.5 + 24;
    const freeNb = (j) => {
      const x = j % W, y = (j / W) | 0;
      let n = 0;
      for (const [dx, dy] of DIR4) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (buildable(s, T0, yy * W + xx)) n++;
      }
      return n;
    };
    const isCastleTile = (i) => s.occT[i] === 1 && (!c || s.occId[i] === c.id);
    for (let it = 0; it < 60; it++) {
      const Wl = [], seen = new Set();
      for (const i of tiles) {
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of DIR4) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) return null;
          const j = yy * W + xx;
          if (mask[j] || seen.has(j)) continue;
          seen.add(j); Wl.push(j);
        }
      }
      const bad = [];
      let hard = 0;
      for (const j of Wl) {
        if (teamWallAt(s, T0, j)) continue;
        if (buildable(s, T0, j)) {
          if (freeNb(j) === 0) { if (strict) bad.push(j); else hard++; }
          continue;
        }
        bad.push(j);
      }
      if (!bad.length) {
        const missing = Wl.filter(j => !teamWallAt(s, T0, j));
        return { mask, tiles, W: Wl, missing, hard };
      }
      let changed = false;
      for (const j of bad) {
        if (s.land[j] && !forb[j] && s.occT[j] !== 1) { mask[j] = 1; changed = true; continue; }
        // Nach innen ausweichen: angrenzende Innenfelder werden zur Mauerlinie
        forb[j] = 1;
        const x = j % W, y = (j / W) | 0;
        for (const [dx, dy] of DIR4) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx;
          if (!mask[k]) continue;
          if (isCastleTile(k)) return null;
          mask[k] = 0; forb[k] = 1; changed = true;
        }
      }
      if (!changed) return null;
      tiles = [];
      for (let i = 0; i < s.N; i++) if (mask[i]) tiles.push(i);
      if (!tiles.length || tiles.length > limit) return null;
      if (c && !mask[c.y * W + c.x]) return null;
    }
    return null;
  }
  function blueprintFor(s, T0, c) {
    const cands = [];
    if (s.prevRegion[c.id]) cands.push({ t: s.prevRegion[c.id], bonus: -0.6 });
    for (const k of [2, 3, 1]) { const t = regionAround(s, c, k); if (t) cands.push({ t, bonus: k === 2 ? 0 : 0.4 }); }
    let best = null, bc = 1e9;
    for (const cd of cands) {
      for (const strict of [false, true]) {
        const r = fixRegion(s, T0, cd.t, strict, c);
        if (!r) continue;
        const cost = r.missing.length + (r.hard || 0) * 6 + r.tiles.length * 0.03 + cd.bonus;
        if (cost < bc) { bc = cost; best = r; }
      }
    }
    if (!best) {
      const t = regionAround(s, c, 2) || regionAround(s, c, 1);
      if (!t) return null;
      const mask = new Uint8Array(s.N); for (const i of t) mask[i] = 1;
      const missing = [];
      for (const i of t) {
        const x = i % s.W, y = (i / s.W) | 0;
        for (const [dx, dy] of DIR4) {
          const xx = x + dx, yy = y + dy; if (!inB(s, xx, yy)) continue;
          const j = yy * s.W + xx;
          if (!mask[j] && buildable(s, T0, j) && !missing.includes(j)) missing.push(j);
        }
      }
      best = { mask, tiles: t, missing };
    }
    return best;
  }

  function botBlueprints(s, p, L) {
    const T0 = p.team, list = [];
    for (const c of s.castles) {
      if (c.owner !== p.id || c.encl === T0) continue;
      const bp = blueprintFor(s, T0, c);
      if (bp && bp.missing.length) list.push({ w: c.id === p.home ? 10 : 7, bp });
    }
    if (s.teamMode) {
      for (const c of s.castles) {
        if (c.owner < 0 || c.owner === p.id || c.encl === T0) continue;
        const o = s.players[c.owner];
        if (o.team !== T0 || !o.alive || !s.prevRegion[c.id]) continue;
        const bp = blueprintFor(s, T0, c);
        if (bp && bp.missing.length) list.push({ w: 6, bp });
      }
    }
    if (!list.length && L.smart >= 1) {
      // Expansion: nächste freie Burg (bevorzugt die Zitadelle)
      const home = s.castles[p.home];
      let best = null, bd = 1e9;
      for (const c of s.castles) {
        if (c.encl >= 0) continue;
        if (c.owner >= 0 && s.players[c.owner].team === T0) continue;
        if (!zoneOK(s, T0, c.y * s.W + c.x)) continue;
        let d = home ? Math.hypot(c.x - home.x, c.y - home.y) : 0;
        if (c.citadel) d -= 6;
        if (d < bd) { bd = d; best = c; }
      }
      if (best && bd < 30) {
        const bp = blueprintFor(s, T0, best);
        if (bp && bp.missing.length && bp.missing.length <= 40) list.push({ w: 5, bp });
      }
    }
    return list;
  }

  function botBuild(s, p, L) {
    const T0 = p.team, W = s.W;
    const bps = botBlueprints(s, p, L);
    const weight = new Float32Array(s.N), inner = new Uint8Array(s.N);
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (const { w, bp } of bps) {
      for (const i of bp.missing) {
        weight[i] = Math.max(weight[i], w);
        const x = i % W, y = (i / W) | 0;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      for (const i of bp.tiles) inner[i] = 1;
    }
    // Alle eigenen Gebiete als "innen" werten (dort keine Mauern verschwenden)
    for (let i = 0; i < s.N; i++) if (s.terr[i] === T0) inner[i] = 1;
    const shapes = [];
    const seenShape = new Set();
    for (let r = 0; r < 4; r++) {
      const cells = pieceCells(p.piece, r);
      const key = cells.map(c => c.join(',')).sort().join(';');
      if (seenShape.has(key)) continue;
      seenShape.add(key); shapes.push({ r, cells });
    }
    let best = null, bs = -1e9;
    const evalAt = (cells, ax, ay, r, fallback) => {
      let gain = 0, ins = 0, out = 0, adj = 0, hits = 0;
      for (const [cx, cy] of cells) {
        const x = ax + cx, y = ay + cy;
        if (!inB(s, x, y)) return;
        const i = y * W + x;
        if (!buildable(s, T0, i)) return;
        if (weight[i] > 0) { gain += weight[i]; hits++; }
        else if (inner[i]) ins++;
        else out++;
        for (const [dx, dy] of DIR4) {
          const xx = x + dx, yy = y + dy;
          if (inB(s, xx, yy) && teamWallAt(s, T0, yy * W + xx)) adj++;
        }
      }
      let sc;
      if (!fallback) {
        if (hits === 0) return;
        sc = gain * 10 - ins * 3.2 - out * 1.4 + adj * 0.25;
      } else {
        sc = -ins * 4 + adj * 0.6 - out * 0.1;
        const home = s.castles[p.home];
        if (home) sc -= Math.hypot(ax - home.x, ay - home.y) * 0.08;
      }
      if (L.smart === 0) sc += rnd(s) * 14;
      else if (L.smart === 1) sc += rnd(s) * 3;
      if (sc > bs) { bs = sc; best = { x: ax, y: ay, r, gain: hits }; }
    };
    if (maxX >= 0) {
      for (const sh of shapes) for (let ay = minY - 4; ay <= maxY; ay++) for (let ax = minX - 4; ax <= maxX; ax++) evalAt(sh.cells, ax, ay, sh.r, false);
    }
    if (best) return best;
    // Nichts zu reparieren: kluge Bots verdoppeln gezielt ihre Außenmauer (begrenzt), leichte bauen manchmal planlos
    if (L.smart >= 1) {
      if ((p.ai.thick || 0) >= (L.smart >= 2 ? 30 : 14)) return null;
      const bnd = new Uint8Array(s.N);
      for (let i = 0; i < s.N; i++) {
        if (!teamWallAt(s, T0, i)) continue;
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of DIR4) { const xx = x + dx, yy = y + dy; if (inB(s, xx, yy) && s.terr[yy * W + xx] === T0) { bnd[i] = 1; break; } }
      }
      const home = s.castles[p.home] || s.castles.find(c => c.owner === p.id);
      if (!home) return null;
      let tb = null, ts = -1e9;
      for (const sh of shapes) for (let ay = Math.max(0, home.y - 12); ay <= Math.min(s.H - 1, home.y + 12); ay++)
        for (let ax = Math.max(0, home.x - 13); ax <= Math.min(W - 1, home.x + 13); ax++) {
          let okc = true, adj = 0;
          for (const [cx, cy] of sh.cells) {
            const x = ax + cx, y = ay + cy;
            if (!inB(s, x, y)) { okc = false; break; }
            const i = y * W + x;
            if (!buildable(s, T0, i) || s.terr[i] === T0) { okc = false; break; }
            let near = false;
            for (const [dx, dy] of DIR8) { const xx = x + dx, yy = y + dy; if (inB(s, xx, yy) && bnd[yy * W + xx]) { near = true; adj++; } }
            if (!near) { okc = false; break; }
          }
          if (!okc) continue;
          const sc = adj - Math.hypot(ax - home.x, ay - home.y) * 0.05 + rnd(s) * 0.5;
          if (sc > ts) { ts = sc; tb = { x: ax, y: ay, r: sh.r, gain: 0 }; }
        }
      if (tb) p.ai.thick = (p.ai.thick || 0) + PIECES[p.piece].cells.length;
      return tb;
    }
    if (rnd(s) > 0.25) return null;
    const home = s.castles[p.home] || s.castles.find(c => c.owner === p.id);
    const cx = home ? home.x : s.W / 2, cy = home ? home.y : s.H / 2;
    for (const sh of shapes) for (let ay = Math.max(0, cy - 12); ay <= Math.min(s.H - 1, cy + 12); ay++)
      for (let ax = Math.max(0, cx - 14); ax <= Math.min(s.W - 1, cx + 14); ax++) evalAt(sh.cells, ax, ay, sh.r, true);
    return best;
  }

  // ------------------------------------------------------------------
  // Haupt-Schritt
  // ------------------------------------------------------------------
  function step(s, dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.25);
    s.time += dt;
    if (s.phase === 'over') return;
    for (const p of s.players) if (p.bot && p.alive) botStep(s, p);
    switch (s.phase) {
      case 'select':
        if (s.time >= s.phaseEnd || s.players.every(p => p.home >= 0)) finishSelect(s);
        break;
      case 'cannon':
        if (s.time >= s.phaseEnd || s.players.every(p => !p.alive || p.cannonsToPlace + p.superToPlace <= 0)) {
          for (const p of s.players) { p.cannonsToPlace = 0; p.superToPlace = 0; }
          setPhase(s, 'ready', T.READY);
        }
        break;
      case 'ready':
        if (s.time >= s.phaseEnd) startBattle(s);
        break;
      case 'battle':
        updateBalls(s); updateShips(s, dt); updateCrates(s, dt);
        if (s.time >= s.phaseEnd) {
          for (const c of s.crates) s.ev.push({ e: 'crgone', id: c.id });
          s.crates = []; s.crateVer++;
          setPhase(s, 'cease', T.CEASE);
        }
        break;
      case 'cease':
        updateBalls(s); updateShips(s, dt);
        if (s.time >= s.phaseEnd && (!s.balls.length || s.time >= s.phaseEnd + 3)) startBuild(s);
        break;
      case 'build':
        if (s.time >= s.phaseEnd) endBuild(s);
        break;
      case 'score':
        if (s.time >= s.phaseEnd) {
          if (s.result) { setPhase(s, 'over', 0); s.ev.push({ e: 'over', result: s.result }); }
          else nextRound(s);
        }
        break;
    }
  }

  function drainEvents(s) { const e = s.ev; s.ev = []; return e; }

  // ------------------------------------------------------------------
  // Serialisierung für das Netzwerk
  // ------------------------------------------------------------------
  function packTile(s, i) {
    return (s.wall[i] + 1) | (Math.min(3, s.whp[i]) << 3) | (Math.min(3, s.crater[i]) << 5) | ((s.fire[i] ? 1 : 0) << 7) | ((s.terr[i] + 1) << 8);
  }
  function unpackTile(v, i, view) {
    view.wall[i] = (v & 7) - 1; view.whp[i] = (v >> 3) & 3; view.crater[i] = (v >> 5) & 3; view.fire[i] = (v >> 7) & 1; view.terr[i] = ((v >> 8) & 7) - 1;
  }
  function packCannons(s) { return s.cannons.map(c => [c.id, c.x, c.y, c.owner, c.hp, +c.readyAt.toFixed(2), +c.ang.toFixed(2), c.super ? 1 : 0, c.active ? 1 : 0]); }
  function unpackCannons(arr) { return arr.map(a => ({ id: a[0], x: a[1], y: a[2], owner: a[3], hp: a[4], readyAt: a[5], ang: a[6], super: !!a[7], active: !!a[8] })); }
  function packCastles(s) { return s.castles.map(c => [c.id, c.owner, c.home, c.encl]); }
  function packPlayers(s) {
    return s.players.map(p => ({
      id: p.id, name: p.name, team: p.team, color: p.color, colorName: p.colorName, bot: p.bot, alive: p.alive, home: p.home, score: p.score,
      ctp: p.cannonsToPlace, stp: p.superToPlace, piece: p.piece, next: p.next, skipUsed: p.skipUsed, bastionUsed: p.bastionUsed,
      bastionArmed: p.bastionArmed, penalty: p.penalty, special: p.special, specialArmed: p.specialArmed, repairCrew: p.repairCrew, stats: p.stats
    }));
  }
  function applyPlayers(view, arr) {
    view.players = arr.map(q => ({
      id: q.id, name: q.name, team: q.team, color: q.color, colorName: q.colorName, bot: q.bot, alive: q.alive, home: q.home, score: q.score,
      cannonsToPlace: q.ctp, superToPlace: q.stp, piece: q.piece, next: q.next, skipUsed: q.skipUsed, bastionUsed: q.bastionUsed,
      bastionArmed: q.bastionArmed, penalty: q.penalty, special: q.special, specialArmed: q.specialArmed, repairCrew: q.repairCrew, stats: q.stats
    }));
    view.playerVer++;
  }

  function serializeInit(s) {
    const grid = new Array(s.N);
    for (let i = 0; i < s.N; i++) grid[i] = packTile(s, i);
    let land = '';
    for (let i = 0; i < s.N; i++) land += s.land[i];
    return {
      W: s.W, H: s.H, mode: s.mode, settings: s.settings, teamMode: s.teamMode, teamCount: s.teamCount,
      land, zone: Array.from(s.zone), zoneTeam: s.zoneTeam, seaDist: Array.from(s.seaDist),
      castles: s.castles.map(c => ({ id: c.id, x: c.x, y: c.y, zone: c.zone, clr: c.clr, citadel: c.citadel, owner: c.owner, home: c.home, encl: c.encl })),
      cannons: packCannons(s), players: packPlayers(s), grid,
      balls: s.balls.slice(), ships: s.ships.map(sh => [sh.id, +sh.x.toFixed(2), +sh.y.toFixed(2), +sh.ang.toFixed(2), sh.hp, sh.team]),
      crates: s.crates.map(c => [c.id, +c.x.toFixed(2), +c.y.toFixed(2), c.k, c.landAt, c.water ? 1 : 0]),
      phase: s.phase, phaseEnd: s.phaseEnd, round: s.round, time: s.time, rangeN: s.rangeN, rangeS: s.rangeS, result: s.result
    };
  }

  function viewFromInit(d) {
    const N = d.W * d.H;
    const v = {
      W: d.W, H: d.H, N, mode: d.mode, settings: d.settings, teamMode: d.teamMode, teamCount: d.teamCount,
      land: new Uint8Array(N), zone: Uint8Array.from(d.zone), zoneTeam: d.zoneTeam, seaDist: Uint16Array.from(d.seaDist),
      wall: new Int8Array(N), whp: new Uint8Array(N), crater: new Uint8Array(N), fire: new Uint8Array(N), terr: new Int8Array(N),
      occT: new Uint8Array(N), occId: new Int32Array(N).fill(-1),
      castles: d.castles.map(c => Object.assign({}, c)), cannons: unpackCannons(d.cannons), players: [],
      balls: d.balls.slice(), ships: [], crates: [],
      phase: d.phase, phaseEnd: d.phaseEnd, round: d.round, time: d.time, rangeN: d.rangeN, rangeS: d.rangeS, result: d.result,
      gridVer: 1, cannonVer: 1, castleVer: 1, playerVer: 1, zoneVer: 1, shipVer: 1, crateVer: 1, statVer: 1, comps: [], prevRegion: {}
    };
    for (let i = 0; i < N; i++) { v.land[i] = d.land.charCodeAt(i) === 49 ? 1 : 0; unpackTile(d.grid[i], i, v); }
    applyPlayers(v, d.players);
    applyShips(v, d.ships); applyCrates(v, d.crates);
    rebuildOcc(v);
    return v;
  }
  function applyShips(v, arr) { v.ships = arr.map(a => ({ id: a[0], x: a[1], y: a[2], ang: a[3], hp: a[4], team: a[5] })); v.shipVer++; }
  function applyCrates(v, arr) { v.crates = arr.map(a => ({ id: a[0], x: a[1], y: a[2], k: a[3], landAt: a[4], water: !!a[5] })); v.crateVer++; }

  // Vom Server pro Takt erzeugte Nachricht
  function makeTick(s, last) {
    const m = { t: 's', tm: +s.time.toFixed(3), ph: s.phase, pe: +s.phaseEnd.toFixed(3), rd: s.round };
    if (s.dirty.length) {
      const gd = new Array(s.dirty.length * 2);
      let k = 0;
      for (const i of s.dirty) { gd[k++] = i; gd[k++] = packTile(s, i); s.dflag[i] = 0; }
      s.dirty = [];
      m.gd = gd;
    }
    if (last.cannonVer !== s.cannonVer) { m.cn = packCannons(s); last.cannonVer = s.cannonVer; }
    if (last.castleVer !== s.castleVer) { m.cs = packCastles(s); last.castleVer = s.castleVer; }
    if (last.playerVer !== s.playerVer) { m.pl = packPlayers(s); last.playerVer = s.playerVer; last.statVer = s.statVer; last.statT = s.time; }
    else if (last.statVer !== s.statVer && (!last.statT || s.time - last.statT >= 0.6)) {
      m.st = s.players.map(p => [p.score, p.stats.shots, p.stats.hits, p.stats.walls, p.stats.cannons, p.stats.ships, p.stats.crates, p.stats.captured]);
      last.statVer = s.statVer; last.statT = s.time;
    }
    if (last.shipVer !== s.shipVer) { m.sh = s.ships.map(sh => [sh.id, +sh.x.toFixed(2), +sh.y.toFixed(2), +sh.ang.toFixed(2), sh.hp, sh.team]); last.shipVer = s.shipVer; }
    if (last.crateVer !== s.crateVer) { m.cr = s.crates.map(c => [c.id, +c.x.toFixed(2), +c.y.toFixed(2), c.k, c.landAt, c.water ? 1 : 0]); last.crateVer = s.crateVer; }
    const ev = drainEvents(s);
    if (ev.length) m.ev = ev;
    return m;
  }

  // Wendet eine Server-Nachricht auf die Client-Ansicht an; gibt Ereignisse zurück
  function applyTick(v, m) {
    v.time = m.tm; v.phase = m.ph; v.phaseEnd = m.pe; v.round = m.rd;
    if (m.gd) { for (let k = 0; k < m.gd.length; k += 2) unpackTile(m.gd[k + 1], m.gd[k], v); v.gridVer++; }
    if (m.cn) { v.cannons = unpackCannons(m.cn); rebuildOcc(v); v.cannonVer++; }
    if (m.cs) { for (const a of m.cs) { const c = v.castles[a[0]]; if (c) { c.owner = a[1]; c.home = a[2]; c.encl = a[3]; } } v.castleVer++; }
    if (m.pl) { applyPlayers(v, m.pl); v.statVer++; }
    if (m.st) {
      m.st.forEach((a, k) => {
        const p = v.players[k]; if (!p) return;
        p.score = a[0]; Object.assign(p.stats, { shots: a[1], hits: a[2], walls: a[3], cannons: a[4], ships: a[5], crates: a[6], captured: a[7] });
      });
      v.statVer++;
    }
    if (m.sh) applyShips(v, m.sh);
    if (m.cr) applyCrates(v, m.cr);
    const ev = m.ev || [];
    for (const e of ev) {
      if (e.e === 'ball') v.balls.push(e.b);
      else if (e.e === 'imp' || e.e === 'rm' || e.e === 'split') v.balls = v.balls.filter(b => b.id !== e.id);
      else if (e.e === 'zone') { for (let i = 0; i < v.N; i++) if (v.zone[i] === e.z) v.zone[i] = 255; v.zoneVer++; }
      else if (e.e === 'over') v.result = e.result;
    }
    return ev;
  }

  return {
    T, MODES, TEAM_NAMES, TEAM_COLORS, FFA_COLORS, FFA_NAMES, BOT_NAMES, BOT_LEVELS, PIECES, MAX_CANNONS,
    slotLayout, createGame, step, input, drainEvents, pieceCells, canPlacePiece, canPlaceCannon, buildable, zoneOK,
    teamWallAt, computeTerritory, serializeInit, viewFromInit, makeTick, applyTick, rebuildOcc, teamLabel, teamColor,
    aliveTeams, teamScore, cannonRange, generateMap, mapSize, makeResult,
    _internal: { blueprintFor, botBlueprints, botBuild, fixRegion, regionAround, BOT }
  };
});
