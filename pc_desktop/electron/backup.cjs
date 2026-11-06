const fs = require('node:fs/promises');
const path = require('node:path');
const winPath = path.win32;
const BACKUP_FOLDER = 'Sauvegardes MM';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 200;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string';
const number = v => Number.isFinite(Number(v));
const date = v => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;

// Même contrat que l’ancienne restauration, avec les vérifications de types
// nécessaires aux écrans actuels. Aucun enregistrement n’est modifié à la lecture.
function isBackup(v) {
  if (!object(v) || !object(v.company) || !object(v.settings)) return false;
  if (!['clients', 'invoices', 'appointments', 'reminders', 'expenses'].every(k => Array.isArray(v[k]))) return false;
  if (v.notes !== undefined && !text(v.notes)) return false;
  if (v.settings.tips !== undefined && typeof v.settings.tips !== 'boolean') return false;
  if (v.settings.taxFrequency !== undefined && !['Mensuelle', 'Trimestrielle', 'Annuelle'].includes(v.settings.taxFrequency)) return false;
  if (!v.clients.every(c => object(c) && c.id && text(c.name) && ['phone', 'email', 'address', 'company', 'type', 'frequency', 'notes'].every(k => c[k] === undefined || text(c[k])) && (c.price === undefined || number(c.price)))) return false;
  if (!v.invoices.every(i => object(i) && number(i.id) && text(i.status) && date(i.date) && date(i.due) && Array.isArray(i.lines) && i.lines.length > 0 && i.lines.every(l => object(l) && text(l.description) && number(l.qty) && Number(l.qty) > 0 && number(l.price) && Number(l.price) >= 0))) return false;
  if (!v.appointments.every(a => object(a) && a.id && date(a.date) && text(a.time) && text(a.service))) return false;
  if (!v.reminders.every(r => object(r) && r.id && text(r.text) && date(r.date) && typeof r.done === 'boolean')) return false;
  if (!v.expenses.every(e => object(e) && e.id && date(e.date) && text(e.vendor) && text(e.category) && number(e.base) && typeof e.eligible === 'boolean')) return false;
  return true;
}

function parseBackup(contents) {
  let value;
  try { value = JSON.parse(contents.replace(/^\uFEFF/, '')); }
  catch { throw fail('INVALID', 'Ce fichier ne contient pas une sauvegarde MM valide.'); }
  if (!isBackup(value)) throw fail('INVALID', 'Ce fichier ne contient pas une sauvegarde MM valide.');
  return value;
}

// Les chemins reçus du renderer ne sont jamais utilisés comme chemins arbitraires.
function backupPath(root, location, name) {
  if (!['root', 'app'].includes(location) || !text(name) || name.length > 180 || !/\.json$/i.test(name) || winPath.basename(name) !== name || /[\\/:*?"<>|\x00-\x1f]/.test(name)) {
    throw fail('INVALID_PATH', 'Nom de sauvegarde non reconnu.');
  }
  const base = location === 'app' ? path.join(root, BACKUP_FOLDER) : root;
  const file = path.resolve(base, name);
  if (path.dirname(file) !== path.resolve(base)) throw fail('INVALID_PATH', 'Emplacement non autorisé.');
  return file;
}

async function regularFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail('INVALID', 'Le fichier de sauvegarde n’est plus disponible.');
  if (stat.size > MAX_BYTES) throw fail('TOO_LARGE', 'Cette sauvegarde dépasse la taille maximale de 25 Mo.');
  return stat;
}

async function listBackups(root) {
  const files = [];
  let ignored = 0;
  for (const location of ['app', 'root']) {
    const directory = location === 'app' ? path.join(root, BACKUP_FOLDER) : root;
    let entries;
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' && location === 'app') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.json$/i.test(entry.name) || entry.name.length > 180) continue;
      if (files.length >= MAX_FILES) break;
      try {
        const file = backupPath(root, location, entry.name);
        const stat = await regularFile(file);
        const value = parseBackup(await fs.readFile(file, 'utf8'));
        files.push({ name: entry.name, location, modifiedAt: stat.mtime.toISOString(), bytes: stat.size, clients: value.clients.length, invoices: value.invoices.length });
      } catch { ignored++; }
    }
  }
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
  return { files, ignored, limited: files.length >= MAX_FILES };
}

async function readBackup(root, location, name) {
  const file = backupPath(root, location, name);
  await regularFile(file);
  return parseBackup(await fs.readFile(file, 'utf8'));
}

function backupName(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `Sauvegarde-MM-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

async function writeBackup(root, value, now = new Date()) {
  if (!isBackup(value)) throw fail('INVALID', 'Les données actuelles ne peuvent pas être sauvegardées.');
  const contents = JSON.stringify(value, null, 2) + '\n';
  const bytes = Buffer.byteLength(contents);
  if (bytes > MAX_BYTES) throw fail('TOO_LARGE', 'La sauvegarde dépasse la taille maximale de 25 Mo.');
  const directory = path.join(root, BACKUP_FOLDER);
  const dirStat = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (dirStat && (!dirStat.isDirectory() || dirStat.isSymbolicLink())) throw fail('INVALID_PATH', 'Le dossier Sauvegardes MM de cette clé n’est pas accessible.');
  await fs.mkdir(directory, { recursive: true });
  const stem = backupName(now).slice(0, -5);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const name = `${stem}${attempt ? '-' + (attempt + 1) : ''}.json`;
    const file = backupPath(root, 'app', name);
    const temporary = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let handle;
    try {
      // Ne jamais écraser une copie existante. Écriture temporaire puis publication
      // atomique dans le dossier de la clé; aucun repli vers le disque interne.
      await fs.access(file);
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      handle = await fs.open(temporary, 'wx');
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      // rename sur Windows peut remplacer la destination : lien matériel exclusif
      // plutôt que rename/copy sans protection contre une copie concurrente.
      await fs.link(temporary, file);
      await fs.unlink(temporary);
      return { name, folder: BACKUP_FOLDER, path: file, bytes };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
      if (error.code === 'EEXIST') continue;
      // FAT32/exFAT ne prennent pas tous en charge les liens matériels. Dans ce cas,
      // écriture directe exclusive, supprimée si elle échoue; pas de faux succès.
      if (['EPERM', 'ENOSYS', 'EOPNOTSUPP', 'ENOTSUP', 'EINVAL'].includes(error.code)) {
        let direct;
        try {
          direct = await fs.open(file, 'wx');
          await direct.writeFile(contents, 'utf8');
          await direct.sync();
          await direct.close();
          direct = null;
          return { name, folder: BACKUP_FOLDER, path: file, bytes };
        } catch (fallbackError) {
          if (direct) await direct.close().catch(() => {});
          if (fallbackError.code === 'EEXIST') continue;
          await fs.unlink(file).catch(() => {});
          throw fallbackError;
        }
      }
      throw error;
    }
  }
  throw fail('WRITE', 'Impossible de créer une nouvelle copie sans remplacer une copie existante.');
}

module.exports = { BACKUP_FOLDER, MAX_BYTES, isBackup, parseBackup, backupPath, listBackups, readBackup, writeBackup, backupName };
