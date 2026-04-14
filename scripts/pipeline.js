<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="{{name}} — {{activity}} à {{city}}" />
  <title>{{name}} — {{activity}} à {{city}}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }

    :root {
      --primary:   #2563eb;
      --primary-h: #1d4ed8;
      --accent:    #f59e0b;
      --success:   #16a34a;
      --text:      #1f2937;
      --text-muted:#6b7280;
      --bg:        #ffffff;
      --bg-light:  #f8fafc;
      --border:    #e5e7eb;
      --radius:    8px;
      --shadow:    0 4px 24px rgba(0,0,0,.08);
    }

    body {
      font-family: 'Segoe UI', system-ui, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.6;
    }

    /* ─── BANDEAU D'URGENCE (nouveau) ───────────────────── */
    .urgency-bar {
      background: #1e3a5f;
      color: #fff;
      text-align: center;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: .02em;
    }
    .urgency-bar span { color: #fbbf24; }

    /* ─── HEADER / NAV ───────────────────────────────────── */
    header {
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    nav {
      max-width: 1100px;
      margin: 0 auto;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nav-brand {
      font-size: 18px;
      font-weight: 700;
      color: var(--primary);
      text-decoration: none;
    }
    .nav-links { display: flex; gap: 28px; list-style: none; }
    .nav-links a {
      font-size: 14px;
      color: var(--text-muted);
      text-decoration: none;
      transition: color .2s;
    }
    .nav-links a:hover { color: var(--primary); }
    .nav-cta {
      background: var(--primary);
      color: #fff !important;
      padding: 8px 18px;
      border-radius: var(--radius);
      font-weight: 600;
    }
    .nav-cta:hover { background: var(--primary-h) !important; }

    /* ─── HERO ──────────────────────────────────────────── */
    .hero {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      padding: 72px 24px 60px;
      text-align: center;
    }
    .hero .container { max-width: 740px; margin: 0 auto; }

    .hero-badge {
      display: inline-block;
      background: rgba(37,99,235,.1);
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .1em;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 18px;
    }
    .hero h1 {
      font-size: clamp(28px, 5vw, 46px);
      font-weight: 800;
      line-height: 1.2;
      color: var(--text);
      margin-bottom: 18px;
    }
    .hero .subtitle {
      font-size: 17px;
      color: var(--text-muted);
      margin-bottom: 28px;
      line-height: 1.7;
    }

    /* ─── CTA PRINCIPAL (nouveau — immédiatement visible) ── */
    .hero-cta-block {
      background: #fff;
      border: 2px solid var(--primary);
      border-radius: 12px;
      padding: 24px 28px;
      max-width: 460px;
      margin: 0 auto 32px;
      box-shadow: 0 8px 32px rgba(37,99,235,.12);
    }
    .hero-cta-block p {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 14px;
    }
    .hero-cta-block strong { color: var(--text); }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 13px 28px;
      border-radius: var(--radius);
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      transition: all .2s;
      cursor: pointer;
      border: none;
    }
    .btn-primary {
      background: var(--primary);
      color: #fff;
      width: 100%;
      justify-content: center;
      font-size: 16px;
      padding: 15px;
    }
    .btn-primary:hover {
      background: var(--primary-h);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(37,99,235,.35);
    }
    .btn-outline {
      background: #fff;
      color: var(--primary);
      border: 2px solid var(--primary);
    }
    .btn-outline:hover { background: var(--primary); color: #fff; }
    .btn-full { width: 100%; justify-content: center; }

    /* Badges de confiance sous le CTA */
    .trust-badges {
      display: flex;
      justify-content: center;
      gap: 20px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    .trust-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--success);
      font-weight: 600;
    }

    /* ─── "CE SITE EST PRÊT POUR VOUS" (nouveau) ────────── */
    .ready-banner {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 10px;
      padding: 20px 24px;
      max-width: 660px;
      margin: 0 auto 28px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
      text-align: left;
    }
    .ready-banner .icon { font-size: 32px; flex-shrink: 0; }
    .ready-banner h3 { font-size: 16px; font-weight: 700; color: #166534; margin-bottom: 4px; }
    .ready-banner p  { font-size: 13px; color: #15803d; line-height: 1.5; }

    /* ─── ARGUMENTS RAPIDES (nouveau) ───────────────────── */
    .quick-args {
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 32px;
    }
    .quick-arg {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 6px 16px;
      font-size: 13px;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ─── SECTIONS ──────────────────────────────────────── */
    section { padding: 64px 24px; }
    .container { max-width: 1100px; margin: 0 auto; }
    .section-label {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .12em;
      color: var(--primary);
      margin-bottom: 10px;
    }
    .section-title {
      font-size: clamp(22px, 3.5vw, 32px);
      font-weight: 700;
      margin-bottom: 14px;
    }
    .section-subtitle {
      font-size: 16px;
      color: var(--text-muted);
      max-width: 560px;
      line-height: 1.7;
    }

    /* ─── SERVICES ──────────────────────────────────────── */
    #services { background: var(--bg-light); }
    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
      margin-top: 40px;
    }
    .service-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
      transition: box-shadow .2s, transform .2s;
    }
    .service-card:hover { box-shadow: var(--shadow); transform: translateY(-2px); }
    .service-icon {
      font-size: 26px;
      flex-shrink: 0;
      width: 50px;
      height: 50px;
      background: rgba(37,99,235,.08);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .service-text { font-size: 14px; color: var(--text-muted); line-height: 1.6; }

    /* ─── BENEFITS ──────────────────────────────────────── */
    .benefits-layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 60px;
      align-items: center;
      margin-top: 40px;
    }
    .benefits-visual {
      background: linear-gradient(135deg, #eff6ff, #dbeafe);
      border-radius: 16px;
      padding: 40px;
      text-align: center;
      font-size: 64px;
    }
    .benefits-list { list-style: none; display: flex; flex-direction: column; gap: 14px; }
    .benefits-list li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 15px;
      line-height: 1.5;
    }
    .benefits-list li::before {
      content: '✓';
      background: var(--primary);
      color: #fff;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }

    /* ─── TESTIMONIALS ──────────────────────────────────── */
    #testimonials { background: var(--bg-light); }
    .testimonials-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-top: 40px;
    }
    .testimonial-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      position: relative;
    }
    .testimonial-card::before {
      content: '"';
      font-size: 56px;
      font-family: Georgia, serif;
      color: var(--primary);
      opacity: .15;
      position: absolute;
      top: 8px;
      left: 16px;
      line-height: 1;
    }
    .testimonial-text {
      font-size: 14px;
      line-height: 1.7;
      color: var(--text);
      margin-bottom: 14px;
      padding-top: 16px;
    }
    .testimonial-author { font-size: 13px; font-weight: 600; color: var(--primary); }

    /* ─── CTA SECTION FINALE (améliorée) ────────────────── */
    #contact {
      background: linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%);
      text-align: center;
    }
    #contact .section-label { color: #93c5fd; }
    #contact .section-title  { color: #fff; }
    #contact .section-subtitle { color: rgba(255,255,255,.75); margin: 0 auto 32px; }

    .contact-cta-box {
      background: rgba(255,255,255,.1);
      border: 1px solid rgba(255,255,255,.2);
      border-radius: 12px;
      padding: 32px;
      max-width: 500px;
      margin: 0 auto 28px;
    }
    .contact-cta-box p {
      color: rgba(255,255,255,.85);
      font-size: 15px;
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .btn-white {
      background: #fff;
      color: var(--primary);
      font-size: 16px;
      padding: 15px 32px;
      width: 100%;
      justify-content: center;
      font-weight: 700;
    }
    .btn-white:hover {
      background: #f0f9ff;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(0,0,0,.2);
    }
    .btn-ghost-white {
      background: transparent;
      color: #fff;
      border: 2px solid rgba(255,255,255,.4);
      margin-top: 12px;
      width: 100%;
      justify-content: center;
    }
    .btn-ghost-white:hover {
      background: rgba(255,255,255,.1);
      border-color: rgba(255,255,255,.7);
    }

    .contact-info {
      display: flex;
      justify-content: center;
      gap: 24px;
      flex-wrap: wrap;
      margin-top: 24px;
    }
    .contact-item {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(255,255,255,.12);
      padding: 8px 16px;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
    }

    /* ─── FOOTER ─────────────────────────────────────────── */
    footer {
      background: #0f172a;
      color: #9ca3af;
      text-align: center;
      padding: 28px;
      font-size: 13px;
    }
    footer strong { color: #fff; }

    /* ─── RESPONSIVE ─────────────────────────────────────── */
    @media (max-width: 768px) {
      .nav-links { display: none; }
      .benefits-layout { grid-template-columns: 1fr; }
      .benefits-visual { display: none; }
      .urgency-bar { font-size: 12px; }
      .ready-banner { flex-direction: column; }
    }
  </style>
</head>
<body>

  <!-- BANDEAU URGENCE -->
  <div class="urgency-bar">
    ⚡ Ce site a été créé spécialement pour <span>{{name}}</span> à {{city}} — consultez-le gratuitement
  </div>

  <!-- NAVIGATION -->
  <header>
    <nav>
      <a href="#" class="nav-brand">{{name}}</a>
      <ul class="nav-links">
        <li><a href="#services">Services</a></li>
        <li><a href="#avantages">Avantages</a></li>
        <li><a href="#avis">Avis clients</a></li>
        <li><a href="#contact" class="nav-cta">📞 Nous contacter</a></li>
      </ul>
    </nav>
  </header>

  <!-- HERO -->
  <section class="hero">
    <div class="container">

      <!-- Badge localisation -->
      <div class="hero-badge">📍 {{city}} — {{activity}}</div>

      <h1>{{heroTitle}}</h1>
      <p class="subtitle">{{heroSubtitle}}</p>

      <!-- Bloc "site prêt pour vous" -->
      <div class="ready-banner">
        <div class="icon">🎯</div>
        <div>
          <h3>Ce site est déjà prêt pour vous</h3>
          <p>Il a été conçu spécialement pour <strong>{{name}}</strong>, {{activity}} à <strong>{{city}}</strong>.
          Contenu personnalisé, design professionnel, optimisé pour vos clients locaux.</p>
        </div>
      </div>

      <!-- Arguments rapides -->
      <div class="quick-args">
        <div class="quick-arg">⚡ Livré en 24h</div>
        <div class="quick-arg">✅ Sans effort de votre côté</div>
        <div class="quick-arg">📱 Adapté mobile</div>
        <div class="quick-arg">🎯 Clients de {{city}}</div>
      </div>

      <!-- CTA principal — visible immédiatement -->
      <div class="hero-cta-block">
        <p><strong>Ce site vous intéresse ?</strong><br>Contactez-nous pour le récupérer ou le personnaliser.</p>
        {{#if email}}
        <a href="mailto:{{email}}?subject=Je suis intéressé par mon site démo" class="btn btn-primary">
          ✉️ Répondre par email
        </a>
        {{/if}}
        {{#if phone}}
        <a href="tel:{{phone}}" class="btn btn-primary" style="margin-top:10px">
          📞 Appeler maintenant — {{phone}}
        </a>
        {{/if}}
        {{#if !email}}{{#if !phone}}
        <a href="#contact" class="btn btn-primary">
          💬 Nous contacter
        </a>
        {{/if}}{{/if}}
        <div class="trust-badges">
          <div class="trust-item">✓ Gratuit &amp; sans engagement</div>
          <div class="trust-item">✓ Réponse sous 24h</div>
          <div class="trust-item">✓ Aucun abonnement</div>
        </div>
      </div>

    </div>
  </section>

  <!-- SERVICES -->
  <section id="services">
    <div class="container">
      <div class="section-label">Nos prestations</div>
      <h2 class="section-title">Ce que nous proposons à {{city}}</h2>
      <p class="section-subtitle">Des solutions concrètes pour vos clients locaux, réalisées par des professionnels.</p>
      <div class="services-grid">
        {{services}}
      </div>
    </div>
  </section>

  <!-- BENEFITS -->
  <section id="avantages">
    <div class="container">
      <div class="benefits-layout">
        <div>
          <div class="section-label">Pourquoi nous choisir</div>
          <h2 class="section-title">Nos atouts à {{city}}</h2>
          {{benefits}}
          <a href="#contact" class="btn btn-primary" style="margin-top:28px;display:inline-flex">
            Obtenir un devis →
          </a>
        </div>
        <div class="benefits-visual">🏆</div>
      </div>
    </div>
  </section>

  <!-- TESTIMONIALS -->
  <section id="avis">
    <div class="container">
      <div class="section-label">Ce que disent nos clients</div>
      <h2 class="section-title">Ils nous font confiance à {{city}}</h2>
      <div class="testimonials-grid">
        {{testimonials}}
      </div>
    </div>
  </section>

  <!-- CTA FINALE (renforcée) -->
  <section id="contact">
    <div class="container">
      <div class="section-label">Passez à l'action</div>
      <h2 class="section-title">{{cta}}</h2>
      <p class="section-subtitle">Devis gratuit, sans engagement. Réponse sous 24h.</p>

      <div class="contact-cta-box">
        <p>Vous êtes <strong>{{activity}}</strong> à <strong>{{city}}</strong> et ce site vous intéresse ? Contactez-nous — c'est gratuit.</p>
        {{#if email}}
        <a href="mailto:{{email}}?subject=Intéressé par mon site démo AutoDemo" class="btn btn-white">
          ✉️ Écrire à {{email}}
        </a>
        {{/if}}
        {{#if phone}}
        <a href="tel:{{phone}}" class="btn btn-ghost-white">
          📞 Appeler — {{phone}}
        </a>
        {{/if}}
      </div>

      <div class="contact-info">
        <div class="contact-item">📍 Basé à {{city}}</div>
        <div class="contact-item">✅ Devis gratuit</div>
        <div class="contact-item">⚡ Réponse rapide</div>
        <div class="contact-item">🔒 Sans engagement</div>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer>
    <p>
      © {{year}} <strong>{{name}}</strong> — {{activity}} à {{city}}
    </p>
  </footer>

</body>
</html>
