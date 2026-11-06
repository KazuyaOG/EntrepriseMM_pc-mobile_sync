#!/usr/bin/env node
// Serveur de synchronisation MM — tourne sur l'ordinateur (ou n'importe quelle
// machine du réseau local). Les appareils s'y connectent en WebSocket ; il
// conserve l'état partagé, fusionne les modifications et diffuse les mises à
// jour aux autres appareils en temps réel.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
// `ws` est une dépendance du serveur. Dans l'application PC empaquetée, les
// dépendances se trouvent dans resources/app.asar/node_modules et le moteur
// partagé est copié dans resources/shared : resolveShared() reçoit donc le
// dossier de l'application pour retrouver `ws`, avec repli sur la résolution
// Node habituelle (développement, CLI autonome).
async function loadWebSocketServer(resolveFrom) {
  const attempts = [];
  if (resolveFrom) {
    try {
      const { createRequire } = await import('node:module');
      attempts.push(createRequire(path.join(resolveFrom, 'noop.js')).resolve('ws'));
    } catch { /* repli ci-dessous */ }
  }
  attempts.push('ws');
  for (const attempt of attempts) {
    try {
      const module = await import(attempt);
      if (module.WebSocketServer) return module.WebSocketServer;
      if (module.default?.WebSocketServer) return module.default.WebSocketServer;
    } catch { /* essai suivant */ }
  }
  throw Object.assign(
    new Error('Le module « ws » est requis pour la synchronisation. Lancez npm install dans pc_desktop.'),
    { code: 'MISSING_WS' }
  );
}
import { mergeData } from '../src/sync/merge.js';
import {
  PROTOCOL_VERSION,
  DEFAULT_PORT,
  DEFAULT_ROOM,
  normalizeRoom,
  validPort
} from '../src/sync/protocol.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_CLIENTS_PER_ROOM = 24;
const MAX_ROOMS = 32;
const ALLOWED_ORIGIN = /^(https?:|file:|capacitor:|ionic:|null$)/i;

export function defaultDataDir() {
  if (process.env.MM_SYNC_DIR) return process.env.MM_SYNC_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Gestion MM', 'sync');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Gestion MM', 'sync');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'gestion-mm', 'sync');
}

function addressOf(req) {
  const value = req.socket.remoteAddress || '';
  return value.replace(/^::ffff:/, '');
}

function localAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

const isLoopback = address => address === '127.0.0.1' || address === '::1' || address === '';

async function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Trop volumineux'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {number} [options.port]
 * @param {string} [options.host]      0.0.0.0 par défaut : accessible du téléphone
 * @param {string} [options.dataDir]
 * @param {string} [options.staticDir] dossier de l'application web PC (optionnel)
 * @param {string} [options.room]
 * @param {(line: string) => void} [options.log]
 */
