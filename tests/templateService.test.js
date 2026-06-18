import { describe, it, expect } from 'vitest';
import { listTemplates, isValidTemplateId, loadTemplate, DEFAULT_TEMPLATE_ID, TEMPLATES } from '../src/services/templateService.js';

describe('templateService', () => {
  it('liste les templates du manifeste', () => {
    const list = listTemplates();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.map(t => t.id)).toContain('moderne');
    expect(list.map(t => t.id)).toContain('elegant');
    expect(list.map(t => t.id)).toContain('vibrant');
  });

  it('valide les ids', () => {
    expect(isValidTemplateId('moderne')).toBe(true);
    expect(isValidTemplateId('inexistant')).toBe(false);
    expect(isValidTemplateId(null)).toBe(false);
    expect(isValidTemplateId('__proto__')).toBe(false);
  });

  it('charge chaque template avec les placeholders essentiels', async () => {
    for (const id of Object.keys(TEMPLATES)) {
      const html = await loadTemplate(id);
      for (const ph of ['{{name}}', '{{heroTitle}}', '{{services}}', '{{testimonials}}', '{{cta}}', '{{year}}']) {
        expect(html, `${id} doit contenir ${ph}`).toContain(ph);
      }
      // Formulaire de contact présent partout
      expect(html, `${id} doit avoir le formulaire de contact`).toContain('demoContactForm');
      expect(html, `${id} doit poster vers /contact/`).toContain('/contact/{{slug}}');
    }
  });

  it('rejette un id inconnu', async () => {
    await expect(loadTemplate('hack')).rejects.toThrow(/Template inconnu/);
  });

  it('a un template par défaut valide', () => {
    expect(isValidTemplateId(DEFAULT_TEMPLATE_ID)).toBe(true);
  });
});
