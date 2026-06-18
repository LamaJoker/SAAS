/**
 * Variante "probleme" — angle "vous n'avez pas de site"
 * Angle : douleur manque de visibilité locale → solution immédiate
 */

export const id = 'probleme';

export const subject = ({ city }) =>
  `Vous n'avez pas de site à ${city} ?`;

export const text = ({ name, city, trackedUrl, sender }) =>
`Bonjour,

Beaucoup de gens cherchent des professionnels à ${city} en ligne.

J'ai fait une démo pour ${name} : ${trackedUrl}

Ça prend 30 secondes à regarder.

${sender}`;

export const html = ({ name, city, trackedUrl, sender, pixelUrl, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Beaucoup de gens cherchent des professionnels à <strong>${city}</strong> en ligne.</p>
  <p>J'ai fait une démo pour ${name} :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#22c55e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir ma démo gratuite →
    </a>
  </p>
  <p>Ça prend 30 secondes à regarder.</p>
  <p>${sender}</p>
  ${unsubFooter}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`;
