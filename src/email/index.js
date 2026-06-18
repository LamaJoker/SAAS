/**
 * email/index.js — Barrel : charge toutes les variantes et followups
 *
 * Usage :
 *   import { EMAIL_VARIANTS, FOLLOWUP_TEMPLATES, getVariant } from '../email/index.js';
 */

import * as curiosite       from './variants/curiosite.js';
import * as direct          from './variants/direct.js';
import * as court           from './variants/court.js';
import * as probleme        from './variants/probleme.js';
import * as opportunite     from './variants/opportunite.js';
import * as relance_soft    from './followup/relance_soft.js';
import * as relance_directe from './followup/relance_directe.js';

export const EMAIL_VARIANTS = {
  curiosite,
  direct,
  court,
  probleme,
  opportunite,
};

export const FOLLOWUP_TEMPLATES = {
  relance_soft,
  relance_directe,
};

export const VARIANT_IDS   = Object.keys(EMAIL_VARIANTS);
export const FOLLOWUP_IDS  = Object.keys(FOLLOWUP_TEMPLATES);

/** Retourne une variante par id (variants + followups) */
export function getVariant(id) {
  return EMAIL_VARIANTS[id] ?? FOLLOWUP_TEMPLATES[id] ?? null;
}
