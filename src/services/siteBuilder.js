import { readFile, writeFile, mkdir } from 'fs/promises';
import { join }   from 'path';
import { config } from '../config/config.js';
import { sanitize } from '../utils/utils.js';
import { logger }   from '../utils/logger.js';

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

function processConditionals(html, data) {
  return html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) =>
    data[key] ? content : ''
  );
}

function replacePlaceholders(templateHTML, lead, content) {
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
    year:         new Date().getFullYear().toString(),
    slug:         lead.slug || '',
  };

  let html = processConditionals(templateHTML, { email: !!lead.email, phone: !!lead.phone });

  for (const [key, value] of Object.entries(data)) {
    html = html.split(`{{${key}}}`).join(value);
  }
  return html;
}

export async function buildSite({ lead, content, slug }) {
  let templateHTML;
  try {
    templateHTML = await readFile(config.paths.template, 'utf-8');
  } catch (err) {
    throw new Error(`Impossible de lire le template: ${err.message}`);
  }

  const outputDir  = join(config.paths.output, slug);
  const outputFile = join(outputDir, 'index.html');

  await mkdir(outputDir, { recursive: true });

  const finalHTML = replacePlaceholders(templateHTML, { ...lead, slug }, content);
  await writeFile(outputFile, finalHTML, 'utf-8');

  logger.info(`[Builder] Site généré: ${outputFile}`);
  return outputFile;
}
