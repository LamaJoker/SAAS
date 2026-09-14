/**
 * scorers.js — Évaluation déterministe du contenu généré.
 *
 * Pourquoi des scoreurs codés plutôt qu'un modèle juge
 * ───────────────────────────────────────────────────
 * Un « LLM-as-judge » est séduisant mais coûte un appel par évaluation, varie
 * d'une exécution à l'autre, et déplace le problème : il faudrait évaluer le
 * juge. Les défauts qui comptent ici sont tous vérifiables mécaniquement —
 * longueur dépassée, nom absent, fait inventé, témoignages recyclés. Un scoreur
 * déterministe est gratuit, reproductible, et il tourne dans la CI.
 *
 * Chaque scoreur est une fonction pure renvoyant :
 *   { id, label, score: 0..1, weight, details: string[] }
 *
 * `details` liste ce qui a échoué : un score sans explication ne permet pas de
 * corriger le prompt, et c'est la seule raison d'être de ce harnais.
 */
import { SiteContentSchema } from '../src/services/aiSchema.js';

// ─── Scoreur 1 — Conformité au schéma ───────────────────────────────────────
/**
 * Attention au piège : `SiteContentSchema` neutralise chaque champ invalide par
 * un `.catch(null)` au lieu de rejeter l'objet. `safeParse()` réussit donc
 * TOUJOURS, y compris sur `{}`. Tester `res.success` ne mesurerait rien.
 *
 * Ce qu'on mesure vraiment : combien de champs sortent à `null`, c'est-à-dire
 * combien il faudra combler avec le contenu de repli en production. Un champ
 * comblé est un champ que le modèle n'a pas su produire.
 */
const SCHEMA_FIELDS = ['heroTitle', 'heroSubtitle', 'cta', 'services', 'benefits', 'testimonials'];

export function schemaValid(content) {
  const parsed = SiteContentSchema.safeParse(content ?? {});
  const data = parsed.success ? parsed.data : {};
  const invalid = SCHEMA_FIELDS.filter(f => data[f] === null || data[f] === undefined);
  return {
    id: 'schema', label: 'Champs exploitables', weight: 3,
    score: (SCHEMA_FIELDS.length - invalid.length) / SCHEMA_FIELDS.length,
    details: invalid.map(f => `${f} : inexploitable, sera comblé par le repli`),
  };
}

// ─── Scoreur 2 — Longueurs annoncées dans le prompt ─────────────────────────
const LIMITS = { heroTitle: 60, heroSubtitle: 120, cta: 50 };

export function lengthLimits(content) {
  const details = [];
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = content?.[field];
    if (typeof value !== 'string') { details.push(`${field}: absent`); continue; }
    if (value.length > max) details.push(`${field}: ${value.length} car. (max ${max})`);
  }
  const checked = Object.keys(LIMITS).length;
  return {
    id: 'lengths', label: 'Longueurs respectées', weight: 2,
    score: (checked - details.length) / checked,
    details,
  };
}

// ─── Scoreur 3 — Ancrage sur les données fournies ───────────────────────────
export function grounding(content, lead) {
  const details = [];
  const hero = String(content?.heroTitle ?? '');
  const sub  = String(content?.heroSubtitle ?? '');

  if (!norm(hero).includes(norm(lead.name))) {
    details.push(`heroTitle ne reprend pas « ${lead.name} » à l'identique`);
  }
  if (!norm(`${hero} ${sub}`).includes(norm(lead.city))) {
    details.push(`ni le titre ni le sous-titre ne mentionnent « ${lead.city} »`);
  }
  return {
    id: 'grounding', label: 'Nom et ville présents', weight: 2,
    score: (2 - details.length) / 2,
    details,
  };
}

// ─── Scoreur 4 — Faits inventés (le plus important) ─────────────────────────
/**
 * Le modèle ne sait RIEN de l'entreprise : un nom, une activité, une ville.
 * Toute affirmation vérifiable qu'il produit est donc inventée. Ces pages sont
 * publiées sous le nom d'une vraie entreprise : une ancienneté fausse ou une
 * certification imaginaire, c'est de la publicité trompeuse, et c'est le
 * prospect qui en répond.
 */
