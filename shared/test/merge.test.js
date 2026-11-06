import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeData,
  stampChanges,
  createdSince,
  fingerprint,
  stableStringify,
  normalize,
  blankData
} from '../src/sync/merge.js';

const base = () => ({
  company: { name: 'Entreprise', phone: '514' },
  clients: [
    { id: 1, name: 'Sophie', phone: '450', type: 'Résidentiel' },
    { id: 2, name: 'Jean', phone: '451', type: 'Résidentiel' }
  ],
  invoices: [{ id: 1001, clientId: 1, date: '2026-11-06', status: 'Payée', lines: [{ description: 'Vitres', qty: 1, price: 100 }] }],
  appointments: [{ id: 1, clientId: 1, invoiceId: 1001, date: '2026-11-06', time: '09:00', service: 'Vitres' }],
  expenses: [{ id: 1, date: '2026-11-06', vendor: 'Quincaillerie', base: 10 }],
  reminders: [{ id: 1, text: 'Rappel', date: '2026-11-06', done: false }],
  notes: 'Note initiale',
  settings: { tips: true, taxFrequency: 'Trimestrielle' },
  meta: {},
  tombstones: {}
});

const clone = value => structuredClone(value);

test('une modification simple se propage dans les deux sens', () => {
  const origin = base();
  const pc = stampChanges(origin, { ...clone(origin), notes: 'Note PC' }, 1000);
  const mobile = stampChanges(origin, { ...clone(origin), reminders: [{ id: 2, text: 'Mobile', date: '2026-11-07', done: false }, ...origin.reminders] }, 2000);

  const onMobile = mergeData(mobile, pc, { now: 3000 });
  assert.equal(onMobile.notes, 'Note PC');
  assert.equal(onMobile.reminders.length, 2, 'le rappel créé sur mobile est conservé');

  const onPc = mergeData(pc, mobile, { now: 3000 });
  assert.equal(onPc.notes, 'Note PC');
  assert.equal(onPc.reminders.length, 2);
  assert.equal(stableStringify(onPc), stableStringify(onMobile), 'convergence identique');
});

test('la version la plus récente gagne sur le même enregistrement', () => {
  const origin = base();
  const pc = stampChanges(origin, { ...clone(origin), clients: origin.clients.map(c => (c.id === 1 ? { ...c, phone: '111' } : c)) }, 5000);
  const mobile = stampChanges(origin, { ...clone(origin), clients: origin.clients.map(c => (c.id === 1 ? { ...c, phone: '222' } : c)) }, 9000);
  const merged = mergeData(pc, mobile, { now: 10000 });
  assert.equal(merged.clients.find(c => c.id === 1).phone, '222');
  const reversed = mergeData(mobile, pc, { now: 10000 });
  assert.equal(reversed.clients.find(c => c.id === 1).phone, '222');
});

test('une fiche supprimée ne revient pas', () => {
  const origin = base();
  const pcBefore = stampChanges(origin, { ...clone(origin), clients: origin.clients.map(c => ({ ...c, name: c.name + ' (modifié)' })) }, 1000);
  const pcAfter = stampChanges(pcBefore, { ...clone(pcBefore), clients: pcBefore.clients.filter(c => c.id !== 2) }, 6000);
  const mobile = stampChanges(origin, { ...clone(origin), notes: 'Note mobile' }, 2000);

  const onMobile = mergeData(mobile, pcAfter, { now: 7000 });
  assert.equal(onMobile.clients.length, 1, 'le client 2 reste supprimé');
  assert.ok(onMobile.tombstones['clients|2']);

  // Une vieille copie du client ne doit pas le ressusciter.
  const resurrect = mergeData(onMobile, mobile, { now: 8000 });
  assert.equal(resurrect.clients.length, 1);
});

test('recréer un identifiant après suppression est permis', () => {
  const origin = base();
  const deleted = stampChanges(origin, { ...clone(origin), reminders: [] }, 1000);
  const recreated = stampChanges(deleted, { ...clone(deleted), reminders: [{ id: 1, text: 'Nouveau', date: '2026-11-08', done: false }] }, 2000);
  assert.equal(recreated.reminders.length, 1);
  assert.equal(recreated.tombstones['reminders|1'], undefined, 'la pierre tombale est levée');
  const merged = mergeData(recreated, { ...clone(origin), meta: {} }, { now: 3000 });
  assert.equal(merged.reminders.length, 1);
  assert.equal(merged.reminders[0].text, 'Nouveau');
});

