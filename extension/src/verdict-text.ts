/**
 * Libellés traduits des verdicts (le cœur, partagé avec le site, les produit
 * en français) : badge (« 5G partielle · 94 % ») et infobulle (détail 5G / 4G).
 */
import type { LayerCoverage, OperatorStatus, OperatorSummary } from '@couverture/core';

import { locale, t, type MessageKey } from './i18n.ts';

const pct = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);

const LEVELS = ['TBC', 'BC', 'CL'] as const;
const isLevel = (k: string | null | undefined): k is (typeof LEVELS)[number] => (LEVELS as readonly string[]).includes(k ?? '');

export function statusLabel(st: OperatorStatus): string {
  switch (st.kind) {
    case '5g':
      return t('status_5g');
    case '5g-partial':
      return t('status_5gPartial', { pct: pct(st.share5g) });
    case '4g':
      return t('status_4g');
    case '4g-partial':
      return t('status_4gPartial');
    default:
      return t('status_none');
  }
}

/** 4G : niveaux et parts sur la zone (« Très bonne 66 %, Bonne 25 % »), ou niveau au point. */
function describe4g(c: LayerCoverage | undefined): string {
  if (!c) return t('noData');
  if (c.area) {
    return Object.entries(c.area.shares)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${isLevel(k) ? t(`level_${k}` as MessageKey) : k === 'none' ? t('notCovered') : t('covered')} ${pct(v)}`)
      .join(', ');
  }
  if (!c.covered) return t('notCovered');
  return isLevel(c.level) ? t(`levelLong_${c.level}` as MessageKey) : t('covered');
}

export function statusDetail(s: OperatorSummary, st: OperatorStatus): string {
  const c5 = s.byTechno['5g'];
  const c4 = s.byTechno['4g'];
  const area = c5?.area ?? c4?.area;
  const where = !area ? '' : area.kind === 'circle' ? t('ofSurroundings') : area.basis === 'surface' ? t('ofCommune') : t('ofInhabitants');
  const d5 = area ? `${pct(st.share5g)} ${where}` : st.share5g ? t('covered') : t('notCovered');
  return t('detail', { d5, d4: describe4g(c4) });
}
