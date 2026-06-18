# Déployer AutoDemo sur Render (gratuit)

Déploiement en quelques minutes via le `render.yaml` à la racine du repo.

## Étapes

1. Crée un compte sur **[render.com](https://render.com)** (connexion avec GitHub).
2. Dashboard → **New** → **Blueprint**.
3. Sélectionne le repo **`LamaJoker/SAAS`**.
4. Render détecte automatiquement le `render.yaml`, construit l'image Docker et déploie.
5. Le `JWT_SECRET` est **généré automatiquement** — rien à faire.
6. Une fois en ligne, copie l'URL (ex: `https://autodemo-saas.onrender.com`) et renseigne-la dans les variables d'environnement du service :
   - `BASE_URL` = l'URL Render
   - `CORS_ORIGIN` = l'URL Render
   puis **Manual Deploy → Deploy latest commit** pour appliquer.

## Vérifier que ça tourne

```
GET https://<ton-url>.onrender.com/health   → {"status":"ok"}
```

## Bon à savoir (plan gratuit)

- **Mise en veille** : le service s'endort après ~15 min d'inactivité ; le premier accès suivant prend ~30 s à réveiller. Normal sur le plan gratuit.
- **Données éphémères** : la base SQLite se réinitialise à chaque redéploiement (pas de disque persistant sur le plan gratuit). Idéal pour une démo. Pour persister : plan payant + décommenter le bloc `disk:` dans `render.yaml`.
- **Mode démo** : `AI_MOCK_MODE=true` génère des sites sans clé IA. Ajoute une vraie `AI_API_KEY` (+ `AI_MOCK_MODE=false`) pour la génération réelle.

## Mettre le lien dans le portfolio

Une fois l'URL Render obtenue, ajoute-la à la carte AutoDemo du portfolio (un bouton « Voir la démo live » à côté du lien GitHub).
