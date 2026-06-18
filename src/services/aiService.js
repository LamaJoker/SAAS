import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { repairContent } from './aiSchema.js';

/**
 * Données mock réalistes utilisées en mode simulation ou en fallback
 */
const MOCK_TEMPLATE = {
  heroTitle: '{{name}} — Votre expert local à {{city}}',
  heroSubtitle: 'Des services professionnels et personnalisés au cœur de {{city}}. Découvrez pourquoi nos clients nous font confiance depuis des années.',
  services: [
    'Conseil personnalisé et accompagnement sur mesure',
    'Intervention rapide et réactive dans {{city}} et ses environs',
    'Devis gratuit sans engagement sous 24h',
  ],
  benefits: [
    '10+ années d\'expérience dans notre domaine',
    'Équipe certifiée et formée aux dernières normes',
    'Satisfaction client garantie ou remboursé',
    'Disponible 6j/7 pour vos urgences',
  ],
  testimonials: [
    {
      text: 'Service impeccable, équipe professionnelle et réactive. Je recommande vivement !',
      author: 'Marie L., cliente depuis 3 ans',
    },
    {
      text: 'Résultat parfait, délais respectés et prix honnêtes. On revient sans hésitation.',
      author: 'Thomas B., artisan local',
    },
    {
      text: 'Enfin un professionnel qui explique clairement et fait un travail de qualité.',
      author: 'Isabelle M., Résidente de {{city}}',
    },
  ],
  cta: 'Demandez votre devis gratuit dès maintenant',
};

/**
 * Génère du contenu mock en remplaçant les variables
 */
function generateMockContent(lead) {
  const replace = (str) =>
    str
      .replace(/\{\{name\}\}/g, lead.name)
      .replace(/\{\{city\}\}/g, lead.city)
      .replace(/\{\{activity\}\}/g, lead.activity);

  return {
    heroTitle:    replace(MOCK_TEMPLATE.heroTitle),
    heroSubtitle: replace(MOCK_TEMPLATE.heroSubtitle),
    services:     MOCK_TEMPLATE.services.map(replace),
    benefits:     MOCK_TEMPLATE.benefits.map(replace),
    testimonials: MOCK_TEMPLATE.testimonials.map(t => ({
      text:   replace(t.text),
      author: replace(t.author),
    })),
    cta: MOCK_TEMPLATE.cta,
  };
}

/**
 * Construit le prompt IA optimisé pour la conversion locale
 */
function buildPrompt(lead) {
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

/**
 * Extrait l'objet JSON d'une réponse IA potentiellement bavarde :
 * tolère les code fences markdown et le texte avant/après l'objet.
 * Exporté pour les tests.
 */
export function extractJson(text) {
  const cleaned = String(text)
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Aucun objet JSON dans la réponse IA');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildMessages(lead, correctionHint) {
  const messages = [
    {
      role: 'system',
      content: 'Tu es un expert copywriter. Tu réponds uniquement en JSON valide, jamais en markdown.',
    },
    { role: 'user', content: buildPrompt(lead) },
  ];
  if (correctionHint) {
    messages.push({
      role: 'user',
      content: `Ta réponse précédente était invalide (${correctionHint}). Renvoie UNIQUEMENT l'objet JSON corrigé, sans aucun texte autour.`,
    });
  }
  return messages;
}

/**
 * Appelle l'API IA réelle. Le timeout (config.generation.timeoutMs) garantit
 * qu'un fournisseur qui pend ne bloque jamais un worker.
 */
async function callAIAPI(lead, { correctionHint = null } = {}) {
  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(config.generation.timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages: buildMessages(lead, correctionHint),
      max_tokens: config.ai.maxTokens,
      temperature: config.ai.temperature,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API IA erreur ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('Réponse IA vide ou malformée');
  }

  return extractJson(rawContent);
}

/**
 * Génère le contenu IA pour un lead donné — point d'entrée public.
 *
 * Échelle de résilience :
 *   1. appel normal
 *   2. si parsing/HTTP échoue → 1 retentative avec le message d'erreur en feedback
 *   3. si double échec → mock complet
 *   4. dans tous les cas, validation Zod champ par champ : les champs invalides
 *      sont comblés par le mock, les bons champs IA sont conservés
 */
export async function generateContent(lead) {
  if (!lead?.name || !lead?.activity || !lead?.city) {
    throw new Error(`Lead invalide: champs name, activity, city requis`);
  }

  const mock = generateMockContent(lead);

  if (config.ai.mockMode || !config.ai.apiKey || config.ai.apiKey === 'sk-...') {
    logger.info(`[IA] Mode mock pour "${lead.name}"`);
    return mock;
  }

  logger.info(`[IA] Génération contenu pour "${lead.name}" via ${config.ai.model}`);

  let raw;
  try {
    raw = await callAIAPI(lead);
  } catch (firstErr) {
    logger.warn(`[IA] Premier appel échoué (${firstErr.message}) — retentative corrective`);
    try {
      raw = await callAIAPI(lead, { correctionHint: firstErr.message });
    } catch (secondErr) {
      logger.error(`[IA] Double échec — mock complet pour "${lead.name}"`, { error: secondErr.message });
      return mock;
    }
  }

  const { content, fallbacks } = repairContent(raw, mock);
  if (fallbacks.length) {
    logger.warn(`[IA] Champs comblés par mock: ${fallbacks.join(', ')}`, { lead: lead.name });
  }
  logger.info(`[IA] Contenu généré pour "${lead.name}"`);
  return content;
}

// Alias pour compatibilité avec main.js (pipeline CLI)
export { generateContent as generateAIContent };
