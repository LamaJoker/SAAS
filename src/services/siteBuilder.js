import { writeFile, mkdir, rename } from 'fs/promises';
import { join }   from 'path';
import { config } from '../config/config.js';
import { sanitize } from '../utils/utils.js';
import { logger }   from '../utils/logger.js';
import { loadTemplate, DEFAULT_TEMPLATE_ID } from './templateService.js';
import { demoImages } from './imageService.js';

const SERVICE_ICONS = ['🔧', '⚡', '🎯', '💡', '🛡️', '🔑', '📞', '🏆'];

function buildServicesHTML(services) {
  if (!Array.isArray(services) || !services.length) return '';
  return services.map((service, i) => {
    const raw  = String(service);
    const sep  = raw.indexOf(' — ') !== -1 ? ' — ' : raw.indexOf(': ') !== -1 ? ': ' : null;
    let title  = '';
    let desc   = sanitize(raw.trim());
    if (sep) {
      const parts = raw.split(sep);
      title = sanitize(parts[0].trim());
      desc  = sanitize(parts.slice(1).join(sep).trim());
    }
    return `
      <div class="service-card">
        <div class="svc-icon">${SERVICE_ICONS[i % SERVICE_ICONS.length]}</div>
        <div>
          ${title ? `<div class="svc-title">${title}</div>` : ''}
          <div class="svc-text">${desc}</div>
        </div>
      </div>`;
  }).join('\n');
}

function buildTestimonialsHTML(testimonials) {
  if (!Array.isArray(testimonials) || !testimonials.length) return '';
  const stars = '<div class="tcard-stars">' + Array(5).fill('<span class="star">★</span>').join('') + '</div>';
  return testimonials.map(t => `
    <div class="tcard">
      ${stars}
      <p class="tcard-text">${sanitize(t.text)}</p>
      <div class="tcard-author">— ${sanitize(t.author)}</div>
    </div>`).join('\n');
}

function buildBenefitsHTML(benefits) {
  if (!Array.isArray(benefits) || !benefits.length) return '';
  return '<ul class="benefits-list">' +
    benefits.map(b => `<li><div class="check-icon">✓</div><span>${sanitize(String(b))}</span></li>`).join('') +
    '</ul>';
}

// URLs construites par nous (imageService) → styles inline pour être autonome
// quel que soit le template (pas de dépendance à une classe CSS).
function buildGalleryHTML(urls, name) {
  if (!Array.isArray(urls) || !urls.length) return '';
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">' +
    urls.map(u => `<img src="${u}" alt="${sanitize(name)}" loading="lazy" style="width:100%;height:190px;object-fit:cover;border-radius:12px;" />`).join('') +
    '</div>';
}

function processConditionals(html, data) {
  return html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) =>
    data[key] ? content : ''
  );
}

function replacePlaceholders(templateHTML, lead, content) {
  const imgs = demoImages(lead, lead.slug || '');

  const data = {
    name:         sanitize(lead.name),
    activity:     sanitize(lead.activity),
    city:         sanitize(lead.city),
    email:        sanitize(lead.email   || ''),
    phone:        sanitize(lead.phone   || ''),
    heroTitle:    sanitize(content.heroTitle),
    heroSubtitle: sanitize(content.heroSubtitle),
    cta:          sanitize(content.cta),
    services:     buildServicesHTML(content.services),
    benefits:     buildBenefitsHTML(content.benefits),
    testimonials: buildTestimonialsHTML(content.testimonials),
    heroImage:    imgs.heroImage,
    gallery:      buildGalleryHTML(imgs.gallery, lead.name),
    year:         new Date().getFullYear().toString(),
    slug:         lead.slug || '',
  };

  // Les blocs {{#if heroImage}}…{{/if}} / {{#if gallery}}…{{/if}} disparaissent
  // quand le provider d'images est 'none'.
  let html = processConditionals(templateHTML, {
    email: !!lead.email, phone: !!lead.phone,
    heroImage: !!imgs.heroImage, gallery: imgs.gallery.length > 0,
  });

  for (const [key, value] of Object.entries(data)) {
    html = html.split(`{{${key}}}`).join(value);
  }
  return html;
}

export async function buildSite({ lead, content, slug, templateId = DEFAULT_TEMPLATE_ID }) {
  const templateHTML = await loadTemplate(templateId);

  const outputDir  = join(config.paths.output, slug);
  const outputFile = join(outputDir, 'index.html');

  await mkdir(outputDir, { recursive: true });

  const finalHTML = replacePlaceholders(templateHTML, { ...lead, slug }, content);

  // Garde : un placeholder résiduel = template et données désynchronisés.
  // On lève (la queue retentera) plutôt que de publier un site cassé.
  const leftover = finalHTML.match(/\{\{\s*[\w#/]+\s*\}\}/g);
  if (leftover) {
    throw new Error(`Placeholders non résolus: ${[...new Set(leftover)].join(', ')}`);
  }
  if (finalHTML.length < 5000) {
    throw new Error(`HTML suspicieusement court (${finalHTML.length} chars) — génération incomplète`);
  }

  // Écriture atomique : un crash mi-écriture ne sert jamais un fichier tronqué
  const tmpFile = outputFile + '.tmp';
  await writeFile(tmpFile, finalHTML, 'utf-8');
  await rename(tmpFile, outputFile);

  logger.info(`[Builder] Site généré: ${outputFile}`);
  return outputFile;
}
