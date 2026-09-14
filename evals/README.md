# Évaluation du contenu généré

Un générateur de texte sans évaluation, c'est du code sans tests : on croit
qu'il fonctionne parce que la sortie ressemble à ce qu'on attendait.

Ce harnais mesure **sept critères déterministes** sur dix cas d'entreprises
fictives, et compare les versions de prompt entre elles.

```bash
npm run eval                        # version active, sur le contenu de repli — gratuit
npm run eval -- --versions v1,v2    # compare deux prompts
npm run eval -- --live              # appelle le vrai modèle (coût affiché)
npm run eval -- --live --runs 5     # 5 passes : mesure la variance
npm run eval -- --json rapport.json
```

## Pourquoi des scoreurs codés, pas un modèle juge

Un « LLM-as-judge » coûte un appel par évaluation, varie d'une exécution à
l'autre, et déplace le problème : il faudrait évaluer le juge. Or les défauts
qui comptent ici sont tous vérifiables mécaniquement. Un scoreur déterministe
est gratuit, reproductible, et il tourne dans la CI.

| Critère | Poids | Ce qu'il attrape |
| --- | --- | --- |
| Champs exploitables | 3 | Champs que le modèle n'a pas su produire et qu'il faudra combler |
| Longueurs respectées | 2 | `heroTitle` ≤ 60, `heroSubtitle` ≤ 120, `cta` ≤ 50 |
| Nom et ville présents | 2 | Nom reformulé, ville absente du titre |
| **Aucun fait inventé** | **4** | Ancienneté, certification, note, prix, récompense |
| Témoignages distincts | 2 | Trois variantes de la même phrase |
| Vocabulaire métier | 2 | Contenu interchangeable entre un plombier et un restaurant |
| Pas de résidu de gabarit | 3 | `{{name}}`, crochets, anglais, texte tronqué |

## Le critère qui pèse le plus

**Aucun fait inventé**, et ce n'est pas un choix esthétique. Le modèle reçoit
trois informations : un nom, une activité, une ville. Toute affirmation
vérifiable qu'il produit est donc fabriquée. Ces pages sont publiées sous le nom
d'une entreprise réelle qui n'a rien demandé : « certifié RGE », « 15 ans
d'expérience » ou « 4,8/5 » y sont de la publicité trompeuse, et c'est le
prospect qui en répond.

Le scoreur distingue une donnée **fournie** d'un fait **inventé** : une
entreprise nommée « Fournil 1902 » peut reprendre son propre nom sans être
pénalisée.

## Ce que ce harnais a trouvé dès sa première exécution

Le contenu de **repli** — celui qui sert en mode démo et chaque fois qu'un appel
au modèle échoue — promettait « 10+ années d'expérience », « équipe certifiée »
et « satisfaction garantie ou remboursé » pour des entreprises dont on ne sait
rien. Il dépassait aussi les limites de longueur qu'il impose au modèle.

Score avant correction : **69 %**. Après : **92 %**.

Le défaut n'était pas dans le modèle. Il était dans le code écrit à la main, et
il était en production.

## Mode mock et mode live

Sans `--live`, le contenu vient du générateur de repli : gratuit, déterministe,
exécutable en CI. Cela vérifie le harnais et le contenu de secours, mais **ne
différencie pas les versions de prompt** — le prompt n'est pas utilisé. Pour
comparer v1 et v2, il faut `--live`.

Le runner sort en code 1 si un prompt passe sous 70 %, ce qui permet de s'en
servir comme garde en intégration continue.

## Ajouter un critère

Un scoreur est une fonction pure de `(content, lead, lexicon)` vers
`{ id, label, score: 0..1, weight, details[] }`. `details` est obligatoire :
un score sans explication ne permet pas de corriger le prompt, et c'est la
seule raison d'être de ce harnais. Ajoutez la fonction dans `scorers.js`,
référencez-la dans `ALL_SCORERS`, et couvrez-la dans `tests/scorers.test.js`.
