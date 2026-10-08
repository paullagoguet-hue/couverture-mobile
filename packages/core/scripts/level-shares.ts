/**
 * Part de la France métropolitaine couverte par niveau, pour chaque couche.
 *
 * Parcourt toutes les tuiles d'un zoom donné (z10 par défaut) et somme l'aire
 * des polygones par niveau (formule du lacet, corrigée de la déformation de
 * Mercator au centre de chaque tuile). Sert à comparer les opérateurs.
 *
 * Usage : node scripts/level-shares.ts <dossier_tuiles> [zoom]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';

import { SOURCE_LAYER, type Manifest } from '../src/manifest.ts';
import { NodeFileSource } from './node-source.ts';

const EARTH_CIRCUMFERENCE = 40075016.686;
// Emprise de la métropole (Corse comprise).
const BBOX = { west: -5.3, south: 41.2, east: 9.7, north: 51.2 };
// Superficie de la France métropolitaine (Insee), pour exprimer des pourcentages.
const FRANCE_KM2 = 551_695;

const lng2x = (lng: number, n: number) => Math.floor(((lng + 180) / 360) * n);
const lat2y = (lat: number, n: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
};
const y2lat = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

/**
 * Découpe un anneau au carré [0, extent]² (Sutherland-Hodgman) : les tuiles
 * débordent sur leurs voisines (tampon tippecanoe), sans découpe on compterait
 * deux fois les bords. L'orientation est conservée, donc trous compris.
 */
function clipRing(ring: { x: number; y: number }[], extent: number) {
  type P = { x: number; y: number };
  const edges: [(p: P) => boolean, (a: P, b: P) => P][] = [
    [(p) => p.x >= 0, (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= extent, (a, b) => ({ x: extent, y: a.y + ((b.y - a.y) * (extent - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= 0, (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 })],
    [(p) => p.y <= extent, (a, b) => ({ x: a.x + ((b.x - a.x) * (extent - a.y)) / (b.y - a.y), y: extent })],
  ];
  let out: P[] = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

/** Aire signée d'un anneau (unités de tuile²). */
function ringArea(ring: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return s / 2;
}

async function shares(path: string, z: number) {
  const source = new NodeFileSource(path);
  const archive = new PMTiles(source);
  const n = 2 ** z;
  const areaKm2: Record<string, number> = {};
  for (let x = lng2x(BBOX.west, n); x <= lng2x(BBOX.east, n); x++) {
    for (let y = lat2y(BBOX.north, n); y <= lat2y(BBOX.south, n); y++) {
      const tile = await archive.getZxy(z, x, y);
      if (!tile) continue;
      const layer = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers[SOURCE_LAYER];
      if (!layer) continue;
      const lat = y2lat(y + 0.5, n);
      const metersPerUnit = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (n * layer.extent);
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        // Anneaux extérieurs et trous ont des orientations opposées en MVT :
        // la somme des aires signées donne l'aire nette du polygone.
        const units = Math.abs(f.loadGeometry().reduce((s, r) => s + ringArea(clipRing(r, layer.extent)), 0));
        const key = String(f.properties.niveau ?? 'couvert');
        areaKm2[key] = (areaKm2[key] ?? 0) + (units * metersPerUnit ** 2) / 1e6;
      }
    }
  }
  await source.close();
  return areaKm2;
}

const [dir, zArg] = process.argv.slice(2);
const z = Number(zArg ?? 10);
const manifest: Manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
console.log(`Part de la métropole (${FRANCE_KM2.toLocaleString('fr-FR')} km²), mesurée sur les tuiles z${z}\n`);
for (const l of manifest.layers) {
  const a = await shares(join(dir, l.tiles.file), z);
  const total = Object.values(a).reduce((s, v) => s + v, 0);
  const pct = (v = 0) => `${((100 * v) / FRANCE_KM2).toFixed(1).padStart(5)} %`;
  const detail = l.has_levels ? `TBC ${pct(a.TBC)}  BC ${pct(a.BC)}  CL ${pct(a.CL)}` : '';
  console.log(`${l.id.padEnd(12)} couvert ${pct(total)}   ${detail}`);
}
