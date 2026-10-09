/**
 * Pays pris en charge. Chaque pays a ses tuiles dans un sous-dossier de la
 * racine des données (France : la racine elle-même, pour compatibilité),
 * avec son propre manifest.json (donc ses opérateurs), et son propre géocodeur.
 */
import { BORDERS } from './borders.ts';

export type CountryCode = 'fr' | 'es' | 'pt' | 'be';

export interface Country {
  code: CountryCode;
  label: string;
  /** Dossier des tuiles, relatif à la racine des données. */
  path: string;
}

export const COUNTRIES: Record<CountryCode, Country> = {
  fr: { code: 'fr', label: 'France', path: '' },
  es: { code: 'es', label: 'Espagne', path: 'es/' },
  pt: { code: 'pt', label: 'Portugal', path: 'pt/' },
  be: { code: 'be', label: 'Belgique', path: 'be/' },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

export const isCountryCode = (c: unknown): c is CountryCode => typeof c === 'string' && c in COUNTRIES;

/** Codes ISO (2 et 3 lettres) et débuts de noms (français, anglais, espagnol, catalan). */
const ISO_CODES: Record<string, CountryCode> = { fr: 'fr', fra: 'fr', es: 'es', esp: 'es', pt: 'pt', prt: 'pt', be: 'be', bel: 'be' };
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

/** Dossier des tuiles d'un pays (URL absolue terminée par « / »). */
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

/** Espagne avant France (enclave de Llívia, cf. countryAt). */
const SEARCH_ORDER: CountryCode[] = ['es', 'fr', 'pt', 'be'];

/** Au-delà, un point hors des contours n'est rattaché à aucun pays (pleine mer). */
const COAST_TOLERANCE_KM = 5;

/**
 * Pays d'un point (contours simplifiés à ~30 m), ou null hors des pays pris
 * en charge (Andorre, pleine mer…).
 *  - L'Espagne est testée avant la France : son enclave de Llívia est un trou
 *    du contour français, non représenté.
 *  - Un point juste hors des contours (logement en bord de mer, littoral
 *    simplifié) est rattaché au pays le plus proche, à moins de 5 km.
 */
export function countryAt(lng: number, lat: number): CountryCode | null {
  if (BORDERS.ad?.some((ring) => inRing(ring, lng, lat))) return null;
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
  return nearest;
}
