/**
 * showcase.js — Bandeau « version de démonstration ».
 *
 * Affiché quand le serveur tourne en mode vitrine (SHOWCASE_MODE=true) : sur un
 * hébergement gratuit à disque éphémère, comptes, leads et sites sont effacés à
 * chaque mise en veille. Le visiteur doit le savoir avant de saisir quoi que ce
 * soit.
 *
 * Autonome : chargé par toutes les pages, dont certaines n'utilisent pas
 * styles.css (le dashboard a ses styles intégrés). Les styles sont donc posés
 * via le CSSOM (el.style), que la CSP n'interdit pas, contrairement aux
 * attributs style="" dans le HTML.
 *
 * Placement : pastille fixe en bas à gauche — hors de l'en-tête fixe du
 * dashboard et des toasts (bas à droite), sans effet sur la mise en page.
 */
(async () => {
  let showcase = false;
  try {
    const res = await fetch('/public-config', { credentials: 'same-origin' });
    showcase = res.ok && (await res.json()).data?.showcase === true;
  } catch {
    return; // serveur injoignable : la page gère déjà l'erreur à sa façon
  }
  if (!showcase) return;

  const narrow = window.matchMedia('(max-width: 600px)').matches;

  const banner = document.createElement('div');
  banner.className = 'showcase-banner';
  banner.setAttribute('role', 'status');
  Object.assign(banner.style, {
    position: 'fixed', zIndex: '998', bottom: narrow ? '8px' : '16px',
    left: narrow ? '8px' : '16px', right: narrow ? '8px' : 'auto',
    maxWidth: narrow ? 'none' : '420px',
    display: 'flex', alignItems: 'flex-start', gap: '10px',
    padding: '12px 14px', borderRadius: '10px',
    border: '1px solid #f59e0b', background: '#2a2110', color: '#fde8c2',
    font: "13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif",
    boxShadow: '0 6px 24px rgba(0, 0, 0, .35)',
  });

  const icon = document.createElement('span');
  icon.textContent = '🧪';
  icon.setAttribute('aria-hidden', 'true');
  Object.assign(icon.style, { fontSize: '16px', lineHeight: '1.2' });

  const text = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = 'Version de démonstration. ';
  title.style.color = '#fbbf24';
  text.append(title, 'Les comptes et sites créés sont effacés après quelques minutes '
    + 'd\'inactivité. N\'y saisissez aucune donnée réelle.');

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Masquer ce message');
  Object.assign(close.style, {
    marginLeft: 'auto', border: '0', background: 'none', color: 'inherit',
    fontSize: '18px', lineHeight: '1', cursor: 'pointer', opacity: '.75',
  });
  close.addEventListener('click', () => banner.remove());

  banner.append(icon, text, close);
  document.body.appendChild(banner);
})();
