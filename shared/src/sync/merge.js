// Fusion déterministe de deux copies des données MM (PC et mobile).
//
// Ce module ne touche ni au DOM ni au réseau : il est utilisé par les deux
// applications, par le serveur de synchronisation (pour ses tests) et par les
// tests Node. Règles :
//
//  1. La version la plus récente d'un enregistrement gagne (champ `updatedAt`).
//  2. Une suppression est mémorisée dans `data.tombstones` : elle voyage donc
//     vers l'autre appareil et ne « ressuscite » jamais une fiche effacée.
//  3. Deux enregistrements créés en même temps sur les deux appareils avec le
//     même identifiant (par exemple la facture 1004) ne s'écrasent pas : le plus
//     ancien garde son numéro, le plus récent reçoit un nouveau numéro libre.
//  4. À égalité parfaite, un départage textuel stable garantit que les deux
//     appareils arrivent exactement au même résultat.

export const COLLECTIONS = ['clients', 'invoices', 'appointments', 'expenses', 'reminders'];
export const STAMPED = ['company', 'settings', 'notes'];
export const TOMBSTONE_TTL = 180 * 24 * 60 * 60 * 1000;
export const TOMBSTONE_LIMIT = 2000;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const toNumber = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Identifiant comparable (les identifiants peuvent être numériques ou textuels). */
export const recordId = item => {
  const value = item?.id;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
};

/** Horodatage de la dernière modification d'un enregistrement. */
export const versionOf = item => (isObject(item) ? toNumber(item.updatedAt) : 0);

export const stampOf = value => (toNumber(value) > 0 ? toNumber(value) : 0);

export const keyOf = (collection, id) => collection + '|' + id;

/** JSON avec clés triées : sert de départage déterministe et de comparaison. */
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (isObject(value)) {
    return '{' + Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => JSON.stringify(key) + ':' + stableStringify(value[key]))
      .join(',') + '}';
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

/**
 * Empreinte légère d'un jeu de données. Utilisée pour détecter un vrai
 * changement local sans re-sérialiser tout le stockage à chaque rendu.
 */
export function fingerprint(data) {
  let hash = 5381;
  const text = stableStringify(data ?? {});
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return text.length + ':' + (hash >>> 0).toString(36);
}

/** Copie normalisée : collections en tableaux, champs attendus présents. */
export function normalize(raw) {
  const source = isObject(raw) ? raw : {};
  const out = { ...source };
  for (const collection of COLLECTIONS) {
    out[collection] = Array.isArray(source[collection]) ? source[collection].filter(isObject) : [];
  }
  out.company = isObject(source.company) ? { ...source.company } : {};
  out.settings = isObject(source.settings) ? { ...source.settings } : {};
  out.notes = typeof source.notes === 'string' ? source.notes : '';
  out.meta = isObject(source.meta) ? { ...source.meta } : {};
  out.tombstones = {};
  if (isObject(source.tombstones)) {
    for (const [key, stamp] of Object.entries(source.tombstones)) {
      if (stampOf(stamp) > 0) out.tombstones[key] = stampOf(stamp);
    }
  }
  return out;
}

const idSet = data => {
  const sets = {};
  for (const collection of COLLECTIONS) sets[collection] = new Set(data[collection].map(recordId));
  return sets;
};

/**
 * Identifiants présents localement mais absents de la dernière copie commune :
 * ce sont les enregistrements créés depuis la dernière synchronisation.
 */
export function createdSince(base, data) {
  const current = idSet(normalize(data));
  const known = base ? idSet(normalize(base)) : null;
  const created = {};
  for (const collection of COLLECTIONS) {
    created[collection] = known
      ? [...current[collection]].filter(id => !known[collection].has(id))
      : [];
  }
  return created;
}

const sortIds = ids => [...ids].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));

function maxNumericId(collection, ...datasets) {
  let max = 1000;
  for (const data of datasets) {
    for (const item of data?.[collection] || []) {
      const numeric = Number(recordId(item));
      if (Number.isFinite(numeric) && numeric > max) max = numeric;
    }
  }
  return max;
}

function withoutId(data, collection, id) {
  return { ...data, [collection]: data[collection].filter(item => recordId(item) !== id) };
}

