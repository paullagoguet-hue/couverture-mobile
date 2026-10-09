/**
 * Géocodage, un service par pays :
 *  - France : Géoplateforme de l'IGN (Base Adresse Nationale),
 *    https://data.geopf.fr/geocodage (l'ancienne API api-adresse.data.gouv.fr y redirige) ;
 *  - Espagne : CartoCiudad (IGN espagnol / CNIG), https://www.cartociudad.es/geocoder.
 * Tous deux gratuits, sans clé et ouverts aux appels depuis le navigateur (CORS).
 */
import type { CountryCode } from './countries.ts';

export const GEOCODER_URL = 'https://data.geopf.fr/geocodage/search';
export const CARTOCIUDAD_URL = 'https://www.cartociudad.es/geocoder/api/geocoder';

export type ResultType = 'housenumber' | 'street' | 'locality' | 'municipality';

export interface GeocodeResult {
  label: string; // ex. « 8 Boulevard du Port 80000 Amiens »
  type: ResultType;
  score: number; // pertinence 0..1
  lng: number;
  lat: number;
  citycode: string; // code de la commune (INSEE en France, INE en Espagne)
  city: string;
  context: string; // « 80, Somme, Hauts-de-France »
  country: CountryCode;
  /** Position à demander au géocodeur avant usage (cf. resolvePlace) : CartoCiudad ne la donne pas toujours d'emblée. */
  ref?: { id: string; type: string };
}

