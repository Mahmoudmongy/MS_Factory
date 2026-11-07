import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';

const root = import.meta.dirname;

// app.js is intentionally a classic script: the existing UI uses global functions
// from inline HTML handlers. Vite warns that classic scripts are not bundled,
// so copy this browser entry into dist explicitly instead of converting it to a
// module and breaking those global handlers.
const copyLegacyAppScript = {
  name: 'copy-legacy-app-script',
  apply: 'build',
  writeBundle() {
    const source = resolve(root, 'js/app.js');
    const destination = resolve(root, 'dist/js/app.js');
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  },
};

export default defineConfig({
  plugins: [copyLegacyAppScript],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        auth: resolve(root, 'auth.html'),
      },
    },
  },
});
