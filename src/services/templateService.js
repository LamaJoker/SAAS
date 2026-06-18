import { readFile } from 'fs/promises';
import { join }     from 'path';
import { config }   from '../config/config.js';
import { Errors }   from '../utils/AppError.js';

/**
 * Manifeste des templates disponibles.
 * Chaque template est un fichier templates/<id>.html utilisant les
 * placeholders standard : {{name}} {{activity}} {{city}} {{heroTitle}}
 * {{heroSubtitle}} {{services}} {{benefits}} {{testimonials}} {{cta}}
 * {{email}} {{phone}} {{year}} et les blocs {{#if email}}...{{/if}}.
 */
export const TEMPLATES = {
  moderne: {
    id:          'moderne',
    label:       'Moderne',
    description: 'Bleu professionnel, épuré — convient à toutes les activités',
  },
  elegant: {
    id:          'elegant',
    label:       'Élégant',
    description: 'Sombre et raffiné, typographie serif — haut de gamme, artisanat, restauration',
  },
  vibrant: {
    id:          'vibrant',
    label:       'Vibrant',
    description: 'Coloré et énergique — commerces, sport, services aux particuliers',
  },
};

export const DEFAULT_TEMPLATE_ID = 'moderne';

export function listTemplates() {
  return Object.values(TEMPLATES);
}

export function isValidTemplateId(id) {
  return typeof id === 'string' && Object.hasOwn(TEMPLATES, id);
}

/**
 * Charge le HTML brut d'un template par son id.
 */
export async function loadTemplate(templateId = DEFAULT_TEMPLATE_ID) {
  if (!isValidTemplateId(templateId)) {
    throw Errors.badRequest(`Template inconnu: "${templateId}". Disponibles: ${Object.keys(TEMPLATES).join(', ')}`);
  }
  const path = join(config.paths.templates, `${templateId}.html`);
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    throw new Error(`Impossible de lire le template "${templateId}": ${err.message}`);
  }
}
