const { contextBridge, ipcRenderer } = require('electron');

// API limitée aux opérations USB; aucun accès général au système de fichiers.
contextBridge.exposeInMainWorld('mmUSB', Object.freeze({
  list: () => ipcRenderer.invoke('mm-usb:list'),
  exportBackup: (driveId, data) => ipcRenderer.invoke('mm-usb:export', driveId, data),
  listBackups: driveId => ipcRenderer.invoke('mm-usb:list-backups', driveId),
  readBackup: (driveId, location, name) => ipcRenderer.invoke('mm-usb:read-backup', driveId, location, name)
}));

// État du serveur de synchronisation intégré (lecture seule).
contextBridge.exposeInMainWorld('mmDesktop', Object.freeze({
  isDesktop: true,
  syncInfo: () => ipcRenderer.invoke('mm-sync:info')
}));
