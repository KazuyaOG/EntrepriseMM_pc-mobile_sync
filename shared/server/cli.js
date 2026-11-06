#!/usr/bin/env node
// Lance le serveur de synchronisation MM en ligne de commande.
//
//   mm-sync                 (port 8765, accessible sur le réseau local)
//   mm-sync --port 9000
//   mm-sync --app ../pc_desktop/dist    (sert aussi l'application web)
//
// Le téléphone ouvre alors http://ADRESSE-IP-DU-PC:8765 pour installer
// l'application ; les deux appareils se synchronisent automatiquement.

import path from 'node:path';
import fs from 'node:fs';
import { startSyncServer, defaultDataDir } from './server.js';

function parseArgs(argv) {
  const options = { port: Number(process.env.MM_SYNC_PORT) || 8765, host: '0.0.0.0', app: '', dataDir: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--port' || arg === '-p') options.port = Number(next());
    else if (arg === '--host') options.host = next();
    else if (arg === '--app' || arg === '--static') options.app = next();
    else if (arg === '--data' || arg === '--data-dir') options.dataDir = next();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('-') && !options.app && fs.existsSync(arg)) options.app = arg;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(`Serveur de synchronisation Gestion MM

Utilisation :
  mm-sync [options]

Options :
  -p, --port <port>      Port d'écoute (défaut : 8765)
      --host <adresse>   Adresse d'écoute (défaut : 0.0.0.0, réseau local)
      --app <dossier>    Sert aussi l'application web compilée (ex. dist)
      --data <dossier>   Dossier de sauvegarde de l'état partagé
  -h, --help             Affiche cette aide

Au démarrage, le serveur affiche les adresses à entrer dans l'application
mobile (Réglages → Synchronisation PC ↔ mobile).`);
  process.exit(0);
}

const log = line => console.log(`[${new Date().toLocaleTimeString('fr-CA')}] ${line}`);

try {
  const server = await startSyncServer({
    port: options.port,
    host: options.host,
    dataDir: options.dataDir || defaultDataDir(),
    staticDir: options.app ? path.resolve(options.app) : '',
    log
  });
  console.log('');
  console.log('  Gestion MM — serveur de synchronisation');
  console.log('  --------------------------------------');
  console.log(`  Port          : ${server.port}`);
  console.log(`  Données       : ${server.dataDir}`);
  if (options.app) console.log(`  Application   : http://localhost:${server.port}`);
  console.log('');
  console.log('  Adresse à entrer dans l’application mobile :');
  for (const address of server.addresses()) console.log(`    ${address}`);
  if (!server.addresses().length) console.log(`    ws://localhost:${server.port}/sync`);
  console.log('');
  console.log('  Laissez cette fenêtre ouverte. Ctrl+C pour arrêter.');
  console.log('');

  const shutdown = async () => {
    console.log('\nArrêt du serveur…');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    console.error(`Le port ${options.port} est déjà utilisé. Fermez l'autre programme ou choisissez un autre port (--port).`);
  } else if (error.code === 'EACCES') {
    console.error(`Accès refusé au port ${options.port}. Essayez un port supérieur à 1024.`);
  } else {
    console.error('Impossible de démarrer le serveur :', error.message);
  }
  process.exit(1);
}
