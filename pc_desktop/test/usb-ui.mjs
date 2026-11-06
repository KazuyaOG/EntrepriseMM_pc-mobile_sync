import { chromium as playwright } from '@playwright/test';
import assert from 'node:assert/strict';
import { initial } from '../src/data.js';
const launchOptions = { headless: true };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
const b = await playwright.launch(launchOptions);
const errors = [];
const drive = { id: 'usb-test|E:|1234', letter: 'E:', root: 'E:\\', label: 'Clé de Michel', freeBytes: 8 * 1024 ** 3, sizeBytes: 16 * 1024 ** 3 };
const file = { name: 'Sauvegarde-MM-2026-11-06.json', location: 'app', modifiedAt: '2026-11-06T14:00:00Z', bytes: 2048, clients: 4, invoices: 3 };
async function page(bridge) {
  const p = await b.newPage({ reducedMotion: 'reduce', viewport: { width: 1100, height: 900 } });
  p.on('pageerror', e => errors.push(e.message));
  if (bridge) await p.addInitScript(({ bridge, initial, drive, file }) => {
    window.usbCalls = [];
    window.usbDrives = [];
    const record = (name, args) => window.usbCalls.push({ name, args });
    window.mmUSB = {
      list: async () => { record('list'); return { ok: true, drives: window.usbDrives }; },
      exportBackup: async (id, data) => { record('export', { id, data }); return { ok: true, drive, backup: { name: file.name, path: 'E:\\Sauvegardes MM\\' + file.name, bytes: 2048 } }; },
      listBackups: async id => { record('scan', { id }); return { ok: true, drive, files: window.usbFiles || [], ignored: 0, limited: false }; },
      readBackup: async (id, location, name) => { record('read', { id, location, name }); return { ok: true, drive, data: { ...initial, notes: 'Restauré depuis USB' } }; }
    };
  }, { bridge, initial, drive, file });
  await p.goto('http://localhost:5173/');
  await p.getByRole('button', { name: 'Réglages', exact: true }).click();
  return p;
}
try {
  let p = await page(false);
  assert.equal(await p.getByLabel('Fichier de sauvegarde').count(), 0);
  let downloads = 0; p.on('download', () => downloads++);
  await p.getByRole('button', { name: 'Exporter une copie de sécurité', exact: true }).click();
  await p.getByRole('heading', { name: 'À utiliser dans l’application Windows' }).waitFor();
  assert.equal(downloads, 0);
  await p.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await p.getByRole('button', { name: 'Restaurer une copie JSON', exact: true }).click();
  await p.getByRole('heading', { name: 'À utiliser dans l’application Windows' }).waitFor();
  assert.equal(downloads, 0);
  await p.close();

  p = await page(true);
  await p.getByRole('button', { name: 'Exporter une copie de sécurité', exact: true }).click();
  await p.getByRole('heading', { name: 'Insérez une clé USB', exact: true }).waitFor();
  await p.evaluate(() => { window.usbDrives = [{ id: 'usb-test|E:|1234', letter: 'E:', label: 'Clé de Michel', freeBytes: 8589934592, sizeBytes: 17179869184 }]; });
  await p.getByRole('heading', { name: 'Enregistrer votre copie sur cette clé?' }).waitFor({ timeout: 7000 });
  await p.getByRole('button', { name: 'Sauvegarder sur la clé USB', exact: true }).click();
  await p.getByRole('heading', { name: 'Copie enregistrée sur la clé USB' }).waitFor();
  assert.equal(await p.evaluate(() => window.usbCalls.some(c => c.name === 'export')), true);
  await p.close();

  p = await page(true);
  await p.evaluate(() => { window.usbFiles = [{ name: 'Sauvegarde-MM-2026-11-06.json', location: 'app', modifiedAt: '2026-11-06T14:00:00Z', bytes: 2048, clients: 4, invoices: 3 }]; });
  await p.getByRole('button', { name: 'Restaurer une copie JSON', exact: true }).click();
  await p.getByRole('heading', { name: 'Insérez une clé USB', exact: true }).waitFor();
  await p.evaluate(() => { window.usbDrives = [{ id: 'usb-test|E:|1234', letter: 'E:', label: 'Clé de Michel', freeBytes: 8589934592, sizeBytes: 17179869184 }]; });
  await p.getByRole('button', { name: 'Restaurer cette sauvegarde', exact: true }).waitFor({ timeout: 7000 });
  const before = await p.evaluate(() => localStorage.getItem('mm-data-v1'));
  await p.getByRole('button', { name: 'Restaurer cette sauvegarde', exact: true }).click();
  await p.getByRole('heading', { name: 'Remplacer les données actuelles?' }).waitFor();
  assert.equal(await p.evaluate(() => localStorage.getItem('mm-data-v1')), before);
  await p.getByRole('button', { name: 'Revenir aux copies' }).click();
  assert.equal(await p.evaluate(() => localStorage.getItem('mm-data-v1')), before);
  await p.getByRole('button', { name: 'Restaurer cette sauvegarde', exact: true }).click();
  await p.getByRole('button', { name: 'Confirmer la restauration' }).click();
  await p.getByRole('heading', { name: 'Sauvegarde restaurée', exact: true }).waitFor();
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('mm-data-v1')).notes), 'Restauré depuis USB');
  await p.close();
  assert.deepStrictEqual(errors, []);
  console.log('PASS: browser has no disk-download/import fallback; missing USB prompts and auto-detects insertion; USB-only export; recognized-copy restore requires confirmation and persists only after confirmation.');
} finally { await b.close(); }
