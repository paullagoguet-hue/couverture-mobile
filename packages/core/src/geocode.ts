/**
 * Géocodage via le service de la Géoplateforme (IGN), qui expose la Base
 * Adresse Nationale : https://data.geopf.fr/geocodage
 * (l'ancienne API api-adresse.data.gouv.fr y redirige).
 */

export const GEOCODER_URL = 'https://data.geopf.fr/geocodage/search';

export type ResultType = 'housenumber' | 'street' | 'locality' | 'municipality';

export interface GeocodeResult {
  label: string; // ex. « 8 Boulevard du Port 80000 Amiens »
  type: ResultType;
  score: number; // pertinence 0..1
  lng: number;
  lat: number;
  citycode: string; // code INSEE de la commune
  city: string;
  context: string; // « 80, Somme, Hauts-de-France »
}

/** Requêtes trop courtes ou trop longues refusées par l'API (3 à 200 caractères). */
export function normalizeQuery(text: string): string | null {
  const q = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  return q.length >= 3 ? q : null;
}

export async function geocode(
  text: string,
  {
    limit = 5,
    autocomplete = false,
    signal,
    fetchFn = fetch,
  }: {
    limit?: number;
    /** Saisie en cours : l'API complète les mots partiels (« 15 bd de la lib »). */
    autocomplete?: boolean;
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
  } = {},
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
  }));
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
