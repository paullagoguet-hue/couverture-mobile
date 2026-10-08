/**
 * Lecture de la couverture en un point, directement dans les PMTiles.
 *
 * Pour chaque couche : tuile du zoom max contenant le point (une requête HTTP
 * Range, après lecture de l'en-tête et du répertoire, mis en cache), décodage
 * MVT, puis test point-dans-polygone. Les niveaux TBC/BC/CL sont des zones
 * disjointes : le premier polygone qui contient le point donne le niveau.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { FetchSource, PMTiles, type Source } from 'pmtiles';

import { levelRank, type LevelCode } from './levels.ts';
import { SOURCE_LAYER, type LayerInfo } from './manifest.ts';

/** Tuile (x, y) et position du point dans la tuile, en unités de l'extent MVT. */
export function pointToTile(lng: number, lat: number, z: number, extent: number) {
  const n = 2 ** z;
  const fx = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return { x, y, px: (fx - x) * extent, py: (fy - y) * extent };
}

/**
 * Règle pair-impair sur tous les anneaux d'un polygone MVT : les trous
 * (anneaux intérieurs) inversent le résultat, ce qui gère aussi les multipolygones.
 */
export function pointInRings(px: number, py: number, rings: { x: number; y: number }[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

type TileLayer = NonNullable<VectorTile['layers'][string]>;

/** Décode une tuile MVT et renvoie la couche de couverture (null si absente). */
export function decodeTile(data: ArrayBuffer): TileLayer | null {
  return new VectorTile(new PbfReader(new Uint8Array(data))).layers[SOURCE_LAYER] ?? null;
}

/** Niveau au point (px, py), en unités d'extent 4096, dans une couche décodée. */
export function pointCoverage(layer: TileLayer | null, px: number, py: number): { covered: boolean; level: LevelCode | null } {
  if (!layer) return { covered: false, level: null };
  // L'extent annoncé par la couche fait foi (4096 par défaut avec tippecanoe).
  const scale = layer.extent / 4096;
  const qx = px * scale, qy = py * scale;
  let best: { covered: boolean; level: LevelCode | null } = { covered: false, level: null };
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3) continue;
    const [x0, y0, x1, y1] = f.bbox();
    if (qx < x0 || qx > x1 || qy < y0 || qy > y1) continue;
    if (!pointInRings(qx, qy, f.loadGeometry())) continue;
    const level = (f.properties.niveau as LevelCode | undefined) ?? null;
    // Les niveaux sont disjoints ; par prudence on garde le meilleur si deux se chevauchent.
    if (!best.covered || levelRank(level) < levelRank(best.level)) best = { covered: true, level };
  }
  return best;
}

/** Décode une tuile MVT et renvoie le niveau au point. */
export function coverageInTile(data: ArrayBuffer, px: number, py: number) {
  return pointCoverage(decodeTile(data), px, py);
}

/**
 * Points d'échantillonnage dans un cercle : le centre puis des anneaux
 * concentriques espacés d'environ 300 m (au moins 2), l'anneau k portant 6k
 * points. Répartition à peu près uniforme : 19 points pour 300 m, 61 pour
 * 1 km, 169 pour 2 km.
 */
export function pointsAround(lng: number, lat: number, radiusM: number): [number, number][] {
  const mPerDegLat = 111_320;
  const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  const rings = Math.max(2, Math.ceil(radiusM / 300));
  const pts: [number, number][] = [[lng, lat]];
  for (let k = 1; k <= rings; k++) {
    const r = (radiusM * k) / rings;
    for (let i = 0; i < 6 * k; i++) {
      const a = (2 * Math.PI * i) / (6 * k);
      pts.push([lng + (r * Math.cos(a)) / mPerDegLng, lat + (r * Math.sin(a)) / mPerDegLat]);
    }
  }
  return pts;
}

/** Répartition de la couverture sur une zone (points d'échantillonnage). */
export interface AreaStats {
  /** Cercle autour d'un point approximatif, ou territoire d'une commune. */
  kind: 'circle' | 'commune';
  radiusM?: number;
  /** Commune : parts calculées sur ses habitants (par défaut) ou, faute d'habitants recensés, sur sa surface. */
  basis?: 'population' | 'surface';
  /** Commune : nombre d'habitants (Insee, Filosofi 2019). */
  inhabitants?: number;
  /** Nombre de points échantillonnés (cercle) ; 0 pour une commune (calcul exhaustif). */
  samples: number;
  /** Part des points par niveau : « TBC », « BC », « CL », « covered » (sans niveau), « none ». */
  shares: Record<string, number>;
}

