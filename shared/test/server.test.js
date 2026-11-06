import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startSyncServer } from '../server/server.js';
import { mergeData, stampChanges, createdSince, fingerprint } from '../src/sync/merge.js';
import { initial } from '../../pc_desktop/src/data.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mm-sync-test-'));

/** Client minimal qui reproduit le comportement d'une application. */
async function connect(url, deviceName) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    messages.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(message)) {
        const waiter = waiters.splice(i, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    ws,
    messages,
    next(match, timeout = 4000) {
      const found = messages.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Message attendu non reçu')), timeout);
        waiters.push({ match, resolve, timer });
      });
    },
    send(message) { ws.send(JSON.stringify(message)); },
    close() { ws.close(); }
  };
}

test('le serveur diffuse les modifications du PC vers le mobile', async () => {
  const dataDir = await tmp();
  const server = await startSyncServer({ port: 0, dataDir });
  const base = `ws://127.0.0.1:${server.port}/sync`;

  const pc = await connect(base, 'pc');
  pc.send({ type: 'hello', protocol: 1, room: 'test', deviceId: 'pc-1', deviceName: 'Ordinateur' });
  const welcomePc = await pc.next(m => m.type === 'welcome');
  assert.equal(welcomePc.data, null, 'premier démarrage : aucune donnée partagée');

  const pcData = stampChanges(initial, { ...structuredClone(initial), notes: 'Modifié sur le PC' }, 1000);
  pc.send({ type: 'push', room: 'test', data: pcData, created: createdSince(initial, pcData), base: null });
  const applied = await pc.next(m => m.type === 'applied');
  assert.ok(applied.data, 'le serveur renvoie l’état fusionné');

  const phone = await connect(base, 'phone');
  phone.send({ type: 'hello', protocol: 1, room: 'test', deviceId: 'phone-1', deviceName: 'Téléphone' });
  const welcomePhone = await phone.next(m => m.type === 'welcome');
  assert.equal(welcomePhone.data.notes, 'Modifié sur le PC', 'le téléphone reçoit les données du PC');

  // Le téléphone modifie à son tour : le PC est prévenu en temps réel.
  const phoneData = stampChanges(welcomePhone.data, {
    ...structuredClone(welcomePhone.data),
    reminders: [...welcomePhone.data.reminders, { id: 99, text: 'Créé sur le téléphone', date: '2026-11-10', done: false }]
  }, 5000);
  const statePromise = pc.next(m => m.type === 'state' && m.data?.reminders?.some(r => r.id === 99));
  phone.send({ type: 'push', room: 'test', data: phoneData, created: createdSince(welcomePhone.data, phoneData) });
  const pushed = await statePromise;
  assert.ok(pushed.data.reminders.some(r => r.id === 99), 'le PC reçoit le rappel créé sur le téléphone');

  pc.close();
  phone.close();
  await server.close();

  // L'état est conservé sur le disque : un redémarrage ne perd rien.
  const files = await fs.readdir(dataDir);
  assert.ok(files.some(name => name.startsWith('room-test')), 'état sauvegardé sur le disque');
  const restarted = await startSyncServer({ port: 0, dataDir });
  const again = await connect(`ws://127.0.0.1:${restarted.port}/sync`, 'pc');
  again.send({ type: 'hello', protocol: 1, room: 'test', deviceId: 'pc-1', deviceName: 'Ordinateur' });
  const welcome = await again.next(m => m.type === 'welcome');
  assert.equal(welcome.data.notes, 'Modifié sur le PC');
  assert.ok(welcome.data.reminders.some(r => r.id === 99));
  again.close();
  await restarted.close();
});

test('deux appareils connectés simultanément convergent sans perte', async () => {
  const dataDir = await tmp();
  const server = await startSyncServer({ port: 0, dataDir });
  const url = `ws://127.0.0.1:${server.port}/sync`;
  let a; let b;
  try {
    a = await connect(url, 'a');
    a.send({ type: 'hello', protocol: 1, room: 'live', deviceId: 'a', deviceName: 'PC' });
    await a.next(m => m.type === 'welcome');
    const start = stampChanges(initial, structuredClone(initial), 1);
    a.send({ type: 'push', room: 'live', data: start, created: {} });
    await a.next(m => m.type === 'applied');

    b = await connect(url, 'b');
    b.send({ type: 'hello', protocol: 1, room: 'live', deviceId: 'b', deviceName: 'Mobile' });
    const welcomeB = await b.next(m => m.type === 'welcome');

    const fromA = stampChanges(welcomeB.data, {
      ...structuredClone(welcomeB.data),
      expenses: [...welcomeB.data.expenses, { id: 555, date: '2026-11-06', vendor: 'PC', category: 'Autres', base: 12 }]
    }, 1000);
    a.send({ type: 'push', room: 'live', data: fromA, created: createdSince(welcomeB.data, fromA) });

    const fromB = stampChanges(welcomeB.data, {
      ...structuredClone(welcomeB.data),
      clients: [...welcomeB.data.clients, { id: 404, name: 'Client mobile', phone: '555', type: 'Résidentiel' }]
    }, 2000);
    b.send({ type: 'push', room: 'live', data: fromB, created: createdSince(welcomeB.data, fromB) });

    const complete = m => m.data
      && m.data.expenses?.some(e => e.id === 555)
      && m.data.clients?.some(c => c.id === 404);
    const [onA, onB] = await Promise.all([
      a.next(m => complete(m) && (m.type === 'applied' || m.type === 'state')),
      b.next(m => complete(m) && (m.type === 'applied' || m.type === 'state'))
    ]);
    assert.ok(onA.data.expenses.some(e => e.id === 555));
    assert.ok(onA.data.clients.some(c => c.id === 404));
    assert.equal(fingerprint(onB.data), fingerprint(onA.data), 'les deux appareils ont le même état');
  } finally {
    a?.close();
    b?.close();
    await server.close();
  }
});

