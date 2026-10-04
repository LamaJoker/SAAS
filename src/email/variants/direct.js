/**
 * Variante "direct" — zéro blabla
 * Angle : site prêt, en ligne, regardez
 */

export const id = 'direct';

export const subject = ({ city }) =>
  `Votre site à ${city} — démo prête`;

export const text = ({ name, trackedUrl, sender }) =>
`Bonjour,

Site démo pour ${name} : ${trackedUrl}

Prêt. En ligne. Regardez.

${sender}`;

export const html = ({ name, trackedUrl, sender, pixelUrl, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Site démo pour <strong>${name}</strong> :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#111;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      ${trackedUrl.slice(0, 55)}…
    </a>
  </p>
  <p>Prêt. En ligne. Regardez.</p>
  <p>${sender}</p>
  ${unsubFooter}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`;
