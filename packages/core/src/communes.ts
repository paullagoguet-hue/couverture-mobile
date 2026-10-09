/**
 * Couverture à l'échelle d'une commune : part de ses HABITANTS couverts (ou de
 * sa surface s'il n'y en a pas de recensés), par niveau et par couche, précalculée par le pipeline (commune_stats.py,
 * merge_communes.py) et publiée en un JSON par département à côté des tuiles.
 */
import { abortable, SHARED_FETCH_TIMEOUT_MS } from './async.ts';
import type { AreaStats, LayerCoverage } from './coverage.ts';
import { LEVELS } from './levels.ts';
import type { LayerInfo } from './manifest.ts';

interface DepartmentFile {
  layers: string[];
  communes: Record<string, { nom: string; hab?: number; base?: string } & Record<string, number[] | string | number>>;
}

export interface CommuneCoverage {
  code: string;
  nom: string;
  /** Nombre d'habitants (Insee, Filosofi 2019). */
  inhabitants: number;
  /** Base de calcul des pourcentages. */
  basis: 'population' | 'surface';
  /** % des habitants (ou de la surface) par couche : [TBC, BC, CL] (couches à niveaux) ou [couvert]. */
  values: Record<string, number[]>;
}

/** Département d'un code INSEE (« 37261 » → « 37 », « 2A004 » → « 2A »). */
export const departmentOf = (citycode: string) => citycode.slice(0, 2);

const cache = new Map<string, Promise<DepartmentFile | null>>();

/** Charge la couverture d'une commune ; null si les données ne sont pas publiées. */
export async function loadCommuneCoverage(tilesBaseUrl: string, citycode: string, signal?: AbortSignal): Promise<CommuneCoverage | null> {
  const dept = departmentOf(citycode);
  if (!cache.has(dept)) {
    const url = new URL(`communes/${dept}.json`, tilesBaseUrl);
    cache.set(
      dept,
      // Téléchargement partagé : indépendant du signal de la recherche (cf. async.ts).
      fetch(url, { signal: AbortSignal.timeout(SHARED_FETCH_TIMEOUT_MS) })
        .then((r) => (r.ok ? (r.json() as Promise<DepartmentFile>) : null))
        .catch(() => {
          cache.delete(dept); // erreur réseau : on retentera
          return null;
        }),
    );
  }
  const file = await abortable(cache.get(dept)!, signal);
  const entry = file?.communes[citycode];
  if (!entry) return null;
  const { nom, hab, base, ...rest } = entry;
  return {
    code: citycode,
    nom,
    inhabitants: hab ?? 0,
    basis: base === 'surface' ? 'surface' : 'population',
    values: rest as Record<string, number[]>,
  };
}

/**
 * Convertit la couverture d'une commune en LayerCoverage (une répartition par
 * niveau sur tout le territoire), pour réutiliser l'affichage et le classement.
 */
export function communeToCoverage(layers: LayerInfo[], commune: CommuneCoverage): LayerCoverage[] {
  return layers
    .filter((l) => commune.values[l.id])
    .map((layer) => {
      const v = commune.values[layer.id].map((x) => x / 100);
      const shares: Record<string, number> = layer.has_levels
        ? Object.fromEntries(LEVELS.map((lvl, i) => [lvl.code, v[i] ?? 0]))
        : { covered: v[0] ?? 0 };
      const covered = Object.values(shares).reduce((s, x) => s + x, 0);
      shares.none = Math.max(0, 1 - covered);
      const area: AreaStats = { kind: 'commune', samples: 0, shares, basis: commune.basis, inhabitants: commune.inhabitants };
      // Niveau le plus étendu parmi les zones couvertes.
      const top = LEVELS.map((l) => l.code).reduce((a, b) => ((shares[b] ?? 0) > (shares[a] ?? 0) ? b : a));
      return { layer, covered: covered > 0, level: layer.has_levels && covered > 0 ? top : null, area };
    });
}
