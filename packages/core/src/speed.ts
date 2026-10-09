/**
 * Verdict de débit, pour les pays dont le régulateur publie un débit estimé
 * PAR OPÉRATEUR (Portugal : classes de débit d'ANACOM). Ailleurs, le verdict
 * reste celui de la couverture (status.ts) : on n'invente pas de débit.
 *
 *   vert   « Rapide »  ≥ 100 Mbit/s
 *   jaune  « Moyen »   30 à 100 Mbit/s
 *   orange « Lent »    moins de 30 Mbit/s
 *   rouge  « Pas de réseau »
 *
 * En chaque point, le meilleur débit de l'opérateur, toutes technos
 * confondues. Sur une zone, le badge est le meilleur niveau atteint sur au
 * moins la moitié de la zone, « au moins » comptant les niveaux supérieurs
 * (rapide 30 % + moyen 40 % -> « Moyen · 70 % »), avec sa part.
 */
import type { OperatorSummary } from './ranking.ts';
import { PARTIAL_MIN, STATUS_COLORS } from './status.ts';

export type SpeedKind = 'fast' | 'medium' | 'slow' | 'none';

/** Débit minimal (Mbit/s) de chaque niveau. */
export const SPEED_MIN = { fast: 100, medium: 30 } as const;

export const SPEED_COLORS: Record<SpeedKind, { color: string; textColor: string }> = {
  fast: STATUS_COLORS['5g'],
  medium: STATUS_COLORS['5g-partial'],
  slow: STATUS_COLORS['4g'],
  none: STATUS_COLORS.none,
};

const ORDER: SpeedKind[] = ['fast', 'medium', 'slow'];

export interface SpeedStatus {
  kind: SpeedKind;
  /** Part de la zone au moins à ce niveau (1 en un point, ou si toute la zone l'atteint). */
  share: number;
  /** Part de la zone à chaque niveau (somme = 1). */
  shares: Record<SpeedKind, number>;
  /** Meilleur débit au point, ou le plus fréquent sur la zone : techno et débit minimal publié (Mbit/s). */
  best?: { techno: string; mbps: number };
  /** Couche à montrer sur la carte (techno de ce débit). */
  layerId?: string;
  /** Débit moyen sur la zone (Mbit/s, 0 hors couverture), pour départager les opérateurs. */
  meanMbps: number;
  color: string;
  textColor: string;
}

const tierOf = (mbps: number | null): SpeedKind => (mbps === null ? 'none' : mbps >= SPEED_MIN.fast ? 'fast' : mbps >= SPEED_MIN.medium ? 'medium' : 'slow');

export function speedStatus(s: OperatorSummary, speedClasses: Record<string, number>): SpeedStatus {
  const layers = Object.values(s.byTechno);
  const samples = layers.find((c) => c.area?.classes)?.area?.classes?.length ?? 1;
  const classeAt = (c: (typeof layers)[number], i: number) => (c.area?.classes ? c.area.classes[i] : c.covered ? (c.classe ?? 1) : 0);

  // Meilleur débit de l'opérateur en chaque point (null : aucune couverture).
  const points = Array.from({ length: samples }, (_, i) => {
    let best: { techno: string; mbps: number; layerId: string } | null = null;
    for (const c of layers) {
      const classe = classeAt(c, i);
      if (!classe) continue;
      const mbps = speedClasses[String(classe)] ?? 0;
      // À débit égal, la techno la plus récente (5G).
      if (!best || mbps > best.mbps || (mbps === best.mbps && c.layer.techno > best.techno)) best = { techno: c.layer.techno, mbps, layerId: c.layer.id };
    }
    return best;
  });

  const shares: Record<SpeedKind, number> = { fast: 0, medium: 0, slow: 0, none: 0 };
  for (const p of points) shares[tierOf(p?.mbps ?? null)] += 1 / samples;
  // Meilleur niveau atteint (au moins) sur la moitié de la zone ; sinon « Lent » s'il y a du réseau.
  let kind: SpeedKind = 'none';
  let share = 0;
  let cumulative = 0;
  for (const k of ORDER) {
    cumulative += shares[k];
    if (cumulative >= PARTIAL_MIN) {
      kind = k;
      share = cumulative;
      break;
    }
  }
  if (kind === 'none' && cumulative > 0) (kind = 'slow'), (share = cumulative);

  // Description : le débit (et sa techno) le plus fréquent parmi les points de ce niveau ou mieux.
  const counted = new Map<string, { techno: string; mbps: number; layerId: string; n: number }>();
  for (const p of points) {
    if (!p || ORDER.indexOf(tierOf(p.mbps)) > ORDER.indexOf(kind)) continue;
    const key = `${p.techno}|${p.mbps}`;
    const e = counted.get(key) ?? { ...p, n: 0 };
    e.n++;
    counted.set(key, e);
  }
  const top = [...counted.values()].sort((a, b) => b.n - a.n || b.mbps - a.mbps)[0];
  const meanMbps = points.reduce((sum, p) => sum + (p?.mbps ?? 0), 0) / samples;

  return {
    kind,
    share: Math.min(1, share),
    shares,
    best: top && { techno: top.techno, mbps: top.mbps },
    layerId: top?.layerId ?? layers.find((c) => c.layer.techno === '4g')?.layer.id ?? layers[0]?.layer.id,
    meanMbps,
    ...SPEED_COLORS[kind],
  };
}

/** Note pour bestOperators : niveau puis part de la zone ; départage au débit moyen. */
export function speedRating(st: SpeedStatus): { score: number; quality: number } {
  const base = { fast: 3, medium: 2, slow: 1, none: 0 }[st.kind];
  return { score: base ? base + st.share * 0.99 : 0, quality: -st.meanMbps / 10 }; // écart de plus de 0,5 Mbit/s en moyenne
}

/** Couleur des zones de la mini-carte selon la classe de débit (attribut « classe »). */
export function speedFillExpression(speedClasses: Record<string, number>): unknown[] {
  const tiers = Object.entries(speedClasses).flatMap(([code, mbps]) => [Number(code), SPEED_COLORS[tierOf(mbps)].color]);
  return ['match', ['get', 'classe'], ...tiers, SPEED_COLORS.slow.color];
}
