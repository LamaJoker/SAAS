    const API_BASE = window.API_BASE || 'http://localhost:3000';
    const token = new URLSearchParams(window.location.search).get('token');
    const error = document.getElementById('resetError');
    const ok    = document.getElementById('resetOk');

    if (!token) {
      error.textContent = 'Lien invalide — refaites une demande depuis la page de connexion.';
      error.classList.remove('hidden');
      document.getElementById('resetBtn').disabled = true;
    }

    document.getElementById('resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password  = document.getElementById('password').value;
      const password2 = document.getElementById('password2').value;
      const btn       = document.getElementById('resetBtn');
      error.classList.add('hidden');
      ok.classList.add('hidden');

      if (password !== password2) {
        error.textContent = 'Les deux mots de passe ne correspondent pas.';
        error.classList.remove('hidden');
        return;
      }

      btn.disabled = true;
      try {
        const res  = await fetch(`${API_BASE}/users/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          ok.textContent = '✅ Mot de passe modifié ! Redirection…';
          ok.classList.remove('hidden');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setTimeout(() => { window.location.href = '/login'; }, 1500);
        } else {
          error.textContent = data.error || 'Erreur lors du changement.';
          error.classList.remove('hidden');
          btn.disabled = false;
        }
      } catch {
        error.textContent = 'Impossible de contacter le serveur.';
        error.classList.remove('hidden');
        btn.disabled = false;
      }
    });
