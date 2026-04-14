/**
 * AutoDemo SaaS — Dashboard Application
 * Vanilla JS, no framework dependencies.
 */

const API_BASE = window.API_BASE || 'http://localhost:3000';

// ─── AUTH ────────────────────────────────────────────────────────────────────

const userId = localStorage.getItem('userId');
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

// ─── API HELPERS ──────────────────────────────────────────────────────────────

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

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ─── CREDITS ─────────────────────────────────────────────────────────────────

async function loadCredits() {
  try {
    const { credits } = await apiFetch('/sites/credits');
    document.getElementById('creditsCount').textContent = credits;
    const badge = document.getElementById('creditsBadge');
    badge.className = `credits-badge ${credits <= 2 ? 'credits-low' : credits <= 5 ? 'credits-medium' : ''}`;
  } catch {
    document.getElementById('creditsCount').textContent = '?';
  }
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');

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

const STATUS_LABELS = {
  pending:    { label: 'En attente',   cls: 'badge-warning'  },
  processing: { label: 'En cours…',    cls: 'badge-info'     },
  done:       { label: 'Généré ✓',     cls: 'badge-success'  },
  error:      { label: 'Erreur',       cls: 'badge-danger'   },
};

function renderLeads(leads) {
  const tbody = document.getElementById('leadsBody');
  tbody.innerHTML = '';

  leads.forEach(lead => {
    const st = STATUS_LABELS[lead.status] || { label: lead.status, cls: '' };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(lead.name)}</strong></td>
      <td>${esc(lead.activity)}</td>
      <td>${esc(lead.city)}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>
        ${lead.status === 'done'
          ? `<button class="btn btn-ghost btn-xs" onclick="switchTab('sites')">Voir le site</button>`
          : `<button class="btn btn-primary btn-xs generate-btn" data-id="${lead.id}" data-name="${esc(lead.name)}">
               ⚡ Générer
             </button>`
        }
      </td>`;
    tbody.appendChild(tr);
  });

  // Attach generate button listeners
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
    showToast(`Erreur chargement leads: ${err.message}`, 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

document.getElementById('refreshLeadsBtn').addEventListener('click', loadLeads);

// ─── GENERATE MODAL ───────────────────────────────────────────────────────────

let pendingLeadId = null;

function openGenerateModal(leadId, leadName) {
  pendingLeadId = leadId;
  document.getElementById('generateModalInfo').textContent =
    `Générer un site pour "${leadName}" ? Cela consommera 1 crédit.`;
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
  if (e.target === e.currentTarget) {
    document.getElementById('generateModal').classList.add('hidden');
  }
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
      body: JSON.stringify({ leadId: pendingLeadId }),
    });

    document.getElementById('generateModal').classList.add('hidden');
    showToast('✅ Site généré avec succès !', 'success');
    await loadCredits();
    await loadLeads();
    switchTab('sites');
  } catch (err) {
    loading.classList.add('hidden');
    actions.classList.remove('hidden');
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
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
      card.innerHTML = `
        <div class="site-card-header">
          <h3>${esc(site.lead_name || 'Lead')}</h3>
          <span class="badge badge-success">En ligne</span>
        </div>
        <p class="site-card-city">📍 ${esc(site.city || '')}</p>
        <p class="site-card-views">👁 ${site.views ?? 0} vue${(site.views ?? 0) !== 1 ? 's' : ''}</p>
        <div class="site-card-url">
          <input type="text" value="${esc(site.url)}" readonly onclick="this.select()" />
          <button class="btn btn-xs btn-secondary" onclick="copyToClipboard('${esc(site.url)}')">📋</button>
        </div>
        <div class="site-card-actions">
          <a href="${site.url}" target="_blank" class="btn btn-primary btn-sm">Voir la démo ↗</a>
        </div>
        <p class="site-card-date">Créé le ${formatDate(site.created_at)}</p>
      `;
      grid.appendChild(card);
    });

    grid.classList.remove('hidden');
  } catch (err) {
    showToast(`Erreur chargement sites: ${err.message}`, 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

document.getElementById('refreshSitesBtn').addEventListener('click', loadSites);

// ─── ADD LEAD FORM ────────────────────────────────────────────────────────────

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

  btn.disabled = true;
  btn.textContent = '⏳ Ajout…';
  msg.classList.add('hidden');

  try {
    await apiFetch('/leads', { method: 'POST', body: JSON.stringify(payload) });
    showToast('✅ Lead ajouté avec succès !', 'success');
    e.target.reset();
    msg.textContent = '✅ Lead ajouté ! Rendez-vous dans l\'onglet Leads.';
    msg.className = 'form-msg form-msg-success';
    msg.classList.remove('hidden');
  } catch (err) {
    msg.textContent = `❌ ${err.message}`;
    msg.className = 'form-msg form-msg-error';
    msg.classList.remove('hidden');
  } finally {
    btn.disabled = false;
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
    msg.className = 'form-msg form-msg-error';
    msg.classList.remove('hidden');
    return;
  }

  let leads;
  try {
    leads = JSON.parse(raw);
    if (!Array.isArray(leads)) throw new Error('Le JSON doit être un tableau.');
  } catch (err) {
    msg.textContent = `❌ JSON invalide: ${err.message}`;
    msg.className = 'form-msg form-msg-error';
    msg.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Import…';
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
  }

  msg.textContent = `✅ ${success} importé(s), ❌ ${errors} erreur(s).`;
  msg.className = `form-msg ${errors > 0 ? 'form-msg-error' : 'form-msg-success'}`;
  msg.classList.remove('hidden');

  btn.disabled = false;
  btn.textContent = '📥 Importer';

  if (success > 0) {
    document.getElementById('jsonImport').value = '';
    showToast(`${success} lead(s) importé(s) !`, 'success');
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

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('Lien copié !', 'success'))
    .catch(() => showToast('Impossible de copier', 'error'));
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

(async function init() {
  await loadCredits();
  await loadLeads();
})();
