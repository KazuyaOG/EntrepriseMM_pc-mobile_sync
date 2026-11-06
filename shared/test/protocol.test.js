import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServerUrl,
  normalizeRoom,
  normalizeDeviceName,
  validPort,
  isLoopbackUrl,
  DEFAULT_ROOM
} from '../src/sync/protocol.js';

test('les adresses saisies à la main sont converties correctement', () => {
  assert.equal(normalizeServerUrl('192.168.0.20', 8765), 'ws://192.168.0.20:8765/sync');
  assert.equal(normalizeServerUrl('192.168.0.20:9000', 8765), 'ws://192.168.0.20:9000/sync');
  assert.equal(normalizeServerUrl(' ws://10.0.0.5:8765/sync ', 8765), 'ws://10.0.0.5:8765/sync');
  assert.equal(normalizeServerUrl('http://pc.local', 8765), 'ws://pc.local:8765/sync');
  assert.equal(normalizeServerUrl('localhost', 8765), 'ws://localhost:8765/sync');
  assert.equal(normalizeServerUrl('pc-maison.local', 9000), 'ws://pc-maison.local:9000/sync');
});

test('les adresses invalides sont refusées', () => {
  assert.equal(normalizeServerUrl('', 8765), '');
  assert.equal(normalizeServerUrl('   ', 8765), '');
  assert.equal(normalizeServerUrl('ftp://exemple.com', 8765), '');
  assert.equal(normalizeServerUrl('javascript:alert(1)', 8765), '');
});

test('le nom de salle est normalisé', () => {
  assert.equal(normalizeRoom(''), DEFAULT_ROOM);
  assert.equal(normalizeRoom('!!'), DEFAULT_ROOM);
  assert.equal(normalizeRoom('Gestion MM'), 'gestion-mm');
  assert.equal(normalizeRoom('Équipe été'), 'equipe-ete');
  assert.equal(normalizeRoom('x'.repeat(120)).length, 48);
});

test('le nom d’appareil est borné', () => {
  assert.equal(normalizeDeviceName('  Michel  '), 'Michel');
  assert.equal(normalizeDeviceName('x'.repeat(60)).length, 40);
  assert.ok(normalizeDeviceName('').length > 0);
});

test('les ports valides sont acceptés, les autres refusés', () => {
  assert.equal(validPort(8765), 8765);
  assert.equal(validPort('9000'), 9000);
  assert.equal(validPort(80), null);
  assert.equal(validPort(70000), null);
  assert.equal(validPort('abc'), null);
});

test('les adresses locales sont reconnues pour l’aide contextuelle', () => {
  assert.equal(isLoopbackUrl('ws://localhost:8765/sync'), true);
  assert.equal(isLoopbackUrl('ws://127.0.0.1:8765/sync'), true);
  assert.equal(isLoopbackUrl('ws://192.168.0.20:8765/sync'), false);
});
