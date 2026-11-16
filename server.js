/* =====================================================================
   Rene's Rampart – Server
   Express (statische Dateien + Ranglisten-API) und WebSocket (Echtzeit)
   Start: node server.js   (Port über Umgebungsvariable PORT, Standard 3000)
   ===================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'rangliste.json');
const TICK_MS = 50;          // Simulation 20x pro Sekunde
const SEND_EVERY = 2;        // Netzwerk-Update 10x pro Sekunde
const LOBBY_GRACE_MS = 20000;
const GAME_GRACE_MS = 12000;

// ---------------------------------------------------------------------
// Rangliste (JSON-Datei)
// ---------------------------------------------------------------------
let board = { players: {}, games: 0 };
let boardDirty = false;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(BOARD_FILE)) board = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
  if (!board.players) board.players = {};
} catch (e) { console.error('Rangliste konnte nicht geladen werden:', e.message); }
setInterval(() => {
  if (!boardDirty) return;
  boardDirty = false;
  const tmp = BOARD_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(board), (err) => {
    if (err) return console.error('Rangliste speichern fehlgeschlagen:', err.message);
    fs.rename(tmp, BOARD_FILE, () => {});
  });
}, 5000);

function recordResult(room, result) {
  board.games = (board.games || 0) + 1;
  for (const pr of result.players) {
    if (pr.bot) continue;
    const name = cleanName(pr.name);
    const key = name.toLowerCase();
    if (!key) continue;
    const e = board.players[key] || (board.players[key] = { name, games: 0, wins: 0, walls: 0, cannons: 0, castles: 0, ships: 0, crates: 0, shots: 0, hits: 0, best: 0 });
    e.name = name;
    e.games++;
    if (result.winners.includes(pr.id)) e.wins++;
    e.walls += pr.stats.walls; e.cannons += pr.stats.cannons; e.castles += pr.stats.captured;
    e.ships += pr.stats.ships; e.crates += pr.stats.crates; e.shots += pr.stats.shots; e.hits += pr.stats.hits;
    e.best = Math.max(e.best, pr.score);
    e.last = Date.now();
  }
  boardDirty = true;
}

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|js|css|json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    if (file.endsWith('manifest.json')) res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  }
}));
app.get('/api/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, clients: clients.size, time: Date.now() });
});
app.get('/api/leaderboard', (req, res) => {
  const list = Object.values(board.players).map(e => Object.assign({}, e, { acc: e.shots ? Math.round(e.hits / e.shots * 100) : 0 }));
  list.sort((a, b) => b.wins - a.wins || (b.wins / Math.max(1, b.games)) - (a.wins / Math.max(1, a.games)) || b.walls - a.walls);
  res.json({ ok: true, games: board.games || 0, players: list.slice(0, 50) });
});
app.get('/api/room/:code', (req, res) => {
  const r = rooms.get(String(req.params.code || '').toUpperCase());
  res.json({ ok: !!r, inGame: !!(r && r.game), players: r ? r.slots.filter(s => s.kind !== 'open').length : 0 });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 3 } }, maxPayload: 16 * 1024 });

// ---------------------------------------------------------------------
// Räume
// ---------------------------------------------------------------------
const rooms = new Map();      // code -> room
const clients = new Map();    // clientId -> client
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function cleanName(n) {
  return String(n || '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Ritter';
}
function makeCode() {
  for (let k = 0; k < 1000; k++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return String(Date.now()).slice(-4);
}
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}
function toastRoom(room, msg) {
  for (const c of room.clients.values()) send(c.ws, { t: 'toast', msg });
}

const DEFAULT_SETTINGS = { mode: 'ffa', ffa: 4, rounds: 8, crates: true, pirates: true, citadel: true, sabotage: true };

function slotCount(st) {
  if (st.mode === 'ffa') return Math.max(2, Math.min(6, st.ffa | 0));
  return E.MODES[st.mode].teams.length;
}

function layoutSlots(room) {
  const n = slotCount(room.settings);
  const lay = E.slotLayout(room.settings.mode, n);
  const old = room.slots || [];
  const humans = old.filter(s => s.kind === 'human');
  const bots = old.filter(s => s.kind === 'bot');
  const next = lay.map(l => Object.assign({ kind: 'open', cid: null, name: '', level: null }, l));
  // Menschen zuerst wieder auf die gleichen Plätze, sonst auf freie
  const placed = new Set();
  humans.forEach((h, k) => {
    const oldIdx = old.indexOf(h);
    let idx = oldIdx < next.length && next[oldIdx].kind === 'open' ? oldIdx : next.findIndex(s => s.kind === 'open');
    if (idx >= 0) { Object.assign(next[idx], { kind: 'human', cid: h.cid, name: h.name }); placed.add(h.cid); }
  });
  for (const h of humans) if (!placed.has(h.cid)) { const c = clients.get(h.cid); if (c) c.slot = -1; }
  for (const b of bots) {
    const oldIdx = old.indexOf(b);
    let idx = oldIdx < next.length && next[oldIdx].kind === 'open' ? oldIdx : next.findIndex(s => s.kind === 'open');
    if (idx >= 0) Object.assign(next[idx], { kind: 'bot', name: b.name, level: b.level });
  }
  room.slots = next;
  for (let i = 0; i < next.length; i++) if (next[i].kind === 'human') { const c = clients.get(next[i].cid); if (c) c.slot = i; }
}

function createRoom(host) {
  const room = {
    code: makeCode(), created: Date.now(), hostId: host.id,
    settings: Object.assign({}, DEFAULT_SETTINGS), slots: [], clients: new Map(),
    game: null, timer: null, last: {}, pidOf: new Map(), recorded: false, botNo: Math.floor(Math.random() * 12),
    emptySince: 0, takeover: new Map()
  };
  rooms.set(room.code, room);
  layoutSlots(room);
  return room;
}

function nextBotName(room) {
  const used = new Set(room.slots.map(s => s.name));
  for (let k = 0; k < E.BOT_NAMES.length; k++) {
    const n = E.BOT_NAMES[(room.botNo + k) % E.BOT_NAMES.length];
    if (!used.has(n)) { room.botNo = (room.botNo + k + 1) % E.BOT_NAMES.length; return n; }
  }
  return 'Bot ' + (room.slots.length + 1);
}

function roomState(room, forCid) {
  return {
    t: 'room',
    room: {
      code: room.code, host: room.hostId, you: forCid, settings: room.settings, inGame: !!room.game,
      slots: room.slots.map((s, i) => ({
        i, kind: s.kind, name: s.name, level: s.level, team: s.team, color: s.color, colorName: s.colorName,
        you: s.cid === forCid, host: s.cid === room.hostId,
        online: s.kind !== 'human' || !!(clients.get(s.cid) && clients.get(s.cid).ws)
      })),
      spectators: [...room.clients.values()].filter(c => c.slot < 0).map(c => c.name)
    }
  };
}
function broadcastRoom(room) {
  for (const c of room.clients.values()) send(c.ws, roomState(room, c.id));
}

function joinRoom(c, room) {
  if (c.room && c.room !== room) leaveRoom(c, true);
  c.room = room;
  room.clients.set(c.id, c);
  room.emptySince = 0;
  if (room.game) {
    const pid = room.pidOf.has(c.id) ? room.pidOf.get(c.id) : -1;
    if (pid >= 0) {
      const p = room.game.players[pid];
      if (room.takeover.has(pid)) { p.bot = null; room.takeover.delete(pid); room.game.playerVer++; toastRoom(room, `${p.name} ist zurück!`); }
    }
    send(c.ws, roomState(room, c.id));
    send(c.ws, { t: 'start', init: E.serializeInit(room.game), you: pid, code: room.code });
    return;
  }
  const already = room.slots.findIndex(s => s.kind === 'human' && s.cid === c.id);
  if (already >= 0) { c.slot = already; room.slots[already].name = c.name; }
  else {
    const idx = room.slots.findIndex(s => s.kind === 'open');
    if (idx >= 0) { Object.assign(room.slots[idx], { kind: 'human', cid: c.id, name: c.name, level: null }); c.slot = idx; }
    else c.slot = -1;
  }
  broadcastRoom(room);
}

function leaveRoom(c, silent) {
  const room = c.room;
  if (!room) return;
  room.clients.delete(c.id);
  if (!room.game) {
    const idx = room.slots.findIndex(s => s.kind === 'human' && s.cid === c.id);
    if (idx >= 0) Object.assign(room.slots[idx], { kind: 'open', cid: null, name: '', level: null });
  } else {
    const pid = room.pidOf.get(c.id);
    if (pid !== undefined && pid >= 0) botTakeover(room, pid);
  }
  c.room = null; c.slot = -1;
  if (room.hostId === c.id) pickNewHost(room);
  if (!room.clients.size) room.emptySince = Date.now();
  if (!silent) broadcastRoom(room);
}

function pickNewHost(room) {
  const next = [...room.clients.values()].find(x => x.ws) || [...room.clients.values()][0];
  if (next) { room.hostId = next.id; toastRoom(room, `${next.name} ist jetzt Gastgeber.`); }
}

function botTakeover(room, pid) {
  const g = room.game; if (!g) return;
  const p = g.players[pid];
  if (!p || p.bot || !p.alive) return;
  p.bot = 'mid'; p.ai.next = g.time + 0.5;
  room.takeover.set(pid, true);
  g.playerVer++;
  toastRoom(room, `${p.name} ist weg – ein Bot übernimmt.`);
}

function startGame(room) {
  const st = room.settings;
  const occ = room.slots.map((s, i) => Object.assign({ idx: i }, s)).filter(s => s.kind !== 'open');
  if (st.mode === 'ffa' && occ.length < 2) return 'Mindestens 2 Spieler (oder Bots) nötig.';
  if (st.mode !== 'ffa' && occ.length < room.slots.length) return 'Bitte alle Plätze besetzen – leere Plätze mit Bots füllen.';
  if (!occ.some(s => s.kind === 'human')) return 'Mindestens ein Mensch muss mitspielen.';
  const cfgSlots = occ.map((s, k) => ({
    name: s.name, bot: s.kind === 'bot' ? s.level : null,
    team: st.mode === 'ffa' ? k : s.team, color: s.color, colorName: s.colorName
  }));
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const g = E.createGame({ seed, mode: st.mode, slots: cfgSlots, settings: { rounds: st.rounds, crates: st.crates, pirates: st.pirates, citadel: st.citadel, sabotage: st.sabotage } });
  room.game = g; room.last = {}; room.recorded = false; room.takeover = new Map();
  room.pidOf = new Map();
  occ.forEach((s, k) => { if (s.kind === 'human') room.pidOf.set(s.cid, k); });
  E.drainEvents(g);
  g.dirty.forEach(i => (g.dflag[i] = 0)); g.dirty = [];
  const init = E.serializeInit(g);
  for (const c of room.clients.values()) {
    send(c.ws, roomState(room, c.id));
    send(c.ws, { t: 'start', init, you: room.pidOf.has(c.id) ? room.pidOf.get(c.id) : -1, code: room.code });
  }
  // Spieler, die beim Start offline sind, sofort durch Bots vertreten
  for (const [cid, pid] of room.pidOf) { const c = clients.get(cid); if (!c || !c.ws) botTakeover(room, pid); }
  let tick = 0, lastT = process.hrtime.bigint();
  room.timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const dt = Number(now - lastT) / 1e9; lastT = now;
    try { E.step(g, dt); } catch (e) { console.error('Spielfehler', e); }
    if (++tick % SEND_EVERY === 0) {
      const msg = JSON.stringify(E.makeTick(g, room.last));
      for (const c of room.clients.values()) send(c.ws, msg);
    }
    if (g.phase === 'over' && !room.recorded) {
      room.recorded = true;
      try { recordResult(room, g.result); } catch (e) { console.error(e); }
    }
    if (g.phase === 'over' && g.time > g.phaseStart + 600) stopGame(room);
  }, TICK_MS);
  return null;
}

function stopGame(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.game = null;
  room.pidOf = new Map();
  room.takeover = new Map();
  // Plätze bereinigen: Menschen, die nicht mehr da sind, freigeben
  for (const s of room.slots) if (s.kind === 'human' && !room.clients.has(s.cid)) Object.assign(s, { kind: 'open', cid: null, name: '', level: null });
  for (const c of room.clients.values()) {
    const idx = room.slots.findIndex(s => s.kind === 'human' && s.cid === c.id);
    if (idx >= 0) c.slot = idx;
    else {
      const free = room.slots.findIndex(s => s.kind === 'open');
      if (free >= 0) { Object.assign(room.slots[free], { kind: 'human', cid: c.id, name: c.name, level: null }); c.slot = free; }
      else c.slot = -1;
    }
  }
}

// ---------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------
function handle(c, m) {
  switch (m.t) {
    case 'ping': return send(c.ws, { t: 'pong', ts: m.ts });
    case 'create': {
      c.name = cleanName(m.name);
      const room = createRoom(c);
      return joinRoom(c, room);
    }
    case 'join': {
      c.name = cleanName(m.name);
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(c.ws, { t: 'err', msg: 'Raum nicht gefunden. Code prüfen!', code: 'noroom' });
      return joinRoom(c, room);
    }
    case 'leave': {
      leaveRoom(c);
      return send(c.ws, { t: 'left' });
    }
    case 'lobby': return lobbyAction(c, m);
    case 'in': {
      const room = c.room;
      if (!room || !room.game) return;
      const pid = room.pidOf.get(c.id);
      if (pid === undefined || pid < 0) return;
      const now = Date.now();
      if (now - c.rateT > 1000) { c.rateT = now; c.rateN = 0; }
      if (++c.rateN > 30) return;
      const p = room.game.players[pid];
      if (p && p.bot && room.takeover.has(pid)) { p.bot = null; room.takeover.delete(pid); room.game.playerVer++; }
      const r = E.input(room.game, pid, m.m || {});
      if (!r.ok) send(c.ws, { t: 'res', err: r.err, a: m.m && m.m.a });
      return;
    }
    case 'rematch': {
      const room = c.room;
      if (!room || room.hostId !== c.id) return;
      if (room.game && room.game.phase !== 'over') return;
      stopGame(room);
      return broadcastRoom(room);
    }
    case 'name': {
      c.name = cleanName(m.name);
      if (c.room && !c.room.game && c.slot >= 0) { c.room.slots[c.slot].name = c.name; broadcastRoom(c.room); }
      return;
    }
  }
}

function lobbyAction(c, m) {
  const room = c.room;
  if (!room || room.game) return;
  const isHost = room.hostId === c.id;
  switch (m.a) {
    case 'settings': {
      if (!isHost) return;
      const st = room.settings, v = m.v || {};
      if (E.MODES[v.mode]) st.mode = v.mode;
      if (v.ffa !== undefined) st.ffa = Math.max(2, Math.min(6, v.ffa | 0));
      if (v.rounds !== undefined) st.rounds = [0, 5, 8, 12].includes(v.rounds | 0) ? v.rounds | 0 : 8;
      for (const k of ['crates', 'pirates', 'citadel', 'sabotage']) if (v[k] !== undefined) st[k] = !!v[k];
      layoutSlots(room);
      break;
    }
    case 'bot': {
      if (!isHost) return;
      const s = room.slots[m.slot | 0]; if (!s) return;
      const lvl = ['easy', 'mid', 'pro'].includes(m.level) ? m.level : null;
      if (s.kind === 'human') return;
      if (!lvl) Object.assign(s, { kind: 'open', name: '', level: null });
      else if (s.kind === 'bot') s.level = lvl;
      else Object.assign(s, { kind: 'bot', name: nextBotName(room), level: lvl, cid: null });
      break;
    }
    case 'fill': {
      if (!isHost) return;
      const lvl = ['easy', 'mid', 'pro'].includes(m.level) ? m.level : 'mid';
      for (const s of room.slots) if (s.kind === 'open') Object.assign(s, { kind: 'bot', name: nextBotName(room), level: lvl, cid: null });
      break;
    }
    case 'move': {
      const s = room.slots[m.slot | 0];
      if (!s || s.kind !== 'open') return;
      const cur = room.slots.findIndex(x => x.kind === 'human' && x.cid === c.id);
      if (cur >= 0) Object.assign(room.slots[cur], { kind: 'open', cid: null, name: '', level: null });
      Object.assign(s, { kind: 'human', cid: c.id, name: c.name, level: null });
      c.slot = m.slot | 0;
      break;
    }
    case 'kick': {
      if (!isHost) return;
      const s = room.slots[m.slot | 0];
      if (!s || s.kind !== 'human' || s.cid === c.id) return;
      const k = clients.get(s.cid);
      Object.assign(s, { kind: 'open', cid: null, name: '', level: null });
      if (k) { k.slot = -1; send(k.ws, { t: 'toast', msg: 'Der Gastgeber hat dich auf die Zuschauerbank gesetzt.' }); }
      break;
    }
    case 'start': {
      if (!isHost) return;
      const err = startGame(room);
      if (err) send(c.ws, { t: 'err', msg: err });
      return;
    }
  }
  broadcastRoom(room);
}

// ---------------------------------------------------------------------
// WebSocket-Verbindungen
// ---------------------------------------------------------------------
wss.on('connection', (ws) => {
  let c = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (!c) {
      if (m.t !== 'hello') return;
      const cid = String(m.cid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || ('c' + Math.random().toString(36).slice(2));
      c = clients.get(cid);
      if (c) {
        if (c.ws && c.ws !== ws) { try { c.ws.close(4000, 'Neue Verbindung'); } catch (e) {} }
        c.ws = ws; c.lastSeen = Date.now();
        if (m.name) c.name = cleanName(m.name);
        send(ws, { t: 'hello', cid });
        if (c.room) joinRoom(c, c.room);
      } else {
        c = { id: cid, ws, name: cleanName(m.name), room: null, slot: -1, lastSeen: Date.now(), rateT: 0, rateN: 0 };
        clients.set(cid, c);
        send(ws, { t: 'hello', cid });
      }
      return;
    }
    c.lastSeen = Date.now();
    try { handle(c, m); } catch (e) { console.error('Fehler bei Nachricht', m && m.t, e); }
  });
  ws.on('close', () => {
    if (!c || c.ws !== ws) return;
    c.ws = null; c.lastSeen = Date.now();
    const room = c.room;
    if (room) {
      if (room.game) {
        const pid = room.pidOf.get(c.id);
        const myC = c;
        setTimeout(() => { if (!myC.ws && myC.room === room && room.game && pid !== undefined && pid >= 0) botTakeover(room, pid); }, GAME_GRACE_MS);
      }
      broadcastRoom(room);
    }
  });
});

// Verbindungen prüfen & aufräumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { try { ws.terminate(); } catch (e) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 25000);

setInterval(() => {
  const now = Date.now();
  for (const c of [...clients.values()]) {
    if (c.ws) continue;
    const grace = c.room && c.room.game ? 30 * 60000 : LOBBY_GRACE_MS;
    if (now - c.lastSeen > grace) {
      if (c.room) leaveRoom(c);
      clients.delete(c.id);
    }
  }
  for (const room of [...rooms.values()]) {
    const online = [...room.clients.values()].some(x => x.ws);
    if (online) { room.emptySince = 0; continue; }
    if (!room.emptySince) room.emptySince = now;
    if (now - room.emptySince > 3 * 60000) {
      if (room.timer) clearInterval(room.timer);
      for (const c of room.clients.values()) { c.room = null; c.slot = -1; }
      rooms.delete(room.code);
    }
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`Rene's Rampart läuft auf Port ${PORT}`);
});
