/**
 * Génère src/borders.ts : contours simplifiés des pays pris en charge, pour
 * savoir dans quel pays tombe un point (countryAt), par exemple les
 * coordonnées d'une annonce près des Pyrénées.
 *
 * Source : Eurostat GISCO, pays au 1:1 000 000 (© EuroGeographics pour les
 * limites administratives), assez précis pour départager Irun et Hendaye.
 *   curl -LO https://gisco-services.ec.europa.eu/distribution/v2/countries/geojson/CNTR_RG_01M_2020_4326.geojson
 *   node scripts/make-borders.ts CNTR_RG_01M_2020_4326.geojson
 *
 * Simplification Douglas-Peucker à ~30 m. Andorre, l'Allemagne… sont gardées
 * pour être exclues (ni France ni Espagne, ni Suisse…). Le littoral simplifié peut laisser un
 * logement de bord de mer « en mer » : countryAt prend alors le pays le plus proche.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Ring = [number, number][];

/**
 * Pays : identifiant GISCO et emprise utile (France : métropole + Corse).
 * Rôle (cf. countryAt) :
 *  - « enclave » : territoire non pris en charge testé AVANT nos pays, car
 *    trou de leur contour (Saint-Marin, Vatican, Büsingen) ou coincé entre
 *    eux (Andorre, Monaco) ; contour précis, aucun îlot ignoré ;
 *  - « voisin » : testé APRÈS nos pays, pour ne pas rattacher un point voisin
 *    au pays le plus proche (Constance n'est pas en Suisse) ; contour grossier
 *    (~100 m) suffisant, puisque nos pays passent avant.
 */
type Role = 'enclave' | 'voisin';
const COUNTRIES: Record<string, { id: string; bbox?: [number, number, number, number]; role?: Role }> = {
  fr: { id: 'FR', bbox: [-6, 41, 10, 52] },
  es: { id: 'ES' },
  pt: { id: 'PT' },
  be: { id: 'BE' },
  lu: { id: 'LU' },
  it: { id: 'IT' },
  ch: { id: 'CH' },
  ad: { id: 'AD', role: 'enclave' },
  mc: { id: 'MC', role: 'enclave' },
  sm: { id: 'SM', role: 'enclave' },
  va: { id: 'VA', role: 'enclave' },
  busingen: { id: 'DE', role: 'enclave', bbox: [8.6, 47.6, 8.8, 47.75] },
  li: { id: 'LI', role: 'voisin' },
  de: { id: 'DE', role: 'voisin' },
  at: { id: 'AT', role: 'voisin' },
  nl: { id: 'NL', role: 'voisin', bbox: [2, 50, 8, 54] },
  si: { id: 'SI', role: 'voisin' },
};
const TOLERANCE = 0.0003; // degrés (~30 m)
const TOLERANCE_NEIGHBOUR = 0.001; // degrés (~100 m)
const MIN_AREA = 0.0001; // degrés² (~1 km²) : îlots plus petits ignorés

function simplify(points: Ring, tol: number): Ring {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > max) (max = d), (idx = i);
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Contour fermé (premier point = dernier) : coupé au point le plus éloigné du départ, chaque moitié simplifiée. */
function simplifyRing(r: Ring, tol: number): Ring {
  let k = 0, max = 0;
  r.forEach(([x, y], i) => {
    const d = Math.hypot(x - r[0][0], y - r[0][1]);
    if (d > max) (max = d), (k = i);
  });
  return [...simplify(r.slice(0, k + 1), tol).slice(0, -1), ...simplify(r.slice(k), tol)];
}

const area = (r: Ring) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0) / 2);
const inBbox = (r: Ring, [x0, y0, x1, y1]: number[]) => r.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out: Record<string, number[][][]> = {};
for (const [code, { id, bbox, role }] of Object.entries(COUNTRIES)) {
  const feature = src.features.find((f: any) => f.properties.CNTR_ID === id);
  if (!feature) throw new Error(`${id} absent`);
  const polys: Ring[][] = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  // Contours extérieurs seulement : l'enclave espagnole de Llívia, trou du contour français,
  // est aussi un polygone espagnol ; countryAt teste donc l'Espagne avant la France.
  out[code] = polys
    .map((p) => p[0])
    .filter((r) => (role === 'enclave' || area(r) >= MIN_AREA) && (!bbox || inBbox(r, bbox)))
    .map((r) => simplifyRing(r, role === 'voisin' ? TOLERANCE_NEIGHBOUR : TOLERANCE).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]));
  console.log(`${code} : ${out[code].length} polygones, ${out[code].reduce((s, r) => s + r.length, 0)} points`);
}

const file = resolve(import.meta.dirname, '../src/borders.ts');
writeFileSync(
  file,
  '/** Contours simplifiés des pays (Eurostat GISCO 1:1M, © EuroGeographics). Généré par scripts/make-borders.ts. */\n' +
    `export const BORDERS: Record<string, number[][][]> = ${JSON.stringify(out)};\n`,
);
console.log(file);
