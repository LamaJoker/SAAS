/**
 * Parcours complet d'un visiteur, dans un vrai navigateur :
 * accueil → inscription → ajout d'un lead → génération → démo publiée.
 *
 * Au-delà du parcours, le test échoue si le navigateur :
 *   - appelle une autre origine que le serveur (cf. bug « localhost:3000 ») ;
 *   - voit une requête échouer, une erreur JS ou une violation de CSP.
 * Ce sont précisément les défauts que les tests d'API ne voient pas.
 */
import { test, expect } from '@playwright/test';

// Origines tierces légitimes chargées par les pages (polices).
const THIRD_PARTY_ALLOWED = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

function watchBrowser(page, baseURL) {
  const problems = [];
  const origin = new URL(baseURL).origin;

  page.on('request', (req) => {
    const reqOrigin = new URL(req.url()).origin;
    if (reqOrigin !== origin && !THIRD_PARTY_ALLOWED.includes(reqOrigin) && !req.url().startsWith('data:')) {
      problems.push(`requête vers une autre origine : ${req.method()} ${req.url()}`);
    }
  });
  page.on('requestfailed', (req) => {
    if (THIRD_PARTY_ALLOWED.includes(new URL(req.url()).origin)) return; // CI sans accès aux polices
    problems.push(`requête échouée : ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('pageerror', (err) => problems.push(`erreur JS : ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) {
      problems.push(`CSP : ${msg.text()}`);
    }
  });
  return problems;
}

test('accueil → inscription → lead → génération → démo', async ({ page, baseURL }) => {
  const problems = watchBrowser(page, baseURL);
  const leadName = `Boulangerie Test ${Date.now()}`;

  // ── Accueil, puis inscription ────────────────────────────────────────────
  await page.goto('/');
  await page.locator('a[href="/login?mode=register"]').first().click();
  await expect(page.locator('#nameGroup')).toBeVisible();

  await page.fill('#name', 'Visiteur E2E');
  await page.fill('#email', `e2e-${Date.now()}@exemple.fr`);
  await page.fill('#password', 'MotDePasse-E2E-123');
  await page.click('#loginBtn');

  // ── Dashboard : connecté, bandeau vitrine visible ────────────────────────
  await expect(page).toHaveURL(/\/dashboard\.html/);
  await expect(page.locator('.showcase-banner')).toContainText('Version de démonstration');

  // ── Ajout d'un lead ──────────────────────────────────────────────────────
  await page.click('.nav-item[data-tab="add"]');
  await page.fill('#leadName', leadName);
  await page.fill('#leadActivity', 'Boulanger');
  await page.fill('#leadCity', 'Vesoul');
  await page.click('#addLeadBtn');
  await expect(page.locator('#toast')).toContainText('Lead ajouté');

  // ── Génération du site ───────────────────────────────────────────────────
  await page.click('.nav-item[data-tab="leads"]');
  const row = page.locator('#leadsBody tr', { hasText: leadName });
  await row.locator('.generate-btn').click();
  await expect(page.locator('#generateModal')).toBeVisible();
  await page.click('#confirmGenerateBtn');
  await expect(page.locator('#toast')).toContainText('Site généré');

  // ── La démo publiée s'ouvre et présente le prospect ──────────────────────
  await page.click('.nav-item[data-tab="sites"]');
  const demoLink = page.locator('a', { hasText: 'Voir ↗' }).first();
  const demoUrl = await demoLink.getAttribute('href');
  expect(new URL(demoUrl).origin).toBe(new URL(baseURL).origin);

  const demo = await page.goto(demoUrl);
  expect(demo.status()).toBe(200);
  await expect(page.locator('body')).toContainText(leadName);

  expect(problems, problems.join('\n')).toEqual([]);
});

test('la session survit à un rechargement (cookie HttpOnly en production)', async ({ page }) => {
  await page.goto('/login?mode=register');
  await page.fill('#name', 'Visiteur Session');
  await page.fill('#email', `e2e-session-${Date.now()}@exemple.fr`);
  await page.fill('#password', 'MotDePasse-E2E-123');
  await page.click('#loginBtn');
  await expect(page).toHaveURL(/\/dashboard\.html/);

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\.html/);
  await expect(page.locator('#loginForm')).toHaveCount(0);
});
