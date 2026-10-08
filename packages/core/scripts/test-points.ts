/**
 * Étape 2 de l'extension : lecture de couverture en un point, testée sur des
 * adresses réelles. Mesure le volume téléchargé et le temps (requêtes HTTP
 * Range contre un serveur de tuiles, comme le fera l'extension), et compare
 * avec les GeoPackages Arcep d'origine quand ils sont fournis.
 *
 * Usage :
 *   node scripts/test-points.ts <url_dossier_tuiles> [id_couche=chemin.gpkg ...]
 *   ex. node scripts/test-points.ts http://localhost:5173/tiles/ orange-4g=C:/tmp/OF_4G.gpkg
 */
import { CoverageReader, geocode, levelInfo, loadManifest } from '../src/index.ts';
import { gpkgCoverage } from './gpkg-truth.ts';

const ADDRESSES = [
  { theme: 'Paris', query: 'Place de la Concorde 75008 Paris' },
  { theme: 'Zone rurale', query: 'Royère-de-Vassivière' },
  { theme: 'Montagne', query: 'Bonneval-sur-Arc' },
  { theme: 'Bord de mer', query: 'Pointe du Raz Plogoff' },
  { theme: 'Hameau isolé', query: 'Dormillouse Freissinières' },
];

// Compteur d'octets et de requêtes sur fetch (utilisé par FetchSource de pmtiles).
const net = { bytes: 0, requests: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const resp = await realFetch(input, init);
  if (String(input instanceof Request ? input.url : input).includes('.pmtiles')) {
    const body = await resp.arrayBuffer();
    net.bytes += body.byteLength;
    net.requests++;
    return new Response(body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  }
  return resp;
};

const [tilesBase, ...truthArgs] = process.argv.slice(2);
const truth = new Map(truthArgs.map((a) => a.split('=') as [string, string]));

const manifest = await loadManifest(tilesBase);
const reader = new CoverageReader(tilesBase);
const fmt = (covered: boolean, level: string | null) => (!covered ? '—' : level ?? 'couvert');

for (const [i, { theme, query }] of ADDRESSES.entries()) {
  const results = await geocode(query, { limit: 3 });
  if (!results.length) {
    console.log(`\n### ${theme} : « ${query} » introuvable`);
    continue;
  }
  const r = results[0];
  console.log(`\n### ${theme} : ${r.label} (${r.type}, score ${r.score.toFixed(2)}) — ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`);

  // Deux lectures : la seconde montre l'effet du cache (en-têtes, répertoires).
  for (const pass of ['1re lecture', '2e lecture']) {
    const before = { ...net };
    const t0 = performance.now();
    const cov = await reader.query(manifest.layers, r.lng, r.lat);
    const ms = performance.now() - t0;
    console.log(`  ${pass} : ${ms.toFixed(0)} ms, ${net.requests - before.requests} requêtes, ${((net.bytes - before.bytes) / 1024).toFixed(0)} Ko` +
      (i === 0 && pass === '1re lecture' ? ' (inclut en-têtes et répertoires racine)' : ''));
    if (pass === '2e lecture') continue;
    for (const c of cov) {
      const expected = truth.get(c.layer.id);
      const ref = expected ? gpkgCoverage(expected, r.lng, r.lat) : undefined;
      const got = fmt(c.covered, c.level);
      const check = ref === undefined ? '' : (ref ?? '—') === got ? '  ✓ source Arcep' : `  ✗ source Arcep : ${ref ?? '—'}`;
      console.log(`    ${c.layer.id.padEnd(12)} ${got.padEnd(8)} ${levelInfo(c.level)?.label ?? ''}${check}`);
    }
  }
}