const FABRICATION_PATTERNS = [
  { re: /\bdepuis\s+(?:19|20)\d{2}\b/i,                         what: 'date de création' },
  { re: /\b(?:19|20)\d{2}\b/,                                    what: 'année précise' },
  { re: /\b\d{1,3}\s*(?:\+\s*)?an(?:s|nées)?\s+d['’]expérience/i, what: "ancienneté chiffrée" },
  { re: /\b\d{1,3}\s*\+?\s*(?:ans|années)\b/i,                   what: 'durée chiffrée' },
  { re: /\bcertifi[ée]s?\b|\bagréé|\blabel(?:lisé)?\b|\bRGE\b|\bQualibat\b|\bISO\s?\d+/i, what: 'certification ou label' },
  { re: /\b(?:élu|primé|récompensé|médaille|trophée|meilleur\s+\w+\s+(?:19|20)\d{2})/i,   what: 'récompense' },
  { re: /\b\d{2,}\s*(?:clients|chantiers|interventions|projets)\b/i, what: 'volume chiffré' },
  { re: /\b\d{1,3}\s*%/,                                          what: 'pourcentage' },
  { re: /\b\d+[.,]?\d*\s*(?:€|euros?\b)/i,                        what: 'prix' },
  { re: /\b\d(?:[.,]\d)?\s*\/\s*5\b|\b\d(?:[.,]\d)?\s*étoiles?\b/i, what: 'note' },
  { re: /\bassur(?:é|ance)\s+(?:décennale|professionnelle)\b/i,   what: 'assurance' },
];

export function noFabrication(content, lead = {}) {
  const details = [];
  for (const [field, rawText] of flatten(content)) {
    // Le nom et la ville fournis sont des DONNÉES, pas des inventions : reprendre
    // « Fournil 1902 » ou « Saint-Étienne » à l'identique est même exigé par le
    // prompt. On les retire avant de chercher des faits fabriqués, sinon le
    // scoreur pénalise le modèle pour avoir obéi.
    const text = stripGiven(rawText, lead);
    for (const { re, what } of FABRICATION_PATTERNS) {
      const m = text.match(re);
      if (m) details.push(`${field} — ${what} : « ${m[0].trim()} »`);
    }
  }
  const unique = [...new Set(details)];
  return {
    id: 'fabrication', label: 'Aucun fait inventé', weight: 4,
    // Dégressif : une occurrence est un défaut, cinq est un contenu à jeter.
    score: Math.max(0, 1 - unique.length / 5),
    details: unique.slice(0, 6),
  };
}

// ─── Scoreur 5 — Témoignages réellement distincts ───────────────────────────
export function testimonialDiversity(content) {
  const list = Array.isArray(content?.testimonials) ? content.testimonials : [];
  if (list.length < 3) {
    return { id: 'diversity', label: 'Témoignages distincts', weight: 2, score: 0,
             details: [`${list.length} témoignage(s) au lieu de 3`] };
  }

  const details = [];
  let pairs = 0, similar = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      pairs++;
      const sim = jaccard(words(list[i]?.text), words(list[j]?.text));
      if (sim > 0.45) {
        similar++;
        details.push(`témoignages ${i + 1} et ${j + 1} similaires à ${Math.round(sim * 100)} %`);
      }
    }
  }
  return {
    id: 'diversity', label: 'Témoignages distincts', weight: 2,
    score: pairs ? (pairs - similar) / pairs : 0,
    details,
  };
}

// ─── Scoreur 6 — Pertinence métier ──────────────────────────────────────────
/**
 * Le contenu doit parler du métier, pas d'un « professionnel » interchangeable.
 * Le lexique attendu vient du cas de test : c'est un signal grossier, mais il
 * attrape le défaut le plus fréquent — un texte générique qui irait aussi bien
 * à un plombier qu'à un restaurant, donc sans valeur pour le prospect.
 */
