const LEVELS  = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LVL = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

function format(level, message, meta) {
  const ts   = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${message}`;
  return meta && Object.keys(meta).length ? `${base} ${JSON.stringify(meta)}` : base;
}

function write(level, message, meta = {}) {
  if (LEVELS[level] < MIN_LVL) return;
  const line = format(level, message, meta);
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info:  (msg, meta) => write('info',  msg, meta),
  warn:  (msg, meta) => write('warn',  msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