interface GeocodeOptions {
  limit?: number;
  /** Saisie en cours : le service complète les mots partiels (« 15 bd de la lib »). */
  autocomplete?: boolean;
  country?: CountryCode;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

/** Requêtes trop courtes ou trop longues refusées par les services (3 à 200 caractères). */
export function normalizeQuery(text: string): string | null {
  const q = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  return q.length >= 3 ? q : null;
}

export function geocode(text: string, options: GeocodeOptions = {}): Promise<GeocodeResult[]> {
  return options.country === 'es' ? geocodeEs(text, options) : geocodeFr(text, options);
}

async function geocodeFr(
  text: string,
  { limit = 5, autocomplete = false, signal, fetchFn = fetch }: GeocodeOptions,
): Promise<GeocodeResult[]> {
  const q = normalizeQuery(text);
  if (!q) return [];
  const url = new URL(GEOCODER_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  if (autocomplete) url.searchParams.set('autocomplete', '1');
  const resp = await fetchFn(url, { signal });
  if (!resp.ok) throw new Error(`Géocodage indisponible (${resp.status})`);
  const json = await resp.json();
  return (json.features ?? []).map((f: any) => ({
    label: f.properties.label,
    type: f.properties.type,
    score: f.properties.score,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    citycode: f.properties.citycode,
    city: f.properties.city,
    context: f.properties.context,
    country: 'fr' as const,
  }));
}

// --- Espagne : CartoCiudad ---------------------------------------------------

/** Types CartoCiudad → types communs. */
const ES_TYPES: Record<string, ResultType> = {
  portal: 'housenumber',
  callejero: 'street',
  carretera: 'street',
  Municipio: 'municipality',
  poblacion: 'locality',
  codpost: 'locality',
  toponimo: 'locality',
  ngbe: 'locality',
};

/** « CALLE MAYOR 1 » → « Calle Mayor 1 » (CartoCiudad écrit les voies en capitales). */
const titleCase = (s: string) =>
  s === s.toUpperCase()
    ? s
        .toLowerCase()
        .replace(/(^|[\s'(/-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
        .replace(/ (De|Del|La|Las|Los|El|Y) /g, (w) => w.toLowerCase())
    : s;

/** Libellé lisible : voie en minuscules accentuées, sans répétition (« Toledo, Toledo » → « Toledo »). */
const esLabel = (address: unknown) =>
  [...new Set(String(address).split(',').map((part) => titleCase(part.trim())).filter(Boolean))].join(', ');

/** La commune du résultat est-elle écrite dans la requête (« … Madrid » → Madrid, pas Las Rozas de Madrid) ? */
const muniInQuery = (r: any, foldedQuery: string) =>
  !!r.muni && new RegExp(`(^|[^\\p{L}])${fold(String(r.muni)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(foldedQuery);

/**
 * CartoCiudad ne note pas ses réponses : on reconstitue un score pour
 * isUnambiguous. Le premier est retenu, sauf si le suivant est la même
 * adresse dans une autre commune tout aussi plausible (« Calle Mayor 1 » sans ville).
 */
function esScores(results: any[], foldedQuery: string): number[] {
  const street = (r: any) => String(r.address).split(',')[0].trim();
  const first = results[0];
  return results.map((r, i) =>
    i === 0
      ? 1
      : street(r) === street(first) && r.muniCode !== first.muniCode && muniInQuery(r, foldedQuery) === muniInQuery(first, foldedQuery)
        ? 0.95
        : 0.8,
  );
}

/** Types de voie espagnols : sans eux, CartoCiudad cherche mal (« Gran Vía 28 Madrid » → Mula). */
const ES_STREET_TYPE = /^(calle|c\/|avda\.?|avenida|plaza|pza\.?|paseo|pº|carrer|camino|carretera|ronda|travesía|travesia|glorieta|rambla|urbanización|urbanizacion|bulevar|callejón|pasaje|vía|via)\s/i;

/** Nettoyage pour CartoCiudad, qui ne trouve rien avec le pays ou le code postal : « Plaza Mayor 3, 28012 Madrid, España » → « Plaza Mayor 3 Madrid ». */
export function cleanAddressEs(text: string): string {
  return text
    .replace(/\b(España|Espanya|Spain|Espagne)\b/gi, '')
    .replace(/\b\d{5}\b/g, '')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function geocodeEs(text: string, { limit = 5, signal, fetchFn = fetch }: GeocodeOptions): Promise<GeocodeResult[]> {
  const q = normalizeQuery(cleanAddressEs(text));
  if (!q) return [];
  const candidates = async (query: string): Promise<any[]> => {
    const url = new URL(`${CARTOCIUDAD_URL}/candidates`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    const resp = await fetchFn(url, { signal });
    if (!resp.ok) throw new Error(`Géocodage indisponible (${resp.status})`);
    return resp.json();
  };
  const fq = fold(q);
  let json = await candidates(q);
  // Adresse avec numéro mais sans type de voie, et aucune réponse dans la commune
  // écrite : CartoCiudad s'égare (« Gran Vía 28 Madrid » → Mula). On réessaie avec « Calle ».
  if (/\d/.test(q) && !ES_STREET_TYPE.test(q) && !json.some((r) => muniInQuery(r, fq))) {
    const retry = await candidates(`Calle ${q}`);
    if (retry.some((r) => muniInQuery(r, fq))) json = retry;
  }
  // Réponses dans la commune écrite en tête (ordre d'origine conservé sinon).
  json = [...json.filter((r) => muniInQuery(r, fq)), ...json.filter((r) => !muniInQuery(r, fq))];
  const scores = esScores(json, fq);
  return json.map((r, i) => {
    const hasPosition = typeof r.lat === 'number' && r.lat !== 0;
    return {
      label: esLabel(r.address),
      type: ES_TYPES[r.type] ?? 'locality',
      score: scores[i],
      lng: hasPosition ? r.lng : 0,
      lat: hasPosition ? r.lat : 0,
      citycode: String(r.muniCode ?? ''),
      city: r.muni ?? '',
      context: [r.muni, r.province].filter(Boolean).filter((v, j, a) => a.indexOf(v) === j).join(', '),
      country: 'es' as const,
      ref: hasPosition ? undefined : { id: String(r.id), type: String(r.type) },
    };
  });
}

/** Complète la position d'un lieu si le géocodeur ne l'a pas donnée d'emblée (une requête). */
export async function resolvePlace(place: GeocodeResult, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<GeocodeResult> {
  if (!place.ref) return place;
  const url = new URL(`${CARTOCIUDAD_URL}/find`);
  url.searchParams.set('id', place.ref.id);
  url.searchParams.set('type', place.ref.type);
  const resp = await fetchFn(url, { signal });
  if (!resp.ok) throw new Error(`Géocodage indisponible (${resp.status})`);
  const r = await resp.json();
  if (typeof r?.lat !== 'number' || !r.lat) throw new Error('Position introuvable pour ce lieu');
  return { ...place, lng: r.lng, lat: r.lat, ref: undefined };
}

/**
 * Le meilleur résultat est-il assez net pour être choisi sans demander ?
 * Sinon l'interface propose la liste (ex. « Saint-Martin » : 5 communes à ~0,93).
 */
export function isUnambiguous(results: GeocodeResult[], minScore = 0.6, minGap = 0.1): boolean {
  if (!results.length || results[0].score < minScore) return false;
  return results.length === 1 || results[0].score - results[1].score >= minGap;
}

/**
 * Nettoie une adresse rédigée pour des humains avant géocodage :
 * « 39 rue Delambre, 14e arr., 75014 Paris, France » → « 39 rue Delambre, 75014 Paris »
 * (le géocodeur la trouve alors avec un score de 0,97 au lieu de 0,60).
 */
export function cleanAddress(text: string): string {
  return text
    .replace(/\b\d{1,2}(?:e|er|ème)\s+arr(?:ondissement|\.)?/gi, '') // « 14e arr. », « 1er arrondissement »
    .replace(/,?\s*France\s*$/i, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** Minuscules sans accents, pour comparer des débuts de mots. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Suggestions pendant la saisie. Le géocodeur français gère mal un dernier mot
 * tronqué (« 12 place bellecour ly » → Égreville au lieu de Lyon) : quand le
 * dernier mot fait 3 lettres ou moins, on cherche aussi sans lui, et on fait
 * remonter les lieux dont un mot commence par ces lettres (« ly » → Lyon).
 * CartoCiudad complète déjà les mots partiels.
 */
export async function suggestAddresses(
  text: string,
  { limit = 5, country = 'fr', signal, fetchFn = fetch }: Omit<GeocodeOptions, 'autocomplete'> = {},
): Promise<GeocodeResult[]> {
  if (country === 'es') return geocodeEs(text, { limit, signal, fetchFn });
  const q = normalizeQuery(text);
  if (!q) return [];
  const words = q.split(' ');
  const partial = words.length > 1 ? words[words.length - 1] : '';
  const withoutPartial = words.slice(0, -1).join(' ');
  const truncated = /^\p{L}{1,3}$/u.test(partial) && normalizeQuery(withoutPartial);

  const [full, rest] = await Promise.all([
    geocodeFr(q, { limit, autocomplete: true, signal, fetchFn }),
    truncated ? geocodeFr(withoutPartial, { limit: 10, autocomplete: true, signal, fetchFn }) : Promise.resolve([]),
  ]);
  const prefix = fold(partial);
  const boosted = rest
    .filter((r) => fold(`${r.label} ${r.context}`).split(/[\s,'-]+/).some((w) => w.startsWith(prefix)))
    .map((r) => ({ ...r, score: r.score + 0.2 }));

  // Fusion sans doublons, meilleur score d'abord.
  const byLabel = new Map<string, GeocodeResult>();
  for (const r of [...full, ...boosted]) {
    const prev = byLabel.get(r.label);
    if (!prev || r.score > prev.score) byLabel.set(r.label, r);
  }
  return [...byLabel.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Mots qui trahissent une adresse espagnole. */
const SPANISH_HINT = /(^|[\s,])(calle|c\/|avda\.?|avenida|plaza|pza\.?|paseo|carrer|camino|carretera|travesía|urbanización|españa|spain|espagne)(?=[\s,.]|$)/i;

/**
 * Texte dont on ignore le pays (texte sélectionné, adresse d'annonce) : les
 * géocodeurs des deux pays en parallèle, puis choix de la réponse la plus crédible.
 * Le géocodeur français répond presque toujours quelque chose, même pour
 * « Calle Mayor 1 Madrid » (« Rue de Madrid », score faible) ou « Benidorm »
 * (« Rue de Benidorm, Perpignan », 0,70) :
 *  1. un lieu dont le nom est exactement le texte (« Benidorm », « Toulouse ») l'emporte ;
 *  2. puis un indice espagnol (« calle », « plaza », « España »…) ;
 *  3. puis le français s'il est sûr de lui (score ≥ 0,6) ;
 *  4. sinon l'espagnol s'il a trouvé quelque chose, à défaut le français.
 */
export async function geocodeAnyCountry(
  text: string,
  { limit = 5, signal, fetchFn = fetch }: Omit<GeocodeOptions, 'country' | 'autocomplete'> = {},
): Promise<GeocodeResult[]> {
  const [fr, es] = await Promise.allSettled([
    geocodeFr(text, { limit, signal, fetchFn }),
    geocodeEs(text, { limit, signal, fetchFn }),
  ]);
  if (fr.status === 'rejected' && es.status === 'rejected') throw fr.reason;
  const frResults = fr.status === 'fulfilled' ? fr.value : [];
  const esResults = es.status === 'fulfilled' ? es.value : [];

  const wanted = fold(text.replace(/\s+/g, ' ').trim());
  const isPlaceNamed = (r: GeocodeResult) => (r.type === 'municipality' || r.type === 'locality') && fold(r.label.split(',')[0].trim()) === wanted;
  const frExact = frResults.some(isPlaceNamed);
  const esExact = esResults.some(isPlaceNamed);
  if (esExact && !frExact) return esResults;
  if (frExact && !esExact) return frResults;
  if (esResults.length && SPANISH_HINT.test(text)) return esResults;
  if (frResults.length && frResults[0].score >= 0.6) return frResults;
  return esResults.length ? esResults : frResults;
}
