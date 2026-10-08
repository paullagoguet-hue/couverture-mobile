/**
 * Verdict simple par opérateur : la meilleure technologie réellement utile à
 * cet endroit, avec un code couleur.
 *
 *   vert   « 5G »               5G partout (au point, ou sur toute la zone)
 *   jaune  « 5G partielle »     5G sur 50 à 99 % de la zone
 *   orange « 4G »               5G absente ou sur moins de 50 % (on ne
 *                               l'affiche pas : faux espoir), 4G sur au moins la moitié
 *   rouge  « 4G partielle »     4G sur moins de la moitié de la zone
 *   rouge  « Pas de réseau »    ni 4G ni 5G
 *
 * « Zone » = cercle autour d'un emplacement approximatif, ou territoire d'une
 * commune ; en un point précis, la part vaut 0 ou 100 %.
 */
import type { LayerCoverage } from './coverage.ts';
import { levelInfo } from './levels.ts';
import type { OperatorSummary } from './ranking.ts';

export type StatusKind = '5g' | '5g-partial' | '4g' | '4g-partial' | 'none';

export interface OperatorStatus {
  kind: StatusKind;
  label: string;
  /** Couleur de fond du badge et couleur du texte. */
  color: string;
  textColor: string;
  /** Part couverte (0..1) en 5G et en 4G, tous niveaux confondus. */
  share5g: number;
  share4g: number;
  /** Couche à montrer sur la carte pour ce verdict. */
  layerId?: string;
  /** Détail pour l'infobulle. */
  detail: string;
}

/** En dessous de ce seuil, la 5G n'est pas annoncée (faux espoir). */
export const PARTIAL_MIN = 0.5;
/** À partir de ce seuil, la 5G est considérée comme couvrant toute la zone (arrondi à 100 %). */
export const FULL_MIN = 0.995;

export const STATUS_COLORS: Record<StatusKind, { color: string; textColor: string }> = {
  '5g': { color: '#2e7d32', textColor: '#fff' },
  '5g-partial': { color: '#f2c200', textColor: '#1d2327' },
  '4g': { color: '#ef6c00', textColor: '#fff' },
  '4g-partial': { color: '#c62828', textColor: '#fff' },
  none: { color: '#c62828', textColor: '#fff' },
};

/** Part couverte (0..1) d'une couche, au point ou sur la zone. */
export function coveredShare(c: LayerCoverage | undefined): number {
  if (!c) return 0;
  if (c.area) return Math.max(0, 1 - (c.area.shares.none ?? 0));
  return c.covered ? 1 : 0;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Description du niveau 4G pour l'infobulle (« Très bonne 66 %, Bonne 25 % » ou « Très bonne couverture »). */
function describe4g(c: LayerCoverage | undefined): string {
  if (!c) return 'donnée non disponible';
  if (c.area) {
    const parts = Object.entries(c.area.shares)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${levelInfo(k)?.short ?? (k === 'none' ? 'non couvert' : 'couvert')} ${pct(v)}`);
    return parts.join(', ');
  }
  return c.covered ? (levelInfo(c.level)?.label ?? 'couverte') : 'non couverte';
}

export function operatorStatus(s: OperatorSummary): OperatorStatus {
  const c5 = s.byTechno['5g'];
  const c4 = s.byTechno['4g'];
  const share5g = coveredShare(c5);
  const share4g = coveredShare(c4);
  const zone = Boolean(c5?.area ?? c4?.area);
  const area = c5?.area ?? c4?.area;
  const where = !area ? '' : area.kind === 'circle' ? 'des alentours' : area.basis === 'surface' ? 'de la commune' : 'des habitants';
  const detail = `5G : ${zone ? `${pct(share5g)} ${where}` : share5g ? 'couverte' : 'non couverte'} · 4G : ${describe4g(c4)}`;

  let kind: StatusKind;
  let label: string;
  if (share5g >= FULL_MIN) {
    kind = '5g';
    label = '5G';
  } else if (share5g >= PARTIAL_MIN) {
    kind = '5g-partial';
    label = `5G partielle · ${pct(share5g)}`;
  } else if (share4g >= PARTIAL_MIN) {
    kind = '4g';
    label = '4G';
  } else if (share4g > 0) {
    kind = '4g-partial';
    label = '4G partielle';
  } else {
    kind = 'none';
    label = 'Pas de réseau';
  }
  const layerId = (kind === '5g' || kind === '5g-partial' ? c5 : c4)?.layer.id;
  return { kind, label, share5g, share4g, layerId, detail, ...STATUS_COLORS[kind] };
}

/** Note de classement (plus grand = meilleur) : verdict d'abord, puis parts couvertes. */
export function statusScore(st: OperatorStatus): number {
  const base = { '5g': 4, '5g-partial': 3, '4g': 2, '4g-partial': 1, none: 0 }[st.kind];
  return base + (st.kind.startsWith('5g') ? st.share5g : st.share4g) * 0.99;
}
