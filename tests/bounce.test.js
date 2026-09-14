/**
 * bounce.test.js — Parseur de rebonds.
 *
 * parseBounce() porte toute la logique fragile : les formats de rapports de
 * non-remise varient selon le fournisseur, et une erreur de classification se
 * paie soit en réputation (hard non détecté, adresse morte re-sollicitée), soit
 * en leads perdus (soft classé hard, adresse valide blacklistée à vie).
 *
 * Les échantillons ci-dessous reproduisent la structure des DSN réellement
 * émis par Postfix, Gmail et Exchange.
 */
import { describe, it, expect } from 'vitest';
import { parseBounce } from '../src/services/bounceService.js';

const postfixHard = `From: MAILER-DAEMON@mail.exemple.fr
Subject: Undelivered Mail Returned to Sender
Content-Type: multipart/report; report-type=delivery-status

This is the mail system at host mail.exemple.fr.

<contact@plomberie-morte.fr>: host mx.plomberie-morte.fr said:
    550 5.1.1 <contact@plomberie-morte.fr>: Recipient address rejected:
    User unknown in virtual mailbox table

Content-Type: message/delivery-status

Final-Recipient: rfc822; contact@plomberie-morte.fr
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 User unknown in virtual mailbox table
`;

const gmailSoftFull = `From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
Subject: Delivery Status Notification (Failure)
Content-Type: message/delivery-status

Final-Recipient: rfc822; garage.durand@gmail.com
Action: failed
Status: 5.2.2
Diagnostic-Code: smtp; 552 5.2.2 The email account that you tried to reach is over quota.
`;

const exchangeTemp = `From: postmaster@exemple.com
Subject: Delivery has failed to these recipients or groups

Content-Type: message/delivery-status

Final-Recipient: rfc822; accueil@boulangerie.fr
Action: delayed
Status: 4.4.7
Diagnostic-Code: smtp; 451 4.4.7 Message expired
`;

const blocked = `From: MAILER-DAEMON@mail.exemple.fr
Subject: Undeliverable

Content-Type: message/delivery-status

Final-Recipient: rfc822; direction@restaurant-nice.fr
Action: failed
Status: 5.7.1
Diagnostic-Code: smtp; 550 5.7.1 Service unavailable, client host blocked
`;

const failedRecipientsHeader = `From: postmaster@exemple.fr
Subject: Échec de remise
X-Failed-Recipients: info@garage-inconnu.fr

Votre message n'a pas pu être distribué.
550 no such user
`;

const vraieReponse = `From: Jean Martin <jean@plomberie-martin.fr>
Subject: Re: Votre site web

Bonjour, votre proposition m'intéresse, rappelez-moi demain.
`;

describe('parseBounce — détection', () => {
  it('reconnaît un rebond Postfix et extrait le destinataire', () => {
    const r = parseBounce({ from: 'MAILER-DAEMON@mail.exemple.fr', subject: 'Undelivered Mail Returned to Sender', text: postfixHard });
    expect(r.isBounce).toBe(true);
    expect(r.recipient).toBe('contact@plomberie-morte.fr');
    expect(r.code).toBe('5.1.1');
    expect(r.type).toBe('hard');
  });

  it("lit l'en-tête X-Failed-Recipients quand il n'y a pas de partie DSN", () => {
    const r = parseBounce({ from: 'postmaster@exemple.fr', subject: 'Échec de remise', text: failedRecipientsHeader });
    expect(r.isBounce).toBe(true);
    expect(r.recipient).toBe('info@garage-inconnu.fr');
  });

  it("ne prend pas une vraie réponse de prospect pour un rebond", () => {
    const r = parseBounce({ from: 'Jean Martin <jean@plomberie-martin.fr>', subject: 'Re: Votre site web', text: vraieReponse });
    expect(r.isBounce).toBe(false);
    expect(r.recipient).toBeNull();
  });

  it('ignore un message au sujet trompeur mais sans marqueur de rebond', () => {
    const r = parseBounce({
      from: 'Marie <marie@boulangerie.fr>',
      subject: 'Undeliverable ? votre email est bien arrivé',
      text: 'Bonjour, je vous confirme la réception.',
    });
    expect(r.isBounce).toBe(false);
  });
});

