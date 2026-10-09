/**
 * Pays dont le régulateur ne publie que le NOMBRE de réseaux qui couvrent
 * chaque carré de 100 m, sans dire lesquels :
 *  - Italie : AGCOM, « Broadband Map », zones lues au service ArcGIS public ;
 *  - Suisse : OFCOM, « Atlas du haut débit », GeoTIFF optimisé (COG) sur
 *    data.geo.admin.ch, dont on ne lit que le morceau utile (requêtes Range).
 * Lecture en direct aux services officiels : aucune tuile à héberger. La
 * mini-carte dessine les zones lues (Italie) ou les images du service (Suisse).
 */
import { abortable, SHARED_FETCH_TIMEOUT_MS } from './async.ts';
import { pointsAround } from './coverage.ts';
import type { CountryCode } from './countries.ts';

export type NetworkCountry = 'it' | 'ch';
export type NetworkTechno = '4g' | '5g';
export const NETWORK_TECHNOS: NetworkTechno[] = ['5g', '4g'];

export interface NetworkSource {
  country: NetworkCountry;
  /** Producteur des données (nom propre). */
  producer: string;
  /** Réseaux du pays : le nombre publié va de 0 à leur total. */
  operators: string[];
  /** Suisse : images de la carte officielle par techno (modèle {z}/{x}/{y}) ; Italie : zones dessinées par nos soins. */
  overlay?: Record<NetworkTechno, string>;
  /** Couleurs de la carte, de 1 réseau au total (celles de la légende officielle). */
  colors: string[];
}

const AGCOM = 'https://geo3.agcom.it/MapET-SFS/rest/services/Grid100';
/** « 5G » : la couche « 5G_DSS » d'AGCOM compte toute la 5G (DSS comprise : partout au moins autant de réseaux que la couche « 5G »). */
const AGCOM_LAYERS: Record<NetworkTechno, string> = { '4g': 'mobile_4G', '5g': 'mobile_5G_DSS' };
const OFCOM = (techno: NetworkTechno) => `https://data.geo.admin.ch/ch.bakom.mobilnetz-${techno}/mobilnetz-${techno}/mobilnetz-${techno}_2056.tif`;
const OFCOM_STAC = (techno: NetworkTechno) => `https://data.geo.admin.ch/api/stac/v0.9/collections/ch.bakom.mobilnetz-${techno}/items`;

export const NETWORK_SOURCES: Record<NetworkCountry, NetworkSource> = {
  it: {
    country: 'it',
    producer: 'AGCOM',
    operators: ['TIM', 'Vodafone', 'WindTre', 'Iliad'],
    colors: ['#ff2600', '#ffbb00', '#38a800', '#0084a8'],
  },
  ch: {
    country: 'ch',
    producer: 'OFCOM',
    operators: ['Swisscom', 'Sunrise', 'Salt'],
    overlay: {
      '4g': 'https://wmts.geo.admin.ch/1.0.0/ch.bakom.mobilnetz-4g/default/current/3857/{z}/{x}/{y}.png',
      '5g': 'https://wmts.geo.admin.ch/1.0.0/ch.bakom.mobilnetz-5g/default/current/3857/{z}/{x}/{y}.png',
    },
    colors: ['#ffba00', '#ffba00', '#009600'], // la carte suisse ne distingue que « moins de 3 » et « 3 »
  },
};

export const isNetworkCountry = (c: CountryCode): c is NetworkCountry => c === 'it' || c === 'ch';

/** Nombre de réseaux d'une techno, au point ou (rayon) sur une zone. */
export interface NetworkCount {
  techno: NetworkTechno;
  total: number;
  /** Au point ; sur une zone, le nombre le plus fréquent (à égalité, le plus grand). */
  count: number;
  /** Zone : part des points échantillonnés par nombre de réseaux (« 0 » à « 4 »). */
  area?: { radiusM: number; samples: number; shares: Record<string, number> };
  /** Italie : zones lues autour du lieu, à dessiner sur la mini-carte (propriété n : nombre de réseaux). */
  shapes?: NetworkShapes;
}

export interface NetworkShapes {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: { n: number }; geometry: { type: 'MultiPolygon'; coordinates: number[][][][] } }[];
}

// --- Italie : AGCOM ----------------------------------------------------------------

/**
 * Le service d'AGCOM répond lentement par moments (4 à 6 s par requête, 6 à
 * la fois depuis le navigateur) : une requête par point d'une zone pouvait
 * prendre 20 s. On demande donc, en UNE requête par techno, les zones
 * (polygones) autour du lieu ; le nombre de réseaux en chaque point est lu
 * localement, et ces mêmes zones sont dessinées sur la mini-carte.
 *
 * Les images de carte d'AGCOM (et donc sa propre carte) ne sont pas utilisées :
 * une partie des zones y manque. Leurs contours sont enregistrés dans le sens
 * inverse de la convention ArcGIS, et son moteur de rendu les ignore (constaté :
 * 4 points sur 19 affichés « sans réseau » alors que la donnée en compte 2 ou 3).
 * D'où, ici, la règle pair-impair, indépendante du sens des contours.
 */
