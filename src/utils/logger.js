import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const LEVELS  = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LVL = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

// Persistance fichier : une erreur survenue la nuit ne disparaît plus au redémarrage.
// LOG_TO_FILE=false pour désactiver (ex: conteneur où stdout suffit).
const FILE_ENABLED = (process.env.LOG_TO_FILE ?? 'true') !== 'false';
const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LOG_DIR  = join(ROOT, 'logs');
const LOG_FILE = join(LOG_DIR, 'app.log');
const MAX_SIZE = 5 * 1024 * 1024; // 5 Mo puis rotation → app.log.1

let dirReady    = false;
let writeCount  = 0;

function rotateIfNeeded() {
  try {
    if (statSync(LOG_FILE).size < MAX_SIZE) return;
    const archived = LOG_FILE + '.1';
    if (existsSync(archived)) renameSync(archived, LOG_FILE + '.2');
    renameSync(LOG_FILE, archived);
  } catch {}
}

function writeToFile(line) {
  try {
    if (!dirReady) {
      mkdirSync(LOG_DIR, { recursive: true });
      dirReady = true;
    }
    if (writeCount++ % 200 === 0) rotateIfNeeded();
    appendFileSync(LOG_FILE, line + '\n');
  } catch {} // le logging ne doit jamais faire tomber l'app
}

function format(level, message, meta) {
  const ts   = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${message}`;
  return meta && Object.keys(meta).length ? `${base} ${JSON.stringify(meta)}` : base;
}

function write(level, message, meta = {}) {
  if (LEVELS[level] < MIN_LVL) return;
  const line = format(level, message, meta);
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  if (FILE_ENABLED) writeToFile(line);
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info:  (msg, meta) => write('info',  msg, meta),
  warn:  (msg, meta) => write('warn',  msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
