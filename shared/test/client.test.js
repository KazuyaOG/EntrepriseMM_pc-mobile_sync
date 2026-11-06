// Simule deux applications complètes (PC et mobile) : même code client, même
// serveur, deux stockages locaux distincts. Vérifie la synchronisation réelle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startSyncServer } from '../server/server.js';
import { initial } from '../../pc_desktop/src/data.js';
import { fingerprint } from '../src/sync/merge.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, message, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await tick(40);
  }
  throw new Error('Délai dépassé : ' + message);
}

/** Crée une « application » avec son stockage isolé. */
async function makeApp(moduleUrl, storage, startData) {
  globalThis.window.localStorage = storage;
  const { createSyncSession } = await import(moduleUrl);
  let data = startData;
  const app = {
    get data() { return data; },
    replace(next) { data = typeof next === 'function' ? next(data) : next; },
    session: null
  };
  app.session = createSyncSession({
    getData: () => data,
    apply: next => { data = next; },
    isPristine: () => startData === null
  });
  return app;
}

test('le PC et le mobile se synchronisent dans les deux sens', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-client-'));
  const server = await startSyncServer({ port: 0, dataDir });
  const url = `ws://127.0.0.1:${server.port}/sync`;

  globalThis.window = { localStorage: new MemoryStorage(), location: { protocol: 'http:', hostname: '127.0.0.1' } };
  const room = 'e2e';
  const config = device => ({ url, port: server.port, room, enabled: true, deviceId: device, deviceName: device });

  try {
    // Premier chargement du module : un module distinct par application.
    const storagePc = new MemoryStorage();
    storagePc.setItem('mm-sync-config-v1', JSON.stringify(config('pc')));
    storagePc.setItem('mm-data-v1', JSON.stringify(initial));
    const pc = await makeApp('../src/sync/client.js?pc', storagePc, structuredClone(initial));

    const storageMobile = new MemoryStorage();
    storageMobile.setItem('mm-sync-config-v1', JSON.stringify(config('phone')));
    const phone = await makeApp('../src/sync/client.js?phone', storageMobile, null);

    // Le mobile vierge reçoit les données du PC dès la connexion.
    await waitFor(() => phone.data && phone.data.clients?.length === initial.clients.length, 'le mobile reçoit les données du PC');
    await waitFor(() => pc.session.value().status === 'online', 'le PC est en ligne');

    // Modification sur le PC → arrive sur le mobile.
    pc.replace({ ...pc.data, notes: 'Note écrite sur le PC' });
    pc.replace(pc.session.commit(pc.data));
    await waitFor(() => phone.data.notes === 'Note écrite sur le PC', 'la note du PC arrive sur le mobile');

    // Modification sur le mobile → arrive sur le PC.
    phone.replace({ ...phone.data, reminders: [...phone.data.reminders, { id: 777, text: 'Créé sur le mobile', date: '2026-11-12', done: false }] });
    phone.replace(phone.session.commit(phone.data));
    await waitFor(() => (pc.data.reminders || []).some(r => r.id === 777), 'le rappel du mobile arrive sur le PC');

    // Suppression sur le mobile → arrive sur le PC et ne revient pas.
    const target = phone.data.reminders.find(r => r.id === 777);
    phone.replace({ ...phone.data, reminders: phone.data.reminders.filter(r => r.id !== 777) });
    phone.replace(phone.session.commit(phone.data));
    await waitFor(() => !(pc.data.reminders || []).some(r => r.id === 777), 'la suppression arrive sur le PC');

    // Les deux copies finissent identiques.
    await waitFor(() => fingerprint(pc.data) === fingerprint(phone.data), 'les deux appareils convergent');

    // Ajout d'un client sur le PC avec planification (comme saveItem).
    const newClient = { id: 4242, name: 'Client synchronisé', phone: '514-000-0000', type: 'Résidentiel', price: 100, service: 'Lavage', rotation: 'monthly', startDate: '2026-12-01' };
    pc.replace({ ...pc.data, clients: [...pc.data.clients, newClient] });
    pc.replace(pc.session.commit(pc.data));
    await waitFor(() => (phone.data.clients || []).some(c => c.id === 4242), 'le nouveau client arrive sur le mobile');
    const syncedClient = phone.data.clients.find(c => c.id === 4242);
    assert.equal(syncedClient.name, 'Client synchronisé');
    assert.equal(syncedClient.price, 100);
    assert.equal(syncedClient.rotation, 'monthly');

    pc.session.stop();
    phone.session.stop();
  } finally {
    await server.close();
  }
});

