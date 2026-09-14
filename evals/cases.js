/**
 * cases.js — Jeu d'évaluation.
 *
 * Choisi pour couvrir trois axes, pas pour faire du volume :
 *   - des métiers au vocabulaire très différent (un texte générique échoue) ;
 *   - des noms d'entreprise pénibles (apostrophes, accents, sigles, chiffres),
 *     parce que c'est là que le modèle reformule au lieu de recopier ;
 *   - des villes homonymes ou composées, qui se perdent facilement.
 *
 * `lexicon` liste le vocabulaire qu'un contenu réellement spécifique au métier
 * devrait contenir. Trois occurrences suffisent : on mesure l'ancrage, pas le
 * remplissage de mots-clés.
 */
export const CASES = [
  {
    id: 'plombier-simple',
    lead: { name: 'Plomberie Durand', activity: 'plombier', city: 'Besançon' },
    lexicon: ['fuite', 'chauffe-eau', 'sanitaire', 'canalisation', 'dépannage', 'robinet', 'chaudière'],
  },
  {
    id: 'restaurant-accents',
    lead: { name: 'Le Comptoir des Saveurs', activity: 'restaurant', city: 'Lyon' },
    lexicon: ['carte', 'cuisine', 'produits frais', 'menu', 'saison', 'réservation', 'chef'],
  },
  {
    id: 'garage-auto',
    lead: { name: 'Garage Martin', activity: 'garagiste', city: 'Dijon' },
    lexicon: ['révision', 'vidange', 'pneus', 'diagnostic', 'entretien', 'freins', 'véhicule'],
  },
  {
    id: 'coiffeur-apostrophe',
    // L'apostrophe typographique casse les comparaisons naïves et pousse le
    // modèle à « nettoyer » le nom au lieu de le reprendre.
    lead: { name: "L'Atelier d'Élise", activity: 'coiffeur', city: 'Aix-en-Provence' },
    lexicon: ['coupe', 'couleur', 'coiffure', 'brushing', 'soin', 'cheveux'],
  },
  {
    id: 'electricien-sigle',
    lead: { name: 'ETS Moreau & Fils', activity: 'électricien', city: 'Saint-Étienne' },
    lexicon: ['tableau électrique', 'installation', 'mise aux normes', 'éclairage', 'panne', 'rénovation'],
  },
  {
    id: 'boulangerie-chiffre',
    lead: { name: 'Fournil 1902', activity: 'boulanger', city: 'Tours' },
    // Piège volontaire : un chiffre dans le NOM ne doit pas autoriser le modèle
    // à inventer une date de création dans le contenu.
    lexicon: ['pain', 'levain', 'viennoiserie', 'pâtisserie', 'four', 'tradition'],
  },
  {
    id: 'kine-profession-reglementee',
    lead: { name: 'Cabinet Lefèvre', activity: 'kinésithérapeute', city: 'Nancy' },
    // Profession réglementée : les promesses de résultat et les mentions
    // d'agrément y sont des fautes, pas de simples approximations.
    lexicon: ['rééducation', 'séance', 'mobilité', 'douleur', 'cabinet', 'suivi'],
  },
  {
    id: 'ville-homonyme',
    lead: { name: 'Menuiserie Colin', activity: 'menuisier', city: 'Saint-Denis' },
    lexicon: ['bois', 'sur mesure', 'pose', 'fenêtre', 'agencement', 'parquet', 'atelier'],
  },
  {
    id: 'nom-tres-court',
    lead: { name: 'AZ Nettoyage', activity: 'entreprise de nettoyage', city: 'Metz' },
    lexicon: ['nettoyage', 'entretien', 'locaux', 'vitres', 'bureaux', 'hygiène'],
  },
  {
    id: 'activite-rare',
    lead: { name: 'Atelier Verre & Lumière', activity: 'vitrailliste', city: 'Chartres' },
    // Métier rare : le modèle a peu de matière, c'est là qu'il compense en
    // inventant. Cas le plus révélateur du jeu.
    lexicon: ['vitrail', 'verre', 'restauration', 'plomb', 'création', 'lumière'],
  },
];

export const findCase = (id) => CASES.find(c => c.id === id);
