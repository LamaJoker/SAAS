import { Lead } from '../db/models/Lead.js';

export async function createLead({ userId, name, activity, city, email, phone }) {
  return Lead.create({ userId, name, activity, city, email, phone });
}

export async function getLeadsForUser(userId) {
  return Lead.findAllByUser(userId);
}
