import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pose l'env de test (DB temp, mock IA…) avant le chargement des modules.
    // Inoffensif pour les tests unitaires, requis pour les tests d'intégration.
    setupFiles: ['./tests/setup.integration.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/services/**/*.js', 'src/db/**/*.js', 'src/utils/**/*.js'],
      exclude: ['**/*.test.js'],
      // Seuils ciblés sur ce qui peut coûter de l'argent (facturation, crédits,
      // génération). Un chiffre global serait dilué par les routes et les scripts.
      thresholds: { lines: 60, functions: 55, statements: 60, branches: 45 },
    },
  },
});
