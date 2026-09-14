/**
 * eslint.config.js — Flat config (ESLint 9).
 *
 * Objectif minimal et non négociable : qu'un fichier qui ne se PARSE pas ne
 * puisse plus survivre dans le dépôt. `scripts/generateBulk.js` contenait un
 * `await` dans un exécuteur de Promise non-async — SyntaxError au chargement,
 * jamais détectée parce que rien ne lit les scripts avant leur exécution.
 *
 * Volontairement peu bavard : on veut des erreurs qui signalent de vrais bugs,
 * pas un mur de warnings de style. Le formatage n'est pas géré ici.
 */
import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'output/**',
      'logs/**',
      'docs/**',
      'frontend/vendor/**',
    ],
  },

  js.configs.recommended,

  // ─── Code serveur (Node, ESM) ─────────────────────────────────────────────
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      // Le code mort coûte une relecture à chaque audit.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // `const { password_hash, ...safe } = user` : omission volontaire.
        ignoreRestSiblings: true,
        caughtErrors: 'none',       // `catch {}` volontaires déjà présents
      }],
      'no-undef': 'error',
      // `catch {}` volontaires : nettoyage best-effort, échec sans conséquence.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',          // les scripts CLI parlent par console
      'no-await-in-loop': 'off',    // séquencement volontaire (envois email)
      // Signale surtout des faux positifs (singletons paresseux, req.* dans un
      // middleware Express). Gardé en warn : le vrai cas — le verrou global de
      // scrape.js — est traité dans le sprint 2.
      'require-atomic-updates': 'warn',
      'no-return-await': 'error',
      'eqeqeq': ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // ─── Scraper : le code passé à page.evaluate() s'exécute dans le navigateur ──
  {
    files: ['src/scrapers/**/*.js'],
    languageOptions: {
      globals: { document: 'readonly', window: 'readonly' },
    },
  },

  // ─── Tests (Vitest) ───────────────────────────────────────────────────────
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ─── Frontend (navigateur, vanilla) ───────────────────────────────────────
  {
    files: ['frontend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        navigator: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Intl: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