test('deux créations simultanées du même numéro de facture ne s’écrasent pas', () => {
  const origin = base();
  const pcNext = { ...clone(origin) };
  pcNext.invoices.push({ id: 1002, clientId: 1, date: '2026-11-06', status: 'En attente', lines: [{ description: 'PC', qty: 1, price: 50 }] });
  pcNext.appointments.push({ id: 'a-pc', clientId: 1, invoiceId: 1002, date: '2026-11-06', time: '08:00', service: 'PC' });
  const mobileNext = { ...clone(origin) };
  mobileNext.invoices.push({ id: 1002, clientId: 2, date: '2026-11-06', status: 'En attente', lines: [{ description: 'Mobile', qty: 1, price: 80 }] });
  mobileNext.appointments.push({ id: 'a-mobile', clientId: 2, invoiceId: 1002, date: '2026-11-07', time: '10:00', service: 'Mobile' });

  const pc = stampChanges(origin, pcNext, 1000);
  const mobile = stampChanges(origin, mobileNext, 3000);
  const options = {
    localCreated: createdSince(origin, pc),
    remoteCreated: createdSince(origin, mobile),
    now: 5000
  };
  const onPc = mergeData(pc, mobile, options);
  const onMobile = mergeData(mobile, pc, {
    localCreated: createdSince(origin, mobile),
    remoteCreated: createdSince(origin, pc),
    now: 5000
  });

  assert.equal(onPc.invoices.length, 3, 'les deux factures existent');
  assert.equal(onMobile.invoices.length, 3);
  assert.equal(stableStringify(onPc.invoices.map(i => i.id).sort()), stableStringify(onMobile.invoices.map(i => i.id).sort()));
  const kept = onPc.invoices.find(i => i.id === 1002);
  assert.equal(kept.lines[0].description, 'PC', 'la plus ancienne garde son numéro');
  const moved = onPc.invoices.find(i => i.id === 1003);
  assert.equal(moved.lines[0].description, 'Mobile');
  const movedAppointment = onPc.appointments.find(a => a.id === 'a-mobile');
  assert.equal(movedAppointment.invoiceId, 1003, 'le rendez-vous suit la facture déplacée');
  const keptAppointment = onPc.appointments.find(a => a.id === 'a-pc');
  assert.equal(keptAppointment.invoiceId, 1002);
  assert.deepEqual(
    onPc.invoices.map(i => i.id).sort((a, b) => a - b),
    onMobile.invoices.map(i => i.id).sort((a, b) => a - b)
  );
});

test('les réglages et la note libre suivent la modification la plus récente', () => {
  const origin = base();
  const pc = stampChanges(origin, { ...clone(origin), settings: { tips: false, taxFrequency: 'Annuelle' } }, 1000);
  const mobile = stampChanges(origin, { ...clone(origin), notes: 'Note du téléphone' }, 2000);
  const merged = mergeData(pc, mobile, { now: 3000 });
  assert.equal(merged.settings.tips, false);
  assert.equal(merged.notes, 'Note du téléphone');
  assert.ok(merged.meta.settings > 0);
  assert.ok(merged.meta.notes > 0);
});

test('les modifications identiques ne s’horodatent pas', () => {
  const origin = base();
  const same = stampChanges(origin, clone(origin), 1000);
  assert.equal(same, origin, 'aucun changement : même objet');
});

test('les horodatages ne reculent jamais', () => {
  const origin = base();
  const first = stampChanges(origin, { ...clone(origin), notes: 'A' }, 9000);
  const second = stampChanges(first, { ...clone(first), notes: 'B' }, 5000);
  assert.ok(second.meta.notes > first.meta.notes);
});

test('les enregistrements sans updatedAt restent compatibles', () => {
  const origin = base();
  const merged = mergeData(origin, clone(origin), { now: 1000 });
  assert.equal(merged.clients.length, 2);
  assert.equal(merged.invoices.length, 1);
});

