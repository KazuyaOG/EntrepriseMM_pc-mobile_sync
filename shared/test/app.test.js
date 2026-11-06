// Vérifie que la synchronisation ne perturbe pas la logique métier existante :
// planification des rotations, factures uniques, suppressions, rechargement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, today } from '../../pc_desktop/src/data.js';
import { planClients, clientDefaults } from '../../pc_desktop/src/recurrence.js';
import { stampChanges, mergeData, stableStringify } from '../src/sync/merge.js';

const clone = value => structuredClone(value);

test('planClients reste idempotent une fois les données horodatées', () => {
  const withClient = clone(initial);
  withClient.clients.push(clientDefaults({
    id: 77, name: 'Client rotation', phone: '514', type: 'Résidentiel',
    price: 150, rotation: 'monthly', startDate: today(), service: 'Lavage de vitres intérieur et extérieur'
  }));

  const planned = planClients(withClient);
  assert.ok(planned.appointments.length > withClient.appointments.length);
  const stamped = stampChanges(withClient, planned, 1000);

  // Une deuxième planification sur les données horodatées ne duplique rien.
  const again = planClients(stamped);
  assert.equal(again.appointments.length, planned.appointments.length);
  assert.equal(again.invoices.length, planned.invoices.length);

  // Et ne crée pas de faux changements à horodater.
  const restamped = stampChanges(stamped, planClients(stamped), 2000);
  assert.equal(restamped, stamped);
});

test('une facture unique garde son rendez-vous lié après fusion', () => {
  const pc = clone(initial);
  const invoice = {
    id: 1004, clientId: 1, date: '2026-12-01', due: '2026-12-01', status: 'En attente',
    lines: [{ description: 'Travail ponctuel', qty: 1, price: 185 }]
  };
  pc.invoices.push(invoice);
  pc.appointments.push({ id: 'unique-1004', clientId: 1, invoiceId: 1004, date: '2026-12-01', time: '13:30', service: 'Travail ponctuel' });

  const stampedPc = stampChanges(initial, pc, 1000);
  const merged = mergeData(initial, stampedPc, { now: 2000 });
  const appointment = merged.appointments.find(a => a.invoiceId === 1004);
  assert.ok(appointment, 'le rendez-vous lié est conservé');
  assert.equal(appointment.time, '13:30');
  assert.equal(appointment.recurrenceKey, undefined, 'pas de clé de récurrence pour un travail ponctuel');
});

test('une suppression locale survit à une synchronisation dans les deux sens', () => {
  const before = stampChanges(initial, clone(initial), 1);
  const afterDelete = stampChanges(before, { ...clone(before), clients: before.clients.filter(c => c.id !== 3) }, 5000);
  const stale = stampChanges(initial, clone(initial), 2);

  const onOther = mergeData(stale, afterDelete, { now: 6000 });
  assert.equal(onOther.clients.length, 3);
  assert.ok(!onOther.clients.some(c => c.id === 3));
  // Un renvoi de l'ancienne base ne ressuscite pas le client.
  const replay = mergeData(onOther, stale, { now: 7000 });
  assert.ok(!replay.clients.some(c => c.id === 3));
});

test('les totaux monétaires sont inchangés par l’horodatage', () => {
  const stamped = stampChanges(initial, clone(initial), 1000);
  const base = initial.invoices.map(i => i.lines);
  const after = stamped.invoices.map(i => i.lines);
  assert.equal(stableStringify(base), stableStringify(after), 'les lignes de facture restent identiques');
});

test('les données existantes sans horodatage restent utilisables telles quelles', () => {
  const existing = clone(initial);
  const merged = mergeData(existing, clone(initial), { now: 1000 });
  assert.equal(merged.clients.length, existing.clients.length);
  assert.equal(merged.invoices.length, existing.invoices.length);
  // Le contenu est identique ; seule la présentation est ordonnée
  // (factures de la plus récente à la plus ancienne).
  const byId = (list, key = 'id') => [...list].sort((a, b) => Number(a[key]) - Number(b[key]));
  assert.equal(stableStringify(byId(merged.invoices)), stableStringify(byId(existing.invoices)));
  assert.equal(stableStringify(byId(merged.clients)), stableStringify(byId(existing.clients)));
  assert.deepEqual(merged.invoices.map(i => i.id), [1003, 1002, 1001]);
});
