/**
 * Variante "opportunite" — angle ROI / clients Google
 * Angle : des clients vous cherchent → voici votre vitrine
 */

export const id = 'opportunite';

export const subject = ({ name }) =>
  `${name} — des clients vous cherchent en ligne`;

export const text = ({ name, city, trackedUrl, sender }) =>
`Bonjour,

Des clients cherchent "${name}" sur Google à ${city}.

J'ai préparé une démo de site pour vous : ${trackedUrl}

Regardez — c'est fait pour vous.

${sender}`;

export const html = ({ name, city, trackedUrl, sender, pixelUrl, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Des clients cherchent <strong>"${name}"</strong> sur Google à ${city}.</p>
  <p>J'ai préparé une démo de site pour vous :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#f59e0b;color:#111;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir ma démo →
    </a>
  </p>
  <p>Regardez — c'est fait pour vous.</p>
  <p>${sender}</p>
  ${unsubFooter}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`;
