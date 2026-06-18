    const API_BASE = window.API_BASE || 'http://localhost:3000';

    // Déjà connecté → dashboard. Le cookie HttpOnly fait foi côté serveur ;
    // 'user' n'est qu'un indice d'affichage (pas un secret, pas le JWT).
    if (localStorage.getItem('user')) {
      window.location.href = 'dashboard.html';
    }

    let mode = 'login'; // 'login' | 'register' | 'forgot'

    const toggleLink = document.getElementById('toggleMode');
    const forgotLink = document.getElementById('forgotLink');
    const nameGroup  = document.getElementById('nameGroup');
    const pwGroup    = document.getElementById('password').closest('.form-group');
    const btnText    = document.querySelector('#loginBtn .btn-text');
    const pwInput    = document.getElementById('password');
    const infoEl     = document.getElementById('loginInfo');

    function applyMode() {
      const isRegister = mode === 'register';
      const isForgot   = mode === 'forgot';
      nameGroup.classList.toggle('hidden', !isRegister);
      pwGroup.classList.toggle('hidden', isForgot);
      pwInput.required = !isForgot;
      btnText.textContent = isForgot ? 'Envoyer le lien' : isRegister ? 'Créer mon compte' : 'Se connecter';
      toggleLink.textContent = isRegister
        ? 'Déjà un compte ? Se connecter'
        : 'Pas encore de compte ? Créer un compte';
      forgotLink.textContent = isForgot ? '← Retour à la connexion' : 'Mot de passe oublié ?';
      pwInput.autocomplete = isRegister ? 'new-password' : 'current-password';
    }

    toggleLink.addEventListener('click', (e) => {
      e.preventDefault();
      mode = mode === 'register' ? 'login' : 'register';
      applyMode();
    });

    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      mode = mode === 'forgot' ? 'login' : 'forgot';
      applyMode();
    });

    // Pré-sélection du mode depuis l'URL (ex: /login?mode=register depuis la landing page)
    const modeParam = new URLSearchParams(window.location.search).get('mode');
    if (modeParam === 'register') { mode = 'register'; applyMode(); }

    // Retour du lien de vérification d'email
    const verified = new URLSearchParams(window.location.search).get('verified');
    if (verified === '1') {
      infoEl.textContent = '✅ Adresse email confirmée — connectez-vous.';
      infoEl.classList.remove('hidden');
    } else if (verified === 'invalid') {
      const err = document.getElementById('loginError');
      err.textContent = 'Lien de vérification invalide ou déjà utilisé.';
      err.classList.remove('hidden');
    }

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const name     = document.getElementById('name').value.trim();
      const btn      = document.getElementById('loginBtn');
      const error    = document.getElementById('loginError');

      btn.disabled = true;
      btn.querySelector('.btn-text').classList.add('hidden');
      btn.querySelector('.btn-loader').classList.remove('hidden');
      error.classList.add('hidden');
      infoEl.classList.add('hidden');

      // Mode "mot de passe oublié" : envoi du lien puis retour
      if (mode === 'forgot') {
        try {
          const res  = await fetch(`${API_BASE}/users/forgot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const data = await res.json();
          infoEl.textContent = '📧 ' + (data.data?.message || 'Lien envoyé si le compte existe.');
          infoEl.classList.remove('hidden');
        } catch {
          error.textContent = 'Impossible de contacter le serveur.';
          error.classList.remove('hidden');
        } finally {
          btn.disabled = false;
          btn.querySelector('.btn-text').classList.remove('hidden');
          btn.querySelector('.btn-loader').classList.add('hidden');
        }
        return;
      }

      try {
        const endpoint = mode === 'register' ? '/users/register' : '/users/login';
        const body     = mode === 'register'
          ? { email, password, name: name || undefined }
          : { email, password };

        const res  = await fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',   // accepte le cookie d'auth HttpOnly
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          // Le JWT arrive en cookie HttpOnly — on ne le stocke PAS en JS.
          // Seul l'objet user (non sensible) sert à l'affichage.
          localStorage.setItem('user', JSON.stringify(data.data.user));
          window.location.href = 'dashboard.html';
          return;
        }

        error.textContent = data.error || 'Erreur lors de la connexion.';
        error.classList.remove('hidden');
      } catch (err) {
        error.textContent = 'Impossible de contacter le serveur. Vérifiez que le backend tourne.';
        error.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.querySelector('.btn-text').classList.remove('hidden');
        btn.querySelector('.btn-loader').classList.add('hidden');
      }
    });
