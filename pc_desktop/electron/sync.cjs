// Démarrage du serveur de synchronisation à l'intérieur de l'application PC.
// Le serveur écoute sur le réseau local (port 8765 par défaut) : le téléphone
// s'y connecte, et il sert aussi l'application web pour l'installer sur le
// téléphone depuis le navigateur (http://adresse-du-pc:8765).

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server = null;
let starting = null;

const port = () => {
  const value = Number(process.env.MM_SYNC_PORT || 8765);
  return Number.isInteger(value) && value > 1024 && value < 65536 ? value : 8765;
};

/**
 * Le moteur partagé vit à deux endroits selon le contexte :
 *   - dépôt de développement : ../shared/server/server.js
 *   - application empaquetée : resources/shared/server/server.js (voir package.json)
 */
function sharedServerPath() {
  const candidates = [
    path.join(__dirname, '..', 'shared', 'server', 'server.js'),
    path.join(process.resourcesPath || '', 'shared', 'server', 'server.js'),
    path.join(__dirname, '..', '..', 'shared', 'server', 'server.js')
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

function start() {
  if (starting) return starting;
  starting = (async () => {
    const file = sharedServerPath();
    if (!file) {
      console.error('[sync] Moteur de synchronisation introuvable (dossier shared/).');
      server = null;
      return { running: false, port: port(), addresses: [], message: 'Moteur de synchronisation introuvable dans cette installation.' };
    }
    try {
      const { startSyncServer } = await import(pathToFileURL(file).href);
      server = await startSyncServer({
        port: port(),
        host: '0.0.0.0',
        staticDir: path.join(__dirname, '..', 'dist'),
        // L'application empaquetée garde ses dépendances (ws) dans app.asar.
        resolveFrom: process.resourcesPath ? path.join(process.resourcesPath, 'app.asar') : '',
        log: line => console.log(`[sync] ${line}`)
      });
      console.log(`[sync] Serveur prêt sur le port ${server.port} — adresses : ${server.addresses().join(', ') || 'localhost'}`);
      return info();
    } catch (error) {
      const message = error.code === 'EADDRINUSE'
        ? `Le port ${port()} est déjà utilisé : un autre serveur de synchronisation est probablement déjà lancé.`
        : `Synchronisation indisponible : ${error.message}`;
      console.error('[sync]', message);
      server = null;
      return { running: false, port: port(), addresses: [], message };
    }
  })();
  return starting;
}

function info() {
  return {
    running: Boolean(server),
    port: server?.port || port(),
    addresses: server ? server.addresses() : [],
    dataDir: server?.dataDir || ''
  };
}

async function stop() {
  if (!server) return;
  const current = server;
  server = null;
  starting = null;
  try { await current.close(); } catch { /* déjà arrêté */ }
}

module.exports = { start, stop, info, port, sharedServerPath };
