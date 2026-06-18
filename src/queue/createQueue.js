/**
 * createQueue.js — Factory de queues (port/adaptateur).
 *
 * Tout le code applicatif passe par ici : le jour où SQLite ne suffit plus,
 * la migration vers BullMQ est un adaptateur + une variable d'environnement,
 * pas une réécriture.
 *
 * Déclencheurs de migration vers QUEUE_DRIVER=bullmq (ne pas migrer avant) :
 *   - ≥ 2 instances applicatives sur des machines différentes
 *   - > ~50 jobs/min soutenus
 *   - besoin de jobs répétables / priorités fines / rate-limiting distribué
 *
 * L'adaptateur BullMQ vit dans BullQueueAdapter.js (chargement paresseux de
 * bullmq/ioredis → aucune dépendance imposée en mode SQLite). Les méthodes du
 * port qui interrogent l'état (getStats/listJobs/getJob/retry) sont consommées
 * avec `await` côté appelant pour fonctionner avec les deux drivers.
 */
import { Queue as SqliteQueue } from './Queue.js';
// L'adaptateur n'importe bullmq/ioredis QU'à l'init (dynamic import) : l'importer
// statiquement ici ne charge donc aucune dépendance lourde en mode sqlite.
import { BullQueueAdapter } from './BullQueueAdapter.js';

export function createQueue(type, opts = {}) {
  const driver = process.env.QUEUE_DRIVER ?? 'sqlite';

  if (driver === 'sqlite') return new SqliteQueue(type, opts);
  if (driver === 'bullmq') return new BullQueueAdapter(type, opts);

  throw new Error(`QUEUE_DRIVER inconnu: ${driver} (valeurs: sqlite, bullmq)`);
}
