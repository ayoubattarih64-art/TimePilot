import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // `webextensions` supplies the `chrome` global to both UI and worker code.
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    // The service worker runs in a worker scope, not a document.
    files: ['src/background/**/*.ts'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.webextensions },
    },
  },
  {
    // Node-side build tooling.
    files: ['scripts/**/*.mjs', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