test('les modifications faites hors ligne sont envoyées à la reconnexion', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-client-off-'));
  const first = await startSyncServer({ port: 0, dataDir });
  const url = `ws://127.0.0.1:${first.port}/sync`;
  const storage = new MemoryStorage();
  storage.setItem('mm-sync-config-v1', JSON.stringify({ url, port: first.port, room: 'offline', enabled: true, deviceId: 'pc', deviceName: 'PC' }));
  storage.setItem('mm-data-v1', JSON.stringify(initial));
  globalThis.window = { localStorage: storage, location: { protocol: 'http:', hostname: '127.0.0.1' } };

  const { createSyncSession } = await import('../src/sync/client.js?offline');
  let data = structuredClone(initial);
  const session = createSyncSession({ getData: () => data, apply: next => { data = next; } });
  try {
    await waitFor(() => session.value().status === 'online', 'première synchronisation');
    await first.close();
    await waitFor(() => ['offline', 'connecting', 'syncing'].includes(session.value().status), 'passage hors ligne');

    data = { ...data, notes: 'Écrit hors ligne' };
    data = session.commit(data);
    assert.ok(storage.getItem('mm-sync-outbox-v1').includes('Écrit hors ligne'), 'la modification attend dans la file');

    // Redémarrage du serveur sur le même port : la reconnexion renvoie tout.
    const second = await startSyncServer({ port: first.port, dataDir });
    try {
      await waitFor(() => session.value().status === 'online', 'reconnexion automatique', 12000);
      const response = await fetch(`http://127.0.0.1:${second.port}/sync/state?room=offline`);
      const body = await response.json();
      assert.equal(body.data.notes, 'Écrit hors ligne', 'la modification hors ligne a été envoyée');
    } finally {
      session.stop();
      await second.close();
    }
  } finally {
    session.stop();
    await serverClose(first);
  }
});

async function serverClose(server) {
  try { await server.close(); } catch { /* déjà fermé */ }
}

test('les données existantes sans horodatage arrivent au serveur au premier contact', async () => {
  // Régression : la première poussée envoyait les données brutes (sans meta),
  // et le serveur ignorait alors les informations d'entreprise.
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-client-first-'));
  const server = await startSyncServer({ port: 0, dataDir });
  const storage = new MemoryStorage();
  const custom = structuredClone(initial);
  custom.company.gst = '123456789RT0001';
  custom.settings.taxFrequency = 'Annuelle';
  custom.notes = 'Note déjà présente avant la synchronisation';
  storage.setItem('mm-data-v1', JSON.stringify(custom));
  storage.setItem('mm-sync-config-v1', JSON.stringify({
    url: `ws://127.0.0.1:${server.port}/sync`, port: server.port, room: 'first', enabled: true, deviceId: 'pc', deviceName: 'PC'
  }));
  globalThis.window = { localStorage: storage, location: { protocol: 'http:', hostname: '127.0.0.1' } };

  const { createSyncSession } = await import('../src/sync/client.js?first');
  let data = custom;
  const session = createSyncSession({ getData: () => data, apply: next => { data = next; }, isPristine: () => false });
  try {
    await waitFor(() => session.value().status === 'online', 'première synchronisation');
    const response = await fetch(`http://127.0.0.1:${server.port}/sync/state?room=first`);
    const body = await response.json();
    assert.equal(body.data.company.gst, '123456789RT0001', 'le numéro de TPS est publié');
    assert.equal(body.data.settings.taxFrequency, 'Annuelle');
    assert.equal(body.data.notes, 'Note déjà présente avant la synchronisation');
    assert.ok(body.data.meta.company > 0, 'le champ est horodaté au premier envoi');
  } finally {
    session.stop();
    await server.close();
  }
});