export async function startSyncServer(options = {}) {
  if (!startSyncServer.WebSocketServer) {
    startSyncServer.WebSocketServer = await loadWebSocketServer(options.resolveFrom || '');
  }
  const requested = options.port === undefined ? DEFAULT_PORT : Number(options.port);
  // Le port 0 laisse le système choisir (utile pour les tests).
  if (requested !== 0 && !validPort(requested)) throw Object.assign(new Error(`Port invalide : ${options.port}`), { code: 'BAD_PORT' });
  const port = requested;
  const host = options.host || '0.0.0.0';
  const dataDir = options.dataDir || defaultDataDir();
  const staticDir = options.staticDir || '';
  const log = typeof options.log === 'function' ? options.log : () => {};
  const defaultRoom = normalizeRoom(options.room || DEFAULT_ROOM);

  await fsp.mkdir(dataDir, { recursive: true });
  const rooms = new Map(); // room -> { data, clients:Set, savedAt, createdAt }

  const roomFile = room => path.join(dataDir, `room-${normalizeRoom(room)}.json`);
  const loadRoom = async room => {
    const name = normalizeRoom(room);
    const cached = rooms.get(name);
    if (cached) return cached;
    const record = { data: null, clients: new Set(), savedAt: 0, createdAt: Date.now(), dirty: false };
    try {
      const raw = await fsp.readFile(roomFile(name), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        record.data = parsed.data ?? null;
        record.savedAt = Number(parsed.savedAt) || 0;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') log(`Lecture impossible (${name}) : ${error.message}`);
    }
    rooms.set(name, record);
    return record;
  };

  let writeTimer = null;
  const flushRoom = async (name, record) => {
    if (!record.dirty || !record.data) return;
    record.dirty = false;
    const target = roomFile(name);
    const temp = `${target}.tmp`;
    const payload = JSON.stringify({ savedAt: record.savedAt, data: record.data });
    try {
      await fsp.writeFile(temp, payload, 'utf8');
      await fsp.rename(temp, target);
    } catch (error) {
      record.dirty = true;
      log(`Écriture impossible (${name}) : ${error.message}`);
    }
  };
  const scheduleWrite = (name, record) => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      for (const [room, record] of rooms) if (record.dirty) flushRoom(room, record);
    }, 250);
    writeTimer.unref?.();
  };
  const persistNow = async () => {
    clearTimeout(writeTimer);
    for (const [name, record] of rooms) await flushRoom(name, record);
  };

  const countPeers = record => [...record.clients].filter(client => client.readyState === 1).length;

  function broadcast(record, message, except) {
    const payload = JSON.stringify(message);
    for (const client of record.clients) {
      if (client === except) continue;
      if (client.readyState !== 1) continue;
      try { client.send(payload); } catch { /* ignoré */ }
    }
  }

  const server = http.createServer(async (req, res) => {
    const address = addressOf(req);
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/health' || url.pathname === '/sync/health') {
      const body = JSON.stringify({
        ok: true,
        app: 'gestion-mm',
        protocol: PROTOCOL_VERSION,
        rooms: [...rooms.keys()],
        peers: [...rooms.values()].reduce((sum, record) => sum + countPeers(record), 0),
        addresses: localAddresses(),
        port: server.address()?.port || port,
        time: new Date().toISOString()
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(body);
      return;
    }

    if (url.pathname === '/sync/state') {
      // Instantané complet du salon : sert de secours si les WebSocket sont bloqués.
      if (!isLoopback(address)) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ ok: false, message: 'Accessible seulement depuis l’ordinateur.' }));
        return;
      }
      const record = await loadRoom(url.searchParams.get('room') || defaultRoom);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, savedAt: record.savedAt, data: record.data }));
      return;
    }

    if (url.pathname === '/sync/push' && req.method === 'POST') {
      // Secours HTTP pour les réseaux qui bloquent les WebSocket (accès local uniquement).
      if (!isLoopback(address)) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: 'Accessible seulement depuis l’ordinateur.' }));
        return;
      }
      try {
        const raw = await readBody(req, MAX_MESSAGE_BYTES);
        const payload = JSON.parse(raw || '{}');
        if (!payload || typeof payload.data !== 'object' || payload.data === null) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, message: 'Données manquantes.' }));
          return;
        }
        const roomName = normalizeRoom(payload.room || defaultRoom);
        const record = await loadRoom(roomName);
        record.data = mergeData(record.data || {}, payload.data, { remoteCreated: payload.created || {}, now: Date.now() });
        record.savedAt = Date.now();
        record.dirty = true;
        scheduleWrite(roomName, record);
        broadcast(record, { type: 'state', data: record.data, created: {}, peers: countPeers(record), savedAt: record.savedAt });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, savedAt: record.savedAt }));
        return;
      } catch (error) {
        res.writeHead(error.code === 'TOO_LARGE' ? 413 : 400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: 'Requête invalide.' }));
        return;
      }
    }

    if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
      // Sert l'application web : le téléphone ouvre http://IP-du-PC:8765 et peut
      // installer l'application directement depuis le navigateur.
      const root = path.resolve(staticDir);
      let target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (target !== root && !target.startsWith(root + path.sep)) {
        res.writeHead(403).end('Interdit');
        return;
      }
      let stat = null;
      try { stat = await fsp.stat(target); } catch { /* inexistant */ }
      if (stat && stat.isDirectory()) {
        target = path.join(target, 'index.html');
        try { stat = await fsp.stat(target); } catch { stat = null; }
      }
      if (!stat) {
        target = path.join(root, 'index.html');
        try { stat = await fsp.stat(target); } catch { stat = null; }
      }
      if (!stat) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Application non compilée. Lancez « npm run build ».');
        return;
      }
      const types = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
      };
      const headers = {
        'content-type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': path.basename(target) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable'
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, headers).end();
        return;
      }
      res.writeHead(200, headers);
      fs.createReadStream(target).pipe(res);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
  });

  const wss = new startSyncServer.WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/sync' && url.pathname !== '/') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const origin = req.headers.origin || '';
    if (!ALLOWED_ORIGIN.test(origin) && origin !== '') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.remote = addressOf(req);
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', ws => {
    ws.readyStateTracked = 0;
    ws.room = null;
    ws.deviceId = '';
    ws.deviceName = '';
    ws.alive = true;
    ws.isAlive = true;
    ws.on('pong', () => { ws.alive = true; });

    const reply = message => {
      if (ws.readyState !== 1) return;
      try { ws.send(JSON.stringify(message)); } catch { /* ignore */ }
    };

    ws.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return reply({ type: 'error', message: 'Message illisible.' }); }
      if (!message || typeof message.type !== 'string') return;

      if (message.type === 'ping') return reply({ type: 'pong', time: Date.now() });

      if (message.type === 'hello') {
        if (Number(message.protocol) !== PROTOCOL_VERSION) {
          reply({ type: 'welcome', protocol: PROTOCOL_VERSION, compatible: false });
          return ws.close(4001, 'Version incompatible');
        }
        const name = normalizeRoom(message.room || defaultRoom);
        if (!rooms.has(name) && rooms.size >= MAX_ROOMS) return ws.close(4003, 'Trop de salons');
        const record = await loadRoom(name);
        if (countPeers(record) >= MAX_CLIENTS_PER_ROOM && !record.clients.has(ws)) return ws.close(4003, 'Salon plein');
        if (ws.room && ws.room !== name && rooms.has(ws.room)) rooms.get(ws.room).clients.delete(ws);
        ws.room = name;
        ws.deviceId = String(message.deviceId || randomUUID()).slice(0, 80);
        ws.deviceName = String(message.deviceName || 'Appareil').slice(0, 40);
        record.clients.add(ws);
        const peers = countPeers(record);
        reply({
          type: 'welcome',
          protocol: PROTOCOL_VERSION,
          room: name,
          data: record.data,
          created: {},
          peers,
          savedAt: record.savedAt,
          serverTime: Date.now()
        });
        broadcast(record, { type: 'peer', device: ws.deviceName, peers });
        log(`Appareil connecté : ${ws.deviceName} (${ws.remote}) — ${peers} appareil(s)`);
        return;
      }

      if (message.type === 'push') {
        if (!ws.room) return reply({ type: 'rejected', code: 'NO_ROOM', message: 'Connexion non annoncée.' });
        const record = await loadRoom(ws.room);
        if (!message.data || typeof message.data !== 'object') return reply({ type: 'rejected', code: 'BAD_DATA' });
        const previousSavedAt = record.savedAt;
        let next;
        try {
          next = mergeData(record.data || {}, message.data, { remoteCreated: message.created || {}, now: Date.now() });
        } catch (error) {
          log(`Fusion impossible : ${error.message}`);
          return reply({ type: 'rejected', code: 'MERGE_FAILED', message: 'Fusion impossible.' });
        }
        record.data = next;
        record.savedAt = Date.now();
        record.dirty = true;
        scheduleWrite(ws.room, record);
        const peers = countPeers(record);
        reply({ type: 'applied', savedAt: record.savedAt, peers, data: record.data, created: {} });
        broadcast(record, {
          type: 'state',
          data: record.data,
          created: {},
          peers,
          savedAt: record.savedAt,
          from: ws.deviceName
        }, ws);
        if (previousSavedAt !== record.savedAt) log(`Synchronisé : ${ws.deviceName} → ${peers} appareil(s)`);
        return;
      }

      reply({ type: 'error', message: 'Type de message inconnu.' });
    });

    ws.on('close', () => {
      if (!ws.room) return;
      const record = rooms.get(ws.room);
      if (!record) return;
      record.clients.delete(ws);
      const peers = countPeers(record);
      broadcast(record, { type: 'peer', device: ws.deviceName, peers });
      log(`Appareil déconnecté : ${ws.deviceName || 'inconnu'} — ${peers} appareil(s)`);
    });

    ws.on('error', () => { /* 'close' suit */ });
  });

  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      if (ws.alive === false) { ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 30000);
  sweep.unref?.();

  await new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const actualPort = server.address()?.port || port;
  const addresses = () => localAddresses().map(ip => `ws://${ip}:${actualPort}/sync`);

  return {
    port: actualPort,
    host,
    dataDir,
    addresses,
    urlFor: ip => `ws://${ip}:${actualPort}/sync`,
    rooms: () => [...rooms.entries()].map(([name, record]) => ({ room: name, peers: countPeers(record), savedAt: record.savedAt, records: record.data ? Object.fromEntries(Object.entries(record.data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) : null })),
    async close() {
      clearInterval(sweep);
      await persistNow();
      for (const ws of wss.clients) {
        try { ws.terminate(); } catch { /* déjà fermé */ }
      }
      await new Promise(resolve => wss.close(() => resolve()));
      await new Promise(resolve => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        // Ferme les connexions HTTP persistantes (santé, fichiers statiques).
        server.closeAllConnections?.();
      });
    }
  };
}