/**
 * Deux appareils ont créé, chacun de leur côté, un enregistrement avec le même
 * identifiant. Le plus ancien garde son numéro ; le plus récent est déplacé vers
 * un identifiant libre. La décision ne dépend pas de l'ordre des arguments, donc
 * les deux appareils convergent vers le même résultat.
 */
function resolveIdCollisions(local, remote, localCreated, remoteCreated) {
  const used = {};
  for (const collection of COLLECTIONS) {
    used[collection] = [
      ...local[collection].map(recordId),
      ...remote[collection].map(recordId)
    ];
  }
  const renumbered = [];

  for (const collection of COLLECTIONS) {
    const localSet = new Set((localCreated[collection] || []).map(String));
    const remoteSet = new Set((remoteCreated[collection] || []).map(String));
    const shared = sortIds([...localSet].filter(id => remoteSet.has(id)));
    for (const id of shared) {
      const left = local[collection].find(item => recordId(item) === id);
      const right = remote[collection].find(item => recordId(item) === id);
      if (!left || !right) continue;
      if (stableStringify(left) === stableStringify(right)) continue;

      const lv = versionOf(left), rv = versionOf(right);
      const keepLocal = lv !== rv ? lv < rv : stableStringify(left) <= stableStringify(right);
      const loserSide = keepLocal ? 'remote' : 'local';
      let nextId = maxNumericId(collection, local, remote) + 1;
      while (used[collection].includes(String(nextId))) nextId += 1;
      used[collection].push(String(nextId));
      renumbered.push({ collection, from: id, to: String(nextId), side: loserSide });
      const target = loserSide === 'local' ? local : remote;
      const moved = { ...(loserSide === 'local' ? left : right), id: Number.isFinite(Number(id)) ? nextId : String(nextId) };
      const updated = { ...target, [collection]: target[collection].map(item => (recordId(item) === id ? moved : item)) };
      if (loserSide === 'local') local = updated; else remote = updated;
    }
  }

  // Les rendez-vous pointent vers une facture : suivre la facture déplacée.
  for (const move of renumbered) {
    if (move.collection !== 'invoices') continue;
    const target = move.side === 'local' ? local : remote;
    const other = move.side === 'local' ? remote : local;
    const otherIds = new Set(other.appointments.map(recordId));
    const nextId = Number.isFinite(Number(move.to)) ? Number(move.to) : move.to;
    const appointments = target.appointments.map(item => {
      if (recordId(item).length && otherIds.has(recordId(item))) return item;
      return String(item.invoiceId) === String(move.from) ? { ...item, invoiceId: nextId } : item;
    });
    if (move.side === 'local') local = { ...local, appointments };
    else remote = { ...remote, appointments };
  }

  return { local, remote, renumbered };
}

function mergeRecord(collection, left, right) {
  const lv = versionOf(left), rv = versionOf(right);
  if (lv !== rv) return lv > rv ? left : right;
  if (collection === 'clients') {
    const score = client => (client.price !== undefined && client.price !== '' ? 4 : 0)
      + (client.service ? 2 : 0)
      + (client.startDate ? 1 : 0);
    const ls = score(left), rs = score(right);
    if (ls !== rs) return ls > rs ? left : right;
  }
  return stableStringify(left) >= stableStringify(right) ? left : right;
}

// Ordre canonique par collection : les deux appareils affichent donc les
// listes dans le même ordre après une synchronisation. Factures et dépenses
// du plus récent au plus ancien (comme la saisie), le reste par ancienneté.
const DESCENDING = new Set(['invoices', 'expenses']);

export function sortRecords(collection, items) {
  const direction = DESCENDING.has(collection) ? -1 : 1;
  return [...items].sort((a, b) => {
    const left = recordId(a);
    const right = recordId(b);
    const numeric = Number(left) - Number(right);
    const order = Number.isFinite(numeric) && numeric !== 0
      ? numeric
      : left.localeCompare(right, 'en', { numeric: true });
    return order * direction;
  });
}

