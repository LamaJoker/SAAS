/**
 * v1 — Prompt d'origine, extrait tel quel de aiService.js.
 *
 * Conservé FIGÉ. Il sert de référence : toute version suivante doit démontrer
 * qu'elle fait mieux, mesuré par `npm run eval`. Sans point de comparaison, on
 * ne sait jamais si un prompt « amélioré » l'est réellement.
 *
 * Faiblesses connues, mesurées par les évaluations :
 *   - demande des témoignages « réalistes » sans interdire d'inventer des faits
 *     vérifiables : le modèle produit des ancienneté, certifications et
 *     récompenses qu'aucune donnée ne soutient ;
 *   - les limites de longueur sont indiquées entre parenthèses, donc traitées
 *     comme des suggestions ;
 *   - rien n'impose de reprendre le nom exact de l'entreprise.
 */
export const promptV1 = {
  id: 'v1',
  description: "Prompt d'origine — référence de comparaison",

  build(lead) {
    return [
      {
        role: 'system',
        content: 'Tu es un expert copywriter. Tu réponds uniquement en JSON valide, jamais en markdown.',
      },
      { role: 'user', content: userPrompt(lead) },
    ];
  },
};

function userPrompt(lead) {
  return `Tu es un expert en copywriting pour PME locales françaises.

Génère du contenu marketing percutant pour le site vitrine de cette entreprise :
- Nom : ${lead.name}
- Activité : ${lead.activity}
- Ville : ${lead.city}

Le contenu doit :
- Être orienté conversion locale (attirer des clients de ${lead.city} et environs)
- Utiliser un ton professionnel mais chaleureux
- Mettre en avant la proximité et l'expertise locale
- Créer de la confiance et pousser à l'action

Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans explication :
{
  "heroTitle": "titre accrocheur avec nom entreprise (max 60 chars)",
  "heroSubtitle": "sous-titre convaincant mettant en avant valeur unique (max 120 chars)",
  "services": [
    "service 1 avec bénéfice client concret",
    "service 2 avec bénéfice client concret",
    "service 3 avec bénéfice client concret"
  ],
  "benefits": [
    "avantage différenciateur 1",
    "avantage différenciateur 2",
    "avantage différenciateur 3",
    "avantage différenciateur 4"
  ],
  "testimonials": [
    {
      "text": "témoignage réaliste et spécifique à l'activité",
      "author": "prénom + initiale, rôle ou situation"
    },
    {
      "text": "deuxième témoignage différent",
      "author": "prénom + initiale, rôle ou situation"
    },
    {
      "text": "troisième témoignage avec résultat concret",
      "author": "prénom + initiale, habitant(e) de ${lead.city}"
    }
  ],
  "cta": "appel à l'action percutant (max 50 chars)"
}`;
}
