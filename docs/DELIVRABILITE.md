# Délivrabilité email — LE prérequis métier n°1

Tout le modèle AutoDemo repose sur des emails qui arrivent en **boîte de
réception**. Sans cette configuration, 70-80 % des envois partent en spam et
le produit ne peut pas prouver sa valeur.

## 1. Domaine d'envoi dédié

N'envoyez **jamais** la prospection depuis votre domaine principal.
Achetez un domaine cousin (ex: `autodemo-contact.fr` si votre site est
`autodemo.fr`). Si sa réputation se dégrade, votre domaine principal est
intact.

## 2. Les 3 enregistrements DNS obligatoires

### SPF — qui a le droit d'envoyer pour ce domaine
```
TXT  @  "v=spf1 include:_spf.votrefournisseur.com ~all"
```
(la valeur `include:` exacte est fournie par votre fournisseur SMTP —
Brevo, Mailgun, OVH, Gandi…)

### DKIM — signature cryptographique des messages
Générée par le fournisseur SMTP, à copier telle quelle :
```
TXT  selecteur._domainkey  "v=DKIM1; k=rsa; p=MIGfMA0GCSq..."
```

### DMARC — politique en cas d'échec SPF/DKIM
```
TXT  _dmarc  "v=DMARC1; p=quarantine; rua=mailto:dmarc@votredomaine.fr"
```
Commencez par `p=none` (observation) 2 semaines, puis `p=quarantine`.

**Vérification** : https://www.mail-tester.com (visez 9/10 minimum) et
`dig TXT _dmarc.votredomaine.fr` pour contrôler la propagation.

## 3. Warm-up — montée en volume progressive

Un domaine neuf qui envoie 200 emails le premier jour est grillé en 48h.

| Semaine | Volume/jour | Note |
|---|---|---|
| 1 | 10-20 | idéalement vers des adresses qui répondent |
| 2 | 30-50 | surveiller bounce rate < 5 % |
| 3 | 60-80 | |
| 4+ | 80-100/compte | plafond raisonnable par compte SMTP |

Le pool SMTP gère déjà `hourlyLimit` (80/h par défaut) et met en
quarantaine automatique un compte qui bounce trop. Pour monter en volume,
ajoutez des comptes via `SMTP_POOL_JSON` plutôt que d'augmenter la limite.

## 4. Hygiène de liste

- Le scraper ne garde que les entreprises **sans site web** (cible utile).
- Les hard bounces alimentent `email_blacklist` — ne les réimportez pas.
- Adresses personnelles (gmail, orange, free…) : **bloquées par défaut**
  dans la séquence. En France (L.34-5 CPCE), la prospection B2B sans
  consentement n'est défendable que vers des adresses professionnelles.
  `COLD_EMAIL_PERSONAL=allow` désactive ce filtre, à vos risques —
  beaucoup d'artisans utilisent gmail, mais c'est juridiquement exposé.

## 5. Conformité (déjà gérée par le code)

- Lien de désabonnement signé HMAC dans chaque email + header
  `List-Unsubscribe` (one-click Gmail/Outlook).
- Désinscription = blacklist immédiate + arrêt de la séquence.
- Identité réelle de l'expéditeur : configurez `SMTP_SENDER_NAME` avec un
  vrai nom — les pseudos aléatoires dégradent la confiance et la réputation.

## 6. Surveillance

- `/health` expose les alertes bounce/spam/quarantaine par compte SMTP.
- Si le bounce rate dépasse 5 % : stoppez les envois, nettoyez la liste.
- Si un compte part en quarantaine 24h (spam) : ne forcez pas, le
  problème est le contenu ou la cible, pas la machine.
