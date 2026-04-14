/**
 * Queue.js — File d'attente persistée en SQLite
 * Prête à migrer vers BullMQ : l'interface publique est identique.
 *
 * Interface publique :
 *   queue.add(jobType, data, opts?)  → job
 *   queue.process(jobType, handler)
 *   queue.getStats()
 *   queue.retry(jobId)
 *   queue.close()
 */

import { getDb } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/utils.js';

const DEFAULT_OPTS = {
  maxRetries:   3,
  retryDelay:   5000,   // ms before first retry
  retryBackoff: 2,      // exponential multiplier
  pollInterval: 1000,   // ms between polls
  concurrency:  1,
};

export class Queue {
  #type;
  #opts;
  #handler = null;
  #running = false;
  #active  = 0;
  #timerId = null;

  constructor(type, opts = {}) {
    this.#type = type;
    this.#opts = { ...DEFAULT_OPTS, ...opts };
    this.#ensureSchema();
  }

  // ── Schema ──────────────────────────────────────────────────────────────────

  #ensureSchema() {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        data         TEXT NOT NULL,
        result       TEXT,
        error        TEXT,
        attempts     INTEGER NOT NULL DEFAULT 0,
        max_retries  INTEGER NOT NULL DEFAULT 3,
        retry_delay  INTEGER NOT NULL DEFAULT 5000,
        retry_at     TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        started_at   TEXT,
        finished_at  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_type_status
        ON jobs(type, status);

      CREATE INDEX IF NOT EXISTS idx_jobs_retry_at
        ON jobs(retry_at) WHERE status = 'retrying';
    `);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Enqueue a new job.
   * @param {string} type
   * @param {object} data
   * @param {{ maxRetries?, retryDelay?, id? }} opts
   */
  add(data, opts = {}) {
    const id = opts.id ?? crypto.randomUUID();
    const maxRetries = opts.maxRetries ?? this.#opts.maxRetries;
    const retryDelay = opts.retryDelay ?? this.#opts.retryDelay;

    getDb().prepare(`
      INSERT INTO jobs (id, type, status, data, max_retries, retry_delay)
      VALUES (?, ?, 'pending', ?, ?, ?)
    `).run(id, this.#type, JSON.stringify(data), maxRetries, retryDelay);

    logger.debug(`[Queue:${this.#type}] Job enqueued`, { id });
    return { id, type: this.#type, status: 'pending', data };
  }

  /**
   * Register a handler and start consuming.
   * @param {(job: object) => Promise<any>} handler
   */
  process(handler) {
    if (this.#handler) throw new Error(`Queue ${this.#type} already has a handler`);
    this.#handler  = handler;
    this.#running  = true;
    this.#timerId  = setInterval(() => this.#tick(), this.#opts.pollInterval);
    this.#timerId.unref?.(); // don't keep process alive
    logger.info(`[Queue:${this.#type}] Worker started`, { concurrency: this.#opts.concurrency });
  }

  /** Stop consuming (graceful: waits for active jobs). */
  async close() {
    this.#running = false;
    clearInterval(this.#timerId);
    // wait up to 30s for in-flight jobs
    const deadline = Date.now() + 30_000;
    while (this.#active > 0 && Date.now() < deadline) {
      await sleep(200);
    }
    logger.info(`[Queue:${this.#type}] Worker stopped`);
  }

  getStats() {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        SUM(status = 'pending')    AS pending,
        SUM(status = 'processing') AS processing,
        SUM(status = 'done')       AS done,
        SUM(status = 'error')      AS error,
        SUM(status = 'retrying')   AS retrying
      FROM jobs WHERE type = ?
    `).get(this.#type);
    return row;
  }

  getJob(id) {
    return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  }

  listJobs(status, limit = 50) {
    return getDb()
      .prepare('SELECT * FROM jobs WHERE type = ? AND status = ? ORDER BY created_at DESC LIMIT ?')
      .all(this.#type, status, limit);
  }

  /** Manually re-queue a failed job. */
  retry(jobId) {
    const result = getDb().prepare(`
      UPDATE jobs
      SET status = 'pending', attempts = 0, error = NULL, retry_at = NULL
      WHERE id = ? AND type = ? AND status = 'error'
    `).run(jobId, this.#type);
    return result.changes > 0;
  }

  // ── Internal loop ────────────────────────────────────────────────────────────

  async #tick() {
    if (!this.#running || !this.#handler) return;
    if (this.#active >= this.#opts.concurrency) return;

    const slots = this.#opts.concurrency - this.#active;
    const jobs  = this.#nextBatch(slots);

    for (const job of jobs) {
      this.#active++;
      this.#run(job).finally(() => this.#active--);
    }
  }

  #nextBatch(limit) {
    return getDb().prepare(`
      UPDATE jobs
      SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
        WHERE type = ? AND (
          (status = 'pending') OR
          (status = 'retrying' AND retry_at <= datetime('now'))
        )
        ORDER BY created_at ASC
        LIMIT ?
      )
      RETURNING *
    `).all(this.#type, limit);
  }

  async #run(job) {
    const data = JSON.parse(job.data);
    logger.info(`[Queue:${this.#type}] Job started`, { id: job.id, attempt: job.attempts });

    try {
      const result = await this.#handler({ ...job, data });

      getDb().prepare(`
        UPDATE jobs
        SET status = 'done', result = ?, finished_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(result ?? null), job.id);

      logger.info(`[Queue:${this.#type}] Job done`, { id: job.id });

    } catch (err) {
      await this.#handleFailure(job, err);
    }
  }

  async #handleFailure(job, err) {
    const canRetry = job.attempts < job.max_retries;
    const delay    = job.retry_delay * Math.pow(this.#opts.retryBackoff, job.attempts - 1);
    const retryAt  = canRetry
      ? new Date(Date.now() + delay).toISOString().replace('T', ' ').slice(0, 19)
      : null;

    logger.warn(`[Queue:${this.#type}] Job ${canRetry ? 'will retry' : 'failed'}`, {
      id:      job.id,
      attempt: job.attempts,
      max:     job.max_retries,
      error:   err.message,
      retryAt,
    });

    getDb().prepare(`
      UPDATE jobs
      SET status   = ?,
          error    = ?,
          retry_at = ?,
          finished_at = datetime('now')
      WHERE id = ?
    `).run(
      canRetry ? 'retrying' : 'error',
      err.message,
      retryAt,
      job.id,
    );
  }
}
