/**
 * Encart publicitaire sous le résultat, piloté par un fichier JSON publié à
 * côté des tuiles (ENCART_URL). Absent ou invalide : rien n'est affiché.
 *
 * - Aucun script de régie : un texte, un lien et éventuellement une image,
 *   insérés via le DOM (textContent), jamais en HTML.
 * - Aucun pistage : le fichier et l'image viennent du même serveur que les
 *   cartes ; l'annonceur n'est contacté que si l'utilisateur clique.
 * - Signalé « Publicité » et sans lien avec le classement des opérateurs.
 *
 * Format (cf. store/encart.exemple.json) :
 *   { "titre": "…", "texte": "…", "lien": "https://…", "image": "<même origine>", "actif": true }
 */
import { ENCART_URL } from './config.ts';

interface Encart {
  titre?: string;
  texte: string;
  lien: string;
  image?: string;
}

const MAX_TEXT = 200;

const isHttps = (s: unknown): s is string => {
  try {
    return typeof s === 'string' && new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Valide le fichier : tout écart (champ manquant, lien non https, image d'une autre origine) l'écarte. */
function parse(data: unknown): Encart | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.actif === false) return null;
  if (typeof d.texte !== 'string' || !d.texte.trim() || d.texte.length > MAX_TEXT || !isHttps(d.lien)) return null;
  if (d.titre !== undefined && (typeof d.titre !== 'string' || d.titre.length > 80)) return null;
  let image: string | undefined;
  if (d.image !== undefined) {
    if (typeof d.image !== 'string') return null;
    const url = new URL(d.image, ENCART_URL);
    // Image servie par le même serveur que l'encart : aucun tiers ne voit l'affichage.
    if (url.origin !== new URL(ENCART_URL).origin) return null;
    image = url.href;
  }
  return { titre: d.titre as string | undefined, texte: d.texte.trim(), lien: d.lien, image };
}

let pending: Promise<Encart | null> | undefined;

/** Chargé une fois par ouverture du panneau ; toute erreur donne « pas d'encart ». */
function loadEncart(): Promise<Encart | null> {
  pending ??= fetch(ENCART_URL, { signal: AbortSignal.timeout(5000), credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then(parse)
    .catch(() => null);
  return pending;
}

/** Remplace `slot` par l'encart s'il y en a un (sinon le retire). */
export async function fillEncart(slot: HTMLElement): Promise<void> {
  const encart = await loadEncart();
  if (!slot.isConnected) return; // résultat remplacé entre-temps
  if (!encart) return slot.remove();

  const aside = document.createElement('aside');
  aside.className = 'encart';
  aside.setAttribute('aria-label', 'Publicité');
  const mention = Object.assign(document.createElement('span'), { className: 'encart-mention', textContent: 'Publicité' });
  const link = Object.assign(document.createElement('a'), { href: encart.lien, target: '_blank', rel: 'noopener sponsored', referrerPolicy: 'no-referrer' });
  if (encart.image) {
    link.append(Object.assign(document.createElement('img'), { src: encart.image, alt: '', loading: 'lazy' }));
  }
  const body = document.createElement('span');
  if (encart.titre) body.append(Object.assign(document.createElement('strong'), { textContent: encart.titre }));
  body.append(Object.assign(document.createElement('span'), { textContent: encart.texte }));
  link.append(body);
  aside.append(mention, link);
  slot.replaceWith(aside);
}
