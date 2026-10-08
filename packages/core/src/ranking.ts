/**
 * Synthèse de la couverture en un point, par opérateur, et choix du meilleur.
 *
 * Critère (du plus important au moins important) :
 *   1. niveau 4G (TBC > BC > CL > non couvert ; pour une zone, niveau moyen
 *      pondéré par la surface) : c'est la couche « data »
 *      la plus complète, avec des niveaux de qualité ;
 *   2. présence de 5G.
 * Plusieurs opérateurs peuvent être ex æquo.
 */
import { levelRank } from './levels.ts';
import type { LayerCoverage } from './coverage.ts';

export interface OperatorSummary {
  operator: string;
  operatorLabel: string;
  /** Couverture par techno (« 4g », « 5g »…). */
  byTechno: Record<string, LayerCoverage>;
}

/** Ordre des technos dans le classement, de la plus déterminante à la moins. */
const RANKING_TECHNOS = ['4g', '5g'];
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

function scoreTuple(s: OperatorSummary): number[] {
  return RANKING_TECHNOS.map((t) => coverageScore(s.byTechno[t]));
}

/** Écart en dessous duquel deux notes de zone sont considérées égales. */
const TIE = 0.05;

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > TIE) return a[i] - b[i];
  return 0;
}

/** Opérateur(s) le(s) mieux classé(s) ; vide si aucun ne couvre le point. */
export function bestOperators(summaries: OperatorSummary[]): OperatorSummary[] {
  const covered = summaries.filter((s) => scoreTuple(s).some((v) => v !== NOT_COVERED));
  if (!covered.length) return [];
  const best = covered.reduce((a, b) => (compareTuples(scoreTuple(b), scoreTuple(a)) < 0 ? b : a));
  return covered.filter((s) => compareTuples(scoreTuple(s), scoreTuple(best)) === 0);
}
