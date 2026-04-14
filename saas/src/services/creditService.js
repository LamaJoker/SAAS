import { User } from '../db/models/User.js';
import { Errors } from '../utils/AppError.js';

export async function getCredits(userId) {
  const user = User.findById(userId);
  if (!user) throw Errors.unauthorized('Utilisateur introuvable');
  return user.credits;
}

export async function addCredits(userId, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw Errors.badRequest('Montant de crédits invalide');
  }
  User.addCredits(userId, amount);
  return getCredits(userId);
}
