# Décisions d'ingénierie

Ce document explique **pourquoi** le code est écrit comme il l'est. Chaque
décision indique ce qu'elle coûte, pas seulement ce qu'elle apporte : un choix
présenté sans son prix n'est pas un choix, c'est une publicité.

---

## 1. SQLite en production, PostgreSQL préparé mais pas branché

**Décision.** `better-sqlite3` comme base par défaut, avec un schéma PostgreSQL
consolidé, un adaptateur async et une façade repository déjà en place.

**Pourquoi.** L'application est mono-instance, écrit peu et lit beaucoup. SQLite
en mode WAL tient sans difficulté ce profil, supprime un service à exploiter, et
rend l'installation en local instantanée — ce qui compte autant pour un
contributeur que pour un déploiement.

**Le coût.** `better-sqlite3` est synchrone. La façade `repo.js` expose une API
async pour que le code appelant n'ait rien à changer le jour de la bascule, mais
les transactions métier (`siteService`, `billing`, `invoiceService`) restent
synchrones : c'est le vrai travail restant, et il est documenté dans
[`scaling.md`](scaling.md).

**Ce que je n'ai pas fait, et pourquoi.** Je n'ai pas livré la bascule
PostgreSQL. Elle ne peut pas être validée sans un serveur de staging, et une
migration de base livrée sans avoir jamais tourné est la pire chose qu'on puisse
mettre en production.

---

## 2. Zéro dépendance quand le standard suffit

**Décision.** Pas de `bcrypt` (scrypt est dans `node:crypto`), pas de
`cookie-parser` (une quinzaine de lignes), pas de framework frontend, pas de
client HTTP (`fetch` est natif depuis Node 18).

**Pourquoi.** Chaque dépendance est une surface d'attaque, une mise à jour à
suivre et une panne possible au build. Sur un projet maintenu par une seule
personne, le coût de maintenance domine le coût d'écriture.

**Le coût.** Plus de code à tester soi-même. C'est assumé : le parsing de cookies
et la dérivation de mot de passe sont couverts par des tests dédiés.

**La limite.** Les dépendances lourdes existent quand même — Stripe, Playwright,
BullMQ, IMAP, Twilio — mais elles sont **chargées paresseusement** et ne sont pas
déclarées dans `dependencies`. Une installation par défaut ne télécharge pas
300 Mo de Chromium pour une fonctionnalité désactivée.

---

## 3. Les effets de bord ne bloquent jamais la réponse

**Décision.** Incrément des vues, envoi de notifications, écriture de tracking :
tout part **après** que la réponse a été envoyée.

**Pourquoi.** La route publique `/demos/:slug` est la plus trafiquée du produit —
un prospect par email envoyé. Elle lisait le fichier en I/O synchrone et attendait
une écriture en base avant de répondre : chaque vue bloquait la boucle
d'événements pour **toutes** les requêtes du process, y compris celles des autres
comptes et les webhooks de paiement.

**Le coût.** Un compteur de vues peut théoriquement se perdre si le process meurt
entre la réponse et l'écriture. Un chiffre d'analytics approximatif contre une
latence garantie : l'arbitrage n'est pas difficile.

---

## 4. Un webhook de paiement doit pouvoir échouer bruyamment

**Décision.** Signature invalide → 400 (définitif). Erreur pendant le traitement
→ **500**, pour que Stripe réessaie.

**Pourquoi.** La version initiale répondait 200 dans tous les cas, avec un
commentaire expliquant qu'on évitait ainsi une boucle de retries. La conséquence
réelle : un incident transitoire — base verrouillée, disque plein — signifiait
client débité, crédits jamais versés, et **aucun rejeu possible** puisque Stripe
considérait l'événement comme acquitté. Une perte d'argent silencieuse, découverte
à la réclamation du client.

Le rejeu est sûr parce que l'idempotence était déjà là : `event.id` est inséré
dans `stripe_events` **dans la même transaction** que le crédit et la facture. Si
la transaction échoue, l'insertion est annulée avec le reste ; si elle réussit, le
rejeu est un no-op. Jamais de double crédit.

