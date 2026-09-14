/**
 * v2 — Corrige les trois faiblesses de v1 identifiées par les évaluations.
 *
 * 1. INTERDICTION D'INVENTER DES FAITS VÉRIFIABLES.
 *    C'est le changement le plus important, et il n'est pas cosmétique. Le
 *    modèle ne sait rien de l'entreprise : il reçoit un nom, une activité, une
 *    ville. Quand v1 lui demande des témoignages « réalistes », il produit
 *    « 15 ans d'expérience », « certifié RGE », « élu meilleur artisan 2023 ».
 *    Ces pages sont envoyées à de vraies entreprises et publiées sous leur nom :
 *    une affirmation fausse, c'est de la publicité trompeuse, et c'est le
 *    prospect qui en répond. Le contenu doit être vendeur sans être factuel.
 *
 * 2. CONTRAINTES DE LONGUEUR SORTIES DU TEXTE DESCRIPTIF.
 *    En v1, « (max 60 chars) » est noyé dans la description du champ et traité
 *    comme une indication. Ici les limites sont une règle numérotée et répétée,
 *    ce qui les fait respecter nettement plus souvent.
 *
 * 3. NOM ET VILLE IMPOSÉS À L'IDENTIQUE.
 *    Le modèle reformulait « Plomberie Durand » en « Durand Plomberie », ou
 *    omettait la ville du titre — ce qui casse à la fois la reconnaissance par
 *    le prospect et l'ancrage local.
 */
export const promptV2 = {
  id: 'v2',
  description: 'Interdit les faits inventés, durcit les longueurs, impose nom et ville',

  build(lead, { correctionHint = null } = {}) {
    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userPrompt(lead) },
    ];
    if (correctionHint) {
      messages.push({
        role: 'user',
        content: `Ta réponse précédente était invalide (${correctionHint}). `
               + `Renvoie UNIQUEMENT l'objet JSON corrigé, sans aucun texte autour.`,
      });
    }
    return messages;
  },
};

const SYSTEM = [
  'Tu es un copywriter spécialisé dans les sites vitrines de PME locales françaises.',
  'Tu réponds uniquement par un objet JSON valide, sans markdown et sans commentaire.',
  "Tu n'inventes jamais de fait vérifiable sur une entreprise que tu ne connais pas.",
].join(' ');

function userPrompt(lead) {
  return `Rédige le contenu du site vitrine de cette entreprise :
- Nom exact : ${lead.name}
- Activité : ${lead.activity}
- Ville : ${lead.city}

RÈGLES ABSOLUES

1. N'INVENTE AUCUN FAIT VÉRIFIABLE. Tu ne sais rien de cette entreprise au-delà
   des trois lignes ci-dessus. Sont donc interdits :
   - toute ancienneté ou date de création (« depuis 1998 », « 15 ans d'expérience »)
   - tout label, certification, agrément, assurance ou récompense
   - tout chiffre (nombre de clients, note, pourcentage, prix, délai garanti)
   - tout nom de partenaire, marque ou zone d'intervention non fournie
   Écris ce qui est vrai de n'importe quel bon professionnel : le soin, l'écoute,
   la clarté, la proximité. Vendeur sans être factuel.

2. LONGUEURS, à respecter strictement (elles seront vérifiées) :
   - heroTitle : 60 caractères maximum
   - heroSubtitle : 120 caractères maximum
   - cta : 50 caractères maximum

3. Le heroTitle contient le nom « ${lead.name} » à l'identique, sans le reformuler.
   Le heroTitle ou le heroSubtitle mentionne « ${lead.city} ».

4. Les trois témoignages sont nettement différents : angles distincts, longueurs
   variées, aucune phrase recyclée. Ils expriment une impression, jamais un
   résultat chiffré. Auteur = prénom + initiale.

5. Les services sont ceux qu'un ${lead.activity} propose réellement, formulés du
   point de vue du bénéfice pour le client.

6. Français naturel, vouvoiement, aucun anglicisme, aucun texte de remplissage.

Réponds avec cet objet exact :
{
  "heroTitle": "…",
  "heroSubtitle": "…",
  "services": ["…", "…", "…"],
  "benefits": ["…", "…", "…", "…"],
  "testimonials": [
    { "text": "…", "author": "…" },
    { "text": "…", "author": "…" },
    { "text": "…", "author": "…" }
  ],
  "cta": "…"
}`;
}
