/** Paramètres de l'application, surchargeables à la compilation via les variables VITE_*. */

/** Dossier (ou URL) contenant les fichiers <couche>.pmtiles et manifest.json. */
export const TILES_BASE_URL: string = import.meta.env.VITE_TILES_BASE_URL ?? '/tiles/';

/** Fond de carte vectoriel gratuit, sans clé d'API. */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Vue initiale : France métropolitaine. */
export const FRANCE_BOUNDS: [[number, number], [number, number]] = [
  [-5.3, 41.2],
  [9.7, 51.2],
];
