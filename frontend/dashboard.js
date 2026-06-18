    const API_BASE = window.API_BASE || 'http://localhost:3000';

    // ── Auth ──────────────────────────────────────────────────────────────────
    // L'authentification repose sur le cookie HttpOnly (envoyé automatiquement
    // en same-origin). Aucun JWT en localStorage → pas de vol de token via XSS.
    // 'user' n'est qu'un cache d'affichage ; la vraie autorité est le cookie.
    let storedUser = {};
    try { storedUser = JSON.parse(localStorage.getItem('user') || '{}'); } catch {}
    if (!storedUser.email) { window.location.href = '/login'; throw new Error('Not authenticated'); }

    document.getElementById('userEmail').textContent = storedUser.email || 'Utilisateur';

    function logout(revokeServer = false) {
      const cleanup = () => {
        localStorage.removeItem('user');
        window.location.href = '/login';
      };
      if (revokeServer) {
        // Révoque le token serveur (blocklist) + efface le cookie HttpOnly
        fetch(`${API_BASE}/users/logout`, {
          method: 'POST',
          credentials: 'same-origin',
        }).catch(() => {}).finally(cleanup);
      } else {
        cleanup();
      }
    }
    document.getElementById('logoutBtn').addEventListener('click', () => logout(true));

    // ── API helpers ───────────────────────────────────────────────────────────
    // credentials:'same-origin' → le cookie d'auth part avec chaque requête.
    async function apiFetch(path, options = {}) {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      if (res.status === 401) { logout(); throw new Error('Session expirée'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data.data;
    }

    // Variante qui retourne le corps complet (pour la pagination)
    async function apiFetchFull(path, options = {}) {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      if (res.status === 401) { logout(); throw new Error('Session expirée'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }

    // ── Toast ─────────────────────────────────────────────────────────────────
    function showToast(msg, type = 'info') {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = `toast toast-${type}`;
      clearTimeout(t._to);
      t._to = setTimeout(() => t.classList.add('hidden'), 3500);
    }

    // ── Credits ───────────────────────────────────────────────────────────────
    async function loadCredits() {
      try {
        const { credits } = await apiFetch('/sites/credits');
        document.getElementById('creditsCount').textContent = credits;
        const b = document.getElementById('creditsBadge');
        b.className = `credits-chip ${credits <= 2 ? 'low' : credits <= 5 ? 'mid' : ''}`;
      } catch {}
    }

    // ── Tab switching ─────────────────────────────────────────────────────────
    function switchTab(name) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById(`panel-${name}`).classList.add('active');
      document.querySelector(`[data-tab="${name}"]`).classList.add('active');

      if (name === 'overview') loadOverview();
      if (name === 'leads')    loadLeads();
      if (name === 'sites')    loadSites();
      if (name === 'account')  loadAccount();
      if (name === 'integrations') loadFeatures();
    }

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => switchTab(item.dataset.tab));
    });
    document.getElementById('refreshOverview').addEventListener('click', loadOverview);

    // ─────────────────────────────────────────────────────────────────────────
    // OVERVIEW
    // ─────────────────────────────────────────────────────────────────────────

    async function loadOverview() {
      try {
        const d = await apiFetch('/dashboard');
        const s = d.summary;

        // Metrics
        document.getElementById('m-leads').textContent  = s.total_leads;
        document.getElementById('m-sites').textContent  = s.total_sites;
        document.getElementById('m-views').textContent  = s.total_views;
        document.getElementById('m-conv').textContent   = s.conversion_rate + '%';
        document.getElementById('m-active').textContent = s.active_sites;
        document.getElementById('m-errors').textContent = s.leads_error;

        document.getElementById('m-leads-sub').textContent =
          `${s.leads_done} convertis · ${s.leads_pending} en attente`;
        document.getElementById('m-sites-sub').textContent =
          `${s.active_sites} actifs (7j)`;
        document.getElementById('m-views-sub').textContent =
          `${s.active_sites} sites avec visites récentes`;

        // Onboarding : visible uniquement tant qu'il n'y a aucun lead
        document.getElementById('onboarding').classList.toggle('hidden', s.total_leads > 0);

        // Prospects chauds
        renderHotLeads(d.hot_leads || []);

        // Performance emails
        renderEmailStats(d.email_stats);

        // Top sites
        renderTopSites(d.top_sites);

        // Unconverted leads
        renderUnconverted(d.unconverted_leads);
        document.getElementById('unconvertedCount').textContent = d.unconverted_leads.length;

        // Sparkline
        renderSparkline(d.recent_activity);

      } catch (err) {
        showToast('Erreur chargement métriques: ' + err.message, 'error');
      }
    }

    function renderHotLeads(hotLeads) {
      const el = document.getElementById('hotLeadsBody');
      document.getElementById('hotLeadsCount').textContent = hotLeads.length;
      if (!hotLeads.length) {
        el.innerHTML = '<div class="empty-state" style="padding:20px"><span class="empty-icon">📭</span><p>Aucun formulaire reçu pour l\'instant. Quand un prospect remplit le formulaire d\'une démo, il apparaît ici.</p></div>';
        return;
      }
      el.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Prospect</th><th>Contact</th><th>Message</th><th>Démo</th><th>Reçu</th><th>Action</th></tr></thead>
          <tbody>
            ${hotLeads.map(h => {
              const m = h.meta || {};
              const ageMs    = Date.now() - new Date(h.created_at + 'Z').getTime();
              const isUrgent = h.pipeline === 'rappeler';
              const isStale  = isUrgent && ageMs > 3_600_000; // +1h non rappelé
              const ageH     = Math.floor(ageMs / 3_600_000);
              return `
                <tr style="${isStale ? 'background:rgba(248,113,113,.07)' : ''}">
                  <td>
                    <div style="font-weight:600;font-size:13px">${esc(m.name || '—')}
                      ${isStale ? `<span class="badge badge-red" style="margin-left:6px">⏳ ${ageH}h</span>` : ''}
                      ${!isUrgent && h.pipeline ? `<span class="badge badge-muted" style="margin-left:6px">${esc(h.pipeline)}</span>` : ''}
                    </div>
                    <div style="font-size:11px;color:var(--muted)">via ${esc(h.lead_name || h.slug || '')}</div>
                  </td>
                  <td style="font-size:12px">
                    ${m.phone ? `<a href="tel:${esc(m.phone)}" style="color:var(--green,#16a34a);font-weight:600">📞 ${esc(m.phone)}</a><br>` : ''}
                    ${m.email ? `<a href="mailto:${esc(m.email)}">✉️ ${esc(m.email)}</a>` : ''}
                  </td>
                  <td style="font-size:12px;color:var(--muted);max-width:200px">${esc(m.message || '—')}</td>
                  <td>${h.url ? `<a href="${esc(h.url)}" target="_blank" class="btn btn-ghost btn-xs">↗</a>` : '—'}</td>
                  <td style="font-size:11px;color:var(--muted)">${formatDate(h.created_at)}</td>
                  <td>
                    ${isUrgent && h.lead_id
                      ? `<button class="btn btn-green btn-xs treat-btn" data-lead="${h.lead_id}">✓ Traité</button>`
                      : ''}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`;

      // "Traité" = rappelé : sort du tri urgent, la séquence reste stoppée
      el.querySelectorAll('.treat-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await apiFetch(`/leads/${btn.dataset.lead}`, {
              method: 'PATCH', body: JSON.stringify({ pipeline: 'contacte' }),
            });
            showToast('✓ Prospect marqué comme traité', 'success');
            loadOverview();
          } catch (err) {
            showToast('Erreur: ' + err.message, 'error');
            btn.disabled = false;
          }
        });
      });
    }

    function renderEmailStats(stats) {
      const el = document.getElementById('emailStatsBody');
      const badge = document.getElementById('emailSeqBadge');
      if (!stats) { el.innerHTML = ''; return; }

      badge.textContent = `${stats.sequence.pending} programmé(s)`;

      if (!stats.totals.sent) {
        el.innerHTML = '<div class="empty-state" style="padding:20px"><span class="empty-icon">📨</span><p>Aucun email envoyé pour l\'instant. La séquence démarre automatiquement après chaque génération (si le lead a un email pro et que SMTP est configuré).</p></div>';
        return;
      }

      const t = stats.totals;
      el.innerHTML = `
        <div style="display:flex;gap:24px;padding:16px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <div><div class="metric-label">Envoyés</div><div style="font-size:22px;font-weight:700;font-family:var(--mono)">${t.sent}</div></div>
          <div><div class="metric-label">Taux d'ouverture</div><div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--primary)">${t.open_rate}%</div></div>
          <div><div class="metric-label">Taux de clic</div><div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--green)">${t.click_rate}%</div></div>
        </div>
        <table class="data-table">
          <thead><tr><th>Variante</th><th>Envoyés</th><th>Ouvertures</th><th>Clics</th></tr></thead>
          <tbody>
            ${stats.by_variant.map(v => `
              <tr>
                <td style="font-weight:600">${esc(v.variant)}</td>
                <td class="text-mono">${v.sent}</td>
                <td>
                  <div class="rate-bar">
                    <div class="rate-track"><div class="rate-fill" style="width:${Math.min(100, v.open_rate)}%;background:var(--primary)"></div></div>
                    <span style="font-size:12px;font-family:var(--mono);min-width:46px;text-align:right">${v.open_rate}%</span>
                  </div>
                </td>
                <td>
                  <div class="rate-bar">
                    <div class="rate-track"><div class="rate-fill" style="width:${Math.min(100, v.click_rate)}%;background:var(--green)"></div></div>
                    <span style="font-size:12px;font-family:var(--mono);min-width:46px;text-align:right">${v.click_rate}%</span>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    }

    function renderTopSites(sites) {
      const el = document.getElementById('topSitesBody');
      if (!sites.length) {
        el.innerHTML = '<div class="empty-state" style="padding:24px"><span class="empty-icon">🌐</span><p>Aucun site visité</p></div>';
        return;
      }
      const maxViews = Math.max(...sites.map(s => s.views || 0), 1);
      el.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Site</th><th>Vues</th><th>Statut</th><th>Action</th></tr></thead>
          <tbody>
            ${sites.map(s => {
              const pct = Math.round(((s.views || 0) / maxViews) * 100);
              const daysSince = s.last_viewed
                ? Math.floor((Date.now() - new Date(s.last_viewed)) / 86400000)
                : null;
              let statusClass = 'inactive', statusLabel = 'Inactif';
              if (daysSince === null) { statusClass = 'inactive'; statusLabel = 'Jamais vu'; }
              else if (daysSince <= 3) { statusClass = 'active'; statusLabel = 'Actif'; }
              else if (daysSince <= 14) { statusClass = 'idle'; statusLabel = 'Tiède'; }
              return `
                <tr>
                  <td>
                    <div style="font-weight:600;font-size:13px">${esc(s.lead_name)}</div>
                    <div style="font-size:11px;color:var(--muted)">${esc(s.city)}</div>
                  </td>
                  <td>
                    <div class="views-bar">
                      <div class="views-track"><div class="views-fill" style="width:${pct}%"></div></div>
                      <div class="views-count">${s.views}</div>
                    </div>
                  </td>
                  <td><span class="status-dot ${statusClass}">${statusLabel}</span></td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <a href="${s.url}" target="_blank" class="btn btn-ghost btn-xs">↗</a>
                      ${s.lead_email
                        ? `<button class="btn btn-green btn-xs" data-action="resend" data-site="${esc(s.id)}" data-name="${esc(s.lead_name)}" data-email="${esc(s.lead_email)}">✉️ Relancer</button>`
                        : '<span style="font-size:11px;color:var(--dim)">Pas d\'email</span>'}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>`;
    }

    function renderUnconverted(leads) {
      const el = document.getElementById('unconvertedBody');
      if (!leads.length) {
        el.innerHTML = '<div class="empty-state" style="padding:24px"><span class="empty-icon">🎉</span><p>Tous les leads ont un site !</p></div>';
        return;
      }
      el.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Lead</th><th>Statut</th><th>Action</th></tr></thead>
          <tbody>
            ${leads.map(l => `
              <tr>
                <td>
                  <div style="font-weight:600;font-size:13px">${esc(l.name)}</div>
                  <div style="font-size:11px;color:var(--muted)">${esc(l.city)}</div>
                </td>
                <td>
                  ${l.status === 'processing'
                    ? '<span class="badge badge-blue">⏳ En cours</span>'
                    : '<span class="badge badge-muted">En attente</span>'}
                </td>
                <td>
                  <button class="btn btn-primary btn-xs generate-ov" data-id="${l.id}" data-name="${esc(l.name)}">
                    ⚡ Générer
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
      el.querySelectorAll('.generate-ov').forEach(btn => {
        btn.addEventListener('click', () => openGenerateModal(btn.dataset.id, btn.dataset.name));
      });
    }

    function renderSparkline(activity) {
      const el = document.getElementById('sparkline');
      if (!activity.length) {
        el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">Aucune activité récente</div>';
        return;
      }
      // Build day map for last 7 days
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
      }
      const map = {};
      activity.forEach(r => { map[r.day] = (map[r.day] || 0) + r.leads_created; });
      const values = days.map(d => map[d] || 0);
      const max = Math.max(...values, 1);

      el.innerHTML = values.map((v, i) => `
        <div class="spark-bar" style="height:${Math.max(3, (v / max) * 100)}%" title="${days[i]}: ${v} lead(s)"></div>
      `).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LEADS
    // ─────────────────────────────────────────────────────────────────────────

    const STATUS_LABELS = {
      pending:    { label: 'En attente',  cls: 'badge-amber'  },
      processing: { label: 'En cours…',   cls: 'badge-blue'   },
      done:       { label: 'Généré ✓',    cls: 'badge-green'  },
      error:      { label: 'Erreur',      cls: 'badge-red'    },
    };

    const PIPELINE_OPTIONS = [
      { value: 'nouveau',   label: '🆕 Nouveau' },
      { value: 'contacte',  label: '📤 Contacté' },
      { value: 'interesse', label: '👀 Intéressé' },
      { value: 'rappeler',  label: '📞 À rappeler' },
      { value: 'converti',  label: '✅ Converti' },
      { value: 'perdu',     label: '❌ Perdu' },
    ];

    let leadsPage = 1;
    const LEADS_PER_PAGE = 25;

    async function loadLeads(page = leadsPage) {
      leadsPage = page;
      const loading = document.getElementById('leadsLoading');
      const empty   = document.getElementById('leadsEmpty');
      const table   = document.getElementById('leadsTable');
      loading.classList.remove('hidden');
      empty.classList.add('hidden');
      table.classList.add('hidden');

      try {
        const body  = await apiFetchFull(`/leads?page=${page}&limit=${LEADS_PER_PAGE}`);
        const leads = body.data;
        const pag   = body.pagination || { page: 1, pages: 1, total: leads.length };
        document.getElementById('leadsCount').textContent = pag.total;

        if (!leads.length && page === 1) {
          empty.classList.remove('hidden');
          return;
        }
        const tbody = document.getElementById('leadsBody');
        tbody.innerHTML = leads.map(l => {
          const st = STATUS_LABELS[l.status] || { label: l.status, cls: 'badge-muted' };
          const noteTitle = l.note ? esc(l.note) : 'Ajouter une note';
          return `
            <tr>
              <td><strong>${esc(l.name)}</strong></td>
              <td>${esc(l.activity)}</td>
              <td>${esc(l.city)}</td>
              <td><span class="badge ${st.cls}">${st.label}</span></td>
              <td>
                <select class="pipeline-select" data-id="${l.id}">
                  ${PIPELINE_OPTIONS.map(o =>
                    `<option value="${o.value}" ${(l.pipeline || 'nouveau') === o.value ? 'selected' : ''}>${o.label}</option>`
                  ).join('')}
                </select>
              </td>
              <td>
                <button class="btn btn-ghost btn-xs note-btn" data-id="${l.id}" data-note="${esc(l.note || '')}" title="${noteTitle}">
                  ${l.note ? '📝' : '➕'}
                </button>
                <button class="btn btn-ghost btn-xs tl-btn" data-id="${l.id}" data-name="${esc(l.name)}" title="Historique du prospect">📜</button>
              </td>
              <td>
                ${l.status === 'done'
                  ? `<button class="btn btn-ghost btn-xs" data-action="switch-tab" data-tab="sites">Voir →</button>`
                  : `<button class="btn btn-primary btn-xs generate-btn" data-id="${l.id}" data-name="${esc(l.name)}">⚡ Générer</button>`}
              </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.generate-btn').forEach(btn => {
          btn.addEventListener('click', () => openGenerateModal(btn.dataset.id, btn.dataset.name));
        });

        // Suivi commercial : changement immédiat, sans rechargement
        tbody.querySelectorAll('.pipeline-select').forEach(sel => {
          sel.addEventListener('change', async () => {
            try {
              await apiFetch(`/leads/${sel.dataset.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ pipeline: sel.value }),
              });
              showToast('Suivi mis à jour', 'success');
            } catch (err) {
              showToast('Erreur: ' + err.message, 'error');
            }
          });
        });

        tbody.querySelectorAll('.tl-btn').forEach(btn => {
          btn.addEventListener('click', () => openTimeline(btn.dataset.id, btn.dataset.name));
        });

        tbody.querySelectorAll('.note-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const current = btn.dataset.note || '';
            const note = prompt('Note sur ce prospect :', current);
            if (note === null) return;
            try {
              await apiFetch(`/leads/${btn.dataset.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ note }),
              });
              btn.dataset.note = note;
              btn.textContent = note ? '📝' : '➕';
              btn.title = note || 'Ajouter une note';
              showToast('Note enregistrée', 'success');
            } catch (err) {
              showToast('Erreur: ' + err.message, 'error');
            }
          });
        });

        // Pagination
        const pagEl = document.getElementById('leadsPagination');
        pagEl.innerHTML = pag.pages > 1 ? `
          <button class="btn btn-ghost btn-xs" ${pag.page <= 1 ? 'disabled' : ''} data-action="load-leads" data-page="${pag.page - 1}">← Précédent</button>
          <span>Page ${pag.page} / ${pag.pages} · ${pag.total} leads</span>
          <button class="btn btn-ghost btn-xs" ${pag.page >= pag.pages ? 'disabled' : ''} data-action="load-leads" data-page="${pag.page + 1}">Suivant →</button>
        ` : '';

        table.classList.remove('hidden');
      } catch (err) {
        showToast('Erreur: ' + err.message, 'error');
      } finally {
        loading.classList.add('hidden');
      }
    }
    document.getElementById('refreshLeadsBtn').addEventListener('click', () => loadLeads(1));

    // ─────────────────────────────────────────────────────────────────────────
    // SITES
    // ─────────────────────────────────────────────────────────────────────────

    async function loadSites() {
      const loading = document.getElementById('sitesLoading');
      const empty   = document.getElementById('sitesEmpty');
      const grid    = document.getElementById('sitesGrid');
      loading.classList.remove('hidden');
      empty.classList.add('hidden');
      grid.classList.add('hidden');
      grid.innerHTML = '';

      try {
        const sites = await apiFetch('/sites');
        document.getElementById('sitesCount').textContent = sites.length;

        if (!sites.length) { empty.classList.remove('hidden'); return; }

        grid.innerHTML = sites.map(site => {
          const daysSince = site.last_viewed
            ? Math.floor((Date.now() - new Date(site.last_viewed)) / 86400000)
            : null;
          let statusClass = 'inactive', statusLabel = 'Jamais vu';
          if (daysSince !== null) {
            if (daysSince <= 3) { statusClass = 'active'; statusLabel = 'Actif'; }
            else if (daysSince <= 14) { statusClass = 'idle'; statusLabel = 'Tiède'; }
            else { statusClass = 'inactive'; statusLabel = 'Inactif'; }
          }
          return `
            <div class="site-card">
              <div class="site-card-top">
                <div class="site-card-name">${esc(site.lead_name || 'Lead')}</div>
                <span class="status-dot ${statusClass}">${statusLabel}</span>
              </div>
              <div class="site-card-meta">📍 ${esc(site.city || '')} &nbsp;·&nbsp; 👁 ${site.views ?? 0} vue${site.views !== 1 ? 's' : ''}</div>
              <div class="site-card-url">
                <input type="text" value="${esc(site.url)}" readonly data-action="select-input" />
                <button class="btn btn-ghost btn-xs" data-action="copy" data-url="${esc(site.url)}">📋</button>
              </div>
              <div class="site-card-actions">
                <a href="${site.url}" target="_blank" class="btn btn-primary btn-xs">Voir ↗</a>
                <button class="btn btn-ghost btn-xs regen-btn" data-id="${site.id}" title="Regénérer le contenu IA (gratuit)">🔄</button>
                ${site.lead_email
                  ? `<button class="btn btn-green btn-xs" data-action="resend" data-site="${esc(site.id)}" data-name="${esc(site.lead_name)}" data-email="${esc(site.lead_email)}">✉️ Relancer</button>`
                  : ''}
              </div>
            </div>`;
        }).join('');

        // Régénération : nouveau contenu IA, même URL, sans crédit
        grid.querySelectorAll('.regen-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Régénérer le contenu de ce site ? L\'IA réécrit les textes (gratuit, l\'URL ne change pas).')) return;
            btn.disabled = true;
            btn.textContent = '⏳';
            try {
              await apiFetch(`/sites/${btn.dataset.id}/regenerate`, { method: 'POST' });
              showToast('🔄 Site régénéré !', 'success');
            } catch (err) {
              showToast('Erreur: ' + err.message, 'error');
            } finally {
              btn.disabled = false;
              btn.textContent = '🔄';
            }
          });
        });

        grid.classList.remove('hidden');
      } catch (err) {
        showToast('Erreur: ' + err.message, 'error');
      } finally {
        loading.classList.add('hidden');
      }
    }
    document.getElementById('refreshSitesBtn').addEventListener('click', loadSites);

    // ─────────────────────────────────────────────────────────────────────────
    // GENERATE MODAL
    // ─────────────────────────────────────────────────────────────────────────

    let pendingLeadId = null;

    // ── Templates ─────────────────────────────────────────────────────────────
    let templatesCache = [];

    async function loadTemplatesIntoSelect() {
      const select = document.getElementById('templateSelect');
      if (!templatesCache.length) {
        try { templatesCache = await apiFetch('/templates'); }
        catch { templatesCache = [{ id: 'moderne', label: 'Moderne', description: '' }]; }
      }
      select.innerHTML = templatesCache
        .map(t => `<option value="${t.id}">${t.label}</option>`)
        .join('');
      updateTemplateDesc();
    }

    function updateTemplateDesc() {
      const select = document.getElementById('templateSelect');
      const tpl = templatesCache.find(t => t.id === select.value);
      document.getElementById('templateDesc').textContent = tpl?.description || '';
    }

    document.getElementById('templateSelect').addEventListener('change', updateTemplateDesc);

    function openGenerateModal(leadId, leadName) {
      pendingLeadId = leadId;
      loadTemplatesIntoSelect();
      document.getElementById('generateModalInfo').textContent = `Générer un site pour "${leadName}" ? Cela consommera 1 crédit.`;
      document.getElementById('generateModalError').classList.add('hidden');
      document.getElementById('generateModalLoading').classList.add('hidden');
      document.getElementById('generateModalActions').classList.remove('hidden');
      document.getElementById('generateModal').classList.remove('hidden');
    }

    document.getElementById('cancelGenerateBtn').addEventListener('click', () => {
      document.getElementById('generateModal').classList.add('hidden');
      pendingLeadId = null;
    });

    document.getElementById('generateModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById('generateModal').classList.add('hidden');
    });

    document.getElementById('confirmGenerateBtn').addEventListener('click', async () => {
      if (!pendingLeadId) return;
      const actions = document.getElementById('generateModalActions');
      const loading = document.getElementById('generateModalLoading');
      const errEl   = document.getElementById('generateModalError');
      actions.classList.add('hidden');
      loading.classList.remove('hidden');
      errEl.classList.add('hidden');
      try {
        await apiFetch('/generate', {
          method: 'POST',
          body: JSON.stringify({
            leadId:     pendingLeadId,
            templateId: document.getElementById('templateSelect').value || 'moderne',
          }),
        });
        document.getElementById('generateModal').classList.add('hidden');
        showToast('✅ Site généré !', 'success');
        await loadCredits();
        loadOverview();
        switchTab('sites');
      } catch (err) {
        loading.classList.add('hidden');
        actions.classList.remove('hidden');
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // RESEND MODAL
    // ─────────────────────────────────────────────────────────────────────────

    let pendingSiteId = null;

    function openResendModal(siteId, leadName, email) {
      pendingSiteId = siteId;
      document.getElementById('resendModalInfo').textContent = `Relancer "${leadName}" à ${email} ?`;
      document.getElementById('resendModalError').classList.add('hidden');
      document.getElementById('resendModalLoading').classList.add('hidden');
      document.getElementById('resendModalActions').classList.remove('hidden');
      document.getElementById('resendModal').classList.remove('hidden');
    }

    document.getElementById('cancelResendBtn').addEventListener('click', () => {
      document.getElementById('resendModal').classList.add('hidden');
      pendingSiteId = null;
    });
    document.getElementById('resendModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById('resendModal').classList.add('hidden');
    });

    document.getElementById('confirmResendBtn').addEventListener('click', async () => {
      if (!pendingSiteId) return;
      const actions = document.getElementById('resendModalActions');
      const loading = document.getElementById('resendModalLoading');
      const errEl   = document.getElementById('resendModalError');
      actions.classList.add('hidden');
      loading.classList.remove('hidden');
      errEl.classList.add('hidden');
      try {
        await apiFetch(`/resend/${pendingSiteId}`, { method: 'POST' });
        document.getElementById('resendModal').classList.add('hidden');
        showToast('✉️ Email envoyé !', 'success');
      } catch (err) {
        loading.classList.add('hidden');
        actions.classList.remove('hidden');
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ADD LEAD FORM
    // ─────────────────────────────────────────────────────────────────────────

    document.getElementById('addLeadForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('addLeadBtn');
      const msg = document.getElementById('addLeadMsg');
      const payload = {
        name:     document.getElementById('leadName').value.trim(),
        activity: document.getElementById('leadActivity').value.trim(),
        city:     document.getElementById('leadCity').value.trim(),
        email:    document.getElementById('leadEmail').value.trim() || undefined,
        phone:    document.getElementById('leadPhone').value.trim() || undefined,
      };
      btn.disabled = true;
      btn.textContent = '⏳…';
      msg.classList.add('hidden');
      try {
        await apiFetch('/leads', { method: 'POST', body: JSON.stringify(payload) });
        showToast('✅ Lead ajouté !', 'success');
        e.target.reset();
        msg.textContent = '✅ Lead ajouté avec succès !';
        msg.className = 'form-msg form-msg-success';
        msg.classList.remove('hidden');
      } catch (err) {
        msg.textContent = '❌ ' + err.message;
        msg.className = 'form-msg form-msg-error';
        msg.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = '➕ Ajouter';
      }
    });

    document.getElementById('importJsonBtn').addEventListener('click', async () => {
      const raw = document.getElementById('jsonImport').value.trim();
      const msg = document.getElementById('importMsg');
      const btn = document.getElementById('importJsonBtn');
      if (!raw) { msg.textContent = '⚠️ Collez du JSON'; msg.className = 'form-msg form-msg-error'; msg.classList.remove('hidden'); return; }
      let leads;
      try { leads = JSON.parse(raw); if (!Array.isArray(leads)) throw new Error('Tableau attendu'); }
      catch (err) { msg.textContent = '❌ JSON invalide: ' + err.message; msg.className = 'form-msg form-msg-error'; msg.classList.remove('hidden'); return; }
      btn.disabled = true; btn.textContent = '⏳…'; msg.classList.add('hidden');
      let ok = 0, fail = 0;
      for (const l of leads) {
        try { await apiFetch('/leads', { method: 'POST', body: JSON.stringify(l) }); ok++; }
        catch { fail++; }
      }
      msg.textContent = `✅ ${ok} importé(s), ❌ ${fail} erreur(s).`;
      msg.className = `form-msg ${fail ? 'form-msg-error' : 'form-msg-success'}`;
      msg.classList.remove('hidden');
      btn.disabled = false; btn.textContent = '📥 Importer';
      if (ok) document.getElementById('jsonImport').value = '';
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCRAPER GOOGLE MAPS
    // ─────────────────────────────────────────────────────────────────────────

    document.getElementById('scrapeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('scrapeBtn');
      const msg = document.getElementById('scrapeMsg');
      btn.disabled = true; btn.textContent = '⏳ Lancement…'; msg.classList.add('hidden');
      try {
        const out = await apiFetch('/scrape', {
          method: 'POST',
          body: JSON.stringify({
            activity: document.getElementById('scrapeActivity').value.trim(),
            city:     document.getElementById('scrapeCity').value.trim(),
            limit:    parseInt(document.getElementById('scrapeLimit').value) || 20,
          }),
        });
        msg.textContent = '🚀 ' + out.message;
        msg.className = 'form-msg form-msg-success';
        showToast('Scraping lancé !', 'success');
      } catch (err) {
        msg.textContent = '❌ ' + err.message;
        msg.className = 'form-msg form-msg-error';
      } finally {
        msg.classList.remove('hidden');
        btn.disabled = false; btn.textContent = '🚀 Scraper';
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // CRÉDITS / BILLING
    // ─────────────────────────────────────────────────────────────────────────

    async function loadPacks() {
      const grid = document.getElementById('packsGrid');
      try {
        const packs = await apiFetch('/billing/packs');
        grid.innerHTML = packs.map(p => `
          <div class="card" style="flex:1;min-width:170px;padding:18px;text-align:center">
            <div style="font-weight:700;font-size:15px;margin-bottom:4px">${esc(p.label.split('—')[0].trim())}</div>
            <div style="font-size:26px;font-weight:800;color:var(--blue,#6366f1)">${p.credits}<span style="font-size:13px;font-weight:400;color:var(--muted)"> crédits</span></div>
            <div style="font-size:14px;color:var(--muted);margin:6px 0 12px">${p.price_eur} €</div>
            <button class="btn btn-primary btn-sm" data-action="buy-pack" data-pack="${esc(p.id)}" style="width:100%">Acheter</button>
          </div>`).join('');
      } catch {
        grid.innerHTML = '<p class="help-text">Offres indisponibles.</p>';
      }
    }

    async function buyPack(packId) {
      const msg = document.getElementById('packsMsg');
      msg.classList.add('hidden');
      try {
        const out = await apiFetch('/billing/checkout', { method: 'POST', body: JSON.stringify({ pack: packId }) });
        window.location.href = out.url; // redirection Stripe Checkout
      } catch (err) {
        msg.textContent = '❌ ' + err.message;
        msg.className = 'form-msg form-msg-error';
        msg.classList.remove('hidden');
      }
    }

    // ── Abonnements ───────────────────────────────────────────────────────────
    async function loadPlans() {
      const grid = document.getElementById('plansGrid');
      try {
        const plans = await apiFetch('/billing/plans');
        grid.innerHTML = plans.map(p => `
          <div class="card" style="flex:1;min-width:170px;padding:18px;text-align:center">
            <div style="font-weight:700;font-size:15px;margin-bottom:4px">${esc(p.label.split('—')[0].trim())}</div>
            <div style="font-size:26px;font-weight:800;color:var(--green,#34d399)">${p.credits}<span style="font-size:13px;font-weight:400;color:var(--muted)"> cr/mois</span></div>
            <div style="font-size:14px;color:var(--muted);margin:6px 0 12px">${p.price_eur} € / mois</div>
            <button class="btn btn-green btn-sm" data-action="subscribe" data-plan="${esc(p.id)}" style="width:100%">S'abonner</button>
          </div>`).join('');
      } catch {
        grid.innerHTML = '<p class="help-text">Formules indisponibles.</p>';
      }
    }

    async function subscribe(planId) {
      const msg = document.getElementById('plansMsg');
      msg.classList.add('hidden');
      try {
        const out = await apiFetch('/billing/subscribe', { method: 'POST', body: JSON.stringify({ plan: planId }) });
        window.location.href = out.url;
      } catch (err) {
        msg.textContent = '❌ ' + err.message;
        msg.className = 'form-msg form-msg-error';
        msg.classList.remove('hidden');
      }
    }

    // ── Factures + profil de facturation ──────────────────────────────────────
    async function loadInvoices() {
      const el = document.getElementById('invoicesBody');
      try {
        const inv = await apiFetch('/billing/invoices');
        if (!inv.length) { el.innerHTML = '<div class="empty-state" style="padding:24px"><p>Aucune facture pour l\'instant.</p></div>'; return; }
        el.innerHTML = `<table class="data-table">
          <thead><tr><th>Numéro</th><th>Date</th><th>Montant TTC</th><th></th></tr></thead>
          <tbody>${inv.map(i => `
            <tr>
              <td class="text-mono">${esc(i.number)}</td>
              <td style="font-size:12px;color:var(--muted)">${formatDate(i.issued_at)}</td>
              <td>${esc(i.amount_ttc_eur)} €</td>
              <td><a href="${API_BASE}/billing/invoices/${esc(i.id)}" target="_blank" class="btn btn-ghost btn-xs">📄 Voir</a></td>
            </tr>`).join('')}</tbody></table>`;
      } catch (err) {
        el.innerHTML = `<p class="form-msg form-msg-error">❌ ${esc(err.message)}</p>`;
      }
    }

    async function loadBillingProfile() {
      try {
        const p = await apiFetch('/billing/profile');
        document.getElementById('bName').value    = p.billing_name || '';
        document.getElementById('bAddress').value = p.billing_address || '';
        document.getElementById('bCountry').value = p.billing_country || '';
        document.getElementById('bVat').value     = p.vat_number || '';
        // Statut abonnement dans la carte Informations
        const sub = document.getElementById('accSub');
        const portal = document.getElementById('portalBtn');
        if (p.sub_status === 'active') {
          sub.textContent = `${p.plan || ''} (actif)`;
          portal.classList.remove('hidden');
        } else if (p.sub_status) {
          sub.textContent = `${p.plan || ''} (${p.sub_status})`;
          portal.classList.remove('hidden');
        } else {
          sub.textContent = 'aucun';
          portal.classList.add('hidden');
        }
      } catch {}
    }

    document.getElementById('saveBillingBtn').addEventListener('click', async () => {
      const msg = document.getElementById('billingMsg');
      msg.classList.add('hidden');
      try {
        await apiFetch('/billing/profile', { method: 'POST', body: JSON.stringify({
          billing_name:    document.getElementById('bName').value.trim(),
          billing_address: document.getElementById('bAddress').value.trim(),
          billing_country: document.getElementById('bCountry').value.trim(),
          vat_number:      document.getElementById('bVat').value.trim(),
        })});
        msg.textContent = '✅ Coordonnées enregistrées.';
        msg.className = 'form-msg form-msg-success';
      } catch (err) {
        msg.textContent = '❌ ' + err.message;
        msg.className = 'form-msg form-msg-error';
      }
      msg.classList.remove('hidden');
    });

    document.getElementById('portalBtn').addEventListener('click', async () => {
      try {
        const out = await apiFetch('/billing/portal', { method: 'POST' });
        window.location.href = out.url;
      } catch (err) { showToast('❌ ' + err.message, 'error'); }
    });

    // Retour de paiement Stripe
    const payStatus = new URLSearchParams(window.location.search).get('payment');
    if (payStatus === 'success')   showToast('💰 Paiement reçu — crédits ajoutés sous peu !', 'success');
    if (payStatus === 'cancelled') showToast('Paiement annulé', 'error');

    // ─────────────────────────────────────────────────────────────────────────
    // UTILS
    // ─────────────────────────────────────────────────────────────────────────

    function formatDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    function esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Lien copié !', 'success'))
        .catch(() => showToast('Impossible de copier', 'error'));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIMELINE PROSPECT
    // ─────────────────────────────────────────────────────────────────────────

    const TL_LABELS = {
      contact_form:      { icon: '🔥', label: 'Formulaire de contact rempli' },
      hot_lead_reminder: { icon: '⏰', label: 'Rappel SLA envoyé au propriétaire' },
      email_envoye:      { icon: '📤', label: 'Email de prospection envoyé' },
      email_relance:     { icon: '📬', label: 'Relance envoyée' },
      email_ouvert:      { icon: '👀', label: 'Email ouvert' },
      lien_clique:       { icon: '🖱️', label: 'Lien de la démo cliqué' },
    };

    async function openTimeline(leadId, leadName) {
      const modal = document.getElementById('timelineModal');
      const body  = document.getElementById('timelineBody');
      document.getElementById('timelineTitle').textContent = `📜 ${leadName}`;
      body.innerHTML = '<div class="loading-state">Chargement…</div>';
      modal.classList.remove('hidden');
      try {
        const d = await apiFetch(`/leads/${leadId}/timeline`);
        if (!d.timeline.length) {
          body.innerHTML = '<div class="empty-state" style="padding:20px"><p>Aucune activité pour ce prospect.</p></div>';
          return;
        }
        body.innerHTML = d.timeline.map(t => {
          const info = TL_LABELS[t.kind] || { icon: '•', label: t.kind };
          const detail = t.meta?.variant ? ` <span style="color:var(--dim)">(${esc(t.meta.variant)})</span>`
                       : t.meta?.name    ? ` — ${esc(t.meta.name)}${t.meta.phone ? ' · ' + esc(t.meta.phone) : ''}` : '';
          return `
            <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
              <span>${info.icon}</span>
              <div style="flex:1">${info.label}${detail}</div>
              <span style="font-size:11px;color:var(--muted);white-space:nowrap">${formatDate(t.at)}</span>
            </div>`;
        }).join('');
      } catch (err) {
        body.innerHTML = `<p class="form-msg form-msg-error">❌ ${esc(err.message)}</p>`;
      }
    }

    document.getElementById('closeTimelineBtn').addEventListener('click', () =>
      document.getElementById('timelineModal').classList.add('hidden'));
    document.getElementById('timelineModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // COMPTE / VÉRIFICATION EMAIL
    // ─────────────────────────────────────────────────────────────────────────

    let currentUser = null;

    // ── Intégrations (état activable de chaque étape du workflow) ─────────────
    const FEATURE_LABELS = {
      enrichment:  { icon: '✉️', title: 'Enrichissement email', desc: 'Trouve un email aux leads scrapés' },
      whatsapp:    { icon: '💬', title: 'Canal WhatsApp',        desc: 'Outreach des leads sans email (téléphone)' },
      inbound:     { icon: '📥', title: 'Réponses entrantes',    desc: 'Stoppe la séquence dès qu\'un prospect répond' },
      dkim:        { icon: '🔏', title: 'Signature DKIM',         desc: 'Délivrabilité : signe les emails sortants' },
      warmup:      { icon: '🌡️', title: 'Warmup envoi',          desc: 'Montée en charge progressive du volume' },
      demoImages:  { icon: '🖼️', title: 'Images des démos',      desc: 'Galerie de visuels sur les sites générés' },
      apmpFilter:  { icon: '🍏', title: 'Filtre Apple MPP',       desc: 'Exclut les ouvertures machine du taux humain' },
    };

    async function loadFeatures() {
      const grid = document.getElementById('featuresGrid');
      try {
        const f = await apiFetch('/features');
        grid.innerHTML = Object.entries(f).map(([key, val]) => {
          const meta = FEATURE_LABELS[key] || { icon: '🔌', title: key, desc: '' };
          const on = val.active;
          return `
            <div class="site-card" style="border-color:${on ? 'var(--green)' : 'var(--border)'}">
              <div class="site-card-top">
                <div class="site-card-name">${meta.icon} ${esc(meta.title)}</div>
                <span class="badge ${on ? 'badge-green' : 'badge-muted'}">${on ? '🟢 Active' : '⚪ Dormante'}</span>
              </div>
              <div class="site-card-meta">${esc(meta.desc)}</div>
              <div style="font-size:11px;color:var(--muted)">${esc(val.detail || '')}</div>
              ${on ? '' : `<div style="font-size:11px;color:var(--dim);font-family:var(--mono);margin-top:4px">${esc(val.enable || '')}</div>`}
            </div>`;
        }).join('');
      } catch (err) {
        grid.innerHTML = `<p class="form-msg form-msg-error">❌ ${esc(err.message)}</p>`;
      }
    }

    async function loadAccount() {
      try {
        currentUser = await apiFetch('/users/me');
        document.getElementById('accEmail').textContent   = currentUser.email;
        document.getElementById('accCredits').textContent = currentUser.credits;
        const v = document.getElementById('accVerified');
        v.textContent = currentUser.email_verified ? '✓ vérifié' : 'non vérifié';
        v.className   = `badge ${currentUser.email_verified ? 'badge-green' : 'badge-amber'}`;
        const banner = document.getElementById('verifyBanner');
        banner.classList.toggle('hidden', currentUser.email_verified);
        // La bannière occupe déjà l'espace sous la topbar : éviter le double décalage
        document.querySelector('.layout').style.paddingTop = currentUser.email_verified ? '' : '0';
      } catch {}
      // Facturation : profil (+ statut abonnement) et factures
      loadBillingProfile();
      loadInvoices();
    }

    document.getElementById('resendVerifyBtn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const out = await apiFetch('/users/resend-verification', { method: 'POST' });
        showToast(out.already_verified ? 'Adresse déjà vérifiée !' : '📧 Email de vérification renvoyé', 'success');
      } catch (err) {
        showToast('Erreur: ' + err.message, 'error');
      } finally {
        e.target.disabled = false;
      }
    });

    document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
      const password = document.getElementById('deletePassword').value;
      const msg = document.getElementById('deleteMsg');
      msg.classList.add('hidden');
      if (!password) {
        msg.textContent = '⚠️ Entrez votre mot de passe pour confirmer.';
        msg.className = 'form-msg form-msg-error';
        msg.classList.remove('hidden');
        return;
      }
      if (!confirm('DERNIÈRE CONFIRMATION : toutes vos données (leads, sites, statistiques) seront définitivement supprimées. Continuer ?')) return;
      try {
        await apiFetch('/users/me', { method: 'DELETE', body: JSON.stringify({ password }) });
        alert('Compte supprimé. Au revoir !');
        logout();
      } catch (err) {
        msg.textContent = '❌ ' + err.message;
        msg.className = 'form-msg form-msg-error';
        msg.classList.remove('hidden');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AUTO-REFRESH (30 s, uniquement si l'onglet est visible et sur l'overview)
    // ─────────────────────────────────────────────────────────────────────────

    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!document.getElementById('panel-overview').classList.contains('active')) return;
      loadOverview();
      loadCredits();
    }, 30_000);

    // ─────────────────────────────────────────────────────────────────────────
    // DÉLÉGATION D'ÉVÉNEMENTS (remplace les onclick inline → CSP script-src 'self')
    // Un seul listener gère toutes les actions déclarées via data-action.
    // ─────────────────────────────────────────────────────────────────────────

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'switch-tab')      switchTab(el.dataset.tab);
      else if (a === 'load-leads') loadLeads(parseInt(el.dataset.page, 10));
      else if (a === 'copy')       copyToClipboard(el.dataset.url);
      else if (a === 'buy-pack')   buyPack(el.dataset.pack);
      else if (a === 'subscribe')  subscribe(el.dataset.plan);
      else if (a === 'select-input') el.select();
      else if (a === 'resend')     openResendModal(el.dataset.site, el.dataset.name, el.dataset.email);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────────────────────

    (async function init() {
      await loadCredits();
      await loadOverview();
      loadAccount();   // déclenche aussi la bannière "email non vérifié" + facturation
      loadPacks();
      loadPlans();
    })();
