/**
 * Synthèse de la couverture en un point, par opérateur, et choix du meilleur.
 *
 * Classement : cf. bestOperators (verdict 5G/4G, puis qualité 4G).
 */
import { levelRank } from './levels.ts';
import type { LayerCoverage } from './coverage.ts';
import { operatorStatus, statusScore } from './status.ts';

export interface OperatorSummary {
  operator: string;
  operatorLabel: string;
  /** Couverture par techno (« 4g », « 5g »…). */
  byTechno: Record<string, LayerCoverage>;
}

const NOT_COVERED = 99;

export function summarizeByOperator(coverage: LayerCoverage[]): OperatorSummary[] {
  const byOp = new Map<string, OperatorSummary>();
  for (const c of coverage) {
    const s = byOp.get(c.layer.operator) ?? { operator: c.layer.operator, operatorLabel: c.layer.operator_label, byTechno: {} };
    s.byTechno[c.layer.techno] = c;
    byOp.set(c.layer.operator, s);
  }
  return [...byOp.values()];
}

/** Rang d'une clé de répartition : TBC 0, BC 1, CL 2, couvert sans niveau 3, rien 4. */
const SHARE_RANK: Record<string, number> = { TBC: 0, BC: 1, CL: 2, covered: 3, none: 4 };

/** Note comparable d'une couverture (plus petit = meilleur) : 0-2 = niveau Arcep, 3 = couvert sans niveau, 99 = non couvert. */
function coverageScore(c: LayerCoverage | undefined): number {
  if (c?.area) {
    // Zone (cercle ou commune) : rang moyen pondéré par la part de chaque niveau.
    // Une zone entièrement non couverte reste « non couverte ».
    if ((c.area.shares.none ?? 0) >= 1) return NOT_COVERED;
    return Object.entries(c.area.shares).reduce((s, [k, v]) => s + v * (SHARE_RANK[k] ?? 4), 0);
  }
  if (!c?.covered) return NOT_COVERED;
  return c.layer.has_levels ? levelRank(c.level) : 3;
}

/** Écart en dessous duquel deux notes de zone sont considérées égales. */
const TIE = 0.05;

/**
 * Opérateur(s) le(s) mieux classé(s) ; vide si aucun n'a de réseau.
 * Critère : verdict (5G > 5G partielle > 4G > 4G partielle, cf. status.ts),
 * puis, à verdict égal, qualité de la 4G (niveaux Arcep).
 */
export function bestOperators(
  summaries: OperatorSummary[],
  /** Note (plus grand = meilleur) et départage (plus petit = meilleur) ; par défaut, verdict 5G/4G puis niveaux 4G. */
  rate: (s: OperatorSummary) => { score: number; quality: number } = (s) => ({ score: statusScore(operatorStatus(s)), quality: coverageScore(s.byTechno['4g']) }),
): OperatorSummary[] {
  const scored = summaries
    .map((s) => ({ s, ...rate(s) }))
    .filter((x) => x.score > 0);
  if (!scored.length) return [];
  const better = (a: typeof scored[number], b: typeof scored[number]) =>
    Math.abs(a.score - b.score) > 0.01 ? a.score - b.score : Math.abs(a.quality - b.quality) > TIE ? b.quality - a.quality : 0;
  const best = scored.reduce((a, b) => (better(b, a) > 0 ? b : a));
  return scored.filter((x) => better(x, best) === 0).map((x) => x.s);
}