test('la route /health répond et donne les adresses', async () => {
  const dataDir = await tmp();
  const server = await startSyncServer({ port: 0, dataDir });
  const response = await fetch(`http://127.0.0.1:${server.port}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.app, 'gestion-mm');
  assert.equal(body.protocol, 1);
  await server.close();
});

test('le serveur sert l’application web compilée', async () => {
  const dataDir = await tmp();
  const staticDir = await tmp();
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Gestion MM</title>');
  const server = await startSyncServer({ port: 0, dataDir, staticDir });
  const page = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
  assert.match(page, /Gestion MM/);
  const fallback = await (await fetch(`http://127.0.0.1:${server.port}/clients`)).text();
  assert.match(fallback, /Gestion MM/, 'les routes de l’application retombent sur index.html');
  await server.close();
});

test('un port invalide est refusé clairement', async () => {
  await assert.rejects(() => startSyncServer({ port: 80, dataDir: os.tmpdir() }), error => error.code === 'BAD_PORT');
});

test('le serveur ignore les messages malformés sans tomber', async () => {
  const dataDir = await tmp();
  const server = await startSyncServer({ port: 0, dataDir });
  const client = await connect(`ws://127.0.0.1:${server.port}/sync`, 'x');
  client.ws.send('pas du json');
  const error = await client.next(m => m.type === 'error');
  assert.ok(error.message);
  assert.ok(server.rooms());
  client.close();
  await server.close();
});

test('le serveur résiste aux trames invalides et à la traversée de dossier', async () => {
  const dataDir = await tmp();
  const staticDir = await tmp();
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Gestion MM</title>');
  const server = await startSyncServer({ port: 0, dataDir, staticDir });
  const client = await connect(`ws://127.0.0.1:${server.port}/sync`, 'robuste');
  try {
    for (const payload of ['pas du json', '{}', '{"type":123}', '{"type":"inconnu"}', 'null', '[]']) client.ws.send(payload);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Le serveur répond toujours.
    const health = await (await fetch(`http://127.0.0.1:${server.port}/health`)).json();
    assert.equal(health.ok, true);

    // Une version de protocole inconnue est refusée clairement.
    client.send({ type: 'hello', protocol: 99, room: 'x' });
    const welcome = await client.next(message => message.type === 'welcome');
    assert.equal(welcome.compatible, false);

    // Aucun fichier hors du dossier de l'application n'est servi : les chemins
    // remontants sont refusés ou retombent sur index.html.
    await fs.writeFile(path.join(dataDir, 'secret.txt'), 'confidentiel');
    for (const attempt of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/../../etc/passwd']) {
      const response = await fetch(`http://127.0.0.1:${server.port}${attempt}`);
      const body = await response.text();
      assert.ok(!body.includes('confidentiel'), `${attempt} ne doit pas exposer le dossier de données`);
      assert.ok(!body.includes('root:'), `${attempt} ne doit pas exposer le système`);
      if (response.status === 200) assert.match(body, /Gestion MM/, 'seule l’application est servie');
    }
  } finally {
    client.close();
    await server.close();
  }
});

test('huit appareils peuvent travailler ensemble', async () => {
  const dataDir = await tmp();
  const server = await startSyncServer({ port: 0, dataDir });
  const clients = [];
  try {
    for (let i = 0; i < 8; i++) {
      const client = await connect(`ws://127.0.0.1:${server.port}/sync`, 'appareil-' + i);
      client.send({ type: 'hello', protocol: 1, room: 'foule', deviceId: 'd' + i, deviceName: 'Appareil ' + i });
      await client.next(message => message.type === 'welcome');
      clients.push(client);
    }
    const health = await (await fetch(`http://127.0.0.1:${server.port}/health`)).json();
    assert.equal(health.peers, 8);

    // Une écriture d'un appareil se diffuse aux autres.
    const source = clients[0];
    const data = stampChanges(initial, { ...structuredClone(initial), notes: 'Vu par tous' }, 1000);
    const witnessed = clients[7].next(message => message.type === 'state' && message.data?.notes === 'Vu par tous');
    source.send({ type: 'push', room: 'foule', data, created: createdSince(initial, data) });
    const received = await witnessed;
    assert.equal(received.data.notes, 'Vu par tous');
  } finally {
    for (const client of clients) client.close();
    await server.close();
  }
});
