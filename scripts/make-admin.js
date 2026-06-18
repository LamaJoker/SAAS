#!/usr/bin/env node
// Usage: node scripts/make-admin.js email@exemple.com
import { getDb, runMigrations } from '../src/db/database.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/make-admin.js <email>');
  process.exit(1);
}

runMigrations();
const db = getDb();
const result = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);

if (result.changes === 0) {
  console.error(`❌ Utilisateur introuvable : ${email}`);
  console.error('   → Inscrivez-vous d\'abord sur /login, puis relancez ce script.');
  process.exit(1);
}
console.log(`✅ ${email} est maintenant administrateur.`);
process.exit(0);