test('deux appareils hors ligne puis reconnectés convergent sans perte', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-client-resilience-'));
  const port = 0;
  let server = await startSyncServer({ port, dataDir });
  const realPort = server.port;
  const url = `ws://127.0.0.1:${realPort}/sync`;

  const make = async (id, suffix) => {
    const storage = new MemoryStorage();
    storage.setItem('mm-sync-config-v1', JSON.stringify({ url, port: realPort, room: 'resilience', enabled: true, deviceId: id, deviceName: id }));
    const previous = globalThis.window;
    globalThis.window = { localStorage: storage, location: { protocol: 'http:', hostname: '127.0.0.1' } };
    // Le module lit la configuration à l'import : window doit déjà pointer sur
    // le stockage de CET appareil, et rester en place pendant toute la session.
    const { createSyncSession } = await import(`../src/sync/client.js?${suffix}`);
    let data = structuredClone(initial);
    const app = { storage, get data() { return data; }, replace: next => { data = next; } };
    app.session = createSyncSession({ getData: () => data, apply: next => { data = next; }, isPristine: () => true });
    return app;
  };

  const pc = await make('pc', 'res-pc');
  const phone = await make('phone', 'res-phone');
  try {
    await waitFor(() => pc.session.value().status === 'online' && phone.session.value().status === 'online', 'première synchronisation des deux appareils');

    // Panne : le serveur s'arrête, les deux appareils continuent de travailler.
    await server.close();
    await waitFor(() => ['offline', 'connecting', 'syncing'].includes(pc.session.value().status), 'le PC passe hors ligne');

    pc.replace({ ...pc.data, reminders: [...pc.data.reminders, { id: 'pc-offline', text: 'Écrit sur le PC hors ligne', date: '2026-11-20', done: false }] });
    pc.replace(pc.session.commit(pc.data));
    phone.replace({ ...phone.data, reminders: [...phone.data.reminders, { id: 'phone-offline', text: 'Écrit sur le téléphone hors ligne', date: '2026-11-21', done: false }] });
    phone.replace(phone.session.commit(phone.data));

    // Retour du serveur sur le même port : reconnexion automatique.
    server = await startSyncServer({ port: realPort, dataDir });
    await waitFor(() => pc.session.value().status === 'online' && phone.session.value().status === 'online', 'reconnexion des deux appareils', 20000);
    await waitFor(
      () => pc.data.reminders?.some(r => r.id === 'phone-offline') && phone.data.reminders?.some(r => r.id === 'pc-offline'),
      'les deux modifications hors ligne se rejoignent',
      15000
    );
    assert.equal(fingerprint(pc.data), fingerprint(phone.data), 'les deux appareils convergent');
  } finally {
    pc.session.stop();
    phone.session.stop();
    await server.close().catch(() => {});
  }
});

test('l’identifiant d’appareil reste stable d’une session à l’autre', async () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage, location: { protocol: 'http:', hostname: '127.0.0.1' } };
  const first = await import('../src/sync/client.js?stable-1');
  const second = await import('../src/sync/client.js?stable-2');
  const a = first.createSyncSession({ getData: () => null });
  const id1 = a.config.deviceId;
  a.stop();
  const b = second.createSyncSession({ getData: () => null });
  const id2 = b.config.deviceId;
  b.stop();
  assert.ok(id1);
  assert.equal(id1, id2, 'le serveur doit reconnaître le même appareil après un rechargement');
  assert.ok(storage.getItem('mm-sync-config-v1'), 'la configuration est enregistrée au premier lancement');
});
