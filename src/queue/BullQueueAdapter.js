/**
 * BullQueueAdapter.js — Adaptateur BullMQ/Redis du port Queue (jobs distribués).
 *
 * Active via QUEUE_DRIVER=bullmq (+ REDIS_URL, npm i bullmq ioredis). Permet à
 * plusieurs instances/process de partager la même file (vrai multi-instance).
 *
 * bullmq/ioredis sont chargés paresseusement : aucune dépendance imposée tant
 * que le driver SQLite est utilisé. L'init est différée (les imports sont async,
 * la factory est sync) → toutes les méthodes attendent `#ready`.
 *
 * ⚠️ Dormant par défaut. À vérifier contre un vrai Redis en staging avant prod.
 */
import { logger } from '../utils/logger.js';

const STATE_MAP = { // BullMQ → vocabulaire du port
  wait: 'pending', delayed: 'retrying', active: 'processing',
  completed: 'done', failed: 'error',
};

export class BullQueueAdapter {
  #type; #opts; #ready; #Queue; #Worker; #queue; #worker = null;

  constructor(type, opts = {}) {
    this.#type = type;
    this.#opts = opts;
    this.#ready = this.#init();
  }

  async #init() {
    const { Queue, Worker } = await import('bullmq');
    const { default: IORedis } = await import('ioredis');
    const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
    this.#Queue = Queue; this.#Worker = Worker;
    this.#queue = new Queue(this.#type, { connection });
    this.#conn  = connection;
    logger.info(`[BullMQ] Queue "${this.#type}" prête`);
  }
  #conn = null;

  async add(data, opts = {}) {
    await this.#ready;
    // jobId = dédup native BullMQ (rejoue ignoré), retries alignés sur le port
    await this.#queue.add(this.#type, data, {
      jobId:    opts.id,
      attempts: (opts.maxRetries ?? this.#opts.maxRetries ?? 3) + 1,
      backoff:  { type: 'exponential', delay: opts.retryDelay ?? this.#opts.retryDelay ?? 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    return { id: opts.id };
  }

  async process(handler) {
    await this.#ready;
    const concurrency = this.#opts.concurrency ?? 1;
    this.#worker = new this.#Worker(this.#type, async (job) => {
      return handler({ id: job.id, data: job.data, attempts: job.attemptsMade + 1 });
    }, { connection: this.#conn, concurrency });
    this.#worker.on('failed', (job, err) =>
      logger.warn(`[BullMQ:${this.#type}] Job ${job?.id} échoué`, { error: err.message }));
    logger.info(`[BullMQ] Worker "${this.#type}" démarré (concurrency=${concurrency})`);
  }

  async getStats() {
    await this.#ready;
    const c = await this.#queue.getJobCounts('wait', 'delayed', 'active', 'completed', 'failed');
    return {
      pending:    c.wait      ?? 0,
      retrying:   c.delayed   ?? 0,
      processing: c.active    ?? 0,
      done:       c.completed ?? 0,
      error:      c.failed    ?? 0,
    };
  }

  async listJobs(status = 'pending', limit = 20) {
    await this.#ready;
    const bullState = Object.keys(STATE_MAP).find(k => STATE_MAP[k] === status) ?? 'wait';
    const jobs = await this.#queue.getJobs([bullState], 0, limit - 1);
    return jobs.map(j => ({
      id: j.id, type: this.#type, status,
      attempts: j.attemptsMade, error: j.failedReason ?? null,
      created_at: j.timestamp ? new Date(j.timestamp).toISOString() : null,
    }));
  }

  async getJob(id) {
    await this.#ready;
    const j = await this.#queue.getJob(id);
    if (!j) return null;
    return { id: j.id, type: this.#type, data: j.data, attempts: j.attemptsMade, error: j.failedReason ?? null };
  }

  async retry(jobId) {
    await this.#ready;
    const j = await this.#queue.getJob(jobId);
    if (!j) return false;
    await j.retry();
    return true;
  }

  // BullMQ détecte et reprend seul les jobs "stalled" (worker mort) : rien à faire.
  recoverZombies() { return 0; }

  async close() {
    try { await this.#ready; } catch { return; }
    await Promise.all([this.#worker?.close(), this.#queue?.close()]);
    await this.#conn?.quit().catch(() => {});
  }
}
