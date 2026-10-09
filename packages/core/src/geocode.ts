/**
 * Géocodage, un service par pays :
 *  - France : Géoplateforme de l'IGN (Base Adresse Nationale),
 *    https://data.geopf.fr/geocodage (l'ancienne API api-adresse.data.gouv.fr y redirige) ;
 *  - Espagne : CartoCiudad (IGN espagnol / CNIG), https://www.cartociudad.es/geocoder ;
 *  - Suisse : service de recherche de geo.admin.ch (registre officiel des adresses, swisstopo) ;
 *  - Portugal, Belgique, Luxembourg, Italie : Photon (données OpenStreetMap), hébergé par nos soins
 *    (cf. configureGeocoders) faute de géocodeur public national ouvert et sans
 *    clé ; réponses limitées au pays. Le serveur public photon.komoot.io ne
 *    convient pas à une extension (usage limité, blocage en cas de rafale).
 * Tous gratuits, sans clé et ouverts aux appels depuis le navigateur (CORS).
 */
import type { CountryCode } from './countries.ts';

export const GEOCODER_URL = 'https://data.geopf.fr/geocodage/search';
export const CARTOCIUDAD_URL = 'https://www.cartociudad.es/geocoder/api/geocoder';
/** Point d'accès Photon (« …/api ») ; à configurer par l'application (cf. configureGeocoders). */
let photonUrl = 'http://127.0.0.1:2322/api';

/** Adresse de notre serveur Photon (compilation : variable d'environnement de l'application). */
export function configureGeocoders(options: { photonUrl?: string }) {
  if (options.photonUrl) photonUrl = options.photonUrl;
}

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
  switch (options.country) {
    case 'es':
      return geocodeEs(text, options);
    case 'pt':
    case 'be':
    case 'lu':
    case 'it':
      return geocodePhoton(text, options.country, options);
    case 'ch':
      return geocodeCh(text, options);
    default:
      return geocodeFr(text, options);
  }
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
/**
 * Le nom (commune…) figure-t-il comme mot entier dans le texte déjà normalisé (fold) ?
 * Noms bilingues (« Bruxelles - Brussel », « Alacant/Alicante ») : une des formes suffit.
 */
