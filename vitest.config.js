import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pose l'env de test (DB temp, mock IA…) avant le chargement des modules.
    // Inoffensif pour les tests unitaires, requis pour les tests d'intégration.
    setupFiles: ['./tests/setup.integration.js'],
  },
});
