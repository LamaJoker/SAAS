/**
 * AutoDemo SaaS — Dashboard Application (version optimisée)
 * Améliorations : affichage crédits proéminent, feedback utilisateur,
 * copie URL, loading states clairs.
 */

const API_BASE = window.API_BASE || 'http://localhost:3000';

// ─── AUTH ────────────────────────────────────────────────────────────────────

const userId    = localStorage.getItem('userId');
const userEmail = localStorage.getItem('userEmail') || 'Utilisateur';

if (!userId) {
  window.location.href = 'index.html';
  throw new Error('Not authenticated');
}

document.getElementById('userEmail').textContent = userEmail;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('userId');
  localStorage.removeItem('userEmail');
  window.location.href = 'index.html';
});

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info', durationMs = 3500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast toast-${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add('hidden'), durationMs);
}

// ─── CRÉDITS ──────────────────────────────────────────────────────────────────

let currentCredits = null;

async function loadCredits() {
  try {
    const { credits } = await apiFetch('/sites/credits');
    currentCredits = credits;

    document.getElementById('creditsCount').textContent = credits;

    const badge = document.getElementById('creditsBadge');
    badge.className = 'credits-badge';
    if (credits <= 0) {
      badge.classList.add('credits-empty');
      badge.title = 'Vous n\'avez plus de crédits';
    } else if (credits <= 2) {
      badge.classList.add('credits-low');
      badge.title = 'Crédits faibles — rechargez bientôt';
    } else if (credits <= 5) {
      badge.classList.add('credits-medium');
    }

    // Met à jour le bouton confirmer de génération
    const confirmBtn = document.getElementById('confirmGenerateBtn');
    if (confirmBtn) {
      confirmBtn.disabled = credits <= 0;
      confirmBtn.textContent = credits <= 0
        ? 'Aucun crédit'
        : `Générer (${credits} crédit${credits > 1 ? 's' : ''} restant${credits > 1 ? 's' : ''})`;
    }
  } catch {
    document.getElementById('creditsCount').textContent = '?';
  }
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
  const navEl = document.querySelector(`[data-tab="${name}"]`);
  if (navEl) navEl.classList.add('active');

  if (name === 'leads') loadLeads();
  if (name === 'sites') loadSites();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(item.dataset.tab);
  });
});

// ─── LEADS ────────────────────────────────────────────────────────────────────

let allLeads = [];

const STATUS_META = {
  pending:    { label: 'En attente',  cls: 'badge-warning', icon: '⏳' },
  processing: { label: 'En cours…',   cls: 'badge-info',    icon: '⚙️' },
  done:       { label: '✓ Généré',    cls: 'badge-success', icon: '✅' },
  error:      { label: 'Erreur',      cls: 'badge-danger',  icon: '❌' },
};

