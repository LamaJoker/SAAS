/**
 * apiClient.js — Client HTTP authentifié, partagé par tous les scripts CLI.
 *
 * Pourquoi ce fichier existe
 * ──────────────────────────
 * Les scripts s'authentifiaient avec `x-user-id: <ID>`. Cet en-tête n'est plus
 * lu nulle part depuis la migration vers JWT : `authenticate()` n'accepte que
 * le cookie HttpOnly `authToken` ou `Authorization: Bearer`. Tous les appels
 * des scripts renvoyaient donc 401, silencieusement interprétés comme des
 * erreurs métier ("aucun lead", "génération échouée").
 *
 * Un client programmatique s'authentifie comme prévu par l'API : login avec
 * `x-auth-mode: token`, qui est la seule façon d'obtenir le JWT en clair.
 *
 * Configuration (.env, à la racine du projet) :
 *   BASE_URL         URL de l'API            (défaut http://localhost:3000)
 *   SCRIPT_EMAIL     compte utilisé par les scripts
 *   SCRIPT_PASSWORD  mot de passe de ce compte
 *
 * Le compte doit avoir son email vérifié : /generate et /scrape sont derrière
 * requireVerified.
 */
import 'dotenv/config';

/**
 * Ouvre une session et renvoie un client prêt à l'emploi.
 *
 * @param {{baseUrl?: string, email?: string, password?: string}} [opts]
 * @returns {Promise<{userId: string, baseUrl: string, apiFetch: Function}>}
 */
export async function createApiClient(opts = {}) {
  const baseUrl  = opts.baseUrl  ?? process.env.BASE_URL ?? 'http://localhost:3000';
  const email    = opts.email    ?? process.env.SCRIPT_EMAIL;
  const password = opts.password ?? process.env.SCRIPT_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'SCRIPT_EMAIL et SCRIPT_PASSWORD sont requis (dans .env ou en variables ' +
      'd\'environnement). Ce sont les identifiants du compte au nom duquel les ' +
      'scripts agissent.'
    );
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-mode': 'token',   // seul mode qui renvoie le JWT dans le corps
      },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    throw new Error(`API injoignable sur ${baseUrl} : ${err.message}`);
  }

  const payload = await readJson(res, '/users/login');
  if (!res.ok) {
    throw new Error(`Login refusé (${res.status}) : ${payload.error ?? 'raison inconnue'}`);
  }

  const token  = payload.data?.token;
  const userId = payload.data?.user?.id;
  if (!token) {
    throw new Error(
      'L\'API n\'a pas renvoyé de token. Vérifiez que /users/login honore bien ' +
      'l\'en-tête x-auth-mode: token sur cette version du serveur.'
    );
  }

  /**
   * Appel authentifié. Renvoie directement `data` ; lève une Error explicite
   * sur statut >= 400 ou réponse illisible.
   *
   * @param {string} path   chemin API, ex. '/leads'
   * @param {RequestInit} [options]
   */
  async function apiFetch(path, options = {}) {
    const r = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
    const body = await readJson(r, path);
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status} sur ${path}`);
    return body.data;
  }

  return { userId, baseUrl, apiFetch };
}

/** Parse une réponse en JSON en donnant un message utile quand ce n'en est pas. */
async function readJson(res, path) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Réponse non-JSON de ${path} (HTTP ${res.status}) : ${text.slice(0, 150)}`);
  }
}
