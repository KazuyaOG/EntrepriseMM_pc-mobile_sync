import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { initial } from '../src/data.js';
const require = createRequire(import.meta.url);
const { isBackup, parseBackup, backupPath, listBackups, readBackup, writeBackup } = require('../electron/backup.cjs');
const { normalizeDrives } = require('../electron/usb.cjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-usb-test-'));
const plain = value => JSON.parse(JSON.stringify(value));
try {
  assert.equal(isBackup(initial), true);
  assert.equal(isBackup({ ...initial, invoices: [{ id: 1, lines: [{ qty: 'x', price: 1 }] }] }), false);
  assert.throws(() => parseBackup('{invalide'), { code: 'INVALID' });
  assert.throws(() => parseBackup('{"company":{}}'), { code: 'INVALID' });
  assert.deepStrictEqual(plain(parseBackup('\uFEFF' + JSON.stringify(initial))), plain(initial));
  for (const name of ['../secret.json', '..\\secret.json', 'C:\\secret.json', '/secret.json', 'sous/dossier.json', 'note.txt', 'nul\0.json']) {
    assert.throws(() => backupPath(root, 'app', name), { code: 'INVALID_PATH' });
  }
  assert.throws(() => backupPath(root, 'downloads', 'backup.json'), { code: 'INVALID_PATH' });
  const now = new Date(2026, 10, 6, 10, 0, 0);
  const first = await writeBackup(root, initial, now);
  const second = await writeBackup(root, { ...initial, notes: 'Deuxième copie' }, now);
  assert.equal(first.name, 'Sauvegarde-MM-2026-11-06.json');
  assert.equal(second.name, 'Sauvegarde-MM-2026-11-06-2.json');
  assert.deepStrictEqual(plain(await readBackup(root, 'app', first.name)), plain(initial));
  assert.equal((await readBackup(root, 'app', second.name)).notes, 'Deuxième copie');
  assert.equal((await fs.readdir(path.join(root, 'Sauvegardes MM'))).some(n => n.endsWith('.tmp')), false);
  await fs.writeFile(path.join(root, 'ancienne-copie.json'), JSON.stringify(initial));
  await fs.writeFile(path.join(root, 'invalide.json'), '{non');
  await fs.writeFile(path.join(root, 'prive.txt'), 'ne pas lire');
  const listed = await listBackups(root);
  assert.equal(listed.files.length, 3);
  assert.equal(listed.ignored, 1);
  assert.ok(listed.files.some(f => f.location === 'root' && f.name === 'ancienne-copie.json'));
  assert.ok(!listed.files.some(f => f.name === 'prive.txt'));
  await assert.rejects(readBackup(root, 'root', 'invalide.json'), { code: 'INVALID' });
  const drives = normalizeDrives(JSON.stringify({ id: 'USBSTOR\\DISK|E:|1234', letter: 'E:', label: 'Clé de Michel', freeBytes: 100, sizeBytes: 200 }));
  assert.equal(drives.length, 1);
  assert.equal(drives[0].root, 'E:\\');
  assert.equal(normalizeDrives('[]').length, 0);
  assert.equal(normalizeDrives(JSON.stringify([{ id: 'bad', letter: 'C:\\Users' }])).length, 0);
  console.log('PASS: validation, UTF-8/BOM JSON, USB normalization, root/legacy discovery, invalid-file rejection, path confinement, dated non-overwriting exports and exact round trip.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