function mergeCollection(collection, local, remote, tombstones) {
  const localMap = new Map(local[collection].map(item => [recordId(item), item]));
  const remoteMap = new Map(remote[collection].map(item => [recordId(item), item]));
  const ids = sortIds(new Set([...localMap.keys(), ...remoteMap.keys()]));
  const out = [];
  const deleted = {};

  for (const id of ids) {
    const left = localMap.get(id);
    const right = remoteMap.get(id);
    const key = keyOf(collection, id);
    const localRemoval = stampOf(tombstones[key]);
    const remoteRemoval = stampOf(remote.tombstones[key]);

    if (!left) {
      // Absent ici : notre suppression est-elle plus récente que la fiche ?
      if (localRemoval && localRemoval >= Math.max(versionOf(right), remoteRemoval)) continue;
      out.push(right);
      continue;
    }
    if (!right) {
      if (remoteRemoval && remoteRemoval >= Math.max(versionOf(left), localRemoval)) {
        deleted[key] = remoteRemoval;
        continue;
      }
      out.push(left);
      continue;
    }
    out.push(mergeRecord(collection, left, right));
  }

  return { items: out, deleted };
}

/**
 * Fusionne deux copies des données et renvoie une nouvelle copie.
 * `localCreated` / `remoteCreated` proviennent de `createdSince(base, …)` et
 * servent uniquement à détecter deux créations simultanées avec le même id.
 */
export function mergeData(localRaw, remoteRaw, options = {}) {
  const now = Number(options.now) || Date.now();
  const localCreated = options.localCreated || {};
  const remoteCreated = options.remoteCreated || {};
  const resolved = resolveIdCollisions(normalize(localRaw), normalize(remoteRaw), localCreated, remoteCreated);
  const local = resolved.local;
  const remote = resolved.remote;

  const merged = { ...local };
  merged.tombstones = { ...local.tombstones };

  for (const collection of COLLECTIONS) {
    const { items, deleted } = mergeCollection(collection, local, remote, local.tombstones);
    merged[collection] = sortRecords(collection, items);
    for (const [key, stamp] of Object.entries(deleted)) merged.tombstones[key] = stamp;
    for (const item of items) delete merged.tombstones[keyOf(collection, recordId(item))];
  }

  // Champs uniques : entreprise, réglages, note libre.
  const meta = { ...local.meta };
  for (const field of STAMPED) {
    const lv = stampOf(local.meta?.[field]);
    const rv = stampOf(remote.meta?.[field]);
    let pick;
    if (lv !== rv) pick = lv > rv ? local : remote;
    else pick = stableStringify(local[field] ?? null) >= stableStringify(remote[field] ?? null) ? local : remote;
    merged[field] = pick === local ? local[field] : remote[field];
    meta[field] = Math.max(lv, rv);
  }
  merged.meta = meta;

  // Nettoyage des pierres tombales trop vieilles ou trop nombreuses.
  const entries = Object.entries(merged.tombstones)
    .filter(([, stamp]) => stampOf(stamp) > 0 && stampOf(stamp) > now - TOMBSTONE_TTL)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOMBSTONE_LIMIT);
  merged.tombstones = Object.fromEntries(entries);

  return merged;
}

/**
 * Applique un changement local en horodatant seulement ce qui a bougé :
 *   - nouvel enregistrement ou contenu modifié  -> updatedAt = maintenant
 *   - enregistrement retiré                     -> pierre tombale
 *   - entreprise / réglages / note libre        -> meta[champ] = maintenant
 */
export function stampChanges(previous, next, now = Date.now()) {
  const before = normalize(previous);
  const after = normalize(next);
  const out = { ...after };
  const stamp = Math.max(1, Math.floor(now));
  const tombstones = { ...out.tombstones };
  let touched = false;

  for (const collection of COLLECTIONS) {
    const previousMap = new Map(before[collection].map(item => [recordId(item), item]));
    const items = after[collection].map(item => {
      const id = recordId(item);
      const old = previousMap.get(id);
      if (old && stableStringify(old) === stableStringify(item)) return item;
      touched = true;
      delete tombstones[keyOf(collection, id)];
      return { ...item, updatedAt: Math.max(stamp, versionOf(old) + 1) };
    });
    const kept = new Set(items.map(recordId));
    for (const id of previousMap.keys()) {
      if (kept.has(id)) continue;
      touched = true;
      tombstones[keyOf(collection, id)] = stamp;
    }
    out[collection] = items;
  }

  const meta = { ...out.meta };
  for (const field of STAMPED) {
    if (stableStringify(before[field] ?? null) === stableStringify(after[field] ?? null)) continue;
    touched = true;
    meta[field] = Math.max(stamp, stampOf(before.meta?.[field]) + 1);
  }
  out.meta = meta;
  out.tombstones = tombstones;
  return touched ? out : previous;
}
