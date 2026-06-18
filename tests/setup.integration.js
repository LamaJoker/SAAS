/**
 * Setup des tests d'intégration : pose l'environnement AVANT que config.js
 * ne soit importé (les imports sont hoistés, mais setupFiles s'exécute avant
 * le chargement du module de test). DB et sorties isolées dans un dossier temp.
 */
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const stamp = `${process.pid}-${Date.now()}`;
const base  = join(tmpdir(), `autodemo-test-${stamp}`);

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-secret-0123456789-0123456789-0123456789';
process.env.DB_PATH        = join(base, 'saas.db');
process.env.OUTPUT_DIR     = join(base, 'output');
process.env.AI_MOCK_MODE   = 'true';     // génération déterministe, sans réseau
process.env.LOG_TO_FILE    = 'false';
process.env.LOG_LEVEL      = 'error';
process.env.INBOUND_ENABLED = 'true';    // pour tester le webhook /inbound
process.env.INBOUND_SECRET  = 'test-inbound-secret';

// Nettoyage du dossier temp en fin de process
process.on('exit', () => { try { rmSync(base, { recursive: true, force: true }); } catch {} });