**Le coût.** Un bug applicatif permanent provoque trois jours de rejeus et
d'alertes au lieu d'un silence. C'est exactement ce qu'on veut.

---

## 5. Les rebonds sont classés, pas juste comptés

**Décision.** `5.1.1` ou `550` → blacklist immédiate. `5.2.2` (boîte pleine),
`5.7.x` (blocage) et tous les `4.x.x` → compté, blacklist après quatre occurrences
sur trente jours.

**Pourquoi.** Un rapport de non-remise arrive de `MAILER-DAEMON`, ne correspond à
aucun lead et était simplement ignoré : l'adresse morte restait sollicitée à
chaque relance. Gmail et Outlook coupent vers 2 % de hard bounces, et le warmup
n'en protège pas — le problème est la qualité de la liste, pas le volume.

La distinction hard/soft est l'essentiel. Blacklister un `5.7.1` reviendrait à se
punir d'un problème de réputation qui vient de nous ; blacklister un `5.2.2`
reviendrait à jeter définitivement un prospect joignable dès que sa boîte se vide.

**Le coût.** Une heuristique de parsing sur des formats de DSN non uniformes.
D'où le choix d'en faire une fonction **pure** (`parseBounce`), isolée du reste et
couverte par onze tests sur des rapports Postfix, Gmail et Exchange.

---

## 6. Isolation multi-tenant vérifiée par des tests, pas par relecture

**Décision.** Les requêtes sont scopées au `user_id`, et des tests d'intégration
tentent explicitement de lire les données d'un autre compte.

**Pourquoi.** Une fuite cross-tenant est le genre de bug qui ne se voit jamais en
développement solo — il n'y a qu'un seul compte — et qui devient une violation de
données au deuxième client. Le verrou de scraping en était une illustration : un
booléen global au process faisait qu'un compte bloquait tous les autres, avec un
message leur affirmant qu'ils avaient un scraping en cours.

---

## 7. La conformité fait partie du produit, pas de la documentation

**Décision.** Désinscription signée HMAC, mentions légales générées, export RGPD
pour les clients, et — ajouté plus tard — effacement des **prospects**, purge des
démos de désinscrits, rétention à trois ans et traçabilité de la provenance de
chaque lead.

**Pourquoi.** Un produit qui scrape des entreprises et leur écrit sans consentement
manipule des données personnelles de gens qui n'ont rien demandé. L'export RGPD
existant ne couvrait que les clients du SaaS. Se désinscrire blacklistait
l'adresse mais laissait en ligne une page publique portant le nom et le téléphone
de l'entreprise.

**L'arbitrage le plus intéressant.** La purge automatique ne touche jamais un lead
marqué intéressé, à rappeler ou signé, quel que soit son âge : c'est une relation
d'affaires, pas de la prospection dormante. Et je n'ai **pas** implémenté
d'expiration des démos par ancienneté — supprimer automatiquement le travail d'un
client payant est irréversible, alors que l'espace disque ne coûte rien. Seul le
cas « la personne a dit non » justifie une suppression automatique.

---

## 8. Un lint qui sert à quelque chose

**Décision.** ESLint configuré pour signaler des bugs, pas du style. `require-atomic-updates`
laissé en avertissement, `no-empty` tolérant sur les `catch` volontaires.

**Pourquoi.** Le déclencheur est concret : `scripts/generateBulk.js` contenait un
`await` dans un exécuteur de `Promise` non-async — une **SyntaxError**, donc un
fichier qui ne se chargeait pas du tout. Rien ne l'avait détecté parce que rien ne
lit un script avant de l'exécuter. Une configuration bruyante aurait été ignorée
comme le reste ; une configuration silencieuse sur ce genre d'erreur ne sert à rien.

---

## Ce qui reste ouvert

| Sujet | Pourquoi ce n'est pas fait |
| --- | --- |
| Bascule PostgreSQL | Exige un serveur de staging pour être validée |
| Comptes multi-utilisateurs | Le modèle est scopé `user_id`, pas `organization_id` — rattrapable, mais à décider tôt |
| Coût IA mesuré | Premier poste variable à volume, actuellement sans instrumentation |
| Source de scraping alternative | Google Maps est un point de rupture unique et contraire à ses CGU |
