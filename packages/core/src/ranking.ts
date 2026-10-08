/**
 * Synthèse de la couverture en un point, par opérateur, et choix du meilleur.
 *
 * Critère (du plus important au moins important) :
 *   1. niveau 4G (TBC > BC > CL > non couvert) : c'est la couche « data »
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

/** Note comparable d'une couverture : 0-2 = niveau Arcep, 3 = couvert sans niveau, 99 = non couvert. */
function coverageScore(c: LayerCoverage | undefined): number {
  if (!c?.covered) return NOT_COVERED;
  return c.layer.has_levels ? levelRank(c.level) : 3;
}

function scoreTuple(s: OperatorSummary): number[] {
  return RANKING_TECHNOS.map((t) => coverageScore(s.byTechno[t]));
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Opérateur(s) le(s) mieux classé(s) ; vide si aucun ne couvre le point. */
export function bestOperators(summaries: OperatorSummary[]): OperatorSummary[] {
  const covered = summaries.filter((s) => scoreTuple(s).some((v) => v !== NOT_COVERED));
  if (!covered.length) return [];
  const best = covered.reduce((a, b) => (compareTuples(scoreTuple(b), scoreTuple(a)) < 0 ? b : a));
  return covered.filter((s) => compareTuples(scoreTuple(s), scoreTuple(best)) === 0);
}
