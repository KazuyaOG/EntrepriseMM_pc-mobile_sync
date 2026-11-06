// Lance toute la suite de tests d'interface avec Playwright.
//
//   1. npm run dev            (dans un autre terminal, port 5173)
//   2. npx playwright install chromium
//   3. npm run test:ui
//
// Chaque fichier .mjs de ce dossier est exécuté l'un après l'autre ; le premier
// échec arrête la suite et le code de sortie le reflète.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(here))
  .filter(name => name.endsWith('.mjs') && name !== 'run-all.mjs' && !name.startsWith('_'))
  .sort();

const url = process.env.MM_TEST_URL || 'http://localhost:5173';
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(String(response.status));
} catch {
  console.error(`Aucune application sur ${url}. Lancez « npm run dev » dans un autre terminal, puis réessayez.`);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  process.stdout.write(`\n▸ ${file}\n`);
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(here, file)], { stdio: 'inherit', env: process.env });
    child.on('exit', resolve);
    child.on('error', () => resolve(1));
  });
  if (code !== 0) failed += 1;
}

console.log(`\n${files.length - failed}/${files.length} fichier(s) de test réussi(s).`);
process.exit(failed ? 1 : 0);
