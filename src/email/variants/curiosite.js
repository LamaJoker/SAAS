/**
 * Variante "curiosite" — montre avant d'expliquer
 * Angle : j'ai fait quelque chose pour vous, regardez vite
 */

export const id = 'curiosite';

export const subject = ({ name }) =>
  `J'ai fait quelque chose pour ${name}`;

export const text = ({ name, city, trackedUrl, sender }) =>
`Bonjour,

J'ai créé quelque chose pour vous : ${trackedUrl}

C'est un site pour ${name} à ${city}. Pas parfait, mais regardez vite.

Si ça vous intéresse, répondez-moi.

${sender}`;

export const html = ({ name, city, trackedUrl, sender, pixelUrl, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>J'ai créé quelque chose pour vous :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#6366f1;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      → Voir ma démo
    </a>
  </p>
  <p>C'est un site pour <strong>${name}</strong> à ${city}. Pas parfait, mais regardez vite.</p>
  <p>Si ça vous intéresse, répondez-moi.<br><br>${sender}</p>
  ${unsubFooter}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`;
