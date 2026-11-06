import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Le moteur de synchronisation et le panneau de réglages sont partagés avec
// l'application PC (dossier ../shared). Ces alias garantissent qu'ils
// utilisent exactement les mêmes copies de React que l'application.
const here = path.dirname(fileURLToPath(import.meta.url));
const module = name => path.join(here, 'node_modules', name);

export default defineConfig({
  base: './',
  resolve: {
    alias: [
      { find: /^react$/, replacement: module('react') },
      { find: /^react-dom$/, replacement: module('react-dom') },
      { find: /^react-dom\/(.*)$/, replacement: module('react-dom') + '/$1' },
      { find: /^lucide-react$/, replacement: module('lucide-react') }
    ]
  },
  server: { host: '0.0.0.0', allowedHosts: true, fs: { allow: ['..'] } },
  preview: { host: '0.0.0.0', allowedHosts: true }
});