const AGCOM_MARGIN_M = 1500;

interface AgcomZone {
  n: number;
  rings: number[][][];
}

/** Zones d'une techno dans un carré de demi-côté halfM (m) autour du point. */
async function agcomZones(techno: NetworkTechno, lng: number, lat: number, halfM: number, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<AgcomZone[]> {
  const dLat = halfM / 111_320;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const url = new URL(`${AGCOM}/${AGCOM_LAYERS[techno]}/MapServer/0/query`);
  url.search = new URLSearchParams({
    geometry: [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((v) => v.toFixed(5)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'n_infrastrutture_totali',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  }).toString();
  const resp = await fetchFn(url, { signal });
  if (!resp.ok) throw new Error(`AGCOM indisponible (${resp.status})`);
  const json = await resp.json();
  if (json.error) throw new Error(`AGCOM : ${json.error.message ?? 'erreur'}`);
  return (json.features ?? [])
    .map((f: any) => ({ n: Number(f.attributes?.n_infrastrutture_totali) || 0, rings: f.geometry?.rings ?? [] }))
    .filter((z: AgcomZone) => z.n > 0 && z.rings.length);
}

/** Règle pair-impair sur tous les anneaux : vraie quel que soit leur sens. */
function inRings(rings: number[][][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Nombre de réseaux en un point : la zone qui le contient (la plus forte si deux se touchent). */
const countAt = (zones: AgcomZone[], [x, y]: [number, number]) => zones.reduce((best, z) => (z.n > best && inRings(z.rings, x, y) ? z.n : best), 0);

/**
 * Anneaux en vrac -> MultiPolygon GeoJSON (contour extérieur puis trous) pour
 * la mini-carte : chaque anneau est rattaché au plus petit qui le contient ;
 * profondeur paire = contour extérieur, impaire = trou.
 */
export function ringsToMultiPolygon(rings: number[][][]): number[][][][] {
  const info = rings
    .map((ring) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, a = 0;
      ring.forEach(([x, y], i) => {
        (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
        const [x2, y2] = ring[(i + 1) % ring.length];
        a += x * y2 - x2 * y;
      });
      return { ring, bbox: [x0, y0, x1, y1], area: Math.abs(a / 2), depth: 0, polygon: -1 };
    })
    .sort((p, q) => q.area - p.area);
  const polygons: number[][][][] = [];
  info.forEach((r, i) => {
    const [px, py] = r.ring[0];
    let parent: (typeof info)[number] | undefined;
    for (let k = i - 1; k >= 0; k--) {
      const c = info[k];
      const [x0, y0, x1, y1] = c.bbox;
      if (px < x0 || px > x1 || py < y0 || py > y1 || c.area <= r.area) continue;
      if (inRings([c.ring], px, py)) {
        parent = c; // parcours du plus petit au plus grand : le premier trouvé est le plus proche
        break;
      }
    }
    r.depth = parent ? parent.depth + 1 : 0;
    if (r.depth % 2 === 0) {
      r.polygon = polygons.length;
      polygons.push([r.ring]);
    } else {
      polygons[parent!.polygon].push(r.ring);
    }
  });
  return polygons;
}

// --- Suisse : OFCOM (GeoTIFF optimisé) ------------------------------------------

/**
 * WGS84 -> MN95 (EPSG:2056), formules approchées de swisstopo (précision ~1 m,
 * largement assez pour des carrés de 100 m).
 */
export function toLv95(lng: number, lat: number): [number, number] {
  const p = (lat * 3600 - 169028.66) / 10000;
  const l = (lng * 3600 - 26782.5) / 10000;
  const e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3;
  const n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3;
  return [e, n];
}

/** Décompression LZW des TIFF (codes de 9 à 12 bits, poids fort d'abord, changement de taille anticipé). */
export function lzwDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const prefix = new Int32Array(4096).fill(-1);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) (suffix[i] = i), (length[i] = 1);
  let next = 258, width = 9, prev = -1, op = 0, bit = 0;
  const totalBits = input.length * 8;
  const read = () => {
    if (bit + width > totalBits) return 257;
    let v = 0;
    for (let i = 0; i < width; i++, bit++) v = (v << 1) | ((input[bit >> 3] >> (7 - (bit & 7))) & 1);
    return v;
  };
  const first = (code: number) => {
    while (prefix[code] !== -1) code = prefix[code];
    return suffix[code];
  };
  const write = (code: number) => {
    const len = length[code];
    for (let i = len - 1, c = code; i >= 0; i--, c = prefix[c]) if (op + i < expected) out[op + i] = suffix[c];
    op += len;
  };
  const add = (p: number, c: number) => {
    if (next >= 4096) return;
    prefix[next] = p;
    suffix[next] = c;
    length[next] = length[p] + 1;
    next++;
  };
  for (;;) {
    const code = read();
    if (code === 257 || op >= expected) break;
    if (code === 256) {
      (next = 258), (width = 9), (prev = -1);
      continue;
    }
    if (prev === -1) write(code);
    else if (code < next) {
      write(code);
      add(prev, first(code));
    } else {
      add(prev, first(prev));
      write(code);
    }
    prev = code;
    if (next >= (1 << width) - 1 && width < 12) width++;
  }
  return out;
}

interface CogHeader {
  littleEndian: boolean;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  offsets: number[];
  byteCounts: number[];
  /** Origine (coin haut gauche) et taille de pixel, en mètres MN95. */
  x0: number;
  y0: number;
  sx: number;
  sy: number;
}

/** En-tête d'un GeoTIFF tuilé (première image, la pleine résolution) : tout tient dans les premiers Ko d'un COG. */
export function parseCogHeader(buf: ArrayBuffer): CogHeader {
  const v = new DataView(buf);
  const le = v.getUint16(0) === 0x4949;
  if (v.getUint16(2, le) !== 42) throw new Error('GeoTIFF illisible');
  const ifd = v.getUint32(4, le);
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 };
  const tags = new Map<number, number[]>();
  for (let i = 0, n = v.getUint16(ifd, le); i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
    const size = SIZES[type] ?? 1;
    const at = size * count <= 4 ? e + 8 : v.getUint32(e + 8, le);
    if (at + size * count > buf.byteLength) throw new Error('En-tête GeoTIFF incomplet');
    const read = (k: number) => {
      const o = at + k * size;
      return type === 3 ? v.getUint16(o, le) : type === 4 ? v.getUint32(o, le) : type === 12 ? v.getFloat64(o, le) : v.getUint8(o);
    };
    if (type !== 2) tags.set(tag, Array.from({ length: count }, (_, k) => read(k)));
  }
  const one = (tag: number) => tags.get(tag)?.[0];
  if (one(259) !== 5 || one(339) !== 3 || one(258) !== 32 || (one(317) ?? 1) !== 1) throw new Error('GeoTIFF : format inattendu');
  const [sx, sy] = tags.get(33550)!; // ModelPixelScale
  const [i, j, , x, y] = tags.get(33922)!; // ModelTiepoint
  return {
    littleEndian: le,
    width: one(256)!,
    height: one(257)!,
    tileWidth: one(322)!,
    tileHeight: one(323)!,
    offsets: tags.get(324)!,
    byteCounts: tags.get(325)!,
    x0: x - i * sx,
    y0: y + j * sy,
    sx,
    sy,
  };
}

/** Lecteur de pixels d'un COG flottant compressé en LZW ; en-tête et tuiles gardés en cache. */
class CogReader {
  private url: string;
  private header: Promise<CogHeader> | undefined;
  private tiles = new Map<number, Promise<Float32Array | null>>();

  constructor(url: string) {
    this.url = url;
  }

  private async range(start: number, length: number): Promise<ArrayBuffer> {
    const resp = await fetch(this.url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: AbortSignal.timeout(SHARED_FETCH_TIMEOUT_MS) });
    if (!resp.ok) throw new Error(`OFCOM indisponible (${resp.status})`);
    return resp.arrayBuffer();
  }

  /** Ressources partagées entre recherches : chargées sans leur signal, oubliées en cas d'échec. */
  private getHeader(): Promise<CogHeader> {
    if (!this.header) {
      const loading = this.range(0, 65536).then(parseCogHeader);
      loading.catch(() => this.header === loading && (this.header = undefined));
      this.header = loading;
    }
    return this.header;
  }

  private getTile(h: CogHeader, index: number): Promise<Float32Array | null> {
    let tile = this.tiles.get(index);
    if (!tile) {
      const size = h.byteCounts[index];
      tile = !size
        ? Promise.resolve(null) // tuile vide : aucun réseau
        : this.range(h.offsets[index], size).then((data) => {
            const raw = lzwDecode(new Uint8Array(data), h.tileWidth * h.tileHeight * 4);
            const dv = new DataView(raw.buffer);
            const values = new Float32Array(h.tileWidth * h.tileHeight);
            for (let k = 0; k < values.length; k++) values[k] = dv.getFloat32(k * 4, h.littleEndian);
            return values;
          });
      tile.catch(() => this.tiles.delete(index));
      this.tiles.set(index, tile);
    }
    return tile;
  }

  /** Valeur (nombre de réseaux) en chaque point ; 0 hors de la grille ou sans donnée. */
  async values(points: [number, number][], signal?: AbortSignal): Promise<number[]> {
    const h = await abortable(this.getHeader(), signal);
    const across = Math.ceil(h.width / h.tileWidth);
    return Promise.all(
      points.map(async ([lng, lat]) => {
        const [e, n] = toLv95(lng, lat);
        const col = Math.floor((e - h.x0) / h.sx);
        const row = Math.floor((h.y0 - n) / h.sy);
        if (col < 0 || row < 0 || col >= h.width || row >= h.height) return 0;
        const tile = await abortable(this.getTile(h, Math.floor(row / h.tileHeight) * across + Math.floor(col / h.tileWidth)), signal);
        const value = tile?.[(row % h.tileHeight) * h.tileWidth + (col % h.tileWidth)] ?? NaN;
        return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
      }),
    );
  }
}

const cogReaders = new Map<NetworkTechno, CogReader>();
const cogFor = (techno: NetworkTechno) => {
  let reader = cogReaders.get(techno);
  if (!reader) cogReaders.set(techno, (reader = new CogReader(OFCOM(techno))));
  return reader;
};

// --- Lecture commune -------------------------------------------------------------

/** Nombre de réseaux 5G et 4G au point, ou (radiusM) sur un cercle autour. */
export async function readNetworks(
  country: NetworkCountry,
  lng: number,
  lat: number,
  { radiusM, signal }: { radiusM?: number; signal?: AbortSignal } = {},
): Promise<NetworkCount[]> {
  const total = NETWORK_SOURCES[country].operators.length;
  const points: [number, number][] = radiusM ? pointsAround(lng, lat, radiusM) : [[lng, lat]];
  return Promise.all(
    NETWORK_TECHNOS.map(async (techno) => {
      let values: number[];
      let shapes: NetworkShapes | undefined;
      if (country === 'it') {
        const zones = await agcomZones(techno, lng, lat, (radiusM ?? 0) + AGCOM_MARGIN_M, signal);
        values = points.map((p) => countAt(zones, p));
        shapes = {
          type: 'FeatureCollection',
          features: zones.map((z) => ({ type: 'Feature', properties: { n: z.n }, geometry: { type: 'MultiPolygon', coordinates: ringsToMultiPolygon(z.rings) } })),
        };
      } else {
        values = await cogFor(techno).values(points, signal);
      }
      if (!radiusM) return { techno, total, count: Math.min(values[0], total), shapes };
      const counts: Record<string, number> = {};
      for (const v of values) counts[Math.min(v, total)] = (counts[Math.min(v, total)] ?? 0) + 1;
      const dominant = Object.keys(counts)
        .map(Number)
        .reduce((a, b) => (counts[b] > counts[a] || (counts[b] === counts[a] && b > a) ? b : a));
      const shares = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / values.length]));
      return { techno, total, count: dominant, area: { radiusM, samples: values.length, shares }, shapes };
    }),
  );
}

