/**
 * demoUrl.js — Construction de l'URL publique d'une démo.
 *
 * Source de vérité unique : l'URL est figée en base à la création du site, donc
 * une erreur ici se propage dans tous les emails déjà envoyés. Elle est isolée
 * et testée pour cette raison.
 *
 * Deux formes selon la configuration :
 *   sans DEMO_HOST : https://mon-saas.fr/demos/plombier-durand-lyon-a3f2
 *   avec DEMO_HOST : https://demos.mon-saas.fr/plombier-durand-lyon-a3f2
 *
 * La seconde est celle qu'on veut montrer à un prospect : pas de chemin
 * « /demos/ » qui trahit l'outil, et un domaine isolé de celui qui envoie.
 */
import { config } from '../config/config.js';

export function buildDemoUrl(slug, server = config.server) {
  const host = (server.demoHost || '').trim();
  const base = (server.demoBaseUrl || '').trim().replace(/\/+$/, '');

  if (host && base) return `${base}/${slug}`;       // domaine dédié, slug à la racine
  if (base)         return `${base}/demos/${slug}`; // sous-domaine sans réécriture
  return `${String(server.baseUrl).replace(/\/+$/, '')}/demos/${slug}`;
}

/**
 * Le domaine des démos sert-il les slugs à la racine ?
 * Détermine si le middleware de réécriture doit être actif.
 */
export function usesDemoHost(server = config.server) {
  return Boolean((server.demoHost || '').trim() && (server.demoBaseUrl || '').trim());
}
