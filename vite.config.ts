import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Extension pages are loaded from chrome-extension://<id>/, so emit
  // relative asset URLs rather than root-absolute ones.
  base: './',
  build: {
    // Extension pages must not emit <link rel="modulepreload">. Chromium
    // attributes the preload and the page's own module fetch to different
    // worlds for chrome-extension:// documents, so the preloaded entry is never
    // reused ("cross-world extension resource mismatch") and each one is a
    // wasted request plus a warning on the extension's errors page. The static
    // `import` statements in the entry chunks still pull these files in, so
    // dropping the hints changes nothing about what loads — only the hinting.
    modulePreload: false,
    // Chrome cannot load an extension whose files sit behind a hashed name it
    // does not know, so the manifest-referenced entries keep stable filenames.
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        blocked: resolve(import.meta.dirname, 'blocked.html'),
        'service-worker': resolve(
          import.meta.dirname,
          'src/background/service-worker.ts',
        ),
      },
      output: {
        // service-worker.js must sit at the root, exactly as the manifest says.
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker'
            ? 'service-worker.js'
            : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