describe('parseBounce — classification', () => {
  it('5.1.1 (utilisateur inconnu) → hard', () => {
    expect(parseBounce({ from: 'MAILER-DAEMON@x.fr', text: postfixHard }).type).toBe('hard');
  });

  it('5.2.2 (boîte pleine) → soft, pas hard', () => {
    // Un 5.x.x qui n'est PAS une adresse invalide : blacklister reviendrait à
    // jeter un lead joignable dès que sa boîte se vide.
    const r = parseBounce({ from: 'mailer-daemon@googlemail.com', text: gmailSoftFull });
    expect(r.isBounce).toBe(true);
    expect(r.type).toBe('soft');
  });

  it('4.4.7 (temporaire) → soft', () => {
    expect(parseBounce({ from: 'postmaster@exemple.com', text: exchangeTemp }).type).toBe('soft');
  });

  it('5.7.1 (blocage réputation) → soft — le problème vient de nous', () => {
    expect(parseBounce({ from: 'MAILER-DAEMON@x.fr', text: blocked }).type).toBe('soft');
  });

  it("sans code exploitable, retombe sur le libellé puis sur soft par défaut", () => {
    const sansCode = `Content-Type: message/delivery-status

Final-Recipient: rfc822; x@y.fr
Action: failed
Diagnostic-Code: smtp; mailbox temporarily unavailable`;
    expect(parseBounce({ from: 'mailer-daemon@y.fr', text: sansCode }).type).toBe('soft');
  });
});

describe('parseBounce — robustesse', () => {
  it('ne jette jamais sur une entrée vide ou malformée', () => {
    for (const input of [{}, { from: null }, { text: null }, { from: '', subject: '', text: '' }]) {
      expect(() => parseBounce(input)).not.toThrow();
      expect(parseBounce(input).isBounce).toBe(false);
    }
  });

  it("n'extrait pas une adresse invalide", () => {
    const r = parseBounce({
      from: 'MAILER-DAEMON@x.fr',
      text: 'Content-Type: message/delivery-status\n\nFinal-Recipient: rfc822; pas-une-adresse\nStatus: 5.1.1',
    });
    expect(r.isBounce).toBe(false);
  });
});

describe('handleInboundEmail — un rebond ne passe pas pour une réponse', () => {
  it('blackliste le destinataire et ne compte aucun lead comme ayant répondu', async () => {
    const { runMigrations, getDb } = await import('../src/db/database.js');
    const { handleInboundEmail } = await import('../src/services/inboundService.js');
    runMigrations();
    const db = getDb();

    const uid = 'u-bounce-' + Date.now();
    db.prepare('INSERT INTO users (id, email, credits) VALUES (?,?,0)').run(uid, `${uid}@test.fr`);
    const lid = 'l-bounce-' + Date.now();
    db.prepare('INSERT INTO leads (id, user_id, name, activity, city, email) VALUES (?,?,?,?,?,?)')
      .run(lid, uid, 'Plomberie Morte', 'plombier', 'Lyon', 'contact@plomberie-morte.fr');

    const res = await handleInboundEmail({
      from: 'MAILER-DAEMON@mail.exemple.fr',
      subject: 'Undelivered Mail Returned to Sender',
      text: postfixHard,
    });

    expect(res.matched).toBe(0);              // pas traité comme une réponse
    expect(res.bounce.blacklisted).toBe(true);
    expect(res.bounce.type).toBe('hard');

    const bl = db.prepare('SELECT reason FROM email_blacklist WHERE email = ?')
      .get('contact@plomberie-morte.fr');
    expect(bl?.reason).toBe('bounce_hard');

    // Le lead ne doit PAS être passé en « rappeler » : personne n'a répondu.
    const lead = db.prepare('SELECT pipeline FROM leads WHERE id = ?').get(lid);
    expect(lead.pipeline).not.toBe('rappeler');
  });
});
