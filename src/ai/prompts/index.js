/**
 * prompts/index.js — Registre des versions de prompt.
 *
 * Pourquoi versionner un prompt
 * ─────────────────────────────
 * Un prompt est du code : il produit un comportement, il régresse, et on a
 * besoin de savoir lequel tournait quand une sortie a posé problème. Tant qu'il
 * vit en dur dans le service, on ne peut ni comparer deux formulations, ni
 * revenir en arrière, ni attribuer une génération ratée à une modification.
 *
 * Chaque version est un module figé. On n'édite JAMAIS une version publiée :
 * on en ajoute une, on la compare avec `npm run eval`, et on bascule
 * `ACTIVE_VERSION` si les scores le justifient. La version utilisée est
 * enregistrée avec chaque appel (table `ai_calls`), donc une sortie est toujours
 * rattachable au prompt qui l'a produite.
 */
import { promptV1 } from './v1.js';
import { promptV2 } from './v2.js';

/** Toutes les versions connues, par identifiant. */
export const PROMPTS = {
  v1: promptV1,
  v2: promptV2,
};

/**
 * Version servie en production. Surchargeable par AI_PROMPT_VERSION, ce qui
 * permet de tester une version sur un environnement sans redéployer le code.
 */
export const ACTIVE_VERSION = process.env.AI_PROMPT_VERSION ?? 'v2';

/**
 * @param {string} [version]
 * @returns {{ id: string, description: string, build: (lead: object, opts?: object) => object[] }}
 */
export function getPrompt(version = ACTIVE_VERSION) {
  const prompt = PROMPTS[version];
  if (!prompt) {
    throw new Error(
      `Version de prompt inconnue: "${version}". Disponibles: ${Object.keys(PROMPTS).join(', ')}`
    );
  }
  return prompt;
}

export const listVersions = () => Object.keys(PROMPTS);
