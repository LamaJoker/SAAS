import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { sanitize, formatListToHTML } from '../utils/utils.js';
import { logger } from '../utils/logger.js';

/**
 * Génère le HTML des témoignages
 */
function buildTestimonialsHTML(testimonials) {
  if (!Array.isArray(testimonials) || testimonials.length === 0) return '';

  return testimonials
    .map(t => `
      <div class="testimonial-card">
        <p class="testimonial-text">${sanitize(t.text)}</p>
        <p class="testimonial-author">— ${sanitize(t.author)}</p>
      </div>`)
    .join('\n');
}

/**
 * Génère le HTML des services
 */
function buildServicesHTML(services) {
  if (!Array.isArray(services) || services.length === 0) return '';

  const icons = ['🔧', '⚡', '🎯', '💡', '🛡️', '📞'];

  return services
    .map((service, index) => `
      <div class="service-card">
        <div class="service-icon">${icons[index % icons.length]}</div>
        <div>
          <p class="service-text">${sanitize(service)}</p>
        </div>
      </div>`)
    .join('\n');
}

/**
 * Traite les blocs conditionnels {{#if field}}...{{/if}}
 */
function processConditionals(html, data) {
  return html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) => {
    return data[key] ? content : '';
  });
}

/**
 * Remplace tous les placeholders dans le template HTML
 */
function replacePlaceholders(templateHTML, lead, content) {
  const data = {
    name:         sanitize(lead.name),
    activity:     sanitize(lead.activity),
    city:         sanitize(lead.city),
    email:        sanitize(lead.email || ''),
    phone:        sanitize(lead.phone || ''),
    heroTitle:    sanitize(content.heroTitle),
    heroSubtitle: sanitize(content.heroSubtitle),
    cta:          sanitize(content.cta),
    services:     buildServicesHTML(content.services),
    benefits:     formatListToHTML(content.benefits, 'benefits-list'),
    testimonials: buildTestimonialsHTML(content.testimonials),
    year:         new Date().getFullYear().toString(),
    slug:         lead.slug || '',
  };

  // 1. Process conditionals first
  let html = processConditionals(templateHTML, {
    email: !!lead.email,
    phone: !!lead.phone,
  });

  // 2. Replace all simple placeholders
  for (const [key, value] of Object.entries(data)) {
    html = html.split(`{{${key}}}`).join(value);
  }

  return html;
}

/**
 * Construit et sauvegarde le site HTML d'un lead.
 * Retourne le chemin absolu du fichier généré.
 */
export async function buildSite({ lead, content, slug }) {
  // Charger le template
  let templateHTML;
  try {
    templateHTML = await readFile(config.paths.template, 'utf-8');
  } catch (error) {
    throw new Error(`Impossible de lire le template: ${config.paths.template} — ${error.message}`);
  }

  const outputDir  = join(config.paths.output, slug);
  const outputFile = join(outputDir, 'index.html');

  await mkdir(outputDir, { recursive: true });

  const finalHTML = replacePlaceholders(templateHTML, { ...lead, slug }, content);
  await writeFile(outputFile, finalHTML, 'utf-8');

  logger.info(`[Builder] Site généré: ${outputFile}`);
  return outputFile;
}
