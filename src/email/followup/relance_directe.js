/**
 * Relance "relance_directe" — J+6 (dernier message de la séquence)
 * Angle : urgence douce, fermeture de boucle, pas de pression agressive
 */

export const id = 'relance_directe';

export const subject = ({ name }) =>
  `Dernier message — ${name}`;

export const text = ({ name, trackedUrl, sender }) =>
`Bonjour,

C'est mon dernier message.

J'avais créé ce site pour ${name} : ${trackedUrl}

Si vous le voulez, répondez-moi. Sinon, bonne continuation.

${sender}`;

export const html = ({ name, trackedUrl, sender, pixelUrl, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>C'est mon dernier message.</p>
  <p>J'avais créé ce site pour <strong>${name}</strong> :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#ef4444;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir la démo →
    </a>
  </p>
  <p>Si vous le voulez, répondez-moi. Sinon, bonne continuation.</p>
  <p>${sender}</p>
  ${unsubFooter}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`;