function renderLeads(leads) {
  const tbody = document.getElementById('leadsBody');
  tbody.innerHTML = '';

  leads.forEach(lead => {
    const st  = STATUS_META[lead.status] || { label: lead.status, cls: '', icon: '•' };
    const tr  = document.createElement('tr');
    const canGen = lead.status !== 'done' && lead.status !== 'processing';

    tr.innerHTML = `
      <td><strong>${esc(lead.name)}</strong></td>
      <td>${esc(lead.activity)}</td>
      <td>${esc(lead.city)}</td>
      <td><span class="badge ${st.cls}">${st.icon} ${st.label}</span></td>
      <td>
        ${lead.status === 'done'
          ? `<button class="btn btn-ghost btn-xs" onclick="switchTab('sites')">
               🌐 Voir le site
             </button>`
          : canGen
            ? `<button class="btn btn-primary btn-xs generate-btn"
                        data-id="${lead.id}"
                        data-name="${esc(lead.name)}"
                        ${currentCredits !== null && currentCredits <= 0 ? 'disabled title="Plus de crédits"' : ''}>
                 ⚡ Générer
               </button>`
            : `<span class="badge">En cours</span>`
        }
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.generate-btn').forEach(btn => {
    btn.addEventListener('click', () => openGenerateModal(btn.dataset.id, btn.dataset.name));
  });
}

async function loadLeads() {
  const loading = document.getElementById('leadsLoading');
  const empty   = document.getElementById('leadsEmpty');
  const table   = document.getElementById('leadsTable');

  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  table.classList.add('hidden');

  try {
    allLeads = await apiFetch('/leads');
    document.getElementById('leadsCount').textContent = allLeads.length;

    if (allLeads.length === 0) {
      empty.classList.remove('hidden');
    } else {
      renderLeads(allLeads);
      table.classList.remove('hidden');
    }
  } catch (err) {
    showToast(`Erreur chargement leads : ${err.message}`, 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

document.getElementById('refreshLeadsBtn').addEventListener('click', loadLeads);

// ─── MODAL GÉNÉRATION ─────────────────────────────────────────────────────────

let pendingLeadId = null;

function openGenerateModal(leadId, leadName) {
  if (currentCredits !== null && currentCredits <= 0) {
    showToast('Crédits insuffisants pour générer un site.', 'error');
    return;
  }

  pendingLeadId = leadId;

  const creditsInfo = currentCredits !== null
    ? `Il vous restera <strong>${currentCredits - 1}</strong> crédit(s).`
    : '1 crédit sera consommé.';

  document.getElementById('generateModalInfo').innerHTML =
    `Générer un site pour <strong>${esc(leadName)}</strong> ?<br><small>${creditsInfo}</small>`;
  document.getElementById('generateModalError').classList.add('hidden');
  document.getElementById('generateModalLoading').classList.add('hidden');
  document.getElementById('generateModalActions').classList.remove('hidden');
  document.getElementById('generateModal').classList.remove('hidden');
}

document.getElementById('cancelGenerateBtn').addEventListener('click', () => {
  document.getElementById('generateModal').classList.add('hidden');
  pendingLeadId = null;
});

document.getElementById('generateModal').addEventListener('click', (e) => {
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
    const site = await apiFetch('/generate', {
      method: 'POST',
      body:   JSON.stringify({ leadId: pendingLeadId }),
    });

    document.getElementById('generateModal').classList.add('hidden');
    showToast('✅ Site généré ! Consultez l\'onglet Sites.', 'success', 5000);
    await loadCredits();
    await loadLeads();
    // Bascule automatiquement sur l'onglet sites
    setTimeout(() => switchTab('sites'), 800);
  } catch (err) {
    loading.classList.add('hidden');
    actions.classList.remove('hidden');
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    showToast(`Erreur : ${err.message}`, 'error');
  }
});

// ─── SITES ────────────────────────────────────────────────────────────────────

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

    if (sites.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    sites.forEach(site => {
      const card = document.createElement('div');
      card.className = 'site-card';

      const views = site.views ?? 0;
      const viewsLabel = views === 0
        ? '👁 Pas encore consulté'
        : `👁 ${views} vue${views > 1 ? 's' : ''}`;

      card.innerHTML = `
        <div class="site-card-header">
          <div>
            <h3>${esc(site.lead_name || 'Lead')}</h3>
            <p class="site-card-meta">📍 ${esc(site.city || '')} · 🏭 ${esc(site.activity || site.lead_activity || '')}</p>
          </div>
          <span class="badge badge-success">En ligne</span>
        </div>

        <p class="site-card-views ${views === 0 ? 'views-zero' : 'views-active'}">${viewsLabel}</p>

        <div class="site-card-url">
          <input type="text"
                 id="url-${site.id}"
                 value="${esc(site.url)}"
                 readonly
                 onclick="this.select()"
                 title="Cliquez pour sélectionner" />
          <button class="btn btn-xs btn-secondary copy-btn"
                  data-url="${esc(site.url)}"
                  data-id="${site.id}"
                  title="Copier le lien">
            📋
          </button>
        </div>

        <div class="site-card-actions">
          <a href="${site.url}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
            Voir la démo ↗
          </a>
        </div>

        <p class="site-card-date">Créé le ${formatDate(site.created_at)}</p>
      `;
      grid.appendChild(card);
    });

    // Boutons copier
    grid.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url    = btn.dataset.url;
        const siteId = btn.dataset.id;
        navigator.clipboard.writeText(url).then(() => {
          btn.textContent = '✅';
          btn.title = 'Lien copié !';
          showToast('Lien copié dans le presse-papier', 'success', 2000);
          setTimeout(() => { btn.textContent = '📋'; btn.title = 'Copier le lien'; }, 2000);
        }).catch(() => {
          // Fallback sélection
          const input = document.getElementById(`url-${siteId}`);
          if (input) { input.select(); document.execCommand('copy'); }
          showToast('Lien copié', 'success', 2000);
        });
      });
    });

    grid.classList.remove('hidden');
  } catch (err) {
    showToast(`Erreur chargement sites : ${err.message}`, 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

document.getElementById('refreshSitesBtn').addEventListener('click', loadSites);

// ─── AJOUT LEAD ───────────────────────────────────────────────────────────────

document.getElementById('addLeadForm').addEventListener('submit', async (e) => {
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

  btn.disabled    = true;
  btn.textContent = '⏳ Ajout en cours…';
  msg.classList.add('hidden');

  try {
    await apiFetch('/leads', { method: 'POST', body: JSON.stringify(payload) });
    e.target.reset();
    msg.textContent = '✅ Lead ajouté ! Allez dans l\'onglet Leads pour le générer.';
    msg.className   = 'form-msg form-msg-success';
    msg.classList.remove('hidden');
    showToast(`✅ "${payload.name}" ajouté`, 'success');
    // Rafraîchit le compteur
    allLeads = await apiFetch('/leads').catch(() => allLeads);
    document.getElementById('leadsCount').textContent = allLeads.length;
  } catch (err) {
    msg.textContent = `❌ ${err.message}`;
    msg.className   = 'form-msg form-msg-error';
    msg.classList.remove('hidden');
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '➕ Ajouter le lead';
  }
});

// ─── JSON IMPORT ──────────────────────────────────────────────────────────────

document.getElementById('importJsonBtn').addEventListener('click', async () => {
  const raw  = document.getElementById('jsonImport').value.trim();
  const msg  = document.getElementById('importMsg');
  const btn  = document.getElementById('importJsonBtn');

  if (!raw) {
    msg.textContent = '⚠️ Collez du JSON dans la zone de texte.';
    msg.className   = 'form-msg form-msg-error';
    msg.classList.remove('hidden');
    return;
  }

  let leads;
  try {
    leads = JSON.parse(raw);
    if (!Array.isArray(leads)) throw new Error('Le JSON doit être un tableau.');
    if (leads.length === 0) throw new Error('Tableau vide.');
  } catch (err) {
    msg.textContent = `❌ JSON invalide: ${err.message}`;
    msg.className   = 'form-msg form-msg-error';
    msg.classList.remove('hidden');
    return;
  }

  btn.disabled    = true;
  btn.textContent = `⏳ Import de ${leads.length} leads…`;
  msg.classList.add('hidden');

  let success = 0;
  let errors  = 0;

  for (const lead of leads) {
    try {
      await apiFetch('/leads', { method: 'POST', body: JSON.stringify(lead) });
      success++;
    } catch {
      errors++;
    }
    // Mise à jour du bouton pendant l'import
    const done = success + errors;
    btn.textContent = `⏳ ${done}/${leads.length} importés…`;
  }

  msg.textContent = `✅ ${success} importé(s)${errors > 0 ? ` — ❌ ${errors} erreur(s)` : ''}.`;
  msg.className   = `form-msg ${errors > 0 && success === 0 ? 'form-msg-error' : 'form-msg-success'}`;
  msg.classList.remove('hidden');

  btn.disabled    = false;
  btn.textContent = '📥 Importer';

  if (success > 0) {
    document.getElementById('jsonImport').value = '';
    showToast(`${success} lead(s) importé(s) avec succès`, 'success', 4000);
  }
});

// ─── UTILS ────────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

(async function init() {
  await loadCredits();
  await loadLeads();
})();
