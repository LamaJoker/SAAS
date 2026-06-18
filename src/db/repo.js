/**
 * repo.js — Façade d'accès aux données ASYNCHRONE (étape 1 de la migration PG).
 *
 * Toutes les méthodes renvoient une Promise. En SQLite (better-sqlite3,
 * synchrone) elles résolvent immédiatement ; le jour du passage à PostgreSQL,
 * seules ces implémentations changeront — les appelants sont DÉJÀ en `await`.
 *
 * Règle : hors transaction, utilisez `await repo.<entité>.<méthode>()`.
 * Dans une transaction (`db.transaction(...)`, synchrone en SQLite), continuez
 * d'utiliser les modèles SYNC directement (cf. docs/scaling.md, transactions =
 * étape 3 avec pgTransaction).
 */
import { getDb } from './database.js';
import { User }  from './models/User.js';
import { Lead }  from './models/Lead.js';
import { Site }  from './models/Site.js';
import { Event, EVENT_TYPES } from './models/Event.js';

// Enveloppe chaque méthode d'un modèle en version asynchrone, en préservant
// `this` (les modèles s'appellent entre eux : User.create → this.findById).
function asyncFacade(model) {
  const out = {};
  for (const key of Object.keys(model)) {
    if (typeof model[key] === 'function') {
      out[key] = async (...args) => model[key].apply(model, args);
    }
  }
  return out;
}

export const repo = {
  users:  asyncFacade(User),
  leads:  asyncFacade(Lead),
  sites:  asyncFacade(Site),
  events: asyncFacade(Event),

  /**
   * Transaction asynchrone. En SQLite, exécute `fn` (SYNCHRONE) dans une
   * transaction better-sqlite3 ; `fn` doit utiliser les modèles sync.
   */
  async transaction(fn) {
    return getDb().transaction(fn)();
  },
};

export { EVENT_TYPES };
