/**
 * AutoDemo SaaS — Point d'entrée
 */
import { installProcessGuards } from './utils/errorReporter.js';
import { startServer } from './api/index.js';

// Gardes de processus AVANT le démarrage : aucune erreur fatale ne passe sous silence
installProcessGuards();

startServer();