const nameInText = (name: unknown, foldedText: string) =>
  !!name &&
  String(name)
    .split(/\s+-\s+|\/|\s*\(/)
    .map((part) => fold(part.replace(/\)$/, '').trim()))
    .filter(Boolean)
    .some((part) => new RegExp(`(^|[^\\p{L}])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(foldedText));

const muniInQuery = (r: any, foldedQuery: string) => nameInText(r.muni, foldedQuery);

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

// --- Portugal, Belgique : Photon (OpenStreetMap) -------------------------------

/** Mots trop courants dans les adresses pour prouver qu'un résultat correspond à la recherche. */
const COMMON_WORDS = new Set(
  'rue avenue boulevard chemin place quai impasse allee route rua avenida travessa largo praca estrada calle carrer plaza paseo camino straat laan weg plein steenweg dreef kaai lei strasse gasse platz via viale vicolo piazza piazzale corso contrada localita frazione des del della dei degli delle dos das les los las van der het den sur pres'.split(' '),
);

/** Mots significatifs d'un texte : minuscules sans accents, 3 lettres ou plus, hors numéros et mots courants. */
const significantWords = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !COMMON_WORDS.has(w));

/** Emprise de chaque pays (Açores et Madère comprises) ; les réponses sont ensuite filtrées sur le pays. */
const PHOTON_BBOX: Partial<Record<CountryCode, string>> = {
  pt: '-31.6,32.3,-6.1,42.2',
  be: '2.5,49.45,6.45,51.55',
  lu: '5.7,49.4,6.55,50.2',
  it: '6.6,35.4,18.6,47.1',
};
type PhotonCountry = 'pt' | 'be' | 'lu' | 'it';

/** Types Photon → types communs (ville = commune ; village, hameau… = lieu-dit). */
const PT_TYPES: Record<string, ResultType> = { house: 'housenumber', street: 'street', city: 'municipality', town: 'municipality' };

async function geocodePhoton(text: string, country: PhotonCountry, { limit = 5, signal, fetchFn = fetch }: GeocodeOptions): Promise<GeocodeResult[]> {
  // Nom du pays en fin d'adresse retiré (« …, Portugal ») ; pas « Luxembourg », qui est aussi la capitale.
  const q = normalizeQuery(text.replace(/,\s*(Portugal|Belgique|Belgium|België|Belgie|Belgien|Italia|Italy|Italie|Italien)\s*$/i, ''));
  if (!q) return [];
  const fq = fold(q);

  // Photon renvoie toujours quelque chose, même sans rapport (« Bonneval-sur-Arc »
  // cherché en Belgique -> une rue de Charleroi, ou de Stoumont via « arc ») : on
  // exige le mot le plus long de la recherche, ou au moins deux mots significatifs.
  const wanted = significantWords(q);
  const longest = wanted.reduce((a, b) => (b.length > a.length ? b : a), '');
  const related = (f: any) => {
    if (!wanted.length) return true;
    const p = f.properties ?? {};
    const found = new Set(significantWords([p.name, p.street, p.city, p.town, p.village, p.county, p.district, p.locality].filter(Boolean).join(' ')));
    return found.has(longest) || wanted.filter((w) => found.has(w)).length >= 2;
  };
  // Rue, puis commune : « Via Roma 1, Carrara », ou sans virgule « Via Roma 1 Carrara ».
  // « Roma » est ici le nom de la rue, pas la commune.
  const comma = q.indexOf(',');
  const num = /\s\d+[a-z]?\b/i.exec(q);
  const streetPart = comma >= 0 ? q.slice(0, comma) : num ? q.slice(0, num.index) : '';
  const townPart = fold(comma >= 0 ? q.slice(comma + 1) : num ? q.slice(num.index + num[0].length) : q);
  const streetWords = significantWords(streetPart);
  /** Une adresse ou une rue trouvée doit porter un mot de la rue écrite (« Via Roma 1 » ≠ « Via Columbia 1, Roma »). */
  const onStreet = (f: any) => {
    const p = f.properties;
    if (!streetWords.length || !['house', 'street'].includes(p.type)) return true;
    // Adresse : sa rue (son nom est souvent celui du bâtiment : « Università di Roma… ») ; rue : son nom.
    const found = new Set(significantWords(String((p.type === 'house' ? p.street : p.name) ?? p.name ?? '')));
    return streetWords.some((w) => found.has(w));
  };
  /** Le résultat est-il dans la commune écrite ? (Pour une ville, son propre nom.) */
  const inTown = (f: any) => {
    const p = f.properties;
    const isPlace = !['house', 'street'].includes(p.type);
    return [p.city, p.town, p.village, isPlace ? p.name : undefined].some((name) => nameInText(name, townPart));
  };

  const search = async (query: string): Promise<any[]> => {
    const url = new URL(photonUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit * 2)); // une partie peut tomber hors du pays
    url.searchParams.set('lang', 'default'); // noms locaux
    url.searchParams.set('bbox', PHOTON_BBOX[country]!);
    const resp = await fetchFn(url, { signal });
    if (!resp.ok) throw new Error(`Géocodage indisponible (${resp.status})`);
    const json = await resp.json();
    return (json.features ?? []).filter((f: any) => f.properties?.countrycode === country.toUpperCase() && related(f) && onStreet(f));
  };

  let features = await search(q);
  // Numéro absent d'OpenStreetMap dans la commune écrite : Photon préfère ce numéro
  // ailleurs (« Avenue de la Gare 1, Esch-sur-Alzette » -> Lamadelaine). Mieux vaut
  // la rue dans la bonne commune : nouvel essai sans le numéro.
  if (/\d/.test(q) && q.includes(',') && !features.some(inTown)) {
    const retry = await search(q.replace(/\b\d+[a-z]?\b/gi, '').replace(/\s+/g, ' ').replace(/\s+,/g, ','));
    if (retry.some(inTown)) features = retry;
  }
  // En tête : les résultats dans la commune écrite, puis, pour une adresse avec numéro, les « maisons ».
  const rank = (f: any) => (inTown(f) ? 0 : 2) + (/\d/.test(q) && f.properties.type !== 'house' ? 1 : 0);
  features.sort((a, b) => rank(a) - rank(b)); // tri stable : l'ordre de Photon départage

  const results = features.map((f) => {
    const p = f.properties;
    const town = p.city ?? p.town ?? p.village ?? p.county ?? '';
    const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '';
    const head = p.type === 'house' && street ? street : p.name ?? street;
    const tail = [p.postcode, town].filter(Boolean).join(' ');
    return {
      label: [...new Set([head, tail].filter(Boolean))].join(', '),
      head,
      streetName: fold(String((p.type === 'house' ? p.street : p.name) ?? '')),
      type: PT_TYPES[p.type] ?? 'locality',
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      town,
      context: [...new Set([town, p.county, p.state].filter(Boolean))].join(', '),
    };
  });
  // Doublons d'OpenStreetMap (même adresse sur l'entrée et le bâtiment) : le premier seulement.
  const unique = results.filter((r, i) => results.findIndex((o) => o.label === r.label) === i).slice(0, limit);
  // Sans commune écrite, la même rue dans plusieurs communes : choix proposé (« Via Roma 1 »).
  const noTown = !significantWords(townPart).length || townPart === fq;
  const first = unique[0];
  return unique.map((r, i) => ({
    label: r.label,
    type: r.type,
    score: i === 0 ? 1 : noTown && streetWords.length && r.streetName && r.streetName === first.streetName && r.town !== first.town ? 0.95 : 0.8,
    lng: r.lng,
    lat: r.lat,
    citycode: '',
    city: r.town,
    context: r.context,
    country,
  }));
}

// --- Suisse : geo.admin.ch -----------------------------------------------------

export const GEOADMIN_SEARCH_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';

/** Origines geo.admin.ch → types communs (gg25 : communes). */
const CH_TYPES: Record<string, ResultType> = { address: 'housenumber', gg25: 'municipality', zipcode: 'locality' };

async function geocodeCh(text: string, { limit = 5, signal, fetchFn = fetch }: GeocodeOptions): Promise<GeocodeResult[]> {
  const q = normalizeQuery(text.replace(/,?\s*(Schweiz|Suisse|Svizzera|Svizra|Switzerland|Suiza)\s*$/i, ''));
  if (!q) return [];
  const url = new URL(GEOADMIN_SEARCH_URL);
  url.search = new URLSearchParams({ searchText: q, type: 'locations', origins: 'address,gg25,zipcode', limit: String(limit * 3), sr: '4326' }).toString();
  const resp = await fetchFn(url, { signal });
  if (!resp.ok) throw new Error(`Géocodage indisponible (${resp.status})`);
  const json = await resp.json();
  const fq = fold(q);

  let rows = (json.results ?? [])
    .map((r: any) => r.attrs)
    .filter((a: any) => a && typeof a.lat === 'number' && CH_TYPES[a.origin])
    .map((a: any) => {
      // « Bahnhofstrasse 10 <b>8001 Zürich</b> », « <b>Lausanne (VD)</b> »
      // « # » : bâtiment sans numéro.
      const plain = String(a.label).replace(/<[^>]+>/g, '').replace(/\s#(?=\s|$)/, '').replace(/\s+/g, ' ').trim();
      const m = /^(.*?)\s+(\d{4})\s+(.+)$/.exec(plain);
      const city = (m ? m[3] : plain).replace(/\s*\([A-Z]{2}\)$/, '');
      const canton = /\b([a-z]{2})$/.exec(String(a.detail ?? ''))?.[1]?.toUpperCase() ?? '';
      return { a, head: m ? m[1] : plain, label: m ? `${m[1]}, ${m[2]} ${m[3]}` : plain, city, canton };
    });
  // Réponses sans rapport (le service cherche aussi par approximation) : même filtre que pour Photon.
  const wanted = significantWords(q);
  const longest = wanted.reduce((x, y) => (y.length > x.length ? y : x), '');
  rows = rows.filter((r: any) => {
    const found = new Set(significantWords(r.label));
    return !wanted.length || found.has(longest) || wanted.filter((w) => found.has(w)).length >= 2;
  });
  // Le service complète les numéros (« … 10 » -> 10, 100, 102…) : le numéro exact d'abord, seul s'il existe.
  const num = /\b(\d+[a-z]?)(?![\p{L}\p{N}])/iu.exec(q.replace(/\b\d{4}\b/g, ''))?.[1]?.toLowerCase();
  if (num) {
    const exact = (r: any) => r.a.origin === 'address' && r.head.replace(/(\d)\s+([a-z])$/i, '$1$2').toLowerCase().endsWith(` ${num}`);
    if (rows.some(exact)) rows = rows.filter((r: any) => r.a.origin !== 'address' || exact(r));
  }
  // En tête : la commune écrite ; sans numéro, les communes avant les adresses.
  const rank = (r: any) => (nameInText(r.city, fq) ? 0 : 2) + (!/\d/.test(q) && r.a.origin !== 'gg25' ? 1 : 0);
  rows.sort((x: any, y: any) => rank(x) - rank(y));
  rows = rows.slice(0, limit);

  const first = rows[0];
  return rows.map((r: any, i: number) => ({
    label: r.label,
    type: CH_TYPES[r.a.origin],
    // Même adresse dans une autre commune, aussi plausible : choix proposé.
    score: i === 0 ? 1 : r.head === first.head && r.city !== first.city && nameInText(r.city, fq) === nameInText(first.city, fq) ? 0.95 : 0.8,
    lng: r.a.lon,
    lat: r.a.lat,
    citycode: '',
    city: r.city,
    context: [r.city, r.canton].filter(Boolean).join(', '),
    country: 'ch' as const,
  }));
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
  if (country === 'pt' || country === 'be' || country === 'lu' || country === 'it') return geocodePhoton(text, country, { limit, signal, fetchFn });
  if (country === 'ch') return geocodeCh(text, { limit, signal, fetchFn });
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
