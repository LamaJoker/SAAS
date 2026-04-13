# 🚀 Auto-Demo System

Système de génération automatique de sites vitrines personnalisés pour vos prospects.

## 📋 Prérequis

- Node.js >= 18.x
- npm >= 9.x

## ⚡ Installation

```bash
git clone <repo>
cd auto-demo-system
npm install
cp .env.example .env
```

## ⚙️ Configuration

Éditez `.env` :

```env
# Mode mock (sans appel IA) ou clé API réelle
AI_MOCK_MODE=true
AI_API_KEY=sk-...

# Modèle IA
AI_MODEL=gpt-4o-mini
```

## 🚀 Lancement

```bash
npm start
```

Les sites seront générés dans `/output/{slug}/index.html`.

## 📁 Ajouter des leads

Éditez `data/leads.json` :

```json
[
  {
    "name": "Votre Client",
    "activity": "plomberie",
    "city": "Paris",
    "email": "contact@client.fr",
    "phone": "01 23 45 67 89"
  }
]
```

## 🤖 Brancher une vraie API IA

1. Obtenez une clé OpenAI sur https://platform.openai.com
2. Dans `.env` : `AI_API_KEY=sk-...` et `AI_MOCK_MODE=false`
3. Relancez `npm start`

## 📊 Rapport

Après génération, consultez `output/report.json` pour le récapitulatif complet.

## 🏗️ Architecture

```
src/
├── config.js      → Configuration centralisée
├── utils.js       → Fonctions utilitaires
├── ai.js          → Génération contenu IA
├── generator.js   → Pipeline de traitement des leads
├── builder.js     → Construction HTML
├── deploy.js      → URLs et déploiement
└── main.js        → Orchestrateur principal
```