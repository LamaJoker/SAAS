import { getDb }  from '../db/database.js';
import { logger }  from '../utils/logger.js';
import { randomUUID } from 'crypto';

const DEFAULT_OPTS = {
  maxRetries:   3,
  retryDelay:   5000,
  retryBackoff: 2,
  pollInterval: 1000,
  concurrency:  1,
};

export class Queue {
  #type;
  #opts;
  #handler  = null;
  #running  = false;
  #active   = 0;
  #timerId  = null;

  constructor(type, opts = {}) {
    this.#type = type;
    this.#opts = { ...DEFAULT_OPTS, ...opts };
    this.#ensureSchema();
  }

  #ensureSchema() {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        data        TEXT NOT NULL,
        result      TEXT,
        error       TEXT,
        attempts    INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        retry_delay INTEGER NOT NULL DEFAULT 5000,
        retry_at    TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        started_at  TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);
      CREATE INDEX IF NOT EXISTS idx_jobs_retry       ON jobs(retry_at);
    `);
  }

  add(data, opts = {}) {
    const id       = opts.id ?? randomUUID();
    const db       = getDb();
    const existing = db.prepare('SELECT status FROM jobs WHERE id = ?').get(id);
    if (existing && existing.status !== 'error') return { id, skipped: true };

    db.prepare(`
      INSERT OR REPLACE INTO jobs (id, type, status, data, max_retries, retry_delay)
      VALUES (?, ?, 'pending', ?, ?, ?)
    `).run(id, this.#type, JSON.stringify(data),
      opts.maxRetries ?? this.#opts.maxRetries,
      opts.retryDelay ?? this.#opts.retryDelay
    );
    return { id };
  }

  process(handler) {
    if (this.#handler) throw new Error('Handler déjà défini');
    this.#handler = handler;
    this.#running = true;
    this.#tick();
  }

  #claim(limit) {
    const db   = getDb();
    const jobs = db.prepare(`
      SELECT * FROM jobs
      WHERE type = ?
        AND (status = 'pending' OR (status = 'retrying' AND retry_at <= datetime('now')))
      ORDER BY created_at ASC LIMIT ?
    `).all(this.#type, limit);

    if (!jobs.length) return [];

    const ids = jobs.map(j => j.id);
    db.prepare(`
      UPDATE jobs
      SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1
      WHERE id IN (${ids.map(() => '?').join(',')})
    `).run(...ids);

    return jobs;
  }

  async #tick() {
    if (!this.#running) return;

    const slots = this.#opts.concurrency - this.#active;
    if (slots > 0) {
      const jobs = this.#claim(slots);
      for (const job of jobs) {
        this.#active++;
        this.#run(job).finally(() => {
          this.#active--;
          this.#tick();
        });
      }
    }

    if (this.#timerId) clearTimeout(this.#timerId);
    this.#timerId = setTimeout(() => this.#tick(), this.#opts.pollInterval);
  }

  async #run(job) {
    try {
      const result = await this.#handler({ ...job, data: JSON.parse(job.data) });
      getDb().prepare(
        "UPDATE jobs SET status='done', result=?, finished_at=datetime('now') WHERE id=?"
      ).run(JSON.stringify(result ?? null), job.id);
    } catch (err) {
      const canRetry = job.attempts < job.max_retries;
      const delay    = job.retry_delay * Math.pow(this.#opts.retryBackoff, job.attempts - 1);
      const retryAt  = canRetry
        ? new Date(Date.now() + delay).toISOString().replace('T', ' ').slice(0, 19)
        : null;

      getDb().prepare(
        "UPDATE jobs SET status=?, error=?, retry_at=?, finished_at=datetime('now') WHERE id=?"
      ).run(canRetry ? 'retrying' : 'error', err.message, retryAt, job.id);

      logger.warn(`[Queue:${this.#type}] Job ${job.id} ${canRetry ? 'retry' : 'erreur'}`, {
        error: err.message, attempts: job.attempts,
      });
    }
  }

  getStats() {
    const db  = getDb();
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count FROM jobs WHERE type = ? GROUP BY status
    `).all(this.#type);
    const s = Object.fromEntries(rows.map(r => [r.status, r.count]));
    return {
      pending:    s.pending    ?? 0,
      processing: s.processing ?? 0,
      retrying:   s.retrying   ?? 0,
      done:       s.done       ?? 0,
      error:      s.error      ?? 0,
    };
  }

  listJobs(status = 'pending', limit = 20) {
    return getDb().prepare(
      'SELECT id, type, status, attempts, error, created_at, started_at, finished_at FROM jobs WHERE type = ? AND status = ? ORDER BY created_at DESC LIMIT ?'
    ).all(this.#type, status, limit);
  }

  getJob(id) {
    return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  }

  retry(jobId) {
    const result = getDb().prepare(
      "UPDATE jobs SET status='pending', error=NULL, retry_at=NULL WHERE id=? AND status='error'"
    ).run(jobId);
    return result.changes > 0;
  }

  close() {
    this.#running = false;
    if (this.#timerId) clearTimeout(this.#timerId);
  }
}
