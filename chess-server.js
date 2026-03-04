#!/usr/bin/env node
/**
 * Chess Relay Server
 * WebSocket server on port 8780 that manages multiplayer chess game rooms.
 * Players host or join games with a 4-character code.
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 8780;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1

const rooms = new Map(); // code → { white, black, moves[], state, public }
const lobbyClients = new Set(); // WebSocket connections currently in the lobby

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function broadcast(room, msg, exclude) {
  const data = JSON.stringify(msg);
  for (const role of ['white', 'black']) {
    const ws = room[role];
    if (ws && ws !== exclude && ws.readyState === 1) ws.send(data);
  }
}

function getPublicGames() {
  const games = [];
  for (const [code, room] of rooms) {
    if (room.public && !room.started) games.push({ code, name: room.names.white });
  }
  return games;
}

function broadcastPublicGames() {
  const msg = JSON.stringify({ type: 'public_games', games: getPublicGames() });
  for (const client of lobbyClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerColor = null;
  lobbyClients.add(ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'host': {
        if (playerRoom) return send({ type: 'error', message: 'Already in a room' });
        const code = generateCode();
        const isPublic = !!msg.public;
        const name = (msg.name || '').slice(0, 20) || null;
        const room = { white: ws, black: null, moves: [], started: false, gameOver: false, public: isPublic, names: { white: name, black: null } };
        rooms.set(code, room);
        playerRoom = code;
        playerColor = 'white';
        lobbyClients.delete(ws);
        send({ type: 'hosted', code, color: 'white' });
        if (isPublic) broadcastPublicGames();
        console.log(`Room ${code} created${isPublic ? ' (public)' : ''}`);
        break;
      }

      case 'join': {
        if (playerRoom) return send({ type: 'error', message: 'Already in a room' });
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send({ type: 'error', message: 'Room not found' });
        if (room.black) return send({ type: 'error', message: 'Room is full' });
        const name = (msg.name || '').slice(0, 20) || null;
        room.black = ws;
        room.names.black = name;
        room.started = true;
        playerRoom = code;
        playerColor = 'black';
        lobbyClients.delete(ws);
        send({ type: 'joined', code, color: 'black', moves: room.moves, opponentName: room.names.white });
        broadcast(room, { type: 'opponent_joined', name }, ws);
        if (room.public) broadcastPublicGames();
        console.log(`Room ${code}: opponent joined`);
        break;
      }

      case 'move': {
        if (!playerRoom) return;
        const room = rooms.get(playerRoom);
        if (!room || !room.started || room.gameOver) return;
        const move = { from: msg.from, to: msg.to, promotion: msg.promotion || null };
        room.moves.push(move);
        broadcast(room, { type: 'move', ...move, by: playerColor }, ws);
        break;
      }

      case 'game_over': {
        if (!playerRoom) return;
        const room = rooms.get(playerRoom);
        if (!room) return;
        room.gameOver = true;
        broadcast(room, { type: 'game_over', reason: msg.reason, winner: msg.winner }, ws);
        break;
      }

      case 'resign': {
        if (!playerRoom) return;
        const room = rooms.get(playerRoom);
        if (!room) return;
        room.gameOver = true;
        const winner = playerColor === 'white' ? 'black' : 'white';
        broadcast(room, { type: 'game_over', reason: 'resignation', winner }, ws);
        send({ type: 'game_over', reason: 'resignation', winner });
        break;
      }

      case 'list_public': {
        send({ type: 'public_games', games: getPublicGames() });
        break;
      }

      case 'emote': {
        if (!playerRoom) return;
        const room = rooms.get(playerRoom);
        if (!room) return;
        broadcast(room, { type: 'emote', emote: msg.emote }, ws);
        break;
      }

      case 'rematch': {
        if (!playerRoom) return;
        const room = rooms.get(playerRoom);
        if (!room) return;
        if (!room.rematchVotes) room.rematchVotes = new Set();
        room.rematchVotes.add(playerColor);
        if (room.rematchVotes.size === 2) {
          // Swap colors
          const tmp = room.white;
          room.white = room.black;
          room.black = tmp;
          const tmpName = room.names.white;
          room.names.white = room.names.black;
          room.names.black = tmpName;
          room.moves = [];
          room.gameOver = false;
          room.rematchVotes = null;
          // Notify both with their new colors
          if (room.white && room.white.readyState === 1)
            room.white.send(JSON.stringify({ type: 'rematch_start', color: 'white' }));
          if (room.black && room.black.readyState === 1)
            room.black.send(JSON.stringify({ type: 'rematch_start', color: 'black' }));
        } else {
          broadcast(room, { type: 'rematch_requested' }, ws);
          send({ type: 'rematch_pending' });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    lobbyClients.delete(ws);
    if (!playerRoom) return;
    const room = rooms.get(playerRoom);
    if (!room) return;
    broadcast(room, { type: 'opponent_disconnected' }, ws);
    const wasPublic = room.public && !room.started;
    room[playerColor] = null;
    // Clean up empty rooms
    if (!room.white && !room.black) {
      rooms.delete(playerRoom);
      console.log(`Room ${playerRoom} deleted (empty)`);
    }
    if (wasPublic) broadcastPublicGames();
  });

  function send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chess relay server running on port ${PORT}`);
});