export interface LayerCoverage {
  layer: LayerInfo;
  /** Point couvert (zone : niveau dominant couvert). */
  covered: boolean;
  /** Niveau Arcep (couches à niveaux) ; pour une zone, le niveau dominant. */
  level: LevelCode | null;
  /** Présent quand la couverture a été évaluée sur une zone et non en un point. */
  area?: AreaStats;
}

/** Lecteur de couverture pour un ensemble de couches ; garde les en-têtes PMTiles en cache. */
export class CoverageReader {
  private archives = new Map<string, PMTiles>();
  private tilesBaseUrl: string;
  private makeSource: (url: string) => Source;

  /**
   * @param tilesBaseUrl dossier contenant les .pmtiles (URL absolue)
   * @param makeSource   fabrique de Source PMTiles (par défaut HTTP Range via fetch)
   */
  constructor(tilesBaseUrl: string, makeSource: (url: string) => Source = (url) => new FetchSource(url)) {
    this.tilesBaseUrl = tilesBaseUrl;
    this.makeSource = makeSource;
  }

  private archive(layer: LayerInfo): PMTiles {
    let a = this.archives.get(layer.id);
    if (!a) {
      a = new PMTiles(this.makeSource(new URL(layer.tiles.file, this.tilesBaseUrl).href));
      this.archives.set(layer.id, a);
    }
    return a;
  }

  /** Niveau en plusieurs points d'une couche ; chaque tuile n'est lue et décodée qu'une fois. */
  private async layerPoints(layer: LayerInfo, points: [number, number][], signal?: AbortSignal) {
    const archive = this.archive(layer);
    const z = (await archive.getHeader()).maxZoom;
    const tiles = new Map<string, Promise<TileLayer | null>>();
    return Promise.all(
      points.map(async ([lng, lat]) => {
        const { x, y, px, py } = pointToTile(lng, lat, z, 4096);
        const key = `${x}/${y}`;
        if (!tiles.has(key)) {
          // Pas de tuile = aucune couverture dans ce carré (tippecanoe n'écrit pas les tuiles vides).
          tiles.set(key, archive.getZxy(z, x, y, signal).then((t) => (t ? decodeTile(t.data) : null)));
        }
        return pointCoverage(await tiles.get(key)!, px, py);
      }),
    );
  }

  /** Couverture d'une couche au point (lng, lat), lue au zoom max de la couche. */
  async queryLayer(layer: LayerInfo, lng: number, lat: number, signal?: AbortSignal): Promise<LayerCoverage> {
    const [c] = await this.layerPoints(layer, [[lng, lat]], signal);
    return { layer, ...c };
  }

  /**
   * Couverture d'une couche dans un cercle autour du point : répartition par
   * niveau et niveau dominant (utile quand l'emplacement est approximatif).
   */
  async queryLayerArea(layer: LayerInfo, lng: number, lat: number, radiusM: number, signal?: AbortSignal): Promise<LayerCoverage> {
    const results = await this.layerPoints(layer, pointsAround(lng, lat, radiusM), signal);
    const counts: Record<string, number> = {};
    for (const r of results) {
      const key = !r.covered ? 'none' : (r.level ?? 'covered');
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const shares = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / results.length]));
    // Niveau dominant ; à égalité, le meilleur (l'ordre TBC > BC > CL > covered > none).
    const order = ['TBC', 'BC', 'CL', 'covered', 'none'];
    const dominant = order.reduce((a, b) => ((counts[b] ?? 0) > (counts[a] ?? 0) ? b : a));
    return {
      layer,
      covered: dominant !== 'none',
      level: dominant === 'none' || dominant === 'covered' ? null : (dominant as LevelCode),
      area: { kind: 'circle', radiusM, samples: results.length, shares },
    };
  }

  /** Toutes les couches en parallèle, au point ou (si radiusM) dans un cercle. */
  query(layers: LayerInfo[], lng: number, lat: number, signal?: AbortSignal, radiusM?: number): Promise<LayerCoverage[]> {
    return Promise.all(
      layers.map((l) => (radiusM ? this.queryLayerArea(l, lng, lat, radiusM, signal) : this.queryLayer(l, lng, lat, signal))),
    );
  }
}
