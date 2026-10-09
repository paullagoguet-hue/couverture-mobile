/**
 * Pays pris en charge. Chaque pays a ses tuiles dans un sous-dossier de la
 * racine des données (France : la racine elle-même, pour compatibilité),
 * avec son propre manifest.json (donc ses opérateurs), et son propre géocodeur.
 */
import { BORDERS } from './borders.ts';

export type CountryCode = 'fr' | 'es' | 'pt' | 'be' | 'lu' | 'it' | 'ch';

export interface Country {
  code: CountryCode;
  label: string;
  /** Dossier des tuiles, relatif à la racine des données. */
  path: string;
  /**
   * Données publiées : couverture par opérateur (nos tuiles), ou seulement le
   * nombre de réseaux, lu en direct aux services officiels (cf. networks.ts).
   */
  data: 'operators' | 'networks';
}

export const COUNTRIES: Record<CountryCode, Country> = {
  fr: { code: 'fr', label: 'France', path: '', data: 'operators' },
  es: { code: 'es', label: 'Espagne', path: 'es/', data: 'operators' },
  pt: { code: 'pt', label: 'Portugal', path: 'pt/', data: 'operators' },
  be: { code: 'be', label: 'Belgique', path: 'be/', data: 'operators' },
  lu: { code: 'lu', label: 'Luxembourg', path: 'lu/', data: 'operators' },
  it: { code: 'it', label: 'Italie', path: '', data: 'networks' },
  ch: { code: 'ch', label: 'Suisse', path: '', data: 'networks' },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

export const isCountryCode = (c: unknown): c is CountryCode => typeof c === 'string' && c in COUNTRIES;

/** Codes ISO (2 et 3 lettres) et débuts de noms (français, anglais, espagnol, catalan). */
const ISO_CODES: Record<string, CountryCode> = { fr: 'fr', fra: 'fr', es: 'es', esp: 'es', pt: 'pt', prt: 'pt', be: 'be', bel: 'be', lu: 'lu', lux: 'lu', it: 'it', ita: 'it', ch: 'ch', che: 'ch' };
const NAME_PREFIXES: [string, CountryCode][] = [
  ['france', 'fr'],
  ['francia', 'fr'],
  ['espagne', 'es'],
  ['spain', 'es'],
  ['espana', 'es'],
  ['espanya', 'es'],
  ['portugal', 'pt'],
  ['belgique', 'be'],
  ['belgium', 'be'],
  ['belgie', 'be'],
  ['belgien', 'be'],
  ['luxembourg', 'lu'],
  ['luxemburg', 'lu'],
  ['italie', 'it'],
  ['italy', 'it'],
  ['italia', 'it'],
  ['italien', 'it'],
  ['suisse', 'ch'],
  ['switzerland', 'ch'],
  ['schweiz', 'ch'],
  ['svizzera', 'ch'],
  ['suiza', 'ch'],
  ['svizra', 'ch'],
];

/**
 * Pays d'un texte publié par une annonce (« ES », « España », « France métropolitaine »).
 * @returns le pays pris en charge, 'other' pour un autre pays, null si le texte est vide.
 */
export function countryFromText(value: string | undefined): CountryCode | 'other' | null {
  const key = (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!key) return null;
  return ISO_CODES[key] ?? NAME_PREFIXES.find(([prefix]) => key.startsWith(prefix))?.[1] ?? 'other';
}

/** Pays d'un nom de domaine national (« www.idealista.pt » -> pt) ; null pour .com, .net… */
export function countryFromHost(hostname: string | undefined): CountryCode | null {
  const tld = (hostname ?? '').toLowerCase().replace(/\.$/, '').split('.').pop() ?? '';
  return isCountryCode(tld) ? tld : null;
}

/** Dossier des tuiles d'un pays à couverture par opérateur (URL absolue terminée par « / »). */
export const tilesBaseFor = (root: string, country: CountryCode) => new URL(COUNTRIES[country].path, root).href;

function inRing(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance approximative (km) d'un point à un contour. */
function distanceKm(ring: number[][], x: number, y: number): number {
  const kx = 111.32 * Math.cos((y * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - x) * kx, ay = (ring[j][1] - y) * ky;
    const bx = (ring[i][0] - x) * kx, by = (ring[i][1] - y) * ky;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Espagne avant France (enclave de Llívia), Italie avant Suisse (Campione d'Italia), cf. countryAt. */
const SEARCH_ORDER: CountryCode[] = ['es', 'fr', 'pt', 'be', 'lu', 'it', 'ch'];

/** Territoires non pris en charge, trous de nos contours ou coincés entre eux : testés en premier. */
const ENCLAVES = ['ad', 'mc', 'sm', 'va', 'busingen'];
/** Voisins non pris en charge : testés après nos pays, avant la tolérance côtière (Constance n'est pas en Suisse). */
const NEIGHBOURS = ['li', 'de', 'at', 'nl', 'si'];
const inAny = (codes: string[], lng: number, lat: number) => codes.some((code) => BORDERS[code]?.some((ring) => inRing(ring, lng, lat)));

/** Au-delà, un point hors des contours n'est rattaché à aucun pays (pleine mer). */
const COAST_TOLERANCE_KM = 5;
/** En deçà, un point chez un voisin reste rattaché à notre pays le plus proche (imprécision des contours). */
const BORDER_MARGIN_KM = 0.5;

/**
 * Pays d'un point (contours simplifiés à ~30 m), ou null hors des pays pris
 * en charge (Andorre, Allemagne, pleine mer…).
 *  - L'Espagne est testée avant la France : son enclave de Llívia est un trou
 *    du contour français, non représenté ; de même l'Italie avant la Suisse.
 *  - Un point juste hors des contours (logement en bord de mer, littoral
 *    simplifié) est rattaché au pays le plus proche, à moins de 5 km, sauf
 *    s'il tombe chez un voisin non pris en charge (Allemagne, Autriche…).
 */
export function countryAt(lng: number, lat: number): CountryCode | null {
  if (inAny(ENCLAVES, lng, lat)) return null;
  for (const code of SEARCH_ORDER) {
    if (BORDERS[code]?.some((ring) => inRing(ring, lng, lat))) return code;
  }
  let nearest: CountryCode | null = null;
  let best = COAST_TOLERANCE_KM;
  for (const code of SEARCH_ORDER) {
    for (const ring of BORDERS[code] ?? []) {
      const d = distanceKm(ring, lng, lat);
      if (d < best) (best = d), (nearest = code);
    }
  }
  // Chez un voisin, sauf tout contre la frontière (contours au 1:1 000 000 : Schengen, au bord de la Moselle).
  if (best > BORDER_MARGIN_KM && inAny(NEIGHBOURS, lng, lat)) return null;
  return nearest;
}
