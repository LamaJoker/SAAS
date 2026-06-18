/**
 * Backup manuel : npm run backup
 */
import { backupDatabase } from '../services/backupService.js';

backupDatabase()
  .then(dest => { console.log(`Backup OK: ${dest}`); process.exit(0); })
  .catch(err => { console.error(`Backup échoué: ${err.message}`); process.exit(1); });
