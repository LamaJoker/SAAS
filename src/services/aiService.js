import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { repairContent } from './aiSchema.js';
import { getPrompt, ACTIVE_VERSION } from '../ai/prompts/index.js';
import { recordAiCall } from '../ai/usage.js';

/**
 * Contenu de repli, utilisé en mode simulation ET en secours quand l'appel au
 * modèle échoue.
 *
 * ⚠️ Ce contenu est PUBLIÉ sous le nom d'une vraie entreprise. Il ne doit donc
 * contenir aucune affirmation vérifiable : ni ancienneté, ni certification, ni
 * garantie, ni chiffre. La version précédente promettait « 10+ années
 * d'expérience », « équipe certifiée » et « satisfaction garantie ou remboursé »
 * pour des entreprises dont on ne sait rien — c'est de la publicité trompeuse,
 * et c'est le prospect qui en répond. Le harnais d'évaluation (`npm run eval`)
 * vérifie cette contrainte à chaque exécution.
 *
 * Les longueurs respectent les mêmes limites que celles imposées au modèle :
 * heroTitle ≤ 60, heroSubtitle ≤ 120, cta ≤ 50.
 */
const MOCK_TEMPLATE = {
  heroTitle: '{{name}}, {{activity}} à {{city}}',
  heroSubtitle: 'Un interlocuteur proche de chez vous à {{city}}, à l\'écoute de votre besoin.',
  services: [
    'Un premier échange pour comprendre votre besoin avant toute proposition',
    'Une intervention soignée, expliquée à chaque étape',
    'Un devis clair et détaillé, sans engagement',
  ],
  benefits: [
    'Un seul interlocuteur du début à la fin',
    'Des explications claires, sans jargon',
    'Un travail soigné et un chantier laissé propre',
    'Une disponibilité réelle pour répondre à vos questions',
  ],
  testimonials: [
    {
      text: 'On m\'a expliqué ce qui allait être fait avant de commencer. Ça change tout.',
      author: 'Marie L.',
    },
    {
      text: 'Ponctuel, soigneux, et le devis annoncé correspondait à la facture.',
      author: 'Thomas B.',
    },
    {
      text: 'J\'ai apprécié de pouvoir poser mes questions sans me sentir pressée.',
      author: 'Isabelle M., {{city}}',
    },
  ],
  cta: 'Demandez votre devis gratuit',
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

/**
 * Appelle l'API IA réelle. Le timeout (config.generation.timeoutMs) garantit
 * qu'un fournisseur qui pend ne bloque jamais un worker.
 */
async function callAIAPI(lead, { correctionHint = null, promptVersion = ACTIVE_VERSION } = {}) {
  const prompt = getPrompt(promptVersion);
  const startedAt = Date.now();

  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(config.generation.timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages: prompt.build(lead, { correctionHint }),
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

  return {
    content: extractJson(rawContent),
    // `usage` est renvoyé par les API compatibles OpenAI. Absent chez certains
    // fournisseurs : on enregistre alors 0 token, et cost_known signale que le
    // coût n'est pas estimable plutôt que de le faire passer pour nul.
    tokensIn:  data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    durationMs: Date.now() - startedAt,
  };
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
export async function generateContent(lead, { promptVersion = ACTIVE_VERSION, userId = null } = {}) {
  if (!lead?.name || !lead?.activity || !lead?.city) {
    throw new Error(`Lead invalide: champs name, activity, city requis`);
  }

  const mock = generateMockContent(lead);
  const telemetry = {
    model: config.ai.model, promptVersion,
    userId, leadId: lead.id ?? null,
  };

  if (config.ai.mockMode || !config.ai.apiKey || config.ai.apiKey === 'sk-...') {
    logger.info(`[IA] Mode mock pour "${lead.name}"`);
    recordAiCall({ ...telemetry, model: 'mock', outcome: 'mock' });
    return mock;
  }

  logger.info(`[IA] Génération contenu pour "${lead.name}" via ${config.ai.model} (prompt ${promptVersion})`);

  let call;
  let attempt = 1;
  try {
    call = await callAIAPI(lead, { promptVersion });
  } catch (firstErr) {
    logger.warn(`[IA] Premier appel échoué (${firstErr.message}) — retentative corrective`);
    attempt = 2;
    try {
      call = await callAIAPI(lead, { correctionHint: firstErr.message, promptVersion });
    } catch (secondErr) {
      logger.error(`[IA] Double échec — mock complet pour "${lead.name}"`, { error: secondErr.message });
      recordAiCall({ ...telemetry, outcome: 'failed', attempt: 2 });
      return mock;
    }
  }

  const { content, fallbacks } = repairContent(call.content, mock);
  if (fallbacks.length) {
    logger.warn(`[IA] Champs comblés par mock: ${fallbacks.join(', ')}`, { lead: lead.name });
  }

  const cost = recordAiCall({
    ...telemetry,
    tokensIn: call.tokensIn, tokensOut: call.tokensOut,
    durationMs: call.durationMs, attempt,
    outcome: fallbacks.length ? 'repaired' : 'ok',
    fallbacks,
  });

  logger.info(`[IA] Contenu généré pour "${lead.name}"`, {
    tokens: call.tokensIn + call.tokensOut,
    costCents: cost?.known ? cost.cents : null,
    ms: call.durationMs,
  });
  return content;
}

/** Contenu mock exposé pour les évaluations et les tests. */
export { generateMockContent };

