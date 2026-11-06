const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { listUsbDrives } = require('./usb.cjs');
const { listBackups, readBackup, writeBackup } = require('./backup.cjs');
const sync = require('./sync.cjs');

let window;
const appUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;

function publicError(error) {
  const known = {
    UNSUPPORTED: 'La détection des clés USB nécessite l’application Windows.',
    DETECTION: 'Impossible de vérifier les clés USB. Réessayez.',
    NO_DRIVE: 'La clé USB a été déconnectée. Insérez-la de nouveau puis réessayez.',
    INVALID: 'Ce fichier ne contient pas une sauvegarde MM valide.',
    INVALID_PATH: 'Ce fichier ne se trouve pas dans un emplacement de sauvegarde autorisé sur la clé.',
    TOO_LARGE: 'Cette sauvegarde dépasse la taille maximale de 25 Mo.',
    ENOENT: 'La clé ou le fichier n’est plus disponible. Insérez la clé puis réessayez.',
    EACCES: 'Accès refusé à la clé USB. Vérifiez qu’elle n’est pas protégée en écriture.',
    EPERM: 'Accès refusé à la clé USB. Vérifiez qu’elle n’est pas protégée en écriture.',
    EROFS: 'Cette clé USB est protégée en écriture.',
    ENOSPC: 'Espace insuffisant sur la clé USB. Libérez de l’espace puis réessayez.',
    EIO: 'Impossible de lire ou d’écrire sur la clé USB. Vérifiez la connexion puis réessayez.'
  };
  return { ok: false, code: error.code || 'USB_IO', message: known[error.code] || 'L’opération USB a échoué. Vérifiez la clé puis réessayez. Aucune sauvegarde n’a été enregistrée ailleurs.' };
}

function handle(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || !frame || frame !== event.sender.mainFrame || frame.url.split('#')[0] !== appUrl) {
        throw Object.assign(new Error('Origine non autorisée.'), { code: 'FORBIDDEN' });
      }
      return { ok: true, ...(await operation(...args)) };
    } catch (error) {
      return publicError(error);
    }
  });
}

async function selectedDrive(id) {
  if (typeof id !== 'string' || id.length > 1000) throw Object.assign(new Error('Clé invalide.'), { code: 'NO_DRIVE' });
  // Revérifier le bus USB et le volume avant chaque lecture/écriture : une lettre
  // de lecteur peut être réattribuée à un disque interne après débranchement.
  const drive = (await listUsbDrives()).find(d => d.id === id);
  if (!drive) throw Object.assign(new Error('Clé déconnectée.'), { code: 'NO_DRIVE' });
  return drive;
}

app.whenReady().then(async () => {
  // Le PC est le serveur : le téléphone s'y connecte sur le réseau local.
  const syncInfo = await sync.start();
  window = new BrowserWindow({
    width: 1400,
    height: 950,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https:|mailto:|sms:|tel:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== appUrl) {
      event.preventDefault();
      if (/^(https:|mailto:|sms:|tel:)/.test(url)) shell.openExternal(url);
    }
  });

  handle('mm-sync:info', async () => syncInfo);
  handle('mm-usb:list', async () => ({ drives: await listUsbDrives() }));
  handle('mm-usb:export', async (id, data) => {
    const drive = await selectedDrive(id);
    return { backup: await writeBackup(drive.root, data), drive };
  });
  handle('mm-usb:list-backups', async id => {
    const drive = await selectedDrive(id);
    return { ...(await listBackups(drive.root)), drive };
  });
  handle('mm-usb:read-backup', async (id, location, name) => {
    const drive = await selectedDrive(id);
    return { data: await readBackup(drive.root, location, name), drive };
  });

  window.loadFile(path.join(__dirname, '../dist/index.html'));
  window.on('closed', () => { window = null; });
});
app.on('before-quit', () => { sync.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
