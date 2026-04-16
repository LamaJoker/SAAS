/**
 * Variante "court" — juste l'URL, rien d'autre
 * Angle : curiosité maximale, friction zéro
 */

export const id = 'court';

export const subject = ({ name }) =>
  `${name} — 30 secondes`;

export const text = ({ trackedUrl, sender }) =>
`Bonjour,

${trackedUrl}

Dites-moi ce que vous en pensez.

${sender}`;

export const html = ({ trackedUrl, sender, pixelUrl, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="color:#6366f1;font-size:16px;font-weight:bold">
      Voir votre démo →
    </a>
  </p>
  <p>Dites-moi ce que vous en pensez.</p>
  <p>${sender}</p>
  ${unsubFooter}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`;
