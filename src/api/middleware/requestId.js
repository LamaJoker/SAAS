/**
 * requestId.js — Identifiant de corrélation par requête.
 *
 * Sans lui, diagnostiquer un incident signifie chercher à l'aveugle dans
 * plusieurs mégaoctets de logs à partir d'une heure approximative. Avec lui, le
 * client donne l'identifiant affiché dans la réponse d'erreur et un seul grep
 * suffit.
 *
 * L'en-tête entrant X-Request-Id est repris quand il est présent (Caddy ou un
 * reverse proxy peut déjà en poser un), pour que la même trace couvre le proxy
 * et l'application. Il est filtré : une valeur venue du client ne doit pas
 * pouvoir injecter de saut de ligne dans les logs.
 */
import { randomUUID } from 'node:crypto';

const SAFE = /^[A-Za-z0-9._-]{1,64}$/;

export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE.test(incoming) ? incoming : randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
}