export function activityRelevance(content, lead, lexicon = []) {
  if (!lexicon.length) {
    return { id: 'relevance', label: 'Vocabulaire métier', weight: 2, score: 1, details: [] };
  }
  const haystack = norm(flatten(content).map(([, v]) => v).join(' '));
  const hits = lexicon.filter(w => haystack.includes(norm(w)));
  const target = Math.min(3, lexicon.length);   // 3 termes suffisent à ancrer le métier
  return {
    id: 'relevance', label: 'Vocabulaire métier', weight: 2,
    score: Math.min(1, hits.length / target),
    details: hits.length >= target ? [] : [`${hits.length}/${target} termes attendus (${lexicon.slice(0, 6).join(', ')})`],
  };
}

// ─── Scoreur 7 — Résidus de gabarit et anglicismes ──────────────────────────
const LEAKS = [
  { re: /\{\{[^}]+\}\}/,                    what: 'variable de gabarit non remplacée' },
  { re: /\blorem ipsum\b/i,                 what: 'texte de remplissage' },
  { re: /\[[^\]]{3,40}\]/,                  what: 'crochet de gabarit' },
  { re: /\bvotre entreprise\b|\bnom de l['’]entreprise\b/i, what: 'placeholder non personnalisé' },
  { re: /\b(?:your|our team|business|customers|quality service)\b/i, what: 'anglais' },
  { re: /\bXXX+\b|…\s*…/,                   what: 'contenu tronqué' },
];

export function noLeaks(content) {
  const details = [];
  for (const [field, text] of flatten(content)) {
    for (const { re, what } of LEAKS) {
      if (re.test(text)) details.push(`${field} — ${what}`);
    }
  }
  const unique = [...new Set(details)];
  return {
    id: 'leaks', label: 'Pas de résidu de gabarit', weight: 3,
    score: unique.length ? 0 : 1,   // binaire : un seul résidu rend la page inutilisable
    details: unique.slice(0, 5),
  };
}

// ─── Agrégation ─────────────────────────────────────────────────────────────
export const ALL_SCORERS = [
  (c, l, x) => schemaValid(c, l, x),
  (c, l, x) => lengthLimits(c, l, x),
  (c, l, x) => grounding(c, l, x),
  (c, l, x) => noFabrication(c, l, x),
  (c, l, x) => testimonialDiversity(c, l, x),
  (c, l, x) => activityRelevance(c, l, x),
  (c, l, x) => noLeaks(c, l, x),
];

/**
 * Évalue un contenu et renvoie le détail plus un score global pondéré (0..1).
 *
 * @param {object} content contenu généré
 * @param {object} lead    { name, activity, city }
 * @param {string[]} [lexicon] vocabulaire métier attendu
 */
export function scoreContent(content, lead, lexicon = []) {
  const results = ALL_SCORERS.map(fn => fn(content, lead, lexicon));
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  const weighted = results.reduce((s, r) => s + r.score * r.weight, 0);
  return {
    overall: Math.round((weighted / totalWeight) * 1000) / 1000,
    results,
    failures: results.filter(r => r.score < 1).flatMap(r => r.details),
  };
}

// ─── Utilitaires ────────────────────────────────────────────────────────────

/** Aplati le contenu en paires [chemin, texte], pour scanner tous les champs. */
function flatten(content) {
  const out = [];
  if (!content || typeof content !== 'object') return out;

  for (const field of ['heroTitle', 'heroSubtitle', 'cta']) {
    if (typeof content[field] === 'string') out.push([field, content[field]]);
  }
  for (const field of ['services', 'benefits']) {
    const arr = Array.isArray(content[field]) ? content[field] : [];
    arr.forEach((v, i) => { if (typeof v === 'string') out.push([`${field}[${i}]`, v]); });
  }
  const t = Array.isArray(content.testimonials) ? content.testimonials : [];
  t.forEach((item, i) => {
    if (typeof item?.text === 'string')   out.push([`testimonials[${i}].text`, item.text]);
    if (typeof item?.author === 'string') out.push([`testimonials[${i}].author`, item.author]);
  });
  return out;
}

/** Retire du texte les valeurs fournies dans le lead (nom, ville, activité). */
function stripGiven(text, lead) {
  let out = String(text);
  for (const value of [lead?.name, lead?.city, lead?.activity]) {
    if (typeof value === 'string' && value.length > 1) {
      out = out.split(value).join(' ');
    }
  }
  return out;
}

/** Minuscules sans accents : la comparaison ne doit pas dépendre de la casse. */
function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function words(s) {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 3));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
