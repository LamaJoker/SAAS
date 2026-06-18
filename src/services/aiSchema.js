/**
 * aiSchema.js — Validation stricte du JSON généré par l'IA
 *
 * Principe : réparation par fusion, pas tout-ou-rien. Chaque champ invalide
 * (absent, mauvais type, trop long) est remplacé individuellement par son
 * équivalent mock — les champs corrects de l'IA sont conservés.
 * `.catch(null)` au niveau de chaque champ : la validation ne lève jamais,
 * elle marque les champs irrécupérables.
 */
import { z } from 'zod';

const str = (max) => z.string().trim().min(1).max(max).catch(null);

const strArray = (maxItems, maxLen) =>
  z.array(z.string().trim().min(1).max(maxLen)).min(1).max(maxItems).catch(null);

export const SiteContentSchema = z.object({
  heroTitle:    str(120),
  heroSubtitle: str(220),
  cta:          str(80),
  services:     strArray(6, 200),
  benefits:     strArray(8, 200),
  testimonials: z.array(z.object({
    text:   z.string().trim().min(1).max(400),
    author: z.string().trim().min(1).max(80),
  })).min(1).max(4).catch(null),
});

const FIELDS = ['heroTitle', 'heroSubtitle', 'cta', 'services', 'benefits', 'testimonials'];

/**
 * Valide la sortie IA champ par champ et comble les trous avec le mock.
 * @returns {{ content: object, fallbacks: string[] }} fallbacks = champs remplacés
 */
export function repairContent(raw, mockContent) {
  const parsed = SiteContentSchema.parse(
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  );

  const content   = {};
  const fallbacks = [];
  for (const field of FIELDS) {
    if (parsed[field] != null) {
      content[field] = parsed[field];
    } else {
      content[field] = mockContent[field];
      fallbacks.push(field);
    }
  }
  return { content, fallbacks };
}
