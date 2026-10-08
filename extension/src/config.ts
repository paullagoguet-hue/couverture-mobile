/**
 * Adresses réseau de l'extension, fixées à la compilation (variables VITE_*).
 * Elles déterminent aussi la CSP du manifeste (cf. build.ts) : l'extension ne
 * peut contacter QUE le géocodeur et l'hébergement des tuiles.
 */

/** Dossier contenant manifest.json et les .pmtiles (en dev : le serveur Vite du site). */
export const TILES_BASE_URL: string = import.meta.env.VITE_TILES_BASE_URL ?? 'http://127.0.0.1:5173/tiles/';

/** Site de la carte complète, ouvert par le lien « Voir sur la carte complète ». */
export const SITE_URL: string = import.meta.env.VITE_SITE_URL ?? 'http://127.0.0.1:5173/';

/** Mention obligatoire affichée avec chaque résultat. */
export const DISCLAIMER = 'Couverture théorique extérieure, source Arcep';
