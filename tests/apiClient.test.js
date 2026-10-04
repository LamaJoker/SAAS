/**
 * Client API des scripts (pipeline, generateBulk…). apiFetch ne renvoie que
 * la première page d'une liste paginée : apiFetchAll doit les lire toutes,
 * sinon un import de plus de 50 leads n'est que partiellement traité.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createApiClient } from '../scripts/lib/apiClient.js';

afterEach(() => { vi.unstubAllGlobals(); });

const json = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('apiClient — apiFetchAll', () => {
  it('parcourt toutes les pages de /leads', async () => {
    const calls = [];
    vi.stubGlobal('fetch', (url) => {
      calls.push(url);
      if (url.endsWith('/users/login')) return json({ data: { token: 't', user: { id: 'u1' } } });
      const page = Number(new URL(url).searchParams.get('page'));
      const items = page < 3 ? Array.from({ length: 200 }, (_, i) => ({ id: `${page}-${i}` })) : [{ id: '3-0' }];
      return json({ data: items, pagination: { page, limit: 200, total: 401, pages: 3 } });
    });

    const { apiFetchAll } = await createApiClient({ baseUrl: 'http://api.test', email: 'a@b.fr', password: 'x' });
    const leads = await apiFetchAll('/leads');

    expect(leads).toHaveLength(401);
    expect(calls.filter(u => u.includes('/leads'))).toHaveLength(3);
  });

  it('remonte l\'erreur de l\'API au lieu de renvoyer une liste partielle', async () => {
    vi.stubGlobal('fetch', (url) => url.endsWith('/users/login')
      ? json({ data: { token: 't', user: { id: 'u1' } } })
      : json({ success: false, error: 'Limite de requêtes atteinte' }, 429));

    const { apiFetchAll } = await createApiClient({ baseUrl: 'http://api.test', email: 'a@b.fr', password: 'x' });
    await expect(apiFetchAll('/leads')).rejects.toThrow('Limite de requêtes atteinte');
  });
});
