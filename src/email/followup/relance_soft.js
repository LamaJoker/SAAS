/**
 * Relance "relance_soft" — J+3 après premier contact
 * Angle : neutre, porte de sortie offerte, pas de pression
 */

export const id = 'relance_soft';

export const subject = ({ name }) =>
  `Re: ${name}`;

export const text = ({ trackedUrl, sender }) =>
`Bonjour,

Je me permets de revenir vers vous.

La démo est toujours disponible ici : ${trackedUrl}

Si ce n'est pas le bon moment, pas de souci — dites-le moi.

${sender}`;

export const html = ({ trackedUrl, sender, pixelUrl, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Je me permets de revenir vers vous.</p>
  <p>La démo est toujours disponible ici :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="color:#6366f1;font-weight:bold">
      Voir ma démo →
    </a>
  </p>
  <p>Si ce n'est pas le bon moment, pas de souci — dites-le moi.</p>
  <p>${sender}</p>
  ${unsubFooter}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`;
