/** Types du manifeste produit par data-pipeline/finalize_manifest.py. */

export interface LayerInfo {
  id: string; // ex. « orange-4g »
  operator: string; // orange | sfr | bouygues | free
  operator_label: string;
  techno: string; // 2g | 2g3g | 3g | 4g | 5g
  techno_label: string;
  usage: 'voix' | 'data';
  has_levels: boolean;
  quarter: string; // ex. « 2026_T2 »
  date: string; // fin du trimestre, AAAA-MM-JJ
  source: { file: string; public_url: string };
  tiles: { file: string; size: number; minzoom?: number; maxzoom?: number };
}

export interface Manifest {
  generated_at: string;
  latest_quarter: string;
  source: { producer: string; dataset: string; dataset_url: string; license: string };
  layers: LayerInfo[];
}

/** Nom de la couche vectorielle dans chaque PMTiles (cf. build_layer.sh). */
export const SOURCE_LAYER = 'couverture';

export async function loadManifest(baseUrl: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Manifest> {
  const resp = await fetchFn(new URL('manifest.json', baseUrl), { signal });
  if (!resp.ok) throw new Error(`manifest.json introuvable (${resp.status})`);
  return resp.json();
}

/** Opérateurs et technos présents dans le manifeste, dans l'ordre du manifeste. */
export function operatorsOf(manifest: Manifest) {
  const seen = new Map<string, string>();
  for (const l of manifest.layers) seen.set(l.operator, l.operator_label);
  return [...seen].map(([id, label]) => ({ id, label }));
}

export function technosOf(manifest: Manifest) {
  const seen = new Map<string, string>();
  for (const l of manifest.layers) seen.set(l.techno, l.techno_label);
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.id.localeCompare(b.id));
}
