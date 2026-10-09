/**
 * Adresses réseau de l'extension, fixées à la compilation (variables VITE_*).
 * Elles déterminent aussi la CSP du manifeste (cf. build.ts) : l'extension ne
 * peut contacter QUE le géocodeur et l'hébergement des tuiles.
 */

/** Dossier contenant manifest.json et les .pmtiles (en dev : le serveur Vite du site). */
export const TILES_BASE_URL: string = import.meta.env.VITE_TILES_BASE_URL ?? 'http://127.0.0.1:5173/tiles/';

/** Notre serveur Photon (géocodage hors France et Espagne), en dev : Photon local (cf. geocoder/README.md). */
export const PHOTON_URL: string = import.meta.env.VITE_PHOTON_URL ?? 'http://127.0.0.1:2322/api';

/** Site de la carte complète, ouvert par le lien « Voir sur la carte complète ». */
export const SITE_URL: string = import.meta.env.VITE_SITE_URL ?? 'http://127.0.0.1:5173/';

/**
 * Encart publicitaire facultatif (cf. encart.ts), publié à côté des tuiles :
 * même serveur, donc déjà autorisé par la CSP. Fichier absent = pas d'encart.
 */
export const ENCART_URL: string = new URL('encart.json', TILES_BASE_URL).href;

/** Politique de confidentialité publiée (lien de la page d'infos et des stores). */
export const PRIVACY_URL = 'https://github.com/paullagoguet-hue/couverture-mobile/blob/main/PRIVACY.md';
