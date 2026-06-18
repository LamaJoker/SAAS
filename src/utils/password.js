import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// Paramètres scrypt recommandés OWASP (N=2^15, r=8, p=1)
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH  = 64;

/**
 * Hash un mot de passe → format "scrypt:salt_hex:hash_hex"
 * Le format préfixé permet une migration future vers un autre algo.
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_OPTS);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Vérifie un mot de passe contre un hash stocké (comparaison à temps constant)
 */
export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [algo, saltHex, hashHex] = stored.split(':');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;

  const salt     = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual   = await scryptAsync(password, salt, expected.length, SCRYPT_OPTS);
  return timingSafeEqual(actual, expected);
}

/**
 * Politique de mot de passe minimale
 */
export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Le mot de passe doit faire au moins 8 caractères';
  }
  if (password.length > 128) {
    return 'Le mot de passe ne peut pas dépasser 128 caractères';
  }
  return null;
}