/** Date des données (AAAA-MM-JJ) par techno, lue aux services officiels ; vide si indisponible. */
export async function networkDates(country: NetworkCountry, signal?: AbortSignal): Promise<Partial<Record<NetworkTechno, string>>> {
  const entries = await Promise.all(
    NETWORK_TECHNOS.map(async (techno): Promise<[NetworkTechno, string | undefined]> => {
      try {
        if (country === 'it') {
          // Description du service : « mobile_4G_20260127 ».
          const json = await (await fetch(`${AGCOM}/${AGCOM_LAYERS[techno]}/MapServer?f=json`, { signal })).json();
          const m = /(\d{4})(\d{2})(\d{2})\s*$/.exec(String(json.serviceDescription ?? ''));
          return [techno, m ? `${m[1]}-${m[2]}-${m[3]}` : undefined];
        }
        const json = await (await fetch(OFCOM_STAC(techno), { signal })).json();
        return [techno, String(json.features?.[0]?.properties?.datetime ?? '').slice(0, 10) || undefined];
      } catch {
        return [techno, undefined];
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, d]) => d));
}

/** Couleurs du verdict : tous les réseaux, au moins la moitié, moins, aucun. */
export type NetworkKind = 'all' | 'most' | 'few' | 'none';
export const NETWORK_COLORS: Record<NetworkKind, { color: string; textColor: string }> = {
  all: { color: '#2e7d32', textColor: '#fff' },
  most: { color: '#f2c200', textColor: '#1d2327' },
  few: { color: '#ef6c00', textColor: '#fff' },
  none: { color: '#c62828', textColor: '#fff' },
};

export function networkKind(c: NetworkCount): NetworkKind {
  if (c.count <= 0) return 'none';
  if (c.count >= c.total) return 'all';
  return c.count * 2 >= c.total ? 'most' : 'few';
}
