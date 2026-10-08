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

export interface LayerCoverage {
  layer: LayerInfo;
  /** Point dans une zone couverte. */
  covered: boolean;
  /** Niveau Arcep (couches à niveaux uniquement). */
  level: LevelCode | null;
}

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

/** Décode une tuile MVT et renvoie le niveau au point (ou undefined si non couvert). */
export function coverageInTile(data: ArrayBuffer, px: number, py: number): { covered: boolean; level: LevelCode | null } {
  const layer = new VectorTile(new PbfReader(new Uint8Array(data))).layers[SOURCE_LAYER];
  if (!layer) return { covered: false, level: null };
  // L'extent annoncé par la couche fait foi (4096 par défaut avec tippecanoe).
  const scale = layer.extent / 4096;
  let best: { covered: boolean; level: LevelCode | null } = { covered: false, level: null };
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3) continue;
    const [x0, y0, x1, y1] = f.bbox();
    const qx = px * scale, qy = py * scale;
    if (qx < x0 || qx > x1 || qy < y0 || qy > y1) continue;
    if (!pointInRings(qx, qy, f.loadGeometry())) continue;
    const level = (f.properties.niveau as LevelCode | undefined) ?? null;
    // Les niveaux sont disjoints ; par prudence on garde le meilleur si deux se chevauchent.
    if (!best.covered || levelRank(level) < levelRank(best.level)) best = { covered: true, level };
  }
  return best;
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

  /** Couverture d'une couche au point (lng, lat), lue au zoom max de la couche. */
  async queryLayer(layer: LayerInfo, lng: number, lat: number, signal?: AbortSignal): Promise<LayerCoverage> {
    const archive = this.archive(layer);
    const header = await archive.getHeader();
    const z = header.maxZoom;
    const { x, y, px, py } = pointToTile(lng, lat, z, 4096);
    const tile = await archive.getZxy(z, x, y, signal);
    // Pas de tuile = aucune couverture dans ce carré (tippecanoe n'écrit pas les tuiles vides).
    if (!tile) return { layer, covered: false, level: null };
    return { layer, ...coverageInTile(tile.data, px, py) };
  }

  /** Toutes les couches en parallèle. */
  query(layers: LayerInfo[], lng: number, lat: number, signal?: AbortSignal): Promise<LayerCoverage[]> {
    return Promise.all(layers.map((l) => this.queryLayer(l, lng, lat, signal)));
  }
}