test('la synchronisation est idempotente', () => {
  const origin = base();
  const a = stampChanges(origin, { ...clone(origin), notes: 'Mergé' }, 1000);
  const once = mergeData(a, origin, { now: 2000 });
  const twice = mergeData(once, origin, { now: 3000 });
  assert.equal(stableStringify(once), stableStringify(twice));
  assert.equal(fingerprint(once), fingerprint(twice));
});

test('normalize tolère des données abîmées', () => {
  const broken = normalize({ clients: 'nope', invoices: [{ id: 1 }, null], company: null, tombstones: { 'clients|x': 'bad' } });
  assert.deepEqual(broken.clients, []);
  assert.equal(broken.invoices.length, 1);
  assert.deepEqual(broken.company, {});
  assert.deepEqual(broken.tombstones, {});
});

test('trois appareils convergent vers le même état', () => {
  const origin = base();
  const pc = stampChanges(origin, { ...clone(origin), notes: 'PC', reminders: [...origin.reminders, { id: 10, text: 'PC', date: '2026-11-09', done: false }] }, 1000);
  const phone = stampChanges(origin, { ...clone(origin), company: { name: 'Entreprise', phone: '999' }, expenses: [{ id: 20, date: '2026-11-07', vendor: 'Phone', base: 5 }, ...origin.expenses] }, 2000);
  const tablet = stampChanges(origin, { ...clone(origin), clients: origin.clients.map(c => (c.id === 2 ? { ...c, phone: '777' } : c)) }, 3000);

  const a = mergeData(pc, phone, { now: 4000 });
  const b = mergeData(a, tablet, { now: 5000 });
  const c = mergeData(tablet, mergeData(phone, pc, { now: 4000 }), { now: 5000 });
  const d = mergeData(mergeData(tablet, pc, { now: 4000 }), phone, { now: 5000 });
  assert.equal(stableStringify(b), stableStringify(c));
  assert.equal(stableStringify(b), stableStringify(d));
  assert.equal(b.notes, 'PC');
  assert.equal(b.company.phone, '999');
  assert.equal(b.clients.find(x => x.id === 2).phone, '777');
  assert.equal(b.reminders.length, 2);
  assert.equal(b.expenses.length, 2);
});

test('les données de démonstration sont reconnues, les vraies non', async () => {
  const { isDemoData } = await import('../src/sync/merge.js');
  const { initial } = await import('../../pc_desktop/src/data.js');
  assert.equal(isDemoData(initial), true);

  const real = structuredClone(initial);
  real.clients = [{ id: 1, name: 'Client réel', phone: '514 555-0101', type: 'Résidentiel' }];
  real.reminders = [];
  real.expenses = [];
  assert.equal(isDemoData(real), false, 'des données réelles ne déclenchent pas l’avertissement');

  const empty = blankData(initial);
  assert.equal(empty.clients.length, 0);
  assert.equal(empty.invoices.length, 0);
  assert.equal(empty.company.name, initial.company.name, 'la fiche d’entreprise est conservée');
  assert.equal(isDemoData(empty), false);
});

test('effacer les exemples supprime les fiches mais garde l’entreprise', async () => {
  const { initial } = await import('../../pc_desktop/src/data.js');
  // Aucune modification : stampChanges renvoie l'état tel quel (pas de meta).
  const before = initial;
  const cleared = stampChanges(before, blankData(before), 2000);
  assert.equal(cleared.clients.length, 0);
  assert.equal(cleared.invoices.length, 0);
  assert.equal(cleared.company.name, initial.company.name);
  // Les suppressions sont mémorisées : un autre appareil les appliquera.
  assert.ok(cleared.tombstones['clients|1']);
  // La fiche d'entreprise n'a pas changé : elle n'est pas réhorodatée.
  assert.equal(cleared.meta.company, undefined);

  // Même une vieille copie ne ressuscite pas les fiches effacées.
  const merged = mergeData(cleared, before, { now: 3000 });
  assert.equal(merged.clients.length, 0);
  assert.equal(merged.company.name, initial.company.name);
});
